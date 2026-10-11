import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAssumptions, PLANNING_MODEL_VERSION } from './defaults.ts';
import { analyzePlanning } from './engine.ts';
import { isEligibleFacility } from './facilities.ts';
import { buildNetworkGraph, nearestGraphNode, pathCoordinates, shortestPaths } from './graph.ts';
import { createBusProposal } from './proposals.ts';
import { calendarRuns } from './routing.ts';
import { derivePlanningWorld } from './scenario.ts';
import {
	PLANNING_ARCHIVE_PREFIX,
	PLANNING_LAST_ARCHIVE_KEY,
	PLANNING_STORAGE_KEY,
	PlanningScenarioState
} from './scenarioState.svelte.ts';
import type {
	PlanningAction,
	PlanningAssumptions,
	PlanningBaseline,
	PlanningServicePattern,
	PlanningStop
} from './types.ts';
import { AnalysisWorkerClient, SupersededPlanningRequest } from './workerClient.ts';

const range = (central: number) => ({ low: central * 0.8, central, high: central * 1.2 });
function memoryStorage(): Storage {
	const values = new Map<string, string>();
	return {
		get length() {
			return values.size;
		},
		clear: () => values.clear(),
		getItem: (key) => values.get(key) ?? null,
		key: (index) => [...values.keys()][index] ?? null,
		removeItem: (key) => {
			values.delete(key);
		},
		setItem: (key, value) => {
			values.set(key, value);
		}
	};
}
function fixture(count = 2, edgeM = 6000): PlanningBaseline {
	const nodes = Array.from({ length: count }, (_, i) => ({
		id: `n${i}`,
		lon: 73.5 + i * 0.01,
		lat: 4.17
	}));
	return {
		schemaVersion: 1,
		version: 'test-1',
		generatedAt: '2026-10-10T00:00:00Z',
		referenceDate: '2026-10-10',
		sources: [],
		islands: [{ id: 'island', name: 'Island' }],
		origins: [
			{ ...nodes[0], id: 'origin', islandId: 'island', population2026: 100, population2030: 120 }
		],
		network: {
			nodes,
			edges: nodes.slice(1).map((n, i) => ({
				id: `edge${i}`,
				from: nodes[i].id,
				to: n.id,
				distanceM: edgeM,
				walkAllowed: true,
				driveAllowed: true
			}))
		},
		facilities: [
			{
				...nodes.at(-1)!,
				id: 'hospital',
				name: 'Hospital',
				islandId: 'island',
				kind: 'hospital',
				verification: 'official'
			}
		],
		transit: {
			stops: nodes.map((n, i) => ({
				...n,
				id: `s${i}`,
				name: `Stop ${i}`,
				islandId: 'island',
				sourceIds: []
			})),
			patterns: [],
			gaps: [],
			accessStatus: 'complete'
		}
	};
}
function bus(
	stopIds = ['s0', 's1'],
	segmentMinutes = [10],
	id = 'bus-out'
): PlanningServicePattern {
	return {
		id,
		routeId: id,
		name: id,
		mode: 'bus',
		stopIds,
		calendar: { weekdays: [0, 1, 2, 3, 4, 5, 6] },
		timing: {
			kind: 'frequency',
			windows: [{ startMinutes: 420, endMinutes: 1140, headwayMinutes: 10 }],
			segmentMinutes
		},
		provenance: 'observed',
		sourceIds: [],
		fleet: 'diesel',
		distanceM: 1000
	};
}
function assumptions(b: PlanningBaseline): PlanningAssumptions {
	return {
		...createDefaultAssumptions(b),
		costs: {
			stopCapitalMvr: range(250_000),
			dieselBusCapitalMvr: range(2_300_000),
			electricBusCapitalMvr: range(3_600_000),
			chargingInfrastructureMvr: range(600_000),
			dieselOperatingMvrPerKm: range(36),
			electricOperatingMvrPerKm: range(30),
			dieselKgCo2ePerKm: range(1),
			electricKgCo2ePerKm: range(0.8),
			displacedKgCo2ePerPassengerKm: range(0.12)
		}
	};
}
function journey(b: PlanningBaseline, a = assumptions(b), actions: PlanningAction[] = []) {
	return analyzePlanning(structuredClone(b), actions, a).origins[0].after;
}

