<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import type { Accessibility } from '#lib/types.js';

	let {
		islandName,
		accessibility,
		loading,
		error,
		onRetry
	}: {
		islandName: string;
		accessibility: Accessibility | null;
		loading: boolean;
		error: string;
		onRetry: () => void;
	} = $props();

	const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
	const domains = [
		{ id: 'health', label: 'Healthcare' },
		{ id: 'education', label: 'Education' },
		{ id: 'transport', label: 'Transport' }
	];
	const assessment = $derived(accessibility?.assessment);
	const score = $derived(
		typeof accessibility?.score === 'number' && Number.isFinite(accessibility.score)
			? accessibility.score
			: null
	);
	const primaryReason = $derived(
		assessment?.reasons
			?.filter((reason) => Number.isFinite(reason.score) && reason.text)
			.reduce<NonNullable<typeof assessment>['reasons'][number] | null>(
				(lowest, reason) => (!lowest || reason.score < lowest.score ? reason : lowest),
				null
			)
	);
</script>

<section
	class="island-map-score"
	aria-label="Selected island accessibility"
	aria-busy={loading}
	data-testid="island-map-score"
>
	<div class="score-heading">
		<div>
			<p class="eyebrow">Island access index</p>
			<h2>{islandName}</h2>
		</div>
		<p class="score-number">
			<strong data-testid="island-map-score-value"
				>{score === null ? '—' : decimal.format(score)}</strong
			><span>/100</span>
		</p>
	</div>
	{#if score !== null}
		{#if assessment?.label}<p class="score-label">{assessment.label}</p>{/if}
		{#if primaryReason}
			<p class="reason-label">
				Lowest component · {domains.find((domain) => domain.id === primaryReason.domain)?.label ??
					primaryReason.domain}
			</p>
		{/if}
		<p class="score-summary" data-testid="island-map-score-summary">
			{primaryReason?.text ??
				assessment?.summary ??
				'An explanation for this score is unavailable.'}
		</p>
		{#if !primaryReason && loading}
			<p class="score-summary" role="status">Loading the detailed explanation…</p>
		{:else if !primaryReason && error}
			<p class="score-summary" role="alert">The detailed explanation couldn’t load.</p>
			<Button variant="outline" size="sm" onclick={onRetry}>Try again</Button>
		{/if}
		<details>
			<summary>Why this score <ChevronDown size={15} aria-hidden="true" /></summary>
			<div class="score-details" data-testid="island-map-score-reasons">
				{#if assessment?.summary}<p class="qualification">{assessment.summary}</p>{/if}
				{#if assessment?.reasons?.length}
					{#each domains as domain (domain.id)}
						{@const reason = assessment.reasons.find((item) => item.domain === domain.id)}
						{@const component = assessment.components?.[domain.id]?.score}
						<div class="domain-reason">
							<h3>
								{domain.label}
								{#if typeof component === 'number' && Number.isFinite(component)}<span
										>{decimal.format(component)}<small>/100</small></span
									>{/if}
							</h3>
							<p>{reason?.text ?? 'An explanation for this area is unavailable.'}</p>
						</div>
					{/each}
				{:else if loading}
					<p role="status">Loading the detailed explanation…</p>
				{:else if error}
					<p role="alert">The detailed explanation couldn’t load.</p>
					<Button variant="outline" size="sm" onclick={onRetry}>Try again</Button>
				{:else}
					<p>The detailed explanation is unavailable for this island.</p>
				{/if}
				{#if assessment?.coverage}
					<div class="evidence-note">
						<h3>{assessment.coverage.label}</h3>
						<p>{assessment.coverage.note}</p>
					</div>
				{/if}
				{#if assessment?.limitations?.length}
					<ul aria-label="Score limitations">
						{#each assessment.limitations as limitation (limitation)}<li>{limitation}</li>{/each}
					</ul>
				{/if}
				<p class="qualification">
					Higher means better modeled access. Missing evidence can lower the score without proving
					services are absent. This baseline index is separate from proposal results.
				</p>
			</div>
		</details>
		<p class="score-footnote">Planning index · not the percentage of residents served</p>
	{:else if loading}
		<p class="score-summary" role="status">Loading this island’s score and explanation…</p>
	{:else if error}
		<p class="score-summary" role="alert">This island’s score couldn’t load.</p>
		<Button variant="outline" size="sm" onclick={onRetry}>Try again</Button>
	{:else}
		<p class="score-summary">An accessibility score is unavailable for this island.</p>
	{/if}
</section>

<style>
	.island-map-score {
		flex-basis: 100%;
		width: 330px;
		max-width: 100%;
		max-height: calc(100dvh - 290px);
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 16px;
		border: 1px solid #dce5df;
		border-radius: 16px;
		background: #fffffff5;
		color: #26392f;
		box-shadow: 0 4px 22px #1a433f12;
		pointer-events: auto;
	}
	.score-heading {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 14px;
	}
	.eyebrow {
		font-size: 9px;
		font-weight: 650;
		letter-spacing: 1.4px;
		text-transform: uppercase;
		color: #617267;
	}
	h2 {
		margin-top: 4px;
		font-size: 18px;
		font-weight: 600;
		line-height: 1.3;
		letter-spacing: -0.4px;
		overflow-wrap: anywhere;
	}
	.score-number {
		flex-shrink: 0;
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}
	.score-number strong {
		font-size: 34px;
		font-weight: 500;
		line-height: 1;
		letter-spacing: -1.5px;
	}
	.score-number > span {
		margin-left: 3px;
		font-size: 11px;
		color: #6a786f;
	}
	.score-label {
		margin-top: 12px;
		font-size: 11px;
		font-weight: 650;
		color: #365c48;
	}
	.reason-label {
		margin-top: 9px;
		font-size: 10px;
		font-weight: 550;
		color: #617267;
	}
	.score-summary,
	.score-details {
		font-size: 12px;
		line-height: 1.6;
		color: #57695e;
	}
	.score-summary {
		margin-top: 5px;
	}
	summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 38px;
		margin-top: 6px;
		list-style: none;
		cursor: pointer;
		font-size: 11px;
		font-weight: 650;
		color: #276046;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	summary:focus-visible {
		outline: 2px solid #087e77;
		outline-offset: 3px;
		border-radius: 4px;
	}
	details[open] summary :global(svg) {
		transform: rotate(180deg);
	}
	.score-details {
		border-top: 1px solid #e3e9e5;
	}
	.domain-reason,
	.evidence-note {
		padding-top: 12px;
	}
	h3 {
		display: flex;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 4px;
		font-size: 11px;
		font-weight: 650;
		color: #365344;
	}
	h3 span {
		font-variant-numeric: tabular-nums;
	}
	h3 small {
		margin-left: 2px;
		font-weight: 400;
		color: #6a786f;
	}
	ul {
		margin: 12px 0;
		padding-left: 16px;
		list-style: disc;
	}
	li + li {
		margin-top: 5px;
	}
	.qualification {
		margin-top: 12px;
	}
	.score-footnote {
		font-size: 9px;
		line-height: 1.5;
		color: #6a786f;
	}
	@media (max-width: 700px) {
		.island-map-score {
			max-height: min(40dvh, max(150px, calc(100dvh - 450px)));
			padding: 12px 14px;
		}
		summary {
			min-height: 44px;
		}
	}
</style>
