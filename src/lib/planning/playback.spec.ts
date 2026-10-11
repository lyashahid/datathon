import { describe, expect, it } from 'vitest';
import { interpolatePlaybackGeometry, servicePlaybackFrame } from './playback.ts';
import type { PlanningServicePattern, PlanningStop } from './types.ts';

const stops: PlanningStop[] = [
	{ id: 'a', name: 'A', lon: 73.5, lat: 4.17, islandId: 'island', sourceIds: [] },
	{ id: 'b', name: 'B', lon: 73.502, lat: 4.172, islandId: 'island', sourceIds: [] }
];
const geometry: [number, number][] = [
	[73.5, 4.17],
	[73.502, 4.17],
	[73.502, 4.172]
];
function pattern(): PlanningServicePattern {
	return {
		id: 'line-out',
		routeId: 'line',
		name: 'Line outward',
		mode: 'bus',
		stopIds: ['a', 'b'],
		calendar: { weekdays: [6] },
		provenance: 'observed',
		sourceIds: ['operator'],
		segmentGeometry: [geometry],
		timing: {
			kind: 'scheduled',
			trips: [
				{
					id: 'trip-1',
					stopTimes: [
						{ arrivalMinutes: 480, departureMinutes: 482 },
						{ arrivalMinutes: 492, departureMinutes: 493 }
					]
				}
			]
		}
	};
}
const frame = (clockMinutes: number, selected = pattern()) =>
	servicePlaybackFrame({
		pattern: selected,
		stops,
		date: '2026-10-10',
		clockMinutes,
		sourceReferenceDate: '2026-10-10'
	});

describe('honest service illustration', () => {
	it('interpolates along the supplied bent path rather than directly between stops', () => {
		const result = frame(487);
		expect(result.status).toBe('moving');
		expect(result.features.features[0].geometry.coordinates[0]).toBeCloseTo(73.502, 5);
		expect(result.features.features[0].geometry.coordinates[1]).toBeCloseTo(4.17, 5);
		expect(result.label).toBe('Timetable illustration');
		expect(result.sourceLabel).toContain('No live vehicle observations');
		expect(result.features.features[0].properties.icon).toBe('playback-bus');
	});
	it('keeps positions fixed during dwell and uses exact boundary positions', () => {
		expect(frame(481).status).toBe('dwelling');
		expect(frame(482).features.features[0].geometry.coordinates).toEqual([73.5, 4.17]);
		expect(frame(492).features.features[0].geometry.coordinates).toEqual([73.502, 4.172]);
		expect(frame(479).status).toBe('inactive');
		expect(frame(494).features.features).toEqual([]);
	});
	it('does not invent straight geometry or use a reversed route', () => {
		const selected = pattern();
		delete selected.segmentGeometry;
		expect(frame(487, selected).status).toBe('unavailable');
		selected.segmentGeometry = [[...geometry].reverse()];
		expect(frame(487, selected).features.features).toEqual([]);
	});
	it('honors calendars, missing stops and disabled patterns', () => {
		expect(
			servicePlaybackFrame({ pattern: pattern(), stops, date: '2026-10-11', clockMinutes: 487 })
				.status
		).toBe('inactive');
		expect(frame(487, { ...pattern(), enabled: false }).status).toBe('inactive');
		expect(
			servicePlaybackFrame({
				pattern: pattern(),
				stops: stops.slice(0, 1),
				date: '2026-10-10',
				clockMinutes: 487
			}).status
		).toBe('unavailable');
	});
	it('labels frequency phases as illustration rather than observed dispatches', () => {
		const selected = pattern();
		selected.timing = {
			kind: 'frequency',
			segmentMinutes: [10],
			windows: [{ startMinutes: 480, endMinutes: 500, headwayMinutes: 20 }]
		};
		const result = frame(485, selected);
		expect(result.label).toBe('Frequency illustration');
		expect(result.features.features[0].properties.timing).toBe('frequency-illustration');
		expect(frame(495, selected).status).toBe('inactive');
	});
	it('supports supplied ferry geometry with a distinct symbol', () => {
		const result = frame(487, { ...pattern(), mode: 'ferry' });
		expect(result.features.features[0].properties.icon).toBe('playback-ferry');
	});
	it('prefers the selected trip detour rather than another trip’s pattern path', () => {
		const selected = pattern();
		if (selected.timing.kind !== 'scheduled') throw new Error('Expected scheduled fixture');
		selected.timing.trips[0].segmentGeometry = [
			[
				[73.5, 4.17],
				[73.5, 4.172],
				[73.502, 4.172]
			]
		];
		const result = frame(487, selected);
		expect(result.features.features[0].geometry.coordinates[0]).toBeCloseTo(73.5, 5);
		expect(result.features.features[0].geometry.coordinates[1]).toBeCloseTo(4.172, 5);
	});
	it('clamps interpolation boundaries and handles zero-length geometry', () => {
		expect(interpolatePlaybackGeometry(geometry, -1)?.coordinates).toEqual(geometry[0]);
		expect(interpolatePlaybackGeometry(geometry, 2)?.coordinates).toEqual(geometry.at(-1));
		expect(
			interpolatePlaybackGeometry(
				[
					[73.5, 4.17],
					[73.5, 4.17]
				],
				0.5
			)?.coordinates
		).toEqual([73.5, 4.17]);
		expect(interpolatePlaybackGeometry([[NaN, 4.17]], 0.5)).toBeNull();
	});
});
