/** Weather and marine data settings shared by server and client. */
export const WEATHER_CONFIG = {
	/** Default query point: central Malé (study-area centre). */
	defaultLocation: { latitude: 4.1755, longitude: 73.5093, label: 'Malé' },
	/** Server-side cache lifetime per provider + rounded location. */
	cacheTtlMs: 10 * 60 * 1000,
	/** Upstream request timeout. */
	fetchTimeoutMs: 6000,
	/** How often the HUD refreshes; the server cache absorbs repeated requests. */
	clientRefreshMs: 10 * 60 * 1000,
	/** Coordinates are rounded to this many decimals for cache keys (~1 km). */
	cacheKeyDecimals: 2
} as const;

/** WMO weather interpretation codes → short labels and icon groups. */
export type WeatherIconGroup = 'clear' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'storm';

export function describeWeatherCode(code: number | null): {
	label: string;
	group: WeatherIconGroup;
} {
	if (code === null) return { label: 'Unknown', group: 'cloud' };
	if (code === 0) return { label: 'Clear', group: 'clear' };
	if (code <= 2) return { label: 'Partly cloudy', group: 'cloud' };
	if (code === 3) return { label: 'Overcast', group: 'cloud' };
	if (code === 45 || code === 48) return { label: 'Fog', group: 'fog' };
	if (code >= 51 && code <= 57) return { label: 'Drizzle', group: 'drizzle' };
	if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82))
		return { label: 'Rain', group: 'rain' };
	if (code >= 95) return { label: 'Thunderstorm', group: 'storm' };
	return { label: 'Showers', group: 'rain' };
}

/**
 * Sample grid for the Rain / Wind / Marine views. Spacing matches the marine model's ~0.08°
 * resolution, so each cell shows one model value rather than implying finer detail.
 */
export const WEATHER_SAMPLE_GRID = {
	west: 73.38,
	south: 4.06,
	cols: 5,
	rows: 5,
	spacingDeg: 0.08
} as const;

export function buildSamplePoints(
	grid = WEATHER_SAMPLE_GRID
): { latitude: number; longitude: number }[] {
	const points = [];
	for (let r = 0; r < grid.rows; r++) {
		for (let c = 0; c < grid.cols; c++) {
			points.push({
				latitude: Number((grid.south + (r + 0.5) * grid.spacingDeg).toFixed(4)),
				longitude: Number((grid.west + (c + 0.5) * grid.spacingDeg).toFixed(4))
			});
		}
	}
	return points;
}

/** Douglas sea-state categories (WMO code 3700) by significant wave height in metres. */
export const SEA_STATES: readonly { label: string; minM: number; color: string }[] = [
	{ label: 'Calm', minM: 0, color: '#1e3a5f' },
	{ label: 'Smooth', minM: 0.1, color: '#2563eb' },
	{ label: 'Slight', minM: 0.5, color: '#22d3ee' },
	{ label: 'Moderate', minM: 1.25, color: '#facc15' },
	{ label: 'Rough', minM: 2.5, color: '#f97316' },
	{ label: 'Very rough', minM: 4, color: '#dc2626' },
	{ label: 'High', minM: 6, color: '#7f1d1d' }
];

export function classifySeaState(waveHeightM: number | null): string | null {
	if (waveHeightM === null) return null;
	let label = SEA_STATES[0].label;
	for (const s of SEA_STATES) if (waveHeightM >= s.minM) label = s.label;
	return label;
}
