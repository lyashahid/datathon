<script lang="ts">
	import { ArrowUpRight, CircleAlert, LoaderCircle } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import {
		budgetUse,
		finiteValue,
		formatAmount,
		type PlanningEconomics
	} from '#lib/proposal-review.js';

	let {
		economics = null,
		capitalBudget = null,
		annualBudget = null,
		pending = false,
		stale = false,
		operationCount = 0,
		onReview = () => {}
	}: {
		economics?: PlanningEconomics | null;
		capitalBudget?: number | null;
		annualBudget?: number | null;
		pending?: boolean;
		stale?: boolean;
		operationCount?: number;
		onReview?: () => void;
	} = $props();
	const capital = $derived(finiteValue(economics?.delta.capital_mvr));
	const annual = $derived(finiteValue(economics?.delta.annual_operating_mvr));
	const resolvedCapitalBudget = $derived(
		capitalBudget ?? finiteValue(economics?.budget.capital_budget_mvr)
	);
	const resolvedAnnualBudget = $derived(
		annualBudget ?? finiteValue(economics?.budget.annual_operating_budget_mvr)
	);
	const capitalShare = $derived(budgetUse(capital, resolvedCapitalBudget));
	const over = $derived(
		(capital !== null && resolvedCapitalBudget !== null && capital > resolvedCapitalBudget) ||
			(annual !== null && resolvedAnnualBudget !== null && annual > resolvedAnnualBudget)
	);
</script>

<section class="proposal-cost-strip" aria-label="Proposal budget" aria-busy={pending}>
	<div class="cost-heading">
		<span class="draft-label"
			>{operationCount} {operationCount === 1 ? 'change' : 'changes'} in your proposal</span
		>
		{#if pending}<span class="cost-status" role="status"
				><LoaderCircle size={13} class="cost-spinner" /> Recalculating</span
			>
		{:else if stale}<span class="cost-status">Changes need recalculation</span>
		{:else if over}<span class="cost-status over"><CircleAlert size={13} /> Over budget</span>
		{:else if economics}<span class="cost-status">Planning estimate</span>{/if}
	</div>
	<div class="cost-values" class:outdated={pending || stale}>
		<div><small>One-time investment</small><strong>MVR {formatAmount(capital, true)}</strong></div>
		<div>
			<small>Added yearly running cost</small><strong>MVR {formatAmount(annual, true)}</strong>
		</div>
	</div>
	{#if resolvedCapitalBudget !== null}
		<div class="budget-line">
			<span>Capital budget</span><span>MVR {formatAmount(resolvedCapitalBudget, true)}</span>
		</div>
		<div class="budget-track" class:over aria-hidden="true">
			<span style:width={`${capitalShare ?? 0}%`}></span>
		</div>
	{/if}
	<Button class="review-button" onclick={onReview} disabled={!operationCount || pending}>
		Review full impact <ArrowUpRight size={15} />
	</Button>
	{#if !economics && !pending}<p>Confirm a change to calculate costs and resident access.</p>{/if}
</section>

<style>
	.proposal-cost-strip {
		display: grid;
		gap: 12px;
		padding: 16px;
		border: 1px solid var(--border);
		border-radius: 16px;
		background: var(--card);
	}
	.cost-heading,
	.budget-line {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.draft-label {
		font-size: 12px;
		font-weight: 600;
	}
	.cost-status {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		color: var(--muted-foreground);
		font-size: 10px;
	}
	.over {
		color: var(--destructive);
	}
	.cost-values {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
	}
	.cost-values div {
		display: grid;
		gap: 5px;
		min-width: 0;
	}
	.cost-values small,
	.budget-line,
	p {
		font-size: 11px;
		color: var(--muted-foreground);
	}
	.cost-values strong {
		font-size: 19px;
		letter-spacing: -0.6px;
		font-variant-numeric: tabular-nums;
	}
	.outdated strong {
		color: var(--muted-foreground);
	}
	.budget-track {
		height: 5px;
		overflow: hidden;
		background: var(--muted);
		border-radius: 20px;
	}
	.budget-track span {
		display: block;
		height: 100%;
		background: var(--chart-1);
		border-radius: inherit;
	}
	.budget-track.over span {
		background: var(--destructive);
	}
	.proposal-cost-strip :global(.review-button) {
		width: 100%;
		justify-content: space-between;
	}
	.proposal-cost-strip :global(.cost-spinner) {
		animation: turn 0.8s linear infinite;
	}
	@keyframes turn {
		to {
			transform: rotate(360deg);
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.proposal-cost-strip :global(.cost-spinner) {
			animation: none;
		}
	}
	@media (max-width: 420px) {
		.cost-heading {
			align-items: flex-start;
			flex-direction: column;
			gap: 5px;
		}
		.cost-values strong {
			font-size: 17px;
		}
	}
</style>
