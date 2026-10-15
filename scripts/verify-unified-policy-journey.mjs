import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Verify real endpoint evidence, user gestures and the downloaded decision brief.
// This journey does not replace responses, inject application state or fabricate access.
const baseURL = process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5173';
const output = path.resolve('artifacts/qa/unified-policy-journey');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 90000 });
/** @type {{baseURL:string,startedAt:string,finishedAt?:string,checks:Array<{name:string,status:string,detail?:unknown}>,pageErrors:string[]}} */
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], pageErrors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1000 },
	reducedMotion: 'reduce'
});
const page = await context.newPage();
page.setDefaultTimeout(90000);
page.on('pageerror', (error) => report.pageErrors.push(error.message));
const atlas = page.locator('.national-map');
const priorities = page.getByRole('region', { name: 'Policy priorities', exact: true });
const panel = page.getByRole('region', { name: 'Island needs and proposal', exact: true });
const budget = page.getByRole('region', { name: 'Proposal budget', exact: true });
const review = page.locator('dialog.forecast-review');
const mapColours = page.getByRole('combobox', { name: 'Map colours', exact: true });

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
		viewport: innerWidth,
		document: document.documentElement.scrollWidth
	}));
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
/** @param {string} domain */
async function selectSector(domain) {
	const action = priorities.locator(`.sector-${domain} .sector-action`);
	if ((await action.getAttribute('aria-pressed')) !== 'true') await action.click();
	await expect(action).toHaveAttribute('aria-pressed', 'true');
}
async function mapView() {
	return atlas.evaluate((element) => ({
		longitude: element.getAttribute('data-center-longitude'),
		latitude: element.getAttribute('data-center-latitude'),
		zoom: element.getAttribute('data-zoom')
	}));
}
/** @param {[number, number]} coordinates */
async function project(coordinates) {
	return atlas.evaluate((element, location) => {
		const canvas = element.querySelector('.maplibregl-canvas');
		if (!canvas) throw new Error('Map canvas is missing');
		const box = canvas.getBoundingClientRect();
		const zoom = Number(element.getAttribute('data-zoom'));
		const center = [
			Number(element.getAttribute('data-center-longitude')),
			Number(element.getAttribute('data-center-latitude'))
		];
		const padding = Object.fromEntries(
			['top', 'right', 'bottom', 'left'].map((side) => [
				side,
				Number(element.getAttribute(`data-camera-padding-${side}`))
			])
		);
		const world = 512 * 2 ** zoom;
		/** @param {number} latitude */
		const y = (latitude) =>
			(1 - Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360)) / Math.PI) / 2;
		return {
			x:
				box.x +
				(box.width + padding.left - padding.right) / 2 +
				((location[0] - center[0]) * world) / 360,
			y:
				box.y +
				(box.height + padding.top - padding.bottom) / 2 +
				(y(location[1]) - y(center[1])) * world
		};
	}, coordinates);
}
/** @param {Array<{geometry?:Array<[number,number]>}>} roads */
async function chooseVisibleRoad(roads) {
	const canvas = await atlas.locator('.maplibregl-canvas').boundingBox();
	assert.ok(canvas);
	for (const road of roads)
		for (const coordinates of road.geometry ?? []) {
			const point = await project(coordinates);
			if (
				point.x < canvas.x + 40 ||
				point.x > canvas.x + canvas.width - 40 ||
				point.y < canvas.y + 150 ||
				point.y > canvas.y + canvas.height - 100
			)
				continue;
			if (
				await page.evaluate(
					({ x, y }) => document.elementFromPoint(x, y)?.matches('.maplibregl-canvas') ?? false,
					point
				)
			)
				return { point, coordinates };
		}
	throw new Error('A source-backed road location must be unobscured before placing a change.');
}

