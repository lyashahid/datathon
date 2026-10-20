import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';
import { browserBaseURL } from './browser-config.mjs';

const baseURL = browserBaseURL();
const selectedCheck = process.env.MOBILITY_QA_CHECK;
const output = path.resolve('artifacts/qa/scenario-presentation');
const reportFilename = selectedCheck ? 'verification-targeted.json' : 'verification.json';
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 90000 });
/** @type {{baseURL:string,startedAt:string,finishedAt?:string,checks:Array<{name:string,status:string,detail?:unknown}>,errors:string[],failure?:string}} */
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], errors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1000 },
	reducedMotion: 'reduce'
});
const savedScenario = {
	id: 'scenario-presentation-qa',
	name: 'Retained planning workspace',
	operations: [{ type: 'add_bus_stop', island_id: 'island:1443', coordinates: [73.51, 4.175] }]
};
await context.addInitScript((scenario) => {
	localStorage.setItem('mobility-v2-scenario', JSON.stringify(scenario));
}, savedScenario);
const page = await context.newPage();
page.setDefaultTimeout(90000);
page.on('pageerror', (error) => {
	report.errors.push(error.message);
	console.error(`PAGE ERROR ${error.message}`);
});
const atlas = page.locator('.national-map');
const presenter = page.getByRole('region', { name: 'Scenario presentation', exact: true });
const scope = page.getByTestId('map-search-scope');
/** @type {Record<string, unknown>} */
const evidence = {};
/** @type {Promise<void>[]} */
const responseReads = [];
page.on('response', (response) => {
	const endpoint = new URL(response.url()).pathname.split('/api/backend/')[1];
	if (
		![
			'planning/sea-network',
			'planning/air-network',
			'routing/journey',
			'planning/bus-connection',
			'planning/evaluate'
		].includes(endpoint) ||
		!response.ok()
	)
		return;
	responseReads.push(
		response
			.json()
			.then((value) => {
				evidence[endpoint] = value;
			})
			.catch(() => {})
	);
});

/** @param {string} name @param {()=>Promise<unknown>} action */
async function check(name, action) {
	if (selectedCheck && !name.includes(selectedCheck)) return;
	console.log(`RUN ${name}`);
	/** @type {{name:string,status:string,detail?:unknown}} */
	const result = { name, status: 'running' };
	report.checks.push(result);
	await writeFile(path.join(output, reportFilename), JSON.stringify(report, null, 2));
	const diagnostic = setTimeout(() => {
		console.log(`WAIT ${name}`);
		void logScene('Waiting scene');
		void page
			.screenshot({ path: path.join(output, 'waiting.png'), fullPage: true, timeout: 10000 })
			.catch((error) => console.log(`WAIT screenshot unavailable: ${String(error)}`));
	}, 30000);
	try {
		const detail = await action();
		Object.assign(result, { status: 'passed', detail });
		console.log(`PASS ${name}`);
	} catch (error) {
		Object.assign(result, { status: 'failed', detail: String(error) });
		throw error;
	} finally {
		clearTimeout(diagnostic);
		await writeFile(path.join(output, reportFilename), JSON.stringify(report, null, 2));
	}
}

/** @param {string} checkpoint */
async function logScene(checkpoint) {
	const state = await atlas.evaluate((element) => ({
		step: document.querySelector('[aria-label="Scenario presentation"]')?.getAttribute('data-step'),
		key: element.getAttribute('data-presentation-key'),
		phase: element.getAttribute('data-presentation-phase'),
		animating: element.getAttribute('data-presentation-animating'),
		following: element.getAttribute('data-presentation-following'),
		progress: element.getAttribute('data-presentation-progress')
	}));
	console.log(`${checkpoint} ${JSON.stringify(state)}`);
}

/** @param {number} step @param {string} island */
async function expectStep(step, island) {
	await expect(presenter).toHaveAttribute('data-step', String(step));
	await expect(atlas).toHaveAttribute('data-presentation-key', new RegExp(`^${step}:`));
	await expect(scope).toHaveAttribute('data-island-id', island);
	await presentationChromeHidden();
	await visibleClocks();
}

/** @param {string} attribute */
async function positiveCount(attribute) {
	await expect.poll(async () => Number(await atlas.getAttribute(attribute))).toBeGreaterThan(0);
	return Number(await atlas.getAttribute(attribute));
}

async function noOverflow() {
	const dimensions = await page.evaluate(() => ({
		viewport: innerWidth,
		document: document.documentElement.scrollWidth
	}));
	assert.ok(dimensions.document <= dimensions.viewport + 1, JSON.stringify(dimensions));
	return dimensions;
}

