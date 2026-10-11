<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { getHexagonAreaAvg, UNITS } from 'h3-js';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import type { FeatureCollection, Point, LineString, Polygon, MultiPolygon } from 'geojson';
	import type { Map as LibreMap, GeoJSONSource, ExpressionSpecification } from 'maplibre-gl';
	import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
	import { type GraphicKind, type GraphicState } from './graphics/transportGraphics.ts';
	import { createMapSprite, MAP_GRAPHIC_STATES } from './graphics/mapSprites.ts';
	import {
		BASEMAP_PREFIX,
		loadBasemap,
		type BasemapMode,
		type BasemapLoadResult
	} from './basemaps.ts';
	import { waveFrame, type RecalculationWave, type WaveGeometry } from './recalculationWave.ts';
	import { GPUWaveLayer } from './gpuWaveLayer.ts';
	import { HONEYCOMB_RESOLUTION } from './honeycombGrid.ts';
	import { roadDirectionMarkers } from './roadDirections.ts';
	import { TRAVEL_TIME_BANDS } from './travelTimeBands.ts';
	import {
		connectionStopMarkers,
		dragTarget,
		reconcileStopEditRevision,
		resolveStopDragIcon,
		stopIds,
		StopDragSession,
		withoutDraggedStop,
		type MapCoordinate
	} from './mapStopEditing.ts';

	// Keep the People palette comparable when the display grid gets finer.
	const populationColorScale =
		getHexagonAreaAvg(11, UNITS.km2) / getHexagonAreaAvg(HONEYCOMB_RESOLUTION, UNITS.km2);
	const journeyColors: ExpressionSpecification = [
		'match',
		['get', 'journeyTimeBand'],
		TRAVEL_TIME_BANDS[0].id,
		TRAVEL_TIME_BANDS[0].color,
		...TRAVEL_TIME_BANDS.slice(1).flatMap((band) => [band.id, band.color]),
		'#65717d'
	];
	const impactColors: ExpressionSpecification = [
		'match',
		['get', 'journeyChange'],
		'faster',
		'#16886c',
		'new-route',
		'#087e83',
		'slower',
		'#c45f48',
		'lost-route',
		'#c45f48',
		'mixed',
		'#8374ad',
		'unknown',
		'#65717d',
		'#a0acb0'
	];
	// Keep actual changes visible when both journeys fall in the same time band.
	// Partial gains remain purple rather than implying every resident benefits.
	const changeColors: ExpressionSpecification = [
		'case',
		['>=', ['coalesce', ['get', 'improvedShare'], 0], 0.999999],
		'#16886c',
		['>=', ['coalesce', ['get', 'worsenedShare'], 0], 0.999999],
		'#c45f48',
		'#8374ad'
	];

	let {
		land,
		buildings,
		streets,
		areas,
		analysisGrid,
		wave = null,
		routes,
		symbols,
		contextSymbols = { type: 'FeatureCollection', features: [] },
		roadConditions = { type: 'FeatureCollection', features: [] },
		weatherAreas = { type: 'FeatureCollection', features: [] },
		playbackSymbols = { type: 'FeatureCollection', features: [] },
		selectedRoads = [],
		roadSelectionEnabled = false,
		onroadselect,
		policyLayers = [],
		connectionMode = false,
		connectionStopIds = [],
		connectionPreview = { type: 'FeatureCollection', features: [] },
		journey,
		selectedId = '',
		view = 'access',
		overlayOpacity = 0.12,
		perspective = false,
		detailGrid = false,
		placing = false,
		basemap = 'atlas',
		satelliteStyle = null,
		placementPoint = null,
		placementState = 'draft',
		placementLabel = 'Place a stop',
		placementIcon = 'shelter',
		editMode = false,
		selectedStopId = '',
		editRevision = 0,
		focusCoordinate = null,
		overviewRequest = 0,
		controlsHeight = 44,
		mobileBottomInset = 76,
		planningDockActive = false,
		onselect,
		onplace,
		onready,
		onhoverplace,
		oncancelplace,
		onrouteselect,
		onclear,
		oncontextselect,
		onbasemaperror,
		onstopselect,
		onstopdragstart,
		onstoppreview,
		onstopcommit,
		onstopcancel,
		onconnectionstopselect,
		onconnectionplace,
		onconnectioncancel,
		onwavefinish
	}: {
		land: FeatureCollection;
		buildings?: FeatureCollection;
		streets: FeatureCollection<LineString>;
		areas: FeatureCollection<Polygon | MultiPolygon>;
		/** Land-clipped H3 outline; population and access are aggregated separately. */
		analysisGrid?: FeatureCollection<WaveGeometry>;
		wave?: RecalculationWave | null;
		routes: FeatureCollection<LineString>;
		symbols: FeatureCollection<Point>;
		contextSymbols?: FeatureCollection<Point>;
		roadConditions?: FeatureCollection<LineString>;
		weatherAreas?: FeatureCollection;
		playbackSymbols?: FeatureCollection<Point>;
		selectedRoads?: string[];
		roadSelectionEnabled?: boolean;
		onroadselect?: (edgeId: string) => void;
		/** Optional official GIS observations. They provide audit context, not validated routing edges. */
		policyLayers?: {
			id: string;
			kind: 'pavements' | 'lots' | 'trees' | 'audits';
			data: FeatureCollection;
		}[];
		/** Root owns ordered selection and validates road geometry before applying a connection. */
		connectionMode?: boolean;
		connectionStopIds?: string[];
		connectionPreview?: FeatureCollection<LineString>;
		journey: FeatureCollection<LineString>;
		selectedId?: string;
		view?: string;
		/** Maximum hexagon color opacity, independent of analytical results. */
		overlayOpacity?: number;
		perspective?: boolean;
		detailGrid?: boolean;
		placing?: boolean;
		basemap?: BasemapMode;
		satelliteStyle?: BasemapLoadResult | null;
		placementPoint?: MapCoordinate | null;
		placementState?: GraphicState;
		placementLabel?: string;
		placementIcon?: GraphicKind;
		editMode?: boolean;
		selectedStopId?: string;
		/** Increment on external history/cancel changes; accepted onstopcommit excludes itself. */
		editRevision?: number;
		focusCoordinate?: [number, number] | null;
		overviewRequest?: number;
		controlsHeight?: number;
		/** Visible mobile navigation and sheet height, in map-container pixels. */
		mobileBottomInset?: number;
		planningDockActive?: boolean;
		onselect: (originId: string, cellId: string) => void;
		onplace: (position: [number, number]) => void;
		onready?: (capture: () => Promise<string>) => void;
		onhoverplace?: (position: MapCoordinate) => void;
		oncancelplace?: () => void;
		onrouteselect?: (id: string) => void;
		onclear?: () => void;
		oncontextselect?: (kind: 'vessel' | 'airport') => void;
		onbasemaperror?: (reason: string) => void;
		onstopselect?: (id: string) => void;
		onstopdragstart?: (id: string) => void;
		/** Coordinates only. The parent schedules/debounces analysis outside the pointer loop. */
		onstoppreview?: (id: string, position: MapCoordinate) => void;
		onstopcommit?: (id: string, position: MapCoordinate) => MapCoordinate | null | void;
		onstopcancel?: () => void;
		onconnectionstopselect?: (id: string) => void;
		onconnectionplace?: (position: MapCoordinate) => void;
		onconnectioncancel?: () => void;
		/** Called only after actual analysis has settled and the highlight has faded. */
		onwavefinish?: (id: number, outcome: 'success' | 'error') => void;
	} = $props();
	let colorOpacity = $derived(
		Number.isFinite(overlayOpacity) ? Math.max(0, Math.min(1, overlayOpacity)) : 0.12
	);
	let journeyOpacity: ExpressionSpecification = $derived([
		'case',
		['>', ['get', 'population'], 0],
		colorOpacity,
		0
	]);
	// Impact changes the meaning of the colors, not the geographic coverage.
	// Keep neutral and incomplete cells at the user's chosen opacity too.
	let contextEdgeOpacity: ExpressionSpecification = $derived([
		'case',
		['>', ['get', 'population'], 0],
		Math.min(0.3, colorOpacity * 2),
		0
	]);
	let changeOpacity: ExpressionSpecification = $derived([
		'case',
		[
			'all',
			['>', ['get', 'population'], 0],
			[
				'any',
				['>', ['get', 'improvedPopulation'], 0.000001],
				['>', ['get', 'worsenedPopulation'], 0.000001]
			]
		],
		Math.min(0.8, colorOpacity * 5),
		0
	]);
	let peopleOpacity: ExpressionSpecification = $derived([
		'interpolate',
		['linear'],
		['*', ['get', 'population'], populationColorScale],
		0,
		0,
		50,
		colorOpacity * 0.3125,
		300,
		colorOpacity * 0.625,
		1000,
		colorOpacity
	]);
	let container: HTMLDivElement;
	let map = $state.raw<LibreMap | null>(null);
	let failed = $state('');
	let autoFit = true;
	const componentId = $props.id();
	const instructionsId = `${componentId}-instructions`;
	let dragging = $state.raw<{
		id: string;
		name: string;
		position: MapCoordinate;
		moved: boolean;
	} | null>(null);
	let heldMove = $state.raw<{ id: string; position: MapCoordinate; icon: string } | null>(null);
	let cancelDrag: (() => void) | undefined;
	let invalidateEditing: (() => void) | undefined;
	let lastEditRevision: number | undefined;
	let renderEditingSources: (() => void) | undefined;
	let renderConnection: (() => void) | undefined;
	let renderWave:
		((descriptor: RecalculationWave | null, reducedMotion: boolean) => void) | undefined;
	let stopWave: (() => void) | undefined;
	let reducedWaveMotion = $state(false);
	let finishedWaveId: number | null = null;
	let basemapLoading = $state(false);
	let placementCursor: MapCoordinate | null = null;
	let renderPlacement: (() => void) | undefined;
	let insetCameraMap: LibreMap | null = null;
	let cameraBottomInset: number | undefined;
	let pendingFocusCoordinate: [number, number] | null = null;
	let policyLayerMap: LibreMap | null = null;
	const policyLayerIds = new SvelteMap<string, string[]>();
	let mobileFocus: {
		map: LibreMap;
		startInset: number;
		nextInset: number;
		cancel: () => void;
	} | null = null;
	function panMobileInset(m: LibreMap, difference: number) {
		if (
			autoFit ||
			container.clientWidth <= 0 ||
			container.clientHeight <= 0 ||
			container.clientWidth > 680 ||
			Math.abs(difference) < 1
		)
			return;
		m.panBy([0, difference / 2], {
			duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220
		});
	}
	function trackMobileFocus(m: LibreMap, inset: number) {
		mobileFocus?.cancel();
		// Stop an earlier camera transition before attaching this focus's moveend listener.
		m.stop();
		const canvas = m.getCanvas();
		const focus = {
			map: m,
			startInset: inset,
			nextInset: inset,
			cancel: () => {
				if (mobileFocus !== focus) return;
				detach();
				mobileFocus = null;
				cameraBottomInset = focus.nextInset;
			}
		};
		function detach() {
			m.off('moveend', finish);
			m.off('dragstart', focus.cancel);
			canvas.removeEventListener('pointerdown', focus.cancel, true);
		}
		function finish() {
			if (mobileFocus !== focus) return;
			detach();
			mobileFocus = null;
			cameraBottomInset = focus.nextInset;
			// ResizeObserver can report the sheet after the focus has begun. Let its
			// intended zoom settle, then apply the accumulated occlusion adjustment.
			panMobileInset(m, focus.nextInset - focus.startInset);
		}
		mobileFocus = focus;
		m.on('moveend', finish);
		m.on('dragstart', focus.cancel);
		// Cancel before MapLibre stops easing for direct pointer interaction.
		canvas.addEventListener('pointerdown', focus.cancel, { capture: true, passive: true });
	}
	function overviewPadding() {
		const width = container.clientWidth;
		const height = container.clientHeight;
		if (width <= 680)
			return {
				top: Math.min(height * 0.28, controlsHeight + 24),
				bottom: Math.min(height * 0.45, mobileBottomInset + 20),
				left: 24,
				right: 24
			};
		return {
			top: Math.min(height * 0.25, controlsHeight + 12, 90),
			bottom: Math.min(height * 0.45, mobileBottomInset + 20),
			left: Math.min(240, width * 0.16),
			right: Math.min(240, width * 0.16)
		};
	}
	function focusOptions() {
		if (planningDockActive && container.clientWidth > 680) {
			const top = Math.min(100, controlsHeight);
			const bottom = Math.min(mobileBottomInset + 20, container.clientHeight - top - 96);
			return { padding: 0, offset: [0, (top - bottom) / 2] as [number, number] };
		}
		if (container.clientWidth <= 680) {
			const { top } = overviewPadding();
			// Focus uses the actual sheet occlusion; overview's capped padding is
			// designed to show every island and can leave a selection behind a sheet.
			const bottom = Math.min(
				Math.max(0, mobileBottomInset + 20),
				Math.max(0, container.clientHeight - top - 96)
			);
			return {
				// Clear overview padding so this offset is applied to the whole canvas once.
				padding: 0,
				offset: [0, (top - bottom) / 2] as [number, number]
			};
		}
		const width = container.clientWidth;
		const panelWidth =
			container.clientHeight <= 500
				? Math.min(420, width - 384)
				: width >= 1600
					? 390
					: width <= 900
						? 300
						: width <= 1150
							? 335
							: 360;
		return {
			padding: 0,
			// Keep the selected location between the planning controls and detail panel.
			offset: [(312 - panelWidth) / 2, -65] as [number, number]
		};
	}
	function focusAt(m: LibreMap, coordinate: [number, number], animate = true) {
		insetCameraMap = m;
		cameraBottomInset = mobileBottomInset;
		if (container.clientWidth <= 680) trackMobileFocus(m, mobileBottomInset);
		else mobileFocus?.cancel();
		m.easeTo({
			center: coordinate,
			zoom: 14.5,
			...focusOptions(),
			duration: animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 250 : 0
		});
	}
	function removeBasemap(m: LibreMap) {
		for (const layer of [...(m.getStyle().layers ?? [])].reverse())
			if (layer.id.startsWith(BASEMAP_PREFIX)) m.removeLayer(layer.id);
		for (const source of Object.keys(m.getStyle().sources ?? {}))
			if (source.startsWith(BASEMAP_PREFIX)) m.removeSource(source);
	}
	function showAtlas(m: LibreMap, visible: boolean) {
		for (const id of [
			'land-shadow',
			'island-land',
			'building-footprints',
			'street-casing',
			'streets'
		])
			if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
	}
	const empty: FeatureCollection = { type: 'FeatureCollection', features: [] };
	const mapLabels = [
		{ name: 'MALÉ', point: [73.5103, 4.176] as [number, number] },
		{ name: 'HULHUMALÉ', point: [73.5392, 4.234] as [number, number] },
		{ name: 'VILLIMALÉ', point: [73.4858, 4.173] as [number, number] },
		{ name: 'HULHULÉ', point: [73.5323, 4.191] as [number, number] }
	];
	onMount(() => {
		let disposed = false;
		const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
		reducedWaveMotion = motionQuery.matches;
		const updateWaveMotion = () => (reducedWaveMotion = motionQuery.matches);
		motionQuery.addEventListener('change', updateWaveMotion);
		let instance: LibreMap | undefined;
		let removeEditingListeners: (() => void) | undefined;
		let removeWaveListeners: (() => void) | undefined;
		let resizeFrame = 0;
		let cameraWasMobile = container.clientWidth <= 680;
		let cameraWasShort = container.clientHeight <= 500;
		const resizeObserver = new ResizeObserver(() => {
			cancelAnimationFrame(resizeFrame);
			resizeFrame = requestAnimationFrame(() => {
				const m = instance;
				if (!m) return;
				// Analytical pages keep this map mounted. A hidden container is not a
				// mobile viewport, and resizing it to zero would discard its camera.
				if (container.clientWidth <= 0 || container.clientHeight <= 0) return;
				const mobile = container.clientWidth <= 680;
				const short = container.clientHeight <= 500;
				const crossedBreakpoint = mobile !== cameraWasMobile || short !== cameraWasShort;
				const center = m.getCenter();
				const zoom = m.getZoom();
				const padding = m.getPadding();
				const retainedPadding = Object.values(padding).some((value) => value !== 0);
				if (!autoFit && (crossedBreakpoint || retainedPadding)) {
					mobileFocus?.cancel();
					m.stop();
					// Desktop overview padding can exceed a phone's entire canvas. Clear it
					// before resizing, then keep the user's geographic center and zoom.
					m.jumpTo({ center, zoom, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
				}
				m.resize();
				if (crossedBreakpoint) {
					insetCameraMap = m;
					cameraBottomInset = mobileBottomInset;
				}
				if (pendingFocusCoordinate) {
					const coordinate = pendingFocusCoordinate;
					pendingFocusCoordinate = null;
					focusAt(m, coordinate, false);
				} else if (autoFit)
					m.fitBounds(
						[
							[73.476, 4.165],
							[73.555, 4.245]
						],
						{ duration: 0, padding: overviewPadding() }
					);
				else if (crossedBreakpoint && focusCoordinate) {
					// Compact layouts change the position of the overlays. Re-anchor
					// it once to the new usable viewport, keeping the explored zoom.
					if (mobile) trackMobileFocus(m, mobileBottomInset);
					m.easeTo({ center: focusCoordinate, zoom, ...focusOptions(), duration: 0 });
				} else if (crossedBreakpoint || retainedPadding)
					m.jumpTo({ center, zoom, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
				cameraWasMobile = mobile;
				cameraWasShort = short;
			});
		});
		resizeObserver.observe(container);
		async function init() {
			const lib = await import('maplibre-gl');
			if (disposed) return;
			lib.setWorkerUrl(maplibreWorkerUrl);
			instance = new lib.Map({
				container,
				// The container observer owns resizing so it can clear stale camera
				// padding before MapLibre adapts the canvas to a different breakpoint.
				trackResize: false,
				style: {
					version: 8,
					sources: {},
					layers: [{ id: 'lagoon', type: 'background', paint: { 'background-color': '#dceef0' } }]
				},
				bounds: [
					[73.476, 4.165],
					[73.555, 4.245]
				],
				fitBoundsOptions: {
					padding: overviewPadding()
				},
				minZoom: 10,
				maxZoom: 18.5,
				maxPitch: 40,
				pitch: 0,
				bearing: 0,
				dragRotate: false,
				touchPitch: false,
				pitchWithRotate: false,
				renderWorldCopies: false,
				attributionControl: false,
				canvasContextAttributes: { preserveDrawingBuffer: true }
			});
			instance.touchZoomRotate.disableRotation();
			instance.on('dragstart', () => {
				autoFit = false;
			});
			instance.on('movestart', (event) => {
				// Wheel, navigation-button and keyboard exploration should survive a
				// page switch just as dragging does. Programmatic overview fits stay automatic.
				if (event.originalEvent) autoFit = false;
			});
			instance.addControl(
				new lib.AttributionControl({
					compact: false,
					customAttribution:
						'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a> · ODbL | Maldives Bureau of Statistics · WorldPop'
				}),
				'bottom-left'
			);
			instance.addControl(new lib.NavigationControl({ showCompass: false }), 'bottom-right');
			instance.addControl(new lib.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-left');
			instance.on('load', async () => {
				const m = instance!;
				for (const [id, data] of Object.entries({
					land,
					buildings,
					streets,
					areas,
					'analysis-grid-cells': analysisGrid ?? areas,
					routes,
					'connection-preview': connectionMode ? connectionPreview : empty,
					symbols,
					journey,
					'transport-context': contextSymbols,
					'road-conditions': roadConditions,
					'road-directions': roadDirectionMarkers(roadConditions, selectedRoads),
					'weather-advisories': weatherAreas,
					'service-playback': playbackSymbols
				}))
					m.addSource(id, { type: 'geojson', data: data ?? empty });
				m.addLayer({
					id: 'land-shadow',
					type: 'line',
					source: 'land',
					paint: { 'line-color': '#b9d4d2', 'line-width': 6, 'line-blur': 3 }
				});
				m.addLayer({
					id: 'island-land',
					type: 'fill',
					source: 'land',
					paint: { 'fill-color': '#f5f2e7', 'fill-outline-color': '#a7c9c4' }
				});
				m.addLayer({
					id: 'building-footprints',
					type: 'fill',
					source: 'buildings',
					paint: {
						'fill-color': '#dddcc9',
						'fill-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.3, 15, 0.75]
					}
				});
				m.addLayer({
					id: 'street-casing',
					type: 'line',
					source: 'streets',
					paint: {
						'line-color': '#d9d9cb',
						'line-width': ['interpolate', ['linear'], ['zoom'], 11, 1, 17, 7]
					}
				});
				m.addLayer({
					id: 'streets',
					type: 'line',
					source: 'streets',
					paint: {
						'line-color': '#fffefa',
						'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 17, 5]
					}
				});
				m.addLayer(
					{
						id: 'access-areas',
						type: 'fill',
						source: 'areas',
						paint: {
							'fill-color': view === 'impact' ? impactColors : journeyColors,
							'fill-opacity': journeyOpacity,
							'fill-opacity-transition': { duration: 0 },
							'fill-antialias': false
						}
					},
					'building-footprints'
				);
				m.addLayer(
					{
						id: 'people-areas',
						type: 'fill',
						source: 'areas',
						layout: { visibility: 'none' },
						paint: {
							'fill-color': '#138c94',
							'fill-opacity': peopleOpacity,
							'fill-opacity-transition': { duration: 0 },
							'fill-antialias': false
						}
					},
					'building-footprints'
				);
				m.addLayer({
					id: 'area-cell-edges',
					type: 'line',
					source: 'areas',
					layout: { visibility: view === 'impact' ? 'visible' : 'none' },
					paint: {
						'line-color': '#7b8b94',
						'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.2, 15, 0.5, 18, 0.7],
						'line-opacity': contextEdgeOpacity
					}
				});
				m.addLayer({
					id: 'journey-change-outlines',
					type: 'line',
					source: 'areas',
					layout: { visibility: view === 'people' ? 'none' : 'visible' },
					paint: {
						'line-color': changeColors,
						'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.5, 15, 1, 18, 1.4],
						'line-opacity': changeOpacity,
						'line-opacity-transition': { duration: 180 }
					}
				});
				m.addLayer({
					id: 'analysis-grid',
					type: 'line',
					source: 'analysis-grid-cells',
					layout: { visibility: 'none' },
					paint: { 'line-color': '#356775', 'line-width': 0.4, 'line-opacity': 0.22 }
				});
				// Geometry is uploaded once per edit; the animation changes GPU uniforms only.
				let waveLayer: GPUWaveLayer | null = new GPUWaveLayer();
				try {
					m.addLayer(waveLayer);
				} catch (error) {
					// A decorative renderer failure must not discard or lock a model result.
					console.warn('Recalculation highlight unavailable:', error);
					if (m.getLayer('recalculation-wave')) m.removeLayer('recalculation-wave');
					waveLayer = null;
				}
				let waveAnimationFrame = 0;
				let waveFinishTimer: ReturnType<typeof setTimeout> | undefined;
				let activeWaveId: number | null = null;
				let lastWaveOpacity = 0;
				let previousDescriptor: RecalculationWave | null = null;
				let opacityRecovery: { startedAt: number; from: number } | null = null;
				stopWave = () => {
					cancelAnimationFrame(waveAnimationFrame);
					clearTimeout(waveFinishTimer);
				};
				renderWave = (descriptor, staticMotion) => {
					stopWave?.();
					activeWaveId = descriptor?.id ?? null;
					if (!descriptor || finishedWaveId === descriptor.id) {
						waveLayer?.setFrame(0, 0, staticMotion);
						lastWaveOpacity = 0;
						previousDescriptor = null;
						opacityRecovery = null;
						waveLayer?.setCells(null);
						return;
					}
					if (
						descriptor.completedAt === null &&
						previousDescriptor?.completedAt !== null &&
						previousDescriptor !== null &&
						lastWaveOpacity < 1
					) {
						// A new calculation can invalidate a fading result. Ease back to
						// the pending tint instead of abruptly restoring full saturation.
						opacityRecovery = { startedAt: performance.now(), from: lastWaveOpacity };
					}
					previousDescriptor = descriptor;
					try {
						waveLayer?.setCells(descriptor.cells);
					} catch (error) {
						console.warn('Recalculation highlight unavailable:', error);
						waveLayer?.setFrame(0, 0, staticMotion);
						waveLayer = null;
					}
					function tick() {
						if (disposed || activeWaveId !== descriptor!.id) return;
						const now = performance.now();
						const frame = waveFrame(descriptor!, now, staticMotion);
						let recovering = false;
						let opacity = frame.opacity;
						if (opacityRecovery) {
							const progress = Math.max(0, Math.min(1, (now - opacityRecovery.startedAt) / 120));
							const eased = progress * progress * (3 - 2 * progress);
							opacity = Math.min(
								opacity,
								opacityRecovery.from + (1 - opacityRecovery.from) * eased
							);
							recovering = progress < 1;
							if (!recovering) opacityRecovery = null;
						}
						waveLayer?.setFrame(frame.elapsedMs, opacity, staticMotion);
						lastWaveOpacity = opacity;
						if (frame.finished) {
							stopWave?.();
							finishedWaveId = descriptor!.id;
							onwavefinish?.(descriptor!.id, descriptor!.outcome ?? 'success');
						} else if (frame.animating || recovering) {
							waveAnimationFrame = requestAnimationFrame(tick);
						}
					}
					tick();
					const frame = waveFrame(descriptor, performance.now(), staticMotion);
					if (frame.finishAt !== null && !frame.finished) {
						// Background tabs throttle RAF. The actual-settlement gate remains
						// authoritative, and a hidden tab must not lock the editor forever.
						waveFinishTimer = setTimeout(
							tick,
							Math.max(20, frame.finishAt - performance.now() + 20)
						);
					}
				};
				// MapLibre serializes regular layers after context loss but omits custom
				// layers. Recreate our buffers once the replacement style has loaded.
				const restoreWaveLayer = () => {
					if (disposed || m.getLayer('recalculation-wave')) return;
					waveLayer = new GPUWaveLayer();
					try {
						m.addLayer(waveLayer, m.getLayer('selected-area') ? 'selected-area' : undefined);
					} catch (error) {
						console.warn('Recalculation highlight unavailable:', error);
						if (m.getLayer('recalculation-wave')) m.removeLayer('recalculation-wave');
						waveLayer = null;
					}
					renderWave?.(wave, reducedWaveMotion);
				};
				m.on('style.load', restoreWaveLayer);
				removeWaveListeners = () => m.off('style.load', restoreWaveLayer);
				m.addLayer({
					id: 'selected-area',
					type: 'line',
					source: 'areas',
					filter: ['==', ['get', 'id'], selectedId],
					paint: { 'line-color': '#103e49', 'line-width': 3 }
				});
				m.addLayer({
					id: 'route-casing',
					type: 'line',
					source: 'routes',
					layout: { 'line-join': 'round', 'line-cap': 'round' },
					paint: { 'line-color': '#ffffff', 'line-width': 7, 'line-opacity': 0.9 }
				});
				m.addLayer({
					id: 'service-routes',
					type: 'line',
					source: 'routes',
					layout: { 'line-join': 'round', 'line-cap': 'round' },
					paint: {
						'line-color': ['case', ['==', ['get', 'proposed'], true], '#047e7e', '#5587bb'],
						'line-width': 3.5,
						'line-opacity': ['case', ['==', ['get', 'enabled'], false], 0.25, 1]
					}
				});
				m.addLayer({
					id: 'connection-preview-casing',
					type: 'line',
					source: 'connection-preview',
					layout: { 'line-join': 'round', 'line-cap': 'round' },
					paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.95 }
				});
				m.addLayer({
					id: 'connection-preview-route',
					type: 'line',
					source: 'connection-preview',
					layout: { 'line-join': 'round', 'line-cap': 'round' },
					paint: { 'line-color': '#b86b14', 'line-width': 4, 'line-dasharray': [2, 1] }
				});
				m.addLayer({
					id: 'weather-advisory-fill',
					type: 'fill',
					source: 'weather-advisories',
					paint: { 'fill-color': '#c79042', 'fill-opacity': 0.055 }
				});
				m.addLayer({
					id: 'weather-advisory-outline',
					type: 'line',
					source: 'weather-advisories',
					paint: {
						'line-color': '#c79042',
						'line-width': 2,
						'line-opacity': 0.6,
						'line-dasharray': [3, 3]
					}
				});
				m.addLayer({
					id: 'road-pick-target',
					type: 'line',
					source: 'road-conditions',
					paint: { 'line-color': '#215f9c', 'line-width': 15, 'line-opacity': 0.01 }
				});
				m.addLayer({
					id: 'road-selection',
					type: 'line',
					source: 'road-conditions',
					filter: ['in', ['get', 'edgeId'], ['literal', selectedRoads]],
					paint: { 'line-color': '#3075b4', 'line-width': 6, 'line-opacity': 0.85 }
				});
				const directionCanvas = document.createElement('canvas');
				directionCanvas.width = directionCanvas.height = 24;
				const directionContext = directionCanvas.getContext('2d')!;
				directionContext.beginPath();
				directionContext.moveTo(12, 3);
				directionContext.lineTo(19, 20);
				directionContext.lineTo(12, 16);
				directionContext.lineTo(5, 20);
				directionContext.closePath();
				directionContext.fillStyle = '#ffffff';
				directionContext.fill();
				directionContext.strokeStyle = '#215f9c';
				directionContext.lineWidth = 2;
				directionContext.stroke();
				m.addImage('road-direction-arrow', directionContext.getImageData(0, 0, 24, 24), {
					pixelRatio: 1.5
				});
				m.addLayer({
					id: 'road-direction-arrows',
					type: 'symbol',
					source: 'road-directions',
					layout: {
						'icon-image': 'road-direction-arrow',
						'icon-rotate': ['get', 'bearing'],
						'icon-rotation-alignment': 'map',
						'icon-pitch-alignment': 'map',
						'icon-allow-overlap': true
					}
				});
				m.addLayer({
					id: 'road-impacts',
					type: 'line',
					source: 'road-conditions',
					filter: ['!=', ['get', 'disruptionKind'], 'none'],
					paint: {
						'line-color': ['match', ['get', 'disruptionKind'], 'closure', '#c44f41', '#d89228'],
						'line-width': 5,
						'line-opacity': 0.95,
						'line-dasharray': [2, 1]
					}
				});
				m.addLayer({
					id: 'journey-casing',
					type: 'line',
					source: 'journey',
					paint: { 'line-color': '#ffffff', 'line-width': 8 }
				});
				m.addLayer({
					id: 'journey-route',
					type: 'line',
					source: 'journey',
					layout: { 'line-cap': 'round', 'line-join': 'round' },
					paint: { 'line-color': '#163f52', 'line-width': 4, 'line-dasharray': [1.5, 1.5] }
				});
				const kinds: GraphicKind[] = [
					'bus',
					'ferry',
					'hospital',
					'clinic',
					'school',
					'terminal',
					'shelter',
					'cargo-ship',
					'speedboat',
					'vessel',
					'airport'
				];
				await Promise.all(
					kinds.map(async (kind) => {
						const states = ['cargo-ship', 'speedboat', 'vessel', 'airport'].includes(kind)
							? (['existing'] as const)
							: MAP_GRAPHIC_STATES;
						await Promise.all(
							states.map(async (state) => {
								const picture = await createMapSprite(kind, state);
								if (!disposed)
									m.addImage(state === 'existing' ? kind : `${kind}-${state}`, picture, {
										pixelRatio: 2
									});
							})
						);
					})
				);
				if (disposed) return;
				m.addLayer({
					id: 'playback-halo',
					type: 'circle',
					source: 'service-playback',
					paint: {
						'circle-radius': 17,
						'circle-color': '#ffffff',
						'circle-opacity': 0.85,
						'circle-stroke-color': '#1c705e',
						'circle-stroke-width': 2
					}
				});
				m.addLayer({
					id: 'playback-vehicles',
					type: 'symbol',
					source: 'service-playback',
					layout: {
						'icon-image': ['match', ['get', 'mode'], 'ferry', 'ferry', 'bus'],
						'icon-size': 0.8,
						'icon-allow-overlap': true,
						'icon-ignore-placement': true,
						'icon-pitch-alignment': 'viewport',
						'icon-rotation-alignment': 'viewport'
					}
				});
				m.addLayer({
					id: 'transport-context-boards',
					type: 'symbol',
					source: 'transport-context',
					layout: {
						'icon-image': ['get', 'icon'],
						'icon-size': 0.8,
						'icon-rotate': 0,
						'icon-padding': 5,
						'icon-allow-overlap': true,
						'icon-ignore-placement': true,
						'icon-pitch-alignment': 'viewport',
						'icon-rotation-alignment': 'viewport'
					},
					paint: { 'icon-opacity': 0.9 }
				});
				m.addLayer({
					id: 'boarding-stops',
					type: 'circle',
					source: 'symbols',
					filter: [
						'all',
						['==', ['get', 'mapKind'], 'stop'],
						['!', ['in', ['get', 'investmentState'], ['literal', ['proposed', 'draft', 'moved']]]]
					],
					paint: {
						'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.5, 15, 4.5, 18, 6],
						'circle-color': [
							'match',
							['get', 'state'],
							'untimed',
							'#80969d',
							'disabled',
							'#adb6b5',
							'#168b97'
						],
						'circle-stroke-color': '#ffffff',
						'circle-stroke-width': 1.3,
						'circle-opacity': ['case', ['==', ['get', 'state'], 'disabled'], 0.5, 0.95]
					}
				});
				m.addLayer({
					id: 'boarding-boards',
					type: 'symbol',
					source: 'symbols',
					minzoom: 14,
					filter: [
						'all',
						['==', ['get', 'mapKind'], 'stop'],
						['!', ['in', ['get', 'investmentState'], ['literal', ['proposed', 'draft', 'moved']]]]
					],
					layout: {
						'icon-image': [
							'case',
							['==', ['get', 'investmentState'], 'paused'],
							['concat', ['get', 'icon'], '-paused'],
							['get', 'icon']
						],
						'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.75, 17, 0.9],
						'icon-padding': 3,
						'icon-allow-overlap': false,
						'icon-pitch-alignment': 'viewport',
						'icon-rotation-alignment': 'viewport'
					},
					paint: { 'icon-opacity': ['case', ['==', ['get', 'disabled'], true], 0.75, 1] }
				});
				m.addLayer({
					id: 'facility-boards',
					type: 'symbol',
					source: 'symbols',
					filter: ['==', ['get', 'mapKind'], 'facility'],
					layout: {
						'icon-image': [
							'case',
							[
								'in',
								['get', 'investmentState'],
								['literal', ['proposed', 'draft', 'moved', 'paused']]
							],
							['concat', ['get', 'icon'], '-', ['get', 'investmentState']],
							['get', 'icon']
						],
						'icon-size': ['interpolate', ['linear'], ['zoom'], 11.5, 0.7, 14.5, 0.9, 17, 1],
						'icon-padding': 3,
						'icon-allow-overlap': false,
						'icon-pitch-alignment': 'viewport',
						'icon-rotation-alignment': 'viewport'
					},
					paint: { 'icon-opacity': ['case', ['==', ['get', 'disabled'], true], 0.35, 1] }
				});
				m.addLayer({
					id: 'investment-boards',
					type: 'symbol',
					source: 'symbols',
					filter: [
						'all',
						['==', ['get', 'mapKind'], 'stop'],
						['in', ['get', 'investmentState'], ['literal', ['proposed', 'draft', 'moved']]]
					],
					layout: {
						'icon-image': ['concat', ['get', 'icon'], '-', ['get', 'investmentState']],
						'icon-size': ['interpolate', ['linear'], ['zoom'], 11.5, 0.8, 14.5, 1, 17, 1.05],
						'icon-allow-overlap': true,
						'icon-pitch-alignment': 'viewport',
						'icon-rotation-alignment': 'viewport'
					}
				});
				// Sparse context markers remain visible when a nearby stop shares their position.
				// Editor handles added below retain visual priority over these observations.
				m.moveLayer('transport-context-boards');
				m.addSource('dragged-stop', { type: 'geojson', data: empty });
				m.addSource('placement-ghost', { type: 'geojson', data: empty });
				m.addLayer({
					id: 'placement-ghost-halo',
					type: 'circle',
					source: 'placement-ghost',
					paint: {
						'circle-radius': 22,
						'circle-color': '#ffffff',
						'circle-opacity': 0.92,
						'circle-stroke-width': 2,
						'circle-stroke-color': ['case', ['get', 'valid'], '#bc6509', '#a23e35']
					}
				});
				m.addLayer({
					id: 'placement-ghost-icon',
					type: 'symbol',
					source: 'placement-ghost',
					layout: {
						'icon-image': ['get', 'icon'],
						'icon-size': 1,
						'icon-allow-overlap': true,
						'icon-pitch-alignment': 'viewport'
					},
					paint: { 'icon-opacity': 0.9 }
				});
				renderPlacement = () => {
					const point = placementPoint ?? placementCursor;
					m.getSource<GeoJSONSource>('placement-ghost')?.setData(
						placing && point
							? {
									type: 'FeatureCollection',
									features: [
										{
											type: 'Feature',
											properties: {
												valid: !!placementPoint,
												icon: `${placementIcon}-${placementState}`
											},
											geometry: { type: 'Point', coordinates: point }
										}
									]
								}
							: empty
					);
				};
				m.addSource('selected-stop-handle', { type: 'geojson', data: empty });
				m.addSource('connection-handles', { type: 'geojson', data: empty });
				m.addLayer({
					id: 'connection-handles',
					type: 'circle',
					source: 'connection-handles',
					paint: {
						'circle-radius': 18,
						'circle-color': '#fff6df',
						'circle-opacity': 0.95,
						'circle-stroke-color': '#b86b14',
						'circle-stroke-width': 2
					}
				});
				m.addLayer({
					id: 'selected-stop-handle',
					type: 'circle',
					source: 'selected-stop-handle',
					paint: {
						'circle-radius': 12,
						'circle-color': '#ffffff',
						'circle-opacity': 0.2,
						'circle-stroke-color': [
							'case',
							['in', ['get', 'investmentState'], ['literal', ['proposed', 'draft']]],
							'#bc6509',
							'#7560b5'
						],
						'circle-stroke-width': 2
					}
				});
				m.addLayer({
					id: 'dragged-stop-halo',
					type: 'circle',
					source: 'dragged-stop',
					paint: {
						'circle-radius': 18,
						'circle-color': '#ffffff',
						'circle-opacity': 0.92,
						'circle-stroke-color': ['case', ['get', 'proposed'], '#bc6509', '#7560b5'],
						'circle-stroke-width': 2
					}
				});
				m.addLayer({
					id: 'dragged-stop-icon',
					type: 'symbol',
					source: 'dragged-stop',
					layout: {
						'icon-image': ['get', 'icon'],
						'icon-size': 0.85,
						'icon-allow-overlap': true,
						'icon-pitch-alignment': 'viewport'
					}
				});
				let locationPopup: import('maplibre-gl').Popup | undefined;
				const canvas = m.getCanvas();
				canvas.setAttribute('aria-describedby', instructionsId);
				const session = new StopDragSession();
				let pointerId: number | null = null;
				let restorePan = false;
				let restoreTouchZoom = false;
				let suppressClickUntil = 0;
				let dragIcon = 'bus';
				let originalPosition: MapCoordinate | null = null;
				const pointerPixel = (event: PointerEvent): MapCoordinate => {
					const rect = canvas.getBoundingClientRect();
					return [event.clientX - rect.left, event.clientY - rect.top];
				};
				function renderDraggedStop() {
					const active = dragging?.moved ? { ...dragging, icon: dragIcon } : heldMove;
					m.getSource<GeoJSONSource>('symbols')?.setData(
						active ? withoutDraggedStop(symbols, active.id) : symbols
					);
					m.getSource<GeoJSONSource>('dragged-stop')?.setData(
						active
							? {
									type: 'FeatureCollection',
									features: [
										{
											type: 'Feature',
											properties: {
												id: active.id,
												mapKind: 'stop',
												stopIds: [active.id],
												count: 1,
												icon: active.icon,
												proposed: active.icon.endsWith('-proposed'),
												isBaselineAsset: !active.icon.endsWith('-proposed'),
												name: dragging?.name ?? 'Moved stop'
											},
											geometry: { type: 'Point', coordinates: active.position }
										}
									]
								}
							: empty
					);
					const selected = symbols.features.find((feature) =>
						stopIds(feature.properties).includes(selectedStopId)
					);
					m.getSource<GeoJSONSource>('selected-stop-handle')?.setData(
						editMode && selected && !active && !connectionMode
							? {
									type: 'FeatureCollection',
									features: [
										{
											...selected,
											properties: {
												...selected.properties,
												id: selectedStopId,
												stopIds: [selectedStopId],
												count: 1
											}
										}
									]
								}
							: empty
					);
				}
				renderEditingSources = renderDraggedStop;
				const connectionNumbers: Record<
					string,
					{ marker: import('maplibre-gl').Marker; label: HTMLDivElement }
				> = {};
				renderConnection = () => {
					const handles = connectionMode
						? connectionStopMarkers(symbols, connectionStopIds)
						: empty;
					m.getSource<GeoJSONSource>('connection-handles')?.setData(handles);
					m.getSource<GeoJSONSource>('connection-preview')?.setData(
						connectionMode ? connectionPreview : empty
					);
					const retained: string[] = [];
					for (const point of handles.features) {
						if (point.geometry.type !== 'Point') continue;
						const coordinates = point.geometry.coordinates.slice(0, 2) as MapCoordinate;
						const key = coordinates.join(',');
						retained.push(key);
						let number = connectionNumbers[key];
						if (!number) {
							const label = document.createElement('div');
							label.className = 'atlas-connection-order';
							label.setAttribute('aria-hidden', 'true');
							const marker = new lib.Marker({ element: label, anchor: 'center' })
								.setLngLat(coordinates)
								.addTo(m);
							number = { marker, label };
							connectionNumbers[key] = number;
						}
						number.label.textContent = String(point.properties?.orderLabel);
						number.marker.setLngLat(coordinates);
					}
					for (const [key, number] of Object.entries(connectionNumbers)) {
						if (retained.includes(key)) continue;
						number.marker.remove();
						delete connectionNumbers[key];
					}
				};
				function endDrag(cancelled: boolean) {
					if (pointerId === null) return;
					const wasMoved = dragging?.moved;
					const previous = dragging;
					const moved = cancelled ? (session.cancel(), null) : session.finish();
					const releasedPointer = pointerId;
					pointerId = null;
					if (canvas.hasPointerCapture(releasedPointer))
						canvas.releasePointerCapture(releasedPointer);
					if (restorePan) m.dragPan.enable();
					if (restoreTouchZoom) m.touchZoomRotate.enable();
					if (!moved && wasMoved && previous && originalPosition)
						heldMove = { id: previous.id, position: originalPosition, icon: dragIcon };
					dragging = null;
					canvas.style.cursor = placing ? 'crosshair' : '';
					// The capture handler owns both tap selection and drag completion. Avoid a
					// second MapLibre click after releasing capture, which would invalidate a
					// newly accepted move through the parent's ordinary selection callback.
					if (wasMoved || (!cancelled && previous)) suppressClickUntil = performance.now() + 350;
					if (moved) {
						const acceptedPosition = onstopcommit?.(moved.id, moved.position);
						heldMove =
							acceptedPosition === null
								? null
								: { id: moved.id, position: acceptedPosition ?? moved.position, icon: dragIcon };
					} else if (wasMoved) onstopcancel?.();
					else if (!cancelled && previous) onstopselect?.(previous.id);
					renderDraggedStop();
				}
				cancelDrag = () => endDrag(true);
				invalidateEditing = () => {
					locationPopup?.remove();
					endDrag(true);
					heldMove = null;
					dragging = null;
					renderDraggedStop();
				};
				function chooseDirection(
					location: import('maplibre-gl').MapGeoJSONFeature,
					ids: string[],
					connecting = false
				) {
					locationPopup?.remove();
					const content = document.createElement('div');
					content.className = 'atlas-location';
					const title = document.createElement('strong');
					title.textContent = connecting
						? 'Choose a stop for this connection'
						: 'Choose a boarding direction';
					const note = document.createElement('p');
					note.textContent = connecting
						? 'These boarding directions share a coordinate. Choose the code this bus should serve.'
						: 'These codes share a coordinate. Choose one, then drag the stop.';
					content.append(title, note);
					let names: unknown = location.properties.stopNames;
					if (typeof names === 'string') {
						try {
							names = JSON.parse(names);
						} catch {
							names = [];
						}
					}
					for (const [index, id] of ids.entries()) {
						const button = document.createElement('button');
						button.type = 'button';
						button.className = 'atlas-direction-choice';
						button.textContent = `${Array.isArray(names) && typeof names[index] === 'string' ? names[index] : 'Boarding direction'} · ${id.replace('rtl:stop:', '')}`;
						button.addEventListener('click', () => {
							if (connecting) onconnectionstopselect?.(id);
							else onstopselect?.(id);
							locationPopup?.remove();
						});
						content.append(button);
					}
					locationPopup = new lib.Popup({ maxWidth: '300px', offset: 10 })
						.setLngLat(
							location.geometry.type === 'Point'
								? (location.geometry.coordinates as MapCoordinate)
								: m.getCenter()
						)
						.setDOMContent(content)
						.addTo(m);
				}
				function chooseConnection(pixel: MapCoordinate, position: MapCoordinate) {
					locationPopup?.remove();
					const location = m
						.queryRenderedFeatures(
							[
								[pixel[0] - 18, pixel[1] - 18],
								[pixel[0] + 18, pixel[1] + 18]
							],
							{
								layers: [
									'connection-handles',
									'investment-boards',
									'boarding-boards',
									'boarding-stops'
								]
							}
						)
						.find(
							(feature) =>
								feature.geometry.type === 'Point' &&
								feature.properties.mapKind === 'stop' &&
								!String(feature.properties.icon).startsWith('ferry')
						);
					const ids = stopIds(location?.properties);
					if (location && ids.length > 1) chooseDirection(location, ids, true);
					else if (ids.length === 1) onconnectionstopselect?.(ids[0]);
					else onconnectionplace?.(position);
				}
				function pointerDown(event: PointerEvent) {
					if (!editMode || placing || connectionMode || roadSelectionEnabled || !onstopcommit)
						return;
					if (pointerId !== null) {
						if (pointerId !== event.pointerId) endDrag(true);
						return;
					}
					if (!event.isPrimary || event.button !== 0) return;
					const pixel = pointerPixel(event);
					const exactHit = m.queryRenderedFeatures(pixel, {
						layers: [
							'dragged-stop-halo',
							'selected-stop-handle',
							'facility-boards',
							'investment-boards',
							'boarding-boards',
							'boarding-stops'
						]
					})[0];
					// A facility under the pointer remains a facility, even with a nearby stop.
					if (exactHit?.properties.mapKind === 'facility') return;
					if (exactHit?.properties.icon === 'ferry') return;
					const location = m
						.queryRenderedFeatures(
							[
								[pixel[0] - 8, pixel[1] - 8],
								[pixel[0] + 8, pixel[1] + 8]
							],
							{
								layers: [
									'dragged-stop-halo',
									'selected-stop-handle',
									'facility-boards',
									'investment-boards',
									'boarding-boards',
									'boarding-stops'
								]
							}
						)
						.find((feature) => feature.properties.mapKind === 'stop');
					if (!location || location.geometry.type !== 'Point') return;
					const ids = stopIds(location.properties);
					if (!ids.length) return;
					event.preventDefault();
					event.stopPropagation();
					const id = dragTarget(ids, selectedStopId);
					if (!id) {
						chooseDirection(location, ids);
						suppressClickUntil = performance.now() + 350;
						return;
					}
					locationPopup?.remove();
					// Pointer-down only arms the local gesture. Publishing selection here can
					// trigger parent draft cancellation/revision before the drag even starts.
					// A tap selects after release; movement publishes onstopdragstart instead.
					const position = location.geometry.coordinates.slice(0, 2) as MapCoordinate;
					originalPosition = [...position];
					session.begin(id, position, pixel);
					pointerId = event.pointerId;
					dragging = { id, name: String(location.properties.name), position, moved: false };
					// A held marker may already have a state sprite. Resolve its category and
					// built status from model data before a second drag starts.
					dragIcon = resolveStopDragIcon(symbols, id, location.properties);
					restorePan = m.dragPan.isEnabled();
					restoreTouchZoom = m.touchZoomRotate.isEnabled();
					m.dragPan.disable();
					m.touchZoomRotate.disable();
					canvas.setPointerCapture(event.pointerId);
					canvas.style.cursor = 'grabbing';
				}
				function pointerMove(event: PointerEvent) {
					if (pointerId !== event.pointerId || !dragging) return;
					event.preventDefault();
					event.stopPropagation();
					const pixel = pointerPixel(event);
					const point = m.unproject(pixel);
					const move = session.move([point.lng, point.lat], pixel);
					if (!move) return;
					if (!dragging.moved) {
						autoFit = false;
						onstopdragstart?.(move.id);
					}
					dragging = { ...dragging, position: move.position, moved: true };
					// This callback carries coordinates; parent analysis is deliberately debounced.
					onstoppreview?.(move.id, move.position);
				}
				function pointerUp(event: PointerEvent) {
					if (event.pointerId !== pointerId) return;
					pointerMove(event);
					event.preventDefault();
					event.stopPropagation();
					endDrag(false);
				}
				function pointerCancel(event: PointerEvent) {
					if (event.pointerId === pointerId) endDrag(true);
				}
				function escape(event: KeyboardEvent) {
					if (event.key === 'Escape' && pointerId !== null) {
						event.preventDefault();
						endDrag(true);
					}
				}
				function keyboardPlacement(event: KeyboardEvent) {
					if ((!placing && !connectionMode) || event.repeat) return;
					if (connectionMode && event.key === 'Escape') {
						event.preventDefault();
						event.stopPropagation();
						onconnectioncancel?.();
						return;
					}
					if (event.key !== 'Enter' && event.key !== ' ') return;
					event.preventDefault();
					event.stopPropagation();
					const point = m.unproject([canvas.clientWidth / 2, canvas.clientHeight / 2]);
					if (connectionMode)
						chooseConnection(
							[canvas.clientWidth / 2, canvas.clientHeight / 2],
							[point.lng, point.lat]
						);
					else onplace([point.lng, point.lat]);
				}
				function cancelPlacement(event: MouseEvent) {
					if (!placing && !connectionMode) return;
					event.preventDefault();
					if (connectionMode) onconnectioncancel?.();
					else oncancelplace?.();
				}
				canvas.addEventListener('pointerdown', pointerDown, { capture: true, passive: false });
				canvas.addEventListener('pointermove', pointerMove, { capture: true, passive: false });
				canvas.addEventListener('pointerup', pointerUp, { capture: true, passive: false });
				canvas.addEventListener('pointercancel', pointerCancel);
				canvas.addEventListener('lostpointercapture', pointerCancel);
				window.addEventListener('keydown', escape);
				canvas.addEventListener('keydown', keyboardPlacement, true);
				canvas.addEventListener('contextmenu', cancelPlacement);
				const blur = () => endDrag(true);
				window.addEventListener('blur', blur);
				removeEditingListeners = () => {
					endDrag(true);
					canvas.removeEventListener('pointerdown', pointerDown, true);
					canvas.removeEventListener('pointermove', pointerMove, true);
					canvas.removeEventListener('pointerup', pointerUp, true);
					canvas.removeEventListener('pointercancel', pointerCancel);
					canvas.removeEventListener('lostpointercapture', pointerCancel);
					window.removeEventListener('keydown', escape);
					canvas.removeEventListener('keydown', keyboardPlacement, true);
					canvas.removeEventListener('contextmenu', cancelPlacement);
					window.removeEventListener('blur', blur);
					for (const number of Object.values(connectionNumbers)) number.marker.remove();
				};
				for (const label of mapLabels) {
					const el = document.createElement('div');
					el.className = 'atlas-island-label';
					el.textContent = label.name;
					new lib.Marker({ element: el, anchor: 'center' }).setLngLat(label.point).addTo(m);
				}
				m.on('click', (event) => {
					if (pointerId !== null || performance.now() < suppressClickUntil) return;
					if (
						event.originalEvent.target instanceof Element &&
						event.originalEvent.target.closest('.maplibregl-popup')
					)
						return;
					if (roadSelectionEnabled) {
						const candidates = m.queryRenderedFeatures(
							[
								[event.point.x - 7, event.point.y - 7],
								[event.point.x + 7, event.point.y + 7]
							],
							{ layers: ['road-pick-target'] }
						);
						const road = candidates.find(
							(feature) => typeof feature.properties.edgeId === 'string'
						);
						if (road) onroadselect?.(String(road.properties.edgeId));
						return;
					}
					if (connectionMode) {
						chooseConnection([event.point.x, event.point.y], [event.lngLat.lng, event.lngLat.lat]);
						return;
					}
					if (placing) {
						onplace([event.lngLat.lng, event.lngLat.lat]);
						return;
					}
					const contextLocation = m.queryRenderedFeatures(event.point, {
						layers: ['transport-context-boards']
					})[0];
					if (contextLocation?.geometry.type === 'Point') {
						locationPopup?.remove();
						const content = document.createElement('div');
						content.className = 'atlas-location';
						const title = document.createElement('strong');
						title.textContent = String(contextLocation.properties.name);
						const description = document.createElement('p');
						description.textContent = String(contextLocation.properties.description);
						const link = document.createElement('a');
						link.href = String(contextLocation.properties.sourceUrl);
						link.textContent =
							contextLocation.properties.contextKind === 'vessel'
								? 'Source: FollowMe Tracking Service'
								: 'Source: MBS Statistical Yearbook';
						link.target = '_blank';
						link.rel = 'noopener noreferrer';
						content.append(title, description, link);
						if (oncontextselect) {
							const button = document.createElement('button');
							button.textContent = 'Explore Sea & air';
							button.onclick = () => {
								locationPopup?.remove();
								const kind =
									contextLocation.properties.contextKind === 'airport' ? 'airport' : 'vessel';
								oncontextselect?.(kind);
							};
							content.append(button);
						}
						locationPopup = new lib.Popup({ maxWidth: '300px', offset: 18, closeOnMove: true })
							.setLngLat(contextLocation.geometry.coordinates as [number, number])
							.setDOMContent(content)
							.addTo(m);
						return;
					}
					const location = m.queryRenderedFeatures(event.point, {
						layers: ['facility-boards', 'investment-boards', 'boarding-boards', 'boarding-stops']
					})[0];
					locationPopup?.remove();
					if (location?.geometry.type === 'Point') {
						if (location.properties.mapKind === 'stop' && location.properties.icon !== 'ferry') {
							const ids = stopIds(location.properties);
							const id = dragTarget(ids, selectedStopId);
							if (id) {
								onstopselect?.(id);
								return;
							} else if (ids.length > 1) {
								chooseDirection(location, ids);
								return;
							}
						}
						const content = document.createElement('div');
						content.className = 'atlas-location';
						const title = document.createElement('strong');
						title.textContent = String(location.properties.name);
						const status = document.createElement('span');
						status.className = 'atlas-asset-status';
						status.dataset.state = String(location.properties.investmentState ?? 'existing');
						status.textContent = String(location.properties.statusLabel ?? 'Existing destination');
						const description = document.createElement('p');
						description.textContent = String(location.properties.description);
						content.append(title, status, description);
						if (Number(location.properties.count) > 1) {
							const directions = document.createElement('p');
							directions.textContent = `${location.properties.count} directional boarding codes share this coordinate.`;
							content.append(directions);
						}
						locationPopup = new lib.Popup({ maxWidth: '280px', offset: 10 })
							.setLngLat(location.geometry.coordinates as [number, number])
							.setDOMContent(content)
							.addTo(m);
						return;
					}
					const hits = m.queryRenderedFeatures(event.point, {
						layers: ['service-routes']
					});
					const route = hits.find((feature) => feature.properties.mode === 'bus');
					if (route) {
						onrouteselect?.(String(route.properties.id));
						return;
					}
					const areaHits = m.queryRenderedFeatures(event.point, {
						layers: ['access-areas', 'people-areas']
					});
					const properties = areaHits[0]?.properties;
					if (typeof properties?.originId === 'string' && typeof properties?.id === 'string')
						onselect(properties.originId, properties.id);
					else onclear?.();
				});
				m.on('mousemove', (event) => {
					if (pointerId !== null) return;
					if (placing) {
						placementCursor = [event.lngLat.lng, event.lngLat.lat];
						onhoverplace?.(placementCursor);
						renderPlacement?.();
					}
					if (!placing) {
						const hits = m.queryRenderedFeatures(event.point, {
							layers: [
								'connection-handles',
								'selected-stop-handle',
								'transport-context-boards',
								'facility-boards',
								'investment-boards',
								'boarding-boards',
								'boarding-stops',
								view === 'people' ? 'people-areas' : 'access-areas'
							]
						});
						m.getCanvas().style.cursor = connectionMode
							? hits.some((feature) => feature.properties.mapKind === 'stop')
								? 'pointer'
								: 'crosshair'
							: editMode && hits.some((feature) => feature.properties.mapKind === 'stop')
								? 'grab'
								: hits.some((feature) => feature.properties.mapKind || feature.properties.originId)
									? 'pointer'
									: '';
					}
				});
				map = m;
				onready?.(async () => {
					// Printable briefs always capture the local, exportable atlas.
					removeBasemap(m);
					showAtlas(m, true);
					m.setLayoutProperty('transport-context-boards', 'visibility', 'none');
					m.setLayoutProperty('playback-halo', 'visibility', 'none');
					m.setLayoutProperty('playback-vehicles', 'visibility', 'none');
					m.stop();
					const camera = {
						center: m.getCenter(),
						zoom: m.getZoom(),
						pitch: m.getPitch(),
						bearing: m.getBearing(),
						padding: m.getPadding()
					};
					try {
						// A brief needs geographic context even when the editor is focused on one stop.
						const settled = m.once('idle');
						m.fitBounds(
							[
								[73.476, 4.165],
								[73.555, 4.245]
							],
							{ padding: 24, duration: 0, pitch: 0, bearing: 0 }
						);
						m.triggerRepaint();
						// The first frame can still contain tiles from the editor's previous zoom.
						await settled;
						return m.getCanvas().toDataURL('image/png');
					} finally {
						m.setLayoutProperty('transport-context-boards', 'visibility', 'visible');
						m.setLayoutProperty('playback-halo', 'visibility', 'visible');
						m.setLayoutProperty('playback-vehicles', 'visibility', 'visible');
						m.jumpTo(camera);
					}
				});
			});
			instance.on('error', (event) => {
				if (
					basemap !== 'atlas' ||
					('sourceId' in event && String(event.sourceId).startsWith(BASEMAP_PREFIX))
				) {
					onbasemaperror?.('The online map could not load. The local atlas is still available.');
					return;
				}
				failed = event.error.message;
			});
		}
		void init().catch((error: unknown) => {
			failed = String(error);
		});
		return () => {
			disposed = true;
			motionQuery.removeEventListener('change', updateWaveMotion);
			stopWave?.();
			stopWave = undefined;
			renderWave = undefined;
			mobileFocus?.cancel();
			resizeObserver.disconnect();
			cancelAnimationFrame(resizeFrame);
			removeEditingListeners?.();
			removeWaveListeners?.();
			cancelDrag = undefined;
			invalidateEditing = undefined;
			renderEditingSources = undefined;
			renderConnection = undefined;
			renderPlacement = undefined;
			map = null;
			instance?.remove();
		};
	});
	$effect(() => {
		const m = map;
		const mode = basemap;
		const override = satelliteStyle;
		if (!m) return;
		const controller = new AbortController();
		basemapLoading = true;
		void (
			mode === 'satellite' && override
				? Promise.resolve(override)
				: loadBasemap(mode, { signal: controller.signal })
		)
			.then((result) => {
				if (controller.signal.aborted) return;
				if (result.unavailableReason) {
					onbasemaperror?.(result.unavailableReason);
					return;
				}
				removeBasemap(m);
				if (result.glyphs) m.setGlyphs(result.glyphs);
				for (const [id, source] of Object.entries(result.sources)) m.addSource(id, source);
				for (const layer of result.layers) m.addLayer(layer, 'land-shadow');
				showAtlas(m, mode === 'atlas');
			})
			.catch((error: unknown) => {
				if (!controller.signal.aborted)
					onbasemaperror?.(
						String(error instanceof Error ? error.message : 'Online map unavailable.')
					);
			})
			.finally(() => {
				if (!controller.signal.aborted) basemapLoading = false;
			});
		return () => controller.abort();
	});
	$effect(() => {
		if (!map) return;
		map.getSource<GeoJSONSource>('transport-context')?.setData(contextSymbols);
	});
	$effect(() => {
		if (!map) return;
		map.getSource<GeoJSONSource>('road-conditions')?.setData(roadConditions);
		map
			.getSource<GeoJSONSource>('road-directions')
			?.setData(roadDirectionMarkers(roadConditions, selectedRoads));
		map.getSource<GeoJSONSource>('weather-advisories')?.setData(weatherAreas);
		map.getSource<GeoJSONSource>('service-playback')?.setData(playbackSymbols);
		if (map.getLayer('road-selection'))
			map.setFilter('road-selection', ['in', ['get', 'edgeId'], ['literal', selectedRoads]]);
		if (map.getLayer('road-pick-target'))
			map.setPaintProperty('road-pick-target', 'line-opacity', roadSelectionEnabled ? 0.12 : 0.01);
	});
	$effect(() => {
		const m = map;
		if (!m) return;
		if (policyLayerMap !== m) {
			policyLayerMap = m;
			policyLayerIds.clear();
		}
		const shown = new Set(policyLayers.map((layer) => layer.id));
		for (const [id, layerIds] of policyLayerIds) {
			if (!shown.has(id))
				for (const layerId of layerIds) m.setLayoutProperty(layerId, 'visibility', 'none');
		}
		for (const layer of policyLayers) {
			const sourceId = `policy-context-${layer.id}`;
			if (!m.getSource(sourceId)) m.addSource(sourceId, { type: 'geojson', data: layer.data });
			else m.getSource<GeoJSONSource>(sourceId)?.setData(layer.data);
			if (!policyLayerIds.has(layer.id)) {
				const layerId = `${sourceId}-${layer.kind}`;
				if (layer.kind === 'trees' || layer.kind === 'audits') {
					m.addLayer(
						{
							id: layerId,
							type: 'circle',
							source: sourceId,
							paint: {
								'circle-color': layer.kind === 'audits' ? '#b57b2a' : '#527b49',
								'circle-opacity': 0.65,
								'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 1.4, 17, 3.5],
								'circle-stroke-color': '#f7fff0',
								'circle-stroke-width': 0.6
							}
						},
						'access-areas'
					);
				} else if (layer.kind === 'pavements') {
					m.addLayer(
						{
							id: layerId,
							type: 'fill',
							source: sourceId,
							paint: {
								'fill-color': '#4899ba',
								'fill-opacity': 0.23,
								'fill-outline-color': '#347b9a'
							}
						},
						'access-areas'
					);
				} else {
					m.addLayer(
						{
							id: layerId,
							type: 'line',
							source: sourceId,
							paint: {
								'line-color': '#947e64',
								'line-opacity': 0.55,
								'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.35, 17, 1],
								'line-dasharray': [3, 2]
							}
						},
						'access-areas'
					);
				}
				policyLayerIds.set(layer.id, [layerId]);
			}
			for (const id of policyLayerIds.get(layer.id)!)
				m.setLayoutProperty(id, 'visibility', 'visible');
		}
	});
	$effect(() => {
		if (!map) return;
		if (!placing) placementCursor = null;
		void placementPoint;
		void placing;
		void placementIcon;
		renderPlacement?.();
	});
	$effect(() => {
		if (!map) return;
		for (const [id, data] of Object.entries({ land, streets, areas, routes, journey }))
			map.getSource<GeoJSONSource>(id)?.setData(data);
		map.getSource<GeoJSONSource>('analysis-grid-cells')?.setData(analysisGrid ?? areas);
		map.setFilter('selected-area', ['==', ['get', 'id'], selectedId]);
	});
	$effect(() => {
		if (!map) return;
		map.setPaintProperty(
			'access-areas',
			'fill-color',
			view === 'impact' ? impactColors : journeyColors
		);
		map.setPaintProperty('access-areas', 'fill-opacity', journeyOpacity);
		map.setLayoutProperty('access-areas', 'visibility', view === 'people' ? 'none' : 'visible');
		map.setPaintProperty('area-cell-edges', 'line-opacity', contextEdgeOpacity);
		map.setLayoutProperty('area-cell-edges', 'visibility', view === 'impact' ? 'visible' : 'none');
		map.setPaintProperty('journey-change-outlines', 'line-opacity', changeOpacity);
		map.setLayoutProperty(
			'journey-change-outlines',
			'visibility',
			view === 'people' ? 'none' : 'visible'
		);
		map.setPaintProperty('people-areas', 'fill-opacity', peopleOpacity);
		map.setLayoutProperty('people-areas', 'visibility', view === 'people' ? 'visible' : 'none');
		map.setLayoutProperty('analysis-grid', 'visibility', detailGrid ? 'visible' : 'none');
	});
	$effect(() => {
		const descriptor = wave;
		const currentMap = map;
		const staticMotion = reducedWaveMotion;
		if (currentMap && renderWave) {
			renderWave(descriptor, staticMotion);
			return;
		}
		if (!descriptor || descriptor.completedAt === null || finishedWaveId === descriptor.id) return;
		// Initial map loading or a unavailable WebGL context must not prevent a
		// completed worker result from being published. Superseding edits cancel this.
		const frame = waveFrame(descriptor, performance.now(), staticMotion);
		const timer = setTimeout(
			() => {
				finishedWaveId = descriptor.id;
				onwavefinish?.(descriptor.id, descriptor.outcome ?? 'success');
			},
			Math.max(0, (frame.finishAt ?? performance.now()) - performance.now())
		);
		return () => clearTimeout(timer);
	});
	$effect(() => {
		if (!map) return;
		void connectionMode;
		void connectionStopIds;
		void connectionPreview;
		void symbols;
		renderConnection?.();
	});
	$effect(() => {
		if (!map) return;
		if (heldMove) {
			const hold = heldMove;
			const reflected = symbols.features.some(
				(feature) =>
					stopIds(feature.properties).includes(hold.id) &&
					Math.abs(feature.geometry.coordinates[0] - hold.position[0]) < 0.0000001 &&
					Math.abs(feature.geometry.coordinates[1] - hold.position[1]) < 0.0000001
			);
			if (reflected) heldMove = null;
		}
		renderEditingSources?.();
		map.getCanvas().style.cursor = dragging
			? 'grabbing'
			: placing || connectionMode || roadSelectionEnabled
				? 'crosshair'
				: '';
	});
	$effect(() => {
		if (!editMode || placing || connectionMode) cancelDrag?.();
	});
	$effect(() => {
		const next = reconcileStopEditRevision(lastEditRevision, editRevision, heldMove, !!dragging);
		lastEditRevision = next.revision;
		if (!next.invalidated) return;
		// History can supersede a pending worker result before its drop position is reflected.
		// Release pointer capture and clear the local hold, even if no worker result arrives.
		invalidateEditing?.();
		heldMove = next.heldMove;
		if (next.cancelActive) dragging = null;
	});
	$effect(() => {
		if (!map) return;
		const canvas = map.getCanvas();
		canvas.setAttribute(
			'aria-label',
			connectionMode
				? 'Build a bus connection on the Greater Malé map'
				: placing
					? `${placementLabel} on the Greater Malé map`
					: editMode
						? 'Greater Malé map, stop editing enabled'
						: 'Interactive Greater Malé map'
		);
		if (placing || connectionMode) canvas.focus({ preventScroll: true });
	});
	$effect(() => {
		if (!map || container.clientWidth <= 0 || container.clientHeight <= 0) return;
		map.easeTo({
			pitch: perspective ? 32 : 0,
			bearing: 0,
			duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220
		});
	});
	$effect(() => {
		if (!focusCoordinate) {
			pendingFocusCoordinate = null;
			return;
		}
		autoFit = false;
		const focusMap = map;
		if (!focusMap || container.clientWidth <= 0 || container.clientHeight <= 0) {
			pendingFocusCoordinate = [...focusCoordinate];
			return;
		}
		pendingFocusCoordinate = null;
		// A new selection owns focus. Opening a sheet or returning from an
		// analytical page must not reset a map the user has subsequently panned.
		untrack(() => focusAt(focusMap, focusCoordinate!));
	});
	$effect(() => {
		if (!overviewRequest || !map) return;
		mobileFocus?.cancel();
		autoFit = true;
		pendingFocusCoordinate = null;
		if (container.clientWidth <= 0 || container.clientHeight <= 0) return;
		map.fitBounds(
			[
				[73.476, 4.165],
				[73.555, 4.245]
			],
			{
				duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 250,
				padding: untrack(overviewPadding)
			}
		);
	});
	$effect(() => {
		if (map && autoFit && container.clientWidth > 0 && container.clientHeight > 0) {
			map.fitBounds(
				[
					[73.476, 4.165],
					[73.555, 4.245]
				],
				{
					duration: 0,
					padding: overviewPadding()
				}
			);
		}
	});
	$effect(() => {
		const currentMap = map;
		const nextInset = mobileBottomInset;
		if (currentMap !== insetCameraMap) {
			insetCameraMap = currentMap;
			cameraBottomInset = nextInset;
			return;
		}
		const previousInset = cameraBottomInset;
		cameraBottomInset = nextInset;
		if (mobileFocus?.map === currentMap) {
			mobileFocus.nextInset = nextInset;
			return;
		}
		if (
			!currentMap ||
			autoFit ||
			container.clientWidth > 680 ||
			previousInset == null ||
			Math.abs(nextInset - previousInset) < 1
		)
			return;
		// Shift only by the space the drawer gained or released. Preserve the user's
		// zoom and panning rather than returning to the original selected coordinate.
		panMobileInset(currentMap, nextInset - previousInset);
	});
</script>

<div
	class="atlas-map"
	class:satellite={basemap === 'satellite'}
	class:sheet-expanded={mobileBottomInset > 200}
	style:--mobile-map-bottom={`${mobileBottomInset}px`}
	style:--map-top-control-height={`${controlsHeight}px`}
	bind:this={container}
	role="region"
	aria-label="Interactive Greater Malé policy atlas"
></div>
<p id={instructionsId} class="map-instructions">
	Use arrow keys to pan the map, and plus or minus to zoom.
	{#if onstopselect && onstopcommit}Use Add stop or Draw route in the bottom planning panel. To move
		an existing stop, select it and choose Move stop.{/if}
	{#if connectionMode}Choose bus stops in order. Tap an existing stop or a road to add a stop. For
		keyboard input, pan a stop or road under the center target, then press Enter or Space. Escape
		cancels the connection.
	{:else if placing}Pan until the center target is on a road, then press Enter or Space to place the
		stop.{:else if editMode}Drag a stop to move it. Co-located boarding directions require a choice
		first. Escape cancels an active drag.{/if}
</p>
{#if placing || connectionMode}<div
		class="placement-target"
		class:connecting={connectionMode}
		aria-hidden="true"
	></div>{/if}
{#if dragging?.moved}
	<div class="drag-hint" role="status">
		<span>Move stop · release to apply</span>
		<button type="button" onclick={() => cancelDrag?.()} aria-label="Cancel stop movement"
			>Cancel <span>Esc</span></button
		>
	</div>
{/if}
{#if failed}<div class="map-failure">Map unavailable: {failed}</div>{/if}
{#if basemapLoading && basemap !== 'atlas'}<div class="basemap-loading" role="status">
		Loading map…
	</div>{/if}

<style>
	.basemap-loading {
		position: absolute;
		bottom: 24px;
		left: 120px;
		padding: 7px 10px;
		font-size: 12px;
		color: #46666b;
		background: #ffffffed;
		border: 1px solid #d9e4df;
		border-radius: 8px;
	}
	.map-instructions {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.placement-target {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 20px;
		height: 20px;
		transform: translate(-50%, -50%);
		border: 2px solid #087e7e;
		border-radius: 50%;
		background: #ffffff80;
		box-shadow: 0 0 0 4px #ffffffb3;
		pointer-events: none;
	}
	.placement-target::after {
		content: '';
		position: absolute;
		left: 50%;
		top: 50%;
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: #087e7e;
		transform: translate(-50%, -50%);
	}
	.placement-target.connecting {
		border-color: #b86b14;
		background: #fff6df80;
	}
	.placement-target.connecting::after {
		background: #b86b14;
	}
	:global(.atlas-connection-order) {
		min-width: 26px;
		height: 28px;
		display: grid;
		place-items: center;
		padding-inline: 3px;
		color: #74410b;
		font-size: 15px;
		font-weight: 800;
		line-height: 1;
		pointer-events: none;
	}
	.drag-hint {
		position: absolute;
		left: 50%;
		bottom: 30px;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 9px 10px 9px 14px;
		border: 1px solid #c7dbd7;
		border-radius: var(--surface-radius);
		background: #ffffffee;
		color: #17444d;
		font-size: 12px;
		box-shadow: var(--surface-shadow);
		z-index: 3;
		width: max-content;
		max-width: calc(100% - 24px);
		flex-wrap: wrap;
	}
	.drag-hint button {
		border: 0;
		border-radius: var(--surface-radius-pill);
		padding: 7px 9px;
		background: #edf5f3;
		color: #17444d;
		font: inherit;
		cursor: pointer;
	}
	.drag-hint button span {
		opacity: 0.55;
		margin-left: 5px;
	}
	:global(.atlas-direction-choice) {
		display: block;
		width: 100%;
		margin-top: 8px;
		padding: 9px 10px;
		border: 1px solid #d7e4df;
		border-radius: var(--surface-radius-pill);
		background: #f3f8f6;
		color: #17444d;
		text-align: left;
		font: inherit;
		font-size: 12px;
		cursor: pointer;
	}
	:global(.atlas-location strong) {
		display: block;
		font-size: 14px;
		color: #173b47;
	}
	:global(.atlas-asset-status) {
		display: inline-flex;
		margin-top: 7px;
		padding: 3px 7px;
		border-radius: 5px;
		background: #e9f5f3;
		color: #166c72;
		font-size: 11px;
		font-weight: 650;
	}
	:global(.atlas-asset-status[data-state='proposed']),
	:global(.atlas-asset-status[data-state='draft']) {
		background: #fff1d5;
		color: #965108;
	}
	:global(.atlas-asset-status[data-state='moved']) {
		background: #f0eafa;
		color: #6950a5;
	}
	:global(.atlas-asset-status[data-state='paused']) {
		background: #edf0f1;
		color: #5d6e76;
	}
	:global(.maplibregl-popup) {
		z-index: 3;
		max-width: min(300px, calc(100vw - 24px)) !important;
	}
	:global(.maplibregl-popup-close-button) {
		width: 28px;
		height: 28px;
		border-radius: var(--surface-radius-pill);
		color: #536c74;
		font-size: 20px;
	}
	:global(.maplibregl-popup-content) {
		padding: 18px 38px 18px 18px;
		border-radius: var(--surface-radius-mobile);
		box-shadow: var(--surface-shadow-raised);
		max-height: calc(100dvh - 80px);
		overflow-y: auto;
		overflow-wrap: anywhere;
	}
	:global(.atlas-location p) {
		margin: 6px 0 0;
		font-size: 12px;
		line-height: 1.5;
		color: #536c74;
	}
	.atlas-map {
		position: absolute;
		inset: 0;
		background: #dceef0;
	}
	.atlas-map :global(canvas:focus-visible) {
		outline: 3px solid #087e7e;
		outline-offset: -3px;
	}
	.map-failure {
		position: absolute;
		bottom: 40px;
		left: 20px;
		background: #fff;
		border-radius: 8px;
		padding: 8px 12px;
		font-size: 13px;
		color: #8b4032;
		max-width: 70%;
	}
	:global(.atlas-island-label) {
		color: #426776;
		font-size: 12px;
		font-weight: 750;
		letter-spacing: 0.14em;
		text-shadow:
			0 1px 5px #fff,
			0 0 4px #fff;
		pointer-events: none;
	}
	.atlas-map.satellite :global(.atlas-island-label) {
		color: #fff;
		text-shadow:
			0 1px 3px #14323f,
			0 0 8px #14323f;
	}
	:global(.maplibregl-ctrl-group) {
		border-radius: var(--surface-radius-pill);
		box-shadow: var(--surface-shadow);
		overflow: hidden;
	}
	:global(.maplibregl-ctrl-scale) {
		background: #ffffffe0;
		border-color: #567b83;
		color: #234e5a;
		border-radius: 3px;
	}
	:global(.maplibregl-ctrl-attrib) {
		font-size: 10px;
		background-color: #fffffff0;
	}
	.atlas-map :global(.maplibregl-ctrl-bottom-left) {
		max-width: 100%;
	}
	@media (max-width: 680px), (pointer: coarse) {
		:global(.maplibregl-ctrl-group button),
		:global(.maplibregl-popup-close-button) {
			width: 44px;
			height: 44px;
		}
		:global(.maplibregl-popup-content) {
			padding-right: 48px;
		}
		:global(.atlas-direction-choice),
		.drag-hint button {
			min-height: 44px;
		}
		:global(.maplibregl-ctrl-attrib) {
			line-height: 1.5;
		}
	}
	@media (max-width: 680px) {
		.atlas-map :global(.maplibregl-ctrl-bottom-right) {
			bottom: calc(var(--mobile-map-bottom, 76px) + 10px);
		}
		.atlas-map.sheet-expanded :global(.maplibregl-ctrl-bottom-right) {
			display: none;
		}
		.atlas-map :global(.maplibregl-ctrl-bottom-left) {
			top: calc(var(--map-top-control-height, 44px) + 20px);
			bottom: auto;
			max-width: calc(100% - 20px);
		}
		.atlas-map :global(.maplibregl-ctrl-scale) {
			display: none;
		}
	}
	@media (min-width: 480px) and (max-width: 680px) and (max-height: 500px) {
		.atlas-map :global(.maplibregl-ctrl-bottom-left) {
			max-width: calc(50% - 16px);
		}
	}
</style>
