import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Exercises real resident evaluations and pointer controls. No synthetic application state.
const baseURL = process.env.BASE_URL || 'http://127.0.0.1:5173';
const output = path.resolve('artifacts/qa/proposal-map-comparison');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 90000 });
/** @typedef {{x:number,y:number}} Point */
/** @typedef {{start:number,duration:number}} Timing */
/** @typedef {import('../src/lib/map-policy.js').MapEvaluation & {assumptions:{goal?:string}}} Evaluation */
/** @type {{baseURL:string,cpuRate?:number,startedAt:string,finishedAt?:string,checks:Array<{name:string,status:string,detail?:unknown}>,pageErrors:string[],failure?:string}} */
const report = {
	baseURL,
	startedAt: new Date().toISOString(),
	checks: [],
	pageErrors: []
};
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1000 },
	reducedMotion: 'reduce'
});
const page = await context.newPage();
const cpuRate = Number(process.env.QA_CPU_RATE || 1);
if (cpuRate > 1)
	await (
		await context.newCDPSession(page)
	).send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
report.cpuRate = cpuRate;
page.setDefaultTimeout(90000);
page.on('pageerror', (error) => report.pageErrors.push(error.message));
/** @type {import('../src/lib/proposal-review.js').PlanningReviewRequest[]} */
const evaluations = [];
/** @type {Evaluation[]} */
const evaluationResponses = [];
page.on('request', (request) => {
	if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/planning/evaluate'))
		evaluations.push(request.postDataJSON());
});
page.on('response', async (response) => {
	if (
		response.ok() &&
		response.request().method() === 'POST' &&
		new URL(response.url()).pathname.endsWith('/planning/evaluate')
	) {
		try {
			evaluationResponses.push(await response.json());
		} catch {
			/* Cancelled obsolete preview. */
		}
	}
});
await page.addInitScript(() => {
	/** @type {Array<{start:number,duration:number}>} */
	const entries = [];
	/** @type {Array<{start:number,duration:number}>} */
	const frames = [];
	let previous = performance.now();
	new PerformanceObserver((list) => {
		for (const entry of list.getEntries())
			entries.push({ start: entry.startTime, duration: entry.duration });
	}).observe({ type: 'longtask', buffered: true });
	/** @param {number} now */
	const frame = (now) => {
		frames.push({ start: previous, duration: now - previous });
		previous = now;
		requestAnimationFrame(frame);
	};
	requestAnimationFrame(frame);
	Reflect.set(window, '__comparisonPerformance', { entries, frames });
});
const atlas = page.locator('.national-map');
const panel = page.getByRole('region', { name: 'Island needs and proposal', exact: true });
const confirmation = page.getByTestId('map-placement-confirmation');
const budget = page.getByRole('region', { name: 'Proposal budget', exact: true });
/** @type {import('../src/lib/map-policy.js').MapBaseline} */
let baseline;
async function save() {
	await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
}
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
		await save();
	}
}
/** @param {number[]} coordinates */
async function project(coordinates) {
	return atlas.evaluate((element, location) => {
		const canvas = element.querySelector('.maplibregl-canvas');
		if (!canvas) throw new Error('Map canvas is missing.');
		const box = canvas.getBoundingClientRect();
		const zoom = Number(element.getAttribute('data-zoom'));
		const longitude = Number(element.getAttribute('data-center-longitude'));
		const latitude = Number(element.getAttribute('data-center-latitude'));
		const padding = Object.fromEntries(
			['top', 'right', 'bottom', 'left'].map((side) => [
				side,
				Number(element.getAttribute(`data-camera-padding-${side}`))
			])
		);
		const world = 512 * 2 ** zoom;
		/** @param {number} value */
		const mercatorY = (value) =>
			(1 - Math.log(Math.tan(Math.PI / 4 + (value * Math.PI) / 360)) / Math.PI) / 2;
		return {
			x:
				box.x +
				(box.width + padding.left - padding.right) / 2 +
				((location[0] - longitude) * world) / 360,
			y:
				box.y +
				(box.height + padding.top - padding.bottom) / 2 +
				(mercatorY(location[1]) - mercatorY(latitude)) * world
		};
	}, coordinates);
}
/** @param {Point} point */
async function isClear(point) {
	return page.evaluate(
		({ x, y }) =>
			x > 35 &&
			x < innerWidth - 35 &&
			y > 150 &&
			y < innerHeight - 90 &&
			!!document.elementFromPoint(x, y)?.matches('.maplibregl-canvas'),
		point
	);
}
async function site() {
	for (const road of baseline.graph_edges)
		for (const coordinates of road.geometry ?? []) {
			const point = await project(coordinates);
			if (await isClear(point)) return { coordinates, point };
		}
	throw new Error('No visible mapped road location outside the controls.');
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
async function impactReady() {
	await expect(atlas).toHaveAttribute('data-policy-calculating', 'false');
	await expect
		.poll(async () => Number(await atlas.getAttribute('data-policy-impact-cells')))
		.toBeGreaterThan(0);
}
/** @param {number} start */
async function performanceSince(start) {
	return page.evaluate((start) => {
		const { entries, frames } = /** @type {{entries:Timing[],frames:Timing[]}} */ (
			Reflect.get(window, '__comparisonPerformance')
		);
		const tasks = entries.filter((entry) => entry.start >= start);
		const gaps = frames.filter((entry) => entry.start >= start);
		return {
			longTasks: tasks.length,
			totalLongTaskMs: Math.round(tasks.reduce((sum, entry) => sum + entry.duration, 0)),
			largestLongTaskMs: Math.round(Math.max(0, ...tasks.map((entry) => entry.duration))),
			maximumFrameGapMs: Math.round(Math.max(0, ...gaps.map((entry) => entry.duration)))
		};
	}, start);
}
/** @param {string} name @param {string} value */
async function toggle(name, value) {
	const start = await page.evaluate(() => performance.now());
	const begin = performance.now();
	await page.getByRole('button', { name, exact: true }).click();
	await expect(atlas).toHaveAttribute('data-policy-impact-view', value);
	await page.evaluate(
		() =>
			new Promise((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame((now) => resolve(now)))
			)
	);
	return {
		name,
		wallMs: Math.round(performance.now() - begin),
		...(await performanceSince(start))
	};
}
async function mapDiagnostics() {
	return atlas.evaluate((element) =>
		Object.fromEntries(
			[...element.attributes]
				.filter((attribute) => attribute.name.startsWith('data-policy-'))
				.map((attribute) => [attribute.name, attribute.value])
		)
	);
}
async function placeHospital() {
	await showProposal();
	const target = await site();
	await panel.getByRole('button', { name: 'Hospital', exact: true }).click();
	await page.mouse.click(target.point.x, target.point.y);
	await expect(confirmation).toHaveAttribute('aria-busy', 'false');
	await expect(confirmation).toHaveAttribute('data-placement-allowed', 'true');
	await expect(confirmation.locator('.placement-access-preview strong')).toBeVisible();
	return target;
}
/** @param {import('@playwright/test').Locator} action */
async function assertFullyVisible(action) {
	await expect(action).toBeInViewport({ ratio: 1 });
	assert.ok(
		await action.evaluate((element) => {
			const box = element.getBoundingClientRect();
			const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
			return !!hit && (hit === element || element.contains(hit));
		}),
		'The center of this visible action must receive pointer input.'
	);
}

// Read the actual rendered screenshot, independently of app colour attributes.
/** @param {Buffer} png */
function screenshotColours(png) {
	let width = 0,
		height = 0,
		bytesPerPixel = 0;
	/** @type {Buffer[]} */
	const chunks = [];
	for (let offset = 8; offset < png.length;) {
		const length = png.readUInt32BE(offset);
		const type = png.toString('ascii', offset + 4, offset + 8);
		const data = png.subarray(offset + 8, offset + 8 + length);
		if (type === 'IHDR') {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			assert.equal(data[8], 8);
			assert.ok(data[9] === 2 || data[9] === 6, 'Expected an RGB or RGBA browser screenshot.');
			bytesPerPixel = data[9] === 6 ? 4 : 3;
		}
		if (type === 'IDAT') chunks.push(data);
		offset += length + 12;
	}
	const packed = inflateSync(Buffer.concat(chunks));
	const stride = width * bytesPerPixel;
	const pixels = new Uint8Array(stride * height);
	const counts = { red: 0, green: 0, pixels: width * height, meanRedMinusGreen: 0 };
	for (let y = 0; y < height; y++) {
		const filter = packed[y * (stride + 1)];
		for (let x = 0; x < stride; x++) {
			const left = x >= bytesPerPixel ? pixels[y * stride + x - bytesPerPixel] : 0;
			const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
			const diagonal =
				y > 0 && x >= bytesPerPixel ? pixels[(y - 1) * stride + x - bytesPerPixel] : 0;
			const p = left + up - diagonal;
			const paeth =
				Math.abs(p - left) <= Math.abs(p - up) && Math.abs(p - left) <= Math.abs(p - diagonal)
					? left
					: Math.abs(p - up) <= Math.abs(p - diagonal)
						? up
						: diagonal;
			const predictors = [0, left, up, Math.floor((left + up) / 2), paeth];
			assert.ok(filter <= 4);
			pixels[y * stride + x] = (packed[y * (stride + 1) + x + 1] + predictors[filter]) & 255;
		}
		for (let x = 0; x < stride; x += bytesPerPixel) {
			const [red, green, blue] = pixels.subarray(y * stride + x, y * stride + x + 3);
			if (red > green * 1.12 && red > blue * 1.12) counts.red++;
			if (green > red * 1.12 && green > blue * 1.03) counts.green++;
			counts.meanRedMinusGreen += red - green;
		}
	}
	counts.meanRedMinusGreen /= counts.pixels;
	return counts;
}
/** @param {number[]} coordinates @param {string} name */
async function neighbourhoodColours(coordinates, name) {
	const point = await project(coordinates);
	const png = await page.screenshot({
		path: path.join(output, name),
		clip: { x: Math.round(point.x) - 7, y: Math.round(point.y) - 7, width: 15, height: 15 }
	});
	return screenshotColours(png);
}
function latestEvaluation() {
	const value = evaluationResponses.at(-1);
	assert.ok(value, 'The real resident evaluation must have completed.');
	return value;
}
/** @param {Evaluation} value */
function changedJourneys(value) {
	return value.origins.filter(
		(row) =>
			row.before.status !== row.after.status ||
			(row.before.minutes !== null &&
				row.after.minutes !== null &&
				Math.abs(row.before.minutes - row.after.minutes) > 0.001)
	);
}

try {
	const source = await page.request.get(
		`${baseURL}/api/backend/planning/baseline?island_id=island%3A1442`
	);
	assert.equal(source.status(), 200);
	baseline = await source.json();
	await page.goto(`${baseURL}/?view=map&tool=explore&island=island%3A1442`, {
		waitUntil: 'domcontentloaded'
	});
	await expect(atlas).toHaveAttribute('aria-busy', 'false');
	await showProposal();
	await expect(panel.getByRole('button', { name: 'Hospital', exact: true })).toBeEnabled();
	await panel.getByLabel('Capital budget · MVR', { exact: true }).fill('1000000000');
	await panel.getByLabel('Annual running budget · MVR', { exact: true }).fill('1000000000');
	await check('No proposal leaves every real transport journey unchanged', async () => {
		const response = await page.request.post(`${baseURL}/api/backend/planning/evaluate`, {
			data: {
				island_id: 'island:1442',
				operations: [],
				assumptions: {
					goal: 'transport',
					target_minutes: 10,
					include_world: false,
					include_origin_geometry: false,
					include_journey_geometry: false
				}
			}
		});
		assert.equal(response.status(), 200);
		const value = /** @type {Evaluation} */ (await response.json());
		assert.equal(changedJourneys(value).length, 0);
		assert.equal(value.summary.gained_residents, 0);
		assert.equal(value.summary.lost_residents, 0);
		assert.equal(value.summary.weighted_minutes_saved, 0);
		await page.screenshot({ path: path.join(output, 'no-proposal-baseline.png') });
		return { origins: value.origins.length, summary: value.summary, changedJourneys: 0 };
	});
	await check(
		'A valid placement recolours real access before confirmation and Cancel restores the map',
		async () => {
			const target = await placeHospital();
			await impactReady();
			await expect(atlas).toHaveAttribute('data-policy-proposal-points', '0');
			await expect(atlas).toHaveAttribute('data-policy-pending-points', '1');
			await expect(page.getByTestId('policy-overlay-status')).toContainText(/preview.*not added/i);
			const diagnostics = await mapDiagnostics();
			assert.ok(
				Number(diagnostics['data-policy-comparison-changed-cells']) > 0,
				'A real hospital gain must change access classifications.'
			);
			assert.ok(
				(latestEvaluation().summary.gained_residents ?? 0) > 0,
				'The preview must be supported by the real accessibility model.'
			);
			await page.screenshot({ path: path.join(output, 'hospital-live-preview.png') });
			await page.keyboard.press('Escape');
			await expect(confirmation).toHaveCount(0);
			await expect(atlas).toHaveAttribute('data-policy-pending-points', '0');
			await expect(atlas).toHaveAttribute('data-policy-impact-cells', '0');
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-policy-gap-cells')))
				.toBeGreaterThan(0);
			return {
				coordinates: target.coordinates,
				gainedResidents: latestEvaluation().summary.gained_residents,
				diagnostics,
				cancelledWithoutCommitting: true
			};
		}
	);
	await check(
		'A real hospital proposal evaluates and displays resident access evidence',
		async () => {
			const target = await placeHospital();
			const preview = await confirmation.innerText();
			await page.screenshot({ path: path.join(output, 'hospital-preview.png') });
			const completedRequests = evaluations.length;
			await confirmation.getByRole('button', { name: 'Add to proposal', exact: true }).click();
			await impactReady();
			assert.equal(
				evaluations.length,
				completedRequests,
				'Confirming a completed exact preview reuses the resident result.'
			);
			await page.screenshot({ path: path.join(output, 'hospital-confirmed.png') });
			return {
				coordinates: target.coordinates,
				preview,
				summary: latestEvaluation().summary,
				diagnostics: await mapDiagnostics()
			};
		}
	);
	await check('Comparison controls reuse completed evaluation', async () => {
		const before = evaluations.length;
		const diagnosticsBefore = await mapDiagnostics();
		const controls = [
			['Without proposal', 'before'],
			['With proposal', 'after'],
			['Without proposal', 'before'],
			['With proposal', 'after']
		];
		const measurements = [];
		for (const [name, view] of [...controls, ...controls, ...controls])
			measurements.push(await toggle(name, view));
		assert.equal(evaluations.length, before, 'View switches must not recalculate residents.');
		const diagnosticsAfter = await mapDiagnostics();
		assert.equal(
			diagnosticsAfter['data-policy-impact-source-updates'],
			diagnosticsBefore['data-policy-impact-source-updates'],
			'Switching comparison must preserve the cached GeoJSON geometry.'
		);
		assert.equal(
			diagnosticsAfter['data-policy-impact-cells'],
			diagnosticsBefore['data-policy-impact-cells'],
			'The comparison uses the same complete cell geometry.'
		);
		assert.equal(
			diagnosticsAfter['data-policy-comparison-changed-cells'],
			diagnosticsBefore['data-policy-comparison-changed-cells']
		);
		assert.ok(
			measurements.every((item) => item.wallMs < 1500 && item.largestLongTaskMs < 750),
			'Comparison must remain responsive under the configured CPU throttle.'
		);
		await expect(page.getByRole('button', { name: 'Improvement', exact: true })).toHaveCount(0);
		await page.screenshot({ path: path.join(output, 'comparison-with-proposal.png') });
		return {
			additionalEvaluations: evaluations.length - before,
			measurements,
			diagnosticsBefore,
			diagnosticsAfter
		};
	});
	await check(
		'One real gaining neighbourhood gets a cooler colour as its modeled journey shortens',
		async () => {
			const gains = latestEvaluation().origins.filter(
				(origin) =>
					origin.gained_access &&
					origin.before.minutes !== null &&
					origin.before.minutes > 30 &&
					origin.after.minutes !== null &&
					origin.after.minutes <= 30
			);
			assert.ok(gains.length > 0);
			await toggle('Without proposal', 'before');
			const explanation = panel.locator('[aria-label="Selected neighbourhood impact"]');
			let selected;
			for (const row of gains) {
				const coordinates = row.coordinates;
				if (!coordinates) continue;
				const point = await project(coordinates);
				if (!(await isClear(point))) continue;
				await page.mouse.click(point.x, point.y);
				if (
					(await explanation.isVisible()) &&
					/longer journeys/.test(await explanation.innerText())
				) {
					selected = {
						originId: row.origin_id,
						coordinates,
						before: row.before.minutes,
						after: row.after.minutes
					};
					break;
				}
			}
			assert.ok(selected, 'A source-backed red neighbourhood must be selectable on the map.');
			const cellId = await explanation.getAttribute('data-cell-id');
			assert.ok(cellId);
			const beforeText = await explanation.innerText();
			const beforeColours = await neighbourhoodColours(
				selected.coordinates,
				'cell-without-proposal.png'
			);
			await page.screenshot({ path: path.join(output, 'same-cell-without-proposal.png') });
			const sourceUpdates = await atlas.getAttribute('data-policy-impact-source-updates');
			await toggle('With proposal', 'after');
			await expect(explanation).toHaveAttribute('data-cell-id', cellId);
			await expect(explanation).toContainText(/within reach/);
			const afterText = await explanation.innerText();
			const afterColours = await neighbourhoodColours(
				selected.coordinates,
				'cell-with-proposal.png'
			);
			assert.ok(
				beforeColours.red > 0 &&
					afterColours.red < beforeColours.red &&
					afterColours.meanRedMinusGreen < beforeColours.meanRedMinusGreen - 4,
				'The same shorter journey must visibly cool on the continuous scale; being within target alone must not paint it green.'
			);
			assert.equal(await atlas.getAttribute('data-policy-impact-source-updates'), sourceUpdates);
			await page.screenshot({ path: path.join(output, 'same-cell-with-proposal.png') });
			return {
				...selected,
				cellId,
				beforeText,
				afterText,
				beforeColours,
				afterColours,
				sourceGeometryUnchanged: true
			};
		}
	);
	await check('Mobile comparison controls fit and remain accessible', async () => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.getByRole('button', { name: 'Close island planning panel', exact: true }).click();
		for (const [name, view] of [
			['Without proposal', 'before'],
			['With proposal', 'after']
		]) {
			await assertFullyVisible(page.getByRole('button', { name, exact: true }));
			await toggle(name, view);
		}
		assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
		await page.screenshot({ path: path.join(output, 'comparison-mobile.png') });
		await page.setViewportSize({ width: 1440, height: 1000 });
		return { viewport: '390x844', fullyVisibleButtons: true, horizontalOverflow: false };
	});
	await check('A transport-only stop does not invent healthcare gains', async () => {
		await budget.getByRole('button', { name: 'Undo proposal change', exact: true }).click();
		await expect(atlas).toHaveAttribute('data-policy-proposal-points', '0');
		await showProposal();
		const target = await site();
		await panel.getByRole('button', { name: 'Bus stop', exact: true }).click();
		await page.mouse.click(target.point.x, target.point.y);
		const editor = page.getByTestId('map-service-editor');
		await expect(editor).toHaveAttribute('data-service-mode', 'bus-connection');
		await editor.getByRole('button', { name: 'Add only a stop', exact: true }).click();
		await expect(confirmation).toHaveAttribute('aria-busy', 'false');
		await expect(confirmation.locator('.placement-access-preview strong')).toBeVisible();
		await confirmation.getByRole('button', { name: 'Add to proposal', exact: true }).click();
		await impactReady();
		await page.getByLabel('Access shown on map', { exact: true }).selectOption('healthcare');
		await expect.poll(() => evaluationResponses.at(-1)?.assumptions?.goal).toBe('healthcare');
		await impactReady();
		assert.equal(latestEvaluation().summary.gained_residents, 0);
		assert.equal(changedJourneys(latestEvaluation()).length, 0);
		assert.equal(Number(await atlas.getAttribute('data-policy-comparison-changed-cells')), 0);
		const without = await toggle('Without proposal', 'before');
		const withProposal = await toggle('With proposal', 'after');
		await page.screenshot({ path: path.join(output, 'stop-only-no-fake-gains.png') });
		return {
			summary: latestEvaluation().summary,
			diagnostics: await mapDiagnostics(),
			without,
			withProposal
		};
	});
	await check(
		'A frequency-only proposal preserves walking times and rendered neighbourhood colours',
		async () => {
			await budget.getByRole('button', { name: 'Undo proposal change', exact: true }).click();
			await expect(atlas).toHaveAttribute('data-policy-proposal-points', '0');
			await showProposal();
			await panel.getByRole('button', { name: /^Bus service/ }).click();
			const editor = page.getByTestId('map-service-editor');
			await expect(editor).toHaveAttribute('data-service-mode', 'bus');
			const route = baseline.patterns?.find(
				(pattern) => pattern.mode === 'bus' && pattern.name.startsWith('R1 ')
			);
			assert.ok(
				route,
				'The captured R1 service must be available to test a real frequency change.'
			);
			await editor.getByLabel('Bus route and direction', { exact: true }).selectOption(route.id);
			await editor.getByLabel('A bus every · min', { exact: true }).fill('15');
			await editor.getByRole('button', { name: 'Accept service', exact: true }).click();
			await impactReady();
			await page.getByLabel('Access shown on map', { exact: true }).selectOption('transport');
			await expect.poll(() => evaluationResponses.at(-1)?.assumptions?.goal).toBe('transport');
			await impactReady();
			// A real reload restores the saved draft and the full-island camera after route editing.
			await page.reload({ waitUntil: 'domcontentloaded' });
			await expect(atlas).toHaveAttribute('aria-busy', 'false');
			await impactReady();
			const value = latestEvaluation();
			assert.equal(changedJourneys(value).length, 0);
			assert.equal(value.summary.gained_residents, 0);
			assert.equal(value.summary.weighted_minutes_saved, 0);
			assert.ok(
				Number(value.economics.delta.annual_operating_mvr) > 0,
				'Changing the real timetable must still affect running costs.'
			);
			let sample;
			for (const row of value.origins) {
				if (row.before.minutes === null || row.before.minutes < 5 || !row.coordinates) continue;
				const point = await project(row.coordinates);
				if (await isClear(point)) {
					sample = row;
					break;
				}
			}
			assert.ok(
				sample,
				'An unchanged longer walk must be visible for independent screenshot comparison.'
			);
			await toggle('Without proposal', 'before');
			const beforeColours = await neighbourhoodColours(
				sample.coordinates,
				'frequency-cell-without-proposal.png'
			);
			await page.screenshot({ path: path.join(output, 'frequency-without-proposal.png') });
			await toggle('With proposal', 'after');
			const afterColours = await neighbourhoodColours(
				sample.coordinates,
				'frequency-cell-with-proposal.png'
			);
			assert.ok(
				Math.abs(beforeColours.meanRedMinusGreen - afterColours.meanRedMinusGreen) < 1,
				'An unchanged walk must keep its rendered colour after adding a frequency-only service.'
			);
			await page.screenshot({ path: path.join(output, 'frequency-with-proposal.png') });
			// A restored draft has no in-memory undo history; remove its saved item through the UI.
			await showProposal();
			await panel.getByRole('button', { name: /^Remove / }).click();
			await expect(atlas).toHaveAttribute('data-policy-impact-cells', '0');
			return {
				originId: sample.origin_id,
				walkMinutesBefore: sample.before.minutes,
				walkMinutesAfter: sample.after.minutes,
				changedJourneys: 0,
				beforeColours,
				afterColours,
				summary: value.summary,
				runningCostMvr: value.economics.delta.annual_operating_mvr
			};
		}
	);
	await check(
		'A pending bus connection can compare real access inside its map tooltip',
		async () => {
			await page.reload({ waitUntil: 'domcontentloaded' });
			await expect(atlas).toHaveAttribute('aria-busy', 'false');
			await expect(atlas).toHaveAttribute('data-policy-proposal-points', '0');
			await showProposal();
			const coordinates = [73.5379734, 4.2329967];
			const point = await project(coordinates);
			assert.ok(await isClear(point), 'The source-backed northern road must be visible.');
			await panel.getByRole('button', { name: 'Bus stop', exact: true }).click();
			await page.mouse.click(point.x, point.y);
			const editor = page.getByTestId('map-service-editor');
			await expect(editor).toHaveAttribute('data-service-mode', 'bus-connection');
			await expect(editor.locator('.service-access')).toBeVisible();
			await impactReady();
			assert.ok((latestEvaluation().summary.gained_residents ?? 0) > 0);
			const value = latestEvaluation();
			assert.equal(value.assumptions.goal, 'transport');
			const changed = changedJourneys(value);
			assert.ok(changed.length > 0 && changed.length < value.origins.length / 10);
			assert.ok(changed.every((row) => row.coordinates[1] > 4.23));
			assert.ok(
				value.origins
					.filter((row) => row.coordinates[1] < 4.22)
					.every(
						(row) =>
							row.before.minutes === row.after.minutes && row.before.status === row.after.status
					),
				'The new northern stop must preserve walking access in southern Hulhumalé.'
			);
			const sourceUpdates = await atlas.getAttribute('data-policy-impact-source-updates');
			for (const [name, view] of [
				['Without proposal', 'before'],
				['With proposal', 'after']
			]) {
				const action = editor.getByRole('button', { name, exact: true });
				await action.scrollIntoViewIfNeeded();
				await assertFullyVisible(action);
				await toggle(name, view);
				if (view === 'before')
					await page.screenshot({
						path: path.join(output, 'bus-preview-without-proposal-desktop.png')
					});
			}
			await page.screenshot({ path: path.join(output, 'bus-preview-comparison-desktop.png') });
			await page.setViewportSize({ width: 390, height: 844 });
			for (const [name, view] of [
				['Without proposal', 'before'],
				['With proposal', 'after']
			]) {
				const action = editor.getByRole('button', { name, exact: true });
				await action.scrollIntoViewIfNeeded();
				await assertFullyVisible(action);
				await toggle(name, view);
			}
			assert.equal(await atlas.getAttribute('data-policy-impact-source-updates'), sourceUpdates);
			await expect(atlas).toHaveAttribute('data-policy-proposal-points', '0');
			await page.screenshot({ path: path.join(output, 'bus-preview-comparison-mobile.png') });
			await editor.getByRole('button', { name: 'Cancel bus connection', exact: true }).click();
			await expect(atlas).toHaveAttribute('data-policy-impact-cells', '0');
			return {
				coordinates,
				gainingResidents: value.summary.gained_residents,
				changedJourneys: changed.length,
				totalOrigins: value.origins.length,
				affectedLatitudeRange: [
					Math.min(...changed.map((row) => row.coordinates[1])),
					Math.max(...changed.map((row) => row.coordinates[1]))
				],
				comparedWithoutCommitting: true,
				tooltipControlsFitDesktopAndMobile: true,
				sourceGeometryUnchanged: true
			};
		}
	);
	assert.deepEqual(report.pageErrors, []);
	report.finishedAt = new Date().toISOString();
	await save();
} catch (error) {
	report.failure = String(error);
	await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
	await save();
	throw error;
} finally {
	await browser.close();
}
