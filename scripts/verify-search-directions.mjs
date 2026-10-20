import { browserBaseURL } from './browser-config.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Use the real mapped inventory and dated operator stops, never invented route responses.
// Run against an already-started frontend and backend.
/** @typedef {import('@playwright/test').Page} Page */
/** @typedef {import('@playwright/test').Locator} Locator */
/** @typedef {import('../src/lib/search-directions.js').SearchDirectionsResult} DirectionsResult */
/** @typedef {import('../src/lib/search-directions.js').SearchTravelMode} TravelMode */
/** @typedef {[number, number]} Coordinates */
/** @typedef {{id:string,name:string,coordinates:Coordinates,islandId:string}} Place */
/** @typedef {{id?:string,geometry:{type:string,coordinates?:unknown}|null,properties:{id?:string,name?:string,island_id?:string,category?:string,geometry_quality?:string,match_status?:string}}} MappedFeature */
/** @typedef {{stops:Array<{id:string,name:string,coordinates:Coordinates,national_island_id:string|null}>,service_date:string|null}} StopCatalogue */

const baseURL = browserBaseURL();
const output = path.resolve('artifacts/qa/search-directions');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 60000 });
/** @type {{baseURL:string,startedAt:string,finishedAt?:string,checks:Array<{name:string,status:string,detail?:unknown}>,pageErrors:string[],failure?:string}} */
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], pageErrors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const islandId = 'island:1442';
const serviceDate = '2026-10-10';
const departureTime = '15:20';
/** @type {Map<string, {id:string,name:string}>} */
let islandCatalogue = new Map();
/** @type {Place[]} */
let mappedPlaces = [];
/** @type {Place[]} */
let operatorPlaces = [];

/** @param {Page} page */
function ui(page) {
	const root = page.getByTestId('search-directions');
	return {
		root,
		atlas: page.locator('.national-map'),
		rows: root.locator('[data-directions-point]'),
		inputs: root.getByTestId('directions-endpoint-input'),
		find: root.getByTestId('find-directions'),
		results: root.getByTestId('directions-results')
	};
}

/** @param {Page} page @param {string} endpoint @template T @returns {Promise<T>} */
async function readAPI(page, endpoint) {
	const response = await page.request.get(`${baseURL}/api/backend/${endpoint}`);
	assert.equal(response.status(), 200, `Inventory API ${endpoint}`);
	return response.json();
}

/** @param {Page} page */
async function diagnostics(page) {
	return page.evaluate(() => ({
		url: location.href,
		viewport: {
			width: innerWidth,
			height: innerHeight,
			scrollWidth: document.documentElement.scrollWidth
		},
		map: Object.fromEntries(
			[...(document.querySelector('.national-map')?.attributes ?? [])]
				.filter((attribute) => attribute.name.startsWith('data-'))
				.map((attribute) => [attribute.name, attribute.value])
		),
		points: [...document.querySelectorAll('[data-testid="directions-endpoint-input"]')].map(
			(input) => ({
				label: input.getAttribute('aria-label'),
				value: /** @type {HTMLInputElement} */ (input).value
			})
		),
		pins: [...document.querySelectorAll('.journey-drag-pin')].map((pin) => ({
			label: pin.getAttribute('aria-label'),
			className: pin.className,
			style: pin.getAttribute('style')
		})),
		panels: [
			...document.querySelectorAll(
				'.map-search-dock, .map-information-card, .mobile-key-toggle button'
			)
		].map((element) => {
			const box = element.getBoundingClientRect();
			return {
				className: element.className,
				bounds: { x: box.x, y: box.y, width: box.width, height: box.height },
				topAtCenter: document
					.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
					?.outerHTML.slice(0, 300)
			};
		}),
		alerts: [...document.querySelectorAll('[role="alert"]')].map((alert) => alert.textContent),
		results: document.querySelector('[data-testid="directions-results"]')?.textContent
	}));
}

