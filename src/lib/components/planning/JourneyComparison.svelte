<script lang="ts">
	import { ArrowRight, Check, Minus, TriangleAlert } from '@lucide/svelte';
	import type { OriginComparison, PlanningJourney } from '#lib/planning/types.ts';
	import { journeyChange, journeyChangeSummary } from './journeyChanges';

	let {
		comparison,
		pending = false,
		example = false,
		beforeLabel = 'Before',
		afterLabel = 'With proposal',
		unavailable = false
	}: {
		comparison: OriginComparison | null;
		pending?: boolean;
		example?: boolean;
		beforeLabel?: string;
		afterLabel?: string;
		unavailable?: boolean;
	} = $props();

	const change = $derived(journeyChange(comparison ?? undefined));
	const improved = $derived(change === 'faster' || change === 'new-route');
	const worsened = $derived(change === 'slower' || change === 'lost-route');
	const summary = $derived(
		comparison?.before.status === 'unreachable' && comparison.after.status === 'unreachable'
			? 'No journey is currently possible'
			: journeyChangeSummary(comparison ?? undefined)
	);

	function time(journey: PlanningJourney | undefined) {
		if (journey?.status === 'unreachable') return 'No route';
		if (
			journey?.status !== 'reachable' ||
			journey.minutes === null ||
			!Number.isFinite(journey.minutes) ||
			journey.minutes < 0
		)
			return 'Incomplete';
		return `${journey.minutes.toLocaleString('en-US', {
			minimumFractionDigits: 1,
			maximumFractionDigits: 1
		})} min`;
	}
</script>

<section
	class="journey-comparison"
	class:improved={!pending && !unavailable && improved}
	class:worsened={!pending && !unavailable && worsened}
	class:pending
	aria-label={`${beforeLabel} and ${afterLabel} journey time`}
	aria-busy={pending}
>
	<header>
		<h3>Journey time</h3>
		{#if pending && !unavailable}<span class="calculating" role="status">Recalculating…</span>{/if}
	</header>
	{#if unavailable}
		<p class="empty">Journey results are unavailable. Retry the calculation to assess this area.</p>
	{:else if comparison}
		{#if example}<p class="example">Example journey in this area</p>{/if}
		<div class="comparison-values">
			<div class="before">
				<span class="label">{beforeLabel}</span>
				<strong>{time(comparison.before)}</strong>
			</div>
			<ArrowRight size={17} strokeWidth={1.8} class="journey-arrow" aria-hidden="true" />
			<div class="after">
				<span class="label">{afterLabel}</span>
				<strong>{time(comparison.after)}</strong>
			</div>
		</div>
		<p class="change-summary" aria-live="polite" aria-atomic="true">
			{#if pending}
				Updating this journey…
			{:else}
				{#if improved}<Check size={14} strokeWidth={2.2} aria-hidden="true" />
				{:else if worsened || change === 'unknown'}<TriangleAlert
						size={14}
						strokeWidth={1.8}
						aria-hidden="true"
					/>
				{:else}<Minus size={14} strokeWidth={1.8} aria-hidden="true" />{/if}
				<span>{summary}</span>
			{/if}
		</p>
	{:else}
		<p class="empty">
			{pending ? 'Calculating journey times…' : 'Select an area to compare its journey.'}
		</p>
	{/if}
</section>

<style>
	.journey-comparison {
		min-width: 0;
		max-width: 100%;
		padding: 12px 13px;
		border: 1px solid #dce7e2;
		border-radius: 12px;
		background: #f9fbfa;
		color: #243d36;
	}
	.journey-comparison.improved {
		border-color: #bfded2;
		background: #f2faf6;
	}
	.journey-comparison.worsened {
		border-color: #edd0c8;
		background: #fff7f4;
	}
	header {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 4px 8px;
	}
	h3 {
		margin: 0;
		font-size: 13px;
		font-weight: 650;
		line-height: 1.4;
	}
	.calculating,
	.example {
		color: #64796f;
		font-size: 11px;
		line-height: 1.5;
	}
	.example {
		margin: 3px 0 0;
	}
	.comparison-values {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 17px minmax(0, 1fr);
		align-items: center;
		gap: 9px;
		margin-top: 11px;
		transition: opacity 160ms ease;
	}
	.pending .comparison-values {
		opacity: 0.5;
	}
	.comparison-values > div {
		display: grid;
		gap: 3px;
		min-width: 0;
	}
	.label {
		color: #6a7e75;
		font-size: 11px;
		line-height: 1.4;
	}
	strong {
		font-size: clamp(16px, 2vw, 20px);
		font-weight: 650;
		font-variant-numeric: tabular-nums;
		line-height: 1.25;
		letter-spacing: -0.025em;
		overflow-wrap: anywhere;
	}
	.before strong {
		color: #5f746a;
	}
	.improved .after strong,
	.improved .change-summary {
		color: #1b785a;
	}
	.worsened .after strong,
	.worsened .change-summary {
		color: #a64b36;
	}
	:global(.journey-arrow) {
		color: #92a39a;
		margin-top: 15px;
	}
	.change-summary {
		display: flex;
		align-items: center;
		gap: 5px;
		margin: 10px 0 0;
		color: #61786c;
		font-size: 12px;
		font-weight: 550;
		line-height: 1.5;
	}
	.change-summary :global(svg) {
		flex-shrink: 0;
	}
	.empty {
		margin: 7px 0 0;
		color: #64796f;
		font-size: 12px;
		line-height: 1.5;
	}
	@media (prefers-reduced-motion: reduce) {
		.comparison-values {
			transition: none;
		}
	}
</style>
