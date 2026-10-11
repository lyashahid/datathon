import type {
	LayerSpecification,
	RasterSourceSpecification,
	SourceSpecification,
	StyleSpecification,
	SymbolLayerSpecification
} from 'maplibre-gl';

export type BasemapMode = 'atlas' | 'streets' | 'satellite';

/** Remove only these layers/sources when changing basemaps; retain the atlas overlays. */
export const BASEMAP_PREFIX = 'basemap-';
export const OPENFREEMAP_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

const configuredKey = String(import.meta.env.VITE_MAPTILER_KEY ?? '').trim();
/** Satellite is available without a key; a configured key selects the optional MapTiler upgrade. */
export const satelliteConfigured = true;
export const EOX_SATELLITE_TILES_URL =
	'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg';
export const SATELLITE_DETAIL = configuredKey
	? 'MapTiler satellite · imagery dates vary'
	: 'Sentinel-2 · 2025 mosaic · 10 m';
export const SATELLITE_LICENSE_NOTICE = configuredKey
	? 'MapTiler provider license and plan apply.'
	: 'Free for noncommercial use · CC BY-NC-SA 4.0.';
export const SATELLITE_LICENSE_URL = configuredKey
	? 'https://www.maptiler.com/terms/cloud/'
	: 'https://creativecommons.org/licenses/by-nc-sa/4.0/';

const EOX_ATTRIBUTION =
	'<a href="https://cloudless.eox.at/" target="_blank" rel="noopener noreferrer">EOxCloudless</a> by <a href="https://eox.at/" target="_blank" rel="noopener noreferrer">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data 2025) · <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener noreferrer">CC BY-NC-SA 4.0</a>';
const MAPTILER_ATTRIBUTION =
	'© <a href="https://www.maptiler.com/copyright/" target="_blank" rel="noopener noreferrer">MapTiler</a>';

export const BASEMAP_ATTRIBUTION = {
	atlas:
		'Data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
	streets:
		'<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> · © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">OpenMapTiles</a> · Data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>',
	satellite: configuredKey ? MAPTILER_ATTRIBUTION : EOX_ATTRIBUTION
} satisfies Record<BasemapMode, string>;

export interface BasemapLoadResult {
	mode: BasemapMode;
	sources: Record<string, SourceSpecification>;
	layers: LayerSpecification[];
	/** Set with MapLibre's setGlyphs before adding the retained text layers. */
	glyphs?: string;
	/** Provider sprite metadata. Retained street layers have no sprite dependencies. */
	sprite?: string;
	/** Display this credit on the map; satellite includes imagery-specific provider credits. */
	attribution: string;
	/** App policy: satellite views use local Atlas geometry for policy-brief captures. */
	captureAllowed: boolean;
	unavailableReason?: string;
}

export interface BasemapLoadOptions {
	fetchFn?: typeof fetch;
	signal?: AbortSignal;
	/** Useful for testing or a separately configured client; never log this value. */
	maptilerKey?: string;
}

const TEXT_SOURCE_LAYERS = new Set(['transportation_name', 'place', 'water_name', 'waterway']);
const PLANAR_LAYER_TYPES = new Set(['background', 'fill', 'line', 'symbol', 'circle']);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHttpsUrl(value: unknown): value is string {
	if (typeof value !== 'string') return false;
	try {
		return new URL(value).protocol === 'https:';
	} catch {
		return false;
	}
}

async function fetchJson(
	url: string,
	label: string,
	options: BasemapLoadOptions
): Promise<unknown> {
	let response: Response;
	try {
		response = await (options.fetchFn ?? fetch)(url, {
			signal: options.signal ?? AbortSignal.timeout(9_000)
		});
	} catch {
		// Native fetch errors can include the URL and its API key. Keep errors safe to display.
		throw new Error(`${label} could not load. Check your connection and try again.`);
	}
	if (!response.ok) throw new Error(`${label} could not load (HTTP ${response.status}).`);
	try {
		return await response.json();
	} catch {
		throw new Error(`${label} returned invalid JSON.`);
	}
}

