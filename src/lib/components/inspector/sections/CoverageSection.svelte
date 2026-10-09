<script lang="ts">
	import type { CoverageMetrics } from '#lib/types/analysis.ts';
	import { formatDistance, formatPopulation } from '#lib/utils/format.ts';
	import InspectorSection from '../InspectorSection.svelte';

	let { coverage }: { coverage: CoverageMetrics } = $props();

	const max = $derived(Math.max(1, ...coverage.bands.map((b) => b.population)));
</script>

<InspectorSection
	title="Coverage · walking"
	provenance={coverage.provenance}
	provenanceNote={coverage.basis}
>
	<ul class="flex flex-col gap-1.5">
		{#each coverage.bands as band (band.minutes)}
			<li class="grid grid-cols-[2.75rem_1fr_4.5rem] items-center gap-2 text-[11px]">
				<span class="text-hud-muted" title="≈{formatDistance(band.radiusM)} straight-line">
					{band.minutes} min
				</span>
				<span class="h-1.5 overflow-hidden rounded-full bg-hud-line" aria-hidden="true">
					<span
						class="block h-full rounded-full bg-hud-accent/70"
						style:width="{(band.population / max) * 100}%"
					></span>
				</span>
				<span class="text-right font-mono font-medium tabular-nums">
					{formatPopulation(band.population)}
				</span>
			</li>
		{/each}
	</ul>
	<p class="text-[10px] leading-relaxed text-hud-faint">{coverage.basis}</p>
</InspectorSection>
