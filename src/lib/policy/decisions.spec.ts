import { describe, it, expect } from 'vitest';
import {
	comparePolicyOutcomes,
	shiftScheduledPattern,
	policyDelayEvent,
	policyPatternDependencies,
	evaluatePolicyOptions,
	policyRoadLabels
} from './decisions.ts';
import type {
	PlanningAnalysis,
	PlanningBaseline,
	PlanningServicePattern
} from '../planning/types.ts';
import { createDefaultAssumptions } from '../planning/defaults.ts';

function analysis(
	rows: [string, number, 'reachable' | 'unreachable' | 'unavailable', number | null][]
): PlanningAnalysis {
	return {
		targetMinutes: 30,
		departureMinutes: 960,
		origins: rows.map(([id, population, status, minutes]) => ({
			originId: id,
			population,
			islandId: id.startsWith('a') ? 'one' : 'two',
			after: { status, minutes, path: [], destinationId: null, reason: null }
		}))
	} as unknown as PlanningAnalysis;
}

describe('policy comparison meaning', () => {
	it('counts actual selected-condition gains, losses and unknowns with a conserved denominator', () => {
		const current = analysis([
			['a', 100, 'reachable', 25],
			['b', 200, 'reachable', 40],
			['c', 50, 'unavailable', null]
		]);
		const result = analysis([
			['a', 100, 'reachable', 35],
			['b', 200, 'reachable', 20],
			['c', 50, 'unavailable', null]
		]);
		const out = comparePolicyOutcomes(current, result, true);
		expect(out.gainedResidents).toBe(200);
		expect(out.lostResidents).toBe(100);
		expect(out.worsenedResidents).toBe(100);
		expect(out.unknownResidents).toBe(50);
		expect(out.reachableResidents + out.failedResidents + out.unknownResidents).toBe(
			out.population
		);
		expect(out.accessBounds).toEqual([200 / 350, 250 / 350]);
		expect(out.meanMinutesSaved).toBe(10);
		expect(out.islands.find((i) => i.islandId === 'two')).toMatchObject({
			population: 250,
			reachableResidents: 200,
			coveredResidents: 200,
			resultUnknownResidents: 50,
			accessRate: 0.8
		});
		expect(out.annualAdditionalMvr).toBeNull();
		expect(out.additionalFleet).toBeNull();
	});
	it('never counts an unknown baseline as a verified gain', () => {
		const out = comparePolicyOutcomes(
			analysis([['a', 100, 'unavailable', null]]),
			analysis([['a', 100, 'reachable', 20]]),
			true
		);
		expect(out.gainedResidents).toBe(0);
		expect(out.reachableResidents).toBe(100);
		expect(out.islands[0].unknownResidents).toBe(100);
	});
	it('rejects changes to denominator, target or comparison time', () => {
		const a = analysis([['a', 100, 'reachable', 20]]);
		expect(() => comparePolicyOutcomes(a, analysis([['a', 101, 'reachable', 20]]), true)).toThrow(
			/population/
		);
		expect(() => comparePolicyOutcomes(a, { ...a, targetMinutes: 40 }, true)).toThrow(/target/);
		expect(() => comparePolicyOutcomes(a, { ...a, departureMinutes: 970 }, true)).toThrow(/time/);
	});
	it('rejects duplicate origins, swapped island labels and differing service dates', () => {
		const a = analysis([
			['a', 100, 'reachable', 20],
			['b', 100, 'unavailable', null]
		]);
		expect(() =>
			comparePolicyOutcomes(a, { ...a, origins: [a.origins[0], a.origins[0]] }, false)
		).toThrow(/duplicate/);
		expect(() =>
			comparePolicyOutcomes(
				a,
				{ ...a, origins: a.origins.map((o) => ({ ...o, islandId: 'changed' })) },
				false
			)
		).toThrow(/population/);
		const dated = { ...a, coverage: { date: '2026-10-10' } } as PlanningAnalysis;
		expect(() =>
			comparePolicyOutcomes(
				dated,
				{ ...dated, coverage: { ...dated.coverage, date: '2026-10-11' } },
				false
			)
		).toThrow(/date/);
	});
});