const next = () => presenter.getByRole('button', { name: 'Next scenario step', exact: true });
const details = () => presenter.getByRole('complementary', { name: 'Scenario island details' });
const arrivalClock = () => page.getByTestId('presentation-arrival-clock');
const pickupClock = () => page.getByTestId('presentation-pickup-clock');
async function presentationChromeHidden() {
	await expect(
		page.getByRole('navigation', { name: 'Workspace', includeHidden: true })
	).toBeHidden();
	await expect(scope).toBeHidden();
	await expect(page.getByTestId('map-controls-dock')).toBeHidden();
	await expect(atlas.locator('.map-footer')).toBeHidden();
}
async function visibleClocks() {
	await expect(arrivalClock()).toBeInViewport();
	await expect(pickupClock()).toBeInViewport();
	const step = Number(await presenter.getAttribute('data-step'));
	await expect(arrivalClock()).toHaveAttribute('data-active', String(step < 6));
	await expect(pickupClock()).toHaveAttribute('data-active', String(step >= 6));
	const active = step < 6 ? arrivalClock() : pickupClock();
	const secondary = step < 6 ? pickupClock() : arrivalClock();
	const activeBox = await active.boundingBox();
	const secondaryBox = await secondary.boundingBox();
	assert.ok(activeBox && secondaryBox);
	const activeColor = await active.evaluate((element) => getComputedStyle(element).color);
	const secondaryColor = await secondary.evaluate((element) => getComputedStyle(element).color);
	assert.notEqual(
		activeColor,
		secondaryColor,
		'The current journey clock must have visual emphasis'
	);
	assert.ok(
		activeBox.x + activeBox.width <= secondaryBox.x + 1 ||
			secondaryBox.x + secondaryBox.width <= activeBox.x + 1 ||
			activeBox.y + activeBox.height <= secondaryBox.y + 1 ||
			secondaryBox.y + secondaryBox.height <= activeBox.y + 1,
		'The two visible journey clocks must not overlap'
	);
}
async function frozenClocks() {
	await visibleClocks();
	await expect(arrivalClock()).toHaveAttribute('data-running', 'false');
	await expect(pickupClock()).toHaveAttribute('data-running', 'false');
	const values = [
		await arrivalClock().getAttribute('data-elapsed-seconds'),
		await pickupClock().getAttribute('data-elapsed-seconds')
	];
	await page.waitForTimeout(450);
	assert.deepEqual(
		[
			await arrivalClock().getAttribute('data-elapsed-seconds'),
			await pickupClock().getAttribute('data-elapsed-seconds')
		],
		values,
		'Presentation pauses must not advance either journey clock'
	);
	return values;
}
/** @param {string} selector */
async function readableInspector(selector) {
	const metrics = await atlas.locator(selector).evaluate((popup) => {
		/** @param {string} query */
		const size = (query) => {
			const element = popup.querySelector(query);
			if (!element) throw new Error(`Inspector element missing: ${query}`);
			return parseFloat(getComputedStyle(element).fontSize);
		};
		return {
			title: size('h3'),
			label: size(':scope .map-record-card > dl > dt'),
			value: size(':scope .map-record-card > dl > dd')
		};
	});
	assert.ok(metrics.title >= 22, `Presentation title is too small: ${metrics.title}px`);
	assert.ok(metrics.label >= 14, `Presentation label is too small: ${metrics.label}px`);
	assert.ok(metrics.value >= 28, `Presentation headline is too small: ${metrics.value}px`);
	return metrics;
}
/** @param {string} selector @param {string} label */
async function sourceDisclosure(selector, label) {
	const popup = atlas.locator(selector);
	const disclosure = popup.locator('details');
	const toggle = disclosure.locator(':scope > summary');
	await expect(toggle).toHaveText(label);
	await expect(disclosure).toHaveJSProperty('open', false);
	await toggle.focus();
	await toggle.press('Enter');
	await expect(disclosure).toHaveJSProperty('open', true);
	await expect(popup.getByText('Operator', { exact: true })).toBeVisible();
	await frozenClocks();
	await toggle.press('Space');
	await expect(disclosure).toHaveJSProperty('open', false);
}
/** @param {import('@playwright/test').Locator} first @param {import('@playwright/test').Locator} second @param {string} description */
async function separated(first, second, description) {
	const firstBox = await first.boundingBox();
	const secondBox = await second.boundingBox();
	assert.ok(firstBox && secondBox, 'Presentation overlays must have visible boxes');
	assert.ok(
		firstBox.x + firstBox.width <= secondBox.x + 1 ||
			secondBox.x + secondBox.width <= firstBox.x + 1 ||
			firstBox.y + firstBox.height <= secondBox.y + 1 ||
			secondBox.y + secondBox.height <= firstBox.y + 1,
		description
	);
}
/** @param {import('@playwright/test').Locator} panel */
async function clocksClearOf(panel) {
	for (const clock of [arrivalClock(), pickupClock()]) {
		await separated(clock, panel, 'Journey clocks must not cover the native detail panel');
	}
}
async function settled() {
	await expect(atlas).toHaveAttribute('data-presentation-phase', 'complete');
	await page.waitForTimeout(350);
}

async function staticSceneSurvivesVisibilityChange() {
	const key = await atlas.getAttribute('data-presentation-key');
	const panel = presenter.locator('[aria-label="Scenario island details"]');
	await settled();
	try {
		await page.evaluate(() => {
			Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
			document.dispatchEvent(new Event('visibilitychange'));
		});
		await expect(panel).toHaveJSProperty('inert', true);
		await frozenClocks();
	} finally {
		await page.evaluate(() => {
			Reflect.deleteProperty(document, 'hidden');
			document.dispatchEvent(new Event('visibilitychange'));
		});
	}
	await expect(atlas).toHaveAttribute('data-presentation-key', key ?? '');
	await expect(atlas).toHaveAttribute('data-presentation-phase', 'complete');
	await expect(panel).toHaveJSProperty('inert', false);
	await expect(panel).toHaveCSS('opacity', '1');
	await expect(panel).toBeVisible();
	await frozenClocks();
}

async function camera() {
	return {
		longitude: Number(await atlas.getAttribute('data-center-longitude')),
		latitude: Number(await atlas.getAttribute('data-center-latitude')),
		zoom: Number(await atlas.getAttribute('data-zoom'))
	};
}

async function comparisonMetric() {
	const outcome = presenter.locator('[aria-label="Walking time to a stop"]');
	await expect(outcome).toBeInViewport();
	await expect(outcome).toContainText('Walk to a stop');
	await clocksClearOf(outcome);
	for (const control of [
		presenter.getByRole('navigation', { name: 'Scenario controls', exact: true }),
		presenter.getByRole('button', { name: 'Before', exact: true }),
		presenter.getByRole('button', { name: 'Closer stop', exact: true })
	]) {
		await separated(
			outcome,
			control,
			'The walking-time metric must not cover presentation controls'
		);
	}
	await Promise.all(responseReads);
	const evaluation =
		/** @type {{origins:Array<{origin_id:string,before:{minutes:number|null},after:{minutes:number|null}}>}} */ (
			evidence['planning/evaluate']
		);
	const origin = evaluation.origins.find((item) => item.origin_id === 'wp:hulhumale:3443:1080');
	assert.ok(origin?.before.minutes != null && origin.after.minutes != null);
	assert.ok(origin.before.minutes > origin.after.minutes);
	const values = await outcome.locator('strong').allTextContents();
	assert.equal(values.length, 2);
	for (const [index, expected] of [origin.before.minutes, origin.after.minutes].entries()) {
		if (expected > 0 && expected < 1) assert.equal(values[index], '<1 min');
		else assert.equal(values[index], `${Math.round(expected)} min`);
	}
	return { beforeMinutes: origin.before.minutes, afterMinutes: origin.after.minutes, values };
}

