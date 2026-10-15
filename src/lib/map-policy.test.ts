import { describe, expect, it } from 'vitest';
import type { FeatureCollection, Position } from 'geojson';
import { assessDraftBudget, distanceToRoad, draftCosts, pointWithinIsland } from './map-policy.js';

const defaults = {
	school_capital_mvr: 25_000_000,
	school_annual_operating_mvr: 5_000_000,
	hospital_capital_mvr: 120_000_000,
	hospital_annual_operating_mvr: 20_000_000,
	stop_capital_mvr: 100_000
};

describe('proposal budget commitments', () => {
	it('permits the exact capital and annual limits, including zero-cost changes', () => {
		expect(
			assessDraftBudget({ capital: 100_000, annual: 5_000_000 }, 100_000, 5_000_000)
		).toMatchObject({
			allowed: true,
			known: true,
			capitalRemaining: 0,
			annualRemaining: 0
		});
		expect(assessDraftBudget({ capital: 0, annual: 0 }, 0, 0).allowed).toBe(true);
	});
	it('rejects capital or operating overspend and explains both shortfalls', () => {
		const result = assessDraftBudget({ capital: 120_000, annual: 5_000_000 }, 100_000, 4_000_000);
		expect(result).toMatchObject({
			allowed: false,
			known: true,
			capitalRemaining: -20_000,
			annualRemaining: -1_000_000
		});
		expect(result.reason).toContain('MVR 20,000 over your capital budget');
		expect(result.reason).toContain('MVR 1,000,000 over your yearly running budget');
		expect(assessDraftBudget({ capital: 1, annual: 0 }, 0, 0).allowed).toBe(false);
		expect(assessDraftBudget({ capital: 0, annual: 1 }, 0, 0).allowed).toBe(false);
	});
	it('requires a complete finite cost and valid limits before any commitment', () => {
		for (const costs of [
			{ capital: null, annual: 0 },
			{ capital: 0, annual: null },
			{ capital: Infinity, annual: 0 }
		])
			expect(assessDraftBudget(costs, 100_000, 100_000)).toMatchObject({
				allowed: false,
				known: false
			});
		for (const invalid of [undefined, null, '', '100000', -1, NaN, Infinity]) {
			expect(assessDraftBudget({ capital: 0, annual: 0 }, invalid, 100_000)).toMatchObject({
				allowed: false,
				known: true
			});
			expect(assessDraftBudget({ capital: 0, annual: 0 }, 100_000, invalid).allowed).toBe(false);
		}
	});
	it('keeps verified operating savings and rounds money without a floating-point overspend', () => {
		expect(assessDraftBudget({ capital: 0.1 + 0.2, annual: -50 }, 0.3, 0)).toMatchObject({
			allowed: true,
			capitalRemaining: -0,
			annualRemaining: 50
		});
	});
});

describe('mapped land placement screen', () => {
	const square = (x: number, y: number): Position[] => [
		[x, y],
		[x + 1, y],
		[x + 1, y + 1],
		[x, y + 1],
		[x, y]
	];
	const islands: FeatureCollection = {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				properties: { id: 'island:first' },
				geometry: {
					type: 'Polygon',
					coordinates: [
						square(73, 4),
						square(73.25, 4.25).map(([x, y]) => [73.25 + (x - 73.25) / 4, 4.25 + (y - 4.25) / 4])
					]
				}
			},
			{
				type: 'Feature',
				properties: { island_id: 'island:second' },
				geometry: {
					type: 'MultiPolygon',
					coordinates: [[square(74, 4)], [square(75, 4).reverse()]]
				}
			}
		]
	};
	it('matches the requested island and excludes mapped water including polygon holes', () => {
		expect(pointWithinIsland([73.1, 4.1], islands, 'island:first')).toBe(true);
		expect(pointWithinIsland([73.3, 4.3], islands, 'island:first')).toBe(false);
		expect(pointWithinIsland([73.25, 4.3], islands, 'island:first')).toBe(false);
		expect(pointWithinIsland([74.5, 4.5], islands, 'island:first')).toBe(false);
		expect(pointWithinIsland([73, 4.5], islands, 'island:first')).toBe(true);
	});
	it('accepts any land part of a multipolygon independent of ring winding', () => {
		expect(pointWithinIsland([74.5, 4.5], islands, 'island:second')).toBe(true);
		expect(pointWithinIsland([75.5, 4.5], islands, 'island:second')).toBe(true);
		expect(pointWithinIsland([76.5, 4.5], islands, 'island:second')).toBe(false);
	});
	it('distinguishes missing or unusable island boundaries from known off-island coordinates', () => {
		expect(pointWithinIsland([73.1, 4.1], islands, 'island:missing')).toBeNull();
		expect(pointWithinIsland([73.1, 4.1], null, 'island:first')).toBeNull();
		expect(pointWithinIsland([Number.NaN, 4.1], islands, 'island:first')).toBe(false);
		expect(
			pointWithinIsland(
				[73.1, 4.1],
				{
					type: 'FeatureCollection',
					features: [
						{
							type: 'Feature',
							properties: { id: 'island:first' },
							geometry: { type: 'Point', coordinates: [73.1, 4.1] }
						}
					]
				},
				'island:first'
			)
		).toBeNull();
		expect(
			pointWithinIsland(
				[73.1, 4.1],
				{
					type: 'FeatureCollection',
					features: [
						{
							type: 'Feature',
							properties: { id: 'island:first' },
							geometry: { type: 'Polygon', coordinates: [[]] }
						}
					]
				},
				'island:first'
			)
		).toBeNull();
	});
});

