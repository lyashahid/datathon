import { describe, expect, it, vi } from 'vitest';
import { planningCoverage, supportedSnapshotSettings } from './coverage.ts';
import { createDefaultAssumptions } from './defaults.ts';
import { analyzePlanning } from './engine.ts';
import { compareAffordableInvestments } from './investmentOptions.ts';
import { planningPopulation } from './population.ts';
import { PlanningScenarioState } from './scenarioState.svelte.ts';
import { validPlanningAssumptions } from './validation.ts';
import type { PlanningAction, PlanningBaseline, PlanningServicePattern } from './types.ts';

const range = (n: number) => ({ low: n * 0.8, central: n, high: n * 1.2 });
function fixture(): PlanningBaseline {
	const a = { id: 'a', lon: 73.5, lat: 4.17 };
	const b = { id: 'b', lon: 73.51, lat: 4.17 };
	return {
		schemaVersion: 1,
		version: 'investment-fixture',
		referenceDate: '2026-10-10',
		generatedAt: '2026-10-10T00:00:00Z',
		sources: [],
		islands: [{ id: 'island', name: 'Island', projection2030Population: 300 }],
		origins: [
			{ ...a, id: 'origin-a', islandId: 'island', population2026: 100, population2030: 200 },
			{ ...b, id: 'origin-b', islandId: 'island', population2026: 50, population2030: 100 }
		],
		network: {
			nodes: [a, b],
			edges: [
				{ id: 'road', from: 'a', to: 'b', distanceM: 6000, walkAllowed: true, driveAllowed: true }
			]
		},
		facilities: [
			{
				...b,
				id: 'hospital',
				name: 'Hospital',
				kind: 'hospital',
				islandId: 'island',
				verification: 'official'
			}
		],
		transit: {
			stops: [
				{ ...a, id: 's-a', name: 'A', islandId: 'island', sourceIds: [] },
				{ ...b, id: 's-b', name: 'B', islandId: 'island', sourceIds: [] }
			],
			patterns: [],
			accessStatus: 'complete',
			gaps: []
		},
		costAnchors: {
			stopCapitalMvr: range(250000),
			dieselBusCapitalMvr: range(2300000),
			electricBusCapitalMvr: range(3600000),
			chargingInfrastructureMvr: range(600000),
			dieselOperatingMvrPerKm: range(36),
			electricOperatingMvrPerKm: range(30),
			dieselKgCo2ePerKm: range(1),
			electricKgCo2ePerKm: range(0.8),
			displacedKgCo2ePerPassengerKm: range(0.12)
		}
	};
}
function frequency(): PlanningServicePattern {
	return {
		id: 'bus',
		routeId: 'route',
		name: 'Existing bus',
		mode: 'bus',
		stopIds: ['s-a', 's-b'],
		calendar: { weekdays: [0, 1, 2, 3, 4, 5, 6] },
		timing: {
			kind: 'frequency',
			windows: [{ startMinutes: 420, endMinutes: 1140, headwayMinutes: 10 }],
			segmentMinutes: [10]
		},
		distanceM: 6000,
		provenance: 'observed',
		sourceIds: ['operator']
	};
}

