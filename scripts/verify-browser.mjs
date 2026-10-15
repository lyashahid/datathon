import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Uses real frontend/backend responses. One startup regression delays geometry delivery;
// no response payloads are mocked or replaced.
const baseURL = process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5173';
const expect = playwrightExpect.configure({ timeout: 30000 });
const output = path.resolve('artifacts/qa/ui-ux-redesign');
await mkdir(output, { recursive: true });
/** @type {{baseURL: string, startedAt: string, finishedAt?: string, checks: Array<{name: string, status: string, milliseconds: number, detail?: unknown, message?: string}>, errors: Array<{type: string, message: string}>, api: Record<string, unknown>, failure?: {message: string, stack?: string}}} */
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], errors: [], api: {} };
const browser = await chromium.launch({
	headless: true,
	args: ['--enable-unsafe-swiftshader']
});
const context = await browser.newContext({
	viewport: { width: 1440, height: 1000 },
	reducedMotion: 'reduce',
	acceptDownloads: true
});
context.setDefaultTimeout(60000);
const page = await context.newPage();
/** @type {Set<string>} */
const workerURLs = new Set();
page.on('worker', (worker) => workerURLs.add(worker.url()));
page.on('pageerror', (error) => report.errors.push({ type: 'pageerror', message: error.message }));
page.on('console', (message) => {
	if (message.type() === 'error') report.errors.push({ type: 'console', message: message.text() });
});
let liveRequests = 0;
page.on('request', (request) => {
	if (request.url().includes('/api/backend/live/snapshot')) liveRequests += 1;
});
/** @type {import('../src/lib/types').MapFeatures} */
let mapData = { type: 'FeatureCollection', features: [] };
let male = { properties: { id: '', name: '', atoll: '', centroid: [0, 0] } };

