<script lang="ts">
	import { ArrowUpRight, Download, Plus, Save, Trash2 } from '@lucide/svelte';
	import { onMount, tick, untrack } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import {
		combineDatasets,
		compatibility,
		type AnalyticalDataset
	} from '#lib/analytics/catalog.ts';
	import AnalyticalChart from './AnalyticalChart.svelte';
	import { availableStoryStarters, type StoryStarter } from '#lib/analytics/storyStarters.ts';
	import { isHourlySchedule } from './chartOptions.ts';
	import {
		DATA_STORY_STORAGE_KEY,
		MAX_SAVED_DATA_STORIES,
		dataStoryCsvCell,
		readDataStories,
		serializeDataStories,
		type BuilderChartType,
		type SavedDataStory
	} from './builderStories.ts';

	let {
		datasets,
		requestedDatasetId,
		onShowEvidence
	}: {
		datasets: AnalyticalDataset[];
		requestedDatasetId?: string;
		onShowEvidence?: () => void;
	} = $props();

	let primaryId = $state('');
	let comparisonId = $state('auto');
	let mode = $state<'auto' | 'values' | 'indexed'>('auto');
	let alignment = $state<'union' | 'common'>('common');
	let chartType = $state<BuilderChartType | 'auto'>('auto');
	let title = $state('');
	let observation = $state('');
	let stories = $state<SavedDataStory[]>([]);
	let selectedStoryId = $state('');
	let message = $state('');
	let storageError = $state('');
	let preservedStorage = $state('');
	let mounted = $state(false);
	let rowPage = $state(0);
	let settingsOpen = $state(true);
	let previewElement = $state<HTMLDivElement>();
	const pageSize = 12;
	const topicLabels: Record<AnalyticalDataset['topic'], string> = {
		passengers: 'Passenger activity',
		population: 'People and places',
		services: 'Public services',
		transport: 'Transport network',
		economy: 'Economy',
		operations: 'Operations'
	};
	const topics = Object.keys(topicLabels) as AnalyticalDataset['topic'][];
	const starters = $derived(availableStoryStarters(datasets));
	let starterId = $state('');
	const numberFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 });
	const defaultDataset = $derived(
		datasets.find(
			(dataset) => dataset.id === 'aviation-caa-11-13-international-passenger-arrivals'
		) ??
			datasets.find(
				(dataset) =>
					dataset.evidence === 'observed' &&
					dataset.join.grain === 'month' &&
					datasets.some(
						(candidate) =>
							candidate.id !== dataset.id &&
							candidate.topic === dataset.topic &&
							compatibility(dataset, candidate).compatible
					)
			) ??
			datasets[0]
	);
	const primary = $derived(datasets.find((dataset) => dataset.id === primaryId) ?? defaultDataset);
	const compatibleDatasets = $derived(
		primary
			? datasets.filter(
					(dataset) => dataset.id !== primary.id && compatibility(primary, dataset).compatible
				)
			: []
	);
	const automaticComparison = $derived(
		compatibleDatasets.find(
			(dataset) => dataset.topic === primary?.topic && dataset.unit === primary?.unit
		) ?? null
	);
	const comparison = $derived(
		comparisonId === 'auto'
			? automaticComparison
			: (datasets.find((dataset) => dataset.id === comparisonId) ?? null)
	);
	const usesDifferentUnits = $derived(!!comparison && comparison.unit !== primary?.unit);
	const effectiveMode = $derived(
		mode === 'auto' ? (usesDifferentUnits ? 'indexed' : 'values') : mode
	);
	const combination = $derived(
		combineDatasets(primary ? (comparison ? [primary, comparison] : [primary]) : [], {
			mode: effectiveMode,
			alignment
		})
	);
	const chartDataset = $derived(
		combination.ok
			? !comparison && effectiveMode === 'values'
				? primary
				: combination.dataset
			: undefined
	);
	const chartSeriesCount = $derived(
		new Set(chartDataset?.rows.map((row) => row.series || chartDataset.title) ?? []).size
	);
	const chartWarnings = $derived(
		comparison || effectiveMode === 'indexed' ? combination.warnings : []
	);
	const hasMissingChartValues = $derived(
		chartDataset?.rows.some((row) => row.value === null) ?? false
	);
	const isTemporal = $derived(
		chartDataset?.join.grain === 'month' || chartDataset?.join.grain === 'year'
	);
	const isHourly = $derived(!!chartDataset && isHourlySchedule(chartDataset));
	const hasPairedPoints = $derived.by(() => {
		if (!chartDataset) return false;
		const series = [...new Set(chartDataset.rows.map((row) => row.series || chartDataset.title))];
		if (series.length !== 2) return false;
		const values = new SvelteMap<string, SvelteSet<string>>();
		for (const row of chartDataset.rows) {
			if (row.value === null || !Number.isFinite(row.value)) continue;
			const atKey = values.get(row.key) ?? new SvelteSet<string>();
			atKey.add(row.series || chartDataset.title);
			values.set(row.key, atKey);
		}
		return [...values.values()].filter((value) => value.size === 2).length >= 3;
	});
	const chartChoices = $derived([
		{ value: 'line', label: 'Trend over time', available: !!isTemporal },
		{ value: 'bar', label: 'Compare amounts', available: true },
		{ value: 'scatter', label: 'Compare relationships', available: hasPairedPoints },
		{
			value: 'heatmap',
			label: isHourly ? 'Hourly route intensity' : 'Monthly intensity',
			available: isHourly || (chartDataset?.join.grain === 'month' && chartSeriesCount === 1)
		}
	] satisfies { value: BuilderChartType; label: string; available: boolean }[]);
	const effectiveChartType = $derived(
		chartType !== 'auto' &&
			chartChoices.some((choice) => choice.value === chartType && choice.available)
			? chartType
			: chartDataset &&
				  chartChoices.some(
						(choice) => choice.value === chartDataset.defaultChart && choice.available
				  )
				? chartDataset.defaultChart
				: isTemporal
					? 'line'
					: 'bar'
	);
	const proposedTitle = $derived(
		comparison && primary
			? `${primary.title} and ${comparison.title}`
			: (primary?.title ?? 'Data story')
	);
	const rows = $derived(chartDataset?.rows ?? []);
	const pageCount = $derived(Math.max(1, Math.ceil(rows.length / pageSize)));
	const visiblePage = $derived(Math.min(rowPage, pageCount - 1));
	const displayedRows = $derived(rows.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize));
	const excludedDatasets = $derived(
		primary
			? datasets
					.filter(
						(dataset) => dataset.id !== primary.id && !compatibility(primary, dataset).compatible
					)
					.map((dataset) => ({ dataset, reason: compatibility(primary, dataset).reason }))
			: []
	);

	$effect(() => {
		const requested = requestedDatasetId;
		if (requested) {
			untrack(() => {
				if (!datasets.some((dataset) => dataset.id === requested)) {
					message = 'This dataset is no longer available. Choose one from the current catalogue.';
					return;
				}
				primaryId = requested;
				comparisonId = '';
				mode = 'auto';
				chartType = 'auto';
				selectedStoryId = '';
				title = '';
				observation = '';
				rowPage = 0;
			});
		}
	});

	onMount(() => {
		mounted = true;
		const mobileQuery = window.matchMedia('(max-width: 760px)');
		const syncSettings = () => {
			settingsOpen = !mobileQuery.matches;
		};
		syncSettings();
		mobileQuery.addEventListener('change', syncSettings);
		try {
			const raw = localStorage.getItem(DATA_STORY_STORAGE_KEY);
			const result = readDataStories(raw);
			stories = result.stories;
			storageError = result.error || '';
			if (result.error) preservedStorage = raw || '';
		} catch {
			storageError =
				'This browser does not allow saved stories. Charts and CSV downloads still work.';
		}
		return () => mobileQuery.removeEventListener('change', syncSettings);
	});

	function selectPrimary(value: string) {
		starterId = '';
		primaryId = value;
		comparisonId = '';
		mode = 'auto';
		chartType = 'auto';
		rowPage = 0;
		message = '';
	}

	function selectComparison(value: string) {
		starterId = '';
		comparisonId = value;
		mode = 'auto';
		chartType = 'auto';
		rowPage = 0;
		message = '';
	}
	function startComparison(starter: StoryStarter) {
		primaryId = starter.primaryId;
		comparisonId = starter.comparisonId;
		mode = starter.mode;
		alignment = 'common';
		chartType = 'auto';
		title = '';
		observation = '';
		selectedStoryId = '';
		starterId = starter.id;
		rowPage = 0;
		message = 'Comparison loaded. Choose a chart, inspect the records, and write what you notice.';
	}

	function persist(nextStories: SavedDataStory[]) {
		if (!mounted || storageError) return false;
		try {
			localStorage.setItem(DATA_STORY_STORAGE_KEY, serializeDataStories(nextStories));
			stories = nextStories;
			return true;
		} catch {
			message = 'Your story could not be saved. Browser storage may be full or disabled.';
			return false;
		}
	}

	function saveStory() {
		if (!primary || !chartDataset) return;
		if (!selectedStoryId && stories.length >= MAX_SAVED_DATA_STORIES) {
			message = `You have ${MAX_SAVED_DATA_STORIES} saved stories. Delete one before adding another.`;
			return;
		}
		const id = selectedStoryId || crypto.randomUUID();
		const story: SavedDataStory = {
			id,
			title: (title.trim() || proposedTitle).slice(0, 120),
			observation: observation.trim(),
			primaryId: primary.id,
			comparisonId: comparison?.id || '',
			mode: effectiveMode,
			alignment,
			chartType: effectiveChartType,
			updatedAt: new Date().toISOString()
		};
		const nextStories = [story, ...stories.filter((candidate) => candidate.id !== id)];
		if (persist(nextStories)) {
			selectedStoryId = id;
			title = story.title;
			message = 'Story saved in this browser. It will use the current source data when reopened.';
		}
	}

	async function openStory(story: SavedDataStory) {
		if (
			!datasets.some((dataset) => dataset.id === story.primaryId) ||
			(story.comparisonId && !datasets.some((dataset) => dataset.id === story.comparisonId))
		) {
			message =
				'This story refers to a dataset that is no longer in the catalogue. Its saved copy is kept.';
			return;
		}
		primaryId = story.primaryId;
		comparisonId = story.comparisonId;
		mode = story.mode;
		alignment = story.alignment;
		chartType = story.chartType;
		title = story.title;
		observation = story.observation;
		selectedStoryId = story.id;
		rowPage = 0;
		message =
			'Saved settings loaded against the current catalogue. Check the dates and source limits.';
		await tick();
		previewElement?.scrollIntoView({ block: 'start' });
		previewElement?.focus({ preventScroll: true });
	}

	function newStory() {
		selectedStoryId = '';
		title = '';
		observation = '';
		message = 'New story started with the current chart settings.';
	}

	function deleteStory(story: SavedDataStory) {
		if (persist(stories.filter((candidate) => candidate.id !== story.id))) {
			if (selectedStoryId === story.id) selectedStoryId = '';
			message = 'Saved story deleted. The chart settings remain open.';
		}
	}

	function download(contents: string, filename: string, contentType: string) {
		const url = URL.createObjectURL(new Blob([contents], { type: contentType }));
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = filename;
		anchor.click();
		URL.revokeObjectURL(url);
	}

	function downloadCsv() {
		if (!chartDataset) return;
		const columns = [
			'key',
			'label',
			'series',
			'value',
			'unit',
			'period',
			'geography',
			'evidence',
			'source_ids',
			'original_detail'
		];
		const lines = [
			columns.map(dataStoryCsvCell).join(','),
			...rows.map((row) =>
				[
					row.key,
					row.label,
					row.series || chartDataset.title,
					row.value,
					chartDataset.unit,
					row.period,
					row.geography,
					row.evidence || chartDataset.evidence,
					row.sourceIds.join('; '),
					row.detail
				]
					.map(dataStoryCsvCell)
					.join(',')
			)
		];
		download(
			`\uFEFF${lines.join('\r\n')}`,
			'data-story-chart-values.csv',
			'text/csv;charset=utf-8;'
		);
	}

	function resetStoredStories() {
		try {
			localStorage.removeItem(DATA_STORY_STORAGE_KEY);
			stories = [];
			storageError = '';
			preservedStorage = '';
			selectedStoryId = '';
			message = 'Saved story storage reset. You can now save the current chart.';
		} catch {
			message = 'This browser still does not allow story storage.';
		}
	}