describe('service-aware transport routing', () => {
	it('a standalone stop cannot grant access without service', () => {
		const b = fixture();
		const added: PlanningStop = { ...b.origins[0], id: 'extra', name: 'Extra', sourceIds: [] };
		const analysis = analyzePlanning(b, [{ kind: 'add-stop', stop: added }], assumptions(b));
		expect(analysis.origins[0].before.status).toBe('unreachable');
		expect(analysis.origins[0].after).toEqual(analysis.origins[0].before);
		expect(analysis.summary.newlyReachedResidents).toBe(0);
	});
	it('one boarding incurs one half-headway, through multiple directed segments', () => {
		const b = fixture(3);
		b.transit.patterns = [bus(['s0', 's1', 's2'], [5, 5])];
		const result = journey(b);
		expect(result.minutes).toBe(15);
		expect(result.path.filter((l) => l.mode === 'bus')).toMatchObject([
			{ from: 's0', to: 's2', minutes: 10, waitMinutes: 5 }
		]);
		b.origins = [{ ...b.origins[0], ...b.network.nodes[2], id: 'origin' }];
		b.facilities[0] = { ...b.facilities[0], ...b.network.nodes[0], id: 'hospital' };
		expect(journey(b).status).toBe('unreachable');
	});
	it('calendar dates, exceptions and downstream service windows constrain boarding', () => {
		expect(
			calendarRuns(
				{ weekdays: [6], excludedDates: ['2026-10-10'], includedDates: ['2026-10-10'] },
				'2026-10-10'
			)
		).toBe(false);
		expect(calendarRuns({ weekdays: [], includedDates: ['2026-10-10'] }, '2026-10-10')).toBe(true);
		expect(calendarRuns({ weekdays: [6] }, '2026-10-11')).toBe(false);
		const b = fixture(3);
		const p = bus(['s0', 's1', 's2'], [20, 5]);
		p.timing = {
			kind: 'frequency',
			windows: [{ startMinutes: 480, endMinutes: 490, headwayMinutes: 10 }],
			segmentMinutes: [20, 5]
		};
		b.transit.patterns = [p];
		b.origins[0] = { ...b.origins[0], ...b.network.nodes[1], id: 'origin' };
		expect(journey(b, { ...assumptions(b), departureMinutes: 500 }).minutes).toBe(10);
		p.calendar = { weekdays: [1] };
		expect(journey(b).status).toBe('unreachable');
	});
	it('never invents a ferry crossing; uses exact events and selects an overtaking trip', () => {
		const b = fixture(4, 100);
		b.network.edges = [b.network.edges[0], b.network.edges[2]];
		b.facilities[0] = { ...b.facilities[0], ...b.network.nodes[2], id: 'hospital' };
		expect(journey(b).status).toBe('unreachable');
		const ferry: PlanningServicePattern = {
			...bus(['s0', 's2']),
			mode: 'ferry',
			timing: {
				kind: 'scheduled',
				trips: [
					{
						id: 'slow',
						stopTimes: [
							{ arrivalMinutes: 485, departureMinutes: 485 },
							{ arrivalMinutes: 505, departureMinutes: 505 }
						]
					},
					{
						id: 'fast',
						stopTimes: [
							{ arrivalMinutes: 490, departureMinutes: 490 },
							{ arrivalMinutes: 492, departureMinutes: 492 }
						]
					}
				]
			}
		};
		b.transit.patterns = [ferry];
		expect(journey(b).minutes).toBe(12);
		expect(journey(b).path.find((l) => l.mode === 'ferry')?.tripId).toBe('fast');
		expect(journey(b, { ...assumptions(b), departureMinutes: 491 }).status).toBe('unreachable');
	});
	it('permits two transfers and rejects a third', () => {
		const b = fixture(5);
		b.transit.patterns = [0, 1, 2, 3].map((i) => bus([`s${i}`, `s${i + 1}`], [3], `line${i}`));
		b.facilities[0] = { ...b.facilities[0], ...b.network.nodes[3], id: 'hospital' };
		expect(journey(b).path.filter((l) => l.mode === 'bus')).toHaveLength(3);
		b.facilities[0] = { ...b.facilities[0], ...b.network.nodes[4], id: 'hospital' };
		expect(journey(b).status).toBe('unreachable');
	});
	it('closing a boarding stop removes its benefit but permits riding through a closed stop', () => {
		const b = fixture(3);
		b.transit.patterns = [bus(['s0', 's1', 's2'], [5, 5])];
		expect(journey(b, assumptions(b), [{ kind: 'disable-stop', stopId: 's0' }]).status).toBe(
			'unreachable'
		);
		expect(journey(b, assumptions(b), [{ kind: 'disable-stop', stopId: 's1' }]).minutes).toBe(15);
		expect(
			journey(b, assumptions(b), [{ kind: 'disable-service', patternId: 'bus-out' }]).status
		).toBe('unreachable');
		expect(
			journey(b, assumptions(b), [
				{ kind: 'disable-stop', stopId: 's0' },
				{ kind: 'enable-stop', stopId: 's0' }
			]).minutes
		).toBe(15);
	});
	it('keeps drop-off stops usable for arrival and through rides but excludes boarding and spatial access', () => {
		const b = fixture(3);
		b.transit.stops[1].pickupAllowed = false;
		b.transit.patterns = [bus(['s0', 's1', 's2'], [5, 5])];
		expect(journey(b).minutes).toBe(15);
		const arriving = structuredClone(b);
		arriving.facilities[0] = {
			...arriving.facilities[0],
			...arriving.network.nodes[1],
			id: 'hospital'
		};
		expect(journey(arriving)).toMatchObject({ status: 'reachable', minutes: 10 });
		const boarding = structuredClone(b);
		boarding.origins[0] = { ...boarding.origins[0], ...boarding.network.nodes[1], id: 'origin' };
		const result = analyzePlanning(boarding, [], assumptions(boarding));
		expect(result.origins[0].after.status).toBe('unreachable');
		expect(result.transportAccess.afterResidents).toBe(0);
	});
	it('preserves a published pickup restriction when an imported proposal repeats its stop ID', () => {
		const b = fixture();
		b.transit.stops[0].pickupAllowed = false;
		const action: PlanningAction = {
			kind: 'add-route',
			pattern: bus(),
			stops: [{ ...b.transit.stops[0], pickupAllowed: true }]
		};
		const store = new PlanningScenarioState(b);
		store.addAction(action);
		const restored = new PlanningScenarioState(b);
		expect(restored.importJson(store.exportJson())).toEqual({ ok: true });
		expect(restored.analysis.world.stops.find((s) => s.id === 's0')?.pickupAllowed).toBe(false);
		expect(restored.analysis.origins[0].after.status).toBe('unreachable');
		const malformed = JSON.parse(store.exportJson());
		malformed.actions[0].stops[0].pickupAllowed = 'yes';
		expect(restored.importJson(JSON.stringify(malformed)).ok).toBe(false);
	});
	it('reports missing topology or unverified destinations as unavailable rather than zero', () => {
		const b = fixture();
		b.facilities[0].verification = false;
		expect(journey(b)).toMatchObject({ status: 'unavailable', minutes: null, destinationId: null });
		b.facilities[0].verification = 'official';
		b.origins[0].lat = 0;
		expect(journey(b).reason).toContain('Origin could not');
	});
	it.each(['closed', 'relocated', 'unverified'] as const)(
		'excludes an explicitly %s healthcare facility from access and new proposals',
		(operatingStatus) => {
			const b = fixture(2, 800);
			b.facilities[0] = {
				...b.facilities[0],
				operatingStatus,
				statusReviewedAt: '2026-10-10',
				statusSourceIds: ['health-audit']
			};
			expect(journey(b)).toMatchObject({
				status: 'unavailable',
				destinationId: null,
				minutes: null
			});
			expect(createBusProposal(b, { originId: 'origin' }).ok).toBe(false);
		}
	);
	it('passes a closed nearer clinic to the evidenced open hospital in routing and proposal generation', () => {
		const b = fixture(3, 800);
		const hospital = {
			...b.facilities[0],
			operatingStatus: 'open' as const,
			statusReviewedAt: '2026-10-10',
			statusSourceIds: ['health-audit']
		};
		b.facilities = [
			{
				...hospital,
				...b.network.nodes[1],
				id: 'closed-clinic',
				name: 'Closed clinic',
				kind: 'clinic',
				operatingStatus: 'closed'
			},
			hospital
		];
		expect(journey(b)).toMatchObject({
			status: 'reachable',
			destinationId: 'hospital',
			minutes: 20
		});
		const proposal = createBusProposal(b, { originId: 'origin' });
		expect(proposal.ok).toBe(true);
		if (proposal.ok && proposal.action.kind === 'add-route') {
			const action = proposal.action;
			expect(action.pattern.stopIds.at(-1)).toContain('hospital');
			expect(action.stops?.find((s) => s.id === action.pattern.stopIds.at(-1))?.name).toContain(
				'Hospital'
			);
		}
	});
	it('requires operating evidence for explicit open status while retaining legacy school policy', () => {
		const f = fixture().facilities[0];
		const open = {
			...f,
			operatingStatus: 'open' as const,
			statusReviewedAt: '2026-10-10',
			statusSourceIds: ['health-audit']
		};
		expect(isEligibleFacility(open, 'healthcare', '2030-10-10')).toBe(true);
		expect(isEligibleFacility({ ...open, statusReviewedAt: '2026-02-30' }, 'healthcare')).toBe(
			false
		);
		expect(isEligibleFacility({ ...open, statusSourceIds: [] }, 'healthcare')).toBe(false);
		expect(isEligibleFacility({ ...open, verification: false }, 'healthcare')).toBe(false);
		expect(isEligibleFacility({ ...open, lon: NaN }, 'healthcare')).toBe(false);
		expect(isEligibleFacility({ ...f, kind: 'school' }, 'education')).toBe(true);
		expect(isEligibleFacility({ ...f, kind: 'school' }, 'healthcare')).toBe(false);
	});
	it('keeps tertiary institutions in the catalogue without counting them as school destinations', () => {
		const b = fixture(2, 800);
		b.facilities[0].kind = 'college';
		const assumptions = { ...createDefaultAssumptions(b), goal: 'education' as const };
		expect(isEligibleFacility(b.facilities[0], 'education')).toBe(false);
		expect(analyzePlanning(b, [], assumptions).origins[0].after).toMatchObject({
			status: 'unavailable',
			destinationId: null
		});
		expect(createBusProposal(b, { originId: 'origin', assumptions }).ok).toBe(false);
		const schoolBaseline = structuredClone(b);
		schoolBaseline.facilities[0].kind = 'school';
		expect(analyzePlanning(schoolBaseline, [], assumptions).origins[0].after).toMatchObject({
			status: 'reachable',
			destinationId: 'hospital',
			minutes: 10
		});
	});
	it.each(['specialist', 'restricted', 'unverified'] as const)(
		'excludes evidenced open %s care from the general healthcare goal',
		(careScope) => {
			const b = fixture(2, 800);
			b.facilities[0] = {
				...b.facilities[0],
				careScope,
				operatingStatus: 'open',
				statusReviewedAt: '2026-10-10',
				statusSourceIds: ['health-audit']
			};
			expect(journey(b)).toMatchObject({ status: 'unavailable', destinationId: null });
			expect(createBusProposal(b, { originId: 'origin' }).ok).toBe(false);
		}
	);
	it('does not treat incomplete local destination/crossing coverage as proven deprivation', () => {
		const b = fixture(4, 100);
		b.network.edges = [b.network.edges[0], b.network.edges[2]];
		b.origins[0].islandId = 'unmapped-island';
		expect(journey(b)).toMatchObject({
			status: 'unavailable',
			reason: expect.stringContaining('Local destination coverage incomplete')
		});
	});
	it('obeys driving oneway while allowing walking against motor traffic', () => {
		const b = fixture();
		b.network.edges[0].oneway = true;
		const graph = buildNetworkGraph(b.network);
		expect(shortestPaths(graph, 1, 'drive').distances[0]).toBe(Infinity);
		expect(shortestPaths(graph, 1, 'walk').distances[0]).toBe(6000);
		expect(nearestGraphNode(graph, b.network.nodes[1], 'drive', 100)?.index).toBe(1);
	});
	it('preserves curved OSM edge geometry in both directions', () => {
		const b = fixture();
		const curve: [number, number][] = [
			[73.5, 4.17],
			[73.505, 4.175],
			[73.51, 4.17]
		];
		b.network.edges[0].geometry = curve;
		const graph = buildNetworkGraph(b.network);
		expect(pathCoordinates(graph, shortestPaths(graph, 0, 'walk'), 1)).toEqual(curve);
		expect(pathCoordinates(graph, shortestPaths(graph, 1, 'walk'), 0)).toEqual(
			[...curve].reverse()
		);
	});
	it('SDG spatial coverage uses unique origins and network distance to served stops', () => {
		const b = fixture();
		b.transit.stops[1] = { ...b.transit.stops[0], id: 'duplicate', name: 'Nearby second stop' };
		b.transit.stops.push({ ...fixture().transit.stops[1], id: 's1' });
		b.transit.patterns = [bus(['s0', 'duplicate', 's1'], [1, 10])];
		const result = analyzePlanning(b, [], assumptions(b));
		expect(result.transportAccess.beforeResidents).toBe(100);
		expect(result.transportAccess.beforePct).toBe(100);
		const closed = analyzePlanning(
			b,
			[{ kind: 'disable-service', patternId: 'bus-out' }],
			assumptions(b)
		);
		expect(closed.transportAccess.afterResidents).toBe(0);
		expect(closed.transportAccess.lostResidents).toBe(100);
		const restored = analyzePlanning(
			b,
			[
				{ kind: 'disable-service', patternId: 'bus-out' },
				{ kind: 'enable-service', patternId: 'bus-out' }
			],
			assumptions(b)
		);
		expect(restored.transportAccess.afterResidents).toBe(100);
	});
	it('creates reproducible OSM-routed bus proposals and rejects disconnected islands', () => {
		const b = fixture();
		const proposal = createBusProposal(b, { originId: 'origin' });
		expect(proposal.ok).toBe(true);
		if (proposal.ok && proposal.action.kind === 'add-route') {
			expect(proposal.action.pattern.geometry).toEqual([
				[73.5, 4.17],
				[73.51, 4.17]
			]);
			expect(proposal.action.returnPattern?.distanceM).toBe(6000);
			expect(proposal).toEqual(createBusProposal(b, { originId: 'origin' }));
		}
		const disconnected = fixture(4, 100);
		disconnected.network.edges = [disconnected.network.edges[0], disconnected.network.edges[2]];
		expect(createBusProposal(disconnected, { originId: 'origin' }).ok).toBe(false);
	});
	it('extends both directions in one replayable action and refuses a missing return road', () => {
		const b = fixture(3);
		const p = bus();
		p.provenance = 'assumed';
		p.geometry = [
			[73.5, 4.17],
			[73.51, 4.17]
		];
		p.segmentGeometry = [p.geometry];
		b.transit.patterns = [
			p,
			{
				...p,
				id: 'bus-back',
				stopIds: ['s1', 's0'],
				geometry: [...p.geometry].reverse(),
				segmentGeometry: [[...p.geometry].reverse()]
			}
		];
		const coordinate: [number, number] = [b.network.nodes[2].lon, b.network.nodes[2].lat];
		const proposal = createBusProposal(b, { originId: 'origin', patternId: p.id, coordinate });
		expect(proposal.ok).toBe(true);
		if (proposal.ok && proposal.action.kind === 'extend-route') {
			const world = derivePlanningWorld(b, [proposal.action]);
			expect(world.patterns[0].stopIds.at(-1)).toBe(proposal.action.stop.id);
			expect(world.patterns[1].stopIds[0]).toBe(proposal.action.stop.id);
			expect(world.patterns.map((p) => p.distanceM)).toEqual([7000, 7000]);
			expect(world.patterns.map((p) => p.segmentGeometry?.length)).toEqual([2, 2]);
			expect(world.patterns[1].geometry?.[0]).toEqual(coordinate);
		}
		const oneWay = structuredClone(b);
		oneWay.network.edges[1].oneway = true;
		expect(
			createBusProposal(oneWay, { originId: 'origin', patternId: p.id, coordinate })
		).toMatchObject({ ok: false, reason: expect.stringContaining('return path') });
	});
});

