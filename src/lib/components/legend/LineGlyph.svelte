<script lang="ts">
	let {
		color,
		dashed = false,
		size = 14
	}: { color: string; dashed?: boolean; size?: number } = $props();
</script>

<svg viewBox="0 0 14 14" width={size} height={size} class="shrink-0" aria-hidden="true">
	<line
		x1="1"
		y1="7"
		x2="13"
		y2="7"
		stroke={color}
		stroke-width="2.5"
		stroke-dasharray={dashed ? '3 2' : undefined}
		stroke-linecap={dashed ? 'butt' : 'round'}
	/>
</svg>
