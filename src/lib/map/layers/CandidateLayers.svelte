<!-- Ranked bus-stop candidate badges. Clicking one selects it; renders nothing itself. -->
<script lang="ts">
	import type { Map as MaplibreMap, MapMouseEvent } from 'maplibre-gl';
	import type { BusStopCandidate } from '#lib/types/candidates.ts';
	import {
		addCandidateLayers,
		pickCandidate,
		removeCandidateLayers,
		setCandidates
	} from './candidateLayers.ts';

	let {
		map,
		candidates,
		selectedId,
		interactive,
		onselect
	}: {
		map: MaplibreMap;
		candidates: readonly BusStopCandidate[];
		selectedId: string | null;
		interactive: boolean;
		onselect: (id: string) => void;
	} = $props();

	$effect(() => {
		addCandidateLayers(map);
		const onClick = (e: MapMouseEvent) => {
			if (!interactive) return;
			const id = pickCandidate(map, e.point);
			if (id) onselect(id);
		};
		// The pointer cursor over badges is set by InfrastructureLayers' single hover handler.
		map.on('click', onClick);
		return () => {
			map.off('click', onClick);
			try {
				removeCandidateLayers(map);
			} catch {
				/* map already torn down */
			}
		};
	});

	$effect(() => setCandidates(map, candidates, selectedId));
</script>
