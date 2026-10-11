import { describe, expect, it } from 'vitest';
import { createDefaultAssumptions } from './defaults.ts';
import { analyzePlanning } from './engine.ts';
import { buildNetworkGraph, shortestPaths } from './graph.ts';
import { derivePlanningWorld } from './scenario.ts';
import {
	applyPlanningDisruptions,
	createRoadStressCases,
	disruptionIsActive,
	effectivePlanningNetwork,
	planningRoadFeatures,
	shortestDrivingPath
} from './disruptions.ts';
import { PlanningScenarioState } from './scenarioState.svelte.ts';
import { validPlanningAssumptions } from './validation.ts';
import type {
	PlanningAssumptions,
	PlanningBaseline,
	PlanningDisruption,
	PlanningServicePattern
} from './types.ts';

const range = (value: number) => ({ low: value, central: value, high: value });
function fixture(): PlanningBaseline {
	const nodes = [
		{ id: 'a', lon: 73.5, lat: 4.17 },
		{ id: 'b', lon: 73.51, lat: 4.17 },
		{ id: 'c', lon: 73.5, lat: 4.18 }
	];
	const stops = nodes.slice(0, 2).map((node) => ({
		...node,
		id: `s-${node.id}`,
		name: node.id,
		islandId: 'island',
		sourceIds: []
	}));
	const pattern = (id: string, stopIds: string[]): PlanningServicePattern => ({
		id,
		routeId: 'route',
		name: 'Route',
		mode: 'bus',
		stopIds,
		calendar: { weekdays: [0, 1, 2, 3, 4, 5, 6] },
		timing: {
			kind: 'frequency',
			windows: [{ startMinutes: 420, endMinutes: 1140, headwayMinutes: 10 }],
			segmentMinutes: [10]
		},
		provenance: 'observed',
		sourceIds: [],
		fleet: 'diesel',
		distanceM: 6000,
		segmentDistanceM: [6000]
	});
	return {
		schemaVersion: 1,
		version: 'road-test',
		generatedAt: '2026-10-11T00:00:00Z',
		referenceDate: '2026-10-11',
		sources: [],
		islands: [{ id: 'island', name: 'Island' }],
		origins: [{ ...nodes[0], id: 'origin', islandId: 'island', population2026: 100 }],
		network: {
			nodes,
			edges: [
				{
					id: 'direct',
					from: 'a',
					to: 'b',
					distanceM: 6000,
					walkAllowed: true,
					driveAllowed: true
				},
				{
					id: 'detour-1',
					from: 'a',
					to: 'c',
					distanceM: 6000,
					walkAllowed: false,
					driveAllowed: true
				},
				{
					id: 'detour-2',
					from: 'c',
					to: 'b',
					distanceM: 6000,
					walkAllowed: false,
					driveAllowed: true
				}
			]
		},
		facilities: [
			{
				...nodes[1],
				id: 'hospital',
				name: 'Hospital',
				kind: 'hospital',
				islandId: 'island',
				verification: 'official'
			}
		],
		transit: {
			stops,
			patterns: [pattern('out', ['s-a', 's-b']), pattern('back', ['s-b', 's-a'])],
			gaps: [],
			accessStatus: 'complete'
		}
	};
}
function assumptions(baseline: PlanningBaseline): PlanningAssumptions {
	return {
		...createDefaultAssumptions(baseline),
		date: '2026-10-11',
		departureMinutes: 480,
		targetMinutes: 20,
		maxJourneyMinutes: 60,
		maxAccessWalkMinutes: 1,
		maxTransferWalkMinutes: 1,
		busMovingKph: 60,
		boardingBufferMinutes: 0,
		layoverMinutes: 0,
		fleetReserveShare: 0,
		costs: { dieselBusCapitalMvr: range(1000000), dieselOperatingMvrPerKm: range(10) }
	};
}
function event(patch: Partial<PlanningDisruption> = {}): PlanningDisruption {
	return {
		id: 'event',
		name: 'Road works',
		kind: 'closure',
		edgeIds: ['direct'],
		modes: ['bus'],
		direction: 'both',
		startDate: '2026-10-11',
		endDate: '2026-10-11',
		startMinutes: 480,
		endMinutes: 540,
		provenance: 'assumed',
		...patch
	};
}

