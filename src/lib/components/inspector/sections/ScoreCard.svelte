<script lang="ts">
	import { ChevronDown } from '@lucide/svelte';
	import { SCORE_CATEGORIES } from '#lib/config/analysis.ts';
	import { ACCESSIBILITY_DISCLAIMER } from '#lib/config/scoring.ts';
	import type { AnalysisMethod, ScoreBreakdown } from '#lib/types/analysis.ts';
	import type { Provenance } from '#lib/types/domain.ts';
	import InspectorSection from '../InspectorSection.svelte';

	let {
		breakdown,
		method,
		provenance,
		expanded = $bindable(false)
	}: {
		breakdown: ScoreBreakdown;
		method: AnalysisMethod;
		provenance: Provenance;
		expanded?: boolean;
	} = $props();

	const category = $derived(
		SCORE_CATEGORIES.find((c) => c.category === breakdown.category) ?? SCORE_CATEGORIES[0]
	);
	const weightedSum = $derived(breakdown.components.reduce((s, c) => s + c.contribution, 0));
	const penaltySum = $derived(breakdown.penalties.reduce((s, p) => s + p.points, 0));
	const fixed = (n: number) => n.toFixed(1);
	const signed = (n: number) => (n > 0 ? `+${fixed(n)}` : fixed(n));
</script>

<InspectorSection title="Facility score" {provenance} provenanceNote={method.label}>
	<div class="flex items-end gap-3">
		<div class="flex items-baseline gap-1">
			<span class="font-mono text-3xl leading-none font-semibold tabular-nums">
				{breakdown.score}
			</span>
			<span class="text-[11px] text-hud-faint">/100</span>
		</div>
		<span
			class="mb-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold"
			style:color={category.color}
			style:background-color="color-mix(in srgb, {category.color} 14%, transparent)"
		>
			{category.label}
		</span>
	</div>
	<div class="h-1.5 overflow-hidden rounded-full bg-hud-line" aria-hidden="true">
		<div
			class="h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none"
			style:width="{breakdown.score}%"
			style:background-color={category.color}
		></div>
	</div>

	<p class="text-[10px] leading-snug text-hud-faint">{ACCESSIBILITY_DISCLAIMER}</p>

	<button
		type="button"
		class="flex items-center gap-1 self-start text-[11px] text-hud-muted hover:text-hud-text"
		aria-expanded={expanded}
		onclick={() => (expanded = !expanded)}
	>
		<ChevronDown class="size-3 transition-transform {expanded ? 'rotate-180' : ''}" />
		Why this score?
	</button>

	{#if expanded}
		<div class="flex flex-col gap-2.5 rounded border border-hud-line bg-hud-base/50 p-2.5">
			<ul class="flex flex-col gap-2">
				{#each breakdown.components as c (c.id)}
					<li>
						<div class="flex items-baseline gap-2 text-[11px]">
							<span class="flex-1 font-medium">{c.label}</span>
							<span class="font-mono text-hud-muted tabular-nums">
								{Math.round(c.score)} × {c.weight}
							</span>
							<span class="w-10 text-right font-mono font-medium tabular-nums">
								{signed(c.contribution)}
							</span>
						</div>
						<p class="mt-0.5 text-[10px] leading-relaxed text-hud-faint">{c.explanation}</p>
					</li>
				{/each}
				{#each breakdown.penalties as p (p.id)}
					<li>
						<div class="flex items-baseline gap-2 text-[11px]">
							<span class="flex-1 font-medium">{p.label}</span>
							<span class="w-10 text-right font-mono font-medium text-hud-warn tabular-nums">
								{signed(p.points)}
							</span>
						</div>
						<p class="mt-0.5 text-[10px] leading-relaxed text-hud-faint">{p.explanation}</p>
					</li>
				{/each}
			</ul>

			<div
				class="border-t border-hud-line pt-2 font-mono text-[10px] leading-relaxed text-hud-muted"
			>
				{fixed(weightedSum)} weighted
				{#if breakdown.penalties.length > 0}{signed(penaltySum)} penalties{/if}
				= {fixed(breakdown.rawTotal)} → <span class="text-hud-text">{breakdown.score}</span>
				<span class="text-hud-faint">(clamped 0–100, rounded)</span>
			</div>

			<div class="text-[10px] leading-relaxed text-hud-faint">
				<p><span class="text-hud-muted">{method.label}.</span> {method.description}</p>
				<p class="mt-1">
					{#each method.assumptions as a, i (a.label)}{i > 0 ? ' · ' : ''}{a.label}: {a.value}{a.unit
							? ` ${a.unit}`
							: ''}{/each}
				</p>
			</div>
		</div>
	{/if}
</InspectorSection>
