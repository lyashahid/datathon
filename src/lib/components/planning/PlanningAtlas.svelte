<script lang="ts">
	import { onMount, tick, untrack, type Snippet } from 'svelte';
	import CompactPolicySummary from './CompactPolicySummary.svelte';
	import EditImpactReceipt from './EditImpactReceipt.svelte';
	import { compareEditOrigins } from './editImpact.ts';
	import type { PolicyMapContext } from '#lib/policy/decisions.ts';
	import type { MapSelection } from '#lib/workspace/context.ts';
	import { latLngToCell } from 'h3-js';
	import type { FeatureCollection, LineString } from 'geojson';
	import type { Point } from 'geojson';
	import type { OperationsBundle } from '#lib/operations/types.ts';
	import { activeWeatherAlerts } from '#lib/operations/lifecycle.ts';
	import { planningRoadFeatures } from '#lib/planning/disruptions.ts';
	import OperationsPanel from './OperationsPanel.svelte';
	import RobustnessPanel from './RobustnessPanel.svelte';
	import RoundTripPanel from './RoundTripPanel.svelte';
	import ServicePlaybackPanel from './ServicePlaybackPanel.svelte';
	import type {
		AppointmentJourney,
		AppointmentOptions,
		AppointmentDepartureScan
	} from '#lib/planning/returnJourney.ts';
	import {
		ReturnJourneyWorkerClient,
		SupersededAppointmentRequest
	} from '#lib/planning/returnJourneyClient.ts';
	import FerryAssumptionPanel from './FerryAssumptionPanel.svelte';
	import DemoPresetPicker, { type DemoCase } from './DemoPresetPicker.svelte';
	import {
		ArrowUpRight,
		Check,
		ChevronRight,
		ChevronDown,
		LocateFixed,
		ListRestart,
		Download,
		FileText,
		Info,
		Layers,
		Leaf,
		MousePointer2,
		BusFront,
		MapPinPlus,
		Route,
		SquareMousePointer,
		Ellipsis,
		RotateCcw,
		RotateCw,
		Settings2,
		Upload,
		X
	} from '@lucide/svelte';
	import {
		createDefaultAssumptions,
		createBusProposal,
		createFacilityProposal,
		PlanningScenarioState,
		AnalysisWorkerClient,
		PLANNING_MODEL_VERSION
	} from '#lib/planning/index.ts';
	import type {
		PlanningAction,
		PlanningAnalysis,
		PlanningAssumptions,
		PlanningBaseline,
		PlanningStop,
		NumericRange,
		PlanningCostAnchors
	} from '#lib/planning/types.ts';
	import AtlasMap from './AtlasMap.svelte';
	import { honeycombGrid, HONEYCOMB_RESOLUTION } from './honeycombGrid.ts';
	import { honeycombAreas } from './honeycombAreas.ts';
	import { TRAVEL_TIME_BANDS } from './travelTimeBands.ts';
	import { buildWaveCells, continueWave, type RecalculationWave } from './recalculationWave.ts';
	import { waveTriggerCoordinates, roadWaveTriggerCoordinates } from './waveTriggers.ts';
	import AnnualImageryPicker from './AnnualImageryPicker.svelte';
	import { makeAnnualImageryStyle, type AnnualImageryYear } from '#lib/operations/imagery.ts';
	import MobileSheet from './MobileSheet.svelte';
	import ConnectionEditor from './ConnectionEditor.svelte';
	import {
		createBusConnection,
		createStopInsertion,
		createBusStopProposal
	} from '#lib/planning/connections.ts';
	import { isEligibleFacility, getFacilityEligibility } from '#lib/planning/facilities.ts';
	import { planningCoverage, supportedSnapshotSettings } from '#lib/planning/coverage.ts';
	import { distanceM } from '#lib/planning/graph.ts';
	import {
		compareAffordableInvestments,
		type InvestmentAlternative
	} from '#lib/planning/investmentOptions.ts';
	import DestinationRequirements from './DestinationRequirements.svelte';
	import DeliverySettings from './DeliverySettings.svelte';
	import PolicyEvidencePanel from './PolicyEvidencePanel.svelte';
	import type { PolicyEvidenceBundle } from '#lib/server/data/policyEvidenceSource.ts';
	import { LiveAnalysisScheduler } from '#lib/planning/liveAnalysis.ts';
	import { prepareStopMove } from '#lib/planning/liveEdits.ts';
	import JourneyRibbon from './JourneyRibbon.svelte';
	import JourneyComparison from './JourneyComparison.svelte';
	import {
		formatJourneyTime,
		journeyChangeSummary,
		summarizeJourneyChanges
	} from './journeyChanges.ts';
	import PolicyBrief from './PolicyBrief.svelte';
	import ServiceManager from './ServiceManager.svelte';
	import DemographicsPanel from './DemographicsPanel.svelte';
	import TransportGraphic from './graphics/TransportGraphic.svelte';
	import TransportContextPanel from './TransportContextPanel.svelte';
	import type { TransportContext } from '#lib/context/types.ts';
	import { transportContextSymbols } from '#lib/context/map.ts';
	import DiscreteTabs from './controls/DiscreteTabs.svelte';
	import DestinationPicker from './DestinationPicker.svelte';
	import RoutePicker from './RoutePicker.svelte';
	import {
		SATELLITE_DETAIL,
		SATELLITE_LICENSE_NOTICE,
		SATELLITE_LICENSE_URL,
		type BasemapMode
	} from './basemaps.ts';
	import {
		coordinate,
		islandName,
		journeyData,
		money,
		number,
		priorityAreas,
		routeData,
		streetData,
		stopCoverage,
		symbolData,
		timeLabel,
		visibleStops
	} from './atlasData.ts';

	let {
		baseline,
		snapshotStale = false,
		transportContext = null,
		policyEvidence = null,
		operations = null,
		embedded = false,
		active = true,
		forecastSummary,
		onContextChange
	}: {
		baseline: PlanningBaseline;
		snapshotStale?: boolean;
		transportContext?: TransportContext | null;
		policyEvidence?: PolicyEvidenceBundle | null;
		operations?: OperationsBundle | null;
		embedded?: boolean;
		active?: boolean;
		forecastSummary?: Snippet;
		onContextChange?: (context: PolicyMapContext) => void;
	} = $props();
	let showVessels = $state(false);
	let showAirport = $state(false);
	let operationsOpen = $state(false);
	let pickingRoads = $state(false);
	let selectedRoads = $state<string[]>([]);
	let operationsExpanded = $state(true);
	let playbackOpen = $state(false);
	let playbackExpanded = $state(true);
	let playbackPatternId = $state('');
	let playbackSymbols = $state.raw<FeatureCollection<Point>>({
		type: 'FeatureCollection',
		features: []
	});
	let appointmentResult = $state.raw<AppointmentJourney | null>(null);
	let departureScan = $state.raw<AppointmentDepartureScan | null>(null);
	let appointmentOptions = $state<AppointmentOptions>({
		appointmentMinutes: 60,
		returnDeadlineMinutes: 21 * 60
	});
	let appointmentBusy = $state(false);
	let returnClient: ReturnJourneyWorkerClient | null = null;
	let returnRequest = 0;
	let returnOpen = $state(false);
	function openOperations() {
		workflowOpen = false;
		closeOverlay();
		dismissContext();
		playbackOpen = false;
		operationsOpen = true;
		areasExpanded = false;
		operationsExpanded = true;
	}
	function togglePlayback() {
		const opening = !playbackOpen;
		workflowOpen = false;
		closeOperations();
		dismissContext();
		playbackOpen = opening;
		playbackExpanded = true;
		areasExpanded = false;
	}
	function closeOperations() {
		operationsOpen = false;
		pickingRoads = false;
		selectedRoads = [];
	}
	function toggleRoad(id: string) {
		selectedRoads = selectedRoads.includes(id)
			? selectedRoads.filter((e) => e !== id)
			: [...selectedRoads, id];
	}
	function chooseTask(value: string) {
		if (value === 'disruption') openOperations();
		else if (value === 'compare') {
			closeOperations();
			playbackOpen = false;
			compareAlternatives();
		} else {
			closeOperations();
			playbackOpen = false;
			closeOverlay();
		}
	}
	async function evaluateReturn(options = appointmentOptions, scan = false) {
		if (!analysis || !selectedId || !returnClient) return;
		const id = ++returnRequest;
		const actions = structuredClone(scenario.actions);
		const originId = selectedId;
		const assumptions = structuredClone(scenario.assumptions);
		const requestOptions = $state.snapshot(options);
		const worker = returnClient;
		appointmentOptions = options;
		appointmentBusy = true;
		appointmentResult = null;
		departureScan = null;
		await tick();
		if (id !== returnRequest) return;
		try {
			const result = await worker.analyze(actions, originId, assumptions, requestOptions);
			if (id !== returnRequest) return;
			const scanned = scan
				? await worker.scan(actions, originId, assumptions, requestOptions)
				: null;
			if (id !== returnRequest) return;
			appointmentResult = result;
			departureScan = scanned;
		} catch (error) {
			if (id === returnRequest && !(error instanceof SupersededAppointmentRequest))
				notice = `Return journey unavailable: ${String(error)}`;
		} finally {
			if (id === returnRequest) appointmentBusy = false;
		}
	}
	let transportTab = $state<'boats' | 'port' | 'airport'>('boats');
	const contextSymbols = $derived(
		transportContextSymbols(transportContext, showVessels, showAirport)
	);
	// svelte-ignore state_referenced_locally
	const scenario = new PlanningScenarioState(baseline);
	let analysis = $state.raw<PlanningAnalysis | null>(null);
	let preview = $state.raw<PlanningAnalysis | null>(null);
	// Keep the last map snapshot until the wave and its matching calculation both finish.
	let mapShown = $state.raw<PlanningAnalysis | null>(null);
	let wave = $state.raw<RecalculationWave | null>(null);
	let lastWaveActions: readonly PlanningAction[] | null = null;
	let lastWaveDisruptions: PlanningAssumptions['disruptions'] = undefined;
	let pendingMapResult: { id: number; result: PlanningAnalysis } | null = null;
	let busy = $state(true);
	let analysisFailed = $state(false);
	let selectedId = $state('');
	let selectedCellId = $state('');
	let view = $state('access');
	let drawer = $state<
		| 'evidence'
		| 'assumptions'
		| 'services'
		| 'compare'
		| 'brief'
		| 'transport'
		| 'mobile-menu'
		| 'mobile-map'
		| 'mobile-areas'
		| 'mobile-results'
		| null
	>(null);
	let overlayDialog = $state<HTMLDialogElement>();
	let mapToolbar: HTMLDetailsElement;
	let outcomeDock: HTMLDivElement;
	let outcomeHeight = $state(150);
	let transportExpanded = $state(true);
	let impactExamplesOpen = $state(false);
	let wholeProposalImpact = $state(false);
	let analyzedActions = $state.raw<readonly PlanningAction[] | null>(null);
	let analyzedAssumptions = $state.raw<PlanningAssumptions | null>(null);
	let editReceipt = $state.raw<{
		before: PlanningAnalysis | null;
		actions: readonly PlanningAction[];
		assumptions: PlanningAssumptions;
		label: string;
	} | null>(null);
	let workflowOpen = $state(false);
	let legendOpen = $state(true);
	let mapControlsHeight = $state(44);
	let viewportWidth = $state(1280);
	let isMobile = $state(false);
	let mobileDetailExpanded = $state(false);
	let mobileSheetHeight = $state(0);
	const mapOverlayHeight = $derived(
		Math.max(
			isMobile ? 62 : 72,
			(isMobile ? 72 : viewportWidth >= 1180 ? 16 : 88) + mapControlsHeight
		)
	);
	const planningDateLabel = $derived(
		new Date(`${scenario.assumptions.date}T00:00:00Z`).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			timeZone: 'UTC'
		})
	);
	let settingsTab = $state('journey');
	let areasExpanded = $state(false);
	let sourceSearch = $state('');
	const settingsTabs = [
		{ id: 'journey', label: 'Journey' },
		{ id: 'costs', label: 'Costs' },
		{ id: 'carbon', label: 'Carbon' },
		{ id: 'proposal', label: 'Proposal' }
	];
	let filteredSources = $derived(
		baseline.sources.filter((source) =>
			[source.title, source.id, source.publisher, source.referencePeriod, source.status].some(
				(value) =>
					String(value ?? '')
						.toLowerCase()
						.includes(sourceSearch.trim().toLowerCase())
			)
		)
	);
	let perspective = $state(false);
	let basemap = $state<BasemapMode>('atlas');
	let imageryYear = $state<AnnualImageryYear>(2025);
	let annualImagerySelected = $state(false);
	const satelliteStyle = $derived(
		annualImagerySelected && operations?.earthObservation
			? makeAnnualImageryStyle(imageryYear, operations.earthObservation)
			: null
	);
	const imageryDetail = $derived(
		annualImagerySelected ? `Sentinel-2 · ${imageryYear} annual mosaic · 10 m` : SATELLITE_DETAIL
	);
	const imageryLicenseUrl = $derived(
		annualImagerySelected
			? 'https://creativecommons.org/licenses/by-nc-sa/4.0/'
			: SATELLITE_LICENSE_URL
	);
	const imageryLicenseNotice = $derived(
		annualImagerySelected ? 'EOxCloudless · CC BY-NC-SA 4.0' : SATELLITE_LICENSE_NOTICE
	);
	function selectImagery(year: AnnualImageryYear) {
		imageryYear = year;
		annualImagerySelected = true;
		basemap = 'satellite';
	}
	function minuteChange(value: number) {
		const absolute = Math.abs(value);
		return absolute > 0 && absolute < 0.05 ? '<0.1' : number(absolute, 1);
	}
	const overlayOpacityKey = 'mobility-sandbox-map-opacity';
	let overlayOpacity = $state(12);
	let opacityPreferenceReady = $state(false);
	function setOverlayOpacity(value: number) {
		if (Number.isFinite(value)) overlayOpacity = Math.min(100, Math.max(0, Math.round(value)));
	}
	let context = $state<'area' | 'service' | 'build' | 'connect' | null>(null);
	type BuildMode = 'destination' | 'stop' | 'clinic' | 'school';
	let buildMode = $state<BuildMode>('destination');
	let connectionMode = $state<'new' | 'insert'>('new');
	let connectionStopIds = $state<string[]>([]);
	let connectionNewStops = $state.raw<PlanningStop[]>([]);
	let connectionPatternId = $state('');
	let connectionAfterId = $state('');
	let connectionReason = $state('Choose two or more stops in the order the bus should visit them.');
	let keepStopConnections = $state(true);
	let moveHeadway = $state(15);
	const transportEditing = $derived(
		context === 'build' || context === 'connect' || context === 'service'
	);
	const mobileBottomInset = $derived(
		outcomeHeight +
			32 +
			(context === 'area' || operationsOpen || playbackOpen ? mobileSheetHeight : 0)
	);
	let placementReason = $state('Move the pointer to a street to preview a connection.');
	let placementTimer: ReturnType<typeof setTimeout> | undefined;
	let pendingPlacement: [number, number] | null = null;
	let placementPoint = $state<[number, number] | null>(null);
	let detailGrid = $state(false);
	let includeUntimedStops = $state(false);
	let draft = $state.raw<PlanningAction | null>(null);
	let liveActions = $state.raw<PlanningAction[] | null>(null);
	let editMode = $state(false);
	let selectedStopId = $state('');
	let editRevision = $state(0);
	let gesture = $state<'stop' | 'frequency' | null>(null);
	let stopPreviewTimer: ReturnType<typeof setTimeout> | undefined;
	let pendingStopMove: { id: string; position: [number, number] } | null = null;
	let headway = $state(15);
	let fleet = $state<'diesel' | 'electric'>('diesel');
	let placing = $state(false);
	let movingStopId = $state('');
	let notice = $state('');
	let focusCoordinate = $state<[number, number] | null>(null);
	let overviewRequest = $state(0);
	let tour = $state(-1);
	let assumptionsEnabled = $state(true);
	let dailyPrivateTrips = $state<NumericRange>({ low: 0, central: 100, high: 300 });
	let privateDistanceKm = $state(4);
	let privateOccupancy = $state(1.3);
	let capitalBudget = $state(20_000_000);
	let annualBudget = $state(10_000_000);
	let enabledPolicyLayers = $state<string[]>([]);
	let policyGeometry = $state.raw<Record<string, FeatureCollection>>({});
	let housingShare = $state(20);
	let comparisonDone = $state(false);
	let comparisonNotes = $state<string[]>([]);
	let costBasis = $state<'central' | 'high'>('high');
	const coverage = $derived(planningCoverage(baseline, scenario.assumptions));
	const policyLayers = $derived(
		(policyEvidence?.layers ?? [])
			.filter((layer) => enabledPolicyLayers.includes(layer.id))
			.map((layer) => ({
				id: layer.id,
				kind: (layer.id.includes('tree')
					? 'trees'
					: layer.id.includes('pavement')
						? 'pavements'
						: layer.id.includes('access')
							? 'audits'
							: 'lots') as 'trees' | 'pavements' | 'lots' | 'audits',
				data: policyGeometry[layer.id] ?? layer.features
			}))
	);
	let comparisons = $state.raw<InvestmentAlternative[]>([]);
	let mapImage = $state('');
	let snapshotMap: (() => Promise<string>) | undefined;
	let coveragePatternId = $state('');
	let upload: HTMLInputElement;
	let client: AnalysisWorkerClient | undefined;
	let scheduler: LiveAnalysisScheduler | undefined;
	let requestId = 0;
	let initialized = $state(false);
	let startingAssumptions: PlanningAssumptions | undefined;
	let analysisMs = $state<number | null>(null);
	let savedOnDevice = $state(false);
	const emptyLand: FeatureCollection = { type: 'FeatureCollection', features: [] };
	const illustrativeCosts: PlanningCostAnchors = {
		stopCapitalMvr: { low: 150000, central: 250000, high: 450000 },
		dieselBusCapitalMvr: { low: 1500000, central: 2300000, high: 3200000 },
		electricBusCapitalMvr: { low: 2600000, central: 3600000, high: 5000000 },
		chargingInfrastructureMvr: { low: 100000, central: 300000, high: 500000 },
		dieselOperatingMvrPerKm: { low: 24, central: 36, high: 52 },
		electricOperatingMvrPerKm: { low: 18, central: 30, high: 46 },
		dieselKgCo2ePerKm: { low: 0.68, central: 0.85, high: 1.07 },
		electricKgCo2ePerKm: { low: 0.32, central: 0.66, high: 1.08 },
		displacedKgCo2ePerPassengerKm: { low: 0.06, central: 0.11, high: 0.18 }
	};
	const costFields: { key: keyof PlanningCostAnchors; label: string; unit: string }[] = [
		{ key: 'stopCapitalMvr', label: 'One new stop', unit: 'MVR' },
		{ key: 'dieselBusCapitalMvr', label: 'Diesel bus', unit: 'MVR / bus' },
		{ key: 'electricBusCapitalMvr', label: 'Electric bus', unit: 'MVR / bus' },
		{
			key: 'chargingInfrastructureMvr',
			label: 'Charging infrastructure',
			unit: 'MVR / proposal depot'
		},
		{ key: 'dieselOperatingMvrPerKm', label: 'Diesel operations', unit: 'MVR / vehicle-km' },
		{ key: 'electricOperatingMvrPerKm', label: 'Electric operations', unit: 'MVR / vehicle-km' },
		{ key: 'dieselKgCo2ePerKm', label: 'Diesel emissions', unit: 'kg CO₂e / vehicle-km' },
		{ key: 'electricKgCo2ePerKm', label: 'Electric emissions', unit: 'kg CO₂e / vehicle-km' },
		{
			key: 'displacedKgCo2ePerPassengerKm',
			label: 'Displaced private travel',
			unit: 'kg CO₂e / passenger-km'
		}
	];
	const energyFields: {
		key:
			| 'dieselLitresPerVehicleKm'
			| 'dieselKgCo2ePerLitre'
			| 'electricKwhPerVehicleKm'
			| 'gridKgCo2ePerKwh';
		label: string;
		unit: string;
		value: NumericRange;
	}[] = [
		{
			key: 'dieselLitresPerVehicleKm',
			label: 'Bus diesel use',
			unit: 'litres / vehicle-km',
			value: { low: 0.25, central: 0.32, high: 0.4 }
		},
		{
			key: 'dieselKgCo2ePerLitre',
			label: 'Diesel carbon factor',
			unit: 'kg CO₂e / litre',
			value: { low: 2.65, central: 2.68, high: 2.72 }
		},
		{
			key: 'electricKwhPerVehicleKm',
			label: 'Electric bus consumption',
			unit: 'kWh / vehicle-km',
			value: { low: 0.8, central: 1.1, high: 1.5 }
		},
		{
			key: 'gridKgCo2ePerKwh',
			label: 'Charging electricity factor',
			unit: 'kg CO₂e / kWh · unverified local grid',
			value: { low: 0.4, central: 0.6, high: 0.72 }
		}
	];
	const views = [
		{ id: 'people', label: 'People' },
		{ id: 'access', label: 'Journey times' },
		{ id: 'impact', label: 'What changed' }
	];
	const viewExplanation = $derived.by(() =>
		view === 'people'
			? 'People: where residents live'
			: view === 'access'
				? 'Access: how long it takes to reach your destination'
				: `Impact: ${impactCumulative ? 'whole proposal vs current network' : 'this change vs your previous plan'}`
	);
	const hasProposal = $derived(
		scenario.actions.length > 0 || !!scenario.assumptions.disruptions?.length
	);
	// Match the published map, including its recalculation animation, instead of announcing an early result.
	const journeyChanges = $derived.by(() =>
		summarizeJourneyChanges(impactMapAnalysis?.origins ?? [])
	);
	const changedExamples = $derived(journeyChanges.improvedOrigins.slice(0, 3));
	const hasJourneyChanges = $derived(
		journeyChanges.improvedPopulation > 0 || journeyChanges.worsenedPopulation > 0
	);
	const tourSteps = [
		{
			title: '1. Find a transport gap',
			detail:
				'Select one of the priority areas, or any colored area on the map. The journey shows the gap against your access target.'
		},
		{
			title: '2. Try an investment',
			detail:
				'Choose Build to propose a bus connection, or select a service to adjust it. Results update as you edit; Undo restores the last change.'
		},
		{
			title: '3. Read the tradeoff',
			detail:
				'Review who benefits, who is worse off and what remains unknown. Open Details for assumptions; exports are under Map tools.'
		}
	];
	const shown = $derived(preview ?? analysis);
	const unpricedChange = $derived(
		scenario.actions.some((action) => action.kind === 'shift-timetable') ||
			!!scenario.assumptions.disruptions?.length
	);
	const costUnavailable = $derived(
		unpricedChange ||
			(!!shown && (shown.costs.capitalMvr == null || shown.costs.annualOperatingMvr == null))
	);
	const costUnavailableReasons = $derived([
		...(unpricedChange
			? [
					'Costs of implementing timetable changes or road interventions are not estimated. Operator and engineering review is required.'
				]
			: []),
		...new Set(
			(shown?.costs.unavailableReasons ?? []).map((reason) => reason.trim()).filter(Boolean)
		)
	]);
	const carbonUnavailableReasons = $derived([
		...new Set(
			(shown?.carbon.unavailableReasons ?? []).map((reason) => reason.trim()).filter(Boolean)
		)
	]);
	const selectedOrigin = $derived(baseline.origins.find((origin) => origin.id === selectedId));
	const selectedResult = $derived.by(() =>
		analysisFailed
			? undefined
			: impactMapAnalysis?.origins.find((origin) => origin.originId === selectedId)
	);
	const focusJourney = $derived(context === 'area' || context === 'build' ? selectedResult : null);
	const priorities = $derived(
		priorityAreas(baseline, analysis, scenario.assumptions.targetMinutes)
	);
	const selectedArea = $derived(priorities.find((area) => area.originId === selectedId));
	const destination = $derived(
		(shown?.world.facilities ?? baseline.facilities).find(
			(facility) => facility.id === selectedResult?.after.destinationId
		)
	);
	const activePatterns = $derived(
		analysis?.world.patterns.filter(
			(pattern) => pattern.mode === 'bus' && pattern.enabled !== false
		) ?? []
	);
	let patternId = $state('');
	const selectedPattern = $derived(activePatterns.find((pattern) => pattern.id === patternId));
	const playbackPatterns = $derived(
		analysis?.world.patterns.filter((p) => p.enabled !== false) ?? []
	);
	const playbackPattern = $derived(
		playbackPatterns.find((p) => p.id === playbackPatternId) ??
			selectedPattern ??
			playbackPatterns[0]
	);
	const roadConditions = $derived(planningRoadFeatures(baseline, scenario.assumptions));
	const planningTime = $derived(
		Date.parse(`${scenario.assumptions.date}T00:00:00+05:00`) +
			scenario.assumptions.departureMinutes * 60000
	);
	const weatherAreas = $derived<FeatureCollection>({
		type: 'FeatureCollection',
		features: operations
			? activeWeatherAlerts(operations, planningTime)
					.filter((a) => a.geometry)
					.map((a) => ({
						type: 'Feature',
						properties: { id: a.id, name: a.headline },
						geometry: a.geometry!
					}))
			: []
	});
	const selectedStop = $derived(shown?.world.stops.find((stop) => stop.id === selectedStopId));
	const stopConnections = $derived(
		analysis?.world.patterns.filter(
			(pattern) =>
				pattern.mode === 'bus' &&
				pattern.enabled !== false &&
				pattern.stopIds.includes(selectedStopId)
		) ?? []
	);
	const connectedRouteCount = $derived(
		new Set(stopConnections.map((pattern) => pattern.routeId)).size
	);
	const editableBusStop = $derived(
		!!selectedStop &&
			selectedStop.mode !== 'ferry' &&
			!analysis?.world.patterns.some(
				(pattern) => pattern.mode === 'ferry' && pattern.stopIds.includes(selectedStopId)
			)
	);
	const currentReceipt = $derived(
		editReceipt?.actions === scenario.actions && editReceipt.assumptions === scenario.assumptions
			? editReceipt
			: null
	);
	const editingPreview = $derived(!!draft || !!liveActions);
	const impactBefore = $derived(
		wholeProposalImpact ? null : editingPreview ? analysis : (currentReceipt?.before ?? null)
	);
	const comparisonReady = $derived(
		mapShown &&
			!busy &&
			analyzedActions === scenario.actions &&
			analyzedAssumptions === scenario.assumptions &&
			mapShown === shown
	);
	const editComparisons = $derived(
		comparisonReady && impactBefore && mapShown ? compareEditOrigins(impactBefore, mapShown) : null
	);
	const incompatibleComparison = $derived(!!comparisonReady && !!impactBefore && !editComparisons);
	const impactCumulative = $derived(!impactBefore || incompatibleComparison);
	const editImpact = $derived(
		comparisonReady && mapShown
			? summarizeJourneyChanges(editComparisons ?? mapShown.origins)
			: null
	);
	const impactLabel = $derived(
		impactCumulative
			? 'Proposal vs current network'
			: editingPreview
				? 'Preview of this change'
				: (currentReceipt?.label ?? 'Proposal vs current network')
	);
	const impactMapAnalysis = $derived(
		view === 'impact' && mapShown && editComparisons
			? { ...mapShown, origins: editComparisons }
			: mapShown
	);
	const awaitingService = $derived(
		context === 'service' &&
			editableBusStop &&
			!selectedStop?.disabled &&
			stopConnections.length === 0 &&
			!busy
	);
	const impactExamples = $derived(editImpact ? editImpact.improvedOrigins.slice(0, 3) : []);
	function recordEdit(label: string, mutate: () => void) {
		const before =
			analyzedActions === scenario.actions && analyzedAssumptions === scenario.assumptions
				? analysis
				: null;
		mutate();
		editReceipt = { before, actions: scenario.actions, assumptions: scenario.assumptions, label };
		impactExamplesOpen = false;
		wholeProposalImpact = false;
	}
	function beginRouteEdit() {
		closeOperations();
		playbackOpen = false;
		workflowOpen = false;
		cancelDraft();
		context = 'service';
		editMode = true;
		transportExpanded = true;
		selectedStopId = '';
		choosePattern(
			activePatterns.find((pattern) => pattern.id === patternId)?.id ?? activePatterns[0]?.id ?? ''
		);
		const first = analysis?.world.stops.find((stop) => stop.id === selectedPattern?.stopIds[0]);
		if (first) focusCoordinate = coordinate(first);
	}
	function showAffectedAreas() {
		view = 'impact';
		impactExamplesOpen = !impactExamplesOpen;
	}
	function retryAnalysis() {
		initialized = false;
		void tick().then(() => {
			initialized = true;
		});
	}
	const connectionStops = $derived([
		...visibleStops(baseline, analysis, includeUntimedStops).filter(
			(stop) =>
				stop.mode !== 'ferry' &&
				!stop.disabled &&
				!analysis?.world.patterns.some(
					(pattern) => pattern.mode === 'ferry' && pattern.stopIds.includes(stop.id)
				)
		),
		...connectionNewStops
	]);
	const orderedConnectionStops = $derived(
		connectionStopIds.flatMap((id) => {
			const stop = connectionStops.find((entry) => entry.id === id);
			return stop ? [stop] : [];
		})
	);
	const connectionPreview = $derived<FeatureCollection<LineString>>({
		type: 'FeatureCollection',
		features:
			context === 'connect' && draft
				? (draft.kind === 'add-route'
						? [draft.pattern, ...(draft.returnPattern ? [draft.returnPattern] : [])]
						: draft.kind === 'replace-route'
							? draft.patterns
							: []
					).flatMap((pattern) =>
						pattern.geometry && pattern.geometry.length >= 2
							? [
									{
										type: 'Feature' as const,
										properties: { id: pattern.id },
										geometry: { type: 'LineString' as const, coordinates: pattern.geometry }
									}
								]
							: []
					)
				: []
	});
	const connectionPreviewSummary = $derived(
		context === 'connect' && draft
			? `${number(connectionPreview.features.reduce((sum, feature) => sum + ((draft?.kind === 'add-route' ? [draft.pattern, ...(draft.returnPattern ? [draft.returnPattern] : [])] : draft?.kind === 'replace-route' ? draft.patterns : []).find((pattern) => pattern.id === feature.properties?.id)?.distanceM ?? 0), 0) / 1000, 1)} km across both directions · preview shown on the map`
			: ''
	);
	const hasEditableService = $derived(!!selectedStop || !!selectedPattern);
	const servicePending = $derived(
		!!patternId && !activePatterns.some((pattern) => pattern.id === patternId)
	);
	$effect(() => {
		const pattern = selectedPattern;
		if (
			context !== 'service' ||
			gesture ||
			busy ||
			!pattern ||
			!hasEditableService ||
			servicePending
		)
			return;
		if (pattern.timing.kind === 'frequency')
			headway = pattern.timing.windows[0]?.headwayMinutes ?? 15;
		fleet = pattern.fleet === 'electric' ? 'electric' : 'diesel';
	});
	const streets = $derived(streetData(baseline));
	const land = $derived(
		(baseline.landBoundaries ?? baseline.islandBoundaries ?? emptyLand) as FeatureCollection
	);
	const buildings = $derived(baseline.buildings as FeatureCollection);
	const visualGrid = $derived(honeycombGrid(baseline));
	const areas = $derived(
		honeycombAreas(
			baseline,
			impactMapAnalysis,
			scenario.assumptions.populationYear,
			scenario.assumptions.targetMinutes
		)
	);
	const selectedHex = $derived(
		selectedCellId
			? areas.features.find((cell) => cell.properties.id === selectedCellId)?.properties
			: null
	);
	const selectedMapId = $derived(
		selectedCellId ||
			(selectedOrigin
				? `${selectedOrigin.islandId}:${latLngToCell(selectedOrigin.lat, selectedOrigin.lon, HONEYCOMB_RESOLUTION)}`
				: '')
	);
	const selectedResidents = $derived(
		selectedHex?.population ?? selectedArea?.residents ?? selectedResult?.population
	);
	const selectedAccessLabel = $derived.by(() => {
		const target = scenario.assumptions.targetMinutes;
		const goal = scenario.assumptions.goal === 'healthcare' ? 'care' : 'school';
		if (selectedHex?.status === 'mixed') {
			const within = selectedHex.statusPopulation.reachable + selectedHex.statusPopulation.gained;
			return `${number((within / selectedHex.population) * 100)}% within ${target} min${selectedHex.statusPopulation.unknown > 0 ? ' · partial data' : ''}`;
		}
		if (selectedHex?.status === 'unknown') return 'Access data incomplete';
		if (selectedHex?.status === 'reachable' || selectedHex?.status === 'gained')
			return `${goal === 'care' ? 'Care' : 'School'} within ${target} min`;
		if (selectedHex?.status === 'gap' || selectedHex?.status === 'lost')
			return `Outside ${target} min access to ${goal}`;
		if (selectedResult?.after.status === 'unavailable') return 'Access data incomplete';
		if (selectedResult?.after.minutes == null) return 'No journey found';
		return selectedResult.after.minutes > target
			? `Over ${target} min from ${goal}`
			: `${goal === 'care' ? 'Care' : 'School'} within ${target} min`;
	});
	const journeyLegend = $derived(
		TRAVEL_TIME_BANDS.filter(
			(band) =>
				['five', 'ten', 'fifteen', 'thirty', 'over-thirty'].includes(band.id) ||
				areas.features.some(
					(cell) => cell.properties.population > 0 && cell.properties.journeyTimeBand === band.id
				)
		)
	);
	const mapRoutes = $derived(routeData(mapShown));
	const draftStopIds = $derived(
		draft?.kind === 'add-route'
			? (draft.stops ?? []).map((stop) => stop.id)
			: draft?.kind === 'replace-route'
				? (draft.stops ?? []).map((stop) => stop.id)
				: draft?.kind === 'add-stop' || draft?.kind === 'extend-route'
					? [draft.stop.id]
					: []
	);
	const symbols = $derived(
		symbolData(
			baseline,
			mapShown
				? {
						world: {
							...mapShown.world,
							stops: [
								...mapShown.world.stops,
								...connectionNewStops.filter(
									(stop) => !mapShown?.world.stops.some((entry) => entry.id === stop.id)
								)
							]
						}
					}
				: null,
			scenario.assumptions.goal,
			includeUntimedStops,
			{
				assumptions: scenario.assumptions,
				draftStopIds: [...draftStopIds, ...connectionNewStops.map((stop) => stop.id)],
				draftFacilityIds: draft?.kind === 'add-facility' ? [draft.facility.id] : []
			}
		)
	);
	const selectedStopMarker = $derived(
		symbols.features.find((feature) =>
			(feature.properties?.stopIds as string[] | undefined)?.includes(selectedStopId)
		)?.properties
	);
	const hasProposedAssets = $derived(
		symbols.features.some((feature) =>
			['proposed', 'draft'].includes(String(feature.properties?.investmentState))
		)
	);
	const stopCounts = $derived(stopCoverage(baseline));
	const reviewedStops = $derived(visibleStops(baseline, analysis, includeUntimedStops));
	const healthcareInventory = $derived(
		baseline.facilities.filter((f) => f.kind === 'hospital' || f.kind === 'clinic')
	);
	const eligibleHealthcare = $derived(
		healthcareInventory.filter((f) => isEligibleFacility(f, 'healthcare'))
	);
	const educationInventory = $derived(
		baseline.facilities.filter((f) => f.kind === 'school' || f.kind === 'college')
	);
	const eligibleDestinations = $derived(
		baseline.facilities.filter(
			(f) => getFacilityEligibility(f, scenario.assumptions).status === 'eligible'
		)
	);
	const destinationScope = $derived(
		scenario.assumptions.goal === 'healthcare'
			? `${scenario.assumptions.destinationRequirements?.healthcareService ?? 'general'} healthcare`
			: `${scenario.assumptions.destinationRequirements?.schoolLevel ?? 'all levels'} schools`
	);
	const requirementsFiltered = $derived(
		(scenario.assumptions.goal === 'healthcare' &&
			!!scenario.assumptions.destinationRequirements?.healthcareService &&
			scenario.assumptions.destinationRequirements.healthcareService !== 'general') ||
			(scenario.assumptions.goal === 'education' &&
				!!scenario.assumptions.destinationRequirements?.schoolLevel) ||
			scenario.assumptions.destinationRequirements?.publicAccess === 'public' ||
			!!scenario.assumptions.destinationRequirements?.requireOpenAtDeparture ||
			!!scenario.assumptions.walkingRequirements?.requireAuditedWheelchair
	);
	const policyDelivery = $derived(
		scenario.assumptions.policyDelivery ?? {
			responsibleAgency: 'To be confirmed with the operator and relevant council',
			phases: [
				'Verify the site, service calendar and local costs',
				'Pilot the service and collect boarding and journey data',
				'Review access, operations and emissions before expansion'
			],
			outstandingVerification: [
				'Complete service calendars',
				'Entrances, crossings and boarding access',
				'Local operating costs, staffing, capacity and land permissions'
			]
		}
	);
	const journey = $derived(
		journeyData(
			baseline,
			mapShown,
			selectedOrigin,
			mapShown?.origins.find((origin) => origin.originId === selectedId)?.after
		)
	);
	const ribbonLegs = $derived(
		selectedResult?.after.path.flatMap((leg) => [
			...(leg.waitMinutes > 0
				? [
						{
							mode: 'wait' as const,
							minutes: leg.waitMinutes,
							label: leg.patternId ? 'Expected / scheduled wait' : 'Wait'
						}
					]
				: []),
			{
				mode: leg.mode,
				minutes: leg.minutes,
				label:
					leg.mode === 'walk'
						? 'Along the walking network'
						: (shown?.world.patterns.find((pattern) => pattern.id === leg.patternId)?.name ??
							leg.mode)
			}
		]) ?? []
	);
	const breakEvenTrips = $derived(
		shown?.carbon.breakEvenDisplacedPassengerKm == null
			? null
			: shown.carbon.breakEvenDisplacedPassengerKm /
					scenario.assumptions.annualOperatingDays /
					privateDistanceKm /
					privateOccupancy
	);
	const sourceEvidence = $derived([
		...baseline.sources
			.filter(
				(source) =>
					source.id ===
						(scenario.assumptions.goal === 'education' ? 'education-schools' : 'health-registry') ||
					['mbs-island-projections', 'worldpop2026', 'osm-geofabrik', 'rtl-bus-routes'].includes(
						source.id
					) ||
					eligibleDestinations.some((facility) =>
						[...(facility.sourceIds ?? []), ...(facility.statusSourceIds ?? [])].includes(source.id)
					) ||
					(shown?.world.patterns ?? []).some((pattern) => pattern.sourceIds.includes(source.id))
			)
			.sort((left, right) => {
				const order = [
					scenario.assumptions.goal === 'education' ? 'education-schools' : 'health-registry',
					'rtl-bus-routes',
					'mbs-island-projections',
					'osm-geofabrik',
					'worldpop2026'
				];
				const rank = (id: string) => {
					const index = order.indexOf(id);
					return index < 0 ? order.length : index;
				};
				return rank(left.id) - rank(right.id);
			})
			.map((source) => ({
				name: source.title ?? source.id,
				date: String(source.referencePeriod ?? source.referenceDate ?? ''),
				status: String(source.status ?? 'Public snapshot'),
				url: source.url
			})),
		...(baseline.facilityAuditVersion
			? [
					{
						name: 'Ministry of Health · reviewed healthcare locations',
						date: healthcareInventory[0]?.statusReviewedAt ?? '',
						status: `${eligibleHealthcare.length} general-care locations included; closed and uncertain records excluded`,
						url: 'https://hems.health.gov.mv/establishments'
					}
				]
			: []),
		...(policyEvidence?.sources ?? [])
			.filter(
				(source) =>
					source.id.includes('school') ||
					enabledPolicyLayers.some((id) =>
						policyEvidence?.layers.find((layer) => layer.id === id)?.sourceIds.includes(source.id)
					)
			)
			.map((source) => ({
				name: source.title,
				date: source.referencePeriod,
				status: 'Supporting context',
				url: source.url
			}))
	]);
	function setHousingDistribution() {
		if (!selectedOrigin) return;
		const island = baseline.islands.find((item) => item.id === selectedOrigin.islandId);
		if (island?.population2030 == null && island?.projection2030Population == null) {
			notice =
				'This island has no verified 2030 total. A housing distribution cannot be estimated.';
			return;
		}
		const originIds = baseline.origins
			.filter(
				(origin) =>
					origin.islandId === selectedOrigin.islandId && distanceM(origin, selectedOrigin) <= 500
			)
			.map((origin) => origin.id);
		if (
			originIds.length ===
			baseline.origins.filter((origin) => origin.islandId === selectedOrigin.islandId).length
		) {
			notice =
				'The selected radius covers the whole island; there is no separate area to redistribute from.';
			return;
		}
		patchAssumptions({
			populationYear: 2030,
			housingDistribution: [
				...(scenario.assumptions.housingDistribution ?? []).filter(
					(item) => item.islandId !== selectedOrigin.islandId
				),
				{
					islandId: selectedOrigin.islandId,
					originIds,
					share: Math.max(0, Math.min(100, housingShare)) / 100
				}
			]
		});
		notice = 'Conditional housing distribution applied. The official island total is conserved.';
	}
	async function togglePolicyLayer(id: string, enabled: boolean) {
		enabledPolicyLayers = enabled
			? [...new Set([...enabledPolicyLayers, id])]
			: enabledPolicyLayers.filter((entry) => entry !== id);
		const layer = policyEvidence?.layers.find((item) => item.id === id);
		if (!enabled || !layer || policyGeometry[id] || layer.features.features.length) return;
		notice = `Loading ${layer.title} from the local snapshot…`;
		try {
			const response = await fetch(`/api/policy-evidence?layer=${encodeURIComponent(id)}`);
			if (!response.ok) throw new Error('Local layer unavailable');
			const snapshot = await response.json();
			if (
				snapshot.version !== policyEvidence?.version ||
				snapshot.layer?.id !== id ||
				snapshot.layer?.features?.type !== 'FeatureCollection'
			)
				throw new Error('Dataset version mismatch');
			policyGeometry = { ...policyGeometry, [id]: snapshot.layer.features };
			notice = `${layer.title} loaded. These records support site investigation; they do not establish a usable route.`;
		} catch (error) {
			enabledPolicyLayers = enabledPolicyLayers.filter((entry) => entry !== id);
			notice = `Layer unavailable: ${String(error)}. Planning results are unchanged.`;
		}
	}
	function describeAction(action: PlanningAction): string {
		const route =
			'patternId' in action
				? (analysis?.world.patterns.find((pattern) => pattern.id === action.patternId)?.name ??
					action.patternId)
				: '';
		const stop =
			'stopId' in action
				? (analysis?.world.stops.find((entry) => entry.id === action.stopId)?.name ?? action.stopId)
				: '';
		switch (action.kind) {
			case 'add-route': {
				const timing = action.pattern.timing;
				const window = timing.kind === 'frequency' ? timing.windows[0] : null;
				if (action.pattern.mode === 'ferry') {
					const minutes =
						timing.kind === 'frequency'
							? timing.segmentMinutes?.reduce((sum, value) => sum + value, 0)
							: undefined;
					return `${action.pattern.name}: ${minutes == null ? 'crossing time unavailable' : `${number(minutes, 1)}-minute assumed crossing`}; published day-specific frequency intervals; mapped crossing distance, vessel costs and energy factors unavailable.`;
				}
				const distance =
					action.pattern.distanceM != null && action.returnPattern?.distanceM != null
						? `${number((action.pattern.distanceM + action.returnPattern.distanceM) / 1000, 1)} km round trip`
						: 'round-trip distance unavailable';
				return `${action.pattern.name}: ${distance}, ${action.pattern.fleet ?? 'diesel'} fleet${window ? `, every ${window.headwayMinutes} minutes, ${timeLabel(window.startMinutes)}–${timeLabel(window.endMinutes)} MVT` : ', published departures'}.`;
			}
			case 'extend-route':
				return `Extend ${route} to ${action.stop.name}: ${number((action.distanceM + (action.returnDistanceM ?? 0)) / 1000, 1)} additional round-trip km.`;
			case 'replace-route':
				return `Reconnect ${route}: ${action.patterns.length} directions routed on roads with proposed service timing.`;
			case 'shift-timetable':
				return action.minutes === 0
					? `${route}: retain current departure times.`
					: `${route}: departures ${Math.abs(action.minutes)} minutes ${action.minutes < 0 ? 'earlier' : 'later'}; running time and stop dwell are unchanged.`;
			case 'set-frequency':
				return `${route}: departures every ${action.headwayMinutes} minutes.`;
			case 'set-hours':
				return `${route}: operate ${timeLabel(action.startMinutes)}–${timeLabel(action.endMinutes)} MVT.`;
			case 'set-fleet':
				return `${route}: use an ${action.fleet === 'electric' ? 'electric' : 'internal-combustion diesel'} fleet.`;
			case 'add-stop':
				return `Add ${action.stop.name}; transit benefits require an active service.`;
			case 'add-facility':
				return `${action.facility.name}: proposed ${action.facility.kind}, assumed open from ${action.facility.proposedOpeningDate}. Capacity, service hours and facility costs are not supplied.`;
			case 'move-stop':
				return `Move ${stop} to ${action.position.lat.toFixed(5)}, ${action.position.lon.toFixed(5)}; recheck route timing.`;
			case 'disable-stop':
				return `Close ${stop} to boarding.`;
			case 'enable-stop':
				return `Reopen ${stop} to boarding.`;
			case 'disable-service':
				return `Pause ${route}.`;
			case 'enable-service':
				return `Resume ${route}.`;
		}
	}

	function applyAssumptionPreset() {
		const defaults = createDefaultAssumptions(baseline);
		scenario.setAssumptions({
			...defaults,
			costs: assumptionsEnabled
				? { ...illustrativeCosts, ...baseline.costAnchors }
				: { ...baseline.costAnchors },
			displacedPassengerKm: {
				low:
					dailyPrivateTrips.low *
					privateDistanceKm *
					privateOccupancy *
					defaults.annualOperatingDays,
				central:
					dailyPrivateTrips.central *
					privateDistanceKm *
					privateOccupancy *
					defaults.annualOperatingDays,
				high:
					dailyPrivateTrips.high *
					privateDistanceKm *
					privateOccupancy *
					defaults.annualOperatingDays
			},
			privateTravelInputs: {
				dailyTrips: { ...dailyPrivateTrips },
				distanceKm: privateDistanceKm,
				occupancy: privateOccupancy
			},
			...(assumptionsEnabled
				? Object.fromEntries(energyFields.map((field) => [field.key, field.value]))
				: {})
		});
	}
	onMount(() => {
		try {
			const savedOpacity = window.localStorage.getItem(overlayOpacityKey);
			if (savedOpacity?.trim()) setOverlayOpacity(Number(savedOpacity));
		} catch {
			// Map appearance remains usable when browser storage is unavailable.
		}
		opacityPreferenceReady = true;
		const narrowScreen = window.matchMedia('(max-width: 680px), (max-height: 600px)');
		const mobileScreen = window.matchMedia('(max-width: 680px)');
		const syncMobile = () => {
			isMobile = mobileScreen.matches;
			workflowOpen = false;
			legendOpen = !isMobile;
			if (!isMobile && drawer?.startsWith('mobile-')) closeOverlay();
		};
		syncMobile();
		mobileScreen.addEventListener('change', syncMobile);
		const toolbarObserver = new ResizeObserver(() => {
			mapControlsHeight = Math.ceil(mapToolbar.getBoundingClientRect().height);
			outcomeHeight = Math.ceil(outcomeDock.getBoundingClientRect().height);
		});
		toolbarObserver.observe(mapToolbar);
		toolbarObserver.observe(outcomeDock);
		const collapseSuggestions = () => {
			if (narrowScreen.matches) {
				areasExpanded = false;
				tour = -1;
			}
		};
		collapseSuggestions();
		narrowScreen.addEventListener('change', collapseSuggestions);
		client = new AnalysisWorkerClient(baseline);
		returnClient = new ReturnJourneyWorkerClient(baseline);
		scheduler = new LiveAnalysisScheduler(client);
		applyAssumptionPreset();
		// Capture the fresh-session preset before loading any locally saved proposal.
		startingAssumptions = structuredClone(scenario.assumptions);
		try {
			const restored = scenario.load();
			if (!restored.ok && restored.reason !== 'No saved scenario exists.') notice = restored.reason;
			if (restored.ok) syncPrivateInputs();
		} catch (error) {
			notice = `Saved proposal could not be loaded: ${String(error)}`;
		}
		scenario.clearHistory();
		initialized = true;
		return () => {
			requestId += 1;
			pendingMapResult = null;
			wave = null;
			toolbarObserver.disconnect();
			mobileScreen.removeEventListener('change', syncMobile);
			narrowScreen.removeEventListener('change', collapseSuggestions);
			clearTimeout(stopPreviewTimer);
			scheduler?.dispose();
			client?.dispose();
			returnClient?.dispose();
		};
	});
	$effect(() => {
		if (!opacityPreferenceReady) return;
		try {
			window.localStorage.setItem(overlayOpacityKey, String(overlayOpacity));
		} catch {
			// Changing the overlay does not depend on saving a preference.
		}
	});
	$effect(() => {
		const key = `${selectedId}:${analysis?.versionPins.model}:${scenario.actions.length}:${scenario.assumptions.date}:${scenario.assumptions.departureMinutes}`;
		const current = analysis;
		if (returnOpen && current && key)
			untrack(() => {
				appointmentResult = null;
				departureScan = null;
				void evaluateReturn();
			});
		else
			untrack(() => {
				appointmentResult = null;
				departureScan = null;
				returnRequest++;
				appointmentBusy = false;
			});
	});
	$effect(() => {
		if (!initialized) return;
		const actions = scenario.actions;
		const assumptions = scenario.assumptions;
		const candidate = draft;
		const candidateActions = liveActions;
		const id = ++requestId;
		busy = true;
		analysisFailed = false;
		const start = performance.now();
		untrack(() => {
			const seeds = lastWaveActions
				? [
						...waveTriggerCoordinates(baseline, lastWaveActions, actions, analysis?.world),
						...roadWaveTriggerCoordinates(baseline, lastWaveDisruptions, assumptions.disruptions)
					]
				: [];
			lastWaveActions = structuredClone(actions);
			lastWaveDisruptions = structuredClone(assumptions.disruptions);
			pendingMapResult = null;
			if (seeds.length) {
				wave = continueWave(wave, id, buildWaveCells(visualGrid, seeds), start);
			} else if (wave) {
				// A newer preview or assumption can supersede the worker without
				// restarting the flood. Only the latest matching result may release it.
				wave = { ...wave, id, completedAt: null, outcome: undefined };
			}
		});
		void (async () => {
			try {
				const result = await scheduler!.analyze(
					actions,
					assumptions,
					candidate,
					candidateActions ?? undefined
				);
				if (
					id !== requestId ||
					actions !== scenario.actions ||
					assumptions !== scenario.assumptions ||
					candidate !== draft ||
					candidateActions !== liveActions
				)
					return;
				analysis = result.analysis;
				analyzedActions = actions;
				analyzedAssumptions = assumptions;
				preview = result.preview;
				if (wave?.id === id) {
					pendingMapResult = { id, result: result.preview ?? result.analysis };
					wave = { ...wave, completedAt: performance.now(), outcome: 'success' };
				} else {
					mapShown = result.preview ?? result.analysis;
					busy = false;
				}
				// Only this completed action history may retire selections. A newly-added service
				// still awaiting its own worker result must retain its pending selection.
				if (
					patternId &&
					!result.analysis.world.patterns.some(
						(pattern) => pattern.id === patternId && pattern.enabled !== false
					)
				)
					patternId = '';
				if (
					selectedStopId &&
					!result.analysis.world.stops.some((stop) => stop.id === selectedStopId)
				)
					selectedStopId = '';
				if (context === 'service' && !patternId && !selectedStopId) {
					context = null;
					editMode = false;
				}
				analysisMs = performance.now() - start;
				if (!selectedId) {
					selectedId =
						priorityAreas(baseline, result.analysis, assumptions.targetMinutes)[0]?.originId ??
						baseline.origins[0]?.id ??
						'';
				}
				const saved = scenario.save();
				savedOnDevice = saved.ok;
				if (!saved.ok) notice = saved.reason;
			} catch (error) {
				if (id === requestId) {
					analysisFailed = true;
					pendingMapResult = null;
					if (wave?.id === id) wave = { ...wave, completedAt: performance.now(), outcome: 'error' };
					else busy = false;
					notice = `Analysis unavailable: ${String(error)}`;
				}
			}
		})();
	});
	function finishWave(id: number, outcome: 'success' | 'error') {
		if (wave?.id !== id || id !== requestId || wave.completedAt === null) return;
		if (outcome === 'success' && pendingMapResult?.id === id) mapShown = pendingMapResult.result;
		pendingMapResult = null;
		wave = null;
		busy = false;
	}
	function selectOrigin(id: string, focus = false, cellId = '') {
		closeOperations();
		playbackOpen = false;
		workflowOpen = false;
		if (drawer === 'mobile-areas') closeOverlay();
		mobileDetailExpanded = false;
		cancelDraft();
		context = 'area';
		editMode = false;
		areasExpanded = false;
		selectedId = id;
		selectedCellId = cellId;
		selectedStopId = '';
		if (focus || isMobile) {
			const origin = baseline.origins.find((o) => o.id === id);
			if (origin) focusCoordinate = coordinate(origin);
		}
		if (tour === 0) tour = 1;
	}
	function patchAssumptions(patch: Partial<PlanningAssumptions>) {
		cancelDraft();
		if (patch.targetMinutes)
			patch.maxJourneyMinutes = Math.max(
				scenario.assumptions.maxJourneyMinutes,
				patch.targetMinutes
			);
		if (patch.annualOperatingDays) {
			patch.privateTravelInputs = {
				dailyTrips: { ...dailyPrivateTrips },
				distanceKm: privateDistanceKm,
				occupancy: privateOccupancy
			};
			patch.displacedPassengerKm = {
				low:
					dailyPrivateTrips.low * privateDistanceKm * privateOccupancy * patch.annualOperatingDays,
				central:
					dailyPrivateTrips.central *
					privateDistanceKm *
					privateOccupancy *
					patch.annualOperatingDays,
				high:
					dailyPrivateTrips.high * privateDistanceKm * privateOccupancy * patch.annualOperatingDays
			};
		}
		scenario.setAssumptions(patch);
	}
	function syncPrivateInputs() {
		assumptionsEnabled = energyFields.some((field) => scenario.assumptions[field.key] != null);
		const inputs = scenario.assumptions.privateTravelInputs;
		privateDistanceKm = inputs?.distanceKm ?? 4;
		privateOccupancy = inputs?.occupancy ?? 1.3;
		if (inputs) {
			dailyPrivateTrips = { ...inputs.dailyTrips };
			return;
		}
		const divisor = privateDistanceKm * privateOccupancy * scenario.assumptions.annualOperatingDays;
		dailyPrivateTrips = {
			low: scenario.assumptions.displacedPassengerKm.low / divisor,
			central: scenario.assumptions.displacedPassengerKm.central / divisor,
			high: scenario.assumptions.displacedPassengerKm.high / divisor
		};
	}
	function placeOnMap(position: [number, number]) {
		if (movingStopId) {
			commitStopMove(movingStopId, position);
			return;
		}
		addBus(position);
	}
	function selectStop(id: string, resetDraft = true) {
		transportExpanded = true;
		legendOpen = false;
		closeOperations();
		playbackOpen = false;
		workflowOpen = false;
		if (resetDraft) cancelDraft();
		mobileDetailExpanded = false;
		context = 'service';
		editMode = true;
		areasExpanded = false;
		selectedStopId = id;
		const patterns = shown?.world.patterns.filter(
			(pattern) => pattern.stopIds.includes(id) && pattern.enabled !== false
		);
		const pattern = patterns?.find((pattern) => pattern.provenance === 'assumed') ?? patterns?.[0];
		patternId = pattern?.id ?? '';
		if (pattern) choosePattern(pattern.id);
	}
	function selectRoute(id: string) {
		transportExpanded = true;
		legendOpen = false;
		closeOperations();
		playbackOpen = false;
		workflowOpen = false;
		mobileDetailExpanded = true;
		cancelDraft();
		selectedStopId = '';
		context = 'service';
		editMode = true;
		areasExpanded = false;
		choosePattern(id);
	}
	function choosePattern(id: string) {
		patternId = id;
		const pattern = shown?.world.patterns.find((entry) => entry.id === id);
		if (pattern?.timing.kind === 'frequency')
			headway = pattern.timing.windows[0]?.headwayMinutes ?? 15;
		fleet = pattern?.fleet === 'electric' ? 'electric' : 'diesel';
	}
	function dismissContext() {
		if (isMobile && context) {
			focusCoordinate = null;
			void tick().then(() =>
				document.querySelector<HTMLElement>('.workflow-toggle')?.focus({ preventScroll: true })
			);
		}
		cancelDraft();
		context = null;
		editMode = false;
		selectedStopId = '';
	}
	function beginBuild(mode: BuildMode = 'destination') {
		transportExpanded = true;
		legendOpen = false;
		closeOperations();
		playbackOpen = false;
		workflowOpen = false;
		mobileDetailExpanded = false;
		cancelDraft();
		context = 'build';
		editMode = true;
		areasExpanded = false;
		selectedStopId = '';
		setBuildMode(mode);
		if (mode === 'destination' && selectedOrigin) focusCoordinate = coordinate(selectedOrigin);
	}
	function setBuildMode(mode: BuildMode) {
		cancelDraft();
		buildMode = mode;
		placing = true;
		if (
			(mode === 'clinic' || mode === 'school') &&
			scenario.assumptions.goal !== (mode === 'clinic' ? 'healthcare' : 'education')
		)
			scenario.setAssumptions({
				...scenario.assumptions,
				goal: mode === 'clinic' ? 'healthcare' : 'education'
			});
		placementReason =
			mode === 'clinic' || mode === 'school'
				? 'Choose a location near a walking path for this proposed destination.'
				: mode === 'stop'
					? 'Choose a road for the new stop. Connect it when you are ready.'
					: 'Move the pointer to a street to preview a connection.';
	}
	function buildProposal(position?: [number, number]) {
		const common = { actions: scenario.actions, assumptions: scenario.assumptions };
		if (buildMode === 'clinic' || buildMode === 'school')
			return position
				? createFacilityProposal(baseline, { ...common, coordinate: position, kind: buildMode })
				: { ok: false as const, reason: 'Choose a location on the map first.' };
		if (buildMode === 'stop')
			return position
				? createBusStopProposal(baseline, { ...common, coordinate: position })
				: { ok: false as const, reason: 'Choose a road on the map first.' };
		return createBusProposal(baseline, {
			...common,
			originId: selectedId,
			coordinate: position,
			patternId: coveragePatternId || undefined,
			headwayMinutes: headway,
			fleet,
			goal: scenario.assumptions.goal
		});
	}
	function suggestedInsertionPattern(stopId: string) {
		const islandId = connectionStops.find((stop) => stop.id === stopId)?.islandId;
		const candidates = activePatterns.filter(
			(pattern) => !pattern.stopIds.includes(stopId) && !pattern.runtimeUnavailableReason
		);
		return (
			candidates.find((pattern) =>
				pattern.stopIds.some(
					(id) => connectionStops.find((stop) => stop.id === id)?.islandId === islandId
				)
			)?.id ??
			candidates[0]?.id ??
			''
		);
	}
	function beginConnection(stopId = '', mode: 'new' | 'insert' = 'new') {
		transportExpanded = true;
		legendOpen = false;
		closeOperations();
		playbackOpen = false;
		workflowOpen = false;
		cancelDraft();
		context = 'connect';
		editMode = true;
		areasExpanded = false;
		connectionMode = mode;
		connectionStopIds = stopId ? [stopId] : [];
		connectionPatternId = mode === 'insert' ? suggestedInsertionPattern(stopId) : '';
		connectionAfterId =
			activePatterns.find((pattern) => pattern.id === connectionPatternId)?.stopIds.at(-1) ?? '';
		headway = 15;
		fleet = 'diesel';
		mobileDetailExpanded = false;
		const stop = connectionStops.find((entry) => entry.id === stopId);
		if (stop) focusCoordinate = coordinate(stop);
		refreshConnection();
	}
	function refreshConnection() {
		if (context !== 'connect') return;
		const options = {
			actions: scenario.actions,
			assumptions: scenario.assumptions,
			stops: connectionNewStops,
			headwayMinutes: headway,
			fleet
		};
		const result =
			connectionMode === 'new'
				? createBusConnection(baseline, { ...options, stopIds: connectionStopIds })
				: createStopInsertion(baseline, {
						...options,
						headwayMinutes:
							activePatterns.find((pattern) => pattern.id === connectionPatternId)?.timing.kind ===
							'scheduled'
								? headway
								: undefined,
						stopId: connectionStopIds[0] ?? '',
						patternId: connectionPatternId,
						afterStopId: connectionAfterId
					});
		draft = result.ok ? result.action : null;
		preview = null;
		connectionReason = result.ok
			? 'Road-routed connection ready. Review the result preview, then apply.'
			: result.reason;
	}
	function pickConnectionStop(id: string) {
		if (connectionStopIds.includes(id)) {
			connectionReason = 'This stop is already in the connection. Reorder it in the stop list.';
			return;
		}
		if (connectionStopIds.length === 0) {
			const stop = connectionStops.find((entry) => entry.id === id);
			if (stop) focusCoordinate = coordinate(stop);
		}
		if (connectionMode === 'insert') {
			connectionStopIds = [id];
			connectionNewStops = connectionNewStops.filter((stop) => stop.id === id);
		} else connectionStopIds = [...connectionStopIds, id];
		refreshConnection();
	}
	function placeConnectionStop(position: [number, number]) {
		const result = createBusStopProposal(baseline, {
			coordinate: position,
			actions: [
				...scenario.actions,
				...connectionNewStops.map((stop) => ({ kind: 'add-stop' as const, stop }))
			],
			assumptions: scenario.assumptions,
			name: `Proposed stop ${connectionNewStops.length + 1}`
		});
		if (!result.ok || result.action.kind !== 'add-stop') {
			connectionReason = result.ok ? 'Choose another position for the stop.' : result.reason;
			notice = connectionReason;
			return;
		}
		notice = '';
		const stop = result.action.stop;
		connectionNewStops = connectionMode === 'insert' ? [stop] : [...connectionNewStops, stop];
		pickConnectionStop(stop.id);
	}
	function removeConnectionStop(id: string) {
		connectionStopIds = connectionStopIds.filter((entry) => entry !== id);
		connectionNewStops = connectionNewStops.filter((stop) => stop.id !== id);
		refreshConnection();
	}
	function reorderConnectionStop(id: string, direction: -1 | 1) {
		const index = connectionStopIds.indexOf(id);
		const next = index + direction;
		if (index < 0 || next < 0 || next >= connectionStopIds.length) return;
		const ids = [...connectionStopIds];
		[ids[index], ids[next]] = [ids[next], ids[index]];
		connectionStopIds = ids;
		refreshConnection();
	}
	function applyConnection() {
		if (busy || !draft || context !== 'connect') return;
		const action = draft;
		const stopId = connectionStopIds[0] ?? '';
		cancelDraft();
		recordEdit(action.kind === 'replace-route' ? 'Route updated' : 'Route added', () =>
			scenario.addAction(action)
		);
		revealProposalChanges();
		busy = true;
		context = 'service';
		transportExpanded = false;
		selectedStopId = stopId;
		patternId =
			action.kind === 'add-route'
				? action.pattern.id
				: action.kind === 'replace-route'
					? action.patternId
					: '';
		mobileDetailExpanded = true;
		notice = 'Connection applied to your proposal. Undo restores the previous network.';
	}
	function beginStopMove(id: string) {
		cancelDraft();
		selectStop(id);
		movingStopId = id;
		gesture = 'stop';
		placing = true;
		focusCoordinate = coordinate(
			analysis?.world.stops.find((stop) => stop.id === id) ?? selectedStop!
		);
		notice = keepStopConnections
			? 'Choose a road. Connected bus routes will follow, using proposed travel times.'
			: 'Choose a road. Affected published services will need a timing review.';
	}
	function previewPlacement(position: [number, number]) {
		if (!placing) return;
		if (movingStopId) {
			previewStopMove(movingStopId, position);
			return;
		}
		pendingPlacement = position;
		if (placementTimer) return;
		placementTimer = setTimeout(() => {
			placementTimer = undefined;
			const point = pendingPlacement;
			pendingPlacement = null;
			if (!point || !placing) return;
			const proposal = buildProposal(point);
			if (!proposal.ok) {
				draft = null;
				preview = null;
				placementPoint = null;
				placementReason = proposal.reason;
				return;
			}
			const stop =
				proposal.action.kind === 'add-route'
					? proposal.action.stops?.[0]
					: proposal.action.kind === 'extend-route'
						? proposal.action.stop
						: proposal.action.kind === 'add-stop'
							? proposal.action.stop
							: proposal.action.kind === 'add-facility'
								? proposal.action.facility
								: undefined;
			if (stop) placementPoint = [stop.lon, stop.lat];
			placementReason =
				buildMode === 'clinic' || buildMode === 'school'
					? `Click to propose a ${buildMode} · Escape to cancel`
					: buildMode === 'stop'
						? 'Click to place the stop · connect it next'
						: 'Click to build · Escape or right-click to cancel';
			// Same snapped road node does not restart the worker while the pointer moves.
			if (JSON.stringify(draft) !== JSON.stringify(proposal.action)) draft = proposal.action;
		}, 140);
	}
	function addBus(position?: [number, number]) {
		const proposal = buildProposal(position);
		if (!proposal.ok) {
			notice = proposal.reason;
			return;
		}
		cancelDraft();
		recordEdit(proposal.action.kind === 'add-stop' ? 'Stop placed' : 'Connection added', () =>
			scenario.addAction(proposal.action)
		);
		revealProposalChanges();
		busy = true;
		editMode = true;
		context = 'service';
		if (proposal.action.kind === 'add-route') {
			patternId = proposal.action.pattern.id;
			selectedStopId = proposal.action.stops?.[0]?.id ?? '';
		} else if (proposal.action.kind === 'extend-route') {
			patternId = proposal.action.patternId;
			selectedStopId = proposal.action.stop.id;
		} else if (proposal.action.kind === 'add-stop') {
			transportExpanded = false;
			patternId = '';
			selectedStopId = proposal.action.stop.id;
			notice = 'Stop placed. Add a connection to give it bus service.';
		} else if (proposal.action.kind === 'add-facility') {
			patternId = '';
			selectedStopId = '';
			context = null;
			editMode = false;
			notice = `Proposed ${proposal.action.facility.kind} added. Access assumes it opens; facility costs and emissions are unestimated.`;
		}
		mobileDetailExpanded = true;
		if (tour === 1) tour = 2;
	}
	function previewFrequency(value: number) {
		headway = value;
		if (context === 'build') {
			if (placementPoint) previewPlacement(placementPoint);
			return;
		}
		if (!hasEditableService) return;
		if (!selectedPattern || selectedPattern.timing.kind !== 'frequency') return;
		gesture = 'frequency';
		draft = { kind: 'set-frequency', patternId: selectedPattern.id, headwayMinutes: value };
	}
	function commitFrequency() {
		if (gesture !== 'frequency' || draft?.kind !== 'set-frequency') return;
		commit();
		gesture = null;
	}
	function changeFleet(value: 'diesel' | 'electric') {
		if (context === 'build' || !hasEditableService) {
			fleet = value;
			if (context === 'build' && placementPoint) previewPlacement(placementPoint);
			return;
		}
		if (!selectedPattern) return;
		cancelDraft();
		fleet = value;
		const id = selectedPattern.id;
		recordEdit('Fleet changed', () =>
			scenario.addAction({ kind: 'set-fleet', patternId: id, fleet: value })
		);
		busy = true;
	}
	function startStopMove(id: string) {
		cancelDraft(false);
		selectStop(id, false);
		gesture = 'stop';
		notice = '';
	}
	function previewStopMove(id: string, position: [number, number]) {
		pendingStopMove = { id, position };
		if (stopPreviewTimer) return;
		stopPreviewTimer = setTimeout(() => {
			stopPreviewTimer = undefined;
			const pending = pendingStopMove;
			pendingStopMove = null;
			if (!pending || gesture !== 'stop') return;
			const next = prepareStopMove(
				baseline,
				scenario.actions,
				pending.id,
				pending.position,
				scenario.assumptions,
				{ keepConnections: keepStopConnections, headwayMinutes: moveHeadway }
			);
			liveActions = next.ok ? next.actions : null;
			if (!next.ok) notice = next.reason;
		}, 60);
	}
	function commitStopMove(id: string, position: [number, number]) {
		const next = prepareStopMove(baseline, scenario.actions, id, position, scenario.assumptions, {
			keepConnections: keepStopConnections,
			headwayMinutes: moveHeadway
		});
		cancelDraft(false);
		if (!next.ok) {
			notice = next.reason;
			return null;
		}
		recordEdit('Stop moved', () => scenario.replaceActions(next.actions));
		revealProposalChanges();
		busy = true;
		selectedStopId = id;
		mobileDetailExpanded = true;
		notice = keepStopConnections
			? 'Stop moved. Connected bus routes follow it with proposed timing.'
			: 'Stop moved. Published service timing needs review.';
		return next.position;
	}
	function commit() {
		if (!draft) return;
		busy = true;
		const action = draft;
		recordEdit(action.kind === 'set-frequency' ? 'Bus frequency changed' : 'Network changed', () =>
			scenario.addAction(action)
		);
		revealProposalChanges();
		draft = null;
		preview = null;
		mobileDetailExpanded = true;
		if (tour === 1) tour = 2;
	}
	function revealProposalChanges() {
		view = 'impact';
		areasExpanded = false;
		tour = -1;
	}
	function cancelDraft(invalidateMapEdit = true) {
		if (invalidateMapEdit) editRevision += 1;
		clearTimeout(stopPreviewTimer);
		clearTimeout(placementTimer);
		placementTimer = undefined;
		pendingPlacement = null;
		placementPoint = null;
		stopPreviewTimer = undefined;
		pendingStopMove = null;
		liveActions = null;
		gesture = null;
		draft = null;
		preview = null;
		placing = false;
		movingStopId = '';
		connectionStopIds = [];
		connectionNewStops = [];
	}
	function history(direction: 'undo' | 'redo') {
		if (!(direction === 'undo' ? scenario.canUndo : scenario.canRedo)) return;
		if (gesture === 'stop') {
			notice = 'Finish or cancel the stop move before using Undo or Redo.';
			return;
		}
		cancelDraft();
		if (direction === 'undo' ? scenario.canUndo : scenario.canRedo) busy = true;
		recordEdit(direction === 'undo' ? 'Change undone' : 'Change restored', () =>
			scenario[direction]()
		);
		notice = '';
		syncPrivateInputs();
	}
	function resetToDefault() {
		if (!initialized || busy || !startingAssumptions) return;
		closeOperations();
		playbackOpen = false;
		playbackSymbols = { type: 'FeatureCollection', features: [] };
		appointmentResult = null;
		departureScan = null;
		cancelDraft();
		closeOverlay();
		context = null;
		editMode = false;
		selectedId = '';
		selectedCellId = '';
		selectedStopId = '';
		patternId = '';
		coveragePatternId = '';
		connectionPatternId = '';
		connectionAfterId = '';
		connectionMode = 'new';
		connectionReason = 'Choose two or more stops in the order the bus should visit them.';
		placementReason = 'Move the pointer to a street to preview a connection.';
		buildMode = 'destination';
		keepStopConnections = true;
		moveHeadway = 15;
		headway = 15;
		fleet = 'diesel';
		view = 'access';
		basemap = 'atlas';
		imageryYear = 2025;
		annualImagerySelected = false;
		overlayOpacity = 12;
		perspective = false;
		detailGrid = false;
		includeUntimedStops = false;
		showVessels = false;
		showAirport = false;
		transportTab = 'boats';
		settingsTab = 'journey';
		sourceSearch = '';
		mobileDetailExpanded = false;
		areasExpanded = !window.matchMedia('(max-width: 680px), (max-height: 600px)').matches;
		tour = -1;
		capitalBudget = 10_000_000;
		annualBudget = 4_000_000;
		comparisons = [];
		mapImage = '';
		focusCoordinate = null;
		overviewRequest += 1;
		busy = true;
		scenario.resetToDefaults(startingAssumptions);
		syncPrivateInputs();
		notice = 'Defaults restored. Undo brings back your proposal and planning settings.';
	}
	function changeCost(key: keyof PlanningCostAnchors, part: keyof NumericRange, value: string) {
		if (value === '') {
			patchAssumptions({ costs: { ...scenario.assumptions.costs, [key]: null } });
			return;
		}
		const amount = Number(value);
		if (!Number.isFinite(amount) || amount < 0) return;
		const old = scenario.assumptions.costs[key] as NumericRange | null;
		const next = { ...(old ?? { low: amount, central: amount, high: amount }), [part]: amount };
		patchAssumptions({ costs: { ...scenario.assumptions.costs, [key]: next } });
	}
	function changeEnergy(
		key: (typeof energyFields)[number]['key'],
		part: keyof NumericRange,
		value: string
	) {
		if (value === '') {
			patchAssumptions({ [key]: undefined });
			return;
		}
		const amount = Number(value);
		if (!Number.isFinite(amount) || amount < 0) return;
		const old = scenario.assumptions[key];
		patchAssumptions({
			[key]: { ...(old ?? { low: amount, central: amount, high: amount }), [part]: amount }
		});
	}
	function updateDisplacement(part?: keyof NumericRange, value?: string) {
		privateDistanceKm = Math.max(0.1, Number(privateDistanceKm) || 4);
		privateOccupancy = Math.max(1, Number(privateOccupancy) || 1.3);
		if (part && value !== undefined)
			dailyPrivateTrips = { ...dailyPrivateTrips, [part]: Math.max(0, Number(value) || 0) };
		patchAssumptions({
			privateTravelInputs: {
				dailyTrips: { ...dailyPrivateTrips },
				distanceKm: privateDistanceKm,
				occupancy: privateOccupancy
			},
			displacedPassengerKm: {
				low:
					dailyPrivateTrips.low *
					privateDistanceKm *
					privateOccupancy *
					scenario.assumptions.annualOperatingDays,
				central:
					dailyPrivateTrips.central *
					privateDistanceKm *
					privateOccupancy *
					scenario.assumptions.annualOperatingDays,
				high:
					dailyPrivateTrips.high *
					privateDistanceKm *
					privateOccupancy *
					scenario.assumptions.annualOperatingDays
			}
		});
	}
	function exportScenario() {
		const blob = new Blob([scenario.exportJson()], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `mobility-proposal-${baseline.version}.json`;
		link.click();
		URL.revokeObjectURL(url);
		notice = 'Proposal exported with its data and model versions.';
	}
	function exportPreviousScenario() {
		if (!scenario.archivedProposalJson) return;
		const url = URL.createObjectURL(
			new Blob([scenario.archivedProposalJson], { type: 'application/json' })
		);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'mobility-previous-proposal.json';
		link.click();
		URL.revokeObjectURL(url);
		notice =
			'Previous proposal exported unchanged. Its older data version cannot be applied to this audited baseline.';
	}
	async function importScenario(event: Event) {
		const file = (event.target as HTMLInputElement).files?.[0];
		if (!file) return;
		try {
			const result = scenario.importJson(await file.text());
			if (!result.ok) {
				notice = result.reason;
			} else {
				cancelDraft();
				syncPrivateInputs();
				notice = 'Proposal imported.';
			}
		} catch (error) {
			notice = String(error);
		}
		upload.value = '';
	}
	function loadDemo(demo: DemoCase, json: string) {
		const result = scenario.importJson(json);
		if (!result.ok) {
			notice = result.reason;
			return;
		}
		cancelDraft();
		closeOperations();
		playbackOpen = false;
		closeOverlay();
		syncPrivateInputs();
		selectedId = demo.originId;
		selectedCellId = '';
		patternId = demo.selectedPatternId ?? '';
		focusCoordinate = demo.mapCenter;
		context = 'area';
		editMode = false;
		areasExpanded = false;
		mobileDetailExpanded = true;
		returnOpen = false;
		appointmentResult = null;
		departureScan = null;
		returnRequest++;
		appointmentBusy = false;
		appointmentOptions = demo.appointmentOptions
			? structuredClone(demo.appointmentOptions)
			: { appointmentMinutes: 60, returnDeadlineMinutes: 21 * 60 };
		notice = `${demo.title} loaded. Inputs are editable assumptions; Undo restores your previous proposal.`;
	}
	async function compareAlternatives() {
		if (busy) return;
		cancelDraft();
		drawer = 'compare';
		comparisons = [];
		comparisonDone = false;
		comparisonNotes = [];
		busy = true;
		const comparisonClient = new AnalysisWorkerClient(baseline);
		try {
			const result = await compareAffordableInvestments(baseline, {
				originId: selectedId,
				actions: scenario.actions,
				assumptions: scenario.assumptions,
				capitalBudgetMvr: capitalBudget,
				annualOperatingBudgetMvr: annualBudget,
				costBasis,
				analyze: (actions, assumptions) => comparisonClient.analyze(actions, assumptions)
			});
			comparisons = result.alternatives;
			comparisonNotes = [...result.notes, ...new Set(result.excluded.map((entry) => entry.reason))];
		} catch (error) {
			notice = `Comparison unavailable: ${String(error)}`;
			comparisonNotes = [String(error)];
		} finally {
			comparisonClient.dispose();
			comparisonDone = true;
			busy = false;
		}
	}
	function useAlternative(actions: PlanningAction[]) {
		cancelDraft();
		busy = true;
		scenario.replaceActions(actions);
		closeOverlay();
		notice = 'Alternative applied. Undo restores your previous proposal.';
	}
	async function openBrief() {
		cancelDraft();
		playbackOpen = false;
		playbackSymbols = { type: 'FeatureCollection', features: [] };
		mapShown = analysis;
		pendingMapResult = null;
		wave = null;
		// Public brief exports use the locally prepared atlas; satellite licenses vary.
		basemap = 'atlas';
		perspective = false;
		await tick();
		mapImage = (await snapshotMap?.()) ?? '';
		drawer = 'brief';
	}
	function openSettings(tab = 'journey') {
		settingsTab = tab;
		drawer = 'assumptions';
	}
	function closeOverlay() {
		overlayDialog?.close();
		drawer = null;
	}
	export function openMenu() {
		drawer = 'mobile-menu';
	}
	export function showNotices() {
		openOperations();
	}
	export function focusLocation(selection: MapSelection) {
		if (selection.overview) {
			closeOverlay();
			closeOperations();
			context = null;
			areasExpanded = false;
			overviewRequest++;
			return;
		}
		if (selection.originId && baseline.origins.some((origin) => origin.id === selection.originId)) {
			selectOrigin(selection.originId, true);
			return;
		}
		if (selection.roadEdgeId) {
			const edge = baseline.network.edges.find((item) => item.id === selection.roadEdgeId);
			const node = edge && baseline.network.nodes.find((item) => item.id === edge.from);
			if (node) {
				openOperations();
				selectedRoads = [selection.roadEdgeId];
				focusCoordinate = [node.lon, node.lat];
				return;
			}
		}
		if (selection.islandId) {
			const origins = baseline.origins.filter((origin) => origin.islandId === selection.islandId);
			if (origins.length) {
				closeOverlay();
				closeOperations();
				context = null;
				areasExpanded = false;
				focusCoordinate = [
					origins.reduce((sum, item) => sum + item.lon, 0) / origins.length,
					origins.reduce((sum, item) => sum + item.lat, 0) / origins.length
				];
			}
		}
	}
	export function applyContext(handover: PolicyMapContext) {
		const result = scenario.importJson(
			JSON.stringify({
				schemaVersion: 1,
				datasetVersion: baseline.version,
				modelVersion: PLANNING_MODEL_VERSION,
				actions: handover.actions,
				assumptions: handover.assumptions
			})
		);
		if (!result.ok) {
			notice = result.reason;
			return;
		}
		cancelDraft();
		closeOperations();
		playbackOpen = false;
		closeOverlay();
		syncPrivateInputs();
		focusLocation({ originId: handover.originId });
		notice =
			'Option opened. The map compares all proposal changes, including assumed delays, with the unchanged network. Undo restores your previous proposal.';
	}
	$effect(() => {
		if (!active) {
			closeOverlay();
			playbackOpen = false;
		}
	});
	$effect(() => {
		if (!initialized || !onContextChange) return;
		const context = {
			actions: scenario.actions,
			assumptions: scenario.assumptions,
			originId: selectedId
		};
		untrack(() => onContextChange?.(JSON.parse(JSON.stringify(context))));
	});
	$effect(() => {
		const currentDrawer = drawer;
		const dialog = overlayDialog;
		if (!currentDrawer || !dialog) return;
		if (!dialog.open) dialog.showModal();
		else
			void tick().then(() => {
				if (drawer === currentDrawer)
					dialog
						.querySelector<HTMLButtonElement>('button[aria-label^="Close"]')
						?.focus({ preventScroll: true });
			});
	});
	function keydown(event: KeyboardEvent) {
		if (!active) return;
		if (event.defaultPrevented) return;
		if (drawer) {
			// Keep Tab inside the dialog, including native disclosure summaries.
			if (event.key === 'Tab' && overlayDialog) {
				const nodes = [
					...overlayDialog.querySelectorAll<HTMLElement>(
						'button:not([disabled]):not([tabindex="-1"]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],summary,[tabindex="0"]'
					)
				].filter((node) => {
					if (!node.getClientRects().length) return false;
					for (
						let parent = node.parentElement;
						parent && parent !== overlayDialog;
						parent = parent.parentElement
					) {
						if (parent instanceof HTMLDetailsElement && !parent.open) {
							const summary = parent.querySelector(':scope > summary');
							if (!summary?.contains(node)) return false;
						}
					}
					return true;
				});
				const first = nodes[0],
					last = nodes.at(-1);
				if (event.shiftKey && document.activeElement === first) {
					event.preventDefault();
					last?.focus();
				} else if (!event.shiftKey && document.activeElement === last) {
					event.preventDefault();
					first?.focus();
				}
			}
			return;
		}
		if (event.key === 'Escape') {
			if (isMobile && mobileDetailExpanded) {
				mobileDetailExpanded = false;
				return;
			}
			dismissContext();
			tour = -1;
			return;
		}
		if (
			event.target instanceof HTMLElement &&
			event.target.closest('input:not([type="range"]),select,textarea')
		)
			return;
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
			event.preventDefault();
			history(event.shiftKey ? 'redo' : 'undo');
		}
	}
	$effect(() => {
		if (placing) mobileDetailExpanded = false;
	});
	const mobileContextTitle = $derived(
		context === 'connect'
			? 'Connect bus stops'
			: context === 'area'
				? (selectedArea?.name ??
					(selectedOrigin ? islandName(baseline, selectedOrigin.islandId) : 'Selected area'))
				: context === 'build'
					? buildMode === 'clinic' || buildMode === 'school'
						? `Propose a ${buildMode}`
						: buildMode === 'stop'
							? 'Place a bus stop'
							: 'New bus connection'
					: (selectedStop?.name ?? selectedPattern?.name ?? 'Transport service')
	);
	const mobileContextSummary = $derived(
		context === 'connect'
			? `${connectionStopIds.length} ${connectionStopIds.length === 1 ? 'stop' : 'stops'} selected · tap to review and apply`
			: context === 'area'
				? `${number(selectedResidents)} people · ${selectedAccessLabel} · Details`
				: placing
					? 'Pan the map to place · tap for options'
					: `${selectedStopMarker?.statusLabel ?? 'Service'} · tap to edit`
	);
