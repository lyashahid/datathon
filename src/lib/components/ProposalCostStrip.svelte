<script lang="ts">
	import {
		ArrowUpRight,
		CircleAlert,
		LoaderCircle,
		SlidersHorizontal,
		Undo2
	} from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import AnimatedNumber from './AnimatedNumber.svelte';
	import { proposalBenefit } from '#lib/proposal-benefit.js';
	import type { TransportImpactData } from '#lib/transport-impact.js';
	import {
		budgetUse,
		finiteValue,
		formatAmount,
		type PlanningEconomics
	} from '#lib/proposal-review.js';

	let {
		economics = null,
		capitalBudget = undefined,
		annualBudget = undefined,
		pending = false,
		stale = false,
		operationCount = 0,
		compact = false,
		embedded = false,
		preview = false,
		previewChecking = false,
		gainedResidents = null,
		transportImpact = null,
		resultTime = '',
		context = '',
		onEditBudget = () => {},
		onUndo = () => {},
		canUndo = false,
		onReview = () => {}
	}: {
		economics?: PlanningEconomics | null;
		capitalBudget?: number | null;
		annualBudget?: number | null;
		pending?: boolean;
		stale?: boolean;
		operationCount?: number;
		compact?: boolean;
		embedded?: boolean;
		preview?: boolean;
		previewChecking?: boolean;
		gainedResidents?: number | null;
		transportImpact?: TransportImpactData | null;
		resultTime?: string;
		context?: string;
		onEditBudget?: () => void;
		onUndo?: () => void;
		canUndo?: boolean;
		onReview?: () => void;
	} = $props();
	const capital = $derived(finiteValue(economics?.delta.capital_mvr));
	const annual = $derived(finiteValue(economics?.delta.annual_operating_mvr));
	const resolvedCapitalBudget = $derived(
		capitalBudget === undefined ? finiteValue(economics?.budget.capital_budget_mvr) : capitalBudget
	);
	const resolvedAnnualBudget = $derived(
		annualBudget === undefined
			? finiteValue(economics?.budget.annual_operating_budget_mvr)
			: annualBudget
	);
	const capitalShare = $derived(budgetUse(capital, resolvedCapitalBudget));
	const annualShare = $derived(budgetUse(annual, resolvedAnnualBudget));
	const budgets = $derived([
		{
			label: compact ? 'Upfront' : 'Capital',
			cost: capital,
			limit: resolvedCapitalBudget,
			share: capitalShare
		},
		{ label: 'Yearly running', cost: annual, limit: resolvedAnnualBudget, share: annualShare }
	]);
	const previewUnpriced = $derived(preview && previewChecking);
	const displayGained = $derived(finiteValue(gainedResidents));
	const benefit = $derived(proposalBenefit(displayGained, transportImpact));
	const animateValues = $derived(!pending && !stale && !previewChecking);
	const numberContext = $derived(`${context}:${preview ? 'preview' : 'accepted'}`);
	const formatBenefit = (value: number) =>
		new Intl.NumberFormat('en', { maximumFractionDigits: benefit.unit ? 1 : 0 }).format(value);
	const over = $derived(
		(capital !== null && resolvedCapitalBudget !== null && capital > resolvedCapitalBudget) ||
			(annual !== null && resolvedAnnualBudget !== null && annual > resolvedAnnualBudget)
	);
</script>

<section
	class="proposal-cost-strip"
	class:compact
	class:embedded
	aria-label="Proposal budget"
	aria-busy={pending}
	data-preview={preview}
	data-preview-checking={previewUnpriced}