/** @param {string} name @param {() => Promise<unknown>} work */
async function check(name, work) {
	const start = Date.now();
	console.log(`RUN ${name}`);
	try {
		const detail = await work();
		report.checks.push({ name, status: 'passed', milliseconds: Date.now() - start, detail });
		console.log(`PASS ${name}`);
	} catch (error) {
		report.checks.push({
			name,
			status: 'failed',
			milliseconds: Date.now() - start,
			message: error instanceof Error ? error.message : String(error)
		});
		throw error;
	}
}
/** @param {string} fragment */
function responseFor(fragment) {
	const pending = page.waitForResponse(
		(response) =>
			decodeURIComponent(response.url()).includes(`/api/backend/${decodeURIComponent(fragment)}`) &&
			response.request().method() !== 'OPTIONS',
		{ timeout: 90000 }
	);
	// Navigation may fail before the matching request starts; avoid orphaned rejections.
	pending.catch(() => {});
	return pending;
}
/** @param {string} name */
async function tab(name) {
	const workspace =
		name === 'Overview'
			? 'Analytics'
			: ['Planning map', 'Proposals', 'Live movement'].includes(name)
				? 'Map & planning'
				: name;
	await page
		.getByRole('navigation', { name: 'Workspace' })
		.getByRole('button', { name: workspace, exact: true })
		.click();
	if (['Planning map', 'Proposals', 'Live movement'].includes(name)) {
		await page
			.getByRole('tablist', { name: 'Map workspace tools' })
			.getByRole('tab', {
				name: name === 'Planning map' ? 'Explore' : name === 'Proposals' ? 'Proposals' : 'Live',
				exact: true
			})
			.click();
		await page
			.getByRole('tab', {
				name:
					name === 'Planning map'
						? 'Island & streets'
						: name === 'Proposals'
							? 'Infrastructure edits'
							: 'Vehicle movement',
				exact: true
			})
			.click();
	}
}
/** @param {string} name */
async function searchIsland(name) {
	const input = page.getByRole('textbox', { name: 'Search islands' });
	const dialog = page.getByRole('dialog', { name: 'Find an island', exact: true });
	if (!(await page.locator('.island-search-sheet[data-state="open"]').count()))
		await page.getByRole('button', { name: 'Find an island or atoll', exact: false }).click();
	await expect(dialog).toHaveAttribute('data-state', 'open');
	await input.fill(name);
}
/** @param {string} name */
async function contextTab(name) {
	await page.locator('.detail-panel').getByRole('tab', { name, exact: true }).click();
	await expect(page.getByRole('tabpanel', { name, exact: true })).toBeVisible();
}
/** @param {string} filename */
async function exportScreening(filename) {
	const pending = page.waitForEvent('download');
	await page.getByRole('button', { name: 'Export table', exact: true }).click();
	const downloaded = await pending;
	const file = path.join(output, filename);
	await downloaded.saveAs(file);
	const contents = await readFile(file, 'utf8');
	// CSV export quotes every field; retain embedded commas and doubled quotes.
	const rows = contents
		.trim()
		.split(/\r?\n/)
		.map((line) =>
			[...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map((match) => match[1].replaceAll('""', '"'))
		);
	return { rows, filename: downloaded.suggestedFilename() };
}
/** @param {string} name @param {number} fractionX @param {number} fractionY */
async function pick(name, fractionX, fractionY) {
	await page.getByRole('button', { name, exact: true }).click();
	await expect(page.locator('.national-map')).toHaveClass(/is-picking/);
	const canvas = page.locator('.maplibregl-canvas');
	await canvas.scrollIntoViewIfNeeded();
	const box = await canvas.boundingBox();
	assert.ok(box, 'Map canvas has a usable bounding box');
	await page.mouse.click(box.x + box.width * fractionX, box.y + box.height * fractionY);
	await expect(page.locator('.national-map')).not.toHaveClass(/is-picking/);
}
/** @param {number} width @param {string} view */
async function noOverflow(width, view) {
	const dimensions = await page.evaluate(() => {
		const attribution = document.querySelector('.maplibregl-ctrl-attrib')?.getBoundingClientRect();
		const dock = document.querySelector('.map-action-dock')?.getBoundingClientRect();
		return {
			width: document.documentElement.clientWidth,
			scrollWidth: document.documentElement.scrollWidth,
			bodyWidth: document.body.scrollWidth,
			panels: [...document.querySelectorAll('.detail-panel, .context-card, .context-tab-content')]
				.filter((element) => element.getBoundingClientRect().width > 0)
				.map((element) => ({
					name: element.className,
					width: element.clientWidth,
					scrollWidth: element.scrollWidth
				})),
			attributionOverlapsActions: !!(
				attribution &&
				dock &&
				attribution.left < dock.right &&
				attribution.right > dock.left &&
				attribution.top < dock.bottom &&
				attribution.bottom > dock.top
			)
		};
	});
	assert.ok(
		dimensions.scrollWidth <= dimensions.width + 1 && dimensions.bodyWidth <= dimensions.width + 1,
		`${width}px ${view} overflows: ${JSON.stringify(dimensions)}`
	);
	assert.ok(
		dimensions.panels.every((panel) => panel.scrollWidth <= panel.width + 1),
		`${width}px ${view} clips panel content: ${JSON.stringify(dimensions.panels)}`
	);
	assert.equal(
		dimensions.attributionOverlapsActions,
		false,
		`${width}px ${view} action dock overlaps source attribution`
	);
	return dimensions;
}

try {
	await check('Real backend loading and dedicated national overview', async () => {
		const healthResponse = await context.request.get(`${baseURL}/api/backend/health`);
		assert.equal(
			healthResponse.status(),
			200,
			'The frontend health proxy reaches the real backend'
		);
		report.api.health = await healthResponse.json();
		const summaryResponse = responseFor('national/summary');
		const mapResponse = responseFor('map/features?layer=all');
		await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
		const summary = await (await summaryResponse).json();
		assert.equal((await mapResponse).status(), 200);
		// The 38 MB geometry response exceeds Chromium's inspector body cache.
		// Read expected island records through the real API request context instead.
		const islandResponse = await context.request.get(
			`${baseURL}/api/backend/map/features?layer=islands`
		);
		assert.ok(islandResponse.ok());
		mapData = await islandResponse.json();
		assert.equal(summary.island_count, 1561);
		assert.equal(summary.facility_count, 840);
		report.api.national = summary;
		const found = mapData.features.find(
			(feature) =>
				/^(mal[eé]|male.? city)$/i.test(feature.properties?.name || '') &&
				feature.properties?.id?.startsWith('island:')
		);
		assert.ok(found?.properties, 'The supplied cache contains Malé');
		male = {
			properties: {
				id: String(found.properties.id),
				name: String(found.properties.name),
				atoll: String(found.properties.atoll),
				centroid: found.properties.centroid
			}
		};
		await expect(page.locator('.connection')).toHaveText('Data connected');
		await expect(
			page.getByRole('heading', { name: 'See the bigger picture.', exact: true })
		).toBeVisible();
		await expect(page.locator('.analytics-dashboard')).toHaveAttribute('aria-busy', 'false');
		await expect(page.locator('.footprint-card')).toContainText('1,561 islands');
		await expect(page.locator('.inventory-metric strong')).toHaveText('840');
		await expect(page.locator('.map-workspace')).toBeHidden();
		return {
			island: male.properties.id,
			name: male.properties.name,
			geometryFeatures: mapData.features.length
		};
	});
	await check(
		'Overview aggregation, chart filters, screening search and complete CSV export',
		async () => {
			await expect(page.locator('.gauge-value strong')).toHaveText('20%');
			await expect(page.locator('.gauge-value')).toContainText('172 of 840 records');
			await expect(
				page
					.locator('.mini-card')
					.filter({ has: page.getByRole('heading', { name: 'Unassigned records', exact: true }) })
			).toContainText('349');
			await expect(page.locator('.access-metric strong')).toHaveText('1.9');
			await expect(page.locator('.distribution-count').first()).toHaveText('1,466');
			await expect(page.locator('.atoll-bar')).toHaveCount(8);
			const full = await exportScreening('national-island-screening.csv');
			assert.equal(
				full.rows.length,
				1562,
				'CSV includes all 1,561 islands, beyond the eight visible rows'
			);
			assert.ok(
				full.rows.slice(1).every((row) => row[1].trim()),
				'Every exported island has an identifiable name, including unnamed source records'
			);
			const maleRow = full.rows.find((row) => row[0] === male.properties.id);
			assert.ok(maleRow);
			assert.equal(maleRow[4], '24');
			const currentProfile = await (
				await context.request.get(
					`${baseURL}/api/backend/islands/${encodeURIComponent(male.properties.id)}/profile`
				)
			).json();
			assert.equal(
				Number(maleRow[6]),
				currentProfile.accessibility.score,
				'National screening and island profile must use the same census-derived score'
			);
			await page.getByRole('button', { name: 'Next analytics page', exact: true }).click();
			await expect(page.locator('.table-footer')).toContainText('9–16 of 1,561 islands');
			await page.getByRole('button', { name: 'Previous analytics page', exact: true }).click();
			await page.getByRole('button', { name: 'Island', exact: true }).click();
			await expect(page.locator('.screening-card th').first()).toHaveAttribute(
				'aria-sort',
				'ascending'
			);
			await page.getByLabel('Island screening filter').selectOption('airport');
			const airports = await exportScreening('airport-island-screening.csv');
			assert.equal(airports.rows.length, 18, '17 islands have assigned airport records');
			await page.getByLabel('Island screening filter').selectOption('all');
			await page.getByLabel('Analytics atoll').selectOption(male.properties.atoll);
			await expect(page.locator('.inventory-metric strong')).toHaveText('41');
			await expect(page.locator('.gauge-value strong')).toHaveText('59%');
			const atollRows = await exportScreening('male-atoll-screening.csv');
			assert.equal(atollRows.rows.length, 4);
			assert.equal(
				atollRows.rows.slice(1).reduce((sum, row) => sum + Number(row[4]), 0),
				41
			);
			await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
			await page.locator('.atoll-bar').first().click();
			await expect(page.getByLabel('Analytics atoll')).not.toHaveValue('all');
			await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
			await page.getByRole('button', { name: 'Facilities', exact: true }).click();
			await page.evaluate(() => window.scrollTo(0, 0));
			await page.screenshot({ path: path.join(output, 'desktop-overview.png'), fullPage: true });
			await page.getByLabel('Search analytics islands').fill('no-island-matches-this-query-qa');
			await expect(page.locator('.table-empty')).toContainText('No islands match these filters');
			await expect(page.getByRole('button', { name: 'Export table', exact: true })).toBeDisabled();
			await page.getByLabel('Search analytics islands').fill(male.properties.name);
			await expect(
				page.locator(`tr[data-analytics-island-id="${male.properties.id}"]`)
			).toContainText('24');
			await page
				.getByRole('button', { name: 'Explain analytics methodology', exact: true })
				.click();
			await expect(
				page.getByRole('heading', { name: 'Read these numbers with their sources.', exact: true })
			).toBeVisible();
			await page.getByRole('button', { name: 'Close', exact: true }).click();
			await page.evaluate(() => window.scrollTo(0, 0));
			await page.screenshot({
				path: path.join(output, 'desktop-overview-screening.png'),
				fullPage: true
			});
			report.api.analytics = {
				nationalRows: full.rows.length - 1,
				atollRows: atollRows.rows.length - 1,
				atollFacilities: 41,
				airportIslands: airports.rows.length - 1,
				locatedRecords: 172,
				totalRecords: 840,
				unassignedRecords: 349,
				zeroScores: 1466
			};
			return report.api.analytics;
		}
	);
	await check('Exact overview-to-map island handoff and rendered geometry', async () => {
		await page
			.getByRole('button', { name: `Explore ${male.properties.name} on map`, exact: true })
			.click();
		const profileResponse = await context.request.get(
			`${baseURL}/api/backend/islands/${encodeURIComponent(male.properties.id)}/profile`
		);
		assert.equal(profileResponse.status(), 200);
		const profile = await profileResponse.json();
		assert.equal(profile.island.id, male.properties.id);
		report.api.profile = {
			total: profile.population.total,
			facilityCount: profile.infrastructure.total,
			score: profile.accessibility.score
		};
		await expect(page.locator('.context-location')).toContainText(male.properties.name);
		await expect(page.locator('.detail-panel h2:visible')).toHaveText(male.properties.name);
		await expect(page.getByRole('heading', { name: 'Accessibility', exact: true })).toBeVisible();
		await expect(page.locator('.analytics-page')).toBeHidden();
		await expect(page.locator('.maplibregl-canvas')).toBeVisible();
		await expect(page.locator('.national-map')).toHaveAttribute('aria-busy', 'false');
		await expect(page.getByText('Preparing map', { exact: true })).toHaveCount(0);
		await expect(page.getByText('Interactive map unavailable', { exact: true })).toHaveCount(0);
		await expect(page.locator('.island-map-label')).toHaveText(male.properties.name);
		await noOverflow(1440, 'Planning map');
		await expect.poll(() => workerURLs.size).toBeGreaterThan(0);
		const mapWorkerURL = [...workerURLs].find((url) => url.includes('maplibre'));
		assert.ok(mapWorkerURL, 'MapLibre started its bundled worker');
		const workerResponse = await context.request.get(mapWorkerURL);
		assert.equal(workerResponse.status(), 200, 'The bundled map worker is accessible');
		report.api.mapWorker = { url: mapWorkerURL, status: workerResponse.status() };
		await page.screenshot({ path: path.join(output, 'desktop-planning-map.png') });
		return {
			island: male.properties.id,
			name: male.properties.name,
			geometryFeatures: mapData.features.length
		};
	});
	await check('Island search, atoll filter, empty result and selection', async () => {
		const trigger = page.getByRole('button', { name: 'Find an island or atoll', exact: false });
		await trigger.focus();
		await page.keyboard.press('Enter');
		await expect(page.getByRole('dialog', { name: 'Find an island', exact: true })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog', { name: 'Find an island', exact: true })).toBeHidden();
		await expect(trigger).toBeFocused();
		await searchIsland('no-island-matches-this-query-qa');
		await expect(page.getByText('No islands match this search.', { exact: true })).toBeVisible();
		await searchIsland('');
		await page.getByLabel('Filter by atoll').selectOption(male.properties.atoll);
		const expected = mapData.features.filter(
			(feature) =>
				feature.properties?.id?.startsWith('island:') &&
				feature.properties.atoll === male.properties.atoll
		).length;
		await expect(page.locator('.list-heading')).toContainText(
			`${expected.toLocaleString('en')} islands`
		);
		await page.getByLabel('Filter by atoll').selectOption('');
		await searchIsland(male.properties.name);
		await page.locator(`.island-list button[data-island-id="${male.properties.id}"]`).click();
		assert.equal(new URL(page.url()).searchParams.get('island'), male.properties.id);
		await expect(page.locator('.context-location')).toContainText(male.properties.name);
		await expect(page.getByRole('heading', { name: 'Accessibility', exact: true })).toBeVisible();
		return { atoll: male.properties.atoll, islandCount: expected };
	});
	await check('Browser history restores the exact selected island', async () => {
		assert.equal(new URL(page.url()).searchParams.get('island'), male.properties.id);
		await searchIsland('Hulhumalé');
		const changed = responseFor('islands/island:1442/profile');
		await page.locator('.island-list button[data-island-id="island:1442"]').click();
		assert.equal((await (await changed).json()).island.id, 'island:1442');
		assert.equal(new URL(page.url()).searchParams.get('island'), 'island:1442');
		const restored = responseFor(`islands/${male.properties.id}/profile`);
		await page.goBack();
		assert.equal((await (await restored).json()).island.id, male.properties.id);
		await expect(page.locator('.detail-panel h2:visible')).toHaveText(male.properties.name);
		assert.equal(new URL(page.url()).searchParams.get('island'), male.properties.id);
		await expect(page.locator('.national-map')).toHaveAttribute('aria-busy', 'false');
	});
	await check(
		'Map layer controls, coordinate picking and real shortest-path geometry',
		async () => {
			const layersTrigger = page.getByRole('button', { name: /^Layers/ });
			await layersTrigger.focus();
			await page.keyboard.press('Enter');
			for (const name of ['Facilities', 'Transport']) {
				const button = page.locator('.map-layer-row').filter({ hasText: name });
				await expect(button).toHaveAttribute('aria-pressed', 'true');
				await button.click();
				await expect(button).toHaveAttribute('aria-pressed', 'false');
				await button.click();
				await expect(button).toHaveAttribute('aria-pressed', 'true');
			}
			await page.keyboard.press('Escape');
			await expect(page.getByRole('region', { name: 'Map layers', exact: true })).toBeHidden();
			await expect(layersTrigger).toBeFocused();
			await page.getByRole('tab', { name: 'Island baseline', exact: true }).focus();
			await page.keyboard.press('ArrowRight');
			await expect(page.getByRole('tab', { name: 'Plan a route', exact: true })).toHaveAttribute(
				'aria-selected',
				'true'
			);
			await expect(page.getByRole('tabpanel', { name: 'Plan a route', exact: true })).toBeVisible();
			assert.equal(new URL(page.url()).searchParams.get('profile'), 'route');
			await page.goBack();
			await expect(
				page.getByRole('tabpanel', { name: 'Island baseline', exact: true })
			).toBeVisible();
			await page.goForward();
			await expect(page.getByRole('tabpanel', { name: 'Plan a route', exact: true })).toBeVisible();
			await page.getByRole('button', { name: 'Choose start', exact: true }).click();
			await expect(page.locator('.national-map')).toHaveClass(/is-picking/);
			await expect(page.locator('.pick-banner')).toContainText('Escape to cancel');
			await page.keyboard.press('Escape');
			await expect(page.locator('.national-map')).not.toHaveClass(/is-picking/);
			await expect(page.locator('.coordinate-readout')).toContainText('Start: Click on map');
			await page.getByRole('button', { name: 'Choose start', exact: true }).click();
			await expect(page.locator('.maplibregl-canvas')).toBeFocused();
			await page.keyboard.press('Enter');
			await expect(page.locator('.national-map')).not.toHaveClass(/is-picking/);
			await expect(page.getByRole('button', { name: 'Change start', exact: true })).toBeFocused();
			await pick('Change start', 0.43, 0.57);
			await pick('Choose end', 0.67, 0.61);
			await expect(page.locator('.coordinate-readout')).not.toContainText('Click on map');
			const routed = responseFor('routing/land');
			await page.getByRole('button', { name: 'Find shortest path', exact: true }).click();
			const route = await (await routed).json();
			assert.equal(route.status, 'ok');
			assert.ok(route.distance_m > 0);
			assert.ok(route.geometry.length > 1, 'A real line is returned');
			assert.ok(route.path_node_ids.length > 1);
			await expect(page.locator('.route-result')).toContainText(
				`${Math.round(route.distance_m).toLocaleString('en')} m`
			);
			await page.getByText('Graph node IDs', { exact: true }).click();
			await expect(page.getByText(route.path_node_ids[0], { exact: true })).toBeVisible();
			report.api.route = route;
			await page.screenshot({ path: path.join(output, 'desktop-route.png') });
			await page
				.getByRole('button', { name: 'Explore a walking connection', exact: false })
				.click();
			await expect(page.getByLabel('Your intervention')).toHaveValue('pedestrian_connection');
			await page
				.getByRole('button', { name: 'Use the planned route’s endpoints', exact: true })
				.click();
			await expect(page.getByLabel('From graph node ID')).toHaveValue(route.path_node_ids[0]);
			await expect(page.getByLabel('To graph node ID')).toHaveValue(route.path_node_ids.at(-1));
			await tab('Planning map');
			return {
				distanceM: route.distance_m,
				nodes: route.path_node_ids.length,
				geometryPoints: route.geometry.length
			};
		}
	);
	await check('Add bus stop, simulation +1, undo/redo and reference comparison', async () => {
		await contextTab('Island baseline');
		await page.getByRole('button', { name: 'Test a proposal here', exact: false }).click();
		await expect(
			page
				.getByRole('navigation', { name: 'Workspace' })
				.getByRole('button', { name: 'Map & planning', exact: true })
		).toHaveAttribute('aria-current', 'page');
		await contextTab('Build option');
		await page.getByLabel('Your intervention').selectOption('add_bus_stop');
		await expect(page.locator('.context-location')).toContainText(male.properties.name);
		await expect(page.locator('.operation-row')).toHaveCount(0);
		await page.getByLabel('Option name').fill('QA Malé stop option');
		await contextTab('Review results');
		await page.getByRole('button', { name: 'Save as comparison reference', exact: true }).click();
		await contextTab('Build option');
		await page.getByText('Enter coordinates or use island centroid', { exact: true }).click();
		await page.getByRole('button', { name: 'Use island centroid', exact: true }).click();
		await expect(page.getByLabel('Proposal longitude')).toHaveValue(
			String(male.properties.centroid[0])
		);
		await page.getByRole('button', { name: 'Add to option', exact: true }).click();
		await expect(page.locator('.operation-row')).toHaveCount(1);
		await page.getByRole('button', { name: 'Undo operation', exact: true }).click();
		await expect(page.locator('.operation-row')).toHaveCount(0);
		await page.getByRole('button', { name: 'Redo operation', exact: true }).click();
		await expect(page.locator('.operation-row')).toHaveCount(1);
		const simulated = responseFor('simulation/run');
		await page.getByRole('button', { name: 'Run simulation', exact: true }).click();
		const result = await (await simulated).json();
		await expect(page.getByRole('tab', { name: 'Review results', exact: true })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		assert.equal(result.delta.transport_feature_count, 1);
		assert.equal(result.operations_applied.length, 1);
		await expect(page.locator('.simulation-result')).toContainText('1 of 1 operations applied');
		await expect(
			page.locator('.simulation-result .metric-row').filter({ hasText: 'transport feature count' })
		).toContainText('+1');
		const compared = responseFor('simulation/compare');
		await page
			.getByRole('button', { name: 'Compare current option with reference', exact: true })
			.click();
		const comparison = await (await compared).json();
		assert.equal(comparison.delta.first_vs_second_transport_features, 1);
		await expect(page.getByText('Current minus reference', { exact: true })).toBeVisible();
		report.api.simulation = result;
		report.api.comparison = comparison.delta;
		const briefPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'Export decision brief', exact: true }).click();
		const briefDownload = await briefPromise;
		const briefPath = path.join(output, 'decision-brief.json');
		await briefDownload.saveAs(briefPath);
		const brief = JSON.parse(await readFile(briefPath, 'utf8'));
		assert.equal(brief.island.id, male.properties.id);
		assert.equal(brief.simulation.delta.transport_feature_count, 1);
		assert.equal(brief.reference.operations.length, 0);
		assert.match(brief.measurement_scope, /not recalculated/);
		await noOverflow(1440, 'Proposal review');
		await page.screenshot({ path: path.join(output, 'desktop-proposal-review.png') });
		return {
			operations: result.operations_applied.length,
			delta: result.delta,
			comparison: comparison.delta
		};
	});
	await check(
		'Shared island, proposal, reference and results survive the decision journey',
		async () => {
			await tab('Overview');
			await expect(page.locator('.map-workspace')).toBeHidden();
			await expect(page.getByLabel('Search analytics islands')).toHaveValue(male.properties.name);
			await tab('Planning map');
			await expect(page.locator('.context-location')).toContainText(male.properties.name);
			await tab('Proposals');
			await contextTab('Review results');
			await expect(page.locator('.simulation-result')).toContainText('1 of 1 operations applied');
			await expect(page.getByText('Current minus reference', { exact: true })).toBeVisible();
			await page
				.getByRole('button', { name: 'Review sources and limitations', exact: false })
				.click();
			await expect(page.locator('.map-workspace')).toBeHidden();
			await expect(
				page.getByRole('button', { name: 'Export decision brief', exact: false })
			).toBeEnabled();
			await page.getByRole('button', { name: 'Back to planning map', exact: false }).click();
			await expect(page.locator('.context-location')).toContainText(male.properties.name);
			await tab('Proposals');
			await contextTab('Build option');
			await expect(page.getByLabel('Option name')).toHaveValue('QA Malé stop option');
			await expect(page.locator('.operation-row')).toHaveCount(1);
		}
	);
	await check('Scenario download, valid import, rejected import and persistence', async () => {
		await contextTab('Build option');
		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'Export scenario', exact: true }).click();
		const download = await downloadPromise;
		const exportPath = path.join(output, 'exported-scenario.json');
		await download.saveAs(exportPath);
		const exported = JSON.parse(await readFile(exportPath, 'utf8'));
		assert.equal(exported.name, 'QA Malé stop option');
		assert.equal(exported.operations[0].type, 'add_bus_stop');
		await page.getByRole('button', { name: 'Remove operation 1', exact: true }).click();
		await expect(page.locator('.operation-row')).toHaveCount(0);
		await page.locator('.detail-panel input[type=file]').setInputFiles(exportPath);
		await expect(page.locator('.operation-row')).toHaveCount(1);
		await expect(page.getByRole('status').filter({ hasText: 'Scenario imported' })).toBeVisible();
		await page.locator('.detail-panel input[type=file]').setInputFiles({
			name: 'invalid.json',
			mimeType: 'application/json',
			buffer: Buffer.from('{"name":"Invalid"}')
		});
		await expect(page.getByRole('alert')).toContainText('scenario JSON');
		await expect(page.locator('.operation-row')).toHaveCount(1);
		for (const invalidOperation of [
			{ type: 'add_bus_stop', coordinates: ['73.5', 4.2] },
			{ type: 'add_bus_stop', coordinates: [null, 4.2] },
			{ type: ['add_bus_stop'], coordinates: [73.5, 4.2] }
		]) {
			await page.locator('.detail-panel input[type=file]').setInputFiles({
				name: 'invalid-operation.json',
				mimeType: 'application/json',
				buffer: Buffer.from(JSON.stringify({ ...exported, operations: [invalidOperation] }))
			});
			await expect(page.getByRole('alert')).toContainText(
				Array.isArray(invalidOperation.type) ? 'Unknown scenario operation' : 'Coordinates must'
			);
			await expect(page.locator('.operation-row')).toHaveCount(1);
			await expect(page.getByLabel('Option name')).toHaveValue(exported.name);
		}
		const restoredProfile = responseFor(`islands/${male.properties.id}/profile`);
		await page.reload({ waitUntil: 'domcontentloaded' });
		await expect(page.locator('.connection')).toHaveText('Data connected');
		assert.equal((await restoredProfile).status(), 200);
		await tab('Proposals');
		await expect(page.locator('.national-map')).toHaveAttribute('aria-busy', 'false', {
			timeout: 90000
		});
		await contextTab('Build option');
		await expect(page.locator('.operation-row')).toHaveCount(1);
		await expect(page.getByLabel('Option name')).toHaveValue(exported.name);
		return {
			name: exported.name,
			operations: exported.operations.length,
			file: download.suggestedFilename()
		};
	});
	await check('Passenger ferry restriction submits the backend marine mode', async () => {
		await page.getByLabel('Your intervention').selectOption('weather_disruption');
		await page.getByLabel('Mode to restrict').selectOption({ label: 'Passenger ferry' });
		await page.getByRole('button', { name: 'Add to option', exact: true }).click();
		await expect(page.locator('.operation-row')).toHaveCount(2);
		const simulated = responseFor('simulation/run');
		await page.getByRole('button', { name: 'Run simulation', exact: true }).click();
		const response = await simulated;
		const submitted = response.request().postDataJSON();
		assert.deepEqual(submitted.scenario.operations[1].disabled_modes, ['marine']);
		const result = await response.json();
		assert.equal(result.operations_applied.length, 2);
		assert.equal(result.operations_applied[1].applied, true);
		await contextTab('Build option');
		await page.getByRole('button', { name: 'Remove operation 2', exact: true }).click();
		await expect(page.locator('.operation-row')).toHaveCount(1);
		report.api.ferryRestriction = { mode: 'marine', applied: true };
		return report.api.ferryRestriction;
	});
	await check('Real recommendation generation and candidate application', async () => {
		await contextTab('Find candidates');
		await page.getByLabel('What would you like to improve?').selectOption('pedestrian');
		const generated = responseFor('recommendations');
		await page.getByRole('button', { name: 'Find candidates', exact: true }).click();
		const recommendations = await (await generated).json();
		assert.ok(recommendations.recommendations.length, 'Malé has a pedestrian screening candidate');
		const candidate = recommendations.recommendations[0];
		assert.ok(candidate.scenario.operations.length);
		await expect(page.locator('.candidate-card')).toHaveCount(
			recommendations.recommendations.length
		);
		await page
			.locator('.candidate-card')
			.first()
			.getByRole('button', { name: 'Open this candidate as an option' })
			.click();
		await expect(page.getByLabel('Option name')).toHaveValue(candidate.scenario.name);
		await expect(page.locator('.operation-row')).toHaveCount(candidate.scenario.operations.length);
		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'Export scenario', exact: true }).click();
		const download = await downloadPromise;
		const candidatePath = path.join(output, 'candidate-scenario.json');
		await download.saveAs(candidatePath);
		const exported = JSON.parse(await readFile(candidatePath, 'utf8'));
		assert.deepEqual(exported, candidate.scenario);
		assert.equal(exported.operations[0].coordinates, null);
		await page.getByRole('button', { name: 'Remove operation 1', exact: true }).click();
		await page.locator('.detail-panel input[type=file]').setInputFiles(candidatePath);
		await expect(page.locator('.operation-row')).toHaveCount(candidate.scenario.operations.length);
		await expect(page.getByRole('alert')).toHaveCount(0);
		await contextTab('Find candidates');
		const simulated = responseFor('simulation/run');
		await page.getByRole('button', { name: 'Test this option', exact: false }).click();
		const result = await (await simulated).json();
		await expect(page.getByRole('tab', { name: 'Review results', exact: true })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await expect(page.getByRole('tabpanel', { name: 'Review results', exact: true })).toBeVisible();
		await expect(page.locator('.simulation-result')).toBeVisible();
		await expect(page.locator('.candidate-card:visible')).toHaveCount(0);
		assert.equal(new URL(page.url()).searchParams.get('proposal'), 'review');
		await page.goBack();
		await expect(
			page.getByRole('tabpanel', { name: 'Find candidates', exact: true })
		).toBeVisible();
		assert.equal(new URL(page.url()).searchParams.get('proposal'), 'candidates');
		await page.goForward();
		await expect(page.getByRole('tabpanel', { name: 'Review results', exact: true })).toBeVisible();
		report.api.recommendation = candidate;
		report.api.candidateSimulation = {
			operations: result.operations_applied.length,
			delta: result.delta
		};
		return {
			id: candidate.id,
			type: candidate.type,
			operations: candidate.scenario.operations.length
		};
	});
	await check('Delayed real geometry initialization preserves generated candidates', async () => {
		await contextTab('Find candidates');
		let releaseMap = () => {};
		/** @type {Promise<void>} */
		const geometryGate = new Promise((resolve) => {
			releaseMap = resolve;
		});
		let geometryHeld = false;
		/** @param {URL} url */
		const geometryMatch = (url) =>
			url.pathname === '/api/backend/map/features' && url.searchParams.get('layer') === 'all';
		/** @param {import('@playwright/test').Route} route */
		const delayGeometry = async (route) => {
			geometryHeld = true;
			await geometryGate;
			await route.continue();
		};
		await page.route(geometryMatch, delayGeometry);
		try {
			const restoredProfile = responseFor(`islands/${male.properties.id}/profile`);
			await page.reload({ waitUntil: 'domcontentloaded' });
			await expect(page.locator('.connection')).toHaveText('Data connected');
			await expect(
				page.getByRole('tabpanel', { name: 'Find candidates', exact: true })
			).toBeVisible();
			await page.getByLabel('What would you like to improve?').selectOption('pedestrian');
			const generated = responseFor('recommendations');
			await page.getByRole('button', { name: 'Find candidates', exact: true }).click();
			const recommendations = await (await generated).json();
			assert.ok(geometryHeld, 'The real national geometry request is still held');
			assert.ok(recommendations.recommendations.length);
			await expect(page.locator('.candidate-card:visible')).toHaveCount(
				recommendations.recommendations.length
			);
			const before = await page.locator('.candidate-card:visible').allTextContents();
			releaseMap();
			assert.equal((await restoredProfile).status(), 200);
			await expect(page.locator('.national-map')).toHaveAttribute('aria-busy', 'false', {
				timeout: 90000
			});
			await expect(page.locator('.context-location')).toContainText(male.properties.name);
			await expect(page.locator('.candidate-card:visible')).toHaveCount(before.length);
			assert.deepEqual(await page.locator('.candidate-card:visible').allTextContents(), before);
			report.api.delayedInitialization = {
				island: male.properties.id,
				candidatesRetained: before.length,
				responsePayloadsReplaced: false
			};
			return report.api.delayedInitialization;
		} finally {
			releaseMap();
			await page.unroute(geometryMatch, delayGeometry);
		}
	});
	await check('Live provider status, bounded real refresh and pause', async () => {
		await tab('Live movement');
		await expect(
			page.getByRole('heading', { name: 'Provider coverage', exact: true })
		).toBeVisible();
		await expect(page.locator('.provider-row')).toHaveCount(5);
		await expect(page.locator('.provider-row').filter({ hasText: 'rtl' })).toContainText(
			'DISABLED'
		);
		assert.equal(liveRequests, 0, 'Opening the panel does not request optional positions');
		const refreshed = responseFor('live/snapshot');
		await page.getByRole('button', { name: 'Enable live movement', exact: true }).click();
		const response = await refreshed;
		assert.equal(response.status(), 200);
		const snapshot = await response.json();
		assert.ok(Array.isArray(snapshot.events));
		assert.equal(snapshot.deterministic_data_affected, false);
		await expect(page.getByText('Returned positions', { exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Pause live movement', exact: true }).click();
		await expect(
			page.getByRole('button', { name: 'Enable live movement', exact: true })
		).toBeVisible();
		assert.equal(liveRequests, 1, 'Exactly one user-requested refresh was performed');
		report.api.live = {
			coverage: snapshot.coverage,
			events: snapshot.events.length,
			providers: snapshot.providers
		};
		await page.screenshot({ path: path.join(output, 'desktop-live.png') });
		return report.api.live;
	});
	await check('Evidence clearly states implemented capabilities and source limits', async () => {
		await tab('Evidence');
		await expect(
			page.getByRole('heading', { name: 'Evidence, with the edges visible.', exact: true })
		).toBeVisible();
		await expect(page.locator('.map-workspace')).toBeHidden();
		await expect(
			page.getByRole('heading', { name: 'The national inventory', exact: true })
		).toBeVisible();
		for (const gap of [
			'Passenger data freshness and uncertainty',
			'Nationwide scheduled coverage',
			'Resident distribution and equity',
			'Procurement-grade costs and emissions',
			'Live provider coverage'
		])
			await expect(page.getByText(gap, { exact: true })).toBeVisible();
		await expect(page.locator('.provenance-grid article')).toHaveCount(6);
		await expect(
			page.getByRole('link', { name: 'Inspect returned summary', exact: false })
		).toHaveAttribute('href', '/api/backend/national/summary');
		await expect(page.locator('.scope-note')).toContainText(
			'modeled comparisons under the displayed assumptions'
		);
		await page.screenshot({ path: path.join(output, 'desktop-evidence.png') });
	});
	for (const width of [768, 375]) {
		await check(`Responsive ${width}px navigation, island drawer and overflow`, async () => {
			await page.setViewportSize({ width, height: 900 });
			await tab('Overview');
			await page.getByLabel('Search analytics islands').fill('');
			await page.getByLabel('Analytics atoll').selectOption('all');
			await page.getByLabel('Island screening filter').selectOption('all');
			const sizes = [];
			for (const name of ['Overview', 'Planning map', 'Proposals', 'Live movement', 'Evidence']) {
				await tab(name);
				sizes.push({ tab: name, ...(await noOverflow(width, name)) });
				if (name === 'Overview')
					await page.screenshot({
						path: path.join(output, `mobile-${width}-overview.png`),
						fullPage: true
					});
			}
			await tab('Proposals');
			await contextTab('Build option');
			await page.getByLabel('Your intervention').selectOption('add_bus_stop');
			await page.getByRole('button', { name: 'Place on map', exact: true }).click();
			await expect(page.locator('.national-map')).toHaveClass(/is-picking/);
			await expect(page.locator('.maplibregl-canvas')).toBeFocused();
			const pickerLayout = await page.evaluate(() => {
				const banner = document.querySelector('.pick-banner')?.getBoundingClientRect();
				const zoom = document.querySelector('.maplibregl-ctrl-group')?.getBoundingClientRect();
				if (!banner || !zoom) throw new Error('Picking instructions and zoom control are missing');
				return {
					bannerOverlapsZoom:
						banner.left < zoom.right &&
						banner.right > zoom.left &&
						banner.top < zoom.bottom &&
						banner.bottom > zoom.top
				};
			});
			assert.equal(
				pickerLayout.bannerOverlapsZoom,
				false,
				'Placement instructions leave zoom usable'
			);
			await page.keyboard.press('Escape');
			await expect(page.locator('.national-map')).not.toHaveClass(/is-picking/);
			await tab('Planning map');
			await contextTab('Island baseline');
			await page.getByRole('button', { name: 'Find an island or atoll', exact: false }).click();
			await expect(page.getByRole('textbox', { name: 'Search islands' })).toBeVisible();
			await searchIsland(male.properties.name);
			await page.locator(`.island-list button[data-island-id="${male.properties.id}"]`).click();
			await expect(page.getByRole('textbox', { name: 'Search islands' })).toBeHidden();
			await expect(page.getByRole('heading', { name: 'Accessibility', exact: true })).toBeVisible();
			await expect(page.locator('.national-map')).toHaveAttribute('aria-busy', 'false');
			const verticalLayout = await page.evaluate(() => {
				const region = document.querySelector('.map-region')?.getBoundingClientRect();
				const map = document.querySelector('.national-map')?.getBoundingClientRect();
				const detail = document.querySelector('.detail-panel')?.getBoundingClientRect();
				const hint = document.querySelector('.map-hint')?.getBoundingClientRect();
				const footer = document.querySelector('.map-footer')?.getBoundingClientRect();
				const dock = document.querySelector('.map-action-dock')?.getBoundingClientRect();
				const attribution = document
					.querySelector('.maplibregl-ctrl-attrib')
					?.getBoundingClientRect();
				if (!region || !map || !detail) throw new Error('Responsive workspace regions are missing');
				return {
					regionBottom: region.bottom,
					regionRight: region.right,
					mapBottom: map.bottom,
					detailTop: detail.top,
					detailLeft: detail.left,
					hintOverlapsAttribution: !!(
						hint &&
						attribution &&
						hint.left < attribution.right &&
						hint.right > attribution.left &&
						hint.top < attribution.bottom &&
						hint.bottom > attribution.top
					),
					footerOverlapsAttribution: !!(
						footer &&
						attribution &&
						footer.left < attribution.right &&
						footer.right > attribution.left &&
						footer.top < attribution.bottom &&
						footer.bottom > attribution.top
					),
					footerOverlapsActions: !!(
						footer &&
						dock &&
						footer.left < dock.right &&
						footer.right > dock.left &&
						footer.top < dock.bottom &&
						footer.bottom > dock.top
					),
					attributionOverlapsActions: !!(
						attribution &&
						dock &&
						attribution.left < dock.right &&
						attribution.right > dock.left &&
						attribution.top < dock.bottom &&
						attribution.bottom > dock.top
					)
				};
			});
			assert.ok(
				verticalLayout.mapBottom <= verticalLayout.regionBottom + 1 &&
					(width <= 900
						? verticalLayout.detailTop >= verticalLayout.regionBottom - 1
						: verticalLayout.detailLeft >= verticalLayout.regionRight - 1),
				`Map/footer overlaps mobile details: ${JSON.stringify(verticalLayout)}`
			);
			assert.equal(verticalLayout.hintOverlapsAttribution, false, 'Map hint remains readable');
			assert.equal(verticalLayout.footerOverlapsAttribution, false, 'Map legend remains readable');
			assert.equal(
				verticalLayout.footerOverlapsActions,
				false,
				'Map hints remain clear of proposal actions'
			);
			assert.equal(
				verticalLayout.attributionOverlapsActions,
				false,
				'Source attribution remains clear of proposal actions'
			);
			await page.screenshot({
				path: path.join(output, `mobile-${width}-planning-map.png`),
				fullPage: true
			});
			await tab('Evidence');
			await page.screenshot({
				path: path.join(output, `mobile-${width}-evidence.png`),
				fullPage: true
			});
			return { sizes, verticalLayout, pickerLayout };
		});
	}
	await check('No browser runtime or console errors', async () =>
		assert.deepEqual(report.errors, [])
	);
	await rm(path.join(output, 'failure.png'), { force: true });
} catch (error) {
	const failure = error instanceof Error ? error : new Error(String(error));
	report.failure = { message: failure.message, stack: failure.stack };
	console.error(failure.stack);
	await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
	process.exitCode = 1;
} finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(path.join(output, 'browser-verification.json'), JSON.stringify(report, null, 2));
	await browser.close();
}