async function comparisonOriginInViewport() {
	const journey =
		/** @type {{segments:Array<{result:{journey:{legs:Array<{geometry:number[][]}>}}|null}>}} */ (
			evidence['routing/journey']
		);
	const origin = journey.segments.flatMap((segment) => segment.result?.journey.legs ?? [])[0]
		?.geometry[0];
	assert.ok(origin?.length === 2, 'The retained airport itinerary must provide its origin');
	const view = await camera();
	const box = await atlas.boundingBox();
	assert.ok(box);
	// Presentation cameras are north-up at zero pitch, so Web Mercator gives screen position.
	/** @param {number} latitude */
	const mercatorY = (latitude) =>
		(1 - Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360)) / Math.PI) / 2;
	const worldSize = 512 * 2 ** view.zoom;
	const x = box.width / 2 + ((origin[0] - view.longitude) / 360) * worldSize;
	const y = box.height / 2 + (mercatorY(origin[1]) - mercatorY(view.latitude)) * worldSize;
	assert.ok(
		x > 0 && x < box.width && y > 0 && y < box.height,
		'The final view must include the actual origin'
	);
	return { origin, x, y };
}

/** @param {{longitude:number,latitude:number,zoom:number}} before @param {{longitude:number,latitude:number,zoom:number}} after */
function unchangedCamera(before, after) {
	for (const property of /** @type {const} */ (['longitude', 'latitude', 'zoom'])) {
		assert.ok(
			Math.abs(before[property] - after[property]) < 0.000001,
			`The before/after comparison must keep the same ${property}: ${before[property]} → ${after[property]}`
		);
	}
}