describe('directed, dated road events', () => {
	it('uses an exclusive end and correctly crosses service-day midnight', () => {
		const disruption = event({ startMinutes: 1430, endDate: '2026-10-12', endMinutes: 20 });
		expect(disruptionIsActive(disruption, '2026-10-11', 1429)).toBe(false);
		expect(disruptionIsActive(disruption, '2026-10-11', 1445)).toBe(true);
		expect(disruptionIsActive(disruption, '2026-10-12', 20)).toBe(false);
	});
	it('removes only the requested mode and direction and never opens an OSM one-way arc', () => {
		const b = fixture(),
			a = assumptions(b);
		a.disruptions = [event({ direction: 'forward' })];
		const network = effectivePlanningNetwork(b.network, a);
		const graph = buildNetworkGraph(network);
		expect(shortestDrivingPath(graph, 0, 1, 60)?.distanceM).toBe(12000);
		expect(shortestDrivingPath(graph, 1, 0, 60)?.distanceM).toBe(6000);
		expect(shortestPaths(graph, 0, 'walk').distances[1]).toBe(6000);
		b.network.edges[0].oneway = true;
		const oneWay = buildNetworkGraph(b.network);
		expect(oneWay.drive[1].some((arc) => arc.edgeId === 'direct')).toBe(false);
		expect(b.network.edges[0].driveForwardAllowed).toBeUndefined();
	});
	it('finds the faster legal detour when incremental delay exceeds its extra driving time', () => {
		const b = fixture(),
			a = assumptions(b);
		a.disruptions = [event({ kind: 'delay', delayMinutes: 10 })];
		const path = shortestDrivingPath(
			buildNetworkGraph(effectivePlanningNetwork(b.network, a)),
			0,
			1,
			60
		)!;
		expect(path.minutes).toBe(12);
		expect(path.edgeIds).toEqual(['detour-1', 'detour-2']);
		expect(planningRoadFeatures(b, a).features[0].properties).toMatchObject({
			disruptionKind: 'delay',
			extraMinutes: 10,
			provenance: 'assumed'
		});
	});
});

