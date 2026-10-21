import { describe, expect, it } from 'vitest';
import {
	presentationCameraProfile,
	presentationDamping,
	presentationDampedBearing,
	presentationFollowPoint,
	presentationOutsideSafeFrame,
	presentationSafeFrame,
	presentationTravelEnvelope
} from './presentation-camera.js';

describe('continuous presentation tracking', () => {
	it('has the same damping response regardless of the frame rate', () => {
		const simulate = (frames: number) => {
			let position = 0;
			for (let index = 0; index < frames; index++)
				position += (100 - position) * presentationDamping(1000 / frames);
			return position;
		};
		expect(simulate(30)).toBeCloseTo(simulate(60), 10);
		expect(simulate(120)).toBeCloseTo(simulate(60), 10);
		expect(presentationDamping(0)).toBe(0);
		expect(presentationDamping(NaN)).toBe(0);
	});

	it('turns continuously across north instead of rotating almost a full circle', () => {
		const bearing = presentationDampedBearing(359, 1, 16);
		expect(bearing).toBeGreaterThan(359);
		expect(bearing).toBeLessThan(361);
		expect(presentationDampedBearing(1, 359, 16)).toBeLessThan(1);
		expect(presentationDampedBearing(20, NaN, 16)).toBe(20);
	});

	it('leaves the departure frame continuously and tracks every target movement', () => {
		expect(presentationFollowPoint([10, 20], [8, 18], [8, 18], 0)).toEqual([10, 20]);
		expect(presentationFollowPoint([10, 20], [8, 18], [9, 19], 0.28)).toEqual([9, 19]);
		const a = presentationFollowPoint([10, 20], [8, 18], [9, 19], 0.6);
		const b = presentationFollowPoint([10, 20], [8, 18], [9.001, 19.001], 0.601);
		expect(b[0] - a[0]).toBeCloseTo(0.001);
		expect(b[1] - a[1]).toBeCloseTo(0.001);
		const before = presentationFollowPoint([10, 20], [8, 18], [9, 19], 0.28 - 1e-6);
		expect(Math.abs(before[0] - a[0])).toBeLessThan(1e-8);
	});
});

describe('presentation travel camera envelope', () => {
	it('keeps distinct ferry and flight framing continuous from departure through arrival', () => {
		const ferry = presentationCameraProfile('ferry');
		const air = presentationCameraProfile('air');
		expect(ferry.cruiseZoom).toBeGreaterThan(air.cruiseZoom);
		expect(ferry.lookAheadMs).toBeGreaterThan(air.lookAheadMs);
		expect(air.departureEnd).toBeLessThan(ferry.departureEnd);
		for (const mode of ['ferry', 'air'] as const) {
			const profile = presentationCameraProfile(mode);
			expect(presentationTravelEnvelope(0, mode)).toBe(0);
			expect(presentationTravelEnvelope(1, mode)).toBe(0);
			expect(presentationTravelEnvelope(profile.departureEnd, mode)).toBe(1);
			expect(presentationTravelEnvelope(profile.arrivalStart, mode)).toBe(1);
			expect(presentationFollowPoint([10, 20], [8, 18], [8, 18], 0, mode)).toEqual([10, 20]);
			expect(
				presentationFollowPoint([10, 20], [8, 18], [9, 19], profile.departureBlendEnd, mode)
			).toEqual([9, 19]);
			const delta = 0.00001;
			for (const join of [0, profile.departureEnd, profile.arrivalStart, 1]) {
				const velocity =
					(presentationTravelEnvelope(join + delta, mode) -
						presentationTravelEnvelope(join - delta, mode)) /
					(2 * delta);
				expect(Math.abs(velocity)).toBeLessThan(0.001);
			}
		}
	});

	it('holds a steady cruise between smooth departure and arrival', () => {
		expect(presentationTravelEnvelope(0)).toBe(0);
		expect(presentationTravelEnvelope(0.11)).toBeCloseTo(0.5);
		expect(presentationTravelEnvelope(0.22)).toBe(1);
		expect(presentationTravelEnvelope(0.5)).toBe(1);
		expect(presentationTravelEnvelope(0.76)).toBe(1);
		expect(presentationTravelEnvelope(0.88)).toBeCloseTo(0.5);
		expect(presentationTravelEnvelope(1)).toBe(0);
	});

	it('never reverses within departure or arrival and joins cruise without a velocity jump', () => {
		const departure = Array.from({ length: 23 }, (_, index) =>
			presentationTravelEnvelope(index / 100)
		);
		const arrival = Array.from({ length: 25 }, (_, index) =>
			presentationTravelEnvelope(0.76 + index / 100)
		);
		expect(departure).toEqual([...departure].sort((a, b) => a - b));
		expect(arrival).toEqual([...arrival].sort((a, b) => b - a));
		const delta = 0.00001;
		for (const join of [0, 0.22, 0.76, 1]) {
			const velocity =
				(presentationTravelEnvelope(join + delta) - presentationTravelEnvelope(join - delta)) /
				(2 * delta);
			expect(Math.abs(velocity)).toBeLessThan(0.001);
		}
	});

	it('clamps out-of-range progress and keeps invalid input finite', () => {
		for (const progress of [-2, 2, NaN, Infinity, -Infinity]) {
			expect(presentationTravelEnvelope(progress)).toBe(0);
		}
	});
});

describe('presentation safe frame', () => {
	it('centers a generous safe area within the canvas left visible by an inspector', () => {
		const frame = presentationSafeFrame(1440, 1000, {
			left: 64,
			right: 458,
			top: 184,
			bottom: 104
		});
		expect(frame.left).toBeCloseTo(247.6);
		expect(frame.right).toBeCloseTo(798.4);
		expect(frame.top).toBeCloseTo(312.16);
		expect(frame.bottom).toBeCloseTo(767.84);
		expect((frame.left + frame.right) / 2).toBe(523);
	});

	it('retains a finite, non-inverted frame on constrained mobile canvases', () => {
		for (const [width, height] of [
			[390, 844],
			[390, 280],
			[0, 0]
		]) {
			const frame = presentationSafeFrame(width, height, {
				left: 24,
				right: 24,
				top: 176,
				bottom: 460
			});
			expect(Object.values(frame).every(Number.isFinite)).toBe(true);
			expect(frame.left).toBeGreaterThanOrEqual(0);
			expect(frame.right).toBeLessThanOrEqual(width);
			expect(frame.top).toBeGreaterThanOrEqual(0);
			expect(frame.bottom).toBeLessThanOrEqual(height);
			expect(frame.right).toBeGreaterThanOrEqual(frame.left);
			expect(frame.bottom).toBeGreaterThanOrEqual(frame.top);
		}
	});

	it('ignores invalid padding rather than propagating NaN', () => {
		expect(
			presentationSafeFrame(100, 100, { left: NaN, right: -10, top: Infinity, bottom: 0 })
		).toEqual({ left: 20, right: 80, top: 18, bottom: 82 });
	});

	it('allows points on the frame edge and requests correction only outside it', () => {
		const frame = { left: 20, right: 80, top: 18, bottom: 82 };
		for (const point of [
			{ x: 20, y: 18 },
			{ x: 80, y: 82 },
			{ x: 50, y: 50 }
		])
			expect(presentationOutsideSafeFrame(point, frame)).toBe(false);
		for (const point of [
			{ x: 19, y: 50 },
			{ x: 81, y: 50 },
			{ x: 50, y: 17 },
			{ x: 50, y: 83 },
			{ x: NaN, y: 50 }
		])
			expect(presentationOutsideSafeFrame(point, frame)).toBe(true);
	});
});
