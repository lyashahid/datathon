import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';
import { browserBaseURL } from './browser-config.mjs';

const baseURL = browserBaseURL();
const selectedCheck = process.env.MOBILITY_QA_CHECK;
const selectedChecks = selectedCheck?.split('|').map((name) => name.trim());
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
const scenes = [
	{ island: 'island:640', kind: 'island', chapter: 1, title: 'Baarah, Haa Alifu' },
	{
		island: 'island:640',
		destination: 'island:611',
		kind: 'ferry-travel',
		chapter: 2,
		title: 'Ferry to Vashafaru'
	},
	{ island: 'island:611', kind: 'island', chapter: 2, title: 'Vashafaru, Haa Alifu' },
	{
		island: 'island:611',
		destination: 'island:625',
		kind: 'ferry-travel',
		chapter: 2,
		title: 'Ferry to Dhidhdhoo'
	},
	{ island: 'island:625', kind: 'island', chapter: 2, title: 'Dhidhdhoo, Haa Alifu' },
	{
		island: 'island:625',
		destination: 'island:684',
		kind: 'ferry-travel',
		chapter: 2,
		title: 'Ferry to Hanimaadhoo'
	},
	{ island: 'island:684', kind: 'airport', chapter: 3, title: 'Hanimaadhoo Airport' },
	{
		island: 'island:684',
		destination: 'island:1442',
		kind: 'flight-travel',
		chapter: 3,
		title: 'Landing at Velana'
	},
	{ island: 'island:1442', kind: 'access', chapter: 4, title: 'The last few kilometres' },
	{ island: 'island:1442', kind: 'population', chapter: 4, title: 'People behind the map' },
	{ island: 'island:1442', kind: 'walk', chapter: 5, title: 'The walk to a bus' },
	{ island: 'island:1442', kind: 'bus', chapter: 5, title: 'The bus to the airport' }
];
const lastStep = scenes.length - 1;
const accessStep = scenes.findIndex((scene) => scene.kind === 'access');
const airportStep = scenes.findIndex((scene) => scene.kind === 'airport');
const flightStep = scenes.findIndex((scene) => scene.kind === 'flight-travel');
const walkStep = scenes.findIndex((scene) => scene.kind === 'walk');
const ferryLegs = [
	{
		travel: 1,
		from: 'Baarah',
		to: 'Vashafaru',
		code: 'S1C5',
		minutes: 15,
		waitMinutes: 1420,
		endpoint: [73.16241, 6.89618]
	},
	{
		travel: 3,
		from: 'Vashafaru',
		to: 'Dhidhdhoo',
		code: 'S1C5',
		minutes: 10,
		waitMinutes: 5,
		endpoint: [73.11511, 6.8881]
	},
	{
		travel: 5,
		from: 'Dhidhdhoo',
		to: 'Hanimaadhoo',
		code: 'S1C6',
		minutes: 25,
		waitMinutes: 170,
		endpoint: [73.17379, 6.76686]
	}
];
/** @type {Record<string, unknown>} */
const evidence = {};
/** @type {Promise<void>[]} */
const responseReads = [];
page.on('response', (response) => {
	const endpoint = new URL(response.url()).pathname.split('/api/backend/')[1];
	if (
		(![
			'planning/sea-network',
			'planning/air-network',
			'routing/journey',
			'planning/bus-connection'
		].includes(endpoint) &&
			!endpoint?.startsWith('planning/opportunities/')) ||
		!response.ok()
	)
		return;
	responseReads.push(
		response
			.json()
			.then((value) => {
				if (endpoint.startsWith('planning/opportunities/')) {
					const islandId = decodeURIComponent(endpoint.split('/').at(-1) ?? '');
					evidence[`presentation:layers:${islandId}`] = {
						gaps:
							value.hex_grid?.features?.length ||
							(value.gap_cells ?? value.features)?.features?.length ||
							0,
						coverage: value.coverage_fill?.features?.length ?? 0
					};
				} else evidence[endpoint] = value;
			})
			.catch(() => {})
	);
});

