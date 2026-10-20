import { browserBaseURL } from './browser-config.mjs';
import { projectMapPoint } from './browser-map.mjs';
import { prepareRouteVehicles, routeVehicleFeatures } from '../src/lib/route-vehicles.ts';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Run directly against the real, already-started frontend and backend. No responses are replaced.
const baseURL = browserBaseURL();
const output = path.resolve('artifacts/qa/sea-network');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 60000 });
/** @type {{baseURL:string,startedAt:string,finishedAt?:string,checks:Array<{name:string,status:string,detail?:unknown}>,pageErrors:string[],networkGets:Array<{url:string,status?:number,failure?:string}>,airNetworkGets:string[],screenshots:string[],failure?:string,mapState?:unknown}} */
const report = {
	baseURL,
	startedAt: new Date().toISOString(),
	checks: [],
	pageErrors: [],
	networkGets: [],
	airNetworkGets: [],
	screenshots: []
};
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1000 },
	reducedMotion: 'reduce'
});
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.on('pageerror', (error) => report.pageErrors.push(error.message));
page.on('console', (message) => {
	// Svelte can catch fatal effect errors and render its error page without a pageerror event.
	if (message.type() === 'error' && message.text().includes('https://svelte.dev/e/'))
		report.pageErrors.push(message.text());
});
/** @param {string} value */
const isNetwork = (value) => new URL(value).pathname.endsWith('/planning/sea-network');
page.on('request', (request) => {
	if (request.method() === 'GET' && request.url().includes('/planning/air-network'))
		report.airNetworkGets.push(request.url());
	if (request.method() === 'GET' && isNetwork(request.url())) {
		report.networkGets.push({ url: request.url() });
	}
});
page.on('response', (response) => {
	if (isNetwork(response.url())) {
		const request = report.networkGets.findLast((item) => item.url === response.url());
		if (request) request.status = response.status();
	}
});
page.on('requestfailed', (request) => {
	if (isNetwork(request.url())) {
		const recorded = report.networkGets.findLast((item) => item.url === request.url());
		if (recorded) recorded.failure = request.failure()?.errorText ?? 'Request failed';
	}
});

const atlas = page.locator('.national-map');
const search = page.getByTestId('map-search-input');
const scope = page.getByTestId('map-search-scope');
const legend = page.getByTestId('sea-pressure-legend');
const layers = page.locator('.map-toolbar').getByRole('button', { name: /^Layers\b/ });
const seaSwitch = page.getByRole('button', { name: /^Sea route lines\b/ });
const airSwitch = page.getByRole('button', { name: /^Flight route lines\b/ });

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
		await writeFile(path.join(output, 'map-verification.json'), JSON.stringify(report, null, 2));
	}
}

/** @param {string} name */
async function screenshot(name) {
	const destination = path.join(output, `map-${name}.png`);
	await page.screenshot({ path: destination, fullPage: true });
	report.screenshots.push(destination);
}

async function noOverflow() {
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
		.toBe(true);
}

