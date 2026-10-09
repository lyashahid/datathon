<!--
	Baseline map drawn over the scenario map and clipped to the left of the swipe line.
	Display-only: it takes no input and follows the main map's camera.
-->
<script lang="ts">
	import { MAP_STYLE_URL } from '$app/env/public';
	import type { GridInfoView } from '#lib/config/infoViews.ts';
	import MobilityMap from '#lib/map/MobilityMap.svelte';
	import CameraSync from '#lib/map/layers/CameraSync.svelte';
	import H3Layers from '#lib/map/layers/H3Layers.svelte';
	import InfrastructureLayers from '#lib/map/layers/InfrastructureLayers.svelte';
	import { MapState } from '#lib/stores/map.svelte.ts';
	import type { InfrastructureFeature, TransportRoute } from '#lib/types/domain.ts';
	import type { H3Grid } from '#lib/types/h3.ts';
	import type { CameraPose } from '#lib/types/map.ts';
	import type { LayerId } from '#lib/types/ui.ts';

	let {
		split,
		camera,
		infrastructure,
		routes,
		grid,
		view,
		visibleLayers,
		fade
	}: {
		/** Swipe position, 0–1 from the left edge. */
		split: number;
		camera: CameraPose | null;
		infrastructure: readonly InfrastructureFeature[];
		routes: readonly TransportRoute[];
		grid: H3Grid;
		view: GridInfoView | null;
		visibleLayers: ReadonlySet<LayerId>;
		fade: number;
	} = $props();

	const mapState = new MapState();
	const NO_DELTAS = new Map();
</script>

<div
	class="pointer-events-none absolute inset-0 z-[1]"
	style:clip-path="inset(0 {(1 - split) * 100}% 0 0)"
	aria-hidden="true"
>
	<MobilityMap {mapState} styleUrl={MAP_STYLE_URL} interactive={false} controls={false}>
		{#snippet layers(map)}
			<CameraSync {map} follow={camera} />
			<InfrastructureLayers
				{map}
				{infrastructure}
				{routes}
				deltas={NO_DELTAS}
				selected={null}
				{visibleLayers}
				interactive={false}
				{fade}
				clearOnEmptyClick={false}
				onpick={() => {}}
			/>
			<H3Layers
				{map}
				{grid}
				external={null}
				{view}
				selected={null}
				interactive={false}
				onhover={() => {}}
				onselect={() => {}}
			/>
		{/snippet}
	</MobilityMap>
</div>
