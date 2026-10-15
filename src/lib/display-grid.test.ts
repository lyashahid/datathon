import type { Feature, FeatureCollection, MultiPolygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import { displayGapHexes, displayImpactHexes } from './display-grid.js';
import { impactColors } from './planning-map.js';
import type { PlanningComparison, PlanningJourney, PlanningPlace } from './planning-map.js';

const geometry: MultiPolygon = {
	type: 'MultiPolygon',
	coordinates: [
		[
			[
				[73.5, 4.1],
				[73.51, 4.1],
				[73.5, 4.11],
				[73.5, 4.1]
			]
		]
	]
};

function mesh(): FeatureCollection {
	return {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				geometry,
				properties: {
					id: 'hex:1',
					island_id: 'island:1',
					contributions: [
						{ origin_id: 'origin:1', share: 0.25 },
						{ origin_id: 'origin:2', share: 0.5 }
					]
				}
			},
			{
				type: 'Feature',
				geometry,
				properties: {
					id: 'hex:2',
					island_id: 'island:1',
					contributions: [
						{ origin_id: 'origin:1', share: 0.75 },
						{ origin_id: 'origin:2', share: 0.5 }
					]
				}
			}
		]
	};
}

function gapSource(): FeatureCollection {
	return {
		type: 'FeatureCollection',
		features: [100, 50].map((population, index): Feature => ({
			type: 'Feature',
			geometry,
			properties: {
				origin_id: `origin:${index + 1}`,
				population,
				health_gap: 0.2 + index * 0.4,
				health_minutes: 10 + index * 20,
				education_gap: 0.1,
				education_minutes: 5,
				transport_gap: 0.4,
				transport_minutes: 4,
				overall_gap: 0.4 + index * 0.2
			}
		}))
	};
}

const origins: PlanningPlace[] = [100, 50].map((population2026, index) => ({
	id: `origin:${index + 1}`,
	islandId: 'island:1',
	population2026,
	lon: 73.5,
	lat: 4.1
}));

const journey = (minutes: number | null): PlanningJourney => ({
	status: minutes === null ? 'unavailable' : 'reachable',
	minutes,
	destination_id: null,
	reason: null,
	path: [],
	geometry: []
});

function comparisons(): PlanningComparison[] {
	return origins.map((origin, index) => ({
		origin_id: origin.id,
		population: origin.population2026!,
		coordinates: [origin.lon, origin.lat],
		before: journey(20 + index * 20),
		after: journey(10 + index * 20),
		delta_minutes: 10,
		gained_access: false,
		lost_access: false,
		became_unavailable: false
	}));
}

describe('display gap grid', () => {
	it('conserves source residents across fractional raster contributions and weights every metric', () => {
		const result = displayGapHexes(gapSource(), mesh());
		expect(result.features.map((cell) => cell.properties?.population)).toEqual([50, 100]);
		expect(result.features.reduce((sum, cell) => sum + cell.properties!.population, 0)).toBe(150);
		expect(result.features[0].properties).toMatchObject({
			origin_id: 'hex:1',
			island_id: 'island:1',
			health_minutes: 20,
			display_grid: true,
			source_origin_count: 2,
			partial_evidence: false
		});
		expect(result.features[0].properties?.health_gap).toBeCloseTo(0.4);
		expect(result.features[1].properties?.health_minutes).toBe(15);
	});

	it('keeps individual metrics unknown instead of averaging away a small missing contribution', () => {
		const source = gapSource();
		source.features[1].properties!.health_minutes = null;
		source.features[1].properties!.health_gap = null;
		const cell = displayGapHexes(source, mesh()).features[0];
		expect(cell.properties).toMatchObject({
			population: 50,
			health_minutes: null,
			health_gap: null,
			education_minutes: 5,
			partial_evidence: true
		});
	});

	it('does not invent resident weights or paint cells with missing sources as known', () => {
		const source = gapSource();
		source.features.pop();
		expect(displayGapHexes(source, mesh()).features[0].properties).toMatchObject({
			population: null,
			health_minutes: null,
			overall_gap: null,
			partial_evidence: true
		});
	});

	it('accepts zero residents without inventing time evidence, and rejects non-finite resident weights', () => {
		const source = gapSource();
		for (const cell of source.features) cell.properties!.population = 0;
		expect(displayGapHexes(source, mesh()).features[0].properties).toMatchObject({
			population: 0,
			health_minutes: null,
			partial_evidence: true
		});
		for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
			source.features[0].properties!.population = invalid;
			expect(displayGapHexes(source, mesh()).features[0].properties?.population).toBeNull();
		}
	});
});

