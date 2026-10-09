<!-- One potential intervention: type, relevance, reasons and the metrics that triggered it. -->
<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { RELEVANCE_BANDS } from '#lib/config/interventions.ts';
	import type { InterventionSuggestion } from '#lib/types/interventions.ts';

	let {
		suggestion,
		rank,
		actions
	}: {
		suggestion: InterventionSuggestion;
		rank: number;
		actions?: Snippet<[InterventionSuggestion]>;
	} = $props();

	let showTriggers = $state(false);
	const bandLabel = $derived(RELEVANCE_BANDS.find((b) => b.band === suggestion.band)!.label);
	const bandClass = $derived(
		{
			high: 'text-hud-warn bg-hud-warn/10',
			medium: 'text-hud-text bg-hud-hover',
			low: 'text-hud-muted bg-hud-hover'
		}[suggestion.band]
	);
</script>

<article class="rounded border border-hud-line p-2.5">
	<header class="flex items-start gap-2">
		<span class="mt-px font-mono text-[10px] text-hud-faint">{rank}</span>
		<div class="min-w-0 flex-1">
			<p class="text-[10px] text-hud-faint">Potential intervention</p>
			<h4 class="text-xs font-semibold">{suggestion.title}</h4>
		</div>
		<span
			class="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium {bandClass}"
			title={suggestion.relevanceBasis}
		>
			{bandLabel} · {suggestion.relevance}
		</span>
	</header>
	<ul class="mt-2 flex list-disc flex-col gap-0.5 pl-6 text-[11px] leading-snug">
		{#each suggestion.reasons as reason (reason)}
			<li>{reason}</li>
		{/each}
	</ul>
	<button
		type="button"
		class="mt-1.5 flex items-center gap-1 text-[10px] text-hud-muted hover:text-hud-text"
		aria-expanded={showTriggers}
		onclick={() => (showTriggers = !showTriggers)}
	>
		<ChevronDown class="size-3 transition-transform {showTriggers ? 'rotate-180' : ''}" />
		Triggered by
	</button>
	{#if showTriggers}
		<dl class="mt-1 grid grid-cols-[1fr_auto_auto] gap-x-2 gap-y-0.5 text-[10px] tabular-nums">
			{#each suggestion.triggers as t (t.metric)}
				<dt class="text-hud-muted">{t.metric}</dt>
				<dd class="text-right font-mono">{t.value}</dd>
				<dd class="text-right text-hud-faint">{t.condition}</dd>
			{/each}
		</dl>
		<p class="mt-1 text-[10px] leading-snug text-hud-faint">
			Relevance: {suggestion.relevanceBasis}
		</p>
	{/if}
	{#if actions}
		<div class="mt-2">{@render actions(suggestion)}</div>
	{/if}
</article>