/** @param {string} name @param {{width:number,height:number}} viewport @param {(page:Page)=>Promise<unknown>} action */
async function scenario(name, viewport, action) {
	console.log(`RUN ${name}`);
	const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
	const page = await context.newPage();
	page.setDefaultTimeout(60000);
	page.on('pageerror', (error) => report.pageErrors.push(error.message));
	try {
		const detail = await action(page);
		report.checks.push({ name, status: 'passed', detail });
		console.log(`PASS ${name}`);
	} catch (error) {
		const screenshot = path.join(output, `${name}-failure.png`);
		await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {});
		report.checks.push({
			name,
			status: 'failed',
			detail: {
				message: error instanceof Error ? (error.stack ?? error.message) : String(error),
				screenshot,
				state: await diagnostics(page).catch(() => null)
			}
		});
		throw error;
	} finally {
		await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
		await context.close();
	}
}

/** @param {Page} page */
async function openIsland(page) {
	await page.goto(`${baseURL}/?view=map&tool=explore&island=${encodeURIComponent(islandId)}`, {
		waitUntil: 'domcontentloaded'
	});
	await expect(ui(page).atlas).toHaveAttribute('aria-busy', 'false');
	await expect(ui(page).atlas).toHaveAttribute('data-active', 'true');
	await expect(page.getByTestId('map-search').getByTestId('map-search-scope')).toHaveAttribute(
		'data-island-id',
		islandId
	);
}

/** @param {Page} page @param {Place} place */
async function openFromMainSearch(page, place) {
	const main = page.getByTestId('map-search');
	const input = main.getByTestId('map-search-input');
	await input.fill(place.name);
	await main
		.locator(
			`[role="option"][data-search-kind="place"][data-search-id=${JSON.stringify(place.id)}]`
		)
		.click();
	await expect(ui(page).atlas).toHaveAttribute('data-search-place', place.id);
	await page.getByRole('button', { name: 'Directions', exact: true }).click();
	await expect(ui(page).root).toBeVisible();
	await expect(ui(page).rows).toHaveCount(2);
	await expect(ui(page).inputs.nth(0)).toHaveValue('');
	await expect(ui(page).inputs.nth(1)).toHaveValue(place.name);
	await expect(main).toHaveCount(0);
	await expect(page.locator('aside.detail-panel')).toHaveCount(0);
	await expect(ui(page).atlas).toHaveAttribute('data-directions-active', 'true');
	await expect(ui(page).atlas).toHaveAttribute('data-search-place', '');
	await expect(ui(page).atlas.locator('[data-search-marker]')).toHaveCount(0);
	await expect(ui(page).atlas.locator('[data-direction-label="B"]')).toHaveCount(1);
	await expect(ui(page).find).toBeDisabled();
}

/** @param {Page} page @param {number} index @param {Place} place @param {boolean} [proveScopeOnly] */
async function chooseEndpoint(page, index, place, proveScopeOnly = false) {
	const row = ui(page).rows.nth(index);
	const input = row.getByTestId('directions-endpoint-input');
	const scope = row.getByTestId('map-search-scope');
	await input.click();
	await input.fill('');
	if ((await scope.count()) && (await scope.getAttribute('data-island-id')) !== place.islandId) {
		await input.press('Backspace');
		await expect(scope).toHaveCount(0);
	}
	if (!(await scope.count())) {
		const island = islandCatalogue.get(place.islandId);
		assert.ok(island, 'The selected endpoint belongs to a catalogue island');
		const before = page.url();
		await input.fill(island.name);
		await row
			.locator(
				`[role="option"][data-search-kind="island"][data-island-id=${JSON.stringify(place.islandId)}]`
			)
			.click();
		await expect(scope).toHaveAttribute('data-island-id', place.islandId);
		assert.equal(
			page.url(),
			before,
			'Endpoint island selection changes search scope, preserving map navigation'
		);
		if (proveScopeOnly) {
			await expect(page).toHaveURL((url) => url.searchParams.get('island') === islandId);
			await expect(input).toHaveValue('');
			await expect(ui(page).atlas).toHaveAttribute('data-journey-route-segments', '0');
		}
	}
	await input.fill(place.name);
	const result = row.locator(
		`[role="option"][data-search-kind="place"][data-search-id=${JSON.stringify(place.id)}]`
	);
	await expect(result).toBeVisible();
	await result.click();
	await expect(input).toHaveValue(place.name);
	await expect(input).toHaveAttribute('aria-expanded', 'false');
}

