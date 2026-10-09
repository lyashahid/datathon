<!-- How much accessibility depends on one facility: the single-closure test result. -->
<script lang="ts">
	import { CRITICALITY_BANDS, CRITICALITY_LABELS } from '#lib/config/criticality.ts';
	import type { FacilityCriticality } from '#lib/types/criticality.ts';
	import { formatPopulation } from '#lib/utils/format.ts';
	import DemoTag from '#lib/components/inspector/DemoTag.svelte';

	let {
		criticality,
		assessedCount,
		onshowmap
	}: {
		criticality: FacilityCriticality;
		assessedCount: number;
		onshowmap?: () => void;
	} = $props();

	const band = $derived(CRITICALITY_BANDS.find((b) => b.band === criticality.band)!);
</script>

<section class="flex flex-col gap-2">
	<div class="flex items-center gap-1.5">
		<h3 class="hud-label">Criticality</h3>
		<DemoTag title="Demo demographics; straight-line proximity model" />
	</div>
	<div class="flex items-center gap-2 rounded border border-hud-line p-2">
		<span
			class="rounded-sm px-1.5 py-0.5 text-[11px] font-semibold"
			style:background-color="{band.color}26"
			style:color={band.color}>{band.label}</span
		>
		<span class="text-[11px] text-hud-muted">
			Rank {criticality.rank} of {assessedCount} assessed facilities
		</span>
	</div>
	<dl class="grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 text-[11px] tabular-nums">
		<dt class="text-hud-muted">Residents losing access if closed</dt>
		<dd class="text-right font-mono">{formatPopulation(criticality.residentsAffected)}</dd>
		<dt class="text-hud-muted">Average loss, whole study area</dt>
		<dd class="text-right font-mono">{criticality.averagePointsLost.toFixed(2)} pts</dd>
		<dt class="text-hud-muted">Largest local drop</dt>
		<dd class="text-right font-mono">{Math.round(criticality.maxCellDrop)} pts</dd>
	</dl>
	<ul class="list-disc pl-4 text-[11px] leading-snug text-hud-text">
		{#each criticality.explanation as line (line)}<li>{line}</li>{/each}
	</ul>
	<p class="text-[10px] leading-relaxed text-hud-faint">
		{CRITICALITY_LABELS.method}
		{CRITICALITY_LABELS.notResilience}
	</p>
	{#if onshowmap}
		<button
			type="button"
			class="self-start text-[11px] text-hud-accent hover:underline"
			onclick={onshowmap}>Show closure exposure on map</button
		>
	{/if}
</section>
