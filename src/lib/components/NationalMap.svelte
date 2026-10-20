<script lang="ts">
	import { PUBLIC_BASE_PATH } from '$app/env/public';
	import { themeColors } from '#lib/theme.js';
	import { onMount, tick, untrack } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { slide } from 'svelte/transition';
	import type { Feature, FeatureCollection, Geometry } from 'geojson';
	import type {
		GeoJSONSource,
		Map as LibreMap,
		Marker,
		MapMouseEvent,
		MapGeoJSONFeature,
		Popup
	} from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
	import { Button } from '#lib/components/ui/button/index.js';
	import {
		Layers,
		SlidersHorizontal,
		Globe2,
		LocateFixed,
		MapPin,
		Hospital,
		BusFront,
		Signpost,
		Radio,
		Eye,
		Check,
		ChevronDown,
		X,
		MousePointer2,
		Crosshair,
		Map as MapIcon,
		GraduationCap,
		Plane,
		Ship,
		Anchor,
		Info,
		Move,
		Copy,
		Trash2
	} from '@lucide/svelte';
	import { atlasSymbols, atlasClusterSymbol, atlasVesselClusterSymbol } from './map/symbols.js';
	import { validPoint as validCoordinates } from '#lib/planning-map.js';
	import { impactColors, type PlanningOperation } from '#lib/planning-map.js';
	import { accessColors, comparisonCellProperties } from '#lib/display-grid.js';
	import { pointWithinIsland } from '#lib/map-policy.js';
	import { nearestPlacementRoad, placementLocationHint } from '#lib/map-placement-preview.js';
	import { changedImpactCells } from '#lib/map-impact-feedback.js';
	import { routeEndpointsMatch } from '#lib/map-location.js';
	import {
		canReuseStreetBounds,
		streetContextBounds,
		type StreetBounds
	} from '#lib/map-street-context.js';
	import { mobileServiceRoutePadding, serviceCardMaxHeight } from '#lib/map-service-layout.js';
	import { shouldAnimateMotion } from '#lib/motion.js';
	import { surfaceMotion } from '#lib/surface-motion.js';
	import type { MapPolicyState, PendingPlacementDecision, PlacementKind } from '#lib/map-policy.js';
	import { api } from '#lib/api.js';
	import type { PolicyLens } from '#lib/policy-opportunities.js';
	import {
		DEFAULT_OVERLAY_OPACITY,
		GAP_GRADIENT,
		GAP_PALETTE,
		OVERLAY_OPACITY_KEY,
		backgroundAccessGaps,
		overlayOpacityPreference
	} from '#lib/map-overlay.js';
	import { exploreJourneyFeatures, journeyClock } from '#lib/explore-journey.js';
	import {
		searchDirectionsFeatures,
		type SearchDirectionPoint,
		type SearchDirectionsResult
	} from '#lib/search-directions.js';
	import type {
		Accessibility,
		Coordinates,
		MapFeatures,
		ScenarioOperation,
		LandRoute,
		LiveEvent,
		LiveProvider
	} from '../types';

	import {
		seaClock,
		seaDuration,
		seaPressureColors,
		seaRouteEvidenceLabel,
		type SeaMapState,
		type SeaMapSelection
	} from '#lib/sea-connectivity.js';
	import { seaIslandFeatures } from '#lib/sea-map.js';
	import { airNetworkFeatures, type AirNetwork } from '#lib/air-connectivity.js';
	import { airRouteCard } from './map/air-route-card.js';
	import {
		preparePresentationPaths,
		presentationCameraPadding,
		presentationPathBounds,
		presentationRouteFeatures,
		presentationPosition,
		presentationVehicleFeatures,
		type PresentationMapScene,
		type PresentationProgress
	} from '#lib/presentation-map.js';
	import {
		prepareRouteVehicles,
		routeVehicleFeatures,
		type RouteVehiclePath
	} from '#lib/route-vehicles.js';
	interface SearchSelection {
		id: string;
		name: string;
		coordinates: Coordinates;
		category?: string;
		feature?: Feature;
	}
	type DirectionWaypoint = SearchDirectionPoint & {
		coordinates: Coordinates;
		index: number;
		letter: string;
		role: 'start' | 'via' | 'end';
	};
	interface Props {
		presentation?: PresentationMapScene | null;
		onPresentationProgress?: (state: PresentationProgress) => void;
		airState?: AirNetwork | null;
		airLayerEnabled?: boolean;
		airNetworkStatus?: 'loading' | 'ready' | 'error';
		onAirRetry?: () => void;
		onAirLayerChange?: (enabled: boolean) => void;
		seaState?: SeaMapState | null;
		seaView?: boolean;
		seaLayerEnabled?: boolean;
		seaInspectorOpen?: boolean;
		seaNetworkStatus?: 'loading' | 'ready' | 'error';
		onSeaRetry?: () => void;
		onSeaLayerChange?: (enabled: boolean) => void;
		onSeaSelect?: (selection: Omit<SeaMapSelection, 'key'>) => void;
		features: MapFeatures | null;
		selectedId: string | null;
		atollScope?: string | null;
		scopeBounds?: [Coordinates, Coordinates] | null;
		focusBounds?: { id: number; bounds: [Coordinates, Coordinates] } | null;
		islandPicking?: boolean;
		accessibilityScores?: Accessibility[] | null;
		onselect: (id: string) => void;
		onnational?: () => void;
		onfocusisland?: () => void;
		onpick: (coordinates: Coordinates) => void;
		onplanpoint?: (coordinates: Coordinates) => void;
		onmovejourneypoint?: (endpoint: 'start' | 'end') => void;
		onclearjourneypoint?: (endpoint: 'start' | 'end') => void;
		onroutepoint?: (
			coordinates: Coordinates,
			endpoint: 'start' | 'end',
			name?: string,
			focus?: boolean
		) => void;
		transitStops?: {
			id: string;
			name: string;
			coordinates: Coordinates;
			island_id?: string | null;
			national_island_id?: string | null;
			route_ids?: string[];
			route_names?: string[];
			timetable_status?: string;
		}[];
		picking: boolean;
		draft: ScenarioOperation[];
		route: LandRoute | null;
		routeStart?: Coordinates | null;
		routeEnd?: Coordinates | null;
		directions?: SearchDirectionsResult | null;
		directionPoints?: SearchDirectionPoint[];
		liveEvents: LiveEvent[];
		liveStatus?: {
			loading?: boolean;
			retrieved_at?: string | null;
			message?: string;
			providers?: LiveProvider[];
		};
		focusVersion?: number;
		journeyFocusVersion?: number;
		mode?: 'explore' | 'proposal';
		active?: boolean;
		gapFeatures?: FeatureCollection;
		coverageFillFeatures?: FeatureCollection;
		impactFeatures?: FeatureCollection;
		policyComparisonView?: 'current' | 'proposal';
		comparisonPreview?: boolean;
		policyEvaluationId?: string | null;
		policyComparisonPending?: boolean;
		gapLens?: PolicyLens;
		policyOperations?: PlanningOperation[];
		pendingProposal?: { coordinates: Coordinates; kind: PlacementKind } | null;
		pendingPlacementDecision?: PendingPlacementDecision | null;
		placementKind?: PlacementKind | null;
		placementRoads?: { geometry?: number[][] }[];
		onconfirmproposal?: () => void;
		oncancelproposal?: () => void;
		onadjustbudget?: () => void;
		onmoveproposal?: (index: number, coordinates: Coordinates) => void;
		onfocusproposal?: (index: number) => void;
		oneditproposal?: (index: number, action: 'move' | 'duplicate' | 'remove') => void;
		ondropplacement?: (coordinates: Coordinates, kind: PlacementKind) => void;
		oninspectgap?: (properties: Record<string, unknown>) => void;
		policyCalculating?: boolean;
		policyStale?: boolean;
		focusPoint?: { id: number; coordinates: Coordinates } | null;
		searchSelection?: SearchSelection | null;
		conditionRoute?: Coordinates[];
		policyServiceFeatures?: FeatureCollection;
		serviceEditor?: MapPolicyState['serviceEditor'];
		serviceEditorContent?: MapPolicyState['serviceEditorContent'];
		mapControlsContent?: MapPolicyState['mapControlsContent'];
		onserviceplace?: (placement: { kind: 'bus' | 'ferry'; coordinates: Coordinates }) => void;
		onservicelanding?: (landing: {
			terminalId: string;
			islandId?: string;
			coordinates: Coordinates;
		}) => void;
		onservicecandidate?: (stopId: string) => void;
		oncancelservice?: () => void;
	}

	let {
		presentation = null,
		onPresentationProgress,
		airState = null,
		airLayerEnabled = false,
		airNetworkStatus = 'ready',
		onAirRetry,
		onAirLayerChange,
		seaState = null,
		seaView = false,
		seaLayerEnabled = false,
		seaInspectorOpen = false,
		seaNetworkStatus = 'ready',
		onSeaRetry,
		onSeaLayerChange,
		onSeaSelect,
		features,
		selectedId,
		atollScope = null,
		scopeBounds = null,
		focusBounds = null,
		islandPicking = false,
		accessibilityScores = null,
		onselect,
		onnational,
		onfocusisland,
		onpick,
		onplanpoint,
		onmovejourneypoint,
		onclearjourneypoint,
		onroutepoint,
		transitStops = [],
		picking,
		draft,
		route,
		routeStart = null,
		routeEnd = null,
		directions = null,
		directionPoints,
		liveEvents,
		liveStatus = {},
		focusVersion = 0,
		journeyFocusVersion = 0,
		mode = 'explore',
		active = true,
		gapFeatures = { type: 'FeatureCollection', features: [] },
		coverageFillFeatures = { type: 'FeatureCollection', features: [] },
		impactFeatures = { type: 'FeatureCollection', features: [] },
		policyComparisonView = 'proposal',
		comparisonPreview = false,
		policyEvaluationId = null,
		policyComparisonPending = false,
		gapLens = 'overall',
		policyOperations = [],
		pendingProposal = null,
		pendingPlacementDecision = null,
		placementKind = null,
		placementRoads = [],
		onconfirmproposal,
		oncancelproposal,
		onadjustbudget,
		onmoveproposal,
		onfocusproposal,
		oneditproposal,
		ondropplacement,
		oninspectgap,
		policyCalculating = false,
		policyStale = false,
		focusPoint = null,
		searchSelection = null,
		conditionRoute = [],
		policyServiceFeatures = { type: 'FeatureCollection', features: [] },
		serviceEditor = null,
		serviceEditorContent,
		mapControlsContent,
		onserviceplace,
		onservicelanding,
		onservicecandidate,
		oncancelservice
	}: Props = $props();
	const inlineDirectionsActive = $derived(directions !== null || directionPoints !== undefined);
	let container: HTMLDivElement;
	let map = $state.raw<LibreMap | null>(null);
	const policyMarkers = new SvelteMap<number, Marker>();
	let placementAnchor = $state<{
		x: number;
		y: number;
		below: boolean;
		arrow: number;
		width: number;
		maxHeight: number;
	} | null>(null);
	let placementDragging = $state(false);
	let placementCard = $state.raw<HTMLElement | null>(null);
	let placementPositionFrame = 0;
	let placementPreviewFrame = 0;
	let previewPointer: { x: number; y: number } | null = null;
	let placementPreview = $state<{
		x: number;
		y: number;
		radius: number;
		coordinates: Coordinates;
		snapped: boolean;
		distance: number | null;
		suitable: boolean | null;
	} | null>(null);
	const placementAdvice = $derived(
		placementPreview
			? placementLocationHint({
					kind: pendingProposal?.kind ?? placementKind ?? '',
					suitable: placementPreview.suitable,
					snapped: placementPreview.snapped,
					distance: placementPreview.distance,
					hasRoads: placementRoads.length > 0
				})
			: null
	);
	let selectedProposalIndex = $state<number | null>(null);
	let proposalEditAnchor = $state<{ x: number; y: number; below: boolean; arrow: number } | null>(
		null
	);
	let proposalEditCard = $state.raw<HTMLElement | null>(null);
	let serviceAnchor = $state<{
		x: number;
		y: number;
		below: boolean;
		arrow: number;
		width: number;
		maxHeight: number;
		side: 'left' | 'right' | null;
		arrowY: number;
	} | null>(null);
	let serviceCard = $state.raw<HTMLElement | null>(null);
	let serviceMarker: Marker | null = null;
	let lastServiceEditorId: string | null = null;
	const selectedProposal = $derived(
		selectedProposalIndex === null ? null : policyOperations[selectedProposalIndex]
	);
	const selectedProposalLocked = $derived(
		!!selectedProposal?.metadata?.ui_preview || !!selectedProposal?.metadata?.ui_package
	);
	const editingMap = $derived(
		!!pendingProposal || !!placementKind || !!serviceEditor || selectedProposalIndex !== null
	);
	const focusContext = $derived(
		editingMap
			? serviceEditor?.mode === 'ferry' || !!selectedProposal?.metadata?.ui_ferry_summary
				? 'ferry'
				: (pendingProposal?.kind ?? placementKind ?? selectedProposal?.type) === 'add_hospital'
					? 'health'
					: (pendingProposal?.kind ?? placementKind ?? selectedProposal?.type) === 'add_school'
						? 'education'
						: 'bus'
			: inlineDirectionsActive
				? directionPoints?.some((point) => validCoordinates(point.coordinates)) ||
					(directions?.points.length ?? 0) > 0
					? 'journey'
					: ''
				: route
					? 'journey'
					: ''
	);
	const placementRoadHints = $derived.by((): FeatureCollection => ({
		type: 'FeatureCollection',
		features:
			focusContext === 'bus' && editingMap
				? placementRoads.flatMap((edge) => {
						const coordinates = edge.geometry;
						return coordinates && coordinates.length > 1 && coordinates.every(validCoordinates)
							? [
									{
										type: 'Feature' as const,
										properties: {},
										geometry: { type: 'LineString' as const, coordinates }
									}
								]
							: [];
					})
				: []
	}));
	let pendingPlacementFocused = false;
	let acceptedPositions: { index: number; coordinates: Coordinates }[] | null = null;
	const placementTitle = $derived(
		pendingPlacementDecision?.label ??
			(pendingProposal?.kind === 'add_hospital'
				? 'New hospital'
				: pendingProposal?.kind === 'add_school'
					? 'New school'
					: 'New bus stop')
	);
	const placementAllowed = $derived(
		!!pendingPlacementDecision?.allowed && !pendingPlacementDecision?.checking
	);
	const placementMoney = (value: number | null | undefined) =>
		value === null || value === undefined || !Number.isFinite(value)
			? 'Checking…'
			: `MVR ${new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(value)}`;
	let ready = $state(false);
	let islandsDataReady = $state(false);
	let islandsDataVersion = 0;
	let cancelIslandReadiness: (() => void) | undefined;
	let error = $state('');
	let facilitiesVisible = $state(true);
	let transportVisible = $state(true);
	let liveVisible = $state(true);
	let nationalScale = $state(true);
	let hoverDescription = $state('');
	let hoveredAirAirport = $state('');
	let controlsPanel = $state<'layers' | 'view' | null>(null);
	let overlayOpacity = $state(DEFAULT_OVERLAY_OPACITY);
	let overlayPreferenceLoaded = $state(false);
	const mapKeyId = $props.id();
	const overlayControlId = `${mapKeyId}-overlay-opacity`;
	const backgroundGaps = $derived(backgroundAccessGaps(gapFeatures, impactFeatures));
	const backgroundCells = $derived.by(() => {
		const cells: Record<string, number> = {};
		for (const feature of backgroundGaps.features) {
			const id = String(feature.properties?.island_id ?? '');
			if (id) cells[id] = (cells[id] ?? 0) + 1;
		}
		return cells;
	});
	const gapOpacity = $derived(
		!seaInspectorOpen && backgroundGaps.features.length ? overlayOpacity / 100 : 0
	);
	const impactOpacity = $derived(
		!seaInspectorOpen && impactFeatures.features.length ? overlayOpacity / 100 : 0
	);
	const currentAccessOpacity = $derived(
		impactFeatures.features[0]?.properties?.view === 'comparison' &&
			policyComparisonView === 'current'
			? impactOpacity
			: 0
	);
	const policyOverlayView = $derived(
		impactFeatures.features[0]?.properties?.view === 'comparison'
			? policyComparisonView === 'current'
				? 'before'
				: 'after'
			: (impactFeatures.features[0]?.properties?.view ?? 'improvement')
	);
	let impactSourceUpdates = $state(0);
	let feedbackCellCount = $state(0);
	let lastImpactEvaluationId: string | null = null;
	let lastFeedbackIsland: string | null = null;
	let lastFeedbackLens: PolicyLens | null = null;
	let previousEvaluatedImpact: FeatureCollection | null = null;
	let suppressedScopeOperations: string | null = null;
	let feedbackGeneration = 0;
	let feedbackFrame = 0;
	let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
	let removeFeedbackListener: (() => void) | undefined;
	const comparisonDiagnostics = $derived.by(() => {
		let changed = 0;
		let beforeBeyond = 0;
		let afterWithin = 0;
		for (const { properties } of impactFeatures.features) {
			if (properties?.view !== 'comparison') continue;
			if (properties.before_access !== properties.after_access) changed++;
			if (properties.before_access === 'beyond_target') beforeBeyond++;
			if (properties.after_access === 'within_target') afterWithin++;
		}
		return { changed, beforeBeyond, afterWithin };
	});
	const policyOverlayLegend = $derived(
		policyOverlayView === 'before' || policyOverlayView === 'after'
			? [
					{ label: 'No route', color: accessColors.unavailable },
					{ label: 'Unknown', color: accessColors.unknown }
				]
			: [
					{ label: 'Gained / faster', color: impactColors.gained },
					{ label: 'Lost / slower', color: impactColors.lost },
					{ label: 'Unchanged', color: impactColors.unchanged },
					{ label: 'No route', color: impactColors.unavailable },
					{ label: 'Unknown', color: impactColors.uncomputed }
				]
	);
	const hasPolicyOverlay = $derived(
		gapFeatures.features.length > 0 ||
			impactFeatures.features.length > 0 ||
			coverageFillFeatures.features.length > 0
	);
	const coverageFillOpacity = $derived(
		!seaInspectorOpen && coverageFillFeatures.features.length ? overlayOpacity / 100 : 0
	);
	const localAccessDiagnostics = $derived.by(() => {
		const cells: Record<string, number> = {};
		const ranges: Record<string, { min: number | null; max: number | null }> = {};
		const screening = new SvelteSet<string>();
		for (const feature of gapFeatures.features) {
			const properties = feature.properties;
			const id = String(properties?.island_id ?? '');
			if (!id) continue;
			if (!properties?.origin_id) {
				screening.add(id);
				continue;
			}
			cells[id] = (cells[id] ?? 0) + 1;
			const range = (ranges[id] ??= { min: null, max: null });
			const gap = properties.overall_gap;
			if (typeof gap === 'number' && Number.isFinite(gap)) {
				range.min = range.min === null ? gap : Math.min(range.min, gap);
				range.max = range.max === null ? gap : Math.max(range.max, gap);
			}
		}
		return { cells, ranges, screening: [...screening] };
	});
	const policyHitLayers = $derived(
		impactFeatures.features.length
			? ['policy-current-fill', 'policy-impact-fill', 'policy-gaps-fill', 'policy-gaps-points']
			: ['policy-gaps-fill', 'policy-gaps-points']
	);
	let labelsVisible = $state(true);
	let legendVisible = $state(true);
	let mobileLegendOpen = $state(false);
	let centerCoordinates = $state<Coordinates>([73.2, 3.5]);
	let cameraPadding = $state({ top: 0, right: 0, bottom: 0, left: 0 });
	let zoomLevel = $state(4);
	let streetsVisible = $state(true);
	let buildingsVisible = $state(true);
	let contextLoading = $state(false);
	let contextError = $state('');
	let contextData = $state.raw<FeatureCollection>({ type: 'FeatureCollection', features: [] });
	let renderedRoads = $state(0);
	let renderedBuildings = $state(0);
	let renderedMovement = $state(0);
	let renderedBusVehicles = $state(0);
	let renderedMovementObservations = $state(0);
	let renderedVesselGroups = $state(0);
	let renderedPoiIcons = $state(0);
	let renderedClusters = $state(0);
	const diagnosticsDirty = { context: true, movement: true, places: true };
	function invalidateMapDiagnostics() {
		diagnosticsDirty.context = true;
		diagnosticsDirty.movement = true;
		diagnosticsDirty.places = true;
	}
	let contextSummary = $state({ roads: 0, buildings: 0, truncated: false });
	let contextRequest: AbortController | null = null;
	let contextGeneration = 0;
	let contextLoadedKey = $state('');
	let contextLoadedBounds: StreetBounds | null = null;
	let contextLoadedError = '';
	let contextPendingKey = '';
	let contextTimer: ReturnType<typeof setTimeout> | undefined;
	const streetLabels: Record<string, Marker> = {};
	const stopLabels: Record<string, Marker> = {};
	const vesselClusterButtons: Record<string, Marker> = {};
	let mapHeight = $state(520);
	let controls = $state.raw<HTMLDivElement | null>(null);
	let layersButton = $state<HTMLElement | null>(null);
	let viewButton = $state<HTMLElement | null>(null);
	const islandLabels: Record<string, Marker> = {};
	let selectedMarker: Marker | null = null;
	let searchMarker: Marker | null = null;
	let searchPopup: Popup | null = null;
	let displayedSearchPlace = $state('');
	const journeyMarkers: Partial<Record<'start' | 'end', Marker>> = {};
	const directionMarkers: Record<string, Marker> = {};
	let inspectionPopup: Popup | null = null;
	let inspectedSeaRouteId = $state('');
	let inspectedAirRouteId = $state('');
	let inspectedAirNetwork: AirNetwork | null = null;
	let inspectedSeaFeatures: FeatureCollection | null = null;
	let inspectedPresentationSignature = '';
	let inspectedSource: string | null = null;
	let inspectedIslandId: string | null = null;
	let makeMarker: typeof import('maplibre-gl').Marker | undefined;
	let makePopup: typeof import('maplibre-gl').Popup | undefined;
	let pickerFocused = false;
	let pickerTrigger: HTMLElement | null = null;
	let liveFrame = 0;
	let activationFrame = 0;
	let scopeFocusFrame = 0;
	let journeyFocusFrame = 0;
	let presentationProgress = $state(0);
	let presentationAnimating = $state(false);
	let presentationFollowing = $state(false);
	let presentationPhase = $state<PresentationProgress['phase']>('idle');
	let presentationAirplaneReady = $state(false);
	const presentationPathEnd = $derived(presentation?.paths.at(-1)?.coordinates.at(-1));
	const presentationMinLatitude = $derived.by(() => {
		const points = presentation?.paths.flatMap((path) => path.coordinates) ?? [];
		return points.length ? Math.min(...points.map((point) => point[1])) : undefined;
	});
	const presentationPointsInMale = $derived(
		presentation?.paths.reduce(
			(count, path) =>
				count +
				path.coordinates.filter(([longitude, latitude]) => longitude < 73.5265 && latitude < 4.178)
					.length,
			0
		) ?? 0
	);
	const presentationMotionKey = $derived.by(() => {
		const scene = presentation;
		if (!scene) return '';
		const hasPath = scene.paths.some((path) => path.coordinates.length > 1);
		const readiness = scene.playback ? (hasPath ? 'ready' : 'waiting') : 'static';
		return `${scene.key}:${readiness}:${scene.inspect?.routeId ?? ''}:${scene.panel ?? ''}`;
	});
	const presentationProposalKey = $derived(
		presentation?.emphasis?.proposalPoint
			? `${presentation.key}:${presentation.emphasis.proposalPoint.join(',')}`
			: ''
	);
	const sourceData = new SvelteMap<string, FeatureCollection>();
	let lastFocusedIsland: Feature<Geometry> | undefined;
	let lastFocusedId: string | null | undefined;
	let lastFocusedAtoll: string | null | undefined;
	let lastFocusedAtollBounds: [Coordinates, Coordinates] | null = null;
	let lastFocusedScopeBounds: [Coordinates, Coordinates] | null = null;
	let lastFocusVersion = -1;
	let contextualIsland: string | null = null;
	let userZoomGesture: { point: [number, number] | null; startZoom: number } | null = null;
	let lastFittedRoute: LandRoute | null = null;
	let lastFittedDirections: SearchDirectionsResult | null = null;
	let lastJourneyFocusVersion = 0;
	let liveAnimating = $state(false);
	let routeVehiclesAnimating = $state(false);
	let displayedLive = { type: 'FeatureCollection', features: [] } as FeatureCollection;
	const nationalBounds: [Coordinates, Coordinates] = [
		[72, -0.9],
		[74.4, 7.3]
	];
	const interactiveLayers = [
		'air-route-line',
		'air-airport-points',
		'air-airport-symbols',
		'route-vehicle-symbols',
		'sea-route-line',
		'sea-route-unverified',
		'sea-island-points',
		'sea-port-points',
		'sea-island-fill',
		'facilities-symbols',
		'transport-symbols',
		'bus-stop-symbols',
		'journey-stop-symbols',
		'route-line',
		'route-walk-line',
		'live-vessel-clusters',
		'live-vessel-symbols',
		'poi-clusters',
		'island-centroids',
		'accessibility-centroids',
		'islands-fill',
		'facilities-fill',
		'transport-fill',
		'transport-lines'
	];
	const emptyCollection: FeatureCollection = {
		type: 'FeatureCollection',
		features: []
	};
	const airFeatures = $derived(airState ? airNetworkFeatures(airState) : emptyCollection);
	const seaVehicleFeatures = $derived(seaState?.features);
	const seaVehicleRoutes = $derived(seaState?.routes);
	const seaVehicleDate = $derived(seaState?.serviceDate);
	const vehiclePaths = $derived.by(() => {
		const paths: RouteVehiclePath[] = [];
		// A highlighted leg owns the moving symbol during the presentation.
		if (presentation?.paths.length) return paths;
		const seaRoutes = new Map((seaVehicleRoutes ?? []).map((route) => [route.id, route]));
		for (const [mode, network] of [
			['sea', seaVehicleFeatures],
			['air', airFeatures]
		] as const)
			for (const feature of network?.features ?? []) {
				if (feature.geometry.type !== 'LineString' || !feature.properties?.route_id) continue;
				const schedule = mode === 'sea' ? seaRoutes.get(String(feature.properties.route_id)) : null;
				paths.push({
					id: String(feature.properties.leg_id ?? feature.properties.route_id),
					routeId: String(feature.properties.route_id),
					name: String(feature.properties.name ?? feature.properties.route_name ?? 'Route'),
					mode,
					bidirectional: feature.properties.bidirectional === true,
					geometry: feature.geometry,
					...(seaVehicleDate && schedule?.scheduled_sailings?.length
						? {
								schedule: {
									serviceDate: seaVehicleDate,
									sailings: schedule.scheduled_sailings
								}
							}
						: {})
				});
			}
		return paths;
	});
	const preparedVehicles = $derived(prepareRouteVehicles(vehiclePaths));
	function routeLineWidth(
		selected: import('maplibre-gl').ExpressionSpecification,
		normal: number,
		focused: number
	): import('maplibre-gl').ExpressionSpecification {
		return [
			'interpolate',
			['linear'],
			['zoom'],
			5,
			['case', selected, focused * 0.85, normal * 0.8],
			9,
			['case', selected, focused, normal],
			14,
			['case', selected, focused, normal * 0.85]
		];
	}
	const serviceHitLayers = [
		'policy-service-line',
		'policy-service-bus-line',
		'policy-ferry-landing-zones',
		'policy-service-terminal-halo',
		'policy-service-terminal-symbol'
	];
	const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	function cameraInsets(instance: LibreMap) {
		const padding = instance.getPadding();
		return {
			top: padding.top ?? 0,
			right: padding.right ?? 0,
			bottom: padding.bottom ?? 0,
			left: padding.left ?? 0
		};
	}

	function zoomGesturePoint(instance: LibreMap, event?: Event): [number, number] | null {
		if (
			!event ||
			!(event.target instanceof Node) ||
			!instance.getCanvasContainer().contains(event.target)
		)
			return null;
		let clientX: number;
		let clientY: number;
		if ('touches' in event) {
			const touches = Array.from((event as TouchEvent).touches);
			// Keep the last two-finger midpoint after either finger is lifted.
			if (touches.length < 2) return null;
			clientX = touches.reduce((sum, touch) => sum + touch.clientX, 0) / touches.length;
			clientY = touches.reduce((sum, touch) => sum + touch.clientY, 0) / touches.length;
		} else if (event instanceof MouseEvent) {
			clientX = event.clientX;
			clientY = event.clientY;
		} else return null;
		const canvas = instance.getCanvas();
		const bounds = canvas.getBoundingClientRect();
		if (!bounds.width || !bounds.height) return null;
		return [
			((clientX - bounds.left) / bounds.width) * canvas.clientWidth,
			((clientY - bounds.top) / bounds.height) * canvas.clientHeight
		];
	}

	function drillIntoVisibleIsland(instance: LibreMap, gesturePoint: [number, number] | null) {
		if (
			!ready ||
			!active ||
			map !== instance ||
			selectedId ||
			picking ||
			mode !== 'explore' ||
			instance.getZoom() < 11
		)
			return;
		const center = gesturePoint
			? { x: gesturePoint[0], y: gesturePoint[1] }
			: instance.project(instance.getCenter());
		const centeredIsland = instance
			.queryRenderedFeatures([center.x, center.y], { layers: ['islands-fill'] })
			.find(
				(feature) =>
					feature.properties.category === 'Residential Island' &&
					(!atollScope || feature.properties.atoll === atollScope)
			);
		// The island under the gesture can be far from the map center. Ocean views
		// and programmatic national/atoll fits must keep the country context.
		let nearestDistance = Math.min(
			180,
			Math.min(container.clientWidth, container.clientHeight) * 0.32
		);
		let nearestId: string | null = centeredIsland ? String(centeredIsland.properties.id) : null;
		for (const feature of nearestId ? [] : layers.centroids.features) {
			const properties = feature.properties ?? {};
			if (
				properties.category !== 'Residential Island' ||
				(atollScope && properties.atoll !== atollScope) ||
				feature.geometry.type !== 'Point'
			)
				continue;
			const coordinates = feature.geometry.coordinates;
			if (!validCoordinates(coordinates)) continue;
			const point = instance.project(coordinates);
			const distance = Math.hypot(point.x - center.x, point.y - center.y);
			if (distance < nearestDistance) {
				nearestDistance = distance;
				nearestId = String(properties.id);
			}
		}
		if (!nearestId) return;
		contextualIsland = nearestId;
		closeInspection();
		onselect(nearestId);
	}

	function collection(items: Feature<Geometry>[]): FeatureCollection {
		return { type: 'FeatureCollection', features: items };
	}

	const layers = $derived.by(() => {
		const islands: Feature<Geometry>[] = [];
		const facilities: Feature<Geometry>[] = [];
		const transport: Feature<Geometry>[] = [];
		const centroids: Feature<Geometry>[] = [];
		for (const feature of features?.features ?? []) {
			if (!feature.geometry) continue;
			const props = feature.properties ?? {};
			const item: Feature<Geometry> = {
				...feature,
				geometry: feature.geometry,
				properties: { ...props, record_id: feature.id ?? props.id ?? null }
			};
			if (
				props.id &&
				!props.island_id &&
				['Polygon', 'MultiPolygon'].includes(item.geometry.type)
			) {
				islands.push(item);
				if (validCoordinates(props.centroid)) {
					centroids.push({
						type: 'Feature',
						properties: props,
						geometry: { type: 'Point', coordinates: props.centroid }
					});
				}
			} else if ('geometry_quality' in props || 'match_status' in props) {
				facilities.push(item);
			} else {
				transport.push(item);
			}
		}
		return {
			islands: collection(islands),
			facilities: collection(facilities),
			transport: collection(transport),
			centroids: collection(centroids)
		};
	});
	const selectedIsland = $derived(
		layers.islands.features.find((feature) => feature.properties?.id === selectedId)
	);
	const atollBounds = $derived(
		atollScope
			? boundsOf({
					type: 'GeometryCollection',
					geometries: layers.islands.features
						.filter((feature) => feature.properties?.atoll === atollScope)
						.map((feature) => feature.geometry)
				})
			: null
	);
	const accessibilityOverview = $derived(!selectedId && accessibilityScores !== null);
	const accessibilityCentroids = $derived.by(() => {
		if (!accessibilityOverview) return emptyCollection;
		const scores = new Map(accessibilityScores?.map((score) => [score.island_id, score]));
		const included = new SvelteSet<string>();
		return collection(
			layers.centroids.features.flatMap((feature) => {
				const properties = feature.properties ?? {};
				const id = String(properties.id ?? '');
				if (
					properties.category !== 'Residential Island' ||
					(atollScope && properties.atoll !== atollScope) ||
					included.has(id)
				)
					return [];
				included.add(id);
				const score = scores.get(id);
				const coverage = score?.assessment?.coverage;
				const limited =
					!score || !Number.isFinite(score.score) || !coverage || coverage.status === 'limited';
				return [
					{
						...feature,
						properties: {
							...properties,
							accessibility_score: limited ? null : score.score,
							limited_evidence: limited,
							label: `${properties.name ?? 'Island'} · ${limited ? 'Limited evidence' : `${score.score.toFixed(1)}/100 accessibility`} · select to explore`
						}
					}
				];
			})
		);
	});
	const selectedName = $derived(
		String(selectedIsland?.properties?.name ?? '').trim() ||
			(selectedId ? `Unnamed island (${selectedId})` : 'Selected island')
	);
	const activeLayerCount = $derived(
		Number(streetsVisible) +
			Number(buildingsVisible) +
			Number(facilitiesVisible) +
			Number(transportVisible) +
			Number(!!onSeaLayerChange && seaLayerEnabled) +
			Number(!!onAirLayerChange && airLayerEnabled) +
			Number(liveVisible && liveEvents.length > 0)
	);
	const mapBusy = $derived(
		!error && (!ready || !features || (layers.islands.features.length > 0 && !islandsDataReady))
	);
	const scenarioPreview = $derived.by(() => {
		const items: Feature<Geometry>[] = [];
		let unlocated = 0;
		for (const [index, operation] of (mode === 'proposal' ? draft : []).entries()) {
			const label = operation.type.replaceAll('_', ' ');
			const properties = {
				label,
				index: index + 1,
				type: operation.type,
				island_id: operation.island_id,
				target_id: operation.target_id
			};
			if (validCoordinates(operation.coordinates)) {
				items.push({
					type: 'Feature',
					properties: { ...properties, location_method: 'Proposed coordinates' },
					geometry: { type: 'Point', coordinates: operation.coordinates }
				});
				continue;
			}
			if (
				!operation.target_id ||
				!['remove_bus_stop', 'disable_ferry_terminal', 'road_closure'].includes(operation.type)
			)
				continue;
			const targetId = operation.target_id;
			const edgeWayId = /^land:island:[^:]+:(\d+):\d+(?::reverse)?$/.exec(targetId)?.[1];
			const target = (
				operation.type === 'road_closure' ? contextData.features : (features?.features ?? [])
			).find((feature) => {
				const props = feature.properties ?? {};
				if (operation.type === 'road_closure' && props.kind !== 'road') return false;
				return [
					feature.id,
					props.id,
					props.record_id,
					props.source_record_id,
					...(operation.type === 'road_closure' ? [props.osm_id] : [])
				].some((id) => id !== undefined && String(id) === (edgeWayId ?? targetId));
			});
			const geometry = target?.geometry;
			if (!geometry || !boundsOf(geometry)) {
				unlocated++;
				continue;
			}
			const line =
				geometry.type === 'LineString'
					? geometry.coordinates
					: geometry.type === 'MultiLineString'
						? geometry.coordinates.flat()
						: null;
			const bounds = boundsOf(geometry)!;
			const position =
				geometry.type === 'Point'
					? geometry.coordinates
					: (line?.[Math.floor(line.length / 2)] ?? [
							(bounds[0][0] + bounds[1][0]) / 2,
							(bounds[0][1] + bounds[1][1]) / 2
						]);
			if (!validCoordinates(position)) {
				unlocated++;
				continue;
			}
			const sourceProperties = target?.properties ?? {};
			const targetProperties = {
				...properties,
				label: `${label}${sourceProperties.name ? ` · ${sourceProperties.name}` : ''}`,
				source:
					sourceProperties.source ??
					(operation.type === 'road_closure' ? 'OpenStreetMap streets' : null),
				source_record_id: target?.id ?? sourceProperties.id,
				location_method:
					geometry.type === 'Point'
						? 'Selected location'
						: line
							? 'Selected route location'
							: 'Centre of selected area',
				geometry_preview: edgeWayId
					? 'Associated OSM way; exact graph segment is not exposed on this map'
					: operation.type === 'road_closure'
						? 'OpenStreetMap road'
						: 'Selected location'
			};
			if (operation.type === 'road_closure' && line)
				items.push({
					type: 'Feature',
					properties: targetProperties,
					geometry
				});
			items.push({
				type: 'Feature',
				properties: targetProperties,
				geometry: { type: 'Point', coordinates: position }
			});
		}
		return { data: collection(items), unlocated };
	});
	const scenarioFeatures = $derived(scenarioPreview.data);
	const directionWaypoints = $derived.by((): DirectionWaypoint[] => {
		if (!inlineDirectionsActive) return [];
		const points =
			directionPoints ??
			directions?.points.map((coordinates, index) => ({
				id: `direction:${index}`,
				name: index === 0 ? 'Journey start' : 'Journey stop',
				coordinates
			})) ??
			[];
		return points.flatMap((point, index): DirectionWaypoint[] =>
			validCoordinates(point.coordinates)
				? [
						{
							...point,
							coordinates: point.coordinates,
							index,
							letter: String.fromCharCode(65 + index),
							role: index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'via'
						}
					]
				: []
		);
	});
	const directionDestinationLetter = $derived(
		inlineDirectionsActive
			? String.fromCharCode(
					65 + Math.max(1, (directionPoints?.length ?? directions?.points.length ?? 2) - 1)
				)
			: 'B'
	);
	const matchedDirections = $derived.by(() => {
		if (!directions) return null;
		if (
			directionPoints !== undefined &&
			(directionPoints.length !== directions.points.length ||
				directionPoints.some(
					(point, index) =>
						!validCoordinates(point.coordinates) ||
						point.coordinates.some(
							(value, axis) => Math.abs(value - directions!.points[index][axis]) > 0.000001
						)
				))
		)
			return null;
		return directions;
	});
	const matchedJourney = $derived(
		!inlineDirectionsActive &&
			route?.journey?.status === 'reachable' &&
			routeEndpointsMatch(
				route.journey.legs[0]?.from.coordinates,
				route.journey.legs.at(-1)?.to.coordinates,
				routeStart,
				routeEnd,
				route.snap_distance_m
			)
			? route.journey
			: null
	);
	const routeFeatures = $derived.by(() => {
		if (inlineDirectionsActive)
			return collection([
				...searchDirectionsFeatures(matchedDirections).features,
				...directionWaypoints.map((point) => ({
					type: 'Feature' as const,
					id: `direction:${point.index}:${point.id}`,
					properties: {
						kind: point.role,
						inline_direction: true,
						letter: point.letter,
						name: point.name,
						label: `${point.letter} · ${point.name || 'Journey point'}`,
						status:
							matchedDirections?.status === 'ok'
								? 'Calculated route'
								: matchedDirections?.status === 'partial'
									? 'Partial route · some connections unavailable'
									: 'Journey input · route unconfirmed'
					},
					geometry: { type: 'Point' as const, coordinates: point.coordinates }
				}))
			]);
		const coordinates = route?.geometry;
		const journey = route?.journey;
		const firstPoint = journey?.legs[0]?.from.coordinates;
		const lastPoint = journey?.legs.at(-1)?.to.coordinates;
		const journeyMatches = !!matchedJourney;
		const routeMatches =
			!journey &&
			coordinates?.length &&
			coordinates.every(validCoordinates) &&
			routeEndpointsMatch(
				coordinates[0],
				coordinates.at(-1),
				routeStart,
				routeEnd,
				route?.snap_distance_m
			);
		const start =
			routeStart ?? (journeyMatches ? firstPoint : routeMatches ? coordinates?.[0] : null);
		const end =
			routeEnd ??
			(journeyMatches ? lastPoint : routeMatches ? coordinates?.[coordinates.length - 1] : null);
		return collection([
			...(matchedJourney
				? (exploreJourneyFeatures(matchedJourney).features as Feature<Geometry>[])
				: []),
			...(routeMatches && coordinates && coordinates.length > 1
				? ([
						{
							type: 'Feature',
							properties: { kind: 'route' },
							geometry: { type: 'LineString', coordinates }
						}
					] as Feature<Geometry>[])
				: []),
			...(start && validCoordinates(start)
				? ([
						{
							type: 'Feature',
							properties: {
								kind: 'start',
								label: 'Journey start',
								status:
									routeMatches || journeyMatches
										? 'Calculated route'
										: 'Journey input · calculate to find route'
							},
							geometry: { type: 'Point', coordinates: start }
						}
					] as Feature<Geometry>[])
				: []),
			...(end && validCoordinates(end)
				? ([
						{
							type: 'Feature',
							properties: {
								kind: 'end',
								label: 'Journey destination',
								status:
									routeMatches || journeyMatches
										? 'Calculated route'
										: 'Journey input · calculate to find route'
							},
							geometry: {
								type: 'Point',
								coordinates: end
							}
						}
					] as Feature<Geometry>[])
				: [])
		]);
	});
	const journeyStopFeatures = $derived.by(() => {
		const journeys = inlineDirectionsActive
			? (matchedDirections?.segments.flatMap((segment) =>
					segment.status === 'ok' && segment.result?.journey?.status === 'reachable'
						? [segment.result.journey]
						: []
				) ?? [])
			: matchedJourney
				? [matchedJourney]
				: [];
		if (!journeys.length) return emptyCollection;
		return collection(
			journeys.flatMap((journey, journeyIndex) =>
				journey.stops
					.filter((stop) => validCoordinates(stop.coordinates))
					.map((stop) => {
						const rides = journey.legs.filter(
							(leg) =>
								['bus', 'ferry'].includes(leg.mode) &&
								(leg.from.id === stop.id || leg.to.id === stop.id)
						);
						const board = rides.find((leg) => leg.from.id === stop.id);
						const alight = rides.find((leg) => leg.to.id === stop.id);
						const action =
							stop.roles.length > 1
								? 'Transfer'
								: stop.roles.includes('board')
									? 'Board here'
									: 'Get off here';
						const routeNames = [
							...new Set(rides.map((leg) => leg.route_name ?? leg.route_id).filter(Boolean))
						].join(' → ');
						return {
							type: 'Feature',
							id: inlineDirectionsActive ? `${journeyIndex}:${stop.id}` : stop.id,
							geometry: { type: 'Point', coordinates: stop.coordinates },
							properties: {
								kind: 'journey-stop',
								mode: rides.some((leg) => leg.mode === 'ferry') ? 'ferry' : 'bus',
								name: stop.name,
								role: action,
								route_names: routeNames,
								departure: board ? journeyClock(board.departure_minutes) : null,
								arrival: alight ? journeyClock(alight.arrival_minutes) : null,
								label: `${action} · ${stop.name}${routeNames ? ` · ${routeNames}` : ''}`
							}
						};
					})
			)
		);
	});
	const liveFeatures = $derived(
		collection(
			liveEvents
				.filter((event) => validCoordinates([event.position.longitude, event.position.latitude]))
				.map((event) => ({
					type: 'Feature',
					id: event.id,
					properties: {
						...event.properties,
						kind: event.kind,
						record_id: event.id,
						provider: event.provider,
						observed_at: event.observed_at,
						retrieved_at: event.retrieved_at,
						stale: event.stale,
						live_badge_eligible:
							['aircraft', 'vessel'].includes(event.kind) &&
							!event.stale &&
							event.position_time_quality === 'provider_observed' &&
							['provider_live', 'verified_public_json'].includes(event.source_quality ?? ''),
						live_observed_at: Number.isFinite(Date.parse(event.observed_at ?? ''))
							? Date.parse(event.observed_at!)
							: 0,
						heading: eventBearing(event),
						name: eventName(event),
						label: `${eventName(event)} · ${event.provider}${event.stale ? ' · stale position' : event.observed_at ? ' · observed position' : ' · observation time unavailable'}`
					},
					geometry: {
						type: 'Point',
						coordinates: [event.position.longitude, event.position.latitude]
					}
				}))
		)
	);
	const freshMovement = $derived(
		liveFeatures.features.filter((feature) => !feature.properties?.stale)
	);
	const activityKinds = $derived.by(() => {
		const counts = { aircraft: 0, vessel: 0, bus: 0 };
		for (const event of liveEvents) counts[event.kind]++;
		return counts;
	});

	function eventBearing(event: LiveEvent): number | null {
		for (const key of event.kind === 'aircraft'
			? ['track', 'heading']
			: ['heading', 'cog', 'track']) {
			const value = event.properties[key];
			const number =
				typeof value === 'number'
					? value
					: typeof value === 'string' && value.trim()
						? Number(value)
						: NaN;
			if (Number.isFinite(number) && number >= 0 && number < 360) return number;
		}
		return null;
	}
	function eventName(event: LiveEvent) {
		return (
			String(
				event.properties.name ??
					event.properties.flight ??
					event.properties.callsign ??
					event.properties.plateNumber ??
					event.properties.busCode ??
					''
			).trim() ||
			(event.kind === 'vessel' ? 'Vessel' : event.kind === 'aircraft' ? 'Aircraft' : 'Bus')
		);
	}

	function poiData() {
		const points: Feature<Geometry>[] = [];
		for (const [source, visible, data] of [
			['facilities', facilitiesVisible, layers.facilities],
			['transport', transportVisible, layers.transport]
		] as const) {
			if (!visible) continue;
			for (const feature of data.features) {
				if (!feature.geometry) continue;
				const bounds = boundsOf(feature.geometry);
				if (!bounds) continue;
				const properties = feature.properties ?? {};
				const tags = objectProperty(properties.tags);
				const category =
					properties.category === 'public_transport' &&
					(tags.bus === 'yes' || tags.highway === 'bus_stop')
						? 'bus_stop'
						: properties.category;
				const symbolCategory =
					category === 'terminal' || tags.aeroway === 'terminal' ? 'air_terminal' : category;
				const name = String(properties.name ?? tags['name:en'] ?? tags.name ?? '').trim();
				const priority = [
					'hospital',
					'airport',
					'ferry_terminal',
					'school',
					'health_center',
					'bus_stop'
				].indexOf(String(category));
				points.push({
					...feature,
					properties: {
						...properties,
						category,
						symbol_category: symbolCategory,
						name,
						record_source: source,
						location_method: feature.geometry.type === 'Point' ? 'Location' : 'Area centre',
						priority: priority < 0 ? 100 : priority,
						label: `${name || String(category ?? 'Place').replaceAll('_', ' ')} · ${String(category ?? 'place').replaceAll('_', ' ')}`
					},
					geometry: {
						type: 'Point',
						coordinates: [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2]
					}
				});
			}
		}
		return collection(points);
	}

	const poiFeatures = $derived(poiData());
	const busStopFeatures = $derived.by(() => {
		const official = transitStops.filter((stop) => validCoordinates(stop.coordinates));
		const points: Feature<Geometry>[] = official.map((stop) => ({
			type: 'Feature',
			id: stop.id,
			properties: {
				record_id: stop.id,
				name: stop.name,
				island_id: stop.national_island_id,
				planning_island_id: stop.island_id,
				category: 'bus_stop',
				record_source: 'transport',
				source: 'Reviewed planning stop catalogue',
				route_ids: stop.route_ids?.join(', '),
				route_names: stop.route_names?.join(', '),
				timetable_status: stop.timetable_status,
				label: `${stop.name} · Bus stop`,
				location_method: 'Reviewed stop position'
			},
			geometry: { type: 'Point', coordinates: stop.coordinates }
		}));
		for (const feature of poiFeatures.features) {
			if (!['bus_stop', 'bus_station'].includes(feature.properties?.category)) continue;
			if (feature.geometry.type !== 'Point') continue;
			const position = feature.geometry.coordinates;
			if (
				official.some((stop) => {
					const dx = (stop.coordinates[0] - position[0]) * 111000;
					const dy = (stop.coordinates[1] - position[1]) * 111000;
					return Math.hypot(dx, dy) < 20;
				})
			)
				continue;
			points.push(feature);
		}
		return collection(points);
	});

	function smoothLiveData(target: FeatureCollection) {
		cancelAnimationFrame(liveFrame);
		liveAnimating = false;
		if (!active) return;
		const previous = new Map(displayedLive.features.map((feature) => [feature.id, feature]));
		const transitions = target.features.map((feature) => {
			// Keep group membership stable at harbor scale; animate precise received pins only.
			if (feature.properties?.kind === 'vessel' && (map?.getZoom() ?? 0) <= 16) return null;
			const before = previous.get(feature.id);
			const receivedTime = Date.parse(String(feature.properties?.observed_at ?? ''));
			const earlierTime = Date.parse(String(before?.properties?.observed_at ?? ''));
			return before?.geometry.type === 'Point' &&
				feature.geometry.type === 'Point' &&
				!feature.properties?.stale &&
				Number.isFinite(receivedTime) &&
				receivedTime > earlierTime
				? before.geometry.coordinates
				: null;
		});
		if (reducedMotion() || !transitions.some(Boolean)) {
			displayedLive = target;
			setLiveData(target);
			return;
		}
		const startTime = performance.now();
		liveAnimating = true;
		function frame(now: number) {
			if (!map || !ready || !active) return;
			const progress = Math.min((now - startTime) / 260, 1);
			const eased = 1 - Math.pow(1 - progress, 3);
			displayedLive = collection(
				target.features.map((feature, index) => {
					const before = transitions[index];
					if (!before || feature.geometry.type !== 'Point' || progress === 1) return feature;
					return {
						...feature,
						geometry: {
							type: 'Point',
							coordinates: [
								before[0] + (feature.geometry.coordinates[0] - before[0]) * eased,
								before[1] + (feature.geometry.coordinates[1] - before[1]) * eased
							]
						}
					};
				})
			);
			setLiveData(displayedLive);
			if (progress < 1) liveFrame = requestAnimationFrame(frame);
			else liveAnimating = false;
		}
		liveFrame = requestAnimationFrame(frame);
	}

	function setLiveData(data: FeatureCollection) {
		for (const source of ['live', 'live-vessels']) {
			const points = data.features.filter((feature) =>
				source === 'live-vessels'
					? feature.properties?.kind === 'vessel'
					: feature.properties?.kind !== 'vessel'
			);
			const previous = untrack(() => sourceData.get(source)?.features);
			if (
				!previous ||
				previous.length !== points.length ||
				points.some((point, index) => point !== previous[index])
			)
				setData(source, collection(points));
		}
	}

	function expandCluster(feature: MapGeoJSONFeature, restoreFocus = false) {
		if (
			!map ||
			!active ||
			feature.geometry.type !== 'Point' ||
			!['pois', 'live-vessels'].includes(feature.source)
		)
			return;
		const instance = map;
		const islandId = selectedId;
		const coordinates = feature.geometry.coordinates;
		if (!validCoordinates(coordinates)) return;
		const source = instance.getSource(feature.source) as GeoJSONSource;
		void source
			.getClusterExpansionZoom(Number(feature.properties.cluster_id))
			.then((zoom) => {
				if (map !== instance || !active || selectedId !== islandId || picking || serviceEditor)
					return;
				userZoomGesture = null;
				instance.easeTo({
					center: coordinates,
					zoom: Math.min(zoom, feature.source === 'live-vessels' ? 17 : 16),
					duration: reducedMotion() ? 0 : 280
				});
				if (restoreFocus) instance.getCanvas().focus({ preventScroll: true });
			})
			.catch(() => {
				// A live refresh can replace the selected cluster while the worker resolves its zoom.
			});
	}

	function syncMovementCounts() {
		if (!map || !ready || !active) return;
		const pins = map.queryRenderedFeatures({ layers: ['live-symbols', 'live-vessel-symbols'] });
		const clusters = map.queryRenderedFeatures({ layers: ['live-vessel-clusters'] });
		const observations = new Map(
			pins.map((feature) => [String(feature.properties.record_id ?? feature.id), feature])
		);
		const groups = new Map(
			clusters.map((feature) => [String(feature.properties.cluster_id), feature])
		);
		renderedMovement = observations.size + groups.size;
		renderedBusVehicles = [...observations.values()].filter(
			(feature) => feature.properties.kind === 'bus'
		).length;
		renderedVesselGroups = groups.size;
		renderedMovementObservations =
			observations.size +
			[...groups.values()].reduce(
				(total, feature) => total + Number(feature.properties.point_count),
				0
			);
		if (!makeMarker) return;
		for (const [id, feature] of groups) {
			if (feature.geometry.type !== 'Point' || !validCoordinates(feature.geometry.coordinates))
				continue;
			let marker = vesselClusterButtons[id];
			if (!marker) {
				const button = document.createElement('button');
				button.type = 'button';
				button.className = 'vessel-group-target';
				button.addEventListener('click', (event) => {
					event.stopPropagation();
					const current = map
						?.queryRenderedFeatures({ layers: ['live-vessel-clusters'] })
						.find((item) => String(item.properties.cluster_id) === id);
					if (current) expandCluster(current, event.detail === 0);
				});
				marker = new makeMarker({ element: button })
					.setLngLat(feature.geometry.coordinates)
					.addTo(map);
				vesselClusterButtons[id] = marker;
			} else marker.setLngLat(feature.geometry.coordinates);
			marker
				.getElement()
				.setAttribute(
					'aria-label',
					`${feature.properties.point_count} vessel positions grouped here. Select to zoom in and inspect individual vessels.`
				);
			marker.getElement().hidden = picking;
		}
		for (const [id, marker] of Object.entries(vesselClusterButtons)) {
			if (!groups.has(id)) {
				marker.remove();
				delete vesselClusterButtons[id];
			}
		}
	}

	function focusJourney() {
		if (!map || presentation) return;
		userZoomGesture = null;
		const positions = routeFeatures.features.flatMap((feature) => {
			if (feature.geometry.type === 'LineString') return feature.geometry.coordinates;
			if (feature.geometry.type === 'Point') return [feature.geometry.coordinates];
			return [];
		});
		const bounds = boundsOf({ type: 'MultiPoint', coordinates: positions });
		const padding = focusPadding();
		if (inlineDirectionsActive) {
			const frame = container.getBoundingClientRect();
			const dock = container
				.closest('.map-workspace')
				?.querySelector('.map-search-dock.search-directions-open')
				?.getBoundingClientRect();
			if (dock) {
				if (window.matchMedia('(max-width: 700px)').matches) {
					padding.top = Math.max(
						padding.top,
						Math.min(dock.bottom - frame.top + 12, Math.max(0, frame.height - 180))
					);
					padding.bottom = Math.min(padding.bottom, 90);
				} else {
					padding.left = Math.max(
						padding.left,
						Math.min(dock.right - frame.left + 24, Math.max(0, frame.width - 180))
					);
				}
			}
		}
		if (bounds)
			map.fitBounds(bounds, {
				absolutePadding: true,
				padding,
				maxZoom: 16,
				duration: reducedMotion() ? 0 : 280
			});
		closeControls(true);
	}

	function focusMovement() {
		if (!map || !freshMovement.length) return;
		userZoomGesture = null;
		liveVisible = true;
		const coordinates = freshMovement.flatMap((feature) =>
			feature.geometry.type === 'Point' ? [feature.geometry.coordinates] : []
		);
		if (validCoordinates(selectedIsland?.properties?.centroid))
			coordinates.push(selectedIsland.properties.centroid);
		const bounds = boundsOf({ type: 'MultiPoint', coordinates });
		if (bounds)
			map.fitBounds(bounds, {
				absolutePadding: true,
				padding: focusPadding(),
				maxZoom: 13,
				duration: reducedMotion() ? 0 : 280
			});
		closeControls(true);
	}

	function boundsOf(geometry: Geometry): [Coordinates, Coordinates] | null {
		let west = Infinity,
			south = Infinity,
			east = -Infinity,
			north = -Infinity;
		function visit(value: unknown): void {
			if (!Array.isArray(value)) return;
			if (typeof value[0] === 'number' && typeof value[1] === 'number') {
				if (!Number.isFinite(value[0]) || !Number.isFinite(value[1])) return;
				west = Math.min(west, value[0]);
				east = Math.max(east, value[0]);
				south = Math.min(south, value[1]);
				north = Math.max(north, value[1]);
			} else value.forEach(visit);
		}
		function visitGeometry(item: Geometry): void {
			if (item.type === 'GeometryCollection') item.geometries.forEach(visitGeometry);
			else visit(item.coordinates);
		}
		visitGeometry(geometry);
		return Number.isFinite(west)
			? [
					[west, south],
					[east, north]
				]
			: null;
	}

	function focusPadding() {
		const style = getComputedStyle(container);
		const width = container.clientWidth;
		const height = container.clientHeight;
		const inset = (side: string, fallback: number, maximum: number) => {
			const setting = style.getPropertyValue(`--map-focus-${side}`).trim();
			let value = Number.parseFloat(setting);
			if (setting.endsWith('%')) {
				value = (value / 100) * (side === 'top' || side === 'bottom' ? height : width);
			} else if (/(?:dvh|svh|vh)$/i.test(setting)) {
				// Resolve viewport units through CSS so small and dynamic mobile viewports stay distinct.
				const measure = document.createElement('div');
				measure.style.position = 'fixed';
				measure.style.visibility = 'hidden';
				measure.style.pointerEvents = 'none';
				measure.style.width = '0';
				measure.style.height = setting;
				// eslint-disable-next-line svelte/no-dom-manipulating -- This temporary CSS probe belongs to MapLibre's imperative subtree and is immediately removed.
				container.append(measure);
				value = measure.getBoundingClientRect().height;
				measure.remove();
			}
			return Math.max(0, Math.min(Number.isFinite(value) ? value : fallback, maximum));
		};
		return {
			top: inset('top', 100, height * 0.35),
			right: inset('right', 65, width * 0.48),
			bottom: inset('bottom', 110, height * 0.48),
			left: inset('left', 40, width * 0.48)
		};
	}

	function fitNational() {
		userZoomGesture = null;
		map?.fitBounds(nationalBounds, {
			absolutePadding: true,
			padding: focusPadding(),
			duration: reducedMotion() ? 0 : 280
		});
	}
	function scopeFocusPadding() {
		const padding = focusPadding();
		if (!scopeBounds || container.clientWidth > 1100) return padding;
		// On narrow maps, keep both cities above the legend and bottom action docks.
		const frame = container.getBoundingClientRect();
		const information = container.parentElement
			?.querySelector('.map-controls')
			?.getBoundingClientRect();
		if (information?.height) {
			const legendHeight = information.height;
			padding.bottom = Math.max(
				padding.bottom,
				Math.min(frame.bottom - information.bottom + legendHeight + 24, frame.height * 0.48)
			);
		}
		return padding;
	}
	function nationalView() {
		closeInspection();
		closeControls(true);
		if (onnational) onnational();
		else fitNational();
	}

	function focusIsland() {
		if (!map || presentation || !selectedIsland?.geometry) return;
		userZoomGesture = null;
		const bounds = boundsOf(selectedIsland.geometry);
		if (bounds)
			map.fitBounds(bounds, {
				absolutePadding: true,
				padding: focusPadding(),
				maxZoom: 16,
				duration: reducedMotion() ? 0 : 280
			});
	}

	function clearStreetLabels() {
		for (const [name, marker] of Object.entries(streetLabels)) {
			marker.remove();
			delete streetLabels[name];
		}
	}

	function syncStopLabels() {
		if (!map || !makeMarker || !active) return;
		const visible = new SvelteSet<string>();
		const occupied: { x: number; y: number; width: number }[] = [];
		if (labelsVisible && map.getZoom() >= 14.2) {
			for (const feature of [
				...journeyStopFeatures.features,
				...(transportVisible ? busStopFeatures.features : [])
			]) {
				if (feature.geometry.type !== 'Point') continue;
				const coordinates = feature.geometry.coordinates;
				if (!validCoordinates(coordinates)) continue;
				const isJourneyStop = feature.properties?.kind === 'journey-stop';
				const name = String(
					isJourneyStop ? feature.properties?.label : (feature.properties?.name ?? '')
				).trim();
				if (!name) continue;
				const point = map.project(coordinates);
				const width = Math.min(name.length * 5.5 + 20, 170);
				if (
					point.x < 40 ||
					point.x > container.clientWidth - width / 2 - 40 ||
					point.y < 90 ||
					point.y > container.clientHeight - 140 ||
					occupied.some(
						(label) =>
							Math.abs(label.y - point.y) < 35 &&
							Math.abs(label.x - point.x) < (label.width + width) / 2 + 12
					)
				)
					continue;
				occupied.push({ x: point.x, y: point.y, width });
				const id = `${isJourneyStop ? 'journey:' : ''}${String(feature.id ?? feature.properties?.record_id)}`;
				visible.add(id);
				if (!stopLabels[id]) {
					const element = document.createElement('span');
					element.className = isJourneyStop
						? 'atlas-stop-label journey-stop-label'
						: 'atlas-stop-label';
					element.textContent = name;
					stopLabels[id] = new makeMarker({ element, anchor: 'top', offset: [0, 16] })
						.setLngLat(coordinates)
						.addTo(map);
				} else {
					stopLabels[id].setLngLat(coordinates);
					stopLabels[id].getElement().textContent = name;
				}
				if (visible.size >= (container.clientWidth < 650 ? 14 : 28)) break;
			}
		}
		for (const [id, marker] of Object.entries(stopLabels)) {
			if (!visible.has(id)) {
				marker.remove();
				delete stopLabels[id];
			}
		}
	}

	function syncStreetLabels() {
		if (!map || !makeMarker || !active) return;
		const labelZoom = container.clientWidth < 620 ? 12 : 12.8;
		if (!streetsVisible || !labelsVisible || map.getZoom() < labelZoom) {
			clearStreetLabels();
			return;
		}
		const occupied: { x: number; y: number; width: number }[] = [];
		const visible = new SvelteSet<string>();
		const rank = (feature: Feature) =>
			[
				'primary',
				'secondary',
				'tertiary',
				'residential',
				'unclassified',
				'service',
				'footway'
			].indexOf(String(feature.properties?.highway ?? ''));
		const roads = contextData.features
			.filter((feature) => feature.properties?.kind === 'road' && feature.properties?.name)
			.sort((a, b) => rank(a) - rank(b));
		for (const feature of roads) {
			if (feature.geometry?.type !== 'LineString') continue;
			const name = String(feature.properties?.name);
			if (visible.has(name)) continue;
			const coordinates = feature.geometry.coordinates;
			const center = coordinates[Math.floor(coordinates.length / 2)];
			if (!validCoordinates(center)) continue;
			const point = map.project(center);
			const width = Math.min(name.length * 5.7 + 14, 180);
			if (
				point.x < width / 2 + 12 ||
				point.x > container.clientWidth - width / 2 - 70 ||
				point.y < 95 ||
				point.y > container.clientHeight - 145
			)
				continue;
			if (
				occupied.some(
					(label) =>
						Math.abs(label.y - point.y) < 27 &&
						Math.abs(label.x - point.x) < (label.width + width) / 2 + 14
				)
			)
				continue;
			occupied.push({ x: point.x, y: point.y, width });
			visible.add(name);
			if (!streetLabels[name]) {
				const element = document.createElement('span');
				element.className = 'atlas-street-label';
				element.textContent = name;
				streetLabels[name] = new makeMarker({ element, anchor: 'center' })
					.setLngLat(center)
					.addTo(map);
			} else streetLabels[name].setLngLat(center);
			if (visible.size >= (container.clientWidth < 650 ? 15 : 36)) break;
		}
		for (const [name, marker] of Object.entries(streetLabels)) {
			if (!visible.has(name)) {
				marker.remove();
				delete streetLabels[name];
			}
		}
	}

	async function loadStreetContext() {
		if (!map || !ready || !active) return;
		if (map.getZoom() < 10) {
			contextGeneration++;
			contextRequest?.abort();
			contextPendingKey = '';
			contextLoading = false;
			clearStreetLabels();
			return;
		}
		const bounds = map.getBounds();
		const viewport: StreetBounds = [
			bounds.getWest(),
			bounds.getSouth(),
			bounds.getEast(),
			bounds.getNorth()
		];
		const bbox = streetContextBounds(viewport);
		if (!bbox) return;
		// MapLibre can emit move-end for an unchanged viewport with tiny rounding differences.
		const key = bbox.map((coordinate) => coordinate.toFixed(6)).join(',');
		if (key === contextPendingKey) return;
		if (
			key === contextLoadedKey ||
			(contextLoadedBounds &&
				!contextSummary.truncated &&
				!contextLoadedError &&
				canReuseStreetBounds(contextLoadedBounds, viewport))
		) {
			contextGeneration++;
			contextRequest?.abort();
			contextPendingKey = '';
			contextLoading = false;
			contextError = contextLoadedError;
			return;
		}
		const generation = ++contextGeneration;
		contextRequest?.abort();
		contextPendingKey = key;
		contextRequest = new AbortController();
		contextLoading = true;
		contextError = '';
		try {
			const data = await api<
				FeatureCollection & {
					summary: typeof contextSummary & { status?: string };
				}
			>(`map/context?bbox=${key}`, undefined, contextRequest.signal);
			if (generation !== contextGeneration || !map) return;
			contextLoadedKey = key;
			contextLoadedBounds = bbox;
			contextData = data;
			contextSummary = data.summary;
			setData('street-context', data);
			syncStreetLabels();
			contextLoadedError = data.summary?.status === 'unavailable' ? 'Streets unavailable' : '';
			contextError = contextLoadedError;
		} catch (cause) {
			if (
				generation === contextGeneration &&
				!(cause instanceof DOMException && cause.name === 'AbortError')
			)
				contextError = 'Street context unavailable · retry by moving the map';
		} finally {
			if (generation === contextGeneration) {
				contextPendingKey = '';
				contextLoading = false;
			}
		}
	}

	function scheduleStreetContext() {
		clearTimeout(contextTimer);
		if (!active) return;
		contextTimer = setTimeout(() => void loadStreetContext(), 140);
	}

	function syncIslandLabels() {
		if (!map || !makeMarker || !active) return;
		const visible: string[] = [];
		if (labelsVisible && map.getZoom() >= 9) {
			const occupied: { x: number; y: number; width: number }[] = [];
			for (const feature of layers.centroids.features) {
				const props = feature.properties;
				if (!props?.name || props.id === selectedId || feature.geometry?.type !== 'Point') continue;
				const coordinates = feature.geometry.coordinates;
				if (!validCoordinates(coordinates)) continue;
				const point = map.project(coordinates);
				const width = Math.min(String(props.name).length * 6.5 + 12, 150);
				if (
					point.x < width / 2 ||
					point.x > container.clientWidth - width / 2 ||
					point.y < 45 ||
					point.y > container.clientHeight - 100
				)
					continue;
				if (
					occupied.some(
						(label) =>
							Math.abs(label.y - point.y) < 32 &&
							Math.abs(label.x - point.x) < (label.width + width) / 2
					)
				)
					continue;
				occupied.push({ x: point.x, y: point.y, width });
				const id = String(props.id);
				visible.push(id);
				let marker = islandLabels[id];
				if (!marker) {
					const element = document.createElement('div');
					element.className = 'atlas-neighbor-label';
					element.textContent = String(props.name);
					marker = new makeMarker({ element, anchor: 'top', offset: [0, 8] })
						.setLngLat(coordinates)
						.addTo(map);
					islandLabels[id] = marker;
				}
				if (visible.length === 24) break;
			}
		}
		for (const [id, marker] of Object.entries(islandLabels)) {
			if (!visible.includes(id)) {
				marker.remove();
				delete islandLabels[id];
			}
		}
	}

	function dismissControls(event: PointerEvent) {
		if (controlsPanel && event.target instanceof Node && !controls?.contains(event.target))
			controlsPanel = null;
	}

	function closeControls(restoreFocus = false) {
		const trigger =
			controlsPanel === 'layers' ? layersButton : controlsPanel === 'view' ? viewButton : null;
		controlsPanel = null;
		if (restoreFocus) trigger?.focus();
	}

	async function toggleControls(panel: 'layers' | 'view') {
		if (controlsPanel === panel) {
			controlsPanel = null;
			return;
		}
		mobileLegendOpen = false;
		controlsPanel = panel;
		await tick();
		controls?.querySelector<HTMLButtonElement>('.control-panel:not([inert]) button')?.focus();
	}
	function toggleMapKey() {
		closeControls();
		mobileLegendOpen = !mobileLegendOpen;
	}

	function controlsKeydown(event: KeyboardEvent) {
		if (!active || event.defaultPrevented || event.key !== 'Escape') return;
		if (serviceEditor && oncancelservice) {
			event.preventDefault();
			oncancelservice();
			map?.getCanvas().focus({ preventScroll: true });
		} else if ((pendingProposal || (picking && placementKind)) && oncancelproposal) {
			event.preventDefault();
			oncancelproposal();
			map?.getCanvas().focus({ preventScroll: true });
		} else if (selectedProposalIndex !== null) {
			event.preventDefault();
			policyMarkers.get(selectedProposalIndex)?.getElement().focus({ preventScroll: true });
			selectedProposalIndex = null;
		} else if (controlsPanel) closeControls(true);
		else if (mobileLegendOpen) {
			mobileLegendOpen = false;
			controls?.querySelector<HTMLButtonElement>('[aria-label="Map key & live coverage"]')?.focus();
		} else if (inspectedSource === 'sea-network' || inspectedSource === 'air-network') {
			event.preventDefault();
			closeInspection();
			map?.getCanvas().focus({ preventScroll: true });
		}
	}

	function setData(name: string, data: FeatureCollection) {
		const instance = map;
		const source = instance?.getSource(name) as GeoJSONSource | undefined;
		const previous = untrack(() => sourceData.get(name));
		if (!instance || !source || previous === data) return;
		untrack(() => sourceData.set(name, data));
		// Sources start empty. Reposting an equivalent empty collection needlessly
		// rebuilds worker indexes; clearing a previously populated source still runs.
		if (!data.features.length && !previous?.features.length) return;
		if (name === 'street-context') diagnosticsDirty.context = true;
		else if (name === 'live' || name === 'live-vessels') diagnosticsDirty.movement = true;
		else if (['pois', 'facilities', 'transport', 'bus-stops'].includes(name))
			diagnosticsDirty.places = true;
		if (name === 'policy-impact') untrack(() => impactSourceUpdates++);
		const version = name === 'islands' ? ++islandsDataVersion : 0;
		if (name === 'islands') {
			cancelIslandReadiness?.();
			islandsDataReady = false;
		}
		void source
			.setData(data)
			.then(() => {
				if (name !== 'islands' || map !== instance || version !== islandsDataVersion) return;
				const complete = () => {
					if (map !== instance || version !== islandsDataVersion) {
						instance.off('render', complete);
						return;
					}
					if (!instance.isSourceLoaded('islands')) return;
					instance.off('render', complete);
					cancelIslandReadiness = undefined;
					islandsDataReady = true;
				};
				// Wait for the geography's completed render, without holding the map's
				// loading state open for independent live, route or street sources.
				cancelIslandReadiness = () => instance.off('render', complete);
				instance.on('render', complete);
				instance.triggerRepaint();
			})
			.catch((cause: unknown) => {
				if (map === instance)
					error = cause instanceof Error ? cause.message : 'The map could not be drawn.';
			});
	}

	function closeInspection() {
		inspectionPopup?.remove();
		inspectionPopup = null;
		inspectedSource = null;
		inspectedIslandId = null;
		inspectedSeaRouteId = '';
		inspectedSeaFeatures = null;
		inspectedAirRouteId = '';
		inspectedAirNetwork = null;
		inspectedPresentationSignature = '';
	}
	function inspectPresentationRoute(inspection: NonNullable<PresentationMapScene['inspect']>) {
		const feature: Feature = {
			type: 'Feature',
			properties: { route_id: inspection.routeId },
			geometry: { type: 'Point', coordinates: inspection.coordinates }
		};
		const event = {
			lngLat: { lng: inspection.coordinates[0], lat: inspection.coordinates[1] }
		};
		if (inspection.mode === 'air') inspectAirRoute(feature, event, inspection.summary);
		else if (
			inspection.summary ||
			seaState?.routes?.some((route) => route.id === inspection.routeId)
		)
			inspectSeaRoute({ ...feature, source: 'sea-network' }, event, inspection.summary);
		if (inspectionPopup) inspectedPresentationSignature = JSON.stringify(inspection);
	}
	function inspectAirRoute(
		feature: Feature,
		event: { lngLat: { lng: number; lat: number } },
		presentationSummary?: NonNullable<PresentationMapScene['inspect']>['summary']
	) {
		const network = airState;
		const routeId = String(feature.properties?.route_id ?? '');
		const route = network?.routes.find((item) => item.id === routeId);
		if (!map || !makePopup || !network || !route) return;
		closeInspection();
		const panel = airRouteCard(network, route);
		if (presentationSummary) {
			const title = panel.querySelector('h3');
			if (title) title.textContent = presentationSummary.title;
			const details = panel.querySelector('details');
			const sourceSummary = panel.querySelector('dl');
			if (details && sourceSummary) {
				sourceSummary.classList.add('presentation-route-source-summary');
				details.insertBefore(sourceSummary, details.children[1] ?? null);
				const pressure = panel.querySelector('.sea-route-pressure');
				if (pressure) details.append(pressure);
			}
			const summary = document.createElement('dl');
			summary.className = 'presentation-route-summary';
			const label = document.createElement('dt');
			label.textContent = presentationSummary.timingLabel ?? 'Estimated flight';
			const value = document.createElement('dd');
			value.textContent =
				presentationSummary.minutes == null
					? 'Unavailable'
					: seaDuration(presentationSummary.minutes);
			summary.append(label, value);
			const qualification = document.createElement('p');
			qualification.className = 'sea-route-presentation-qualification';
			qualification.textContent = presentationSummary.qualification;
			panel.insertBefore(summary, details);
			panel.insertBefore(qualification, details);
		}
		const popup = new makePopup({
			className: 'map-record-popup map-source-record-popup map-air-route-popup',
			maxWidth: '304px',
			offset: 14,
			closeOnClick: false,
			focusAfterOpen: false
		})
			.setLngLat([event.lngLat.lng, event.lngLat.lat])
			.setDOMContent(panel)
			.addTo(map);
		inspectionPopup = popup;
		inspectedSource = 'air-network';
		inspectedIslandId = selectedId;
		inspectedAirRouteId = routeId;
		inspectedAirNetwork = network;
		popup.on('close', () => {
			if (inspectionPopup !== popup) return;
			inspectionPopup = null;
			inspectedSource = null;
			inspectedIslandId = null;
			inspectedAirRouteId = '';
			inspectedAirNetwork = null;
		});
	}
	function inspectSeaRoute(
		feature: Feature & { source: string },
		event: { lngLat: { lng: number; lat: number } },
		presentationSummary?: NonNullable<PresentationMapScene['inspect']>['summary']
	) {
		if (!map || !makePopup) return;
		closeInspection();
		const props = feature.properties ?? {};
		const routeId = String(props.route_id ?? '');
		const route = seaState?.routes?.find((item) => item.id === routeId);
		const pressure = route?.pressure;
		const level = pressure?.level ?? String(props.pressure_level ?? 'unknown');
		const pressureLabel =
			level === 'low'
				? 'Low'
				: level === 'medium'
					? 'Moderate'
					: level === 'high'
						? 'High'
						: 'Unknown';
		const pressureColor =
			seaPressureColors[level as keyof typeof seaPressureColors] ?? seaPressureColors.unknown;
		const panel = document.createElement('section');
		panel.className = 'map-record-card map-network-route-card map-sea-route-card';
		panel.setAttribute('aria-label', 'Sea route');
		panel.dataset.seaRoute = routeId;
		const eyebrow = document.createElement('small');
		eyebrow.className = 'map-record-kind';
		eyebrow.textContent = presentationSummary
			? 'Illustrative ferry connection'
			: route?.route_code
				? `Ferry route · ${route.route_code}`
				: 'Ferry route';
		const title = document.createElement('h3');
		title.textContent =
			presentationSummary?.title ||
			route?.name ||
			String(props.name ?? props.route_name ?? 'Sea connection');
		const badge = document.createElement('span');
		badge.className = 'sea-route-pressure';
		badge.dataset.pressure = level;
		const dot = document.createElement('i');
		dot.style.backgroundColor = pressureColor;
		dot.setAttribute('aria-hidden', 'true');
		badge.append(
			dot,
			level === 'unknown' ? 'Pressure unknown' : `${pressureLabel} estimated pressure`
		);
		const summary = document.createElement('dl');
		summary.className = presentationSummary
			? 'sea-route-summary presentation-route-summary'
			: 'sea-route-summary';
		function row(list: HTMLDListElement, label: string, value: unknown) {
			if (value === undefined || value === null || value === '') return;
			const term = document.createElement('dt');
			term.textContent = label;
			const description = document.createElement('dd');
			description.textContent = String(value);
			list.append(term, description);
		}
		const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 0 });
		const weeklyDepartures = pressure?.departures_per_week ?? props.departures_per_week;
		const estimatedFrequency = pressure?.frequency_basis === 'published_headway_estimate';
		if (presentationSummary) {
			row(
				summary,
				presentationSummary.timingLabel ?? 'Estimated crossing',
				presentationSummary.minutes == null
					? 'Unavailable'
					: seaDuration(presentationSummary.minutes)
			);
			row(
				summary,
				presentationSummary.frequencyLabel ?? 'Source corridor sailings',
				presentationSummary.weeklySailings == null
					? 'Unavailable'
					: `${number(presentationSummary.weeklySailings)} sailings / week`
			);
		} else if (typeof weeklyDepartures === 'number' && Number.isFinite(weeklyDepartures))
			row(
				summary,
				estimatedFrequency ? 'Estimated service' : 'Published service',
				`${number(weeklyDepartures)} ${estimatedFrequency ? 'estimated ' : ''}sailings / week`
			);
		else if (route?.departure_count != null)
			row(summary, 'Selected date', `${number(route.departure_count)} published departures`);
		if (!presentationSummary)
			row(summary, 'Full-route crossing', seaDuration(route?.crossing_minutes));
		panel.append(eyebrow, title);
		if (!presentationSummary) panel.append(badge);
		panel.append(summary);
		if (presentationSummary) {
			const explanation = document.createElement('p');
			explanation.className = 'sea-route-presentation-qualification';
			explanation.textContent = presentationSummary.qualification;
			panel.append(explanation);
		}
		const details = document.createElement('details');
		details.className = 'sea-route-details';
		const toggle = document.createElement('summary');
		toggle.textContent = presentationSummary ? 'Source corridor details' : 'Route details';
		details.append(toggle);
		const evidence = document.createElement('dl');
		if (presentationSummary) row(evidence, 'Source corridor', route?.name);
		row(evidence, 'Operator', route?.operator);
		row(evidence, 'Week beginning', seaState?.serviceDate);
		if (pressure?.population != null)
			row(
				evidence,
				'Projected residents',
				`${number(pressure.population)} · ${pressure.population_year}`
			);
		if (pressure?.residents_per_weekly_departure != null)
			row(
				evidence,
				'Per weekly sailing',
				`${number(pressure.residents_per_weekly_departure)} residents`
			);
		if (
			pressure?.headway_min_minutes != null &&
			pressure.headway_max_minutes != null &&
			pressure.headway_min_minutes !== pressure.headway_max_minutes
		)
			row(
				evidence,
				'Published interval',
				`${seaDuration(pressure.headway_min_minutes)}–${seaDuration(pressure.headway_max_minutes)}`
			);
		else if (pressure?.headway_minutes != null)
			row(evidence, 'Published interval', seaDuration(pressure.headway_minutes));
		if (pressure?.capacity != null) {
			row(evidence, 'Published capacity', number(pressure.capacity));
			row(evidence, 'Capacity basis', pressure.capacity_basis);
		}
		row(evidence, 'Route geometry', 'Illustrative water route');
		row(
			evidence,
			'Vehicle position',
			route?.scheduled_sailings?.length
				? 'Approximate schedule position during a published sailing; representative position otherwise'
				: 'Representative position along the route'
		);
		details.append(evidence);
		const note = document.createElement('p');
		note.textContent =
			pressure?.explanation ||
			String(
				props.pressure_explanation ??
					'Population or published service frequency is unavailable for this route.'
			);
		details.append(note);
		const qualification = document.createElement('p');
		qualification.className = 'sea-route-qualification';
		qualification.textContent =
			'Low, moderate and high compare population per weekly departure across this network. Service totals derived from published intervals are estimates. Pressure does not measure passenger demand or onboard crowding. The water route is modeled around mapped shorelines; navigation conditions are unverified. Route positions may be estimated from retained dated sailings; receiver observations are shown separately.';
		details.append(qualification);
		if (route) {
			const status = document.createElement('p');
			status.textContent = seaRouteEvidenceLabel(route);
			details.append(status);
			if (route.stops.length) {
				const heading = document.createElement('strong');
				heading.className = 'sea-route-detail-heading';
				heading.textContent = `${route.stops.length} stops`;
				const stops = document.createElement('ol');
				stops.className = 'sea-route-stops';
				for (const stop of route.stops) {
					const item = document.createElement('li');
					item.textContent =
						stop.island_name && stop.island_name !== stop.name
							? `${stop.island_name} · ${stop.name}`
							: stop.name;
					stops.append(item);
				}
				details.append(heading, stops);
			}
			const departures = route.origin_departures ?? route.published_departures ?? route.departures;
			if (departures.length) {
				const times = document.createElement('p');
				times.textContent = `${route.origin_departures ? 'Selected-island departures' : 'Route-start departures'} · ${departures.map(seaClock).join(', ')}`;
				details.append(times);
			}
			for (const window of route.frequency_windows ?? []) {
				const interval = document.createElement('p');
				interval.textContent = `Published service window · ${window.label}: ${seaClock(window.start_minutes)}–${seaClock(window.end_minutes)}${window.headway_minutes ? ` · every ${seaDuration(window.headway_minutes)}` : ''}`;
				details.append(interval);
			}
			for (const text of new Set(route.qualifications)) {
				const item = document.createElement('p');
				item.className = 'sea-route-qualification';
				item.textContent = text;
				details.append(item);
			}
			const sources =
				seaState?.sources?.filter((source) => route.source_ids.includes(source.id)) ?? [];
			if (sources.length) {
				const list = document.createElement('div');
				list.className = 'sea-route-sources';
				for (const source of sources) {
					if (!source.url || !/^https?:\/\//i.test(source.url)) continue;
					const link = document.createElement('a');
					link.href = source.url;
					link.target = '_blank';
					link.rel = 'noopener noreferrer';
					link.textContent = source.title;
					list.append(link);
				}
				details.append(list);
			}
		}
		panel.append(details);
		if (onSeaSelect && !presentation) {
			const action = document.createElement('button');
			action.type = 'button';
			action.className = 'sea-route-open';
			action.textContent = 'Open connections';
			action.addEventListener('click', () => {
				closeInspection();
				onSeaSelect?.({ kind: 'route', id: routeId });
			});
			panel.append(action);
		}
		const popup = new makePopup({
			className: 'map-record-popup map-source-record-popup map-sea-route-popup',
			maxWidth: '304px',
			offset: 14,
			closeOnClick: false,
			focusAfterOpen: false
		})
			.setLngLat([event.lngLat.lng, event.lngLat.lat])
			.setDOMContent(panel)
			.addTo(map);
		inspectionPopup = popup;
		inspectedSource = 'sea-network';
		inspectedIslandId = selectedId;
		inspectedSeaRouteId = routeId;
		inspectedSeaFeatures = seaState?.features ?? null;
		popup.on('close', () => {
			if (inspectionPopup !== popup) return;
			inspectionPopup = null;
			inspectedSource = null;
			inspectedIslandId = null;
			inspectedSeaRouteId = '';
			inspectedSeaFeatures = null;
		});
	}
	function clearSearchPlace() {
		searchMarker?.remove();
		searchMarker = null;
		searchPopup?.remove();
		searchPopup = null;
		displayedSearchPlace = '';
	}

	function stopImpactFeedback() {
		feedbackGeneration++;
		cancelAnimationFrame(feedbackFrame);
		clearTimeout(feedbackTimer);
		removeFeedbackListener?.();
		removeFeedbackListener = undefined;
		feedbackCellCount = 0;
		if (!map?.getLayer('policy-feedback-fill')) return;
		map.setPaintProperty('policy-feedback-fill', 'fill-opacity-transition', { duration: 0 });
		map.setPaintProperty('policy-feedback-fill', 'fill-opacity', 0);
		map.setPaintProperty('policy-feedback-outline', 'line-opacity-transition', { duration: 0 });
		map.setPaintProperty('policy-feedback-outline', 'line-opacity', 0);
	}
	function showImpactFeedback(cells: FeatureCollection) {
		stopImpactFeedback();
		if (!map || !cells.features.length || overlayOpacity <= 0 || !shouldAnimateMotion()) return;
		const instance = map;
		const source = instance.getSource('policy-feedback') as GeoJSONSource;
		const generation = feedbackGeneration;
		feedbackCellCount = cells.features.length;
		instance.setPaintProperty('policy-feedback-fill', 'fill-opacity', overlayOpacity / 100);
		instance.setPaintProperty('policy-feedback-outline', 'line-opacity', 0.65);
		// Only this small changed-cell source is written, once. MapLibre interpolates constant
		// opacity uniforms over the already prepared before/after colours; no per-frame geometry.
		void source
			.setData(cells)
			.then(() => {
				if (map !== instance || generation !== feedbackGeneration) return;
				const reveal = () => {
					removeFeedbackListener = undefined;
					feedbackFrame = requestAnimationFrame(() => {
						if (map !== instance || generation !== feedbackGeneration) return;
						instance.setPaintProperty('policy-feedback-fill', 'fill-opacity-transition', {
							duration: 230
						});
						instance.setPaintProperty('policy-feedback-fill', 'fill-opacity', 0);
						feedbackTimer = setTimeout(() => {
							if (map !== instance || generation !== feedbackGeneration) return;
							instance.setPaintProperty('policy-feedback-outline', 'line-opacity-transition', {
								duration: 180
							});
							instance.setPaintProperty('policy-feedback-outline', 'line-opacity', 0);
							feedbackCellCount = 0;
						}, 850);
					});
				};
				instance.once('render', reveal);
				removeFeedbackListener = () => instance.off('render', reveal);
				instance.triggerRepaint();
			})
			.catch(() => {
				if (map === instance && generation === feedbackGeneration) stopImpactFeedback();
			});
	}

	function objectProperty(value: unknown): Record<string, unknown> {
		if (typeof value === 'string') {
			try {
				value = JSON.parse(value);
			} catch {
				return {};
			}
		}
		return value && typeof value === 'object' && !Array.isArray(value)
			? (value as Record<string, unknown>)
			: {};
	}

	function inspectFeature(
		feature: Feature & { source: string },
		event: { lngLat: { lng: number; lat: number } },
		searchResult?: SearchSelection
	) {
		if (!map || !makePopup) return;
		closeInspection();
		const props = feature.properties ?? {};
		const recordSource = String(props.record_source ?? feature.source);
		const panel = document.createElement('section');
		panel.className = 'map-record-card';
		panel.setAttribute('aria-label', 'Map source record');
		const eyebrow = document.createElement('small');
		eyebrow.className = 'map-record-kind';
		eyebrow.textContent = searchResult
			? String(searchResult.category ?? props.category ?? 'Search result').replaceAll('_', ' ')
			: recordSource === 'facilities'
				? String(props.category ?? 'Public facility').replaceAll('_', ' ')
				: recordSource === 'transport'
					? `${String(props.category ?? 'Transport place').replaceAll('_', ' ')} · stationary place`
					: ['live', 'live-vessels'].includes(feature.source)
						? 'Provider movement observation'
						: ['route', 'journey-stops'].includes(feature.source)
							? props.role
								? String(props.role)
								: props.mode
									? `${String(props.mode)} journey leg`
									: 'Journey point'
							: 'Proposed operation';
		const title = document.createElement('h3');
		title.textContent =
			searchResult?.name ||
			([
				props.name,
				props.route_name,
				props.label,
				props.mode ? `${String(props.mode).replaceAll('_', ' ')} section of your journey` : '',
				String(props.category ?? '').replaceAll('_', ' '),
				props.record_id,
				'Source record'
			]
				.map((value) => String(value ?? '').trim())
				.find(Boolean) ??
				'Source record');
		const details = document.createElement('dl');
		function row(label: string, value: unknown, code = false) {
			if (value === undefined || value === null || value === '') return;
			const term = document.createElement('dt');
			term.textContent = label;
			const description = document.createElement('dd');
			description.textContent = String(value);
			if (code) description.className = 'map-record-id';
			details.append(term, description);
		}
		const humanize = (value: unknown) =>
			typeof value === 'string' ? value.replaceAll('_', ' ') : value;
		row('Category', humanize(props.category));
		row('Route source IDs', props.route_ids, true);
		row('Timetable coverage', humanize(props.timetable_status));
		row('Location', props.location_method);
		row('Record ID', props.record_id ?? feature.id, true);
		row('Source', props.source ?? props.provider);
		row('Source record', props.source_record_id, true);
		row('Geometry source', props.geometry_source);
		row('Geometry quality', humanize(props.geometry_quality));
		row('Match status', humanize(props.match_status));
		row('OSM object', props.osm_object_id, true);
		if (typeof props.osm_match_score === 'number')
			row('Match score', `${Math.round(props.osm_match_score * 100)}%`);
		const review = objectProperty(props.mapping_review);
		row('Review decision', humanize(review.decision));
		row('Object type', humanize(props.object_type));
		const tags = objectProperty(props.tags);
		for (const key of ['amenity', 'public_transport', 'highway', 'aeroway'])
			row(humanize(key) as string, humanize(tags[key]));
		row('Observed', props.observed_at);
		row('Retrieved', props.retrieved_at);
		if (['live', 'live-vessels'].includes(feature.source)) {
			row(
				'Freshness',
				props.stale
					? 'Stale position · last known location'
					: props.observed_at
						? 'Provider observation'
						: 'Observation time unavailable'
			);
			row(
				'Bearing',
				typeof props.heading === 'number'
					? `${Math.round(props.heading)}° supplied by provider`
					: 'Unavailable'
			);
			row('Motion', 'Only received observations; no extrapolation');
			if (props.kind === 'vessel') {
				row('Vessel type', props.vessel_type ?? props.ship_type ?? 'Unavailable');
				row('Reported destination', props.destination);
				row('MMSI', props.mmsi, true);
				row('IMO', props.imo, true);
				row(
					'Speed',
					typeof props.speed_knots === 'number'
						? `${props.speed_knots} knots`
						: typeof props.sog === 'number'
							? `${props.sog} knots`
							: null
				);
				row('Passenger service', 'Service assignment unavailable');
			}
		}
		if (feature.source === 'route') row('Journey', props.status);
		if (feature.source === 'scenario') {
			row('Operation', props.index);
			row('Type', humanize(props.type));
			row('Target record', props.target_id, true);
			row('Geometry preview', props.geometry_preview);
		}
		row('Island ID', props.island_id, true);
		const coordinates: Coordinates = searchResult
			? searchResult.coordinates
			: feature.geometry.type === 'Point' && validCoordinates(feature.geometry.coordinates)
				? [feature.geometry.coordinates[0], feature.geometry.coordinates[1]]
				: [event.lngLat.lng, event.lngLat.lat];
		row(
			searchResult
				? 'Search location'
				: feature.geometry.type === 'Point'
					? 'Position'
					: 'Clicked location',
			coordinates.map((number) => number.toFixed(6)).join(', '),
			true
		);
		const evidence = document.createElement('details');
		const evidenceTitle = document.createElement('summary');
		evidenceTitle.textContent = 'Source details';
		evidence.append(evidenceTitle, details);
		panel.append(eyebrow, title);
		if (searchResult) {
			panel.dataset.searchPlace = searchResult.id;
			const source = props.source ?? props.provider;
			if (source) {
				const provenance = document.createElement('p');
				provenance.className = 'map-search-source';
				provenance.textContent = `Source: ${String(source)}`;
				panel.append(provenance);
			}
		}
		if (props.kind === 'vessel' && feature.source === 'live-vessels') {
			const assignment = document.createElement('p');
			assignment.textContent =
				'This is an observed boat position. Its passenger route is unverified. Use Sea connections to inspect published services and their connectivity.';
			panel.append(assignment);
		}
		if (feature.source === 'journey-stops') {
			const instruction = document.createElement('p');
			instruction.textContent = [
				props.route_names,
				props.departure ? `Departs ${props.departure}` : '',
				props.arrival ? `Arrives ${props.arrival}` : ''
			]
				.filter(Boolean)
				.join(' · ');
			panel.append(instruction);
		}
		if (props.route_names) {
			const routes = document.createElement('p');
			routes.textContent = `Routes serving this stop: ${String(props.route_names)}`;
			panel.append(routes);
		}
		if (searchResult || ['facilities', 'transport', 'pois', 'bus-stops'].includes(feature.source)) {
			panel.append(pointActions(coordinates, title.textContent));
		}
		panel.append(evidence);
		const popup = new makePopup({
			className: 'map-record-popup map-source-record-popup',
			maxWidth: '290px',
			offset: 12,
			closeOnClick: false,
			focusAfterOpen: false
		})
			.setLngLat(coordinates)
			.setDOMContent(panel)
			.addTo(map);
		inspectionPopup = popup;
		inspectedSource = recordSource;
		inspectedIslandId =
			searchResult || feature.source === 'bus-stops'
				? selectedId
				: props.island_id
					? String(props.island_id)
					: null;
		popup.on('close', () => {
			if (searchPopup === popup) searchPopup = null;
			if (inspectionPopup === popup) {
				inspectionPopup = null;
				inspectedSource = null;
				inspectedIslandId = null;
			}
		});
	}
	function showSearchPlace(selection: SearchSelection) {
		if (!map || !makeMarker || !makePopup) return;
		clearSearchPlace();
		const properties = selection.feature?.properties ?? {};
		const sourceFeature: Feature = selection.feature ?? {
			type: 'Feature',
			properties: {},
			geometry: { type: 'Point', coordinates: selection.coordinates }
		};
		const feature: Feature & { source: string } = {
			...sourceFeature,
			properties: {
				...properties,
				category: selection.category ?? properties.category,
				name: selection.name
			},
			source: String(properties.record_source ?? 'search')
		};
		const open = () => {
			inspectFeature(
				feature,
				{ lngLat: { lng: selection.coordinates[0], lat: selection.coordinates[1] } },
				selection
			);
			searchPopup = inspectionPopup;
		};
		const pin = document.createElement('button');
		pin.type = 'button';
		pin.className = 'map-search-pin';
		pin.setAttribute('aria-label', `Show ${selection.name}`);
		pin.title = selection.name;
		pin.dataset.searchMarker = selection.id;
		pin.addEventListener('click', (event) => {
			event.stopPropagation();
			open();
		});
		searchMarker = new makeMarker({ element: pin, anchor: 'bottom', offset: [0, -3] })
			.setLngLat(selection.coordinates)
			.addTo(map);
		displayedSearchPlace = selection.id;
		open();
	}

	function pointActions(coordinates: Coordinates, name: string): HTMLElement {
		const actions = document.createElement('div');
		actions.className = 'map-point-actions';
		if (onroutepoint)
			for (const endpoint of ['start', 'end'] as const) {
				const button = document.createElement('button');
				button.type = 'button';
				button.textContent =
					endpoint === 'start' ? 'A · Start here' : `${directionDestinationLetter} · End here`;
				button.addEventListener('click', () => {
					closeInspection();
					onroutepoint?.(coordinates, endpoint, name);
				});
				actions.append(button);
			}
		if (onplanpoint) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'point-proposal-action';
			button.textContent = 'Create proposal here';
			button.addEventListener('click', () => {
				closeInspection();
				onplanpoint?.(coordinates);
			});
			actions.append(button);
		}
		return actions;
	}
	function inspectProposedService(feature: MapGeoJSONFeature, event: MapMouseEvent) {
		if (!map || !makePopup) return;
		closeInspection();
		const props = feature.properties;
		const panel = document.createElement('section');
		panel.className = 'map-record-card';
		panel.setAttribute('aria-label', 'Proposed transport service');
		const eyebrow = document.createElement('small');
		eyebrow.className = 'map-record-kind';
		eyebrow.textContent = props.mode === 'bus' ? 'Proposed bus service' : 'Proposed ferry service';
		const title = document.createElement('h3');
		title.textContent = String(props.route_name ?? props.name ?? 'Your proposed service');
		const details = document.createElement('dl');
		function row(label: string, value: unknown) {
			if (value === undefined || value === null || value === '') return;
			const term = document.createElement('dt');
			term.textContent = label;
			const description = document.createElement('dd');
			description.textContent = String(value);
			details.append(term, description);
		}
		const direction = [props.origin_name, props.destination_name].filter(Boolean).join(' → ');
		row('Connection', direction);
		if (Number.isFinite(Number(props.headway_minutes)) && Number(props.headway_minutes) > 0)
			row('Departures', `Every ${Number(props.headway_minutes)} minutes`);
		row('Service date', props.service_date);
		if (Number.isFinite(Number(props.travel_minutes)) && Number(props.travel_minutes) > 0)
			row('Journey time', `${Math.round(Number(props.travel_minutes))} minutes`);
		panel.append(eyebrow, title, details);
		const note = document.createElement('p');
		note.textContent =
			'Part of your draft proposal. Review its costs and access improvements before saving.';
		panel.append(note);
		if (onfocusproposal) {
			const actions = document.createElement('div');
			actions.className = 'map-point-actions';
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'point-proposal-action';
			button.textContent = 'View proposal';
			button.addEventListener('click', () => {
				closeInspection();
				onfocusproposal?.(
					Number.isInteger(props.operation_index) ? Number(props.operation_index) : 0
				);
			});
			actions.append(button);
			panel.append(actions);
		}
		const coordinates: Coordinates =
			feature.geometry.type === 'Point' && validCoordinates(feature.geometry.coordinates)
				? feature.geometry.coordinates
				: [event.lngLat.lng, event.lngLat.lat];
		const popup = new makePopup({
			className: 'map-record-popup map-source-record-popup',
			maxWidth: '304px',
			offset: 14,
			closeOnClick: false,
			focusAfterOpen: false
		})
			.setLngLat(coordinates)
			.setDOMContent(panel)
			.addTo(map);
		inspectionPopup = popup;
		inspectedSource = 'policy-service';
		popup.on('close', () => {
			if (inspectionPopup === popup) {
				inspectionPopup = null;
				inspectedSource = null;
			}
		});
	}
	function inspectLocation(coordinates: Coordinates) {
		if (!map || !makePopup || (!onplanpoint && !directionPoints?.length)) return;
		closeInspection();
		const panel = document.createElement('section');
		panel.className = 'map-record-card';
		panel.setAttribute('aria-label', 'Selected map location');
		const title = document.createElement('h3');
		title.textContent = 'What would you like to do here?';
		const hint = document.createElement('p');
		hint.textContent = onplanpoint
			? 'Use this location for a journey or a new proposal.'
			: 'Use this location as a journey start or destination.';
		panel.append(title, hint, pointActions(coordinates, 'Selected on map'));
		const cancel = document.createElement('button');
		cancel.type = 'button';
		cancel.className = 'map-location-cancel';
		cancel.textContent = 'Cancel';
		cancel.addEventListener('click', closeInspection);
		panel.append(cancel);
		inspectionPopup = new makePopup({
			className: 'map-record-popup',
			maxWidth: '290px',
			offset: 12,
			closeOnClick: false,
			focusAfterOpen: false
		})
			.setLngLat(coordinates)
			.setDOMContent(panel)
			.addTo(map);
		inspectedIslandId = selectedId;
	}
	function inspectJourneyEndpoint(
		endpoint: 'start' | 'end',
		coordinates: Coordinates,
		letter = endpoint === 'start' ? 'A' : 'B',
		name?: string
	) {
		if (!map || !makePopup) return;
		closeInspection();
		const panel = document.createElement('section');
		panel.className = 'map-record-card';
		const title = document.createElement('h3');
		title.textContent = `${letter} · ${name || (endpoint === 'start' ? 'Journey start' : 'Journey destination')}`;
		const hint = document.createElement('p');
		hint.textContent = onroutepoint
			? 'Drag this pin to adjust it, or choose an action below.'
			: endpoint === 'start'
				? 'Journey start.'
				: 'Journey destination.';
		const actions = document.createElement('div');
		actions.className = 'map-point-actions';
		const move = document.createElement('button');
		move.type = 'button';
		move.textContent = 'Choose another point';
		move.addEventListener('click', () => {
			closeInspection();
			onmovejourneypoint?.(endpoint);
		});
		if (onmovejourneypoint) actions.append(move);
		if (onclearjourneypoint) {
			const remove = document.createElement('button');
			remove.type = 'button';
			remove.textContent = 'Remove point';
			remove.addEventListener('click', () => {
				closeInspection();
				onclearjourneypoint?.(endpoint);
			});
			actions.append(remove);
		}
		panel.append(title, hint, actions);
		inspectionPopup = new makePopup({
			className: 'map-record-popup',
			maxWidth: '290px',
			offset: 16,
			closeOnClick: false,
			focusAfterOpen: true
		})
			.setLngLat(coordinates)
			.setDOMContent(panel)
			.addTo(map);
		inspectedSource = 'route';
		inspectedIslandId = selectedId;
	}
	function inspectDirectionWaypoint(point: DirectionWaypoint) {
		if (point.role !== 'via') {
			inspectJourneyEndpoint(point.role, point.coordinates, point.letter, point.name);
			return;
		}
		if (!map || !makePopup) return;
		closeInspection();
		const panel = document.createElement('section');
		panel.className = 'map-record-card';
		const title = document.createElement('h3');
		title.textContent = `${point.letter} · ${point.name || 'Journey stop'}`;
		const hint = document.createElement('p');
		hint.textContent = 'Via point · change or remove this stop in directions.';
		panel.append(title, hint);
		inspectionPopup = new makePopup({
			className: 'map-record-popup',
			maxWidth: '290px',
			offset: 16,
			closeOnClick: false,
			focusAfterOpen: true
		})
			.setLngLat(point.coordinates)
			.setDOMContent(panel)
			.addTo(map);
		inspectedSource = 'route';
		inspectedIslandId = selectedId;
	}
	function clearDirectionMarkers() {
		for (const [key, marker] of Object.entries(directionMarkers)) {
			marker.remove();
			delete directionMarkers[key];
		}
	}
	function syncDirectionMarkers() {
		if (!map || !makeMarker) return;
		const retained = new SvelteSet<string>();
		for (const point of directionWaypoints) {
			const key = `${point.index}:${point.id}`;
			retained.add(key);
			let marker = directionMarkers[key];
			if (!marker) {
				const element = document.createElement('button');
				element.type = 'button';
				marker = new makeMarker({ element }).setLngLat(point.coordinates).addTo(map);
				const current = marker;
				let lastDragged = 0;
				marker.on('dragend', () => {
					lastDragged = performance.now();
					const waypoint = directionWaypoints.find((item) => `${item.index}:${item.id}` === key);
					if (!waypoint || waypoint.role === 'via') return;
					const coordinates = current.getLngLat();
					onroutepoint?.(
						[coordinates.lng, coordinates.lat],
						waypoint.role,
						'Adjusted on map',
						false
					);
				});
				element.addEventListener('click', (event) => {
					event.stopPropagation();
					if (performance.now() - lastDragged < 200) return;
					const waypoint = directionWaypoints.find((item) => `${item.index}:${item.id}` === key);
					if (waypoint) inspectDirectionWaypoint(waypoint);
				});
				element.addEventListener('keydown', (event) => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault();
						event.stopPropagation();
						const waypoint = directionWaypoints.find((item) => `${item.index}:${item.id}` === key);
						if (waypoint) inspectDirectionWaypoint(waypoint);
					}
				});
				directionMarkers[key] = marker;
			}
			marker.setLngLat(point.coordinates);
			const draggable = point.role !== 'via' && !!onroutepoint;
			marker.setDraggable(draggable);
			const element = marker.getElement();
			element.classList.add('journey-drag-pin', 'journey-waypoint-pin');
			for (const role of ['start', 'via', 'end'])
				element.classList.toggle(role, role === point.role);
			element.classList.toggle('static', !draggable);
			element.textContent = point.letter;
			element.dataset.directionPoint = point.id;
			element.dataset.directionIndex = String(point.index);
			element.dataset.directionLabel = point.letter;
			element.title = point.name || 'Journey point';
			element.setAttribute(
				'aria-label',
				`${point.letter} · ${point.name || 'Journey point'}. ${point.role === 'via' ? 'Via point' : point.role === 'start' ? 'Journey start' : 'Journey destination'}. ${draggable ? 'Drag to move, or select for actions.' : 'Select for details.'}`
			);
		}
		for (const [key, marker] of Object.entries(directionMarkers)) {
			if (!retained.has(key)) {
				marker.remove();
				delete directionMarkers[key];
			}
		}
	}
	function syncJourneyMarkers() {
		if (!map || !makeMarker) return;
		if (inlineDirectionsActive || !onroutepoint) {
			for (const endpoint of ['start', 'end'] as const) {
				journeyMarkers[endpoint]?.remove();
				delete journeyMarkers[endpoint];
			}
			if (inlineDirectionsActive) syncDirectionMarkers();
			else clearDirectionMarkers();
			return;
		}
		clearDirectionMarkers();
		for (const endpoint of ['start', 'end'] as const) {
			const coordinates = endpoint === 'start' ? routeStart : routeEnd;
			if (!coordinates) {
				journeyMarkers[endpoint]?.remove();
				delete journeyMarkers[endpoint];
				continue;
			}
			let marker = journeyMarkers[endpoint];
			if (!marker) {
				const element = document.createElement('button');
				element.type = 'button';
				element.className = `journey-drag-pin ${endpoint}`;
				element.textContent = endpoint === 'start' ? 'A' : 'B';
				element.setAttribute(
					'aria-label',
					`Journey ${endpoint}. Drag to move, or select for move and remove actions.`
				);
				marker = new makeMarker({ element, draggable: true }).setLngLat(coordinates).addTo(map);
				const current = marker;
				let lastDragged = 0;
				marker.on('dragend', () => {
					lastDragged = performance.now();
					const point = current.getLngLat();
					onroutepoint?.([point.lng, point.lat], endpoint, 'Adjusted on map', false);
				});
				element.addEventListener('click', (event) => {
					event.stopPropagation();
					if (performance.now() - lastDragged < 200) return;
					const point = current.getLngLat();
					inspectJourneyEndpoint(endpoint, [point.lng, point.lat]);
				});
				element.addEventListener('keydown', (event) => {
					if (event.key === 'Enter' || event.key === ' ') {
						event.preventDefault();
						inspectJourneyEndpoint(endpoint, [current.getLngLat().lng, current.getLngLat().lat]);
					}
				});
				journeyMarkers[endpoint] = marker;
			} else marker.setLngLat(coordinates);
		}
	}

	function updatePlacementAnchor() {
		if (!map || !active || !pendingProposal) {
			placementAnchor = null;
			return;
		}
		const marker = policyMarkers.get(-1);
		const point = map.project(marker?.getLngLat() ?? pendingProposal.coordinates);
		const width = container.clientWidth;
		const height = container.clientHeight;
		if (point.x < -40 || point.x > width + 40 || point.y < -40 || point.y > height + 40) {
			placementAnchor = null;
			return;
		}
		let right = width - 12;
		let bottom = height - 12;
		const panels = container
			.closest('.map-workspace')
			?.querySelectorAll('.policy-map-panel, .proposal-floating-budget');
		for (const panel of panels ?? []) {
			if (!(panel instanceof HTMLElement) || !panel.offsetHeight) continue;
			const mapBounds = container.getBoundingClientRect();
			const panelBounds = panel.getBoundingClientRect();
			if (panelBounds.width < width * 0.65 && panelBounds.left > mapBounds.left + width / 2) {
				right = Math.min(right, panelBounds.left - mapBounds.left - 12);
			} else if (panelBounds.width > width * 0.65 && panelBounds.top > mapBounds.top) {
				bottom = Math.min(bottom, panelBounds.top - mapBounds.top - 12);
			}
		}
		const cardWidth = Math.min(288, right - 12);
		const top = width < 700 ? Math.min(178, height * 0.24) : Math.min(112, height * 0.16);
		// Keep the pin visible; the decision can scroll on a short screen.
		const maxHeight = Math.max(180, bottom - top - (width < 700 ? 68 : 0));
		const cardHeight = Math.min(placementCard?.offsetHeight || 300, maxHeight);
		const x = Math.max(cardWidth / 2 + 12, Math.min(right - cardWidth / 2, point.x));
		const below = point.y - 60 - cardHeight < top;
		placementAnchor = {
			x,
			y: below
				? Math.max(top, Math.min(bottom - cardHeight, point.y + 16))
				: Math.max(cardHeight + top, Math.min(bottom, point.y - 60)),
			below,
			arrow: Math.max(18, Math.min(cardWidth - 18, cardWidth / 2 + point.x - x)),
			width: cardWidth,
			maxHeight
		};
	}
	function schedulePlacementAnchor() {
		if (
			(!pendingProposal && selectedProposalIndex === null && !serviceEditor) ||
			placementPositionFrame
		)
			return;
		placementPositionFrame = requestAnimationFrame(() => {
			placementPositionFrame = 0;
			updatePlacementAnchor();
			updateProposalEditAnchor();
			updateServiceAnchor();
		});
	}
	function serviceViewport() {
		const width = container.clientWidth;
		const height = container.clientHeight;
		const mapBounds = container.getBoundingClientRect();
		let right = width - 12;
		let top = width < 700 ? Math.min(178, height * 0.24) : Math.min(108, height * 0.16);
		let bottom = height - 80;
		for (const panel of container
			.closest('.map-workspace')
			?.querySelectorAll('.policy-map-panel, .proposal-floating-budget') ?? []) {
			if (!(panel instanceof HTMLElement) || !panel.offsetHeight) continue;
			const bounds = panel.getBoundingClientRect();
			if (bounds.width < width * 0.65 && bounds.left > mapBounds.left + width / 2)
				right = Math.min(right, bounds.left - mapBounds.left - 12);
			else if (bounds.width > width * 0.65 && bounds.top > mapBounds.top) {
				if (bounds.top - mapBounds.top < height * 0.45)
					top = Math.max(top, bounds.bottom - mapBounds.top + 12);
				else bottom = Math.min(bottom, bounds.top - mapBounds.top - 12);
			}
		}
		return { right, top, bottom };
	}
	function updateServiceAnchor() {
		if (!map || !active || !serviceEditor || !validCoordinates(serviceEditor.coordinates)) {
			serviceAnchor = null;
			return;
		}
		const point = map.project(serviceEditor.coordinates);
		const viewport = serviceViewport();
		if (
			point.x < -40 ||
			point.x > container.clientWidth + 40 ||
			point.y < -40 ||
			point.y > container.clientHeight + 40
		) {
			serviceAnchor = null;
			return;
		}
		const width = Math.min(352, Math.max(240, viewport.right - 24));
		// Phone editors share the screen with the route; long forms scroll inside the card.
		const maxHeight = serviceCardMaxHeight(container.clientWidth, viewport.top, viewport.bottom);
		const height = Math.min(serviceCard?.offsetHeight || 360, maxHeight);
		// Keep the route above its editor on phones instead of covering its destination.
		if (container.clientWidth < 700) {
			const x = container.clientWidth / 2;
			serviceAnchor = {
				x,
				y: viewport.bottom - height,
				below: true,
				width,
				maxHeight,
				side: null,
				arrowY: 0,
				arrow: Math.max(20, Math.min(width - 20, width / 2 + point.x - x))
			};
			return;
		}
		// On a wide map the route should stay visible beside its editor.
		const mode = serviceEditor.mode === 'ferry' ? 'ferry' : 'bus';
		const destination = policyServiceFeatures.features.find(
			(feature) =>
				feature.geometry.type === 'Point' &&
				feature.properties?.role === 'destination' &&
				feature.properties?.mode === mode &&
				!feature.properties?.accepted
		);
		const destinationX =
			destination?.geometry.type === 'Point' && validCoordinates(destination.geometry.coordinates)
				? map.project(destination.geometry.coordinates).x
				: null;
		const preferredSide = destinationX !== null && destinationX > point.x + 1 ? 'left' : 'right';
		const available = {
			left: point.x - width - 40 >= 12,
			right: point.x + width + 40 <= viewport.right
		};
		const alternativeSide = preferredSide === 'left' ? 'right' : 'left';
		const side =
			container.clientWidth >= 900
				? available[preferredSide]
					? preferredSide
					: available[alternativeSide]
						? alternativeSide
						: null
				: null;
		if (side) {
			const y = Math.max(viewport.top, Math.min(viewport.bottom - height, point.y - 96));
			serviceAnchor = {
				x: point.x + (side === 'right' ? 1 : -1) * (width / 2 + 40),
				y,
				below: true,
				width,
				maxHeight,
				side,
				arrow: width / 2,
				arrowY: Math.max(20, Math.min(height - 20, point.y - y))
			};
			return;
		}
		const below = point.y - 62 - height < viewport.top;
		const x = Math.max(width / 2 + 12, Math.min(viewport.right - width / 2, point.x));
		serviceAnchor = {
			x,
			y: below
				? Math.max(viewport.top, Math.min(viewport.bottom - height, point.y + 14))
				: Math.max(viewport.top + height, Math.min(viewport.bottom, point.y - 62)),
			below,
			width,
			maxHeight,
			side: null,
			arrowY: 0,
			arrow: Math.max(20, Math.min(width - 20, width / 2 + point.x - x))
		};
	}
	function syncServiceMarker() {
		if (
			!map ||
			!makeMarker ||
			!active ||
			!serviceEditor ||
			!validCoordinates(serviceEditor.coordinates) ||
			(serviceEditor.mode === 'bus-connection' && pendingProposal)
		) {
			serviceMarker?.remove();
			serviceMarker = null;
			return;
		}
		const kind = serviceEditor.mode === 'ferry' ? 'ferry' : 'bus';
		if (!serviceMarker) {
			const element = document.createElement('button');
			element.type = 'button';
			element.className = 'policy-service-marker';
			element.addEventListener('click', (event) => {
				event.stopPropagation();
				updateServiceAnchor();
				serviceCard
					?.querySelector<HTMLElement>('button, input, select')
					?.focus({ preventScroll: true });
			});
			serviceMarker = new makeMarker({ element, anchor: 'bottom' })
				.setLngLat(serviceEditor.coordinates)
				.addTo(map);
		}
		serviceMarker.setLngLat(serviceEditor.coordinates);
		const element = serviceMarker.getElement();
		element.dataset.kind = kind;
		element.dataset.longitude = String(serviceEditor.coordinates[0]);
		element.dataset.latitude = String(serviceEditor.coordinates[1]);
		element.setAttribute('aria-label', serviceEditor.title ?? `Edit proposed ${kind} service`);
		if (element.dataset.symbol !== kind) {
			const path =
				kind === 'ferry'
					? '<path d="M8 2h8v4h3v8l3 1-3 5-7 2-7-2-3-5 3-1V6h3V2Zm2 2v2h4V4h-4ZM7 8v5l5-2 5 2V8H7ZM5 16l2 3 5 1 5-1 2-3-7-3-7 3Z"/>'
					: '<path d="M6 3h12c2 0 3 2 3 4v11h-2v3h-3v-3H8v3H5v-3H3V7c0-2 1-4 3-4Zm0 3v6h12V6H6Zm1 8a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm10 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"/>';
			element.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
			element.dataset.symbol = kind;
		}
	}
	function updateProposalEditAnchor() {
		if (!map || !active || !validCoordinates(selectedProposal?.coordinates) || pendingProposal) {
			proposalEditAnchor = null;
			return;
		}
		const point = map.project(selectedProposal.coordinates);
		const width = container.clientWidth;
		const height = container.clientHeight;
		if (point.x < 0 || point.x > width || point.y < 0 || point.y > height) {
			proposalEditAnchor = null;
			return;
		}
		const cardHeight = proposalEditCard?.offsetHeight || 135;
		const mapBounds = container.getBoundingClientRect();
		let right = width - 12;
		let top = width < 700 ? Math.min(178, height * 0.24) : Math.min(112, height * 0.16);
		let bottom = height - 82;
		const panels = container
			.closest('.map-workspace')
			?.querySelectorAll('.policy-map-panel, .proposal-floating-budget');
		for (const panel of panels ?? []) {
			if (!(panel instanceof HTMLElement) || !panel.offsetHeight) continue;
			const bounds = panel.getBoundingClientRect();
			if (bounds.width < width * 0.65 && bounds.left > mapBounds.left + width / 2)
				right = Math.min(right, bounds.left - mapBounds.left - 12);
			else if (bounds.width > width * 0.65 && bounds.top > mapBounds.top) {
				if (
					panel.matches('.proposal-floating-budget') &&
					bounds.top - mapBounds.top < height * 0.45
				)
					top = Math.max(top, bounds.bottom - mapBounds.top + 12);
				else bottom = Math.min(bottom, bounds.top - mapBounds.top - 12);
			}
		}
		const below = point.y - 56 - cardHeight < top;
		const x = Math.max(138, Math.min(right - 126, point.x));
		proposalEditAnchor = {
			x,
			y: below
				? Math.max(top, Math.min(bottom - cardHeight, point.y + 12))
				: Math.max(top + cardHeight, Math.min(bottom, point.y - 56)),
			below,
			arrow: Math.max(18, Math.min(234, 126 + point.x - x))
		};
	}
	function keepPlacementVisible() {
		if (!map || !pendingProposal) return;
		const mapBounds = container.getBoundingClientRect();
		let right = container.clientWidth - 44;
		let bottom = container.clientHeight - 86;
		for (const element of container
			.closest('.map-workspace')
			?.querySelectorAll('.policy-map-panel, .proposal-floating-budget') ?? []) {
			if (!(element instanceof HTMLElement) || !element.offsetHeight) continue;
			const bounds = element.getBoundingClientRect();
			if (
				bounds.width < container.clientWidth * 0.65 &&
				bounds.left > mapBounds.left + container.clientWidth / 2
			)
				right = Math.min(right, bounds.left - mapBounds.left - 44);
			else if (bounds.width > container.clientWidth * 0.65 && bounds.top > mapBounds.top)
				bottom = Math.min(bottom, bounds.top - mapBounds.top - 44);
		}
		const point = map.project(pendingProposal.coordinates);
		const left = Math.min(150, right / 2);
		const mobile = container.clientWidth < 700;
		const cardHeight = placementCard?.offsetHeight || (mobile ? 370 : 300);
		const top = mobile ? Math.min(224, bottom - 180) : Math.min(185, bottom / 2);
		const x = Math.max(left, Math.min(right, point.x));
		const decisionBottom = bottom - 16 - cardHeight;
		const y = mobile
			? Math.max(top, Math.min(decisionBottom, point.y))
			: Math.max(top, Math.min(bottom, point.y));
		if (Math.abs(point.x - x) > 1 || Math.abs(point.y - y) > 1)
			map.panBy([point.x - x, point.y - y], { duration: reducedMotion() ? 0 : 180 });
	}
	function keepAcceptedPointVisible(coordinates: Coordinates) {
		if (!map || !active || presentation || pendingProposal) return;
		const mapBounds = container.getBoundingClientRect();
		const width = container.clientWidth;
		const height = container.clientHeight;
		let right = width - 48;
		let top = width < 700 ? 184 : 130;
		let bottom = height - (width < 700 ? 180 : 100);
		for (const element of container
			.closest('.map-workspace')
			?.querySelectorAll('.policy-map-panel, .proposal-floating-budget') ?? []) {
			if (!(element instanceof HTMLElement) || !element.offsetHeight) continue;
			const bounds = element.getBoundingClientRect();
			if (bounds.width < width * 0.65 && bounds.left > mapBounds.left + width / 2)
				right = Math.min(right, bounds.left - mapBounds.left - 40);
			else if (bounds.width > width * 0.65) {
				if (bounds.top - mapBounds.top < height * 0.45)
					top = Math.max(top, bounds.bottom - mapBounds.top + 58);
				else bottom = Math.min(bottom, bounds.top - mapBounds.top - 28);
			}
		}
		if (bottom < top) return;
		const point = map.project(coordinates);
		const x = Math.max(Math.min(72, right / 2), Math.min(right, point.x));
		const y = Math.max(top, Math.min(bottom, point.y));
		if (Math.abs(point.x - x) > 1 || Math.abs(point.y - y) > 1)
			map.panBy([point.x - x, point.y - y], { duration: reducedMotion() ? 0 : 180 });
	}
	function editSelectedProposal(action: 'move' | 'duplicate' | 'remove') {
		if (presentation || selectedProposalIndex === null) return;
		const index = selectedProposalIndex;
		selectedProposalIndex = null;
		oneditproposal?.(index, action);
	}
	function placementCoordinates(coordinates: Coordinates, kind: PlacementKind): Coordinates {
		if (kind !== 'add_stop') return coordinates;
		const candidate = nearestPlacementRoad(coordinates, placementRoads).coordinates;
		return selectedId && pointWithinIsland(candidate, features, selectedId) === true
			? candidate
			: coordinates;
	}
	function updatePlacementPreview() {
		if (!map || !ready || !active || (!pendingProposal && (!picking || !placementKind))) {
			placementPreview = null;
			return;
		}
		const center = previewPointer ?? {
			x: container.clientWidth / 2,
			y: container.clientHeight / 2
		};
		const location = map.unproject([center.x, center.y]);
		const markerPoint = pendingProposal ? policyMarkers.get(-1)?.getLngLat() : null;
		const raw: Coordinates = markerPoint
			? [markerPoint.lng, markerPoint.lat]
			: (pendingProposal?.coordinates ?? [location.lng, location.lat]);
		const kind = pendingProposal?.kind ?? placementKind!;
		const snapped = kind === 'add_stop' ? nearestPlacementRoad(raw, placementRoads) : null;
		const snapAllowed =
			!!snapped?.snapped &&
			!!selectedId &&
			pointWithinIsland(snapped.coordinates, features, selectedId) === true;
		const coordinates = snapAllowed ? snapped!.coordinates : raw;
		const point = map.project(coordinates);
		const north = map.project([coordinates[0], coordinates[1] + 400 / 111320]);
		placementPreview = {
			x: point.x,
			y: point.y,
			radius: Math.max(5, Math.min(1600, Math.abs(point.y - north.y))),
			coordinates,
			snapped: snapAllowed,
			distance: snapped?.distance ?? null,
			suitable: snapAllowed
				? true
				: selectedId
					? pointWithinIsland(coordinates, features, selectedId)
					: null
		};
	}
	function schedulePlacementPreview() {
		if ((!pendingProposal && (!picking || !placementKind)) || placementPreviewFrame) return;
		placementPreviewFrame = requestAnimationFrame(() => {
			placementPreviewFrame = 0;
			updatePlacementPreview();
		});
	}
	function focusPlacementDecision() {
		const card = serviceEditor?.mode === 'bus-connection' ? serviceCard : placementCard;
		card?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({
			preventScroll: true
		});
	}
	function syncPolicyMarkers() {
		if (!map || !makeMarker) return;
		const entries = policyOperations.flatMap((operation, index) =>
			validCoordinates(operation.coordinates)
				? [
						{
							index,
							coordinates: operation.coordinates,
							kind: operation.type,
							name: operation.name ?? 'Proposed change',
							locked: !!operation.metadata?.ui_preview || !!operation.metadata?.ui_package
						}
					]
				: []
		);
		if (pendingProposal)
			entries.push({
				index: -1,
				coordinates: pendingProposal.coordinates,
				kind: pendingProposal.kind,
				name: 'Unconfirmed location',
				locked: false
			});
		const keep = new Set(entries.map((entry) => entry.index));
		for (const [index, marker] of policyMarkers)
			if (!keep.has(index)) {
				marker.remove();
				policyMarkers.delete(index);
			}
		for (const entry of entries) {
			let marker = policyMarkers.get(entry.index);
			if (!marker) {
				const element = document.createElement('button');
				element.type = 'button';
				let lastDragged = 0;
				element.addEventListener('click', (event) => {
					event.stopPropagation();
					if (presentation) return;
					if (performance.now() - lastDragged < 200) return;
					if (entry.index === -1) focusPlacementDecision();
					else if (oneditproposal) {
						selectedProposalIndex = entry.index;
						closeInspection();
						void tick().then(() => {
							updateProposalEditAnchor();
							proposalEditCard
								?.querySelector<HTMLButtonElement>('button')
								?.focus({ preventScroll: true });
						});
					} else onfocusproposal?.(entry.index);
				});
				marker = new makeMarker({
					element,
					draggable: !presentation && !entry.locked,
					anchor: 'bottom'
				})
					.setLngLat(entry.coordinates)
					.addTo(map);
				const current = marker;
				marker.on('dragstart', () => {
					if (presentation) return;
					closeInspection();
					selectedProposalIndex = null;
					element.classList.add('is-dragging');
					if (entry.index === -1) placementDragging = true;
				});
				marker.on('drag', () => {
					if (presentation) return;
					if (entry.index === -1) {
						schedulePlacementAnchor();
						schedulePlacementPreview();
					}
				});
				marker.on('dragend', () => {
					lastDragged = performance.now();
					element.classList.remove('is-dragging');
					if (entry.index === -1) placementDragging = false;
					if (presentation) return;
					const point: Coordinates = [current.getLngLat().lng, current.getLngLat().lat];
					const kind =
						entry.index === -1 ? pendingProposal?.kind : policyOperations[entry.index]?.type;
					onmoveproposal?.(
						entry.index,
						kind && ['add_stop', 'add_school', 'add_hospital'].includes(kind)
							? placementCoordinates(point, kind as PlacementKind)
							: point
					);
					schedulePlacementAnchor();
				});
				policyMarkers.set(entry.index, marker);
			}
			marker.setDraggable(!presentation && !entry.locked);
			const location = marker.getLngLat();
			if (location.lng !== entry.coordinates[0] || location.lat !== entry.coordinates[1])
				marker.setLngLat(entry.coordinates);
			const element = marker.getElement();
			element.setAttribute('aria-disabled', String(!!presentation));
			element.tabIndex = presentation ? -1 : 0;
			element.style.pointerEvents = presentation ? 'none' : '';
			// Keep MapLibre's marker classes and the active drag state when updating a draft.
			element.classList.add('policy-proposal-marker');
			element.classList.toggle('pending', entry.index === -1);
			element.classList.toggle('confirmed', entry.index !== -1);
			element.dataset.kind = entry.kind;
			element.dataset.longitude = String(entry.coordinates[0]);
			element.dataset.latitude = String(entry.coordinates[1]);
			element.dataset.operationIndex = String(entry.index);
			element.setAttribute(
				'aria-label',
				presentation
					? entry.name
					: `${entry.index === -1 ? placementTitle : entry.name}${entry.locked ? '. Part of a routed service package. Select to remove the service; regenerate it to change its route.' : '. Drag to move, or select for move, duplicate and remove actions.'}${entry.index === -1 ? ' Confirm or cancel above this pin.' : ''}`
			);
			element.title = element.getAttribute('aria-label')!;
			const symbol =
				entry.kind === 'add_hospital'
					? '<path d="M8 3h8v5h5v13H3V8h5V3Zm2 3v3H7v3h3v3h3v-3h3V9h-3V6h-3Z"/>'
					: entry.kind === 'add_school'
						? '<path d="m2 9 10-5 10 5-10 5L2 9Zm4 4v5c4 3 8 3 12 0v-5l-6 3-6-3Zm15-2v7h1v-7h-1Z"/>'
						: '<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M12 13v8M12 3v3M2.354 10.354a1.207 1.207 0 0 1 0-1.708l2.06-2.06A2 2 0 0 1 5.828 6h12.344a2 2 0 0 1 1.414.586l2.06 2.06a1.207 1.207 0 0 1 0 1.708l-2.06 2.06a2 2 0 0 1-1.414.586H5.828a2 2 0 0 1-1.414-.586z"/>';
			const symbolKey = `${entry.kind}:${entry.index}`;
			if (element.dataset.symbol !== symbolKey) {
				element.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${symbol}</svg><span aria-hidden="true">${entry.index === -1 ? '+' : entry.index + 1}</span>`;
				element.dataset.symbol = symbolKey;
			}
		}
		schedulePlacementAnchor();
	}
	function dropPlacement(event: DragEvent) {
		if (presentation) return;
		const serviceKind = event.dataTransfer?.getData('application/x-policy-service');
		if (map && (serviceKind === 'bus' || serviceKind === 'ferry')) {
			event.preventDefault();
			const bounds = container.getBoundingClientRect();
			const point = map.unproject([event.clientX - bounds.left, event.clientY - bounds.top]);
			onserviceplace?.({ kind: serviceKind, coordinates: [point.lng, point.lat] });
			return;
		}
		const kind = event.dataTransfer?.getData('application/x-policy-placement');
		if (!map || !['add_stop', 'add_school', 'add_hospital'].includes(kind ?? '')) return;
		event.preventDefault();
		const bounds = container.getBoundingClientRect();
		const point = map.unproject([event.clientX - bounds.left, event.clientY - bounds.top]);
		ondropplacement?.(
			placementCoordinates([point.lng, point.lat], kind as PlacementKind),
			kind as PlacementKind
		);
	}
	function handleClick(event: MapMouseEvent) {
		if (!map || !ready || presentation) return;
		if ((airState || seaState) && !picking && !islandPicking) {
			const hits = map.queryRenderedFeatures(event.point, {
				layers: [
					'live-symbols',
					'live-vessel-symbols',
					'live-vessel-clusters',
					'route-vehicle-symbols',
					'sea-route-line',
					'sea-route-unverified',
					'air-route-line',
					'air-airport-points',
					'air-airport-symbols'
				]
			});
			const observation = hits.find((hit) => ['live', 'live-vessels'].includes(hit.source));
			if (observation) {
				if (observation.properties.cluster) expandCluster(observation);
				else inspectFeature(observation, event);
				return;
			}
			const illustration = hits.find((hit) => hit.source === 'route-vehicles');
			if (illustration) {
				const mode = illustration.properties.mode;
				const network = mode === 'air' ? airFeatures : seaState?.features;
				const feature = network?.features.find(
					(item) =>
						item.geometry.type === 'LineString' &&
						item.properties?.route_id === illustration.properties.route_id
				);
				if (feature) {
					if (mode === 'air') inspectAirRoute(feature, event);
					else inspectSeaRoute({ ...feature, source: 'sea-network' }, event);
					return;
				}
			}
			const airport = hits.find((hit) => hit.properties?.kind === 'air_airport');
			if (airport) {
				if (airport.properties.island_id) onselect(String(airport.properties.island_id));
				else inspectFeature(airport, event);
				return;
			}
			const airRoute =
				hits.find((hit) => hit.source === 'air-network' && hit.properties?.route_id) ??
				(airLayerEnabled && !hits.some((hit) => hit.source === 'sea-network')
					? map
							.queryRenderedFeatures(
								[
									[event.point.x - 6, event.point.y - 6],
									[event.point.x + 6, event.point.y + 6]
								],
								{ layers: ['air-route-line'] }
							)
							.find((hit) => hit.properties?.route_id)
					: undefined);
			if (airRoute) {
				inspectAirRoute(airRoute, event);
				return;
			}
		}
		if (seaState && !picking && !islandPicking) {
			const hits = map.queryRenderedFeatures(event.point, {
				layers: [
					'live-vessel-symbols',
					'live-vessel-clusters',
					'sea-island-points',
					'sea-port-points',
					'sea-route-line',
					'sea-route-unverified',
					...(seaInspectorOpen ? ['sea-island-fill', 'island-centroids', 'islands-fill'] : [])
				]
			});
			const vessel = hits.find((hit) => hit.source === 'live-vessels');
			if (vessel) {
				if (vessel.properties.cluster) expandCluster(vessel);
				else inspectFeature(vessel, event);
				return;
			}
			const islandPoint = hits.find(
				(hit) =>
					(hit.layer.id === 'sea-island-points' || hit.layer.id === 'sea-port-points') &&
					hit.properties?.island_id
			);
			if (islandPoint) {
				closeInspection();
				const id = String(islandPoint.properties.island_id ?? islandPoint.properties.id);
				if (seaInspectorOpen)
					onSeaSelect?.({
						kind: 'island',
						id,
						name: String(islandPoint.properties.name ?? '')
					});
				else onselect(id);
				return;
			}
			const route =
				hits.find((hit) => hit.properties?.route_id) ??
				(seaView
					? map
							.queryRenderedFeatures(
								[
									[event.point.x - 7, event.point.y - 7],
									[event.point.x + 7, event.point.y + 7]
								],
								{ layers: ['sea-route-line', 'sea-route-unverified'] }
							)
							.find((hit) => hit.properties?.route_id)
					: undefined);
			if (route) {
				inspectSeaRoute(route, event);
				return;
			}
			const island = hits.find(
				(hit) =>
					hit.properties?.island_id ||
					(hit.source === 'islands' && hit.properties?.id) ||
					hit.source === 'centroids'
			);
			if (island) {
				closeInspection();
				onSeaSelect?.({
					kind: 'island',
					id: String(island.properties.island_id ?? island.properties.id),
					name: String(island.properties.name ?? '')
				});
				return;
			}
		}
		if (!serviceEditor && !picking && !islandPicking) {
			const accepted = map
				.queryRenderedFeatures(event.point, { layers: serviceHitLayers })
				.find((feature) => feature.properties.accepted === true);
			if (accepted) {
				inspectProposedService(accepted, event);
				return;
			}
		}
		if (serviceEditor && !islandPicking) {
			const instance = map;
			const distance = (feature: MapGeoJSONFeature) => {
				if (feature.geometry.type !== 'Point' || !validCoordinates(feature.geometry.coordinates))
					return Infinity;
				const point = instance.project(feature.geometry.coordinates);
				return Math.hypot(point.x - event.point.x, point.y - event.point.y);
			};
			// Landing-zone halos can overlap; choose the actual pin nearest the click.
			const hits = instance
				.queryRenderedFeatures(event.point, { layers: serviceHitLayers })
				.sort((first, second) => distance(first) - distance(second));
			const landing = hits.find(
				(hit) => hit.properties.kind === 'ferry_landing' && hit.properties.terminal_id
			);
			if (landing?.geometry.type === 'Point' && validCoordinates(landing.geometry.coordinates)) {
				closeInspection();
				onservicelanding?.({
					terminalId: String(landing.properties.terminal_id),
					islandId: landing.properties.island_id ? String(landing.properties.island_id) : undefined,
					coordinates: landing.geometry.coordinates
				});
				return;
			}
			const candidate = hits.find(
				(hit) =>
					hit.properties.kind === 'bus_connection_candidate' &&
					['candidate', 'destination'].includes(String(hit.properties.role)) &&
					hit.properties.stop_id
			);
			if (candidate) {
				closeInspection();
				onservicecandidate?.(String(candidate.properties.stop_id));
				return;
			}
		}
		if (islandPicking) {
			const hits = map.queryRenderedFeatures(event.point, {
				layers: ['islands-fill', 'island-centroids', 'accessibility-centroids'].filter(
					(id) => !!map?.getLayer(id)
				)
			});
			const island = hits.find((hit) => hit.properties?.id || hit.properties?.island_id);
			if (island) {
				closeInspection();
				onselect(String(island.properties.island_id ?? island.properties.id));
			}
			return;
		}
		if (picking) {
			controlsPanel = null;
			closeInspection();
			if (placementKind && ondropplacement)
				ondropplacement(
					placementCoordinates([event.lngLat.lng, event.lngLat.lat], placementKind),
					placementKind
				);
			else onpick([event.lngLat.lng, event.lngLat.lat]);
			return;
		}
		selectedProposalIndex = null;
		const rendered = map.queryRenderedFeatures(event.point, {
			layers: [
				...interactiveLayers,
				'scenario-points',
				'scenario-symbols',
				'scenario-closed-lines',
				'route-endpoints',
				'route-endpoint-symbols',
				'live-symbols',
				...policyHitLayers
			]
		});
		const cluster =
			rendered[0]?.source === 'pois' && rendered[0].properties.cluster ? rendered[0] : null;
		const vesselGroup = rendered.find(
			(feature) => feature.source === 'live-vessels' && feature.properties.cluster
		);
		const priorityRecord = rendered.find((feature) =>
			['live', 'journey-stops'].includes(feature.source)
		);
		if (priorityRecord) {
			inspectFeature(priorityRecord, event);
			return;
		}
		if (vesselGroup) {
			expandCluster(vesselGroup);
			return;
		}
		if (cluster?.geometry.type === 'Point') {
			expandCluster(cluster);
			return;
		}
		const record = rendered.find((feature) =>
			[
				'facilities',
				'transport',
				'pois',
				'bus-stops',
				'journey-stops',
				'scenario',
				'live',
				'live-vessels',
				'route'
			].includes(feature.source)
		);
		if (record) {
			inspectFeature(record, event);
			// Inspecting a nearby bus stop keeps the current camera and planning island.
			// Catalogue planning IDs are distinct from the national boundary identities.
			if (['facilities', 'transport', 'pois'].includes(record.source)) {
				const id = record.properties.island_id;
				if (id && String(id) !== selectedId) onselect(String(id));
			}
			return;
		}
		const gap = rendered.find((feature) =>
			['policy-gaps', 'policy-impact'].includes(feature.source)
		);
		if (gap) {
			closeInspection();
			const id = String(gap.properties.island_id ?? selectedId ?? '');
			if (id && id !== selectedId) onselect(id);
			oninspectgap?.(
				gap.source === 'policy-impact'
					? comparisonCellProperties(
							gap.properties,
							policyComparisonView === 'current' ? 'before' : 'after'
						)
					: gap.properties
			);
			return;
		}
		const scoredIsland = rendered.find((feature) => feature.source === 'accessibility-centroids');
		if (scoredIsland) {
			closeInspection();
			onselect(String(scoredIsland.properties.id));
			return;
		}
		closeInspection();
		const hit = rendered.find((feature) => feature.properties?.island_id || feature.properties?.id);
		if (hit) {
			const id = String(hit.properties.island_id ?? hit.properties.id);
			if (id !== selectedId) onselect(id);
			inspectLocation([event.lngLat.lng, event.lngLat.lat]);
		} else {
			inspectLocation([event.lngLat.lng, event.lngLat.lat]);
		}
	}

	onMount(() => {
		try {
			overlayOpacity = overlayOpacityPreference(window.localStorage.getItem(OVERLAY_OPACITY_KEY));
		} catch {
			// The control remains usable when browser storage is unavailable.
		}
		overlayPreferenceLoaded = true;
		let disposed = false;
		const zoomInputController = new AbortController();
		let resizeObserver: ResizeObserver | undefined;
		function syncCameraView(instance: LibreMap) {
			if (!active) return;
			invalidateMapDiagnostics();
			nationalScale = instance.getZoom() < 9;
			centerCoordinates = [instance.getCenter().lng, instance.getCenter().lat];
			cameraPadding = cameraInsets(instance);
			zoomLevel = instance.getZoom();
			syncIslandLabels();
			syncStreetLabels();
			syncStopLabels();
			scheduleStreetContext();
		}
		function finishOutsidePan(event: MouseEvent) {
			const instance = map;
			if (
				event.button !== 0 ||
				!instance ||
				!(event.target instanceof Node) ||
				instance.getCanvasContainer().contains(event.target)
			)
				return;
			// A floating control can receive mouseup after a pan starts on the canvas.
			// Let MapLibre handle the release first, then finish any remaining gesture.
			queueMicrotask(() => {
				if (!disposed && map === instance && instance.dragPan.isActive()) {
					instance.stop();
					syncCameraView(instance);
				}
			});
		}
		document.addEventListener('mouseup', finishOutsidePan, true);
		async function initialize() {
			try {
				const libre = await import('maplibre-gl');
				if (disposed) return;
				// Explicitly bundle the ES worker: Vite relocates the main library during
				// dependency optimization, so MapLibre's default sibling URL is invalid.
				libre.setWorkerUrl(workerUrl);
				makeMarker = libre.Marker;
				makePopup = libre.Popup;
				const instance = new libre.Map({
					container,
					style: {
						version: 8,
						sources: {},
						layers: [
							{
								id: 'ocean',
								type: 'background',
								paint: { 'background-color': themeColors.colordceef0 }
							}
						]
					},
					bounds: scopeBounds ?? nationalBounds,
					fitBoundsOptions: { absolutePadding: true, padding: scopeFocusPadding() },
					minZoom: 4,
					maxZoom: 19,
					maxPitch: 0,
					attributionControl: false,
					renderWorldCopies: false
				});
				map = instance;
				const captureZoomInput = (event: Event) => {
					if (!active || picking) return;
					if (event.type === 'click') {
						if (
							!(event.target instanceof Element) ||
							!event.target.closest('.maplibregl-ctrl-zoom-in, .maplibregl-ctrl-zoom-out')
						)
							return;
					} else if (event instanceof KeyboardEvent) {
						if (!['+', '=', '-', '_'].includes(event.key)) return;
					} else if ('touches' in event) {
						if ((event as TouchEvent).touches.length < 2) return;
					} else if (event instanceof WheelEvent && !event.deltaY) return;
					const point = zoomGesturePoint(instance, event);
					userZoomGesture = {
						point:
							event.type === 'click' || event.type === 'keydown'
								? null
								: (point ?? userZoomGesture?.point ?? null),
						startZoom: userZoomGesture?.startZoom ?? instance.getZoom()
					};
				};
				// Capture the actual input before MapLibre handles it. Movement events
				// do not consistently retain originalEvent across library builds.
				for (const name of ['wheel', 'dblclick', 'touchstart', 'touchmove', 'keydown', 'click'])
					container.addEventListener(name, captureZoomInput, {
						capture: true,
						passive: true,
						signal: zoomInputController.signal
					});
				instance.dragRotate.disable();
				instance.touchZoomRotate.disableRotation();
				instance.on('error', (event) => {
					const message = event.error?.message ?? '';
					if (message.includes('WebGL')) error = 'Your browser could not initialize the map.';
					if (message.includes('Worker failed'))
						error = 'The map data worker could not load. Reload the page to retry.';
				});
				instance.on('load', () => {
					if (disposed) return;
					for (const [id, data] of Object.entries(atlasSymbols()))
						instance.addImage(id, data, { pixelRatio: 2 });
					void instance
						.loadImage(`${PUBLIC_BASE_PATH}/images/scenario-airplane.png`)
						.then(({ data }) => {
							if (disposed || map !== instance) return;
							// Keep the detailed transparent artwork, with a small GPU texture.
							const canvas = document.createElement('canvas');
							canvas.width = canvas.height = 192;
							const context = canvas.getContext('2d');
							if (!context) return;
							context.drawImage(data, 0, 0, 192, 192);
							instance.addImage('presentation-airplane', context.getImageData(0, 0, 192, 192), {
								pixelRatio: 3
							});
							presentationAirplaneReady = true;
						})
						// The existing aircraft sprite remains usable if this optional artwork fails.
						.catch(() => undefined);
					instance.addSource('pois', {
						type: 'geojson',
						data: emptyCollection,
						cluster: true,
						clusterRadius: 42,
						clusterMaxZoom: 12
					});
					instance.addSource('live-vessels', {
						type: 'geojson',
						data: emptyCollection,
						cluster: true,
						clusterRadius: 38,
						clusterMaxZoom: 16,
						clusterProperties: { stale_count: ['+', ['case', ['get', 'stale'], 1, 0]] }
					});
					// Resolve before MapLibre snapshots its icon response. The legacy missing-image
					// event fires afterwards and can leave the first clustered icons invisible.
					instance.setMissingStyleImageResolver((id) => {
						if (id.startsWith('atlas-vessels-') && !instance.hasImage(id)) {
							const count = Number(id.slice('atlas-vessels-'.length));
							if (!Number.isSafeInteger(count) || count <= 0) return;
							const data = atlasVesselClusterSymbol(count);
							if (data) instance.addImage(id, data, { pixelRatio: 2 });
							return;
						}
						if (!id.startsWith('atlas-cluster-') || instance.hasImage(id)) return;
						const count = Number(id.slice('atlas-cluster-'.length));
						if (!Number.isSafeInteger(count) || count <= 0) return;
						const image = atlasClusterSymbol(count);
						if (image) instance.addImage(id, image, { pixelRatio: 2 });
					});
					for (const name of [
						'islands',
						'centroids',
						'accessibility-centroids',
						'facilities',
						'transport',
						'bus-stops',
						'journey-stops',
						'scenario',
						'route',
						'live',
						'policy-gaps',
						'policy-coverage-fill',
						'policy-impact',
						'policy-feedback',
						'placement-roads',
						'policy-service',
						'sea-network',
						'sea-islands',
						'air-network',
						'route-vehicles',
						'presentation-routes',
						'presentation-vehicle',
						'presentation-population',
						'presentation-proposal-focus',
						'conditions-route',
						'street-context'
					]) {
						instance.addSource(name, {
							type: 'geojson',
							data: emptyCollection
						});
					}
					instance.addLayer({
						id: 'coastline-shadow',
						type: 'line',
						source: 'islands',
						paint: {
							'line-color': themeColors.color9fc9c5,
							'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2, 14, 7],
							'line-blur': 2.5,
							'line-opacity': 0.5
						}
					});
					instance.addLayer({
						id: 'islands-fill',
						type: 'fill',
						source: 'islands',
						paint: { 'fill-color': themeColors.colorf5f2e7, 'fill-opacity': 1 }
					});
					instance.addLayer({
						id: 'islands-outline',
						type: 'line',
						source: 'islands',
						paint: {
							'line-color': themeColors.colora0c1b9,
							'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 15, 1.2]
						}
					});
					instance.addLayer({
						id: 'policy-coverage-fill',
						type: 'fill',
						source: 'policy-coverage-fill',
						paint: {
							'fill-color': GAP_PALETTE.unknown,
							'fill-opacity': 0,
							'fill-opacity-transition': { duration: 0 },
							'fill-antialias': false
						}
					});
					instance.addLayer({
						id: 'policy-gaps-fill',
						type: 'fill',
						source: 'policy-gaps',
						filter: ['==', ['geometry-type'], 'Polygon'],
						paint: {
							'fill-color': GAP_PALETTE.unknown,
							'fill-opacity': 0,
							'fill-opacity-transition': { duration: 0 },
							'fill-antialias': false
						}
					});
					instance.addLayer({
						id: 'policy-coverage-fill-outline',
						type: 'line',
						source: 'policy-coverage-fill',
						paint: {
							'line-color': themeColors.colorf5faf7,
							'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.15, 14, 0.45, 17, 0.7],
							'line-opacity': 0,
							'line-opacity-transition': { duration: 0 }
						}
					});
					instance.addLayer({
						id: 'policy-gaps-outline',
						type: 'line',
						source: 'policy-gaps',
						filter: ['==', ['geometry-type'], 'Polygon'],
						paint: {
							'line-color': themeColors.colorf5faf7,
							'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.15, 14, 0.45, 17, 0.7],
							'line-opacity': 0,
							'line-opacity-transition': { duration: 0 }
						}
					});
					instance.addLayer({
						id: 'policy-gaps-points',
						type: 'circle',
						source: 'policy-gaps',
						filter: ['==', ['geometry-type'], 'Point'],
						paint: {
							'circle-color': GAP_PALETTE.unknown,
							'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3, 12, 9],
							'circle-opacity': 0,
							'circle-opacity-transition': { duration: 0 },
							'circle-stroke-opacity-transition': { duration: 0 },
							'circle-stroke-width': 1,
							'circle-stroke-color': themeColors.colorffffff
						}
					});
					// Data-driven paint changes relayout MapLibre's feature buckets. Prepare
					// both colors once and compare with constant opacity uniforms instead.
					for (const [id, color] of [
						['policy-current-fill', 'before_color'],
						['policy-impact-fill', 'after_color']
					])
						instance.addLayer({
							id,
							type: 'fill',
							source: 'policy-impact',
							paint: {
								'fill-color': ['coalesce', ['get', color], ['get', 'color']],
								'fill-opacity': 0,
								'fill-opacity-transition': { duration: reducedMotion() ? 0 : 180 },
								'fill-antialias': false
							}
						});
					instance.addLayer({
						id: 'policy-impact-outline',
						type: 'line',
						source: 'policy-impact',
						paint: {
							'line-color': themeColors.colorf5faf7,
							'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.15, 14, 0.45, 17, 0.7],
							'line-opacity': 0,
							'line-opacity-transition': { duration: 0 }
						}
					});
					instance.addLayer({
						id: 'policy-feedback-fill',
						type: 'fill',
						source: 'policy-feedback',
						paint: {
							'fill-color': ['coalesce', ['get', 'feedback_before_color'], ['get', 'before_color']],
							'fill-opacity': 0,
							'fill-opacity-transition': { duration: 0 },
							'fill-antialias': false
						}
					});
					instance.addLayer({
						id: 'policy-feedback-outline',
						type: 'line',
						source: 'policy-feedback',
						paint: {
							'line-color': themeColors.color315d61,
							'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.65, 17, 1.2],
							'line-opacity': 0,
							'line-opacity-transition': { duration: 0 }
						}
					});
					instance.addLayer({
						id: 'island-centroids',
						type: 'circle',
						source: 'centroids',
						maxzoom: 10,
						paint: {
							'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 2.3, 9, 3.4],
							'circle-color': themeColors.color6ba99c,
							'circle-stroke-color': themeColors.coloredf7f6,
							'circle-stroke-width': 0.5
						}
					});
					instance.addLayer({
						id: 'accessibility-centroids',
						type: 'circle',
						source: 'accessibility-centroids',
						paint: {
							'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 4, 9, 6, 13, 8],
							'circle-color': [
								'case',
								['get', 'limited_evidence'],
								themeColors.color8d9da1,
								[
									'interpolate',
									['linear'],
									['to-number', ['get', 'accessibility_score']],
									0,
									themeColors.colore6a24a,
									50,
									themeColors.color30969a,
									100,
									themeColors.color153f6f
								]
							],
							'circle-stroke-color': themeColors.colorffffff,
							'circle-stroke-width': 1.3
						}
					});
					instance.addLayer({
						id: 'context-green',
						type: 'fill',
						source: 'street-context',
						filter: ['==', ['get', 'kind'], 'landuse'],
						minzoom: 10,
						paint: { 'fill-color': themeColors.colorc6dfbc, 'fill-opacity': 0.72 }
					});
					instance.addLayer({
						id: 'context-buildings',
						type: 'fill',
						source: 'street-context',
						filter: ['==', ['get', 'kind'], 'building'],
						minzoom: 11,
						paint: {
							'fill-color': themeColors.colord9d2c1,
							'fill-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.25, 15, 0.8],
							'fill-outline-color': themeColors.colorc7beac
						}
					});
					// Analytical hexagons cover land/building footprints; streets and symbols stay above.
					for (const layer of [
						'policy-coverage-fill',
						'policy-coverage-fill-outline',
						'policy-gaps-fill',
						'policy-gaps-outline',
						'policy-gaps-points',
						'policy-current-fill',
						'policy-impact-fill',
						'policy-impact-outline',
						'policy-feedback-fill',
						'policy-feedback-outline'
					]) {
						instance.moveLayer(layer);
					}
					instance.addLayer({
						id: 'context-road-casing',
						type: 'line',
						source: 'street-context',
						filter: ['==', ['get', 'kind'], 'road'],
						minzoom: 10,
						layout: { 'line-cap': 'round', 'line-join': 'round' },
						paint: {
							'line-color': themeColors.colorc8c7b8,
							'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 13, 2.2, 16, 6, 19, 13],
							'line-opacity': 0.85
						}
					});
					instance.addLayer({
						id: 'context-roads',
						type: 'line',
						source: 'street-context',
						filter: ['==', ['get', 'kind'], 'road'],
						minzoom: 10,
						layout: { 'line-cap': 'round', 'line-join': 'round' },
						paint: {
							'line-color': [
								'match',
								['get', 'highway'],
								['primary', 'secondary', 'tertiary'],
								themeColors.colorfff4cf,
								['footway', 'path', 'pedestrian'],
								themeColors.colorf8f9ef,
								themeColors.colorfffefa
							],
							'line-width': [
								'interpolate',
								['linear'],
								['zoom'],
								10,
								0.5,
								13,
								1.2,
								16,
								4.6,
								19,
								11
							],
							'line-opacity': 1
						}
					});
					instance.addLayer({
						id: 'facilities-fill',
						type: 'fill',
						source: 'facilities',
						filter: ['==', ['geometry-type'], 'Polygon'],
						minzoom: 10,
						paint: { 'fill-color': themeColors.color40868b, 'fill-opacity': 0.45 }
					});
					instance.addLayer({
						id: 'transport-fill',
						type: 'fill',
						source: 'transport',
						filter: ['==', ['geometry-type'], 'Polygon'],
						minzoom: 10,
						paint: { 'fill-color': themeColors.color648598, 'fill-opacity': 0.24 }
					});
					instance.addLayer({
						id: 'transport-lines',
						type: 'line',
						source: 'transport',
						filter: ['==', ['geometry-type'], 'LineString'],
						minzoom: 10,
						paint: {
							'line-color': themeColors.color7e9ea8,
							'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 16, 2.8],
							'line-opacity': 0.85
						}
					});
					instance.addLayer({
						id: 'selected-island',
						type: 'fill',
						source: 'islands',
						filter: ['==', ['get', 'id'], ''],
						paint: { 'fill-color': themeColors.colorb6daca, 'fill-opacity': 0.09 }
					});
					instance.addLayer({
						id: 'selected-outline',
						type: 'line',
						source: 'islands',
						filter: ['==', ['get', 'id'], ''],
						paint: {
							'line-color': themeColors.color41988b,
							'line-width': ['interpolate', ['linear'], ['zoom'], 5, 1.4, 14, 2.2]
						}
					});
					instance.addLayer({
						id: 'selected-centroid',
						type: 'circle',
						source: 'centroids',
						filter: ['==', ['get', 'id'], ''],
						maxzoom: 10,
						paint: {
							'circle-color': themeColors.color087f7c,
							'circle-radius': 5,
							'circle-stroke-color': themeColors.colorffffff,
							'circle-stroke-width': 1.5
						}
					});
					for (const source of ['facilities', 'transport']) {
						instance.addLayer({
							id: `${source}-symbols`,
							type: 'symbol',
							source: 'pois',
							minzoom: 10,
							filter: [
								'all',
								['!', ['has', 'point_count']],
								['==', ['get', 'record_source'], source],
								['!', ['in', ['get', 'category'], ['literal', ['bus_stop', 'bus_station']]]]
							],
							layout: {
								'icon-image': [
									'match',
									['get', 'symbol_category'],
									['hospital', 'clinic', 'health_center'],
									'atlas-health',
									'school',
									'atlas-school',
									'air_terminal',
									'atlas-air-terminal',
									['airport', 'aerodrome', 'helipad'],
									'atlas-airport',
									['bus_stop', 'bus_station'],
									'atlas-bus-stop',
									'ferry_terminal',
									'atlas-ferry',
									['pier', 'port', 'harbour'],
									'atlas-port',
									'government',
									'atlas-civic',
									'atlas-transport'
								],
								'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 0.65, 15, 0.82, 18, 0.92],
								'symbol-sort-key': ['get', 'priority'],
								'icon-padding': 6,
								'icon-allow-overlap': false
							}
						});
					}
					instance.addLayer({
						id: 'bus-stop-symbols',
						type: 'symbol',
						source: 'bus-stops',
						minzoom: 12,
						layout: {
							'icon-image': 'atlas-bus-stop',
							'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.6, 15, 0.8, 18, 0.9],
							'icon-allow-overlap': true,
							'icon-ignore-placement': true
						}
					});
					instance.addLayer({
						id: 'poi-clusters',
						type: 'symbol',
						source: 'pois',
						minzoom: 8,
						filter: ['has', 'point_count'],
						layout: {
							'icon-image': ['concat', 'atlas-cluster-', ['to-string', ['get', 'point_count']]],
							'icon-size': 0.88,
							'icon-padding': 5,
							'icon-allow-overlap': false
						}
					});
					instance.addLayer({
						id: 'route-casing',
						type: 'line',
						source: 'route',
						filter: ['==', ['geometry-type'], 'LineString'],
						layout: { 'line-cap': 'round', 'line-join': 'round' },
						paint: { 'line-color': themeColors.colorffffff, 'line-width': 7 }
					});
					instance.addLayer({
						id: 'route-line',
						type: 'line',
						source: 'route',
						filter: [
							'all',
							['==', ['geometry-type'], 'LineString'],
							['!=', ['get', 'mode'], 'walk']
						],
						layout: { 'line-cap': 'round', 'line-join': 'round' },
						paint: {
							'line-color': [
								'match',
								['get', 'mode'],
								'ferry',
								themeColors.color8a65a7,
								themeColors.color376eb1
							],
							'line-width': 4.5
						}
					});
					instance.addLayer({
						id: 'route-walk-line',
						type: 'line',
						source: 'route',
						filter: [
							'all',
							['==', ['geometry-type'], 'LineString'],
							['==', ['get', 'mode'], 'walk']
						],
						layout: { 'line-cap': 'round', 'line-join': 'round' },
						paint: {
							'line-color': themeColors.color496f6d,
							'line-width': 3,
							'line-dasharray': [1.5, 1.5]
						}
					});
					instance.addLayer({
						id: 'journey-stop-halos',
						type: 'circle',
						source: 'journey-stops',
						paint: {
							'circle-color': themeColors.colorfff9e8,
							'circle-radius': 20,
							'circle-stroke-width': 2.5,
							'circle-stroke-color': themeColors.colorc59a53
						}
					});
					instance.addLayer({
						id: 'journey-stop-symbols',
						type: 'symbol',
						source: 'journey-stops',
						layout: {
							'icon-image': ['match', ['get', 'mode'], 'ferry', 'atlas-ferry', 'atlas-bus-stop'],
							'icon-size': 0.9,
							'icon-allow-overlap': true,
							'icon-ignore-placement': true
						}
					});
					instance.addLayer({
						id: 'route-endpoints',
						type: 'circle',
						source: 'route',
						filter: [
							'all',
							['==', ['geometry-type'], 'Point'],
							['!=', ['get', 'inline_direction'], true]
						],
						paint: {
							'circle-color': [
								'match',
								['get', 'kind'],
								'start',
								themeColors.color337f7a,
								themeColors.coloref7159
							],
							'circle-radius': 9,
							'circle-stroke-color': themeColors.colorffffff,
							'circle-stroke-width': 2
						}
					});
					instance.addLayer({
						id: 'route-endpoint-symbols',
						type: 'symbol',
						source: 'route',
						filter: [
							'all',
							['==', ['geometry-type'], 'Point'],
							['!=', ['get', 'inline_direction'], true]
						],
						layout: {
							'icon-image': [
								'match',
								['get', 'kind'],
								'start',
								'atlas-origin',
								'atlas-destination'
							],
							'icon-size': 0.94,
							'icon-allow-overlap': true,
							'icon-ignore-placement': true
						}
					});
					instance.addLayer({
						id: 'scenario-closed-lines',
						type: 'line',
						source: 'scenario',
						filter: ['==', ['geometry-type'], 'LineString'],
						layout: { 'line-cap': 'round', 'line-join': 'round' },
						paint: {
							'line-color': themeColors.colorc1493f,
							'line-width': 5,
							'line-dasharray': [2, 1.5]
						}
					});
					instance.addLayer({
						id: 'scenario-halo',
						type: 'circle',
						source: 'scenario',
						filter: ['==', ['geometry-type'], 'Point'],
						paint: {
							'circle-color': themeColors.coloref7159,
							'circle-radius': 13,
							'circle-opacity': 0.15
						}
					});
					instance.addLayer({
						id: 'scenario-points',
						type: 'circle',
						source: 'scenario',
						filter: ['==', ['geometry-type'], 'Point'],
						paint: {
							'circle-color': themeColors.coloref7159,
							'circle-radius': 6,
							'circle-stroke-color': themeColors.colorffffff,
							'circle-stroke-width': 2
						}
					});
					instance.addLayer({
						id: 'scenario-symbols',
						type: 'symbol',
						source: 'scenario',
						filter: ['==', ['geometry-type'], 'Point'],
						layout: {
							'icon-image': [
								'match',
								['get', 'type'],
								['remove_bus_stop', 'disable_ferry_terminal', 'road_closure'],
								'atlas-removed',
								['add_bus_stop', 'move_bus_stop'],
								'atlas-bus-stop',
								['add_ferry_terminal', 'move_ferry_terminal', 'add_ferry_route'],
								'atlas-ferry',
								'airport_access_improvement',
								'atlas-airport',
								'atlas-transport'
							],
							'icon-size': 0.86,
							'icon-allow-overlap': true
						}
					});
					instance.addLayer({
						id: 'live-symbols',
						type: 'symbol',
						source: 'live',
						layout: {
							'icon-image': [
								'match',
								['get', 'kind'],
								'aircraft',
								'atlas-aircraft',
								'vessel',
								'atlas-vessel',
								'atlas-live-bus'
							],
							'icon-size': [
								'interpolate',
								['linear'],
								['zoom'],
								4,
								['match', ['get', 'kind'], 'bus', 0.32, 0.85],
								12,
								['match', ['get', 'kind'], 'bus', 0.45, 1],
								16,
								['match', ['get', 'kind'], 'bus', 0.8, 1],
								18,
								1,
								19,
								['match', ['get', 'kind'], 'bus', 1.15, 1]
							],
							'icon-rotate': ['coalesce', ['get', 'heading'], 0],
							'icon-rotation-alignment': 'map',
							'icon-allow-overlap': true,
							'icon-ignore-placement': true
						},
						paint: { 'icon-opacity': ['case', ['get', 'stale'], 0.48, 1] }
					});
					instance.addLayer({
						id: 'live-vessel-clusters',
						type: 'symbol',
						source: 'live-vessels',
						filter: ['has', 'point_count'],
						layout: {
							'icon-image': ['concat', 'atlas-vessels-', ['to-string', ['get', 'point_count']]],
							'icon-size': 1,
							'icon-allow-overlap': true,
							'icon-ignore-placement': true
						},
						paint: {
							'icon-opacity': [
								'case',
								['==', ['get', 'stale_count'], ['get', 'point_count']],
								0.48,
								1
							]
						}
					});
					instance.addLayer({
						id: 'live-vessel-symbols',
						type: 'symbol',
						source: 'live-vessels',
						filter: ['!', ['has', 'point_count']],
						layout: {
							'icon-image': 'atlas-vessel',
							'icon-size': [
								'interpolate',
								['linear'],
								['zoom'],
								4,
								0.55,
								12,
								0.6,
								16,
								0.7,
								18,
								0.9
							],
							'icon-rotate': ['coalesce', ['get', 'heading'], 0],
							'icon-rotation-alignment': 'map',
							'icon-allow-overlap': true,
							'icon-ignore-placement': true
						},
						paint: { 'icon-opacity': ['case', ['get', 'stale'], 0.48, 1] }
					});
					for (const id of ['live-symbols', 'live-vessel-symbols']) {
						instance.setLayoutProperty(id, 'text-field', '');
						instance.setLayoutProperty(id, 'text-size', 8);
						instance.setLayoutProperty(id, 'text-letter-spacing', 0.08);
						instance.setLayoutProperty(id, 'text-anchor', 'left');
						instance.setLayoutProperty(id, 'text-offset', [1.6, -0.8]);
						instance.setLayoutProperty(id, 'text-allow-overlap', true);
						instance.setLayoutProperty(id, 'text-ignore-placement', true);
						instance.setLayoutProperty(id, 'text-rotation-alignment', 'viewport');
						instance.setPaintProperty(id, 'text-color', themeColors.colorffffff);
						instance.setPaintProperty(id, 'text-halo-color', themeColors.color1d645e);
						instance.setPaintProperty(id, 'text-halo-width', 2);
					}
					for (const id of [
						'live-symbols',
						'journey-stop-halos',
						'journey-stop-symbols',
						'route-endpoints',
						'route-endpoint-symbols'
					])
						instance.moveLayer(id);
					instance.addLayer({
						id: 'policy-service-casing',
						type: 'line',
						source: 'policy-service',
						filter: ['==', ['geometry-type'], 'LineString'],
						layout: { 'line-cap': 'round', 'line-join': 'round' },
						paint: { 'line-color': themeColors.colorfffefa, 'line-width': 10, 'line-opacity': 0.95 }
					});
					instance.addLayer({
						id: 'policy-service-bus-line',
						type: 'line',
						source: 'policy-service',
						filter: [
							'all',
							['==', ['geometry-type'], 'LineString'],
							['==', ['get', 'mode'], 'bus']
						],
						layout: { 'line-cap': 'round', 'line-join': 'round' },
						paint: { 'line-color': themeColors.color00695c, 'line-width': 6 }
					});
					instance.addLayer({
						id: 'policy-service-line',
						type: 'line',
						source: 'policy-service',
						filter: [
							'all',
							['==', ['geometry-type'], 'LineString'],
							['!=', ['get', 'mode'], 'bus']
						],
						layout: { 'line-cap': 'round', 'line-join': 'round' },
						paint: {
							'line-color': themeColors.color7765b2,
							'line-width': 4,
							'line-dasharray': [2, 1.4],
							'line-opacity': 0.95
						}
					});
					instance.addLayer({
						id: 'policy-ferry-landing-zones',
						type: 'circle',
						source: 'policy-service',
						filter: [
							'all',
							['==', ['geometry-type'], 'Point'],
							['==', ['get', 'kind'], 'ferry_landing']
						],
						paint: {
							'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 14, 14, 34, 18, 48],
							'circle-color': themeColors.colord4c9ed,
							'circle-opacity': 0.32,
							'circle-stroke-color': themeColors.color7765b2,
							'circle-stroke-opacity': 0.65,
							'circle-stroke-width': 1.5
						}
					});
					instance.addLayer({
						id: 'policy-service-terminal-halo',
						type: 'circle',
						source: 'policy-service',
						filter: ['==', ['geometry-type'], 'Point'],
						paint: {
							'circle-radius': 14,
							'circle-color': themeColors.colorffffff,
							'circle-stroke-color': [
								'match',
								['get', 'mode'],
								'bus',
								themeColors.color247b75,
								themeColors.color7765b2
							],
							'circle-stroke-width': 2
						}
					});
					instance.addLayer({
						id: 'policy-service-terminal-symbol',
						type: 'symbol',
						source: 'policy-service',
						filter: ['==', ['geometry-type'], 'Point'],
						layout: {
							'icon-image': ['match', ['get', 'mode'], 'bus', 'atlas-bus-stop', 'atlas-ferry'],
							'icon-size': 0.7,
							'icon-allow-overlap': true
						}
					});
					instance.addLayer({
						id: 'sea-island-fill',
						type: 'fill',
						source: 'sea-islands',
						paint: {
							'fill-color': ['get', 'color'],
							'fill-opacity': 0
						}
					});
					instance.addLayer({
						id: 'sea-island-outline',
						type: 'line',
						source: 'sea-islands',
						paint: {
							'line-color': ['get', 'color'],
							'line-width': ['case', ['get', 'selected'], 1.75, 1]
						}
					});
					instance.addLayer({
						id: 'sea-route-casing',
						type: 'line',
						source: 'sea-network',
						filter: ['==', ['geometry-type'], 'LineString'],
						layout: { 'line-cap': 'round', 'line-join': 'round' },
						paint: {
							'line-color': themeColors.colorffffff,
							'line-width': 3.6,
							'line-opacity': 0.4
						}
					});
					for (const verified of [true, false])
						instance.addLayer({
							id: verified ? 'sea-route-line' : 'sea-route-unverified',
							type: 'line',
							source: 'sea-network',
							filter: [
								'all',
								['==', ['geometry-type'], 'LineString'],
								verified
									? ['in', ['get', 'evidence'], ['literal', ['dated_service', 'proposal']]]
									: ['!', ['in', ['get', 'evidence'], ['literal', ['dated_service', 'proposal']]]]
							],
							layout: { 'line-cap': 'round', 'line-join': 'round' },
							paint: {
								'line-color': ['coalesce', ['get', 'color'], themeColors.color087f8c],
								'line-width': 1.7,
								'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.72, 9, 0.8, 14, 0.58],
								...(!verified ? { 'line-dasharray': [2, 2] } : {})
							}
						});
					instance.addLayer({
						id: 'sea-route-arrows',
						type: 'symbol',
						source: 'sea-network',
						minzoom: 9,
						filter: ['==', ['geometry-type'], 'LineString'],
						layout: {
							'symbol-placement': 'line',
							'symbol-spacing': 240,
							'text-field': '›',
							'text-size': 12,
							'text-keep-upright': false,
							'text-allow-overlap': true
						},
						paint: {
							'text-color': ['coalesce', ['get', 'color'], themeColors.color087f8c],
							'text-halo-color': themeColors.colorffffff,
							'text-halo-width': 1,
							'text-opacity': 0.6
						}
					});
					instance.addLayer({
						id: 'air-route-casing',
						type: 'line',
						source: 'air-network',
						filter: ['==', ['geometry-type'], 'LineString'],
						layout: { 'line-cap': 'round', 'line-join': 'round' },
						paint: { 'line-color': themeColors.colorffffff, 'line-width': 3, 'line-opacity': 0.35 }
					});
					instance.addLayer({
						id: 'air-route-line',
						type: 'line',
						source: 'air-network',
						filter: ['==', ['geometry-type'], 'LineString'],
						layout: { 'line-cap': 'round', 'line-join': 'round' },
						paint: {
							'line-color': ['get', 'color'],
							'line-width': 1.4,
							'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.65, 9, 0.76, 14, 0.52]
						}
					});
					instance.addLayer({
						id: 'air-airport-halo',
						type: 'circle',
						source: 'air-network',
						filter: [
							'all',
							['==', ['geometry-type'], 'Point'],
							['>=', ['get', 'regional_connections'], 2]
						],
						paint: {
							'circle-radius': 10,
							'circle-color': themeColors.color607d8a,
							'circle-opacity': 0.12
						}
					});
					instance.addLayer({
						id: 'air-airport-points',
						type: 'circle',
						source: 'air-network',
						filter: ['==', ['geometry-type'], 'Point'],
						paint: {
							'circle-radius': [
								'interpolate',
								['linear'],
								['get', 'connection_count'],
								1,
								3,
								4,
								4.5,
								18,
								6
							],
							'circle-color': themeColors.colorfffefa,
							'circle-stroke-color': themeColors.color607d8a,
							'circle-stroke-width': 1.4
						}
					});
					instance.addLayer({
						id: 'air-airport-symbols',
						type: 'symbol',
						source: 'air-network',
						filter: ['==', ['geometry-type'], 'Point'],
						layout: {
							'text-field': ['get', 'iata'],
							'text-size': ['case', ['>=', ['get', 'regional_connections'], 2], 11, 10],
							'symbol-sort-key': ['-', 0, ['get', 'connection_count']],
							'text-anchor': 'left',
							'text-offset': [0.7, 0],
							'text-padding': 3
						},
						paint: {
							'text-color': themeColors.color36585f,
							'text-halo-color': themeColors.colorfffefa,
							'text-halo-width': 1.5
						}
					});
					instance.addLayer({
						id: 'route-vehicle-symbols',
						type: 'symbol',
						source: 'route-vehicles',
						layout: {
							'icon-image': [
								'match',
								['get', 'mode'],
								'air',
								'atlas-route-aircraft',
								'atlas-route-vessel'
							],
							'icon-size': [
								'interpolate',
								['linear'],
								['zoom'],
								3,
								0.27,
								5,
								0.34,
								7,
								0.42,
								10,
								0.58,
								14,
								0.68
							],
							'icon-rotate': ['get', 'bearing'],
							'icon-rotation-alignment': 'map',
							'icon-allow-overlap': true,
							'icon-ignore-placement': true
						},
						paint: { 'icon-opacity': ['coalesce', ['get', 'opacity'], 1] }
					});
					instance.addLayer({
						id: 'sea-budget-halo',
						type: 'circle',
						source: 'sea-network',
						filter: [
							'all',
							['==', ['geometry-type'], 'Point'],
							['==', ['get', 'within_budget'], true]
						],
						paint: {
							'circle-radius': 10,
							'circle-color': themeColors.colorffffff,
							'circle-opacity': 0.15,
							'circle-stroke-color': [
								'case',
								['get', 'newly_reachable'],
								themeColors.color22824e,
								['coalesce', ['get', 'color'], themeColors.color087f8c]
							],
							'circle-stroke-width': 2
						}
					});
					instance.addLayer({
						id: 'sea-island-points',
						type: 'circle',
						source: 'sea-network',
						filter: [
							'all',
							['==', ['geometry-type'], 'Point'],
							['!=', ['get', 'kind'], 'sea_terminal']
						],
						paint: {
							'circle-radius': [
								'case',
								['get', 'selected'],
								8,
								['==', ['get', 'kind'], 'sea_origin'],
								8,
								5
							],
							'circle-color': [
								'case',
								['get', 'newly_reachable'],
								themeColors.color22824e,
								['coalesce', ['get', 'color'], themeColors.color87939b]
							],
							'circle-stroke-color': themeColors.colorffffff,
							'circle-stroke-width': 2
						}
					});
					instance.addLayer({
						id: 'sea-port-points',
						type: 'circle',
						source: 'sea-network',
						filter: ['==', ['get', 'kind'], 'sea_terminal'],
						paint: {
							'circle-radius': 3,
							'circle-color': themeColors.color087f8c,
							'circle-stroke-color': themeColors.colorffffff,
							'circle-stroke-width': 1
						}
					});
					instance.addLayer({
						id: 'sea-port-labels',
						type: 'symbol',
						source: 'sea-network',
						filter: ['==', ['get', 'kind'], 'sea_terminal'],
						minzoom: 11,
						layout: {
							'text-field': ['get', 'terminal_name'],
							'text-size': 10,
							'text-offset': [0, 1.2],
							'text-anchor': 'top'
						},
						paint: {
							'text-color': themeColors.color355e67,
							'text-halo-color': themeColors.colorffffff,
							'text-halo-width': 1.5
						}
					});
					instance.addLayer({
						id: 'conditions-route-line',
						type: 'line',
						source: 'conditions-route',
						paint: { 'line-color': themeColors.colorbb7f48, 'line-width': 5, 'line-opacity': 0.9 }
					});
					instance.addLayer({
						id: 'placement-road-hints',
						type: 'line',
						source: 'placement-roads',
						minzoom: 12,
						layout: { 'line-cap': 'round', 'line-join': 'round' },
						paint: {
							'line-color': themeColors.color27877b,
							'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.5, 17, 3],
							'line-opacity': 0.5
						}
					});
					// Airport junctions stay legible above the denser sea-island markers.
					instance.addLayer(
						{
							id: 'presentation-population-fill',
							type: 'fill',
							source: 'presentation-population',
							paint: {
								'fill-color': [
									'interpolate',
									['linear'],
									['get', 'presentation_population_fraction'],
									0,
									themeColors.colorf3efe0,
									0.3,
									themeColors.colord0c6e7,
									1,
									themeColors.color8762d8
								],
								'fill-opacity': 0.82,
								'fill-outline-color': themeColors.colorfffefa
							}
						},
						'context-buildings'
					);
					instance.addLayer({
						id: 'presentation-proposal-pulse',
						type: 'circle',
						source: 'presentation-proposal-focus',
						paint: {
							'circle-radius': 12,
							'circle-color': themeColors.color27877b,
							'circle-opacity': 0,
							'circle-stroke-color': themeColors.color27877b,
							'circle-stroke-width': 2,
							'circle-stroke-opacity': 0
						}
					});
					instance.addLayer({
						id: 'presentation-route-casing',
						type: 'line',
						source: 'presentation-routes',
						layout: { 'line-cap': 'round', 'line-join': 'round' },
						paint: { 'line-color': themeColors.colorfffefa, 'line-width': 9, 'line-opacity': 0.9 }
					});
					instance.addLayer({
						id: 'presentation-route-line',
						type: 'line',
						source: 'presentation-routes',
						filter: ['!', ['in', ['get', 'mode'], ['literal', ['walk', 'transfer']]]],
						layout: { 'line-cap': 'round', 'line-join': 'round' },
						paint: {
							'line-color': [
								'match',
								['get', 'mode'],
								'ferry',
								themeColors.color2689b2,
								'air',
								themeColors.color566cc3,
								'bus',
								themeColors.color087f8c,
								themeColors.colord18c34
							],
							'line-width': 5
						}
					});
					instance.addLayer({
						id: 'presentation-transfer-line',
						type: 'line',
						source: 'presentation-routes',
						filter: ['in', ['get', 'mode'], ['literal', ['walk', 'transfer']]],
						layout: { 'line-cap': 'round', 'line-join': 'round' },
						paint: {
							'line-color': themeColors.color22796d,
							'line-width': 4,
							'line-dasharray': [1.5, 1.5]
						}
					});
					instance.addLayer({
						id: 'presentation-vehicle-halo',
						type: 'circle',
						source: 'presentation-vehicle',
						paint: {
							'circle-radius': 22,
							'circle-color': themeColors.colorfffefa,
							'circle-opacity': 0.95,
							'circle-stroke-color': themeColors.color087f78,
							'circle-stroke-width': 2
						}
					});
					instance.addLayer({
						id: 'presentation-vehicle-symbol',
						type: 'symbol',
						source: 'presentation-vehicle',
						layout: {
							'icon-image': [
								'match',
								['get', 'mode'],
								'ferry',
								'atlas-route-vessel',
								'air',
								'atlas-route-aircraft',
								'bus',
								'atlas-live-bus',
								'atlas-origin'
							],
							'icon-size': 1.1,
							'icon-rotate': [
								'case',
								['in', ['get', 'mode'], ['literal', ['walk', 'transfer']]],
								0,
								['get', 'bearing']
							],
							'icon-rotation-alignment': 'map',
							'icon-allow-overlap': true,
							'icon-ignore-placement': true
						}
					});
					for (const id of ['air-airport-halo', 'air-airport-points', 'air-airport-symbols'])
						instance.moveLayer(id, 'conditions-route-line');
					ready = true;
					scheduleStreetContext();
					centerCoordinates = [instance.getCenter().lng, instance.getCenter().lat];
					cameraPadding = cameraInsets(instance);
					zoomLevel = instance.getZoom();
				});
				instance.on('click', handleClick);
				instance.on('zoomend', () => {
					const gesture = userZoomGesture;
					userZoomGesture = null;
					if (gesture && instance.getZoom() > gesture.startZoom + 0.01)
						drillIntoVisibleIsland(instance, gesture.point);
				});
				instance.on('move', schedulePlacementAnchor);
				instance.on('move', schedulePlacementPreview);
				instance.on('resize', schedulePlacementAnchor);
				instance.on('resize', schedulePlacementPreview);
				instance.on('resize', invalidateMapDiagnostics);
				instance.on('resize', scheduleStreetContext);
				instance.on('moveend', () => syncCameraView(instance));
				instance.on('idle', () => {
					if (!ready || !active) return;
					// Counting whole-viewport roads/buildings deserializes their geometry.
					// Overlay paint is independent: a comparison must not repeat these scans.
					if (diagnosticsDirty.context) {
						diagnosticsDirty.context = false;
						renderedRoads = instance.queryRenderedFeatures({ layers: ['context-roads'] }).length;
						renderedBuildings = instance.queryRenderedFeatures({
							layers: ['context-buildings']
						}).length;
					}
					if (diagnosticsDirty.movement) {
						diagnosticsDirty.movement = false;
						syncMovementCounts();
					}
					if (diagnosticsDirty.places) {
						diagnosticsDirty.places = false;
						renderedPoiIcons = instance.queryRenderedFeatures({
							layers: ['facilities-symbols', 'transport-symbols', 'bus-stop-symbols']
						}).length;
						renderedClusters = instance.queryRenderedFeatures({ layers: ['poi-clusters'] }).length;
					}
				});
				instance.on('mousemove', (event) => {
					if (!ready || !active) return;
					if (picking && placementKind) {
						previewPointer = { x: event.point.x, y: event.point.y };
						schedulePlacementPreview();
						instance.getCanvas().style.cursor = 'crosshair';
						hoverDescription = '';
						hoveredAirAirport = '';
						return;
					}
					const hits = instance.queryRenderedFeatures(event.point, {
						layers: [
							...serviceHitLayers,
							...interactiveLayers,
							'scenario-points',
							'scenario-symbols',
							'scenario-closed-lines',
							'route-endpoint-symbols',
							'live-symbols',
							...policyHitLayers
						]
					});
					instance.getCanvas().style.cursor = picking ? 'crosshair' : hits.length ? 'pointer' : '';
					hoveredAirAirport =
						picking || islandPicking
							? ''
							: String(
									hits.find((hit) => hit.properties?.kind === 'air_airport')?.properties.iata ?? ''
								);
					const props = hits[0]?.properties;
					hoverDescription =
						serviceEditor?.mode === 'ferry' && props?.kind === 'ferry_landing'
							? `Existing ferry landing · ${props.name ?? 'Select to use this landing place'}`
							: props?.kind === 'route_vehicle'
								? `${props.mode === 'air' ? 'Flight route' : 'Sea route'} · ${props.name ?? 'Select for route details'}`
								: props?.cluster
									? hits[0]?.source === 'live-vessels'
										? `${props.point_count} observed vessel positions · select to zoom in`
										: `${props.point_count} places · select to zoom in`
									: props
										? String(
												props.label ??
													(props.impact
														? 'Select to compare resident access here'
														: props.origin_id
															? 'Select to inspect local service access'
															: null) ??
													[props.name, String(props.category ?? '').replaceAll('_', ' ')]
														.filter(Boolean)
														.join(' · ')
											)
										: '';
				});
				instance.on('mouseout', () => {
					hoverDescription = '';
					hoveredAirAirport = '';
					previewPointer = null;
					schedulePlacementPreview();
				});
				instance.getCanvas().addEventListener('keydown', (event) => {
					if (presentation || !picking || (event.key !== 'Enter' && event.key !== ' ')) return;
					event.preventDefault();
					const center = instance.unproject([
						container.clientWidth / 2,
						container.clientHeight / 2
					]);
					if (placementKind && ondropplacement)
						ondropplacement(
							placementCoordinates([center.lng, center.lat], placementKind),
							placementKind
						);
					else onpick([center.lng, center.lat]);
				});
				resizeObserver = new ResizeObserver(() => {
					if (!active) return;
					instance.resize();
					mapHeight = container.clientHeight;
					syncIslandLabels();
					syncStreetLabels();
					syncStopLabels();
				});
				resizeObserver.observe(container);
			} catch (cause) {
				if (!disposed)
					error = cause instanceof Error ? cause.message : 'The interactive map could not start.';
			}
		}
		void initialize();
		return () => {
			disposed = true;
			cancelIslandReadiness?.();
			zoomInputController.abort();
			userZoomGesture = null;
			document.removeEventListener('mouseup', finishOutsidePan, true);
			cancelAnimationFrame(liveFrame);
			cancelAnimationFrame(activationFrame);
			cancelAnimationFrame(scopeFocusFrame);
			cancelAnimationFrame(placementPositionFrame);
			cancelAnimationFrame(placementPreviewFrame);
			stopImpactFeedback();
			sourceData.clear();
			clearTimeout(contextTimer);
			contextGeneration++;
			contextRequest?.abort();
			clearStreetLabels();
			for (const marker of Object.values(stopLabels)) marker.remove();
			for (const marker of Object.values(vesselClusterButtons)) marker.remove();
			resizeObserver?.disconnect();
			selectedMarker?.remove();
			clearSearchPlace();
			serviceMarker?.remove();
			for (const marker of Object.values(journeyMarkers)) marker?.remove();
			clearDirectionMarkers();
			for (const marker of policyMarkers.values()) marker.remove();
			policyMarkers.clear();
			for (const [id, marker] of Object.entries(islandLabels)) {
				marker.remove();
				delete islandLabels[id];
			}
			closeInspection();
			map?.remove();
			map = null;
		};
	});

	$effect(() => {
		if (!ready || !active || !serviceEditor) {
			serviceAnchor = null;
			lastServiceEditorId = null;
			untrack(syncServiceMarker);
			return;
		}
		void serviceEditor.coordinates;
		void serviceEditorContent;
		void policyServiceFeatures;
		void pendingProposal;
		untrack(syncServiceMarker);
		untrack(schedulePlacementAnchor);
		if (lastServiceEditorId !== serviceEditor.id) {
			lastServiceEditorId = serviceEditor.id;
			const editor = serviceEditor;
			closeInspection();
			selectedProposalIndex = null;
			void tick().then(() => {
				if (!map || serviceEditor?.id !== editor.id) return;
				const point = map.project(editor.coordinates);
				const { right, top, bottom } = serviceViewport();
				const x = Math.max(70, Math.min(right - 40, point.x));
				const y = Math.max(top + 70, Math.min(bottom - 35, point.y));
				if (Math.abs(point.x - x) > 1 || Math.abs(point.y - y) > 1)
					map.panBy([point.x - x, point.y - y], { duration: reducedMotion() ? 0 : 180 });
				updateServiceAnchor();
			});
		}
	});
	$effect(() => {
		if (!serviceCard) return;
		const observer = new ResizeObserver(schedulePlacementAnchor);
		observer.observe(serviceCard);
		return () => observer.disconnect();
	});
	$effect(() => {
		if (!ready || !active || !pendingProposal) {
			placementAnchor = null;
			pendingPlacementFocused = false;
			placementDragging = false;
			return;
		}
		// The decision can change as costs or the land check resolve; keep the card anchored.
		void pendingProposal.coordinates;
		void pendingPlacementDecision;
		schedulePlacementAnchor();
		if (!pendingPlacementFocused) {
			pendingPlacementFocused = true;
			closeInspection();
			void tick()
				.then(() => {
					keepPlacementVisible();
					updatePlacementAnchor();
					return tick();
				})
				.then(() => {
					keepPlacementVisible();
					updatePlacementAnchor();
					focusPlacementDecision();
				});
		}
	});
	$effect(() => {
		void placementKind;
		void picking;
		void pendingProposal;
		void placementRoads;
		void selectedId;
		void features;
		if (!ready || !active) return;
		if (!pendingProposal && (!picking || !placementKind)) {
			placementPreview = null;
			previewPointer = null;
		} else untrack(schedulePlacementPreview);
	});
	$effect(() => {
		void selectedProposal;
		if (!selectedProposal || pendingProposal || picking || !active || presentation) {
			selectedProposalIndex = null;
			proposalEditAnchor = null;
		} else untrack(schedulePlacementAnchor);
	});
	$effect(() => {
		const selected = selectedProposalIndex;
		untrack(() => {
			for (const [index, marker] of policyMarkers)
				marker.getElement().classList.toggle('selected', index === selected);
		});
	});
	$effect(() => {
		if (!placementCard) return;
		const observer = new ResizeObserver(schedulePlacementAnchor);
		observer.observe(placementCard);
		return () => observer.disconnect();
	});

	$effect(() => {
		if (!ready || !active || !map) return;
		setData('policy-gaps', backgroundGaps);
	});
	$effect(() => {
		if (!ready || !active || !map) return;
		setData('policy-coverage-fill', coverageFillFeatures);
	});
	$effect(() => {
		if (!ready || !active || !map) return;
		setData('policy-impact', impactFeatures);
	});
	$effect(() => {
		if (!ready || !map) return;
		const scopeChanged = lastFeedbackIsland !== selectedId || lastFeedbackLens !== gapLens;
		if (scopeChanged) {
			const hadScope = lastFeedbackLens !== null;
			lastFeedbackIsland = selectedId;
			lastFeedbackLens = gapLens;
			lastImpactEvaluationId = policyEvaluationId;
			previousEvaluatedImpact = policyEvaluationId ? impactFeatures : null;
			suppressedScopeOperations =
				hadScope && !policyEvaluationId
					? JSON.stringify(policyOperations.filter((operation) => !operation.metadata?.ui_preview))
					: null;
			untrack(stopImpactFeedback);
			return;
		}
		// An empty accepted draft shows the baseline again. It starts a new visual
		// comparison, unlike a transient null token while a nonempty draft updates.
		if (
			!policyEvaluationId &&
			!policyComparisonPending &&
			!comparisonPreview &&
			!policyCalculating &&
			!policyStale &&
			!pendingProposal &&
			!policyOperations.some((operation) => !operation.metadata?.ui_preview)
		) {
			previousEvaluatedImpact = null;
			lastImpactEvaluationId = null;
			suppressedScopeOperations = null;
			untrack(stopImpactFeedback);
			return;
		}
		if (
			!active ||
			overlayOpacity <= 0 ||
			policyComparisonView === 'current' ||
			policyComparisonPending ||
			comparisonPreview ||
			policyCalculating ||
			policyStale ||
			pendingProposal
		) {
			untrack(stopImpactFeedback);
		}
		if (
			!policyEvaluationId ||
			policyComparisonPending ||
			comparisonPreview ||
			policyCalculating ||
			policyStale
		)
			return;
		if (policyEvaluationId === lastImpactEvaluationId) return;
		lastImpactEvaluationId = policyEvaluationId;
		const previous = previousEvaluatedImpact;
		previousEvaluatedImpact = impactFeatures;
		const suppressed =
			suppressedScopeOperations !== null &&
			suppressedScopeOperations ===
				JSON.stringify(policyOperations.filter((operation) => !operation.metadata?.ui_preview));
		suppressedScopeOperations = null;
		// A completed evaluation is consumed even while hidden/current-access: revisiting
		// a tab or changing the lens must never replay an old proposal as a fresh change.
		if (!active || policyComparisonView === 'current' || pendingProposal || suppressed) return;
		const changed = changedImpactCells(impactFeatures, previous);
		untrack(() => showImpactFeedback(changed));
	});
	$effect(() => {
		if (!ready || !map || !active) return;
		setData('placement-roads', placementRoadHints);
	});
	$effect(() => {
		if (!ready || !map || !active) return;
		const focused = !!focusContext;
		const quiet = !!presentation?.emphasis?.quietContext;
		const duration = shouldAnimateMotion() ? 160 : 0;
		for (const id of [
			'facilities-symbols',
			'transport-symbols',
			'bus-stop-symbols',
			'poi-clusters',
			'live-symbols',
			'live-vessel-symbols',
			'live-vessel-clusters'
		])
			map.setPaintProperty(id, 'icon-opacity-transition', { duration });
		map.setPaintProperty('facilities-symbols', 'icon-opacity', [
			'*',
			quiet ? 0.22 : 1,
			!focused
				? 1
				: focusContext === 'health'
					? ['match', ['get', 'category'], ['hospital', 'clinic', 'health_center'], 1, 0.3]
					: focusContext === 'education'
						? ['match', ['get', 'category'], 'school', 1, 0.3]
						: 0.3
		]);
		map.setPaintProperty(
			'transport-symbols',
			'icon-opacity',
			quiet ? 0.38 : !focused ? 1 : ['bus', 'ferry', 'journey'].includes(focusContext) ? 0.85 : 0.4
		);
		map.setPaintProperty(
			'bus-stop-symbols',
			'icon-opacity',
			quiet ? 0.48 : !focused ? 1 : ['bus', 'journey'].includes(focusContext) ? 0.85 : 0.4
		);
		map.setPaintProperty('poi-clusters', 'icon-opacity', quiet ? 0.24 : focused ? 0.45 : 1);
		for (const id of ['live-symbols', 'live-vessel-symbols']) {
			map.setPaintProperty(id, 'icon-opacity', [
				'*',
				quiet ? 0.12 : focused ? 0.32 : 1,
				['case', ['get', 'stale'], 0.48, 1]
			]);
			map.setPaintProperty(id, 'text-opacity', quiet ? 0.12 : focused ? 0.32 : 1);
		}
		map.setPaintProperty('live-vessel-clusters', 'icon-opacity', [
			'*',
			quiet ? 0.12 : focused ? 0.32 : 1,
			['case', ['==', ['get', 'stale_count'], ['get', 'point_count']], 0.48, 1]
		]);
		map.setPaintProperty('route-vehicle-symbols', 'icon-opacity', [
			'*',
			quiet ? 0.24 : 1,
			['coalesce', ['get', 'opacity'], 1]
		]);
		map.setPaintProperty('facilities-fill', 'fill-opacity', quiet ? 0.1 : 0.45);
		map.setPaintProperty('transport-fill', 'fill-opacity', quiet ? 0.1 : 0.24);
		map.setPaintProperty('transport-lines', 'line-opacity', quiet ? 0.24 : 0.85);
	});
	$effect(() => {
		if (!ready || !active || !map) return;
		setData('policy-service', policyServiceFeatures);
		if (inspectedSource === 'policy-service') closeInspection();
	});
	$effect(() => {
		if (!ready || !active || !map) return;
		setData('sea-network', seaState?.features ?? emptyCollection);
		setData('sea-islands', seaIslandFeatures(layers.islands, seaState));
		untrack(() => {
			if (inspectedSource === 'sea-network' && inspectedSeaFeatures !== seaState?.features)
				closeInspection();
		});
	});
	$effect(() => {
		if (!ready || !active || !map) return;
		setData('air-network', airFeatures);
		untrack(() => {
			if (inspectedSource === 'air-network' && inspectedAirNetwork !== airState) closeInspection();
		});
	});
	$effect(() => {
		if (!ready || !active || !map) return;
		// Path switches affect paint layers only; vehicles and terminal sources stay intact.
		for (const id of [
			'sea-route-casing',
			'sea-route-line',
			'sea-route-unverified',
			'sea-route-arrows'
		])
			map.setLayoutProperty(id, 'visibility', seaView ? 'visible' : 'none');
		for (const id of ['air-route-casing', 'air-route-line'])
			map.setLayoutProperty(id, 'visibility', airLayerEnabled ? 'visible' : 'none');
	});
	$effect(() => {
		if (!ready || !active || !map) return;
		const paths = preparedVehicles;
		const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
		let timer: ReturnType<typeof setInterval> | undefined;
		function update() {
			// Only vehicle points change. The much larger route geometries stay in their sources.
			const now = Date.now();
			setData('route-vehicles', routeVehicleFeatures(paths, now / 1000, motion.matches, now));
		}
		function sync() {
			clearInterval(timer);
			timer = undefined;
			const shouldAnimate = paths.length > 0 && !motion.matches && !document.hidden;
			routeVehiclesAnimating = shouldAnimate;
			update();
			if (shouldAnimate) timer = setInterval(update, 125);
		}
		sync();
		motion.addEventListener('change', sync);
		document.addEventListener('visibilitychange', sync);
		return () => {
			clearInterval(timer);
			routeVehiclesAnimating = false;
			motion.removeEventListener('change', sync);
			document.removeEventListener('visibilitychange', sync);
		};
	});
	$effect(() => {
		if (!ready || !active || !map) return;
		const quiet = !!presentation?.emphasis?.quietContext;
		const focusAirport =
			hoveredAirAirport ||
			airState?.airports.find((airport) => airport.island_id && airport.island_id === selectedId)
				?.iata ||
			'';
		const selected: import('maplibre-gl').ExpressionSpecification = [
			'==',
			['get', 'route_id'],
			inspectedAirRouteId || '__none__'
		];
		const connected: import('maplibre-gl').ExpressionSpecification = [
			'any',
			selected,
			['==', ['get', 'from_iata'], focusAirport || '__none__'],
			['==', ['get', 'to_iata'], focusAirport || '__none__']
		];
		const regional: import('maplibre-gl').ExpressionSpecification = [
			'==',
			['get', 'connection_role'],
			'regional'
		];
		const focused = !!focusAirport || !!inspectedAirRouteId;
		const normal: import('maplibre-gl').ExpressionSpecification = [
			'case',
			connected,
			2.4,
			regional,
			1.8,
			1
		];
		map.setPaintProperty('air-route-line', 'line-width', [
			'interpolate',
			['linear'],
			['zoom'],
			5,
			['*', normal, 0.85],
			9,
			normal,
			14,
			['*', normal, 0.9]
		]);
		map.setPaintProperty('air-route-casing', 'line-width', ['+', normal, 1.6]);
		map.setPaintProperty('air-route-casing', 'line-opacity', [
			'*',
			quiet ? 0.16 : 1,
			['case', connected, 0.65, focused ? 0.1 : 0.25]
		]);
		map.setPaintProperty('air-route-line', 'line-opacity-transition', {
			duration: reducedMotion() ? 0 : 160
		});
		map.setPaintProperty('air-route-line', 'line-opacity', [
			'interpolate',
			['linear'],
			['zoom'],
			5,
			[
				'*',
				quiet ? 0.2 : 1,
				['case', connected, 1, focused ? 0.12 : ['case', regional, 0.9, 0.32]]
			],
			10,
			[
				'*',
				quiet ? 0.2 : 1,
				['case', connected, 1, focused ? 0.16 : ['case', regional, 0.9, 0.55]]
			],
			15,
			['*', quiet ? 0.2 : 1, ['case', connected, 1, focused ? 0.16 : 0.6]]
		]);
		const stops =
			airState?.routes.find((route) => route.id === inspectedAirRouteId)?.itinerary_iata ?? [];
		map.setPaintProperty('air-airport-points', 'circle-stroke-width', [
			'case',
			[
				'any',
				['==', ['get', 'iata'], focusAirport || '__none__'],
				['in', ['get', 'iata'], ['literal', stops]]
			],
			2.5,
			1.4
		]);
	});
	$effect(() => {
		if (!ready || !active || !map) return;
		const quiet = !!presentation?.emphasis?.quietContext;
		const focusRoute = presentation?.inspect?.mode === 'ferry' ? presentation.inspect.routeId : '';
		const selected: import('maplibre-gl').ExpressionSpecification = [
			'any',
			['==', ['get', 'selected'], true],
			['==', ['get', 'route_id'], inspectedSeaRouteId || '__none__']
		];
		map.setPaintProperty('sea-route-casing', 'line-width', routeLineWidth(selected, 3.6, 5.4));
		for (const id of ['sea-route-line', 'sea-route-unverified']) {
			map.setPaintProperty(id, 'line-width', routeLineWidth(selected, 1.7, 3.2));
			map.setPaintProperty(id, 'line-opacity-transition', { duration: reducedMotion() ? 0 : 240 });
			map.setPaintProperty(id, 'line-opacity', [
				'interpolate',
				['linear'],
				['zoom'],
				5,
				quiet
					? [
							'case',
							['==', ['get', 'route_id'], focusRoute || '__none__'],
							0.72 * 0.65,
							0.72 * 0.14
						]
					: 0.72,
				9,
				quiet
					? ['case', ['==', ['get', 'route_id'], focusRoute || '__none__'], 0.8 * 0.65, 0.8 * 0.14]
					: 0.8,
				14,
				quiet
					? [
							'case',
							['==', ['get', 'route_id'], focusRoute || '__none__'],
							0.58 * 0.65,
							0.58 * 0.14
						]
					: 0.58
			]);
		}
		map.setPaintProperty('sea-route-casing', 'line-opacity', quiet ? 0.06 : 0.4);
		map.setPaintProperty('sea-route-arrows', 'text-opacity', quiet ? 0.12 : 0.6);
		for (const id of ['sea-island-points', 'sea-port-points']) {
			map.setPaintProperty(id, 'circle-opacity', quiet ? 0.3 : 1);
			map.setPaintProperty(id, 'circle-stroke-opacity', quiet ? 0.3 : 1);
		}
		map.setPaintProperty('sea-port-labels', 'text-opacity', quiet ? 0.4 : 1);
	});
	$effect(() => {
		if (!ready || !active || !map) return;
		const key = `${gapLens}_gap`;
		const color: import('maplibre-gl').ExpressionSpecification = [
			'case',
			['==', ['get', key], null],
			GAP_PALETTE.unknown,
			[
				'interpolate',
				['linear'],
				['to-number', ['get', key]],
				0,
				GAP_PALETTE.shorter,
				0.5,
				GAP_PALETTE.middle,
				1,
				GAP_PALETTE.longer
			]
		];
		map.setPaintProperty('policy-gaps-fill', 'fill-color', color);
		map.setPaintProperty('policy-coverage-fill', 'fill-color', color);
		map.setPaintProperty('policy-gaps-points', 'circle-color', color);
	});
	$effect(() => {
		if (!ready || !active || !map) return;
		// Quotes and impact-source updates do not recreate or rewrite placement markers.
		void policyOperations;
		void pendingProposal;
		void placementTitle;
		void presentation;
		untrack(syncPolicyMarkers);
	});
	$effect(() => {
		if (!ready || !active || !map) return;
		const entries = policyOperations.flatMap((operation, index) =>
			validCoordinates(operation.coordinates) &&
			!operation.metadata?.ui_package &&
			!operation.metadata?.ui_preview
				? [{ index, coordinates: operation.coordinates as Coordinates }]
				: []
		);
		const previous = acceptedPositions;
		acceptedPositions = entries;
		const islandId = selectedId;
		if (!previous || entries.length < previous.length || pendingProposal) return;
		const changed = entries.findLast((entry) => {
			const prior = previous.find((item) => item.index === entry.index);
			return (
				!prior ||
				prior.coordinates[0] !== entry.coordinates[0] ||
				prior.coordinates[1] !== entry.coordinates[1]
			);
		});
		if (!changed) return;
		let canceled = false;
		let frame = 0;
		void tick().then(() => {
			if (canceled) return;
			frame = requestAnimationFrame(() => {
				if (selectedId !== islandId) return;
				keepAcceptedPointVisible(changed.coordinates);
				if (!active || !shouldAnimateMotion()) return;
				// Animate the inner symbol, never MapLibre's positioning transform.
				policyMarkers
					.get(changed.index)
					?.getElement()
					.querySelector('svg')
					?.animate(
						[
							{ transform: 'translateY(-3px) scale(0.94)' },
							{ transform: 'translateY(0) scale(1)' }
						],
						{ duration: 220, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }
					);
			});
		});
		return () => {
			canceled = true;
			cancelAnimationFrame(frame);
		};
	});
	$effect(() => {
		if (!ready || !active || !map) return;
		// Opacity changes paint only: no source rebuilding, evidence fetching or recalculation.
		const transition = { duration: reducedMotion() ? 0 : presentation ? 420 : 180 };
		for (const id of ['policy-current-fill', 'policy-impact-fill'])
			map.setPaintProperty(id, 'fill-opacity-transition', transition);
		map.setPaintProperty('policy-coverage-fill', 'fill-opacity', coverageFillOpacity);
		map.setPaintProperty('policy-coverage-fill-outline', 'line-opacity', coverageFillOpacity * 0.7);
		map.setPaintProperty('policy-gaps-fill', 'fill-opacity', gapOpacity);
		map.setPaintProperty('policy-gaps-points', 'circle-opacity', gapOpacity);
		map.setPaintProperty('policy-gaps-points', 'circle-stroke-opacity', gapOpacity);
		map.setPaintProperty('policy-gaps-outline', 'line-opacity', gapOpacity * 0.7);
		map.setPaintProperty('policy-current-fill', 'fill-opacity', currentAccessOpacity);
		map.setPaintProperty(
			'policy-impact-fill',
			'fill-opacity',
			currentAccessOpacity ? 0 : impactOpacity
		);
		map.setPaintProperty('policy-impact-outline', 'line-opacity', impactOpacity * 0.7);
		map.setPaintProperty(
			'selected-island',
			'fill-opacity',
			seaState || hasPolicyOverlay ? 0 : 0.09
		);
	});
	$effect(() => {
		void presentationProposalKey;
		const instance = map;
		if (!ready || !active || !instance) return;
		const point = untrack(() => presentation?.emphasis?.proposalPoint);
		setData(
			'presentation-proposal-focus',
			point && validCoordinates(point)
				? collection([
						{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: point } }
					])
				: emptyCollection
		);
		instance.setPaintProperty('presentation-proposal-pulse', 'circle-opacity', 0);
		instance.setPaintProperty('presentation-proposal-pulse', 'circle-stroke-opacity', 0);
		if (!point || presentationPhase !== 'complete' || reducedMotion() || document.hidden) return;
		let frame = 0;
		const started = performance.now();
		function stop() {
			cancelAnimationFrame(frame);
			if (!instance!.getLayer('presentation-proposal-pulse')) return;
			instance!.setPaintProperty('presentation-proposal-pulse', 'circle-opacity', 0);
			instance!.setPaintProperty('presentation-proposal-pulse', 'circle-stroke-opacity', 0);
		}
		function pulse(now: number) {
			const progress = Math.min(1, (now - started) / 1000);
			instance!.setPaintProperty(
				'presentation-proposal-pulse',
				'circle-radius',
				12 + progress * 26
			);
			instance!.setPaintProperty(
				'presentation-proposal-pulse',
				'circle-opacity',
				0.08 * (1 - progress)
			);
			instance!.setPaintProperty(
				'presentation-proposal-pulse',
				'circle-stroke-opacity',
				0.45 * (1 - progress)
			);
			if (progress < 1) frame = requestAnimationFrame(pulse);
		}
		frame = requestAnimationFrame(pulse);
		document.addEventListener('visibilitychange', stop);
		return () => {
			stop();
			document.removeEventListener('visibilitychange', stop);
		};
	});
	$effect(() => {
		if (!overlayPreferenceLoaded) return;
		try {
			window.localStorage.setItem(OVERLAY_OPACITY_KEY, String(overlayOpacity));
		} catch {
			// Storage permissions do not prevent adjusting the current map.
		}
	});
	$effect(() => {
		if (!ready || !active || !map) return;
		setData(
			'conditions-route',
			collection(
				conditionRoute.length > 1
					? [
							{
								type: 'Feature',
								properties: {},
								geometry: { type: 'LineString', coordinates: conditionRoute }
							}
						]
					: []
			)
		);
	});
	$effect(() => {
		const scene = presentation;
		if (!ready || !map) return;
		setData(
			'presentation-routes',
			active && scene
				? presentationRouteFeatures(preparePresentationPaths(scene.paths))
				: emptyCollection
		);
		setData('presentation-population', emptyCollection);
		if (!active || !scene) return;
		if (scene.population) {
			const maximum = Math.max(
				1,
				...scene.population.features.map((feature) => Number(feature.properties?.population) || 0)
			);
			setData('presentation-population', {
				...scene.population,
				features: scene.population.features.map((feature) => ({
					...feature,
					properties: {
						...feature.properties,
						presentation_population_fraction:
							Math.max(0, Number(feature.properties?.population) || 0) / maximum
					}
				}))
			});
		}
	});
	$effect(() => {
		const customAirplane = !!presentation && presentationAirplaneReady;
		if (!map || !ready) return;
		const aircraftIcon = customAirplane ? 'presentation-airplane' : 'atlas-route-aircraft';
		map.setLayoutProperty('route-vehicle-symbols', 'icon-image', [
			'match',
			['get', 'mode'],
			'air',
			aircraftIcon,
			'atlas-route-vessel'
		]);
		map.setLayoutProperty('presentation-vehicle-symbol', 'icon-image', [
			'match',
			['get', 'mode'],
			'ferry',
			'atlas-route-vessel',
			'air',
			aircraftIcon,
			'bus',
			'atlas-live-bus',
			'atlas-origin'
		]);
		map.setLayoutProperty('presentation-vehicle-symbol', 'icon-size', [
			'match',
			['get', 'mode'],
			'air',
			customAirplane ? 1.18 : 1.1,
			1.1
		]);
		map.setPaintProperty('presentation-vehicle-halo', 'circle-opacity', [
			'case',
			['==', ['get', 'mode'], 'air'],
			customAirplane ? 0 : 0.95,
			0.95
		]);
		map.setPaintProperty('presentation-vehicle-halo', 'circle-stroke-opacity', [
			'case',
			['==', ['get', 'mode'], 'air'],
			customAirplane ? 0 : 1,
			1
		]);
	});
	$effect(() => {
		void presentationMotionKey;
		const scene = untrack(() => presentation);
		const instance = map;
		if (!ready || !instance) return;
		let reportedProgress = 0;
		function reportProgress(progress: number, phase: PresentationProgress['phase']) {
			reportedProgress = progress;
			untrack(() => onPresentationProgress?.({ key: scene?.key ?? '', progress, phase }));
		}
		function setPresentationPhase(phase: PresentationProgress['phase']) {
			presentationPhase = phase;
			reportProgress(reportedProgress, phase);
		}
		presentationAnimating = false;
		presentationFollowing = false;
		presentationProgress = 0;
		setPresentationPhase('idle');
		setData('presentation-vehicle', emptyCollection);
		if (!active || !scene) return;
		const paths = preparePresentationPaths(scene.paths);
		let frame = 0;
		let startedAt = 0;
		let pausedAt: number | null = document.hidden ? performance.now() : null;
		let canceled = false;
		let lastPaint = 0;
		let lastFollow = 0;
		let followInterrupted = false;
		let entryTimer: ReturnType<typeof setTimeout> | undefined;
		let entryStage: 'overview' | 'hold' | 'approach' = 'overview';
		const duration = Math.max(1, scene.playback?.durationMs ?? 1);
		const entryDuration = Math.max(0, scene.camera.durationMs ?? 1400);
		const establishDuration = Math.max(0, scene.playback?.establishMs ?? 750);
		const padding = presentationCameraPadding(
			container.clientWidth,
			container.clientHeight,
			scene.panel
		);
		const firstPosition = presentationPosition(paths, 0);
		const followZoom =
			'zoom' in scene.camera
				? scene.camera.zoom
				: firstPosition?.mode === 'air'
					? 8.3
					: firstPosition?.mode === 'ferry'
						? 12.2
						: firstPosition?.mode === 'walk'
							? 15.4
							: 14.9;
		const easing = (value: number) => value * value * (3 - 2 * value);

		function openSceneInspection() {
			const inspection = untrack(() => presentation?.inspect);
			if (!inspection || canceled || document.hidden) return;
			inspectPresentationRoute(inspection);
		}

		function paint(progress: number, now: number, instant = false, follow = true) {
			const position = presentationPosition(paths, progress);
			setData('presentation-vehicle', presentationVehicleFeatures(position));
			presentationProgress = progress;
			reportProgress(progress, presentationPhase);
			if (
				follow &&
				scene?.playback?.follow &&
				position &&
				!followInterrupted &&
				(instant || now - lastFollow >= 160 || progress === 1)
			) {
				lastFollow = now;
				const target = presentationPosition(paths, Math.min(1, progress + 280 / duration));
				const camera = {
					center: (target ?? position).point,
					zoom: followZoom,
					padding,
					pitch: scene.camera.pitch ?? 0,
					bearing: scene.camera.bearing ?? 0
				};
				if (instant) instance!.jumpTo(camera);
				else
					instance!.easeTo({
						...camera,
						duration: progress === 1 ? 600 : 420,
						easing: (value) => 1 - (1 - value) * (1 - value)
					});
			}
		}
		function animate(now: number) {
			if (canceled || pausedAt !== null) return;
			const progress = Math.min(1, (now - startedAt) / duration);
			if (now - lastPaint >= 32 || progress === 1) {
				paint(progress, now);
				lastPaint = now;
			}
			if (progress < 1) frame = requestAnimationFrame(animate);
			else {
				presentationAnimating = false;
				setPresentationPhase('complete');
			}
		}
		function startPlayback() {
			if (canceled || document.hidden || followInterrupted) return;
			if (!scene?.playback || !paths.length) {
				setPresentationPhase('complete');
				untrack(openSceneInspection);
				return;
			}
			startedAt = performance.now();
			if (reducedMotion()) {
				paint(1, startedAt, true);
				setPresentationPhase('complete');
				return;
			}
			setPresentationPhase('playing');
			presentationFollowing = !!scene.playback.follow;
			paint(0, startedAt);
			presentationAnimating = true;
			frame = requestAnimationFrame(animate);
		}
		function approachVehicle() {
			if (canceled || document.hidden || followInterrupted) return;
			entryStage = 'approach';
			if (!scene?.playback?.follow || !firstPosition) {
				startPlayback();
				return;
			}
			instance!.on('moveend', finishEntry);
			instance!.easeTo({
				center: firstPosition.point,
				zoom: followZoom,
				padding,
				pitch: scene.camera.pitch ?? 0,
				bearing: scene.camera.bearing ?? 0,
				duration: 850,
				easing
			});
			if (!instance!.isMoving()) finishEntry();
		}
		function finishEntry() {
			if (canceled || presentationPhase !== 'entering' || document.hidden || followInterrupted)
				return;
			instance!.off('moveend', finishEntry);
			if (scene?.playback && paths.length && entryStage === 'overview' && !reducedMotion()) {
				entryStage = 'hold';
				// Both endpoints stay visible before the camera approaches the moving vehicle.
				paint(0, performance.now(), false, false);
				entryTimer = setTimeout(approachVehicle, establishDuration);
				return;
			}
			startPlayback();
		}
		function enterScene() {
			if (canceled) return;
			setPresentationPhase('entering');
			if (document.hidden) {
				pausedAt = performance.now();
				return;
			}
			instance!.resize();
			clearTimeout(entryTimer);
			instance!.off('moveend', finishEntry);
			instance!.stop();
			untrack(closeInspection);
			entryStage = 'overview';
			const camera = scene!.camera;
			const routeBounds = scene?.playback ? presentationPathBounds(paths) : null;
			const bounds = routeBounds ?? ('bounds' in camera ? camera.bounds : null);
			const framing = bounds
				? instance!.cameraForBounds(bounds, {
						absolutePadding: true,
						padding,
						maxZoom: 'zoom' in camera ? camera.zoom : (camera.maxZoom ?? 15),
						bearing: camera.bearing ?? 0
					})
				: 'center' in camera
					? { center: camera.center, zoom: camera.zoom }
					: undefined;
			instance!.on('moveend', finishEntry);
			instance!.flyTo({
				...framing,
				padding,
				pitch: camera.pitch ?? 0,
				bearing: camera.bearing ?? 0,
				duration: reducedMotion() ? 0 : entryDuration,
				curve: 1.35,
				easing
			});
			if (!instance!.isMoving()) finishEntry();
		}
		function stopFollowing() {
			if (followInterrupted) return;
			followInterrupted = true;
			presentationFollowing = false;
			clearTimeout(entryTimer);
			cancelAnimationFrame(frame);
			instance!.off('moveend', finishEntry);
			// Cancel once on pointerdown; subsequent drag events retain their gesture handlers.
			instance!.stop();
			presentationAnimating = false;
			if (scene?.playback && presentationPhase !== 'complete') {
				paint(reportedProgress, performance.now(), false, false);
				setPresentationPhase('paused');
			} else if (presentationPhase === 'entering') {
				setPresentationPhase('complete');
				untrack(openSceneInspection);
			}
		}
		function interruptFollow(event: { originalEvent?: unknown }) {
			if (event.originalEvent) stopFollowing();
		}
		function visibilityChanged() {
			if (document.hidden) {
				pausedAt = performance.now();
				cancelAnimationFrame(frame);
				clearTimeout(entryTimer);
				instance!.off('moveend', finishEntry);
				instance!.stop();
				presentationAnimating = false;
				setData('presentation-vehicle', emptyCollection);
				reportProgress(reportedProgress, 'idle');
			} else if (pausedAt !== null) {
				startedAt += performance.now() - pausedAt;
				pausedAt = null;
				if (presentationPhase === 'entering') enterScene();
				else if (scene?.playback) {
					if (reducedMotion() || presentationPhase === 'complete')
						paint(1, performance.now(), reducedMotion());
					else if (presentationPhase === 'playing') {
						presentationAnimating = true;
						frame = requestAnimationFrame(animate);
					} else if (presentationPhase === 'paused')
						paint(reportedProgress, performance.now(), false, false);
				}
				// Static panels also consume progress events to reveal their settled state.
				reportProgress(reportedProgress, presentationPhase);
			}
		}
		// Keep next/back interruptible: each new scene starts from the camera's current position.
		frame = requestAnimationFrame(enterScene);
		const canvas = instance.getCanvas();
		canvas.addEventListener('pointerdown', stopFollowing, { capture: true });
		canvas.addEventListener('wheel', stopFollowing, { capture: true, passive: true });
		document.addEventListener('visibilitychange', visibilityChanged);
		instance.on('dragstart', interruptFollow);
		instance.on('zoomstart', interruptFollow);
		instance.on('rotatestart', interruptFollow);
		instance.on('pitchstart', interruptFollow);
		return () => {
			canceled = true;
			reportProgress(reportedProgress, 'idle');
			cancelAnimationFrame(frame);
			clearTimeout(entryTimer);
			canvas.removeEventListener('pointerdown', stopFollowing, { capture: true });
			canvas.removeEventListener('wheel', stopFollowing, { capture: true });
			document.removeEventListener('visibilitychange', visibilityChanged);
			instance.off('moveend', finishEntry);
			instance.off('dragstart', interruptFollow);
			instance.off('zoomstart', interruptFollow);
			instance.off('rotatestart', interruptFollow);
			instance.off('pitchstart', interruptFollow);
			instance.stop();
		};
	});
	$effect(() => {
		const inspection = presentation?.inspect;
		if (!ready || !active || !inspection || presentationPhase !== 'complete') return;
		const network = inspection.mode === 'air' ? airState : seaState;
		if (!inspection.summary && !network?.routes?.some((route) => route.id === inspection.routeId))
			return;
		const current = untrack(() =>
			inspection.mode === 'air' ? inspectedAirRouteId : inspectedSeaRouteId
		);
		const signature = JSON.stringify(inspection);
		if (
			current !== inspection.routeId ||
			signature !== untrack(() => inspectedPresentationSignature)
		)
			untrack(() => inspectPresentationRoute(inspection));
	});
	$effect(() => {
		if (!ready || !active || !map || presentation || !focusBounds) return;
		const bounds = focusBounds.bounds;
		userZoomGesture = null;
		untrack(() => {
			const padding = seaInspectorOpen
				? container.clientWidth > 700
					? { top: container.clientWidth > 1100 ? 100 : 155, bottom: 70, left: 420, right: 50 }
					: {
							top: 150,
							bottom: Math.round(container.clientHeight * 0.54) + 12,
							left: 24,
							right: 24
						}
				: window.innerWidth > 900
					? { top: 150, bottom: 230, left: 370, right: 440 }
					: {
							top: Math.min(170, Math.round(window.innerHeight * 0.2)),
							bottom: Math.round(window.innerHeight * 0.6),
							left: 40,
							right: 40
						};
			if (container.clientWidth < 700 && serviceEditor && serviceCard) {
				const viewport = serviceViewport();
				// Reserve the expanded editor's space so opening details never covers a terminal.
				const height = serviceCardMaxHeight(container.clientWidth, viewport.top, viewport.bottom);
				Object.assign(
					padding,
					mobileServiceRoutePadding(container.clientHeight, viewport.top, viewport.bottom, height)
				);
			}
			map?.fitBounds(bounds, {
				absolutePadding: true,
				maxZoom: 14.5,
				duration: reducedMotion() ? 0 : 280,
				padding
			});
		});
	});
	$effect(() => {
		if (!ready || !active || !map || presentation || !focusPoint) return;
		const coordinates = focusPoint.coordinates;
		userZoomGesture = null;
		untrack(() =>
			map?.easeTo({
				center: coordinates,
				zoom: 15.3,
				duration: reducedMotion() ? 0 : 280,
				padding:
					window.innerWidth > 900
						? { top: 100, bottom: 100, left: 50, right: 420 }
						: { top: 120, bottom: 260, left: 35, right: 35 }
			})
		);
	});
	$effect(() => {
		if (!ready || !active) return;
		setData('islands', layers.islands);
		setData('centroids', layers.centroids);
		setData('facilities', layers.facilities);
		setData('transport', layers.transport);
	});
	$effect(() => {
		if (!ready || !active || !map) return;
		setData('accessibility-centroids', accessibilityCentroids);
		map.setLayoutProperty(
			'island-centroids',
			'visibility',
			accessibilityOverview ? 'none' : 'visible'
		);
	});
	$effect(() => {
		if (!ready || !active) return;
		setData('pois', poiFeatures);
		setData('bus-stops', busStopFeatures);
		syncStopLabels();
	});
	$effect(() => {
		if (!ready || !active) return;
		setData('scenario', scenarioFeatures);
		if (inspectedSource === 'scenario') closeInspection();
	});
	$effect(() => {
		if (!ready || !active) return;
		setData('route', routeFeatures);
		setData('journey-stops', journeyStopFeatures);
		syncJourneyMarkers();
		syncStopLabels();
		if (inspectedSource === 'route' || inspectedSource === 'journey-stops') closeInspection();
	});
	$effect(() => {
		if (!ready || !active) return;
		if (presentation) return;
		if (inlineDirectionsActive) {
			if (!matchedDirections || matchedDirections === lastFittedDirections) return;
			if (!routeFeatures.features.some((feature) => feature.geometry.type === 'LineString')) return;
			lastFittedDirections = matchedDirections;
			untrack(focusJourney);
			return;
		}
		if (!route || route === lastFittedRoute) return;
		if (!routeFeatures.features.some((feature) => feature.geometry.type === 'LineString')) return;
		lastFittedRoute = route;
		untrack(focusJourney);
	});
	$effect(() => {
		if (!ready || !map || !active) return;
		for (const id of ['context-road-casing', 'context-roads'])
			map.setLayoutProperty(id, 'visibility', streetsVisible ? 'visible' : 'none');
		for (const id of ['context-buildings', 'context-green'])
			map.setLayoutProperty(id, 'visibility', buildingsVisible ? 'visible' : 'none');
		diagnosticsDirty.context = true;
		syncStreetLabels();
		syncStopLabels();
		const canvas = map.getCanvas();
		canvas.setAttribute(
			'aria-label',
			picking
				? 'Place a point on the Maldives map. Use arrow keys to pan, Enter to confirm the map center, or Escape to cancel.'
				: 'Maldives planning map. Use arrow keys to pan and plus or minus to zoom.'
		);
		if (picking && !pickerFocused) {
			pickerTrigger =
				document.activeElement instanceof HTMLElement && document.activeElement !== canvas
					? document.activeElement
					: null;
			pickerFocused = true;
			canvas.focus();
		} else if (!picking && pickerFocused) {
			pickerFocused = false;
			if (
				pickerTrigger?.isConnected &&
				(document.activeElement === canvas || document.activeElement === document.body)
			)
				pickerTrigger.focus({ preventScroll: true });
			pickerTrigger = null;
		}
	});
	$effect(() => {
		if (!ready || !active) return;
		smoothLiveData(liveFeatures);
		if (inspectedSource === 'live' || inspectedSource === 'live-vessels') closeInspection();
	});
	$effect(() => {
		if (!ready || !map || !active) return;
		const instance = map;
		function updateBadges() {
			const now = Date.now();
			const label: import('maplibre-gl').ExpressionSpecification = [
				'case',
				[
					'all',
					['==', ['get', 'live_badge_eligible'], true],
					['>=', ['coalesce', ['get', 'live_observed_at'], 0], now - 300_000],
					['<=', ['coalesce', ['get', 'live_observed_at'], 0], now + 60_000]
				],
				'LIVE',
				''
			];
			for (const id of ['live-symbols', 'live-vessel-symbols'])
				instance.setLayoutProperty(id, 'text-field', label);
		}
		let timer: ReturnType<typeof setInterval> | undefined;
		function syncBadgeTimer() {
			clearInterval(timer);
			timer = undefined;
			if (document.hidden) return;
			updateBadges();
			// Expire badges even when a provider request fails; avoid rewriting position sources.
			timer = setInterval(updateBadges, 15_000);
		}
		syncBadgeTimer();
		document.addEventListener('visibilitychange', syncBadgeTimer);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', syncBadgeTimer);
		};
	});
	$effect(() => {
		if (!ready || !map || !active) return;
		for (const id of ['facilities-fill', 'facilities-symbols'])
			map.setLayoutProperty(id, 'visibility', facilitiesVisible ? 'visible' : 'none');
		for (const id of ['transport-fill', 'transport-lines', 'transport-symbols', 'bus-stop-symbols'])
			map.setLayoutProperty(id, 'visibility', transportVisible ? 'visible' : 'none');
		for (const id of ['live-symbols', 'live-vessel-symbols', 'live-vessel-clusters'])
			map.setLayoutProperty(id, 'visibility', liveVisible ? 'visible' : 'none');
		diagnosticsDirty.places = true;
		diagnosticsDirty.movement = true;
		syncMovementCounts();
		syncStopLabels();
		map.getCanvas().style.cursor = picking || islandPicking ? 'crosshair' : '';
		if (
			picking ||
			(inspectedSource === 'facilities' && !facilitiesVisible) ||
			(inspectedSource === 'transport' && !transportVisible) ||
			(['live', 'live-vessels'].includes(inspectedSource ?? '') && !liveVisible)
		)
			closeInspection();
		if (picking) controlsPanel = null;
		hoverDescription = '';
	});
	$effect(() => {
		if (!ready || !map || !active) return;
		for (const id of ['selected-island', 'selected-outline', 'selected-centroid'])
			map.setFilter(id, ['==', ['get', 'id'], selectedId ?? '']);
		if (inspectionPopup && inspectedIslandId !== selectedId) closeInspection();
		if (selectedIsland && makeMarker) {
			const centroid = selectedIsland.properties?.centroid;
			const bounds = selectedIsland.geometry && boundsOf(selectedIsland.geometry);
			const coordinates: Coordinates | null = validCoordinates(centroid)
				? [centroid[0], centroid[1]]
				: bounds
					? [(bounds[0][0] + bounds[1][0]) / 2, (bounds[0][1] + bounds[1][1]) / 2]
					: null;
			if (coordinates) {
				if (selectedMarker) {
					selectedMarker.getElement().textContent = selectedName;
					selectedMarker.setLngLat(coordinates);
					selectedMarker.getElement().hidden = !labelsVisible;
				} else {
					const label = document.createElement('div');
					label.className = 'island-map-label';
					label.textContent = selectedName;
					label.hidden = !labelsVisible;
					selectedMarker = new makeMarker({ element: label, anchor: 'bottom', offset: [0, -14] })
						.setLngLat(coordinates)
						.addTo(map);
				}
			} else {
				selectedMarker?.remove();
				selectedMarker = null;
			}
		} else {
			selectedMarker?.remove();
			selectedMarker = null;
		}
		syncIslandLabels();
	});
	$effect(() => {
		if (!ready || !map || !active) return;
		const requestedId = selectedId;
		if (presentation) return;
		// A fast cached connection can resolve before the deferred island focus.
		// Keep its corridor framing authoritative until a new island is selected.
		if (focusBounds || searchSelection || (inlineDirectionsActive && directionWaypoints.length))
			return;
		const requestedIsland = selectedIsland;
		const requestedAtoll = atollScope;
		const requestedAtollBounds = atollBounds;
		const requestedScopeBounds = scopeBounds;
		const requestedVersion = focusVersion;
		const instance = map;
		if (
			requestedId === lastFocusedId &&
			Boolean(requestedIsland) === Boolean(lastFocusedIsland) &&
			requestedAtoll === lastFocusedAtoll &&
			(requestedId || Boolean(requestedAtollBounds) === Boolean(lastFocusedAtollBounds)) &&
			requestedScopeBounds === lastFocusedScopeBounds &&
			requestedVersion === lastFocusVersion
		)
			return;
		// A detail response may replace the simplified polygon. Keep the user's current
		// camera unless the selected scope or explicit focus request actually changed.
		// Parent panels change camera insets. Read their styles after the DOM has settled.
		const frame = requestAnimationFrame(() => {
			if (
				!ready ||
				!active ||
				map !== instance ||
				presentation ||
				focusBounds ||
				searchSelection ||
				(inlineDirectionsActive && directionWaypoints.length) ||
				selectedId !== requestedId ||
				selectedIsland !== requestedIsland ||
				atollScope !== requestedAtoll ||
				atollBounds !== requestedAtollBounds ||
				scopeBounds !== requestedScopeBounds ||
				focusVersion !== requestedVersion
			)
				return;
			instance.resize();
			mapHeight = container.clientHeight;
			userZoomGesture = null;
			if (requestedScopeBounds) {
				contextualIsland = null;
				instance.fitBounds(requestedScopeBounds, {
					absolutePadding: true,
					padding: scopeFocusPadding(),
					maxZoom: 14,
					duration: reducedMotion() ? 0 : 280
				});
			} else if (requestedId && requestedId === contextualIsland) {
				// A zoom gesture is already framing this island. Reveal its detailed
				// tools without replacing the user's view with another zoom animation.
				contextualIsland = null;
				instance.easeTo({ padding: focusPadding(), duration: 0 });
			} else if (requestedId) {
				contextualIsland = null;
				focusIsland();
			} else if (requestedAtollBounds)
				instance.fitBounds(requestedAtollBounds, {
					absolutePadding: true,
					padding: focusPadding(),
					maxZoom: 11,
					duration: reducedMotion() ? 0 : 280
				});
			else fitNational();
			lastFocusedId = requestedId;
			lastFocusedIsland = requestedIsland;
			lastFocusedAtoll = requestedAtoll;
			lastFocusedAtollBounds = requestedAtollBounds;
			lastFocusedScopeBounds = requestedScopeBounds;
			lastFocusVersion = requestedVersion;
		});
		scopeFocusFrame = frame;
		return () => cancelAnimationFrame(frame);
	});
	$effect(() => {
		if (!ready || !map) return;
		cancelAnimationFrame(activationFrame);
		if (!active) {
			userZoomGesture = null;
			cancelAnimationFrame(liveFrame);
			liveAnimating = false;
			clearTimeout(contextTimer);
			contextGeneration++;
			contextRequest?.abort();
			contextPendingKey = '';
			contextLoading = false;
			controlsPanel = null;
			hoverDescription = '';
			untrack(() => {
				map?.stop();
				closeInspection();
			});
			return;
		}
		// Resize after the retained workspace is visible, preserving its camera position.
		activationFrame = requestAnimationFrame(() => {
			if (!active || !map) return;
			map.resize();
			mapHeight = container.clientHeight;
			syncIslandLabels();
			syncStreetLabels();
			syncStopLabels();
			scheduleStreetContext();
		});
	});
	$effect(() => {
		if (!ready || !map || !active || presentation || journeyFocusVersion <= 0) return;
		if (journeyFocusVersion === lastJourneyFocusVersion || !routeFeatures.features.length) return;
		const requestedVersion = journeyFocusVersion;
		// A retained map must resize after it becomes visible before fitting a selected place.
		journeyFocusFrame = requestAnimationFrame(() => {
			if (!active || !map || presentation || requestedVersion !== journeyFocusVersion) return;
			map.resize();
			mapHeight = container.clientHeight;
			focusJourney();
			lastJourneyFocusVersion = requestedVersion;
		});
		return () => cancelAnimationFrame(journeyFocusFrame);
	});
	$effect(() => {
		const selection = searchSelection;
		const instance = map;
		if (
			!ready ||
			!active ||
			!instance ||
			presentation ||
			!selection ||
			!validCoordinates(selection.coordinates)
		) {
			untrack(clearSearchPlace);
			return;
		}
		// Run after the retained map has resized and any island framing has settled.
		// Popup focus stays in search so keyboard selection does not jump into map actions.
		const frame = requestAnimationFrame(() => {
			if (!active || map !== instance || presentation || searchSelection !== selection) return;
			instance.resize();
			userZoomGesture = null;
			showSearchPlace(selection);
			instance.easeTo({
				center: selection.coordinates,
				zoom: 15.3,
				duration: reducedMotion() ? 0 : 280,
				padding: focusPadding()
			});
		});
		return () => {
			cancelAnimationFrame(frame);
			untrack(clearSearchPlace);
		};
	});
</script>

<svelte:document onpointerdown={dismissControls} onkeydown={controlsKeydown} />

<div
	class="national-map"
	data-presentation-key={presentation?.key ?? ''}
	data-presentation-progress={presentationProgress.toFixed(3)}
	data-presentation-animating={presentationAnimating}
	data-presentation-following={presentationFollowing}
	data-presentation-phase={presentationPhase}
	data-presentation-panel={presentation?.panel ?? ''}
	data-presentation-quiet={!!presentation?.emphasis?.quietContext}
	data-presentation-paths={presentation?.paths.length ?? 0}
	data-presentation-source-paths={sourceData.get('presentation-routes')?.features.length ?? 0}
	data-presentation-population={presentation?.population?.features.length ?? 0}
	data-presentation-end-longitude={presentationPathEnd?.[0]}
	data-presentation-end-latitude={presentationPathEnd?.[1]}
	data-presentation-min-latitude={presentationMinLatitude}
	data-presentation-points-in-male={presentationPointsInMale}
	data-presentation-airplane-image-ready={presentationAirplaneReady}
	data-air-routes={airLayerEnabled ? (airState?.map_features.features.length ?? 0) : 0}
	data-air-network-routes={airState?.map_features.features.length ?? 0}
	data-air-airports={airState?.airports.length ?? 0}
	data-air-selected-route={inspectedAirRouteId || undefined}
	data-air-hover-airport={hoveredAirAirport || undefined}
	data-route-vehicles={preparedVehicles.reduce(
		(total, route) => total + (route.bidirectional ? 2 : 1),
		0
	)}
	data-route-vehicle-animation={routeVehiclesAnimating}
	data-sea-view={seaView}
	data-sea-selected-route={inspectedSeaRouteId || undefined}
	data-sea-routes={seaView
		? (seaState?.features.features.filter((feature) => feature.geometry.type === 'LineString')
				.length ?? 0)
		: 0}
	data-sea-network-routes={seaState?.features.features.filter(
		(feature) => feature.geometry.type === 'LineString'
	).length ?? 0}
	data-sea-terminals={seaState?.features.features.filter(
		(feature) => feature.properties?.kind === 'sea_terminal'
	).length ?? 0}
	data-sea-mode={seaState?.mode ?? ''}
	class:is-picking={picking}
	data-active={active}
	data-atoll-scope={atollScope ?? ''}
	data-search-place={displayedSearchPlace}
	data-directions-active={inlineDirectionsActive}
	data-directions-status={matchedDirections?.status ?? ''}
	data-directions-waypoints={directionWaypoints.length}
	data-directions-labels={directionWaypoints.map((point) => point.letter).join(',')}
	data-accessibility-overview={accessibilityOverview}
	data-accessibility-points={accessibilityCentroids.features.length}
	aria-busy={mapBusy}
	data-rendered-roads={renderedRoads}
	data-rendered-buildings={renderedBuildings}
	data-rendered-place-icons={renderedPoiIcons}
	data-map-bus-stops={busStopFeatures.features.length}
	data-journey-transit-stops={journeyStopFeatures.features.length}
	data-rendered-place-clusters={renderedClusters}
	data-rendered-movement={renderedMovement}
	data-rendered-bus-vehicles={renderedBusVehicles}
	data-visible-movement-observations={renderedMovementObservations}
	data-vessel-groups={renderedVesselGroups}
	data-movement-positions={liveFeatures.features.length}
	data-movement-transition={liveAnimating}
	data-center-longitude={centerCoordinates[0]}
	data-center-latitude={centerCoordinates[1]}
	data-camera-padding-top={cameraPadding.top}
	data-camera-padding-right={cameraPadding.right}
	data-camera-padding-bottom={cameraPadding.bottom}
	data-camera-padding-left={cameraPadding.left}
	data-journey-endpoints={routeFeatures.features.filter(
		(feature) => feature.geometry.type === 'Point'
	).length}
	data-journey-route-segments={routeFeatures.features.filter(
		(feature) => feature.geometry.type === 'LineString'
	).length}
	data-proposal-points={scenarioFeatures.features.filter(
		(feature) => feature.geometry.type === 'Point'
	).length}
	data-proposal-closed-lines={scenarioFeatures.features.filter((feature) =>
		['LineString', 'MultiLineString'].includes(feature.geometry.type)
	).length}
	data-proposal-unlocated-edits={scenarioPreview.unlocated}
	data-policy-proposal-points={policyOperations.filter((operation) =>
		validCoordinates(operation.coordinates)
	).length}
	data-policy-pending-points={pendingProposal ? 1 : 0}
	data-policy-placement-kind={placementKind ?? ''}
	data-policy-service-features={policyServiceFeatures.features.length}
	data-policy-service-editor={serviceEditor?.mode ?? ''}
	data-island-picking={islandPicking}
	data-policy-gap-cells={gapFeatures.features.length}
	data-policy-coverage-fill-cells={coverageFillFeatures.features.length}
	data-policy-coverage-fill-opacity={coverageFillOpacity}
	data-policy-local-islands={JSON.stringify(Object.keys(localAccessDiagnostics.cells))}
	data-policy-local-cells={JSON.stringify(localAccessDiagnostics.cells)}
	data-policy-background-cells={JSON.stringify(backgroundCells)}
	data-policy-screening-islands={JSON.stringify(localAccessDiagnostics.screening)}
	data-policy-gap-ranges={JSON.stringify(localAccessDiagnostics.ranges)}
	data-policy-hex-grid={gapFeatures.features.filter((feature) => feature.properties?.display_grid)
		.length}
	data-policy-impact-cells={impactFeatures.features.length}
	data-policy-impact-view={policyOverlayView}
	data-policy-impact-source-updates={impactSourceUpdates}
	data-policy-feedback-cells={feedbackCellCount}
	data-policy-placement-road-hints={placementRoadHints.features.length}
	data-focus-context={focusContext}
	data-policy-comparison-changed-cells={comparisonDiagnostics.changed}
	data-policy-before-beyond-cells={comparisonDiagnostics.beforeBeyond}
	data-policy-after-within-cells={comparisonDiagnostics.afterWithin}
	data-policy-overlay-opacity={overlayOpacity}
	data-policy-gap-opacity={gapOpacity}
	data-policy-impact-opacity={impactOpacity}
	data-policy-calculating={policyCalculating}
	data-policy-lens={gapLens}
	data-context-roads={contextSummary.roads}
	data-context-buildings={contextSummary.buildings}
	data-context-bounds={contextLoadedKey}
	data-context-loading={contextLoading}
	data-context-error={contextError}
	data-zoom={zoomLevel}
	style:--map-height={`${mapHeight}px`}
>
	<div
		bind:this={container}
		class="map-canvas"
		ondragover={(event) => {
			if (
				event.dataTransfer?.types.includes('application/x-policy-placement') ||
				event.dataTransfer?.types.includes('application/x-policy-service')
			)
				event.preventDefault();
		}}
		ondrop={dropPlacement}
		role="region"
		aria-label="Interactive Maldives map. Select an island or a source record. Use arrow keys to pan and plus or minus to zoom. When placing a point, press Enter to use the map center."
	></div>
	{#if placementPreview && active}
		<div
			class="placement-distance-guide"
			class:unsuitable={placementPreview.suitable === false}
			style:left={`${placementPreview.x}px`}
			style:top={`${placementPreview.y}px`}
			style:width={`${placementPreview.radius * 2}px`}
			style:height={`${placementPreview.radius * 2}px`}
			data-testid="placement-distance-guide"
			aria-hidden="true"
		></div>
		{#if picking && placementKind && !pendingProposal}
			<div
				class="placement-preview"
				class:unsuitable={placementPreview.suitable === false}
				class:caution={placementAdvice?.caution}
				style:left={`${placementPreview.x}px`}
				style:top={`${placementPreview.y}px`}
				data-testid="map-placement-preview"
				data-placement-kind={placementKind}
				data-placement-snapped={placementPreview.snapped}
				data-placement-suitable={placementPreview.suitable ?? 'unknown'}
				data-preview-longitude={placementPreview.coordinates[0]}
				data-preview-latitude={placementPreview.coordinates[1]}
				aria-hidden="true"
			>
				<span class="placement-preview-icon">
					{#if placementKind === 'add_hospital'}<Hospital size={22} />
					{:else if placementKind === 'add_school'}<GraduationCap size={22} />
					{:else}<Signpost size={22} />{/if}
				</span>
				<span class="placement-preview-label">
					<strong>{placementAdvice?.title}</strong>
					<span>{placementAdvice?.detail}</span>
				</span>
			</div>
		{/if}
	{/if}
	{#if selectedProposal && proposalEditAnchor && active && oneditproposal && !pendingProposal}
		<div
			class="proposal-edit-anchor"
			class:below={proposalEditAnchor.below}
			style:left={`${proposalEditAnchor.x}px`}
			style:top={`${proposalEditAnchor.y}px`}
			style:--edit-arrow={`${proposalEditAnchor.arrow}px`}
		>
			<section
				bind:this={proposalEditCard}
				class="proposal-marker-actions"
				aria-label="Edit proposed change"
				data-testid="proposal-marker-actions"
			>
				<header>
					<strong>{selectedProposal.name ?? 'Proposed change'}</strong>
					<button
						type="button"
						class="proposal-action-close"
						aria-label="Close change actions"
						onclick={() => {
							selectedProposalIndex = null;
						}}><X size={15} /></button
					>
				</header>
				{#if selectedProposalLocked}<p>
						This point belongs to a service package. Remove the service and regenerate it to change
						its route.
					</p>{/if}
				<div class="proposal-edit-buttons">
					{#if !selectedProposalLocked}
						<button type="button" onclick={() => editSelectedProposal('move')}
							><Move size={16} />Move</button
						>
						<button type="button" onclick={() => editSelectedProposal('duplicate')}
							><Copy size={16} />Duplicate</button
						>
					{/if}
					<button type="button" class="remove" onclick={() => editSelectedProposal('remove')}
						><Trash2 size={16} />Remove</button
					>
				</div>
			</section>
		</div>
	{/if}
	{#if serviceEditor && serviceEditorContent && serviceAnchor && active}
		<div
			class="service-editor-anchor"
			class:below={serviceAnchor.below}
			class:beside-right={serviceAnchor.side === 'right'}
			class:beside-left={serviceAnchor.side === 'left'}
			style:left={`${serviceAnchor.x}px`}
			style:top={`${serviceAnchor.y}px`}
			style:width={`${serviceAnchor.width}px`}
			style:--service-arrow={`${serviceAnchor.arrow}px`}
			style:--service-arrow-y={`${serviceAnchor.arrowY}px`}
		>
			<section
				bind:this={serviceCard}
				class="map-service-editor"
				style:max-height={`${serviceAnchor.maxHeight}px`}
				aria-label={serviceEditor.title ?? 'Plan transport service'}
				data-testid="map-service-editor"
				data-service-mode={serviceEditor.mode}
				data-anchor-longitude={serviceEditor.coordinates[0]}
				data-anchor-latitude={serviceEditor.coordinates[1]}
			>
				{@render serviceEditorContent()}
			</section>
		</div>
	{/if}
	{#if pendingProposal && placementAnchor && active && onconfirmproposal && oncancelproposal && serviceEditor?.mode !== 'bus-connection'}
		<div
			class="placement-confirmation-anchor"
			class:below={placementAnchor.below}
			class:dragging={placementDragging}
			style:left={`${placementAnchor.x}px`}
			style:top={`${placementAnchor.y}px`}
			style:width={`${placementAnchor.width}px`}
			style:--placement-arrow={`${placementAnchor.arrow}px`}
		>
			<section
				bind:this={placementCard}
				class="placement-confirmation"
				style:max-height={`${placementAnchor.maxHeight}px`}
				aria-label="Confirm map placement"
				aria-busy={!!pendingPlacementDecision?.checking}
				data-testid="map-placement-confirmation"
				data-placement-kind={pendingProposal.kind}
				data-placement-allowed={placementAllowed}
			>
				<div class="placement-card-heading">
					<span class="placement-card-symbol" aria-hidden="true">
						{#if pendingProposal.kind === 'add_hospital'}<Hospital size={21} />
						{:else if pendingProposal.kind === 'add_school'}<GraduationCap size={21} />
						{:else}<Signpost size={21} />{/if}
					</span>
					<div><span>Review placement</span><strong>{placementTitle}</strong></div>
				</div>
				<div class="placement-card-costs">
					<div>
						<span>Capital cost</span><strong
							>{placementMoney(pendingPlacementDecision?.capital)}</strong
						>
					</div>
					<div>
						<span>Yearly operation</span><strong
							>{placementMoney(pendingPlacementDecision?.annual)}</strong
						>
					</div>
				</div>
				{#if pendingPlacementDecision?.remaining !== null && pendingPlacementDecision?.remaining !== undefined && pendingPlacementDecision.remaining >= 0}
					<p class="placement-budget-remaining">
						Budget after adding <strong>{placementMoney(pendingPlacementDecision.remaining)}</strong
						>
					</p>
				{/if}
				{#if pendingPlacementDecision?.annualRemaining !== null && pendingPlacementDecision?.annualRemaining !== undefined && pendingPlacementDecision.annualRemaining >= 0}
					<p class="placement-budget-remaining">
						Yearly budget remaining <strong
							>{placementMoney(pendingPlacementDecision.annualRemaining)}</strong
						>
					</p>
				{/if}
				{#if pendingPlacementDecision?.accessPreview}
					<p class="placement-access-preview" role="status">
						{#if pendingPlacementDecision.accessPreview.residents !== null}<strong
								>{new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(
									pendingPlacementDecision.accessPreview.residents
								)}</strong
							>{/if}
						<span
							>{pendingPlacementDecision.accessPreview.label}{pendingPlacementDecision.accessPreview
								.approximate
								? ' · estimate'
								: ''}</span
						>
					</p>
				{/if}
				{#if pendingPlacementDecision?.checking}
					<p class="placement-card-message" role="status">
						<span class="loading-spinner" aria-hidden="true"></span>Checking this location…
					</p>
				{:else if pendingPlacementDecision?.reason}
					<p
						class="placement-card-message"
						class:blocked={!placementAllowed}
						role={placementAllowed ? 'status' : 'alert'}
					>
						{pendingPlacementDecision.reason}
					</p>
				{/if}
				{#if !placementAllowed && !pendingPlacementDecision?.checking && onadjustbudget && /budget|over your|shortfall/i.test(pendingPlacementDecision?.reason ?? '')}
					<button type="button" class="placement-adjust-budget" onclick={onadjustbudget}
						>Adjust budget</button
					>
				{/if}
				{#if pendingPlacementDecision?.note}<p class="placement-card-note">
						{pendingPlacementDecision.note}
					</p>{/if}
				<div class="placement-card-actions">
					<Button
						variant="outline"
						onclick={() => {
							oncancelproposal?.();
							map?.getCanvas().focus({ preventScroll: true });
						}}>Cancel</Button
					>
					<Button
						disabled={!placementAllowed || placementDragging}
						onclick={() => {
							if (placementAllowed && !placementDragging) onconfirmproposal?.();
						}}
						><Check size={15} />{pendingPlacementDecision?.actionLabel ?? 'Add to proposal'}</Button
					>
				</div>
				<small class="placement-card-hint"
					>Drag the pin to adjust · Esc to cancel<br />Circle: 400 m distance guide, not calculated
					access</small
				>
			</section>
		</div>
	{/if}
	{#if error}
		<div class="map-fallback" role="status">
			<MapIcon size={32} strokeWidth={1.4} />
			<strong>Interactive map unavailable</strong>
			<p>
				Enable hardware acceleration or use a browser with WebGL support. You can still explore
				islands using the search and island panel.
			</p>
			<small>{error}</small>
		</div>
	{:else}
		<div
			class="map-controls"
			class:sea-inspector-open={seaInspectorOpen}
			style:display={presentation ? 'none' : undefined}
			bind:this={controls}
			role="group"
			aria-label="Map controls"
			data-testid="map-controls-dock"
		>
			{#if controlsPanel}
				<section
					class="control-panel"
					aria-label={controlsPanel === 'layers' ? 'Map layers' : 'Map view'}
					aria-hidden={!controlsPanel}
					inert={!controlsPanel}
					in:surfaceMotion={{ axis: 'y', distance: -6, scale: 0.98, origin: 'bottom left' }}
					out:surfaceMotion={{
						direction: 'out',
						axis: 'y',
						distance: -6,
						scale: 0.98,
						origin: 'bottom left'
					}}
				>
					<header class="control-panel-header">
						<div>
							<strong>{controlsPanel === 'layers' ? 'Map layers' : 'Map view'}</strong>
							<p>
								{controlsPanel === 'layers'
									? 'Choose what appears on the map.'
									: 'View all islands or zoom in.'}
							</p>
						</div>
						<Button
							variant="ghost"
							size="icon-sm"
							class="map-close-button"
							aria-label="Close map controls"
							onclick={() => closeControls(true)}><X size={15} /></Button
						>
					</header>
					{#if controlsPanel === 'layers'}
						{#if hasPolicyOverlay}
							<div class="overlay-opacity-control">
								<div>
									<label for={overlayControlId}>Overlay opacity</label>
									<output for={overlayControlId}>{overlayOpacity}%</output>
								</div>
								<input
									id={overlayControlId}
									type="range"
									min="0"
									max="100"
									step="1"
									bind:value={overlayOpacity}
									aria-valuetext={`${overlayOpacity}%`}
								/>
								<small>Reveal the streets or emphasise the map colours.</small>
							</div>
						{/if}
						<div class="layer-list">
							{#if onSeaLayerChange}
								<Button
									variant="ghost"
									class="map-layer-row"
									aria-pressed={seaLayerEnabled}
									onclick={() => onSeaLayerChange?.(!seaLayerEnabled)}
								>
									<span class="layer-icon transport"><Ship size={17} /></span>
									<span class="layer-label"
										><strong>Sea route lines</strong><small>Boats and terminals stay visible</small
										></span
									>
									<span class="layer-switch" data-checked={seaLayerEnabled}><span></span></span>
								</Button>
							{/if}
							{#if onAirLayerChange}
								<Button
									variant="ghost"
									class="map-layer-row"
									aria-pressed={airLayerEnabled}
									onclick={() => onAirLayerChange?.(!airLayerEnabled)}
								>
									<span class="layer-icon transport"><Plane size={17} /></span>
									<span class="layer-label"
										><strong>Flight route lines</strong><small
											>Aircraft and airports stay visible</small
										></span
									>
									<span class="layer-switch" data-checked={airLayerEnabled}><span></span></span>
								</Button>
							{/if}
							<Button
								variant="ghost"
								class="map-layer-row"
								aria-pressed={streetsVisible}
								onclick={() => (streetsVisible = !streetsVisible)}
							>
								<span class="layer-icon transport"><MapIcon size={17} /></span>
								<span class="layer-label"
									><strong>Streets & paths</strong><small>Roads and paths · OpenStreetMap</small
									></span
								>
								<span class="layer-switch" data-checked={streetsVisible}><span></span></span>
							</Button>
							<Button
								variant="ghost"
								class="map-layer-row"
								aria-pressed={buildingsVisible}
								onclick={() => (buildingsVisible = !buildingsVisible)}
							>
								<span class="layer-icon land"><Layers size={17} /></span>
								<span class="layer-label"
									><strong>Buildings & green spaces</strong><small
										>Footprints appear as you zoom in</small
									></span
								>
								<span class="layer-switch" data-checked={buildingsVisible}><span></span></span>
							</Button>
							<div class="foundation-layer">
								<span class="layer-icon land"><MapIcon size={17} /></span><span class="layer-label"
									><strong>Island boundaries</strong><small
										>{layers.islands.features.length.toLocaleString()} island boundaries</small
									></span
								><Check size={16} class="foundation-check" />
							</div>
							<Button
								variant="ghost"
								class="map-layer-row"
								aria-pressed={facilitiesVisible}
								onclick={() => (facilitiesVisible = !facilitiesVisible)}
								><span class="layer-icon health"><Hospital size={17} /></span><span
									class="layer-label"
									><strong>Schools & healthcare</strong><small
										>{layers.facilities.features.length.toLocaleString()} public facilities</small
									></span
								><span class="layer-switch" data-checked={facilitiesVisible}><span></span></span
								></Button
							>
							<Button
								variant="ghost"
								class="map-layer-row"
								aria-pressed={transportVisible}
								onclick={() => (transportVisible = !transportVisible)}
								><span class="layer-icon transport"><BusFront size={17} /></span><span
									class="layer-label"
									><strong>Stops & terminals</strong><small
										>{busStopFeatures.features.length.toLocaleString()} bus stops · ferry terminals &
										airports</small
									></span
								><span class="layer-switch" data-checked={transportVisible}><span></span></span
								></Button
							>
							<Button
								variant="ghost"
								class="map-layer-row"
								aria-pressed={liveVisible && liveFeatures.features.length > 0}
								disabled={liveFeatures.features.length === 0}
								onclick={() => (liveVisible = !liveVisible)}
								><span class="layer-icon activity"><Radio size={17} /></span><span
									class="layer-label"
									><strong>Observed movement</strong><small
										>{liveFeatures.features.length
											? `${liveFeatures.features.length.toLocaleString()} vehicle positions`
											: 'No vehicle positions in this area'}</small
									></span
								><span
									class="layer-switch"
									data-checked={liveVisible && liveFeatures.features.length > 0}><span></span></span
								></Button
							>
						</div>
						<div class="source-note">
							<Info size={13} /><span
								>Select a place for details. Places without coordinates appear in the island
								details.</span
							>
						</div>
					{:else}
						<div class="view-actions">
							{#if routeFeatures.features.length}<Button
									variant="outline"
									class="map-view-action"
									onclick={focusJourney}
									><MapPin size={16} /><span>Show entire journey</span></Button
								>{/if}
							<Button
								variant="outline"
								class="map-view-action"
								disabled={!freshMovement.length || !ready}
								onclick={focusMovement}><Radio size={16} /><span>Show nearby movement</span></Button
							>
							<Button
								variant="outline"
								class="map-view-action"
								disabled={!selectedIsland || !ready}
								onclick={() => {
									if (onfocusisland) onfocusisland();
									else focusIsland();
									closeControls(true);
								}}><LocateFixed size={16} /><span>Focus selected island</span></Button
							>
							<Button
								variant="outline"
								class="map-view-action"
								disabled={!ready}
								onclick={nationalView}><Globe2 size={16} /><span>Show all Maldives</span></Button
							>
						</div>
						<div class="view-toggles">
							<Button
								variant="ghost"
								class="map-layer-row compact"
								aria-pressed={labelsVisible}
								onclick={() => (labelsVisible = !labelsVisible)}
								><MapPin size={16} /><span class="layer-label"><strong>Island names</strong></span
								><span class="layer-switch" data-checked={labelsVisible}><span></span></span
								></Button
							>
							<Button
								variant="ghost"
								class="map-layer-row compact"
								aria-pressed={legendVisible}
								onclick={() => (legendVisible = !legendVisible)}
								><Eye size={16} /><span class="layer-label"><strong>Map key</strong></span><span
									class="layer-switch"
									data-checked={legendVisible}><span></span></span
								></Button
							>
						</div>
						{#if liveStatus.providers?.length}
							<div class="movement-providers" aria-label="Movement feed coverage">
								<strong>Movement feed coverage</strong>
								{#each liveStatus.providers as provider (provider.provider)}
									<p>
										<span>{provider.provider}</span><small
											>{provider.enabled ? provider.status.replaceAll('_', ' ') : 'not configured'} ·
											{provider.event_count} positions</small
										>
									</p>
									{#if provider.message}<small>{provider.message}</small>{/if}
								{/each}
							</div>
						{/if}
						<footer class="view-readout">
							<span
								>{centerCoordinates[1].toFixed(4)}° N · {centerCoordinates[0].toFixed(4)}° E</span
							><span>Zoom {zoomLevel.toFixed(1)}</span>
						</footer>
					{/if}
				</section>
			{/if}
			{#if mapControlsContent}<div class="map-coverage-controls">
					{@render mapControlsContent()}
				</div>{/if}
			{#if !presentation}
				<div class="map-footer" class:has-legend={legendVisible}>
					<div class="map-information-card" class:mobile-expanded={mobileLegendOpen}>
						{#if seaView || airLayerEnabled}
							<div
								class="sea-pressure-key"
								aria-label="Estimated service pressure"
								data-testid="sea-pressure-legend"
							>
								<div class="sea-pressure-heading">
									<div>
										<strong>Estimated service pressure</strong><small
											>{seaView
												? 'Population per weekly departure'
												: 'Flight frequency unconfirmed'}</small
										>
									</div>
									{#if seaView && !seaInspectorOpen && onSeaLayerChange}<button
											type="button"
											class="sea-local-services"
											onclick={() => onSeaLayerChange?.(false)}>Hide sea route lines</button
										>{/if}
								</div>
								<div class="sea-pressure-swatches">
									{#each [{ label: 'Low', color: seaPressureColors.low }, { label: 'Moderate', color: seaPressureColors.medium }, { label: 'High', color: seaPressureColors.high }, { label: 'Unknown', color: seaPressureColors.unknown }] as item (item.label)}
										<span><i style:background={item.color} aria-hidden="true"></i>{item.label}</span
										>
									{/each}
								</div>
								<div class="network-route-key">
									{#if seaView}<span><i aria-hidden="true"></i><Ship size={11} />Sea</span>{/if}
									{#if airLayerEnabled}<span class="air"
											><i aria-hidden="true"></i><Plane size={11} />Air · frequency unconfirmed</span
										>{/if}
								</div>
								{#if seaView && seaNetworkStatus === 'loading'}<p
										class="sea-network-status"
										role="status"
									>
										Loading sea connections…
									</p>
								{:else if seaView && seaNetworkStatus === 'error'}<p
										class="sea-network-status"
										role="status"
									>
										Sea connections unavailable.{#if onSeaRetry}<button
												type="button"
												onclick={onSeaRetry}>Try again</button
											>{/if}
									</p>{/if}
								{#if airLayerEnabled && airNetworkStatus === 'loading'}<p
										class="sea-network-status"
										role="status"
									>
										Loading domestic flights…
									</p>
								{:else if airLayerEnabled && airNetworkStatus === 'error'}<p
										class="sea-network-status"
										role="status"
									>
										Domestic flights unavailable.{#if onAirRetry}<button
												type="button"
												onclick={onAirRetry}>Try again</button
											>{/if}
									</p>{/if}
							</div>
						{/if}
						{#if !seaInspectorOpen}
							{#if accessibilityOverview}
								<div class="accessibility-key" aria-label="Island accessibility score colours">
									<strong>Accessibility /100</strong>
									<span><span>Low</span><i aria-hidden="true"></i><span>High</span></span>
									<small>Residential islands · Grey: limited evidence</small>
								</div>
							{:else}
								{#if (gapFeatures.features.length || coverageFillFeatures.features.length) && !impactFeatures.features.length}<div
										class="policy-colour-key"
										aria-label="Service gap colours"
									>
										<strong
											>{coverageFillFeatures.features.length ||
											gapFeatures.features.some((feature) => feature.properties?.origin_id)
												? gapLens === 'transport'
													? 'Walk to a bus stop or terminal'
													: 'Local journey time'
												: 'Service availability'}</strong
										>
										<span
											><i class="policy-gap-gradient" style:background={GAP_GRADIENT}
											></i>{coverageFillFeatures.features.length ||
											gapFeatures.features.some((feature) => feature.properties?.origin_id)
												? 'Shorter → at / beyond target'
												: 'More services → fewer services'}</span
										>
										<small
											>{gapFeatures.features.some((feature) => feature.properties?.origin_id)
												? 'Grey: no estimate'
												: 'Services across the island'}</small
										>
										{#if coverageFillFeatures.features.length}
											<span class="policy-coverage-fill-key">Gaps: nearby estimates</span>
										{/if}
									</div>{:else if impactFeatures.features.length}<div
										class="policy-colour-key"
										aria-label="Proposal impact colours"
									>
										<strong
											>{policyOverlayView === 'before'
												? 'Without proposal'
												: policyOverlayView === 'after'
													? 'With proposal'
													: 'Proposed access change'}</strong
										>
										{#if policyOverlayView === 'before' || policyOverlayView === 'after'}
											<span
												><i class="policy-gap-gradient" style:background={GAP_GRADIENT}></i>Shorter
												→ at / beyond target</span
											>
											<small>Same journey-time scale in both views</small>
										{/if}
										<div class="policy-overlay-swatches">
											{#each policyOverlayLegend as item (item.label)}<span
													><i style:background={item.color}></i>{item.label}</span
												>{/each}
										</div>
										{#if policyStale || policyCalculating}
											<small class="policy-overlay-status" data-testid="policy-overlay-status"
												>Updating proposal · {policyOverlayView === 'before'
													? 'current access shown'
													: 'showing previous result'}</small
											>
										{:else if comparisonPreview && policyOverlayView === 'after'}
											<small class="policy-overlay-status" data-testid="policy-overlay-status"
												>Placement preview · not added</small
											>
										{/if}
										{#if coverageFillFeatures.features.length}
											<span class="policy-coverage-fill-key">Gaps: nearby estimates</span>
										{/if}
									</div>{/if}
								{#if scenarioPreview.unlocated}<div class="street-context-status" role="status">
										<X size={12} />{scenarioPreview.unlocated}
										{scenarioPreview.unlocated === 1 ? 'edit lacks' : 'edits lack'} a location · select
										a location on the map
									</div>{/if}
								{#if picking}<div class="map-hint picking">
										<Crosshair size={15} /><span>Click to place · Enter at map center</span>
									</div>{/if}
								{#if mobileLegendOpen}
									<div
										class="map-key-details"
										id={mapKeyId}
										aria-hidden={!mobileLegendOpen}
										inert={!mobileLegendOpen}
										in:slide={{ duration: shouldAnimateMotion() ? 220 : 0 }}
										out:slide={{ duration: shouldAnimateMotion() ? 140 : 0 }}
									>
										<section class="map-movement-status" aria-label="Live coverage">
											<div class="movement-counts">
												<span title="Aircraft observations"
													><Plane size={14} />{activityKinds.aircraft}</span
												>
												<span title="Vessel observations"
													><Ship size={14} />{activityKinds.vessel}</span
												>
												<span title="Bus observations"
													><BusFront size={14} />{activityKinds.bus}</span
												>
												<strong title="Visible observations / all positions received for this area"
													>{renderedMovementObservations} visible / {liveFeatures.features.length} received</strong
												>
											</div>
											{#if freshMovement.length && renderedMovementObservations < freshMovement.length}<Button
													variant="ghost"
													size="sm"
													class="movement-fit-button"
													onclick={focusMovement}><LocateFixed size={13} />View nearby</Button
												>{/if}
										</section>

										{#if !picking && hoverDescription}<div class="map-hint">
												<MousePointer2 size={15} />
												<span
													>{hoverDescription ||
														(nationalScale
															? 'Select an island to explore'
															: 'Click a place to inspect, plan a journey or propose a change')}</span
												>
											</div>{/if}
										{#if legendVisible}<div class="map-legend" aria-label="Map key">
												{#if facilitiesVisible}<span
														><Hospital size={12} class="health-key" />Health</span
													><span><GraduationCap size={13} class="school-key" />Schools</span>{/if}
												{#if transportVisible}<span
														><BusFront size={12} class="transport-key" />Bus stops</span
													>
													<span><Ship size={12} class="marine-key" />Ferry terminals</span>
													<span><Anchor size={12} class="marine-key" />Piers</span>
													<span><Plane size={12} class="transport-key" />Airports</span>{/if}
												{#if facilitiesVisible || transportVisible}<span
														><MapPin size={12} />Other places</span
													>
													<span><i class="legend-cluster">#</i>Grouped places</span>{/if}
												{#if renderedVesselGroups}<span
														><Ship size={12} class="marine-key" />Grouped vessels</span
													>{/if}
												{#if scenarioFeatures.features.length}<span
														><i class="legend-proposed"></i>Proposed</span
													>{/if}
												{#if scenarioFeatures.features.some( (feature) => ['remove_bus_stop', 'disable_ferry_terminal', 'road_closure'].includes(feature.properties?.type) )}<span
														><X size={12} />Removal / closure</span
													>{/if}
												{#if routeFeatures.features.some((feature) => feature.geometry.type === 'LineString' && !['walk', 'ferry'].includes(feature.properties?.mode))}<span
														><i class="legend-route"></i>{routeFeatures.features.some(
															(feature) => feature.properties?.mode === 'bus'
														)
															? 'Bus journey'
															: 'Journey route'}</span
													>{/if}
												{#if routeFeatures.features.some((feature) => feature.geometry.type === 'LineString' && feature.properties?.mode === 'walk')}<span
														><i class="legend-walk"></i>{inlineDirectionsActive
															? 'Walking route'
															: 'Walk to / from stop'}</span
													>{/if}
												{#if routeFeatures.features.some((feature) => feature.geometry.type === 'LineString' && feature.properties?.mode === 'ferry')}<span
														><i class="legend-ferry-route"></i>Ferry journey</span
													>{/if}
												{#if journeyStopFeatures.features.length}<span
														><i class="legend-journey-stop"></i>Board / get off here</span
													>{/if}
												{#if inlineDirectionsActive}
													{#each directionWaypoints as point (`${point.index}:${point.id}`)}
														<span
															><b
																class:legend-origin={point.role !== 'end'}
																class:legend-destination={point.role === 'end'}>{point.letter}</b
															>{point.role === 'start'
																? 'Start'
																: point.role === 'end'
																	? 'Destination'
																	: 'Via point'}</span
														>
													{/each}
												{:else if routeStart || routeEnd}<span
														><b class="legend-origin">A</b>Start</span
													><span><b class="legend-destination">B</b>Destination</span>{/if}
											</div>{/if}
									</div>
								{/if}
							{/if}
						{/if}
					</div>
				</div>
				<div class="map-toolbar" role="group" aria-label="Atlas controls">
					<span class="atlas-mark" title="Maldives map"
						><MapIcon size={18} strokeWidth={1.6} /></span
					>
					<span class="toolbar-divider"></span>
					<Button
						bind:ref={layersButton}
						variant="ghost"
						class="map-tool-button"
						aria-expanded={controlsPanel === 'layers'}
						onclick={() => toggleControls('layers')}
						><Layers size={16} /><span>Layers</span><span class="layer-count"
							>{activeLayerCount}</span
						></Button
					>
					<Button
						bind:ref={viewButton}
						variant="ghost"
						class="map-tool-button"
						aria-expanded={controlsPanel === 'view'}
						onclick={() => toggleControls('view')}
						><SlidersHorizontal size={16} /><span>View</span><ChevronDown size={12} /></Button
					>
					<span class="toolbar-divider"></span>
					<Button
						variant="ghost"
						size="icon"
						class="map-national-button"
						disabled={!ready}
						aria-label="Show all Maldives islands"
						title="Show all Maldives islands"
						onclick={nationalView}><Globe2 size={18} /></Button
					>

					{#if !accessibilityOverview}
						<div class="mobile-key-toggle">
							<Button
								variant="ghost"
								size="sm"
								aria-expanded={mobileLegendOpen}
								aria-controls={mapKeyId}
								aria-label="Map key & live coverage"
								onclick={toggleMapKey}
								><Info size={12} /><span class="map-key-label">Key</span><ChevronDown
									size={12}
								/></Button
							>
						</div>
					{/if}
				</div>
			{/if}
		</div>
		{#if mapBusy}
			<div class="atlas-loading-status" role="status">
				<span class="loading-spinner" aria-hidden="true"></span>{!ready
					? 'Preparing map'
					: !features
						? 'Loading map data'
						: 'Drawing island boundaries'}
			</div>
		{:else if layers.islands.features.length === 0}
			<div class="atlas-loading-status" role="status">Island boundaries are unavailable.</div>
		{/if}
		{#if picking && !placementKind}<div class="placement-target" aria-hidden="true">
				<span></span>
			</div>{/if}
	{/if}
</div>

<style>
	:global(.national-map[data-presentation-panel='route'] .map-source-record-popup) {
		inset: 24px 24px auto auto;
		width: 410px;
		max-width: calc(100% - 48px) !important;
		transform: none !important;
		z-index: 7;
	}
	:global(
		.national-map[data-presentation-panel='route'] .map-source-record-popup .maplibregl-popup-tip
	) {
		display: none;
	}
	:global(
		.national-map[data-presentation-panel='route'] .map-source-record-popup .map-record-card
	) {
		max-height: calc(100dvh - 176px);
		overflow: auto;
	}
	:global(
		.national-map[data-presentation-panel='route'] .map-record-popup .maplibregl-popup-content
	) {
		padding: 24px;
	}
	:global(.national-map[data-presentation-panel='route'] .map-record-card .map-record-kind) {
		font-size: 13px;
	}
	:global(.national-map[data-presentation-panel='route'] .map-record-card h3) {
		margin: 9px 14px 17px 0;
		font-size: 26px;
		line-height: 1.25;
	}
	:global(.national-map[data-presentation-panel='route'] .map-network-route-card > dl) {
		grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
		gap: 15px 18px;
		margin-block: 20px;
		font-size: 16px;
		line-height: 1.45;
	}
	:global(.national-map[data-presentation-panel='route'] .map-network-route-card > dl dd) {
		font-size: 30px;
		font-weight: 600;
		letter-spacing: -0.02em;
	}
	:global(
		.national-map[data-presentation-panel='route']
			.map-network-route-card
			> .presentation-route-summary
	) {
		grid-template-columns: minmax(0, 1fr);
		gap: 5px;
	}
	:global(
		.national-map[data-presentation-panel='route']
			.presentation-route-summary
			> dt:not(:first-child)
	) {
		margin-top: 16px;
	}
	:global(
		.national-map[data-presentation-panel='route']
			.map-network-route-card
			> .presentation-route-summary
			dd
	) {
		font-size: 36px;
		line-height: 1.2;
	}
	:global(
		.national-map[data-presentation-panel='route'] .map-network-route-card .sea-route-pressure
	),
	:global(.national-map[data-presentation-panel='route'] .map-network-route-card p),
	:global(.national-map[data-presentation-panel='route'] .map-network-route-card details),
	:global(.national-map[data-presentation-panel='route'] .map-network-route-card details dl),
	:global(.national-map[data-presentation-panel='route'] .map-network-route-card .sea-route-stops),
	:global(
		.national-map[data-presentation-panel='route'] .map-network-route-card .sea-route-sources
	) {
		font-size: 14px;
		line-height: 1.5;
	}
	:global(.national-map[data-presentation-panel='route'] .map-network-route-card > p) {
		margin-block: 17px;
	}
	:global(.national-map[data-presentation-quiet='true'] .atlas-street-label),
	:global(.national-map[data-presentation-quiet='true'] .atlas-neighbor-label),
	:global(
		.national-map[data-presentation-quiet='true'] .atlas-stop-label:not(.journey-stop-label)
	) {
		opacity: 0.35;
	}
	@media (max-width: 700px) {
		:global(.national-map[data-presentation-panel='route'] .map-source-record-popup) {
			inset: auto 14px 82px;
			width: auto;
			max-width: none !important;
		}
		:global(
			.national-map[data-presentation-panel='route'] .map-source-record-popup .map-record-card
		) {
			max-height: calc(43dvh - 38px);
		}
		:global(
			.national-map[data-presentation-panel='route'] .map-record-popup .maplibregl-popup-content
		) {
			padding: 19px;
		}
		:global(.national-map[data-presentation-panel='route'] .map-network-route-card > dl dd) {
			font-size: 24px;
		}
		:global(.national-map[data-presentation-panel='route'] .map-record-card h3) {
			font-size: 23px;
		}
		:global(
			.national-map[data-presentation-panel='route']
				.map-network-route-card
				> .presentation-route-summary
				dd
		) {
			font-size: 28px;
		}
	}
	.national-map {
		position: relative;
		height: 100%;
		min-height: 0;
		overflow: hidden;
		background: var(--theme-color-dceef0);
		isolation: isolate;
		container-type: inline-size;
		container-name: atlas;
		color: var(--theme-color-234e5a);
	}
	.map-canvas {
		position: absolute;
		inset: 0;
	}
	.placement-distance-guide {
		position: absolute;
		z-index: 2;
		transform: translate(-50%, -50%);
		border: 2px dashed var(--theme-color-286d638c);
		border-radius: 50%;
		background: var(--theme-color-286d630b);
		pointer-events: none;
	}
	.placement-distance-guide.unsuitable {
		border-color: var(--theme-color-bb634caa);
		background: var(--theme-color-bb634c0b);
	}
	.placement-preview {
		position: absolute;
		z-index: 12;
		width: 42px;
		height: 46px;
		transform: translate(-50%, -100%);
		pointer-events: none;
	}
	.placement-preview-icon {
		display: grid;
		place-items: center;
		width: 42px;
		height: 46px;
		border: 2px solid var(--theme-color-fffefa);
		border-radius: 13px;
		background: var(--theme-color-286d63);
		color: var(--theme-color-ffffff);
		box-shadow:
			0 0 0 4px var(--theme-color-286d6324),
			0 7px 16px var(--theme-color-173d4233);
	}
	.unsuitable .placement-preview-icon {
		background: var(--theme-color-ad593f);
		box-shadow:
			0 0 0 4px var(--theme-color-ad593f20),
			0 7px 16px var(--theme-color-173d4233);
	}
	.placement-preview-label {
		position: absolute;
		left: 50%;
		top: calc(100% + 12px);
		display: grid;
		gap: 3px;
		width: max-content;
		max-width: 280px;
		padding: 9px 12px;
		border: 1px solid var(--theme-color-d8e4de);
		border-radius: 10px;
		background: var(--theme-color-fffefaed);
		box-shadow: 0 3px 10px var(--theme-color-173d4214);
		transform: translateX(-50%);
		text-align: center;
	}
	.placement-preview-label strong {
		font-size: 11px;
		font-weight: 650;
	}
	.placement-preview-label > span {
		max-width: 245px;
		color: var(--theme-color-71847b);
		font-size: 10px;
		line-height: 1.5;
	}
	.caution .placement-preview-label {
		border-color: var(--theme-color-d9c5a4);
	}
	.national-map[data-focus-context]:not([data-focus-context='']) :global(.vessel-group-target) {
		opacity: 0.35;
	}
	.national-map[data-focus-context]:not([data-focus-context=''])
		:global(.atlas-stop-label:not(.journey-stop-label)) {
		opacity: 0.55;
	}
	.proposal-edit-anchor {
		position: absolute;
		z-index: 15;
		width: 252px;
		transform: translate(-50%, -100%);
	}
	.service-editor-anchor {
		position: absolute;
		z-index: 17;
		transform: translate(-50%, -100%);
		isolation: isolate;
	}
	.service-editor-anchor.below {
		transform: translateX(-50%);
	}
	.service-editor-anchor::after {
		position: absolute;
		left: var(--service-arrow);
		bottom: -6px;
		z-index: -1;
		width: 12px;
		height: 12px;
		border-right: 1px solid var(--theme-color-cbdcd6);
		border-bottom: 1px solid var(--theme-color-cbdcd6);
		background: var(--theme-color-fffefa);
		transform: translateX(-50%) rotate(45deg);
		content: '';
		pointer-events: none;
	}
	.service-editor-anchor.below::after {
		top: -6px;
		bottom: auto;
		transform: translateX(-50%) rotate(225deg);
	}
	.service-editor-anchor.beside-right::after,
	.service-editor-anchor.beside-left::after {
		top: var(--service-arrow-y);
		bottom: auto;
		border: 0;
		transform: translateY(-50%) rotate(45deg);
	}
	.service-editor-anchor.beside-right::after {
		left: -6px;
		border-left: 1px solid var(--theme-color-cbdcd6);
		border-bottom: 1px solid var(--theme-color-cbdcd6);
	}
	.service-editor-anchor.beside-left::after {
		left: auto;
		right: -6px;
		border-top: 1px solid var(--theme-color-cbdcd6);
		border-right: 1px solid var(--theme-color-cbdcd6);
	}
	.map-service-editor {
		overflow: auto;
		overscroll-behavior: contain;
		/* Keep focused/scrolled controls above the sticky confirmation footer. */
		scroll-padding-block-end: 80px;
		border: 1px solid var(--theme-color-cbdcd6);
		border-radius: 16px;
		background: var(--theme-color-fffefa);
		box-shadow:
			0 6px 18px var(--theme-color-173c4020),
			0 18px 48px -16px var(--theme-color-173c4055);
		color: var(--theme-color-294b4c);
	}
	:global(.national-map .policy-service-marker) {
		display: grid;
		place-items: center;
		width: 46px;
		height: 46px;
		border: 3px solid var(--theme-color-fffefa);
		border-radius: 15px 15px 15px 4px;
		background: var(--theme-color-247b75);
		box-shadow: 0 4px 12px var(--theme-color-173c403d);
		color: var(--theme-color-ffffff);
		cursor: pointer;
	}
	:global(.national-map .policy-service-marker[data-kind='ferry']) {
		background: var(--theme-color-7765b2);
	}
	:global(.national-map .policy-service-marker svg) {
		width: 26px;
		height: 26px;
		fill: currentColor;
	}
	:global(.national-map .policy-service-marker:focus-visible) {
		outline: 3px solid var(--theme-color-164c47);
		outline-offset: 3px;
	}
	.proposal-edit-anchor.below {
		transform: translateX(-50%);
	}
	.proposal-edit-anchor::after {
		position: absolute;
		left: var(--edit-arrow);
		bottom: -6px;
		width: 11px;
		height: 11px;
		border-right: 1px solid var(--theme-color-d1dfd9);
		border-bottom: 1px solid var(--theme-color-d1dfd9);
		background: var(--theme-color-fffefa);
		transform: translateX(-50%) rotate(45deg);
		content: '';
		pointer-events: none;
	}
	.proposal-edit-anchor.below::after {
		top: -6px;
		bottom: auto;
		transform: translateX(-50%) rotate(225deg);
	}
	.proposal-marker-actions {
		padding: 11px;
		border: 1px solid var(--theme-color-d1dfd9);
		border-radius: 14px;
		background: var(--theme-color-fffefa);
		box-shadow:
			0 6px 18px var(--theme-color-173c4020),
			0 18px 48px -16px var(--theme-color-173c4055);
		color: var(--theme-color-294b4c);
	}
	.proposal-marker-actions header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 9px;
	}
	.proposal-marker-actions header strong {
		font-size: 12px;
		line-height: 1.4;
	}
	.proposal-marker-actions p {
		margin: 0 0 10px;
		color: var(--theme-color-72857c);
		font-size: 10px;
		line-height: 1.5;
	}
	.proposal-action-close {
		display: grid;
		place-items: center;
		width: 28px;
		height: 28px;
		flex-shrink: 0;
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: var(--theme-color-73877d);
	}
	.proposal-edit-buttons {
		display: flex;
		gap: 5px;
	}
	.proposal-edit-buttons button {
		display: grid;
		place-items: center;
		flex: 1;
		gap: 4px;
		min-height: 48px;
		border: 1px solid var(--theme-color-dce7df);
		border-radius: 9px;
		background: var(--theme-color-f7faf5);
		color: var(--theme-color-397065);
		font-size: 10px;
		transition:
			transform 130ms cubic-bezier(0.23, 1, 0.32, 1),
			background-color 130ms ease;
	}
	.proposal-edit-buttons button.remove {
		color: var(--theme-color-a45a46);
		background: var(--theme-color-fff6ef);
		border-color: var(--theme-color-eddfd4);
	}
	.proposal-edit-buttons button:hover {
		background: var(--theme-color-eaf2e8);
	}
	.proposal-edit-buttons button.remove:hover {
		background: var(--theme-color-f9eade);
	}
	.proposal-edit-buttons button:active,
	.proposal-action-close:active {
		transform: scale(0.97);
	}
	.proposal-edit-buttons button:focus-visible,
	.proposal-action-close:focus-visible {
		outline: 3px solid var(--theme-color-087f7c);
		outline-offset: 2px;
	}
	.placement-confirmation-anchor {
		position: absolute;
		z-index: 15;
		width: min(288px, calc(100% - 24px));
		transform: translate(-50%, -100%);
		pointer-events: none;
	}
	.placement-confirmation-anchor.below {
		transform: translateX(-50%);
	}
	.placement-confirmation {
		position: relative;
		overflow-y: auto;
		scrollbar-width: thin;
		padding: 15px;
		border: 1px solid var(--theme-color-d1dfd9);
		border-radius: 17px;
		background: var(--theme-color-fffefa);
		box-shadow:
			0 6px 18px var(--theme-color-173c4020),
			0 18px 48px -16px var(--theme-color-173c4055);
		color: var(--theme-color-294b4c);
		pointer-events: auto;
		transform-origin: var(--placement-arrow) bottom;
		transition: opacity 140ms ease;
	}
	.placement-confirmation-anchor::after {
		position: absolute;
		left: var(--placement-arrow);
		bottom: -7px;
		width: 13px;
		height: 13px;
		border-right: 1px solid var(--theme-color-d1dfd9);
		border-bottom: 1px solid var(--theme-color-d1dfd9);
		background: var(--theme-color-fffefa);
		transform: translateX(-50%) rotate(45deg);
		content: '';
	}
	.below .placement-confirmation {
		transform-origin: var(--placement-arrow) top;
	}
	.placement-confirmation-anchor.below::after {
		top: -7px;
		bottom: auto;
		transform: translateX(-50%) rotate(225deg);
	}
	.dragging .placement-confirmation {
		opacity: 0.5;
		pointer-events: none;
	}
	.placement-card-heading {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 14px;
	}
	.placement-card-heading > div {
		display: grid;
		gap: 2px;
	}
	.placement-card-heading > div > span {
		color: var(--theme-color-758880);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.placement-card-heading strong {
		font-size: 15px;
		font-weight: 650;
		line-height: 1.3;
	}
	.placement-card-symbol {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 38px;
		height: 38px;
		border: 1px solid var(--theme-color-d7e5dd);
		border-radius: 11px;
		background: var(--theme-color-edf5ee);
		color: var(--theme-color-397065);
	}
	.placement-card-costs {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
		padding-bottom: 12px;
		border-bottom: 1px solid var(--theme-color-e7ece7);
	}
	.placement-card-costs > div {
		display: grid;
		gap: 3px;
	}
	.placement-card-costs span,
	.placement-budget-remaining {
		color: var(--theme-color-78877e);
		font-size: 10px;
		line-height: 1.45;
	}
	.placement-card-costs strong {
		font-size: 12px;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}
	.placement-budget-remaining {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		margin: 9px 0 0;
	}
	.placement-budget-remaining strong {
		color: var(--theme-color-397065);
		font-weight: 650;
	}
	.placement-card-message {
		display: flex;
		align-items: center;
		gap: 7px;
		margin: 10px 0 0;
		font-size: 11px;
		line-height: 1.5;
	}
	.placement-card-message.blocked {
		padding: 8px 10px;
		border-radius: 9px;
		background: var(--theme-color-fff1e8);
		color: var(--theme-color-a5552f);
	}
	.placement-card-note {
		margin: 8px 0 0;
		color: var(--theme-color-75857b);
		font-size: 10px;
		line-height: 1.5;
	}
	.placement-access-preview {
		display: flex;
		align-items: baseline;
		gap: 7px;
		margin: 11px 0 0;
		padding: 9px 10px;
		border-radius: 9px;
		background: var(--theme-color-edf4eb);
		color: var(--theme-color-3c6c5b);
	}
	.placement-access-preview strong {
		font-size: 19px;
		line-height: 1.2;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}
	.placement-access-preview span {
		font-size: 10px;
		line-height: 1.5;
	}
	.placement-adjust-budget {
		margin-top: 8px;
		border: 0;
		border-radius: 6px;
		padding: 5px 7px;
		background: var(--theme-color-f7e7d9);
		color: var(--theme-color-8b5636);
		font-size: 11px;
		font-weight: 600;
	}
	.placement-adjust-budget:hover {
		background: var(--theme-color-f0d9c6);
	}
	.placement-adjust-budget:focus-visible {
		outline: 3px solid var(--theme-color-087f7c);
		outline-offset: 2px;
	}
	.placement-card-actions {
		position: sticky;
		bottom: 0;
		z-index: 1;
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 7px;
		margin-top: 13px;
		padding: 10px 0;
		border-top: 1px solid var(--theme-color-e4ece6);
		background: var(--theme-color-fffefa);
	}
	.placement-card-actions :global(button) {
		height: 38px;
		min-width: 0;
		padding: 0 12px;
		border-radius: 10px;
		font-size: 11px;
		transition:
			transform 130ms cubic-bezier(0.23, 1, 0.32, 1),
			background-color 130ms ease;
	}
	.placement-card-actions :global(button:active:not(:disabled)) {
		transform: scale(0.97);
	}
	.placement-card-actions :global(button:focus-visible) {
		outline: 3px solid var(--theme-color-087f7c);
		outline-offset: 3px;
	}
	.placement-card-hint {
		display: block;
		margin-top: 10px;
		color: var(--theme-color-829087);
		font-size: 10px;
		text-align: center;
	}
	:global(.national-map .policy-proposal-marker) {
		position: absolute;
		top: 0;
		left: 0;
		width: 43px;
		height: 46px;
		border-radius: 13px;
		box-shadow:
			0 3px 6px var(--theme-color-173d4229),
			0 0 0 1px var(--theme-color-65579930);
		transition: box-shadow 140ms ease;
	}
	:global(.national-map .policy-proposal-marker.pending) {
		border: 2px solid var(--theme-color-fffefa);
		background: var(--theme-color-286d63);
		color: var(--theme-color-ffffff);
		box-shadow:
			0 0 0 4px var(--theme-color-286d632b),
			0 5px 12px var(--theme-color-173d4240);
	}
	:global(.national-map .policy-proposal-marker.pending span) {
		top: -6px;
		right: -6px;
		min-width: 19px;
		height: 19px;
		background: var(--theme-color-fffefa);
		color: var(--theme-color-286d63);
		font-size: 15px;
		line-height: 14px;
	}
	:global(.national-map .policy-proposal-marker.is-dragging) {
		cursor: grabbing;
		box-shadow:
			0 0 0 6px var(--theme-color-286d6320),
			0 12px 20px var(--theme-color-173d4255);
	}
	:global(.national-map .policy-proposal-marker.selected) {
		box-shadow:
			0 0 0 4px var(--theme-color-fffefa),
			0 0 0 6px var(--theme-color-286d63),
			0 8px 18px var(--theme-color-173d4233);
	}
	@media (max-width: 700px) {
		.placement-card-actions :global(button) {
			height: 44px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.placement-confirmation,
		.proposal-edit-buttons button,
		.placement-card-actions :global(button),
		:global(.national-map .policy-proposal-marker) {
			transition: none;
		}
	}
	:global(.national-map canvas:focus-visible) {
		outline: 2px solid var(--theme-color-087f7c);
		outline-offset: -3px;
	}
	.map-controls {
		position: absolute;
		z-index: 5;
		left: 20px;
		bottom: var(--map-controls-bottom, 68px);
		display: flex;
		flex-direction: column;
		width: 430px;
		max-width: calc(100% - 40px);
		padding: 5px;
		border: 1px solid var(--theme-color-d7e2df);
		border-radius: 17px;
		background: var(--theme-color-fffffff5);
		box-shadow: 0 4px 22px var(--theme-color-1a433f12);
		backdrop-filter: blur(10px);
	}
	@container atlas (min-width: 900px) {
		.map-controls.sea-inspector-open {
			--map-controls-bottom: 20px;
			left: 420px;
			max-width: calc(100% - 440px);
		}
	}
	.map-coverage-controls {
		padding-bottom: 4px;
		border-bottom: 1px solid var(--theme-color-e0e9e5);
	}
	.map-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 3px;
		padding: 3px 0 0;
	}

	.atlas-mark {
		display: grid;
		place-items: center;
		width: 30px;
		color: var(--theme-color-087f7c);
	}
	.toolbar-divider {
		height: 19px;
		width: 1px;
		background: var(--theme-color-e0e9e5);
		margin: 0 3px;
	}
	:global(.national-map .map-tool-button),
	:global(.national-map .map-national-button) {
		height: 36px;
		border-radius: 9px;
		gap: 7px;
		padding: 0 11px;
		color: var(--theme-color-49616a);
		font-size: 12px;
		font-weight: 550;
		transition:
			background-color 140ms ease,
			color 140ms ease,
			transform 140ms cubic-bezier(0.23, 1, 0.32, 1);
	}
	:global(.national-map .map-national-button) {
		width: 36px;
		padding: 0;
		color: var(--theme-color-507b79);
	}
	:global(.national-map .map-tool-button[aria-expanded='true']) {
		color: var(--theme-color-087f7c);
		background: var(--theme-color-e9f3ef);
	}
	:global(.national-map .map-tool-button:active),
	:global(.national-map .map-national-button:active) {
		transform: scale(0.97);
	}
	.layer-count {
		display: grid;
		place-items: center;
		min-width: 18px;
		height: 18px;
		border-radius: 5px;
		background: var(--theme-color-edf3ef);
		color: var(--theme-color-6e8680);
		font-size: 10px;
		font-variant-numeric: tabular-nums;
	}
	.control-panel {
		position: absolute;
		bottom: calc(100% + 10px);
		left: 0;
		width: 302px;
		max-width: calc(100vw - 48px);
		max-height: max(
			140px,
			min(
				440px,
				calc(100dvh - var(--map-controls-bottom, 68px) - var(--map-toolbar-bottom, 80px) - 190px)
			)
		);
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-width: thin;
		background: var(--theme-color-fffefa);
		border: 1px solid var(--theme-color-d7e2df);
		border-radius: 16px;
		box-shadow:
			0 5px 16px -8px var(--theme-color-294c4918),
			0 22px 54px -24px var(--theme-color-294c4945);
		transform-origin: bottom left;
	}
	.control-panel-header {
		display: flex;
		align-items: flex-start;
		gap: 12px;
		justify-content: space-between;
		padding: 18px 14px 13px 18px;
	}
	.control-panel-header strong {
		color: var(--theme-color-23454d);
		font-size: 14px;
		font-weight: 650;
	}
	.control-panel-header p {
		color: var(--theme-color-7a8d8b);
		margin: 4px 0 0;
		font-size: 11px;
		line-height: 1.5;
	}
	:global(.national-map .map-close-button) {
		color: var(--theme-color-7b908b);
		border-radius: 8px;
		margin-top: -3px;
	}
	.layer-list {
		padding: 0 8px 9px;
	}
	.foundation-layer,
	:global(.national-map .map-layer-row) {
		display: flex;
		align-items: center;
		justify-content: flex-start;
		width: 100%;
		min-height: 62px;
		height: auto;
		gap: 11px;
		padding: 10px;
		text-align: left;
		border-radius: 10px;
	}
	:global(.national-map .map-layer-row) {
		color: var(--theme-color-456167);
		transition: background-color 140ms ease;
		white-space: normal;
	}
	.layer-icon {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border: 1px solid var(--theme-color-dce7df);
		border-radius: 10px;
		flex-shrink: 0;
	}
	.layer-icon.land {
		background: var(--theme-color-f5f2e7);
		color: var(--theme-color-91a69b);
	}
	.layer-icon.health {
		background: var(--theme-color-edf6f2);
		color: var(--theme-color-087f7c);
		border-color: var(--theme-color-d7e7e0);
	}
	.layer-icon.transport {
		background: var(--theme-color-edf1f5);
		color: var(--theme-color-557a91);
		border-color: var(--theme-color-dde5ec);
	}
	.layer-icon.activity {
		background: var(--theme-color-f2eef6);
		color: var(--theme-color-8772a4);
		border-color: var(--theme-color-e6deec);
	}
	.layer-label {
		display: flex;
		flex-direction: column;
		flex: 1;
		gap: 4px;
		min-width: 0;
	}
	.layer-label strong {
		font-size: 12px;
		font-weight: 550;
		color: var(--theme-color-35565b);
	}
	.layer-label small {
		font-size: 10px;
		font-weight: 400;
		color: var(--theme-color-80918e);
		line-height: 1.4;
	}
	.foundation-layer :global(.foundation-check) {
		color: var(--theme-color-80a28c);
		flex-shrink: 0;
		margin-right: 7px;
	}
	.layer-switch {
		width: 29px;
		height: 17px;
		background: var(--theme-color-dce5e1);
		border-radius: 20px;
		padding: 2px;
		flex-shrink: 0;
		transition: background-color 140ms ease;
	}
	.layer-switch > span {
		display: block;
		width: 13px;
		height: 13px;
		border-radius: 50%;
		background: var(--theme-color-ffffff);
		box-shadow: 0 1px 3px var(--theme-color-294c4920);
		transition: transform 140ms cubic-bezier(0.23, 1, 0.32, 1);
	}
	.layer-switch[data-checked='true'] {
		background: var(--theme-color-278a78);
	}
	.layer-switch[data-checked='true'] > span {
		transform: translateX(12px);
	}
	.source-note {
		display: flex;
		align-items: flex-start;
		gap: 7px;
		border-top: 1px solid var(--theme-color-e9eee7);
		background: var(--theme-color-f7f8f3);
		padding: 12px 17px;
		font-size: 10px;
		line-height: 1.6;
		color: var(--theme-color-82918a);
	}
	.source-note :global(svg) {
		flex-shrink: 0;
		margin-top: 2px;
	}
	.view-actions {
		display: grid;
		gap: 7px;
		padding: 0 17px 14px;
	}
	:global(.national-map .map-view-action) {
		justify-content: flex-start;
		height: 39px;
		padding: 0 12px;
		gap: 9px;
		border-radius: 9px;
		border-color: var(--theme-color-dce7e0);
		background: var(--theme-color-ffffff);
		color: var(--theme-color-48716e);
		font-size: 12px;
	}
	.view-toggles {
		padding: 3px 8px 8px;
		border-top: 1px solid var(--theme-color-e9eee7);
	}
	:global(.national-map .map-layer-row.compact) {
		min-height: 43px;
		padding: 9px 11px;
		gap: 10px;
	}
	.view-readout {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 17px;
		border-top: 1px solid var(--theme-color-e9eee7);
		font-size: 9px;
		color: var(--theme-color-81928c);
		font-variant-numeric: tabular-nums;
	}
	.movement-providers {
		padding: 12px 17px;
		border-top: 1px solid var(--theme-color-e9eee7);
		color: var(--theme-color-67817d);
		font-size: 10px;
	}
	.movement-providers > strong {
		font-weight: 600;
	}
	.movement-providers p {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		margin: 10px 0 3px;
	}
	.movement-providers small {
		font-size: 9px;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.atlas-loading-status {
		position: absolute;
		z-index: 5;
		left: 50%;
		top: 46%;
		transform: translate(-50%, -50%);
		display: flex;
		align-items: center;
		gap: 10px;
		max-width: 85%;
		padding: 13px 17px;
		background: var(--theme-color-fffffff5);
		border: 1px solid var(--theme-color-d7e2df);
		border-radius: 12px;
		color: var(--theme-color-567772);
		font-size: 12px;
		pointer-events: none;
		text-align: center;
		box-shadow: 0 8px 32px -16px var(--theme-color-2b51452b);
	}
	.loading-spinner {
		width: 14px;
		height: 14px;
		flex-shrink: 0;
		border: 1.5px solid var(--theme-color-d2e8df);
		border-top-color: var(--theme-color-278a78);
		border-radius: 50%;
		animation: loading-spin 700ms linear infinite;
	}
	@keyframes loading-spin {
		to {
			transform: rotate(360deg);
		}
	}
	.map-footer {
		min-width: 0;
	}
	.map-information-card {
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-height: min(330px, 38svh);
		overflow: auto;
		padding: 8px 8px 5px;
		pointer-events: auto;
		scrollbar-width: thin;
	}
	.map-information-card:empty {
		display: none;
	}
	.sea-pressure-key {
		display: grid;
		gap: 7px;
		color: var(--theme-color-34585d);
	}
	.sea-pressure-key + .policy-colour-key,
	.sea-pressure-key + .accessibility-key {
		margin-top: 9px;
		padding-top: 9px;
		border-top: 1px solid var(--theme-color-dce7df);
	}
	.sea-pressure-heading {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 10px;
	}
	.sea-pressure-heading > div {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 3px 10px;
	}
	.sea-local-services {
		min-height: 32px;
		padding: 5px 8px;
		border: 1px solid var(--theme-color-d7e2df);
		border-radius: 7px;
		background: var(--theme-color-fffefa);
		color: var(--theme-color-1d645e);
		font-size: 10px;
		font-weight: 650;
		white-space: nowrap;
		cursor: pointer;
	}
	.sea-pressure-heading strong {
		font-size: 11px;
		font-weight: 650;
	}
	.sea-pressure-heading small {
		font-size: 9px;
		color: var(--theme-color-627a70);
	}
	.sea-pressure-swatches {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 5px 12px;
		font-size: 10px;
	}
	.sea-pressure-swatches > span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.sea-pressure-swatches i {
		width: 15px;
		height: 3px;
		border-radius: 2px;
	}
	.network-route-key {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 14px;
		font-size: 10px;
	}
	.network-route-key > span {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.network-route-key i {
		width: 17px;
		border-top: 2px solid var(--theme-color-607d8a);
	}
	.network-route-key .air i {
		height: 6px;
		border-radius: 50% 50% 0 0;
		transform: translateY(2px);
	}
	.sea-network-status {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 0;
		font-size: 11px;
	}
	.sea-network-status button {
		min-height: 32px;
		padding: 4px 7px;
		border-radius: 6px;
		color: var(--theme-color-1d645e);
		font-weight: 650;
		text-decoration: underline;
		text-underline-offset: 3px;
	}

	.map-key-details {
		display: grid;
		gap: 10px;
		padding-top: 10px;
		border-top: 1px solid var(--theme-color-dce7df);
	}
	.policy-colour-key {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 5px 10px;
	}
	.policy-colour-key > small,
	.policy-colour-key > .policy-overlay-swatches {
		grid-column: 1 / -1;
	}
	.map-information-card:not(.mobile-expanded)
		.policy-colour-key
		> small:not(.policy-overlay-status) {
		display: none;
	}
	.accessibility-key {
		display: grid;
		gap: 6px;
		width: 230px;
		max-width: 100%;
		color: var(--theme-color-34585d);
	}
	.accessibility-key strong {
		font-size: 11px;
		font-weight: 650;
	}
	.accessibility-key > span {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 10px;
	}
	.accessibility-key i {
		height: 7px;
		flex: 1;
		border-radius: 4px;
		background: linear-gradient(
			90deg,
			var(--theme-color-e6a24a),
			var(--theme-color-30969a),
			var(--theme-color-153f6f)
		);
	}
	.accessibility-key small {
		font-size: 9px;
		line-height: 1.4;
		color: var(--theme-color-5a6e72);
	}
	.policy-colour-key strong {
		font-size: 11px;
		color: var(--theme-color-4b6758);
		font-weight: 600;
	}
	.policy-colour-key span {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 10px;
		color: var(--theme-color-617465);
	}
	.policy-colour-key small {
		font-size: 9px;
		color: var(--theme-color-7d8a7c);
	}
	.policy-colour-key .policy-overlay-status {
		padding: 4px 6px;
		border-radius: 5px;
		background: var(--theme-color-edf5ef);
		color: var(--theme-color-376551);
		font-size: 10px;
		line-height: 1.4;
	}
	.policy-gap-gradient {
		width: 54px;
		height: 8px;
		border-radius: 3px;
		flex-shrink: 0;
	}
	.policy-colour-key .policy-coverage-fill-key {
		grid-column: 1 / -1;
		font-size: 9px;
		color: var(--theme-color-7d8a7c);
	}
	.overlay-opacity-control {
		margin: 4px 0 8px;
		padding: 12px;
		border: 1px solid var(--theme-color-dce8e2);
		border-radius: 10px;
		background: var(--theme-color-f5faf7);
	}
	.overlay-opacity-control > div {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		font-size: 12px;
		font-weight: 600;
	}
	.overlay-opacity-control output {
		color: var(--theme-color-087f7c);
		font-variant-numeric: tabular-nums;
	}
	.overlay-opacity-control input {
		display: block;
		width: 100%;
		height: 32px;
		margin: 2px 0;
		accent-color: var(--theme-color-087f7c);
		cursor: pointer;
	}
	.overlay-opacity-control input:focus-visible {
		outline: 2px solid var(--theme-color-087f7c);
		outline-offset: 2px;
		border-radius: 5px;
	}
	.overlay-opacity-control small {
		display: block;
		color: var(--theme-color-60776d);
		font-size: 10px;
		line-height: 1.5;
	}
	.policy-overlay-swatches {
		display: flex;
		flex-wrap: wrap;
		column-gap: 10px;
		row-gap: 5px;
	}
	.policy-overlay-swatches i {
		width: 9px;
		height: 9px;
		border-radius: 3px;
		flex-shrink: 0;
	}
	.map-information-card .map-movement-status,
	.map-information-card .street-context-status,
	.map-information-card .map-hint,
	.map-information-card .map-legend {
		padding: 0;
		border: 0;
		border-radius: 0;
		background: transparent;
		box-shadow: none;
	}
	:global(.national-map .vessel-group-target) {
		width: 64px;
		height: 36px;
		border: 0;
		border-radius: 12px;
		background: transparent;
		cursor: pointer;
		/* Mouse interactions use the rendered map layers so foreground buses remain selectable. */
		pointer-events: none;
	}
	:global(.national-map .vessel-group-target:focus-visible) {
		outline: 3px solid var(--theme-color-087f7c);
		outline-offset: 3px;
		background: var(--theme-color-087f7c10);
	}
	.map-hint {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 7px 10px;
		border: 1px solid var(--theme-color-d6e4de);
		border-radius: 8px;
		background: var(--theme-color-ffffffe6);
		color: var(--theme-color-67817d);
		font-size: 10px;
		max-width: min(100%, 350px);
		box-shadow: 0 2px 6px var(--theme-color-294c4908);
	}
	.map-hint span {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.map-hint :global(svg) {
		flex-shrink: 0;
	}
	.map-hint.picking {
		color: var(--theme-color-8e573c);
		border-color: var(--theme-color-e4c6ac);
		background: var(--theme-color-fff9ed);
	}
	.map-legend {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px 11px;
		max-width: 420px;
		padding: 7px 9px;
		border: 1px solid var(--theme-color-d6e4de);
		border-radius: 9px;
		background: var(--theme-color-fffef7ed);
		color: var(--theme-color-58756d);
		font-size: 10px;
	}
	.mobile-key-toggle {
		display: block;
		pointer-events: auto;
	}
	:global(.national-map .mobile-key-toggle button) {
		height: 36px;
		min-height: 36px;
		padding: 0 9px;
		gap: 5px;
		border-radius: 9px;
		font-size: 11px;
		font-weight: 550;
		color: var(--theme-color-58756d);
		background: transparent;
	}
	:global(.national-map .mobile-key-toggle button[aria-expanded='true']) {
		background: var(--theme-color-e9f3ef);
		color: var(--theme-color-087f7c);
	}
	:global(.national-map .mobile-key-toggle button[aria-expanded='true'] svg:last-child) {
		transform: rotate(180deg);
	}
	:global(.national-map .mobile-key-toggle button:active) {
		transform: scale(0.98);
	}
	:global(.national-map .mobile-key-toggle button:focus-visible) {
		outline: 2px solid var(--theme-color-087f78);
		outline-offset: 3px;
	}

	:global(.national-map .map-point-actions) {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 7px;
		margin: 14px 0;
	}
	:global(.national-map .map-point-actions button) {
		min-height: 38px;
		border: 1px solid var(--theme-color-d6e4de);
		border-radius: 8px;
		color: var(--theme-color-234e5a);
		background: var(--theme-color-f4f8f4);
		cursor: pointer;
		font: inherit;
		font-size: 11px;
	}
	:global(.national-map .map-point-actions .point-proposal-action) {
		grid-column: 1 / -1;
		background: var(--theme-color-087f78);
		color: var(--theme-color-ffffff);
		border-color: var(--theme-color-087f78);
	}
	:global(.national-map .map-point-actions button:hover) {
		filter: brightness(0.96);
	}
	:global(.national-map .map-point-actions button:active) {
		transform: scale(0.97);
	}
	:global(.national-map .map-point-actions button:focus-visible) {
		outline: 2px solid var(--theme-color-087f78);
		outline-offset: 2px;
	}
	:global(.national-map .map-location-cancel) {
		width: 100%;
		min-height: 32px;
		border: 0;
		border-radius: 7px;
		background: transparent;
		color: var(--theme-color-627a70);
		font: inherit;
		font-size: 11px;
		cursor: pointer;
	}
	:global(.national-map .map-location-cancel:focus-visible) {
		outline: 2px solid var(--theme-color-087f78);
		outline-offset: 2px;
	}
	:global(.national-map .atlas-stop-label) {
		max-width: 170px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		border-radius: 5px;
		padding: 2px 5px;
		color: var(--theme-color-35566e);
		background: var(--theme-color-fffefade);
		font-size: 10px;
		font-weight: 600;
		pointer-events: none;
	}
	:global(.national-map .journey-stop-label) {
		border: 1px solid var(--theme-color-c59a53);
		background: var(--theme-color-fffaee);
		color: var(--theme-color-795b2d);
		font-weight: 700;
	}
	:global(.national-map .map-record-card summary) {
		cursor: pointer;
		padding-block: 7px;
		color: var(--theme-color-627a70);
		font-size: 11px;
	}
	:global(.national-map .map-record-card p) {
		font-size: 12px;
		color: var(--theme-color-627a70);
		line-height: 1.5;
	}
	:global(.national-map .journey-drag-pin) {
		width: 30px;
		height: 30px;
		display: grid;
		place-items: center;
		color: var(--theme-color-ffffff);
		border: 3px solid var(--theme-color-ffffff);
		border-radius: 50%;
		background: var(--theme-color-087f78);
		font-weight: 700;
		box-shadow: 0 2px 8px var(--theme-color-12352f40);
		cursor: grab;
	}
	:global(.national-map .journey-drag-pin.end) {
		background: var(--theme-color-b76c43);
	}
	:global(.national-map .journey-drag-pin:active) {
		cursor: grabbing;
	}
	:global(.national-map .journey-waypoint-pin.static),
	:global(.national-map .journey-waypoint-pin.static:active) {
		cursor: pointer;
	}
	:global(.national-map .journey-waypoint-pin:focus-visible) {
		outline: 2px solid var(--foreground);
		outline-offset: 3px;
	}
	.map-legend > span {
		display: flex;
		align-items: center;
		gap: 5px;
		white-space: nowrap;
	}
	.map-legend i {
		display: inline-block;
		flex-shrink: 0;
	}
	.map-movement-status {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 8px 10px;
		max-width: min(100%, 365px);
		border: 1px solid var(--theme-color-d6e4de);
		border-radius: 10px;
		background: var(--theme-color-fffef7ed);
		color: var(--theme-color-496f6d);
		box-shadow: 0 2px 6px var(--theme-color-294c4908);
		pointer-events: auto;
	}
	.movement-counts {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.movement-counts > span {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.movement-counts strong {
		font-size: 10px;
		font-weight: 600;
	}
	:global(.national-map .movement-fit-button) {
		align-self: flex-start;
		color: var(--theme-color-337f7a);
		font-size: 10px;
		height: 25px;
		padding: 3px 6px;
		gap: 5px;
		margin-left: -5px;
	}
	.legend-cluster {
		display: grid !important;
		place-items: center;
		width: 13px;
		height: 13px;
		border: 1px solid var(--theme-color-6b9894);
		border-radius: 50%;
		background: var(--theme-color-fffefa);
		font-size: 8px;
		font-style: normal;
	}
	.legend-origin {
		color: var(--theme-color-337f7a);
	}
	.legend-destination {
		color: var(--theme-color-d56954);
	}
	:global(.national-map .marine-key) {
		color: var(--theme-color-3c8c9a);
	}
	:global(.national-map .health-key) {
		color: var(--theme-color-087f7c);
	}
	:global(.national-map .school-key) {
		color: var(--theme-color-ad7b3a);
	}
	:global(.national-map .transport-key) {
		color: var(--theme-color-557a91);
	}
	.legend-proposed {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--theme-color-ef7159);
		box-shadow: 0 0 0 2px var(--theme-color-ef715920);
	}
	.legend-route {
		width: 13px;
		height: 3px;
		border-radius: 4px;
		background: var(--theme-color-376eb1);
	}
	.legend-walk {
		width: 13px;
		border-top: 2px dashed var(--theme-color-496f6d);
	}
	.legend-ferry-route {
		width: 13px;
		height: 3px;
		border-radius: 4px;
		background: var(--theme-color-8a65a7);
	}
	.legend-journey-stop {
		width: 11px;
		height: 11px;
		border-radius: 50%;
		border: 2px solid var(--theme-color-c59a53);
		background: var(--theme-color-fff9e8);
	}
	.placement-target {
		position: absolute;
		z-index: 2;
		left: 50%;
		top: 50%;
		width: 24px;
		height: 24px;
		transform: translate(-50%, -50%);
		border: 1.5px solid var(--theme-color-997349);
		border-radius: 50%;
		background: var(--theme-color-fff9ed60);
		box-shadow: 0 0 0 4px var(--theme-color-fff9eda0);
		pointer-events: none;
	}
	.placement-target span {
		position: absolute;
		width: 4px;
		height: 4px;
		border-radius: 50%;
		background: var(--theme-color-997349);
		left: 50%;
		top: 50%;
		transform: translate(-50%, -50%);
	}
	.map-fallback {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 35px;
		text-align: center;
		color: var(--theme-color-567772);
		gap: 14px;
	}
	.map-fallback strong {
		font-size: 17px;
	}
	.map-fallback p {
		max-width: 370px;
		font-size: 13px;
		line-height: 1.6;
		margin: 0;
	}
	.map-fallback small {
		max-width: 380px;
		font-size: 10px;
		overflow-wrap: anywhere;
		opacity: 0.7;
	}
	:global(.national-map .map-record-popup) {
		z-index: 6;
	}
	:global(.national-map .map-record-popup .maplibregl-popup-content) {
		padding: 18px;
		border: 1px solid var(--theme-color-d7e2df);
		border-radius: 14px;
		box-shadow:
			0 5px 16px -8px var(--theme-color-294c4918),
			0 22px 54px -24px var(--theme-color-294c4945);
		font-family: inherit;
		background: var(--theme-color-fffefa);
	}
	:global(.national-map .map-record-popup .maplibregl-popup-close-button) {
		width: 28px;
		height: 28px;
		top: 5px;
		right: 5px;
		font-size: 19px;
		color: var(--theme-color-81958d);
		border-radius: 8px;
	}
	:global(.map-record-card) {
		max-height: 310px;
		overflow: auto;
		scrollbar-width: thin;
	}
	:global(.map-record-kind) {
		font-size: 9px;
		font-weight: 650;
		letter-spacing: 0.065em;
		text-transform: uppercase;
		color: var(--theme-color-759388);
	}
	:global(.map-record-card h3) {
		font-family: inherit;
		font-size: 14px;
		font-weight: 650;
		line-height: 1.45;
		color: var(--theme-color-294c53);
		margin: 6px 13px 12px 0;
		overflow-wrap: anywhere;
	}
	:global(.map-record-card dl) {
		display: grid;
		grid-template-columns: 84px minmax(0, 1fr);
		gap: 7px 9px;
		margin: 0;
		font-size: 10px;
		line-height: 1.5;
	}
	:global(.map-record-card dt) {
		color: var(--theme-color-83988f);
		font-weight: 400;
	}
	:global(.map-record-card dd) {
		color: var(--theme-color-36585f);
		margin: 0;
		overflow-wrap: anywhere;
	}
	:global(.map-record-card .map-record-id) {
		font-family: ui-monospace, 'Cascadia Code', monospace;
		font-size: 9px;
	}
	:global(.map-network-route-card .sea-route-pressure) {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 13px;
		font-size: 11px;
		font-weight: 650;
		color: var(--theme-color-36585f);
	}
	:global(.map-network-route-card .sea-route-pressure i) {
		width: 8px;
		height: 8px;
		border-radius: 50%;
	}
	:global(.map-network-route-card dl) {
		grid-template-columns: 104px minmax(0, 1fr);
		gap: 7px 10px;
		font-size: 11px;
	}
	:global(.map-network-route-card dt) {
		color: var(--theme-color-627a70);
	}
	:global(.map-network-route-card .sea-route-details) {
		margin-top: 12px;
		border-top: 1px solid var(--theme-color-dce7df);
	}
	:global(.national-map .map-network-route-card summary) {
		padding-block: 11px;
		font-weight: 650;
		color: var(--theme-color-1d645e);
	}
	:global(.national-map .map-network-route-card p) {
		margin: 10px 0;
		font-size: 11px;
	}
	:global(.map-network-route-card .sea-route-qualification) {
		color: var(--theme-color-627a70);
	}
	:global(.map-network-route-card .sea-route-detail-heading) {
		font-size: 11px;
		font-weight: 650;
		color: var(--theme-color-36585f);
	}
	:global(.map-network-route-card .sea-route-stops) {
		display: grid;
		gap: 5px;
		margin: 8px 0 12px;
		padding-left: 18px;
		font-size: 11px;
		line-height: 1.5;
		color: var(--theme-color-627a70);
	}
	:global(.map-network-route-card .sea-route-sources) {
		display: grid;
		gap: 8px;
		margin: 12px 0;
		font-size: 11px;
		line-height: 1.5;
	}
	:global(.map-network-route-card .sea-route-sources a) {
		color: var(--theme-color-1d645e);
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	:global(.map-network-route-card .sea-route-open) {
		width: 100%;
		min-height: 36px;
		margin-top: 3px;
		padding: 7px 10px;
		border: 1px solid var(--theme-color-d7e2df);
		border-radius: 8px;
		font-size: 11px;
		font-weight: 650;
		color: var(--theme-color-1d645e);
		background: var(--theme-color-edf5f1);
		cursor: pointer;
	}
	:global(.map-network-route-card :is(summary, button, a):focus-visible) {
		outline: 2px solid var(--theme-color-1d645e);
		outline-offset: 2px;
	}
	:global(.map-search-pin) {
		width: 32px;
		height: 32px;
		padding: 0;
		border: 3px solid var(--theme-color-fffefa);
		border-radius: 50%;
		background: var(--theme-color-1d645e);
		box-shadow:
			0 0 0 2px var(--theme-color-1d645e),
			0 4px 14px var(--theme-color-294c4945);
		cursor: pointer;
		z-index: 3;
	}
	:global(.map-search-pin::before) {
		content: '';
		position: absolute;
		inset: 8px;
		border-radius: 50%;
		background: var(--theme-color-fffefa);
	}
	:global(.map-search-pin::after) {
		content: '';
		position: absolute;
		left: 8px;
		bottom: -8px;
		width: 10px;
		height: 10px;
		border-right: 2px solid var(--theme-color-fffefa);
		border-bottom: 2px solid var(--theme-color-fffefa);
		background: var(--theme-color-1d645e);
		transform: rotate(45deg);
		z-index: -1;
	}
	:global(.map-search-pin:focus-visible) {
		outline: 3px solid var(--theme-color-1d645e);
		outline-offset: 5px;
	}
	:global(.map-record-card .map-search-source) {
		margin-top: -5px;
		font-size: 10px;
	}
	:global(.island-map-label) {
		pointer-events: none;
		font-family: inherit;
		color: var(--theme-color-1d645e);
		font-size: 12px;
		font-weight: 650;
		background: var(--theme-color-fffef6eb);
		border: 1px solid var(--theme-color-b8d9cc);
		border-radius: 8px;
		padding: 6px 11px;
		box-shadow: 0 3px 14px -6px var(--theme-color-294c4935);
		white-space: nowrap;
	}
	:global(.atlas-neighbor-label) {
		pointer-events: none;
		font-family: inherit;
		color: var(--theme-color-618176);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.025em;
		text-shadow:
			0 1px 4px var(--theme-color-ffffff),
			0 0 5px var(--theme-color-ffffff),
			0 0 5px var(--theme-color-ffffff);
		white-space: nowrap;
	}
	:global(.atlas-street-label) {
		pointer-events: none;
		font-family: inherit;
		font-size: 10px;
		font-weight: 550;
		letter-spacing: 0.015em;
		color: var(--theme-color-647169);
		text-shadow:
			0 1px 2px var(--theme-color-fffef4),
			1px 0 2px var(--theme-color-fffef4),
			-1px 0 2px var(--theme-color-fffef4),
			0 -1px 2px var(--theme-color-fffef4);
		white-space: nowrap;
		max-width: 180px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.street-context-status {
		display: flex;
		align-items: center;
		gap: 6px;
		width: fit-content;
		max-width: 100%;
		padding: 5px 8px;
		border: 1px solid var(--theme-color-d8e5de);
		border-radius: 7px;
		background: var(--theme-color-fffef7e8);
		color: var(--theme-color-6d8278);
		font-size: 9px;
		line-height: 1.3;
	}
	:global(.national-map .maplibregl-ctrl-top-right) {
		top: auto;
		bottom: var(--map-zoom-bottom, 24px);
		right: calc(var(--map-controls-right, 18px) - 10px);
	}
	:global(.national-map .maplibregl-ctrl-group) {
		border: 1px solid var(--theme-color-d7e2df);
		border-radius: 11px;
		box-shadow: 0 8px 24px -12px var(--theme-color-294c4935);
		overflow: hidden;
		background: var(--theme-color-fffffff5);
	}
	:global(.national-map .maplibregl-ctrl-group button) {
		width: 36px;
		height: 36px;
	}
	:global(.national-map .maplibregl-ctrl-group button + button) {
		border-top-color: var(--theme-color-e5ece7);
	}
	:global(.national-map .maplibregl-ctrl-bottom-right) {
		right: calc(var(--map-controls-right, 18px) - 10px);
		top: auto;
		bottom: 0;
		max-width: calc(100% - var(--map-controls-right, 18px) - 32px);
	}
	:global(.national-map .maplibregl-ctrl-scale) {
		font-family: inherit;
		font-size: 9px;
		color: var(--theme-color-65847c);
		border-color: var(--theme-color-739389);
		border-radius: 3px;
		background: var(--theme-color-ffffff80);
	}
	:global(.national-map .maplibregl-canvas-container.maplibregl-interactive) {
		cursor: grab;
	}
	:global(.national-map.is-picking .maplibregl-canvas-container.maplibregl-interactive) {
		cursor: crosshair;
	}
	@media (hover: hover) and (pointer: fine) {
		:global(.national-map .map-tool-button:hover),
		:global(.national-map .map-national-button:hover),
		:global(.national-map .map-layer-row:hover) {
			background: var(--theme-color-edf5f1);
		}
	}
	@container atlas (max-width: 900px) {
		:global(.map-workspace:not(.panel-hidden) .national-map .maplibregl-ctrl-top-right) {
			visibility: hidden;
		}
	}
	@container atlas (max-width: 700px) {
		:global(.national-map[data-accessibility-overview='true'] .maplibregl-ctrl-top-right) {
			bottom: calc(42dvh + 24px);
		}
		:global(.national-map[data-accessibility-overview='false'] .maplibregl-ctrl-top-right) {
			bottom: calc(var(--map-controls-bottom, 68px) + 119px);
		}
	}
	@container atlas (max-width: 620px) {
		:global(.map-workspace.policy-panel-open .national-map .maplibregl-ctrl-top-right),
		:global(.map-workspace.conditions-panel-open .national-map .maplibregl-ctrl-top-right),
		:global(.national-map:has(.map-information-card.mobile-expanded) .maplibregl-ctrl-top-right) {
			visibility: hidden;
		}
		/* Keep selected records and their close button clear of the mobile search strip. */
		:global(.national-map .map-source-record-popup) {
			inset: auto 14px 76px;
			max-width: none !important;
			transform: none !important;
			z-index: 6;
		}
		:global(.national-map .map-source-record-popup .maplibregl-popup-tip) {
			display: none;
		}
		:global(.national-map .map-source-record-popup .map-record-card) {
			max-height: min(260px, calc(var(--map-height, 520px) - 240px));
		}
		:global(.national-map:has(.map-source-record-popup) .map-controls),
		:global(.national-map:has(.map-source-record-popup) .map-footer) {
			visibility: hidden;
		}
		.mobile-key-toggle {
			display: block;
		}
		.map-information-card {
			max-height: min(45cqh, 300px);
			overflow: auto;
		}
		.map-hint:not(.picking) {
			display: none;
		}
		.map-footer {
			gap: 5px;
		}
		.map-movement-status {
			padding: 6px 8px;
			max-width: min(100%, 300px);
		}
		:global(.national-map .maplibregl-ctrl-bottom-right) {
			max-width: calc(100% - 32px);
		}
		.map-controls {
			left: 12px;
			width: calc(100% - 24px);
			max-width: none;
		}
		.map-toolbar {
			gap: 1px;
		}
		:global(.national-map .map-tool-button),
		:global(.national-map .map-national-button),
		:global(.national-map .mobile-key-toggle button) {
			height: 44px;
			min-height: 44px;
		}
		.policy-colour-key {
			gap: 5px;
		}
		.policy-colour-key strong {
			font-size: 10px;
		}
		.policy-colour-key span {
			font-size: 9px;
		}
		:global(.national-map .map-tool-button) {
			padding: 0 7px;
			font-size: 11px;
			gap: 6px;
		}
		.atlas-mark,
		.atlas-mark + .toolbar-divider {
			display: none;
		}
		.toolbar-divider {
			display: none;
		}
		:global(.national-map .mobile-key-toggle button) {
			padding-inline: 6px;
		}
		.control-panel {
			--map-panel-clearance: 280px;
			max-width: calc(100vw - 32px);
		}

		.map-legend {
			max-width: 300px;
			gap: 5px 9px;
		}
		.map-hint {
			max-width: 300px;
		}
	}
	@container atlas (max-width: 360px) {
		:global(.national-map .mobile-key-toggle button svg:last-child) {
			display: none;
		}
	}
	@media (pointer: coarse) {
		:global(.national-map .maplibregl-ctrl-group button) {
			width: 42px;
			height: 42px;
		}
		:global(.national-map .map-tool-button),
		:global(.national-map .map-national-button) {
			height: 40px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.national-map .map-tool-button),
		:global(.national-map .map-national-button),
		.layer-switch,
		.layer-switch > span {
			transition: none;
		}
		:global(.national-map .map-tool-button:active),
		:global(.national-map .map-national-button:active) {
			transform: none;
		}
		.loading-spinner {
			animation: none;
		}
	}
</style>
