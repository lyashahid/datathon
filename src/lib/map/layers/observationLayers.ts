import type { FeatureCollection } from 'geojson';
import type {
	ExpressionSpecification,
	GeoJSONSource,
	Map as MaplibreMap,
	PointLike
} from 'maplibre-gl';
import { OBSERVATION_STYLES } from '#lib/config/feedback.ts';
import { MAP_COLORS } from '#lib/config/map.ts';
import type { Position } from '#lib/types/domain.ts';
import type { Observation } from '#lib/types/feedback.ts';

const SOURCE_ID = 'mv-observations';
const LAYER_IDS = {
	points: 'mv-observations-points',
	selected: 'mv-observations-selected',
	draft: 'mv-observations-draft'
} as const;

const TYPE_COLOR = [
	'match',
	['get', 'type'],
	...Object.entries(OBSERVATION_STYLES).flatMap(([type, s]) => [type, s.color]),
	OBSERVATION_STYLES.other.color
] as unknown as ExpressionSpecification;

/** Drawn above infrastructure: observations are few and should stay clickable. */
export function addObservationLayers(map: MaplibreMap): void {
	map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
	map.addLayer({
		id: LAYER_IDS.selected,
		type: 'circle',
		source: SOURCE_ID,
		filter: ['==', ['get', 'id'], ''],
		paint: {
			'circle-radius': 11,
			'circle-color': 'rgba(0,0,0,0)',
			'circle-stroke-color': MAP_COLORS.selection,
			'circle-stroke-width': 2
		}
	});
	map.addLayer({
		id: LAYER_IDS.points,
		type: 'circle',
		source: SOURCE_ID,
		filter: ['==', ['get', 'kind'], 'observation'],
		paint: {
			'circle-radius': 6,
			'circle-color': TYPE_COLOR,
			'circle-stroke-color': '#0b0f14',
			'circle-stroke-width': 1.5
		}
	});
	map.addLayer({
		id: LAYER_IDS.draft,
		type: 'circle',
		source: SOURCE_ID,
		filter: ['==', ['get', 'kind'], 'draft'],
		paint: {
			'circle-radius': 8,
			'circle-color': 'rgba(255,255,255,0.15)',
			'circle-stroke-color': MAP_COLORS.selection,
			'circle-stroke-width': 2
		}
	});
}

export function removeObservationLayers(map: MaplibreMap): void {
	for (const id of Object.values(LAYER_IDS)) if (map.getLayer(id)) map.removeLayer(id);
	if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
}

export function setObservationData(
	map: MaplibreMap,
	observations: readonly Observation[],
	draft: Position | null
): void {
	const data: FeatureCollection = {
		type: 'FeatureCollection',
		features: [
			...observations.map((o) => ({
				type: 'Feature' as const,
				geometry: { type: 'Point' as const, coordinates: [...o.position] },
				properties: { kind: 'observation', id: o.id, type: o.type }
			})),
			...(draft
				? [
						{
							type: 'Feature' as const,
							geometry: { type: 'Point' as const, coordinates: [...draft] },
							properties: { kind: 'draft', id: '' }
						}
					]
				: [])
		]
	};
	map.getSource<GeoJSONSource>(SOURCE_ID)?.setData(data);
}

export function setObservationVisibility(map: MaplibreMap, visible: boolean): void {
	const v = visible ? 'visible' : 'none';
	map.setLayoutProperty(LAYER_IDS.points, 'visibility', v);
	map.setLayoutProperty(LAYER_IDS.selected, 'visibility', v);
}

export function setSelectedObservation(map: MaplibreMap, id: string | null): void {
	map.setFilter(LAYER_IDS.selected, ['==', ['get', 'id'], id ?? '']);
}

export function pickObservation(map: MaplibreMap, point: PointLike): string | null {
	if (!map.getLayer(LAYER_IDS.points)) return null;
	if (map.getLayoutProperty(LAYER_IDS.points, 'visibility') === 'none') return null;
	const [hit] = map.queryRenderedFeatures(point, { layers: [LAYER_IDS.points] });
	const id = hit?.properties.id;
	return typeof id === 'string' ? id : null;
}
