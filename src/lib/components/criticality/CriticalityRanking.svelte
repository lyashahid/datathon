<!-- Most critical facilities under the current scenario, for the exposure view's legend. -->
<script lang="ts">
	import { CRITICALITY_BANDS } from '#lib/config/criticality.ts';
	import type { CriticalityResult } from '#lib/types/criticality.ts';
	import type { InfrastructureId } from '#lib/types/domain.ts';
	import { formatPopulation } from '#lib/utils/format.ts';

	let {
		result,
		limit = 5,
		onselect
	}: {
		result: CriticalityResult;
		limit?: number;
		onselect: (id: InfrastructureId) => void;
	} = $props();

	const color = (band: string) => CRITICALITY_BANDS.find((b) => b.band === band)?.color;
</script>

<div class="mt-1.5 border-t border-hud-line pt-1.5">
	<h4 class="text-[10px] font-medium text-hud-muted">Most critical facilities</h4>
	<ol class="mt-1 flex flex-col">
		{#each result.facilities.slice(0, limit) as f (f.featureId)}
			<li>
				<button
					type="button"
					class="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] hover:bg-hud-hover"
					onclick={() => onselect(f.featureId)}
				>
					<span class="w-3 font-mono text-[10px] text-hud-faint">{f.rank}</span>
					<span class="size-2 shrink-0 rounded-full" style:background-color={color(f.band)}></span>
					<span class="min-w-0 flex-1 truncate">{f.name}</span>
					<span class="font-mono text-[10px] text-hud-muted tabular-nums"
						>{formatPopulation(f.residentsAffected)}</span
					>
				</button>
			</li>
		{/each}
	</ol>
	<p class="mt-0.5 text-[10px] text-hud-faint">Residents losing access if each closed alone.</p>
</div>
