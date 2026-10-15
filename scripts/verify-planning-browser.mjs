import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

/** @typedef {{id:string,islandId:string,lon:number,lat:number,population2026:number}} Origin */
/** @typedef {{id:string,name?:string,islandId:string,lon:number,lat:number}} Stop */
/** @typedef {{id:string}} Edge */
/** @typedef {{origins:Origin[],stops:Stop[],graph_edges:Edge[],source_receipts:unknown[]}} Baseline */
/** @typedef {{type:string,name?:string,target_id?:string,metadata?:Record<string,unknown>,service?:{id:string,stopIds:string[]}}} Operation */
/** @typedef {{operations:Operation[],assumptions:Record<string,unknown>}} Option */
/** @typedef {{summary:{population:number|null},travel_time_bands:{before:{residents:number|null}[],after:{residents:number|null}[]},economics:{delta:Record<string,number|null>},warnings:string[],source_receipts:unknown[]}} Evaluation */
/** @typedef {{status:string,outward:{destination_id:string|null,minutes:number|null,geometry:number[][]},return_journey:{destination_id:string|null,minutes:number|null}|null,home_at_minutes:number|null}} Appointment */
/** @typedef {{patterns:{id:string,trips:unknown[]}[],official_ferry_calendars:unknown[]}} Timetable */
/** @typedef {{id:string,status:string}} Notice */
/** @typedef {{name:string,status:string,milliseconds:number,detail?:unknown,message?:string}} Check */

const baseURL = process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5180';
const output = path.resolve('artifacts/qa/planning');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 45000 });
/** @type {{baseURL:string,startedAt:string,finishedAt?:string,checks:Check[],errors:string[],failure?:string,noticeCleanup?:{noticeId:string,status:string,httpStatus:number}}} */
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], errors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1000 },
	reducedMotion: 'reduce',
	acceptDownloads: true
});
context.setDefaultTimeout(60000);
const page = await context.newPage();
page.on('pageerror', (error) => report.errors.push(error.message));
let baselineRequests = 0;
page.on('request', (request) => {
	if (request.url().includes('/planning/baseline')) baselineRequests += 1;
});
/** @type {Baseline} */
let baseline;
/** @type {Option|null} */
let exported = null;
/** @type {string|null} */
let noticeId = null;

/** @param {string} name @param {()=>Promise<unknown>} work */
async function check(name, work) {
	const started = Date.now();
	console.log(`RUN ${name}`);
	try {
		const detail = await work();
		report.checks.push({ name, status: 'passed', milliseconds: Date.now() - started, detail });
		console.log(`PASS ${name}`);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		report.checks.push({ name, status: 'failed', milliseconds: Date.now() - started, message });
		throw error;
	}
}
/** @param {import('@playwright/test').Page} surface @param {string} endpoint */
function responseFor(surface, endpoint) {
	return surface.waitForResponse(
		(response) =>
			response.url().includes(`/planning/${endpoint}`) && response.request().method() === 'POST',
		{ timeout: 90000 }
	);
}
/** @param {import('@playwright/test').Page} surface @returns {Promise<Evaluation>} */
async function evaluate(surface) {
	const pending = responseFor(surface, 'evaluate');
	await surface.getByRole('button', { name: 'Evaluate proposal', exact: true }).click();
	const response = await pending;
	assert.equal(response.status(), 200, await response.text());
	return response.json();
}
/** @param {import('@playwright/test').Page} surface @returns {Promise<Option>} */
async function savedOption(surface) {
	return surface.evaluate(() =>
		JSON.parse(localStorage.getItem('policy-workbench-v1:island:1443') || '{}')
	);
}
/** @param {Evaluation} result */
function reconcile(result) {
	assert.ok(result.summary.population !== null && result.summary.population > 0);
	for (const side of ['before', 'after']) {
		/** @type {{residents:number|null}[]} */
		const rows = result.travel_time_bands[/** @type {'before'|'after'} */ (side)];
		const sum = rows.reduce((total, row) => total + (row.residents ?? 0), 0);
		assert.ok(Math.abs(sum - result.summary.population) < 0.02, `${side}: band total ${sum}`);
	}
}

