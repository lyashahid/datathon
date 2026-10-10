import type { Feature, FeatureCollection, Polygon } from 'geojson';
import type {
	ExpressionSpecification,
	FilterSpecification,
	GeoJSONSource,
	Map as MaplibreMap,
	PointLike
} from 'maplibre-gl';
import { cellToBoundary } from 'h3-js';
import {
	INFO_VIEW_FADE,
	isExternalMetric,
	type ColorScale,
	type GridInfoView
} from '#lib/config/infoViews.ts';
import { MAP_COLORS, MAP_LAYER_IDS } from '#lib/config/map.ts';
import type { CellValueSource, H3Grid, H3Index } from '#lib/types/h3.ts';

const SOURCE_ID = 'mv-h3';
const LAYER_IDS = {
	dim: 'mv-h3-dim',
	fill: 'mv-h3-fill',
	hover: 'mv-h3-hover',
	selected: 'mv-h3-selected'
} as const;

const NONE: FilterSpecification = ['==', ['get', 'h3Index'], ''];
const only = (h: H3Index | null): FilterSpecification => (h ? ['==', ['get', 'h3Index'], h] : NONE);

/** MapLibre colour ramp from a scale; one definition feeds both map and legend. */
export function colorExpression(metric: string, scale: ColorScale): ExpressionSpecification {
	return [
		'interpolate',
		['linear'],
		['get', metric],
		...scale.stops.flatMap(([value, color]) => [value, color])
	] as ExpressionSpecification;
}

// Cell outlines never change, so each is computed once per page instead of on every update.
const boundaries = new Map<H3Index, number[][]>();
function boundaryOf(h3Index: H3Index): number[][] {
	let ring = boundaries.get(h3Index);
	if (!ring) {
		ring = cellToBoundary(h3Index, true);
		boundaries.set(h3Index, ring);
	}
	return ring;
}

function gridToGeoJSON(grid: H3Grid, external: CellValueSource | null): FeatureCollection<Polygon> {
	return {
		type: 'FeatureCollection',
		features: grid.cells.map((c): Feature<Polygon> => ({
			type: 'Feature',
			geometry: { type: 'Polygon', coordinates: [boundaryOf(c.h3Index)] },
			properties: {
				h3Index: c.h3Index,
				populationDensity: c.populationDensity,
				transportAccessibility: c.transportAccessibility,
				healthAccessibility: c.healthAccessibility,
				educationAccessibility: c.educationAccessibility,
				underservedPopulation: c.underservedPopulation,
				external: external?.(c.h3Index) ?? 0
			}
		}))
	};
}

/** Inserted beneath infrastructure so markers stay clickable on top of the grid. */
export function addH3Layers(map: MaplibreMap): void {
	const beforeId = map.getLayer(MAP_LAYER_IDS.routeHighlight)
		? MAP_LAYER_IDS.routeHighlight
		: undefined;
	map.addSource(SOURCE_ID, {
		type: 'geojson',
		data: { type: 'FeatureCollection', features: [] },
		promoteId: 'h3Index'
	});
	map.addLayer(
		{
			id: LAYER_IDS.dim,
			type: 'background',
			layout: { visibility: 'none' },
			paint: {
				'background-color': MAP_COLORS.offlineBackground,
				'background-opacity': INFO_VIEW_FADE.basemapDimOpacity
			}
		},
		beforeId
	);
	map.addLayer(
		{
			id: LAYER_IDS.fill,
			type: 'fill',
			source: SOURCE_ID,
			layout: { visibility: 'none' },
			paint: {
				'fill-color': '#000000',
				'fill-opacity': INFO_VIEW_FADE.cellFillOpacity,
				'fill-outline-color': 'rgba(12, 17, 23, 0.35)'
			}
		},
		beforeId
	);
	map.addLayer(
		{
			id: LAYER_IDS.hover,
			type: 'line',
			source: SOURCE_ID,
			filter: NONE,
			paint: { 'line-color': MAP_COLORS.selection, 'line-width': 1, 'line-opacity': 0.7 }
		},
		beforeId
	);
	map.addLayer(
		{
			id: LAYER_IDS.selected,
			type: 'line',
			source: SOURCE_ID,
			filter: NONE,
			paint: { 'line-color': MAP_COLORS.selection, 'line-width': 3 }
		},
		beforeId
	);
}

export function removeH3Layers(map: MaplibreMap): void {
	for (const id of Object.values(LAYER_IDS).reverse()) {
		if (map.getLayer(id)) map.removeLayer(id);
	}
	if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
}

/** `external` feeds whichever external metric (change, exposure) the active view shows. */
export function setH3Data(map: MaplibreMap, grid: H3Grid, external: CellValueSource | null): void {
	map.getSource<GeoJSONSource>(SOURCE_ID)?.setData(gridToGeoJSON(grid, external));
}

/** Switching views only swaps a paint expression, so it is effectively instant. */
export function showInfoView(map: MaplibreMap, view: GridInfoView | null): void {
	const visibility = view ? 'visible' : 'none';
	map.setLayoutProperty(LAYER_IDS.dim, 'visibility', visibility);
	map.setLayoutProperty(LAYER_IDS.fill, 'visibility', visibility);
	map.setLayoutProperty(LAYER_IDS.hover, 'visibility', visibility);
	map.setLayoutProperty(LAYER_IDS.selected, 'visibility', visibility);
	if (view)
		map.setPaintProperty(
			LAYER_IDS.fill,
			'fill-color',
			colorExpression(isExternalMetric(view.metric) ? 'external' : view.metric, view.scale)
		);
}

export function setHoveredCell(map: MaplibreMap, h: H3Index | null): void {
	map.setFilter(LAYER_IDS.hover, only(h));
}

export function setSelectedCell(map: MaplibreMap, h: H3Index | null): void {
	map.setFilter(LAYER_IDS.selected, only(h));
}

export function pickCell(map: MaplibreMap, point: PointLike): H3Index | null {
	if (!map.getLayer(LAYER_IDS.fill)) return null;
	const [hit] = map.queryRenderedFeatures(point, { layers: [LAYER_IDS.fill] });
	const h = hit?.properties.h3Index;
	return typeof h === 'string' ? h : null;
}
