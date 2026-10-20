/** Real Vela consumer-adapter contracts; missing provider fields remain optional. */
export interface PlaceCoordinates {
	latitude: number;
	longitude: number;
}
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
export function placesQuery(values: Record<string, string | number | null | undefined>): string {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(values)) {
		if (value !== null && value !== undefined) query.set(key, String(value));
	}
	return query.toString();
}
