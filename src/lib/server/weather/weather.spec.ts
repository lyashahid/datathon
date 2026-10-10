import { describe, expect, it } from 'vitest';
import {
	buildSamplePoints,
	classifySeaState,
	WEATHER_CONFIG,
	WEATHER_SAMPLE_GRID
} from '#lib/config/weather.ts';
import { coordinatesFrom } from './coordinates.ts';
import {
	createOpenMeteoProvider,
	normalizeMarine,
	normalizeSamples,
	normalizeWeather,
	toUtcIso
} from './openMeteo.ts';
import { withCache, type WeatherProvider } from './provider.ts';
import { WeatherProviderError } from './types.ts';

const AT = { latitude: 4.1755, longitude: 73.5093 };

const FORECAST = {
	latitude: 4.18,
	longitude: 73.54,
	utc_offset_seconds: 18000,
	current: {
		time: '2026-10-09T21:30',
		temperature_2m: 27.6,
		precipitation: 0.1,
		wind_speed_10m: 3.5,
		wind_direction_10m: 242,
		weather_code: 51,
		visibility: 6860
	}
};
const MARINE = {
	latitude: 4.2,
	longitude: 73.54,
	utc_offset_seconds: 18000,
	current: { time: '2026-10-09T21:30', wave_height: 0.66, wave_direction: 132, wave_period: 8.65 }
};

