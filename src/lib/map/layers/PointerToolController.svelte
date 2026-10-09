<!--
	Drives a pointer tool (placing or moving) on the map: tracks the cursor, asks `evaluate` for a
	verdict, draws the preview and reports confirming clicks. Holds no domain logic; validation
	lives in simulator/placement.ts and simulator/move.ts.
-->
<script lang="ts" generics="E extends { validity: PlacementValidity }">
	import type { LngLat, Map as MaplibreMap, MapMouseEvent } from 'maplibre-gl';
	import type {
		PlacementValidity,
		PointerHover,
		PreviewGeometry,
		RoadCheck
	} from '#lib/simulator/placement.ts';
	import type { Position } from '#lib/types/domain.ts';
	import {
		addPlacementLayers,
		measureRoadDistance,
		removePlacementLayers,
		setPlacementPreview
	} from './placementLayers.ts';

	let {
		map,
		evaluate,
		preview,
		onhover,
		oncommit
	}: {
		map: MaplibreMap;
		evaluate: (position: Position, road: RoadCheck) => E;
		/** What to draw for a verdict. */
		preview: (evaluation: E) => PreviewGeometry;
		onhover: (hover: PointerHover<E> | null) => void;
		oncommit: (evaluation: E) => void;
	} = $props();

	let pointer = $state.raw<{ lngLat: LngLat; x: number; y: number } | null>(null);

	// The verdict re-derives whenever the cursor moves or the world (via `evaluate`) changes,
	// e.g. right after a placement, so the spot just used immediately shows as a duplicate.
	const current = $derived.by(() => {
		if (!pointer) return null;
		const road = measureRoadDistance(map, pointer.lngLat);
		return evaluate([pointer.lngLat.lng, pointer.lngLat.lat], road);
	});

	$effect(() => {
		addPlacementLayers(map);
		const canvas = map.getCanvas();
		let frame = 0;
		let latest: MapMouseEvent | null = null;

		const onMove = (e: MapMouseEvent) => {
			latest = e;
			// Coalesce to one evaluation per animation frame so the preview stays smooth.
			frame ||= requestAnimationFrame(() => {
				frame = 0;
				if (latest) pointer = { lngLat: latest.lngLat, x: latest.point.x, y: latest.point.y };
			});
		};
		const onOut = () => (pointer = null);
		const onClick = (e: MapMouseEvent) => {
			const road = measureRoadDistance(map, e.lngLat);
			const evaluation = evaluate([e.lngLat.lng, e.lngLat.lat], road);
			if (evaluation.validity !== 'invalid') oncommit(evaluation);
		};

		map.on('mousemove', onMove);
		map.on('mouseout', onOut);
		map.on('click', onClick);
		return () => {
			cancelAnimationFrame(frame);
			map.off('mousemove', onMove);
			map.off('mouseout', onOut);
			map.off('click', onClick);
			canvas.style.cursor = '';
			onhover(null);
			try {
				removePlacementLayers(map);
			} catch {
				/* map already torn down */
			}
		};
	});

	$effect(() => {
		setPlacementPreview(map, current ? preview(current) : null);
		map.getCanvas().style.cursor = current?.validity === 'invalid' ? 'not-allowed' : 'crosshair';
		const container = map.getContainer();
		onhover(
			current && pointer
				? {
						evaluation: current,
						point: { x: pointer.x, y: pointer.y },
						container: { width: container.clientWidth, height: container.clientHeight }
					}
				: null
		);
	});
</script>
