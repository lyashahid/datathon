<!--
	Reusable strictly-2D MapLibre map. Publishes its state through a MapState instance and
	passes the raw map only to its `layers` snippet (map-layer components), so the rest of the
	app never depends on MapLibre directly.
-->
<script lang="ts">
	import 'maplibre-gl/dist/maplibre-gl.css';
	import './map.css';
	import { onMount, type Snippet } from 'svelte';
	import type { Map as MaplibreMap } from 'maplibre-gl';
	// MapLibre resolves its worker relative to its own module, which breaks once Vite pre-bundles
	// it; bundling the worker (with its shared chunk) and passing the URL explicitly is robust.
	import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
	import {
		INITIAL_VIEW_PRESET,
		MAP_CAMERA,
		MAP_MAX_BOUNDS,
		MAP_VIEW_PRESETS
	} from '#lib/config/map.ts';
	import type { MapState } from '#lib/stores/map.svelte.ts';
	import { createCamera, readView, toMaplibreBounds } from './camera.ts';
	import { loadBasemapStyle, resolveBasemapCandidates } from './style.ts';

	let {
		mapState,
		styleUrl,
		interactive = true,
		controls = true,
		layers
	}: {
		mapState: MapState;
		/** Optional style override, tried before the default basemaps. */
		styleUrl?: string;
		/** False for a display-only map (e.g. the compare overlay) that never takes input. */
		interactive?: boolean;
		/** Zoom, scale and attribution controls; off when another map already shows them. */
		controls?: boolean;
		/** Rendered once the map has loaded; receives the map for layer modules. */
		layers?: Snippet<[MaplibreMap]>;
	} = $props();

	let container: HTMLDivElement;
	let readyMap = $state.raw<MaplibreMap | null>(null);

	const BLANK_IMAGE = { width: 1, height: 1, data: new Uint8Array(4) };

	onMount(() => {
		let map: MaplibreMap | undefined;
		let disposed = false;

		async function init() {
			// MapLibre touches `window` on import, so it is loaded only in the browser.
			const [maplibre, basemap] = await Promise.all([
				import('maplibre-gl'),
				loadBasemapStyle(resolveBasemapCandidates(styleUrl))
			]);
			if (disposed) return;

			maplibre.setWorkerUrl(maplibreWorkerUrl);
			mapState.setBasemap(basemap.basemap, basemap.failures);

			const m = new maplibre.Map({
				container,
				style: basemap.style,
				bounds: toMaplibreBounds(MAP_VIEW_PRESETS[INITIAL_VIEW_PRESET].bounds),
				fitBoundsOptions: { padding: MAP_CAMERA.fitPaddingPx },
				maxBounds: toMaplibreBounds(MAP_MAX_BOUNDS),
				minZoom: MAP_CAMERA.minZoom,
				maxZoom: MAP_CAMERA.maxZoom,
				// Strictly 2D: no pitch, no rotation, single world copy.
				pitch: 0,
				minPitch: 0,
				maxPitch: 0,
				bearing: 0,
				dragRotate: false,
				pitchWithRotate: false,
				touchPitch: false,
				renderWorldCopies: false,
				attributionControl: false,
				interactive
			});
			map = m;
			m.touchZoomRotate.disableRotation();
			m.keyboard.disableRotation();

			if (controls) {
				m.addControl(
					new maplibre.NavigationControl({ showCompass: false, visualizePitch: false }),
					'top-right'
				);
				m.addControl(new maplibre.ScaleControl({ unit: 'metric', maxWidth: 96 }), 'bottom-left');
				m.addControl(new maplibre.AttributionControl({ compact: true }), 'bottom-right');
			}

			// Some keyless styles reference POI icons missing from their sprite; render those as
			// blank instead of warning on every tile.
			m.setMissingStyleImageResolver((id) => {
				if (!m.hasImage(id)) m.addImage(id, BLANK_IMAGE);
			});
			m.on('load', () => {
				// Compact attribution starts expanded; keep it collapsed behind its (i) button.
				container
					.querySelector('.maplibregl-ctrl-attrib')
					?.classList.remove('maplibregl-compact-show');
				mapState.view = readView(m);
				mapState.attachCamera(createCamera(m));
				mapState.markReady();
				readyMap = m;
			});
			m.on('moveend', () => (mapState.view = readView(m)));
			m.on('mousemove', (e) => (mapState.cursor = [e.lngLat.lng, e.lngLat.lat]));
			m.on('mouseout', () => (mapState.cursor = null));
			// Tile/glyph failures are recoverable; keep them out of the error console.
			m.on('error', (e) => {
				if (mapState.status !== 'ready') mapState.fail(e.error.message);
				else console.warn('[map]', e.error.message);
			});
		}

		init().catch((error: unknown) => {
			mapState.fail(error instanceof Error ? error.message : 'Map failed to initialise');
		});

		return () => {
			disposed = true;
			readyMap = null;
			mapState.detachCamera();
			map?.remove();
		};
	});
</script>

<!-- MapLibre's CSS forces position: relative on its container, so positioning lives on a wrapper. -->
<div class="absolute inset-0">
	<div bind:this={container} class="mobility-map h-full w-full" aria-label="Map"></div>
</div>

{#if readyMap && layers}
	{@render layers(readyMap)}
{/if}
