import { describe, expect, it } from 'vitest';
import type { Feature, FeatureCollection } from 'geojson';
import {
	backgroundAccessGaps,
	DEFAULT_OVERLAY_OPACITY,
	overlayOpacityPreference
} from './map-overlay.js';

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

describe('capital region proposal background', () => {
	const cell = (island: string, id: string): Feature => ({
		type: 'Feature',
		geometry: { type: 'Point', coordinates: [73.5, 4.2] },
		properties: { island_id: island, id, transport_gap: 0.7 }
	});
	const collection = (...features: Feature[]): FeatureCollection => ({
		type: 'FeatureCollection',
		features
	});

	it('replaces only matching cells and keeps neighbours and uncovered cells unchanged', () => {
		const hulhumale = cell('island:1442', 'hex:1');
		const uncovered = cell('island:1442', 'hex:2');
		const male = cell('island:1443', 'hex:1');
		const gaps = collection(hulhumale, uncovered, male);
		const result = backgroundAccessGaps(gaps, collection(hulhumale));
		expect(result.features).toEqual([uncovered, male]);
		expect(result.features[1]).toBe(male);
		expect(gaps.features).toHaveLength(3);
	});

	it('restores the complete baseline without a proposal and retains unidentifiable evidence', () => {
		const gaps = collection(cell('island:1443', 'hex:1'));
		expect(backgroundAccessGaps(gaps, collection())).toBe(gaps);
		const missing = { ...gaps.features[0], properties: {} };
		expect(backgroundAccessGaps(collection(missing), gaps).features).toEqual([missing]);
	});
});
