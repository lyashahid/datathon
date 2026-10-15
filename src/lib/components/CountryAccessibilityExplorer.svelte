<script lang="ts">
	import { ArrowLeft, ArrowRight, ChevronRight, ChevronUp, Search } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import {
		accessibilityDomains,
		accessibilityExplorerIslands,
		residentialAtollAccessibility,
		summarizeResidentialAccessibility
	} from '#lib/country-accessibility.js';
	import type { Accessibility, MapFeatures } from '#lib/types.js';

	let {
		features,
		scores,
		loading,
		error,
		selectedId,
		atoll,
		onRetry,
		onCountry,
		onAtoll,
		onIsland,
		onPlan,
		onAnalytics,
		onSearch,
		searchOpen = false
	}: {
		features: MapFeatures | null;
		scores: Accessibility[] | null;
		loading: boolean;
		error: string;
		selectedId: string | null;
		atoll: string | null;
		onRetry: () => void;
		onCountry: () => void;
		onAtoll: (atoll: string) => void;
		onIsland: (id: string) => void;
		onPlan: () => void;
		onAnalytics: () => void;
		onSearch: (event: MouseEvent) => void;
		searchOpen?: boolean;
	} = $props();

	const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
	const integer = new Intl.NumberFormat('en-US');
	const domainLabels = { health: 'Health', education: 'Education', transport: 'Transport' };
	let showDetails = $state(false);
	const islands = $derived(accessibilityExplorerIslands(features, scores));
	const national = $derived(summarizeResidentialAccessibility(islands));
	const atolls = $derived(residentialAtollAccessibility(islands));
	const selectedIsland = $derived(islands.find((island) => island.id === selectedId) ?? null);
	const selectedAtoll = $derived(atolls.find((group) => group.name === atoll) ?? null);
	const scope = $derived(selectedId ? 'island' : atoll ? 'atoll' : 'country');
	const expanded = $derived(scope !== 'country' || showDetails);
	const scopeSummary = $derived(scope === 'atoll' ? selectedAtoll : national);
	const score = $derived(
		scope === 'island' ? (selectedIsland?.score ?? null) : (scopeSummary?.averageScore ?? null)
	);
	const title = $derived(
		scope === 'island' ? (selectedIsland?.name ?? 'Selected island') : atoll || 'Maldives'
	);
	const population = $derived(selectedIsland?.population);
	const parentAtoll = $derived(
		atoll || (selectedIsland?.atoll === 'Unassigned atoll' ? null : selectedIsland?.atoll) || null
	);
	const residentCount = $derived(
		typeof population?.total === 'number' && Number.isFinite(population.total)
			? population.total
			: null
	);
	const question = $derived(
		score !== null && score < 40 ? 'Why is access so low?' : 'What shapes this score?'
	);

	$effect(() => {
		void selectedId;
		void atoll;
		showDetails = false;
	});

	function backToAtoll() {
		if (parentAtoll) onAtoll(parentAtoll);
		else onCountry();
	}

	const formatScore = (value: number | null) => (value === null ? '—' : decimal.format(value));
</script>

<section
	class="country-accessibility-explorer"
	class:expanded
	aria-label="Accessibility explorer"
	aria-busy={loading}
	data-scope={scope}
	data-expanded={expanded}
	data-testid="country-accessibility-explorer"
