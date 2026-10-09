import type {
	MarineSnapshot,
	SampleGrid,
	SampleKind,
	WeatherSnapshot
} from '#lib/types/weather.ts';

export const WEATHER_ENDPOINT = '/api/weather';
export const MARINE_ENDPOINT = '/api/weather/marine';

async function get<T>(fetchFn: typeof fetch, url: string): Promise<T> {
	const response = await fetchFn(url);
	const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;
	if (!response.ok || !body) throw new Error(body?.error ?? `HTTP ${response.status}`);
	return body;
}

export const fetchWeather = (fetchFn: typeof fetch) =>
	get<WeatherSnapshot>(fetchFn, WEATHER_ENDPOINT);
export const fetchMarine = (fetchFn: typeof fetch) => get<MarineSnapshot>(fetchFn, MARINE_ENDPOINT);
export const fetchSamples = <K extends SampleKind>(fetchFn: typeof fetch, kind: K) =>
	get<SampleGrid<K extends 'weather' ? WeatherSnapshot : MarineSnapshot>>(
		fetchFn,
		`/api/weather/samples?kind=${kind}`
	);
