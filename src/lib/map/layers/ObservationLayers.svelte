<!-- Local observations on the map, plus the click-to-locate step when recording one. -->
<script lang="ts">
	import type { Map as MaplibreMap, MapMouseEvent } from 'maplibre-gl';
	import type { Position } from '#lib/types/domain.ts';
	import type { Observation } from '#lib/types/feedback.ts';
	import {
		addObservationLayers,
		pickObservation,
		removeObservationLayers,
		setObservationData,
		setObservationVisibility,
		setSelectedObservation
	} from './observationLayers.ts';

	let {
		map,
		observations,
		visible,
		selectedId,
		draft,
		picking,
		interactive,
		onselect,
		onlocate
	}: {
		map: MaplibreMap;
		observations: readonly Observation[];
		visible: boolean;
		selectedId: string | null;
		/** Location chosen for the observation being recorded. */
		draft: Position | null;
		/** True while recording: map clicks set the draft location. */
		picking: boolean;
		interactive: boolean;
		onselect: (id: string) => void;
		onlocate: (position: Position) => void;
	} = $props();

	$effect(() => {
		addObservationLayers(map);
		return () => {
			try {
				removeObservationLayers(map);
			} catch {
				/* map already torn down */
			}
		};
	});

	$effect(() => {
		const onClick = (e: MapMouseEvent) => {
			if (picking) return onlocate([e.lngLat.lng, e.lngLat.lat]);
			if (!interactive) return;
			const id = pickObservation(map, e.point);
			if (id) onselect(id);
		};
		map.on('click', onClick);
		if (picking) map.getCanvas().style.cursor = 'crosshair';
		return () => {
			map.off('click', onClick);
			if (picking) map.getCanvas().style.cursor = '';
		};
	});

	$effect(() => setObservationData(map, observations, draft));
	$effect(() => setObservationVisibility(map, visible));
	$effect(() => setSelectedObservation(map, selectedId));
</script>
