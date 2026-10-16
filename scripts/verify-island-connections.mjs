import { browserBaseURL } from './browser-config.mjs';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Run against npm start. Every result below comes from the real local API and UI.
const baseURL = browserBaseURL();
const output = path.resolve('artifacts/qa/island-connections');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 60000 });
/** @type {{baseURL:string,startedAt:string,finishedAt?:string,checks:Array<{name:string,status:string,detail?:unknown}>,pageErrors:string[],failure?:string}} */
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], pageErrors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1000 },
	reducedMotion: 'reduce',
	acceptDownloads: true
});
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.on('pageerror', (error) => report.pageErrors.push(error.message));
const atlas = page.locator('.national-map');
const journey = page.getByRole('region', { name: 'Explore journey directions', exact: true });
const connections = page.getByRole('region', { name: 'Island connections', exact: true });
const planning = page.getByRole('region', { name: 'Island needs and proposal', exact: true });
const composer = page.getByRole('region', { name: 'Plan a ferry service', exact: true });
const navigation = page.getByRole('navigation', { name: 'Workspace', exact: true });
const serviceDay = '2026-10-10';
const capitalBudget = 1000000000;
const annualBudget = 1000000000;
/** @type {import('../src/lib/transport-impact.js').TransportImpactData | null} */
let acceptedFerryImpact = null;
/** @type {Array<{request: typeof ferryPayload, body: any}>} */
const ferryResponses = [];
page.on('response', async (response) => {
	if (
		new URL(response.url()).pathname !== '/api/backend/planning/ferry-service' ||
		response.request().method() !== 'POST' ||
		response.status() !== 200
	)
		return;
	try {
		ferryResponses.push({
			request: response.request().postDataJSON(),
			body: await response.json()
		});
	} catch {
		// Superseded service previews may be aborted while their replacement loads.
	}
});
/** @type {Array<{name:string,coordinates:[number,number]}>} */
const terminalEndpoints = [];
const ferryPayload = {
	origin_island_id: 'island:1442',
	destination_island_id: 'island:1443',
	headway_minutes: 120,
	start_minutes: 360,
	end_minutes: 1200,
	speed_kph: 25,
	assumptions: {
		date: serviceDay,
		goal: 'transport',
		target_minutes: 10,
		capital_budget_mvr: capitalBudget,
		annual_operating_budget_mvr: annualBudget
	},
	operations: []
};

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

/** @param {string} endpoint @param {unknown} data */
async function post(endpoint, data) {
	const response = await page.request.post(`${baseURL}/api/backend/planning/${endpoint}`, { data });
	assert.equal(response.status(), 200, `${endpoint}: ${await response.text()}`);
	return response.json();
}

/** Project a source terminal through the map's public camera attributes.
 * @param {[number,number]} coordinates
 * @param {import('@playwright/test').Locator} targetAtlas
 */
async function terminalVisibility(coordinates, targetAtlas = atlas) {
	return targetAtlas.evaluate((element, location) => {
		const canvas = element.querySelector('.maplibregl-canvas');
		if (!canvas) return { visible: false, x: 0, y: 0 };
		const bounds = canvas.getBoundingClientRect();
		const zoom = Number(element.getAttribute('data-zoom'));
		const longitude = Number(element.getAttribute('data-center-longitude'));
		const latitude = Number(element.getAttribute('data-center-latitude'));
		const left = Number(element.getAttribute('data-camera-padding-left'));
		const right = Number(element.getAttribute('data-camera-padding-right'));
		const top = Number(element.getAttribute('data-camera-padding-top'));
		const bottom = Number(element.getAttribute('data-camera-padding-bottom'));
		const world = 512 * 2 ** zoom;
		/** @param {number} value */
		const mercatorY = (value) =>
			(1 - Math.log(Math.tan(Math.PI / 4 + (value * Math.PI) / 360)) / Math.PI) / 2;
		const x =
			bounds.x + (bounds.width + left - right) / 2 + ((location[0] - longitude) * world) / 360;
		const y =
			bounds.y +
			(bounds.height + top - bottom) / 2 +
			(mercatorY(location[1]) - mercatorY(latitude)) * world;
		const hit = document.elementFromPoint(x, y);
		return {
			x,
			y,
			occludedBy: hit?.getAttribute('class') ?? hit?.tagName ?? null,
			camera: {
				zoom,
				longitude,
				latitude,
				left,
				right,
				top,
				bottom,
				width: bounds.width,
				height: bounds.height
			},
			visible:
				x >= bounds.x &&
				y >= bounds.y &&
				x <= bounds.right &&
				y <= bounds.bottom &&
				!!(hit?.matches('.maplibregl-canvas') || hit?.closest('.maplibregl-marker'))
		};
	}, coordinates);
}

