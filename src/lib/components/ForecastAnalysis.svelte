<script lang="ts">
	import { downloadJson as download } from '#lib/download.js';
	import { onMount, untrack } from 'svelte';
	import { ArrowUpRight, Download, FileUp, RefreshCw, ShieldCheck } from '@lucide/svelte';
	import { api, subscribeApiInvalidation } from '#lib/api.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';

	let { active = true }: { active?: boolean } = $props();
	type Analysis = {
		summary: {
			collections: number;
			availableCollections: number;
			uniqueSourceArtifacts: number;
			forecastableSeries: number;
			passengerObservations: number;
			emptyCollections: string[];
			collectionsWithExactDuplicates: string[];
		};
		insights: { title: string; detail: string }[];
		passengerProfiles: {
			seriesId: string;
			name: string;
			observations: number;
			firstMonth: string;
			lastMonth: string;
			duplicateMonths: number;
			missingMonths: number;
			invalidCounts: number;
		}[];
		horizonDiagnostics: {
			seriesId: string;
			horizonMonths: number;
			model: string;
			evaluation: {
				mae: number;
				wape: number | null;
				bias: number;
				skill: { lastMonth: number | null; seasonalNaive: number | null };
			} | null;
			empiricalRange: { historicalCoverage: number; residualCount: number } | null;
		}[];
		collectionProfiles: {
			id: string;
			title: string;
			category: string;
			status: string;
			row_count: number | null;
			grain?: string;
			exactDuplicateRows?: number;
			nullCellRate?: number | null;
			qualification: string;
			forecastFitness: string;
			provenance?: { receipt: { artifact: string; sha256: string } };
		}[];
		methods: { title: string; url: string }[];
		limitations: string[];
		analysisFingerprint: string;
	};
	type SourceVersion = {
		versionId: string;
		qualification: string;
		differences: {
			seriesId: string;
			name: string;
			revisionCount: number;
			revisions: { month: string; previous: number; incoming: number }[];
			addedMonths: { month: string; value: number }[];
			firstMonth: string;
			lastMonth: string;
			identicalPreviousMonthFlags: string[];
		}[];
		review: { note: string; acceptedAt: string } | null;
	};
	let analysis = $state.raw<Analysis | null>(null);
	let selectedSeries = $state('');
	let loading = $state(false);
	let mounted = $state(false);
	let needsRefresh = $state(false);
	let importing = $state(false);
	let error = $state('');
	let message = $state('');
	let staged = $state<SourceVersion | null>(null);
	let sourceFile = $state<File | null>(null);
	let reviewNote = $state('');
	let acceptRevisions = $state(false);
	let history = $state.raw<{
		activeReceipt: { data_status: string; sha256: string };
		versions: SourceVersion[];
	} | null>(null);
	let controller: AbortController | undefined;
	const selectedHorizons = $derived(
		analysis?.horizonDiagnostics.filter((item) => item.seriesId === selectedSeries) ?? []
	);
	const maximumError = $derived(
		Math.max(0.01, ...selectedHorizons.map((item) => item.evaluation?.wape ?? 0))
	);
	const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
	const format = (value: number | null | undefined) =>
		value == null ? '—' : numberFormatter.format(value);
	const percent = (value: number | null | undefined) =>
		value == null ? 'Unavailable' : `${(value * 100).toFixed(1)}%`;
	async function load() {
		needsRefresh = false;
		controller?.abort();
		const request = new AbortController();
		controller = request;
		loading = true;
		error = '';
		try {
			const [report, versions] = await Promise.all([
				api<Analysis>('forecasts/analysis', undefined, request.signal),
				api<typeof history>('forecasts/sources', undefined, request.signal)
			]);
			if (request.signal.aborted) return;
			analysis = report;
			history = versions;
			if (!report.passengerProfiles.some((item) => item.seriesId === selectedSeries))
				selectedSeries = report.passengerProfiles[0]?.seriesId ?? '';
		} catch (caught) {
			if (!request.signal.aborted)
				error = caught instanceof Error ? caught.message : 'Source analysis could not be loaded.';
		} finally {
			if (controller === request) loading = false;
		}
	}

	async function template() {
		try {
			download(await api('forecasts/sources/template'), 'passenger-source-contract.json');
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Source contract unavailable.';
		}
	}
	async function stage() {
		if (!sourceFile || importing) return;
		importing = true;
		error = '';
		message = '';
		staged = null;
		try {
			if (sourceFile.size > 2_000_000)
				throw new Error('Select a passenger source JSON smaller than 2 MB.');
			const source = JSON.parse(await sourceFile.text());
			staged = await api<SourceVersion>('forecasts/sources/stage', { source });
			reviewNote = '';
			acceptRevisions = false;
			message =
				'Source validated and staged. Review new months and historical changes before accepting it.';
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Import could not be staged.';
		} finally {
			importing = false;
		}
	}
	async function accept() {
		if (!staged || importing || reviewNote.trim().length < 20) return;
		importing = true;
		error = '';
		try {
			await api(`forecasts/sources/${staged.versionId}/accept`, {
				review_note: reviewNote,
				accept_revisions: acceptRevisions
			});
			staged = null;
			sourceFile = null;
			message =
				'Reviewed source accepted. New forecasts use this version; frozen forecasts retain their original inputs.';
			await load();
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Source could not be accepted.';
		} finally {
			importing = false;
		}
	}
	onMount(() => {
		mounted = true;
		const unsubscribe = subscribeApiInvalidation(() => (needsRefresh = true));
		needsRefresh = true;
		return () => {
			unsubscribe();
			controller?.abort();
		};
	});
	$effect(() => {
		if (mounted && active && needsRefresh && !importing) untrack(() => void load());
	});
