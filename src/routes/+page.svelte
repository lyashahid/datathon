<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { goto } from '$app/navigation';
	import { PUBLIC_BASE_PATH } from '$app/env/public';
	import { animatedSelection, workspaceReveal } from '#lib/motion.js';
	import { searchExpansion, surfaceMotion } from '#lib/surface-motion.js';
	import { resizable, resetResizable } from '#lib/resizable.js';
	import { mapPanelLayout } from '#lib/map-panel-layout.js';
	import { capitalIslandIds, isCapitalIsland } from '#lib/capital-region.js';
	import {
		Map as MapIcon,
		FlaskConical,
		Sparkles,
		BookOpen,
		ArrowUpRight,
		ArrowRight,
		Plus,
		SquarePen,
		Undo2,
		Redo2,
		Download,
		Upload,
		Trash2,
		LocateFixed,
		Check,
		Activity,
		Route,
		Clapperboard,
		X,
		RefreshCw,
		Layers
	} from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import {
		ChartNoAxesCombined,
		ChevronRight,
		MapPin,
		PanelRightClose,
		Maximize2,
		Minimize2
	} from '@lucide/svelte';
	import CountryAccessibilityExplorer from '#lib/components/CountryAccessibilityExplorer.svelte';
	import MapSearch from '#lib/components/MapSearch.svelte';
	import SearchDirections from '#lib/components/SearchDirections.svelte';
	import ScenarioPresenter from '#lib/components/ScenarioPresenter.svelte';
	import type { PresentationView } from '#lib/presentation-state.js';
	import type { PresentationProgress } from '#lib/presentation-map.js';
	import { warmPresentationStory } from '#lib/presentation-story.js';
	import {
		searchDirectionsRequest,
		type SearchDirectionPoint,
		type SearchDirectionsResult,
		type SearchTravelMode
	} from '#lib/search-directions.js';
	import type { NationalAccessibility } from '#lib/analytics.js';
	import { emptyFeatures, type MapPolicyState, type PlacementKind } from '#lib/map-policy.js';
	import type { PolicyLens } from '#lib/policy-opportunities.js';
	import type { Feature } from 'geojson';
	import type { PlanningOperation } from '#lib/planning-map.js';
	import {
		seaNetworkMapState,
		seaServiceDate,
		type SeaNetwork,
		type SeaMapState,
		type SeaMapSelection
	} from '#lib/sea-connectivity.js';
	import type { AirNetwork } from '#lib/air-connectivity.js';
	import { api, subscribeApiInvalidation } from '#lib/api.js';
	import { downloadJson } from '#lib/download.js';
	import { MovementSession, movementScope } from '#lib/movement.js';
	import { deduplicateJourneyPlaces, type JourneyPlace } from '#lib/explore-journey.js';
	import {
		operationLabels,
		needsCoordinates,
		needsTarget,
		needsNodes,
		coordinatePair,
		validateOperation,
		parseScenario,
		newScenario
	} from '#lib/scenarios.js';
	import type {
		Coordinates,
		MapFeatures,
		IslandFeature,
		NationalSummary,
		IslandProfile,
		OperationType,
		ScenarioOperation,
		Scenario,
		Simulation,
		Comparison,
		RecommendationResponse,
		LiveStatus,
		LiveSnapshot,
		LandRoute
	} from '#lib/types.js';

	const workspaceLoaders = {
		national: () => import('#lib/components/AnalyticsDashboard.svelte'),
		forecast: () => import('#lib/components/ForecastWorkspace.svelte'),
		studio: () => import('#lib/components/DataStudio.svelte'),
		policy: () => import('#lib/components/PolicyWorkbench.svelte'),
		conditions: () => import('#lib/components/OperationsWorkspace.svelte'),
		schedules: () => import('#lib/components/SourceUpdatesWorkspace.svelte'),
		atlas: () => import('#lib/components/NationalMap.svelte'),
		mapPolicy: () => import('#lib/components/MapPolicyWorkspace.svelte'),
		sea: () => import('#lib/components/SeaConnectionsPanel.svelte'),
		evidence: () => import('#lib/components/EvidenceWorkspace.svelte')
	};
	type WorkspaceKey = keyof typeof workspaceLoaders;
	type WorkspaceModules = {
		[K in WorkspaceKey]: Awaited<ReturnType<(typeof workspaceLoaders)[K]>>['default'];
	};
	const workspaceNames: Record<WorkspaceKey, string> = {
		national: 'national dashboard',
		forecast: 'passenger outlook',
		studio: 'data studio',
		policy: 'advanced service and fleet workspace',
		conditions: 'weather, traffic and notices',
		schedules: 'timetables',
		atlas: 'island map',
		mapPolicy: 'map proposal tools',
		sea: 'sea connections',
		evidence: 'evidence workspace'
	};
	// Keep visited workspaces mounted so drafts and filters survive navigation.
	let workspaces = $state.raw<Partial<WorkspaceModules>>({});
	let workspaceBusy = $state.raw<Partial<Record<WorkspaceKey, boolean>>>({});
	let workspaceErrors = $state.raw<Partial<Record<WorkspaceKey, string>>>({});

	const tabs = [
		{ id: 'overview', label: 'Analytics', icon: ChartNoAxesCombined },
		{ id: 'map', label: 'Map & planning', icon: MapIcon },
		{ id: 'evidence', label: 'Evidence', icon: BookOpen }
	];
	const defaultMapIslandId = 'island:1442';
	const capitalBounds: [Coordinates, Coordinates] = [
		[73.497, 4.165],
		[73.555, 4.245]
	];
	let capitalRegion = $state(false);
	let policyLens = $state<PolicyLens>('overall');
	let policyCommand = $state<{
		id: number;
		kind:
			| 'inspect'
			| 'gaps'
			| 'compose'
			| 'close'
			| 'confirm'
			| 'cancel-placement'
			| 'adjust-budget'
			| 'cancel-service';
	} | null>(null);
	let policyMove = $state<{ id: number; index: number; coordinates: Coordinates } | null>(null);
	let servicePlacement = $state<{
		id: number;
		kind: 'bus' | 'ferry';
		coordinates: Coordinates;
	} | null>(null);
	let serviceLanding = $state<{
		id: number;
		terminalId: string;
		islandId?: string;
		coordinates: Coordinates;
	} | null>(null);
	let serviceCandidate = $state<{ id: number; stopId: string } | null>(null);
	let policyEdit = $state<{
		id: number;
		index: number;
		action: 'move' | 'duplicate' | 'remove';
	} | null>(null);
	let policyPickKind = $state<PlacementKind | null>(null);
	let policyState = $state.raw<MapPolicyState>({
		operations: [],
		pending: null,
		pendingDecision: null,
		gapFeatures: emptyFeatures(),
		coverageFillFeatures: emptyFeatures(),
		impactFeatures: emptyFeatures(),
		serviceFeatures: emptyFeatures(),
		calculating: false,
		stale: false,
		panelOpen: false
	});
	let conditionRoute = $state<Coordinates[]>([]);
	let seaMap = $state.raw<SeaMapState | null>(null);
	let seaNetwork = $state.raw<SeaNetwork | null>(null);
	let seaNetworkLoading = $state(false);
	let seaNetworkError = $state('');
	let seaNetworkRetry = $state(0);
	let presentationActive = $state(false);
	let presentationView = $state.raw<PresentationView | null>(null);
	let presentationProgress = $state.raw<PresentationProgress | null>(null);
	let presentationReturn = $state.raw<ReturnType<typeof capturePresentationContext> | null>(null);
	let presentationTrigger: HTMLElement | null = null;
	function capturePresentationContext() {
		return {
			selectedId,
			tab,
			exploreView,
			profileView,
			panelOpen,
			panelExpanded,
			accessExplorerOpen,
			capitalRegion,
			countryAtoll,
			focusBounds,
			focusPoint,
			searchSelection,
			route,
			routeStart,
			routeEnd,
			directions,
			directionPoints,
			directionPickIndex,
			policyLens,
			simulation,
			comparison,
			recommendations,
			seaMap,
			seaSelection,
			pickMode,
			islandPick,
			longitude,
			latitude,
			inspectedCell,
			policyCommand
		};
	}
	function startPresentation() {
		if (presentationActive || loading) return;
		presentationReturn = capturePresentationContext();
		presentationTrigger =
			document.activeElement instanceof HTMLElement ? document.activeElement : null;
		presentationActive = true;
		presentationView = null;
		presentationProgress = null;
		go('map', false);
		profileView = 'baseline';
		accessExplorerOpen = false;
		panelOpen = false;
		islandSearchOpen = false;
	}
	function showPresentationView(value: PresentationView) {
		if (!presentationActive) return;
		presentationView = value;
		if (selectedId !== value.islandId) selectIsland(value.islandId, false);
	}
	function showPresentationProgress(value: PresentationProgress) {
		if (presentationActive) presentationProgress = value;
	}
	function closePresentation() {
		const previous = presentationReturn;
		presentationActive = false;
		presentationView = null;
		presentationProgress = null;
		presentationReturn = null;
		if (previous) {
			if (previous.selectedId) selectIsland(previous.selectedId, false);
			else resetIslandSelection();
			tab = previous.tab;
			exploreView = previous.exploreView;
			profileView = previous.profileView;
			panelOpen = previous.panelOpen;
			panelExpanded = previous.panelExpanded;
			accessExplorerOpen = previous.accessExplorerOpen;
			capitalRegion = previous.capitalRegion;
			countryAtoll = previous.countryAtoll;
			focusBounds = previous.focusBounds;
			focusPoint = previous.focusPoint;
			searchSelection = previous.searchSelection;
			route = previous.route;
			routeStart = previous.routeStart;
			routeEnd = previous.routeEnd;
			directions = previous.directions;
			directionPoints = previous.directionPoints;
			directionPickIndex = previous.directionPickIndex;
			policyLens = previous.policyLens;
			simulation = previous.simulation;
			comparison = previous.comparison;
			recommendations = previous.recommendations;
			seaMap = previous.seaMap;
			seaSelection = previous.seaSelection;
			pickMode = previous.pickMode;
			islandPick = previous.islandPick;
			longitude = previous.longitude;
			latitude = previous.latitude;
			inspectedCell = previous.inspectedCell;
			policyCommand = previous.policyCommand;
			focusVersion += 1;
		}
		void tick().then(() => {
			if (presentationTrigger?.isConnected && presentationTrigger.getClientRects().length)
				presentationTrigger.focus({ preventScroll: true });
			presentationTrigger = null;
		});
	}
	let airNetwork = $state.raw<AirNetwork | null>(null);
	let airNetworkLoading = $state(false);
	let airNetworkError = $state('');
	let airNetworkRetry = $state(0);
	let airLayerEnabled = $state(true);
	function setAirLayer(enabled: boolean) {
		airLayerEnabled = enabled;
		writeLocation(true);
	}
	const initialSeaDate = seaServiceDate();
	let seaLayerEnabled = $state(true);
	function setSeaLayer(enabled: boolean) {
		seaLayerEnabled = enabled;
		writeLocation(true);
	}
	let seaSelection = $state<SeaMapSelection | null>(null);
	let seaOperations = $state.raw<PlanningOperation[]>([]);
	let seaAssumptions = $state.raw<Record<string, unknown>>({});
	let seaInitialMode = $state<'baseline' | 'scenario'>('baseline');
	function openSeaConnections(withDraft = false) {
		seaInitialMode = withDraft ? 'scenario' : 'baseline';
		if (!selectedId) selectIsland(defaultMapIslandId, false);
		const matchingOrigin = policyState.seaOriginIslandId === selectedId;
		seaOperations = matchingOrigin
			? withDraft
				? (policyState.seaOperations ?? policyState.operations)
				: (policyState.seaAcceptedOperations ?? [])
			: [];
		seaAssumptions =
			matchingOrigin && (withDraft || seaOperations.length)
				? (policyState.seaAssumptions ?? {})
				: {};
		seaMap = null;
		seaSelection = null;
		go('explore', false);
		exploreView = 'sea';
		panelOpen = false;
		pickMode = null;
		islandPick = null;
		accessExplorerOpen = false;
		writeLocation(true);
	}
	function closeSeaConnections() {
		exploreView = 'map';
		seaMap = null;
		focusBounds = null;
		focusVersion += 1;
		writeLocation(true);
	}
	let islandPick = $state<'ferry' | 'ferry-origin' | null>(null);
	let ferryOriginContext = $state<{ destination: string; date: string } | null>(null);
	let ferryDestinationId = $state<string | null>(null);
	let focusBounds = $state<{ id: number; bounds: [Coordinates, Coordinates] } | null>(null);
	function focusConnection(bounds: [Coordinates, Coordinates]) {
		searchSelection = null;
		focusPoint = null;
		focusBounds = { id: ++policySequence, bounds };
	}
	function openIslandConnections(islandId?: string) {
		if (islandId) selectIsland(islandId, false);
		openSeaConnections();
	}
	function proposeFerry(origin: string, destination: string, serviceDate: string) {
		selectIsland(origin, false);
		exploreView = 'map';
		seaMap = null;
		panelOpen = false;
		islandPick = null;
		incomingOperation = {
			type: 'compose_ferry_service',
			origin_island_id: origin,
			destination_island_id: destination,
			service_date: serviceDate
		};
		policyAction('compose');
	}
	let focusPoint = $state<{ id: number; coordinates: Coordinates } | null>(null);
	let inspectedCell = $state<Record<string, unknown> | null>(null);
	let policySequence = 0;
	function policyAction(kind: NonNullable<typeof policyCommand>['kind']) {
		policyCommand = { id: ++policySequence, kind };
	}
	function focusPolicyPoint(coordinates: Coordinates) {
		searchSelection = null;
		focusBounds = null;
		focusPoint = { id: ++policySequence, coordinates };
	}
	let tab = $state('overview');
	let countryAtoll = $state<string | null>(null);
	let accessExplorerOpen = $state(false);
	let accessScores = $state.raw<NationalAccessibility | null>(null);
	let accessLoading = $state(true);
	let accessError = $state('');
	let accessController: AbortController | undefined;
	let accessRequestedRevision = -1;
	const emptyPolicyMap = emptyFeatures();
	const isMapWorkspace = $derived(!['overview', 'evidence'].includes(tab));
	let proposalView = $state('advanced');
	let profileView = $state('baseline');
	let overviewView = $state('national');
	let exploreView = $state('map');
	const seaActive = $derived(tab === 'explore' && exploreView === 'sea');
	const seaNetworkDate = $derived(
		seaActive ? (seaMap?.serviceDate ?? initialSeaDate) : initialSeaDate
	);
	const mapTool = $derived(
		tab === 'scenarios' || tab === 'recommendations' ? 'proposals' : 'explore'
	);
	const activeWorkspace = $derived<WorkspaceKey>(
		tab === 'overview'
			? overviewView === 'passengers'
				? 'forecast'
				: overviewView === 'data'
					? 'studio'
					: overviewView === 'timetables'
						? 'schedules'
						: 'national'
			: tab === 'evidence'
				? 'evidence'
				: (tab === 'scenarios' || tab === 'recommendations') && proposalView === 'advanced'
					? 'policy'
					: tab === 'explore' && exploreView === 'notices'
						? 'conditions'
						: 'atlas'
	);
	let incomingOperation = $state<Record<string, unknown> | null>(null);
	let incomingPlacement = $state<{
		id: number;
		latitude: number;
		longitude: number;
		kind?: 'add_hospital' | 'add_school' | 'add_stop';
	} | null>(null);
	let placementSequence = 0;
	let panelOpen = $state(false);
	let panelExpanded = $state(false);
	let detailsElement = $state<HTMLElement>();
	let selectedId = $state<string | null>(null);
	// Island focus changes only metadata, not the national route geometry sent to the map worker.
	const preparedSeaNetwork = $derived(
		seaNetwork
			? seaNetworkMapState(
					seaNetwork,
					seaActive && seaMap?.serviceDate === seaNetwork.service_date ? seaMap : null
				)
			: seaMap
	);
	const displayedSeaNetwork = $derived(
		preparedSeaNetwork
			? {
					...preparedSeaNetwork,
					originIslandId: preparedSeaNetwork.originIslandId || selectedId || ''
				}
			: null
	);
	let overviewFeatures = $state.raw<MapFeatures | null>(null);
	let detailedFeatures = $state.raw<Record<string, MapFeatures>>({});
	let detailErrors = $state.raw<Record<string, string>>({});
	let detailVersion = $state(0);
	let sourceRevision = $state(0);
	// The capital is one loading region: choosing a neighbouring island must not
	// cancel its siblings' canonical geometry and facility downloads.
	const detailRegionKey = $derived(isCapitalIsland(selectedId) ? 'capital' : selectedId);
	const detailError = $derived((selectedId && detailErrors[selectedId]) || '');
	const selectedBoundaryFeatures = $derived<MapFeatures | null>(
		selectedId && detailedFeatures[selectedId]
			? {
					type: 'FeatureCollection',
					features: detailedFeatures[selectedId].features.filter(
						(feature) => feature.properties?.id === selectedId && !feature.properties?.island_id
					)
				}
			: null
	);
	const features = $derived.by(() => {
		if (!overviewFeatures) return null;
		if (!detailRegionKey) return overviewFeatures;
		const regionIds = detailRegionKey === 'capital' ? capitalIslandIds : [detailRegionKey];
		const details = regionIds.flatMap((id) => detailedFeatures[id]?.features ?? []);
		if (!details.length) return overviewFeatures;
		const regionIslandIds = new Set<string>(regionIds);
		const canonicalIds = new Set(
			details
				.filter((feature) => regionIslandIds.has(feature.properties?.id))
				.map((feature) => feature.properties?.id)
		);
		const seen = new SvelteSet<string | number>();
		return {
			...overviewFeatures,
			features: [
				...overviewFeatures.features.filter((feature) => !canonicalIds.has(feature.properties?.id)),
				...details
			].filter((feature) => {
				const id = feature.id ?? feature.properties?.id;
				if (id == null) return true;
				if (seen.has(id)) return false;
				seen.add(id);
				return true;
			})
		};
	});
	const journeyPlaces = $derived.by(() => {
		const seen = new SvelteSet<string>();
		const places: JourneyPlace[] = [];
		for (const feature of features?.features ?? []) {
			const properties = feature.properties;
			if (!properties?.name || !feature.geometry || properties.island_id !== selectedId) continue;
			const coordinates =
				feature.geometry.type === 'Point' ? feature.geometry.coordinates : properties.centroid;
			if (
				!Array.isArray(coordinates) ||
				coordinates.length !== 2 ||
				!coordinates.every(Number.isFinite)
			)
				continue;
			const id = String(
				properties.id ?? feature.id ?? `${properties.name}:${coordinates.join(',')}`
			);
			if (seen.has(id)) continue;
			seen.add(id);
			places.push({
				id,
				name: properties.name,
				coordinates: coordinates as Coordinates,
				category: properties.category,
				islandId: properties.island_id,
				stopRole:
					properties.category === 'bus_stop'
						? 'platform'
						: properties.tags?.bus === 'yes' &&
							  ['platform', 'stop_position'].includes(properties.tags?.public_transport)
							? properties.tags.public_transport
							: undefined,
				stopCode: properties.tags?.ref ?? properties.tags?.local_ref,
				direction: properties.tags?.direction
			});
		}
		for (const stop of transitStops) {
			if (!seen.has(stop.id))
				places.push({
					...stop,
					islandId: stop.national_island_id ?? stop.island_id,
					category: stop.mode === 'ferry' ? 'Ferry terminal' : 'Bus stop',
					stopRole: stop.mode === 'ferry' ? undefined : 'platform',
					stopCode: stop.operator_code,
					operatorStop: true
				});
		}
		return deduplicateJourneyPlaces(places).sort((a, b) => a.name.localeCompare(b.name));
	});
	let summary = $state.raw<NationalSummary | null>(null);
	let profile = $state.raw<IslandProfile | null>(null);
	let focusVersion = $state(0);
	let loading = $state(true);
	let profileLoading = $state(false);
	let profileError = $state('');
	let connection = $state('Connecting');
	let fatalError = $state('');
	let error = $state('');
	let notice = $state('');
	let islandSearchOpen = $state(false);
	let mapSearch = $state<{ focusGlobal: (atoll?: string | null) => void | Promise<void> } | null>(
		null
	);
	let searchSelection = $state.raw<{
		id: string;
		name: string;
		coordinates: Coordinates;
		category?: string;
		feature?: Feature;
	} | null>(null);
	async function openIslandSearch(_event?: MouseEvent, selectedAtoll?: string) {
		islandSearchOpen = true;
		await tick();
		void mapSearch?.focusGlobal(selectedAtoll ?? (selectedId ? null : countryAtoll));
	}
	let busy = $state('');
	let scenario = $state.raw<Scenario>(newScenario());
	let history = $state.raw<Scenario[]>([]);
	let redoHistory = $state.raw<Scenario[]>([]);
	let reference = $state.raw<Scenario | null>(null);
	let simulation = $state.raw<Simulation | null>(null);
	let comparison = $state.raw<Comparison | null>(null);
	let operationType = $state<OperationType>('add_bus_stop');
	let longitude = $state<string | number>('');
	let latitude = $state<string | number>('');
	let targetId = $state('');
	let fromNode = $state('');
	let toNode = $state('');
	let distance = $state<string | number>('');
	let disabledMode = $state('car');
	let pickMode = $state<'operation' | 'proposal' | 'start' | 'end' | null>(null);
	let routeStart = $state.raw<Coordinates | null>(null);
	let routeEnd = $state.raw<Coordinates | null>(null);
	// A traffic result belongs to the exact endpoints that produced it, including
	// changes made while the weather inspector is closed.
	$effect(() => {
		void routeStart;
		void routeEnd;
		untrack(() => (conditionRoute = []));
	});
	let routeMode = $state<SearchTravelMode>('walk');
	let directionPoints = $state<SearchDirectionPoint[]>([
		{ id: 'origin', name: '', coordinates: null },
		{ id: 'destination', name: '', coordinates: null }
	]);
	let directions = $state.raw<SearchDirectionsResult | null>(null);
	let directionPickIndex = $state<number | null>(null);
	let journeyFocusVersion = $state(0);
	let routeDate = $state('2026-10-10');
	let routeTime = $state('15:20');
	let transitStops = $state.raw<
		{
			id: string;
			name: string;
			coordinates: Coordinates;
			island_id?: string;
			national_island_id?: string;
			operator_code?: string | null;
			mode?: string;
		}[]
	>([]);
	let transitStopController: AbortController | undefined;
	let route = $state.raw<LandRoute | null>(null);
	let recommendationType = $state('bus_stop');
	let recommendations = $state.raw<RecommendationResponse | null>(null);
	let liveStatus = $state.raw<LiveStatus | null>(null);
	let liveObservedSnapshot = $state.raw<LiveSnapshot | null>(null);
	let liveObservedScope = $state<string | null>(null);
	let liveBusy = $state(false);
	let liveError = $state('');
	let documentVisible = $state(true);
	let controller: AbortController | undefined;
	let profileController: AbortController | undefined;
	let actionController: AbortController | undefined;
	let detailController: AbortController | undefined;
	let initialized = $state(false);
	let mapVisited = $state(false);
	const showSearchDirections = $derived(
		isMapWorkspace && tab === 'explore' && exploreView === 'map' && profileView === 'route'
	);
	const showAccessExplorer = $derived(
		isMapWorkspace &&
			!presentationActive &&
			!selectedId &&
			tab === 'explore' &&
			exploreView === 'map' &&
			profileView !== 'route' &&
			accessExplorerOpen &&
			!panelOpen &&
			!pickMode &&
			!policyState.panelOpen
	);
	const preparingIsland = $derived(loading && ['policy', 'conditions'].includes(activeWorkspace));
	const showMapContextActions = $derived(
		tab === 'explore' &&
			exploreView === 'map' &&
			!showSearchDirections &&
			!!selectedId &&
			!seaActive &&
			!showAccessExplorer &&
			!panelOpen &&
			!pickMode &&
			!islandPick &&
			!policyPickKind &&
			!policyState.serviceEditor &&
			!policyState.pending
	);
	async function loadWorkspace(key: WorkspaceKey) {
		if (workspaces[key] || workspaceBusy[key]) return;
		workspaceBusy = { ...workspaceBusy, [key]: true };
		workspaceErrors = { ...workspaceErrors, [key]: '' };
		try {
			const { default: component } = await workspaceLoaders[key]();
			workspaces = { ...workspaces, [key]: component };
		} catch {
			workspaceErrors = {
				...workspaceErrors,
				[key]: `The ${workspaceNames[key]} could not load. Check your connection and try again.`
			};
		} finally {
			workspaceBusy = { ...workspaceBusy, [key]: false };
		}
	}
	$effect(() => {
		const key = activeWorkspace;
		if (initialized) untrack(() => void loadWorkspace(key));
	});
	$effect(() => {
		if (initialized && isMapWorkspace) {
			mapVisited = true;
			untrack(() => void loadWorkspace('atlas'));
		}
	});
	$effect(() => {
		if (!initialized || !isMapWorkspace) return;
		const revision = sourceRevision;
		untrack(() => {
			if (accessRequestedRevision === revision) return;
			accessRequestedRevision = revision;
			void loadAccessScores();
		});
	});
	$effect(() => {
		if (!initialized || !isMapWorkspace) return;
		if (
			!accessExplorerOpen ||
			(policyCommand && policyCommand.kind !== 'close') ||
			incomingPlacement ||
			incomingOperation
		)
			untrack(() => void loadWorkspace('mapPolicy'));
		if (seaActive) untrack(() => void loadWorkspace('sea'));
	});
	// Load on the first map visit, then retain it independently of islands and layer toggles.
	$effect(() => {
		if (!initialized || !mapVisited) return;
		void sourceRevision;
		void seaNetworkRetry;
		const active = new AbortController();
		seaNetworkLoading = true;
		seaNetworkError = '';
		void api<SeaNetwork>(`planning/sea-network?date=${seaNetworkDate}`, undefined, active.signal)
			.then((value) => {
				if (!active.signal.aborted) seaNetwork = value;
			})
			.catch((cause) => {
				if (!active.signal.aborted)
					seaNetworkError =
						cause instanceof Error ? cause.message : 'Sea connections could not load.';
			})
			.finally(() => {
				if (!active.signal.aborted) seaNetworkLoading = false;
			});
		return () => active.abort();
	});
	$effect(() => {
		if (!initialized || !mapVisited) return;
		void sourceRevision;
		void airNetworkRetry;
		const active = new AbortController();
		airNetworkLoading = true;
		airNetworkError = '';
		void api<AirNetwork>(`planning/air-network?date=${seaNetworkDate}`, undefined, active.signal)
			.then((value) => {
				if (!active.signal.aborted) airNetwork = value;
			})
			.catch((cause) => {
				if (!active.signal.aborted)
					airNetworkError =
						cause instanceof Error ? cause.message : 'Domestic flights could not load.';
			})
			.finally(() => {
				if (!active.signal.aborted) airNetworkLoading = false;
			});
		return () => active.abort();
	});
	let lastDetailVersion = 0;
	$effect(() => {
		const region = detailRegionKey;
		const version = detailVersion;
		void sourceRevision;
		if (!initialized || !isMapWorkspace || !region) return;
		const regionIds = region === 'capital' ? capitalIslandIds : [region];
		const retry = version !== lastDetailVersion;
		lastDetailVersion = version;
		const pending = untrack(() => regionIds.filter((id) => retry || !detailedFeatures[id]));
		if (!pending.length) return;
		const active = new AbortController();
		detailController?.abort();
		detailController = active;
		untrack(() => {
			detailErrors = {
				...detailErrors,
				...Object.fromEntries(pending.map((id) => [id, '']))
			};
		});
		for (const id of pending) {
			void api<MapFeatures>(
				`map/features?layer=all&island_id=${encodeURIComponent(id)}`,
				undefined,
				active.signal
			)
				.then((data) => {
					if (!active.signal.aborted)
						detailedFeatures = {
							...Object.fromEntries(
								Object.entries(detailedFeatures).filter(([islandId]) => isCapitalIsland(islandId))
							),
							[id]: data
						};
				})
				.catch(() => {
					if (!active.signal.aborted)
						detailErrors = {
							...detailErrors,
							[id]: 'Detailed map evidence could not load. Retry before placing a proposal.'
						};
				});
		}
		return () => active.abort();
	});
	let importInput = $state<HTMLInputElement | null>(null);
	const islands = $derived(
		(overviewFeatures?.features.filter(
			(feature) =>
				typeof feature.properties?.id === 'string' && feature.properties.id.startsWith('island:')
		) ?? []) as IslandFeature[]
	);
	const selected = $derived(islands.find((island) => island.properties.id === selectedId));
	const selectedCoordinates = $derived(
		selected?.properties.centroid ??
			(selected?.geometry.type === 'Point'
				? (selected.geometry.coordinates as Coordinates)
				: undefined)
	);
	const searchIsland = $derived(
		selected
			? {
					id: selected.properties.id,
					name: islandName(selected.properties.name, selected.properties.id),
					coordinates: selectedCoordinates,
					boundary:
						selectedBoundaryFeatures?.features.find(
							(feature) => feature.properties?.id === selectedId
						)?.geometry ?? selected.geometry
				}
			: null
	);
	const actionContext = $derived({
		scenario,
		reference,
		selectedId,
		directionPoints,
		routeStart,
		routeEnd,
		routeMode,
		routeDate,
		routeTime,
		recommendationType,
		activeWorkspace
	});
	let submittedActionContext: typeof actionContext | undefined;
	function cancelAction() {
		actionController?.abort();
		actionController = undefined;
		submittedActionContext = undefined;
		busy = '';
	}
	$effect(() => {
		const context = actionContext;
		untrack(() => {
			if (submittedActionContext && submittedActionContext !== context) cancelAction();
		});
	});
	async function runAction<T>(
		name: string,
		request: (signal: AbortSignal) => Promise<T>,
		apply: (result: T) => void
	) {
		cancelAction();
		const active = new AbortController();
		actionController = active;
		submittedActionContext = actionContext;
		busy = name;
		error = '';
		try {
			const result = await request(active.signal);
			if (
				actionController === active &&
				submittedActionContext === actionContext &&
				!active.signal.aborted
			)
				apply(result);
		} catch (cause) {
			if (
				actionController === active &&
				submittedActionContext === actionContext &&
				!active.signal.aborted
			)
				error = message(cause);
		} finally {
			if (actionController === active) {
				actionController = undefined;
				submittedActionContext = undefined;
				busy = '';
			}
		}
	}
	const movementVisible = $derived(
		initialized && !loading && documentVisible && isMapWorkspace && !presentationActive
	);
	$effect(() => {
		if (initialized && !loading && isMapWorkspace) void warmPresentationStory().catch(() => {});
	});
	const selectedMovementKey = $derived(
		selectedId && selectedCoordinates ? `${selectedId}:${selectedCoordinates.join(':')}` : null
	);
	const liveSnapshot = $derived(
		liveObservedScope === selectedMovementKey ? liveObservedSnapshot : null
	);
	const emptyOperations: MapPolicyState['operations'] = [];
	const emptyLiveEvents: LiveSnapshot['events'] = [];
	const emptyProviders: NonNullable<LiveSnapshot['providers']> = [];
	const displayedScores = $derived.by(() => {
		const fullScore = profile?.island.id === selectedId ? profile.accessibility : null;
		return fullScore && accessScores
			? accessScores.scores.map((score) => (score.island_id === selectedId ? fullScore : score))
			: (accessScores?.scores ?? null);
	});
	const displayedLiveStatus = $derived({
		loading: liveBusy,
		retrieved_at: liveSnapshot?.retrieved_at,
		providers: liveSnapshot?.providers ?? emptyProviders,
		message: liveError || (!movementVisible ? 'Updates paused · observed positions only' : '')
	});
	const movementSession = new MovementSession(
		(scope, signal) => api<LiveSnapshot>(`live/snapshot?${scope.query}`, undefined, signal),
		(state) => {
			liveObservedSnapshot = state.snapshot;
			liveObservedScope = state.scopeKey;
			liveBusy = state.loading;
			liveError = state.error;
		},
		() => liveSnapshot?.poll_interval_seconds ?? liveStatus?.poll_interval_seconds ?? 60
	);
	$effect(() => {
		const id = selectedId;
		const name = selected?.properties.name ?? 'Selected island';
		const coordinates = selectedCoordinates;
		const active = movementVisible;
		untrack(() => {
			movementSession.configure(
				active && id && coordinates ? movementScope(id, name, coordinates) : null
			);
		});
	});
	$effect(() => {
		void sourceRevision;
		if (!initialized || activeWorkspace !== 'atlas') return;
		const active = new AbortController();
		transitStopController?.abort();
		transitStopController = active;
		// Stops are map context: panning to a neighbouring island must keep its stops visible.
		void api<{ stops: typeof transitStops }>('routing/stops', undefined, active.signal)
			.then((result) => {
				if (!active.signal.aborted) transitStops = result.stops;
			})
			.catch(() => {
				/* Existing source map features remain available if the stop catalogue cannot load. */
			});
		return () => active.abort();
	});
	const fmt = (value: number | undefined | null) =>
		value == null ? 'Unavailable' : new Intl.NumberFormat('en').format(value);
	const label = (value: string) => value.replaceAll('_', ' ');
	function islandName(name: string | null | undefined, id: string | undefined) {
		return name?.trim() || `Unnamed island${id ? ` (${id})` : ''}`;
	}
	const signed = (value: number) => `${value > 0 ? '+' : ''}${fmt(value)}`;
	const message = (cause: unknown) =>
		cause instanceof Error ? cause.message : 'The request failed. Please retry.';

	async function load(preserveContext = false) {
		controller?.abort();
		const active = new AbortController();
		controller = active;
		if (!preserveContext) loading = true;
		fatalError = '';
		connection = 'Connecting';
		// Metadata and provider availability must not delay drawing the supplied geography.
		void api<NationalSummary>('national/summary', undefined, active.signal)
			.then((national) => {
				if (!active.signal.aborted) summary = national;
			})
			.catch(() => {});
		void api<LiveStatus>('live/status', undefined, active.signal)
			.then((status) => {
				if (!active.signal.aborted) liveStatus = status;
			})
			.catch(() => {});
		try {
			const map = await api<MapFeatures>(
				'map/features?layer=islands&simplify_m=25',
				undefined,
				active.signal
			);
			if (active.signal.aborted) return;
			connection = 'Backend connected';
			overviewFeatures = map;
			// Source refreshes replace evidence without moving the camera or reopening tools.
			if (preserveContext) return;
			const initial =
				islands.find((island) => island.properties.id === selectedId) ??
				(tab === 'scenarios' || tab === 'recommendations'
					? islands.find((island) => /^(mal[eé]|male.? city)$/i.test(island.properties.name ?? ''))
					: undefined);
			if (initial) {
				const keepCapitalRegion = capitalRegion;
				selectIsland(initial.properties.id, false);
				capitalRegion = keepCapitalRegion;
				writeLocation(false);
			} else if (selectedId) resetIslandSelection();
		} catch (cause) {
			if (!active.signal.aborted) {
				if (preserveContext) error = message(cause);
				else fatalError = message(cause);
				connection = 'Backend unavailable';
			}
		} finally {
			if (!active.signal.aborted) loading = false;
		}
	}
	function refreshSources() {
		directions = null;
		cancelAction();
		simulation = null;
		comparison = null;
		recommendations = null;
		route = null;
		conditionRoute = [];
		summary = null;
		accessScores = null;
		detailController?.abort();
		detailedFeatures = {};
		detailErrors = {};
		transitStopController?.abort();
		transitStops = [];
		sourceRevision += 1;
		if (selectedId) void loadProfile(selectedId);
		void load(true);
	}
	async function loadAccessScores() {
		accessController?.abort();
		const active = new AbortController();
		accessController = active;
		accessLoading = true;
		accessError = '';
		try {
			const result = await api<NationalAccessibility>(
				'accessibility/summary?compact=true',
				undefined,
				active.signal
			);
			if (!active.signal.aborted) accessScores = result;
		} catch (cause) {
			if (!active.signal.aborted) accessError = message(cause);
		} finally {
			if (!active.signal.aborted) accessLoading = false;
		}
	}
	function resetIslandSelection() {
		focusBounds = null;
		searchSelection = null;
		islandPick = null;
		capitalRegion = false;
		profileController?.abort();
		profile = null;
		profileLoading = false;
		profileError = '';
		profileView = 'baseline';
		focusPoint = null;
		selectedId = null;
		panelOpen = false;
		pickMode = null;
		inspectedCell = null;
		accessExplorerOpen = true;
		resetJourney();
		policyAction('close');
	}
	function showCountry() {
		resetIslandSelection();
		policyLens = 'overall';
		countryAtoll = null;
		go('map', false);
		focusVersion += 1;
		writeLocation(true);
	}
	function showDefaultMap() {
		resetIslandSelection();
		policyLens = 'overall';
		selectIsland(defaultMapIslandId, false);
		go('map', false);
		focusVersion += 1;
		writeLocation(true);
	}
	function focusSelectedIsland() {
		focusBounds = null;
		searchSelection = null;
		capitalRegion = false;
		focusVersion += 1;
		writeLocation(true);
	}
	function showAtoll(name: string) {
		resetIslandSelection();
		policyLens = 'overall';
		countryAtoll = name;
		go('map', false);
		focusVersion += 1;
		writeLocation(true);
	}
	function selectIsland(id: string, push = true) {
		focusBounds = null;
		searchSelection = null;
		capitalRegion = false;
		countryAtoll = islands.find((island) => island.properties.id === id)?.properties.atoll ?? null;
		accessExplorerOpen = false;
		if (id === selectedId) {
			islandSearchOpen = false;
			focusVersion += 1;
			if (!profile && !profileLoading) void loadProfile(id);
			return;
		}
		selectedId = id;
		if (!showSearchDirections) resetJourney();
		seaMap = null;
		seaSelection = null;
		islandSearchOpen = false;
		pickMode = null;
		error = '';
		simulation = null;
		comparison = null;
		recommendations = null;
		route = null;
		routeStart = null;
		routeEnd = null;
		longitude = '';
		latitude = '';
		focusVersion += 1;
		if (initialized && push) writeLocation(true);
		void loadProfile(id);
	}
	async function loadProfile(id: string) {
		profileController?.abort();
		const active = new AbortController();
		profileController = active;
		profile = null;
		profileLoading = true;
		profileError = '';
		try {
			const next = await api<IslandProfile>(
				`islands/${encodeURIComponent(id)}/profile`,
				undefined,
				active.signal
			);
			if (!active.signal.aborted) profile = next;
		} catch (cause) {
			if (!active.signal.aborted) {
				profileError = message(cause);
				error = profileError;
			}
		} finally {
			if (!active.signal.aborted) profileLoading = false;
		}
	}
	function picked(coordinates: Coordinates) {
		if (pickMode === 'proposal') {
			placeProposal(coordinates);
			return;
		}
		if (directionPickIndex !== null && showSearchDirections) {
			const index = directionPickIndex;
			directionPoints = directionPoints.map((point, pointIndex) =>
				pointIndex === index
					? {
							...point,
							coordinates,
							name: `${coordinates[1].toFixed(5)}, ${coordinates[0].toFixed(5)}`,
							islandId: null
						}
					: point
			);
			directionsChanged();
			journeyFocusVersion += 1;
			return;
		}
		if (pickMode === 'operation') {
			longitude = coordinates[0].toFixed(6);
			latitude = coordinates[1].toFixed(6);
		}
		pickMode = null;
	}
	function placeProposal(
		coordinates: Coordinates,
		kind?: 'add_hospital' | 'add_school' | 'add_stop'
	) {
		seaLayerEnabled = false;
		searchSelection = null;
		accessExplorerOpen = false;
		incomingPlacement = {
			id: ++placementSequence,
			longitude: coordinates[0],
			latitude: coordinates[1],
			kind: kind ?? policyPickKind ?? undefined
		};
		pickMode = null;
		policyPickKind = null;
		panelOpen = false;
		exploreView = 'map';
		if (tab !== 'explore') go('explore', false);
		writeLocation(true);
	}
	function useJourneyPoint(
		coordinates: Coordinates,
		endpoint: 'start' | 'end',
		name = 'Selected on map',
		focus = true
	) {
		if (tab !== 'explore' || exploreView !== 'map') {
			go('explore', false);
			exploreView = 'map';
		}
		const index = endpoint === 'start' ? 0 : directionPoints.length - 1;
		directionPoints = directionPoints.map((point, pointIndex) =>
			pointIndex === index ? { ...point, coordinates, name, islandId: null } : point
		);
		directionsChanged();
		searchSelection = null;
		profileView = 'route';
		panelOpen = false;
		accessExplorerOpen = false;
		policyAction('close');
		pickMode = null;
		if (focus) journeyFocusVersion += 1;
		writeLocation(true);
	}
	function inspectIsland(id: string) {
		if (showSearchDirections && directionPickIndex !== null) {
			const island = islands.find((candidate) => candidate.properties.id === id);
			const coordinates = island?.properties.centroid;
			if (coordinates) {
				const index = directionPickIndex;
				directionPoints = directionPoints.map((point, pointIndex) =>
					pointIndex === index
						? { ...point, coordinates, name: islandName(island.properties.name, id), islandId: id }
						: point
				);
				directionsChanged();
				journeyFocusVersion += 1;
			}
			return;
		}
		if (islandPick) {
			if (islandPick === 'ferry-origin') {
				const context = ferryOriginContext;
				islandPick = null;
				if (context)
					proposeFerry(id, context.destination === id ? '' : context.destination, context.date);
				return;
			}
			ferryDestinationId = id;
			islandPick = null;
			return;
		}
		selectIsland(id, false);
		panelOpen = false;
		inspectedCell = null;
		accessExplorerOpen = false;
		policyAction('close');
		writeLocation(true);
	}
	function selectSearchPlace(place: NonNullable<typeof searchSelection>) {
		searchSelection = place;
		islandSearchOpen = false;
		focusBounds = null;
		capitalRegion = false;
		pickMode = null;
		panelOpen = false;
		inspectedCell = null;
		policyAction('close');
	}
	function chooseJourneyPoint(endpoint: 'start' | 'end') {
		if (!showSearchDirections) setProfileView('route');
		pickDirectionPoint(endpoint === 'start' ? 0 : directionPoints.length - 1);
	}
	function directionsChanged() {
		cancelAction();
		directions = null;
		route = null;
		error = '';
		directionPickIndex = null;
		pickMode = null;
		routeStart = directionPoints[0]?.coordinates ?? null;
		routeEnd = directionPoints.at(-1)?.coordinates ?? null;
	}
	function pickDirectionPoint(index: number) {
		if (directionPickIndex === index) {
			cancelPick();
			return;
		}
		directionPickIndex = index;
		pickMode = index === 0 ? 'start' : 'end';
		panelOpen = false;
		searchSelection = null;
	}
	function clearJourneyPoint(endpoint: 'start' | 'end') {
		const index = endpoint === 'start' ? 0 : directionPoints.length - 1;
		directionPoints = directionPoints.map((point, pointIndex) =>
			pointIndex === index ? { ...point, coordinates: null, name: '' } : point
		);
		directionsChanged();
	}
	function resetJourney() {
		directionPoints = [
			{ id: 'origin', name: '', coordinates: null },
			{ id: 'destination', name: '', coordinates: null }
		];
		directionsChanged();
	}
	function cancelPick() {
		if (islandPick) {
			if (islandPick === 'ferry' || islandPick === 'ferry-origin') policyAction('compose');
			else panelOpen = true;
			islandPick = null;
			return;
		}
		if (pickMode === 'proposal' || policyPickKind || policyState.pending)
			policyAction('cancel-placement');
		directionPickIndex = null;
		pickMode = null;
		policyPickKind = null;
		ferryDestinationId = null;
	}
	function closeJourney() {
		cancelAction();
		directionPickIndex = null;
		islandPick = null;
		pickMode = null;
		panelOpen = false;
		profileView = 'baseline';
		writeLocation(true);
	}
	function returnToExplore() {
		exploreView = 'map';
		go('explore');
		panelOpen = false;
	}
	function edit(next: Scenario) {
		history = [...history.slice(-49), structuredClone(scenario)];
		redoHistory = [];
		scenario = next;
		simulation = null;
		comparison = null;
		notice = '';
		error = '';
	}
	function undo() {
		if (!history.length) return;
		redoHistory = [...redoHistory, scenario];
		scenario = history.at(-1)!;
		history = history.slice(0, -1);
		simulation = null;
		comparison = null;
	}
	function redo() {
		if (!redoHistory.length) return;
		history = [...history, scenario];
		scenario = redoHistory.at(-1)!;
		redoHistory = redoHistory.slice(0, -1);
		simulation = null;
		comparison = null;
	}
	function addOperation() {
		try {
			if (!selectedId) throw new Error('Select an island first.');
			if (scenario.operations.length >= 100)
				throw new Error('A scenario can contain at most 100 operations.');
			const operation: ScenarioOperation = { type: operationType, island_id: selectedId };
			if (needsCoordinates(operationType))
				operation.coordinates = coordinatePair(longitude, latitude);
			if (needsTarget(operationType)) operation.target_id = targetId.trim();
			if (needsNodes(operationType)) {
				operation.from_node_id = fromNode.trim();
				operation.to_node_id = toNode.trim();
				if (String(distance).trim()) operation.distance_m = Number(distance);
			}
			if (operationType === 'weather_disruption') operation.disabled_modes = [disabledMode];
			validateOperation(operation);
			edit({ ...scenario, operations: [...scenario.operations, operation] });
		} catch (cause) {
			error = message(cause);
		}
	}
	async function runScenario() {
		const submitted = scenario,
			scope = selectedId;
		await runAction(
			'simulation',
			(signal) =>
				api<Simulation>('simulation/run', { scenario: submitted, island_id: scope }, signal),
			(result) => {
				simulation = result;
				setProposalView('review');
				detailsElement?.scrollTo({ top: 0 });
			}
		);
	}
	async function compareScenario() {
		if (!reference) return;
		const submitted = scenario,
			savedReference = reference,
			scope = selectedId;
		await runAction(
			'compare',
			(signal) =>
				api<Comparison>(
					'simulation/compare',
					{ first: submitted, second: savedReference, island_id: scope },
					signal
				),
			(result) => (comparison = result)
		);
	}
	function exportScenario() {
		downloadJson(scenario, `${scenario.id.replace(/[^a-z0-9_-]/gi, '_')}.json`);
	}
	async function importScenario(event: Event) {
		const file = (event.target as HTMLInputElement).files?.[0];
		if (!file) return;
		try {
			if (file.size > 1000000) throw new Error('Scenario files must be smaller than 1 MB.');
			edit(parseScenario(await file.text()));
			setProposalView('edit');
			notice = 'Scenario imported. Review its operations before running it.';
		} catch (cause) {
			error = message(cause);
		} finally {
			if (importInput) importInput.value = '';
		}
	}
	async function requestRoute() {
		const [hours, minutes] = routeTime.split(':').map(Number);
		const departure_minutes = hours * 60 + minutes;
		const request = searchDirectionsRequest(
			directionPoints,
			routeMode,
			routeDate,
			departure_minutes
		);
		if (!request) return;
		directions = null;
		pickMode = null;
		directionPickIndex = null;
		await runAction(
			'route',
			(signal) => api<SearchDirectionsResult>('routing/journey', request, signal),
			(result) => {
				directions = result;
				journeyFocusVersion += 1;
			}
		);
	}
	async function requestRecommendations() {
		recommendations = null;
		const type = recommendationType,
			scope = selectedId;
		await runAction(
			'recommendations',
			(signal) =>
				api<RecommendationResponse>(
					'recommendations',
					{
						type,
						island_id: scope,
						limit: 5,
						config: { benefit_weight: 0.7, confidence_weight: 0.3, max_candidates: 20 }
					},
					signal
				),
			(result) => (recommendations = result)
		);
	}
	onMount(() => {
		try {
			const saved = localStorage.getItem('mobility-v2-scenario');
			if (saved) scenario = parseScenario(saved);
		} catch {
			notice = 'The saved scenario could not be restored. Import a valid export to recover it.';
		}
		const restoreView = () => {
			const params = new URL(location.href).searchParams;
			const requested = params.get('view') ?? 'overview';
			const isMapView = !['overview', 'evidence'].includes(requested);
			const explicitIsland = params.get('island');
			const useDefaultIsland =
				isMapView && params.get('scope') !== 'country' && !params.has('atoll') && !explicitIsland;
			const id = explicitIsland ?? (useDefaultIsland ? defaultMapIslandId : null);
			const isCapitalView =
				isMapView && params.get('scope') === 'capital' && id === defaultMapIslandId;
			if (id && id !== selectedId) {
				if (features) selectIsland(id, false);
				else selectedId = id;
			} else if (!id && selectedId) resetIslandSelection();
			capitalRegion = isCapitalView;
			countryAtoll = id ? countryAtoll : params.get('atoll');
			accessExplorerOpen = !id && !params.has('lens') && params.get('tool') !== 'proposals';
			const tool = params.get('tool');
			const next =
				requested === 'map'
					? tool === 'proposals'
						? 'scenarios'
						: 'explore'
					: requested === 'live'
						? 'explore'
						: requested;
			go(next, false);
			const proposal =
				params.get('proposal') ??
				(requested === 'map' && tool === 'proposals' ? 'policy' : 'advanced');
			if (
				next === 'scenarios' &&
				proposal &&
				['edit', 'candidates', 'review', 'policy', 'advanced'].includes(proposal)
			) {
				proposalView = proposal;
				if (proposal === 'policy') {
					tab = 'explore';
					panelOpen = false;
					policyAction('compose');
				}
				if (proposal === 'candidates') tab = 'recommendations';
			}
			profileView = params.get('profile') === 'route' ? 'route' : 'baseline';
			const requestedLens = params.get('lens');
			policyLens = ['transport', 'health', 'education'].includes(requestedLens ?? '')
				? (requestedLens as PolicyLens)
				: 'overall';
			if (profileView === 'route') panelOpen = false;
			overviewView = ['passengers', 'data', 'timetables'].includes(params.get('analytics') ?? '')
				? params.get('analytics')!
				: 'national';
			exploreView =
				params.get('explorer') === 'sea'
					? 'sea'
					: params.get('explorer') === 'notices'
						? 'notices'
						: params.get('explorer') === 'conditions' ||
							  ((tool === 'live' || requested === 'live') && params.get('context') !== 'positions')
							? 'conditions'
							: 'map';
			seaLayerEnabled = params.get('sea') !== '0';
			airLayerEnabled = params.get('air') !== '0';
			if (exploreView === 'conditions') {
				exploreView = 'map';
				profileView = 'route';
				panelOpen = false;
			}
			if (params.get('explorer') === 'schedules') {
				tab = 'overview';
				overviewView = 'timetables';
			}
		};
		restoreView();
		initialized = true;
		// URL/default selection is already known: original island evidence can load
		// alongside the country outline rather than waiting for that larger response.
		if (isMapWorkspace && selectedId) void loadProfile(selectedId);
		void load();
		const unsubscribeSources = subscribeApiInvalidation(refreshSources);
		window.addEventListener('popstate', restoreView);
		const updateVisibility = () => {
			documentVisible = !document.hidden;
		};
		updateVisibility();
		document.addEventListener('visibilitychange', updateVisibility);
		return () => {
			unsubscribeSources();
			window.removeEventListener('popstate', restoreView);
			controller?.abort();
			accessController?.abort();
			profileController?.abort();
			transitStopController?.abort();
			detailController?.abort();
			cancelAction();
			document.removeEventListener('visibilitychange', updateVisibility);
			movementSession.dispose();
		};
	});
	$effect(() => {
		if (initialized) {
			try {
				localStorage.setItem('mobility-v2-scenario', JSON.stringify(scenario));
			} catch {
				/* Export remains available when local storage is blocked. */
			}
		}
	});

	function go(next: string, push = true) {
		if (next === 'map') {
			next = 'explore';
			exploreView = 'map';
		}
		if (next === 'live') {
			next = 'explore';
			exploreView = 'map';
			profileView = 'route';
		}
		if (!['overview', 'explore', 'scenarios', 'recommendations', 'live', 'evidence'].includes(next))
			next = 'explore';
		const wasMapVisible = tab !== 'overview' && tab !== 'evidence';
		tab = next;
		if (!wasMapVisible && next !== 'overview' && next !== 'evidence') focusVersion += 1;
		if (next === 'recommendations') proposalView = 'candidates';
		if (next === 'scenarios' && proposalView === 'candidates') proposalView = 'edit';
		pickMode = null;
		islandPick = null;
		islandSearchOpen = false;
		directionPickIndex = null;
		error = '';
		panelOpen = next !== 'explore';
		panelExpanded = false;
		detailsElement?.scrollTo({ top: 0 });
		if (initialized && push) writeLocation(true);
	}
	function writeLocation(push: boolean) {
		const url = new URL(location.href);
		url.searchParams.set('view', isMapWorkspace ? 'map' : tab);
		if (isMapWorkspace) url.searchParams.set('tool', mapTool);
		else url.searchParams.delete('tool');
		if (selectedId) url.searchParams.set('island', selectedId);
		else url.searchParams.delete('island');
		if (isMapWorkspace && capitalRegion) url.searchParams.set('scope', 'capital');
		else if (isMapWorkspace && !selectedId) url.searchParams.set('scope', 'country');
		else url.searchParams.delete('scope');
		if (isMapWorkspace && !selectedId && countryAtoll) url.searchParams.set('atoll', countryAtoll);
		else url.searchParams.delete('atoll');
		if (tab === 'scenarios' || tab === 'recommendations')
			url.searchParams.set('proposal', proposalView);
		else url.searchParams.delete('proposal');
		if (tab === 'explore' && profileView === 'route') url.searchParams.set('profile', 'route');
		else url.searchParams.delete('profile');
		if (tab === 'overview' && overviewView !== 'national')
			url.searchParams.set('analytics', overviewView);
		else url.searchParams.delete('analytics');
		if (isMapWorkspace) url.searchParams.set('sea', seaLayerEnabled ? '1' : '0');
		else url.searchParams.delete('sea');
		if (isMapWorkspace) url.searchParams.set('air', airLayerEnabled ? '1' : '0');
		else url.searchParams.delete('air');
		if (tab === 'explore' && exploreView !== 'map') url.searchParams.set('explorer', exploreView);
		else url.searchParams.delete('explorer');
		if (isMapWorkspace && policyLens !== 'overall') url.searchParams.set('lens', policyLens);
		else url.searchParams.delete('lens');
		url.searchParams.delete('context');
		if (url.href === location.href) return;
		void goto(url, { shallow: true, replace: !push });
	}
	function setProposalView(value: string) {
		accessExplorerOpen = false;
		if (value === 'policy') {
			go('explore', false);
			exploreView = 'map';
			policyAction('compose');
			writeLocation(true);
			return;
		}
		go(value === 'candidates' ? 'recommendations' : 'scenarios', false);
		proposalView = value;
		writeLocation(true);
	}
	function startIslandProposal() {
		if (!selectedId) return;
		setSeaLayer(false);
		if (profileView === 'route') closeJourney();
		accessExplorerOpen = false;
		panelOpen = false;
		policyAction('compose');
	}
	function setOverviewView(value: string) {
		overviewView = value;
		writeLocation(true);
	}
	function useReviewedNotice(operation: Record<string, unknown>) {
		incomingOperation = operation;
		setProposalView('policy');
	}
	function setProfileView(value: string) {
		if (value === 'route') {
			if (searchSelection) {
				directionPoints = [
					{ id: 'origin', name: '', coordinates: null },
					{
						id: 'destination',
						name: searchSelection.name,
						coordinates: searchSelection.coordinates,
						islandId: selectedId
					}
				];
				directionsChanged();
			}
			const destination =
				searchSelection ??
				(selectedCoordinates && selected
					? {
							id: selected.properties.id,
							name: islandName(selected.properties.name, selected.properties.id),
							coordinates: selectedCoordinates
						}
					: null);
			if (destination && (searchSelection || !directionPoints.at(-1)?.coordinates)) {
				const index = directionPoints.length - 1;
				directionPoints = directionPoints.map((point, pointIndex) =>
					pointIndex === index
						? { ...point, name: destination.name, coordinates: destination.coordinates }
						: point
				);
				directionsChanged();
			}
			searchSelection = null;
			accessExplorerOpen = false;
			islandSearchOpen = false;
		}
		policyAction('close');
		profileView = value;
		panelOpen = value !== 'route';
		pickMode = null;
		directionPickIndex = null;
		writeLocation(true);
	}
	function exploreFromOverview(id?: string, selectedAtoll?: string, lens?: PolicyLens) {
		if (!id && !lens) {
			if (selectedAtoll) showAtoll(selectedAtoll);
			else showCountry();
			return;
		}
		if (id) selectIsland(id, false);
		else {
			resetIslandSelection();
			countryAtoll = selectedAtoll ?? null;
		}
		go('explore', false);
		exploreView = 'map';
		policyLens = lens ?? 'overall';
		accessExplorerOpen = !id && !lens;
		if (lens) policyAction('gaps');
		else policyAction('close');
		writeLocation(true);
		if (!id && selectedAtoll) void openIslandSearch();
	}
	function exportBrief() {
		const brief = {
			title: scenario.name,
			island: profile?.island ?? selected?.properties,
			created_at: new Date().toISOString(),
			scenario,
			simulation,
			comparison,
			reference,
			baseline_accessibility: profile?.accessibility,
			data_quality: profile?.data_quality,
			measurement_scope:
				'Transport feature and network edge counts. Baseline accessibility is not recalculated. No journey-time, ridership, cost or equity estimates.',
			sources: [
				'OneMap island geography',
				'Official facility records',
				'Population census records',
				'OpenStreetMap transport data'
			]
		};
		downloadJson(brief, `decision-brief-${scenario.id.replace(/[^a-z0-9_-]/gi, '_')}.json`);
	}
