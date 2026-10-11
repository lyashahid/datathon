import { cellToLatLng, gridDisk, gridDistance, isValidCell, latLngToCell } from 'h3-js';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';

export type WaveGeometry = Polygon | MultiPolygon;
export type WaveCoordinate = readonly [number, number];

/** Times use performance.now(), never a wall-clock timestamp. */
export interface RecalculationWave {
	id: number;
	startedAt: number;
	completedAt: number | null;
	outcome?: 'success' | 'error';
	cells: FeatureCollection<WaveGeometry>;
}

export const WAVE_SPREAD_MS = 1_100;
export const WAVE_DEEPEN_MS = 320;
export const WAVE_FADE_MS = 300;

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const smooth = (value: number) => value * value * (3 - 2 * value);

function distance(a: WaveCoordinate, b: WaveCoordinate): number {
	const meanLat = ((a[1] + b[1]) * Math.PI) / 360;
	return Math.hypot((a[0] - b[0]) * Math.cos(meanLat), a[1] - b[1]);
}

function centre(geometry: WaveGeometry): [number, number] {
	const ring = geometry.type === 'Polygon' ? geometry.coordinates[0] : geometry.coordinates[0]?.[0];
	const points = ring?.slice(0, -1) ?? [];
	if (!points.length) return [0, 0];
	return [
		points.reduce((sum, point) => sum + point[0], 0) / points.length,
		points.reduce((sum, point) => sum + point[1], 0) / points.length
	];
}

/**
 * Flood only the islands touched by an edit, through their land-clipped H3 cells.
 * Grids without island metadata use seeded connected components instead. Separate
 * pieces of a selected island may share a visual wave, but unselected islands do
 * not light up. Multiple seeds support moved stops and routes spanning islands.
 */
export function buildWaveCells(
	areas: FeatureCollection<WaveGeometry>,
	seeds: readonly WaveCoordinate[]
): FeatureCollection<WaveGeometry> {
	if (!areas.features.length) return { type: 'FeatureCollection', features: [] };
	const nodes = new Map<string, { cell: string; point: WaveCoordinate; island: string | null }>();
	const identities = areas.features.map((feature) => {
		const given = feature.properties?.h3Id;
		const point = centre(feature.geometry);
		const cell =
			typeof given === 'string' && isValidCell(given)
				? given
				: latLngToCell(point[1], point[0], 10);
		const island =
			typeof feature.properties?.islandId === 'string' && feature.properties.islandId
				? feature.properties.islandId
				: null;
		const key = `${island ?? '\u0000'}:${cell}`;
		nodes.set(key, { cell, point, island });
		return key;
	});
	const cells = [...nodes.keys()];
	const neighbours = new Map(
		cells.map((key) => {
			const node = nodes.get(key)!;
			return [
				key,
				gridDisk(node.cell, 1)
					.filter((id) => id !== node.cell)
					.map((id) => `${node.island ?? '\u0000'}:${id}`)
					.filter((id) => nodes.has(id))
			];
		})
	);
	const components: { cells: string[]; scope: string }[] = [];
	const scopes = new Map<string, string>();
	for (const cell of cells) {
		if (scopes.has(cell)) continue;
		const island = nodes.get(cell)!.island;
		const scope = island === null ? `component:${components.length}` : `island:${island}`;
		const component = [cell];
		scopes.set(cell, scope);
		for (let index = 0; index < component.length; index++) {
			for (const next of neighbours.get(component[index])!) {
				if (scopes.has(next)) continue;
				scopes.set(next, scope);
				component.push(next);
			}
		}
		components.push({ cells: component, scope });
	}
	const validSeeds = seeds.filter(
		(point) => Number.isFinite(point[0]) && Number.isFinite(point[1])
	);
	const sourceCells = new Set<string>();
	for (const point of validSeeds) {
		let nearest = cells[0];
		let shortest = Infinity;
		for (const cell of cells) {
			const candidate = distance(nodes.get(cell)!.point, point);
			if (candidate < shortest) {
				shortest = candidate;
				nearest = cell;
			}
		}
		sourceCells.add(nearest);
	}
	if (!sourceCells.size) sourceCells.add(cells[0]);
	const selectedScopes = new Set([...sourceCells].map((cell) => scopes.get(cell)!));
	const steps = new Map<string, number>();
	for (const { cells: component, scope } of components) {
		if (!selectedScopes.has(scope)) continue;
		const queue = component.filter((id) => sourceCells.has(id));
		for (const id of queue) steps.set(id, 0);
		if (!queue.length) {
			let nearest = component[0];
			let shortest = Infinity;
			for (const id of component) {
				for (const source of sourceCells) {
					if (scopes.get(source) !== scope) continue;
					let candidate: number;
					try {
						candidate = gridDistance(nodes.get(source)!.cell, nodes.get(id)!.cell);
					} catch {
						// Different resolutions or a pentagon seam: estimate visual distance
						// in local cell widths without changing the analytical network.
						const sourceCell = nodes.get(source)!.cell;
						const sourceNeighbours = gridDisk(sourceCell, 1).filter(
							(value) => value !== sourceCell
						);
						const [lat, lon] = cellToLatLng(sourceNeighbours[0]);
						const width = distance(nodes.get(source)!.point, [lon, lat]);
						candidate =
							distance(nodes.get(source)!.point, nodes.get(id)!.point) / Math.max(width, 1e-8);
					}
					if (candidate < shortest) {
						shortest = candidate;
						nearest = id;
					}
				}
			}
			steps.set(nearest, shortest);
			queue.push(nearest);
		}
		for (let index = 0; index < queue.length; index++) {
			const current = queue[index];
			for (const next of neighbours.get(current)!) {
				if (steps.has(next)) continue;
				steps.set(next, steps.get(current)! + 1);
				queue.push(next);
			}
		}
	}
	const maximum = Math.max(0, ...steps.values());
	return {
		type: 'FeatureCollection',
		features: areas.features.flatMap((feature, index) => {
			const identity = identities[index];
			if (!selectedScopes.has(scopes.get(identity)!)) return [];
			return [
				{
					...feature,
					id: feature.id ?? feature.properties?.id ?? `${identity}:${index}`,
					properties: {
						...feature.properties,
						h3Id: nodes.get(identity)!.cell,
						arrivalMs: maximum ? (steps.get(identity)! / maximum) * WAVE_SPREAD_MS : 0
					}
				}
			];
		})
	};
}

