<!-- Floating card beside the cursor during placement: verdict, demo impact estimate, warnings. -->
<script lang="ts">
	import { SCORE_CATEGORIES } from '#lib/config/analysis.ts';
	import { INFRASTRUCTURE_TYPE_STYLES } from '#lib/config/infrastructure.ts';
	import { PLACEMENT_COLORS, PLACEMENT_RULES } from '#lib/config/placement.ts';
	import type { PlacementHover } from '#lib/simulator/placement.ts';
	import { formatPopulation } from '#lib/utils/format.ts';
	import DemoTag from '#lib/components/inspector/DemoTag.svelte';
	import FloatingCard from './FloatingCard.svelte';
	import IssueList from './IssueList.svelte';
	import VerdictHeader from './VerdictHeader.svelte';

	let { hover }: { hover: PlacementHover } = $props();

	const evaluation = $derived(hover.evaluation);
	const impact = $derived(evaluation.impact);
	const category = $derived(
		impact ? SCORE_CATEGORIES.find((c) => c.category === impact.score.category) : undefined
	);
	const walkSaving = $derived(impact ? impact.avgWalkBeforeMin - impact.avgWalkAfterMin : 0);
	const subtitle = $derived(
		`${INFRASTRUCTURE_TYPE_STYLES[evaluation.type].label}${evaluation.island ? ` · ${evaluation.island}` : ''}`
	);
</script>

<FloatingCard
	point={hover.point}
	container={hover.container}
	accent={PLACEMENT_COLORS[evaluation.validity]}
>
	<VerdictHeader validity={evaluation.validity} {subtitle} />

	{#if impact}
		<div class="mt-2 flex items-center gap-1.5">
			<span class="hud-label">Potential impact</span>
			<DemoTag title="Demo estimate: uniform island density, straight-line walking" />
		</div>
		<dl class="mt-1 grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 tabular-nums">
			<dt class="text-hud-muted">Residents newly covered</dt>
			<dd class="text-right font-mono font-medium text-emerald-400">
				+{formatPopulation(impact.newPopulation).replace('≈', '')}
			</dd>
			<dt class="text-hud-muted">Avg walk to a stop</dt>
			<dd class="text-right font-mono font-medium {walkSaving > 0.05 ? 'text-emerald-400' : ''}">
				{walkSaving > 0.05 ? `−${walkSaving.toFixed(1)}` : '±0.0'} min
			</dd>
			<dt class="text-hud-muted">Stop accessibility</dt>
			<dd class="text-right font-mono font-medium" style:color={category?.color}>
				+{impact.score.score} pts
			</dd>
		</dl>
		<p class="mt-1 text-[10px] text-hud-faint">
			Within a {PLACEMENT_RULES.catchmentMinutes}-min walk ({Math.round(impact.catchmentRadiusM)} m)
		</p>
	{/if}

	<IssueList issues={evaluation.issues} />

	<p class="mt-2 text-[10px] text-hud-faint">
		{evaluation.validity === 'invalid' ? 'Move to a valid spot' : 'Click to place'} · Esc to cancel
	</p>
</FloatingCard>