</script>

<svelte:head
	><title>Mobility Sandbox · Maldives</title><meta
		name="description"
		content="A decision workspace for Maldives mobility: understand places, test proposals and inspect their evidence."
	/></svelte:head
>
<svelte:window
	onkeydown={(event) => {
		if (presentationActive) return;
		if (
			activeWorkspace === 'atlas' &&
			event.shiftKey &&
			['p', 's'].includes(event.key.toLowerCase()) &&
			!event.repeat &&
			!event.altKey &&
			!event.ctrlKey &&
			!event.metaKey &&
			!event.defaultPrevented &&
			!(
				event.target instanceof HTMLElement &&
				(event.target.isContentEditable || event.target.closest('input, textarea, select'))
			)
		) {
			event.preventDefault();
			startPresentation();
			return;
		}
		if (
			activeWorkspace === 'atlas' &&
			event.key === 'Escape' &&
			!event.defaultPrevented &&
			!islandSearchOpen
		)
			cancelPick();
	}}
/>
<div
	class="app-shell"
	class:map-first-shell={isMapWorkspace}
	class:scenario-stage={presentationActive}
>
	<a class="skip-link" href="#workspace-content">Skip to workspace</a>
	<header class="app-header" class:floating-map-header={isMapWorkspace} hidden={presentationActive}>
		{#if !isMapWorkspace}
			<a
				class="brand"
				href={`${PUBLIC_BASE_PATH}/?view=overview`}
				aria-label="Mobility Sandbox home"
				onclick={(event) => {
					event.preventDefault();
					go('overview');
				}}
				><span class="brand-icon"><Layers size={22} strokeWidth={1.7} /></span><span
					>mobility<span class="brand-sub">SANDBOX / MALDIVES</span></span
				></a
			>
		{/if}
		<nav
			aria-label="Workspace"
			class="navigation-island"
			use:animatedSelection={{ selector: '[aria-current="page"]' }}
		>
			{#each tabs as item (item.id)}
				{@const active = tab === item.id || (item.id === 'map' && isMapWorkspace)}
				<Button
					variant="ghost"
					class={active ? 'nav-item active' : 'nav-item'}
					aria-current={active ? 'page' : undefined}
					onclick={() => {
						if (presentationActive) closePresentation();
						if (item.id === 'map') showDefaultMap();
						else go(item.id);
					}}><item.icon size={16} /><span>{item.label}</span></Button
				>
			{/each}
		</nav>
		{#if !isMapWorkspace}
			<div class="connection" title={connection}>
				<span class:online={connection === 'Backend connected'}></span><span
					>{connection === 'Backend connected' ? 'Data connected' : connection}</span
				>
			</div>
		{/if}
	</header>
	{#if fatalError}<div class="fatal" role="alert">
			<Activity size={22} />
			<div>
				<strong>Planning data is unavailable.</strong>
				<p>{fatalError}</p>
			</div>
			<Button onclick={() => load()}>Retry connection</Button>
		</div>{/if}
	<main id="workspace-content" class="workspace-body" tabindex="-1" use:workspaceReveal>
		{#if tab === 'overview'}<div class="workspace-subnav">
				<Tabs.Root value={overviewView} onValueChange={setOverviewView}
					><Tabs.List aria-label="Analytics workspace"
						><Tabs.Trigger value="national">National dashboard</Tabs.Trigger><Tabs.Trigger
							value="passengers">Passenger outlook</Tabs.Trigger
						><Tabs.Trigger value="data">Data studio</Tabs.Trigger><Tabs.Trigger value="timetables"
							>Timetables</Tabs.Trigger
						></Tabs.List
					></Tabs.Root
				><span>Understand demand and the evidence behind it</span>
			</div>
		{/if}
		{#if tab === 'scenarios' || tab === 'recommendations'}<div
				class="workspace-subnav tool-detail-nav"
			>
				<Tabs.Root
					value={proposalView === 'advanced' ? 'advanced' : 'map'}
					onValueChange={(value) => setProposalView(value === 'advanced' ? 'advanced' : 'edit')}
					><Tabs.List aria-label="Proposal workspace"
						><Tabs.Trigger value="advanced">Service & fleet tools</Tabs.Trigger><Tabs.Trigger
							value="map">Infrastructure edits</Tabs.Trigger
						></Tabs.List
					></Tabs.Root
				><span>Build an option, calculate its effects, review the tradeoffs</span>
			</div>{/if}
		{#if activeWorkspace !== 'atlas' && workspaceErrors[activeWorkspace]}
			<div class="workspace-load-state" role="alert">
				<strong>{workspaceErrors[activeWorkspace]}</strong>
				<Button variant="outline" onclick={() => location.reload()}
					><RefreshCw size={16} />Reload workspace</Button
				>
			</div>
		{:else if activeWorkspace !== 'atlas' && (preparingIsland || !workspaces[activeWorkspace])}
			<div class="workspace-load-state" role="status" aria-live="polite">
				<span class="spinner" aria-hidden="true"></span>
				<strong
					>{preparingIsland
						? 'Preparing the selected island…'
						: `Opening the ${workspaceNames[activeWorkspace]}…`}</strong
				>
			</div>
		{/if}
		{#if workspaces.national}<div class="analytics-page" hidden={activeWorkspace !== 'national'}>
				<workspaces.national
					active={activeWorkspace === 'national'}
					{summary}
					features={overviewFeatures}
					onConnections={openIslandConnections}
					onExplore={exploreFromOverview}
					onForecast={() => setOverviewView('passengers')}
				/>
			</div>{/if}
		{#if workspaces.forecast}<div hidden={activeWorkspace !== 'forecast'}>
				<workspaces.forecast active={activeWorkspace === 'forecast'} />
			</div>{/if}
		{#if workspaces.studio}<div hidden={activeWorkspace !== 'studio'}>
				<workspaces.studio active={activeWorkspace === 'studio'} />
			</div>{/if}
		{#if workspaces.policy && !loading}<div hidden={activeWorkspace !== 'policy'}>
				<workspaces.policy
					islandId={selectedId ?? 'island:1443'}
					mapFeatures={features}
					active={activeWorkspace === 'policy'}
					{scenario}
					incomingOperation={activeWorkspace === 'policy' ? incomingOperation : null}
					{incomingPlacement}
					onConsume={() => (incomingOperation = null)}
					onExplore={returnToExplore}
				/>
			</div>{/if}
		{#if workspaces.schedules}<div class="analytics-page" hidden={activeWorkspace !== 'schedules'}>
				<workspaces.schedules
					mode="schedules"
					islandId={selectedId ?? 'island:1443'}
					active={activeWorkspace === 'schedules'}
				/>
			</div>{/if}
		{#if workspaces.conditions && !loading}<div
				class="map-tool-sheet"
				hidden={activeWorkspace !== 'conditions'}
			>
				<Button class="map-tool-close" variant="outline" onclick={returnToExplore}
					><X size={16} />Back to map</Button
				>
				<workspaces.conditions
					active={tab === 'explore' && exploreView === 'notices'}
					onUseNotice={useReviewedNotice}
					scopeLabel={selected?.properties.name ?? 'Malé'}
					initialLatitude={selectedCoordinates?.[1] ?? 4.1755}
					initialLongitude={selectedCoordinates?.[0] ?? 73.5093}
				/>
			</div>{/if}
		<div
			class="map-workspace"
			class:presentation-active={presentationActive}
			class:proposal-workspace={tab === 'scenarios' || tab === 'recommendations'}
			class:panel-hidden={!panelOpen}
			class:panel-expanded={panelExpanded && panelOpen}
			class:policy-panel-open={policyState.panelOpen}
			class:placing-proposal={!!policyPickKind || !!policyState.pending}
			class:access-exploring={showAccessExplorer}
			class:country-overview={!selectedId}
			class:sea-connections-open={tab === 'explore' && seaActive}
			class:directions-open={showSearchDirections}
			hidden={!isMapWorkspace || activeWorkspace === 'policy'}
		>
			<div class="map-region" aria-label="National planning map">
				{#if workspaces.atlas}
					<workspaces.atlas
						active={isMapWorkspace && activeWorkspace !== 'policy'}
						{features}
						{selectedId}
						atollScope={countryAtoll}
						scopeBounds={capitalRegion ? capitalBounds : null}
						{focusBounds}
						presentation={presentationActive ? (presentationView?.scene ?? null) : null}
						onPresentationProgress={showPresentationProgress}
						seaState={presentationActive
							? (presentationView?.seaState ?? null)
							: displayedSeaNetwork}
						seaView={presentationActive ? (presentationView?.showSea ?? false) : seaLayerEnabled}
						seaNetworkStatus={seaNetworkError ? 'error' : seaNetworkLoading ? 'loading' : 'ready'}
						onSeaRetry={() => (seaNetworkRetry += 1)}
						seaLayerEnabled={presentationActive
							? (presentationView?.showSea ?? false)
							: seaLayerEnabled}
						seaInspectorOpen={seaActive}
						onSeaLayerChange={setSeaLayer}
						airState={presentationActive ? (presentationView?.airNetwork ?? null) : airNetwork}
						airLayerEnabled={presentationActive
							? (presentationView?.showAir ?? false)
							: airLayerEnabled}
						airNetworkStatus={airNetworkError ? 'error' : airNetworkLoading ? 'loading' : 'ready'}
						onAirRetry={() => (airNetworkRetry += 1)}
						onAirLayerChange={setAirLayer}
						onSeaSelect={(selection) => {
							if (presentationActive) return;
							if (!seaActive && selection.kind === 'route') {
								const connection = displayedSeaNetwork?.routes?.find(
									(item) => item.id === selection.id
								);
								if (
									connection?.from_island_id &&
									!connection.stop_island_ids.includes(selectedId ?? '')
								)
									selectIsland(connection.from_island_id, false);
							}
							if (!seaActive) openSeaConnections();
							seaSelection = { ...selection, key: ++policySequence };
						}}
						islandPicking={!!islandPick}
						accessibilityScores={displayedScores}
						onnational={showCountry}
						onfocusisland={focusSelectedIsland}
						{focusVersion}
						{focusPoint}
						{searchSelection}
						conditionRoute={presentationActive || seaActive ? [] : conditionRoute}
						policyServiceFeatures={presentationActive || accessExplorerOpen || seaActive
							? emptyPolicyMap
							: policyState.serviceFeatures}
						serviceEditor={presentationActive || accessExplorerOpen || seaActive
							? null
							: policyState.serviceEditor}
						serviceEditorContent={presentationActive || islandPick
							? undefined
							: policyState.serviceEditorContent}
						mapControlsContent={presentationActive || islandPick || seaActive
							? undefined
							: policyState.mapControlsContent}
						onserviceplace={(placement) =>
							(servicePlacement = { ...placement, id: ++policySequence })}
						onservicelanding={(landing) => (serviceLanding = { ...landing, id: ++policySequence })}
						onservicecandidate={(stopId) => (serviceCandidate = { stopId, id: ++policySequence })}
						oncancelservice={() => policyAction('cancel-service')}
						gapFeatures={presentationActive
							? (presentationView?.gaps ?? emptyPolicyMap)
							: accessExplorerOpen || seaActive
								? emptyPolicyMap
								: policyState.gapFeatures}
						coverageFillFeatures={presentationActive
							? (presentationView?.coverage ?? emptyPolicyMap)
							: accessExplorerOpen || seaActive
								? emptyPolicyMap
								: policyState.coverageFillFeatures}
						impactFeatures={presentationActive
							? (presentationView?.comparison ?? emptyPolicyMap)
							: accessExplorerOpen || seaActive
								? emptyPolicyMap
								: policyState.impactFeatures}
						policyComparisonView={presentationActive
							? presentationView?.comparisonView
							: policyState.policyComparisonView}
						comparisonPreview={presentationActive ? false : policyState.comparisonPreview}
						policyEvaluationId={presentationActive ? null : policyState.policyEvaluationId}
						policyComparisonPending={!presentationActive &&
							(policyState.calculating || policyState.stale || !!policyState.comparisonPreview)}
						gapLens={presentationActive ? (presentationView?.lens ?? 'overall') : policyLens}
						policyOperations={presentationActive
							? (presentationView?.operations ?? emptyOperations)
							: accessExplorerOpen || seaActive
								? emptyOperations
								: policyState.operations}
						pendingProposal={presentationActive || accessExplorerOpen || seaActive
							? null
							: policyState.pending}
						pendingPlacementDecision={presentationActive || accessExplorerOpen || seaActive
							? null
							: policyState.pendingDecision}
						placementKind={presentationActive ? null : policyPickKind}
						placementRoads={policyState.placementRoads ?? []}
						onconfirmproposal={() => policyAction('confirm')}
						oncancelproposal={() => policyAction('cancel-placement')}
						onadjustbudget={() => policyAction('adjust-budget')}
						policyCalculating={!presentationActive && policyState.calculating}
						policyStale={!presentationActive && policyState.stale}
						onmoveproposal={(index, coordinates) => {
							if (!presentationActive) policyMove = { id: ++policySequence, index, coordinates };
						}}
						onfocusproposal={presentationActive ? undefined : startIslandProposal}
						oneditproposal={(index, action) => {
							if (!presentationActive) policyEdit = { id: ++policySequence, index, action };
						}}
						ondropplacement={(point, kind) => {
							if (!presentationActive) placeProposal(point, kind);
						}}
						oninspectgap={(properties) => {
							if (presentationActive) return;
							accessExplorerOpen = false;
							inspectedCell = properties;
							policyAction('inspect');
						}}
						mode={mapTool === 'proposals' ? 'proposal' : 'explore'}
						onselect={(id) => {
							if (!presentationActive) inspectIsland(id);
						}}
						onpick={(point) => {
							if (!presentationActive) picked(point);
						}}
						onplanpoint={!presentationActive &&
						(policyState.proposalEditing || mapTool === 'proposals')
							? placeProposal
							: undefined}
						onroutepoint={presentationActive ? undefined : useJourneyPoint}
						onmovejourneypoint={presentationActive ? undefined : chooseJourneyPoint}
						onclearjourneypoint={presentationActive ? undefined : clearJourneyPoint}
						transitStops={seaActive ? [] : transitStops}
						picking={!presentationActive && pickMode !== null}
						draft={presentationActive || seaActive ? [] : scenario.operations}
						route={presentationActive || seaActive ? null : route}
						directions={showSearchDirections ? directions : null}
						directionPoints={showSearchDirections ? directionPoints : undefined}
						routeStart={showSearchDirections ? routeStart : null}
						{journeyFocusVersion}
						routeEnd={showSearchDirections ? routeEnd : null}
						liveEvents={presentationActive
							? emptyLiveEvents
							: (liveSnapshot?.events ?? emptyLiveEvents)}
						liveStatus={displayedLiveStatus}
					/>
				{/if}
				{#if workspaceErrors.atlas}<div class="map-loading" role="alert">
						<strong>{workspaceErrors.atlas}</strong>
						<Button variant="outline" onclick={() => location.reload()}
							><RefreshCw size={16} />Reload workspace</Button
						>
					</div>
				{:else if loading || !workspaces.atlas}<div class="map-loading" role="status">
						<span class="spinner" aria-hidden="true"></span><strong>Opening the map</strong><span
							>Loading island geography and source records.</span
						>
					</div>{/if}
			</div>
			{#if showAccessExplorer}
				<div class="accessibility-map-overlay">
					<CountryAccessibilityExplorer
						features={overviewFeatures}
						scores={displayedScores}
						loading={accessLoading || loading}
						error={accessError}
						{selectedId}
						atoll={countryAtoll}
						onRetry={loadAccessScores}
						onCountry={showCountry}
						onAtoll={showAtoll}
						onIsland={inspectIsland}
						onPlan={startIslandProposal}
						onAnalytics={() => go('overview')}
						onSearch={openIslandSearch}
						searchOpen={islandSearchOpen}
					/>
				</div>
			{/if}
			{#if workspaces.mapPolicy}<workspaces.mapPolicy
					islandId={presentationActive ? (presentationReturn?.selectedId ?? null) : selectedId}
					islandName={selected?.properties.name ?? 'Selected island'}
					profile={profile?.island.id === selectedId ? profile : null}
					{profileLoading}
					{profileError}
					onRetryProfile={() => selectedId && loadProfile(selectedId)}
					mapFeatures={features}
					boundaryFeatures={selectedBoundaryFeatures}
					boundaryError={detailError}
					onRetryBoundary={() => (detailVersion += 1)}
					active={!presentationActive &&
						isMapWorkspace &&
						tab === 'explore' &&
						exploreView === 'map' &&
						!showSearchDirections &&
						!panelOpen &&
						!!selectedId &&
						!accessExplorerOpen}
					lens={policyLens}
					command={policyCommand}
					placement={incomingPlacement}
					{servicePlacement}
					{serviceLanding}
					{serviceCandidate}
					{incomingOperation}
					onConsume={() => (incomingOperation = null)}
					moved={policyMove}
					edited={policyEdit}
					cell={inspectedCell}
					onLensChange={(lens) => {
						policyLens = lens;
						writeLocation(true);
					}}
					onState={(state) => (policyState = state)}
					onPickKind={(kind) => {
						policyPickKind = kind;
						if (kind) pickMode = 'proposal';
						else if (pickMode === 'proposal') pickMode = null;
					}}
					onCloseOthers={() => (panelOpen = false)}
					onSeaImpact={() => openSeaConnections(true)}
					onFocus={focusPolicyPoint}
					onFocusBounds={focusConnection}
					{ferryDestinationId}
					onPickFerryOrigin={(destination, date) => {
						ferryOriginContext = { destination, date };
						islandPick = 'ferry-origin';
						panelOpen = false;
					}}
					onPickFerryDestination={(enabled) => {
						islandPick = enabled ? 'ferry' : null;
						if (!enabled) ferryDestinationId = null;
					}}
					onDetails={() => setProfileView('baseline')}
					onAdvanced={() => setProposalView('advanced')}
				/>{/if}
			{#if tab === 'explore' && seaActive && selectedId}
				<div class="sea-connections-overlay">
					{#if workspaces.sea}
						<workspaces.sea
							selectedIslandId={selectedId}
							islandName={selected?.properties.name ?? 'Selected island'}
							operations={seaOperations}
							assumptions={seaAssumptions}
							initialMode={seaInitialMode}
							serviceDate={typeof seaAssumptions.date === 'string'
								? seaAssumptions.date
								: undefined}
							initialDepartureMinutes={typeof seaAssumptions.departure_minutes === 'number'
								? seaAssumptions.departure_minutes
								: undefined}
							mapSelection={seaSelection}
							onMapChange={(state) => (seaMap = state)}
							onExplore={openIslandConnections}
							onFocus={focusConnection}
							onPropose={proposeFerry}
							onClose={closeSeaConnections}
						/>
					{:else if workspaceErrors.sea}
						<div class="workspace-state" role="alert">
							<p>{workspaceErrors.sea}</p>
							<Button onclick={() => void loadWorkspace('sea')}>Retry sea connections</Button
							><Button variant="ghost" onclick={closeSeaConnections}>Close</Button>
						</div>
					{:else}<div class="workspace-state" role="status">Loading sea connections…</div>{/if}
				</div>
			{/if}
			<div
				class="map-header-tools"
				class:search-directions-open={showSearchDirections}
				class:has-context-actions={showMapContextActions}
			>
				<div
					class="map-search-dock"
					class:search-directions-open={showSearchDirections}
					class:has-context-actions={showMapContextActions}
					role="group"
					aria-label="Map search"
				>
					{#if showSearchDirections}
						<div class="map-directions-surface" transition:searchExpansion>
							<SearchDirections
								{islands}
								island={searchIsland}
								{features}
								places={journeyPlaces}
								{loading}
								bind:points={directionPoints}
								bind:mode={routeMode}
								bind:serviceDate={routeDate}
								bind:departureTime={routeTime}
								result={directions}
								busy={busy === 'route'}
								error={error || null}
								pickingIndex={directionPickIndex}
								onPick={pickDirectionPoint}
								onChange={directionsChanged}
								onFind={requestRoute}
								onClose={closeJourney}
							/>
						</div>
					{:else}
						<div
							class="map-search-group"
							in:surfaceMotion={{ axis: 'y', distance: -3, duration: 140, delay: 60 }}
							out:surfaceMotion={{ direction: 'out', axis: 'y', distance: -3, duration: 100 }}
						>
							<MapSearch
								bind:this={mapSearch}
								{islands}
								island={searchIsland}
								{features}
								loading={loading || (!!selectedId && !detailedFeatures[selectedId] && !detailError)}
								bind:open={islandSearchOpen}
								globalAtoll={selectedId ? null : countryAtoll}
								onIsland={inspectIsland}
								onAtoll={showAtoll}
								onPlace={selectSearchPlace}
							/>
							<Button
								variant="outline"
								size="icon"
								title="Focus selected island"
								aria-label="Focus selected island"
								onclick={focusSelectedIsland}><LocateFixed size={17} /></Button
							>
						</div>
					{/if}
				</div>
				{#if showMapContextActions}
					<div
						class="map-header-actions"
						role="group"
						aria-label="Explore selected island"
						in:surfaceMotion={{ axis: 'y', distance: -4, duration: 180 }}
						out:surfaceMotion={{ direction: 'out', axis: 'y', distance: -4, duration: 100 }}
					>
						<Button
							variant="ghost"
							disabled={loading || !selected}
							aria-label="Directions"
							onclick={() => setProfileView('route')}><Route size={16} />Directions</Button
						>
						<Button
							variant="ghost"
							aria-label="Start scenario"
							title="Presentation · Shift+P"
							disabled={loading}
							onclick={startPresentation}><Clapperboard size={16} />Scenario</Button
						>
						<Button
							class="map-header-proposal"
							disabled={loading || !selected}
							aria-label={policyState.operations.length ? 'Edit proposal' : 'Create proposal'}
							onclick={startIslandProposal}
						>
							{#if policyState.operations.length}<SquarePen size={15} />{:else}<Plus
									size={15}
								/>{/if}
							{policyState.operations.length ? 'Edit proposal' : 'Create proposal'}
						</Button>
					</div>
				{/if}
			</div>
			{#if presentationActive}<ScenarioPresenter
					onView={showPresentationView}
					onClose={closePresentation}
					progress={presentationProgress}
				/>{/if}
			{#if !presentationActive && islandPick}<div class="pick-banner" role="status">
					<MapPin size={18} /><span
						>Choose {islandPick === 'ferry-origin'
							? 'your starting island'
							: 'a destination island'}<small>Click an island on the map · Escape to cancel</small
						></span
					><Button variant="ghost" size="sm" onclick={cancelPick}>Cancel</Button>
				</div>{/if}
			{#if pickMode && pickMode !== 'proposal' && !showSearchDirections}<div
					class="pick-banner"
					role="status"
				>
					<LocateFixed size={18} /><span
						>{pickMode === 'operation'
							? 'Choose a location for your proposal'
							: pickMode === 'start'
								? 'Where will you start?'
								: 'Where would you like to go?'}<small>Click on the map · Escape to cancel</small
						></span
					><Button variant="ghost" size="sm" onclick={cancelPick}>Cancel</Button>
				</div>{/if}
			{#if !showSearchDirections}<aside
					class="detail-panel"
					class:collapsed={!panelOpen}
					aria-label="Planning details"
					bind:this={detailsElement}
					use:resizable={{
						key: 'map-details',
						minWidth: 360,
						minHeight: 360,
						maxWidth: 680,
						breakpoint: 900,
						edges: ['left', 'bottom', 'bottom-left'],
						anchor: 'top-right',
						enabled: panelOpen
					}}
					use:mapPanelLayout={panelOpen}
				>
					<div class="detail-scroll">
						<Card.Root class="context-card">
							<div class="context-location">
								<span
									><MapPin size={14} />{profileView === 'route'
										? 'Directions'
										: selected
											? islandName(selected.properties.name, selected.properties.id)
											: 'Select an island'}<small
										>{profileView === 'route'
											? (selected?.properties.name ?? 'Selected island')
											: (selected?.properties.atoll ?? 'Maldives')}</small
									></span
								>
								<div class="context-window-actions">
									<Button
										variant="ghost"
										size="icon-sm"
										aria-label={panelExpanded
											? 'Restore compact details'
											: 'Expand planning details'}
										onclick={() => {
											if (detailsElement) resetResizable(detailsElement);
											panelExpanded = !panelExpanded;
										}}
										>{#if panelExpanded}<Minimize2 size={16} />{:else}<Maximize2
												size={16}
											/>{/if}</Button
									><Button
										variant="ghost"
										size="icon-sm"
										onclick={() => (profileView === 'route' ? closeJourney() : (panelOpen = false))}
										aria-label={profileView === 'route'
											? 'Close directions'
											: 'Collapse island details'}><PanelRightClose size={17} /></Button
									>
								</div>
							</div>
							{#if error}<div class="error-banner" role="alert">
									{error}<Button
										variant="ghost"
										size="icon-xs"
										aria-label="Dismiss error"
										onclick={() => (error = '')}><X size={14} /></Button
									>
								</div>{/if}
							{#if notice}<div class="notice-banner" role="status">
									{notice}<Button
										variant="ghost"
										size="icon-xs"
										aria-label="Dismiss notice"
										onclick={() => (notice = '')}><X size={14} /></Button
									>
								</div>{/if}
							{#if tab === 'explore'}
								<Tabs.Root bind:value={profileView} onValueChange={setProfileView}>
									<Tabs.List class="context-tabs">
										<Tabs.Trigger value="baseline">Island details</Tabs.Trigger>
										<Tabs.Trigger value="route">Directions</Tabs.Trigger>
									</Tabs.List>
									<Tabs.Content value="baseline" class="context-tab-content">
										{#if profileLoading}<p class="loading-text">
												Loading island profile…
											</p>{:else if profile}
											<div class="panel-intro">
												<span class="eyebrow">ISLAND PROFILE</span>
												<h2>{islandName(profile.island.name, profile.island.id)}</h2>
												<p>The people, services, and connections that shape this place.</p>
											</div>
											<div class="profile-stats">
												<div>
													<small>Residents · Census 2022</small><strong
														class:no-census={profile.population.total == null}
														>{profile.population.total == null
															? 'No census count'
															: fmt(profile.population.total)}</strong
													><span
														>{profile.population.year
															? 'Census ' + profile.population.year
															: 'Census count unavailable'}</span
													>
												</div>
												<div>
													<small>Official facilities</small><strong
														>{fmt(profile.infrastructure.total)}</strong
													><span>{fmt(profile.transport.total)} transport locations</span>
												</div>
											</div>
											{#if profile.population.qualification}<p class="population-context">
													{profile.population.qualification}
												</p>{/if}
											<section class="panel-section">
												<div class="section-title">
													<h3>Accessibility</h3>
													<span class="soft-tag">BASELINE</span>
												</div>
												{#if profile.accessibility}<div class="access-score">
														<strong
															>{profile.accessibility.score.toFixed(1)}<span>/100</span></strong
														><small
															>Confidence indicator<br /><b
																>{Math.round(profile.accessibility.confidence * 100)}%</b
															></small
														>
													</div>
													{#each Object.entries(profile.accessibility.domains) as [domain, value] (domain)}<div
															class="score-row"
														>
															<span>{label(domain)}</span>
															<div>
																<span
																	style={'width:' + Math.min(100, Math.max(0, value.score)) + '%'}
																></span>
															</div>
															<b>{value.score.toFixed(1)}</b>
														</div>{/each}
													<p class="fine-print">
														A distance and data coverage score. Zero can reflect missing evidence.
														This score is not recalculated by scenario simulation.
													</p>
													<details>
														<summary
															>{profile.accessibility.missing_data.length} data limitations</summary
														>
														<ul class="plain-list">
															{#each profile.accessibility.missing_data as item, index (index)}<li>
																	{label(item)}
																</li>{/each}
														</ul>
													</details>
												{:else}<p class="empty-state">
														No accessibility result for this island.
													</p>{/if}
											</section>
											<section class="panel-section">
												<div class="section-title">
													<h3>Services & infrastructure</h3>
													<span>{profile.infrastructure.total}</span>
												</div>
												{#each profile.infrastructure.items.slice(0, 8) as facility (facility.id)}<div
														class="facility-row"
													>
														<span class="facility-symbol"
															>{facility.category === 'school'
																? 'E'
																: facility.category === 'airport'
																	? 'T'
																	: 'H'}</span
														>
														<div>
															<strong>{facility.name || label(facility.category)}</strong><small
																>{label(facility.category)} · {facility.geometry
																	? label(facility.match_status ?? 'Located')
																	: 'Location unavailable'}</small
															>
														</div>
													</div>{/each}
												{#if !profile.infrastructure.total}<p class="empty-state">
														No facilities listed for this island.
													</p>{/if}
												<details>
													<summary>Inspect source records and IDs</summary>
													<div class="record-list">
														{#each [...profile.infrastructure.items, ...profile.transport.items] as record, index (record.id + '-' + index)}<div
															>
																<strong>{record.name || label(record.category)}</strong><code
																	>{record.id}</code
																><small
																	>{record.source ?? 'OSM'} · {label(
																		record.match_status ?? 'source geometry'
																	)}</small
																>
															</div>{/each}
													</div>
												</details>
											</section>
											{#if profile.data_quality.warnings.length}<div class="callout">
													<strong>Data details</strong>
													<p>{profile.data_quality.warnings.join('. ')}.</p>
													<p>
														{fmt(profile.data_quality.unresolved_facility_count)} facilities have uncertain
														or missing locations.
													</p>
												</div>{/if}
											<Button
												variant="outline"
												class="wide"
												onclick={() => setProposalView('policy')}
												>Test a proposal here<ArrowUpRight size={16} /></Button
											>
										{:else if !loading}<p class="empty-state">
												Select an island to explore its services.
											</p>{/if}
									</Tabs.Content>
								</Tabs.Root>
							{:else if tab === 'scenarios' || tab === 'recommendations'}
								<div class="proposal-header">
									<span class="eyebrow">YOUR POLICY WORKSPACE</span>
									<h2>Build a better connection.</h2>
									<p>Make a change. Test the network. Review what the evidence supports.</p>
								</div>
								<div class="journey-steps">
									<Button variant="ghost" onclick={() => go('explore')}><span>1</span>Island</Button
									><ChevronRight size={12} /><span
										class:current={proposalView !== 'review'}
										aria-current={proposalView !== 'review' ? 'step' : undefined}
										><b>2</b>Proposal</span
									><ChevronRight size={12} /><span
										class:complete={!!simulation}
										class:current={proposalView === 'review'}
										aria-current={proposalView === 'review' ? 'step' : undefined}
										><b>3</b>Review</span
									>
								</div>
								<Tabs.Root bind:value={proposalView} onValueChange={setProposalView}
									><Tabs.List class="context-tabs"
										><Tabs.Trigger value="edit">Build option</Tabs.Trigger><Tabs.Trigger
											value="candidates">Find candidates</Tabs.Trigger
										><Tabs.Trigger value="review">Review results</Tabs.Trigger></Tabs.List
									>
									<p class="draft-scope">
										{scenario.operations.length} proposed changes · Draft saved in this browser
									</p>
									<Tabs.Content value="edit" class="context-tab-content">
										<div class="scenario-toolbar">
											<Button
												variant="ghost"
												size="icon"
												disabled={!history.length || !!busy}
												onclick={undo}
												aria-label="Undo operation"><Undo2 size={17} /></Button
											><Button
												variant="ghost"
												size="icon"
												disabled={!redoHistory.length || !!busy}
												onclick={redo}
												aria-label="Redo operation"><Redo2 size={17} /></Button
											><span></span><Button
												variant="ghost"
												size="icon"
												onclick={exportScenario}
												aria-label="Export scenario"><Download size={17} /></Button
											><Button
												variant="ghost"
												size="icon"
												onclick={() => importInput?.click()}
												aria-label="Import scenario"><Upload size={17} /></Button
											><Input
												class="hidden"
												type="file"
												accept="application/json,.json"
												bind:ref={importInput}
												onchange={importScenario}
											/>
										</div>
										<Label class="field-label" for="scenario-name">Option name</Label><Input
											id="scenario-name"
											value={scenario.name}
											maxlength={200}
											oninput={(event) => {
												scenario = { ...scenario, name: event.currentTarget.value };
												simulation = null;
												comparison = null;
											}}
										/>
										<section class="panel-section" style="margin-top:24px">
											<Label class="field-label" for="operation-type">Your intervention</Label
											><NativeSelect.Root
												id="operation-type"
												bind:value={operationType}
												onchange={() => (pickMode = null)}
												>{#each Object.entries(operationLabels) as [value, text] (value)}<NativeSelect.Option
														{value}>{text}</NativeSelect.Option
													>{/each}</NativeSelect.Root
											>
											{#if needsCoordinates(operationType)}<Button
													variant="outline"
													class="wide"
													onclick={() => (pickMode = 'operation')}
													><MapPin size={16} />{longitude !== '' && latitude !== ''
														? 'Change location on map'
														: 'Place on map'}</Button
												>
												{#if longitude !== '' && latitude !== ''}<p class="coordinate-readout">
														Location: {Number(longitude).toFixed(5)}, {Number(latitude).toFixed(5)}
													</p>{/if}
												<details>
													<summary>Enter coordinates or use island centroid</summary>
													<div class="field-pair">
														<Label
															>Longitude<Input
																aria-label="Proposal longitude"
																type="number"
																step="any"
																bind:value={longitude}
															/></Label
														><Label
															>Latitude<Input
																aria-label="Proposal latitude"
																type="number"
																step="any"
																bind:value={latitude}
															/></Label
														>
													</div>
													<Button
														variant="ghost"
														class="text-button"
														disabled={!selected?.properties.centroid}
														onclick={() => {
															const center = selected?.properties.centroid;
															if (center) {
																longitude = center[0];
																latitude = center[1];
															}
														}}>Use island centroid</Button
													>
												</details>
											{/if}
											{#if needsTarget(operationType)}<Label class="field-label" for="target-id"
													>Target record or graph edge ID</Label
												><Input
													id="target-id"
													bind:value={targetId}
													placeholder="Exact source ID"
												/>
												<p class="fine-print">
													Select a source record or enter a graph edge/OSM way ID. Unknown targets
													are reported as unapplied.
												</p>
												<details>
													<summary>Browse island records</summary>
													<div class="record-list">
														{#each profile?.transport.items ?? [] as record (record.id)}<Button
																variant="outline"
																size="sm"
																onclick={() => (targetId = record.id)}
																>{record.name || label(record.category)}<small>{record.id}</small
																></Button
															>{/each}
													</div>
												</details>{/if}
											{#if needsNodes(operationType)}<Label class="field-label" for="from-node"
													>From graph node ID</Label
												><Input id="from-node" bind:value={fromNode} /><Label
													class="field-label"
													for="to-node">To graph node ID</Label
												><Input id="to-node" bind:value={toNode} />
												{#if route?.path_node_ids?.length}<Button
														variant="ghost"
														class="text-button"
														onclick={() => {
															fromNode = route?.path_node_ids?.[0] ?? '';
															toNode = route?.path_node_ids?.at(-1) ?? '';
														}}>Use the planned route’s endpoints</Button
													>{/if}
												<details>
													<summary>Connection distance and graph guidance</summary><Label
														class="field-label"
														for="edge-distance">Connection distance in metres (optional)</Label
													><Input
														id="edge-distance"
														type="number"
														min={0.01}
														step="any"
														bind:value={distance}
													/>
													<p class="fine-print">
														Use existing graph nodes. Land node IDs appear in a route result. Marine
														and airport nodes require the backend graph artifacts.
													</p>
												</details>
											{/if}
											{#if operationType === 'weather_disruption'}<Label
													class="field-label"
													for="disabled-mode">Mode to restrict</Label
												><NativeSelect.Root id="disabled-mode" bind:value={disabledMode}
													>{#each [['car', 'Car'], ['bus', 'Bus'], ['taxi', 'Taxi'], ['bicycle', 'Bicycle'], ['walk', 'Walk'], ['marine', 'Passenger ferry']] as [value, text] (value)}<NativeSelect.Option
															{value}>{text}</NativeSelect.Option
														>{/each}</NativeSelect.Root
												>{/if}
											<Button
												variant="outline"
												class="wide"
												disabled={!selectedId || !!busy}
												onclick={addOperation}><Plus size={16} />Add to option</Button
											>
										</section>
										<section class="panel-section">
											<div class="section-title">
												<h3>Proposed changes</h3>
												<span class="count-tag">{scenario.operations.length}</span>
											</div>
											{#each scenario.operations as operation, index (index)}<div
													class="operation-row"
												>
													<span>{String(index + 1).padStart(2, '0')}</span>
													<div>
														<strong>{operationLabels[operation.type]}</strong><small
															>{islands.find(
																(island) => island.properties.id === operation.island_id
															)?.properties.name ??
																operation.island_id ??
																'National'} · {operation.coordinates
																?.map((n) => n.toFixed(5))
																.join(', ') ??
																operation.target_id ??
																label(operation.type)}</small
														>
													</div>
													<Button
														variant="ghost"
														size="icon-sm"
														disabled={!!busy}
														aria-label={'Remove operation ' + (index + 1)}
														onclick={() =>
															edit({
																...scenario,
																operations: scenario.operations.filter((_, i) => i !== index)
															})}><Trash2 size={15} /></Button
													>
												</div>{/each}
											{#if !scenario.operations.length}<p class="empty-state">
													Start with one change. Place it on the map, then add it to your option.
												</p>{/if}<Button
												class="wide"
												disabled={!!busy ||
													!selectedId ||
													!scenario.name.trim() ||
													!scenario.operations.length}
												onclick={runScenario}
												>{busy === 'simulation' ? 'Testing option…' : 'Run simulation'}<FlaskConical
													size={16}
												/></Button
											>
											<p class="fine-print">
												Results are scoped to {selected
													? islandName(selected.properties.name, selected.properties.id)
													: 'the selected island'}. Changes on other islands stay in the draft.
											</p>
										</section>
										<Button
											variant="ghost"
											class="wide"
											onclick={() => setProposalView('candidates')}
											>Need a starting point? Find candidates<Sparkles size={15} /></Button
										>
									</Tabs.Content>
									<Tabs.Content value="candidates" class="context-tab-content">
										<Label class="field-label" for="recommendation-type"
											>What would you like to improve?</Label
										><NativeSelect.Root
											id="recommendation-type"
											bind:value={recommendationType}
											onchange={() => (recommendations = null)}
											>{#each ['bus_stop', 'ferry_terminal', 'ferry_route', 'parking', 'mobility_hub', 'pedestrian', 'airport_access', 'underserved_island'] as type (type)}<NativeSelect.Option
													value={type}>{label(type)}</NativeSelect.Option
												>{/each}</NativeSelect.Root
										><Button
											class="wide"
											disabled={!!busy || !selectedId}
											onclick={requestRecommendations}
											>{busy === 'recommendations'
												? 'Screening candidates…'
												: 'Find candidates'}<Sparkles size={16} /></Button
										>
										<p class="fine-print">
											Ranks up to 20 candidates using 70% heuristic benefit and 30% confidence.
											Scores are screening indicators.
										</p>
										{#if recommendations}<div class="section-title">
												<h3>Planning candidates</h3>
												<span>{recommendations.summary.candidate_count} considered</span>
											</div>
											{#each recommendations.recommendations as candidate, index (candidate.id)}<Card.Root
													class="candidate-card"
													><div class="section-title">
														<span class="candidate-number"
															>{String(index + 1).padStart(2, '0')}</span
														><span class="soft-tag">SCORE {candidate.score.toFixed(1)}</span>
													</div>
													<h3>{label(candidate.type)} · {candidate.island_name}</h3>
													<p>{candidate.reason}</p>
													<div class="candidate-stats">
														<span
															>Heuristic benefit<b>{candidate.expected_benefit.toFixed(1)}/100</b
															></span
														><span>Confidence<b>{Math.round(candidate.confidence * 100)}%</b></span>
													</div>
													<details>
														<summary>Assumptions and trade-offs</summary>
														<ul class="plain-list">
															{#each [...candidate.assumptions, ...candidate.trade_offs] as item, index (index)}<li
																>
																	{item}
																</li>{/each}
														</ul>
														<p class="fine-print">{candidate.planning_screening_disclaimer}</p>
														{#each candidate.simulation.warnings as warning, index (index)}<p
																class="fine-print"
															>
																{warning}
															</p>{/each}
													</details>
													<Button
														variant="outline"
														class="wide"
														onclick={() => {
															edit(structuredClone(candidate.scenario));
															setProposalView('edit');
														}}>Open this candidate as an option<ArrowUpRight size={14} /></Button
													></Card.Root
												>{/each}{#if !recommendations.recommendations.length}<div
													class="empty-card"
												>
													<Sparkles size={25} />
													<h3>No candidates in this cache</h3>
													<p>
														Try another intervention or island. Missing source coverage can limit
														candidate generation.
													</p>
												</div>{/if}{:else}<div class="empty-card">
												<Sparkles size={26} />
												<h3>Explore what’s possible</h3>
												<p>
													Choose an intervention to generate candidates for {selected?.properties
														.name ?? 'the selected island'}.
												</p>
											</div>{/if}
										<div class="callout">
											<strong>Planning screening</strong>
											<p>
												Candidate benefits are heuristics, not measured improvements or forecasts.
												Review geometry, land availability, feasibility, and evidence before using
												an option.
											</p>
										</div>
									</Tabs.Content>
									<Tabs.Content value="review" class="context-tab-content">
										<div class="review-heading">
											<span class="eyebrow">DECISION REVIEW</span>
											<h2>What changes with your option?</h2>
											<p>Compare how each proposal changes access, travel times and costs.</p>
										</div>
										{#if simulation}<section class="panel-section simulation-result">
												<div class="section-title">
													<h3>Changes from baseline</h3>
													<Check size={17} />
												</div>
												<p>
													{simulation.operations_applied.length} of {scenario.operations.length} operations
													applied.
												</p>
												{#each Object.entries(simulation.delta) as [key, value] (key)}<div
														class="metric-row"
													>
														<span>{label(key)}</span><strong>{signed(value)}</strong>
													</div>{/each}{#each simulation.warnings as warning, index (index)}<div
														class="callout"
													>
														{warning}
													</div>{/each}
												<details>
													<summary>Baseline and effective counts</summary>
													<table>
														<thead><tr><th>Metric</th><th>Before</th><th>After</th></tr></thead
														><tbody
															>{#each Object.entries(simulation.baseline) as [key, value] (key)}<tr
																	><td>{label(key)}</td><td>{fmt(value)}</td><td
																		>{fmt(simulation.effective_world[key])}</td
																	></tr
																>{/each}</tbody
														>
													</table>
												</details>
											</section>
										{:else}<div class="empty-card">
												<FlaskConical size={28} />
												<h3>Your results will appear here</h3>
												<p>
													Add a change and run the simulation to review its effect on the selected
													island.
												</p>
												<Button onclick={() => setProposalView('edit')}
													>Continue building<ArrowRight size={16} /></Button
												>
											</div>{/if}
										<div class="comparison-actions">
											<Button
												variant="outline"
												class="wide"
												disabled={!!busy}
												onclick={() => {
													reference = structuredClone(scenario);
													comparison = null;
													notice = 'Reference saved: ' + scenario.name;
												}}>Save as comparison reference</Button
											>{#if reference}<p class="fine-print">
													Reference: {reference.name} · {reference.operations.length} changes
												</p>
												<Button
													variant="outline"
													class="wide"
													disabled={!!busy}
													onclick={compareScenario}
													>{busy === 'compare'
														? 'Comparing…'
														: 'Compare current option with reference'}</Button
												>{/if}{#if comparison}<div class="callout">
													<strong>Current minus reference</strong
													>{#each Object.entries(comparison.delta) as [key, value] (key)}<div
															class="metric-row"
														>
															<span>{label(key.replace('first_vs_second_', ''))}</span><b
																>{signed(value)}</b
															>
														</div>{/each}
												</div>{/if}
										</div>
										<div class="callout">
											<strong>What this simulation measures</strong>
											<p>
												Network edges and transport feature counts. A new stop does not establish a
												bus service. This backend does not estimate journey-time savings, ridership,
												costs, or changes to accessibility scores.
											</p>
										</div>
										{#if simulation}<Button class="wide" onclick={exportBrief}
												><Download size={16} />Export decision brief</Button
											><Button variant="ghost" class="wide" onclick={() => go('evidence')}
												>Review sources and limitations<ArrowRight size={15} /></Button
											>{/if}
									</Tabs.Content>
								</Tabs.Root>
							{/if}
						</Card.Root>
					</div>
				</aside>{/if}
			{#if tab === 'scenarios' || tab === 'recommendations'}<div
					class="map-action-dock proposal-dock"
				>
					<span class="dock-label">{scenario.operations.length} CHANGES</span><Button
						variant="ghost"
						size="icon"
						disabled={!history.length || !!busy}
						onclick={undo}
						aria-label="Undo map operation"><Undo2 size={16} /></Button
					><Button
						variant="ghost"
						size="icon"
						disabled={!redoHistory.length || !!busy}
						onclick={redo}
						aria-label="Redo map operation"><Redo2 size={16} /></Button
					><span class="dock-divider"></span><Button variant="outline" onclick={() => go('explore')}
						>View baseline</Button
					><Button
						disabled={!!busy || !selectedId || !scenario.operations.length || !scenario.name.trim()}
						onclick={runScenario}>Test this option<FlaskConical size={16} /></Button
					>
				</div>{/if}
		</div>
		{#if workspaces.evidence}<div class="evidence-page" hidden={activeWorkspace !== 'evidence'}>
				<workspaces.evidence
					active={activeWorkspace === 'evidence'}
					{summary}
					onExplore={() => go('explore')}
					onExport={exportBrief}
					canExport={!!simulation}
				/>
			</div>{/if}
	</main>
</div>
