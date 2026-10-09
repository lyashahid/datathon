<!--
	One-way camera link for compare mode. As `source` it reports every camera move; as a
	follower it jumps to the given camera. One direction only, so the maps can never feed back.
-->
<script lang="ts">
	import type { Map as MaplibreMap } from 'maplibre-gl';
	import type { CameraPose } from '#lib/types/map.ts';

	let {
		map,
		follow = null,
		onmove
	}: {
		map: MaplibreMap;
		/** Camera to mirror; set on the follower map. */
		follow?: CameraPose | null;
		/** Called on every move; set on the source map. */
		onmove?: (pose: CameraPose) => void;
	} = $props();

	$effect(() => {
		if (!onmove) return;
		const report = () => {
			const c = map.getCenter();
			onmove({ center: [c.lng, c.lat], zoom: map.getZoom() });
		};
		report();
		map.on('move', report);
		return () => {
			map.off('move', report);
		};
	});

	$effect(() => {
		if (follow) map.jumpTo({ center: [...follow.center], zoom: follow.zoom });
	});
</script>
