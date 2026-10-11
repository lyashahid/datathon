<script lang="ts">
	import { ArrowUpRight, ChevronRight, CircleHelp, Route, Users } from '@lucide/svelte';
	import type { JourneyChangeTotals } from './journeyChanges.ts';

	let {
		totals,
		label,
		busy,
		preview = false,
		awaitingService = false,
		cumulative = false,
		unavailable = false,
		announce = true,
		compact = false,
		onshowareas,
		ondetails,
		onconnect,
		onretry
	}: {
		totals: JourneyChangeTotals | null;
		label: string;
		busy: boolean;
		preview?: boolean;
		awaitingService?: boolean;
		cumulative?: boolean;
		unavailable?: boolean;
		announce?: boolean;
		compact?: boolean;
		onshowareas: () => void;
		ondetails: () => void;
		onconnect?: (mode: 'new' | 'insert') => void;
		onretry?: () => void;
	} = $props();

	const count = (value: number) => Math.round(value).toLocaleString('en-GB');
	const averageDefinition =
		'Population-weighted average among residents with a supported journey in both plans. New routes and missing journey evidence are excluded.';
	const comparisonLabel = $derived(
		cumulative ? 'Compared with the current network' : 'Compared with your previous plan'
	);
	const average = $derived(totals?.averageMinutesSaved ?? null);
	const averageText = $derived.by(() => {
		if (average === null || !Number.isFinite(average)) return 'Not available';
		const saved = Math.abs(average);
		if (saved <= 0.01) return 'No time change';
		const duration =
			saved < 0.1
				? `${Math.max(1, Math.round(saved * 60))} sec`
				: `${saved.toLocaleString('en-GB', { maximumFractionDigits: 1 })} min`;
		return `${duration} ${average > 0 ? 'saved' : 'longer'}`;
	});
	const componentId = $props.id();
	const descriptionId = `${componentId}-average`;
</script>

<section
	class="impact-receipt"
	class:awaiting-service={awaitingService}
	class:compact
	aria-label="Journey impact of this change"
	aria-busy={busy && !awaitingService}
	data-testid="edit-impact-receipt"
