import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Exercise the public navigation and country-to-planning journey against real data.
const baseURL = process.env.BASE_URL || process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5173';
const output = path.resolve('artifacts/qa/restored-navigation');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 60000 });
/** @type {{baseURL:string,startedAt:string,finishedAt?:string,checks:Array<{name:string,status:string,detail?:unknown}>,pageErrors:string[],gestures?:Array<{pointer:{x:number,y:number},zoomBefore:number,zoomAfter:number}>,failure?:string}} */
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
const header = page.locator('.app-header');
const planning = page.getByRole('region', { name: 'Island needs and proposal', exact: true });
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

async function noOverflow() {
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
		.toBe(true);
}

async function floatingNavigation() {
	await expect(header).toHaveClass(/floating-map-header/);
	await expect(navigation).toHaveClass(/navigation-island/);
	await expect(navigation.getByRole('button')).toHaveCount(3);
	for (const name of ['Analytics', 'Map & planning', 'Evidence']) {
		const button = navigation.getByRole('button', { name, exact: true });
		await expect(button).toBeInViewport();
		const bounds = await button.boundingBox();
		const viewport = page.viewportSize();
		assert.ok(bounds && viewport);
		assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width, `${name} fully fits`);
		assert.equal(
			await button.evaluate((element) => {
				const rect = element.getBoundingClientRect();
				return element.contains(
					document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
				);
			}),
			true,
			`${name} remains clickable above the map`
		);
	}
	await expect(
		navigation.getByRole('button', { name: 'Map & planning', exact: true })
	).toHaveAttribute('aria-current', 'page');
	await expect(page.locator('.workspace-menu')).toHaveCount(0);
	await expect(page.getByLabel('Open workspace menu', { exact: true })).toHaveCount(0);
	await expect(header.locator('.brand, .connection')).toHaveCount(0);
	const style = await header.evaluate((element) => {
		const computed = getComputedStyle(element);
		return { background: computed.backgroundColor, border: computed.borderBottomWidth };
	});
	assert.match(
		style.background,
		/(?:rgba\(0, 0, 0, 0\)|transparent)/,
		'No solid header bar covers the map'
	);
	assert.equal(style.border, '0px');
	const navBounds = await navigation.boundingBox();
	assert.ok(navBounds);
	for (const selector of [
		'.map-search-dock',
		'.accessibility-map-overlay',
		'.policy-lens-bar',
		'.policy-inspect-trigger',
		'.policy-map-panel',
		'.map-tool-sheet'
	]) {
		for (const element of await page.locator(selector).all()) {
			if (!(await element.isVisible())) continue;
			const bounds = await element.boundingBox();
			if (!bounds) continue;
			assert.ok(
				bounds.x + bounds.width <= navBounds.x ||
					navBounds.x + navBounds.width <= bounds.x ||
					bounds.y + bounds.height <= navBounds.y ||
					navBounds.y + navBounds.height <= bounds.y,
				`Floating navigation does not overlap ${selector}`
			);
		}
	}
}

async function countryReady() {
	await expect(explorer).toBeVisible();
	await expect(explorer).toHaveAttribute('aria-busy', 'false');
	await expect(explorer).toHaveAttribute('data-scope', 'country');
	await expect(explorer.getByTestId('national-accessibility-score')).toBeInViewport();
	await expect(explorer.getByTestId('country-map-introduction')).toBeInViewport();
	await expect(
		explorer.getByRole('button', { name: 'Find out why', exact: true })
	).toBeInViewport();
	await expect(atlas).toHaveAttribute('aria-busy', 'false');
	await expect(atlas).toHaveAttribute('data-accessibility-overview', 'true');
	await expect.poll(async () => Number(await atlas.getAttribute('data-zoom'))).toBeLessThan(8);
	await floatingNavigation();
	const bounds = await atlas.boundingBox();
	const viewport = page.viewportSize();
	assert.ok(bounds && viewport);
	assert.ok(Math.abs(bounds.y) <= 1, 'The map starts at the top of the viewport');
	assert.ok(Math.abs(bounds.height - viewport.height) <= 1, 'The map fills the viewport');
	await noOverflow();
}

/** Project a real island coordinate using the rendered camera and public padding attributes.
 * @param {[number,number]} coordinates
 */
async function visibleMapPoint(coordinates) {
	return atlas.evaluate((element, location) => {
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
		return { visible: !!document.elementFromPoint(x, y)?.matches('.maplibregl-canvas'), x, y };
	}, coordinates);
}

async function returnToAnalytics() {
	await navigation.getByRole('button', { name: 'Analytics', exact: true }).click();
	await expect(header).toBeVisible();
	await expect(header.getByRole('navigation', { name: 'Workspace', exact: true })).toBeVisible();
	await expect(page.getByRole('region', { name: 'National analytics', exact: true })).toBeVisible();
}

