import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { OperationsBundle } from './types.ts';
import { makeAnnualImageryStyle } from './imagery.ts';

describe('dated earth-observation context', () => {
	it('uses cached year-specific EOX metadata with exact attribution and no live metadata call', async () => {
		const bundle: OperationsBundle = JSON.parse(
			await readFile('data/public/operations/bundle.json', 'utf8')
		);
		for (const year of [2020, 2025] as const) {
			const style = makeAnnualImageryStyle(year, bundle.earthObservation);
			expect(style.sources['basemap-satellite']).toMatchObject({
				type: 'raster',
				tiles: [
					`https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${year}_3857/default/g/{z}/{y}/{x}.jpg`
				],
				maxzoom: 14
			});
			expect(style.attribution).toContain(`Sentinel data ${year}`);
			expect(style.attribution).toContain('CC BY-NC-SA 4.0');
			expect(style.captureAllowed).toBe(false);
		}
	});
	it('missing or altered metadata cannot masquerade as verified imagery', () => {
		expect(() => makeAnnualImageryStyle(2020, undefined)).toThrow('unavailable');
		expect(() =>
			makeAnnualImageryStyle(2020, {
				interpretation: 'visual-context-only',
				qualification: 'context',
				mosaics: [
					{
						id: 'wrong',
						year: 2020,
						tileUrl: 'https://example.org/{z}',
						tileSize: 256,
						maxZoom: 14,
						sourceId: 'unverified',
						attribution: 'unknown',
						licenseUrl: 'unknown'
					}
				]
			})
		).toThrow('unavailable');
	});
});
