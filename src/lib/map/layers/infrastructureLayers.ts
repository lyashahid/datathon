import type { FeatureCollection, LineString, Point } from 'geojson';
import type {
	ExpressionSpecification,
	FilterSpecification,
	GeoJSONSource,
	Map as MaplibreMap,
	PointLike
} from 'maplibre-gl';
import { INFRASTRUCTURE_TYPE_STYLES, ROUTE_MODE_STYLES } from '#lib/config/infrastructure.ts';
import { MAP_COLORS, MAP_INTERACTION, MAP_LAYER_IDS, MAP_SOURCE_IDS } from '#lib/config/map.ts';
import type {
	AssetRef,
	InfrastructureFeature,
	InfrastructureType,
	TransportMode,
	TransportRoute
} from '#lib/types/domain.ts';
import { TRANSPORT_MODES } from '#lib/types/domain.ts';
import type { AssetDelta } from '#lib/types/scenario.ts';
import { DISABLED_MARKER_SUFFIX, MARKER_IMAGE_PREFIX, registerMarkerImages } from '../markers.ts';

const NO_MATCH: FilterSpecification = ['==', ['get', 'id'], ''];

/** Dims disabled assets; proposed assets get their own treatment with scenario editing. */
const STATUS_OPACITY: ExpressionSpecification = [
	'match',
	['get', 'status'],
	'disabled',
	MAP_INTERACTION.disabledOpacity,
	1
];

/** How an asset differs in the active scenario; drives the ring colour. Disabled wins. */
type EditKind = 'added' | 'moved' | 'disabled' | '';

function editKind(feature: InfrastructureFeature, delta: AssetDelta | undefined): EditKind {
	if (!delta) return '';
	if (feature.status === 'disabled') return 'disabled';
	if (delta.origin === 'scenario') return 'added';
	return delta.moved ? 'moved' : '';
}

/** Marker opacity: the asset being moved fades to a ghost; disabled ones are slightly muted. */
function iconOpacity(movingId: string | null, fade = 1): ExpressionSpecification {
	return [
		'*',
		fade,
		[
			'case',
			['==', ['get', 'id'], movingId ?? ''],
			MAP_INTERACTION.ghostOpacity,
			['==', ['get', 'status'], 'disabled'],
			0.85,
			1
		]
	];
}

export function routeLayerId(mode: TransportMode): string {
	return `${MAP_LAYER_IDS.routes}-${mode}`;
}

const ROUTE_LAYER_IDS = TRANSPORT_MODES.map(routeLayerId);

/** Map-facing GeoJSON keeps only what styling and picking need; details stay in the domain store. */
function infrastructureToGeoJSON(
	features: readonly InfrastructureFeature[],
	deltas: ReadonlyMap<string, AssetDelta>
): FeatureCollection<Point> {
	return {
		type: 'FeatureCollection',
		features: features.map((f) => ({
			type: 'Feature',
			geometry: f.geometry,
			properties: {
				id: f.id,
				type: f.type,
				status: f.status,
				edit: editKind(f, deltas.get(f.id)),
				// Larger (more significant) markers draw above small stops.
				sortKey: INFRASTRUCTURE_TYPE_STYLES[f.type].sizePx
			}
		}))
	};
}

/** Dashed line and faded ghost from each moved asset's baseline position to its current one. */
function moveTrailsToGeoJSON(
	features: readonly InfrastructureFeature[],
	deltas: ReadonlyMap<string, AssetDelta>
): FeatureCollection {
	const out: FeatureCollection['features'] = [];
	for (const f of features) {
		const from = deltas.get(f.id)?.originalPosition;
		if (!from) continue;
		const props = { id: f.id, type: f.type };
		out.push({
			type: 'Feature',
			geometry: { type: 'LineString', coordinates: [[...from], [...f.geometry.coordinates]] },
			properties: { ...props, kind: 'trail' }
		});
		out.push({
			type: 'Feature',
			geometry: { type: 'Point', coordinates: [...from] },
			properties: { ...props, kind: 'ghost' }
		});
	}
	return { type: 'FeatureCollection', features: out };
}

function routesToGeoJSON(routes: readonly TransportRoute[]): FeatureCollection<LineString> {
	return {
		type: 'FeatureCollection',
		features: routes.map((r) => ({
			type: 'Feature',
			geometry: r.geometry,
			properties: { id: r.id, mode: r.mode, status: r.status }
		}))
	};
}

