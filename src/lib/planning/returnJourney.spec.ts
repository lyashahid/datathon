import { describe, expect, it } from 'vitest';
import { createDefaultAssumptions } from './defaults.ts';
import { derivePlanningWorld } from './scenario.ts';
import { computeAppointmentJourney, findAppointmentDepartureWindows } from './returnJourney.ts';
import type { PlanningBaseline, PlanningServicePattern } from './types.ts';

function fixture(): PlanningBaseline {
	const nodes = [
		{ id: 'home-node', lon: 73.49, lat: 4.17 },
		{ id: 'west-port-node', lon: 73.491, lat: 4.17 },
		{ id: 'east-port-node', lon: 73.51, lat: 4.17 },
		{ id: 'clinic-node', lon: 73.511, lat: 4.17 }
	];
	const stops = [
		{
			...nodes[1],
			id: 'west-port',
			name: 'West port',
			islandId: 'west',
			sourceIds: ['timetable'],
			mode: 'ferry' as const
		},
		{
			...nodes[2],
			id: 'east-port',
			name: 'East port',
			islandId: 'east',
			sourceIds: ['timetable'],
			mode: 'ferry' as const
		}
	];
	const scheduled = (
		id: string,
		stopIds: string[],
		departures: number[]
	): PlanningServicePattern => ({
		id,
		routeId: 'ferry',
		name: id,
		mode: 'ferry',
		stopIds,
		calendar: { weekdays: [6], startDate: '2026-10-10', endDate: '2026-10-10' },
		timing: {
			kind: 'scheduled',
			trips: departures.map((time) => ({
				id: `${id}-${time}`,
				stopTimes: [
					{ arrivalMinutes: time, departureMinutes: time },
					{ arrivalMinutes: time + 10, departureMinutes: time + 10 }
				]
			}))
		},
		provenance: 'observed',
		sourceIds: ['timetable']
	});
	return {
		schemaVersion: 1,
		version: 'return-test',
		generatedAt: '2026-10-10T00:00:00Z',
		referenceDate: '2026-10-10',
		sources: [],
		islands: [
			{ id: 'west', name: 'West' },
			{ id: 'east', name: 'East' }
		],
		origins: [{ ...nodes[0], id: 'home', islandId: 'west', population2026: 100 }],
		network: {
			nodes,
			edges: [
				{
					id: 'west-path',
					from: nodes[0].id,
					to: nodes[1].id,
					distanceM: 160,
					walkAllowed: true,
					driveAllowed: false
				},
				{
					id: 'east-path',
					from: nodes[2].id,
					to: nodes[3].id,
					distanceM: 160,
					walkAllowed: true,
					driveAllowed: false
				}
			]
		},
		facilities: [
			{
				...nodes[3],
				id: 'clinic',
				name: 'Verified clinic',
				kind: 'clinic',
				islandId: 'east',
				verification: 'official'
			}
		],
		transit: {
			stops,
			patterns: [
				scheduled('out', ['west-port', 'east-port'], [485, 545]),
				scheduled('back', ['east-port', 'west-port'], [560, 620])
			],
			gaps: [],
			accessStatus: 'complete'
		}
	};
}
const settings = (baseline: PlanningBaseline) => ({
	...createDefaultAssumptions(baseline),
	date: '2026-10-10',
	departureMinutes: 480,
	walkMPerMinute: 80,
	maxSnapM: 50,
	maxJourneyMinutes: 180,
	boardingBufferMinutes: 1,
	targetMinutes: 30
});

