<script lang="ts">
	import { PanelLeftClose, PanelLeftOpen } from '@lucide/svelte';
	import { LAYER_GROUPS } from '#lib/config/layers.ts';
	import { getUiState } from '#lib/stores/ui.svelte.ts';
	import { getScenarioStore } from '#lib/stores/scenario.svelte.ts';
	import ScenarioLegend from '#lib/components/legend/ScenarioLegend.svelte';
	import LayerGroupSection from './LayerGroupSection.svelte';
	import ObservationActions from '#lib/components/feedback/ObservationActions.svelte';

	const ui = getUiState();
	const scenarios = getScenarioStore();
</script>

<aside
	class="relative z-20 flex shrink-0 flex-col overflow-hidden border-r border-hud-line bg-hud-panel transition-[width] duration-200 ease-out"
	style:width={ui.leftPanelOpen ? 'var(--hud-sidebar-w)' : 'var(--hud-rail-w)'}
	aria-label="Map layers"
>
	<div
		class="flex h-9 shrink-0 items-center border-b border-hud-line"
		class:justify-center={!ui.leftPanelOpen}
		class:px-3={ui.leftPanelOpen}
	>
		{#if ui.leftPanelOpen}
			<span class="flex-1 hud-label">Layers</span>
		{/if}
		<button
			type="button"
			class="grid size-7 place-items-center rounded text-hud-muted hover:bg-hud-hover hover:text-hud-text"
			onclick={() => ui.togglePanel('left')}
			aria-label={ui.leftPanelOpen ? 'Collapse layers panel' : 'Expand layers panel'}
			aria-expanded={ui.leftPanelOpen}
			title="Toggle layers  [ "
		>
			{#if ui.leftPanelOpen}
				<PanelLeftClose class="size-4" />
			{:else}
				<PanelLeftOpen class="size-4" />
			{/if}
		</button>
	</div>

	{#if ui.leftPanelOpen}
		<div class="min-h-0 flex-1 overflow-y-auto py-1">
			{#each LAYER_GROUPS as group (group.id)}
				<LayerGroupSection {group} />
				{#if group.id === 'localObservations' && ui.expandedLayerGroups.has(group.id)}
					<ObservationActions />
				{/if}
			{/each}
		</div>
		{#if !scenarios.isBaseline}
			<ScenarioLegend />
		{/if}
	{:else}
		<nav class="flex flex-col items-center gap-1 py-2" aria-label="Layer groups">
			{#each LAYER_GROUPS as group (group.id)}
				<button
					type="button"
					class="grid size-8 place-items-center rounded text-hud-muted hover:bg-hud-hover hover:text-hud-text"
					onclick={() => ui.revealLayerGroup(group.id)}
					aria-label={group.label}
					title={group.label}
				>
					<group.icon class="size-4" />
				</button>
			{/each}
		</nav>
	{/if}
</aside>
