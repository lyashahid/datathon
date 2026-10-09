<!-- Binds the analytical grid, active info view, hover and selection to the map. Renders nothing. -->
<script lang="ts">
	import type { Map as MaplibreMap, MapMouseEvent } from 'maplibre-gl';
	import type { GridInfoView } from '#lib/config/infoViews.ts';
	import type { CellValueSource, H3Grid, H3Index } from '#lib/types/h3.ts';
	import { pickAsset } from './infrastructureLayers.ts';
	import { pickCandidate } from './candidateLayers.ts';
	import { pickObservation } from './observationLayers.ts';
	import {
		addH3Layers,
		pickCell,
		removeH3Layers,
		setH3Data,
		setHoveredCell,
		setSelectedCell,
		showInfoView
	} from './h3Layers.ts';

	let {
		map,
		grid,
		external,
		view,
		selected,
		interactive,
		onhover,
		onselect
	}: {
		map: MaplibreMap;
		grid: H3Grid;
		/** Per-cell values for views whose metric is computed outside the grid. */
		external: CellValueSource | null;
		view: GridInfoView | null;
		selected: H3Index | null;
		/** False while a pointer tool owns the map. */
		interactive: boolean;
		onhover: (hover: { h3Index: H3Index; point: { x: number; y: number } } | null) => void;
		onselect: (h3Index: H3Index | null) => void;
	} = $props();

	let hovered = $state<H3Index | null>(null);

	$effect(() => {
		addH3Layers(map);

		const onMove = (e: MapMouseEvent) => {
			// Infrastructure stays on top: hovering a marker is not hovering a cell.
			const h = view && interactive && !pickAsset(map, e.point) ? pickCell(map, e.point) : null;
			hovered = h;
			onhover(h ? { h3Index: h, point: { x: e.point.x, y: e.point.y } } : null);
		};
		const onOut = () => {
			hovered = null;
			onhover(null);
		};
		const onClick = (e: MapMouseEvent) => {
			if (
				!view ||
				!interactive ||
				pickAsset(map, e.point) ||
				pickCandidate(map, e.point) ||
				pickObservation(map, e.point)
			)
				return;
			onselect(pickCell(map, e.point));
		};
		map.on('mousemove', onMove);
		map.on('mouseout', onOut);
		map.on('click', onClick);

		return () => {
			map.off('mousemove', onMove);
			map.off('mouseout', onOut);
			map.off('click', onClick);
			onhover(null);
			try {
				removeH3Layers(map);
			} catch {
				/* map already torn down */
			}
		};
	});

	$effect(() => setH3Data(map, grid, external));
	$effect(() => showInfoView(map, view));
	$effect(() => setHoveredCell(map, view ? hovered : null));
	$effect(() => setSelectedCell(map, selected));
</script>
