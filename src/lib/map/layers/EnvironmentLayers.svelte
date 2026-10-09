<!-- Forecast overlays (rain cells, wind arrows, sea state). Visual only; never feeds scores. -->
<script lang="ts">
	import type { Map as MaplibreMap } from 'maplibre-gl';
	import type { EnvironmentInfoView } from '#lib/config/infoViews.ts';
	import type { MarineSnapshot, SampleGrid, WeatherSnapshot } from '#lib/types/weather.ts';
	import {
		addEnvironmentLayers,
		removeEnvironmentLayers,
		showEnvironment
	} from './environmentLayers.ts';

	let {
		map,
		view,
		weatherSamples,
		marineSamples
	}: {
		map: MaplibreMap;
		view: EnvironmentInfoView | null;
		weatherSamples: SampleGrid<WeatherSnapshot> | null;
		marineSamples: SampleGrid<MarineSnapshot> | null;
	} = $props();

	$effect(() => {
		addEnvironmentLayers(map);
		return () => {
			try {
				removeEnvironmentLayers(map);
			} catch {
				/* map already torn down */
			}
		};
	});

	$effect(() =>
		showEnvironment(
			map,
			view,
			view ? (view.sample === 'weather' ? weatherSamples : marineSamples) : null
		)
	);
</script>
