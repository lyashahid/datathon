<script lang="ts">
	import { INFRASTRUCTURE_TYPE_STYLES } from '#lib/config/infrastructure.ts';
	import { PLACEABLE_TYPES } from '#lib/config/placement.ts';
	import { SIMULATOR_TOOLS, getTool } from '#lib/config/tools.ts';
	import { getUiState } from '#lib/stores/ui.svelte.ts';
	import { getScenarioStore } from '#lib/stores/scenario.svelte.ts';
	import { modifierKeyLabel } from '#lib/utils/dom.ts';
	import { getInfoView } from '#lib/config/infoViews.ts';
	import InfoViewPalette from './InfoViewPalette.svelte';
	import PlacePalette from './PlacePalette.svelte';
	import ToolButton from './ToolButton.svelte';

	const ui = getUiState();
	const scenarios = getScenarioStore();
	const modKey = modifierKeyLabel();
	const active = $derived(getTool(ui.activeTool));
	const placeable = $derived(PLACEABLE_TYPES[ui.activeTool] ?? []);
	const placingLabel = $derived(
		ui.placement ? INFRASTRUCTURE_TYPE_STYLES[ui.placement.type].label.toLowerCase() : null
	);
</script>

<div
	class="pointer-events-none absolute inset-x-0 bottom-(--hud-gap) z-30 flex flex-col items-center gap-1.5 px-(--hud-gap)"
>
	{#if ui.activeTool === 'infoViews'}
		<InfoViewPalette />
	{:else if placeable.length > 0}
		<PlacePalette types={placeable} />
	{/if}

	<p
		class="pointer-events-auto hud-panel rounded-full px-3 py-1 text-[11px] text-hud-muted max-sm:hidden"
		aria-live="polite"
	>
		{#if placingLabel}
			<span class="font-medium text-hud-accent">Placing {placingLabel}</span>
			<span class="mx-1 text-hud-faint">·</span>Click the map to place · Esc to cancel
		{:else if ui.infoView}
			{@const view = getInfoView(ui.infoView)}
			<span class="font-medium text-hud-accent">{view.label}</span>
			<span class="mx-1 text-hud-faint">·</span>{view.layer === 'grid'
				? 'Hover a cell for metrics · click for details · Esc to close'
				: 'Live forecast, visual only · Esc to close'}
		{:else}
			<span class="font-medium text-hud-accent">{active.label}</span>
			<span class="mx-1 text-hud-faint">·</span>{placeable.length > 0
				? 'Choose something to place'
				: active.hint}
			{#if scenarios.canUndo}
				<span class="mx-1 text-hud-faint">·</span><kbd class="font-sans">{modKey}Z</kbd> undo
			{/if}
		{/if}
	</p>

	<div
		class="pointer-events-auto flex h-(--hud-toolbar-h) max-w-full items-center gap-0.5 overflow-x-auto hud-panel p-1"
		role="toolbar"
		aria-label="Simulator tools"
	>
		{#each SIMULATOR_TOOLS as tool, i (tool.id)}
			{#if i === 1 || i === SIMULATOR_TOOLS.length - 1}
				<div class="mx-1 h-6 w-px shrink-0 bg-hud-line" aria-hidden="true"></div>
			{/if}
			<ToolButton
				{tool}
				active={ui.activeTool === tool.id}
				onselect={() => ui.selectTool(tool.id)}
			/>
		{/each}
	</div>
</div>
