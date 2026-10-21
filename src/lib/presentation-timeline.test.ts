import { describe, expect, it } from 'vitest';
import {
	formatPresentationElapsed,
	formatPresentationElapsedMinutes,
	formatPresentationTotal,
	presentationJourneySummary,
	presentationPlaybackLegs,
	presentationPlaybackState,
	presentationTimeline
} from './presentation-timeline.js';
import type { Coordinates } from './types.js';

describe('timed presentation movement and waiting', () => {
	const legs = [
		{
			mode: 'walk' as const,
			minutes: 13.054,
			geometry: [
				[73.5404, 4.2371],
				[73.541, 4.23]
			] as Coordinates[]
		},
		{ mode: 'wait' as const, minutes: 31.946, geometry: [] },
		{
			mode: 'bus' as const,
			minutes: 6,
			geometry: [
				[73.541, 4.23],
				[73.5271, 4.1901]
			] as Coordinates[]
		},
		{
			mode: 'walk' as const,
			minutes: 0.396,
			geometry: [
				[73.5271, 4.1901],
				[73.527056, 4.190044]
			] as Coordinates[]
		}
	];
	const airportLegs = legs.slice(1);
	const weights = { wait: 3, bus: 6, walk: 1 };

	it('starts movement immediately with zero-weight waits while retaining their real elapsed time', () => {
		const timeline = presentationPlaybackLegs(
			[
				{ mode: 'wait', minutes: 1420 },
				{ ...legs[2], mode: 'ferry', minutes: 35 },
				{ mode: 'wait', minutes: 10 }
			],
			{ weights: { wait: 0, ferry: 4.5 } }
		);
		expect(timeline.map((leg) => leg.weight)).toEqual([0, 4.5, 0]);
		expect(presentationPlaybackState(0, timeline)).toMatchObject({
			mode: 'ferry',
			pathProgress: 0,
			stationary: false,
			elapsedMinutes: 1420,
			totalMinutes: 1465
		});
		expect(presentationPlaybackState(0.5, timeline)?.elapsedMinutes).toBe(1437.5);
		expect(presentationPlaybackState(1, timeline)).toMatchObject({
			pathProgress: 1,
			elapsedMinutes: 1465,
			clockProgress: 1
		});
		expect(
			presentationPlaybackState(
				0,
				timeline.map((leg) => ({ ...leg, weight: 0 }))
			)
		).toMatchObject({ elapsedMinutes: 1465, clockProgress: 1 });
	});

	it('holds at the boarding stop as the captured wait advances, then moves each timed path', () => {
		const timeline = presentationPlaybackLegs(airportLegs, { weights });
		expect(timeline.map(({ mode, pathIndex, weight }) => ({ mode, pathIndex, weight }))).toEqual([
			{ mode: 'wait', pathIndex: 0, weight: 3 },
			{ mode: 'bus', pathIndex: 0, weight: 6 },
			{ mode: 'walk', pathIndex: 1, weight: 1 }
		]);
		const waiting = presentationPlaybackState(0.15, timeline)!;
		expect(waiting).toMatchObject({
			mode: 'wait',
			pathIndex: 0,
			pathProgress: 0,
			stationary: true
		});
		expect(waiting.elapsedMinutes).toBeCloseTo(31.946 / 2);
		expect(presentationPlaybackState(0.29, timeline)?.pathProgress).toBe(0);
		const boarding = presentationPlaybackState(0.3, timeline)!;
		expect(boarding).toMatchObject({
			mode: 'bus',
			pathIndex: 0,
			pathProgress: 0,
			stationary: false
		});
		expect(boarding.elapsedMinutes).toBeCloseTo(31.946);
		const riding = presentationPlaybackState(0.6, timeline)!;
		expect(riding.pathProgress).toBeCloseTo(0.5);
		expect(riding.elapsedMinutes).toBeCloseTo(31.946 + 3);
		const terminal = presentationPlaybackState(0.95, timeline)!;
		expect(terminal).toMatchObject({ mode: 'walk', pathIndex: 1, stationary: false });
		expect(terminal.pathProgress).toBeCloseTo(0.5);
		expect(terminal.elapsedMinutes).toBeCloseTo(31.946 + 6 + 0.396 / 2);
		expect(presentationPlaybackState(1, timeline)).toMatchObject({
			pathProgress: 1,
			clockProgress: 1
		});
	});

	it('retains exact cumulative source time with visual weighting and deterministic replay', () => {
		const timeline = presentationPlaybackLegs(airportLegs, { weights });
		let previous = 0;
		for (const fraction of [0, 0.15, 0.3, 0.6, 0.9, 0.95, 1]) {
			const playback = presentationPlaybackState(fraction, timeline)!;
			const clock = presentationTimeline(9, playback.clockProgress, [
				{ step: 8, minutes: legs[0].minutes },
				{ step: 9, minutes: playback.totalMinutes }
			]);
			expect(clock.elapsedSeconds).toBeGreaterThanOrEqual(previous);
			expect(clock.elapsedSeconds).toBe(
				Math.floor((legs[0].minutes + playback.elapsedMinutes) * 60)
			);
			expect(clock.totalSeconds).toBe(Math.round(51.396 * 60));
			previous = clock.elapsedSeconds;
		}
		expect(presentationPlaybackState(0, timeline)).toMatchObject({
			elapsedMinutes: 0,
			pathProgress: 0
		});
		expect(presentationPlaybackState(-1, timeline)).toEqual(presentationPlaybackState(0, timeline));
		expect(presentationPlaybackState(NaN, timeline)).toEqual(
			presentationPlaybackState(0, timeline)
		);
		expect(presentationPlaybackState(2, timeline)).toEqual(presentationPlaybackState(1, timeline));
	});

	it('anchors trailing waits at the previous path end and shares weights across like modes', () => {
		const source = [legs[1], legs[2], { ...legs[1], minutes: 10 }];
		const before = structuredClone(source);
		const timeline = presentationPlaybackLegs(source, { weights });
		expect(timeline[0]).toMatchObject({ pathIndex: 0, holdAt: 'start' });
		expect(timeline[2]).toMatchObject({ pathIndex: 0, holdAt: 'end' });
		expect(
			timeline.filter((leg) => leg.mode === 'wait').reduce((sum, leg) => sum + leg.weight!, 0)
		).toBeCloseTo(3);
		expect(presentationPlaybackState(0.99, timeline)).toMatchObject({
			mode: 'wait',
			pathProgress: 1,
			stationary: true
		});
		expect(source).toEqual(before);
	});

	it('uses source minutes as the default visual weight and summarizes the full pickup', () => {
		const timeline = presentationPlaybackLegs(airportLegs);
		const halfWait = 31.946 / 2 / (31.946 + 6 + 0.396);
		expect(presentationPlaybackState(halfWait, timeline)).toMatchObject({
			mode: 'wait',
			pathProgress: 0
		});
		expect(presentationPlaybackState(halfWait, timeline)?.elapsedMinutes).toBeCloseTo(31.946 / 2);
		const summary = presentationJourneySummary(legs);
		expect(summary.walkMinutes).toBeCloseTo(13.45);
		expect(summary.waitMinutes).toBeCloseTo(31.946);
		expect(summary.rideMinutes).toBe(6);
		expect(summary.totalMinutes).toBeCloseTo(51.396);
		expect(summary.incomplete).toBe(false);
	});

	it('keeps unavailable durations and missing moving geometry out of timed playback', () => {
		expect(presentationPlaybackLegs([])).toEqual([]);
		expect(presentationPlaybackLegs([legs[1]])).toEqual([]);
		expect(presentationPlaybackLegs([{ ...legs[2], geometry: [] }])).toEqual([]);
		for (const minutes of [null, undefined, NaN, Infinity, -1]) {
			const source = [legs[0], { ...legs[1], minutes }];
			expect(presentationPlaybackLegs(source)).toEqual([]);
			expect(presentationJourneySummary(source)).toMatchObject({
				waitMinutes: null,
				totalMinutes: null,
				incomplete: true
			});
		}
		expect(presentationJourneySummary([])).toEqual({
			walkMinutes: null,
			waitMinutes: null,
			rideMinutes: null,
			totalMinutes: null,
			incomplete: true
		});
		expect(presentationPlaybackState(0.5, [])).toBeNull();
	});
});

