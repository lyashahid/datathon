import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Walk the public country-to-island journey using the real backend and map.
const baseURL = process.env.BASE_URL || process.env.MOBILITY_QA_URL || 'http://localhost:5173';
const output = path.resolve('artifacts/qa/country-map-journey');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 60000 });
const decimal = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
/** @type {{baseURL:string,startedAt:string,finishedAt?:string,checks:Array<{name:string,status:string,detail?:unknown}>,pageErrors:string[],failure?:string}} */
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], pageErrors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1000 },
	reducedMotion: 'reduce'
});
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.on('pageerror', (error) => report.pageErrors.push(error.message));
const explorer = page.getByRole('region', { name: 'Accessibility explorer', exact: true });
const atlas = page.locator('.national-map');
const panel = page.getByRole('region', { name: 'Island needs and proposal', exact: true });
const navigation = page.getByRole('navigation', { name: 'Workspace', exact: true });

/** @param {string} name @param {()=>Promise<unknown>} action */
async function check(name, action) {
	console.log(`RUN ${name}`);
	try {
		const detail = await action();
		report.checks.push({ name, status: 'passed', detail });
		await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
		console.log(`PASS ${name}`);
	} catch (error) {
		report.checks.push({ name, status: 'failed', detail: String(error) });
		throw error;
	}
}

async function mapView() {
	return atlas.evaluate((element) => ({
		longitude: Number(element.getAttribute('data-center-longitude')),
		latitude: Number(element.getAttribute('data-center-latitude')),
		zoom: Number(element.getAttribute('data-zoom'))
	}));
}

/** Check the rendered camera without reading or changing MapLibre's internal state.
 * @param {[number, number]} coordinates
 */
async function coordinateVisibility(coordinates) {
	return atlas.evaluate((element, location) => {
		const canvas = element.querySelector('.maplibregl-canvas');
		if (!canvas) return { visible: false, x: 0, y: 0, covering: 'No canvas' };
		const bounds = canvas.getBoundingClientRect();
		const zoom = Number(element.getAttribute('data-zoom'));
		const longitude = Number(element.getAttribute('data-center-longitude'));
		const latitude = Number(element.getAttribute('data-center-latitude'));
		const left = Number(element.getAttribute('data-camera-padding-left'));
		const right = Number(element.getAttribute('data-camera-padding-right'));
		const top = Number(element.getAttribute('data-camera-padding-top'));
		const bottom = Number(element.getAttribute('data-camera-padding-bottom'));
		const world = 512 * 2 ** zoom;
		/** @param {number} value */
		const mercatorY = (value) =>
			(1 - Math.log(Math.tan(Math.PI / 4 + (value * Math.PI) / 360)) / Math.PI) / 2;
		const x =
			bounds.x + (bounds.width + left - right) / 2 + ((location[0] - longitude) * world) / 360;
		const y =
			bounds.y +
			(bounds.height + top - bottom) / 2 +
			(mercatorY(location[1]) - mercatorY(latitude)) * world;
		const target = document.elementFromPoint(x, y);
		return {
			visible:
				!!target?.matches('.maplibregl-canvas') &&
				x >= bounds.x &&
				y >= bounds.y &&
				x <= bounds.right &&
				y <= bounds.bottom,
			x,
			y,
			covering: target?.tagName ?? 'Outside viewport'
		};
	}, coordinates);
}

/** @param {[number, number]} coordinates @param {string} label */
async function expectUnobscured(coordinates, label) {
	await expect
		.poll(async () => (await coordinateVisibility(coordinates)).visible, {
			message: `${label} remains on the visible map, outside overlays`
		})
		.toBe(true);
	return coordinateVisibility(coordinates);
}

async function noOverflow() {
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
		.toBe(true);
	return page.evaluate(() => ({
		width: innerWidth,
		documentWidth: document.documentElement.scrollWidth,
		height: innerHeight,
		documentHeight: document.documentElement.scrollHeight
	}));
}

