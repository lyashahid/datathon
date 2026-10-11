<script lang="ts">
	import { ArrowLeft, ArrowRight, ExternalLink } from '@lucide/svelte';
	import { onMount, tick } from 'svelte';
	import type {
		ForecastBundle,
		MonthlyForecast,
		ForecastIssueView
	} from '#lib/prediction/index.ts';
	import { headlineForecast, forecastCaution } from './forecastPresentation.ts';
	import { captureForecastSvg } from './forecastChartCapture.ts';
	import { buildForecastChart } from './forecastChart.ts';
	import ForecastAccuracy from './ForecastAccuracy.svelte';
	import { indexMonth, monthIndex } from '#lib/prediction/monthly.ts';
	let {
		prediction,
		embedded = false,
		onselectSeries,
		targetMonth,
		selectedSeriesId,
		onTargetMonthChange,
		onSeriesChange,
		onShowOnMap,
		onShowEvidence
	}: {
		prediction: ForecastBundle | null;
		embedded?: boolean;
		onselectSeries?: (series: MonthlyForecast | null) => void;
		targetMonth?: string;
		selectedSeriesId?: string;
		onTargetMonthChange?: (month: string) => void;
		onSeriesChange?: (seriesId: string) => void;
		onShowOnMap?: (series: MonthlyForecast) => void;
		onShowEvidence?: () => void;
	} = $props();
	let seriesId = $state('');
	let localTarget = $state('');
	let loadedPrediction = $state<ForecastBundle | null>(null);
	let loading = $state(false);
	let error = $state('');
	let issueMessage = $state('');
	let issuing = $state(false);
	let issues = $state<ForecastIssueView[]>([]);
	let reviewOwner = $state('');
	let reviewPurpose = $state('Reconcile the monthly category before reviewing staffing or budget');
	let reviewChecks = $state<string[]>([]);
	let reviewMessage = $state('');
	let reviewDate = $state('');
	let underPlanningCost = $state('');
	let overPlanningCost = $state('');
	let reviewRecord = $state<{
		owner: string;
		purpose: string;
		reviewDate: string | null;
		completedChecks: string[];
		outstandingChecks: string[];
	} | null>(null);
	let reviewOpen = $state(false);
	let reviewElement = $state<HTMLDetailsElement | null>(null);
	const checklist = [
		'Confirm category definitions and reconcile with operator counts',
		'Inspect current route, direction and peak-period passenger loads',
		'Check fleet, staffing, operating costs and the decision lead time',
		'Compare the latest-month benchmark and record the cost of over- or under-planning',
		'Agree a review date and accountable owner before any resource change'
	];
	const desiredMonth = $derived(
		targetMonth ||
			localTarget ||
			prediction?.target?.month ||
			prediction?.monthly[0]?.forecastMonth ||
			''
	);
	const bundle = $derived(
		loadedPrediction?.target?.month === desiredMonth
			? loadedPrediction
			: (prediction?.target?.month ?? prediction?.monthly[0]?.forecastMonth) === desiredMonth
				? prediction
				: null
	);
	const targetPending = $derived(!!desiredMonth && !bundle && !error);
	const currentMonth = $derived(
		bundle?.target?.currentMonthMvt || prediction?.target?.currentMonthMvt || ''
	);
	$effect(() => {
		const requested = desiredMonth;
		if (!requested || prediction?.target?.month === requested) {
			loadedPrediction = null;
			loading = false;
			error = '';
			return;
		}
		const controller = new AbortController();
		loading = true;
		error = '';
		fetch(`/api/prediction?targetMonth=${encodeURIComponent(requested)}`, {
			signal: controller.signal
		})
			.then(async (response) => {
				if (!response.ok) throw new Error('Could not load the selected forecast month.');
				loadedPrediction = await response.json();
			})
			.catch((reason) => {
				if (!controller.signal.aborted) error = String(reason.message ?? reason);
			})
			.finally(() => {
				if (!controller.signal.aborted) loading = false;
			});
		return () => controller.abort();
	});
	async function refreshIssues() {
		const response = await fetch('/api/prediction/issues');
		if (!response.ok) throw new Error('Could not read the forecast issue ledger.');
		issues = (await response.json()).issues;
	}
	onMount(() => {
		refreshIssues().catch((reason) => {
			issueMessage = String(reason.message ?? reason);
		});
	});
	async function freezeIssue() {
		if (!bundle || loading || error) {
			issueMessage = 'Wait for the selected target forecast before issuing.';
			return;
		}
		issuing = true;
		try {
			const response = await fetch('/api/prediction/issues', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ targetMonth: desiredMonth })
			});
			const result = await response.json();
			if (!response.ok) throw new Error(result.error);
			issueMessage = result.created
				? 'Forecast issue frozen. All three categories and four benchmark estimates are preserved.'
				: 'This source, target and issue day already have a frozen record; the original was preserved.';
			await refreshIssues();
		} catch (reason) {
			issueMessage = reason instanceof Error ? reason.message : String(reason);
		} finally {
			issuing = false;
		}
	}
	async function recordScores(issueId: string) {
		try {
			const response = await fetch('/api/prediction/issues', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'record-scores', issueId })
			});
			const result = await response.json();
			if (!response.ok) throw new Error(result.error);
			issueMessage = result.created
				? 'Later-vintage score receipt preserved alongside the original issue.'
				: 'This scoring vintage is already preserved.';
			await refreshIssues();
		} catch (reason) {
			issueMessage = reason instanceof Error ? reason.message : String(reason);
		}
	}
	function prepareReview() {
		if (!series || !reviewOwner.trim()) {
			reviewMessage = 'Add an accountable reviewer before saving the review.';
			return null;
		}
		const record = {
			createdAt: new Date().toISOString(),
			owner: reviewOwner.trim(),
			purpose: reviewPurpose,
			reviewDate: reviewDate || null,
			underPlanningCost: underPlanningCost.trim() || 'Not yet provided by operator',
			overPlanningCost: overPlanningCost.trim() || 'Not yet provided by operator',
			seriesId: series.seriesId,
			geography: series.geography,
			targetMonth: series.forecastMonth,
			sourceAsOf: bundle?.sourceAsOf,
			provenance: bundle?.provenance,
			forecastEstimate: series.estimate,
			model: series.model,
			benchmarkEstimates: series.benchmarks.map((item) => ({
				model: item.model,
				estimate: item.estimate
			})),
			modelCaution: caution,
			completedChecks: reviewChecks,
			outstandingChecks: checklist.filter((item) => !reviewChecks.includes(item)),
			qualification:
				'Operator review notes only. Monthly aggregate forecasts cannot establish route loads, congestion, occupancy or resource requirements.'
		};
		reviewRecord = record;
		reviewMessage =
			'Review prepared. Resolve the outstanding evidence with the operator before changing resources.';
		return record;
	}
	async function openResourceReview() {
		reviewOpen = true;
		await tick();
		reviewElement?.scrollIntoView({ block: 'start' });
		reviewElement?.querySelector('input')?.focus({ preventScroll: true });
	}
	function downloadReview() {
		const record = prepareReview();
		if (!record) return;
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(record, null, 2)], { type: 'application/json' })
		);
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = `resource-review-${record.seriesId}-${record.targetMonth}.json`;
		anchor.click();
		URL.revokeObjectURL(url);
		reviewMessage =
			'Review downloaded with the outstanding evidence checks. No resource change is authorized by this record.';
	}
	let chartSvg = $state<SVGSVGElement | null>(null);
	export async function captureChart(): Promise<string | undefined> {
		return series && chartSvg ? captureForecastSvg(chartSvg) : undefined;
	}
	const series = $derived(
		bundle?.monthly.find((item) => item.seriesId === (selectedSeriesId || seriesId)) ??
			headlineForecast(bundle?.monthly ?? []) ??
			bundle?.monthly[0] ??
			null
	);
	$effect(() => {
		// Evidence checks are specific to this source category and planning target.
		void desiredMonth;
		void series?.seriesId;
		inspectedMonth = '';
		reviewChecks = [];
		reviewMessage = '';
		reviewDate = '';
		underPlanningCost = '';
		overPlanningCost = '';
		reviewRecord = null;
	});
	const lastRecorded = $derived(series?.history.at(-1));
	const caution = $derived(series ? forecastCaution(series) : null);
	const busSourceNote = $derived(
		bundle?.dataQualityNotes.find((note) => /bus.*quarantin|quarantin.*bus/i.test(note)) ?? null
	);
	const countCaveat = $derived(
		series?.mode === 'ferry' && series.geography.toLowerCase().includes('endpoint')
			? 'This is one published ferry endpoint total. Keep the endpoint categories separate; their boarding and direction definitions are not confirmed.'
			: series?.mode === 'bus'
				? busSourceNote && /repeat.*exactly/i.test(busSourceNote)
					? 'The next published bus totals repeat the previous month exactly. Those totals are excluded until the publisher confirms whether they are new observations.'
					: busSourceNote
				: null
	);
	const estimatedDifference = $derived(
		series?.estimate != null && lastRecorded ? series.estimate - lastRecorded.value : null
	);
	const latestMonthBenchmark = $derived(
		series?.benchmarks.find((benchmark) => benchmark.model === 'last-month') ?? null
	);
	const coveredHistoricalTotals = $derived(
		series?.empiricalRange && series.evaluation
			? Math.round(series.empiricalRange.historicalCoverage * series.evaluation.n)
			: null
	);
	const modelLabel = (value: string | null) =>
		({
			'last-month': 'Latest recorded month',
			'seasonal-naive': 'Same month a year earlier',
			'mean-3-months': 'Average of three recent months',
			'mean-6-months': 'Average of six recent months'
		})[value ?? ''] ?? 'Unavailable';
	const count = (value: number | null | undefined) =>
		value == null ? 'Not available' : Math.round(value).toLocaleString('en-GB');
	function month(value: string) {
		return new Date(`${value}-01T00:00:00Z`).toLocaleDateString('en-GB', {
			month: 'short',
			year: 'numeric',
			timeZone: 'UTC'
		});
	}
	function sourceDate(value: string) {
		const parsed = new Date(value);
		return Number.isFinite(parsed.getTime())
			? parsed.toLocaleDateString('en-GB', {
					day: 'numeric',
					month: 'short',
					year: 'numeric',
					timeZone: 'Indian/Maldives'
				})
			: value;
	}
	let chartWidth = $state(740);
	let historyWindow = $state<number | null>(24);
	let analyticalView = $state<'outlook' | 'accuracy'>('outlook');
	const figure = $derived(buildForecastChart(series, chartWidth, historyWindow));
	const maximumTargetMonth = $derived(
		series ? indexMonth(monthIndex(series.lastActualMonth) + 12) : undefined
	);
	let inspectedMonth = $state('');
	const inspectedPoint = $derived(
		figure?.points.find((point) => point.month === inspectedMonth) ??
			figure?.points.find((point) => point.month === series?.forecastMonth) ??
			figure?.points.at(-1) ??
			null
	);
	function inspectAdjacentMonth(offset: number) {
		if (!figure || !inspectedPoint) return;
		const index = figure.points.findIndex((point) => point.month === inspectedPoint.month);
		const next = Math.max(0, Math.min(figure.points.length - 1, index + offset));
		inspectedMonth = figure.points[next].month;
	}
	$effect(() => {
		onselectSeries?.(series);
	});
