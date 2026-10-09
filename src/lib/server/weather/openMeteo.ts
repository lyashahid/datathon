import { WEATHER_CONFIG } from '#lib/config/weather.ts';
import type { Coordinates, WeatherProvider } from './provider.ts';
import { WEATHER_SAMPLE_GRID } from '#lib/config/weather.ts';
import type { SampleGrid } from '#lib/types/weather.ts';
import {
	WeatherProviderError,
	type DataSourceAttribution,
	type MarineSnapshot,
	type WeatherSnapshot
} from './types.ts';

const ID = 'open-meteo';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const MARINE_URL = 'https://marine-api.open-meteo.com/v1/marine';

const SOURCE: DataSourceAttribution = {
	providerId: ID,
	name: 'Open-Meteo',
	url: 'https://open-meteo.com/',
	kind: 'forecast'
};

type Json = Record<string, unknown>;

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Open-Meteo returns local wall-clock time plus an offset; convert to an ISO UTC instant. */
export function toUtcIso(localTime: unknown, utcOffsetSeconds: unknown): string | null {
	if (typeof localTime !== 'string') return null;
	// "2026-10-09T21:30" has no seconds; "2026-10-09T21:30:15" does. Parse either as UTC first.
	const withSeconds = /T\d{2}:\d{2}$/.test(localTime) ? `${localTime}:00` : localTime;
	const asUtc = Date.parse(`${withSeconds}Z`);
	if (Number.isNaN(asUtc)) return null;
	return new Date(asUtc - (num(utcOffsetSeconds) ?? 0) * 1000).toISOString();
}

function current(body: unknown): { current: Json; body: Json } {
	if (typeof body !== 'object' || body === null)
		throw new WeatherProviderError(ID, 'empty response');
	const json = body as Json;
	if (typeof json.current !== 'object' || json.current === null) {
		throw new WeatherProviderError(ID, 'response has no current conditions');
	}
	return { current: json.current as Json, body: json };
}

export function normalizeWeather(body: unknown, at: Coordinates): WeatherSnapshot {
	const { current: c, body: json } = current(body);
	const visibilityM = num(c.visibility);
	return {
		timestamp: toUtcIso(c.time, json.utc_offset_seconds) ?? new Date(0).toISOString(),
		latitude: num(json.latitude) ?? at.latitude,
		longitude: num(json.longitude) ?? at.longitude,
		temperatureC: num(c.temperature_2m),
		precipitationMm: num(c.precipitation),
		windSpeedKph: num(c.wind_speed_10m),
		windDirectionDeg: num(c.wind_direction_10m),
		visibilityKm: visibilityM === null ? null : visibilityM / 1000,
		weatherCode: num(c.weather_code),
		source: SOURCE
	};
}

export function normalizeMarine(body: unknown, at: Coordinates): MarineSnapshot {
	const { current: c, body: json } = current(body);
	return {
		timestamp: toUtcIso(c.time, json.utc_offset_seconds) ?? new Date(0).toISOString(),
		latitude: num(json.latitude) ?? at.latitude,
		longitude: num(json.longitude) ?? at.longitude,
		waveHeightM: num(c.wave_height),
		waveDirectionDeg: num(c.wave_direction),
		wavePeriodSeconds: num(c.wave_period),
		source: SOURCE
	};
}

async function getJson(url: string, fetchFn: typeof fetch): Promise<unknown> {
	let response: Response;
	try {
		response = await fetchFn(url, { signal: AbortSignal.timeout(WEATHER_CONFIG.fetchTimeoutMs) });
	} catch (error) {
		throw new WeatherProviderError(ID, error instanceof Error ? error.message : 'network error');
	}
	if (!response.ok) throw new WeatherProviderError(ID, `HTTP ${response.status}`);
	try {
		return await response.json();
	} catch {
		throw new WeatherProviderError(ID, 'invalid JSON');
	}
}

/**
 * Normalises a multi-location response (an array, or a single object for one point) into a
 * sample grid aligned with the requested points. Points without data become null samples.
 */
export function normalizeSamples<T extends { timestamp: string }>(
	body: unknown,
	points: readonly Coordinates[],
	kind: 'weather' | 'marine',
	normalize: (item: unknown, at: Coordinates) => T
): SampleGrid<T> {
	const items = Array.isArray(body) ? body : [body];
	const samples = points.map((at, i) => {
		let snapshot: T | null;
		try {
			snapshot = normalize(items[i], at);
		} catch {
			// One bad point leaves a gap rather than failing the whole grid.
			snapshot = null;
		}
		return { latitude: at.latitude, longitude: at.longitude, snapshot };
	});
	if (samples.every((s) => s.snapshot === null)) {
		throw new WeatherProviderError(ID, 'no sample points returned data');
	}
	return {
		kind,
		spacingDeg: WEATHER_SAMPLE_GRID.spacingDeg,
		samples,
		source: SOURCE,
		validAt: samples.find((s) => s.snapshot)?.snapshot?.timestamp ?? null
	};
}

/** Open-Meteo: free, keyless forecast and marine APIs (attribution required). */
export function createOpenMeteoProvider(fetchFn: typeof fetch = fetch): WeatherProvider {
	const query = (at: Coordinates, current: string) =>
		new URLSearchParams({
			latitude: String(at.latitude),
			longitude: String(at.longitude),
			current,
			timezone: 'auto'
		});
	const multi = (points: readonly Coordinates[], current: string) =>
		new URLSearchParams({
			latitude: points.map((p) => p.latitude).join(','),
			longitude: points.map((p) => p.longitude).join(','),
			current,
			timezone: 'auto'
		});
	return {
		id: ID,
		async getWeatherSamples(points) {
			const params = multi(points, 'precipitation,wind_speed_10m,wind_direction_10m,weather_code');
			params.set('wind_speed_unit', 'kmh');
			const body = await getJson(`${FORECAST_URL}?${params}`, fetchFn);
			return normalizeSamples(body, points, 'weather', normalizeWeather);
		},
		async getMarineSamples(points) {
			const params = multi(points, 'wave_height,wave_direction,wave_period');
			const body = await getJson(`${MARINE_URL}?${params}`, fetchFn);
			return normalizeSamples(body, points, 'marine', normalizeMarine);
		},
		async getWeather(at) {
			const params = query(
				at,
				'temperature_2m,precipitation,wind_speed_10m,wind_direction_10m,weather_code,visibility'
			);
			params.set('wind_speed_unit', 'kmh');
			return normalizeWeather(await getJson(`${FORECAST_URL}?${params}`, fetchFn), at);
		},
		async getMarine(at) {
			const params = query(at, 'wave_height,wave_direction,wave_period');
			return normalizeMarine(await getJson(`${MARINE_URL}?${params}`, fetchFn), at);
		}
	};
}

export const openMeteoProvider = createOpenMeteoProvider();