const respond = (body: unknown, status = 200) =>
	(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('Open-Meteo normalisation', () => {
	it('maps the forecast into a WeatherSnapshot with a UTC timestamp', () => {
		const w = normalizeWeather(FORECAST, AT);
		expect(w).toMatchObject({
			timestamp: '2026-10-09T16:30:00.000Z',
			temperatureC: 27.6,
			precipitationMm: 0.1,
			windSpeedKph: 3.5,
			windDirectionDeg: 242,
			visibilityKm: 6.86,
			weatherCode: 51,
			source: { providerId: 'open-meteo', name: 'Open-Meteo' }
		});
	});

	it('maps marine data into a MarineSnapshot', () => {
		expect(normalizeMarine(MARINE, AT)).toMatchObject({
			waveHeightM: 0.66,
			waveDirectionDeg: 132,
			wavePeriodSeconds: 8.65
		});
	});

	it('turns missing or malformed fields into nulls rather than failing', () => {
		const w = normalizeWeather(
			{ current: { time: '2026-10-09T21:30', temperature_2m: 'hot' } },
			AT
		);
		expect(w.temperatureC).toBeNull();
		expect(w.windSpeedKph).toBeNull();
		expect(w.visibilityKm).toBeNull();
		expect(w.latitude).toBe(AT.latitude);
	});

	it('rejects a response without current conditions', () => {
		expect(() => normalizeWeather({}, AT)).toThrow(WeatherProviderError);
		expect(() => normalizeMarine(null, AT)).toThrow(WeatherProviderError);
	});

	it('converts local times with or without seconds', () => {
		expect(toUtcIso('2026-10-09T21:30', 18000)).toBe('2026-10-09T16:30:00.000Z');
		expect(toUtcIso('2026-10-09T21:30:15', 18000)).toBe('2026-10-09T16:30:15.000Z');
		expect(toUtcIso(undefined, 0)).toBeNull();
	});
});

describe('provider failure handling', () => {
	it('wraps network errors, HTTP errors and bad JSON as WeatherProviderError', async () => {
		const offline = createOpenMeteoProvider((async () => {
			throw new TypeError('fetch failed');
		}) as unknown as typeof fetch);
		await expect(offline.getWeather(AT)).rejects.toThrow(WeatherProviderError);
		await expect(createOpenMeteoProvider(respond({}, 500)).getMarine(AT)).rejects.toThrow(
			'HTTP 500'
		);
		const garbage = (async () =>
			new Response('<html>', { status: 200 })) as unknown as typeof fetch;
		await expect(createOpenMeteoProvider(garbage).getWeather(AT)).rejects.toThrow('invalid JSON');
	});

	it('normalises a successful live-shaped response end to end', async () => {
		await expect(createOpenMeteoProvider(respond(FORECAST)).getWeather(AT)).resolves.toMatchObject({
			temperatureC: 27.6
		});
	});
});

describe('withCache', () => {
	function counting(fail = false): WeatherProvider & { calls: number } {
		const p = {
			id: 'test',
			calls: 0,
			async getWeather() {
				p.calls++;
				if (fail) throw new Error('down');
				return normalizeWeather(FORECAST, AT);
			},
			async getMarine() {
				p.calls++;
				return normalizeMarine(MARINE, AT);
			},
			async getWeatherSamples() {
				throw new Error('unused');
			},
			async getMarineSamples() {
				throw new Error('unused');
			}
		};
		return p;
	}

	it('serves repeat requests from cache until the TTL expires', async () => {
		let t = 0;
		const inner = counting();
		const cached = withCache(inner, 1000, () => t);
		await cached.getWeather(AT);
		await cached.getWeather({ latitude: 4.17551, longitude: 73.50931 });
		expect(inner.calls).toBe(1);
		t = 1500;
		await cached.getWeather(AT);
		expect(inner.calls).toBe(2);
	});

	it('stays bounded: the oldest entry is dropped at the cap', async () => {
		const inner = counting();
		const cached = withCache(inner, 1000, () => 0, 2);
		const at = (lat: number) => ({ latitude: lat, longitude: 73.5 });
		await cached.getWeather(at(4.1));
		await cached.getWeather(at(4.2));
		await cached.getWeather(at(4.3)); // evicts 4.1
		await cached.getWeather(at(4.2)); // still cached
		expect(inner.calls).toBe(3);
		await cached.getWeather(at(4.1)); // reloaded after eviction
		expect(inner.calls).toBe(4);
	});

	it('does not cache failures', async () => {
		const inner = counting(true);
		const cached = withCache(inner, 1000, () => 0);
		await expect(cached.getWeather(AT)).rejects.toThrow('down');
		// Let the eviction handler attached to the failed promise run.
		await new Promise((resolve) => setTimeout(resolve, 0));
		await expect(cached.getWeather(AT)).rejects.toThrow('down');
		expect(inner.calls).toBe(2);
	});
});

describe('coordinatesFrom', () => {
	it('defaults to the study-area centre and validates input', () => {
		expect(coordinatesFrom(new URL('http://x/api/weather'))).toEqual({
			latitude: WEATHER_CONFIG.defaultLocation.latitude,
			longitude: WEATHER_CONFIG.defaultLocation.longitude
		});
		expect(coordinatesFrom(new URL('http://x/api/weather?lat=4.2&lon=73.5'))).toEqual({
			latitude: 4.2,
			longitude: 73.5
		});
		expect(coordinatesFrom(new URL('http://x/api/weather?lat=abc&lon=1'))).toBeNull();
		expect(coordinatesFrom(new URL('http://x/api/weather?lat=95&lon=1'))).toBeNull();
		// Outside the app's map bounds: not a general-purpose weather proxy.
		expect(coordinatesFrom(new URL('http://x/api/weather?lat=51.5&lon=-0.1'))).toBeNull();
	});
});

describe('sample grids', () => {
	it('builds a regular grid of points at the configured spacing', () => {
		const points = buildSamplePoints();
		expect(points).toHaveLength(WEATHER_SAMPLE_GRID.cols * WEATHER_SAMPLE_GRID.rows);
		expect(points[1].longitude - points[0].longitude).toBeCloseTo(
			WEATHER_SAMPLE_GRID.spacingDeg,
			6
		);
	});

	it('aligns multi-location results with requested points and nulls bad entries', () => {
		const points = [AT, { latitude: 4.3, longitude: 73.6 }];
		const grid = normalizeSamples([MARINE, { nonsense: true }], points, 'marine', normalizeMarine);
		expect(grid.samples.map((s) => s.latitude)).toEqual([AT.latitude, 4.3]);
		expect(grid.samples[0].snapshot?.waveHeightM).toBe(0.66);
		expect(grid.samples[1].snapshot).toBeNull();
		expect(grid.validAt).toBe('2026-10-09T16:30:00.000Z');
	});

	it('accepts a single-object response and rejects a grid with no data at all', () => {
		expect(normalizeSamples(FORECAST, [AT], 'weather', normalizeWeather).samples).toHaveLength(1);
		expect(() => normalizeSamples([{}, {}], [AT, AT], 'weather', normalizeWeather)).toThrow(
			WeatherProviderError
		);
	});

	it('classifies sea state by wave height', () => {
		expect(classifySeaState(0.05)).toBe('Calm');
		expect(classifySeaState(0.66)).toBe('Slight');
		expect(classifySeaState(3)).toBe('Rough');
		expect(classifySeaState(null)).toBeNull();
	});
});
