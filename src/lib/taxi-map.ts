import type { FeatureCollection, LineString, Point } from 'geojson';
import { validPoint } from './planning-map.js';
import type { Coordinates, MapFeatures } from './types.js';

const zones: Record<string, { islandId: string; name: string }> = {
	male: { islandId: 'island:1443', name: 'Malé' },
	hulhumale: { islandId: 'island:1442', name: 'Hulhumalé' },
	hulhule: { islandId: 'island:1483', name: 'Hulhulé' }
};

/** Historical broad-island connection, deliberately unrelated to a routed road path. */
export function taxiConnectionFeatures(
	corridor: { pickup_zone: string; dropoff_zone: string; ride_count: number } | null,
	features: MapFeatures | null
): FeatureCollection<LineString | Point> {
	const empty: FeatureCollection<LineString | Point> = {
		type: 'FeatureCollection',
		features: []
	};
	if (
		!corridor ||
		corridor.pickup_zone === corridor.dropoff_zone ||
		!Number.isSafeInteger(corridor.ride_count) ||
		corridor.ride_count <= 0
	)
		return empty;
	const origin = zones[corridor.pickup_zone];
	const destination = zones[corridor.dropoff_zone];
	if (!origin || !destination) return empty;
	const anchor = (islandId: string): Coordinates | null => {
		const centroid = features?.features.find((item) => item.properties?.id === islandId)?.properties
			?.centroid;
		return validPoint(centroid) ? [centroid[0], centroid[1]] : null;
	};
	const start = anchor(origin.islandId);
	const end = anchor(destination.islandId);
	if (!start || !end || (start[0] === end[0] && start[1] === end[1])) return empty;

	// A shallow quadratic arc distinguishes an aggregate corridor from a navigable route.
	const latitudeScale = Math.cos((((start[1] + end[1]) / 2) * Math.PI) / 180);
	const dx = (end[0] - start[0]) * latitudeScale;
	const dy = end[1] - start[1];
	const control: Coordinates = [
		(start[0] + end[0]) / 2 - (dy * 0.22) / latitudeScale,
		(start[1] + end[1]) / 2 + dx * 0.22
	];
	const coordinates = Array.from({ length: 33 }, (_, index): Coordinates => {
		const t = index / 32;
		return [
			(1 - t) ** 2 * start[0] + 2 * (1 - t) * t * control[0] + t ** 2 * end[0],
			(1 - t) ** 2 * start[1] + 2 * (1 - t) * t * control[1] + t ** 2 * end[1]
		];
	});
	return {
		type: 'FeatureCollection',
		features: [
			{
				type: 'Feature',
				properties: {
					kind: 'historical_taxi_connection',
					pickup_zone: corridor.pickup_zone,
					dropoff_zone: corridor.dropoff_zone,
					ride_count: corridor.ride_count,
					label: `${new Intl.NumberFormat('en-GB').format(corridor.ride_count)} taxi records`,
					geometry_basis: 'schematic_centroid_connection'
				},
				geometry: { type: 'LineString', coordinates }
			},
			...[
				{ zone: corridor.pickup_zone, island: origin, point: start },
				{ zone: corridor.dropoff_zone, island: destination, point: end }
			].map(({ zone, island, point }) => ({
				type: 'Feature' as const,
				properties: {
					kind: 'historical_taxi_zone',
					zone,
					island_id: island.islandId,
					name: island.name
				},
				geometry: { type: 'Point' as const, coordinates: point }
			}))
		]
	};
}
