import { MAP_MAX_BOUNDS } from '#lib/config/map.ts';
import { WEATHER_CONFIG } from '#lib/config/weather.ts';
import type { Coordinates } from './provider.ts';

/**
 * Reads ?lat=&lon= (falling back to the study-area centre). Only coordinates inside the app's
 * map bounds are accepted, so the endpoint cannot be used as a general weather proxy.
 */
export function coordinatesFrom(url: URL): Coordinates | null {
	const lat = url.searchParams.get('lat');
	const lon = url.searchParams.get('lon');
	if (lat === null && lon === null) {
		const { latitude, longitude } = WEATHER_CONFIG.defaultLocation;
		return { latitude, longitude };
	}
	const latitude = Number(lat);
	const longitude = Number(lon);
	if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
	const [[west, south], [east, north]] = MAP_MAX_BOUNDS;
	if (latitude < south || latitude > north || longitude < west || longitude > east) return null;
	return { latitude, longitude };
}
