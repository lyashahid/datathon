import type { Feature, FeatureCollection, Position } from 'geojson';
import type {
	ExpressionSpecification,
	GeoJSONSource,
	LngLat,
	Map as MaplibreMap,
	PointLike
} from 'maplibre-gl';
import { circleRing, distanceToLineM } from '#lib/analysis/geo.ts';
import { PLACEMENT_COLORS, PLACEMENT_RULES } from '#lib/config/placement.ts';
import type { PreviewGeometry, RoadCheck } from '#lib/simulator/placement.ts';
import { MARKER_IMAGE_PREFIX } from '../markers.ts';

const SOURCE_ID = 'mv-placement';
const LAYER_IDS = {
	link: 'mv-placement-link',
	fill: 'mv-placement-catchment-fill',
	outline: 'mv-placement-catchment-line',
	ring: 'mv-placement-ring',
	marker: 'mv-placement-marker'
} as const;

/** OpenMapTiles transportation classes that a bus cannot use. */
const NON_ROAD_CLASSES = new Set(['ferry', 'path', 'rail', 'transit', 'aerialway']);

const VALIDITY_COLOR: ExpressionSpecification = [
	'match',
	['get', 'validity'],
	'valid',
	PLACEMENT_COLORS.valid,
	'warning',
	PLACEMENT_COLORS.warning,
	PLACEMENT_COLORS.invalid
];

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

export function addPlacementLayers(map: MaplibreMap): void {
	map.addSource(SOURCE_ID, { type: 'geojson', data: EMPTY });
	map.addLayer({
		id: LAYER_IDS.fill,
		type: 'fill',
		source: SOURCE_ID,
		filter: ['==', ['get', 'kind'], 'catchment'],
		paint: { 'fill-color': VALIDITY_COLOR, 'fill-opacity': 0.12 }
	});
	map.addLayer({
		id: LAYER_IDS.outline,
		type: 'line',
		source: SOURCE_ID,
		filter: ['==', ['get', 'kind'], 'catchment'],
		paint: { 'line-color': VALIDITY_COLOR, 'line-width': 1.5, 'line-dasharray': [2, 2] }
	});
	map.addLayer({
		id: LAYER_IDS.link,
		type: 'line',
		source: SOURCE_ID,
		filter: ['==', ['get', 'kind'], 'link'],
		paint: { 'line-color': VALIDITY_COLOR, 'line-width': 2, 'line-dasharray': [1.5, 1.5] }
	});
	map.addLayer({
		id: LAYER_IDS.ring,
		type: 'circle',
		source: SOURCE_ID,
		filter: ['==', ['get', 'kind'], 'marker'],
		paint: {
			'circle-radius': 12,
			'circle-color': VALIDITY_COLOR,
			'circle-opacity': 0.25,
			'circle-stroke-color': VALIDITY_COLOR,
			'circle-stroke-width': 2
		}
	});
	map.addLayer({
		id: LAYER_IDS.marker,
		type: 'symbol',
		source: SOURCE_ID,
		filter: ['==', ['get', 'kind'], 'marker'],
		layout: {
			'icon-image': ['concat', MARKER_IMAGE_PREFIX, ['get', 'type']],
			'icon-allow-overlap': true,
			'icon-ignore-placement': true
		},
		paint: { 'icon-opacity': 0.9 }
	});
}

export function removePlacementLayers(map: MaplibreMap): void {
	for (const id of Object.values(LAYER_IDS).reverse()) {
		if (map.getLayer(id)) map.removeLayer(id);
	}
	if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
}

export function setPlacementPreview(map: MaplibreMap, preview: PreviewGeometry | null): void {
	const source = map.getSource<GeoJSONSource>(SOURCE_ID);
	if (!source) return;
	if (!preview) {
		source.setData(EMPTY);
		return;
	}
	const props = { validity: preview.validity, type: preview.type };
	const features: Feature[] = [];
	if (preview.catchmentRadiusM) {
		features.push({
			type: 'Feature',
			geometry: {
				type: 'Polygon',
				coordinates: [circleRing(preview.position, preview.catchmentRadiusM)]
			},
			properties: { ...props, kind: 'catchment' }
		});
	}
	if (preview.origin) {
		features.push({
			type: 'Feature',
			geometry: { type: 'LineString', coordinates: [[...preview.origin], [...preview.position]] },
			properties: { ...props, kind: 'link' }
		});
	}
	features.push({
		type: 'Feature',
		geometry: { type: 'Point', coordinates: [...preview.position] },
		properties: { ...props, kind: 'marker' }
	});
	source.setData({ type: 'FeatureCollection', features });
}

/** Line layers in the basemap style that draw roads (OpenMapTiles `transportation`). */
function roadLayerIds(map: MaplibreMap): string[] {
	return map
		.getStyle()
		.layers.filter((l) => l.type === 'line' && l['source-layer'] === 'transportation')
		.map((l) => l.id);
}

/**
 * Nearest rendered road to a point, measured from the basemap's own vector tiles.
 * Unavailable when zoomed out (roads generalised) or when the basemap has no road layer.
 */
export function measureRoadDistance(map: MaplibreMap, lngLat: LngLat): RoadCheck {
	if (map.getZoom() < PLACEMENT_RULES.roadCheckMinZoom) {
		return { status: 'unavailable', reason: 'zoom in to check road access' };
	}
	const layers = roadLayerIds(map);
	if (layers.length === 0) {
		return { status: 'unavailable', reason: 'basemap has no road data' };
	}

	const point = map.project(lngLat);
	const metresPerPx =
		(40_075_016.686 * Math.cos((lngLat.lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
	const r = Math.min(200, Math.ceil((PLACEMENT_RULES.maxRoadDistanceM * 2) / metresPerPx));
	const box: [PointLike, PointLike] = [
		[point.x - r, point.y - r],
		[point.x + r, point.y + r]
	];

	const position: Position = [lngLat.lng, lngLat.lat];
	let best: number | null = null;
	for (const feature of map.queryRenderedFeatures(box, { layers })) {
		if (NON_ROAD_CLASSES.has(String(feature.properties.class))) continue;
		const g = feature.geometry;
		const lines =
			g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
		for (const line of lines) {
			const d = distanceToLineM(position, line);
			if (best === null || d < best) best = d;
		}
	}
	return { status: 'checked', distanceM: best };
}