/** @param {Locator} locator @param {string} name @param {Page} page */
async function inViewport(locator, name, page) {
	await expect(locator).toBeVisible();
	const box = await locator.boundingBox();
	const viewport = page.viewportSize();
	assert.ok(box && viewport, `${name} has rendered bounds`);
	assert.ok(
		box.x >= -1 &&
			box.y >= -1 &&
			box.x + box.width <= viewport.width + 1 &&
			box.y + box.height <= viewport.height + 1,
		`${name} fits the viewport: ${JSON.stringify(box)}`
	);
	return box;
}

/** @param {Locator} locator */
async function hitTarget(locator) {
	return locator.evaluate((element) => {
		const box = element.getBoundingClientRect();
		return element.contains(
			document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
		);
	});
}

/** @param {Page} page */
async function directionsLayout(page) {
	const current = ui(page);
	const editor = await inViewport(current.root, 'Directions editor', page);
	const inputs = [];
	for (const input of await current.inputs.all()) {
		inputs.push(await inViewport(input, 'Endpoint input', page));
		assert.equal(await hitTarget(input), true, 'The endpoint input can be reached');
	}
	await inViewport(current.find, 'Find directions', page);
	const close = current.root.getByRole('button', { name: 'Close directions', exact: true });
	assert.equal(await hitTarget(close), true, 'Close directions remains clickable');
	const navigation = page.getByRole('navigation', { name: 'Workspace', exact: true });
	if (await navigation.isVisible()) {
		const nav = await inViewport(navigation, 'Workspace navigation', page);
		assert.ok(
			Math.min(editor.x + editor.width, nav.x + nav.width) <= Math.max(editor.x, nav.x) + 1 ||
				Math.min(editor.y + editor.height, nav.y + nav.height) <= Math.max(editor.y, nav.y) + 1,
			'The directions editor does not cover workspace navigation'
		);
	}
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
		.toBe(true);
	return { editor, inputs };
}

/** @param {Page} page */
async function mobilePinVisibility(page) {
	return ui(page)
		.atlas.locator('.journey-waypoint-pin')
		.evaluateAll((pins) =>
			pins.map((pin) => {
				const box = pin.getBoundingClientRect();
				const x = box.x + box.width / 2;
				const y = box.y + box.height / 2;
				const stack = document.elementsFromPoint(x, y);
				const pinIndex = stack.indexOf(pin);
				const blockers = stack
					.slice(0, pinIndex < 0 ? stack.length : pinIndex)
					.filter((element) => element.closest('.map-search-dock, .map-information-card'));
				return {
					label: pin.getAttribute('data-direction-label'),
					x,
					y,
					insideViewport:
						box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight,
					reachable: pinIndex >= 0 && blockers.length === 0,
					topElement: stack[0]?.outerHTML.slice(0, 300),
					blockers: blockers.map((element) => element.className)
				};
			})
		);
}

