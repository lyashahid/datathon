import { describe, expect, it } from 'vitest';
import type { FeatureCollection, Position } from 'geojson';
import {
	assessDraftBudget,
	draftCosts,
	pointWithinIsland,
	restorePlanningOperations
} from './map-policy.js';

const defaults = {
	school_capital_mvr: 25_000_000,
	school_annual_operating_mvr: 5_000_000,
	hospital_capital_mvr: 120_000_000,
	hospital_annual_operating_mvr: 20_000_000,
	stop_capital_mvr: 100_000
};

describe('saved proposal recovery', () => {
	const stop = { type: 'add_stop', coordinates: [73.5, 4.2], name: 'New stop' };
	it('recovers valid changes alongside corrupt or obsolete browser entries without crashing', () => {
		expect(
			restorePlanningOperations([
				null,
				'old change',
				[],
				{ type: 'obsolete_port' },
				{ type: 'add_school' },
				{ ...stop, coordinates: [73.5, 91] },
				{ ...stop, metadata: [] },
				{ ...stop, name: {} },
				stop
			])
		).toEqual({ operations: [stop], discarded: 8 });
		expect(restorePlanningOperations(null)).toEqual({ operations: [], discarded: 0 });
	});
	it('rejects incomplete map metadata before it reaches map and route derivations', () => {
		for (const ui_map_features of [
			null,
			{ type: 'FeatureCollection', features: null },
			{ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: null }] }
		])
			expect(restorePlanningOperations([{ ...stop, metadata: { ui_map_features } }])).toEqual({
				operations: [],
				discarded: 1
			});
	});
	it('rejects malformed route coordinates before focusing or rendering a restored service', () => {
		for (const geometry of [
			{ type: 'LineString', coordinates: [null] },
			{ type: 'LineString', coordinates: [[73.5, 4.2]] },
			{
				type: 'LineString',
				coordinates: [
					[73.5, 4.2],
					[73.51, 91]
				]
			},
			{ type: 'Point', coordinates: [] },
			{ type: 'MultiLineString', coordinates: [[null]] },
			{ type: 'Polygon', coordinates: [null] },
			{ type: 'unsupported', coordinates: [] }
		]) {
			const ui_map_features = {
				type: 'FeatureCollection',
				features: [{ type: 'Feature', geometry }]
			};
			expect(restorePlanningOperations([{ ...stop, metadata: { ui_map_features } }])).toEqual({
				operations: [],
				discarded: 1
			});
		}
	});
	it('keeps a valid routed package intact and removes the entire package if one member is broken', () => {
		const first = {
			...stop,
			metadata: {
				ui_package: 'bus-route:one',
				ui_map_features: {
					type: 'FeatureCollection',
					features: [
						{
							type: 'Feature',
							geometry: {
								type: 'LineString',
								coordinates: [
									[73.5, 4.2],
									[73.51, 4.21]
								]
							}
						}
					]
				}
			}
		};
		const returning = {
			type: 'add_service',
			service: { id: 'return', mode: 'bus' },
			metadata: { ui_package: 'bus-route:one' }
		};
		expect(restorePlanningOperations([first, returning])).toEqual({
			operations: [first, returning],
			discarded: 0
		});
		expect(restorePlanningOperations([stop, first, { ...returning, service: [] }])).toEqual({
			operations: [stop],
			discarded: 2
		});
		expect(
			restorePlanningOperations([stop, { type: 'obsolete', metadata: { ui_package: '' } }])
		).toEqual({ operations: [stop], discarded: 1 });
	});
	it('does not silently truncate an oversized proposal halfway through a service package', () => {
		expect(restorePlanningOperations(Array(100).fill(stop)).operations).toHaveLength(100);
		expect(restorePlanningOperations(Array(101).fill(stop))).toEqual({
			operations: [],
			discarded: 101
		});
	});
});

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