async function countryReady() {
	await expect(explorer).toBeVisible();
	await expect(explorer).toHaveAttribute('aria-busy', 'false');
	await expect(explorer).toHaveAttribute('data-scope', 'country');
	await expect(atlas).toHaveAttribute('aria-busy', 'false');
	await expect(atlas).toHaveAttribute('data-accessibility-overview', 'true');
	await expect(atlas).toHaveAttribute('data-atoll-scope', '');
	await expect(atlas).toHaveAttribute('data-policy-gap-cells', '0');
	await expect(atlas).toHaveAttribute('data-policy-impact-cells', '0');
	await expect(atlas).toHaveAttribute('data-policy-proposal-points', '0');
	await expect.poll(async () => (await mapView()).zoom).toBeLessThan(8);
}

async function fullMapViewport() {
	const bounds = await atlas.boundingBox();
	const viewport = page.viewportSize();
	assert.ok(bounds && viewport);
	assert.ok(Math.abs(bounds.y) <= 1, 'The map starts at the top of the viewport');
	assert.ok(Math.abs(bounds.height - viewport.height) <= 1, 'The map fills the viewport height');
	assert.ok(Math.abs(bounds.width - viewport.width) <= 1, 'The map fills the viewport width');
	await expect(page.locator('.app-header')).toHaveClass(/floating-map-header/);
	await expect(navigation).toHaveClass(/navigation-island/);
	await expect(navigation.getByRole('button')).toHaveCount(3);
	for (const name of ['Analytics', 'Map & planning', 'Evidence'])
		await expect(navigation.getByRole('button', { name, exact: true })).toBeInViewport();
	await expect(
		navigation.getByRole('button', { name: 'Map & planning', exact: true })
	).toHaveAttribute('aria-current', 'page');
	await expect(page.locator('.workspace-menu')).toHaveCount(0);
	await expect(page.locator('.map-tool-nav')).toHaveCount(0);
	return { bounds, ...(await noOverflow()) };
}

/** @param {string} atoll */
async function drillAtoll(atoll) {
	await explorer.getByRole('button', { name: 'Find out why', exact: true }).click();
	await expect(explorer).toHaveAttribute('data-expanded', 'true');
	await expect(
		explorer.getByRole('heading', { name: 'What shapes the score', exact: true })
	).toBeVisible();
	const bounds = await explorer.boundingBox();
	const viewport = page.viewportSize();
	assert.ok(bounds && viewport);
	assert.ok(
		bounds.y >= -1 && bounds.y + bounds.height <= viewport.height + 1,
		'Expanded explanation stays fully inside the viewport'
	);
	await explorer.locator('[data-atoll]').filter({ hasText: atoll }).click();
	await expect(explorer).toHaveAttribute('data-scope', 'atoll');
	await expect(explorer.getByRole('heading', { name: atoll, exact: true })).toBeVisible();
	await expect(atlas).toHaveAttribute('data-atoll-scope', atoll);
	await expect(page).toHaveURL((url) => url.searchParams.get('atoll') === atoll);
}

