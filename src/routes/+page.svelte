<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		Map as MapIcon,
		FlaskConical,
		Sparkles,
		Radio,
		BookOpen,
		Search,
		ArrowUpRight,
		ArrowRight,
		Plus,
		Undo2,
		Redo2,
		Download,
		Upload,
		Trash2,
		LocateFixed,
		Check,
		Activity,
		Route,
		X,
		RefreshCw,
		Menu,
		Layers,
		GitBranch
	} from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import {
		ChartNoAxesCombined,
		ChevronRight,
		MapPin,
		PanelRightClose,
		Maximize2,
		Minimize2,
		CalendarDays
	} from '@lucide/svelte';
	import { CloudSun } from '@lucide/svelte';
	import CountryAccessibilityExplorer from '#lib/components/CountryAccessibilityExplorer.svelte';
	import type { NationalAccessibility } from '#lib/analytics.js';
	import { emptyFeatures, type MapPolicyState, type PlacementKind } from '#lib/map-policy.js';
	import type { PolicyLens } from '#lib/policy-opportunities.js';
	import { api } from '#lib/api.js';
	import { MovementSession, movementScope } from '#lib/movement.js';
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
		places: () => import('#lib/components/PlaceWorkspace.svelte'),
		conditions: () => import('#lib/components/OperationsWorkspace.svelte'),
		schedules: () => import('#lib/components/SourceUpdatesWorkspace.svelte'),
		atlas: () => import('#lib/components/NationalMap.svelte'),
		mapPolicy: () => import('#lib/components/MapPolicyWorkspace.svelte'),
		journey: () => import('#lib/components/ExploreJourneyPanel.svelte'),
		mapConditions: () => import('#lib/components/MapConditionsPanel.svelte'),
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
		policy: 'proposal workspace',
		places: 'places and directions',
		conditions: 'weather, traffic and notices',
		schedules: 'timetables',
		atlas: 'island map',
		mapPolicy: 'map proposal tools',
		journey: 'journey planner',
		mapConditions: 'nearby conditions',
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
	let policyLens = $state<PolicyLens>('overall');
	let policyCommand = $state<{
		id: number;
		kind: 'inspect' | 'gaps' | 'compose' | 'close' | 'confirm' | 'cancel-placement';
	} | null>(null);
	let policyMove = $state<{ id: number; index: number; coordinates: Coordinates } | null>(null);
	let policyPickKind = $state<PlacementKind | null>(null);
	let policyState = $state.raw<MapPolicyState>({
		operations: [],
		pending: null,
		pendingDecision: null,
		gapFeatures: emptyFeatures(),
		impactFeatures: emptyFeatures(),
		serviceFeatures: emptyFeatures(),
		calculating: false,
		stale: false,
		panelOpen: false
	});
	let conditionRoute = $state<Coordinates[]>([]);
	let focusPoint = $state<{ id: number; coordinates: Coordinates } | null>(null);
	let inspectedCell = $state<Record<string, unknown> | null>(null);
	let policySequence = 0;
	function policyAction(
		kind: 'inspect' | 'gaps' | 'compose' | 'close' | 'confirm' | 'cancel-placement'
	) {
		policyCommand = { id: ++policySequence, kind };
	}
	function focusPolicyPoint(coordinates: Coordinates) {
		focusPoint = { id: ++policySequence, coordinates };
	}
	let tab = $state('explore');
	let workspaceMenuOpen = $state(false);
	let countryAtoll = $state<string | null>(null);
	let accessExplorerOpen = $state(true);
	let accessScores = $state.raw<NationalAccessibility | null>(null);
	let accessLoading = $state(true);
	let accessError = $state('');
	let accessController: AbortController | undefined;
	const emptyPolicyMap = emptyFeatures();
	const isMapWorkspace = $derived(!['overview', 'evidence'].includes(tab));
	let proposalView = $state('policy');
	let profileView = $state('baseline');
	let overviewView = $state('national');
	let exploreView = $state('map');
	const mapTool = $derived(
		tab === 'scenarios' || tab === 'recommendations' ? 'proposals' : 'explore'
	);
	const activeWorkspace = $derived<WorkspaceKey>(
		tab === 'overview'
			? overviewView === 'passengers'
				? 'forecast'
				: overviewView === 'data'
					? 'studio'
					: 'national'
			: tab === 'evidence'
				? 'evidence'
				: (tab === 'scenarios' || tab === 'recommendations') && proposalView === 'policy'
					? 'policy'
					: tab === 'explore' && exploreView === 'places'
						? 'places'
						: tab === 'explore' && exploreView === 'schedules'
							? 'schedules'
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
	let overviewFeatures = $state.raw<MapFeatures | null>(null);
	let detailedFeatures = $state.raw<{ islandId: string; data: MapFeatures } | null>(null);
	let detailError = $state('');
	let detailVersion = $state(0);
	const selectedBoundaryFeatures = $derived<MapFeatures | null>(
		detailedFeatures?.islandId === selectedId
			? {
					type: 'FeatureCollection',
					features: detailedFeatures.data.features.filter(
						(feature) => feature.properties?.id === selectedId && !feature.properties?.island_id
					)
				}
			: null
	);
	const features = $derived.by(() => {
		if (!overviewFeatures) return null;
		if (!selectedId || detailedFeatures?.islandId !== selectedId) return overviewFeatures;
		return {
			...overviewFeatures,
			features: [
				...overviewFeatures.features.filter((feature) => feature.properties?.id !== selectedId),
				...detailedFeatures.data.features
			]
		};
	});
	let summary = $state.raw<NationalSummary | null>(null);
	let profile = $state.raw<IslandProfile | null>(null);
	let focusVersion = $state(0);
	let loading = $state(true);
	let profileLoading = $state(false);
	let connection = $state('Connecting');
	let fatalError = $state('');
	let error = $state('');
	let notice = $state('');
	let search = $state('');
	let atoll = $state('');
	let sidebarOpen = $state(false);
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
	let routeStartLabel = $state('Choose a start on the map');
	let routeEndLabel = $state('Choose a destination on the map');
	let routeMode = $state('walk');
	let journeyFocusVersion = $state(0);
	let routeDate = $state('2026-10-10');
	let routeTime = $state('15:20');
	let transitStops = $state.raw<{ id: string; name: string; coordinates: Coordinates }[]>([]);
	let transitStopController: AbortController | undefined;
	let route = $state.raw<LandRoute | null>(null);
	let recommendationType = $state('bus_stop');
	let recommendations = $state.raw<RecommendationResponse | null>(null);
	let liveStatus = $state.raw<LiveStatus | null>(null);
	let liveObservedSnapshot = $state.raw<LiveSnapshot | null>(null);
	let liveObservedScope = $state<string | null>(null);
	let liveBusy = $state(false);
	let liveError = $state('');
	let exploreMovementEnabled = $state(true);
	let documentVisible = $state(true);
	let controller: AbortController | undefined;
	let profileController: AbortController | undefined;
	let actionController: AbortController | undefined;
	let detailController: AbortController | undefined;
	let initialized = $state(false);
	const showAccessExplorer = $derived(
		isMapWorkspace &&
			!selectedId &&
			tab === 'explore' &&
			exploreView === 'map' &&
			accessExplorerOpen &&
			!panelOpen &&
			!pickMode &&
			!policyState.panelOpen
	);
	const preparingIsland = $derived(
		loading && ['policy', 'places', 'conditions'].includes(activeWorkspace)
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
		if (initialized && isMapWorkspace) untrack(() => void loadWorkspace('atlas'));
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
		if (profileView === 'route') untrack(() => void loadWorkspace('journey'));
		if (exploreView === 'conditions') untrack(() => void loadWorkspace('mapConditions'));
	});
	$effect(() => {
		const id = selectedId;
		void detailVersion;
		if (!initialized || !overviewFeatures || !isMapWorkspace || !id) return;
		const active = new AbortController();
		detailController?.abort();
		detailController = active;
		detailError = '';
		void api<MapFeatures>(
			`map/features?layer=all&island_id=${encodeURIComponent(id)}`,
			undefined,
			active.signal
		)
			.then((data) => {
				if (!active.signal.aborted) detailedFeatures = { islandId: id, data };
			})
			.catch(() => {
				if (!active.signal.aborted)
					detailError = 'Detailed map evidence could not load. Retry before placing a proposal.';
			});
		return () => active.abort();
	});
	let importInput = $state<HTMLInputElement | null>(null);
	const islands = $derived(
		(overviewFeatures?.features.filter(
			(feature) =>
				typeof feature.properties?.id === 'string' && feature.properties.id.startsWith('island:')
		) ?? []) as IslandFeature[]
	);
	const atolls = $derived(
		[
			...new Set(
				islands
					.map((island) => island.properties.atoll)
					.filter((name): name is string => Boolean(name))
			)
		].sort()
	);
	const filtered = $derived(
		islands
			.filter(
				(island) =>
					(!atoll || island.properties.atoll === atoll) &&
					(!search ||
						`${island.properties.name} ${island.properties.atoll ?? ''}`
							.toLocaleLowerCase()
							.includes(search.toLocaleLowerCase()))
			)
			.sort((a, b) => (a.properties.name ?? '').localeCompare(b.properties.name ?? ''))
	);
	const selected = $derived(islands.find((island) => island.properties.id === selectedId));
	const selectedCoordinates = $derived(
		selected?.properties.centroid ??
			(selected?.geometry.type === 'Point'
				? (selected.geometry.coordinates as Coordinates)
				: undefined)
	);
	const actionContext = $derived({
		scenario,
		reference,
		selectedId,
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
		initialized && !loading && documentVisible && isMapWorkspace && exploreMovementEnabled
	);
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
		const id = selectedId;
		if (!initialized || activeWorkspace !== 'atlas' || !id) return;
		const active = new AbortController();
		transitStopController?.abort();
		transitStopController = active;
		transitStops = [];
		void api<{ stops: typeof transitStops }>(
			`routing/stops?island_id=${encodeURIComponent(id)}`,
			undefined,
			active.signal
		)
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
	const islandName = (name: string | null | undefined, id: string | undefined) =>
		name?.trim() || `Unnamed island${id ? ` (${id})` : ''}`;
	const signed = (value: number) => `${value > 0 ? '+' : ''}${fmt(value)}`;
	const message = (cause: unknown) =>
		cause instanceof Error ? cause.message : 'The request failed. Please retry.';

	async function load() {
		controller?.abort();
		const active = new AbortController();
		controller = active;
		loading = true;
		fatalError = '';
		connection = 'Connecting';
		void loadAccessScores();
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
			const initial =
				islands.find((island) => island.properties.id === selectedId) ??
				(tab === 'scenarios' || tab === 'recommendations'
					? islands.find((island) => /^(mal[eé]|male.? city)$/i.test(island.properties.name ?? ''))
					: undefined);
			if (initial) {
				selectIsland(initial.properties.id, false);
				writeLocation(false);
			} else if (selectedId) resetIslandSelection();
		} catch (cause) {
			if (!active.signal.aborted) {
				fatalError = message(cause);
				connection = 'Backend unavailable';
			}
		} finally {
			if (!active.signal.aborted) loading = false;
		}
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
		profileController?.abort();
		profile = null;
		profileLoading = false;
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
		atoll = '';
		search = '';
		go('map', false);
		focusVersion += 1;
		writeLocation(true);
	}
	function showAtoll(name: string) {
		resetIslandSelection();
		policyLens = 'overall';
		countryAtoll = name;
		atoll = name;
		search = '';
		go('map', false);
		focusVersion += 1;
		writeLocation(true);
	}
	function selectIsland(id: string, push = true) {
		countryAtoll = islands.find((island) => island.properties.id === id)?.properties.atoll ?? null;
		accessExplorerOpen = false;
		if (id === selectedId) {
			sidebarOpen = false;
			focusVersion += 1;
			if (!profile && !profileLoading) void loadProfile(id);
			return;
		}
		selectedId = id;
		sidebarOpen = false;
		pickMode = null;
		error = '';
		simulation = null;
		comparison = null;
		recommendations = null;
		route = null;
		routeStart = null;
		routeEnd = null;
		routeStartLabel = 'Choose a start on the map';
		routeEndLabel = 'Choose a destination on the map';
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
		try {
			const next = await api<IslandProfile>(
				`islands/${encodeURIComponent(id)}/profile`,
				undefined,
				active.signal
			);
			if (!active.signal.aborted) profile = next;
		} catch (cause) {
			if (!active.signal.aborted) error = message(cause);
		} finally {
			if (!active.signal.aborted) profileLoading = false;
		}
	}
	function picked(coordinates: Coordinates) {
		if (pickMode === 'proposal') {
			placeProposal(coordinates);
			return;
		}
		if (pickMode === 'operation') {
			longitude = coordinates[0].toFixed(6);
			latitude = coordinates[1].toFixed(6);
		}
		if (pickMode === 'start') {
			routeStart = coordinates;
			routeStartLabel = 'Start selected on map';
			route = null;
			pickMode = routeEnd ? null : 'end';
			panelOpen = exploreView === 'conditions' ? false : !!routeEnd;
			return;
		}
		if (pickMode === 'end') {
			routeEnd = coordinates;
			routeEndLabel = 'Destination selected on map';
			route = null;
			panelOpen = exploreView !== 'conditions';
		}
		pickMode = null;
	}
	function placeProposal(
		coordinates: Coordinates,
		kind?: 'add_hospital' | 'add_school' | 'add_stop'
	) {
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
		if (endpoint === 'start') {
			routeStart = coordinates;
			routeStartLabel = name;
		} else {
			routeEnd = coordinates;
			routeEndLabel = name;
		}
		route = null;
		profileView = 'route';
		panelOpen = true;
		pickMode = null;
		if (focus) journeyFocusVersion += 1;
		writeLocation(true);
	}
	function inspectIsland(id: string) {
		selectIsland(id, false);
		panelOpen = false;
		inspectedCell = null;
		accessExplorerOpen = false;
		policyAction('close');
		writeLocation(true);
	}
	function chooseJourneyPoint(endpoint: 'start' | 'end') {
		setProfileView('route');
		pickMode = endpoint;
		panelOpen = false;
	}
	function clearJourneyPoint(endpoint: 'start' | 'end') {
		cancelAction();
		conditionRoute = [];
		if (endpoint === 'start') {
			routeStart = null;
			routeStartLabel = 'Choose a start on the map';
		} else {
			routeEnd = null;
			routeEndLabel = 'Choose a destination on the map';
		}
		route = null;
		pickMode = null;
	}
	function resetJourney() {
		clearJourneyPoint('start');
		clearJourneyPoint('end');
		error = '';
	}
	function swapJourney() {
		cancelAction();
		[routeStart, routeEnd] = [routeEnd, routeStart];
		[routeStartLabel, routeEndLabel] = [routeEndLabel, routeStartLabel];
		route = null;
	}
	function cancelPick() {
		const wasJourney = pickMode === 'start' || pickMode === 'end';
		pickMode = null;
		policyPickKind = null;
		if (wasJourney) panelOpen = true;
	}
	function closeJourney() {
		pickMode = null;
		panelOpen = false;
		profileView = 'baseline';
		writeLocation(true);
	}
	function returnToExplore() {
		exploreView = 'map';
		go('explore');
		panelOpen = profileView === 'route' && !!(routeStart || routeEnd);
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
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(scenario, null, 2)], { type: 'application/json' })
		);
		const link = document.createElement('a');
		link.href = url;
		link.download = `${scenario.id.replace(/[^a-z0-9_-]/gi, '_')}.json`;
		link.click();
		URL.revokeObjectURL(url);
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
		if (!routeStart || !routeEnd || !selectedId) return;
		const start = routeStart,
			end = routeEnd,
			mode = routeMode,
			scope = selectedId;
		const [hours, minutes] = routeTime.split(':').map(Number);
		const departure_minutes = hours * 60 + minutes;
		await runAction(
			'route',
			(signal) =>
				api<LandRoute>(
					'routing/land',
					{
						start,
						end,
						mode,
						island_id: scope,
						...(mode === 'transit' ? { service_date: routeDate, departure_minutes } : {})
					},
					signal
				),
			(result) => (route = result)
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
	async function refreshLive() {
		await movementSession.refresh();
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
			const id = params.get('island');
			if (id && id !== selectedId) {
				if (features) selectIsland(id, false);
				else selectedId = id;
			} else if (!id && selectedId) resetIslandSelection();
			countryAtoll = id ? countryAtoll : params.get('atoll');
			accessExplorerOpen = !id && !params.has('lens') && params.get('tool') !== 'proposals';
			const requested = params.get('view') ?? 'map';
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
				params.get('proposal') ?? (requested === 'map' && tool === 'proposals' ? 'policy' : null);
			if (
				next === 'scenarios' &&
				proposal &&
				['edit', 'candidates', 'review', 'policy'].includes(proposal)
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
			panelOpen ||= profileView === 'route';
			overviewView = ['passengers', 'data'].includes(params.get('analytics') ?? '')
				? params.get('analytics')!
				: 'national';
			exploreView =
				tool === 'places' || params.get('explorer') === 'places'
					? 'places'
					: params.get('explorer') === 'schedules'
						? 'schedules'
						: params.get('explorer') === 'conditions' ||
							  ((tool === 'live' || requested === 'live') && params.get('context') !== 'positions')
							? 'conditions'
							: 'map';
		};
		restoreView();
		initialized = true;
		void load();
		window.addEventListener('popstate', restoreView);
		const updateVisibility = () => {
			documentVisible = !document.hidden;
		};
		updateVisibility();
		document.addEventListener('visibilitychange', updateVisibility);
		return () => {
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
			exploreView = 'conditions';
		}
		if (!['overview', 'explore', 'scenarios', 'recommendations', 'live', 'evidence'].includes(next))
			next = 'explore';
		const wasMapVisible = tab !== 'overview' && tab !== 'evidence';
		tab = next;
		if (!wasMapVisible && next !== 'overview' && next !== 'evidence') focusVersion += 1;
		if (next === 'recommendations') proposalView = 'candidates';
		if (next === 'scenarios' && proposalView === 'candidates') proposalView = 'edit';
		pickMode = null;
		sidebarOpen = false;
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
		accessExplorerOpen = false;
		panelOpen = false;
		policyAction('compose');
	}
	function setOverviewView(value: string) {
		overviewView = value;
		writeLocation(true);
	}
	function setExploreView(value: string) {
		exploreView = value;
		pickMode = null;
		panelOpen = false;
		policyAction('close');
		writeLocation(true);
	}
	function useReviewedNotice(operation: Record<string, unknown>) {
		incomingOperation = operation;
		setProposalView('policy');
	}
	function setProfileView(value: string) {
		policyAction('close');
		profileView = value;
		panelOpen = true;
		pickMode = null;
		writeLocation(true);
	}
	function exploreFromOverview(id?: string, selectedAtoll?: string, lens?: PolicyLens) {
		if (!id && !lens) {
			if (selectedAtoll) showAtoll(selectedAtoll);
			else showCountry();
			return;
		}
		if (id) selectIsland(id, false);
		if (selectedAtoll !== undefined) {
			atoll = selectedAtoll;
			search = '';
		}
		go('explore');
		exploreView = 'map';
		if (lens) policyLens = lens;
		accessExplorerOpen = !id && !lens;
		if (lens) policyAction('gaps');
		else policyAction('close');
		writeLocation(false);
		if (!id && selectedAtoll) sidebarOpen = true;
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
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(brief, null, 2)], { type: 'application/json' })
		);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'decision-brief-' + scenario.id.replace(/[^a-z0-9_-]/gi, '_') + '.json';
		link.click();
		URL.revokeObjectURL(url);
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
		if (event.key === 'Escape') {
			cancelPick();
			workspaceMenuOpen = false;
		}
	}}
	onclick={(event) => {
		if (event.target instanceof Element && !event.target.closest('.workspace-menu'))
			workspaceMenuOpen = false;
	}}
