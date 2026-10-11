import type { FeatureCollection, LineString, Point } from 'geojson';

/** Direction follows stored road geometry, which is node-from to node-to. */
export function roadDirectionMarkers(
	roads: FeatureCollection<LineString>,
	selected: readonly string[]
): FeatureCollection<Point> {
	const ids = new Set(selected);
	return {
		type: 'FeatureCollection',
		features: roads.features.flatMap((road) => {
			if (!ids.has(road.properties?.edgeId)) return [];
			const coordinates = road.geometry.coordinates;
			const index = Math.floor((coordinates.length - 1) / 2);
			const from = coordinates[index],
				to = coordinates[index + 1];
			if (!from || !to || (from[0] === to[0] && from[1] === to[1])) return [];
			const longitude = (from[0] + to[0]) / 2,
				latitude = (from[1] + to[1]) / 2;
			const bearing =
				(Math.atan2((to[0] - from[0]) * Math.cos((latitude * Math.PI) / 180), to[1] - from[1]) *
					180) /
				Math.PI;
			return [
				{
					type: 'Feature' as const,
					geometry: { type: 'Point' as const, coordinates: [longitude, latitude] },
					properties: { edgeId: road.properties?.edgeId, bearing }
				}
			];
		})
	};
}
