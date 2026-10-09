<script lang="ts">
	import { CURSOR_COORDINATE_DECIMALS } from '#lib/config/map.ts';
	import type { LngLat } from '#lib/types/map.ts';
	import { formatLatLng } from '#lib/utils/format.ts';

	let { cursor }: { cursor: LngLat | null } = $props();
</script>

{#if cursor}
	<div
		class="pointer-events-none rounded bg-hud-base/70 px-1.5 py-0.5 font-mono text-[10px] whitespace-pre text-hud-muted tabular-nums"
		aria-hidden="true"
	>
		{formatLatLng(cursor[0], cursor[1], CURSOR_COORDINATE_DECIMALS)}
	</div>
{/if}