function parseStreetStyle(value: unknown): StyleSpecification {
	if (
		!isRecord(value) ||
		value.version !== 8 ||
		!isRecord(value.sources) ||
		!Array.isArray(value.layers)
	) {
		throw new Error('Street map returned an invalid MapLibre style.');
	}
	const ids = new Set<string>();
	for (const layer of value.layers) {
		if (
			!isRecord(layer) ||
			typeof layer.id !== 'string' ||
			!layer.id ||
			typeof layer.type !== 'string'
		) {
			throw new Error('Street map returned an invalid layer.');
		}
		if (ids.has(layer.id)) throw new Error('Street map returned duplicate layer IDs.');
		ids.add(layer.id);
		if (
			layer.type !== 'background' &&
			(typeof layer.source !== 'string' || !Object.hasOwn(value.sources, layer.source))
		) {
			throw new Error('Street map returned a layer with a missing source.');
		}
	}
	for (const source of Object.values(value.sources)) {
		if (!isRecord(source) || typeof source.type !== 'string') {
			throw new Error('Street map returned an invalid source.');
		}
		if (source.type === 'vector' || source.type === 'raster') {
			const validTiles =
				Array.isArray(source.tiles) && source.tiles.length > 0 && source.tiles.every(isHttpsUrl);
			if (!isHttpsUrl(source.url) && !validTiles) {
				throw new Error('Street map returned an invalid tile source.');
			}
		}
	}
	return value as unknown as StyleSpecification;
}

function textOnlyLayer(layer: SymbolLayerSpecification): SymbolLayerSpecification | null {
	const sourceLayer = layer['source-layer'];
	if (!sourceLayer || !TEXT_SOURCE_LAYERS.has(sourceLayer) || !layer.layout?.['text-field'])
		return null;
	// Road shields need a provider sprite; ordinary street names are clearer at this scale.
	if (sourceLayer === 'transportation_name' && layer.layout['icon-image'] !== undefined)
		return null;
	const result = structuredClone(layer);
	for (const field of ['layout', 'paint'] as const) {
		const properties = result[field];
		if (!properties) continue;
		for (const key of Object.keys(properties)) {
			if (key.startsWith('icon-')) delete (properties as Record<string, unknown>)[key];
		}
	}
	return result;
}

function importStreetStyle(style: StyleSpecification): BasemapLoadResult {
	const layers: LayerSpecification[] = [];
	const usedSources = new Set<string>();
	for (const original of style.layers) {
		if (!PLANAR_LAYER_TYPES.has(original.type)) continue;
		if ('source-layer' in original && original['source-layer'] === 'poi') continue;
		const layer: LayerSpecification | null =
			original.type === 'symbol' ? textOnlyLayer(original) : structuredClone(original);
		if (!layer) continue;
		if ('source' in layer) {
			const source = style.sources[layer.source];
			if (source.type !== 'vector' && source.type !== 'raster') continue;
			usedSources.add(layer.source);
			layer.source = `${BASEMAP_PREFIX}${layer.source}`;
		}
		// The retained style is sprite independent, including any future patterned fills/lines.
		if ('paint' in layer && layer.paint) {
			for (const key of Object.keys(layer.paint)) {
				if (key.endsWith('-pattern')) delete (layer.paint as Record<string, unknown>)[key];
			}
		}
		layer.id = `${BASEMAP_PREFIX}${layer.id}`;
		layers.push(layer);
	}
	if (layers.some((layer) => layer.type === 'symbol') && !isHttpsUrl(style.glyphs)) {
		throw new Error('Street map did not supply fonts for its labels.');
	}
	const sources: Record<string, SourceSpecification> = {};
	for (const id of usedSources) {
		sources[`${BASEMAP_PREFIX}${id}`] = {
			...structuredClone(style.sources[id]),
			attribution: BASEMAP_ATTRIBUTION.streets
		} as SourceSpecification;
	}
	return {
		mode: 'streets',
		sources,
		layers,
		glyphs: style.glyphs,
		sprite: typeof style.sprite === 'string' && isHttpsUrl(style.sprite) ? style.sprite : undefined,
		attribution: BASEMAP_ATTRIBUTION.streets,
		captureAllowed: true
	};
}