/** @param {Page} page */
async function mobilePinsAndKey(page) {
	const current = ui(page);
	const toggle = current.atlas.getByRole('button', {
		name: 'Map key & live coverage',
		exact: true
	});
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');
	await inViewport(toggle, 'Collapsed map key', page);
	assert.equal(await hitTarget(toggle), true, 'The compact map key can be opened');
	await expect
		.poll(async () =>
			(await mobilePinVisibility(page)).every((pin) => pin.insideViewport && pin.reachable)
		)
		.toBe(true);
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-expanded', 'true');
	await expect(current.atlas.locator('.map-key-details')).toBeVisible();
	await inViewport(toggle, 'Expanded map-key toggle', page);
	const expandedKey = await current.atlas.locator('.map-key-details').evaluate((element) => {
		const box = element.getBoundingClientRect();
		const card = element.closest('.map-information-card')?.getBoundingClientRect();
		const x = box.left + box.width * 0.25;
		const y = Math.min(box.bottom, card?.bottom ?? innerHeight, innerHeight) - 6;
		const top = document.elementFromPoint(x, y);
		return {
			x,
			y,
			receivesPointer: element === top || (top !== null && element.contains(top)),
			topElement: top?.outerHTML.slice(0, 300)
		};
	});
	assert.equal(
		expandedKey.receivesPointer,
		true,
		`The lower visible map-key details receive pointer events above the toolbar: ${JSON.stringify(expandedKey)}`
	);
	await page.screenshot({
		path: path.join(output, `mobile-${page.viewportSize()?.width}-key-expanded.png`)
	});
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');
	await expect(current.atlas.locator('.map-key-details')).toBeHidden();
	await expect
		.poll(async () =>
			(await mobilePinVisibility(page)).every((pin) => pin.insideViewport && pin.reachable)
		)
		.toBe(true);
	return { pins: await mobilePinVisibility(page), expandedKey };
}

/** @param {DirectionsResult} result */
function lineCount(result) {
	return result.segments.reduce((count, segment) => {
		if (segment.status !== 'ok' || !segment.result) return count;
		if (segment.result.journey)
			return count + segment.result.journey.legs.filter((leg) => leg.geometry.length > 1).length;
		return count + Number((segment.result.geometry?.length ?? 0) > 1);
	}, 0);
}

/** @param {Page} page @param {TravelMode} mode @param {Place[]} places */
async function findRoute(page, mode, places) {
	const current = ui(page);
	await current.root.locator(`[data-directions-mode="${mode}"]`).click();
	await expect(current.root.locator(`[data-directions-mode="${mode}"]`)).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	if (mode === 'transit') {
		await current.root.locator('input[type="date"]').fill(serviceDate);
		await current.root.locator('input[type="time"]').fill(departureTime);
	}
	await expect(current.find).toBeEnabled();
	const responsePromise = page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === '/api/backend/routing/journey' &&
			response.request().method() === 'POST'
	);
	await current.find.click();
	const response = await responsePromise;
	assert.equal(response.status(), 200, 'The actual journey endpoint responds successfully');
	/** @type {{points:Coordinates[],mode:TravelMode,departure_minutes:number}} */
	const request = response.request().postDataJSON();
	assert.deepEqual(
		request.points,
		places.map((place) => place.coordinates),
		'The UI submits all stops in order'
	);
	assert.equal(request.mode, mode, 'The chosen travel mode reaches the backend');
	assert.ok(
		Number.isFinite(request.departure_minutes) &&
			request.departure_minutes >= 0 &&
			request.departure_minutes < 1440
	);
	/** @type {DirectionsResult} */
	const result = await response.json();
	await expect(current.results).toHaveAttribute('data-route-status', result.status);
	await expect(current.results.locator('[data-directions-segment]')).toHaveCount(places.length - 1);
	await expect(current.atlas).toHaveAttribute('data-directions-status', result.status);
	await expect(current.atlas).toHaveAttribute(
		'data-journey-route-segments',
		String(lineCount(result))
	);
	await expect(current.atlas.locator('.journey-drag-pin')).toHaveCount(places.length);
	return { request, result };
}