describe('outward and return appointments', () => {
	it('walks to a dated ferry, stays at the same destination, and returns to the exact origin', () => {
		const baseline = fixture();
		const result = computeAppointmentJourney(
			baseline,
			derivePlanningWorld(baseline, []),
			'home',
			settings(baseline),
			{ appointmentMinutes: 60, returnDeadlineMinutes: 600 }
		);
		expect(result.status).toBe('feasible');
		// Walk 2, wait 3, cross 10, walk 2: arrive 08:17. Leave at 09:17,
		// walk 2, wait 1, cross 10, walk 2: home at 09:32.
		expect([result.arriveAt, result.returnDepartAt, result.homeAt]).toEqual([497, 557, 572]);
		expect(result.outward.destinationId).toBe('clinic');
		expect(result.returnJourney?.destinationId).toBe('home');
		expect(result.returnJourney?.path.at(-1)?.to).toBe('home');
		expect(baseline.facilities.map((facility) => facility.id)).toEqual(['clinic']);
	});
	it('a one-minute change misses the return departure and crosses the deadline', () => {
		const baseline = fixture();
		const result = computeAppointmentJourney(
			baseline,
			derivePlanningWorld(baseline, []),
			'home',
			settings(baseline),
			{ appointmentMinutes: 61, returnDeadlineMinutes: 600 }
		);
		expect(result.status).toBe('deadline-missed');
		expect(result.returnJourney?.path.find((leg) => leg.mode === 'ferry')?.tripId).toBe('back-620');
		expect(result.homeAt).toBe(632);
		expect(result.meetsDeadline).toBe(false);
	});
	it('complete evidence can establish no modeled return; partial evidence remains unavailable', () => {
		const baseline = fixture();
		const pattern = baseline.transit.patterns[1];
		if (pattern.timing.kind === 'scheduled')
			pattern.timing.trips = pattern.timing.trips.slice(0, 1);
		const options = { appointmentMinutes: 61, returnDeadlineMinutes: 600 };
		expect(
			computeAppointmentJourney(
				baseline,
				derivePlanningWorld(baseline, []),
				'home',
				settings(baseline),
				options
			).status
		).toBe('unreachable');
		baseline.transit.accessStatus = 'partial';
		const result = computeAppointmentJourney(
			baseline,
			derivePlanningWorld(baseline, []),
			'home',
			settings(baseline),
			options
		);
		expect(result.status).toBe('unavailable');
		expect(result.reason).toContain('snapshot');
		expect(result.homeAt).toBeNull();
	});
	it('does not reverse an outward route or invent a crossing for the return', () => {
		const baseline = fixture();
		baseline.transit.patterns = baseline.transit.patterns.slice(0, 1);
		const result = computeAppointmentJourney(
			baseline,
			derivePlanningWorld(baseline, []),
			'home',
			settings(baseline),
			{ appointmentMinutes: 60, returnDeadlineMinutes: 600 }
		);
		expect(result.outward.status).toBe('reachable');
		expect(result.status).toBe('unreachable');
		expect(result.returnJourney?.path).toEqual([]);
	});
	it('preserves previous-day scheduled service after an appointment crosses midnight', () => {
		const baseline = fixture();
		for (const [index, pattern] of baseline.transit.patterns.entries()) {
			pattern.timing = {
				kind: 'scheduled',
				trips: [
					{
						id: index ? 'overnight-back' : 'overnight-out',
						stopTimes: [
							{ arrivalMinutes: index ? 1480 : 1430, departureMinutes: index ? 1480 : 1430 },
							{ arrivalMinutes: index ? 1490 : 1445, departureMinutes: index ? 1490 : 1445 }
						]
					}
				]
			};
		}
		const result = computeAppointmentJourney(
			baseline,
			derivePlanningWorld(baseline, []),
			'home',
			{ ...settings(baseline), departureMinutes: 1427 },
			{ appointmentMinutes: 30, returnDeadlineMinutes: 1500 }
		);
		expect(result.status).toBe('feasible');
		expect([result.arriveAt, result.returnDepartAt, result.homeAt]).toEqual([1447, 1477, 1492]);
		expect(result.coverage.return?.date).toBe('2026-10-11');
	});
	it('keeps the partial departure search within the published snapshot and labels discrete checks', () => {
		const baseline = fixture();
		baseline.transit.accessStatus = 'partial';
		const scan = findAppointmentDepartureWindows(
			baseline,
			derivePlanningWorld(baseline, []),
			'home',
			settings(baseline),
			{ appointmentMinutes: 60, returnDeadlineMinutes: 900 }
		);
		expect(scan.samples[0].departureMinutes).toBe(485);
		expect(scan.samples.at(-1)!.departureMinutes).toBeLessThanOrEqual(620);
		expect(scan.label).toContain('partial observed window');
	});
	it('refuses proposed destinations and invalid appointment inputs', () => {
		const baseline = fixture();
		baseline.facilities[0].provenance = 'assumed';
		expect(
			computeAppointmentJourney(
				baseline,
				derivePlanningWorld(baseline, []),
				'home',
				settings(baseline),
				{ appointmentMinutes: 60, returnDeadlineMinutes: 600 }
			).reason
		).toContain('verified destination');
		expect(
			computeAppointmentJourney(
				baseline,
				derivePlanningWorld(baseline, []),
				'home',
				settings(baseline),
				{ appointmentMinutes: -1, returnDeadlineMinutes: 600 }
			).status
		).toBe('unavailable');
	});
	it('re-evaluates a walking closure at the return clock and restores it after expiry', () => {
		const baseline = fixture();
		const assumptions = {
			...settings(baseline),
			disruptions: [
				{
					id: 'works',
					name: 'Port path closed',
					kind: 'closure' as const,
					edgeIds: ['east-path'],
					modes: ['walk' as const],
					direction: 'both' as const,
					startDate: '2026-10-10',
					endDate: '2026-10-10',
					startMinutes: 530,
					endMinutes: 580,
					provenance: 'assumed' as const
				}
			]
		};
		const world = derivePlanningWorld(baseline, [], assumptions);
		const closed = computeAppointmentJourney(baseline, world, 'home', assumptions, {
			appointmentMinutes: 60,
			returnDeadlineMinutes: 700
		});
		expect(closed.outward.status).toBe('reachable');
		expect(closed.returnJourney?.status).toBe('unreachable');
		const restored = computeAppointmentJourney(baseline, world, 'home', assumptions, {
			appointmentMinutes: 90,
			returnDeadlineMinutes: 700
		});
		expect(restored.status).toBe('feasible');
		expect(restored.homeAt).toBe(632);
	});
});