describe('persistent presentation journey clocks', () => {
	const arrival = [
		{ step: 2, minutes: 35 },
		{ step: 5, minutes: 45 }
	];
	const pickup = [
		{ step: 8, minutes: 13 },
		{ step: 9, minutes: 18 }
	];

	it('accumulates ferry and flight travel while holding between stages', () => {
		expect(presentationTimeline(0, 1, arrival).elapsedSeconds).toBe(0);
		expect(presentationTimeline(2, 0.5, arrival).elapsedSeconds).toBe(1050);
		expect(presentationTimeline(3, 1, arrival).elapsedSeconds).toBe(2100);
		expect(presentationTimeline(4, 0, arrival).elapsedSeconds).toBe(2100);
		expect(presentationTimeline(5, 0.5, arrival).elapsedSeconds).toBe(3450);
		expect(presentationTimeline(6, 0, arrival)).toEqual({
			elapsedSeconds: 4800,
			totalSeconds: 4800,
			incomplete: false
		});
	});

	it('keeps pickup at zero until walking begins and holds the arrival clock afterward', () => {
		expect(presentationTimeline(7, 1, pickup).elapsedSeconds).toBe(0);
		expect(presentationTimeline(8, 0.5, pickup).elapsedSeconds).toBe(390);
		expect(presentationTimeline(9, 0.5, pickup).elapsedSeconds).toBe(1320);
		expect(presentationTimeline(10, 0, pickup).elapsedSeconds).toBe(1860);
		expect(presentationTimeline(10, 0.9, arrival).elapsedSeconds).toBe(4800);
	});

	it('rewinds or replays deterministically and clamps invalid progress', () => {
		expect(presentationTimeline(2, 0, arrival).elapsedSeconds).toBe(0);
		expect(presentationTimeline(5, 0, arrival).elapsedSeconds).toBe(2100);
		expect(presentationTimeline(2, 2, arrival).elapsedSeconds).toBe(2100);
		expect(presentationTimeline(2, -1, arrival).elapsedSeconds).toBe(0);
		expect(presentationTimeline(2, NaN, arrival).elapsedSeconds).toBe(0);
	});

	it('keeps missing durations unknown instead of adding playback seconds to travel minutes', () => {
		const partial = [
			{ step: 2, minutes: 35 },
			{ step: 5, minutes: null }
		];
		expect(presentationTimeline(3, 0, partial)).toEqual({
			elapsedSeconds: 2100,
			totalSeconds: null,
			incomplete: false
		});
		expect(presentationTimeline(5, 0.5, partial)).toEqual({
			elapsedSeconds: 2100,
			totalSeconds: null,
			incomplete: true
		});
		for (const minutes of [NaN, Infinity, -2, undefined]) {
			expect(presentationTimeline(10, 1, [{ step: 2, minutes }]).totalSeconds).toBeNull();
		}
	});

	it('formats elapsed and total time without wrapping hours or displaying NaN', () => {
		expect(formatPresentationElapsed(0)).toBe('00:00');
		expect(formatPresentationElapsed(3599)).toBe('59:59');
		expect(formatPresentationElapsed(4800)).toBe('1:20:00');
		expect(formatPresentationElapsed(NaN)).toBe('00:00');
		expect(formatPresentationTotal(4800)).toBe('1h 20m');
		expect(formatPresentationTotal(2100)).toBe('35 min');
		expect(formatPresentationTotal(1439 * 60)).toBe('23h 59m');
		expect(formatPresentationTotal(1440 * 60)).toBe('1d 0h 0m');
		expect(formatPresentationTotal(1780 * 60)).toBe('1d 5h 40m');
		expect(formatPresentationTotal(null)).toBe('unconfirmed');
	});

	it('formats whole elapsed minutes for a calm presenter clock without rounding ahead', () => {
		expect(formatPresentationElapsedMinutes(0)).toBe('0 min');
		expect(formatPresentationElapsedMinutes(59.9)).toBe('0 min');
		expect(formatPresentationElapsedMinutes(3599)).toBe('59 min');
		expect(formatPresentationElapsedMinutes(3600)).toBe('1h 00m');
		expect(formatPresentationElapsedMinutes(3900)).toBe('1h 05m');
		expect(formatPresentationElapsedMinutes(7200)).toBe('2h 00m');
		expect(formatPresentationElapsedMinutes(1440 * 60 - 1)).toBe('23h 59m');
		expect(formatPresentationElapsedMinutes(1440 * 60)).toBe('1d 0h 00m');
		expect(formatPresentationElapsedMinutes(1780 * 60)).toBe('1d 5h 40m');
		expect(formatPresentationElapsedMinutes(NaN)).toBe('0 min');
		expect(formatPresentationElapsedMinutes(-5)).toBe('0 min');
	});
});
