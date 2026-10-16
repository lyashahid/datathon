import { projectMapPoint } from './browser-map.mjs';
import { browserBaseURL } from './browser-config.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const baseURL = browserBaseURL();
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
await page.addInitScript(() => {
	const original = DataTransfer.prototype.setDragImage;
	/** @param {Element} element @param {number} x @param {number} y */
	DataTransfer.prototype.setDragImage = function (element, x, y) {
		const bounds = element.getBoundingClientRect();
		Reflect.set(window, '__policyDragPreview', {
			kind: element.getAttribute('data-placement-icon'),
			width: bounds.width,
			height: bounds.height,
			hasIcon: !!element.querySelector('svg'),
			text: element.textContent?.trim(),
			x,
			y
		});
		original.call(this, element, x, y);
	};
});
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
const confirmation = atlas.getByTestId('map-placement-confirmation');
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
	return projectMapPoint(atlas, coordinates);
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
/** @param {string} name @param {RoadSite} site @param {boolean} allowed */
async function paletteDrag(name, site, allowed = true) {
	const source = panel.locator('.policy-palette').getByRole('button', { name, exact: true });
	await expect(source).toBeEnabled();
	await source.scrollIntoViewIfNeeded();
	const box = await source.boundingBox();
	assert.ok(box);
	await mouseDrag({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, site.point);
	await expect(confirmation).toBeVisible();
	await expect(atlas).toHaveAttribute('data-policy-pending-points', '1');
	await expect(atlas.locator('.policy-proposal-marker.pending')).toBeAttached();
	await expect(confirmation).toHaveAttribute('aria-busy', 'false');
	await expect(confirmation).toHaveAttribute('data-placement-allowed', String(allowed));
	await expect(
		confirmation.getByRole('button', { name: 'Confirm placement', exact: true })
	).toBeEnabled({ enabled: allowed });
	await expect(panel.getByRole('button', { name: 'Add to proposal', exact: true })).toHaveCount(0);
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
	await page.getByRole('button', { name: /^Create (?:a )?proposal$/ }).click();
	await expect(panel.locator('.policy-palette')).toBeVisible();
	await expect(
		panel.locator('.policy-palette').getByRole('button', { name: 'Bus stop', exact: true })
	).toBeEnabled();
	await expect(operations).toHaveCount(0);
	const site = await roadSite(baseline.graph_edges);
	await check(
		'Capital budget blocks a bus stop at its map pin; raising the limit enables confirmation',
		async () => {
			await panel.getByRole('button', { name: 'Edit budget limits', exact: true }).click();
			await panel.getByLabel('Capital budget · MVR', { exact: true }).fill('1');
			await panel.getByLabel('Annual running budget · MVR', { exact: true }).fill('50000000');
			const before = requests.length;
			await paletteDrag('Bus stop', site, false);
			await expect(confirmation).toHaveAttribute('data-placement-kind', 'add_stop');
			await expect(confirmation.getByRole('alert')).toContainText(/capital|budget/i);
			await expect(operations).toHaveCount(0);
			assert.equal(
				requests.length,
				before,
				'Rejected placement must not start an impact calculation'
			);
			const preview = await page.evaluate(() => Reflect.get(window, '__policyDragPreview'));
			assert.equal(preview.kind, 'add_stop');
			assert.equal(preview.hasIcon, true);
			assert.equal(preview.text, '');
			assert.ok(
				preview.width >= 30 && preview.width <= 60,
				'Native drag preview must be the compact icon, not the full palette card'
			);
			assert.ok(preview.height >= 30 && preview.height <= 60);
			await page.screenshot({ path: path.join(output, 'bus-over-budget-map-tooltip.png') });
			await panel.getByLabel('Capital budget · MVR', { exact: true }).fill('150000000');
			await expect(
				confirmation.getByRole('button', { name: 'Confirm placement', exact: true })
			).toBeEnabled();
			await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
			await expect(operations).toHaveCount(0);
			return { dragPreview: preview, rejectedImpactRequests: requests.length - before };
		}
	);
	await check(
		'Annual operating budget blocks a school independently of the capital budget',
		async () => {
			await panel.getByLabel('Annual running budget · MVR', { exact: true }).fill('0');
			const before = requests.length;
			await paletteDrag('School', site, false);
			await expect(confirmation).toHaveAttribute('data-placement-kind', 'add_school');
			await expect(confirmation.getByRole('alert')).toContainText(/annual|running|operating/i);
			await expect(operations).toHaveCount(0);
			assert.equal(requests.length, before);
			await panel.getByLabel('Annual running budget · MVR', { exact: true }).fill('25000000');
			await expect(
				confirmation.getByRole('button', { name: 'Confirm placement', exact: true })
			).toBeEnabled();
			await page.keyboard.press('Escape');
			await expect(confirmation).toHaveCount(0);
			await expect(operations).toHaveCount(0);
			return { rejectedImpactRequests: requests.length - before, escapeCancelled: true };
		}
	);
	await check(
		'Native School palette drag creates a pending pin; Cancel leaves the empty proposal unchanged',
		async () => {
			await paletteDrag('School', site);
			await expect(confirmation).toHaveAttribute('data-placement-kind', 'add_school');
			await expect(operations).toHaveCount(0);
			await expect(budget).toHaveCount(0);
			const marker = atlas.locator('.policy-proposal-marker.pending');
			const pin = await marker.boundingBox();
			assert.ok(pin);
			const beforePosition = await marker.getAttribute('style');
			const beforeView = await atlas.evaluate((element) => [
				element.getAttribute('data-center-longitude'),
				element.getAttribute('data-center-latitude'),
				element.getAttribute('data-zoom')
			]);
			const moved = await roadSite(baseline.graph_edges, { x: pin.x, y: pin.y });
			await mouseDrag({ x: pin.x + pin.width / 2, y: pin.y + pin.height / 2 }, moved.point);
			await expect.poll(() => marker.getAttribute('style')).not.toBe(beforePosition);
			await expect(
				confirmation.getByRole('button', { name: 'Confirm placement', exact: true })
			).toBeEnabled();
			assert.deepEqual(
				await atlas.evaluate((element) => [
					element.getAttribute('data-center-longitude'),
					element.getAttribute('data-center-latitude'),
					element.getAttribute('data-zoom')
				]),
				beforeView,
				'Moving the preview and its confirmation must preserve the camera'
			);
			const tooltip = await confirmation.boundingBox();
			const sidebar = await panel.boundingBox();
			assert.ok(tooltip && sidebar);
			assert.ok(
				tooltip.x >= 0 && tooltip.y >= 0 && tooltip.x + tooltip.width <= sidebar.x,
				'The map confirmation must fit in the exposed map beside the planner'
			);
			await page.screenshot({ path: path.join(output, 'school-native-drag-pending.png') });
			await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
			await expect(confirmation).toHaveCount(0);
			await expect(atlas).toHaveAttribute('data-policy-pending-points', '0');
			await expect(atlas).toHaveAttribute('data-policy-proposal-points', '0');
			await expect(operations).toHaveCount(0);
			await expect(budget).toHaveCount(0);
			return {
				coordinates: site.coordinates,
				movedPreview: moved.coordinates,
				operationCount: 0,
				budgetCommitted: false
			};
		}
	);
	await check(
		'Native Hospital palette drag confirms a mapped, costed proposal and fresh resident impact',
		async () => {
			await paletteDrag('Hospital', site);
			await expect(confirmation).toHaveAttribute('data-placement-kind', 'add_hospital');
			const started = performance.now();
			const beforeRequests = requests.length;
			await confirmation.getByRole('button', { name: 'Confirm placement', exact: true }).click();
			await expect(operations).toHaveCount(1);
			await expect(atlas).toHaveAttribute('data-policy-pending-points', '0');
			await expect(atlas).toHaveAttribute('data-policy-proposal-points', '1');
			await completedEstimate();
			await page.screenshot({ path: path.join(output, 'hospital-native-drag-confirmed.png') });
			return {
				coordinates: site.coordinates,
				impactReadyMs: Math.round(performance.now() - started),
				evaluationRequests: requests.length - beforeRequests,
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
	await check(
		'Mobile bus placement keeps its on-map confirmation reachable above the compact planner',
		async () => {
			await page.setViewportSize({ width: 390, height: 844 });
			await page.goto(`${baseURL}/?view=map&tool=explore&island=island%3A1442`, {
				waitUntil: 'domcontentloaded'
			});
			await expect(atlas).toHaveAttribute('aria-busy', 'false');
			await page.getByRole('button', { name: /^Create (?:a )?proposal$/ }).click();
			await expect(
				panel.locator('.policy-palette').getByRole('button', { name: 'Bus stop', exact: true })
			).toBeEnabled();
			const visibleSite = await roadSite(baseline.graph_edges);
			await paletteDrag('Bus stop', visibleSite);
			await expect(panel).toHaveClass(/placing/);
			const tooltip = await confirmation.boundingBox();
			const compactPanel = await panel.boundingBox();
			assert.ok(tooltip && compactPanel);
			assert.ok(
				tooltip.x >= 0 &&
					tooltip.y >= 0 &&
					tooltip.x + tooltip.width <= 390 &&
					tooltip.y + tooltip.height <= compactPanel.y,
				'Mobile placement card must fit in the map above the planner'
			);
			await expect(
				confirmation.getByRole('button', { name: 'Confirm placement', exact: true })
			).toBeInViewport();
			await expect(
				confirmation.getByRole('button', { name: 'Cancel', exact: true })
			).toBeInViewport();
			assert.equal(
				await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
				true
			);
			await page.screenshot({ path: path.join(output, 'bus-map-tooltip-mobile.png') });
			await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
			await expect(confirmation).toHaveCount(0);
			await expect(operations).toHaveCount(1);
			return { viewport: 390, tooltip, compactPanel, preservedChanges: 1 };
		}
	);
	await check(
		'A placement cannot be confirmed until its real backend budget quote has resolved',
		async () => {
			// Change the quote key so an earlier verified placement cannot satisfy this check.
			if (!(await panel.getByLabel('Capital budget · MVR', { exact: true }).isVisible()))
				await panel.getByRole('button', { name: 'Edit budget limits', exact: true }).click();
			await panel.getByLabel('Capital budget · MVR', { exact: true }).fill('151000000');
			const visibleSite = await roadSite(baseline.graph_edges);
			let releaseQuote = () => {};
			let quoteHeld = false;
			const quoteGate = new Promise((resolve) => {
				releaseQuote = () => resolve(undefined);
			});
			await page.route(
				'**/api/backend/planning/quote',
				async (route) => {
					quoteHeld = true;
					await quoteGate;
					await route.continue();
				},
				{ times: 1 }
			);
			const placement = paletteDrag('Bus stop', visibleSite);
			try {
				await expect.poll(() => quoteHeld).toBe(true);
				await expect(confirmation).toHaveAttribute('aria-busy', 'true');
				await expect(
					confirmation.getByRole('button', { name: 'Confirm placement', exact: true })
				).toBeDisabled();
				await expect(operations).toHaveCount(1);
			} finally {
				releaseQuote();
			}
			await placement;
			await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
			await expect(operations).toHaveCount(1);
			return { heldRealQuote: true, confirmationBlockedUntilVerified: true, preservedChanges: 1 };
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
