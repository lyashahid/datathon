import { projectMapPoint, wheelMapZoom } from './browser-map.mjs';
import { browserBaseURL } from './browser-config.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const expect = playwrightExpect.configure({ timeout: 45000 });

const baseURL = browserBaseURL();
const output = path.resolve('artifacts/qa/map-legibility');
await mkdir(output, { recursive: true });
/** @type {{baseURL:string,fixtureQualification:string,checks:Array<{name:string,status:string,detail?:unknown}>,errors:string[],failure?:string}} */
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
page.setDefaultTimeout(60000);
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
/** @param {'start'|'end'} endpoint @param {[number,number]} coordinates */
async function pick(endpoint, coordinates) {
	const map = page.locator('.national-map');
	const endpointsBefore = Number(await map.getAttribute('data-journey-endpoints'));
	// Choosing A automatically arms B and keeps the endpoint controls available.
	const autoChoosingEnd =
		endpoint === 'end' &&
		endpointsBefore === 1 &&
		(await map.getAttribute('class'))?.includes('is-picking');
	if (!autoChoosingEnd)
		await page
			.getByRole('button', {
				name: endpoint === 'start' ? 'Choose start on map' : 'Choose destination on map',
				exact: true
			})
			.click();
	await expect(map).toHaveClass(/is-picking/);
	const point = await project(coordinates);
	assert.ok(
		await page.evaluate(
			({ x, y }) => document.elementFromPoint(x, y)?.matches('.maplibregl-canvas') ?? false,
			point
		),
		'The selected real street must be unobscured'
	);
	await page.mouse.click(point.x, point.y);
	if (endpoint === 'start' && endpointsBefore === 0) await expect(map).toHaveClass(/is-picking/);
	else await expect(map).not.toHaveClass(/is-picking/);
}
/** @param {[number,number]} position @param {import('@playwright/test').Page} [targetPage] */
async function project(position, targetPage = page) {
	return projectMapPoint(targetPage.locator('.national-map'), position);
}
async function refreshMovementThroughNavigation() {
	const navigation = page.getByRole('navigation', { name: 'Workspace', exact: true });
	await navigation.getByRole('button', { name: 'Analytics', exact: true }).click();
	const snapshot = page.waitForResponse((response) =>
		response.url().includes('/api/backend/live/snapshot?')
	);
	await navigation.getByRole('button', { name: 'Map & planning', exact: true }).click();
	await snapshot;
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
			const card = page.getByRole('region', { name: 'Map source record', exact: true });
			let inspectedStop;
			for (const stop of stops) {
				if (stop.geometry?.type !== 'Point') continue;
				const point = await project([stop.geometry.coordinates[0], stop.geometry.coordinates[1]]);
				if (
					!(await page.evaluate(
						({ x, y }) =>
							x > 100 &&
							y > 180 &&
							x < innerWidth - 100 &&
							y < innerHeight - 180 &&
							document.elementFromPoint(x, y)?.matches('.maplibregl-canvas'),
						point
					))
				)
					continue;
				await page.mouse.click(point.x, point.y);
				try {
					await expect(card).toBeVisible({ timeout: 1500 });
					await expect(card.locator('.map-record-kind')).toHaveText('bus stop · stationary place', {
						timeout: 1000
					});
					await expect(card.locator('h3')).toHaveText(String(stop.properties?.name), {
						timeout: 1000
					});
					inspectedStop = stop;
					break;
				} catch {
					const close = page.getByRole('button', { name: 'Close popup', exact: true });
					if (await close.isVisible()) await close.click();
				}
			}
			assert.ok(inspectedStop, 'A real visible Malé bus stop opens its stationary-place record');
			await card.getByText('Source details', { exact: true }).click();
			await expect(card).toContainText('OpenStreetMap');
			await expect(card).toContainText(String(inspectedStop.id));
			const record = await card.textContent();
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
		'Reduced motion updates samples directly and the movement layer hides positions',
		async () => {
			fixtureVersion++;
			await refreshMovementThroughNavigation();
			await expect(page.locator('.national-map')).toHaveAttribute(
				'data-movement-transition',
				'false'
			);
			await page.getByRole('button', { name: 'Layers', exact: false }).click();
			const movement = page.getByRole('button', { name: /^Observed movement/ });
			await movement.click();
			await expect(movement).toHaveAttribute('aria-pressed', 'false');
			await expect(page.locator('.national-map')).toHaveAttribute('data-rendered-movement', '0');
			await expect(page.locator('.national-map')).toHaveAttribute('data-movement-positions', '3');
			await movement.click();
			await expect(movement).toHaveAttribute('aria-pressed', 'true');
			await page.getByRole('button', { name: 'Close map controls', exact: true }).click();
		}
	);
	await check('Infrastructure clusters show grouped counts while zooming out', async () => {
		await page.getByRole('button', { name: 'Focus selected island', exact: true }).first().click();
		await expect
			.poll(async () => Number(await page.locator('.national-map').getAttribute('data-zoom')))
			.toBeGreaterThan(13);
		for (let attempts = 0; attempts < 8; attempts++) {
			const zoom = Number(await page.locator('.national-map').getAttribute('data-zoom'));
			if (zoom <= 11.9) break;
			await wheelMapZoom(page, page.locator('.national-map'), -1);
			await expect
				.poll(async () => Number(await page.locator('.national-map').getAttribute('data-zoom')))
				.toBeLessThan(zoom - 0.5);
		}
		assert.ok(
			Number(await page.locator('.national-map').getAttribute('data-zoom')) <= 11.9,
			'Wheel zoom reaches the infrastructure-cluster range'
		);
		await expect
			.poll(async () =>
				Number(await page.locator('.national-map').getAttribute('data-rendered-place-clusters'))
			)
			.toBeGreaterThan(0);
		await page.screenshot({ path: path.join(output, 'infrastructure-clusters.png') });
		await page.getByRole('button', { name: 'Focus selected island', exact: true }).first().click();
		await expect
			.poll(async () => Number(await page.locator('.national-map').getAttribute('data-zoom')))
			.toBeGreaterThan(13);
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
		await refreshMovementThroughNavigation();
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
			await page.getByRole('button', { name: 'Directions', exact: true }).click();
			const streetsResponse = await page.request.get(
				`${baseURL}/api/backend/map/context?bbox=73.48,4.15,73.54,4.21`
			);
			assert.equal(streetsResponse.status(), 200);
			/** @type {import('geojson').FeatureCollection<import('geojson').Geometry, {kind:string}>} */
			const streets = await streetsResponse.json();
			/** @type {Array<[number,number]>} */
			let endpoints = [];
			/** @type {[number,number]|undefined} */
			let editedEnd;
			for (const road of streets.features) {
				if (road.properties?.kind !== 'road' || road.geometry.type !== 'LineString') continue;
				const coordinates = road.geometry.coordinates;
				const pair = /** @type {Array<[number,number]>} */ ([coordinates[0], coordinates.at(-1)]);
				if (pair.some((point) => !point)) continue;
				const projected = await Promise.all(pair.map((point) => project(point)));
				if (Math.hypot(projected[0].x - projected[1].x, projected[0].y - projected[1].y) < 40)
					continue;
				if (
					!(await page.evaluate(
						(points) =>
							points.every(
								({ x, y }) =>
									x > 100 &&
									y > 180 &&
									x < innerWidth - 100 &&
									y < innerHeight - 180 &&
									document.elementFromPoint(x, y)?.matches('.maplibregl-canvas')
							),
						projected
					))
				)
					continue;
				// A third point on this same real road avoids clicking the existing A pin when editing B.
				for (let index = 1; index < coordinates.length; index++) {
					const candidate = /** @type {[number,number]} */ ([
						(coordinates[index - 1][0] + coordinates[index][0]) / 2,
						(coordinates[index - 1][1] + coordinates[index][1]) / 2
					]);
					const point = await project(candidate);
					if (
						projected.every((end) => Math.hypot(point.x - end.x, point.y - end.y) > 30) &&
						(await page.evaluate(
							({ x, y }) => document.elementFromPoint(x, y)?.matches('.maplibregl-canvas'),
							point
						))
					) {
						editedEnd = candidate;
						break;
					}
				}
				if (!editedEnd) continue;
				endpoints = pair;
				break;
			}
			assert.equal(
				endpoints.length,
				2,
				'Two visible points on the same real mapped road are available'
			);
			assert.ok(editedEnd, 'A distinct point on the same real road is available for editing B');
			await pick('start', endpoints[0]);
			await expect(page.locator('.national-map')).toHaveAttribute('data-journey-endpoints', '1');
			await pick('end', endpoints[1]);
			await expect(page.locator('.national-map')).toHaveAttribute('data-journey-endpoints', '2');
			await expect(page.locator('.national-map')).toHaveAttribute(
				'data-journey-route-segments',
				'0'
			);
			const response = page.waitForResponse((response) =>
				response.url().includes('/api/backend/routing/land')
			);
			await page.getByRole('button', { name: 'Find directions', exact: true }).click();
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
			await pick('end', editedEnd);
			await expect(page.locator('.national-map')).toHaveAttribute(
				'data-journey-route-segments',
				'0'
			);
			return {
				endpoints,
				editedEnd,
				distance_m: route.distance_m,
				snap_distance_m: route.snap_distance_m,
				points: route.geometry.length
			};
		}
	);
	await check('Mobile map key stays compact, opens its full meanings and closes', async () => {
		await page.getByRole('button', { name: 'Close directions', exact: true }).click();
		await expect(page.locator('.explore-journey')).toBeHidden();
		await page.setViewportSize({ width: 390, height: 844 });
		const toggle = page
			.locator('.mobile-key-toggle')
			.getByRole('button', { name: 'Map key & live coverage', exact: true });
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
			await expect(async () => {
				const stopPoint = await project(stop.geometry.coordinates);
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
			await expect(async () => {
				const roadPoint = await project(road.geometry.coordinates[5]);
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
				await expect(async () => {
					const ferryPoint = await project(ferry.geometry.coordinates, ferryPage);
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
} catch (error) {
	report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
	await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
	throw error;
} finally {
	await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
	await browser.close();
}
