import { describe, expect, it } from 'vitest';
import { createDefaultAssumptions } from './defaults.ts';
import { analyzePlanning } from './engine.ts';
import { prepareStopMove } from './liveEdits.ts';
import { derivePlanningWorld } from './scenario.ts';
import { PlanningScenarioState } from './scenarioState.svelte.ts';
import type {
	PlanningAction,
	PlanningBaseline,
	PlanningServicePattern,
	PlanningStop
} from './types.ts';

function fixture() {
	const nodes = [
		{ id: 'a', lon: 73.5, lat: 4.17 },
		{ id: 'b', lon: 73.51, lat: 4.17 },
		{ id: 'c', lon: 73.52, lat: 4.17 },
		{ id: 'd', lon: 73.515, lat: 4.18 },
		{ id: 'detached', lon: 73.54, lat: 4.17 }
	];
	const stops: PlanningStop[] = nodes.slice(0, 2).map((node, index) => ({
		...node,
		id: `proposal-${index}`,
		name: `Proposed stop ${index}`,
		islandId: 'island',
		sourceIds: []
	}));
	const pattern: PlanningServicePattern = {
		id: 'out',
		routeId: 'proposal-route',
		name: 'Assumed feeder',
		mode: 'bus',
		stopIds: stops.map((stop) => stop.id),
		provenance: 'assumed',
		sourceIds: [],
		fleet: 'diesel',
		calendar: { weekdays: [0, 1, 2, 3, 4, 5, 6] },
		timing: {
			kind: 'frequency',
			windows: [{ startMinutes: 420, endMinutes: 1140, headwayMinutes: 20 }],
			segmentMinutes: [4.5]
		},
		distanceM: 1000
	};
	const returnPattern: PlanningServicePattern = {
		...structuredClone(pattern),
		id: 'return',
		stopIds: [...pattern.stopIds].reverse(),
		distanceM: 1500,
		timing: {
			...structuredClone(pattern.timing),
			kind: 'frequency',
			segmentMinutes: [6.5],
			windows: [{ startMinutes: 420, endMinutes: 1140, headwayMinutes: 20 }]
		}
	};
	const edge = (from: number, to: number, metres: number) => ({
		id: `${from}-${to}`,
		from: nodes[from].id,
		to: nodes[to].id,
		distanceM: metres,
		walkAllowed: true,
		driveAllowed: true,
		oneway: true,
		geometry: [
			[nodes[from].lon, nodes[from].lat],
			[nodes[to].lon, nodes[to].lat]
		] as [number, number][]
	});
	const baseline: PlanningBaseline = {
		schemaVersion: 1,
		version: 'live-edit-test',
		generatedAt: '2026-10-10T00:00:00Z',
		referenceDate: '2026-10-10',
		sources: [],
		islands: [{ id: 'island', name: 'Island' }],
		origins: [{ ...nodes[2], id: 'origin', islandId: 'island', population2026: 100 }],
		network: {
			nodes,
			edges: [
				edge(0, 1, 1000),
				edge(1, 0, 1500),
				edge(2, 1, 2000),
				edge(1, 3, 500),
				edge(3, 2, 2500)
			]
		},
		facilities: [
			{
				...nodes[1],
				id: 'hospital',
				name: 'Hospital',
				islandId: 'island',
				kind: 'hospital',
				verification: 'official'
			}
		],
		transit: { stops: [], patterns: [], gaps: [] }
	};
	const add: PlanningAction = { kind: 'add-route', pattern, returnPattern, stops };
	return { baseline, add, assumptions: createDefaultAssumptions(baseline), nodes, stops };
}

