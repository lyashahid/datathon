import { describe, expect, it } from 'vitest';
import type { PlanningAction, PlanningBaseline } from '#lib/planning/types.ts';
import { waveTriggerCoordinates } from './waveTriggers.ts';

const stop = { id: 'a', name: 'A', lon: 73.51, lat: 4.17, islandId: 'male', sourceIds: [] };
const pattern = {
	id: 'route',
	routeId: 'r',
	name: 'Route',
	mode: 'bus' as const,
	stopIds: ['a'],
	calendar: { weekdays: [1] },
	provenance: 'assumed' as const,
	sourceIds: [],
	timing: { kind: 'frequency' as const, windows: [], segmentMinutes: [] }
};
const baseline = {
	transit: { stops: [stop], patterns: [pattern] },
	facilities: []
} as unknown as PlanningBaseline;

describe('recalculation wave triggers', () => {
	it('does not restart for a structurally identical history or preview-only changes', () => {
		const actions: PlanningAction[] = [{ kind: 'disable-stop', stopId: 'a' }];
		expect(waveTriggerCoordinates(baseline, actions, structuredClone(actions))).toEqual([]);
	});
	it('uses the affected stop for closure, reopening and undo', () => {
		const action: PlanningAction = { kind: 'disable-stop', stopId: 'a' };
		expect(waveTriggerCoordinates(baseline, [], [action])).toEqual([[73.51, 4.17]]);
		expect(waveTriggerCoordinates(baseline, [action], [])).toEqual([[73.51, 4.17]]);
	});
	it('includes the old location and the proposed location when moving a stop', () => {
		expect(
			waveTriggerCoordinates(
				baseline,
				[],
				[
					{
						kind: 'move-stop',
						stopId: 'a',
						position: { lon: 73.52, lat: 4.18 }
					}
				]
			)
		).toEqual([
			[73.51, 4.17],
			[73.52, 4.18]
		]);
	});
	it('locates route changes, including undoing a newly constructed connection', () => {
		expect(
			waveTriggerCoordinates(
				baseline,
				[],
				[
					{
						kind: 'set-frequency',
						patternId: 'route',
						headwayMinutes: 10
					}
				]
			)
		).toEqual([[73.51, 4.17]]);
		const newStop = { ...stop, id: 'new', lon: 73.54 };
		const action: PlanningAction = {
			kind: 'add-route',
			pattern: { ...pattern, id: 'new-route', stopIds: ['new'] },
			stops: [newStop]
		};
		expect(waveTriggerCoordinates(baseline, [action], [])).toEqual([[73.54, 4.17]]);
	});
	it('starts from the proposed school or clinic, including its removal by undo', () => {
		for (const kind of ['school', 'clinic'] as const) {
			const action: PlanningAction = {
				kind: 'add-facility',
				facility: { ...stop, id: kind, name: kind, kind, lon: 73.54, lat: 4.22 }
			};
			expect(waveTriggerCoordinates(baseline, [], [action])).toEqual([[73.54, 4.22]]);
			expect(waveTriggerCoordinates(baseline, [action], [])).toEqual([[73.54, 4.22]]);
		}
	});
	it('uses the last committed position of an already moved proposed stop', () => {
		const proposed = { ...stop, id: 'new' };
		const before: PlanningAction[] = [{ kind: 'add-stop', stop: proposed }];
		const world = { stops: [{ ...proposed, lon: 73.52, lat: 4.18 }], patterns: [], facilities: [] };
		expect(
			waveTriggerCoordinates(
				baseline,
				before,
				[
					...before,
					{
						kind: 'move-stop',
						stopId: 'new',
						position: { lon: 73.53, lat: 4.19 }
					}
				],
				world
			)
		).toEqual([
			[73.52, 4.18],
			[73.53, 4.19]
		]);
	});
	it('seeds both committed positions for rapid repeated moves, undo, and redo with stale results', () => {
		const first: PlanningAction = {
			kind: 'move-stop',
			stopId: 'a',
			position: { lon: 73.52, lat: 4.18 }
		};
		const second: PlanningAction = {
			kind: 'move-stop',
			stopId: 'a',
			position: { lon: 73.53, lat: 4.19 }
		};
		const stale = { stops: [stop], patterns: [pattern], facilities: [] };
		const atSecond = {
			...stale,
			stops: [{ ...stop, ...second.position }]
		};
		expect(waveTriggerCoordinates(baseline, [first], [first, second], stale)).toEqual([
			[73.52, 4.18],
			[73.53, 4.19]
		]);
		expect(waveTriggerCoordinates(baseline, [first, second], [first], atSecond)).toEqual([
			[73.53, 4.19],
			[73.52, 4.18]
		]);
		expect(waveTriggerCoordinates(baseline, [first], [first, second], atSecond)).toEqual([
			[73.52, 4.18],
			[73.53, 4.19]
		]);
	});
	it('does not let a stale or preview world move the authoritative observed stop seed', () => {
		const action: PlanningAction = {
			kind: 'move-stop',
			stopId: 'a',
			position: { lon: 73.52, lat: 4.18 }
		};
		const world = { stops: [{ ...stop, lon: 73.55, lat: 4.25 }], patterns: [], facilities: [] };
		expect(waveTriggerCoordinates(baseline, [], [action], world)).toEqual([
			[73.51, 4.17],
			[73.52, 4.18]
		]);
	});
	it('uses explicit proposed-stop move history instead of a stale published position', () => {
		const proposed = { ...stop, id: 'new' };
		const add: PlanningAction = { kind: 'add-stop', stop: proposed };
		const first: PlanningAction = {
			kind: 'move-stop',
			stopId: 'new',
			position: { lon: 73.52, lat: 4.18 }
		};
		const second: PlanningAction = {
			kind: 'move-stop',
			stopId: 'new',
			position: { lon: 73.53, lat: 4.19 }
		};
		const world = { stops: [proposed], patterns: [], facilities: [] };
		expect(waveTriggerCoordinates(baseline, [add, first], [add, first, second], world)).toEqual([
			[73.52, 4.18],
			[73.53, 4.19]
		]);
		expect(waveTriggerCoordinates(baseline, [add, first, second], [add, first], world)).toEqual([
			[73.53, 4.19],
			[73.52, 4.18]
		]);
	});
	it('keeps both removed and added route locations when a connection is replaced or undone', () => {
		const removed = { ...stop, id: 'old-end', lon: 73.52 };
		const added = { ...stop, id: 'new-end', lon: 73.53 };
		const oldPattern = { ...pattern, stopIds: ['a', removed.id] };
		const withRoute = {
			...baseline,
			transit: { stops: [stop, removed], patterns: [oldPattern], gaps: [] }
		};
		const replacement: PlanningAction = {
			kind: 'replace-route',
			patternId: pattern.id,
			patterns: [{ ...pattern, stopIds: ['a', added.id] }],
			stops: [added]
		};
		for (const [before, after] of [
			[[], [replacement]],
			[[replacement], []]
		] as const) {
			const points = waveTriggerCoordinates(withRoute, before, after);
			expect(points).toHaveLength(3);
			expect(points).toEqual(
				expect.arrayContaining([
					[73.51, 4.17],
					[73.52, 4.17],
					[73.53, 4.17]
				])
			);
		}
	});
});
