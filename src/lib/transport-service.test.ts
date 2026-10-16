import { describe, expect, it } from 'vitest';
import {
	serviceTimingSummary,
	transportServiceOperations,
	type TransportServicePattern
} from './transport-service.js';
import type { PlanningOperation } from './planning-map.js';

const date = '2026-10-10';
const route: TransportServicePattern = {
	id: 'R1:out',
	routeId: 'R1',
	name: 'West Park to Phase 1',
	mode: 'bus',
	fleet: 'electric',
	distanceM: 2800,
	stopIds: ['west-park', 'central', 'phase-1'],
	calendar: { includedDates: [date] },
	timing: {
		kind: 'scheduled',
		trips: [360, 390, 420].map((departure, index) => ({
			id: `trip:${index}`,
			stopTimes: [
				{ arrivalMinutes: departure, departureMinutes: departure },
				{ arrivalMinutes: departure + 5, departureMinutes: departure + 7 },
				{ arrivalMinutes: departure + 15, departureMinutes: departure + 15 }
			]
		}))
	}
};
const plan = (overrides: Partial<Parameters<typeof transportServiceOperations>[0]> = {}) =>
	transportServiceOperations({
		pattern: route,
		intent: 'add',
		headway: 30,
		date,
		proposalId: 'draft-1',
		islandId: 'island:1442',
		operations: [],
		...overrides
	});

