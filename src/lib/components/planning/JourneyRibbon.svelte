<script lang="ts">
	import TransportGraphic from './graphics/TransportGraphic.svelte';
	import type { GraphicKind } from './graphics/transportGraphics';

	export interface JourneyLegView {
		mode: 'walk' | 'wait' | 'bus' | 'ferry' | 'transfer';
		minutes?: number | null;
		label?: string;
		distanceMeters?: number | null;
	}
	let {
		legs,
		title = 'The whole journey',
		subtitle,
		totalMinutes
	}: {
		legs: readonly JourneyLegView[];
		title?: string;
		subtitle?: string;
		totalMinutes?: number | null;
	} = $props();

	const names = { walk: 'Walk', wait: 'Wait', bus: 'Bus', ferry: 'Ferry', transfer: 'Transfer' };
	const graphic = (mode: JourneyLegView['mode']): GraphicKind =>
		mode === 'transfer' ? 'terminal' : mode;
	const valid = (value: number | null | undefined): value is number =>
		typeof value === 'number' && Number.isFinite(value) && value >= 0;
	const total = $derived(
		valid(totalMinutes)
			? totalMinutes
			: legs.length > 0 && legs.every((leg) => valid(leg.minutes))
				? legs.reduce((sum, leg) => sum + (leg.minutes as number), 0)
				: null
	);
	const hasDetails = $derived(
		Boolean(
			subtitle?.trim() ||
			legs.some(
				(leg) =>
					(leg.label?.trim() && leg.label.trim() !== names[leg.mode]) ||
					(leg.mode === 'walk' && valid(leg.distanceMeters))
			)
		)
	);
	function time(value: number | null | undefined) {
		if (!valid(value)) return 'Time unknown';
		return value > 0 && value < 1 ? 'Under 1 min' : `${Math.round(value)} min`;
	}
	function distance(value: number | null | undefined) {
		if (!valid(value)) return '';
		return value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${Math.round(value)} m`;
	}
</script>

<section class="journey-ribbon" aria-label={title}>
	<header>
		<h3>{title}</h3>
		<span class="total" aria-label="Total journey time">{time(total)}</span>
	</header>
	{#if legs.length}
		<ol class="legs" aria-label="Journey steps">
			{#each legs as leg, index (index)}
				<li>
					{#if index > 0}<span class="connector" aria-hidden="true">›</span>{/if}
					<span class="leg" class:wait={leg.mode === 'wait'} class:ferry={leg.mode === 'ferry'}>
						<span class="leg-art" aria-hidden="true">
							<TransportGraphic kind={graphic(leg.mode)} size={25} compact />
						</span>
						<span>{names[leg.mode]}</span>
						<strong>{time(leg.minutes)}</strong>
					</span>
				</li>
			{/each}
		</ol>
	{:else}
		<p class="empty">No journey available for this selection.</p>
	{/if}
	{#if hasDetails}
		<details class="journey-details">
			<summary>Journey details</summary>
			<div class="detail-content">
				{#if legs.length}
					<ol>
						{#each legs as leg, index (index)}
							<li>
								<span>
									{leg.label?.trim() || names[leg.mode]}
									{#if leg.mode === 'walk' && valid(leg.distanceMeters)}<small>
											· {distance(leg.distanceMeters)}</small
										>{/if}
								</span>
								<strong>{time(leg.minutes)}</strong>
							</li>
						{/each}
					</ol>
				{/if}
				{#if subtitle?.trim()}<p>{subtitle}</p>{/if}
			</div>
		</details>
	{/if}
</section>

<style>
	.journey-ribbon {
		min-width: 0;
		max-width: 100%;
		border: 1px solid #dce7e2;
		border-radius: 12px;
		background: #fff;
		color: #243d36;
		overflow: hidden;
	}
	header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
		padding: 12px 13px 9px;
	}
	h3 {
		margin: 0;
		min-width: 0;
		font-size: 14px;
		font-weight: 600;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	.total {
		flex-shrink: 0;
		color: #27795e;
		font-size: 14px;
		font-weight: 650;
		font-variant-numeric: tabular-nums;
		line-height: 1.4;
	}
	.legs {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 4px;
		padding: 0 13px 12px;
		margin: 0;
		list-style: none;
	}
	.legs li {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		max-width: 100%;
	}
	.leg {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 7px 4px 3px;
		border-radius: 7px;
		background: #eef6f0;
		color: #365c48;
		font-size: 12px;
		line-height: 1.4;
		flex-wrap: wrap;
		min-width: 0;
		max-width: 100%;
	}
	.leg.wait {
		background: #faf3df;
		color: #79652b;
	}
	.leg.ferry {
		background: #edf5fa;
		color: #3c647e;
	}
	.leg-art {
		display: grid;
		flex-shrink: 0;
		place-items: center;
	}
	.leg strong {
		font-weight: 650;
		font-variant-numeric: tabular-nums;
	}
	.connector {
		color: #8a9b90;
		font-size: 16px;
	}
	.empty {
		padding: 0 13px 12px;
		margin: 0;
		color: #65796e;
		font-size: 13px;
		line-height: 1.5;
	}
	.journey-details {
		border-top: 1px solid #e8eee9;
	}
	summary {
		padding: 8px 13px;
		color: #60756a;
		font-size: 12px;
		line-height: 1.4;
		cursor: pointer;
	}
	summary:focus-visible {
		outline: 2px solid #27795e;
		outline-offset: -3px;
		border-radius: 5px;
	}
	.detail-content {
		padding: 0 13px 12px;
		font-size: 12px;
		line-height: 1.5;
		color: #60756a;
	}
	.detail-content ol {
		display: grid;
		gap: 6px;
		padding: 0;
		margin: 0;
		list-style: none;
	}
	.detail-content li {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: baseline;
		gap: 12px;
	}
	.detail-content li > span {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.detail-content strong {
		flex-shrink: 0;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.detail-content small {
		font-size: inherit;
	}
	.detail-content p {
		margin: 9px 0 0;
	}
	.detail-content p:first-child {
		margin-top: 0;
	}
	@media (max-width: 350px) {
		header {
			flex-wrap: wrap;
			gap: 4px 12px;
		}
	}
	@media (pointer: coarse) {
		summary {
			min-height: 44px;
			box-sizing: border-box;
			padding-top: 13px;
			padding-bottom: 13px;
		}
	}
</style>
