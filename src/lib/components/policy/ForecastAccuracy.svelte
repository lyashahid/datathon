<script lang="ts">
	import { ArrowLeft, ArrowRight } from '@lucide/svelte';
	import type { MonthlyForecast } from '#lib/prediction/types.ts';
	import { buildForecastAccuracyChart } from './forecastChart.ts';
	let { series }: { series: MonthlyForecast } = $props();
	let chartWidth = $state(740);
	let inspectedMonth = $state('');
	const figure = $derived(buildForecastAccuracyChart(series.backtest, chartWidth));
	const inspected = $derived(
		figure?.points.find((row) => row.targetMonth === inspectedMonth) ??
			figure?.points.at(-1) ??
			null
	);
	const checkedMethods = $derived(
		[...series.benchmarks].sort((a, b) => a.metrics.mae - b.metrics.mae)
	);
	const maximumError = $derived(Math.max(...checkedMethods.map((row) => row.metrics.mae), 1));
	const lowestError = $derived(checkedMethods[0]?.metrics.mae ?? null);
	const meanSignedError = $derived(
		series.backtest.length
			? series.backtest.reduce((sum, row) => sum + row.actual - row.estimate, 0) /
					series.backtest.length
			: null
	);
	$effect(() => {
		void series.seriesId;
		void series.forecastMonth;
		inspectedMonth = '';
	});
	const count = (value: number | null | undefined) =>
		value == null ? 'Unavailable' : Math.round(value).toLocaleString('en-GB');
	const month = (value: string) =>
		new Date(`${value}-01T00:00:00Z`).toLocaleDateString('en-GB', {
			month: 'short',
			year: 'numeric',
			timeZone: 'UTC'
		});
	const method = (value: string) =>
		({
			'last-month': 'Latest recorded month',
			'seasonal-naive': 'Same month a year earlier',
			'mean-3-months': 'Average of three recent months',
			'mean-6-months': 'Average of six recent months'
		})[value] ?? value;
	function adjacent(offset: number) {
		if (!figure || !inspected) return;
		const index = figure.points.findIndex((row) => row.targetMonth === inspected.targetMonth);
		inspectedMonth =
			figure.points[Math.max(0, Math.min(figure.points.length - 1, index + offset))].targetMonth;
	}
</script>

<section
	class="accuracy-surface"
	aria-label="Historical forecast accuracy"
	data-testid="forecast-accuracy-view"