describe('dated transport service proposals', () => {
	it('supplements a bus timetable with staggered departures without replacing the original', () => {
		const original = structuredClone(route);
		const existing: PlanningOperation[] = [{ type: 'add_school', coordinates: [73.5, 4.2] }];
		const result = plan({ operations: existing });
		expect(result.error).toBeNull();
		expect(result.addedDepartures).toBe(2);
		expect(result.operations?.[0]).toBe(existing[0]);
		expect(result.operations?.[1]).toMatchObject({
			type: 'add_service',
			service: {
				id: 'proposal:bus-extra:draft-1',
				routeId: 'R1',
				mode: 'bus',
				fleet: 'electric',
				stopIds: ['west-park', 'central', 'phase-1'],
				calendar: { includedDates: [date], weekdays: [] },
				timing: { kind: 'scheduled' }
			}
		});
		const timing = result.operations?.[1].service?.timing as {
			trips: { stopTimes: { arrivalMinutes: number; departureMinutes: number }[] }[];
		};
		expect(
			timing.trips.map((trip) =>
				trip.stopTimes.map((time) => [time.arrivalMinutes, time.departureMinutes])
			)
		).toEqual([
			[
				[375, 375],
				[380, 382],
				[390, 390]
			],
			[
				[405, 405],
				[410, 412],
				[420, 420]
			]
		]);
		expect(route).toEqual(original);
		expect(existing).toHaveLength(1);
	});

	it('keeps split operating windows and does not invent midday or next-day departures', () => {
		const split: TransportServicePattern = {
			...route,
			timing: {
				kind: 'frequency',
				segmentMinutes: [5, 8],
				windows: [
					{ startMinutes: 360, endMinutes: 420, headwayMinutes: 30 },
					{ startMinutes: 720, endMinutes: 780, headwayMinutes: 20 },
					{ startMinutes: 1430, endMinutes: 1470, headwayMinutes: 10 }
				]
			}
		};
		const result = plan({ pattern: split, headway: 20 });
		const timing = result.operations?.[0].service?.timing as {
			trips: { stopTimes: { departureMinutes: number }[] }[];
		};
		expect(result.error).toBeNull();
		expect(timing.trips.map((trip) => trip.stopTimes[0].departureMinutes)).toEqual([
			370, 410, 730, 750, 770
		]);
		expect(serviceTimingSummary(split, date)).toMatchObject({
			headwayMinutes: 20,
			headwayVaries: true,
			windowLabel: 'Operating windows: 06:00–07:00, 12:00–13:00, 23:50–00:00 (+1 day)'
		});
	});

	it('replaces only its own pending add operation when the interval changes', () => {
		const first = plan();
		const unrelated: PlanningOperation = {
			type: 'set_frequency',
			target_id: 'another-line',
			headway_minutes: 5
		};
		const revised = plan({ headway: 15, operations: [...first.operations!, unrelated] });
		expect(revised.error).toBeNull();
		expect(revised.operations).toHaveLength(2);
		expect(revised.operations?.[0]).toBe(unrelated);
		expect(
			revised.operations?.filter((operation) => operation.type === 'add_service')
		).toHaveLength(1);
		expect(revised.addedDepartures).toBe(4);
	});

	it('does not charge twice for equivalent dated additional bus departures', () => {
		const first = plan();
		const operations = first.operations!;
		for (const intent of ['add', 'improve'] as const) {
			const result = plan({ intent, headway: 15, proposalId: 'another-addition', operations });
			expect(result.operations).toBeNull();
			expect(result.addedDepartures).toBe(0);
			expect(result.error).toMatch(/already has additional departures on 2026-10-10/);
		}
		const reverse = { ...route, id: 'R1:return', stopIds: route.stopIds.toReversed() };
		expect(plan({ pattern: reverse, proposalId: 'return', operations }).error).toBeNull();
		const anotherDate = '2026-10-11';
		expect(
			plan({
				pattern: { ...route, calendar: { includedDates: [anotherDate] } },
				date: anotherDate,
				proposalId: 'another-date',
				operations
			}).error
		).toBeNull();
		expect(operations).toHaveLength(1);
	});

	it('detects imported same-direction services by route and dated calendar without UI metadata', () => {
		const added = plan().operations![0];
		const imported: PlanningOperation = {
			...added,
			metadata: undefined,
			service: {
				...added.service,
				id: 'imported-additional-buses',
				calendar: { startDate: date, endDate: date, weekdays: [6] }
			}
		};
		expect(plan({ operations: [imported] }).error).toMatch(/already has additional departures/);
		const excluded = {
			...imported,
			service: { ...imported.service, calendar: { includedDates: [date], excludedDates: [date] } }
		};
		expect(plan({ operations: [excluded] }).error).toBeNull();
		const malformed = {
			...imported,
			service: { ...imported.service, calendar: { includedDates: { unexpected: date } } }
		};
		expect(plan({ operations: [malformed] }).operations).toBeNull();
	});

	it('refuses conflicting source edits instead of generating from an outdated timetable', () => {
		for (const type of ['set_frequency', 'set_hours', 'shift_timetable', 'set_fleet']) {
			const changed: PlanningOperation = { type, target_id: route.id, headway_minutes: 15 };
			const result = plan({ operations: [changed] });
			expect(result.operations).toBeNull();
			expect(result.error).toMatch(/already has a timetable or fleet change/);
			expect(plan({ operations: [{ ...changed, target_id: 'R1:return' }] }).error).toBeNull();
		}
		for (const type of ['disable_service', 'replace_service']) {
			for (const intent of ['add', 'improve'] as const) {
				const result = plan({
					intent,
					headway: 15,
					operations: [{ type, target_id: route.id }]
				});
				expect(result.operations).toBeNull();
				expect(result.error).toMatch(/disabled or replaced/);
			}
		}
		expect(
			plan({
				intent: 'improve',
				headway: 15,
				operations: [{ type: 'shift_timetable', target_id: route.id }]
			}).error
		).toMatch(/changed operating timetable/);
	});

	it('uses one explicit frequency edit for the selected bus or ferry direction', () => {
		const ferry = { ...route, id: 'ferry:out', mode: 'ferry' };
		const reverse: PlanningOperation = {
			type: 'set_frequency',
			target_id: 'ferry:return',
			headway_minutes: 20
		};
		const old: PlanningOperation = {
			type: 'set_frequency',
			target_id: 'ferry:out',
			headway_minutes: 10
		};
		const result = plan({
			pattern: ferry,
			intent: 'improve',
			headway: 15,
			operations: [reverse, old]
		});
		expect(result.error).toBeNull();
		expect(result.addedDepartures).toBe(0);
		expect(result.operations).toEqual([
			reverse,
			expect.objectContaining({
				type: 'set_frequency',
				target_id: 'ferry:out',
				headway_minutes: 15
			})
		]);
		expect(plan({ pattern: ferry }).error).toMatch(/ferry connection planner/);
	});

	it('prefills a genuine recorded interval and blocks equal or slower uniform-frequency improvements', () => {
		expect(serviceTimingSummary(route, date)).toEqual({
			headwayMinutes: 30,
			headwayVaries: false,
			windowLabel: 'Recorded departures: 06:00–07:00',
			departureCount: 3,
			error: null
		});
		for (const headway of [30, 60]) {
			const result = plan({ intent: 'improve', headway });
			expect(result.operations).toBeNull();
			expect(result.error).toMatch(/below 30 minutes/);
		}
	});

	it('does not fabricate operating hours from one recorded departure or missing evidence', () => {
		const single = {
			...route,
			timing: {
				kind: 'scheduled' as const,
				trips: route.timing?.kind === 'scheduled' ? route.timing.trips.slice(0, 1) : []
			}
		};
		expect(plan({ pattern: single }).error).toMatch(/No additional departure fits/);
		expect(plan({ pattern: undefined }).operations).toBeNull();
		expect(plan({ pattern: { ...route, timing: undefined } }).error).toMatch(
			/recorded stop sequence and timetable/
		);
		expect(plan({ date: '2026-10-11' }).error).toMatch(/No recorded departures/);
		expect(plan({ date: '2026-02-30' }).operations).toBeNull();
		expect(plan({ pattern: { ...route, enabled: false } }).error).toMatch(/disabled/);
	});

	it('keeps invalid intervals and full proposals out of quote and confirmation requests', () => {
		for (const headway of ['', ' ', 'abc', 0, -1, 721, NaN, Infinity])
			expect(plan({ headway }).operations).toBeNull();
		const full = Array.from({ length: 100 }, (_, index) => ({
			type: 'set_frequency',
			target_id: `line:${index}`,
			headway_minutes: 5
		}));
		expect(plan({ operations: full }).error).toMatch(/100-change limit/);
		expect(
			plan({
				intent: 'improve',
				headway: 15,
				operations: [
					...full.slice(0, 99),
					{ type: 'set_frequency', target_id: route.id, headway_minutes: 10 }
				]
			}).operations
		).toHaveLength(100);
	});
});
