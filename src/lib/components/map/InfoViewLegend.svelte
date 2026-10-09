<!-- Legend for the active info view: same stops as the map ramp, positioned by value. -->
<script lang="ts">
	import type { GridInfoView } from '#lib/config/infoViews.ts';
	import { ACCESSIBILITY_DISCLAIMER } from '#lib/config/scoring.ts';
	import type { H3Grid } from '#lib/types/h3.ts';
	import { formatCompact, formatPopulation } from '#lib/utils/format.ts';
	import DemoTag from '#lib/components/inspector/DemoTag.svelte';
	import CriticalityRanking from '#lib/components/criticality/CriticalityRanking.svelte';
	import type { CriticalityResult } from '#lib/types/criticality.ts';
	import type { InfrastructureId } from '#lib/types/domain.ts';

	let {
		view,
		grid,
		criticality = null,
		onselectfacility
	}: {
		view: GridInfoView;
		grid: H3Grid;
		/** Supplied for the closure-exposure view only. */
		criticality?: CriticalityResult | null;
		onselectfacility?: (id: InfrastructureId) => void;
	} = $props();

	const stops = $derived(view.scale.stops);
	const min = $derived(stops[0][0]);
	const max = $derived(stops[stops.length - 1][0]);
	const pct = (v: number) => ((v - min) / (max - min)) * 100;
	const gradient = $derived(
		`linear-gradient(to right, ${stops.map(([v, c]) => `${c} ${pct(v)}%`).join(', ')})`
	);
	const directionHint = $derived(
		view.higherIs === 'better'
			? 'worse ← → better'
			: view.higherIs === 'worse'
				? 'fewer ← → more'
				: 'lower ← → higher'
	);
</script>

<section class="w-60 hud-panel p-2.5" aria-label="{view.label} legend">
	<div class="flex items-center gap-1.5">
		<h3 class="text-xs font-semibold">{view.label}</h3>
		<DemoTag title="Demo demographics and straight-line access model" />
	</div>
	<p class="mt-0.5 text-[10px] leading-snug text-hud-faint">{view.description}</p>
	{#if view.id !== 'populationDensity'}
		<p class="mt-1 text-[10px] leading-snug text-hud-warn/90">{ACCESSIBILITY_DISCLAIMER}</p>
	{/if}

	<div class="mt-2 h-2.5 rounded-sm" style:background={gradient} aria-hidden="true"></div>
	<div class="relative mt-0.5 h-3 font-mono text-[9px] text-hud-muted tabular-nums">
		{#each stops as [value], i (value)}
			<span
				class="absolute {i === 0
					? ''
					: i === stops.length - 1
						? '-translate-x-full'
						: '-translate-x-1/2'}"
				style:left="{pct(value)}%"
			>
				{formatCompact(value)}{i === stops.length - 1 ? '+' : ''}
			</span>
		{/each}
	</div>
	<div class="mt-1 flex justify-between text-[10px] text-hud-faint">
		<span>{view.unit}</span>
		<span>{directionHint}</span>
	</div>

	{#if view.id === 'underservedPopulation'}
		<p class="mt-1.5 border-t border-hud-line pt-1.5 text-[10px] text-hud-muted">
			Study-area total: <span class="font-mono text-hud-text tabular-nums"
				>{formatPopulation(grid.totals.underservedPopulation)}</span
			>
			of {formatPopulation(grid.totals.population)} residents
		</p>
	{/if}
	{#if criticality && onselectfacility}
		<CriticalityRanking result={criticality} onselect={onselectfacility} />
	{/if}
</section>
