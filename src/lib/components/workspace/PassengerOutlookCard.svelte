<script lang="ts">
	import { ArrowUpRight, ChevronDown, TrendingUp } from '@lucide/svelte';
	import type { MonthlyForecast } from '#lib/prediction/types.ts';
	import { forecastCaution } from '#lib/components/policy/forecastPresentation.ts';
	let {
		series,
		pending = false,
		requestedMonth,
		onOpen
	}: {
		series: MonthlyForecast | null;
		pending?: boolean;
		requestedMonth?: string;
		onOpen: () => void;
	} = $props();
	const caution = $derived(series ? forecastCaution(series) : null);
	const count = (value: number | null) =>
		value == null ? 'Unavailable' : Math.round(value).toLocaleString('en-GB');
	const month = (value: string) =>
		new Date(`${value}-01T00:00:00Z`).toLocaleDateString('en-GB', {
			month: 'short',
			year: 'numeric',
			timeZone: 'UTC'
		});
</script>

<aside class="outlook" aria-label="Passenger outlook">
	<details>
		<summary
			><span class="outlook-heading"
				><TrendingUp size={15} />Passenger outlook<ChevronDown
					size={14}
					class="disclosure-icon"
				/></span
			><strong
				>{series ? count(series.estimate) : pending ? 'Awaiting estimate' : 'Unavailable'}</strong
			><small
				>{series
					? `${month(series.forecastMonth)} · modeled estimate`
					: pending && requestedMonth
						? `${month(requestedMonth)} · selected month`
						: 'No verified source'}</small
			>{#if series}<small class="category">{series.name}</small>{/if}</summary
		>
		<div class="detail">
			{#if series}<p class="qualification">
					Monthly passenger movements for this published category. This does not measure congestion
					or loads on individual routes.
				</p>
				<p class="qualification">
					Last trusted month: {month(series.lastActualMonth)}. {series.horizonMonths} month gap.
				</p>{:else if pending}<p>
					Open Data and Forecasts to inspect the selected month and any loading or source checks.
				</p>{:else}<p>Passenger outlook is unavailable until the source can be checked.</p>{/if}
		</div>
	</details>
	{#if caution}<p class="warning">
			A simpler forecast was more accurate in testing. Review before acting.
		</p>{:else if series?.empiricalRange && series.empiricalRange.historicalCoverage < 0.8}<p
			class="warning"
		>
			Wide uncertainty. Review before acting.
		</p>{/if}
	<button class="review" onclick={onOpen}>Review forecast <ArrowUpRight size={15} /></button>
</aside>

<style>
	.warning {
		color: #805f37;
		padding: 0 16px 12px;
		margin: 0;
		font-size: 11px;
	}
	.review {
		border: none;
		border-top: 1px solid #e5e9e7;
		border-radius: 0;
		padding: 9px 16px;
		min-height: 44px;
		background: #fff;
		font-weight: 550;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.review:hover {
		background: #f6f8f7;
	}
	.category {
		color: #52636b;
		overflow-wrap: anywhere;
		max-width: 220px;
	}
	.outlook {
		width: 260px;
		max-width: calc(100vw - 24px);
		background: #fff;
		border: 1px solid #d9e1dd;
		border-radius: var(--surface-radius, 28px);
		box-shadow: var(--surface-shadow, 0 4px 16px #102e3412, 0 1px 3px #102e340a);
		overflow: hidden;
		color: #233d43;
	}
	summary {
		cursor: pointer;
		list-style: none;
		padding: 14px 16px;
		display: grid;
		gap: 4px;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	summary span {
		font-size: 12px;
		font-weight: 550;
		color: #52656a;
	}
	summary strong {
		font-size: 25px;
		font-weight: 600;
		letter-spacing: -0.6px;
		font-variant-numeric: tabular-nums;
	}
	summary small {
		font-size: 11px;
		color: #607078;
	}
	.outlook-heading {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 5px;
	}
	.outlook-heading :global(.disclosure-icon) {
		margin-left: auto;
	}
	details[open] .outlook-heading :global(.disclosure-icon) {
		transform: rotate(180deg);
	}
	.detail {
		padding: 0 16px 16px;
	}
	p {
		margin: 0 0 8px;
		font-size: 12px;
		line-height: 1.5;
	}
	.qualification {
		font-size: 11px;
		color: #506c75;
	}
	button {
		min-height: 44px;
		padding: 8px 10px;
		background: #eef7f4;
		border: 1px solid #c8dfd8;
		border-radius: var(--surface-radius-pill, 999px);
		font: inherit;
		font-size: 12px;
		color: #075c5c;
		cursor: pointer;
		width: 100%;
		text-align: left;
	}
	button:focus-visible,
	summary:focus-visible {
		outline: 3px solid #0c8580;
		outline-offset: -3px;
	}
	@media (max-width: 680px) {
		.outlook {
			width: 170px;
			border-radius: var(--surface-radius-mobile, 24px);
		}
		summary {
			padding: 10px 12px;
			gap: 2px;
		}
		summary strong {
			font-size: 19px;
		}
		summary span {
			font-size: 11px;
		}
		summary small {
			font-size: 10px;
		}
		details[open] {
			width: min(290px, calc(100vw - 24px));
			background: white;
		}
		.outlook:has(details[open]) {
			width: min(290px, calc(100vw - 24px));
		}
	}
</style>