/** @param {import('@playwright/test').Locator} targetAtlas */
async function expectVisibleTerminals(targetAtlas = atlas) {
	/** @type {Record<string,{visible:boolean,x:number,y:number}>} */
	const points = {};
	for (const terminal of terminalEndpoints) {
		try {
			await expect
				.poll(async () => (await terminalVisibility(terminal.coordinates, targetAtlas)).visible, {
					message: `${terminal.name} stays visible outside floating controls and panels`
				})
				.toBe(true);
		} catch (cause) {
			throw new Error(
				`${terminal.name} is obscured: ${JSON.stringify(await terminalVisibility(terminal.coordinates, targetAtlas))}`,
				{ cause }
			);
		}
		points[terminal.name] = await terminalVisibility(terminal.coordinates, targetAtlas);
	}
	return points;
}

/** @param {import('@playwright/test').Page} targetPage */
async function openConnections(targetPage) {
	await targetPage.getByRole('button', { name: 'Directions', exact: true }).click();
	const targetJourney = targetPage.getByRole('region', {
		name: 'Explore journey directions',
		exact: true
	});
	await expect(targetJourney).toBeVisible();
	await targetJourney.getByRole('button', { name: 'Island connections', exact: true }).click();
	const targetConnections = targetJourney.getByRole('region', {
		name: 'Island connections',
		exact: true
	});
	await expect(targetConnections).toBeVisible();
	await targetConnections.getByLabel('From island', { exact: true }).selectOption('island:1442');
	await targetConnections
		.getByLabel('Check service evidence for', { exact: true })
		.fill(serviceDay);
	await targetConnections.getByLabel('To island', { exact: true }).selectOption('island:1443');
	await expect(targetConnections).toHaveAttribute('aria-busy', 'false');
	await expect(targetConnections.locator('.connection-verdict')).toBeVisible();
	return targetConnections;
}

async function previewService(capitalLimit = capitalBudget, annualLimit = annualBudget) {
	const current = () =>
		ferryResponses.findLast(
			({ request }) =>
				request.assumptions.date === serviceDay &&
				request.assumptions.capital_budget_mvr === capitalLimit &&
				request.assumptions.annual_operating_budget_mvr === annualLimit
		);
	await expect.poll(() => current()?.body.status).toBe('ready');
	await expect(composer.locator('.service-costs')).toBeVisible();
	const response = current();
	assert.ok(response, 'The matching service quote has completed');
	return response.body;
}

/** Verify the accepted outward and return timetable against the real preview quote.
 * @param {import('@playwright/test').Locator} target
 */
async function expectAcceptedReturnService(target) {
	assert.ok(acceptedFerryImpact, 'The accepted ferry quote includes timetable impact');
	const impact = target.getByRole('region', { name: 'Transport service impact', exact: true });
	await expect(impact).toBeVisible();
	await expect(impact).toHaveAttribute('data-preview', 'false');
	await expect(impact).toHaveAttribute('data-outdated', 'false');
	const details = impact.locator('.impact-details');
	if ((await details.getAttribute('open')) === null)
		await details.getByText('Route and island connection details', { exact: true }).click();
	const lines = (acceptedFerryImpact.lines ?? []).filter((line) => line.change !== 'unchanged');
	const directions = (acceptedFerryImpact.connections ?? []).filter(
		(connection) => connection.change !== 'unchanged'
	);
	assert.equal(lines.length, 2, 'The quote retains outward and return service patterns');
	assert.equal(directions.length, 2, 'The quote retains two directed island connections');
	await expect(impact.locator('.service-row:not(.connection-row)')).toHaveCount(lines.length);
	await expect(impact.locator('.connection-row')).toHaveCount(directions.length);
	for (const line of lines) {
		const row = impact
			.locator('.service-row:not(.connection-row)')
			.filter({ has: page.getByRole('heading', { name: line.name, exact: true }) })
			.filter({
				has: page.getByText(`${line.from_stop_name} → ${line.to_stop_name}`, { exact: true })
			});
		await expect(row).toBeVisible();
		await expect(row).toContainText('New service');
		assert.ok(line.after && Number(line.after.departure_count) > 0);
		await expect(
			row
				.locator('.service-values > div')
				.filter({ hasText: /^Dated departures/ })
				.locator('dd')
		).toContainText(`${line.after.departure_count} departures`);
		await expect(
			row
				.locator('.service-values > div')
				.filter({ hasText: /^Expected wait/ })
				.locator('dd')
		).toContainText(
			`${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(Number(line.after.expected_wait_minutes))} min`
		);
	}
	for (const direction of directions) {
		await expect(
			impact.locator('.connection-row').getByRole('heading', {
				name: `${direction.from_island_name} → ${direction.to_island_name}`,
				exact: true
			})
		).toBeVisible();
	}
	return { servicePatterns: lines.length, directedConnections: directions.length };
}