/** @param {string} name @param {()=>Promise<unknown>} action */
async function check(name, action) {
	if (selectedChecks && !selectedChecks.some((selection) => name.includes(selection))) return;
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

/** @param {number} step */
async function expectStep(step) {
	await expect(presenter).toHaveAttribute('data-step', String(step));
	await expect(presenter).toHaveAttribute('data-chapter', String(scenes[step].chapter));
	await expect(presenter).toHaveAttribute('data-scene', scenes[step].kind);
	await expect(atlas).toHaveAttribute('data-presentation-key', new RegExp(`^${step}:`));
	await expect(scope).toHaveAttribute(
		'data-island-id',
		new RegExp(`^(${scenes[step].island}|${scenes[step].destination ?? scenes[step].island})$`)
	);
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
/** @param {string} name */
async function islandStats(name) {
	await expect(details().getByRole('heading', { name, exact: true })).toBeVisible();
	await expect(
		details().getByRole('region', { name: 'Island access index', exact: true })
	).toBeVisible();
}
/** @param {string} islandId */
async function islandMapLayers(islandId) {
	await Promise.all(responseReads);
	const expected = /** @type {{gaps:number,coverage:number}|undefined} */ (
		evidence[`presentation:layers:${islandId}`]
	);
	assert.ok(expected, `The ${islandId} heatmap response must be available`);
	await expect(scope).toHaveAttribute('data-island-id', islandId);
	await expect(atlas).toHaveAttribute('data-presentation-island-id', islandId);
	await expect(atlas).toHaveAttribute('data-presentation-gap-count', String(expected.gaps));
	await expect(atlas).toHaveAttribute(
		'data-presentation-coverage-count',
		String(expected.coverage)
	);
	return expected;
}
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
	for (const clock of [arrivalClock(), pickupClock()]) {
		await expect(clock.locator('.clock-value > strong')).toHaveText(
			/^(?:\d+d )?\d+(?:h \d{2}m| min)\+?$/
		);
	}
	const step = Number(await presenter.getAttribute('data-step'));
	await expect(arrivalClock()).toHaveAttribute('data-active', String(step < accessStep));
	await expect(pickupClock()).toHaveAttribute('data-active', String(step >= accessStep));
	const active = step < accessStep ? arrivalClock() : pickupClock();
	const secondary = step < accessStep ? pickupClock() : arrivalClock();
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

/** Read the brief moving state in one browser turn before slower layout checks. */
async function motionSnapshot() {
	const sample = await page.waitForFunction(() => {
		const map = document.querySelector('.national-map');
		const progress = Number(map?.getAttribute('data-presentation-progress'));
		if (
			map?.getAttribute('data-presentation-phase') !== 'playing' ||
			map.getAttribute('data-presentation-stationary') === 'true' ||
			progress <= 0.05 ||
			progress >= 0.95
		)
			return null;
		const vehicle = map.querySelector('.presentation-vehicle-marker');
		const tail = vehicle?.querySelector('.presentation-motion-tail');
		const panel = document.querySelector('[aria-label="Scenario island details"]');
		const ferry = panel?.querySelector('[aria-label="Ferry connection"]');
		const weeklySailings = [...(ferry?.querySelectorAll('dt') ?? [])].find(
			(element) => element.textContent?.trim() === 'Weekly sailings'
		);
		return {
			step: document
				.querySelector('[aria-label="Scenario presentation"]')
				?.getAttribute('data-step'),
			key: map.getAttribute('data-presentation-key'),
			progress,
			reused: map.getAttribute('data-presentation-reused-camera'),
			following: map.getAttribute('data-presentation-following'),
			running: document
				.querySelector('[data-testid="presentation-arrival-clock"]')
				?.getAttribute('data-running'),
			elapsedSeconds: Number(
				document
					.querySelector('[data-testid="presentation-arrival-clock"]')
					?.getAttribute('data-elapsed-seconds')
			),
			waitCue: document
				.querySelector('[data-testid="presentation-wait-included"]')
				?.textContent?.replace(/\s+/g, ' ')
				.trim(),
			panelInTransit: document
				.querySelector('[aria-label="Scenario island details"]')
				?.classList.contains('in-transit'),
			islandHeading: panel?.querySelector('h2')?.textContent?.trim(),
			accessIndexVisible: panel
				?.querySelector('[aria-label="Island access index"]')
				?.checkVisibility(),
			scopeIsland: document
				.querySelector('[data-testid="map-search-scope"]')
				?.getAttribute('data-island-id'),
			mapIsland: map.getAttribute('data-presentation-island-id'),
			gapCount: Number(map.getAttribute('data-presentation-gap-count')),
			coverageCount: Number(map.getAttribute('data-presentation-coverage-count')),
			ferryHeading: ferry?.querySelector('h3')?.textContent?.replace(/\s+/g, ' ').trim(),
			ferryText: ferry?.textContent?.replace(/\s+/g, ' ').trim(),
			ferryStage: ferry?.getAttribute('data-stage'),
			weeklySailings: weeklySailings?.nextElementSibling?.textContent?.trim(),
			airportAllowance: panel
				?.querySelector('[aria-label="Airport connection allowance"]')
				?.textContent?.replace(/\s+/g, ' ')
				.trim(),
			playbackMode: map.getAttribute('data-presentation-playback-mode'),
			pathCount: Number(map.getAttribute('data-presentation-paths')),
			seaPopupCount: map.querySelectorAll('.map-sea-route-popup').length,
			airPopupCount: map.querySelectorAll('.map-air-route-popup').length,
			vehicleMode: vehicle?.getAttribute('data-mode'),
			vehicleMoving: vehicle?.getAttribute('data-moving'),
			tailOpacity: tail ? Number(getComputedStyle(tail).opacity) : null
		};
	});
	const snapshot = await sample.jsonValue();
	assert.ok(snapshot, 'A playing vehicle must provide a motion snapshot');
	return snapshot;
}

/** @param {Awaited<ReturnType<typeof motionSnapshot>>} motion @param {string} name @param {string} islandId */
function departureSnapshot(motion, name, islandId) {
	assert.equal(motion.islandHeading, name);
	assert.equal(motion.accessIndexVisible, true, 'The departure access index must remain visible');
	assert.equal(motion.scopeIsland, islandId);
	assert.equal(motion.mapIsland, islandId);
	const expected = /** @type {{gaps:number,coverage:number}|undefined} */ (
		evidence[`presentation:layers:${islandId}`]
	);
	assert.ok(expected, `The ${islandId} heatmap response must be available`);
	assert.equal(motion.gapCount, expected.gaps);
	assert.equal(motion.coverageCount, expected.coverage);
}

async function arrivedTreatment() {
	const focus = page.getByTestId('presentation-arrival-focus');
	await expect(focus).toHaveCount(1);
	const pulse = await focus.evaluate((element) => {
		const style = getComputedStyle(element, '::after');
		return {
			name: style.animationName,
			iterations: style.animationIterationCount,
			seconds: Number.parseFloat(style.animationDuration)
		};
	});
	assert.notEqual(pulse.name, 'none', 'A normal-motion arrival must have a destination pulse');
	assert.equal(pulse.iterations, '1', 'The destination pulse must finish rather than loop');
	assert.ok(pulse.seconds > 0 && pulse.seconds <= 1, 'The arrival pulse must remain brief');
	await expect(atlas).toHaveAttribute('data-presentation-access-reveal', '1.000');
}

/** @param {{longitude:number,latitude:number,zoom:number}} before @param {{longitude:number,latitude:number,zoom:number}} after */
function unchangedCamera(before, after) {
	for (const property of /** @type {const} */ (['longitude', 'latitude', 'zoom'])) {
		assert.ok(
			Math.abs(before[property] - after[property]) < 0.000001,
			`The lens change must keep the same ${property}: ${before[property]} → ${after[property]}`
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
			await input.press('Shift+P');
			await expect(presenter).toHaveCount(0);
			await input.fill('');
			await input.press('Escape');
			await page.getByRole('button', { name: 'Start scenario', exact: true }).click();
			await expectStep(0);
			console.log('READY Baarah scenario entered; awaiting shared data');
			await expect(presenter).toHaveAttribute('aria-busy', 'false', { timeout: 180000 });
			console.log('READY Shared scenario data settled');
			await expect(details().getByRole('heading', { name: 'Baarah', exact: true })).toBeVisible();
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
			const secondaryDetails = details().locator('details.presentation-details');
			const secondaryToggle = secondaryDetails.locator(':scope > summary');
			await expect(secondaryToggle).toHaveText('Connections, services & data');
			await expect(secondaryDetails).toHaveJSProperty('open', false);
			await expect(details().getByTestId('island-overview-population')).toBeHidden();
			await page.screenshot({ path: path.join(output, 'desktop-start.png'), fullPage: true });
			await secondaryToggle.focus();
			await secondaryToggle.press('Enter');
			await expect(secondaryDetails).toHaveJSProperty('open', true);
			await expect(details().getByTestId('island-overview-population')).toBeVisible();
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
	await check(
		'Ferry crossings start immediately and retain waiting totals and destination map layers',
		async () => {
			await page.setViewportSize({ width: 1440, height: 1000 });
			await page.emulateMedia({ reducedMotion: 'no-preference' });
			if ((await presenter.count()) === 0) {
				await page.getByRole('button', { name: 'Start scenario', exact: true }).click();
				await expectStep(0);
				await expect(presenter).toHaveAttribute('aria-busy', 'false', { timeout: 180000 });
			}
			await settled();
			let cumulativeMinutes = 0;
			const crossings = [];
			for (const leg of ferryLegs) {
				if (leg.travel > 1) {
					await page.keyboard.press('ArrowRight');
					await expectStep(leg.travel - 1);
					await islandStats(leg.from);
					await settled();
					await frozenClocks();
				}
				await next().click();
				const motion = await motionSnapshot();
				assert.equal(motion.step, String(leg.travel));
				assert.equal(motion.following, 'true');
				assert.equal(motion.running, 'true');
				assert.ok(
					motion.elapsedSeconds >= (cumulativeMinutes + leg.waitMinutes) * 60,
					'The clock must include the departure wait as soon as the ferry starts moving'
				);
				departureSnapshot(motion, leg.from, scenes[leg.travel].island);
				assert.ok(motion.ferryHeading?.includes(leg.from));
				assert.ok(motion.ferryHeading?.includes(leg.to));
				assert.ok(motion.ferryText?.includes(`${leg.minutes} min`));
				assert.equal(motion.weeklySailings, '6');
				assert.equal(motion.ferryStage, 'ferry');
				assert.equal(motion.seaPopupCount, 0);
				if (leg.travel === 1) {
					assert.match(motion.ferryText ?? '', /11 Oct|2026-10-11/);
					await page.screenshot({
						path: path.join(output, 'desktop-ferry-crossing.png'),
						fullPage: true
					});
				}
				await settled();
				await expectStep(leg.travel);
				await islandStats(leg.to);
				const destination = scenes[leg.travel].destination;
				assert.ok(destination, 'A ferry travel scene must declare its destination island');
				const layers = await islandMapLayers(destination);
				const summary = details().getByRole('region', { name: 'Ferry connection', exact: true });
				await expect(summary).toBeVisible();
				await expect(summary).toHaveAttribute('data-stage', 'complete');
				await clocksClearOf(details());
				await frozenClocks();
				cumulativeMinutes += leg.waitMinutes + leg.minutes;
				const ferrySeconds = Number(await arrivalClock().getAttribute('data-elapsed-seconds'));
				assert.equal(ferrySeconds, cumulativeMinutes * 60);
				const endpoint = [
					Number(await atlas.getAttribute('data-presentation-end-longitude')),
					Number(await atlas.getAttribute('data-presentation-end-latitude'))
				];
				assert.ok(Math.hypot(endpoint[0] - leg.endpoint[0], endpoint[1] - leg.endpoint[1]) < 0.015);
				const source = summary.locator('details');
				await expect(source.locator(':scope > summary')).toHaveText('Source corridor details');
				await source.locator(':scope > summary').click();
				await expect(source).toHaveJSProperty('open', true);
				await expect(source).toContainText(/timetable|retained|captured|published/i);
				await source.locator(':scope > summary').click();
				await page.screenshot({
					path: path.join(output, `desktop-ferry-${leg.travel}.png`),
					fullPage: true
				});
				crossings.push({
					code: leg.code,
					waitingMinutes: leg.waitMinutes,
					ferrySeconds,
					endpoint,
					motionProgress: motion.progress,
					arrivalLayers: layers
				});
			}
			evidence['presentation:ferry-seconds'] = cumulativeMinutes * 60;
			assert.equal(cumulativeMinutes, 1645);
			await Promise.all(responseReads);
			const sea =
				/** @type {{routes:Array<{route_code:string,stops:Array<{island_id:string}>,geometry:{coordinates:number[][]}|null}>}} */ (
					evidence['planning/sea-network']
				);
			for (const code of ['S1C5', 'S1C6']) {
				const route = sea.routes.find((item) => item.route_code === code);
				assert.ok(route?.geometry?.coordinates.length);
			}
			await page.emulateMedia({ reducedMotion: 'reduce' });
			return crossings;
		}
	);
	await check(
		'Hanimaadhoo airport and southbound flight retain the correct island and air source',
		async () => {
			if ((await presenter.count()) === 0) {
				await page.getByRole('button', { name: 'Start scenario', exact: true }).click();
				await expect(presenter).toHaveAttribute('aria-busy', 'false', { timeout: 180000 });
				for (let step = 1; step < airportStep; step++) {
					await page.keyboard.press('ArrowRight');
					await expectStep(step);
					await settled();
				}
				evidence['presentation:ferry-seconds'] = Number(
					await arrivalClock().getAttribute('data-elapsed-seconds')
				);
				assert.equal(evidence['presentation:ferry-seconds'], 1645 * 60);
			}
			await page.keyboard.press('ArrowRight');
			await expectStep(airportStep);
			await expect(
				details().getByRole('heading', { name: 'Hanimaadhoo', exact: true })
			).toBeVisible();
			await expect(
				details().getByRole('region', { name: 'Island access index', exact: true })
			).toBeVisible();
			await expect(
				details().getByRole('region', { name: 'Airport connection', exact: true })
			).toContainText('HAQ');
			await expect(details().locator('details.presentation-details')).toContainText('Airport');
			const airportCoverageCells = await positiveCount('data-policy-coverage-fill-cells');
			await settled();
			await frozenClocks();
			await clocksClearOf(details());
			assert.equal(
				Number(await arrivalClock().getAttribute('data-elapsed-seconds')),
				evidence['presentation:ferry-seconds']
			);
			await page.screenshot({ path: path.join(output, 'desktop-hanimaadhoo.png'), fullPage: true });
			await page.emulateMedia({ reducedMotion: 'no-preference' });
			await page.keyboard.press('ArrowRight');
			const flightMotion = await motionSnapshot();
			assert.equal(flightMotion.step, String(flightStep));
			assert.equal(flightMotion.running, 'true');
			assert.ok(
				flightMotion.elapsedSeconds >= (1645 + 90) * 60,
				'The connection allowance remains in the clock without delaying takeoff'
			);
			assert.ok(flightMotion.pathCount > 0);
			assert.equal(flightMotion.playbackMode, 'air');
			assert.equal(flightMotion.airPopupCount, 0);
			assert.ok(flightMotion.airportAllowance?.includes('Demo assumption'));
			assert.ok(flightMotion.airportAllowance?.includes('1h 30m'));
			assert.ok(flightMotion.airportAllowance?.includes('45 min'));
			departureSnapshot(flightMotion, 'Hanimaadhoo', scenes[flightStep].island);
			await page.screenshot({
				path: path.join(output, 'desktop-flight-connection.png'),
				fullPage: true
			});
			await settled();
			await islandStats('Hulhumalé');
			const arrivalLayers = await islandMapLayers('island:1442');
			await expectStep(flightStep);
			await clocksClearOf(details());
			await frozenClocks();
			const arrivalSeconds = Number(await arrivalClock().getAttribute('data-elapsed-seconds'));
			assert.ok(arrivalSeconds > Number(evidence['presentation:ferry-seconds']));
			assert.equal(
				arrivalSeconds,
				1780 * 60,
				'Arrival must include ferry waits and the explicit flight connection'
			);
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
			const route = air.routes.find((item) => item.id === 'maldivian-mle-haq');
			assert.ok(route?.bidirectional && route.geometry?.coordinates.length);
			await page.emulateMedia({ reducedMotion: 'reduce' });
			return {
				route: route.id,
				sourceVertices: route.geometry.coordinates.length,
				airportCoverageCells,
				airplaneImage,
				arrivalSeconds,
				arrivalLayers
			};
		}
	);
	await check('Hulhumalé transport and population stages reuse the resident model', async () => {
		await page.keyboard.press('ArrowRight');
		await expectStep(accessStep);
		const gapCells = await positiveCount('data-policy-gap-cells');
		await expect(atlas).toHaveAttribute('data-policy-lens', 'transport');
		await expect(details().getByRole('heading', { name: 'Hulhumalé', exact: true })).toBeVisible();
		await settled();
		await frozenClocks();
		await clocksClearOf(details());
		await expect(
			details().getByRole('region', { name: 'Walk to the nearest bus stop', exact: true })
		).toContainText('13 min');
		await expect(presenter.getByLabel('Transport heatmap legend')).toBeVisible();
		evidence['presentation:hulhumale-access-camera'] = await camera();
		await page.screenshot({ path: path.join(output, 'desktop-access.png'), fullPage: true });
		await page.keyboard.press('ArrowRight');
		await expectStep(accessStep + 1);
		const populationCells = await positiveCount('data-presentation-population');
		await expect(atlas).toHaveAttribute('data-policy-gap-cells', '0');
		await expect(details()).toContainText('Census residents');
		await expect(
			details().getByRole('region', { name: 'Island population', exact: true })
		).toBeInViewport();
		await settled();
		await frozenClocks();
		await clocksClearOf(details());
		unchangedCamera(
			/** @type {{longitude:number,latitude:number,zoom:number}} */ (
				evidence['presentation:hulhumale-access-camera']
			),
			await camera()
		);
		await page.screenshot({ path: path.join(output, 'desktop-population.png'), fullPage: true });
		return { gapCells, populationCells };
	});
	await check('Walk and airport bus playback use the calculated itinerary', async () => {
		await page.keyboard.press('ArrowRight');
		await expectStep(walkStep);
		const walkingPaths = await positiveCount('data-presentation-paths');
		await expect(
			presenter.getByLabel('Airport journey breakdown').getByText('32 min', { exact: true })
		).toBeVisible();
		await expect(atlas).toHaveAttribute('data-presentation-progress', '1.000');
		await frozenClocks();
		const walkSeconds = Number(await pickupClock().getAttribute('data-elapsed-seconds'));
		assert.ok(walkSeconds > 0);
		await page.keyboard.press('ArrowRight');
		await expectStep(lastStep);
		const journeyPaths = await positiveCount('data-presentation-paths');
		await expect(atlas).toHaveAttribute('data-presentation-progress', '1.000');
		await frozenClocks();
		const pickupSeconds = Number(await pickupClock().getAttribute('data-elapsed-seconds'));
		assert.ok(pickupSeconds > walkSeconds);
		assert.equal(
			Math.round(pickupSeconds / 60),
			51,
			'The displayed airport journey includes walking, waiting and riding'
		);
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
	await check('Airport arrival finishes the presentation and restores the prior map', async () => {
		async function reachAirport(shortcut = 'Shift+P') {
			const start = page.getByRole('button', { name: 'Start scenario', exact: true });
			await expect(start).toBeEnabled();
			await expect(start).toHaveAttribute('title', 'Presentation · Shift+P');
			const input = page.getByTestId('map-search-input');
			await input.focus();
			await input.press(shortcut);
			await expect(presenter).toHaveCount(0);
			await input.fill('');
			await input.press('Escape');
			await start.focus();
			await page.keyboard.press(shortcut);
			await expect(presenter).toHaveAttribute('aria-busy', 'false', { timeout: 180000 });
			if (shortcut === 'Shift+P') {
				await page.screenshot({
					path: path.join(output, 'desktop-baarah-start.png'),
					fullPage: true
				});
			}
			for (let step = 0; step <= lastStep; step++) {
				await expect(presenter).toHaveAttribute('data-step', String(step));
				await expect(presenter).not.toContainText(/\b(?:mom|mother)\b/i);
				const state = await presenter.evaluate((element) => ({
					chapter: Number(element.getAttribute('data-chapter')),
					kind: element.getAttribute('data-scene'),
					caption: element.querySelector('.scene-caption')?.textContent?.trim(),
					comparison: [...element.querySelectorAll('button')].some((button) =>
						['Before', 'Closer stop'].includes(button.textContent?.trim() ?? '')
					)
				}));
				assert.equal(state.chapter, scenes[step].chapter);
				assert.equal(state.kind, scenes[step].kind);
				assert.equal(state.caption, scenes[step].title);
				assert.equal(state.comparison, false);
				if (scenes[step].kind === 'ferry-travel')
					await expect(
						details().getByRole('region', { name: 'Ferry connection', exact: true })
					).toBeVisible();

				if (step < lastStep) await page.keyboard.press('ArrowRight');
			}
		}
		if (selectedCheck) {
			if ((await presenter.count()) > 0) {
				await page.keyboard.press('Escape');
				await expect(presenter).toHaveCount(0);
			}
			await reachAirport();
		} else {
			await expectStep(lastStep);
			await frozenClocks();
		}
		await expect(presenter.locator('.scene-caption')).toHaveText('The bus to the airport');
		await expect(presenter.locator('.step-number')).toHaveText('05 / 05');
		await expect(
			presenter.getByRole('button', { name: 'Finish scenario', exact: true })
		).toBeVisible();
		await expect(presenter.getByRole('button', { name: 'Before', exact: true })).toHaveCount(0);
		await expect(presenter.getByRole('button', { name: 'Closer stop', exact: true })).toHaveCount(
			0
		);
		await page.keyboard.press('ArrowRight');
		await expect(presenter).toHaveCount(0);
		await expect(scope).toHaveAttribute('data-island-id', 'island:1443');
		await expect(atlas).toHaveAttribute('data-presentation-key', '');
		await expect(atlas).toHaveAttribute('data-presentation-population', '0');
		await expect(page.getByRole('button', { name: 'Directions', exact: true })).toBeVisible();
		await expect(page.getByRole('navigation', { name: 'Workspace', exact: true })).toBeVisible();
		await expect(scope).toBeVisible();
		await expect(page.getByRole('button', { name: 'Start scenario', exact: true })).toBeFocused();
		assert.deepEqual(
			await page.evaluate(() => JSON.parse(localStorage.getItem('mobility-v2-scenario') ?? 'null')),
			savedScenario
		);
		if (selectedCheck) {
			await reachAirport('Shift+S');
			await presenter
				.getByRole('button', { name: 'Finish scenario', exact: true })
				.click({ noWaitAfter: true });
			await expect(presenter).toHaveCount(0);
			await expect(scope).toHaveAttribute('data-island-id', 'island:1443');
			await expect(scope).toBeVisible();
			assert.deepEqual(
				await page.evaluate(() =>
					JSON.parse(localStorage.getItem('mobility-v2-scenario') ?? 'null')
				),
				savedScenario
			);
		}
		return {
			scenes: scenes.length,
			chapters: 5,
			route: ['Baarah', 'Vashafaru', 'Dhidhdhoo', 'Hanimaadhoo', 'Velana', 'Hulhumalé'],
			shortcuts: selectedCheck ? ['Shift+P', 'Shift+S'] : [],
			finalScene: 'The bus to the airport',
			keyboardFinish: true
		};
	});
	await check(
		'Shortcut restart, replay and Escape work without automatic stage advancement',
		async () => {
			await page.locator('body').click({ position: { x: 5, y: 5 } });
			await page.keyboard.press('Shift+P');
			await expectStep(0);
			await page.keyboard.press('ArrowRight');
			await expectStep(1);
			await page.keyboard.press('r');
			await expect(atlas).toHaveAttribute('data-presentation-key', '1:1');
			await expect(atlas).toHaveAttribute('data-presentation-progress', '1.000');
			await page.keyboard.press('Escape');
			await expect(presenter).toHaveCount(0);
			await expect(scope).toHaveAttribute('data-island-id', 'island:1443');
		}
	);
	await check('Tablet journey clocks stay beside native island and route panels', async () => {
		await page.setViewportSize({ width: 1024, height: 900 });
		await page.getByRole('button', { name: 'Start scenario', exact: true }).click();
		await expectStep(0);
		await settled();
		await visibleClocks();
		await clocksClearOf(details());
		await noOverflow();
		await page.screenshot({ path: path.join(output, 'tablet-start.png'), fullPage: true });
		await page.keyboard.press('ArrowRight');
		await expectStep(1);
		await settled();
		await expect(
			details().getByRole('region', { name: 'Ferry connection', exact: true })
		).toBeInViewport();
		await clocksClearOf(details());
		await frozenClocks();
		await noOverflow();
		await page.screenshot({
			path: path.join(output, 'tablet-ferry-crossing.png'),
			fullPage: true
		});
		for (let step = 2; step <= lastStep; step++) {
			await page.keyboard.press('ArrowRight');
			await expectStep(step);
			await settled();
		}
		await noOverflow();
		await page.screenshot({
			path: path.join(output, 'tablet-airport-arrival.png'),
			fullPage: true
		});
		await presenter.getByRole('button', { name: 'Finish scenario', exact: true }).click();
		await expect(presenter).toHaveCount(0);
		return { viewport: 1024 };
	});
	await check(
		'Phone presenter keeps next/back and exit controls reachable without horizontal overflow',
		async () => {
			await page.setViewportSize({ width: 390, height: 844 });
			await page.getByRole('button', { name: 'Start scenario', exact: true }).click();
			await expectStep(0);
			await expect(presenter).toHaveAttribute('aria-busy', 'false', { timeout: 180000 });
			for (let step = 0; step < scenes.length; step++) {
				await expect(presenter).toHaveAttribute('data-step', String(step));
				await expect(
					presenter.getByRole('button', { name: 'Exit scenario', exact: true })
				).toBeInViewport();
				const next = presenter.getByRole('button', {
					name: step === lastStep ? 'Finish scenario' : 'Next scenario step',
					exact: true
				});
				await next.scrollIntoViewIfNeeded();
				await expect(next).toBeInViewport();
				await noOverflow();
				await presentationChromeHidden();
				await visibleClocks();
				await settled();
				if (
					['island', 'ferry-travel', 'airport', 'flight-travel', 'access', 'population'].includes(
						scenes[step].kind
					)
				)
					await clocksClearOf(details());
				if ([0, 1, 3, 5, airportStep, flightStep, accessStep, lastStep].includes(step)) {
					await page.screenshot({
						path: path.join(output, `mobile-step-${step + 1}.png`),
						fullPage: true
					});
					if (step === 1) {
						const accessIndex = details().getByRole('region', {
							name: 'Island access index',
							exact: true
						});
						const accessScores = accessIndex.locator('.presentation-value > strong');
						await expect(accessScores).toHaveCount(2);
						for (const score of await accessScores.all()) await expect(score).toBeInViewport();
						const visibleBeforeScroll = await accessIndex.evaluate((element) => {
							const box = element.getBoundingClientRect();
							const body = element.closest('.island-panel-body')?.getBoundingClientRect();
							return !!body && box.top >= body.top && box.bottom <= body.bottom;
						});
						evidence['presentation:mobile-access-index-with-route-facts'] = visibleBeforeScroll;
						await accessIndex.scrollIntoViewIfNeeded();
						await expect(accessIndex).toBeInViewport();
						await page.screenshot({
							path: path.join(output, 'mobile-ferry-access-index.png'),
							fullPage: true
						});
					}
				}
				if (step < lastStep) await next.click();
			}
			await presenter.getByRole('button', { name: 'Previous scenario step' }).click();
			await expectStep(walkStep);
			await next().click();
			await expectStep(lastStep);
			await settled();
			await presenter.getByRole('button', { name: 'Finish scenario', exact: true }).click();
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
			await expectStep(0);
			await expect(presenter).toHaveAttribute('aria-busy', 'false', { timeout: 180000 });
			await page.keyboard.press('ArrowRight');
			const ferryMotion = await motionSnapshot();
			assert.equal(ferryMotion.step, '1');
			assert.equal(ferryMotion.following, 'true');
			assert.equal(ferryMotion.running, 'true');
			assert.match(ferryMotion.waitCue ?? '', /23h 40m waiting included/);
			assert.equal(ferryMotion.panelInTransit, true);
			assert.equal(ferryMotion.vehicleMode, 'ferry');
			assert.equal(ferryMotion.vehicleMoving, 'true');
			assert.ok((ferryMotion.tailOpacity ?? 0) > 0, 'A moving ferry must show its wake');
			const ferryProgress = ferryMotion.progress;
			const arrivalDuringFerry = ferryMotion.elapsedSeconds;
			assert.ok(ferryProgress > 0 && ferryProgress < 1);
			assert.ok(arrivalDuringFerry > 0);
			departureSnapshot(ferryMotion, 'Baarah', scenes[1].island);
			await expect(atlas).toHaveAttribute('data-presentation-phase', 'playing');
			// Pause before the slower layout/screenshot assertions consume the short crossing.
			await page.mouse.move(620, 600);
			await page.mouse.down();
			await expect(atlas).toHaveAttribute('data-presentation-following', 'false');
			await expect(atlas).toHaveAttribute('data-presentation-phase', 'paused');
			await expect(atlas).toHaveAttribute('data-presentation-animating', 'false');
			const ferryVehicle = atlas.locator('.presentation-vehicle-marker[data-mode="ferry"]');
			await expect(ferryVehicle).toHaveAttribute('data-moving', 'false');
			await expect(ferryVehicle.locator('.presentation-motion-tail')).toHaveCSS('opacity', '0');
			await islandStats('Baarah');
			await clocksClearOf(details());
			await page.screenshot({
				path: path.join(output, 'desktop-ferry-motion.png'),
				fullPage: true
			});
			await visibleClocks();
			const pausedProgress = await atlas.getAttribute('data-presentation-progress');
			const pausedClock = await arrivalClock().getAttribute('data-elapsed-seconds');
			const gestureStart = [
				Number(await atlas.getAttribute('data-center-longitude')),
				Number(await atlas.getAttribute('data-center-latitude'))
			];
			await page.mouse.move(700, 640, { steps: 12 });
			await page.mouse.up();
			await atlas.locator('.maplibregl-canvas').focus();
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
			await expect(presenter).toHaveAttribute('data-controls-quiet', 'true');
			await expect(presenter.locator('.scenario-navigation')).toHaveCSS('opacity', '0.22');
			await page.mouse.move(701, 641);
			await expect(presenter).toHaveAttribute('data-controls-quiet', 'false');
			await expect(presenter.locator('.scenario-navigation')).toHaveCSS('opacity', '1');
			await expect(atlas).toHaveAttribute('data-presentation-progress', pausedProgress ?? '');
			await expect(arrivalClock()).toHaveAttribute('data-elapsed-seconds', pausedClock ?? '');
			await frozenClocks();
			await atlas.locator('.maplibregl-canvas').focus();
			await page.keyboard.press('r');
			const replayMotion = await motionSnapshot();
			assert.equal(replayMotion.key, '1:1');
			assert.equal(replayMotion.following, 'true');
			assert.equal(replayMotion.running, 'true');
			departureSnapshot(replayMotion, 'Baarah', scenes[1].island);
			await settled();
			await expect(presenter).toHaveAttribute('data-step', '1');
			await islandStats('Vashafaru');
			await islandMapLayers('island:611');
			await arrivedTreatment();
			await expect(ferryVehicle).toHaveAttribute('data-moving', 'false');
			await frozenClocks();
			// Replaying an arrived crossing must restore the departure profile immediately.
			await page.keyboard.press('r');
			const completedFerryReplay = await motionSnapshot();
			assert.equal(completedFerryReplay.key, '1:2');
			departureSnapshot(completedFerryReplay, 'Baarah', scenes[1].island);
			await page.keyboard.press('ArrowLeft');
			await expectStep(0);
			await islandStats('Baarah');
			await islandMapLayers('island:640');
			await expect(atlas).toHaveAttribute('data-presentation-animating', 'false');
			await expect(atlas).toHaveAttribute('data-presentation-progress', '0.000');
			const afterFerry = await frozenClocks();
			assert.equal(Number(afterFerry[0]), 0);
			for (let scene = 1; scene <= airportStep; scene++) {
				await page.keyboard.press('ArrowRight');
				await expect(presenter).toHaveAttribute('data-step', String(scene));
			}
			await expectStep(airportStep);
			await settled();
			await page.keyboard.press('ArrowRight');
			const firstFlight = await motionSnapshot();
			assert.equal(firstFlight.step, String(flightStep));
			assert.equal(firstFlight.reused, 'true');
			departureSnapshot(firstFlight, 'Hanimaadhoo', scenes[flightStep].island);
			await page.keyboard.press('ArrowLeft');
			await expectStep(airportStep);
			await expect(atlas).toHaveAttribute('data-presentation-animating', 'false');
			await islandStats('Hanimaadhoo');
			await settled();
			await page.keyboard.press('ArrowRight');
			const flightMotion = await motionSnapshot();
			assert.equal(flightMotion.step, String(flightStep));
			assert.equal(flightMotion.running, 'true');
			assert.match(flightMotion.waitCue ?? '', /1h 30m connection allowance included/);
			assert.equal(flightMotion.panelInTransit, true);
			assert.equal(flightMotion.vehicleMode, 'air');
			assert.equal(flightMotion.vehicleMoving, 'true');
			assert.ok((flightMotion.tailOpacity ?? 0) > 0, 'A moving flight must show its contrail');
			assert.ok(flightMotion.progress > 0 && flightMotion.progress < 1);
			departureSnapshot(flightMotion, 'Hanimaadhoo', scenes[flightStep].island);
			await expect(atlas).toHaveAttribute('data-presentation-phase', 'playing');
			await page.screenshot({
				path: path.join(output, 'desktop-flight-motion.png'),
				fullPage: true
			});
			await visibleClocks();
			await expect(atlas).toHaveAttribute('data-route-vehicles', '0');
			await settled();
			await expect(presenter).toHaveAttribute('data-step', String(flightStep));
			await islandStats('Hulhumalé');
			await arrivedTreatment();
			await expect(atlas.locator('.presentation-vehicle-marker')).toHaveAttribute(
				'data-moving',
				'false'
			);
			await clocksClearOf(details());
			await frozenClocks();
			const flightKey = flightMotion.key;
			assert.ok(flightKey);
			const flightReplay = Number(flightKey.split(':')[1]) + 1;
			await presenter.getByRole('button', { name: 'Replay scenario step' }).click();
			await expect(atlas).toHaveAttribute('data-presentation-key', `${flightStep}:${flightReplay}`);
			await expect(atlas).toHaveAttribute('data-presentation-phase', /entering|playing/);
			const replayedFlight = await motionSnapshot();
			assert.equal(replayedFlight.key, `${flightStep}:${flightReplay}`);
			departureSnapshot(replayedFlight, 'Hanimaadhoo', scenes[flightStep].island);
			await page.keyboard.press('Escape');
			await expect(presenter).toHaveCount(0);
			await expect(atlas).toHaveAttribute('data-presentation-key', '');
			await expect(atlas).toHaveAttribute('data-presentation-paths', '0');
			await expect(atlas).toHaveAttribute('data-presentation-progress', '0.000');
			await expect(atlas).toHaveAttribute('data-presentation-animating', 'false');
			await expect(
				atlas.locator('.presentation-vehicle-marker, .presentation-arrival-focus')
			).toHaveCount(0);
			return { ferryProgress, pausedProgress, pausedClock, gestureStart, pannedCenter, heldCenter };
		}
	);
	await check('Stationary bus waiting advances time before the direct airport ride', async () => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		await page.emulateMedia({ reducedMotion: 'no-preference' });
		await page.getByRole('button', { name: 'Start scenario', exact: true }).click();
		await expect(presenter).toHaveAttribute('aria-busy', 'false', { timeout: 180000 });
		let accessCamera;
		let walkArrivalCamera;
		for (let step = 1; step <= lastStep; step++) {
			await page.keyboard.press('ArrowRight');
			await expect(presenter).toHaveAttribute('data-step', String(step));
			if (step === accessStep) {
				await expect(atlas).toHaveAttribute('data-presentation-handoff', 'overview');
				// Labels exist during the long approach; capture once both endpoints are framed.
				await page.waitForFunction(() => {
					const map = document.querySelector('.national-map');
					const bounds = map?.getBoundingClientRect();
					if (!map || !bounds || map.getAttribute('data-presentation-handoff') !== 'overview')
						return false;
					const latitude = Number(map.getAttribute('data-center-latitude'));
					const longitude = Number(map.getAttribute('data-center-longitude'));
					const labels = [...map.querySelectorAll('.presentation-handoff-label')];
					return (
						latitude > 4.18 &&
						latitude < 4.25 &&
						longitude > 73.5 &&
						longitude < 73.58 &&
						Number(map.getAttribute('data-zoom')) > 12 &&
						labels.length === 2 &&
						labels.every((label) => {
							const box = label.getBoundingClientRect();
							return (
								box.left >= bounds.left &&
								box.right <= bounds.right &&
								box.top >= bounds.top &&
								box.bottom <= bounds.bottom
							);
						})
					);
				});
				await page.screenshot({
					path: path.join(output, 'desktop-airport-handoff.png'),
					fullPage: true
				});
				await settled();
				await expect(atlas).toHaveAttribute('data-presentation-handoff', 'focus');
				await staticSceneSurvivesVisibilityChange();
				accessCamera = await camera();
				await page.screenshot({ path: path.join(output, 'desktop-access.png'), fullPage: true });
			}
			if (step === accessStep + 1) {
				await settled();
				assert.ok(accessCamera);
				unchangedCamera(accessCamera, await camera());
				await page.screenshot({
					path: path.join(output, 'desktop-population.png'),
					fullPage: true
				});
			}
			if (step === walkStep) {
				await settled();
				walkArrivalCamera = await camera();
			}
		}
		await page.waitForFunction(() => {
			const map = document.querySelector('.national-map');
			return (
				map?.getAttribute('data-presentation-phase') === 'playing' &&
				Number(map.getAttribute('data-presentation-progress')) > 0.03
			);
		});
		const readWait = () =>
			atlas.evaluate((map) => ({
				mode: map.getAttribute('data-presentation-playback-mode'),
				stationary: map.getAttribute('data-presentation-stationary'),
				vehicle: map.getAttribute('data-presentation-vehicle-mode'),
				reused: map.getAttribute('data-presentation-reused-camera'),
				point: [
					map.getAttribute('data-presentation-vehicle-longitude'),
					map.getAttribute('data-presentation-vehicle-latitude')
				],
				clock: Number(
					document
						.querySelector('[data-testid="presentation-pickup-clock"]')
						?.getAttribute('data-elapsed-seconds')
				),
				camera: {
					longitude: Number(map.getAttribute('data-center-longitude')),
					latitude: Number(map.getAttribute('data-center-latitude')),
					zoom: Number(map.getAttribute('data-zoom'))
				}
			}));
		const startWait = await readWait();
		assert.equal(startWait.mode, 'wait');
		assert.equal(startWait.stationary, 'true');
		assert.equal(startWait.vehicle, 'walk');
		assert.equal(startWait.reused, 'true');
		assert.ok(walkArrivalCamera);
		unchangedCamera(walkArrivalCamera, startWait.camera);
		const waitingPoint = startWait.point;
		const waitingClock = startWait.clock;
		await page.waitForTimeout(600);
		const duringWait = await readWait();
		assert.equal(duringWait.mode, 'wait');
		assert.deepEqual(
			duringWait.point,
			waitingPoint,
			'The traveller must remain at the boarding point while waiting'
		);
		assert.ok(duringWait.clock > waitingClock);
		unchangedCamera(startWait.camera, duringWait.camera);
		await page.screenshot({ path: path.join(output, 'desktop-bus-wait.png'), fullPage: true });
		await expect(atlas).toHaveAttribute('data-presentation-playback-mode', 'bus');
		await expect(atlas).toHaveAttribute('data-presentation-stationary', 'false');
		await expect
			.poll(async () =>
				[
					await atlas.getAttribute('data-presentation-vehicle-longitude'),
					await atlas.getAttribute('data-presentation-vehicle-latitude')
				].join(',')
			)
			.not.toBe(waitingPoint.join(','));
		await expect(presenter.getByLabel('Airport journey breakdown')).toHaveAttribute(
			'data-stage',
			'bus'
		);
		await page.screenshot({ path: path.join(output, 'desktop-bus-ride.png'), fullPage: true });
		await settled();
		await frozenClocks();
		await page.keyboard.press('Escape');
		await expect(presenter).toHaveCount(0);
		return { waitingPoint, waitingClock };
	});
	await check(
		'A ferry travel panel refreshes and starts when delayed crossing timing arrives',
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
				if (payload?.origin_island_id === 'island:640') {
					timingRequested = true;
					await timingGate;
				}
				await route.continue().catch(() => {});
			});
			try {
				await delayedPage.goto(`${baseURL}/?view=map&tool=explore&island=island%3A1442`);
				await expect(delayedPage.locator('.national-map')).toBeVisible();
				await delayedPage.getByRole('button', { name: 'Start scenario', exact: true }).click();
				const delayedPresenter = delayedPage.getByRole('region', {
					name: 'Scenario presentation',
					exact: true
				});
				await expect(delayedPresenter).toHaveAttribute('data-step', '0');
				await expect(delayedPage.locator('.national-map')).toHaveAttribute(
					'data-presentation-phase',
					'complete'
				);
				await delayedPresenter
					.getByRole('button', { name: 'Next scenario step', exact: true })
					.click();
				await expect(delayedPresenter).toHaveAttribute('data-step', '1');
				const summary = delayedPresenter.getByRole('region', {
					name: 'Ferry connection',
					exact: true
				});
				await expect(summary).toBeVisible();
				await expect.poll(() => timingRequested).toBe(true);
				const estimate = summary.locator('dt', {
					hasText: /^Crossing$/
				});
				await expect(estimate.locator('+ dd')).toHaveText('Unavailable');
				await expect(delayedPage.getByTestId('presentation-arrival-clock')).toHaveAttribute(
					'data-running',
					'false'
				);
				const beforeKey = await delayedPage
					.locator('.national-map')
					.getAttribute('data-presentation-key');
				releaseTiming();
				await expect(estimate.locator('+ dd')).toHaveText('15 min');
				await expect(delayedPresenter).toHaveAttribute('data-step', '1');
				await expect(delayedPage.locator('.national-map')).toHaveAttribute(
					'data-presentation-key',
					beforeKey ?? ''
				);
				await delayedPage.screenshot({
					path: path.join(output, 'desktop-delayed-ferry-timing.png'),
					fullPage: true
				});
				return { initialEstimate: 'Unavailable', updatedEstimate: '15 min', key: beforeKey };
			} catch (error) {
				console.log(
					'Delayed crossing failure state',
					await delayedPage.locator('.national-map').evaluate((element) => ({ ...element.dataset }))
				);
				await delayedPage.screenshot({
					path: path.join(output, 'delayed-failure.png'),
					fullPage: true
				});
				throw error;
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