export function addInfrastructureLayers(map: MaplibreMap): void {
	registerMarkerImages(map);
	const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };

	map.addSource(MAP_SOURCE_IDS.routes, { type: 'geojson', data: empty, promoteId: 'id' });
	map.addLayer({
		id: MAP_LAYER_IDS.routeHighlight,
		type: 'line',
		source: MAP_SOURCE_IDS.routes,
		filter: NO_MATCH,
		layout: { 'line-join': 'round', 'line-cap': 'round' },
		paint: {
			'line-color': MAP_COLORS.selection,
			'line-width': MAP_INTERACTION.routeHighlightWidthPx,
			'line-opacity': 0.35
		}
	});
	for (const mode of TRANSPORT_MODES) {
		const style = ROUTE_MODE_STYLES[mode];
		map.addLayer({
			id: routeLayerId(mode),
			type: 'line',
			source: MAP_SOURCE_IDS.routes,
			filter: ['==', ['get', 'mode'], mode],
			layout: { 'line-join': 'round', 'line-cap': style.dash ? 'butt' : 'round' },
			paint: {
				'line-color': style.color,
				'line-width': style.widthPx,
				'line-opacity': STATUS_OPACITY,
				...(style.dash ? { 'line-dasharray': [...style.dash] } : {})
			}
		});
	}

	map.addSource(MAP_SOURCE_IDS.moveTrails, { type: 'geojson', data: empty });
	map.addLayer({
		id: MAP_LAYER_IDS.moveTrails,
		type: 'line',
		source: MAP_SOURCE_IDS.moveTrails,
		filter: ['==', ['get', 'kind'], 'trail'],
		paint: {
			'line-color': MAP_COLORS.scenarioMoved,
			'line-width': 1.5,
			'line-dasharray': [2, 2]
		}
	});
	map.addLayer({
		id: MAP_LAYER_IDS.moveGhosts,
		type: 'symbol',
		source: MAP_SOURCE_IDS.moveTrails,
		filter: ['==', ['get', 'kind'], 'ghost'],
		layout: {
			'icon-image': ['concat', MARKER_IMAGE_PREFIX, ['get', 'type']],
			'icon-allow-overlap': true,
			'icon-ignore-placement': true
		},
		paint: { 'icon-opacity': MAP_INTERACTION.ghostOpacity }
	});

	map.addSource(MAP_SOURCE_IDS.infrastructure, { type: 'geojson', data: empty, promoteId: 'id' });
	map.addLayer({
		id: MAP_LAYER_IDS.infrastructureHalo,
		type: 'circle',
		source: MAP_SOURCE_IDS.infrastructure,
		filter: NO_MATCH,
		paint: {
			'circle-radius': MAP_INTERACTION.selectionHaloRadiusPx,
			'circle-color': 'transparent',
			'circle-stroke-color': MAP_COLORS.selection,
			'circle-stroke-width': 2
		}
	});
	map.addLayer({
		id: MAP_LAYER_IDS.infrastructureEdit,
		type: 'circle',
		source: MAP_SOURCE_IDS.infrastructure,
		filter: ['!=', ['get', 'edit'], ''],
		paint: {
			'circle-radius': MAP_INTERACTION.editRingRadiusPx,
			'circle-color': 'transparent',
			'circle-stroke-width': 1.5,
			'circle-stroke-color': [
				'match',
				['get', 'edit'],
				'added',
				MAP_COLORS.scenarioAdded,
				'disabled',
				MAP_COLORS.scenarioDisabled,
				MAP_COLORS.scenarioMoved
			]
		}
	});
	map.addLayer({
		id: MAP_LAYER_IDS.infrastructure,
		type: 'symbol',
		source: MAP_SOURCE_IDS.infrastructure,
		layout: {
			'icon-image': [
				'concat',
				MARKER_IMAGE_PREFIX,
				['get', 'type'],
				['case', ['==', ['get', 'status'], 'disabled'], DISABLED_MARKER_SUFFIX, '']
			],
			'icon-allow-overlap': true,
			'icon-ignore-placement': true,
			'symbol-sort-key': ['get', 'sortKey']
		},
		paint: { 'icon-opacity': iconOpacity(null) }
	});
}

