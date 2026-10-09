<script lang="ts">
	import { INFRASTRUCTURE_TYPE_STYLES } from '#lib/config/infrastructure.ts';
	import { getUiState } from '#lib/stores/ui.svelte.ts';
	import type { InfrastructureType } from '#lib/types/domain.ts';
	import MarkerGlyph from '#lib/components/legend/MarkerGlyph.svelte';

	let { types }: { types: readonly InfrastructureType[] } = $props();

	const ui = getUiState();
</script>

<div
	class="pointer-events-auto flex items-center gap-1 hud-panel p-1"
	role="toolbar"
	aria-label="Place infrastructure"
>
	<span class="px-1.5 hud-label">Place</span>
	{#each types as type (type)}
		{@const s = INFRASTRUCTURE_TYPE_STYLES[type]}
		{@const on = ui.placement?.type === type}
		<button
			type="button"
			class="flex h-7 items-center gap-1.5 rounded px-2 text-[11px] font-medium transition-colors {on
				? 'bg-hud-accent-dim text-hud-accent'
				: 'text-hud-text hover:bg-hud-hover'}"
			aria-pressed={on}
			onclick={() => (on ? ui.cancelPlacement() : ui.startPlacement(type))}
		>
			<MarkerGlyph shape={s.shape} color={s.color} size={11} />
			{s.label}
		</button>
	{/each}
</div>