</script>

<section class="outlook" data-testid="plan-ahead-panel">
	{#if embedded}
		<h2 class="visually-hidden">Passenger outlook</h2>
	{:else}
		<header class="page-intro">
			<div>
				<h1>Passenger outlook</h1>
				<p>
					Explore monthly passenger estimates alongside the recorded history and prediction
					accuracy.
				</p>
			</div>
			<span class="page-classification">Official totals · exploratory estimates</span>
		</header>
	{/if}

	<div class="selection-bar">
		<div class="category-control">
			<span class="control-label">Passenger category</span>
			{#if (bundle ?? prediction)?.monthly.length}
				<div class="series-picker" aria-label="Passenger series">
					{#each (bundle ?? prediction)!.monthly as item (item.seriesId)}
						<button
							type="button"
							class:active={(series?.seriesId ||
								selectedSeriesId ||
								seriesId ||
								prediction?.monthly[0]?.seriesId) === item.seriesId}
							aria-pressed={(series?.seriesId ||
								selectedSeriesId ||
								seriesId ||
								prediction?.monthly[0]?.seriesId) === item.seriesId}
							onclick={() => {
								seriesId = item.seriesId;
								onSeriesChange?.(item.seriesId);
							}}
							data-testid={'forecast-series-' + item.seriesId}>{item.name}</button
						>
					{/each}
				</div>
			{:else}<span class="control-empty">Categories unavailable</span>{/if}
		</div>
		<label class="month-control" for="forecast-target-month">
			<span class="control-label">Planning month</span>
			<input
				id="forecast-target-month"
				type="month"
				value={desiredMonth}
				min={currentMonth}
				max={maximumTargetMonth}
				onchange={(event) => {
					localTarget = event.currentTarget.value;
					onTargetMonthChange?.(localTarget);
				}}
			/>
		</label>
	</div>

	{#if series}
		<div class="analytical-controls">
			<div class="analytical-views" aria-label="Forecast analytical view">
				<button
					type="button"
					class:active={analyticalView === 'outlook'}
					aria-pressed={analyticalView === 'outlook'}
					onclick={() => (analyticalView = 'outlook')}>Passenger outlook</button
				>
				<button
					type="button"
					class:active={analyticalView === 'accuracy'}
					aria-pressed={analyticalView === 'accuracy'}
					onclick={() => (analyticalView = 'accuracy')}
					>Accuracy checks <span>{series.backtest.length}</span></button
				>
			</div>
			<div class="target-context">
				{#if embedded}<span class="target-classification"
						>Official totals · exploratory estimates</span
					>{/if}
				<span class="target-lag"
					>Latest recorded {month(series.lastActualMonth)} · {series.horizonMonths}-month evidence
					gap</span
				>
			</div>
		</div>
		<div class="analysis-grid">
			{#if analyticalView === 'outlook'}
				<section class="forecast-surface" aria-label="Selected passenger outlook">
					<div class="surface-heading">
						<div>
							<span class="section-label"
								>{desiredMonth === currentMonth
									? 'Current month estimate'
									: desiredMonth > currentMonth
										? 'Future month estimate'
										: 'Retrospective preview'}</span
							>
							<h2>{month(series.forecastMonth)}</h2>
						</div>
						{#if onShowOnMap}
							<button class="quiet-button" type="button" onclick={() => onShowOnMap?.(series)}>
								Show geography on map <ArrowRight size={14} aria-hidden="true" />
							</button>
						{/if}
					</div>
					<div class="estimate-row">
						<div class="estimate-block">
							<div class="estimate" data-testid="monthly-forecast-estimate">
								{count(series.estimate)}
							</div>
							<p>passenger movements <span>· not unique people</span></p>
						</div>
						{#if lastRecorded && estimatedDifference != null}
							<div class="comparison">
								<span>Compared with the last recorded month</span>
								<strong
									>{estimatedDifference >= 0 ? '+' : '−'}{count(Math.abs(estimatedDifference))} movements</strong
								>
								<p>
									{count(lastRecorded.value)} recorded in {month(lastRecorded.month)}. Difference is
									estimated, not measured growth.
								</p>
							</div>
						{/if}
					</div>
					{#if series.unavailableReason}<p class="inline-warning">
							{series.unavailableReason}
						</p>{/if}
					<div class="chart-title">
						<h3>Recorded totals and monthly estimates</h3>
						<span>Monthly passenger movements</span>
					</div>
					<div class="history-window">
						<span>Recorded history</span>
						<div aria-label="Recorded history shown in chart">
							{#each [{ label: '12 months', value: 12 }, { label: '24 months', value: 24 }, { label: 'All history', value: null }] as option (option.label)}
								<button
									type="button"
									class:active={historyWindow === option.value}
									aria-pressed={historyWindow === option.value}
									onclick={() => {
										historyWindow = option.value;
										inspectedMonth = '';
									}}>{option.label}</button
								>
							{/each}
						</div>
					</div>
					<div class="chart-region" bind:clientWidth={chartWidth}>
						{#if figure}
							<svg
								bind:this={chartSvg}
								viewBox={'0 0 ' + figure.width + ' ' + figure.height}
								role="img"
								aria-label={'Recorded monthly passenger movements and forecast for ' + series.name}
							>
								<title>Official passenger history and projected totals for {series.name}</title>
								<desc
									>Dashed values after {month(series.lastActualMonth)} are estimates, not recorded use.
									The selected {month(series.forecastMonth)} estimate is {count(series.estimate)} passenger
									movements.</desc
								>
								{#if figure.lastActualX >= figure.bounds.left}
									<rect
										x={figure.lastActualX}
										y={figure.bounds.top}
										width={Math.max(0, figure.bounds.right - figure.lastActualX)}
										height={figure.bounds.bottom - figure.bounds.top}
										fill="#f0f6f5"
									/>
								{/if}
								{#each [0, 0.5, 1] as fraction (fraction)}
									<line
										x1={figure.bounds.left}
										y1={figure.y(figure.ymax * fraction)}
										x2={figure.bounds.right}
										y2={figure.y(figure.ymax * fraction)}
										stroke="#e2e7ed"
									/>
									<text
										x={figure.bounds.left - 13}
										y={figure.y(figure.ymax * fraction) + 4}
										text-anchor="end">{count(figure.ymax * fraction)}</text
									>
								{/each}
								{#if figure.lastActualX >= figure.bounds.left}
									<line
										x1={figure.lastActualX}
										y1={figure.bounds.top}
										x2={figure.lastActualX}
										y2={figure.bounds.bottom}
										stroke="#a9babd"
										stroke-dasharray="4 5"
									/>
								{/if}
								<path
									d={figure.actual}
									fill="none"
									stroke="#536a78"
									stroke-width="2.4"
									stroke-linejoin="round"
								/>
								<path
									d={figure.forecast}
									fill="none"
									stroke="#087f78"
									stroke-width="2.6"
									stroke-dasharray="6 5"
									stroke-linejoin="round"
								/>
								{#each figure.points as point (point.month)}
									<circle
										cx={figure.x(point.month)}
										cy={figure.y(point.value)}
										r="9"
										fill="transparent"
										role="img"
										aria-label={month(point.month) +
											': ' +
											count(point.value) +
											' ' +
											point.kind.toLowerCase() +
											' movements'}
										onpointerenter={() => (inspectedMonth = point.month)}
									>
										<title
											>{month(point.month)}: {count(point.value)} movements · {point.kind}</title
										>
									</circle>
								{/each}
								{#if series.empiricalRange && figure.targetX >= figure.bounds.left}
									<line
										x1={figure.targetX}
										x2={figure.targetX}
										y1={figure.y(series.empiricalRange.lower)}
										y2={figure.y(series.empiricalRange.upper)}
										stroke="#a7ccc7"
										stroke-width="9"
										stroke-linecap="round"
									/>
								{/if}
								{#if series.estimate != null && figure.targetX >= figure.bounds.left}
									<circle
										cx={figure.targetX}
										cy={figure.y(series.estimate)}
										r="4.5"
										fill="#087f78"
										stroke="white"
										stroke-width="2"
									/>
								{/if}
								{#if inspectedPoint}
									<line
										x1={figure.x(inspectedPoint.month)}
										x2={figure.x(inspectedPoint.month)}
										y1={figure.bounds.top}
										y2={figure.bounds.bottom}
										stroke="#b5c5c9"
										stroke-dasharray="2 4"
									/>
									<circle
										cx={figure.x(inspectedPoint.month)}
										cy={figure.y(inspectedPoint.value)}
										r="4"
										fill={inspectedPoint.kind === 'Recorded' ? '#536a78' : '#087f78'}
										stroke="white"
										stroke-width="2"
									/>
								{/if}
								{#each figure.ticks as tick, index (tick.x)}
									<text
										x={tick.x}
										y="244"
										text-anchor={index === 0
											? 'start'
											: index === figure.ticks.length - 1
												? 'end'
												: 'middle'}>{month(tick.month)}</text
									>
								{/each}
							</svg>
						{:else}
							<div class="chart-empty">A chart needs at least two usable monthly observations.</div>
						{/if}
					</div>
					{#if inspectedPoint && figure}
						<div class="point-inspector">
							<div>
								<select
									aria-label="Inspect a recorded or estimated month"
									value={inspectedPoint.month}
									onchange={(event) => (inspectedMonth = event.currentTarget.value)}
								>
									{#each figure.points as point (point.month)}<option value={point.month}
											>{month(point.month)} · {point.kind}</option
										>{/each}
								</select>
								<strong>{count(inspectedPoint.value)}</strong><span
									>{inspectedPoint.kind} movements</span
								>
							</div>
							<div class="point-navigation">
								<button
									type="button"
									aria-label="Inspect previous month"
									disabled={inspectedPoint.month === figure.points[0].month}
									onclick={() => inspectAdjacentMonth(-1)}
									><ArrowLeft size={14} aria-hidden="true" /></button
								>
								<button
									type="button"
									aria-label="Inspect next month"
									disabled={inspectedPoint.month === figure.points.at(-1)?.month}
									onclick={() => inspectAdjacentMonth(1)}
									><ArrowRight size={14} aria-hidden="true" /></button
								>
							</div>
						</div>
					{/if}
					<div class="chart-footer">
						<div class="legend">
							<span><i></i>Recorded</span>
							<span><i class="dashed"></i>Estimated</span>
							{#if series.empiricalRange}<span><i class="range-key"></i>Past-error range</span>{/if}
						</div>
						<span>Latest recorded: <strong>{month(series.lastActualMonth)}</strong></span>
					</div>
					<p class="chart-qualification">
						Showing {figure?.points.filter((point) => point.kind === 'Recorded').length ?? 0} of {series
							.history.length} recorded months. {series.horizonMonths} months separate the latest recorded
						total and this target. Dashed values are unconfirmed estimates.
					</p>
					{#if countCaveat}<p class="count-definition" data-testid="forecast-count-definition">
							{countCaveat}
						</p>{/if}
				</section>
			{:else}
				<ForecastAccuracy {series} />
			{/if}

			<aside class="reliability-panel" aria-label="Forecast reliability">
				<div class="reliability-heading">
					<span class="section-label">Forecast reliability</span>
					<h2>
						{series.status === 'unavailable'
							? 'Estimate unavailable'
							: caution
								? 'Benchmark performed better'
								: 'Experimental estimate'}
					</h2>
				</div>
				{#if caution}
					<p class="reliability-verdict" role="note" data-testid="forecast-model-caution">
						The selected method lost to the latest-month benchmark in later historical checks. It is
						not an established improvement.
					</p>
				{:else}
					<p class="reliability-verdict">
						This is an exploratory estimate. Historical checks do not establish future accuracy.
					</p>
				{/if}
				{#if series.evaluation}
					<dl class="reliability-metrics" data-testid="forecast-validation-summary">
						<div>
							<dt>Selected method average error</dt>
							<dd>{count(series.evaluation.mae)} <span>movements</span></dd>
						</div>
						{#if latestMonthBenchmark}<div>
								<dt>Latest-month benchmark error</dt>
								<dd>{count(latestMonthBenchmark.metrics.mae)} <span>movements</span></dd>
							</div>{/if}
						<div>
							<dt>Historical checks</dt>
							<dd>{series.evaluation.n} <span>later recorded totals</span></dd>
						</div>
					</dl>
					<p class="small-note">
						Checked using revised historical data, not publication-time records. These are
						retrospective results.
					</p>
				{/if}
				{#if series.empiricalRange}
					<div class="range" data-testid="forecast-range">
						<span class="section-label">Range from past forecast errors</span>
						<strong
							>{count(series.empiricalRange.lower)}–{count(series.empiricalRange.upper)}</strong
						>
						<p>
							{coveredHistoricalTotals} of {series.evaluation?.n ??
								series.empiricalRange.residualCount} later totals fell within this range.
						</p>
						<span>This is not a calibrated probability interval or an assured budget bound.</span>
					</div>
				{/if}
				<div class="policy-use" data-testid="forecast-policy-use">
					<strong>What this can support</strong>
					<p>
						Prepare a budget or staffing review. Confirm route loads, fleet capacity and costs
						before choosing departures or additional vehicles.
					</p>
					<button class="text-button" type="button" onclick={openResourceReview}
						>Prepare a resource review <ArrowRight size={14} aria-hidden="true" /></button
					>
				</div>
				{#if onShowEvidence}
					<button class="text-button evidence-link" type="button" onclick={onShowEvidence}
						>Check the source evidence <ArrowRight size={14} aria-hidden="true" /></button
					>
				{/if}
			</aside>
		</div>
		<div class="source-strip" data-testid="forecast-source-dates">
			<span>Evidence checked <strong>{sourceDate(bundle!.sourceAsOf)}</strong></span>
			<span>Method <strong>{modelLabel(series.model)}</strong></span>
			<a href={series.sourceUrl} target="_blank" rel="noreferrer"
				>Open MBS workbook <ExternalLink size={13} aria-hidden="true" /></a
			>
		</div>

		<section class="detail-section" aria-labelledby="forecast-record-heading">
			<div class="section-heading">
				<h2 id="forecast-record-heading">Inspect the analytical record</h2>
				<p>Definitions, exact values and comparisons behind this outlook.</p>
			</div>
			<div class="record-disclosures">
				<details class="history-table" data-testid="forecast-history-table">
					<summary
						><span>Recorded totals and estimates</span><span class="summary-meta"
							>{series.history.length} recorded months</span
						></summary
					>
					<div class="detail-body table-wrap">
						<table>
							<caption
								>Source-defined passenger movements. Recorded totals can be revised; estimates use
								history through {month(series.lastActualMonth)}.</caption
							>
							<thead
								><tr
									><th scope="col">Month</th><th class="numeric" scope="col">Passenger movements</th
									><th scope="col">Evidence</th></tr
								></thead
							>
							<tbody>
								{#each series.history as row (row.month)}<tr
										><th scope="row">{month(row.month)}</th><td class="numeric"
											>{count(row.value)}</td
										><td>Recorded</td></tr
									>{/each}
								{#each series.projections as row (row.month)}<tr class="estimated-row"
										><th scope="row">{month(row.month)}</th><td class="numeric"
											>{count(row.estimate)}</td
										><td>Estimate</td></tr
									>{/each}
							</tbody>
						</table>
					</div>
				</details>
				{#if series.benchmarks.length}
					<details data-testid="forecast-benchmarks">
						<summary
							><span>Compare forecast methods</span><span class="summary-meta"
								>{series.benchmarks.length} simple methods</span
							></summary
						>
						<div class="detail-body table-wrap">
							<table>
								<caption
									>Checks at the same forecast horizon. Lower errors are better; later checks were
									not used to choose the method.</caption
								>
								<thead
									><tr
										><th scope="col">Method</th><th class="numeric" scope="col">Target estimate</th
										><th class="numeric" scope="col">Average error</th><th
											class="numeric"
											scope="col">Total error</th
										></tr
									></thead
								>
								<tbody
									>{#each series.benchmarks as benchmark (benchmark.model)}
										<tr class:selected-method={benchmark.model === series.model}
											><th scope="row"
												>{modelLabel(benchmark.model)}{#if benchmark.model === series.model}<span
														class="table-tag">Selected</span
													>{/if}</th
											><td class="numeric">{count(benchmark.estimate)}</td><td class="numeric"
												>{count(benchmark.metrics.mae)}</td
											><td class="numeric"
												>{benchmark.metrics.wape == null
													? 'Unavailable'
													: (benchmark.metrics.wape * 100).toFixed(1) + '%'}</td
											></tr
										>
									{/each}</tbody
								>
							</table>
							<p>
								Total error divides the sum of absolute forecast errors by the sum of recorded
								totals. It is not a promise of future accuracy.
							</p>
						</div>
					</details>
				{/if}
				{#if series.backtest.length}
					<details data-testid="forecast-backtest">
						<summary
							><span>Each historical forecast check</span><span class="summary-meta"
								>{series.backtest.length} later targets</span
							></summary
						>
						<div class="detail-body table-wrap">
							<table>
								<caption
									>Earlier reference-month observations from the current revised source.
									Publication-time vintages were not reconstructed.</caption
								>
								<thead
									><tr
										><th scope="col">Target</th><th scope="col">History through</th><th
											class="numeric"
											scope="col">Forecast</th
										><th class="numeric" scope="col">Recorded</th><th class="numeric" scope="col"
											>Absolute error</th
										></tr
									></thead
								>
								<tbody
									>{#each series.backtest as row (row.targetMonth)}<tr
											><th scope="row">{month(row.targetMonth)}</th><td
												>{month(row.trainingCutoff)}</td
											><td class="numeric">{count(row.estimate)}</td><td class="numeric"
												>{count(row.actual)}</td
											><td class="numeric">{count(Math.abs(row.error))}</td></tr
										>{/each}</tbody
								>
							</table>
						</div>
					</details>
				{/if}
				<details data-testid="forecast-evidence">
					<summary
						><span>Definitions and limits</span><span class="summary-meta">Intended use</span
						></summary
					>
					<div class="detail-body">
						<p>{series.qualification}</p>
						{#if series.evaluation}<p>{series.evaluation.qualification}</p>{/if}
						<p>{series.modelCard.limitations.join(' ')}</p>
					</div>
				</details>
				{#if bundle?.dataQualityNotes.length}
					<details data-testid="forecast-quality-notes">
						<summary
							><span>Source quality notes</span><span class="summary-meta"
								>{bundle.dataQualityNotes.length} qualifications</span
							></summary
						>
						<div class="detail-body">
							<ul>
								{#each bundle.dataQualityNotes as note (note)}<li>{note}</li>{/each}
							</ul>
						</div>
					</details>
				{/if}
				{#if bundle?.provenance}
					<details data-testid="forecast-provenance">
						<summary
							><span>Workbook versions and preparation</span><span class="summary-meta"
								>Source receipts</span
							></summary
						>
						<div class="detail-body">
							<p>
								Published {bundle.provenance.latestPublicationDate}; checked {sourceDate(
									bundle.provenance.checkedAt
								)}. Preparation {bundle.provenance.transformVersion}; model {bundle.provenance
									.modelVersion}.
							</p>
							<p>{bundle.provenance.revisionQualification}</p>
							{#each bundle.provenance.sources as receipt (receipt.id)}<p>
									<a href={receipt.url} target="_blank" rel="noreferrer">{receipt.id}</a> ·
									publication sheet “{receipt.publicationSheet}” · SHA-256
									<code>{receipt.sha256}</code>
								</p>{/each}
						</div>
					</details>
				{/if}
			</div>
		</section>

		<section class="detail-section" aria-labelledby="forecast-action-heading">
			<div class="section-heading">
				<h2 id="forecast-action-heading">Take the outlook into a review</h2>
				<p>Keep the estimate accountable. Resource changes still require operator evidence.</p>
			</div>
			<div class="record-disclosures">
				<details
					bind:this={reviewElement}
					bind:open={reviewOpen}
					class="workflow"
					data-testid="forecast-resource-review"
				>
					<summary
						><span>Prepare a resource review</span><span class="summary-meta"
							>Operator-owned decision</span
						></summary
					>
					<div class="detail-body">
						<p class="workflow-intro">
							Record who will review this category and what evidence they need. Monthly totals
							cannot specify additional buses, crews or departures.
						</p>
						<div class="review-fields">
							<label
								>Accountable reviewer or team<input
									type="text"
									bind:value={reviewOwner}
									placeholder="Named operator planner or team"
								/></label
							>
							<label>Agreed review date<input type="date" bind:value={reviewDate} /></label>
							<label class="wide-field"
								>Decision to prepare<input type="text" bind:value={reviewPurpose} /></label
							>
							<label
								>Consequence or cost of under-planning<input
									type="text"
									bind:value={underPlanningCost}
									placeholder="Operator assessment"
								/></label
							>
							<label
								>Consequence or cost of over-planning<input
									type="text"
									bind:value={overPlanningCost}
									placeholder="Operator assessment; currency if quantified"
								/></label
							>
						</div>
						<fieldset class="review-checklist">
							<legend>Evidence to confirm before changing resources</legend>
							{#each checklist as item (item)}<label class="check"
									><input type="checkbox" bind:group={reviewChecks} value={item} /><span
										>{item}</span
									></label
								>{/each}
						</fieldset>
						<div class="action-row">
							<button
								class="primary-button"
								type="button"
								disabled={loading || !!error}
								onclick={prepareReview}>Prepare review record</button
							>
							<button type="button" disabled={loading || !!error} onclick={downloadReview}
								>Download a copy</button
							>
							<span>Prepared in this session. Download to retain.</span>
						</div>
						{#if reviewMessage}<p class="action-status" role="status">{reviewMessage}</p>{/if}
						{#if reviewRecord}
							<div class="prepared-record" data-testid="prepared-resource-review">
								<div>
									<strong>Prepared for {reviewRecord.owner}</strong><span
										>{reviewRecord.completedChecks.length} of {checklist.length} checks complete</span
									>
								</div>
								<p>
									{reviewRecord.purpose}. Review date: {reviewRecord.reviewDate ||
										'Not yet agreed'}.
								</p>
								{#if reviewRecord.outstandingChecks.length}<h3>Next evidence requests</h3>
									<ul>
										{#each reviewRecord.outstandingChecks as item (item)}<li>{item}</li>{/each}
									</ul>
								{:else}<p>
										All checks were marked complete by the reviewer. The operator must still approve
										any service change.
									</p>{/if}
								<p>
									Editing inputs requires preparing the record again. This record does not calculate
									a resource requirement.
								</p>
							</div>
						{/if}
					</div>
				</details>
				<details class="workflow" data-testid="forecast-issue-ledger">
					<summary
						><span>Frozen forecasts and later results</span><span class="summary-meta"
							>{issues.length} preserved {issues.length === 1 ? 'issue' : 'issues'}</span
						></summary
					>
					<div class="detail-body">
						<p class="workflow-intro">
							Freeze the selected month before later actuals arrive. Preserve all categories, four
							benchmark estimates, source hashes and model version so future results can be checked
							honestly.
						</p>
						<div class="action-row">
							<button
								class="primary-button"
								type="button"
								disabled={issuing ||
									loading ||
									!!error ||
									desiredMonth < currentMonth ||
									!bundle?.monthly.every((item) => item.status === 'exploratory')}
								onclick={freezeIssue}
								>{issuing ? 'Preserving…' : 'Freeze ' + month(desiredMonth) + ' issue'}</button
							>
							<a href="/api/prediction/issues" target="_blank" rel="noreferrer"
								>Inspect complete issue records <ExternalLink size={13} aria-hidden="true" /></a
							>
						</div>
						{#if bundle?.monthly.some((item) => item.status === 'unavailable')}<p
								class="inline-warning"
							>
								Freezing requires supported forecasts for all three source categories. Choose a
								nearer month or inspect the unavailable category.
							</p>{/if}
						{#if issueMessage}<p class="action-status" role="status">{issueMessage}</p>{/if}
						{#if !issues.length}<div class="ledger-empty">
								<strong>No frozen issues yet</strong>
								<p>
									Historical checks are retrospective. A frozen issue creates a record to compare
									with a later checked publication.
								</p>
							</div>{/if}
						{#each issues as view (view.issue.id)}
							<div class="issue-record">
								<div class="issue-heading">
									<strong
										>{month(view.issue.target.month)}
										<span
											>{view.issue.target.kind === 'nowcast'
												? 'Current month estimate'
												: 'Future forecast'}</span
										></strong
									><span>Issued {sourceDate(view.issue.issuedAt)}</span>
								</div>
								<div class="table-wrap">
									<table>
										<thead
											><tr
												><th scope="col">Passenger category</th><th scope="col">Result</th><th
													class="numeric"
													scope="col">Absolute error</th
												></tr
											></thead
										>
										<tbody
											>{#each view.scores as score (score.seriesId)}
												<tr
													><th scope="row"
														>{view.issue.forecasts.find((item) => item.seriesId === score.seriesId)
															?.name}</th
													><td
														>{score.status === 'pending'
															? 'Waiting for checked actual'
															: score.status === 'ineligible'
																? 'Actual not eligible'
																: 'Later-vintage score'}</td
													><td class="numeric">{count(score.absoluteError)}</td></tr
												>
											{/each}</tbody
										>
									</table>
								</div>
								<details class="issue-audit">
									<summary><span>Issue and score qualifications</span></summary>
									<p>
										Model {view.issue.provenance.modelVersion}. Publication {view.issue.provenance
											.latestPublicationDate}. Source fingerprint
										<code>{view.issue.sourceFingerprint.slice(0, 16)}…</code>
									</p>
									{#each view.scores as score (score.seriesId)}<p>
											{view.issue.forecasts.find((item) => item.seriesId === score.seriesId)?.name}: {score.qualification}
										</p>{/each}
									{#each view.recordedScores ?? [] as receipt (receipt.scoredAgainst.sourceFingerprint)}<p
										>
											Preserved score receipt: {sourceDate(receipt.recordedAt)} · actual vintage published
											{receipt.scoredAgainst.publicationDate}. {receipt.scores.filter(
												(score) => score.status === 'later-vintage-score'
											).length} categories scored; earlier receipts remain in the complete record.
										</p>{/each}
								</details>
								{#if view.scores.some((score) => score.status === 'later-vintage-score')}<button
										type="button"
										onclick={() => recordScores(view.issue.id)}>Preserve this score receipt</button
									>{/if}
							</div>
						{/each}
						<p class="small-note">
							Repeated issuance for the same Maldives day, target and source preserves the original.
							Scores wait for matching categories from a later checked publication; first-release
							actuals are not claimed. Append-only issue files need persistent storage and
							controlled issuance access when deployed.
						</p>
					</div>
				</details>
			</div>
		</section>
	{:else if loading || targetPending}
		<div class="unavailable loading-state" role="status" data-testid="forecast-target-loading">
			<span class="section-label">Loading selected target</span>
			<h2>Preparing {month(desiredMonth)} outlook</h2>
			<p>Estimates and review actions will appear when the matching target is ready.</p>
			<div class="loading-chart" aria-hidden="true"></div>
		</div>
	{:else}
		<div class="unavailable" role={error ? 'alert' : 'status'}>
			<span class="section-label">Forecast unavailable</span>
			<h2>
				{error ? 'The selected outlook could not be loaded' : 'Passenger evidence is not ready'}
			</h2>
			<p>
				{error ||
					'No validated forecast bundle has loaded. Journey comparisons remain available in Decisions.'}
			</p>
			{#if error}<button
					type="button"
					onclick={() => {
						error = '';
						localTarget = '';
						onTargetMonthChange?.(prediction?.target?.month ?? currentMonth);
					}}>Return to the current month</button
				>{/if}
		</div>
	{/if}
</section>

<style>
	.outlook {
		color: var(--analytics-ink, #172b3a);
		min-width: 0;
	}
	.page-intro {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 24px;
		margin-bottom: 20px;
	}
	h1 {
		margin: 0 0 8px;
		font-size: 30px;
		font-weight: 650;
		letter-spacing: -0.035em;
		line-height: 1.2;
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
		border: 0;
	}
	.page-intro p {
		margin: 0;
		font-size: 14px;
	}
	.page-classification {
		padding-top: 8px;
		font-size: 12px;
		color: var(--analytics-muted, #647381);
		white-space: nowrap;
	}
	p {
		margin: 8px 0;
		font-size: 13px;
		line-height: 1.6;
		color: var(--analytics-muted, #647381);
	}
	h2,
	h3 {
		margin: 0;
		font-weight: 620;
		letter-spacing: -0.02em;
	}
	h2 {
		font-size: 21px;
		line-height: 1.3;
	}
	h3 {
		font-size: 14px;
		line-height: 1.5;
	}
	.selection-bar {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 24px;
		padding-bottom: 18px;
	}
	.category-control {
		min-width: 0;
	}
	.control-label,
	.section-label {
		display: block;
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.05em;
		line-height: 1.5;
		text-transform: uppercase;
		color: var(--analytics-muted, #647381);
	}
	.control-label {
		margin-bottom: 8px;
	}
	.series-picker {
		display: flex;
		flex-wrap: wrap;

		gap: 4px;
		border: 1px solid var(--analytics-border, #dde3e9);

		border-radius: var(--surface-radius-pill, 999px);

		background: #eaf0f2;
		overflow: hidden;
		padding: 4px;
	}
	button,
	input,
	select {
		font: inherit;
		font-size: 13px;
	}
	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		min-height: 40px;
		padding: 9px 13px;
		color: var(--analytics-ink, #172b3a);
		background: #fff;
		border: 1px solid var(--analytics-border, #dde3e9);

		border-radius: var(--surface-radius-pill, 999px);
		cursor: pointer;
	}
	.series-picker button {
		border: 0;

		border-radius: var(--surface-radius-pill, 999px);
		min-height: 42px;
		padding: 10px 14px;
		color: #5a6d78;
	}
	.series-picker button + button {
		border-left: 0;
	}
	.series-picker button.active {
		background: #fff;
		color: #086c65;

		box-shadow: 0 1px 3px #172b3a12;
	}
	.month-control {
		display: block;
		flex-shrink: 0;
	}
	input {
		width: 100%;
		min-height: 42px;
		background: #fff;
		border: 1px solid #ccd5dd;

		border-radius: var(--surface-radius-field, 14px);
		padding: 10px 12px;
		color: var(--analytics-ink, #172b3a);
		box-sizing: border-box;
	}
	.month-control input {
		width: 170px;
	}
	.control-empty {
		display: block;
		padding: 12px 0;
		font-size: 13px;
		color: #647381;
	}
	.analytical-controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 18px;
		padding: 0 0 18px;
	}
	.analytical-views {
		display: flex;
		gap: 4px;
		padding: 3px;
		background: #eaf0f2;

		border-radius: var(--surface-radius-pill, 999px);
	}
	.analytical-views button {
		min-height: 44px;
		border: 0;
		color: #5a6d78;
		background: transparent;
		font-size: 12px;
		padding: 8px 12px;
	}
	.analytical-views button.active {
		background: #fff;
		color: #172b3a;
		box-shadow: 0 1px 3px #172b3a12;
	}
	.analytical-views button span {
		font-size: 10px;
		font-variant-numeric: tabular-nums;
		color: #647381;
		padding: 1px 5px;
		border-radius: 4px;
		background: #eaf0f2;
	}
	.target-lag {
		font-size: 11px;
		color: #647381;
		text-align: right;
	}
	.target-context {
		display: flex;
		flex-direction: column;
		gap: 4px;
		text-align: right;
	}
	.target-classification {
		font-size: 11px;
		color: #647381;
	}
	.history-window {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin: 10px 0 0;
	}
	.history-window > span {
		font-size: 11px;
		color: #647381;
	}
	.history-window > div {
		display: flex;
		gap: 3px;
	}
	.history-window button {
		min-height: 44px;
		border: 0;
		padding: 8px;
		color: #647381;
		background: transparent;
		font-size: 11px;
	}
	.history-window button.active {
		background: #edf4f3;
		color: #08766f;
	}
	.point-inspector > div:first-child {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
	}
	.point-inspector select {
		color: #243947;
		background: #fff;
		border: 1px solid #d5dee4;

		border-radius: var(--surface-radius-field, 14px);
		min-height: 44px;
		max-width: 100%;
		padding: 8px;
		font-size: 11px;
	}
	.point-inspector select:focus-visible {
		outline: 3px solid #087f78;
		outline-offset: 3px;
	}
	.analysis-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 304px;
		gap: 22px;
		align-items: stretch;
	}
	.forecast-surface {
		background: #fff;
		border: 1px solid var(--analytics-border, #dde3e9);

		border-radius: var(--surface-radius, 28px);
		padding: 20px 24px 18px;
		min-width: 0;
		box-shadow: var(--surface-shadow);
	}
	.surface-heading {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
	}
	.surface-heading h2 {
		margin-top: 4px;
	}
	.quiet-button {
		border: 0;
		background: transparent;
		color: #08766f;
		padding: 8px 0 8px 8px;
		font-size: 12px;
	}
	.estimate-row {
		display: flex;
		align-items: center;
		gap: 24px;
		margin: 12px 0 16px;
	}
	.estimate-block {
		flex: 1;
		min-width: 0;
	}
	.estimate {
		font-size: clamp(31px, 3.2vw, 40px);
		line-height: 1.15;
		font-weight: 650;
		letter-spacing: -0.04em;
		font-variant-numeric: tabular-nums;
	}
	.estimate-block p {
		margin: 5px 0 0;
		font-size: 12px;
	}
	.estimate-block p span {
		color: #7c8791;
	}
	.comparison {
		max-width: 255px;
		border-left: 1px solid #e0e5ea;
		padding-left: 20px;
	}
	.comparison > span {
		display: block;
		color: #647381;
		font-size: 11px;
		margin-bottom: 5px;
	}
	.comparison strong {
		font-size: 14px;
		font-weight: 620;
		font-variant-numeric: tabular-nums;
	}
	.comparison p {
		font-size: 11px;
		line-height: 1.5;
		margin: 6px 0 0;
	}
	.chart-title {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
	}
	.chart-title > span {
		color: #7a8690;
		font-size: 11px;
	}
	.chart-region {
		width: 100%;
		min-width: 0;
		margin-top: 8px;
	}
	.forecast-surface svg {
		display: block;
		width: 100%;
		height: 270px;
	}
	svg text {
		fill: #75828e;
		font:
			11px Inter,
			system-ui,
			sans-serif;
		font-variant-numeric: tabular-nums;
	}
	.chart-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 12px;
		color: #647381;
		font-size: 11px;
	}
	.point-inspector {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		margin: -2px 0 16px;
		padding: 8px 0;
		border-top: 1px solid #edf0f3;
		border-bottom: 1px solid #edf0f3;
	}
	.point-inspector strong {
		font-weight: 550;
		font-size: 12px;
		font-variant-numeric: tabular-nums;
	}
	.point-inspector span {
		margin-left: 8px;
		font-size: 10px;
		color: #7a8690;
	}
	.point-navigation {
		display: flex;
		gap: 4px;
	}
	.point-navigation button {
		min-height: 44px;
		width: 44px;
		padding: 6px;
	}
	.chart-footer strong {
		font-weight: 550;
		color: #50626f;
	}
	.legend {
		display: flex;
		gap: 14px;
		flex-wrap: wrap;
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
	.legend .range-key {
		border-color: #a7ccc7;
		border-top-width: 6px;
		width: 9px;
	}
	.chart-qualification {
		margin: 14px 0 0;
		font-size: 11px;
		line-height: 1.55;
	}
	.count-definition {
		margin: 12px 0 0;
		padding-top: 12px;
		border-top: 1px solid #edf0f3;
		font-size: 11px;
	}
	.reliability-panel {
		padding: 20px 0 8px;
		border-top: 2px solid #a7b8be;
		min-width: 0;
	}
	.reliability-heading h2 {
		font-size: 20px;
		margin-top: 6px;
		max-width: 280px;
	}
	.reliability-verdict {
		color: #94621c;
		font-size: 12px;
		margin: 10px 0 18px;
	}
	.reliability-metrics {
		margin: 0;
		border-top: 1px solid #dde3e9;
	}
	.reliability-metrics > div {
		padding: 12px 0;
		border-bottom: 1px solid #dde3e9;
	}
	.reliability-metrics dt {
		font-size: 11px;
		color: #647381;
		margin-bottom: 5px;
	}
	.reliability-metrics dd {
		margin: 0;
		color: #243947;
		font-size: 18px;
		font-weight: 600;
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
	}
	.reliability-metrics dd span {
		font-size: 11px;
		font-weight: 400;
		letter-spacing: 0;
		color: #647381;
	}
	.small-note {
		font-size: 11px;
		line-height: 1.6;
		margin: 10px 0;
	}
	.range {
		margin: 18px 0;
		padding: 14px;
		background: #edf2f3;

		border-radius: var(--surface-radius-inner, 16px);
	}
	.range .section-label {
		font-size: 10px;
		letter-spacing: 0.03em;
	}
	.range > strong {
		display: block;
		margin: 6px 0;
		font-size: 19px;
		font-weight: 600;
		letter-spacing: -0.02em;
		font-variant-numeric: tabular-nums;
	}
	.range p {
		margin: 0 0 6px;
		color: #94621c;
		font-size: 11px;
	}
	.range > span:last-child {
		display: block;
		font-size: 11px;
		line-height: 1.5;
		color: #647381;
	}
	.policy-use {
		border-top: 1px solid #dde3e9;
		padding-top: 16px;
	}
	.policy-use > strong {
		font-size: 12px;
		font-weight: 650;
	}
	.policy-use p {
		font-size: 12px;
		margin: 6px 0;
	}
	.text-button {
		border: 0;
		background: transparent;
		color: #08766f;
		min-height: 34px;
		padding: 6px 0;
		font-size: 12px;
		justify-content: flex-start;
	}
	.evidence-link {
		margin-top: 6px;
	}
	.source-strip {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-start;
		align-items: center;
		column-gap: 24px;
		row-gap: 8px;
		padding: 13px 0;
		margin-bottom: 22px;
		font-size: 11px;
		color: #75828e;
	}
	.source-strip strong {
		color: #526571;
		font-weight: 550;
		margin-left: 4px;
	}
	.source-strip a {
		margin-left: auto;
		font-size: 11px;
	}
	a {
		color: #08766f;
		font-size: 12px;
		text-underline-offset: 3px;
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.detail-section {
		margin-top: 28px;
	}
	.section-heading {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 20px;
		margin-bottom: 13px;
	}
	.section-heading h2 {
		font-size: 17px;
		font-weight: 620;
	}
	.section-heading p {
		font-size: 12px;
		margin: 0;
	}
	.record-disclosures {
		background: #fff;
		border: 1px solid #dde3e9;

		border-radius: var(--surface-radius, 28px);
		overflow: hidden;
		box-shadow: var(--surface-shadow);
	}
	.record-disclosures > details + details {
		border-top: 1px solid #e4e9ee;
	}
	details {
		font-size: 12px;
	}
	summary {
		list-style: none;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		padding: 17px 20px;
		cursor: pointer;
		font-size: 13px;
		font-weight: 560;
		line-height: 1.5;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	summary > span:first-child::before {
		content: '›';
		display: inline-block;
		width: 15px;
		font-size: 18px;
		line-height: 0;
		color: #7c8d98;
	}
	details[open] > summary > span:first-child::before {
		transform: rotate(90deg);
	}
	.summary-meta {
		color: #7b8892;
		font-size: 11px;
		font-weight: 400;
		text-align: right;
	}
	details[open] > summary {
		background: #fafbfc;
		border-bottom: 1px solid #edf0f3;
	}
	.detail-body {
		padding: 18px 20px;
	}
	.detail-body > p:first-child {
		margin-top: 0;
	}
	.detail-body p {
		font-size: 12px;
	}
	.detail-body ul {
		margin: 8px 0;
		padding-left: 18px;
	}
	.detail-body li {
		line-height: 1.6;
		padding: 4px 0;
		color: #647381;
	}
	.table-wrap {
		overflow: auto;
		border-radius: var(--surface-radius-inner, 16px);
	}
	.history-table .table-wrap {
		max-height: 380px;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
		min-width: 420px;
	}
	caption {
		text-align: left;
		color: #647381;
		font-size: 11px;
		line-height: 1.6;
		margin-bottom: 14px;
	}
	th,
	td {
		text-align: left;
		padding: 11px 12px;
		border-bottom: 1px solid #e7ebef;
		font-variant-numeric: tabular-nums;
	}
	th:first-child,
	td:first-child {
		padding-left: 0;
	}
	th:last-child,
	td:last-child {
		padding-right: 0;
	}
	thead th {
		color: #73818d;
		font-size: 11px;
		font-weight: 550;
		white-space: nowrap;
	}
	tbody th {
		font-weight: 500;
	}
	tbody tr:last-child th,
	tbody tr:last-child td {
		border-bottom: 0;
	}
	.numeric {
		text-align: right;
		white-space: nowrap;
	}
	.estimated-row,
	.selected-method {
		background: #f2f7f6;
	}
	.table-tag {
		font-size: 10px;
		font-weight: 550;
		color: #08766f;
		margin-left: 8px;
	}
	.workflow-intro {
		max-width: 790px;
		margin-bottom: 20px;
	}
	.review-fields {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px 20px;
	}
	.review-fields label {
		display: flex;
		flex-direction: column;
		gap: 7px;
		font-size: 12px;
		color: #526571;
	}
	.wide-field {
		grid-column: 1 / -1;
	}
	.review-checklist {
		padding: 0;
		margin: 24px 0;
		border: 0;
	}
	.review-checklist legend {
		font-size: 12px;
		font-weight: 600;
		margin-bottom: 12px;
	}
	.check {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		margin: 9px 0;
		line-height: 1.6;
		color: #526571;
	}
	.check input {
		width: 16px;
		height: 16px;
		min-height: 0;
		padding: 0;
		margin: 2px 0 0;
		accent-color: #087f78;
		flex-shrink: 0;
	}
	.action-row {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
		margin: 12px 0;
	}
	.action-row > span {
		color: #75828e;
		font-size: 11px;
	}
	.primary-button {
		background: #087f78;
		color: #fff;
		border-color: #087f78;
	}
	.action-status {
		background: #eef5f4;
		border-left: 3px solid #087f78;
		padding: 10px 12px;
		color: #375d58;
		font-size: 12px;
	}
	.prepared-record {
		margin-top: 22px;
		padding: 16px;
		background: #f7f9fa;
		border: 1px solid #dde3e9;

		border-radius: var(--surface-radius-inner, 16px);
	}
	.prepared-record > div {
		display: flex;
		justify-content: space-between;
		gap: 16px;
	}
	.prepared-record > div > span {
		font-size: 11px;
		color: #647381;
	}
	.prepared-record h3 {
		margin-top: 15px;
		font-size: 12px;
	}
	.issue-record {
		padding: 20px 0;
		border-top: 1px solid #dde3e9;
	}
	.issue-heading {
		display: flex;
		justify-content: space-between;
		gap: 20px;
		align-items: baseline;
		margin-bottom: 10px;
	}
	.issue-heading > strong {
		font-size: 14px;
		font-weight: 600;
	}
	.issue-heading > strong span {
		font-size: 11px;
		font-weight: 400;
		color: #647381;
		margin-left: 9px;
	}
	.issue-heading > span {
		color: #647381;
		font-size: 11px;
	}
	.issue-audit {
		margin-top: 10px;
	}
	.issue-audit summary {
		padding: 8px 0;
		color: #647381;
		font-size: 11px;
	}
	.issue-audit p {
		font-size: 11px;
	}
	.ledger-empty {
		padding: 20px 0;
		color: #526571;
	}
	code {
		font-size: 11px;
		overflow-wrap: anywhere;
		word-break: break-all;
		color: #647381;
	}
	.inline-warning {
		color: #94621c;
		font-size: 12px;
		border-left: 2px solid #c8a66a;
		padding-left: 12px;
	}
	.unavailable {
		padding: 32px;
		background: #fff;
		border: 1px solid #dde3e9;

		border-radius: var(--surface-radius, 28px);
		box-shadow: var(--surface-shadow);
	}
	.unavailable h2 {
		margin-top: 8px;
	}
	.unavailable p {
		max-width: 650px;
	}
	.loading-chart {
		height: 150px;
		margin-top: 28px;
		background: #f5f7f9;
		border-bottom: 1px solid #e1e7ed;
		border-radius: var(--surface-radius-inner, 16px);
	}
	.chart-empty {
		min-height: 230px;
		display: grid;
		place-content: center;
		color: #647381;
		font-size: 13px;
	}
	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	button:focus-visible,
	input:focus-visible,
	summary:focus-visible,
	a:focus-visible {
		outline: 2px solid #087f78;
		outline-offset: 3px;
	}
	@media (hover: hover) and (pointer: fine) {
		button:not(:disabled):hover {
			background: #f2f6f7;
		}
		.primary-button:not(:disabled):hover {
			background: #096f69;
		}
		.series-picker button.active:hover {
			background: #dfefec;
		}
		summary:hover {
			background: #f8fafb;
		}
	}
	@media (max-width: 1060px) {
		.page-classification {
			display: none;
		}
		.analysis-grid {
			grid-template-columns: minmax(0, 1fr) 270px;
			gap: 18px;
		}
		.forecast-surface {
			padding: 20px 18px 18px;
		}
		.comparison {
			max-width: 195px;
			padding-left: 14px;
		}
		.estimate-row {
			gap: 16px;
		}
		.chart-title {
			display: block;
		}
		.chart-title > span {
			display: block;
			margin-top: 2px;
		}
		.series-picker button {
			font-size: 12px;
			padding: 10px 12px;
		}
	}
	@media (max-width: 820px) {
		.analytical-controls {
			align-items: flex-start;
		}
		.analysis-grid {
			grid-template-columns: 1fr;
			gap: 24px;
		}
		.reliability-panel {
			padding: 20px 0;
		}
		.reliability-heading h2 {
			max-width: none;
		}
		.reliability-metrics {
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
		}
		.reliability-metrics > div {
			padding-right: 14px;
		}
		.reliability-metrics dd {
			font-size: 20px;
		}
		.reliability-metrics dd span {
			display: block;
			margin-top: 4px;
		}
		.range {
			max-width: 460px;
		}
		.policy-use {
			max-width: 650px;
		}
		.source-strip {
			margin-top: -10px;
		}
		.section-heading {
			display: block;
		}
		.section-heading p {
			margin-top: 6px;
		}
		.selection-bar {
			align-items: flex-start;
		}
		.series-picker {
			display: grid;
			grid-template-columns: 1fr;
		}
		.series-picker button {
			justify-content: flex-start;
		}
		.series-picker button + button {
			border-left: 0;
			border-top: 1px solid #dde3e9;
		}
	}
	@media (max-width: 560px) {
		.analytical-controls {
			align-items: stretch;
			flex-direction: column;
			gap: 9px;
		}
		.analytical-views button {
			flex: 1;
		}
		.target-lag {
			text-align: left;
		}
		.target-context {
			text-align: left;
		}
		.history-window {
			flex-wrap: wrap;
			gap: 4px;
		}
		.history-window > div {
			margin-left: auto;
		}
		.point-inspector {
			align-items: flex-start;
			gap: 8px;
		}
		.point-navigation {
			flex-shrink: 0;
		}
		h1 {
			font-size: 27px;
		}
		.page-intro {
			margin-bottom: 22px;
		}
		.page-intro p {
			font-size: 13px;
		}
		.selection-bar {
			flex-direction: column;
			gap: 18px;
			padding-bottom: 20px;
		}
		.category-control {
			width: 100%;
		}
		.series-picker {
			width: 100%;
		}
		.series-picker button {
			min-height: 44px;
		}
		.month-control {
			display: flex;
			align-items: center;
			gap: 18px;
			width: 100%;
			justify-content: space-between;
		}
		.month-control .control-label {
			margin-bottom: 0;
		}
		.month-control input {
			width: 160px;
		}
		.forecast-surface {
			padding: 18px 16px;
		}
		.surface-heading {
			align-items: flex-start;
		}
		.quiet-button {
			max-width: 125px;
			font-size: 11px;
			text-align: left;
		}
		.estimate-row {
			align-items: flex-start;
			flex-direction: column;
			gap: 16px;
			margin-bottom: 22px;
		}
		.estimate {
			font-size: 36px;
		}
		.comparison {
			border-left: 0;
			border-top: 1px solid #e0e5ea;
			padding: 12px 0 0;
			max-width: none;
			width: 100%;
		}
		.chart-footer {
			align-items: flex-start;
			flex-direction: column;
			gap: 10px;
		}
		.reliability-metrics {
			grid-template-columns: 1fr;
		}
		.reliability-metrics > div {
			display: flex;
			align-items: center;
			justify-content: space-between;
			gap: 20px;
			padding-right: 0;
		}
		.reliability-metrics dt {
			margin: 0;
			max-width: 145px;
		}
		.reliability-metrics dd {
			text-align: right;
			font-size: 18px;
		}
		.reliability-metrics dd span {
			font-size: 10px;
		}
		.source-strip {
			gap: 8px;
			align-items: flex-start;
			flex-direction: column;
		}
		.source-strip a {
			margin-left: 0;
		}
		.summary-meta {
			display: none;
		}
		summary {
			padding: 16px;
			min-height: 20px;
		}
		.detail-body {
			padding: 16px;
		}
		.review-fields {
			grid-template-columns: 1fr;
		}
		.wide-field {
			grid-column: auto;
		}
		.prepared-record > div,
		.issue-heading {
			align-items: flex-start;
			flex-direction: column;
			gap: 7px;
		}
		.issue-heading > strong span {
			display: block;
			margin-left: 0;
			margin-top: 5px;
		}
		.unavailable {
			padding: 24px 18px;
		}
	}

	@media (max-width: 820px) {
		.series-picker {
			border-radius: var(--surface-radius-mobile, 24px);
		}
		.series-picker button + button {
			border-top: 0;
		}
	}

	@media (max-width: 600px) {
		.forecast-surface,
		.record-disclosures,
		.unavailable {
			border-radius: var(--surface-radius-mobile, 24px);
		}
	}
</style>
