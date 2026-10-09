import { describe, expect, it } from 'vitest';
import { getInfoView, type EnvironmentInfoView } from '#lib/config/infoViews.ts';
import type { MarineSnapshot, SampleGrid, WeatherSnapshot } from '#lib/types/weather.ts';
import { environmentToGeoJSON } from './environmentLayers.ts';

const source = { providerId: 'test', name: 'Test', url: 'https://example.test', kind: 'forecast' };
const weather = (precipitationMm: number | null, windDirectionDeg = 90) =>
	({ precipitationMm, windSpeedKph: 12, windDirectionDeg }) as WeatherSnapshot;

const grid = {
	kind: 'weather',
	spacingDeg: 0.1,
	validAt: '2026-10-09T16:30:00.000Z',
	source,
	samples: [
		{ latitude: 4, longitude: 73, snapshot: weather(2) },
		{ latitude: 4.1, longitude: 73, snapshot: weather(null) },
		{ latitude: 4.2, longitude: 73, snapshot: null }
	]
} as unknown as SampleGrid<WeatherSnapshot>;

describe('environmentToGeoJSON', () => {
	it('emits one square cell and one point per sample with a value, skipping gaps', () => {
		const fc = environmentToGeoJSON(getInfoView('rain') as EnvironmentInfoView, grid);
		expect(fc.features).toHaveLength(2);
		const [cell, point] = fc.features;
		expect(cell.properties).toEqual({ kind: 'cell', value: 2 });
		expect(cell.geometry).toEqual({
			type: 'Polygon',
			coordinates: [
				[
					[72.95, 3.95],
					[73.05, 3.95],
					[73.05, 4.05],
					[72.95, 4.05],
					[72.95, 3.95]
				]
			]
		});
		expect(point.properties).toEqual({ kind: 'point', value: 2, direction: 90 });
	});

	it('reads the metric of the active view', () => {
		const marine = {
			...grid,
			kind: 'marine',
			samples: [{ latitude: 4, longitude: 73, snapshot: { waveHeightM: 1.2 } as MarineSnapshot }]
		} as unknown as SampleGrid<MarineSnapshot>;
		const fc = environmentToGeoJSON(getInfoView('marineConditions') as EnvironmentInfoView, marine);
		expect(fc.features[0].properties?.value).toBe(1.2);
	});
});
