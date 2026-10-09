import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { BASEMAP_FETCH_TIMEOUT_MS, DEFAULT_BASEMAPS, MAP_COLORS } from '#lib/config/map.ts';
import type { BasemapCandidate, BasemapFailure } from '#lib/types/map.ts';

/** Layer types that add relief or height; the simulator is strictly 2D. */
const NON_2D_LAYER_TYPES: ReadonlySet<LayerSpecification['type']> = new Set([
	'fill-extrusion',
	'hillshade',
	'color-relief'
]);

export const OFFLINE_BASEMAP: BasemapCandidate = {
	id: 'offline',
	label: 'Offline background',
	url: ''
};

/** Last-resort style so the map (and future data layers) still render with no network basemap. */
export const OFFLINE_STYLE: StyleSpecification = {
	version: 8,
	sources: {},
	layers: [
		{
			id: 'background',
			type: 'background',
			paint: { 'background-color': MAP_COLORS.offlineBackground }
		}
	]
};

export function resolveBasemapCandidates(overrideUrl: string | undefined): BasemapCandidate[] {
	if (!overrideUrl) return [...DEFAULT_BASEMAPS];
	return [{ id: 'custom', label: 'Custom (MAP_STYLE_URL)', url: overrideUrl }, ...DEFAULT_BASEMAPS];
}

/** Strips anything that could introduce 3D or a globe, whatever style is supplied. */
export function enforce2dStyle(style: StyleSpecification): StyleSpecification {
	const sources = Object.fromEntries(
		Object.entries(style.sources).filter(([, source]) => source.type !== 'raster-dem')
	);
	const result: StyleSpecification = {
		...style,
		sources,
		layers: style.layers.filter((layer) => !NON_2D_LAYER_TYPES.has(layer.type)),
		projection: { type: 'mercator' },
		pitch: 0,
		bearing: 0
	};
	delete result.terrain;
	delete result.sky;
	return result;
}

/** OpenMapTiles source-layers whose fills sit on land and would otherwise blot out islands. */
const LAND_DETAIL_SOURCE_LAYERS: ReadonlySet<string> = new Set(['landcover', 'landuse', 'park']);
const LAND_DETAIL_OPACITY = 0.35;

/** Raises land/water contrast so reef islands read clearly on a dark basemap. */
export function applyHudPalette(style: StyleSpecification): StyleSpecification {
	return {
		...style,
		layers: style.layers.map((layer): LayerSpecification => {
			if (layer.type === 'background') {
				return { ...layer, paint: { ...layer.paint, 'background-color': MAP_COLORS.land } };
			}
			if (layer.type !== 'fill') return layer;
			if (layer['source-layer'] === 'water') {
				return { ...layer, paint: { ...layer.paint, 'fill-color': MAP_COLORS.water } };
			}
			if (LAND_DETAIL_SOURCE_LAYERS.has(layer['source-layer'] ?? '')) {
				return { ...layer, paint: { ...layer.paint, 'fill-opacity': LAND_DETAIL_OPACITY } };
			}
			return layer;
		})
	};
}

function isStyleSpecification(value: unknown): value is StyleSpecification {
	if (typeof value !== 'object' || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		v.version === 8 &&
		typeof v.sources === 'object' &&
		v.sources !== null &&
		Array.isArray(v.layers)
	);
}

export interface BasemapLoadResult {
	style: StyleSpecification;
	basemap: BasemapCandidate;
	failures: BasemapFailure[];
}

/**
 * Fetches the first reachable, valid style from the candidates. Fetching here rather than
 * handing MapLibre a URL lets us fall back cleanly and sanitise the style before first render.
 */
export async function loadBasemapStyle(
	candidates: readonly BasemapCandidate[],
	fetchFn: typeof fetch = fetch
): Promise<BasemapLoadResult> {
	const failures: BasemapFailure[] = [];

	for (const candidate of candidates) {
		try {
			const response = await fetchFn(candidate.url, {
				signal: AbortSignal.timeout(BASEMAP_FETCH_TIMEOUT_MS)
			});
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const json: unknown = await response.json();
			if (!isStyleSpecification(json)) throw new Error('Not a MapLibre v8 style');
			const flat = enforce2dStyle(json);
			const style = candidate.applyHudPalette ? applyHudPalette(flat) : flat;
			return { style, basemap: candidate, failures };
		} catch (error) {
			failures.push({
				basemapId: candidate.id,
				reason: error instanceof Error ? error.message : String(error)
			});
		}
	}

	return { style: OFFLINE_STYLE, basemap: OFFLINE_BASEMAP, failures };
}
