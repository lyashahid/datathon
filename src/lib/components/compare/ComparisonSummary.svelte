<!-- Headline baseline-vs-scenario metrics shown above the swipe map. -->
<script lang="ts">
	import { X } from '@lucide/svelte';
	import type { ImpactSummary } from '#lib/types/impact.ts';
	import { formatPopulation } from '#lib/utils/format.ts';
	import MetricChangeRow from '#lib/components/impact/MetricChangeRow.svelte';

	let {
		summary,
		scenarioName,
		conditionsLabel,
		onclose
	}: {
		summary: ImpactSummary;
		scenarioName: string;
		/** Set when both sides are computed under a planning disruption. */
		conditionsLabel: string | null;
		onclose: () => void;
	} = $props();

	const score = (v: number) => v.toFixed(1);
	const people = (v: number) => formatPopulation(v).replace('≈', '');
</script>

<section class="flex flex-col gap-3" aria-label="Scenario comparison">
	<header class="flex items-start gap-2">
		<div class="min-w-0 flex-1">
			<p class="hud-label">Compare</p>
			<h2 class="mt-0.5 text-sm font-semibold">
				<span class="text-hud-muted">Baseline</span>
				<span class="mx-0.5 text-hud-faint">vs</span>
				<span class="text-hud-accent">{scenarioName}</span>
			</h2>
			<p class="text-[10px] text-hud-faint">Left of the divider: baseline · right: scenario</p>
			{#if conditionsLabel}
				<p class="text-[10px] text-hud-warn">Both sides under {conditionsLabel}</p>
			{/if}
		</div>
		<button
			type="button"
			class="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-hud-muted hover:bg-hud-hover hover:text-hud-text"
			onclick={onclose}
			title="Exit compare (Esc)"
		>
			<X class="size-3.5" /> Exit
		</button>
	</header>
	<div class="grid grid-cols-2 gap-x-4 gap-y-2.5">
		<MetricChangeRow label="Transport access" change={summary.transport} format={score} />
		<MetricChangeRow label="Health access" change={summary.health} format={score} />
		<MetricChangeRow label="Education access" change={summary.education} format={score} />
		<MetricChangeRow
			label="Underserved residents"
			change={summary.underservedPopulation}
			format={people}
			higherIsBetter={false}
			epsilon={0.5}
		/>
		<div class="text-[11px]">
			<p class="text-hud-muted">Benefiting</p>
			<p
				class="font-mono tabular-nums {summary.benefiting.total > 0
					? 'text-emerald-400'
					: 'text-hud-faint'}"
			>
				{summary.benefiting.total > 0 ? '+' : ''}{people(summary.benefiting.total)}
				<span class="text-[10px] text-hud-faint">people</span>
			</p>
		</div>
		<div class="text-[11px]">
			<p class="text-hud-muted">Negatively affected</p>
			<p
				class="font-mono tabular-nums {summary.losing.total > 0
					? 'text-hud-warn'
					: 'text-hud-faint'}"
			>
				{summary.losing.total > 0 ? '−' : ''}{people(summary.losing.total)}
				<span class="text-[10px] text-hud-faint">people</span>
			</p>
		</div>
	</div>
	<p class="text-[10px] leading-relaxed text-hud-faint">
		Population-weighted averages; a change counts at ±{summary.thresholdPoints} points. Neither side is
		modified by comparing.
	</p>
</section>