try {
	const firstNetwork = page.waitForResponse(
		(response) => isNetwork(response.url()) && response.request().method() === 'GET'
	);
	const firstAirNetwork = page.waitForResponse((response) =>
		response.url().includes('/planning/air-network')
	);
	await page.goto(`${baseURL}/?view=map&tool=explore`, { waitUntil: 'domcontentloaded' });
	const response = await firstNetwork;
	const airResponse = await firstAirNetwork;
	assert.equal(airResponse.status(), 200);
	/** @type {import('../src/lib/air-connectivity.js').AirNetwork} */
	const airNetwork = await airResponse.json();
	const airCount = airNetwork.map_features.features.length;
	/** @type {import('../src/lib/route-vehicles.js').RouteVehiclePath[]} */
	const aircraftPaths = airNetwork.map_features.features.flatMap((feature) =>
		feature.geometry.type === 'LineString' && feature.properties?.route_id
			? [
					{
						id: String(feature.properties.leg_id ?? feature.properties.route_id),
						routeId: String(feature.properties.route_id),
						name: String(feature.properties.name),
						mode: 'air',
						geometry: feature.geometry,
						bidirectional: feature.properties.bidirectional === true
					}
				]
			: []
	);
	assert.equal(
		response.status(),
		200,
		'The real national sea-network endpoint responds successfully'
	);
	/** @type {import('../src/lib/sea-connectivity.js').SeaNetwork} */
	const network = await response.json();
	const mapped = network.map_features.features.filter(
		(feature) => feature.geometry.type === 'LineString'
	).length;
	const aircraftCount = aircraftPaths.reduce(
		(sum, route) => sum + (route.bidirectional ? 2 : 1),
		0
	);
	const vehicleCount = mapped + aircraftCount;
	const initialRequests = report.networkGets.length;

	await check(
		'Domestic connections load once and flight-line switches preserve aircraft and airports',
		async () => {
			assert.ok(airCount > 0);
			assert.equal(airCount, airNetwork.coverage.mapped_legs);
			await expect(atlas).toHaveAttribute('data-air-routes', String(airCount));
			await expect(atlas).toHaveAttribute('data-route-vehicles', String(vehicleCount));
			await expect(atlas).toHaveAttribute('data-route-vehicle-animation', 'false');
			await expect(atlas).toHaveAttribute('data-air-network-routes', String(airCount));
			const airports = await atlas.getAttribute('data-air-airports');
			assert.ok(airports && Number(airports) > 0);
			await expect(legend).toContainText('Air');
			await layers.click();
			await expect(seaSwitch).toBeInViewport();
			await expect(airSwitch).toBeInViewport();
			await airSwitch.click();
			await expect(atlas).toHaveAttribute('data-air-routes', '0');
			await expect(atlas).toHaveAttribute('data-route-vehicles', String(vehicleCount));
			await expect(atlas).toHaveAttribute('data-air-network-routes', String(airCount));
			await expect(atlas).toHaveAttribute('data-air-airports', airports);
			await airSwitch.click();
			await expect(atlas).toHaveAttribute('data-route-vehicles', String(vehicleCount));
			await page.getByRole('button', { name: 'Close map controls', exact: true }).click();
			assert.equal(report.airNetworkGets.length, 1);
			return { airConnections: airCount, seaConnections: mapped, illustrations: vehicleCount };
		}
	);
	await check(
		'Default map displays the complete national sea network without a toggle',
		async () => {
			assert.ok(mapped > 0, 'The actual backend supplies mapped sea connections');
			assert.equal(
				mapped,
				network.coverage.mapped_routes,
				'Backend coverage agrees with its line inventory'
			);
			await expect(atlas).toHaveAttribute('data-active', 'true');
			await expect(atlas).toHaveAttribute('aria-busy', 'false');
			await expect(atlas).toHaveAttribute('data-sea-view', 'true');
			await expect(atlas).toHaveAttribute('data-sea-routes', String(mapped));
			await expect(legend).toBeVisible();
			await expect(page.locator('.sea-layer-card')).toHaveCount(0);
			await noOverflow();
			assert.equal(initialRequests, 1, 'One request preloads the national network');
			await screenshot('default');
			return {
				serviceDate: network.service_date,
				routeRecords: network.routes.length,
				mappedRoutes: mapped,
				initialScope: (await scope.count()) ? await scope.getAttribute('data-island-id') : null,
				networkRequests: initialRequests
			};
		}
	);

	await check(
		'Local heatmap and service filters coexist with the default sea network',
		async () => {
			const coverage = page.getByLabel('Service coverage map', { exact: true });
			await expect(coverage).toBeVisible();
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-policy-gap-cells')))
				.toBeGreaterThan(0);
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-policy-gap-opacity')))
				.toBeGreaterThan(0);
			await coverage.getByRole('button', { name: 'Health', exact: true }).click();
			await expect(atlas).toHaveAttribute('data-policy-lens', 'health');
			await expect(atlas).toHaveAttribute('data-sea-view', 'true');
			await expect(atlas).toHaveAttribute('data-sea-routes', String(mapped));
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-policy-gap-opacity')))
				.toBeGreaterThan(0);
			await coverage.getByRole('button', { name: 'All services', exact: true }).click();
			await expect(atlas).toHaveAttribute('data-policy-lens', 'overall');
			return {
				localCells: Number(await atlas.getAttribute('data-policy-gap-cells')),
				localOpacity: Number(await atlas.getAttribute('data-policy-gap-opacity')),
				mappedSeaRoutes: mapped,
				filtersPreserveSeaLayer: true
			};
		}
	);

	const catalogueResponse = await page.request.get(
		`${baseURL}/api/backend/map/features?layer=islands`
	);
	assert.equal(catalogueResponse.status(), 200, 'The real island catalogue is available');
	/** @type {{features:Array<{properties:{id:string,name:string}}>}} */
	const catalogue = await catalogueResponse.json();
	const target = catalogue.features.find(
		(feature) => feature.properties.id === 'island:680'
	)?.properties;
	assert.ok(target, 'The actual catalogue identifies Kulhudhuffushi');
	assert.ok(
		network.routes.some((route) => route.stop_island_ids.includes(target.id)),
		'The selected distant island has retained national route evidence'
	);

	await check(
		'Island selection through scoped search preserves the complete national network',
		async () => {
			if (await scope.count()) {
				await page.getByRole('button', { name: 'Remove island filter', exact: true }).click();
				await expect(scope).toHaveCount(0);
			}
			await search.fill(target.name);
			const option = page.locator(
				`#island-search-results [data-search-kind="island"][data-island-id="${target.id}"]`
			);
			await expect(option).toBeVisible();
			await option.click();
			await expect(scope).toHaveAttribute('data-island-id', target.id);
			await expect(page).toHaveURL((url) => url.searchParams.get('island') === target.id);
			await expect(atlas).toHaveAttribute('aria-busy', 'false');
			await expect(atlas).toHaveAttribute('data-sea-view', 'true');
			await expect(atlas).toHaveAttribute('data-sea-routes', String(mapped));
			await expect(legend).toBeVisible();
			assert.equal(
				report.networkGets.length,
				initialRequests,
				'Selecting another island reuses the national network'
			);
			await noOverflow();
			await screenshot('island-selected');
			return {
				selectedIsland: target,
				mappedRoutes: mapped,
				networkRequests: report.networkGets.length
			};
		}
	);

	await check(
		'Layers hides only sea lines, retaining boats and terminals without another GET',
		async () => {
			const terminals = await atlas.getAttribute('data-sea-terminals');
			assert.ok(terminals && Number(terminals) > 0);
			await layers.click();
			await expect(layers).toHaveAttribute('aria-expanded', 'true');
			await expect(seaSwitch).toBeVisible();
			await expect(seaSwitch).toHaveAttribute('aria-pressed', 'true');
			await seaSwitch.click();
			await expect(seaSwitch).toHaveAttribute('aria-pressed', 'false');
			await expect(atlas).toHaveAttribute('data-sea-view', 'false');
			await expect(atlas).toHaveAttribute('data-sea-routes', '0');
			await expect(legend).toBeVisible(); // Air routes retain the shared key.
			await expect(atlas).toHaveAttribute('data-route-vehicles', String(vehicleCount));
			await expect(atlas).toHaveAttribute('data-sea-network-routes', String(mapped));
			await expect(atlas).toHaveAttribute('data-sea-terminals', terminals);
			await expect(scope).toHaveAttribute('data-island-id', target.id);
			await screenshot('layer-hidden');
			await seaSwitch.click();
			await expect(seaSwitch).toHaveAttribute('aria-pressed', 'true');
			await expect(atlas).toHaveAttribute('data-sea-view', 'true');
			await expect(atlas).toHaveAttribute('data-sea-routes', String(mapped));
			await expect(legend).toBeVisible();
			await expect(page).toHaveURL((url) => url.searchParams.get('sea') === '1');
			await page.getByRole('button', { name: 'Close map controls', exact: true }).click();
			await expect(layers).toHaveAttribute('aria-expanded', 'false');
			assert.equal(
				report.networkGets.length,
				initialRequests,
				'Layer off/on reuses the loaded network'
			);
			await expect(scope).toHaveAttribute('data-island-id', target.id);
			await noOverflow();
			await screenshot('layer-restored');
			return {
				mappedRoutes: mapped,
				networkRequests: report.networkGets.length,
				selectedIsland: target.id
			};
		}
	);

	await check(
		'Explicit sea hiding and proposal focus reuse the cached national network',
		async () => {
			await legend.getByRole('button', { name: 'Hide sea route lines', exact: true }).click();
			await expect(atlas).toHaveAttribute('data-sea-view', 'false');
			await expect(page.getByLabel('Service coverage map', { exact: true })).toBeVisible();
			await layers.click();
			await seaSwitch.click();
			await page.getByRole('button', { name: 'Close map controls', exact: true }).click();
			await expect(atlas).toHaveAttribute('data-sea-view', 'true');
			await page.getByRole('button', { name: 'Create proposal', exact: true }).click();
			const editor = page.locator('.policy-map-panel[data-policy-section="proposal"]');
			await expect(editor).toBeVisible();
			await expect(atlas).toHaveAttribute('data-sea-view', 'false');
			await expect(page.getByRole('button', { name: 'Create proposal', exact: true })).toHaveCount(
				0
			);
			await editor
				.getByRole('button', { name: 'Close island planning panel', exact: true })
				.click();
			await layers.click();
			await seaSwitch.click();
			await page.getByRole('button', { name: 'Close map controls', exact: true }).click();
			await expect(atlas).toHaveAttribute('data-sea-routes', String(mapped));
			assert.equal(report.networkGets.length, initialRequests);
			return {
				localControlsRestored: true,
				proposalEditingRestored: true,
				networkRequests: report.networkGets.length
			};
		}
	);

	await check(
		'National overview retains the complete network and its published pressure palette',
		async () => {
			await page.locator('.map-toolbar').getByRole('button', { name: 'View', exact: true }).click();
			await page.getByRole('button', { name: 'Show all Maldives', exact: true }).click();
			await expect(page).toHaveURL((url) => url.searchParams.get('scope') === 'country');
			await expect(atlas).toHaveAttribute('aria-busy', 'false');
			await expect(atlas).toHaveAttribute('data-sea-routes', String(mapped));
			await expect.poll(async () => Number(await atlas.getAttribute('data-zoom'))).toBeLessThan(8);
			await noOverflow();
			const pressureCounts = Object.fromEntries(
				['low', 'medium', 'high', 'unknown'].map((level) => [
					level,
					network.map_features.features.filter(
						(feature) =>
							feature.geometry.type === 'LineString' && feature.properties?.pressure_level === level
					).length
				])
			);
			assert.equal(
				report.networkGets.length,
				initialRequests,
				'Country view reuses the loaded network'
			);
			await screenshot('national-overview');
			return { mappedRoutes: mapped, pressureCounts, networkRequests: report.networkGets.length };
		}
	);

	await check(
		'Flight connections disclose source evidence and current schedule limits on click',
		async () => {
			// Isolate flight hit targets at country scale, where many sea corridors overlap them.
			await legend.getByRole('button', { name: 'Hide sea route lines', exact: true }).click();
			await expect(atlas).toHaveAttribute('data-sea-routes', '0');
			for (const route of airNetwork.routes) {
				const coordinates = route.geometry?.coordinates;
				if (!coordinates || coordinates.length !== 2) continue;
				const location = [0, 1].map(
					(axis) => coordinates[0][axis] + (coordinates[1][axis] - coordinates[0][axis]) * 0.7
				);
				const point = await projectMapPoint(atlas, location);
				const visible = await page.evaluate(
					({ x, y }) =>
						x > 0 &&
						y > 0 &&
						x < innerWidth &&
						y < innerHeight &&
						document.elementFromPoint(x, y)?.classList.contains('maplibregl-canvas'),
					point
				);
				if (!visible) continue;
				await page.mouse.click(point.x, point.y);
				if (await page.locator('[data-air-route]').isVisible()) break;
				await page.keyboard.press('Escape');
			}
			const card = page.locator('[data-air-route]');
			await expect(card).toBeVisible({ timeout: 5000 });
			await expect(card).toContainText('Current frequency unconfirmed');
			await card.getByText('Route details', { exact: true }).click();
			await expect(card).toContainText('Published airline connection');
			await expect(card).toContainText('route illustrations');
			await expect(card.locator('a').first()).toHaveAttribute(
				'href',
				/^https:\/\/maldivian\.aero\//
			);
			await screenshot('domestic-flight');
			await page.keyboard.press('Escape');
			await page.emulateMedia({ reducedMotion: 'no-preference' });
			await expect(atlas).toHaveAttribute('data-route-vehicle-animation', 'true');
			await screenshot('route-motion');
			await expect(atlas).toBeVisible();
			await page.emulateMedia({ reducedMotion: 'reduce' });
			await expect(atlas).toHaveAttribute('data-route-vehicle-animation', 'false');
			await layers.click();
			await airSwitch.click();
			await page.getByRole('button', { name: 'Close map controls', exact: true }).click();
			await expect(atlas).toHaveAttribute('data-air-routes', '0');
			await expect(atlas).toHaveAttribute('data-sea-routes', '0');
			await expect(atlas).toHaveAttribute('data-route-vehicles', String(vehicleCount));
			await expect(legend).toHaveCount(0);
			// Reduced motion fixes illustrations at their deterministic route positions.
			// Click a real rendered aircraft with both line layers hidden.
			const aircraft = routeVehicleFeatures(prepareRouteVehicles(aircraftPaths), 0, true);
			for (const aircraftPoint of aircraft.features) {
				const point = await projectMapPoint(atlas, aircraftPoint.geometry.coordinates);
				const visible = await page.evaluate(
					({ x, y }) =>
						x > 0 &&
						y > 0 &&
						x < innerWidth &&
						y < innerHeight &&
						document.elementFromPoint(x, y)?.classList.contains('maplibregl-canvas'),
					point
				);
				if (!visible) continue;
				await page.mouse.click(point.x, point.y);
				if (await card.isVisible()) break;
				await page.keyboard.press('Escape');
			}
			await expect(card).toBeVisible({ timeout: 5000 });
			await expect(card).toContainText('Current frequency unconfirmed');
			await screenshot('lines-hidden-vehicle-inspection');
			await page.keyboard.press('Escape');
			await layers.click();
			await airSwitch.click();
			await seaSwitch.click();
			await page.getByRole('button', { name: 'Close map controls', exact: true }).click();
			await expect(atlas).toHaveAttribute('data-route-vehicles', String(vehicleCount));
			assert.equal(report.airNetworkGets.length, 1);
			return {
				routePopup: true,
				aircraftInspectableWithLinesHidden: true,
				reducedMotion: true,
				airNetworkRequests: 1
			};
		}
	);

	await check('Sea inspector leaves Layers and both route-line switches clickable', async () => {
		await page.goto(
			`${baseURL}/?view=map&tool=explore&island=island%3A680&explorer=sea&sea=1&air=1`,
			{ waitUntil: 'domcontentloaded' }
		);
		await expect(page.getByTestId('sea-connections-panel')).toBeVisible();
		await expect(atlas).toHaveAttribute('aria-busy', 'false');
		await expect(atlas).toHaveAttribute('data-sea-routes', String(mapped));
		await expect(atlas).toHaveAttribute('data-air-routes', String(airCount));
		await expect(atlas).toHaveAttribute('data-route-vehicles', String(vehicleCount));
		const terminals = await atlas.getAttribute('data-sea-terminals');
		const airports = await atlas.getAttribute('data-air-airports');
		assert.ok(terminals && Number(terminals) > 0);
		assert.ok(airports && Number(airports) > 0);
		// Ordinary clicks also verify that the open inspector cannot intercept the controls.
		await layers.click();
		await expect(seaSwitch).toBeInViewport();
		await expect(airSwitch).toBeInViewport();
		await expect(seaSwitch).toHaveAttribute('aria-pressed', 'true');
		await expect(airSwitch).toHaveAttribute('aria-pressed', 'true');
		await seaSwitch.click();
		await airSwitch.click();
		await expect(seaSwitch).toHaveAttribute('aria-pressed', 'false');
		await expect(airSwitch).toHaveAttribute('aria-pressed', 'false');
		await expect(atlas).toHaveAttribute('data-sea-routes', '0');
		await expect(atlas).toHaveAttribute('data-air-routes', '0');
		await expect(atlas).toHaveAttribute('data-sea-network-routes', String(mapped));
		await expect(atlas).toHaveAttribute('data-air-network-routes', String(airCount));
		await expect(atlas).toHaveAttribute('data-route-vehicles', String(vehicleCount));
		await expect(atlas).toHaveAttribute('data-sea-terminals', terminals);
		await expect(atlas).toHaveAttribute('data-air-airports', airports);
		await expect(page).toHaveURL(
			(url) => url.searchParams.get('sea') === '0' && url.searchParams.get('air') === '0'
		);
		await screenshot('inspector-layer-controls');
		await page.getByRole('button', { name: 'Close map controls', exact: true }).click();
		return { inspectorControlsClickable: true, illustrations: vehicleCount };
	});

	await check(
		'Sea-network map interactions complete without runtime or network errors',
		async () => {
			assert.deepEqual(report.pageErrors, []);
			assert.ok(
				report.networkGets.every(
					(request) =>
						[200, 304].includes(request.status ?? 0) &&
						(!request.failure ||
							// Chromium can cancel the empty conditional response after the
							// application restores its saved body; the checks above require
							// both complete network models and working controls after navigation.
							(request.status === 304 && request.failure === 'net::ERR_ABORTED'))
				)
			);
			return { runtimeErrors: report.pageErrors.length, requests: report.networkGets };
		}
	);
} catch (error) {
	report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
	report.mapState = await atlas
		.evaluate((element) =>
			Object.fromEntries(
				[...element.attributes]
					.filter(
						(attribute) => attribute.name.startsWith('data-') || attribute.name === 'aria-busy'
					)
					.map((attribute) => [attribute.name, attribute.value])
			)
		)
		.catch(() => null);
	await screenshot('failure').catch(() => {});
	process.exitCode = 1;
} finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(path.join(output, 'map-verification.json'), JSON.stringify(report, null, 2));
	await browser.close();
	console.log(JSON.stringify(report, null, 2));
}
