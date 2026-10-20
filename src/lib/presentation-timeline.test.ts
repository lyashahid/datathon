import { describe, expect, it } from 'vitest';
import {
	formatPresentationElapsed,
	formatPresentationTotal,
	presentationTimeline
} from './presentation-timeline.js';

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
		expect(formatPresentationTotal(null)).toBe('unconfirmed');
	});
});
