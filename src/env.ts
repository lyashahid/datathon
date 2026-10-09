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
	WEATHER_PROVIDER: {
		description:
			"Server-side weather provider id. Defaults to 'open-meteo' (keyless). Future official adapters register under their own id.",
		schema: (value) => value?.trim() || undefined
	}
});
