import {
	cellToBoundary,
	gridDisk,
	latLngToCell,
	polygonToCellsExperimental,
	POLYGON_TO_CELLS_FLAGS
} from 'h3-js';
import { type MultiPolygon as ClipMultiPolygon } from 'polygon-clipping';
import {
	precisionCoordinates,
	precisionIntersection,
	precisionUnion
} from './precisionClipping.ts';
import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson';
import type { PlanningBaseline } from '#lib/planning/types.ts';

// Larger, shoreline-clipped display cells; raster populations and routing stay unchanged.
export const HONEYCOMB_RESOLUTION = 11;
export type HoneycombGeometry = Polygon | MultiPolygon;
export interface HoneycombProperties {
	id: string;
	h3Id: string;
	islandId: string;
	/** Contextual links to original raster origins, never reallocated population estimates. */
	originIds: string[];
}
export type HoneycombGrid = FeatureCollection<HoneycombGeometry, HoneycombProperties>;

const cache = new WeakMap<PlanningBaseline, HoneycombGrid>();
const empty = (): HoneycombGrid => ({ type: 'FeatureCollection', features: [] });

function geometry(value: unknown): HoneycombGeometry | null {
	if (!value || typeof value !== 'object' || !('type' in value) || !('coordinates' in value))
		return null;
	if (value.type !== 'Polygon' && value.type !== 'MultiPolygon') return null;
	return value as HoneycombGeometry;
}

function clipCoordinates(shape: HoneycombGeometry): ClipMultiPolygon {
	const polygons = shape.type === 'Polygon' ? [shape.coordinates] : shape.coordinates;
	return precisionCoordinates(
		polygons.map((polygon) => polygon.map((ring) => ring.map((point) => [point[0], point[1]])))
	);
}

function bounds(polygons: ClipMultiPolygon): [number, number, number, number] {
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

function intersectsBounds(
	a: [number, number, number, number],
	b: [number, number, number, number]
) {
	return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function landGeometries(baseline: PlanningBaseline): ClipMultiPolygon[] {
	// Authoritative shoreline takes precedence. An absent shoreline cannot justify
	// drawing entire hexagons or a guessed rectangle over the lagoon.
	const boundaries = baseline.landBoundaries ?? baseline.islandBoundaries;
	if (!boundaries || typeof boundaries !== 'object') return [];
	if ('type' in boundaries && boundaries.type === 'FeatureCollection' && 'features' in boundaries) {
		const features = boundaries.features;
		if (!Array.isArray(features)) return [];
		return features.flatMap((feature) => {
			const shape = geometry(feature?.geometry);
			return shape ? [clipCoordinates(shape)] : [];
		});
	}
	const shape = geometry(boundaries);
	return shape ? [clipCoordinates(shape)] : [];
}

/**
 * A land-clipped display grid for recalculation feedback and optional outlines.
 * Raster origin geometry, population, routing coordinates, and access scores stay
 * untouched. No quantity or accessibility class is assigned to these hexagons.
 * Build once per immutable baseline; ordinary edits reuse the same geometry.
 */
export function honeycombGrid(baseline: PlanningBaseline): HoneycombGrid {
	const previous = cache.get(baseline);
	if (previous) return previous;
	const result = empty();
	const shores = landGeometries(baseline).map((coordinates) => ({
		coordinates,
		bounds: bounds(coordinates)
	}));
	if (!shores.length) {
		cache.set(baseline, result);
		return result;
	}
	for (const island of baseline.islands) {
		const origins = baseline.origins.filter((origin) => origin.islandId === island.id);
		if (!origins.length) continue;
		const islandShape = geometry(island.geometry);
		if (!islandShape) continue;
		const islandCoordinates = clipCoordinates(islandShape);
		const islandBounds = bounds(islandCoordinates);
		const pieces = shores
			.filter((shore) => intersectsBounds(islandBounds, shore.bounds))
			.map((shore) => precisionIntersection(islandCoordinates, shore.coordinates))
			.filter((piece) => piece.length);
		if (!pieces.length) continue;
		const land = precisionCoordinates(pieces.length === 1 ? pieces[0] : precisionUnion(...pieces));
		const ids = new Set<string>();
		const fullIds = new Set<string>();
		for (const polygon of land) {
			for (const id of polygonToCellsExperimental(
				polygon,
				HONEYCOMB_RESOLUTION,
				POLYGON_TO_CELLS_FLAGS.containmentOverlappingBbox,
				true
			))
				ids.add(id);
			for (const id of polygonToCellsExperimental(
				polygon,
				HONEYCOMB_RESOLUTION,
				POLYGON_TO_CELLS_FLAGS.containmentFull,
				true
			))
				fullIds.add(id);
		}
		// Bounding-box candidates retain land around holes smaller than one cell,
		// including holes enclosing a cell's centre. Clip those and their immediate
		// neighbours to keep numerical shoreline seams on the robust clipping path.
		// Only fully contained cells away from every shoreline bypass that work.
		const shorelineIds = new Set<string>();
		for (const id of ids)
			if (!fullIds.has(id)) for (const neighbour of gridDisk(id, 1)) shorelineIds.add(neighbour);
		const originGroups = new Map<string, string[]>();
		for (const origin of origins) {
			const id = latLngToCell(origin.lat, origin.lon, HONEYCOMB_RESOLUTION);
			const group = originGroups.get(id) ?? [];
			group.push(origin.id);
			originGroups.set(id, group);
		}
		for (const h3Id of [...ids].sort()) {
			const boundary = cellToBoundary(h3Id, true) as [number, number][];
			const closed = [...boundary, boundary[0]];
			const clipped =
				fullIds.has(h3Id) && !shorelineIds.has(h3Id)
					? [[closed]]
					: precisionIntersection([[closed]], land);
			if (!clipped.length) continue;
			const id = `${island.id}:${h3Id}`;
			result.features.push({
				type: 'Feature',
				id,
				properties: {
					id,
					h3Id,
					islandId: island.id,
					originIds: (originGroups.get(h3Id) ?? []).sort()
				},
				geometry:
					clipped.length === 1
						? { type: 'Polygon', coordinates: clipped[0] }
						: { type: 'MultiPolygon', coordinates: clipped }
			});
		}
	}
	cache.set(baseline, result);
	return result;
}
