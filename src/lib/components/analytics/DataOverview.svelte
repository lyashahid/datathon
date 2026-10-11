<script lang="ts">
	import { ArrowUpRight, ArrowRight, TrendingUp } from '@lucide/svelte';
	import type { AnalyticalDataset } from '#lib/analytics/catalog.ts';
	import { analyticalDataGaps } from '#lib/analytics/catalog.ts';
	import {
		populationComparison,
		latestMonthlyComparison,
		referencePeriod,
		displayPeriod
	} from '#lib/analytics/overview.ts';
	import AnalyticalChart from './AnalyticalChart.svelte';
	let {
		datasets,
		onExplore,
		onBuild,
		onForecast,
		onShowMap
	}: {
		datasets: AnalyticalDataset[];
		onExplore: (dataset: string) => void;
		onBuild: (dataset: string) => void;
		onForecast: (seriesId: string) => void;
		onShowMap?: () => void;
	} = $props();
	let passengerId = $state('');
	const passengers = $derived(
		datasets.filter((item) => item.id.startsWith('passenger-') && item.join.grain === 'month')
	);
	const passenger = $derived(passengers.find((item) => item.id === passengerId) ?? passengers[0]);
	const passengerReadout = $derived(latestMonthlyComparison(passenger));
	const population = $derived(populationComparison(datasets));
	const schedules = $derived(datasets.find((item) => item.id === 'schedule-hourly-departures'));
	const spending = $derived(
		datasets.find((item) => item.id === 'policy-transport-share-of-expenditure')
	);
	const number = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
	const exact = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
	const change = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}%`;
</script>

<section class="data-overview" aria-label="Data overview">
	<div class="overview-intro">
		<div>
			<h2>Start with a question</h2>
			<p>Four ways into the evidence. Open any chart to explore its exact records.</p>
		</div>
		<span class="catalog-count"
			>{datasets.length} datasets · {new Set(datasets.map((item) => item.topic)).size} subjects</span
		>
	</div>
	<div class="overview-grid">
		{#if passenger}
			<article class="question-panel passenger-panel">
				<header>
					<span class="subject">Passenger activity</span>
					<h3>How is passenger activity changing?</h3>
					<p>Published monthly movements, shown separately for each transport category.</p>
				</header>
				<label class="series-picker"
					><span class="sr-only">Passenger category</span><select
						aria-label="Passenger category"
						value={passenger.id}
						onchange={(event) => (passengerId = event.currentTarget.value)}
						>{#each passengers as item (item.id)}<option value={item.id}>{item.title}</option
							>{/each}</select
					></label
				>
				{#if passengerReadout}<div class="series-readout">
						<div>
							<strong>{number.format(passengerReadout.latest.value!)}</strong><span
								>movements · {displayPeriod(passengerReadout.latest.key)}</span
							>
						</div>
						{#if passengerReadout.percentChange !== null}<div class="year-change">
								<strong>{change(passengerReadout.percentChange)}</strong><span
									>vs {displayPeriod(passengerReadout.previous!.key)}</span
								>
							</div>{/if}
					</div>{/if}
				<AnalyticalChart dataset={passenger} height={270} />
				<div class="reading-note">
					Published movements are not unique people or route loads. Keep ferry endpoint categories
					separate.
				</div>
				<footer>
					<button onclick={() => onExplore(passenger.id)}
						>Explore records <ArrowUpRight size={15} /></button
					><button onclick={() => onForecast(passenger.id.replace(/^passenger-/, ''))}
						><TrendingUp size={15} />View forecast</button
					>
				</footer>
			</article>
		{/if}
		{#if population}
			<article class="question-panel">
				<header>
					<span class="subject">Population · Greater Malé</span>
					<h3>Where might more people live?</h3>
					<p>The census and official projections for the same physical islands.</p>
				</header>
				<div class="reference">
					<span>Census + projections</span><span>2022 · 2026 · 2030</span>
				</div>
				<AnalyticalChart dataset={population} height={335} />
				<div class="reading-note">
					2026 and 2030 are projections. Missing Hulhulé projections remain blank.
				</div>
				<details class="population-values">
					<summary>Compare exact island values</summary>
					<div class="table-scroll">
						<table>
							<caption class="sr-only"
								>Population by physical island and reference year. Blank cells indicate no supplied
								projection.</caption
							><thead
								><tr
									><th scope="col">Island</th><th scope="col">2022 census</th><th scope="col"
										>2026 projection</th
									><th scope="col">2030 projection</th></tr
								></thead
							><tbody
								>{#each [...new Set(population.rows.map((row) => row.key))] as key (key)}<tr
										><th scope="row">{population.rows.find((row) => row.key === key)?.label}</th
										>{#each ['2022', '2026', '2030'] as year (year)}{@const row =
												population.rows.find((row) => row.key === key && row.period === year)}<td
												>{row?.value == null ? 'Not supplied' : exact.format(row.value)}</td
											>{/each}</tr
									>{/each}</tbody
							>
						</table>
					</div>
				</details>
				<footer>
					<button onclick={() => onExplore('population-greater-male-2026')}
						>Explore population <ArrowUpRight size={15} /></button
					>{#if onShowMap}<button onclick={onShowMap}
							>View geography <ArrowUpRight size={15} /></button
						>{/if}
				</footer>
			</article>
		{/if}
		{#if schedules}
			<article class="question-panel">
				<header>
					<span class="subject">Service schedules · Greater Malé</span>
					<h3>What departures were captured?</h3>
					<p>An afternoon and evening timetable snapshot, by hour and route direction.</p>
				</header>
				<div class="reference">
					<span>Dated timetable snapshot</span><span>{referencePeriod(schedules)}</span>
				</div>
				<AnalyticalChart dataset={schedules} type="heatmap" height={335} />
				<div class="reading-note">
					Blank hours were not captured; the first captured hour is partial. Schedules do not
					measure traffic, delays or passenger loads.
				</div>
				<footer>
					<button onclick={() => onExplore(schedules.id)}
						>Explore schedules <ArrowUpRight size={15} /></button
					><button onclick={() => onBuild(schedules.id)}
						>Build a chart <ArrowUpRight size={15} /></button
					>
				</footer>
			</article>
		{/if}
		{#if spending}
			<article class="question-panel">
				<header>
					<span class="subject">Household transport spending</span>
					<h3>What share went to transport?</h3>
					<p>
						Transport expenditure as a share of reported household consumption in the 2019 survey.
					</p>
				</header>
				<div class="reference">
					<span>Published survey observations</span><span>{referencePeriod(spending)}</span>
				</div>
				<AnalyticalChart dataset={spending} height={335} />
				<div class="reading-note">
					Historical survey context, not current fares. National and regional aggregates overlap and
					must not be summed.
				</div>
				<footer>
					<button onclick={() => onExplore(spending.id)}
						>Explore spending <ArrowUpRight size={15} /></button
					><button onclick={() => onBuild(spending.id)}
						>Build a chart <ArrowUpRight size={15} /></button
					>
				</footer>
			</article>
		{/if}
	</div>
	{#if !datasets.length}<div class="empty">
			<h3>No verified datasets are available</h3>
			<p>Charts will appear when source records are available. Review Evidence for coverage.</p>
		</div>{/if}
	<div class="overview-next">
		<div>
			<h3>Follow your own question</h3>
			<p>
				Explore every dataset, combine compatible records, or examine a forecast and its accuracy.
			</p>
		</div>
		<button onclick={() => onBuild(passenger?.id ?? datasets[0]?.id ?? '')}
			>Build a visualization <ArrowRight size={16} /></button
		>
	</div>
	<details class="data-boundaries">
		<summary>What this evidence can and cannot show</summary>
		<p>
			Each chart keeps its own geography, reference period and evidence type. The charts above are
			separate views; matching shapes do not establish a relationship.
		</p>
		<ul>
			{#each analyticalDataGaps as gap (gap)}<li>{gap}</li>{/each}
		</ul>
	</details>
</section>

<style>
	.data-overview {
		min-width: 0;
	}
	.overview-intro {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		gap: 20px;
		margin-bottom: 22px;
	}
	h2 {
		font-size: 21px;
		letter-spacing: -0.025em;
		font-weight: 650;
		margin: 0 0 6px;
	}
	p {
		margin: 0;
		color: #647381;
		font-size: 13px;
		line-height: 1.6;
	}
	.catalog-count {
		color: #647381;
		font-size: 12px;
		white-space: nowrap;
	}
	.overview-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 20px;
	}
	.question-panel {
		background: #fff;
		border: 1px solid #dce3e8;

		border-radius: var(--surface-radius, 28px);
		min-width: 0;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		box-shadow: var(--surface-shadow);
	}
	.question-panel header {
		padding: 24px 24px 0;
	}
	.subject {
		color: #647381;
		font-size: 10px;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		font-weight: 650;
	}
	h3 {
		font-size: 19px;
		letter-spacing: -0.025em;
		line-height: 1.35;
		font-weight: 650;
		margin: 8px 0;
		color: #223740;
	}
	.series-picker {
		display: block;
		margin: 16px 24px 0;
	}
	select {
		width: 100%;
		height: 44px;
		border: 1px solid #d6dfe5;

		border-radius: var(--surface-radius-field, 14px);
		color: #223740;
		background: #fff;
		padding: 0 30px 0 12px;
		font: inherit;
		font-size: 13px;
		cursor: pointer;
	}
	.series-readout {
		margin: 18px 24px 0;
		display: flex;
		justify-content: space-between;
		gap: 18px;
	}
	.series-readout strong {
		font-size: 26px;
		letter-spacing: -0.04em;
		font-weight: 650;
		color: #223740;
		display: block;
		font-variant-numeric: tabular-nums;
	}
	.series-readout span {
		display: block;
		color: #647381;
		font-size: 11px;
		margin-top: 3px;
	}
	.year-change {
		text-align: right;
	}
	.year-change strong {
		font-size: 19px;
		line-height: 31px;
	}
	.reference {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		font-size: 11px;
		color: #647381;
		padding: 20px 24px 10px;
	}
	.question-panel :global(.chart-wrap) {
		width: calc(100% - 32px);
		margin: 10px 16px 0;
	}
	.reading-note {
		font-size: 12px;
		line-height: 1.6;
		color: #647381;
		padding: 0 24px 18px;
		margin-top: auto;
	}
	footer {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 5px 16px;
		border-top: 1px solid #e5eaee;
		flex-wrap: wrap;
	}
	button {
		border: 0;
		background: transparent;
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font: inherit;
		font-size: 12px;
		font-weight: 600;
		color: #087f78;
		cursor: pointer;
		min-height: 44px;
		padding: 8px;
		transition: transform 160ms ease-out;
		border-radius: var(--surface-radius-pill, 999px);
	}
	button:active {
		transform: scale(0.98);
	}
	button:focus-visible,
	select:focus-visible,
	summary:focus-visible {
		outline: 3px solid #087f78;
		outline-offset: 2px;
	}
	.population-values {
		border-top: 1px solid #e5eaee;
		padding: 0 24px;
	}
	.population-values summary {
		font-size: 12px;
		font-weight: 600;
		color: #52616f;
		min-height: 44px;
		padding: 12px 0;
		cursor: pointer;
	}
	.table-scroll {
		overflow-x: auto;
		padding-bottom: 16px;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 11px;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	th,
	td {
		padding: 10px 8px;
		text-align: right;
		border-bottom: 1px solid #e5eaee;
	}
	th {
		color: #52616f;
		font-weight: 600;
	}
	th:first-child {
		text-align: left;
	}
	.overview-next {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 24px;
		border-top: 1px solid #dce3e8;
		margin-top: 28px;
		padding: 24px 0;
	}
	.overview-next h3 {
		margin: 0 0 5px;
		font-size: 17px;
	}
	.overview-next button {
		background: #223740;
		color: #fff;

		border-radius: var(--surface-radius-pill, 999px);
		padding: 8px 16px;
		white-space: nowrap;
	}
	.data-boundaries {
		color: #647381;
		border-top: 1px solid #dce3e8;
		padding: 8px 0;
		font-size: 12px;
		line-height: 1.7;
	}
	.data-boundaries summary {
		min-height: 44px;
		padding: 12px 0;
		color: #52616f;
		font-weight: 600;
		cursor: pointer;
	}
	.data-boundaries ul {
		padding-left: 18px;
	}
	.data-boundaries li {
		margin: 5px 0;
	}
	.empty {
		padding: 32px;
		border: 1px solid #dce3e8;
		background: #fff;

		border-radius: var(--surface-radius, 28px);
		box-shadow: var(--surface-shadow);
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
	@media (max-width: 850px) {
		.overview-grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}
	@media (max-width: 600px) {
		.overview-intro {
			display: block;
		}
		.catalog-count {
			display: block;
			margin-top: 12px;
		}
		.question-panel header {
			padding: 20px 18px 0;
		}
		h3 {
			font-size: 18px;
		}
		.series-picker {
			margin: 16px 18px 0;
		}
		.series-readout {
			margin: 16px 18px 0;
		}
		.reference {
			padding: 18px 18px 8px;
			flex-wrap: wrap;
			gap: 5px 12px;
		}
		.reading-note {
			padding: 0 18px 16px;
		}
		.question-panel :global(.chart-wrap) {
			width: calc(100% - 16px);
			margin: 8px 8px 0;
		}
		.overview-next {
			display: block;
		}
		.overview-next button {
			margin-top: 14px;
		}
		.population-values {
			padding: 0 18px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		button {
			transition: none;
		}
		button:active {
			transform: none;
		}
	}

	@media (max-width: 600px) {
		.question-panel,
		.empty {
			border-radius: var(--surface-radius-mobile, 24px);
		}
	}
</style>
