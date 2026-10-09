import { WEATHER_CONFIG } from '#lib/config/weather.ts';
import type { Coordinates } from './provider.ts';

/** Reads ?lat=&lon= (falling back to the study-area centre); rejects out-of-range values. */
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
	if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
	return { latitude, longitude };
}
