import { projectMapPoint } from './browser-map.mjs';
import { browserBaseURL } from './browser-config.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Exercise the production application, real quotes and real resident evaluations.
// Pointer locations are projected from the source road/resident data, not test-only app state.
const baseURL = browserBaseURL();
const output = path.resolve('artifacts/qa/proposal-experience');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 60000 });
/** @typedef {[number,number]} Coordinates */
/** @typedef {{x:number,y:number}} Point */
/** @typedef {{coordinates:Coordinates,point:Point}} Site */
/** @typedef {{geometry?:Coordinates[]}} Road */
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
/** @type {Array<{operations:Array<{type:string,coordinates?:Coordinates}>,assumptions:Record<string,unknown>}>} */
const evaluationRequests = [];
page.on('request', (request) => {
	if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/planning/evaluate'))
		evaluationRequests.push(request.postDataJSON());
});
await page.addInitScript(() => {
	const original = DataTransfer.prototype.setDragImage;
	/** @param {Element} element @param {number} x @param {number} y */
	DataTransfer.prototype.setDragImage = function (element, x, y) {
		const box = element.getBoundingClientRect();
		Reflect.set(window, '__proposalDragImage', {
			kind: element.getAttribute('data-placement-icon'),
			width: box.width,
			height: box.height,
			hasIcon: !!element.querySelector('svg'),
			text: element.textContent?.trim()
		});
		original.call(this, element, x, y);
	};
});
const atlas = page.locator('.national-map');
const panel = page.getByRole('region', { name: 'Island needs and proposal', exact: true });
const budget = page.getByRole('region', { name: 'Proposal budget', exact: true });
const confirmation = atlas.getByTestId('map-placement-confirmation');
const preview = atlas.getByTestId('map-placement-preview');
const markerActions = atlas.getByTestId('proposal-marker-actions');
const serviceEditor = atlas.getByTestId('map-service-editor');
const palette = panel.locator('.policy-palette');
/** @type {{graph_edges:Road[],origins:Array<{lon:number,lat:number}>}} */
let baseline;

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

/** @param {Coordinates} coordinates */
async function project(coordinates) {
	return projectMapPoint(atlas, coordinates);
}

/** @param {Point} point */
async function mapIsClear(point) {
	return page.evaluate(
		({ x, y }) =>
			x > 35 &&
			x < innerWidth - 35 &&
			y > 150 &&
			y < innerHeight - 80 &&
			(document.elementFromPoint(x, y)?.matches('.maplibregl-canvas') ?? false),
		point
	);
}

/** @param {Point|null} prior @returns {Promise<Site>} */
async function roadSite(prior = null) {
	for (const road of baseline.graph_edges)
		for (const coordinates of road.geometry ?? []) {
			const point = await project(coordinates);
			if (prior && Math.hypot(point.x - prior.x, point.y - prior.y) < 95) continue;
			if (await mapIsClear(point)) return { coordinates, point };
		}
	throw new Error('No source-backed road location is visible outside the map controls.');
}

/** Find a real, road-routable candidate rather than assuming every street has a bus connection. */
async function connectionSite() {
	const draft = await page.evaluate(() =>
		JSON.parse(localStorage.getItem('policy-map-v2:island:1442') ?? '{}')
	);
	const seen = new Set();
	let inspected = 0;
	for (const road of baseline.graph_edges) {
		for (const coordinates of road.geometry ?? []) {
			const identity = coordinates.join(',');
			if (seen.has(identity)) continue;
			seen.add(identity);
			const point = await project(coordinates);
			if (!(await mapIsClear(point))) continue;
			const response = await page.request.post(`${baseURL}/api/backend/planning/bus-connection`, {
				data: {
					island_id: 'island:1442',
					coordinates,
					assumptions: draft.assumptions,
					operations: draft.operations
				}
			});
			assert.equal(response.status(), 200, await response.text());
			if ((await response.json()).status === 'ready') return { coordinates, point };
			inspected += 1;
			if (inspected >= 30) throw new Error('No routable visible bus-stop connection was found.');
		}
	}
	throw new Error('No source-backed bus connection is visible outside the map controls.');
}

