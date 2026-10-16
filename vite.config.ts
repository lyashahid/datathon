import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
	// Match SvelteKit's public static value, including mode-specific .env configuration.
	const basePath = loadEnv(mode, process.cwd(), 'PUBLIC_BASE_PATH').PUBLIC_BASE_PATH || '';
	if (basePath && !/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(basePath))
		throw new Error(
			'PUBLIC_BASE_PATH must be empty or a path such as /apps/datathon, without a trailing slash.'
		);

	return {
		// Runtime captures and QA outputs are not frontend source; changes must not reload the map.
		server: {
			watch: { ignored: ['**/backend/**', '**/artifacts/**', '**/legacy/**', '**/scripts/**'] }
		},
		// MapLibre starts its worker as an ES module.
		worker: { format: 'es' },
		plugins: [
			tailwindcss(),
			sveltekit({
				paths: { base: basePath as '' | `/${string}` },
				compilerOptions: {
					// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
					runes: ({ filename }) =>
						filename.split(/[/\\]/).includes('node_modules') ? undefined : true
				},

				// Standalone production server with precompressed, content-hashed assets.
				adapter: adapter({ precompress: true })
			})
		],
		test: {
			expect: { requireAssertions: true },
			projects: [
				{
					extends: './vite.config.ts',
					test: {
						name: 'server',
						environment: 'node',
						include: ['src/**/*.{test,spec}.{js,ts}'],
						exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
					}
				}
			]
		}
	};
});
