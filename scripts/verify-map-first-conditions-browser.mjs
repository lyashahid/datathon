import { browserBaseURL } from './browser-config.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Real frontend/backend/provider responses. No provider records or timings are substituted.
const baseURL = browserBaseURL();
const output = path.resolve('artifacts/qa/map-first-conditions');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 45000 });
/** @type {{baseURL:string,startedAt:string,finishedAt?:string,checks:Array<{name:string,status:string,detail?:unknown}>,pageErrors:string[]}} */
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], pageErrors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1000 },
	reducedMotion: 'reduce'
});
const page = await context.newPage();
page.setDefaultTimeout(45000);
page.on('pageerror', (error) => report.pageErrors.push(error.message));
/** @param {string} name @param {()=>Promise<unknown>} work */
async function check(name, work) {
	console.log(`RUN ${name}`);
	try {
		report.checks.push({ name, status: 'passed', detail: await work() });
		console.log(`PASS ${name}`);
	} catch (error) {
		report.checks.push({ name, status: 'failed', detail: String(error) });
		throw error;
	}
}
async function noOverflow() {
	const size = await page.evaluate(() => ({
		viewport: innerWidth,
		document: document.documentElement.scrollWidth,
		body: document.body.scrollWidth
	}));
	assert.ok(
		size.document <= size.viewport + 1 && size.body <= size.viewport + 1,
		JSON.stringify(size)
	);
	return size;
}
/** @param {import('@playwright/test').Locator} region @param {string} name */
async function pointValue(region, name) {
	return (await region.getAttribute(name)) ?? '';
}
/** @param {import('@playwright/test').Locator} region */
async function clickMap(region) {
	const canvas = region.locator('canvas.maplibregl-canvas');
	await expect(canvas).toBeVisible();
	await canvas.click({ position: { x: 270, y: 190 } });
}
try {
	await check(
		'Weather opens at the chosen island, with a visual point and collapsed coordinates',
		async () => {
			const weatherResponse = page.waitForResponse(
				(response) =>
					response.url().includes('/api/backend/conditions/weather?') &&
					Number(new URL(response.url()).searchParams.get('latitude')) > 4.2
			);
			await page.goto(`${baseURL}/?view=map&tool=live&context=conditions&island=island%3A1442`);
			const workspace = page.locator('.operations-workspace');
			await expect(workspace).toBeVisible();
			await expect(
				workspace.getByRole('tab', { name: 'Weather & sea', exact: true })
			).toHaveAttribute('aria-selected', 'true');
			const map = workspace.getByRole('region', {
				name: 'Weather forecast location map',
				exact: true
			});
			await expect(map.locator('.location-endpoint.origin')).toBeVisible();
			await expect
				.poll(async () => Number((await pointValue(map, 'data-origin')).split(',')[1]))
				.toBeGreaterThan(4.2);
			await expect(workspace.locator('#conditions-lat')).not.toBeVisible();
			await expect(workspace).toContainText('Hulhumalé · forecast location');
			const response = await weatherResponse;
			const payload = await response.json();
			if (response.ok()) await expect(workspace.locator('.metrics')).not.toContainText('Loading');
			else await expect(workspace.locator('.error')).toBeVisible();
			await expect(
				workspace.getByRole('button', { name: 'Update forecast', exact: false })
			).toBeEnabled();
			return {
				responseStatus: response.status(),
				status: payload.status ?? payload.error?.message,
				...(await noOverflow())
			};
		}
	);
	await check(
		'Choosing a forecast location on the map requests its actual coordinates',
		async () => {
			const map = page.getByRole('region', { name: 'Weather forecast location map', exact: true });
			const original = await pointValue(map, 'data-origin');
			const previous = original.split(',').map(Number);
			await map
				.locator('.point-toolbar')
				.getByRole('button', { name: /Hulhumalé · forecast location/ })
				.click();
			const responsePending = page.waitForResponse(
				(response) =>
					response.url().includes('/api/backend/conditions/weather?') &&
					(Math.abs(Number(new URL(response.url()).searchParams.get('latitude')) - previous[1]) >
						1e-7 ||
						Math.abs(Number(new URL(response.url()).searchParams.get('longitude')) - previous[0]) >
							1e-7)
			);
			await clickMap(map);
			await expect(map).not.toHaveAttribute('data-origin', original);
			await expect(page.locator('.weather-location-card')).toContainText(
				'Selected forecast location'
			);
			const response = await responsePending;
			const coordinate = (await pointValue(map, 'data-origin')).split(',').map(Number);
			const url = new URL(response.url());
			assert.ok(Math.abs(Number(url.searchParams.get('latitude')) - coordinate[1]) < 1e-7);
			assert.ok(Math.abs(Number(url.searchParams.get('longitude')) - coordinate[0]) < 1e-7);
			return { location: coordinate, responseStatus: response.status() };
		}
	);
	await check(
		'Traffic picks B visually and keeps a guide separate from a calculated route',
		async () => {
			await page
				.locator('.operations-workspace')
				.getByRole('tab', { name: 'Live traffic', exact: true })
				.click();
			const map = page.getByRole('region', { name: 'Live traffic route map', exact: true });
			await expect(map).toBeVisible();
			await expect(
				page.getByRole('button', { name: 'Check traffic-aware routes', exact: false })
			).toBeDisabled();
			await expect(
				page.locator('.traffic-card').getByLabel('Origin latitude', { exact: true })
			).not.toBeVisible();
			await clickMap(map);
			await expect(map.locator('.location-endpoint.destination')).toBeVisible();
			await expect(
				page.getByRole('button', { name: 'Check traffic-aware routes', exact: false })
			).toBeEnabled();
			await expect(map).toContainText('Endpoint guide · route not calculated');
			await expect(map.locator('.map-source')).toContainText('OpenStreetMap streets & buildings');
			await page.screenshot({
				path: path.join(output, 'traffic-map-first-desktop.png'),
				fullPage: true
			});
			return {
				origin: await pointValue(map, 'data-origin'),
				destination: await pointValue(map, 'data-destination'),
				...(await noOverflow())
			};
		}
	);
	await check(
		'Provider traffic uses the selected points and retains route-shape evidence honestly',
		async () => {
			const map = page.getByRole('region', { name: 'Live traffic route map', exact: true });
			const responsePending = page.waitForResponse(
				(response) => response.url().includes('/api/backend/conditions/traffic'),
				{ timeout: 90000 }
			);
			await page.getByRole('button', { name: 'Check traffic-aware routes', exact: false }).click();
			const response = await responsePending;
			const payload = await response.json();
			const request = response.request().postDataJSON();
			const origin = (await pointValue(map, 'data-origin')).split(',').map(Number);
			const destination = (await pointValue(map, 'data-destination')).split(',').map(Number);
			assert.deepEqual(request.origin, { latitude: origin[1], longitude: origin[0] });
			assert.deepEqual(request.destination, {
				latitude: destination[1],
				longitude: destination[0]
			});
			if (response.ok()) {
				await expect(page.locator('.traffic-results')).toBeVisible();
				const route = payload.data.routes[0];
				if (route?.geometry?.coordinates?.length > 1)
					await expect(map.locator('.route-caption')).not.toContainText('Endpoint guide');
				else await expect(map).toContainText('Endpoint guide · route not calculated');
				await page.screenshot({
					path: path.join(output, 'provider-traffic-evidence-desktop.png'),
					fullPage: true
				});
			} else {
				await expect(page.locator('.operations-workspace .error')).toBeVisible();
				await expect(page.locator('.traffic-results')).not.toBeVisible();
				await expect(map).toContainText('Endpoint guide · route not calculated');
			}
			return {
				responseStatus: response.status(),
				routes: payload.data?.routes?.length ?? 0,
				qualification: payload.receipt?.qualification ?? payload.error?.message
			};
		}
	);
	await check(
		'Dragging a destination updates B, clears old results, and swap/reset remain connected',
		async () => {
			const map = page.getByRole('region', { name: 'Live traffic route map', exact: true });
			const before = await pointValue(map, 'data-destination');
			const pin = map.locator('.location-endpoint.destination');
			await pin.scrollIntoViewIfNeeded();
			const box = await pin.boundingBox();
			assert.ok(box);
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
			await page.mouse.down();
			await page.mouse.move(box.x + box.width / 2 + 55, box.y + box.height / 2 + 35, { steps: 12 });
			await page.mouse.up();
			await expect(map).not.toHaveAttribute('data-destination', before);
			await expect(page.locator('.traffic-results')).not.toBeVisible();
			await expect(map).toContainText('Endpoint guide · route not calculated');
			const origin = await pointValue(map, 'data-origin'),
				destination = await pointValue(map, 'data-destination');
			await page.getByRole('button', { name: 'Swap A & B', exact: false }).click();
			await expect(map).toHaveAttribute('data-origin', destination);
			await expect(map).toHaveAttribute('data-destination', origin);
			await page.getByRole('button', { name: 'Reset points', exact: true }).click();
			await expect(map).toHaveAttribute('data-destination', '');
			await expect(
				page.getByRole('button', { name: 'Check traffic-aware routes', exact: false })
			).toBeDisabled();
			return { dragChanged: before !== destination, swapVerified: true, resetVerified: true };
		}
	);
	await check(
		'Mobile map remains primary and keyboard users can choose the map center',
		async () => {
			await page.setViewportSize({ width: 390, height: 844 });
			const map = page.getByRole('region', { name: 'Live traffic route map', exact: true });
			await map.getByRole('button', { name: 'Use map center', exact: false }).click();
			await expect(map.locator('.location-endpoint.destination')).toBeVisible();
			await expect(
				page.locator('.traffic-card').getByLabel('Destination longitude', { exact: true })
			).not.toBeVisible();
			await expect(map).toContainText('Endpoint guide · route not calculated');
			await map
				.locator('.point-toolbar')
				.getByRole('button', { name: /Selected destination/ })
				.click();
			await clickMap(map);
			await map.getByRole('button', { name: 'Show selected locations', exact: true }).click();
			await expect(map.locator('.location-endpoint.origin')).toBeVisible();
			await expect(map.locator('.location-endpoint.destination')).toBeVisible();
			await expect(map.locator('.map-source')).toContainText('OpenStreetMap streets & buildings');
			await page.keyboard.press('Control+Home');
			const primaryAction = await page
				.getByRole('button', { name: 'Check traffic', exact: false })
				.boundingBox();
			const canvas = await map.locator('canvas.maplibregl-canvas').boundingBox();
			assert.ok(
				primaryAction && primaryAction.y >= 0 && primaryAction.y + primaryAction.height <= 844
			);
			assert.ok(canvas && canvas.height >= 250 && canvas.y < 844 - 250);
			await page.screenshot({
				path: path.join(output, 'traffic-map-first-mobile.png'),
				fullPage: true
			});
			return { primaryAction, canvas, ...(await noOverflow()) };
		}
	);
	await check(
		'Mobile traffic details open, expand, and close over the map without leaving the viewport',
		async () => {
			const openButton = page.getByRole('button', { name: 'Route details', exact: true });
			await openButton.click();
			const inspector = page.getByRole('region', {
				name: 'Traffic details inspector',
				exact: true
			});
			await expect(inspector).toBeVisible();
			let bounds = await inspector.boundingBox();
			assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 844);
			await expect(
				inspector.getByLabel('Destination longitude', { exact: true })
			).not.toBeVisible();
			await page.getByRole('button', { name: 'Expand route details', exact: true }).click();
			await expect(inspector).toHaveClass(/expanded/);
			await expect
				.poll(async () => (await inspector.boundingBox())?.height ?? 0)
				.toBeGreaterThan(760);
			bounds = await inspector.boundingBox();
			assert.ok(
				bounds && bounds.y >= 0 && bounds.height > 760 && bounds.y + bounds.height <= 844,
				JSON.stringify(bounds)
			);
			await page.screenshot({
				path: path.join(output, 'traffic-inspector-expanded-mobile.png'),
				fullPage: true
			});
			await page.getByRole('button', { name: 'Close route details', exact: true }).click();
			await expect(inspector).not.toBeVisible();
			await expect(openButton).toBeFocused();
			return { expandedBounds: bounds, ...(await noOverflow()) };
		}
	);
	await check(
		'Mobile weather keeps update and canvas in view, with forecasts inside its expandable inspector',
		async () => {
			await page
				.locator('.operations-workspace')
				.getByRole('tab', { name: 'Weather & sea', exact: true })
				.click();
			await page.keyboard.press('Control+Home');
			const map = page.getByRole('region', { name: 'Weather forecast location map', exact: true });
			const action = await page
				.getByRole('button', { name: 'Update forecast', exact: false })
				.boundingBox();
			const canvas = await map.locator('canvas.maplibregl-canvas').boundingBox();
			assert.ok(action && action.y >= 0 && action.y + action.height <= 844);
			assert.ok(canvas && canvas.height >= 250 && canvas.y < 844 - 250);
			await page.screenshot({
				path: path.join(output, 'weather-map-first-mobile.png'),
				fullPage: true
			});
			await page.getByRole('button', { name: 'Weather details', exact: true }).click();
			const inspector = page.getByRole('region', {
				name: 'Weather details inspector',
				exact: true
			});
			await expect(inspector.locator('.metrics')).toBeVisible();
			await page.getByRole('button', { name: 'Expand weather details', exact: true }).click();
			await expect(inspector).toHaveClass(/expanded/);
			await expect
				.poll(async () => (await inspector.boundingBox())?.height ?? 0)
				.toBeGreaterThan(760);
			const expanded = await inspector.boundingBox();
			assert.ok(
				expanded && expanded.height > 760 && expanded.y + expanded.height <= 844,
				JSON.stringify(expanded)
			);
			await page.getByRole('button', { name: 'Close weather details', exact: true }).click();
			await expect(inspector).not.toBeVisible();
			return { primaryAction: action, canvas, expandedBounds: expanded, ...(await noOverflow()) };
		}
	);
	await check(
		'Mobile traffic action opens real results and keeps every route alternative available',
		async () => {
			await page
				.locator('.operations-workspace')
				.getByRole('tab', { name: 'Live traffic', exact: true })
				.click();
			const responsePending = page.waitForResponse(
				(response) => response.url().includes('/api/backend/conditions/traffic'),
				{ timeout: 90000 }
			);
			await page.getByRole('button', { name: 'Check traffic', exact: false }).click();
			const response = await responsePending;
			const payload = await response.json();
			const inspector = page.getByRole('region', {
				name: 'Traffic details inspector',
				exact: true
			});
			if (!response.ok()) {
				await expect(page.locator('.operations-workspace .error')).toBeVisible();
				return { responseStatus: response.status(), unavailable: payload.error?.message };
			}
			await expect(inspector).toBeVisible();
			const results = inspector.locator('.traffic-results');
			await expect(results).toBeVisible();
			const routeButtons = results.locator('.traffic-alternatives button');
			await expect(routeButtons).toHaveCount(payload.data.routes.length);
			const dimensions = await results.evaluate((element) => ({
				visibleHeight: element.clientHeight,
				contentHeight: element.scrollHeight
			}));
			assert.ok(
				dimensions.contentHeight <= dimensions.visibleHeight + 2,
				`Result card clips alternatives: ${JSON.stringify(dimensions)}`
			);
			await page.screenshot({ path: path.join(output, 'traffic-results-mobile.png') });
			if (payload.data.routes.length > 1) {
				const last = routeButtons.last();
				await last.scrollIntoViewIfNeeded();
				await last.click();
				await expect(last).toHaveAttribute('aria-pressed', 'true');
			}
			await page.getByRole('button', { name: 'Expand route details', exact: true }).click();
			await expect
				.poll(async () => (await inspector.boundingBox())?.height ?? 0)
				.toBeGreaterThan(760);
			await page.screenshot({ path: path.join(output, 'traffic-results-expanded-mobile.png') });
			return {
				responseStatus: response.status(),
				routes: payload.data.routes.length,
				resultCard: dimensions,
				...(await noOverflow())
			};
		}
	);
	assert.deepEqual(report.pageErrors, []);
} finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
	await browser.close();
}
console.log(
	JSON.stringify({ checks: report.checks.length, pageErrors: report.pageErrors.length, output })
);
