import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Production assets and real API responses. The recovery check aborts one asset
// request to reproduce a transport failure; it never substitutes application data.
const baseURL = process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5173';
const output = path.resolve('artifacts/qa/code-visual-audit');
const client = path.resolve('.svelte-kit/output/client');
const manifest = JSON.parse(await readFile(path.join(client, '.vite/manifest.json'), 'utf8'));
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 60000 });
/** @type {{baseURL:string,startedAt:string,finishedAt?:string,checks:Array<{name:string,status:string,detail?:unknown}>,errors:string[],failure?:string}} */
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], errors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1000 },
	reducedMotion: 'reduce'
});
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.on('pageerror', (error) => report.errors.push(error.message));
/** @type {string[]} */
const requested = [];
page.on('request', (request) => requested.push(new URL(request.url()).pathname));
/** @param {string} name @param {()=>Promise<unknown>} work */
async function check(name, work) {
	console.log(`RUN ${name}`);
	try {
		const detail = await work();
		report.checks.push({ name, status: 'passed', detail });
		console.log(`PASS ${name}`);
	} catch (error) {
		report.checks.push({ name, status: 'failed', detail: String(error) });
		throw error;
	}
}
/** @param {string} name */
const workspace = (name) =>
	page
		.getByRole('navigation', { name: 'Workspace', exact: true })
		.getByRole('button', { name, exact: true });
/** @param {string} name */
const analytics = (name) =>
	page
		.getByRole('tablist', { name: 'Analytics workspace', exact: true })
		.getByRole('tab', { name, exact: true });
/** @param {string} name */
const tool = (name) =>
	page
		.getByRole('tablist', { name: 'Map workspace tools', exact: true })
		.getByRole('tab', { name, exact: true });