describe('comparison of the existing map proposal', () => {
	const baseline = {
		referenceDate: '2026-10-10',
		transit: { patterns: [], gaps: [] },
		network: {
			nodes: [
				{ id: 'n1', lon: 73, lat: 4 },
				{ id: 'n2', lon: 73.1, lat: 4 }
			],
			edges: [{ id: 'road', name: 'Named road', from: 'n1', to: 'n2', driveAllowed: true }]
		}
	} as unknown as PlanningBaseline;
	it('keeps exact road IDs in values while giving stable readable section labels', () => {
		const b = {
			...baseline,
			network: {
				...baseline.network,
				edges: [
					{ ...baseline.network.edges[0], id: 'z' },
					{ ...baseline.network.edges[0], id: 'a' }
				]
			}
		};
		expect([...policyRoadLabels(b)]).toEqual([
			['a', 'Named road · section 1'],
			['z', 'Named road · section 2']
		]);
		expect([
			...policyRoadLabels({
				...b,
				network: { ...b.network, edges: [...b.network.edges].reverse() }
			})
		]).toEqual([...policyRoadLabels(b)]);
	});
	it('retains timing when both tested shifts harm access and exposes each rejected test', async () => {
		const pattern = {
			id: 'used',
			name: 'Affected bus',
			provenance: 'observed',
			timing: {
				kind: 'scheduled',
				trips: [
					{
						id: 'trip',
						stopTimes: [
							{ arrivalMinutes: 950, departureMinutes: 950 },
							{ arrivalMinutes: 980, departureMinutes: 980 }
						]
					}
				]
			}
		} as PlanningServicePattern;
		const result = await evaluatePolicyOptions(
			baseline,
			{ delayMinutes: 5, roadEdgeId: 'road', departureMinutes: 960 },
			async (actions, inputs) => {
				const shifted = actions.some((a) => a.kind === 'shift-timetable');
				const out = analysis([['a', 100, 'reachable', shifted ? 35 : 20]]);
				out.origins[0].after.path = [
					{
						mode: 'bus',
						patternId: 'used',
						from: 'n1',
						to: 'n2',
						minutes: 10,
						waitMinutes: 0,
						geometry: [
							[73, 4],
							[73.1, 4]
						]
					}
				];
				return {
					...out,
					goal: inputs.goal,
					world: { patterns: [pattern] },
					coverage: { date: inputs.date },
					disruptionImpact: { affectedPatternIds: ['used'] }
				} as unknown as PlanningAnalysis;
			}
		);
		expect(
			result.timingTrials.map((t) => ({
				shift: t.minutes,
				gain: t.comparison.gainedResidents,
				loss: t.comparison.lostResidents
			}))
		).toEqual([
			{ shift: -5, gain: 0, loss: 100 },
			{ shift: 5, gain: 0, loss: 100 }
		]);
		expect(result.alternatives.find((a) => a.id === 'coordinate')).toMatchObject({
			label: 'Retain bus timing',
			actions: [],
			comparison: { annualAdditionalMvr: 0 }
		});
	});
	it('keeps map actions, goal, population assumptions and unrelated events when removing only the panel delay', async () => {
		const inputs = createDefaultAssumptions(baseline);
		inputs.goal = 'education';
		inputs.populationYear = 2030;
		inputs.fleetResponse = 'maintain-frequency';
		inputs.disruptions = [
			{
				id: 'user-event',
				name: 'Existing event',
				kind: 'delay',
				edgeIds: ['road'],
				modes: ['bus'],
				direction: 'both',
				startDate: '2026-10-10',
				endDate: '2026-10-10',
				startMinutes: 0,
				endMinutes: 1439,
				delayMinutes: 1,
				provenance: 'assumed'
			}
		];
		const actions = [{ kind: 'disable-service' as const, patternId: 'existing' }];
		const calls: { actions: typeof actions; inputs: typeof inputs }[] = [];
		const result = await evaluatePolicyOptions(
			baseline,
			{
				baseActions: actions,
				assumptions: inputs,
				roadEdgeId: 'road',
				delayMinutes: 5,
				departureMinutes: 960
			},
			async (a, s) => {
				calls.push({ actions: structuredClone(a) as typeof actions, inputs: structuredClone(s) });
				return {
					...analysis([['a', 100, 'reachable', 20]]),
					goal: s.goal,
					world: { patterns: [] },
					coverage: { date: s.date }
				} as unknown as PlanningAnalysis;
			}
		);
		expect(calls.every((call) => JSON.stringify(call.actions) === JSON.stringify(actions))).toBe(
			true
		);
		expect(
			calls.every(
				(call) =>
					call.inputs.goal === 'education' &&
					call.inputs.populationYear === 2030 &&
					call.inputs.fleetResponse === 'maintain-frequency'
			)
		).toBe(true);
		expect(
			result.alternatives.find((a) => a.id === 'restore')?.assumptions.disruptions?.map((d) => d.id)
		).toEqual(['user-event']);
		expect(
			result.alternatives.find((a) => a.id === 'keep')?.assumptions.disruptions?.map((d) => d.id)
		).toEqual(['user-event', 'policy-assumed-critical-road-delay']);
		expect(inputs.disruptions.map((d) => d.id)).toEqual(['user-event']);
		expect(result.roadEvent?.name).toContain('Named road');
		expect(result.roadChoices).toContainEqual({
			id: 'road',
			name: 'Named road · section 1',
			dependentResidents: 0
		});
		expect(result.alternatives.find((a) => a.id === 'coordinate')).toMatchObject({
			label: 'Retain bus timing',
			comparison: { annualAdditionalMvr: 0 },
			actions
		});
		expect(
			result.alternatives.find((a) => a.id === 'restore')?.comparison.annualAdditionalMvr
		).toBeNull();
	});
	it('does not report a costed intervention when the selected delay is zero', async () => {
		const result = await evaluatePolicyOptions(
			baseline,
			{ delayMinutes: 0 },
			async (_a, s) =>
				({
					...analysis([['a', 100, 'reachable', 20]]),
					goal: s.goal,
					world: { patterns: [] },
					coverage: { date: s.date }
				}) as unknown as PlanningAnalysis
		);
		expect(result.roadEvent).toBeNull();
		expect(
			result.alternatives.find((a) => a.id === 'restore')?.comparison.annualAdditionalMvr
		).toBe(0);
	});
});

