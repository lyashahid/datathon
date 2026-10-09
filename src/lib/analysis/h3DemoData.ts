import { cellArea, cellToLatLng, polygonToCells } from 'h3-js';
import { H3_RESOLUTION } from '#lib/config/analysis.ts';
import type { Position } from '#lib/types/domain.ts';
import type { H3BaseCell } from '#lib/types/h3.ts';
import { DEMO_ISLAND_PROFILES } from './demoMetrics.ts';
import { distanceToLineM, pointInRing } from './geo.ts';

/**
 * DEMO FIXTURE — hand-traced, approximate outlines of the inhabited Greater Malé islands
 * ([lng, lat] rings). Stand-ins until OSM island polygons are ingested.
 */
export const DEMO_ISLAND_OUTLINES: Readonly<Record<string, readonly Position[]>> = {
	Malé: [
		[73.4995, 4.172],
		[73.502, 4.1775],
		[73.51, 4.18],
		[73.518, 4.1795],
		[73.5225, 4.1765],
		[73.5215, 4.172],
		[73.515, 4.168],
		[73.506, 4.1665],
		[73.5005, 4.1685]
	],
	Hulhumalé: [
		[73.5345, 4.2045],
		[73.5375, 4.2025],
		[73.5425, 4.208],
		[73.547, 4.216],
		[73.548, 4.223],
		[73.545, 4.225],
		[73.541, 4.219],
		[73.537, 4.212]
	],
	Villimalé: [
		[73.484, 4.173],
		[73.4855, 4.176],
		[73.4885, 4.1768],
		[73.4905, 4.175],
		[73.4895, 4.172],
		[73.486, 4.1715]
	],
	Hulhulé: [
		[73.5265, 4.1795],
		[73.532, 4.179],
		[73.538, 4.185],
		[73.5395, 4.197],
		[73.536, 4.2015],
		[73.53, 4.2005],
		[73.5262, 4.19]
	]
};

/** Island containing a position, from the demo outlines; null when outside all of them. */
export function demoIslandAt(position: Position): string | null {
	for (const [island, outline] of Object.entries(DEMO_ISLAND_OUTLINES)) {
		if (pointInRing(position, outline)) return island;
	}
	return null;
}

/** DEMO FIXTURE — illustrative age structure per island (children <15, older 65+). */
export const DEMO_AGE_SHARES: Readonly<
	Record<string, { children: number; workingAge: number; older: number }>
> = {
	Malé: { children: 0.22, workingAge: 0.71, older: 0.07 },
	Hulhumalé: { children: 0.3, workingAge: 0.65, older: 0.05 },
	Villimalé: { children: 0.27, workingAge: 0.65, older: 0.08 },
	// Airport island: mostly resident staff.
	Hulhulé: { children: 0.05, workingAge: 0.94, older: 0.01 }
};

/** Shoreline cells get this share of an interior cell's residents, rising to 1 at this depth. */
const SHORE_WEIGHT_MIN = 0.5;
const INTERIOR_DEPTH_M = 200;

const closedRing = (ring: readonly Position[]): Position[] => [...ring, ring[0]];

/**
 * Builds the demo demographic grid. Deterministic: each island's demo population is spread
 * over its cells, weighting interior cells more than shoreline ones (reef-island settlement
 * thins towards the coast), then split by the island's age shares. Island totals are exact.
 */
export function createDemoBaseCells(resolution = H3_RESOLUTION): H3BaseCell[] {
	const cells: H3BaseCell[] = [];
	// A cell belongs to one island only, even where traced outlines touch or overlap.
	const claimed = new Set<string>();
	for (const [island, outline] of Object.entries(DEMO_ISLAND_OUTLINES)) {
		const profile = DEMO_ISLAND_PROFILES[island];
		const ages = DEMO_AGE_SHARES[island];
		if (!profile || !ages) continue;

		const ring = closedRing(outline);
		// Sorted so output order never depends on h3-js internals.
		const indexes = polygonToCells([...ring], resolution, true)
			.sort()
			.filter((h) => !claimed.has(h));
		for (const h of indexes) claimed.add(h);
		const placed = indexes.map((h3Index) => {
			const [lat, lng] = cellToLatLng(h3Index);
			const centroid: Position = [lng, lat];
			const depth = distanceToLineM(centroid, ring);
			const weight =
				SHORE_WEIGHT_MIN + (1 - SHORE_WEIGHT_MIN) * Math.min(1, depth / INTERIOR_DEPTH_M);
			return { h3Index, centroid, weight };
		});
		const totalWeight = placed.reduce((s, c) => s + c.weight, 0);

		for (const { h3Index, centroid, weight } of placed) {
			const population = (profile.population * weight) / totalWeight;
			cells.push({
				h3Index,
				centroid,
				areaKm2: cellArea(h3Index, 'km2'),
				island,
				population,
				children: population * ages.children,
				workingAge: population * ages.workingAge,
				olderPopulation: population * ages.older,
				provenance: 'demo'
			});
		}
	}
	return cells;
}