describe('incremental cost and carbon assumptions', () => {
	function newService() {
		const b = fixture();
		b.transit.stops = [];
		const p = bus();
		p.provenance = 'assumed';
		const action: PlanningAction = {
			kind: 'add-route',
			pattern: p,
			returnPattern: { ...p, id: 'bus-back', stopIds: ['s1', 's0'] },
			stops: fixture().transit.stops
		};
		return { b, action };
	}
	it('keeps capital, annual operation, vehicle activity and fleet separate', () => {
		const { b, action } = newService();
		const result = analyzePlanning(b, [action], assumptions(b));
		expect(result.costs.annualVehicleKm).toBe(43_200);
		expect(result.costs.requiredFleet).toBe(4);
		expect(result.costs.newStops).toBe(2);
		expect(result.costs.capitalMvr?.central).toBe(2 * 250_000 + 4 * 2_300_000);
		expect(result.costs.annualOperatingMvr?.central).toBe(43_200 * 36);
		expect(result.carbon.central).toBe(43_200);
		expect(result.carbon.breakEvenDisplacedPassengerKm).toBe(360_000);
	});
	it('can show either more or less emissions without inferring mode shift from access', () => {
		const { b, action } = newService();
		const a = assumptions(b);
		expect(analyzePlanning(b, [action], a).carbon.central).toBeGreaterThan(0);
		a.displacedPassengerKm = range(1_000_000);
		expect(analyzePlanning(b, [action], a).carbon.central).toBeLessThan(0);
		expect(analyzePlanning(b, [], a).carbon.central).toBe(0);
		expect(
			analyzePlanning(b, [{ kind: 'add-stop', stop: fixture().transit.stops[0] }], a).carbon.central
		).toBe(0);
	});
	it('applies a shared factor to increased frequency kilometres', () => {
		const b = fixture();
		b.transit.patterns = [bus(), { ...bus(), id: 'bus-back', stopIds: ['s1', 's0'] }];
		const result = analyzePlanning(
			b,
			[{ kind: 'set-frequency', patternId: 'bus-out', headwayMinutes: 5 }],
			assumptions(b)
		);
		expect(result.costs.annualOperatingMvr).toEqual({
			low: 43_200 * 28.8,
			central: 43_200 * 36,
			high: 43_200 * 43.199999999999996
		});
		expect(result.carbon.low).toBeGreaterThan(0);
	});
	it('electric energy and a high grid factor can increase carbon; charging is separate capital', () => {
		const b = fixture();
		b.transit.patterns = [bus(), { ...bus(), id: 'bus-back', stopIds: ['s1', 's0'] }];
		const a = assumptions(b);
		a.electricKwhPerVehicleKm = range(1.5);
		a.gridKgCo2ePerKwh = range(1);
		const result = analyzePlanning(
			b,
			[{ kind: 'set-fleet', patternId: 'bus-out', fleet: 'electric' }],
			a
		);
		expect(result.carbon.central).toBeGreaterThan(0);
		expect(result.costs.capitalMvr?.central).toBe(
			result.costs.requiredFleet! * 3_600_000 + 600_000
		);
	});
	it('unknown route distances and partial scheduled fleet changes are unavailable, never free', () => {
		const b = fixture();
		const p = bus();
		delete p.distanceM;
		p.timing = {
			kind: 'scheduled',
			trips: [
				{
					id: 't',
					stopTimes: [
						{ arrivalMinutes: 485, departureMinutes: 485 },
						{ arrivalMinutes: 495, departureMinutes: 495 }
					]
				}
			]
		};
		b.transit.patterns = [p];
		const result = analyzePlanning(
			b,
			[{ kind: 'set-fleet', patternId: p.id, fleet: 'electric' }],
			assumptions(b)
		);
		expect(result.costs.capitalMvr).toBeNull();
		expect(result.costs.annualOperatingMvr).toBeNull();
		expect(result.carbon.central).toBeNull();
		expect(result.costs.annualVehicleKm).toBeNull();
		expect(result.costs.requiredFleet).toBeNull();
		expect(result.costs.unavailableReasons.join(' ')).toContain('baseline');
	});
	it('missing financial/carbon assumptions return null with reasons', () => {
		const { b, action } = newService();
		const result = analyzePlanning(b, [action], createDefaultAssumptions(b));
		expect(result.costs.capitalMvr).toBeNull();
		expect(result.costs.annualOperatingMvr).toBeNull();
		expect(result.carbon.central).toBeNull();
		expect(result.costs.unavailableReasons.length).toBeGreaterThan(0);
	});
	it('a ferry intervention cannot appear free in a bus-specific cost model', () => {
		const b = fixture();
		const p = bus();
		p.mode = 'ferry';
		const result = analyzePlanning(b, [{ kind: 'add-route', pattern: p }], assumptions(b));
		expect(result.costs.capitalMvr).toBeNull();
		expect(result.costs.annualOperatingMvr).toBeNull();
		expect(result.carbon.central).toBeNull();
		expect(result.costs.unavailableReasons.join(' ')).toContain('Ferry');
	});
});

