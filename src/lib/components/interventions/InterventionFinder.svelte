<!-- "Find Improvements" for one analytical cell: ranked, rule-based intervention suggestions. -->
<script lang="ts">
	import { Lightbulb } from '@lucide/svelte';
	import type { Snippet } from 'svelte';
	import { suggestInterventions } from '#lib/analysis/interventions.ts';
	import type { H3Cell } from '#lib/types/h3.ts';
	import type { InterventionSuggestion } from '#lib/types/interventions.ts';
	import InterventionCard from './InterventionCard.svelte';

	let { cell, cardActions }: { cell: H3Cell; cardActions?: Snippet<[InterventionSuggestion]> } =
		$props();

	let open = $state(false);
	const suggestions = $derived(open ? suggestInterventions(cell) : []);
</script>

{#if !open}
	<button
		type="button"
		class="flex items-center justify-center gap-1.5 rounded border border-hud-line py-1.5 text-[11px] font-medium hover:border-hud-accent/50 hover:bg-hud-accent-dim hover:text-hud-accent"
		data-demo="find-improvements"
		onclick={() => (open = true)}
	>
		<Lightbulb class="size-3.5" /> Find Improvements
	</button>
{:else}
	<section class="flex flex-col gap-2" aria-label="Potential interventions">
		<div>
			<h3 class="hud-label">Suggested for evaluation</h3>
			<p class="mt-0.5 text-[10px] leading-snug text-hud-faint">
				Rule-based prompts from this cell's metrics. They identify gaps worth investigating, not
				decisions.
			</p>
		</div>
		{#if suggestions.length === 0}
			<p class="rounded border border-dashed border-hud-line p-2 text-[11px] text-hud-muted">
				No accessibility gaps crossed the rule thresholds for this cell.
			</p>
		{:else}
			{#each suggestions as s, i (s.type)}
				<InterventionCard suggestion={s} rank={i + 1} actions={cardActions} />
			{/each}
		{/if}
	</section>
{/if}
