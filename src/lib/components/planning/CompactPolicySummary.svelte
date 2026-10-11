<script lang="ts">
	import { ArrowRight, ChevronRight } from '@lucide/svelte';
	import type { OriginComparison, PlanningAnalysis, PlanningJourney } from '#lib/planning/types.ts';

	let {
		analysis,
		selectedJourney = null,
		targetMinutes,
		hasProposal,
		preview = false,
		unpricedChange = false,
		busy = false,
		expanded = false,
		announce = true,
		ondetails
	}: {
		analysis: PlanningAnalysis | null;
		selectedJourney?: OriginComparison | null;
		targetMinutes: number;
		hasProposal: boolean;
		preview?: boolean;
		unpricedChange?: boolean;
		busy?: boolean;
		expanded?: boolean;
		announce?: boolean;
		ondetails: () => void;
	} = $props();

	const count = (value: number | null | undefined) =>
		value == null || !Number.isFinite(value)
			? 'Not available'
			: Math.round(value).toLocaleString('en-GB');
	const money = (value: number) =>
		`MVR ${value.toLocaleString('en-GB', {
			notation: Math.abs(value) >= 10000 ? 'compact' : 'standard',
			maximumFractionDigits: Math.abs(value) >= 10000 ? 1 : 0
		})}`;
	function duration(journey: PlanningJourney) {
		if (journey.status === 'unavailable') return 'Unknown';
		if (journey.status === 'unreachable') return 'No supported trip';
		return journey.minutes == null ? 'Unknown' : `${Math.round(journey.minutes)} min`;
	}
	const updating = $derived(busy || !analysis || analysis.targetMinutes !== targetMinutes);
	const scenarioActive = $derived(hasProposal || preview);
	const averageChange = $derived(analysis?.summary.minutesSavedForAlreadyReachable ?? null);
	const averageDefinition =
		'Population-weighted average for residents within target before the change and with a supported journey after.';
	const componentId = $props.id();
	const averageDescriptionId = `${componentId}-average`;
	const beyondTarget = $derived.by(() => {
		if (!analysis || scenarioActive) return null;
		const { population, scenarioReachableResidents, unknownResidents } = analysis.summary;
		if (![population, scenarioReachableResidents, unknownResidents].every(Number.isFinite))
			return null;
		// With no proposed change, the three access groups partition the modeled population.
		// Unknown journeys remain separate from residents who are beyond the target.
		const remainder = population - scenarioReachableResidents - unknownResidents;
		return remainder >= 0 ? remainder : null;
	});
	const secondLabel = $derived(
		selectedJourney
			? 'Selected journey · before → after'
			: scenarioActive
				? 'Average journey change'
				: 'Missing journey evidence'
	);
	const costReview = $derived(
		scenarioActive &&
			(unpricedChange ||
				analysis?.costs.capitalMvr == null ||
				analysis?.costs.annualOperatingMvr == null)
	);
</script>

<section
	class="compact-summary"
	aria-label="Policy results summary"
	aria-busy={updating}
	data-testid="compact-policy-summary"
