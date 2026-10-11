import { latLngToCell } from 'h3-js';
import { type MultiPolygon as ClipMultiPolygon } from 'polygon-clipping';
import { precisionCoordinates, precisionIntersection } from './precisionClipping.ts';
import type { FeatureCollection } from 'geojson';
import type {
	OriginComparison,
	PlanningAnalysis,
	PlanningBaseline,
	PlanningOrigin
} from '#lib/planning/types.ts';
import {
	honeycombGrid,
	HONEYCOMB_RESOLUTION,
	type HoneycombGeometry,
	type HoneycombGrid
} from './honeycombGrid.ts';
import {
	journeyTimeBand,
	TRAVEL_TIME_BANDS,
	type JourneyTimeBand,
	type JourneyTimeState
} from './travelTimeBands.ts';

export type HoneycombAreaState = 'reachable' | 'gained' | 'lost' | 'gap' | 'unknown';
export type HoneycombAreaStatus = HoneycombAreaState | 'mixed';
export interface HoneycombAreaProperties {
	id: string;
	h3Id: string;
	islandId: string;
	/** A representative routing origin, not the origin of every resident in this cell. */
	originId: string | null;
	originIds: string[];
	/** Display allocation only. Official/model population remains on the original origins. */
	population: number;
	status: HoneycombAreaStatus;
	statusPopulation: Record<HoneycombAreaState, number>;
	/** Time to the selected destination, independent of the policy access target. */
	journeyTimeBand: JourneyTimeBand;
	journeyTimePopulation: Record<JourneyTimeState, number>;
	/** Share with access within the target, including newly gained access. */
	reachableShare: number | null;
	/** True where at least one source origin needed point-based allocation. */
	pointAllocated: boolean;
}
export type HoneycombAreas = FeatureCollection<HoneycombGeometry, HoneycombAreaProperties>;

type Bounds = [number, number, number, number];
interface OriginWeight {
	origin: PlanningOrigin;
	weight: number;
	pointAllocated: boolean;
}
interface Allocation {
	grid: HoneycombGrid;
	weights: OriginWeight[][];
}
const cache = new WeakMap<PlanningBaseline, Allocation>();
const states: HoneycombAreaState[] = ['reachable', 'gained', 'lost', 'gap', 'unknown'];
const timeStates = TRAVEL_TIME_BANDS.map(({ id }) => id).filter(
	(id): id is JourneyTimeState => id !== 'mixed'
);

function shape(value: unknown): HoneycombGeometry | null {
	if (!value || typeof value !== 'object' || !('type' in value) || !('coordinates' in value))
		return null;
	return value.type === 'Polygon' || value.type === 'MultiPolygon'
		? (value as HoneycombGeometry)
		: null;
}

function coordinates(geometry: HoneycombGeometry): ClipMultiPolygon {
	const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
	return precisionCoordinates(
		polygons.map((polygon) => polygon.map((ring) => ring.map((point) => [point[0], point[1]])))
	);
}

function bounds(polygons: ClipMultiPolygon): Bounds {
	let west = Infinity,
		south = Infinity,
		east = -Infinity,
		north = -Infinity;
	for (const polygon of polygons)
		for (const ring of polygon)
			for (const [lon, lat] of ring) {
				west = Math.min(west, lon);
				south = Math.min(south, lat);
				east = Math.max(east, lon);
				north = Math.max(north, lat);
			}
	return [west, south, east, north];
}

function overlaps(a: Bounds, b: Bounds): boolean {
	return a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
}

/** Local area ratios; translating coordinates avoids cancellation on small raster pixels. */
function ringArea(ring: number[][]): number {
	if (ring.length < 3) return 0;
	const [lon, lat] = ring[0];
	let twiceArea = 0;
	for (let i = 0; i < ring.length; i++) {
		const from = ring[i],
			to = ring[(i + 1) % ring.length];
		twiceArea += (from[0] - lon) * (to[1] - lat) - (to[0] - lon) * (from[1] - lat);
	}
	return Math.abs(twiceArea) / 2;
}

function area(polygons: ClipMultiPolygon): number {
	return polygons.reduce(
		(sum, polygon) =>
			sum +
			Math.max(
				0,
				ringArea(polygon[0]) - polygon.slice(1).reduce((a, ring) => a + ringArea(ring), 0)
			),
		0
	);
}

