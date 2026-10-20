<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import type { TransitionConfig } from 'svelte/transition';
	import { resizable } from '#lib/resizable.js';
	import { surfaceMotion } from '#lib/surface-motion.js';
	import { mapPanelLayout } from '#lib/map-panel-layout.js';
	import { animatedSelection, shouldAnimateMotion } from '#lib/motion.js';
	import type { BusConnectionDraft } from '#lib/bus-planning.js';
	import {
		restorePlanningBudget,
		TRANSPORT_PILOT_BUDGET,
		TRANSPORT_PILOT_BUDGET_NOTE
	} from '#lib/planning-budget.js';
	import {
		ArrowRight,
		BusFront,
		Check,
		ChevronUp,
		GraduationCap,
		Hospital,
		Layers,
		MapPin,
		MousePointer2,
		Plus,
		RefreshCw,
		Route,
		Ship,
		Signpost,
		Sparkles,
		Trash2,
		Waypoints,
		X
	} from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { api, subscribeApiInvalidation } from '#lib/api.js';
	import { capitalIslandIds, isCapitalIsland } from '#lib/capital-region.js';
	import {
		planningEvidence,
		type PlanningCoverage,
		type PopulationBasis
	} from '#lib/planning-evidence.js';
	import type { PlanningOperation } from '#lib/planning-map.js';
	import {
		displayGapHexes,
		displayComparisonHexes,
		comparisonCellProperties
	} from '#lib/display-grid.js';
	import { explainImpactCell, serviceCalendarRuns } from '#lib/proposal-experience.js';
	import { nearestPlacementRoad } from '#lib/map-placement-preview.js';
	import {
		assessDraftBudget,
		draftCosts,
		emptyFeatures,
		planningBudgetNumber as budgetNumber,
		pointWithinIsland,
		restorePlanningOperations,
		type MapBaseline,
		type MapEvaluation,
		type MapPolicyState,
		type MapServiceEditor,
		type PendingPlacementDecision,
		type PlacementKind
	} from '#lib/map-policy.js';
	import {
		formatAmount,
		operationName,
		planningFinancialKey,
		type PlanningEconomics,
		type PlanningReviewRequest
	} from '#lib/proposal-review.js';
	import type { PolicyLens, PolicyOpportunities, PolicyDomain } from '#lib/policy-opportunities.js';
	import type { Coordinates, IslandProfile, MapFeatures } from '#lib/types.js';
	import {
		canConfirmFerry,
		ferryFeatureBounds,
		ferryPlanningDate,
		ferryServiceInput,
		ferrySuggestionInput,
		type FerryConnectivity,
		type FerryDraft,
		type FerrySuggestion
	} from '#lib/ferry-planning.js';
	import type { FeatureCollection } from 'geojson';
	import ProposalCostStrip from './ProposalCostStrip.svelte';
	import ProposalForecastReview from './ProposalForecastReview.svelte';
	import TransportImpact from './TransportImpact.svelte';
	import IslandProposalImpacts from './IslandProposalImpacts.svelte';
	import IslandOverview from './IslandOverview.svelte';
	import AccessScore from './AccessScore.svelte';
	import { buildIslandOverview } from '#lib/island-overview.js';
	import { transportImpactHeadline, type TransportImpactData } from '#lib/transport-impact.js';
	import { serviceTimingSummary, transportServiceOperations } from '#lib/transport-service.js';

	type Suggestion = {
		id: string;
		title: string;
		kind: string;
		coordinates: Coordinates;
		island_id: string;
		operations: PlanningOperation[];
		capital_mvr: number;
		annual_operating_mvr: number;
		estimated_gained_residents: number | null;
		reasons: string[];
		map_features?: FeatureCollection;
	};
	type SuggestedDraft = {
		selected: Suggestion[];
		operations: PlanningOperation[];
		total_capital_mvr: number;
		total_annual_operating_mvr: number;
		estimated_gained_residents: number | null;
		warnings: string[];
		eligibility?: Record<string, unknown>;
		map_features?: FeatureCollection;
	};
	type Command = {
		id: number;
		kind:
			| 'inspect'
			| 'gaps'
			| 'compose'
			| 'close'
			| 'confirm'
			| 'cancel-placement'
			| 'cancel-service'
			| 'adjust-budget';
	} | null;
	type BudgetQuote = {
		economics: PlanningEconomics;
		transport_connectivity?: { impact?: TransportImpactData };
		budget: {
			allowed: boolean;
			reasons: string[];
			capital: { remaining_mvr: number | null };
			annual_operating?: { remaining_mvr: number | null };
		};
	};
	type LocalGapDetail = {
		gap_cells?: FeatureCollection;
		features?: FeatureCollection;
		hex_grid?: FeatureCollection;
		coverage_fill?: FeatureCollection;
		population_basis?: PopulationBasis;
		journey_population_basis?: PopulationBasis;
		coverage?: PlanningCoverage;
	};
	const preparedGapDetails = new WeakMap<
		LocalGapDetail,
		{ grid: FeatureCollection; gaps: FeatureCollection; coverageFill: FeatureCollection }
	>();
	let {
		islandId,
		islandName,
		profile = null,
		profileLoading = false,
		profileError = '',
		onRetryProfile,
		mapFeatures = null,
		boundaryFeatures = null,
		boundaryError = '',
		onRetryBoundary,
		active,
		lens = 'overall',
		command = null,
		placement = null,
		servicePlacement = null,
		serviceLanding = null,
		serviceCandidate = null,
		incomingOperation = null,
		moved = null,
		edited = null,
		cell = null,
		onLensChange,
		onState,
		onPickKind,
		onCloseOthers,
		onSeaImpact,
		onFocus,
		onFocusBounds,
		ferryDestinationId = null,
		onPickFerryDestination = () => {},
		onPickFerryOrigin = () => {},
		onDetails,
		onAdvanced,
		onConsume = () => {}
	}: {
		islandId: string | null;
		islandName: string;
		profile?: IslandProfile | null;
		profileLoading?: boolean;
		profileError?: string;
		onRetryProfile?: () => void;
		mapFeatures?: MapFeatures | null;
		boundaryFeatures?: MapFeatures | null;
		boundaryError?: string;
		onRetryBoundary?: () => void;
		active: boolean;
		lens?: PolicyLens;
		command?: Command;
		placement?: { id: number; longitude: number; latitude: number; kind?: PlacementKind } | null;
		servicePlacement?: { id: number; kind: 'bus' | 'ferry'; coordinates: Coordinates } | null;
		serviceLanding?: {
			id: number;
			terminalId: string;
			islandId?: string;
			coordinates: Coordinates;
		} | null;
		serviceCandidate?: { id: number; stopId: string } | null;
		incomingOperation?: Record<string, unknown> | null;
		moved?: { id: number; index: number; coordinates: Coordinates } | null;
		edited?: { id: number; index: number; action: 'move' | 'duplicate' | 'remove' } | null;
		cell?: Record<string, unknown> | null;
		onLensChange: (value: PolicyLens) => void;
		onState: (value: MapPolicyState) => void;
		onPickKind: (kind: PlacementKind | null) => void;
		onCloseOthers: () => void;
		onSeaImpact?: () => void;
		onFocus: (coordinates: Coordinates) => void;
		onFocusBounds?: (bounds: [Coordinates, Coordinates]) => void;
		ferryDestinationId?: string | null;
		onPickFerryDestination?: (enabled: boolean) => void;
		onPickFerryOrigin?: (destination: string, date: string) => void;
		onDetails: () => void;
		onAdvanced?: () => void;
		onConsume?: () => void;
	} = $props();
	let mounted = $state(false);
	let viewportWidth = $state(0);
	let viewportHeight = $state(0);
	const overviewMaxHeight = $derived(
		Math.max(
			180,
			viewportHeight - (viewportWidth <= 700 ? 182 : viewportWidth < 1180 ? 136 : 74) - 24
		)
	);
	let opened = $state(false);
	let section = $state<'needs' | 'proposal'>('proposal');
	let scoreDockBounds: DOMRect | null = null;
	let returningToScore = false;
	let national = $state.raw<PolicyOpportunities | null>(null);
	let baseline = $state.raw<MapBaseline | null>(null);
	let gapCells = $state.raw<FeatureCollection>(emptyFeatures());
	let coverageFill = $state.raw<FeatureCollection>(emptyFeatures());
	let displayGrid = $state.raw<FeatureCollection>(emptyFeatures());
	let capitalGapMaps = $state.raw<Record<string, FeatureCollection>>({});
	let capitalCoverageFills = $state.raw<Record<string, FeatureCollection>>({});
	let nearbyGapVersion = $state(0);
	let nearbyGapLoading = $state(false);
	let nearbyGapError = $state('');
	let loading = $state(false);
	let scopeError = $state(false);
	let scopeDirty = $state(false);
	let dataError = $state('');
	let error = $state('');
	let title = $state('');
	let operations = $state.raw<PlanningOperation[]>([]);
	let history = $state.raw<PlanningOperation[][]>([]);
	let pending = $state<{ coordinates: Coordinates; kind: PlacementKind } | null>(null);
	let armedKind = $state<PlacementKind | null>(null);
	let editingIndex = $state<number | null>(null);
	let pendingBase = $state.raw<PlanningOperation | null>(null);
	let pendingId = $state('');
	let budgetEditing = $state(false);
	let composeMode = $state<'manual' | 'budget'>('manual');
	let actionMessage = $state('');
	let consumedEdit = 0;
	let placementEvaluation = $state.raw<{ key: string; value: MapEvaluation } | null>(null);
	let previewCalculating = $state(false);
	let previewController: AbortController | undefined;
	let busOpen = $state(false);
	let serviceMode = $state<'bus' | 'ferry'>('bus');
	let serviceIntent = $state<'add' | 'improve'>('improve');
	let serviceProposalId = $state('');
	let serviceAnchor = $state<Coordinates | null>(null);
	let serviceEditorCompact = $state(false);
	let ferryOriginTerminal = $state('');
	let ferryDestinationTerminal = $state('');
	let ferryDropPoint = $state<Coordinates | null>(null);
	let consumedServicePlacement = 0,
		consumedServiceLanding = 0,
		consumedServiceCandidate = 0;
	let busStopOnly = $state(false);
	let busConnectionTarget = $state('');
	let busConnectionHeadway = $state<number | string>(20);
	let busConnectionStart = $state('06:00');
	let busConnectionEnd = $state('20:00');
	let busConnectionFleet = $state('diesel');
	let busConnectionDraft = $state.raw<{ key: string; value: BusConnectionDraft } | null>(null);
	let busConnectionChecking = $state(false);
	let busConnectionRetry = $state(0);
	let busConnectionError = $state('');
	let busConnectionController: AbortController | undefined;
	let busPatternId = $state('');
	let busHeadway = $state<number | string>(15);
	let busQuote = $state.raw<{ key: string; value: BudgetQuote } | null>(null);
	let busQuoting = $state(false);
	let busError = $state('');
	let busController: AbortController | undefined;
	let busRequestedSignature = '';
	let ferryOpen = $state(false);
	let ferryDestination = $state('');
	let ferrySearch = $state('');
	let ferryChoosingDestination = $state(false);
	let ferryHeadway = $state<number | string>(120);
	let ferryStart = $state('06:00');
	let ferryEnd = $state('20:00');
	let ferrySpeed = $state<number | string>(25);
	let ferryConnection = $state.raw<{ key: string; value: FerryConnectivity } | null>(null);
	let ferryDraft = $state.raw<{ key: string; value: FerryDraft } | null>(null);
	let ferryLoading = $state(false);
	let ferryPreviewing = $state(false);
	let ferryError = $state('');
	let ferrySuggestionResult = $state.raw<{ key: string; value: FerrySuggestion } | null>(null);
	let appliedFerrySuggestion = $state.raw<{ key: string; value: FerrySuggestion } | null>(null);
	let ferrySuggestionLoading = $state(false);
	let ferrySuggestionError = $state('');
	let ferrySuggestionRetry = $state(0);
	let overviewConnection = $state.raw<{ key: string; value: FerryConnectivity } | null>(null);
	let overviewConnectionLoading = $state(false);
	let overviewConnectionError = $state('');
	let overviewConnectionVersion = $state(0);

	let capitalBudget = $state<number | string | null | undefined>(TRANSPORT_PILOT_BUDGET.capital);
	let annualBudget = $state<number | string | null | undefined>(TRANSPORT_PILOT_BUDGET.annual);
	let goal = $state<'healthcare' | 'education' | 'transport'>('healthcare');
	const goalLabel = $derived(
		goal === 'transport'
			? 'walking access to public transport'
			: goal === 'education'
				? 'education access'
				: 'healthcare access'
	);
	let targetMinutes = $state<number | string>(30);
	let date = $state('2026-10-10');
	let departure = $state('15:20');
	let priorities = $state<PolicyDomain[]>(['transport', 'health', 'education']);
	let extraAssumptions = $state.raw<Record<string, unknown>>({});
	let suggested = $state.raw<SuggestedDraft | null>(null);
	let suggesting = $state(false);
	let checkingBudget = $state(false);
	let placementRejection = $state<{ key: string; reason: string } | null>(null);
	let placementQuote = $state.raw<{ key: string; value: BudgetQuote } | null>(null);
	let financialQuote = $state.raw<{
		key: string;
		capital: number | null;
		annual: number | null;
	} | null>(null);
	let evaluation = $state.raw<MapEvaluation | null>(null);
	let evaluationQueued = $state(false);
	let evaluating = $state(false);
	const calculating = $derived(evaluationQueued || evaluating);
	let evaluatedSignature = $state('');
	let resultTime = $state('');
	let review = $state(false);
	let impactView = $state<'current' | 'proposal'>('proposal');
	let restoredScope = $state('');
	let savedMessage = $state('');
	let restorationWarning = $state('');
	let consumedPlacement = 0,
		consumedMove = 0,
		consumedCommand = 0;
	let nationalController: AbortController | undefined;
	let scopeController: AbortController | undefined;
	let evaluateController: AbortController | undefined;
	let evaluatingSignature = '';
	let suggestionController: AbortController | undefined;
	let quoteController: AbortController | undefined;
	let placementQuoteController: AbortController | undefined;
	let ferryConnectionController: AbortController | undefined;
	let ferryDraftController: AbortController | undefined;
	let ferrySuggestionController: AbortController | undefined;
	let ferryRequestedSignature = '';
	let suggestionContext = '';
	let evaluateTimer: ReturnType<typeof setTimeout> | undefined;
	const current = $derived(national?.islands.find((row) => row.island_id === islandId));
	$effect(() => {
		if (title === 'Selected island service improvement' && current?.name)
			title = `${current.name} service improvement`;
	});
	const supported = $derived(current?.planning_supported ?? false);
	const evidence = $derived(
		planningEvidence(baseline?.population_basis ?? current?.population_basis, baseline?.coverage)
	);
	const selectedEvidence = $derived(
		planningEvidence(baseline?.population_basis ?? current?.population_basis, baseline?.coverage, {
			spatial_method: typeof cell?.spatial_method === 'string' ? cell.spatial_method : undefined,
			spatial_quality: typeof cell?.spatial_quality === 'string' ? cell.spatial_quality : undefined
		})
	);
	const localConstructionReason = $derived(
		current
			? 'This island has no supported resident allocation for local construction estimates. Existing ferry landing places can still support a proposal.'
			: 'Loading island data before placing construction…'
	);
	const scopedKey = $derived(islandId ?? '');
	const inCapitalRegion = $derived(isCapitalIsland(scopedKey));
	const costDefaults = $derived({
		...(baseline?.cost_defaults ?? {}),
		...(extraAssumptions.cost_overrides &&
		typeof extraAssumptions.cost_overrides === 'object' &&
		!Array.isArray(extraAssumptions.cost_overrides)
			? (extraAssumptions.cost_overrides as Record<string, number>)
			: {})
	});
	const request = $derived<PlanningReviewRequest>({
		island_id: islandId,
		operations,
		assumptions: {
			...extraAssumptions,
			date,
			departure_minutes: Number(departure.split(':')[0]) * 60 + Number(departure.split(':')[1]),
			target_minutes: Number(targetMinutes),
			goal,
			population_year: extraAssumptions.population_year === 2030 ? 2030 : 2026,
			capital_budget_mvr: budgetNumber(capitalBudget),
			annual_operating_budget_mvr: budgetNumber(annualBudget),
			include_origin_geometry: false,
			include_journey_geometry: false,
			include_world: false
		}
	});
	const costModelKey = $derived(planningFinancialKey(request));
	const rawCosts = $derived(draftCosts(operations, costDefaults));
	const costs = $derived(
		financialQuote?.key === costModelKey
			? financialQuote
			: requiresQuote(operations)
				? { capital: null, annual: null }
				: rawCosts
	);
	const budgetDecision = $derived(
		assessDraftBudget(costs, budgetNumber(capitalBudget), budgetNumber(annualBudget))
	);
	const signature = $derived(JSON.stringify(request));
	const ferryInput = $derived(
		ferryServiceInput(
			islandId,
			{
				destinationId: ferryDestination,
				originTerminalId: ferryOriginTerminal,
				destinationTerminalId: ferryDestinationTerminal,
				headway: ferryHeadway,
				start: ferryStart,
				end: ferryEnd,
				speed: ferrySpeed
			},
			request
		)
	);
	const ferrySignature = $derived(JSON.stringify(ferryInput.payload));
	const ferryConnectionKey = $derived(`${islandId}:${ferryDestination}:${date}`);
	const overviewConnectionKey = $derived(`${islandId}:${date}:${overviewConnectionVersion}`);
	const overviewScore = $derived(
		profile?.island.id === islandId ? buildIslandOverview(profile).score : null
	);
	const islandConnection = $derived(
		overviewConnection?.key === overviewConnectionKey ? overviewConnection.value : null
	);
	const connection = $derived(
		ferryConnection?.key === ferryConnectionKey ? ferryConnection.value : null
	);
	const ferryPreview = $derived(ferryDraft?.key === ferrySignature ? ferryDraft.value : null);
	const suggestedFerryPreview = $derived(
		appliedFerrySuggestion?.key === ferrySignature ? appliedFerrySuggestion.value : null
	);
	const ferryAllowed = $derived(
		canConfirmFerry(
			ferryPreview,
			ferryDraft?.key ?? '',
			ferrySignature,
			checkingBudget || ferryPreviewing
		) && operations.length + (ferryPreview?.operations.length ?? 0) <= 100
	);
	const ferryIslands = $derived.by(() => {
		const query = ferrySearch.trim().toLocaleLowerCase();
		return (national?.islands ?? [])
			.filter(
				(island) => island.island_id !== islandId && island.name && !/^unnamed/i.test(island.name)
			)
			.filter(
				(island) => !query || `${island.name} ${island.atoll}`.toLocaleLowerCase().includes(query)
			)
			.sort((a, b) => {
				const featured = (id: string) => (id === 'island:1442' || id === 'island:1443' ? 0 : 1);
				return featured(a.island_id) - featured(b.island_id) || a.name.localeCompare(b.name);
			})
			.slice(0, 8);
	});
	const ferryDestinationName = $derived(
		ferryDestination === 'island:1382'
			? 'Vilimalé (Vilin’gili)'
			: (national?.islands.find((island) => island.island_id === ferryDestination)?.name ??
					'Choose a destination')
	);
	const draftItems = $derived(
		operations.flatMap((operation, index) =>
			typeof operation.metadata?.ui_package === 'string' &&
			(operation.metadata.ui_package.startsWith('ferry-service:') ||
				operation.metadata.ui_package.startsWith('bus-route:')) &&
			!operation.metadata.ui_ferry_summary &&
			!operation.metadata.ui_bus_summary
				? []
				: [{ operation, index }]
		)
	);
	const suggestionSignature = $derived(JSON.stringify({ request, priorities, costs }));
	const stale = $derived(!!evaluation && evaluatedSignature !== signature);
	const roadDistance = $derived(
		pending && baseline
			? nearestPlacementRoad(pending.coordinates, baseline.graph_edges, 0).distance
			: null
	);
	const pendingWithin = $derived(
		pending && islandId ? pointWithinIsland(pending.coordinates, boundaryFeatures, islandId) : null
	);
	const placementKey = $derived(
		`${costModelKey}:${editingIndex}:${pendingId}:${JSON.stringify(pending)}`
	);
	const pendingOperation = $derived<PlanningOperation | null>(
		pending
			? {
					...pendingBase,
					type: pending.kind,
					island_id: islandId ?? undefined,
					coordinates: pending.coordinates,
					name:
						pendingBase?.name ??
						`${islandName} proposed ${placementLabel(pending.kind).toLowerCase()}`,
					metadata: { ...pendingBase?.metadata, proposal_id: pendingId }
				}
			: null
	);
	const plainPlacementOperations = $derived(
		pendingOperation
			? editingIndex === null
				? [...operations, pendingOperation]
				: operations.map((operation, index) =>
						index === editingIndex ? pendingOperation : operation
					)
			: operations
	);
	const busConnectionMode = $derived(
		!!pending &&
			pending.kind === 'add_stop' &&
			editingIndex === null &&
			!pendingBase &&
			!busStopOnly
	);
	const busConnectionInput = $derived(
		busConnectionMode && pending && islandId
			? {
					island_id: islandId,
					coordinates: pending.coordinates,
					stop_name: pendingOperation?.name ?? 'Proposed bus stop',
					...(busConnectionTarget ? { target_stop_id: busConnectionTarget } : {}),
					headway_minutes: Number(busConnectionHeadway),
					start_minutes: clockMinutes(busConnectionStart),
					end_minutes: clockMinutes(busConnectionEnd),
					speed_kph: 15,
					fleet: busConnectionFleet,
					assumptions: request.assumptions,
					operations
				}
			: null
	);
	const busConnectionKey = $derived(JSON.stringify(busConnectionInput));
	const busConnection = $derived(
		busConnectionDraft?.key === busConnectionKey ? busConnectionDraft.value : null
	);
	const connectionOperations = $derived(
		(busConnection?.operations ?? []).map((operation, index) => ({
			...operation,
			metadata: {
				...operation.metadata,
				ui_map_features: undefined,
				ui_package: `bus-route:${pendingId}`,
				ui_capital:
					index === 0 &&
					costs.capital !== null &&
					busConnection?.quote?.economics.delta.capital_mvr != null
						? busConnection.quote.economics.delta.capital_mvr - costs.capital
						: index === 0
							? undefined
							: 0,
				ui_annual:
					index === 0 &&
					costs.annual !== null &&
					busConnection?.quote?.economics.delta.annual_operating_mvr != null
						? busConnection.quote.economics.delta.annual_operating_mvr - costs.annual
						: index === 0
							? undefined
							: 0,
				...(index === 0
					? {
							ui_map_features: busConnection
								? {
										...busConnection.map_features,
										features: busConnection.map_features.features.filter(
											(feature) =>
												feature.geometry.type !== 'Point' ||
												feature.properties?.role !== 'candidate'
										)
									}
								: undefined,
							ui_bus_summary: busConnection?.summary
						}
					: {})
			}
		}))
	);
	const placementOperations = $derived(
		busConnectionMode && busConnection?.status === 'ready'
			? [...operations, ...connectionOperations]
			: plainPlacementOperations
	);
	const ferrySuggestionRequest = $derived(
		ferrySuggestionInput(
			islandId,
			pending && busConnectionMode && busConnection?.status === 'ready'
				? { ...request, operations: placementOperations }
				: request
		)
	);
	const suggestedFerryIncluded = $derived(
		islandId === 'island:1442' &&
			operations.some((operation) => operation.metadata?.ferry_suggestion)
	);
	const ferrySuggestionKey = $derived(JSON.stringify(ferrySuggestionRequest));
	const ferrySuggestion = $derived(
		ferrySuggestionResult?.key === ferrySuggestionKey ? ferrySuggestionResult.value : null
	);
	const placementEvaluationKey = $derived(
		JSON.stringify({ ...request, operations: placementOperations })
	);
	const pendingEvaluation = $derived(
		placementEvaluation?.key === placementEvaluationKey ? placementEvaluation.value : null
	);
	const quotedPlacement = $derived(
		busConnectionMode
			? (busConnection?.quote ?? null)
			: placementQuote?.key === placementKey
				? placementQuote.value
				: null
	);
	const pendingCosts = $derived(
		pending
			? draftCosts([{ type: pending.kind }], quotedPlacement?.economics.assumptions ?? costDefaults)
			: null
	);
	const budgetLimits = $derived(
		assessDraftBudget(
			{ capital: 0, annual: 0 },
			budgetNumber(capitalBudget),
			budgetNumber(annualBudget)
		)
	);
	const placementError = $derived(
		placementRejection?.key === placementKey ? placementRejection.reason : ''
	);
	const pendingDecision = $derived<PendingPlacementDecision | null>(
		pending
			? {
					label:
						pending.kind === 'add_stop'
							? 'Bus stop'
							: pending.kind === 'add_school'
								? 'School'
								: 'Hospital',
					capital: pendingCosts?.capital ?? null,
					annual: pendingCosts?.annual ?? null,
					actionLabel: editingIndex === null ? 'Add to proposal' : 'Confirm move',
					annualRemaining: quotedPlacement?.economics.budget.annual_remaining_mvr as
						number | null | undefined,
					accessPreview: {
						residents: pendingEvaluation?.summary.gained_residents ?? null,
						label: previewCalculating
							? 'Checking who gains access…'
							: pendingEvaluation
								? 'Residents gaining access · whole proposal'
								: 'Access estimate follows the cost check',
						approximate: true
					},
					allowed:
						!!baseline &&
						supported &&
						!!boundaryFeatures &&
						!loading &&
						(editingIndex !== null || operations.length < 100) &&
						pendingWithin === true &&
						budgetLimits.allowed &&
						!!quotedPlacement?.budget.allowed &&
						(!busConnectionMode ||
							(busConnection?.status === 'ready' &&
								operations.length + connectionOperations.length <= 100)) &&
						!placementError &&
						!checkingBudget,
					reason:
						loading || !baseline
							? 'Loading island costs and site details…'
							: !supported
								? localConstructionReason
								: !boundaryFeatures
									? boundaryError || 'Loading the detailed island boundary…'
									: editingIndex === null && operations.length >= 100
										? 'This proposal has reached the 100-change limit.'
										: pendingWithin === false
											? `Move this pin onto ${islandName}. Water and other islands cannot be used.`
											: pendingWithin === null
												? 'The island boundary could not verify this site. Reload map details before confirming.'
												: !budgetLimits.allowed
													? budgetLimits.reason
													: placementError || quotedPlacement?.budget.reasons.join(' '),
					remaining: quotedPlacement?.budget.capital.remaining_mvr,
					note:
						pending.kind === 'add_stop' && busStopOnly
							? 'Stop only: no access gain until a connected bus service is added.'
							: roadDistance !== null
								? roadDistance <= 35
									? 'Beside a street. Review the access estimate before confirming.'
									: roadDistance <= 100
										? `${Math.round(roadDistance)} m from a street; within the model’s connection range.`
										: 'More than 100 m from a street. This site may have no modeled access.'
								: pendingWithin === null
									? 'Land boundary unavailable; verify this site before proceeding.'
									: undefined,
					checking:
						loading ||
						(!boundaryFeatures && !boundaryError) ||
						checkingBudget ||
						(supported &&
							!quotedPlacement &&
							!placementError &&
							budgetLimits.allowed &&
							pendingWithin !== false)
				}
			: null
	);
	const displayOperations = $derived(
		restoredScope !== scopedKey
			? []
			: suggested
				? [
						...operations,
						...suggested.operations.map((operation) => ({
							...operation,
							metadata: { ...operation.metadata, ui_preview: true }
						}))
					]
				: operations
	);
	const nationalScreening = $derived.by(() => {
		const byId = new Map(national?.islands.map((island) => [island.island_id, island]));
		return {
			type: 'FeatureCollection' as const,
			features: (mapFeatures?.features ?? []).flatMap((feature) => {
				const island = byId.get(String(feature.properties?.id));
				if (!island || !feature.geometry) return [];
				return [
					{
						type: 'Feature' as const,
						geometry: feature.geometry,
						properties: {
							island_id: island.island_id,
							name: island.name,
							overall_gap: island.priority_score === null ? null : island.priority_score / 100,
							...Object.fromEntries(
								(['transport', 'health', 'education'] as const).map((domain) => [
									`${domain}_gap`,
									island.domains[domain].score === null
										? null
										: Number((1 - island.domains[domain].score! / 100).toFixed(4))
								])
							),
							status: Object.values(island.domains).some((domain) => domain.status === 'review')
								? 'review'
								: Object.values(island.domains).every((domain) => domain.status === 'unknown')
									? 'unknown'
									: 'stronger_evidence'
						}
					}
				];
			})
		};
	});
	const mapGaps = $derived.by((): FeatureCollection => {
		if (!islandId) return nationalScreening;
		// A local journey map must not mix routed neighbourhood evidence with the
		// island-level availability screening index. Unanalysed islands stay neutral.
		return {
			type: 'FeatureCollection',
			features: capitalIslandIds.includes(islandId)
				? capitalIslandIds.flatMap((id) => capitalGapMaps[id]?.features ?? [])
				: restoredScope === scopedKey
					? gapCells.features
					: []
		};
	});
	const mapCoverageFill = $derived.by((): FeatureCollection => {
		if (!islandId) return emptyFeatures();
		return {
			type: 'FeatureCollection',
			features: capitalIslandIds.includes(islandId)
				? capitalIslandIds.flatMap((id) => capitalCoverageFills[id]?.features ?? [])
				: restoredScope === scopedKey
					? coverageFill.features
					: []
		};
	});
	const serviceFeatures = $derived({
		type: 'FeatureCollection' as const,
		features:
			restoredScope !== scopedKey
				? []
				: [
						...operations.flatMap((operation) =>
							(
								(operation.metadata?.ui_map_features as FeatureCollection | undefined)?.features ??
								[]
							).map((feature) => {
								const summary = (operation.metadata?.ui_ferry_summary ??
									operation.metadata?.ui_bus_summary) as Record<string, unknown> | undefined;
								return {
									...feature,
									properties: {
										...feature.properties,
										accepted: true,
										route_name: summary?.name ?? operation.name,
										headway_minutes: summary?.headway_minutes ?? operation.headway_minutes,
										service_date: summary?.service_date ?? request.assumptions.date,
										travel_minutes: summary?.travel_minutes ?? summary?.crossing_minutes,
										origin_name: (summary?.origin_terminal as { name?: string } | undefined)?.name,
										destination_name:
											(summary?.destination_terminal as { name?: string } | undefined)?.name ??
											(summary?.target_stop as { name?: string } | undefined)?.name
									}
								};
							})
						),
						...(suggested?.selected.flatMap((item) => item.map_features?.features ?? []) ?? []),
						...(busOpen ? busMapFeatures().features : []),
						...(busConnectionMode
							? (busConnection?.map_features.features ?? []).map((feature) => ({
									...feature,
									properties: {
										...feature.properties,
										...(feature.geometry.type === 'Point' && feature.properties?.role !== 'origin'
											? {
													kind: 'bus_connection_candidate',
													stop_id: feature.properties?.stop_id ?? feature.properties?.id
												}
											: {})
									}
								}))
							: []),
						...(ferryOpen
							? [
									...(ferryPreview?.map_features?.features ?? []),
									...ferryLandingFeatures().features
								]
							: [])
					]
	});
	const comparisonPreview = $derived(!!pendingEvaluation && !!pendingDecision?.allowed);
	const comparisonEvaluation = $derived(comparisonPreview ? pendingEvaluation : evaluation);
	const comparisonAssumptions = $derived(
		comparisonEvaluation?.assumptions as Record<string, unknown> | undefined
	);
	const comparisonTarget = $derived(Number(comparisonAssumptions?.target_minutes ?? targetMinutes));
	const comparisonUnchanged = $derived(
		!!comparisonEvaluation?.origins.length &&
			comparisonEvaluation.origins.every(
				(row) =>
					row.before.status === row.after.status &&
					(row.before.minutes === row.after.minutes ||
						(row.before.minutes !== null &&
							row.after.minutes !== null &&
							Math.abs(row.before.minutes - row.after.minutes) < 0.001))
			)
	);
	const comparisonHasJourneys = $derived(
		comparisonEvaluation?.origins.some(
			(row) => row.before.status === 'reachable' && row.after.status === 'reachable'
		) ?? false
	);
	const comparisonGoalLabel = $derived(
		comparisonAssumptions?.goal === 'transport'
			? 'walking access to public transport'
			: comparisonAssumptions?.goal === 'education'
				? 'education access'
				: 'healthcare access'
	);
	// Keep the last valid geometry while a change recalculates. Switching the view
	// changes only the map paint; it never re-bins residents or reloads GeoJSON.
	const comparisonHexes = $derived(
		comparisonEvaluation && displayGrid.features.length
			? displayComparisonHexes(
					baseline?.origins ?? [],
					comparisonEvaluation.origins ?? [],
					displayGrid,
					comparisonTarget
				)
			: emptyFeatures()
	);
	const impact = $derived(
		restoredScope === scopedKey && (operations.length || comparisonPreview)
			? comparisonHexes
			: emptyFeatures()
	);
	const selectedImpactCell = $derived.by(() => {
		const properties = impact.features.find(
			(feature) => String(feature.properties?.id) === String(cell?.id)
		)?.properties;
		return properties
			? comparisonCellProperties(properties, impactView === 'current' ? 'before' : 'after')
			: null;
	});
	const selectedExplanation = $derived(
		selectedImpactCell
			? explainImpactCell(selectedImpactCell, {
					goalLabel: comparisonGoalLabel,
					targetMinutes: comparisonTarget,
					operations: comparisonPreview ? placementOperations : operations
				})
			: null
	);
	const busPatterns = $derived(
		(baseline?.patterns ?? []).filter((pattern) => pattern.mode === 'bus')
	);
	const ferryPatterns = $derived(
		(baseline?.patterns ?? []).filter((pattern) => pattern.mode === 'ferry')
	);
	const servicePatterns = $derived(serviceMode === 'bus' ? busPatterns : ferryPatterns);
	const serviceTitle = $derived(
		serviceIntent === 'add' ? 'Add bus' : `Improve ${serviceMode} line`
	);
	const busPattern = $derived(servicePatterns.find((pattern) => pattern.id === busPatternId));
	const serviceTiming = $derived(
		busOpen && busPattern ? serviceTimingSummary(busPattern, date) : null
	);
	const busPatternActive = $derived(serviceCalendarRuns(busPattern?.calendar, date));
	const busRecordedDate = $derived(
		busPattern?.calendar?.includedDates
			?.filter((recorded) => serviceCalendarRuns(busPattern?.calendar, recorded))
			.sort()[0] ?? null
	);
	const busSignature = $derived(
		JSON.stringify({
			request,
			busPatternId,
			busHeadway,
			serviceMode,
			serviceIntent,
			serviceProposalId
		})
	);
	const serviceChange = $derived(
		busOpen
			? transportServiceOperations({
					pattern: busPattern,
					intent: serviceIntent,
					headway: Number(busHeadway),
					date,
					proposalId: serviceProposalId,
					islandId: islandId ?? undefined,
					operations,
					mapFeatures: busMapFeatures()
				})
			: { operations: null, error: null, addedDepartures: 0 }
	);
	const busPreview = $derived(busQuote?.key === busSignature ? busQuote.value : null);
	const visibleTransportImpact = $derived(
		pending
			? (pendingEvaluation?.transport_connectivity?.impact ??
					quotedPlacement?.transport_connectivity?.impact)
			: ferryOpen
				? ferryPreview?.quote?.transport_connectivity?.impact
				: busOpen
					? busPreview?.transport_connectivity?.impact
					: operations.length
						? evaluation?.transport_connectivity?.impact
						: undefined
	);
	const transportBenefitHeadline = $derived(transportImpactHeadline(visibleTransportImpact));
	const previewEconomics = $derived(
		(busConnectionMode ? busConnection?.quote?.economics : quotedPlacement?.economics) ??
			(ferryOpen ? ferryPreview?.quote?.economics : null) ??
			(busOpen ? busPreview?.economics : null)
	);
	const hasDraftContext = $derived(
		!!(draftItems.length || pending || armedKind || actionMessage || ferryOpen || busOpen)
	);
	const draftEconomics = $derived<PlanningEconomics>({
		currency: 'MVR',
		basis: 'Editable MVR planning allowances. Running costs require a service plan.',
		before: {},
		after: {},
		delta: { capital_mvr: costs.capital, annual_operating_mvr: costs.annual },
		budget: {},
		assumptions: costDefaults,
		cost_basis: baseline?.cost_basis,
		warnings: []
	});
	const visibleEconomics = $derived(
		previewEconomics ?? (evaluation && !stale ? evaluation.economics : draftEconomics)
	);

	const serviceEditor = $derived<MapServiceEditor | null>(
		active && restoredScope === scopedKey
			? busConnectionMode && pending
				? {
						id: pendingId,
						coordinates: pending.coordinates,
						mode: 'bus-connection',
						title: 'Connect a new bus stop'
					}
				: ferryOpen && serviceAnchor
					? {
							id: 'ferry-service',
							coordinates: serviceAnchor,
							mode: 'ferry',
							title: 'Plan a ferry service'
						}
					: busOpen && serviceAnchor
						? {
								id: 'bus-service',
								coordinates: serviceAnchor,
								mode: serviceMode,
								title: serviceTitle
							}
						: null
			: null
	);
	function clockMinutes(value: string) {
		const [hours, minutes] = value.split(':').map(Number);
		return hours * 60 + minutes;
	}
	function ferryLandingFeatures(): FeatureCollection {
		return {
			type: 'FeatureCollection',
			features: [
				...(connection?.terminals.origin ?? []),
				...(connection?.terminals.destination ?? [])
			].map((terminal) => ({
				type: 'Feature',
				geometry: { type: 'Point', coordinates: terminal.coordinates },
				properties: {
					kind: 'ferry_landing',
					mode: 'ferry',
					terminal_id: terminal.id,
					island_id: terminal.island_id,
					name: terminal.name,
					role:
						terminal.id === ferryOriginTerminal
							? 'origin'
							: terminal.id === ferryDestinationTerminal
								? 'destination'
								: 'candidate'
				}
			}))
		};
	}
	function routeAnchor(): Coordinates | null {
		const stop = baseline?.stops?.find((item) => busPattern?.stopIds.includes(item.id));
		return stop ? [stop.lon, stop.lat] : (current?.coordinates ?? null);
	}
	function serviceDrag(event: DragEvent, kind: 'bus' | 'ferry') {
		if (!event.dataTransfer) return;
		event.dataTransfer.setData('application/x-policy-service', kind);
		event.dataTransfer.effectAllowed = 'copy';
		const icon =
			event.currentTarget instanceof HTMLElement
				? event.currentTarget.querySelector('[data-service-icon]')
				: null;
		if (icon) event.dataTransfer.setDragImage(icon, 22, 22);
	}
	$effect(() => {
		if (!active || !servicePlacement || servicePlacement.id === consumedServicePlacement) return;
		untrack(() => {
			consumedServicePlacement = servicePlacement!.id;
			if (servicePlacement!.kind === 'ferry') beginFerry(servicePlacement!.coordinates);
			else beginBusService(servicePlacement!.coordinates, 'add');
		});
	});
	$effect(() => {
		if (!active || !serviceLanding || serviceLanding.id === consumedServiceLanding || !ferryOpen)
			return;
		untrack(() => {
			const landing = serviceLanding!;
			consumedServiceLanding = landing.id;
			if (landing.islandId === islandId) {
				ferryOriginTerminal = landing.terminalId;
				serviceAnchor = landing.coordinates;
				onFocus(landing.coordinates);
			} else if (landing.islandId === ferryDestination)
				ferryDestinationTerminal = landing.terminalId;
		});
	});
	$effect(() => {
		if (
			!active ||
			!serviceCandidate ||
			serviceCandidate.id === consumedServiceCandidate ||
			!busConnectionMode
		)
			return;
		untrack(() => {
			consumedServiceCandidate = serviceCandidate!.id;
			busConnectionTarget = serviceCandidate!.stopId;
		});
	});
	$effect(() => {
		const payload = busConnectionInput,
			key = busConnectionKey;
		void busConnectionRetry;
		if (payload && payload.operations.length > 97) {
			untrack(() => {
				busConnectionChecking = false;
				busConnectionError =
					'A connected stop needs room for three changes. Remove another change, or choose Add only a stop.';
			});
			return;
		}
		if (
			!mounted ||
			!active ||
			!payload ||
			!supported ||
			loading ||
			pendingWithin !== true ||
			!budgetLimits.allowed
		)
			return;
		const controller = new AbortController();
		busConnectionController = controller;
		untrack(() => {
			busConnectionChecking = true;
			busConnectionError = '';
		});
		const timer = setTimeout(async () => {
			try {
				const value = await api<BusConnectionDraft>(
					'planning/bus-connection',
					payload,
					controller.signal
				);
				if (!controller.signal.aborted && key === busConnectionKey)
					busConnectionDraft = { key, value };
			} catch (cause) {
				if (!controller.signal.aborted)
					busConnectionError =
						cause instanceof Error ? cause.message : 'The bus connection could not be checked.';
			} finally {
				if (busConnectionController === controller) busConnectionChecking = false;
			}
		}, 220);
		return () => {
			clearTimeout(timer);
			controller.abort();
			untrack(() => {
				busConnectionChecking = false;
			});
		};
	});
	$effect(() => {
		const key = busSignature;
		if (!active || !busOpen || !busPatternActive || !budgetLimits.allowed) return;
		const timer = setTimeout(() => {
			if (key === busSignature) untrack(() => void previewBusService());
		}, 300);
		return () => {
			clearTimeout(timer);
			untrack(() => {
				if (busRequestedSignature === key) {
					busController?.abort();
					busQuoting = false;
				}
			});
		};
	});
	$effect(() => {
		const key = ferrySuggestionKey;
		const input = ferrySuggestionRequest;
		void ferrySuggestionRetry;
		if (!mounted || !active || !baseline || restoredScope !== scopedKey || !input) return;
		if (input.assumptions.goal !== 'transport' && !ferryOpen) return;
		if (ferrySuggestionResult?.key === key) return;
		// Start with the previewed bus package so accepting it can retain the warmed result.
		const controller = new AbortController();
		ferrySuggestionController = controller;
		const timer = setTimeout(() => {
			untrack(() => {
				ferrySuggestionLoading = true;
				ferrySuggestionError = '';
			});
			void api<FerrySuggestion>('planning/ferry-suggestion', input, controller.signal)
				.then((value) => {
					if (!controller.signal.aborted && key === ferrySuggestionKey)
						ferrySuggestionResult = { key, value };
				})
				.catch((cause) => {
					if (!controller.signal.aborted)
						ferrySuggestionError =
							cause instanceof Error ? cause.message : 'The suggested connection is unavailable.';
				})
				.finally(() => {
					if (ferrySuggestionController === controller) ferrySuggestionLoading = false;
				});
		}, 450);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});
	$effect(() => {
		const key = ferrySignature;
		if (
			!active ||
			!ferryOpen ||
			!ferryInput.payload ||
			ferryLoading ||
			!connection ||
			!budgetLimits.allowed
		)
			return;
		const timer = setTimeout(() => {
			if (key === ferrySignature) untrack(() => void previewFerry());
		}, 350);
		return () => clearTimeout(timer);
	});

	onMount(() => {
		mounted = true;
		const unsubscribe = subscribeApiInvalidation(() => {
			// Retained map views must replace source-backed evidence after reviewed data changes.
			// The accepted proposal and its limits stay intact; only previews are discarded.
			scopeDirty = true;
			clearTimeout(evaluateTimer);
			nationalController?.abort();
			nationalController = undefined;
			national = null;
			scopeController?.abort();
			evaluateController?.abort();
			placementQuoteController?.abort();
			cancelPending();
			closeBusService();
			closeFerry();
			ferrySuggestionController?.abort();
			ferrySuggestionResult = null;
			appliedFerrySuggestion = null;
			ferrySuggestionRetry += 1;
			cancelSuggestions();
			baseline = null;
			gapCells = emptyFeatures();
			coverageFill = emptyFeatures();
			displayGrid = emptyFeatures();
			capitalGapMaps = {};
			capitalCoverageFills = {};
			nearbyGapVersion += 1;
			overviewConnection = null;
			overviewConnectionVersion += 1;
			nearbyGapError = '';
			evaluation = null;
			resultTime = '';
			financialQuote = null;
			evaluatedSignature = '';
			evaluationQueued = false;
			evaluating = false;
			loading = false;
		});
		return () => {
			unsubscribe();
			clearTimeout(evaluateTimer);
			nationalController?.abort();
			scopeController?.abort();
			evaluateController?.abort();
			suggestionController?.abort();
			quoteController?.abort();
			placementQuoteController?.abort();
			previewController?.abort();
			busController?.abort();
			ferryConnectionController?.abort();
			ferryDraftController?.abort();
			ferrySuggestionController?.abort();
		};
	});
	$effect(() => {
		void scopeDirty;
		if (!mounted || !active || national || nationalController) return;
		untrack(() => void loadNational());
	});
	async function loadNational() {
		nationalController?.abort();
		const controller = new AbortController();
		nationalController = controller;
		dataError = '';
		try {
			const value = await api<PolicyOpportunities>(
				'planning/opportunities?include_geometry=false',
				undefined,
				controller.signal
			);
			if (!controller.signal.aborted && nationalController === controller) national = value;
		} catch (cause) {
			if (!controller.signal.aborted && nationalController === controller)
				dataError = cause instanceof Error ? cause.message : 'National evidence could not load.';
		}
	}
	$effect(() => {
		const capital = inCapitalRegion;
		void nearbyGapVersion;
		const scopes = untrack(() => capitalIslandIds.filter((id) => !capitalGapMaps[id]));
		if (!mounted || !active || !capital || !scopes.length) {
			untrack(() => {
				nearbyGapLoading = false;
				nearbyGapError = '';
			});
			return;
		}
		const controller = new AbortController();
		untrack(() => {
			nearbyGapLoading = true;
			nearbyGapError = '';
		});
		// Warm both map evidence and planning baselines together. The API shares the
		// selected island's in-flight reads and retains each result in its normal cache.
		// Depending on the region, rather than the selected ID, keeps sibling loads alive
		// when moving between regional siblings. Empty airport evidence is ready too.
		void Promise.allSettled(scopes.map((scope) => loadIslandEvidence(scope, controller.signal)))
			.then((results) => {
				if (controller.signal.aborted) return;
				const failed = results.flatMap((result, index) =>
					result.status === 'rejected'
						? [
								scopes[index] === 'island:1442'
									? 'Hulhumalé'
									: scopes[index] === 'island:1443'
										? 'Malé'
										: 'Hulhulé'
							]
						: []
				);
				if (failed.length) nearbyGapError = `${failed.join(', ')} could not finish loading.`;
			})
			.finally(() => {
				if (!controller.signal.aborted) nearbyGapLoading = false;
			});
		return () => {
			controller.abort();
			untrack(() => {
				nearbyGapLoading = false;
			});
		};
	});
	async function loadIslandEvidence(scope: string, signal: AbortSignal) {
		const [detail, data] = await Promise.all([
			api<LocalGapDetail>(`planning/opportunities/${encodeURIComponent(scope)}`, undefined, signal),
			api<MapBaseline>(
				`planning/baseline?island_id=${encodeURIComponent(scope)}`,
				undefined,
				signal
			)
		]);
		signal.throwIfAborted();
		let prepared = preparedGapDetails.get(detail);
		if (!prepared) {
			const grid = detail.hex_grid ?? emptyFeatures();
			const source = detail.gap_cells ?? detail.features ?? emptyFeatures();
			prepared = {
				grid,
				gaps: grid.features.length ? displayGapHexes(source, grid) : emptyFeatures(),
				// Colour interpolation is presentation only; keep it out of resident and proposal metrics.
				coverageFill: detail.coverage_fill ?? emptyFeatures()
			};
			preparedGapDetails.set(detail, prepared);
		}
		if (capitalIslandIds.includes(scope) && capitalGapMaps[scope] !== prepared.gaps)
			capitalGapMaps = { ...capitalGapMaps, [scope]: prepared.gaps };
		if (capitalIslandIds.includes(scope) && capitalCoverageFills[scope] !== prepared.coverageFill)
			capitalCoverageFills = { ...capitalCoverageFills, [scope]: prepared.coverageFill };
		return {
			...prepared,
			baseline: {
				...data,
				population_basis:
					detail.journey_population_basis ?? data.population_basis ?? detail.population_basis,
				coverage: detail.coverage ?? data.coverage
			}
		};
	}
	$effect(() => {
		const scope = scopedKey;
		if (!mounted || !scope || !active || (restoredScope === scope && !scopeDirty)) return;
		untrack(() => {
			scopeDirty = false;
			void loadScope(scope);
		});
	});
	async function loadScope(scope: string, restore = restoredScope !== scope) {
		scopeController?.abort();
		evaluateController?.abort();
		quoteController?.abort();
		checkingBudget = false;
		clearTimeout(evaluateTimer);
		cancelSuggestions();
		const controller = new AbortController();
		scopeController = controller;
		loading = true;
		scopeError = false;
		baseline = null;
		pending = null;
		armedKind = null;
		editingIndex = null;
		pendingBase = null;
		budgetEditing = false;
		composeMode = 'manual';
		actionMessage = '';
		placementEvaluation = null;
		previewController?.abort();
		closeBusService();
		evaluation = null;
		resultTime = '';
		evaluatedSignature = '';
		error = '';
		evaluationQueued = false;
		evaluating = false;
		review = false;
		closeFerry();
		onPickKind(null);
		if (restore) {
			restorationWarning = '';
			ferryDestination = '';
			ferrySearch = '';
			ferryConnection = null;
			gapCells = emptyFeatures();
			coverageFill = emptyFeatures();
			displayGrid = emptyFeatures();
			operations = [];
			history = [];
			title = `${islandName} service improvement`;
			capitalBudget = TRANSPORT_PILOT_BUDGET.capital;
			annualBudget = TRANSPORT_PILOT_BUDGET.annual;
			goal = 'healthcare';
			targetMinutes = 30;
			date = '2026-10-10';
			departure = '15:20';
			priorities = ['transport', 'health', 'education'];
			extraAssumptions = {};
			savedMessage = '';
			restoredScope = scope;
			try {
				const saved =
					localStorage.getItem(`policy-map-v2:${scope}`) ??
					localStorage.getItem(`policy-workbench-v1:${scope}`);
				if (saved) {
					const draft = JSON.parse(saved);
					const assumptions =
						draft.assumptions &&
						typeof draft.assumptions === 'object' &&
						!Array.isArray(draft.assumptions)
							? (draft.assumptions as Record<string, unknown>)
							: {};
					extraAssumptions = assumptions;
					const restored = restorePlanningOperations(draft.operations);
					operations = restored.operations;
					if (restored.discarded)
						restorationWarning = `${restored.discarded} saved change${restored.discarded === 1 ? '' : 's'} could not be restored. Review the remaining draft before continuing.`;
					if (typeof draft.title === 'string') title = draft.title;
					const budget = restorePlanningBudget(
						assumptions.capital_budget_mvr ?? draft.capitalBudget,
						assumptions.annual_operating_budget_mvr ?? draft.annualBudget
					);
					capitalBudget = budget.capital;
					annualBudget = budget.annual;
					const savedGoal = assumptions.goal ?? draft.goal;
					if (savedGoal === 'healthcare' || savedGoal === 'education' || savedGoal === 'transport')
						goal = savedGoal;
					const savedDate = ferryPlanningDate(assumptions.date);
					if (savedDate) date = savedDate;
					if (
						typeof assumptions.target_minutes === 'number' &&
						assumptions.target_minutes > 0 &&
						assumptions.target_minutes <= 180
					)
						targetMinutes = assumptions.target_minutes;
					const minutes = assumptions.departure_minutes;
					if (
						typeof minutes === 'number' &&
						Number.isInteger(minutes) &&
						minutes >= 0 &&
						minutes < 1440
					)
						departure = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
					if (Array.isArray(draft.priorities))
						priorities = [
							...new Set<PolicyDomain>(
								draft.priorities.filter(
									(value: unknown): value is PolicyDomain =>
										value === 'transport' || value === 'health' || value === 'education'
								)
							)
						];
				}
			} catch {
				savedMessage = 'Saved draft could not be read. Start a new draft here.';
			}
		}
		try {
			const evidence = await loadIslandEvidence(scope, controller.signal);
			if (controller.signal.aborted) return;
			displayGrid = evidence.grid;
			gapCells = evidence.gaps;
			coverageFill = evidence.coverageFill;
			baseline = evidence.baseline;
		} catch (cause) {
			if (!controller.signal.aborted) {
				scopeError = true;
				error = cause instanceof Error ? cause.message : 'Island evidence could not load.';
			}
		} finally {
			if (!controller.signal.aborted) loading = false;
		}
	}
	function retryScope() {
		if (scopedKey) void loadScope(scopedKey, false);
	}
	$effect(() => {
		if (!mounted || restoredScope !== scopedKey || !scopedKey) return;
		const draft = JSON.stringify({
			title,
			operations,
			assumptions: request.assumptions,
			priorities
		});
		const scope = scopedKey;
		untrack(() => {
			try {
				localStorage.setItem(`policy-map-v2:${scope}`, draft);
				savedMessage = 'Draft saved on this device';
			} catch {
				savedMessage = 'Device storage is full. Keep this page open and export your review.';
			}
		});
	});
	$effect(() => {
		if (!command || command.id === consumedCommand || (!active && command.kind !== 'close')) return;
		untrack(() => {
			consumedCommand = command!.id;
			if (command!.kind === 'confirm') {
				confirm();
				return;
			}
			if (command!.kind === 'cancel-service') {
				closeFerry();
				closeBusService();
				cancelPending();
				return;
			}
			if (command!.kind === 'cancel-placement') {
				cancelPending();
				return;
			}
			if (command!.kind === 'adjust-budget') {
				adjustBudget();
				return;
			}
			if (!opened && command!.kind !== 'close') rememberScoreDock();
			opened = command!.kind !== 'close';
			if (opened) {
				section =
					command!.kind === 'inspect'
						? 'needs'
						: command!.kind === 'compose' || !cell
							? 'proposal'
							: 'needs';
				onCloseOthers();
			} else close();
		});
	});
	$effect(() => {
		if (!active || !placement || placement.id === consumedPlacement) return;
		untrack(() => {
			consumedPlacement = placement!.id;
			if (!supported) {
				error = localConstructionReason;
				onPickKind(null);
				return;
			}
			closeFerry();
			closeBusService();
			serviceEditorCompact = false;
			busStopOnly = false;
			busConnectionTarget = '';
			busConnectionDraft = null;
			quoteController?.abort();
			checkingBudget = false;
			const nextKind = placement!.kind ?? armedKind ?? 'add_school';
			const newPlacement = !pending || pending.kind !== nextKind;
			pending = {
				coordinates: placementCoordinates([placement!.longitude, placement!.latitude], nextKind),
				kind: nextKind
			};
			if (!pendingId) pendingId = `proposal:${pending.kind}:${crypto.randomUUID()}`;
			if (newPlacement)
				setGoal(
					pending.kind === 'add_stop'
						? 'transport'
						: pending.kind === 'add_school'
							? 'education'
							: 'healthcare'
				);
			impactView = 'proposal';
			armedKind = null;
			budgetEditing = false;
			suggested = null;
			opened = false;
			section = 'proposal';
			onPickKind(null);
			onCloseOthers();
		});
	});
	$effect(() => {
		if (!edited || edited.id === consumedEdit || !active) return;
		untrack(() => {
			consumedEdit = edited!.id;
			editOperation(edited!.index, edited!.action);
		});
	});
	$effect(() => {
		if (!active || !incomingOperation) return;
		if (!baseline || loading || restoredScope !== scopedKey) return;
		const incoming = incomingOperation;
		if (incoming.type === 'compose_ferry_service') {
			untrack(() => {
				const serviceDate = ferryPlanningDate(incoming.service_date);
				if (serviceDate) date = serviceDate;
				beginFerry();
				if (typeof incoming.destination_island_id === 'string')
					chooseFerryDestination(incoming.destination_island_id);
				onConsume();
			});
			return;
		}
		untrack(() => {
			if (typeof incoming.type !== 'string') {
				error = 'This notice does not contain a supported planning change.';
				onConsume();
				return;
			}
			const operation = incoming as PlanningOperation;
			const noticeId = operation.metadata?.notice_id;
			const existing = noticeId
				? operations.findIndex((item) => item.metadata?.notice_id === noticeId)
				: -1;
			if (existing < 0 && operations.length >= 100)
				error = 'Remove a change before adding this notice to the draft.';
			else {
				change(
					existing >= 0
						? operations.map((item, i) => (i === existing ? operation : item))
						: [...operations, operation]
				);
				open('proposal');
			}
			onConsume();
		});
	});
	$effect(() => {
		if (!ferryOpen || !ferryDestinationId || ferryDestinationId === islandId) return;
		untrack(() => chooseFerryDestination(ferryDestinationId!));
	});
	$effect(() => {
		const key = overviewConnectionKey;
		const origin = islandId;
		const serviceDate = date;
		untrack(() => {
			overviewConnectionLoading = false;
			overviewConnectionError = '';
		});
		if (!mounted || !active || !opened || section !== 'needs' || !origin) return;
		if (untrack(() => overviewConnection?.key === key)) return;
		const controller = new AbortController();
		untrack(() => (overviewConnectionLoading = true));
		void api<FerryConnectivity>(
			`planning/connectivity?${new URLSearchParams({ origin_island_id: origin, date: serviceDate })}`,
			undefined,
			controller.signal
		)
			.then((value) => {
				if (!controller.signal.aborted) overviewConnection = { key, value };
			})
			.catch(() => {
				if (!controller.signal.aborted)
					overviewConnectionError = 'Connection evidence could not load.';
			})
			.finally(() => {
				if (!controller.signal.aborted) overviewConnectionLoading = false;
			});
		return () => controller.abort();
	});
	$effect(() => {
		const key = ferryConnectionKey;
		const origin = islandId;
		const destination = ferryDestination;
		const serviceDate = date;
		if (!mounted || !active || !ferryOpen || !origin) return;
		const controller = new AbortController();
		ferryConnectionController = controller;
		untrack(() => {
			ferryLoading = true;
			ferryError = '';
		});
		void api<FerryConnectivity>(
			`planning/connectivity?${new URLSearchParams({ origin_island_id: origin, ...(destination ? { destination_island_id: destination } : {}), date: serviceDate })}`,
			undefined,
			controller.signal
		)
			.then((value) => {
				if (!controller.signal.aborted && ferryConnectionKey === key) {
					ferryConnection = { key, value };
					const terminals = value.terminals.origin;
					if (!terminals.some((item) => item.id === ferryOriginTerminal)) {
						const near = ferryDropPoint ?? current?.coordinates;
						const selected = near
							? [...terminals].sort(
									(a, b) =>
										Math.hypot(a.coordinates[0] - near[0], a.coordinates[1] - near[1]) -
										Math.hypot(b.coordinates[0] - near[0], b.coordinates[1] - near[1])
								)[0]
							: terminals[0];
						ferryOriginTerminal = selected?.id ?? '';
						if (selected) {
							serviceAnchor = selected.coordinates;
							onFocus(selected.coordinates);
						}
					}
					if (!value.terminals.destination.some((item) => item.id === ferryDestinationTerminal))
						ferryDestinationTerminal = value.terminals.destination[0]?.id ?? '';
					if (destination)
						focusFerryFeatures({
							type: 'FeatureCollection',
							features: [...value.terminals.origin, ...value.terminals.destination].map(
								(terminal) => ({
									type: 'Feature',
									geometry: { type: 'Point', coordinates: terminal.coordinates },
									properties: {}
								})
							)
						});
				}
			})
			.catch((cause) => {
				if (!controller.signal.aborted)
					ferryError =
						cause instanceof Error ? cause.message : 'The island connection could not be checked.';
			})
			.finally(() => {
				if (ferryConnectionController === controller) ferryLoading = false;
			});
		return () => controller.abort();
	});
	$effect(() => {
		const currentSignature = ferrySignature;
		untrack(() => {
			if (ferryRequestedSignature && ferryRequestedSignature !== currentSignature) {
				ferryDraftController?.abort();
				ferryPreviewing = false;
				ferryError = '';
			}
		});
	});
	$effect(() => {
		const currentSignature = busSignature;
		untrack(() => {
			if (busRequestedSignature && busRequestedSignature !== currentSignature) {
				busController?.abort();
				busQuoting = false;
				busError = '';
			}
		});
	});
	$effect(() => {
		if (!moved || moved.id === consumedMove) return;
		untrack(() => {
			consumedMove = moved!.id;
			if (islandId && pointWithinIsland(moved!.coordinates, boundaryFeatures, islandId) === false) {
				error =
					'Choose a site inside the selected island. Water and other islands cannot be used for this proposal.';
				operations = [...operations];
				if (pending) pending = { ...pending };
				return;
			}
			if (moved!.index === -1 && pending) {
				quoteController?.abort();
				checkingBudget = false;
				pending = {
					...pending,
					coordinates: placementCoordinates(moved!.coordinates, pending.kind)
				};
			} else {
				const operation = operations[moved!.index];
				if (!operation) return;
				if (
					!['add_stop', 'add_school', 'add_hospital'].includes(operation.type) ||
					operation.metadata?.ui_package
				) {
					operations = [...operations];
					return;
				}
				editOperation(moved!.index, 'move');
				pending = {
					coordinates: placementCoordinates(moved!.coordinates, operation.type as PlacementKind),
					kind: operation.type as PlacementKind
				};
				armedKind = null;
				onPickKind(null);
			}
		});
	});
	$effect(() => {
		const context = suggestionSignature;
		untrack(() => {
			if (suggestionContext && suggestionContext !== context) cancelSuggestions();
		});
	});
	$effect(() => {
		const input = signature;
		if (
			!mounted ||
			!active ||
			!baseline ||
			!operations.length ||
			restoredScope !== scopedKey ||
			(evaluation && evaluatedSignature === input)
		) {
			untrack(() => {
				evaluationQueued = false;
			});
			return;
		}
		untrack(() => {
			evaluationQueued = true;
		});
		const timer = setTimeout(() => {
			untrack(() => void evaluate(input));
		}, 160);
		evaluateTimer = timer;
		return () => {
			clearTimeout(timer);
			evaluateController?.abort();
			untrack(() => {
				evaluationQueued = false;
				evaluating = false;
			});
		};
	});
	$effect(() => {
		const value: MapPolicyState = {
			seaOriginIslandId: restoredScope === scopedKey ? islandId : null,
			seaOperations:
				restoredScope === scopedKey
					? [...operations, ...(ferryOpen ? (ferryPreview?.operations ?? []) : [])]
					: [],
			seaAcceptedOperations: restoredScope === scopedKey ? operations : [],
			seaAssumptions: restoredScope === scopedKey ? request.assumptions : {},
			operations: displayOperations,
			pending: restoredScope === scopedKey ? pending : null,
			pendingDecision: restoredScope === scopedKey ? pendingDecision : null,
			gapFeatures: mapGaps,
			coverageFillFeatures: mapCoverageFill,
			impactFeatures: impact,
			policyComparisonView: impactView,
			comparisonPreview,
			serviceFeatures,
			serviceEditor,
			serviceEditorContent,
			mapControlsContent: active && !serviceEditor ? mapControlsContent : undefined,
			calculating: calculating || previewCalculating,
			policyEvaluationId:
				evaluation && !stale && !calculating && !comparisonPreview ? evaluatedSignature : null,
			stale: !comparisonPreview && stale,
			panelOpen: opened,
			proposalEditing:
				active &&
				((opened && section === 'proposal') || !!armedKind || !!pending || !!serviceEditor),
			placementRoads: baseline?.graph_edges ?? []
		};
		untrack(() => onState(value));
	});
	$effect(() => {
		const key = placementKey;
		const site = pending;
		if (
			!active ||
			!site ||
			busConnectionMode ||
			!baseline ||
			!supported ||
			loading ||
			!budgetLimits.allowed ||
			pendingWithin === false
		)
			return;
		const controller = new AbortController();
		placementQuoteController = controller;
		// placementKey contains every cost dependency; access goal/target changes must not
		// cancel and repeat a financial quote while an independent impact preview updates.
		const payload: PlanningReviewRequest = untrack(() => ({
			...request,
			operations: placementOperations
		}));
		const timer = setTimeout(async () => {
			try {
				const value = await api<BudgetQuote>('planning/quote', payload, controller.signal);
				if (!controller.signal.aborted && key === placementKey) {
					placementQuote = { key, value };
					placementRejection = null;
				}
			} catch (cause) {
				if (!controller.signal.aborted && key === placementKey)
					placementRejection = {
						key,
						reason:
							cause instanceof Error
								? cause.message
								: 'The cost could not be verified. Cancel and try this placement again.'
					};
			}
		}, 120);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});
	$effect(() => {
		const key = placementEvaluationKey;
		const payload = { ...request, operations: placementOperations };
		if (
			!active ||
			!pending ||
			!quotedPlacement?.budget.allowed ||
			pendingWithin !== true ||
			!supported
		)
			return;
		const controller = new AbortController();
		previewController = controller;
		untrack(() => {
			previewCalculating = true;
		});
		const timer = setTimeout(async () => {
			try {
				const value = await api<MapEvaluation>('planning/evaluate', payload, controller.signal);
				if (!controller.signal.aborted && key === placementEvaluationKey)
					placementEvaluation = { key, value };
			} catch {
				// Placement remains usable when the optional impact preview is unavailable.
			} finally {
				if (previewController === controller) previewCalculating = false;
			}
		}, 280);
		return () => {
			clearTimeout(timer);
			controller.abort();
			untrack(() => {
				previewCalculating = false;
			});
		};
	});
	async function evaluate(expected = signature) {
		clearTimeout(evaluateTimer);
		evaluationQueued = false;
		if (!operations.length || expected !== signature || restoredScope !== scopedKey) return;
		if (evaluatingSignature === expected && !evaluateController?.signal.aborted && evaluating)
			return;
		evaluateController?.abort();
		const controller = new AbortController();
		evaluateController = controller;
		evaluatingSignature = expected;
		evaluating = true;
		error = '';
		try {
			const value = await api<MapEvaluation>(
				'planning/evaluate',
				JSON.parse(expected),
				controller.signal
			);
			if (!controller.signal.aborted && signature === expected) {
				evaluation = value;
				financialQuote = {
					key: costModelKey,
					capital: value.economics.delta.capital_mvr ?? null,
					annual: value.economics.delta.annual_operating_mvr ?? null
				};
				evaluatedSignature = expected;
				resultTime = calculationTime();
			}
		} catch (cause) {
			if (!controller.signal.aborted)
				error = cause instanceof Error ? cause.message : 'Impact could not be calculated.';
		} finally {
			if (evaluateController === controller) evaluating = false;
		}
	}
	function calculationTime() {
		return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
			new Date()
		);
	}
	function requiresQuote(changes: PlanningOperation[]) {
		const calibrated =
			(Array.isArray(extraAssumptions.calibration_records) &&
				extraAssumptions.calibration_records.length > 0) ||
			(extraAssumptions.calibration_selection &&
				typeof extraAssumptions.calibration_selection === 'object' &&
				Object.keys(extraAssumptions.calibration_selection).length > 0);
		return changes.some(
			(operation) =>
				calibrated ||
				operation.opening_date ||
				operation.metadata?.valid_from ||
				operation.metadata?.valid_until ||
				operation.metadata?.costs ||
				operation.metadata?.ui_package ||
				!['add_stop', 'add_school', 'add_hospital'].includes(operation.type)
		);
	}
	function commitChange(next: PlanningOperation[], undoing = false) {
		history = undoing ? history.slice(0, -1) : [...history.slice(-29), operations];
		operations = next;
		if (!next.length) {
			evaluation = null;
			evaluatedSignature = '';
			resultTime = '';
		}
		suggested = null;
		error = '';
		impactView = 'proposal';
		actionMessage = undoing ? 'Last change undone' : 'Proposal updated';
	}
	function change(next: PlanningOperation[], undoing = false) {
		quoteController?.abort();
		checkingBudget = false;
		const removal =
			next.length < operations.length && next.every((operation) => operations.includes(operation));
		if (removal) {
			commitChange(next, undoing);
			return true;
		}
		const limits = assessDraftBudget(
			{ capital: 0, annual: 0 },
			budgetNumber(capitalBudget),
			budgetNumber(annualBudget)
		);
		if (!limits.allowed) {
			error = limits.reason;
			operations = [...operations];
			return false;
		}
		// Package display estimates never authorize spending. Verify routed changes on the backend.
		if (requiresQuote(next)) {
			void quoteChange(next, undoing);
			return false;
		}
		const estimate = draftCosts(next, costDefaults);
		const decision = assessDraftBudget(
			estimate,
			budgetNumber(capitalBudget),
			budgetNumber(annualBudget)
		);
		if (decision.allowed) {
			commitChange(next, undoing);
			return true;
		}
		if (decision.known) {
			error = decision.reason;
			operations = [...operations];
			return false;
		}
		void quoteChange(next, undoing);
		return false;
	}
	async function quoteChange(next: PlanningOperation[], undoing: boolean) {
		const controller = new AbortController();
		let committed = false;
		quoteController = controller;
		const context = signature;
		const siteContext = placementKey;
		checkingBudget = true;
		error = '';
		try {
			const result = await api<{
				economics: PlanningEconomics;
				budget: { allowed: boolean; reasons: string[] };
			}>('planning/quote', { ...request, operations: next }, controller.signal);
			if (controller.signal.aborted || context !== signature) return;
			if (!result.budget.allowed) {
				error =
					result.budget.reasons.join(' ') ||
					'This change cannot be funded within the current budgets.';
				if (pending) placementRejection = { key: siteContext, reason: error };
				return;
			}
			financialQuote = {
				key: planningFinancialKey({ ...request, operations: next }),
				capital: result.economics.delta.capital_mvr ?? null,
				annual: result.economics.delta.annual_operating_mvr ?? null
			};
			commitChange(next, undoing);
			committed = true;
		} catch (cause) {
			if (!controller.signal.aborted)
				error =
					cause instanceof Error ? cause.message : 'The budget could not be checked. Try again.';
		} finally {
			if (quoteController === controller) {
				checkingBudget = false;
				// A dragged marker must return to its saved site when its change is rejected.
				if (!committed) operations = [...operations];
			}
		}
	}
	function undo() {
		if (!history.length) return;
		cancelPending();
		if (change(history.at(-1)!, true)) pending = null;
	}
	function placementLabel(kind: PlacementKind) {
		return kind === 'add_stop' ? 'Bus stop' : kind === 'add_school' ? 'School' : 'Hospital';
	}
	function placementCoordinates(point: Coordinates, kind: PlacementKind) {
		if (kind !== 'add_stop' || !baseline) return point;
		const nearest = nearestPlacementRoad(point, baseline.graph_edges);
		return nearest.snapped &&
			islandId &&
			pointWithinIsland(nearest.coordinates, boundaryFeatures, islandId) === true
			? nearest.coordinates
			: point;
	}
	function editOperation(index: number, action: 'move' | 'duplicate' | 'remove') {
		const operation = operations[index];
		if (!operation) return;
		if (action === 'remove') {
			removeOperation(index);
			return;
		}
		if (
			!['add_stop', 'add_school', 'add_hospital'].includes(operation.type) ||
			operation.metadata?.ui_package
		)
			return;
		cancelPending();
		closeFerry();
		closeBusService();
		const kind = operation.type as PlacementKind;
		setGoal(kind === 'add_stop' ? 'transport' : kind === 'add_school' ? 'education' : 'healthcare');
		editingIndex = action === 'move' ? index : null;
		pendingBase =
			action === 'move'
				? operation
				: { ...operation, name: `${operation.name ?? placementLabel(kind)} · copy` };
		pendingId =
			action === 'move'
				? String(operation.metadata?.proposal_id ?? `proposal:${kind}:${crypto.randomUUID()}`)
				: `proposal:${kind}:${crypto.randomUUID()}`;
		armedKind = kind;
		opened = false;
		section = 'proposal';
		actionMessage = `${action === 'move' ? 'Choose a new location for' : 'Place a copy of'} this ${placementLabel(kind).toLowerCase()}`;
		onPickKind(kind);
		onCloseOthers();
	}
	function adjustBudget() {
		budgetEditing = true;
		open('proposal');
		void tick().then(() => document.getElementById('map-capital-budget')?.focus());
	}
	function chooseComposeMode(value: 'manual' | 'budget') {
		composeMode = value;
		budgetEditing = value === 'budget';
		if (value === 'manual') cancelSuggestions();
	}
	function rememberScoreDock(node?: HTMLElement) {
		const dock = node ?? document.querySelector<HTMLElement>('.policy-map-controls');
		if (dock?.getClientRects().length) scoreDockBounds = dock.getBoundingClientRect();
	}
	function scoreDockMotion(
		node: HTMLElement,
		{ direction }: { direction: 'in' | 'out' }
	): TransitionConfig {
		if (direction === 'out') rememberScoreDock(node);
		const returning = direction === 'in' && returningToScore;
		if (direction === 'in') returningToScore = false;
		const animate =
			shouldAnimateMotion() && (returning || (direction === 'out' && section === 'needs'));
		return {
			delay: animate && returning ? 90 : 0,
			duration: animate ? (returning ? 200 : 100) : 0,
			easing: (value) => 1 - (1 - value) ** 3,
			css: (value) => `opacity:${value};transform:translateY(${(1 - value) * 8}px)`
		};
	}
	function overviewPanelMotion(
		node: HTMLElement,
		{ direction }: { direction: 'in' | 'out' }
	): TransitionConfig {
		if (node.dataset.policySection !== 'needs') return surfaceMotion(node, { direction });
		if (!shouldAnimateMotion()) return { duration: 0 };
		const panel = node.getBoundingClientRect();
		const dock = document.querySelector<HTMLElement>('.policy-map-controls');
		const origin = dock?.getBoundingClientRect() ?? scoreDockBounds;
		const inset = {
			top: Math.max(
				0,
				Math.min(panel.height - 1, origin ? origin.top - panel.top : panel.height - 110)
			),
			right: Math.max(0, origin ? panel.right - origin.right : 0),
			bottom: Math.max(0, origin ? panel.bottom - origin.bottom : 0),
			left: Math.max(
				0,
				Math.min(panel.width - 1, origin ? origin.left - panel.left : panel.width - 330)
			)
		};
		const clamp = (value: number) => Math.max(0, Math.min(1, value));
		return {
			duration: direction === 'in' ? 300 : 240,
			// Reveal the surface first; its content follows without ever scaling type or charts.
			css: (value) => {
				const reveal = direction === 'in' ? 1 - (1 - value) ** 4 : value ** 2;
				const content =
					direction === 'in'
						? 1 - (1 - clamp((value - 0.2) / 0.75)) ** 3
						: clamp((value - 0.65) / 0.35);
				const hidden = 1 - reveal;
				return `clip-path:inset(${inset.top * hidden}px ${inset.right * hidden}px ${inset.bottom * hidden}px ${inset.left * hidden}px round ${14 + reveal * 3}px);opacity:${direction === 'in' ? 0.9 + reveal * 0.1 : clamp(value * 2)};--overview-content-opacity:${content};--overview-content-offset:${(1 - content) * 14}px`;
			}
		};
	}
	function open(mode: 'needs' | 'proposal') {
		if (!opened) rememberScoreDock();
		opened = true;
		section = mode;
		onCloseOthers();
		if (mode === 'needs') {
			void tick().then(() => {
				document
					.querySelector<HTMLElement>('#island-score-details h2')
					?.focus({ preventScroll: true });
			});
		}
	}
	function close() {
		quoteController?.abort();
		checkingBudget = false;
		returningToScore = opened && section === 'needs';
		opened = false;
		cancelPending();
		review = false;
		closeFerry();
		closeBusService();
		cancelSuggestions();
		onPickKind(null);
	}
	async function collapseOverview() {
		close();
		await tick();
		document
			.querySelector<HTMLButtonElement>('.policy-inspect-trigger')
			?.focus({ preventScroll: true });
	}
	function begin(kind: PlacementKind) {
		if (!supported) {
			error = localConstructionReason;
			return;
		}
		quoteController?.abort();
		checkingBudget = false;
		cancelPending();
		opened = false;
		section = 'proposal';
		impactView = 'proposal';
		armedKind = kind;
		pendingId = `proposal:${kind}:${crypto.randomUUID()}`;
		actionMessage = `Click the map to place a ${placementLabel(kind).toLowerCase()}. Comparing ${kind === 'add_stop' ? 'walking access to public transport' : kind === 'add_school' ? 'education journeys' : 'healthcare journeys'}.`;
		setGoal(kind === 'add_stop' ? 'transport' : kind === 'add_school' ? 'education' : 'healthcare');
		suggested = null;
		closeFerry();
		closeBusService();
		onPickKind(kind);
		onCloseOthers();
	}
	function beginFerry(point?: Coordinates) {
		serviceEditorCompact = false;
		cancelPending();
		cancelSuggestions();
		opened = false;
		section = 'proposal';
		onCloseOthers();
		ferryDropPoint = point ?? null;
		ferryOriginTerminal = '';
		serviceAnchor = point ?? current?.coordinates ?? null;
		ferryOpen = true;
		closeBusService();
		ferryError = '';
		ferryChoosingDestination = !ferryDestination;
		onLensChange('transport');
		setGoal('transport');
	}
	function beginBusService(
		point?: Coordinates,
		intent: 'add' | 'improve' = 'improve',
		mode: 'bus' | 'ferry' = 'bus'
	) {
		serviceEditorCompact = false;
		cancelPending();
		cancelSuggestions();
		closeFerry();
		closeBusService();
		serviceMode = mode;
		serviceIntent = intent;
		serviceProposalId = crypto.randomUUID();
		opened = false;
		section = 'proposal';
		onCloseOthers();
		serviceAnchor = point ?? current?.coordinates ?? null;
		busOpen = true;
		busError = '';
		if (!servicePatterns.some((pattern) => pattern.id === busPatternId))
			busPatternId = servicePatterns[0]?.id ?? '';
		if (point && baseline?.stops) {
			const nearest = [...baseline.stops]
				.filter((stop) => servicePatterns.some((pattern) => pattern.stopIds.includes(stop.id)))
				.sort(
					(a, b) =>
						Math.hypot(a.lon - point[0], a.lat - point[1]) -
						Math.hypot(b.lon - point[0], b.lat - point[1])
				)[0];
			const route = servicePatterns.find(
				(pattern) => nearest && pattern.stopIds.includes(nearest.id)
			);
			if (route) busPatternId = route.id;
		}
		prefillServiceHeadway();
		serviceAnchor = routeAnchor();
		focusFerryFeatures(busMapFeatures());
		onLensChange('transport');
		setGoal('transport');
	}
	function prefillServiceHeadway() {
		const currentHeadway = busPattern
			? serviceTimingSummary(busPattern, date).headwayMinutes
			: null;
		const accepted = operations.find(
			(operation) => operation.type === 'set_frequency' && operation.target_id === busPatternId
		);
		busHeadway =
			serviceIntent === 'improve'
				? (accepted?.headway_minutes ?? Math.max(1, Math.floor((currentHeadway ?? 30) / 2)))
				: (currentHeadway ?? 30);
	}
	function closeBusService() {
		busOpen = false;
		busController?.abort();
		busRequestedSignature = '';
		busQuoting = false;
		busError = '';
	}
	function busMapFeatures(): FeatureCollection {
		const lines =
			busPattern?.segmentGeometries?.filter((line) => line.length > 1) ??
			(busPattern?.geometry?.length ? [busPattern.geometry] : []);
		return {
			type: 'FeatureCollection',
			features: [
				...lines.map((coordinates) => ({
					type: 'Feature' as const,
					properties: { name: busPattern?.name, mode: serviceMode },
					geometry: { type: 'LineString' as const, coordinates }
				})),
				...(baseline?.stops ?? [])
					.filter((stop) => busPattern?.stopIds.includes(stop.id))
					.map((stop) => ({
						type: 'Feature' as const,
						properties: { id: stop.id, name: stop.name, mode: serviceMode, role: 'stop' },
						geometry: { type: 'Point' as const, coordinates: [stop.lon, stop.lat] }
					}))
			]
		};
	}
	async function previewBusService() {
		if (!busOpen) return;
		if (!budgetLimits.allowed) {
			busError = budgetLimits.reason ?? 'Set valid proposal budget limits first.';
			return;
		}
		if (
			!busPattern ||
			!Number.isFinite(Number(busHeadway)) ||
			Number(busHeadway) < 1 ||
			Number(busHeadway) > 720
		) {
			busError = 'Choose a route and a departure interval between 1 and 720 minutes.';
			return;
		}
		if (!busPatternActive) {
			busError =
				'No published departures start on the selected service date. Choose a recorded service date before changing this route.';
			return;
		}
		if (!serviceChange.operations || serviceChange.error) {
			busError = serviceChange.error ?? 'Choose a route with a recorded timetable.';
			return;
		}
		busController?.abort();
		const controller = new AbortController();
		busController = controller;
		const key = busSignature;
		busRequestedSignature = key;
		busQuoting = true;
		busError = '';
		try {
			const value = await api<BudgetQuote>(
				'planning/quote',
				{ ...request, operations: serviceChange.operations },
				controller.signal
			);
			if (!controller.signal.aborted && busOpen && key === busSignature) {
				busQuote = { key, value };
			}
		} catch (cause) {
			if (!controller.signal.aborted)
				busError =
					cause instanceof Error ? cause.message : 'The service cost could not be checked.';
		} finally {
			if (busController === controller) busQuoting = false;
		}
	}
	function confirmBusService() {
		if (
			!busOpen ||
			!busPatternActive ||
			!budgetLimits.allowed ||
			!busPreview?.budget.allowed ||
			busQuoting ||
			checkingBudget ||
			!serviceChange.operations ||
			serviceChange.error
		)
			return;
		const next = serviceChange.operations;
		financialQuote = {
			key: planningFinancialKey({ ...request, operations: next }),
			capital: busPreview.economics.delta.capital_mvr ?? null,
			annual: busPreview.economics.delta.annual_operating_mvr ?? null
		};
		commitChange(next);
		actionMessage =
			serviceIntent === 'add'
				? 'Additional bus departures added'
				: `${serviceMode === 'bus' ? 'Bus' : 'Ferry'} line frequency updated`;
		closeBusService();
	}
	function closeFerry() {
		ferryOpen = false;
		ferryChoosingDestination = false;
		ferryDraftController?.abort();
		ferryRequestedSignature = '';
		ferryConnectionController?.abort();
		ferryPreviewing = false;
		ferryLoading = false;
		ferryDraft = null;
		appliedFerrySuggestion = null;
		ferryError = '';
		onPickFerryDestination(false);
	}
	function chooseFerryDestination(id: string) {
		if (id === islandId) {
			ferryError = 'Choose a different island for this ferry service.';
			return;
		}
		ferryDestination = id;
		ferrySearch = '';
		ferryChoosingDestination = false;
		ferryError = '';
		opened = false;
		section = 'proposal';
		onPickFerryDestination(false);
	}
	function pickFerryDestination() {
		ferryChoosingDestination = false;
		opened = false;
		onPickFerryDestination(true);
	}
	function focusFerryFeatures(features: FeatureCollection) {
		const bounds = ferryFeatureBounds(features);
		if (bounds && onFocusBounds) onFocusBounds(bounds);
	}
	async function applyFerrySuggestion() {
		const value = ferrySuggestion;
		const key = ferrySuggestionKey;
		if (!value?.inputs || value.status !== 'ready') return;
		const input = value.inputs;
		const clock = (minutes: number) =>
			`${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
		ferryDraftController?.abort();
		ferryPreviewing = false;
		chooseFerryDestination(input.destination_island_id);
		ferryOriginTerminal = input.origin_terminal_id ?? value.summary?.origin_terminal.id ?? '';
		ferryDestinationTerminal =
			input.destination_terminal_id ?? value.summary?.destination_terminal.id ?? '';
		ferryHeadway = input.headway_minutes;
		ferryStart = clock(input.start_minutes);
		ferryEnd = clock(input.end_minutes);
		ferrySpeed = input.speed_kph;
		await tick();
		if (key !== ferrySuggestionKey || !ferryOpen) return;
		const previewKey = ferrySignature;
		ferryDraft = { key: previewKey, value };
		appliedFerrySuggestion = { key: previewKey, value };
		ferryRequestedSignature = previewKey;
		focusFerryFeatures(value.map_features);
	}
	async function previewFerry() {
		const input = ferryInput;
		if (operations.length > 98) {
			ferryError =
				'A return ferry service needs two changes. Remove a change to stay within the 100-change proposal limit.';
			return;
		}
		if (!input.payload) {
			ferryError = input.error;
			return;
		}
		if (!budgetLimits.allowed) {
			ferryError = budgetLimits.reason;
			return;
		}
		if (ferryDraft?.key === ferrySignature) return;
		ferryDraftController?.abort();
		const controller = new AbortController();
		ferryDraftController = controller;
		const key = ferrySignature;
		ferryRequestedSignature = key;
		ferryPreviewing = true;
		ferryError = '';
		try {
			const value = await api<FerryDraft>(
				'planning/ferry-service',
				input.payload,
				controller.signal
			);
			if (!controller.signal.aborted && key === ferrySignature) {
				ferryDraft = { key, value };
			}
		} catch (cause) {
			if (!controller.signal.aborted)
				ferryError =
					cause instanceof Error
						? cause.message
						: 'The ferry service could not be costed. Try again.';
		} finally {
			if (ferryDraftController === controller) ferryPreviewing = false;
		}
	}
	function confirmFerry() {
		if (!ferryAllowed || !ferryPreview?.quote) {
			ferryError =
				ferryPreview?.quote?.budget.reasons.join(' ') ||
				'Preview this service and verify both budgets before adding it.';
			return;
		}
		const preview = ferryPreview;
		const preparedImpact = suggestedFerryPreview?.impact;
		const group = `ferry-service:${crypto.randomUUID()}`;
		const capital = preview.quote!.economics.delta.capital_mvr ?? null;
		const annual = preview.quote!.economics.delta.annual_operating_mvr ?? null;
		const additions = preview.operations.map((operation, index) => ({
			...operation,
			...(index === 0 && preview.summary ? { name: preview.summary.name } : {}),
			metadata: {
				...operation.metadata,
				ui_map_features: undefined,
				ui_package: group,
				ui_capital:
					index === 0
						? capital !== null && costs.capital !== null
							? capital - costs.capital
							: undefined
						: 0,
				ui_annual:
					index === 0
						? annual !== null && costs.annual !== null
							? annual - costs.annual
							: undefined
						: 0,
				...(index === 0
					? { ui_map_features: preview.map_features, ui_ferry_summary: preview.summary }
					: {})
			}
		}));
		const next = [...operations, ...additions];
		financialQuote = {
			key: planningFinancialKey({ ...request, operations: next }),
			capital,
			annual
		};
		commitChange(next);
		if (preparedImpact) {
			// Only presentation metadata was added to this exact, already evaluated proposal.
			evaluation = { ...preparedImpact, origins: preparedImpact.origins ?? [] };
			evaluatedSignature = JSON.stringify(request);
			resultTime = calculationTime();
		}
		closeFerry();
		actionMessage = preparedImpact
			? 'Ferry service added · impact on both islands is ready'
			: 'Ferry service added · recalculating journeys and costs';
	}
	function confirm() {
		if (!pending || (editingIndex === null && operations.length >= 100)) return;
		if (!supported) {
			error = localConstructionReason;
			return;
		}
		if (!pendingDecision?.allowed) {
			error = pendingDecision?.reason || 'Verify this site and its budget before adding it.';
			return;
		}
		if (!islandId || pointWithinIsland(pending.coordinates, boundaryFeatures, islandId) !== true) {
			error =
				'Choose a site inside the selected island. Water and other islands cannot be used for this proposal.';
			return;
		}
		const next = placementOperations;
		if (!quotedPlacement) return;
		const acceptedEvaluation = pendingEvaluation;
		const acceptedSignature = placementEvaluationKey;
		const wasMoving = editingIndex !== null;
		const stopWithoutService = pending.kind === 'add_stop' && !busConnectionMode;
		financialQuote = {
			key: planningFinancialKey({ ...request, operations: next }),
			capital: quotedPlacement.economics.delta.capital_mvr ?? null,
			annual: quotedPlacement.economics.delta.annual_operating_mvr ?? null
		};
		commitChange(next);
		if (acceptedEvaluation && JSON.stringify(request) === acceptedSignature) {
			evaluation = acceptedEvaluation;
			evaluatedSignature = acceptedSignature;
			resultTime = calculationTime();
		}
		cancelPending();
		actionMessage = wasMoving
			? 'Location updated'
			: stopWithoutService
				? 'Stop saved. Add a connected service to improve transport access.'
				: 'Added to your proposal';
	}
	function setGoal(value: 'healthcare' | 'education' | 'transport') {
		onLensChange(value === 'healthcare' ? 'health' : value);
		if (goal === value) return;
		goal = value;
		targetMinutes = value === 'transport' ? 10 : 30;
	}
	function removeOperation(index: number) {
		const group = operations[index]?.metadata?.ui_package;
		change(
			operations.filter((item, i) => (group ? item.metadata?.ui_package !== group : i !== index))
		);
	}
	function cancelPending() {
		busConnectionController?.abort();
		busConnectionChecking = false;
		busConnectionDraft = null;
		busConnectionTarget = '';
		busConnectionError = '';
		busStopOnly = false;
		quoteController?.abort();
		checkingBudget = false;
		pending = null;
		armedKind = null;
		editingIndex = null;
		pendingBase = null;
		pendingId = '';
		budgetEditing = false;
		placementEvaluation = null;
		previewController?.abort();
		previewCalculating = false;
		actionMessage = '';
		onPickKind(null);
	}
	function togglePriority(domain: PolicyDomain) {
		priorities = priorities.includes(domain)
			? priorities.filter((value) => value !== domain)
			: [...priorities, domain];
	}
	function cancelSuggestions() {
		suggestionController?.abort();
		suggestionContext = '';
		suggested = null;
		suggesting = false;
	}
	async function suggest() {
		if (!islandId || !priorities.length || loading) return;
		if (costs.capital === null || costs.annual === null) {
			error =
				'Calculate this draft before requesting more investments. Its current cost evidence is incomplete.';
			return;
		}
		if (!budgetLimits.allowed) {
			error = budgetLimits.reason;
			return;
		}
		suggestionController?.abort();
		const controller = new AbortController();
		suggestionController = controller;
		const context = suggestionSignature;
		suggestionContext = context;
		suggesting = true;
		error = '';
		suggested = null;
		pending = null;
		try {
			const draft = await api<SuggestedDraft>(
				'planning/opportunities/suggest',
				{
					island_id: islandId,
					capital_budget_mvr: Math.max(0, Number(capitalBudget) - (costs.capital ?? 0)),
					annual_operating_budget_mvr: Math.max(0, Number(annualBudget) - (costs.annual ?? 0)),
					priorities,
					max_recommendations: 4,
					assumptions: request.assumptions
				},
				controller.signal
			);
			if (
				!controller.signal.aborted &&
				suggestionContext === context &&
				suggestionSignature === context
			) {
				const existingIds = new Set(
					operations.flatMap((operation) =>
						typeof operation.metadata?.proposal_id === 'string'
							? [operation.metadata.proposal_id]
							: []
					)
				);
				const selected = draft.selected.filter(
					(item) =>
						!item.operations.some((operation) =>
							existingIds.has(String(operation.metadata?.proposal_id))
						)
				);
				suggested = {
					...draft,
					selected,
					operations: selected.flatMap((item) => item.operations),
					total_capital_mvr: selected.reduce((total, item) => total + item.capital_mvr, 0),
					total_annual_operating_mvr: selected.reduce(
						(total, item) => total + item.annual_operating_mvr,
						0
					),
					estimated_gained_residents:
						selected.length === draft.selected.length ? draft.estimated_gained_residents : null,
					map_features: {
						type: 'FeatureCollection',
						features: selected.flatMap((item) => item.map_features?.features ?? [])
					},
					warnings:
						selected.length < draft.selected.length
							? [
									...draft.warnings,
									'Suggestions already in this draft were excluded. Adjust priorities or review the current proposal.'
								]
							: draft.warnings
				};
				if (selected[0]?.coordinates) onFocus(selected[0].coordinates);
			}
		} catch (cause) {
			if (!controller.signal.aborted)
				error = cause instanceof Error ? cause.message : 'Suggestions could not load.';
		} finally {
			if (suggestionController === controller) suggesting = false;
		}
	}
	function acceptSuggestions() {
		if (!suggested) return;
		if (suggestionContext !== suggestionSignature) {
			cancelSuggestions();
			error = 'The draft or budget changed. Generate fresh suggestions for these limits.';
			return;
		}
		const items = suggested.selected.flatMap((suggestion) =>
			suggestion.operations.map((operation, index) => ({
				...operation,
				metadata: {
					...operation.metadata,
					ui_package: suggestion.id,
					ui_capital: index === 0 ? suggestion.capital_mvr : 0,
					ui_annual: index === 0 ? suggestion.annual_operating_mvr : 0,
					...(index === 0 && suggestion.map_features
						? { ui_map_features: suggestion.map_features }
						: {})
				}
			}))
		);
		if (operations.length + items.length > 100) {
			error =
				'This package would exceed the 100-change draft limit. Remove a package before adding more.';
			return;
		}
		const next = [...operations, ...items];
		if (change(next)) cancelSuggestions();
	}
	function focusOperation(index: number) {
		const ferryFeatures = operations[index]?.metadata?.ui_map_features as
			FeatureCollection | undefined;
		if (ferryFeatures?.features.some((feature) => feature.geometry.type === 'LineString')) {
			review = false;
			focusFerryFeatures(ferryFeatures);
			return;
		}
		const coordinates = operations[index]?.coordinates;
		if (coordinates?.length === 2) {
			review = false;
			onFocus(coordinates as Coordinates);
		}
	}
	const coverageLenses: { id: PolicyLens; label: string }[] = [
		{ id: 'overall', label: 'All services' },
		{ id: 'transport', label: 'Transport' },
		{ id: 'health', label: 'Health' },
		{ id: 'education', label: 'Education' }
	];
	function selectLens(value: PolicyLens) {
		onLensChange(value);
	}
</script>

<svelte:window bind:innerWidth={viewportWidth} bind:innerHeight={viewportHeight} />

{#snippet comparisonViews()}
	<div class="proposal-map-views" role="group" aria-label="Proposal map view">
		{#each [{ id: 'current', label: 'Without proposal' }, { id: 'proposal', label: 'With proposal' }] as view (view.id)}
			<button
				class:active={impactView === view.id}
				aria-pressed={impactView === view.id}
				disabled={!impact.features.length}
				onclick={() => (impactView = view.id as typeof impactView)}>{view.label}</button
			>
		{/each}
	</div>
{/snippet}

{#snippet serviceMapPreviewAction()}
	<button
		class="service-preview-map"
		disabled={busConnectionMode
			? !busConnection?.summary
			: ferryOpen
				? !ferryPreview?.summary
				: !busPattern}
		onclick={async () => {
			serviceEditorCompact = true;
			await tick();
			focusFerryFeatures(
				busConnectionMode
					? busConnection!.map_features
					: ferryOpen
						? ferryPreview!.map_features
						: busMapFeatures()
			);
		}}><MapPin size={14} />See the full route on the map</button
	>
{/snippet}

{#snippet serviceEditorContent()}
	<div
		class="policy-service-popover"
		class:compact-preview={serviceEditorCompact}
		data-service-intent={busOpen ? serviceIntent : 'add'}
	>
		{#if serviceEditorCompact}
			<header>
				<div>
					<span class="eyebrow">ROUTE PREVIEW</span>
					<h3>
						{ferryOpen ? 'Add ferry' : busConnectionMode ? 'Stop + connecting bus' : serviceTitle}
					</h3>
				</div>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Cancel service preview"
					onclick={() => {
						cancelPending();
						closeFerry();
						closeBusService();
					}}><X size={16} /></Button
				>
			</header>
			<p>
				{busConnectionMode
					? busConnection?.summary?.name
					: ferryOpen
						? ferryPreview?.summary?.name
						: busPattern?.name}
			</p>
			<small class="service-preview-schedule"
				>Every {busConnectionMode ? busConnectionHeadway : ferryOpen ? ferryHeadway : busHeadway} minutes
				on {date}.
				<span class="service-preview-instructions"
					>Review the highlighted path before accepting.</span
				></small
			>
			<div class="service-costs">
				<span>Whole proposal</span><strong
					>MVR {formatAmount(visibleEconomics.delta.capital_mvr, true)} upfront</strong
				><small>MVR {formatAmount(visibleEconomics.delta.annual_operating_mvr, true)} yearly</small>
			</div>
			{#if comparisonPreview}<div class="service-comparison-controls">
					<small>Preview · {comparisonGoalLabel} within {comparisonTarget} min</small>
					{@render comparisonViews()}
				</div>{/if}
			{#if visibleTransportImpact}
				<div class="service-preview-full-impact">
					<TransportImpact impact={visibleTransportImpact} compact preview />
				</div>
				<details class="service-preview-evidence">
					<summary>
						<span>{transportBenefitHeadline ?? 'Timetable evidence'}</span>
						<small>Preview · view timetable details</small>
					</summary>
					<TransportImpact impact={visibleTransportImpact} compact preview />
				</details>
			{/if}
			<footer>
				<Button
					disabled={busConnectionMode
						? !pendingDecision?.allowed || busConnectionChecking
						: ferryOpen
							? !ferryAllowed
							: !busPreview?.budget.allowed ||
								busQuoting ||
								!busPatternActive ||
								!budgetLimits.allowed ||
								!!serviceChange.error}
					onclick={() => {
						if (busConnectionMode) confirm();
						else if (ferryOpen) confirmFerry();
						else confirmBusService();
					}}
					><Check size={15} />Accept {busConnectionMode
						? 'stop & route'
						: ferryOpen
							? 'ferry service'
							: 'service'}</Button
				><Button variant="outline" onclick={() => (serviceEditorCompact = false)}
					>Edit settings</Button
				>
			</footer>
		{:else}
			{#if busConnectionMode}
				<header>
					<div>
						<span class="eyebrow">NEW BUS CONNECTION</span>
						<h3>Connect this stop</h3>
					</div>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Cancel bus connection"
						onclick={cancelPending}><X size={16} /></Button
					>
				</header>
				<div class="service-stop-choice">
					<span>Adding a stop? Choose whether it also needs a bus connection.</span>
					<Button
						size="sm"
						variant="outline"
						onclick={() => {
							busStopOnly = true;
							busConnectionController?.abort();
						}}>Add only a stop</Button
					>
				</div>
				{@render serviceMapPreviewAction()}
				{#if comparisonPreview}<div class="service-comparison-controls">
						<small>Preview · {comparisonGoalLabel} within {comparisonTarget} min</small>
						{@render comparisonViews()}
					</div>{/if}
				<p>
					The suggested shuttle follows roads in both directions. Choose another highlighted stop to
					change its path.
				</p>
				{#if busConnectionChecking}<p class="service-progress" role="status">
						<RefreshCw size={14} class="spin" />Finding a road connection and checking costs…
					</p>{/if}
				{#if busConnection?.candidates.length}
					<Label for="connection-stop">Connect to</Label>
					<select
						id="connection-stop"
						value={busConnectionTarget || busConnection.selected_stop_id || ''}
						onchange={(event) => (busConnectionTarget = event.currentTarget.value)}
					>
						{#each busConnection.candidates as candidate (candidate.stop.id)}<option
								value={candidate.stop.id}
								>{candidate.stop.name} · {(candidate.distance_m / 1000).toFixed(2)} km</option
							>{/each}
					</select>
					{#if busConnection.summary?.target_stop.serving_routes.length}<small
							>Interchange with {busConnection.summary.target_stop.serving_routes.join(', ')}</small
						>{/if}
				{/if}
				<div class="service-field-row">
					<div>
						<Label for="connection-frequency">A bus every · min</Label><Input
							id="connection-frequency"
							type="number"
							min="5"
							max="180"
							bind:value={busConnectionHeadway}
						/>
					</div>
					<div>
						<Label for="connection-date">Service date</Label><Input
							id="connection-date"
							type="date"
							bind:value={date}
						/>
					</div>
				</div>
				<details class="service-options">
					<summary>Operating hours and bus type</summary>
					<div class="service-field-row">
						<div>
							<Label for="connection-start">First departure</Label><Input
								id="connection-start"
								type="time"
								bind:value={busConnectionStart}
							/>
						</div>
						<div>
							<Label for="connection-end">Finish by</Label><Input
								id="connection-end"
								type="time"
								bind:value={busConnectionEnd}
							/>
						</div>
					</div>
					<Label for="connection-fleet">Bus type</Label><select
						id="connection-fleet"
						bind:value={busConnectionFleet}
						><option value="diesel">Diesel bus</option><option value="electric">Electric bus</option
						></select
					><small>Uses an assumed 15 km/h road speed. The service runs on this proposal date.</small
					>
				</details>
				{#if busConnection?.summary}{@const summary = busConnection.summary}
					<div class="service-metrics">
						<span><b>{Math.round(summary.travel_minutes)} min</b>outbound journey</span><span
							><b>{summary.departures_each_direction}</b>trips each way</span
						><span><b>{summary.roundtrip_distance_km.toFixed(2)} km</b>return road path</span>
					</div>{/if}
				{#if busConnection?.quote}<div class="service-costs">
						<span>Proposal total with stop + return service</span><strong
							>MVR {formatAmount(busConnection.quote.economics.delta.capital_mvr, true)} upfront</strong
						><small
							>MVR {formatAmount(busConnection.quote.economics.delta.annual_operating_mvr, true)} per
							year</small
						>
					</div>{/if}
				{#if previewCalculating}<small role="status"
						>Checking resident access with this route…</small
					>{:else if pendingEvaluation}<div class="service-access">
						<b>+{formatAmount(pendingEvaluation.summary.gained_residents)}</b> residents gain {goalLabel}
						within {targetMinutes} min · whole proposal
					</div>{/if}
				{#if busConnectionError}<p class="policy-error" role="alert">{busConnectionError}</p>
					<Button
						variant="outline"
						size="sm"
						onclick={() => {
							busConnectionRetry++;
							busConnectionTarget = '';
							busConnectionDraft = null;
							busConnectionHeadway = 20;
						}}>Reset route choices</Button
					>{/if}
				{#each busConnection?.reasons ?? [] as reason, i (i)}<p class="service-note">
						{reason}
					</p>{/each}
				{#if !budgetLimits.allowed || pendingWithin !== true || (busConnection?.quote && !busConnection.quote.budget.allowed)}<p
						class="policy-budget-alert"
						role="alert"
					>
						{!budgetLimits.allowed
							? budgetLimits.reason
							: pendingWithin !== true
								? pendingDecision?.reason
								: busConnection?.quote?.budget.reasons.join(' ')}
					</p>{/if}
				<TransportImpact impact={visibleTransportImpact} compact preview />
				<footer>
					<Button disabled={!pendingDecision?.allowed || busConnectionChecking} onclick={confirm}
						><Check size={15} />Accept stop & route</Button
					>
				</footer>
				<small
					>Only confirmed changes enter your proposal. A stop alone creates no scheduled bus service
					and earns no transport access gain.</small
				>
			{:else if busOpen}
				<header>
					<div>
						<span class="eyebrow"
							>{serviceIntent === 'add' ? 'ADDITIONAL DEPARTURES' : 'EXISTING LINE'}</span
						>
						<h3>{serviceTitle}</h3>
					</div>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label={`Close ${serviceMode} service planner`}
						onclick={closeBusService}><X size={16} /></Button
					>
				</header>
				{@render serviceMapPreviewAction()}
				<Label for="proposal-bus-route"
					>{serviceMode === 'bus' ? 'Bus' : 'Ferry'} route and direction</Label
				><select
					id="proposal-bus-route"
					bind:value={busPatternId}
					onchange={(event) => {
						busPatternId = event.currentTarget.value;
						prefillServiceHeadway();
						serviceAnchor = routeAnchor();
						focusFerryFeatures(busMapFeatures());
					}}
					>{#each servicePatterns as pattern (pattern.id)}<option value={pattern.id}
							>{pattern.name}</option
						>{/each}</select
				>
				<p>
					{busPattern?.stopIds.length ?? 0} boarding points · {serviceTiming?.windowLabel ||
						'Select a dated timetable'}.
					{serviceIntent === 'add'
						? 'Keeps existing departures and adds buses in this direction.'
						: 'Changes departures in this direction; the return line stays as it is.'}
				</p>
				<div class="service-field-row">
					<div>
						<Label for="proposal-bus-frequency"
							>{serviceIntent === 'add'
								? 'Additional bus'
								: serviceMode === 'bus'
									? 'A bus'
									: 'A ferry'} every · min</Label
						><Input
							id="proposal-bus-frequency"
							type="number"
							min="1"
							max="720"
							bind:value={busHeadway}
						/>
					</div>
					<div>
						<Label for="proposal-bus-date">Service date</Label><Input
							id="proposal-bus-date"
							type="date"
							bind:value={date}
						/>
					</div>
				</div>
				{#if serviceTiming?.headwayMinutes}<small class="service-current-frequency">
						{serviceTiming.headwayVaries ? 'Current intervals vary; typically' : 'Currently'} every {formatAmount(
							serviceTiming.headwayMinutes
						)} min · {serviceTiming.departureCount} recorded departures.
					</small>{/if}
				{#if busPattern && !busPatternActive}<div class="policy-budget-alert" role="alert">
						<p>No recorded departures on this date.</p>
						{#if busRecordedDate}<Button
								size="sm"
								variant="outline"
								aria-label="Use recorded service date"
								onclick={() => {
									date = busRecordedDate!;
									prefillServiceHeadway();
								}}>Use {busRecordedDate}</Button
							>{/if}
					</div>{/if}
				<details class="service-options">
					<summary>Stops on this route</summary>
					<ol>
						{#each busPattern?.stopIds ?? [] as stopId, i (`${stopId}:${i}`)}<li>
								{baseline?.stops?.find((stop) => stop.id === stopId)?.name ?? stopId}
							</li>{/each}
					</ol>
				</details>
				{#if busQuoting}<p class="service-progress" role="status">
						<RefreshCw size={14} class="spin" />Updating service costs…
					</p>{/if}
				{#if busPreview}<div class="service-costs">
						<span
							>Proposal total · {serviceIntent === 'add'
								? `${serviceChange.addedDepartures} additional departures`
								: 'updated frequency'}</span
						><strong
							>MVR {formatAmount(busPreview.economics.delta.capital_mvr, true)} upfront</strong
						><small
							>MVR {formatAmount(busPreview.economics.delta.annual_operating_mvr, true)} per year</small
						>
					</div>
					{#each busPreview.budget.reasons as reason, i (i)}<p
							class="policy-budget-alert"
							role="alert"
						>
							{reason}
						</p>{/each}{/if}
				{#if serviceChange.error && busPatternActive}<p class="policy-error" role="alert">
						{serviceChange.error}
					</p>{/if}
				{#if !budgetLimits.allowed}<p class="policy-budget-alert" role="alert">
						{budgetLimits.reason}
					</p>{/if}
				{#if busError && !serviceChange.error}<p class="policy-error" role="alert">{busError}</p>
					<Button size="sm" variant="outline" onclick={() => void previewBusService()}
						>Retry cost check</Button
					>{/if}
				<p class="service-note">
					{serviceIntent === 'add'
						? 'Adds departures on this date using the selected route. Required fleet and running costs are calculated with the existing timetable.'
						: 'Updates waiting times, required fleet and running costs.'}
					Walking distance to a stop stays the same.
				</p>
				<TransportImpact impact={visibleTransportImpact} compact preview />
				<footer>
					<Button
						disabled={!busPatternActive ||
							!budgetLimits.allowed ||
							!!serviceChange.error ||
							!busPreview?.budget.allowed ||
							busQuoting ||
							checkingBudget}
						onclick={confirmBusService}><Check size={15} />Accept service</Button
					><Button variant="outline" onclick={closeBusService}>Cancel</Button>
				</footer>
			{:else if ferryOpen}
				<header>
					<div>
						<span class="eyebrow">CONNECT ISLANDS</span>
						<h3>Add ferry</h3>
					</div>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Close ferry service planner"
						onclick={closeFerry}><X size={16} /></Button
					>
				</header>
				{@render serviceMapPreviewAction()}
				<p>
					From <strong>{islandName}</strong>. The route connects to an existing ferry landing place.
					Click a highlighted landing to change it.
				</p>
				{#if suggestedFerryIncluded}
					<p class="service-progress">
						<Check size={14} />The suggested connection is already in your proposal. Review full
						impact to compare both islands.
					</p>
				{:else if ferrySuggestionRequest}
					<section class="ferry-suggestion" aria-label="Suggested ferry connection">
						<div class="ferry-suggestion-heading">
							<span><Sparkles size={14} />Suggested connection</span>
							{#if ferrySuggestion?.impact}<small><Check size={12} />Impact ready</small>{/if}
						</div>
						{#if ferrySuggestion?.suggestion}
							<strong>{ferrySuggestion.suggestion.title}</strong>
							<p>{ferrySuggestion.suggestion.rationale}</p>
							{#if ferrySuggestion.summary}
								<p class="ferry-suggestion-metrics">
									<span><b>{ferrySuggestion.summary.crossing_minutes} min</b> crossing</span>
									<span
										><b>{ferrySuggestion.summary.departures_each_direction}</b> sailings each way</span
									>
								</p>
								<small class="ferry-suggestion-date">Modeled for {date}</small>
							{/if}
							<Button
								variant="outline"
								disabled={ferrySuggestion.status !== 'ready' || !!suggestedFerryPreview}
								onclick={() => void applyFerrySuggestion()}
								><Ship size={15} />{suggestedFerryPreview
									? 'Suggested connection selected'
									: 'Use suggested connection'}<ArrowRight size={14} /></Button
							>
							<details>
								<summary>Why this island?</summary>
								{#each ferrySuggestion.suggestion.evidence as item, index (index)}
									<p>
										{#if item.url}<a href={item.url} target="_blank" rel="noreferrer"
												>{item.title}</a
											>{:else}<b>{item.title}</b>{/if}
										{#if item.value}<span> · {item.value}</span>{/if}
										{#if item.qualification}<small>{item.qualification}</small>{/if}
									</p>
								{/each}
								{#each ferrySuggestion.suggestion.qualifications as note, index (index)}<p>
										{note}
									</p>{/each}
								<small>Evidence reviewed {ferrySuggestion.suggestion.assessment_date}.</small>
							</details>
						{:else if ferrySuggestionError}
							<p role="status">Suggested impact could not be prepared.</p>
							<button class="ferry-suggestion-retry" onclick={() => (ferrySuggestionRetry += 1)}
								>Retry suggestion</button
							>
						{:else if ferrySuggestion?.status === 'evidence_needed'}
							<p>{ferrySuggestion.reasons.join(' ')}</p>
						{:else}
							<p class="service-progress" role="status">
								<RefreshCw size={14} class={ferrySuggestionLoading ? 'spin' : ''} />Preparing impact
								for this proposal…
							</p>
						{/if}
					</section>
				{/if}
				{#if ferryLoading}<p class="service-progress" role="status">
						<RefreshCw size={14} class="spin" />Finding verified landing places…
					</p>{/if}
				{#if connection?.terminals.origin.length}<Label for="ferry-origin-terminal"
						>Departure landing</Label
					><select
						id="ferry-origin-terminal"
						bind:value={ferryOriginTerminal}
						onchange={(event) => {
							ferryOriginTerminal = event.currentTarget.value;
							const terminal = connection?.terminals.origin.find(
								(item) => item.id === ferryOriginTerminal
							);
							if (terminal) {
								serviceAnchor = terminal.coordinates;
								onFocus(terminal.coordinates);
							}
						}}
						>{#each connection.terminals.origin as terminal (terminal.id)}<option
								value={terminal.id}>{terminal.name}</option
							>{/each}</select
					>{:else if connection}<p class="policy-budget-alert">
						A confirmed ferry landing place is unavailable here. Choose another origin island before
						proposing a service.
					</p>
					<Button variant="outline" onclick={() => onPickFerryOrigin(ferryDestination, date)}
						>Choose origin on map</Button
					>{/if}
				<div class="service-label-row">
					<Label for="ferry-island-search">Destination island</Label><button
						onclick={pickFerryDestination}><MapPin size={13} />Choose on map</button
					>
				</div>
				{#if ferryDestination && !ferryChoosingDestination}<button
						class="service-destination"
						onclick={() => (ferryChoosingDestination = true)}
						><Ship size={16} /><strong>{ferryDestinationName}</strong><span>Change</span></button
					>{:else}<Input
						id="ferry-island-search"
						placeholder="Find a destination island"
						bind:value={ferrySearch}
					/>
					<div class="service-destinations" aria-label="Destination islands">
						{#each ferryIslands as island (island.island_id)}<button
								onclick={() => chooseFerryDestination(island.island_id)}
								><span>{island.name}<small>{island.atoll}</small></span><ArrowRight
									size={14}
								/></button
							>{/each}
					</div>{/if}
				{#if connection?.terminals.destination.length}<Label for="ferry-destination-terminal"
						>Arrival landing</Label
					><select id="ferry-destination-terminal" bind:value={ferryDestinationTerminal}
						>{#each connection.terminals.destination as terminal (terminal.id)}<option
								value={terminal.id}>{terminal.name}</option
							>{/each}</select
					>{/if}
				{#if ferryDestination}<div class="service-field-row">
						<div>
							<Label for="ferry-headway">A ferry every · min</Label><Input
								id="ferry-headway"
								type="number"
								min="15"
								max="720"
								step="15"
								bind:value={ferryHeadway}
							/>
						</div>
						<div>
							<Label for="ferry-date">Service date</Label><Input
								id="ferry-date"
								type="date"
								bind:value={date}
							/>
						</div>
					</div>
					<details class="service-options">
						<summary>Operating hours and sailing speed</summary>
						<div class="service-field-row">
							<div>
								<Label for="ferry-first">First departure</Label><Input
									id="ferry-first"
									type="time"
									bind:value={ferryStart}
								/>
							</div>
							<div>
								<Label for="ferry-last">Finish service by</Label><Input
									id="ferry-last"
									type="time"
									bind:value={ferryEnd}
								/>
							</div>
						</div>
						<Label for="ferry-speed">Assumed speed · km/h</Label><Input
							id="ferry-speed"
							type="number"
							min="10"
							max="60"
							bind:value={ferrySpeed}
						/>
					</details>{/if}
				{#if ferryPreviewing}<p class="service-progress" role="status">
						<RefreshCw size={14} class="spin" />Drawing return crossings and checking costs…
					</p>{/if}
				{#if ferryDestination && !ferryInput.payload}<p class="policy-budget-alert" role="alert">
						{ferryInput.error}
					</p>{/if}
				{#if ferryError}<p class="policy-error" role="alert">{ferryError}</p>
					<Button variant="outline" size="sm" onclick={() => void previewFerry()}
						>Retry preview</Button
					>{/if}
				{#if ferryPreview?.summary}{@const summary = ferryPreview.summary}
					<div class="service-metrics">
						<span><b>{Math.round(summary.crossing_minutes)} min</b>sailing estimate</span><span
							><b>{summary.departures_each_direction}</b>trips each way</span
						><span><b>MVR 0</b>port construction</span>
					</div>
					<details class="service-options">
						<summary>Route evidence and assumptions</summary>
						<p>{summary.distance_km.toFixed(2)} km each way. {summary.qualification}</p>
					</details>{/if}
				{#if ferryPreview?.quote}<div class="service-costs">
						<span>Proposal total with this ferry service</span><strong
							>MVR {formatAmount(ferryPreview.quote.economics.delta.capital_mvr, true)} upfront</strong
						><small
							>MVR {formatAmount(ferryPreview.quote.economics.delta.annual_operating_mvr, true)} per year</small
						>
					</div>
					{#if !ferryPreview.quote.budget.allowed}<p class="policy-budget-alert" role="alert">
							{ferryPreview.quote.budget.reasons.join(' ')}
						</p>{/if}{/if}
				{#each ferryPreview?.reasons ?? [] as reason, i (i)}<p class="service-note">
						{reason}
					</p>{/each}
				{#if !budgetLimits.allowed}<p class="policy-budget-alert" role="alert">
						{budgetLimits.reason}
					</p>{/if}
				<TransportImpact impact={visibleTransportImpact} compact preview />
				<IslandProposalImpacts
					impacts={suggestedFerryPreview?.impact?.island_impacts}
					compact
					{goal}
				/>
				<footer>
					{#if onSeaImpact}<Button
							variant="outline"
							disabled={!ferryPreview?.operations.length}
							onclick={onSeaImpact}>View sea impact</Button
						>{/if}
					<Button disabled={!ferryAllowed} onclick={confirmFerry}
						><Check size={15} />Accept ferry service</Button
					><Button variant="outline" onclick={closeFerry}>Cancel</Button>
				</footer>
				<small
					>Uses existing landing places, subject to suitability review. No new port is built.
					Timetable, costs and connectivity enter the proposal together.</small
				>
			{/if}
			<div class="service-budget-line">
				<span
					>Budgets: MVR {formatAmount(Number(capitalBudget), true)} upfront / {formatAmount(
						Number(annualBudget),
						true
					)} yearly</span
				><button onclick={adjustBudget}>Edit budgets</button>
			</div>
		{/if}
	</div>
{/snippet}

{#snippet mapControlsContent()}
	<div class="policy-coverage-controls">
		{#if operations.length || comparisonPreview}<div class="proposal-map-metric">
				<label for="map-comparison-goal">Access to</label>
				<select
					id="map-comparison-goal"
					aria-label="Access shown on map"
					value={goal}
					onchange={(event) => setGoal(event.currentTarget.value as typeof goal)}
				>
					<option value="transport">Public transport</option>
					<option value="healthcare">Healthcare</option>
					<option value="education">Education</option>
				</select>
				<span>within {comparisonTarget} min</span>
			</div>{/if}
		<div class="policy-lens-bar" aria-label="Service coverage map">
			{#if operations.length || comparisonPreview}
				{@render comparisonViews()}
			{:else}<span><Layers size={15} />Service gaps</span>{/if}
			{#each operations.length || comparisonPreview ? [] : coverageLenses as option (option.id)}
				<button
					class="coverage-lens-option"
					class:active={lens === option.id && !impact.features.length}
					aria-pressed={lens === option.id && !impact.features.length}
					onclick={() => selectLens(option.id)}>{option.label}</button
				>
			{/each}
			{#if !operations.length && !comparisonPreview}<select
					class="compact-coverage-lens"
					aria-label="Service coverage"
					value={lens}
					onchange={(event) => selectLens(event.currentTarget.value as PolicyLens)}
				>
					{#each coverageLenses as option (option.id)}<option value={option.id}
							>{option.label}</option
						>{/each}
				</select>{/if}
		</div>
		{#if scopeError || nearbyGapError}<p class="local-map-status" role="alert">
				{scopeError ? 'Island journeys unavailable.' : 'Nearby journeys unavailable.'}
				<button
					onclick={() => {
						if (scopeError) retryScope();
						if (nearbyGapError) nearbyGapVersion += 1;
					}}>Retry analysis</button
				>
			</p>
		{:else if loading || nearbyGapLoading}<p class="local-map-status" role="status">
				<RefreshCw size={12} class="spin" />{nearbyGapLoading
					? 'Preparing capital-area map and analysis…'
					: 'Loading neighborhood journeys…'}
			</p>
		{:else if islandId && baseline && !gapCells.features.length}<p
				class="local-map-status"
				role="status"
			>
				Local journey estimates are unavailable for this island. Transport services remain visible.
			</p>
		{:else if islandId && evidence.approximate && (opened || operations.length)}<p
				class="local-map-status"
			>
				Approximate resident distribution · inspect a tile for its evidence.
			</p>{/if}
		{#if impact.features.length && (previewCalculating || (!comparisonPreview && stale))}
			<p class="proposal-map-result" role="status">Updating access · previous result shown</p>
		{:else if impact.features.length && comparisonEvaluation}
			<p class="proposal-map-result" aria-live="polite">
				{#if comparisonPreview}<span>Preview · </span>{/if}
				{#if comparisonEvaluation.summary.gained_residents === null}
					Access gain needs more evidence
				{:else if comparisonEvaluation.summary.gained_residents > 0}
					+{formatAmount(comparisonEvaluation.summary.gained_residents)} residents within target
				{:else if comparisonUnchanged}
					{!comparisonHasJourneys
						? 'Access change unavailable · no paired journeys'
						: comparisonAssumptions?.goal === 'transport'
							? 'Walking access unchanged'
							: 'Journey times unchanged · no access gain'}
				{:else}No additional residents within target{/if}
				{#if Number(comparisonEvaluation.summary.unknown_residents) > 0}
					<span> · Some areas lack routing evidence</span>
				{/if}
			</p>
		{/if}
		{#if transportBenefitHeadline && !calculating && !previewCalculating && (!stale || pending || ferryOpen || busOpen)}
			<p class="proposal-transport-result" aria-live="polite">
				{transportBenefitHeadline}
				<button onclick={() => open('proposal')}>Service details <ArrowRight size={12} /></button>
			</p>
		{/if}
	</div>
{/snippet}

{#if active && !serviceEditor && !opened}
	<div
		class="policy-map-controls"
		in:scoreDockMotion={{ direction: 'in' }}
		out:scoreDockMotion={{ direction: 'out' }}
	>
		{#if !opened}<button
				class="policy-inspect-trigger"
				aria-label={`${islandName} access index ${overviewScore?.value == null ? 'unavailable' : `${overviewScore.value} out of 100`}.${overviewScore?.label ? ` ${overviewScore.label}.` : ''} Why this score`}
				aria-expanded="false"
				aria-controls="island-score-details"
				data-testid="island-score-toggle"
				onclick={() => open('needs')}
			>
				<div class="score-dock-value" data-testid="island-score-value">
					{#key islandId}<AccessScore
							value={overviewScore?.value ?? null}
							label={overviewScore?.label}
							loading={profileLoading}
						/>{/key}
				</div>
				<div class="score-dock-heading">
					<span>ISLAND ACCESS INDEX</span><strong>{islandName}</strong>
				</div>
				<div class="score-dock-meta">
					<span
						>{profileLoading
							? 'Loading assessment…'
							: profileError
								? 'Assessment unavailable'
								: (overviewScore?.label ?? 'Not assessed')}</span
					><span>Why this score <ChevronUp size={12} class="score-dock-chevron" /></span>
				</div>
			</button>{/if}
	</div>
{/if}
{#if active}
	{#if opened}<section
			id="island-score-details"
			class="policy-map-panel"
			class:island-overview-panel={section === 'needs'}
			use:resizable={{
				key: section === 'needs' ? 'map-island-overview' : 'map-proposal',
				minWidth: 360,
				minHeight: section === 'needs' ? Math.min(460, overviewMaxHeight) : 460,
				maxHeight: section === 'needs' ? overviewMaxHeight : undefined,
				maxWidth: 640,
				edges:
					section === 'needs' ? ['left', 'top', 'top-left'] : ['left', 'bottom', 'bottom-left'],
				anchor: section === 'needs' ? 'bottom-right' : 'top-right'
			}}
			use:mapPanelLayout
			in:overviewPanelMotion={{ direction: 'in' }}
			out:overviewPanelMotion={{ direction: 'out' }}
			class:placing={(!!pending || !!armedKind) && !budgetEditing}
			aria-label="Island needs and proposal"
			data-policy-section={section}
		>
			<header>
				<h2 tabindex="-1" title={islandName}>{islandName}</h2>
				<Button
					variant="ghost"
					size="icon-sm"
					class="policy-panel-close"
					aria-label="Close island planning panel"
					title={section === 'needs' ? 'Close island overview' : 'Close proposal'}
					onclick={() => (section === 'needs' ? void collapseOverview() : close())}
					><X size={18} /></Button
				>
			</header>
			{#if islandId}<div
					class="policy-panel-tabs"
					use:animatedSelection={{ selector: 'button.active' }}
				>
					<button
						class:active={section === 'needs'}
						aria-label="Island overview"
						aria-pressed={section === 'needs'}
						onclick={() => {
							section = 'needs';
						}}>Island</button
					><button
						class:active={section === 'proposal'}
						aria-pressed={section === 'proposal'}
						onclick={() => {
							section = 'proposal';
						}}
						>Your proposal {#if operations.length}<span>{draftItems.length}</span>{/if}</button
					>
				</div>{/if}
			<div class="policy-panel-scroll">
				{#if restorationWarning}<p class="policy-error" role="alert">{restorationWarning}</p>{/if}
				{#if dataError}<p class="policy-error" role="alert">
						{dataError}<Button variant="link" onclick={() => void loadNational()}
							>Reload data</Button
						>
					</p>{/if}
				{#if loading || !national}<p class="policy-working" role="status">
						<RefreshCw size={15} class="spin" />Loading island data…
					</p>{/if}
				{#if nearbyGapLoading}<p class="policy-working" role="status">
						<RefreshCw size={15} class="spin" />Preparing Malé, Hulhumalé and Hulhulé…
					</p>{/if}
				{#if nearbyGapError}<p class="policy-error" role="alert">
						Nearby neighborhood journeys are unavailable. {nearbyGapError}<Button
							variant="link"
							onclick={() => (nearbyGapVersion += 1)}>Retry nearby journeys</Button
						>
					</p>{/if}
				{#if boundaryError}<p class="policy-error" role="alert">
						{boundaryError}<Button variant="link" onclick={onRetryBoundary}
							>Retry map details</Button
						>
					</p>{/if}
				{#if error}<p class="policy-error" role="alert">
						{error}{#if scopeError}<Button variant="link" onclick={retryScope}
								>Reload island data</Button
							>{/if}
					</p>{/if}
				{#if section === 'needs'}
					<IslandOverview
						profile={profile?.island.id === islandId ? profile : null}
						loading={profileLoading}
						error={profileError}
						onRetry={onRetryProfile}
						connectivity={islandConnection}
						connectivityLoading={overviewConnectionLoading}
						connectivityDate={date}
					/>
					{#if overviewConnectionError}<p class="overview-connection-status" role="status">
							{overviewConnectionError}
							<button onclick={() => (overviewConnectionVersion += 1)}>Retry connections</button>
						</p>{/if}
					{#if selectedExplanation && impact.features.length}<div
							class="policy-selected-cell"
							aria-label="Selected neighbourhood impact"
							data-cell-id={String(cell?.id ?? '')}
						>
							<strong>{selectedExplanation.title}</strong><span>{selectedExplanation.summary}</span>
							{#each [{ key: 'before', label: 'Without proposal' }, { key: 'after', label: 'With proposal' }] as journey (journey.key)}
								<p>
									{journey.label}<b
										>{typeof selectedImpactCell?.[journey.key] === 'number' &&
										Number.isFinite(selectedImpactCell[journey.key])
											? `${Math.round(Number(selectedImpactCell[journey.key]))} min`
											: selectedImpactCell?.display_grid
												? 'Incomplete evidence'
												: 'No routed access'}</b
									>
								</p>
							{/each}
							<details class="policy-cell-evidence">
								<summary>Journey details</summary>
								{#each selectedExplanation.reasons as reason, i (i)}<p>{reason}</p>{/each}
								<p>{selectedExplanation.qualification}</p>
							</details>
						</div>{:else if cell?.origin_id && !impact.features.length}<div
							class="policy-selected-cell"
							data-cell-id={String(cell.origin_id)}
						>
							<strong>Selected neighbourhood</strong><span
								>{formatAmount(cell.population)} modeled residents</span
							><small
								>{selectedEvidence.approximate
									? 'Approximate resident distribution'
									: 'Modeled resident distribution'}</small
							>{#each [{ key: 'transport', label: 'Walk to a stop' }, { key: 'health', label: 'Healthcare journey' }, { key: 'education', label: 'Education journey' }] as metric (metric.key)}<p
								>
									{metric.label}<b
										>{typeof cell[`${metric.key}_minutes`] === 'number'
											? `${Math.round(Number(cell[`${metric.key}_minutes`]))} min`
											: 'No routed evidence'}</b
									>
								</p>{/each}
							{#if cell.display_grid}<details class="policy-cell-evidence">
									<summary>Journey details</summary>
									<p>Journey times are resident-weighted averages for this tile.</p>
									{#if selectedEvidence.population}<p>{selectedEvidence.population}</p>{/if}
									{#if selectedEvidence.distribution}<p>{selectedEvidence.distribution}</p>{/if}
									{#if selectedEvidence.qualification}<p>{selectedEvidence.qualification}</p>{/if}
									<p>{selectedEvidence.timetable}</p>
									{#each selectedEvidence.warnings as warning (warning)}<p>{warning}</p>{/each}
								</details>{/if}
						</div>{:else if cell?.impact && impact.features.length}<div
							class="policy-selected-cell"
							aria-label="Selected neighbourhood impact"
							data-cell-id={String(cell.id ?? '')}
						>
							<strong>Access change here</strong><span
								>{formatAmount(cell.population)} modeled residents · {goalLabel}</span
							>
							<p>
								{cell.display_grid ? 'Average current journey' : 'Current journey'}<b
									>{cell.before == null
										? cell.display_grid
											? 'Incomplete evidence'
											: 'No routed access'
										: `${Math.round(Number(cell.before))} min`}</b
								>
							</p>
							<p>
								{cell.display_grid ? 'Average with your proposal' : 'With your proposal'}<b
									>{cell.after == null
										? cell.display_grid
											? 'Incomplete evidence'
											: 'No routed access'
										: `${Math.round(Number(cell.after))} min`}</b
								>
							</p>
							<details class="policy-cell-evidence">
								<summary>Journey details</summary>
								<p>
									{String(cell.impact).replaceAll('_', ' ')} · {cell.display_grid
										? 'resident-weighted tile; overall totals use the original model'
										: 'illustrative cell at a modeled origin'}
								</p>
							</details>
						</div>{/if}
				{:else}
					<div
						class="proposal-paths"
						aria-label="How to build your proposal"
						data-compose-mode={composeMode}
					>
						<button
							class:active={composeMode === 'manual'}
							aria-pressed={composeMode === 'manual'}
							onclick={() => chooseComposeMode('manual')}
						>
							<Plus size={17} /><span
								><strong>Add an improvement</strong><small
									>Choose it, then place it on the map</small
								></span
							>
						</button>
						<button
							class:active={composeMode === 'budget'}
							aria-pressed={composeMode === 'budget'}
							onclick={() => chooseComposeMode('budget')}
						>
							<Sparkles size={17} /><span
								><strong>Find options within my budget</strong><small
									>Compare a suggested draft first</small
								></span
							>
						</button>
					</div>
					{#if composeMode === 'manual' && !budgetEditing}
						<div class="proposal-budget-overview">
							<span
								>Budget limits<small
									>MVR {Number.isFinite(budgetNumber(capitalBudget))
										? formatAmount(budgetNumber(capitalBudget), true)
										: '—'} upfront · {Number.isFinite(budgetNumber(annualBudget))
										? formatAmount(budgetNumber(annualBudget), true)
										: '—'}/year</small
								></span
							>
							<Button
								variant="ghost"
								size="sm"
								aria-label="Edit budget limits"
								onclick={adjustBudget}>Edit</Button
							>
						</div>
					{/if}
					{#if budgetEditing || composeMode === 'budget'}
						<section class="proposal-budget-editor" aria-label="Proposal budget limits">
							<div class="proposal-budget-editor-heading">
								<strong>Set your budget limits</strong>{#if composeMode === 'manual'}<Button
										variant="ghost"
										size="sm"
										onclick={() => (budgetEditing = false)}>Done</Button
									>{/if}
							</div>
							<div class="policy-budget-grid">
								<div>
									<Label for="map-capital-budget">Capital budget · MVR</Label><Input
										id="map-capital-budget"
										type="number"
										min="0"
										step="100000"
										bind:value={capitalBudget}
									/>
								</div>
								<div>
									<Label for="map-annual-budget">Annual running budget · MVR</Label><Input
										id="map-annual-budget"
										type="number"
										min="0"
										step="100000"
										bind:value={annualBudget}
									/>
								</div>
							</div>
							<p>{TRANSPORT_PILOT_BUDGET_NOTE}</p>
							<p>Both limits are checked before a change can be added.</p>
						</section>
					{/if}
					{#if !budgetDecision.allowed && budgetDecision.known}<p
							class="policy-budget-alert"
							role="alert"
						>
							{budgetDecision.reason}
						</p>{/if}
					{#if checkingBudget}<p class="policy-budget-check" role="status">
							Checking the cost against both budgets…
						</p>{/if}
					{#if composeMode === 'budget'}
						<div class="policy-priorities">
							<span>Priorities</span>
							<div class="policy-priority-options">
								{#each ['transport', 'health', 'education'] as domain (domain)}<button
										class:active={priorities.includes(domain as PolicyDomain)}
										aria-pressed={priorities.includes(domain as PolicyDomain)}
										onclick={() => togglePriority(domain as PolicyDomain)}
										>{domain === 'health'
											? 'Health'
											: domain === 'education'
												? 'Education'
												: 'Transport'}</button
									>{/each}
							</div>
						</div>
						{#if !priorities.length}<p class="policy-qualification" role="status">
								Choose at least one priority to find a suitable draft.
							</p>{/if}
						<Button
							variant="outline"
							class="policy-primary"
							disabled={!supported ||
								loading ||
								suggesting ||
								checkingBudget ||
								!budgetDecision.allowed ||
								!priorities.length ||
								operations.length >= 90}
							onclick={suggest}
							><Sparkles size={16} />{suggesting
								? 'Finding a suitable draft…'
								: 'Suggest investments within my budget'}</Button
						>
						{#if !supported && current}<p class="policy-qualification">
								{localConstructionReason}
							</p>{/if}
						{#if suggested}<div
								class="policy-suggestion"
								data-suggestion-count={suggested.selected.length}
							>
								<strong
									>{suggested.selected.length
										? 'Suggested draft · shown on the map'
										: 'No eligible package within these limits'}</strong
								>{#each suggested.selected as item (item.id)}<button
										onclick={() => onFocus(item.coordinates)}
										><MapPin size={15} /><span
											>{item.title}<small
												>MVR {formatAmount(item.capital_mvr, true)} capital · {formatAmount(
													item.annual_operating_mvr,
													true
												)}/year</small
											></span
										></button
									>{/each}{#each suggested.warnings as warning, i (i)}<p>
										{warning}
									</p>{/each}{#if suggested.selected.length}<div>
										<Button size="sm" onclick={acceptSuggestions}
											><Check size={14} />Use this draft</Button
										><Button size="sm" variant="ghost" onclick={() => (suggested = null)}
											>Dismiss</Button
										>
									</div>{/if}
							</div>{/if}
					{/if}
					{#if composeMode === 'manual'}
						{#if !supported && current}<p class="policy-qualification">
								{localConstructionReason}
							</p>{/if}
						<div class="policy-place-heading">
							<h3>What would you like to improve?</h3>
							<small
								>Choose an item and click the map, or drag its icon. Confirm above the preview on
								the map.</small
							>
						</div>
						<div class="policy-palette">
							{#each [{ kind: 'add_stop', label: 'Add bus stop', icon: Signpost }, { kind: 'add_school', label: 'School', icon: GraduationCap }, { kind: 'add_hospital', label: 'Hospital', icon: Hospital }] as item (item.kind)}<button
									draggable={!!baseline &&
										supported &&
										!loading &&
										!checkingBudget &&
										operations.length < 100}
									disabled={!baseline ||
										!supported ||
										loading ||
										checkingBudget ||
										operations.length >= 100}
									ondragstart={(event) => {
										cancelPending();
										closeFerry();
										closeBusService();
										armedKind = item.kind as PlacementKind;
										pendingId = `proposal:${item.kind}:${crypto.randomUUID()}`;
										setGoal(
											item.kind === 'add_stop'
												? 'transport'
												: item.kind === 'add_school'
													? 'education'
													: 'healthcare'
										);
										onPickKind(item.kind as PlacementKind);
										event.dataTransfer?.setData('application/x-policy-placement', item.kind);
										if (event.dataTransfer) {
											event.dataTransfer.effectAllowed = 'copy';
											const icon =
												event.currentTarget.querySelector<HTMLElement>('.palette-drag-icon');
											if (icon) event.dataTransfer.setDragImage(icon, 22, 22);
										}
									}}
									ondragend={() => {
										armedKind = null;
										onPickKind(null);
									}}
									onclick={() => begin(item.kind as PlacementKind)}
									><span class="palette-drag-icon" data-placement-icon={item.kind}
										><item.icon size={24} /></span
									><span>{item.label}</span><Plus size={12} /></button
								>{/each}
						</div>
						<h3 class="policy-palette-heading">Add transport</h3>
						<div class="policy-service-palette" aria-label="Add transport services">
							<button
								class="policy-service-tile"
								draggable={supported &&
									!!busPatterns.length &&
									!loading &&
									!checkingBudget &&
									operations.length < 100}
								ondragstart={(event) => serviceDrag(event, 'bus')}
								aria-label="Add bus"
								onclick={() => beginBusService(undefined, 'add')}
								disabled={!supported ||
									!busPatterns.length ||
									loading ||
									checkingBudget ||
									operations.length >= 100}
							>
								<span data-service-icon><BusFront size={24} /></span><span
									><strong>Add bus</strong><small>Extra departures on a route</small></span
								></button
							>
							<button
								class="policy-service-tile"
								draggable={!loading && !checkingBudget && operations.length < 97}
								ondragstart={(event) => serviceDrag(event, 'ferry')}
								aria-label="Add ferry"
								onclick={() => beginFerry()}
								disabled={loading || checkingBudget || operations.length >= 97}
							>
								<span data-service-icon><Ship size={24} /></span><span
									><strong>Add ferry</strong><small>New island connection</small></span
								></button
							>
						</div>
						<h3 class="policy-palette-heading">Improve existing lines</h3>
						<div
							class="policy-service-palette improve-lines"
							aria-label="Improve existing transport lines"
						>
							<button
								class="policy-service-tile"
								onclick={() => beginBusService()}
								aria-label="Improve bus line"
								disabled={!supported ||
									!busPatterns.length ||
									loading ||
									checkingBudget ||
									operations.length >= 100}
							>
								<span data-service-icon><Route size={24} /></span><span
									><strong>Improve bus line</strong><small>Change its frequency</small></span
								>
							</button>
							<button
								class="policy-service-tile"
								onclick={() => beginBusService(undefined, 'improve', 'ferry')}
								aria-label="Improve ferry line"
								aria-describedby={!ferryPatterns.length ? 'ferry-line-evidence' : undefined}
								disabled={!ferryPatterns.length ||
									loading ||
									checkingBudget ||
									operations.length >= 100}
							>
								<span data-service-icon><Waypoints size={24} /></span><span
									><strong>Improve ferry line</strong><small>Change its frequency</small></span
								>
							</button>
						</div>
						{#if !ferryPatterns.length && baseline}<p
								id="ferry-line-evidence"
								class="policy-evidence-note transport-unavailable"
							>
								No existing ferry timetable is available here. Use Add ferry to plan a new
								connection.
							</p>{/if}
						{#if pending}<p class="policy-placement-hint" role="status">
								Your {pendingDecision?.label.toLowerCase()} is on the map. Drag its pin to adjust, then
								confirm or cancel above it.
							</p>{/if}
					{/if}
					{#if operations.length}<div class="policy-draft-heading">
							<h3>On your map · {draftItems.length} changes</h3>
						</div>
						<ol class="policy-operation-list">
							{#each draftItems as { operation, index: i }, rowNumber (i)}<li>
									<button onclick={() => focusOperation(i)}
										><span>{operation.metadata?.ui_ferry_summary ? '↔' : rowNumber + 1}</span
										><strong
											>{operation.metadata?.ui_ferry_summary
												? String(
														(
															operation.metadata.ui_ferry_summary as NonNullable<
																FerryDraft['summary']
															>
														).name
													)
												: operationName(operation)}</strong
										></button
									><Button
										variant="ghost"
										size="icon-sm"
										aria-label={`Remove ${operationName(operation)}${operation.metadata?.ui_package ? ' package' : ''}`}
										onclick={() => removeOperation(i)}><Trash2 size={14} /></Button
									>
								</li>{/each}
						</ol>{/if}
					<TransportImpact
						impact={visibleTransportImpact}
						compact
						preview={!!pending || ferryOpen || busOpen}
						pending={calculating || previewCalculating}
						stale={stale && !pending && !ferryOpen && !busOpen}
						context={scopedKey}
					/>
					{#if operations.length || pending || ferryOpen || busOpen}
						<div class="policy-forecast-goal">
							<Label for="map-goal">Compare residents' access to</Label><select
								id="map-goal"
								value={goal}
								onchange={(event) => setGoal(event.currentTarget.value as typeof goal)}
								><option value="transport">Public transport · walking access</option><option
									value="healthcare">Healthcare</option
								><option value="education">Education</option></select
							><small
								>Public transport measures walking to a bus stop or ferry landing place. Waiting
								times and island connections appear in the service benefits above.</small
							>
						</div>
					{/if}
					<details class="policy-evidence-note proposal-details">
						<summary>Proposal details</summary>
						<div class="policy-field">
							<Label for="map-proposal-title">Proposal name</Label><Input
								id="map-proposal-title"
								bind:value={title}
								maxlength={160}
							/>
						</div>
						<p>{savedMessage || 'Your draft is saved on this device as you make changes.'}</p>
					</details>
					<details class="policy-evidence-note">
						<summary>Travel target, date & assumptions</summary>
						<div class="policy-budget-grid">
							<div>
								<Label for="map-target">Travel target · minutes</Label><Input
									id="map-target"
									type="number"
									min="1"
									max="180"
									bind:value={targetMinutes}
								/>
							</div>
							<div>
								<Label for="map-departure">Departure time</Label><Input
									id="map-departure"
									type="time"
									bind:value={departure}
								/>
							</div>
						</div>
						<Label for="map-service-date">Service date</Label><Input
							id="map-service-date"
							type="date"
							bind:value={date}
						/>
						<p>
							Uses the walking network and resident estimates for {String(
								request.assumptions.population_year
							)}. Scheduled services use timetables valid for the selected date. Results estimate
							access, not future passenger demand.
						</p>
					</details>
					<details class="policy-evidence-note">
						<summary>Costs, evidence & advanced tools</summary>
						{#if evidence.population}<p>{evidence.population}</p>{/if}
						{#if evidence.distribution}<p>{evidence.distribution}</p>{/if}
						{#if evidence.qualification}<p>{evidence.qualification}</p>{/if}
						<p>{evidence.timetable}</p>
						{#if baseline?.coverage}<p>
								{formatAmount(baseline.coverage.resident_origins)} resident areas · {formatAmount(
									baseline.coverage.walking_edges
								)} walking links · {formatAmount(baseline.coverage.healthcare_destinations)} health destinations
								· {formatAmount(baseline.coverage.education_destinations)} education destinations
							</p>{/if}
						{#each evidence.warnings as warning (warning)}<p>{warning}</p>{/each}
						<p>
							Costs are editable planning illustrations. A bus stop alone adds no service. Draft
							siting, land rights, staffing and recurring funding require review.
						</p>
						{#if onAdvanced}<Button variant="ghost" size="sm" onclick={onAdvanced}
								>Advanced service & fleet tools <ArrowRight size={14} /></Button
							>{/if}
					</details>
				{/if}
			</div>
			{#if section === 'needs'}<div class="island-overview-actions">
					<Button class="policy-primary" onclick={() => (section = 'proposal')}
						><Sparkles size={16} />{operations.length
							? 'Edit proposal'
							: 'Build proposal'}<ArrowRight size={16} /></Button
					>
					<Button
						variant="ghost"
						class="policy-secondary"
						onclick={() => {
							close();
							onDetails();
						}}>Island details</Button
					>
				</div>{/if}
			{#if baseline && (section === 'proposal' || operations.length || pending)}<footer>
					<ProposalCostStrip
						compact
						embedded
						economics={visibleEconomics}
						capitalBudget={Number.isFinite(budgetNumber(capitalBudget))
							? budgetNumber(capitalBudget)
							: null}
						annualBudget={Number.isFinite(budgetNumber(annualBudget))
							? budgetNumber(annualBudget)
							: null}
						pending={calculating || previewCalculating}
						stale={stale && !pending && !ferryOpen && !busOpen}
						transportImpact={visibleTransportImpact}
						{resultTime}
						context={scopedKey}
						operationCount={draftItems.length}
						preview={!!pending || ferryOpen || busOpen}
						previewChecking={(!!pending && !quotedPlacement) ||
							(ferryOpen && !ferryPreview?.quote) ||
							(busOpen && !busPreview)}
						gainedResidents={pending
							? pendingEvaluation?.summary.gained_residents
							: ferryOpen || busOpen
								? null
								: evaluation?.summary.gained_residents}
						onEditBudget={adjustBudget}
						onUndo={undo}
						canUndo={!!history.length}
						onReview={() => {
							review = true;
							if (!evaluation || stale) void evaluate();
						}}
					/>
				</footer>{/if}
		</section>{/if}
	{#if !opened && hasDraftContext && !serviceEditor && !pending}<div
			class="proposal-floating-budget"
			class:placement-preview={!!pending || !!armedKind}
		>
			<ProposalCostStrip
				compact
				economics={visibleEconomics}
				capitalBudget={Number.isFinite(budgetNumber(capitalBudget))
					? budgetNumber(capitalBudget)
					: null}
				annualBudget={Number.isFinite(budgetNumber(annualBudget))
					? budgetNumber(annualBudget)
					: null}
				pending={calculating || previewCalculating}
				stale={stale && !pending && !ferryOpen && !busOpen}
				transportImpact={visibleTransportImpact}
				{resultTime}
				context={scopedKey}
				operationCount={draftItems.length}
				preview={!!pending || ferryOpen || busOpen}
				previewChecking={(!!pending && !quotedPlacement) ||
					(ferryOpen && !ferryPreview?.quote) ||
					(busOpen && !busPreview)}
				gainedResidents={pending
					? pendingEvaluation?.summary.gained_residents
					: ferryOpen || busOpen
						? null
						: evaluation?.summary.gained_residents}
				onEditBudget={adjustBudget}
				onUndo={undo}
				canUndo={!!history.length}
				onReview={() => {
					review = true;
					if (!evaluation || stale) void evaluate();
				}}
			/>
			<button class="proposal-open-draft" onclick={() => open('proposal')}
				>Edit proposal <ArrowRight size={14} /></button
			>
		</div>{/if}
	{#if armedKind}<div class="proposal-placement-status" role="status">
			<MousePointer2 size={16} /><span
				>{armedKind ? actionMessage : 'Adjust the pin, then confirm on the map'}<small
					>{armedKind
						? 'Click to place · Escape to cancel'
						: 'Your saved proposal changes only after confirmation'}</small
				></span
			><button aria-label="Cancel placement" onclick={cancelPending}><X size={16} /></button>
		</div>
	{:else if actionMessage && !opened && !pending}<div
			class="proposal-action-feedback"
			role="status"
		>
			<Check size={15} /><span>{actionMessage}</span>{#if history.length}<button onclick={undo}
					>Undo</button
				>{/if}<button aria-label="Dismiss proposal update" onclick={() => (actionMessage = '')}
				><X size={14} /></button
			>
		</div>{/if}
	{#if calculating && !hasDraftContext}<div class="policy-recalculating" role="status">
			<RefreshCw size={15} class="spin" /><span
				>Recalculating resident access…<small>Your changes stay on the map.</small></span
			>
		</div>{/if}
	<ProposalForecastReview
		open={review}
		{title}
		{islandName}
		{request}
		{evaluation}
		pending={calculating}
		{stale}
		{error}
		onClose={() => (review = false)}
		onEvaluate={() => void evaluate()}
		onFocusOperation={focusOperation}
	/>
{/if}

<style>
	.policy-service-popover {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 18px;
		color: var(--theme-color-23433d);
		font-size: 12px;
		line-height: 1.5;
	}
	.policy-service-popover > * {
		flex-shrink: 0;
		min-width: 0;
	}
	.policy-service-popover header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.policy-service-popover h3 {
		margin: 3px 0 0;
		font-size: 18px;
		font-weight: 650;
		letter-spacing: -0.4px;
	}
	.policy-service-popover p {
		margin: 0;
	}
	.policy-service-popover small {
		font-size: 11px;
		color: var(--theme-color-62786f);
		line-height: 1.5;
	}
	.policy-service-popover :global(label) {
		font-size: 11px;
		font-weight: 600;
		line-height: 1.4;
		color: var(--theme-color-526c60);
	}
	.policy-service-popover :global(input),
	.policy-service-popover select {
		width: 100%;
		min-height: 36px;
		border: 1px solid var(--theme-color-d6e1da);
		border-radius: 9px;
		background: var(--theme-color-ffffff);
		padding: 8px 10px;
		font-size: 12px;
		box-sizing: border-box;
	}
	.service-field-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.service-field-row > div {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	.service-progress {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--theme-color-087e77);
	}
	.ferry-suggestion {
		display: grid;
		gap: 10px;
		padding: 14px;
		border: 1px solid var(--theme-color-d4e3db);
		border-radius: 12px;
		background: var(--theme-color-eff7f3);
	}
	.ferry-suggestion-heading {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 10px;
		color: var(--theme-color-087e77);
	}
	.ferry-suggestion-heading span,
	.ferry-suggestion-heading small {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		font-weight: 600;
	}
	.ferry-suggestion > strong {
		font-size: 16px;
		line-height: 1.3;
		color: var(--theme-color-234f43);
	}
	.ferry-suggestion p {
		margin: 0;
		font-size: 12px;
		line-height: 1.5;
	}
	.ferry-suggestion .ferry-suggestion-metrics {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 18px;
		color: var(--theme-color-234f43);
	}
	.ferry-suggestion-date {
		margin-top: -7px;
		font-size: 10px;
		color: var(--theme-color-677e72);
	}
	.ferry-suggestion summary,
	.ferry-suggestion-retry {
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
		color: var(--theme-color-087e77);
	}
	.ferry-suggestion details[open] {
		display: grid;
		gap: 10px;
	}
	.ferry-suggestion details small {
		display: block;
		font-size: 11px;
		line-height: 1.5;
		color: var(--theme-color-677e72);
	}
	.ferry-suggestion a {
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.service-options {
		padding: 10px 12px;
		background: var(--theme-color-f5f8f5);
		border-radius: 10px;
	}
	.service-options summary {
		cursor: pointer;
		font-size: 11px;
		font-weight: 600;
	}
	.service-options[open] > :global(:not(summary)) {
		margin-top: 10px;
	}
	.service-options ol {
		padding-left: 18px;
		max-height: 160px;
		overflow: auto;
	}
	.service-metrics {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 10px;
		padding: 12px 0;
		border-block: 1px solid var(--theme-color-e5ece7);
	}
	.service-metrics span {
		font-size: 10px;
		color: var(--theme-color-677e72);
	}
	.service-metrics b {
		display: block;
		font-size: 17px;
		color: var(--theme-color-234f43);
		font-variant-numeric: tabular-nums;
	}
	.service-costs {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 12px;
		background: var(--theme-color-eff6f2);
		border: 1px solid var(--theme-color-d4e5d8);
		border-radius: 10px;
	}
	.service-costs > span {
		font-size: 10px;
		color: var(--theme-color-60786c);
	}
	.service-costs strong {
		font-size: 15px;
	}
	.service-access {
		padding: 10px;
		background: var(--theme-color-eaf8f5);
		border-radius: 9px;
		font-size: 11px;
	}
	.service-note {
		font-size: 11px;
		color: var(--theme-color-62786f);
	}
	.policy-service-popover footer {
		position: sticky;
		bottom: 0;
		z-index: 1;
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		padding: 12px 0;
		border-top: 1px solid var(--theme-color-e4ece6);
		background: var(--theme-color-fffefa);
	}
	.service-preview-map {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-height: 32px;
		color: var(--theme-color-087e77);
		font-size: 11px;
		font-weight: 600;
	}
	.service-preview-map:disabled {
		opacity: 0.45;
	}
	.service-preview-evidence {
		display: none;
	}
	.service-budget-line {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		font-size: 10px;
		color: var(--theme-color-62786f);
	}
	.service-budget-line button {
		flex-shrink: 0;
		color: var(--theme-color-087e77);
		font-weight: 600;
	}
	.policy-service-popover footer :global(button:first-child) {
		flex: 1;
	}
	.service-label-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}
	.service-label-row button {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 10px;
		color: var(--theme-color-087e77);
	}
	.service-destination {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		border: 1px solid var(--theme-color-d4e3db);
		border-radius: 9px;
	}
	.service-destination span {
		margin-left: auto;
		font-size: 11px;
		color: var(--theme-color-087e77);
	}
	.service-destinations {
		max-height: 170px;
		overflow: auto;
		border: 1px solid var(--theme-color-e0e8e2);
		border-radius: 10px;
	}
	.service-destinations button {
		display: flex;
		justify-content: space-between;
		align-items: center;
		width: 100%;
		gap: 8px;
		padding: 9px 12px;
		text-align: left;
	}
	.service-destinations button:hover {
		background: var(--theme-color-eff7f3);
	}
	.service-destinations small {
		display: block;
		font-size: 10px;
	}
	.policy-service-palette {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 8px;
	}
	.policy-palette-heading {
		margin: 0 0 -8px;
		font-size: 11px;
		font-weight: 600;
		color: var(--theme-color-52695b);
	}
	.policy-service-tile {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-width: 0;
		min-height: 82px;
		padding: 10px;
		border: 1px dashed var(--theme-color-bfd2c5);
		border-radius: 12px;
		background: var(--theme-color-f3f8f5);
		text-align: left;
		cursor: grab;
	}
	.improve-lines .policy-service-tile {
		cursor: pointer;
		border-style: solid;
		background: var(--theme-color-fafbf7);
	}
	.improve-lines [data-service-icon] {
		background: var(--theme-color-e5ede6);
		color: var(--theme-color-476c55);
		box-shadow: none;
		border-color: transparent;
	}
	.policy-service-tile:focus-visible {
		outline: 2px solid var(--theme-color-176c61);
		outline-offset: 3px;
	}
	.transport-unavailable {
		margin: -8px 0 0;
		font-size: 10px;
	}
	.policy-service-tile:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.policy-service-tile > span:nth-child(2) {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.policy-service-tile strong {
		font-size: 12px;
	}
	.policy-service-tile small {
		font-size: 11px;
		color: var(--theme-color-6a8073);
	}
	.policy-service-tile [data-service-icon] {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		flex-shrink: 0;
		border-radius: 14px;
		background: var(--theme-color-14776b);
		color: var(--theme-color-ffffff);
		border: 2px solid var(--theme-color-ffffff);
		box-shadow: 0 2px 7px var(--theme-color-174c3320);
	}
	.service-stop-choice {
		display: grid;
		gap: 8px;
		padding: 10px;
		border: 1px solid var(--theme-color-dce6de);
		border-radius: 10px;
		font-size: 11px;
		line-height: 1.5;
		color: var(--theme-color-53695c);
	}
	.service-current-frequency {
		font-size: 11px;
		line-height: 1.5;
		color: var(--theme-color-617568);
	}

	.proposal-floating-budget {
		position: absolute;
		top: calc(148px + var(--map-navigation-offset, 0px));
		right: 18px;
		width: 340px;
		z-index: 6;
		border-radius: 16px;
		background: var(--theme-color-fffffff5);
		box-shadow: 0 10px 35px var(--theme-color-183d3320);
	}
	.proposal-open-draft {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 10px 16px;
		font-size: 11px;
		color: var(--theme-color-22634f);
	}
	.proposal-placement-status,
	.proposal-action-feedback {
		position: absolute;
		top: calc(140px + var(--map-navigation-offset, 0px));
		left: 20px;
		z-index: 6;
		display: flex;
		align-items: center;
		gap: 10px;
		max-width: 340px;
		padding: 12px 14px;
		border: 1px solid var(--theme-color-d7e2dc);
		border-radius: 12px;
		background: var(--theme-color-fffffff5);
		box-shadow: 0 5px 22px var(--theme-color-183d3312);
		font-size: 12px;
	}
	.proposal-placement-status small {
		display: block;
		margin-top: 3px;
		font-size: 10px;
		color: var(--theme-color-617568);
	}
	.proposal-placement-status button,
	.proposal-action-feedback button {
		display: inline-flex;
		padding: 4px;
		border-radius: 5px;
	}
	.proposal-action-feedback button {
		color: var(--theme-color-16735a);
		font-weight: 600;
	}
	.proposal-map-views {
		display: flex;
		gap: 2px;
	}
	.proposal-map-views button {
		padding: 7px 10px;
		border-radius: 7px;
		color: var(--theme-color-53635c);
		font-size: 12px;
	}
	.proposal-map-views button.active {
		background: var(--theme-color-dff0e8);
		color: var(--theme-color-185943);
		font-weight: 650;
	}
	.service-comparison-controls {
		display: grid;
		gap: 6px;
		padding: 10px;
		border: 1px solid var(--theme-color-d9e2dd);
		border-radius: 9px;
		background: var(--theme-color-f7faf7);
	}
	.service-comparison-controls small {
		color: var(--theme-color-617568);
		font-size: 11px;
	}
	.service-comparison-controls .proposal-map-views button {
		flex: 1;
	}
	.proposal-map-metric {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 4px 8px 2px;
		color: var(--theme-color-617568);
		font-size: 11px;
	}
	.proposal-map-metric select {
		min-width: 0;
		padding: 4px 20px 4px 6px;
		border: 1px solid var(--theme-color-d9e2dd);
		border-radius: 6px;
		background: var(--theme-color-f5f8f3);
		color: var(--theme-color-185943);
		font-size: inherit;
	}
	.proposal-map-metric span {
		white-space: nowrap;
	}
	.proposal-map-result {
		margin: 2px 8px 4px;
		color: var(--theme-color-456655);
		font-size: 10px;
	}
	.proposal-transport-result {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px 10px;
		margin: 3px 8px 5px;
		max-width: 420px;
		color: var(--theme-color-165d52);
		font-size: 11px;
		font-weight: 600;
		line-height: 1.5;
	}
	.proposal-transport-result button {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		text-decoration: underline;
		text-underline-offset: 3px;
		font-size: 10px;
		font-weight: 500;
	}
	.policy-evidence-note {
		margin: 10px 0;
		color: var(--theme-color-617568);
		font-size: 11px;
		line-height: 1.6;
	}
	.proposal-map-views button:active,
	.proposal-open-draft:active {
		transform: scale(0.98);
	}
	.proposal-map-views button:disabled {
		opacity: 0.55;
		cursor: wait;
	}
	.policy-map-controls {
		position: absolute;
		right: 20px;
		bottom: 20px;
		z-index: 5;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		width: 330px;
		max-width: calc(100% - 40px);
		padding: 0;
		border: 1px solid var(--theme-color-d7e2dc);
		border-radius: 14px;
		background: var(--theme-color-fffffff5);
		box-shadow: 0 4px 22px var(--theme-color-1a433f12);
		backdrop-filter: blur(10px);
	}
	.policy-inspect-trigger {
		display: grid;
		grid-template-columns: 126px minmax(0, 1fr);
		align-items: center;
		gap: 4px 14px;
		width: 100%;
		min-height: 108px;
		padding: 14px;
		border-radius: 13px;
		text-align: left;
		color: var(--theme-color-293e36);
		cursor: pointer;
		transition: background-color 150ms ease;
	}
	@media (hover: hover) and (pointer: fine) {
		.policy-inspect-trigger:hover {
			background: var(--theme-color-f1f6ef);
		}
	}
	.score-dock-heading {
		display: grid;
		gap: 4px;
		min-width: 0;
		align-self: end;
	}
	.score-dock-heading > span {
		font-size: 8px;
		font-weight: 650;
		letter-spacing: 0.7px;
		line-height: 1.3;
		color: var(--theme-color-6b7b70);
	}
	.score-dock-heading > strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 17px;
		font-weight: 650;
		letter-spacing: -0.4px;
		line-height: 1.2;
	}
	.score-dock-value {
		grid-column: 1;
		grid-row: 1 / 3;
		min-width: 0;
	}
	.score-dock-value :global(.access-score .score-number strong) {
		font-size: 48px;
		line-height: 1;
	}
	.score-dock-value :global(.access-score .score-denominator) {
		font-size: 11px;
	}
	.policy-inspect-trigger :global(.score-dock-chevron) {
		color: var(--theme-color-48665d);
	}
	.score-dock-meta {
		grid-column: 2;
		display: grid;
		align-self: start;
		gap: 7px;
		min-width: 0;
		font-size: 9px;
		line-height: 1.3;
		color: var(--theme-color-6b7b70);
	}
	.score-dock-meta > span:first-child {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.score-dock-meta > span:last-child {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 10px;
		font-weight: 600;
		color: var(--theme-color-245b40);
	}
	.local-map-status {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 5px;
		margin: 3px 8px 5px;
		font-size: 10px;
		line-height: 1.5;
		color: var(--theme-color-62766c);
	}
	.local-map-status button {
		color: var(--theme-color-087e77);
		font-weight: 650;
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.policy-coverage-controls {
		display: grid;
		min-width: 0;
	}
	.policy-coverage-controls .proposal-map-views {
		width: 100%;
	}
	.policy-coverage-controls .proposal-map-views button {
		flex: 1;
	}
	.policy-lens-bar {
		display: flex;
		align-items: center;
		gap: 3px;
		padding: 2px;
		white-space: nowrap;
		justify-content: space-between;
	}
	.policy-lens-bar > span {
		display: flex;
		gap: 6px;
		align-items: center;
		font-size: 11px;
		color: var(--theme-color-66756c);
		padding: 0 8px;
	}
	.policy-lens-bar button {
		font-size: 11px;
		border-radius: 9px;
		min-height: 34px;
		padding: 7px 9px;
		color: var(--theme-color-53635c);
	}
	.policy-lens-bar button.active {
		background: var(--theme-color-dff0e8);
		color: var(--theme-color-185943);
		font-weight: 650;
	}
	.policy-lens-bar select {
		width: 74px;
		padding: 6px;
		border: 1px solid var(--theme-color-d9e2dd);
		border-radius: 7px;
		background: var(--theme-color-f5f8f3);
		color: var(--theme-color-185943);
		font-size: 11px;
	}
	.policy-lens-bar .compact-coverage-lens {
		display: none;
	}
	.policy-map-panel {
		position: absolute;
		right: 18px;
		top: calc(76px + var(--map-navigation-offset, 0px));
		bottom: 20px;
		width: var(--policy-panel-default-width, 370px);
		z-index: 7;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--theme-color-dae3dc);
		border-radius: 17px;
		background: var(--theme-color-fffffff9);
		box-shadow: 0 12px 38px var(--theme-color-1c3e3722);
		overflow: hidden;
	}
	.island-overview-panel {
		--policy-panel-default-width: 520px;
		top: auto;
		right: 20px;
		height: min(780px, calc(100% - var(--map-toolbar-bottom, 76px) - 24px));
		background: var(--theme-color-ffffff);
	}
	.island-overview-panel
		> :is(header, .policy-panel-tabs, .policy-panel-scroll, .island-overview-actions, footer) {
		opacity: var(--overview-content-opacity, 1);
		transform: translateY(var(--overview-content-offset, 0px));
	}
	.island-overview-actions {
		flex-shrink: 0;
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 8px;
		padding: 14px 20px;
		border-top: 1px solid var(--theme-color-e3e9e4);
		background: var(--theme-color-ffffff);
	}
	.overview-connection-status {
		margin: 0;
		font-size: 11px;
		line-height: 1.5;
		color: var(--theme-color-62786f);
	}
	.overview-connection-status button {
		margin-left: 6px;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.policy-map-panel > header {
		flex-shrink: 0;
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 12px 16px 8px;
		gap: 12px;
	}
	.policy-map-panel h2 {
		flex: 1;
		min-width: 0;
		font-size: 18px;
		font-weight: 600;
		line-height: 24px;
		margin: 0;
		letter-spacing: -0.45px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.policy-map-panel h2:focus {
		outline: none;
	}
	.policy-map-panel :global(.policy-panel-close) {
		flex: 0 0 32px;
		width: 32px;
		height: 32px;
		border-radius: 8px;
		color: var(--theme-color-62786f);
	}
	.policy-panel-tabs {
		--selection-background: var(--theme-color-ffffff);
		--selection-radius: 6px;
		flex-shrink: 0;
		display: flex;
		align-self: flex-start;
		max-width: calc(100% - 32px);
		margin: 0 16px;
		padding: 3px;
		gap: 2px;
		border: 1px solid var(--theme-color-e3e9e4);
		border-radius: 10px;
		background: var(--theme-color-f7faf7);
	}
	.policy-panel-tabs button {
		position: relative;
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		height: 30px;
		padding: 0 12px;
		border-radius: 6px;
		font-size: 11px;
		font-weight: 550;
		line-height: 1;
		white-space: nowrap;
		color: var(--theme-color-78847a);
	}
	.policy-panel-tabs button.active {
		color: var(--theme-color-245b40);
		font-weight: 650;
		background: var(--theme-color-ffffff);
	}
	.policy-panel-tabs:global([data-selection-ready]) button.active {
		background: transparent;
	}
	.policy-panel-tabs button span {
		border-radius: 5px;
		background: var(--theme-color-e8eee6);
		padding: 1px 5px;
		margin-left: 4px;
		font-size: 10px;
	}
	.policy-panel-scroll {
		flex: 1;
		overflow: auto;
		padding: 20px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		min-height: 0;
		overscroll-behavior: contain;
	}
	.policy-panel-scroll > * {
		flex-shrink: 0;
	}
	.policy-qualification {
		font-size: 11px;
		line-height: 1.65;
		color: var(--theme-color-7b8276);
		margin: 0;
	}
	.policy-map-panel :global(.policy-primary) {
		width: 100%;
		justify-content: center;
		font-size: 11px;
		min-height: 38px;
	}
	.policy-map-panel :global(.policy-secondary) {
		font-size: 11px;
		width: 100%;
	}
	.policy-map-panel :global(label) {
		font-size: 11px;
		line-height: 1.4;
		color: var(--theme-color-68765f);
		font-weight: 550;
	}
	.policy-map-panel :global(input) {
		font-size: 12px;
		height: 36px;
		font-variant-numeric: tabular-nums;
	}
	.policy-budget-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		align-items: end;
		gap: 12px;
	}
	.proposal-paths {
		display: grid;
		gap: 8px;
	}
	.proposal-paths > button {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 13px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: var(--card);
		color: var(--muted-foreground);
		text-align: left;
		transition:
			background 160ms ease,
			border-color 160ms ease;
	}
	.proposal-paths > button.active {
		border-color: color-mix(in srgb, var(--chart-1) 45%, var(--border));
		background: color-mix(in srgb, var(--chart-1) 6%, var(--card));
		color: var(--theme-color-245b40);
	}
	.proposal-paths > button:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 3px;
	}
	.proposal-paths > button > span,
	.proposal-budget-overview > span {
		display: grid;
		gap: 4px;
		min-width: 0;
	}
	.proposal-paths strong {
		font-size: 12px;
		font-weight: 600;
		line-height: 1.4;
	}
	.proposal-paths small,
	.proposal-budget-overview small {
		font-size: 10px;
		font-weight: 400;
		line-height: 1.5;
		color: var(--muted-foreground);
	}
	.proposal-budget-overview,
	.proposal-budget-editor-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		font-size: 11px;
		color: var(--foreground);
	}
	.proposal-budget-overview {
		padding: 2px 0 10px;
		border-bottom: 1px solid var(--border);
	}
	.proposal-budget-editor {
		display: grid;
		gap: 12px;
		padding: 14px;
		border: 1px solid var(--border);
		border-radius: 12px;
		background: color-mix(in srgb, var(--muted) 35%, var(--card));
	}
	.proposal-budget-editor-heading strong {
		font-weight: 600;
	}
	.proposal-budget-editor p {
		margin: 0;
		font-size: 10px;
		line-height: 1.5;
		color: var(--muted-foreground);
	}
	.policy-field,
	.policy-budget-grid > div {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}
	.policy-priorities {
		display: grid;
		gap: 8px;
		font-size: 11px;
		line-height: 1.4;
	}
	.policy-priorities > span {
		color: var(--theme-color-7b8375);
	}
	.policy-priority-options {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.policy-priorities button {
		border: 1px solid var(--theme-color-dce4d7);
		padding: 6px 10px;
		border-radius: 6px;
		color: var(--theme-color-6b795f);
	}
	.policy-priorities button.active {
		background: var(--theme-color-edf4e6);
		border-color: var(--theme-color-b8cba8);
		color: var(--theme-color-476b35);
	}
	.policy-place-heading h3,
	.policy-draft-heading h3 {
		font-size: 12px;
		line-height: 1.4;
		margin: 0 0 6px;
		font-weight: 600;
	}
	.policy-place-heading small {
		display: block;
		font-size: 11px;
		line-height: 1.5;
		color: var(--theme-color-7c8674);
	}
	.policy-palette {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 7px;
	}
	.policy-palette button {
		display: flex;
		align-items: center;
		flex-direction: column;
		gap: 7px;
		border: 1px dashed var(--theme-color-b8c6b0);
		padding: 12px 5px 9px;
		background: var(--theme-color-f5f8f1);
		border-radius: 9px;
		cursor: grab;
		position: relative;
		color: var(--theme-color-4d6a3e);
	}
	.policy-palette button:active {
		cursor: grabbing;
	}
	.policy-palette .palette-drag-icon {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border: 2px solid var(--theme-color-ffffff);
		border-radius: 14px;
		background: var(--theme-color-176c61);
		color: var(--theme-color-ffffff);
		box-shadow: 0 3px 8px var(--theme-color-123d3429);
		flex-shrink: 0;
	}
	.policy-palette button:disabled {
		cursor: default;
		opacity: 0.5;
	}
	.policy-palette button:focus-visible {
		outline: 2px solid var(--theme-color-176c61);
		outline-offset: 3px;
	}
	.policy-palette button > :global(svg:last-child) {
		position: absolute;
		top: 5px;
		right: 5px;
	}
	.policy-palette span {
		font-size: 10px;
	}
	.policy-placement-hint,
	.policy-budget-alert,
	.policy-budget-check {
		font-size: 11px;
		line-height: 1.5;
		margin: 0;
		padding: 10px 12px;
		border-radius: 9px;
		background: var(--theme-color-edf5f0);
		color: var(--theme-color-315f51);
	}
	.policy-budget-alert {
		background: var(--theme-color-fff1ed);
		color: var(--theme-color-a14431);
	}
	.policy-map-panel select {
		background: var(--theme-color-ffffff);
		border: 1px solid var(--theme-color-d4dfca);
		border-radius: 7px;
		font-size: 12px;
		padding: 8px;
		width: 100%;
		color: var(--theme-color-4c6040);
	}
	.policy-draft-heading {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.policy-operation-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.policy-operation-list li {
		display: flex;
		align-items: center;
		border: 1px solid var(--theme-color-e5eadd);
		border-radius: 8px;
		padding: 5px;
	}
	.policy-operation-list li > button:first-child {
		display: flex;
		gap: 9px;
		align-items: center;
		text-align: left;
		flex: 1;
		min-width: 0;
	}
	.policy-operation-list li span {
		font-size: 10px;
		border-radius: 5px;
		background: var(--theme-color-edf1e6);
		color: var(--theme-color-667d50);
		padding: 4px 7px;
	}
	.policy-operation-list strong {
		font-size: 11px;
		font-weight: 500;
		line-height: 1.5;
	}
	.policy-evidence-note {
		font-size: 11px;
		color: var(--theme-color-77836a);
		border: 1px solid var(--theme-color-e3e9dc);
		border-radius: 8px;
		padding: 11px;
	}
	.policy-evidence-note summary {
		cursor: pointer;
		color: var(--theme-color-526347);
		font-weight: 550;
	}
	.policy-evidence-note[open] {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.policy-evidence-note p {
		font-size: 10px;
		line-height: 1.5;
	}
	.policy-evidence-note :global(label) {
		display: block;
		margin-top: 12px;
		margin-bottom: 7px;
	}
	.policy-error {
		font-size: 12px;
		background: var(--theme-color-fff0e7);
		padding: 12px;
		border-radius: 8px;
		color: var(--theme-color-9c5c44);
		line-height: 1.6;
	}
	.policy-working {
		font-size: 12px;
		color: var(--theme-color-7b866f);
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.policy-suggestion {
		background: var(--theme-color-f0f5e8);
		border: 1px solid var(--theme-color-cdddb8);
		border-radius: 10px;
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.policy-suggestion > strong {
		font-size: 12px;
	}
	.policy-suggestion > button {
		display: flex;
		align-items: center;
		gap: 7px;
		text-align: left;
		color: var(--theme-color-566f40);
		font-size: 12px;
	}
	.policy-suggestion small {
		display: block;
		font-size: 10px;
		color: var(--theme-color-82916c);
		margin-top: 4px;
	}
	.policy-suggestion p {
		font-size: 10px;
		line-height: 1.6;
		margin: 0;
		color: var(--theme-color-7b846a);
	}
	.policy-suggestion > div {
		display: flex;
		gap: 5px;
	}
	.policy-map-panel > footer {
		flex-shrink: 0;
		border-top: 1px solid var(--theme-color-dde5d6);
		background: var(--theme-color-f9fbf5);
		padding: 16px 20px;
	}
	.policy-recalculating {
		position: absolute;
		bottom: 18px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 8;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 18px;
		border: 1px solid var(--theme-color-d0dfc1);
		border-radius: 12px;
		background: var(--theme-color-fffffff5);
		color: var(--theme-color-52713d);
		box-shadow: 0 4px 16px var(--theme-color-2c402014);
		font-size: 12px;
	}
	.policy-recalculating small {
		display: block;
		font-size: 10px;
		color: var(--theme-color-8a977a);
		margin-top: 3px;
	}
	:global(.policy-map-panel .spin),
	:global(.policy-recalculating .spin) {
		animation: spin 1.2s linear infinite;
	}
	.policy-selected-cell {
		padding: 12px;
		border: 1px solid var(--theme-color-c8dcca);
		background: var(--theme-color-f2f8ef);
		border-radius: 10px;
		display: grid;
		gap: 8px;
	}
	.policy-selected-cell strong {
		font-size: 12px;
	}
	.policy-selected-cell > span {
		color: var(--theme-color-687d60);
		font-size: 10px;
		line-height: 1.5;
	}
	.policy-selected-cell > p {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		margin: 0;
		font-size: 11px;
	}
	.policy-selected-cell b {
		font-variant-numeric: tabular-nums;
		font-weight: 550;
	}
	.policy-cell-evidence summary {
		cursor: pointer;
		font-size: 11px;
		font-weight: 550;
		color: var(--theme-color-526347);
	}
	.policy-cell-evidence summary:focus-visible {
		outline: 2px solid var(--theme-color-4d7655);
		outline-offset: 3px;
		border-radius: 3px;
	}
	.policy-cell-evidence p {
		margin: 8px 0 0;
		font-size: 11px;
		line-height: 1.55;
		color: var(--theme-color-687d60);
	}
	.policy-forecast-goal {
		display: grid;
		gap: 8px;
		padding: 12px;
		border: 1px solid var(--theme-color-dce6d4);
		border-radius: 10px;
	}
	.policy-forecast-goal select {
		border: 1px solid var(--theme-color-cedbc5);
		padding: 8px 9px;
		border-radius: 6px;
		background: var(--theme-color-ffffff);
		font-size: 12px;
	}
	.policy-forecast-goal small {
		font-size: 10px;
		line-height: 1.5;
		color: var(--theme-color-7b8570);
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	button:focus-visible {
		outline: 2px solid var(--theme-color-4d7655);
		outline-offset: 3px;
	}
	@media (max-width: 1100px) {
		.policy-map-controls {
			width: 330px;
		}
		.policy-lens-bar > span {
			font-size: 10px;
		}
		.policy-lens-bar .coverage-lens-option {
			display: none;
		}
		.policy-lens-bar .compact-coverage-lens {
			display: block;
			width: 170px;
			min-height: 36px;
			padding: 7px 9px;
			font-size: 12px;
		}
		.policy-map-panel {
			top: calc(116px + var(--map-navigation-offset, 0px));
			bottom: 16px;
			width: 340px;
		}
		.island-overview-panel {
			top: auto;
			bottom: 20px;
			width: 440px;
			max-width: calc(100% - 40px);
		}
		.policy-recalculating {
			left: 20px;
			transform: none;
			bottom: 82px;
		}
	}
	@media (max-width: 700px) {
		.compact-preview {
			gap: 8px;
			padding: 12px 16px 0;
		}
		.compact-preview header .eyebrow,
		.compact-preview .service-preview-instructions,
		.compact-preview .service-preview-full-impact,
		.compact-preview .service-costs > span {
			display: none;
		}
		.compact-preview h3 {
			margin: 0;
			font-size: 16px;
		}
		.compact-preview .service-costs {
			flex-direction: row;
			align-items: center;
			justify-content: space-between;
			gap: 8px;
			padding: 8px 10px;
		}
		.compact-preview .service-costs strong {
			font-size: 13px;
		}
		.compact-preview .service-preview-evidence {
			display: block;
		}
		.service-preview-evidence > summary {
			cursor: pointer;
			font-size: 12px;
			font-weight: 600;
			line-height: 1.4;
		}
		.service-preview-evidence > summary small {
			display: block;
			margin-left: 14px;
			font-weight: 400;
		}
		.service-preview-evidence[open] :global(.transport-impact) {
			margin-top: 8px;
		}
		.compact-preview footer {
			padding: 8px 0;
		}
		.proposal-action-feedback {
			display: none;
		}
		.proposal-floating-budget {
			top: 180px;
			bottom: auto;
			left: 10px;
			right: 10px;
			width: auto;
		}
		.proposal-floating-budget.placement-preview {
			top: auto;
			bottom: 10px;
		}
		.proposal-open-draft {
			padding: 5px 12px;
			font-size: 10px;
		}
		.proposal-placement-status {
			top: calc(142px + var(--map-navigation-offset, 0px));
			left: 10px;
			right: 10px;
			max-width: none;
			padding: 9px 11px;
		}
		.proposal-action-feedback {
			top: 142px;
			bottom: auto;
			left: 10px;
			padding: 8px 10px;
		}
		.proposal-map-views button {
			padding-inline: 7px;
			font-size: 10px;
		}
		.policy-map-controls {
			left: 12px;
			right: 12px;
			bottom: 12px;
			width: auto;
			max-width: none;
			flex-direction: column;
			align-items: stretch;
		}
		.local-map-status {
			flex-basis: 100%;
		}
		.proposal-map-metric {
			justify-content: center;
		}
		.proposal-map-result {
			text-align: center;
		}
		.policy-lens-bar {
			flex-shrink: 0;
			gap: 1px;
			padding: 0;
		}
		.policy-inspect-trigger {
			grid-template-columns: 116px minmax(0, 1fr);
			min-height: 98px;
			padding: 12px;
			gap: 4px 12px;
		}
		.score-dock-heading > strong {
			font-size: 15px;
		}
		.score-dock-value :global(.access-score .score-number strong) {
			font-size: 44px;
		}
	}
	@media (max-width: 640px) {
		.policy-lens-bar button {
			font-size: 10px;
			padding: 6px;
		}
		.policy-lens-bar select {
			width: 62px;
			padding: 5px 2px;
			font-size: 10px;
		}
		.policy-lens-bar .compact-coverage-lens {
			width: 170px;
			min-height: 44px;
			font-size: 12px;
			padding: 7px 9px;
		}
		.policy-map-panel {
			right: 10px;
			left: 10px;
			top: auto;
			bottom: 10px;
			width: auto;
			max-height: min(80%, 680px);
			border-radius: 17px;
		}
		.island-overview-panel {
			height: calc(100% - var(--map-toolbar-bottom, 182px) - 24px);
			max-height: 780px;
			max-width: none;
		}
		.policy-map-panel > header {
			padding: 8px 12px;
		}
		.policy-map-panel :global(.policy-panel-close) {
			flex-basis: 44px;
			width: 44px;
			height: 44px;
		}
		.policy-panel-scroll {
			padding: 14px 16px;
			gap: 12px;
			flex: 1;
		}
		.island-overview-actions {
			padding: 10px 16px max(10px, env(safe-area-inset-bottom));
		}
		.policy-panel-tabs button {
			height: 44px;
			padding-inline: 13px;
			font-size: 12px;
		}
		.policy-panel-tabs {
			max-width: calc(100% - 32px);
		}
		.policy-map-panel :global(input) {
			font-size: 16px;
		}
		.policy-recalculating {
			left: 12px;
			right: 12px;
			bottom: 17px;
			justify-content: center;
			z-index: 9;
			padding: 8px;
			font-size: 11px;
		}
		.policy-recalculating small {
			display: none;
		}
		.policy-map-panel > footer {
			padding: 12px 16px max(12px, env(safe-area-inset-bottom));
		}
		.policy-palette button {
			padding: 9px 5px;
		}
		.policy-map-panel.placing {
			max-height: 76px;
		}
		.policy-map-panel.placing > :not(header) {
			display: none;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.policy-map-panel,
		:global(.policy-map-panel .spin),
		:global(.policy-recalculating .spin) {
			animation: none;
		}
	}
</style>