/>
<div class="app-shell" class:map-first-shell={isMapWorkspace}>
	<a class="skip-link" href="#workspace-content">Skip to workspace</a>
	{#if !isMapWorkspace}
		<header class="app-header">
			<a
				class="brand"
				href="/?view=overview"
				aria-label="Mobility Sandbox home"
				onclick={(event) => {
					event.preventDefault();
					go('overview');
				}}
				><span class="brand-icon"><Layers size={22} strokeWidth={1.7} /></span><span
					>mobility<span class="brand-sub">SANDBOX / MALDIVES</span></span
				></a
			>
			<nav aria-label="Workspace" class="navigation-island">
				{#each tabs as item (item.id)}
					<Button
						variant="ghost"
						class={tab === item.id ? 'nav-item active' : 'nav-item'}
						aria-current={tab === item.id ? 'page' : undefined}
						onclick={() => {
							if (item.id === 'map') showCountry();
							else go(item.id);
						}}><item.icon size={16} /><span>{item.label}</span></Button
					>
				{/each}
			</nav>
			<div class="connection" title={connection}>
				<span class:online={connection === 'Backend connected'}></span><span
					>{connection === 'Backend connected' ? 'Data connected' : connection}</span
				>
			</div>
		</header>
	{:else}
		<details class="workspace-menu" bind:open={workspaceMenuOpen}>
			<summary aria-label="Open workspace menu"><Menu size={20} /></summary>
			<div class="workspace-menu-content">
				<strong>Maldives · Mobility Sandbox</strong>
				<nav aria-label="Workspace">
					{#each tabs as item (item.id)}<Button
							variant="ghost"
							aria-current={tab === item.id || (item.id === 'map' && isMapWorkspace)
								? 'page'
								: undefined}
							onclick={() => {
								if (item.id === 'map') showCountry();
								else go(item.id);
								workspaceMenuOpen = false;
							}}><item.icon size={16} />{item.label}</Button
						>{/each}
					{#if selectedId && isMapWorkspace}
						<Button
							variant="ghost"
							onclick={() => {
								setProfileView('route');
								workspaceMenuOpen = false;
							}}><Route size={16} />Directions</Button
						>
						<Button
							variant="ghost"
							onclick={() => {
								setExploreView('conditions');
								workspaceMenuOpen = false;
							}}><CloudSun size={16} />Weather & traffic</Button
						>
						<Button
							variant="ghost"
							onclick={() => {
								setProposalView('edit');
								workspaceMenuOpen = false;
							}}><GitBranch size={16} />Network modelling</Button
						>
					{/if}
				</nav>
				<div class="connection" title={connection}>
					<span class:online={connection === 'Backend connected'}></span>{connection ===
					'Backend connected'
						? 'Data connected'
						: connection}
				</div>
			</div>
		</details>
	{/if}
	{#if fatalError}<div class="fatal" role="alert">
			<Activity size={22} />
			<div>
				<strong>Planning data is unavailable.</strong>
				<p>{fatalError}</p>
			</div>
			<Button onclick={load}>Retry connection</Button>
		</div>{/if}
	<main id="workspace-content" class="workspace-body" tabindex="-1">
		{#if tab === 'overview'}<div class="workspace-subnav">
				<Tabs.Root value={overviewView} onValueChange={setOverviewView}
					><Tabs.List aria-label="Analytics workspace"
						><Tabs.Trigger value="national">National dashboard</Tabs.Trigger><Tabs.Trigger
							value="passengers">Passenger outlook</Tabs.Trigger
						><Tabs.Trigger value="data">Data studio</Tabs.Trigger></Tabs.List
					></Tabs.Root
				><span>Understand demand and the evidence behind it</span>
			</div>
		{/if}
		{#if (tab === 'scenarios' || tab === 'recommendations') && proposalView !== 'policy'}<div
				class="workspace-subnav tool-detail-nav"
			>
				<Tabs.Root
					value={proposalView === 'policy' ? 'policy' : 'map'}
					onValueChange={(value) => setProposalView(value === 'policy' ? 'policy' : 'edit')}
					><Tabs.List aria-label="Proposal workspace"
						><Tabs.Trigger value="policy">Resident access & services</Tabs.Trigger><Tabs.Trigger
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
					{summary}
					features={overviewFeatures}
					onExplore={exploreFromOverview}
					onForecast={() => setOverviewView('passengers')}
				/>
			</div>{/if}
		{#if workspaces.forecast}<div hidden={activeWorkspace !== 'forecast'}>
				<workspaces.forecast />
			</div>{/if}
		{#if workspaces.studio}<div hidden={activeWorkspace !== 'studio'}>
				<workspaces.studio />
			</div>{/if}
		{#if workspaces.policy && !loading}<div hidden={activeWorkspace !== 'policy'}>
				<workspaces.policy
					islandId={selectedId ?? 'island:1443'}
					mapFeatures={features}
					active={(tab === 'scenarios' || tab === 'recommendations') && proposalView === 'policy'}
					{scenario}
					incomingOperation={activeWorkspace === 'policy' ? incomingOperation : null}
					{incomingPlacement}
					onConsume={() => (incomingOperation = null)}
					onExplore={returnToExplore}
				/>
			</div>{/if}
		{#if workspaces.places && !loading}<div
				class="map-tool-sheet places-sheet"
				hidden={activeWorkspace !== 'places'}
			>
				<Button class="map-tool-close" variant="outline" onclick={returnToExplore}
					><X size={16} />Back to map</Button
				>
				<workspaces.places
					active={tab === 'explore' && exploreView === 'places'}
					selectedIsland={selected
						? {
								id: selected.properties.id,
								name: selected.properties.name ?? 'Selected island',
								coordinates: selectedCoordinates
							}
						: undefined}
					onJourneyPoint={(place, endpoint) =>
						useJourneyPoint([place.longitude, place.latitude], endpoint, place.name)}
				/>
			</div>{/if}
		{#if workspaces.schedules}<div class="map-tool-sheet" hidden={activeWorkspace !== 'schedules'}>
				<Button class="map-tool-close" variant="outline" onclick={returnToExplore}
					><X size={16} />Back to map</Button
				>
				<workspaces.schedules mode="schedules" islandId={selectedId ?? 'island:1443'} />
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
			class:proposal-workspace={tab === 'scenarios' || tab === 'recommendations'}
			class:panel-hidden={!panelOpen}
			class:panel-expanded={panelExpanded && panelOpen}
			class:policy-panel-open={policyState.panelOpen}
			class:conditions-panel-open={tab === 'explore' && exploreView === 'conditions'}
			class:access-exploring={showAccessExplorer}
			class:country-overview={!selectedId}
			hidden={!isMapWorkspace || activeWorkspace === 'policy'}
		>
			<div class="map-region" aria-label="National planning map">
				{#if workspaces.atlas}
					<workspaces.atlas
						active={isMapWorkspace && activeWorkspace !== 'policy'}
						{features}
						{selectedId}
						atollScope={countryAtoll}
						accessibilityScores={displayedScores}
						onnational={showCountry}
						{focusVersion}
						{focusPoint}
						{conditionRoute}
						policyServiceFeatures={accessExplorerOpen
							? emptyPolicyMap
							: policyState.serviceFeatures}
						gapFeatures={accessExplorerOpen ? emptyPolicyMap : policyState.gapFeatures}
						impactFeatures={accessExplorerOpen ? emptyPolicyMap : policyState.impactFeatures}
						gapLens={policyLens}
						policyOperations={accessExplorerOpen ? emptyOperations : policyState.operations}
						pendingProposal={accessExplorerOpen ? null : policyState.pending}
						pendingPlacementDecision={accessExplorerOpen ? null : policyState.pendingDecision}
						onconfirmproposal={() => policyAction('confirm')}
						oncancelproposal={() => policyAction('cancel-placement')}
						policyCalculating={policyState.calculating}
						policyStale={policyState.stale}
						onmoveproposal={(index, coordinates) =>
							(policyMove = { id: ++policySequence, index, coordinates })}
						onfocusproposal={startIslandProposal}
						ondropplacement={(point, kind) => placeProposal(point, kind)}
						oninspectgap={(properties) => {
							accessExplorerOpen = false;
							inspectedCell = properties;
							policyAction('inspect');
						}}
						mode={mapTool === 'proposals' ? 'proposal' : 'explore'}
						onselect={inspectIsland}
						onpick={picked}
						onplanpoint={(point) => placeProposal(point)}
						onroutepoint={useJourneyPoint}
						onmovejourneypoint={chooseJourneyPoint}
						onclearjourneypoint={clearJourneyPoint}
						{transitStops}
						picking={pickMode !== null}
						draft={scenario.operations}
						{route}
						{routeStart}
						{journeyFocusVersion}
						{routeEnd}
						liveEvents={liveSnapshot?.events ?? emptyLiveEvents}
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
						<span class="spinner" aria-hidden="true"></span><strong
							>Opening the national atlas</strong
						><span>Loading island geography and source records.</span>
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
						onSearch={() => (sidebarOpen = true)}
					/>
				</div>
			{/if}
			{#if workspaces.mapPolicy}<workspaces.mapPolicy
					islandId={selectedId}
					islandName={selected?.properties.name ?? 'Selected island'}
					mapFeatures={features}
					boundaryFeatures={selectedBoundaryFeatures}
					boundaryError={detailError}
					onRetryBoundary={() => (detailVersion += 1)}
					active={isMapWorkspace &&
						tab === 'explore' &&
						exploreView === 'map' &&
						!panelOpen &&
						!!selectedId &&
						!accessExplorerOpen}
					lens={policyLens}
					command={policyCommand}
					placement={incomingPlacement}
					{incomingOperation}
					onConsume={() => (incomingOperation = null)}
					moved={policyMove}
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
					onFocus={focusPolicyPoint}
					onDetails={() => setProfileView('baseline')}
				/>{/if}
			{#if workspaces.mapConditions && tab === 'explore' && exploreView === 'conditions' && !pickMode}<workspaces.mapConditions
					coordinates={selectedCoordinates}
					islandName={selected?.properties.name ?? 'Selected island'}
					start={routeStart}
					end={routeEnd}
					startLabel={routeStartLabel}
					endLabel={routeEndLabel}
					onClose={returnToExplore}
					onChoosePoint={(endpoint) => {
						panelOpen = false;
						pickMode = endpoint;
					}}
					onReset={resetJourney}
					onRoute={(coordinates) => (conditionRoute = coordinates)}
					onNotices={() => {
						void loadWorkspace('conditions');
						exploreView = 'notices';
					}}
				/>{/if}
			{#if !showAccessExplorer}<div class="map-search-dock">
					<Button
						variant="outline"
						class="island-search-trigger"
						onclick={() => (sidebarOpen = true)}
						><Search size={18} /><span>Find an island or atoll</span></Button
					><Button
						variant="outline"
						size="icon"
						title="Focus selected island"
						aria-label="Focus selected island"
						onclick={() => (focusVersion += 1)}><LocateFixed size={17} /></Button
					>
					<Button
						variant="outline"
						size="icon"
						title="Nationwide schedules"
						aria-label="Nationwide schedules"
						onclick={() => {
							go('explore', false);
							setExploreView('schedules');
						}}><CalendarDays size={17} /></Button
					>
				</div>{/if}
			{#if tab === 'explore' && selectedId && !showAccessExplorer && !pickMode}<div
					class="nearby-movement-controls"
					aria-label="Explore supporting tools"
				>
					<Button variant="outline" size="sm" onclick={() => setExploreView('conditions')}
						><CloudSun size={14} />Weather & traffic</Button
					>
					<details class="movement-settings">
						<summary
							><Radio size={14} />{exploreMovementEnabled
								? 'Nearby updates on'
								: 'Nearby updates paused'}</summary
						>
						<div>
							<Button
								variant="ghost"
								size="sm"
								aria-pressed={exploreMovementEnabled}
								onclick={() => (exploreMovementEnabled = !exploreMovementEnabled)}
								>{exploreMovementEnabled ? 'Pause nearby updates' : 'Resume nearby updates'}</Button
							><Button
								variant="ghost"
								size="sm"
								disabled={!movementVisible || liveBusy}
								onclick={refreshLive}
								><RefreshCw size={14} />{liveBusy ? 'Checking nearby' : 'Refresh nearby'}</Button
							>
						</div>
					</details>
				</div>{/if}
			{#if pickMode}<div class="pick-banner" role="status">
					<LocateFixed size={18} /><span
						>{pickMode === 'operation' || pickMode === 'proposal'
							? 'Choose a location for your proposal'
							: pickMode === 'start'
								? 'Where will you start?'
								: 'Where would you like to go?'}<small>Click on the map · Escape to cancel</small
						></span
					><Button variant="ghost" size="sm" onclick={cancelPick}>Cancel</Button>
				</div>{/if}
			<aside
				class="detail-panel"
				class:collapsed={!panelOpen}
				aria-label="Planning details"
				bind:this={detailsElement}
			>
				<Card.Root class="context-card">
					<div class="context-location">
						<span
							><MapPin size={14} />{selected
								? islandName(selected.properties.name, selected.properties.id)
								: 'Select an island'}<small>{selected?.properties.atoll ?? 'Maldives'}</small></span
						>
						<div class="context-window-actions">
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={panelExpanded ? 'Restore compact details' : 'Expand planning details'}
								onclick={() => (panelExpanded = !panelExpanded)}
								>{#if panelExpanded}<Minimize2 size={16} />{:else}<Maximize2
										size={16}
									/>{/if}</Button
							><Button
								variant="ghost"
								size="icon-sm"
								onclick={() => (panelOpen = false)}
								aria-label="Collapse island details"><PanelRightClose size={17} /></Button
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
													: 'Outside linked census coverage'}</span
											>
										</div>
										<div>
											<small>Official facilities</small><strong
												>{fmt(profile.infrastructure.total)}</strong
											><span>{fmt(profile.transport.total)} OSM transport features</span>
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
												<strong>{profile.accessibility.score.toFixed(1)}<span>/100</span></strong
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
														<span style={'width:' + Math.min(100, Math.max(0, value.score)) + '%'}
														></span>
													</div>
													<b>{value.score.toFixed(1)}</b>
												</div>{/each}
											<p class="fine-print">
												A distance and data coverage score. Zero can reflect missing evidence. This
												score is not recalculated by scenario simulation.
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
										{:else}<p class="empty-state">No accessibility result for this island.</p>{/if}
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
															? label(facility.match_status ?? 'Mapped')
															: 'Location unavailable'}</small
													>
												</div>
											</div>{/each}
										{#if !profile.infrastructure.total}<p class="empty-state">
												No linked official facilities in this cache.
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
											<strong>Know the coverage</strong>
											<p>{profile.data_quality.warnings.join('. ')}.</p>
											<p>
												{fmt(profile.data_quality.unresolved_facility_count)} facilities have uncertain
												or missing locations.
											</p>
										</div>{/if}
									<Button variant="outline" class="wide" onclick={() => setProposalView('policy')}
										>Test a proposal here<ArrowUpRight size={16} /></Button
									>
								{:else if !loading}<p class="empty-state">
										Select an island to inspect its baseline.
									</p>{/if}
							</Tabs.Content>
							<Tabs.Content value="route" class="context-tab-content">
								{#if workspaces.journey}<workspaces.journey
										start={routeStart}
										end={routeEnd}
										startLabel={routeStartLabel}
										endLabel={routeEndLabel}
										bind:mode={routeMode}
										bind:serviceDate={routeDate}
										bind:departureTime={routeTime}
										result={route}
										busy={busy === 'route'}
										onPick={chooseJourneyPoint}
										onClear={clearJourneyPoint}
										onReset={resetJourney}
										onSwap={swapJourney}
										onBack={closeJourney}
										onFind={requestRoute}
										onChange={() => {
											cancelAction();
											route = null;
										}}
									/>{:else}<p class="empty-state" role="status">Opening journey planner…</p>{/if}
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
								aria-current={proposalView !== 'review' ? 'step' : undefined}><b>2</b>Proposal</span
							><ChevronRight size={12} /><span
								class:complete={!!simulation}
								class:current={proposalView === 'review'}
								aria-current={proposalView === 'review' ? 'step' : undefined}><b>3</b>Review</span
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
										><Input id="target-id" bind:value={targetId} placeholder="Exact source ID" />
										<p class="fine-print">
											Select a source record or enter a graph edge/OSM way ID. Unknown targets are
											reported as unapplied.
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
												Use existing graph nodes. Land node IDs appear in a route result. Marine and
												airport nodes require the backend graph artifacts.
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
									{#each scenario.operations as operation, index (index)}<div class="operation-row">
											<span>{String(index + 1).padStart(2, '0')}</span>
											<div>
												<strong>{operationLabels[operation.type]}</strong><small
													>{islands.find((island) => island.properties.id === operation.island_id)
														?.properties.name ??
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
								<Button variant="ghost" class="wide" onclick={() => setProposalView('candidates')}
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
									Ranks up to 20 candidates using 70% heuristic benefit and 30% confidence. Scores
									are screening indicators.
								</p>
								{#if recommendations}<div class="section-title">
										<h3>Planning candidates</h3>
										<span>{recommendations.summary.candidate_count} considered</span>
									</div>
									{#each recommendations.recommendations as candidate, index (candidate.id)}<Card.Root
											class="candidate-card"
											><div class="section-title">
												<span class="candidate-number">{String(index + 1).padStart(2, '0')}</span
												><span class="soft-tag">SCORE {candidate.score.toFixed(1)}</span>
											</div>
											<h3>{label(candidate.type)} · {candidate.island_name}</h3>
											<p>{candidate.reason}</p>
											<div class="candidate-stats">
												<span
													>Heuristic benefit<b>{candidate.expected_benefit.toFixed(1)}/100</b></span
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
										>{/each}{#if !recommendations.recommendations.length}<div class="empty-card">
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
										Review geometry, land availability, feasibility, and evidence before using an
										option.
									</p>
								</div>
							</Tabs.Content>
							<Tabs.Content value="review" class="context-tab-content">
								<div class="review-heading">
									<span class="eyebrow">DECISION REVIEW</span>
									<h2>What changes with your option?</h2>
									<p>
										Compare the modeled network changes, then inspect the evidence before sharing.
									</p>
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
												<thead><tr><th>Metric</th><th>Before</th><th>After</th></tr></thead><tbody
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
										Network edges and transport feature counts. A new stop does not establish a bus
										service. This backend does not estimate journey-time savings, ridership, costs,
										or changes to accessibility scores.
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
			</aside>
			{#if tab === 'explore' && selectedId && !showAccessExplorer && !pickMode && !panelOpen}<div
					class="map-action-dock"
				>
					<span class="dock-label">EXPLORE THIS PLACE</span><Button
						variant="ghost"
						disabled={loading || !selected}
						onclick={() => {
							setProfileView('route');
							if (!routeStart) chooseJourneyPoint('start');
						}}><Route size={17} />Directions</Button
					><span class="dock-divider"></span><Button
						variant="ghost"
						disabled={loading || !selected}
						onclick={() => setExploreView('places')}><Search size={17} />Find a place</Button
					><Button disabled={loading || !selected} onclick={startIslandProposal}
						>Create proposal<Plus size={16} /></Button
					>
				</div>{:else if tab === 'scenarios' || tab === 'recommendations'}<div
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
					{summary}
					onExplore={() => go('explore')}
					onExport={exportBrief}
					canExport={!!simulation}
				/>
			</div>{/if}
	</main>
</div>
<Sheet.Root bind:open={sidebarOpen}
	><Sheet.Content side="left" class="island-search-sheet"
		><Sheet.Header
			><Sheet.Title>Find an island</Sheet.Title><Sheet.Description
				>Choose a place to understand its baseline and plan a connection.</Sheet.Description
			></Sheet.Header
		>
		<div class="search-field">
			<Search size={16} /><Input
				aria-label="Search islands"
				placeholder="Search islands or atolls"
				bind:value={search}
			/>
		</div>
		<NativeSelect.Root aria-label="Filter by atoll" bind:value={atoll}
			><NativeSelect.Option value="">All atolls</NativeSelect.Option
			>{#each atolls as name (name)}<NativeSelect.Option value={name}>{name}</NativeSelect.Option
				>{/each}</NativeSelect.Root
		>
		<div class="list-heading">
			<span>{loading ? 'Loading national coverage…' : `${fmt(filtered.length)} islands`}</span
			>{#if atoll || search}<Button
					variant="ghost"
					class="text-button"
					onclick={() => {
						search = '';
						atoll = '';
					}}>Clear</Button
				>{/if}
		</div>
		<div class="island-list">
			{#each filtered.slice(0, 150) as island (island.properties.id)}<Button
					data-island-id={island.properties.id}
					variant="ghost"
					class={selectedId === island.properties.id ? 'selected' : ''}
					onclick={() => selectIsland(island.properties.id)}
					><span class="island-dot"></span><span class="island-info"
						><strong>{islandName(island.properties.name, island.properties.id)}</strong><small
							>{island.properties.atoll || 'Atoll not recorded'}</small
						></span
					>{#if selectedId === island.properties.id}<ArrowUpRight size={17} />{/if}</Button
				>{/each}{#if !loading && !filtered.length}<p class="empty-state">
					No islands match this search.
				</p>{:else if filtered.length > 150}<p class="list-note">
					Showing the first 150. Search or choose an atoll to narrow the list.
				</p>{/if}
		</div>
		<div class="sidebar-footer">
			<span class="source-dot"></span>OneMap geography · Official records · OSM
		</div></Sheet.Content
	></Sheet.Root
>