>
	<header class="summary-heading">
		<div class="summary-context">
			<span class="context-title"
				>{preview ? 'Proposal preview' : hasProposal ? 'Scenario results' : 'Current network'}</span
			>
			<span class="context-note">{updating ? 'Updating estimates…' : 'Modelled access'}</span>
		</div>
		<button
			type="button"
			aria-label="Open policy results and assumptions"
			aria-haspopup="dialog"
			aria-expanded={expanded}
			onclick={ondetails}>Details <ChevronRight size={15} aria-hidden="true" /></button
		>
	</header>

	<div class="outcomes" aria-live={announce && !updating ? 'polite' : 'off'}>
		<div class="outcome reach">
			<span class="label">Residents within {targetMinutes} min</span>
			<div class="value-row">
				<strong
					>{updating ? 'Calculating…' : count(analysis?.summary.scenarioReachableResidents)}</strong
				>
				{#if !updating}<span class="value-note">of {count(analysis?.summary.population)}</span>{/if}
			</div>
		</div>
		<div
			class="outcome secondary"
			aria-describedby={scenarioActive && !selectedJourney ? averageDescriptionId : undefined}
		>
			<span class="label" title={scenarioActive && !selectedJourney ? averageDefinition : undefined}
				>{secondLabel}</span
			>
			{#if updating}
				<strong>Calculating…</strong>
			{:else if selectedJourney}
				<div class="journey-value">
					<strong>{duration(selectedJourney.before)}</strong>
					<ArrowRight size={15} aria-label="before to after" />
					<strong>{duration(selectedJourney.after)}</strong>
				</div>
			{:else if scenarioActive}
				<div class="value-row">
					<strong
						>{averageChange == null
							? 'Not available'
							: Math.abs(averageChange).toLocaleString('en-GB', {
									maximumFractionDigits: 1
								})}</strong
					>
					{#if averageChange != null}<span class="value-note"
							>min {averageChange < 0 ? 'longer' : averageChange === 0 ? 'change' : 'saved'}</span
						>{/if}
				</div>
			{:else}
				<div class="value-row">
					<strong>{count(analysis?.summary.unknownResidents)}</strong><span class="value-note"
						>residents</span
					>
				</div>
			{/if}
		</div>
	</div>
	{#if scenarioActive && !selectedJourney}<span class="visually-hidden" id={averageDescriptionId}
			>{averageDefinition}</span
		>{/if}

	{#if analysis && !updating && scenarioActive}
		<div class="qualifications" aria-label="Who is affected">
			<span>{count(analysis.summary.newlyReachedResidents)} gain access</span>
			{#if analysis.summary.lostAccessResidents > 0}<span class="harm"
					>{count(analysis.summary.lostAccessResidents)} lose access</span
				>{/if}
			{#if analysis.summary.worsenedJourneyResidents > 0}<span class="harm"
					>{count(analysis.summary.worsenedJourneyResidents)} have slower journeys</span
				>{/if}
			{#if analysis.summary.unknownResidents > 0}<span
					>{count(analysis.summary.unknownResidents)} with missing evidence</span
				>{/if}
		</div>
	{:else if analysis && !updating && (beyondTarget !== null || (selectedJourney && analysis.summary.unknownResidents > 0))}
		<div class="qualifications" aria-label="Access gaps">
			{#if beyondTarget !== null}<span>{count(beyondTarget)} beyond target</span>{/if}
			{#if selectedJourney && analysis.summary.unknownResidents > 0}<span
					>{count(analysis.summary.unknownResidents)} with missing evidence</span
				>{/if}
		</div>
	{/if}

	{#if scenarioActive && analysis && !updating}
		<div class="cost-line" class:needs-review={costReview}>
			{#if costReview}
				<span class="cost-title">Costs need review</span>
				<span
					>{unpricedChange
						? 'Timing or road changes are not priced'
						: 'Investment evidence is incomplete'}</span
				>
			{:else if analysis.costs.capitalMvr && analysis.costs.annualOperatingMvr}
				<span>Capital <b>{money(analysis.costs.capitalMvr.central)}</b></span>
				<span>Yearly change <b>{money(analysis.costs.annualOperatingMvr.central)}</b></span>
			{/if}
		</div>
	{/if}
</section>

<style>
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
		border: 0;
	}
	.compact-summary {
		width: 100%;
		box-sizing: border-box;
		padding: 12px 20px 17px;
		border: 0;
		border-radius: 0;
		background: #fffefa;
		color: #263a40;
		font: inherit;
		text-align: left;
	}
	.summary-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 8px;
	}
	.summary-context {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 4px 10px;
		min-width: 0;
		font-size: 12px;
		line-height: 1.4;
	}
	.context-title {
		font-weight: 650;
	}
	.context-note {
		color: #657570;
	}
	.summary-heading button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 3px;
		flex: 0 0 auto;
		min-height: 44px;
		padding: 8px 9px;
		margin: -7px -9px -7px 0;
		border: 0;
		border-radius: var(--surface-radius-pill, 999px);
		background: transparent;
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		color: #30574e;
		cursor: pointer;
	}
	.summary-heading button:hover {
		background: #eef2ec;
	}
	.summary-heading button:active {
		transform: scale(0.97);
	}
	.summary-heading button:focus-visible {
		outline: 2px solid #30574e;
		outline-offset: 2px;
	}
	.outcomes {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 20px;
		font-variant-numeric: tabular-nums;
	}
	.outcome {
		display: grid;
		align-content: start;
		gap: 5px;
		min-width: 0;
	}
	.secondary {
		border-left: 1px solid #e5e8e0;
		padding-left: 20px;
	}
	.label {
		font-size: 12px;
		line-height: 1.4;
		color: #657570;
	}
	.value-row,
	.journey-value {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 5px 8px;
		min-width: 0;
	}
	strong {
		font-size: 25px;
		font-weight: 650;
		line-height: 1.2;
		letter-spacing: -0.7px;
		overflow-wrap: anywhere;
	}
	.journey-value {
		align-items: center;
		gap: 5px;
	}
	.journey-value strong {
		font-size: 20px;
		letter-spacing: -0.5px;
	}
	.journey-value :global(svg) {
		flex: 0 0 auto;
		color: #7a8880;
	}
	.value-note {
		font-size: 12px;
		line-height: 1.4;
		color: #657570;
	}
	.qualifications {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 15px;
		margin-top: 12px;
		font-size: 11px;
		line-height: 1.45;
		color: #657570;
	}
	.harm {
		color: #8e4c35;
		font-weight: 600;
	}
	.cost-line {
		display: flex;
		flex-wrap: wrap;
		gap: 4px 15px;
		margin-top: 10px;
		padding-top: 10px;
		border-top: 1px solid #e5e8e0;
		font-size: 11px;
		line-height: 1.45;
		color: #657570;
	}
	.cost-line b {
		font-weight: 550;
		color: #263a40;
	}
	.cost-title {
		font-weight: 600;
	}
	.needs-review {
		color: #816146;
	}
	@media (max-width: 680px) {
		.compact-summary {
			padding: 11px 14px 14px;
		}
		.summary-heading {
			margin-bottom: 8px;
		}
		.context-note {
			display: none;
		}
		.outcomes {
			gap: 12px;
		}
		.secondary {
			padding-left: 12px;
		}
		.label {
			font-size: 11px;
		}
		strong {
			font-size: 22px;
		}
		.journey-value strong {
			font-size: 16px;
		}
		.value-note {
			font-size: 11px;
		}
		.qualifications {
			gap: 4px 10px;
			margin-top: 10px;
		}
		.cost-line {
			margin-top: 8px;
			padding-top: 8px;
			gap: 3px 10px;
		}
	}
	@media (max-height: 500px) and (orientation: landscape) {
		.compact-summary {
			padding-block: 8px;
		}
		.summary-heading {
			margin-bottom: 4px;
		}
		.qualifications,
		.cost-line {
			margin-top: 6px;
		}
		strong {
			font-size: 20px;
		}
	}
</style>
