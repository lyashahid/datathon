import { projectMapPoint } from './browser-map.mjs';
import { browserBaseURL } from './browser-config.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const baseURL = browserBaseURL();
const output = path.resolve('artifacts/qa/nearby-bus-stops');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 60000 });
/** @type {{checks:Array<{name:string,status:string,detail?:unknown}>,pageErrors:string[],failure?:string}} */
const report = { checks: [], pageErrors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1000 },
	reducedMotion: 'reduce'
});
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.on('pageerror', (error) => report.pageErrors.push(error.message));
const atlas = page.locator('.national-map');

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

/** @param {[number,number]} coordinates */
async function project(coordinates) {
	return projectMapPoint(atlas, coordinates);
}

/** Pan through genuine unobscured canvas gestures without selecting a different island.
 * @param {[number,number]} coordinates
 */
async function panTo(coordinates) {
	for (let attempt = 0; attempt < 24; attempt++) {
		const position = await project(coordinates);
		const box = await atlas.locator('.maplibregl-canvas').boundingBox();
		assert.ok(box);
		const dx = box.x + box.width * 0.55 - position.x;
		const dy = box.y + box.height * 0.4 - position.y;
		if (Math.hypot(dx, dy) < 12) return;
		const gesture = await page.evaluate(
			({ box, dx, dy }) => {
				const length = Math.hypot(dx, dy);
				const scale = Math.min(1, 220 / length);
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
				throw new Error('A clear canvas path is required for panning');
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

try {
	const response = await page.request.get(`${baseURL}/api/backend/routing/stops`);
	assert.equal(response.status(), 200);
	/** @type {{stops:Array<{id:string,name:string,island_id:string,national_island_id:string|null,coordinates:[number,number]}>}} */
	const catalogue = await response.json();
	const maleStops = catalogue.stops.filter((stop) => stop.island_id === 'male');
	const hulhumaleStops = catalogue.stops.filter((stop) => stop.island_id === 'hulhumale');
	assert.ok(maleStops.length > 0 && hulhumaleStops.length > 0);
	assert.ok(maleStops.every((stop) => stop.national_island_id === 'island:1443'));
	assert.ok(hulhumaleStops.every((stop) => stop.national_island_id === 'island:1442'));
	/** @type {string[]} */
	const stopRequests = [];
	page.on('request', (request) => {
		if (new URL(request.url()).pathname.endsWith('/routing/stops'))
			stopRequests.push(request.url());
	});
	await check('Hulhumalé keeps all nearby-island bus stops in the map catalogue', async () => {
		await page.goto(`${baseURL}/?view=map&island=island%3A1442&tool=explore`);
		await expect(atlas).toHaveAttribute('aria-busy', 'false');
		await expect
			.poll(async () => Number(await atlas.getAttribute('data-map-bus-stops')))
			.toBeGreaterThanOrEqual(catalogue.stops.length);
		assert.ok(stopRequests.length > 0);
		assert.ok(stopRequests.every((url) => !new URL(url).searchParams.has('island_id')));
		return {
			catalogue: catalogue.stops.length,
			male: maleStops.length,
			hulhumale: hulhumaleStops.length
		};
	});
	await check(
		'Panning from Hulhumalé to Malé keeps nearby bus markers without changing selection',
		async () => {
			await panTo([73.514746, 4.17001]);
			await expect(page).toHaveURL((url) => url.searchParams.get('island') === 'island:1442');
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-rendered-place-icons')))
				.toBeGreaterThanOrEqual(maleStops.length);
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-rendered-roads')))
				.toBeGreaterThan(0);
			await page.screenshot({ path: path.join(output, 'male-stops-with-hulhumale-selected.png') });
			return {
				selectedIsland: 'island:1442',
				renderedPlaceIcons: Number(await atlas.getAttribute('data-rendered-place-icons'))
			};
		}
	);
	await check(
		'A Malé bus marker opens its stop details while Hulhumalé remains selected',
		async () => {
			const stop = maleStops.find((stop) => stop.name === 'STELCO');
			assert.ok(stop, 'A real Malé operator stop is available for inspection');
			const position = await project(stop.coordinates);
			await page.mouse.click(position.x, position.y);
			const card = page.getByRole('region', { name: 'Map source record', exact: true });
			await expect(card).toBeVisible();
			await expect(card).toContainText(/Bus stop|bus stop/);
			const title = await card.locator('h3').innerText();
			assert.ok(
				maleStops.some((candidate) => candidate.name === title),
				'The clicked marker is a Malé stop'
			);
			await expect(page).toHaveURL((url) => url.searchParams.get('island') === 'island:1442');
			await page.screenshot({ path: path.join(output, 'male-stop-details.png') });
			return { selectedIsland: 'island:1442', inspectedStop: title };
		}
	);
	assert.deepEqual(report.pageErrors, []);
} catch (error) {
	report.failure = String(error);
	await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
	throw error;
} finally {
	await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
	await browser.close();
}