describe('OSM-routed live stop editing', () => {
	it('rebuilds both directed paths while preserving IDs, service windows and later control references', () => {
		const { baseline, add, assumptions, nodes } = fixture();
		const actions: PlanningAction[] = [
			add,
			{ kind: 'set-frequency', patternId: 'out', headwayMinutes: 10 },
			{ kind: 'set-fleet', patternId: 'out', fleet: 'electric' }
		];
		const original = JSON.stringify({ baseline, actions });
		const moved = prepareStopMove(
			baseline,
			actions,
			'proposal-0',
			[nodes[2].lon + 0.00005, nodes[2].lat],
			assumptions
		);
		expect(moved.ok).toBe(true);
		if (!moved.ok) return;
		expect(moved.position).toEqual([nodes[2].lon, nodes[2].lat]);
		expect(moved.actions).toHaveLength(3);
		expect(moved.actions.slice(1)).toEqual(actions.slice(1));
		const rebuilt = moved.actions[0];
		expect(rebuilt.kind).toBe('add-route');
		if (rebuilt.kind !== 'add-route') return;
		expect(rebuilt.pattern).toMatchObject({
			id: 'out',
			routeId: 'proposal-route',
			distanceM: 2000,
			timing: { segmentMinutes: [8.5] }
		});
		expect(rebuilt.returnPattern).toMatchObject({
			id: 'return',
			routeId: 'proposal-route',
			distanceM: 3000,
			timing: { segmentMinutes: [12.5] }
		});
		expect(rebuilt.returnPattern?.geometry).toEqual([
			[nodes[1].lon, nodes[1].lat],
			[nodes[3].lon, nodes[3].lat],
			[nodes[2].lon, nodes[2].lat]
		]);
		expect(rebuilt.pattern.stopIds).toEqual(['proposal-0', 'proposal-1']);
		expect(rebuilt.pattern.timing).toMatchObject({
			windows: [{ startMinutes: 420, endMinutes: 1140, headwayMinutes: 20 }]
		});
		const world = derivePlanningWorld(baseline, moved.actions, assumptions);
		expect(world.patterns.every((pattern) => pattern.fleet === 'electric')).toBe(true);
		expect(world.patterns[0].timing).toMatchObject({ windows: [{ headwayMinutes: 10 }] });
		expect(JSON.stringify({ baseline, actions })).toBe(original);
	});

	it('uses selected runtime assumptions and returns a deterministic preview identical to one history commit', () => {
		const { baseline, add, assumptions, nodes } = fixture();
		const selected = { ...assumptions, busMovingKph: 30, busDwellMinutes: 1 };
		const store = new PlanningScenarioState(baseline);
		store.replaceActions([add]);
		store.setAssumptions(selected);
		store.clearHistory();
		let last = prepareStopMove(
			baseline,
			store.actions,
			'proposal-0',
			[nodes[2].lon, nodes[2].lat],
			selected
		);
		for (let index = 0; index < 20; index++)
			last = prepareStopMove(
				baseline,
				store.actions,
				'proposal-0',
				[nodes[2].lon + index * 0.000001, nodes[2].lat],
				selected
			);
		expect(store.canUndo).toBe(false);
		expect(last.ok).toBe(true);
		if (!last.ok) return;
		const preview = analyzePlanning(baseline, last.actions, selected);
		store.replaceActions(last.actions);
		expect(store.analysis).toEqual(preview);
		expect(store.analysis.world.patterns[0].timing).toMatchObject({ segmentMinutes: [5] });
		expect(store.undo()).toBe(true);
		expect(store.actions).toEqual([add]);
		expect(store.canUndo).toBe(false);
		expect(store.redo()).toBe(true);
		expect(store.analysis).toEqual(preview);
	});

	it('rejects detached coordinates and a missing directed return without changing the saved proposal', () => {
		const { baseline, add, assumptions, nodes } = fixture();
		expect(
			prepareStopMove(baseline, [add], 'proposal-0', [nodes[4].lon, nodes[4].lat], assumptions)
		).toMatchObject({ ok: false });
		const oneWay = structuredClone(baseline);
		oneWay.network.edges = oneWay.network.edges.filter((edge) => edge.id !== '1-3');
		const original = JSON.stringify(add);
		expect(
			prepareStopMove(oneWay, [add], 'proposal-0', [nodes[2].lon, nodes[2].lat], assumptions)
		).toMatchObject({
			ok: false,
			reason: expect.stringContaining('every proposed service direction')
		});
		expect(JSON.stringify(add)).toBe(original);
	});

	it('moves a published stop through the existing invalidation action and retains pickup restrictions', () => {
		const { baseline, add, assumptions, nodes, stops } = fixture();
		if (add.kind !== 'add-route') throw new Error('Fixture must create a route');
		baseline.transit.stops = stops;
		baseline.transit.stops[0].pickupAllowed = false;
		baseline.transit.patterns = [
			{
				...add.pattern,
				provenance: 'observed',
				timing: {
					kind: 'scheduled',
					trips: [
						{
							id: 'published',
							stopTimes: [
								{ arrivalMinutes: 480, departureMinutes: 480 },
								{ arrivalMinutes: 490, departureMinutes: 490 }
							]
						}
					]
				}
			}
		];
		const moved = prepareStopMove(
			baseline,
			[],
			'proposal-0',
			[nodes[2].lon, nodes[2].lat],
			assumptions
		);
		expect(moved.ok).toBe(true);
		if (!moved.ok) return;
		expect(moved.actions).toEqual([
			{
				kind: 'move-stop',
				stopId: 'proposal-0',
				position: { lon: nodes[2].lon, lat: nodes[2].lat }
			}
		]);
		const world = derivePlanningWorld(baseline, moved.actions, assumptions);
		expect(world.patterns[0]).toMatchObject({
			enabled: false,
			runtimeUnavailableReason: 'Published timing does not apply to moved stops.'
		});
		expect(world.stops[0].pickupAllowed).toBe(false);
	});

	it('rejects ferry terminals and later route-extension geometry instead of keeping stale paths', () => {
		const { baseline, add, assumptions, nodes, stops } = fixture();
		const ferry = structuredClone(baseline);
		ferry.transit.stops = [{ ...stops[0], mode: 'ferry' }];
		expect(
			prepareStopMove(ferry, [], 'proposal-0', [nodes[2].lon, nodes[2].lat], assumptions)
		).toMatchObject({ ok: false, reason: expect.stringContaining('Ferry') });
		const extension: PlanningAction = {
			kind: 'extend-route',
			patternId: 'out',
			stop: { ...stops[1], id: 'extension' },
			segmentMinutes: 5,
			distanceM: 1000,
			returnSegmentMinutes: 5,
			returnDistanceM: 1000,
			geometry: [
				[nodes[1].lon, nodes[1].lat],
				[nodes[2].lon, nodes[2].lat]
			],
			returnGeometry: [
				[nodes[2].lon, nodes[2].lat],
				[nodes[1].lon, nodes[1].lat]
			]
		};
		expect(
			prepareStopMove(
				baseline,
				[add, extension],
				'proposal-0',
				[nodes[2].lon, nodes[2].lat],
				assumptions
			)
		).toMatchObject({ ok: false, reason: expect.stringContaining('later route geometry edits') });
	});
});