describe('scenario reproducibility', () => {
	it('uses the identical pure computation for preview, commit, undo and redo', () => {
		const b = fixture();
		const before = JSON.stringify(b);
		const store = new PlanningScenarioState(b);
		const draft: PlanningAction = { kind: 'add-route', pattern: bus() };
		const preview = analyzePlanning(b, [...store.actions, draft], store.assumptions);
		store.addAction(draft);
		expect(store.analysis).toEqual(preview);
		expect(JSON.stringify(b)).toBe(before);
		store.undo();
		expect(store.analysis.origins[0].after.status).toBe('unreachable');
		store.redo();
		expect(store.analysis).toEqual(preview);
		store.replaceActions([]);
		expect(store.actions).toEqual([]);
		store.undo();
		expect(store.analysis).toEqual(preview);
	});
	it('pins saved scenarios to dataset/model and rejects malformed nested actions', () => {
		const b = fixture();
		const store = new PlanningScenarioState(b);
		store.addAction({ kind: 'add-route', pattern: bus() });
		const restored = new PlanningScenarioState(b);
		expect(restored.importJson(store.exportJson())).toEqual({ ok: true });
		expect(restored.analysis).toEqual(store.analysis);
		const changed = JSON.parse(store.exportJson());
		changed.datasetVersion = 'different';
		expect(restored.importJson(JSON.stringify(changed)).ok).toBe(false);
		changed.datasetVersion = b.version;
		changed.modelVersion = 'service-graph-1.0.0';
		expect(restored.importJson(JSON.stringify(changed)).ok).toBe(false);
		changed.modelVersion = PLANNING_MODEL_VERSION;
		changed.actions = [{ kind: 'add-route', pattern: {} }];
		expect(restored.importJson(JSON.stringify(changed)).ok).toBe(false);
		changed.actions = [];
		changed.assumptions.walkMPerMinute = -1;
		expect(restored.importJson(JSON.stringify(changed)).ok).toBe(false);
		changed.assumptions = assumptions(b);
		changed.actions = [
			{ kind: 'add-route', pattern: { ...bus(), calendar: { weekdays: [], includedDates: 5 } } }
		];
		expect(restored.importJson(JSON.stringify(changed)).ok).toBe(false);
		changed.actions = [];
		changed.assumptions.date = '2026-02-30';
		expect(restored.importJson(JSON.stringify(changed)).ok).toBe(false);
	});
	it('rejects a stale saved proposal and archives its exact bytes before new-version autosave', () => {
		const b = fixture();
		const storage = memoryStorage();
		const old = new PlanningScenarioState(b);
		old.addAction({ kind: 'add-route', pattern: bus() });
		expect(old.save(storage)).toEqual({ ok: true });
		const json = old.exportJson();
		const fresh = new PlanningScenarioState({ ...b, version: 'test-facility-audit-v2' });
		const load = fresh.load(storage);
		expect(load.ok).toBe(false);
		if (!load.ok) expect(load.reason).toContain('preserved');
		expect(fresh.actions).toEqual([]);
		expect(fresh.archivedProposalJson).toBe(json);
		const archiveKey = Array.from({ length: storage.length }, (_, i) => storage.key(i)!).find(
			(key) => key.startsWith(PLANNING_ARCHIVE_PREFIX)
		)!;
		expect(storage.getItem(archiveKey)).toBe(json);
		expect(fresh.save(storage)).toEqual({ ok: true });
		expect(storage.getItem(PLANNING_STORAGE_KEY)).toBe(fresh.exportJson());
		expect(storage.getItem(archiveKey)).toBe(json);
		expect(storage.length).toBe(3);
		expect(fresh.archivedProposalJson).toBe(json);
		const reloaded = new PlanningScenarioState(fresh.baseline);
		expect(reloaded.load(storage)).toEqual({ ok: true });
		expect(reloaded.archivedProposalJson).toBe(json);
		expect(reloaded.actions).toEqual([]);
	});
	it('ignores missing, unrelated or unreadable recovery pointers without changing the current proposal', () => {
		const b = fixture();
		const storage = memoryStorage();
		const original = new PlanningScenarioState(b).exportJson();
		storage.setItem(PLANNING_STORAGE_KEY, original);
		storage.setItem(PLANNING_LAST_ARCHIVE_KEY, `${PLANNING_ARCHIVE_PREFIX}missing`);
		const missing = new PlanningScenarioState(b);
		expect(missing.load(storage)).toEqual({ ok: true });
		expect(missing.archivedProposalJson).toBeNull();
		expect(storage.getItem(PLANNING_LAST_ARCHIVE_KEY)).toBe(`${PLANNING_ARCHIVE_PREFIX}missing`);
		storage.setItem(PLANNING_LAST_ARCHIVE_KEY, PLANNING_STORAGE_KEY);
		const unrelated = new PlanningScenarioState(b);
		expect(unrelated.load(storage)).toEqual({ ok: true });
		expect(unrelated.archivedProposalJson).toBeNull();
		expect(storage.getItem(PLANNING_STORAGE_KEY)).toBe(original);
		const read = storage.getItem.bind(storage);
		storage.getItem = (key) => {
			if (key === PLANNING_LAST_ARCHIVE_KEY) throw new Error('Recovery pointer unreadable');
			return read(key);
		};
		const unreadable = new PlanningScenarioState(b);
		expect(unreadable.load(storage)).toEqual({ ok: true });
		expect(unreadable.archivedProposalJson).toBeNull();
		expect(storage.getItem(PLANNING_STORAGE_KEY)).toBe(original);
	});
	it('preserves distinct stale proposals sharing a version and refuses overwrite if archive storage fails', () => {
		const b = fixture();
		const storage = memoryStorage();
		const old = new PlanningScenarioState(b);
		const first = old.exportJson();
		storage.setItem(PLANNING_STORAGE_KEY, first);
		const fresh = new PlanningScenarioState({ ...b, version: 'new-audit' });
		expect(fresh.save(storage).ok).toBe(true);
		old.addAction({ kind: 'add-route', pattern: bus() });
		const second = old.exportJson();
		storage.setItem(PLANNING_STORAGE_KEY, second);
		expect(fresh.save(storage).ok).toBe(true);
		const archived = Array.from({ length: storage.length }, (_, i) => storage.key(i)!)
			.filter((key) => key.startsWith(PLANNING_ARCHIVE_PREFIX))
			.map((key) => storage.getItem(key));
		expect(archived).toContain(first);
		expect(archived).toContain(second);
		const blocked = memoryStorage();
		blocked.setItem(PLANNING_STORAGE_KEY, second);
		blocked.setItem = (key) => {
			throw new Error(`Storage unavailable for ${key}`);
		};
		expect(fresh.save(blocked).ok).toBe(false);
		expect(blocked.getItem(PLANNING_STORAGE_KEY)).toBe(second);
		const rejected = new PlanningScenarioState({ ...b, version: 'new-audit' });
		expect(rejected.load(blocked).ok).toBe(false);
		expect(rejected.archivedProposalJson).toBeNull();
	});
	it('restores private-travel inputs and aggregate emissions assumptions through export and history', () => {
		const b = fixture();
		const store = new PlanningScenarioState(b);
		const travel = {
			dailyTrips: { low: 20, central: 100, high: 240 },
			distanceKm: 7.5,
			occupancy: 1.8
		};
		const annualMultiplier =
			travel.distanceKm * travel.occupancy * store.assumptions.annualOperatingDays;
		const displacedPassengerKm = {
			low: travel.dailyTrips.low * annualMultiplier,
			central: travel.dailyTrips.central * annualMultiplier,
			high: travel.dailyTrips.high * annualMultiplier
		};
		store.setAssumptions({ privateTravelInputs: travel, displacedPassengerKm });
		store.addAction({ kind: 'add-route', pattern: bus() });
		const restored = new PlanningScenarioState(b);
		expect(restored.importJson(store.exportJson())).toEqual({ ok: true });
		expect(restored.assumptions.privateTravelInputs).toEqual(travel);
		expect(restored.assumptions.displacedPassengerKm).toEqual(displacedPassengerKm);
		expect(restored.analysis).toEqual(store.analysis);
		const changedTrips = { low: 40, central: 200, high: 480 };
		restored.setAssumptions({
			privateTravelInputs: { ...travel, dailyTrips: changedTrips },
			displacedPassengerKm: {
				low: changedTrips.low * annualMultiplier,
				central: changedTrips.central * annualMultiplier,
				high: changedTrips.high * annualMultiplier
			}
		});
		expect(restored.undo()).toBe(true);
		expect(restored.assumptions.privateTravelInputs).toEqual(travel);
		expect(restored.assumptions.displacedPassengerKm).toEqual(displacedPassengerKm);
		expect(restored.redo()).toBe(true);
		expect(restored.assumptions.privateTravelInputs?.dailyTrips).toEqual(changedTrips);
	});
	it('rejects malformed or inconsistent private-travel metadata while accepting legacy saved scenarios', () => {
		const b = fixture();
		const store = new PlanningScenarioState(b);
		const legacy = store.exportJson();
		expect(new PlanningScenarioState(b).importJson(legacy)).toEqual({ ok: true });
		const validTravel = {
			dailyTrips: { low: 0, central: 0, high: 0 },
			distanceKm: 4,
			occupancy: 1.3
		};
		const invalidTravel = [
			null,
			{ ...validTravel, dailyTrips: { low: 20, central: 10, high: 30 } },
			{ ...validTravel, distanceKm: 0 },
			{ ...validTravel, distanceKm: -1 },
			{ ...validTravel, distanceKm: '4' },
			{ ...validTravel, occupancy: 0.8 },
			{ ...validTravel, occupancy: null },
			{ ...validTravel, dailyTrips: { low: 0, central: 100, high: 200 } }
		];
		for (const privateTravelInputs of invalidTravel) {
			const saved = JSON.parse(legacy);
			saved.assumptions.privateTravelInputs = privateTravelInputs;
			expect(store.importJson(JSON.stringify(saved)).ok).toBe(false);
		}
		const valid = JSON.parse(legacy);
		valid.assumptions.privateTravelInputs = validTravel;
		expect(store.importJson(JSON.stringify(valid))).toEqual({ ok: true });
	});
	it('resets actions and all assumptions together in one reversible history step', () => {
		const b = fixture();
		const store = new PlanningScenarioState(b);
		store.addAction({ kind: 'add-route', pattern: bus() });
		store.setAssumptions({
			goal: 'education',
			populationYear: 2030,
			targetMinutes: 45,
			dieselLitresPerVehicleKm: range(0.4)
		});
		store.clearHistory();
		const previous = store.exportJson();
		store.resetToDefaults();
		expect(store.actions).toEqual([]);
		expect(store.assumptions).toEqual(createDefaultAssumptions(b));
		const reset = store.exportJson();
		expect(store.undo()).toBe(true);
		expect(store.exportJson()).toBe(previous);
		expect(store.canUndo).toBe(false);
		expect(store.redo()).toBe(true);
		expect(store.exportJson()).toBe(reset);
		expect(store.canRedo).toBe(false);
	});
	it('clones supplied nested defaults rather than retaining mutable caller values', () => {
		const b = fixture();
		const store = new PlanningScenarioState(b);
		const defaults: PlanningAssumptions = {
			...assumptions(b),
			electricKwhPerVehicleKm: range(1.1),
			privateTravelInputs: {
				dailyTrips: { low: 0, central: 100, high: 200 },
				distanceKm: 4,
				occupancy: 1.3
			},
			displacedPassengerKm: { low: 0, central: 156000, high: 312000 }
		};
		const expected = structuredClone(defaults);
		store.resetToDefaults(defaults);
		defaults.costs.dieselBusCapitalMvr!.central = 1;
		defaults.electricKwhPerVehicleKm!.central = 9;
		defaults.privateTravelInputs!.dailyTrips.central = 900;
		defaults.displacedPassengerKm.central = 1;
		expect(store.assumptions).toEqual(expected);
	});
	it('persists reset defaults over the old proposal and reloads the complete reset state', () => {
		const b = fixture();
		const storage = memoryStorage();
		const store = new PlanningScenarioState(b);
		store.addAction({ kind: 'add-route', pattern: bus() });
		store.setAssumptions({ goal: 'education', targetMinutes: 45 });
		expect(store.save(storage)).toEqual({ ok: true });
		const defaults = assumptions(b);
		store.resetToDefaults(defaults);
		expect(store.save(storage)).toEqual({ ok: true });
		const restored = new PlanningScenarioState(b);
		expect(restored.load(storage)).toEqual({ ok: true });
		expect(restored.actions).toEqual([]);
		expect(restored.assumptions).toEqual(defaults);
		expect(restored.exportJson()).toBe(store.exportJson());
	});
	it('clears setup and loaded history without changing the current scenario or its future edits', () => {
		const b = fixture();
		const store = new PlanningScenarioState(b);
		store.setAssumptions({ targetMinutes: 25 });
		store.addAction({ kind: 'add-route', pattern: bus() });
		store.undo();
		expect(store.canUndo).toBe(true);
		expect(store.canRedo).toBe(true);
		const current = store.exportJson();
		store.clearHistory();
		expect(store.exportJson()).toBe(current);
		expect(store.canUndo).toBe(false);
		expect(store.canRedo).toBe(false);
		expect(store.undo()).toBe(false);
		expect(store.redo()).toBe(false);
		const restored = new PlanningScenarioState(b);
		expect(restored.importJson(current)).toEqual({ ok: true });
		restored.clearHistory();
		expect(restored.canUndo).toBe(false);
		restored.addAction({ kind: 'add-route', pattern: bus() });
		expect(restored.canUndo).toBe(true);
		restored.undo();
		expect(restored.exportJson()).toBe(current);
	});
	it('does not double-count operating windows when changing service hours', () => {
		const b = fixture();
		const p = bus();
		p.timing = {
			kind: 'frequency',
			windows: [
				{ startMinutes: 420, endMinutes: 600, headwayMinutes: 10 },
				{ startMinutes: 960, endMinutes: 1140, headwayMinutes: 10 }
			],
			segmentMinutes: [10]
		};
		b.transit.patterns = [p];
		const world = derivePlanningWorld(b, [
			{ kind: 'set-hours', patternId: p.id, startMinutes: 420, endMinutes: 1140 }
		]);
		expect(world.patterns[0].timing).toMatchObject({
			windows: [{ startMinutes: 420, endMinutes: 1140, headwayMinutes: 10 }]
		});
	});
	it('reroutes assumed moved stops with chosen runtime inputs and rejects ocean placement', () => {
		const b = fixture(3);
		const p = bus();
		p.provenance = 'assumed';
		b.transit.patterns = [p];
		const world = derivePlanningWorld(
			b,
			[{ kind: 'move-stop', stopId: 's1', position: b.network.nodes[2] }],
			{ ...assumptions(b), busMovingKph: 30, busDwellMinutes: 1 }
		);
		expect(world.patterns[0].distanceM).toBe(12000);
		expect(world.patterns[0].timing).toMatchObject({ segmentMinutes: [25] });
		const ocean = analyzePlanning(
			b,
			[
				{ kind: 'move-stop', stopId: 's1', position: { lon: 0, lat: 0 } },
				{ kind: 'enable-service', patternId: p.id }
			],
			assumptions(b)
		);
		expect(ocean.world.patterns[0].runtimeUnavailableReason).toBeTruthy();
		expect(ocean.origins[0].after.status).toBe('unreachable');
		expect(ocean.costs.capitalMvr).toBeNull();
	});
	it('moving a published stop invalidates its old timetable even if restore is requested', () => {
		const b = fixture();
		const p = bus();
		p.timing = {
			kind: 'scheduled',
			trips: [
				{
					id: 't',
					stopTimes: [
						{ arrivalMinutes: 485, departureMinutes: 485 },
						{ arrivalMinutes: 495, departureMinutes: 495 }
					]
				}
			]
		};
		b.transit.patterns = [p];
		const result = analyzePlanning(
			b,
			[
				{
					kind: 'move-stop',
					stopId: 's0',
					position: { ...b.network.nodes[0], lon: b.network.nodes[0].lon + 0.0001 }
				},
				{ kind: 'enable-service', patternId: p.id }
			],
			assumptions(b)
		);
		expect(result.origins[0].after.status).toBe('unavailable');
		expect(result.summary.lostAccessResidents).toBe(0);
		expect(result.summary.becameUnavailableResidents).toBeGreaterThan(0);
		expect(result.warnings.join(' ')).toContain('Published timing does not apply');
	});
});