async function noOverflow() {
	const size = await page.evaluate(() => ({
		viewport: innerWidth,
		width: document.documentElement.scrollWidth
	}));
	assert.ok(size.width <= size.viewport + 1, JSON.stringify(size));
	return size;
}
async function visibleMapReady() {
	const proposalMap = page.getByRole('region', { name: 'Interactive proposal map' });
	if (await proposalMap.isVisible()) {
		await expect
			.poll(async () => Number(await proposalMap.getAttribute('data-rendered-hexes')))
			.toBeGreaterThan(0);
		await expect(proposalMap.locator('.planning-map-key')).toContainText(/street features/);
	}
	const locationMap = page.locator('.location-map:visible');
	if (await locationMap.count()) {
		await expect(locationMap.locator('.map-source')).toContainText(
			'OpenStreetMap streets & buildings'
		);
	}
	if (await page.locator('.national-map').isVisible()) {
		await expect(page.locator('.atlas-loading-status')).toBeHidden();
	}
	// Let MapLibre paint the loaded sources and complete the deferred resize.
	await page.evaluate(
		() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
	);
}
/** @param {string} component */
const componentFile = (component) => manifest[`src/lib/components/${component}.svelte`].file;
try {
	await check(
		'Cold dashboard loads its own workspace without map or planning code and requests',
		async () => {
			await page.goto(`${baseURL}/?view=overview&island=island%3A1442`);
			await expect(page.getByRole('region', { name: 'National analytics' })).toContainText(
				'1,561 island records'
			);
			await expect(page.locator('.analytics-dashboard')).toContainText('840');
			assert.ok(requested.includes(`/${componentFile('AnalyticsDashboard')}`));
			for (const name of [
				'PolicyWorkbench',
				'NationalMap',
				'PlaceWorkspace',
				'OperationsWorkspace',
				'ForecastWorkspace',
				'DataStudio',
				'EvidenceWorkspace'
			]) {
				assert.ok(
					!requested.includes(`/${componentFile(name)}`),
					`${name} was downloaded unnecessarily`
				);
			}
			assert.ok(!requested.some((url) => /\/planning\/|\/conditions\/|\/operations\//.test(url)));
			await noOverflow();
			await page.screenshot({ path: path.join(output, 'dashboard-desktop.png'), fullPage: true });
			return { deferredWorkspaces: 7, requests: requested.length };
		}
	);
	await check(
		'Visited dashboard preserves filters and does not repeat its API requests',
		async () => {
			await page.getByLabel('Analytics atoll', { exact: true }).selectOption('MLE');
			const calls = requested.filter((url) => url.endsWith('/accessibility/summary')).length;
			await analytics('Passenger outlook').click();
			await expect(
				page.getByRole('heading', { name: 'Passenger outlook', exact: true })
			).toBeVisible();
			await expect(page.locator('.forecast-workspace')).toContainText(
				/passenger movements|Passenger forecasts/i
			);
			await analytics('National dashboard').click();
			await expect(page.getByLabel('Analytics atoll', { exact: true })).toHaveValue('MLE');
			assert.equal(requested.filter((url) => url.endsWith('/accessibility/summary')).length, calls);
			assert.equal(
				requested.filter((url) => url === `/${componentFile('AnalyticsDashboard')}`).length,
				1
			);
			return { preservedAtoll: 'MLE', repeatedWorkspaceDownloads: 0 };
		}
	);
	await check(
		'All workspaces load on demand with one visible map and consistent navigation',
		async () => {
			await analytics('Data studio').click();
			await expect(
				page.getByRole('region', { name: 'Multi-dataset explorer and chart builder' })
			).toBeVisible();
			await noOverflow();
			await page.screenshot({ path: path.join(output, 'data-studio-desktop.png'), fullPage: true });
			await workspace('Evidence').click();
			await expect(
				page.getByRole('heading', { name: 'Evidence, with the edges visible.', exact: true })
			).toBeVisible();
			await noOverflow();
			await page.screenshot({ path: path.join(output, 'evidence-desktop.png'), fullPage: true });
			await workspace('Map & planning').click();
			await expect(page.locator('.national-map')).toBeVisible();
			await expect(page.locator('.national-map')).toHaveAttribute('data-active', 'true');
			await expect(page.locator('.national-map .maplibregl-canvas')).toBeVisible();
			await expect(
				page.getByRole('button', { name: 'Create proposal', exact: true })
			).toBeEnabled();
			await expect(page.locator('.atlas-loading-status')).toBeHidden();
			await visibleMapReady();
			await page.screenshot({ path: path.join(output, 'explore-desktop.png'), fullPage: false });
			await tool('Proposals').click();
			await expect(page.locator('.national-map')).toHaveAttribute('data-active', 'false');
			await expect(page.locator('.national-map')).toHaveAttribute(
				'data-movement-transition',
				'false'
			);
			await expect(page.getByRole('region', { name: 'Interactive proposal map' })).toBeVisible();
			assert.equal(await page.locator('.maplibregl-canvas:visible').count(), 1);
			await expect(page.getByRole('heading', { name: 'Proposal map', exact: true })).toBeVisible();
			await visibleMapReady();
			await noOverflow();
			await page.screenshot({ path: path.join(output, 'proposals-desktop.png'), fullPage: false });
			await tool('Live').click();
			await expect(page.locator('.operations-workspace')).toBeVisible();
			await expect(
				page.getByRole('region', { name: 'Weather forecast location map' })
			).toBeVisible();
			assert.equal(await page.locator('.maplibregl-canvas:visible').count(), 1);
			await visibleMapReady();
			await noOverflow();
			await tool('Places & directions').click();
			await expect(page.getByRole('region', { name: 'Place discovery map' })).toBeVisible();
			assert.equal(await page.locator('.maplibregl-canvas:visible').count(), 1);
			await visibleMapReady();
			await noOverflow();
			return { workspacesChecked: 7, simultaneousVisibleMaps: 1 };
		}
	);
	await check(
		'Mobile navigation and main workspaces fit 390 pixels without horizontal page overflow',
		async () => {
			await page.setViewportSize({ width: 390, height: 844 });
			/** @type {Array<[string, () => Promise<void>]>} */
			const views = [
				['explore', async () => tool('Explore').click()],
				['proposals', async () => tool('Proposals').click()],
				['conditions', async () => tool('Live').click()],
				['places', async () => tool('Places & directions').click()],
				['evidence', async () => workspace('Evidence').click()],
				[
					'dashboard',
					async () => {
						await workspace('Analytics').click();
						await analytics('National dashboard').click();
					}
				],
				['passengers', async () => analytics('Passenger outlook').click()],
				['data-studio', async () => analytics('Data studio').click()]
			];
			for (const [name, open] of views) {
				await open();
				if (['explore', 'proposals', 'conditions', 'places'].includes(name)) {
					await visibleMapReady();
				}
				await noOverflow();
				await page.screenshot({ path: path.join(output, `${name}-mobile.png`), fullPage: true });
			}
			const navFont = await workspace('Analytics').evaluate((element) =>
				parseFloat(getComputedStyle(element).fontSize)
			);
			assert.ok(navFont >= 10, `Navigation font is too small: ${navFont}`);
			return { viewport: '390×844', workspaces: views.length, navigationFont: navFont };
		}
	);
	await check(
		'A failed workspace asset has a clear recovery action that reloads the selected workspace',
		async () => {
			const recovery = await context.newPage();
			recovery.on('pageerror', (error) => report.errors.push(error.message));
			let blocked = false;
			await recovery.route('**/ForecastWorkspace.*.css', async (route) => {
				blocked = true;
				await route.abort('failed');
			});
			await recovery.goto(`${baseURL}/?view=overview&analytics=passengers&island=island%3A1442`);
			await expect(recovery.getByRole('alert')).toContainText('passenger outlook could not load');
			assert.ok(blocked);
			await recovery.unroute('**/ForecastWorkspace.*.css');
			await recovery.getByRole('button', { name: 'Reload workspace', exact: true }).click();
			await expect(
				recovery.getByRole('heading', { name: 'Passenger outlook', exact: true })
			).toBeVisible();
			assert.equal(new URL(recovery.url()).searchParams.get('analytics'), 'passengers');
			await recovery.close();
			return { recovered: true, retainedRoute: 'passengers' };
		}
	);
	await check('Production route is split into smaller workspace assets', async () => {
		const key = '.svelte-kit/generated/build/client-optimized/nodes/2.js';
		const before = JSON.parse(await readFile(path.join(output, 'bundle-before.json'), 'utf8'));
		/** @type {Set<string>} */
		const seen = new Set();
		/** @param {string} name */
		function visit(name) {
			if (seen.has(name)) return;
			seen.add(name);
			for (const dependency of manifest[name]?.imports || []) visit(dependency);
		}
		visit(key);
		const files = [...seen]
			.map((name) => manifest[name])
			.filter(Boolean)
			.map((item) => item.file);
		const contents = await Promise.all(files.map((file) => readFile(path.join(client, file))));
		const route = await readFile(path.join(client, manifest[key].file));
		const after = {
			routeChunk: manifest[key].file,
			routeBytes: route.length,
			routeGzip: gzipSync(route).length,
			staticDependencyClosure: contents.reduce(
				(sum, buffer) => ({
					bytes: sum.bytes + buffer.length,
					gzip: sum.gzip + gzipSync(buffer).length
				}),
				{ bytes: 0, gzip: 0 }
			),
			files
		};
		assert.ok(
			after.routeBytes < before.routeBytes * 0.3,
			'The route bundle has not improved sufficiently'
		);
		assert.ok(after.staticDependencyClosure.bytes < before.staticDependencyClosure.bytes);
		const measurement = {
			before,
			after,
			routeReductionPercent: 100 * (1 - after.routeBytes / before.routeBytes),
			scope:
				'Route module and static JavaScript dependencies only; active workspace, layout, MapLibre and workers are additional.'
		};
		await writeFile(
			path.join(output, 'bundle-comparison.json'),
			JSON.stringify(measurement, null, 2)
		);
		return measurement;
	});
	assert.deepEqual(report.errors, []);
} catch (error) {
	report.failure = error instanceof Error ? error.stack : String(error);
	process.exitCode = 1;
} finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
	await browser.close();
}
