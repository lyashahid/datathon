import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const baseURL = process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5173';
const output = path.resolve('artifacts/qa/timetable-import');
const run = path.join(output, `isolated-${Date.now()}`);
const privateData = path.join(run, 'backend-data');
const privatePublic = path.join(run, 'public-data');
const expect = playwrightExpect.configure({ timeout: 60000 });
/** @type {Array<{method:string,path:string,query:string,body:unknown}>} */
const sourceRequests = [];
await mkdir(privateData, { recursive: true });
/** @type {{baseURL:string,startedAt:string,finishedAt?:string,isolation:Record<string,unknown>,checks:Array<{name:string,status:string,detail?:unknown}>,errors:string[],forwardedRequests:string[]}} */
const report = {
	baseURL,
	startedAt: new Date().toISOString(),
	isolation: {
		privateData,
		privatePublic,
		fixtureQualification: 'SYNTHETIC QA ONLY; not an operator timetable or planning evidence'
	},
	checks: [],
	errors: [],
	forwardedRequests: []
};
const protectedSources = [
	'backend/data/cache/normalized/islands.geojson',
	'backend/data/cache/normalized/population.json',
	'data/public/planning-baseline.json',
	'data/public/policy-evidence/service-calendars.json'
];
/** @param {string} filename */
async function digest(filename) {
	return createHash('sha256')
		.update(await readFile(filename))
		.digest('hex');
}
async function originalReceipts() {
	return Object.fromEntries(
		await Promise.all(protectedSources.map(async (file) => [file, await digest(file)]))
	);
}
async function mainScheduleStore() {
	const directory = path.resolve('backend/data/runtime/source-updates/schedules');
	const names = await readdir(directory).catch(() => []);
	return Object.fromEntries(
		await Promise.all(
			names
				.filter((name) => name.endsWith('.json'))
				.map(async (name) => [name, await digest(path.join(directory, name))])
		)
	);
}
const originals = await originalReceipts();
const schedulesBefore = await mainScheduleStore();
for (const directory of ['normalized', 'derived', 'graphs']) {
	await cp(
		path.resolve('backend/data/cache', directory),
		path.join(privateData, 'cache', directory),
		{
			recursive: true,
			filter: (source) => !path.basename(source).startsWith('.') && !source.endsWith('.tmp')
		}
	);
}
await cp(path.resolve('data/public'), privatePublic, { recursive: true });
report.isolation.originalSourceReceipts = originals;
report.isolation.mainScheduleStoreBefore = schedulesBefore;
const listener = createServer();
await new Promise((resolve) => listener.listen(0, '127.0.0.1', () => resolve(undefined)));
const address = listener.address();
assert.ok(address && typeof address !== 'string');
const port = address.port;
await new Promise((resolve, reject) =>
	listener.close((error) => (error ? reject(error) : resolve(undefined)))
);
const serviceURL = `http://127.0.0.1:${port}`;
report.isolation.backendURL = serviceURL;
const python = path.resolve(
	'backend/.venv',
	process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
);
const backend = spawn(
	python,
	['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(port)],
	{
		cwd: path.resolve('backend'),
		windowsHide: true,
		env: {
			...process.env,
			MOBILITY_ENVIRONMENT: 'test',
			MOBILITY_DATA_DIR: privateData,
			MOBILITY_PUBLIC_DATA_DIR: privatePublic,
			MOBILITY_LIVE_AIRCRAFT_ENABLED: 'false',
			MOBILITY_LIVE_VESSEL_ENABLED: 'false',
			MOBILITY_LIVE_FOLLOWME_ENABLED: 'false',
			MOBILITY_LIVE_BUS_ENABLED: 'false'
		}
	}
);
let backendLog = '';
backend.stdout.on('data', (part) => {
	backendLog += String(part);
});
backend.stderr.on('data', (part) => {
	backendLog += String(part);
});
/** @type {import('@playwright/test').Browser | undefined} */
let browser;
/** @param {string} name @param {()=>Promise<unknown>} work */
async function check(name, work) {
	try {
		const detail = await work();
		report.checks.push({ name, status: 'passed', detail });
		console.log(`PASS ${name}`);
	} catch (error) {
		report.checks.push({
			name,
			status: 'failed',
			detail: error instanceof Error ? error.message : String(error)
		});
		throw error;
	}
}
/** @param {string} resource */
async function api(resource) {
	const response = await fetch(`${serviceURL}/api/v1/${resource}`);
	assert.ok(response.ok, `${resource}: HTTP ${response.status}`);
	return response.json();
}
const fixture = {
	schema_version: 1,
	title: 'SYNTHETIC QA ONLY — isolated two-leg timetable',
	timezone: 'Indian/Maldives',
	sources: [
		{
			publisher: 'SYNTHETIC QA ONLY; no operator provenance claim',
			url: 'https://rtl.mv/',
			retrieved_at: '2026-10-01T00:00:00Z',
			reference_period: 'QA fixture: October 2026',
			licence_note:
				'Synthetic QA fixture only. URL validates the source contract; these trips are not real operator evidence.'
		}
	],
	limitations: [
		'SYNTHETIC QA ONLY. Never use these trips as service, policy or passenger evidence.'
	],
	services: [
		{
			id: 'qa-only:first',
			name: 'SYNTHETIC QA ONLY first leg',
			mode: 'ferry',
			from_island_id: 'island:1443',
			to_island_id: 'island:1442',
			from_terminal: 'QA ONLY Malé terminal',
			to_terminal: 'QA ONLY Hulhumalé terminal',
			departure: '08:00',
			arrival: '09:00',
			timing_basis: 'published_arrival',
			weekdays: [1, 2, 3, 4, 5, 6, 7],
			effective_from: '2026-10-01',
			effective_until: '2026-10-31'
		},
		{
			id: 'qa-only:second',
			name: 'SYNTHETIC QA ONLY onward leg',
			mode: 'ferry',
			from_island_id: 'island:1442',
			to_island_id: 'island:1382',
			from_terminal: 'QA ONLY Hulhumalé terminal',
			to_terminal: 'QA ONLY Vilimalé terminal',
			departure: '09:40',
			arrival: '10:15',
			timing_basis: 'published_arrival',
			weekdays: [1, 2, 3, 4, 5, 6, 7],
			effective_from: '2026-10-01',
			effective_until: '2026-10-31'
		}
	]
};
await writeFile(
	path.join(run, 'SYNTHETIC-QA-ONLY-timetable.json'),
	JSON.stringify(fixture, null, 2)
);
try {
	await check(
		'Isolated real FastAPI server starts with copied sources and fresh runtime',
		async () => {
			let ready = false;
			for (let attempt = 0; attempt < 120; attempt++) {
				if (backend.exitCode !== null)
					throw new Error(`Isolated backend exited: ${backendLog.slice(-2000)}`);
				try {
					ready = (await fetch(`${serviceURL}/health`)).ok;
				} catch {
					/* Server startup is still in progress. */
				}
				if (ready) break;
				await pause(250);
			}
			assert.ok(ready, `Isolated server did not become ready: ${backendLog.slice(-2000)}`);
			assert.equal((await api('data-updates/schedules')).total, 0);
			return {
				environment: 'test',
				serviceURL,
				copiedSources: protectedSources.length,
				activeServices: 0
			};
		}
	);
	browser = await chromium.launch({ headless: true });
	/** @param {{width:number,height:number}} viewport */
	async function context(viewport) {
		assert.ok(browser);
		const value = await browser.newContext({ viewport, reducedMotion: 'reduce' });
		await value.route('**/api/backend/**', async (route) => {
			const original = new URL(route.request().url());
			const suffix = original.pathname.slice('/api/backend/'.length);
			const resource = suffix === 'health' ? '/health' : `/api/v1/${suffix}`;
			report.forwardedRequests.push(`${route.request().method()} ${resource}`);
			sourceRequests.push({
				method: route.request().method(),
				path: suffix,
				query: original.search,
				body: route.request().postDataJSON()
			});
			const response = await route.fetch({
				url: `${serviceURL}${resource}${original.search}`,
				timeout: 120000
			});
			await route.fulfill({ response });
		});
		return value;
	}
	const desktop = await context({ width: 1440, height: 1000 });
	const page = await desktop.newPage();
	page.setDefaultTimeout(60000);
	page.on('pageerror', (error) => report.errors.push(error.message));
	const url = `${baseURL}/?view=map&tool=explore&explorer=schedules&island=island%3A1442`;
	const dashboard = page.getByRole('region', { name: 'National analytics', exact: true });
	const studio = page.getByRole('region', {
		name: 'Multi-dataset explorer and chart builder',
		exact: true
	});
	const forecast = page.getByRole('region', { name: 'Passenger forecasts', exact: true });
	let forecastTarget = '';
	const draftForecastTarget = '2027-03';
	const navigation = page.getByRole('navigation', { name: 'Workspace', exact: true });
	const policyPanel = page.getByRole('region', { name: 'Island needs and proposal', exact: true });
	const workbench = page.getByRole('region', { name: 'Policy planning workbench', exact: true });
	const connections = page.getByRole('region', {
		name: 'Island connections',
		exact: true,
		includeHidden: true
	});
	const expectedCapital = '123000000';
	const expectedAnnual = '19000000';
	const specialistCapital = '230000000';
	const specialistAnnual = '31000000';
	const specialistOperation = {
		type: 'add_stop',
		name: 'SYNTHETIC QA ONLY retained boarding location',
		island_id: 'hulhumale',
		coordinates: [73.538, 4.214],
		metadata: { proposal_id: 'proposal:add_stop:qa-retained' }
	};
	const connectionQuery =
		'?origin_island_id=island:1443&date=2026-10-14&destination_island_id=island:1442';
	let selectedAtoll = '';
	/** @param {string} path @param {string | undefined} query */
	function requestsFor(path, query = undefined) {
		const parameters = new URLSearchParams(query);
		parameters.sort();
		const expectedQuery = parameters.size ? `?${parameters}` : '';
		return sourceRequests.filter(
			(request) => request.path === path && (query === undefined || request.query === expectedQuery)
		);
	}
	function refreshCounts() {
		return {
			national: requestsFor('national/summary').length,
			profile: requestsFor('islands/island%3A1442/profile').length,
			inventory: requestsFor('map/features', '?layer=infrastructure&include_unlocated=true').length,
			history: requestsFor('forecasts', '?history_only=true').length,
			outlook: requestsFor('forecasts').filter((request) => request.query !== '?history_only=true')
				.length,
			analysis: requestsFor('forecasts/analysis').length,
			forecastIssues: requestsFor('forecasts/issues').length,
			catalogue: requestsFor('datasets').length,
			chart: requestsFor('datasets/passenger-monthly/chart').length,
			advancedBaseline: requestsFor('planning/baseline', '?island_id=').length,
			connections: requestsFor('planning/connectivity', connectionQuery).length
		};
	}
	/** @param {string} name */
	async function specialistStep(name) {
		await workbench.locator('.policy-workflow').getByRole('button', { name, exact: true }).click();
		await expect(workbench.locator('#policy-inspector')).toBeVisible();
	}
	await check('Analytics and studio retain working filters before a source update', async () => {
		await page.goto(`${baseURL}/?view=overview&island=island%3A1442`);
		await expect(dashboard).toHaveAttribute('aria-busy', 'false');
		await expect(dashboard.getByRole('region', { name: 'Policy priorities' })).toHaveAttribute(
			'aria-busy',
			'false'
		);
		await dashboard
			.getByLabel('Passenger series', { exact: true })
			.selectOption('bus-male-hulhumale');
		await dashboard.getByRole('button', { name: 'All history', exact: true }).click();
		await dashboard.getByLabel('Island cohort', { exact: true }).selectOption('all');
		await expect
			.poll(() =>
				dashboard.getByLabel('Analytics atoll', { exact: true }).locator('option').count()
			)
			.toBeGreaterThan(1);
		selectedAtoll = await dashboard
			.getByLabel('Analytics atoll', { exact: true })
			.evaluate((element) => {
				const select = /** @type {HTMLSelectElement} */ (element);
				return [...select.options].find((option) => option.value !== 'all')?.value ?? '';
			});
		assert.ok(selectedAtoll, 'A real source atoll is available for the retained filter');
		await dashboard.getByLabel('Analytics atoll', { exact: true }).selectOption(selectedAtoll);
		await dashboard.evaluate((element) => element.setAttribute('data-qa-retained', 'analytics'));
		await page.getByRole('tab', { name: 'Data studio', exact: true }).click();
		await expect(studio.getByRole('button', { name: 'Chart CSV', exact: true })).toBeEnabled();
		await studio.locator('.filter-details summary').click();
		await studio.getByLabel('Filter column', { exact: true }).selectOption('mode');
		await studio.getByLabel('Filter value', { exact: true }).fill('bus');
		await studio.getByRole('button', { name: 'Add filter', exact: true }).click();
		const filtered = page.waitForResponse((response) =>
			response.url().endsWith('/datasets/passenger-monthly/chart')
		);
		await studio.getByRole('button', { name: 'Build chart', exact: true }).click();
		const chart = await (await filtered).json();
		assert.ok(chart.items.length > 0);
		assert.ok(chart.items.every((/** @type {{series:string}} */ item) => /bus/i.test(item.series)));
		await studio.getByLabel('Chart design', { exact: true }).selectOption('bar');
		await studio.locator('.story-details summary').click();
		await studio.getByLabel('Story title', { exact: true }).fill('Retained bus analysis');
		await studio.evaluate((element) => element.setAttribute('data-qa-retained', 'studio'));
		await page.getByRole('tab', { name: 'Passenger outlook', exact: true }).click();
		await expect(
			forecast.getByRole('button', { name: 'Update outlook', exact: true })
		).toBeEnabled();
		forecastTarget = await forecast.getByLabel('Target month', { exact: true }).inputValue();
		assert.ok(forecastTarget);
		await forecast.getByRole('tab', { name: 'Data & method', exact: true }).click();
		await expect(forecast.locator('.audit-metrics strong').first()).not.toHaveText('');
		await expect(
			forecast.getByRole('button', { name: 'Refresh analysis', exact: true })
		).toBeEnabled();
		await forecast.getByLabel('Target month', { exact: true }).fill(draftForecastTarget);
		await expect(
			forecast.getByRole('button', { name: 'Freeze forecast', exact: true })
		).toBeDisabled();
		await forecast.evaluate((element) => element.setAttribute('data-qa-retained', 'forecast'));
		// Return the national view before leaving Analytics so studio stays inactive after acceptance.
		await page.getByRole('tab', { name: 'National dashboard', exact: true }).click();
		await expect(dashboard).toBeVisible();
		return {
			selectedAtoll,
			cohort: 'all',
			datasetFilter: 'mode = bus',
			chartRows: chart.items.length
		};
	});
	await check(
		'Map draft budgets and selected island are ready before timetable review',
		async () => {
			await navigation.getByRole('button', { name: 'Map & planning', exact: true }).click();
			await expect(page.locator('.national-map')).toHaveAttribute('aria-busy', 'false');
			await expect(page).toHaveURL((value) => value.searchParams.get('island') === 'island:1442');
			await page.getByRole('button', { name: /^Create (?:a )?proposal$/ }).click();
			await policyPanel.getByRole('button', { name: 'Edit budget limits', exact: true }).click();
			await expect(policyPanel.getByLabel('Capital budget · MVR')).toBeVisible();
			await policyPanel.getByLabel('Capital budget · MVR').fill(expectedCapital);
			await policyPanel.getByLabel('Annual running budget · MVR').fill(expectedAnnual);
			await policyPanel.locator('.proposal-details > summary').click();
			await policyPanel
				.getByLabel('Proposal name', { exact: true })
				.fill('Retained island proposal');
			return {
				island: 'island:1442',
				capitalBudget: expectedCapital,
				annualBudget: expectedAnnual
			};
		}
	);
	await check(
		'Specialist service tools retain a separate budget and draft before import',
		async () => {
			await policyPanel
				.getByRole('button', { name: 'Advanced service & fleet tools', exact: true })
				.click();
			await specialistStep('Changes');
			await workbench.locator('.policy-context-disclosure summary').click();
			await workbench
				.getByRole('button', { name: 'Plan across Greater Malé', exact: true })
				.click();
			await expect(
				workbench
					.getByRole('tabpanel', { name: 'Changes', exact: true })
					.getByRole('button', { name: 'Review impact', exact: true })
			).toBeEnabled();
			await workbench.getByLabel('Import policy scenario file', { exact: true }).setInputFiles({
				name: 'SYNTHETIC-QA-ONLY-retained-specialist-draft.json',
				mimeType: 'application/json',
				buffer: Buffer.from(
					JSON.stringify({
						operations: [specialistOperation],
						assumptions: {
							capital_budget_mvr: Number(specialistCapital),
							annual_operating_budget_mvr: Number(specialistAnnual)
						}
					})
				)
			});
			await expect(workbench.locator('.policy-operation-row')).toHaveCount(1);
			await specialistStep('Budget & services');
			await expect(workbench.locator('#policy-capital-budget')).toHaveValue(specialistCapital);
			await expect(workbench.locator('#policy-annual-budget')).toHaveValue(specialistAnnual);
			await workbench.evaluate((element) => element.setAttribute('data-qa-retained', 'specialist'));
			await workbench.getByRole('button', { name: 'Back to Explore', exact: true }).click();
			return {
				scope: 'greater-male',
				operation: specialistOperation,
				specialistCapital,
				specialistAnnual
			};
		}
	);
	await check(
		'Island connection geometry and service evidence are warm before acceptance',
		async () => {
			await expect(policyPanel).toBeVisible();
			await policyPanel
				.getByRole('button', { name: 'Close island planning panel', exact: true })
				.click();
			await page.getByRole('button', { name: 'Directions', exact: true }).click();
			await page.getByRole('button', { name: 'Island connections', exact: true }).click();
			await connections.getByLabel('From island', { exact: true }).selectOption('island:1443');
			await connections
				.getByLabel('Check service evidence for', { exact: true })
				.fill('2026-10-14');
			const pending = page.waitForResponse((response) => {
				const value = new URL(response.url());
				return (
					value.pathname.endsWith('/planning/connectivity') &&
					value.searchParams.get('origin_island_id') === 'island:1443' &&
					value.searchParams.get('destination_island_id') === 'island:1442' &&
					value.searchParams.get('date') === '2026-10-14'
				);
			});
			await connections.getByLabel('To island', { exact: true }).selectOption('island:1442');
			const evidence = await (await pending).json();
			assert.notEqual(evidence.status, 'dated_service');
			await expect(connections).toHaveAttribute('aria-busy', 'false');
			await expect(connections.locator('.connection-verdict')).toBeVisible();
			await expect
				.poll(async () =>
					Number(
						await page.locator('.national-map').getAttribute('data-island-connection-features')
					)
				)
				.toBeGreaterThan(0);
			await connections.evaluate((element) =>
				element.setAttribute('data-qa-retained', 'connections')
			);
			await page.getByRole('button', { name: 'Nationwide schedules', exact: true }).click();
			return { status: evidence.status, connections: refreshCounts().connections };
		}
	);
	await check('Schedules workspace loads and routing stays disabled before import', async () => {
		await expect(
			page.getByRole('heading', { name: 'Nationwide timetables', exact: true })
		).toBeVisible({ timeout: 60000 });
		await expect(page.getByRole('button', { name: 'Find a dated itinerary' })).toBeDisabled();
		await expect(
			page.locator('.source-updates .empty').filter({ hasText: 'No reviewed timed services' })
		).toBeVisible();
		await expect(page.getByText('Loading source receipts…', { exact: true })).toBeHidden({
			timeout: 60000
		});
	});
	let beforeAcceptance = refreshCounts();
	let snapshotID = '';
	await check('JSON upload stages a review without activating its services', async () => {
		const stagedResponse = page.waitForResponse(
			(response) =>
				response.url().endsWith('/data-updates/schedules/stage') &&
				response.request().method() === 'POST'
		);
		await page.locator('.file-input').setInputFiles({
			name: 'SYNTHETIC-QA-ONLY-timetable.json',
			mimeType: 'application/json',
			buffer: Buffer.from(JSON.stringify(fixture))
		});
		const response = await stagedResponse;
		assert.equal(response.status(), 200);
		const staged = await response.json();
		snapshotID = staged.id;
		assert.equal(staged.accepted, false);
		assert.equal(staged.review.services, 2);
		await expect(page.locator('.review')).toContainText(
			'2 services · 3 islands · 0 assumed runtimes'
		);
		await expect(page.getByRole('button', { name: 'Accept reviewed timetable' })).toBeDisabled();
		assert.equal((await api('data-updates/schedules')).total, 0);
		await page.screenshot({ path: path.join(output, 'stage-review-desktop.png'), fullPage: true });
		return { snapshotID, activeServices: 0, stagedServices: 2 };
	});
	await check('Review note and explicit review acknowledgment gate acceptance', async () => {
		await page
			.getByLabel('Review note', { exact: true })
			.fill(
				'Synthetic QA review only: dates, local clock times, transfer and fixture arrivals checked.'
			);
		await expect(page.getByRole('button', { name: 'Accept reviewed timetable' })).toBeDisabled();
		await page
			.getByRole('checkbox', { name: 'I checked the source, dates and timing assumptions.' })
			.check();
		await expect(page.getByRole('button', { name: 'Accept reviewed timetable' })).toBeEnabled();
	});
	await check(
		'Acceptance persists a reviewed receipt and activates exactly two services',
		async () => {
			beforeAcceptance = refreshCounts();
			const acceptance = page.waitForResponse(
				(response) =>
					response.url().endsWith(`/${snapshotID}/accept`) && response.request().method() === 'POST'
			);
			await page.getByRole('button', { name: 'Accept reviewed timetable' }).click();
			const response = await acceptance;
			assert.equal(response.status(), 200);
			const accepted = await response.json();
			assert.equal(accepted.accepted, true);
			assert.ok(accepted.accepted_at);
			const catalogue = await api('data-updates/schedules');
			assert.equal(catalogue.total, 2);
			assert.equal(catalogue.snapshots.length, 1);
			await expect(page.locator('.snapshot')).toContainText('Accepted · 2 services');
			return { snapshotID, acceptedAt: accepted.accepted_at, activeServices: catalogue.total };
		}
	);
	await check(
		'Accepted sources refresh the active root and defer hidden analysis work',
		async () => {
			await expect.poll(() => refreshCounts().national).toBeGreaterThan(beforeAcceptance.national);
			await expect.poll(() => refreshCounts().profile).toBeGreaterThan(beforeAcceptance.profile);
			const refreshed = refreshCounts();
			assert.equal(
				refreshed.catalogue,
				beforeAcceptance.catalogue,
				'Hidden studio defers its catalogue'
			);
			assert.equal(
				refreshed.chart,
				beforeAcceptance.chart,
				'Hidden studio defers its filtered chart'
			);
			assert.equal(
				refreshed.history,
				beforeAcceptance.history,
				'Hidden passenger history defers its refresh'
			);
			assert.equal(
				refreshed.inventory,
				beforeAcceptance.inventory,
				'Hidden analytics defers its inventory'
			);
			for (const key of ['outlook', 'analysis', 'forecastIssues'])
				assert.equal(
					refreshed[/** @type {keyof typeof refreshed} */ (key)],
					beforeAcceptance[/** @type {keyof typeof beforeAcceptance} */ (key)],
					`Hidden ${key} defers its source refresh`
				);
			assert.equal(
				refreshed.advancedBaseline,
				beforeAcceptance.advancedBaseline,
				'Hidden specialist service tools defer their Greater Malé baseline'
			);
			await expect.poll(() => refreshCounts().connections).toBe(beforeAcceptance.connections + 1);
			await expect(connections).toHaveAttribute('data-qa-retained', 'connections');
			await expect(connections).toHaveAttribute('aria-busy', 'false');
			await expect(connections.locator('.connection-verdict')).toContainText(
				'A published service connects these islands'
			);
			await expect(connections.locator('.service-evidence').first()).toContainText(
				'SYNTHETIC QA ONLY first leg'
			);
			await expect
				.poll(async () =>
					Number(
						await page.locator('.national-map').getAttribute('data-island-connection-features')
					)
				)
				.toBeGreaterThan(2);
			await expect(page).toHaveURL((value) => value.searchParams.get('island') === 'island:1442');
			await page.getByRole('button', { name: 'Back to map', exact: true }).click();
			await page.getByRole('button', { name: /^Create (?:a )?proposal$/ }).click();
			if (!(await policyPanel.getByLabel('Capital budget · MVR').isVisible()))
				await policyPanel.getByRole('button', { name: 'Edit budget limits', exact: true }).click();
			if ((await policyPanel.locator('.proposal-details').getAttribute('open')) === null)
				await policyPanel.locator('.proposal-details > summary').click();
			await expect(policyPanel.getByLabel('Capital budget · MVR')).toHaveValue(expectedCapital);
			await expect(policyPanel.getByLabel('Annual running budget · MVR')).toHaveValue(
				expectedAnnual
			);
			await expect(policyPanel.getByLabel('Proposal name', { exact: true })).toHaveValue(
				'Retained island proposal'
			);
			return { beforeAcceptance, afterAcceptance: refreshed, retainedIsland: 'island:1442' };
		}
	);
	await check(
		'Reactivated specialist tools reload evidence while preserving operations and budgets',
		async () => {
			await policyPanel
				.getByRole('button', { name: 'Advanced service & fleet tools', exact: true })
				.click();
			await specialistStep('Changes');
			await expect(workbench.locator('.policy-operation-row')).toHaveCount(1);
			await expect(workbench.locator('.policy-operation-row')).toContainText(
				specialistOperation.name
			);
			await expect
				.poll(() => refreshCounts().advancedBaseline)
				.toBe(beforeAcceptance.advancedBaseline + 1);
			await expect(workbench).toHaveAttribute('data-qa-retained', 'specialist');
			await specialistStep('Budget & services');
			await expect(workbench.locator('#policy-capital-budget')).toHaveValue(specialistCapital);
			await expect(workbench.locator('#policy-annual-budget')).toHaveValue(specialistAnnual);
			const saved = await page.evaluate(() =>
				JSON.parse(localStorage.getItem('policy-workbench-v1:greater-male') || '{}')
			);
			assert.deepEqual(saved.operations, [specialistOperation]);
			assert.equal(saved.assumptions.capital_budget_mvr, Number(specialistCapital));
			assert.equal(saved.assumptions.annual_operating_budget_mvr, Number(specialistAnnual));
			return {
				retainedOperations: saved.operations.length,
				requests: refreshCounts(),
				specialistCapital,
				specialistAnnual
			};
		}
	);
	await check('Reactivated analytics refresh once and preserve their filters', async () => {
		await navigation.getByRole('button', { name: 'Analytics', exact: true }).click();
		await expect(dashboard).toHaveAttribute('aria-busy', 'false');
		await expect.poll(() => refreshCounts().inventory).toBe(beforeAcceptance.inventory + 1);
		await expect.poll(() => refreshCounts().history).toBe(beforeAcceptance.history + 1);
		await expect(dashboard).toHaveAttribute('data-qa-retained', 'analytics');
		await expect(dashboard.getByLabel('Island cohort', { exact: true })).toHaveValue('all');
		await expect(dashboard.getByLabel('Analytics atoll', { exact: true })).toHaveValue(
			selectedAtoll
		);
		await expect(dashboard.getByLabel('Passenger series', { exact: true })).toHaveValue(
			'bus-male-hulhumale'
		);
		await expect(
			dashboard.getByRole('region', { name: 'Passenger movement trends' })
		).toHaveAttribute('data-period', 'all');
		assert.equal(refreshCounts().catalogue, beforeAcceptance.catalogue);
		return {
			refreshedInventory: refreshCounts().inventory,
			refreshedHistory: refreshCounts().history,
			selectedAtoll
		};
	});
	await check(
		'Reactivated forecasts refresh source analysis without applying the draft target month',
		async () => {
			await page.getByRole('tab', { name: 'Passenger outlook', exact: true }).click();
			await expect.poll(() => refreshCounts().outlook).toBe(beforeAcceptance.outlook + 1);
			await expect.poll(() => refreshCounts().analysis).toBe(beforeAcceptance.analysis + 1);
			await expect
				.poll(() => refreshCounts().forecastIssues)
				.toBe(beforeAcceptance.forecastIssues + 1);
			await expect(
				forecast.getByRole('button', { name: 'Update outlook', exact: true })
			).toBeEnabled();
			await expect(
				forecast.getByRole('button', { name: 'Refresh analysis', exact: true })
			).toBeEnabled();
			await expect(forecast).toHaveAttribute('data-qa-retained', 'forecast');
			await expect(forecast.getByLabel('Target month', { exact: true })).toHaveValue(
				draftForecastTarget
			);
			await expect(
				forecast.getByRole('button', { name: 'Freeze forecast', exact: true })
			).toBeDisabled();
			await expect(forecast.locator('.source-caption')).toContainText('apply the new target');
			const requested = requestsFor('forecasts')
				.filter((request) => request.query !== '?history_only=true')
				.at(-1);
			assert.equal(new URLSearchParams(requested?.query).get('target_month'), forecastTarget);
			await page.getByRole('tab', { name: 'National dashboard', exact: true }).click();
			return {
				refreshedOutlook: true,
				refreshedAnalysis: true,
				forecastTarget,
				draftForecastTarget
			};
		}
	);
	await check(
		'Reactivated studio rebuilds the filtered chart without losing the working story',
		async () => {
			const refreshedChart = page.waitForResponse((response) =>
				response.url().endsWith('/datasets/passenger-monthly/chart')
			);
			await page.getByRole('tab', { name: 'Data studio', exact: true }).click();
			const response = await refreshedChart;
			assert.equal(response.status(), 200);
			const chart = await response.json();
			assert.ok(chart.items.length > 0);
			assert.ok(
				chart.items.every((/** @type {{series:string}} */ item) => /bus/i.test(item.series))
			);
			await expect.poll(() => refreshCounts().catalogue).toBe(beforeAcceptance.catalogue + 1);
			await expect.poll(() => refreshCounts().chart).toBe(beforeAcceptance.chart + 1);
			const request = requestsFor('datasets/passenger-monthly/chart').at(-1);
			assert.ok(request);
			assert.deepEqual(/** @type {{filters:unknown[]}} */ (request.body).filters, [
				{ column: 'mode', op: 'eq', value: 'bus' }
			]);
			await expect(studio).toHaveAttribute('data-qa-retained', 'studio');
			await expect(studio.getByLabel('Chart design', { exact: true })).toHaveValue('bar');
			await studio.locator('.story-details summary').click();
			await expect(studio.getByLabel('Story title', { exact: true })).toHaveValue(
				'Retained bus analysis'
			);
			await expect(studio.getByRole('button', { name: 'Chart CSV', exact: true })).toBeEnabled();
			await page.getByRole('tab', { name: 'National dashboard', exact: true }).click();
			await expect(dashboard).toHaveAttribute('aria-busy', 'false');
			assert.equal(
				refreshCounts().inventory,
				beforeAcceptance.inventory + 1,
				'Clean activation reuses refreshed analytics'
			);
			await navigation.getByRole('button', { name: 'Map & planning', exact: true }).click();
			await page.getByRole('button', { name: 'Nationwide schedules', exact: true }).click();
			await expect(page.locator('.snapshot')).toContainText('Accepted · 2 services');
			return {
				chartRows: chart.items.length,
				requests: refreshCounts(),
				retainedStory: 'Retained bus analysis'
			};
		}
	);
	/** @param {import('@playwright/test').Page} target */
	async function plan(target) {
		const schedules = target.getByRole('region', { name: 'Nationwide timetables', exact: true });
		await schedules.getByLabel('From island', { exact: true }).selectOption('island:1443');
		await schedules.getByLabel('To island', { exact: true }).selectOption('island:1382');
		await schedules.getByLabel('Leave after · MVT', { exact: true }).fill('2026-10-14T07:30');
		await schedules.getByLabel('Transfer allowance · minutes', { exact: true }).fill('30');
		const response = target.waitForResponse(
			(item) =>
				item.url().endsWith('/data-updates/schedules/journey') && item.request().method() === 'POST'
		);
		await schedules.getByRole('button', { name: 'Find a dated itinerary' }).click();
		const result = await response;
		assert.equal(result.status(), 200);
		const journey = await result.json();
		assert.equal(journey.status, 'found');
		assert.equal(journey.arrival_at, '2026-10-14T10:15:00+05:00');
		assert.equal(journey.elapsed_minutes, 165);
		assert.equal(journey.legs.length, 2);
		assert.equal(journey.legs[0].waiting_minutes, 30);
		assert.equal(journey.legs[1].waiting_minutes, 40);
		assert.equal(journey.includes_assumptions, false);
		await expect(schedules.locator('.itinerary')).toContainText('14 Oct 2026, 10:15 MVT');
		await expect(schedules.locator('.journey-leg')).toHaveCount(2);
		return journey;
	}
	await check('Dated UI itinerary respects MVT, waits and the transfer allowance', async () => {
		const journey = await plan(page);
		await writeFile(
			path.join(output, 'SYNTHETIC-QA-ONLY-itinerary.json'),
			JSON.stringify(journey, null, 2)
		);
		await page.screenshot({
			path: path.join(output, 'accepted-itinerary-desktop.png'),
			fullPage: true
		});
		return {
			arrivalAt: journey.arrival_at,
			elapsedMinutes: journey.elapsed_minutes,
			legs: journey.legs.length,
			waits: journey.legs.map(
				(/** @type {{waiting_minutes:number}} */ item) => item.waiting_minutes
			)
		};
	});
	await check('Accepted snapshot survives reload and works at 390px without overflow', async () => {
		const mobile = await context({ width: 390, height: 844 });
		const target = await mobile.newPage();
		target.on('pageerror', (error) => report.errors.push(error.message));
		await target.goto(url);
		await expect(target.locator('.snapshot')).toContainText('Accepted · 2 services', {
			timeout: 60000
		});
		await plan(target);
		assert.ok(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
		await target.screenshot({
			path: path.join(output, 'accepted-itinerary-mobile.png'),
			fullPage: true
		});
		await mobile.close();
		return { width: 390, acceptedSnapshots: 1, activeServices: 2 };
	});
	await check(
		'Accepting a newer timetable clears its itinerary and preserves source versions',
		async () => {
			const savedItinerary = page.locator('.source-updates.standalone .itinerary');
			await expect(savedItinerary).toHaveCount(1);
			const evidence = page.getByRole('region', { name: 'Nationwide timetables', exact: true });
			await expect(evidence.getByText('Loading source receipts…', { exact: true })).toBeHidden();
			const stagedResponse = page.waitForResponse(
				(response) =>
					response.url().endsWith('/data-updates/schedules/stage') &&
					response.request().method() === 'POST'
			);
			await evidence.locator('.file-input').setInputFiles({
				name: 'SYNTHETIC-QA-ONLY-revalidated-timetable.json',
				mimeType: 'application/json',
				buffer: Buffer.from(JSON.stringify({ ...fixture, title: `${fixture.title} — revalidated` }))
			});
			const staged = await (await stagedResponse).json();
			assert.notEqual(staged.id, snapshotID);
			await evidence
				.getByLabel('Review note', { exact: true })
				.fill(
					'Synthetic QA only: revalidated the same two trips to test a retained itinerary source change.'
				);
			await evidence
				.getByRole('checkbox', {
					name: 'I checked the source, dates and timing assumptions.'
				})
				.check();
			const acceptance = page.waitForResponse(
				(response) =>
					response.url().endsWith(`/${staged.id}/accept`) && response.request().method() === 'POST'
			);
			await evidence
				.getByRole('button', { name: 'Accept reviewed timetable', exact: true })
				.click();
			assert.equal((await acceptance).status(), 200);
			await expect(savedItinerary).toHaveCount(0);
			const schedules = await api('data-updates/schedules');
			assert.equal(schedules.snapshots.length, 2);
			assert.equal(schedules.total, 2);
			return { acceptedSnapshots: 2, activeServices: 2, retainedItineraryCleared: true };
		}
	);
	await check('Main source receipts and main timetable store remain unchanged', async () => {
		const after = await originalReceipts();
		const schedulesAfter = await mainScheduleStore();
		assert.deepEqual(after, originals);
		assert.deepEqual(schedulesAfter, schedulesBefore);
		report.isolation.originalSourceReceiptsAfter = after;
		report.isolation.mainScheduleStoreAfter = schedulesAfter;
		return {
			unchangedSourceFiles: protectedSources.length,
			unchangedMainScheduleSnapshots: Object.keys(schedulesBefore).length
		};
	});
	assert.deepEqual(report.errors, []);
} finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
	if (browser) {
		for (const active of browser.contexts()) await active.unrouteAll({ behavior: 'ignoreErrors' });
		await browser.close();
	}
	backend.kill();
	await writeFile(path.join(output, 'isolated-backend.log'), backendLog);
}
