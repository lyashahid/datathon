<!-- SVG twin of the canvas-drawn map marker, for legends and the inspector. -->
<script lang="ts">
	import { MAP_COLORS } from '#lib/config/map.ts';
	import { markerPath, type MarkerShape } from '#lib/utils/markerShapes.ts';

	let { shape, color, size = 12 }: { shape: MarkerShape; color: string; size?: number } = $props();
</script>

<svg viewBox="-1.25 -1.25 2.5 2.5" width={size} height={size} class="shrink-0" aria-hidden="true">
	<path
		d={markerPath(shape)}
		fill={color}
		stroke={MAP_COLORS.markerOutline}
		stroke-width="0.2"
		stroke-linejoin="round"
	/>
</svg>
