import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '@playwright/test';

// Fresh contexts measure a first visitor; reloads measure persistent browser reuse.
// Backend stays warm in both cases. Real requests, sources, geometry and WebGL only.
const baseURL = process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5173';
const label = process.argv[2] || 'current';
assert.match(label, /^[a-zA-Z0-9_-]+$/, 'Choose a simple benchmark label.');
const output = path.resolve('artifacts/qa/site-performance');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
/** @type {{baseURL:string,label:string,measuredAt:string,method:string,routes:Array<Record<string,unknown>>}} */
const report = {
	baseURL,
	label,
	measuredAt: new Date().toISOString(),
	method:
		'1440x1000 Chromium, reduced motion, software WebGL, warm real backend. Cold browser contexts followed by one reload in each context. No throttling or mocks. Screenshot work excluded from ready time.',
	routes: []
};
try {
	for (const [name, query] of [
		['country', '?view=map'],
		['island', '?view=map&island=island%3A1442'],
		['analytics', '?view=overview']
	]) {
		const context = await browser.newContext({
			viewport: { width: 1440, height: 1000 },
			reducedMotion: 'reduce'
		});
		try {
			const page = await context.newPage();
			/** @type {Array<Record<string,unknown>>} */
			let requests = [];
			/** @type {string[]} */
			let errors = [];
			page.on('pageerror', (error) => errors.push(error.message));
			page.on('response', (response) => {
				if (!response.url().includes('/api/backend/')) return;
				const url = new URL(response.url());
				requests.push({
					path: url.pathname + url.search,
					status: response.status(),
					timing: response.request().timing()
				});
			});
			await page.addInitScript(() => {
				Reflect.set(window, '__longTasks', []);
				new PerformanceObserver((list) => {
					Reflect.get(window, '__longTasks').push(
						...list
							.getEntries()
							.map((entry) => ({ start: entry.startTime, duration: entry.duration }))
					);
				}).observe({ type: 'longtask', buffered: true });
			});
			for (const phase of ['cold', 'warm']) {
				requests = [];
				errors = [];
				const started = performance.now();
				if (phase === 'cold')
					await page.goto(`${baseURL}/${query}`, { waitUntil: 'domcontentloaded' });
				else await page.reload({ waitUntil: 'domcontentloaded' });
				const domReadyMs = Math.round(performance.now() - started);
				let canvasMs = null;
				let geographyMs = null;
				let scoreMs = null;
				if (name !== 'analytics') {
					await page.locator('.maplibregl-canvas').waitFor({ timeout: 90000 });
					canvasMs = Math.round(performance.now() - started);
					await page.waitForFunction(
						() => document.querySelector('.national-map')?.getAttribute('aria-busy') === 'false',
						undefined,
						{ timeout: 90000 }
					);
					geographyMs = Math.round(performance.now() - started);
					await page.waitForFunction(
						() =>
							document
								.querySelector('.country-accessibility-explorer')
								?.getAttribute('aria-busy') === 'false',
						undefined,
						{ timeout: 90000 }
					);
					scoreMs = Math.round(performance.now() - started);
				} else {
					await page.waitForFunction(
						() =>
							document
								.querySelector('[aria-label="Policy priorities"]')
								?.getAttribute('aria-busy') === 'false',
						undefined,
						{ timeout: 90000 }
					);
				}
				const readyMs = Math.round(performance.now() - started);
				await page.screenshot({ path: path.join(output, `${label}-${name}-${phase}.png`) });
				const metrics = await page.evaluate(() => ({
					resources: performance.getEntriesByType('resource').map((entry) => ({
						name: entry.name.replace(location.origin, ''),
						start: entry.startTime,
						duration: entry.duration,
						bytes: Reflect.get(entry, 'encodedBodySize'),
						transferred: Reflect.get(entry, 'transferSize'),
						decodedBytes: Reflect.get(entry, 'decodedBodySize')
					})),
					paints: performance
						.getEntriesByType('paint')
						.map((entry) => ({ name: entry.name, start: entry.startTime })),
					longTasks: /** @type {Array<{start:number,duration:number}>} */ (
						Reflect.get(window, '__longTasks')
					)
				}));
				const longTaskMs = Math.round(
					metrics.longTasks.reduce((sum, task) => sum + task.duration, 0)
				);
				report.routes.push({
					name,
					phase,
					domReadyMs,
					canvasMs,
					geographyMs,
					scoreMs,
					readyMs,
					longTaskMs,
					requests,
					errors,
					...metrics
				});
				console.log(
					JSON.stringify({
						name,
						phase,
						domReadyMs,
						canvasMs,
						geographyMs,
						scoreMs,
						readyMs,
						requests: requests.length,
						longTaskMs,
						errors
					})
				);
				assert.deepEqual(errors, [], `${name} ${phase} must not have runtime errors`);
			}
		} finally {
			await context.close();
		}
	}
} finally {
	await browser.close();
	await writeFile(path.join(output, `${label}.json`), JSON.stringify(report, null, 2));
}
