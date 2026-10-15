import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { chromium, expect } from '@playwright/test';

const baseURL = process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5173';
const output = path.resolve('artifacts/qa/timetable-import');
const run = path.join(output, `isolated-${Date.now()}`);
const privateData = path.join(run, 'backend-data');
const privatePublic = path.join(run, 'public-data');
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
	page.on('pageerror', (error) => report.errors.push(error.message));
	const url = `${baseURL}/?view=map&tool=explore&explorer=schedules&island=island%3A1443`;
	await check('Schedules workspace loads and routing stays disabled before import', async () => {
		await page.goto(url);
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
	/** @param {import('@playwright/test').Page} target */
	async function plan(target) {
		await target.getByLabel('From island', { exact: true }).selectOption('island:1443');
		await target.getByLabel('To island', { exact: true }).selectOption('island:1382');
		await target.getByLabel('Leave after · MVT', { exact: true }).fill('2026-10-14T07:30');
		await target.getByLabel('Transfer allowance · minutes', { exact: true }).fill('30');
		const response = target.waitForResponse(
			(item) =>
				item.url().endsWith('/data-updates/schedules/journey') && item.request().method() === 'POST'
		);
		await target.getByRole('button', { name: 'Find a dated itinerary' }).click();
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
		await expect(target.locator('.itinerary')).toContainText('14 Oct 2026, 10:15 MVT');
		await expect(target.locator('.journey-leg')).toHaveCount(2);
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
