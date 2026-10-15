import { describe, expect, it } from 'vitest';
import { DEFAULT_OVERLAY_OPACITY, overlayOpacityPreference } from './map-overlay.js';

describe('stored map opacity', () => {
	it('preserves deliberately hidden and fully opaque overlays', () => {
		expect(overlayOpacityPreference('0')).toBe(0);
		expect(overlayOpacityPreference('100')).toBe(100);
		expect(overlayOpacityPreference(35)).toBe(35);
	});

	it('bounds previously stored values without losing valid preferences', () => {
		expect(overlayOpacityPreference('-20')).toBe(0);
		expect(overlayOpacityPreference(150)).toBe(100);
		expect(overlayOpacityPreference('44.7')).toBe(45);
	});

	it.each([null, undefined, '', ' ', 'invalid', NaN, Infinity, {}, []])(
		'recovers the default from unavailable or malformed storage: %s',
		(value) => expect(overlayOpacityPreference(value)).toBe(DEFAULT_OVERLAY_OPACITY)
	);
});