try {
	await check(
		'Real connectivity separates local walking access, landings and dated services',
		async () => {
			const response = await page.request.get(
				`${baseURL}/api/backend/planning/connectivity?${new URLSearchParams({
					origin_island_id: 'island:1442',
					destination_island_id: 'island:1443',
					date: serviceDay
				})}`
			);
			assert.equal(response.status(), 200, await response.text());
			const data = await response.json();
			assert.equal(data.origin.id, 'island:1442');
			assert.equal(data.destination.id, 'island:1443');
			assert.ok(data.terminals.origin.length > 0, 'Hulhumalé has explicit ferry terminal evidence');
			assert.ok(data.terminals.destination.length > 0, 'Malé has explicit ferry terminal evidence');
			for (const terminal of [data.terminals.origin[0], data.terminals.destination[0]])
				terminalEndpoints.push({ name: terminal.name, coordinates: terminal.coordinates });
			assert.equal(data.local_transport.walk_target_minutes, 10);
			assert.equal(typeof data.local_transport.resident_coverage_pct, 'number');
			assert.ok(data.local_transport.resident_coverage_pct >= 0);
			assert.ok(data.local_transport.resident_coverage_pct <= 100);
			assert.equal(
				data.status,
				'dated_service',
				'Captured capital bus evidence supports this date'
			);
			assert.ok(data.links.some((/** @type {{mode:string}} */ link) => link.mode === 'bus'));
			assert.ok(data.map_features.features.length > 0);
			assert.ok(data.reasons.length > 0, 'Evidence caveats accompany the connection verdict');
			return {
				status: data.status,
				terminalCounts: [data.terminals.origin.length, data.terminals.destination.length],
				localTransport: data.local_transport,
				reasons: data.reasons
			};
		}
	);
	await check(
		'Captured bus departures are not repeated as verified service on another date',
		async () => {
			const response = await page.request.get(
				`${baseURL}/api/backend/planning/connectivity?origin_island_id=island:1442&destination_island_id=island:1443&date=2026-10-11`
			);
			assert.equal(response.status(), 200, await response.text());
			const data = await response.json();
			assert.notEqual(data.status, 'dated_service');
			return { status: data.status, reasons: data.reasons };
		}
	);
	await check(
		'A service preview includes both directions, no new port and a real cost gate',
		async () => {
			const draft = await post('ferry-service', ferryPayload);
			assert.equal(draft.status, 'ready');
			assert.equal(draft.summary.terminal_construction_mvr, 0);
			assert.ok(draft.summary.departures_each_direction > 0);
			const services = draft.operations.filter(
				(/** @type {{type:string}} */ operation) => operation.type === 'add_service'
			);
			assert.equal(services.length, 2, 'Outward and return are separate service patterns');
			assert.equal(services[0].service.stopIds[0], services[1].service.stopIds.at(-1));
			assert.equal(services[0].service.stopIds.at(-1), services[1].service.stopIds[0]);
			assert.ok(draft.quote.economics.delta.capital_mvr > 0);
			assert.ok(draft.quote.economics.delta.annual_operating_mvr > 0);
			assert.equal(draft.quote.budget.allowed, true);
			const blocked = await post('ferry-service', {
				...ferryPayload,
				assumptions: {
					...ferryPayload.assumptions,
					capital_budget_mvr: 1,
					annual_operating_budget_mvr: 1
				}
			});
			assert.equal(blocked.quote.budget.allowed, false);
			assert.ok(blocked.quote.budget.reasons.length > 0);
			return {
				summary: draft.summary,
				capital: draft.quote.economics.delta.capital_mvr,
				annual: draft.quote.economics.delta.annual_operating_mvr,
				blockedReasons: blocked.quote.budget.reasons
			};
		}
	);
	await check(
		'Construction outside the resident and road model cannot receive a free allowed quote',
		async () => {
			const rejected = [];
			for (const endpoint of ['quote', 'evaluate']) {
				for (const type of ['add_stop', 'add_school', 'add_hospital']) {
					const response = await page.request.post(`${baseURL}/api/backend/planning/${endpoint}`, {
						data: {
							island_id: 'island:1152',
							assumptions: { capital_budget_mvr: 0, annual_operating_budget_mvr: 0 },
							operations: [{ type, coordinates: [73.084, -0.605] }]
						}
					});
					assert.equal(response.status(), 422, await response.text());
					const body = await response.json();
					assert.match(body.error?.message ?? body.detail, /outside the supported planning area/);
					rejected.push({ endpoint, type, status: response.status() });
				}
			}
			return { rejected };
		}
	);
	await check(
		'Directions exposes island connections on the map with understandable evidence',
		async () => {
			await page.goto(`${baseURL}/?view=map&island=island%3A1442&tool=explore`, {
				waitUntil: 'domcontentloaded'
			});
			await expect(atlas).toHaveAttribute('aria-busy', 'false');
			await openConnections(page);
			await expect(connections.getByLabel('Ferry infrastructure check')).toContainText('Hulhumalé');
			await expect(connections.getByLabel('Ferry infrastructure check')).toContainText('Malé');
			await expect(
				connections.getByRole('region', { name: 'Public transport walking access' })
			).toBeVisible();
			await connections.getByText('What this check can tell you', { exact: true }).click();
			await expect(connections).toContainText(
				'Missing evidence does not prove there is no real-world service.'
			);
			await expect(connections).toContainText(
				'Landing permission and suitability still need confirmation.'
			);
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-island-connection-features')))
				.toBeGreaterThan(0);
			const terminalVisibility = await expectVisibleTerminals();
			await page.screenshot({ path: path.join(output, 'island-connection.png') });
			return {
				connectionFeatures: await atlas.getAttribute('data-island-connection-features'),
				terminalVisibility
			};
		}
	);
	await check('Clear destination and Reset remove stale connection geometry', async () => {
		await connections.getByRole('button', { name: 'Clear destination', exact: true }).click();
		await expect(connections.getByLabel('To island', { exact: true })).toHaveValue('');
		await expect(atlas).toHaveAttribute('data-island-connection-features', '0');
		await connections.getByLabel('To island', { exact: true }).selectOption('island:1443');
		await expect(connections.locator('.connection-verdict')).toBeVisible();
		await journey.getByRole('button', { name: 'Reset', exact: true }).click();
		await expect(connections.getByLabel('To island', { exact: true })).toHaveValue('');
		await expect(atlas).toHaveAttribute('data-island-connection-features', '0');
		await connections.getByLabel('From island', { exact: true }).selectOption('island:1442');
		await connections.getByLabel('To island', { exact: true }).selectOption('island:1443');
		await expect(connections.locator('.connection-verdict')).toBeVisible();
		return { resetDestination: '', connectionFeaturesAfterReset: 0 };
	});
	await check(
		'Plan a ferry service carries the chosen islands and evidence date into one proposal composer',
		async () => {
			await connections
				.getByLabel('Check service evidence for', { exact: true })
				.fill('2026-10-11');
			await expect(connections.locator('.connection-verdict')).toContainText(
				'No verified service in the available data'
			);
			await connections.getByRole('button', { name: 'Plan a ferry service', exact: true }).click();
			await expect(composer).toBeVisible();
			await expect(atlas).toHaveAttribute('data-policy-service-editor', 'ferry');
			await expect(planning).not.toBeVisible();
			await expect(journey).not.toBeVisible();
			await expect(composer.locator('.service-destination')).toContainText('Malé');
			await expect(composer).toContainText('Hulhumalé');
			await expect(composer.getByLabel('Service date', { exact: true })).toHaveValue('2026-10-11');
			await expect(composer).toContainText('No new port is built.');
			await composer.getByRole('button', { name: 'Edit budgets', exact: true }).click();
			await expect(planning).toHaveAttribute('data-policy-section', 'proposal');
			if ((await planning.locator('.proposal-details').getAttribute('open')) === null)
				await planning.locator('.proposal-details > summary').click();
			await planning
				.getByLabel('Proposal name', { exact: true })
				.fill('Hulhumalé to Malé ferry service');
			await planning
				.getByLabel("Compare residents' access to", { exact: true })
				.selectOption('transport');
			await planning.getByText('Travel target, date & assumptions', { exact: true }).click();
			await expect(planning.getByLabel('Service date', { exact: true })).toHaveValue('2026-10-11');
			await planning.getByLabel('Service date', { exact: true }).fill(serviceDay);
			await expect(composer.getByLabel('Service date', { exact: true })).toHaveValue(serviceDay);
			return {
				origin: 'Hulhumalé',
				destination: 'Malé',
				goal: 'transport',
				preservedEvidenceDate: '2026-10-11',
				forecastDate: serviceDay
			};
		}
	);
	await check(
		'Insufficient capital and annual budgets block the visible confirm action',
		async () => {
			await planning.getByLabel('Capital budget · MVR', { exact: true }).fill('1');
			await planning.getByLabel('Annual running budget · MVR', { exact: true }).fill('1');
			const draft = await previewService(1, 1);
			assert.equal(draft.quote.budget.allowed, false);
			await expect(
				composer.getByRole('button', { name: 'Accept ferry service', exact: true })
			).toBeDisabled();
			await expect(composer.locator('.policy-budget-alert[role="alert"]').first()).toContainText(
				/budget/i
			);
			await expect(planning.locator('.policy-operation-list li')).toHaveCount(0);
			await page.screenshot({ path: path.join(output, 'ferry-budget-blocked.png') });
			return { allowed: draft.quote.budget.allowed, reasons: draft.quote.budget.reasons };
		}
	);
	await check(
		'Changing a quoted budget invalidates confirmation until a fresh affordable quote',
		async () => {
			await planning
				.getByLabel('Capital budget · MVR', { exact: true })
				.fill(String(capitalBudget));
			await planning
				.getByLabel('Annual running budget · MVR', { exact: true })
				.fill(String(annualBudget));
			await expect(
				composer.getByRole('button', { name: 'Accept ferry service', exact: true })
			).toBeDisabled();
			const draft = await previewService();
			assert.equal(draft.quote.budget.allowed, true);
			acceptedFerryImpact = draft.quote.transport_connectivity.impact;
			await expect(
				composer.getByRole('button', { name: 'Accept ferry service', exact: true })
			).toBeEnabled();
			await expect(composer).toContainText('trips each way');
			await expect(composer).toContainText('MVR 0');
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-policy-service-features')))
				.toBeGreaterThan(0);
			await composer
				.getByRole('button', { name: 'See the full route on the map', exact: true })
				.click();
			await expectVisibleTerminals();
			await page.screenshot({ path: path.join(output, 'ferry-preview.png') });
			await composer.getByRole('button', { name: 'Accept ferry service', exact: true }).click();
			await expect(composer).not.toBeVisible();
			await expect(planning.locator('.policy-operation-list li')).toHaveCount(1);
			await expect(planning.locator('.policy-operation-list li')).toContainText(draft.summary.name);
			const timetable = await expectAcceptedReturnService(planning);
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-policy-service-features')))
				.toBeGreaterThan(0);
			await expectVisibleTerminals();
			await page.screenshot({ path: path.join(output, 'ferry-confirmed.png') });
			return {
				summary: draft.summary,
				timetable,
				mapFeatures: await atlas.getAttribute('data-policy-service-features')
			};
		}
	);
	await check(
		'The full impact review and downloaded PDF retain ferry and return-service results',
		async () => {
			await planning.getByRole('button', { name: 'Review full impact', exact: true }).click();
			const review = page.getByRole('dialog');
			await expect(review).toBeVisible();
			const transport = review.getByRole('region', {
				name: 'Public transport and island connections',
				exact: true
			});
			await expect(transport).toBeVisible();
			const timetable = await expectAcceptedReturnService(transport);
			await expect(transport).toContainText('MVR 0');
			const save = review.getByRole('button', { name: 'Save as PDF', exact: true });
			await expect(save).toBeEnabled();
			await page.screenshot({ path: path.join(output, 'ferry-impact-review.png') });
			const downloadPromise = page.waitForEvent('download');
			await save.click();
			const download = await downloadPromise;
			const pdfPath = path.join(output, 'ferry-service-review.pdf');
			await download.saveAs(pdfPath);
			assert.equal(await download.failure(), null);
			const bytes = await readFile(pdfPath);
			assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
			assert.ok(
				bytes.length > 10000,
				'The exported decision brief contains substantive PDF content'
			);
			await review.getByRole('button', { name: 'Close proposal review', exact: true }).click();
			return { timetable, pdfPath, bytes: bytes.length, filename: download.suggestedFilename() };
		}
	);
	await check(
		'Removing one ferry package removes both service directions from the map',
		async () => {
			await planning
				.locator('.policy-operation-list li')
				.getByRole('button', { name: /^Remove .* package$/ })
				.click();
			await expect(planning.locator('.policy-operation-list li')).toHaveCount(0);
			await expect(
				planning.getByRole('region', { name: 'Transport service impact', exact: true })
			).not.toBeVisible();
			await expect(atlas).toHaveAttribute('data-policy-service-features', '0');
			await expect(
				planning.getByRole('button', { name: 'Review full impact', exact: true })
			).toBeDisabled();
			await expect(
				planning.getByRole('region', { name: 'Proposal budget', exact: true })
			).toBeVisible();
			return { remainingProposalPackages: 0, remainingServiceFeatures: 0 };
		}
	);
	await check(
		'The transport opportunity card links analytics directly into island connections',
		async () => {
			await navigation.getByRole('button', { name: 'Analytics', exact: true }).click();
			const services = page.locator('.service-comparison-disclosure');
			if ((await services.getAttribute('open')) === null)
				await services.locator('summary').first().click();
			await page.getByRole('button', { name: 'Check island connections', exact: true }).click();
			await expect(connections).toBeVisible();
			await expect(page).toHaveURL((url) => url.searchParams.get('view') === 'map');
			return { url: page.url() };
		}
	);
	await check(
		'A fresh mobile session can inspect and propose the same island connection',
		async () => {
			const mobileContext = await browser.newContext({
				viewport: { width: 390, height: 844 },
				reducedMotion: 'reduce'
			});
			const mobilePage = await mobileContext.newPage();
			mobilePage.setDefaultTimeout(60000);
			mobilePage.on('pageerror', (error) => report.pageErrors.push(error.message));
			try {
				await mobilePage.goto(`${baseURL}/?view=map&island=island%3A1442&tool=explore`, {
					waitUntil: 'domcontentloaded'
				});
				await expect(mobilePage.locator('.national-map')).toHaveAttribute('aria-busy', 'false');
				const mobileConnections = await openConnections(mobilePage);
				await expect
					.poll(() =>
						mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
					)
					.toBe(true);
				await expectVisibleTerminals(mobilePage.locator('.national-map'));
				await mobilePage.screenshot({ path: path.join(output, 'island-connection-mobile.png') });
				await mobileConnections
					.getByRole('button', { name: 'Plan a ferry service', exact: true })
					.click();
				const mobileComposer = mobilePage.getByRole('region', {
					name: 'Plan a ferry service',
					exact: true
				});
				await expect(mobileComposer).toBeVisible();
				await expect(mobileComposer.locator('.service-destination')).toContainText('Malé');
				await expect
					.poll(() =>
						mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)
					)
					.toBe(true);
				await mobilePage.screenshot({ path: path.join(output, 'ferry-composer-mobile.png') });
				await expect(mobileComposer.locator('.service-metrics')).toBeVisible();
				await expect(mobileComposer.locator('.service-costs')).toBeVisible();
				await mobileComposer
					.getByRole('button', { name: 'See the full route on the map', exact: true })
					.click();
				const evidence = mobileComposer.locator('.compact-preview .service-preview-evidence');
				const evidenceSummary = mobileComposer.locator('.service-preview-evidence > summary');
				await expect(evidence).toBeVisible();
				await expect(evidence).not.toHaveAttribute('open', '');
				await expect(evidenceSummary).toContainText('2 new island-to-island directions');
				await expect(
					mobileComposer.getByRole('button', { name: 'Accept ferry service', exact: true })
				).toBeEnabled();
				await expect(
					mobileComposer.getByRole('button', { name: 'Edit settings', exact: true })
				).toBeVisible();
				await expectVisibleTerminals(mobilePage.locator('.national-map'));
				await mobilePage.screenshot({ path: path.join(output, 'ferry-preview-mobile.png') });
				await evidenceSummary.click();
				await expect(evidence).toHaveAttribute('open', '');
				const mobileImpact = evidence.getByRole('region', {
					name: 'Transport service impact',
					exact: true
				});
				await expect(mobileImpact).toBeVisible();
				await mobileImpact.locator('.impact-details > summary').click();
				await expect(mobileImpact.locator('.connection-row')).toHaveCount(2);
				const directionHeading = mobileImpact
					.locator('.connection-row')
					.getByRole('heading', { name: 'Hulhumalé → Malé', exact: true });
				await directionHeading.scrollIntoViewIfNeeded();
				await expect(directionHeading).toBeInViewport();
				await expect(
					mobileComposer.getByRole('button', { name: 'Accept ferry service', exact: true })
				).toBeInViewport();
				await expect(
					mobileComposer.getByRole('button', { name: 'Edit settings', exact: true })
				).toBeInViewport();
				assert.ok(
					await mobileComposer.evaluate((element) => element.scrollHeight > element.clientHeight),
					'Expanded timetable evidence scrolls inside the map preview'
				);
				await expectVisibleTerminals(mobilePage.locator('.national-map'));
				await mobilePage.screenshot({
					path: path.join(output, 'ferry-preview-mobile-expanded.png')
				});
				await evidenceSummary.click();
				await expect(evidence).not.toHaveAttribute('open', '');
				await expectVisibleTerminals(mobilePage.locator('.national-map'));
				return {
					viewport: { width: 390, height: 844 },
					horizontalOverflow: false,
					expandedEvidenceScrollable: true,
					stickyActionsVisible: true,
					terminalsVisibleWhileExpanded: true,
					terminalsVisibleAfterCollapse: true
				};
			} catch (error) {
				await mobilePage
					.screenshot({ path: path.join(output, 'mobile-failure.png') })
					.catch(() => {});
				throw error;
			} finally {
				await mobileContext.close();
			}
		}
	);
	await check(
		'National islands disable unsupported construction while keeping ferry planning available',
		async () => {
			const nationalContext = await browser.newContext({
				viewport: { width: 1440, height: 1000 },
				reducedMotion: 'reduce'
			});
			const nationalPage = await nationalContext.newPage();
			nationalPage.setDefaultTimeout(60000);
			nationalPage.on('pageerror', (error) => report.pageErrors.push(error.message));
			try {
				await nationalPage.goto(`${baseURL}/?view=map&island=island%3A1152&tool=explore`, {
					waitUntil: 'domcontentloaded'
				});
				await expect(nationalPage.locator('.national-map')).toHaveAttribute('aria-busy', 'false');
				await nationalPage.getByRole('button', { name: 'Create proposal', exact: true }).click();
				const nationalPlanning = nationalPage.getByRole('region', {
					name: 'Island needs and proposal',
					exact: true
				});
				await expect(nationalPlanning).toHaveAttribute('data-policy-section', 'proposal');
				for (const name of ['Bus stop', 'School', 'Hospital']) {
					const button = nationalPlanning.getByRole('button', { name, exact: true });
					await expect(button).toBeDisabled();
					await expect(button).toHaveAttribute('draggable', 'false');
				}
				const newService = nationalPlanning.getByRole('button', { name: /Ferry service/ });
				await expect(newService).toBeEnabled();
				await newService.click();
				await expect(
					nationalPage.getByRole('region', { name: 'Plan a ferry service', exact: true })
				).toBeVisible();
				await expect(nationalPlanning.locator('.policy-operation-list li')).toHaveCount(0);
				await nationalPage.screenshot({
					path: path.join(output, 'national-construction-guard.png')
				});
				return {
					island: 'island:1152',
					unsupportedConstructionDisabled: true,
					ferryAvailable: true
				};
			} catch (error) {
				await nationalPage
					.screenshot({ path: path.join(output, 'national-failure.png') })
					.catch(() => {});
				throw error;
			} finally {
				await nationalContext.close();
			}
		}
	);
	await check('The policymaker journey completes without browser runtime errors', async () => {
		assert.deepEqual(report.pageErrors, []);
		return { errors: 0 };
	});
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