export function waveCoverageMs(wave: RecalculationWave): number {
	return (
		Math.max(0, ...wave.cells.features.map((cell) => Number(cell.properties?.arrivalMs) || 0)) +
		WAVE_DEEPEN_MS
	);
}

/** Keep shared cells' ages; superseded islands leave the new overlay immediately. */
export function continueWave(
	previous: RecalculationWave | null,
	id: number,
	cells: RecalculationWave['cells'],
	now: number
): RecalculationWave {
	if (!previous) return { id, startedAt: now, completedAt: null, cells };
	const elapsed = Math.max(0, now - previous.startedAt);
	const key = (cell: RecalculationWave['cells']['features'][number], index: number) =>
		cell.id ??
		cell.properties?.id ??
		`${cell.properties?.islandId}:${cell.properties?.h3Id}:${index}`;
	const priorArrivals = new Map(
		previous.cells.features.map((cell, index) => [
			key(cell, index),
			Number(cell.properties?.arrivalMs) || 0
		])
	);
	return {
		id,
		startedAt: previous.startedAt,
		completedAt: null,
		cells: {
			...cells,
			features: cells.features.map((cell, index) => ({
				...cell,
				properties: {
					...cell.properties,
					arrivalMs: Math.min(
						priorArrivals.get(key(cell, index)) ?? Infinity,
						(Number(cell.properties?.arrivalMs) || 0) + elapsed
					)
				}
			}))
		}
	};
}

/** Completion is gated by the actual analysis, independently of decorative progress. */
export function waveFrame(wave: RecalculationWave, now: number, reducedMotion = false) {
	const elapsedMs = Math.max(0, now - wave.startedAt);
	if (!wave.cells.features.length)
		return {
			elapsedMs,
			opacity: 0,
			finished: wave.completedAt !== null,
			animating: false,
			finishAt: wave.completedAt
		};
	const coverageMs = reducedMotion ? 120 : waveCoverageMs(wave);
	const settled = wave.completedAt !== null;
	const fadeStart = settled
		? Math.max(
				wave.completedAt!,
				wave.startedAt + (wave.outcome === 'error' ? Math.min(coverageMs, 120) : coverageMs)
			)
		: Infinity;
	const fadeMs = reducedMotion ? 180 : WAVE_FADE_MS;
	const fade = settled ? smooth(clamp((now - fadeStart) / fadeMs)) : 0;
	const finished = settled && now >= fadeStart + fadeMs;
	return {
		elapsedMs,
		opacity: 1 - fade,
		finished,
		animating: !finished && (settled || (!reducedMotion && elapsedMs < coverageMs)),
		finishAt: settled ? fadeStart + fadeMs : null
	};
}