export function removeInfrastructureLayers(map: MaplibreMap): void {
	for (const id of [
		MAP_LAYER_IDS.infrastructure,
		MAP_LAYER_IDS.infrastructureEdit,
		MAP_LAYER_IDS.infrastructureHalo,
		MAP_LAYER_IDS.moveGhosts,
		MAP_LAYER_IDS.moveTrails,
		...ROUTE_LAYER_IDS,
		MAP_LAYER_IDS.routeHighlight
	]) {
		if (map.getLayer(id)) map.removeLayer(id);
	}
	for (const id of [
		MAP_SOURCE_IDS.infrastructure,
		MAP_SOURCE_IDS.moveTrails,
		MAP_SOURCE_IDS.routes
	]) {
		if (map.getSource(id)) map.removeSource(id);
	}
}

export function setInfrastructureData(
	map: MaplibreMap,
	features: readonly InfrastructureFeature[],
	deltas: ReadonlyMap<string, AssetDelta>
): void {
	map
		.getSource<GeoJSONSource>(MAP_SOURCE_IDS.infrastructure)
		?.setData(infrastructureToGeoJSON(features, deltas));
	map
		.getSource<GeoJSONSource>(MAP_SOURCE_IDS.moveTrails)
		?.setData(moveTrailsToGeoJSON(features, deltas));
}

/** Separate from facilities: most edits leave routes untouched, so they skip this upload. */
export function setRouteData(map: MaplibreMap, routes: readonly TransportRoute[]): void {
	map.getSource<GeoJSONSource>(MAP_SOURCE_IDS.routes)?.setData(routesToGeoJSON(routes));
}

/**
 * Marker and route opacity: the asset being moved fades to a ghost, and everything recedes by
 * `fade` (0–1) while an analytical info view is in front.
 */
export function setInfrastructureEmphasis(
	map: MaplibreMap,
	movingId: string | null,
	fade: number
): void {
	map.setPaintProperty(MAP_LAYER_IDS.infrastructure, 'icon-opacity', iconOpacity(movingId, fade));
	for (const id of ROUTE_LAYER_IDS) {
		map.setPaintProperty(id, 'line-opacity', ['*', fade, STATUS_OPACITY]);
	}
	map.setPaintProperty(
		MAP_LAYER_IDS.moveGhosts,
		'icon-opacity',
		MAP_INTERACTION.ghostOpacity * fade
	);
}

export function setSelectedAsset(map: MaplibreMap, selected: AssetRef | null): void {
	const match = (kind: AssetRef['kind']): FilterSpecification =>
		selected?.kind === kind ? ['==', ['get', 'id'], selected.id] : NO_MATCH;
	map.setFilter(MAP_LAYER_IDS.infrastructureHalo, match('infrastructure'));
	map.setFilter(MAP_LAYER_IDS.routeHighlight, match('route'));
}

export function setVisibleCategories(
	map: MaplibreMap,
	types: readonly InfrastructureType[],
	modes: readonly TransportMode[]
): void {
	const typeFilter: FilterSpecification = ['in', ['get', 'type'], ['literal', [...types]]];
	map.setFilter(MAP_LAYER_IDS.infrastructure, typeFilter);
	for (const mode of TRANSPORT_MODES) {
		map.setLayoutProperty(
			routeLayerId(mode),
			'visibility',
			modes.includes(mode) ? 'visible' : 'none'
		);
	}
}

/** Returns the asset under a screen point, preferring point infrastructure over route lines. */
export function pickAsset(map: MaplibreMap, point: { x: number; y: number }): AssetRef | null {
	const r = MAP_INTERACTION.pickTolerancePx;
	const box: [PointLike, PointLike] = [
		[point.x - r, point.y - r],
		[point.x + r, point.y + r]
	];
	const layers = [MAP_LAYER_IDS.infrastructure, ...ROUTE_LAYER_IDS].filter((id) =>
		map.getLayer(id)
	);
	const hits = map.queryRenderedFeatures(box, { layers });
	const infra = hits.find((h) => h.layer.id === MAP_LAYER_IDS.infrastructure);
	const hit = infra ?? hits[0];
	const id = hit?.properties.id;
	if (typeof id !== 'string') return null;
	return { kind: infra ? 'infrastructure' : 'route', id };
}