</script>

{#snippet opacityControl(inputId: string)}
	<div class="overlay-opacity-control">
		<div class="overlay-opacity-label">
			<label for={inputId}>Hexagon opacity</label>
			<output for={inputId}>{overlayOpacity}%</output>
		</div>
		<input
			id={inputId}
			class="frequency-slider"
			type="range"
			min="0"
			max="100"
			step="1"
			value={overlayOpacity}
			aria-valuetext={`${overlayOpacity}%`}
			aria-describedby={`${inputId}-hint`}
			oninput={(event) => setOverlayOpacity(Number(event.currentTarget.value))}
		/>
		<p id={`${inputId}-hint`}>0 hides the colors; streets and buildings stay visible.</p>
	</div>
{/snippet}

{#snippet policyResults()}
	{#if analysisFailed}<div class="result" role="status">
			<strong>Results unavailable</strong>
			<p>The latest calculation failed. Retry before assessing this proposal.</p>
			<button class="secondary-button" onclick={retryAnalysis}>Try again</button>
		</div>{:else}
		<div class="result access-result">
			<span class="result-label"
				>{hasProposal || draft || liveActions ? 'Newly within' : 'Residents within'}
				{scenario.assumptions.targetMinutes} min
				<span class="result-chip"
					>{busy
						? 'Calculating'
						: draft || liveActions
							? 'Preview'
							: gesture
								? 'Live'
								: scenario.actions.length
									? 'Proposal'
									: 'Baseline'}</span
				></span
			><strong
				>{shown && !busy
					? hasProposal || draft || liveActions
						? `+${number(shown.summary.newlyReachedResidents)}`
						: number(shown.summary.scenarioReachableResidents)
					: 'Calculating…'}<span> people</span></strong
			>
			<p>
				{#if busy || !shown}Updating results for the selected inputs…{:else if !hasProposal && !draft && !liveActions}of
					{number(shown.summary.population)} modeled residents{:else}{number(
						shown?.summary.baselineReachableResidents
					)} within target before{/if}
				{#if !busy && (hasProposal || draft || liveActions) && shown?.summary.unknownResidents}<button
						onclick={() => (drawer = 'evidence')}
						>{number(shown.summary.unknownResidents)} unknown</button
					>{/if}
			</p>
		</div>
		{#if !hasProposal && !draft && !liveActions && !focusJourney}
			<div class="result">
				<span class="result-label">Missing journey evidence</span>
				<strong
					>{shown && !busy ? number(shown.summary.unknownResidents) : 'Calculating…'}<span
						>{shown && !busy ? ' people' : ''}</span
					></strong
				>
				<p>
					Residents whose journeys cannot be assessed <button onclick={() => (drawer = 'evidence')}
						>Review gaps</button
					>
				</p>
			</div>
		{:else}
			<div class="result">
				<span class="result-label"
					>Journey change <span class="result-context"
						>{focusJourney ? 'Selected area' : 'Already within target'}</span
					></span
				><strong
					>{busy
						? 'Calculating…'
						: focusJourney
							? `${formatJourneyTime(focusJourney.before).replace(' min', '')} → ${formatJourneyTime(focusJourney.after).replace(' min', '')}`
							: shown?.summary.minutesSavedForAlreadyReachable != null
								? minuteChange(shown.summary.minutesSavedForAlreadyReachable)
								: 'Unavailable'}<span
						>{busy
							? ''
							: focusJourney
								? focusJourney.before.minutes !== null || focusJourney.after.minutes !== null
									? ' min'
									: ''
								: shown?.summary.minutesSavedForAlreadyReachable != null
									? shown.summary.minutesSavedForAlreadyReachable < 0
										? ' min slower'
										: ' min saved'
									: ''}</span
					></strong
				>
				<p>
					{focusJourney
						? focusJourney.after.minutes == null
							? 'A journey could not be established with these inputs'
							: 'Before → after · walk, wait and service time'
						: 'Population-weighted average'}
					{#if !busy && shown?.summary.lostAccessResidents}<button
							onclick={() => (drawer = 'mobile-results')}
							>{number(shown.summary.lostAccessResidents)} lose access</button
						>{/if}
				</p>
			</div>
		{/if}
		{#if hasProposal || draft || liveActions}
			<div class="result investment-result">
				<span class="result-label"
					>Investment <button
						class="assumption-link"
						onclick={() => (costUnavailable ? (drawer = 'evidence') : openSettings('costs'))}
						>{costUnavailable ? 'Details' : 'Estimate'} <Info size={11} /></button
					></span
				><strong
					>{busy
						? 'Calculating…'
						: unpricedChange
							? 'Needs review'
							: !scenario.actions.length && !draft && !liveActions
								? 'Choose an investment'
								: money(shown?.costs.capitalMvr?.central)}<span
						>{!busy && !unpricedChange && (scenario.actions.length || draft || liveActions)
							? ' one-time'
							: ''}</span
					></strong
				>
				<p>
					{busy
						? 'Updating results for the selected inputs…'
						: unpricedChange
							? 'Timing or road intervention costs are not estimated'
							: !scenario.actions.length && !draft && !liveActions
								? 'Capital and annual operations shown separately'
								: `${money(shown?.costs.annualOperatingMvr?.central)} / year change`}
				</p>
			</div>
		{/if}
		{#if drawer === 'mobile-results' && (scenario.actions.length || draft || liveActions)}
			<div
				class="result carbon-result"
				class:carbon-increase={!busy && (shown?.carbon.central ?? 0) > 0}
			>
				<span class="result-label"
					>Emissions {#if !busy && shown?.carbon.central == null && shown}<button
							class="assumption-link"
							onclick={() => (drawer = 'evidence')}>Why unavailable <Info size={11} /></button
						>{:else}<span class="result-context">Estimate</span>{/if}</span
				><strong
					>{busy
						? 'Calculating…'
						: !scenario.actions.length && !draft && !liveActions
							? 'No investment yet'
							: shown?.carbon.central == null
								? 'Unavailable'
								: `${shown.carbon.central > 0 ? '+' : ''}${number(shown.carbon.central / 1000, 1)}`}<span
						>{!busy &&
						(scenario.actions.length || draft || liveActions) &&
						shown?.carbon.central != null
							? ' t CO₂e / yr'
							: ''}</span
					></strong
				>
				<p>
					{busy
						? 'Updating results for the selected inputs…'
						: !scenario.actions.length && !draft && !liveActions
							? 'Road event effects shown in disruption tools'
							: shown?.carbon.central == null
								? 'Missing inputs'
								: shown.carbon.central > 0
									? 'Increase under these assumptions'
									: shown.carbon.central < 0
										? 'Reduction under these assumptions'
										: 'No change'}
					{#if !busy && shown?.carbon.central != null}<button
							class="icon-button"
							aria-label="Carbon assumptions"
							onclick={() => openSettings('carbon')}><Info size={13} /></button
						>{/if}
				</p>
			</div>
		{/if}
	{/if}
{/snippet}
{#snippet priorityCards()}
	<h1>Areas to investigate</h1>

	{#each priorities as area, i (area.id)}<button
			class="priority-card"
			class:chosen={selectedId === area.originId}
			onclick={() => selectOrigin(area.originId, true)}
			><span class="priority-number">0{i + 1}</span><span class="priority-copy"
				><strong>{area.name}</strong><span
					>{area.gap > 0
						? `${number(area.gap)} people beyond target`
						: area.unknown > 0
							? `Access data incomplete`
							: 'Longest journey in the loaded network'}</span
				></span
			><ChevronRight size={16} /></button
		>{/each}
	{#if !priorities.length}<div class="loading-priorities">
			{analysis
				? 'No additional access gap found in the loaded network.'
				: 'Loading public population and streets…'}
		</div>{/if}
	{#if analysis?.summary.unknownResidents}<button
			class="data-investigation"
			onclick={() => (drawer = 'evidence')}
			>Collect better data · {number(analysis.summary.unknownResidents)} residents have unknown access
			<Info size={13} /></button
		>{/if}
{/snippet}
{#snippet playbackControls()}
	<div class="playback-content">
		<div class="context-heading">
			<span class="eyebrow">SERVICE ILLUSTRATION</span><button
				class="icon-button"
				aria-label="Close service playback"
				onclick={() => (playbackOpen = false)}><X size={17} /></button
			>
		</div>
		<RoutePicker
			label="Playback service"
			allowEmpty={false}
			value={playbackPattern?.id ?? ''}
			items={playbackPatterns.map((p) => {
				const duplicateName = playbackPatterns.some(
					(other) => other.id !== p.id && other.name === p.name
				);
				const endpointName = (stopId: string | undefined, fallback: string) =>
					(analysis?.world.stops.find((stop) => stop.id === stopId)?.name ?? fallback)
						.replace(/^Proposed stop near /i, '')
						.replace(/^Proposed neighbourhood stop$/i, 'Neighbourhood')
						.replace(/^Proposed /i, '');
				return {
					value: p.id,
					label: duplicateName
						? `${endpointName(p.stopIds[0], 'Start')} → ${endpointName(p.stopIds.at(-1), 'Terminus')}`
						: p.name
				};
			})}
			onchange={(v) => (playbackPatternId = v)}
		/>
		<ServicePlaybackPanel
			pattern={playbackPattern ?? null}
			stops={analysis?.world.stops ?? []}
			date={scenario.assumptions.date}
			departureMinutes={scenario.assumptions.departureMinutes}
			sourceReferenceDate={baseline.referenceDate}
			onframe={(frame) =>
				(playbackSymbols = frame?.features ?? { type: 'FeatureCollection', features: [] })}
		/>
	</div>
{/snippet}
{#snippet changesCards()}
	<div class="changes-content" aria-busy={busy}>
		<span class="eyebrow"
			>YOUR PROPOSAL · {scenario.assumptions.goal === 'education' ? 'SCHOOLS' : 'HEALTHCARE'}</span
		>
		{#if analysisFailed}<p class="change-empty" role="status">
				Results unavailable. Retry the calculation before comparing journeys.
			</p>
		{:else if busy}
			<p class="change-empty" role="status">
				Recalculating journeys. Highlights appear when the new routes are ready.
			</p>
		{:else if !hasProposal}
			<h2>What would improve?</h2>
			<p class="change-empty">
				Add a bus route or connect a new stop to compare journeys with the current network.
			</p>
		{:else}
			<h2>
				<strong>{number(journeyChanges.improvedPopulation)}</strong> people with better journeys
			</h2>
			{#if journeyChanges.improvedPopulation > 0}
				<p class="change-explanation">
					Green outlines show improvements. Tap an area to compare its journey.
				</p>
				{#each changedExamples as result, i (result.originId)}
					<button class="change-card" onclick={() => selectOrigin(result.originId, true)}>
						<span class="change-card-heading"
							><strong>{islandName(baseline, result.islandId)} · area {i + 1}</strong><ArrowUpRight
								size={14}
							/></span
						>
						<span class="change-times"
							><span>{formatJourneyTime(result.before)}</span><span aria-label="to">→</span><strong
								>{formatJourneyTime(result.after)}</strong
							></span
						>
						<span class="change-card-detail"
							>{journeyChangeSummary(result)} · {number(result.population)} people</span
						>
					</button>
				{/each}
			{:else}
				<p class="change-empty">
					No shorter or newly possible journeys for this destination yet. A stop needs an active
					connection; a new facility must meet the destination requirements.
				</p>
			{/if}
			{#if journeyChanges.worsenedPopulation > 0}<p class="change-warning">
					{number(journeyChanges.worsenedPopulation)} people have a slower journey or lose a route. Red
					outlines show these areas.
				</p>{/if}
			{#if journeyChanges.journeyChangePopulation.unknown > 0}<p class="change-footnote">
					{number(journeyChanges.journeyChangePopulation.unknown)} people cannot be compared because evidence
					is incomplete.
				</p>{/if}
			<p class="change-footnote">
				Compared with {impactCumulative ? 'the current network' : 'your previous plan'}. Population
				distribution and proposed services are modeled; purple outlines mean partial or mixed
				changes.
			</p>
		{/if}
	</div>
{/snippet}
{#snippet contextBody()}
	<div class="panel-scroll">
		{#if context === 'area'}
			<section class="area-insight">
				<div class="area-heading">
					<h2>
						{selectedArea?.name ??
							(selectedOrigin ? islandName(baseline, selectedOrigin.islandId) : 'Choose an area')}
					</h2>
					<TransportGraphic
						kind={scenario.assumptions.goal === 'healthcare' ? 'hospital' : 'school'}
						size={42}
					/>
				</div>
				<div class="resident-stat">
					<strong>{number(selectedResidents)}</strong><span>people in this area</span><button
						class="population-estimate"
						onclick={() => (drawer = 'evidence')}
						title="Official island totals distributed using modeled spatial weights"
						>Estimate <Info size={12} /></button
					>
				</div>
				<div
					class="access-status"
					class:access-gap={selectedHex
						? selectedHex.reachableShare !== 1
						: selectedResult?.after.minutes == null ||
							selectedResult.after.minutes > scenario.assumptions.targetMinutes}
				>
					<span></span>{selectedAccessLabel}
				</div>
			</section>
			<JourneyComparison
				comparison={selectedResult ?? null}
				pending={busy}
				example={!!selectedHex}
				unavailable={analysisFailed}
				beforeLabel={view === 'impact' && !impactCumulative ? 'Previous plan' : 'Current network'}
				afterLabel={view === 'impact' && !impactCumulative ? 'After this change' : 'With proposal'}
			/>
			<details class="edit-journey">
				<summary
					>{selectedHex ? 'See an example journey' : 'See the journey'}
					<span
						>{selectedResult?.after.minutes == null
							? 'Unknown'
							: number(selectedResult.after.minutes) + ' min'}</span
					></summary
				><JourneyRibbon
					legs={ribbonLegs}
					totalMinutes={selectedResult?.after.minutes}
					title={destination?.name ?? 'Matched destination'}
					subtitle={selectedHex
						? 'An example journey for this area; travel times vary by location.'
						: (selectedResult?.after.reason ?? 'Network journey; not a demand forecast')}
				/>
			</details>
			<button class="primary-button full-width" onclick={() => beginBuild()}
				><BusFront size={17} />Build a bus connection <ArrowUpRight size={15} /></button
			>
			<details class="evidence-group" bind:open={returnOpen}>
				<summary>Can they get there and back?</summary>{#if appointmentBusy}<p
						class="technical-note"
						role="status"
					>
						Checking the return journey…
					</p>{/if}<RoundTripPanel
					busy={appointmentBusy}
					result={appointmentResult}
					options={appointmentOptions}
					onoptions={(options) => evaluateReturn(options)}
					{departureScan}
					onscan={() => evaluateReturn(appointmentOptions, true)}
				/>
			</details>
			<button class="secondary-button full-width" onclick={openOperations}
				>Test a road closure or delay</button
			>
			<button class="secondary-button full-width" onclick={compareAlternatives} disabled={busy}
				>Find affordable investments</button
			>
			<details class="evidence-group">
				<summary>Who benefits across the islands?</summary>
				{#each shown?.islandSummaries ?? [] as island (island.islandId)}<div class="island-impact">
						<strong>{islandName(baseline, island.islandId)}</strong><span
							>+{number(island.gainedResidents)} gain · {number(island.lostResidents)} lose access</span
						><small
							>{number(island.worsenedJourneyResidents)} have slower journeys · {number(
								island.unknownResidents
							)} unknown</small
						>
					</div>{/each}
				<p class="technical-note">
					Island demographics are not assigned to individual neighborhoods. Constituency summaries
					require matching boundaries.
				</p>
			</details>
			{#if scenario.assumptions.populationYear === 2030}<details class="evidence-group">
					<summary>Test a housing completion scenario</summary>
					<p class="technical-note">
						Allocate a share of this island's official 2030 population within 500 m of this selected
						origin. This is a conditional distribution, not a verified completion forecast.
					</p>
					<label class="housing-control"
						>Share of island residents (%)<input
							type="number"
							min="0"
							max="100"
							bind:value={housingShare}
						/></label
					><button class="secondary-button" onclick={setHousingDistribution}
						>Apply distribution</button
					><button
						class="quiet-button"
						onclick={() =>
							patchAssumptions({
								housingDistribution: (scenario.assumptions.housingDistribution ?? []).filter(
									(item) => item.islandId !== selectedOrigin?.islandId
								)
							})}>Restore spatial weights</button
					>
				</details>{/if}
		{/if}
	</div>
{/snippet}

{#snippet transportBody()}
	{#if context === 'connect'}
		<ConnectionEditor
			dock
			stops={connectionStops}
			selectedStops={orderedConnectionStops}
			patterns={activePatterns}
			mode={connectionMode}
			patternId={connectionPatternId}
			afterStopId={connectionAfterId}
			{headway}
			{fleet}
			reason={connectionReason}
			valid={!!draft}
			{busy}
			previewSummary={connectionPreviewSummary}
			onmodechange={(mode) => {
				connectionMode = mode;
				if (mode === 'insert') connectionStopIds = connectionStopIds.slice(0, 1);
				connectionNewStops = connectionNewStops.filter((stop) =>
					connectionStopIds.includes(stop.id)
				);
				connectionPatternId = suggestedInsertionPattern(connectionStopIds[0] ?? '');
				connectionAfterId =
					activePatterns.find((pattern) => pattern.id === connectionPatternId)?.stopIds.at(-1) ??
					'';
				refreshConnection();
			}}
			onpatternchange={(id) => {
				connectionPatternId = id;
				connectionAfterId =
					activePatterns.find((pattern) => pattern.id === id)?.stopIds.at(-1) ?? '';
				refreshConnection();
			}}
			onafterchange={(id) => {
				connectionAfterId = id;
				refreshConnection();
			}}
			onheadwaychange={(value) => {
				headway = value;
				refreshConnection();
			}}
			onfleetchange={(value) => {
				fleet = value;
				refreshConnection();
			}}
			onstopadd={pickConnectionStop}
			onstopremove={removeConnectionStop}
			onstopreorder={reorderConnectionStop}
			onapply={applyConnection}
			oncancel={dismissContext}
		/>
	{:else if context === 'build'}
		<div class="placement-workshop">
			<div class="placement-icon"><MapPinPlus size={23} strokeWidth={1.6} /></div>
			<div>
				<strong
					>{buildMode === 'stop'
						? 'Choose a road for your bus stop'
						: 'Connect this area to a destination'}</strong
				>
				<p class:placement-valid={!!draft}>{placementReason}</p>
				<small>Snaps to a permitted road · Click or tap to place · Esc to cancel</small>
			</div>
			{#if buildMode === 'destination'}<button
					class="dock-secondary"
					onclick={() => setBuildMode('stop')}>Place a stop only</button
				>{/if}
		</div>
	{:else if context === 'service' && selectedStop}
		<div class="stop-workshop">
			<div class="workshop-description">
				<strong>{selectedStop.name}</strong>
				<p>
					{selectedStopMarker?.statusLabel ?? 'Bus stop'} · {connectedRouteCount} connected {connectedRouteCount ===
					1
						? 'route'
						: 'routes'}
				</p>
				{#if !editableBusStop}<small>Ferry terminals can be inspected in Service details.</small
					>{:else}<small
						>{movingStopId
							? 'Tap a new road to finish the move.'
							: 'Drag the stop, or choose Move stop and tap a road.'}</small
					>{/if}
			</div>
			{#if editableBusStop}
				<div class="workshop-stop-actions">
					<button
						class="dock-secondary"
						disabled={selectedStop.disabled || busy}
						onclick={() => beginStopMove(selectedStopId)}
						><SquareMousePointer size={16} />Move stop</button
					>
					<button
						class="dock-secondary"
						disabled={selectedStop.disabled || busy}
						onclick={() => beginConnection(selectedStopId, 'insert')}
						><Route size={16} />Add to a route</button
					>
					<button
						class="dock-secondary"
						disabled={selectedStop.disabled || busy}
						onclick={() => beginConnection(selectedStopId)}>Start a route</button
					>
				</div>
				{#if stopConnections.length}
					<div class="workshop-connected">
						<span>Connected routes</span>
						{#each stopConnections as pattern (pattern.id)}<button
								onclick={() => selectRoute(pattern.id)}
								>{pattern.name}<small
									>To {analysis?.world.stops.find((stop) => stop.id === pattern.stopIds.at(-1))
										?.name ?? 'route end'}</small
								><ChevronRight size={14} /></button
							>{/each}
					</div>
					<details class="workshop-move-settings">
						<summary>Route timing when this stop moves <ChevronDown size={14} /></summary>
						<label
							><input type="checkbox" bind:checked={keepStopConnections} />Keep bus connections</label
						>
						<p>
							Connected routes follow permitted roads. Captured departures become proposed service;
							existing frequency is retained.
						</p>
						{#if keepStopConnections && stopConnections.some((pattern) => pattern.timing.kind === 'scheduled')}<label
								>Proposed buses every <input
									type="number"
									min="1"
									max="240"
									bind:value={moveHeadway}
								/> min · 07:00–19:00 MVT</label
							>{/if}
					</details>
					{#if keepStopConnections && stopConnections.some((pattern) => pattern.timing.kind === 'scheduled')}<p
							class="workshop-timing-note"
						>
							<Info size={14} />Moving this stop replaces captured departures with proposed buses
							every {moveHeadway} min, 07:00–19:00 MVT.
						</p>{/if}
				{/if}
			{/if}
			<button class="workshop-link" onclick={() => (drawer = 'services')}
				>Service details <ChevronRight size={14} /></button
			>
		</div>
	{:else if context === 'service'}
		<div class="route-workshop">
			<div class="route-workshop-main">
				<span class="workshop-label">Choose a bus route, or select one on the map</span>
				<RoutePicker
					value={patternId}
					items={activePatterns.map((pattern) => ({
						value: pattern.id,
						label: `${pattern.name} · to ${analysis?.world.stops.find((stop) => stop.id === pattern.stopIds.at(-1))?.name ?? 'route end'}`
					}))}
					onchange={selectRoute}
					allowEmpty={false}
					emptyLabel="Choose a route"
					label="Route to edit"
				/>
				{#if selectedPattern}<div class="route-workshop-actions">
						<button
							class="dock-secondary"
							disabled={busy}
							onclick={() => {
								beginConnection('', 'insert');
								connectionPatternId = selectedPattern!.id;
								connectionAfterId = selectedPattern!.stopIds.at(-1) ?? '';
								refreshConnection();
							}}><MapPinPlus size={16} />Add a stop to this route</button
						><button class="workshop-link" onclick={() => (drawer = 'services')}
							>Timetable & details <ChevronRight size={14} /></button
						>
					</div>{:else}<p class="workshop-timing-note">
						No bus routes are available in this data snapshot. Draw a new route to test a service.
					</p>{/if}
			</div>
			{#if selectedPattern?.timing.kind === 'frequency'}
				<div class="route-frequency">
					<div class="frequency-label">
						<label for="live-frequency">A bus every</label><strong
							>{headway}<span> min</span></strong
						>
					</div>
					<input
						id="live-frequency"
						class="frequency-slider"
						aria-label="Minutes between buses"
						type="range"
						min="1"
						max={Math.max(60, headway)}
						step="1"
						value={headway}
						oninput={(e) => previewFrequency(Number(e.currentTarget.value))}
						onchange={commitFrequency}
					/>
					<div class="slider-labels"><span>More often</span><span>Less often</span></div>
					<small>Live preview · release to apply</small>
				</div>
			{:else if selectedPattern}<div class="route-published">
					<Info size={17} />
					<div>
						<strong>Published timetable</strong>
						<p>View departures in details. Adding a stop creates an explicitly assumed service.</p>
					</div>
				</div>{/if}
			{#if selectedPattern}<div class="route-fleet">
					<span class="workshop-label">Bus fleet</span>
					<div class="fleet-toggle" role="group" aria-label="Bus fleet">
						<button
							class:active={fleet === 'diesel'}
							aria-pressed={fleet === 'diesel'}
							disabled={busy}
							onclick={() => changeFleet('diesel')}>Diesel</button
						><button
							class:active={fleet === 'electric'}
							aria-pressed={fleet === 'electric'}
							disabled={busy}
							onclick={() => changeFleet('electric')}><Leaf size={14} />Electric</button
						>
					</div>
				</div>{/if}
		</div>
	{/if}
{/snippet}

<svelte:window onkeydown={keydown} bind:innerWidth={viewportWidth} />
<div
	class="policy-atlas"
	class:embedded
	style:--mobile-sheet-bottom={`${outcomeHeight + 32}px`}
	style:--mobile-sheet-top={`${Math.min(mapOverlayHeight + 8, 180)}px`}
>
	<div class="workspace">
		<main
			class="map-stage"
			style:--map-controls-height={`${mapOverlayHeight}px`}
			class:editing={editMode}
			class:has-selection={context !== null || operationsOpen || playbackOpen}
			class:has-operations={operationsOpen || playbackOpen}
			class:satellite={basemap === 'satellite'}
		>
			<details
				class="map-workbench"
				bind:this={mapToolbar}
				bind:open={workflowOpen}
				ontoggle={(event) => {
					if (event.currentTarget.open) legendOpen = false;
				}}
			>
				<summary class="workflow-toggle">
					<MousePointer2 size={18} strokeWidth={1.7} />
					<span
						><strong>{operationsOpen ? 'Test a disruption' : 'Explore access'}</strong><small
							>{scenario.assumptions.goal === 'healthcare' ? 'Healthcare' : 'Schools'} · {scenario
								.assumptions.targetMinutes} min target{requirementsFiltered
								? ' · filtered'
								: ''}</small
						><small class="workflow-context"
							>{planningDateLabel} · {timeLabel(scenario.assumptions.departureMinutes)} MVT · {coverage.status ===
							'outside-snapshot'
								? 'Outside source period'
								: coverage.status === 'unavailable'
									? 'Service data unavailable'
									: 'Partial public data'}</small
						></span
					>
					<ChevronDown size={17} />
				</summary>
				<div class="workbench-body">
					{#if tour >= 0}<section class="tour-card" aria-label="Guided walkthrough">
							<div>
								<span class="eyebrow">Map walkthrough</span><button
									class="icon-button"
									aria-label="Close tour"
									onclick={() => (tour = -1)}><X size={16} /></button
								>
							</div>
							<strong>{tourSteps[tour].title}</strong>
							<p>{tourSteps[tour].detail}</p>
							<button onclick={() => (tour = tour === 2 ? -1 : tour + 1)}
								>{tour === 2 ? 'Finish tour' : 'Next step'} <ChevronRight size={15} /></button
							>
						</section>{/if}
					<nav class="workflow-actions" aria-label="Planning task">
						<button
							class:chosen={!operationsOpen}
							aria-pressed={!operationsOpen}
							onclick={() => chooseTask('access')}>Access</button
						>
						<button
							class:chosen={operationsOpen}
							aria-pressed={operationsOpen}
							onclick={() => {
								chooseTask('disruption');
								if (isMobile) workflowOpen = false;
							}}>Disruption</button
						>
						<button
							class="investment-action"
							onclick={() => chooseTask('compare')}
							disabled={busy || !selectedId}
							title={selectedId ? 'Compare investment options' : 'Select an area on the map first'}
							>Investments <ArrowUpRight size={13} /></button
						>
					</nav>
					<div class="workbench-field">
						<span class="control-caption">Access to</span>
						<DestinationPicker
							value={scenario.assumptions.goal}
							onchange={(goal) => patchAssumptions({ goal })}
						/>
					</div>
					<button
						class="planning-time"
						onclick={() => openSettings('journey')}
						aria-label="Change planning date and departure time"
					>
						<span
							><small>Departure · Maldives time</small><strong
								>{scenario.assumptions.date} · {timeLabel(
									scenario.assumptions.departureMinutes
								)}</strong
							></span
						><ChevronRight size={15} />
					</button>
					<div class="workbench-field">
						<span class="control-caption">Show on the map</span>
						<div class="map-display-choices" role="group" aria-label="Map data">
							{#each views as choice (choice.id)}<button
									class:chosen={view === choice.id}
									aria-pressed={view === choice.id}
									onclick={() => (view = choice.id)}>{choice.label}</button
								>{/each}
						</div>
					</div>
					<div
						class="coverage-context"
						class:outside={coverage.status === 'outside-snapshot' ||
							coverage.status === 'unavailable'}
					>
						<button onclick={() => (drawer = 'evidence')}
							><Info size={14} />{snapshotStale
								? 'Dated public snapshot'
								: coverage.label}<ChevronRight size={13} /></button
						>
						<small>Scenario estimates · missing service can affect results</small>
						{#if coverage.status === 'outside-snapshot'}<button
								class="supported-time"
								onclick={() => patchAssumptions(supportedSnapshotSettings(baseline))}
								>Use supported time</button
							>{/if}
						{#if requirementsFiltered}
							<button
								onclick={() => openSettings('journey')}
								aria-label="Review destination and walking requirements"
								>{destinationScope}{scenario.assumptions.walkingRequirements
									?.requireAuditedWheelchair
									? ' · audited routes'
									: ''} · filtered</button
							>
						{/if}
					</div>
					<div class="workbench-tools" role="group" aria-label="Edit the map">
						<button onclick={() => (drawer = 'services')}><Layers size={16} />Services</button>
						<button
							class:chosen={playbackOpen}
							aria-pressed={playbackOpen}
							onclick={() => {
								togglePlayback();
								if (isMobile) workflowOpen = false;
							}}><BusFront size={16} />Playback</button
						>
					</div>
					{#if context === null && !operationsOpen && !playbackOpen}<p class="map-start-hint">
							Select an area to inspect its journeys or test an investment.
						</p>{/if}
					{#if scenario.canUndo || scenario.canRedo || hasProposal}
						<div class="proposal-history">
							<button
								disabled={!scenario.canUndo || gesture === 'stop'}
								onclick={() => history('undo')}
								aria-label="Undo change"><RotateCcw size={15} />Undo</button
							>
							<button
								disabled={!scenario.canRedo || gesture === 'stop'}
								onclick={() => history('redo')}
								aria-label="Redo change"><RotateCw size={15} />Redo</button
							>
							<button
								disabled={!initialized || busy}
								onclick={resetToDefault}
								aria-label="Reset to default"><ListRestart size={15} />Reset</button
							>
							<button onclick={() => openSettings('proposal')} aria-label="Proposal options"
								><Ellipsis size={17} /></button
							>
						</div>
					{/if}
					<details class="suggested-areas" bind:open={areasExpanded}>
						<summary
							><span
								>{hasProposal || view === 'impact'
									? 'Journey changes'
									: 'Areas to investigate'}</span
							><span
								>{hasProposal || view === 'impact'
									? changedExamples.length
									: priorities.length}</span
							><ChevronDown size={14} /></summary
						>
						<div class="suggested-area-list">
							{#if hasProposal || view === 'impact'}{@render changesCards()}{:else}{@render priorityCards()}{/if}
						</div>
					</details>
				</div>
			</details>
			<div
				class="outcome-dock planning-dock"
				class:split-preview={context === 'connect' && editingPreview && transportExpanded}
				bind:this={outcomeDock}
			>
				{#if transportEditing}
					<div class="dock-heading">
						<div>
							<span class="dock-state-dot" class:placing></span><strong
								>{context === 'build'
									? buildMode === 'stop'
										? 'Add a bus stop'
										: 'Add a bus connection'
									: context === 'connect'
										? connectionMode === 'new'
											? 'Draw a bus route'
											: 'Add a stop to a route'
										: selectedStopId
											? 'Bus stop'
											: 'Edit a bus route'}</strong
							><span class="dock-heading-hint"
								>{editingPreview ? 'Draft · not applied' : 'Planning scenario'}</span
							>
						</div>
						<div>
							<button
								class="dock-icon"
								aria-label={transportExpanded ? 'Collapse planning panel' : 'Expand planning panel'}
								aria-expanded={transportExpanded}
								onclick={() => (transportExpanded = !transportExpanded)}
								><ChevronDown size={17} class={transportExpanded ? '' : 'flipped'} /></button
							><button class="dock-icon" aria-label="Close planning tool" onclick={dismissContext}
								><X size={17} /></button
							>
						</div>
					</div>
					{#if transportExpanded}<div class="transport-editor" data-testid="transport-editor">
							{@render transportBody()}
						</div>{/if}
				{/if}
				{#if (hasProposal || editingPreview || currentReceipt || awaitingService) && !(context === 'build' && buildMode === 'stop')}
					{#if !awaitingService && (currentReceipt?.before || editingPreview)}<div
							class="impact-scope"
						>
							<span>Journey impact</span>
							<div role="group" aria-label="Impact comparison">
								<button
									class:active={!impactCumulative}
									aria-pressed={!impactCumulative}
									disabled={incompatibleComparison}
									onclick={() => {
										wholeProposalImpact = false;
										impactExamplesOpen = false;
									}}>This change</button
								><button
									class:active={impactCumulative}
									aria-pressed={impactCumulative}
									onclick={() => {
										wholeProposalImpact = true;
										impactExamplesOpen = false;
									}}>Whole proposal</button
								>
							</div>
						</div>{/if}
					{#if incompatibleComparison}<p class="impact-scope-note">
							Journey settings changed. Showing the whole proposal against the current network.
						</p>{/if}
					<EditImpactReceipt
						compact={context === 'connect' && editingPreview && transportExpanded}
						totals={editImpact}
						label={impactLabel}
						{busy}
						unavailable={analysisFailed}
						onretry={retryAnalysis}
						announce={!editingPreview}
						preview={editingPreview && !impactCumulative}
						{awaitingService}
						cumulative={impactCumulative}
						onshowareas={showAffectedAreas}
						ondetails={() => (drawer = 'mobile-results')}
						onconnect={(mode) => beginConnection(selectedStopId, mode)}
					/>
				{:else if !transportEditing || context === 'service'}
					<CompactPolicySummary
						analysis={mapShown}
						selectedJourney={focusJourney}
						targetMinutes={scenario.assumptions.targetMinutes}
						{hasProposal}
						{unpricedChange}
						preview={editingPreview}
						{busy}
						expanded={drawer === 'mobile-results'}
						announce={!gesture && !placing}
						ondetails={() => (drawer = 'mobile-results')}
					/>
				{/if}
				{#if impactExamplesOpen && !busy && editImpact}<div class="dock-journeys">
						<div>
							<strong>Journey examples</strong><span
								>Before → after · {impactCumulative
									? 'current network vs proposal'
									: 'previous plan vs this change'}</span
							>
						</div>
						{#each impactExamples as result (result.originId)}<button
								disabled={editingPreview}
								onclick={() => selectOrigin(result.originId, true)}
								><span
									>{islandName(baseline, result.islandId)}<small
										>{number(result.population)} residents represented</small
									></span
								><strong
									>{formatJourneyTime(result.before)} <span>→</span>
									{formatJourneyTime(result.after)}</strong
								><ArrowUpRight size={14} /></button
							>{:else}<p>No supported journey improvements in this change.</p>{/each}
					</div>{/if}
				<nav class="build-palette" aria-label="Bus planning tools">
					<div class="build-tools">
						<button
							class:chosen={context === 'build'}
							aria-pressed={context === 'build'}
							disabled={!initialized || (busy && !placing)}
							onclick={() => beginBuild('stop')}
							><MapPinPlus size={20} strokeWidth={1.7} /><span>Add stop</span></button
						><button
							class:chosen={context === 'connect'}
							aria-pressed={context === 'connect'}
							disabled={!initialized || busy}
							onclick={() => beginConnection()}
							><Route size={20} strokeWidth={1.7} /><span>Draw route</span></button
						><button
							class:chosen={context === 'service' && !selectedStopId}
							aria-pressed={context === 'service' && !selectedStopId}
							disabled={!initialized || busy}
							onclick={beginRouteEdit}
							><Settings2 size={20} strokeWidth={1.7} /><span>Edit route</span></button
						>
					</div>
					<div class="build-history">
						<button
							disabled={!scenario.canUndo || busy || gesture === 'stop'}
							onclick={() => history('undo')}
							aria-label="Undo change"
							title="Undo · Ctrl+Z"><RotateCcw size={18} /><span>Undo</span></button
						><button
							disabled={!scenario.canRedo || busy || gesture === 'stop'}
							onclick={() => history('redo')}
							aria-label="Redo change"
							title="Redo · Ctrl+Shift+Z"><RotateCw size={18} /><span>Redo</span></button
						><button
							class="dock-options"
							onclick={() => openSettings('proposal')}
							aria-label="Proposal options"
							title="Proposal options"><Ellipsis size={20} /></button
						>
					</div>
				</nav>
			</div>
			{#if forecastSummary && context === null && !operationsOpen && !playbackOpen}
				<div class="map-outlook">{@render forecastSummary()}</div>
			{/if}
			<AtlasMap
				controlsHeight={mapOverlayHeight}
				{mobileBottomInset}
				planningDockActive={transportEditing}
				{land}
				{buildings}
				{streets}
				{areas}
				overlayOpacity={overlayOpacity / 100}
				analysisGrid={visualGrid}
				{wave}
				onwavefinish={finishWave}
				routes={mapRoutes}
				{symbols}
				{contextSymbols}
				{roadConditions}
				weatherAreas={operationsOpen ? weatherAreas : { type: 'FeatureCollection', features: [] }}
				{playbackSymbols}
				{selectedRoads}
				roadSelectionEnabled={operationsOpen && pickingRoads}
				onroadselect={toggleRoad}
				{policyLayers}
				oncontextselect={(kind) => {
					transportTab = kind === 'airport' ? 'airport' : 'boats';
					drawer = 'transport';
				}}
				journey={context === 'area' ? journey : { type: 'FeatureCollection', features: [] }}
				selectedId={context === 'area' || context === 'build' ? selectedMapId : ''}
				{view}
				{perspective}
				{detailGrid}
				{placing}
				{focusCoordinate}
				{overviewRequest}
				{editMode}
				{selectedStopId}
				connectionMode={context === 'connect'}
				{connectionStopIds}
				{connectionPreview}
				onconnectionstopselect={pickConnectionStop}
				onconnectionplace={placeConnectionStop}
				onconnectioncancel={dismissContext}
				placementLabel={movingStopId
					? 'Move the bus stop'
					: buildMode === 'clinic' || buildMode === 'school'
						? `Propose a ${buildMode}`
						: buildMode === 'stop'
							? 'Place a bus stop'
							: 'Place a bus connection'}
				{editRevision}
				{basemap}
				{satelliteStyle}
				{placementPoint}
				placementIcon={buildMode === 'clinic' || buildMode === 'school' ? buildMode : 'shelter'}
				placementState={movingStopId &&
				baseline.transit.stops.some((stop) => stop.id === movingStopId)
					? 'moved'
					: 'draft'}
				onhoverplace={previewPlacement}
				oncancelplace={dismissContext}
				onrouteselect={selectRoute}
				onclear={dismissContext}
				onbasemaperror={(reason) => {
					notice = reason;
					basemap = 'atlas';
				}}
				onstopselect={selectStop}
				onstopdragstart={startStopMove}
				onstoppreview={previewStopMove}
				onstopcommit={commitStopMove}
				onstopcancel={cancelDraft}
				onselect={(id, cellId) => selectOrigin(id, false, cellId)}
				onplace={placeOnMap}
				onready={(capture) => (snapshotMap = capture)}
			/>
			{#if wave}<div class="wave-status" role="status" aria-live="polite">
					<span class="wave-status-dot"></span>
					{wave.outcome === 'error'
						? 'Calculation unavailable'
						: wave.completedAt === null
							? 'Recalculating access…'
							: 'Updating map…'}
				</div>{/if}
			{#if placing && movingStopId}<div class="placement-prompt">
					Choose a street · click, or pan the target and press Enter
					<button onclick={() => cancelDraft()}>Cancel</button>
				</div>{/if}
			<details
				class="atlas-legend"
				bind:open={legendOpen}
				ontoggle={(event) => {
					if (event.currentTarget.open) workflowOpen = false;
				}}
				aria-label={view === 'access' ? 'Journey time bands' : 'Map legend'}
			>
				<summary>Map key <ChevronDown size={14} /></summary>
				<div class="legend-lines">
					{#if basemap === 'satellite'}<span class="imagery-caption">{imageryDetail}</span>{/if}
					{#if view === 'access'}
						<span class="time-key-title"
							>Time to {scenario.assumptions.goal === 'education' ? 'school' : 'care'}</span
						>
						{#each journeyLegend as band (band.id)}
							<span><i style:background={band.color}></i>{band.label}</span>
						{/each}
						{#if hasJourneyChanges}<button
								class="change-outline-key"
								onclick={() => (view = 'impact')}><i></i>Outlined = changed</button
							>{/if}
					{:else}
						{#if view === 'people'}<span><i class="reachable-key"></i>People · estimated</span>
						{:else}
							<span class="time-key-title"
								>{impactCumulative
									? 'Current network → proposal'
									: 'Previous plan → this change'}</span
							>
							<span><i class="faster-key"></i>Faster</span><span
								><i class="new-route-key"></i>New route possible</span
							>
							<span><i class="slower-key"></i>Worse / lost route</span><span
								><i class="unchanged-key"></i>Unchanged</span
							>
							<span><i class="mixed-key"></i>Partial / mixed</span><span
								><i class="unknown-key"></i>Incomplete data</span
							>
						{/if}
					{/if}
					<button onclick={() => (drawer = 'evidence')} class="stop-key-button"
						><i class="stop-key"></i>Existing assets</button
					>
					{#if hasProposedAssets || context === 'build'}<span class="proposal-key"
							><b aria-hidden="true">+</b>Proposed · not built</span
						>{/if}
				</div>
			</details>

			{#if playbackOpen}
				{#if isMobile}<MobileSheet
						title="Service playback"
						summary="Timetable illustration · not live tracking"
						bind:expanded={playbackExpanded}
						onclose={() => (playbackOpen = false)}
						onextent={(height) => (mobileSheetHeight = height)}
						>{@render playbackControls()}</MobileSheet
					>
				{:else}<aside class="decision-panel playback-holder" aria-label="Service playback">
						{@render playbackControls()}
					</aside>{/if}
			{:else if operationsOpen}
				{#if isMobile}<MobileSheet
						title="Test a disruption"
						summary={`${selectedRoads.length} roads selected · tap to edit`}
						bind:expanded={operationsExpanded}
						onclose={closeOperations}
						onextent={(height) => (mobileSheetHeight = height)}
						><OperationsPanel
							{baseline}
							bundle={operations}
							assumptions={scenario.assumptions}
							{analysis}
							selectedEdges={selectedRoads}
							picking={pickingRoads}
							onpick={() => {
								pickingRoads = !pickingRoads;
								operationsExpanded = !pickingRoads;
							}}
							onclear={() => (selectedRoads = [])}
							onchange={patchAssumptions}
							onclose={closeOperations}
						/></MobileSheet
					>
				{:else}<aside class="decision-panel operations-holder" aria-label="Test a disruption">
						<OperationsPanel
							{baseline}
							bundle={operations}
							assumptions={scenario.assumptions}
							{analysis}
							selectedEdges={selectedRoads}
							picking={pickingRoads}
							onpick={() => (pickingRoads = !pickingRoads)}
							onclear={() => (selectedRoads = [])}
							onchange={patchAssumptions}
							onclose={closeOperations}
						/>
					</aside>{/if}
			{:else if context === 'area'}
				{#if isMobile}
					<MobileSheet
						title={mobileContextTitle}
						summary={mobileContextSummary}
						bind:expanded={mobileDetailExpanded}
						onclose={dismissContext}
						onextent={(height) => (mobileSheetHeight = height)}
					>
						{@render contextBody()}
					</MobileSheet>
				{:else}
					<aside
						class="decision-panel"
						aria-label={context === 'area'
							? 'Selected area'
							: context === 'build'
								? 'Build a proposed asset'
								: context === 'connect'
									? 'Connect bus stops'
									: 'Selected transport service'}
					>
						<div class="context-heading">
							<span class="eyebrow"
								>{context === 'area'
									? 'SELECTED AREA'
									: context === 'build'
										? 'PROPOSE AN INVESTMENT'
										: context === 'connect'
											? 'DRAW A CONNECTION'
											: selectedStop
												? 'BUS STOP'
												: 'BUS SERVICE'}</span
							><button class="icon-button" aria-label="Close selection" onclick={dismissContext}
								><X size={17} /></button
							>
						</div>
						{@render contextBody()}
					</aside>
				{/if}
			{/if}
		</main>
	</div>
	<input
		type="file"
		accept=".json,application/json"
		class="hidden-upload"
		bind:this={upload}
		onchange={importScenario}
	/>
	{#if notice}<div class="notice" role="status">
			<span>{notice}</span>{#if scenario.archivedProposalJson}<button
					class="previous-proposal"
					onclick={exportPreviousScenario}>Download previous proposal</button
				>{/if}<button class="icon-button" aria-label="Dismiss notice" onclick={() => (notice = '')}
				><X size={15} /></button
			>
		</div>{/if}
	{#if drawer}
		<dialog
			bind:this={overlayDialog}
			class="atlas-dialog"
			class:sheet={drawer === 'evidence'}
			class:wide={drawer === 'compare'}
			class:transport-dialog={drawer === 'transport'}
			class:document={drawer === 'brief'}
			class:mobile-drawer={drawer.startsWith('mobile-')}
			aria-label={drawer.startsWith('mobile-')
				? drawer === 'mobile-menu'
					? 'Map tools'
					: drawer === 'mobile-map'
						? 'Map options'
						: drawer === 'mobile-areas'
							? hasProposal
								? 'Journey changes'
								: 'Suggested investment areas'
							: 'Policy results'
				: drawer === 'evidence'
					? 'Data evidence'
					: drawer === 'services'
						? 'Services and stops'
						: drawer === 'assumptions'
							? 'Planning settings'
							: drawer === 'compare'
								? 'Compare investments'
								: drawer === 'transport'
									? 'Sea and air transport context'
									: 'Printable policy brief'}
			oncancel={closeOverlay}
			onclose={() => (drawer = null)}
			onclick={(event) => {
				if (event.target !== event.currentTarget) return;
				const rect = event.currentTarget.getBoundingClientRect();
				if (
					event.clientX < rect.left ||
					event.clientX > rect.right ||
					event.clientY < rect.top ||
					event.clientY > rect.bottom
				)
					closeOverlay();
			}}
		>
			{#if drawer.startsWith('mobile-')}
				<div class="mobile-drawer-content">
					<div class="drawer-heading">
						<div>
							<span class="eyebrow">MAP WORKSPACE</span>
							<h2>
								{drawer === 'mobile-menu'
									? 'Map tools'
									: drawer === 'mobile-map'
										? 'Make the map yours'
										: drawer === 'mobile-areas'
											? hasProposal
												? 'See what improved'
												: 'Find an access gap'
											: hasProposal || draft || liveActions
												? 'Scenario results'
												: 'Current access'}
							</h2>
						</div>
						<button class="icon-button" aria-label="Close drawer" onclick={closeOverlay}
							><X size={20} /></button
						>
					</div>
					<div class="mobile-drawer-body">
						{#if drawer === 'mobile-menu'}
							<div class="mobile-menu-list">
								<button onclick={() => (drawer = 'mobile-map')}
									><Layers size={20} /><span
										><strong>Map appearance</strong><small
											>Layers, imagery, colors and perspective</small
										></span
									><ChevronRight size={17} /></button
								>
								<button
									onclick={() => {
										focusCoordinate = null;
										overviewRequest += 1;
										closeOverlay();
									}}
									><LocateFixed size={20} /><span
										><strong>Show map overview</strong><small
											>Fit the loaded islands and network</small
										></span
									><ChevronRight size={17} /></button
								>
								<button
									onclick={() => {
										closeOverlay();
										tour = 0;
										workflowOpen = true;
										areasExpanded = true;
									}}
									><Info size={20} /><span
										><strong>Map tour</strong><small
											>Explore an area, test a proposal and inspect results</small
										></span
									><ChevronRight size={17} /></button
								>
								<button
									onclick={() => {
										closeOverlay();
										togglePlayback();
									}}
									><BusFront size={20} /><span
										><strong>Service playback</strong><small
											>Illustrate a route and its schedule</small
										></span
									><ChevronRight size={17} /></button
								>
								<button onclick={() => (drawer = 'evidence')}
									><Layers size={20} /><span
										><strong>Evidence</strong><small>Sources, coverage and data gaps</small></span
									><ChevronRight size={17} /></button
								>
								<button onclick={() => openSettings()}
									><Settings2 size={20} /><span
										><strong>Planning settings</strong><small
											>Journey, cost and carbon assumptions</small
										></span
									><ChevronRight size={17} /></button
								>
								<button onclick={compareAlternatives} disabled={busy || !selectedId}
									><ArrowUpRight size={20} /><span
										><strong>Compare investments</strong><small
											>{selectedId
												? 'Rank feasible options within both limits'
												: 'Choose an area on the map first'}</small
										></span
									><ChevronRight size={17} /></button
								>
								<button onclick={openBrief} disabled={busy || !analysis}
									><FileText size={20} /><span
										><strong>Policy brief</strong><small>A printable summary of your proposal</small
										></span
									><ChevronRight size={17} /></button
								>
								<button onclick={() => (drawer = 'transport')}
									><TransportGraphic kind="speedboat" size={28} /><span
										><strong>Sea &amp; air</strong><small
											>Vessels, port calls and airport context</small
										></span
									><ChevronRight size={17} /></button
								>
								<button onclick={() => openSettings('proposal')}
									><Ellipsis size={20} /><span
										><strong>Your proposal</strong><small
											>{busy
												? 'Recalculating before saving'
												: savedOnDevice
													? 'Saved on this device · import or export'
													: 'Save, import or export'}</small
										></span
									><ChevronRight size={17} /></button
								>
								<button onclick={resetToDefault} disabled={!initialized || busy}
									><ListRestart size={20} /><span
										><strong>Reset to default</strong><small
											>Starting map and planning settings · undoable</small
										></span
									><ChevronRight size={17} /></button
								>
							</div>
							<div class="mobile-history">
								<button
									disabled={!scenario.canUndo || gesture === 'stop'}
									onclick={() => history('undo')}><RotateCcw size={18} />Undo change</button
								><button
									disabled={!scenario.canRedo || gesture === 'stop'}
									onclick={() => history('redo')}><RotateCw size={18} />Redo change</button
								>
							</div>
							<button class="mobile-data-note" onclick={() => (drawer = 'evidence')}
								><Info size={15} />Partial timetable · review source coverage</button
							>
						{:else if drawer === 'mobile-map'}
							<section class="mobile-option-section">
								<h3>What do you want to see?</h3>
								<DiscreteTabs items={views} value={view} onchange={(next) => (view = next)} />
								<p class="journey-legend-note">{viewExplanation}</p>
							</section>
							<section class="mobile-option-section">
								<h3>Access to</h3>
								<DestinationPicker
									value={scenario.assumptions.goal}
									onchange={(goal) => patchAssumptions({ goal })}
								/>
							</section>
							<section class="mobile-option-section">
								<h3>Map appearance</h3>
								<div class="mobile-basemaps">
									{#each [{ id: 'atlas', label: 'Policy atlas', note: 'Calm · works offline' }, { id: 'streets', label: 'Street map', note: 'Road names · online' }, { id: 'satellite', label: 'Satellite', note: imageryDetail }] as option (option.id)}<button
											aria-pressed={basemap === option.id}
											onclick={() => (basemap = option.id as BasemapMode)}
											><span><strong>{option.label}</strong><small>{option.note}</small></span
											>{#if basemap === option.id}<Check size={18} />{/if}</button
										>{/each}
								</div>
								<button
									class="mobile-perspective"
									aria-pressed={perspective}
									onclick={() => (perspective = !perspective)}
									><span>Perspective view</span><span>{perspective ? 'On' : 'Off'}</span></button
								>
								{@render opacityControl('mobile-hexagon-opacity')}
								<AnnualImageryPicker
									evidence={operations?.earthObservation}
									year={imageryYear}
									onselect={selectImagery}
								/>
							</section>
							<details class="mobile-legend">
								<summary>How to read the map <ChevronDown size={15} /></summary>
								<div>
									{#if view === 'access'}
										{#each TRAVEL_TIME_BANDS as band (band.id)}
											<span><i style:background={band.color}></i>{band.label}</span>
										{/each}
									{:else if view === 'people'}
										<span><i class="reachable-key"></i>People · estimated</span>
									{:else}
										<span><i class="faster-key"></i>Faster</span><span
											><i class="new-route-key"></i>New route possible</span
										>
										<span><i class="slower-key"></i>Worse / lost route</span><span
											><i class="unchanged-key"></i>Unchanged</span
										>
										<span><i class="mixed-key"></i>Partial / mixed</span><span
											><i class="unknown-key"></i>Incomplete data</span
										>
									{/if}
									<span><i class="stop-key"></i>Existing assets</span><span class="proposal-key"
										><b>+</b>Proposed · not built</span
									>
								</div>
								{#if view === 'access'}<p class="journey-legend-note">
										Modeled walk, wait and ride time. Gray means incomplete data; mixed cells
										contain different time bands.
									</p>{/if}
								{#if view === 'impact'}<p class="journey-legend-note">
										Every shorter journey counts, even inside the same time band. Purple includes
										areas where only some residents see a change.
									</p>{/if}
							</details>
							{#if basemap === 'satellite'}<p class="imagery-license">
									<a href={imageryLicenseUrl} target="_blank" rel="noopener noreferrer"
										>{imageryLicenseNotice}</a
									>
								</p>{/if}
							<button class="primary-button full-width" onclick={closeOverlay}
								>Back to the map</button
							>
						{:else if drawer === 'mobile-areas'}
							<p class="mobile-drawer-intro">
								{hasProposal
									? 'See which journeys your proposal improves, then tap an example to inspect it.'
									: `Start with a place where reaching ${scenario.assumptions.goal === 'healthcare' ? 'care' : 'school'} takes too long.`}
							</p>
							<div class="mobile-priority-cards">
								{#if hasProposal}{@render changesCards()}{:else}{@render priorityCards()}{/if}
							</div>
						{:else}
							<p class="mobile-drawer-intro">
								{#if hasProposal || draft || liveActions}Your proposal, compared with the current
									network. Costs and emissions depend on your assumptions.
								{:else}Modelled access to {scenario.assumptions.goal === 'healthcare'
										? 'healthcare'
										: 'schools'} within {scenario.assumptions.targetMinutes} minutes. Journeys include
									walking, waiting and riding.{/if}
							</p>
							<p class="result-assumptions">
								{planningDateLabel} · {timeLabel(scenario.assumptions.departureMinutes)} MVT · {coverage.label}
							</p>
							<div class="mobile-detailed-results">{@render policyResults()}</div>
							<button class="secondary-button full-width" onclick={() => openSettings('journey')}
								>Review journey assumptions <ArrowUpRight size={15} /></button
							>
						{/if}
					</div>
				</div>
			{:else if drawer === 'transport'}
				<TransportContextPanel
					initialTab={transportTab}
					bundle={transportContext}
					{showVessels}
					{showAirport}
					onclose={closeOverlay}
					ontoggleVessels={(value) => (showVessels = value)}
					ontoggleAirport={(value) => (showAirport = value)}
					onfocus={(point) => {
						focusCoordinate = point;
						closeOverlay();
					}}
				/>
			{:else if drawer === 'brief'}<div class="brief-modal">
					<PolicyBrief
						title={`A connection to ${scenario.assumptions.goal === 'healthcare' ? 'care' : 'education'}`}
						summary={`${number(analysis?.summary.newlyReachedResidents)} additional residents within ${scenario.assumptions.targetMinutes} minutes of ${destinationScope}; ${number(analysis?.summary.lostAccessResidents)} lose access and ${number(analysis?.summary.unknownResidents)} have unknown results. Population distribution is modeled. ${coverage.label}; missing service can affect the comparison.`}
						metrics={[
							{
								label: 'Residents within target',
								before: number(analysis?.summary.baselineReachableResidents),
								after: number(analysis?.summary.scenarioReachableResidents),
								afterTone:
									(analysis?.summary.scenarioReachableResidents ?? 0) >=
									(analysis?.summary.baselineReachableResidents ?? 0)
										? 'favorable'
										: 'unfavorable',
								detail: `${number(analysis?.summary.newlyReachedResidents)} gain · ${number(analysis?.summary.lostAccessResidents)} lose · ${number(analysis?.summary.worsenedJourneyResidents)} have slower journeys`
							},
							{
								label: 'Additional capital',
								before: 'MVR 0',
								after: unpricedChange
									? 'Not yet costed'
									: money(analysis?.costs.capitalMvr?.central),
								detail: unpricedChange
									? 'Timetable and road implementation costs require operator and engineering review.'
									: `Illustrative low–high range: ${money(analysis?.costs.capitalMvr?.low)}–${money(analysis?.costs.capitalMvr?.high)}. Local prices require verification.`
							},
							{
								label: 'Annual operating change',
								before: 'MVR 0',
								after: unpricedChange
									? 'Not yet costed'
									: money(analysis?.costs.annualOperatingMvr?.central),
								detail: unpricedChange
									? 'Timetable and road implementation costs are unestablished; MVR 0 is not a feasibility finding.'
									: `Illustrative low–high range: ${money(analysis?.costs.annualOperatingMvr?.low)}–${money(analysis?.costs.annualOperatingMvr?.high)}. Local rates require verification.`
							},
							{
								label: 'Annual emissions change',
								before: '0',
								after:
									analysis?.carbon.central == null
										? null
										: `${analysis.carbon.central > 0 ? '+' : ''}${number(analysis.carbon.central / 1000, 1)}`,
								afterTone:
									analysis?.carbon.central == null || analysis.carbon.central === 0
										? 'neutral'
										: analysis.carbon.central > 0
											? 'unfavorable'
											: 'favorable',
								unit: 't CO₂e'
							}
						]}
						interventions={[
							...scenario.actions.map(describeAction),
							...(scenario.assumptions.disruptions ?? []).map(
								(e) =>
									`${e.name}: assumed ${e.kind} on ${e.edgeIds.length} road segments; ${e.startDate} ${timeLabel(e.startMinutes)}–${e.endDate} ${timeLabel(e.endMinutes)} MVT.`
							)
						]}
						evidence={[
							...sourceEvidence,
							...(operations?.sources ?? []).map((s) => ({
								name: s.title,
								status: s.status,
								date: s.retrievedAt ?? 'Unavailable',
								detail: s.coverage,
								url: s.url
							}))
						]}
						assumptions={[
							`${scenario.assumptions.date}, ${timeLabel(scenario.assumptions.departureMinutes)} MVT; ${scenario.assumptions.targetMinutes}-minute target; max ${scenario.assumptions.maxTransfers} transfers.`,
							`${scenario.assumptions.populationYear} population is modeled within official island totals${scenario.assumptions.housingDistribution?.length ? '; housing completion is conditional' : ''}.`,
							`${coverage.label}; full calendars and ferry crossing times are incomplete.`,
							`${destinationScope}${scenario.assumptions.destinationRequirements?.publicAccess === 'public' ? ', public only' : ''}; ${scenario.assumptions.destinationRequirements?.requireOpenAtDeparture ? 'verified hours required' : 'hours unverified'}. Required missing metadata stays unknown.`,
							'Costs and energy factors are illustrative. Carbon depends on assumed private-travel displacement; added service can increase emissions.',
							...(scenario.assumptions.disruptions?.length
								? [
										'Temporary road event operations and fleet requirements are reported separately; annual investment figures do not annualize temporary closures. Frequency/walking road restrictions use selected departure time; scheduled bus delays propagate through their actual segment times.'
									]
								: []),
							...(appointmentResult
								? [
										`Appointment return check: ${appointmentResult.status}; ${appointmentOptions.appointmentMinutes} minutes at destination; home by ${timeLabel(appointmentOptions.returnDeadlineMinutes)} MVT. ${appointmentResult.reason ?? 'Same verified destination and original resident location.'}`,
										...appointmentResult.warnings
									]
								: []),
							`${scenario.assumptions.annualOperatingDays} operating days/year. Cost and carbon rows are incremental changes, not whole-network totals.`,
							`${coverage.supportedStartMinutes == null ? 'No supported service window.' : `Observed service window ${timeLabel(coverage.supportedStartMinutes)}–${timeLabel(coverage.supportedEndMinutes ?? coverage.supportedStartMinutes)} MVT.`} WorldPop weights are normalized to official projected island totals.`,
							`Walking speed: ${scenario.assumptions.walkMPerMinute} metres/minute. ${scenario.assumptions.walkingRequirements?.requireAuditedWheelchair ? 'Audited wheelchair routes required; incomplete audits remain unavailable.' : 'Mapped paths are not a continuous accessibility audit.'}`,
							...(scenario.assumptions.housingDistribution?.length
								? [
										'Conditional 2030 housing allocation redistributes population within each official island total; completion and neighborhood occupancy are not observed.'
									]
								: []),
							...(scenario.assumptions.fareAffordability
								? [
										`Assumed fare ${scenario.assumptions.fareAffordability.oneWayFareMvr} MVR × ${scenario.assumptions.fareAffordability.monthlyTrips} monthly trips; household budget ${scenario.assumptions.fareAffordability.monthlyHouseholdBudgetMvr || 'unavailable'} MVR/month. HIES context is historical, not neighborhood income.`
									]
								: []),
							'Costs and energy factors are editable illustrative ranges, not calibrated route budgets.',
							`Private trips shifted: ${dailyPrivateTrips.low} / ${dailyPrivateTrips.central} / ${dailyPrivateTrips.high} per day; ${privateDistanceKm} km; occupancy ${privateOccupancy}.`,
							`Displaced passenger-km/year: ${number(scenario.assumptions.displacedPassengerKm.low)} / ${number(scenario.assumptions.displacedPassengerKm.central)} / ${number(scenario.assumptions.displacedPassengerKm.high)}.`,
							...(costUnavailable
								? costUnavailableReasons.map((reason) => `Cost limitation: ${reason}`)
								: []),
							...(analysis?.carbon.central == null
								? carbonUnavailableReasons.map((reason) => `Carbon limitation: ${reason}`)
								: []),
							`Data ${baseline.version} · model ${analysis?.versionPins.model ?? 'loading'}`
						]}
						{mapImage}
						delivery={{
							agency: policyDelivery.responsibleAgency,
							phases: policyDelivery.phases,
							verification: policyDelivery.outstandingVerification
						}}
						islandImpacts={(analysis?.islandSummaries ?? []).map((island) => ({
							name: islandName(baseline, island.islandId),
							gained: island.gainedResidents,
							lost: island.lostResidents,
							unknown: island.unknownResidents
						}))}
						version={`${baseline.version} · ${analysis?.versionPins.model ?? 'loading'} · ${policyEvidence?.version ?? 'no supporting snapshot'}`}
						provenance={{
							datasetVersion: baseline.version,
							modelVersion: analysis?.versionPins.model,
							policyEvidenceVersion: policyEvidence?.version,
							operationsVersion: operations?.version,
							disruptionImpact: analysis?.disruptionImpact,
							robustness: analysis?.robustness,
							appointment: appointmentResult,
							planningAssumptions: scenario.assumptions,
							scenarioActions: structuredClone($state.snapshot(scenario.actions)),
							sourceMetadata: [
								...baseline.sources,
								...(policyEvidence?.sources ?? []),
								...(operations?.sources ?? [])
							]
						}}
						mapCaption="Greater Malé · top-down planning atlas"
						carbonRange={{
							low: analysis?.carbon.low == null ? null : analysis.carbon.low / 1000,
							high: analysis?.carbon.high == null ? null : analysis.carbon.high / 1000,
							unit: 't CO₂e / yr',
							assumption: 'Sensitivity range; not a statistical confidence interval.'
						}}
						generatedAt={new Date().toLocaleDateString('en-GB', { timeZone: 'Indian/Maldives' })}
						onclose={closeOverlay}
					/>
				</div>
			{:else if drawer === 'compare'}<div class="compare-modal">
					<div class="drawer-heading">
						<div>
							<span class="eyebrow">CHOOSE THE TRADEOFF</span>
							<h2>Find an investment that fits.</h2>
						</div>
						<button class="icon-button" aria-label="Close comparison" onclick={closeOverlay}
							><X size={21} /></button
						>
					</div>
					<p>
						Options build on your current proposal and use the same area, time, and assumptions.
						Only options within both budget limits appear. Costs remain illustrative.
					</p>
					<div class="budget-fields">
						<label
							>Capital budget (MVR)<input
								type="number"
								min="0"
								step="100000"
								bind:value={capitalBudget}
								disabled={busy}
								oninput={() => {
									comparisonDone = false;
									comparisons = [];
								}}
							/></label
						><label
							>Annual operating budget (MVR)<input
								type="number"
								min="0"
								step="100000"
								bind:value={annualBudget}
								disabled={busy}
								oninput={() => {
									comparisonDone = false;
									comparisons = [];
								}}
							/></label
						>
					</div>
					<div class="comparison-actions">
						<DiscreteTabs
							label="Budget sensitivity basis"
							disabled={busy}
							items={[
								{ id: 'central', label: 'Central estimates' },
								{ id: 'high', label: 'High cost case' }
							]}
							value={costBasis}
							onchange={(value) => {
								costBasis = value as 'central' | 'high';
								comparisonDone = false;
								comparisons = [];
							}}
						/><button class="secondary-button" disabled={busy} onclick={compareAlternatives}
							>Recalculate options</button
						>
					</div>
					<div class="alternative-grid">
						{#if !comparisons.length}<p>
								{comparisonDone
									? 'No affordable option with a modeled benefit was found. Adjust the limits, try another area, or collect better service data.'
									: busy
										? 'Searching affordable alternatives on the same network…'
										: 'Limits changed. Recalculate to find options that fit.'}
							</p>{/if}
						{#each comparisons as alternative (alternative.id)}<article>
								<div class="alternative-heading">
									<span aria-hidden="true"
										><TransportGraphic
											kind={alternative.label === 'A cleaner fleet' ? 'shelter' : 'bus'}
											size={42}
										/></span
									>
									<h3>{alternative.label}</h3>
								</div>
								<p>{alternative.description}</p>
								<dl>
									<div>
										<dt>Additional people</dt>
										<dd>+{number(alternative.evaluation.additionalResidents)}</dd>
									</div>
									<div>
										<dt>Journey change</dt>
										<dd>
											{alternative.evaluation.minutesSaved == null
												? 'Unavailable'
												: `${number(Math.abs(alternative.evaluation.minutesSaved), 1)} min ${alternative.evaluation.minutesSaved < 0 ? 'slower' : 'saved'}`}
										</dd>
									</div>
									<div>
										<dt>Capital · {costBasis} case</dt>
										<dd>{money(alternative.result.costs.capitalMvr?.[costBasis])}</dd>
									</div>
									<div>
										<dt>Annual operations · {costBasis} case</dt>
										<dd>{money(alternative.result.costs.annualOperatingMvr?.[costBasis])}</dd>
									</div>
									<div>
										<dt>Emissions / year</dt>
										<dd class:increase={(alternative.result.carbon.central ?? 0) > 0}>
											{alternative.result.carbon.central == null
												? 'Unavailable'
												: `${alternative.result.carbon.central > 0 ? '+' : ''}${number(alternative.result.carbon.central / 1000, 1)} t CO₂e`}
										</dd>
									</div>
								</dl>
								<p class="investment-explanation">{alternative.evaluation.explanation}</p>
								<RobustnessPanel result={alternative.result.robustness} />
								<p class="technical-note">
									Capital range {money(alternative.result.costs.capitalMvr?.low)}–{money(
										alternative.result.costs.capitalMvr?.high
									)}. Annual operations {money(
										alternative.result.costs.annualOperatingMvr?.low
									)}–{money(alternative.result.costs.annualOperatingMvr?.high)}.
								</p>
								<span class="budget-status"
									>Within both {costBasis} cost limits · {alternative.evaluation.evidence} evidence</span
								>
								<button
									class="primary-button"
									disabled={!comparisonDone ||
										(alternative.result.costs.capitalMvr?.[costBasis] ?? Infinity) >
											capitalBudget ||
										(alternative.result.costs.annualOperatingMvr?.[costBasis] ?? Infinity) >
											annualBudget}
									onclick={() => useAlternative(alternative.actions)}
									>Use this alternative <ChevronRight size={15} /></button
								>
							</article>{/each}
					</div>
					{#if comparisonNotes.length}<details class="evidence-group">
							<summary>Search limits & excluded options</summary>
							<ul>
								{#each comparisonNotes as note (note)}<li>{note}</li>{/each}
							</ul>
						</details>{/if}
					<p class="comparison-footnote">
						Additional people and journey changes are relative to your current proposal. Cost limits
						apply to the whole resulting proposal. Capital and operations remain separate.
						Accessibility gains do not imply that residents switch modes; carbon depends on the
						private-travel assumptions.
					</p>
				</div>
			{:else if drawer === 'services'}<div class="service-modal">
					<div class="drawer-heading">
						<div>
							<span class="eyebrow">NETWORK EDITOR</span>
							<h2>Services & stops</h2>
						</div>
						<button class="icon-button" aria-label="Close services" onclick={closeOverlay}
							><X size={21} /></button
						>
					</div>

					{#if analysis}<ServiceManager
							patterns={analysis.world.patterns}
							stops={reviewedStops}
							onaction={(action) => {
								cancelDraft();
								recordEdit(
									action.kind === 'disable-stop' || action.kind === 'enable-stop'
										? 'Stop availability changed'
										: action.kind === 'set-hours'
											? 'Operating hours changed'
											: 'Service updated',
									() => scenario.addAction(action)
								);
								revealProposalChanges();
								busy = true;
							}}
							onmove={(stopId) => {
								closeOverlay();
								beginStopMove(stopId);
							}}
							onconnect={(stopId) => {
								closeOverlay();
								beginConnection(stopId);
							}}
							onaddstop={() => {
								closeOverlay();
								beginBuild('stop');
							}}
							onnewconnection={() => {
								closeOverlay();
								beginConnection();
							}}
						/>{/if}
					<details class="evidence-group">
						<summary>Test an inter-island return journey</summary><FerryAssumptionPanel
							{baseline}
							evidence={operations?.ferryEvidence ?? null}
							date={scenario.assumptions.date}
							onapply={(action, warnings) => {
								cancelDraft();
								scenario.addAction(action);
								notice = warnings.join(' ');
							}}
						/>
					</details>
				</div>
			{:else}<div class="evidence-drawer">
					<div class="drawer-heading">
						<div>
							<span class="eyebrow"
								>{drawer === 'evidence'
									? 'THE EVIDENCE BEHIND THE ATLAS'
									: 'MAKE THE ASSUMPTIONS YOURS'}</span
							>
							<h2>
								{drawer === 'evidence' ? 'Evidence & coverage' : 'Planning settings'}
							</h2>
						</div>
						<button class="icon-button" aria-label="Close panel" onclick={closeOverlay}
							><X size={21} /></button
						>
					</div>
					{#if drawer === 'evidence'}
						<PolicyEvidencePanel
							evidence={policyEvidence}
							enabledLayers={enabledPolicyLayers}
							ontoggle={togglePolicyLayer}
						/>
						{#if costUnavailableReasons.length || carbonUnavailableReasons.length}<section
								class="evidence-explanation unavailable-reasons"
								aria-label="Why current results are unavailable"
							>
								<strong>Why some results are unavailable</strong>
								{#if costUnavailableReasons.length}<h3>Cost inputs</h3>
									<ul>
										{#each costUnavailableReasons as reason (reason)}<li>{reason}</li>{/each}
									</ul>{/if}
								{#if carbonUnavailableReasons.length}<h3>Carbon inputs</h3>
									<ul>
										{#each carbonUnavailableReasons as reason (reason)}<li>{reason}</li>{/each}
									</ul>{/if}
							</section>{/if}

						<div class="evidence-explanation">
							<strong>What is measured, and what is modeled?</strong>
							<p>
								Island population totals are official projections. Neighborhood residents are a
								modeled allocation using WorldPop weights on mapped land. Route departures are
								snapshots of published services. Proposed service, cost and carbon inputs are
								scenario assumptions.
							</p>
							<p>
								Access colors show modeled walk, wait and ride time to the selected destination
								type, in 5, 10, 15 and 30-minute bands. Gray means incomplete data. Mixed times mean
								a honeycomb contains residents from different time bands; its example journey
								represents one contributing population origin. What changed (Impact) compares actual
								journeys before and with your proposal, including shorter journeys within the same
								time band. Green outlines mark improvements, red marks worse journeys, and purple
								marks partial or mixed changes. Unknown baseline evidence never counts as a gain.
							</p>
						</div>
						<p class="data-gap">
							Partial timetable snapshot. Missing services and unverified locations can affect
							access estimates.
						</p>
						<div class="coverage-stats">
							<div>
								<strong>{number(shown?.summary.population)}</strong><span
									>residents represented</span
								>
							</div>
							<div>
								<strong>{number(stopCounts.timed)}</strong><span
									>stops linked to loaded timetables</span
								>
							</div>
							<div>
								<strong>{number(baseline.transit.patterns.length)}</strong><span
									>loaded directions / patterns</span
								>
							</div>
							<div>
								<strong>{number(eligibleDestinations.length)}</strong><span
									>baseline destinations for this goal</span
								>
							</div>
						</div>
						{#if snapshotStale}<p class="data-gap">
								A newer snapshot could not be validated. This is the last validated version;
								location status may have changed since its review date.
							</p>{/if}
						<details class="evidence-group">
							<summary>Map locations & layers</summary>
							<p>
								{number(stopCounts.listed)} RTL stop codes at {number(stopCounts.sites)} coordinate sites
								in Greater Malé. Opposite-direction codes stay separate in routing and share a map dot
								when their coordinates match. These are operator-listed locations, not a field survey.
							</p>
							<p>
								{number(stopCounts.untimed)} operator stop codes have no loaded timetable. They stay hidden
								during editing too; missing timing does not establish that a stop is closed. The loaded
								timetable is a partial, dated snapshot.
							</p>
							<label class="audit-toggle"
								><input type="checkbox" bind:checked={includeUntimedStops} /> Show stops without loaded
								service</label
							>
							<label class="audit-toggle"
								><input type="checkbox" bind:checked={detailGrid} />Emphasize honeycomb boundaries</label
							>
							<p>
								{number(eligibleHealthcare.length)} mapped general-care destinations pass the status and
								location checks out of {number(healthcareInventory.length)} healthcare records. Closed,
								relocated, restricted, specialist, and unverified records do not contribute to general-care
								access. Registry status does not establish opening hours or every available treatment.
							</p>
						</details>
						<details class="facility-audit">
							<summary>Review healthcare locations</summary>
							{#each healthcareInventory as facility (facility.id)}<article>
									<strong>{facility.name}</strong><span
										class:excluded={!isEligibleFacility(facility, 'healthcare')}
										>{isEligibleFacility(facility, 'healthcare')
											? 'Included · general care'
											: 'Excluded'} · {facility.operatingStatus === 'open'
											? 'open in registry'
											: (facility.operatingStatus ?? 'status unverified')}</span
									>
									<p>{facility.statusNote ?? 'Current operating status requires verification.'}</p>
									{#if facility.statusReviewedAt}<small>Reviewed {facility.statusReviewedAt}</small
										>{/if}
									{#each facility.statusSourceIds ?? [] as sourceId (sourceId)}{@const source =
											baseline.sources.find((entry) => entry.id === sourceId)}{#if source?.url}<a
												href={source.url}
												target="_blank"
												rel="noreferrer"
												>{source.title ?? 'Status evidence'} <ArrowUpRight size={12} /></a
											>{/if}{/each}
								</article>{/each}
						</details>
						<details class="facility-audit">
							<summary>Review education locations</summary>
							<p>
								School access includes reviewed school locations with positive institution evidence.
								Unverified or relocated sites, colleges, care homes and therapy services do not
								count. A reviewed listing does not establish opening hours, enrolment eligibility or
								a surveyed entrance.
							</p>
							{#each educationInventory as facility (facility.id)}<article>
									<strong>{facility.name}</strong><span
										class:excluded={!isEligibleFacility(facility, 'education')}
										>{isEligibleFacility(facility, 'education')
											? 'Included in school access'
											: 'Excluded from school access'} · {facility.operatingStatus === 'open'
											? 'institution evidenced'
											: (facility.operatingStatus ?? 'operation unverified')}</span
									>
									<p>{facility.statusNote ?? String(facility.qualification ?? '')}</p>
									{#if facility.statusReviewedAt}<small>Reviewed {facility.statusReviewedAt}</small
										>{/if}
									{#each facility.statusSourceIds ?? [] as sourceId (sourceId)}{@const source =
											baseline.sources.find((entry) => entry.id === sourceId)}{#if source?.url}<a
												href={source.url}
												target="_blank"
												rel="noreferrer"
												>{source.title ?? 'Institution evidence'} <ArrowUpRight size={12} /></a
											>{/if}{/each}
								</article>{/each}
						</details>
						{#if shown?.transportAccess}<details class="evidence-group">
								<summary>SDG-aligned spatial transit access</summary>
								<p>
									{number(shown.transportAccess.beforeResidents)} baseline residents → {number(
										shown.transportAccess.afterResidents
									)} in the proposal. {shown.transportAccess.method}
								</p>
								<p>
									This estimates network walking distance to loaded, active services. It does not
									establish full convenient or accessible public transport.
								</p>
							</details>{/if}
						<details class="evidence-group">
							<summary>Population totals & demographics</summary>
							<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard access to the horizontally scrollable table.) -->
							<div
								class="table-scroll"
								role="region"
								aria-label="Island population totals"
								tabindex="0"
							>
								<table class="population-table">
									<thead
										><tr><th>Island</th><th>Census 2022</th><th>Plan 2026</th><th>Plan 2030</th></tr
										></thead
									><tbody
										>{#each baseline.islands as island (island.id)}<tr
												><th>{island.name}</th><td
													>{number(island.census2022Population as number | null)}</td
												><td>{number(island.population2026 as number | null)}</td><td
													>{number(island.population2030 as number | null)}</td
												></tr
											>{/each}</tbody
									>
								</table>
							</div>
							<p class="technical-note">
								Projection totals are not observed neighborhood counts. Harbour residents are
								excluded; Hulhulé projections are unavailable because the source groups industrial
								islands together.
							</p>
							<DemographicsPanel
								data={baseline.demographics}
								names={Object.fromEntries(
									baseline.islands.map((island) => [island.id, island.name])
								)}
							/>
						</details>
						<details class="evidence-group">
							<summary>Known coverage limitations · {baseline.transit.gaps.length}</summary>
							{#each baseline.transit.gaps as gap (gap)}<p class="data-gap">{gap}</p>{/each}
						</details>
						<details class="evidence-group">
							<summary>Source catalogue · {baseline.sources.length} records</summary>
							<p class="snapshot-version">
								{baseline.version} · retrieved {baseline.generatedAt.slice(0, 10)}<br />{number(
									baseline.network.nodes.length
								)} street nodes · {number(baseline.network.edges.length)} topology-preserving edges
							</p>
							{#if scenario.archivedProposalJson}<button
									class="previous-proposal"
									onclick={exportPreviousScenario}
									>Download proposal saved before the data update</button
								>
								<p>
									The original JSON is preserved with its previous data and model versions. Recreate
									its interventions against this reviewed baseline to calculate current results.
								</p>{/if}
							<label class="source-search"
								>Find a source<input
									type="search"
									bind:value={sourceSearch}
									placeholder="Publisher, name or period"
								/></label
							>
							<p>{filteredSources.length} of {baseline.sources.length} records</p>
							<div class="source-list">
								{#each filteredSources as source (source.id)}<article>
										<a href={source.url} target="_blank" rel="noreferrer"
											>{source.title ?? source.id}<ArrowUpRight size={14} /></a
										>
										<p>
											{String(source.publisher ?? '')} · {String(
												source.referencePeriod ??
													source.referenceDate ??
													'Period recorded in manifest'
											)}
										</p>
										<span>{String(source.status ?? 'Cached public source')}</span
										>{#if source.qualification}<p>{String(source.qualification)}</p>{/if}
									</article>{/each}
							</div>
						</details>
						<details class="evidence-group">
							<summary>Credits & reuse terms</summary>
							<p class="interface-credits">
								Svelte controls adapted from <a
									href="https://www.rareui.com/"
									target="_blank"
									rel="noreferrer">Rare UI</a
								>
								and
								<a href="https://uselayouts.com/" target="_blank" rel="noreferrer">useLayouts</a>.
							</p>
							<p class="technical-note">
								No live vehicle tracking is displayed. OSM street geometry is © OpenStreetMap
								contributors, ODbL. WorldPop is CC BY 4.0. Other source reuse terms are recorded in
								the manifest.
							</p>
						</details>{:else}<div class="settings-navigation">
							<DiscreteTabs
								items={settingsTabs}
								value={settingsTab}
								label="Settings section"
								onchange={(next) => (settingsTab = next)}
							/>
						</div>
						<p class="drawer-intro">
							{settingsTab === 'journey'
								? 'Choose when people travel and how far they should be able to reach. Results update automatically.'
								: settingsTab === 'proposal'
									? 'Your changes save on this device. Export a copy to share or keep.'
									: 'Editable estimates. Low and high values describe sensitivity cases, not confidence intervals.'}
						</p>
						{#if settingsTab === 'journey'}<div class="assumption-section">
								<h3>The journey</h3>
								<DestinationRequirements
									assumptions={scenario.assumptions}
									onchange={patchAssumptions}
								/>
								<div class="year-toggle" aria-label="Planning population year">
									<button
										class:active={scenario.assumptions.populationYear === 2026}
										aria-pressed={scenario.assumptions.populationYear === 2026}
										onclick={() => patchAssumptions({ populationYear: 2026 })}
										>2026 population</button
									><button
										class:active={scenario.assumptions.populationYear === 2030}
										aria-pressed={scenario.assumptions.populationYear === 2030}
										onclick={() => patchAssumptions({ populationYear: 2030 })}>Plan for 2030</button
									>
								</div>
								<div class="settings-grid journey-basics">
									<label
										>Planning date<input
											type="date"
											value={scenario.assumptions.date}
											onchange={(e) => patchAssumptions({ date: e.currentTarget.value })}
										/></label
									><label
										>Departure (Maldives time)<input
											type="time"
											value={timeLabel(scenario.assumptions.departureMinutes)}
											onchange={(e) => {
												const [hours, minutes] = e.currentTarget.value.split(':').map(Number);
												patchAssumptions({ departureMinutes: hours * 60 + minutes });
											}}
										/></label
									><label
										>Access target (min)<input
											type="number"
											min="5"
											max="90"
											value={scenario.assumptions.targetMinutes}
											onchange={(e) =>
												patchAssumptions({ targetMinutes: Number(e.currentTarget.value) })}
										/></label
									>
								</div>
								<details class="evidence-group">
									<summary>Walking, transfers & service cycle</summary>
									<div class="settings-grid">
										<label class="audit-toggle"
											><input
												type="checkbox"
												checked={scenario.assumptions.walkingRequirements
													?.requireAuditedWheelchair ?? false}
												onchange={(event) =>
													patchAssumptions({
														walkingRequirements: {
															requireAuditedWheelchair: event.currentTarget.checked
														}
													})}
											/>Require a fully audited wheelchair route</label
										>
										<label
											>Maximum transfers<input
												type="number"
												min="0"
												max="2"
												value={scenario.assumptions.maxTransfers}
												onchange={(e) =>
													patchAssumptions({ maxTransfers: Number(e.currentTarget.value) })}
											/></label
										><label
											>Walking speed (m/min)<input
												type="number"
												min="20"
												max="120"
												value={scenario.assumptions.walkMPerMinute}
												onchange={(e) =>
													patchAssumptions({ walkMPerMinute: Number(e.currentTarget.value) })}
											/></label
										><label
											>Operating days / year<input
												type="number"
												min="1"
												max="366"
												value={scenario.assumptions.annualOperatingDays}
												onchange={(e) =>
													patchAssumptions({ annualOperatingDays: Number(e.currentTarget.value) })}
											/></label
										>
										<label
											>Stop access walk (min)<input
												type="number"
												min="1"
												max="60"
												value={scenario.assumptions.maxAccessWalkMinutes}
												onchange={(e) =>
													patchAssumptions({ maxAccessWalkMinutes: Number(e.currentTarget.value) })}
											/></label
										>
										<label
											>Transfer walk (min)<input
												type="number"
												min="0"
												max="30"
												value={scenario.assumptions.maxTransferWalkMinutes}
												onchange={(e) =>
													patchAssumptions({
														maxTransferWalkMinutes: Number(e.currentTarget.value)
													})}
											/></label
										>
										<label
											>New route speed (km/h)<input
												type="number"
												min="1"
												max="80"
												value={scenario.assumptions.busMovingKph}
												onchange={(e) =>
													patchAssumptions({ busMovingKph: Number(e.currentTarget.value) })}
											/></label
										>
										<label
											>New route stop dwell (min)<input
												type="number"
												min="0"
												max="10"
												step="0.1"
												value={scenario.assumptions.busDwellMinutes}
												onchange={(e) =>
													patchAssumptions({ busDwellMinutes: Number(e.currentTarget.value) })}
											/></label
										>
										<label
											>Layover per cycle (min)<input
												type="number"
												min="0"
												max="120"
												value={scenario.assumptions.layoverMinutes}
												onchange={(e) =>
													patchAssumptions({ layoverMinutes: Number(e.currentTarget.value) })}
											/></label
										>
										<label
											>Reserve share (0–1)<input
												type="number"
												min="0"
												max="1"
												step="0.05"
												value={scenario.assumptions.fleetReserveShare}
												onchange={(e) =>
													patchAssumptions({ fleetReserveShare: Number(e.currentTarget.value) })}
											/></label
										>
									</div>
								</details>
								<button
									class="secondary-button"
									onclick={() =>
										patchAssumptions({ date: baseline.referenceDate, departureMinutes: 16 * 60 })}
									>Try the recorded 16:00 departures</button
								>
								<p class="technical-note">
									The public timetable snapshot may omit earlier departures. Missing service records
									do not establish that no service exists.
								</p>
							</div>
						{:else if settingsTab === 'costs'}<div class="assumption-section">
								<h3>Investment & annual operations</h3>
								<DeliverySettings
									assumptions={scenario.assumptions}
									onchange={patchAssumptions}
									mode="fare"
								/>
								<label class="preset-toggle"
									><input
										type="checkbox"
										bind:checked={assumptionsEnabled}
										onchange={() => {
											const costs = assumptionsEnabled
												? { ...illustrativeCosts, ...baseline.costAnchors }
												: { ...baseline.costAnchors };
											patchAssumptions({
												costs,
												...Object.fromEntries(
													energyFields.map((field) => [
														field.key,
														assumptionsEnabled ? field.value : undefined
													])
												)
											});
										}}
									/>Use illustrative, editable defaults</label
								>
								<p>
									Operating rates include labor, energy and maintenance. Energy is not added again.
									Vehicle and stop investment is separate; electric charging is included.
								</p>
								<details class="evidence-group">
									<summary>Vehicles, stops & charging</summary>
									<div class="range-heading">
										<span>Input / units</span><span>Low</span><span>Central</span><span>High</span>
									</div>
									{#each costFields.slice(0, 4) as field (field.key)}<div class="range-row">
											<span class="range-label">{field.label}<small>{field.unit}</small></span
											>{#each ['low', 'central', 'high'] as part (part)}<input
													type="number"
													min="0"
													step="any"
													aria-label={`${field.label} ${part}`}
													value={(scenario.assumptions.costs[field.key] as NumericRange | null)?.[
														part as keyof NumericRange
													] ?? ''}
													placeholder="Unknown"
													onchange={(e) =>
														changeCost(
															field.key,
															part as keyof NumericRange,
															e.currentTarget.value
														)}
												/>{/each}
										</div>{/each}
								</details>
								<details class="evidence-group">
									<summary>Annual operating rates</summary>
									<div class="range-heading">
										<span>Input / units</span><span>Low</span><span>Central</span><span>High</span>
									</div>
									{#each costFields.slice(4, 6) as field (field.key)}<div class="range-row">
											<span class="range-label">{field.label}<small>{field.unit}</small></span
											>{#each ['low', 'central', 'high'] as part (part)}<input
													type="number"
													min="0"
													step="any"
													aria-label={`${field.label} ${part}`}
													value={(scenario.assumptions.costs[field.key] as NumericRange | null)?.[
														part as keyof NumericRange
													] ?? ''}
													placeholder="Unknown"
													onchange={(e) =>
														changeCost(
															field.key,
															part as keyof NumericRange,
															e.currentTarget.value
														)}
												/>{/each}
										</div>{/each}
								</details>
							</div>{:else if settingsTab === 'carbon'}<div class="assumption-section">
								<h3>Private travel that shifts to transit</h3>
								<p>
									These trips are assumed, not inferred from residents gaining access. Zero mode
									shift can mean that added service increases emissions.
								</p>
								<div class="range-heading">
									<span>Private trips / day</span><span>Low</span><span>Central</span><span
										>High</span
									>
								</div>
								<div class="range-row">
									<span class="range-label">Displaced trips</span
									>{#each ['low', 'central', 'high'] as part (part)}<input
											type="number"
											min="0"
											aria-label={`Displaced private trips ${part}`}
											value={dailyPrivateTrips[part as keyof NumericRange]}
											onchange={(e) =>
												updateDisplacement(part as keyof NumericRange, e.currentTarget.value)}
										/>{/each}
								</div>
								<div class="settings-grid">
									<label
										>Trip distance (km)<input
											type="number"
											min=".1"
											step=".1"
											bind:value={privateDistanceKm}
											onchange={() => updateDisplacement()}
										/></label
									><label
										>Private vehicle occupancy<input
											type="number"
											min="1"
											step=".1"
											bind:value={privateOccupancy}
											onchange={() => updateDisplacement()}
										/></label
									>
								</div>
								<section class="break-even">
									<div class="break-even-icon"><Leaf size={18} /></div>
									<div>
										<h3>Carbon break-even</h3>
										<p>
											{!scenario.actions.length && !draft
												? 'Add a service to see the travel shift needed to offset its emissions.'
												: breakEvenTrips == null
													? 'Missing inputs.'
													: `About ${number(breakEvenTrips)} private trips / day must shift to transit.`}
										</p>
									</div>
								</section>
								<details class="evidence-group">
									<summary>Fuel, electricity & carbon factors</summary>
									<p>
										Service kilometres × fuel or electricity use × carbon factor. These illustrative
										inputs take precedence over the fallback per-kilometre emissions when both
										factors are present. Electricity emissions are included.
									</p>
									<div class="range-heading">
										<span>Input / units</span><span>Low</span><span>Central</span><span>High</span>
									</div>
									{#each energyFields as field (field.key)}<div class="range-row">
											<span class="range-label">{field.label}<small>{field.unit}</small></span>
											{#each ['low', 'central', 'high'] as part (part)}<input
													type="number"
													min="0"
													step="any"
													aria-label={`${field.label} ${part}`}
													value={scenario.assumptions[field.key]?.[part as keyof NumericRange] ??
														''}
													placeholder="Unknown"
													onchange={(e) =>
														changeEnergy(
															field.key,
															part as keyof NumericRange,
															e.currentTarget.value
														)}
												/>{/each}
										</div>{/each}
								</details>
								<details class="evidence-group">
									<summary>Private travel & fallback emissions factors</summary>
									<p>
										Private travel uses the passenger-kilometre factor below. Transit per-kilometre
										factors apply only when a complete fuel or electricity factor pair is
										unavailable.
									</p>
									<div class="range-heading">
										<span>Input / units</span><span>Low</span><span>Central</span><span>High</span>
									</div>
									{#each costFields.slice(6) as field (field.key)}<div class="range-row">
											<span class="range-label">{field.label}<small>{field.unit}</small></span
											>{#each ['low', 'central', 'high'] as part (part)}<input
													type="number"
													min="0"
													step="any"
													aria-label={`${field.label} ${part}`}
													value={(scenario.assumptions.costs[field.key] as NumericRange | null)?.[
														part as keyof NumericRange
													] ?? ''}
													placeholder="Unknown"
													onchange={(e) =>
														changeCost(
															field.key,
															part as keyof NumericRange,
															e.currentTarget.value
														)}
												/>{/each}
										</div>{/each}
								</details>
								<details class="evidence-group">
									<summary>Service activity & model warnings</summary>{#if shown}<div
											class="model-notes"
										>
											<p>
												{number(shown.costs.annualVehicleKm)} vehicle-km / year · {number(
													shown.costs.annualVehicleHours
												)} vehicle-hours / year · {number(shown.costs.requiredFleet)} buses
											</p>
											{#each shown.warnings as warning (warning)}<p>{warning}</p>{/each}
											{#each [...new Set( [...shown.costs.unavailableReasons, ...shown.carbon.unavailableReasons] )] as reason (reason)}<p
												>
													{reason}
												</p>{/each}
										</div>{/if}
								</details>
							</div>{:else}<div class="assumption-section">
								<h3>Scenario management</h3>
								<DeliverySettings assumptions={scenario.assumptions} onchange={patchAssumptions} />
								{#if scenario.archivedProposalJson}<div class="evidence-explanation">
										<strong>Previous proposal preserved</strong>
										<p>Download the original file with its earlier data and model versions.</p>
										<button class="secondary-button" onclick={exportPreviousScenario}
											><Download size={15} />Download previous proposal</button
										>
									</div>{/if}
								<div class="management-actions">
									<button class="secondary-button" onclick={exportScenario}
										><Download size={15} />Export JSON</button
									><button class="secondary-button" onclick={() => upload.click()}
										><Upload size={15} />Import JSON</button
									><button
										class="secondary-button"
										disabled={!initialized || busy}
										onclick={resetToDefault}><ListRestart size={15} />Reset to default</button
									>
								</div>
								<p>
									Reset restores the starting map and planning settings. Undo brings back your
									proposal.
								</p>
								<DemoPresetPicker {baseline} onselect={loadDemo} />
								<p class="technical-note">
									Scenarios are pinned to data and model versions. Imports with incompatible
									versions are rejected. {analysisMs == null
										? ''
										: `Last analysis: ${number(analysisMs)} ms including worker messaging.`}
								</p>
							</div>{/if}{/if}
				</div>{/if}
		</dialog>
	{/if}
</div>

<style>
	.policy-atlas.embedded {
		height: 100% !important;
		min-height: 0;
	}
	@media (max-width: 680px) {
		.policy-atlas.embedded :global(.maplibregl-ctrl-bottom-left) {
			top: auto;
			bottom: calc(var(--mobile-map-bottom, 76px) + 8px);
			max-width: calc(100% - 78px);
		}
	}
	.operations-holder {
		overflow-y: auto;
		overscroll-behavior: contain;
		width: 370px;
	}
	.playback-holder {
		overflow-y: auto;
		overscroll-behavior: contain;
		width: 370px;
	}
	.playback-content {
		padding: 16px;
	}
	.playback-content :global(.service-playback) {
		margin-top: 12px;
	}
	.data-investigation {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		width: 100%;
		margin: 8px 0;
		padding: 11px;
		background: #f6f3e6;
		border: 1px solid #e7dfc8;
		border-radius: 8px;
		color: #827044;
		font: inherit;
		font-size: 11px;
		line-height: 1.5;
		text-align: left;
		cursor: pointer;
	}
	.island-impact {
		display: grid;
		gap: 5px;
		padding: 10px 0;
		border-bottom: 1px solid #e2e9db;
		font-size: 12px;
	}
	.island-impact small {
		color: #748467;
		font-size: 11px;
	}
	.housing-control {
		display: grid;
		gap: 7px;
		margin: 12px 0;
		font-size: 12px;
	}
	.housing-control input {
		min-width: 0;
		width: 100%;
		box-sizing: border-box;
		border: 1px solid #d7e2cf;
		background: white;
		border-radius: 8px;
		padding: 10px;
		font: inherit;
	}
	.comparison-actions {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 12px;
		margin: 18px 0;
	}
	.investment-explanation {
		border-left: 2px solid #9eb784;
		padding-left: 10px;
	}
	.atlas-dialog.transport-dialog {
		--transport-panel-height: calc(100dvh - 48px);
		width: min(920px, calc(100vw - 32px));
		overflow: hidden;
	}
	.context-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px 0;
	}
	.overlay-opacity-control {
		margin-top: 12px;
		padding-top: 12px;
		border-top: 1px solid #e3ebe7;
	}
	.overlay-opacity-label {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		font-size: 13px;
		color: #526e76;
	}
	.overlay-opacity-label output {
		font-weight: 600;
		color: #247963;
		font-variant-numeric: tabular-nums;
	}
	.overlay-opacity-control p {
		margin: 3px 0 0;
		font-size: 12px;
		line-height: 1.45;
		color: #71868a;
	}
	.imagery-license {
		margin: 8px 6px 2px;
		font-size: 12px;
		line-height: 1.5;
		color: #5e7778;
	}
	.imagery-license a {
		color: inherit;
		text-underline-offset: 3px;
	}
	.imagery-caption {
		color: #234e5a;
		font-weight: 600;
	}
	@keyframes selection-enter {
		from {
			opacity: 0;
			transform: translateY(6px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	.population-estimate {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-left: auto;
		flex-shrink: 0;
		background: none;
		border: 0;
		padding: 5px 0 5px 5px;
		min-height: 32px;
		font-size: 12px;
		color: #70878b;
	}
	.access-status {
		display: flex;
		align-items: center;
		gap: 7px;
		color: #25836e;
		font-size: 14px;
	}
	.access-status > span {
		width: 6px;
		height: 6px;
		background: currentColor;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.access-status.access-gap {
		color: #996d32;
	}
	.edit-journey {
		border-top: 1px solid var(--line);
		padding: 10px 0;
		font-size: 13px;
		color: #6b8388;
	}
	.edit-journey > summary {
		display: flex;
		justify-content: space-between;
		cursor: pointer;
	}
	.edit-journey > summary span {
		color: #397e6e;
		font-weight: 600;
	}
	.edit-journey[open] > summary {
		margin-bottom: 12px;
	}
	.frequency-label {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin-top: 10px;
	}
	.frequency-label label {
		font-size: 14px;
		color: #526e76;
	}
	.frequency-label strong {
		font-size: 24px;
		font-weight: 600;
		color: #247963;
		font-variant-numeric: tabular-nums;
	}
	.frequency-label strong span {
		font-size: 14px;
		font-weight: 450;
		color: #758a8e;
	}
	.frequency-slider {
		width: 100%;
		margin: 9px 0 3px;
		height: 20px;
		accent-color: #087f7c;
		cursor: ew-resize;
	}
	.slider-labels {
		display: flex;
		justify-content: space-between;
		color: #839796;
		font-size: 12px;
		margin-bottom: 12px;
	}
	.previous-proposal {
		flex-shrink: 0;
		padding: 6px 8px;
		background: white;
		border: 1px solid #bdd1ce;
		border-radius: var(--surface-radius-pill);
		color: #086f6d;
		font-size: 12px;
	}
	.audit-toggle {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		font-size: 13px;
		line-height: 1.5;
		color: #315565;
		margin: 10px 0;
	}
	.audit-toggle input {
		margin-top: 3px;
		accent-color: #087c79;
	}
	.facility-audit {
		margin: 18px 0;
		border: 1px solid #dbe4de;
		border-radius: var(--surface-radius-inner);
		padding: 12px;
	}
	.facility-audit summary {
		font-size: 14px;
		cursor: pointer;
		color: #254d59;
	}
	.facility-audit article {
		padding: 14px 0;
		border-bottom: 1px solid #e4e9dd;
	}
	.facility-audit article:last-child {
		border-bottom: 0;
	}
	.facility-audit strong {
		display: block;
		font-size: 14px;
	}
	.facility-audit span {
		display: block;
		margin-top: 4px;
		color: #327967;
		font-size: 12px;
	}
	.facility-audit .excluded {
		color: #966d3d;
	}
	.facility-audit small {
		display: block;
		color: #6b7f84;
		font-size: 11px;
	}
	.facility-audit a {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin: 5px 10px 0 0;
		color: #087c79;
		font-size: 12px;
	}
	.population-table {
		border-collapse: collapse;
		width: 100%;
		font-size: 13px;
		margin: 14px 0;
	}
	.table-scroll {
		max-width: 100%;
		overflow-x: auto;
		overscroll-behavior-inline: contain;
	}
	.table-scroll .population-table {
		min-width: 350px;
	}
	.population-table th,
	.population-table td {
		padding: 9px 6px;
		border-bottom: 1px solid #dfe9e2;
		text-align: right;
	}
	.population-table th:first-child {
		text-align: left;
	}
	.policy-atlas {
		--ink: #163e4b;
		--muted: #66818b;
		--teal: #087f7c;
		--line: #e1e9e8;
		height: 100dvh;
		display: flex;
		flex-direction: column;
		background: #f7f9f7;
		color: var(--ink);
		font-size: 14px;
		overflow: hidden;
	}
	button,
	a,
	input {
		-webkit-tap-highlight-color: transparent;
	}
	button {
		cursor: pointer;
		font: inherit;
	}
	button:disabled {
		opacity: 0.45;
		cursor: default;
	}
	button:focus-visible,
	summary:focus-visible,
	a:focus-visible,
	input:focus-visible {
		outline: 3px solid #15959080;
		outline-offset: 3px;
	}
	.quiet-button,
	.primary-button,
	.secondary-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		border-radius: var(--surface-radius-pill);
		border: 0;
		padding: 10px 12px;
		font-size: 12px;
		font-weight: 600;
	}
	.quiet-button {
		background: transparent;
		color: #5c7985;
	}
	.primary-button {
		background: #0b7d7b;
		color: #fff;
		min-height: 42px;
		transition:
			background-color 140ms,
			transform 140ms;
	}
	.primary-button:active {
		transform: scale(0.98);
	}
	.secondary-button {
		background: #edf5f2;
		color: #386b67;
		border: 1px solid #d3e1dc;
	}
	.icon-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 29px;
		height: 29px;
		border: 0;
		background: transparent;
		color: #67818b;
		border-radius: var(--surface-radius-pill);
	}
	.icon-button:hover,
	.quiet-button:hover {
		background: #eff4f2;
	}
	.result {
		padding: 12px 26px;
		position: relative;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.result + .result::before {
		position: absolute;
		content: '';
		width: 1px;
		background: var(--line);
		top: 20px;
		bottom: 20px;
		left: 0;
	}
	.result-label {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		color: #6a838d;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 1.1px;
		flex-wrap: wrap;
	}
	.result strong {
		display: block;
		font-size: 27px;
		font-weight: 650;
		line-height: 1.25;
		letter-spacing: -0.8px;
		margin: 5px 0 3px;
		font-variant-numeric: tabular-nums;
	}
	.result strong > span {
		margin-left: 6px;
		font-size: 13px;
		font-weight: 500;
		color: #738c94;
		letter-spacing: 0;
	}
	.result p {
		margin: 0;
		font-size: 13px;
		color: #71858c;
		line-height: 1.4;
	}
	.result p button {
		color: #568087;
		background: transparent;
		border: 0;
		padding: 0 4px;
		font-size: 12px;
	}
	.result p .icon-button {
		width: 17px;
		height: 17px;
		vertical-align: middle;
	}
	.result-chip {
		padding: 3px 6px;
		background: #eef6f1;
		color: #238977;
		border-radius: 4px;
		font-size: 12px;
		letter-spacing: 0;
		font-weight: 600;
	}
	.result-context {
		color: #91a1a6;
		font-size: 12px;
		font-weight: 450;
		letter-spacing: 0;
	}
	.assumption-link {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		color: #a28343;
		background: transparent;
		border: 0;
		letter-spacing: 0;
	}
	.access-result strong {
		color: #087f7c;
	}
	.carbon-result strong {
		color: #357f6d;
	}
	.carbon-increase strong {
		color: #a37430;
	}
	.changes-content {
		padding: 13px;
		border: 1px solid #cfdfdb;
		border-radius: 11px;
		background: #fffffff5;
		max-height: calc(100dvh - 370px);
		overflow-y: auto;
	}
	.changes-content .eyebrow {
		font-size: 10px;
		letter-spacing: 0.6px;
	}
	.changes-content h2 {
		margin: 8px 0;
		font-size: 16px;
		line-height: 1.35;
		font-weight: 500;
		color: #24464b;
	}
	.changes-content h2 strong {
		color: #16886c;
		font-weight: 750;
	}
	.change-explanation,
	.change-empty {
		margin: 6px 0 11px;
		font-size: 12px;
		line-height: 1.5;
		color: #557477;
	}
	.change-card {
		display: grid;
		gap: 6px;
		width: 100%;
		margin: 7px 0;
		padding: 10px;
		border: 1px solid #cbe3d9;
		border-radius: 8px;
		background: #f2faf6;
		text-align: left;
		color: #244d42;
		cursor: pointer;
	}
	.change-card:focus-visible {
		outline: 2px solid #16886c;
		outline-offset: 2px;
	}
	.change-card-heading,
	.change-times {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.change-card-heading {
		justify-content: space-between;
		font-size: 12px;
	}
	.change-times {
		font-size: 15px;
		font-variant-numeric: tabular-nums;
	}
	.change-times > span:first-child {
		color: #70807d;
	}
	.change-card-detail {
		font-size: 11px;
		line-height: 1.4;
		color: #4d7667;
	}
	.change-footnote,
	.change-warning {
		margin: 10px 0 0;
		font-size: 11px;
		line-height: 1.5;
		color: #627c80;
	}
	.change-warning {
		color: #a04b38;
	}
	.mobile-priority-cards .changes-content {
		max-height: none;
	}
	.eyebrow {
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 1.15px;
		color: #6d9197;
	}
	h1 {
		margin: 10px 0 10px;
		font-size: 29px;
		line-height: 1.12;
		letter-spacing: -1.1px;
		font-weight: 600;
		max-width: 260px;
	}
	.priority-card {
		display: flex;
		gap: 10px;
		align-items: center;
		width: 100%;
		padding: 13px 10px;
		background: #fffffff0;
		border: 1px solid #c5dcdb;
		border-radius: 10px;
		text-align: left;
		margin-bottom: 9px;
		color: var(--ink);
		box-shadow: 0 4px 16px #32627108;
		transition:
			transform 140ms,
			border-color 140ms,
			box-shadow 140ms;
	}
	.priority-card.chosen {
		border-color: #6daba0;
		box-shadow: 0 4px 15px #316b6618;
		background: #f8fcf7f5;
	}
	.priority-number {
		color: #89a49c;
		font-size: 15px;
		font-weight: 550;
		font-variant-numeric: tabular-nums;
	}
	.priority-card.chosen .priority-number {
		color: #14897b;
	}
	.priority-copy {
		flex: 1;
		min-width: 0;
	}
	.priority-copy strong {
		font-size: 12px;
		display: block;
		font-weight: 650;
	}
	.priority-copy > span {
		display: block;
		color: #7a9296;
		font-size: 12px;
		line-height: 1.5;
		margin-top: 4px;
	}
	.loading-priorities {
		background: #fff;
		border-radius: 10px;
		padding: 16px;
		color: var(--muted);
		font-size: 12px;
	}
	.proposal-key b {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		border: 1px dashed #bc6509;
		border-radius: 50%;
		background: #fff1d5;
		font-size: 13px;
		line-height: 1;
	}
	.reachable-key {
		background: #78baa5;
	}
	.faster-key {
		background: #16886c;
	}
	.new-route-key {
		background: #087e83;
	}
	.slower-key {
		background: #c45f48;
	}
	.unchanged-key {
		background: #a0acb0;
	}
	.mixed-key {
		background: #8374ad;
	}
	.unknown-key {
		background: #65717d;
	}
	.time-key-title {
		color: #31525c;
		font-weight: 650;
	}
	.journey-legend-note {
		font-size: 12px;
		line-height: 1.5;
		color: var(--muted);
	}
	.change-outline-key i {
		border: 1.5px solid #16886c;
		background: transparent;
	}
	.decision-panel {
		position: absolute;
		right: 24px;
		top: var(--map-overlay-top);
		max-height: calc(100% - var(--map-overlay-top) - 110px);
		width: 360px;
		flex-shrink: 0;
		background: #fff;
		display: flex;
		flex-direction: column;
		min-height: 0;
		border: 1px solid #d5e2db;
		border-radius: 15px;
		box-shadow: 0 8px 30px #254b6320;
		animation: selection-enter 180ms ease-out;
		z-index: 4;
	}
	.year-toggle {
		display: flex;
		gap: 1px;
		padding: 3px;
		border: 1px solid #d8e5de;
		border-radius: 7px;
		margin-left: auto;
		margin-top: 13px;
	}
	.year-toggle button {
		font-size: 12px;
		font-weight: 550;
		padding: 7px 7px;
		background: transparent;
		border: 0;
		border-radius: 4px;
		color: #73918e;
	}
	.year-toggle button.active {
		background: #e6f2eb;
		color: #157b6c;
	}
	.panel-scroll {
		overflow: auto;
		min-height: 0;
		flex: 1;
		scrollbar-width: thin;
		scrollbar-color: #dbe5dd transparent;
		padding: 0 23px 16px;
	}
	.area-insight {
		padding: 8px 0;
	}
	.area-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	h2 {
		font-weight: 600;
		font-size: 22px;
		letter-spacing: -0.6px;
		margin: 5px 0 8px;
		line-height: 1.2;
	}
	.area-heading h2 {
		font-size: 20px;
	}
	.resident-stat {
		display: flex;
		align-items: baseline;
		gap: 7px;
		margin: 5px 0 12px;
		flex-wrap: wrap;
	}
	.resident-stat strong {
		font-size: 32px;
		line-height: 1.15;
		font-weight: 600;
		letter-spacing: -0.6px;
		color: #246558;
	}
	.resident-stat span {
		max-width: 130px;
		font-size: 14px;
		color: #78918d;
	}
	h3 {
		font-size: 13px;
		font-weight: 650;
		letter-spacing: -0.1px;
		margin: 0;
	}
	.fleet-toggle {
		display: flex;
		gap: 5px;
		background: #f1f5ef;
		border-radius: var(--surface-radius-pill);
		padding: 4px;
		margin: 9px 0;
	}
	.fleet-toggle button {
		border: 0;
		background: transparent;
		flex: 1;
		display: flex;
		gap: 4px;
		align-items: center;
		justify-content: center;
		border-radius: var(--surface-radius-pill);
		padding: 7px;
		font-size: 13px;
		font-weight: 550;
		color: #779186;
	}
	.fleet-toggle button.active {
		background: #fff;
		box-shadow: 0 2px 5px #264e3812;
		color: #247b63;
	}
	.full-width {
		width: 100%;
	}
	.break-even {
		display: flex;
		gap: 11px;
		padding: 13px 12px;
		background: #f3f7ee;
		border: 1px solid #e3eada;
		border-radius: var(--surface-radius-inner);
	}
	.break-even-icon {
		padding-top: 3px;
		color: #649962;
	}
	.break-even h3 {
		font-size: 13px;
		color: #567651;
	}
	.break-even p {
		font-size: 12px;
		line-height: 1.6;
		color: #809079;
		margin: 6px 0;
	}
	.model-notes {
		font-size: 12px;
		color: #8b9a8f;
		line-height: 1.5;
		margin-top: 16px;
	}
	.model-notes p {
		padding: 8px 0;
		margin: 0;
		border-bottom: 1px solid #e8ede7;
	}
	.notice {
		position: fixed;
		top: 88px;
		bottom: auto;
		left: 50%;
		transform: translateX(-50%);
		z-index: 15;
		display: flex;
		align-items: center;
		gap: 16px;
		background: #173e49;
		color: #fff;
		box-shadow: var(--surface-shadow-raised);
		border-radius: var(--surface-radius);
		padding: 10px 15px;
		font-size: 12px;
		width: max-content;
		max-width: min(480px, calc(100vw - 24px));
		flex-wrap: wrap;
		overflow-wrap: anywhere;
	}
	.notice > span {
		flex: 1 1 180px;
		min-width: 0;
	}
	.notice .icon-button {
		color: #c3dcdb;
		width: 44px;
		height: 44px;
	}
	.hidden-upload {
		display: none;
	}
	.tour-card {
		margin-bottom: 12px;
		padding: 12px;
		border-radius: var(--surface-radius-inner);
		background: #f3f5f5;
		border: 1px solid #dce1e3;
	}
	.tour-card > div {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.tour-card strong {
		font-size: 14px;
		display: block;
		margin: 9px 0;
	}
	.tour-card p {
		font-size: 12px;
		line-height: 1.6;
		color: #60717a;
	}
	.tour-card > button {
		background: transparent;
		border: 0;
		padding: 0;
		font-size: 13px;
		display: flex;
		gap: 3px;
		align-items: center;
		color: #1a846c;
	}
	.placement-prompt {
		position: absolute;
		top: var(--map-overlay-top);
		left: 50%;
		transform: translateX(-50%);
		width: max-content;
		max-width: 90%;
		padding: 12px;
		background: #173e49;
		color: #fff;
		border-radius: var(--surface-radius);
		font-size: 13px;
		z-index: 6;
	}
	.placement-prompt button {
		padding: 3px 8px;
		border: 1px solid #7aa9aa;
		border-radius: var(--surface-radius-pill);
		background: transparent;
		color: #fff;
		margin-left: 12px;
		font-size: 13px;
	}
	.atlas-dialog {
		width: min(760px, calc(100vw - 48px));
		max-width: none;
		max-height: calc(100dvh - 48px);
		margin: auto;
		padding: 0;
		border: 1px solid #d5e2dc;
		border-radius: var(--surface-radius);
		background: #fff;
		color: var(--ink);
		overflow: auto;
		overscroll-behavior: contain;
		scrollbar-width: thin;
		box-shadow: var(--surface-shadow-raised);
		user-select: text;
		overflow-wrap: anywhere;
	}
	.atlas-dialog::backdrop {
		background: #193f4940;
		backdrop-filter: blur(2px);
	}
	.atlas-dialog[open] {
		animation: modal-enter 180ms cubic-bezier(0.16, 1, 0.3, 1);
	}
	@keyframes modal-enter {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	.atlas-dialog.sheet {
		width: min(560px, calc(100vw - 40px));
		height: calc(100dvh - 40px);
		max-height: calc(100dvh - 40px);
		margin: 20px 20px 20px auto;
		overflow: hidden;
	}
	.atlas-dialog.sheet .evidence-drawer {
		height: 100%;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-width: thin;
	}
	.atlas-dialog.sheet .drawer-heading {
		/* Cover the scroll container's top padding while the heading stays fixed. */
		box-shadow: 0 -28px 0 #fff;
	}
	.atlas-dialog.wide {
		width: min(1030px, calc(100vw - 48px));
	}
	.atlas-dialog.document {
		width: min(850px, calc(100vw - 48px));
	}
	.evidence-drawer {
		background: #fff;
		padding: 24px 28px;
	}
	.service-modal {
		padding: 24px 28px;
	}
	.drawer-heading {
		display: flex;
		align-items: flex-start;
		gap: 20px;
		justify-content: space-between;
		margin-bottom: 15px;
		position: sticky;
		top: 0;
		z-index: 2;
		background: #fff;
		padding: 8px 0 14px;
	}
	.drawer-heading > div {
		min-width: 0;
	}
	.drawer-heading h2 {
		font-size: 26px;
		margin-top: 8px;
	}
	.drawer-heading .icon-button {
		background: #eff3ec;
		flex-shrink: 0;
	}
	.evidence-drawer h3 {
		font-size: 15px;
		margin: 25px 0 12px;
	}
	.evidence-drawer p {
		font-size: 14px;
		line-height: 1.6;
		color: #526d70;
	}
	.evidence-group {
		border: 1px solid #dce6df;
		border-radius: var(--surface-radius-inner);
		padding: 0 15px;
		margin: 14px 0;
	}
	.evidence-group > summary {
		cursor: pointer;
		font-size: 14px;
		font-weight: 600;
		color: #345d63;
		padding: 15px 0;
		line-height: 1.4;
	}
	.evidence-group[open] {
		padding-bottom: 15px;
	}
	.settings-navigation {
		margin: 0 0 18px;
	}
	.source-search {
		display: block;
		font-size: 13px;
		color: #536c70;
	}
	.source-search input {
		display: block;
		width: 100%;
		margin-top: 7px;
		min-height: 42px;
		padding: 10px 12px;
		border: 1px solid #d5e2dc;
		border-radius: var(--surface-radius-field);
		background: white;
		font-size: 14px;
		color: #234d57;
	}
	.coverage-stats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 14px;
		padding: 20px 0;
		border-bottom: 1px solid #e4e9dd;
	}
	.coverage-stats strong {
		display: block;
		font-size: 27px;
		font-weight: 600;
		color: #3e7764;
		letter-spacing: -0.5px;
	}
	.coverage-stats span {
		font-size: 12px;
		color: #839284;
	}
	.evidence-explanation {
		padding: 15px;
		border-radius: var(--surface-radius-inner);
		background: #f0f4e9;
		margin-top: 20px;
	}
	.evidence-explanation strong {
		font-size: 13px;
		color: #5d7850;
	}
	.evidence-explanation p {
		margin-bottom: 0;
	}
	.unavailable-reasons {
		margin: 0 0 20px;
	}
	.unavailable-reasons h3 {
		margin: 12px 0 5px;
		font-size: 13px;
		color: #5d7850;
	}
	.unavailable-reasons ul {
		margin: 0;
		padding-left: 18px;
		color: #798a7e;
		font-size: 14px;
		line-height: 1.6;
	}
	.unavailable-reasons li + li {
		margin-top: 5px;
	}
	.data-gap {
		border-left: 2px solid #d0b886;
		padding: 5px 12px;
		background: #f8f4e9;
		border-radius: 0 5px 5px 0;
	}
	.snapshot-version {
		font-size: 12px !important;
		color: #98a193 !important;
		overflow-wrap: anywhere;
	}
	.source-list article {
		border-top: 1px solid #e5e9df;
		padding: 14px 0;
	}
	.source-list a {
		color: #3c7361;
		font-size: 14px;
		font-weight: 600;
		text-decoration: none;
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.source-list p {
		font-size: 12px;
		margin: 6px 0;
	}
	.source-list span {
		display: inline-block;
		font-size: 12px;
		padding: 3px 6px;
		border-radius: 4px;
		background: #edf2e7;
		color: #799568;
	}
	.interface-credits a {
		color: #357863;
	}
	.technical-note {
		font-size: 12px !important;
		color: #617c7d !important;
	}
	.drawer-intro {
		margin: 0 0 12px;
	}
	.assumption-section {
		padding: 0 0 10px;
	}
	.assumption-section h3 {
		margin: 18px 0 12px;
	}
	.settings-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 14px;
		margin-bottom: 13px;
	}
	.settings-grid.journey-basics {
		grid-template-columns: repeat(3, minmax(0, 1fr));
	}
	.settings-grid label,
	.budget-fields label {
		font-size: 13px;
		color: #526f70;
		min-width: 0;
	}
	.settings-grid input,
	.budget-fields input {
		display: block;
		margin-top: 6px;
		width: 100%;
		background: #fff;
		border: 1px solid #d8e3cf;
		border-radius: var(--surface-radius-field);
		padding: 9px;
		font-size: 14px;
		color: #31565b;
		min-height: 42px;
		font-variant-numeric: tabular-nums;
		min-width: 0;
		max-width: 100%;
	}
	.preset-toggle {
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 14px;
		color: #47676b;
	}
	.preset-toggle input {
		accent-color: #35806b;
	}
	.range-heading,
	.range-row {
		display: grid;
		grid-template-columns: 1.7fr 1fr 1fr 1fr;
		gap: 8px;
		align-items: center;
		padding: 7px 0;
	}
	.range-heading {
		font-size: 12px;
		color: #96a78e;
		border-bottom: 1px solid #dfe7d5;
	}
	.range-row {
		border-bottom: 1px solid #edf0e7;
	}
	.range-label {
		font-size: 13px;
		color: #46676c;
	}
	.range-row small {
		display: block;
		font-size: 12px;
		color: #718486;
		margin-top: 4px;
	}
	.range-row input {
		width: 100%;
		min-width: 0;
		background: #fff;
		border: 1px solid #e2e7d9;
		border-radius: var(--surface-radius-field);
		padding: 7px 5px;
		font-size: 14px;
		color: #31575b;
		min-height: 40px;
	}
	.management-actions {
		display: flex;
		gap: 7px;
		flex-wrap: wrap;
	}
	.compare-modal {
		padding: 20px 24px;
	}
	.compare-modal > p {
		font-size: 14px;
		line-height: 1.6;
		color: #5a7478;
		margin: 8px 0 12px;
	}
	.compare-modal .drawer-heading {
		margin-bottom: 0;
		padding: 4px 0 8px;
	}
	.budget-fields {
		display: flex;
		gap: 20px;
		max-width: 620px;
		margin: 14px 0;
	}
	.budget-fields label {
		flex: 1;
	}
	.alternative-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 14px;
	}
	.alternative-grid article {
		border: 1px solid #dce6d3;
		border-radius: 12px;
		padding: 14px;
		background: #fff;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.alternative-heading {
		display: flex;
		align-items: center;
		gap: 9px;
		min-height: 42px;
	}
	.alternative-heading > span {
		flex-shrink: 0;
	}
	.alternative-grid h3 {
		font-size: 16px;
		margin: 0;
		line-height: 1.3;
	}
	.alternative-grid p {
		font-size: 13px;
		line-height: 1.6;
		color: #5d7576;
		min-height: 42px;
		margin: 8px 0;
	}
	.alternative-grid dl {
		margin: 0;
	}
	.alternative-grid dl > div {
		padding: 10px 0;
		border-top: 1px solid #edf1e6;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
		min-height: 52px;
	}
	.alternative-grid dt {
		font-size: 13px;
		color: #647d7d;
	}
	.alternative-grid dd {
		margin: 0;
		min-width: 0;
		text-align: right;
		line-height: 1.25;
		font-size: 18px;
		font-weight: 600;
		color: #4c785e;
	}
	.alternative-grid dd.increase {
		color: #9c6d2d;
	}
	.alternative-grid .primary-button {
		width: 100%;
		font-size: 13px;
	}
	.budget-status {
		font-size: 12px;
		display: block;
		padding: 8px;
		border-radius: 5px;
		background: #eef5e8;
		color: #60894c;
		margin: 10px 0;
		min-height: 44px;
	}
	.comparison-footnote {
		margin-bottom: 0;
		font-size: 12px !important;
	}
	.brief-modal {
		width: 100%;
	}
	@media (hover: hover) and (pointer: fine) {
		.priority-card:hover {
			transform: translateY(-1px);
			border-color: #7eafa5;
		}
		.primary-button:hover {
			background: #096d6b;
		}
	}
	@media (min-width: 1600px) {
		.decision-panel {
			width: 390px;
		}
		.priority-card {
			padding: 16px 12px;
		}
		.result strong {
			font-size: 31px;
		}
	}
	.drawer-intro,
	.data-gap,
	.evidence-explanation p,
	.assumption-section p {
		font-size: 14px;
	}
	@media (max-height: 800px) {
		.priority-card {
			padding: 8px 10px;
		}
	}
	@media (max-width: 1150px) {
		.decision-panel {
			width: 335px;
		}
		.result {
			padding: 14px 18px;
		}
		.result strong {
			font-size: 23px;
		}
	}
	@media (max-width: 900px) {
		.result-context {
			display: none;
		}
		.result {
			padding: 12px;
		}
		.result strong {
			font-size: 20px;
		}
		.result strong > span {
			display: block;
			font-size: 12px;
		}
		.result p {
			font-size: 12px;
		}
		.decision-panel {
			width: 300px;
		}
		.panel-scroll {
			padding: 0 16px 16px;
		}
		.year-toggle button {
			font-size: 12px;
			padding: 6px;
		}
		.tour-card {
			width: 220px;
		}
		.alternative-grid {
			grid-template-columns: 1fr;
		}
	}
	@media (max-width: 680px) {
		.policy-atlas {
			overflow-y: auto;
			overflow-x: hidden;
			height: 100dvh;
		}
		.atlas-dialog,
		.atlas-dialog.wide,
		.atlas-dialog.document,
		.atlas-dialog.transport-dialog {
			width: calc(100vw - 20px);
			max-height: calc(100dvh - 20px);
		}
		.atlas-dialog.transport-dialog {
			--transport-panel-height: calc(100dvh - 24px);
		}
		.atlas-dialog.sheet {
			width: calc(100vw - 20px);
			height: calc(100dvh - 20px);
			max-height: calc(100dvh - 20px);
			margin: 10px 10px 10px auto;
		}
		.settings-grid,
		.settings-grid.journey-basics {
			grid-template-columns: 1fr;
		}
		.range-heading,
		.range-row {
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 6px;
		}
		.range-heading > span:first-child {
			display: none;
		}
		.range-row .range-label {
			grid-column: 1 / -1;
		}
		.range-label,
		.range-row small {
			font-size: 12px;
		}
		.budget-fields {
			flex-direction: column;
			gap: 12px;
		}
		.result {
			min-height: 82px;
		}
		.result + .result::before {
			display: none;
		}
		.result:nth-child(3),
		.result:nth-child(4) {
			border-top: 1px solid #e4eae4;
		}
		.decision-panel {
			width: calc(100% - 24px);
			right: 12px;
			max-height: calc(100% - var(--map-overlay-top) - 222px);
		}
		.panel-scroll {
			overflow: auto;
		}
		.tour-card {
			left: 12px;
			right: auto;
			max-width: calc(100% - 24px);
		}
		.alternative-grid {
			grid-template-columns: 1fr;
		}
		.evidence-drawer,
		.service-modal {
			padding: 16px;
		}
		.compare-modal {
			padding: 20px;
		}
		.notice {
			width: 90%;
			max-width: none;
		}
		.drawer-heading h2 {
			font-size: 25px;
		}
		.settings-grid input,
		.budget-fields input,
		.range-row input,
		.source-search input {
			font-size: 16px;
		}
		.context-heading .icon-button,
		.drawer-heading .icon-button,
		.notice .icon-button {
			width: 44px;
			height: 44px;
			flex-shrink: 0;
		}
		.frequency-slider {
			height: 44px;
		}
		.fleet-toggle button,
		.primary-button,
		.secondary-button,
		.edit-journey > summary {
			min-height: 44px;
		}
	}
	@media (max-width: 380px) {
		.result-label {
			font-size: 11px;
			letter-spacing: 0.7px;
			gap: 3px;
		}
		.result strong > span {
			margin-left: 2px;
		}
		.resident-stat .population-estimate {
			margin-left: 0;
		}
	}
	@media (max-height: 600px) and (min-width: 681px) {
		.policy-atlas {
			overflow: hidden;
		}
		.result {
			padding: 8px 12px;
		}
		.result-chip {
			display: none;
		}
	}
	.mobile-drawer-content {
		display: flex;
		flex-direction: column;
		box-sizing: border-box;
		max-height: min(
			calc(86dvh - 2px - env(safe-area-inset-bottom)),
			calc(100dvh - 42px - env(safe-area-inset-bottom))
		);
		padding: 22px;
		overflow: hidden;
	}
	.mobile-drawer-body {
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.mobile-drawer-content .drawer-heading {
		flex-shrink: 0;
		margin-bottom: 20px;
	}
	.mobile-drawer-intro {
		color: #637984;
		font-size: 14px;
		line-height: 1.55;
		margin: -6px 0 18px;
	}
	.mobile-menu-list {
		display: grid;
		gap: 4px;
	}
	.mobile-menu-list > button {
		display: flex;
		align-items: center;
		gap: 14px;
		width: 100%;
		min-height: 64px;
		padding: 12px 10px;
		border: 0;
		border-radius: 12px;
		background: transparent;
		color: var(--ink);
		text-align: left;
	}
	.mobile-menu-list > button > span {
		flex: 1;
		min-width: 0;
	}
	.mobile-menu-list strong,
	.mobile-basemaps strong {
		display: block;
		font-size: 15px;
		font-weight: 600;
	}
	.mobile-menu-list small,
	.mobile-basemaps small {
		display: block;
		font-size: 12px;
		color: #637984;
		line-height: 1.4;
		margin-top: 4px;
	}
	.mobile-menu-list > button:active {
		background: #eef4ef;
	}
	.mobile-menu-list > button:disabled {
		opacity: 0.5;
	}
	.mobile-history {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
		margin-top: 18px;
		padding-top: 18px;
		border-top: 1px solid #e4e9e2;
	}
	.mobile-history button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		min-height: 44px;
		border: 1px solid #e2e7df;
		border-radius: 10px;
		background: #fff;
		font-size: 13px;
	}
	.mobile-history button:disabled {
		opacity: 0.4;
	}
	.mobile-data-note {
		display: flex;
		align-items: center;
		gap: 8px;
		border: 0;
		background: transparent;
		color: #657b85;
		font-size: 12px;
		margin-top: 12px;
		min-height: 44px;
		text-align: left;
	}
	.mobile-option-section {
		margin-bottom: 22px;
	}
	.mobile-option-section h3 {
		font-size: 13px;
		font-weight: 600;
		color: #637984;
		margin: 0 0 10px;
	}
	.mobile-basemaps {
		display: grid;
		gap: 8px;
	}
	.mobile-basemaps button {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		width: 100%;
		min-height: 66px;
		padding: 13px 14px;
		border: 1px solid #e1e7df;
		border-radius: 12px;
		background: white;
		color: var(--ink);
		text-align: left;
	}
	.mobile-basemaps button[aria-pressed='true'] {
		border-color: #07827e;
		background: #f0f8f3;
		color: #077f7d;
	}
	.mobile-perspective {
		display: flex;
		width: 100%;
		min-height: 44px;
		align-items: center;
		justify-content: space-between;
		margin-top: 8px;
		border: 0;
		border-radius: 8px;
		background: transparent;
		font-size: 14px;
	}
	.mobile-perspective > span:last-child {
		border-radius: 20px;
		padding: 4px 10px;
		background: #edf3ee;
		color: #077f7d;
		font-size: 12px;
	}
	.mobile-legend {
		border-block: 1px solid #e1e7df;
		margin-bottom: 18px;
	}
	.mobile-legend > summary {
		display: flex;
		min-height: 48px;
		align-items: center;
		justify-content: space-between;
		font-size: 14px;
		cursor: pointer;
		list-style: none;
	}
	.mobile-legend > summary::-webkit-details-marker {
		display: none;
	}
	.mobile-legend > div {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
		padding: 0 0 18px;
		font-size: 12px;
		color: #637984;
	}
	.mobile-legend > div > span {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.mobile-legend i {
		width: 9px;
		height: 9px;
		border-radius: 3px;
		flex-shrink: 0;
	}
	.mobile-priority-cards {
		display: grid;
		gap: 10px;
	}
	.mobile-priority-cards h1 {
		display: none;
	}
	.mobile-detailed-results {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		margin: 0 0 20px;
	}
	.mobile-detailed-results .result {
		border-bottom: 1px solid #e1e7df;
		padding: 18px 0;
		min-height: 0;
		color: #263a40;
	}
	.mobile-detailed-results .result-label {
		letter-spacing: 0;
		font-weight: 550;
		color: #60717a;
	}
	.result-assumptions {
		font-size: 12px;
		line-height: 1.5;
		color: #657570;
		margin: 0 0 6px;
	}
	.mobile-detailed-results .result + .result::before {
		display: none;
	}
	.mobile-detailed-results .result strong {
		font-size: 27px;
	}
	.mobile-detailed-results .result strong > span {
		font-size: 13px;
	}

	@media (max-width: 680px) {
		.policy-atlas {
			height: 100dvh;
			min-height: 0;
			overflow: hidden;
		}
		.panel-scroll {
			padding: 16px 0 0;
			overflow: visible;
		}
		.panel-scroll .area-heading {
			display: none;
		}
		.placement-prompt {
			left: 12px;
			right: 12px;
			top: 112px;
			max-width: none;
			font-size: 12px;
		}
		.notice {
			top: 150px;
			bottom: auto;
			left: 12px;
			right: 12px;
			width: auto;
			transform: none;
			z-index: 40;
			padding: 10px 12px;
			font-size: 12px;
		}
		.atlas-dialog,
		.atlas-dialog.wide,
		.atlas-dialog.sheet,
		.atlas-dialog.document,
		.atlas-dialog.transport-dialog {
			position: fixed;
			inset: auto 10px max(10px, env(safe-area-inset-bottom));
			margin: 0;
			width: calc(100% - 20px);
			max-width: calc(100% - 20px);
			max-height: min(86dvh, calc(100dvh - 40px));
			border-radius: var(--surface-radius-mobile);
			padding-bottom: 0;
			overscroll-behavior: contain;
		}
		.atlas-dialog[open] {
			animation: mobile-drawer-in 180ms cubic-bezier(0.32, 0.72, 0, 1);
		}
		.atlas-dialog.mobile-drawer {
			overflow: hidden;
		}
		.atlas-dialog.transport-dialog {
			--transport-panel-height: min(86dvh, calc(100dvh - 40px));
		}
		.mobile-drawer-content {
			padding: 23px 18px 22px;
		}
		.mobile-drawer-content .drawer-heading {
			align-items: flex-start;
		}
		.mobile-drawer-content .drawer-heading h2 {
			font-size: 24px;
			line-height: 1.2;
			letter-spacing: -0.7px;
		}
		.mobile-drawer-content .drawer-heading .eyebrow {
			font-size: 10px;
		}
		.mobile-priority-cards .priority-card {
			width: 100%;
			margin: 0;
			min-height: 82px;
			padding: 16px 12px;
			background: #fff;
			border-radius: 12px;
			border: 1px solid #e1e8dc;
		}
		.mobile-detailed-results .result:nth-child(3),
		.mobile-detailed-results .result:nth-child(4) {
			border-top: 0;
		}
		.mobile-detailed-results .result-label {
			font-size: 11px;
		}
	}
	.wave-status {
		position: absolute;
		z-index: 7;
		top: calc(var(--map-controls-height) + 32px);
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 9px 13px;
		border-radius: 20px;
		background: #fffef9f5;
		border: 1px solid #cadde6;
		box-shadow: 0 3px 12px #25485815;
		color: #315e78;
		font-size: 12px;
		white-space: nowrap;
		pointer-events: none;
	}
	.wave-status-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #598fac;
	}
	@keyframes mobile-drawer-in {
		from {
			opacity: 0;
			transform: translateY(12px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		*,
		*::before,
		*::after {
			transition: none !important;
			animation: none !important;
		}
	}
	@media print {
		:global(html),
		:global(body),
		.policy-atlas {
			height: auto;
			overflow: visible;
			background: #fff;
		}
		.policy-atlas {
			display: block;
		}
		.workspace,
		.notice {
			display: none;
		}
		.atlas-dialog.document {
			position: static;
			background: #fff;
			backdrop-filter: none;
			display: block;
			border: 0;
			border-radius: 0;
			box-shadow: none;
			margin: 0;
			padding: 0;
			width: auto;
			max-height: none;
			overflow: visible;
		}
		.atlas-dialog::backdrop {
			display: none;
		}
		.brief-modal {
			max-width: none;
			width: auto;
			max-height: none;
			overflow: visible;
		}
	}

	.workspace {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.map-stage {
		--map-overlay-top: 88px;
		--map-workbench-top: max(16px, env(safe-area-inset-top));
		position: relative;
		flex: 1;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}
	.map-workbench {
		position: absolute;
		left: 20px;
		top: var(--map-workbench-top);
		z-index: 8;
		width: 312px;
		max-width: calc(100% - 40px);
		border: 1px solid #dce1e3;
		border-radius: var(--surface-radius);
		overflow: hidden;
		background: #fff;
		box-shadow: var(--surface-shadow);
		color: #223740;
	}
	.workflow-toggle {
		list-style: none;
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px 16px;
		border-radius: inherit;
		cursor: pointer;
	}
	.workflow-toggle::-webkit-details-marker,
	.suggested-areas > summary::-webkit-details-marker,
	.atlas-legend > summary::-webkit-details-marker {
		display: none;
	}
	.workflow-toggle:focus-visible {
		outline-offset: -4px;
	}
	.workflow-toggle > span {
		flex: 1;
		min-width: 0;
	}
	.workflow-toggle strong {
		display: block;
		font-size: 14px;
		font-weight: 650;
		line-height: 1.3;
	}
	.workflow-toggle small {
		display: block;
		margin-top: 4px;
		font-size: 11px;
		color: #60717a;
	}
	.workflow-toggle .workflow-context {
		font-size: 10px;
		color: #60717a;
	}
	.workflow-toggle > :global(svg) {
		flex-shrink: 0;
	}
	.map-workbench[open] .workflow-toggle > :global(svg:last-child) {
		transform: rotate(180deg);
	}
	.workbench-body {
		padding: 0 14px 12px;
		max-height: min(420px, calc(100dvh - 372px));
		overflow-y: auto;
		scrollbar-width: thin;
		overscroll-behavior: contain;
	}
	.workflow-actions {
		display: flex;
		align-items: center;
		gap: 3px;
		padding: 3px;
		border-radius: var(--surface-radius-pill);
		background: #f0f3f4;
	}
	.workflow-actions button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 3px;
		flex: 1;
		min-width: 0;
		min-height: 34px;
		border: 0;
		border-radius: var(--surface-radius-pill);
		padding: 6px 8px;
		background: transparent;
		color: #60717a;
		font-size: 12px;
	}
	.workflow-actions button.chosen {
		background: #fff;
		color: #203640;
		font-weight: 650;
		box-shadow: 0 1px 3px rgb(29 46 54 / 9%);
	}
	.workflow-actions .investment-action {
		color: #375760;
	}
	.workbench-field {
		margin-top: 14px;
	}
	.control-caption {
		display: block;
		margin-bottom: 6px;
		color: #667781;
		font-size: 11px;
	}
	.workbench-field :global(.destination-group) {
		border-radius: var(--surface-radius-pill);
		background: #fff;
		border-color: #dce3e6;
		height: 38px;
	}
	.workbench-field :global(.destination-option) {
		font-size: 12px;
		border-radius: var(--surface-radius-pill);
		height: 30px;
	}
	.workbench-field :global(.destination-option[data-state='on']) {
		background: #edf3f4;
		color: #264b58;
		box-shadow: none;
	}
	.workbench-field :global(.destination-option[data-state='off']) {
		color: #73828a;
	}
	.planning-time {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		width: 100%;
		margin-top: 12px;
		padding: 0;
		border: 0;
		background: transparent;
		text-align: left;
		color: #34515e;
		min-height: 38px;
	}
	.planning-time small {
		display: block;
		margin-bottom: 4px;
		color: #667781;
		font-size: 11px;
	}
	.planning-time strong {
		font-size: 12px;
		font-weight: 550;
	}
	.map-display-choices {
		display: flex;
		gap: 4px;
		width: 100%;
		padding: 4px;
		background: #f1f5f6;
		border-radius: var(--surface-radius-pill);
	}
	.map-display-choices button {
		flex: 1;
		min-height: 35px;
		min-width: 0;
		padding: 4px;
		color: #6a7c85;
		background: transparent;
		border: 0;
		border-radius: var(--surface-radius-pill);
		font-size: 11px;
	}
	.map-display-choices button.chosen {
		color: #244e5d;
		background: #fff;
		box-shadow: 0 1px 3px #102e3412;
		font-weight: 650;
	}
	.coverage-context {
		margin: 10px 0;
		font-size: 11px;
		color: #60717a;
	}
	.coverage-context button {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		border: 0;
		padding: 4px 0;
		background: transparent;
		text-align: left;
		color: #576e77;
		font-size: 11px;
	}
	.coverage-context button > :global(svg:last-child) {
		margin-left: auto;
	}
	.coverage-context small {
		display: block;
		font-size: 10px;
		line-height: 1.5;
	}
	.coverage-context.outside,
	.coverage-context.outside button {
		color: #9a6935;
	}
	.coverage-context .supported-time {
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.workbench-tools {
		display: flex;
		gap: 2px;
		border-top: 1px solid #e2e7e9;
		padding-top: 8px;
	}
	.workbench-tools button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		flex: 1;
		min-height: 36px;
		padding: 5px 2px;
		border: 0;
		border-radius: var(--surface-radius-pill);
		background: transparent;
		color: #536b77;
		font-size: 11px;
	}
	.workbench-tools button.chosen {
		color: #244e5d;
		background: #edf3f4;
	}
	.map-start-hint {
		margin: 6px 0 8px;
		color: #60717a;
		font-size: 10px;
		line-height: 1.55;
	}
	.proposal-history {
		display: flex;
		gap: 2px;
		margin: 2px 0 6px;
	}
	.proposal-history button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		min-height: 32px;
		flex: 1;
		min-width: 0;
		padding: 4px;
		color: #647780;
		border: 0;
		background: transparent;
		font-size: 10px;
	}
	.suggested-areas {
		border-top: 1px solid #e2e7e9;
		margin-top: 8px;
	}
	.suggested-areas > summary {
		list-style: none;
		display: flex;
		align-items: center;
		gap: 7px;
		min-height: 38px;
		color: #4f6672;
		font-size: 11px;
		cursor: pointer;
	}
	.suggested-areas > summary > span:nth-child(2) {
		margin-left: auto;
		color: #87949b;
		font-variant-numeric: tabular-nums;
	}
	.suggested-area-list {
		max-height: 260px;
		overflow-y: auto;
		padding-top: 4px;
	}
	.suggested-area-list :global(h1) {
		display: none;
	}
	.suggested-area-list .priority-card {
		border: 0;
		border-bottom: 1px solid #e6ebed;
		border-radius: 0;
		background: #fff;
		box-shadow: none;
		padding: 12px 0;
		margin: 0;
	}
	.suggested-area-list .changes-content {
		padding: 0;
		border: 0;
		background: #fff;
		border-radius: 0;
		max-height: none;
	}
	.outcome-dock {
		position: absolute;
		z-index: 9;
		bottom: 24px;
		left: 50%;
		transform: translateX(-50%);
		width: min(1040px, calc(100% - 48px));
	}
	.planning-dock {
		overflow: hidden;
		border: 1px solid #dce2e5;
		border-radius: var(--surface-radius);
		background: #fff;
		box-shadow: var(--surface-shadow-raised);
		color: #233d48;
	}
	.planning-dock :global(.compact-summary) {
		border: 0;
		border-radius: 0;
		box-shadow: none;
	}
	@media (min-width: 1151px) {
		.planning-dock.split-preview {
			display: grid;
			grid-template-columns: minmax(0, 1fr) 320px;
			grid-template-areas: 'heading heading' 'editor scope' 'editor impact' 'journeys journeys' 'tools tools';
		}
		.split-preview .dock-heading {
			grid-area: heading;
		}
		.split-preview .transport-editor {
			grid-area: editor;
			border-right: 1px solid #e4eaed;
		}
		.split-preview .impact-scope {
			grid-area: scope;
			padding: 0 12px;
			gap: 8px;
		}
		.split-preview .impact-scope button {
			padding: 0 8px;
		}
		.split-preview :global(.impact-receipt) {
			grid-area: impact;
		}
		.split-preview .dock-journeys {
			grid-area: journeys;
		}
		.split-preview .build-palette {
			grid-area: tools;
		}
	}
	.dock-heading,
	.dock-heading > div {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.dock-heading {
		justify-content: space-between;
		min-height: 44px;
		padding: 0 12px 0 20px;
		border-bottom: 1px solid #e6ebed;
		font-size: 13px;
	}
	.dock-heading-hint {
		color: #76868d;
		font-size: 11px;
	}
	.dock-state-dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #008f87;
	}
	.dock-state-dot.placing {
		background: #b37928;
	}
	.dock-icon {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border: 0;
		border-radius: var(--surface-radius-pill);
		background: transparent;
		color: #647983;
		cursor: pointer;
	}
	.dock-icon :global(.flipped) {
		transform: rotate(180deg);
	}
	.transport-editor {
		max-height: min(210px, calc(100dvh - 320px));
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-width: thin;
	}
	.transport-editor :global(.connection-editor) {
		padding: 8px 20px 0;
	}
	.placement-workshop {
		display: flex;
		align-items: center;
		gap: 15px;
		padding: 16px 20px;
	}
	.placement-workshop strong {
		font-size: 14px;
		font-weight: 600;
	}
	.placement-icon {
		display: grid;
		place-items: center;
		flex-shrink: 0;
		width: 44px;
		height: 44px;
		border: 1px solid #dce5e6;
		border-radius: 10px;
		background: #f3f8f7;
		color: #007d77;
	}
	.placement-workshop p {
		font-size: 12px;
		color: #667a85;
		margin: 5px 0;
	}
	.placement-workshop p.placement-valid {
		color: #007d77;
	}
	.placement-workshop small,
	.workshop-description small {
		color: #798b92;
		font-size: 11px;
	}
	.placement-workshop .dock-secondary {
		margin-left: auto;
	}
	.dock-secondary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		min-height: 44px;
		padding: 0 14px;
		border: 1px solid #d9e2e5;
		border-radius: var(--surface-radius-pill);
		background: #fff;
		color: #345361;
		font: inherit;
		font-size: 12px;
		font-weight: 550;
		cursor: pointer;
	}
	.dock-secondary:hover {
		background: #f3f7f8;
		border-color: #b7cccf;
	}
	.workshop-link {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		min-height: 44px;
		background: transparent;
		border: 0;
		color: #007d77;
		font-size: 12px;
		cursor: pointer;
	}
	.stop-workshop {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 12px 24px;
		padding: 16px 20px;
	}
	.workshop-description strong {
		font-size: 15px;
		font-weight: 600;
	}
	.workshop-description p {
		margin: 6px 0;
		font-size: 12px;
		color: #677e87;
	}
	.workshop-stop-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.workshop-connected {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
		grid-column: 1 / -1;
	}
	.workshop-connected > span {
		font-size: 11px;
		color: #6f828c;
		margin-right: 4px;
	}
	.workshop-connected button {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		background: #f5f8f9;
		border: 1px solid #e0e7ea;
		border-radius: var(--surface-radius-pill);
		padding: 6px 12px;
		color: #365664;
		font-size: 12px;
		cursor: pointer;
	}
	.workshop-connected small {
		font-size: 10px;
		color: #6f828c;
	}
	.workshop-move-settings {
		font-size: 12px;
		color: #5e737d;
	}
	.workshop-move-settings summary {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		cursor: pointer;
		list-style: none;
	}
	.workshop-move-settings label {
		display: flex;
		align-items: center;
		gap: 7px;
		min-height: 36px;
	}
	.workshop-move-settings input[type='number'] {
		width: 60px;
		padding: 8px;
		border: 1px solid #d6e0e3;
		border-radius: 6px;
	}
	.workshop-move-settings p {
		font-size: 11px;
		line-height: 1.5;
		max-width: 540px;
	}
	.workshop-timing-note {
		grid-column: 1 / -1;
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		font-size: 11px;
		line-height: 1.5;
		color: #8e642c;
	}
	.route-workshop {
		display: grid;
		grid-template-columns: minmax(250px, 1.5fr) minmax(180px, 1fr) auto;
		gap: 22px;
		align-items: center;
		padding: 16px 20px;
	}
	.workshop-label {
		display: block;
		color: #71858f;
		font-size: 11px;
		margin-bottom: 8px;
	}
	.route-workshop :global(.route-picker-trigger) {
		min-height: 44px;
		border-color: #d9e2e5;
		border-radius: 8px;
		color: #345361;
		background: #fff;
		font-size: 12px;
	}
	.route-workshop-actions {
		display: flex;
		gap: 10px;
		align-items: center;
		margin-top: 8px;
	}
	.route-workshop-actions .dock-secondary {
		font-size: 11px;
		padding: 0 10px;
	}
	.route-frequency {
		padding: 0 8px;
	}
	.route-frequency .frequency-label {
		font-size: 12px;
		margin: 0 0 8px;
	}
	.route-frequency .frequency-label strong {
		font-size: 22px;
	}
	.route-frequency .frequency-slider {
		margin: 0;
		width: 100%;
	}
	.route-frequency .slider-labels {
		font-size: 10px;
	}
	.route-frequency > small {
		font-size: 10px;
		color: #829198;
	}
	.route-fleet .fleet-toggle {
		margin: 0;
	}
	.route-fleet .fleet-toggle button {
		min-height: 44px;
		font-size: 12px;
	}
	.route-published {
		display: flex;
		gap: 10px;
		color: #6d808b;
		font-size: 11px;
		line-height: 1.5;
	}
	.route-published > :global(svg) {
		flex-shrink: 0;
		margin-top: 2px;
	}
	.route-published strong {
		font-size: 12px;
		font-weight: 550;
		color: #44626f;
	}
	.route-published p {
		margin: 4px 0 0;
	}
	.build-palette {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		padding: 8px 12px;
		border-top: 1px solid #e3e9ec;
		background: #fff;
	}
	.build-tools,
	.build-history {
		display: flex;
		gap: 4px;
		align-items: center;
	}
	.build-palette button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 9px;
		border: 0;
		border-radius: var(--surface-radius-pill);
		background: transparent;
		color: #627a87;
		min-height: 48px;
		padding: 0 18px;
		font: inherit;
		font-size: 12px;
		font-weight: 550;
		cursor: pointer;
		transition:
			background-color 150ms ease,
			color 150ms ease,
			transform 150ms ease;
	}
	.build-palette button:hover {
		color: #1d4c59;
		background: #f1f6f7;
	}
	.build-palette button.chosen {
		color: #fff;
		background: #1e555d;
	}
	.build-palette button:active,
	.dock-secondary:active {
		transform: scale(0.97);
	}
	.build-palette button:disabled,
	.dock-secondary:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.build-history {
		border-left: 1px solid #e4e9ec;
		padding-left: 12px;
	}
	.build-history button {
		padding: 0 12px;
	}
	.build-palette .dock-options {
		width: 44px;
		padding: 0;
	}
	.planning-dock button:focus-visible,
	.planning-dock summary:focus-visible {
		outline: 2px solid #008b83;
		outline-offset: -3px;
	}
	.dock-journeys {
		padding: 10px 20px;
		border-top: 1px solid #e4eaec;
	}
	.dock-journeys > div {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 11px;
		color: #6c828d;
		margin-bottom: 4px;
	}
	.dock-journeys > div strong {
		color: #34525f;
	}
	.dock-journeys button {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 44px;
		padding: 8px 0;
		border: 0;
		border-top: 1px solid #edf1f3;
		background: #fff;
		color: #365663;
		font-size: 12px;
		text-align: left;
		cursor: pointer;
	}
	.dock-journeys button > span {
		margin-right: auto;
	}
	.dock-journeys button small {
		display: block;
		color: #7a8e97;
		font-size: 10px;
		margin-top: 3px;
	}
	.dock-journeys button strong {
		font-size: 12px;
		font-weight: 550;
	}
	.dock-journeys button strong span {
		padding: 0 8px;
		color: #8a9ca4;
	}
	.dock-journeys p {
		font-size: 12px;
		color: #70848e;
	}
	.atlas-legend {
		position: absolute;
		left: 20px;
		bottom: calc(var(--mobile-sheet-bottom) + 8px);
		z-index: 5;
		width: 200px;
		max-width: calc(100% - 40px);
		padding: 12px 14px;
		background: #fff;
		border: 1px solid #dce1e3;
		border-radius: var(--surface-radius);
		box-shadow: var(--surface-shadow);
		color: #60717a;
		font-size: 11px;
	}
	.impact-scope-note {
		margin: 0;
		padding: 8px 20px;
		color: #6d808b;
		font-size: 12px;
		line-height: 1.5;
		border-bottom: 1px solid #e4eaed;
	}
	.atlas-legend > summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		cursor: pointer;
		list-style: none;
		font-size: 12px;
		font-weight: 600;
		color: #445e6b;
	}
	.legend-lines {
		display: flex;
		flex-wrap: wrap;
		gap: 9px 12px;
		align-items: center;
		padding-top: 12px;
	}
	.legend-lines > span {
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.legend-lines i {
		display: inline-block;
		flex-shrink: 0;
		width: 8px;
		height: 8px;
		border-radius: 2px;
	}
	.legend-lines button {
		display: flex;
		align-items: center;
		gap: 5px;
		color: #60717a;
		background: transparent;
		border: 0;
		padding: 0;
		font-size: 11px;
	}
	.legend-lines .time-key-title {
		width: 100%;
		font-size: 11px;
	}
	.legend-lines .proposal-key {
		color: #8b6339;
	}
	.map-outlook {
		position: absolute;
		right: 20px;
		top: 88px;
		z-index: 6;
	}
	.decision-panel {
		top: 88px;
		right: 20px;
		max-height: calc(100% - 312px);
		border-radius: var(--surface-radius);
		border-color: #dce1e3;
		box-shadow: var(--surface-shadow);
	}
	@media (max-width: 1179px) {
		.map-stage {
			--map-workbench-top: 88px;
		}
	}
	.map-stage :global(.maplibregl-ctrl-bottom-left) {
		max-width: 220px;
	}
	@media (max-width: 1150px) and (min-width: 681px) {
		.outcome-dock {
			left: 20px;
			right: 20px;
			width: auto;
			transform: none;
		}
		.atlas-legend {
			bottom: calc(var(--mobile-sheet-bottom) + 8px);
			width: 200px;
		}
		.map-outlook {
			display: none;
		}
	}
	@media (max-width: 680px) {
		.map-stage {
			--map-overlay-top: 72px;
			--map-workbench-top: 72px;
		}
		.map-workbench {
			left: 12px;
			width: calc(100% - 80px);
			max-width: none;
			border-radius: var(--surface-radius-mobile);
		}
		.map-workbench[open] {
			width: calc(100% - 24px);
			z-index: 35;
		}
		.map-workbench[open] .workflow-toggle {
			padding-right: 68px;
		}
		.workflow-toggle {
			gap: 9px;
			padding: 11px 12px;
		}
		.workflow-toggle strong {
			font-size: 12px;
		}
		.workflow-toggle small {
			font-size: 10px;
			margin-top: 3px;
		}
		.workflow-toggle .workflow-context {
			font-size: 9px;
		}
		.workbench-body {
			max-height: min(340px, calc(100dvh - 340px));
			padding: 0 12px 12px;
		}
		.workflow-actions button,
		.workbench-tools button,
		.proposal-history button,
		.planning-time,
		.map-display-choices button {
			min-height: 44px;
		}
		.workbench-field :global(.destination-group) {
			height: 48px;
		}
		.workbench-field :global(.destination-option) {
			height: 40px;
		}
		.outcome-dock {
			bottom: calc(24px + env(safe-area-inset-bottom));
			left: 12px;
			right: 12px;
			transform: none;
			width: auto;
		}
		.atlas-legend,
		.map-outlook {
			display: none;
		}
		.map-stage :global(.maplibregl-ctrl-bottom-left) {
			top: auto;
			bottom: 0;
			max-width: calc(100% - 20px);
		}
		.notice {
			top: 170px;
		}
	}
	@media (max-height: 500px) {
		.workbench-body {
			max-height: calc(100dvh - 205px);
		}
		.atlas-legend {
			display: none;
		}
	}
	@media (min-width: 681px) and (max-height: 500px) {
		.outcome-dock {
			left: 352px;
			right: 20px;
			width: auto;
			transform: none;
		}
		.map-stage.has-selection .outcome-dock {
			left: 20px;
			right: auto;
			width: 312px;
		}
		.map-stage.has-selection .decision-panel {
			width: calc(100% - 384px);
			max-width: 420px;
			max-height: calc(100% - 112px);
		}
		.map-stage:has(.map-workbench[open]) .outcome-dock {
			left: 352px;
			right: 20px;
			width: auto;
		}
		.map-stage:has(.map-workbench[open]) .decision-panel {
			visibility: hidden;
			pointer-events: none;
		}
	}

	@media (max-width: 680px) {
		.outcome-dock.planning-dock {
			bottom: calc(24px + env(safe-area-inset-bottom));
			left: 10px;
			right: 10px;
			width: auto;
			border-radius: var(--surface-radius-mobile);
		}
		.dock-heading {
			padding-left: 14px;
			gap: 6px;
		}
		.dock-heading > div {
			gap: 7px;
		}
		.dock-heading strong {
			font-size: 12px;
		}
		.dock-heading-hint {
			display: none;
		}
		.transport-editor {
			max-height: min(210px, calc(100dvh - 390px));
		}
		.transport-editor :global(.connection-editor) {
			padding: 10px 14px 0;
		}
		.build-palette {
			padding: 6px;
			gap: 4px;
		}
		.build-tools {
			flex: 1;
			gap: 2px;
		}
		.build-tools button {
			flex: 1;
			flex-direction: column;
			gap: 4px;
			font-size: 10px;
			padding: 5px 8px;
			min-height: 54px;
		}
		.build-history {
			gap: 0;
			padding-left: 5px;
		}
		.build-history button {
			padding: 0;
			width: 36px;
			min-height: 48px;
		}
		.build-history button span {
			display: none;
		}
		.build-history .dock-options {
			width: 30px;
		}
		.placement-workshop {
			padding: 14px;
			gap: 10px;
		}
		.placement-icon {
			display: none;
		}
		.placement-workshop strong {
			font-size: 13px;
		}
		.placement-workshop small {
			display: block;
			font-size: 10px;
			line-height: 1.5;
		}
		.placement-workshop .dock-secondary {
			display: none;
		}
		.stop-workshop {
			grid-template-columns: 1fr;
			padding: 14px;
			gap: 10px;
		}
		.workshop-stop-actions {
			display: flex;
			gap: 6px;
		}
		.workshop-stop-actions button {
			flex: 1;
			font-size: 11px;
			padding: 0 9px;
		}
		.workshop-connected small {
			display: none;
		}
		.route-workshop {
			grid-template-columns: 1fr;
			padding: 14px;
			gap: 16px;
		}
		.route-frequency {
			padding: 0;
		}
		.route-fleet {
			display: flex;
			justify-content: space-between;
			align-items: center;
			gap: 12px;
		}
		.route-fleet .workshop-label {
			margin-bottom: 0;
		}
		.route-fleet .fleet-toggle {
			width: 190px;
		}
		.dock-journeys {
			padding: 10px 14px;
			max-height: 160px;
			overflow-y: auto;
		}
		.dock-journeys > div {
			flex-direction: column;
			align-items: flex-start;
			gap: 4px;
		}
		.dock-journeys button {
			font-size: 11px;
		}
		.dock-journeys button strong {
			font-size: 11px;
		}
	}
	@media (min-width: 681px) and (max-width: 960px) {
		.route-workshop {
			grid-template-columns: minmax(220px, 1.5fr) 1fr;
			gap: 18px;
		}
		.route-fleet {
			grid-column: 1 / -1;
			display: flex;
			align-items: center;
			gap: 15px;
		}
		.route-fleet .workshop-label {
			margin: 0;
		}
		.route-fleet .fleet-toggle {
			width: 210px;
		}
		.stop-workshop {
			grid-template-columns: 1fr;
		}
	}
	@media (max-height: 600px) and (min-width: 681px) {
		.outcome-dock.planning-dock,
		.map-stage.has-selection .outcome-dock.planning-dock,
		.map-stage:has(.map-workbench[open]) .outcome-dock.planning-dock {
			left: 20px;
			right: 20px;
			width: auto;
			transform: none;
		}
		.transport-editor {
			max-height: 140px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.build-palette button {
			transition: none;
		}
	}

	.impact-scope {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 20px;
		min-height: 38px;
		border-top: 1px solid #e3e9ec;
		background: #f8fafb;
		font-size: 11px;
		color: #637b88;
	}
	.impact-scope > div {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.impact-scope button {
		min-height: 38px;
		padding: 0 12px;
		border: 0;
		background: transparent;
		color: #718591;
		font-size: 11px;
		cursor: pointer;
	}
	.impact-scope button.active {
		color: #11666a;
		box-shadow: inset 0 -2px #11666a;
		font-weight: 600;
	}
	@media (max-width: 680px) {
		.impact-scope {
			padding: 0 14px;
		}
		.impact-scope button {
			min-height: 44px;
		}
	}
</style>