describe('policy evidence and supported snapshot settings', () => {
	it('starts within the public captured window and never extrapolates its date', () => {
		const b = fixture();
		b.transit.accessStatus = 'partial operator snapshot';
		b.transit.patterns = [
			{
				...frequency(),
				calendar: { weekdays: [], includedDates: ['2026-10-10'] },
				timing: {
					kind: 'scheduled',
					trips: [
						{
							id: 'afternoon',
							stopTimes: [
								{ arrivalMinutes: 920, departureMinutes: 920 },
								{ arrivalMinutes: 950, departureMinutes: 950 }
							]
						},
						{
							id: 'later',
							stopTimes: [
								{ arrivalMinutes: 980, departureMinutes: 980 },
								{ arrivalMinutes: 1010, departureMinutes: 1010 }
							]
						}
					]
				}
			}
		];
		expect(supportedSnapshotSettings(b)).toEqual({ date: '2026-10-10', departureMinutes: 930 });
		const a = createDefaultAssumptions(b);
		expect(planningCoverage(b, a)).toMatchObject({
			status: 'partial',
			observedPatternCount: 1,
			supportedStartMinutes: 920,
			supportedEndMinutes: 980
		});
		const morning = analyzePlanning(b, [], { ...a, departureMinutes: 480 });
		expect(morning.coverage.status).toBe('outside-snapshot');
		expect(morning.origins[0].before.status).toBe('unavailable');
		expect(morning.summary.unknownResidents).toBe(100);
		expect(morning.priorities).toEqual([]);
		expect(morning.transportAccess.unknownResidents).toBe(150);
		expect(planningCoverage(b, { date: '2026-10-11', departureMinutes: 930 }).status).toBe(
			'outside-snapshot'
		);
	});
	it('does not manufacture priorities when everyone already meets the target', () => {
		const b = fixture();
		b.network.edges[0].distanceM = 500;
		const result = analyzePlanning(b, [], createDefaultAssumptions(b));
		expect(result.priorities).toEqual([]);
		expect(result.summary.baselineReachableResidents).toBe(150);
	});
	it('respects the validity horizon of complete calendars without treating known closures as unknown', () => {
		const b = fixture();
		b.transit.patterns = [
			{
				...frequency(),
				calendar: {
					weekdays: [0, 1, 2, 3, 4, 5, 6],
					startDate: '2026-10-01',
					endDate: '2026-10-10',
					excludedDates: ['2026-10-09']
				}
			}
		];
		const a = createDefaultAssumptions(b);
		const expired = analyzePlanning(b, [], { ...a, date: '2026-10-11' });
		expect(expired.coverage.status).toBe('outside-snapshot');
		expect(expired.origins[0].before.status).toBe('unavailable');
		expect(expired.priorities).toEqual([]);
		const closure = analyzePlanning(b, [], { ...a, date: '2026-10-09' });
		expect(closure.coverage.status).toBe('complete');
		expect(closure.origins[0].before.status).toBe('unreachable');
		expect(closure.priorities).toHaveLength(1);
	});
	it('keeps missing local morning services unknown despite observations on another island', () => {
		const b = fixture();
		const c = { id: 'c', lon: 73.52, lat: 4.17 },
			d = { id: 'd', lon: 73.53, lat: 4.17 };
		b.islands.push({ id: 'other', name: 'Other island' });
		b.origins.push({ ...c, id: 'other-origin', islandId: 'other', population2026: 100 });
		b.network.nodes.push(c, d);
		b.network.edges.push({
			id: 'other-road',
			from: 'c',
			to: 'd',
			distanceM: 4000,
			walkAllowed: true,
			driveAllowed: true
		});
		b.facilities.push({
			...d,
			id: 'other-hospital',
			name: 'Other hospital',
			kind: 'hospital',
			islandId: 'other',
			verification: 'official'
		});
		b.transit.stops.push(
			{ ...c, id: 'other-c', name: 'Other C', islandId: 'other', sourceIds: [] },
			{ ...d, id: 'other-d', name: 'Other D', islandId: 'other', sourceIds: [] }
		);
		b.transit.accessStatus = 'partial operator snapshot';
		b.transit.patterns = [
			frequency(),
			{
				...frequency(),
				id: 'other-bus',
				routeId: 'other-route',
				stopIds: ['other-c', 'other-d'],
				timing: {
					kind: 'frequency',
					windows: [{ startMinutes: 900, endMinutes: 1020, headwayMinutes: 10 }],
					segmentMinutes: [10]
				}
			}
		];
		const a = { ...createDefaultAssumptions(b), departureMinutes: 480 };
		const result = analyzePlanning(b, [], a);
		expect(result.coverage.status).toBe('partial');
		expect(result.origins.find((o) => o.originId === 'other-origin')?.before.status).toBe(
			'unavailable'
		);
		expect(result.summary.unknownResidents).toBe(100);
		expect(result.transportAccess.unknownResidents).toBe(100);
		expect(result.priorities.some((p) => p.originId === 'other-origin')).toBe(false);
	});
	it('does not establish an access gap when the target extends beyond the last captured departures', () => {
		const b = fixture();
		b.transit.accessStatus = 'partial operator snapshot';
		b.transit.patterns = [
			{
				...frequency(),
				timing: {
					kind: 'frequency',
					windows: [{ startMinutes: 420, endMinutes: 600, headwayMinutes: 10 }],
					segmentMinutes: [10]
				}
			}
		];
		const result = analyzePlanning(b, [], {
			...createDefaultAssumptions(b),
			departureMinutes: 599
		});
		expect(result.origins[0].before.status).toBe('unavailable');
		expect(result.origins[1].before.status).toBe('reachable');
		expect(result.priorities).toEqual([]);
	});
	it('reports losses, slower journeys and unknown transitions independently by island', () => {
		const b = fixture();
		b.transit.patterns = [frequency()];
		const a = createDefaultAssumptions(b);
		const slower = analyzePlanning(
			b,
			[{ kind: 'set-frequency', patternId: 'bus', headwayMinutes: 50 }],
			a
		);
		expect(slower.summary).toMatchObject({
			lostAccessResidents: 100,
			worsenedJourneyResidents: 100,
			becameUnavailableResidents: 0
		});
		expect(slower.islandSummaries[0]).toMatchObject({
			gainedResidents: 0,
			lostResidents: 100,
			unknownResidents: 0,
			worsenedJourneyResidents: 100
		});
		const moved = analyzePlanning(
			b,
			[{ kind: 'move-stop', stopId: 's-a', position: { lon: 73.50001, lat: 4.17 } }],
			a
		);
		expect(moved.summary).toMatchObject({
			lostAccessResidents: 0,
			becameUnavailableResidents: 100,
			unknownResidents: 100
		});
		expect(moved.islandSummaries[0]).toMatchObject({
			lostResidents: 0,
			becameUnavailableResidents: 100
		});
	});
	it('walking speed changes time, while wheelchair mode preserves missing audited inputs', () => {
		const b = fixture();
		b.network.edges[0].distanceM = 2000;
		const a = createDefaultAssumptions(b);
		expect(analyzePlanning(b, [], a).origins[0].after.minutes).toBe(25);
		expect(analyzePlanning(b, [], { ...a, walkMPerMinute: 50 }).origins[0].after.minutes).toBe(40);
		const wheelchair = analyzePlanning(b, [], {
			...a,
			walkingRequirements: { requireAuditedWheelchair: true }
		});
		expect(wheelchair.origins.every((o) => o.after.status === 'unavailable')).toBe(true);
		expect(wheelchair.summary.unknownResidents).toBe(150);
		expect(wheelchair.priorities).toEqual([]);
	});
	it('strict destination metadata does not turn a hospital category into verified emergency access', () => {
		const b = fixture();
		b.network.edges[0].distanceM = 100;
		const a = {
			...createDefaultAssumptions(b),
			destinationRequirements: { healthcareService: 'emergency' as const }
		};
		expect(analyzePlanning(b, [], a).summary.unknownResidents).toBe(150);
		b.facilities[0].suitability = {
			healthcareServices: ['general', 'emergency'],
			sourceIds: ['official-emergency-audit'],
			reviewedAt: '2026-10-10'
		};
		const verified = analyzePlanning(structuredClone(b), [], a);
		expect(verified.summary.scenarioReachableResidents).toBe(150);
	});
	it('unknown suitable destinations across a bridge or service cannot manufacture an emergency-care gap', () => {
		const b = fixture();
		const c = { id: 'c', lon: 73.501, lat: 4.17 };
		b.islands.push({ id: 'other', name: 'Other island' });
		b.origins = b.origins.slice(0, 1);
		b.network.nodes.push(c);
		b.network.edges = [
			{ id: 'bridge', from: 'a', to: 'b', distanceM: 500, walkAllowed: true, driveAllowed: true },
			{
				id: 'local-road',
				from: 'a',
				to: 'c',
				distanceM: 4000,
				walkAllowed: true,
				driveAllowed: true
			}
		];
		b.facilities = [
			{
				...b.facilities[0],
				...c,
				suitability: {
					healthcareServices: ['emergency'],
					sourceIds: ['operator'],
					reviewedAt: '2026-10-10'
				}
			},
			{ ...b.facilities[0], id: 'unknown-hospital', islandId: 'other' }
		];
		const a = {
			...createDefaultAssumptions(b),
			destinationRequirements: { healthcareService: 'emergency' as const }
		};
		const possibleWalk = analyzePlanning(b, [], a);
		expect(possibleWalk.summary.unknownResidents).toBe(100);
		expect(possibleWalk.priorities).toEqual([]);
		b.network.edges[0].distanceM = 5000;
		const outsideTarget = analyzePlanning(structuredClone(b), [], a);
		expect(outsideTarget.origins[0].before.minutes).toBe(50);
		expect(outsideTarget.priorities).toHaveLength(1);
		b.transit.patterns = [frequency()];
		const possibleTransit = analyzePlanning(structuredClone(b), [], a);
		expect(possibleTransit.summary.unknownResidents).toBe(100);
		expect(possibleTransit.priorities).toEqual([]);
		b.network.edges[1].distanceM = 800;
		const confirmed = analyzePlanning(structuredClone(b), [], a);
		expect(confirmed.origins[0].before).toMatchObject({ status: 'reachable', minutes: 10 });
	});
});