describe('small operational changes', () => {
	it('ranks actual modeled journey dependencies once per origin rather than every leg', () => {
		const a = analysis([
			['a', 100, 'reachable', 20],
			['b', 200, 'reachable', 25]
		]);
		a.origins[0].after.path = [
			{ mode: 'bus', patternId: 'used', from: 'a', to: 'b', minutes: 4, waitMinutes: 0 },
			{ mode: 'bus', patternId: 'used', from: 'b', to: 'c', minutes: 4, waitMinutes: 0 }
		];
		a.origins[1].after.path = [
			{ mode: 'bus', patternId: 'other', from: 'a', to: 'b', minutes: 4, waitMinutes: 0 }
		];
		expect([...policyPatternDependencies(a)]).toEqual([
			['used', 100],
			['other', 200]
		]);
	});
	const pattern = {
		provenance: 'observed',
		timing: {
			kind: 'scheduled',
			trips: [
				{
					id: 't',
					stopTimes: [
						{ arrivalMinutes: 960, departureMinutes: 962 },
						{ arrivalMinutes: 980, departureMinutes: 980 }
					]
				}
			]
		}
	} as PlanningServicePattern;
	it('shifts departure time without inventing a speed improvement or mutating evidence', () => {
		const shifted = shiftScheduledPattern(pattern, -5)!;
		expect(shifted.provenance).toBe('assumed');
		if (shifted.timing.kind !== 'scheduled') throw new Error('Wrong timing');
		expect(shifted.timing.trips[0].stopTimes.map((s) => s.departureMinutes)).toEqual([957, 975]);
		expect(
			pattern.timing.kind === 'scheduled' && pattern.timing.trips[0].stopTimes[0].departureMinutes
		).toBe(962);
	});
	it('withholds cross-midnight or out-of-range shifts rather than dropping known service silently', () => {
		const edge = {
			...pattern,
			timing: {
				kind: 'scheduled',
				trips: [{ id: 't', stopTimes: [{ arrivalMinutes: 1, departureMinutes: 1 }] }]
			}
		} as PlanningServicePattern;
		expect(shiftScheduledPattern(edge, -5)).toBeNull();
		expect(shiftScheduledPattern(pattern, 16)).toBeNull();
	});
	it('does not invent a road condition where geometry is missing', () => {
		const b = {
			referenceDate: '2026-10-10',
			transit: { patterns: [], gaps: [] },
			network: { nodes: [], edges: [] }
		} as unknown as PlanningBaseline;
		expect(policyDelayEvent(b, createDefaultAssumptions(b), 5)).toBeNull();
		expect(() => policyDelayEvent(b, createDefaultAssumptions(b), -1)).toThrow();
	});
});
