import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Uses the application's actual place, direction and imagery adapters. No provider
// responses are replaced, and this workflow does not create a policy proposal.
const baseURL = process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5173';
const output = path.resolve('artifacts/qa/map-first-places');
const expect = playwrightExpect.configure({ timeout: 30000 });
await mkdir(output, { recursive: true });
/** @type {{baseURL:string,startedAt:string,finishedAt?:string,checks:Array<{name:string,status:string,milliseconds:number,details?:unknown,message?:string}>,pageErrors:string[]}} */
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], pageErrors: [] };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1000 },
	reducedMotion: 'reduce'
});
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.on('pageerror', (error) => report.pageErrors.push(error.message));
const workspace = page.locator('.places-workspace');
const map = workspace.locator('.location-map');
const inspector = workspace.locator('#places-research-inspector');
/** @param {string} fragment */
const responseFor = (fragment) => {
	const pending = page.waitForResponse(
		(response) => response.url().includes(`/api/backend/places/${fragment}`),
		{
			timeout: 90000
		}
	);
	pending.catch(() => {});
	return pending;
};

/** @param {string} name @param {() => Promise<unknown>} work */
async function check(name, work) {
	const started = Date.now();
	console.log(`RUN ${name}`);
	try {
		const details = await work();
		report.checks.push({ name, status: 'passed', milliseconds: Date.now() - started, details });
		console.log(`PASS ${name}`);
	} catch (error) {
		report.checks.push({
			name,
			status: 'failed',
			milliseconds: Date.now() - started,
			message: error instanceof Error ? error.message : String(error)
		});
		throw error;
	}
}

/** @param {string} buttonName @param {{x:number,y:number}} position */
async function chooseMapPoint(buttonName, position = { x: 0.58, y: 0.62 }) {
	await workspace.getByRole('button', { name: buttonName, exact: true }).click();
	const canvas = map.locator('.maplibregl-canvas');
	const box = await canvas.boundingBox();
	assert.ok(box);
	await canvas.click({ position: { x: box.width * position.x, y: box.height * position.y } });
}

async function noOverflow() {
	await expect
		.poll(() =>
			page.evaluate(
				() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
			)
		)
		.toBe(true);
	return page.evaluate(() => ({
		width: innerWidth,
		document: document.documentElement.scrollWidth
	}));
}

