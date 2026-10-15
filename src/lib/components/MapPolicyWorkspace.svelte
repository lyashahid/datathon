<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import {
		ArrowRight,
		BusFront,
		Check,
		ChevronDown,
		GraduationCap,
		Hospital,
		Layers,
		MapPin,
		MousePointer2,
		Plus,
		RefreshCw,
		Ship,
		Sparkles,
		Trash2,
		Undo2,
		X
	} from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { api, subscribeApiInvalidation } from '#lib/api.js';
	import { impactColors, type PlanningOperation } from '#lib/planning-map.js';
	import {
		displayGapHexes,
		displayImpactHexes,
		displayAccessHexes,
		accessColors
	} from '#lib/display-grid.js';
	import { explainImpactCell, serviceCalendarRuns } from '#lib/proposal-experience.js';
	import { nearestPlacementRoad } from '#lib/map-placement-preview.js';
	import { GAP_PALETTE } from '#lib/map-overlay.js';
	import {
		assessDraftBudget,
		draftCosts,
		emptyFeatures,
		pointWithinIsland,
		type MapBaseline,
		type MapEvaluation,
		type MapPolicyState,
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
	import type {
		OpportunityIsland,
		PolicyLens,
		PolicyOpportunities,
		PolicyDomain
	} from '#lib/policy-opportunities.js';
	import type { Coordinates, MapFeatures } from '#lib/types.js';
	import {
		canConfirmFerry,
		ferryConnectionLabel,
		ferryFeatureBounds,
		ferryPlanningDate,
		ferryServiceInput,
		type FerryConnectivity,
		type FerryDraft
	} from '#lib/ferry-planning.js';
	import type { FeatureCollection } from 'geojson';
	import ProposalCostStrip from './ProposalCostStrip.svelte';
	import ProposalForecastReview from './ProposalForecastReview.svelte';

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
			'inspect' | 'gaps' | 'compose' | 'close' | 'confirm' | 'cancel-placement' | 'adjust-budget';
	} | null;
	type BudgetQuote = {
		economics: PlanningEconomics;
		budget: {
			allowed: boolean;
			reasons: string[];
			capital: { remaining_mvr: number | null };
			annual_operating?: { remaining_mvr: number | null };
		};
	};
	let {
		islandId,
		islandName,
		mapFeatures = null,
		boundaryFeatures = null,
		boundaryError = '',
		onRetryBoundary,
		active,
		lens = 'overall',
		command = null,
		placement = null,
		incomingOperation = null,
		moved = null,
		edited = null,
		cell = null,
		onLensChange,
		onState,
		onPickKind,
		onCloseOthers,
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
		mapFeatures?: MapFeatures | null;
		boundaryFeatures?: MapFeatures | null;
		boundaryError?: string;
		onRetryBoundary?: () => void;
		active: boolean;
		lens?: PolicyLens;
		command?: Command;
		placement?: { id: number; longitude: number; latitude: number; kind?: PlacementKind } | null;
		incomingOperation?: Record<string, unknown> | null;
		moved?: { id: number; index: number; coordinates: Coordinates } | null;
		edited?: { id: number; index: number; action: 'move' | 'duplicate' | 'remove' } | null;
		cell?: Record<string, unknown> | null;
		onLensChange: (value: PolicyLens) => void;
		onState: (value: MapPolicyState) => void;
		onPickKind: (kind: PlacementKind | null) => void;
		onCloseOthers: () => void;
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
	let opened = $state(false);
	let section = $state<'needs' | 'proposal'>('needs');
	let national = $state.raw<PolicyOpportunities | null>(null);
	let baseline = $state.raw<MapBaseline | null>(null);
	let gapCells = $state.raw<FeatureCollection>(emptyFeatures());
	let displayGrid = $state.raw<FeatureCollection>(emptyFeatures());
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
	let actionMessage = $state('');
	let consumedEdit = 0;
	let placementEvaluation = $state.raw<{ key: string; value: MapEvaluation } | null>(null);
	let previewCalculating = $state(false);
	let previewController: AbortController | undefined;
	let busOpen = $state(false);
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
	let ferryComposer = $state<HTMLElement | null>(null);
	let capitalBudget = $state<number | string>(150_000_000);
	let annualBudget = $state<number | string>(25_000_000);
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
	let review = $state(false);
	let showImpact = $state(true);
	let impactView = $state<'current' | 'proposal' | 'improvement'>('improvement');
	let restoredScope = $state('');
	let savedMessage = $state('');
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
	let ferryRequestedSignature = '';
	let suggestionContext = '';
	let evaluateTimer: ReturnType<typeof setTimeout> | undefined;
	const current = $derived(national?.islands.find((row) => row.island_id === islandId));
	$effect(() => {
		if (title === 'Selected island service improvement' && current?.name)
			title = `${current.name} service improvement`;
	});
	const supported = $derived(current?.planning_supported ?? false);
	const localConstructionReason = $derived(
		current
			? 'Local construction planning needs detailed road and resident data, which are unavailable for this island. You can still plan a ferry service using existing landing places.'
			: 'Loading the island evidence before placing local construction…'
	);
	const scopedKey = $derived(islandId ?? '');
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
	const connection = $derived(
		ferryConnection?.key === ferryConnectionKey ? ferryConnection.value : null
	);
	const ferryPreview = $derived(ferryDraft?.key === ferrySignature ? ferryDraft.value : null);
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
		national?.islands.find((island) => island.island_id === ferryDestination)?.name ??
			'Choose a destination'
	);
	const draftedFerries = $derived(
		operations.flatMap((operation) =>
			operation.metadata?.ui_ferry_summary
				? [operation.metadata.ui_ferry_summary as NonNullable<FerryDraft['summary']>]
				: []
		)
	);
	const draftItems = $derived(
		operations.flatMap((operation, index) =>
			typeof operation.metadata?.ui_package === 'string' &&
			operation.metadata.ui_package.startsWith('ferry-service:') &&
			!operation.metadata.ui_ferry_summary
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
	const placementOperations = $derived(
		pendingOperation
			? editingIndex === null
				? [...operations, pendingOperation]
				: operations.map((operation, index) =>
						index === editingIndex ? pendingOperation : operation
					)
			: operations
	);
	const placementEvaluationKey = $derived(
		JSON.stringify({ ...request, operations: placementOperations })
	);
	const pendingEvaluation = $derived(
		placementEvaluation?.key === placementEvaluationKey ? placementEvaluation.value : null
	);
	const quotedPlacement = $derived(
		placementQuote?.key === placementKey ? placementQuote.value : null
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
						!placementError &&
						!checkingBudget,
					reason:
						loading || !baseline
							? 'Loading the island cost and site evidence…'
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
						roadDistance !== null
							? roadDistance <= 35
								? 'Beside a mapped street. Review the access estimate before confirming.'
								: roadDistance <= 100
									? `${Math.round(roadDistance)} m from a mapped street; within the model’s connection range.`
									: 'More than 100 m from a mapped street. This site may have no modeled access.'
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
	const mapGaps = $derived({
		type: 'FeatureCollection' as const,
		features: [
			...nationalScreening.features.filter(
				(feature) =>
					restoredScope !== scopedKey ||
					!displayGrid.features.length ||
					feature.properties?.island_id !== islandId
			),
			...(restoredScope === scopedKey ? gapCells.features : [])
		]
	} as FeatureCollection);
	const serviceFeatures = $derived({
		type: 'FeatureCollection' as const,
		features:
			restoredScope !== scopedKey
				? []
				: [
						...operations.flatMap(
							(operation) =>
								(operation.metadata?.ui_map_features as FeatureCollection | undefined)?.features ??
								[]
						),
						...(suggested?.selected.flatMap((item) => item.map_features?.features ?? []) ?? []),
						...(busOpen ? busMapFeatures().features : []),
						...(ferryOpen
							? ((ferryPreview?.map_features ?? connection?.map_features)?.features ?? [])
							: [])
					]
	});
	const impact = $derived(
		restoredScope === scopedKey && evaluation && !stale && showImpact && displayGrid.features.length
			? impactView === 'improvement'
				? displayImpactHexes(baseline?.origins ?? [], evaluation.origins ?? [], displayGrid)
				: displayAccessHexes(
						baseline?.origins ?? [],
						evaluation.origins ?? [],
						displayGrid,
						impactView === 'current' ? 'before' : 'after',
						Number(targetMinutes)
					)
			: emptyFeatures()
	);
	const selectedImpactCell = $derived(
		impact.features.find((feature) => String(feature.properties?.id) === String(cell?.id))
			?.properties
	);
	const selectedExplanation = $derived(
		selectedImpactCell
			? explainImpactCell(selectedImpactCell, {
					goalLabel,
					targetMinutes: Number(targetMinutes),
					operations
				})
			: null
	);
	const busPatterns = $derived(
		(baseline?.patterns ?? []).filter((pattern) => pattern.mode === 'bus')
	);
	const busPattern = $derived(busPatterns.find((pattern) => pattern.id === busPatternId));
	const busPatternActive = $derived(serviceCalendarRuns(busPattern?.calendar, date));
	const busRecordedDate = $derived(
		busPattern?.calendar?.includedDates
			?.filter((recorded) => serviceCalendarRuns(busPattern?.calendar, recorded))
			.sort()[0] ?? null
	);
	const busSignature = $derived(JSON.stringify({ request, busPatternId, busHeadway }));
	const busPreview = $derived(busQuote?.key === busSignature ? busQuote.value : null);
	const previewEconomics = $derived(
		quotedPlacement?.economics ??
			(ferryOpen ? ferryPreview?.quote?.economics : null) ??
			(busOpen ? busPreview?.economics : null)
	);
	const hasDraftContext = $derived(!!(draftItems.length || pending || armedKind || actionMessage));
	const draftEconomics = $derived<PlanningEconomics>({
		currency: 'MVR',
		basis: 'Illustrative backend cost factors. Operating service cost requires a service plan.',
		before: {},
		after: {},
		delta: { capital_mvr: costs.capital, annual_operating_mvr: costs.annual },
		budget: {},
		assumptions: baseline?.cost_defaults ?? {},
		warnings: []
	});
	const visibleEconomics = $derived(
		previewEconomics ?? (evaluation && !stale ? evaluation.economics : draftEconomics)
	);

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
			cancelSuggestions();
			baseline = null;
			gapCells = emptyFeatures();
			displayGrid = emptyFeatures();
			evaluation = null;
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
		actionMessage = '';
		placementEvaluation = null;
		previewController?.abort();
		closeBusService();
		evaluation = null;
		evaluatedSignature = '';
		error = '';
		evaluationQueued = false;
		evaluating = false;
		review = false;
		closeFerry();
		onPickKind(null);
		if (restore) {
			ferryDestination = '';
			ferrySearch = '';
			ferryConnection = null;
			gapCells = emptyFeatures();
			displayGrid = emptyFeatures();
			operations = [];
			history = [];
			title = `${islandName} service improvement`;
			capitalBudget = 150_000_000;
			annualBudget = 25_000_000;
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
					if (Array.isArray(draft.operations)) operations = draft.operations.slice(0, 100);
					if (typeof draft.title === 'string') title = draft.title;
					const capital = assumptions.capital_budget_mvr ?? draft.capitalBudget;
					const annual = assumptions.annual_operating_budget_mvr ?? draft.annualBudget;
					if (typeof capital === 'number' && Number.isFinite(capital) && capital >= 0)
						capitalBudget = capital;
					if (typeof annual === 'number' && Number.isFinite(annual) && annual >= 0)
						annualBudget = annual;
					const savedGoal = assumptions.goal ?? draft.goal;
					if (savedGoal === 'healthcare' || savedGoal === 'education' || savedGoal === 'transport')
						goal = savedGoal;
					if (typeof assumptions.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(assumptions.date))
						date = assumptions.date;
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
			const [detail, data] = await Promise.all([
				api<{
					gap_cells?: FeatureCollection;
					features?: FeatureCollection;
					hex_grid?: FeatureCollection;
				}>(`planning/opportunities/${encodeURIComponent(scope)}`, undefined, controller.signal),
				api<MapBaseline>(
					`planning/baseline?island_id=${encodeURIComponent(scope)}`,
					undefined,
					controller.signal
				)
			]);
			if (controller.signal.aborted) return;
			displayGrid = detail.hex_grid ?? emptyFeatures();
			const sourceCells = detail.gap_cells ?? detail.features ?? emptyFeatures();
			gapCells = displayGrid.features.length
				? displayGapHexes(sourceCells, displayGrid)
				: emptyFeatures();
			if (!controller.signal.aborted) baseline = data;
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
			if (command!.kind === 'cancel-placement') {
				cancelPending();
				return;
			}
			if (command!.kind === 'adjust-budget') {
				adjustBudget();
				return;
			}
			opened = command!.kind !== 'close';
			if (opened) {
				section = command!.kind === 'compose' ? 'proposal' : 'needs';
				if (command!.kind === 'gaps') showImpact = false;
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
			quoteController?.abort();
			checkingBudget = false;
			pending = {
				coordinates: placementCoordinates(
					[placement!.longitude, placement!.latitude],
					placement!.kind ?? armedKind ?? 'add_school'
				),
				kind: placement!.kind ?? 'add_school'
			};
			if (!pendingId) pendingId = `proposal:${pending.kind}:${crypto.randomUUID()}`;
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
		if (!baseline || loading || restoredScope !== scopedKey) return;
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
		const key = ferryConnectionKey;
		const origin = islandId;
		const destination = ferryDestination;
		const serviceDate = date;
		if (!mounted || !active || !ferryOpen || !origin || !destination) return;
		const controller = new AbortController();
		ferryConnectionController = controller;
		untrack(() => {
			ferryLoading = true;
			ferryError = '';
		});
		void api<FerryConnectivity>(
			`planning/connectivity?${new URLSearchParams({ origin_island_id: origin, destination_island_id: destination, date: serviceDate })}`,
			undefined,
			controller.signal
		)
			.then((value) => {
				if (!controller.signal.aborted && ferryConnectionKey === key) {
					ferryConnection = { key, value };
					focusFerryFeatures(value.map_features);
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
			operations: displayOperations,
			pending: restoredScope === scopedKey ? pending : null,
			pendingDecision: restoredScope === scopedKey ? pendingDecision : null,
			gapFeatures: mapGaps,
			impactFeatures: impact,
			serviceFeatures,
			calculating,
			stale,
			panelOpen: opened,
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
			}
		} catch (cause) {
			if (!controller.signal.aborted)
				error = cause instanceof Error ? cause.message : 'Impact could not be calculated.';
		} finally {
			if (evaluateController === controller) evaluating = false;
		}
	}
	function budgetNumber(value: number | string) {
		return value === '' ? NaN : Number(value);
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
		suggested = null;
		error = '';
		showImpact = true;
		impactView = 'improvement';
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
	function open(mode: 'needs' | 'proposal') {
		opened = true;
		section = mode;
		onCloseOthers();
	}
	function close() {
		quoteController?.abort();
		checkingBudget = false;
		opened = false;
		cancelPending();
		review = false;
		closeFerry();
		closeBusService();
		cancelSuggestions();
		onPickKind(null);
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
		armedKind = kind;
		pendingId = `proposal:${kind}:${crypto.randomUUID()}`;
		actionMessage = `Click the map to place a ${placementLabel(kind).toLowerCase()}`;
		setGoal(kind === 'add_stop' ? 'transport' : kind === 'add_school' ? 'education' : 'healthcare');
		suggested = null;
		closeFerry();
		closeBusService();
		onPickKind(kind);
		onCloseOthers();
	}
	function beginFerry() {
		cancelPending();
		cancelSuggestions();
		open('proposal');
		ferryOpen = true;
		closeBusService();
		ferryError = '';
		ferryChoosingDestination = !ferryDestination;
		onLensChange('transport');
		setGoal('transport');
		void tick().then(() => ferryComposer?.scrollIntoView({ block: 'nearest' }));
	}
	function beginBusService() {
		cancelPending();
		cancelSuggestions();
		closeFerry();
		closeBusService();
		open('proposal');
		busOpen = true;
		busError = '';
		if (!busPatterns.some((pattern) => pattern.id === busPatternId))
			busPatternId = busPatterns[0]?.id ?? '';
		onLensChange('transport');
	}
	function closeBusService() {
		busOpen = false;
		busController?.abort();
		busRequestedSignature = '';
		busQuoting = false;
		busError = '';
	}
	function busOperations(): PlanningOperation[] {
		if (!busPattern) return [];
		return [
			...operations.filter(
				(operation) => !(operation.type === 'set_frequency' && operation.target_id === busPatternId)
			),
			{
				type: 'set_frequency',
				target_id: busPatternId,
				island_id: islandId ?? undefined,
				headway_minutes: Number(busHeadway),
				name: `${busPattern.name} · every ${busHeadway} min`,
				metadata: { ui_map_features: busMapFeatures() }
			}
		];
	}
	function busMapFeatures(): FeatureCollection {
		const lines =
			busPattern?.segmentGeometries?.filter((line) => line.length > 1) ??
			(busPattern?.geometry?.length ? [busPattern.geometry] : []);
		return {
			type: 'FeatureCollection',
			features: lines.map((coordinates) => ({
				type: 'Feature',
				properties: { name: busPattern?.name, mode: 'bus' },
				geometry: { type: 'LineString', coordinates }
			}))
		};
	}
	async function previewBusService() {
		if (!busOpen) return;
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
				{ ...request, operations: busOperations() },
				controller.signal
			);
			if (!controller.signal.aborted && busOpen && key === busSignature) {
				busQuote = { key, value };
				const stops = (baseline?.stops ?? []).filter((stop) =>
					busPattern?.stopIds.includes(stop.id)
				);
				const bounds = ferryFeatureBounds({
					type: 'FeatureCollection',
					features: stops.map((stop) => ({
						type: 'Feature',
						properties: {},
						geometry: { type: 'Point', coordinates: [stop.lon, stop.lat] }
					}))
				});
				if (bounds) onFocusBounds?.(bounds);
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
			!busPreview?.budget.allowed ||
			busQuoting ||
			checkingBudget
		)
			return;
		const next = busOperations();
		financialQuote = {
			key: planningFinancialKey({ ...request, operations: next }),
			capital: busPreview.economics.delta.capital_mvr ?? null,
			annual: busPreview.economics.delta.annual_operating_mvr ?? null
		};
		commitChange(next);
		closeBusService();
		actionMessage = 'Bus service frequency updated';
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
		opened = true;
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
	async function previewFerry() {
		const input = ferryInput;
		if (!input.payload) {
			ferryError = input.error;
			return;
		}
		if (!budgetLimits.allowed) {
			ferryError = budgetLimits.reason;
			return;
		}
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
				focusFerryFeatures(value.map_features);
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
		const group = `ferry-service:${crypto.randomUUID()}`;
		const capital = preview.quote!.economics.delta.capital_mvr ?? null;
		const annual = preview.quote!.economics.delta.annual_operating_mvr ?? null;
		const additions = preview.operations.map((operation, index) => ({
			...operation,
			...(index === 0 && preview.summary ? { name: preview.summary.name } : {}),
			metadata: {
				...operation.metadata,
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
		closeFerry();
		showImpact = false;
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
		financialQuote = {
			key: planningFinancialKey({ ...request, operations: next }),
			capital: quotedPlacement.economics.delta.capital_mvr ?? null,
			annual: quotedPlacement.economics.delta.annual_operating_mvr ?? null
		};
		commitChange(next);
		if (acceptedEvaluation && JSON.stringify(request) === acceptedSignature) {
			evaluation = acceptedEvaluation;
			evaluatedSignature = acceptedSignature;
		}
		cancelPending();
		actionMessage = wasMoving ? 'Location updated' : 'Added to your proposal';
	}
	function setGoal(value: 'healthcare' | 'education' | 'transport') {
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
		if (operations[index]?.metadata?.ui_ferry_summary && ferryFeatures) {
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
	function needsLabel(row: OpportunityIsland | undefined) {
		if (!row) return 'Loading island evidence…';
		return row?.planning_supported
			? 'Inspect local service gaps, then test a funded option.'
			: 'National evidence screening. Detailed journey modeling is not available for this island.';
	}
	const coverageLenses: { id: PolicyLens; label: string }[] = [
		{ id: 'overall', label: 'All services' },
		{ id: 'transport', label: 'Transport' },
		{ id: 'health', label: 'Health' },
		{ id: 'education', label: 'Education' }
	];
	function selectLens(value: PolicyLens) {
		showImpact = false;
		onLensChange(value);
	}
</script>

{#if active}
	<div class="policy-map-controls" class:panel-open={opened}>
		{#if !opened}<Button
				variant="ghost"
				class="policy-inspect-trigger"
				title={`${islandName} · ${impact.features.length ? 'proposal impact' : 'service gaps'}`}
				onclick={() => open('needs')}
				><MapPin size={15} /><span
					>{islandName} · {impact.features.length ? 'proposal impact' : 'service gaps'}</span
				></Button
			>{/if}
		<div class="policy-lens-bar" aria-label="Service coverage map">
			{#if operations.length}
				<div class="proposal-map-views" role="group" aria-label="Proposal map view">
					{#each [{ id: 'current', label: 'Current access' }, { id: 'proposal', label: 'With proposal' }, { id: 'improvement', label: 'Improvement' }] as view (view.id)}
						<button
							class:active={showImpact && impactView === view.id}
							aria-pressed={showImpact && impactView === view.id}
							disabled={!evaluation || stale || calculating}
							onclick={() => {
								impactView = view.id as typeof impactView;
								showImpact = true;
							}}>{view.label}</button
						>
					{/each}
				</div>
			{:else}<span><Layers size={15} />Service gaps</span>{/if}
			{#each operations.length ? [] : coverageLenses as option (option.id)}
				<button
					class="coverage-lens-option"
					class:active={lens === option.id && !impact.features.length}
					aria-pressed={lens === option.id && !impact.features.length}
					onclick={() => selectLens(option.id)}>{option.label}</button
				>
			{/each}
			{#if !operations.length}<select
					class="compact-coverage-lens"
					aria-label="Service coverage"
					value={lens}
					onchange={(event) => selectLens(event.currentTarget.value as PolicyLens)}
				>
					{#each coverageLenses as option (option.id)}<option value={option.id}
							>{option.label}</option
						>{/each}
				</select>{/if}
			<button
				class="lens-info"
				aria-label={impact.features.length
					? 'Explain proposal impact colours'
					: 'Explain service gap colours'}
				onclick={() => open('needs')}><ChevronDown size={16} /></button
			>
		</div>
	</div>
	{#if opened}<section
			class="policy-map-panel"
			class:placing={(!!pending || !!armedKind) && !budgetEditing}
			aria-label="Island needs and proposal"
			data-policy-section={section}
		>
			<header>
				<div>
					<span class="eyebrow"
						>{section === 'needs' ? 'UNDERSTAND THIS ISLAND' : 'BUILD YOUR PROPOSAL'}</span
					>
					<h2>{islandName}</h2>
				</div>
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Close island planning panel"
					onclick={close}><X size={18} /></Button
				>
			</header>
			<div class="policy-panel-tabs">
				<button
					class:active={section === 'needs'}
					onclick={() => {
						section = 'needs';
						showImpact = false;
					}}>Service gaps</button
				><button
					class:active={section === 'proposal'}
					onclick={() => {
						section = 'proposal';
						showImpact = true;
					}}
					>Your proposal {#if operations.length}<span>{draftItems.length}</span>{/if}</button
				>
			</div>
			<div class="policy-panel-scroll">
				{#if dataError}<p class="policy-error" role="alert">
						{dataError}<Button variant="link" onclick={() => void loadNational()}
							>Retry evidence</Button
						>
					</p>{/if}
				{#if loading || !national}<p class="policy-working" role="status">
						<RefreshCw size={15} class="spin" />Loading island evidence…
					</p>{/if}
				{#if boundaryError}<p class="policy-error" role="alert">
						{boundaryError}<Button variant="link" onclick={onRetryBoundary}
							>Retry map details</Button
						>
					</p>{/if}
				{#if error}<p class="policy-error" role="alert">
						{error}{#if scopeError}<Button variant="link" onclick={retryScope}
								>Retry island evidence</Button
							>{/if}
					</p>{/if}
				{#if section === 'needs'}
					<p class="policy-intro">
						{impact.features.length
							? `Your proposal’s modeled ${goalLabel}. Select a hexagon to compare current and proposed journeys.`
							: needsLabel(current)}
					</p>
					<div class="policy-map-key">
						{#if impact.features.length && impactView !== 'improvement'}
							<span><i style:background={accessColors.within_target}></i>Within target</span>
							<span><i style:background={accessColors.beyond_target}></i>Beyond target</span>
							<span><i style:background={accessColors.mixed}></i>Mixed access</span>
							<span><i style:background={accessColors.unavailable}></i>No routed access</span>
							<span><i style:background={accessColors.unknown}></i>Unknown</span>
						{:else}<span
								><i
									class="gap-high"
									style:background={impact.features.length ? impactColors.lost : GAP_PALETTE.longer}
								></i>{impact.features.length
									? 'Lost / slower'
									: gapCells.features.length
										? 'At / beyond target'
										: 'Review need'}</span
							><span
								><i
									class="gap-low"
									style:background={impact.features.length
										? impactColors.gained
										: GAP_PALETTE.shorter}
								></i>{impact.features.length
									? 'Gained / faster'
									: gapCells.features.length
										? 'Shorter journey'
										: 'More evidence'}</span
							><span
								><i
									class="gap-unknown"
									style:background={impact.features.length
										? impactColors.uncomputed
										: GAP_PALETTE.unknown}
								></i>Unknown</span
							>
							{#if impact.features.length}<span
									><i style:background={impactColors.unchanged}></i>Unchanged</span
								>{/if}
						{/if}
					</div>
					<Button
						class="policy-primary"
						onclick={() => {
							section = 'proposal';
							showImpact = true;
						}}
						><Sparkles size={16} />{operations.length
							? 'Edit your proposal'
							: 'Build a funded proposal'}<ArrowRight size={16} /></Button
					>
					<button class="policy-ferry-entry" onclick={beginFerry}>
						<Ship size={22} /><span
							><strong>Island-to-island travel</strong><small
								>Check a connection and plan a ferry service.</small
							></span
						><ArrowRight size={16} />
					</button>
					{#if selectedExplanation && impact.features.length}<div
							class="policy-selected-cell"
							aria-label="Selected neighbourhood impact"
							data-cell-id={String(cell?.id ?? '')}
						>
							<strong>{selectedExplanation.title}</strong><span>{selectedExplanation.summary}</span>
							{#each selectedExplanation.reasons as reason, i (i)}<p>{reason}</p>{/each}
							<small>{selectedExplanation.qualification}</small>
						</div>{:else if cell?.origin_id && !impact.features.length}<div
							class="policy-selected-cell"
							data-cell-id={String(cell.origin_id)}
						>
							<strong>Selected neighbourhood</strong><span
								>{formatAmount(cell.population)} modeled residents</span
							>{#each [{ key: 'transport', label: 'Walk to a stop' }, { key: 'health', label: 'Healthcare journey' }, { key: 'education', label: 'Education journey' }] as metric (metric.key)}<p
								>
									{metric.label}<b
										>{typeof cell[`${metric.key}_minutes`] === 'number'
											? `${Math.round(Number(cell[`${metric.key}_minutes`]))} min`
											: 'No routed evidence'}</b
									>
								</p>{/each}
							{#if cell.display_grid}<small
									>Journey times are resident-weighted averages for this tile.</small
								>{/if}
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
							<small
								>{String(cell.impact).replaceAll('_', ' ')} · {cell.display_grid
									? 'resident-weighted tile; overall totals use the original model'
									: 'illustrative cell at a modeled origin'}</small
							>
						</div>{/if}
					{#if current}
						{#each ['transport', 'health', 'education'] as domain (domain)}
							{@const item = current.domains[domain as PolicyDomain]}
							<button class="policy-need-row" onclick={() => onLensChange(domain as PolicyLens)}
								><span
									>{#if domain === 'transport'}<BusFront
											size={18}
										/>{:else if domain === 'health'}<Hospital size={18} />{:else}<GraduationCap
											size={18}
										/>{/if}<strong
										>{domain === 'health'
											? 'Healthcare'
											: domain === 'education'
												? 'Education'
												: 'Transport'}</strong
									><small>{item.mapped_count} mapped records</small></span
								><b class:unknown={item.status === 'unknown'}
									>{item.status === 'review'
										? 'Review need'
										: item.status === 'unknown'
											? 'Unknown'
											: 'Mapped evidence'}</b
								></button
							>
							{#if lens === domain}<ul class="policy-reasons">
									{#each item.reasons as reason, i (i)}<li>{reason}</li>{/each}
								</ul>{/if}
						{/each}
						<div class="policy-population">
							<span>Linked resident population</span><strong
								>{current.population == null
									? 'Not linked'
									: formatAmount(current.population)}</strong
							>
							<details>
								<summary>Population source</summary><small>{current.population_basis}</small>
							</details>
						</div>
						{#if current.missing_data.length}<details class="policy-evidence-note">
								<summary>What still needs verification</summary>
								<ul>
									{#each current.missing_data as item, i (i)}<li>{item}</li>{/each}
								</ul>
							</details>{/if}
					{/if}
					<details class="policy-evidence-note">
						<summary>How to read this map</summary>
						<p>
							{gapCells.features.length
								? 'Local tiles compare journeys to a 30-minute healthcare / school target or a 10-minute walk to a stop. Journey times are resident-weighted averages. Tiles stop where resident data ends; grey means journey evidence is incomplete. Select a tile for details.'
								: 'Colours screen mapped records. Missing records need verification and do not prove there is no service.'}
						</p>
					</details>
					<Button
						variant="ghost"
						class="policy-secondary"
						onclick={() => {
							close();
							onDetails();
						}}>Island details & directions</Button
					>
				{:else}
					<div class="policy-field">
						<Label for="map-proposal-title">Proposal name</Label><Input
							id="map-proposal-title"
							bind:value={title}
							maxlength={160}
						/>
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
					{#if !budgetDecision.allowed && budgetDecision.known}<p
							class="policy-budget-alert"
							role="alert"
						>
							{budgetDecision.reason}
						</p>{/if}
					{#if checkingBudget}<p class="policy-budget-check" role="status">
							Checking the cost against both budgets…
						</p>{/if}
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
					<div class="policy-place-heading">
						<h3>Add to your proposal</h3>
						<small
							>Choose an item, then click its location on the map. You can also drag its icon.</small
						>
					</div>
					<div class="policy-palette">
						{#each [{ kind: 'add_stop', label: 'Bus stop', icon: BusFront }, { kind: 'add_school', label: 'School', icon: GraduationCap }, { kind: 'add_hospital', label: 'Hospital', icon: Hospital }] as item (item.kind)}<button
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
					<button
						class="policy-ferry-entry"
						class:active={busOpen}
						onclick={beginBusService}
						disabled={!supported || !busPatterns.length || loading || checkingBudget}
					>
						<BusFront size={24} /><span
							><strong>Bus service</strong><small
								>Choose an existing route and improve its frequency.</small
							></span
						><Plus size={16} />
					</button>
					{#if busOpen}<section class="policy-bus-composer" aria-label="Plan a bus service">
							<header>
								<h3>Improve a bus service</h3>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label="Close bus service planner"
									onclick={closeBusService}><X size={16} /></Button
								>
							</header>
							<Label for="proposal-bus-route">Bus route and direction</Label><select
								id="proposal-bus-route"
								bind:value={busPatternId}
								>{#each busPatterns as pattern (pattern.id)}<option value={pattern.id}
										>{pattern.name}</option
									>{/each}</select
							>
							<p>
								{busPattern?.stopIds.length ?? 0} existing boarding points · selected published direction
							</p>
							<Label for="proposal-bus-date">Service date</Label><Input
								id="proposal-bus-date"
								type="date"
								bind:value={date}
							/>
							<small>Costs and impact use this date for the whole proposal.</small>
							{#if busPattern && !busPatternActive}<div class="policy-budget-alert" role="alert">
									<p>
										No published departures start on this date. A captured timetable cannot be
										assumed to repeat on another day.
									</p>
									{#if busRecordedDate}<Button
											variant="outline"
											size="sm"
											aria-label="Use recorded service date"
											onclick={() => {
												date = busRecordedDate!;
												busError = '';
											}}>Use {busRecordedDate}</Button
										>{/if}
								</div>{/if}
							<Label for="proposal-bus-frequency">A bus every · minutes</Label><Input
								id="proposal-bus-frequency"
								type="number"
								min="1"
								max="720"
								bind:value={busHeadway}
							/>
							<p>
								Uses the route’s existing service date, operating window and modeled road path. The
								reverse direction is unchanged.
							</p>
							<Button
								variant="outline"
								disabled={busQuoting || !busPattern || !busPatternActive || !budgetLimits.allowed}
								onclick={() => void previewBusService()}
								>{busQuoting ? 'Checking route costs…' : 'Preview bus service & costs'}</Button
							>
							{#if busError}<p class="policy-error" role="alert">{busError}</p>{/if}
							{#if busPreview}<div class="bus-service-preview">
									<strong
										>MVR {formatAmount(busPreview.economics.delta.capital_mvr, true)} upfront · MVR {formatAmount(
											busPreview.economics.delta.annual_operating_mvr,
											true
										)}/year</strong
									>{#each busPreview.budget.reasons as reason, i (i)}<p
											class="policy-budget-alert"
											role="alert"
										>
											{reason}
										</p>{/each}<Button
										disabled={!busPatternActive ||
											!busPreview.budget.allowed ||
											checkingBudget ||
											busQuoting}
										onclick={confirmBusService}>Add bus service to proposal</Button
									>
								</div>{/if}
							<small
								>A boarding point and an operating bus service are separate investments. Frequency
								alone does not improve walking access to a stop.</small
							>
						</section>{/if}
					<button
						class="policy-ferry-entry"
						class:active={ferryOpen}
						onclick={beginFerry}
						disabled={loading || checkingBudget || operations.length >= 97}
					>
						<Ship size={24} /><span
							><strong>New ferry service</strong><small
								>Connect two islands using existing landing places.</small
							></span
						><Plus size={16} />
					</button>
					{#if ferryOpen}<section
							bind:this={ferryComposer}
							class="policy-ferry-composer"
							aria-label="Plan a ferry service"
						>
							<header>
								<div>
									<span class="eyebrow">CONNECT ISLANDS</span>
									<h3>Plan a ferry service</h3>
								</div>
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label="Close ferry service planner"
									onclick={closeFerry}><X size={16} /></Button
								>
							</header>
							<p class="ferry-origin">
								<MapPin size={15} /><span>From <strong>{islandName}</strong> · {date}</span>
							</p>
							<div class="ferry-map-steps" aria-label="Ferry route endpoints">
								<button
									onclick={() => {
										opened = false;
										onPickFerryOrigin(ferryDestination, date);
									}}
									><span>1</span><strong>From {islandName}</strong><small>Change on map</small
									></button
								>
								<button onclick={pickFerryDestination}
									><span>2</span><strong
										>{ferryDestination
											? `To ${ferryDestinationName}`
											: 'Choose destination'}</strong
									><small>Choose on map</small></button
								>
							</div>
							<div class="ferry-destination">
								<Label for="ferry-island-search">Destination island</Label>
								{#if ferryDestination && !ferryChoosingDestination}<button
										class="ferry-selected-destination"
										onclick={() => (ferryChoosingDestination = true)}
										><MapPin size={15} /><strong>{ferryDestinationName}</strong><span>Change</span
										></button
									>{/if}
								{#if !ferryDestination || ferryChoosingDestination}
									<Input
										id="ferry-island-search"
										placeholder="Search by island or atoll"
										bind:value={ferrySearch}
									/>
									<div class="ferry-island-results" aria-label="Destination islands">
										{#each ferryIslands as island (island.island_id)}<button
												onclick={() => chooseFerryDestination(island.island_id)}
												><MapPin size={14} /><span>{island.name}<small>{island.atoll}</small></span
												><ArrowRight size={13} /></button
											>{:else}<p>
												No matching named islands. Try another name or choose on the map.
											</p>{/each}
									</div>
									<Button variant="outline" size="sm" onclick={pickFerryDestination}
										><MapPin size={14} />Choose destination on the map</Button
									>
								{/if}
							</div>
							{#if ferryLoading}<p class="ferry-progress" role="status">
									<RefreshCw size={14} class="spin" />Checking existing routes and landing places…
								</p>{/if}
							{#if connection}<div
									class="ferry-connection"
									class:verified={connection.status === 'dated_service'}
									data-connection-status={connection.status}
								>
									<strong>{ferryConnectionLabel(connection.status)}</strong>
									{#each connection.reasons as reason, i (i)}<p>{reason}</p>{/each}
									<div class="ferry-terminal-evidence">
										<span
											>{islandName}<b
												>{connection.terminals.origin.length
													? `${connection.terminals.origin.length} mapped landing place${connection.terminals.origin.length === 1 ? '' : 's'}`
													: 'Landing place needs verification'}</b
											></span
										><span
											>{ferryDestinationName}<b
												>{connection.terminals.destination.length
													? `${connection.terminals.destination.length} mapped landing place${connection.terminals.destination.length === 1 ? '' : 's'}`
													: 'Landing place needs verification'}</b
											></span
										>
									</div>
								</div>{/if}
							{#if ferryDestination}<div class="ferry-service-fields">
									<div>
										<Label for="ferry-headway">A ferry every · minutes</Label><Input
											id="ferry-headway"
											type="number"
											min="15"
											max="720"
											step="15"
											bind:value={ferryHeadway}
										/>
									</div>
									<div class="policy-budget-grid">
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
									<details class="policy-evidence-note">
										<summary>Sailing assumption</summary><Label for="ferry-speed"
											>Assumed speed · km/h</Label
										><Input
											id="ferry-speed"
											type="number"
											min="10"
											max="60"
											bind:value={ferrySpeed}
										/>
										<p>
											Return crossings and terminal layovers must finish within this window. Sailing
											time is an estimate; sea conditions and operational approval need review.
										</p>
									</details>
									<Button
										variant="outline"
										disabled={ferryPreviewing ||
											ferryLoading ||
											checkingBudget ||
											!ferryInput.payload ||
											!budgetLimits.allowed}
										onclick={() => void previewFerry()}
										><Ship size={15} />{ferryPreviewing
											? 'Preparing service and costs…'
											: ferryPreview
												? 'Update service preview'
												: 'Preview route & costs'}</Button
									>
								</div>{/if}
							{#if ferryDestination && !ferryInput.payload}<p
									class="policy-budget-alert"
									role="status"
								>
									{ferryInput.error}
								</p>{/if}
							{#if ferryError}<p class="policy-error" role="alert">{ferryError}</p>{/if}
							{#if ferryPreview}<div
									class="ferry-service-preview"
									data-ferry-draft-status={ferryPreview.status}
								>
									{#if ferryPreview.summary}{@const summary = ferryPreview.summary}<strong
											>{summary.name}</strong
										>
										<div class="ferry-plan-metrics">
											<span><b>{Math.round(summary.crossing_minutes)} min</b>estimated sailing</span
											><span><b>{summary.departures_each_direction}</b>departures each way</span
											><span><b>MVR 0</b>new port construction</span>
										</div>
										<p class="ferry-landing-names">
											{summary.origin_terminal.name}
											<ArrowRight size={12} />
											{summary.destination_terminal.name}
										</p>
										<small>{summary.qualification}</small>{/if}
									{#each ferryPreview.reasons as reason, i (i)}<p>{reason}</p>{/each}
									{#if ferryPreview.quote}<div class="ferry-cost-preview">
											<span>Proposal total with this service</span>
											<p>
												<strong
													>MVR {formatAmount(
														ferryPreview.quote.economics.delta.capital_mvr,
														true
													)}</strong
												> upfront
											</p>
											<p>
												<strong
													>MVR {formatAmount(
														ferryPreview.quote.economics.delta.annual_operating_mvr,
														true
													)}</strong
												> per year
											</p>
										</div>
										{#if !ferryPreview.quote.budget.allowed}<p
												class="policy-budget-alert"
												role="alert"
											>
												{ferryPreview.quote.budget.reasons.join(' ')}
											</p>{/if}{/if}
									{#if operations.length + ferryPreview.operations.length > 100}<p
											class="policy-budget-alert"
											role="alert"
										>
											Remove a change before adding this service; the proposal has a 100-change
											limit.
										</p>{/if}
									<Button disabled={!ferryAllowed} onclick={confirmFerry}
										><Check size={15} />Add ferry service to proposal</Button
									>
								</div>{/if}
							<p class="ferry-no-construction">
								This funds a ferry service, using mapped landing places. It does not build a port.
								Landing suitability and permissions still need confirmation.
							</p>
						</section>{/if}
					{#if pending}<p class="policy-placement-hint" role="status">
							Your {pendingDecision?.label.toLowerCase()} is on the map. Drag its pin to adjust, then
							confirm or cancel above it.
						</p>{/if}
					{#if operations.length}<div class="policy-draft-heading">
							<h3>On your map · {draftItems.length} changes</h3>
							<Button
								variant="ghost"
								size="icon-sm"
								disabled={!history.length}
								aria-label="Undo proposal change"
								onclick={undo}><Undo2 size={16} /></Button
							>
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
						</ol>{:else}<p class="policy-empty">
							Your map is the canvas. Add a location or generate a draft to start comparing.
						</p>{/if}
					{#if draftedFerries.length}<div class="policy-ferry-outcome">
							<Ship size={18} />
							<div>
								<strong
									>{draftedFerries.length} ferry service{draftedFerries.length === 1 ? '' : 's'} in your
									proposal</strong
								>{#each draftedFerries as ferry, i (i)}<p>
										{ferry.name} · {ferry.departures_each_direction} departures each way · {Math.round(
											ferry.crossing_minutes
										)} min estimated sailing
									</p>{/each}<small
									>The route is shown on the map. The forecast below measures walking to public
									transport, healthcare or education separately from the island connection.</small
								>
							</div>
						</div>{/if}
					<div class="policy-forecast-goal">
						<Label for="map-goal">Compare residents' access to</Label><select
							id="map-goal"
							value={goal}
							onchange={(event) => setGoal(event.currentTarget.value as typeof goal)}
							><option value="transport">Public transport · walking access</option><option
								value="healthcare">Healthcare</option
							><option value="education">Education</option></select
						><small
							>Public transport measures walking to a mapped stop or ferry landing place.
							Island-to-island service connections are reviewed separately.</small
						>
					</div>
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
							Uses the captured schedule and modeled {String(request.assumptions.population_year)} population.
							This is an access scenario, not a prediction of future demand.
						</p>
					</details>
					<p class="policy-qualification">
						Costs are editable planning illustrations. A bus stop alone adds no service. Draft
						siting, land rights, staffing and recurring funding require review.
					</p>
					{#if onAdvanced}<Button variant="ghost" size="sm" onclick={onAdvanced}
							>Advanced service & fleet tools <ArrowRight size={14} /></Button
						>{/if}
					<small class="policy-saved">{savedMessage}</small>
				{/if}
			</div>
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
						{stale}
						operationCount={draftItems.length}
						preview={!!pending || ferryOpen || busOpen}
						previewChecking={(!!pending && !quotedPlacement) ||
							(ferryOpen && !ferryPreview?.quote) ||
							(busOpen && !busPreview)}
						gainedResidents={pending
							? pendingEvaluation?.summary.gained_residents
							: !stale
								? evaluation?.summary.gained_residents
								: null}
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
	{#if !opened && hasDraftContext && !ferryOpen}<div
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
				{stale}
				operationCount={draftItems.length}
				preview={!!pending}
				previewChecking={!!pending && !quotedPlacement}
				gainedResidents={pending
					? pendingEvaluation?.summary.gained_residents
					: !stale
						? evaluation?.summary.gained_residents
						: null}
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
	.proposal-floating-budget {
		position: absolute;
		top: calc(148px + var(--map-navigation-offset, 0px));
		right: 18px;
		width: 340px;
		z-index: 6;
		border-radius: 16px;
		background: #fffffff5;
		box-shadow: 0 10px 35px #183d3320;
	}
	.proposal-open-draft {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 10px 16px;
		font-size: 11px;
		color: #22634f;
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
		border: 1px solid #d7e2dc;
		border-radius: 12px;
		background: #fffffff5;
		box-shadow: 0 5px 22px #183d3312;
		font-size: 12px;
	}
	.proposal-placement-status small {
		display: block;
		margin-top: 3px;
		font-size: 10px;
		color: #617568;
	}
	.proposal-placement-status button,
	.proposal-action-feedback button {
		display: inline-flex;
		padding: 4px;
		border-radius: 5px;
	}
	.proposal-action-feedback button {
		color: #16735a;
		font-weight: 600;
	}
	.proposal-map-views {
		display: flex;
		gap: 2px;
	}
	.policy-bus-composer {
		display: grid;
		gap: 10px;
		padding: 14px;
		border: 1px solid #d9e3db;
		border-radius: 12px;
		background: #f7faf6;
	}
	.policy-bus-composer header {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.policy-bus-composer h3 {
		font-size: 15px;
		margin: 0;
	}
	.policy-bus-composer p,
	.policy-bus-composer small {
		font-size: 11px;
		line-height: 1.6;
		color: #5b6f63;
	}
	.policy-bus-composer select {
		width: 100%;
		padding: 9px;
		border: 1px solid #d6dfd8;
		border-radius: 8px;
		font-size: 12px;
		background: white;
	}
	.bus-service-preview {
		display: grid;
		gap: 10px;
		font-size: 12px;
	}
	.ferry-map-steps {
		display: grid;
		gap: 7px;
	}
	.ferry-map-steps button {
		display: grid;
		grid-template-columns: 24px 1fr;
		column-gap: 7px;
		text-align: left;
		padding: 9px;
		border: 1px solid #d9e3df;
		border-radius: 9px;
		background: white;
	}
	.ferry-map-steps span {
		grid-row: 1/3;
		align-self: center;
		display: grid;
		place-items: center;
		border-radius: 50%;
		background: #e0eee8;
		width: 24px;
		height: 24px;
		font-size: 11px;
		color: #1c6b52;
	}
	.ferry-map-steps strong {
		font-size: 12px;
	}
	.ferry-map-steps small {
		color: #577064;
		font-size: 10px;
		margin-top: 3px;
	}
	.proposal-map-views button:active,
	.ferry-map-steps button:active,
	.proposal-open-draft:active {
		transform: scale(0.98);
	}
	.proposal-map-views button:disabled {
		opacity: 0.55;
		cursor: wait;
	}
	.policy-map-controls {
		position: absolute;
		right: calc(var(--map-controls-right, 18px) + 108px);
		bottom: 24px;
		z-index: 5;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		max-width: calc(100% - var(--map-controls-right, 18px) - 88px);
		padding: 4px;
		border: 1px solid #d7e2dc;
		border-radius: 14px;
		background: #fffffff5;
		box-shadow: 0 4px 22px #1a433f12;
		backdrop-filter: blur(10px);
	}
	.policy-lens-bar {
		display: flex;
		align-items: center;
		gap: 3px;
		padding: 2px;
		white-space: nowrap;
	}
	.policy-lens-bar > span {
		display: flex;
		gap: 6px;
		align-items: center;
		font-size: 11px;
		color: #66756c;
		padding: 0 8px;
	}
	.policy-lens-bar button {
		font-size: 12px;
		border-radius: 7px;
		padding: 7px 10px;
		color: #53635c;
	}
	.policy-lens-bar button.active {
		background: #dff0e8;
		color: #185943;
		font-weight: 650;
	}
	.policy-lens-bar .lens-info {
		padding: 6px;
	}
	.policy-lens-bar select {
		width: 74px;
		padding: 6px;
		border: 1px solid #d9e2dd;
		border-radius: 7px;
		background: #f5f8f3;
		color: #185943;
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
		width: 370px;
		z-index: 7;
		display: flex;
		flex-direction: column;
		border: 1px solid #dae3dc;
		border-radius: 17px;
		background: #fffffff9;
		box-shadow: 0 12px 38px #1c3e3722;
		overflow: hidden;
		animation: panel-in 180ms ease-out;
	}
	.policy-map-panel > header {
		flex-shrink: 0;
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 20px 20px 14px;
		gap: 12px;
	}
	.policy-map-panel h2 {
		font-size: 22px;
		line-height: 1.2;
		margin: 6px 0 0;
		letter-spacing: -0.6px;
	}
	.policy-map-panel .eyebrow {
		font-size: 9px;
		color: #6b7b70;
		letter-spacing: 1.3px;
	}
	.policy-panel-tabs {
		flex-shrink: 0;
		display: flex;
		border-bottom: 1px solid #e3e9e4;
		padding: 0 20px;
		gap: 20px;
	}
	.policy-panel-tabs button {
		font-size: 13px;
		padding: 10px 0;
		color: #78847a;
		border-bottom: 2px solid transparent;
	}
	.policy-panel-tabs button.active {
		color: #245b40;
		border-color: #477d55;
		font-weight: 650;
	}
	.policy-panel-tabs span {
		border-radius: 5px;
		background: #e8eee6;
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
	.policy-intro {
		font-size: 13px;
		line-height: 1.6;
		color: #526257;
		margin: 0;
	}
	.policy-map-key {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
		font-size: 10px;
		color: #69786d;
	}
	.policy-map-key span {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.policy-map-key i {
		width: 9px;
		height: 9px;
		border-radius: 3px;
	}
	.policy-qualification {
		font-size: 11px;
		line-height: 1.65;
		color: #7b8276;
		margin: 0;
	}
	.policy-population {
		display: grid;
		grid-template-columns: 1fr auto;
		padding: 12px;
		background: #f1f5ee;
		border-radius: 10px;
		gap: 5px;
	}
	.policy-population span {
		font-size: 12px;
		color: #64705f;
	}
	.policy-population strong {
		font-variant-numeric: tabular-nums;
		font-size: 15px;
	}
	.policy-population small {
		grid-column: 1/-1;
		font-size: 10px;
		color: #78816d;
		line-height: 1.5;
	}
	.policy-need-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		border-bottom: 1px solid #e9ede6;
		padding: 8px 0 13px;
		text-align: left;
		gap: 8px;
	}
	.policy-need-row > span {
		display: grid;
		grid-template-columns: 22px 1fr;
		align-items: center;
		gap: 5px 8px;
	}
	.policy-need-row :global(svg) {
		grid-row: 1/3;
		color: #51735a;
	}
	.policy-need-row strong {
		font-size: 13px;
		font-weight: 600;
	}
	.policy-need-row small {
		font-size: 10px;
		color: #798476;
	}
	.policy-need-row b {
		font-size: 9px;
		font-weight: 500;
		padding: 4px 6px;
		background: #f5e9dd;
		color: #996744;
		border-radius: 5px;
		white-space: nowrap;
	}
	.policy-need-row b.unknown {
		background: #edeef2;
		color: #777b8b;
	}
	.policy-reasons {
		margin: -4px 0 3px;
		padding-left: 16px;
		font-size: 11px;
		color: #66745f;
		line-height: 1.7;
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
		color: #68765f;
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
		color: #7b8375;
	}
	.policy-priority-options {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.policy-priorities button {
		border: 1px solid #dce4d7;
		padding: 6px 10px;
		border-radius: 6px;
		color: #6b795f;
	}
	.policy-priorities button.active {
		background: #edf4e6;
		border-color: #b8cba8;
		color: #476b35;
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
		color: #7c8674;
	}
	.policy-palette {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 7px;
	}
	.policy-ferry-entry {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 13px;
		border: 1px solid #c8dfe2;
		border-radius: 11px;
		background: #eff7f8;
		color: #245c6b;
		text-align: left;
		transition:
			background 150ms ease,
			border-color 150ms ease;
	}
	.policy-ferry-entry:hover,
	.policy-ferry-entry.active {
		background: #e5f2f4;
		border-color: #7eafb7;
	}
	.policy-ferry-entry:disabled {
		opacity: 0.5;
	}
	.policy-ferry-entry > span {
		flex: 1;
		display: grid;
		gap: 4px;
	}
	.policy-ferry-entry strong {
		font-size: 12px;
		font-weight: 650;
	}
	.policy-ferry-entry small {
		font-size: 10px;
		line-height: 1.5;
		color: #5f7c83;
	}
	.policy-ferry-composer {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 15px;
		border: 1px solid #c7dde0;
		border-radius: 12px;
		background: #fbfefe;
		min-width: 0;
	}
	.policy-ferry-composer > header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.policy-ferry-composer h3 {
		font-size: 15px;
		font-weight: 650;
		margin: 4px 0 0;
		color: #254d58;
	}
	.policy-ferry-composer .eyebrow {
		color: #68868b;
		font-size: 8px;
	}
	.ferry-origin {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 7px;
		font-size: 12px;
		color: #5b747b;
	}
	.ferry-origin strong {
		color: #254d58;
	}
	.ferry-destination,
	.ferry-service-fields {
		display: flex;
		flex-direction: column;
		gap: 9px;
		min-width: 0;
	}
	.ferry-selected-destination {
		display: flex;
		align-items: center;
		gap: 7px;
		background: #fff;
		padding: 10px;
		border: 1px solid #c4d9dd;
		border-radius: 8px;
		font-size: 12px;
		text-align: left;
		color: #295e6c;
	}
	.ferry-selected-destination strong {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.ferry-selected-destination > span {
		font-size: 10px;
		color: #63868e;
	}
	.ferry-island-results {
		border: 1px solid #dce8e9;
		border-radius: 8px;
		max-height: 218px;
		overflow-y: auto;
		background: #fff;
	}
	.ferry-island-results > button {
		width: 100%;
		display: flex;
		gap: 8px;
		align-items: center;
		padding: 9px 10px;
		font-size: 12px;
		color: #305563;
		text-align: left;
		border-bottom: 1px solid #edf2f2;
	}
	.ferry-island-results > button:hover {
		background: #eef7f7;
	}
	.ferry-island-results > button > span {
		display: grid;
		gap: 3px;
		flex: 1;
	}
	.ferry-island-results small {
		font-size: 9px;
		color: #7a8f94;
	}
	.ferry-island-results > p {
		font-size: 11px;
		color: #6c8186;
		padding: 10px;
		margin: 0;
		line-height: 1.6;
	}
	.ferry-progress {
		display: flex;
		gap: 7px;
		align-items: center;
		color: #567781;
		font-size: 11px;
		line-height: 1.6;
		margin: 0;
	}
	.ferry-connection {
		border-left: 3px solid #c0a76b;
		background: #faf6ed;
		padding: 11px;
		border-radius: 0 8px 8px 0;
	}
	.ferry-connection.verified {
		border-color: #4e9d86;
		background: #eef7f3;
	}
	.ferry-connection > strong {
		font-size: 11px;
		font-weight: 650;
		line-height: 1.6;
		color: #665d44;
	}
	.ferry-connection p,
	.ferry-service-preview > p {
		font-size: 10px;
		line-height: 1.7;
		color: #73776b;
		margin: 5px 0 0;
	}
	.ferry-terminal-evidence {
		display: grid;
		gap: 8px;
		margin-top: 10px;
		padding-top: 9px;
		border-top: 1px solid #e2e4d7;
	}
	.ferry-terminal-evidence > span {
		display: flex;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 4px 8px;
		font-size: 10px;
		color: #6f776d;
	}
	.ferry-terminal-evidence b {
		font-size: 9px;
		font-weight: 550;
	}
	.ferry-service-fields > div:first-child {
		display: grid;
		gap: 7px;
	}
	.ferry-service-preview {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding-top: 13px;
		border-top: 1px solid #d7e5e7;
	}
	.ferry-service-preview > strong {
		font-size: 12px;
		color: #305867;
	}
	.ferry-plan-metrics {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 7px;
	}
	.ferry-plan-metrics span {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 9px;
		color: #71888d;
		line-height: 1.5;
	}
	.ferry-plan-metrics b {
		font-size: 17px;
		font-weight: 650;
		color: #285e6c;
		letter-spacing: -0.5px;
		font-variant-numeric: tabular-nums;
	}
	.ferry-service-preview .ferry-landing-names {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 5px;
		margin: 0;
		color: #4e717b;
	}
	.ferry-service-preview > small,
	.ferry-no-construction {
		font-size: 10px;
		line-height: 1.7;
		color: #788a8c;
		margin: 0;
	}
	.ferry-cost-preview {
		display: grid;
		gap: 5px;
		padding: 11px;
		background: #edf5f6;
		border-radius: 8px;
	}
	.ferry-cost-preview > span {
		font-size: 9px;
		color: #6e8389;
	}
	.ferry-cost-preview p {
		margin: 0;
		font-size: 10px;
		color: #67808a;
	}
	.ferry-cost-preview strong {
		font-size: 13px;
		font-variant-numeric: tabular-nums;
		color: #315e6b;
	}
	.policy-ferry-outcome {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 12px;
		background: #eef6f7;
		border: 1px solid #d7e6e9;
		border-radius: 10px;
		color: #3a6974;
	}
	.policy-ferry-outcome > :global(svg) {
		flex-shrink: 0;
		margin-top: 2px;
	}
	.policy-ferry-outcome strong {
		font-size: 11px;
	}
	.policy-ferry-outcome p {
		font-size: 10px;
		line-height: 1.7;
		margin: 5px 0;
	}
	.policy-ferry-outcome small {
		font-size: 9px;
		line-height: 1.7;
		color: #788e93;
		display: block;
	}
	.policy-palette button {
		display: flex;
		align-items: center;
		flex-direction: column;
		gap: 7px;
		border: 1px dashed #b8c6b0;
		padding: 12px 5px 9px;
		background: #f5f8f1;
		border-radius: 9px;
		cursor: grab;
		position: relative;
		color: #4d6a3e;
	}
	.policy-palette button:active {
		cursor: grabbing;
	}
	.policy-palette .palette-drag-icon {
		display: grid;
		place-items: center;
		width: 44px;
		height: 44px;
		border: 2px solid #fff;
		border-radius: 14px;
		background: #176c61;
		color: #fff;
		box-shadow: 0 3px 8px #123d3429;
		flex-shrink: 0;
	}
	.policy-palette button:disabled {
		cursor: default;
		opacity: 0.5;
	}
	.policy-palette button:focus-visible {
		outline: 2px solid #176c61;
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
		background: #edf5f0;
		color: #315f51;
	}
	.policy-budget-alert {
		background: #fff1ed;
		color: #a14431;
	}
	.policy-map-panel select {
		background: #fff;
		border: 1px solid #d4dfca;
		border-radius: 7px;
		font-size: 12px;
		padding: 8px;
		width: 100%;
		color: #4c6040;
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
		border: 1px solid #e5eadd;
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
		background: #edf1e6;
		color: #667d50;
		padding: 4px 7px;
	}
	.policy-operation-list strong {
		font-size: 11px;
		font-weight: 500;
		line-height: 1.5;
	}
	.policy-empty {
		font-size: 12px;
		line-height: 1.65;
		color: #939983;
		text-align: center;
		padding: 12px;
	}
	.policy-evidence-note {
		font-size: 11px;
		color: #77836a;
		border: 1px solid #e3e9dc;
		border-radius: 8px;
		padding: 11px;
	}
	.policy-evidence-note summary {
		cursor: pointer;
		color: #526347;
		font-weight: 550;
	}
	.policy-evidence-note[open] {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.policy-evidence-note ul {
		padding-left: 16px;
		line-height: 1.7;
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
	.policy-saved {
		font-size: 10px;
		color: #8b9380;
	}
	.policy-error {
		font-size: 12px;
		background: #fff0e7;
		padding: 12px;
		border-radius: 8px;
		color: #9c5c44;
		line-height: 1.6;
	}
	.policy-working {
		font-size: 12px;
		color: #7b866f;
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.policy-suggestion {
		background: #f0f5e8;
		border: 1px solid #cdddb8;
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
		color: #566f40;
		font-size: 12px;
	}
	.policy-suggestion small {
		display: block;
		font-size: 10px;
		color: #82916c;
		margin-top: 4px;
	}
	.policy-suggestion p {
		font-size: 10px;
		line-height: 1.6;
		margin: 0;
		color: #7b846a;
	}
	.policy-suggestion > div {
		display: flex;
		gap: 5px;
	}
	.policy-map-panel > footer {
		flex-shrink: 0;
		border-top: 1px solid #dde5d6;
		background: #f9fbf5;
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
		border: 1px solid #d0dfc1;
		border-radius: 12px;
		background: #fffffff5;
		color: #52713d;
		box-shadow: 0 4px 16px #2c402014;
		font-size: 12px;
	}
	.policy-recalculating small {
		display: block;
		font-size: 10px;
		color: #8a977a;
		margin-top: 3px;
	}
	:global(.policy-map-panel .spin),
	:global(.policy-recalculating .spin) {
		animation: spin 1.2s linear infinite;
	}
	.policy-selected-cell {
		padding: 12px;
		border: 1px solid #c8dcca;
		background: #f2f8ef;
		border-radius: 10px;
		display: grid;
		gap: 8px;
	}
	.policy-selected-cell strong {
		font-size: 12px;
	}
	.policy-selected-cell > span,
	.policy-selected-cell small {
		color: #687d60;
		font-size: 10px;
		line-height: 1.5;
	}
	.policy-selected-cell p {
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
	.policy-population details {
		grid-column: 1/-1;
		font-size: 10px;
		color: #78816d;
		line-height: 1.5;
	}
	.policy-population summary {
		cursor: pointer;
	}
	.policy-forecast-goal {
		display: grid;
		gap: 8px;
		padding: 12px;
		border: 1px solid #dce6d4;
		border-radius: 10px;
	}
	.policy-forecast-goal select {
		border: 1px solid #cedbc5;
		padding: 8px 9px;
		border-radius: 6px;
		background: white;
		font-size: 12px;
	}
	.policy-forecast-goal small {
		font-size: 10px;
		line-height: 1.5;
		color: #7b8570;
	}
	:global(.policy-inspect-trigger) {
		max-width: 100%;
		justify-content: flex-start;
		height: 32px;
		padding-inline: 10px;
		font-size: 12px;
		color: #48665d;
		background: transparent;
		box-shadow: none;
	}
	:global(.policy-inspect-trigger span) {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	@keyframes panel-in {
		from {
			opacity: 0;
			translate: 8px 0;
		}
		to {
			opacity: 1;
			translate: 0 0;
		}
	}
	button:focus-visible {
		outline: 2px solid #4d7655;
		outline-offset: 3px;
	}
	@media (max-width: 1100px) {
		.policy-map-controls {
			max-width: 260px;
		}
		.policy-map-controls.panel-open {
			display: none;
		}
		.policy-lens-bar > span {
			display: none;
		}
		.policy-lens-bar .coverage-lens-option {
			display: none;
		}
		.policy-lens-bar .compact-coverage-lens {
			display: block;
			width: 145px;
			padding: 7px 9px;
			font-size: 12px;
		}
		.policy-map-panel {
			top: calc(116px + var(--map-navigation-offset, 0px));
			bottom: 16px;
			width: 340px;
		}
		.policy-recalculating {
			left: 20px;
			transform: none;
			bottom: 82px;
		}
	}
	@media (max-width: 700px) {
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
			bottom: 154px;
			max-width: none;
			flex-direction: row;
			align-items: center;
			gap: 2px;
		}
		.policy-lens-bar {
			flex-shrink: 0;
			gap: 1px;
			padding: 0;
		}
		:global(.policy-inspect-trigger) {
			flex: 1;
			min-width: 0;
			max-width: none;
			padding-inline: 6px;
			gap: 5px;
			font-size: 11px;
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
			width: 116px;
			font-size: 11px;
			padding: 7px 5px;
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
		.policy-map-panel > header {
			padding: 10px 16px 8px;
		}
		.policy-map-panel h2 {
			font-size: 19px;
		}
		.policy-panel-scroll {
			padding: 14px 16px;
			gap: 12px;
			flex: 1;
		}
		.policy-panel-tabs button {
			padding-block: 8px;
		}
		.policy-panel-tabs {
			padding-inline: 16px;
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