describe('worker request coordination', () => {
	class FakeWorker {
		static latest: FakeWorker;
		onmessage?: (event: MessageEvent) => void;
		onerror?: () => void;
		messages: { id?: number; kind: string }[] = [];
		terminated = false;
		constructor() {
			FakeWorker.latest = this;
		}
		postMessage(message: { id?: number; kind: string }) {
			this.messages.push(message);
		}
		terminate() {
			this.terminated = true;
		}
	}
	afterEach(() => vi.unstubAllGlobals());
	it('pins data once and rejects an old result before the newest result reaches consumers', async () => {
		vi.stubGlobal('Worker', FakeWorker);
		const b = fixture();
		const a = assumptions(b);
		const client = new AnalysisWorkerClient(b);
		const first = client.analyze([], a);
		const firstRejected = expect(first).rejects.toBeInstanceOf(SupersededPlanningRequest);
		const second = client.analyze([], a);
		const worker = FakeWorker.latest;
		const result = analyzePlanning(b, [], a);
		worker.onmessage?.({ data: { id: 1, result } } as MessageEvent);
		worker.onmessage?.({ data: { id: 2, result } } as MessageEvent);
		await firstRejected;
		await expect(second).resolves.toEqual(result);
		expect(worker.messages.map((m) => m.kind)).toEqual(['init', 'analyze', 'analyze']);
		client.dispose();
	});
	it('disposal rejects pending work and subsequent requests without leaving hanging promises', async () => {
		vi.stubGlobal('Worker', FakeWorker);
		const b = fixture();
		const client = new AnalysisWorkerClient(b);
		const pending = client.analyze([], assumptions(b));
		const rejected = expect(pending).rejects.toThrow('disposed');
		client.dispose();
		await rejected;
		await expect(client.analyze([], assumptions(b))).rejects.toThrow('unavailable or disposed');
		expect(FakeWorker.latest.terminated).toBe(true);
	});
});
