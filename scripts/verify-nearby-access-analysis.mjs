import { browserBaseURL } from './browser-config.mjs';
import { projectMapPoint, wheelMapZoom } from './browser-map.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Use the real source evidence and rendered map; delay one real response to exercise loading.
// An isolated context keeps the user's saved proposals unchanged.
const baseURL = browserBaseURL();
const output = path.resolve('artifacts/qa/nearby-access-analysis');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 60000 });
const maleId = 'island:1443';
const hulhumaleId = 'island:1442';
const hulhuleId = 'island:1483';
const capitalIds = [hulhumaleId, maleId, hulhuleId];
/** @typedef {{island_id:string,gap_cells:{features:Array<{properties:Record<string,unknown>}>},hex_grid:{features:unknown[]},assumptions:{date:string,departure_minutes:number,target_minutes:number},planning_supported:boolean}} Opportunity */
/** @typedef {import('../src/lib/map-policy.js').MapBaseline & {island_id:string}} Baseline */
/** @typedef {import('../src/lib/map-policy.js').MapEvaluation} Evaluation */
/** @type {Map<string,{detail:Opportunity,baseline:Baseline}>} */
const sources = new Map();
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
/** @type {Map<string,number>} */
const requestCounts = new Map();
/** @type {Map<string,number>} */
const downloadCounts = new Map();
/** @type {Array<{key:string,status:number,conditional:boolean}>} */
const revalidations = [];
/** @type {Map<string,{status:number,island:string,origins:number,stops:number,roads:number,hexagons:number,features:number,islandGeometryIds:string[]}>} */
const receipts = new Map();
/** @type {Array<{request:import('../src/lib/proposal-review.js').PlanningReviewRequest,body:Evaluation}>} */
const evaluations = [];
/** @param {string} url */
function planningRequestKey(url) {
	const parsed = new URL(url);
	const endpoint = parsed.pathname.endsWith('/planning/baseline')
		? 'baseline'
		: parsed.pathname.includes('/planning/opportunities/')
			? 'opportunities'
			: parsed.pathname.endsWith('/map/features') && parsed.searchParams.get('layer') === 'all'
				? 'features'
				: null;
	const island =
		endpoint === 'opportunities'
			? decodeURIComponent(parsed.pathname.split('/').at(-1) ?? '')
			: parsed.searchParams.get('island_id');
	return endpoint && island && capitalIds.includes(island) ? `${endpoint}:${island}` : null;
}
page.on('request', (request) => {
	const key = planningRequestKey(request.url());
	if (key) requestCounts.set(key, (requestCounts.get(key) ?? 0) + 1);
});
page.on('response', async (response) => {
	const key = planningRequestKey(response.url());
	if (!key && !new URL(response.url()).pathname.endsWith('/planning/evaluate')) return;
	if (key && response.status() === 304) {
		revalidations.push({
			key,
			status: response.status(),
			conditional: !!response.request().headers()['if-none-match']
		});
		return;
	}
	if (key && response.status() === 200) downloadCounts.set(key, (downloadCounts.get(key) ?? 0) + 1);
	try {
		const body = await response.json();
		if (key)
			receipts.set(key, {
				status: response.status(),
				island: body.island_id ?? key.slice(key.indexOf(':') + 1),
				origins: body.origins?.length ?? body.gap_cells?.features.length ?? 0,
				stops: body.stops?.length ?? 0,
				roads: body.graph_edges?.length ?? 0,
				hexagons: body.hex_grid?.features.length ?? 0,
				features: body.features?.length ?? 0,
				islandGeometryIds:
					body.features
						?.filter(
							(/** @type {import('geojson').Feature} */ feature) =>
								['Polygon', 'MultiPolygon'].includes(feature.geometry.type) &&
								String(feature.properties?.id ?? '').startsWith('island:')
						)
						.map((/** @type {import('geojson').Feature} */ feature) =>
							String(feature.properties?.id)
						) ?? []
			});
		else if (response.ok() && response.request().method() === 'POST')
			evaluations.push({ request: response.request().postDataJSON(), body });
	} catch {
		// A superseded placement preview can be cancelled before its body is available.
	}
});
const atlas = page.locator('.national-map');
const panel = page.getByRole('region', { name: 'Island needs and proposal', exact: true });
const proposalTitle = panel.getByRole('textbox', { name: 'Proposal name', exact: true });

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

