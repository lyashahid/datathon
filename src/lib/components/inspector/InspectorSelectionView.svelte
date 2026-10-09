<script lang="ts">
	import { getAnalysisGrid } from '#lib/stores/h3.svelte.ts';
	import { getScenarioStore } from '#lib/stores/scenario.svelte.ts';
	import type { InspectorSelection } from '#lib/types/ui.ts';
	import H3CellInspector from './H3CellInspector.svelte';
	import CandidateDetail from '#lib/components/candidates/CandidateDetail.svelte';
	import CandidateList from '#lib/components/candidates/CandidateList.svelte';
	import { getCandidateSearch } from '#lib/stores/candidates.svelte.ts';
	import InfrastructureInspector from './InfrastructureInspector.svelte';
	import RouteDetails from './RouteDetails.svelte';
	import ObservationInspector from '#lib/components/feedback/ObservationInspector.svelte';
	import { getFeedbackState } from '#lib/stores/feedback.svelte.ts';

	let { selection }: { selection: InspectorSelection } = $props();

	const scenarios = getScenarioStore();
	const analysisGrid = getAnalysisGrid();
	const candidateSearch = getCandidateSearch();
	const feedback = getFeedbackState();
	const observation = $derived(
		selection.kind === 'observation' ? feedback.getObservation(selection.id) : undefined
	);
	const candidate = $derived(
		selection.kind === 'candidate' ? candidateSearch.get(selection.id) : undefined
	);
	const feature = $derived(
		selection.kind === 'infrastructure'
			? scenarios.effective.getInfrastructure(selection.id)
			: undefined
	);
	const route = $derived(
		selection.kind === 'route' ? scenarios.effective.getRoute(selection.id) : undefined
	);
	// Single-cell area selections come from info views; multi-cell areas arrive with area tools.
	const cell = $derived(
		selection.kind === 'area' && selection.cellIds.length === 1
			? analysisGrid.grid.get(selection.cellIds[0])
			: undefined
	);
</script>

{#if feature}
	<!-- Keyed so per-feature UI state (expanded panels) resets on a new selection. -->
	{#key feature.id}
		<InfrastructureInspector {feature} />
	{/key}
{:else if observation}
	{#key observation.id}
		<ObservationInspector {observation} />
	{/key}
{:else if selection.kind === 'candidates'}
	<CandidateList />
{:else if candidate}
	{#key candidate.id}
		<CandidateDetail {candidate} />
	{/key}
{:else if cell}
	<!-- Keyed so per-cell UI state (open breakdowns, suggestions) resets on a new cell. -->
	{#key cell.h3Index}
		<H3CellInspector {cell} resolution={analysisGrid.grid.resolution} />
	{/key}
{:else}
	<div class="flex flex-col gap-4 p-3">
		{#if route}
			<RouteDetails {route} />
		{:else if selection.kind === 'area'}
			<div>
				<span class="hud-label">Area</span>
				<h2 class="mt-0.5 truncate text-sm font-semibold">{selection.label}</h2>
			</div>
		{:else}
			<p class="text-xs text-hud-warn">The selected item is no longer available.</p>
		{/if}
	</div>
{/if}
