<!-- Compact metrics for the cell under the cursor while an info view is active. -->
<script lang="ts">
	import { infoViewValue, type GridInfoView } from '#lib/config/infoViews.ts';
	import type { CellValueSource, H3Cell } from '#lib/types/h3.ts';
	import { colorAt } from '#lib/utils/color.ts';
	import { formatCompact, formatPopulation } from '#lib/utils/format.ts';
	import FloatingCard from './FloatingCard.svelte';

	let {
		cell,
		external,
		view,
		point,
		container
	}: {
		cell: H3Cell;
		external: CellValueSource | null;
		view: GridInfoView;
		point: { x: number; y: number };
		container: { width: number; height: number };
	} = $props();

	const value = $derived(infoViewValue(view, cell, external));
	const color = $derived(colorAt(view.scale, value));
	const display = $derived(
		view.unit === 'points'
			? `${value > 0 ? '+' : ''}${Math.round(value)}`
			: view.unit === 'score'
				? `${Math.round(value)}`
				: formatCompact(Math.round(value))
	);
</script>

<FloatingCard {point} {container} accent={color} width={176} heightEstimate={110}>
	<div class="flex items-baseline gap-1.5">
		<span class="size-2.5 shrink-0 rounded-sm" style:background-color={color}></span>
		<span class="font-mono text-sm font-semibold tabular-nums">{display}</span>
		<span class="truncate text-[10px] text-hud-faint">
			{view.unit}{view.unit === 'score' ? ' (approx.)' : ''}
		</span>
	</div>
	<dl class="mt-1.5 grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 text-[10px] tabular-nums">
		<dt class="text-hud-muted">Residents</dt>
		<dd class="text-right font-mono">{formatPopulation(cell.population)}</dd>
		<dt class="text-hud-muted">Overall access</dt>
		<dd class="text-right font-mono">{cell.overallAccessibility}</dd>
		<dt class="text-hud-muted">Island</dt>
		<dd class="text-right">{cell.island}</dd>
	</dl>
	<p class="mt-1.5 text-[10px] text-hud-faint">Click for details</p>
</FloatingCard>
