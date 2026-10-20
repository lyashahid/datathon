import type { FeatureCollection } from 'geojson';
import { exploreJourneyFeatures } from './explore-journey.js';
import type { Coordinates, LandRoute } from './types.js';

export type SearchTravelMode = 'walk' | 'transit' | 'bicycle' | 'car';

export interface SearchDirectionPoint {
	id: string;
	name: string;
	coordinates: Coordinates | null;
	islandId?: string | null;
}

export interface SearchDirectionsRequest {
	points: Coordinates[];
	mode: SearchTravelMode;
	service_date?: string;
	departure_minutes: number;
}

export interface SearchDirectionsSegment {
	index: number;
	start: Coordinates;
	end: Coordinates;
	status: 'ok' | 'unreachable' | 'skipped';
	result: LandRoute | null;
	reason: string | null;
	service_date: string;
	departure_minutes: number | null;
	arrival_minutes: number | null;
	minutes: number | null;
	distance_m: number | null;
}

export interface SearchDirectionsResult {
	status: 'ok' | 'partial' | 'unreachable';
	reason: string | null;
	mode: SearchTravelMode;
	points: Coordinates[];
	segments: SearchDirectionsSegment[];
	service_date: string;
	timezone: string;
	departure_minutes: number;
	/** Minutes relative to service_date; may exceed 1440 after midnight. */
	arrival_minutes: number | null;
	distance_m: number | null;
	minutes: number | null;
	known_distance_m: number;
	known_minutes: number;
	warnings: string[];
}

/** An unfinished stop must not silently disappear from a mandatory ordered itinerary. */
export function searchDirectionsRequest(
	points: SearchDirectionPoint[],
	mode: SearchTravelMode,
	serviceDate: string,
	departureMinutes: number
): SearchDirectionsRequest | null {
	if (
		points.length < 2 ||
		points.length > 10 ||
		points.some(
			(point) =>
				!point.coordinates ||
				point.coordinates.length !== 2 ||
				!point.coordinates.every(Number.isFinite) ||
				Math.abs(point.coordinates[0]) > 180 ||
				Math.abs(point.coordinates[1]) > 90
		)
	)
		return null;
	if (mode === 'transit') {
		const parsedDate = new Date(`${serviceDate}T00:00:00Z`);
		if (
			!Number.isFinite(departureMinutes) ||
			departureMinutes < 0 ||
			departureMinutes >= 1440 ||
			!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate) ||
			serviceDate.startsWith('0000-') ||
			Number.isNaN(parsedDate.getTime()) ||
			parsedDate.toISOString().slice(0, 10) !== serviceDate
		)
			return null;
	}
	return {
		points: points.map((point) => [...point.coordinates!] as Coordinates),
		mode,
		...(mode === 'transit' ? { service_date: serviceDate } : {}),
		departure_minutes: mode === 'transit' ? departureMinutes : 0
	};
}

/** Draw each confirmed shape separately; neither failed stops nor missing service shapes are joined. */
export function searchDirectionsFeatures(result: SearchDirectionsResult | null): FeatureCollection {
	const features: FeatureCollection['features'] = [];
	for (const segment of result?.segments ?? []) {
		if (segment.status !== 'ok' || !segment.result) continue;
		if (segment.result.journey) {
			for (const feature of exploreJourneyFeatures(segment.result.journey).features) {
				features.push({
					...feature,
					properties: { ...feature.properties, segment_index: segment.index }
				});
			}
		} else if ((segment.result.geometry?.length ?? 0) > 1) {
			features.push({
				type: 'Feature',
				properties: {
					kind: 'journey-leg',
					mode: result!.mode,
					index: segment.index,
					segment_index: segment.index,
					route_name: ''
				},
				geometry: { type: 'LineString', coordinates: segment.result.geometry! }
			});
		}
	}
	return { type: 'FeatureCollection', features };
}
