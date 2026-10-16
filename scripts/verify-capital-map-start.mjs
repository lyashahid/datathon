import { browserBaseURL } from './browser-config.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Verify the public opening journey with real island geography and the rendered map camera.
const baseURL = browserBaseURL();
const output = path.resolve('artifacts/qa/capital-map-start');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 60000 });
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
const atlas = page.locator('.national-map');
const explorer = page.getByRole('region', { name: 'Accessibility explorer', exact: true });
const navigation = page.getByRole('navigation', { name: 'Workspace', exact: true });

/** @param {string} name @param {()=>Promise<unknown>} action */
async function check(name, action) {
	console.log(`RUN ${name}`);
	try {
		const detail = await action();
		report.checks.push({ name, status: 'passed', detail });
		console.log(`PASS ${name}`);
	} catch (error) {
		report.checks.push({ name, status: 'failed', detail: String(error) });
		throw error;
	} finally {
		await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
	}
}

/** @param {import('@playwright/test').Locator} targetAtlas */
async function mapView(targetAtlas = atlas) {
	return targetAtlas.evaluate((element) => ({
		longitude: Number(element.getAttribute('data-center-longitude')),
		latitude: Number(element.getAttribute('data-center-latitude')),
		zoom: Number(element.getAttribute('data-zoom'))
	}));
}

/** Project coordinates using the public rendered camera attributes.
 * @param {[number, number]} coordinates
 * @param {import('@playwright/test').Locator} targetAtlas
 */
async function visibleMapPoint(coordinates, targetAtlas = atlas) {
	return targetAtlas.evaluate((element, location) => {
		const canvas = element.querySelector('.maplibregl-canvas');
		if (!canvas) return { visible: false, x: 0, y: 0 };
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
		return {
			visible:
				x >= bounds.x &&
				y >= bounds.y &&
				x <= bounds.right &&
				y <= bounds.bottom &&
				!!document.elementFromPoint(x, y)?.matches('.maplibregl-canvas'),
			x,
			y
		};
	}, coordinates);
}

