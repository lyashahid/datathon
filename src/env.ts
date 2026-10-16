import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	PUBLIC_BASE_PATH: {
		public: true,
		static: true,
		schema: (value) => value || ''
	},
	VELA_API_KEY: { schema: (value) => value || '' },
	MOBILITY_BACKEND_URL: {
		schema: (value) => {
			const url = new URL(value || 'http://127.0.0.1:8000');
			if (!['http:', 'https:'].includes(url.protocol))
				throw new Error('MOBILITY_BACKEND_URL must be an HTTP URL.');
			return url.origin;
		}
	}
});
