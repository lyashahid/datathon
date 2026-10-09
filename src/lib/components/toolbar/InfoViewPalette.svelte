<script lang="ts">
	import { EyeOff } from '@lucide/svelte';
	import { INFO_VIEWS, type InfoViewDefinition } from '#lib/config/infoViews.ts';
	import { getAnalysisGrid } from '#lib/stores/h3.svelte.ts';
	import { getUiState } from '#lib/stores/ui.svelte.ts';

	const ui = getUiState();
	const analysisGrid = getAnalysisGrid();
	// The disruption view only means something once a disruption is selected.
	const available = (v: InfoViewDefinition) =>
		v.id !== 'disruptionImpact' || analysisGrid.disruptionImpact !== null;
	const GROUPS = [
		{ label: 'Analysis', title: 'Demo accessibility model', layer: 'grid' },
		{ label: 'Conditions', title: 'Live forecast, visual only', layer: 'environment' }
	] as const;
	const itemClass =
		'flex h-7 items-center gap-1.5 rounded px-1.5 text-[11px] font-medium whitespace-nowrap transition-colors';
</script>

<div
	class="pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto hud-panel p-1"
	role="toolbar"
	aria-label="Info views"
>
	{#each GROUPS as group, g (group.layer)}
		{#if g > 0}<span class="mx-0.5 h-5 w-px shrink-0 bg-hud-line" aria-hidden="true"></span>{/if}
		<span class="px-1 hud-label" title={group.title}>{group.label}</span>
		{#each INFO_VIEWS.filter((v) => v.layer === group.layer && available(v)) as view (view.id)}
			{@const on = ui.infoView === view.id}
			{@const [lo, mid, hi] = [
				view.scale.stops[0][1],
				view.scale.stops[2][1],
				view.scale.stops.at(-1)![1]
			]}
			<button
				type="button"
				class="{itemClass} {on
					? 'bg-hud-accent-dim text-hud-accent'
					: 'text-hud-text hover:bg-hud-hover'}"
				aria-pressed={on}
				title={view.description}
				onclick={() => ui.setInfoView(on ? null : view.id)}
			>
				<span
					class="h-2.5 w-3 shrink-0 rounded-sm"
					style:background="linear-gradient(to right, {lo}, {mid}, {hi})"
					aria-hidden="true"
				></span>
				{view.shortLabel}
			</button>
		{/each}
	{/each}
	<button
		type="button"
		class="{itemClass} text-hud-muted hover:bg-hud-hover hover:text-hud-text disabled:opacity-40"
		disabled={!ui.infoView}
		onclick={() => ui.setInfoView(null)}
		title="Hide the analytical layer"
	>
		<EyeOff class="size-3.5" /> <span class="max-2xl:sr-only">Off</span>
	</button>
</div>
