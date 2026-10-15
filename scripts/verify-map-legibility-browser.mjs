import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';

expect.configure({ timeout: 45000 });

const baseURL = process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5173';
const output = path.resolve('artifacts/qa/map-legibility');
await mkdir(output, { recursive: true });
/** @type {{baseURL:string,fixtureQualification:string,checks:Array<{name:string,status:string,detail?:unknown}>,errors:string[]}} */
const report = {
	baseURL,
	fixtureQualification:
		'Synthetic movement observations are browser-only QA fixtures. Actual map geometry, infrastructure targets and land route use the backend. Draft changes use disposable browser storage; no backend/source stores are written.',
	checks: [],
	errors: []
};
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1000 },
	reducedMotion: 'reduce'
});
const page = await context.newPage();
page.on('pageerror', (error) => report.errors.push(error.message));
let fixtureVersion = 0;
const receivedAt = new Date().toISOString();
await page.route('**/api/backend/live/snapshot?**', async (route) => {
	const observed = new Date(Date.now() - 60000 + fixtureVersion * 1000).toISOString();
	const events = [
		{
			id: 'qa:aircraft',
			kind: 'aircraft',
			provider: 'browser-qa',
			position: { longitude: 73.51 + fixtureVersion * 0.0001, latitude: 4.18 },
			properties: { flight: 'QA aircraft fixture', track: 90 }
		},
		{
			id: 'qa:vessel',
			kind: 'vessel',
			provider: 'browser-qa',
			position: { longitude: 73.501, latitude: 4.17 + fixtureVersion * 0.0001 },
			properties: { name: 'QA vessel fixture', heading: 30 }
		},
		{
			id: 'qa:bus',
			kind: 'bus',
			provider: 'browser-qa',
			position: { longitude: 73.508, latitude: 4.177 },
			properties: { plateNumber: 'QA bus fixture' }
		}
	].map((event) => ({
		...event,
		stale: false,
		observed_at: event.kind === 'bus' ? null : observed,
		retrieved_at: receivedAt
	}));
	await route.fulfill({
		json: {
			events,
			providers: [
				{
					provider: 'browser-qa',
					enabled: true,
					status: 'ok',
					event_count: 3,
					message: 'Synthetic fixture only'
				}
			],
			retrieved_at: receivedAt,
			coverage: 'browser_only_qa',
			deterministic_data_affected: false,
			poll_interval_seconds: 60
		}
	});
});
/** @param {string} name @param {()=>Promise<unknown>} work */
async function check(name, work) {
	try {
		const detail = await work();
		report.checks.push({ name, status: 'passed', detail });
		console.log(`PASS ${name}`);
	} catch (error) {
		report.checks.push({
			name,
			status: 'failed',
			detail: error instanceof Error ? error.message : String(error)
		});
		throw error;
	}
}
/** @param {string} name @param {number} x @param {number} y */
async function pick(name, x, y) {
	await page.getByRole('button', { name, exact: true }).click();
	await expect(page.locator('.national-map')).toHaveClass(/is-picking/);
	const box = await page.locator('.maplibregl-canvas').boundingBox();
	assert.ok(box);
	await page.mouse.click(box.x + box.width * x, box.y + box.height * y);
	await expect(page.locator('.national-map')).not.toHaveClass(/is-picking/);
}
/** @param {[number,number]} position @param {import('@playwright/test').Page} [targetPage] */
async function project(position, targetPage = page) {
	return targetPage.locator('.national-map').evaluate((element, coordinates) => {
		const canvas = element.querySelector('.map-canvas');
		if (!canvas) throw new Error('Map canvas missing');
		const box = canvas.getBoundingClientRect();
		const zoom = Number(element.getAttribute('data-zoom'));
		const center = [
			Number(element.getAttribute('data-center-longitude')),
			Number(element.getAttribute('data-center-latitude'))
		];
		const worldSize = 512 * 2 ** zoom;
		/** @param {number} latitude */
		const mercatorY = (latitude) =>
			(1 - Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360)) / Math.PI) / 2;
		return {
			x: box.x + box.width / 2 + ((coordinates[0] - center[0]) * worldSize) / 360,
			y: box.y + box.height / 2 + (mercatorY(coordinates[1]) - mercatorY(center[1])) * worldSize
		};
	}, position);
}
try {
	await page.goto(`${baseURL}/?view=map&tool=explore&island=island%3A1443`, {
		waitUntil: 'domcontentloaded',
		timeout: 60000
	});
	await expect(page.locator('.national-map')).toHaveAttribute('aria-busy', 'false', {
		timeout: 60000
	});
	await check('Actual streets use typed infrastructure icons and explicit map key', async () => {
		await expect
			.poll(
				async () =>
					Number(await page.locator('.national-map').getAttribute('data-rendered-place-icons')),
				{ timeout: 60000 }
			)
			.toBeGreaterThan(8);
		const key = page.getByLabel('Map key', { exact: true });
		for (const text of ['Bus stops', 'Ferry terminals', 'Piers', 'Airports', 'Grouped places'])
			await expect(key).toContainText(text);
		await page.screenshot({ path: path.join(output, 'typed-icons-desktop.png'), fullPage: true });
		return { icons: await page.locator('.national-map').getAttribute('data-rendered-place-icons') };
	});
	await check(
		'Actual bus-stop popup explains stationary infrastructure and records its source',
		async () => {
			/** @type {import('../src/lib/types').MapFeatures} */
			const data = await (await page.request.get(`${baseURL}/api/backend/map/features`)).json();
			const stops = data.features.filter(
				(feature) =>
					feature.properties?.category === 'bus_stop' &&
					feature.properties?.island_id === 'island:1443' &&
					feature.geometry?.type === 'Point'
			);
			for (const stop of stops) {
				if (stop.geometry?.type !== 'Point') continue;
				const point = await project([stop.geometry.coordinates[0], stop.geometry.coordinates[1]]);
				if (point.x < 350 || point.x > 990 || point.y < 370 || point.y > 630) continue;
				await page.mouse.click(point.x, point.y);
				if (!(await page.locator('.map-record-card').count())) continue;
				if (
					(await page.locator('.map-record-card').textContent())?.includes(
						'Transport infrastructure'
					)
				)
					break;
				await page.getByRole('button', { name: 'Close popup', exact: true }).click();
			}
			await expect(page.locator('.map-record-card')).toContainText(
				'Transport infrastructure · stationary'
			);
			await expect(page.locator('.map-record-card')).toContainText('OpenStreetMap');
			const record = await page.locator('.map-record-card').textContent();
			await page.screenshot({ path: path.join(output, 'stationary-infrastructure-popup.png') });
			await page.getByRole('button', { name: 'Close popup', exact: true }).click();
			return { record };
		}
	);
	await check('Aircraft, vessel and undated bus observations are visible in Explore', async () => {
		await expect(page.locator('.national-map')).toHaveAttribute('data-movement-positions', '3');
		await expect(page.locator('.map-movement-status')).toContainText(
			'2 dated · 1 time unknown · 0 stale'
		);
		await expect(page.locator('.map-movement-status')).toContainText('Received');
		await page.getByRole('button', { name: 'View', exact: true }).click();
		await expect(page.getByLabel('Movement feed coverage', { exact: true })).toContainText(
			'browser-qa'
		);
		await page.getByRole('button', { name: 'Show nearby movement', exact: true }).click();
		await expect
			.poll(async () =>
				Number(await page.locator('.national-map').getAttribute('data-rendered-movement'))
			)
			.toBe(3);
		await page.screenshot({
			path: path.join(output, 'observed-movement-fixtures.png'),
			fullPage: true
		});
	});
	await check(
		'Movement popup identifies vehicle, provider observation time and supplied bearing',
		async () => {
			const point = await project([73.51, 4.18]);
			await page.mouse.click(point.x, point.y);
			await expect(page.locator('.map-record-card')).toContainText('QA aircraft fixture');
			await expect(page.locator('.map-record-card')).toContainText('90° supplied by provider');
			await expect(page.locator('.map-record-card')).toContainText(
				'Only received observations; no extrapolation'
			);
			await page.screenshot({ path: path.join(output, 'movement-source-popup.png') });
			await page.getByRole('button', { name: 'Close popup', exact: true }).click();
		}
	);
	await check(
		'Reduced motion updates samples directly and paused positions remain qualified',
		async () => {
			fixtureVersion++;
			await page.getByRole('button', { name: 'Refresh nearby', exact: true }).click();
			await expect(page.locator('.national-map')).toHaveAttribute(
				'data-movement-transition',
				'false'
			);
			await page.getByRole('button', { name: 'Pause nearby updates', exact: true }).click();
			await expect(page.locator('.map-movement-status')).toContainText('Updates paused');
			await expect(page.locator('.national-map')).toHaveAttribute('data-movement-positions', '3');
			await page.getByRole('button', { name: 'Resume nearby updates', exact: true }).click();
		}
	);
	await check('Infrastructure clusters show grouped counts while zooming out', async () => {
		await page.getByRole('button', { name: 'Focus selected island', exact: true }).first().click();
		const zoomOut = page.getByRole('button', { name: 'Zoom out', exact: true });
		while (Number(await page.locator('.national-map').getAttribute('data-zoom')) > 11.9) {
			await zoomOut.click();
			await page.waitForTimeout(350);
		}
		await expect
			.poll(async () =>
				Number(await page.locator('.national-map').getAttribute('data-rendered-place-clusters'))
			)
			.toBeGreaterThan(0);
		await page.screenshot({ path: path.join(output, 'infrastructure-clusters.png') });
		await page.getByRole('button', { name: 'Focus selected island', exact: true }).first().click();
		return { zoom: await page.locator('.national-map').getAttribute('data-zoom') };
	});
	await check('Normal motion smoothly connects newer observed samples and then stops', async () => {
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.locator('.national-map').evaluate((element) => {
			document.documentElement.dataset.qaTransitionSeen = 'false';
			const observer = new MutationObserver(() => {
				if (element.getAttribute('data-movement-transition') === 'true')
					document.documentElement.dataset.qaTransitionSeen = 'true';
			});
			observer.observe(element, {
				attributes: true,
				attributeFilter: ['data-movement-transition']
			});
		});
		fixtureVersion++;
		await page.getByRole('button', { name: 'Refresh nearby', exact: true }).click();
		await expect(page.locator('html')).toHaveAttribute('data-qa-transition-seen', 'true');
		await expect(page.locator('.national-map')).toHaveAttribute(
			'data-movement-transition',
			'false'
		);
		await page.emulateMedia({ reducedMotion: 'reduce' });
	});
	await check(
		'Start and destination pins appear before calculation, real route appears and clears on edited input',
		async () => {
			await page.getByRole('tab', { name: 'Plan a route', exact: true }).click();
			await pick('Choose start', 0.43, 0.57);
			await expect(page.locator('.national-map')).toHaveAttribute('data-journey-endpoints', '1');
			await pick('Choose end', 0.67, 0.61);
			await expect(page.locator('.national-map')).toHaveAttribute('data-journey-endpoints', '2');
			await expect(page.locator('.national-map')).toHaveAttribute(
				'data-journey-route-segments',
				'0'
			);
			const response = page.waitForResponse((response) =>
				response.url().includes('/api/backend/routing/land')
			);
			await page.getByRole('button', { name: 'Find shortest path', exact: true }).click();
			const routeResponse = await response;
			const route = await routeResponse.json();
			await writeFile(
				path.join(output, 'actual-land-route-response.json'),
				JSON.stringify({ httpStatus: routeResponse.status(), body: route }, null, 2)
			);
			assert.equal(routeResponse.status(), 200, JSON.stringify(route));
			assert.equal(route.status, 'ok');
			assert.ok(route.geometry.length > 1);
			await expect(page.locator('.national-map')).toHaveAttribute(
				'data-journey-route-segments',
				'1'
			);
			await page.screenshot({ path: path.join(output, 'actual-land-route-endpoints.png') });
			await pick('Change end', 0.6, 0.64);
			await expect(page.locator('.national-map')).toHaveAttribute(
				'data-journey-route-segments',
				'0'
			);
			return {
				distance_m: route.distance_m,
				snap_distance_m: route.snap_distance_m,
				points: route.geometry.length
			};
		}
	);
	await check('Mobile map key stays compact, opens its full meanings and closes', async () => {
		await page.setViewportSize({ width: 390, height: 844 });
		const toggle = page
			.locator('.mobile-key-toggle')
			.getByRole('button', { name: 'Map key', exact: true });
		await expect(toggle).toBeVisible();
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');
		await expect(page.getByLabel('Map key', { exact: true })).toBeHidden();
		await expect(page.locator('.map-hint')).toBeHidden();
		await toggle.click();
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');
		await expect(page.getByLabel('Map key', { exact: true })).toContainText('Ferry terminals');
		await toggle.click();
		await expect(page.getByLabel('Map key', { exact: true })).toBeHidden();
		await page.screenshot({
			path: path.join(output, 'mobile-compact-map-key.png'),
			fullPage: true
		});
	});
	await check(
		'Target-only removal, terminal disable and closure preview real source geometry; unknown targets stay unmapped',
		async () => {
			await page.setViewportSize({ width: 1440, height: 1000 });
			await page.goto(`${baseURL}/?view=map&tool=proposals&proposal=edit&island=island%3A1443`, {
				waitUntil: 'domcontentloaded',
				timeout: 60000
			});
			const map = page.locator('.national-map');
			await expect(map).toHaveAttribute('aria-busy', 'false', { timeout: 60000 });
			await expect
				.poll(async () => Number(await map.getAttribute('data-context-roads')), { timeout: 60000 })
				.toBeGreaterThan(0);
			const data = await (await page.request.get(`${baseURL}/api/backend/map/features`)).json();
			const stop = data.features.find(
				/** @param {import('../src/lib/types').MapFeatures['features'][number]} feature */
				(feature) =>
					feature.properties?.category === 'bus_stop' &&
					feature.properties?.island_id === 'island:1443' &&
					feature.properties?.name === 'City Square' &&
					feature.geometry?.type === 'Point'
			);
			const ferry = data.features.find(
				/** @param {import('../src/lib/types').MapFeatures['features'][number]} feature */
				(feature) =>
					feature.properties?.category === 'ferry_terminal' &&
					feature.properties?.island_id === 'island:1431' &&
					feature.geometry?.type === 'Point'
			);
			assert.ok(stop?.id && ferry?.id);
			const streets = await (
				await page.request.get(`${baseURL}/api/backend/map/context?bbox=73.48,4.15,73.54,4.21`)
			).json();
			const road = streets.features.find(
				/** @param {import('geojson').Feature<import('geojson').Geometry, {kind: string, osm_id: string}>} feature */
				(feature) =>
					feature.properties?.kind === 'road' && feature.properties?.osm_id === '32356449'
			);
			assert.ok(road?.geometry?.type === 'LineString');
			await page.getByLabel('Your intervention', { exact: true }).selectOption('remove_bus_stop');
			await page.getByLabel('Target record or graph edge ID', { exact: true }).fill(stop.id);
			await page.getByRole('button', { name: 'Add to option', exact: true }).click();
			await expect(map).toHaveAttribute('data-proposal-points', '1');
			await expect(map).toHaveAttribute('data-proposal-unlocated-edits', '0');
			const stopPoint = await project(stop.geometry.coordinates);
			await expect(async () => {
				await page.mouse.click(stopPoint.x, stopPoint.y);
				await expect(page.locator('.map-record-card')).toContainText('remove bus stop', {
					timeout: 1000
				});
			}).toPass({ timeout: 15000 });
			await expect(page.locator('.map-record-card')).toContainText('Supplied target point');
			await expect(page.locator('.map-record-card')).toContainText(stop.id);
			await page.getByRole('button', { name: 'Close popup', exact: true }).click();
			await page.getByLabel('Your intervention', { exact: true }).selectOption('road_closure');
			await page
				.getByLabel('Target record or graph edge ID', { exact: true })
				.fill(road.properties.osm_id);
			await page.getByRole('button', { name: 'Add to option', exact: true }).click();
			await expect(map).toHaveAttribute('data-proposal-points', '2');
			await expect(map).toHaveAttribute('data-proposal-closed-lines', '1');
			const roadPoint = await project(road.geometry.coordinates[5]);
			await expect(async () => {
				await page.mouse.click(roadPoint.x, roadPoint.y);
				await expect(page.locator('.map-record-card')).toContainText('road closure', {
					timeout: 1000
				});
			}).toPass({ timeout: 15000 });
			await expect(page.locator('.map-record-card')).toContainText('Supplied OSM way geometry');
			await page.getByRole('button', { name: 'Close popup', exact: true }).click();
			await page.screenshot({
				path: path.join(output, 'target-removal-and-closed-road.png'),
				fullPage: true
			});
			await page
				.getByLabel('Target record or graph edge ID', { exact: true })
				.fill('qa:unknown-target');
			await page.getByRole('button', { name: 'Add to option', exact: true }).click();
			await expect(map).toHaveAttribute('data-proposal-points', '2');
			await expect(map).toHaveAttribute('data-proposal-unlocated-edits', '1');
			await expect(page.locator('.map-footer')).toContainText(
				'1 edit lacks mapped target geometry'
			);
			await page.getByRole('button', { name: 'Undo operation', exact: true }).click();
			await expect(map).toHaveAttribute('data-proposal-unlocated-edits', '0');
			const ferryContext = await browser.newContext({
				viewport: { width: 1440, height: 1000 },
				reducedMotion: 'reduce'
			});
			try {
				const ferryPage = await ferryContext.newPage();
				ferryPage.on('pageerror', (error) => report.errors.push(error.message));
				await ferryPage.goto(
					`${baseURL}/?view=map&tool=proposals&proposal=edit&island=island%3A1431`,
					{ waitUntil: 'domcontentloaded', timeout: 60000 }
				);
				await expect(ferryPage.locator('.national-map')).toHaveAttribute('aria-busy', 'false', {
					timeout: 60000
				});
				await ferryPage
					.getByLabel('Your intervention', { exact: true })
					.selectOption('disable_ferry_terminal');
				await ferryPage
					.getByLabel('Target record or graph edge ID', { exact: true })
					.fill(ferry.id);
				await ferryPage.getByRole('button', { name: 'Add to option', exact: true }).click();
				await expect(ferryPage.locator('.national-map')).toHaveAttribute(
					'data-proposal-points',
					'1'
				);
				await expect(ferryPage.locator('.national-map')).toHaveAttribute(
					'data-proposal-unlocated-edits',
					'0'
				);
				const ferryPoint = await project(ferry.geometry.coordinates, ferryPage);
				await expect(async () => {
					await ferryPage.mouse.click(ferryPoint.x, ferryPoint.y);
					await expect(ferryPage.locator('.map-record-card')).toContainText(
						'disable ferry terminal',
						{ timeout: 1000 }
					);
				}).toPass({ timeout: 15000 });
				await expect(ferryPage.locator('.map-record-card')).toContainText(ferry.id);
				await expect(ferryPage.locator('.map-record-card')).toContainText('Supplied target point');
				await ferryPage.screenshot({
					path: path.join(output, 'target-ferry-terminal-disable.png'),
					fullPage: true
				});
			} finally {
				await ferryContext.close();
			}
			return { stop: stop.id, ferry: ferry.id, road: road.id, unknownTargetUnmapped: true };
		}
	);
	assert.deepEqual(report.errors, []);
} finally {
	await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
	await browser.close();
}
