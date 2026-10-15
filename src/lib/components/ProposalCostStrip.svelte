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
	const annualShare = $derived(budgetUse(annual, resolvedAnnualBudget));
	const budgets = $derived([
		{ label: 'Capital', cost: capital, limit: resolvedCapitalBudget, share: capitalShare },
		{ label: 'Yearly running', cost: annual, limit: resolvedAnnualBudget, share: annualShare }
	]);
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
		{#if over}<span class="cost-status over"><CircleAlert size={13} /> Over budget</span>
		{:else if pending}<span class="cost-status" role="status"
				><LoaderCircle size={13} class="cost-spinner" /> Recalculating</span
			>
		{:else if stale}<span class="cost-status">Changes need recalculation</span>
		{:else if economics}<span class="cost-status">Planning estimate</span>{/if}
	</div>
	<div class="cost-values">
		<div><small>One-time investment</small><strong>MVR {formatAmount(capital, true)}</strong></div>
		<div>
			<small>Added yearly running cost</small><strong>MVR {formatAmount(annual, true)}</strong>
		</div>
	</div>
	{#each budgets as budget (budget.label)}
		{#if budget.limit !== null}
			<div class="budget-summary" class:over={budget.cost !== null && budget.cost > budget.limit}>
				<div class="budget-line">
					<span>{budget.label} budget</span><span>MVR {formatAmount(budget.limit, true)}</span>
				</div>
				<div
					class="budget-track"
					class:over={budget.cost !== null && budget.cost > budget.limit}
					aria-hidden="true"
				>
					<span style:width={`${budget.share ?? 0}%`}></span>
				</div>
				<small
					>{budget.cost === null
						? 'Cost needs confirmation'
						: `MVR ${formatAmount(Math.abs(budget.limit - budget.cost), true)} ${budget.cost > budget.limit ? 'over budget' : 'remaining'}`}</small
				>
			</div>
		{/if}
	{/each}
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
	.budget-summary {
		display: grid;
		gap: 5px;
	}
	.budget-summary small {
		font-size: 10px;
		color: var(--muted-foreground);
	}
	.budget-summary.over small {
		color: var(--destructive);
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
