import type { FeatureCollection } from 'geojson';
import type { Coordinates } from './types.js';

export type JourneyPlace = {
	id: string;
	name: string;
	coordinates: Coordinates;
	category?: string;
	stopRole?: 'platform' | 'stop_position';
	stopCode?: string | null;
	direction?: string | null;
	operatorStop?: boolean;
};

/** One suggestion per place, while retaining distinct boarding sides and operator stops. */
export function deduplicateJourneyPlaces(places: JourneyPlace[]): JourneyPlace[] {
	const normalize = (value: string | null | undefined) =>
		(value ?? '').trim().toLocaleLowerCase().replaceAll(/\s+/g, ' ');
	const family = (place: JourneyPlace) =>
		place.stopRole ? 'bus_stop' : normalize(place.category).replaceAll(' ', '_');
	const retained: JourneyPlace[] = [];
	for (const place of [...places].sort(
		(a, b) => Number(!!b.operatorStop) - Number(!!a.operatorStop)
	)) {
		const duplicate = retained.some((other) => {
			if (other.id === place.id) return true;
			if (normalize(other.name) !== normalize(place.name) || family(other) !== family(place))
				return false;
			if (other.operatorStop && place.operatorStop) return false;
			if (
				other.stopCode &&
				place.stopCode &&
				normalize(other.stopCode) !== normalize(place.stopCode)
			)
				return false;
			if (
				other.direction &&
				place.direction &&
				normalize(other.direction) !== normalize(place.direction)
			)
				return false;
			const latitude = ((other.coordinates[1] + place.coordinates[1]) * Math.PI) / 360;
			const distance = Math.hypot(
				(other.coordinates[0] - place.coordinates[0]) * 111320 * Math.cos(latitude),
				(other.coordinates[1] - place.coordinates[1]) * 111320
			);
			// Coordinate rounding can duplicate a platform; its roadway stop position is a nearby alias.
			return (
				distance <= 2 ||
				(distance <= 18 &&
					!!other.stopRole &&
					!!place.stopRole &&
					other.stopRole !== place.stopRole)
			);
		});
		if (!duplicate) retained.push(place);
	}
	return retained;
}

export interface JourneyPoint {
	id: string;
	name: string;
	coordinates: Coordinates;
	island_id?: string | null;
	operator_code?: string | null;
}
export interface JourneyLeg {
	mode: 'walk' | 'wait' | 'bus' | 'ferry';
	from: JourneyPoint;
	to: JourneyPoint;
	minutes: number;
	departure_minutes: number;
	arrival_minutes: number;
	distance_m?: number | null;
	route_id?: string;
	route_name?: string;
	pattern_id?: string;
	trip_id?: string;
	stops: (JourneyPoint & { arrival_minutes: number; departure_minutes: number })[];
	geometry: Coordinates[];
	geometry_source?: string;
	geometry_warning?: string | null;
	provenance?: string;
}
export interface ExploreJourney {
	status: 'reachable' | 'unavailable';
	reason: string | null;
	service_date: string;
	snapshot_date: string | null;
	timezone: string;
	departure_minutes: number;
	arrival_minutes: number | null;
	minutes: number | null;
	walk_minutes: number;
	wait_minutes: number;
	ride_minutes: number;
	uses_transit: boolean;
	active_service_count: number;
	legs: JourneyLeg[];
	stops: (JourneyPoint & { roles: ('board' | 'alight')[] })[];
	warnings: string[];
	source_receipts: { path: string; sha256: string; bytes: number }[];
}

/** Keep missing service geometry as a gap rather than joining across it. */
export function exploreJourneyFeatures(journey: ExploreJourney | null): FeatureCollection {
	return {
		type: 'FeatureCollection',
		features: (journey?.legs ?? []).flatMap((leg, index) =>
			leg.geometry.length > 1
				? [
						{
							type: 'Feature' as const,
							properties: {
								kind: 'journey-leg',
								mode: leg.mode,
								index,
								route_name: leg.route_name ?? ''
							},
							geometry: { type: 'LineString' as const, coordinates: leg.geometry }
						}
					]
				: []
		)
	};
}

/** Schedule times can extend after midnight; keep that day offset visible. */
export function journeyClock(minutes: number | null | undefined): string {
	if (minutes == null || !Number.isFinite(minutes)) return 'Unavailable';
	const rounded = Math.round(minutes);
	const day = Math.floor(rounded / 1440);
	const clock = ((rounded % 1440) + 1440) % 1440;
	const time = `${Math.floor(clock / 60)
		.toString()
		.padStart(2, '0')}:${(clock % 60).toString().padStart(2, '0')}`;
	return day > 0 ? `${time} (+${day} day${day > 1 ? 's' : ''})` : time;
}
