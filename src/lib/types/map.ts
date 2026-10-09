/** Map-library-agnostic types. Nothing here may import MapLibre. */

export type LngLat = readonly [lng: number, lat: number];

/** South-west then north-east corner. */
export type LngLatBounds = readonly [sw: LngLat, ne: LngLat];

export interface MapViewState {
	center: LngLat;
	zoom: number;
}

export type MapStatus = 'loading' | 'ready' | 'error';

export interface BasemapCandidate {
	id: string;
	label: string;
	url: string;
	/** Recolour land/water for island legibility. Only valid for OpenMapTiles-schema styles. */
	applyHudPalette?: boolean;
}

export interface BasemapFailure {
	basemapId: string;
	reason: string;
}

export type MapViewPresetId = 'maldives' | 'greaterMale';

export interface MapViewPreset {
	label: string;
	bounds: LngLatBounds;
}

/** Camera operations the rest of the app may request without touching the map library. */
export interface MapCamera {
	fitBounds(bounds: LngLatBounds): void;
	flyTo(view: Partial<MapViewState>): void;
}

/** Minimal 2D camera: enough to mirror one map onto another. */
export interface CameraPose {
	center: LngLat;
	zoom: number;
}
