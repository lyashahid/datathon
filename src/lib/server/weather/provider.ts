import { WEATHER_CONFIG } from '#lib/config/weather.ts';
import { openMeteoProvider } from './openMeteo.ts';
import type { MarineSnapshot, SampleGrid, WeatherSnapshot } from '#lib/types/weather.ts';

export interface Coordinates {
	latitude: number;
	longitude: number;
}

/**
 * A weather source. Open-Meteo is the first implementation; an official Maldives
 * Meteorological Service adapter can implement the same interface and be selected via
 * WEATHER_PROVIDER without any UI change.
 */
export interface WeatherProvider {
	id: string;
	getWeather(at: Coordinates): Promise<WeatherSnapshot>;
	getMarine(at: Coordinates): Promise<MarineSnapshot>;
	/** Many points in one request, for the coarse map views. Order matches `points`. */
	getWeatherSamples(points: readonly Coordinates[]): Promise<SampleGrid<WeatherSnapshot>>;
	getMarineSamples(points: readonly Coordinates[]): Promise<SampleGrid<MarineSnapshot>>;
}

const PROVIDERS: Readonly<Record<string, WeatherProvider>> = {
	[openMeteoProvider.id]: openMeteoProvider
};

export function resolveProvider(id: string | undefined): WeatherProvider {
	return (id && PROVIDERS[id]) || openMeteoProvider;
}

interface CacheEntry<T> {
	expires: number;
	value: Promise<T>;
}

/**
 * Wraps a provider with an in-memory TTL cache keyed by provider, kind and rounded location.
 * The in-flight promise is cached, so simultaneous requests share one upstream call; failures
 * are evicted immediately so the next request retries.
 */
export function withCache(
	provider: WeatherProvider,
	ttlMs: number = WEATHER_CONFIG.cacheTtlMs,
	now: () => number = Date.now
): WeatherProvider {
	const cache = new Map<string, CacheEntry<unknown>>();
	const round = (at: Coordinates) =>
		`${at.latitude.toFixed(WEATHER_CONFIG.cacheKeyDecimals)},${at.longitude.toFixed(WEATHER_CONFIG.cacheKeyDecimals)}`;

	function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
		const k = `${provider.id}:${key}`;
		const hit = cache.get(k) as CacheEntry<T> | undefined;
		if (hit && hit.expires > now()) return hit.value;
		const value = load();
		cache.set(k, { expires: now() + ttlMs, value });
		value.catch(() => cache.delete(k));
		return value;
	}

	return {
		id: provider.id,
		getWeather: (at) => cached(`weather:${round(at)}`, () => provider.getWeather(at)),
		getMarine: (at) => cached(`marine:${round(at)}`, () => provider.getMarine(at)),
		getWeatherSamples: (points) =>
			cached(`weather-samples:${points.map(round).join(';')}`, () =>
				provider.getWeatherSamples(points)
			),
		getMarineSamples: (points) =>
			cached(`marine-samples:${points.map(round).join(';')}`, () =>
				provider.getMarineSamples(points)
			)
	};
}
