import type { FeatureCollection } from 'geojson';
import type { Coordinates } from './types.js';

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
