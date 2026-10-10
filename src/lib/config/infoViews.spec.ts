import { describe, expect, it } from 'vitest';
import type { H3Cell } from '#lib/types/h3.ts';
import { getInfoView, INFO_VIEWS, isExternalMetric } from './infoViews.ts';

/** The map ramp and the legend are both drawn from these definitions, so they must be sound. */
describe('info view definitions', () => {
	it('have unique ids and resolve by id', () => {
		expect(new Set(INFO_VIEWS.map((v) => v.id)).size).toBe(INFO_VIEWS.length);
		for (const v of INFO_VIEWS) expect(getInfoView(v.id)).toBe(v);
	});

	it('use strictly ascending stops (MapLibre interpolate and the legend both need this)', () => {
		for (const v of INFO_VIEWS) {
			const values = v.scale.stops.map(([value]) => value);
			expect(values.length).toBeGreaterThanOrEqual(3);
			values.slice(1).forEach((value, i) => expect(value).toBeGreaterThan(values[i]));
		}
	});

	it('read a real cell metric, or an external one supplied by the map stage', () => {
		const sample: Partial<Record<keyof H3Cell, number>> = {
			populationDensity: 0,
			transportAccessibility: 0,
			healthAccessibility: 0,
			educationAccessibility: 0,
			underservedPopulation: 0
		};
		for (const v of INFO_VIEWS) {
			if (v.layer === 'grid') {
				expect(isExternalMetric(v.metric) || v.metric in sample).toBe(true);
			} else {
				const forecast =
					v.sample === 'weather' ? ['precipitationMm', 'windSpeedKph'] : ['waveHeightM'];
				expect(forecast).toContain(v.metric);
			}
		}
	});

	it('give change views a comparison source and categorical views ascending categories', () => {
		for (const v of INFO_VIEWS) {
			if (v.layer === 'grid' && v.metric === 'overallChange') expect(v.compare).toBeDefined();
			if (v.layer === 'environment' && v.categories) {
				const mins = v.categories.map((c) => c.min);
				expect([...mins].sort((a, b) => a - b)).toEqual(mins);
			}
		}
	});
});
