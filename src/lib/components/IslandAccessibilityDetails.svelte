<script lang="ts">
	import { ArrowRight, Bus, GraduationCap, HeartPulse } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import * as Sheet from '#lib/components/ui/sheet/index.js';
	import type { IslandAnalytics } from '#lib/analytics.js';
	import type { OfficialIslandContext as OfficialIslandContextData } from '#lib/types.js';
	import OfficialIslandContext from '#lib/components/OfficialIslandContext.svelte';

	let {
		island,
		officialIslandContext = null,
		onclose,
		onExplore,
		loading = false,
		error = '',
		onRetry
	}: {
		island: IslandAnalytics;
		officialIslandContext?: OfficialIslandContextData | null;
		onclose: () => void;
		onExplore: (islandId: string, atoll: string) => void;
		loading?: boolean;
		error?: string;
		onRetry?: () => void;
	} = $props();
	const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
	const number = new Intl.NumberFormat('en-US');
	const domains = [
		{ id: 'health', name: 'Health', icon: HeartPulse, color: '#9471cf' },
		{ id: 'education', name: 'Education', icon: GraduationCap, color: '#32ae89' },
		{ id: 'transport', name: 'Transport', icon: Bus, color: '#d59a3e' }
	];
	const assessment = $derived(island.assessment);
	let titleElement = $state<HTMLElement | null>(null);
	let sheetOpen = $state(true);
</script>

<Sheet.Root
	open={sheetOpen}
	onOpenChange={(open) => {
		sheetOpen = open;
	}}
	onOpenChangeComplete={(open) => {
		if (!open) onclose();
	}}
