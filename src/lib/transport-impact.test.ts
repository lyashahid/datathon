import { describe, expect, it } from 'vitest';
import {
	bestTransportWaitChange,
	changedIslandConnections,
	changedTransportLines,
	comparableWaitSaving,
	formatImpactClock,
	formatImpactDate,
	formatImpactMinutes,
	serviceAvailability,
	serviceNextDeparture,
	serviceNextWait,
	serviceTravelTime,
	serviceWait,
	transportImpactHeadline,
	type TransportImpactData,
	type TransportLineImpact
} from './transport-impact.js';

const frequency: TransportLineImpact = {
	id: 'route:r1:outward',
	name: 'R1',
	mode: 'bus',
	change: 'improved',
	expected_wait_comparable: true,
	before: { departure_count: 32, expected_wait_minutes: 15 },
	after: { departure_count: 64, expected_wait_minutes: 7.5 }
};

describe('proposal transport benefit presentation', () => {
	it('reports a route-specific waiting benefit even when walking coverage is unchanged', () => {
		const impact: TransportImpactData = {
			lines: [frequency],
			summary: { departures_before: 32, departures_after: 64 }
		};
		expect(transportImpactHeadline(impact)).toBe('7.5 min shorter expected wait · R1');
		expect(comparableWaitSaving(frequency)).toBe(7.5);
	});

	it('never claims saved waiting for an added service or incomparable operating windows', () => {
		expect(comparableWaitSaving({ ...frequency, change: 'added' })).toBeNull();
		expect(comparableWaitSaving({ ...frequency, expected_wait_comparable: false })).toBeNull();
		expect(
			comparableWaitSaving({ ...frequency, after: { expected_wait_minutes: null } })
		).toBeNull();
		expect(serviceWait(null)).toBe('No service listed for this date');
		expect(serviceWait({ departure_count: 10, expected_wait_minutes: null })).toBe('Not estimated');
	});

	it('reports a longer wait honestly rather than turning reductions into benefits', () => {
		const reduced: TransportLineImpact = {
			...frequency,
			change: 'worsened',
			before: frequency.after,
			after: frequency.before
		};
		expect(transportImpactHeadline({ lines: [reduced] })).toBe('7.5 min longer expected wait · R1');
		expect(
			bestTransportWaitChange({ lines: [reduced, { ...frequency, id: 'other' }] })?.line.id
		).toBe('other');
	});

	it('counts directional links without presenting an added ferry as a measured passenger gain', () => {
		const impact: TransportImpactData = {
			lines: [{ ...frequency, change: 'added', before: null }],
			connections: [
				{
					id: 'male-hulhumale',
					mode: 'ferry',
					from_island_id: 'male',
					to_island_id: 'hulhumale',
					from_island_name: 'Malé',
					to_island_name: 'Hulhumalé',
					change: 'added',
					before: null,
					after: { departure_count: 12, expected_wait_minutes: 30, crossing_minutes: 20 }
				}
			]
		};
		expect(transportImpactHeadline(impact)).toBe('1 new island-to-island direction');
		expect(serviceAvailability(impact.connections![0].after)).toBe('12 departures');
		expect(serviceAvailability(impact.connections![0].before)).toBe(
			'No service listed for this date'
		);
		expect(serviceAvailability(undefined)).toBe('Service details unavailable');
		expect(serviceTravelTime(null)).toBe('No service');
		expect(serviceTravelTime({ departure_count: 12 })).toBe('Not estimated');
	});

	it('keeps unchanged lines out of a concise proposal comparison', () => {
		const impact = {
			lines: [frequency, { ...frequency, id: 'other', change: 'unchanged' as const }]
		};
		expect(changedTransportLines(impact)).toEqual([frequency]);
		expect(changedIslandConnections(impact)).toEqual([]);
		expect(transportImpactHeadline(undefined)).toBeNull();
		expect(transportImpactHeadline({ lines: [] })).toBeNull();
	});

	it('shows departures as a fallback when expected waiting is not comparable', () => {
		expect(
			transportImpactHeadline({
				lines: [{ ...frequency, expected_wait_comparable: false }],
				summary: { departures_before: 32, departures_after: 48 }
			})
		).toBe('16 more scheduled departures on this date');
		expect(
			transportImpactHeadline({ summary: { departures_before: 32, departures_after: 16 } })
		).toBe('16 fewer scheduled departures on this date');
	});

	it('does not display invalid or absent timings as zero waiting', () => {
		expect(formatImpactMinutes(null)).toBe('Not estimated');
		expect(formatImpactMinutes(Number.NaN)).toBe('Not estimated');
		expect(formatImpactMinutes(-1)).toBe('Not estimated');
		expect(formatImpactMinutes(0)).toBe('0 min');
		expect(formatImpactMinutes(12.345)).toBe('12.3 min');
		expect(formatImpactClock(null)).toBe('No upcoming departure');
		expect(formatImpactClock(1445)).toBe('00:05 (+1 day)');
		expect(formatImpactClock(8 * 60)).toBe('08:00');
		expect(formatImpactDate('2026-10-16')).toBe('16 Oct 2026');
		expect(formatImpactDate('2026-02-30')).toBe('Selected date');
	});

	it('distinguishes multiple boarding locations from a genuinely finished timetable', () => {
		const multiple = { departure_count: 100, boarding_stop_ids: ['terminal-a', 'terminal-b'] };
		expect(serviceNextDeparture(multiple)).toBe('Varies by boarding stop');
		expect(serviceNextWait(multiple)).toBe('Varies by boarding stop');
		expect(serviceNextDeparture(null)).toBe('No service listed for this date');
		expect(serviceNextDeparture({ departure_count: 2, next_departure_minutes: null })).toBe(
			'No upcoming departure'
		);
		expect(serviceNextDeparture({ departure_count: 2, next_departure_minutes: 480 })).toBe('08:00');
		expect(serviceNextWait({ departure_count: 2, next_wait_minutes: 0 })).toBe('0 min');
	});
});