try {
	const responses = await Promise.all(
		['map/features?layer=all', 'accessibility/summary'].map((endpoint) =>
			page.request.get(`${baseURL}/api/backend/${endpoint}`, { timeout: 90000 })
		)
	);
	for (const response of responses) assert.equal(response.status(), 200, response.url());
	/** @type {{features:Array<{id?:string,properties:{id?:string,name:string,atoll:string,category:string,centroid?:[number,number]}}>}} */
	const features = await responses[0].json();
	/** @type {{scores:Array<{island_id:string,score:number,population:{total:number|null},assessment:{reasons:Array<{domain:string,text:string}>,coverage:{note:string}}}>}} */
	const national = await responses[1].json();
	const scores = new Map(national.scores.map((item) => [item.island_id, item]));
	const residential = new Map(
		features.features
			.filter(
				(feature) => feature.properties.category?.trim().toLowerCase() === 'residential island'
			)
			.map((feature) => [String(feature.properties.id ?? feature.id), feature.properties])
	);
	const scored = [...residential.keys()].flatMap((id) => {
		const score = scores.get(id);
		return score && Number.isFinite(score.score) ? [score] : [];
	});
	assert.ok(scored.length > 100, 'Residential country scores are available');
	const nationalMean = scored.reduce((sum, item) => sum + item.score, 0) / scored.length;
	const islandId = 'island:1442';
	const island = residential.get(islandId);
	const islandScore = scores.get(islandId);
	assert.ok(island && islandScore, 'The mapped planning island is present in the real data');
	const atollIslands = [...residential.entries()].filter(([, row]) => row.atoll === island.atoll);
	const atollScores = atollIslands.flatMap(([id]) => {
		const score = scores.get(id);
		return score && Number.isFinite(score.score) ? [score] : [];
	});
	const atollMean = atollScores.reduce((sum, item) => sum + item.score, 0) / atollScores.length;
	const geographicExtremes = [...residential.values()]
		.filter((item) => item.centroid?.length === 2)
		.sort((a, b) => Number(a.centroid?.[1]) - Number(b.centroid?.[1]));
	const south = geographicExtremes[0];
	const north = geographicExtremes.at(-1);
	assert.ok(south?.centroid && north?.centroid && island.centroid);
	const northCoordinates = north.centroid;
	const southCoordinates = south.centroid;
	const islandCoordinates = island.centroid;
	let initialCountryView = { longitude: 0, latitude: 0, zoom: 0 };

	await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
	await check(
		'Opening the app shows the entire Maldives map and a real residential score',
		async () => {
			await countryReady();
			await expect(explorer.getByTestId('national-accessibility-score')).toHaveText(
				decimal.format(nationalMean)
			);
			await expect(explorer.getByTestId('accessibility-score-basis')).toContainText(
				`Average across ${scored.length} residential islands`
			);
			await expect(explorer).toHaveAttribute('data-expanded', 'false');
			await expect(explorer).toContainText('Missing map data can lower this score.');
			await expect(
				explorer.getByRole('button', { name: 'Find out why', exact: true })
			).toBeVisible();
			await expect(atlas).toHaveAttribute('data-accessibility-points', String(residential.size));
			assert.equal(new URL(page.url()).searchParams.has('island'), false);
			const viewport = await fullMapViewport();
			const view = await mapView();
			initialCountryView = view;
			assert.ok(view.latitude > 1 && view.latitude < 6, 'The camera is centered on the country');
			await expectUnobscured(northCoordinates, `Northern residential island ${north.name}`);
			await expectUnobscured(southCoordinates, `Southern residential island ${south.name}`);
			await page.screenshot({ path: path.join(output, 'country-desktop.png') });
			return {
				residentialIslands: residential.size,
				scoredIslands: scored.length,
				score: nationalMean,
				view,
				...viewport
			};
		}
	);

	await check(
		'The score explanation leads into an atoll with its own correctly averaged score',
		async () => {
			const before = await mapView();
			await drillAtoll(island.atoll);
			await expect(explorer.getByTestId('atoll-accessibility-score')).toHaveText(
				decimal.format(atollMean)
			);
			await expect(atlas).toHaveAttribute('data-accessibility-points', String(atollIslands.length));
			await expect.poll(async () => (await mapView()).zoom).toBeGreaterThan(before.zoom);
			await noOverflow();
			await page.screenshot({ path: path.join(output, 'atoll-desktop.png') });
			return {
				atoll: island.atoll,
				islands: atollIslands.length,
				score: atollMean,
				view: await mapView()
			};
		}
	);

	await check(
		'Clicking an island restores its detailed service map and planning tools',
		async () => {
			const islandPoint = await expectUnobscured(islandCoordinates, island.name);
			await page.mouse.click(islandPoint.x, islandPoint.y);
			await expect(explorer).not.toBeVisible();
			await expect(page).toHaveURL((url) => url.searchParams.get('island') === islandId);
			await expect(atlas).toHaveAttribute('data-accessibility-overview', 'false');
			await expect.poll(async () => (await mapView()).zoom).toBeGreaterThan(11);
			await expectUnobscured(islandCoordinates, island.name);
			await expect(page.getByLabel('Service coverage map', { exact: true })).toBeVisible();
			await expect(page.getByLabel('Explore supporting tools', { exact: true })).toBeVisible();
			await expect(
				page.getByRole('button', { name: 'Create proposal', exact: true })
			).toBeVisible();
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-policy-gap-cells')))
				.toBeGreaterThan(0);
			await noOverflow();
			await page.screenshot({ path: path.join(output, 'island-desktop.png') });
			return {
				island: islandId,
				gapCells: await atlas.getAttribute('data-policy-gap-cells'),
				view: await mapView()
			};
		}
	);

	await check('The island proposal action opens the planning panel on the same map', async () => {
		await page.getByRole('button', { name: 'Create proposal', exact: true }).click();
		await expect(panel).toBeVisible();
		await expect(panel).toHaveAttribute('data-policy-section', 'proposal');
		await expect(panel.getByRole('heading', { name: island.name, exact: true })).toBeVisible();
		await expect(panel.getByRole('textbox', { name: 'Proposal name', exact: true })).toBeVisible();
		await expect(panel.getByLabel('Capital budget · MVR', { exact: true })).toBeVisible();
		await expect(
			panel.getByRole('button', { name: 'Suggest investments within my budget', exact: true })
		).toBeEnabled();
		await expect(atlas.locator('.maplibregl-canvas')).toBeVisible();
		await expect(page).toHaveURL(
			(url) => url.searchParams.get('view') === 'map' && url.searchParams.get('island') === islandId
		);
		await expect(explorer).not.toBeVisible();
		await noOverflow();
		await page.screenshot({ path: path.join(output, 'proposal-desktop.png') });
		return { island: islandId, url: page.url(), view: await mapView() };
	});

	await check('The globe resets the island and planning state to the country view', async () => {
		await atlas.getByRole('button', { name: 'Show all Maldives islands', exact: true }).click();
		await countryReady();
		await expect(panel).not.toBeVisible();
		await expect(explorer.getByTestId('national-accessibility-score')).toHaveText(
			decimal.format(nationalMean)
		);
		assert.equal(new URL(page.url()).searchParams.has('island'), false);
		assert.equal(new URL(page.url()).searchParams.has('atoll'), false);
		/** @type {Array<'longitude' | 'latitude' | 'zoom'>} */
		const axes = ['longitude', 'latitude', 'zoom'];
		for (const axis of axes) {
			await expect
				.poll(async () => Math.abs((await mapView())[axis] - initialCountryView[axis]))
				.toBeLessThan(0.1);
		}
		await expectUnobscured(northCoordinates, `Northern residential island ${north.name}`);
		await expectUnobscured(southCoordinates, `Southern residential island ${south.name}`);
		await page.screenshot({ path: path.join(output, 'country-reset-desktop.png') });
		return { url: page.url(), view: await mapView() };
	});

	await check('Back actions retain atoll context and return to the national overview', async () => {
		await drillAtoll(island.atoll);
		await explorer.locator(`[data-island-id="${islandId}"]`).click();
		await expect(explorer).not.toBeVisible();
		await page.goBack();
		await expect(explorer).toHaveAttribute('data-scope', 'atoll');
		await expect(explorer.getByTestId('atoll-accessibility-score')).toHaveText(
			decimal.format(atollMean)
		);
		assert.equal(new URL(page.url()).searchParams.has('island'), false);
		await explorer.getByRole('button', { name: 'Back to Maldives', exact: true }).click();
		await countryReady();
		return { url: page.url() };
	});

	await check(
		'Browser history preserves the same country, atoll and island drill down',
		async () => {
			await drillAtoll(island.atoll);
			await explorer.locator(`[data-island-id="${islandId}"]`).click();
			await expect(explorer).not.toBeVisible();
			await page.goBack();
			await expect(explorer).toHaveAttribute('data-scope', 'atoll');
			await expect(atlas).toHaveAttribute('data-atoll-scope', island.atoll);
			assert.equal(new URL(page.url()).searchParams.has('island'), false);
			await page.goBack();
			await countryReady();
			assert.equal(new URL(page.url()).searchParams.has('atoll'), false);
			return { url: page.url() };
		}
	);

	await check(
		'Returning from directions clears journey mode and stays at the country after a reload',
		async () => {
			await drillAtoll(island.atoll);
			await explorer.locator(`[data-island-id="${islandId}"]`).click();
			await expect(explorer).not.toBeVisible();
			await page
				.locator('.map-action-dock')
				.getByRole('button', { name: 'Directions', exact: true })
				.click();
			await expect(page).toHaveURL((url) => url.searchParams.get('profile') === 'route');
			await atlas.getByRole('button', { name: 'Show all Maldives islands', exact: true }).click();
			await countryReady();
			assert.equal(new URL(page.url()).searchParams.has('profile'), false);
			await page.reload({ waitUntil: 'domcontentloaded' });
			await countryReady();
			assert.equal(new URL(page.url()).searchParams.has('island'), false);
			assert.equal(new URL(page.url()).searchParams.has('profile'), false);
			return { url: page.url() };
		}
	);

	await check('Analytics remains directly reachable from the floating navigation', async () => {
		await navigation.getByRole('button', { name: 'Analytics', exact: true }).click();
		const dashboard = page.getByRole('region', { name: 'National analytics', exact: true });
		await expect(dashboard).toBeVisible();
		await expect(dashboard).toHaveAttribute('aria-busy', 'false');
		await expect(page.locator('.app-header')).toBeVisible();
		await expect(page.locator('.navigation-island')).toBeVisible();
		await expect(
			page.locator('.app-header').getByRole('button', { name: 'Analytics', exact: true })
		).toHaveAttribute('aria-current', 'page');
		await noOverflow();
		return { url: page.url() };
	});

	await check(
		'A narrow screen retains the country-first pitch and a usable drill down',
		async () => {
			await page.setViewportSize({ width: 390, height: 844 });
			await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
			await countryReady();
			await expect(explorer.getByTestId('national-accessibility-score')).toBeInViewport();
			await expect(
				explorer.getByRole('button', { name: 'Find out why', exact: true })
			).toBeInViewport();
			await fullMapViewport();
			const northVisible = await expectUnobscured(
				northCoordinates,
				`Northern residential island ${north.name}`
			);
			const southVisible = await expectUnobscured(
				southCoordinates,
				`Southern residential island ${south.name}`
			);
			await page.screenshot({ path: path.join(output, 'country-mobile.png') });
			await drillAtoll(island.atoll);
			await expect(explorer.getByTestId('atoll-accessibility-score')).toHaveText(
				decimal.format(atollMean)
			);
			await noOverflow();
			await page.screenshot({ path: path.join(output, 'atoll-mobile.png') });
			await explorer.locator(`[data-island-id="${islandId}"]`).click();
			await expect(explorer).not.toBeVisible();
			await expect(page.getByLabel('Service coverage map', { exact: true })).toBeVisible();
			await expectUnobscured(islandCoordinates, island.name);
			await page.getByRole('button', { name: 'Create proposal', exact: true }).click();
			await expect(panel).toBeVisible();
			await expect(panel).toHaveAttribute('data-policy-section', 'proposal');
			await expect(
				panel.getByRole('button', { name: 'Suggest investments within my budget', exact: true })
			).toBeEnabled();
			await noOverflow();
			await page.screenshot({ path: path.join(output, 'proposal-mobile.png') });
			return { width: 390, island: islandId, northVisible, southVisible };
		}
	);

	await check(
		'The complete country-to-proposal journey has no browser runtime errors',
		async () => {
			assert.deepEqual(report.pageErrors, []);
			return { errors: report.pageErrors.length };
		}
	);
} catch (error) {
	report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
	process.exitCode = 1;
	await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
	await browser.close();
	console.log(JSON.stringify(report, null, 2));
}