async function mapEvidence() {
	return atlas.evaluate((element) => ({
		localIslands: /** @type {string[]} */ (
			JSON.parse(element.getAttribute('data-policy-local-islands') ?? '[]')
		),
		localCells: /** @type {Record<string,number>} */ (
			JSON.parse(element.getAttribute('data-policy-local-cells') ?? '{}')
		),
		screeningIslands: /** @type {string[]} */ (
			JSON.parse(element.getAttribute('data-policy-screening-islands') ?? '[]')
		),
		gapRanges: /** @type {Record<string,{min:number|null,max:number|null}>} */ (
			JSON.parse(element.getAttribute('data-policy-gap-ranges') ?? '{}')
		),
		backgroundCells: /** @type {Record<string,number>} */ (
			JSON.parse(element.getAttribute('data-policy-background-cells') ?? '{}')
		)
	}));
}

/** @param {string} id */
function sourceFor(id) {
	const source = sources.get(id);
	assert.ok(source, `Real source evidence is required for ${id}.`);
	return source;
}

async function visibleHulhumaleRoad() {
	for (const road of sourceFor(hulhumaleId).baseline.graph_edges)
		for (const coordinates of road.geometry ?? []) {
			const point = await projectMapPoint(atlas, coordinates);
			if (
				await page.evaluate(
					({ x, y }) =>
						x > 35 &&
						x < innerWidth - 35 &&
						y > 150 &&
						y < innerHeight - 100 &&
						!!document.elementFromPoint(x, y)?.matches('.maplibregl-canvas'),
					point
				)
			)
				return { coordinates, point };
		}
	throw new Error('A source-backed Hulhumalé road must be visible outside the proposal controls.');
}

async function openProposal() {
	if (!(await panel.isVisible()))
		await page.getByRole('button', { name: /^Create (?:a )?proposal$/ }).click();
	await expect(panel).toBeVisible();
	if ((await panel.getAttribute('data-policy-section')) !== 'proposal')
		await panel.getByRole('button', { name: /^Your proposal/ }).click();
	if ((await panel.locator('.proposal-details').getAttribute('open')) === null)
		await panel.locator('.proposal-details > summary').click();
	await expect(proposalTitle).toBeEnabled();
}

/** @param {string} id @param {string} query */
async function chooseIsland(id, query) {
	if (await panel.isVisible())
		await panel.getByRole('button', { name: 'Close island planning panel', exact: true }).click();
	await page.getByRole('button', { name: 'Find an island or atoll', exact: true }).click();
	const dropdown = page.getByRole('dialog', { name: 'Find an island or atoll', exact: true });
	await dropdown.getByRole('textbox', { name: 'Search islands', exact: true }).fill(query);
	await dropdown.locator(`[data-island-id="${id}"]`).click();
	await expect(page).toHaveURL((url) => url.searchParams.get('island') === id);
	await expect(dropdown).not.toBeVisible();
}

/** Pan using actual pointer gestures, keeping Hulhumalé selected.
 * @param {[number,number]} coordinates
 */
async function panTo(coordinates) {
	for (let attempt = 0; attempt < 24; attempt++) {
		const position = await atlas.evaluate((element, location) => {
			const canvas = element.querySelector('.maplibregl-canvas');
			if (!canvas) throw new Error('Map canvas missing');
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
			return {
				x: bounds.x + (bounds.width + left - right) / 2 + ((location[0] - longitude) * world) / 360,
				y:
					bounds.y +
					(bounds.height + top - bottom) / 2 +
					(mercatorY(location[1]) - mercatorY(latitude)) * world
			};
		}, coordinates);
		const box = await atlas.locator('.maplibregl-canvas').boundingBox();
		assert.ok(box);
		const dx = box.x + box.width * 0.55 - position.x;
		const dy = box.y + box.height * 0.4 - position.y;
		if (Math.hypot(dx, dy) < 12) return;
		const gesture = await page.evaluate(
			({ box, dx, dy }) => {
				const scale = Math.min(1, 220 / Math.hypot(dx, dy));
				for (const fy of [0.4, 0.35, 0.45, 0.3, 0.5, 0.55]) {
					for (const fx of [0.5, 0.4, 0.6, 0.3, 0.7]) {
						const start = { x: box.x + box.width * fx, y: box.y + box.height * fy };
						const end = { x: start.x + dx * scale, y: start.y + dy * scale };
						if (
							Array.from({ length: 11 }, (_, step) => step / 10).every((fraction) =>
								document
									.elementFromPoint(
										start.x + (end.x - start.x) * fraction,
										start.y + (end.y - start.y) * fraction
									)
									?.matches('.maplibregl-canvas')
							)
						)
							return { start, end };
					}
				}
				throw new Error('A clear map path is required for panning');
			},
			{ box, dx, dy }
		);
		await page.mouse.move(gesture.start.x, gesture.start.y);
		await page.mouse.down();
		await page.mouse.move(gesture.end.x, gesture.end.y, { steps: 10 });
		await page.waitForTimeout(200);
		await page.mouse.up();
		await page.waitForTimeout(100);
	}
	throw new Error('Malé could not be brought into the visible map');
}