describe('affordable investment search', () => {
	it('does not certify a whole proposal containing an unpriced timetable shift', async () => {
		const b = fixture();
		b.transit.patterns = [
			{
				...frequency(),
				timing: {
					kind: 'scheduled',
					trips: [
						{
							id: 'afternoon',
							stopTimes: [
								{ arrivalMinutes: 930, departureMinutes: 930 },
								{ arrivalMinutes: 940, departureMinutes: 940 }
							]
						}
					]
				}
			}
		];
		const assumptions = createDefaultAssumptions(b);
		const actions: PlanningAction[] = [{ kind: 'shift-timetable', patternId: 'bus', minutes: 5 }];
		const analyzer = vi.fn(async (actions, assumptions) =>
			analyzePlanning(b, actions, assumptions)
		);
		const comparison = await compareAffordableInvestments(b, {
			originId: 'origin-a',
			actions,
			assumptions,
			capitalBudgetMvr: 30000000,
			annualOperatingBudgetMvr: 30000000,
			analyze: analyzer
		});
		expect(comparison.baseline).toEqual(analyzePlanning(b, actions, assumptions));
		expect(comparison.baseline.world.patterns[0].timing).toMatchObject({
			trips: [{ stopTimes: [{ departureMinutes: 935 }, { departureMinutes: 945 }] }]
		});
		expect(comparison.alternatives).toEqual([]);
		expect(analyzer).toHaveBeenCalledTimes(1);
		expect(comparison.notes.join(' ')).toContain('affordability is not established');
		expect(comparison.notes.join(' ')).toContain('operator and engineering cost estimates');
		expect(comparison.notes.join(' ')).not.toContain('fit both');
	});
	it('withholds affordability even when modeled road-delay service costs are numeric', async () => {
		const b = fixture();
		const assumptions = createDefaultAssumptions(b);
		assumptions.disruptions = [
			{
				id: 'assumed-road-delay',
				name: 'Road-delay scenario',
				kind: 'delay',
				edgeIds: ['road'],
				modes: ['bus'],
				direction: 'both',
				startDate: assumptions.date,
				endDate: assumptions.date,
				startMinutes: 0,
				endMinutes: 1439,
				delayMinutes: 5,
				provenance: 'assumed'
			}
		];
		const analyzer = vi.fn(async (actions, assumptions) =>
			analyzePlanning(b, actions, assumptions)
		);
		const comparison = await compareAffordableInvestments(b, {
			originId: 'origin-a',
			assumptions,
			capitalBudgetMvr: 30000000,
			annualOperatingBudgetMvr: 30000000,
			analyze: analyzer
		});
		expect(comparison.baseline.costs.capitalMvr?.central).toBe(0);
		expect(comparison.baseline.costs.annualOperatingMvr?.central).toBe(0);
		expect(comparison.alternatives).toEqual([]);
		expect(analyzer).toHaveBeenCalledTimes(1);
		expect(comparison.excluded).toEqual([
			{
				label: 'Whole-proposal affordability',
				reason: expect.stringContaining('unestimated implementation costs')
			}
		]);
		expect(comparison.notes.join(' ')).not.toContain('fit both');
	});
	it('shows only beneficial options within both high-estimate caps on identical worker inputs', async () => {
		const b = fixture();
		const a = createDefaultAssumptions(b);
		const analyzer = vi.fn(async (actions, assumptions) =>
			analyzePlanning(b, actions, assumptions)
		);
		const comparison = await compareAffordableInvestments(b, {
			originId: 'origin-a',
			assumptions: a,
			capitalBudgetMvr: 30000000,
			annualOperatingBudgetMvr: 30000000,
			costBasis: 'high',
			analyze: analyzer
		});
		expect(comparison.alternatives.length).toBeGreaterThan(0);
		for (const alternative of comparison.alternatives) {
			expect(alternative.evaluation.capitalMvr).toBeLessThanOrEqual(30000000);
			expect(alternative.evaluation.annualOperatingMvr).toBeLessThanOrEqual(30000000);
			expect(alternative.evaluation.additionalResidents).toBe(100);
			expect(alternative.result).toEqual(analyzePlanning(b, alternative.actions, a));
		}
		expect(analyzer).toHaveBeenCalled();
	});
	it('reports no affordable beneficial option instead of presenting over-budget cards', async () => {
		const b = fixture();
		const comparison = await compareAffordableInvestments(b, {
			originId: 'origin-a',
			assumptions: createDefaultAssumptions(b),
			capitalBudgetMvr: 1000,
			annualOperatingBudgetMvr: 1000
		});
		expect(comparison.alternatives).toEqual([]);
		expect(comparison.excluded.some((option) => option.reason.includes('Exceeds'))).toBe(true);
		expect(comparison.notes.join(' ')).toContain('No affordable beneficial option');
	});
	it('unavailable costs never appear as a free investment', async () => {
		const b = fixture();
		b.costAnchors = {};
		const comparison = await compareAffordableInvestments(b, {
			originId: 'origin-a',
			assumptions: createDefaultAssumptions(b),
			capitalBudgetMvr: 10000000,
			annualOperatingBudgetMvr: 10000000
		});
		expect(comparison.alternatives).toEqual([]);
		expect(comparison.excluded.every((option) => option.reason.includes('unavailable'))).toBe(true);
	});
	it('a one-way non-loop service needs a return plan before costs, fleet or carbon can be calculated', () => {
		const b = fixture();
		const a = createDefaultAssumptions(b);
		const oneWay = analyzePlanning(b, [{ kind: 'add-route', pattern: frequency() }], a);
		expect(oneWay.summary.scenarioReachableResidents).toBe(150);
		expect(oneWay.costs.capitalMvr).toBeNull();
		expect(oneWay.costs.annualOperatingMvr).toBeNull();
		expect(oneWay.costs.requiredFleet).toBeNull();
		expect(oneWay.carbon.central).toBeNull();
		expect(oneWay.costs.unavailableReasons.join(' ')).toContain('return/repositioning');
		const paired = analyzePlanning(
			b,
			[
				{
					kind: 'add-route',
					pattern: frequency(),
					returnPattern: { ...frequency(), id: 'bus-back', stopIds: ['s-b', 's-a'] }
				}
			],
			a
		);
		expect(paired.costs.capitalMvr?.central).toBeGreaterThan(0);
		expect(paired.costs.annualOperatingMvr?.central).toBeGreaterThan(0);
	});
	it('modest measured gains receive an explanation rather than an exaggerated recommendation', async () => {
		const b = fixture();
		b.origins[0].population2026 = 2;
		const comparison = await compareAffordableInvestments(b, {
			originId: 'origin-a',
			assumptions: createDefaultAssumptions(b),
			capitalBudgetMvr: 30000000,
			annualOperatingBudgetMvr: 30000000
		});
		expect(comparison.alternatives[0].evaluation).toMatchObject({
			additionalResidents: 2,
			lowValue: true
		});
		expect(comparison.alternatives[0].evaluation.explanation).toContain('measured gain is modest');
	});
	it('partial snapshot evidence remains conditional even when the hypothetical service works', async () => {
		const b = fixture();
		b.transit.accessStatus = 'partial operator snapshot';
		b.transit.patterns = [frequency()];
		b.transit.patterns[0].timing = {
			kind: 'frequency',
			windows: [{ startMinutes: 420, endMinutes: 1140, headwayMinutes: 50 }],
			segmentMinutes: [10]
		};
		b.transit.patterns.push({
			...structuredClone(b.transit.patterns[0]),
			id: 'bus-back',
			stopIds: ['s-b', 's-a']
		});
		const comparison = await compareAffordableInvestments(b, {
			originId: 'origin-a',
			assumptions: createDefaultAssumptions(b),
			capitalBudgetMvr: 10000000,
			annualOperatingBudgetMvr: 12000000
		});
		expect(comparison.alternatives.length).toBeGreaterThan(0);
		expect(
			comparison.alternatives.every(
				(alternative) => alternative.evaluation.evidence === 'conditional'
			)
		).toBe(true);
	});
});

