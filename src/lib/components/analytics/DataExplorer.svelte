<script lang="ts">
	import { tick } from 'svelte';
	import {
		ArrowDown,
		ArrowUpRight,
		Check,
		Download,
		ExternalLink,
		Search,
		SlidersHorizontal,
		X
	} from '@lucide/svelte';
	import type { AnalyticalDataset } from '#lib/analytics/catalog.ts';
	import {
		datasetCompleteness,
		datasetDimensions,
		emptyDatasetLens,
		focusDataset,
		inspectRows,
		normalizeSearch,
		type DatasetLens
	} from '#lib/analytics/explorer.ts';
	import { supportedChartTypes, type AnalyticalChartType } from './chartOptions.ts';
	import AnalyticalChart from './AnalyticalChart.svelte';

	let {
		datasets,
		onBuild,
		onShowEvidence,
		onShowMap,
		requestedDatasetId
	}: {
		datasets: AnalyticalDataset[];
		onBuild?: (datasetId: string) => void;
		onShowEvidence?: (workflow: string) => void;
		onShowMap?: () => void;
		requestedDatasetId?: string;
	} = $props();

	const topics = [
		{ id: 'all', label: 'All data' },
		{ id: 'passengers', label: 'Passengers' },
		{ id: 'population', label: 'Population' },
		{ id: 'services', label: 'Services' },
		{ id: 'transport', label: 'Transport' },
		{ id: 'economy', label: 'Economy' },
		{ id: 'operations', label: 'Public updates' }
	];
	const evidenceLabels: Record<string, string> = {
		observed: 'Published observations',
		projected: 'Published projections',
		modelled: 'Modelled estimates',
		schedule: 'Dated schedules',
		inventory: 'Dated inventory',
		mixed: 'Different evidence types'
	};
	let topic = $state('all');
	let evidence = $state('all');
	let query = $state('');
	let view = $state<'charts' | 'dataset'>('charts');
	let selectedId = $state<string | null>(null);
	let lens = $state<DatasetLens>(emptyDatasetLens());
	let chartType = $state<AnalyticalChartType | 'auto'>('auto');
	let rowOrder = $state<'source' | 'highest' | 'lowest'>('source');
	let expandedCharts = $state(false);
	let rowPage = $state(0);
	let rowQuery = $state('');
	let downloaded = $state(false);
	let libraryElement: HTMLElement | undefined = $state();
	let detailElement: HTMLElement | undefined = $state();
	const rowPageSize = 20;
	const formatValue = (value: number | null) =>
		value == null
			? 'Not available'
			: new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(value);
	const searchableDatasets = $derived(
		datasets.map((dataset) => ({
			dataset,
			text: normalizeSearch(
				[
					dataset.title,
					dataset.description,
					dataset.sourceTitle,
					dataset.unit,
					...dataset.sources.flatMap((source) => [source.publisher ?? '', source.coverage ?? '']),
					...dataset.rows.flatMap((row) => [row.label, row.geography ?? '', row.series ?? ''])
				].join(' ')
			)
		}))
	);
	const matches = $derived(
		searchableDatasets
			.filter(
				({ dataset, text }) =>
					(topic === 'all' || dataset.topic === topic) &&
					(evidence === 'all' || dataset.evidence === evidence) &&
					text.includes(normalizeSearch(query.trim()))
			)
			.map(({ dataset }) => dataset)
	);
	const selected = $derived(
		matches.find((dataset) => dataset.id === selectedId) ?? matches[0] ?? null
	);
	const dimensions = $derived(selected ? datasetDimensions(selected) : null);
	const focused = $derived(selected ? focusDataset(selected, lens) : null);
	const completeness = $derived(focused ? datasetCompleteness(focused) : null);
	const availableCharts = $derived(focused ? supportedChartTypes(focused) : []);
	const effectiveChartType = $derived(
		chartType !== 'auto' && availableCharts.includes(chartType)
			? chartType
			: focused && availableCharts.includes(focused.defaultChart)
				? focused.defaultChart
				: availableCharts[0]
	);
	const hasLens = $derived(Object.values(lens).some(Boolean));
	const chartLabels: Record<AnalyticalChartType, string> = {
		line: 'Trend line',
		bar: 'Bar comparison',
		heatmap: 'Pattern heatmap',
		scatter: 'Relationship plot'
	};
	// The overview puts one useful chart from each subject beside one another. Every
	// remaining series is reachable through its topic and the complete dataset library.
	const overview = $derived.by(() => {
		if (topic !== 'all' || query.trim()) return matches;
		const lead = topics.slice(1).flatMap((item) => {
			const dataset = matches.find((candidate) => candidate.topic === item.id);
			return dataset ? [dataset] : [];
		});
		return [...lead, ...matches.filter((dataset) => !lead.some((item) => item.id === dataset.id))];
	});
	const visibleCharts = $derived(expandedCharts ? overview : overview.slice(0, 6));
	const rows = $derived(inspectRows(focused?.rows ?? [], rowQuery, rowOrder));
	const rowPages = $derived(Math.max(1, Math.ceil(rows.length / rowPageSize)));
	const currentRowPage = $derived(Math.min(rowPage, rowPages - 1));
	const visibleRows = $derived(
		rows.slice(currentRowPage * rowPageSize, (currentRowPage + 1) * rowPageSize)
	);
	const evidenceWorkflow = (dataset: AnalyticalDataset) =>
		dataset.topic === 'passengers'
			? 'Passenger forecasts'
			: dataset.topic === 'operations'
				? 'Public updates'
				: dataset.topic === 'economy'
					? 'Policy context'
					: 'Planning map';
	const topicLabel = (id: string) => topics.find((item) => item.id === id)?.label ?? id;
	const additionalLimitations = (dataset: AnalyticalDataset) =>
		dataset.limitations.filter((limitation) => !dataset.sourceNote.includes(limitation));
	function chartQualification(dataset: AnalyticalDataset) {
		if (dataset.id === 'schedule-hourly-departures') {
			const windows = [
				...new Set(
					dataset.rows.flatMap((row) =>
						row.detail?.startsWith('Remaining-departure capture covers') ? [row.detail] : []
					)
				)
			];
			return windows.length === 1
				? `Dated snapshot, not a full service day. ${windows[0]}`
				: 'Remaining departures in a dated snapshot, not a full service day. Blank hours were not captured; boundary hours may be partial. Review the source notes before comparing hours.';
		}
		return dataset.id.startsWith('schedule-')
			? 'Dated timetable snapshot. Scheduled trips are not observed ridership or unique vehicles.'
			: null;
	}
	function periodLabel(value: string) {
		if (/^\d{4}-\d{2}$/.test(value))
			return new Date(`${value}-01T00:00:00Z`).toLocaleDateString('en-GB', {
				month: 'short',
				year: 'numeric',
				timeZone: 'UTC'
			});
		if (/^\d{4}-\d{2}-\d{2}$/.test(value))
			return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', {
				dateStyle: 'medium',
				timeZone: 'UTC'
			});
		if (/^\d{4}-\d{2}-\d{2}T.*$/.test(value)) return sourceDate(value);
		return value;
	}
	const sharedRowDetail = (dataset: AnalyticalDataset) => {
		const detail = dataset.rows[0]?.detail;
		return detail && dataset.rows.every((row) => row.detail === detail) ? detail : undefined;
	};
	function datasetPeriod(dataset: AnalyticalDataset) {
		if (dataset.join.period) return periodLabel(dataset.join.period);
		const periods = [
			...new Set(dataset.rows.flatMap((row) => (row.period ? [row.period] : [])))
		].sort();
		return periods.length
			? periods.length === 1
				? periodLabel(periods[0])
				: `${periodLabel(periods[0])} – ${periodLabel(periods.at(-1)!)}`
			: 'See record dates';
	}
	function sourceDate(value: string) {
		const date = new Date(value);
		return Number.isNaN(date.getTime())
			? value
			: `${date.toLocaleDateString('en-GB', { dateStyle: 'medium', timeZone: 'UTC' })} UTC`;
	}
	function publicLink(value: string | undefined) {
		if (!value) return null;
		try {
			const url = new URL(value);
			return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
		} catch {
			return null;
		}
	}
	function changeTopic(id: string) {
		topic = id;
		selectedId = null;
		rowPage = 0;
		rowQuery = '';
		expandedCharts = false;
		downloaded = false;
	}
	async function inspect(dataset: AnalyticalDataset) {
		view = 'dataset';
		selectedId = dataset.id;
		rowPage = 0;
		rowQuery = '';
		downloaded = false;
		await tick();
		detailElement?.scrollIntoView({ block: 'start', behavior: 'instant' });
		detailElement?.focus({ preventScroll: true });
	}
	async function browse() {
		view = 'dataset';
		await tick();
		libraryElement?.scrollIntoView({ block: 'start', behavior: 'instant' });
		libraryElement?.focus({ preventScroll: true });
	}
	function updateLens(field: keyof DatasetLens, value: string) {
		lens = { ...lens, [field]: value };
		if (field === 'periodStart' && lens.periodEnd && value > lens.periodEnd)
			lens = { ...lens, periodEnd: value };
		if (field === 'periodEnd' && lens.periodStart && value && value < lens.periodStart)
			lens = { ...lens, periodStart: value };
		rowPage = 0;
		rowQuery = '';
		downloaded = false;
	}
	function csvCell(value: string | number | null | undefined) {
		if (typeof value === 'number') return String(value);
		const raw = value ?? '';
		const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
		return `"${text.replaceAll('"', '""')}"`;
	}
	function downloadRows(dataset: AnalyticalDataset) {
		const headings = [
			'dataset',
			'evidence',
			'unit',
			'key',
			'label',
			'series',
			'period',
			'geography',
			'value',
			'source_ids',
			'detail'
		];
		const lines = dataset.rows.map((row) =>
			[
				dataset.title,
				evidenceLabels[row.evidence ?? dataset.evidence],
				dataset.unit,
				row.key,
				row.label,
				row.series,
				row.period,
				row.geography,
				row.value,
				row.sourceIds.join('; '),
				row.detail
			]
				.map(csvCell)
				.join(',')
		);
		const blob = new Blob(['\uFEFF' + [headings.join(','), ...lines].join('\r\n')], {
			type: 'text/csv;charset=utf-8'
		});
		const url = URL.createObjectURL(blob);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `${dataset.id}${hasLens ? '-filtered' : ''}.csv`;
		anchor.click();
		URL.revokeObjectURL(url);
		downloaded = true;
	}
	$effect(() => {
		const requested = requestedDatasetId;
		if (!requested) return;
		selectedId = requested;
		view = 'dataset';
		topic = 'all';
		evidence = 'all';
		query = '';
		rowPage = 0;
		rowQuery = '';
		downloaded = false;
	});
	$effect(() => {
		// A new dataset starts with its entire retained population, never a previous dataset's filters.
		const dataset = selected;
		if (!dataset) return;
		lens = emptyDatasetLens();
		chartType = 'auto';
		rowOrder = 'source';
		rowPage = 0;
		rowQuery = '';
		downloaded = false;
	});
