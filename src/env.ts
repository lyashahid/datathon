import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	MAP_STYLE_URL: {
		public: true,
		description:
			'Optional MapLibre style JSON URL. Tried first; the built-in keyless basemaps are used if it is unset or fails.',
		schema: (value) => {
			const trimmed = value?.trim();
			if (!trimmed) return undefined;
			if (!URL.canParse(trimmed)) throw new Error('MAP_STYLE_URL must be an absolute URL');
			return trimmed;
		}
	},
	BASELINE_SOURCE: {
		description:
			"Infrastructure/routes compatibility endpoints: 'public' (default), 'sample' (demo), or 'processed' (fixture ingestion). The atlas always uses the public planning bundle.",
		schema: (value) => {
			const v = value?.trim() || 'public';
			if (v !== 'sample' && v !== 'processed' && v !== 'public') {
				throw new Error("BASELINE_SOURCE must be 'public', 'sample' or 'processed'");
			}
			return v;
		}
	},
	ENABLE_VESSEL_DATA: {
		description: 'Enable dated FollowMe vessel and MPL port-call context. Default true.',
		schema: (value) => parseDataFlag(value, 'ENABLE_VESSEL_DATA')
	},
	ENABLE_FLIGHT_PASSENGER_DATA: {
		description: 'Enable official MACL / MBS airport passenger context. Default true.',
		schema: (value) => parseDataFlag(value, 'ENABLE_FLIGHT_PASSENGER_DATA')
	},
	FOLLOWME_API_KEY: {
		description: 'Optional issued FollowMe API key. Server-only; never sent to the browser.',
		schema: (value) => value?.trim() || undefined
	},
	WEATHER_PROVIDER: {
		description:
			"Server-side weather provider id. Defaults to 'open-meteo' (keyless). Future official adapters register under their own id.",
		schema: (value) => value?.trim() || undefined
	}
});

function parseDataFlag(value: string | undefined, name: string): boolean {
	const normalized = value?.trim().toLowerCase() || 'true';
	if (normalized !== 'true' && normalized !== 'false')
		throw new Error(`${name} must be true or false`);
	return normalized === 'true';
}