describe('service timing, fleet and temporary costs', () => {
	it('preserves reference runtime, adds only six detour minutes and requires four buses to retain frequency', () => {
		const b = fixture(),
			a = assumptions(b);
		a.disruptions = [event()];
		const analysis = analyzePlanning(b, [], a);
		expect(analysis.origins[0].before.minutes).toBe(15);
		expect(analysis.origins[0].after.minutes).toBe(21);
		expect(analysis.disruptionImpact?.lostAccessResidents).toBe(100);
		expect(analysis.world.patterns[0].timing).toMatchObject({ segmentMinutes: [16] });
		expect(analysis.disruptionImpact?.fleetFeedback[0]).toMatchObject({
			baselineCycleMinutes: 20,
			scenarioCycleMinutes: 32,
			baselineFleet: 2,
			requiredFleet: 4,
			baselineHeadwayMinutes: 10,
			scenarioHeadwayMinutes: 10,
			additionalFleet: 2,
			additionalCapitalMvr: range(2000000)
		});
		// Six additional km per direction × six departures during the one-hour event.
		expect(analysis.disruptionImpact?.fleetFeedback[0].eventVehicleKm).toBeCloseTo(72);
		expect(analysis.disruptionImpact?.fleetFeedback[0].eventOperatingMvr).toEqual(range(720));
		expect(analysis.costs.annualOperatingMvr).toEqual(range(0));
		expect(analysis.costs.capitalMvr).toEqual(range(0));
		expect(b.transit.patterns[0].provenance).toBe('observed');
		expect(b.transit.patterns[0].timing).toMatchObject({ segmentMinutes: [10] });
	});
	it('keeps two buses and changes headway to sixteen minutes under fixed-fleet policy', () => {
		const b = fixture(),
			a = assumptions(b);
		a.disruptions = [event()];
		a.fleetResponse = 'fixed-fleet';
		const analysis = analyzePlanning(b, [], a);
		expect(analysis.origins[0].after.minutes).toBe(24);
		expect(analysis.disruptionImpact?.fleetFeedback[0]).toMatchObject({
			baselineFleet: 2,
			requiredFleet: 2,
			additionalFleet: 0,
			scenarioHeadwayMinutes: 16
		});
	});
	it('a bus-and-walk closure causes a computed loss when no legal alternative exists', () => {
		const b = fixture(),
			a = assumptions(b);
		b.network.edges = b.network.edges.slice(0, 1);
		a.disruptions = [event({ modes: ['bus', 'walk'] })];
		const analysis = analyzePlanning(b, [], a);
		expect(analysis.origins[0].before.status).toBe('reachable');
		expect(analysis.origins[0].after.status).toBe('unreachable');
		expect(analysis.summary.lostAccessResidents).toBe(100);
		expect(analysis.disruptionImpact?.blockedPatternIds).toEqual(['out', 'back']);
		expect(analysis.disruptionImpact?.fleetFeedback[0].requiredFleet).toBeNull();
	});
	it('does not apply expired closures or confuse cached normal and stressed inputs', () => {
		const b = fixture(),
			a = assumptions(b);
		const normal = analyzePlanning(b, [], a);
		const stressed = analyzePlanning(b, [], { ...a, disruptions: [event()] });
		const expired = analyzePlanning(b, [], {
			...a,
			disruptions: [event({ endMinutes: 480, startMinutes: 420 })]
		});
		expect(normal.origins[0].after.minutes).toBe(15);
		expect(stressed.origins[0].after.minutes).toBe(21);
		expect(expired.origins[0].after.minutes).toBe(15);
		expect(analyzePlanning(b, [], a).origins[0].after).toEqual(normal.origins[0].after);
	});
	it('propagates an incremental bus delay into a missed dated ferry departure', () => {
		const b = fixture(),
			a = assumptions(b);
		b.network.edges = b.network.edges.slice(0, 1);
		const d = { id: 'd', lon: 73.52, lat: 4.18 },
			e = { id: 'e', lon: 73.5201, lat: 4.18 };
		b.network.nodes.push(d, e);
		b.network.edges.push({
			id: 'destination-path',
			from: 'd',
			to: 'e',
			distanceM: 10,
			walkAllowed: true,
			driveAllowed: false
		});
		b.islands.push({ id: 'destination-island', name: 'Destination island' });
		b.facilities[0] = { ...b.facilities[0], ...d, id: 'hospital', islandId: 'destination-island' };
		b.transit.stops.push({
			...d,
			id: 's-d',
			name: 'Arrival terminal',
			islandId: 'destination-island',
			sourceIds: [],
			mode: 'ferry'
		});
		b.transit.patterns = [
			{
				...b.transit.patterns[0],
				timing: {
					kind: 'scheduled',
					trips: [
						{
							id: 'bus-trip',
							stopTimes: [
								{ arrivalMinutes: 480, departureMinutes: 480 },
								{ arrivalMinutes: 490, departureMinutes: 490 }
							]
						}
					]
				}
			},
			{
				id: 'ferry',
				routeId: 'ferry',
				name: 'Ferry',
				mode: 'ferry',
				stopIds: ['s-b', 's-d'],
				calendar: {
					weekdays: [0, 1, 2, 3, 4, 5, 6],
					startDate: '2026-10-11',
					endDate: '2026-10-11'
				},
				provenance: 'observed',
				sourceIds: [],
				timing: {
					kind: 'scheduled',
					trips: [
						{
							id: 'first',
							stopTimes: [
								{ arrivalMinutes: 493, departureMinutes: 493 },
								{ arrivalMinutes: 500, departureMinutes: 500 }
							]
						},
						{
							id: 'next',
							stopTimes: [
								{ arrivalMinutes: 520, departureMinutes: 520 },
								{ arrivalMinutes: 527, departureMinutes: 527 }
							]
						}
					]
				}
			}
		];
		a.disruptions = [event({ kind: 'delay', delayMinutes: 5 })];
		const result = analyzePlanning(b, [], a);
		expect(result.origins[0].before.minutes).toBe(20);
		expect(result.origins[0].after.minutes).toBe(47);
		expect(result.origins[0].after.path.find((leg) => leg.mode === 'ferry')?.tripId).toBe('next');
		expect(result.disruptionImpact?.fleetFeedback[0].requiredFleet).toBeNull();
	});
	it('scheduled departures keep their own detour geometry and recover after event expiry', () => {
		const b = fixture(),
			a = assumptions(b);
		b.transit.patterns = [
			{
				...b.transit.patterns[0],
				segmentGeometry: [
					[
						[73.5, 4.17],
						[73.51, 4.17]
					]
				],
				timing: {
					kind: 'scheduled',
					trips: [480, 520].map((departure) => ({
						id: String(departure),
						stopTimes: [
							{ arrivalMinutes: departure, departureMinutes: departure },
							{ arrivalMinutes: departure + 10, departureMinutes: departure + 10 }
						]
					}))
				}
			}
		];
		a.disruptions = [event({ endMinutes: 500 })];
		const result = applyPlanningDisruptions(b, derivePlanningWorld(b, []), a);
		const timing = result.world.patterns[0].timing;
		if (timing.kind !== 'scheduled') throw new Error('Scheduled trip expected');
		expect(timing.trips[0].stopTimes[1].arrivalMinutes).toBe(496);
		expect(timing.trips[1].stopTimes[1].arrivalMinutes).toBe(530);
		expect(timing.trips[0].segmentGeometry?.[0]).toHaveLength(3);
		expect(timing.trips[1].segmentGeometry?.[0]).toHaveLength(2);
		expect(result.world.patterns[0].distanceM).toBe(12000);
	});
	it('a pure time delay does not display distance-only costs and emissions as zero', () => {
		const b = fixture(),
			a = assumptions(b);
		a.disruptions = [event({ kind: 'delay', delayMinutes: 5 })];
		const result = analyzePlanning(b, [], a);
		expect(result.disruptionImpact?.fleetFeedback[0].eventVehicleKm).toBe(0);
		expect(result.disruptionImpact?.fleetFeedback[0].eventVehicleHours).toBeGreaterThan(0);
		expect(result.disruptionImpact?.fleetFeedback[0].eventOperatingMvr).toBeNull();
		expect(result.disruptionImpact?.fleetFeedback[0].eventCarbonKgCo2e).toBeNull();
	});
	it('cached journeys reprice current financial assumptions and do not accumulate resident losses', () => {
		const b = fixture(),
			a = assumptions(b);
		a.disruptions = [event()];
		const first = analyzePlanning(b, [], a);
		const second = analyzePlanning(b, [], {
			...a,
			costs: { ...a.costs, dieselBusCapitalMvr: range(3000000), dieselOperatingMvrPerKm: range(20) }
		});
		expect(first.disruptionImpact?.fleetFeedback[0].additionalCapitalMvr).toEqual(range(2000000));
		expect(second.disruptionImpact?.fleetFeedback[0].additionalCapitalMvr).toEqual(range(6000000));
		expect(second.disruptionImpact?.fleetFeedback[0].eventOperatingMvr).toEqual(range(1440));
		expect(first.disruptionImpact?.lostAccessResidents).toBe(100);
		expect(second.disruptionImpact?.lostAccessResidents).toBe(100);
	});
});