/** Decode ReportLab's standard ASCII85 stream without an optional PDF dependency. @param {Buffer} buffer */
function ascii85(buffer) {
	const input = buffer.toString('ascii').replace(/\s/g, '').replace(/^<~/, '').replace(/~>$/, '');
	/** @type {number[]} */ const result = [];
	/** @type {number[]} */ let group = [];
	for (const character of input) {
		if (character === 'z' && !group.length) {
			result.push(0, 0, 0, 0);
			continue;
		}
		const value = character.charCodeAt(0) - 33;
		if (value < 0 || value > 84) continue;
		group.push(value);
		if (group.length === 5) {
			const value = group.reduce((sum, digit) => sum * 85 + digit, 0);
			result.push((value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255);
			group = [];
		}
	}
	if (group.length) {
		const count = group.length;
		while (group.length < 5) group.push(84);
		const value = group.reduce((sum, digit) => sum * 85 + digit, 0);
		result.push(
			...[(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].slice(
				0,
				count - 1
			)
		);
	}
	return Buffer.from(result);
}
/** @param {Buffer} bytes */
function pdfStreams(bytes) {
	const raw = bytes.toString('latin1');
	const decoded = [];
	for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)endstream/g)) {
		const header = raw.slice(Math.max(0, (match.index ?? 0) - 500), match.index);
		let stream = Buffer.from(match[1].replace(/\r?\n$/, ''), 'latin1');
		try {
			if (header.includes('/ASCII85Decode')) stream = ascii85(stream);
			if (header.includes('/FlateDecode')) stream = inflateSync(stream);
			decoded.push(stream.toString('latin1'));
		} catch {
			/* Font streams need not be interpreted to verify the actual report page. */
		}
	}
	return decoded.join('\n');
}