/** @param {import('@playwright/test').Page} surface */
async function assertPolicyTabsFit(surface) {
	// Resize scroll anchoring may move the page between separate locator measurements.
	const snapshot = await surface.evaluate(async () => {
		await new Promise((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))
		);
		const list = document.querySelector('.policy-tabs [role="tablist"]');
		const content = Array.from(
			document.querySelectorAll('.policy-tabs [data-slot="tabs-content"]')
		).find((element) => getComputedStyle(element).display !== 'none');
		if (!list || !content) return null;
		/** @param {Element} element */
		const bounds = (element) => {
			const rect = element.getBoundingClientRect();
			return { y: rect.y, height: rect.height };
		};
		return {
			listBox: bounds(list),
			contentBox: bounds(content),
			triggers: Array.from(list.querySelectorAll('[role="tab"]')).map(bounds)
		};
	});
	assert.ok(snapshot, 'Policy navigation and active panel have measurable bounds');
	const { listBox, contentBox } = snapshot;
	assert.ok(
		listBox.y + listBox.height <= contentBox.y + 1,
		`Policy tabs overlap their panel: ${JSON.stringify({ listBox, contentBox })}`
	);
	for (const box of snapshot.triggers) {
		assert.ok(
			box && box.y + box.height <= listBox.y + listBox.height + 1,
			`Wrapped trigger exceeds its tab list: ${JSON.stringify({ box, listBox })}`
		);
	}
}

/** @param {import('@playwright/test').Page} surface @param {string} name */
async function captureStage(surface, name) {
	await assertPolicyTabsFit(surface);
	await surface.screenshot({ path: path.join(output, `${name}-desktop.png`), fullPage: true });
	await surface.setViewportSize({ width: 375, height: 812 });
	await assertPolicyTabsFit(surface);
	await surface.screenshot({ path: path.join(output, `${name}-mobile.png`), fullPage: true });
	await surface.setViewportSize({ width: 1440, height: 1000 });
}