try {
	await scenario('desktop-directions', { width: 1440, height: 1000 }, async (page) => {
		/** @type {{features:Array<{properties:{id:string,name:string}}>}} */
		const islands = await readAPI(page, 'map/features?layer=islands');
		islandCatalogue = new Map(
			islands.features.map((feature) => [feature.properties.id, feature.properties])
		);
		/** @type {{features:MappedFeature[]}} */
		const inventory = await readAPI(
			page,
			`map/features?layer=all&island_id=${encodeURIComponent(islandId)}`
		);
		mappedPlaces = inventory.features
			.flatMap((feature) => {
				const properties = feature.properties;
				const coordinates = feature.geometry?.coordinates;
				return properties.island_id === islandId &&
					properties.name?.trim() &&
					feature.geometry?.type === 'Point' &&
					Array.isArray(coordinates) &&
					coordinates.length === 2 &&
					coordinates.every(Number.isFinite) &&
					!/centroid|island_context|unresolved/i.test(
						`${properties.geometry_quality ?? ''} ${properties.match_status ?? ''}`
					) &&
					/hospital|clinic|health|school/i.test(properties.category ?? '')
					? [
							{
								id: String(properties.id ?? feature.id),
								name: properties.name,
								coordinates: /** @type {Coordinates} */ (coordinates),
								islandId
							}
						]
					: [];
			})
			.sort(
				(first, second) =>
					Number(!/hospital/i.test(first.name)) - Number(!/hospital/i.test(second.name)) ||
					first.name.localeCompare(second.name)
			);
		assert.ok(mappedPlaces.length >= 2, 'Hulhumalé has two actual named, located mapped services');
		/** @type {StopCatalogue} */
		const stops = await readAPI(page, 'routing/stops');
		// These exact dated operator points are also exercised by the real backend regression.
		const expected = [
			[73.504676, 4.169366],
			[73.543088, 4.211553],
			[73.540352, 4.21442]
		];
		operatorPlaces = expected.map((coordinates) => {
			const stop = stops.stops.find((candidate) =>
				candidate.coordinates.every((value, axis) => Math.abs(value - coordinates[axis]) < 0.000001)
			);
			assert.ok(
				stop?.national_island_id && stop.name,
				`A real operator stop exists at ${coordinates.join(', ')}`
			);
			return {
				id: stop.id,
				name: stop.name,
				coordinates: stop.coordinates,
				islandId: stop.national_island_id
			};
		});
		const [a, b, c] = operatorPlaces;
		await openIsland(page);
		await openFromMainSearch(page, mappedPlaces[0]);
		const current = ui(page);
		await expect(current.root.locator('[data-directions-mode]')).toHaveCount(4);
		for (const mode of ['walk', 'transit', 'bicycle', 'car'])
			await expect(current.root.locator(`[data-directions-mode="${mode}"]`)).toBeVisible();
		const initialLayout = await directionsLayout(page);
		await current.root
			.getByRole('button', { name: 'Choose starting point on map', exact: true })
			.click();
		await expect(current.atlas.locator('canvas.maplibregl-canvas')).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(
			current.root.getByRole('button', { name: 'Choose starting point on map', exact: true })
		).toHaveAttribute('aria-pressed', 'false');
		await current.root.getByRole('button', { name: 'Reverse route', exact: true }).click();
		await expect(current.inputs.nth(0)).toHaveValue(mappedPlaces[0].name);
		await expect(current.inputs.nth(1)).toHaveValue('');
		await current.root.getByRole('button', { name: 'Reverse route', exact: true }).click();
		await chooseEndpoint(page, 0, a, true);
		await chooseEndpoint(page, 1, b);
		await current.root.getByRole('button', { name: 'Add stop', exact: true }).click();
		await expect(current.rows).toHaveCount(3);
		await expect(current.inputs.nth(2)).toBeFocused();
		await expect(current.find).toBeDisabled();
		await chooseEndpoint(page, 2, c);
		await expect(current.atlas).toHaveAttribute('data-directions-labels', 'A,B,C');
		await expect(current.atlas.locator('.journey-drag-pin')).toHaveCount(3);
		await expect(current.atlas.locator('.journey-drag-pin.end')).toHaveText('C');
		const transit = await findRoute(page, 'transit', [a, b, c]);
		assert.equal(
			transit.result.status,
			'ok',
			'The real dated cross-island journey passes through its mandatory stop'
		);
		assert.ok(transit.result.segments[0].result?.journey?.uses_transit);
		await expect(current.results.locator('[data-leg-mode="bus"]').first()).toBeVisible();
		await page.screenshot({ path: path.join(output, 'desktop-cross-island.png') });
		await current.root.getByRole('button', { name: 'Reverse route', exact: true }).click();
		await expect(current.inputs.nth(0)).toHaveValue(c.name);
		await expect(current.inputs.nth(2)).toHaveValue(a.name);
		await expect(current.results).toHaveCount(0);
		await expect(current.atlas).toHaveAttribute('data-journey-route-segments', '0');
		await current.rows.nth(1).getByRole('button', { name: 'Remove stop 1', exact: true }).click();
		await expect(current.rows).toHaveCount(2);
		await expect(current.atlas).toHaveAttribute('data-directions-labels', 'A,B');
		await chooseEndpoint(page, 0, b);
		await chooseEndpoint(page, 1, c);
		await current.root.locator('input[type="time"]').fill('');
		await expect(current.find).toBeDisabled();
		const roadModes = [];
		for (const mode of /** @type {TravelMode[]} */ (['walk', 'bicycle', 'car'])) {
			const route = await findRoute(page, mode, [b, c]);
			if (mode === 'walk')
				assert.equal(route.result.status, 'ok', 'Real nearby walking points have a mapped route');
			roadModes.push({
				mode,
				status: route.result.status,
				minutes: route.result.minutes,
				distance_m: route.result.distance_m,
				lines: lineCount(route.result)
			});
		}
		await current.root.getByRole('button', { name: 'Add stop', exact: true }).click();
		await expect(current.rows).toHaveCount(3);
		await current.root.getByRole('button', { name: 'Close directions', exact: true }).click();
		await expect(current.root).toHaveCount(0);
		await expect(current.atlas.locator('.journey-drag-pin')).toHaveCount(0);
		await expect(current.atlas).toHaveAttribute('data-journey-endpoints', '0');
		await openFromMainSearch(page, mappedPlaces[1]);
		await expect(current.rows).toHaveCount(2);
		await page.screenshot({ path: path.join(output, 'desktop-fresh-prefill.png') });
		return {
			source: 'Actual mapped API inventory and operator stop catalogue',
			serviceDate,
			operatorPlaces,
			selectedPlaces: mappedPlaces.slice(0, 2),
			initialLayout,
			transit: {
				request: transit.request,
				status: transit.result.status,
				minutes: transit.result.minutes,
				lines: lineCount(transit.result)
			},
			roadModes
		};
	});
	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 320, height: 740 }
	]) {
		await scenario(`mobile-${viewport.width}`, viewport, async (page) => {
			await openIsland(page);
			await openFromMainSearch(page, mappedPlaces[0]);
			const current = ui(page);
			const initialLayout = await directionsLayout(page);
			await chooseEndpoint(page, 0, operatorPlaces[1]);
			await chooseEndpoint(page, 1, operatorPlaces[2]);
			const route = await findRoute(page, 'walk', operatorPlaces.slice(1));
			assert.equal(route.result.status, 'ok');
			const resultLayout = await directionsLayout(page);
			const mapVisibility = await mobilePinsAndKey(page);
			await page.screenshot({ path: path.join(output, `mobile-${viewport.width}-route.png`) });
			await current.root.getByRole('button', { name: 'Close directions', exact: true }).click();
			await expect(current.root).toHaveCount(0);
			await expect(current.atlas.locator('.journey-drag-pin')).toHaveCount(0);
			await expect(page.getByTestId('map-search-input')).toBeVisible();
			return {
				initialLayout,
				resultLayout,
				...mapVisibility,
				status: route.result.status,
				minutes: route.result.minutes
			};
		});
	}
	assert.deepEqual(
		report.pageErrors,
		[],
		'The inline directions flows produce no browser runtime errors'
	);
} catch (error) {
	report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
	process.exitCode = 1;
} finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
	await browser.close();
	console.log(JSON.stringify(report, null, 2));
}
