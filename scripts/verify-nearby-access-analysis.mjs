import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Use the real source evidence and rendered map; delay one real response to exercise loading.
// An isolated context keeps the user's saved proposals unchanged.
const baseURL = process.env.BASE_URL || process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5173';
const output = path.resolve('artifacts/qa/nearby-access-analysis');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 60000 });
const maleId = 'island:1443';
const hulhumaleId = 'island:1442';
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
		)
	}));
}

async function openProposal() {
	if (!(await panel.isVisible()))
		await page.getByRole('button', { name: /^Create (?:a )?proposal$/ }).click();
	await expect(panel).toBeVisible();
	if ((await panel.getAttribute('data-policy-section')) !== 'proposal')
		await panel.getByRole('button', { name: /^Your proposal/ }).click();
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
		'Malé has complete local journey analysis rather than uniformly poor access',
		async () => {
			const response = await page.request.get(
				`${baseURL}/api/backend/planning/opportunities/${encodeURIComponent(maleId)}`
			);
			assert.equal(response.status(), 200);
			/** @type {{gap_cells:{features:Array<{properties:Record<string,unknown>}>},hex_grid:{features:unknown[]},assumptions:{date:string,departure_minutes:number,target_minutes:number},priority_score:number}} */
			const detail = await response.json();
			const origins = detail.gap_cells.features.map((feature) => feature.properties);
			assert.ok(origins.length > 0 && detail.hex_grid.features.length > 0);
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
				panel.locator('.policy-palette').getByRole('button', { name: 'Bus stop', exact: true })
			).toBeEnabled();
			await panel.getByRole('button', { name: 'Close island planning panel', exact: true }).click();
			await page.screenshot({ path: path.join(output, 'male-analysis-loading.png') });
			return { delayedRequests: delayedMaleRequests, evidence, selectedIslandReady: true };
		}
	);
	await check(
		'Both capital islands show local journey evidence and selecting Malé preserves its actual values',
		async () => {
			releaseMale();
			await expect.poll(async () => (await mapEvidence()).localIslands.includes(maleId)).toBe(true);
			const evidence = await mapEvidence();
			assert.ok(evidence.localIslands.includes(hulhumaleId));
			assert.ok(evidence.localCells[maleId] > 0 && evidence.localCells[hulhumaleId] > 0);
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
				await atlas.locator('.maplibregl-ctrl-zoom-in').click();
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
			await chooseIsland(maleId, 'Malé');
			await expect.poll(async () => (await mapEvidence()).localIslands.includes(maleId)).toBe(true);
			await openProposal();
			await expect(proposalTitle).toHaveValue('Malé service improvement');
			await expect(
				panel.locator('.policy-palette').getByRole('button', { name: 'Bus stop', exact: true })
			).toBeEnabled();
			await panel.getByRole('button', { name: 'Close island planning panel', exact: true }).click();
			const selectedMaleEvidence = await mapEvidence();
			assert.deepEqual(selectedMaleEvidence.gapRanges[maleId], maleRange);
			assert.equal(selectedMaleEvidence.localCells[maleId], evidence.localCells[maleId]);
			assert.deepEqual(selectedMaleEvidence.screeningIslands, []);
			await page.screenshot({ path: path.join(output, 'male-local-access.png') });
			return { capitalEvidence: evidence, selectedIsland: maleId, selectedMaleEvidence };
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
