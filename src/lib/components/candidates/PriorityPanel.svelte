<!-- Compact planning-priority sliders. Changes re-rank candidates immediately. -->
<script lang="ts">
	import { RotateCcw, SlidersHorizontal } from '@lucide/svelte';
	import { normalizeWeights, updateWeight } from '#lib/analysis/scoring/busStop.ts';
	import {
		BUS_STOP_CRITERIA,
		DEFAULT_BUS_STOP_WEIGHTS,
		type BusStopCriterion
	} from '#lib/config/busStopScoring.ts';
	import { getScenarioStore } from '#lib/stores/scenario.svelte.ts';

	const scenarios = getScenarioStore();
	let open = $state(false);

	const weights = $derived(scenarios.analysisSettings.busStopWeights ?? DEFAULT_BUS_STOP_WEIGHTS);
	const shares = $derived(normalizeWeights(weights));
	const isDefault = $derived(
		BUS_STOP_CRITERIA.every(
			({ id }) => Math.abs(shares[id] - normalizeWeights(DEFAULT_BUS_STOP_WEIGHTS)[id]) < 1e-9
		)
	);

	function set(id: BusStopCriterion, percent: number) {
		scenarios.setAnalysisSettings({ busStopWeights: updateWeight(weights, id, percent / 100) });
	}
</script>

<section class="rounded border border-hud-line" aria-label="Planning priorities">
	<button
		type="button"
		class="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[11px] font-medium hover:bg-hud-hover"
		aria-expanded={open}
		onclick={() => (open = !open)}
	>
		<SlidersHorizontal class="size-3.5 text-hud-muted" />
		<span class="flex-1">Planning priorities</span>
		<span class="text-[10px] text-hud-faint">{isDefault ? 'Default' : 'Custom'}</span>
	</button>
	{#if open}
		<div class="flex flex-col gap-2 border-t border-hud-line p-2">
			{#each BUS_STOP_CRITERIA as c (c.id)}
				<label class="block" title={c.hint}>
					<span class="flex items-baseline justify-between text-[10px]">
						<span class="text-hud-muted">{c.label}</span>
						<span class="font-mono text-hud-text tabular-nums"
							>{Math.round(shares[c.id] * 100)}%</span
						>
					</span>
					<input
						type="range"
						min="0"
						max="100"
						step="5"
						value={Math.round(weights[c.id] * 100)}
						oninput={(e) => set(c.id, Number(e.currentTarget.value))}
						class="mt-0.5 w-full accent-[var(--color-hud-accent)]"
						aria-label="{c.label} priority"
					/>
				</label>
			{/each}
			<div class="flex items-center justify-between gap-2">
				<p class="text-[10px] leading-snug text-hud-faint">
					Percentages are each priority's share of the score; they always total 100%.
				</p>
				<button
					type="button"
					class="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[10px] text-hud-muted hover:bg-hud-hover hover:text-hud-text disabled:opacity-40"
					disabled={isDefault}
					onclick={() =>
						scenarios.setAnalysisSettings({ busStopWeights: { ...DEFAULT_BUS_STOP_WEIGHTS } })}
				>
					<RotateCcw class="size-3" /> Reset to default
				</button>
			</div>
		</div>
	{/if}
</section>
