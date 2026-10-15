<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import {
		ArrowRight,
		BusFront,
		Check,
		ChevronDown,
		GraduationCap,
		Hospital,
		Layers,
		MapPin,
		Plus,
		RefreshCw,
		Sparkles,
		Trash2,
		Undo2,
		X
	} from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { api } from '#lib/api.js';
	import { impactColors, type PlanningOperation } from '#lib/planning-map.js';
	import { displayGapHexes, displayImpactHexes } from '#lib/display-grid.js';
	import { GAP_PALETTE } from '#lib/map-overlay.js';
	import {
		assessDraftBudget,
		draftCosts,
		distanceToRoad,
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
		kind: 'inspect' | 'gaps' | 'compose' | 'close' | 'confirm' | 'cancel-placement';
	} | null;
	type BudgetQuote = {
		economics: PlanningEconomics;
		budget: {
			allowed: boolean;
			reasons: string[];
			capital: { remaining_mvr: number | null };
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
		cell = null,
		onLensChange,
		onState,
		onPickKind,
		onCloseOthers,
		onFocus,
		onDetails,
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
		cell?: Record<string, unknown> | null;
		onLensChange: (value: PolicyLens) => void;
		onState: (value: MapPolicyState) => void;
		onPickKind: (kind: PlacementKind | null) => void;
		onCloseOthers: () => void;
		onFocus: (coordinates: Coordinates) => void;
		onDetails: () => void;
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
	let dataError = $state('');
	let error = $state('');
	let title = $state('');
	let operations = $state.raw<PlanningOperation[]>([]);
	let history = $state.raw<PlanningOperation[][]>([]);
	let pending = $state<{ coordinates: Coordinates; kind: PlacementKind } | null>(null);
	let capitalBudget = $state<number | string>(150_000_000);
	let annualBudget = $state<number | string>(25_000_000);
	let goal = $state<'healthcare' | 'education'>('healthcare');
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
	let suggestionContext = '';
	let evaluateTimer: ReturnType<typeof setTimeout> | undefined;
	const current = $derived(national?.islands.find((row) => row.island_id === islandId));
	$effect(() => {
		if (title === 'Selected island service improvement' && current?.name)
			title = `${current.name} service improvement`;
	});
	const supported = $derived(current?.planning_supported ?? false);
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
	const costModelKey = $derived(financialKey(request));
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
	const suggestionSignature = $derived(JSON.stringify({ request, priorities, costs }));
	const stale = $derived(!!evaluation && evaluatedSignature !== signature);
	const roadDistance = $derived(
		pending && baseline ? distanceToRoad(pending.coordinates, baseline.graph_edges) : null
	);
	const pendingWithin = $derived(
		pending && islandId ? pointWithinIsland(pending.coordinates, boundaryFeatures, islandId) : null
	);
	const placementKey = $derived(`${costModelKey}:${JSON.stringify(pending)}`);
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
					allowed:
						!!baseline &&
						!!boundaryFeatures &&
						!loading &&
						operations.length < 100 &&
						pendingWithin !== false &&
						budgetLimits.allowed &&
						!!quotedPlacement?.budget.allowed &&
						!placementError &&
						!checkingBudget,
					reason:
						loading || !baseline
							? 'Loading the island cost and site evidence…'
							: !boundaryFeatures
								? boundaryError || 'Loading the detailed island boundary…'
								: operations.length >= 100
									? 'This proposal has reached the 100-change limit.'
									: pendingWithin === false
										? `Move this pin onto ${islandName}. Water and other islands cannot be used.`
										: !budgetLimits.allowed
											? budgetLimits.reason
											: placementError || quotedPlacement?.budget.reasons.join(' '),
					remaining: quotedPlacement?.budget.capital.remaining_mvr,
					note:
						roadDistance !== null
							? `${Math.round(roadDistance)} m from mapped roads.${roadDistance > 100 ? ' Outside the 100 m modeled connection limit.' : ' Within the modeled connection limit.'}`
							: pendingWithin === null
								? 'Land boundary unavailable; verify this site before proceeding.'
								: undefined,
					checking:
						loading ||
						(!boundaryFeatures && !boundaryError) ||
						checkingBudget ||
						(!quotedPlacement && !placementError && budgetLimits.allowed && pendingWithin !== false)
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
						...(suggested?.selected.flatMap((item) => item.map_features?.features ?? []) ?? [])
					]
	});
	const impact = $derived(
		restoredScope === scopedKey && evaluation && !stale && showImpact && displayGrid.features.length
			? displayImpactHexes(baseline?.origins ?? [], evaluation.origins ?? [], displayGrid)
			: emptyFeatures()
	);
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

	onMount(() => {
		mounted = true;
		return () => {
			clearTimeout(evaluateTimer);
			nationalController?.abort();
			scopeController?.abort();
			evaluateController?.abort();
			suggestionController?.abort();
			quoteController?.abort();
			placementQuoteController?.abort();
		};
	});
	$effect(() => {
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
		if (!mounted || !scope || !active || restoredScope === scope) return;
		untrack(() => void loadScope(scope));
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
		evaluation = null;
		evaluatedSignature = '';
		error = '';
		evaluationQueued = false;
		evaluating = false;
		review = false;
		onPickKind(null);
		if (restore) {
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
					if (savedGoal === 'healthcare' || savedGoal === 'education') goal = savedGoal;
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
			quoteController?.abort();
			checkingBudget = false;
			pending = {
				coordinates: [placement!.longitude, placement!.latitude],
				kind: placement!.kind ?? 'add_school'
			};
			suggested = null;
			opened = true;
			section = 'proposal';
			onPickKind(null);
			onCloseOthers();
		});
	});
	$effect(() => {
		if (!active || !incomingOperation || !baseline || loading || restoredScope !== scopedKey)
			return;
		const incoming = incomingOperation;
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
				pending = { ...pending, coordinates: moved!.coordinates };
			} else if (operations[moved!.index])
				change(
					operations.map((operation, i) =>
						i === moved!.index ? { ...operation, coordinates: moved!.coordinates } : operation
					)
				);
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
			panelOpen: opened
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
			loading ||
			!budgetLimits.allowed ||
			pendingWithin === false
		)
			return;
		const controller = new AbortController();
		placementQuoteController = controller;
		const payload: PlanningReviewRequest = {
			...request,
			operations: [
				...operations,
				{ type: site.kind, island_id: islandId ?? undefined, coordinates: site.coordinates }
			]
		};
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
				showImpact = section === 'proposal';
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
	function financialKey(value: PlanningReviewRequest) {
		// Journey display settings do not change costs; every economic assumption does.
		return JSON.stringify({
			...value,
			assumptions: {
				...value.assumptions,
				goal: undefined,
				target_minutes: undefined,
				include_origin_geometry: undefined,
				include_journey_geometry: undefined,
				include_world: undefined
			}
		});
	}
	function commitChange(next: PlanningOperation[], undoing = false) {
		history = undoing ? history.slice(0, -1) : [...history.slice(-29), operations];
		operations = next;
		inferGoal(next);
		suggested = null;
		error = '';
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
				key: financialKey({ ...request, operations: next }),
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
		if (change(history.at(-1)!, true)) pending = null;
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
		pending = null;
		review = false;
		cancelSuggestions();
		onPickKind(null);
	}
	function begin(kind: PlacementKind) {
		quoteController?.abort();
		checkingBudget = false;
		open('proposal');
		pending = null;
		suggested = null;
		onPickKind(kind);
	}
	function confirm() {
		if (!pending || operations.length >= 100) return;
		if (!pendingDecision?.allowed) {
			error = pendingDecision?.reason || 'Verify this site and its budget before adding it.';
			return;
		}
		if (!islandId || pointWithinIsland(pending.coordinates, boundaryFeatures, islandId) === false) {
			error =
				'Choose a site inside the selected island. Water and other islands cannot be used for this proposal.';
			return;
		}
		const kind = pending.kind;
		const next: PlanningOperation[] = [
			...operations,
			{
				type: kind,
				island_id: islandId ?? undefined,
				coordinates: pending.coordinates,
				name: `${islandName} proposed ${kind === 'add_school' ? 'school' : kind === 'add_hospital' ? 'hospital' : 'bus stop'}`,
				metadata: { proposal_id: `proposal:${kind}:${crypto.randomUUID()}` }
			}
		];
		if (!quotedPlacement) return;
		financialQuote = {
			key: financialKey({ ...request, operations: next }),
			capital: quotedPlacement.economics.delta.capital_mvr ?? null,
			annual: quotedPlacement.economics.delta.annual_operating_mvr ?? null
		};
		commitChange(next);
		pending = null;
	}
	function inferGoal(next: PlanningOperation[]) {
		const school = next.some((operation) => operation.type === 'add_school');
		const hospital = next.some((operation) => operation.type === 'add_hospital');
		if (school && !hospital) goal = 'education';
		else if (hospital && !school) goal = 'healthcare';
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
		if (
			![Number(capitalBudget), Number(annualBudget)].every(
				(value) => Number.isFinite(value) && value >= 0
			)
		) {
			error = 'Enter a valid capital budget and yearly running budget.';
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
</script>

{#if active}
	<div class="policy-lens-bar" aria-label="Service coverage map">
		{#if operations.length}
			<select
				aria-label="Map colours"
				title="Current service gaps or proposed access changes"
				value={impact.features.length ? 'impact' : 'gaps'}
				onchange={(event) => (showImpact = event.currentTarget.value === 'impact')}
			>
				<option value="gaps">Gaps</option>
				<option value="impact" disabled={!evaluation || stale}>Impact</option>
			</select>
		{:else}<span><Layers size={15} />Service gaps</span>{/if}
		{#each [{ id: 'overall', label: 'All services' }, { id: 'transport', label: 'Transport' }, { id: 'health', label: 'Health' }, { id: 'education', label: 'Education' }] as option (option.id)}
			<button
				class:active={lens === option.id && !impact.features.length}
				aria-pressed={lens === option.id && !impact.features.length}
				onclick={() => {
					showImpact = false;
					onLensChange(option.id as PolicyLens);
				}}>{option.label}</button
			>
		{/each}
		<button
			class="lens-info"
			aria-label={impact.features.length
				? 'Explain proposal impact colours'
				: 'Explain service gap colours'}
			onclick={() => open('needs')}><ChevronDown size={16} /></button
		>
	</div>
	{#if !opened}<Button
			variant="outline"
			class="policy-inspect-trigger"
			onclick={() => open('needs')}
			><MapPin size={15} />{islandName} · {impact.features.length
				? 'proposal impact'
				: 'service gaps'}</Button
		>{/if}
	{#if opened}<section
			class="policy-map-panel"
			class:placing={!!pending}
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
					>Your proposal {#if operations.length}<span>{operations.length}</span>{/if}</button
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
							? `Your proposal’s modeled ${goal === 'healthcare' ? 'healthcare' : 'education'} access. Select a hexagon to compare current and proposed journeys.`
							: needsLabel(current)}
					</p>
					<div class="policy-map-key">
						<span
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
							></i>{impact.features.length ? 'Unchanged / unknown' : 'Unknown'}</span
						>
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
					{#if cell?.origin_id && !impact.features.length}<div
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
								>{formatAmount(cell.population)} modeled residents · {goal === 'healthcare'
									? 'healthcare'
									: 'education'}</span
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
					<Label for="map-proposal-title">Proposal name</Label><Input
						id="map-proposal-title"
						bind:value={title}
						maxlength={160}
					/>
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
						<span>Priorities</span
						>{#each ['transport', 'health', 'education'] as domain (domain)}<button
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
							Detailed resident and road data are not available here. You can save a mapped concept;
							a defensible access forecast needs local network, schedule and population data.
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
						<h3>Or place it yourself</h3>
						<small>Drag onto the map, or select then click a site.</small>
					</div>
					<div class="policy-palette">
						{#each [{ kind: 'add_stop', label: 'Bus stop', icon: BusFront }, { kind: 'add_school', label: 'School', icon: GraduationCap }, { kind: 'add_hospital', label: 'Hospital', icon: Hospital }] as item (item.kind)}<button
								draggable={!!baseline && !loading && !checkingBudget && operations.length < 100}
								disabled={!baseline || loading || checkingBudget || operations.length >= 100}
								ondragstart={(event) => {
									event.dataTransfer?.setData('application/x-policy-placement', item.kind);
									if (event.dataTransfer) {
										event.dataTransfer.effectAllowed = 'copy';
										const icon =
											event.currentTarget.querySelector<HTMLElement>('.palette-drag-icon');
										if (icon) event.dataTransfer.setDragImage(icon, 22, 22);
									}
								}}
								onclick={() => begin(item.kind as PlacementKind)}
								><span class="palette-drag-icon" data-placement-icon={item.kind}
									><item.icon size={24} /></span
								><span>{item.label}</span><Plus size={12} /></button
							>{/each}
					</div>
					{#if pending}<p class="policy-placement-hint" role="status">
							Your {pendingDecision?.label.toLowerCase()} is on the map. Drag its pin to adjust, then
							confirm or cancel above it.
						</p>{/if}
					{#if operations.length}<div class="policy-draft-heading">
							<h3>On your map · {operations.length} changes</h3>
							<Button
								variant="ghost"
								size="icon-sm"
								disabled={!history.length}
								aria-label="Undo proposal change"
								onclick={undo}><Undo2 size={16} /></Button
							>
						</div>
						<ol class="policy-operation-list">
							{#each operations as operation, i (i)}<li>
									<button onclick={() => focusOperation(i)}
										><span>{i + 1}</span><strong>{operationName(operation)}</strong></button
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
					<div class="policy-forecast-goal">
						<Label for="map-goal">Compare residents' access to</Label><select
							id="map-goal"
							bind:value={goal}
							><option value="healthcare">Healthcare</option><option value="education"
								>Education</option
							></select
						><small
							>Transport changes affect this journey. A mixed proposal can be reviewed for either
							destination.</small
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
					<small class="policy-saved">{savedMessage}</small>
				{/if}
			</div>
			{#if section === 'proposal' && operations.length}<footer>
					<div class="policy-live-benefit" aria-live="polite">
						<span
							>{goal === 'healthcare' ? 'Healthcare' : 'Education'} within {targetMinutes} min</span
						><strong
							>{calculating || stale
								? 'Updating access…'
								: evaluation
									? evaluation.summary.scenario_reachable_residents !== null
										? `${formatAmount(evaluation.summary.scenario_reachable_residents)} modeled residents reached`
										: 'Resident reach unavailable'
									: supported
										? 'Ready to calculate'
										: 'Local access data needed'}</strong
						>{#if evaluation && evaluation.summary.gained_residents !== null && !stale && !calculating}<small
								>{formatAmount(evaluation.summary.gained_residents)} gain access · {formatAmount(
									evaluation.summary.lost_residents
								)} lose access</small
							>{/if}
					</div>
					<ProposalCostStrip
						economics={evaluation && !stale ? evaluation.economics : draftEconomics}
						capitalBudget={Number.isFinite(budgetNumber(capitalBudget))
							? budgetNumber(capitalBudget)
							: null}
						annualBudget={Number.isFinite(budgetNumber(annualBudget))
							? budgetNumber(annualBudget)
							: null}
						pending={calculating}
						{stale}
						operationCount={operations.length}
						onReview={() => {
							review = true;
							if (!evaluation || stale) void evaluate();
						}}
					/>
				</footer>{/if}
		</section>{/if}
	{#if calculating}<div class="policy-recalculating" role="status">
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
	.policy-lens-bar {
		position: absolute;
		top: 15px;
		left: 50%;
		transform: translateX(-50%);
		z-index: 5;
		display: flex;
		align-items: center;
		gap: 3px;
		padding: 5px;
		border: 1px solid #d9e2dd;
		border-radius: 12px;
		background: #fffffff5;
		box-shadow: 0 3px 12px #183d3210;
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
	.policy-map-panel {
		position: absolute;
		right: 18px;
		top: 76px;
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
		display: flex;
		border-bottom: 1px solid #e3e9e4;
		padding: 0 18px;
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
		overflow: auto;
		padding: 18px 20px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		min-height: 0;
		overscroll-behavior: contain;
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
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.policy-budget-grid > div {
		display: flex;
		flex-direction: column;
		gap: 7px;
	}
	.policy-priorities {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 10px;
	}
	.policy-priorities > span {
		margin-right: auto;
		color: #7b8375;
	}
	.policy-priorities button {
		border: 1px solid #dce4d7;
		padding: 5px 7px;
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
		margin: 2px 0 5px;
		font-weight: 600;
	}
	.policy-place-heading small {
		font-size: 10px;
		color: #7c8674;
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
		border-top: 1px solid #dde5d6;
		background: #f9fbf5;
		padding: 12px 15px;
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
	.policy-live-benefit {
		display: grid;
		gap: 4px;
		padding-bottom: 10px;
		margin-bottom: 10px;
		border-bottom: 1px solid #dde5d6;
	}
	.policy-live-benefit span,
	.policy-live-benefit small {
		font-size: 10px;
		color: #6d7d60;
	}
	.policy-live-benefit strong {
		font-size: 13px;
		font-variant-numeric: tabular-nums;
		color: #366144;
	}
	:global(.policy-inspect-trigger) {
		position: absolute;
		right: 18px;
		top: 15px;
		z-index: 5;
		font-size: 12px;
		box-shadow: 0 3px 10px #24402412;
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
		.policy-lens-bar {
			left: 18px;
			transform: none;
			top: 65px;
		}
		.policy-lens-bar > span {
			display: none;
		}
		.policy-map-panel {
			top: 116px;
			bottom: 16px;
			width: 340px;
		}
		:global(.policy-inspect-trigger) {
			top: 15px;
		}
		.policy-recalculating {
			left: 20px;
			transform: none;
			bottom: 82px;
		}
	}
	@media (max-width: 640px) {
		:global(.policy-inspect-trigger) {
			top: 116px;
			left: 12px;
			right: auto;
		}
		.policy-lens-bar {
			top: 64px;
			left: 12px;
			right: 12px;
			justify-content: space-between;
		}
		.policy-lens-bar button {
			font-size: 10px;
			padding: 6px;
		}
		.policy-lens-bar select {
			width: 62px;
			padding: 5px 2px;
			font-size: 10px;
		}
		.policy-map-panel {
			right: 10px;
			left: 10px;
			top: auto;
			bottom: 10px;
			width: auto;
			max-height: min(70%, 620px);
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
		.policy-live-benefit {
			grid-template-columns: 1fr auto;
			gap: 3px 6px;
			padding-bottom: 6px;
			margin-bottom: 6px;
		}
		.policy-live-benefit strong {
			grid-column: 1/-1;
			font-size: 11px;
		}
		.policy-live-benefit small {
			grid-column: 2;
			grid-row: 1;
			font-size: 9px;
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
		:global(.policy-inspect-trigger) {
			top: 116px;
			right: auto;
			max-width: calc(100% - 72px);
			font-size: 11px;
		}
		.policy-map-panel > footer {
			padding: 8px 12px;
			flex-shrink: 0;
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
