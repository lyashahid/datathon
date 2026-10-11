<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { ArrowUpRight, ExternalLink, Search, X } from '@lucide/svelte';
	import type { PlanningBaseline } from '#lib/planning/types.ts';
	import type { OperationsBundle } from '#lib/operations/types.ts';
	import type { PolicyEvidenceBundle } from '#lib/server/data/policyEvidenceSource.ts';
	import type { ForecastBundle } from '#lib/prediction/types.ts';
	import { sourceEvidence } from '#lib/policy/sourceEvidence.ts';
	import {
		collectEvidenceSources,
		evidenceDate,
		evidenceText,
		forecastEvidenceSources,
		sourceMatches
	} from './evidencePresentation.ts';

	let {
		baseline,
		operations,
		policyEvidence,
		prediction,
		onShowMap,
		onReviewNotices,
		onShowForecasts,
		onShowDecisions,
		requestedWorkflow
	}: {
		baseline: PlanningBaseline;
		operations: OperationsBundle | null;
		policyEvidence: PolicyEvidenceBundle | null;
		prediction: ForecastBundle | null;
		onShowMap?: () => void;
		onReviewNotices?: () => void;
		onShowForecasts?: () => void;
		onShowDecisions?: () => void;
		requestedWorkflow?: string;
	} = $props();
	let sourceQuery = $state('');
	let sourceGroup = $state('all');
	let sourceCopy = $state('all');
	let sourcePage = $state(0);
	let selectedKey = $state<string | null>(null);
	let inspectorElement: HTMLElement | undefined = $state();
	let islandQuery = $state('');
	const pageSize = 8;
	const count = (value: number | null | undefined) =>
		value == null || !Number.isFinite(value)
			? 'Not available'
			: Math.round(value).toLocaleString('en-GB');
	const numeric = (value: unknown): number | null =>
		typeof value === 'number' && Number.isFinite(value) ? value : null;
	const copyLabels: Record<string, string> = {
		downloaded: 'Saved copy',
		cached: 'Cached copy',
		empty: 'No records',
		unavailable: 'Unavailable',
		'receipt-recorded': 'Receipt only',
		'Status not supplied': 'Not supplied'
	};
	const sourceStatus = (value: string) => copyLabels[value] ?? value;
	function publicLink(value: string | undefined): string | null {
		if (!value) return null;
		try {
			const url = new URL(value);
			return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
		} catch {
			return null;
		}
	}
	function resetSources() {
		sourceQuery = '';
		sourceGroup = 'all';
		sourceCopy = 'all';
		sourcePage = 0;
		selectedKey = null;
	}
	async function selectSource(key: string) {
		selectedKey = key;
		if (typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches) {
			await tick();
			inspectorElement?.scrollIntoView({ block: 'start', behavior: 'instant' });
			inspectorElement?.focus({ preventScroll: true });
		}
	}
	const catalog = $derived(
		collectEvidenceSources([
			{ name: 'Planning map', sources: baseline.sources },
			{
				name: 'Public updates',
				sources: (operations?.sources ?? []).map((source) => ({
					...source,
					license: source.licenseStatus
				}))
			},
			{
				name: 'Policy context',
				sources: (policyEvidence?.sources ?? []).map((source) => ({
					...source,
					license: source.licenseStatus
				}))
			},
			{
				name: 'Passenger forecasts',
				sources: forecastEvidenceSources(prediction)
			}
		])
	);
	const sourceGroups = $derived([...new Set(catalog.flatMap((source) => source.groups))]);
	$effect(() => {
		const requested = requestedWorkflow;
		if (!requested) return;
		untrack(() => {
			if (!sourceGroups.includes(requested)) return;
			sourceGroup = requested;
			sourceQuery = '';
			sourceCopy = 'all';
			sourcePage = 0;
			selectedKey =
				requested === 'Passenger forecasts'
					? (catalog.find((source) => source.url === prediction?.monthly[0]?.sourceUrl)?.key ??
						null)
					: null;
		});
	});
	const matches = $derived(
		catalog.filter(
			(source) =>
				sourceMatches(source, sourceQuery) &&
				(sourceGroup === 'all' || source.groups.includes(sourceGroup)) &&
				(sourceCopy === 'all' || sourceEvidence(source).status === sourceCopy)
		)
	);
	const pageCount = $derived(Math.max(1, Math.ceil(matches.length / pageSize)));
	const currentPage = $derived(Math.min(sourcePage, pageCount - 1));
	const shownSources = $derived(
		matches.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
	);
	const selectedSource = $derived(
		shownSources.find((source) => source.key === selectedKey) ?? shownSources[0] ?? null
	);
	const selectedAudit = $derived(selectedSource ? sourceEvidence(selectedSource) : null);
	const modeledPopulation = $derived(
		baseline.origins.length
			? baseline.origins.reduce((total, origin) => total + origin.population2026, 0)
			: null
	);
	const islandScope = $derived(
		baseline.islands.map((island) => {
			const origins = baseline.origins.filter((origin) => origin.islandId === island.id);
			return {
				...island,
				cells: origins.length,
				modeled: origins.length
					? origins.reduce((total, origin) => total + origin.population2026, 0)
					: null,
				projected: numeric(island.population2026),
				qualification: evidenceText(island.qualification)
			};
		})
	);
	const national = $derived(operations?.nationalReadiness ?? []);
	const located = $derived(national.filter((island) => island.coordinates !== null).length);
	const routed = $derived(national.filter((island) => island.routingAvailable).length);
	const populationOnly = $derived(national.filter((island) => !island.routingAvailable).length);
	const nationalMatches = $derived(
		national.filter((island) =>
			`${island.name} ${island.atoll}`.toLowerCase().includes(islandQuery.trim().toLowerCase())
		)
	);
	const notices = $derived([
		...new Map(
			[...(operations?.noticeCandidates ?? []), ...(operations?.roadEvents ?? [])].map((notice) => [
				notice.id,
				notice
			])
		).values()
	]);
	const gaps = $derived([
		...new Set([
			...baseline.transit.gaps,
			...(Array.isArray(baseline.assumptions?.sourceGaps)
				? baseline.assumptions.sourceGaps.filter((gap): gap is string => typeof gap === 'string')
				: []),
			...(operations?.gaps ?? []),
			...(policyEvidence?.gaps ?? [])
		])
	]);
	const observedDirections = $derived(
		baseline.transit.patterns.filter(
			(pattern) => pattern.provenance === 'observed' && pattern.enabled !== false
		).length
	);
	const assumedDirections = $derived(
		baseline.transit.patterns.filter(
			(pattern) => pattern.provenance === 'assumed' && pattern.enabled !== false
		).length
	);
	const assumptionEntries = $derived(
		Object.entries(baseline.assumptions ?? {}).filter(
			([, value]) =>
				typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean'
		)
	);
