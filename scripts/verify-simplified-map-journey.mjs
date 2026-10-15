import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Exercise actual source-backed endpoints and genuine map interactions. No responses
// or application state are replaced. Movement positions may legitimately be absent.
const baseURL = process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5173';
const output = path.resolve('artifacts/qa/simplified-map-journey');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 60000 });
/** @type {{baseURL:string,startedAt:string,finishedAt?:string,checks:Array<{name:string,status:string,detail?:unknown}>,pageErrors:string[]}} */
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], pageErrors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1000 },
	reducedMotion: 'reduce'
});
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.on('pageerror', (error) => report.pageErrors.push(error.message));
const atlas = page.locator('.national-map');
const directions = page.getByRole('region', { name: 'Explore journey directions', exact: true });
const plan = page.getByRole('region', { name: 'Policy planning workbench', exact: true });
const proposalMap = page.getByRole('region', { name: 'Interactive proposal map', exact: true });
const tools = page.getByRole('tablist', { name: 'Map workspace tools', exact: true });
/** @param {string} name @param {()=>Promise<unknown>} work */
async function check(name, work) {
	console.log(`RUN ${name}`);
	try {
		const detail = await work();
		report.checks.push({ name, status: 'passed', detail });
		console.log(`PASS ${name}`);
	} catch (error) {
		report.checks.push({ name, status: 'failed', detail: String(error) });
		throw error;
	}
}
async function noOverflow() {
	await expect
		.poll(() =>
			page.evaluate(
				() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
			)
		)
		.toBe(true);
	return page.evaluate(() => ({
		width: innerWidth,
		document: document.documentElement.scrollWidth
	}));
}
/** @param {[number, number]} position */
async function project(position) {
	return atlas.evaluate((element, coordinates) => {
		const canvas = element.querySelector('.map-canvas');
		if (!canvas) throw new Error('Map canvas missing');
		const box = canvas.getBoundingClientRect();
		const zoom = Number(element.getAttribute('data-zoom'));
		const center = [
			Number(element.getAttribute('data-center-longitude')),
			Number(element.getAttribute('data-center-latitude'))
		];
		const worldSize = 512 * 2 ** zoom;
		/** @param {number} latitude */
		const mercatorY = (latitude) =>
			(1 - Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360)) / Math.PI) / 2;
		return {
			x: box.x + box.width / 2 + ((coordinates[0] - center[0]) * worldSize) / 360,
			y: box.y + box.height / 2 + (mercatorY(coordinates[1]) - mercatorY(center[1])) * worldSize
		};
	}, position);
}
/** @param {[number,number]} coordinates */
async function clickSourceLocation(coordinates) {
	let point = await project(coordinates);
	// Source stops can initially sit beneath the map legend. Use the visible zoom
	// control to bring that location into clear canvas space before placing it.
	for (let step = 0; step < 3; step++) {
		const canvasTarget = await page.evaluate(
			({ x, y }) => document.elementFromPoint(x, y)?.matches('.maplibregl-canvas') ?? false,
			point
		);
		if (canvasTarget) break;
		const previousZoom = Number(await atlas.getAttribute('data-zoom'));
		await atlas.getByRole('button', { name: 'Zoom out', exact: true }).click();
		await expect
			.poll(async () => Number(await atlas.getAttribute('data-zoom')))
			.toBeLessThan(previousZoom - 0.9);
		point = await project(coordinates);
	}
	assert.equal(
		await page.evaluate(
			({ x, y }) => document.elementFromPoint(x, y)?.matches('.maplibregl-canvas') ?? false,
			point
		),
		true,
		'Choose the source stop on unobscured map canvas'
	);
	await page.mouse.click(point.x, point.y);
}
/** @param {'start'|'end'} endpoint @param {[number,number]} coordinates */
async function chooseEndpoint(endpoint, coordinates) {
	if (await directions.isVisible())
		await directions
			.locator('.endpoint-choice')
			.nth(endpoint === 'start' ? 0 : 1)
			.click();
	await expect(atlas).toHaveClass(/is-picking/);
	const point = await project(coordinates);
	const box = await atlas.locator('.maplibregl-canvas').boundingBox();
	if (
		endpoint === 'end' &&
		box &&
		(point.x < box.x + 10 ||
			point.x > box.x + box.width - 10 ||
			point.y < box.y + 110 ||
			point.y > box.y + box.height - 40)
	) {
		for (let step = 0; step < 3; step++) {
			const previousZoom = Number(await atlas.getAttribute('data-zoom'));
			await atlas.getByRole('button', { name: 'Zoom out', exact: true }).click();
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-zoom')))
				.toBeLessThan(previousZoom - 0.9);
		}
	}
	await clickSourceLocation(coordinates);
	if (endpoint === 'end') {
		await expect(atlas).not.toHaveClass(/is-picking/);
		await expect(directions).toBeVisible();
	} else await expect(atlas.locator('.journey-drag-pin.start')).toBeVisible();
}
async function clickPlanCanvas() {
	const canvas = proposalMap.locator('.maplibregl-canvas');
	const box = await canvas.boundingBox();
	assert.ok(box);
	await canvas.click({ position: { x: box.width * 0.58, y: box.height * 0.55 } });
}
async function chooseSchoolPreview() {
	await clickPlanCanvas();
	const chooser = proposalMap.getByRole('region', { name: 'Choose what to add here', exact: true });
	await expect(chooser).toBeVisible();
	await chooser.getByRole('button', { name: 'School', exact: true }).click();
	await expect(
		proposalMap.getByRole('region', { name: 'Confirm proposed location', exact: true })
	).toBeVisible();
	await expect(proposalMap.locator('.planning-preview')).toBeVisible();
}
async function dragPreview() {
	const pin = proposalMap.locator('.planning-preview');
	await expect
		.poll(() =>
			pin.evaluate((element) => {
				const box = element.getBoundingClientRect();
				return (
					document
						.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
						?.closest('.planning-preview') === element
				);
			})
		)
		.toBe(true);
	const before = [
		await proposalMap.getAttribute('data-preview-longitude'),
		await proposalMap.getAttribute('data-preview-latitude')
	];
	const box = await pin.boundingBox();
	assert.ok(box);
	const startPoint = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
	const endPoint = await page.evaluate(({ x, y }) => {
		for (const [dx, dy] of [
			[35, 16],
			[35, -16],
			[-35, 16],
			[-35, -16]
		]) {
			const target = document.elementFromPoint(x + dx, y + dy);
			if (target?.matches('.maplibregl-canvas') || target?.closest('.planning-preview'))
				return { x: x + dx, y: y + dy };
		}
		return null;
	}, startPoint);
	assert.ok(endPoint, 'Preview needs a clear map destination for dragging');
	await page.mouse.move(startPoint.x, startPoint.y);
	await page.mouse.down();
	await page.mouse.move(endPoint.x, endPoint.y, { steps: 8 });
	await page.mouse.up();
	await expect
		.poll(async () => [
			await proposalMap.getAttribute('data-preview-longitude'),
			await proposalMap.getAttribute('data-preview-latitude')
		])
		.not.toEqual(before);
	await expect
		.poll(() =>
			pin.evaluate((element) => {
				const box = element.getBoundingClientRect();
				return (
					document
						.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
						?.closest('.planning-preview') === element
				);
			})
		)
		.toBe(true);
}