try {
	if (selectedCheck) await page.goto(`${baseURL}/?view=map&tool=explore&island=island%3A1443`);
	await check(
		'Scenario starts beside Directions and typing does not trigger the shortcut',
		async () => {
			await page.goto(`${baseURL}/?view=map&tool=explore&island=island%3A1443`);
			console.log('READY Initial map document loaded');
			await expect(atlas).toBeVisible();
			await expect(page.getByRole('button', { name: 'Start scenario', exact: true })).toBeEnabled();
			console.log('READY Scenario entry enabled');
			await expect(page.getByRole('button', { name: 'Directions', exact: true })).toBeVisible();
			await expect(scope).toHaveAttribute('data-island-id', 'island:1443');
			const input = page.getByTestId('map-search-input');
			await input.focus();
			await input.press('Shift+S');
			await expect(presenter).toHaveCount(0);
			await input.fill('');
			await input.press('Escape');
			await page.getByRole('button', { name: 'Start scenario', exact: true }).click();
			await expectStep(0, 'island:697');
			console.log('READY Hithadhoo scenario entered; awaiting shared data');
			await expect(presenter).toHaveAttribute('aria-busy', 'false', { timeout: 180000 });
			console.log('READY Shared scenario data settled');
			await expect(
				details().getByRole('heading', { name: 'Hithadhoo', exact: true })
			).toBeVisible();
			await expect(
				details().getByRole('region', { name: 'Island access index', exact: true })
			).toBeVisible();
			const gapCells = await positiveCount('data-policy-gap-cells');
			const coverageCells = await positiveCount('data-policy-coverage-fill-cells');
			const seaRoutes = await positiveCount('data-sea-routes');
			await expect(
				presenter.getByRole('button', { name: 'Previous scenario step' })
			).toBeDisabled();
			await settled();
			await frozenClocks();
			await expect(arrivalClock()).toHaveAttribute('data-elapsed-seconds', '0');
			await expect(pickupClock()).toHaveAttribute('data-elapsed-seconds', '0');
			await staticSceneSurvivesVisibilityChange();
			await clocksClearOf(details());
			await expect(details().getByTestId('island-overview-population')).toBeVisible();
			const secondaryDetails = details().locator('details.presentation-details');
			const secondaryToggle = secondaryDetails.locator(':scope > summary');
			await expect(secondaryToggle).toHaveText('Services, demographics & data');
			await expect(secondaryDetails).toHaveJSProperty('open', false);
			await page.screenshot({ path: path.join(output, 'desktop-start.png'), fullPage: true });
			await secondaryToggle.focus();
			await secondaryToggle.press('Enter');
			await expect(secondaryDetails).toHaveJSProperty('open', true);
			await expect(
				details().getByRole('region', { name: 'Island services', exact: true })
			).toBeVisible();
			await expect(
				details().getByRole('region', { name: 'Island access index', exact: true })
			).toBeVisible();
			await visibleClocks();
			await clocksClearOf(details());
			await page.screenshot({
				path: path.join(output, 'desktop-secondary-details.png'),
				fullPage: true
			});
			await secondaryToggle.press('Space');
			await expect(secondaryDetails).toHaveJSProperty('open', false);
			return { gapCells, coverageCells, seaRoutes, dimensions: await noOverflow() };
		}
	);
	await check('Ferry inspector is readable and the presentation arrives at Kadhdhoo', async () => {
		await next().click();
		await expectStep(1, 'island:697');
		await expect(
			atlas.getByRole('heading', { name: 'Hithadhoo → Kadhdhoo', exact: true })
		).toBeVisible();
		await expect(atlas.getByRole('region', { name: 'Sea route', exact: true })).toBeVisible();
		await expect(atlas.getByRole('region', { name: 'Sea route', exact: true })).toContainText(
			'Estimated crossing'
		);
		await expect(atlas.locator('.sea-route-summary')).toContainText('35 min');
		await expect(atlas.locator('.sea-route-summary')).toContainText('6 sailings / week');
		await expect(atlas.locator('.sea-route-presentation-qualification')).toContainText(
			'No public ferry berth'
		);
		await frozenClocks();
		const inspectorType = await readableInspector('.map-sea-route-popup');
		await clocksClearOf(atlas.locator('.map-sea-route-popup'));
		await positiveCount('data-presentation-paths');
		await page.screenshot({
			path: path.join(output, 'desktop-ferry-inspector.png'),
			fullPage: true
		});
		await sourceDisclosure('.map-sea-route-popup', 'Source corridor details');
		await presenter.getByRole('button', { name: 'Previous scenario step' }).click();
		await expectStep(0, 'island:697');
		await page.keyboard.press('ArrowRight');
		await expectStep(1, 'island:697');
		await page.keyboard.press('PageDown');
		await expectStep(2, 'island:697');
		await expect(atlas).toHaveAttribute('data-presentation-progress', '1.000');
		await expect(atlas).toHaveAttribute('data-presentation-animating', 'false');
		await frozenClocks();
		const ferrySeconds = Number(await arrivalClock().getAttribute('data-elapsed-seconds'));
		assert.ok(ferrySeconds > 0);
		evidence['presentation:ferry-seconds'] = ferrySeconds;
		const ferryEndpoint = [
			Number(await atlas.getAttribute('data-presentation-end-longitude')),
			Number(await atlas.getAttribute('data-presentation-end-latitude'))
		];
		assert.ok(Math.hypot(ferryEndpoint[0] - 73.5219, ferryEndpoint[1] - 1.8591) < 0.015);
		await expect(atlas.getByRole('region', { name: 'Sea route', exact: true })).toHaveCount(0);
		await page.screenshot({ path: path.join(output, 'desktop-ferry.png'), fullPage: true });
		await Promise.all(responseReads);
		const sea =
			/** @type {{routes:Array<{route_code:string,stops:Array<{island_id:string}>,geometry:{coordinates:number[][]}|null}>}} */ (
				evidence['planning/sea-network']
			);
		const route = sea.routes.find(
			(item) =>
				item.route_code === 'Z4R17' && item.stops.some((stop) => stop.island_id === 'island:697')
		);
		assert.ok(route?.geometry?.coordinates.length);
		assert.ok(route.stops.some((stop) => stop.island_id === 'island:704'));
		return {
			code: route.route_code,
			sourceVertices: route.geometry.coordinates.length,
			ferrySeconds,
			ferryEndpoint,
			inspectorType
		};
	});
	await check(
		'Kadhdhoo airport and northbound flight retain the correct island and air source',
		async () => {
			await page.keyboard.press('ArrowRight');
			await expectStep(3, 'island:706');
			await expect(details().getByRole('heading', { name: 'Kadhdhoo', exact: true })).toBeVisible();
			await expect(
				details().getByRole('region', { name: 'Island access index', exact: true })
			).toBeVisible();
			await expect(
				details().getByRole('region', { name: 'Island access index', exact: true })
			).toContainText('Limited evidence');
			await expect(details().getByTestId('island-overview-score')).toContainText('11.1');
			await expect(
				details()
					.getByRole('region', { name: 'Island access index', exact: true })
					.locator('[data-domain="transport"]')
			).toContainText('33.3');
			await expect(
				details().getByRole('region', { name: 'Island connections', exact: true })
			).toContainText('Airport');
			const airportCoverageCells = await positiveCount('data-policy-coverage-fill-cells');
			await settled();
			await frozenClocks();
			await clocksClearOf(details());
			assert.equal(
				Number(await arrivalClock().getAttribute('data-elapsed-seconds')),
				evidence['presentation:ferry-seconds']
			);
			await page.screenshot({ path: path.join(output, 'desktop-kadhdhoo.png'), fullPage: true });
			await page.keyboard.press('ArrowRight');
			await expectStep(4, 'island:706');
			await positiveCount('data-presentation-paths');
			await expect(atlas.locator('.map-air-route-popup')).toBeVisible();
			await expect(
				atlas
					.locator('.map-air-route-popup')
					.getByRole('heading', { name: 'Kadhdhoo → Velana', exact: true })
			).toBeVisible();
			await expect(atlas.locator('.map-air-route-popup .presentation-route-summary')).toContainText(
				'Estimated flight'
			);
			await expect(atlas.locator('.map-air-route-popup .presentation-route-summary')).toContainText(
				'50 min'
			);
			await expect(atlas).toHaveAttribute('data-air-selected-route', 'maldivian-mle-kdo');
			await frozenClocks();
			assert.equal(
				Number(await arrivalClock().getAttribute('data-elapsed-seconds')),
				evidence['presentation:ferry-seconds']
			);
			const inspectorType = await readableInspector('.map-air-route-popup');
			await clocksClearOf(atlas.locator('.map-air-route-popup'));
			await page.screenshot({
				path: path.join(output, 'desktop-flight-inspector.png'),
				fullPage: true
			});
			await sourceDisclosure('.map-air-route-popup', 'Route details');
			await page.keyboard.press('ArrowRight');
			await expectStep(5, 'island:706');
			await expect(atlas).toHaveAttribute('data-presentation-progress', '1.000');
			await frozenClocks();
			const arrivalSeconds = Number(await arrivalClock().getAttribute('data-elapsed-seconds'));
			assert.ok(arrivalSeconds > Number(evidence['presentation:ferry-seconds']));
			assert.ok(
				Math.abs(
					arrivalSeconds - Number(await arrivalClock().getAttribute('data-total-seconds'))
				) <= 1,
				'A completed arrival clock should match its rounded total within one second'
			);
			await expect(atlas).toHaveAttribute('data-presentation-airplane-image-ready', 'true');
			const airplaneImage = await page.evaluate(async () => {
				const image = new Image();
				image.src = '/images/scenario-airplane.png';
				await image.decode();
				const canvas = new OffscreenCanvas(image.width, image.height);
				const context = canvas.getContext('2d');
				if (!context) throw new Error('A canvas context is required to verify PNG transparency');
				context.drawImage(image, 0, 0);
				return {
					width: image.width,
					height: image.height,
					cornerAlpha: context.getImageData(0, 0, 1, 1).data[3]
				};
			});
			assert.ok(airplaneImage.width > 0 && airplaneImage.height > 0);
			assert.equal(
				airplaneImage.cornerAlpha,
				0,
				'The airplane PNG must retain a transparent background'
			);
			await page.screenshot({ path: path.join(output, 'desktop-flight.png'), fullPage: true });
			const air =
				/** @type {{routes:Array<{id:string,bidirectional:boolean,geometry:{coordinates:number[][]}|null}>}} */ (
					evidence['planning/air-network']
				);
			const route = air.routes.find((item) => item.id === 'maldivian-mle-kdo');
			assert.ok(route?.bidirectional && route.geometry?.coordinates.length);
			return {
				route: route.id,
				sourceVertices: route.geometry.coordinates.length,
				airportCoverageCells,
				inspectorType,
				airplaneImage,
				arrivalSeconds
			};
		}
	);
	await check('Hulhumalé transport and population stages reuse the resident model', async () => {
		await page.keyboard.press('ArrowRight');
		await expectStep(6, 'island:1442');
		const gapCells = await positiveCount('data-policy-gap-cells');
		await expect(atlas).toHaveAttribute('data-policy-lens', 'transport');
		await expect(details().getByRole('heading', { name: 'Hulhumalé', exact: true })).toBeVisible();
		await settled();
		await frozenClocks();
		await clocksClearOf(details());
		evidence['presentation:hulhumale-access-camera'] = await camera();
		await page.screenshot({ path: path.join(output, 'desktop-access.png'), fullPage: true });
		await page.keyboard.press('ArrowRight');
		await expectStep(7, 'island:1442');
		const populationCells = await positiveCount('data-presentation-population');
		await expect(atlas).toHaveAttribute('data-policy-gap-cells', '0');
		await expect(presenter).toContainText('Modeled residents');
		await expect(
			details().getByRole('region', { name: 'Island population', exact: true })
		).toBeInViewport();
		await settled();
		await frozenClocks();
		await clocksClearOf(details());
		await page.screenshot({ path: path.join(output, 'desktop-population.png'), fullPage: true });
		return { gapCells, populationCells };
	});
	await check('Walk and airport bus playback use the calculated itinerary', async () => {
		await page.keyboard.press('ArrowRight');
		await expectStep(8, 'island:1442');
		const walkingPaths = await positiveCount('data-presentation-paths');
		await expect(atlas).toHaveAttribute('data-presentation-progress', '1.000');
		await frozenClocks();
		const walkSeconds = Number(await pickupClock().getAttribute('data-elapsed-seconds'));
		assert.ok(walkSeconds > 0);
		await page.keyboard.press('ArrowRight');
		await expectStep(9, 'island:1442');
		const journeyPaths = await positiveCount('data-presentation-paths');
		await expect(atlas).toHaveAttribute('data-presentation-progress', '1.000');
		await frozenClocks();
		const pickupSeconds = Number(await pickupClock().getAttribute('data-elapsed-seconds'));
		assert.ok(pickupSeconds > walkSeconds);
		assert.ok(
			Math.abs(pickupSeconds - Number(await pickupClock().getAttribute('data-total-seconds'))) <= 1,
			'A completed pickup clock should match its rounded total within one second'
		);
		const minimumLatitude = Number(await atlas.getAttribute('data-presentation-min-latitude'));
		await expect(atlas).toHaveAttribute('data-presentation-points-in-male', '0');
		const journey =
			/** @type {{status:string,segments:Array<{result:{journey:{legs:Array<{mode:string,route_id?:string,from:{island_id?:string|null},to:{island_id?:string|null},stops:Array<{island_id?:string|null}>,geometry:number[][]}>}}|null}>}} */ (
				evidence['routing/journey']
			);
		assert.equal(journey.status, 'ok');
		const legs = journey.segments.flatMap((segment) => segment.result?.journey?.legs ?? []);
		assert.ok(legs.some((leg) => leg.mode === 'bus' && leg.geometry.length > 1));
		assert.ok(legs.some((leg) => leg.mode === 'walk' && leg.geometry.length > 1));
		const busLegs = legs.filter((leg) => leg.mode === 'bus');
		assert.ok(busLegs.every((leg) => leg.route_id === 'rtl:route:129'));
		assert.ok(
			legs.every((leg) =>
				[leg.from, leg.to, ...leg.stops].every((stop) => stop.island_id !== 'island:1443')
			),
			'The direct airport itinerary must not transfer through Malé'
		);
		await page.screenshot({ path: path.join(output, 'desktop-bus.png'), fullPage: true });
		return {
			walkingPaths,
			journeyPaths,
			minimumLatitude,
			walkSeconds,
			pickupSeconds,
			modes: legs.map((leg) => leg.mode)
		};
	});
	await check(
		'Closer-stop comparison uses evaluated cells and restores the prior map on exit',
		async () => {
			await page.keyboard.press('ArrowRight');
			await expectStep(10, 'island:1442');
			await settled();
			await expect(presenter.getByRole('button', { name: 'Before', exact: true })).toHaveAttribute(
				'aria-pressed',
				'true'
			);
			await expect(atlas).toHaveAttribute('data-policy-impact-view', 'before');
			await expect(atlas).toHaveAttribute('data-policy-proposal-points', '0');
			await expect(atlas).toHaveAttribute('data-presentation-source-paths', '0');
			const comparisonCamera = await camera();
			const outcome = await comparisonMetric();
			const originPosition = await comparisonOriginInViewport();
			await presenter.getByRole('button', { name: 'Closer stop', exact: true }).click();
			await expect(atlas).toHaveAttribute('data-policy-impact-view', 'after');
			const comparisonCells = await positiveCount('data-policy-impact-cells');
			const proposalPoints = await positiveCount('data-policy-proposal-points');
			const changedCells = await positiveCount('data-policy-comparison-changed-cells');
			const marker = atlas.locator('.policy-proposal-marker').first();
			await expect(marker).toBeInViewport();
			await expect(marker).toHaveAttribute('aria-disabled', 'true');
			await expect(marker).toHaveAttribute('tabindex', '-1');
			await expect(marker).toHaveCSS('pointer-events', 'none');
			await marker.evaluate((element) =>
				element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
			);
			await expect(page.getByTestId('proposal-marker-actions')).toHaveCount(0);
			await atlas.locator('.maplibregl-canvas').click({ position: { x: 1000, y: 300 } });
			await expectStep(10, 'island:1442');
			await expect(atlas.locator('.map-footer')).toBeHidden();
			await frozenClocks();
			await expect(page.getByTestId('map-controls-dock')).toBeHidden();
			await settled();
			unchangedCamera(comparisonCamera, await camera());
			const accessCamera = /** @type {{zoom:number}} */ (
				evidence['presentation:hulhumale-access-camera']
			);
			assert.ok(
				comparisonCamera.zoom > accessCamera.zoom + 0.25,
				'The final comparison must focus more closely on the affected neighbourhood'
			);
			await presenter.getByRole('button', { name: 'Before', exact: true }).click();
			await expect(presenter.getByRole('button', { name: 'Before', exact: true })).toHaveAttribute(
				'aria-pressed',
				'true'
			);
			await expect(atlas).toHaveAttribute('data-policy-impact-view', 'before');
			await expect(atlas).toHaveAttribute('data-policy-proposal-points', '0');
			await expect(atlas).toHaveAttribute('data-presentation-source-paths', '0');
			await page.waitForTimeout(350);
			unchangedCamera(comparisonCamera, await camera());
			await page.screenshot({
				path: path.join(output, 'desktop-comparison-before.png'),
				fullPage: true
			});
			await presenter.getByRole('button', { name: 'Closer stop', exact: true }).click();
			await expect(atlas).toHaveAttribute('data-policy-impact-view', 'after');
			const feederPaths = await positiveCount('data-presentation-source-paths');
			await page.waitForTimeout(350);
			unchangedCamera(comparisonCamera, await camera());
			await Promise.all(responseReads);
			assert.ok(evidence['planning/evaluate']);
			await page.screenshot({
				path: path.join(output, 'desktop-comparison-after.png'),
				fullPage: true
			});
			await presenter.getByRole('button', { name: 'Exit scenario', exact: true }).click();
			await expect(presenter).toHaveCount(0);
			await expect(scope).toHaveAttribute('data-island-id', 'island:1443');
			await expect(atlas).toHaveAttribute('data-presentation-key', '');
			await expect(atlas).toHaveAttribute('data-presentation-population', '0');
			await expect(page.getByRole('button', { name: 'Directions', exact: true })).toBeVisible();
			await expect(page.getByRole('navigation', { name: 'Workspace', exact: true })).toBeVisible();
			await expect(scope).toBeVisible();
			await expect(page.getByRole('button', { name: 'Start scenario', exact: true })).toBeFocused();
			assert.deepEqual(
				await page.evaluate(() =>
					JSON.parse(localStorage.getItem('mobility-v2-scenario') ?? 'null')
				),
				savedScenario
			);
			return {
				comparisonCells,
				proposalPoints,
				changedCells,
				feederPaths,
				comparisonCamera,
				outcome,
				originPosition
			};
		}
	);
	await check(
		'Shortcut restart, replay and Escape work without automatic stage advancement',
		async () => {
			await page.locator('body').click({ position: { x: 5, y: 5 } });
			await page.keyboard.press('Shift+S');
			await expectStep(0, 'island:697');
			await page.keyboard.press('ArrowRight');
			await page.keyboard.press('ArrowRight');
			await expectStep(2, 'island:697');
			await page.keyboard.press('r');
			await expect(atlas).toHaveAttribute('data-presentation-key', '2:1');
			await expect(atlas).toHaveAttribute('data-presentation-progress', '1.000');
			await page.keyboard.press('Escape');
			await expect(presenter).toHaveCount(0);
			await expect(scope).toHaveAttribute('data-island-id', 'island:1443');
		}
	);
	await check('Tablet journey clocks stay beside native island and route panels', async () => {
		await page.setViewportSize({ width: 1024, height: 900 });
		await page.getByRole('button', { name: 'Start scenario', exact: true }).click();
		await expectStep(0, 'island:697');
		await settled();
		await visibleClocks();
		await clocksClearOf(details());
		await noOverflow();
		await page.screenshot({ path: path.join(output, 'tablet-start.png'), fullPage: true });
		await page.keyboard.press('ArrowRight');
		await expectStep(1, 'island:697');
		await settled();
		await expect(atlas.locator('.map-sea-route-popup')).toBeInViewport();
		await clocksClearOf(atlas.locator('.map-sea-route-popup'));
		await frozenClocks();
		await noOverflow();
		await page.screenshot({
			path: path.join(output, 'tablet-ferry-inspector.png'),
			fullPage: true
		});
		for (let step = 2; step <= 10; step++) {
			await page.keyboard.press('ArrowRight');
			await expectStep(step, step <= 2 ? 'island:697' : step <= 5 ? 'island:706' : 'island:1442');
			await settled();
		}
		const tabletComparisonCamera = await camera();
		await comparisonMetric();
		await comparisonOriginInViewport();
		await presenter.getByRole('button', { name: 'Before', exact: true }).click();
		await expect(atlas).toHaveAttribute('data-policy-impact-view', 'before');
		await page.waitForTimeout(350);
		unchangedCamera(tabletComparisonCamera, await camera());
		await page.screenshot({
			path: path.join(output, 'tablet-comparison-before.png'),
			fullPage: true
		});
		await presenter.getByRole('button', { name: 'Closer stop', exact: true }).click();
		await expect(atlas).toHaveAttribute('data-policy-impact-view', 'after');
		await page.waitForTimeout(350);
		unchangedCamera(tabletComparisonCamera, await camera());
		await noOverflow();
		await page.screenshot({
			path: path.join(output, 'tablet-comparison-after.png'),
			fullPage: true
		});
		await page.keyboard.press('Escape');
		await expect(presenter).toHaveCount(0);
		return { viewport: 1024 };
	});
	await check(
		'Phone presenter keeps next/back and exit controls reachable without horizontal overflow',
		async () => {
			await page.setViewportSize({ width: 390, height: 844 });
			await page.getByRole('button', { name: 'Start scenario', exact: true }).click();
			await expectStep(0, 'island:697');
			await expect(presenter).toHaveAttribute('aria-busy', 'false', { timeout: 180000 });
			for (let step = 0; step < 11; step++) {
				await expect(presenter).toHaveAttribute('data-step', String(step));
				await expect(
					presenter.getByRole('button', { name: 'Exit scenario', exact: true })
				).toBeInViewport();
				const next = presenter.getByRole('button', {
					name: step === 10 ? 'Finish scenario' : 'Next scenario step',
					exact: true
				});
				await next.scrollIntoViewIfNeeded();
				await expect(next).toBeInViewport();
				await noOverflow();
				await presentationChromeHidden();
				await visibleClocks();
				await settled();
				if ([0, 3, 6, 7].includes(step)) await clocksClearOf(details());
				if (step === 1) await clocksClearOf(atlas.locator('.map-sea-route-popup'));
				if (step === 4) await clocksClearOf(atlas.locator('.map-air-route-popup'));
				if ([0, 1, 4, 6, 10].includes(step)) {
					if (step === 1) await expect(atlas.locator('.map-sea-route-popup')).toBeInViewport();
					if (step === 4) await expect(atlas.locator('.map-air-route-popup')).toBeInViewport();
					await page.screenshot({
						path: path.join(output, `mobile-step-${step + 1}.png`),
						fullPage: true
					});
				}
				if (step === 10) {
					const phoneComparisonCamera = await camera();
					await comparisonMetric();
					await comparisonOriginInViewport();
					await presenter.getByRole('button', { name: 'Before', exact: true }).click();
					await expect(atlas).toHaveAttribute('data-policy-impact-view', 'before');
					await page.waitForTimeout(350);
					unchangedCamera(phoneComparisonCamera, await camera());
					await page.screenshot({
						path: path.join(output, 'mobile-comparison-before.png'),
						fullPage: true
					});
					await presenter.getByRole('button', { name: 'Closer stop', exact: true }).click();
					await expect(atlas).toHaveAttribute('data-policy-impact-view', 'after');
					await page.waitForTimeout(350);
					unchangedCamera(phoneComparisonCamera, await camera());
					await page.screenshot({
						path: path.join(output, 'mobile-comparison-after.png'),
						fullPage: true
					});
				}
				if (step < 10) await next.click();
			}
			await presenter.getByRole('button', { name: 'Previous scenario step' }).click();
			await expectStep(9, 'island:1442');
			await page.keyboard.press('Escape');
			await expect(presenter).toHaveCount(0);
			return noOverflow();
		}
	);
	await check(
		'Normal-motion vehicles advance, canvas shortcuts change steps and exit cancels playback',
		async () => {
			await page.setViewportSize({ width: 1440, height: 1000 });
			await page.emulateMedia({ reducedMotion: 'no-preference' });
			await page.getByRole('button', { name: 'Start scenario', exact: true }).click();
			await expectStep(0, 'island:697');
			await expect(presenter).toHaveAttribute('aria-busy', 'false', { timeout: 180000 });
			await page.keyboard.press('ArrowRight');
			await page.keyboard.press('ArrowRight');
			await expectStep(2, 'island:697');
			await expect(atlas).toHaveAttribute('data-presentation-phase', /entering|playing/);
			await expect(atlas).toHaveAttribute('data-presentation-animating', 'true');
			await expect(atlas).toHaveAttribute('data-presentation-following', 'true');
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-presentation-progress')))
				.toBeGreaterThan(0.05);
			const ferryProgress = Number(await atlas.getAttribute('data-presentation-progress'));
			assert.ok(ferryProgress < 1);
			await page.screenshot({
				path: path.join(output, 'desktop-ferry-motion.png'),
				fullPage: true
			});
			await visibleClocks();
			await expect(arrivalClock()).toHaveAttribute('data-running', 'true');
			const arrivalDuringFerry = Number(await arrivalClock().getAttribute('data-elapsed-seconds'));
			assert.ok(arrivalDuringFerry > 0);
			await page.mouse.move(620, 600);
			await page.mouse.down();
			await expect(atlas).toHaveAttribute('data-presentation-following', 'false');
			await expect(atlas).toHaveAttribute('data-presentation-phase', 'paused');
			await expect(atlas).toHaveAttribute('data-presentation-animating', 'false');
			const pausedProgress = await atlas.getAttribute('data-presentation-progress');
			const pausedClock = await arrivalClock().getAttribute('data-elapsed-seconds');
			const gestureStart = [
				Number(await atlas.getAttribute('data-center-longitude')),
				Number(await atlas.getAttribute('data-center-latitude'))
			];
			await page.mouse.move(700, 640, { steps: 12 });
			await page.mouse.up();
			await expect(atlas).toHaveAttribute('data-presentation-following', 'false');
			await page.waitForTimeout(1600);
			const pannedCenter = [
				Number(await atlas.getAttribute('data-center-longitude')),
				Number(await atlas.getAttribute('data-center-latitude'))
			];
			await page.waitForTimeout(500);
			const heldCenter = [
				Number(await atlas.getAttribute('data-center-longitude')),
				Number(await atlas.getAttribute('data-center-latitude'))
			];
			assert.ok(
				Math.hypot(pannedCenter[0] - gestureStart[0], pannedCenter[1] - gestureStart[1]) > 0.001,
				'The manual drag must move the camera'
			);
			assert.deepEqual(heldCenter, pannedCenter, 'A manual pan should retain camera control');
			await expect(atlas).toHaveAttribute('data-presentation-progress', pausedProgress ?? '');
			await expect(arrivalClock()).toHaveAttribute('data-elapsed-seconds', pausedClock ?? '');
			await frozenClocks();
			await atlas.locator('.maplibregl-canvas').focus();
			await page.keyboard.press('r');
			await expect(atlas).toHaveAttribute('data-presentation-key', '2:1');
			await expect(atlas).toHaveAttribute('data-presentation-following', 'true');
			await expect(atlas).toHaveAttribute('data-presentation-animating', 'true');
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-presentation-progress')))
				.toBeGreaterThan(0.01);
			await expect(arrivalClock()).toHaveAttribute('data-running', 'true');
			await page.keyboard.press('ArrowRight');
			await expectStep(3, 'island:706');
			await expect(atlas).toHaveAttribute('data-presentation-animating', 'false');
			await expect(atlas).toHaveAttribute('data-presentation-progress', '0.000');
			const afterFerry = await frozenClocks();
			assert.ok(Number(afterFerry[0]) >= arrivalDuringFerry);
			await page.keyboard.press('ArrowRight');
			await logScene('Motion next to flight inspector');
			await expectStep(4, 'island:706');
			await page.keyboard.press('ArrowRight');
			await logScene('Motion next to flight');
			await expectStep(5, 'island:706');
			await expect(atlas).toHaveAttribute('data-presentation-phase', /entering|playing/);
			await page.keyboard.press('ArrowLeft');
			await logScene('Motion back to flight inspector');
			await expectStep(4, 'island:706');
			await expect(atlas).toHaveAttribute('data-presentation-animating', 'false');
			await logScene('Motion flight inspector reset');
			await page.keyboard.press('ArrowRight');
			await expectStep(5, 'island:706');
			await expect(atlas).toHaveAttribute('data-presentation-animating', 'true');
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-presentation-progress')))
				.toBeGreaterThan(0.05);
			await page.screenshot({
				path: path.join(output, 'desktop-flight-motion.png'),
				fullPage: true
			});
			await visibleClocks();
			await expect(arrivalClock()).toHaveAttribute('data-running', 'true');
			await expect(atlas).toHaveAttribute('data-route-vehicles', '0');
			const flightKey = await atlas.getAttribute('data-presentation-key');
			assert.ok(flightKey);
			const flightReplay = Number(flightKey.split(':')[1]) + 1;
			await presenter.getByRole('button', { name: 'Replay scenario step' }).click();
			await expect(atlas).toHaveAttribute('data-presentation-key', `5:${flightReplay}`);
			await expect(atlas).toHaveAttribute('data-presentation-phase', /entering|playing/);
			await page.keyboard.press('Escape');
			await expect(presenter).toHaveCount(0);
			await expect(atlas).toHaveAttribute('data-presentation-key', '');
			await expect(atlas).toHaveAttribute('data-presentation-paths', '0');
			await expect(atlas).toHaveAttribute('data-presentation-progress', '0.000');
			await expect(atlas).toHaveAttribute('data-presentation-animating', 'false');
			return { ferryProgress, pausedProgress, pausedClock, gestureStart, pannedCenter, heldCenter };
		}
	);
	await check(
		'An open ferry inspector refreshes when delayed crossing timing arrives',
		async () => {
			const delayedContext = await browser.newContext({
				viewport: { width: 1440, height: 1000 },
				reducedMotion: 'reduce'
			});
			const delayedPage = await delayedContext.newPage();
			delayedPage.setDefaultTimeout(90000);
			delayedPage.on('pageerror', (error) => report.errors.push(error.message));
			/** @type {()=>void} */
			let releaseTiming = () => {};
			const timingGate = new Promise((resolve) => {
				releaseTiming = () => resolve(undefined);
			});
			let timingRequested = false;
			await delayedPage.route('**/api/backend/planning/sea-connections', async (route) => {
				const payload = route.request().postDataJSON();
				if (payload?.origin_island_id === 'island:697') {
					timingRequested = true;
					await timingGate;
				}
				await route.continue().catch(() => {});
			});
			try {
				await delayedPage.goto(`${baseURL}/?view=map&tool=explore&island=island%3A1442`);
				await delayedPage.getByRole('button', { name: 'Start scenario', exact: true }).click();
				const delayedPresenter = delayedPage.getByRole('region', {
					name: 'Scenario presentation',
					exact: true
				});
				await delayedPresenter
					.getByRole('button', { name: 'Next scenario step', exact: true })
					.click();
				const popup = delayedPage.locator('.map-sea-route-popup');
				await expect(popup).toBeVisible();
				await expect.poll(() => timingRequested).toBe(true);
				const estimate = popup.locator('.sea-route-summary > dt', {
					hasText: 'Estimated crossing'
				});
				await expect(estimate.locator('+ dd')).toHaveText('Unavailable');
				const beforeKey = await delayedPage
					.locator('.national-map')
					.getAttribute('data-presentation-key');
				releaseTiming();
				await expect(estimate.locator('+ dd')).toHaveText('35 min');
				await expect(delayedPresenter).toHaveAttribute('data-step', '1');
				await expect(delayedPage.locator('.national-map')).toHaveAttribute(
					'data-presentation-key',
					beforeKey ?? ''
				);
				await delayedPage.screenshot({
					path: path.join(output, 'desktop-delayed-ferry-timing.png'),
					fullPage: true
				});
				return { initialEstimate: 'Unavailable', updatedEstimate: '35 min', key: beforeKey };
			} finally {
				releaseTiming();
				await delayedContext.close();
			}
		}
	);
	assert.deepEqual(report.errors, []);
} catch (error) {
	report.failure = error instanceof Error ? error.stack : String(error);
	await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
	process.exitCode = 1;
} finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(path.join(output, reportFilename), JSON.stringify(report, null, 2));
	await browser.close();
}
