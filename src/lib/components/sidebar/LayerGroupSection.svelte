<script lang="ts">
	import { ChevronRight } from '@lucide/svelte';
	import { getUiState } from '#lib/stores/ui.svelte.ts';
	import type { LayerGroup } from '#lib/types/ui.ts';
	import LayerSwatch from '#lib/components/legend/LayerSwatch.svelte';

	let { group }: { group: LayerGroup } = $props();

	const ui = getUiState();
	const expanded = $derived(ui.expandedLayerGroups.has(group.id));
	const activeCount = $derived(group.layers.filter((l) => ui.visibleLayers.has(l.id)).length);
</script>

<section class="px-1.5">
	<button
		type="button"
		class="flex h-8 w-full items-center gap-2 rounded px-1.5 text-left text-xs font-medium text-hud-text hover:bg-hud-hover"
		onclick={() => ui.toggleLayerGroup(group.id)}
		aria-expanded={expanded}
	>
		<ChevronRight
			class="size-3 shrink-0 text-hud-faint transition-transform {expanded ? 'rotate-90' : ''}"
		/>
		<group.icon class="size-3.5 shrink-0 text-hud-muted" />
		<span class="flex-1 truncate">{group.label}</span>
		{#if activeCount > 0}
			<span class="font-mono text-[10px] text-hud-accent tabular-nums">{activeCount}</span>
		{/if}
	</button>

	{#if expanded}
		<ul class="mb-1 ml-[1.375rem] border-l border-hud-line pl-1.5">
			{#each group.layers as layer (layer.id)}
				{@const on = ui.visibleLayers.has(layer.id)}
				<li>
					<button
						type="button"
						role="switch"
						aria-checked={on}
						class="flex h-7 w-full items-center gap-2 rounded px-1.5 text-left text-xs hover:bg-hud-hover {on
							? 'text-hud-text'
							: 'text-hud-muted'}"
						onclick={() => ui.toggleLayer(layer.id)}
					>
						<LayerSwatch layerId={layer.id} />
						<span class="flex-1 truncate">{layer.label}</span>
						<span
							class="relative h-3 w-5 shrink-0 rounded-full transition-colors {on
								? 'bg-hud-accent/80'
								: 'bg-hud-line-strong'}"
							aria-hidden="true"
						>
							<span
								class="absolute top-0.5 size-2 rounded-full bg-hud-base transition-[left] {on
									? 'left-2.5'
									: 'left-0.5'}"
							></span>
						</span>
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>
