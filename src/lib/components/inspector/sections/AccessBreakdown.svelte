<!-- "Why this score?" for location accessibility: every component, threshold and weight. -->
<script lang="ts">
	import { Ship } from '@lucide/svelte';
	import {
		ACCESS_CATEGORY_LABELS,
		ACCESSIBILITY_DISCLAIMER,
		SEA_CROSSING_EQUIVALENT_M
	} from '#lib/config/scoring.ts';
	import { getScenarioStore } from '#lib/stores/scenario.svelte.ts';
	import { getUiState } from '#lib/stores/ui.svelte.ts';
	import type { LocationAccess } from '#lib/types/analysis.ts';
	import { formatDistance } from '#lib/utils/format.ts';

	let { access }: { access: LocationAccess } = $props();

	const ui = getUiState();
	const scenarios = getScenarioStore();
	const nameOf = (id: string | null) =>
		id ? (scenarios.effective.getInfrastructure(id)?.name ?? id) : null;
	const fixed = (n: number) => n.toFixed(1);
	const overallRaw = $derived(access.overall.components.reduce((s, c) => s + c.contribution, 0));
</script>

<div class="flex flex-col gap-3 rounded border border-hud-line bg-hud-base/50 p-2.5 text-[11px]">
	{#each access.overall.components as overall (overall.category)}
		{@const category = access[overall.category]}
		<section>
			<div class="flex items-baseline gap-2 font-medium">
				<span class="flex-1">{ACCESS_CATEGORY_LABELS[overall.category]}</span>
				<span class="font-mono text-hud-muted tabular-nums"
					>{category.score} × {overall.weight}</span
				>
				<span class="w-10 text-right font-mono tabular-nums">+{fixed(overall.contribution)}</span>
			</div>
			<ul class="mt-1 flex flex-col gap-1 border-l border-hud-line pl-2">
				{#each category.components as c (c.id)}
					{@const name = nameOf(c.nearestId)}
					<li class="text-[10px] leading-snug">
						<div class="flex items-baseline gap-1.5">
							<span class="text-hud-muted">{c.label}</span>
							{#if c.viaFerry}<Ship class="size-3 self-center text-hud-warn" />{/if}
							<span class="font-mono tabular-nums">
								{c.distanceM === null ? '—' : formatDistance(c.distanceM)}
							</span>
							<span class="ml-auto font-mono text-hud-muted tabular-nums">
								{Math.round(c.score)}{c.weight !== 1 ? ` × ${c.weight}` : ''}
							</span>
						</div>
						<div class="text-hud-faint">
							{#if name && c.nearestId}
								<button
									type="button"
									class="underline decoration-dotted hover:text-hud-text"
									onclick={() => ui.select({ kind: 'infrastructure', id: c.nearestId! })}
								>
									{name}
								</button>
								·
							{:else}
								None reachable ·
							{/if}
							100 ≤ {formatDistance(c.fullScoreWithinM)}, 0 ≥ {formatDistance(c.zeroScoreBeyondM)}
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{/each}

	<div class="border-t border-hud-line pt-2 font-mono text-[10px] text-hud-muted">
		{access.overall.components.map((c) => fixed(c.contribution)).join(' + ')} = {fixed(overallRaw)}
		→ <span class="text-hud-text">{access.overall.score}</span>
		<span class="text-hud-faint">(rounded)</span>
	</div>

	<p class="text-[10px] leading-relaxed text-hud-faint">
		{ACCESSIBILITY_DISCLAIMER} Category scores decay linearly between the thresholds shown. Other islands
		count via ferry terminals plus a {formatDistance(SEA_CROSSING_EQUIVALENT_M)} crossing allowance.
	</p>
</div>