try {
	const response = await page.request.get(`${baseURL}/api/backend/planning/opportunities`);
	assert.equal(
		response.status(),
		200,
		'The new planning endpoint must be reachable through the frontend proxy'
	);
	/** @type {{islands:Array<{island_id:string,name:string,atoll:string,category:string,planning_supported:boolean,domains:Record<string,{status:string}>}>,summary:{island_count:number},features:{features:unknown[]}}} */
	const opportunities = await response.json();
	assert.ok(opportunities.summary.island_count > 0);
	const supported = opportunities.islands.filter(
		(island) => island.planning_supported && island.category === 'Residential Island'
	);
	const target = supported.find((island) => island.island_id === 'island:1442') ?? supported[0];
	assert.ok(target, 'A supported source-backed island is required for an impact forecast');
	const domain =
		['transport', 'health', 'education'].find(
			(domain) => target.domains[domain].status === 'review'
		) ?? 'transport';
	const queue = target.domains[domain].status === 'review' ? 'Review access' : 'Need more data';
	const baselineResponse = await page.request.get(
		`${baseURL}/api/backend/planning/baseline?island_id=${encodeURIComponent(target.island_id)}`
	);
	assert.equal(baselineResponse.status(), 200);
	/** @type {{graph_edges:Array<{geometry?:Array<[number,number]>}>,origins:Array<{lon:number,lat:number}>}} */
	const baseline = await baselineResponse.json();
	const residentLocations = baseline.origins.map(
		(origin) => /** @type {[number,number]} */ ([origin.lon, origin.lat])
	);
	await page.goto(`${baseURL}/?view=overview`, { waitUntil: 'domcontentloaded' });
	await expect(priorities).toHaveAttribute('aria-busy', 'false');
	await check(
		'Analytics distinguishes review signals from missing evidence and hands the chosen service to the same map',
		async () => {
			await expect(
				priorities.locator('.screening-legend').getByText('Need more data', { exact: true })
			).toBeVisible();
			await selectSector(domain);
			await priorities.getByRole('button', { name: new RegExp(`^${queue}`) }).click();
			await priorities
				.getByRole('textbox', { name: 'Search priority islands', exact: true })
				.fill(target.name);
			const row = priorities.locator(`[data-policy-opportunity-id="${target.island_id}"]`);
			await expect(row).toBeVisible();
			await noOverflow();
			await page.screenshot({ path: path.join(output, 'analytics-desktop.png'), fullPage: true });
			await row
				.getByRole('button', { name: `Inspect ${target.name} service gaps on map`, exact: true })
				.click();
			await expect(atlas).toBeVisible();
			await expect(atlas).toHaveAttribute('aria-busy', 'false');
			await expect(panel).toBeVisible();
			await expect(
				page.locator('.policy-lens-bar').getByRole('button', {
					name: domain === 'health' ? 'Health' : domain === 'education' ? 'Education' : 'Transport',
					exact: true
				})
			).toHaveAttribute('aria-pressed', 'true');
			await expect(page.getByRole('tab', { name: 'Plan', exact: true })).toHaveCount(0);
			return { island: target.island_id, lens: domain, ...(await noOverflow()) };
		}
	);
	await check(
		'Island needs are legible on a colored map and weather stays over that map',
		async () => {
			await expect(panel.locator('.policy-need-row')).toHaveCount(3);
			await expect(panel.locator('.policy-population')).toBeVisible();
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-policy-gap-cells')))
				.toBeGreaterThan(opportunities.features.features.length);
			await expect(atlas).toHaveAttribute('data-policy-lens', domain);
			await page.screenshot({ path: path.join(output, 'service-gaps-desktop.png') });
			await panel.getByRole('button', { name: 'Close island planning panel', exact: true }).click();
			await page.getByRole('button', { name: 'Weather & traffic', exact: true }).click();
			const weatherPanel = page.getByRole('region', {
				name: 'Weather and traffic on this map',
				exact: true
			});
			await expect(weatherPanel).toBeVisible();
			await expect(atlas).toBeVisible();
			await expect(page.locator('.map-workspace')).toBeVisible();
			assert.equal(new URL(page.url()).searchParams.get('view'), 'map');
			await page.screenshot({ path: path.join(output, 'weather-map-desktop.png') });
			await weatherPanel
				.getByRole('button', { name: 'Close weather and traffic', exact: true })
				.click();
			return {
				gapFeatures: Number(await atlas.getAttribute('data-policy-gap-cells')),
				...(await noOverflow())
			};
		}
	);
	await check(
		'Selecting a local service-gap cell explains the neighbourhood without moving the map',
		async () => {
			const location = await chooseVisibleRoad([{ geometry: residentLocations }]);
			const before = await mapView();
			await page.mouse.click(location.point.x, location.point.y);
			await expect(panel.locator('.policy-selected-cell')).toBeVisible();
			await expect(panel.locator('.policy-selected-cell')).toContainText('Selected neighbourhood');
			assert.deepEqual(
				await mapView(),
				before,
				'Inspecting a local cell must preserve the map location and scale'
			);
			return { coordinates: location.coordinates, view: before };
		}
	);
	await check(
		'A budget produces mapped suggestions that become a costed draft only after acceptance',
		async () => {
			await panel.getByRole('button', { name: 'Build a funded proposal', exact: true }).click();
			await expect(panel).toHaveAttribute('data-policy-section', 'proposal');
			await panel
				.getByRole('textbox', { name: 'Proposal name', exact: true })
				.fill('Hulhumale policy investment QA');
			await panel.getByLabel('Capital budget · MVR', { exact: true }).fill('200000000');
			await panel.getByLabel('Annual running budget · MVR', { exact: true }).fill('50000000');
			await panel
				.getByRole('button', { name: 'Suggest investments within my budget', exact: true })
				.click();
			const suggestions = panel.locator('.policy-suggestion');
			await expect(suggestions).toBeVisible();
			await expect
				.poll(async () => Number(await suggestions.getAttribute('data-suggestion-count')))
				.toBeGreaterThan(0);
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-policy-proposal-points')))
				.toBeGreaterThan(0);
			await expect(atlas.locator('.policy-proposal-marker.confirmed').first()).toBeAttached();
			assert.equal(
				await budget.count(),
				0,
				'Suggestion preview must not silently become an accepted budget commitment'
			);
			await panel.getByLabel('Capital budget · MVR', { exact: true }).fill('205000000');
			await expect(suggestions).toHaveCount(0);
			await expect(atlas).toHaveAttribute('data-policy-proposal-points', '0');
			await panel.getByLabel('Capital budget · MVR', { exact: true }).fill('200000000');
			await panel
				.getByRole('button', { name: 'Suggest investments within my budget', exact: true })
				.click();
			await expect(suggestions).toBeVisible();
			await page.screenshot({ path: path.join(output, 'budget-suggestions-desktop.png') });
			await suggestions.getByRole('button', { name: 'Use this draft', exact: true }).click();
			await expect(panel.locator('.policy-operation-list li').first()).toBeVisible();
			await expect(budget).toBeVisible();
			await completedEstimate();
			await expect(mapColours).toHaveValue('impact');
			return {
				changes: await panel.locator('.policy-operation-list li').count(),
				costs: await budget.locator('.cost-values').innerText(),
				mapPoints: Number(await atlas.getAttribute('data-policy-proposal-points')),
				impactCells: Number(await atlas.getAttribute('data-policy-impact-cells'))
			};
		}
	);
	await check(
		'Manual placement uses an actual road position, confirms the change and updates the budget',
		async () => {
			const previousCount = await panel.locator('.policy-operation-list li').count();
			const previousCosts = await budget.locator('.cost-values').innerText();
			const previousPoints = Number(await atlas.getAttribute('data-policy-proposal-points'));
			await panel
				.locator('.policy-palette')
				.getByRole('button', { name: 'Bus stop', exact: true })
				.click();
			const location = await chooseVisibleRoad(baseline.graph_edges);
			await page.mouse.click(location.point.x, location.point.y);
			await expect(panel.locator('.policy-placement-confirm')).toBeVisible();
			await expect(atlas).toHaveAttribute('data-policy-pending-points', '1');
			await expect(atlas.locator('.policy-proposal-marker.pending')).toBeAttached();
			await panel
				.locator('.policy-placement-confirm')
				.getByRole('button', { name: 'Add to proposal', exact: true })
				.click();
			await expect(panel.locator('.policy-operation-list li')).toHaveCount(previousCount + 1);
			await expect(atlas).toHaveAttribute('data-policy-pending-points', '0');
			await expect(atlas).toHaveAttribute(
				'data-policy-proposal-points',
				String(previousPoints + 1)
			);
			await expect.poll(() => budget.locator('.cost-values').innerText()).not.toBe(previousCosts);
			await completedEstimate();
			await page.screenshot({ path: path.join(output, 'proposal-budget-desktop.png') });
			return {
				placedAt: location.coordinates,
				changes: previousCount + 1,
				costs: await budget.locator('.cost-values').innerText(),
				mapPoints: Number(await atlas.getAttribute('data-policy-proposal-points')),
				impactCells: Number(await atlas.getAttribute('data-policy-impact-cells'))
			};
		}
	);
	await check(
		'Current gaps and proposal impact stay distinct, preserve the draft and explain cells without moving the map',
		async () => {
			const costs = await budget.locator('.cost-values').innerText();
			const operationCount = await panel.locator('.policy-operation-list li').count();
			const pointCount = await atlas.getAttribute('data-policy-proposal-points');
			const impactCount = await atlas.getAttribute('data-policy-impact-cells');
			assert.ok(impactCount && Number(impactCount) > 0);
			const initialView = await mapView();
			const lensBar = page.locator('.policy-lens-bar');
			await expect(mapColours).toHaveValue('impact');
			await expect(atlas.getByLabel('Proposal impact colours', { exact: true })).toBeVisible();
			await expect(lensBar.locator('button[aria-pressed="true"]')).toHaveCount(0);
			await mapColours.selectOption('gaps');
			await expect(atlas).toHaveAttribute('data-policy-impact-cells', '0');
			await expect(atlas.getByLabel('Service gap colours', { exact: true })).toBeVisible();
			await expect(
				lensBar.getByRole('button', {
					name: domain === 'health' ? 'Health' : domain === 'education' ? 'Education' : 'Transport',
					exact: true
				})
			).toHaveAttribute('aria-pressed', 'true');
			await mapColours.selectOption('impact');
			await expect(atlas).toHaveAttribute('data-policy-impact-cells', impactCount);
			await lensBar.getByRole('button', { name: 'Health', exact: true }).click();
			await expect(mapColours).toHaveValue('gaps');
			await expect(atlas).toHaveAttribute('data-policy-impact-cells', '0');
			await expect(atlas).toHaveAttribute('data-policy-lens', 'health');
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-policy-gap-cells')))
				.toBeGreaterThan(opportunities.features.features.length);
			await expect(lensBar.getByRole('button', { name: 'Health', exact: true })).toHaveAttribute(
				'aria-pressed',
				'true'
			);
			await mapColours.selectOption('impact');
			await expect(atlas).toHaveAttribute('data-policy-impact-cells', impactCount);
			await expect(atlas.getByLabel('Proposal impact colours', { exact: true })).toBeVisible();
			await expect(lensBar.locator('button[aria-pressed="true"]')).toHaveCount(0);
			await panel.getByRole('button', { name: 'Service gaps', exact: true }).click();
			await expect(mapColours).toHaveValue('gaps');
			await expect(atlas).toHaveAttribute('data-policy-impact-cells', '0');
			await panel.getByRole('button', { name: /^Your proposal/ }).click();
			await expect(mapColours).toHaveValue('impact');
			await expect(atlas).toHaveAttribute('data-policy-impact-cells', impactCount);
			await expect(panel.locator('.policy-operation-list li')).toHaveCount(operationCount);
			await expect(atlas).toHaveAttribute('data-policy-proposal-points', pointCount ?? '');
			assert.equal(
				await budget.locator('.cost-values').innerText(),
				costs,
				'Changing map colours must preserve the proposal costs'
			);
			assert.deepEqual(
				await mapView(),
				initialView,
				'Changing map colours and service lenses must preserve the camera'
			);
			const location = await chooseVisibleRoad([{ geometry: residentLocations }]);
			const before = await mapView();
			await page.mouse.click(location.point.x, location.point.y);
			const selected = panel.getByLabel('Selected neighbourhood impact', { exact: true });
			await expect(selected).toBeVisible();
			await expect(selected).toContainText('Access change here');
			assert.deepEqual(
				await mapView(),
				before,
				'Inspecting impact must preserve the map location and scale'
			);
			await panel.getByRole('button', { name: /^Your proposal/ }).click();
			return {
				coordinates: location.coordinates,
				view: before,
				colourModes: ['gaps', 'impact'],
				inspectedLens: 'health',
				impactCells: Number(impactCount),
				unchangedCosts: costs
			};
		}
	);
	await check(
		'Full-page impact explains costs, resident reach and uncertainty and exports actual PDF report content',
		async () => {
			await budget.getByRole('button', { name: 'Review full impact', exact: true }).click();
			await expect(review).toBeVisible();
			await expect(review.locator('.headline-metrics')).toBeVisible();
			await expect(review.getByRole('button', { name: 'Save as PDF', exact: true })).toBeEnabled();
			await page.screenshot({ path: path.join(output, 'forecast-review-desktop.png') });
			const downloadPromise = page.waitForEvent('download');
			await review.getByRole('button', { name: 'Save as PDF', exact: true }).click();
			const download = await downloadPromise;
			const pdfPath = path.join(output, 'policy-decision-brief.pdf');
			await download.saveAs(pdfPath);
			const bytes = await readFile(pdfPath);
			assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
			assert.ok(bytes.length > 3000);
			const content = pdfStreams(bytes);
			assert.match(
				content,
				/Hulhumale policy investment QA/,
				'PDF page content must contain the chosen proposal title'
			);
			assert.match(content, /MVR/, 'PDF page content must include financial amounts');
			assert.match(content, /resident/i, 'PDF page content must include the resident impact');
			await review.getByRole('button', { name: 'Back to map', exact: true }).click();
			await expect(atlas).toBeVisible();
			return { pdf: pdfPath, bytes: bytes.length, decodedPageContent: content.length };
		}
	);
	await check(
		'A user-edited draft restores budgets, travel assumptions and priorities after reload',
		async () => {
			const count = await panel.locator('.policy-operation-list li').count();
			await panel.getByLabel('Capital budget · MVR', { exact: true }).fill('210000000');
			await panel.getByLabel('Annual running budget · MVR', { exact: true }).fill('55000000');
			await panel
				.getByLabel("Compare residents' access to", { exact: true })
				.selectOption('education');
			await panel
				.locator('.policy-priorities')
				.getByRole('button', { name: 'Education', exact: true })
				.click();
			await panel.getByText('Travel target, date & assumptions', { exact: true }).click();
			await panel.getByLabel('Travel target · minutes', { exact: true }).fill('35');
			await panel.getByLabel('Departure time', { exact: true }).fill('09:15');
			await panel.getByLabel('Service date', { exact: true }).fill('2026-10-12');
			await expect(panel.getByLabel('Service date', { exact: true })).toHaveValue('2026-10-12');
			await page.reload({ waitUntil: 'domcontentloaded' });
			await expect(atlas).toBeVisible();
			await page.getByRole('button', { name: 'Create proposal', exact: true }).click();
			await expect(panel.locator('.policy-operation-list li')).toHaveCount(count);
			await expect(panel.getByLabel('Proposal name', { exact: true })).toHaveValue(
				'Hulhumale policy investment QA'
			);
			await expect(panel.getByLabel('Capital budget · MVR', { exact: true })).toHaveValue(
				'210000000'
			);
			await expect(panel.getByLabel('Annual running budget · MVR', { exact: true })).toHaveValue(
				'55000000'
			);
			await expect(panel.getByLabel("Compare residents' access to", { exact: true })).toHaveValue(
				'education'
			);
			await expect(
				panel.locator('.policy-priorities').getByRole('button', { name: 'Education', exact: true })
			).toHaveAttribute('aria-pressed', 'false');
			await expect(
				panel.locator('.policy-priorities').getByRole('button', { name: 'Health', exact: true })
			).toHaveAttribute('aria-pressed', 'true');
			await expect(
				panel.locator('.policy-priorities').getByRole('button', { name: 'Transport', exact: true })
			).toHaveAttribute('aria-pressed', 'true');
			await panel.getByText('Travel target, date & assumptions', { exact: true }).click();
			await expect(panel.getByLabel('Travel target · minutes', { exact: true })).toHaveValue('35');
			await expect(panel.getByLabel('Departure time', { exact: true })).toHaveValue('09:15');
			await expect(panel.getByLabel('Service date', { exact: true })).toHaveValue('2026-10-12');
			await panel
				.getByLabel("Compare residents' access to", { exact: true })
				.selectOption('healthcare');
			await completedEstimate();
			await expect(mapColours).toHaveValue('impact');
			return {
				changes: count,
				capitalBudget: 210000000,
				annualBudget: 55000000,
				date: '2026-10-12',
				departure: '09:15',
				targetMinutes: 35,
				priorities: ['transport', 'health']
			};
		}
	);
	await check(
		'Mobile analytics, colored map and forecast keep actions reachable without horizontal overflow',
		async () => {
			await page.setViewportSize({ width: 390, height: 844 });
			await page.goto(`${baseURL}/?view=overview`, { waitUntil: 'domcontentloaded' });
			await expect(priorities).toHaveAttribute('aria-busy', 'false');
			await noOverflow();
			await page.screenshot({ path: path.join(output, 'analytics-mobile.png'), fullPage: true });
			await selectSector(domain);
			await priorities.getByRole('button', { name: new RegExp(`^${queue}`) }).click();
			await priorities
				.getByRole('textbox', { name: 'Search priority islands', exact: true })
				.fill(target.name);
			await priorities
				.locator(`[data-policy-opportunity-id="${target.island_id}"]`)
				.getByRole('button')
				.click();
			await expect(panel).toBeVisible();
			await expect(panel.locator('.policy-population')).toBeVisible();
			await expect(panel.getByText('Loading island evidence…', { exact: true })).toHaveCount(0);
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-policy-gap-cells')))
				.toBeGreaterThan(opportunities.features.features.length);
			await noOverflow();
			await page.screenshot({ path: path.join(output, 'service-gaps-mobile.png') });
			await panel.getByRole('button', { name: /^Your proposal/ }).click();
			await expect(budget).toBeVisible();
			await completedEstimate();
			await expect(mapColours).toHaveValue('impact');
			await expect(mapColours).toBeInViewport();
			const colourBounds = await mapColours.boundingBox();
			assert.ok(
				colourBounds && colourBounds.x >= 0 && colourBounds.x + colourBounds.width <= 390,
				'The mobile map-colours selector must fit within the viewport'
			);
			await expect
				.poll(
					async () => (await panel.locator('.policy-panel-scroll').boundingBox())?.height ?? 0,
					{ message: 'The mobile cost summary must leave enough space to edit the proposal form' }
				)
				.toBeGreaterThanOrEqual(140);
			await expect(
				budget.getByRole('button', { name: 'Review full impact', exact: true })
			).toBeInViewport();
			await page.screenshot({ path: path.join(output, 'proposal-budget-mobile.png') });
			await budget.getByRole('button', { name: 'Review full impact', exact: true }).click();
			await expect(review).toBeVisible();
			await expect(review.getByRole('button', { name: 'Save as PDF', exact: true })).toBeEnabled();
			await expect(review.locator('.headline-metrics')).toBeVisible();
			await noOverflow();
			await page.screenshot({ path: path.join(output, 'forecast-review-mobile.png') });
			await review.getByRole('button', { name: 'Back to map', exact: true }).click();
			const existingCosts = await budget.locator('.cost-values').innerText();
			await page.getByLabel('Open workspace menu', { exact: true }).click();
			await page
				.getByRole('navigation', { name: 'Workspace', exact: true })
				.getByRole('button', { name: 'Analytics', exact: true })
				.click();
			await expect(priorities).toHaveAttribute('aria-busy', 'false');
			await selectSector(domain);
			await priorities.getByRole('button', { name: new RegExp(`^${queue}`) }).click();
			await priorities
				.getByRole('textbox', { name: 'Search priority islands', exact: true })
				.fill(target.name);
			await priorities
				.locator(`[data-policy-opportunity-id="${target.island_id}"]`)
				.getByRole('button')
				.click();
			await expect(panel).toBeVisible();
			await expect(atlas).toHaveAttribute('data-policy-lens', domain);
			await expect(mapColours).toHaveValue('gaps', { timeout: 15000 });
			await expect(atlas).toHaveAttribute('data-policy-impact-cells', '0');
			await panel.getByRole('button', { name: /^Your proposal/ }).click();
			await expect(panel.getByLabel('Proposal name', { exact: true })).toHaveValue(
				'Hulhumale policy investment QA'
			);
			await expect(mapColours).toHaveValue('impact');
			assert.equal(
				await budget.locator('.cost-values').innerText(),
				existingCosts,
				'Returning from Analytics must preserve the accepted proposal costs'
			);
			return {
				...(await noOverflow()),
				sameIslandAnalyticsReturn: true,
				preservedProposalCosts: existingCosts
			};
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
