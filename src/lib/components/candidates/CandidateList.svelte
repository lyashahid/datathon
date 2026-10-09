<!-- Ranked bus-stop candidates for the active search. -->
<script lang="ts">
	import { X } from '@lucide/svelte';
	import { BUS_STOP_SCORING, CANDIDATE_LABELS } from '#lib/config/busStopScoring.ts';
	import { getCandidateSearch } from '#lib/stores/candidates.svelte.ts';
	import { getUiState } from '#lib/stores/ui.svelte.ts';
	import { formatDistance, formatPopulation } from '#lib/utils/format.ts';
	import DemoTag from '#lib/components/inspector/DemoTag.svelte';
	import PriorityPanel from './PriorityPanel.svelte';

	const search = getCandidateSearch();
	const ui = getUiState();
	const result = $derived(search.result);
</script>

{#if result}
	<div class="flex flex-col gap-3 p-3">
		<header class="flex items-start gap-2">
			<div class="min-w-0 flex-1">
				<div class="flex items-center gap-1.5">
					<span class="hud-label">Bus-stop candidates</span>
					<DemoTag title="Demo demographics; straight-line proximity model" />
				</div>
				<h2 class="mt-1 text-sm font-semibold">{result.area.island}</h2>
				<p class="mt-0.5 text-[11px] text-hud-muted">
					Within {formatDistance(result.area.radiusM)} of the selected cell ·
					{formatPopulation(result.area.population)} residents
				</p>
			</div>
			<button
				type="button"
				class="grid size-7 place-items-center rounded text-hud-muted hover:bg-hud-hover hover:text-hud-text"
				onclick={() => {
					search.close();
					ui.select(null);
				}}
				aria-label="Close candidate search"
				title="Close candidate search"
			>
				<X class="size-4" />
			</button>
		</header>

		<p class="rounded border border-hud-line px-2 py-1.5 text-[10px] leading-snug text-hud-muted">
			Recommendations depend on the selected priorities. {CANDIDATE_LABELS.disclaimer}
		</p>

		<PriorityPanel />

		{#if result.candidates.length === 0}
			<p class="rounded border border-dashed border-hud-line p-2 text-[11px] text-hud-muted">
				No valid candidate positions in this area.
			</p>
		{:else}
			<ol class="flex flex-col gap-1.5">
				{#each result.candidates as c (c.id)}
					<li>
						<button
							type="button"
							class="flex w-full items-center gap-2.5 rounded border border-hud-line p-2 text-left hover:border-hud-accent/50 hover:bg-hud-hover"
							onclick={() => ui.select({ kind: 'candidate', id: c.id })}
						>
							<span
								class="grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-hud-base {c.rank ===
								1
									? 'bg-amber-400'
									: 'bg-slate-200'}"
							>
								{c.rank}
							</span>
							<span class="min-w-0 flex-1">
								<span class="block text-[10px] text-hud-faint">
									{c.rank === 1 ? CANDIDATE_LABELS.top : CANDIDATE_LABELS.ranked(c.rank)}
								</span>
								<span class="block text-[11px] text-hud-muted tabular-nums">
									Serves {formatPopulation(c.expectedPopulationServed)} · transport
									{c.estimatedAccessibilityGain >= 0
										? '+'
										: ''}{c.estimatedAccessibilityGain.toFixed(1)}
								</span>
							</span>
							<span class="font-mono text-base font-semibold tabular-nums">{c.score}</span>
						</button>
					</li>
				{/each}
			</ol>
		{/if}

		<p class="text-[10px] leading-relaxed text-hud-faint">
			{result.evaluated} candidate positions (analytical cell centres) evaluated, {result.rejected}
			rejected{#if result.rejected > 0}
				({Object.entries(result.rejectionReasons)
					.map(([r, n]) => `${n} ${r.toLowerCase()}`)
					.join('; ')}){/if}. Ranked candidates are kept at least {BUS_STOP_SCORING.minSeparationM} m
			apart. Catchment {BUS_STOP_SCORING.catchmentRadiusM} m straight line.
		</p>
	</div>
{/if}
