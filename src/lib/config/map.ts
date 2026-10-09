import type {
	BasemapCandidate,
	LngLatBounds,
	MapViewPreset,
	MapViewPresetId
} from '#lib/types/map.ts';

/** Inhabited extent of the Maldives, Ihavandhippolhu (north) to Addu (south). */
export const MALDIVES_BOUNDS: LngLatBounds = [
	[72.55, -0.75],
	[73.85, 7.15]
];

/** Panning limit: the national extent plus enough sea to keep outer atolls comfortably on screen. */
export const MAP_MAX_BOUNDS: LngLatBounds = [
	[69.5, -4.0],
	[77.0, 10.5]
];

export const MAP_VIEW_PRESETS: Record<MapViewPresetId, MapViewPreset> = {
	maldives: { label: 'Maldives', bounds: MALDIVES_BOUNDS },
	greaterMale: {
		label: 'Greater Malé',
		// Villimalé to Hulhumalé Phase I.
		bounds: [
			[73.48, 4.165],
			[73.55, 4.228]
		]
	}
};

export const INITIAL_VIEW_PRESET: MapViewPresetId = 'greaterMale';

export const MAP_CAMERA = {
	minZoom: 5,
	maxZoom: 19,
	fitPaddingPx: 32,
	flyDurationMs: 800
} as const;

/**
 * Keyless basemaps tried in order after the optional MAP_STYLE_URL override.
 * Both are vector styles over OpenStreetMap data and render 2D only.
 */
export const DEFAULT_BASEMAPS: readonly BasemapCandidate[] = [
	{
		id: 'openfreemap-dark',
		label: 'OpenFreeMap Dark',
		url: 'https://tiles.openfreemap.org/styles/dark',
		applyHudPalette: true
	},
	{
		id: 'carto-dark-matter',
		label: 'CARTO Dark Matter',
		url: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
		applyHudPalette: true
	}
];

export const BASEMAP_FETCH_TIMEOUT_MS = 8000;

/** Mirrors the HUD palette in layout.css; MapLibre paint properties need literal colours. */
export const MAP_COLORS = {
	offlineBackground: '#0c1117',
	// Stock dark styles draw land and sea at near-identical darkness, hiding small islands.
	land: '#222c37',
	water: '#0a0f14',
	markerOutline: '#0c1117',
	selection: '#f1f5f9',
	/** Ring colours for assets that differ from the baseline in the active scenario. */
	scenarioAdded: '#e879f9',
	scenarioMoved: '#f2b35b',
	scenarioDisabled: '#f87171',
	disabledFill: '#4b5563',
	/** Ranked candidate badges: #1 stands out, the rest are neutral. */
	candidateTop: '#fbbf24',
	candidate: '#e2e8f0'
} as const;

export const MAP_INTERACTION = {
	/** Screen-space slop around the cursor when picking, so thin route lines are clickable. */
	pickTolerancePx: 4,
	selectionHaloRadiusPx: 14,
	editRingRadiusPx: 11,
	routeHighlightWidthPx: 9,
	disabledOpacity: 0.35,
	/** Faded ghost left at a facility's original position while/after it moves. */
	ghostOpacity: 0.3
} as const;

export const MAP_SOURCE_IDS = {
	infrastructure: 'mv-infrastructure',
	routes: 'mv-routes',
	moveTrails: 'mv-move-trails'
} as const;

export const MAP_LAYER_IDS = {
	/** Prefix; one line layer per transport mode because line-dasharray is not data-driven. */
	routes: 'mv-routes',
	routeHighlight: 'mv-routes-highlight',
	infrastructure: 'mv-infrastructure',
	infrastructureHalo: 'mv-infrastructure-halo',
	infrastructureEdit: 'mv-infrastructure-edit',
	moveTrails: 'mv-move-trails',
	moveGhosts: 'mv-move-ghosts'
} as const;

export const CURSOR_COORDINATE_DECIMALS = 5;
