import { browserBaseURL } from './browser-config.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Real dated timetable proposals through the UI, with no injected or mocked application state.
const baseURL = browserBaseURL();
const output = path.resolve('artifacts/qa/transport-service-impact');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 90000 });
/** @typedef {import('../src/lib/proposal-review.js').PlanningEvaluation} Evaluation */
/** @typedef {import('../src/lib/transport-impact.js').TransportImpactData} Impact */
/** @type {{baseURL:string,startedAt:string,finishedAt?:string,checks:Array<{name:string,status:string,detail?:unknown}>,pageErrors:string[],failure?:string}} */
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], pageErrors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
/** @type {import('@playwright/test').BrowserContext[]} */
const contexts = [];
/** @type {import('@playwright/test').Page | undefined} */
let currentPage;

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

async function session() {
	const context = await browser.newContext({
		viewport: { width: 1440, height: 1000 },
		reducedMotion: 'reduce'
	});
	contexts.push(context);
	const page = await context.newPage();
	currentPage = page;
	page.setDefaultTimeout(90000);
	page.on('pageerror', (error) => report.pageErrors.push(error.message));
	/** @type {Array<{endpoint:string,request:any,body:any}>} */
	const responses = [];
	page.on('response', async (response) => {
		const endpoint = new URL(response.url()).pathname.split('/').at(-1);
		if (
			!endpoint ||
			!['evaluate', 'quote', 'ferry-service'].includes(endpoint) ||
			!response.url().includes('/planning/') ||
			response.request().method() !== 'POST' ||
			!response.ok()
		)
			return;
		try {
			responses.push({
				endpoint,
				request: response.request().postDataJSON(),
				body: await response.json()
			});
		} catch {
			// A superseded preview may be cancelled by a newer route or date selection.
		}
	});
	await page.goto(`${baseURL}/?view=map&tool=explore&island=island%3A1442`, {
		waitUntil: 'domcontentloaded'
	});
	const atlas = page.locator('.national-map');
	await expect(atlas).toHaveAttribute('aria-busy', 'false');
	const panel = page.getByRole('region', { name: 'Island needs and proposal', exact: true });
	return { context, page, atlas, panel, responses };
}

/** @param {Awaited<ReturnType<typeof session>>} target */
async function showProposal(target) {
	if (!(await target.panel.isVisible())) {
		const edit = target.page.getByRole('button', { name: /^Edit proposal/ });
		if (await edit.isVisible()) await edit.click();
		else await target.page.getByRole('button', { name: /^Create (?:a )?proposal$/ }).click();
	}
	if ((await target.panel.getAttribute('data-policy-section')) !== 'proposal')
		await target.panel.getByRole('button', { name: /^Your proposal/ }).click();
}

/** @param {Awaited<ReturnType<typeof session>>} target */
async function evaluated(target) {
	await expect(target.atlas).toHaveAttribute('data-policy-calculating', 'false');
	await expect
		.poll(
			() => target.responses.findLast((row) => row.endpoint === 'evaluate')?.body.origins?.length
		)
		.toBeGreaterThan(0);
	return /** @type {Evaluation} */ (
		target.responses.findLast((row) => row.endpoint === 'evaluate')?.body
	);
}

/** @param {Evaluation} value */
function assertWalkingUnchanged(value) {
	assert.equal(value.summary.gained_residents, 0);
	assert.equal(value.summary.weighted_minutes_saved, 0);
	assert.ok((value.origins?.length ?? 0) > 0);
	assert.ok(
		value.origins?.every(
			(row) =>
				row.before.status === row.after.status &&
				(row.before.minutes === null
					? row.after.minutes === null
					: row.after.minutes !== null && Math.abs(row.before.minutes - row.after.minutes) < 0.001)
		),
		'Changing dated service must not invent a change in walking distance to existing stops.'
	);
}