async function readyHulhumale() {
	await expect(atlas).toHaveAttribute('aria-busy', 'false');
	await expect(atlas).toHaveAttribute('data-accessibility-overview', 'false');
	await expect(explorer).not.toBeVisible();
	await expect(page.getByTestId('country-map-introduction')).not.toBeVisible();
	await expect(page).toHaveURL(
		(url) =>
			url.searchParams.get('view') === 'map' &&
			url.searchParams.get('island') === 'island:1442' &&
			!url.searchParams.has('scope')
	);
	await expect(page.getByLabel('Service coverage map', { exact: true })).toBeVisible();
	await expect(page.getByLabel('Explore supporting tools', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Create proposal', exact: true })).toBeVisible();
	await expect(page.locator('.map-search-dock')).toBeVisible();
	await expect(page.locator('.app-header')).toHaveClass(/floating-map-header/);
	await expect(navigation.getByRole('button')).toHaveCount(3);
	await expect(
		navigation.getByRole('button', { name: 'Map & planning', exact: true })
	).toHaveAttribute('aria-current', 'page');
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
		.toBe(true);
}

try {
	const response = await page.request.get(`${baseURL}/api/backend/map/features?layer=islands`);
	assert.equal(response.status(), 200);
	/** @type {{features:Array<{geometry:{coordinates?:unknown},properties:{id:string,name:string,centroid:[number,number]}}>}} */
	const data = await response.json();
	/** @type {Array<[number, number]>} */
	const maleShore = [];
	/** @param {unknown} value */
	function collectShoreCoordinates(value) {
		if (!Array.isArray(value)) return;
		if (typeof value[0] === 'number' && typeof value[1] === 'number') {
			maleShore.push([value[0], value[1]]);
			return;
		}
		for (const item of value) collectShoreCoordinates(item);
	}
	collectShoreCoordinates(
		data.features.find((item) => item.properties.id === 'island:1443')?.geometry.coordinates
	);
	assert.ok(maleShore.length > 0, 'The real Malé shoreline is available');
	const southernShore = maleShore.reduce((lowest, point) =>
		point[1] < lowest[1] ? point : lowest
	);
	const capital = ['island:1443', 'island:1442'].map((id) => {
		const feature = data.features.find((item) => item.properties.id === id);
		assert.ok(feature, `Capital island ${id} exists in the real dataset`);
		return feature.properties;
	});
	async function bothCitiesVisible() {
		/** @type {Record<string,{visible:boolean,x:number,y:number}>} */
		const points = {};
		for (const island of capital) {
			await expect
				.poll(async () => (await visibleMapPoint(island.centroid)).visible, {
					message: `${island.name} remains visible outside floating controls`
				})
				.toBe(true);
			points[island.name] = await visibleMapPoint(island.centroid);
		}
		const view = await mapView();
		assert.ok(view.zoom > 10 && view.zoom < 14.5, 'The opening camera frames the capital region');
		return { view, points };
	}

	const hulhumale = capital.find((island) => island.id === 'island:1442');
	assert.ok(hulhumale);
	const { centroid: hulhumaleCentroid, name: hulhumaleName } = hulhumale;
	async function hulhumaleVisible() {
		await expect
			.poll(async () => (await visibleMapPoint(hulhumaleCentroid)).visible, {
				message: 'Hulhumalé remains visible outside floating controls'
			})
			.toBe(true);
		await expect.poll(async () => (await mapView()).zoom).toBeGreaterThan(12);
		await expect(page.locator('.policy-inspect-trigger')).toContainText(hulhumaleName);
		return { view: await mapView(), point: await visibleMapPoint(hulhumaleCentroid) };
	}
	await check('A fresh home page opens Analytics rather than Map & planning', async () => {
		await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
		const analytics = page.getByRole('region', { name: 'National analytics', exact: true });
		await expect(analytics).toBeVisible();
		await expect(analytics).toHaveAttribute('aria-busy', 'false');
		await expect(
			navigation.getByRole('button', { name: 'Analytics', exact: true })
		).toHaveAttribute('aria-current', 'page');
		await expect(atlas).not.toBeVisible();
		await expect(page.locator('.app-header')).not.toHaveClass(/floating-map-header/);
		assert.notEqual(new URL(page.url()).searchParams.get('view'), 'map');
		await page.screenshot({ path: path.join(output, 'app-default.png') });
		await page.reload({ waitUntil: 'domcontentloaded' });
		await expect(analytics).toBeVisible();
		return { url: page.url() };
	});
	await check('A bare map link focuses Hulhumalé with detailed island tools ready', async () => {
		await page.goto(`${baseURL}/?view=map`, { waitUntil: 'domcontentloaded' });
		await readyHulhumale();
		const camera = await hulhumaleVisible();
		await page.screenshot({ path: path.join(output, 'map-default.png') });
		return { url: page.url(), ...camera };
	});
	await check('The Hulhumalé opening survives reload without national onboarding', async () => {
		await page.reload({ waitUntil: 'domcontentloaded' });
		await readyHulhumale();
		return hulhumaleVisible();
	});
	await check('Explicit capital-region deep links still frame both islands', async () => {
		await page.goto(`${baseURL}/?view=map&island=island%3A1442&scope=capital`, {
			waitUntil: 'domcontentloaded'
		});
		await expect(atlas).toHaveAttribute('aria-busy', 'false');
		await expect(page).toHaveURL((url) => url.searchParams.get('scope') === 'capital');
		await expect(explorer).not.toBeVisible();
		return bothCitiesVisible();
	});
	await check(
		'Explicit Malé island links retain their selected island and detailed camera',
		async () => {
			await page.goto(`${baseURL}/?view=map&island=island%3A1443`, {
				waitUntil: 'domcontentloaded'
			});
			await expect(atlas).toHaveAttribute('aria-busy', 'false');
			await expect(atlas).toHaveAttribute('data-accessibility-overview', 'false');
			await expect(explorer).not.toBeVisible();
			await expect(page).toHaveURL((url) => url.searchParams.get('island') === 'island:1443');
			await expect(page.locator('.policy-inspect-trigger')).toContainText('Malé');
			assert.notEqual(new URL(page.url()).searchParams.get('scope'), 'capital');
			await expect.poll(async () => (await mapView()).zoom).toBeGreaterThan(11);
			return { url: page.url(), view: await mapView() };
		}
	);
	await check(
		'Map & planning resets to Hulhumalé after viewing Malé and returning through Analytics',
		async () => {
			await navigation.getByRole('button', { name: 'Analytics', exact: true }).click();
			await expect(
				page.getByRole('region', { name: 'National analytics', exact: true })
			).toBeVisible();
			await navigation.getByRole('button', { name: 'Map & planning', exact: true }).click();
			await readyHulhumale();
			return hulhumaleVisible();
		}
	);
	await check(
		'The optional Maldives overview is explicit and remains selected after reload',
		async () => {
			await atlas.getByRole('button', { name: 'Show all Maldives islands', exact: true }).click();
			await expect(explorer).toHaveAttribute('data-scope', 'country');
			await expect(explorer).toHaveAttribute('aria-busy', 'false');
			await expect(atlas).toHaveAttribute('data-accessibility-overview', 'true');
			await expect(page).toHaveURL(
				(url) => url.searchParams.get('scope') === 'country' && !url.searchParams.has('island')
			);
			await page.reload({ waitUntil: 'domcontentloaded' });
			await expect(explorer).toHaveAttribute('data-scope', 'country');
			await expect(explorer).toHaveAttribute('aria-busy', 'false');
			await expect(atlas).toHaveAttribute('data-accessibility-overview', 'true');
			await expect.poll(async () => (await mapView()).zoom).toBeLessThan(8);
			await navigation.getByRole('button', { name: 'Map & planning', exact: true }).click();
			await readyHulhumale();
			return hulhumaleVisible();
		}
	);
	await check(
		'Browser back and forward preserve Hulhumalé and optional country camera scopes',
		async () => {
			await atlas.getByRole('button', { name: 'Show all Maldives islands', exact: true }).click();
			await expect(explorer).toHaveAttribute('data-scope', 'country');
			await expect(atlas).toHaveAttribute('data-accessibility-overview', 'true');
			await navigation.getByRole('button', { name: 'Map & planning', exact: true }).click();
			await readyHulhumale();
			await hulhumaleVisible();
			await page.goBack();
			await expect(explorer).toHaveAttribute('data-scope', 'country');
			await expect(page).toHaveURL((url) => url.searchParams.get('scope') === 'country');
			await expect.poll(async () => (await mapView()).zoom).toBeLessThan(8);
			await page.goBack();
			await readyHulhumale();
			await hulhumaleVisible();
			await page.goForward();
			await expect(explorer).toHaveAttribute('data-scope', 'country');
			await expect.poll(async () => (await mapView()).zoom).toBeLessThan(8);
			await page.goForward();
			await readyHulhumale();
			return hulhumaleVisible();
		}
	);
	await check(
		'View can focus the selected island and retain that camera after reload',
		async () => {
			await atlas.getByRole('button', { name: 'View', exact: true }).click();
			await atlas.getByRole('button', { name: 'Focus selected island', exact: true }).click();
			await expect(page).toHaveURL(
				(url) => url.searchParams.get('island') === 'island:1442' && !url.searchParams.has('scope')
			);
			await expect.poll(async () => (await mapView()).zoom).toBeGreaterThan(13);
			await page.reload({ waitUntil: 'domcontentloaded' });
			await expect(atlas).toHaveAttribute('aria-busy', 'false');
			await expect(explorer).not.toBeVisible();
			await expect.poll(async () => (await mapView()).zoom).toBeGreaterThan(13);
			assert.equal(new URL(page.url()).searchParams.has('scope'), false);
			await navigation.getByRole('button', { name: 'Map & planning', exact: true }).click();
			await readyHulhumale();
			return hulhumaleVisible();
		}
	);
	for (const viewport of [
		{ width: 820, height: 1180, name: 'tablet' },
		{ width: 390, height: 844, name: 'mobile' }
	]) {
		await check(`${viewport.name} focuses Hulhumalé without hiding the map tools`, async () => {
			await page.setViewportSize({ width: viewport.width, height: viewport.height });
			await page.goto(`${baseURL}/?view=map`, { waitUntil: 'domcontentloaded' });
			await readyHulhumale();
			const camera = await hulhumaleVisible();
			await page.screenshot({ path: path.join(output, `hulhumale-${viewport.name}.png`) });
			return camera;
		});
	}
	await check(
		'A fresh tablet session keeps the complete Malé shoreline above the map key',
		async () => {
			const coldContext = await browser.newContext({
				viewport: { width: 820, height: 1180 },
				reducedMotion: 'reduce'
			});
			const coldPage = await coldContext.newPage();
			coldPage.on('pageerror', (error) => report.pageErrors.push(error.message));
			try {
				await coldPage.goto(`${baseURL}/?view=map&island=island%3A1442&scope=capital`, {
					waitUntil: 'domcontentloaded'
				});
				const coldAtlas = coldPage.locator('.national-map');
				await expect(coldAtlas).toHaveAttribute('aria-busy', 'false');
				await expect(coldAtlas).toHaveAttribute('data-accessibility-overview', 'false');
				await expect
					.poll(async () => Number(await coldAtlas.getAttribute('data-policy-gap-cells')))
					.toBeGreaterThan(0);
				await expect
					.poll(
						async () => {
							const point = await visibleMapPoint(southernShore, coldAtlas);
							const legend = await coldAtlas.locator('.map-information-card').boundingBox();
							return !!legend && point.visible && point.y + 16 <= legend.y;
						},
						{ message: 'The southern Malé shoreline clears the fully populated legend' }
					)
					.toBe(true);
				await coldPage.screenshot({ path: path.join(output, 'capital-cold-tablet.png') });
				return {
					view: await mapView(coldAtlas),
					southernShore,
					point: await visibleMapPoint(southernShore, coldAtlas),
					legend: await coldAtlas.locator('.map-information-card').boundingBox()
				};
			} catch (error) {
				await coldPage
					.screenshot({ path: path.join(output, 'cold-tablet-failure.png') })
					.catch(() => {});
				throw error;
			} finally {
				await coldContext.close();
			}
		}
	);
	await check('The opening and navigation complete without browser runtime errors', async () => {
		assert.deepEqual(report.pageErrors, []);
		return { errors: report.pageErrors.length };
	});
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
