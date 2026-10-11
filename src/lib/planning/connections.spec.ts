import { describe, expect, it } from 'vitest';
import { createBusConnection, createBusStopProposal, createStopInsertion } from './connections.ts';
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
import { validSavedActions } from './validation.ts';

function fixture() {
	const nodes = [
		{ id: 'a', lon: 73.5, lat: 4.17, islandId: 'island' },
		{ id: 'b', lon: 73.51, lat: 4.17, islandId: 'island' },
		{ id: 'c', lon: 73.52, lat: 4.17, islandId: 'island' },
		{ id: 'd', lon: 73.505, lat: 4.18, islandId: 'island' },
		{ id: 'offshore', lon: 73.53, lat: 4.17, islandId: null }
	];
	const stops: PlanningStop[] = nodes.slice(0, 3).map((node) => ({
		...node,
		id: `stop-${node.id}`,
		name: `Stop ${node.id.toUpperCase()}`,
		islandId: 'island',
		sourceIds: [],
		mode: 'bus'
	}));
	const pattern: PlanningServicePattern = {
		id: 'out',
		routeId: 'route',
		name: 'Existing bus',
		mode: 'bus',
		stopIds: ['stop-a', 'stop-b'],
		calendar: { weekdays: [0, 1, 2, 3, 4, 5, 6] },
		provenance: 'assumed',
		sourceIds: [],
		fleet: 'diesel',
		enabled: true,
		timing: {
			kind: 'frequency',
			windows: [{ startMinutes: 420, endMinutes: 1140, headwayMinutes: 20 }],
			segmentMinutes: [4.5]
		},
		distanceM: 1000
	};
	const back: PlanningServicePattern = {
		...structuredClone(pattern),
		id: 'back',
		stopIds: ['stop-b', 'stop-a'],
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
		version: 'connection-tests',
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
				edge(1, 2, 1000),
				edge(2, 1, 500),
				edge(0, 3, 1800),
				edge(3, 0, 1200),
				edge(3, 1, 1600),
				edge(1, 3, 800),
				edge(2, 4, 1000)
			]
		},
		facilities: [
			{
				...nodes[0],
				id: 'hospital',
				name: 'Hospital',
				islandId: 'island',
				kind: 'hospital',
				verification: 'official'
			}
		],
		transit: { stops, patterns: [pattern, back], gaps: [] }
	};
	return { baseline, nodes, stops, assumptions: createDefaultAssumptions(baseline) };
}

