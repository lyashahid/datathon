import { createContext } from 'svelte';
import { WEATHER_CONFIG } from '#lib/config/weather.ts';
import { fetchMarine, fetchSamples, fetchWeather } from '#lib/data/weather.ts';
import type {
	MarineSnapshot,
	SampleGrid,
	SampleKind,
	WeatherSnapshot
} from '#lib/types/weather.ts';

export type WeatherStatus = 'idle' | 'loading' | 'ready' | 'partial' | 'unavailable';

/**
 * Live conditions for the HUD. Fetch failures are recorded, never thrown: the planning
 * simulator must keep working without weather.
 */
export class WeatherState {
	weather = $state.raw<WeatherSnapshot | null>(null);
	marine = $state.raw<MarineSnapshot | null>(null);
	status = $state<WeatherStatus>('idle');
	errors = $state.raw<readonly string[]>([]);

	/** Coarse forecast grids for the map views, fetched only when a view needs them. */
	weatherSamples = $state.raw<SampleGrid<WeatherSnapshot> | null>(null);
	marineSamples = $state.raw<SampleGrid<MarineSnapshot> | null>(null);
	sampleStatus = $state<Record<SampleKind, 'idle' | 'loading' | 'ready' | 'unavailable'>>({
		weather: 'idle',
		marine: 'idle'
	});
	#samplesFetchedAt: Record<SampleKind, number> = { weather: 0, marine: 0 };

	/** Loads a sample grid unless a fresh one is already held. Failures are recorded, not thrown. */
	async loadSamples(kind: SampleKind, fetchFn: typeof fetch = fetch): Promise<void> {
		const fresh = Date.now() - this.#samplesFetchedAt[kind] < WEATHER_CONFIG.clientRefreshMs;
		if (this.sampleStatus[kind] === 'loading' || (this.sampleStatus[kind] === 'ready' && fresh)) {
			return;
		}
		this.sampleStatus[kind] = 'loading';
		try {
			if (kind === 'weather') this.weatherSamples = await fetchSamples(fetchFn, 'weather');
			else this.marineSamples = await fetchSamples(fetchFn, 'marine');
			this.#samplesFetchedAt[kind] = Date.now();
			this.sampleStatus[kind] = 'ready';
		} catch {
			this.sampleStatus[kind] = 'unavailable';
		}
	}

	async refresh(fetchFn: typeof fetch = fetch): Promise<void> {
		if (this.status === 'idle') this.status = 'loading';
		const [weather, marine] = await Promise.allSettled([
			fetchWeather(fetchFn),
			fetchMarine(fetchFn)
		]);
		if (weather.status === 'fulfilled') this.weather = weather.value;
		if (marine.status === 'fulfilled') this.marine = marine.value;
		this.errors = [weather, marine]
			.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
			.map((r) => (r.reason instanceof Error ? r.reason.message : String(r.reason)));
		const ok = Number(this.weather !== null) + Number(this.marine !== null);
		this.status = ok === 2 ? 'ready' : ok === 1 ? 'partial' : 'unavailable';
	}

	/** Loads now and then periodically; returns a stop function. */
	start(fetchFn: typeof fetch = fetch): () => void {
		void this.refresh(fetchFn);
		const id = setInterval(() => void this.refresh(fetchFn), WEATHER_CONFIG.clientRefreshMs);
		return () => clearInterval(id);
	}
}

export const [getWeatherState, setWeatherState] = createContext<WeatherState>();