/** @param {import('@playwright/test').Locator} component @param {Impact} impact */
async function assertDatedDepartures(component, impact) {
	const metric = component
		.locator('.impact-metric')
		.filter({ hasText: 'Island service departures' });
	await expect(metric).toContainText(
		new Intl.NumberFormat('en-GB').format(impact.summary?.departures_before ?? Number.NaN)
	);
	await expect(metric).toContainText(
		new Intl.NumberFormat('en-GB').format(impact.summary?.departures_after ?? Number.NaN)
	);
}

try {
	const bus = await session();
	const source = await bus.page.request.get(
		`${baseURL}/api/backend/planning/baseline?island_id=island%3A1442`
	);
	assert.equal(source.status(), 200);
	const baseline = await source.json();
	const route = baseline.patterns.find(
		(/** @type {{mode:string,name:string}} */ pattern) =>
			pattern.mode === 'bus' && pattern.name.startsWith('R1 ')
	);
	assert.ok(route, 'The test uses a captured R1 service, not a synthetic route.');
	await showProposal(bus);
	await bus.panel.getByRole('button', { name: 'Edit budget limits', exact: true }).click();
	await bus.panel.getByLabel('Capital budget · MVR', { exact: true }).fill('1000000000');
	await bus.panel.getByLabel('Annual running budget · MVR', { exact: true }).fill('1000000000');
	await bus.panel.getByRole('button', { name: /^Bus service/ }).click();
	const busEditor = bus.page.getByTestId('map-service-editor');
	await expect(busEditor).toHaveAttribute('data-service-mode', 'bus');
	await busEditor.getByLabel('Bus route and direction', { exact: true }).selectOption(route.id);
	await busEditor.getByLabel('Service date', { exact: true }).fill('2026-10-10');
	await busEditor.getByLabel('A bus every · min', { exact: true }).fill('15');
	const busImpact = busEditor.getByRole('region', {
		name: 'Transport service impact',
		exact: true
	});
	/** @type {Impact} */
	let busPreview;
	await check(
		'Bus preview shows comparable expected waiting benefits before accepting',
		async () => {
			const selectedQuote = () =>
				bus.responses.findLast(
					(row) =>
						row.endpoint === 'quote' &&
						row.request.operations?.some(
							(/** @type {{type:string,target_id?:string,headway_minutes?:number}} */ operation) =>
								operation.type === 'set_frequency' &&
								operation.target_id === route.id &&
								operation.headway_minutes === 15
						)
				);
			await expect.poll(() => selectedQuote()?.body.transport_connectivity?.impact).toBeTruthy();
			const quote = selectedQuote();
			assert.ok(quote, 'The exact bus frequency quote completed.');
			assert.ok(quote.body.transport_connectivity?.impact);
			busPreview = quote.body.transport_connectivity.impact;
			const line = busPreview.lines?.find((row) => row.id === route.id);
			assert.ok(line?.expected_wait_comparable);
			assert.ok(
				(line.before?.expected_wait_minutes ?? 0) > (line.after?.expected_wait_minutes ?? 0)
			);
			assert.ok((line.expected_wait_saved_minutes ?? 0) > 0);
			await expect(busImpact).toBeVisible();
			await expect(busImpact).toHaveAttribute('data-preview', 'true');
			await expect(busImpact).toContainText('shorter expected wait');
			await assertDatedDepartures(busImpact, busPreview);
			await busImpact.scrollIntoViewIfNeeded();
			await bus.page.screenshot({ path: path.join(output, 'bus-wait-preview.png') });
			return { serviceDate: busPreview.service_date, line, summary: busPreview.summary };
		}
	);

	await check(
		'Confirmed bus frequency improves service while walking stays unchanged',
		async () => {
			await busEditor.getByRole('button', { name: 'Accept service', exact: true }).click();
			await expect(busEditor).not.toBeVisible();
			await showProposal(bus);
			await bus.panel
				.getByLabel("Compare residents' access to", { exact: true })
				.selectOption('transport');
			await expect
				.poll(
					() =>
						bus.responses.findLast((row) => row.endpoint === 'evaluate')?.request.assumptions?.goal
				)
				.toBe('transport');
			const value = await evaluated(bus);
			const impact = value.transport_connectivity?.impact;
			assert.ok(impact, 'The confirmed bus evaluation includes transport service impact.');
			assertWalkingUnchanged(value);
			await showProposal(bus);
			const component = bus.panel.getByRole('region', {
				name: 'Transport service impact',
				exact: true
			});
			await expect(component).toContainText('shorter expected wait');
			await assertDatedDepartures(component, impact);
			await component.scrollIntoViewIfNeeded();
			await bus.page.screenshot({ path: path.join(output, 'bus-wait-confirmed.png') });
			return {
				walkingGains: value.summary.gained_residents,
				walkingMinutesSaved: value.summary.weighted_minutes_saved,
				impact
			};
		}
	);

	await check(
		'Full impact review retains bus waits, departures and their shared operating window',
		async () => {
			await bus.panel.getByRole('button', { name: 'Review full impact', exact: true }).click();
			const review = bus.page.getByRole('dialog');
			await expect(review).toBeVisible();
			const component = review.getByRole('region', {
				name: 'Transport service impact',
				exact: true
			});
			await expect(component).toContainText('shorter expected wait');
			await expect(component).toContainText('Compared over the same');
			await expect(component).toContainText('Wait for that departure');
			await assertDatedDepartures(component, busPreview);
			await component.scrollIntoViewIfNeeded();
			await bus.page.screenshot({ path: path.join(output, 'bus-wait-full-review.png') });
			return {
				sameOperatingWindow: true,
				nextDepartureWait: true,
				observedRidershipClaimed: false
			};
		}
	);
	await bus.context.close();

	const ferry = await session();
	await ferry.page.getByRole('button', { name: 'Directions', exact: true }).click();
	const journey = ferry.page.getByRole('region', {
		name: 'Explore journey directions',
		exact: true
	});
	await journey.getByRole('button', { name: 'Island connections', exact: true }).click();
	const connections = journey.getByRole('region', { name: 'Island connections', exact: true });
	await connections.getByLabel('From island', { exact: true }).selectOption('island:1442');
	await connections.getByLabel('Check service evidence for', { exact: true }).fill('2026-10-11');
	await connections.getByLabel('To island', { exact: true }).selectOption('island:1443');
	await expect(connections).toHaveAttribute('aria-busy', 'false');
	await expect(connections.locator('.connection-verdict')).toBeVisible();
	await connections.getByRole('button', { name: 'Plan a ferry service', exact: true }).click();
	const ferryEditor = ferry.page.getByRole('region', { name: 'Plan a ferry service', exact: true });
	await expect(ferryEditor).toBeVisible();
	await ferryEditor.getByLabel('A ferry every · min', { exact: true }).fill('120');
	const ferryImpact = ferryEditor.getByRole('region', {
		name: 'Transport service impact',
		exact: true
	});
	/** @type {Impact} */
	let ferryPreview;
	await check(
		'New ferry preview names both directed connections without inventing saved waiting',
		async () => {
			const selectedDraft = () =>
				ferry.responses.findLast(
					(row) =>
						row.endpoint === 'ferry-service' && row.request.assumptions?.date === '2026-10-11'
				);
			await expect
				.poll(() => selectedDraft()?.body.quote?.transport_connectivity?.impact)
				.toBeTruthy();
			const draft = selectedDraft();
			assert.ok(draft, 'The matching dated ferry quote completed.');
			assert.ok(draft.body.quote?.transport_connectivity?.impact);
			ferryPreview = draft.body.quote.transport_connectivity.impact;
			const newConnections = ferryPreview.connections?.filter((row) => row.change === 'added');
			assert.ok(newConnections);
			assert.equal(newConnections?.length, 2);
			assert.ok(
				newConnections.some(
					(row) => row.from_island_name === 'Hulhumalé' && row.to_island_name === 'Malé'
				)
			);
			assert.ok(
				newConnections.some(
					(row) => row.from_island_name === 'Malé' && row.to_island_name === 'Hulhumalé'
				)
			);
			assert.ok(ferryPreview.lines?.every((row) => row.expected_wait_saved_minutes === null));
			await expect(ferryImpact).toContainText('2 new');
			await ferryImpact.getByText('Route and island connection details', { exact: true }).click();
			await expect(ferryImpact).toContainText('Hulhumalé → Malé');
			await expect(ferryImpact).toContainText('Malé → Hulhumalé');
			await expect(ferryImpact).toContainText('No dated service in data');
			await expect(ferryImpact).toContainText('Sailing time');
			await expect(ferryImpact).not.toContainText('shorter expected wait');
			await assertDatedDepartures(ferryImpact, ferryPreview);
			await ferryImpact.scrollIntoViewIfNeeded();
			await ferry.page.screenshot({ path: path.join(output, 'ferry-connections-preview.png') });
			return {
				serviceDate: ferryPreview.service_date,
				connections: newConnections,
				summary: ferryPreview.summary
			};
		}
	);

	await check('Accepted ferry shows connection gains independently of walking access', async () => {
		await ferryEditor.getByRole('button', { name: 'Accept ferry service', exact: true }).click();
		await expect(ferryEditor).not.toBeVisible();
		const value = await evaluated(ferry);
		const impact = value.transport_connectivity?.impact;
		assert.ok(impact, 'The confirmed ferry evaluation includes transport service impact.');
		assertWalkingUnchanged(value);
		await showProposal(ferry);
		await ferry.panel.getByRole('button', { name: 'Review full impact', exact: true }).click();
		const review = ferry.page.getByRole('dialog');
		const component = review.getByRole('region', { name: 'Transport service impact', exact: true });
		await expect(component).toContainText('Hulhumalé → Malé');
		await expect(component).toContainText('Malé → Hulhumalé');
		await expect(component).toContainText('Sailing time');
		await expect(component).not.toContainText('shorter expected wait');
		await component.scrollIntoViewIfNeeded();
		await ferry.page.screenshot({ path: path.join(output, 'ferry-connections-full-review.png') });
		return {
			walkingGains: value.summary.gained_residents,
			impact
		};
	});

	await check('Transport impact fits a 390px mobile review without page overflow', async () => {
		await ferry.page.setViewportSize({ width: 390, height: 844 });
		const review = ferry.page.getByRole('dialog');
		const component = review.getByRole('region', { name: 'Transport service impact', exact: true });
		await component.scrollIntoViewIfNeeded();
		await expect
			.poll(() => ferry.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
			.toBe(true);
		assert.ok(
			await component.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)
		);
		const bounds = await component.boundingBox();
		assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391);
		await ferry.page.screenshot({ path: path.join(output, 'ferry-impact-mobile.png') });
		return { viewport: '390x844', componentBounds: bounds, horizontalOverflow: false };
	});
	await check('Service-impact journeys complete without browser runtime errors', async () => {
		assert.deepEqual(report.pageErrors, []);
		return { errors: 0 };
	});
} catch (error) {
	report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
	process.exitCode = 1;
	await currentPage
		?.screenshot({ path: path.join(output, 'failure.png'), fullPage: true })
		.catch(() => {});
} finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
	await Promise.allSettled(contexts.map((context) => context.close()));
	await browser.close();
	console.log(
		JSON.stringify(
			{
				checks: report.checks.map(({ name, status }) => ({ name, status })),
				pageErrors: report.pageErrors,
				failure: report.failure,
				evidence: path.join(output, 'verification.json')
			},
			null,
			2
		)
	);
}