</script>

<section aria-label="Data analysis and prediction method" class="analysis-workspace">
	{#if error}<p class="analysis-feedback error" role="alert">{error}</p>{/if}
	{#if message}<p class="analysis-feedback success" role="status">{message}</p>{/if}
	<Card.Root class="analysis-card">
		<div class="analysis-heading">
			<div>
				<span class="eyebrow">SOURCE FITNESS BEFORE MODELLING</span>
				<h2>What can the data support?</h2>
				<p>Every bundled collection is checked at its own grain before it informs a decision.</p>
			</div>
			<Button variant="outline" size="sm" disabled={loading} onclick={load}
				><RefreshCw size={14} /> {loading ? 'Analysing…' : 'Refresh analysis'}</Button
			>
		</div>
		{#if analysis}
			<div class="audit-metrics">
				<div>
					<strong>{analysis.summary.availableCollections}</strong><span>available collections</span>
				</div>
				<div>
					<strong>{analysis.summary.uniqueSourceArtifacts}</strong><span
						>distinct source artifacts</span
					>
				</div>
				<div>
					<strong>{analysis.summary.passengerObservations}</strong><span
						>trusted monthly observations</span
					>
				</div>
				<div>
					<strong>{analysis.summary.forecastableSeries}</strong><span
						>forecastable passenger categories</span
					>
				</div>
			</div>
			<div class="analysis-insights">
				{#each analysis.insights as insight (insight.title)}<article>
						<ShieldCheck size={16} />
						<div>
							<h3>{insight.title}</h3>
							<p>{insight.detail}</p>
						</div>
					</article>{/each}
			</div>
			<details class="audit-details">
				<summary>Passenger completeness and validation checks</summary>
				<div class="table-scroll">
					<table>
						<thead
							><tr
								><th>Published category</th><th>Observed period</th><th>Months</th><th
									>Duplicate / missing / invalid</th
								></tr
							></thead
						><tbody
							>{#each analysis.passengerProfiles as item (item.seriesId)}<tr
									><td>{item.name}</td><td>{item.firstMonth}–{item.lastMonth}</td><td
										>{item.observations}</td
									><td>{item.duplicateMonths} / {item.missingMonths} / {item.invalidCounts}</td></tr
								>{/each}</tbody
						>
					</table>
				</div>
				<p>
					Empty captured road/notice collections do not establish that roads are clear. Nulls remain
					unknown; demographic categories and source observations are not blindly added.
				</p>
			</details>
		{:else if loading}<p role="status">
				Checking source completeness, grain and historical forecast errors…
			</p>{/if}
	</Card.Root>
	{#if analysis}
		<Card.Root class="analysis-card">
			<div class="analysis-heading">
				<div>
					<span class="eyebrow">MATCH THE METHOD TO THE HORIZON</span>
					<h2>How far ahead is useful?</h2>
					<p>Each bar shows later WAPE for a policy selected without those later outcomes.</p>
				</div>
				<NativeSelect.Root
					aria-label="Horizon diagnostics passenger series"
					bind:value={selectedSeries}
					>{#each analysis.passengerProfiles as item (item.seriesId)}<option value={item.seriesId}
							>{item.name}</option
						>{/each}</NativeSelect.Root
				>
			</div>
			<div class="horizon-chart" aria-label="Forecast error by horizon">
				{#each selectedHorizons as item (item.horizonMonths)}<div class="horizon-column">
						<span>{percent(item.evaluation?.wape)}</span>
						<div class="bar-space">
							<i style={`height:${((item.evaluation?.wape ?? 0) / maximumError) * 100}%`}
								><span class="sr-only"
									>{item.horizonMonths} months: {percent(item.evaluation?.wape)}</span
								></i
							>
						</div>
						<b>{item.horizonMonths}m</b>
					</div>{/each}
			</div>
			<p class="chart-caption">
				Zero-based percentage-error bars · six later origins per horizon · horizons overlap and are
				dependent.
			</p>
			<details class="audit-details">
				<summary>Model, baseline skill and range coverage for every horizon</summary>
				<div class="table-scroll">
					<table>
						<thead
							><tr
								><th>Horizon</th><th>Locked model</th><th>Later MAE</th><th>Later WAPE</th><th
									>Skill vs last month</th
								><th>Range coverage</th></tr
							></thead
						><tbody
							>{#each selectedHorizons as item (item.horizonMonths)}<tr
									><td>{item.horizonMonths} months</td><td>{item.model}</td><td
										>{format(item.evaluation?.mae)}</td
									><td>{percent(item.evaluation?.wape)}</td><td
										>{percent(item.evaluation?.skill.lastMonth)}</td
									><td>{percent(item.empiricalRange?.historicalCoverage)}</td></tr
								>{/each}</tbody
						>
					</table>
				</div>
				<p>
					No range means history cannot sustain a separate calibration block. Six backtests are too
					few to certify future performance.
				</p>
			</details>
		</Card.Root>
		<Card.Root class="analysis-card"
			><div class="analysis-heading">
				<div>
					<span class="eyebrow">INSPECTABLE EVIDENCE</span>
					<h2>Collection quality and modelling fitness</h2>
					<p>
						{analysis.summary.collections} collections retain separate units, dates and source receipts.
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					onclick={() => download(analysis, 'mobility-data-analysis.json')}
					><Download size={14} /> Export analysis</Button
				>
			</div>
			<details class="audit-details">
				<summary>Inspect all collections and their grain</summary>
				<div class="table-scroll">
					<table>
						<thead
							><tr
								><th>Collection and grain</th><th>Records</th><th>Exact duplicates</th><th
									>Null cells</th
								><th>Prediction use</th></tr
							></thead
						><tbody
							>{#each analysis.collectionProfiles as item (item.id)}<tr
									><td
										><strong>{item.title}</strong><small>{item.grain ?? item.qualification}</small
										></td
									><td>{format(item.row_count)}</td><td>{format(item.exactDuplicateRows)}</td><td
										>{percent(item.nullCellRate)}</td
									><td
										><Badge variant="secondary"
											>{item.forecastFitness === 'aggregate-target'
												? 'Target history'
												: 'Decision context'}</Badge
										></td
									></tr
								>{/each}</tbody
						>
					</table>
				</div>
			</details>
			<div class="method-references">
				{#each analysis.methods as method (method.url)}<a
						href={method.url}
						target="_blank"
						rel="noreferrer">{method.title}<ArrowUpRight size={12} /></a
					>{/each}
			</div></Card.Root
		>
	{/if}
	<Card.Root class="analysis-card"
		><div class="analysis-heading">
			<div>
				<span class="eyebrow">REFRESH WITHOUT REWRITING HISTORY</span>
				<h2>Review a new passenger publication</h2>
				<p>
					Stage a source snapshot, inspect its differences, then accept the version with a review
					note.
				</p>
			</div>
			<Button variant="outline" size="sm" onclick={template}
				><Download size={14} /> Source contract</Button
			>
		</div>
		<p class="source-status">
			Active source: {history?.activeReceipt.data_status === 'user_reviewed_import'
				? 'Reviewed imported version'
				: 'Bundled checked snapshot'}. Official publication URLs, SHA-256 receipts, continuous
			months and unchanged category definitions are required. Validation does not independently
			verify the publication contents.
		</p>
		<div class="source-import">
			<label for="passenger-source-file">Passenger source JSON</label><input
				id="passenger-source-file"
				type="file"
				accept="application/json,.json"
				disabled={importing}
				onchange={(event) => {
					sourceFile = event.currentTarget.files?.[0] ?? null;
					staged = null;
				}}
			/><Button disabled={!sourceFile || importing} onclick={stage}
				><FileUp size={14} /> {importing ? 'Working…' : 'Validate and stage'}</Button
			>
		</div>
		{#if staged}<div class="staged-review">
				<h3>Review the staged differences</h3>
				{#each staged.differences as item (item.seriesId)}<article>
						<strong>{item.name}</strong>
						<p>
							{item.addedMonths.length} new months · {item.revisionCount} historical revisions · observed
							through {item.lastMonth}
						</p>
						{#if item.identicalPreviousMonthFlags.length}<p>
								Check repeated previous-month counts in {item.identicalPreviousMonthFlags.join(
									', '
								)} against the publication.
							</p>{/if}
						<details class="audit-details">
							<summary>Inspect every new month and revised value</summary>
							<div class="table-scroll import-diff">
								<table>
									<thead
										><tr
											><th>Month</th><th>Previous</th><th>Incoming movements</th><th>Change</th></tr
										></thead
									><tbody
										>{#each item.addedMonths as point (point.month)}<tr
												><td>{point.month}</td><td>Unobserved</td><td>{format(point.value)}</td><td
													>New observation</td
												></tr
											>{/each}{#each item.revisions as point (point.month)}<tr
												><td>{point.month}</td><td>{format(point.previous)}</td><td
													>{format(point.incoming)}</td
												><td>Historical revision</td></tr
											>{/each}</tbody
									>
								</table>
							</div>
						</details>
					</article>{/each}<label for="passenger-review-note"
					>Publication review note (at least 20 characters)</label
				><Input
					id="passenger-review-note"
					bind:value={reviewNote}
					placeholder="Checked the published table and category definitions…"
				/><label class="revision-check"
					><input type="checkbox" bind:checked={acceptRevisions} /> I reviewed and accept any historical
					revisions listed above.</label
				><Button
					disabled={importing ||
						reviewNote.trim().length < 20 ||
						(staged.differences.some((item) => item.revisionCount > 0) && !acceptRevisions)}
					onclick={accept}>Accept reviewed source version</Button
				>
			</div>{/if}
		{#if history?.versions.length}<details class="audit-details">
				<summary>Imported source version history</summary
				>{#each history.versions as version (version.versionId)}<p>
						{version.versionId.slice(0, 12)} · {version.review
							? `Reviewed ${version.review.acceptedAt.slice(0, 10)}`
							: 'Staged; not active'}<br />{version.review?.note ?? version.qualification}
					</p>{/each}
			</details>{/if}
	</Card.Root>
</section>

<style>
	.analysis-workspace {
		display: grid;
		gap: 20px;
		min-width: 0;
	}
	.analysis-workspace :global(.analysis-card) {
		padding: 26px;
		gap: 18px;
		min-width: 0;
	}
	.analysis-heading {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 22px;
	}
	h2 {
		font-size: 19px;
		font-weight: 600;
		letter-spacing: -0.4px;
	}
	h3 {
		font-size: 13px;
		font-weight: 600;
	}
	p {
		color: #706879;
		font-size: 12px;
		line-height: 1.75;
	}
	.eyebrow {
		display: block;
		color: #726781;
		font-size: 10px;
		letter-spacing: 1.2px;
		font-weight: 650;
		margin-bottom: 7px;
	}
	.audit-metrics {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 12px;
	}
	.audit-metrics div {
		display: grid;
		gap: 5px;
		padding: 18px;
		background: #f2eef8;
		border-radius: 14px;
	}
	.audit-metrics strong {
		font-size: 28px;
		font-weight: 550;
		letter-spacing: -1px;
	}
	.audit-metrics span {
		color: #726781;
		font-size: 11px;
	}
	.analysis-insights {
		display: grid;
		gap: 14px;
	}
	.analysis-insights article {
		display: flex;
		align-items: flex-start;
		gap: 13px;
		padding: 13px 0;
		border-bottom: 1px solid #eee9f4;
	}
	.analysis-insights :global(svg) {
		flex-shrink: 0;
		margin-top: 2px;
		color: #8b76ac;
	}
	.analysis-insights p {
		margin-top: 4px;
	}
	.audit-details summary {
		cursor: pointer;
		color: #68527f;
		font-weight: 600;
		font-size: 12px;
		padding: 12px 0;
	}
	.table-scroll {
		overflow-x: auto;
		max-width: 100%;
	}
	.import-diff {
		max-height: 320px;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		min-width: 680px;
		font-size: 11px;
	}
	th {
		padding: 11px;
		text-align: left;
		background: #f5f2f9;
		font-size: 10px;
		color: #746780;
	}
	td {
		padding: 12px 11px;
		border-bottom: 1px solid #ede8f4;
		color: #554a62;
		vertical-align: top;
	}
	td small {
		display: block;
		max-width: 370px;
		color: #84778f;
		line-height: 1.7;
		margin-top: 4px;
	}
	.horizon-chart {
		display: flex;
		gap: 12px;
		height: 190px;
		padding-top: 8px;
	}
	.horizon-column {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
	}
	.horizon-column > span {
		font-size: 10px;
		color: #776784;
	}
	.horizon-column b {
		font-size: 11px;
		font-weight: 600;
	}
	.bar-space {
		display: flex;
		align-items: flex-end;
		flex: 1;
		width: 100%;
		border-bottom: 1px solid #cbbfda;
	}
	.bar-space i {
		width: 100%;
		background: #b7a3cf;
		border-radius: 6px 6px 0 0;
		min-height: 1px;
	}
	.chart-caption {
		font-size: 10px;
	}
	.method-references {
		display: grid;
		gap: 6px;
	}
	.method-references a {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: #715687;
	}
	.source-import {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}
	.source-import label,
	.staged-review label {
		font-size: 12px;
		color: #695674;
	}
	.source-import input {
		max-width: 100%;
		font-size: 12px;
	}
	.staged-review {
		display: grid;
		gap: 14px;
		background: #f4f0f9;
		border-radius: 16px;
		padding: 20px;
	}
	.staged-review article {
		padding-bottom: 12px;
		border-bottom: 1px solid #ded4ea;
	}
	.staged-review strong {
		font-size: 13px;
	}
	.revision-check {
		display: flex;
		gap: 9px;
		align-items: flex-start;
	}
	.revision-check input {
		margin-top: 3px;
	}
	.analysis-feedback {
		padding: 14px 18px;
		border-radius: 12px;
	}
	.error {
		color: #984137;
		background: #fbeeed;
	}
	.success {
		color: #446538;
		background: #e7f0df;
	}
	@media (max-width: 700px) {
		.analysis-workspace :global(.analysis-card) {
			padding: 19px;
		}
		.analysis-heading {
			flex-direction: column;
			align-items: stretch;
			gap: 12px;
		}
		.audit-metrics {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
		.horizon-chart {
			display: grid;
			grid-template-columns: repeat(6, minmax(0, 1fr));
			gap: 16px 10px;
			height: 340px;
		}
		.horizon-column > span {
			font-size: 10px;
		}
		.horizon-column b {
			font-size: 9px;
		}
	}
</style>