>
	<div class="cost-heading">
		<span class="draft-label"
			>{compact
				? 'Your proposal'
				: `${operationCount} ${operationCount === 1 ? 'change' : 'changes'} in your proposal`}{#if compact && operationCount}<span
					class="change-count">{operationCount}</span
				>{/if}</span
		>
		{#if previewUnpriced}<span class="cost-status" role="status">Cost check needed</span>
		{:else if over}<span class="cost-status over"><CircleAlert size={13} /> Over budget</span>
		{:else if pending}<span class="cost-status" role="status"
				><LoaderCircle size={13} class="cost-spinner" /> Updating…</span
			>
		{:else if stale}<span class="cost-status">Previous calculation</span>
		{:else if economics}<span class="cost-status"
				>{preview
					? 'Preview estimate'
					: resultTime
						? `Calculated ${resultTime}`
						: 'Planning estimate'}</span
			>{/if}
	</div>
	<div class="cost-values">
		<div>
			<small>{compact ? 'Upfront cost' : 'One-time investment'}</small><strong
				>{#if previewUnpriced || capital === null}—{:else}<span class="currency">MVR</span>
					<AnimatedNumber
						value={capital}
						format={(value) => formatAmount(value, true)}
						animate={animateValues}
						context={numberContext}
					/>{/if}</strong
			>
		</div>
		<div>
			<small>{compact ? 'Yearly running' : 'Added yearly running cost'}</small><strong
				>{#if previewUnpriced || annual === null}—{:else}<span class="currency">MVR</span>
					<AnimatedNumber
						value={annual}
						format={(value) => formatAmount(value, true)}
						animate={animateValues}
						context={numberContext}
					/>{/if}</strong
			>
		</div>
		{#if compact}<div class="resident-value">
				<small>{benefit.label}</small><strong
					class:updating={benefit.value === null && pending}
					class:reduced={benefit.reduced}
					><AnimatedNumber
						value={benefit.value}
						format={formatBenefit}
						empty={pending ? 'Updating…' : '—'}
						animate={animateValues}
						context={`${numberContext}:${benefit.label}`}
					/>{#if benefit.value !== null && benefit.unit}<span class="benefit-unit">
							{benefit.unit}</span
						>{/if}</strong
				>
			</div>{/if}
	</div>
	{#if compact && benefit.detail}<p class="benefit-detail" class:reduced={benefit.reduced}>
			{benefit.detail}
		</p>{/if}
	{#if compact && benefit.guardrail}<p class="benefit-guardrail">{benefit.guardrail}</p>{/if}
	{#if stale && !preview}<p class="result-qualification" role="status">
			{pending
				? 'Showing the previous impact while your changes are calculated.'
				: 'Impact is from the previous calculation. Review impact to retry your changes.'}
		</p>{/if}
	{#if preview}<p class="preview-note" role="status">
			{previewUnpriced
				? 'Budget remaining appears after the preview is priced. Check the location and service settings before confirming.'
				: 'Preview includes the change being placed. Confirm to add it.'}
		</p>{/if}
	<div class="budgets">
		{#each budgets as budget (budget.label)}
			{#if budget.limit !== null}
				<div
					class="budget-summary"
					class:over={!previewUnpriced && budget.cost !== null && budget.cost > budget.limit}
				>
					<div class="budget-line">
						<span>{budget.label} budget</span><span>MVR {formatAmount(budget.limit, true)}</span>
					</div>
					<div
						class="budget-track"
						class:over={!previewUnpriced && budget.cost !== null && budget.cost > budget.limit}
						aria-hidden="true"
					>
						<span style:width={`${previewUnpriced ? 0 : (budget.share ?? 0)}%`}></span>
					</div>
					<small
						>{previewUnpriced
							? 'Preview cost needed'
							: budget.cost === null
								? 'Cost needs confirmation'
								: `MVR ${formatAmount(Math.abs(budget.limit - budget.cost), true)} ${budget.cost > budget.limit ? 'over budget' : 'remaining'}`}</small
					>
				</div>
			{:else if compact}<div class="budget-summary no-limit">
					<span>{budget.label} budget</span><small>Enter a valid limit</small>
				</div>
			{/if}
		{/each}
	</div>
	{#if compact}<div class="compact-actions">
			<Button
				variant="ghost"
				size="sm"
				class="budget-action"
				aria-label="Edit budget"
				onclick={onEditBudget}><SlidersHorizontal size={14} /> Budget</Button
			><Button
				variant="ghost"
				size="sm"
				class="undo-action"
				aria-label="Undo proposal change"
				onclick={onUndo}
				disabled={!canUndo}><Undo2 size={14} /> Undo</Button
			><Button
				size="sm"
				class="review-button"
				aria-label="Review full impact"
				onclick={onReview}
				disabled={!operationCount || pending || preview}
				>Review impact <ArrowUpRight size={14} /></Button
			>
		</div>
	{:else}<Button class="review-button" onclick={onReview} disabled={!operationCount || pending}>
			Review full impact <ArrowUpRight size={15} />
		</Button>{/if}
	{#if !economics && !pending}<p>Confirm a change to calculate costs and resident access.</p>{/if}
</section>

<style>
	.proposal-cost-strip {
		container-type: inline-size;
		display: grid;
		gap: 12px;
		padding: 16px;
		border: 1px solid var(--border);
		border-radius: 16px;
		background: var(--card);
	}
	.budgets {
		display: grid;
		gap: 12px;
	}
	.change-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 20px;
		height: 20px;
		margin-left: 7px;
		border-radius: 6px;
		background: var(--muted);
		font-size: 10px;
		font-variant-numeric: tabular-nums;
	}
	.preview-note {
		margin: 0;
		padding: 7px 9px;
		border-radius: 8px;
		background: color-mix(in srgb, var(--chart-1) 8%, var(--card));
		line-height: 1.45;
	}
	.no-limit {
		font-size: 10px;
		color: var(--muted-foreground);
	}
	.compact {
		gap: 12px;
		padding: 16px;
		border-color: color-mix(in srgb, var(--border) 85%, transparent);
		background: color-mix(in srgb, var(--card) 97%, transparent);
		box-shadow: 0 8px 28px #173e3915;
	}
	.embedded {
		padding: 0;
		border: 0;
		border-radius: 0;
		background: transparent;
		box-shadow: none;
	}
	.compact .cost-values {
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
	}
	.compact .cost-values > div + div {
		padding-left: 10px;
		border-left: 1px solid var(--border);
	}
	.compact .cost-values strong {
		font-size: 17px;
		letter-spacing: -0.45px;
		line-height: 1.2;
		white-space: nowrap;
	}
	.compact .cost-values .currency {
		font-size: 10px;
		font-weight: 500;
		letter-spacing: 0;
		color: var(--muted-foreground);
	}
	.compact .cost-values small {
		font-size: 10px;
		line-height: 1.4;
	}
	.compact .resident-value strong {
		color: #176c61;
	}
	.compact .resident-value strong.reduced,
	.benefit-detail.reduced {
		color: var(--destructive);
	}
	.benefit-unit {
		font-size: 10px;
		font-weight: 500;
		letter-spacing: 0;
	}
	.benefit-detail,
	.benefit-guardrail,
	.result-qualification {
		margin: 0;
		font-size: 10px;
		line-height: 1.5;
	}
	.benefit-detail {
		color: #176c61;
	}
	.benefit-guardrail {
		color: #8b5424;
	}
	.compact .resident-value strong.updating {
		font-size: 12px;
		letter-spacing: 0;
	}
	.compact .budgets {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 12px;
	}
	.compact .budget-line {
		display: grid;
		justify-content: start;
		gap: 3px;
		font-size: 10px;
	}
	.compact .budget-line > span:last-child {
		font-weight: 550;
		font-variant-numeric: tabular-nums;
	}
	.compact-actions {
		display: grid;
		grid-template-columns: auto auto minmax(0, 1fr);
		align-items: center;
		gap: 6px;
		padding-top: 12px;
		border-top: 1px solid var(--border);
	}
	.compact-actions :global(button) {
		min-width: 0;
		height: 36px;
		gap: 5px;
		padding-inline: 8px;
		font-size: 11px;
	}
	.proposal-cost-strip.compact .compact-actions :global(.review-button) {
		width: 100%;
		justify-content: center;
	}
	.cost-heading,
	.budget-line {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		line-height: 1.4;
	}
	.cost-heading {
		flex-wrap: wrap;
		gap: 4px 10px;
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
		min-width: 0;
		line-height: 1.4;
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
	@container (max-width: 300px) {
		.compact .cost-values strong {
			font-size: 15px;
		}
		.compact .preview-note {
			display: none;
		}
	}
	@container (max-width: 280px) {
		.compact .cost-values small {
			min-height: 2.8em;
		}
		.compact-actions {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.proposal-cost-strip.compact .compact-actions :global(.review-button) {
			grid-column: 1 / -1;
		}
	}
</style>