try {
	await check('Audited baseline, one initial request, and immutable no-op comparison', async () => {
		const response = await context.request.get(
			`${baseURL}/api/backend/planning/baseline?island_id=island%3A1443`
		);
		assert.equal(response.status(), 200);
		baseline = await response.json();
		assert.ok(baseline.origins.length > 100 && baseline.graph_edges.length > 100);
		await page.goto(`${baseURL}/?view=scenarios&proposal=policy&island=island%3A1443`);
		await expect(page.locator('#policy-operation')).toBeVisible();
		assert.equal(baselineRequests, 1);
		const result = await evaluate(page);
		reconcile(result);
		assert.equal(result.economics.delta.capital_mvr, 0);
		assert.equal(result.economics.delta.annual_operating_mvr, 0);
		assert.equal(result.economics.delta.net_annual_kg_co2e, 0);
		assert.ok(result.source_receipts.length > 0);
		return {
			origins: baseline.origins.length,
			population: result.summary.population,
			baselineRequests
		};
	});

	await check('Real outward/return appointment and stale export guard', async () => {
		await page.getByRole('tab', { name: '3 · Journeys & returns', exact: true }).click();
		await page.locator('#policy-origin').selectOption(baseline.origins[0].id);
		await page.locator('#policy-appointment').fill('30');
		const pending = responseFor(page, 'journey');
		await page.getByRole('button', { name: 'Calculate outward and return', exact: true }).click();
		const response = await pending;
		assert.equal(response.status(), 200, await response.text());
		/** @type {Appointment} */
		const appointment = await response.json();
		assert.equal(appointment.status, 'feasible');
		assert.equal(appointment.return_journey?.destination_id, baseline.origins[0].id);
		assert.ok(appointment.outward.geometry.length > 0);
		assert.ok(appointment.home_at_minutes !== null && appointment.home_at_minutes > 920);
		await expect(
			page.getByRole('button', { name: 'Export actual journey geometry' })
		).toBeEnabled();
		const downloadPending = page.waitForEvent('download');
		await page.getByRole('button', { name: 'Export actual journey geometry' }).click();
		const download = await downloadPending;
		await download.saveAs(path.join(output, 'appointment-journey.json'));
		await captureStage(page, 'appointment-journey');
		await page.locator('#policy-appointment').fill('31');
		await expect(
			page.getByText('Journey inputs changed. Calculate the outward and return trip again.')
		).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Export actual journey geometry' })
		).toBeDisabled();
		return {
			status: appointment.status,
			outwardMinutes: appointment.outward.minutes,
			returnMinutes: appointment.return_journey?.minutes,
			homeAtMinutes: appointment.home_at_minutes,
			geometryPoints: appointment.outward.geometry.length
		};
	});

	await check('Hospital investment and unknown facility carbon remain separate', async () => {
		await page.getByRole('tab', { name: '1 · Design proposal', exact: true }).click();
		await page.locator('#policy-name').fill('QA proposed community hospital');
		await page.locator('#policy-lon').fill(String(baseline.origins[0].lon));
		await page.locator('#policy-lat').fill(String(baseline.origins[0].lat));
		await page.getByRole('button', { name: 'Add intervention', exact: true }).click();
		const result = await evaluate(page);
		reconcile(result);
		assert.equal(result.economics.delta.capital_mvr, 120_000_000);
		assert.equal(result.economics.delta.annual_operating_mvr, 20_000_000);
		assert.equal(result.economics.delta.net_annual_kg_co2e, null);
		assert.equal(result.economics.delta.annual_fleet_operating_kg_co2e, 0);
		assert.equal(result.economics.delta.embodied_facility_kg_co2e, null);
		await captureStage(page, 'resident-access');
		await page.getByRole('tab', { name: '1 · Design proposal', exact: true }).click();
		await page.getByRole('button', { name: 'Remove intervention 1', exact: true }).click();
		return result.economics.delta;
	});

	await check('School uses explicit energy/construction carbon assumptions', async () => {
		await page.locator('#policy-goal').selectOption('education');
		await page.locator('#policy-operation').selectOption('add_school');
		await page.locator('#policy-name').fill('QA proposed school');
		await page.locator('#policy-facility-annual-carbon').fill('1250');
		await page.locator('#policy-facility-embodied-carbon').fill('12000');
		await page.getByRole('button', { name: 'Add intervention', exact: true }).click();
		const result = await evaluate(page);
		assert.equal(result.economics.delta.capital_mvr, 25_000_000);
		assert.equal(result.economics.delta.annual_facility_operating_kg_co2e, 1250);
		assert.equal(result.economics.delta.embodied_facility_kg_co2e, 12000);
		return result.economics.delta;
	});

	await check(
		'Two-direction service form and stable stop references survive removing an earlier edit',
		async () => {
			await page.getByRole('tab', { name: '1 · Design proposal', exact: true }).click();
			await page.locator('#policy-operation').selectOption('add_stop');
			await page.locator('#policy-name').fill('QA stable boarding location');
			await page.getByRole('button', { name: 'Add intervention', exact: true }).click();
			let option = await savedOption(page);
			const stopId = String(
				option.operations.find((operation) => operation.type === 'add_stop')?.metadata?.proposal_id
			);
			assert.ok(stopId.startsWith('proposal:add_stop:'));
			await page.locator('#policy-operation').selectOption('add_service');
			await page.locator('#policy-service-name').fill('QA assumed return service');
			await page.locator('#policy-service-mode').selectOption('bus');
			await page.locator('#policy-service-from').selectOption(stopId);
			await page.locator('#policy-service-to').selectOption(baseline.stops[0].id);
			await page.locator('#policy-service-headway').fill('30');
			await page.locator('#policy-service-start').fill('15:20');
			await page.locator('#policy-service-end').fill('17:00');
			await page.locator('#policy-service-runtime').fill('12');
			await page.locator('#policy-service-distance').fill('1');
			await page.locator('#policy-service-return').check();
			await page.getByRole('button', { name: 'Add intervention', exact: true }).click();
			await page.getByRole('button', { name: 'Remove intervention 1', exact: true }).click();
			option = await savedOption(page);
			assert.equal(option.operations.length, 3);
			assert.equal(option.operations[0].metadata?.proposal_id, stopId);
			assert.equal(option.operations[1].service?.stopIds[0], stopId);
			assert.equal(option.operations[2].service?.stopIds[1], stopId);
			const result = await evaluate(page);
			reconcile(result);
			assert.ok(
				result.economics.delta.capital_mvr !== null && result.economics.delta.capital_mvr > 100_000
			);
			await page.getByRole('tab', { name: '4 · Timetables & delivery', exact: true }).click();
			await expect(
				page
					.locator('.policy-tabs [data-slot="tabs-content"]:visible')
					.getByText('QA assumed return service', { exact: true })
					.first()
			).toBeVisible();
			const pending = responseFor(page, 'timetable');
			await page.getByRole('button', { name: 'Load selected-date timetable', exact: true }).click();
			const response = await pending;
			assert.equal(response.status(), 200, await response.text());
			/** @type {Timetable} */
			const timetable = await response.json();
			const importedPatterns = timetable.patterns.filter((pattern) =>
				pattern.id.startsWith('proposal:service:')
			);
			assert.equal(importedPatterns.length, 2);
			assert.ok(importedPatterns.every((pattern) => pattern.trips.length === 4));
			assert.equal(timetable.official_ferry_calendars.length, 4);
			await captureStage(page, 'timetable-delivery');
			return {
				stopId,
				servicePatterns: importedPatterns.map((pattern) => pattern.id),
				capital: result.economics.delta.capital_mvr
			};
		}
	);

	await check(
		'Scoped draft reload, readable export/import, and cross-island scope isolation',
		async () => {
			await page.getByRole('tab', { name: '1 · Design proposal', exact: true }).click();
			const pending = page.waitForEvent('download');
			await page.getByRole('button', { name: 'Export reproducible option', exact: true }).click();
			const download = await pending;
			const filename = path.join(output, 'policy-scenario.json');
			await download.saveAs(filename);
			exported = JSON.parse(await readFile(filename, 'utf8'));
			assert.equal(exported?.operations.length, 3);
			await page.reload();
			await expect(
				page.getByText('QA stable boarding location', { exact: true }).first()
			).toBeVisible();
			assert.deepEqual((await savedOption(page)).operations, exported?.operations);
			await page.getByRole('button', { name: 'Remove intervention 3', exact: true }).click();
			await page.getByLabel('Import policy scenario file', { exact: true }).setInputFiles(filename);
			await expect(
				page.getByRole('button', { name: 'Remove intervention 3', exact: true })
			).toBeVisible();
			assert.deepEqual((await savedOption(page)).operations, exported?.operations);
			await page.getByRole('button', { name: 'Plan across Greater Malé', exact: true }).click();
			await expect(
				page.getByText('667 resident areas · 11 bus patterns', { exact: true })
			).toBeVisible();
			assert.equal(await page.locator('.policy-operation-row').count(), 0);
			await page.reload();
			await expect(
				page.getByText('QA stable boarding location', { exact: true }).first()
			).toBeVisible();
			assert.deepEqual((await savedOption(page)).operations, exported?.operations);
			return { persistedOperations: exported?.operations.length, importedAgain: true };
		}
	);

	await check(
		'Reviewed notice survives delayed first policy mount and is consumed once',
		async () => {
			const noticePage = await context.newPage();
			noticePage.on('pageerror', (error) => report.errors.push(error.message));
			await noticePage.goto(`${baseURL}/?view=live&context=conditions&island=island%3A1443`);
			await noticePage.getByRole('tab', { name: /Public notices/ }).click();
			await noticePage.locator('#notice-url').fill('https://www.mtcc.mv/');
			await noticePage.locator('#notice-title').fill('QA exercise: reviewed closure mapping');
			await noticePage
				.locator('#notice-text')
				.fill(
					'QA exercise supplied by the tester: an assumed road closure for a planning test. This text is not an official current notice.'
				);
			const importPending = noticePage.waitForResponse(
				(response) =>
					response.url().includes('/operations/notices/ingest') &&
					response.request().method() === 'POST'
			);
			await noticePage.getByRole('button', { name: 'Import notice', exact: true }).click();
			const importResponse = await importPending;
			assert.equal(importResponse.status(), 200, await importResponse.text());
			/** @type {Notice} */
			const notice = await importResponse.json();
			noticeId = notice.id;
			await noticePage.locator('#notice-kind').selectOption('road_closure');
			await noticePage.locator('#notice-target').fill(baseline.graph_edges[0].id);
			await noticePage.getByLabel('Effective from · MVT', { exact: true }).fill('2026-10-10T15:00');
			await noticePage.getByLabel('Valid until · MVT', { exact: true }).fill('2026-10-10T16:00');
			await noticePage
				.locator('#review-notes')
				.fill(
					'Automated QA exercise mapping a verified graph target; assumption only, not an official notice.'
				);
			const reviewPending = noticePage.waitForResponse(
				(response) =>
					response.url().includes(`/notices/${encodeURIComponent(notice.id)}/review`) &&
					response.request().method() === 'POST'
			);
			await noticePage.getByRole('button', { name: 'Approve mapping', exact: true }).click();
			assert.equal((await reviewPending).status(), 200);
			let delayed = false;
			await noticePage.route('**/api/backend/planning/baseline**', async (route) => {
				// Only delay actual delivery; do not fabricate or replace source responses.
				if (!delayed) {
					delayed = true;
					await new Promise((resolve) => setTimeout(resolve, 750));
				}
				await route.continue();
			});
			await noticePage.getByRole('button', { name: 'Use in proposal', exact: true }).click();
			await expect(
				noticePage.getByText(`Reviewed notice ${notice.id}`, { exact: false })
			).toBeVisible();
			const saved = await savedOption(noticePage);
			assert.equal(
				saved.operations.filter((operation) => operation.metadata?.notice_id === notice.id).length,
				1
			);
			assert.equal(saved.operations.length, 4);
			await noticePage.reload();
			await expect(
				noticePage.getByText(`Reviewed notice ${notice.id}`, { exact: false })
			).toBeVisible();
			await noticePage.goto(`${baseURL}/?view=live&context=conditions&island=island%3A1443`);
			await noticePage.getByRole('tab', { name: /Public notices/ }).click();
			await noticePage
				.getByRole('button', { name: /QA exercise: reviewed closure mapping/ })
				.click();
			await noticePage.getByRole('button', { name: 'Use in proposal', exact: true }).click();
			await expect(
				noticePage.getByText(`Reviewed notice ${notice.id}`, { exact: false })
			).toBeVisible();
			const repeated = await savedOption(noticePage);
			assert.equal(
				repeated.operations.filter((operation) => operation.metadata?.notice_id === notice.id)
					.length,
				1
			);
			assert.equal(repeated.operations.length, 4);
			await noticePage.locator('#policy-departure').fill('16:00');
			const result = await evaluate(noticePage);
			assert.ok(result.warnings.some((warning) => warning.includes('outside its validity window')));
			await noticePage.screenshot({
				path: path.join(output, 'reviewed-notice.png'),
				fullPage: true
			});
			await noticePage.close();
			return {
				noticeId: notice.id,
				delayedFirstBaseline: delayed,
				persistedOnce: true,
				repeatedHandoffDeduplicated: true
			};
		}
	);

	await check('Desktop and mobile planning remain contained', async () => {
		await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
		await page.setViewportSize({ width: 375, height: 812 });
		await page.getByRole('tab', { name: '1 · Design proposal', exact: true }).click();
		await page.locator('#policy-operation').selectOption('add_service');
		await assertPolicyTabsFit(page);
		const dimensions = await page.evaluate(() => ({
			width: innerWidth,
			scroll: document.documentElement.scrollWidth
		}));
		assert.ok(dimensions.scroll <= dimensions.width + 2, JSON.stringify(dimensions));
		await page.screenshot({ path: path.join(output, 'mobile-service.png'), fullPage: true });
		assert.deepEqual(report.errors, []);
		return dimensions;
	});
} catch (error) {
	report.failure = error instanceof Error ? error.message : String(error);
	await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
	process.exitCode = 1;
} finally {
	if (noticeId) {
		try {
			const response = await context.request.post(
				`${baseURL}/api/backend/operations/notices/${encodeURIComponent(noticeId)}/review`,
				{
					data: {
						decision: 'dismissed',
						notes:
							'Automated QA exercise completed; dismissed to avoid a current operational interpretation.'
					}
				}
			);
			/** @type {Notice} */
			const notice = await response.json();
			report.noticeCleanup = { noticeId, status: notice.status, httpStatus: response.status() };
			assert.equal(response.status(), 200);
			assert.equal(notice.status, 'dismissed');
		} catch (error) {
			report.errors.push(
				`QA notice dismissal failed: ${error instanceof Error ? error.message : String(error)}`
			);
			process.exitCode = 1;
		}
	}
	report.finishedAt = new Date().toISOString();
	await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
	console.log(JSON.stringify(report, null, 2));
	await browser.close();
}
