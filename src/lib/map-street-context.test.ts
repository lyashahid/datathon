import { describe, expect, it } from 'vitest';
import {
	canReuseStreetBounds,
	containsStreetBounds,
	streetContextBounds,
	type StreetBounds
} from './map-street-context.js';

describe('street context coverage', () => {
	it('uses the same complete capital envelope for either city', () => {
		const male: StreetBounds = [73.47, 4.16, 73.54, 4.2];
		const hulhumale: StreetBounds = [73.52, 4.19, 73.57, 4.26];
		expect(streetContextBounds(male)).toEqual([73.46, 4.15, 73.59, 4.28]);
		expect(streetContextBounds(hulhumale)).toEqual(streetContextBounds(male));
		expect(containsStreetBounds(streetContextBounds(male)!, hulhumale)).toBe(true);
		expect(canReuseStreetBounds(streetContextBounds(male)!, hulhumale)).toBe(true);
	});

	it('loads the complete capital region when entering it from an adjacent padded viewport', () => {
		const previous = streetContextBounds([73.6, 4.2, 73.65, 4.25])!;
		const viewport: StreetBounds = [73.589, 4.2, 73.639, 4.25];
		expect(containsStreetBounds(previous, viewport)).toBe(true);
		expect(canReuseStreetBounds(previous, viewport)).toBe(false);
		expect(canReuseStreetBounds(streetContextBounds(viewport)!, viewport)).toBe(true);
	});

	it('reuses padded coverage for small pans on other islands', () => {
		const previous = streetContextBounds([73.07, -0.66, 73.12, -0.57])!;
		expect(canReuseStreetBounds(previous, [73.08, -0.65, 73.13, -0.56])).toBe(true);
		expect(canReuseStreetBounds(previous, [73.1, -0.65, 73.15, -0.56])).toBe(false);
	});

	it('keeps neighbouring capital streets when the viewport extends beyond the region', () => {
		const viewport: StreetBounds = [73.55, 4.2, 73.62, 4.25];
		const result = streetContextBounds(viewport)!;
		expect(containsStreetBounds(result, viewport)).toBe(true);
		expect(containsStreetBounds(result, [73.46, 4.15, 73.59, 4.28])).toBe(true);
		expect(result[0]).toBeLessThan(73.46);
		expect(result[2]).toBeGreaterThan(73.62);
	});

	it('pads an independent Hithadhoo street viewport by one quarter on each side', () => {
		const viewport: StreetBounds = [73.07, -0.66, 73.12, -0.57];
		const result = streetContextBounds(viewport)!;
		expect(containsStreetBounds(result, viewport)).toBe(true);
		expect(result[0]).toBeCloseTo(73.0575, 5);
		expect(result[1]).toBeCloseTo(-0.6825, 5);
		expect(result[2]).toBeCloseTo(73.1325, 5);
		expect(result[3]).toBeCloseTo(-0.5475, 5);
	});

	it.each<StreetBounds>([
		[NaN, 4, 73.1, 4.1],
		[73, 4, Infinity, 4.1],
		[73, 4, 73, 4.1],
		[73.1, 4, 73, 4.1],
		[73, 4.1, 73.1, 4],
		[72, 4, 73.1, 4.1],
		[73, 3, 73.1, 4.1],
		[-181, 4, -180.5, 4.1],
		[73, 89.5, 73.1, 90.1],
		[-180, -90, 180, 90]
	])('rejects invalid or oversized viewports: %s', (...coordinates) => {
		expect(streetContextBounds(coordinates as StreetBounds)).toBeNull();
	});

	it('caps padding at the API limit while retaining the complete viewport', () => {
		const viewport: StreetBounds = [70.1234561, 1.1234561, 71.0234561, 2.0234561];
		const result = streetContextBounds(viewport)!;
		expect(containsStreetBounds(result, viewport)).toBe(true);
		expect(result[2] - result[0]).toBeLessThanOrEqual(1);
		expect(result[3] - result[1]).toBeLessThanOrEqual(1);
		expect(result.every((value) => Number(value.toFixed(6)) === value)).toBe(true);
	});

	it('rounds outwards at six decimals without clipping narrow viewports', () => {
		const viewport: StreetBounds = [70.00000001, -0.00000049, 70.00000002, -0.00000048];
		const result = streetContextBounds(viewport)!;
		expect(containsStreetBounds(result, viewport)).toBe(true);
		expect(result.every((value) => Number(value.toFixed(6)) === value)).toBe(true);
	});

	it('does not send an oversized query when outward rounding itself exceeds one degree', () => {
		expect(streetContextBounds([70.1234561, 1, 71.1234561, 1.1])).toBeNull();
		expect(streetContextBounds([70.123456, 1, 71.123456, 1.1])).not.toBeNull();
	});

	it('clamps padding to WGS84 edges and rejects false containment', () => {
		const viewport: StreetBounds = [179.9, 89.9, 180, 90];
		const result = streetContextBounds(viewport)!;
		expect(containsStreetBounds(result, viewport)).toBe(true);
		expect(result[2]).toBe(180);
		expect(result[3]).toBe(90);
		expect(containsStreetBounds([73, 4, 73.1, 4.1], [73, 4, 73.2, 4.1])).toBe(false);
	});
});