/** @type {()=>void} */
let releaseMale = () => {};
const maleGate = new Promise((resolve) => {
	releaseMale = () => resolve(undefined);
});
let delayedMaleRequests = 0;
await page.route('**/api/backend/planning/opportunities/**', async (route) => {
	if (decodeURIComponent(new URL(route.request().url()).pathname).endsWith(`/${maleId}`)) {
		delayedMaleRequests += 1;
		await maleGate;
	}
	await route.continue();
});

try {
	await check(
		'Capital source evidence includes all three islands without inventing Hulhulé residents',
		async () => {
			await Promise.all(
				capitalIds.map(async (island) => {
					const [opportunityResponse, baselineResponse] = await Promise.all([
						page.request.get(
							`${baseURL}/api/backend/planning/opportunities/${encodeURIComponent(island)}`
						),
						page.request.get(
							`${baseURL}/api/backend/planning/baseline?island_id=${encodeURIComponent(island)}`
						)
					]);
					assert.equal(opportunityResponse.status(), 200);
					assert.equal(baselineResponse.status(), 200);
					const detail = /** @type {Opportunity} */ (await opportunityResponse.json());
					const baseline = /** @type {Baseline} */ (await baselineResponse.json());
					assert.equal(detail.island_id, island);
					assert.equal(baseline.island_id, island);
					assert.ok(baseline.stops?.length, `${island} has real mapped transport stops.`);
					assert.ok(baseline.graph_edges.length, `${island} has source-backed roads.`);
					sources.set(island, { detail, baseline });
				})
			);
			const { detail } = sourceFor(maleId);
			const origins = detail.gap_cells.features.map((feature) => feature.properties);
			assert.ok(origins.length > 0 && detail.hex_grid.features.length > 0);
			const airport = sourceFor(hulhuleId);
			assert.equal(airport.detail.planning_supported, false);
			assert.equal(airport.detail.hex_grid.features.length, 0);
			assert.equal(airport.baseline.origins.length, 0);
			/** @type {Record<string,{minimum:number,maximum:number}>} */
			const journeys = {};
			for (const [domain, target] of [
				['health', detail.assumptions.target_minutes],
				['education', detail.assumptions.target_minutes],
				['transport', 10]
			]) {
				const values = origins.map((origin) => origin[`${domain}_minutes`]);
				assert.ok(values.every((value) => typeof value === 'number' && Number.isFinite(value)));
				const numbers = /** @type {number[]} */ (values);
				assert.ok(numbers.every((value) => value >= 0 && value <= Number(target)));
				journeys[String(domain)] = { minimum: Math.min(...numbers), maximum: Math.max(...numbers) };
			}
			return {
				queriedAt: new Date().toISOString(),
				capitalSources: capitalIds.map((island) => {
					const source = sourceFor(island);
					return {
						island,
						origins: source.baseline.origins.length,
						displayHexagons: source.detail.hex_grid.features.length,
						stops: source.baseline.stops?.length,
						roads: source.baseline.graph_edges.length
					};
				}),
				island: maleId,
				sourceSnapshot: detail.assumptions.date,
				departureMinutes: detail.assumptions.departure_minutes,
				targets: {
					health: detail.assumptions.target_minutes,
					education: detail.assumptions.target_minutes,
					transport: 10
				},
				origins: origins.length,
				displayHexagons: detail.hex_grid.features.length,
				journeys
			};
		}
	);
	await check(
		'A delayed Malé analysis never becomes a red screening fallback beside ready Hulhumalé',
		async () => {
			await page.goto(
				`${baseURL}/?view=map&tool=explore&island=${encodeURIComponent(hulhumaleId)}&scope=capital`,
				{ waitUntil: 'domcontentloaded' }
			);
			await expect(atlas).toHaveAttribute('aria-busy', 'false');
			await expect.poll(() => delayedMaleRequests).toBeGreaterThan(0);
			await expect
				.poll(async () => (await mapEvidence()).localIslands.includes(hulhumaleId))
				.toBe(true);
			const evidence = await mapEvidence();
			assert.equal(evidence.localIslands.includes(maleId), false);
			assert.equal(evidence.screeningIslands.includes(maleId), false);
			assert.equal(evidence.screeningIslands.includes(hulhumaleId), false);
			await openProposal();
			await expect(
				panel.locator('.policy-palette').getByRole('button', { name: 'Add bus stop', exact: true })
			).toBeEnabled();
			await panel.getByRole('button', { name: 'Close island planning panel', exact: true }).click();
			await page.screenshot({ path: path.join(output, 'male-analysis-loading.png') });
			return { delayedRequests: delayedMaleRequests, evidence, selectedIslandReady: true };
		}
	);
	await check(
		'All three capital analyses preload together and Malé retains its actual local evidence',
		async () => {
			releaseMale();
			await expect
				.poll(() =>
					capitalIds.every((island) =>
						['baseline', 'opportunities', 'features'].every((endpoint) =>
							receipts.has(`${endpoint}:${island}`)
						)
					)
				)
				.toBe(true);
			await expect
				.poll(async () => (await mapEvidence()).localCells[maleId])
				.toBe(sourceFor(maleId).detail.hex_grid.features.length);
			const evidence = await mapEvidence();
			for (const island of capitalIds) {
				const source = sourceFor(island);
				assert.equal(evidence.localCells[island] ?? 0, source.detail.hex_grid.features.length);
				assert.equal(evidence.backgroundCells[island] ?? 0, source.detail.hex_grid.features.length);
				for (const endpoint of ['baseline', 'opportunities', 'features']) {
					const receipt = receipts.get(`${endpoint}:${island}`);
					assert.ok(receipt);
					assert.equal(receipt.status, 200);
					assert.equal(receipt.island, island);
					if (endpoint === 'features') {
						assert.deepEqual(receipt.islandGeometryIds, [island]);
						assert.ok(
							receipt.features > 1,
							'Canonical island geometry includes local source records.'
						);
					} else
						assert.equal(
							receipt.origins,
							endpoint === 'baseline'
								? source.baseline.origins.length
								: source.detail.gap_cells.features.length
						);
					if (endpoint === 'baseline') {
						assert.equal(receipt.stops, source.baseline.stops?.length);
						assert.equal(receipt.roads, source.baseline.graph_edges.length);
					}
				}
			}
			assert.equal(evidence.localIslands.includes(hulhuleId), false);
			assert.deepEqual(evidence.screeningIslands, []);
			const maleRange = evidence.gapRanges[maleId];
			assert.ok(maleRange && maleRange.min !== null && maleRange.max !== null);
			assert.ok(maleRange.max < 0.6, 'Malé is colored from its actual short journeys');
			assert.ok(maleRange.max - maleRange.min > 0.1, 'Malé displays varied local evidence');
			await expect(page).toHaveURL((url) => url.searchParams.get('island') === hulhumaleId);
			await expect(atlas.getByText('Local journey time', { exact: true })).toBeVisible();
			await page.screenshot({ path: path.join(output, 'capital-local-access.png') });
			await panTo([73.514746, 4.17001]);
			while (Number(await atlas.getAttribute('data-zoom')) < 14.6) {
				const priorZoom = Number(await atlas.getAttribute('data-zoom'));
				await wheelMapZoom(page, atlas, 1);
				await expect
					.poll(async () => Number(await atlas.getAttribute('data-zoom')))
					.toBeGreaterThan(priorZoom + 0.5);
			}
			await panTo([73.514746, 4.17001]);
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-rendered-roads')))
				.toBeGreaterThan(0);
			await page.waitForTimeout(800);
			await expect(page).toHaveURL((url) => url.searchParams.get('island') === hulhumaleId);
			await page.screenshot({ path: path.join(output, 'male-local-with-hulhumale-selected.png') });
			const downloadsBeforeSelection = Object.fromEntries(downloadCounts);
			await chooseIsland(maleId, 'Malé');
			await expect.poll(async () => (await mapEvidence()).localIslands.includes(maleId)).toBe(true);
			await openProposal();
			await expect(proposalTitle).toHaveValue('Malé service improvement');
			await expect(
				panel.locator('.policy-palette').getByRole('button', { name: 'Add bus stop', exact: true })
			).toBeEnabled();
			await panel.getByRole('button', { name: 'Close island planning panel', exact: true }).click();
			const selectedMaleEvidence = await mapEvidence();
			assert.deepEqual(selectedMaleEvidence.gapRanges[maleId], maleRange);
			assert.equal(selectedMaleEvidence.localCells[maleId], evidence.localCells[maleId]);
			assert.deepEqual(selectedMaleEvidence.screeningIslands, []);
			assert.deepEqual(
				Object.fromEntries(downloadCounts),
				downloadsBeforeSelection,
				'Switching capital islands reuses loaded bodies; conditional 304 freshness checks are allowed.'
			);
			assert.ok(revalidations.every((response) => response.conditional));
			await page.screenshot({ path: path.join(output, 'male-local-access.png') });
			return {
				preloaded: Object.fromEntries(receipts),
				capitalEvidence: evidence,
				selectedIsland: maleId,
				selectedMaleEvidence,
				selectionReusedLoadedData: true,
				requests: Object.fromEntries(requestCounts),
				downloads: Object.fromEntries(downloadCounts),
				revalidations
			};
		}
	);
	await check(
		'A Hulhumalé proposal preserves neighboring baseline colours and keeps resident impact scoped',
		async () => {
			await chooseIsland(hulhumaleId, 'Hulhumalé');
			await openProposal();
			await expect(proposalTitle).toHaveValue('Hulhumalé service improvement');
			await expect(panel.getByRole('button', { name: 'Hospital', exact: true })).toBeEnabled();
			await panel.getByRole('button', { name: 'Edit budget limits', exact: true }).click();
			await panel.getByLabel('Capital budget · MVR', { exact: true }).fill('1000000000');
			await panel.getByLabel('Annual running budget · MVR', { exact: true }).fill('1000000000');
			await panel.getByRole('button', { name: 'Done', exact: true }).click();
			const before = await mapEvidence();
			const target = await visibleHulhumaleRoad();
			await panel.getByRole('button', { name: 'Hospital', exact: true }).click();
			await page.mouse.click(target.point.x, target.point.y);
			const confirmation = page.getByTestId('map-placement-confirmation');
			await expect(confirmation).toHaveAttribute('aria-busy', 'false');
			await expect(confirmation).toHaveAttribute('data-placement-allowed', 'true');
			await confirmation.getByRole('button', { name: 'Add to proposal', exact: true }).click();
			await expect(confirmation).toHaveCount(0);
			await expect(atlas).toHaveAttribute('data-policy-calculating', 'false');
			await expect(atlas).toHaveAttribute('data-policy-proposal-points', '1');
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-policy-impact-cells')))
				.toBe(sourceFor(hulhumaleId).detail.hex_grid.features.length);
			await expect.poll(() => evaluations.length).toBeGreaterThan(0);
			const evaluated = evaluations.at(-1);
			assert.ok(evaluated);
			assert.equal(evaluated.request.island_id, hulhumaleId);
			assert.equal(evaluated.request.operations.length, 1);
			assert.equal(evaluated.request.operations[0].type, 'add_hospital');
			assert.deepEqual(
				evaluated.body.origins.map((origin) => origin.origin_id).sort(),
				sourceFor(hulhumaleId)
					.baseline.origins.map((origin) => origin.id)
					.sort(),
				'Loading neighboring maps must not add their residents to the selected proposal.'
			);
			/** @type {Array<{view:string,evidence:Awaited<ReturnType<typeof mapEvidence>>}>} */
			const comparisons = [];
			for (const [label, view] of [
				['Without proposal', 'before'],
				['With proposal', 'after']
			]) {
				await page.getByRole('button', { name: label, exact: true }).click();
				await expect(atlas).toHaveAttribute('data-policy-impact-view', view);
				const evidence = await mapEvidence();
				assert.deepEqual(evidence.localCells, before.localCells);
				assert.deepEqual(evidence.gapRanges, before.gapRanges);
				assert.deepEqual(evidence.screeningIslands, []);
				for (const island of [maleId, hulhuleId])
					assert.equal(
						evidence.backgroundCells[island] ?? 0,
						sourceFor(island).detail.hex_grid.features.length,
						`${island} keeps its complete baseline when ${label.toLowerCase()} is shown.`
					);
				assert.equal(evidence.backgroundCells[hulhumaleId] ?? 0, 0);
				comparisons.push({ view, evidence });
			}
			await panTo([73.514746, 4.17001]);
			await expect(page).toHaveURL((url) => url.searchParams.get('island') === hulhumaleId);
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-rendered-roads')))
				.toBeGreaterThan(0);
			await page.screenshot({
				path: path.join(output, 'hulhumale-proposal-neighboring-baseline.png')
			});
			return {
				coordinates: target.coordinates,
				evaluationIsland: evaluated.request.island_id,
				evaluatedOrigins: evaluated.body.origins.length,
				comparisons
			};
		}
	);
	assert.deepEqual(report.pageErrors, []);
} catch (error) {
	report.failure = String(error);
	await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
	throw error;
} finally {
	releaseMale();
	report.finishedAt = new Date().toISOString();
	await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
	await browser.close();
}