describe('editable bus connections', () => {
	it('connects existing stops with independently routed directions and no duplicate stop capital', () => {
		const { baseline, assumptions } = fixture();
		baseline.transit.patterns = [];
		const a = {
			...assumptions,
			annualOperatingDays: 300,
			layoverMinutes: 0,
			fleetReserveShare: 0,
			displacedPassengerKm: { low: 0, central: 0, high: 0 },
			costs: {
				...assumptions.costs,
				dieselBusCapitalMvr: { low: 100000, central: 100000, high: 100000 },
				dieselOperatingMvrPerKm: { low: 10, central: 10, high: 10 }
			},
			dieselLitresPerVehicleKm: { low: 1, central: 1, high: 1 },
			dieselKgCo2ePerLitre: { low: 2, central: 2, high: 2 },
			targetMinutes: 15
		};
		const result = createBusConnection(baseline, {
			stopIds: ['stop-c', 'stop-a'],
			assumptions: a,
			headwayMinutes: 30,
			startMinutes: 420,
			endMinutes: 780
		});
		expect(result.ok).toBe(true);
		if (!result.ok || result.action.kind !== 'add-route') throw new Error('Expected connection');
		expect(result.action.stops).toEqual([]);
		expect(result.action.pattern.geometry).toEqual([
			[73.52, 4.17],
			[73.51, 4.17],
			[73.5, 4.17]
		]);
		expect(result.action.returnPattern?.geometry).toEqual([
			[73.5, 4.17],
			[73.51, 4.17],
			[73.52, 4.17]
		]);
		expect(result.action.pattern.distanceM).toBe(2000);
		expect(result.action.returnPattern?.distanceM).toBe(2000);
		const analysis = analyzePlanning(baseline, [result.action], a);
		expect(analysis.costs.newStops).toBe(0);
		// 12 departures per direction × 4 km per cycle × 300 operating days.
		expect(analysis.costs.annualVehicleKm).toBe(14400);
		expect(analysis.costs.requiredFleet).toBe(1);
		expect(analysis.costs.capitalMvr?.central).toBe(100000);
		expect(analysis.costs.annualOperatingMvr?.central).toBe(144000);
		expect(analysis.carbon.central).toBe(28800);
	});

	it('keeps an unconnected stop without transit benefits and adds it with a connection atomically', () => {
		const { baseline, assumptions, nodes } = fixture();
		baseline.transit.patterns = [];
		const proposal = createBusStopProposal(baseline, {
			coordinate: [nodes[3].lon, nodes[3].lat],
			assumptions
		});
		if (!proposal.ok || proposal.action.kind !== 'add-stop')
			throw new Error('Expected proposed stop');
		const before = analyzePlanning(baseline, [], assumptions);
		const standalone = analyzePlanning(baseline, [proposal.action], assumptions);
		expect(standalone.summary).toEqual(before.summary);
		expect(standalone.transportAccess.afterResidents).toBe(before.transportAccess.afterResidents);
		const connection = createBusConnection(baseline, {
			stopIds: [proposal.action.stop.id, 'stop-a'],
			stops: [proposal.action.stop],
			assumptions
		});
		if (!connection.ok) throw new Error(connection.reason);
		const world = derivePlanningWorld(baseline, [connection.action], assumptions);
		expect(world.stops).toHaveLength(4);
		expect(world.patterns).toHaveLength(2);
		expect(analyzePlanning(baseline, [connection.action], assumptions).costs.newStops).toBe(1);
		expect(
			createBusStopProposal(baseline, { coordinate: [nodes[0].lon, nodes[0].lat], assumptions })
		).toMatchObject({ ok: false, reason: expect.stringContaining('already exists') });
		expect(
			createBusStopProposal(baseline, { coordinate: [nodes[4].lon, nodes[4].lat], assumptions })
		).toMatchObject({ ok: false, reason: expect.stringContaining('land island') });
	});

	it('inserts an existing stop between a pair while retaining each direction and controls', () => {
		const { baseline, assumptions } = fixture();
		const result = createStopInsertion(baseline, {
			patternId: 'out',
			stopId: 'stop-c',
			afterStopId: 'stop-a',
			assumptions
		});
		if (!result.ok || result.action.kind !== 'replace-route') throw new Error('Expected insertion');
		expect(result.action.patterns[0].stopIds).toEqual(['stop-a', 'stop-c', 'stop-b']);
		expect(result.action.patterns[1].stopIds).toEqual(['stop-b', 'stop-c', 'stop-a']);
		expect(result.action.patterns[0].distanceM).toBe(2500);
		expect(result.action.patterns[1].distanceM).toBe(3000);
		const world = derivePlanningWorld(
			baseline,
			[
				result.action,
				{ kind: 'set-frequency', patternId: 'out', headwayMinutes: 12 },
				{ kind: 'set-fleet', patternId: 'out', fleet: 'electric' }
			],
			assumptions
		);
		expect(world.stops).toHaveLength(3);
		expect(world.patterns.every((pattern) => pattern.fleet === 'electric')).toBe(true);
		expect(world.patterns[0].timing).toMatchObject({ windows: [{ headwayMinutes: 12 }] });
		expect(
			createStopInsertion(baseline, {
				patternId: 'out',
				stopId: 'stop-b',
				afterStopId: 'stop-a',
				assumptions
			})
		).toMatchObject({ ok: false, reason: expect.stringContaining('already on') });
	});

	it('extends the outward end and return beginning as one action, including a provisional stop', () => {
		const { baseline, assumptions, nodes } = fixture();
		const provisional: PlanningStop = {
			...nodes[3],
			id: 'new-d',
			name: 'New D',
			islandId: 'island',
			sourceIds: [],
			mode: 'bus'
		};
		const result = createStopInsertion(baseline, {
			patternId: 'out',
			stopId: provisional.id,
			afterStopId: 'stop-b',
			stops: [provisional],
			assumptions
		});
		if (!result.ok || result.action.kind !== 'replace-route') throw new Error('Expected extension');
		expect(result.action.patterns[0].stopIds).toEqual(['stop-a', 'stop-b', 'new-d']);
		expect(result.action.patterns[1].stopIds).toEqual(['new-d', 'stop-b', 'stop-a']);
		expect(result.action.patterns.map((pattern) => pattern.distanceM)).toEqual([1800, 3100]);
		const state = new PlanningScenarioState(baseline);
		const preview = analyzePlanning(baseline, [result.action], state.assumptions!);
		state.addAction(result.action);
		expect(state.analysis).toEqual(preview);
		expect(state.undo()).toBe(true);
		expect(state.actions).toEqual([]);
		expect(state.redo()).toBe(true);
		const restored = new PlanningScenarioState(baseline);
		expect(restored.importJson(state.exportJson())).toEqual({ ok: true });
		expect(restored.analysis).toEqual(preview);
	});

	it('requires explicit frequency when replacing published timing and preserves unknown annual costs', () => {
		const { baseline, assumptions } = fixture();
		for (const pattern of baseline.transit.patterns) {
			pattern.provenance = 'observed';
			pattern.timing = {
				kind: 'scheduled',
				trips: [
					{
						id: `published-${pattern.id}`,
						stopTimes: [
							{ arrivalMinutes: 480, departureMinutes: 480 },
							{ arrivalMinutes: 490, departureMinutes: 490 }
						]
					}
				]
			};
		}
		expect(
			createStopInsertion(baseline, {
				patternId: 'out',
				stopId: 'stop-c',
				afterStopId: 'stop-b',
				assumptions
			})
		).toMatchObject({ ok: false, reason: expect.stringContaining('assumed frequency') });
		const result = createStopInsertion(baseline, {
			patternId: 'out',
			stopId: 'stop-c',
			afterStopId: 'stop-b',
			assumptions,
			headwayMinutes: 15
		});
		if (!result.ok || result.action.kind !== 'replace-route')
			throw new Error('Expected assumed extension');
		expect(result.action.patterns.every((pattern) => pattern.provenance === 'assumed')).toBe(true);
		expect(result.action.patterns[0].timing).toMatchObject({
			kind: 'frequency',
			windows: [{ headwayMinutes: 15 }]
		});
		const analysis = analyzePlanning(baseline, [result.action], assumptions);
		expect(analysis.costs.annualOperatingMvr).toBeNull();
		expect(analysis.carbon.central).toBeNull();
	});

	it('moves a shared stop and every active connection, preserving existing frequency and route identity', () => {
		const { baseline, assumptions, nodes } = fixture();
		const secondary = createBusConnection(baseline, {
			stopIds: ['stop-b', 'stop-c'],
			assumptions,
			headwayMinutes: 10
		});
		if (!secondary.ok) throw new Error(secondary.reason);
		const history: PlanningAction[] = [secondary.action];
		const original = JSON.stringify({ baseline, history });
		const moved = prepareStopMove(
			baseline,
			history,
			'stop-b',
			[nodes[3].lon, nodes[3].lat],
			assumptions,
			{ keepConnections: true, headwayMinutes: 15 }
		);
		if (!moved.ok) throw new Error(moved.reason);
		const world = derivePlanningWorld(baseline, moved.actions, assumptions);
		expect(world.patterns).toHaveLength(4);
		expect(
			world.patterns.every(
				(pattern) => pattern.enabled !== false && !pattern.runtimeUnavailableReason
			)
		).toBe(true);
		expect(world.patterns.map((pattern) => pattern.distanceM)).toEqual([1800, 1200, 2600, 1300]);
		expect(world.patterns[0].timing).toMatchObject({ windows: [{ headwayMinutes: 20 }] });
		expect(world.patterns[2].timing).toMatchObject({ windows: [{ headwayMinutes: 10 }] });
		expect(JSON.stringify({ baseline, history })).toBe(original);
		expect(validSavedActions(moved.actions)).toBe(true);
		const state = new PlanningScenarioState(baseline);
		state.replaceActions(history);
		state.clearHistory();
		const preview = analyzePlanning(baseline, moved.actions, assumptions);
		state.replaceActions(moved.actions);
		expect(state.analysis).toEqual(preview);
		expect(state.undo()).toBe(true);
		expect(state.actions).toEqual(history);
		expect(state.canUndo).toBe(false);
		expect(state.redo()).toBe(true);
		expect(state.analysis).toEqual(preview);
	});

	it('moves published connections using explicitly assumed windows and rejects missing directed paths', () => {
		const { baseline, assumptions, nodes } = fixture();
		baseline.transit.patterns[0].provenance = 'observed';
		baseline.transit.patterns[0].timing = {
			kind: 'scheduled',
			trips: [
				{
					id: 'captured',
					stopTimes: [
						{ arrivalMinutes: 480, departureMinutes: 480 },
						{ arrivalMinutes: 490, departureMinutes: 490 }
					]
				}
			]
		};
		expect(
			prepareStopMove(baseline, [], 'stop-b', [nodes[3].lon, nodes[3].lat], assumptions, {
				keepConnections: true
			})
		).toMatchObject({ ok: false });
		const moved = prepareStopMove(
			baseline,
			[],
			'stop-b',
			[nodes[3].lon, nodes[3].lat],
			assumptions,
			{ keepConnections: true, headwayMinutes: 15 }
		);
		if (!moved.ok) throw new Error(moved.reason);
		expect(derivePlanningWorld(baseline, moved.actions, assumptions).patterns[0]).toMatchObject({
			enabled: true,
			provenance: 'assumed',
			timing: {
				kind: 'frequency',
				windows: [{ startMinutes: 420, endMinutes: 1140, headwayMinutes: 15 }]
			}
		});
		const oneWay = structuredClone(baseline);
		oneWay.network.edges = oneWay.network.edges.filter((edge) => !['3-0', '3-1'].includes(edge.id));
		expect(
			prepareStopMove(oneWay, [], 'stop-b', [nodes[3].lon, nodes[3].lat], assumptions, {
				keepConnections: true,
				headwayMinutes: 15
			})
		).toMatchObject({ ok: false, reason: expect.stringContaining('directed') });
		expect(
			createBusConnection(baseline, { stopIds: ['stop-c', 'stop-c'], assumptions })
		).toMatchObject({ ok: false });
		expect(
			createBusConnection(baseline, { stopIds: ['stop-a', 'missing'], assumptions })
		).toMatchObject({ ok: false });
	});

	it('ignores an incomplete replacement without partially adding stops or changing connections', () => {
		const { baseline, assumptions, nodes } = fixture();
		const malformed: PlanningAction = {
			kind: 'replace-route',
			patternId: 'out',
			patterns: [
				{ ...structuredClone(baseline.transit.patterns[0]), stopIds: ['stop-a', 'missing'] }
			],
			stops: [{ ...nodes[3], id: 'new-stop', name: 'New stop', islandId: 'island', sourceIds: [] }]
		};
		const world = derivePlanningWorld(baseline, [malformed], assumptions);
		expect(world.stops).toEqual(baseline.transit.stops);
		expect(world.patterns).toEqual(baseline.transit.patterns);
		expect(world.warnings[0]).toContain('incomplete route replacement');
		expect(validSavedActions([{ ...malformed, patterns: [] }])).toBe(false);
		const complete = createStopInsertion(baseline, {
			patternId: 'out',
			stopId: 'stop-c',
			afterStopId: 'stop-b',
			assumptions
		});
		if (!complete.ok || complete.action.kind !== 'replace-route')
			throw new Error('Expected extension');
		const corrupt = structuredClone(complete.action);
		corrupt.patterns[0].segmentGeometry = [
			[
				[Infinity, 4.17],
				[73.5, 4.17]
			]
		];
		expect(validSavedActions([corrupt])).toBe(false);
		const stale = structuredClone(complete.action);
		stale.patterns[0].segmentDistanceM = [1000];
		expect(validSavedActions([stale])).toBe(false);
	});
});