/**
 * OpenFreeMap's actual Positron v8 style supplies roads, buildings and place/street labels.
 * Source: https://openfreemap.org/quick_start/ and https://tiles.openfreemap.org/styles/positron
 * EOX's public 2025 layer is free for noncommercial use under CC BY-NC-SA 4.0:
 * https://cloudless.eox.at/pricing and https://cloudless.eox.at/documentation/license .
 * Tile template/matrix verified against https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml
 * on 2026-10-10; native 10 m resolution and Web Mercator zoom 0–14 documented at
 * https://cloudless.eox.at/products/viewing . A mosaic year is not a single acquisition date.
 * MapTiler's keyed TileJSON endpoint is documented at https://docs.maptiler.com/cloud/api/reference/
 * (Tiles /tiles/{tilesId}/tiles.json, satellite-v4). Raster sizing follows
 * https://docs.maptiler.com/gl-style-specification/sources/ . No bundled demo or third-party key.
 * Provider export terms: https://www.maptiler.com/terms/cloud/ ; conservative capture gate below.
 * Callers add these layers below their atlas overlays, rather than replacing the map style.
 * Load errors reject, allowing the caller to retain the working basemap.
 */
export async function loadBasemap(
	mode: BasemapMode,
	options: BasemapLoadOptions = {}
): Promise<BasemapLoadResult> {
	if (mode === 'atlas') {
		return {
			mode,
			sources: {},
			layers: [],
			attribution: BASEMAP_ATTRIBUTION.atlas,
			captureAllowed: true
		};
	}
	if (mode === 'streets') {
		return importStreetStyle(
			parseStreetStyle(await fetchJson(OPENFREEMAP_STYLE_URL, 'Street map', options))
		);
	}
	const key = (options.maptilerKey ?? configuredKey).trim();
	if (!key) {
		return {
			mode,
			sources: {
				[`${BASEMAP_PREFIX}satellite`]: {
					type: 'raster',
					tiles: [EOX_SATELLITE_TILES_URL],
					tileSize: 256,
					minzoom: 0,
					// Higher display zooms upscale the native imagery, without implying finer detail.
					maxzoom: 14,
					attribution: EOX_ATTRIBUTION
				}
			},
			layers: [
				{ id: `${BASEMAP_PREFIX}satellite`, type: 'raster', source: `${BASEMAP_PREFIX}satellite` }
			],
			attribution: EOX_ATTRIBUTION,
			captureAllowed: false
		};
	}
	const tileJsonUrl = `https://api.maptiler.com/tiles/satellite-v4/tiles.json?key=${encodeURIComponent(key)}`;
	const metadata = await fetchJson(tileJsonUrl, 'Satellite imagery', options);
	if (
		!isRecord(metadata) ||
		!Array.isArray(metadata.tiles) ||
		metadata.tiles.length === 0 ||
		!metadata.tiles.every(isHttpsUrl) ||
		typeof metadata.attribution !== 'string' ||
		!metadata.attribution.trim()
	) {
		throw new Error('Satellite imagery returned incomplete tile or attribution information.');
	}
	const source: RasterSourceSpecification = {
		type: 'raster',
		tiles: metadata.tiles as string[],
		tileSize: metadata.tileSize === 512 || metadata.tilesize === 512 ? 512 : 256,
		attribution: metadata.attribution
	};
	if (typeof metadata.minzoom === 'number' && Number.isFinite(metadata.minzoom))
		source.minzoom = metadata.minzoom;
	if (typeof metadata.maxzoom === 'number' && Number.isFinite(metadata.maxzoom))
		source.maxzoom = metadata.maxzoom;
	if (
		Array.isArray(metadata.bounds) &&
		metadata.bounds.length === 4 &&
		metadata.bounds.every(
			(coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate)
		)
	) {
		source.bounds = metadata.bounds as [number, number, number, number];
	}
	return {
		mode,
		sources: { [`${BASEMAP_PREFIX}satellite`]: source },
		layers: [
			{ id: `${BASEMAP_PREFIX}satellite`, type: 'raster', source: `${BASEMAP_PREFIX}satellite` }
		],
		attribution: `${MAPTILER_ATTRIBUTION} · ${metadata.attribution}`,
		captureAllowed: false
	};
}