function allocation(baseline: PlanningBaseline): Allocation {
	const previous = cache.get(baseline);
	if (previous) return previous;
	const grid = honeycombGrid(baseline);
	const cells = grid.features.map((feature, index) => {
		const polygons = coordinates(feature.geometry);
		return { index, polygons, bounds: bounds(polygons), properties: feature.properties };
	});
	const result: Allocation = { grid, weights: cells.map(() => []) };
	const byIsland = new Map<string, typeof cells>();
	for (const cell of cells) {
		const islandCells = byIsland.get(cell.properties.islandId) ?? [];
		islandCells.push(cell);
		byIsland.set(cell.properties.islandId, islandCells);
	}
	for (const origin of baseline.origins) {
		const islandCells = byIsland.get(origin.islandId) ?? [];
		if (!islandCells.length) continue;
		const geometry = shape(origin.geometry);
		const polygons = geometry ? coordinates(geometry) : null;
		const originBounds = polygons ? bounds(polygons) : null;
		const intersections: { index: number; area: number }[] = [];
		if (polygons && originBounds)
			for (const cell of islandCells) {
				if (!overlaps(originBounds, cell.bounds)) continue;
				const overlap = area(precisionIntersection(polygons, cell.polygons));
				if (overlap > 0) intersections.push({ index: cell.index, area: overlap });
			}
		const total = intersections.reduce((sum, overlap) => sum + overlap.area, 0);
		if (total > 0) {
			// Normalize each source independently. A coastal pixel's population stays
			// entirely on its declared island's land rather than leaking into water.
			let allocated = 0;
			intersections.forEach((overlap, i) => {
				const weight = i === intersections.length - 1 ? 1 - allocated : overlap.area / total;
				allocated += weight;
				result.weights[overlap.index].push({ origin, weight, pointAllocated: false });
			});
		} else {
			// Legacy point-only origins stay explicit. No geometry or population is
			// invented offshore, and there is never a cross-island fallback.
			const h3Id = latLngToCell(origin.lat, origin.lon, HONEYCOMB_RESOLUTION);
			const nearest =
				islandCells.find((cell) => cell.properties.h3Id === h3Id) ??
				islandCells.reduce((closest, cell) => {
					const distance = (candidate: (typeof islandCells)[number]) => {
						const [west, south, east, north] = candidate.bounds;
						return ((west + east) / 2 - origin.lon) ** 2 + ((south + north) / 2 - origin.lat) ** 2;
					};
					return distance(cell) < distance(closest) ? cell : closest;
				});
			result.weights[nearest.index].push({ origin, weight: 1, pointAllocated: true });
		}
	}
	cache.set(baseline, result);
	return result;
}

function accessState(result: OriginComparison | undefined, target: number): HoneycombAreaState {
	if (!result || result.after.status === 'unavailable') return 'unknown';
	const after =
		result.after.status === 'reachable' &&
		result.after.minutes !== null &&
		result.after.minutes <= target;
	const before =
		result.before.status === 'reachable' &&
		result.before.minutes !== null &&
		result.before.minutes <= target;
	if (after) return result.before.status !== 'unavailable' && !before ? 'gained' : 'reachable';
	return before ? 'lost' : 'gap';
}

/**
 * A permanent honeycomb display of existing population and access results.
 * Source raster geometry is intersected with land-clipped hexagons once. Updates
 * aggregate the original origin results; hexagons never become routing origins.
 */
export function honeycombAreas(
	baseline: PlanningBaseline,
	analysis: Pick<PlanningAnalysis, 'origins'> | null,
	year: 2026 | 2030,
	target = 30
): HoneycombAreas {
	const { grid, weights } = allocation(baseline);
	const results = new Map(analysis?.origins.map((origin) => [origin.originId, origin]) ?? []);
	return {
		type: 'FeatureCollection',
		features: grid.features.map((cell, index) => {
			const populations: Record<HoneycombAreaState, number> = {
				reachable: 0,
				gained: 0,
				lost: 0,
				gap: 0,
				unknown: 0
			};
			const timePopulations: Record<JourneyTimeState, number> = {
				five: 0,
				ten: 0,
				fifteen: 0,
				thirty: 0,
				'over-thirty': 0,
				unreachable: 0,
				unknown: 0
			};
			let population = 0,
				representativePopulation = -1,
				originId: string | null = null;
			for (const contribution of weights[index]) {
				const modeled = results.get(contribution.origin.id)?.population;
				const source =
					typeof modeled === 'number' && Number.isFinite(modeled) && modeled >= 0
						? modeled
						: year === 2030
							? (contribution.origin.population2030 ?? contribution.origin.population2026)
							: contribution.origin.population2026;
				const amount = source * contribution.weight;
				population += amount;
				populations[accessState(results.get(contribution.origin.id), target)] += amount;
				timePopulations[journeyTimeBand(results.get(contribution.origin.id)?.after)] += amount;
				if (
					amount > representativePopulation ||
					(amount === representativePopulation && contribution.origin.id < (originId ?? ''))
				) {
					representativePopulation = amount;
					originId = contribution.origin.id;
				}
			}
			const representedStates = states.filter((state) => populations[state] > 0);
			const representedTimeStates = timeStates.filter((state) => timePopulations[state] > 0);
			return {
				type: 'Feature',
				id: cell.id,
				geometry: cell.geometry,
				properties: {
					id: cell.properties.id,
					h3Id: cell.properties.h3Id,
					islandId: cell.properties.islandId,
					originId,
					originIds: weights[index].map(({ origin }) => origin.id).sort(),
					population,
					status: representedStates.length > 1 ? 'mixed' : (representedStates[0] ?? 'unknown'),
					statusPopulation: populations,
					journeyTimeBand:
						representedTimeStates.length > 1 ? 'mixed' : (representedTimeStates[0] ?? 'unknown'),
					journeyTimePopulation: timePopulations,
					reachableShare:
						population > 0 ? (populations.reachable + populations.gained) / population : null,
					pointAllocated: weights[index].some((weight) => weight.pointAllocated)
				}
			};
		})
	};
}
