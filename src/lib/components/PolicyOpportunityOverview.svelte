<script lang="ts">
	import { onMount } from 'svelte';
	import {
		ArrowRight,
		Bus,
		ChevronLeft,
		ChevronRight,
		CircleHelp,
		GraduationCap,
		HeartPulse,
		MapPin,
		Search
	} from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import { api } from '#lib/api.js';
	import {
		opportunityMatches,
		opportunityStatusCounts,
		policyDomainLabels,
		policyDomains,
		scopeOpportunities,
		sortOpportunities,
		variedOpportunityScores,
		type OpportunityIsland,
		type PolicyDomain,
		type PolicyLens,
		type PolicyOpportunities
	} from '#lib/policy-opportunities.js';

	let {
		atoll = 'all',
		cohort = 'residential',
		onExplore
	}: {
		atoll?: string;
		cohort?: string;
		onExplore: (islandId?: string, atoll?: string, lens?: PolicyLens) => void;
	} = $props();
	let snapshot = $state<PolicyOpportunities | null>(null);
	let loading = $state(true);
	let error = $state('');
	let lens = $state<PolicyLens>('overall');
	let queue = $state<'review' | 'unknown'>('review');
	let search = $state('');
	let page = $state(0);
	let showEvidence = $state(false);
	let controller: AbortController;
	const number = (value: number) => new Intl.NumberFormat('en-US').format(value);
	const referenceDate = $derived(
		snapshot?.reference_date
			? new Intl.DateTimeFormat('en-GB', {
					day: 'numeric',
					month: 'short',
					year: 'numeric',
					timeZone: 'UTC'
				}).format(new Date(snapshot.reference_date))
			: null
	);
	const icons = { transport: Bus, health: HeartPulse, education: GraduationCap };
	const scoped = $derived(scopeOpportunities(snapshot?.islands ?? [], atoll, cohort));
	const reviewCount = $derived(
		scoped.filter((island) => opportunityMatches(island, lens, 'review')).length
	);
	const unknownCount = $derived(
		scoped.filter((island) => opportunityMatches(island, lens, 'unknown')).length
	);
	const populationCount = $derived(scoped.filter((island) => island.population !== null).length);
	const supportedCount = $derived(scoped.filter((island) => island.planning_supported).length);
	const comparison = $derived(
		policyDomains.map((domain) => ({ domain, ...opportunityStatusCounts(scoped, domain) }))
	);
	const candidates = $derived(scoped.filter((island) => opportunityMatches(island, lens, queue)));
	const searched = $derived(
		candidates.filter((island) =>
			`${island.name} ${island.atoll}`.toLowerCase().includes(search.trim().toLowerCase())
		)
	);
	const matched = $derived(
		queue === 'review'
			? sortOpportunities(searched, lens)
			: [...searched].sort((first, second) => first.name.localeCompare(second.name))
	);
	const ranked = $derived(queue === 'review' && variedOpportunityScores(matched, lens));
	const pageCount = $derived(Math.max(1, Math.ceil(matched.length / 5)));
	const currentPage = $derived(Math.min(page, pageCount - 1));
	const visible = $derived(matched.slice(currentPage * 5, currentPage * 5 + 5));
	const scopeLabel = $derived(
		atoll === 'all' ? (cohort === 'all' ? 'all island records' : 'residential islands') : atoll
	);
	const share = (count: number) => (count / Math.max(1, scoped.length)) * 100;

	async function load() {
		controller?.abort();
		const request = new AbortController();
		controller = request;
		loading = true;
		error = '';
		try {
			const result = await api<PolicyOpportunities>(
				'planning/opportunities',
				undefined,
				request.signal
			);
			if (!request.signal.aborted && controller === request) snapshot = result;
		} catch (caught) {
			if (!request.signal.aborted && controller === request)
				error = caught instanceof Error ? caught.message : 'Planning signals could not be loaded.';
		} finally {
			if (controller === request) loading = false;
		}
	}

	function chooseLens(value: PolicyLens) {
		lens = value;
		page = 0;
	}
	function issueSummary(island: OpportunityIsland, domain: PolicyDomain | undefined) {
		if (!domain) return 'Inspect the available evidence before choosing an investment.';
		const evidence = island.domains[domain];
		const service =
			domain === 'health' ? 'healthcare' : domain === 'education' ? 'education' : 'transport';
		if (!evidence.mapped_count)
			return `No accepted mapped ${service} locations in this snapshot. Verify local provision first.`;
		if (evidence.status === 'unknown')
			return `${number(evidence.mapped_count)} mapped ${service} locations, but comparable access evidence is incomplete.`;
		return domain === 'transport'
			? `Review connections and service frequency around ${number(evidence.mapped_count)} mapped transport ${evidence.mapped_count === 1 ? 'location' : 'locations'}.`
			: `Investigate travel access and verify capacity at ${number(evidence.mapped_count)} mapped ${service} ${evidence.mapped_count === 1 ? 'location' : 'locations'}.`;
	}
	onMount(() => {
		void load();
		return () => controller?.abort();
	});