describe('stress comparison and persistence', () => {
	it('retains every leg of a multi-stop modeled route when only its final segment detours', () => {
		const b = fixture(),
			a = assumptions(b);
		b.transit.stops.push({
			...b.network.nodes[2],
			id: 's-c',
			name: 'c',
			islandId: 'island',
			sourceIds: []
		});
		for (const [index, pattern] of b.transit.patterns.entries()) {
			pattern.stopIds = index === 0 ? ['s-a', 's-c', 's-b'] : ['s-b', 's-c', 's-a'];
			pattern.distanceM = 12000;
			pattern.segmentDistanceM = [6000, 6000];
			if (pattern.timing.kind === 'frequency') pattern.timing.segmentMinutes = [10, 10];
		}
		a.disruptions = [event({ edgeIds: ['detour-2'] })];
		const result = analyzePlanning(b, [], a),
			pattern = result.world.patterns[0];
		expect(pattern.segmentGeometry).toHaveLength(2);
		expect(pattern.geometry).toEqual([
			[73.5, 4.17],
			[73.5, 4.18],
			[73.5, 4.17],
			[73.51, 4.17]
		]);
		expect(pattern.timing).toMatchObject({ segmentMinutes: [10, 16] });
	});
	it('preserves walking horizons when a short-radius view follows a longer cached journey', () => {
		const b = fixture(),
			a = {
				...assumptions(fixture()),
				walkMPerMinute: 300,
				maxJourneyMinutes: 60,
				targetMinutes: 30
			};
		b.transit.patterns = [];
		const long = analyzePlanning(b, [], a);
		expect(long.origins[0].after.minutes).toBe(20);
		const short = analyzePlanning(b, [], { ...a, maxJourneyMinutes: 10, targetMinutes: 10 });
		expect(short.origins[0].after.status).toBe('unreachable');
		const changed = analyzePlanning(
			b,
			[{ kind: 'add-stop', stop: { ...b.transit.stops[0], id: 'unserved-stop' } }],
			a
		);
		expect(changed.origins[0].after.minutes).toBe(20);
		expect(changed.summary.newlyReachedResidents).toBe(0);
	});
	it('matches investment reserve arithmetic and reprices an edited reserve share without stale paths', () => {
		const b = fixture(),
			a = assumptions(b);
		for (const pattern of b.transit.patterns)
			if (pattern.timing.kind === 'frequency') pattern.timing.windows[0].headwayMinutes = 4;
		a.disruptions = [event()];
		a.fleetReserveShare = 0.15;
		const first = analyzePlanning(b, [], a);
		expect(first.disruptionImpact?.fleetFeedback[0]).toMatchObject({
			baselineFleet: 5,
			requiredFleet: 8,
			additionalFleet: 3,
			baselineProcurementFleet: 6,
			requiredProcurementFleet: 10,
			additionalProcurementFleet: 4,
			additionalCapitalMvr: range(4000000)
		});
		const edited = analyzePlanning(b, [], { ...a, fleetReserveShare: 0 });
		expect(edited.disruptionImpact?.fleetFeedback[0]).toMatchObject({
			baselineProcurementFleet: 5,
			requiredProcurementFleet: 8,
			additionalProcurementFleet: 3,
			additionalCapitalMvr: range(3000000)
		});
	});
	it('does not infer a vehicle duty from multiple branched circulations sharing a route ID', () => {
		const b = fixture(),
			a = assumptions(b);
		b.transit.patterns.push(
			...b.transit.patterns.map((pattern) => ({
				...structuredClone(pattern),
				id: `${pattern.id}-branch`
			}))
		);
		a.disruptions = [event()];
		const result = analyzePlanning(b, [], a);
		expect(result.disruptionImpact?.fleetFeedback[0].additionalFleet).toBeNull();
		expect(result.disruptionImpact?.fleetFeedback[0].eventOperatingMvr).toBeNull();
	});
	it('leaves unresolved road effects explicitly unavailable instead of claiming no impact', () => {
		const b = fixture(),
			a = assumptions(b);
		b.transit.stops[1].lon = 73.8;
		a.disruptions = [event()];
		const original = derivePlanningWorld(b, [], a);
		const disrupted = applyPlanningDisruptions(b, original, a);
		expect(
			disrupted.world.warnings.some((warning) =>
				warning.includes('Road-event effects are unavailable')
			)
		).toBe(true);
		expect(disrupted.world.patterns[0].timing).toEqual(original.patterns[0].timing);
		expect(disrupted.impact.affectedPatternIds).toEqual([]);
	});
	it('evaluates normal and stress cases through the same model and keeps counts pinned', () => {
		const b = fixture(),
			a = assumptions(b);
		a.robustnessStresses = createRoadStressCases(['direct'], a);
		const result = analyzePlanning(b, [], a);
		expect(result.robustness?.normal.scenarioReachableResidents).toBe(100);
		expect(result.robustness?.stresses.map((stress) => stress.scenarioReachableResidents)).toEqual([
			100, 0
		]);
		expect(result.robustness?.worstReachableResidents).toBe(0);
		expect(result.origins[0].after.minutes).toBe(15);
	});
	it('a frequency investment gains access against the same stressed baseline', () => {
		const b = fixture(),
			a = assumptions(b);
		a.robustnessStresses = createRoadStressCases(['direct'], a);
		const result = analyzePlanning(
			b,
			[{ kind: 'set-frequency', patternId: 'out', headwayMinutes: 5 }],
			a
		);
		expect(result.robustness?.normal.scenarioReachableResidents).toBe(100);
		expect(result.robustness?.stresses[1]).toMatchObject({
			baselineReachableResidents: 0,
			scenarioReachableResidents: 100,
			gainedResidents: 100,
			retainedAccessResidents: 100
		});
		expect(result.robustness?.worstReachableResidents).toBe(100);
	});
	it('saves, imports, undoes and redoes events and fleet response without changing the baseline', () => {
		const b = fixture(),
			state = new PlanningScenarioState(b);
		state.setAssumptions({
			...assumptions(b),
			disruptions: [event()],
			fleetResponse: 'fixed-fleet'
		});
		const copy = new PlanningScenarioState(b);
		expect(copy.importJson(state.exportJson())).toEqual({ ok: true });
		expect(copy.analysis.origins[0].after.minutes).toBe(24);
		state.undo();
		expect(state.assumptions.disruptions).toBeUndefined();
		state.redo();
		expect(state.analysis.origins[0].after.minutes).toBe(24);
		expect(validPlanningAssumptions({ ...assumptions(b), disruptions: [event()] })).toBe(true);
		expect(
			validPlanningAssumptions({ ...assumptions(b), disruptions: [event({ endMinutes: 470 })] })
		).toBe(false);
		expect(
			validPlanningAssumptions({
				...assumptions(b),
				disruptions: [event({ kind: 'delay', delayMinutes: 5, modes: ['walk'] })]
			})
		).toBe(false);
		const repeatedStress = createRoadStressCases(['direct'], assumptions(b))[0];
		expect(
			validPlanningAssumptions({
				...assumptions(b),
				robustnessStresses: [repeatedStress, repeatedStress]
			})
		).toBe(false);
	});
	it('helper produces immutable source-pinned normal world before stress application', () => {
		const b = fixture(),
			a = assumptions(b);
		a.disruptions = [event()];
		const original = derivePlanningWorld(b, [], a);
		const disrupted = applyPlanningDisruptions(b, original, a);
		expect(original.patterns[0].timing).toMatchObject({ segmentMinutes: [10] });
		expect(disrupted.world.patterns[0].timing).toMatchObject({ segmentMinutes: [16] });
	});
});
