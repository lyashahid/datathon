import { createContext } from 'svelte';
import { MAP_VIEW_PRESETS } from '#lib/config/map.ts';
import type {
	BasemapCandidate,
	BasemapFailure,
	LngLat,
	LngLatBounds,
	MapCamera,
	MapStatus,
	MapViewPresetId,
	MapViewState
} from '#lib/types/map.ts';

/**
 * Observable map state for the rest of the app. Components read this and request camera
 * moves through it; only src/lib/map/ touches the MapLibre instance.
 */
export class MapState {
	status = $state<MapStatus>('loading');
	basemap = $state<BasemapCandidate | null>(null);
	basemapFailures = $state<BasemapFailure[]>([]);
	view = $state<MapViewState | null>(null);
	cursor = $state<LngLat | null>(null);
	errorMessage = $state<string | null>(null);

	#camera: MapCamera | null = null;

	attachCamera(camera: MapCamera): void {
		this.#camera = camera;
	}

	detachCamera(): void {
		this.#camera = null;
	}

	setBasemap(basemap: BasemapCandidate, failures: BasemapFailure[]): void {
		this.basemap = basemap;
		this.basemapFailures = failures;
	}

	markReady(): void {
		this.status = 'ready';
		this.errorMessage = null;
	}

	fail(message: string): void {
		this.status = 'error';
		this.errorMessage = message;
	}

	showPreset(id: MapViewPresetId): void {
		this.#camera?.fitBounds(MAP_VIEW_PRESETS[id].bounds);
	}

	fitBounds(bounds: LngLatBounds): void {
		this.#camera?.fitBounds(bounds);
	}

	flyTo(view: Partial<MapViewState>): void {
		this.#camera?.flyTo(view);
	}
}

export const [getMapState, setMapState] = createContext<MapState>();
