import { projectMapPoint } from './browser-map.mjs';
import { browserBaseURL } from './browser-config.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const baseURL = browserBaseURL();
const output = path.resolve('artifacts/qa/map-transport-planning');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 90000 });
/** @typedef {import('../src/lib/types.js').Coordinates} Coordinates */
/** @typedef {import('../src/lib/bus-planning.js').BusConnectionDraft} BusDraft */
/** @typedef {import('../src/lib/ferry-planning.js').FerryDraft} FerryDraft */
/** @typedef {import('../src/lib/ferry-planning.js').FerryConnectivity} Connectivity */
/** @typedef {import('../src/lib/planning-map.js').PlanningOperation} Operation */
/** @typedef {{x:number,y:number}} Point */
/** @type {{baseURL:string,startedAt:string,finishedAt?:string,checks:Array<{name:string,status:string,detail?:unknown}>,pageErrors:string[],failure?:string}} */
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], pageErrors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1000 },
	reducedMotion: 'reduce'
});
const page = await context.newPage();
page.setDefaultTimeout(90000);
page.on('pageerror', (error) => report.pageErrors.push(error.message));
/** @type {Array<{request:{target_stop_id?:string},result:BusDraft}>} */
const buses = [];
/** @type {Array<{result:FerryDraft}>} */
const ferries = [];
/** @type {Connectivity[]} */
const connections = [];
/** @type {Array<{operations:Operation[]}>} */
const evaluations = [];
page.on('request', (request) => {
	if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/planning/evaluate'))
		evaluations.push(request.postDataJSON());
});
page.on('response', async (response) => {
	const endpoint = new URL(response.url()).pathname;
	if (!response.ok()) return;
	try {
		if (endpoint.endsWith('/planning/connectivity')) connections.push(await response.json());
		if (response.request().method() !== 'POST') return;
		if (endpoint.endsWith('/planning/bus-connection'))
			buses.push({ request: response.request().postDataJSON(), result: await response.json() });
		if (endpoint.endsWith('/planning/ferry-service'))
			ferries.push({ result: await response.json() });
	} catch {
		/* An obsolete preview may be cancelled while its body is being received. */
	}
});
const atlas = page.locator('.national-map');
const panel = page.getByRole('region', { name: 'Island needs and proposal', exact: true });
const editor = page.getByTestId('map-service-editor');
const budget = page.getByRole('region', { name: 'Proposal budget', exact: true });
/** @type {import('../src/lib/map-policy.js').MapBaseline} */
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
			y < innerHeight - 90 &&
			(document.elementFromPoint(x, y)?.matches('.maplibregl-canvas') ?? false),
		point
	);
}
/** @returns {Promise<{operations:Operation[],assumptions:import('../src/lib/proposal-review.js').PlanningReviewRequest['assumptions']}>} */
async function draft() {
	return page.evaluate(() => JSON.parse(localStorage.getItem('policy-map-v2:island:1442') ?? '{}'));
}
async function showProposal() {
	if (!(await panel.isVisible())) {
		const reopen = page.getByRole('button', { name: /^Edit proposal/ });
		if (await reopen.isVisible()) await reopen.click();
		else await page.getByRole('button', { name: /^Create (?:a )?proposal$/ }).click();
	}
	if ((await panel.getAttribute('data-policy-section')) !== 'proposal')
		await panel.getByRole('button', { name: /^Your proposal/ }).click();
}
async function connectionSite() {
	const current = await draft();
	const seen = new Set();
	let inspected = 0;
	for (const road of baseline.graph_edges)
		for (const coordinates of road.geometry ?? []) {
			const identity = coordinates.join(',');
			if (seen.has(identity)) continue;
			seen.add(identity);
			const location = /** @type {Coordinates} */ (coordinates);
			const point = await project(location);
			if (!(await mapIsClear(point))) continue;
			const response = await page.request.post(`${baseURL}/api/backend/planning/bus-connection`, {
				data: {
					island_id: 'island:1442',
					coordinates: location,
					assumptions: current.assumptions,
					operations: current.operations
				}
			});
			assert.equal(response.status(), 200, await response.text());
			const value = /** @type {BusDraft} */ (await response.json());
			if (value.status === 'ready' && value.candidates.length > 1)
				return { coordinates: location, point };
			if (++inspected >= 40)
				throw new Error('No visible road connection with alternative mapped stops was found.');
		}
	throw new Error('No visible, source-backed bus connection was found.');
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
async function placeStop() {
	await showProposal();
	const site = await connectionSite();
	const tile = panel.getByRole('button', { name: 'Bus stop', exact: true });
	await tile.scrollIntoViewIfNeeded();
	const box = await tile.locator('[data-placement-icon]').boundingBox();
	assert.ok(box);
	await drag({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, site.point);
	await expect(editor).toHaveAttribute('data-service-mode', 'bus-connection');
	await expect(
		editor.getByRole('button', { name: 'Accept stop & route', exact: true })
	).toBeEnabled();
	return site;
}
async function undoAll() {
	await budget.getByRole('button', { name: 'Undo proposal change', exact: true }).click();
	await expect.poll(async () => (await draft()).operations?.length ?? 0).toBe(0);
	await expect(atlas).toHaveAttribute('data-policy-proposal-points', '0');
}
async function completedImpact() {
	await expect(atlas).toHaveAttribute('data-policy-calculating', 'false');
	await expect
		.poll(async () => Number(await atlas.getAttribute('data-policy-impact-cells')))
		.toBeGreaterThan(0);
}
async function fitEditor() {
	await expect(editor).toBeVisible();
	await expect
		.poll(async () => {
			const box = await editor.boundingBox(),
				viewport = page.viewportSize();
			return !!(
				box &&
				viewport &&
				box.x >= 0 &&
				box.y >= 0 &&
				box.x + box.width <= viewport.width + 1 &&
				box.y + box.height <= viewport.height + 1
			);
		})
		.toBe(true);
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
		.toBe(true);
	const overlaps = await page.evaluate(() => {
		const card = document
			.querySelector('[data-testid="map-service-editor"]')
			?.getBoundingClientRect();
		return [...document.querySelectorAll('.proposal-floating-budget, .policy-lens-bar')].some(
			(element) => {
				const bounds = element.getBoundingClientRect();
				return !!(
					card &&
					bounds.width &&
					bounds.height &&
					card.left < bounds.right &&
					card.right > bounds.left &&
					card.top < bounds.bottom &&
					card.bottom > bounds.top
				);
			}
		);
	});
	assert.equal(
		overlaps,
		false,
		'The editor must not overlap the floating budget or service-gap controls.'
	);
	const accept = editor.getByRole('button', { name: /^Accept/ }).first();
	await expect(accept).toBeVisible();
	await expect(accept).toBeEnabled();
	assert.equal(
		await accept.evaluate((element) => {
			const bounds = element.getBoundingClientRect();
			const hit = document.elementFromPoint(
				bounds.x + bounds.width / 2,
				bounds.y + bounds.height / 2
			);
			return !!hit && element.contains(hit);
		}),
		true,
		'The map confirmation must remain reachable without another control covering it.'
	);
}

try {
	const response = await page.request.get(
		`${baseURL}/api/backend/planning/baseline?island_id=island%3A1442`
	);
	assert.equal(response.status(), 200, await response.text());
	baseline = await response.json();
	await page.goto(`${baseURL}/?view=map&tool=explore&island=island%3A1442`, {
		waitUntil: 'domcontentloaded'
	});
	await expect(atlas).toHaveAttribute('aria-busy', 'false');
	await showProposal();
	await panel.getByRole('button', { name: 'Edit budget limits', exact: true }).click();
	await panel.locator('#map-capital-budget').fill('1000000000');
	await panel.locator('#map-annual-budget').fill('1000000000');
	await check('Dropping a bus stop draws a real road route in an anchored map editor', async () => {
		await placeStop();
		assert.equal(buses.at(-1)?.result.status, 'ready');
		const value = buses.at(-1)?.result;
		assert.ok(value && value.operations.length === 3);
		assert.deepEqual(
			value.operations.map((op) => op.type),
			['add_stop', 'add_service', 'add_service']
		);
		assert.ok(
			value.map_features.features.filter((f) => f.geometry.type === 'LineString').length === 2
		);
		assert.ok((value.quote?.economics.delta.annual_operating_mvr ?? 0) > 0);
		await fitEditor();
		await page.screenshot({ path: path.join(output, 'bus-connection-desktop.png') });
		await editor
			.getByRole('button', { name: 'See the full route on the map', exact: true })
			.click();
		await expect(editor).toContainText('ROUTE PREVIEW');
		await fitEditor();
		await page.screenshot({ path: path.join(output, 'bus-connection-route-preview.png') });
		assert.ok(value.summary);
		const originPoint = await project(value.summary.target_stop.coordinates);
		await page.screenshot({
			path: path.join(output, 'bus-connection-road-detail.png'),
			clip: {
				x: Math.max(0, originPoint.x - 160),
				y: Math.max(0, originPoint.y - 180),
				width: 320,
				height: 320
			}
		});
		await editor.getByRole('button', { name: 'Edit settings', exact: true }).click();
		await expect(editor.locator('#connection-stop')).toBeVisible();
		return value.summary;
	});
	await check(
		'Changing a connection stop changes the route and can also be selected on the map',
		async () => {
			const original = buses.at(-1)?.result;
			assert.ok(original);
			const alternative = original.candidates.find(
				(item) => item.stop.id !== original.selected_stop_id
			);
			assert.ok(alternative);
			await editor.locator('#connection-stop').selectOption(alternative.stop.id);
			await expect.poll(() => buses.at(-1)?.result.selected_stop_id).toBe(alternative.stop.id);
			assert.notDeepEqual(buses.at(-1)?.result.map_features, original.map_features);
			let clicked = false;
			for (const compact of [false, true]) {
				if (compact) {
					await editor
						.getByRole('button', { name: 'See the full route on the map', exact: true })
						.click();
					await expect(editor).toContainText('ROUTE PREVIEW');
				}
				for (const candidate of buses.at(-1)?.result.candidates ?? []) {
					if (candidate.stop.id === alternative.stop.id) continue;
					const point = await project(candidate.stop.coordinates);
					if (!(await mapIsClear(point))) continue;
					await page.mouse.click(point.x, point.y);
					await expect.poll(() => buses.at(-1)?.result.selected_stop_id).toBe(candidate.stop.id);
					clicked = true;
					break;
				}
				if (clicked) break;
			}
			assert.equal(
				clicked,
				true,
				'An alternate mapped stop must be selectable directly on the map.'
			);
			if (await editor.getByRole('button', { name: 'Edit settings', exact: true }).isVisible())
				await editor.getByRole('button', { name: 'Edit settings', exact: true }).click();
			await expect(
				editor.getByRole('button', { name: 'Accept stop & route', exact: true })
			).toBeEnabled();
			return { dropdown: true, mapCandidateClicked: clicked };
		}
	);
	await check(
		'Accepting adds the stop and both scheduled directions to real analysis',
		async () => {
			const count = evaluations.length;
			await editor.getByRole('button', { name: 'Accept stop & route', exact: true }).click();
			await expect(editor).toBeHidden();
			await expect.poll(async () => (await draft()).operations?.length).toBe(3);
			await completedImpact();
			assert.ok(
				evaluations
					.slice(count - 2)
					.some((item) => item.operations.filter((op) => op.type === 'add_service').length === 2)
			);
			await expect(budget).toContainText('MVR');
			return (await draft()).operations.map((op) => op.type);
		}
	);
	await check('Accepted service paths remain inspectable from the map', async () => {
		const value = buses.at(-1)?.result;
		assert.ok(value);
		let clicked = false;
		for (const feature of value.map_features.features) {
			if (feature.geometry.type !== 'LineString') continue;
			const coordinates = feature.geometry.coordinates;
			const points = coordinates
				.slice(1)
				.map((point, index) => [
					(point[0] + coordinates[index][0]) / 2,
					(point[1] + coordinates[index][1]) / 2
				]);
			for (const coordinates of points) {
				const point = await project(/** @type {Coordinates} */ (coordinates));
				if (!(await mapIsClear(point))) continue;
				await page.mouse.click(point.x, point.y);
				const popup = page.getByRole('region', { name: 'Proposed transport service', exact: true });
				if (await popup.isVisible()) {
					await expect(popup).toContainText('Proposed bus service');
					await popup.getByRole('button', { name: 'View proposal' }).click();
					clicked = true;
					break;
				}
			}
			if (clicked) break;
		}
		assert.equal(
			clicked,
			true,
			'The actual rendered road line must be clickable and open its details.'
		);
	});
	await check('Undo removes the whole routed package in one step', async () => {
		await undoAll();
	});
	await check('Stop-only remains explicit and does not invent a scheduled service', async () => {
		await placeStop();
		await editor.getByRole('button', { name: 'Add only a stop', exact: true }).click();
		const confirmation = page.getByTestId('map-placement-confirmation');
		await expect(confirmation).toHaveAttribute('data-placement-allowed', 'true');
		await confirmation.getByRole('button', { name: 'Add to proposal', exact: true }).click();
		await expect
			.poll(async () => (await draft()).operations?.map((op) => op.type))
			.toEqual(['add_stop']);
		await completedImpact();
		await undoAll();
	});
	await check(
		'Existing bus frequency planning opens over the route and uses a recorded service date',
		async () => {
			await showProposal();
			await panel.getByRole('button', { name: /^Bus service/ }).click();
			await expect(editor).toHaveAttribute('data-service-mode', 'bus');
			await expect(panel).toBeHidden();
			const useDate = editor.getByRole('button', { name: 'Use recorded service date' });
			if (await useDate.isVisible()) await useDate.click();
			await editor.locator('#proposal-bus-frequency').fill('12');
			await expect(
				editor.getByRole('button', { name: 'Accept service', exact: true })
			).toBeEnabled();
			await fitEditor();
			await page.screenshot({ path: path.join(output, 'existing-bus-desktop.png') });
			await editor.getByRole('button', { name: 'Accept service', exact: true }).click();
			await expect(editor).toBeHidden();
			await expect
				.poll(async () => (await draft()).operations?.map((op) => op.type))
				.toEqual(['set_frequency']);
			await completedImpact();
			await undoAll();
		}
	);
	await check(
		'Ferry planning focuses a verified landing and draws a costed return service',
		async () => {
			await showProposal();
			await panel.getByRole('button', { name: /^Ferry service/ }).click();
			await expect(editor).toHaveAttribute('data-service-mode', 'ferry');
			await expect(panel).toBeHidden();
			await expect(editor.locator('#ferry-origin-terminal')).toBeVisible();
			const departure = await editor.locator('#ferry-origin-terminal').inputValue();
			assert.ok(departure);
			const origin = connections.at(-1)?.terminals.origin;
			assert.ok(origin);
			assert.ok(origin.some((terminal) => terminal.id === departure));
			const alternative = origin.find((terminal) => terminal.id !== departure);
			if (alternative) {
				await editor.locator('#ferry-origin-terminal').selectOption(alternative.id);
				await expect(editor).toHaveAttribute(
					'data-anchor-longitude',
					String(alternative.coordinates[0])
				);
				await expect(editor).toHaveAttribute(
					'data-anchor-latitude',
					String(alternative.coordinates[1])
				);
			}
			let landingClicked = false;
			const mappedLanding = origin.find((terminal) => terminal.id === departure);
			assert.ok(mappedLanding);
			const landingPoint = await project(mappedLanding.coordinates);
			if (alternative && (await mapIsClear(landingPoint))) {
				await page.mouse.click(landingPoint.x, landingPoint.y);
				await expect(editor.locator('#ferry-origin-terminal')).toHaveValue(departure);
				landingClicked = true;
			}
			await editor.locator('#ferry-island-search').fill('Malé');
			const destination = editor
				.locator('.service-destinations')
				.getByRole('button')
				.filter({ hasText: /^Malé/ })
				.first();
			await destination.click();
			await expect(editor.locator('#ferry-destination-terminal')).toBeVisible();
			await expect(
				editor.getByRole('button', { name: 'Accept ferry service', exact: true })
			).toBeEnabled();
			const arrival = await editor.locator('#ferry-destination-terminal').inputValue();
			const arrivals = connections.at(-1)?.terminals.destination;
			assert.ok(arrivals?.some((terminal) => terminal.id === arrival));
			const otherArrival = arrivals?.find((terminal) => terminal.id !== arrival);
			let destinationLandingClicked = false;
			if (otherArrival) {
				await editor.locator('#ferry-destination-terminal').selectOption(otherArrival.id);
				await expect
					.poll(() => ferries.at(-1)?.result.summary?.destination_terminal.id)
					.toBe(otherArrival.id);
				const selectedArrival = arrivals?.find((terminal) => terminal.id === arrival);
				assert.ok(selectedArrival);
				const point = await project(selectedArrival.coordinates);
				if (await mapIsClear(point)) {
					await page.mouse.click(point.x, point.y);
					await expect(editor.locator('#ferry-destination-terminal')).toHaveValue(arrival);
					destinationLandingClicked = true;
				}
			}
			await expect(
				editor.getByRole('button', { name: 'Accept ferry service', exact: true })
			).toBeEnabled();
			await fitEditor();
			const value = ferries.at(-1)?.result;
			assert.ok(value && value.status === 'ready');
			assert.ok(value.summary);
			assert.equal(value.summary?.terminal_construction_mvr, 0);
			assert.equal(value.summary?.geometry_source, 'coastline_avoiding_planning_corridor');
			assert.ok(value.summary.distance_km > 0);
			const previewLine = value.map_features.features.find(
				(feature) => feature.geometry.type === 'LineString'
			);
			assert.ok(previewLine?.geometry.type === 'LineString');
			const geometry = previewLine.geometry.coordinates;
			assert.ok(geometry.length > 2, 'The ferry preview must turn around mapped land.');
			const plannedServices = value.operations.filter(
				(operation) => operation.type === 'add_service'
			);
			assert.equal(plannedServices.length, 2);
			for (const operation of plannedServices) {
				assert.ok(Number(operation.service?.distanceM) > 0);
				assert.deepEqual(operation.service?.segmentGeometry, [
					String(operation.service?.id).endsWith(':return') ? [...geometry].reverse() : geometry
				]);
			}
			assert.ok(value.operations.length >= 2);
			assert.ok((value.quote?.economics.delta.annual_operating_mvr ?? 0) > 0);
			const evidence = editor
				.locator('details')
				.filter({ hasText: 'Route evidence and assumptions' });
			await evidence.locator('summary').click();
			await expect(evidence).toContainText(value.summary.qualification);
			await expect(evidence).toContainText(`${value.summary.distance_km.toFixed(2)} km each way.`);
			await evidence.locator('summary').click();
			await page.screenshot({ path: path.join(output, 'ferry-service-desktop.png') });
			await editor
				.getByRole('button', { name: 'See the full route on the map', exact: true })
				.click();
			await expect(editor).toContainText('ROUTE PREVIEW');
			await fitEditor();
			await page.screenshot({ path: path.join(output, 'ferry-service-route-preview.png') });
			await editor.getByRole('button', { name: 'Accept ferry service', exact: true }).click();
			await expect(editor).toBeHidden();
			await expect
				.poll(async () => (await draft()).operations?.length)
				.toBe(value.operations.length);
			const acceptedServices = (await draft()).operations.filter(
				(operation) => operation.type === 'add_service'
			);
			assert.deepEqual(
				acceptedServices.map((operation) => operation.service?.segmentGeometry),
				plannedServices.map((operation) => operation.service?.segmentGeometry)
			);
			await completedImpact();
			assert.deepEqual(
				evaluations
					.at(-1)
					?.operations.filter((operation) => operation.type === 'add_service')
					.map((operation) => operation.service?.segmentGeometry),
				plannedServices.map((operation) => operation.service?.segmentGeometry)
			);
			await undoAll();
			return {
				...value.summary,
				sourceBackedOrigin: true,
				previewVertices: geometry.length,
				acceptedGeometryPreserved: true,
				originMapClick: landingClicked,
				destinationMapClick: destinationLandingClicked
			};
		}
	);
	await check('Escape cancels without committing and the editor fits mobile', async () => {
		await page.setViewportSize({ width: 390, height: 844 });
		await showProposal();
		const tile = panel.getByRole('button', { name: /^Bus service/ });
		await tile.scrollIntoViewIfNeeded();
		await tile.click();
		await expect(editor).toHaveAttribute('data-service-mode', 'bus');
		await fitEditor();
		await page.screenshot({ path: path.join(output, 'existing-bus-mobile.png') });
		await page.keyboard.press('Escape');
		await expect(editor).toBeHidden();
		assert.equal((await draft()).operations.length, 0);
	});
	await check('Mobile ferry editing preserves a reachable map confirmation', async () => {
		await showProposal();
		const tile = panel.getByRole('button', { name: /^Ferry service/ });
		await tile.scrollIntoViewIfNeeded();
		await tile.click();
		await expect(editor).toHaveAttribute('data-service-mode', 'ferry');
		await expect(editor.locator('#ferry-origin-terminal')).toBeVisible();
		if (await editor.locator('#ferry-island-search').isVisible()) {
			await editor.locator('#ferry-island-search').fill('Malé');
			await editor
				.locator('.service-destinations')
				.getByRole('button')
				.filter({ hasText: /^Malé/ })
				.first()
				.click();
		}
		await expect(
			editor.getByRole('button', { name: 'Accept ferry service', exact: true })
		).toBeEnabled();
		await fitEditor();
		await page.screenshot({ path: path.join(output, 'ferry-service-mobile.png') });
		await page.keyboard.press('Escape');
		await expect(editor).toBeHidden();
		assert.equal((await draft()).operations.length, 0);
	});
	assert.deepEqual(report.pageErrors, []);
	report.finishedAt = new Date().toISOString();
	console.log(`PASS ${report.checks.length} map transport planning checks`);
} catch (error) {
	report.failure = error instanceof Error ? error.stack : String(error);
	await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
	throw error;
} finally {
	await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
	await context.close();
	await browser.close();
}
