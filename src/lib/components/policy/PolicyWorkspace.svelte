<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { MapPin, ArrowRight, Download, Play, Pause } from '@lucide/svelte';
	import type { FeatureCollection, Point } from 'geojson';
	import type {
		PlanningBaseline,
		PlanningAction,
		PlanningAssumptions
	} from '#lib/planning/types.ts';
	import type { ForecastBundle } from '#lib/prediction/index.ts';
	import type { OperationsBundle } from '#lib/operations/types.ts';
	import type { TransportContext } from '#lib/context/types.ts';
	import type { PolicyEvidenceBundle } from '#lib/server/data/policyEvidenceSource.ts';
	import { AnalysisWorkerClient } from '#lib/planning/workerClient.ts';
	import { createDefaultAssumptions } from '#lib/planning/defaults.ts';
	import { planningCoverage } from '#lib/planning/coverage.ts';
	import {
		evaluatePolicyOptions,
		policyBriefSnapshot,
		type PolicyDecisionBundle,
		type PolicyAlternative,
		type PolicyMapContext,
		type PolicyOptions
	} from '#lib/policy/decisions.ts';
	import { supportedPolicyDates } from '#lib/policy/sourceEvidence.ts';
	import PolicyMap from './PolicyMap.svelte';
	import PolicyEvidenceDetails from './PolicyEvidenceDetails.svelte';
	import JourneyPlayback from './JourneyPlayback.svelte';

	type View = 'people' | 'bus';
	type Selection = { originId?: string; roadEdgeId?: string };
	type PanelState = {
		view: View;
		originId: string;
		optionId: string;
		delayMinutes: number;
		targetMinutes: number;
		date: string;
		departureMinutes: number;
		roadEdgeId: string | null;
	};
	let {
		baseline,
		prediction,
		snapshotStale = false,
		operations = null,
		transportContext = null,
		policyEvidence = null,
		initialView = 'people',
		showMap = false,
		mapContext,
		onShowMap,
		onOpenEditor,
		onShowEvidence,
		onStateChange,
		onShowLegacy
	}: {
		baseline: PlanningBaseline;
		prediction: ForecastBundle | null;
		snapshotStale?: boolean;
		operations?: OperationsBundle | null;
		transportContext?: TransportContext | null;
		policyEvidence?: PolicyEvidenceBundle | null;
		initialView?: View;
		showMap?: boolean;
		mapContext?: PolicyMapContext;
		onShowMap?: (selection: Selection) => void;
		onOpenEditor?: (handover: {
			actions: PlanningAction[];
			assumptions: PlanningAssumptions;
			originId: string;
		}) => void;
		onShowEvidence?: () => void;
		onStateChange?: (state: PanelState) => void;
		onShowLegacy?: () => void;
	} = $props();
	const defaults = untrack(() => createDefaultAssumptions(baseline));
	let view = $derived<View>(initialView);
	let selectedOption = $state<PolicyAlternative['id']>('keep');
	let selectedOrigin = $state('');
	let selectedIsland = $state('');
	let delayMinutes = $state(5);
	let targetMinutes = $state(defaults.targetMinutes);
	let serviceDate = $state(defaults.date);
	let departure = $state(clock(defaults.departureMinutes));
	let roadEdgeId = $state<string | null>(null);
	let roadSearch = $state('');
	let areaSearch = $state('');
	let baseContext = $state.raw<PolicyMapContext | null>(null);
	let decisions = $state.raw<PolicyDecisionBundle | null>(null);
	let busy = $state(true),
		error = $state(''),
		mounted = $state(false);
	let replayIndex = $state(0),
		playing = $state(false);
	let journeySymbols = $state.raw<FeatureCollection<Point>>({
		type: 'FeatureCollection',
		features: []
	});
	let worker: AnalysisWorkerClient | null = null;
	let revision = 0;
	const chosen = $derived(
		decisions?.alternatives.find((a) => a.id === selectedOption) ??
			decisions?.alternatives[0] ??
			null
	);
	const assumptions = $derived(chosen?.assumptions ?? baseContext?.assumptions ?? defaults);
	const originId = $derived(selectedOrigin || decisions?.focalOriginId || '');
	const journey = $derived(
		chosen?.analysis.origins.find((o) => o.originId === originId)?.after ?? null
	);
	const beforeJourney = $derived(
		decisions?.current.origins.find((o) => o.originId === originId)?.after ?? null
	);
	const origin = $derived(baseline.origins.find((o) => o.id === originId));
	const destination = $derived(
		chosen?.analysis.world.facilities.find((f) => f.id === journey?.destinationId)
	);
	const service = $derived(assumptions.goal === 'education' ? 'school' : 'healthcare');
	const dates = $derived([...new Set([...supportedPolicyDates(baseline), serviceDate])].sort());
	const coverage = $derived(
		planningCoverage(baseline, { date: serviceDate, departureMinutes: minutes(departure) })
	);
	const supportingSources = $derived([
		...(transportContext?.followme.sources ?? []),
		...(transportContext?.mpl.sources ?? []),
		...(transportContext?.aviation.sources ?? []),
		...(policyEvidence?.sources ?? [])
	]);
	const snapshots = $derived(prediction?.bus.replay?.snapshots ?? []);
	const snapshot = $derived(snapshots[Math.min(replayIndex, snapshots.length - 1)] ?? null);
	const replaySymbols = $derived<FeatureCollection<Point>>({
		type: 'FeatureCollection',
		features:
			snapshot?.vehicles.map((v) => ({
				type: 'Feature' as const,
				id: `reported:${v.id}`,
				geometry: { type: 'Point' as const, coordinates: [v.longitude, v.latitude] },
				properties: {
					id: `reported:${v.id}`,
					icon: 'playback-bus',
					mode: 'bus',
					bearing: 0,
					label: 'Reported position · dated replay',
					receivedAt: snapshot.receivedAt,
					observed: true
				}
			})) ?? []
	});
	const areaIsland = $derived(selectedIsland || origin?.islandId || baseline.islands[0]?.id || '');
	const areas = $derived(baseline.origins.filter((o) => o.islandId === areaIsland));
	const roadMatches = $derived(
		(decisions?.roadChoices ?? []).filter((road) => matchesChoice(road.name, roadSearch))
	);
	const filteredRoads = $derived(
		(decisions?.roadChoices ?? []).filter(
			(road) => road.id === roadEdgeId || matchesChoice(road.name, roadSearch)
		)
	);
	const areaChoices = $derived(
		areas.map((area, index) => ({ area, label: areaName(area, index) }))
	);
	const areaMatches = $derived(areaChoices.filter((item) => matchesChoice(item.label, areaSearch)));
	const filteredAreas = $derived(
		areaChoices.filter((item) => item.area.id === originId || matchesChoice(item.label, areaSearch))
	);
	const n = (value: number | null | undefined, digits = 0) =>
		value == null || !Number.isFinite(value)
			? 'Unknown'
			: value.toLocaleString('en-GB', { maximumFractionDigits: digits });
	const cost = (value: number | null) =>
		value === null
			? 'Not yet costed'
			: value === 0
				? 'MVR 0 additional'
				: `MVR ${n(value)} additional`;
	const duration = (j: typeof journey) =>
		j?.status === 'unreachable'
			? 'No supported journey'
			: j?.minutes != null
				? `${n(j.minutes, 1)} min`
				: 'Unknown';
	const comparisonTakeaway = $derived.by(() => {
		if (!decisions) return '';
		const keep = decisions.alternatives.find((option) => option.id === 'keep');
		if (!keep) return '';
		const strongest = [...decisions.alternatives]
			.filter((option) => option.id !== 'keep')
			.sort((a, b) => b.comparison.reachableResidents - a.comparison.reachableResidents)[0];
		if (
			!strongest ||
			strongest.comparison.reachableResidents <= keep.comparison.reachableResidents + 0.01
		)
			return `No tested option increases access within ${decisions.assumptions.targetMinutes} minutes. Journey times can still differ.`;
		const result = strongest.comparison;
		return `Under these assumptions, “${strongest.label}” could bring ${n(result.gainedResidents)} residents within target${result.lostResidents > 0 ? ` and move ${n(result.lostResidents)} outside it` : ''}; ${n(result.worsenedResidents)} would have longer journeys.`;
	});
	function clock(value: number) {
		return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(Math.round(value % 60)).padStart(2, '0')}`;
	}
	function minutes(value: string) {
		const [h, m] = value.split(':').map(Number);
		return h * 60 + m;
	}
	function date(value: string) {
		const d = new Date(value);
		return Number.isFinite(d.getTime())
			? d.toLocaleDateString('en-GB', {
					day: 'numeric',
					month: 'short',
					year: 'numeric',
					timeZone: 'Indian/Maldives'
				})
			: value;
	}
	function reportTime(value: string) {
		return new Date(value).toLocaleTimeString('en-GB', {
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			timeZone: 'Indian/Maldives'
		});
	}
	function islandName(id: string) {
		return baseline.islands.find((i) => i.id === id)?.name ?? id;
	}
	function areaName(item: (typeof baseline.origins)[number], index: number) {
		return typeof item.name === 'string' ? item.name : `Mapped residential area ${index + 1}`;
	}
	function matchesChoice(label: string, search: string) {
		const normalize = (value: string) =>
			value
				.normalize('NFKD')
				.replace(/[\u0300-\u036f]/g, '')
				.toLocaleLowerCase()
				.trim();
		return normalize(label).includes(normalize(search));
	}
	export function applyMapContext(context: PolicyMapContext) {
		const unchangedProposal =
			baseContext &&
			JSON.stringify({ actions: baseContext.actions, assumptions: baseContext.assumptions }) ===
				JSON.stringify({ actions: context.actions, assumptions: context.assumptions });
		selectedOrigin = context.originId;
		selectedIsland = baseline.origins.find((o) => o.id === context.originId)?.islandId ?? '';
		if (unchangedProposal) return;
		baseContext = structuredClone(context);
		selectedOption = 'keep';
		targetMinutes = context.assumptions.targetMinutes;
		serviceDate = context.assumptions.date;
		departure = clock(context.assumptions.departureMinutes);
		const panelDelay = context.assumptions.disruptions?.find(
			(d) => d.id === 'policy-assumed-critical-road-delay'
		);
		delayMinutes = panelDelay?.delayMinutes ?? 5;
		roadEdgeId = panelDelay?.edgeIds?.[0] ?? null;
	}
	$effect(() => {
		const next = mapContext;
		if (next) untrack(() => applyMapContext($state.snapshot(next)));
	});
	async function calculate(options: PolicyOptions) {
		const request = ++revision;
		worker?.dispose();
		const client = new AnalysisWorkerClient(baseline);
		worker = client;
		busy = true;
		error = '';
		try {
			const result = await evaluatePolicyOptions(baseline, options, async (actions, inputs) => {
				if (request !== revision) throw new Error('Superseded comparison');
				return client.analyze(actions, inputs);
			});
			if (mounted && request === revision) decisions = result;
		} catch (failure) {
			if (mounted && request === revision)
				error =
					failure instanceof Error ? failure.message : 'The comparison could not be calculated.';
		} finally {
			if (mounted && request === revision) busy = false;
		}
	}
	onMount(() => {
		mounted = true;
		return () => {
			mounted = false;
			revision++;
			worker?.dispose();
		};
	});
	$effect(() => {
		if (!mounted) return;
		const options: PolicyOptions = {
			delayMinutes,
			targetMinutes,
			date: serviceDate,
			departureMinutes: minutes(departure),
			roadEdgeId: roadEdgeId ?? undefined,
			baseActions: baseContext?.actions,
			assumptions: baseContext?.assumptions
		};
		revision++;
		worker?.dispose();
		busy = true;
		error = '';
		const timer = setTimeout(() => void calculate(options), 140);
		return () => clearTimeout(timer);
	});
	$effect(() => {
		onStateChange?.({
			view,
			originId,
			optionId: selectedOption,
			delayMinutes,
			targetMinutes,
			date: serviceDate,
			departureMinutes: minutes(departure),
			roadEdgeId
		});
	});
	$effect(() => {
		if (view !== 'bus') playing = false;
	});
	$effect(() => {
		if (!playing || !snapshots.length) return;
		const timer = setInterval(() => {
			if (replayIndex >= snapshots.length - 1) playing = false;
			else replayIndex++;
		}, 900);
		return () => clearInterval(timer);
	});
	function playReplay() {
		if (playing) {
			playing = false;
			return;
		}
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			replayIndex = Math.min(snapshots.length - 1, replayIndex + 1);
			return;
		}
		if (replayIndex >= snapshots.length - 1) replayIndex = 0;
		playing = true;
	}
	function openEditor() {
		if (!chosen || busy) return;
		onOpenEditor?.({
			actions: structuredClone(chosen.actions),
			assumptions: structuredClone(chosen.assumptions),
			originId
		});
	}
	function downloadBrief() {
		if (!decisions) return;
		const payload = policyBriefSnapshot(decisions, baseline, selectedOption);
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
		);
		const link = document.createElement('a');
		link.href = url;
		link.download = 'maldives-policy-evidence.json';
		link.click();
		URL.revokeObjectURL(url);
	}
</script>

<section class="workspace" data-testid="policy-workspace">
	{#if snapshotStale}<p class="warning">
			A saved transport snapshot is loaded. Check its dates before acting on these results.
		</p>{/if}
	{#if view === 'people'}
		<header class="page-heading">
			<div>
				<p class="eyebrow">Decision workspace</p>
				<h1>Compare transport changes</h1>
				<p>Test access to {service}, see who gains or loses, and identify what needs review.</p>
			</div>
			<button class="text-button" onclick={() => (view = 'bus')} data-testid="policy-tab-bus"
				>Bus observation pilot<ArrowRight size={14} /></button
			>
		</header>
		<section class="conditions surface" aria-label="Comparison conditions">
			<div class="section-heading compact">
				<h2>Set the comparison</h2>
				<span class="scope-label" data-testid="policy-scope">Malé · Hulhumalé · Vilimalé</span>
			</div>
			<div class="inputs">
				<label
					>Service date<select bind:value={serviceDate} data-testid="policy-date"
						>{#each dates as item (item)}<option value={item}
								>{date(item)}{item !== baseline.referenceDate ? ' · map selection' : ''}</option
							>{/each}</select
					></label
				>
				<label
					>Leave at · Maldives time<input
						type="time"
						bind:value={departure}
						data-testid="policy-departure"
					/></label
				>
				<label
					>Journey target<select bind:value={targetMinutes} data-testid="policy-target"
						>{#each [...new Set( [15, 30, 45, 60, targetMinutes] )].sort((a, b) => a - b) as value (value)}<option
								{value}>{value} minutes</option
							>{/each}</select
					></label
				>
				<div class="road choice-field">
					<label
						>Road to test<select bind:value={roadEdgeId} data-testid="policy-road"
							><option value={null}>Most-used modeled road</option
							>{#each filteredRoads as road (road.id)}<option value={road.id}>{road.name}</option
								>{/each}</select
						></label
					>
					<details class="choice-search">
						<summary>Find a road</summary>
						<label
							>Filter road choices<input
								type="search"
								bind:value={roadSearch}
								placeholder="Road name or number"
								aria-describedby="road-search-results"
								data-testid="policy-road-search"
							/></label
						>
						<p
							id="road-search-results"
							role="status"
							aria-live="polite"
							data-testid="policy-road-search-results"
						>
							{#if roadSearch.trim() && !roadMatches.length}No roads match this search. Automatic
								selection and your current road remain available.{:else}{n(roadMatches.length)}
								{roadMatches.length === 1 ? 'matching road' : 'matching roads'}. Choose from the
								list above.{/if}
						</p>
						{#if roadSearch}<button class="text-button" onclick={() => (roadSearch = '')}
								>Clear road filter</button
							>{/if}
					</details>
				</div>
				<label class="delay"
					><span>Assumed bus delay <strong>{delayMinutes} min</strong></span><input
						type="range"
						min="0"
						max="15"
						step="1"
						bind:value={delayMinutes}
						data-testid="policy-delay"
					/></label
				>
			</div>
			<div class="conditions-note">
				<p data-testid="policy-selected-road">
					{#if !busy && decisions?.roadEvent}<strong>{decisions.roadEvent.name}</strong> ·
					{/if}What-if delay, not a measured road closure or traffic forecast.
				</p>
				{#if !busy && decisions?.roadEvent}<button
						class="text-button"
						onclick={() => onShowMap?.({ roadEdgeId: decisions!.roadEvent!.edgeIds![0] })}
						disabled={!onShowMap}><MapPin size={14} />Locate road</button
					>{/if}
			</div>
			<details class="conditions-details">
				<summary>Coverage and comparison baseline</summary>
				<p>
					{coverage.label}. {coverage.supportedStartMinutes != null &&
					coverage.supportedEndMinutes != null
						? `Loaded boarding window: ${clock(coverage.supportedStartMinutes)}–${clock(coverage.supportedEndMinutes)} Maldives time.`
						: ''} Missing journeys remain unknown.
				</p>
				<p>
					Residential Malé, Hulhumalé and Vilimalé are included. Hulhulé and harbour-dependent
					islands are excluded. Neighborhood resident counts are allocated estimates.
				</p>
				{#if !busy && decisions?.roadEvent}<p>
						<strong>{decisions.roadEvent.name}</strong>: {decisions.roadEvent.delayMinutes} additional
						minutes for buses, on {date(decisions.assumptions.date)}. The automatic choice follows
						modeled resident dependence, not measured traffic.
					</p>{/if}
				{#if baseContext}<p data-testid="policy-map-context">
						Includes your map proposal: {baseContext.actions.length} planned {baseContext.actions
							.length === 1
							? 'change'
							: 'changes'}. Existing events and assumptions are retained. Options below are compared
						with the stated delay already in place. The map compares the full proposal, including
						delays, with the unchanged network.
					</p>{/if}
			</details>
		</section>
		{#if busy}
			<div class="calculation-state surface" role="status" aria-live="polite" aria-busy="true">
				<span class="status-dot"></span>
				<div>
					<strong>Comparing the options</strong>
					<p>Calculating access under the selected conditions. Previous results are hidden.</p>
				</div>
			</div>
		{:else if error}
			<div class="warning" role="alert">
				<strong>The comparison could not be completed.</strong>
				<p>{error}</p>
				<p>Change a condition to recalculate. No option has been applied to the map.</p>
			</div>
		{:else if decisions && chosen}
			{#if coverage.status === 'outside-snapshot' || coverage.status === 'unavailable'}
				<p class="warning">
					{coverage.reasons[0]} Access that cannot be established remains unknown in the comparison.
				</p>
			{/if}
			<section class="comparison surface" aria-label="Compare policy options">
				<div class="section-heading compact">
					<div>
						<h2>Compare the options</h2>
						<p>
							All options use the same date, departure and {decisions.assumptions
								.targetMinutes}-minute target.
						</p>
					</div>
					<span class="status-label" class:caution={coverage.status !== 'complete'} role="status"
						>{coverage.label}</span
					>
				</div>
				<div class="table-scroll">
					<table class="comparison-table" data-testid="policy-options">
						<caption class="sr-only"
							>Choose an option to inspect its residents, costs and operating requirements.</caption
						>
						<thead
							><tr
								><th scope="col">Tested option</th><th scope="col" class="numeric">Within target</th
								><th scope="col" class="numeric">Gaining access</th><th scope="col" class="numeric"
									>Losing access</th
								><th scope="col" class="numeric">Longer journeys</th></tr
							></thead
						>
						<tbody
							>{#each decisions.alternatives as option (option.id)}
								<tr class:selected={selectedOption === option.id}
									><th scope="row"
										><button
											class="option-select"
											aria-pressed={selectedOption === option.id}
											onclick={() => (selectedOption = option.id)}
											data-testid={`policy-option-${option.id}`}
											><span class="selection-indicator" aria-hidden="true"></span><span
												><strong>{option.label}</strong><small>{option.explanation}</small></span
											></button
										></th
									><td class="numeric" data-label="Within target"
										>{n(option.comparison.reachableResidents)}</td
									><td class="numeric gain" data-label="Gaining access"
										>{n(option.comparison.gainedResidents)}</td
									><td
										class="numeric"
										data-label="Losing access"
										class:harm={option.comparison.lostResidents > 0}
										>{n(option.comparison.lostResidents)}</td
									><td
										class="numeric"
										data-label="Longer journeys"
										class:harm={option.comparison.worsenedResidents > 0}
										>{n(option.comparison.worsenedResidents)}</td
									></tr
								>
							{/each}</tbody
						>
					</table>
				</div>
				<div class="table-note">
					<div>
						<p class="comparison-takeaway" data-testid="policy-comparison-takeaway">
							{comparisonTakeaway}
						</p>
						<span
							>Residents, not passengers. Gain and loss mean crossing the journey-time target.</span
						>
					</div>
					<span>Select a row to inspect it.</span>
				</div>
			</section>
			<section class="results" aria-label="Selected option outcomes" data-testid="policy-results">
				<div class="section-heading selection-heading">
					<div>
						<p class="eyebrow">Selected for review</p>
						<h2>{chosen.label}</h2>
						<p data-testid="policy-result-context">
							{date(decisions.assumptions.date)} · leaving {clock(
								decisions.assumptions.departureMinutes
							)} Maldives time · {decisions.assumptions.targetMinutes}-minute target · {service}
						</p>
					</div>
					<button
						class="primary"
						onclick={openEditor}
						disabled={!onOpenEditor}
						data-testid="policy-open-editor">Open this option in map<ArrowRight size={16} /></button
					>
				</div>
				<div class="outcome-grid">
					<div class="impact surface">
						<div class="access-headline">
							<div>
								<span class="metric-label">Within the journey target</span><strong
									>{n(chosen.comparison.reachableResidents)}<span> residents</span></strong
								>
							</div>
							<span class="access-percent"
								>{n(
									chosen.comparison.population
										? (chosen.comparison.reachableResidents / chosen.comparison.population) * 100
										: null,
									1
								)}%</span
							>
						</div>
						<div class="access-bar" aria-label="Modeled access distribution">
							<div
								class="within"
								style:width={`${chosen.comparison.population ? (chosen.comparison.reachableResidents / chosen.comparison.population) * 100 : 0}%`}
							></div>
							<div
								class="outside"
								style:width={`${chosen.comparison.population ? (chosen.comparison.failedResidents / chosen.comparison.population) * 100 : 0}%`}
							></div>
							<div
								class="unknown"
								style:width={`${chosen.comparison.population ? (chosen.comparison.unknownResidents / chosen.comparison.population) * 100 : 0}%`}
							></div>
						</div>
						<div class="distribution-legend">
							<span
								><i class="within"></i>{n(chosen.comparison.reachableResidents)} within target</span
							><span
								><i class="outside"></i>{n(chosen.comparison.failedResidents)} outside target</span
							><span><i class="unknown"></i>{n(chosen.comparison.unknownResidents)} unknown</span>
						</div>
						<dl class="impact-metrics">
							<div>
								<dt>Gaining access</dt>
								<dd class="gain">{n(chosen.comparison.gainedResidents)}</dd>
							</div>
							<div>
								<dt>Losing access</dt>
								<dd class:harm={chosen.comparison.lostResidents > 0}>
									{n(chosen.comparison.lostResidents)}
								</dd>
							</div>
							<div>
								<dt>Longer journeys</dt>
								<dd class:harm={chosen.comparison.worsenedResidents > 0}>
									{n(chosen.comparison.worsenedResidents)}
								</dd>
							</div>
							<div data-testid="policy-unknown">
								<dt>Cannot be assessed</dt>
								<dd>{n(chosen.comparison.unknownResidents)}</dd>
							</div>
						</dl>
						<p class="explanation">
							Compared with keeping the proposal under the assumed delay. Unknown areas are not
							credited as gains. {#if chosen.comparison.meanMinutesSaved === null}Average
								journey-time change is unknown.{:else}Average time {chosen.comparison
									.meanMinutesSaved < 0
									? 'added'
									: 'saved'}:
								<strong>{n(Math.abs(chosen.comparison.meanMinutesSaved), 1)} min</strong> across journeys
								computable in both options.{/if}
						</p>
					</div>
					<aside class="review surface" aria-label="Review before implementation">
						<span class="review-label">Review required</span>
						<h3>Before this can become policy</h3>
						<p class="review-owner">Responsible: <strong>{chosen.owner}</strong></p>
						<dl class="costs" data-testid="policy-costs">
							<div>
								<dt>Annual operations</dt>
								<dd>{cost(chosen.comparison.annualAdditionalMvr)}</dd>
							</div>
							<div>
								<dt>Investment</dt>
								<dd>{cost(chosen.comparison.capitalAdditionalMvr)}</dd>
							</div>
							<div>
								<dt>Additional vehicles</dt>
								<dd>
									{chosen.comparison.additionalFleet === null
										? 'Needs operator review'
										: n(chosen.comparison.additionalFleet)}
								</dd>
							</div>
						</dl>
						<p class="explanation">
							Costs are additional to the existing map proposal. A zero means no extra change; it
							does not establish the full proposal's cost.
						</p>
						<p>
							Verify actual delay, missing services, capacity and operating feasibility before
							implementation.
						</p>
						{#if onShowEvidence}<button class="text-button" onclick={onShowEvidence}
								>Review supporting evidence<ArrowRight size={14} /></button
							>{/if}
					</aside>
				</div>
				<p class="handover-note">
					Opening an option adds it to the map for inspection. It does not approve implementation.
				</p>
				<div class="investigation-grid">
					<section class="surface island-outcomes" data-testid="policy-island-outcomes">
						<div class="section-heading compact">
							<div>
								<h3>Where does access change?</h3>
								<p>Island totals for the selected option.</p>
							</div>
						</div>
						<div class="table-scroll">
							<table class="island-table">
								<caption class="sr-only"
									>Access rates use each island's modeled residents. Unknown areas cannot be counted
									as gains.</caption
								><thead
									><tr
										><th scope="col">Island</th><th scope="col" class="numeric">Within target</th
										><th scope="col" class="numeric">Gain / loss</th><th scope="col" class="numeric"
											>Unknown</th
										></tr
									></thead
								><tbody>
									{#each chosen.comparison.islands as island (island.islandId)}<tr
											><th scope="row"
												>{islandName(island.islandId)}<small>{n(island.population)} residents</small
												></th
											><td class="numeric"
												>{island.accessRate == null
													? 'Unknown'
													: `${n(island.accessRate * 100, 1)}%`}<small
													>{n(island.reachableResidents)} people</small
												></td
											><td class="numeric"
												>{n(island.gainedResidents)} / {n(island.lostResidents)}</td
											><td class="numeric">{n(island.resultUnknownResidents)}</td></tr
										>{/each}
								</tbody>
							</table>
						</div>
						<p class="explanation">
							Potential one-way access, based on allocated residents. Return trips, opening hours
							and service capacity need separate checks.
						</p>
					</section>
					<section class="journey surface">
						<h3>Inspect one journey</h3>
						<p class="explanation">Check how a selected area reaches mapped {service}.</p>
						<div class="area-inputs">
							<label
								>Island<select
									value={areaIsland}
									onchange={(e) => {
										selectedIsland = e.currentTarget.value;
										areaSearch = '';
										selectedOrigin =
											baseline.origins.find((o) => o.islandId === selectedIsland)?.id ?? '';
									}}
									data-testid="policy-area-island"
									>{#each baseline.islands.filter( (i) => baseline.origins.some((o) => o.islandId === i.id) ) as island (island.id)}<option
											value={island.id}>{island.name}</option
										>{/each}</select
								></label
							>
							<div class="choice-field">
								<label
									>Residential area<select
										value={originId}
										onchange={(e) => (selectedOrigin = e.currentTarget.value)}
										data-testid="policy-area"
										>{#each filteredAreas as item (item.area.id)}<option value={item.area.id}
												>{item.label}</option
											>{/each}</select
									></label
								>
								<details class="choice-search">
									<summary>Find an area</summary>
									<label
										>Filter areas in {islandName(areaIsland)}<input
											type="search"
											bind:value={areaSearch}
											placeholder="Area name or number"
											aria-describedby="area-search-results"
											data-testid="policy-area-search"
										/></label
									>
									<p
										id="area-search-results"
										role="status"
										aria-live="polite"
										data-testid="policy-area-search-results"
									>
										{#if areaSearch.trim() && !areaMatches.length}No areas match this search. Your
											selected area remains available.{:else}{n(areaMatches.length)}
											{areaMatches.length === 1 ? 'matching area' : 'matching areas'}. Choose from
											the list above.{/if}
									</p>
									<p>
										Area numbers identify mapped residential areas, not named neighborhoods. Use the
										map to check their location.
									</p>
									{#if areaSearch}<button class="text-button" onclick={() => (areaSearch = '')}
											>Clear area filter</button
										>{/if}
								</details>
							</div>
						</div>
						<dl class="journey-comparison">
							<div>
								<dt>Keep proposal</dt>
								<dd>{duration(beforeJourney)}</dd>
							</div>
							<div>
								<dt>Selected option</dt>
								<dd>{duration(journey)}</dd>
							</div>
						</dl>
						<p class="destination">To {destination?.name ?? `mapped ${service}`}</p>
						<button onclick={() => onShowMap?.({ originId })} disabled={!onShowMap}
							><MapPin size={15} />Show area and journey on map</button
						>
						<details class="area-source">
							<summary>Journey evidence</summary>
							<p>
								A computed one-way journey, not a recorded trip. Residential area source ID: <code
									>{originId}</code
								>.
							</p>
						</details>
					</section>
				</div>
				{#if showMap}<details class="surface playback-details">
						<summary>Inspect the journey playback</summary>
						<div class="map">
							<PolicyMap
								{baseline}
								analysis={chosen.analysis}
								{assumptions}
								selectedOriginId={originId}
								onselect={(id) => (selectedOrigin = id)}
								playbackSymbols={journeySymbols}
							/>
						</div>
						<JourneyPlayback
							{journey}
							analysis={chosen.analysis}
							{assumptions}
							sourceReferenceDate={baseline.referenceDate}
							onframe={(symbols) => (journeySymbols = symbols)}
						/>
					</details>{/if}
				<div class="analysis-details surface">
					{#if decisions.timingTrials.length}<details data-testid="policy-timing-trials">
							<summary>What happened in the two bus-timing tests?</summary>
							<p>
								Only five minutes earlier and five minutes later are tested for {decisions
									.timingTrials[0].patternName}. Bus speed is unchanged. This is a bounded
								comparison, not a full schedule optimization.
							</p>
							<div class="table-scroll">
								<table>
									<caption class="sr-only"
										>Timing trials compared with the same map proposal and assumed delay.</caption
									><thead
										><tr
											><th scope="col">Departure change</th><th scope="col" class="numeric"
												>Gaining access</th
											><th scope="col" class="numeric">Losing access</th><th
												scope="col"
												class="numeric">Longer journeys</th
											><th scope="col" class="numeric">Average saved</th></tr
										></thead
									><tbody
										>{#each decisions.timingTrials as trial (trial.minutes)}<tr
												><th scope="row"
													>{Math.abs(trial.minutes)} min {trial.minutes < 0
														? 'earlier'
														: 'later'}</th
												><td class="numeric">{n(trial.comparison.gainedResidents)}</td><td
													class="numeric"
													class:harm={trial.comparison.lostResidents > 0}
													>{n(trial.comparison.lostResidents)}</td
												><td class="numeric" class:harm={trial.comparison.worsenedResidents > 0}
													>{n(trial.comparison.worsenedResidents)}</td
												><td class="numeric">{n(trial.comparison.meanMinutesSaved, 1)} min</td></tr
											>{/each}</tbody
									>
								</table>
							</div>
							<p class="explanation">
								A timetable change needs an operator cost and duty review. If neither test improves
								access, the option retains existing timing.
							</p>
						</details>{/if}
					<details data-testid="policy-assumptions">
						<summary>Assumptions, missing information and operating checks</summary>
						<ul>
							{#each [...new Set( [...decisions.qualification, ...chosen.conditions] )] as condition (condition)}<li
								>
									{condition}
								</li>{/each}
						</ul>
						{#if chosen.comparison.accessBounds}<p data-testid="policy-access-bounds">
								If every unknown area could meet the target, access would be at most {n(
									chosen.comparison.accessBounds[1] * chosen.comparison.population
								)} residents, compared with {n(
									chosen.comparison.accessBounds[0] * chosen.comparison.population
								)} assessed within it. These are missing-information bounds, not a forecast confidence
								interval.
							</p>{/if}
						<p>
							Population year: {chosen.assumptions.populationYear}; walking speed: {chosen
								.assumptions.walkMPerMinute} m/min; maximum transfers: {chosen.assumptions
								.maxTransfers}; fleet response: {chosen.assumptions.fleetResponse ?? 'default'}.
						</p>
						{#if decisions.roadEvent}<p>
								Road segment ID: <code>{decisions.roadEvent.edgeIds.join(', ')}</code>. The assumed
								delay applies only on the selected date to buses using that segment.
							</p>{/if}
					</details>
				</div>
			</section>
		{/if}
	{:else}
		<header class="page-heading">
			<div>
				<p class="eyebrow">Bus observation pilot · route 133</p>
				<h1>What do the bus reports actually show?</h1>
				<p>
					Reported positions can help check movement and collection coverage. They do not yet
					establish congestion, vehicle arrival times or a reliable near-term forecast.
				</p>
			</div>
			<button class="text-button" onclick={() => (view = 'people')} data-testid="policy-tab-people"
				>Back to decision comparison<ArrowRight size={14} /></button
			>
		</header>
		<p class="warning" data-testid="bus-not-available">
			Arrival and road-delay predictions are not available. The pilot has too little verified
			history, and no source measurement timestamp.
		</p>
		{#if prediction}<div class="metrics" data-testid="bus-readiness">
				<div><strong>{n(prediction.bus.coverage.snapshots)}</strong><span>Saved reports</span></div>
				<div>
					<strong>{n(prediction.bus.coverage.vehicles)}</strong><span
						>Distinct reported vehicles</span
					>
				</div>
				<div>
					<strong>{n(prediction.bus.coverage.observedDays)}</strong><span>Days with reports</span>
				</div>
			</div>
			<p class="scope" data-testid="bus-receipt-dates">
				Reports received: {prediction.bus.coverage.firstReceivedAt
					? `${date(prediction.bus.coverage.firstReceivedAt)} ${reportTime(prediction.bus.coverage.firstReceivedAt)}`
					: 'Not supplied'} to {prediction.bus.coverage.lastReceivedAt
					? `${date(prediction.bus.coverage.lastReceivedAt)} ${reportTime(prediction.bus.coverage.lastReceivedAt)}`
					: 'Not supplied'} (Maldives time). These are collection times, not times measured by the vehicle.
			</p>
			<div class="action">
				<h3>Next decision: collect enough evidence to validate an arrival forecast</h3>
				<p>
					Confirm permission to redistribute positions, collect multiple days and directions, and
					compare arrival estimates against later observed arrivals. Separate traffic delay from
					boarding, scheduled dwell, terminal waiting and GPS noise.
				</p>
			</div>
			{#if snapshots.length && snapshot}<div class="replay">
					<button onclick={playReplay}
						>{#if playing}<Pause size={15} />{:else}<Play size={15} />{/if}{playing
							? 'Pause'
							: 'Play saved reports'}</button
					><label
						>Report {replayIndex + 1} of {snapshots.length}<input
							type="range"
							min="0"
							max={snapshots.length - 1}
							step="1"
							bind:value={replayIndex}
							onchange={() => (playing = false)}
						/></label
					>
					<p>
						{date(snapshot.receivedAt)} · received {reportTime(snapshot.receivedAt)} Maldives time. Symbols
						show saved positions; movement between reports is unverified.
					</p>
				</div>
				{#if showMap}<div class="map">
						<PolicyMap
							{baseline}
							analysis={null}
							{assumptions}
							showAreas={false}
							playbackSymbols={replaySymbols}
						/>
					</div>{/if}{:else}<p>
					No redistributable position replay is loaded. The main map shows route and stop context;
					it does not show observed bus positions.
				</p>{/if}
			<details>
				<summary>Collection coverage, limits and model requirements</summary>
				<p>{prediction.bus.qualification}</p>
				<ul>
					{#each prediction.bus.modelCard.limitations as limitation (limitation)}<li>
							{limitation}
						</li>{/each}
				</ul>
				<p>
					Intervals with changed reported positions: {n(
						prediction.bus.coverage.changedPositionIntervals
					)}. A changed position is not proof of a reliable travel-speed measurement.
				</p>
			</details>{:else}<p>Bus observation evidence is unavailable in this snapshot.</p>{/if}
	{/if}
	<PolicyEvidenceDetails {baseline} {operations} {supportingSources} />
	{#if view === 'people' && !busy && !error}<details class="more">
			<summary>Export and editor tools</summary>
			<p>Save the inputs, comparison and source versions for reproducible review.</p>
			<button
				onclick={downloadBrief}
				disabled={busy || !decisions || !!error}
				data-testid="policy-download-brief"><Download size={15} />Download comparison data</button
			>{#if onShowLegacy}<button onclick={onShowLegacy}>Open full map editor</button>{/if}
		</details>{/if}
</section>

<style>
	.workspace {
		max-width: 1200px;
		margin: 0 auto;
		color: #172b3a;
		font-size: 14px;
		line-height: 1.5;
	}
	.page-heading {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 24px;
		margin-bottom: 24px;
	}
	h1 {
		font-size: 30px;
		font-weight: 650;
		line-height: 1.2;
		letter-spacing: -0.035em;
		margin: 7px 0 10px;
	}
	h2 {
		font-size: 19px;
		font-weight: 650;
		line-height: 1.3;
		letter-spacing: -0.025em;
		margin: 0;
	}
	h3 {
		font-size: 16px;
		font-weight: 650;
		line-height: 1.4;
		margin: 0;
		letter-spacing: -0.015em;
	}
	p {
		margin: 8px 0 0;
	}
	.page-heading p:not(.eyebrow),
	.section-heading p {
		color: #647381;
	}
	.eyebrow {
		text-transform: uppercase;
		letter-spacing: 0.1em;
		font-size: 10px;
		font-weight: 650;
		color: #647381;
		margin: 0;
	}
	button {
		min-height: 44px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		border: 1px solid #dde3e9;
		border-radius: var(--surface-radius-pill, 999px);
		padding: 9px 16px;
		background: #fff;
		color: #172b3a;
		font: inherit;
		font-size: 13px;
		font-weight: 550;
		cursor: pointer;
		text-align: left;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	button:hover:not(:disabled) {
		background: #f5f6f8;
		border-color: #b7c5cf;
	}
	.text-button {
		padding: 8px 0;
		min-height: 40px;
		border: 0;
		background: transparent;
		color: #087f78;
		white-space: nowrap;
	}
	.text-button:hover:not(:disabled) {
		background: transparent;
		border-color: transparent;
		color: #06635e;
		text-decoration: underline;
		text-underline-offset: 3px;
	}
	.page-heading .text-button {
		margin-top: 15px;
	}
	.primary {
		background: #087f78;
		color: #fff;
		border-color: #087f78;
		white-space: nowrap;
	}
	.primary:hover:not(:disabled) {
		background: #066b65;
		border-color: #066b65;
	}
	.surface {
		background: #fff;
		border: 1px solid #dde3e9;
		border-radius: var(--surface-radius, 28px);
		box-shadow: var(--surface-shadow, 0 4px 16px #102e3412, 0 1px 3px #102e340a);
	}
	.conditions {
		padding: 20px 22px 0;
		margin-bottom: 24px;
	}
	.section-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
	}
	.compact {
		margin-bottom: 16px;
	}
	.scope-label {
		font-size: 12px;
		color: #647381;
	}
	.inputs {
		display: grid;
		grid-template-columns: 1.05fr 0.8fr 0.8fr 1.5fr 1fr;
		gap: 16px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 7px;
		font-size: 11px;
		font-weight: 600;
		color: #506271;
		min-width: 0;
	}
	select,
	input[type='time'],
	input[type='search'] {
		width: 100%;
		min-width: 0;
		height: 44px;
		border: 1px solid #d4dce4;
		border-radius: var(--surface-radius-field, 14px);
		background: #fff;
		padding: 9px 10px;
		color: #172b3a;
		font: inherit;
		font-size: 13px;
		font-weight: 450;
	}
	.choice-field {
		min-width: 0;
	}
	.choice-search {
		border: 0;
		padding: 0;
		margin-top: 2px;
	}
	.choice-search > summary {
		min-height: 44px;
		color: #647381;
		font-size: 11px;
		font-weight: 500;
		justify-content: flex-start;
		gap: 8px;
	}
	.choice-search > summary::after {
		margin-left: auto;
	}
	.choice-search label {
		margin-top: 2px;
	}
	.choice-search p {
		font-size: 11px;
		margin-top: 8px;
	}
	.choice-search .text-button {
		min-height: 44px;
		font-size: 11px;
	}
	input[type='range'] {
		accent-color: #087f78;
		width: 100%;
		min-height: 42px;
		margin: 0;
	}
	.delay > span {
		display: flex;
		justify-content: space-between;
		gap: 8px;
	}
	.delay strong {
		color: #172b3a;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.conditions-note {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		margin: 10px 0 0;
		font-size: 12px;
		color: #647381;
	}
	.conditions-note p {
		margin: 0;
	}
	.conditions-details {
		margin-top: 10px;
	}
	details {
		border-top: 1px solid #dde3e9;
		padding: 14px 0;
		font-size: 13px;
	}
	summary {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		cursor: pointer;
		font-size: 13px;
		font-weight: 550;
		list-style: none;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	summary::after {
		content: '+';
		color: #7a8995;
		font-size: 18px;
		font-weight: 400;
		line-height: 1;
	}
	details[open] > summary::after {
		content: '−';
	}
	details p,
	details li {
		color: #647381;
	}
	details p {
		margin-top: 12px;
	}
	.warning {
		border: 1px solid #eadbc1;
		border-radius: var(--surface-radius-inner, 16px);
		padding: 14px 16px;
		background: #fcf8ef;
		color: #94621c;
		font-size: 13px;
		margin: 0 0 20px;
	}
	.calculation-state {
		min-height: 220px;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 14px;
		padding: 28px;
		margin-top: 24px;
	}
	.calculation-state p {
		color: #647381;
		font-size: 13px;
	}
	.status-dot {
		width: 9px;
		height: 9px;
		flex: none;
		border-radius: 50%;
		background: #087f78;
	}
	.comparison {
		overflow: hidden;
		margin-bottom: 28px;
	}
	.comparison > .section-heading {
		padding: 20px 22px 0;
	}
	.section-heading p {
		font-size: 12px;
	}
	.status-label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: #647381;
		white-space: nowrap;
	}
	.status-label::before {
		content: '';
		height: 5px;
		width: 5px;
		border-radius: 50%;
		background: #087f78;
	}
	.status-label.caution {
		color: #94621c;
	}
	.status-label.caution::before {
		background: #b38a4f;
	}
	.table-scroll {
		overflow-x: auto;
	}
	table {
		border-collapse: collapse;
		width: 100%;
		font-size: 12px;
	}
	thead {
		background: #f7f8fa;
	}
	th,
	td {
		text-align: left;
		padding: 14px 18px;
		border-bottom: 1px solid #e6ebf0;
		vertical-align: middle;
	}
	thead th {
		font-size: 11px;
		font-weight: 550;
		color: #647381;
		white-space: nowrap;
	}
	tbody th {
		font-weight: 550;
	}
	.numeric {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.comparison-table {
		min-width: 760px;
	}
	.comparison-table tbody th {
		width: 44%;
		padding: 0;
	}
	.comparison-table td {
		font-size: 14px;
	}
	.comparison-table tbody tr:last-child th,
	.comparison-table tbody tr:last-child td {
		border-bottom: 0;
	}
	.option-select {
		width: 100%;
		border: 0;
		border-radius: 0;
		min-height: 93px;
		justify-content: flex-start;
		padding: 16px 22px;
		gap: 12px;
		background: transparent;
	}
	.option-select:hover:not(:disabled) {
		background: transparent;
		border: 0;
	}
	.option-select strong {
		display: block;
		font-size: 13px;
		font-weight: 600;
	}
	.option-select small {
		display: block;
		font-size: 11px;
		font-weight: 400;
		line-height: 1.6;
		color: #647381;
		margin-top: 4px;
	}
	.selection-indicator {
		width: 15px;
		height: 15px;
		border: 1.5px solid #bac7d0;
		border-radius: 50%;
		flex: none;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	tr.selected {
		background: #f0f8f7;
	}
	tr.selected .selection-indicator {
		border-color: #087f78;
	}
	tr.selected .selection-indicator::before {
		content: '';
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #087f78;
	}
	.table-note {
		display: flex;
		justify-content: space-between;
		gap: 20px;
		font-size: 11px;
		color: #647381;
		padding: 12px 22px;
		border-top: 1px solid #e6ebf0;
	}
	.comparison-takeaway {
		color: #172b3a;
		font-size: 12px;
		font-weight: 500;
		margin: 0 0 5px;
	}
	.table-note > span {
		flex: none;
	}
	.selection-heading {
		margin-bottom: 18px;
	}
	.selection-heading h2 {
		font-size: 24px;
		margin-top: 5px;
	}
	.outcome-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.65fr) minmax(0, 1fr);
		gap: 18px;
	}
	.impact,
	.review {
		padding: 22px;
	}
	.access-headline {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
	}
	.metric-label {
		display: block;
		font-size: 12px;
		color: #647381;
		margin-bottom: 6px;
	}
	.access-headline strong {
		font-size: 34px;
		font-weight: 600;
		line-height: 1.2;
		letter-spacing: -0.035em;
		font-variant-numeric: tabular-nums;
	}
	.access-headline strong > span {
		font-size: 13px;
		font-weight: 400;
		letter-spacing: 0;
		color: #647381;
	}
	.access-percent {
		font-size: 17px;
		color: #087f78;
		font-weight: 550;
		font-variant-numeric: tabular-nums;
	}
	.access-bar {
		display: flex;
		height: 7px;
		border-radius: 3px;
		overflow: hidden;
		margin: 19px 0 10px;
		background: #edf0f3;
	}
	.within {
		background: #087f78;
	}
	.outside {
		background: #c5cfd8;
	}
	.unknown {
		background: #cfad76;
	}
	.distribution-legend {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
		font-size: 10px;
		color: #647381;
	}
	.distribution-legend > span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.distribution-legend i {
		width: 6px;
		height: 6px;
		border-radius: 1px;
		flex: none;
	}
	.impact-metrics {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 14px;
		margin: 25px 0 18px;
		padding-top: 20px;
		border-top: 1px solid #e6ebf0;
	}
	dt {
		color: #647381;
		font-size: 11px;
	}
	dd {
		margin: 0;
		font-variant-numeric: tabular-nums;
	}
	.impact-metrics dd {
		font-size: 22px;
		font-weight: 550;
		margin-top: 5px;
		letter-spacing: -0.025em;
	}
	.gain {
		color: #087f78;
	}
	.harm {
		color: #94621c;
	}
	.explanation {
		font-size: 11px;
		color: #647381;
		line-height: 1.65;
	}
	.explanation strong {
		color: #506271;
		font-weight: 550;
	}
	.review-label {
		display: inline-flex;
		padding: 4px 9px;
		border: 1px solid #ecddc6;
		background: #fcf8ef;
		border-radius: var(--surface-radius-pill, 999px);
		color: #94621c;
		font-size: 10px;
		font-weight: 600;
	}
	.review h3 {
		margin-top: 10px;
	}
	.review-owner {
		font-size: 11px;
		color: #647381;
	}
	.review-owner strong {
		font-weight: 500;
		color: #172b3a;
	}
	.costs {
		display: grid;
		gap: 9px;
		padding: 16px 0;
		margin: 14px 0 0;
		border-top: 1px solid #e6ebf0;
		border-bottom: 1px solid #e6ebf0;
	}
	.costs > div {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
	}
	.costs dd {
		font-size: 12px;
		font-weight: 550;
		text-align: right;
	}
	.review > p:not(.review-owner):not(.explanation) {
		font-size: 12px;
		color: #506271;
		margin-top: 14px;
	}
	.review .text-button {
		margin-top: 7px;
		font-size: 12px;
	}
	.handover-note {
		font-size: 11px;
		color: #647381;
		text-align: right;
		margin: 9px 0 25px;
	}
	.investigation-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.65fr) minmax(0, 1fr);
		gap: 18px;
		margin-bottom: 22px;
	}
	.island-outcomes {
		overflow: hidden;
	}
	.island-outcomes .section-heading {
		padding: 20px 22px 0;
	}
	.island-table {
		min-width: 480px;
	}
	.island-table th,
	.island-table td {
		padding: 14px 16px;
	}
	.island-table small {
		display: block;
		margin-top: 4px;
		color: #647381;
		font-size: 10px;
		font-weight: 400;
	}
	.island-outcomes > .explanation {
		padding: 0 22px 20px;
		margin-top: 14px;
	}
	.journey {
		padding: 20px 22px 0;
	}
	.area-inputs {
		display: grid;
		grid-template-columns: 1fr 1.4fr;
		gap: 12px;
		margin: 18px 0;
	}
	.area-inputs label {
		font-size: 10px;
	}
	.journey-comparison {
		display: grid;
		grid-template-columns: 1fr 1fr;
		margin: 14px 0 0;
	}
	.journey-comparison dd {
		font-size: 17px;
		font-weight: 550;
		margin-top: 4px;
	}
	.destination {
		font-size: 11px;
		color: #647381;
		margin: 8px 0 16px;
	}
	.journey > button {
		width: 100%;
		font-size: 12px;
	}
	.area-source {
		margin-top: 16px;
		padding: 12px 0;
	}
	.area-source summary {
		font-size: 11px;
		color: #647381;
	}
	code {
		font: inherit;
		overflow-wrap: anywhere;
	}
	.analysis-details {
		padding: 0 22px;
	}
	.analysis-details > details:first-child {
		border-top: 0;
	}
	:global(.workspace .evidence) {
		margin-top: 0;
		color: #172b3a;
		border-color: #dde3e9;
		font-size: 13px;
	}
	:global(.workspace .evidence p),
	:global(.workspace .evidence dt) {
		color: #647381;
	}
	:global(.workspace .evidence summary) {
		font-weight: 550;
	}
	li {
		margin: 8px 0;
	}
	.more button {
		margin: 14px 8px 0 0;
	}
	.playback-details {
		padding: 16px 22px;
		margin-bottom: 22px;
	}
	.map {
		height: 400px;
		margin: 18px 0;
	}
	.metrics {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 20px;
		margin: 20px 0;
	}
	.metrics > div {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.metrics strong {
		font-size: 30px;
		font-weight: 550;
	}
	.metrics span {
		font-size: 12px;
		color: #647381;
	}
	.scope {
		color: #647381;
		font-size: 12px;
	}
	.action {
		border-top: 1px solid #dde3e9;
		padding: 20px 0;
		margin-top: 20px;
	}
	.action p {
		font-size: 13px;
		color: #647381;
	}
	.replay {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 14px;
		margin: 20px 0;
	}
	.replay label {
		flex: 1;
		min-width: 200px;
	}
	.replay p {
		width: 100%;
		color: #647381;
		font-size: 12px;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		margin: -1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
	button:focus-visible,
	select:focus-visible,
	input:focus-visible,
	summary:focus-visible {
		outline: 2px solid #087f78;
		outline-offset: 3px;
	}
	@media (max-width: 1100px) {
		.inputs {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
		.road {
			grid-column: span 2;
		}
		.impact-metrics {
			gap: 10px;
		}
		.impact-metrics dt {
			font-size: 10px;
		}
		.impact-metrics dd {
			font-size: 20px;
		}
	}
	@media (max-width: 850px) {
		.outcome-grid,
		.investigation-grid {
			grid-template-columns: 1fr;
		}
		.review .costs {
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
		.costs > div {
			flex-direction: column;
			gap: 4px;
		}
		.costs dd {
			text-align: left;
		}
		.area-inputs {
			grid-template-columns: 1fr 2fr;
		}
	}
	@media (max-width: 600px) {
		.surface {
			border-radius: var(--surface-radius-mobile, 24px);
		}
		.comparison-table {
			min-width: 0;
		}
		.comparison-table thead {
			position: absolute;
			width: 1px;
			height: 1px;
			margin: -1px;
			padding: 0;
			overflow: hidden;
			clip: rect(0, 0, 0, 0);
			white-space: nowrap;
			border: 0;
		}
		.comparison-table tbody tr {
			display: grid;
			grid-template-columns: 1fr 1fr;
			padding-bottom: 12px;
			border-bottom: 1px solid #e6ebf0;
		}
		.comparison-table tbody tr:last-child {
			border-bottom: 0;
		}
		.comparison-table tbody th {
			width: auto;
			grid-column: 1/-1;
			border: 0;
		}
		.comparison-table td {
			display: block;
			border: 0;
			text-align: left;
			padding: 7px 16px;
		}
		.comparison-table td::before {
			content: attr(data-label);
			display: block;
			color: #647381;
			font-size: 10px;
			font-weight: 400;
			margin-bottom: 4px;
		}
		.option-select {
			min-height: 0;
			padding: 14px 16px 10px;
		}
		.page-heading {
			display: block;
			margin-bottom: 20px;
		}
		.page-heading .text-button {
			margin-top: 5px;
		}
		h1 {
			font-size: 27px;
		}
		.conditions {
			padding: 16px 16px 0;
		}
		.conditions .compact {
			align-items: flex-start;
			flex-direction: column;
			gap: 6px;
		}
		.inputs {
			grid-template-columns: 1fr 1fr;
			gap: 14px 12px;
		}
		.road {
			grid-column: 1/-1;
		}
		.delay {
			grid-column: 1/-1;
		}
		.conditions-note {
			align-items: flex-start;
			flex-direction: column;
			gap: 3px;
		}
		.comparison > .section-heading {
			padding: 18px 16px 0;
		}
		.comparison > .section-heading {
			align-items: flex-start;
			flex-direction: column;
			gap: 10px;
		}
		.table-note {
			padding: 12px 16px;
		}
		.table-note > span:last-child {
			display: none;
		}
		.selection-heading {
			align-items: flex-start;
			flex-direction: column;
			gap: 14px;
		}
		.selection-heading .primary {
			width: 100%;
		}
		.selection-heading h2 {
			font-size: 22px;
		}
		.impact,
		.review {
			padding: 18px 16px;
		}
		.access-headline strong {
			font-size: 29px;
		}
		.access-headline strong > span {
			display: block;
			margin-top: 3px;
		}
		.impact-metrics {
			grid-template-columns: 1fr 1fr;
			gap: 17px 20px;
		}
		.impact-metrics dt {
			font-size: 11px;
		}
		.impact-metrics dd {
			font-size: 23px;
		}
		.review .costs {
			grid-template-columns: 1fr;
		}
		.costs > div {
			flex-direction: row;
		}
		.handover-note {
			text-align: left;
		}
		.journey {
			padding: 18px 16px 0;
		}
		.area-inputs {
			grid-template-columns: 1fr;
		}
		.island-outcomes .section-heading {
			padding: 18px 16px 0;
		}
		.island-outcomes > .explanation {
			padding: 0 16px 18px;
		}
		.analysis-details {
			padding: 0 16px;
		}
		.analysis-details table {
			min-width: 650px;
		}
		.metrics {
			grid-template-columns: 1fr;
			gap: 15px;
		}
		.metrics > div {
			flex-direction: row;
			justify-content: space-between;
			align-items: center;
		}
	}
</style>
