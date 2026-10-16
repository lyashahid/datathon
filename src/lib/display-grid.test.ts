import type { Feature, FeatureCollection, MultiPolygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import {
	accessColors,
	comparisonCellProperties,
	displayAccessHexes,
	displayComparisonHexes,
	displayGapHexes,
	displayImpactHexes
} from './display-grid.js';
import { impactColors } from './planning-map.js';
import { GAP_PALETTE } from './map-overlay.js';
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

describe('current and proposed access views', () => {
	it.each([
		['health', 30],
		['education', 30],
		['transport', 10]
	] as const)('preserves the %s baseline scale on entering comparison', (domain, target) => {
		const source = gapSource();
		const rows = comparisons();
		for (const [index, ratio] of [0.15, 0.9].entries()) {
			const time = ratio * target;
			source.features[index].properties![`${domain}_minutes`] = time;
			source.features[index].properties![`${domain}_gap`] = ratio;
			rows[index].before = journey(time);
			rows[index].after = journey(time);
			rows[index].delta_minutes = 0;
		}
		const baseline = displayGapHexes(source, mesh());
		const comparison = displayComparisonHexes(origins, rows, mesh(), target);
		for (const [index, feature] of comparison.features.entries()) {
			const properties = feature.properties!;
			expect(properties.before_gap).toBeCloseTo(
				baseline.features[index].properties![`${domain}_gap`]
			);
			expect(properties.after_gap).toBe(properties.before_gap);
			expect(properties.after_color).toBe(properties.before_color);
		}
	});

	it('does not turn unchanged near-target journeys green when a proposal is added', () => {
		const source = gapSource();
		const rows = comparisons();
		for (let index = 0; index < rows.length; index++) {
			rows[index].before = journey(9.8);
			rows[index].after = journey(9.8);
			rows[index].delta_minutes = 0;
			source.features[index].properties!.transport_minutes = 9.8;
			source.features[index].properties!.transport_gap = 0.98;
		}
		const baseline = displayGapHexes(source, mesh());
		const comparison = displayComparisonHexes(origins, rows, mesh(), 10);
		for (let index = 0; index < comparison.features.length; index++) {
			const properties = comparison.features[index].properties!;
			expect(properties.before_gap).toBeCloseTo(baseline.features[index].properties!.transport_gap);
			expect(properties.after_gap).toBe(properties.before_gap);
			expect(properties.before_color).toBe('#d75c41');
			expect(properties.after_color).toBe(properties.before_color);
			expect(properties.before_access).toBe('within_target');
			expect(properties.after_access).toBe('within_target');
			expect(properties.impact).toBe('unchanged');
		}
	});

	it('matches baseline weighting of each capped journey rather than capping a cell average', () => {
		const source = gapSource();
		const rows = comparisons();
		for (const [index, value] of [2, 20].entries()) {
			rows[index].before = journey(value);
			rows[index].after = journey(value);
			rows[index].delta_minutes = 0;
			source.features[index].properties!.transport_minutes = value;
			source.features[index].properties!.transport_gap = Math.min(1, value / 10);
		}
		const baseline = displayGapHexes(source, mesh());
		const comparison = displayComparisonHexes(origins, rows, mesh(), 10);
		for (let index = 0; index < comparison.features.length; index++) {
			const properties = comparison.features[index].properties!;
			expect(properties.before_gap).toBeCloseTo(baseline.features[index].properties!.transport_gap);
			expect(properties.after_gap).toBe(properties.before_gap);
			expect(properties.after_color).toBe(properties.before_color);
			expect(properties.before_access).toBe('mixed');
		}
		expect(comparison.features[0].properties!.before_gap).toBeCloseTo(0.6);
		expect(comparison.features[0].properties!.before_gap).not.toBe(
			Math.min(1, Number(comparison.features[0].properties!.before) / 10)
		);
	});

	it('only recolors cells whose evaluated journeys change and preserves unrelated cells', () => {
		const rows = comparisons();
		const grid = mesh();
		grid.features[0].properties!.contributions = [{ origin_id: 'origin:1', share: 1 }];
		grid.features[1].properties!.contributions = [{ origin_id: 'origin:2', share: 1 }];
		rows[0].before = journey(12);
		rows[0].after = journey(1);
		rows[0].delta_minutes = 11;
		rows[0].gained_access = true;
		rows[1].before = journey(9.8);
		rows[1].after = journey(9.8);
		rows[1].delta_minutes = 0;
		const comparison = displayComparisonHexes(origins, rows, grid, 10);
		const changed = comparison.features[0].properties!;
		const unchanged = comparison.features[1].properties!;
		expect(changed.before_gap).toBe(1);
		expect(changed.after_gap).toBe(0.1);
		expect(changed.before_color).toBe(GAP_PALETTE.longer);
		expect(changed.after_color).not.toBe(changed.before_color);
		expect(changed.before_residents_within_target).toBe(0);
		expect(changed.after_residents_within_target).toBe(100);
		expect(unchanged.before_color).toBe(unchanged.after_color);
		expect(unchanged.before_gap).toBe(unchanged.after_gap);
		expect(unchanged.before_residents_within_target).toBe(50);
		expect(unchanged.after_residents_within_target).toBe(50);
	});

	it('prepares both access colors on one immutable mesh without rebuilding it to switch views', () => {
		const rows = comparisons();
		const grid = mesh();
		const snapshot = JSON.stringify({ rows, grid, origins });
		const prepared = displayComparisonHexes(origins, rows, grid, 25);
		const feature = prepared.features[0];
		const before = comparisonCellProperties(feature.properties!, 'before');
		const after = comparisonCellProperties(feature.properties!, 'after');
		expect(feature.geometry).toBe(grid.features[0].geometry);
		expect(feature.properties).toMatchObject({
			view: 'comparison',
			before_access: 'mixed',
			before_color: '#db6d43',
			after_access: 'mixed',
			after_color: '#e4964a',
			before_residents_within_target: 25,
			after_residents_within_target: 25
		});
		expect(before).toMatchObject({ view: 'before', selected_minutes: 30 });
		expect(after).toMatchObject({ view: 'after', selected_minutes: 20 });
		expect(prepared.features[0]).toBe(feature);
		expect(feature.properties?.view).toBe('comparison');
		expect(JSON.stringify({ rows, grid, origins })).toBe(snapshot);
	});

	it('keeps a real red-to-green threshold crossing and per-phase unknown evidence on the same cell', () => {
		const rows = comparisons();
		rows[0].before = journey(40);
		rows[1].before = journey(45);
		rows[0].after = journey(10);
		rows[1].after = journey(15);
		const properties = displayComparisonHexes(origins, rows, mesh(), 30).features[0].properties!;
		expect(properties).toMatchObject({
			before_color: GAP_PALETTE.longer,
			before_access: 'beyond_target',
			after_access: 'within_target',
			before_residents_beyond_target: 50,
			after_residents_within_target: 50
		});
		rows[0].after = journey(null);
		const unavailable = displayComparisonHexes(origins, rows, mesh(), 30).features[0].properties!;
		expect(comparisonCellProperties(unavailable, 'before').partial_evidence).toBe(false);
		expect(comparisonCellProperties(unavailable, 'after')).toMatchObject({
			access: 'unavailable',
			residents_unavailable: 25,
			partial_evidence: true
		});
	});

	it('reuses identical clipped cell geometry and IDs for every phase with real evaluated times', () => {
		const rows = comparisons();
		const grid = mesh();
		const current = displayAccessHexes(origins, rows, grid, 'before', 30);
		const proposed = displayAccessHexes(origins, rows, grid, 'after', 30);
		expect(current.features[0].geometry).toBe(grid.features[0].geometry);
		expect(proposed.features[0].geometry).toBe(grid.features[0].geometry);
		expect(current.features[0].properties).toMatchObject({
			id: 'hex:1',
			view: 'before',
			before: 30,
			after: 20,
			selected_minutes: 30,
			access: 'mixed',
			color: '#de7a45',
			population: 50,
			residents_within_target: 25,
			residents_beyond_target: 25
		});
		expect(proposed.features[0].properties).toMatchObject({
			id: 'hex:1',
			view: 'after',
			selected_minutes: 20,
			access: 'within_target',
			color: '#e59d4b',
			residents_within_target: 50,
			residents_beyond_target: 0
		});
		expect(current.features.reduce((sum, cell) => sum + cell.properties!.population, 0)).toBe(150);
	});

	it('distinguishes an evaluated missing route from missing evidence and unchanged access', () => {
		const rows = comparisons();
		rows[1].after = journey(null);
		expect(
			displayAccessHexes(origins, rows, mesh(), 'after', 30).features[0].properties
		).toMatchObject({
			access: 'unavailable',
			color: accessColors.unavailable,
			residents_unavailable: 25,
			selected_minutes: null
		});
		expect(
			displayAccessHexes(origins, rows.slice(0, 1), mesh(), 'after', 30).features[0].properties
		).toMatchObject({
			access: 'unknown',
			color: accessColors.unknown,
			residents_unknown: 25
		});
		for (const row of rows) {
			row.before = journey(20);
			row.after = journey(20);
			row.delta_minutes = 0;
		}
		expect(displayImpactHexes(origins, rows, mesh()).features[0].properties?.impact).toBe(
			'unchanged'
		);
		expect(
			displayAccessHexes(origins, rows, mesh(), 'after', 30).features[0].properties?.access
		).toBe('within_target');
	});

	it('can show known proposed access even when baseline evidence is unavailable', () => {
		const rows = comparisons();
		rows[0].before = journey(null);
		rows[0].delta_minutes = null;
		const result = displayAccessHexes(origins, rows, mesh(), 'after', 30);
		expect(result.features[0].properties).toMatchObject({
			access: 'within_target',
			selected_minutes: 20,
			before: null,
			delta: null,
			partial_evidence: false
		});
		expect(
			displayAccessHexes(origins, rows, mesh(), 'before', 30).features[0].properties?.access
		).toBe('unavailable');
	});

	it('retains real destination provenance for explanations without inventing causal links', () => {
		const rows = comparisons();
		rows[0].before.destination_id = 'hospital:old';
		rows[0].after.destination_id = 'proposal:add_hospital:test';
		rows[1].after.destination_id = 'hospital:existing';
		expect(displayImpactHexes(origins, rows, mesh()).features[0].properties).toMatchObject({
			view: 'improvement',
			source_origin_ids: ['origin:1', 'origin:2'],
			before_destination_ids: ['hospital:old'],
			after_destination_ids: ['proposal:add_hospital:test', 'hospital:existing']
		});
	});

	it('keeps invalid time or resident evidence unknown and rejects invalid journey targets', () => {
		const rows = comparisons();
		rows[0].after.minutes = -1;
		expect(
			displayAccessHexes(origins, rows, mesh(), 'after', 30).features[0].properties?.access
		).toBe('unknown');
		rows[0].population = -1;
		expect(
			displayAccessHexes(origins, rows, mesh(), 'after', 30).features[0].properties
		).toMatchObject({
			access: 'unknown',
			population: null,
			residents_unknown: null
		});
		for (const target of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
			expect(() => displayAccessHexes(origins, rows, mesh(), 'after', target)).toThrow(RangeError);
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