describe('live proposal cost arithmetic', () => {
	it('keeps capital and annual funding separate for mixed infrastructure', () => {
		expect(
			draftCosts([{ type: 'add_school' }, { type: 'add_hospital' }, { type: 'add_stop' }], defaults)
		).toEqual({ capital: 145_100_000, annual: 25_000_000 });
	});
	it('does not turn missing recurring evidence into zero or NaN', () => {
		expect(draftCosts([{ type: 'add_school' }], { school_capital_mvr: 25_000_000 })).toEqual({
			capital: 25_000_000,
			annual: null
		});
		expect(draftCosts([{ type: 'add_service' }], defaults)).toEqual({
			capital: null,
			annual: null
		});
	});
	it('honours explicit facility cost overrides used by the canonical backend', () => {
		expect(
			draftCosts(
				[
					{
						type: 'add_school',
						metadata: { costs: { capital_mvr: 0, annual_operating_mvr: 750_000 } }
					}
				],
				defaults
			)
		).toEqual({ capital: 0, annual: 750_000 });
		expect(
			draftCosts([{ type: 'add_school', metadata: { costs: { capital_mvr: -1 } } }], defaults)
		).toEqual({ capital: null, annual: 5_000_000 });
	});
	it('uses the whole shuttle package estimate once including fleet and operation costs', () => {
		expect(
			draftCosts(
				[
					{
						type: 'add_stop',
						metadata: { ui_package: 'bus', ui_capital: 9_100_000, ui_annual: 673_000 }
					},
					{ type: 'add_service', metadata: { ui_package: 'bus', ui_capital: 0, ui_annual: 0 } },
					{ type: 'add_service', metadata: { ui_package: 'bus', ui_capital: 0, ui_annual: 0 } }
				],
				defaults
			)
		).toEqual({ capital: 9_100_000, annual: 673_000 });
	});
	it('does not accept missing or nonnumeric package factors as free infrastructure', () => {
		expect(draftCosts([{ type: 'add_stop', metadata: { ui_package: 'bus' } }], defaults)).toEqual({
			capital: null,
			annual: null
		});
		expect(
			draftCosts(
				[
					{
						type: 'add_stop',
						metadata: { ui_package: 'bus', ui_capital: '100000', ui_annual: Infinity }
					}
				],
				defaults
			)
		).toEqual({ capital: null, annual: null });
	});
});

describe('draft site connection feedback', () => {
	it('measures the closest segment rather than only the road endpoint', () => {
		expect(
			distanceToRoad(
				[73.5, 4.17],
				[
					{
						geometry: [
							[73.49, 4.17],
							[73.51, 4.17]
						]
					}
				]
			)
		).toBeLessThan(0.001);
		expect(
			distanceToRoad(
				[73.5, 4.171],
				[
					{
						geometry: [
							[73.49, 4.17],
							[73.51, 4.17]
						]
					}
				]
			)
		).toBeCloseTo(111.32, 2);
	});
	it('keeps unavailable geography and invalid coordinates unavailable', () => {
		expect(distanceToRoad([73.5, 4.17], [])).toBeNull();
		expect(
			distanceToRoad(
				[Number.NaN, 4.17],
				[
					{
						geometry: [
							[73.49, 4.17],
							[73.51, 4.17]
						]
					}
				]
			)
		).toBeNull();
	});
});
