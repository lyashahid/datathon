<!-- Binds infrastructure and route data, selection and visibility to the map. Renders nothing itself. -->
<script lang="ts">
	import type { Map as MaplibreMap, MapMouseEvent } from 'maplibre-gl';
	import { INFRASTRUCTURE_TYPE_STYLES, ROUTE_MODE_STYLES } from '#lib/config/infrastructure.ts';
	import type {
		AssetRef,
		InfrastructureFeature,
		InfrastructureType,
		TransportMode,
		TransportRoute
	} from '#lib/types/domain.ts';
	import { INFRASTRUCTURE_TYPES, TRANSPORT_MODES } from '#lib/types/domain.ts';
	import type { AssetDelta } from '#lib/types/scenario.ts';
	import type { LayerId } from '#lib/types/ui.ts';
	import {
		addInfrastructureLayers,
		pickAsset,
		removeInfrastructureLayers,
		setInfrastructureData,
		setInfrastructureEmphasis,
		setSelectedAsset,
		setVisibleCategories
	} from './infrastructureLayers.ts';
	import { pickCandidate } from './candidateLayers.ts';
	import { pickObservation } from './observationLayers.ts';

	let {
		map,
		infrastructure,
		routes,
		deltas,
		selected,
		visibleLayers,
		interactive = true,
		movingId = null,
		fade = 1,
		clearOnEmptyClick = true,
		onpick
	}: {
		map: MaplibreMap;
		infrastructure: readonly InfrastructureFeature[];
		routes: readonly TransportRoute[];
		/** Scenario differences from the baseline, drawn as rings around edited assets. */
		deltas: ReadonlyMap<string, AssetDelta>;
		selected: AssetRef | null;
		visibleLayers: ReadonlySet<LayerId>;
		/** False while another tool (e.g. placement) owns map clicks and the cursor. */
		interactive?: boolean;
		/** Asset being moved; drawn faded at its current position. */
		movingId?: string | null;
		/** 0–1 opacity multiplier; lowered while an info view takes the foreground. */
		fade?: number;
		/** Whether clicking empty map clears the selection (off when grid cells are clickable). */
		clearOnEmptyClick?: boolean;
		/** Called with the clicked asset, or null when empty map is clicked. */
		onpick: (asset: AssetRef | null) => void;
	} = $props();

	$effect(() => {
		removeInfrastructureLayers(map);
		addInfrastructureLayers(map);

		const onClick = (e: MapMouseEvent) => {
			// Candidate badges sit on top and own their clicks.
			if (!interactive || pickCandidate(map, e.point) || pickObservation(map, e.point)) return;
			const asset = pickAsset(map, e.point);
			if (asset || clearOnEmptyClick) onpick(asset);
		};
		const onMove = (e: MapMouseEvent) => {
			if (interactive)
				map.getCanvas().style.cursor =
					pickAsset(map, e.point) || pickCandidate(map, e.point) || pickObservation(map, e.point)
						? 'pointer'
						: '';
		};
		map.on('click', onClick);
		map.on('mousemove', onMove);

		return () => {
			map.off('click', onClick);
			map.off('mousemove', onMove);
			// The map itself may already be torn down when this component unmounts.
			try {
				removeInfrastructureLayers(map);
			} catch {
				/* nothing left to clean up */
			}
		};
	});

	$effect(() => setInfrastructureData(map, infrastructure, routes, deltas));

	$effect(() => setSelectedAsset(map, selected));

	$effect(() => setInfrastructureEmphasis(map, movingId, fade));

	$effect(() => {
		const types: InfrastructureType[] = INFRASTRUCTURE_TYPES.filter((t) =>
			visibleLayers.has(INFRASTRUCTURE_TYPE_STYLES[t].layerId)
		);
		const modes: TransportMode[] = TRANSPORT_MODES.filter((m) =>
			visibleLayers.has(ROUTE_MODE_STYLES[m].layerId)
		);
		setVisibleCategories(map, types, modes);
	});
</script>