>
	<Sheet.Content
		class="island-accessibility-details"
		resizeKey="island-accessibility"
		aria-label={`${island.name} accessibility`}
		onOpenAutoFocus={(event) => {
			event.preventDefault();
			titleElement?.focus({ preventScroll: true });
		}}
	>
		<div class="accessibility-content">
			<Sheet.Header>
				<p class="eyebrow">ISLAND ACCESSIBILITY</p>
				<Sheet.Title class="accessibility-title" bind:ref={titleElement} tabindex={-1}
					>{island.name}<span class="sr-only"> accessibility</span></Sheet.Title
				>
				<Sheet.Description
					>{island.atoll} · {island.category.replace(' Island', '')}</Sheet.Description
				>
			</Sheet.Header>
			<div class="score-overview">
				<div class="score-number" data-testid="island-accessibility-score">
					<strong>{island.score === null ? '—' : decimal.format(island.score)}</strong><span
						>/100</span
					>
				</div>
				<Badge variant="secondary">{assessment?.label ?? 'Assessment unavailable'}</Badge>
				<p>{assessment?.summary ?? 'The accessibility assessment is not available yet.'}</p>
			</div>
			<div class="population-row">
				<span
					>Recorded residents {#if island.population?.year}<small>· {island.population.year}</small
						>{/if}</span
				>
				<strong
					>{island.population?.total == null
						? 'Not available'
						: number.format(island.population.total)}</strong
				>
			</div>
			<OfficialIslandContext context={officialIslandContext} islandId={island.id} />
			<section
				class="score-reasons"
				aria-label="Reasons for this accessibility score"
				aria-busy={loading}
			>
				<h2>Why this score?</h2>
				{#if loading}<p class="explanation-status" role="status">
						Loading the island's score explanation…
					</p>
				{:else if error}<div class="explanation-status" role="alert">
						<p>{error}</p>
						{#if onRetry}<Button variant="outline" size="sm" onclick={onRetry}>Try again</Button
							>{/if}
					</div>{/if}
				<div data-testid="island-accessibility-reasons">
					{#each domains as domain (domain.id)}
						{@const reason = assessment?.reasons?.find((item) => item.domain === domain.id)}
						{@const component = assessment?.components[domain.id]}
						<div class="domain-reason" style:--domain-color={domain.color}>
							<div class="domain-heading">
								<span><domain.icon size={17} />{domain.name}</span><strong
									>{component ? decimal.format(component.score) : '—'}<small>/100</small></strong
								>
							</div>
							<div class="domain-track" aria-hidden="true">
								<span style:width={`${Math.min(100, Math.max(0, component?.score ?? 0))}%`}></span>
							</div>
							{#if !loading && !error}<p>
									{reason?.text ??
										'There is not enough information to explain this part of the score.'}
								</p>{/if}
						</div>
					{/each}
				</div>
			</section>
			{#if assessment}
				<div class="coverage-notice">
					<strong>{assessment.coverage.label}</strong>
					<p>{assessment.coverage.note}</p>
				</div>
			{/if}
			<p class="score-qualification">
				A planning score based on available data, not the percentage of residents served.
			</p>
			<details class="score-data-details">
				<summary>Data details</summary>
				{#if assessment}<ul>
						{#each assessment.limitations ?? [] as limitation (limitation)}<li>
								{limitation}
							</li>{/each}
					</ul>{/if}
				<dl>
					<div>
						<dt>Island reference</dt>
						<dd>{island.id}</dd>
					</div>
					<div>
						<dt>Model confidence</dt>
						<dd>
							{island.confidence === null ? 'Not available' : decimal.format(island.confidence)}
						</dd>
					</div>
				</dl>
				{#if island.missingData?.length}<p class="technical-flags">
						Model notes: {island.missingData.join(', ')}
					</p>{/if}
			</details>
			<div class="score-actions">
				<Button variant="outline" onclick={() => (sheetOpen = false)}>Back to scores</Button><Button
					aria-label={`Explore ${island.name} on map`}
					onclick={() => {
						const { id, atoll } = island;
						const explore = onExplore;
						onclose();
						explore(id, atoll);
					}}>Explore on map <ArrowRight size={15} /></Button
				>
			</div>
		</div>
	</Sheet.Content>
</Sheet.Root>

<style>
	:global(.island-accessibility-details) {
		width: var(--resizable-width, min(100%, 530px)) !important;
		max-width: min(100vw, 900px) !important;
		padding: 0;
		gap: 0;
		overflow: hidden;
		color: #292535;
		font-variant-numeric: tabular-nums;
	}
	.accessibility-content {
		min-height: 0;
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 22px;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 30px;
	}
	.accessibility-content > :global(*) {
		flex-shrink: 0;
	}
	.eyebrow {
		color: #88709d;
		font-size: 10px;
		font-weight: 650;
		letter-spacing: 0.12em;
		margin: 0 0 8px;
	}
	:global(.accessibility-title) {
		font-size: 28px;
		letter-spacing: -0.8px;
		padding-right: 25px;
	}
	.score-overview {
		background: #f5f2fb;
		border: 1px solid #ece6f5;
		border-radius: 20px;
		padding: 24px;
	}
	.score-number {
		display: flex;
		align-items: baseline;
		gap: 7px;
		margin-bottom: 12px;
	}
	.score-number strong {
		font-size: 64px;
		line-height: 1;
		font-weight: 550;
		letter-spacing: -3px;
	}
	.score-number > span {
		font-size: 19px;
		color: #8a7e99;
	}
	.score-overview p {
		font-size: 13px;
		line-height: 1.6;
		margin-top: 12px;
		color: #655c73;
	}
	.population-row,
	.domain-heading,
	.domain-heading > span {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.population-row {
		font-size: 13px;
		flex-wrap: wrap;
	}
	.population-row small {
		color: #827a8b;
	}
	.score-reasons h2 {
		font-size: 17px;
		font-weight: 600;
		margin: 0 0 5px;
	}
	.explanation-status {
		font-size: 12px;
		line-height: 1.6;
		color: #71687e;
		padding: 12px 0;
	}
	.explanation-status p {
		margin: 0 0 10px;
	}
	.domain-reason {
		padding: 18px 0;
		border-bottom: 1px solid #eeeaf2;
	}
	.domain-heading {
		font-size: 13px;
		margin-bottom: 10px;
	}
	.domain-heading :global(svg) {
		color: var(--domain-color);
	}
	.domain-heading strong {
		font-size: 18px;
		font-weight: 600;
	}
	.domain-heading small {
		font-size: 11px;
		color: #8a8194;
		margin-left: 3px;
		font-weight: 400;
	}
	.domain-track {
		height: 5px;
		border-radius: 8px;
		background: #f0edf4;
		overflow: hidden;
	}
	.domain-track > span {
		height: 100%;
		display: block;
		border-radius: inherit;
		background: var(--domain-color);
	}
	.domain-reason p,
	.coverage-notice p {
		color: #71687e;
		font-size: 12px;
		line-height: 1.6;
		margin: 9px 0 0;
	}
	.coverage-notice {
		background: #faf8f1;
		padding: 15px 17px;
		border-radius: 14px;
		font-size: 12px;
	}
	.coverage-notice p {
		margin-top: 4px;
	}
	.score-qualification {
		color: #81778d;
		font-size: 11px;
		line-height: 1.5;
	}
	.score-data-details {
		font-size: 12px;
		color: #71687e;
	}
	summary {
		cursor: pointer;
		color: #56456e;
		padding: 5px 0;
	}
	.score-data-details ul {
		margin: 12px 0;
		padding-left: 18px;
		line-height: 1.7;
	}
	dl > div {
		display: flex;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 8px;
		margin: 8px 0;
	}
	.technical-flags {
		overflow-wrap: anywhere;
		margin-top: 10px;
	}
	.score-actions {
		display: flex;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: 8px;
		padding-top: 6px;
	}
	@media (max-width: 480px) {
		.accessibility-content {
			padding: 26px 20px;
			gap: 20px;
		}
		.score-overview {
			padding: 20px;
		}
	}
</style>
