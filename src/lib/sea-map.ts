import { themeColors } from '#lib/theme.js';
import type { FeatureCollection } from 'geojson';
import { seaColors, type SeaMapState } from './sea-connectivity.js';

/** Reuse island geometry already on the map; connectivity never changes its source. */
export function seaIslandFeatures(
	islands: FeatureCollection,
	state: SeaMapState | null
): FeatureCollection {
	if (!state) return { type: 'FeatureCollection', features: [] };
	const destinations = new Map(state.destinations.map((item) => [item.id, item]));
	return {
		type: 'FeatureCollection',
		features: islands.features.flatMap((island) => {
			const id = String(island.properties?.id ?? '');
			const destination = destinations.get(id);
			const origin = id === state.originIslandId;
			if (!destination && !origin) return [];
			return [
				{
					...island,
					properties: {
						island_id: id,
						name: island.properties?.name ?? '',
						color: origin
							? themeColors.color213c4e
							: destination?.newly_reachable || destination?.time_improved
								? seaColors.improved
								: seaColors[destination?.status ?? 'unknown'],
						selected: origin || id === state.selectedDestinationId,
						known: origin || destination?.status !== 'unknown',
						within_budget: destination?.within_budget ?? false
					}
				}
			];
		})
	};
}
