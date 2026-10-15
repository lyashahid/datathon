import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const baseURL = process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5173';
const output = path.resolve('artifacts/qa/planning-map');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 60000 });
/** @type {{name:string,status:string,detail?:unknown}[]} */
const checks = [];
/** @type {string[]} */
const errors = [];
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
	viewport: { width: 1600, height: 1100 },
	reducedMotion: 'reduce'
});
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.on('pageerror', (error) => errors.push(error.message));
/** @param {string} name @param {()=>Promise<unknown>} work */
async function check(name, work) {
	console.log(`RUN ${name}`);
	const detail = await work();
	checks.push({ name, status: 'passed', detail });
	console.log(`PASS ${name}`);
}
/** @param {import('@playwright/test').Locator} planningMap */
async function expectDestinationClear(planningMap) {
	await expect
		.poll(async () => {
			const pin = await planningMap.locator('.planning-pin.end').boundingBox();
			const inspector = await planningMap.locator('.planning-map-insight').boundingBox();
			const canvas = await planningMap.locator('.planning-map-canvas').boundingBox();
			if (!pin || !canvas) return false;
			const intersects =
				inspector &&
				pin.x < inspector.x + inspector.width &&
				pin.x + pin.width > inspector.x &&
				pin.y < inspector.y + inspector.height &&
				pin.y + pin.height > inspector.y;
			return (
				!intersects &&
				pin.x >= canvas.x &&
				pin.x + pin.width <= canvas.x + canvas.width &&
				pin.y >= canvas.y &&
				pin.y + pin.height <= canvas.y + canvas.height
			);
		})
		.toBe(true);
}
try {
	await page.goto(`${baseURL}/?view=map&tool=proposals&proposal=policy&island=island%3A1443`);
	const workbench = page.getByRole('region', { name: 'Policy planning workbench' });
	const map = page.getByRole('region', { name: 'Interactive proposal map' });
	const baseline = await (
		await page.request.get(`${baseURL}/api/backend/planning/baseline?island_id=island%3A1443`)
	).json();
	await check(
		'One focused full-width map and source origin hexes without a default form',
		async () => {
			await expect(map).toBeVisible();
			await expect
				.poll(async () => Number(await map.getAttribute('data-rendered-hexes')))
				.toBeGreaterThan(0);
			assert.equal(await page.locator('.maplibregl-canvas:visible').count(), 1);
			assert.equal(
				await page
					.locator('.policy-map-region')
					.evaluate((element) => getComputedStyle(element).position),
				'absolute'
			);
			await expect(page.locator('#policy-inspector')).toBeHidden();
			return {
				sourceOrigins: baseline.origins.length,
				visibleHexes: Number(await map.getAttribute('data-rendered-hexes'))
			};
		}
	);
	const origin = baseline.origins[Math.floor(baseline.origins.length / 3)];
	await check(
		'Draft location moves immediately and becomes a mapped hospital intervention',
		async () => {
			await map.getByRole('button', { name: 'Hospital', exact: true }).click();
			await workbench.getByText('Precise coordinates (optional)', { exact: true }).click();
			await page.locator('#policy-name').fill('Planning map QA hospital');
			await page.locator('#policy-lon').fill(String(origin.lon));
			await page.locator('#policy-lat').fill(String(origin.lat));
			await expect(page.locator('.planning-preview')).toContainText('Planning map QA hospital');
			await workbench.getByRole('button', { name: 'Add intervention', exact: true }).click();
			await expect.poll(async () => Number(await map.getAttribute('data-draft-features'))).toBe(1);
			return { coordinates: [origin.lon, origin.lat], draftFeatures: 1 };
		}
	);
	await check(
		'Actual recalculation state respects reduced motion and colors real comparison results',
		async () => {
			const pending = page.waitForResponse(
				(response) =>
					response.url().includes('/planning/evaluate') && response.request().method() === 'POST'
			);
			await map.getByRole('button', { name: 'Recalculate map impact', exact: true }).click();
			await expect(map).toHaveAttribute('data-status', 'calculating');
			assert.equal(
				await map
					.locator('.recalibration span')
					.first()
					.evaluate((element) => getComputedStyle(element).animationName),
				'none'
			);
			const response = await pending;
			assert.equal(response.status(), 200);
			const result = await response.json();
			await expect(map).toHaveAttribute('data-status', 'latest');
			await map.getByText('Map key and source evidence', { exact: true }).click();
			await expect(map.getByLabel('Resident impact legend')).toBeVisible();
			await map.getByText('Map key and source evidence', { exact: true }).click();
			assert.equal(result.origins.length, baseline.origins.length);
			await writeFile(path.join(output, 'actual-evaluation.json'), JSON.stringify(result, null, 2));
			return {
				comparedOrigins: result.origins.length,
				gainedModeledResidents: result.summary.gained_residents
			};
		}
	);
	await check(
		'Start and end selection change map pins before routing; real paths and return preview appear',
		async () => {
			await workbench.getByRole('button', { name: '3 · Journeys & returns', exact: true }).click();
			const startOrigin = baseline.origins[0];
			await page.locator('#policy-origin').selectOption(startOrigin.id);
			const hospital = await page
				.locator('#policy-destination option')
				.evaluateAll((options) =>
					options.map((option) => ({
						value: /** @type {HTMLOptionElement} */ (option).value,
						text: option.textContent
					}))
				)
				.then((options) =>
					options.find((option) => option.text?.includes('Planning map QA hospital'))
				);
			assert.ok(hospital);
			await page.locator('#policy-destination').selectOption(hospital.value);
			await expect(map.locator('.planning-pin.start')).toHaveAttribute(
				'data-coordinates',
				`${startOrigin.lon},${startOrigin.lat}`
			);
			await expect(map.locator('.planning-pin.end')).toContainText('Planning map QA hospital');
			const pending = page.waitForResponse(
				(response) =>
					response.url().includes('/planning/journey') && response.request().method() === 'POST'
			);
			await workbench
				.getByRole('button', { name: 'Calculate outward and return', exact: true })
				.click();
			const response = await pending;
			assert.equal(response.status(), 200);
			const result = await response.json();
			assert.equal(result.outward.status, 'reachable');
			await expect
				.poll(async () => Number(await map.getAttribute('data-rendered-routes')))
				.toBeGreaterThan(0);
			await expect(map.getByRole('region', { name: 'Simulated journey playback' })).toBeVisible();
			await writeFile(path.join(output, 'actual-journey.json'), JSON.stringify(result, null, 2));
			await map.scrollIntoViewIfNeeded();
			await expectDestinationClear(map);
			await page.screenshot({
				path: path.join(output, 'latest-journey-desktop.png'),
				fullPage: false
			});
			await page.setViewportSize({ width: 390, height: 844 });
			await workbench.getByRole('button', { name: 'Close planning details', exact: true }).click();
			await map.scrollIntoViewIfNeeded();
			await expectDestinationClear(map);
			await map.screenshot({ path: path.join(output, 'latest-journey-mobile.png') });
			await page.setViewportSize({ width: 1600, height: 1100 });
			await workbench.getByRole('button', { name: '3 · Journeys & returns', exact: true }).click();
			return {
				outwardMinutes: result.outward.minutes,
				returnMinutes: result.return_journey?.minutes,
				geometryPoints: result.outward.geometry.length
			};
		}
	);
	await check(
		'Playback moves a resident along calculated geometry and input changes invalidate it',
		async () => {
			const nextOrigin = baseline.origins[Math.floor(baseline.origins.length / 2)];
			await page.locator('#policy-origin').selectOption(nextOrigin.id);
			await expect(map.getByRole('button', { name: 'Play journey preview' })).toBeDisabled();
			await expect(map.locator('.planning-pin.start')).toHaveAttribute(
				'data-coordinates',
				`${nextOrigin.lon},${nextOrigin.lat}`
			);
			const pending = page.waitForResponse(
				(response) =>
					response.url().includes('/planning/journey') && response.request().method() === 'POST'
			);
			await workbench
				.getByRole('button', { name: 'Calculate outward and return', exact: true })
				.click();
			assert.equal((await pending).status(), 200);
			await expect(map.getByRole('button', { name: 'Play journey preview' })).toBeEnabled();
			await expect(map.locator('.planning-traveller')).toBeVisible();
			const before = await map.locator('.planning-traveller').getAttribute('style');
			const range = map.getByRole('slider', { name: 'Journey elapsed minutes' });
			await range.evaluate((element) => {
				const slider = /** @type {HTMLInputElement} */ (element);
				slider.value = String(Number(slider.max) * 0.5);
				slider.dispatchEvent(new Event('input', { bubbles: true }));
			});
			await expect
				.poll(async () => map.locator('.planning-traveller').getAttribute('style'))
				.not.toBe(before);
			await map.getByRole('button', { name: 'Return', exact: true }).click();
			await expect(map.getByRole('button', { name: 'Return', exact: true })).toHaveAttribute(
				'aria-pressed',
				'true'
			);
			await map.getByRole('button', { name: 'Play journey preview' }).click();
			await expect(map.getByRole('button', { name: 'Pause journey preview' })).toBeVisible();
			await page.getByRole('button', { name: 'Analytics', exact: true }).click();
			await page.getByRole('button', { name: 'Map & planning', exact: true }).click();
			await expect(map.getByRole('button', { name: 'Play journey preview' })).toBeVisible();
			return { scrubbed: true, returnDirection: true, pausesWhenHidden: true };
		}
	);
	await check(
		'Changing assumptions marks calculated impacts stale and updates proposal previews across steps',
		async () => {
			await workbench
				.getByText('Planning date, access goal and assumptions', { exact: true })
				.click();
			await page.locator('#policy-target').fill('25');
			await expect(map).toHaveAttribute('data-status', 'stale');
			await expect(map.getByRole('button', { name: 'Play journey preview' })).toBeDisabled();
			await workbench.getByRole('button', { name: '1 · Design proposal', exact: true }).click();
			await page.locator('#policy-operation').selectOption('add_service');
			await expect
				.poll(async () => Number(await map.getAttribute('data-draft-features')))
				.toBeGreaterThan(1);
			await workbench
				.getByRole('button', { name: '4 · Timetables & delivery', exact: true })
				.click();
			await expect(map).toBeVisible();
			return {
				staleQualifiesPriorImpact: true,
				serviceConnectorIsDraft: true,
				persistentAcrossSteps: true
			};
		}
	);
	await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
	await check(
		'Mobile retains the map and closes contextual details without horizontal overflow',
		async () => {
			await page.setViewportSize({ width: 390, height: 844 });
			await expect(
				page.getByRole('button', { name: 'Close planning details', exact: true })
			).toBeVisible();
			await page.getByRole('button', { name: 'Close planning details', exact: true }).click();
			await expect(map).toBeVisible();
			assert.ok(
				await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
			);
			await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
			return { viewport: 390, noHorizontalOverflow: true };
		}
	);
	for (const mode of ['bus', 'ferry']) {
		await check(
			`Calculated ${mode} leg uses its own glyph and wait-aware simulated movement`,
			async () => {
				const transitContext = await browser.newContext({
					viewport: { width: 1600, height: 1100 },
					reducedMotion: 'reduce'
				});
				try {
					const surface = await transitContext.newPage();
					surface.setDefaultTimeout(60000);
					surface.on('pageerror', (error) => errors.push(error.message));
					await surface.goto(
						`${baseURL}/?view=map&tool=proposals&proposal=policy&island=island%3A1443`
					);
					await surface.getByRole('button', { name: '1 · Design proposal', exact: true }).click();
					await surface
						.getByText('Planning date, access goal and assumptions', { exact: true })
						.click();
					await surface
						.getByRole('button', { name: 'Plan across Greater Malé', exact: true })
						.click();
					await expect(
						surface.getByRole('button', { name: 'Plan across Greater Malé', exact: true })
					).not.toBeVisible();
					const transitMap = surface.getByRole('region', { name: 'Interactive proposal map' });
					await expect
						.poll(async () => Number(await transitMap.getAttribute('data-rendered-hexes')))
						.toBeGreaterThan(0);
					const all = await (
						await surface.request.get(`${baseURL}/api/backend/planning/baseline`)
					).json();
					const from = all.stops.find(
						(/** @type {{id:string}} */ stop) =>
							stop.id === (mode === 'ferry' ? 'rtl:stop:1301' : 'rtl:stop:103')
					);
					const to =
						mode === 'ferry'
							? all.stops.find((/** @type {{id:string}} */ stop) => stop.id === 'rtl:stop:103')
							: all.stops.find((/** @type {{id:string}} */ stop) => stop.id === 'rtl:stop:109');
					const destination = all.facilities.find(
						(/** @type {{id:string}} */ facility) =>
							facility.id === (mode === 'ferry' ? 'osm:way:151403710' : 'osm:way:383751026')
					);
					assert.ok(from && to && destination);
					// This retained Vili origin has a connected walking path to the terminal.
					// Geometric proximity alone does not establish a legal network connection.
					const resident =
						mode === 'ferry'
							? all.origins.find(
									(/** @type {{id:string}} */ item) => item.id === 'wp:vilimale:3516:1013'
								)
							: all.origins
									.filter(
										(/** @type {{islandId:string}} */ item) => item.islandId === from.islandId
									)
									.sort(
										(
											/** @type {{lon:number,lat:number}} */ first,
											/** @type {{lon:number,lat:number}} */ second
										) =>
											Math.hypot(first.lon - from.lon, first.lat - from.lat) -
											Math.hypot(second.lon - from.lon, second.lat - from.lat)
									)[0];
					assert.ok(resident);
					const operations = [false, true].map((reverse) => ({
						type: 'add_service',
						name: `QA assumed ${mode} ${reverse ? 'return' : 'outward'}`,
						service: {
							id: `proposal:qa-map-${mode}:${reverse ? 'return' : 'outward'}`,
							routeId: `proposal:qa-map-${mode}`,
							name: `QA assumed ${mode} connection`,
							mode,
							stopIds: reverse ? [to.id, from.id] : [from.id, to.id],
							fleet: 'diesel',
							calendar: { weekdays: [], includedDates: ['2026-10-10'] },
							timing: {
								kind: 'frequency',
								segmentMinutes: [12],
								windows: [{ startMinutes: 900, endMinutes: 1250, headwayMinutes: 10 }]
							},
							distanceM: mode === 'ferry' ? 2500 : 8000
						}
					}));
					const option = {
						operations,
						assumptions: {
							date: '2026-10-10',
							departure_minutes: 920,
							goal: 'healthcare',
							population_year: 2026
						}
					};
					await surface.getByLabel('Import policy scenario file', { exact: true }).setInputFiles({
						name: `qa-assumed-${mode}.json`,
						mimeType: 'application/json',
						buffer: Buffer.from(JSON.stringify(option))
					});
					await surface
						.getByRole('button', { name: '3 · Journeys & returns', exact: true })
						.click();
					await surface.locator('#policy-origin').selectOption(resident.id);
					await surface.locator('#policy-destination').selectOption(destination.id);
					const pending = surface.waitForResponse(
						(response) =>
							response.url().includes('/planning/journey') && response.request().method() === 'POST'
					);
					await surface
						.getByRole('button', { name: 'Calculate outward and return', exact: true })
						.click();
					const response = await pending;
					assert.equal(response.status(), 200, await response.text());
					const result = await response.json();
					await writeFile(
						path.join(output, `actual-${mode}-journey.json`),
						JSON.stringify(
							{
								fixtureMeaning:
									'Explicit QA scenario operating assumptions; not operator timetable or live movement. Source origin, stops, destination and route geometry are retained real network data.',
								option,
								result
							},
							null,
							2
						)
					);
					const legIndex = result.outward.path.findIndex(
						(/** @type {{mode:string}} */ leg) => leg.mode === mode
					);
					assert.ok(
						legIndex >= 0,
						`${mode}: no calculated ${mode} leg: ${JSON.stringify(result.outward)}`
					);
					const leg = result.outward.path[legIndex];
					assert.ok(
						leg.geometry.length >= 2,
						`${mode}: calculated transit leg has no located path`
					);
					assert.equal(
						leg.geometry_source,
						mode === 'bus' ? 'osm_network_shortest_path' : 'assumed_endpoint_corridor'
					);
					await expect(
						surface.getByRole('region', { name: 'Simulated journey playback' })
					).toContainText(
						mode === 'bus'
							? 'Bus path estimated from the available road network'
							: 'Planning corridor between stops; not a charted navigation route.'
					);
					const preceding = result.outward.path
						.slice(0, legIndex)
						.reduce(
							(
								/** @type {number} */ sum,
								/** @type {{minutes:number,wait_minutes:number}} */ item
							) => sum + item.minutes + item.wait_minutes,
							0
						);
					const range = surface.getByRole('slider', { name: 'Journey elapsed minutes' });
					await range.evaluate(
						(element, value) => {
							const slider = /** @type {HTMLInputElement} */ (element);
							slider.value = String(value);
							slider.dispatchEvent(new Event('input', { bubbles: true }));
						},
						preceding + leg.wait_minutes + leg.minutes / 2
					);
					await expect(surface.locator('.planning-traveller')).toHaveAttribute('data-mode', mode);
					await expect(surface.locator('.planning-traveller')).toHaveAttribute(
						'aria-label',
						`Simulated resident journey: On the ${mode}`
					);
					await expect
						.poll(async () => Number(await transitMap.getAttribute('data-rendered-routes')))
						.toBeGreaterThan(0);
					await transitMap.scrollIntoViewIfNeeded();
					await surface.screenshot({
						path: path.join(output, `${mode}-journey-desktop.png`),
						fullPage: false
					});
					await range.evaluate((element) => {
						const slider = /** @type {HTMLInputElement} */ (element);
						slider.value = slider.max;
						slider.dispatchEvent(new Event('input', { bubbles: true }));
					});
					await expect(surface.locator('.planning-traveller')).toHaveAttribute(
						'aria-label',
						'Simulated resident journey: Arrived'
					);
					return {
						mode,
						calculatedMinutes: leg.minutes,
						waitMinutes: leg.wait_minutes,
						geometryPoints: leg.geometry.length,
						geometrySource: leg.geometry_source,
						geometryWarning: leg.geometry_warning ?? null,
						exactEndpointArrived: true,
						fixture: 'Browser-local operating assumptions only'
					};
				} finally {
					await transitContext.close();
				}
			}
		);
	}
	assert.deepEqual(errors, []);
	await writeFile(
		path.join(output, 'report.json'),
		JSON.stringify({ baseURL, checks, errors, status: 'passed' }, null, 2)
	);
} catch (error) {
	await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
	await writeFile(
		path.join(output, 'report.json'),
		JSON.stringify({ baseURL, checks, errors, status: 'failed', failure: String(error) }, null, 2)
	);
	throw error;
} finally {
	await browser.close();
}
