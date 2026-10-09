<!-- Before-versus-after summary for a scenario (or a facility's neighbourhood). -->
<script lang="ts">
	import { Map as MapIcon } from '@lucide/svelte';
	import { ACCESSIBILITY_DISCLAIMER } from '#lib/config/scoring.ts';
	import type { ImpactSummary, PopulationSplit } from '#lib/types/impact.ts';
	import { formatPopulation } from '#lib/utils/format.ts';
	import DemoTag from '#lib/components/inspector/DemoTag.svelte';
	import MetricChangeRow from './MetricChangeRow.svelte';

	let {
		summary,
		title,
		subtitle,
		compact = false,
		onshowmap
	}: {
		summary: ImpactSummary;
		title: string;
		subtitle?: string;
		/** Local-impact variant: fewer rows, no map button. */
		compact?: boolean;
		onshowmap?: () => void;
	} = $props();

	const score = (v: number) => v.toFixed(1);
	const people = (v: number) => formatPopulation(v).replace('≈', '');
	const groups = (s: PopulationSplit) => [
		{ label: 'Children', value: s.children },
		{ label: 'Working age', value: s.workingAge },
		{ label: 'Older (65+)', value: s.olderPopulation }
	];
	const anyChange = $derived(summary.cellsImproved + summary.cellsWorsened > 0);
</script>

<section class="flex flex-col gap-3">
	<header>
		<div class="flex items-center gap-1.5">
			<h3 class="hud-label">{title}</h3>
			<DemoTag title="Demo demographics; straight-line proximity model" />
		</div>
		{#if subtitle}<p class="mt-0.5 text-[11px] text-hud-muted">{subtitle}</p>{/if}
	</header>

	<div class="grid grid-cols-2 gap-2">
		<div class="rounded border border-hud-line p-2">
			<p class="text-[10px] text-hud-muted">Benefiting</p>
			<p class="font-mono text-base font-semibold text-emerald-400 tabular-nums">
				{people(summary.benefiting.total)}
			</p>
			<p class="text-[10px] text-hud-faint">people</p>
		</div>
		<div class="rounded border border-hud-line p-2">
			<p class="text-[10px] text-hud-muted">Losing accessibility</p>
			<p
				class="font-mono text-base font-semibold tabular-nums {summary.losing.total > 0
					? 'text-hud-warn'
					: 'text-hud-faint'}"
			>
				{people(summary.losing.total)}
			</p>
			<p class="text-[10px] text-hud-faint">people</p>
		</div>
	</div>

	<div class="flex flex-col gap-2">
		<MetricChangeRow label="Transport accessibility" change={summary.transport} format={score} />
		{#if !compact}
			<MetricChangeRow label="Health accessibility" change={summary.health} format={score} />
			<MetricChangeRow label="Education accessibility" change={summary.education} format={score} />
		{/if}
		<MetricChangeRow
			label="Underserved population"
			change={summary.underservedPopulation}
			format={people}
			higherIsBetter={false}
			epsilon={0.5}
		/>
	</div>

	{#if anyChange && !compact}
		<div>
			<h4 class="mb-1 text-[10px] font-medium text-hud-muted">Who is affected</h4>
			<table class="w-full text-[11px] tabular-nums">
				<thead>
					<tr class="text-[10px] text-hud-faint">
						<th class="text-left font-normal"></th>
						<th class="text-right font-normal">Benefiting</th>
						<th class="text-right font-normal">Losing</th>
					</tr>
				</thead>
				<tbody>
					{#each groups(summary.benefiting) as g, i (g.label)}
						<tr>
							<td class="text-hud-muted">{g.label}</td>
							<td class="text-right font-mono text-emerald-400">{people(g.value)}</td>
							<td class="text-right font-mono text-hud-warn">
								{people(groups(summary.losing)[i].value)}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	<p class="text-[10px] leading-relaxed text-hud-faint">
		Scores are population-weighted averages. A neighbourhood counts as benefiting or losing when its
		overall score moves by at least {summary.thresholdPoints} points. {ACCESSIBILITY_DISCLAIMER}
	</p>

	{#if onshowmap && !compact}
		<button
			type="button"
			class="flex items-center justify-center gap-1.5 rounded border border-hud-line py-1.5 text-[11px] font-medium hover:border-hud-accent/50 hover:bg-hud-accent-dim hover:text-hud-accent"
			onclick={onshowmap}
		>
			<MapIcon class="size-3.5" /> Show change on map
		</button>
	{/if}
</section>
