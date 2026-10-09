<!-- Floating card while moving a facility: distance, score before → after, warnings. -->
<script lang="ts">
	import { ArrowRight } from '@lucide/svelte';
	import { SCORE_CATEGORIES } from '#lib/config/analysis.ts';
	import { PLACEMENT_COLORS } from '#lib/config/placement.ts';
	import type { MoveEvaluation } from '#lib/simulator/move.ts';
	import type { PointerHover } from '#lib/simulator/placement.ts';
	import { formatDistance } from '#lib/utils/format.ts';
	import DemoTag from '#lib/components/inspector/DemoTag.svelte';
	import FloatingCard from './FloatingCard.svelte';
	import IssueList from './IssueList.svelte';
	import VerdictHeader from './VerdictHeader.svelte';

	let { hover, name }: { hover: PointerHover<MoveEvaluation>; name: string } = $props();

	const evaluation = $derived(hover.evaluation);
	const before = $derived(evaluation.scoreBefore.score);
	const after = $derived(evaluation.scoreAfter?.score ?? null);
	const delta = $derived(after === null ? null : after - before);
	const colorOf = (category: string) =>
		SCORE_CATEGORIES.find((c) => c.category === category)?.color;
</script>

<FloatingCard
	point={hover.point}
	container={hover.container}
	accent={PLACEMENT_COLORS[evaluation.validity]}
	heightEstimate={170}
>
	<VerdictHeader validity={evaluation.validity} subtitle="Move {name}" />

	<div class="mt-2 flex items-center gap-1.5">
		<span class="hud-label">If moved here</span>
		<DemoTag title="Demo estimate: uniform island density, straight-line walking" />
	</div>
	<dl class="mt-1 grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 tabular-nums">
		<dt class="text-hud-muted">Distance moved</dt>
		<dd class="text-right font-mono font-medium">{formatDistance(evaluation.distanceM)}</dd>
		<dt class="text-hud-muted">Accessibility</dt>
		<dd class="flex items-center justify-end gap-1 font-mono font-medium">
			<span style:color={colorOf(evaluation.scoreBefore.category)}>{before}</span>
			<ArrowRight class="size-3 text-hud-faint" />
			{#if after !== null && evaluation.scoreAfter}
				<span style:color={colorOf(evaluation.scoreAfter.category)}>{after}</span>
				<span
					class="ml-1 text-[10px] {delta! > 0
						? 'text-emerald-400'
						: delta! < 0
							? 'text-hud-warn'
							: 'text-hud-faint'}"
				>
					({delta! > 0 ? '+' : ''}{delta})
				</span>
			{:else}
				<span class="text-hud-faint">—</span>
			{/if}
		</dd>
	</dl>

	<IssueList issues={evaluation.issues} />

	<p class="mt-2 text-[10px] text-hud-faint">
		{evaluation.validity === 'invalid' ? 'Choose a valid spot' : 'Click to confirm'} · Esc to cancel
	</p>
</FloatingCard>
