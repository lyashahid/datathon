<!-- Card that follows the cursor and flips sides near the map edges so it never leaves the map. -->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		point,
		container,
		accent,
		width = 232,
		heightEstimate = 200,
		children
	}: {
		point: { x: number; y: number };
		container: { width: number; height: number };
		accent: string;
		width?: number;
		heightEstimate?: number;
		children: Snippet;
	} = $props();

	const OFFSET = 18;

	const left = $derived(
		point.x + OFFSET + width > container.width ? point.x - OFFSET - width : point.x + OFFSET
	);
	const top = $derived(
		Math.max(
			8,
			point.y + OFFSET + heightEstimate > container.height
				? point.y - OFFSET - heightEstimate
				: point.y + OFFSET
		)
	);
</script>

<div
	class="pointer-events-none absolute z-20 hud-panel p-2.5 text-[11px]"
	style:left="{left}px"
	style:top="{top}px"
	style:width="{width}px"
	style:border-color="color-mix(in srgb, {accent} 45%, transparent)"
	role="status"
	aria-live="polite"
>
	{@render children()}
</div>