</script>

<section class="policy-overview" aria-label="Policy priorities" aria-busy={loading}>
	{#if error}
		<div class="opportunity-error" role="alert">
			<div>
				<strong>Service-gap screening is unavailable.</strong>
				<p>{error}</p>
			</div>
			<Button size="sm" variant="outline" onclick={load}>Retry screening</Button>
		</div>
	{:else}
		<div class="policy-section-heading">
			<div>
				<span class="section-eyebrow">From evidence to action</span>
				<h2>Where should we look closer?</h2>
				<p>Compare service signals, then explore the places behind the numbers.</p>
			</div>
			<Button
				variant="outline"
				size="sm"
				onclick={() => onExplore(undefined, atoll === 'all' ? undefined : atoll, lens)}
				><MapPin size={14} /> See service-gap map</Button
			>
		</div>
		<div class="policy-summary" aria-live="polite">
			<div class="summary-primary">
				<span class="summary-dot"></span>
				<strong>{loading ? '—' : number(reviewCount)}</strong>
				<span>islands to investigate</span>
			</div>
			<div title="Islands with a resident estimate in this selection">
				<strong>{loading ? '—' : `${number(populationCount)} / ${number(scoped.length)}`}</strong>
				<span>with resident evidence</span>
			</div>
			<div title="Islands with resident origins and a planning network available">
				<strong>{loading ? '—' : number(supportedCount)}</strong>
				<span>ready for impact modeling</span>
			</div>
		</div>
		<div class="sector-comparison" aria-label="Compare service screening evidence">
			{#each comparison as sector (sector.domain)}
				{@const Icon = icons[sector.domain]}
				<Card.Root
					class={`sector-card sector-${sector.domain} ${lens === sector.domain ? 'sector-selected' : ''}`}
				>
					<div class="sector-heading">
						<span class="sector-icon"><Icon size={18} /></span>
						<h3>{policyDomainLabels[sector.domain]}</h3>
						{#if lens === sector.domain}<span class="selected-label">Selected</span>{/if}
					</div>
					<div class="sector-visual">
						<div class="sector-value">
							<strong>{loading ? '—' : number(sector.review)}</strong>
							<span>islands to<br />investigate</span>
						</div>
						<div class="sector-donut">
							<svg
								viewBox="0 0 100 100"
								role="img"
								aria-label={`${policyDomainLabels[sector.domain]}: ${sector.review} review signals, ${sector.stronger_evidence} with stronger mapped evidence, ${sector.unknown} with insufficient evidence out of ${scoped.length} islands`}
							>
								<circle class="donut-track" cx="50" cy="50" r="40" />
								{#if !loading && scoped.length}
									<circle
										class="donut-review"
										cx="50"
										cy="50"
										r="40"
										pathLength="100"
										stroke-dasharray={`${share(sector.review)} ${100 - share(sector.review)}`}
									/>
									<circle
										class="donut-strong"
										cx="50"
										cy="50"
										r="40"
										pathLength="100"
										stroke-dasharray={`${share(sector.stronger_evidence)} ${100 - share(sector.stronger_evidence)}`}
										stroke-dashoffset={-share(sector.review)}
									/>
								{/if}
							</svg>
							<div class="donut-center" aria-hidden="true">
								<strong>{loading ? '—' : `${Math.round(share(sector.review))}%`}</strong><span
									>review</span
								>
							</div>
						</div>
					</div>
					<div class="sector-context">
						<div>
							<span><i class="strong-key"></i>Stronger evidence</span><strong
								>{loading ? '—' : number(sector.stronger_evidence)}</strong
							>
						</div>
						<div>
							<span><i class="unknown-key"></i>Insufficient evidence</span><strong
								>{loading ? '—' : number(sector.unknown)}</strong
							>
						</div>
					</div>
					<Button
						variant="ghost"
						size="sm"
						class="sector-action"
						aria-pressed={lens === sector.domain}
						onclick={() => chooseLens(lens === sector.domain ? 'overall' : sector.domain)}
						>{lens === sector.domain
							? 'Showing this service'
							: `Review ${policyDomainLabels[sector.domain].toLowerCase()}`}<ArrowRight
							size={13}
						/></Button
					>
				</Card.Root>
			{/each}
		</div>
		<div class="screening-legend">
			<span><i class="review-key"></i> Review signal</span><span
				><i class="strong-key"></i> Stronger mapped evidence</span
			><span><i class="unknown-key"></i> Insufficient evidence</span>
		</div>
		<p class="screening-definition">
			A review signal is a modeled or mapped reason to investigate. It does not prove that a service
			is missing. Unknown areas need better evidence before investment decisions.
		</p>

		<Card.Root class="priority-card">
			<div class="priority-heading">
				<div>
					<span class="section-eyebrow">Your investigation queue</span>
					<h2>
						{queue === 'review' ? 'Investigate these islands' : 'Resolve these evidence gaps'}
					</h2>
					<p>{lens === 'overall' ? 'All services' : policyDomainLabels[lens]} · {scopeLabel}</p>
				</div>
				{#if lens !== 'overall'}<Button
						variant="ghost"
						size="sm"
						onclick={() => chooseLens('overall')}>All services</Button
					>{/if}
			</div>
			<div class="priority-toolbar">
				<div class="queue-controls" aria-label="Investigation type">
					<Button
						variant={queue === 'review' ? 'secondary' : 'ghost'}
						size="sm"
						aria-pressed={queue === 'review'}
						onclick={() => {
							queue = 'review';
							page = 0;
						}}>Review signals <span>{number(reviewCount)}</span></Button
					><Button
						variant={queue === 'unknown' ? 'secondary' : 'ghost'}
						size="sm"
						aria-pressed={queue === 'unknown'}
						onclick={() => {
							queue = 'unknown';
							page = 0;
						}}>Missing evidence <span>{number(unknownCount)}</span></Button
					>
				</div>
				<div class="priority-search">
					<Search size={14} /><Input
						aria-label="Search priority islands"
						placeholder="Find an island or atoll…"
						bind:value={search}
						oninput={() => (page = 0)}
					/>
				</div>
			</div>
			{#if loading}<div class="priority-empty" role="status">
					Comparing service evidence across the islands…
				</div>
			{:else if !visible.length}<div class="priority-empty">
					<strong
						>{search
							? 'No islands match your search.'
							: queue === 'review'
								? 'No review signals in this selection.'
								: 'No evidence gaps in this selection.'}</strong
					>
					<p>
						{search
							? 'Try another island or clear the search.'
							: queue === 'review'
								? 'Check missing evidence before drawing a conclusion about service coverage.'
								: 'Inspect the map to examine the available service evidence.'}
					</p>
					{#if !search && queue === 'review' && unknownCount}<Button
							variant="outline"
							size="sm"
							onclick={() => {
								queue = 'unknown';
								page = 0;
							}}>Review missing evidence</Button
						>{/if}
				</div>
			{:else}<div class="priority-rows">
					{#each visible as island (island.island_id)}
						{@const relevantDomains = (lens === 'overall' ? policyDomains : [lens]).filter(
							(domain) => island.domains[domain].status === queue
						)}
						{@const reasons = relevantDomains.flatMap((domain) => island.domains[domain].reasons)}
						<div class="priority-row" data-policy-opportunity-id={island.island_id}>
							<div class="priority-island">
								<span class="island-mark" aria-hidden="true"><MapPin size={17} /></span>
								<div><strong>{island.name}</strong><span>{island.atoll}</span></div>
							</div>
							<div class="priority-issue">
								<div class="issue-labels">
									{#each relevantDomains as domain (domain)}<span
											class={`issue-chip ${queue === 'unknown' ? 'unknown-chip' : ''}`}
											>{policyDomainLabels[domain]}
											{queue === 'review' ? 'review' : 'unknown'}</span
										>{/each}
								</div>
								<p title={reasons.join(' ')}>{issueSummary(island, relevantDomains[0])}</p>
							</div>
							<div class="priority-context" title={island.population_basis}>
								{#if island.population !== null}<strong
										>{number(Math.round(island.population))}</strong
									><span>recorded residents</span>{:else}<span
										>Resident estimate<br />unavailable</span
									>{/if}{#if island.planning_supported}<Badge variant="outline"
										>Impact model available</Badge
									>{/if}
							</div>
							<Button
								variant="outline"
								size="sm"
								aria-label={`Inspect ${island.name} service gaps on map`}
								onclick={() => onExplore(island.island_id, island.atoll, lens)}
								>Inspect on map <ArrowRight size={13} /></Button
							>
						</div>
					{/each}
				</div>{/if}
			<div class="priority-footer">
				<span
					>{matched.length
						? `${number(currentPage * 5 + 1)}–${number(Math.min((currentPage + 1) * 5, matched.length))} of ${number(matched.length)} islands`
						: 'No islands to display'}<span class="ordering-note">
						· {ranked
							? 'Higher screening signals first'
							: 'Alphabetical; no meaningful score ranking'}</span
					></span
				>
				<div>
					<Button
						variant="outline"
						size="icon-sm"
						aria-label="Previous priority islands"
						disabled={currentPage === 0}
						onclick={() => (page = currentPage - 1)}><ChevronLeft size={14} /></Button
					><span>{currentPage + 1} / {pageCount}</span><Button
						variant="outline"
						size="icon-sm"
						aria-label="Next priority islands"
						disabled={currentPage >= pageCount - 1}
						onclick={() => (page = currentPage + 1)}><ChevronRight size={14} /></Button
					>
				</div>
			</div>
		</Card.Root>
		<div class="policy-evidence">
			<Button
				variant="ghost"
				size="sm"
				aria-expanded={showEvidence}
				aria-controls="policy-screening-evidence"
				onclick={() => (showEvidence = !showEvidence)}
				><CircleHelp size={14} /> Sources and interpretation</Button
			><span>Screening reference{referenceDate ? ` · ${referenceDate}` : ''}</span>
		</div>
		{#if showEvidence}<div class="evidence-detail" id="policy-screening-evidence">
				<h3>Use the map to investigate, then test the investment.</h3>
				<p>
					Screening combines mapped transport, health and education records with available resident
					and planning evidence. A stronger evidence signal describes the available records; it does
					not verify service quality, capacity, admissions, or reliable timetables. Gap scores are
					screening indicators, not percentages of residents without a service.
				</p>
				<p>
					An available service index below 60 out of 100 is flagged for review. The overall screen
					uses the weakest known service index. Missing mapped records stay unknown and are not
					counted as measured service failures.
				</p>
				<p>
					Resident totals remain unavailable where the source does not supply an estimate. Detailed
					access and investment forecasts are limited to islands with supported resident origins and
					planning networks. Proposals remain estimates for review.
				</p>
				{#if snapshot?.warnings.length}<ul>
						{#each snapshot.warnings as warning (warning)}<li>{warning}</li>{/each}
					</ul>{/if}
			</div>{/if}
	{/if}
</section>

<style>
	.policy-overview {
		margin: 34px 0;
		color: #302b40;
		--policy-purple: #8762d8;
		--policy-mint: #26a984;
		--policy-muted: #81798e;
		--policy-line: #eeebf3;
	}
	.policy-section-heading,
	.priority-heading {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
	}
	.policy-section-heading {
		margin-bottom: 20px;
	}
	.section-eyebrow {
		display: block;
		margin-bottom: 7px;
		color: var(--policy-muted);
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 1.1px;
		text-transform: uppercase;
	}
	h2 {
		margin: 0;
		font-size: 23px;
		font-weight: 500;
		letter-spacing: -0.75px;
		line-height: 1.3;
	}
	.policy-section-heading p,
	.priority-heading p {
		margin: 7px 0 0;
		color: var(--policy-muted);
		font-size: 12px;
		line-height: 1.6;
	}
	:global(.policy-overview .policy-section-heading button) {
		border-color: #e5def2;
		background: #fff;
		color: #7651c2;
		border-radius: 10px;
		font-size: 11px;
		box-shadow: 0 2px 3px #392b5903;
	}
	.policy-summary {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 12px 25px;
		margin-bottom: 21px;
	}
	.policy-summary > div {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		color: var(--policy-muted);
	}
	.policy-summary strong {
		color: #514563;
		font-size: 12px;
		font-weight: 550;
		font-variant-numeric: tabular-nums;
	}
	.summary-dot {
		width: 7px;
		height: 7px;
		margin-right: 2px;
		border-radius: 50%;
		background: var(--policy-purple);
		box-shadow: 0 0 0 3px #8762d811;
	}
	.sector-comparison {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 18px;
	}
	:global(.policy-overview .sector-card) {
		position: relative;
		padding: 22px 22px 9px;
		gap: 0;
		border: 1px solid #ebe6f1;
		border-radius: 20px;
		box-shadow: 0 4px 16px #3f255b03;
		background: #fff;
		--tw-ring-shadow: 0 0 #0000;
		transition:
			border-color 150ms ease,
			box-shadow 150ms ease;
	}
	:global(.policy-overview .sector-selected) {
		border-color: #bca4e8;
		box-shadow: 0 0 0 3px #8762d80d;
	}
	.sector-heading {
		display: flex;
		align-items: center;
		gap: 9px;
	}
	h3 {
		margin: 0;
		font-size: 14px;
		font-weight: 550;
		letter-spacing: -0.2px;
	}
	.sector-icon {
		width: 34px;
		height: 34px;
		border-radius: 11px;
		display: grid;
		place-items: center;
		background: #fff1e5;
		color: #cb8b4e;
	}
	:global(.sector-health) .sector-icon {
		color: #269d7c;
		background: #e5f7f0;
	}
	:global(.sector-education) .sector-icon {
		color: #8762d8;
		background: #f0eafb;
	}
	.selected-label {
		margin-left: auto;
		color: #7953c4;
		font-size: 9px;
		padding: 4px 7px;
		background: #f3eefb;
		border-radius: 6px;
	}
	.sector-visual {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 116px;
		align-items: center;
		gap: 10px;
		margin: 19px 0 14px;
	}
	.sector-value strong {
		display: block;
		font-size: 45px;
		font-weight: 400;
		letter-spacing: -2.5px;
		line-height: 1.1;
		font-variant-numeric: tabular-nums;
	}
	.sector-value > span {
		display: block;
		margin-top: 8px;
		color: var(--policy-muted);
		font-size: 11px;
		line-height: 1.5;
	}
	.sector-donut {
		position: relative;
		width: 116px;
		height: 116px;
	}
	.sector-donut svg {
		display: block;
		width: 100%;
		height: 100%;
		transform: rotate(-90deg);
	}
	.sector-donut circle {
		fill: none;
		stroke-width: 12px;
	}
	.donut-track {
		stroke: #eeebf3;
	}
	.donut-review {
		stroke: var(--policy-purple);
	}
	.donut-strong {
		stroke: var(--policy-mint);
	}
	.donut-center {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		pointer-events: none;
	}
	.donut-center strong {
		font-size: 20px;
		font-weight: 450;
		letter-spacing: -0.8px;
		font-variant-numeric: tabular-nums;
	}
	.donut-center span {
		margin-top: 2px;
		font-size: 9px;
		color: var(--policy-muted);
	}
	.sector-context {
		display: grid;
		gap: 9px;
		padding-bottom: 17px;
		border-bottom: 1px solid var(--policy-line);
	}
	.sector-context > div {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		font-size: 11px;
		color: var(--policy-muted);
	}
	.sector-context span {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.sector-context strong {
		font-weight: 500;
		color: #514563;
		font-variant-numeric: tabular-nums;
	}
	.sector-context i,
	.screening-legend i {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.review-key {
		background: var(--policy-purple);
	}
	.strong-key {
		background: var(--policy-mint);
	}
	.unknown-key {
		background: #c9c2d4;
	}
	:global(.policy-overview .sector-action) {
		width: calc(100% + 16px);
		margin: 8px -8px 0;
		display: flex;
		justify-content: space-between;
		color: #7953c4;
		font-size: 11px;
		border-radius: 9px;
	}
	:global(.policy-overview button:active) {
		transform: scale(0.98);
	}
	:global(.policy-overview button:focus-visible) {
		outline: 2px solid #8762d8;
		outline-offset: 3px;
	}
	.screening-legend {
		display: flex;
		gap: 19px;
		flex-wrap: wrap;
		margin: 17px 0 8px;
		font-size: 10px;
		color: var(--policy-muted);
	}
	.screening-legend > span {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}
	.screening-definition {
		margin: 0 0 26px;
		color: var(--policy-muted);
		font-size: 11px;
		line-height: 1.7;
		max-width: 910px;
	}
	:global(.policy-overview .priority-card) {
		border: 1px solid #ebe6f1;
		border-radius: 20px;
		background: #fff;
		padding: 0;
		gap: 0;
		overflow: hidden;
		box-shadow: 0 4px 16px #3f255b03;
		--tw-ring-shadow: 0 0 #0000;
	}
	.priority-heading {
		padding: 25px 26px 19px;
		margin: 0;
	}
	.priority-heading h2 {
		font-size: 20px;
		letter-spacing: -0.6px;
	}
	.priority-heading .section-eyebrow {
		margin-bottom: 6px;
		font-size: 9px;
	}
	.priority-toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 0 26px 19px;
	}
	.queue-controls {
		display: flex;
		gap: 3px;
		padding: 4px;
		border-radius: 11px;
		background: #f5f2fa;
	}
	:global(.policy-overview .queue-controls button) {
		font-size: 11px;
		border-radius: 8px;
		color: #81798e;
		background: transparent;
		box-shadow: none;
	}
	:global(.policy-overview .queue-controls button[aria-pressed='true']) {
		color: #7250b6;
		background: #fff;
		box-shadow: 0 1px 4px #4c326b0a;
	}
	.queue-controls span {
		font-size: 10px;
		opacity: 0.75;
		margin-left: 4px;
		font-variant-numeric: tabular-nums;
	}
	.priority-search {
		position: relative;
		width: 240px;
		color: var(--policy-muted);
		flex-shrink: 1;
	}
	.priority-search > :global(svg) {
		position: absolute;
		top: 50%;
		left: 11px;
		transform: translateY(-50%);
		z-index: 1;
	}
	.priority-search :global(input) {
		height: 37px;
		padding-left: 33px;
		font-size: 11px;
		border-color: #eae5f1;
		border-radius: 10px;
		box-shadow: none;
		background: #fdfcfe;
	}
	.priority-row {
		display: grid;
		grid-template-columns: minmax(135px, 0.9fr) minmax(150px, 1.75fr) minmax(110px, 0.8fr) auto;
		align-items: center;
		column-gap: 21px;
		padding: 19px 26px;
		border-top: 1px solid var(--policy-line);
	}
	.priority-island {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.island-mark {
		display: grid;
		place-items: center;
		width: 35px;
		height: 35px;
		border-radius: 11px;
		background: #f4effc;
		color: #a18ac7;
		flex-shrink: 0;
	}
	.priority-island strong {
		display: block;
		font-size: 12px;
		font-weight: 550;
		overflow-wrap: anywhere;
	}
	.priority-island > div > span {
		display: block;
		color: var(--policy-muted);
		font-size: 10px;
		margin-top: 4px;
	}
	.issue-labels {
		display: flex;
		gap: 5px;
		flex-wrap: wrap;
	}
	.issue-chip {
		font-size: 9px;
		padding: 4px 7px;
		color: #7956bd;
		background: #f3edfc;
		border-radius: 6px;
	}
	.unknown-chip {
		color: #83798f;
		background: #f1eef5;
	}
	.priority-issue p {
		margin: 7px 0 0;
		color: var(--policy-muted);
		font-size: 11px;
		line-height: 1.6;
		overflow-wrap: anywhere;
	}
	.priority-context {
		font-size: 10px;
		color: var(--policy-muted);
		line-height: 1.5;
	}
	.priority-context strong {
		display: block;
		color: #514563;
		font-size: 15px;
		font-weight: 450;
		letter-spacing: -0.4px;
		font-variant-numeric: tabular-nums;
	}
	.priority-context > span {
		display: block;
	}
	.priority-context :global([data-slot='badge']) {
		font-size: 8px;
		padding: 3px 5px;
		margin-top: 5px;
		white-space: normal;
		border-color: #dfefe8;
		color: #38977b;
		background: #f3faf7;
	}
	:global(.policy-overview .priority-row > button) {
		font-size: 10px;
		border-color: #e8e1f3;
		color: #7956bd;
		border-radius: 9px;
		box-shadow: none;
	}
	.priority-footer {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 15px;
		padding: 14px 26px;
		background: #fdfcfe;
		border-top: 1px solid var(--policy-line);
		font-size: 10px;
		color: var(--policy-muted);
	}
	.priority-footer > div {
		display: flex;
		gap: 11px;
		align-items: center;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	:global(.policy-overview .priority-footer button) {
		border-color: #e8e1f3;
		border-radius: 8px;
		color: #7956bd;
		box-shadow: none;
	}
	.priority-empty {
		padding: 35px 26px;
		border-top: 1px solid var(--policy-line);
		font-size: 12px;
		color: var(--policy-muted);
	}
	.priority-empty strong {
		font-weight: 500;
		color: #514563;
	}
	.priority-empty p {
		margin: 8px 0 13px;
		line-height: 1.6;
	}
	.policy-evidence {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 9px;
		color: var(--policy-muted);
		gap: 10px;
	}
	:global(.policy-overview .policy-evidence button) {
		padding-left: 0;
		color: var(--policy-muted);
		font-size: 11px;
	}
	.policy-evidence > span {
		font-size: 10px;
	}
	.evidence-detail {
		padding: 22px 25px;
		background: #f2edf9;
		border: 1px solid #e7def1;
		border-radius: 15px;
		color: #776d84;
		margin-top: 8px;
		font-size: 11px;
		line-height: 1.8;
	}
	.evidence-detail h3 {
		color: #514563;
		font-size: 13px;
	}
	.evidence-detail p {
		margin: 8px 0 0;
	}
	.evidence-detail ul {
		margin: 9px 0 0;
		padding-left: 17px;
	}
	.opportunity-error {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 18px;
		padding: 22px;
		border: 1px solid #f0ddc7;
		background: #fff8ef;
		border-radius: 17px;
		color: #956b42;
		font-size: 12px;
	}
	.opportunity-error p {
		margin: 6px 0 0;
	}
	@media (max-width: 1100px) {
		.priority-row {
			grid-template-columns: minmax(125px, 0.9fr) minmax(130px, 1.7fr) auto;
			gap: 15px;
		}
		.priority-context {
			display: none;
		}
		:global(.policy-overview .sector-card) {
			padding: 20px 18px 8px;
		}
		.sector-visual {
			grid-template-columns: minmax(0, 1fr) 95px;
			gap: 7px;
		}
		.sector-donut {
			width: 95px;
			height: 95px;
		}
		.sector-value strong {
			font-size: 38px;
		}
		.sector-context > div {
			font-size: 10px;
		}
		.ordering-note {
			display: none;
		}
	}
	@media (max-width: 740px) {
		.policy-overview {
			margin-top: 26px;
		}
		.policy-section-heading {
			align-items: flex-start;
			flex-direction: column;
			gap: 14px;
		}
		h2 {
			font-size: 22px;
		}
		.policy-summary {
			gap: 9px 17px;
			margin-bottom: 18px;
		}
		.policy-summary > .summary-primary {
			width: 100%;
		}
		.policy-summary > div,
		.policy-summary strong {
			font-size: 10px;
		}
		.sector-comparison {
			grid-template-columns: minmax(0, 1fr);
			gap: 12px;
		}
		:global(.policy-overview .sector-card) {
			padding: 18px 20px 7px;
			border-radius: 17px;
		}
		.sector-visual {
			grid-template-columns: minmax(0, 1fr) 108px;
			margin: 12px 0 9px;
		}
		.sector-donut {
			width: 108px;
			height: 108px;
		}
		.sector-value strong {
			font-size: 43px;
		}
		.sector-value > span br {
			display: none;
		}
		.sector-context {
			grid-template-columns: 1fr 1fr;
			gap: 17px;
			padding-bottom: 12px;
		}
		.sector-context > div {
			font-size: 10px;
		}
		.screening-legend {
			gap: 9px 15px;
			font-size: 9px;
		}
		.screening-definition {
			font-size: 10px;
			margin-bottom: 21px;
		}
		.priority-heading {
			padding: 22px 19px 17px;
		}
		.priority-heading h2 {
			font-size: 19px;
		}
		.priority-toolbar {
			flex-direction: column;
			align-items: stretch;
			padding: 0 19px 18px;
			gap: 12px;
		}
		.queue-controls {
			width: fit-content;
		}
		:global(.policy-overview .queue-controls button) {
			font-size: 10px;
			padding-inline: 9px;
		}
		.priority-search {
			width: 100%;
		}
		.priority-row {
			grid-template-columns: minmax(0, 1fr) auto;
			padding: 19px;
			gap: 13px;
		}
		.priority-island {
			grid-column: 1;
			grid-row: 1;
		}
		.priority-issue {
			grid-column: 1 / -1;
			grid-row: 2;
		}
		:global(.policy-overview .priority-row > button) {
			grid-column: 2;
			grid-row: 1;
			font-size: 9px;
			gap: 5px;
			padding-inline: 9px;
		}
		.priority-footer {
			padding: 13px 19px;
			font-size: 9px;
		}
		.priority-footer > div {
			gap: 7px;
		}
		.policy-evidence > span {
			text-align: right;
			font-size: 9px;
			max-width: 130px;
		}
		.evidence-detail {
			padding: 19px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.policy-overview .sector-card) {
			transition: none;
		}
	}
</style>
