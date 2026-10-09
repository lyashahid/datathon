<script lang="ts">
	import { PROVENANCE_LABELS, STATE_LABELS } from '#lib/config/infrastructure.ts';
	import { MAP_COLORS } from '#lib/config/map.ts';
	import type { AssetStateLabel } from '#lib/simulator/assetState.ts';
	import type { SourceInfo } from '#lib/types/domain.ts';

	let { states, source }: { states: readonly AssetStateLabel[]; source: SourceInfo } = $props();

	// Badge colours match the map's scenario rings so a badge and its marker read as one thing.
	const STATE_COLORS: Record<AssetStateLabel, string | null> = {
		existing: null,
		proposed: MAP_COLORS.scenarioAdded,
		moved: MAP_COLORS.scenarioMoved,
		disabled: MAP_COLORS.scenarioDisabled
	};
	const isObserved = $derived(source.provenance === 'observed');
</script>

<div class="flex flex-wrap items-center gap-1.5">
	{#each states as state (state)}
		{@const color = STATE_COLORS[state]}
		<span
			class="rounded border px-1.5 py-0.5 text-[10px] font-medium {color
				? ''
				: 'border-hud-line-strong text-hud-text'}"
			style:color
			style:border-color={color ? `color-mix(in srgb, ${color} 50%, transparent)` : undefined}
		>
			{STATE_LABELS[state]}
		</span>
	{/each}
	<span
		class="rounded border px-1.5 py-0.5 text-[10px] font-medium {isObserved
			? 'border-hud-line-strong text-hud-muted'
			: 'border-hud-warn/40 bg-hud-warn/10 text-hud-warn'}"
		title={source.note ?? source.dataset}
	>
		{PROVENANCE_LABELS[source.provenance]}
	</span>
</div>
