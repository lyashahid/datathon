import { describe, expect, it } from 'vitest';
import { impactClass, impactHexes, createPlaybackSampler, routeFeatures } from './planning-map.js';
import type { PlanningComparison, PlanningJourney } from './planning-map.js';

const journey = (minutes: number | null): PlanningJourney => ({
	status: minutes === null ? 'unavailable' : 'reachable',
	minutes,
	destination_id: null,
	reason: null,
	geometry: [],
	path: []
});
function comparison(overrides: Partial<PlanningComparison> = {}): PlanningComparison {
	return {
		origin_id: 'origin:1',
		coordinates: [73.5, 4.1],
		population: 10,
		before: journey(20),
		after: journey(18),
		delta_minutes: 2,
		gained_access: false,
		lost_access: false,
		became_unavailable: false,
		...overrides
	};
}
describe('source-backed impact cells', () => {
	it('gives missing journey evidence priority over claimed loss', () => {
		expect(impactClass(comparison({ after: journey(null), lost_access: true }))).toBe(
			'unavailable'
		);
	});
	it('flags a journey that became unavailable without claiming measured lost access', () => {
		expect(
			impactClass(
				comparison({ after: journey(null), became_unavailable: true, delta_minutes: null })
			)
		).toBe('disrupted');
	});
	it('distinguishes gained target access from a faster journey within the same target', () => {
		expect(impactClass(comparison({ gained_access: true }))).toBe('gained');
		expect(impactClass(comparison())).toBe('improved');
	});
	it('preserves source resident weights and leaves unevaluated origins uncomputed', () => {
		const origins = [
			{ id: 'origin:1', islandId: 'male', lon: 73.5, lat: 4.1, population2026: 12 },
			{ id: 'origin:2', islandId: 'male', lon: 73.6, lat: 4.2, population2026: 15 }
		];
		const cells = impactHexes(origins, [comparison()]);
		expect(cells.features[0].properties?.population).toBe(10);
		expect(cells.features[1].properties?.impact).toBe('uncomputed');
		expect(cells.features[1].properties?.before).toBeNull();
	});
});
describe('calculated journey playback', () => {
	const timed: PlanningJourney = {
		...journey(20),
		path: [
			{
				mode: 'walk',
				from: 'home',
				to: 'pier',
				minutes: 5,
				wait_minutes: 0,
				geometry: [
					[73.5, 4.1],
					[73.51, 4.1]
				]
			},
			{
				mode: 'ferry',
				from: 'pier',
				to: 'hospital',
				minutes: 10,
				wait_minutes: 5,
				geometry: [
					[73.51, 4.1],
					[73.52, 4.1]
				]
			}
		]
	};
	it('honors walking, boarding waits, scheduled movement and arrival with explicit positions', () => {
		const sample = createPlaybackSampler(timed);
		for (const [elapsed, longitude, phase, mode, legIndex] of [
			[0, 73.5, 'Walking', 'walk', 0],
			[2.5, 73.505, 'Walking', 'walk', 0],
			[5, 73.51, 'Waiting to board', 'ferry', 1],
			[7, 73.51, 'Waiting to board', 'ferry', 1],
			[10, 73.51, 'On the ferry', 'ferry', 1],
			[15, 73.515, 'On the ferry', 'ferry', 1],
			[20, 73.52, 'Arrived', 'ferry', 1],
			[25, 73.52, 'Arrived', 'ferry', 1]
		] as const) {
			const position = sample(elapsed);
			expect(position).toMatchObject({ phase, mode, legIndex });
			expect(position.point?.[0]).toBeCloseTo(longitude, 6);
			expect(position.point?.[1]).toBe(4.1);
		}
	});
	it('does not reread provider vertices for each animation frame', () => {
		let reads = 0;
		const geometry = new Proxy(timed.path[0].geometry, {
			get(target, key, receiver) {
				if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
				return Reflect.get(target, key, receiver);
			}
		});
		const sample = createPlaybackSampler({ ...timed, path: [{ ...timed.path[0], geometry }] });
		const preparationReads = reads;
		for (let frame = 0; frame < 120; frame++) sample((frame / 120) * 5);
		expect(preparationReads).toBeGreaterThan(0);
		expect(reads).toBe(preparationReads);
	});
	it('measures distance rather than vertex count and keeps independent journeys separate', () => {
		const original = createPlaybackSampler(timed);
		const replacement = createPlaybackSampler({
			...timed,
			path: [
				{
					...timed.path[0],
					geometry: [
						[0, 0],
						[1, 0],
						[4, 0]
					]
				}
			]
		});
		expect(replacement(2.5).point).toEqual([2, 0]);
		expect(original(2.5).point?.[0]).toBeCloseTo(73.505, 6);
	});
	it('retains leg modes and exact network geometry without fabricating an unlocated leg', () => {
		const routes = routeFeatures(timed, 'outward');
		expect(routes.features.map((feature) => feature.properties?.mode)).toEqual(['walk', 'ferry']);
		expect(routes.features[1].geometry).toEqual({
			type: 'LineString',
			coordinates: timed.path[1].geometry
		});
		expect(
			routeFeatures({ ...timed, path: [{ ...timed.path[0], geometry: [] }] }, 'outward').features
		).toEqual([]);
	});
	it('does not fabricate a route or animate across a missing provider vertex', () => {
		const broken = {
			...timed,
			path: [
				{
					...timed.path[0],
					geometry: [
						[73.5, 4.1],
						[NaN, 4.1],
						[73.51, 4.1]
					]
				}
			]
		};
		expect(routeFeatures(broken, 'outward').features).toEqual([]);
		expect(createPlaybackSampler(broken)(2.5).point).toBeNull();
	});
});
