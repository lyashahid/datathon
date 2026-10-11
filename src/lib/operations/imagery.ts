import type { BasemapLoadResult } from '#lib/components/planning/basemaps.ts';
import type { AnnualImageryEvidence } from './types.ts';

export type AnnualImageryYear = 2020 | 2025;

/** The locally cached WMTS catalogue verifies year and geometry; raster tiles remain online. */
export function makeAnnualImageryStyle(
	year: AnnualImageryYear,
	evidence: AnnualImageryEvidence | undefined
): BasemapLoadResult {
	const mosaic = evidence?.mosaics.find((entry) => entry.year === year);
	const expected = `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${year}_3857/default/g/{z}/{y}/{x}.jpg`;
	if (!mosaic || mosaic.tileUrl !== expected || evidence?.interpretation !== 'visual-context-only')
		throw new Error(`${year} satellite mosaic is unavailable in the cached source catalogue.`);
	const attribution = `<a href="https://cloudless.eox.at/" target="_blank" rel="noopener noreferrer">EOxCloudless</a> by <a href="https://eox.at/" target="_blank" rel="noopener noreferrer">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data ${year}) · <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-NC-SA 4.0</a>`;
	return {
		mode: 'satellite',
		sources: {
			'basemap-satellite': {
				type: 'raster',
				tiles: [expected],
				tileSize: mosaic.tileSize,
				maxzoom: mosaic.maxZoom,
				attribution
			}
		},
		layers: [{ id: 'basemap-satellite', type: 'raster', source: 'basemap-satellite' }],
		attribution,
		captureAllowed: false
	};
}
