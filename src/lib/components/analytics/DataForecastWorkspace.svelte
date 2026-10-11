<script lang="ts">
	import DataExplorer from './DataExplorer.svelte';
	import DataOverview from './DataOverview.svelte';
	import VisualizationBuilder from './VisualizationBuilder.svelte';
	import PlanAheadPanel from '#lib/components/policy/PlanAheadPanel.svelte';
	import { createAnalyticalCatalog } from '#lib/analytics/catalog.ts';
	import type { LayoutData } from '../../../routes/$types';
	import type { MonthlyForecast } from '#lib/prediction/types.ts';
	let {
		data,
		section = 'overview',
		requestedDatasetId,
		targetMonth,
		selectedSeriesId,
		onSectionChange,
		onBuild,
		onExplore,
		onOpenForecast,
		onTargetMonthChange,
		onSeriesChange,
		onselectSeries,
		onShowOnMap,
		onShowEvidence,
		onShowMap
	}: {
		data: LayoutData;
		section?: string;
		requestedDatasetId?: string;
		targetMonth?: string;
		selectedSeriesId?: string;
		onSectionChange: (section: string) => void;
		onBuild: (datasetId: string) => void;
		onExplore: (datasetId: string) => void;
		onOpenForecast: (seriesId: string) => void;
		onTargetMonthChange?: (month: string) => void;
		onSeriesChange?: (series: string) => void;
		onselectSeries?: (series: MonthlyForecast | null) => void;
		onShowOnMap?: (series: MonthlyForecast) => void;
		onShowEvidence: (workflow: string) => void;
		onShowMap?: () => void;
	} = $props();
	const datasets = $derived(createAnalyticalCatalog(data));
	const active = $derived(
		['overview', 'explore', 'builder', 'forecasts'].includes(section) ? section : 'overview'
	);
	const sections = [
		{ id: 'overview', label: 'Overview' },
		{ id: 'explore', label: 'Explore data' },
		{ id: 'builder', label: 'Build a chart' },
		{ id: 'forecasts', label: 'Forecasts' }
	];
	const purpose = $derived(
		{
			overview: 'Understand the patterns, then follow your own question into the data.',
			explore: 'Filter the evidence, examine exact values, and see what each source covers.',
			builder: 'Compare compatible records and create a data story with your own observations.',
			forecasts:
				'Explore passenger outlooks, their uncertainty, and how well they predicted past months.'
		}[active]
	);
</script>

<section class="data-workspace">
	<header class="data-heading">
		<div>
			<span class="eyebrow">Maldives · Data workspace</span>
			<h1>Data and Forecasts</h1>
			<p>{purpose}</p>
		</div>
		<a
			class="evidence-link"
			href="/evidence"
			onclick={(event) => {
				event.preventDefault();
				onShowEvidence('');
			}}>Sources and coverage ↗</a
		>
	</header>
	<nav class="section-nav" aria-label="Data workspace views">
		{#each sections as item (item.id)}<button
				type="button"
				class:active={active === item.id}
				aria-current={active === item.id ? 'page' : undefined}
				onclick={() => onSectionChange(item.id)}>{item.label}</button
			>{/each}
	</nav>
	<div class="section-content">
		<div hidden={active !== 'overview'}>
			<DataOverview {datasets} {onExplore} {onBuild} {onShowMap} onForecast={onOpenForecast} />
		</div>
		<div hidden={active !== 'explore'}>
			<DataExplorer
				{datasets}
				{onBuild}
				{onShowEvidence}
				{onShowMap}
				requestedDatasetId={active === 'explore' ? requestedDatasetId : undefined}
			/>
		</div>
		<div hidden={active !== 'builder'}>
			<VisualizationBuilder
				{datasets}
				{requestedDatasetId}
				onShowEvidence={() => onShowEvidence('')}
			/>
		</div>
		<div hidden={active !== 'forecasts'}>
			<PlanAheadPanel
				prediction={data.prediction}
				embedded
				{targetMonth}
				{selectedSeriesId}
				{onTargetMonthChange}
				{onSeriesChange}
				{onselectSeries}
				{onShowOnMap}
				onShowEvidence={() => onShowEvidence('Passenger forecasts')}
			/>
		</div>
	</div>
</section>

<style>
	.data-workspace {
		color: var(--analytics-ink, #172b3a);
		min-width: 0;
	}
	.data-heading {
		display: flex;
		justify-content: space-between;
		gap: 24px;
		align-items: center;
		margin: 0 0 18px;
	}
	.eyebrow {
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.07em;
		text-transform: uppercase;
		color: #647381;
	}
	h1 {
		font-size: 30px;
		font-weight: 650;
		letter-spacing: -0.035em;
		line-height: 1.2;
		margin: 7px 0 8px;
	}
	p {
		font-size: 14px;
		color: #647381;
		margin: 0;
	}
	.evidence-link {
		font-size: 12px;
		font-weight: 600;
		color: #087f78;
		text-decoration: none;
		min-height: 44px;
		display: flex;
		align-items: center;
		white-space: nowrap;
	}
	.section-nav {
		display: flex;

		gap: 4px;
		overflow-x: auto;

		border-bottom: 0;
		margin-bottom: 20px;
		padding: 5px;
		width: max-content;
		max-width: 100%;
		border: 1px solid #dce3e8;
		border-radius: var(--surface-radius-pill, 999px);
		background: #fff;
		box-shadow: var(--surface-shadow);
	}
	.section-nav button {
		border: 0;

		border-bottom: 0;

		padding: 11px 16px;
		min-height: 44px;
		font: inherit;
		font-size: 13px;
		white-space: nowrap;
		flex-shrink: 0;
		font-weight: 600;
		color: #647381;
		background: transparent;
		cursor: pointer;
		border-radius: var(--surface-radius-pill, 999px);
	}
	.section-nav button.active {
		color: #087f78;

		border-bottom-color: transparent;
		background: #e9f3f1;
	}
	.section-nav button:hover {
		color: #172b3a;
	}
	.section-nav button:focus-visible,
	.evidence-link:focus-visible {
		outline: 3px solid #087f78;
		outline-offset: 3px;
	}
	.section-content {
		min-width: 0;
	}
	.section-content > div[hidden] {
		display: none;
	}
	@media (max-width: 600px) {
		.data-heading {
			display: block;
			margin-bottom: 14px;
		}
		h1 {
			font-size: 27px;
		}
		.evidence-link {
			margin-top: 4px;
		}
	}

	@media (max-width: 680px) {
		.section-nav {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			width: 100%;
			gap: 4px;
			margin-bottom: 22px;
			overflow: visible;
			border-radius: var(--surface-radius-mobile, 24px);
		}
		.section-nav button {
			min-width: 0;
			min-height: 44px;
			padding: 11px 12px;
			font-size: 12px;
			text-align: center;
		}
		.section-nav button.active {
			font-weight: 650;
		}
	}
</style>
