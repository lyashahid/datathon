/** Real Vela consumer-adapter contracts; missing provider fields remain optional. */
export interface PlaceCoordinates {
	latitude: number;
	longitude: number;
}
export type ConsumerCoordinates = PlaceCoordinates;
export interface ConsumerPlace {
	id: string;
	name: string;
	location: PlaceCoordinates;
	feature_id?: string | null;
	place_id?: string | null;
	address?: string | null;
	category?: string | null;
	rating?: number | null;
	review_count?: number | null;
	phone?: string | null;
	website?: string | null;
	open_now?: boolean | null;
	status_text?: string | null;
	hours?: string[];
	photo_urls?: string[];
	permanently_closed?: boolean;
	temporarily_closed?: boolean;
	completeness?: string;
	[key: string]: unknown;
}
export interface ConsumerMeta {
	request_id: string;
	provider: string;
	calibration_version: number;
	cached: boolean;
	warnings: string[];
}
export interface ConsumerEnvelope<T> {
	data: T;
	meta: ConsumerMeta;
}
export interface ConsumerSearch {
	query: string;
	places: ConsumerPlace[];
	next_offset?: number | null;
	focus?: ConsumerPlace | null;
	completeness: string;
}
export interface ConsumerSuggestions {
	query: string;
	places: ConsumerPlace[];
	queries: string[];
	completeness: string;
}
export interface ConsumerPhoto {
	url: string;
	posted_text?: string | null;
	category?: string | null;
}
export interface ConsumerPhotos {
	photos: ConsumerPhoto[];
	next_token?: string | null;
	completeness: string;
}
export interface ConsumerReview {
	id?: string | null;
	author: string;
	rating?: number | null;
	relative_time?: string | null;
	text?: string | null;
	photos: string[];
}
export interface ConsumerReviews {
	reviews: ConsumerReview[];
	next_token?: string | null;
	end?: boolean | null;
	completeness: string;
	backend: 'native' | 'browser';
	pagination_verified: boolean;
	returned_before_limit?: number;
	truncated_by_limit?: boolean;
	settled?: boolean;
	[key: string]: unknown;
}
export interface ConsumerRoute {
	source: string;
	summary?: string | null;
	distance_meters?: number | null;
	typical_seconds?: number | null;
	traffic_seconds?: number | null;
	geometry?: { type: 'LineString'; coordinates: number[][] } | null;
	geometry_available: boolean;
	guidance_available: boolean;
	steps: {
		instruction: string;
		distance_meters?: number | null;
		maneuver?: string | null;
		road_names?: string[];
	}[];
	[key: string]: unknown;
}
export interface ConsumerDirections {
	routes: ConsumerRoute[];
	mode: 'driving' | 'walking' | 'bicycling';
	completeness: string;
}
export interface ConsumerPanorama {
	pano_id: string;
	latitude: number;
	longitude: number;
	heading_degrees: number;
	tile_size: number;
	max_zoom: number;
	level_dimensions: { width: number; height: number }[];
	address_label?: string | null;
	copyright?: string | null;
	capture_year?: number | null;
	capture_month?: number | null;
	neighbors: {
		pano_id: string;
		latitude: number;
		longitude: number;
		bearing_degrees: number;
		distance_meters: number;
	}[];
	history: { pano_id: string; year: number; month: number }[];
}

export function placesQuery(values: Record<string, string | number | null | undefined>): string {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(values)) {
		if (value !== null && value !== undefined) query.set(key, String(value));
	}
	return query.toString();
}
