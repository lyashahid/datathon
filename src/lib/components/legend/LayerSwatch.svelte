<!-- Legend swatch for a sidebar layer, if that layer has a map symbology. -->
<script lang="ts">
	import { INFRASTRUCTURE_TYPE_STYLES, ROUTE_MODE_STYLES } from '#lib/config/infrastructure.ts';
	import type { LayerId } from '#lib/types/ui.ts';
	import LineGlyph from './LineGlyph.svelte';
	import MarkerGlyph from './MarkerGlyph.svelte';

	let { layerId }: { layerId: LayerId } = $props();

	const marker = $derived(
		Object.values(INFRASTRUCTURE_TYPE_STYLES).find((s) => s.layerId === layerId)
	);
	const line = $derived(Object.values(ROUTE_MODE_STYLES).find((s) => s.layerId === layerId));
</script>

{#if marker}
	<MarkerGlyph shape={marker.shape} color={marker.color} size={11} />
{:else if line}
	<LineGlyph color={line.color} dashed={!!line.dash} size={11} />
{:else}
	<span class="size-[11px] shrink-0" aria-hidden="true"></span>
{/if}
