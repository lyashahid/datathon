<!-- What the selected disruption assumes, and what it does to accessibility versus normal. -->
<script lang="ts">
	import { DISRUPTION_LABELS } from '#lib/config/disruptionScenarios.ts';
	import type { DisruptionScenario } from '#lib/types/disruption.ts';
	import type { GridImpact } from '#lib/types/impact.ts';
	import ImpactPanel from '#lib/components/impact/ImpactPanel.svelte';

	let {
		disruption,
		impact,
		onshowmap
	}: { disruption: DisruptionScenario; impact: GridImpact; onshowmap: () => void } = $props();
</script>

<section class="flex flex-col gap-3">
	<header class="rounded border border-hud-warn/40 bg-hud-warn/5 p-2.5">
		<p class="hud-label text-hud-warn">{DISRUPTION_LABELS.kind}</p>
		<h2 class="mt-0.5 text-sm font-semibold">{disruption.label}</h2>
		<p class="mt-0.5 text-[11px] text-hud-muted">{disruption.summary}</p>
		<h3 class="mt-2 text-[10px] font-medium text-hud-muted">{DISRUPTION_LABELS.assumptions}</h3>
		<ul class="mt-0.5 list-disc pl-4 text-[11px] leading-snug text-hud-text">
			{#each disruption.assumptions as a (a)}<li>{a}</li>{/each}
		</ul>
		<p class="mt-1.5 text-[10px] text-hud-faint">
			Represents: {disruption.representativeConditions}. {DISRUPTION_LABELS.disclaimer}
		</p>
	</header>

	<ImpactPanel
		summary={impact.summary}
		title="Disruption impact"
		subtitle="Normal operations → {disruption.shortLabel.toLowerCase()} disruption"
		{onshowmap}
	/>
</section>
