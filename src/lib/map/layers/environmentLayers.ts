import type { Feature, FeatureCollection } from 'geojson';
import type { ExpressionSpecification, GeoJSONSource, Map as MaplibreMap } from 'maplibre-gl';
import type { EnvironmentInfoView } from '#lib/config/infoViews.ts';
import { MAP_LAYER_IDS } from '#lib/config/map.ts';
import type { MarineSnapshot, SampleGrid, WeatherSnapshot } from '#lib/types/weather.ts';
import { colorExpression } from './h3Layers.ts';

const SOURCE_ID = 'mv-environment';
const LAYER_IDS = {
	fill: 'mv-environment-fill',
	outline: 'mv-environment-outline',
	arrows: 'mv-environment-arrows'
} as const;
const ARROW_IMAGE = 'mv-wind-arrow';
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };

/** White arrow drawn as an SDF so its colour can follow wind speed. Points up (north). */
function renderArrow(pixelRatio: number): ImageData {
	const side = 28 * pixelRatio;
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = side;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('Canvas 2D context unavailable');
	const s = side / 28;
	ctx.fillStyle = '#ffffff';
	ctx.beginPath();
	ctx.moveTo(14 * s, 2 * s);
	ctx.lineTo(23 * s, 15 * s);
	ctx.lineTo(17 * s, 15 * s);
	ctx.lineTo(17 * s, 26 * s);
	ctx.lineTo(11 * s, 26 * s);
	ctx.lineTo(11 * s, 15 * s);
	ctx.lineTo(5 * s, 15 * s);
	ctx.closePath();
	ctx.fill();
	return ctx.getImageData(0, 0, side, side);
}

export function addEnvironmentLayers(map: MaplibreMap): void {
	const pixelRatio = Math.max(1, Math.ceil(window.devicePixelRatio));
	if (!map.hasImage(ARROW_IMAGE)) {
		map.addImage(ARROW_IMAGE, renderArrow(pixelRatio), { pixelRatio, sdf: true });
	}
	const beforeId = map.getLayer(MAP_LAYER_IDS.routeHighlight)
		? MAP_LAYER_IDS.routeHighlight
		: undefined;
	map.addSource(SOURCE_ID, { type: 'geojson', data: EMPTY });
	map.addLayer(
		{
			id: LAYER_IDS.fill,
			type: 'fill',
			source: SOURCE_ID,
			filter: ['==', ['get', 'kind'], 'cell'],
			layout: { visibility: 'none' },
			paint: { 'fill-color': '#000000', 'fill-opacity': 0.5 }
		},
		beforeId
	);
	map.addLayer(
		{
			id: LAYER_IDS.outline,
			type: 'line',
			source: SOURCE_ID,
			filter: ['==', ['get', 'kind'], 'cell'],
			layout: { visibility: 'none' },
			paint: { 'line-color': 'rgba(255,255,255,0.18)', 'line-width': 1 }
		},
		beforeId
	);
	map.addLayer(
		{
			id: LAYER_IDS.arrows,
			type: 'symbol',
			source: SOURCE_ID,
			filter: ['==', ['get', 'kind'], 'point'],
			layout: {
				visibility: 'none',
				'icon-image': ARROW_IMAGE,
				// Wind direction is where it blows FROM; arrows show where it blows TO.
				'icon-rotate': ['+', ['get', 'direction'], 180],
				'icon-rotation-alignment': 'map',
				'icon-allow-overlap': true,
				'icon-size': ['interpolate', ['linear'], ['get', 'value'], 0, 0.6, 40, 1.3]
			},
			paint: { 'icon-color': '#ffffff' }
		},
		beforeId
	);
}

export function removeEnvironmentLayers(map: MaplibreMap): void {
	for (const id of Object.values(LAYER_IDS).reverse()) if (map.getLayer(id)) map.removeLayer(id);
	if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
}

type AnyGrid = SampleGrid<WeatherSnapshot> | SampleGrid<MarineSnapshot>;

/** Square cells centred on each sample (one model value each) plus centre points for arrows. */
export function environmentToGeoJSON(view: EnvironmentInfoView, grid: AnyGrid): FeatureCollection {
	const half = grid.spacingDeg / 2;
	const features: Feature[] = [];
	for (const s of grid.samples) {
		const snapshot = s.snapshot as (WeatherSnapshot & MarineSnapshot) | null;
		const value = snapshot?.[view.metric] ?? null;
		if (value === null) continue;
		const direction = snapshot?.windDirectionDeg ?? 0;
		const { longitude: x, latitude: y } = s;
		features.push({
			type: 'Feature',
			geometry: {
				type: 'Polygon',
				coordinates: [
					[
						[x - half, y - half],
						[x + half, y - half],
						[x + half, y + half],
						[x - half, y + half],
						[x - half, y - half]
					]
				]
			},
			properties: { kind: 'cell', value }
		});
		features.push({
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [x, y] },
			properties: { kind: 'point', value, direction }
		});
	}
	return { type: 'FeatureCollection', features };
}

function fillColor(view: EnvironmentInfoView): ExpressionSpecification {
	if (!view.categories) return colorExpression('value', view.scale);
	const [first, ...rest] = view.categories;
	return [
		'step',
		['get', 'value'],
		first.color,
		...rest.flatMap((c) => [c.min, c.color])
	] as ExpressionSpecification;
}

export function showEnvironment(
	map: MaplibreMap,
	view: EnvironmentInfoView | null,
	grid: AnyGrid | null
): void {
	const isWind = view?.metric === 'windSpeedKph';
	const cells = view && grid && !isWind ? 'visible' : 'none';
	map.setLayoutProperty(LAYER_IDS.fill, 'visibility', cells);
	map.setLayoutProperty(LAYER_IDS.outline, 'visibility', cells);
	map.setLayoutProperty(
		LAYER_IDS.arrows,
		'visibility',
		view && grid && isWind ? 'visible' : 'none'
	);
	const source = map.getSource<GeoJSONSource>(SOURCE_ID);
	if (!view || !grid) {
		source?.setData(EMPTY);
		return;
	}
	source?.setData(environmentToGeoJSON(view, grid));
	if (isWind)
		map.setPaintProperty(LAYER_IDS.arrows, 'icon-color', colorExpression('value', view.scale));
	else map.setPaintProperty(LAYER_IDS.fill, 'fill-color', fillColor(view));
}