/** @param {Coordinates[]} candidates @returns {Promise<Point|null>} */
async function visibleIslandPoint(candidates) {
	for (const coordinates of candidates) {
		const point = await project(coordinates);
		if (await mapIsClear(point)) return point;
	}
	return null;
}

/** @param {Point} from @param {Point} to */
async function drag(from, to) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x + 12, from.y + 3, { steps: 3 });
	await page.mouse.move(to.x, to.y, { steps: 30 });
	await page.mouse.move(to.x + 1, to.y, { steps: 2 });
	await page.mouse.move(to.x, to.y, { steps: 2 });
	await page.mouse.up();
}

/** @param {boolean} allowed */
async function readyPlacement(allowed = true) {
	await expect(confirmation).toBeVisible();
	await expect(confirmation).toHaveAttribute('aria-busy', 'false');
	await expect(confirmation).toHaveAttribute('data-placement-allowed', String(allowed));
	await expect(
		confirmation.getByRole('button', { name: /^(Add to proposal|Confirm move)$/ })
	).toBeEnabled({ enabled: allowed });
}

async function completedImpact() {
	await expect(atlas).toHaveAttribute('data-policy-calculating', 'false');
	await expect(budget).toHaveAttribute('aria-busy', 'false');
	await expect
		.poll(async () => Number(await atlas.getAttribute('data-policy-impact-cells')))
		.toBeGreaterThan(0);
	await expect(budget.locator('.cost-values')).not.toContainText('—');
}

async function openProposal() {
	await page.goto(`${baseURL}/?view=map&tool=explore&island=island%3A1442`, {
		waitUntil: 'domcontentloaded'
	});
	await expect(atlas).toHaveAttribute('aria-busy', 'false');
	await page.getByRole('button', { name: /^Create (?:a )?proposal$/ }).click();
	await expect(palette.getByRole('button', { name: 'Bus stop', exact: true })).toBeEnabled();
}

async function showProposal() {
	if (!(await panel.isVisible()))
		await page.getByRole('button', { name: /^Create (?:a )?proposal$/ }).click();
	await expect(panel).toBeVisible();
	if ((await panel.getAttribute('data-policy-section')) !== 'proposal')
		await panel.getByRole('button', { name: /^Your proposal/ }).click();
}

/** @param {string} name */
async function choosePlacement(name) {
	await showProposal();
	await palette.getByRole('button', { name, exact: true }).click();
}

/** @param {number} count */
async function acceptedPoints(count) {
	await expect(atlas).toHaveAttribute('data-policy-proposal-points', String(count));
}

async function acceptedLocation() {
	const marker = atlas.locator('.policy-proposal-marker.confirmed').first();
	return {
		longitude: await marker.getAttribute('data-longitude'),
		latitude: await marker.getAttribute('data-latitude')
	};
}

async function noOverflow() {
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
		.toBe(true);
}

/** @param {import('@playwright/test').Locator} item */
async function fullyOnScreen(item) {
	const viewport = page.viewportSize();
	assert.ok(viewport);
	// Anchored cards measure their content and settle on the next animation frame.
	await expect
		.poll(
			async () => {
				const box = await item.boundingBox();
				return !!(
					box &&
					box.x >= 0 &&
					box.y >= 0 &&
					box.x + box.width <= viewport.width + 1 &&
					box.y + box.height <= viewport.height + 1
				);
			},
			{ message: 'The actionable map card must fit on screen after layout settles', timeout: 3000 }
		)
		.toBe(true);
	const box = await item.boundingBox();
	assert.ok(box);
	return box;
}

/** @param {import('@playwright/test').Locator} item */
async function accessibleAction(item) {
	await expect(item).toBeInViewport({ ratio: 1 });
	await expect
		.poll(() =>
			item.evaluate((element) => {
				const box = element.getBoundingClientRect();
				const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
				return !!hit && (hit === element || element.contains(hit));
			})
		)
		.toBe(true);
}