>
	{#if unavailable && !busy}
		<div class="context service-context" aria-live={announce ? 'polite' : 'off'}>
			<CircleHelp size={19} strokeWidth={1.7} aria-hidden="true" />
			<div>
				<strong>Impact unavailable</strong>
				<p>Journey impact could not be calculated. Previous results are not shown.</p>
			</div>
		</div>
		<div class="actions service-actions">
			{#if onretry}
				<button type="button" class="primary" onclick={onretry}>Try again</button>
			{/if}
			<button type="button" class="details" onclick={ondetails}
				>Details <ChevronRight size={14} aria-hidden="true" /></button
			>
		</div>
	{:else if awaitingService}
		<div class="context service-context" aria-live={announce ? 'polite' : 'off'}>
			<Route size={19} strokeWidth={1.7} aria-hidden="true" />
			<div>
				<strong>Connect this stop to a route</strong>
				<p>Add a proposed service to test journey changes.</p>
			</div>
		</div>
		<div class="actions service-actions">
			{#if onconnect}
				<button type="button" class="primary" onclick={() => onconnect?.('insert')}>
					Add to a route <ChevronRight size={14} aria-hidden="true" />
				</button>
				<button type="button" onclick={() => onconnect?.('new')}>Start a new route</button>
			{/if}
		</div>
	{:else}
		<div class="context">
			<div class="context-heading">
				<strong>{preview ? 'Live preview' : label}</strong>
				<span class="estimate">Model estimate</span>
			</div>
			<p>{comparisonLabel}</p>
		</div>
		{#if busy}
			<div class="calculation" role="status" aria-live={announce ? 'polite' : 'off'}>
				<span class="loading-mark" aria-hidden="true"></span>
				<span>Calculating journey impact…</span>
			</div>
		{:else if totals}
			<div class="metrics" aria-live={announce ? 'polite' : 'off'} aria-atomic="true">
				<div class="metric benefit">
					<div class="metric-value">
						<Users size={16} strokeWidth={1.7} aria-hidden="true" />
						<strong>{count(totals.improvedPopulation)}</strong>
						<span>residents with better journeys</span>
					</div>
					<div class="qualifications">
						{#if totals.journeyChangePopulation['new-route'] > 0}
							<span>{count(totals.journeyChangePopulation['new-route'])} gain a route</span>
						{/if}
						{#if totals.journeyChangePopulation.slower > 0}
							<span class="harm">{count(totals.journeyChangePopulation.slower)} slower</span>
						{/if}
						{#if totals.journeyChangePopulation['lost-route'] > 0}
							<span class="harm"
								>{count(totals.journeyChangePopulation['lost-route'])} lose a route</span
							>
						{/if}
						{#if totals.journeyChangePopulation.unknown > 0}
							<span>{count(totals.journeyChangePopulation.unknown)} with missing evidence</span>
						{:else if totals.worsenedPopulation === 0}
							<span>No journeys made worse</span>
						{/if}
					</div>
				</div>
				<div class="metric average" aria-describedby={descriptionId}>
					<strong>{averageText}</strong>
					<span title={averageDefinition}
						>Average, comparable trips <CircleHelp size={12} aria-hidden="true" /></span
					>
				</div>
			</div>
			<span class="visually-hidden" id={descriptionId}>{averageDefinition}</span>
		{:else}
			<p class="empty-state">Plan a bus connection to compare its effect on journeys.</p>
		{/if}
		<div class="actions">
			{#if totals && !busy}
				<button type="button" onclick={onshowareas}>
					Show affected areas <ArrowUpRight size={14} aria-hidden="true" />
				</button>
			{/if}
			<button type="button" class="details" onclick={ondetails}>
				Details <ChevronRight size={14} aria-hidden="true" />
			</button>
		</div>
	{/if}
</section>

<style>
	.impact-receipt {
		display: flex;
		align-items: center;
		gap: 20px;
		min-height: 88px;
		box-sizing: border-box;
		padding: 14px 20px;
		border-top: 1px solid #e0e5e2;
		background: #f8faf7;
		color: #263a40;
		font-size: 12px;
		line-height: 1.4;
	}
	.context {
		flex: 0 1 205px;
		min-width: 160px;
	}
	.context-heading {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 5px 8px;
	}
	.context strong {
		font-size: 13px;
		font-weight: 650;
	}
	.context p {
		margin: 4px 0 0;
		color: #657578;
		font-size: 11px;
	}
	.estimate {
		padding: 2px 6px;
		border: 1px solid #d7e0da;
		border-radius: 4px;
		color: #53665b;
		font-size: 10px;
		white-space: nowrap;
	}
	.metrics {
		display: flex;
		align-items: center;
		gap: 24px;
		flex: 1;
		min-width: 0;
	}
	.benefit {
		flex: 1;
	}
	.metric-value {
		display: flex;
		align-items: baseline;
		flex-wrap: wrap;
		gap: 5px;
	}
	.metric-value :global(svg) {
		align-self: center;
		color: #547f65;
	}
	.metric-value strong {
		font-size: 22px;
		font-weight: 650;
		letter-spacing: -0.6px;
		font-variant-numeric: tabular-nums;
		line-height: 1.2;
	}
	.metric-value > span {
		color: #445c52;
		font-size: 12px;
	}
	.qualifications {
		display: flex;
		flex-wrap: wrap;
		gap: 2px 12px;
		margin-top: 5px;
		color: #657578;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.harm {
		color: #995031;
	}
	.average {
		display: flex;
		flex-direction: column;
		gap: 4px;
		flex: 0 0 auto;
		padding-left: 20px;
		border-left: 1px solid #dce3de;
	}
	.average strong {
		font-size: 15px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.average > span {
		display: flex;
		align-items: center;
		gap: 5px;
		color: #657578;
		font-size: 11px;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 4px;
		flex: 0 0 auto;
	}
	.actions button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 5px;
		min-height: 44px;
		padding: 0 10px;
		border: 1px solid transparent;
		border-radius: var(--surface-radius-pill);
		background: transparent;
		color: #315c4c;
		font: inherit;
		font-weight: 550;
		cursor: pointer;
		transition:
			background-color 150ms ease,
			transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
	}
	.actions button:active {
		transform: scale(0.97);
	}
	.actions button:focus-visible {
		outline: 2px solid #287c68;
		outline-offset: 3px;
	}
	.actions .details {
		color: #657578;
	}
	.actions .primary {
		border-color: #2d6350;
		background: #2d6350;
		color: #fff;
	}
	.service-context {
		display: flex;
		align-items: center;
		gap: 12px;
		flex: 1;
	}
	.service-context > :global(svg) {
		flex-shrink: 0;
		color: #537463;
	}
	.calculation,
	.empty-state {
		flex: 1;
		margin: 0;
		color: #657578;
	}
	.calculation {
		display: flex;
		align-items: center;
		gap: 9px;
	}
	.loading-mark {
		width: 13px;
		height: 13px;
		border: 2px solid #d6e3da;
		border-top-color: #547f65;
		border-radius: 50%;
		animation: turn 850ms linear infinite;
	}
	.visually-hidden {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	@keyframes turn {
		to {
			transform: rotate(360deg);
		}
	}
	@media (hover: hover) and (pointer: fine) {
		.actions button:hover {
			background: #e9f0e9;
		}
		.actions .primary:hover {
			background: #214e3e;
		}
	}
	@media (min-width: 1151px) {
		.impact-receipt.compact {
			flex-direction: column;
			align-items: stretch;
			gap: 10px;
			min-width: 0;
			min-height: 180px;
			padding: 12px 16px;
		}
		.compact .context {
			flex: none;
			min-width: 0;
		}
		.compact .context-heading {
			justify-content: space-between;
		}
		.compact .context p {
			margin-top: 2px;
			font-size: 10px;
		}
		.compact .metrics {
			display: grid;
			grid-template-columns: minmax(0, 1fr) 110px;
			align-items: start;
			gap: 6px 12px;
			flex: none;
		}
		.compact .benefit {
			display: contents;
		}
		.compact .metric-value {
			grid-column: 1;
			grid-row: 1;
			min-width: 0;
			gap: 3px;
		}
		.compact .metric-value :global(svg) {
			display: none;
		}
		.compact .metric-value strong {
			font-size: 20px;
		}
		.compact .metric-value > span {
			flex-basis: 100%;
			font-size: 11px;
			line-height: 1.3;
		}
		.compact .qualifications {
			grid-column: 1 / -1;
			grid-row: 2;
			gap: 2px 8px;
			margin-top: 0;
			font-size: 10px;
		}
		.compact .average {
			grid-column: 2;
			grid-row: 1;
			min-width: 0;
			padding-left: 12px;
			overflow-wrap: anywhere;
		}
		.compact .average strong {
			font-size: 13px;
		}
		.compact .average > span {
			font-size: 10px;
		}
		.compact .average :global(svg) {
			display: none;
		}
		.compact .actions {
			flex-wrap: wrap;
			justify-content: flex-end;
			min-width: 0;
			margin-top: auto;
		}
		.compact .actions button {
			min-width: 0;
			padding: 0 8px;
			font-size: 11px;
		}
		.compact .calculation,
		.compact .empty-state {
			flex: none;
		}
	}
	@media (max-width: 1100px) {
		.impact-receipt {
			gap: 14px;
		}
		.context {
			flex-basis: 160px;
			min-width: 125px;
		}
		.metrics {
			gap: 14px;
		}
		.average {
			padding-left: 14px;
		}
		.actions {
			flex-direction: column;
			gap: 0;
		}
		.actions button {
			min-height: 44px;
		}
		.service-actions {
			flex-direction: row;
		}
	}
	@media (max-width: 680px) {
		.impact-receipt {
			flex-wrap: wrap;
			gap: 10px 12px;
			padding: 12px 16px;
		}
		.context {
			flex: 1 1 100%;
		}
		.context-heading {
			justify-content: space-between;
		}
		.context p {
			margin-top: 2px;
		}
		.metrics {
			flex-basis: 100%;
		}
		.metric-value :global(svg) {
			display: none;
		}
		.metric-value strong {
			font-size: 20px;
		}
		.metric-value > span {
			font-size: 11px;
		}
		.average {
			max-width: 120px;
		}
		.average strong {
			font-size: 13px;
		}
		.average > span {
			font-size: 10px;
		}
		.average :global(svg) {
			display: none;
		}
		.actions,
		.service-actions {
			flex-direction: row;
			justify-content: flex-end;
			flex-basis: 100%;
			margin-top: -3px;
		}
		.actions button {
			padding: 0 8px;
		}
		.service-context {
			flex-basis: 100%;
		}
		.calculation {
			flex-basis: 100%;
		}
	}
	@media (max-width: 680px) {
		.impact-receipt.compact {
			flex-direction: column;
			flex-wrap: nowrap;
			align-items: stretch;
			gap: 6px;
			padding: 10px 12px;
		}
		.compact .context,
		.compact .metrics,
		.compact .actions,
		.compact .calculation,
		.compact .empty-state {
			flex: none;
			min-width: 0;
		}
		.compact .context-heading {
			flex-wrap: nowrap;
		}
		.compact .context-heading + p {
			display: none;
		}
		.compact .metrics {
			display: grid;
			grid-template-columns: minmax(0, 1fr) 90px;
			align-items: start;
			gap: 4px 10px;
		}
		.compact .benefit {
			display: contents;
		}
		.compact .metric-value {
			grid-column: 1;
			grid-row: 1;
			min-width: 0;
			gap: 2px;
		}
		.compact .metric-value > span {
			flex-basis: 100%;
			line-height: 1.25;
		}
		.compact .average {
			grid-column: 2;
			grid-row: 1;
			min-width: 0;
			gap: 3px;
			padding-left: 10px;
			overflow-wrap: anywhere;
		}
		.compact .average strong {
			font-size: 12px;
		}
		.compact .qualifications {
			grid-column: 1 / -1;
			grid-row: 2;
			gap: 2px 8px;
			margin-top: 0;
			font-size: 10px;
		}
		.compact .actions {
			flex-wrap: wrap;
			margin-top: 0;
		}
		.compact .actions button {
			font-size: 11px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.actions button {
			transition: none;
		}
		.loading-mark {
			animation: none;
		}
	}
</style>
