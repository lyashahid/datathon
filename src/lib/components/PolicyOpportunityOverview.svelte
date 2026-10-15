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
	const numberFormatter = new Intl.NumberFormat('en-US');
	const number = (value: number) => numberFormatter.format(value);
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
	const residentCount = $derived(
		scoped.reduce((total, island) => total + (island.population ?? 0), 0)
	);
	const mappedCount = $derived(
		scoped.reduce(
			(total, island) =>
				total +
				policyDomains.reduce((count, domain) => count + island.domains[domain].mapped_count, 0),
			0
		)
	);
	const supportedCount = $derived(scoped.filter((island) => island.planning_supported).length);
	const comparison = $derived(
		policyDomains.map((domain) => ({
			domain,
			...opportunityStatusCounts(scoped, domain),
			mappedCount: scoped.reduce((total, island) => total + island.domains[domain].mapped_count, 0)
		}))
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
		atoll === 'all' ? (cohort === 'all' ? 'all islands' : 'residential islands') : atoll
	);
	const serviceLabels = {
		transport: 'transport stops and terminals',
		health: 'health facilities',
		education: 'schools and colleges'
	};
	const singularServiceLabels = {
		transport: 'stop or terminal',
		health: 'health facility',
		education: 'school or college'
	};
	const share = (count: number) => (count / Math.max(1, scoped.length)) * 100;

	async function load() {
		controller?.abort();
		const request = new AbortController();
		controller = request;
		loading = true;
		error = '';
		try {
			const result = await api<PolicyOpportunities>(
				'planning/opportunities?include_geometry=false',
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
		if (!domain) return 'Explore the island to see where services could improve.';
		const evidence = island.domains[domain];
		if (!evidence.mapped_count)
			return `No ${serviceLabels[domain]} are mapped yet. Check local services before planning.`;
		const locations = `${number(evidence.mapped_count)} mapped ${evidence.mapped_count === 1 ? singularServiceLabels[domain] : serviceLabels[domain]}`;
		if (evidence.status === 'unknown')
			return `${locations}. More information is needed to assess access.`;
		return domain === 'transport'
			? `${locations}. Check connections and how often services run.`
			: `${locations}. Check travel times and available capacity.`;
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
				<strong>Island priorities could not be loaded.</strong>
				<p>Please try again to see the islands and services to review.</p>
				<details>
					<summary>Error details</summary>
					<p>{error}</p>
				</details>
			</div>
			<Button size="sm" variant="outline" onclick={load}>Try again</Button>
		</div>
	{:else}
		<div class="policy-section-heading">
			<div>
				<span class="section-eyebrow">Where to focus</span>
				<h2>Which islands need a closer look?</h2>
				<p>See the numbers, then open an island on the map to plan improvements.</p>
			</div>
			<Button
				variant="outline"
				size="sm"
				onclick={() => onExplore(undefined, atoll === 'all' ? undefined : atoll, lens)}
				><MapPin size={14} /> Explore on map</Button
			>
		</div>
		<div class="policy-summary" aria-live="polite">
			<div class="summary-primary">
				<strong>{loading ? '—' : number(reviewCount)}</strong>
				<span>islands to review</span>
			</div>
			<div>
				<strong
					>{loading
						? '—'
						: populationCount
							? number(Math.round(residentCount))
							: 'Not available'}</strong
				>
				<span>residents recorded</span>
			</div>
			<div>
				<strong>{loading ? '—' : number(mappedCount)}</strong>
				<span>service locations mapped</span>
			</div>
		</div>
		<div class="sector-comparison" aria-label="Compare island services">
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
							<span>islands to review</span>
						</div>
						<div class="sector-donut">
							<svg
								viewBox="0 0 100 100"
								role="img"
								aria-label={`${policyDomainLabels[sector.domain]}: ${sector.review} islands to review, ${sector.stronger_evidence} with no review flag, ${sector.unknown} needing more data out of ${scoped.length} islands`}
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
								<strong>{loading ? '—' : number(scoped.length)}</strong><span>islands</span>
							</div>
						</div>
					</div>
					<div class="sector-context">
						<div>
							<span
								>{sector.domain === 'transport'
									? 'Mapped stops and terminals'
									: sector.domain === 'health'
										? 'Mapped health facilities'
										: 'Mapped schools and colleges'}</span
							><strong>{loading ? '—' : number(sector.mappedCount)}</strong>
						</div>
						<div>
							<span><i class="strong-key"></i>No review flag</span><strong
								>{loading ? '—' : number(sector.stronger_evidence)}</strong
							>
						</div>
						<div>
							<span><i class="unknown-key"></i>Need more data</span><strong
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
			<span><i class="review-key"></i> Review access</span><span
				><i class="strong-key"></i> No review flag</span
			><span><i class="unknown-key"></i> Need more data</span>
		</div>
		<p class="screening-definition">
			These numbers highlight where to check access. Missing data does not mean a service is
			missing.
			{#if !loading && populationCount < scoped.length}
				Resident totals cover {number(populationCount)} of {number(scoped.length)} islands.
			{/if}
		</p>

		<Card.Root class="priority-card">
			<div class="priority-heading">
				<div>
					<span class="section-eyebrow">Choose an island</span>
					<h2>
						{queue === 'review' ? 'Islands to review' : 'Islands needing more data'}
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
				<div class="queue-controls" aria-label="Island priorities">
					<Button
						variant={queue === 'review' ? 'secondary' : 'ghost'}
						size="sm"
						aria-pressed={queue === 'review'}
						onclick={() => {
							queue = 'review';
							page = 0;
						}}>Review access <span>{number(reviewCount)}</span></Button
					><Button
						variant={queue === 'unknown' ? 'secondary' : 'ghost'}
						size="sm"
						aria-pressed={queue === 'unknown'}
						onclick={() => {
							queue = 'unknown';
							page = 0;
						}}>Need more data <span>{number(unknownCount)}</span></Button
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
			{#if loading}<div class="priority-empty" role="status">Loading island services…</div>
			{:else if !visible.length}<div class="priority-empty">
					<strong
						>{search
							? 'No islands match your search.'
							: queue === 'review'
								? 'No islands are flagged for review in this selection.'
								: 'No islands need more data in this selection.'}</strong
					>
					<p>
						{search
							? 'Try another island or clear the search.'
							: queue === 'review'
								? 'Check islands needing more data before deciding where services are sufficient.'
								: 'Open the map to see the services available on each island.'}
					</p>
					{#if !search && queue === 'review' && unknownCount}<Button
							variant="outline"
							size="sm"
							onclick={() => {
								queue = 'unknown';
								page = 0;
							}}>See islands needing more data</Button
						>{/if}
				</div>
			{:else}<div class="priority-rows">
					{#each visible as island (island.island_id)}
						{@const relevantDomains = (lens === 'overall' ? policyDomains : [lens]).filter(
							(domain) => island.domains[domain].status === queue
						)}
						<div class="priority-row" data-policy-opportunity-id={island.island_id}>
							<div class="priority-island">
								<span class="island-mark" aria-hidden="true"><MapPin size={17} /></span>
								<div>
									<strong>{island.name}</strong><span>{island.atoll}</span>
									<span class="compact-residents"
										>{island.population === null
											? 'Resident count not available'
											: `${number(Math.round(island.population))} recorded residents`}</span
									>
								</div>
							</div>
							<div class="priority-issue">
								<div class="issue-labels">
									{#each relevantDomains as domain (domain)}<span
											class={`issue-chip ${queue === 'unknown' ? 'unknown-chip' : ''}`}
											>{policyDomainLabels[domain]}
											{queue === 'review' ? 'access' : 'data needed'}</span
										>{/each}
								</div>
								<p>{issueSummary(island, relevantDomains[0])}</p>
							</div>
							<div class="priority-context">
								{#if island.population !== null}<strong
										>{number(Math.round(island.population))}</strong
									><span>recorded residents</span>{:else}<span
										>Resident count<br />not available</span
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
						: 'No islands to display'}</span
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
				><CircleHelp size={14} /> How this is calculated</Button
			>
		</div>
		{#if showEvidence}<div class="evidence-detail" id="policy-screening-evidence">
				<h3>Use the map to investigate, then test the investment.</h3>
				<p>
					{number(scoped.length)} islands in this selection · {number(populationCount)} with resident
					counts · {number(supportedCount)} with detailed proposal forecasts available.
					{referenceDate ? `Data reference: ${referenceDate}.` : ''}
				</p>
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
					{ranked
						? 'Islands with higher review scores appear first.'
						: 'Islands are listed alphabetically because the available scores do not support a useful ranking.'}
					Mapped-location totals count recorded transport stops and terminals, health facilities, and
					schools and colleges. They do not measure the number or quality of services running there.
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
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 12px;
		margin-bottom: 21px;
	}
	.policy-summary > div {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 7px;
		padding: 18px 20px;
		border: 1px solid var(--policy-line);
		border-radius: 14px;
		background: #fff;
		font-size: 11px;
		color: var(--policy-muted);
	}
	.policy-summary > .summary-primary {
		border-color: #e7dcf8;
		background: #f7f3fd;
	}
	.policy-summary strong {
		color: #514563;
		font-size: 28px;
		font-weight: 450;
		letter-spacing: -1px;
		line-height: 1.2;
		font-variant-numeric: tabular-nums;
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
	.priority-island > div > .compact-residents {
		display: none;
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
	.opportunity-error details {
		margin-top: 10px;
		font-size: 11px;
		overflow-wrap: anywhere;
	}
	.opportunity-error summary {
		cursor: pointer;
	}
	@media (max-width: 1100px) {
		.priority-row {
			grid-template-columns: minmax(125px, 0.9fr) minmax(130px, 1.7fr) auto;
			gap: 15px;
		}
		.priority-context {
			display: none;
		}
		.priority-island > div > .compact-residents {
			display: block;
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
			grid-template-columns: repeat(2, minmax(0, 1fr));
			gap: 9px;
			margin-bottom: 18px;
		}
		.policy-summary > .summary-primary {
			grid-column: 1 / -1;
			flex-direction: row;
			align-items: center;
			gap: 10px;
		}
		.policy-summary > div {
			padding: 15px 13px;
			font-size: 10px;
		}
		.policy-summary strong {
			font-size: 23px;
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
		.sector-context {
			gap: 9px;
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