try {
	await page.goto(`${baseURL}/?view=map&tool=explore&profile=route&island=island%3A1443`, {
		waitUntil: 'domcontentloaded'
	});
	await expect(atlas).toHaveAttribute('aria-busy', 'false');
	await expect(directions).toBeVisible();
	const baselineResponse = await page.request.get(`${baseURL}/api/backend/planning/baseline`);
	assert.equal(baselineResponse.status(), 200);
	/** @type {{patterns:Array<{id:string,name:string,mode:string,stopIds:string[]}>,stops:Array<{id:string,name:string,lon:number,lat:number}>,origins:Array<{id:string,lon:number,lat:number}>}} */
	const baseline = await baselineResponse.json();
	const scopedBaseline = await (
		await page.request.get(`${baseURL}/api/backend/planning/baseline?island_id=island%3A1443`)
	).json();
	const pattern = baseline.patterns.find((item) => item.mode === 'bus' && item.stopIds.length > 12);
	assert.ok(pattern, 'The captured source must supply a bus pattern with enough located stops');
	const start = baseline.stops.find((stop) => stop.id === pattern.stopIds[0]);
	const end = baseline.stops.find((stop) => stop.id === pattern.stopIds[12]);
	assert.ok(start && end);
	/** @type {[number,number]} */
	const startCoordinates = [start.lon, start.lat];
	/** @type {[number,number]} */
	const endCoordinates = [end.lon, end.lat];
	await check(
		'Two primary map tools, clear endpoint selection, removal, swap and reset',
		async () => {
			await expect(tools.getByRole('tab')).toHaveCount(2);
			await expect(tools.getByRole('tab', { name: 'Explore', exact: true })).toBeVisible();
			await expect(tools.getByRole('tab', { name: 'Plan', exact: true })).toBeVisible();
			await chooseEndpoint('start', startCoordinates);
			await chooseEndpoint('end', endCoordinates);
			await expect(atlas).toHaveAttribute('data-journey-endpoints', '2');
			const before = {
				start: await atlas.locator('.journey-drag-pin.start').getAttribute('style'),
				end: await atlas.locator('.journey-drag-pin.end').getAttribute('style')
			};
			await directions
				.getByRole('button', { name: 'Swap start & destination', exact: true })
				.click();
			await expect(atlas).toHaveAttribute('data-journey-endpoints', '2');
			await expect
				.poll(() => atlas.locator('.journey-drag-pin.start').getAttribute('style'))
				.toBe(before.end);
			await expect
				.poll(() => atlas.locator('.journey-drag-pin.end').getAttribute('style'))
				.toBe(before.start);
			const labels = await directions.locator('.endpoint-choice').allTextContents();
			assert.equal(labels.length, 2);
			await directions.getByRole('button', { name: 'Back to map', exact: true }).click();
			await expect.poll(() => new URL(page.url()).searchParams.has('profile')).toBe(false);
			await expect(page.locator('.map-action-dock')).toBeVisible();
			await page
				.locator('.map-action-dock')
				.getByRole('button', { name: /Directions/i })
				.click();
			await expect(directions).toBeVisible();
			await expect(atlas).toHaveAttribute('data-journey-endpoints', '2');
			await page.getByRole('tab', { name: 'Island details', exact: true }).click();
			await expect.poll(() => new URL(page.url()).searchParams.has('profile')).toBe(false);
			await page.getByRole('tab', { name: 'Directions', exact: true }).click();
			await expect.poll(() => new URL(page.url()).searchParams.get('profile')).toBe('route');
			await expect(atlas).toHaveAttribute('data-journey-endpoints', '2');
			await directions.getByRole('button', { name: 'Remove start point', exact: true }).click();
			await expect(atlas).toHaveAttribute('data-journey-endpoints', '1');
			await expect(
				directions.getByRole('button', { name: 'Find directions', exact: true })
			).toBeDisabled();
			await directions.getByRole('button', { name: 'Reset', exact: true }).click();
			await expect(atlas).toHaveAttribute('data-journey-endpoints', '0');
			await expect(atlas.locator('.journey-drag-pin')).toHaveCount(0);
			return { sourcePattern: pattern.name, sourceStart: start.name, sourceEnd: end.name, before };
		}
	);
	await check(
		'Explore uses real scheduled buses and tells the user where to board and get off',
		async () => {
			await chooseEndpoint('start', startCoordinates);
			await chooseEndpoint('end', endCoordinates);
			await directions.locator('#route-mode').selectOption('transit');
			await directions.locator('#journey-date').fill('2026-10-10');
			await directions.locator('#journey-time').fill('15:20');
			const pending = page.waitForResponse(
				(response) =>
					response.url().includes('/api/backend/routing/land') &&
					response.request().method() === 'POST'
			);
			await directions.getByRole('button', { name: 'Find directions', exact: true }).click();
			const response = await pending;
			assert.equal(response.status(), 200);
			/** @type {import('../src/lib/types.js').LandRoute} */
			const body = await response.json();
			await writeFile(
				path.join(output, 'scheduled-bus-journey.json'),
				JSON.stringify(body, null, 2)
			);
			assert.equal(body.status, 'ok');
			assert.ok(body.journey);
			assert.equal(body.journey.uses_transit, true);
			const rides = body.journey.legs.filter((leg) => leg.mode === 'bus');
			assert.ok(rides.length);
			for (const ride of rides) {
				assert.equal(
					baseline.patterns.find((item) => item.id === ride.pattern_id)?.name,
					ride.route_name
				);
				await expect(directions.getByRole('list', { name: 'Step by step journey' })).toContainText(
					`Take ${ride.route_name}`
				);
				await expect(
					directions.locator('.boarding-copy').filter({ hasText: ride.from.name }).first()
				).toContainText(ride.to.name);
			}
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-journey-route-segments')))
				.toBeGreaterThan(0);
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-journey-transit-stops')))
				.toBeGreaterThan(0);
			await page.screenshot({ path: path.join(output, 'scheduled-bus-desktop.png') });
			return {
				minutes: body.journey.minutes,
				routes: rides.map((ride) => ride.route_name),
				boarded: rides.map((ride) => ride.from.name),
				alighted: rides.map((ride) => ride.to.name)
			};
		}
	);
	await check('Explore hands a map-selected place to Plan as an unconfirmed preview', async () => {
		await directions.getByRole('button', { name: 'Reset', exact: true }).click();
		await directions.getByRole('button', { name: 'Back to map', exact: true }).click();
		await expect.poll(() => new URL(page.url()).searchParams.has('profile')).toBe(false);
		await page.getByRole('button', { name: 'Create proposal', exact: true }).click();
		await expect(atlas).toHaveClass(/is-picking/);
		const origin = scopedBaseline.origins[Math.floor(scopedBaseline.origins.length / 2)];
		await clickSourceLocation([origin.lon, origin.lat]);
		await expect(proposalMap).toBeVisible();
		await expect(
			proposalMap.getByRole('region', { name: 'Confirm proposed location', exact: true })
		).toBeVisible();
		await expect(proposalMap).toHaveAttribute('data-draft-features', '0');
		await expect(plan.locator('#policy-inspector')).toBeHidden();
		await proposalMap
			.getByRole('region', { name: 'Confirm proposed location', exact: true })
			.getByRole('button', { name: 'Cancel', exact: true })
			.click();
		await plan.getByRole('button', { name: 'Back to Explore', exact: true }).click();
		await expect(atlas).toBeVisible();
		return { sourceOrigin: origin.id, addedWithoutConfirmation: false };
	});
	await check(
		'Confirmed plans have cancel, undo and reversible clear without a technical composer',
		async () => {
			await page.setViewportSize({ width: 1265, height: 721 });
			await tools.getByRole('tab', { name: 'Plan', exact: true }).click();
			await expect(proposalMap).toBeVisible();
			await expect
				.poll(async () => Number(await proposalMap.getAttribute('data-rendered-hexes')))
				.toBeGreaterThan(0);
			await expect(plan.locator('#policy-inspector')).toBeHidden();
			await expect(proposalMap).toHaveAttribute('data-draft-features', '0');
			await page.locator('header').scrollIntoViewIfNeeded();
			await expect
				.poll(async () => {
					const canvasBox = await proposalMap.boundingBox();
					return !!canvasBox && canvasBox.y > 0 && canvasBox.y + canvasBox.height <= 722;
				})
				.toBe(true);
			await chooseSchoolPreview();
			await dragPreview();
			const confirmationBox = await proposalMap.locator('.placement-popover').boundingBox();
			assert.ok(
				confirmationBox &&
					confirmationBox.y >= 0 &&
					confirmationBox.y + confirmationBox.height <= 722
			);
			await page.screenshot({ path: path.join(output, 'proposal-preview-1265.png') });
			await proposalMap
				.getByRole('region', { name: 'Confirm proposed location', exact: true })
				.getByRole('button', { name: 'Cancel', exact: true })
				.click();
			await expect(proposalMap.locator('.planning-preview')).toHaveCount(0);
			await expect(proposalMap).toHaveAttribute('data-draft-features', '0');
			await chooseSchoolPreview();
			await proposalMap
				.getByRole('region', { name: 'Confirm proposed location', exact: true })
				.getByRole('button', { name: 'Name, opening date & details', exact: true })
				.click();
			await expect(plan.locator('#policy-inspector')).toBeVisible();
			await plan.locator('#policy-name').fill('Community school QA');
			await plan.getByRole('button', { name: 'Back to pin to confirm', exact: true }).click();
			await proposalMap.getByRole('button', { name: 'Confirm place', exact: true }).click();
			await expect(proposalMap).toHaveAttribute('data-draft-features', '1');
			await expect(proposalMap.locator('.planning-preview')).toHaveCount(0);
			await proposalMap.getByRole('button', { name: 'Undo', exact: true }).click();
			await expect(proposalMap).toHaveAttribute('data-draft-features', '0');
			await chooseSchoolPreview();
			await proposalMap.getByRole('button', { name: 'Confirm place', exact: true }).click();
			await proposalMap.getByRole('button', { name: 'Clear draft', exact: true }).click();
			await expect(proposalMap).toHaveAttribute('data-draft-features', '0');
			await proposalMap.getByRole('button', { name: 'Undo', exact: true }).click();
			await expect(proposalMap).toHaveAttribute('data-draft-features', '1');
			await page.screenshot({ path: path.join(output, 'confirmed-plan-desktop.png') });
			const viewport = await noOverflow();
			await page.setViewportSize({ width: 1440, height: 1000 });
			return viewport;
		}
	);
	await check(
		'Review impact runs the actual backend and preserves the draft across Explore navigation',
		async () => {
			const pending = page.waitForResponse(
				(response) =>
					response.url().includes('/api/backend/planning/evaluate') &&
					response.request().method() === 'POST'
			);
			await proposalMap.getByRole('button', { name: 'Review impact', exact: true }).click();
			const response = await pending;
			assert.equal(response.status(), 200, await response.text());
			const evaluation = await response.json();
			await writeFile(
				path.join(output, 'proposal-impact.json'),
				JSON.stringify(evaluation, null, 2)
			);
			assert.equal(evaluation.origins.length, scopedBaseline.origins.length);
			await expect(proposalMap).toHaveAttribute('data-status', 'latest');
			await expect(plan.locator('#policy-inspector')).toBeVisible();
			await expect
				.poll(() => plan.locator('#policy-inspector').evaluate((element) => element.scrollTop))
				.toBe(0);
			await expect(plan.locator('.policy-workflow-note')).toContainText('Impact updated');
			const metrics = plan.locator('.policy-metrics');
			await expect(metrics).toBeVisible();
			assert.equal(
				await metrics.evaluate((element) =>
					[...element.querySelectorAll('strong')].every(
						(value) => value.scrollWidth <= value.clientWidth + 1
					)
				),
				true,
				'Impact values must fit their cards without clipping'
			);
			await page.screenshot({ path: path.join(output, 'impact-desktop.png') });
			await plan.getByRole('button', { name: 'Back to Explore', exact: true }).click();
			await expect(atlas).toBeVisible();
			await tools.getByRole('tab', { name: 'Plan', exact: true }).click();
			await expect(proposalMap).toHaveAttribute('data-draft-features', '1');
			return { origins: evaluation.origins.length, summary: evaluation.summary };
		}
	);
	await check(
		'Supporting tools live under Explore and legacy deep links remain usable',
		async () => {
			await page.goto(`${baseURL}/?view=map&tool=live&island=island%3A1443`, {
				waitUntil: 'domcontentloaded'
			});
			await expect(
				page.getByRole('button', { name: 'Back to Explore map', exact: true })
			).toBeVisible();
			await expect(page.locator('.explore-tool-title')).toContainText('Weather');
			await expect(tools.getByRole('tab', { name: 'Explore', exact: true })).toHaveAttribute(
				'data-state',
				'active'
			);
			await page.getByRole('button', { name: 'Back to Explore map', exact: true }).click();
			await expect(atlas).toBeVisible();
			await expect(
				page.getByRole('button', { name: 'Weather & traffic', exact: true })
			).toBeVisible();
			await page.goto(`${baseURL}/?view=map&tool=places&island=island%3A1443`, {
				waitUntil: 'domcontentloaded'
			});
			await expect(page.locator('.places-workspace')).toBeVisible();
			await expect(tools.getByRole('tab')).toHaveCount(2);
			await page.getByRole('button', { name: 'Back to Explore map', exact: true }).click();
			await expect(atlas).toBeVisible();
			return noOverflow();
		}
	);
	await check(
		'Mobile map, endpoint controls and planning preview stay within the viewport',
		async () => {
			await page.setViewportSize({ width: 390, height: 844 });
			await page.goto(`${baseURL}/?view=map&tool=explore&profile=route&island=island%3A1443`, {
				waitUntil: 'domcontentloaded'
			});
			await expect(directions).toBeVisible();
			await noOverflow();
			await page.screenshot({ path: path.join(output, 'directions-mobile.png') });
			await tools.getByRole('tab', { name: 'Plan', exact: true }).click();
			await expect(proposalMap).toBeVisible();
			const hideDetails = plan.getByRole('button', { name: 'Hide details', exact: true });
			if (await hideDetails.isVisible()) await hideDetails.click();
			await plan.getByRole('button', { name: 'Changes', exact: true }).click();
			await plan.getByRole('button', { name: 'Hide details', exact: true }).click();
			await proposalMap.getByRole('button', { name: 'Clear draft', exact: true }).click();
			await chooseSchoolPreview();
			const popup = proposalMap.locator('.placement-popover');
			await dragPreview();
			const box = await popup.boundingBox();
			assert.ok(
				box && box.x >= 0 && box.x + box.width <= 391,
				'Confirmation actions must be reachable without horizontal scrolling'
			);
			await page.screenshot({ path: path.join(output, 'proposal-preview-mobile.png') });
			await popup.getByRole('button', { name: 'Cancel', exact: true }).click();
			return noOverflow();
		}
	);
	assert.deepEqual(report.pageErrors, []);
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
			pageErrors: report.pageErrors,
			report: path.join(output, 'verification.json')
		})
	);
}