>
	{#if loading && !scores}
		<div class="status-content" role="status">
			<p class="eyebrow">Maldives</p>
			<h2>Reading the islands…</h2>
			<p>Bringing together accessibility scores and mapped evidence.</p>
		</div>
	{:else if error && !scores}
		<div class="status-content">
			<p class="eyebrow">Maldives</p>
			<h2>Scores couldn’t load</h2>
			<p role="alert">{error}</p>
			<Button variant="outline" onclick={onRetry}>Try again</Button>
		</div>
	{:else}
		<div class="explorer-heading">
			{#if scope !== 'country'}
				<Button
					variant="ghost"
					size="sm"
					class="explorer-back"
					onclick={scope === 'island' ? backToAtoll : onCountry}
				>
					<ArrowLeft size={13} />
					{scope === 'island' && parentAtoll ? 'Back to atoll' : 'Back to Maldives'}
				</Button>
			{/if}
			<div class="heading-line">
				<p class="eyebrow">{scope === 'country' ? 'Maldives' : scope}</p>
				{#if scope === 'country' && showDetails}
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Close score explanation"
						aria-expanded={showDetails}
						onclick={() => (showDetails = false)}><ChevronUp size={16} /></Button
					>
				{/if}
			</div>
			{#if scope !== 'country'}<h2>{title}</h2>{/if}
			{#if scope === 'island' && selectedIsland}
				<p class="island-context">{selectedIsland.atoll}</p>
			{/if}
			<div class="score-line">
				<strong
					class="score-value"
					data-testid={scope === 'country'
						? 'national-accessibility-score'
						: `${scope}-accessibility-score`}>{formatScore(score)}</strong
				><span class="score-out-of">/100<span>Access index</span></span>
			</div>
			{#if scope !== 'island' && scopeSummary}
				<p class="score-basis" data-testid="accessibility-score-basis">
					{#if scopeSummary.unscoredIslandCount === 0}
						Average across {integer.format(scopeSummary.islandCount)} residential islands
					{:else}
						Average across {integer.format(scopeSummary.scoredIslandCount)} of {integer.format(
							scopeSummary.islandCount
						)} residential islands with scores
					{/if}
				</p>
			{:else if scope === 'island'}
				<p class="score-basis">
					{selectedIsland?.assessment?.label ?? 'Score evidence unavailable'}
				</p>
			{/if}
			{#if scope === 'country' && !showDetails}
				<p class="initial-note">Missing map data can lower this score.</p>
				<p class="country-introduction" data-testid="country-map-introduction">
					Explore access to healthcare, schools and transport. Zoom in or select an island to see
					its services, journeys and planning options.
				</p>
				<h2 class="score-question">{question}</h2>
				<Button
					class="explain-action"
					aria-expanded={showDetails}
					aria-controls="national-score-explanation"
					onclick={() => (showDetails = true)}
				>
					Find out why <ArrowRight size={15} />
				</Button>
			{/if}
			<Button
				variant="ghost"
				size="sm"
				class="search-action"
				data-island-search-trigger
				aria-haspopup="dialog"
				aria-expanded={searchOpen}
				aria-controls={searchOpen ? 'island-search-results' : undefined}
				onclick={onSearch}
			>
				<Search size={13} /> Find an island
			</Button>
		</div>

		{#if expanded}
			<div class="explorer-details" data-testid="accessibility-explorer-details">
				{#if scope === 'country'}
					<div id="national-score-explanation">
						<h3>What shapes the score</h3>
						<p class="section-intro">
							An equal average of island scores, based on mapped services.
						</p>
						<dl class="component-scores">
							{#each accessibilityDomains as domain (domain)}
								<div>
									<dt>{domainLabels[domain]}</dt>
									<dd>{formatScore(national.components[domain].averageScore)}<span>/100</span></dd>
								</div>
							{/each}
						</dl>
						{#if accessibilityDomains.some((domain) => national.components[domain].scoredIslandCount !== national.scoredIslandCount)}
							<p class="evidence-note">
								Each area averages only islands with a recorded component score.
							</p>
						{/if}
						<div class="evidence-summary">
							<p>
								<strong>{integer.format(national.mappedEvidenceIslandCount)}</strong> residential islands
								have mapped evidence in at least one area.
							</p>
							<p>
								<strong>{integer.format(national.populationUnknownIslandCount)}</strong> have unknown
								resident counts.
							</p>
							{#if national.unknownEvidenceIslandCount > 0}
								<p>
									Evidence coverage is unavailable for {integer.format(
										national.unknownEvidenceIslandCount
									)} islands.
								</p>
							{/if}
						</div>
						<p class="evidence-note">
							A low score can reflect missing evidence. Missing map data does not mean services are
							absent.
						</p>
						<div class="section-heading">
							<h3>Explore an atoll</h3>
							<span>Index /100</span>
						</div>
						<div class="scope-list" aria-label="Atoll accessibility scores">
							{#each atolls as group (group.name)}
								<Button
									variant="ghost"
									class="scope-row"
									data-atoll={group.name}
									onclick={() => onAtoll(group.name)}
								>
									<span class="scope-row-label"
										><span>{group.name}</span><small
											>{group.scoredIslandCount} of {group.islandCount} islands scored</small
										></span
									>
									<strong>{formatScore(group.averageScore)}</strong><ChevronRight size={14} />
								</Button>
							{:else}<p class="evidence-note">Residential island records are unavailable.</p>{/each}
						</div>
					</div>
				{:else if scope === 'atoll'}
					<p class="evidence-note">
						A low score can reflect missing mapped evidence, even where services exist.
					</p>
					<div class="section-heading">
						<h3>Residential islands</h3>
						<span>Index /100</span>
					</div>
					<div class="scope-list" aria-label="Residential island accessibility scores">
						{#each selectedAtoll?.islands ?? [] as island (island.id)}
							<Button
								variant="ghost"
								class="scope-row"
								data-island-id={island.id}
								onclick={() => onIsland(island.id)}
							>
								<span class="scope-row-label"><span>{island.name}</span></span>
								<strong>{formatScore(island.score)}</strong><ChevronRight size={14} />
							</Button>
						{:else}<p class="evidence-note">
								No residential island records are available for this atoll.
							</p>{/each}
					</div>
				{:else}
					<dl class="resident-count">
						<div>
							<dt>Recorded residents{population?.year ? ` · ${population.year}` : ''}</dt>
							<dd>{residentCount === null ? 'Unknown' : integer.format(residentCount)}</dd>
						</div>
					</dl>
					<div class="island-reasons" data-testid="island-accessibility-reasons">
						{#each accessibilityDomains as domain (domain)}
							{@const reason = selectedIsland?.assessment?.reasons?.find(
								(item) => item.domain === domain
							)}
							<div>
								<h3>{domainLabels[domain]}</h3>
								<p>{reason?.text ?? 'An explanation for this area is not available yet.'}</p>
							</div>
						{/each}
					</div>
					<div class="island-evidence">
						{#if selectedIsland?.assessment}<p>{selectedIsland.assessment.coverage.note}</p>{/if}
						<p>
							Missing map data does not mean services are absent. This index is not the percentage
							of residents served.
						</p>
					</div>
					<Button class="proposal-action" onclick={onPlan} disabled={!selectedIsland}
						>Create a proposal <ArrowRight size={15} /></Button
					>
				{/if}
				<Button variant="outline" class="analytics-action" onclick={onAnalytics}
					>Open analytics <ArrowRight size={14} /></Button
				>
			</div>
		{/if}
	{/if}
</section>

<style>
	.country-accessibility-explorer {
		width: 310px;
		max-width: 100%;
		max-height: calc(100dvh - 40px);
		display: flex;
		flex-direction: column;
		overflow: hidden;
		border: 1px solid #e2e6e3;
		border-radius: 20px;
		background: #fff;
		color: #26392f;
		box-shadow:
			0 6px 24px #183b3212,
			0 1px 3px #183b3208;
		pointer-events: auto;
	}
	.explorer-heading {
		flex-shrink: 0;
		padding: 20px 20px 17px;
	}
	.heading-line {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 18px;
	}
	.eyebrow {
		font-size: 10px;
		font-weight: 650;
		letter-spacing: 1.8px;
		line-height: 1.4;
		text-transform: uppercase;
		color: #617267;
	}
	.explorer-heading h2 {
		margin-top: 7px;
		font-size: 21px;
		font-weight: 550;
		line-height: 1.25;
		letter-spacing: -0.65px;
		overflow-wrap: anywhere;
	}
	.island-context {
		margin-top: 4px;
		color: #6a776e;
		font-size: 11px;
	}
	.score-line {
		display: flex;
		align-items: baseline;
		gap: 5px;
		margin-top: 10px;
	}
	.score-value {
		font-size: 65px;
		font-weight: 500;
		letter-spacing: -4.5px;
		line-height: 1.05;
		font-variant-numeric: tabular-nums;
	}
	.score-out-of {
		font-size: 18px;
		font-weight: 450;
		color: #849087;
	}
	.score-out-of > span {
		display: block;
		margin-top: 2px;
		font-size: 9px;
		font-weight: 550;
		letter-spacing: 0.35px;
		color: #6a786f;
	}
	.score-basis {
		margin-top: 10px;
		font-size: 11px;
		line-height: 1.55;
		color: #57695e;
	}
	.initial-note {
		margin-top: 3px;
		font-size: 11px;
		line-height: 1.5;
		color: #7c837e;
	}
	.country-introduction {
		margin-top: 12px;
		font-size: 12px;
		line-height: 1.6;
		color: #57695e;
	}
	.explorer-heading .score-question {
		margin-top: 19px;
		font-size: 16px;
		line-height: 1.3;
		letter-spacing: -0.35px;
	}
	:global(.country-accessibility-explorer .explain-action) {
		width: 100%;
		justify-content: space-between;
		margin-top: 12px;
		min-height: 40px;
		padding-inline: 13px;
		border-radius: 11px;
		font-size: 12px;
		background: #294e3e;
	}
	:global(.country-accessibility-explorer .search-action) {
		display: flex;
		margin: 7px auto -4px;
		gap: 6px;
		font-size: 11px;
		color: #697a6f;
	}
	:global(.country-accessibility-explorer .explorer-back) {
		min-height: 32px;
		height: auto;
		margin: -6px 0 9px -8px;
		padding-inline: 8px;
		gap: 6px;
		font-size: 10px;
		color: #63766b;
	}
	.expanded .score-value {
		font-size: 52px;
		letter-spacing: -3px;
	}
	.explorer-details {
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 0 20px 18px;
		scrollbar-width: thin;
		scrollbar-color: #d5ded7 transparent;
	}
	.explorer-details > div:first-child {
		border-top: 1px solid #edf0ed;
		padding-top: 16px;
	}
	.explorer-details h3 {
		color: #374b3e;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: -0.1px;
	}
	.section-intro {
		margin-top: 5px;
		color: #77827a;
		font-size: 11px;
		line-height: 1.6;
	}
	.component-scores {
		margin: 12px 0;
	}
	.component-scores > div,
	.resident-count > div {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 6px 0;
	}
	.component-scores dt,
	.resident-count dt {
		font-size: 12px;
		color: #607166;
	}
	.component-scores dd,
	.resident-count dd {
		margin: 0;
		color: #304c39;
		font-size: 13px;
		font-weight: 550;
		font-variant-numeric: tabular-nums;
	}
	.component-scores dd span {
		margin-left: 3px;
		color: #98a098;
		font-size: 10px;
		font-weight: 400;
	}
	.evidence-summary {
		display: grid;
		gap: 5px;
		margin: 12px 0 9px;
		border-radius: 10px;
		background: #f4f6f2;
		padding: 11px 12px;
	}
	.evidence-summary p {
		color: #6d786d;
		font-size: 11px;
		line-height: 1.6;
	}
	.evidence-summary strong {
		font-weight: 600;
		color: #415b45;
	}
	.evidence-note {
		font-size: 10px;
		color: #7d857c;
		line-height: 1.65;
	}
	.section-heading {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 10px;
		margin: 20px 0 6px;
	}
	.section-heading > span {
		font-size: 9px;
		color: #97a196;
	}
	.scope-list {
		display: grid;
		gap: 2px;
	}
	:global(.country-accessibility-explorer .scope-row) {
		display: flex;
		width: calc(100% + 12px);
		min-height: 43px;
		height: auto;
		margin-inline: -6px;
		padding: 9px 6px;
		gap: 7px;
		justify-content: space-between;
		border-radius: 8px;
		white-space: normal;
		text-align: left;
	}
	.scope-row-label {
		min-width: 0;
		flex: 1;
		color: #52684f;
		font-size: 12px;
		line-height: 1.4;
	}
	.scope-row-label > span {
		display: block;
	}
	.scope-row-label small {
		display: block;
		margin-top: 2px;
		color: #90988c;
		font-size: 9px;
		font-weight: 400;
	}
	:global(.country-accessibility-explorer .scope-row strong) {
		font-size: 12px;
		color: #5b7055;
		font-weight: 550;
		font-variant-numeric: tabular-nums;
	}
	:global(.country-accessibility-explorer .scope-row svg) {
		color: #9ba995;
	}
	.resident-count {
		margin: 0 0 14px;
		padding-top: 9px;
		border-top: 1px solid #edf0ed;
	}
	.resident-count dt {
		font-size: 10px;
	}
	.resident-count dd {
		font-size: 12px;
	}
	.island-reasons {
		display: grid;
		gap: 15px;
	}
	.island-reasons p {
		margin-top: 3px;
		color: #738071;
		font-size: 11px;
		line-height: 1.65;
	}
	.island-evidence {
		margin-top: 17px;
		padding: 11px 12px;
		border-radius: 10px;
		background: #f4f6f2;
	}
	.island-evidence p {
		font-size: 10px;
		color: #7b8578;
		line-height: 1.65;
	}
	.island-evidence p + p {
		margin-top: 5px;
	}
	:global(.country-accessibility-explorer .proposal-action),
	:global(.country-accessibility-explorer .analytics-action) {
		width: 100%;
		min-height: 38px;
		justify-content: space-between;
		margin-top: 16px;
		padding-inline: 12px;
		font-size: 11px;
		border-radius: 10px;
	}
	:global(.country-accessibility-explorer .proposal-action) {
		background: #294e3e;
	}
	:global(.country-accessibility-explorer .analytics-action) {
		margin-top: 12px;
		color: #657b5b;
		border-color: #e7ece1;
	}
	.status-content {
		display: grid;
		gap: 12px;
		padding: 22px;
	}
	.status-content h2 {
		font-size: 19px;
		letter-spacing: -0.5px;
	}
	.status-content p:not(.eyebrow) {
		font-size: 12px;
		color: #7b857a;
	}
	@media (max-width: 700px) {
		.country-accessibility-explorer {
			width: 100%;
			max-height: 42dvh;
			border-radius: 18px;
		}
		.explorer-heading {
			padding: 15px 18px 12px;
		}
		.score-line {
			margin-top: 6px;
		}
		.score-value {
			font-size: 53px;
			letter-spacing: -3.5px;
		}
		.score-basis {
			margin-top: 6px;
		}
		.explorer-heading .score-question {
			margin-top: 12px;
			font-size: 15px;
		}
		:global(.country-accessibility-explorer .explain-action) {
			min-height: 37px;
			margin-top: 9px;
		}
		:global(.country-accessibility-explorer .search-action) {
			height: 27px;
			min-height: 27px;
			margin-top: 4px;
		}
		.expanded .explorer-heading {
			padding-bottom: 11px;
		}
		.expanded .score-value {
			font-size: 43px;
			letter-spacing: -2.5px;
		}
		.expanded .score-out-of {
			font-size: 14px;
		}
		.expanded .score-out-of > span {
			display: none;
		}
		.expanded:not([data-scope='country']) .explorer-heading {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto;
			column-gap: 10px;
			padding-top: 10px;
		}
		:global(.country-accessibility-explorer.expanded:not([data-scope='country']) .explorer-back) {
			grid-column: 1 / -1;
			grid-row: 1;
			min-height: 27px;
			margin: -3px 0 5px -8px;
		}
		.expanded:not([data-scope='country']) .heading-line {
			grid-column: 1;
			grid-row: 2;
			min-height: 12px;
		}
		.expanded:not([data-scope='country']) .explorer-heading h2 {
			grid-column: 1;
			grid-row: 3;
			margin-top: 4px;
		}
		.expanded:not([data-scope='country']) .island-context {
			grid-column: 1;
			grid-row: 4;
			margin-top: 2px;
		}
		.expanded:not([data-scope='country']) .score-line {
			grid-column: 2;
			grid-row: 2 / span 3;
			align-self: center;
			margin-top: 0;
		}
		.expanded:not([data-scope='country']) .score-basis {
			grid-column: 1 / -1;
			grid-row: 5;
			margin-top: 8px;
			font-size: 10px;
		}
		.explorer-heading h2 {
			font-size: 18px;
		}
		.explorer-details {
			padding: 0 18px 15px;
		}
		:global(.country-accessibility-explorer .scope-row) {
			min-height: 44px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		:global(.country-accessibility-explorer .ui-button) {
			transition: none;
		}
		:global(.country-accessibility-explorer .ui-button:active) {
			transform: none;
		}
	}
</style>
