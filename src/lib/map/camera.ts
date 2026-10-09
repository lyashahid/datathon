import type { Map as MaplibreMap } from 'maplibre-gl';
import { MAP_CAMERA } from '#lib/config/map.ts';
import type { LngLatBounds, MapCamera, MapViewState } from '#lib/types/map.ts';

/** Our bounds are readonly tuples; MapLibre wants mutable ones. */
export function toMaplibreBounds([sw, ne]: LngLatBounds): [[number, number], [number, number]] {
	return [
		[sw[0], sw[1]],
		[ne[0], ne[1]]
	];
}

export function createCamera(map: MaplibreMap): MapCamera {
	return {
		fitBounds(bounds: LngLatBounds) {
			map.fitBounds(toMaplibreBounds(bounds), {
				padding: MAP_CAMERA.fitPaddingPx,
				duration: MAP_CAMERA.flyDurationMs
			});
		},
		flyTo(view: Partial<MapViewState>) {
			map.flyTo({
				center: view.center ? [view.center[0], view.center[1]] : undefined,
				zoom: view.zoom,
				duration: MAP_CAMERA.flyDurationMs
			});
		}
	};
}

export function readView(map: MaplibreMap): MapViewState {
	const { lng, lat } = map.getCenter();
	return { center: [lng, lat], zoom: map.getZoom() };
}