try {
	const source = await page.request.get(
		`${baseURL}/api/backend/planning/baseline?island_id=island%3A1442`
	);
	assert.equal(source.status(), 200, await source.text());
	baseline = await source.json();
	await openProposal();
	await check('A new proposal has a visible zero-cost budget before adding anything', async () => {
		await acceptedPoints(0);
		await expect(budget).toBeVisible();
		await expect(budget).toContainText(/remaining/i);
		await expect(budget.locator('.cost-values')).toContainText('0');
		return { visibleBudgetAtStart: true };
	});
	await check(
		'Cleared budget limits are blocked while an explicit zero remains valid',
		async () => {
			await panel.getByRole('button', { name: /^Find options within my budget/ }).click();
			const capital = panel.getByLabel('Capital budget · MVR', { exact: true });
			const annual = panel.getByLabel('Annual running budget · MVR', { exact: true });
			const originalCapital = await capital.inputValue();
			const originalAnnual = await annual.inputValue();
			const suggest = panel.getByRole('button', {
				name: 'Suggest investments within my budget',
				exact: true
			});
			await capital.fill('');
			await expect(panel.getByRole('alert')).toContainText('Enter a valid capital budget');
			await expect(suggest).toBeDisabled();
			await capital.fill('0');
			await annual.fill('0');
			await expect(panel.locator('.policy-budget-alert')).toBeHidden();
			await expect(suggest).toBeEnabled();
			await annual.fill('');
			await expect(panel.getByRole('alert')).toContainText('Enter a valid capital budget');
			await expect(suggest).toBeDisabled();
			await capital.fill(originalCapital);
			await annual.fill(originalAnnual);
			await expect(panel.locator('.policy-budget-alert')).toBeHidden();
			await expect(suggest).toBeEnabled();
			await panel.getByRole('button', { name: /^Add an improvement/ }).click();
			return { missingLimitsBlocked: true, explicitZeroAllowed: true, validBudgetsRestored: true };
		}
	);
	await check(
		'Click-to-place previews a bus icon and suggests a road path in an anchored editor',
		async () => {
			await choosePlacement('Bus stop');
			const site = await connectionSite();
			await page.mouse.move(site.point.x, site.point.y);
			await expect(preview).toBeVisible();
			await expect(preview).toHaveAttribute('data-placement-kind', 'add_stop');
			await expect(atlas.getByTestId('placement-distance-guide')).toBeVisible();
			await expect(preview).toHaveAttribute('data-placement-snapped', 'true');
			await expect(preview).toContainText('Aligned to a mapped road');
			await acceptedPoints(0);
			await page.mouse.click(site.point.x, site.point.y);
			await expect(serviceEditor).toHaveAttribute('data-service-mode', 'bus-connection');
			await expect(
				serviceEditor.getByRole('button', { name: 'Accept stop & route', exact: true })
			).toBeEnabled();
			await fullyOnScreen(serviceEditor);
			await expect(serviceEditor).toContainText(/mapped roads|road path/i);
			await expect(serviceEditor.locator('.service-costs')).toContainText(/upfront|per year/);
			await expect(panel.getByRole('button', { name: 'Add to proposal', exact: true })).toHaveCount(
				0
			);
			await page.screenshot({ path: path.join(output, 'click-place-preview.png') });
			await serviceEditor
				.getByRole('button', { name: 'Cancel bus connection', exact: true })
				.click();
			await expect(serviceEditor).toHaveCount(0);
			await acceptedPoints(0);
			return { sourceRoad: site.coordinates, noChangesBeforeConfirmation: true };
		}
	);
	await check('Escape cancels an armed placement without adding a point', async () => {
		await choosePlacement('School');
		const site = await roadSite();
		await page.mouse.move(site.point.x, site.point.y);
		await expect(preview).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(preview).toHaveCount(0);
		await expect(confirmation).toHaveCount(0);
		await acceptedPoints(0);
		return { escapeCancels: true };
	});
	await check(
		'A blocked placement explains its shortfall and offers budget adjustment at the pin',
		async () => {
			await showProposal();
			await panel.getByRole('button', { name: 'Edit budget limits', exact: true }).click();
			await panel.getByLabel('Capital budget · MVR', { exact: true }).fill('1');
			await panel.getByLabel('Annual running budget · MVR', { exact: true }).fill('1');
			const count = evaluationRequests.length;
			await choosePlacement('School');
			const site = await roadSite();
			await page.mouse.click(site.point.x, site.point.y);
			await readyPlacement(false);
			await expect(confirmation.getByRole('alert')).toContainText(/budget|short|exceed/i);
			await expect(budget).toBeHidden();
			assert.equal(
				evaluationRequests.length,
				count,
				'An over-budget preview cannot run an impact evaluation.'
			);
			await confirmation.getByRole('button', { name: /^Adjust budgets?$/ }).click();
			await expect(panel.getByLabel('Capital budget · MVR', { exact: true })).toBeInViewport();
			await panel.getByLabel('Capital budget · MVR', { exact: true }).fill('1000000000');
			await panel.getByLabel('Annual running budget · MVR', { exact: true }).fill('1000000000');
			await readyPlacement();
			await page.screenshot({ path: path.join(output, 'budget-adjustment.png') });
			await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
			await acceptedPoints(0);
			return { overBudgetImpactRequests: 0, freshQuoteAfterBudgetChange: true };
		}
	);
	await check(
		'Native dragging uses only the service icon and commits from its anchored map bubble',
		async () => {
			await showProposal();
			const source = palette.getByRole('button', { name: 'Hospital', exact: true });
			await source.scrollIntoViewIfNeeded();
			const box = await source.boundingBox();
			assert.ok(box);
			const site = await roadSite();
			await drag({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, site.point);
			await readyPlacement();
			const image = await page.evaluate(() => Reflect.get(window, '__proposalDragImage'));
			assert.equal(image.kind, 'add_hospital');
			assert.equal(image.hasIcon, true);
			assert.equal(image.text, '');
			assert.ok(image.width >= 30 && image.width <= 60 && image.height >= 30 && image.height <= 60);
			await expect(confirmation.locator('.placement-access-preview strong')).toBeVisible();
			const calculations = evaluationRequests.length;
			await confirmation.getByRole('button', { name: 'Add to proposal', exact: true }).click();
			await acceptedPoints(1);
			await completedImpact();
			assert.equal(
				evaluationRequests.length,
				calculations,
				'Confirming the exact completed preview reuses its resident calculation.'
			);
			await page.screenshot({ path: path.join(output, 'hospital-confirmed.png') });
			return {
				dragImage: image,
				completedPreviewReused: true,
				impactCells: await atlas.getAttribute('data-policy-impact-cells')
			};
		}
	);
	await check(
		'Selecting a proposed marker exposes Move, Duplicate and Remove on the map',
		async () => {
			await atlas.locator('.policy-proposal-marker.confirmed').click();
			await expect(markerActions).toBeVisible();
			for (const name of ['Move', 'Duplicate', 'Remove'])
				await expect(markerActions.getByRole('button', { name, exact: true })).toBeEnabled();
			await fullyOnScreen(markerActions);
			await page.screenshot({ path: path.join(output, 'marker-actions.png') });
			return { actions: ['Move', 'Duplicate', 'Remove'] };
		}
	);
	await check('A canceled move keeps the accepted location and committed costs', async () => {
		const before = await acceptedLocation();
		const costs = await budget.locator('.cost-values').innerText();
		await markerActions.getByRole('button', { name: 'Move', exact: true }).click();
		const prior = await project([Number(before.longitude), Number(before.latitude)]);
		const site = await roadSite(prior);
		await page.mouse.click(site.point.x, site.point.y);
		await readyPlacement();
		await expect(
			confirmation.getByRole('button', { name: 'Confirm move', exact: true })
		).toBeEnabled();
		await page.keyboard.press('Escape');
		await expect(confirmation).toHaveCount(0);
		await acceptedPoints(1);
		assert.ok(before.longitude && before.latitude, 'The marker exposes its saved location.');
		assert.deepEqual(await acceptedLocation(), before);
		await expect(budget.locator('.cost-values')).toHaveText(costs, { useInnerText: true });
		return { retainedAcceptedCoordinates: true, retainedCommittedCosts: true };
	});
	await check(
		'Dragging an accepted marker previews a move before changing the proposal',
		async () => {
			const before = await acceptedLocation();
			const marker = atlas.locator('.policy-proposal-marker.confirmed');
			const box = await marker.boundingBox();
			assert.ok(box);
			const prior = await project([Number(before.longitude), Number(before.latitude)]);
			const site = await roadSite(prior);
			await drag({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, site.point);
			await readyPlacement();
			await expect(
				confirmation.getByRole('button', { name: 'Confirm move', exact: true })
			).toBeEnabled();
			await acceptedPoints(1);
			await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
			await expect.poll(acceptedLocation).toEqual(before);
			await acceptedPoints(1);
			return { directDragRequiresConfirmation: true, cancelRestoresAcceptedLocation: true };
		}
	);
	await check(
		'Duplicate stays a preview until confirmed and removal is reversible with Undo',
		async () => {
			await atlas.locator('.policy-proposal-marker.confirmed').click();
			await markerActions.getByRole('button', { name: 'Duplicate', exact: true }).click();
			const before = await acceptedLocation();
			const prior = await project([Number(before.longitude), Number(before.latitude)]);
			const site = await roadSite(prior);
			await page.mouse.click(site.point.x, site.point.y);
			await readyPlacement();
			await acceptedPoints(1);
			await confirmation.getByRole('button', { name: 'Add to proposal', exact: true }).click();
			await acceptedPoints(2);
			await completedImpact();
			await atlas.locator('.policy-proposal-marker.confirmed').last().click();
			await markerActions.getByRole('button', { name: 'Remove', exact: true }).click();
			await acceptedPoints(1);
			const undo = page
				.getByRole('button', { name: 'Undo proposal change', exact: true })
				.filter({ visible: true });
			await undo.first().click();
			await acceptedPoints(2);
			await completedImpact();
			return { confirmedAfterDuplicate: 2, afterRemove: 1, afterUndo: 2 };
		}
	);
	await check(
		'A confirmed move updates the location and Undo restores the original site',
		async () => {
			const before = await acceptedLocation();
			await atlas.locator('.policy-proposal-marker.confirmed').first().click();
			await markerActions.getByRole('button', { name: 'Move', exact: true }).click();
			const prior = await project([Number(before.longitude), Number(before.latitude)]);
			const site = await roadSite(prior);
			await page.mouse.click(site.point.x, site.point.y);
			await readyPlacement();
			await confirmation.getByRole('button', { name: 'Confirm move', exact: true }).click();
			await acceptedPoints(2);
			await completedImpact();
			const moved = await acceptedLocation();
			assert.notDeepEqual(moved, before);
			await page
				.getByRole('button', { name: 'Undo proposal change', exact: true })
				.filter({ visible: true })
				.first()
				.click();
			await acceptedPoints(2);
			await expect.poll(acceptedLocation).toEqual(before);
			await completedImpact();
			return { before, moved, undoRestored: true };
		}
	);
	// The final view and ferry scenarios below are kept with the same session so they
	// also catch state leaking between placement, inspection and navigation modes.
	await check(
		'Proposal comparison switches before and after without a new resident calculation',
		async () => {
			const before = evaluationRequests.length;
			for (const [name, view] of [
				['Without proposal', 'before'],
				['With proposal', 'after']
			]) {
				const action = page.getByRole('button', { name, exact: true });
				await action.click();
				await expect(action).toHaveAttribute('aria-pressed', 'true');
				await expect(atlas).toHaveAttribute('data-policy-impact-view', view);
			}
			assert.equal(evaluationRequests.length, before);
			await page.screenshot({ path: path.join(output, 'proposal-comparison.png') });
			return { views: 2, additionalCalculations: 0 };
		}
	);
	await check(
		'A selected impact hex explains current and proposed access in plain language',
		async () => {
			const explanation = panel.locator('[aria-label="Selected neighbourhood impact"]');
			for (const origin of baseline.origins) {
				const point = await project([origin.lon, origin.lat]);
				if (!(await mapIsClear(point))) continue;
				await page.mouse.click(point.x, point.y);
				if (await explanation.isVisible()) break;
			}
			await expect(explanation).toBeVisible();
			const cellId = await explanation.getAttribute('data-cell-id');
			assert.ok(cellId, 'A neighbourhood cell is selected');
			await page.getByRole('button', { name: 'Without proposal', exact: true }).click();
			await expect(atlas).toHaveAttribute('data-policy-impact-view', 'before');
			await expect(explanation).toHaveAttribute('data-cell-id', cellId);
			await expect(explanation).toContainText(/current|before/i);
			await expect(explanation).not.toContainText('wp:');
			const before = await explanation.innerText();
			await page.getByRole('button', { name: 'With proposal', exact: true }).click();
			await expect(atlas).toHaveAttribute('data-policy-impact-view', 'after');
			await expect(explanation).toHaveAttribute('data-cell-id', cellId);
			await expect(explanation).toContainText(/proposal|after/i);
			await expect(explanation).not.toContainText('wp:');
			await page.screenshot({ path: path.join(output, 'neighbourhood-explanation.png') });
			return { cellId, before, after: await explanation.innerText() };
		}
	);
	await check('The full review is available after the latest impact completes', async () => {
		await page
			.getByRole('button', { name: 'Review full impact', exact: true })
			.filter({ visible: true })
			.first()
			.click();
		const review = page.getByRole('dialog');
		await expect(review).toBeVisible();
		await expect(review).toContainText(/resident|access/i);
		await expect(review.getByRole('button', { name: 'Save as PDF', exact: true })).toBeEnabled();
		await page.screenshot({ path: path.join(output, 'full-impact-review.png') });
		await review.getByRole('button', { name: 'Close proposal review', exact: true }).click();
		return { fullReview: true, pdfReady: true };
	});
	await check(
		'An existing bus route is edited on the map with automatic costs and an active service date',
		async () => {
			await showProposal();
			await expect(palette.getByRole('button', { name: 'Bus stop', exact: true })).toBeEnabled();
			await panel.getByRole('button', { name: /^Bus service/ }).click();
			const composer = serviceEditor;
			await expect(composer).toHaveAttribute('data-service-mode', 'bus');
			await fullyOnScreen(composer);
			await expect(composer.getByLabel('Bus route and direction', { exact: true })).not.toHaveValue(
				''
			);
			const serviceDate = composer.getByLabel('Service date', { exact: true });
			const acceptService = composer.getByRole('button', {
				name: 'Accept service',
				exact: true
			});
			await serviceDate.fill('2026-10-11');
			await expect(composer.getByRole('alert')).toContainText(
				'No recorded departures on this date'
			);
			await expect(acceptService).toBeDisabled();
			await composer
				.getByRole('button', { name: 'Use recorded service date', exact: true })
				.click();
			await expect(serviceDate).toHaveValue('2026-10-10');
			await composer.locator('#proposal-bus-frequency').fill('10');
			await expect(acceptService).toBeEnabled();
			await expect(composer).toContainText('The reverse direction is unchanged');
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-policy-service-features')))
				.toBeGreaterThan(0);
			await acceptedPoints(2);
			await page.screenshot({ path: path.join(output, 'bus-service-preview.png') });
			await acceptService.click();
			await expect(composer).toHaveCount(0);
			await completedImpact();
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-policy-service-features')))
				.toBeGreaterThan(0);
			await acceptedPoints(2);
			await page.screenshot({ path: path.join(output, 'bus-service-confirmed.png') });
			await page
				.getByRole('button', { name: 'Undo proposal change', exact: true })
				.filter({ visible: true })
				.first()
				.click();
			await acceptedPoints(2);
			await completedImpact();
			await expect(atlas).toHaveAttribute('data-policy-service-features', '0');
			return {
				separateBoardingPointAndService: true,
				previewDoesNotCommit: true,
				busServiceConfirmedAndEvaluated: true,
				undoRestoresPreviousProposal: true,
				inactiveDateBlocked: true,
				recordedServiceDateRestored: true
			};
		}
	);
	await check(
		'A suggested bus connection commits its stop and return route together and appears in the impact review',
		async () => {
			await choosePlacement('Bus stop');
			const site = await connectionSite();
			await page.mouse.click(site.point.x, site.point.y);
			await expect(serviceEditor).toHaveAttribute('data-service-mode', 'bus-connection');
			await expect(serviceEditor.locator('#connection-stop')).not.toHaveValue('');
			const accept = serviceEditor.getByRole('button', {
				name: 'Accept stop & route',
				exact: true
			});
			await expect(accept).toBeEnabled();
			await expect(serviceEditor).toContainText('trips each way');
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-policy-service-features')))
				.toBeGreaterThan(0);
			await acceptedPoints(2);
			await page.screenshot({ path: path.join(output, 'bus-connection-preview.png') });
			await accept.click();
			await expect(serviceEditor).toHaveCount(0);
			await acceptedPoints(3);
			await completedImpact();
			const saved = await page.evaluate(() =>
				JSON.parse(localStorage.getItem('policy-map-v2:island:1442') ?? '{}')
			);
			/** @type {Array<{type:string,metadata?:Record<string,unknown>,service?:{mode:string,routeId:string,stopIds:string[]}}>} */
			const operations = saved.operations;
			const stop = operations.find((operation) => operation.metadata?.ui_bus_summary);
			assert.ok(stop, 'The saved proposal has one named bus connection summary.');
			const packageId = stop.metadata?.ui_package;
			assert.equal(typeof packageId, 'string');
			const members = operations.filter(
				(operation) => operation.metadata?.ui_package === packageId
			);
			assert.equal(
				members.length,
				3,
				'The new stop and both bus directions form one proposal change.'
			);
			assert.equal(members.filter((operation) => operation.type === 'add_stop').length, 1);
			const services = members.filter((operation) => operation.type === 'add_service');
			assert.equal(services.length, 2);
			assert.ok(services.every((operation) => operation.service?.mode === 'bus'));
			assert.equal(services[0].service?.routeId, services[1].service?.routeId);
			assert.deepEqual(
				services[0].service?.stopIds,
				[...(services[1].service?.stopIds ?? [])].reverse()
			);
			await page
				.getByRole('button', { name: 'Review full impact', exact: true })
				.filter({ visible: true })
				.first()
				.click();
			const review = page.getByRole('dialog');
			await expect(
				review.getByRole('heading', { name: 'What the bus service changes' })
			).toBeVisible();
			const serviceImpact = review.getByRole('region', { name: 'Transport service impact' });
			await expect(
				serviceImpact.locator('.service-row').filter({ hasText: 'New service' })
			).toHaveCount(2);
			await expect(serviceImpact).toContainText('Dated departures');
			await expect(serviceImpact).toContainText('Expected wait');
			await expect(serviceImpact).toContainText('not observed passenger waits or ridership');
			await expect(review.getByRole('button', { name: 'Save as PDF', exact: true })).toBeEnabled();
			await page.screenshot({ path: path.join(output, 'bus-connection-review.png') });
			await review.getByRole('button', { name: 'Close proposal review', exact: true }).click();
			await page
				.getByRole('button', { name: 'Undo proposal change', exact: true })
				.filter({ visible: true })
				.first()
				.click();
			await acceptedPoints(2);
			await completedImpact();
			await expect(atlas).toHaveAttribute('data-policy-service-features', '0');
			return {
				sourceRoad: site.coordinates,
				packageOperations: members.length,
				returnRouteSaved: true,
				transportReviewAvailable: true,
				undoRemovesWholePackage: true
			};
		}
	);
	await check(
		'A ferry starts at an existing landing and its destination is selected on the map',
		async () => {
			const source = await page.request.get(
				`${baseURL}/api/backend/planning/connectivity?origin_island_id=island:1442&destination_island_id=island:1443&date=2026-10-10`
			);
			assert.equal(source.status(), 200);
			const evidence = await source.json();
			const destinationSource = await page.request.get(
				`${baseURL}/api/backend/planning/baseline?island_id=island%3A1443`
			);
			assert.equal(destinationSource.status(), 200);
			/** @type {{origins:Array<{lon:number,lat:number}>}} */
			const destinationBaseline = await destinationSource.json();
			/** @type {Coordinates[]} */
			const destinationLocations = [
				evidence.destination.coordinates,
				...destinationBaseline.origins.map(
					({ lon, lat }) => /** @type {Coordinates} */ ([lon, lat])
				)
			];
			await showProposal();
			await panel.getByRole('button', { name: /^Ferry service/ }).click();
			const composer = serviceEditor;
			await expect(composer).toHaveAttribute('data-service-mode', 'ferry');
			await expect(composer.locator('#ferry-origin-terminal')).not.toHaveValue('');
			await expect(composer).toContainText('From Hulhumalé');
			await composer.getByRole('button', { name: 'Choose on map', exact: true }).click();
			await expect(atlas).toHaveAttribute('data-island-picking', 'true');
			for (let attempt = 0; attempt < 5; attempt += 1) {
				if (await visibleIslandPoint(destinationLocations)) break;
				const previousZoom = Number(await atlas.getAttribute('data-zoom'));
				await page.getByRole('button', { name: 'Zoom out', exact: true }).click();
				await expect
					.poll(async () => Number(await atlas.getAttribute('data-zoom')))
					.toBeLessThan(previousZoom - 0.8);
			}
			const destination = await visibleIslandPoint(destinationLocations);
			assert.ok(destination, 'A source-backed destination location can be picked on the map.');
			await page.mouse.click(destination.x, destination.y);
			await expect(atlas).toHaveAttribute('data-island-picking', 'false');
			await expect(composer.locator('.service-destination')).toContainText('Malé');
			await expect(
				composer.getByRole('button', { name: 'Accept ferry service', exact: true })
			).toBeEnabled();
			await expect(composer).toContainText('trips each way');
			await expect(composer).toContainText('No new port is built');
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-policy-service-features')))
				.toBeGreaterThan(0);
			await acceptedPoints(2);
			await page.screenshot({ path: path.join(output, 'ferry-two-point-preview.png') });
			await composer
				.getByRole('button', { name: 'Close ferry service planner', exact: true })
				.click();
			await expect(atlas).toHaveAttribute('data-policy-service-features', '0');
			await acceptedPoints(2);
			return {
				origin: evidence.origin.name,
				destination: evidence.destination.name,
				existingLandingPlaces: true,
				previewDoesNotCommit: true
			};
		}
	);
	await check(
		'Mobile stop-only placement shows its budget at the pin with fully accessible confirmation actions',
		async () => {
			await page.setViewportSize({ width: 390, height: 844 });
			await openProposal();
			await acceptedPoints(2);
			await choosePlacement('Bus stop');
			const site = await roadSite();
			await page.mouse.click(site.point.x, site.point.y);
			await expect(serviceEditor).toHaveAttribute('data-service-mode', 'bus-connection');
			const busEditor = await fullyOnScreen(serviceEditor);
			await serviceEditor.getByRole('button', { name: 'Add only a stop', exact: true }).click();
			await readyPlacement();
			const card = await fullyOnScreen(confirmation);
			await accessibleAction(
				confirmation.getByRole('button', { name: 'Add to proposal', exact: true })
			);
			await accessibleAction(confirmation.getByRole('button', { name: 'Cancel', exact: true }));
			await expect(confirmation).toContainText('Budget after adding');
			await expect(confirmation).toContainText('Yearly budget remaining');
			await expect(budget).toBeHidden();
			await noOverflow();
			await page.screenshot({ path: path.join(output, 'mobile-placement.png') });
			await page.keyboard.press('Escape');
			await expect(confirmation).toHaveCount(0);
			await acceptedPoints(2);
			await expect(budget).toBeVisible();
			await noOverflow();
			return {
				viewport: { width: 390, height: 844 },
				busEditor,
				card,
				stopOnlyFallback: true,
				fullConfirmationActionsAccessible: true,
				budgetInPlacementCard: true,
				floatingBudgetRestoredAfterCancel: true,
				canceledWithoutChanges: true
			};
		}
	);
	await check(
		'The journey completes without browser runtime errors or horizontal overflow',
		async () => {
			await noOverflow();
			assert.deepEqual(report.pageErrors, []);
			return { pageErrors: 0, horizontalOverflow: false };
		}
	);
} catch (error) {
	report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
	process.exitCode = 1;
	await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
	await browser.close();
	console.log(JSON.stringify(report, null, 2));
}
