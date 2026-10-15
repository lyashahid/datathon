<script lang="ts">
	import { downloadJson as download } from '#lib/download.js';
	import { onMount } from 'svelte';
	import {
		ArrowUpRight,
		CalendarDays,
		Download,
		History,
		LockKeyhole,
		RefreshCw,
		TrendingUp
	} from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import { api } from '#lib/api.js';
	import ForecastAnalysis from '#lib/components/ForecastAnalysis.svelte';

	type Metrics = {
		mae: number;
		rmse: number;
		wape: number | null;
		n: number;
		firstTargetMonth: string;
		lastTargetMonth: string;
		bias: number;
		mase?: number | null;
		skill?: { lastMonth: number | null; seasonalNaive: number | null };
	};
	type Forecast = {
		seriesId: string;
		name: string;
		mode: string;
		geography: string;
		unit: string;
		sourceUrl: string;
		lastActualMonth: string;
		forecastMonth: string;
		horizonMonths: number;
		status: string;
		estimate: number | null;
		model: string | null;
		parameters?: { weights?: Record<string, number> };
		qualification: string;
		unavailableReason: string | null;
		history: { month: string; value: number }[];
		projections: { month: string; estimate: number }[];
		backtest: {
			targetMonth: string;
			trainingCutoff: string;
			actual: number;
			estimate: number;
			error: number;
		}[];
		empiricalRange: {
			lower: number;
			upper: number;
			historicalCoverage: number;
			residualCount: number;
			label: string;
			calibrationFirstTarget?: string;
			calibrationCutoff?: string;
			reliability?: string;
		} | null;
		evaluation: Metrics | null;
		selection?: {
			origins: number;
			lastTargetMonth: string;
			firstEvaluationTrainingCutoff: string;
			embargoMonths: number;
			firstTargetMonth?: string;
			calibrationOrigins?: number;
			firstCalibrationTrainingCutoff?: string | null;
			reason?: string;
		};
		diagnostics?: {
			annualMeanChange: number | null;
			residualLagOneCorrelation: number | null;
			evaluationBiasDirection: string;
			notes: string[];
		};
		benchmarks: {
			model: string;
			selectionMae: number;
			selectionCount: number;
			metrics: Metrics;
			estimate: number;
		}[];
		modelCard: {
			version: string;
			intendedUse: string;
			evaluation: string;
			limitations: string[];
			excludedUses: string[];
		};
	};
	type Bundle = {
		monthly: Forecast[];
		sourceAsOf: string;
		generatedAt: string;
		dataQualityNotes: string[];
		target: { month: string; kind: string; currentMonthMvt: string };
		provenance: {
			latestPublicationDate: string;
			revisionQualification: string;
			modelVersion: string;
			sources: { id: string; url: string; sha256: string }[];
		};
		bus: { qualification: string; predictionAvailable: boolean };
	};
	type IssueView = {
		issue: {
			id: string;
			issuedAt: string;
			target: { month: string };
			forecasts: Forecast[];
			integritySha256: string;
			provenance: { modelVersion: string };
		};
		integrityVerified: boolean;
		scores: {
			seriesId: string;
			status: string;
			actual: number | null;
			absoluteError: number | null;
			qualification: string;
		}[];
	};

	let bundle = $state.raw<Bundle | null>(null);
	let issues = $state.raw<IssueView[]>([]);
	let issuesLoading = $state(true);
	let issuesError = $state('');
	let targetMonth = $state('');
	let seriesId = $state('');
	let loading = $state(true);
	let freezing = $state(false);
	let error = $state('');
	let notice = $state('');
	let view = $state('outlook');
	let chartContainerWidth = $state(920);
	let controller: AbortController | undefined;
	let issueController: AbortController | undefined;
	const current = $derived(
		bundle?.monthly.find((item) => item.seriesId === seriesId) ?? bundle?.monthly[0]
	);
	const dirty = $derived(!!bundle && targetMonth !== bundle.target.month);
	const canFreeze = $derived(
		!!bundle &&
			!dirty &&
			bundle.target.kind !== 'retrospective-preview' &&
			bundle.monthly.every((item) => item.status === 'exploratory')
	);
	const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
	const monthFormatter = new Intl.DateTimeFormat('en-GB', {
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC'
	});
	const number = (value: number | null | undefined) =>
		value == null ? '—' : numberFormatter.format(value);
	const percent = (value: number | null | undefined) =>
		value == null ? '—' : `${(value * 100).toFixed(1)}%`;
	const month = (value: string) => monthFormatter.format(new Date(`${value}-01T12:00:00Z`));
	const modelNames: Record<string, string> = {
		'last-month': 'Last observed month',
		'seasonal-naive': 'Same month last year',
		'mean-3-months': 'Recent 3-month mean',
		'mean-6-months': 'Recent 6-month mean',
		'damped-trend': 'Damped recent trend',
		'seasonal-level-blend': 'Seasonal + recent level',
		'adaptive-level': 'Adaptive exponential level',
		'holt-damped': 'Damped Holt smoothing',
		'seasonal-ridge': 'Regularized seasonal trend',
		'selection-ensemble': 'Locked selection ensemble'
	};
	const modelName = (name: string | null) => (name ? (modelNames[name] ?? name) : 'Unavailable');
	const chart = $derived.by(() => {
		if (!current?.history.length) return null;
		const actual = current.history.map((item) => ({ month: item.month, value: item.value }));
		const forecast = current.projections.map((item) => ({
			month: item.month,
			value: item.estimate
		}));
		const last = actual[actual.length - 1];
		const all = [...actual, ...forecast];
		const width = Math.min(920, Math.max(260, chartContainerWidth || 920)),
			height = width < 600 ? 260 : 225,
			left = 58,
			top = 15,
			bottom = 40;
		const maximum =
			Math.max(1, ...all.map((item) => item.value), current.empiricalRange?.upper ?? 0) * 1.08;
		const x = (index: number) => left + (index / Math.max(1, all.length - 1)) * (width - left - 26);
		const y = (value: number) => top + (1 - value / maximum) * (height - top - bottom);
		const line = (points: { value: number }[], start: number) =>
			points
				.map(
					(item, index) =>
						`${index ? 'L' : 'M'}${x(start + index).toFixed(1)},${y(item.value).toFixed(1)}`
				)
				.join(' ');
		return {
			actual: line(actual, 0),
			projection: line([last, ...forecast], actual.length - 1),
			maximum,
			x,
			y,
			lastX: x(actual.length - 1),
			labels: all
				.filter((_, index) =>
					width < 600
						? [0, Math.floor((all.length - 1) / 2), all.length - 1].includes(index)
						: index % 12 === 0 || index === all.length - 1
				)
				.map((item) => ({ ...item, x: x(all.indexOf(item)) })),
			width,
			height,
			finalX: x(all.length - 1),
			range: current.empiricalRange
		};
	});

	async function load() {
		controller?.abort();
		const request = new AbortController();
		controller = request;
		loading = true;
		error = '';
		notice = '';
		const requestedTarget = targetMonth;
		try {
			const result = await api<Bundle>(
				`forecasts${requestedTarget ? `?target_month=${encodeURIComponent(requestedTarget)}` : ''}`,
				undefined,
				request.signal
			);
			if (request.signal.aborted || targetMonth !== requestedTarget) return;
			bundle = result;
			targetMonth = result.target.month;
			if (!result.monthly.some((item) => item.seriesId === seriesId))
				seriesId = result.monthly[0]?.seriesId ?? '';
		} catch (caught) {
			if (!request.signal.aborted && targetMonth === requestedTarget)
				error = caught instanceof Error ? caught.message : 'Passenger outlook could not be loaded.';
		} finally {
			if (controller === request) loading = false;
		}
	}

	async function loadIssues() {
		issueController?.abort();
		const request = new AbortController();
		issueController = request;
		issuesLoading = true;
		issuesError = '';
		try {
			const result = await api<{ items: IssueView[] }>(
				'forecasts/issues',
				undefined,
				request.signal
			);
			if (!request.signal.aborted) issues = result.items;
		} catch (caught) {
			if (!request.signal.aborted)
				issuesError =
					caught instanceof Error ? caught.message : 'Forecast receipts could not be loaded.';
		} finally {
			if (issueController === request) issuesLoading = false;
		}
	}
	async function freeze() {
		if (!bundle || !canFreeze || freezing) return;
		issueController?.abort();
		issuesLoading = false;
		freezing = true;
		error = '';
		notice = '';
		try {
			const result = await api<IssueView & { created: boolean }>('forecasts/issues', {
				target_month: bundle.target.month
			});
			issues = [result, ...issues.filter((item) => item.issue.id !== result.issue.id)];
			notice = result.created
				? 'Forecast frozen. This receipt will keep the original estimates for future scoring.'
				: 'The same forecast is already frozen. Its original receipt has been recovered.';
			view = 'issues';
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'This forecast could not be frozen.';
		} finally {
			freezing = false;
		}
	}

	onMount(() => {
		void load();
		void loadIssues();
		return () => {
			controller?.abort();
			issueController?.abort();
		};
	});