describe('conditional housing distribution and scenario contracts', () => {
	it('redistributes inside and outside a neighborhood while conserving the official island total', () => {
		const b = fixture();
		const a = {
			...createDefaultAssumptions(b),
			populationYear: 2030 as const,
			housingDistribution: [{ islandId: 'island', originIds: ['origin-a'], share: 0.8 }]
		};
		const population = planningPopulation(b, a);
		expect([...population.byOrigin.values()]).toEqual([240, 60]);
		expect(analyzePlanning(b, [], a).summary.population).toBe(300);
		expect(population.warnings.join(' ')).toContain('conditional housing distribution');
		expect(planningPopulation(b, { ...a, populationYear: 2026 }).byOrigin.get('origin-a')).toBe(
			100
		);
	});
	it('keeps the validated snapshot when an island lacks an independently allocated 2030 total', () => {
		const b = fixture();
		b.islands[0].projection2030Population = null;
		const a = {
			...createDefaultAssumptions(b),
			populationYear: 2030 as const,
			housingDistribution: [{ islandId: 'island', originIds: ['origin-a'], share: 0.8 }]
		};
		expect([...planningPopulation(b, a).byOrigin.values()]).toEqual([200, 100]);
		expect(planningPopulation(b, a).warnings.join(' ')).toContain('ignored');
	});
	it('saves, imports and undoes housing, delivery and affordability settings without inventing demand', () => {
		const b = fixture();
		const state = new PlanningScenarioState(b);
		const patch = {
			populationYear: 2030 as const,
			housingDistribution: [{ islandId: 'island', originIds: ['origin-a'], share: 0.8 }],
			fareAffordability: { oneWayFareMvr: 7, monthlyTrips: 40, monthlyHouseholdBudgetMvr: 10000 },
			policyDelivery: {
				responsibleAgency: 'MTCC',
				phases: ['Verify boarding', 'Pilot service'],
				outstandingVerification: ['Confirm local unit costs']
			}
		};
		state.setAssumptions(patch);
		const restored = new PlanningScenarioState(b);
		expect(restored.importJson(state.exportJson())).toEqual({ ok: true });
		expect(restored.assumptions).toMatchObject(patch);
		expect(restored.analysis.summary.population).toBe(300);
		expect(restored.assumptions.displacedPassengerKm).toEqual({ low: 0, central: 0, high: 0 });
		expect(state.undo()).toBe(true);
		expect(state.assumptions.housingDistribution).toBeUndefined();
		expect(state.redo()).toBe(true);
		expect(state.assumptions.housingDistribution).toEqual(patch.housingDistribution);
		expect(
			validPlanningAssumptions({
				...restored.assumptions,
				housingDistribution: [{ islandId: 'island', originIds: ['origin-a'], share: 1.2 }]
			})
		).toBe(false);
		expect(
			validPlanningAssumptions({
				...restored.assumptions,
				fareAffordability: { ...patch.fareAffordability, monthlyHouseholdBudgetMvr: -1 }
			})
		).toBe(false);
	});
	it('preserves a partial fare scenario while a zero household budget remains unavailable', () => {
		const b = fixture();
		const state = new PlanningScenarioState(b);
		state.setAssumptions({
			fareAffordability: { oneWayFareMvr: 7, monthlyTrips: 44, monthlyHouseholdBudgetMvr: 0 }
		});
		expect(validPlanningAssumptions(state.assumptions)).toBe(true);
		const restored = new PlanningScenarioState(b);
		expect(restored.importJson(state.exportJson())).toEqual({ ok: true });
		expect(restored.assumptions.fareAffordability).toEqual({
			oneWayFareMvr: 7,
			monthlyTrips: 44,
			monthlyHouseholdBudgetMvr: 0
		});
		expect(restored.assumptions.displacedPassengerKm).toEqual({ low: 0, central: 0, high: 0 });
	});
});