</script>

<section class="story-workspace" aria-label="Visualization builder">
	<header class="builder-intro">
		<div>
			<h2>Build a data story</h2>
			<p>Compare matching records and write what you notice.</p>
		</div>
		{#if onShowEvidence}
			<button class="text-button" type="button" onclick={onShowEvidence}>Check data sources</button>
		{/if}
	</header>
	{#if starters.length}
		<section class="comparison-starters" aria-label="Suggested data comparisons">
			<div class="starter-heading">
				<h3>Start with a comparison</h3>
				<span>Or choose your own datasets below</span>
			</div>
			<div class="starter-grid">
				{#each starters as starter (starter.id)}<button
						class:chosen={starterId === starter.id}
						type="button"
						aria-pressed={starterId === starter.id}
						onclick={() => startComparison(starter)}
						><strong>{starter.question}<ArrowUpRight size={16} aria-hidden="true" /></strong><span
							>{starter.note}</span
						></button
					>{/each}
			</div>
		</section>
	{/if}

	{#if !primary}
		<div class="empty-state">
			<h3>No datasets are available yet</h3>
			<p>
				The builder needs verified records. Return to the data library when loading is complete.
			</p>
		</div>
	{:else}
		<div class="builder-layout">
			<details class="builder-controls" bind:open={settingsOpen}>
				<summary class="settings-summary"
					><span>Chart settings</span><span class="disclosure-mark" aria-hidden="true">⌄</span
					></summary
				>
				<div class="settings-fields">
					<label for="story-primary">Start with a dataset</label>
					<select
						id="story-primary"
						value={primary.id}
						onchange={(event) => selectPrimary(event.currentTarget.value)}
					>
						{#each topics as topic (topic)}
							{#if datasets.some((dataset) => dataset.topic === topic)}
								<optgroup label={topicLabels[topic]}>
									{#each datasets.filter((dataset) => dataset.topic === topic) as dataset (dataset.id)}
										<option value={dataset.id}>{dataset.title}</option>
									{/each}
								</optgroup>
							{/if}
						{/each}
					</select>
					<p class="control-help">{primary.description}</p>

					<label for="story-comparison">Add a comparison</label>
					<select
						id="story-comparison"
						value={comparison?.id || ''}
						onchange={(event) => selectComparison(event.currentTarget.value)}
						disabled={!compatibleDatasets.length}
					>
						<option value="">One dataset only</option>
						{#each compatibleDatasets as dataset (dataset.id)}
							<option value={dataset.id}>{dataset.title}</option>
						{/each}
					</select>
					<p class:selection-description={!!comparison} class="control-help">
						{#if comparison}
							{comparison.title}
						{:else if compatibleDatasets.length}
							Only datasets with the same places, time basis and level of detail are offered.
						{:else}
							No other dataset has matching coverage and detail. This dataset can still be explored
							on its own.
						{/if}
					</p>

					{#if comparison}
						<label for="story-units">Compare using</label>
						<select
							id="story-units"
							value={effectiveMode}
							onchange={(event) => {
								mode = event.currentTarget.value as 'values' | 'indexed';
								rowPage = 0;
							}}
						>
							<option value="values" disabled={usesDifferentUnits}>Original amounts</option>
							<option value="indexed">Relative change · first common value = 100</option>
						</select>
						{#if usesDifferentUnits}
							<p class="control-help">
								The units differ ({primary.unit} and {comparison.unit}). Compare relative change
								rather than amounts.
							</p>
						{/if}
						<label for="story-alignment">Which records?</label>
						<select
							id="story-alignment"
							bind:value={alignment}
							onchange={() => {
								rowPage = 0;
							}}
						>
							<option value="common">Shared records only</option>
							<option value="union">All records · keep gaps visible</option>
						</select>
					{/if}

					<label for="story-chart">Show as</label>
					<select
						id="story-chart"
						value={effectiveChartType}
						onchange={(event) => {
							chartType = event.currentTarget.value as BuilderChartType;
						}}
						disabled={!chartDataset}
					>
						{#each chartChoices as choice (choice.value)}
							<option value={choice.value} disabled={!choice.available}>{choice.label}</option>
						{/each}
					</select>
					<p class="control-help">
						{#if !hasPairedPoints}
							A relationship plot needs two series and at least three shared observations.
						{:else}
							A relationship can suggest a question; it does not establish cause and effect.
						{/if}
					</p>

					{#if excludedDatasets.length}
						<details class="join-explainer">
							<summary>Why can’t all datasets be combined?</summary>
							<p>A matching month or island name alone does not guarantee matching coverage.</p>
							<ul>
								{#each excludedDatasets as excluded (excluded.dataset.id)}
									<li><strong>{excluded.dataset.title}</strong><span>{excluded.reason}</span></li>
								{/each}
							</ul>
						</details>
					{/if}
				</div>
			</details>

			<div
				class="builder-preview"
				bind:this={previewElement}
				tabindex="-1"
				role="region"
				aria-label="Visualization preview"
			>
				{#if chartDataset}
					<div class="preview-meta">
						<span
							>{chartDataset.evidence === 'observed'
								? 'Published records'
								: chartDataset.evidence === 'projected'
									? 'Projection'
									: chartDataset.evidence === 'modelled'
										? 'Modelled estimates'
										: chartDataset.evidence === 'schedule'
											? 'Timetable snapshot'
											: chartDataset.evidence === 'mixed'
												? 'Different evidence types · inspect sources'
												: 'Inventory snapshot'}</span
						>
						<span>{effectiveMode === 'indexed' ? 'Relative change' : chartDataset.unit}</span>
					</div>
					<h3 class="preview-title">{title.trim() || proposedTitle}</h3>
					<AnalyticalChart
						dataset={chartDataset}
						type={effectiveChartType}
						title={title.trim() || proposedTitle}
					/>
					<div class="coverage-note">
						<strong
							>{comparison
								? `${combination.commonKeys.length} shared ${chartDataset.join.grain === 'month' ? 'months' : chartDataset.join.grain === 'year' ? 'years' : 'categories'}`
								: `${new Set(rows.map((row) => row.key)).size} ${chartDataset.join.grain === 'month' ? 'months' : chartDataset.join.grain === 'year' ? 'years' : isHourlySchedule(chartDataset) ? 'service hours' : 'categories'}`}</strong
						>
						<span
							>Matched by {chartDataset.join.grain}{chartDataset.join.period
								? ` · ${chartDataset.join.period}`
								: ''}.</span
						>
						{#if comparison && combination.unmatchedKeys.length}
							<span
								>{combination.unmatchedKeys.length} keys do not appear in both sources{alignment ===
								'common'
									? ' and are omitted'
									: '; missing values stay blank'}.</span
							>
						{/if}
						{#if hasMissingChartValues}<span>Blank values mean no value is supplied, not zero.</span
							>{/if}
					</div>
					{#if chartWarnings.length}
						<div class="chart-cautions">
							{#each chartWarnings as warning (warning)}<p>{warning}</p>{/each}
						</div>
					{/if}
				{:else}
					<div class="empty-state invalid-chart" role="status">
						<h3>These records cannot be combined</h3>
						<p>{combination.reason || 'Choose an available dataset with verified values.'}</p>
						<button type="button" onclick={() => selectComparison('')}>Show one dataset</button>
					</div>
				{/if}
			</div>
		</div>

		{#if chartDataset}
			<details class="exact-records">
				<summary>Inspect chart values and sources <span>{rows.length} rows</span></summary>
				<div class="records-toolbar">
					<p>
						{effectiveMode === 'indexed'
							? 'Values are indexed for this chart; the source datasets keep their original amounts.'
							: 'Values below are the amounts used in this chart.'} Missing values remain blank.
					</p>
					<button type="button" onclick={downloadCsv}
						><Download size={16} /> Download chart CSV</button
					>
				</div>
				<div class="table-scroll">
					<table>
						<thead
							><tr
								><th scope="col">Record</th><th scope="col">Series</th><th
									scope="col"
									class="numeric">{chartDataset.unit}</th
								><th scope="col">Source references</th></tr
							></thead
						>
						<tbody>
							{#each displayedRows as row, index (`${row.key}-${row.series}-${index}`)}
								<tr
									><th scope="row">{row.label}</th><td>{row.series || chartDataset.title}</td><td
										class="numeric">{row.value === null ? '—' : numberFormat.format(row.value)}</td
									><td class="source-reference"
										>{row.sourceIds.join(', ') || 'See dataset source'}</td
									></tr
								>
							{/each}
						</tbody>
					</table>
				</div>
				{#if pageCount > 1}
					<div class="pagination">
						<span
							>Rows {visiblePage * pageSize + 1}–{Math.min(
								(visiblePage + 1) * pageSize,
								rows.length
							)} of {rows.length}</span
						>
						<div>
							<button
								type="button"
								disabled={visiblePage === 0}
								onclick={() => {
									rowPage = visiblePage - 1;
								}}>Previous rows</button
							><button
								type="button"
								disabled={visiblePage >= pageCount - 1}
								onclick={() => {
									rowPage = visiblePage + 1;
								}}>Next rows</button
							>
						</div>
					</div>
				{/if}
				<div class="source-notes">
					{#each [primary, ...(comparison ? [comparison] : [])] as dataset (dataset.id)}
						<section>
							<h3>{dataset.title}</h3>
							<p>{dataset.sourceNote}</p>
							{#if dataset.sourceUrl}
								<a href={dataset.sourceUrl} target="_blank" rel="noreferrer"
									>{dataset.sourceTitle} ↗</a
								>
							{:else}
								<p>{dataset.sourceTitle} · source link not retained</p>
							{/if}
							{#if dataset.limitations.length}<ul>
									{#each dataset.limitations as limitation (limitation)}<li>{limitation}</li>{/each}
								</ul>{/if}
						</section>
					{/each}
				</div>
			</details>
		{/if}

		<section class="story-note" aria-label="Your data story">
			<div class="note-heading">
				<h3>Your observation</h3>
				<span>Written by you · separate from the source data</span>
			</div>
			<div class="note-fields">
				<label
					>Story title<input
						type="text"
						bind:value={title}
						maxlength="120"
						placeholder={proposedTitle}
					/></label
				>
				<label
					>What do you notice?<textarea
						bind:value={observation}
						maxlength="1200"
						rows="3"
						placeholder="Describe a pattern, a surprising difference, or a question to investigate."
					></textarea></label
				>
			</div>
			<div class="save-row">
				<p>
					Save your selected datasets, comparison, chart type and note in this browser. No one else
					receives them.
				</p>
				<div>
					<button type="button" class="text-button" onclick={newStory}
						><Plus size={16} /> New story</button
					><button
						type="button"
						class="primary-button"
						onclick={saveStory}
						disabled={!chartDataset || !mounted || !!storageError}
						><Save size={16} />{selectedStoryId ? 'Update saved story' : 'Save story'}</button
					>
				</div>
			</div>
		</section>
	{/if}

	<div class="story-message" role="status" aria-live="polite">{message}</div>
	{#if storageError}
		<div class="storage-warning">
			<p>{storageError}</p>
			{#if preservedStorage}<div>
					<button
						type="button"
						onclick={() =>
							download(
								preservedStorage,
								'saved-data-stories-browser-copy.json',
								'application/json'
							)}><Download size={16} />Download browser copy</button
					><button type="button" onclick={resetStoredStories}>Reset saved story storage</button>
				</div>{/if}
		</div>
	{/if}
	{#if stories.length}
		<section class="saved-stories" aria-label="Saved data stories">
			<header>
				<h3>Saved in this browser</h3>
				<span>{stories.length} {stories.length === 1 ? 'story' : 'stories'}</span>
			</header>
			<ul>
				{#each stories as story (story.id)}<li class:current={selectedStoryId === story.id}>
						<button class="load-story" type="button" onclick={() => openStory(story)}
							><strong>{story.title}</strong><span
								>Updated {new Intl.DateTimeFormat('en-GB', {
									day: 'numeric',
									month: 'short',
									year: 'numeric',
									timeZone: 'Indian/Maldives'
								}).format(new Date(story.updatedAt))}{selectedStoryId === story.id
									? ' · Open now'
									: ''}</span
							></button
						><button
							class="delete-story"
							type="button"
							aria-label={`Delete saved story: ${story.title}`}
							onclick={() => deleteStory(story)}
							disabled={!!storageError}><Trash2 size={16} /></button
						>
					</li>{/each}
			</ul>
		</section>
	{/if}
</section>

<style>
	.comparison-starters {
		margin-bottom: 24px;
	}
	.starter-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 12px;
	}
	.starter-heading h3 {
		font-size: 14px;
		font-weight: 600;
		margin: 0;
		color: #223740;
	}
	.starter-heading span {
		font-size: 12px;
		color: #647381;
	}
	.starter-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 12px;
	}
	.starter-grid button {
		display: block;
		text-align: left;
		padding: 16px;
		min-height: 112px;
		border: 1px solid #dce3e8;

		border-radius: var(--surface-radius-inner, 16px);
		background: #fff;
		color: #223740;
		cursor: pointer;
		font: inherit;
		transition: transform 160ms ease-out;
	}
	.starter-grid button.chosen {
		border-color: #087f78;
		background: #f0f7f6;
	}
	.starter-grid strong {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		font-size: 13px;
		font-weight: 600;
		line-height: 1.5;
	}
	.starter-grid strong :global(svg) {
		flex-shrink: 0;
		margin-top: 2px;
	}
	.starter-grid span {
		display: block;
		margin-top: 8px;
		color: #647381;
		font-size: 11px;
		line-height: 1.5;
	}
	.starter-grid button:active {
		transform: scale(0.98);
	}
	.starter-grid button:focus-visible {
		outline: 3px solid #087f78;
		outline-offset: 3px;
	}
	@media (max-width: 850px) {
		.starter-grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.starter-grid button {
			min-height: 0;
		}
	}
	@media (max-width: 600px) {
		.starter-heading {
			display: block;
		}
		.starter-heading span {
			display: block;
			margin-top: 6px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.starter-grid button {
			transition: none;
		}
		.starter-grid button:active {
			transform: none;
		}
	}
	.story-workspace {
		color: var(--ws-ink, #172b3a);
	}
	.builder-intro,
	.note-heading,
	.save-row,
	.records-toolbar,
	.pagination,
	.saved-stories header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 20px;
	}
	h2,
	h3,
	p {
		margin: 0;
	}
	h2 {
		font-size: 23px;
		font-weight: 650;
		letter-spacing: -0.5px;
	}
	h3 {
		font-size: 16px;
		font-weight: 650;
	}
	.builder-intro p {
		margin-top: 7px;
		color: var(--ws-muted, #647381);
		font-size: 14px;
		line-height: 1.6;
	}
	.builder-layout {
		display: grid;
		grid-template-columns: 280px minmax(0, 1fr);
		margin-top: 24px;
		border: 1px solid var(--ws-border, #dde3e9);

		border-radius: var(--surface-radius, 28px);
		background: #fff;
		overflow: hidden;
		box-shadow: var(--surface-shadow);
	}
	.builder-controls {
		padding: 24px;
		background: #fafbfc;
		border-right: 1px solid var(--ws-border, #dde3e9);
		min-width: 0;
	}
	.settings-summary {
		display: none;
	}
	.settings-fields > label {
		display: block;
		font-size: 12px;
		font-weight: 650;
		margin: 20px 0 8px;
	}
	.settings-fields > label:first-child {
		margin-top: 0;
	}
	select,
	input,
	textarea {
		width: 100%;
		min-width: 0;
		color: inherit;
		border: 1px solid #cdd6de;

		border-radius: var(--surface-radius-field, 14px);
		font: inherit;
		background: white;
	}
	select {
		min-height: 44px;
		padding: 9px 28px 9px 10px;
		font-size: 13px;
	}
	select:disabled {
		background: #f2f4f6;
		color: #62717e;
	}
	.control-help {
		margin-top: 8px;
		font-size: 12px;
		line-height: 1.6;
		color: #647381;
	}
	.control-help.selection-description {
		color: #284352;
		font-weight: 500;
	}
	.join-explainer {
		border-top: 1px solid #e2e7ec;
		margin-top: 24px;
		padding-top: 12px;
		font-size: 12px;
	}
	summary {
		cursor: pointer;
		font-weight: 600;
		min-height: 44px;
		align-content: center;
	}
	.join-explainer p {
		margin-top: 10px;
		line-height: 1.6;
		color: #647381;
	}
	.join-explainer ul {
		padding-left: 0;
		list-style: none;
		margin: 14px 0 0;
		max-height: 310px;
		overflow: auto;
	}
	.join-explainer li {
		margin-bottom: 14px;
	}
	.join-explainer li span {
		display: block;
		margin-top: 4px;
		color: #647381;
		line-height: 1.5;
	}
	.builder-preview {
		padding: 24px;
		min-width: 0;
	}
	.preview-meta {
		display: flex;
		gap: 12px;
		justify-content: space-between;
		font-size: 11px;
		color: #647381;
		margin-bottom: 12px;
	}
	.preview-title {
		font-size: 18px;
		line-height: 1.45;
		letter-spacing: -0.25px;
		margin-bottom: 16px;
	}
	.coverage-note {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 12px;
		border-top: 1px solid #e4e9ee;
		padding-top: 15px;
		margin-top: 16px;
		font-size: 12px;
		line-height: 1.6;
		color: #647381;
	}
	.coverage-note strong {
		color: #284352;
		font-weight: 600;
	}
	.chart-cautions {
		margin-top: 12px;
		padding: 10px 12px;
		border-left: 2px solid #c99a4c;
		background: #faf8f3;
		color: #725a32;
		font-size: 12px;
		line-height: 1.6;
		border-radius: var(--surface-radius-inner, 16px);
	}
	.chart-cautions p + p {
		margin-top: 5px;
	}
	.empty-state {
		padding: 30px;
		border: 1px solid #dde3e9;

		border-radius: var(--surface-radius, 28px);
		background: #fff;
		margin-top: 20px;
		box-shadow: var(--surface-shadow);
	}
	.empty-state p {
		margin-top: 9px;
		color: #647381;
		font-size: 14px;
		line-height: 1.6;
		max-width: 500px;
	}
	.invalid-chart {
		border: none;
		min-height: 300px;
		display: flex;
		flex-direction: column;
		justify-content: center;
		align-items: flex-start;
	}
	.invalid-chart button {
		margin-top: 18px;
	}
	button {
		min-height: 44px;
		display: inline-flex;
		justify-content: center;
		align-items: center;
		gap: 8px;
		border: 1px solid #cdd6de;

		border-radius: var(--surface-radius-pill, 999px);
		padding: 8px 13px;
		color: #284352;
		background: #fff;
		font: inherit;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		transition:
			background 150ms ease,
			transform 100ms ease-out;
	}
	button:hover:not(:disabled) {
		background: #f1f5f7;
	}
	button:active:not(:disabled) {
		transform: scale(0.98);
	}
	button:disabled {
		cursor: default;
		color: #7b8791;
		background: #f4f6f8;
		opacity: 0.75;
	}
	button:focus-visible,
	select:focus-visible,
	input:focus-visible,
	textarea:focus-visible,
	summary:focus-visible,
	a:focus-visible {
		outline: 2px solid #087f78;
		outline-offset: 3px;
	}
	.text-button {
		border-color: transparent;
		background: transparent;
	}
	.primary-button {
		color: #fff;
		background: #087f78;
		border-color: #087f78;
	}
	.primary-button:hover:not(:disabled) {
		background: #066a64;
	}
	.exact-records {
		margin-top: 14px;
		background: #fff;
		border: 1px solid #dde3e9;

		border-radius: var(--surface-radius, 28px);
		padding: 0 20px;
		box-shadow: var(--surface-shadow);
	}
	.exact-records > summary {
		padding: 8px 0;
		font-size: 13px;
	}
	.exact-records > summary span {
		margin-left: 8px;
		color: #647381;
		font-weight: 400;
	}
	.records-toolbar {
		border-top: 1px solid #e3e8ed;
		padding: 16px 0;
		align-items: flex-start;
	}
	.records-toolbar p {
		max-width: 570px;
		font-size: 12px;
		line-height: 1.6;
		color: #647381;
	}
	.records-toolbar button {
		flex-shrink: 0;
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
		padding: 11px 12px;
		text-align: left;
		border-bottom: 1px solid #e5e9ed;
		vertical-align: top;
	}
	thead th {
		background: #f8fafb;
		color: #586b79;
		font-weight: 600;
	}
	tbody th {
		font-weight: 500;
		white-space: nowrap;
	}
	.numeric {
		text-align: right;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.source-reference {
		font-size: 11px;
		color: #647381;
		overflow-wrap: anywhere;
		max-width: 240px;
	}
	.pagination {
		margin: 14px 0;
		font-size: 12px;
		color: #647381;
	}
	.pagination > div,
	.save-row > div,
	.storage-warning > div {
		display: flex;
		gap: 8px;
	}
	.source-notes {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr));
		gap: 24px;
		margin: 20px 0;
	}
	.source-notes h3 {
		font-size: 13px;
		margin-bottom: 7px;
	}
	.source-notes p,
	.source-notes li,
	.source-notes a {
		font-size: 12px;
		line-height: 1.6;
	}
	.source-notes p,
	.source-notes li {
		color: #647381;
	}
	.source-notes a {
		color: #087f78;
		text-underline-offset: 3px;
	}
	.source-notes ul {
		padding-left: 16px;
		margin: 8px 0;
	}
	.story-note {
		margin-top: 26px;
		padding-top: 24px;
		border-top: 1px solid #dde3e9;
	}
	.note-heading span {
		color: #647381;
		font-size: 12px;
	}
	.note-fields {
		margin-top: 16px;
		display: grid;
		grid-template-columns: minmax(200px, 0.85fr) minmax(0, 1.4fr);
		gap: 20px;
	}
	.note-fields label {
		display: block;
		font-size: 12px;
		font-weight: 600;
	}
	input,
	textarea {
		display: block;
		margin-top: 8px;
		padding: 11px 12px;
		font-size: 14px;
		font-weight: 400;
		min-height: 44px;
	}
	textarea {
		resize: vertical;
		line-height: 1.5;
		min-height: 104px;
	}
	.save-row {
		margin-top: 16px;
	}
	.save-row p {
		font-size: 12px;
		color: #647381;
		max-width: 450px;
		line-height: 1.6;
	}
	.story-message {
		min-height: 24px;
		margin-top: 10px;
		color: #43665e;
		font-size: 12px;
		line-height: 1.7;
	}
	.storage-warning {
		padding: 14px 16px;
		background: #faf8f3;
		border: 1px solid #e4d8c3;

		border-radius: var(--surface-radius-inner, 16px);
		margin-top: 10px;
		font-size: 12px;
		line-height: 1.6;
		color: #725a32;
	}
	.storage-warning > div {
		margin-top: 10px;
		flex-wrap: wrap;
	}
	.saved-stories {
		margin-top: 20px;
	}
	.saved-stories header span {
		color: #647381;
		font-size: 12px;
	}
	.saved-stories ul {
		padding: 0;
		list-style: none;
		margin: 12px 0 0;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(270px, 100%), 1fr));
		gap: 10px;
	}
	.saved-stories li {
		display: flex;
		align-items: center;
		border: 1px solid #dde3e9;

		border-radius: var(--surface-radius-inner, 16px);
		background: #fff;
		padding-right: 6px;
		min-width: 0;
	}
	.saved-stories li.current {
		border-color: #76a49e;
		background: #f4f9f8;
	}
	.load-story {
		flex: 1;
		min-width: 0;
		border: 0;
		background: transparent;

		border-radius: var(--surface-radius-inner, 16px);
		display: block;
		text-align: left;
		padding: 14px;
	}
	.load-story strong {
		display: block;
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.load-story span {
		display: block;
		font-size: 11px;
		margin-top: 7px;
		color: #647381;
		font-weight: 400;
	}
	.delete-story {
		flex-shrink: 0;
		width: 44px;
		padding: 0;
		border: none;
		background: transparent;
	}
	@media (max-width: 1000px) {
		.builder-layout {
			grid-template-columns: 245px minmax(0, 1fr);
		}
		.builder-controls,
		.builder-preview {
			padding: 20px;
		}
		.note-heading {
			align-items: flex-start;
		}
		.note-heading span {
			max-width: 220px;
			text-align: right;
			line-height: 1.5;
		}
	}
	@media (max-width: 760px) {
		.builder-layout {
			grid-template-columns: minmax(0, 1fr);
		}
		.builder-controls {
			border-right: none;
			border-bottom: 1px solid #dde3e9;
			padding: 8px 18px;
		}
		.settings-summary {
			display: flex;
			align-items: center;
			justify-content: space-between;
			font-size: 13px;
			min-height: 44px;
		}
		.disclosure-mark {
			font-size: 22px;
			color: #647381;
		}
		.builder-controls[open] .disclosure-mark {
			transform: rotate(180deg);
		}
		.settings-fields {
			padding: 10px 0 12px;
		}
		.settings-fields > label {
			margin-top: 16px;
		}
		.builder-preview {
			padding: 18px 14px;
		}
		.note-fields {
			grid-template-columns: minmax(0, 1fr);
			gap: 16px;
		}
		.save-row,
		.records-toolbar {
			align-items: flex-start;
			flex-direction: column;
			gap: 12px;
		}
		.save-row > div {
			width: 100%;
			justify-content: flex-end;
		}
		.builder-intro {
			align-items: flex-start;
			gap: 12px;
		}
		.builder-intro > button {
			display: none;
		}
	}
	@media (max-width: 440px) {
		h2 {
			font-size: 21px;
		}
		.builder-controls {
			padding: 8px 18px;
		}
		.builder-intro {
			flex-direction: column;
			gap: 4px;
		}
		.builder-intro > button {
			max-width: none;
		}
		.note-heading {
			flex-direction: column;
			gap: 7px;
		}
		.note-heading span {
			text-align: left;
			max-width: none;
		}
		.exact-records {
			padding: 0 14px;
		}
		.pagination {
			flex-direction: column;
			align-items: flex-start;
			gap: 10px;
		}
		.pagination > div {
			width: 100%;
		}
		.pagination button {
			flex: 1;
			padding: 8px 10px;
			font-size: 12px;
		}
		.save-row > div {
			justify-content: space-between;
		}
		.save-row button {
			font-size: 12px;
			padding: 8px 10px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		button {
			transition: none;
		}
		button:active:not(:disabled) {
			transform: none;
		}
	}

	@media (max-width: 600px) {
		.builder-layout,
		.empty-state,
		.exact-records {
			border-radius: var(--surface-radius-mobile, 24px);
		}
	}
</style>