</script>

<section class="forecast-workspace" aria-label="Passenger forecasts">
	<header class="workspace-heading">
		<div>
			<span class="eyebrow">SERVICE RESOURCE PLANNING</span>
			<h1>Passenger outlook</h1>
			<p>Understand the direction of demand, then check how the model performed.</p>
		</div>
		<Badge variant="secondary"><TrendingUp size={13} /> Aggregate monthly movements</Badge>
	</header>
	<Card.Root class="forecast-controls">
		<form
			onsubmit={(event) => {
				event.preventDefault();
				void load();
			}}
		>
			<label for="forecast-target"><CalendarDays size={15} /> Target month</label>
			<Input id="forecast-target" type="month" bind:value={targetMonth} required />
			<Button type="submit" disabled={loading}
				><RefreshCw size={14} /> {loading ? 'Loading…' : 'Update outlook'}</Button
			>
			<div class="control-spacer"></div>
			<Button
				type="button"
				variant="outline"
				disabled={!bundle || loading}
				onclick={() => download(bundle, `passenger-outlook-${bundle?.target.month}.json`)}
				><Download size={14} /> Export outlook</Button
			>
			<Button type="button" disabled={!canFreeze || loading || freezing} onclick={freeze}
				><LockKeyhole size={14} /> {freezing ? 'Freezing…' : 'Freeze forecast'}</Button
			>
		</form>
		{#if bundle}<p class="source-caption">
				Official publication {bundle.provenance.latestPublicationDate} · selected category observed through
				{month(current?.lastActualMonth ?? bundle.monthly[0].lastActualMonth)} · target {month(
					bundle.target.month
				)}{dirty ? ' · apply the new target to update results' : ''}.
			</p>{/if}
	</Card.Root>
	{#if error}<div class="feedback error" role="alert">
			{error}<Button size="sm" variant="outline" onclick={load}>Try again</Button>
		</div>{/if}
	{#if notice}<div class="feedback success" role="status">{notice}</div>{/if}
	{#if bundle}
		<Tabs.Root bind:value={view} class="forecast-tabs">
			<Tabs.List aria-label="Forecast views"
				><Tabs.Trigger value="outlook">Outlook & history</Tabs.Trigger><Tabs.Trigger
					value="evaluation">Backtests & models</Tabs.Trigger
				><Tabs.Trigger value="analysis">Data & method</Tabs.Trigger><Tabs.Trigger value="issues"
					>Frozen forecasts <span class="tab-count">{issues.length}</span></Tabs.Trigger
				></Tabs.List
			>
			<Tabs.Content value="outlook">
				<div class="forecast-series">
					{#each bundle.monthly as item (item.seriesId)}<Button
							variant="outline"
							class={seriesId === item.seriesId ? 'series-card selected' : 'series-card'}
							aria-pressed={seriesId === item.seriesId}
							onclick={() => {
								seriesId = item.seriesId;
							}}
							><span
								><span class="mode-label">{item.mode === 'bus' ? 'BUS' : 'FERRY'}</span><strong
									>{item.name}</strong
								><small>Last actual {month(item.lastActualMonth)}</small></span
							><b
								>{number(
									item.history.find((entry) => entry.month === item.lastActualMonth)?.value
								)}</b
							></Button
						>{/each}
				</div>
				{#if current}
					<div class="forecast-metrics">
						<Card.Root class="metric-card featured"
							><span class="metric-label">{month(current.forecastMonth)} estimate</span><strong
								>{number(current.estimate)}</strong
							>
							<p>{current.horizonMonths} months after the last actual</p></Card.Root
						>
						<Card.Root class="metric-card"
							><span class="metric-label">Held-out absolute error</span><strong
								>{number(current.evaluation?.mae)}</strong
							>
							<p>Average error across {current.evaluation?.n ?? 0} later origins</p></Card.Root
						>
						<Card.Root class="metric-card"
							><span class="metric-label">Held-out percentage error</span><strong
								>{percent(current.evaluation?.wape)}</strong
							>
							<p>WAPE · total absolute error ÷ actual movements</p></Card.Root
						>
						<Card.Root class="metric-card"
							><span class="metric-label">Historical range coverage</span><strong
								>{percent(current.empiricalRange?.historicalCoverage)}</strong
							>
							<p>Observed coverage on later backtests</p></Card.Root
						>
					</div>
					<Card.Root class="history-card">
						<div class="card-heading">
							<div>
								<span class="eyebrow">{current.history.length} OFFICIAL OBSERVATIONS</span>
								<h2>{current.name}</h2>
								<p>{current.geography} · {current.unit}</p>
							</div>
							<Badge variant="secondary">{modelName(current.model)}</Badge>
						</div>
						{#if chart}<div class="forecast-plot" bind:clientWidth={chartContainerWidth}>
								<svg
									viewBox={`0 0 ${chart.width} ${chart.height}`}
									role="img"
									aria-label={`Actual monthly passenger movements and exploratory estimates for ${current.name}`}
									><title>Observed history in green; unobserved projections in purple</title
									>{#each [0, 0.5, 1] as fraction (fraction)}<line
											x1="58"
											x2={chart.width - 26}
											y1={chart.y(chart.maximum * fraction)}
											y2={chart.y(chart.maximum * fraction)}
											stroke="#eceaf1"
										/><text
											x="46"
											y={chart.y(chart.maximum * fraction) + 4}
											text-anchor="end"
											class="axis-text">{number(chart.maximum * fraction)}</text
										>{/each}<rect
										x={chart.lastX}
										y="15"
										width={Math.max(0, chart.width - chart.lastX - 26)}
										height={chart.height - 55}
										fill="#f4f0fc"
									/><path d={chart.actual} fill="none" stroke="#66894e" stroke-width="2.5" /><path
										d={chart.projection}
										fill="none"
										stroke="#8974b1"
										stroke-width="2.5"
										stroke-dasharray="7 5"
									/>{#if chart.range}<line
											x1={chart.finalX}
											x2={chart.finalX}
											y1={chart.y(chart.range.lower)}
											y2={chart.y(chart.range.upper)}
											stroke="#b6a6d1"
											stroke-width="8"
											stroke-linecap="round"
										/>{/if}{#each chart.labels as item (item.month)}<text
											x={item.x}
											y={chart.height - 14}
											text-anchor="middle"
											class="axis-text">{item.month}</text
										>{/each}</svg
								>
							</div>{/if}
						<div class="legend">
							<span><i class="actual"></i> Official actuals</span><span
								><i class="projection"></i> Unobserved estimates</span
							><span><i class="range"></i> Historical residual range</span>
						</div>
						{#if current.unavailableReason}<p class="qualification">
								{current.unavailableReason}
							</p>{/if}
						{#if current.empiricalRange}<div class="range-note">
								<strong
									>{number(current.empiricalRange.lower)}–{number(current.empiricalRange.upper)} movements</strong
								>
								<p>
									{current.empiricalRange.label}. Based on {current.empiricalRange.residualCount} earlier
									errors withheld from model selection; later historical coverage is {percent(
										current.empiricalRange.historicalCoverage
									)}.
								</p>
							</div>{/if}
						<p class="qualification">{current.qualification}</p>
						{#if current.diagnostics}<div class="reliability-note">
								<strong>Planning reliability</strong
								>{#each current.diagnostics.notes as note (note)}<p>{note}</p>{/each}
							</div>{/if}
					</Card.Root>
					<div class="forecast-bottom">
						<Card.Root class="interpretation"
							><h3>Use this for aggregate planning</h3>
							<p>
								{current.modelCard.intendedUse}. Compare seasonal and recent-history baselines
								before making a resource decision.
							</p>
							<Button
								variant="ghost"
								size="sm"
								onclick={() => {
									view = 'evaluation';
								}}>Inspect backtests <ArrowUpRight size={14} /></Button
							></Card.Root
						><Card.Root class="interpretation tinted"
							><h3>Keep the source boundaries visible</h3>
							<p>
								Movements are not unique passengers. No stop-level demand, peak-hour load or
								occupancy is inferred. Ferry endpoint counts stay separate.
							</p>
							<a href={current.sourceUrl} target="_blank" rel="noreferrer"
								>Open the official workbook <ArrowUpRight size={13} /></a
							></Card.Root
						>
					</div>
				{/if}
			</Tabs.Content>
			<Tabs.Content value="evaluation">
				<Card.Root class="evaluation-card">
					<div class="card-heading">
						<div>
							<span class="eyebrow">CHRONOLOGICAL EVALUATION</span>
							<h2>Can this model beat a simple baseline?</h2>
							<p>
								Model choice uses earlier outcomes; the six later origins are reserved for
								evaluation.
							</p>
						</div>
						<NativeSelect.Root aria-label="Backtest passenger series" bind:value={seriesId}
							>{#each bundle.monthly as item (item.seriesId)}<option value={item.seriesId}
									>{item.name}</option
								>{/each}</NativeSelect.Root
						>
					</div>
					{#if current?.evaluation}
						<div class="evaluation-callout">
							<History size={18} />
							<p>
								<strong>{current.horizonMonths}-month horizon</strong> · {month(
									current.evaluation.firstTargetMonth
								)}–{month(current.evaluation.lastTargetMonth)} evaluation targets. Selection ends {current
									.selection?.lastTargetMonth}, with a {current.selection?.embargoMonths}-month
								target embargo.
							</p>
						</div>
						<div class="method-partitions">
							<article>
								<span>1. Select</span><strong
									>{current.selection?.origins ?? 0} earlier origins</strong
								><small>MAE chooses the policy; complexity requires a 5% improvement.</small>
							</article>
							<article>
								<span>2. Calibrate</span><strong
									>{current.selection?.calibrationOrigins ?? 0} separate origins</strong
								><small
									>{current.empiricalRange
										? `${current.empiricalRange.calibrationFirstTarget}–${current.empiricalRange.calibrationCutoff}`
										: 'Not enough history at this horizon; no range is claimed.'}</small
								>
							</article>
							<article>
								<span>3. Evaluate</span><strong>{current.evaluation.n} later origins</strong><small
									>These outcomes affect the diagnostics only; selection and calibration stay
									locked.</small
								>
							</article>
						</div>
						<p class="qualification">
							{current.selection?.reason}{#if current.parameters?.weights}
								Ensemble weights: {Object.entries(current.parameters.weights)
									.map(([name, weight]) => `${modelName(name)} ${percent(weight)}`)
									.join(' · ')}.{/if}
						</p>
						<div class="table-scroll">
							<table>
								<caption class="sr-only">Forecast model comparisons</caption><thead
									><tr
										><th>Model</th><th>Selection MAE</th><th>Later MAE</th><th>Later WAPE</th><th
											>Target estimate</th
										></tr
									></thead
								><tbody
									>{#each current.benchmarks as item (item.model)}<tr
											class:selected-row={item.model === current.model}
											><td
												><strong>{modelName(item.model)}</strong
												>{#if item.model === current.model}<Badge variant="secondary"
														>Selected</Badge
													>{/if}</td
											><td>{number(item.selectionMae)}</td><td>{number(item.metrics.mae)}</td><td
												>{percent(item.metrics.wape)}</td
											><td>{number(item.estimate)}</td></tr
										>{/each}</tbody
								>
							</table>
						</div>
						<p class="qualification">
							A model selected on earlier origins may perform worse on later ones. Current skill
							versus last-month: {percent(current.evaluation.skill?.lastMonth)}; versus
							same-month-last-year: {percent(current.evaluation.skill?.seasonalNaive)}. Negative
							skill means the baseline did better.
						</p>
						<div class="diagnostic-strip">
							<span
								>Signed bias (actual − estimate): <strong>{number(current.evaluation.bias)}</strong
								></span
							><span
								>Seasonal scaled absolute error: <strong
									>{current.evaluation.mase?.toFixed(2) ?? 'Unavailable'}</strong
								></span
							><span
								>Recent 12-month mean change: <strong
									>{percent(current.diagnostics?.annualMeanChange)}</strong
								></span
							>
						</div>
						<h3 class="backtest-title">Every held-out forecast</h3>
						<div class="table-scroll">
							<table>
								<caption class="sr-only"
									>Held-out passenger forecasts and actual observations</caption
								><thead
									><tr
										><th>Training ended</th><th>Target</th><th>Estimate</th><th>Official actual</th
										><th>Actual − estimate</th></tr
									></thead
								><tbody
									>{#each current.backtest as row (row.targetMonth)}<tr
											><td>{row.trainingCutoff}</td><td>{row.targetMonth}</td><td
												>{number(row.estimate)}</td
											><td>{number(row.actual)}</td><td
												>{row.error > 0 ? '+' : ''}{number(row.error)}</td
											></tr
										>{/each}</tbody
								>
							</table>
						</div>
					{:else}<p class="qualification">
							{current?.unavailableReason ?? 'No backtest available for this target.'}
						</p>{/if}
				</Card.Root>
			</Tabs.Content>
			<Tabs.Content value="analysis"
				>{#if view === 'analysis'}<ForecastAnalysis
						onsourcechange={() => {
							void load();
							void loadIssues();
						}}
					/>{/if}</Tabs.Content
			>
			<Tabs.Content value="issues">
				<Card.Root class="issues-card"
					><div class="card-heading">
						<div>
							<span class="eyebrow">IMMUTABLE DECISION RECORD</span>
							<h2>Frozen forecasts</h2>
							<p>
								Preserve the original estimates and score them only when a later checked publication
								arrives.
							</p>
						</div>
						<Button variant="outline" size="sm" disabled={issuesLoading} onclick={loadIssues}
							><RefreshCw size={14} />
							{issuesLoading ? 'Loading receipts…' : 'Refresh receipts'}</Button
						>
					</div>
					{#each issues as item (item.issue.id)}<article class="issue-row">
							<div>
								<Badge variant="outline"
									><LockKeyhole size={12} />
									{item.integrityVerified ? 'Integrity verified' : 'Unverified'}</Badge
								>
								<h3>{month(item.issue.target.month)} passenger outlook</h3>
								<p>
									Issued {new Date(item.issue.issuedAt).toLocaleString('en-GB', {
										timeZone: 'Indian/Maldives'
									})} MVT · {item.issue.forecasts.length} source categories
								</p>
								<small>{item.issue.provenance.modelVersion}</small>
								{#if item.issue.provenance.modelVersion !== bundle.provenance.modelVersion}
									<p>
										Historical model version. This receipt retains its original method and ranges.
									</p>
								{/if}
								<div class="score-list">
									{#each item.scores as score (score.seriesId)}<span
											>{item.issue.forecasts.find(
												(forecast) => forecast.seriesId === score.seriesId
											)?.name ?? score.seriesId}:
											<strong
												>{score.status === 'pending'
													? 'Awaiting actual'
													: score.status === 'later-vintage-score'
														? `${number(score.absoluteError)} absolute error`
														: 'Not eligible to score'}</strong
											></span
										>{/each}
								</div>
							</div>
							<Button
								variant="outline"
								size="sm"
								onclick={() => download(item, `forecast-receipt-${item.issue.id}.json`)}
								><Download size={14} /> Receipt</Button
							>
						</article>{:else}{#if issuesLoading}<div class="empty-state" role="status">
								<History size={22} />
								<h3>Loading frozen forecasts…</h3>
								<p>Checking saved receipts and their original inputs.</p>
							</div>{:else if !issuesError}<div class="empty-state">
								<LockKeyhole size={22} />
								<h3>No frozen forecast yet</h3>
								<p>
									Choose a supported current or future target, then freeze the forecast before the
									actual is published.
								</p>
							</div>{/if}{/each}
					{#if issuesError}<div class="feedback error" role="alert">
							{issuesError}<Button
								size="sm"
								variant="outline"
								disabled={issuesLoading}
								onclick={loadIssues}>Retry receipts</Button
							>
						</div>{/if}
				</Card.Root>
			</Tabs.Content>
		</Tabs.Root>
		<Card.Root class="method-card"
			><details>
				<summary>Sources, model choices and limitations</summary>
				<p>{bundle.provenance.revisionQualification}</p>
				<p>{current?.modelCard.evaluation}</p>
				<ul>
					{#each bundle.dataQualityNotes as note (note)}<li>{note}</li>{/each}
				</ul>
				<p>{bundle.bus.qualification}</p>
				<div class="source-links">
					{#each bundle.provenance.sources as source (source.id)}<a
							href={source.url}
							target="_blank"
							rel="noreferrer">{source.id} <ArrowUpRight size={12} /></a
						>{/each}
				</div>
			</details></Card.Root
		>
	{:else if loading}<Card.Root class="empty-state" role="status"
			><TrendingUp size={26} />
			<h2>Loading the checked passenger history…</h2>
			<p>
				Forecasts use official monthly publications and retain their source qualifications.
			</p></Card.Root
		>{/if}
</section>

<style>
	.forecast-workspace {
		max-width: 1440px;
		margin: 0 auto;
		padding: 32px 38px 48px;
		min-width: 0;
	}
	.workspace-heading,
	.card-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 24px;
		margin-bottom: 23px;
	}
	.workspace-heading p,
	.card-heading p {
		color: var(--muted-foreground);
		margin-top: 7px;
	}
	.eyebrow {
		display: block;
		color: #726781;
		font-size: 10px;
		font-weight: 650;
		letter-spacing: 1.5px;
		margin-bottom: 8px;
	}
	.forecast-workspace :global(.forecast-controls) {
		padding: 18px 22px;
		margin-bottom: 24px;
		gap: 10px;
	}
	.forecast-workspace :global(.forecast-controls form) {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}
	.forecast-workspace :global(.forecast-controls label) {
		display: flex;
		gap: 7px;
		align-items: center;
		font-size: 12px;
		font-weight: 600;
	}
	.forecast-workspace :global(.forecast-controls input) {
		width: 168px;
	}
	.control-spacer {
		flex: 1;
	}
	.source-caption {
		color: var(--muted-foreground);
		font-size: 11px;
	}
	.feedback {
		margin: 16px 0;
		padding: 14px 18px;
		border-radius: 14px;
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 15px;
		font-size: 13px;
	}
	.feedback.error {
		background: #fbeeed;
		color: #984137;
	}
	.feedback.success {
		background: #e7f0df;
		color: #446538;
	}
	.tab-count {
		margin-left: 5px;
		font-size: 10px;
	}
	.forecast-workspace :global(.forecast-tabs [data-slot='tabs-list']) {
		margin-bottom: 20px;
		max-width: 100%;
	}
	.reliability-note {
		margin-top: 16px;
		border-left: 3px solid #b8a2cd;
		background: #f8f5fb;
		padding: 13px 16px;
		border-radius: 0 12px 12px 0;
	}
	.reliability-note strong {
		font-size: 12px;
	}
	.reliability-note p {
		font-size: 11px;
		color: #776682;
		line-height: 1.7;
		margin-top: 5px;
	}
	.method-partitions {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 12px;
		margin: 18px 0;
	}
	.method-partitions article {
		display: grid;
		gap: 7px;
		padding: 17px;
		background: #f2eef8;
		border-radius: 13px;
	}
	.method-partitions span {
		font-size: 10px;
		color: #81689a;
		font-weight: 650;
	}
	.method-partitions strong {
		font-size: 13px;
	}
	.method-partitions small {
		color: #796c84;
		font-size: 11px;
		line-height: 1.65;
	}
	.diagnostic-strip {
		display: flex;
		gap: 18px;
		flex-wrap: wrap;
		padding: 14px 0;
		font-size: 11px;
		color: #7a6985;
	}
	@media (max-width: 700px) {
		.method-partitions {
			grid-template-columns: 1fr;
		}
		.forecast-workspace :global(.forecast-tabs [data-slot='tabs-list']) {
			display: grid;
			grid-template-columns: repeat(2, minmax(0, 1fr));
			height: auto;
			width: 100%;
		}
		.forecast-workspace :global(.forecast-tabs [data-slot='tabs-trigger']) {
			min-height: 38px;
			white-space: normal;
		}
	}
	.forecast-series {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 15px;
		margin-bottom: 19px;
	}
	.forecast-workspace :global(.series-card) {
		height: auto;
		padding: 19px;
		text-align: left;
		justify-content: space-between;
		min-width: 0;
		white-space: normal;
		gap: 10px;
		background: white;
		border: 1px solid #e5e1eb;
		border-radius: 18px;
	}
	.forecast-workspace :global(.series-card.selected) {
		background: #eee9f7;
		border-color: #aa98c8;
	}
	.forecast-workspace :global(.series-card span) {
		display: grid;
		gap: 5px;
	}
	.forecast-workspace :global(.series-card strong) {
		font-size: 12px;
		line-height: 1.5;
	}
	.forecast-workspace :global(.series-card small) {
		color: #716879;
		font-size: 10px;
	}
	.forecast-workspace :global(.series-card b) {
		font-size: 22px;
		font-weight: 550;
		letter-spacing: -0.8px;
		white-space: nowrap;
	}
	.mode-label {
		font-size: 9px;
		color: #736088;
		font-weight: 650;
		letter-spacing: 1px;
	}
	.forecast-metrics {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 16px;
		margin-bottom: 20px;
	}
	.forecast-workspace :global(.metric-card) {
		padding: 23px;
		gap: 12px;
	}
	.forecast-workspace :global(.metric-card.featured) {
		background: #e4eedb;
		border-color: #dce7d2;
	}
	.metric-label {
		color: #64606e;
		font-size: 12px;
	}
	.forecast-workspace :global(.metric-card strong) {
		font-size: 32px;
		font-weight: 550;
		letter-spacing: -1.2px;
		line-height: 1;
	}
	.forecast-workspace :global(.metric-card p) {
		font-size: 10px;
		color: #6c6775;
		line-height: 1.6;
	}
	.forecast-workspace :global(.history-card),
	.forecast-workspace :global(.evaluation-card),
	.forecast-workspace :global(.issues-card) {
		padding: 27px;
		margin-bottom: 20px;
		gap: 0;
	}
	.forecast-plot {
		width: 100%;
		margin-top: 8px;
		min-width: 0;
	}
	.forecast-plot svg {
		width: 100%;
		height: auto;
		min-height: 170px;
		overflow: visible;
	}
	.axis-text {
		fill: #716c7a;
		font-size: 10px;
	}
	.legend {
		display: flex;
		gap: 25px;
		flex-wrap: wrap;
		font-size: 11px;
		color: #6c6478;
		margin: 8px 0 20px;
	}
	.legend span {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	.legend i {
		width: 16px;
		height: 3px;
		display: inline-block;
		border-radius: 3px;
	}
	.legend .actual {
		background: #66894e;
	}
	.legend .projection {
		background: #8974b1;
	}
	.legend .range {
		background: #b6a6d1;
		height: 9px;
		width: 9px;
	}
	.range-note {
		padding: 15px 18px;
		border-radius: 13px;
		background: #f3eff9;
		margin-bottom: 14px;
	}
	.range-note strong {
		font-size: 14px;
		font-weight: 600;
	}
	.range-note p {
		color: #6e617e;
		font-size: 11px;
		margin-top: 5px;
	}
	.qualification {
		color: #6f667c;
		font-size: 11px;
		line-height: 1.75;
		margin-top: 14px;
	}
	.forecast-bottom {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 20px;
		margin-bottom: 20px;
	}
	.forecast-workspace :global(.interpretation) {
		padding: 23px;
		gap: 10px;
	}
	.forecast-workspace :global(.interpretation.tinted) {
		background: #efedf6;
	}
	.forecast-workspace :global(.interpretation p) {
		color: #706979;
		font-size: 12px;
	}
	.forecast-workspace :global(.interpretation a) {
		display: flex;
		gap: 6px;
		align-items: center;
		font-size: 12px;
		text-decoration: underline;
		margin-top: 6px;
	}
	.evaluation-callout {
		background: #f2eff8;
		padding: 17px;
		display: flex;
		gap: 12px;
		align-items: center;
		margin-bottom: 20px;
		border-radius: 14px;
		color: #6d617d;
	}
	.evaluation-callout :global(svg) {
		flex-shrink: 0;
	}
	.evaluation-callout p {
		font-size: 12px;
	}
	.table-scroll {
		overflow-x: auto;
		width: 100%;
		min-width: 0;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
		text-align: left;
		min-width: 650px;
	}
	th {
		color: #7b7486;
		font-weight: 500;
		font-size: 10px;
		padding: 12px 13px;
		border-bottom: 1px solid #e9e5ee;
	}
	td {
		padding: 15px 13px;
		border-bottom: 1px solid #efecf3;
		font-variant-numeric: tabular-nums;
	}
	td strong {
		font-size: 12px;
		font-weight: 550;
	}
	td :global([data-slot='badge']) {
		margin-left: 7px;
	}
	.selected-row {
		background: #f5f1fb;
	}
	.backtest-title {
		margin: 27px 0 9px;
	}
	.issue-row {
		padding: 22px 0;
		border-top: 1px solid #ebe7f0;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 20px;
	}
	.issue-row h3 {
		margin-top: 12px;
		font-size: 15px;
	}
	.issue-row p,
	.issue-row small {
		color: #776c82;
		font-size: 11px;
	}
	.score-list {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 20px;
		margin-top: 14px;
		font-size: 11px;
		color: #72677e;
	}
	.forecast-workspace :global(.method-card) {
		padding: 20px 24px;
	}
	.forecast-workspace :global(.method-card summary) {
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.forecast-workspace :global(.method-card p) {
		color: #73687f;
		margin-top: 13px;
		font-size: 12px;
	}
	.forecast-workspace :global(.method-card ul) {
		color: #73687f;
		font-size: 11px;
		line-height: 1.8;
		padding-left: 18px;
	}
	.source-links {
		display: flex;
		flex-wrap: wrap;
		gap: 14px;
		font-size: 11px;
		margin-top: 18px;
	}
	.source-links a {
		display: flex;
		gap: 5px;
		align-items: center;
		text-decoration: underline;
	}
	.empty-state {
		padding: 38px 26px;
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		color: #786982;
	}
	.empty-state p {
		max-width: 460px;
		font-size: 12px;
	}
	@media (max-width: 1050px) {
		.forecast-workspace {
			padding: 26px;
		}
		.forecast-metrics {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.forecast-series {
			grid-template-columns: 1fr;
		}
		.forecast-workspace :global(.series-card) {
			padding: 15px 20px;
		}
		.forecast-workspace :global(.series-card span) {
			gap: 2px;
		}
		.forecast-workspace :global(.series-card b) {
			font-size: 24px;
		}
	}
	@media (max-width: 600px) {
		.forecast-workspace {
			padding: 23px 14px 36px;
		}
		.workspace-heading {
			align-items: flex-start;
			flex-direction: column;
			gap: 15px;
		}
		.workspace-heading h1 {
			font-size: 28px;
		}
		.forecast-workspace :global(.forecast-controls) {
			padding: 17px;
		}
		.forecast-workspace :global(.forecast-controls form) {
			gap: 10px;
		}
		.forecast-workspace :global(.forecast-controls label) {
			width: 100%;
		}
		.forecast-workspace :global(.forecast-controls input) {
			width: 145px;
		}
		.control-spacer {
			display: none;
		}
		.forecast-workspace :global(.forecast-controls button) {
			font-size: 11px;
			padding: 0 10px;
		}
		.forecast-metrics {
			gap: 10px;
		}
		.forecast-workspace :global(.metric-card) {
			padding: 19px 16px;
		}
		.forecast-workspace :global(.metric-card strong) {
			font-size: 28px;
		}
		.metric-label {
			font-size: 10px;
		}
		.card-heading {
			align-items: flex-start;
			flex-direction: column;
			gap: 12px;
		}
		.card-heading h2 {
			font-size: 20px;
		}
		.forecast-workspace :global(.history-card),
		.forecast-workspace :global(.evaluation-card),
		.forecast-workspace :global(.issues-card) {
			padding: 20px 17px;
		}
		.forecast-plot svg {
			min-height: 145px;
		}
		.legend {
			gap: 10px 18px;
			font-size: 10px;
		}
		.forecast-bottom {
			grid-template-columns: 1fr;
			gap: 14px;
		}
		.forecast-workspace :global(.forecast-tabs [data-slot='tabs-list']) {
			width: 100%;
		}
		.forecast-workspace :global(.forecast-tabs [data-slot='tabs-trigger']) {
			font-size: 10px;
			padding: 0 8px;
		}
		.tab-count {
			display: none;
		}
		.issue-row {
			flex-direction: column;
		}
		.evaluation-callout {
			padding: 14px;
		}
		.forecast-workspace :global(.method-card) {
			padding: 18px;
		}
	}
</style>