</script>

<section
	class="evidence-workspace"
	aria-labelledby="evidence-title"
	data-testid="evidence-workspace"
>
	<header class="page-intro">
		<div>
			<p class="eyebrow">Evidence & coverage</p>
			<h1 id="evidence-title">Know what the data can support.</h1>
			<p class="intro">
				Check whether a result is fit for your decision, then inspect the sources behind it.
			</p>
		</div>
		{#if onShowMap}<button class="secondary" onclick={onShowMap}
				>Open planning map <ArrowUpRight size={15} aria-hidden="true" /></button
			>{/if}
	</header>

	<div class="assessment-grid">
		<section class="panel applicability" aria-labelledby="applicability-title">
			<div class="section-heading">
				<h2 id="applicability-title">What can I use this for?</h2>
				<span class="subtle">Evidence in this release</span>
			</div>
			<div class="claim-list">
				<article>
					<div class="claim-title">
						<h3>
							{#if onShowDecisions}<button class="claim-link" onclick={onShowDecisions}
									>Compare access to services <ArrowUpRight size={13} aria-hidden="true" /></button
								>{:else}Compare access to services{/if}
						</h3>
						<span class="status conditional">With conditions</span>
					</div>
					<p>
						Greater Malé; projected residents. Partial calendars, facility evidence and planner
						assumptions constrain journey estimates.
					</p>
				</article>
				<article>
					<div class="claim-title">
						<h3>
							{#if onShowForecasts}<button class="claim-link" onclick={onShowForecasts}
									>Monthly passenger outlook <ArrowUpRight size={13} aria-hidden="true" /></button
								>{:else}Monthly passenger outlook{/if}
						</h3>
						<span class="status conditional">{prediction ? 'Exploratory' : 'Unavailable'}</span>
					</div>
					<p>
						{prediction
							? 'Aggregate monthly totals only. Check benchmark performance and uncertainty before planning capacity.'
							: 'The forecast bundle is unavailable in this session.'}
					</p>
				</article>
			</div>
			<div class="unsupported-claims">
				<article>
					<div class="claim-title">
						<h3>Congestion & crowding</h3>
						<span class="status unavailable">Not supported</span>
					</div>
					<p>
						Road speeds and passenger loads are unavailable. Delays are assumptions; moving vehicles
						are illustrative.
					</p>
				</article>
				<article>
					<div class="claim-title">
						<h3>Nationwide access</h3>
						<span class="status unavailable">Not supported</span>
					</div>
					<p>
						{national.length
							? `${count(populationOnly)} of ${count(national.length)} national register records have no routing model.`
							: 'National readiness records are not available.'} Map points do not measure access.
					</p>
				</article>
			</div>
		</section>
		<aside class="panel priorities" aria-labelledby="priorities-title">
			<h2 id="priorities-title">Before acting</h2>
			<ol>
				<li>
					<strong>Confirm service availability</strong>
					<p>
						Confirm dated calendars, paired arrivals and facility hours with the operator and
						destination.
					</p>
				</li>
				<li>
					<strong>Validate the outlook</strong>
					<p>Check a simple benchmark and later published actuals before committing capacity.</p>
				</li>
				<li>
					<strong>Observe road conditions</strong>
					<p>
						Obtain measured speeds or a mapped, dated notice. An empty feed cannot confirm a clear
						road.
					</p>
				</li>
			</ol>
		</aside>
	</div>

	<section class="panel library" aria-labelledby="sources-title">
		<div class="section-heading">
			<div>
				<h2 id="sources-title">
					Source library <span class="count-label">{catalog.length} records</span>
				</h2>
			</div>
			<span class="subtle">Different file versions stay separate</span>
		</div>
		<p class="section-note">
			Inspect reporting periods, coverage and reuse terms. A saved copy does not establish fitness
			for a decision.
		</p>
		<div class="library-toolbar">
			<label class="search-field"
				><Search size={16} aria-hidden="true" /><span class="sr-only"
					>Search sources by name, publisher, period or source ID</span
				><input
					type="search"
					bind:value={sourceQuery}
					oninput={() => {
						sourcePage = 0;
						selectedKey = null;
					}}
					placeholder="Search sources, publishers or reporting years"
				/></label
			>
			<label class="filter-field"
				><span>Used by</span><select
					bind:value={sourceGroup}
					onchange={() => {
						sourcePage = 0;
						selectedKey = null;
					}}
					><option value="all">All workflows</option>{#each sourceGroups as group (group)}<option
							value={group}>{group}</option
						>{/each}</select
				></label
			>
			<label class="filter-field"
				><span>Copy / receipt</span><select
					bind:value={sourceCopy}
					onchange={() => {
						sourcePage = 0;
						selectedKey = null;
					}}
					><option value="all">All statuses</option><option value="downloaded">Saved copy</option
					><option value="cached">Cached copy</option><option value="empty">No records</option
					><option value="unavailable">Unavailable</option><option value="receipt-recorded"
						>Receipt only</option
					><option value="Status not supplied">Not supplied</option></select
				></label
			>
		</div>
		<div class="library-grid">
			<div class="source-results">
				<div class="results-heading">
					<span aria-live="polite">{matches.length} matching records</span
					>{#if matches.length && (sourceQuery || sourceGroup !== 'all' || sourceCopy !== 'all')}<button
							class="text-link"
							onclick={resetSources}>Clear filters <X size={13} aria-hidden="true" /></button
						>{/if}
				</div>
				{#if shownSources.length}
					<div class="source-column-labels" aria-hidden="true">
						<span>Source / publisher</span><span>Source period</span><span>Copy / receipt</span>
					</div>
					<ul class="source-list" aria-label="Source records">
						{#each shownSources as source (source.key)}{@const audit = sourceEvidence(source)}
							<li data-testid="evidence-source-record">
								<button
									class="source-row"
									class:selected={selectedSource?.key === source.key}
									aria-pressed={selectedSource?.key === source.key}
									onclick={() => selectSource(source.key)}
									><span class="source-name"
										><strong>{audit.title}</strong><span
											>{evidenceText(source.publisher) ?? source.id}</span
										></span
									><span class="source-period">{evidenceDate(audit.reference)}</span><span
										class="source-copy"
										><span
											class="status"
											class:unavailable={[
												'empty',
												'unavailable',
												'receipt-recorded',
												'Status not supplied'
											].includes(audit.status)}>{sourceStatus(audit.status)}</span
										></span
									></button
								>
							</li>
						{/each}
					</ul>
					<div class="pagination">
						<span
							>{currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, matches.length)} of
							{matches.length}</span
						>
						<div>
							<button
								class="secondary"
								disabled={currentPage === 0}
								onclick={() => {
									sourcePage = currentPage - 1;
									selectedKey = null;
								}}>Previous</button
							><button
								class="secondary"
								disabled={currentPage + 1 >= pageCount}
								onclick={() => {
									sourcePage = currentPage + 1;
									selectedKey = null;
								}}>Next</button
							>
						</div>
					</div>
				{:else}<div class="empty-state">
						<h3>No sources match these filters</h3>
						<p>
							Try a publisher, island or reporting year, or clear the filters to inspect the
							complete library.
						</p>
						<button class="secondary" onclick={resetSources}>Clear filters</button>
					</div>{/if}
			</div>
			{#if selectedSource && selectedAudit}{@const link = publicLink(selectedSource.url)}
				<aside
					bind:this={inspectorElement}
					tabindex="-1"
					class="source-inspector"
					aria-label="Selected source details"
					data-testid="evidence-source-inspector"
				>
					<p class="eyebrow">Source details</p>
					<h3>{selectedAudit.title}</h3>
					<p class="publisher">
						{evidenceText(selectedSource.publisher) ?? 'Publisher not supplied'}
					</p>
					<p class="workflow-label">{selectedSource.groups.join(' · ')}</p>
					<dl class="inspector-dates">
						<div>
							<dt>Source period</dt>
							<dd>{evidenceDate(selectedAudit.reference)}</dd>
						</div>
						<div>
							<dt>Copy / receipt</dt>
							<dd>{sourceStatus(selectedAudit.status)}</dd>
						</div>
						<div>
							<dt>Collected</dt>
							<dd>{evidenceDate(selectedAudit.collected)}</dd>
						</div>
						<div>
							<dt>Pipeline checked</dt>
							<dd>{evidenceDate(selectedAudit.validated)}</dd>
						</div>
						{#if evidenceText(selectedSource.publicationDate)}<div>
								<dt>Publication date</dt>
								<dd>{evidenceDate(evidenceText(selectedSource.publicationDate))}</dd>
							</div>{/if}
					</dl>
					<section class="inspector-section">
						<h4>Coverage & use limits</h4>
						<p>
							{evidenceText(selectedSource.coverage) ??
								'Coverage not supplied. Check the publisher before relying on this record.'}
						</p>
						{#if selectedAudit.qualification}<p>{selectedAudit.qualification}</p>{/if}
					</section>
					<section class="inspector-section">
						<h4>Reuse terms</h4>
						<p>
							{selectedAudit.license ??
								'Not supplied. Public access does not establish a reuse licence.'}
						</p>
					</section>
					{#if link}<a class="publisher-link" href={link} target="_blank" rel="noreferrer"
							>Open publisher source <ExternalLink size={14} aria-hidden="true" /></a
						>{/if}
					<details class="technical-details">
						<summary>File identity & preparation</summary>
						<dl>
							<div>
								<dt>Source ID</dt>
								<dd class="technical">{selectedSource.id}</dd>
							</div>
							<div>
								<dt>Publisher URL</dt>
								<dd class="technical">{selectedSource.url ?? 'Not supplied'}</dd>
							</div>
							<div>
								<dt>File hash</dt>
								<dd class="technical">
									{evidenceText(selectedSource.sha256) ??
										evidenceText(selectedSource.checksum) ??
										'Not supplied'}
								</dd>
							</div>
							{#if evidenceText(selectedSource.transformationVersion)}<div>
									<dt>Preparation version</dt>
									<dd class="technical">{evidenceText(selectedSource.transformationVersion)}</dd>
								</div>{/if}{#if evidenceText(selectedSource.lastModified)}<div>
									<dt>Publisher file modified</dt>
									<dd>{evidenceDate(evidenceText(selectedSource.lastModified), true)}</dd>
								</div>{/if}{#if evidenceText(selectedSource.publicationSheet)}<div>
									<dt>Publication worksheet</dt>
									<dd>{evidenceText(selectedSource.publicationSheet)}</dd>
								</div>{/if}
						</dl>
						<p>
							A hash identifies saved bytes. It does not establish the accuracy of the values or
							their interpretation.
						</p>
					</details>
				</aside>
			{/if}
		</div>
		<details class="date-help">
			<summary>How to interpret source dates</summary>
			<p>
				<strong>Source period</strong> is when records apply. <strong>Collected</strong> is when the
				copy was fetched. <strong>Pipeline checked</strong> is when the data preparation recorded validation.
				None proves current conditions on the ground.
			</p>
		</details>
	</section>

	<section class="panel supporting" aria-labelledby="coverage-title">
		<div class="section-heading">
			<div>
				<p class="eyebrow">Scope & missing inputs</p>
				<h2 id="coverage-title">Check the boundary of a result</h2>
			</div>
			<span class="subtle">Greater Malé planning model</span>
		</div>
		<details class="support-detail">
			<summary
				><span
					><strong>Population & geographic coverage</strong><span
						>{count(modeledPopulation)} projected residents allocated to the map · {count(routed)} national
						records with partial routing</span
					></span
				></summary
			>
			<p>
				Official island projections anchor population totals. Distribution into neighbourhoods is
				modelled, not a neighbourhood census. Islands without allocated population are excluded from
				the resident results denominator.
			</p>
			<div class="table-scroll">
				<table>
					<caption class="sr-only">Population represented in the prepared planning model</caption
					><thead
						><tr
							><th scope="col">Island</th><th scope="col">Official 2026 projection</th><th
								scope="col">Allocated on map</th
							><th scope="col">Resident results</th></tr
						></thead
					><tbody
						>{#each islandScope as island (island.id)}<tr
								><th scope="row">{island.name}</th><td>{count(island.projected)}</td><td
									>{count(island.modeled)}</td
								><td
									>{island.cells ? 'Included, with service limits' : 'No allocated population'}</td
								></tr
							>{/each}</tbody
					>
				</table>
			</div>
			<details class="nested-detail">
				<summary>Island qualifications & exclusions</summary>
				<ul class="plain-list">
					{#each islandScope as island (island.id)}<li>
							<strong>{island.name}</strong>
							<p>{island.qualification ?? 'No island-specific qualification supplied.'}</p>
						</li>{/each}
				</ul>
				<p>Missing evidence does not mean there are no residents or no need for services.</p>
			</details>
			{#if national.length}<h3 class="subsection-title">National expansion readiness</h3>
				<p>
					{count(national.length)} register records · {count(located)} located on the map · {count(
						populationOnly
					)} without a routing model. A population figure or location alone cannot support a journey comparison.
				</p>
				<label class="search-field national-search"
					><Search size={16} aria-hidden="true" /><span class="sr-only"
						>Search national islands or atolls</span
					><input
						type="search"
						bind:value={islandQuery}
						placeholder="Search island or atoll"
					/></label
				>
				<p class="subtle">{nationalMatches.length} matching island records</p>
				<div class="national-list">
					{#each nationalMatches as island (island.id)}<article>
							<div>
								<strong>{island.name}</strong><span
									>{island.atoll} · {island.coordinates ? 'Located' : 'Location missing'}</span
								>
							</div>
							<span class="status" class:conditional={island.routingAvailable}
								>{island.routingAvailable ? 'Partial routing' : 'No routing'}</span
							>
							<p>{island.qualification}</p>
						</article>{/each}{#if !nationalMatches.length}<p class="empty">
							No island matches this search.
						</p>{/if}
				</div>{:else}<p class="empty">
					National readiness records are not loaded. Coverage outside the prepared model cannot be
					assessed.
				</p>{/if}
		</details>
		<details class="support-detail">
			<summary
				><span
					><strong>Service calendars, arrivals & vehicle observations</strong><span
						>{count(observedDirections)} source-backed directions · {count(assumedDirections)} assumed
						directions · incomplete recurring calendars</span
					></span
				></summary
			>
			<p>
				Service directions are not a count of operating vehicles or a complete timetable. These
				missing inputs constrain the access model.
			</p>
			{#each operations?.serviceEvidence ?? [] as gap (gap.id)}<article class="service-gap">
					<div class="section-heading">
						<h3>{gap.name}</h3>
						<span class="status conditional"
							>{gap.status === 'partial' ? 'Partial evidence' : 'Unavailable'}</span
						>
					</div>
					<p>{gap.qualification}</p>
					<h4>Required next</h4>
					<ul class="plain-list">
						{#each gap.missingInputs as input (input)}<li>{input}</li>{/each}
					</ul>
					{#if publicLink(gap.sourceUrl)}<a
							href={publicLink(gap.sourceUrl)}
							target="_blank"
							rel="noreferrer">Publisher source <ExternalLink size={13} aria-hidden="true" /></a
						>{/if}
				</article>{/each}
			{#if !operations?.serviceEvidence.length}<p class="empty">
					No service-gap register is loaded. Calendars, arrivals and dated exceptions still need
					checking.
				</p>{/if}
			{#if prediction}<h3 class="subsection-title">Vehicle observation receipt</h3>
				<p>{prediction.bus.qualification}</p>
				<p>
					{count(prediction.bus.coverage.snapshots)} snapshots across {count(
						prediction.bus.coverage.observedDays
					)} observed days. Measurement times are unavailable; reception times do not establish when a
					vehicle position was measured.
				</p>
				<details class="nested-detail">
					<summary>Forecast data-quality notes</summary>
					<ul class="plain-list">
						{#each prediction.dataQualityNotes as note (note)}<li>{note}</li>{/each}
					</ul>
					{#if prediction.provenance}<p>
							Latest publication date recorded: {evidenceDate(
								prediction.provenance.latestPublicationDate
							)}.
						</p>
						<p>{prediction.provenance.revisionQualification}</p>{/if}
				</details>{/if}
		</details>
		<details class="support-detail">
			<summary
				><span
					><strong>Public policy context</strong><span
						>{policyEvidence
							? `${policyEvidence.layers.length} context layers · coverage limits apply`
							: 'Context bundle unavailable'}</span
					></span
				></summary
			>
			<p>
				Context explains local conditions. A record on a map does not establish transport demand or
				a causal effect of a proposal.
			</p>
			{#each policyEvidence?.layers ?? [] as layer (layer.id)}<article class="context-row">
					<div class="section-heading">
						<h3>{layer.title}</h3>
						<span class="status conditional"
							>{layer.status === 'unavailable' ? 'Unavailable' : 'Partial'}</span
						>
					</div>
					<p>{layer.coverage} · Source period: {evidenceDate(layer.referencePeriod)}</p>
					<p>
						{count(layer.recordCount)} prepared records · {count(layer.unlocatedRecords)} records without
						locations
					</p>
					<ul class="plain-list">
						{#each layer.limitations as limitation (limitation)}<li>{limitation}</li>{/each}
					</ul>
				</article>{/each}{#if !policyEvidence?.layers.length}<p class="empty">
					No policy context layers were supplied.
				</p>{/if}{#if policyEvidence}<p class="subtle">
					Prepared {evidenceDate(policyEvidence.generatedAt, true)}{policyEvidence.stale
						? ' · Marked stale'
						: ''}
				</p>{/if}
		</details>
		<details class="support-detail">
			<summary
				><span
					><strong>All recorded gaps & agency requests</strong><span
						>{gaps.length} coverage gaps · inspect the unabridged register</span
					></span
				></summary
			>{#if gaps.length}<ul class="plain-list">
					{#each gaps as gap (gap)}<li>{gap}</li>{/each}
				</ul>{:else}<p>
					No gap statements were supplied. This does not certify complete coverage.
				</p>{/if}{#if policyEvidence?.agencyRequests.length}<h3 class="subsection-title">
					Information to request from agencies
				</h3>
				<ul class="plain-list">
					{#each policyEvidence.agencyRequests as request (request)}<li>{request}</li>{/each}
				</ul>{/if}
		</details>
	</section>

	<section class="panel notices-panel" aria-labelledby="notices-title">
		<div class="section-heading">
			<div>
				<p class="eyebrow">Operational review</p>
				<h2 id="notices-title">News & public notices</h2>
			</div>
			{#if onReviewNotices}<button class="secondary" onclick={onReviewNotices}
					>Review on map <ArrowUpRight size={14} aria-hidden="true" /></button
				>{/if}
		</div>
		{#if operations}<p>
				{count(notices.length)} candidate notices · {count(operations.weatherAlerts.length)} weather alert
				records in a collected snapshot. {operations.stale
					? 'This saved bundle is marked stale.'
					: 'This is not a live road-condition feed.'}
			</p>
			<p class="subtle">
				Collected {evidenceDate(operations.generatedAt, true)}. A person must confirm a notice's
				location, dates, direction and affected road before applying it. Weather alerts are
				advisory; neither feed automatically changes routing.
			</p>
			{#if !notices.length}<p class="notice-empty">
					No candidate road or marine notices were supplied. This does not confirm that roads are
					clear.
				</p>{:else}<ul class="plain-list">
					{#each notices.slice(0, 3) as notice (notice.id)}<li>
							<strong>{notice.title}</strong>
							<p>
								{notice.locationLabel || 'Location not confirmed'} · {notice.validFrom
									? evidenceDate(notice.validFrom)
									: 'Start not confirmed'}{notice.validUntil
									? ` to ${evidenceDate(notice.validUntil)}`
									: ' · End not confirmed'}
							</p>
						</li>{/each}
				</ul>{/if}
			<details class="date-help">
				<summary>Extraction method & review requirements</summary>
				<p>{operations.ai.reason}</p>
				<p>
					Method: {operations.ai.method === 'ai-assisted' ? 'AI assisted' : 'Rules'}. {operations.ai
						.available
						? 'Extraction service available.'
						: 'Extraction service unavailable.'} Candidate status remains unchanged until human review.
				</p>
			</details>{:else}<p class="empty">
				Public notices are unavailable. No road conditions can be inferred from this empty state.
			</p>{/if}
	</section>
	<section class="panel model-record">
		<details>
			<summary
				><span
					><strong>Model record & terminology</strong><span
						>Dataset versions, prepared defaults and how to read results</span
					></span
				></summary
			>
			<div class="record-grid">
				<div>
					<h3>Prepared versions</h3>
					<dl class="version-list">
						<div>
							<dt>Planning dataset</dt>
							<dd>{baseline.version}</dd>
						</div>
						<div>
							<dt>Planning prepared</dt>
							<dd>{evidenceDate(baseline.generatedAt, true)}</dd>
						</div>
						<div>
							<dt>Transport snapshot</dt>
							<dd>{evidenceDate(baseline.referenceDate)}</dd>
						</div>
						<div>
							<dt>Facility review</dt>
							<dd>{baseline.facilityAuditVersion ?? 'Not supplied'}</dd>
						</div>
						<div>
							<dt>Public updates</dt>
							<dd>{operations?.version ?? 'Unavailable'}</dd>
						</div>
						<div>
							<dt>Policy context</dt>
							<dd>{policyEvidence?.version ?? 'Unavailable'}</dd>
						</div>
						<div>
							<dt>Forecast model</dt>
							<dd>{prediction?.provenance?.modelVersion ?? 'Not supplied'}</dd>
						</div>
						<div>
							<dt>Forecast preparation</dt>
							<dd>{prediction?.provenance?.transformVersion ?? 'Not supplied'}</dd>
						</div>
						<div>
							<dt>Forecast checked</dt>
							<dd>{evidenceDate(prediction?.provenance?.checkedAt, true)}</dd>
						</div>
					</dl>
				</div>
				<div>
					<h3>Result definitions</h3>
					<dl class="version-list definitions">
						<div>
							<dt>Source-backed</dt>
							<dd>
								Published records or downloaded map features. Completeness and current conditions
								still need checking.
							</dd>
						</div>
						<div>
							<dt>Modelled</dt>
							<dd>
								Calculated potential access, not observed journeys or measured service outcomes.
							</dd>
						</div>
						<div>
							<dt>Forecast</dt>
							<dd>
								Exploratory monthly passenger estimates. Not street-level or route-level demand.
							</dd>
						</div>
						<div>
							<dt>Assumed</dt>
							<dd>
								Planner proposals, speeds, delays and crossing times that require confirmation.
							</dd>
						</div>
						<div>
							<dt>Unknown</dt>
							<dd>
								Unavailable evidence. An unknown journey or empty feed is not a confirmed zero.
							</dd>
						</div>
					</dl>
				</div>
			</div>
			{#if assumptionEntries.length}<details class="nested-detail">
					<summary>Prepared dataset defaults</summary>
					<p>
						These are dataset defaults. A planner can change assumptions; inspect the active
						scenario on the map before using its results.
					</p>
					<dl class="version-list">
						{#each assumptionEntries as [key, value] (key)}<div>
								<dt class="technical">{key}</dt>
								<dd>{String(value)}</dd>
							</div>{/each}
					</dl>
				</details>{/if}
		</details>
	</section>
</section>

<style>
	.evidence-workspace {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 0 40px;
		color: #172b3a;
		font-size: 14px;
	}
	.page-intro,
	.section-heading {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 20px;
	}
	.page-intro {
		align-items: flex-start;
		margin-bottom: 20px;
	}
	.eyebrow {
		font-size: 11px;
		font-weight: 650;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #647381;
		margin: 0 0 8px;
	}
	h1 {
		margin: 0 0 10px;
		font-size: 30px;
		letter-spacing: -0.9px;
		line-height: 1.2;
		font-weight: 650;
	}
	h2 {
		margin: 0;
		font-size: 17px;
		line-height: 1.35;
		font-weight: 650;
		letter-spacing: -0.3px;
	}
	h3 {
		margin: 0;
		font-size: 14px;
		line-height: 1.4;
		font-weight: 650;
	}
	h4 {
		margin: 0 0 7px;
		font-size: 12px;
		font-weight: 650;
	}
	p {
		color: #647381;
		line-height: 1.55;
		margin: 0 0 12px;
		font-size: 13px;
	}
	.intro {
		font-size: 14px;
		max-width: 760px;
		margin: 0;
	}
	.panel {
		border: 1px solid #dde3e9;
		border-radius: var(--surface-radius, 28px);
		background: #fff;
		box-shadow: var(--surface-shadow, 0 4px 16px #102e3412, 0 1px 3px #102e340a);
		padding: 22px 24px;
		min-width: 0;
		margin-bottom: 24px;
	}
	.assessment-grid {
		display: grid;
		grid-template-columns: minmax(0, 1.8fr) minmax(280px, 1fr);
		gap: 20px;
	}
	.assessment-grid .panel {
		padding: 18px 20px;
		margin-bottom: 20px;
	}
	.applicability .section-heading {
		margin-bottom: 12px;
	}
	.section-heading {
		margin-bottom: 16px;
	}
	.section-heading .eyebrow {
		margin-bottom: 5px;
	}
	.subtle {
		font-size: 11px;
		color: #647381;
		line-height: 1.5;
	}
	.claim-list {
		border-top: 1px solid #edf0f3;
	}
	.claim-list article {
		padding: 12px 0;
		border-bottom: 1px solid #edf0f3;
	}
	.claim-list article:last-child {
		border-bottom: 0;
		padding-bottom: 0;
	}
	.claim-title {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
	}
	.claim-list p {
		margin: 6px 0 0;
		font-size: 13px;
	}
	.claim-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		border: 0;
		background: transparent;
		color: #172b3a;
		font-size: 13px;
		font-weight: 650;
		padding: 0;
		text-align: left;
		cursor: pointer;
	}
	.claim-link :global(svg) {
		color: #087f78;
		flex-shrink: 0;
	}
	.unsupported-claims {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 20px;
		border-top: 1px solid #edf0f3;
		padding-top: 13px;
		margin-top: 13px;
	}
	.unsupported-claims .claim-title {
		gap: 10px;
	}
	.unsupported-claims h3 {
		font-size: 13px;
	}
	.unsupported-claims p {
		margin: 6px 0 0;
		font-size: 13px;
	}
	.status {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		white-space: nowrap;
		background: #eef5f4;
		color: #246e67;
		border-radius: var(--surface-radius-pill, 999px);
		padding: 4px 9px;
		font-size: 10px;
		line-height: 1.4;
		font-weight: 550;
	}
	.status.conditional {
		background: #faf3e7;
		color: #94621c;
	}
	.status.unavailable {
		background: #f0f2f5;
		color: #647381;
	}
	.priorities {
		background: #fafbfc;
	}
	.priorities ol {
		margin: 18px 0 0;
		padding: 0;
		list-style: none;
		counter-reset: checks;
	}
	.priorities li {
		position: relative;
		padding: 0 0 13px 30px;
		counter-increment: checks;
	}
	.priorities li::before {
		content: counter(checks);
		position: absolute;
		left: 0;
		top: 1px;
		font-variant-numeric: tabular-nums;
		font-size: 11px;
		color: #647381;
		width: 20px;
		height: 20px;
		display: grid;
		place-items: center;
		border: 1px solid #d9e0e6;
		border-radius: 50%;
	}
	.priorities li strong {
		font-size: 13px;
		font-weight: 650;
	}
	.priorities li p {
		font-size: 13px;
		margin: 5px 0 0;
	}
	.count-label {
		margin-left: 7px;
		font-size: 11px;
		color: #647381;
		font-weight: 450;
		letter-spacing: 0;
	}
	.section-note {
		max-width: 880px;
		margin-bottom: 14px;
		font-size: 13px;
	}
	.library .section-heading {
		margin-bottom: 12px;
	}
	.library-toolbar {
		display: grid;
		grid-template-columns: minmax(220px, 1fr) 190px 160px;
		gap: 12px;
		align-items: end;
		margin-bottom: 20px;
	}
	.search-field {
		display: flex;
		gap: 9px;
		align-items: center;
		border: 1px solid #d2dae2;
		border-radius: var(--surface-radius-field, 14px);
		padding: 0 12px;
		min-height: 40px;
		color: #647381;
		background: #fff;
	}
	.search-field:focus-within {
		border-color: #087f78;
		outline: 2px solid #087f7820;
		outline-offset: 1px;
	}
	input,
	select {
		color: #172b3a;
		font: inherit;
		font-size: 12px;
		background: #fff;
		width: 100%;
		min-width: 0;
	}
	input {
		min-height: 40px;
		background: transparent;
		border: 0;
		outline: none;
	}
	input::placeholder {
		color: #87929d;
	}
	.filter-field > span {
		display: block;
		color: #647381;
		font-size: 10px;
		font-weight: 600;
		margin: 0 0 5px;
	}
	select {
		min-height: 42px;
		border: 1px solid #d2dae2;
		border-radius: var(--surface-radius-field, 14px);
		padding: 0 9px;
		cursor: pointer;
	}
	.library-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 330px;
		align-items: start;
		gap: 24px;
	}
	.source-results {
		min-width: 0;
	}
	.results-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		height: 32px;
		margin-bottom: 8px;
		color: #647381;
		font-size: 11px;
	}
	.source-column-labels,
	.source-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 115px 93px;
		gap: 12px;
	}
	.source-column-labels {
		color: #647381;
		background: #f6f7f9;
		padding: 10px 12px;
		font-size: 10px;
		font-weight: 600;
		border-block: 1px solid #e8ecf1;
		border-radius: var(--surface-radius-inner, 16px) var(--surface-radius-inner, 16px) 0 0;
	}
	.source-list {
		margin: 0;
		padding: 0;
		list-style: none;
		border-radius: 0 0 var(--surface-radius-inner, 16px) var(--surface-radius-inner, 16px);
		overflow: hidden;
	}
	.source-row {
		width: 100%;
		text-align: left;
		align-items: center;
		min-height: 72px;
		padding: 12px;
		border: 0;
		border-bottom: 1px solid #edf0f3;
		border-radius: 0;
		color: #172b3a;
		background: #fff;
		cursor: pointer;
	}
	.source-row.selected {
		background: #eef7f6;
		box-shadow: inset 2px 0 #087f78;
	}
	.source-row:focus-visible {
		outline-offset: -3px;
	}
	.source-name {
		min-width: 0;
	}
	.source-name strong {
		display: block;
		font-size: 12px;
		font-weight: 550;
		overflow-wrap: anywhere;
		line-height: 1.4;
	}
	.source-name > span {
		display: block;
		font-size: 10px;
		color: #647381;
		margin-top: 4px;
		overflow-wrap: anywhere;
		line-height: 1.4;
	}
	.source-period {
		font-size: 11px;
		line-height: 1.4;
		color: #647381;
		overflow-wrap: anywhere;
	}
	.source-copy {
		display: flex;
		justify-content: flex-start;
	}
	.pagination {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-top: 14px;
	}
	.pagination > span {
		font-size: 11px;
		color: #647381;
		font-variant-numeric: tabular-nums;
	}
	.pagination > div {
		display: flex;
		gap: 6px;
	}
	.pagination button {
		font-size: 11px;
		min-height: 36px;
		padding: 7px 10px;
	}
	.source-inspector {
		min-width: 0;
		padding: 18px;
		background: #fafbfc;
		border: 1px solid #e3e8ed;
		border-radius: var(--surface-radius-inner, 16px);
		scroll-margin-top: 18px;
	}
	.source-inspector h3 {
		font-size: 15px;
		overflow-wrap: anywhere;
		line-height: 1.45;
	}
	.publisher {
		font-size: 12px;
		margin: 6px 0 8px;
	}
	.workflow-label {
		font-size: 10px;
		color: #087f78;
		margin: 0 0 17px;
	}
	.inspector-dates {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 13px 14px;
		margin: 0 0 17px;
	}
	dt {
		color: #647381;
		font-size: 10px;
		line-height: 1.5;
	}
	dd {
		color: #172b3a;
		font-size: 12px;
		line-height: 1.5;
		margin: 3px 0 0;
		overflow-wrap: anywhere;
	}
	.inspector-section {
		border-top: 1px solid #e3e8ed;
		padding-top: 14px;
		margin-top: 14px;
	}
	.inspector-section p,
	.technical-details p {
		font-size: 11px;
		margin-bottom: 9px;
	}
	.inspector-section p {
		font-size: 13px;
	}
	.publisher-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin: 7px 0;
		font-size: 12px;
		font-weight: 550;
	}
	.technical-details {
		border-top: 1px solid #e3e8ed;
		margin-top: 12px;
	}
	.technical-details dl {
		margin: 0 0 15px;
	}
	.technical-details dl > div {
		margin: 11px 0;
	}
	.technical {
		font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 10px;
		overflow-wrap: anywhere;
	}
	.date-help {
		border-top: 1px solid #edf0f3;
		margin-top: 20px;
		padding-top: 4px;
	}
	.date-help p {
		font-size: 13px;
		margin-top: 4px;
	}
	summary {
		cursor: pointer;
		min-height: 44px;
		padding: 12px 0;
		color: #172b3a;
		font-size: 12px;
		font-weight: 550;
		line-height: 1.5;
	}
	.support-detail {
		border-top: 1px solid #e8ecf1;
	}
	.support-detail summary {
		min-height: 72px;
		padding: 17px 0;
	}
	.support-detail summary > span,
	.model-record summary > span {
		display: inline-block;
		vertical-align: middle;
		width: calc(100% - 28px);
	}
	.support-detail summary strong,
	.model-record summary strong {
		display: block;
		font-size: 13px;
		font-weight: 600;
	}
	.support-detail summary span > span,
	.model-record summary span > span {
		display: block;
		color: #647381;
		font-size: 11px;
		font-weight: 400;
		margin-top: 4px;
	}
	.support-detail[open] {
		padding-bottom: 16px;
	}
	.support-detail p {
		font-size: 13px;
	}
	.nested-detail {
		border-top: 1px solid #e8ecf1;
		margin-top: 15px;
	}
	.table-scroll {
		overflow-x: auto;
		margin: 16px 0;
		border: 1px solid #e8ecf1;
		border-radius: var(--surface-radius-inner, 16px);
	}
	table {
		width: 100%;
		border-collapse: collapse;
		min-width: 640px;
		text-align: left;
		font-size: 12px;
	}
	th,
	td {
		padding: 11px 12px;
		border-bottom: 1px solid #e8ecf1;
		font-variant-numeric: tabular-nums;
	}
	thead th {
		color: #647381;
		font-size: 11px;
		background: #f6f7f9;
		font-weight: 550;
	}
	tbody th {
		font-weight: 550;
	}
	.plain-list {
		color: #647381;
		font-size: 13px;
		line-height: 1.6;
		padding-left: 18px;
		margin: 12px 0 16px;
	}
	.plain-list li {
		margin: 8px 0;
	}
	.plain-list p {
		margin: 4px 0;
	}
	.subsection-title {
		margin: 24px 0 9px;
	}
	.national-search {
		max-width: 460px;
		margin: 15px 0 8px;
	}
	.national-list {
		max-height: 420px;
		overflow-y: auto;
		margin-top: 10px;
		padding-right: 8px;
		border-top: 1px solid #e8ecf1;
	}
	.national-list article {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 6px 18px;
		border-bottom: 1px solid #e8ecf1;
		padding: 13px 0;
	}
	.national-list strong {
		display: block;
		font-size: 12px;
		font-weight: 550;
	}
	.national-list article > div > span {
		display: block;
		font-size: 10px;
		color: #647381;
		margin-top: 3px;
	}
	.national-list p {
		grid-column: 1 / -1;
		font-size: 11px;
		margin: 0;
	}
	.national-list .status {
		align-self: start;
	}
	.service-gap,
	.context-row {
		border-top: 1px solid #e8ecf1;
		padding: 18px 0 5px;
	}
	.service-gap .section-heading,
	.context-row .section-heading {
		margin-bottom: 8px;
	}
	.service-gap h4 {
		margin-top: 15px;
	}
	.notices-panel .section-heading {
		margin-bottom: 12px;
	}
	.notice-empty {
		padding: 12px 14px;
		background: #f6f7f9;
		border-left: 2px solid #b7c1cb;
		border-radius: var(--surface-radius-inner, 16px);
		font-size: 13px;
		margin: 16px 0 0;
	}
	.model-record {
		padding-block: 5px;
	}
	.model-record > details > summary {
		min-height: 70px;
		padding-block: 14px;
	}
	.record-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 32px;
		border-top: 1px solid #e8ecf1;
		padding-top: 20px;
	}
	.record-grid h3 {
		margin-bottom: 15px;
	}
	.version-list {
		margin: 0 0 16px;
	}
	.version-list > div {
		display: grid;
		grid-template-columns: 145px minmax(0, 1fr);
		gap: 12px;
		margin: 12px 0;
	}
	.version-list dd {
		margin: 0;
		font-size: 11px;
	}
	.definitions > div {
		grid-template-columns: 95px minmax(0, 1fr);
	}
	button {
		font: inherit;
	}
	.secondary {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		min-height: 40px;
		padding: 9px 16px;
		border: 1px solid #d2dae2;
		border-radius: var(--surface-radius-pill, 999px);
		color: #172b3a;
		background: #fff;
		font-size: 12px;
		font-weight: 550;
		cursor: pointer;
		white-space: nowrap;
	}
	.text-link {
		border: 0;
		background: transparent;
		color: #087f78;
		padding: 8px 0 0;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		font-weight: 550;
		cursor: pointer;
		min-height: 28px;
	}
	.results-heading .text-link {
		padding: 0;
	}
	a {
		color: #087f78;
		text-underline-offset: 3px;
		font-size: 12px;
		overflow-wrap: anywhere;
	}
	a :global(svg) {
		display: inline-block;
		vertical-align: -2px;
	}
	button:disabled {
		opacity: 0.45;
		cursor: default;
	}
	button:focus-visible,
	a:focus-visible,
	summary:focus-visible,
	select:focus-visible {
		outline: 2px solid #087f78;
		outline-offset: 3px;
	}
	.empty {
		background: #f6f7f9;
		padding: 13px 15px;
		border-radius: var(--surface-radius-inner, 16px);
		font-size: 13px;
	}
	.empty-state {
		padding: 36px 20px;
		border: 1px dashed #d9e0e6;
		border-radius: var(--surface-radius-inner, 16px);
		text-align: center;
	}
	.empty-state p {
		font-size: 13px;
		max-width: 360px;
		margin: 10px auto 18px;
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
	@media (hover: hover) and (pointer: fine) {
		.secondary:hover:not(:disabled) {
			background: #f6f7f9;
			border-color: #b8c4cf;
		}
		.source-row:hover {
			background: #f5f8fa;
		}
		.source-row.selected:hover {
			background: #e7f3f1;
		}
		.text-link:hover {
			color: #075e59;
			text-decoration: underline;
		}
	}
	@media (max-width: 1000px) {
		.assessment-grid {
			grid-template-columns: 1fr;
			gap: 0;
		}
		.priorities ol {
			display: grid;
			grid-template-columns: repeat(3, minmax(0, 1fr));
			gap: 18px;
		}
		.priorities li {
			padding-bottom: 0;
		}
		.library-grid {
			grid-template-columns: minmax(0, 1fr) 295px;
			gap: 18px;
		}
		.source-column-labels,
		.source-row {
			grid-template-columns: minmax(0, 1fr) 90px;
		}
		.source-column-labels > span:last-child,
		.source-copy {
			display: none;
		}
	}
	@media (max-width: 760px) {
		.panel {
			border-radius: var(--surface-radius-mobile, 24px);
		}
		.page-intro {
			flex-direction: column;
			gap: 16px;
		}
		h1 {
			font-size: 27px;
		}
		.panel {
			padding: 19px 18px;
		}
		.library-toolbar {
			grid-template-columns: 1fr 1fr;
		}
		.library-toolbar .search-field {
			grid-column: 1 / -1;
		}
		.library-grid {
			grid-template-columns: 1fr;
		}
		.source-inspector {
			border-left: 2px solid #087f78;
		}
		.source-column-labels,
		.source-row {
			grid-template-columns: minmax(0, 1fr) 105px 90px;
		}
		.source-column-labels > span:last-child,
		.source-copy {
			display: flex;
		}
		.source-inspector h3 {
			font-size: 16px;
		}
		.record-grid {
			grid-template-columns: 1fr;
			gap: 12px;
		}
		.section-heading > .subtle {
			display: none;
		}
		.priorities ol {
			grid-template-columns: 1fr;
			gap: 18px;
		}
		.unsupported-claims {
			grid-template-columns: 1fr;
			gap: 15px;
		}
	}
	@media (max-width: 480px) {
		.evidence-workspace {
			padding-bottom: 20px;
		}
		h1 {
			font-size: 25px;
			letter-spacing: -0.65px;
		}
		.panel {
			padding: 17px 14px;
			margin-bottom: 18px;
		}
		.assessment-grid .panel {
			padding: 17px 14px;
			margin-bottom: 18px;
		}
		.claim-title {
			align-items: flex-start;
			gap: 10px;
		}
		.claim-title h3 {
			font-size: 13px;
		}
		.status {
			font-size: 9px;
			padding: 3px 5px;
		}
		.source-column-labels,
		.source-row {
			grid-template-columns: minmax(0, 1fr) 80px;
			gap: 9px;
		}
		.source-column-labels > span:last-child,
		.source-copy {
			display: none;
		}
		.source-name strong {
			font-size: 11px;
		}
		.source-period {
			font-size: 10px;
		}
		.source-name > span {
			font-size: 9px;
		}
		.count-label {
			display: block;
			margin: 4px 0 0;
		}
		.library-toolbar {
			gap: 10px;
		}
		.library-toolbar select {
			font-size: 11px;
			padding-inline: 6px;
		}
		.library-toolbar .search-field {
			padding-inline: 9px;
		}
		input {
			font-size: 11px;
		}
		.source-inspector {
			padding: 15px;
		}
		.support-detail summary {
			padding-block: 15px;
		}
		.support-detail summary strong {
			font-size: 12px;
		}
		.notices-panel .section-heading {
			flex-direction: column;
			align-items: flex-start;
			gap: 12px;
		}
		.version-list > div {
			grid-template-columns: 110px minmax(0, 1fr);
		}
		.definitions > div {
			grid-template-columns: 80px minmax(0, 1fr);
		}
		.national-list article {
			grid-template-columns: 1fr;
		}
		.national-list .status {
			justify-self: start;
		}
		.secondary {
			min-height: 44px;
		}
	}
</style>