</script>

<section class="data-explorer" aria-label="Explore analytical data">
	<h2 class="sr-only">Explore the data</h2>
	<div class="explorer-controls">
		<nav class="topic-nav" aria-label="Data subjects">
			{#each topics.filter((item) => item.id === 'all' || datasets.some((dataset) => dataset.topic === item.id)) as item (item.id)}
				<button
					class:chosen={topic === item.id}
					aria-pressed={topic === item.id}
					onclick={() => changeTopic(item.id)}>{item.label}</button
				>
			{/each}
		</nav>
		<div class="catalog-filters">
			<label class="evidence-filter"
				><span>Evidence</span><select
					aria-label="Filter datasets by evidence type"
					bind:value={evidence}
					onchange={() => {
						selectedId = null;
						expandedCharts = false;
					}}
					><option value="all">All evidence types</option
					>{#each Object.entries(evidenceLabels) as [id, label] (id)}{#if datasets.some((dataset) => dataset.evidence === id)}<option
								value={id}>{label}</option
							>{/if}{/each}</select
				></label
			>
			<label class="search-field"
				><Search size={16} aria-hidden="true" /><span class="sr-only">Search datasets</span><input
					type="search"
					aria-label="Search datasets"
					bind:value={query}
					placeholder="Find a dataset"
					oninput={() => {
						rowPage = 0;
						selectedId = null;
						downloaded = false;
					}}
				/>{#if query}<button
						aria-label="Clear dataset search"
						onclick={() => {
							query = '';
							selectedId = null;
							downloaded = false;
						}}><X size={15} /></button
					>{/if}</label
			>
		</div>
	</div>
	{#if view === 'charts'}
		<div class="chart-section-heading">
			<div>
				<p>
					{topic === 'all' && !query.trim()
						? 'Chart overview'
						: `${topicLabel(topic)} · ${matches.length} ${matches.length === 1 ? 'dataset' : 'datasets'}`}
				</p>
				<span>{visibleCharts.length} charts · Sources and reference periods retained</span>
			</div>
			<button class="text-button" onclick={browse}
				>Browse {matches.length} datasets <ArrowDown size={16} aria-hidden="true" /></button
			>
		</div>
		{#if !visibleCharts.length}
			<div class="empty">
				<Search size={24} aria-hidden="true" />
				<h3>No datasets match this search</h3>
				<p>Try a subject, island, measure or publisher.</p>
				<button
					class="secondary-button"
					onclick={() => {
						topic = 'all';
						evidence = 'all';
						query = '';
					}}>Clear filters</button
				>
			</div>
		{:else}
			<div class="chart-grid">
				{#each visibleCharts as dataset, index (dataset.id)}
					<article
						class="chart-panel"
						class:featured={index === 0 && dataset.defaultChart === 'line'}
					>
						<header class="panel-heading">
							<div>
								<span class="eyebrow">{topicLabel(dataset.topic)}</span>
								<h3>{dataset.title}</h3>
							</div>
							<span
								class="evidence-badge"
								class:projected={dataset.evidence === 'projected'}
								class:modelled={dataset.evidence === 'modelled'}
								>{evidenceLabels[dataset.evidence]}</span
							>
						</header>
						<p class="chart-description">{dataset.description}</p>
						<p class="chart-period">Reference period: {datasetPeriod(dataset)}</p>
						{#if chartQualification(dataset)}<p class="chart-qualification">
								{chartQualification(dataset)}
							</p>{/if}
						<AnalyticalChart
							{dataset}
							height={index === 0 && dataset.defaultChart === 'line' ? 270 : 300}
						/>
						<footer class="chart-footer">
							<span title={dataset.sourceTitle}>{dataset.sourceTitle}</span><button
								onclick={() => inspect(dataset)}
								>Inspect data <ArrowUpRight size={15} aria-hidden="true" /></button
							>
						</footer>
					</article>
				{/each}
			</div>
			{#if !expandedCharts && overview.length > visibleCharts.length}
				<div class="more-charts">
					<span>{visibleCharts.length} of {overview.length} charts shown.</span><button
						class="secondary-button"
						onclick={() => (expandedCharts = true)}
						>Show all {overview.length} charts <ArrowDown size={15} aria-hidden="true" /></button
					>
				</div>
			{:else if expandedCharts}
				<div class="more-charts">
					<span>All {overview.length} datasets are shown.</span><button
						class="secondary-button"
						onclick={() => (expandedCharts = false)}>Show the overview</button
					>
				</div>
			{/if}
		{/if}
		<p class="coverage-note">
			Geographic layers remain on the map. Road congestion and vehicle occupancy series are not
			available in these datasets.{#if onShowMap}
				<button onclick={() => onShowMap?.()}
					>Open map <ArrowUpRight size={13} aria-hidden="true" /></button
				>{/if}
		</p>
	{:else}
		<div class="explorer-breadcrumb">
			<button class="text-button" onclick={() => (view = 'charts')}>← Back to chart overview</button
			>
			<span>Focus a dataset, then inspect or export the same view.</span>
		</div>
		<section
			class="dataset-library"
			bind:this={libraryElement}
			tabindex="-1"
			aria-labelledby="dataset-library-title"
		>
			<div class="library-heading">
				<div>
					<h2 id="dataset-library-title">Dataset explorer</h2>
					<p>
						{matches.length} datasets {topic !== 'all'
							? `in ${topicLabel(topic).toLowerCase()}`
							: 'available'}{query.trim() ? ` matching “${query.trim()}”` : ''}. Select one for its
						chart, exact values and source notes. Filters apply to the chart and its download.
					</p>
				</div>
				{#if onShowEvidence}<button
						class="text-button"
						onclick={() => onShowEvidence?.(selected ? evidenceWorkflow(selected) : 'Planning map')}
						>Review evidence <ArrowUpRight size={16} aria-hidden="true" /></button
					>{/if}
			</div>
			{#if selected}
				<div class="library-layout">
					<div class="dataset-list" aria-label="Available datasets">
						{#each matches as dataset (dataset.id)}<button
								class:chosen={selected.id === dataset.id}
								aria-pressed={selected.id === dataset.id}
								onclick={() => inspect(dataset)}
								><span class="dataset-topic">{topicLabel(dataset.topic)}</span><strong
									>{dataset.title}</strong
								><span>{dataset.rows.length.toLocaleString('en-GB')} records · {dataset.unit}</span
								></button
							>{/each}
					</div>
					<article
						class="dataset-detail"
						bind:this={detailElement}
						tabindex="-1"
						aria-label={`Dataset details: ${selected.title}`}
					>
						<div class="detail-heading">
							<div>
								<span
									class="evidence-badge"
									class:projected={selected.evidence === 'projected'}
									class:modelled={selected.evidence === 'modelled'}
									>{evidenceLabels[selected.evidence]}</span
								>
								<h3>{selected.title}</h3>
								<p>{selected.description}</p>
							</div>
						</div>
						<dl class="dataset-metadata">
							<div>
								<dt>Measure</dt>
								<dd>{selected.unit}</dd>
							</div>
							<div>
								<dt>Breakdown</dt>
								<dd>
									{selected.join.grain === 'month'
										? 'Monthly'
										: selected.join.grain === 'year'
											? 'Annual'
											: `By ${selected.join.grain}`}
								</dd>
							</div>
							<div>
								<dt>Period</dt>
								<dd>{datasetPeriod(selected)}</dd>
							</div>
						</dl>
						{#if focused && dimensions}
							{#if chartQualification(selected)}<p class="chart-qualification">
									{chartQualification(selected)}
								</p>{/if}
							<div class="dataset-lens" aria-label="Focus this dataset">
								<div class="lens-heading">
									<strong>Focus this dataset</strong>{#if hasLens}<button
											class="text-button"
											onclick={() => {
												lens = emptyDatasetLens();
												rowQuery = '';
												rowPage = 0;
												downloaded = false;
											}}>Reset filters <X size={13} aria-hidden="true" /></button
										>{/if}
								</div>
								<div class="lens-controls">
									{#if dimensions.periods.length > 1}
										<label
											><span>From</span><select
												aria-label="First period in chart"
												value={lens.periodStart}
												onchange={(event) => updateLens('periodStart', event.currentTarget.value)}
												><option value="">First available</option
												>{#each dimensions.periods as period (period)}<option value={period}
														>{periodLabel(period)}</option
													>{/each}</select
											></label
										>
										<label
											><span>To</span><select
												aria-label="Last period in chart"
												value={lens.periodEnd}
												onchange={(event) => updateLens('periodEnd', event.currentTarget.value)}
												><option value="">Most recent available</option
												>{#each dimensions.periods as period (period)}<option value={period}
														>{periodLabel(period)}</option
													>{/each}</select
											></label
										>
									{/if}
									{#if dimensions.series.length > 1}<label
											><span>Category</span><select
												aria-label="Category in chart"
												value={lens.series}
												onchange={(event) => updateLens('series', event.currentTarget.value)}
												><option value="">All categories</option
												>{#each dimensions.series as name (name)}<option value={name}>{name}</option
													>{/each}</select
											></label
										>{/if}
									{#if dimensions.geographies.length > 1}<label
											><span>Location</span><select
												aria-label="Location in chart"
												value={lens.geography}
												onchange={(event) => updateLens('geography', event.currentTarget.value)}
												><option value="">All locations</option
												>{#each dimensions.geographies as name (name)}<option value={name}
														>{name}</option
													>{/each}</select
											></label
										>{/if}
									{#if availableCharts.length > 1}<label
											><span>Chart</span><select
												aria-label="Chart type for focused dataset"
												bind:value={chartType}
												><option value="auto">Recommended</option
												>{#each availableCharts as type (type)}<option value={type}
														>{chartLabels[type]}</option
													>{/each}</select
											></label
										>{/if}
								</div>
							</div>
							{#if focused.rows.length}<AnalyticalChart
									dataset={focused}
									type={effectiveChartType}
								/>{:else}<div class="lens-empty">
									<h4>No records match this view</h4>
									<p>Change the period, category or location to include available records.</p>
								</div>{/if}
							<p class="view-coverage" role="status">
								<span
									>{focused.rows.length.toLocaleString('en-GB')} of {selected.rows.length.toLocaleString(
										'en-GB'
									)} records in this view</span
								>{#if completeness?.missing}<span
										>{completeness.missing.toLocaleString('en-GB')} missing {completeness.missing ===
										1
											? 'value'
											: 'values'} · kept as gaps</span
									>{:else if completeness?.total}<span>All displayed records have values</span>{/if}
							</p>
						{/if}
						<div class="detail-actions">
							{#if onBuild}<button class="primary-button" onclick={() => onBuild?.(selected.id)}
									><SlidersHorizontal size={16} aria-hidden="true" />{hasLens
										? 'Use full dataset in builder'
										: 'Use in visualization builder'}</button
								>{/if}<button
								class="secondary-button"
								disabled={!focused?.rows.length}
								onclick={() => focused && downloadRows(focused)}
								>{#if downloaded}<Check size={16} aria-hidden="true" />{:else}<Download
										size={16}
										aria-hidden="true"
									/>{/if}{downloaded
									? 'CSV downloaded'
									: hasLens
										? 'Download this view'
										: 'Download data'}</button
							>{#if onShowMap && ['population', 'services', 'transport'].includes(selected.topic)}<button
									class="text-button"
									onclick={() => onShowMap?.()}
									>Open planning map <ArrowUpRight size={15} aria-hidden="true" /></button
								>{/if}
						</div>
						<div class="source-note">
							<strong>Reading this dataset</strong>
							<p>{selected.sourceNote}</p>
							{#if additionalLimitations(selected).length}<ul>
									{#each additionalLimitations(selected) as limitation (limitation)}<li>
											{limitation}
										</li>{/each}
								</ul>{/if}
						</div>
						<details class="records-detail">
							<summary
								><span>Exact values</span><span
									>{focused?.rows.length.toLocaleString('en-GB')} records <ArrowDown
										size={14}
										aria-hidden="true"
									/></span
								></summary
							>
							<div class="records-controls">
								<label class="search-field"
									><Search size={15} aria-hidden="true" /><span class="sr-only"
										>Search records in {selected.title}</span
									><input
										type="search"
										bind:value={rowQuery}
										oninput={() => (rowPage = 0)}
										placeholder="Search this table"
									/></label
								><label class="record-order"
									><span class="sr-only">Sort exact values</span><select
										aria-label="Sort exact values"
										bind:value={rowOrder}
										onchange={() => (rowPage = 0)}
										><option value="source">Source order</option><option value="highest"
											>Highest value first</option
										><option value="lowest">Lowest value first</option></select
									></label
								>
							</div>
							<p class="table-scope">
								Search and sorting affect this table only. The chart and CSV use the dataset filters
								above.
							</p>
							<div class="table-scroll">
								<table>
									<caption class="sr-only"
										>Exact source-backed values for {selected.title}. Unit: {selected.unit}.</caption
									><thead
										><tr
											><th scope="col">{selected.xLabel}</th><th scope="col">Category / location</th
											><th scope="col" class="number">{selected.yLabel}</th></tr
										></thead
									><tbody
										>{#each visibleRows as row, index (`${row.key}-${row.series ?? ''}-${index}`)}<tr
												><th scope="row"
													>{row.label}{#if row.period && row.period !== row.label}<small
															>{row.period}</small
														>{/if}</th
												><td
													>{row.series ??
														row.geography ??
														'—'}{#if row.detail && row.detail !== sharedRowDetail(selected)}<small
															>{row.detail}</small
														>{/if}</td
												><td class="number"
													>{formatValue(
														row.value
													)}{#if row.evidence && row.evidence !== selected.evidence}<small
															>{evidenceLabels[row.evidence]}</small
														>{/if}</td
												></tr
											>{/each}</tbody
									>
								</table>
							</div>
							{#if sharedRowDetail(selected) && !selected.sourceNote.includes(sharedRowDetail(selected)!)}
								<p class="source-summary">{sharedRowDetail(selected)}</p>
							{/if}
							{#if !rows.length}<p class="record-empty">No records match this filter.</p>{/if}
							<div class="pagination">
								<span
									>{rows.length ? currentRowPage * rowPageSize + 1 : 0}–{Math.min(
										(currentRowPage + 1) * rowPageSize,
										rows.length
									)} of {rows.length.toLocaleString('en-GB')}</span
								>
								<div>
									<button
										class="secondary-button"
										disabled={currentRowPage <= 0}
										onclick={() => (rowPage = Math.max(0, currentRowPage - 1))}>Previous</button
									><button
										class="secondary-button"
										disabled={currentRowPage >= rowPages - 1}
										onclick={() => (rowPage = currentRowPage + 1)}>Next</button
									>
								</div>
							</div>
						</details>
						<details class="sources-detail">
							<summary
								><span>Sources & provenance</span><span
									>{selected.sources.length}
									{selected.sources.length === 1 ? 'source' : 'sources'}
									<ArrowDown size={14} aria-hidden="true" /></span
								></summary
							>
							<p class="source-summary">{selected.sourceTitle}</p>
							{#if publicLink(selected.sourceUrl)}<a
									href={publicLink(selected.sourceUrl) ?? undefined}
									target="_blank"
									rel="noreferrer"
									>Open primary source <ExternalLink size={14} aria-hidden="true" /></a
								>{/if}
							<ul class="source-list">
								{#each selected.sources as source (source.id)}<li>
										<strong>{source.title}</strong>{#if publicLink(source.url)}<a
												href={publicLink(source.url) ?? undefined}
												target="_blank"
												rel="noreferrer">Source <ExternalLink size={13} aria-hidden="true" /></a
											>{/if}<span>Reference: {source.id}</span>
										<dl class="source-metadata">
											{#if source.publisher}<div>
													<dt>Publisher</dt>
													<dd>{source.publisher}</dd>
												</div>{/if}{#if source.referencePeriod}<div>
													<dt>Reference period</dt>
													<dd>{source.referencePeriod}</dd>
												</div>{/if}{#if source.retrievedAt}<div>
													<dt>Retrieved</dt>
													<dd>{sourceDate(source.retrievedAt)}</dd>
												</div>{/if}{#if source.coverage}<div>
													<dt>Coverage</dt>
													<dd>{source.coverage}</dd>
												</div>{/if}{#if source.licenseStatus}<div>
													<dt>Reuse rights</dt>
													<dd>{source.licenseStatus}</dd>
												</div>{/if}{#if source.checksum}<div>
													<dt>Saved-copy checksum</dt>
													<dd class="checksum">{source.checksum}</dd>
												</div>{/if}
										</dl>
									</li>{/each}
							</ul>
							{#if onShowEvidence}<button
									class="text-button"
									onclick={() => onShowEvidence?.(evidenceWorkflow(selected))}
									>Inspect collection and evidence limits <ArrowUpRight
										size={15}
										aria-hidden="true"
									/></button
								>{/if}
						</details>
					</article>
				</div>
			{:else}<p class="library-empty">
					The library follows the subject and search above. Clear the filters to see available
					datasets.
				</p>{/if}
		</section>
	{/if}
</section>

<style>
	input[type='search']::-webkit-search-cancel-button {
		display: none;
	}
	.data-explorer {
		color: var(--workspace-ink, #172b3a);
		min-width: 0;
	}
	.library-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 24px;
	}
	h2,
	h3,
	p {
		margin: 0;
	}
	h2 {
		font-size: 21px;
		line-height: 1.3;
		font-weight: 650;
		letter-spacing: -0.45px;
	}
	.library-heading p {
		max-width: 710px;
		color: #647381;
		font-size: 14px;
		line-height: 1.65;
		margin-top: 7px;
	}
	button,
	input,
	select {
		font: inherit;
	}
	button {
		cursor: pointer;
	}
	button:disabled {
		cursor: default;
		opacity: 0.45;
	}
	button:active:not(:disabled) {
		transform: scale(0.98);
	}
	button:focus-visible,
	input:focus-visible,
	select:focus-visible,
	summary:focus-visible,
	a:focus-visible {
		outline: 2px solid #087f78;
		outline-offset: 3px;
	}
	.explorer-controls {
		display: flex;
		justify-content: space-between;
		gap: 16px;
		align-items: center;
		margin-top: 0;
		padding-bottom: 17px;
		border-bottom: 1px solid #dde3e9;
	}
	.topic-nav {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
	}
	.topic-nav button {
		color: #586a78;
		background: transparent;
		border: 1px solid transparent;

		border-radius: var(--surface-radius-pill, 999px);
		padding: 9px 11px;
		min-height: 44px;
		font-size: 13px;
		font-weight: 550;
		transition:
			background-color 120ms ease,
			color 120ms ease;
	}
	.topic-nav button:hover {
		background: #ebefef;
	}
	.topic-nav button.chosen {
		color: #096b66;
		border-color: #c8ddd9;
		background: #e9f3f1;
	}
	.search-field {
		display: flex;
		align-items: center;
		gap: 9px;
		height: 44px;
		padding: 0 12px;
		background: #fff;
		border: 1px solid #d6dfe5;

		border-radius: var(--surface-radius-field, 14px);
		color: #768592;
	}
	.catalog-filters {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.catalog-filters > .search-field {
		width: 212px;
		flex-shrink: 0;
	}
	.evidence-filter {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.evidence-filter > span {
		font-size: 11px;
		color: #647381;
	}
	.evidence-filter select,
	.lens-controls select,
	.record-order select {
		width: 100%;
		min-width: 0;
		min-height: 44px;
		border: 1px solid #d6dfe5;
		background: #fff;

		border-radius: var(--surface-radius-field, 14px);
		color: #334c5e;
		padding: 8px 28px 8px 10px;
		font-size: 12px;
	}
	.evidence-filter select {
		max-width: 205px;
	}
	.explorer-breadcrumb {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 13px 0 0;
	}
	.explorer-breadcrumb > span {
		font-size: 12px;
		color: #647381;
		line-height: 1.6;
	}
	.search-field input {
		border: 0;
		outline: none;
		background: transparent;
		width: 100%;
		min-width: 0;
		font-size: 13px;
		color: #172b3a;
	}
	.search-field:focus-within {
		border-color: #087f78;
		box-shadow: 0 0 0 2px #087f7812;
	}
	.search-field button {
		display: grid;
		place-items: center;
		padding: 0;
		background: transparent;
		border: 0;
		width: 24px;
		height: 30px;
		color: #647381;
	}
	.chart-section-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		padding: 12px 0;
		font-size: 12px;
	}
	.chart-section-heading p {
		font-weight: 650;
	}
	.chart-section-heading span {
		color: #73818d;
		display: block;
		margin-top: 5px;
		font-size: 11px;
	}
	.coverage-note {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 10px;
		color: #73818d;
		font-size: 11px;
		line-height: 1.6;
		margin: 14px 0 0;
	}
	.coverage-note button {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: 32px;
		background: none;
		border: 0;
		color: #08756f;
		font-size: 11px;
		padding: 0;
	}
	.chart-grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 18px;
	}
	.chart-panel {
		background: #fff;
		border: 1px solid #dde3e9;

		border-radius: var(--surface-radius, 28px);
		padding: 22px 22px 0;
		min-width: 0;
		overflow: hidden;
		box-shadow: var(--surface-shadow);
	}
	.chart-panel.featured {
		grid-column: 1 / -1;
	}
	.panel-heading {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 14px;
	}
	.eyebrow,
	.dataset-topic {
		display: block;
		font-size: 10px;
		letter-spacing: 0.8px;
		text-transform: uppercase;
		color: #6a7b88;
		font-weight: 650;
	}
	.panel-heading h3 {
		font-size: 17px;
		font-weight: 650;
		line-height: 1.4;
		letter-spacing: -0.25px;
		margin-top: 5px;
	}
	.evidence-badge {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
		border-radius: 4px;
		color: #5b6a77;
		background: #f0f3f5;
		padding: 5px 7px;
		font-size: 10px;
		line-height: 1.2;
		font-weight: 550;
	}
	.evidence-badge.projected {
		color: #486685;
		background: #edf2f8;
	}
	.evidence-badge.modelled {
		color: #8a681f;
		background: #f8f2e5;
	}
	.chart-description {
		font-size: 12px;
		line-height: 1.65;
		color: #647381;
		margin: 10px 0 14px;
	}
	.chart-period {
		font-size: 10px;
		color: #73818d;
		margin: -6px 0 11px;
	}
	.chart-qualification {
		border-left: 2px solid #b4c7cd;
		padding-left: 10px;
		margin: 0 0 16px;
		font-size: 11px;
		line-height: 1.65;
		color: #526977;
	}
	.chart-footer {
		border-top: 1px solid #e9edf0;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		min-height: 55px;
		margin: 4px -22px 0;
		padding: 8px 22px;
	}
	.chart-footer > span {
		font-size: 10px;
		line-height: 1.5;
		color: #73818d;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.chart-footer button,
	.text-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		min-height: 44px;
		border: 0;
		padding: 8px 0;
		color: #08756f;
		background: transparent;
		font-size: 12px;
		font-weight: 600;
	}
	.chart-footer button {
		white-space: nowrap;
	}
	.more-charts {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 20px;
		padding: 22px 0;
	}
	.more-charts > span {
		color: #73818d;
		font-size: 12px;
	}
	.secondary-button,
	.primary-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		border: 1px solid #d6dfe5;
		min-height: 44px;

		border-radius: var(--surface-radius-pill, 999px);
		padding: 10px 13px;
		background: #fff;
		color: #334c5e;
		font-size: 12px;
		font-weight: 600;
	}
	.secondary-button:hover:not(:disabled) {
		background: #f4f7f8;
	}
	.primary-button {
		border-color: #087f78;
		background: #087f78;
		color: #fff;
	}
	.primary-button:hover {
		background: #066e68;
	}
	.dataset-library {
		margin-top: 15px;
		padding-top: 8px;
		scroll-margin-top: 24px;
	}
	.library-heading {
		margin-bottom: 20px;
	}
	.library-heading h2 {
		margin-top: 6px;
	}
	.library-layout {
		display: grid;
		grid-template-columns: 255px minmax(0, 1fr);
		gap: 22px;
		align-items: start;
	}
	.dataset-list {
		display: flex;
		flex-direction: column;
		gap: 5px;
		max-height: 820px;
		overflow: auto;
		padding: 0 6px 0 0;
	}
	.dataset-list button {
		display: flex;
		flex-direction: column;
		text-align: left;
		border: 1px solid transparent;

		border-radius: var(--surface-radius-inner, 16px);
		padding: 13px 12px;
		background: transparent;
		color: #172b3a;
		gap: 6px;
	}
	.dataset-list button:hover {
		background: #edf1f3;
	}
	.dataset-list button.chosen {
		background: #fff;
		border-color: #ccdcd9;
		box-shadow: inset 3px 0 0 #087f78;
	}
	.dataset-list strong {
		font-size: 13px;
		font-weight: 600;
		line-height: 1.45;
	}
	.dataset-list button > span:last-child {
		color: #788692;
		font-size: 11px;
		line-height: 1.45;
	}
	.dataset-detail {
		background: #fff;
		border: 1px solid #dde3e9;

		border-radius: var(--surface-radius, 28px);
		padding: 24px;
		min-width: 0;
		scroll-margin-top: 24px;
		box-shadow: var(--surface-shadow);
	}
	.dataset-detail:focus,
	.dataset-library:focus {
		outline: none;
	}
	.detail-heading h3 {
		font-size: 22px;
		line-height: 1.35;
		letter-spacing: -0.45px;
		font-weight: 650;
		margin: 11px 0 8px;
	}
	.detail-heading p {
		font-size: 13px;
		color: #647381;
		line-height: 1.65;
	}
	.dataset-metadata {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 16px;
		margin: 22px 0;
		border-block: 1px solid #e9edf0;
		padding: 14px 0;
	}
	.dataset-metadata dt {
		font-size: 10px;
		color: #788692;
		margin-bottom: 5px;
	}
	.dataset-metadata dd {
		font-size: 12px;
		line-height: 1.5;
		font-weight: 550;
		margin: 0;
	}
	.detail-actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 9px;
		padding: 14px 0 18px;
	}
	.dataset-lens {
		border-bottom: 1px solid #e9edf0;
		padding: 0 0 18px;
		margin-bottom: 12px;
	}
	.lens-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 34px;
		margin-bottom: 10px;
	}
	.lens-heading > strong {
		font-size: 12px;
		font-weight: 600;
		color: #334c5e;
	}
	.lens-heading .text-button {
		min-height: 32px;
		font-size: 11px;
		padding-block: 2px;
	}
	.lens-controls {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
		gap: 12px;
	}
	.lens-controls label {
		display: flex;
		flex-direction: column;
		gap: 7px;
		min-width: 0;
	}
	.lens-controls label > span {
		font-size: 11px;
		color: #647381;
	}
	.view-coverage {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 8px 14px;
		padding: 12px 0;
		border-block: 1px solid #e9edf0;
		font-size: 11px;
		color: #647381;
		line-height: 1.6;
	}
	.lens-empty {
		padding: 50px 20px;
		text-align: center;
	}
	.lens-empty h4 {
		margin: 0 0 8px;
		font-size: 15px;
		font-weight: 600;
	}
	.lens-empty p {
		font-size: 12px;
		line-height: 1.6;
		color: #647381;
	}
	.table-scope {
		font-size: 11px;
		color: #647381;
		line-height: 1.6;
		margin: -4px 0 14px;
	}
	.source-note {
		background: #f5f7f8;

		border-radius: var(--surface-radius-inner, 16px);
		padding: 16px;
		font-size: 12px;
		line-height: 1.65;
		color: #586b7a;
	}
	.source-note strong {
		color: #334c5e;
		font-weight: 650;
	}
	.source-note p {
		margin-top: 5px;
	}
	.source-note ul {
		margin: 7px 0 0;
		padding-left: 16px;
	}
	.source-note li + li {
		margin-top: 5px;
	}
	.records-detail,
	.sources-detail {
		margin-top: 20px;
		border-top: 1px solid #dde3e9;
	}
	summary {
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: space-between;
		list-style: none;
		gap: 20px;
		min-height: 55px;
		font-size: 13px;
		font-weight: 600;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	summary > span:last-child {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 11px;
		color: #788692;
		font-weight: 400;
	}
	details[open] summary :global(svg) {
		transform: rotate(180deg);
	}
	.records-controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		margin: 3px 0 15px;
	}
	.records-controls .search-field {
		width: 230px;
	}
	.table-scroll {
		overflow-x: auto;
		border-radius: var(--surface-radius-inner, 16px);
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	th,
	td {
		text-align: left;
		padding: 11px 9px;
		border-bottom: 1px solid #e9edf0;
		line-height: 1.5;
		vertical-align: top;
	}
	thead th {
		color: #788692;
		font-size: 10px;
		font-weight: 600;
		background: #f7f8f9;
	}
	tbody th {
		font-weight: 550;
	}
	.number {
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	td {
		color: #586b7a;
	}
	th small,
	td small {
		display: block;
		color: #788692;
		font-size: 10px;
		margin-top: 3px;
		font-weight: 400;
	}
	.pagination {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding-top: 14px;
		font-size: 11px;
		color: #73818d;
	}
	.pagination > div {
		display: flex;
		gap: 6px;
	}
	.source-summary {
		font-size: 12px;
		color: #647381;
		margin: 4px 0 8px;
	}
	.sources-detail a {
		color: #08756f;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		text-decoration: none;
		min-height: 32px;
	}
	.source-list {
		list-style: none;
		margin: 13px 0 5px;
		padding: 0;
	}
	.source-list li {
		border-top: 1px solid #edf0f2;
		padding: 11px 0;
		display: flex;
		flex-wrap: wrap;
		gap: 6px 13px;
	}
	.source-list strong {
		font-size: 12px;
		line-height: 1.5;
		font-weight: 550;
	}
	.source-list span {
		display: block;
		flex-basis: 100%;
		font-size: 10px;
		color: #788692;
		overflow-wrap: anywhere;
	}
	.source-metadata {
		flex-basis: 100%;
		width: 100%;
		margin: 3px 0 0;
	}
	.source-metadata > div {
		display: grid;
		grid-template-columns: 115px minmax(0, 1fr);
		gap: 12px;
		padding: 4px 0;
		font-size: 11px;
		line-height: 1.6;
	}
	.source-metadata dt {
		color: #788692;
	}
	.source-metadata dd {
		margin: 0;
		color: #586b7a;
	}
	.checksum {
		overflow-wrap: anywhere;
		font-family: monospace;
		font-size: 10px;
	}
	.empty {
		text-align: center;
		border: 1px solid #dde3e9;

		border-radius: var(--surface-radius, 28px);
		background: #fff;
		padding: 40px 20px;
		color: #73818d;
		box-shadow: var(--surface-shadow);
	}
	.empty > :global(svg) {
		margin: 0 auto 13px;
	}
	.empty h3 {
		font-size: 17px;
		color: #334c5e;
	}
	.empty p {
		font-size: 13px;
		margin: 8px 0 15px;
	}
	.record-empty,
	.library-empty {
		padding: 20px 0;
		color: #73818d;
		font-size: 13px;
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
	@media (max-width: 1100px) {
		.explorer-controls {
			flex-wrap: wrap;
		}
		.catalog-filters {
			width: 100%;
		}
		.catalog-filters > .search-field {
			flex: 1;
			align-self: flex-end;
		}
		.library-layout {
			grid-template-columns: 220px minmax(0, 1fr);
			gap: 18px;
		}
		.panel-heading {
			flex-wrap: wrap;
		}
		.evidence-badge {
			font-size: 9px;
		}
	}
	@media (max-width: 760px) {
		.explorer-breadcrumb {
			flex-wrap: wrap;
			gap: 0;
		}
		.library-heading {
			flex-wrap: wrap;
			gap: 7px;
		}
		.library-heading > .text-button {
			justify-content: flex-start;
		}
		.chart-grid {
			grid-template-columns: minmax(0, 1fr);
			gap: 14px;
		}
		.chart-panel {
			padding: 18px 16px 0;
		}
		.chart-footer {
			margin-inline: -16px;
			padding-inline: 16px;
		}
		.chart-section-heading {
			gap: 12px;
			align-items: center;
		}
		.chart-section-heading > .text-button {
			font-size: 11px;
			white-space: nowrap;
		}
		.chart-section-heading span {
			display: block;
			margin-top: 6px;
			line-height: 1.5;
		}
		.library-layout {
			grid-template-columns: minmax(0, 1fr);
			gap: 16px;
		}
		.dataset-list {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			max-height: 315px;
			padding: 0 4px 0 0;
		}
		.dataset-detail {
			padding: 20px 16px;
		}
		.more-charts {
			flex-wrap: wrap;
			gap: 10px;
			padding: 20px 0;
		}
		.more-charts > span {
			width: 100%;
			text-align: center;
		}
		.records-controls {
			flex-wrap: wrap;
			gap: 7px;
		}
		.records-controls .search-field {
			width: 100%;
		}
	}
	@media (max-width: 420px) {
		.catalog-filters {
			flex-wrap: wrap;
			gap: 12px;
		}
		.evidence-filter,
		.evidence-filter select,
		.catalog-filters > .search-field {
			width: 100%;
			max-width: none;
		}
		.catalog-filters > .search-field {
			flex-basis: 100%;
		}
		.lens-controls {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.topic-nav {
			gap: 2px;
		}
		.topic-nav button {
			padding-inline: 9px;
			font-size: 12px;
		}
		.dataset-list {
			grid-template-columns: minmax(0, 1fr);
			max-height: 280px;
		}
		.dataset-metadata {
			grid-template-columns: minmax(0, 1fr);
			gap: 10px;
		}
		.dataset-metadata > div {
			display: grid;
			grid-template-columns: 62px minmax(0, 1fr);
			gap: 10px;
		}
		.dataset-metadata dt {
			margin: 1px 0 0;
		}
		.primary-button {
			width: 100%;
		}
		.detail-heading h3 {
			font-size: 19px;
		}
		.pagination {
			flex-wrap: wrap;
		}
		.chart-footer {
			gap: 8px;
		}
	}

	@media (max-width: 600px) {
		.chart-panel,
		.dataset-detail,
		.empty {
			border-radius: var(--surface-radius-mobile, 24px);
		}
	}
</style>
