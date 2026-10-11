<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { latLngToCell } from 'h3-js';
	import type { FeatureCollection, LineString } from 'geojson';
	import {
		ArrowUpRight,
		Check,
		ChevronRight,
		ChevronDown,
		Menu,
		LocateFixed,
		ListRestart,
		Download,
		FileText,
		Info,
		Layers,
		Leaf,
		MousePointer2,
		BusFront,
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
		AnalysisWorkerClient
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
	import { waveTriggerCoordinates } from './waveTriggers.ts';
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
		policyEvidence = null
	}: {
		baseline: PlanningBaseline;
		snapshotStale?: boolean;
		transportContext?: TransportContext | null;
		policyEvidence?: PolicyEvidenceBundle | null;
	} = $props();
	let showVessels = $state(true);
	let showAirport = $state(true);
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
	let pendingMapResult: { id: number; result: PlanningAnalysis } | null = null;
	let busy = $state(true);
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
	let mapToolbar: HTMLDivElement;
	let mapControlsHeight = $state(44);
	let isMobile = $state(false);
	let mobileDetailExpanded = $state(false);
	let mobileSheetHeight = $state(0);
	const mapOverlayHeight = $derived(isMobile ? 104 : mapControlsHeight);
	let settingsTab = $state('journey');
	let areasExpanded = $state(true);
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
	const mobileBottomInset = $derived(76 + (context ? mobileSheetHeight : 0));
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
		{ id: 'access', label: 'Access' },
		{ id: 'impact', label: 'Impact' }
	];
	const tourSteps = [
		{
			title: '1. Find a transport gap',
			detail:
				'Select one of the priority areas, or any colored area on the map. The journey shows the gap against your access target.'
		},
		{
			title: '2. Try an investment',
			detail:
				'Enter Edit map. Add a bus, drag a stop, or adjust the frequency. Results update while you edit; Undo restores the last change.'
		},
		{
			title: '3. Read the tradeoff',
			detail:
				'The four results show who reaches care, journey time, capital and annual cost, and conditional emissions. Open the brief to share it.'
		}
	];
	const shown = $derived(preview ?? analysis);
	const costUnavailable = $derived(
		!!shown && (shown.costs.capitalMvr == null || shown.costs.annualOperatingMvr == null)
	);
	const costUnavailableReasons = $derived([
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
	const selectedResult = $derived(shown?.origins.find((origin) => origin.originId === selectedId));
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
			? `${number(connectionPreview.features.reduce((sum, feature) => sum + ((draft?.kind === 'add-route' ? [draft.pattern, ...(draft.returnPattern ? [draft.returnPattern] : [])] : draft?.kind === 'replace-route' ? draft.patterns : []).find((pattern) => pattern.id === feature.properties?.id)?.distanceM ?? 0), 0) / 1000, 1)} km across both directions · preview shown above`
			: ''
	);
	const hasEditableService = $derived(!!selectedStop || !!selectedPattern);
	const buildTarget = $derived(activePatterns.find((pattern) => pattern.id === coveragePatternId));
	const extendsExisting = $derived(context === 'build' && buildTarget?.timing.kind === 'frequency');
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
			mapShown,
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
	const hasMixedAreas = $derived(areas.features.some((cell) => cell.properties.status === 'mixed'));
	const journeyLegend = $derived(
		TRAVEL_TIME_BANDS.filter(
			(band) =>
				['five', 'ten', 'fifteen', 'thirty', 'over-thirty'].includes(band.id) ||
				areas.features.some(
					(cell) => cell.properties.population > 0 && cell.properties.journeyTimeBand === band.id
				)
		)
	);
	const hasUnknownAreas = $derived(
		areas.features.some(
			(cell) => cell.properties.status === 'unknown' && cell.properties.population > 0
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
				return `${action.pattern.name}: ${number(((action.pattern.distanceM ?? 0) + (action.returnPattern?.distanceM ?? 0)) / 1000, 1)} km round trip, ${action.pattern.fleet ?? 'diesel'} fleet${window ? `, every ${window.headwayMinutes} minutes, ${timeLabel(window.startMinutes)}–${timeLabel(window.endMinutes)} MVT` : ', published departures'}.`;
			}
			case 'extend-route':
				return `Extend ${route} to ${action.stop.name}: ${number((action.distanceM + (action.returnDistanceM ?? 0)) / 1000, 1)} additional round-trip km.`;
			case 'replace-route':
				return `Reconnect ${route}: ${action.patterns.length} directions routed on roads with proposed service timing.`;
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
			if (!isMobile && drawer?.startsWith('mobile-')) closeOverlay();
		};
		syncMobile();
		mobileScreen.addEventListener('change', syncMobile);
		const toolbarObserver = new ResizeObserver(() => {
			mapControlsHeight = Math.ceil(mapToolbar.getBoundingClientRect().height);
		});
		toolbarObserver.observe(mapToolbar);
		const collapseSuggestions = () => {
			if (narrowScreen.matches) {
				areasExpanded = false;
				tour = -1;
			}
		};
		collapseSuggestions();
		narrowScreen.addEventListener('change', collapseSuggestions);
		client = new AnalysisWorkerClient(baseline);
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
		if (!initialized) return;
		const actions = scenario.actions;
		const assumptions = scenario.assumptions;
		const candidate = draft;
		const candidateActions = liveActions;
		const id = ++requestId;
		busy = true;
		const start = performance.now();
		untrack(() => {
			const seeds = lastWaveActions
				? waveTriggerCoordinates(baseline, lastWaveActions, actions, analysis?.world)
				: [];
			lastWaveActions = structuredClone(actions);
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
				document
					.querySelector<HTMLButtonElement>('.edit-mode-button')
					?.focus({ preventScroll: true })
			);
		}
		cancelDraft();
		context = null;
		editMode = false;
		selectedStopId = '';
	}
	function beginBuild(mode: BuildMode = 'destination') {
		mobileDetailExpanded = false;
		cancelDraft();
		context = 'build';
		editMode = true;
		areasExpanded = false;
		selectedStopId = '';
		setBuildMode(mode);
		if (selectedOrigin) focusCoordinate = coordinate(selectedOrigin);
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
		scenario.addAction(action);
		busy = true;
		context = 'service';
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
		scenario.addAction(proposal.action);
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
		scenario.addAction({ kind: 'set-fleet', patternId: selectedPattern.id, fleet: value });
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
		scenario.replaceActions(next.actions);
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
		scenario.addAction(draft);
		draft = null;
		preview = null;
		mobileDetailExpanded = true;
		if (tour === 1) tour = 2;
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
		if (gesture === 'stop') {
			notice = 'Finish or cancel the stop move before using Undo or Redo.';
			return;
		}
		cancelDraft();
		if (direction === 'undo' ? scenario.canUndo : scenario.canRedo) busy = true;
		scenario[direction]();
		notice = '';
		syncPrivateInputs();
	}
	function resetToDefault() {
		if (!initialized || busy || !startingAssumptions) return;
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
		overlayOpacity = 12;
		perspective = false;
		detailGrid = false;
		includeUntimedStops = false;
		showVessels = true;
		showAirport = true;
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
	<div class="result access-result">
		<span class="result-label"
			>ADDITIONAL PEOPLE <span class="result-chip"
				>{draft || liveActions
					? 'Preview'
					: gesture
						? 'Live'
						: scenario.actions.length
							? 'Proposal'
							: 'Baseline'}</span
			></span
		><strong
			>{shown ? `+${number(shown.summary.newlyReachedResidents)}` : 'Calculating…'}<span>
				benefiting</span
			></strong
		>
		<p>
			{number(shown?.summary.baselineReachableResidents)} within target before
			{#if shown?.summary.unknownResidents}<button onclick={() => (drawer = 'evidence')}
					>{number(shown.summary.unknownResidents)} unknown</button
				>{/if}
		</p>
	</div>
	<div class="result">
		<span class="result-label"
			>JOURNEY CHANGE <span class="result-context">Already within target</span></span
		><strong
			>{shown?.summary.minutesSavedForAlreadyReachable != null
				? number(Math.abs(shown.summary.minutesSavedForAlreadyReachable), 1)
				: 'Unavailable'}<span
				>{shown?.summary.minutesSavedForAlreadyReachable != null
					? shown.summary.minutesSavedForAlreadyReachable < 0
						? ' min slower'
						: ' min saved'
					: ''}</span
			></strong
		>
		<p>
			Population-weighted average
			{#if shown?.summary.lostAccessResidents}<button onclick={() => (drawer = 'mobile-results')}
					>{number(shown.summary.lostAccessResidents)} lose access</button
				>{/if}
		</p>
	</div>
	<div class="result">
		<span class="result-label"
			>INVESTMENT <button
				class="assumption-link"
				onclick={() => (costUnavailable ? (drawer = 'evidence') : openSettings('costs'))}
				>{costUnavailable ? 'Details' : 'Estimate'} <Info size={11} /></button
			></span
		><strong>{money(shown?.costs.capitalMvr?.central)}<span> one-time</span></strong>
		<p>{money(shown?.costs.annualOperatingMvr?.central)} / year change</p>
	</div>
	<div class="result carbon-result" class:carbon-increase={(shown?.carbon.central ?? 0) > 0}>
		<span class="result-label"
			>EMISSIONS {#if shown?.carbon.central == null && shown}<button
					class="assumption-link"
					onclick={() => (drawer = 'evidence')}>Why unavailable <Info size={11} /></button
				>{:else}<span class="result-context">Estimate</span>{/if}</span
		><strong
			>{shown?.carbon.central == null
				? 'Unavailable'
				: `${shown.carbon.central > 0 ? '+' : ''}${number(shown.carbon.central / 1000, 1)}`}<span
				>{shown?.carbon.central != null ? ' t CO₂e / yr' : ''}</span
			></strong
		>
		<p>
			{shown?.carbon.central == null
				? 'Missing inputs'
				: shown.carbon.central > 0
					? 'Increase under these assumptions'
					: shown.carbon.central < 0
						? 'Reduction under these assumptions'
						: 'No change'}
			{#if shown?.carbon.central != null}<button
					class="icon-button"
					aria-label="Carbon assumptions"
					onclick={() => openSettings('carbon')}><Info size={13} /></button
				>{/if}
		</p>
	</div>
{/snippet}
{#snippet priorityCards()}
	<h1>Where should we invest?</h1>

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
		{:else if context === 'connect'}
			<ConnectionEditor
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
		{:else}
			<div class="object-heading">
				<TransportGraphic
					kind={context === 'build'
						? buildMode === 'clinic' || buildMode === 'school'
							? buildMode
							: 'shelter'
						: selectedStop
							? 'shelter'
							: 'bus'}
					state={context === 'build'
						? 'draft'
						: (selectedStopMarker?.investmentState ?? 'existing')}
					size={64}
				/>
				<div>
					<h2>
						{context === 'build'
							? buildMode === 'clinic' || buildMode === 'school'
								? `Propose a ${buildMode}`
								: buildMode === 'stop'
									? 'Place a bus stop'
									: 'New bus connection'
							: (selectedStop?.name ?? selectedPattern?.name ?? 'Transport service')}
					</h2>
					{#if context === 'build' || selectedStopMarker}<span
							class="asset-status"
							class:proposed={context === 'build' ||
								['proposed', 'draft'].includes(String(selectedStopMarker?.investmentState))}
							class:moved={selectedStopMarker?.investmentState === 'moved'}
							class:paused={selectedStopMarker?.investmentState === 'paused'}
							>{context === 'build'
								? '+ Proposed · not built'
								: selectedStopMarker?.statusLabel}</span
						>{/if}
					<p>
						{context === 'build'
							? buildMode === 'clinic' || buildMode === 'school'
								? 'Try a future destination near a walking path.'
								: buildMode === 'stop'
									? 'Place it on a road, then choose where the bus goes.'
									: `Connect this area to ${scenario.assumptions.goal === 'healthcare' ? 'care' : 'school'}.`
							: selectedStop
								? selectedStop.mode === 'ferry'
									? 'Ferry terminal'
									: connectedRouteCount
										? `${connectedRouteCount} connected ${connectedRouteCount === 1 ? 'route' : 'routes'}`
										: 'No active bus connection'
								: (selectedPattern?.name ?? 'Select a service')}
					</p>
				</div>
			</div>
			{#if context === 'build'}
				<div class="build-mode-toggle" role="group" aria-label="What to build">
					<button
						aria-pressed={buildMode === 'destination'}
						onclick={() => setBuildMode('destination')}>Auto-connect</button
					>
					<button aria-pressed={buildMode === 'stop'} onclick={() => setBuildMode('stop')}
						>Stop first</button
					>
					<button aria-pressed={buildMode === 'clinic'} onclick={() => setBuildMode('clinic')}
						>Healthcare</button
					>
					<button aria-pressed={buildMode === 'school'} onclick={() => setBuildMode('school')}
						>School</button
					>
				</div>
				{#if buildMode === 'clinic' || buildMode === 'school'}<p class="edit-hint">
						Access assumes the proposed {buildMode} opens on the planning date. Capacity, hours, facility
						budgets and emissions are not supplied.
					</p>{/if}
			{/if}
			{#if selectedStop && editableBusStop && context === 'service'}
				<div class="stop-action-row">
					<button
						class="secondary-button"
						disabled={selectedStop.disabled}
						onclick={() => beginStopMove(selectedStopId)}
						>Move stop <ArrowUpRight size={14} /></button
					>
					<button
						class="primary-button"
						disabled={selectedStop.disabled}
						onclick={() => beginConnection(selectedStopId)}
						>Connect stop <BusFront size={15} /></button
					>
				</div>
				<p class="edit-hint">Drag to move, or choose Move stop and tap a new road.</p>
				{#if stopConnections.length}
					<div class="stop-connections" aria-label="Connected bus routes">
						<span>Connected routes</span>
						{#each stopConnections as pattern (pattern.id)}<button
								onclick={() => selectRoute(pattern.id)}
								><span
									>{pattern.name}<small
										>To {analysis?.world.stops.find((stop) => stop.id === pattern.stopIds.at(-1))
											?.name ?? 'route end'}</small
									></span
								><ChevronRight size={14} /></button
							>{/each}
					</div>
				{:else}<p class="edit-hint">
						No active bus connection. Connect this stop to start testing service.
					</p>{/if}
				{#if keepStopConnections && stopConnections.some((pattern) => pattern.timing.kind === 'scheduled')}
					<p class="edit-hint">
						Moving keeps these routes with proposed buses every {moveHeadway} min. Review timing below.
					</p>
				{/if}
				<details class="more-edit-options">
					<summary>When I move this stop</summary>
					<label class="move-connection-option"
						><input type="checkbox" bind:checked={keepStopConnections} />Keep bus connections</label
					>
					<p class="edit-hint">
						Routes follow permitted roads. Published departures become proposed frequency service;
						existing frequency is retained.
					</p>
					{#if keepStopConnections && stopConnections.some((pattern) => pattern.timing.kind === 'scheduled')}
						<label class="move-headway-option"
							>Proposed buses every <input
								type="number"
								min="1"
								max="240"
								bind:value={moveHeadway}
							/> min</label
						>
					{/if}
				</details>
			{/if}
			{#if extendsExisting && buildMode === 'destination'}<p class="edit-hint">
					Extends {buildTarget?.name}. Uses this route’s frequency and fleet; edit them after
					placing the stop.
				</p>{:else if (context === 'build' && buildMode === 'destination') || (context === 'service' && !selectedStop && selectedPattern?.timing.kind === 'frequency')}
				<div class="frequency-label">
					<label for="live-frequency">A bus every</label><strong>{headway}<span> min</span></strong>
				</div>
				<input
					id="live-frequency"
					class="frequency-slider"
					aria-label="Minutes between buses"
					type="range"
					min="1"
					max={Math.max(30, headway)}
					step="1"
					value={headway}
					oninput={(e) => previewFrequency(Number(e.currentTarget.value))}
					onchange={commitFrequency}
				/>
				<div class="slider-labels"><span>More often</span><span>Less often</span></div>
			{:else if context === 'service' && selectedPattern && !selectedStop}<button
					class="coverage-badge"
					onclick={() => (drawer = 'services')}
					><Info size={13} />Published timetable · view departures</button
				>{/if}
			{#if !extendsExisting && ((context === 'build' && buildMode === 'destination') || (context === 'service' && selectedPattern && !selectedStop))}<div
					class="fleet-toggle"
					aria-label="Bus fleet"
				>
					<button
						class:active={fleet === 'diesel'}
						aria-pressed={fleet === 'diesel'}
						onclick={() => changeFleet('diesel')}>Diesel</button
					><button
						class:active={fleet === 'electric'}
						aria-pressed={fleet === 'electric'}
						onclick={() => changeFleet('electric')}><Leaf size={14} />Electric</button
					>
				</div>{/if}
			{#if context === 'build'}<p class="placement-status" class:valid={!!draft}>
					{placementReason}
				</p>
				{#if buildMode === 'destination'}<details class="more-edit-options">
						<summary>Connect to an existing route</summary>
						<RoutePicker
							value={coveragePatternId}
							items={activePatterns.map((pattern) => ({
								value: pattern.id,
								label: `${pattern.timing.kind === 'frequency' ? 'Extend' : 'Feeder to'} ${pattern.name} · toward ${analysis?.world.stops.find((stop) => stop.id === pattern.stopIds.at(-1))?.name ?? 'last stop'}`
							}))}
							onchange={(value) => {
								coveragePatternId = value;
								if (placementPoint) previewPlacement(placementPoint);
							}}
						/>
					</details>{/if}
			{/if}
			{#if context === 'service'}<button
					class="quiet-button object-details"
					onclick={() => (drawer = 'services')}>Service details <ChevronRight size={14} /></button
				>{/if}
		{/if}
	</div>
{/snippet}

<svelte:window onkeydown={keydown} />
<div class="policy-atlas" style:--mobile-sheet-bottom="76px" style:--mobile-sheet-top="300px">
	<header class="atlas-header">
		<a class="brand" href="/" aria-label="Mobility Sandbox MV home"
			><span class="brand-symbol"
				><svg viewBox="0 0 32 32" aria-hidden="true"
					><path d="M5 23Q12 8 18 18T28 9" /><circle cx="5" cy="23" r="3" /><circle
						cx="28"
						cy="9"
						r="3"
					/></svg
				></span
			><span>Mobility Sandbox <b>MV</b><small>A better-connected Maldives</small></span></a
		>
		<div class="header-location">
			{#if snapshotStale}<button class="assumption-link" onclick={() => (drawer = 'evidence')}
					>Last validated snapshot · review dates in Evidence</button
				>{:else}<span class="live-dot"></span>GREATER MALÉ{/if}
		</div>
		<button
			class="coverage-badge header-coverage"
			onclick={() => (drawer = 'evidence')}
			title="The dated public snapshot does not include complete daily service."
			><Info size={13} />Partial timetable</button
		>
		<button
			class="mobile-menu-button"
			aria-label="Open menu"
			onclick={() => (drawer = 'mobile-menu')}><Menu size={21} /></button
		>
		<div class="header-actions">
			<button
				class="quiet-button tour-button"
				onclick={() => {
					tour = tour < 0 ? 0 : -1;
					if (tour === 0) areasExpanded = true;
				}}>Tour</button
			><button class="quiet-button" onclick={() => (drawer = 'evidence')}
				><Layers size={16} /> Evidence</button
			><button class="quiet-button" onclick={() => openSettings()}
				><Settings2 size={16} />Settings</button
			>
			<button class="quiet-button" onclick={compareAlternatives} disabled={busy || !selectedId}
				>Compare</button
			>
			<button class="brief-button" onclick={openBrief} disabled={busy || !analysis}
				><FileText size={16} /> Policy brief <ArrowUpRight size={15} /></button
			>
		</div>
	</header>
	<button
		class="mobile-results-trigger"
		aria-label="Open policy results and assumptions"
		aria-haspopup="dialog"
		aria-expanded={drawer === 'mobile-results'}
		onclick={() => (drawer = 'mobile-results')}
	>
		<span
			class="mobile-result-grid"
			aria-live={gesture || placing ? 'off' : 'polite'}
			aria-busy={busy}
		>
			<span
				><small>Access</small><strong
					>{shown ? `+${number(shown.summary.newlyReachedResidents)}` : '…'}</strong
				><em>additional people</em></span
			>
			<span
				><small>Journey</small><strong
					>{shown?.summary.minutesSavedForAlreadyReachable == null
						? '—'
						: number(Math.abs(shown.summary.minutesSavedForAlreadyReachable), 1)}</strong
				><em
					>{shown?.summary.minutesSavedForAlreadyReachable == null
						? 'Unavailable'
						: shown.summary.minutesSavedForAlreadyReachable < 0
							? 'min slower'
							: 'min saved'}</em
				></span
			>
			<span
				><small>Cost</small><strong
					>{shown?.costs.capitalMvr?.central == null
						? '—'
						: money(shown.costs.capitalMvr.central).replace('MVR ', '')}</strong
				><em>{shown?.costs.capitalMvr?.central == null ? 'Unavailable' : 'MVR one-time'}</em></span
			>
			<span class:carbon-increase={(shown?.carbon.central ?? 0) > 0}
				><small>Carbon</small><strong
					>{shown?.carbon.central == null
						? '—'
						: `${shown.carbon.central > 0 ? '+' : ''}${number(shown.carbon.central / 1000, 1)}`}</strong
				><em>{shown?.carbon.central == null ? 'Unavailable' : 't CO₂e / yr'}</em></span
			>
		</span>
		<span class="mobile-results-caption"
			><span
				>{draft || liveActions
					? 'Live preview'
					: scenario.actions.length
						? 'Proposal'
						: 'Current network'} · estimates</span
			><span>Details <ChevronRight size={12} /></span></span
		>
	</button>
	<section
		class="results-bar"
		aria-label="Policy results"
		aria-live={gesture || placing ? 'off' : 'polite'}
		aria-busy={busy}
	>
		{@render policyResults()}
	</section>
	<div
		class="planning-context"
		class:outside={coverage.status === 'outside-snapshot' || coverage.status === 'unavailable'}
	>
		<button
			onclick={() => openSettings('journey')}
			aria-label="Change planning date and departure time"
			>{scenario.assumptions.date} · {timeLabel(scenario.assumptions.departureMinutes)} MVT <ChevronDown
				size={13}
			/></button
		>
		<button onclick={() => (drawer = 'evidence')}><Info size={13} />{coverage.label}</button>
		{#if (scenario.assumptions.goal === 'healthcare' && scenario.assumptions.destinationRequirements?.healthcareService && scenario.assumptions.destinationRequirements.healthcareService !== 'general') || (scenario.assumptions.goal === 'education' && scenario.assumptions.destinationRequirements?.schoolLevel) || scenario.assumptions.destinationRequirements?.publicAccess === 'public' || scenario.assumptions.destinationRequirements?.requireOpenAtDeparture || scenario.assumptions.walkingRequirements?.requireAuditedWheelchair}
			<button
				onclick={() => openSettings('journey')}
				aria-label="Review destination and walking requirements"
				>{destinationScope}{scenario.assumptions.walkingRequirements?.requireAuditedWheelchair
					? ' · audited routes'
					: ''} · filtered</button
			>
		{/if}
		{#if coverage.status === 'outside-snapshot'}<button
				class="supported-time"
				onclick={() => patchAssumptions(supportedSnapshotSettings(baseline))}
				>Use supported time</button
			>{:else}<span>Missing service can affect benefits</span>{/if}
	</div>
	<div class="workspace">
		<main
			class="map-stage"
			style:--map-controls-height={`${mapOverlayHeight}px`}
			class:editing={editMode}
			class:has-selection={context !== null}
			class:satellite={basemap === 'satellite'}
		>
			<AtlasMap
				controlsHeight={mapOverlayHeight}
				{mobileBottomInset}
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
			{#if isMobile}
				<div class="mobile-map-controls">
					<div class="mobile-map-row">
						<button
							class="mobile-goal"
							onclick={() => (drawer = 'mobile-map')}
							aria-label="Change access destination and map layers"
							><span
								>{scenario.assumptions.goal === 'healthcare' ? 'Healthcare' : 'Schools'}<small
									>{scenario.assumptions.targetMinutes} min · {view === 'people'
										? 'People'
										: view === 'impact'
											? 'Impact'
											: 'Access'}</small
								></span
							><ChevronDown size={16} /></button
						>
						<button
							class="mobile-map-icon"
							aria-label="Map layers and appearance"
							onclick={() => (drawer = 'mobile-map')}><Layers size={19} /></button
						>
						<button
							class="mobile-map-icon"
							aria-label="Show map overview"
							onclick={() => {
								focusCoordinate = null;
								overviewRequest += 1;
							}}><LocateFixed size={19} /></button
						>
					</div>
					<button class="mobile-areas-button" onclick={() => (drawer = 'mobile-areas')}
						>Where should we invest? <span>{priorities.length}</span><ChevronRight
							size={14}
						/></button
					>
				</div>
			{/if}
			<div class="map-topbar" bind:this={mapToolbar}>
				<div class="map-view-controls">
					<DiscreteTabs
						items={views}
						value={view}
						onchange={(next) => (view = next)}
					/><DestinationPicker
						value={scenario.assumptions.goal}
						onchange={(goal) => patchAssumptions({ goal })}
					/>
				</div>
				<div class="map-options">
					{#if transportContext?.followme.enabled || transportContext?.mpl.enabled || transportContext?.aviation.enabled}
						<button
							class="sea-air-button"
							onclick={() => {
								transportTab = 'boats';
								drawer = 'transport';
							}}><TransportGraphic kind="speedboat" size={24} /> Sea & air</button
						>
					{/if}
					<button
						onclick={() => {
							focusCoordinate = null;
							overviewRequest += 1;
						}}>Overview</button
					>
					<button
						class:active={perspective}
						onclick={() => (perspective = !perspective)}
						aria-pressed={perspective}>Perspective</button
					>
					<details class="basemap-picker">
						<summary
							><Layers size={15} />{basemap === 'atlas'
								? 'Atlas'
								: basemap === 'streets'
									? 'Streets'
									: 'Satellite'}<ChevronRight size={13} /></summary
						>
						<div class="basemap-menu">
							<span class="eyebrow">MAP APPEARANCE</span
							>{#each [{ id: 'atlas', label: 'Policy atlas', note: 'Calm · available offline' }, { id: 'streets', label: 'Street map', note: 'Street names · online' }, { id: 'satellite', label: 'Satellite', note: SATELLITE_DETAIL }] as option (option.id)}<button
									aria-pressed={basemap === option.id}
									onclick={(event) => {
										basemap = option.id as BasemapMode;
										event.currentTarget.closest('details')?.removeAttribute('open');
									}}
									><span><strong>{option.label}</strong><small>{option.note}</small></span
									>{#if basemap === option.id}<Check size={15} />{/if}</button
								>{/each}
							{@render opacityControl('desktop-hexagon-opacity')}
							<p class="imagery-license">
								<a href={SATELLITE_LICENSE_URL} target="_blank" rel="noopener noreferrer"
									>{SATELLITE_LICENSE_NOTICE}</a
								>
							</p>
						</div>
					</details>
				</div>
			</div>
			<details class="priority-panel" bind:open={areasExpanded}>
				<summary
					><span>Suggested areas</span><span class="small-pill">{priorities.length}</span
					><ChevronRight size={15} /></summary
				>
				<div class="priority-content">
					{@render priorityCards()}
				</div>
			</details>
			{#if tour >= 0}<section class="tour-card" aria-label="Guided walkthrough">
					<div>
						<span class="eyebrow">A DECISION IN ONE MINUTE</span><button
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
			{#if placing && movingStopId}<div class="placement-prompt">
					Choose a street · click, or pan the target and press Enter
					<button onclick={() => cancelDraft()}>Cancel</button>
				</div>{/if}
			<div
				class="map-key"
				role="group"
				aria-label={view === 'access' ? 'Journey time bands' : 'Map legend'}
			>
				{#if basemap === 'satellite'}<span class="imagery-caption">{SATELLITE_DETAIL}</span>{/if}
				{#if view === 'access'}
					<span class="time-key-title"
						>Time to {scenario.assumptions.goal === 'education' ? 'school' : 'care'}</span
					>
					{#each journeyLegend as band (band.id)}
						<span><i style:background={band.color}></i>{band.label}</span>
					{/each}
				{:else}
					<span
						><i class="reachable-key"></i>{view === 'people'
							? 'People · estimated'
							: 'Within access target'}</span
					>
					{#if view === 'impact'}
						<span><i class="gap-key"></i>Beyond target</span><span
							><i class="gain-key"></i>Newly reached</span
						>
						{#if hasMixedAreas}<span><i class="mixed-key"></i>Mixed outcomes</span>{/if}
						{#if hasUnknownAreas}<span><i class="unknown-key"></i>Incomplete data</span>{/if}
					{/if}
				{/if}
				<button onclick={() => (drawer = 'evidence')} class="stop-key-button"
					><i class="stop-key"></i>Existing assets</button
				>
				{#if hasProposedAssets || context === 'build'}<span class="proposal-key"
						><b aria-hidden="true">+</b>Proposed · not built</span
					>{/if}
			</div>

			{#if context}
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
			<div class="edit-dock" aria-label="Map tools">
				<button
					class="edit-mode-button"
					class:active={!editMode}
					aria-pressed={!editMode}
					onclick={dismissContext}><MousePointer2 size={17} />Explore</button
				>
				<button
					class="dock-tool"
					class:active={context === 'build'}
					aria-pressed={context === 'build'}
					aria-label="Build stops, healthcare or schools"
					onclick={() => beginBuild()}
					disabled={!selectedId}><TransportGraphic kind="bus" size={31} />Build</button
				>
				<button class="dock-tool" onclick={() => (drawer = 'services')}
					><TransportGraphic kind="shelter" size={31} />Services</button
				><span class="dock-divider"></span>
				<div class="history-buttons">
					<button
						class="icon-button"
						disabled={!scenario.canUndo || gesture === 'stop'}
						onclick={() => history('undo')}
						aria-label="Undo change"><RotateCcw size={17} /></button
					><button
						class="icon-button"
						disabled={!scenario.canRedo || gesture === 'stop'}
						onclick={() => history('redo')}
						aria-label="Redo change"><RotateCw size={17} /></button
					><button
						class="reset-button"
						disabled={!initialized || busy}
						onclick={resetToDefault}
						aria-label="Reset to default"
						title="Restore the starting proposal, planning settings and map view"
						><ListRestart size={17} />Reset</button
					><button
						class="icon-button"
						onclick={() => openSettings('proposal')}
						aria-label="Proposal options"><Ellipsis size={19} /></button
					>
				</div>
				<span class="live-status" class:updating={busy}
					><span class="live-dot"></span>{busy
						? 'Updating'
						: draft
							? 'Preview'
							: savedOnDevice
								? 'Saved'
								: 'Ready'}</span
				>
			</div>
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
					? 'Sandbox menu'
					: drawer === 'mobile-map'
						? 'Map options'
						: drawer === 'mobile-areas'
							? 'Suggested investment areas'
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
							<span class="eyebrow">MOBILITY SANDBOX</span>
							<h2>
								{drawer === 'mobile-menu'
									? 'Your workspace'
									: drawer === 'mobile-map'
										? 'Make the map yours'
										: drawer === 'mobile-areas'
											? 'Find an access gap'
											: 'What changes?'}
							</h2>
						</div>
						<button class="icon-button" aria-label="Close drawer" onclick={closeOverlay}
							><X size={20} /></button
						>
					</div>
					<div class="mobile-drawer-body">
						{#if drawer === 'mobile-menu'}
							<div class="mobile-menu-list">
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
										><strong>Your proposal</strong><small>Save, import or export</small></span
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
									{#each [{ id: 'atlas', label: 'Policy atlas', note: 'Calm · works offline' }, { id: 'streets', label: 'Street map', note: 'Road names · online' }, { id: 'satellite', label: 'Satellite', note: SATELLITE_DETAIL }] as option (option.id)}<button
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
										<span><i class="reachable-key"></i>Within access target</span><span
											><i class="gap-key"></i>Beyond target</span
										><span><i class="gain-key"></i>Newly reached</span><span
											><i class="mixed-key"></i>Mixed outcomes</span
										><span><i class="unknown-key"></i>Incomplete data</span>
									{/if}
									<span><i class="stop-key"></i>Existing assets</span><span class="proposal-key"
										><b>+</b>Proposed · not built</span
									>
								</div>
								{#if view === 'access'}<p class="journey-legend-note">
										Modeled walk, wait and ride time. Gray means incomplete data; mixed cells
										contain different time bands.
									</p>{/if}
							</details>
							{#if basemap === 'satellite'}<p class="imagery-license">
									<a href={SATELLITE_LICENSE_URL} target="_blank" rel="noopener noreferrer"
										>{SATELLITE_LICENSE_NOTICE}</a
									>
								</p>{/if}
							<button class="primary-button full-width" onclick={closeOverlay}
								>Back to the map</button
							>
						{:else if drawer === 'mobile-areas'}
							<p class="mobile-drawer-intro">
								Start with a place where reaching {scenario.assumptions.goal === 'healthcare'
									? 'care'
									: 'school'} takes too long.
							</p>
							<div class="mobile-priority-cards">{@render priorityCards()}</div>
						{:else}
							<p class="mobile-drawer-intro">
								Your proposal, compared with the current network. Costs and emissions depend on your
								assumptions.
							</p>
							<div class="mobile-detailed-results">{@render policyResults()}</div>
							<button class="secondary-button full-width" onclick={() => openSettings('carbon')}
								>Review carbon assumptions <ArrowUpRight size={15} /></button
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
								after: money(analysis?.costs.capitalMvr?.central),
								detail: `Illustrative low–high range: ${money(analysis?.costs.capitalMvr?.low)}–${money(analysis?.costs.capitalMvr?.high)}. Local prices require verification.`
							},
							{
								label: 'Annual operating change',
								before: 'MVR 0',
								after: money(analysis?.costs.annualOperatingMvr?.central),
								detail: `Illustrative low–high range: ${money(analysis?.costs.annualOperatingMvr?.low)}–${money(analysis?.costs.annualOperatingMvr?.high)}. Local rates require verification.`
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
						interventions={scenario.actions.map(describeAction)}
						evidence={sourceEvidence}
						assumptions={[
							`${scenario.assumptions.date}, ${timeLabel(scenario.assumptions.departureMinutes)} MVT; ${scenario.assumptions.targetMinutes}-minute target; max ${scenario.assumptions.maxTransfers} transfers.`,
							`${scenario.assumptions.populationYear} population is modeled within official island totals${scenario.assumptions.housingDistribution?.length ? '; housing completion is conditional' : ''}.`,
							`${coverage.label}; full calendars and ferry crossing times are incomplete.`,
							`${destinationScope}${scenario.assumptions.destinationRequirements?.publicAccess === 'public' ? ', public only' : ''}; ${scenario.assumptions.destinationRequirements?.requireOpenAtDeparture ? 'verified hours required' : 'hours unverified'}. Required missing metadata stays unknown.`,
							'Costs and energy factors are illustrative. Carbon depends on assumed private-travel displacement; added service can increase emissions.',
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
							planningAssumptions: scenario.assumptions,
							sourceMetadata: [...baseline.sources, ...(policyEvidence?.sources ?? [])]
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
									? 'No affordable option with a measured benefit was found. Adjust the limits, try another area, or collect better service data.'
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
								scenario.addAction(action);
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
								represents one contributing population origin. Impact shows gains and losses against
								the selected access target.
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
	.planning-context {
		display: flex;
		flex: 0 0 auto;
		align-items: center;
		gap: 14px;
		padding: 4px 24px;
		min-height: 30px;
		background: #f3f6ef;
		border-bottom: 1px solid #dce5d8;
		color: #73866b;
		font-size: 11px;
	}
	.planning-context button {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: #58754e;
		border: 0;
		background: transparent;
		padding: 4px 0;
		min-height: 26px;
		font: inherit;
		cursor: pointer;
		white-space: nowrap;
	}
	.planning-context.outside {
		background: #fff3df;
		color: #987435;
	}
	.planning-context.outside button {
		color: #91692b;
	}
	.planning-context .supported-time {
		margin-left: auto;
		font-weight: 650;
		text-decoration: underline;
		text-underline-offset: 3px;
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
	@media (max-width: 760px) {
		.planning-context {
			padding: 3px 12px;
			gap: 10px;
			font-size: 10px;
			min-height: 30px;
			flex-wrap: wrap;
		}
		.planning-context > span {
			display: none;
		}
		.planning-context button {
			min-height: 28px;
			white-space: normal;
			text-align: left;
		}
		.planning-context .supported-time {
			margin-left: 0;
		}
	}
	.atlas-dialog.transport-dialog {
		--transport-panel-height: calc(100dvh - 48px);
		width: min(920px, calc(100vw - 32px));
		overflow: hidden;
	}
	.map-options .sea-air-button {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		white-space: nowrap;
	}
	.map-view-controls {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.context-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px 0;
	}
	.object-heading {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 4px 0 14px;
	}
	.object-heading > div {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.object-heading h2 {
		font-size: 18px;
		margin: 0 0 5px;
	}
	.object-heading p {
		margin: 0;
		color: #71868a;
		font-size: 13px;
		line-height: 1.45;
	}
	.object-details {
		width: 100%;
		justify-content: center;
		margin-top: 8px;
	}
	.placement-status {
		font-size: 13px;
		line-height: 1.5;
		padding: 11px;
		border-radius: 8px;
		color: #927133;
		background: #fbf6e9;
	}
	.placement-status.valid {
		color: #147761;
		background: #edf7f1;
	}
	.basemap-picker {
		position: relative;
	}
	.basemap-picker > summary {
		display: flex;
		align-items: center;
		gap: 7px;
		cursor: pointer;
		list-style: none;
		font-size: 13px;
		padding: 9px;
		color: #537076;
		border-radius: 6px;
	}
	.basemap-picker > summary::-webkit-details-marker {
		display: none;
	}
	.basemap-picker[open] > summary {
		background: #e8f2ec;
	}
	.basemap-menu {
		position: absolute;
		right: 0;
		top: calc(100% + 9px);
		width: 220px;
		max-width: calc(100vw - 24px);
		max-height: min(400px, calc(100dvh - 48px));
		overflow-y: auto;
		padding: 12px;
		border: 1px solid #d9e4df;
		border-radius: 12px;
		background: #fff;
		box-shadow: 0 12px 32px #26483a22;
		z-index: 6;
	}
	.basemap-menu > span {
		display: block;
		margin: 0 6px 8px;
	}
	.map-options .basemap-menu button {
		display: flex;
		justify-content: space-between;
		align-items: center;
		width: 100%;
		text-align: left;
		padding: 9px 7px;
	}
	.basemap-menu strong,
	.basemap-menu small {
		display: block;
	}
	.basemap-menu strong {
		font-size: 14px;
		font-weight: 600;
	}
	.basemap-menu small {
		margin-top: 4px;
		color: #788c8b;
		font-size: 12px;
	}
	.basemap-menu button[aria-pressed='true'] {
		color: #18735c;
		background: #eaf5ee;
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
	.map-stage.has-selection .map-key {
		left: 24px;
		right: auto;
		max-width: calc(100% - 440px);
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
	.edit-dock {
		position: absolute;
		bottom: 36px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 12px;
		white-space: nowrap;
		max-width: calc(100% - 100px);
		padding: 7px;
		border: 1px solid #c7ddda;
		border-radius: 14px;
		background: #ffffffed;
		box-shadow: 0 8px 28px #254b631c;
		z-index: 3;
	}
	.edit-mode-button,
	.dock-tool {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		border: 0;
		padding: 11px 13px;
		border-radius: 9px;
		background: #edf5f2;
		color: #256960;
		font-size: 14px;
		font-weight: 600;
	}
	.edit-mode-button.active {
		background: #087f7c;
		color: #fff;
	}
	.dock-tool {
		padding: 4px 9px;
		background: transparent;
	}
	.dock-tool:hover {
		background: #edf5f2;
	}
	.dock-tool.active {
		background: #e2f2ec;
		color: #126651;
		box-shadow: inset 0 0 0 1px #a8cdbf;
	}
	.dock-divider {
		height: 25px;
		width: 1px;
		background: #d8e5df;
	}
	.live-status {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		color: #167f70;
		padding-right: 8px;
	}
	.live-status.updating {
		color: #9c742b;
	}
	.live-status.updating .live-dot {
		background: #bb8939;
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
	.coverage-badge {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 6px 8px;
		border: 1px solid #e9dfc5;
		border-radius: 6px;
		background: #faf7ed;
		color: #947331;
		font-size: 12px;
	}
	.header-coverage {
		margin-left: auto;
	}
	.edit-hint {
		font-size: 13px;
		color: #6e8687;
		margin: 0 0 16px;
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
	.more-edit-options {
		font-size: 13px;
		color: #6e8885;
		margin-top: 10px;
	}
	.more-edit-options summary {
		cursor: pointer;
		padding: 5px 0;
	}
	.more-edit-options[open] > summary {
		margin-bottom: 14px;
	}
	@media (max-width: 680px) {
		.header-coverage {
			display: none;
		}
		.edit-dock {
			left: 18px;
			right: 55px;
			transform: none;
			max-width: none;
			gap: 6px;
		}
	}
	.previous-proposal {
		flex-shrink: 0;
		padding: 6px 8px;
		background: white;
		border: 1px solid #bdd1ce;
		border-radius: 5px;
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
		border-radius: 10px;
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
	.map-key .stop-key {
		background: #5285aa;
		border-radius: 50%;
		border: 1px solid white;
	}
	.map-key .stop-key-button {
		display: inline-flex;
		align-items: center;
		gap: 5px;
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
	.atlas-header {
		min-height: 64px;
		flex-shrink: 0;
		padding: 0 26px;
		display: flex;
		align-items: center;
		gap: 24px;
		background: #fff;
		border-bottom: 1px solid var(--line);
		z-index: 5;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 11px;
		text-decoration: none;
		color: var(--ink);
		font-size: 19px;
		font-weight: 650;
		letter-spacing: -0.6px;
		line-height: 1.3;
	}
	.brand b {
		color: #087f7c;
		font-weight: 700;
	}
	.brand small {
		display: block;
		color: var(--muted);
		font-size: 13px;
		letter-spacing: 0.2px;
		font-weight: 450;
		margin-top: 2px;
	}
	.brand-symbol {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: 10px;
		background: #edf7f3;
	}
	.brand-symbol svg {
		width: 27px;
		fill: #0b8580;
	}
	.brand-symbol path {
		fill: none;
		stroke: #0b8580;
		stroke-width: 3;
		stroke-linecap: round;
	}
	.header-location {
		margin-left: 24px;
		min-width: 0;
		max-width: 260px;
		overflow-wrap: anywhere;
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		letter-spacing: 1.2px;
		font-weight: 650;
		color: #6b848a;
	}
	.live-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		background: #238e80;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.header-actions {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-left: 0;
		min-width: 0;
	}
	.quiet-button,
	.brief-button,
	.primary-button,
	.secondary-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		border-radius: 8px;
		border: 0;
		padding: 10px 12px;
		font-size: 12px;
		font-weight: 600;
	}
	.quiet-button {
		background: transparent;
		color: #5c7985;
	}
	.brief-button {
		background: #edf5f2;
		border: 1px solid #d7e6e0;
		color: #2d6b60;
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
		border-radius: 6px;
	}
	.icon-button:hover,
	.quiet-button:hover {
		background: #eff4f2;
	}
	.results-bar {
		display: grid;
		grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.95fr) minmax(0, 1.1fr) minmax(0, 1fr);
		background: #fff;
		border-bottom: 1px solid var(--line);
		min-height: 96px;
		z-index: 3;
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
	.workspace {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.map-stage {
		--map-controls-top: 20px;
		--map-overlay-top: calc(var(--map-controls-top) + var(--map-controls-height) + 14px);
		position: relative;
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}
	.map-topbar {
		position: absolute;
		top: var(--map-controls-top);
		left: 24px;
		right: 24px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		z-index: 2;
	}
	.map-topbar:has(.basemap-picker[open]) {
		z-index: 6;
	}
	.map-options {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 4px;
		background: #ffffffea;
		border: 1px solid #d3e5e2;
		border-radius: 9px;
		box-shadow: 0 4px 15px #3e70840c;
		flex-shrink: 0;
	}
	.map-options > button:not(.icon-button) {
		padding: 6px 10px;
		border: 0;
		background: transparent;
		color: #69868d;
		font-size: 13px;
		border-radius: 5px;
	}
	.map-options > button.active {
		color: #117d78;
		background: #e7f3ee;
	}
	.priority-panel {
		position: absolute;
		top: var(--map-overlay-top);
		left: 25px;
		width: 240px;
		z-index: 2;
	}
	.priority-panel:not([open]) {
		width: 188px;
	}
	.priority-panel > summary {
		list-style: none;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 11px 13px;
		border: 1px solid #c5dcdb;
		border-radius: 10px;
		background: #fffffff2;
		box-shadow: 0 4px 14px #2146500d;
		cursor: pointer;
		font-size: 14px;
		font-weight: 600;
	}
	.priority-panel > summary::-webkit-details-marker {
		display: none;
	}
	.priority-panel > summary :global(svg) {
		margin-left: auto;
	}
	.priority-panel[open] > summary :global(svg) {
		transform: rotate(90deg);
	}
	.priority-content {
		padding-top: 8px;
	}
	.map-stage.satellite .priority-content h1 {
		color: #fff;
		text-shadow: 0 1px 6px #102b38;
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
	.small-pill {
		padding: 3px 6px;
		font-size: 12px;
		color: #6e9389;
		background: #edf5ed;
		border-radius: 4px;
		font-weight: 600;
		letter-spacing: 0.1px;
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
	.map-key {
		position: absolute;
		right: 14px;
		bottom: 104px;
		background: #fffffff0;
		border: 1px solid #d7e6e2;
		padding: 8px 10px;
		border-radius: 7px;
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		align-items: center;
		font-size: 12px;
		color: #607e87;
	}
	.map-key > span {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.map-key .proposal-key {
		color: #965108;
		font-weight: 600;
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
	.asset-status {
		display: inline-flex;
		margin-top: 5px;
		padding: 3px 6px;
		border-radius: 5px;
		background: #e9f5f3;
		color: #166c72;
		font-size: 11px;
		line-height: 1.4;
		font-weight: 650;
	}
	.asset-status.proposed {
		background: #fff1d5;
		color: #965108;
	}
	.asset-status.moved {
		background: #f0eafa;
		color: #6950a5;
	}
	.asset-status.paused {
		background: #edf0f1;
		color: #5d6e76;
	}
	.map-key i {
		width: 7px;
		height: 7px;
		display: inline-block;
		border-radius: 2px;
	}
	.reachable-key {
		background: #78baa5;
	}
	.gap-key {
		background: #e3b272;
	}
	.gain-key {
		background: #00a68c;
	}
	.mixed-key {
		background: #8c91b5;
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
	.map-key button {
		border: 0;
		padding: 0;
		color: #79939a;
		background: transparent;
		font-size: 12px;
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
		border-radius: 7px;
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
		border-radius: 5px;
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
		border-radius: 9px;
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
	.history-buttons {
		margin-left: auto;
		display: flex;
		align-items: center;
	}
	.reset-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		min-height: 32px;
		padding: 0 8px;
		border: 0;
		border-radius: 6px;
		background: transparent;
		color: #67818b;
		font-size: 12px;
		font-weight: 600;
	}
	.reset-button:hover {
		background: #eff4f2;
	}
	.notice {
		position: fixed;
		bottom: 100px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 15;
		display: flex;
		align-items: center;
		gap: 16px;
		max-width: 650px;
		background: #173e49;
		color: #fff;
		box-shadow: 0 10px 40px #173e4930;
		border-radius: 10px;
		padding: 10px 15px;
		font-size: 12px;
		width: max-content;
		max-width: min(650px, calc(100vw - 24px));
		flex-wrap: wrap;
		overflow-wrap: anywhere;
	}
	.notice > span {
		flex: 1 1 180px;
		min-width: 0;
	}
	.notice .icon-button {
		color: #c3dcdb;
	}
	.hidden-upload {
		display: none;
	}
	.tour-card {
		position: absolute;
		z-index: 5;
		top: var(--map-overlay-top);
		left: 290px;
		width: 260px;
		border-radius: 14px;
		padding: 16px;
		background: #fffef8;
		border: 1px solid #d9ddc7;
		box-shadow: 0 15px 45px #294e641f;
	}
	.tour-card > div {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.tour-card strong {
		font-size: 16px;
		display: block;
		margin: 9px 0;
	}
	.tour-card p {
		font-size: 12px;
		line-height: 1.6;
		color: #7a8b7b;
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
		border-radius: 8px;
		font-size: 13px;
		z-index: 6;
	}
	.placement-prompt button {
		padding: 3px 8px;
		border: 1px solid #7aa9aa;
		border-radius: 4px;
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
		border-radius: 16px;
		background: #fffcf7;
		color: var(--ink);
		overflow: auto;
		overscroll-behavior: contain;
		scrollbar-width: thin;
		box-shadow: 0 24px 80px #21465030;
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
		width: min(560px, 100vw);
		height: 100dvh;
		max-height: 100dvh;
		margin: 0 0 0 auto;
		border: 0;
		border-radius: 0;
	}
	.atlas-dialog.wide {
		width: min(1030px, calc(100vw - 48px));
	}
	.atlas-dialog.document {
		width: min(850px, calc(100vw - 48px));
	}
	.evidence-drawer {
		background: #fffcf7;
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
		background: #fffcf7;
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
		border-radius: 10px;
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
		border-radius: 7px;
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
		border-radius: 10px;
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
		border-radius: 7px;
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
		border-radius: 5px;
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
		.tour-card {
			left: 315px;
		}
		.map-stage.has-selection .map-key {
			max-width: calc(100% - 470px);
		}
		.decision-panel {
			width: 390px;
		}
		.priority-panel {
			width: 265px;
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
		.priority-panel h1 {
			font-size: 23px;
		}
		.priority-card {
			padding: 8px 10px;
		}
		.map-key {
			bottom: 104px;
		}
	}
	@media (max-width: 1150px) {
		.tour-card {
			left: 260px;
		}
		.header-coverage {
			display: none;
		}
		.header-actions {
			margin-left: auto;
		}
		.map-topbar {
			align-items: flex-start;
			flex-direction: column;
			gap: 8px;
		}
		.map-view-controls {
			flex-wrap: wrap;
			max-width: 100%;
		}
		.map-options {
			align-self: flex-end;
		}
		.header-location {
			display: none;
		}
		.decision-panel {
			width: 335px;
		}
		.result {
			padding: 14px 18px;
		}
		.result strong {
			font-size: 23px;
		}
		.priority-panel {
			width: 215px;
			left: 18px;
		}
	}
	@media (max-width: 900px) {
		.tour-card {
			display: none;
		}
		.atlas-header {
			padding: 0 16px;
		}
		.tour-button {
			display: none;
		}
		.header-actions {
			gap: 4px;
		}
		.brand {
			font-size: 15px;
		}
		.result-context {
			display: none;
		}
		.result {
			padding: 12px;
		}
		.results-bar {
			min-height: 99px;
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
		.priority-panel {
			width: 200px;
		}
		.map-key {
			bottom: 104px;
			left: 18px;
			right: auto;
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
		.atlas-header {
			min-height: 62px;
			flex-wrap: wrap;
			gap: 12px;
			padding: 12px 16px;
		}
		.brand small {
			font-size: 12px;
		}
		.header-actions .quiet-button {
			display: inline-flex;
			font-size: 12px;
			padding: 7px 6px;
		}
		.header-actions .tour-button {
			display: none;
		}
		.header-actions {
			width: 100%;
			display: grid;
			grid-template-columns: repeat(4, minmax(0, 1fr));
			gap: 4px;
		}
		.header-actions > button {
			min-width: 0;
			min-height: 44px;
			gap: 4px;
			padding: 6px 4px;
			line-height: 1.3;
		}
		.header-actions > button :global(svg) {
			flex-shrink: 0;
		}
		.header-actions .brief-button :global(svg:last-child) {
			display: none;
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
			width: 100vw;
			max-height: 100dvh;
		}
		.settings-grid,
		.settings-grid.journey-basics {
			grid-template-columns: 1fr;
		}
		.live-status {
			display: none;
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
		.brief-button {
			padding: 8px;
			font-size: 12px;
		}
		.results-bar {
			grid-template-columns: repeat(2, minmax(0, 1fr));
			flex-shrink: 0;
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
		.workspace {
			flex-direction: column;
			flex: none;
		}
		.map-stage {
			--map-controls-top: 12px;
			min-height: 680px;
			height: clamp(680px, 85dvh, 780px);
			flex: none;
		}
		.map-topbar {
			flex-direction: column;
			align-items: flex-start;
			gap: 10px;
			left: 12px;
			right: 12px;
		}
		.decision-panel {
			width: calc(100% - 24px);
			right: 12px;
			max-height: calc(100% - var(--map-overlay-top) - 222px);
		}
		.panel-scroll {
			overflow: auto;
		}
		.priority-panel {
			left: 12px;
			width: min(260px, calc(100% - 24px));
		}
		.priority-content {
			max-height: 170px;
			overflow: auto;
		}
		.priority-panel h1 {
			font-size: 18px;
			letter-spacing: -0.5px;
		}
		.map-stage.has-selection .priority-panel {
			display: none;
		}
		.map-stage.has-selection .map-key {
			display: none;
		}
		.map-key {
			bottom: 220px;
			left: 12px;
			max-width: calc(100% - 24px);
			gap: 6px 10px;
			padding: 8px 10px;
		}
		.edit-dock {
			bottom: max(90px, env(safe-area-inset-bottom));
			left: 12px;
			right: 12px;
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 4px;
		}
		.edit-dock .edit-mode-button,
		.edit-dock .dock-tool {
			min-width: 0;
			min-height: 48px;
			padding: 5px;
			font-size: 12px;
			gap: 4px;
		}
		.edit-dock .dock-divider {
			display: none;
		}
		.edit-dock .history-buttons {
			grid-column: 1 / -1;
			margin: 0;
			justify-content: center;
			gap: 12px;
		}
		.edit-dock .icon-button {
			width: 44px;
			height: 44px;
		}
		.map-view-controls {
			width: 100%;
			flex-direction: column;
			align-items: flex-start;
			gap: 8px;
		}
		.map-options {
			align-self: stretch;
			max-width: 100%;
			gap: 2px;
		}
		.map-options > button:not(.icon-button),
		.basemap-picker > summary {
			padding: 6px 4px;
			font-size: 12px;
			min-height: 44px;
			justify-content: center;
		}
		.map-options > button {
			flex: 1 1 0;
			min-width: 0;
		}
		.map-options .basemap-picker {
			flex: 1 1 0;
			min-width: 0;
		}
		.map-stage.editing .map-key {
			bottom: 220px;
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
		.results-bar .result strong > span {
			display: inline-block;
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
		.edit-journey > summary,
		.more-edit-options > summary {
			min-height: 44px;
		}
	}
	@media (max-width: 480px) {
		.map-options {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 380px) {
		.atlas-header {
			padding: 10px 12px;
		}
		.header-actions > button :global(svg) {
			display: none;
		}
		.edit-dock .edit-mode-button,
		.edit-dock .dock-tool {
			flex-direction: column;
		}
		.results-bar .result {
			padding: 12px 10px;
		}
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
			overflow-y: auto;
		}
		.workspace {
			flex: none;
		}
		.map-stage {
			height: 560px;
			min-height: 560px;
		}
		.atlas-header,
		.results-bar {
			flex-shrink: 0;
		}
	}

	/* Phone navigation exposes only the controls needed for the current task. */
	.mobile-menu-button,
	.mobile-results-trigger {
		display: none;
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
		grid-template-columns: 1fr;
		margin: 0 -6px 20px;
	}
	.mobile-detailed-results .result {
		border-bottom: 1px solid #e1e7df;
		padding: 16px 6px;
		min-height: 100px;
	}
	.mobile-detailed-results .result + .result::before {
		display: none;
	}
	.mobile-detailed-results .result strong {
		font-size: 30px;
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
		.atlas-header {
			flex-wrap: nowrap;
			min-height: 58px;
			height: 58px;
			padding: 7px 12px;
			gap: 10px;
			flex-shrink: 0;
		}
		.brand {
			flex: 1;
			min-width: 0;
		}
		.brand-symbol {
			width: 30px;
			height: 30px;
			flex: 0 0 30px;
		}
		.brand > span:last-child {
			font-size: 14px;
			white-space: nowrap;
		}
		.brand small {
			font-size: 10px;
		}
		.header-actions,
		.header-coverage,
		.header-location {
			display: none;
		}
		.mobile-menu-button {
			display: flex;
			align-items: center;
			justify-content: center;
			width: 44px;
			height: 44px;
			flex: 0 0 44px;
			border: 1px solid #e0e7de;
			background: #fff;
			border-radius: 12px;
			color: var(--ink);
		}
		.policy-atlas > .results-bar {
			display: none;
		}
		.mobile-results-trigger {
			display: block;
			width: 100%;
			flex-shrink: 0;
			border: 0;
			border-bottom: 1px solid #e0e8df;
			padding: 10px 12px 7px;
			background: #fffcf7;
			color: var(--ink);
			text-align: left;
			cursor: pointer;
		}
		.mobile-result-grid {
			display: grid;
			grid-template-columns: repeat(4, minmax(0, 1fr));
			gap: 7px;
		}
		.mobile-result-grid > span {
			display: grid;
			gap: 2px;
			min-width: 0;
			font-variant-numeric: tabular-nums;
		}
		.mobile-result-grid small {
			font-size: 10px;
			font-weight: 600;
			color: #637984;
			text-transform: uppercase;
			letter-spacing: 0.45px;
		}
		.mobile-result-grid strong {
			font-size: clamp(16px, 4.7vw, 20px);
			line-height: 1.2;
			font-weight: 650;
			letter-spacing: -0.6px;
		}
		.mobile-result-grid em {
			font-style: normal;
			font-size: 9px;
			line-height: 1.5;
			color: #637984;
			white-space: nowrap;
		}
		.mobile-result-grid .carbon-increase strong {
			color: #a25335;
		}
		.mobile-results-caption {
			display: flex;
			justify-content: space-between;
			align-items: center;
			gap: 6px;
			padding-top: 7px;
			font-size: 10px;
			color: #637984;
		}
		.mobile-results-caption > span:last-child {
			display: flex;
			gap: 2px;
			align-items: center;
			color: #077f7d;
		}
		.workspace {
			flex: 1;
			min-height: 0;
		}
		.map-stage {
			flex: 1;
			height: auto;
			min-height: 0;
		}
		.map-topbar,
		.priority-panel,
		.map-key,
		.tour-card {
			display: none;
		}
		.mobile-map-controls {
			position: absolute;
			z-index: 6;
			top: 12px;
			left: 12px;
			right: 12px;
			pointer-events: none;
		}
		.mobile-map-row {
			display: flex;
			align-items: stretch;
			gap: 7px;
		}
		.mobile-map-controls button {
			pointer-events: auto;
			box-shadow: 0 2px 8px rgb(27 62 73 / 8%);
		}
		.mobile-goal {
			display: flex;
			align-items: center;
			justify-content: space-between;
			flex: 1;
			min-width: 0;
			min-height: 46px;
			max-width: 220px;
			padding: 8px 12px;
			background: #fffcf7;
			border: 1px solid #d9e4d9;
			border-radius: 12px;
			text-align: left;
			color: var(--ink);
			font-size: 14px;
			font-weight: 600;
		}
		.mobile-goal small {
			display: block;
			font-size: 10px;
			margin-top: 2px;
			font-weight: 400;
			color: #637984;
		}
		.mobile-map-icon {
			display: flex;
			align-items: center;
			justify-content: center;
			flex: 0 0 44px;
			width: 44px;
			min-height: 46px;
			background: #fffcf7;
			border: 1px solid #d9e4d9;
			border-radius: 12px;
			color: var(--ink);
		}
		.mobile-areas-button {
			display: flex;
			align-items: center;
			gap: 7px;
			min-height: 44px;
			padding: 6px 10px;
			margin-top: 7px;
			border: 1px solid #d9e4d9;
			border-radius: 20px;
			background: #fffcf7;
			color: #315b68;
			font-size: 11px;
		}
		.mobile-areas-button > span {
			display: grid;
			place-items: center;
			width: 18px;
			height: 18px;
			background: #e7f1e9;
			border-radius: 50%;
			color: #077f7d;
			font-size: 10px;
		}
		.edit-dock {
			position: absolute;
			bottom: 0;
			left: 0;
			right: 0;
			transform: none;
			width: 100%;
			max-width: none;
			border-radius: 18px 18px 0 0;
			border: 0;
			border-top: 1px solid #dce6da;
			box-shadow: 0 -3px 15px rgb(27 62 73 / 7%);
			padding: 7px max(12px, env(safe-area-inset-right)) calc(7px + env(safe-area-inset-bottom));
			gap: 8px;
			min-height: 68px;
			box-sizing: border-box;
		}
		.edit-dock .edit-mode-button,
		.edit-dock .dock-tool {
			flex-direction: column;
			min-height: 54px;
			padding: 5px;
			gap: 3px;
			font-size: 11px;
			border-radius: 11px;
		}
		.edit-dock .history-buttons,
		.edit-dock .dock-divider,
		.edit-dock .live-status {
			display: none;
		}
		.edit-dock :global(.transport-graphic) {
			width: 25px !important;
			height: 25px !important;
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
			inset: auto 0 0;
			margin: 0;
			width: 100%;
			max-width: 100%;
			max-height: min(86dvh, calc(100dvh - 40px));
			border-radius: 22px 22px 0 0;
			padding-bottom: env(safe-area-inset-bottom);
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
	.build-mode-toggle {
		display: grid;
		grid-template-columns: 1fr 1fr;
		padding: 4px;
		gap: 4px;
		border-radius: 12px;
		background: #eff3ed;
		margin-bottom: 18px;
	}
	.build-mode-toggle button {
		flex: 1;
		min-height: 44px;
		border: 0;
		border-radius: 9px;
		background: transparent;
		color: #52665b;
		font-size: 14px;
		cursor: pointer;
	}
	.build-mode-toggle button[aria-pressed='true'] {
		background: #fffefa;
		color: #087f80;
		box-shadow: 0 1px 4px #263e3412;
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
	.stop-action-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		margin-bottom: 12px;
	}
	.stop-action-row button {
		min-height: 44px;
		justify-content: center;
		padding-inline: 10px;
	}
	.stop-connections {
		display: grid;
		gap: 6px;
		margin-block: 16px;
	}
	.stop-connections > span {
		font-size: 12px;
		color: #738176;
	}
	.stop-connections button {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		min-height: 44px;
		border: 1px solid #e1e7df;
		border-radius: 10px;
		padding: 10px 12px;
		background: #f7f9f3;
		color: #294d46;
		text-align: left;
		font-size: 13px;
		cursor: pointer;
	}
	.stop-connections button > span {
		min-width: 0;
	}
	.stop-connections small {
		display: block;
		margin-top: 3px;
		font-size: 11px;
		color: #738176;
	}
	.move-connection-option {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		font-size: 14px;
	}
	.move-connection-option input {
		width: 20px;
		height: 20px;
		accent-color: #087f80;
	}
	.move-headway-option {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		margin-top: 8px;
	}
	.move-headway-option input {
		width: 64px;
		min-height: 44px;
		border: 1px solid #d7e0d8;
		border-radius: 9px;
		background: #fffefa;
		text-align: center;
		font-size: 16px;
	}
	@media (max-width: 680px) and (max-height: 500px) {
		.policy-atlas {
			--mobile-sheet-top: 128px !important;
		}
		.atlas-header {
			height: 50px;
			min-height: 50px;
		}
		.brand small,
		.mobile-results-caption {
			display: none;
		}
		.mobile-results-trigger {
			padding-block: 6px;
		}
		.mobile-result-grid strong {
			font-size: 18px;
		}
		.mobile-map-controls {
			top: 8px;
		}
	}
	@media (min-width: 480px) and (max-width: 680px) and (max-height: 500px) {
		.mobile-map-controls {
			right: 52%;
		}
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
		.atlas-header,
		.results-bar,
		.mobile-results-trigger,
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
</style>