try {
	await page.goto(`${baseURL}/?view=map&tool=places&island=island%3A1442`, {
		waitUntil: 'domcontentloaded'
	});
	await expect(
		workspace.getByRole('heading', { name: 'Places & journeys', exact: true })
	).toBeVisible();
	await expect(map.locator('.maplibregl-canvas')).toBeVisible();
	await expect(workspace.getByText('Vela connected', { exact: true })).toBeVisible();
	await check('clean map home and optional details', async () => {
		await expect(inspector).toBeHidden();
		await expect(workspace.locator('input[type="number"]:visible')).toHaveCount(0);
		await workspace.getByRole('button', { name: 'Search results & details', exact: true }).click();
		await expect(inspector).toBeVisible();
		await workspace.getByRole('button', { name: 'Hide details', exact: true }).click();
		await expect(inspector).toBeHidden();
		await page.screenshot({ path: path.join(output, 'clean-map-home.png') });
		return noOverflow();
	});
	let selectedName = '';
	await check('real nearby search and named listing pins', async () => {
		await workspace
			.getByRole('textbox', { name: 'Place, service or category', exact: true })
			.fill('hospital');
		const pending = responseFor('search?');
		await workspace.getByRole('button', { name: 'Search places', exact: true }).click();
		const response = await pending;
		assert.equal(response.status(), 200);
		const body = await response.json();
		assert.ok(body.data.places.length > 0);
		await expect(inspector).toBeVisible();
		await expect
			.poll(() =>
				map
					.locator('.location-extra-point')
					.evaluateAll((markers) =>
						markers.reduce(
							(count, marker) =>
								count + (marker.classList.contains('grouped') ? Number(marker.textContent) : 1),
							0
						)
					)
			)
			.toBe(body.data.places.length);
		const place = body.data.places[0];
		selectedName = place.name;
		await writeFile(path.join(output, 'actual-place-search.json'), JSON.stringify(body, null, 2));
		await map.getByRole('button', { name: 'Show selected locations', exact: true }).click();
		const details = responseFor('details');
		const marker = map.getByTitle(new RegExp(selectedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
		const grouped = (await marker.getAttribute('class'))?.includes('grouped');
		await marker.click();
		if (grouped) await map.getByRole('button', { name: selectedName, exact: true }).click();
		assert.equal((await details).status(), 200);
		await expect(
			workspace.locator('.detail-card').getByRole('heading', { name: selectedName, exact: true })
		).toBeVisible();
		return {
			places: body.data.places.length,
			chosen: selectedName,
			completeness: body.data.completeness
		};
	});
	await check('named destination and actual provider route shown on map', async () => {
		await workspace.getByRole('button', { name: 'Route to this place', exact: true }).click();
		await expect(inspector).toBeHidden();
		await expect(map.locator('.point-toolbar')).toContainText(selectedName);
		await expect(map.locator('.location-endpoint.destination')).toHaveCount(1);
		const pending = responseFor('directions');
		await workspace
			.locator('.map-action-strip')
			.getByRole('button', { name: 'Find directions', exact: true })
			.click();
		const response = await pending;
		assert.equal(response.status(), 200);
		const body = await response.json();
		assert.ok(body.data.routes.length > 0);
		const first = body.data.routes[0];
		assert.ok(
			first.geometry?.coordinates?.length > 1,
			'Actual route geometry must be returned for this test'
		);
		await expect(map.locator('.route-caption')).toHaveText(first.summary || 'Provider route');
		await expect(
			workspace.getByRole('button', { name: 'Selected on map', exact: true })
		).toBeVisible();
		await map.getByRole('button', { name: 'Show selected locations', exact: true }).click();
		await page.screenshot({ path: path.join(output, 'named-provider-route-desktop.png') });
		return {
			routes: body.data.routes.length,
			geometryPoints: first.geometry.coordinates.length,
			summary: first.summary
		};
	});
	await check('dragging a destination invalidates prior route and keeps visible pins', async () => {
		const previous = await map.getAttribute('data-destination');
		const box = await map.locator('.location-endpoint.destination').boundingBox();
		assert.ok(box);
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2 + 28, box.y + box.height / 2 - 16, { steps: 8 });
		await page.mouse.up();
		await expect.poll(() => map.getAttribute('data-destination')).not.toBe(previous);
		await expect(workspace.locator('.route-card')).toHaveCount(0);
		await expect(map.locator('.route-caption')).toHaveText('Endpoint guide · route not calculated');
		await expect(map.locator('.location-endpoint.origin')).toHaveCount(1);
		await expect(map.locator('.location-endpoint.destination')).toHaveCount(1);
		return { previous, updated: await map.getAttribute('data-destination') };
	});
	await check('visual waypoint selection and coordinate-free imagery location', async () => {
		await chooseMapPoint('Add a stop on map');
		await expect(map.getByRole('button', { name: 'Stop 1 · map pin', exact: true })).toHaveCount(1);
		await expect(workspace.locator('.visual-waypoint')).toContainText('Stop 1 · map pin');
		await workspace.getByRole('tab', { name: 'Street View', exact: true }).click();
		await expect(map).toHaveAttribute('aria-label', 'Street View location map');
		await chooseMapPoint('Choose imagery point');
		const coordinates = await map.getAttribute('data-origin');
		assert.ok(coordinates?.includes(','));
		await expect(workspace.locator('#pano-latitude')).toBeHidden();
		await expect(workspace.locator('#pano-longitude')).toBeHidden();
		const pending = responseFor('streetview?');
		await workspace
			.locator('.map-action-strip')
			.getByRole('button', { name: 'Find imagery', exact: true })
			.click();
		const response = await pending;
		const body = await response.json();
		if (response.ok()) {
			await expect(workspace.locator('.pano-facts')).toBeVisible();
			await expect(map.locator('.location-extra-point')).toHaveCount(1);
		} else {
			await expect(workspace.locator('.provider-error[role="alert"]')).toBeVisible();
		}
		return {
			chosenMapPoint: coordinates,
			imageryStatus: response.status(),
			panorama: body.data?.pano_id ?? null,
			unavailableReason: body.error?.message ?? null
		};
	});
	await check('390px map and expandable inspector stay within the actual viewport', async () => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.evaluate(() => window.scrollTo(0, 0));
		const layouts = [];
		for (const [tabName, detailsName, filename] of [
			['Street View', 'Imagery viewer', 'imagery-mobile.png'],
			['Directions', 'Journey details', 'directions-mobile.png'],
			['Discover places', 'Search results & details', 'discovery-mobile.png']
		]) {
			await workspace.getByRole('tab', { name: tabName, exact: true }).click();
			if (await inspector.isVisible())
				await workspace.getByRole('button', { name: 'Close place inspector', exact: true }).click();
			await expect
				.poll(async () => {
					const box = await map.locator('.maplibregl-canvas').boundingBox();
					return !!box && box.y >= 0 && box.height >= 250 && box.y + box.height <= 844;
				})
				.toBe(true);
			await workspace.getByRole('button', { name: detailsName, exact: true }).click();
			await expect
				.poll(async () => {
					const box = await inspector.boundingBox();
					return !!box && box.y >= 0 && box.y + box.height <= 844;
				})
				.toBe(true);
			const collapsedBox = await inspector.boundingBox();
			assert.ok(collapsedBox);
			await workspace.getByRole('button', { name: 'Expand place inspector', exact: true }).click();
			await expect(inspector).toHaveClass(/expanded/);
			await expect
				.poll(async () => {
					const box = await inspector.boundingBox();
					return !!box && box.height > collapsedBox.height + 100;
				})
				.toBe(true);
			const expandedBox = await inspector.boundingBox();
			assert.ok(expandedBox && expandedBox.height > collapsedBox.height + 100);
			assert.ok(expandedBox.y >= 0 && expandedBox.y + expandedBox.height <= 844);
			const heading = inspector.locator('.inspector-heading');
			const headingBox = await heading.boundingBox();
			assert.ok(headingBox);
			await inspector.locator('.inspector-body').evaluate((body) => {
				body.scrollTop = body.scrollHeight;
			});
			const afterScroll = await heading.boundingBox();
			assert.ok(afterScroll && Math.abs(afterScroll.y - headingBox.y) < 1);
			await expect(
				workspace.getByRole('button', { name: 'Close place inspector', exact: true })
			).toBeInViewport();
			await inspector.locator('.inspector-body').evaluate((body) => {
				body.scrollTop = 0;
			});
			await page.screenshot({ path: path.join(output, filename) });
			layouts.push({
				tabName,
				canvas: await map.locator('.maplibregl-canvas').boundingBox(),
				collapsedBox,
				expandedBox
			});
			await workspace.getByRole('button', { name: 'Restore place inspector', exact: true }).click();
			await workspace.getByRole('button', { name: 'Close place inspector', exact: true }).click();
			await noOverflow();
		}
		await expect(
			workspace.getByRole('button', { name: 'Search places', exact: true })
		).toBeInViewport();
		return { layouts, ...(await noOverflow()) };
	});
	assert.equal(report.pageErrors.length, 0, report.pageErrors.join('\n'));
} finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
	await browser.close();
}
console.log(JSON.stringify(report, null, 2));
