import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const baseURL = process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5181';
const output = path.resolve('artifacts/qa/policy-native-drag');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 90000 });
/** @typedef {{x:number,y:number}} Point */
/** @typedef {[number,number]} Coordinates */
/** @typedef {{coordinates:Coordinates,point:Point}} RoadSite */
/** @typedef {{geometry?:Coordinates[]}} Road */
/** @typedef {{operations:Array<{type:string,coordinates:Coordinates}>}} EvaluationRequest */
/** @type {{baseURL:string,startedAt:string,finishedAt?:string,checks:Array<{name:string,status:string,detail?:unknown}>,errors:string[]}} */
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], errors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({
	viewport: { width: 1440, height: 1000 },
	reducedMotion: 'reduce'
});
page.setDefaultTimeout(90000);
page.on('pageerror', (error) => report.errors.push(error.message));
/** @type {EvaluationRequest[]} */
const requests = [];
page.on('request', (request) => {
	if (request.method() === 'POST' && request.url().includes('/planning/evaluate'))
		requests.push(request.postDataJSON());
});
const atlas = page.locator('.national-map');
const panel = page.getByRole('region', { name: 'Island needs and proposal', exact: true });
const budget = page.getByRole('region', { name: 'Proposal budget', exact: true });
const confirmation = panel.locator('.policy-placement-confirm');
const operations = panel.locator('.policy-operation-list li');
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
	}
}
/** @param {Coordinates} coordinates */
async function project(coordinates) {
	return atlas.evaluate((element, location) => {
		const canvas = element.querySelector('.maplibregl-canvas');
		if (!canvas) throw new Error('Map canvas is missing');
		const box = canvas.getBoundingClientRect();
		const zoom = Number(element.getAttribute('data-zoom'));
		const longitude = Number(element.getAttribute('data-center-longitude'));
		const latitude = Number(element.getAttribute('data-center-latitude'));
		const world = 512 * 2 ** zoom;
		/** @param {number} lat */
		const y = (lat) => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
		return {
			x: box.x + box.width / 2 + ((location[0] - longitude) * world) / 360,
			y: box.y + box.height / 2 + (y(location[1]) - y(latitude)) * world
		};
	}, coordinates);
}
/** @param {Road[]} roads @param {Point|null} prior @returns {Promise<RoadSite>} */
async function roadSite(roads, prior = null) {
	const box = await atlas.locator('.maplibregl-canvas').boundingBox();
	assert.ok(box, 'Map canvas must be visible');
	for (const road of roads)
		for (const coordinates of road.geometry ?? []) {
			const point = await project(coordinates);
			if (
				point.x < box.x + 60 ||
				point.x > box.x + box.width - 60 ||
				point.y < box.y + 150 ||
				point.y > box.y + box.height - 100
			)
				continue;
			if (prior && Math.hypot(point.x - prior.x, point.y - prior.y) < 100) continue;
			if (
				await page.evaluate(
					({ x, y }) => document.elementFromPoint(x, y)?.matches('.maplibregl-canvas') ?? false,
					point
				)
			)
				return { coordinates, point };
		}
	throw new Error('No clear, source-backed road site is visible');
}
/** @param {Point} from @param {Point} to */
async function mouseDrag(from, to) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x + 12, from.y + 3, { steps: 3 });
	await page.mouse.move(to.x, to.y, { steps: 35 });
	await page.mouse.move(to.x + 1, to.y, { steps: 2 });
	await page.mouse.move(to.x, to.y, { steps: 2 });
	await page.mouse.up();
}
/** @param {string} name @param {RoadSite} site */
async function paletteDrag(name, site) {
	const source = panel.locator('.policy-palette').getByRole('button', { name, exact: true });
	await source.scrollIntoViewIfNeeded();
	const box = await source.boundingBox();
	assert.ok(box);
	await mouseDrag({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, site.point);
	await expect(confirmation).toBeVisible();
	await expect(atlas).toHaveAttribute('data-policy-pending-points', '1');
	await expect(atlas.locator('.policy-proposal-marker.pending')).toBeAttached();
	await expect(
		confirmation.getByRole('button', { name: 'Add to proposal', exact: true })
	).toBeEnabled();
}
async function completedEstimate() {
	await expect(budget).toHaveAttribute('aria-busy', 'false');
	await expect(budget.locator('.cost-values')).not.toHaveClass(/outdated/);
	await expect(budget.locator('.cost-values')).not.toContainText('—');
	await expect(atlas).toHaveAttribute('data-policy-calculating', 'false');
	await expect
		.poll(async () => Number(await atlas.getAttribute('data-policy-impact-cells')))
		.toBeGreaterThan(0);
}
try {
	const response = await page.request.get(
		`${baseURL}/api/backend/planning/baseline?island_id=island%3A1442`
	);
	assert.equal(response.status(), 200);
	const baseline = await response.json();
	await page.goto(`${baseURL}/?view=map&tool=explore&island=island%3A1442`, {
		waitUntil: 'domcontentloaded'
	});
	await expect(atlas).toBeVisible();
	await expect(atlas).toHaveAttribute('aria-busy', 'false');
	await page.getByRole('button', { name: 'Create proposal', exact: true }).click();
	await expect(panel.locator('.policy-palette')).toBeVisible();
	await expect(operations).toHaveCount(0);
	const site = await roadSite(baseline.graph_edges);
	await check(
		'Native School palette drag creates a pending pin; Cancel leaves the empty proposal unchanged',
		async () => {
			await paletteDrag('School', site);
			await expect(
				confirmation.getByLabel('What would you add here?', { exact: true })
			).toHaveValue('add_school');
			await expect(operations).toHaveCount(0);
			await expect(budget).toHaveCount(0);
			await page.screenshot({ path: path.join(output, 'school-native-drag-pending.png') });
			await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
			await expect(confirmation).toHaveCount(0);
			await expect(atlas).toHaveAttribute('data-policy-pending-points', '0');
			await expect(atlas).toHaveAttribute('data-policy-proposal-points', '0');
			await expect(operations).toHaveCount(0);
			await expect(budget).toHaveCount(0);
			return { coordinates: site.coordinates, operationCount: 0, budgetCommitted: false };
		}
	);
	await check(
		'Native Hospital palette drag confirms a mapped, costed proposal and fresh resident impact',
		async () => {
			await paletteDrag('Hospital', site);
			await expect(
				confirmation.getByLabel('What would you add here?', { exact: true })
			).toHaveValue('add_hospital');
			await confirmation.getByRole('button', { name: 'Add to proposal', exact: true }).click();
			await expect(operations).toHaveCount(1);
			await expect(atlas).toHaveAttribute('data-policy-pending-points', '0');
			await expect(atlas).toHaveAttribute('data-policy-proposal-points', '1');
			await completedEstimate();
			await page.screenshot({ path: path.join(output, 'hospital-native-drag-confirmed.png') });
			return {
				coordinates: site.coordinates,
				costs: await budget.locator('.cost-values').innerText(),
				impactCells: Number(await atlas.getAttribute('data-policy-impact-cells'))
			};
		}
	);
	await check(
		'Dragging an accepted manual hospital pin updates its coordinates and recalculates fresh impact',
		async () => {
			const marker = atlas.locator('.policy-proposal-marker.confirmed');
			await expect(marker).toBeVisible();
			const box = await marker.boundingBox();
			assert.ok(box);
			const target = await roadSite(baseline.graph_edges, {
				x: box.x + box.width / 2,
				y: box.y + box.height / 2
			});
			const previousRequests = requests.length;
			await mouseDrag({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, target.point);
			await expect.poll(() => requests.length).toBeGreaterThan(previousRequests);
			await completedEstimate();
			await expect(operations).toHaveCount(1);
			const evaluated = requests.at(-1);
			assert.ok(evaluated, 'Moving the accepted pin must send an evaluation request');
			const operation = evaluated.operations.find((item) => item.type === 'add_hospital');
			assert.ok(operation);
			assert.ok(
				Math.hypot(
					operation.coordinates[0] - site.coordinates[0],
					operation.coordinates[1] - site.coordinates[1]
				) > 0.0001
			);
			await page.screenshot({ path: path.join(output, 'hospital-pin-drag-impact.png') });
			return {
				originalCoordinates: site.coordinates,
				newCoordinates: operation.coordinates,
				evaluationRequests: requests.length - previousRequests,
				costs: await budget.locator('.cost-values').innerText(),
				impactCells: Number(await atlas.getAttribute('data-policy-impact-cells'))
			};
		}
	);
	await check(
		'Cancelling another native School drop preserves the accepted hospital and exact nonzero costs',
		async () => {
			const costs = await budget.locator('.cost-values').innerText();
			const clearSite = await roadSite(baseline.graph_edges);
			await paletteDrag('School', clearSite);
			await expect(operations).toHaveCount(1);
			assert.equal(await budget.locator('.cost-values').innerText(), costs);
			await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
			await expect(atlas).toHaveAttribute('data-policy-pending-points', '0');
			await expect(atlas).toHaveAttribute('data-policy-proposal-points', '1');
			await expect(operations).toHaveCount(1);
			assert.equal(await budget.locator('.cost-values').innerText(), costs);
			return { operationCount: 1, unchangedCosts: costs };
		}
	);
	assert.deepEqual(report.errors, []);
} catch (error) {
	await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
	console.error(error);
	process.exitCode = 1;
} finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
	await browser.close();
	console.log(
		JSON.stringify({
			checks: report.checks.length,
			errors: report.errors,
			report: path.join(output, 'verification.json')
		})
	);
}
