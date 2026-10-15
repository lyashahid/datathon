import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const baseURL = process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5181';
const output = path.resolve('artifacts/qa/policymaker-journey');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 60000 });
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1000 },
	reducedMotion: 'reduce'
});
const page = await context.newPage();
page.setDefaultTimeout(60000);
/** @type {{name:string,status:string,details?:unknown}[]} */
const checks = [];
/** @type {string[]} */
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
/** @param {string} name @param {()=>Promise<unknown>} work */
async function check(name, work) {
	console.log(`RUN ${name}`);
	const details = await work();
	checks.push({ name, status: 'passed', details });
	console.log(`PASS ${name}`);
}
/** @param {string} name */
const tool = (name) =>
	page
		.getByRole('tablist', { name: 'Map workspace tools' })
		.getByRole('tab', { name, exact: true });
/** @param {import('@playwright/test').Locator} canvas @param {number} x @param {number} y */
async function clickCanvas(canvas, x, y) {
	const box = await canvas.boundingBox();
	assert.ok(box);
	await canvas.click({ position: { x: box.width * x, y: box.height * y } });
}
async function noOverflow() {
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
		.toBe(true);
}
try {
	await check(
		'Delayed startup waits for the selected island before showing location tools',
		async () => {
			const startup = await context.newPage();
			startup.on('pageerror', (error) => errors.push(error.message));
			let releaseGeometry = () => {};
			const geometryGate = new Promise((resolve) => {
				releaseGeometry = () => resolve(undefined);
			});
			/** @type {(value:import('../src/lib/types').MapFeatures)=>void} */
			let captureGeometry = () => {};
			/** @type {Promise<import('../src/lib/types').MapFeatures>} */
			const actualGeometry = new Promise((resolve) => {
				captureGeometry = resolve;
			});
			await startup.route('**/api/backend/map/features?layer=all', async (route) => {
				const response = await route.fetch();
				captureGeometry(await response.json());
				await geometryGate;
				await route.fulfill({ response });
			});
			try {
				const loaded = startup.waitForResponse((response) =>
					response.url().includes('/api/backend/map/features?layer=all')
				);
				await startup.goto(`${baseURL}/?view=map&tool=places&island=island%3A1442`, {
					waitUntil: 'domcontentloaded'
				});
				await expect(
					startup.getByRole('status').filter({ hasText: 'Preparing the selected island' })
				).toBeVisible();
				const actual = await actualGeometry;
				await expect(startup.locator('.places-workspace')).toHaveCount(0);
				const startupTools = startup.getByRole('tablist', { name: 'Map workspace tools' });
				await startupTools.getByRole('tab', { name: 'Explore', exact: true }).click();
				for (const name of ['Route', 'Find a place', 'Create proposal'])
					await expect(startup.getByRole('button', { name, exact: true })).toBeDisabled();
				await startupTools.getByRole('tab', { name: 'Places & directions', exact: true }).click();
				releaseGeometry();
				const response = await loaded;
				assert.equal(response.status(), 200);
				const island = actual.features.find((feature) => feature.properties?.id === 'island:1442');
				assert.ok(island);
				const point = island.properties?.centroid;
				assert.ok(Array.isArray(point) && point.length === 2);
				const locationMap = startup.locator('.places-workspace .location-map');
				await expect(locationMap).toHaveAttribute('data-origin', `${point[0]},${point[1]}`);
				await expect(locationMap).toContainText(`Search area · ${island.properties?.name}`);
				return {
					requestedIsland: island.properties?.name,
					actualOrigin: point,
					deferredGeometry: true
				};
			} finally {
				releaseGeometry();
				await startup.unrouteAll({ behavior: 'wait' });
				await startup.close();
			}
		}
	);
	await page.goto(`${baseURL}/?view=map&tool=explore&island=island%3A1443`);
	const atlas = page.locator('.national-map');
	const canvas = atlas.locator('.maplibregl-canvas');
	await check('Explore opens a clean street map with on-demand details and key', async () => {
		await expect(canvas).toBeVisible();
		await expect
			.poll(async () => Number(await atlas.getAttribute('data-context-roads')))
			.toBeGreaterThan(0);
		await expect(page.getByRole('complementary', { name: 'Planning details' })).toBeHidden();
		await expect(atlas.getByRole('button', { name: 'Map key', exact: true })).toHaveAttribute(
			'aria-expanded',
			'false'
		);
		assert.equal(await page.locator('.maplibregl-canvas:visible').count(), 1);
		await noOverflow();
		await page.screenshot({ path: path.join(output, 'explore-desktop.png') });
		return { defaultReportClosed: true, visibleMaps: 1 };
	});
	await check(
		'Clicking the canvas opens useful location actions rather than a coordinate form',
		async () => {
			await clickCanvas(canvas, 0.75, 0.35);
			await expect(atlas.getByRole('region', { name: 'Selected map location' })).toBeVisible();
			await expect(atlas.getByRole('button', { name: 'A · Start here' })).toBeVisible();
			await expect(atlas.getByRole('button', { name: 'Create proposal here' })).toBeVisible();
			await atlas.getByRole('button', { name: 'A · Start here' }).click();
			await expect(atlas.locator('.journey-drag-pin.start')).toBeVisible();
			await expect(page.locator('.journey-place-readout')).toContainText('Selected on map');
			return { actions: ['start', 'end', 'proposal'], immediateStartPin: true };
		}
	);
	await check(
		'Map-first endpoint selection shows both pins, then dragging clears the old route',
		async () => {
			await page.getByRole('button', { name: 'Change start', exact: true }).click();
			await canvas.press('Enter');
			await expect(page.locator('.pick-banner')).toContainText('Choose the route end');
			await canvas.press('ArrowUp');
			await canvas.press('Enter');
			await expect(atlas).toHaveAttribute('data-journey-endpoints', '2');
			await expect(atlas.locator('.journey-drag-pin.end')).toBeVisible();
			const pending = page.waitForResponse(
				(r) => r.url().includes('/routing/land') && r.request().method() === 'POST'
			);
			await page.getByRole('button', { name: 'Find shortest path', exact: true }).click();
			const response = await pending;
			assert.equal(response.status(), 200);
			const result = await response.json();
			const pin = atlas.locator('.journey-drag-pin.end');
			const box = await pin.boundingBox();
			assert.ok(box);
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
			await page.mouse.down();
			await page.mouse.move(box.x + box.width / 2 + 28, box.y + box.height / 2 + 12, { steps: 12 });
			await page.mouse.up();
			await expect(page.locator('.journey-place-readout')).toContainText('Adjusted on map');
			await expect(atlas).toHaveAttribute('data-journey-route-segments', '0');
			await page.getByRole('button', { name: 'Expand planning details', exact: true }).click();
			await expect(page.locator('.map-workspace')).toHaveClass(/panel-expanded/);
			await page.getByRole('button', { name: 'Collapse island details', exact: true }).click();
			return { routingStatus: result.status, staleShapeRemoved: true, expandedDetails: true };
		}
	);
	await check(
		'Leaving the workspace cancels an in-flight route and preserves the current map state',
		async () => {
			await page.getByRole('button', { name: 'Route', exact: true }).click();
			/** @type {(value?:unknown)=>void} */
			let release = () => {};
			let fetchedStatus = 0;
			/** @type {(value?:unknown)=>void} */
			let finished = () => {};
			const hold = new Promise((resolve) => (release = resolve));
			const handled = new Promise((resolve) => (finished = resolve));
			await page.route('**/api/backend/routing/land', async (intercepted) => {
				try {
					const response = await intercepted.fetch();
					const body = await response.body();
					assert.equal(response.status(), 200);
					fetchedStatus = response.status();
					await hold;
					await intercepted.fulfill({ response, body });
				} catch {
					// Cancellation can close the browser request before delayed delivery.
				} finally {
					finished();
				}
			});
			try {
				await page.getByRole('button', { name: 'Find shortest path', exact: true }).click();
				await expect.poll(() => fetchedStatus).toBe(200);
				await page
					.getByRole('navigation', { name: 'Workspace', exact: true })
					.getByRole('button', { name: 'Evidence', exact: true })
					.click();
				await expect(atlas).toHaveAttribute('data-active', 'false');
				await page
					.getByRole('navigation', { name: 'Workspace', exact: true })
					.getByRole('button', { name: 'Map & planning', exact: true })
					.click();
				await expect(atlas).toHaveAttribute('data-active', 'true');
				await page.getByRole('button', { name: 'Route', exact: true }).click();
				await expect(
					page.getByRole('button', { name: 'Find shortest path', exact: true })
				).toBeEnabled();
				release();
				await handled;
				await expect(atlas).toHaveAttribute('data-journey-route-segments', '0');
				await page.getByRole('button', { name: 'Collapse island details', exact: true }).click();
				return { discardedOldRoute: true, draftEndpointsRetained: true };
			} finally {
				release();
				await page.unrouteAll({ behavior: 'wait' });
			}
		}
	);
	await check(
		'Explore proposal placement carries the exact map location into the service composer',
		async () => {
			await page.getByRole('button', { name: 'Create proposal', exact: true }).click();
			await expect(page.locator('.pick-banner')).toContainText(
				'Choose a location for your proposal'
			);
			await canvas.press('Enter');
			const policy = page.getByRole('region', { name: 'Policy planning workbench', exact: true });
			const planningMap = page.getByRole('region', {
				name: 'Interactive proposal map',
				exact: true
			});
			await expect(policy).toBeVisible();
			await expect(policy.locator('#policy-name')).toBeVisible();
			await expect(planningMap.locator('.planning-preview')).toBeVisible();
			await policy.locator('#policy-name').fill('Policymaker journey QA school');
			await policy.getByRole('button', { name: 'Add intervention', exact: true }).click();
			await expect
				.poll(async () => Number(await planningMap.getAttribute('data-draft-features')))
				.toBe(1);
			await page.screenshot({ path: path.join(output, 'proposal-desktop.png') });
			return { immediateDraft: true, intervention: 'school', source: 'Explore map selection' };
		}
	);
	await check(
		'Impact review uses an actual backend evaluation and retains the geographic change',
		async () => {
			const planningMap = page.getByRole('region', {
				name: 'Interactive proposal map',
				exact: true
			});
			const pending = page.waitForResponse(
				(r) => r.url().includes('/planning/evaluate') && r.request().method() === 'POST'
			);
			await planningMap
				.getByRole('button', { name: 'Recalculate map impact', exact: true })
				.click();
			const response = await pending;
			assert.equal(response.status(), 200);
			const result = await response.json();
			await expect(planningMap).toHaveAttribute('data-status', 'latest');
			await planningMap.getByText('Map key and source evidence', { exact: true }).click();
			await expect(page.getByLabel('Resident impact legend', { exact: true })).toBeVisible();
			assert.ok(result.origins.length > 0);
			await writeFile(path.join(output, 'actual-evaluation.json'), JSON.stringify(result, null, 2));
			await page.screenshot({ path: path.join(output, 'impact-desktop.png') });
			return {
				comparedOrigins: result.origins.length,
				gainedResidents: result.summary.gained_residents
			};
		}
	);
	await check(
		'Tool switching preserves the proposal while only the active map is shown',
		async () => {
			await tool('Explore').click();
			await expect(atlas).toBeVisible();
			await expect(page.getByRole('complementary', { name: 'Planning details' })).toBeHidden();
			await tool('Proposals').click();
			await expect(
				page.getByRole('region', { name: 'Interactive proposal map', exact: true })
			).toHaveAttribute('data-status', 'latest');
			assert.equal(await page.locator('.maplibregl-canvas:visible').count(), 1);
			return { recalculationRetained: true, activeCanvasCount: 1 };
		}
	);
	await check('390px map-first exploration and proposal inspector remain usable', async () => {
		const planningMap = page.getByRole('region', { name: 'Interactive proposal map', exact: true });
		const mapKey = planningMap.locator('.planning-map-key');
		if ((await mapKey.getAttribute('open')) !== null)
			await planningMap.getByText('Map key and source evidence', { exact: true }).click();
		await page.setViewportSize({ width: 390, height: 844 });
		await noOverflow();
		const policy = page.getByRole('region', { name: 'Policy planning workbench', exact: true });
		await policy.getByRole('button', { name: 'Close planning details', exact: true }).click();
		await expect(policy.locator('.policy-editor')).toBeHidden();
		await page.screenshot({ path: path.join(output, 'proposal-mobile.png') });
		await tool('Explore').click();
		await expect(page.getByRole('button', { name: 'Create proposal', exact: true })).toBeVisible();
		await page.getByRole('button', { name: 'Island details', exact: true }).click();
		await expect(page.getByRole('complementary', { name: 'Planning details' })).toBeVisible();
		await expect(page.getByRole('tab', { name: 'Island baseline', exact: true })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await expect(page.locator('.map-action-dock')).toBeHidden();
		await page.getByRole('button', { name: 'Expand planning details', exact: true }).click();
		await noOverflow();
		await page.screenshot({ path: path.join(output, 'explore-mobile-details.png') });
		return { width: 390, expandableBottomPanel: true };
	});
	assert.deepEqual(errors, []);
	await writeFile(
		path.join(output, 'report.json'),
		JSON.stringify({ baseURL, status: 'passed', checks, errors }, null, 2)
	);
} catch (error) {
	await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
	await writeFile(
		path.join(output, 'report.json'),
		JSON.stringify({ baseURL, status: 'failed', checks, errors, failure: String(error) }, null, 2)
	);
	throw error;
} finally {
	await browser.close();
}