describe('display impact grid', () => {
	it('weights times and delta by residents and preserves total population across the grid', () => {
		const rows = comparisons();
		rows[1].after = journey(20);
		rows[1].delta_minutes = 20;
		const result = displayImpactHexes(origins, rows, mesh());
		expect(result.features[0].properties).toMatchObject({
			id: 'hex:1',
			population: 50,
			before: 30,
			after: 15,
			delta: 15,
			impact: 'improved',
			color: impactColors.improved,
			partial_evidence: false
		});
		expect(result.features[1].properties?.before).toBe(25);
		expect(result.features.reduce((sum, cell) => sum + cell.properties!.population, 0)).toBe(150);
	});

	it('uses evaluation-year population when provided and origin population only as a fallback', () => {
		const rows = comparisons();
		rows[0].population = 200;
		rows[1].population = null as unknown as number;
		const result = displayImpactHexes(origins, rows, mesh());
		expect(result.features[0].properties?.population).toBe(75);
		expect(result.features.reduce((sum, cell) => sum + cell.properties!.population, 0)).toBe(250);
		expect(result.features[0].properties?.before).toBeCloseTo(2000 / 75);
	});

	it('lets absent comparisons override favorable evidence without losing known resident weights', () => {
		const result = displayImpactHexes(origins, comparisons().slice(0, 1), mesh());
		expect(result.features[0].properties).toMatchObject({
			population: 50,
			impact: 'uncomputed',
			color: impactColors.uncomputed,
			before: null,
			after: null,
			delta: null,
			partial_evidence: true
		});
	});

	it('does not paint a partially unavailable journey green, retaining known baseline evidence', () => {
		const rows = comparisons();
		rows[1].after = journey(null);
		rows[1].delta_minutes = null;
		expect(displayImpactHexes(origins, rows, mesh()).features[0].properties).toMatchObject({
			impact: 'unavailable',
			before: 30,
			after: null,
			delta: null,
			partial_evidence: true
		});
		rows[1].became_unavailable = true;
		expect(displayImpactHexes(origins, rows, mesh()).features[0].properties?.impact).toBe(
			'disrupted'
		);
	});

	it('uses resident dominance for complete evidence and a conservative class on equal weights', () => {
		const rows = comparisons();
		rows[1].after = journey(50);
		rows[1].delta_minutes = -10;
		const result = displayImpactHexes(origins, rows, mesh());
		expect(result.features[0].properties?.impact).toBe('slower');
		expect(result.features[1].properties?.impact).toBe('improved');
	});

	it('requires a measured baseline before painting a modeled improvement', () => {
		const rows = comparisons();
		rows[1].before = journey(null);
		rows[1].delta_minutes = null;
		rows[1].gained_access = true;
		expect(displayImpactHexes(origins, rows, mesh()).features[0].properties).toMatchObject({
			impact: 'uncomputed',
			before: null,
			after: 20,
			delta: null,
			partial_evidence: true
		});
	});

	it('rejects a supplied delta without both journey observations, and never paints zero-weight cells green', () => {
		const rows = comparisons();
		rows[1].after = journey(null);
		expect(displayImpactHexes(origins, rows, mesh()).features[0].properties?.delta).toBeNull();
		for (const row of rows) row.population = 0;
		expect(displayImpactHexes(origins, rows, mesh()).features[0].properties).toMatchObject({
			population: 0,
			impact: 'uncomputed',
			before: null,
			after: null,
			delta: null,
			partial_evidence: true
		});
	});
});

it('retains exact clipped MultiPolygons and does not mutate any input', () => {
	const source = gapSource();
	const grid = mesh();
	const rows = comparisons();
	const snapshot = JSON.stringify({ source, grid, rows, origins });
	for (const result of [displayGapHexes(source, grid), displayImpactHexes(origins, rows, grid)]) {
		expect(result.features[0].geometry).toBe(grid.features[0].geometry);
		expect(result.features[0].geometry).toEqual(geometry);
		expect(result.features[0].properties).not.toBe(grid.features[0].properties);
	}
	// Mutating the newly derived properties must not change the mesh's provenance.
	const output = displayGapHexes(source, grid);
	output.features[0].properties!.population = 1234;
	output.features[0].properties!.health_gap = null;
	expect(JSON.stringify({ source, grid, rows, origins })).toBe(snapshot);
});
