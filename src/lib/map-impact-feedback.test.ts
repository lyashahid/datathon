import { describe, expect, it } from 'vitest';
import type { FeatureCollection } from 'geojson';
import { changedImpactCells } from './map-impact-feedback.js';

const mesh = (properties: Record<string, unknown> = {}): FeatureCollection => ({
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			id: 'cell-1',
			geometry: {
				type: 'Polygon',
				coordinates: [
					[
						[73, 4],
						[73.1, 4],
						[73, 4.1],
						[73, 4]
					]
				]
			},
			properties: {
				view: 'comparison',
				population: 100,
				before_access: 'beyond_target',
				after_access: 'within_target',
				before: 12,
				after: 6,
				before_color: '#d06040',
				after_color: '#208060',
				...properties
			}
		}
	]
});

describe('localized proposal impact feedback', () => {
	it('selects only changed evaluated cells and retains original geometry and evidence', () => {
		const current = mesh();
		const result = changedImpactCells(current);
		expect(result.features).toHaveLength(1);
		expect(result.features[0].geometry).toBe(current.features[0].geometry);
		expect(result.features[0].properties?.feedback_before_color).toBe('#d06040');
		expect(current.features[0].properties).not.toHaveProperty('feedback_before_color');
	});
	it('never celebrates missing evidence, uninhabited land or unchanged journeys', () => {
		for (const properties of [
			{ before_access: 'unknown' },
			{ after_access: 'unknown' },
			{ population: 0 },
			{ population: null },
			{ view: 'before' },
			{ before: 6, after: 6, before_access: 'within_target' }
		])
			expect(changedImpactCells(mesh(properties)).features).toHaveLength(0);
	});
	it('does not re-highlight cells whose proposal result is unchanged since the previous evaluation', () => {
		expect(changedImpactCells(mesh(), mesh()).features).toHaveLength(0);
		expect(changedImpactCells(mesh({ after: 4 }), mesh()).features).toHaveLength(1);
		expect(
			changedImpactCells(mesh({ after: 4 }), mesh()).features[0].properties?.feedback_before_color
		).toBe('#208060');
		expect(
			changedImpactCells(mesh({ after: 12, after_access: 'beyond_target' }), mesh()).features
		).toHaveLength(1);
	});
	it('accepts a verified new route and visible deterioration, but ignores tiny rounding noise', () => {
		expect(
			changedImpactCells(mesh({ before_access: 'unavailable', before: null })).features
		).toHaveLength(1);
		expect(
			changedImpactCells(mesh({ after: 16, after_access: 'beyond_target' })).features
		).toHaveLength(1);
		expect(
			changedImpactCells(mesh({ before: 6.01, after: 6, before_access: 'within_target' })).features
		).toHaveLength(0);
	});
});