try {
	const response = await page.request.get(`${baseURL}/api/backend/map/features?layer=islands`);
	assert.equal(response.status(), 200);
	/** @type {{features:Array<{properties:{id:string,name:string,atoll:string,centroid:[number,number]}}>}} */
	const data = await response.json();
	const island = data.features.find((feature) => feature.properties.id === 'island:1442');
	assert.ok(island, 'The real planning island is available');
	const target = island.properties;

	await page.goto(`${baseURL}/?view=overview`, { waitUntil: 'domcontentloaded' });
	await check('Analytics restores the dynamic island navigation', async () => {
		await expect(header).toBeVisible();
		const navigation = header.getByRole('navigation', { name: 'Workspace', exact: true });
		await expect(navigation).toHaveClass(/navigation-island/);
		for (const name of ['Analytics', 'Map & planning', 'Evidence'])
			await expect(navigation.getByRole('button', { name, exact: true })).toBeVisible();
		await expect(
			navigation.getByRole('button', { name: 'Analytics', exact: true })
		).toHaveAttribute('aria-current', 'page');
		const dashboard = page.getByRole('region', { name: 'National analytics', exact: true });
		await expect(dashboard).toBeVisible();
		await expect(dashboard).toHaveAttribute('aria-busy', 'false');
		await noOverflow();
		await page.screenshot({ path: path.join(output, 'analytics-desktop.png') });
	});
	await check('Evidence uses the same top navigation and returns directly to the map', async () => {
		await header.getByRole('button', { name: 'Evidence', exact: true }).click();
		await expect(
			page.getByRole('heading', { name: 'Evidence, with the edges visible.', exact: true })
		).toBeVisible();
		await expect(header.getByRole('button', { name: 'Evidence', exact: true })).toHaveAttribute(
			'aria-current',
			'page'
		);
		await header.getByRole('button', { name: 'Map & planning', exact: true }).click();
		await countryReady();
		await expect(explorer.getByRole('button', { name: 'Find out why', exact: true })).toBeVisible();
		await page.screenshot({ path: path.join(output, 'country-desktop.png') });
	});
	await check(
		'The country map drills into an island and restores the detailed map tools',
		async () => {
			await explorer.getByRole('button', { name: 'Find out why', exact: true }).click();
			await explorer.locator('[data-atoll]').filter({ hasText: target.atoll }).click();
			await expect(explorer).toHaveAttribute('data-scope', 'atoll');
			await expect.poll(async () => (await visibleMapPoint(target.centroid)).visible).toBe(true);
			const point = await visibleMapPoint(target.centroid);
			await page.mouse.click(point.x, point.y);
			await expect(atlas).toHaveAttribute('data-accessibility-overview', 'false');
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-zoom')))
				.toBeGreaterThan(11);
			await expect(explorer).not.toBeVisible();
			await expect(page.getByLabel('Service coverage map', { exact: true })).toBeVisible();
			await expect(page.getByLabel('Explore supporting tools', { exact: true })).toBeVisible();
			await expect(
				page.getByRole('button', { name: 'Create proposal', exact: true })
			).toBeVisible();
			await floatingNavigation();
			await page.locator('.policy-inspect-trigger').click();
			await expect(planning).toBeVisible();
			await expect(planning).toHaveAttribute('data-policy-section', 'needs');
			await expect(planning.getByRole('heading', { name: target.name, exact: true })).toBeVisible();
			await expect(
				planning.getByRole('button', { name: 'Island details & directions', exact: true })
			).toBeVisible();
			await noOverflow();
			await page.screenshot({ path: path.join(output, 'island-desktop.png') });
			return { island: target.id, cameraZoom: await atlas.getAttribute('data-zoom') };
		}
	);
	await check(
		'The island proposal tools remain connected to the map and country reset',
		async () => {
			await planning
				.getByRole('button', { name: 'Close island planning panel', exact: true })
				.click();
			await page.getByRole('button', { name: 'Create proposal', exact: true }).click();
			await expect(planning).toHaveAttribute('data-policy-section', 'proposal');
			await expect(planning.getByLabel('Capital budget · MVR', { exact: true })).toBeVisible();
			await expect(
				planning.getByLabel('Annual running budget · MVR', { exact: true })
			).toBeVisible();
			await expect(
				planning.getByRole('button', { name: 'Suggest investments within my budget', exact: true })
			).toBeEnabled();
			await expect(atlas.locator('.maplibregl-canvas')).toBeVisible();
			await floatingNavigation();
			await page.screenshot({ path: path.join(output, 'proposal-desktop.png') });
			await atlas.getByRole('button', { name: 'Show all Maldives islands', exact: true }).click();
			await countryReady();
			await expect(planning).not.toBeVisible();
			await returnToAnalytics();
			await noOverflow();
		}
	);
	await check(
		'Mobile retains the same visible navigation across analytics and the full-screen map',
		async () => {
			await page.setViewportSize({ width: 390, height: 844 });
			await expect(header).toBeVisible();
			for (const name of ['Analytics', 'Map & planning', 'Evidence'])
				await expect(header.getByRole('button', { name, exact: true })).toBeInViewport();
			await noOverflow();
			await page.screenshot({ path: path.join(output, 'analytics-mobile.png') });
			await header.getByRole('button', { name: 'Map & planning', exact: true }).click();
			await countryReady();
			await explorer.getByRole('button', { name: 'Find out why', exact: true }).click();
			await explorer.locator('[data-atoll]').filter({ hasText: target.atoll }).click();
			await expect(explorer).toHaveAttribute('data-scope', 'atoll');
			await explorer.locator(`[data-island-id="${target.id}"]`).click();
			await expect(explorer).not.toBeVisible();
			await expect(page.getByLabel('Service coverage map', { exact: true })).toBeVisible();
			await expect(
				page.getByRole('button', { name: 'Create proposal', exact: true })
			).toBeInViewport();
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-policy-gap-cells')))
				.toBeGreaterThan(0);
			await expect(atlas).toHaveAttribute('aria-busy', 'false');
			await floatingNavigation();
			await noOverflow();
			await page.screenshot({ path: path.join(output, 'island-mobile.png') });
			await page.getByRole('button', { name: 'Create proposal', exact: true }).click();
			await expect(planning).toHaveAttribute('data-policy-section', 'proposal');
			await expect(planning.getByLabel('Capital budget · MVR', { exact: true })).toBeInViewport();
			await floatingNavigation();
			await noOverflow();
			await page.screenshot({ path: path.join(output, 'proposal-mobile.png') });
			await returnToAnalytics();
			await expect(header).toBeInViewport();
		}
	);
	await check(
		'Tablet and compact phones keep navigation visible and separate from map controls',
		async () => {
			await page.setViewportSize({ width: 820, height: 1180 });
			await header.getByRole('button', { name: 'Map & planning', exact: true }).click();
			await countryReady();
			await page.screenshot({ path: path.join(output, 'country-tablet.png') });
			await explorer.getByRole('button', { name: 'Find out why', exact: true }).click();
			await explorer.locator('[data-atoll]').filter({ hasText: target.atoll }).click();
			await explorer.locator(`[data-island-id="${target.id}"]`).click();
			await expect(explorer).not.toBeVisible();
			await expect(page.getByLabel('Service coverage map', { exact: true })).toBeVisible();
			await floatingNavigation();
			const zoomIn = atlas.locator('.maplibregl-ctrl-zoom-in');
			await expect(zoomIn).toBeEnabled();
			assert.equal(
				await zoomIn.evaluate((element) => {
					const rect = element.getBoundingClientRect();
					return element.contains(
						document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
					);
				}),
				true,
				'Island information leaves the native zoom control clickable'
			);
			await noOverflow();
			await page.screenshot({ path: path.join(output, 'island-tablet.png') });
			await returnToAnalytics();
			await page.setViewportSize({ width: 320, height: 812 });
			await header.getByRole('button', { name: 'Map & planning', exact: true }).click();
			await countryReady();
			await page.screenshot({ path: path.join(output, 'country-compact-mobile.png') });
			await returnToAnalytics();
		}
	);
	await check(
		'Zooming into an island opens its detailed tools without an extra selection step',
		async () => {
			await page.setViewportSize({ width: 1440, height: 1000 });
			await header.getByRole('button', { name: 'Map & planning', exact: true }).click();
			await countryReady();
			await explorer.getByRole('button', { name: 'Find out why', exact: true }).click();
			await explorer.locator('[data-atoll]').filter({ hasText: target.atoll }).click();
			await expect(explorer).toHaveAttribute('data-scope', 'atoll');
			await expect(atlas).toHaveAttribute('data-accessibility-overview', 'true');
			report.gestures = [];
			for (let step = 0; step < 5; step += 1) {
				if ((await atlas.getAttribute('data-accessibility-overview')) === 'false') break;
				await expect.poll(async () => (await visibleMapPoint(target.centroid)).visible).toBe(true);
				const point = await visibleMapPoint(target.centroid);
				const before = Number(await atlas.getAttribute('data-zoom'));
				await page.mouse.move(point.x, point.y);
				await page.mouse.wheel(0, -1800);
				await expect
					.poll(async () => Number(await atlas.getAttribute('data-zoom')))
					.toBeGreaterThan(before + 0.1);
				report.gestures.push({
					pointer: { x: point.x, y: point.y },
					zoomBefore: before,
					zoomAfter: Number(await atlas.getAttribute('data-zoom'))
				});
			}
			await expect(explorer).not.toBeVisible();
			await expect(atlas).toHaveAttribute('data-accessibility-overview', 'false');
			await expect(page).toHaveURL((url) => url.searchParams.get('island') === target.id);
			await expect(page.getByLabel('Service coverage map', { exact: true })).toBeVisible();
			await expect(
				page.getByRole('button', { name: 'Create proposal', exact: true })
			).toBeVisible();
			await page.screenshot({ path: path.join(output, 'zoom-drilldown-desktop.png') });
			await atlas.getByRole('button', { name: 'Show all Maldives islands', exact: true }).click();
			await countryReady();
			await returnToAnalytics();
			return { island: target.id };
		}
	);
	await check('Navigation and drilldown complete without browser runtime errors', async () => {
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