>
	<header class="accuracy-heading">
		<span class="section-label">Check the estimate against evidence</span>
		<h2>How did earlier forecasts perform?</h2>
		<p>
			Compare predictions with the totals later recorded, using the same {series.horizonMonths}-month
			gap as this outlook.
		</p>
	</header>
	{#if figure}
		<div class="chart-region" bind:clientWidth={chartWidth}>
			<svg
				viewBox={'0 0 ' + figure.width + ' ' + figure.height}
				role="img"
				aria-label={'Earlier forecasts and recorded passenger totals for ' + series.name}
			>
				<title>Historical forecast checks for {series.name}</title>
				<desc
					>Solid values are later recorded totals. Dashed values are earlier predictions. The
					connectors show the difference for each month. These checks use revised historical data.</desc
				>
				{#each [0, 0.5, 1] as fraction (fraction)}
					<line
						x1={figure.bounds.left}
						x2={figure.bounds.right}
						y1={figure.y(figure.ymax * fraction)}
						y2={figure.y(figure.ymax * fraction)}
						stroke="#e2e7ed"
					/>
					<text
						x={figure.bounds.left - 12}
						y={figure.y(figure.ymax * fraction) + 4}
						text-anchor="end">{count(figure.ymax * fraction)}</text
					>
				{/each}
				<path
					d={figure.actual}
					fill="none"
					stroke="#536a78"
					stroke-width="2.4"
					stroke-linejoin="round"
				/>
				<path
					d={figure.estimate}
					fill="none"
					stroke="#087f78"
					stroke-width="2.4"
					stroke-dasharray="6 5"
					stroke-linejoin="round"
				/>
				{#each figure.points as row (row.targetMonth)}
					<line
						x1={figure.x(row.targetMonth)}
						x2={figure.x(row.targetMonth)}
						y1={figure.y(row.actual)}
						y2={figure.y(row.estimate)}
						stroke="#aebcc3"
						stroke-width="1.5"
					/>
					<circle
						cx={figure.x(row.targetMonth)}
						cy={figure.y(row.actual)}
						r="3.5"
						fill="#536a78"
						stroke="white"
						stroke-width="1.5"
					/>
					<circle
						cx={figure.x(row.targetMonth)}
						cy={figure.y(row.estimate)}
						r="3.5"
						fill="#087f78"
						stroke="white"
						stroke-width="1.5"
					/>
					<circle
						cx={figure.x(row.targetMonth)}
						cy={figure.y(row.actual)}
						r="12"
						fill="transparent"
						role="img"
						aria-label={month(row.targetMonth) +
							', recorded ' +
							count(row.actual) +
							', predicted ' +
							count(row.estimate)}
						onpointerenter={() => (inspectedMonth = row.targetMonth)}
					>
						<title
							>{month(row.targetMonth)}: recorded {count(row.actual)}, predicted {count(
								row.estimate
							)}</title
						>
					</circle>
				{/each}
				{#if inspected}
					<line
						x1={figure.x(inspected.targetMonth)}
						x2={figure.x(inspected.targetMonth)}
						y1={figure.bounds.top}
						y2={figure.bounds.bottom}
						stroke="#bbc8cc"
						stroke-dasharray="2 4"
					/>
				{/if}
				{#each figure.ticks as tick, index (tick.month)}
					<text
						x={tick.x}
						y="219"
						text-anchor={index === 0
							? 'start'
							: index === figure.ticks.length - 1
								? 'end'
								: 'middle'}>{month(tick.month)}</text
					>
				{/each}
			</svg>
		</div>
		<div class="legend">
			<span><i></i>Later recorded total</span><span><i class="dashed"></i>Earlier prediction</span>
		</div>
		{#if inspected}
			<div class="check-inspector">
				<div class="month-picker">
					<select
						aria-label="Inspect a historical forecast check"
						value={inspected.targetMonth}
						onchange={(event) => (inspectedMonth = event.currentTarget.value)}
					>
						{#each figure.points as row (row.targetMonth)}<option value={row.targetMonth}
								>{month(row.targetMonth)}</option
							>{/each}
					</select>
					<div class="point-navigation">
						<button
							type="button"
							aria-label="Previous forecast check"
							disabled={inspected.targetMonth === figure.points[0].targetMonth}
							onclick={() => adjacent(-1)}><ArrowLeft size={14} aria-hidden="true" /></button
						>
						<button
							type="button"
							aria-label="Next forecast check"
							disabled={inspected.targetMonth === figure.points.at(-1)?.targetMonth}
							onclick={() => adjacent(1)}><ArrowRight size={14} aria-hidden="true" /></button
						>
					</div>
				</div>
				<dl>
					<div>
						<dt>Predicted</dt>
						<dd>{count(inspected.estimate)}</dd>
					</div>
					<div>
						<dt>Recorded</dt>
						<dd>{count(inspected.actual)}</dd>
					</div>
					<div>
						<dt>
							{inspected.actual >= inspected.estimate ? 'Underestimated by' : 'Overestimated by'}
						</dt>
						<dd>{count(Math.abs(inspected.actual - inspected.estimate))}</dd>
					</div>
				</dl>
				<p>
					History available through {month(inspected.trainingCutoff)}. Values are passenger
					movements.
				</p>
			</div>
		{/if}
		{#if meanSignedError != null}<p class="bias-note">
				Across these {series.backtest.length} checks, predictions {meanSignedError >= 0
					? 'underestimated'
					: 'overestimated'} the recorded total by {count(Math.abs(meanSignedError))} movements on average.
				Opposing errors cancel in this measure.
			</p>{/if}
	{:else}
		<p class="empty-state">
			There are no eligible historical checks for this planning month. An accuracy chart will appear
			when enough matching evidence is available.
		</p>
	{/if}
	{#if checkedMethods.length}
		<section class="method-comparison" aria-labelledby="method-comparison-heading">
			<div class="method-heading">
				<h3 id="method-comparison-heading">Compare simple forecasting methods</h3>
				<span>Lower average error is better</span>
			</div>
			<p>
				The method was selected using earlier months. These later checks help judge it; they do not
				change that selection.
			</p>
			<div class="comparison-table-wrap">
				<table>
					<caption
						>Same-horizon historical errors and the alternative estimates for {month(
							series.forecastMonth
						)}.</caption
					>
					<thead
						><tr
							><th scope="col">Method</th><th scope="col">Average error</th><th
								scope="col"
								class="numeric">Target estimate</th
							></tr
						></thead
					>
					<tbody>
						{#each checkedMethods as benchmark (benchmark.model)}
							<tr>
								<th scope="row"
									><span>{method(benchmark.model)}</span><span class="method-status"
										>{benchmark.model === series.model
											? 'Selected earlier'
											: ''}{benchmark.model === series.model &&
										benchmark.metrics.mae === lowestError
											? ' · '
											: ''}{benchmark.metrics.mae === lowestError
											? 'Lowest checked error'
											: ''}</span
									></th
								>
								<td
									><span class="error-value">{count(benchmark.metrics.mae)}</span><span
										class="error-track"
										aria-hidden="true"
										><span
											class:selected={benchmark.model === series.model}
											style:width={(benchmark.metrics.mae / maximumError) * 100 + '%'}
										></span></span
									></td
								>
								<td class="numeric">{count(benchmark.estimate)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
	<p class="accuracy-qualification">
		These are retrospective checks on revised source totals, not independent tests made before
		publication. Future accuracy is unproven.
	</p>
</section>

<style>
	.accuracy-surface {
		min-width: 0;
		padding: 22px 24px 18px;
		background: #fff;
		border: 1px solid var(--analytics-border, #dde3e9);

		border-radius: var(--surface-radius, 28px);
		color: var(--analytics-ink, #172b3a);
		box-shadow: var(--surface-shadow);
	}
	.section-label {
		display: block;
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.05em;
		line-height: 1.5;
		text-transform: uppercase;
		color: #647381;
	}
	h2 {
		margin: 5px 0 7px;
		font-size: 21px;
		font-weight: 620;
		letter-spacing: -0.02em;
		line-height: 1.3;
	}
	h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 620;
	}
	p {
		margin: 8px 0;
		font-size: 12px;
		line-height: 1.6;
		color: #647381;
	}
	.chart-region {
		min-width: 0;
		width: 100%;
		margin-top: 10px;
	}
	svg {
		display: block;
		width: 100%;
		height: 238px;
	}
	svg text {
		fill: #647381;
		font:
			11px Inter,
			system-ui,
			sans-serif;
		font-variant-numeric: tabular-nums;
	}
	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		font-size: 11px;
		color: #647381;
	}
	.legend > span {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.legend i {
		display: inline-block;
		width: 16px;
		border-top: 2px solid #536a78;
	}
	.legend .dashed {
		border-color: #087f78;
		border-top-style: dashed;
	}
	.check-inspector {
		margin-top: 18px;
		border-top: 1px solid #e3e8ec;
		border-bottom: 1px solid #e3e8ec;
		padding: 12px 0;
	}
	.month-picker {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	select {
		min-height: 44px;
		max-width: 100%;
		padding: 8px 10px;
		border: 1px solid #d5dee4;

		border-radius: var(--surface-radius-field, 14px);
		font: inherit;
		font-size: 12px;
		color: #243947;
		background: #fff;
	}
	.point-navigation {
		display: flex;
		gap: 4px;
	}
	button {
		width: 44px;
		min-height: 44px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid #d5dee4;

		border-radius: var(--surface-radius-pill, 999px);
		background: #fff;
		color: #243947;
		cursor: pointer;
	}
	button:hover {
		background: #f4f7f8;
	}
	button:active {
		background: #eaf0f2;
	}
	button:disabled {
		opacity: 0.45;
		cursor: default;
	}
	select:focus-visible,
	button:focus-visible {
		outline: 3px solid #087f78;
		outline-offset: 3px;
	}
	dl {
		margin: 12px 0 0;
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 14px;
	}
	dt {
		color: #647381;
		font-size: 11px;
	}
	dd {
		margin: 5px 0 0;
		color: #243947;
		font-size: 16px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.check-inspector p {
		margin: 10px 0 0;
		font-size: 11px;
	}
	.bias-note {
		margin: 12px 0 0;
		font-size: 11px;
	}
	.method-comparison {
		border-top: 1px solid #dde3e9;
		padding-top: 19px;
		margin-top: 22px;
	}
	.method-heading {
		display: flex;
		justify-content: space-between;
		gap: 14px;
		align-items: baseline;
	}
	.method-heading > span {
		color: #647381;
		font-size: 11px;
		white-space: nowrap;
	}
	.method-comparison > p {
		font-size: 11px;
	}
	.comparison-table-wrap {
		overflow-x: auto;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	caption {
		padding: 0;
		width: 1px;
		height: 1px;
		overflow: hidden;
		position: absolute;
		clip-path: inset(50%);
	}
	thead th {
		text-align: left;
		color: #647381;
		font-weight: 500;
		font-size: 10px;
		padding: 10px 8px;
		border-bottom: 1px solid #dde3e9;
	}
	tbody th {
		text-align: left;
		font-weight: 500;
		width: 44%;
	}
	tbody th,
	td {
		padding: 12px 8px;
		border-bottom: 1px solid #e7ebee;
		vertical-align: middle;
	}
	th:first-child {
		padding-left: 0;
	}
	.numeric {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		padding-right: 0;
	}
	.method-status {
		display: block;
		margin-top: 4px;
		color: #647381;
		font-size: 10px;
		font-weight: 400;
		line-height: 1.4;
	}
	.method-status:empty {
		display: none;
	}
	.error-value {
		display: block;
		font-variant-numeric: tabular-nums;
	}
	.error-track {
		height: 5px;
		display: block;
		width: 100%;
		background: #edf1f3;
		border-radius: 2px;
		margin-top: 5px;
	}
	.error-track > span {
		height: 5px;
		display: block;
		background: #8da0ac;
		border-radius: 2px;
	}
	.error-track > span.selected {
		background: #087f78;
	}
	.accuracy-qualification {
		font-size: 11px;
		margin: 16px 0 0;
	}
	.empty-state {
		padding: 20px 0;
	}
	@media (max-width: 1040px) {
		.accuracy-surface {
			padding: 20px 18px 18px;
		}
		.method-heading {
			display: block;
		}
		.method-heading > span {
			display: block;
			margin-top: 5px;
		}
	}
	@media (max-width: 560px) {
		.accuracy-surface {
			padding: 18px 16px;
		}
		h2 {
			font-size: 20px;
		}
		dl {
			gap: 10px;
		}
		dd {
			font-size: 14px;
		}
		dt {
			font-size: 10px;
		}
		table {
			min-width: 290px;
		}
		tbody th,
		td {
			padding: 12px 5px;
		}
		thead th {
			padding: 10px 5px;
		}
	}

	@media (max-width: 600px) {
		.accuracy-surface {
			border-radius: var(--surface-radius-mobile, 24px);
		}
	}
</style>
