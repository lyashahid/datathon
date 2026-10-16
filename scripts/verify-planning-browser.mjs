import { browserBaseURL } from './browser-config.mjs';
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

const baseURL = browserBaseURL();
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
/** @param {import('@playwright/test').Page} surface @param {string} name */
async function openStep(surface, name) {
	await surface.locator('.policy-workflow').getByRole('button', { name, exact: true }).click();
	await expect(surface.locator('#policy-inspector')).toBeVisible();
}
/** @param {import('@playwright/test').Page} surface @param {string} title */
async function openDetails(surface, title) {
	const summary = surface.locator('#policy-inspector summary').filter({ hasText: title });
	if (!(await summary.evaluate((element) => element.parentElement?.hasAttribute('open'))))
		await summary.click();
}
/** @param {import('@playwright/test').Page} surface @param {'add_hospital'|'add_school'|'add_stop'|'add_service'} kind */
async function startChange(surface, kind) {
	await openStep(surface, 'Changes');
	if (kind === 'add_service') {
		await openDetails(surface, 'More changes: services and roads');
		await surface
			.getByRole('button', { name: 'Plan a service or road change', exact: true })
			.click();
	} else {
		const map = surface.getByRole('region', { name: 'Interactive proposal map', exact: true });
		await map
			.getByRole('button', {
				name: kind === 'add_hospital' ? 'Hospital' : kind === 'add_school' ? 'School' : 'Bus stop',
				exact: true
			})
			.click();
		await map.getByRole('button', { name: 'Use map center', exact: true }).click();
		await map.getByRole('button', { name: 'Name, opening date & details', exact: true }).click();
	}
}
/** @param {import('@playwright/test').Page} surface */
async function confirmPlace(surface) {
	await surface.getByRole('button', { name: 'Back to pin to confirm', exact: true }).click();
	await surface
		.getByRole('region', { name: 'Confirm proposed location', exact: true })
		.getByRole('button', { name: 'Confirm place', exact: true })
		.click();
	await openStep(surface, 'Changes');
}
/** @param {import('@playwright/test').Page} surface @returns {Promise<Evaluation>} */
async function evaluate(surface) {
	await openDetails(surface, 'Planning date, access goal and assumptions');
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
	const workflow = surface.locator('.policy-workflow');
	await expect(workflow).toBeVisible();
	assert.ok(
		await surface.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
		'Planning has no page overflow'
	);
	for (const button of await workflow.getByRole('button').all()) {
		await button.scrollIntoViewIfNeeded();
		const bounds = await button.boundingBox();
		assert.ok(
			bounds &&
				bounds.x >= -1 &&
				bounds.x + bounds.width <= (surface.viewportSize()?.width ?? 0) + 1,
			'Every workflow action is reachable within its scrolling toolbar'
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
		await page.goto(`${baseURL}/?view=scenarios&proposal=advanced&island=island%3A1443`);
		await openStep(page, 'Changes');
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
		await openStep(page, 'Journey');
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
		await openStep(page, 'Changes');
		await startChange(page, 'add_hospital');
		await page.locator('#policy-name').fill('QA proposed community hospital');
		await openDetails(page, 'Precise coordinates (optional)');
		await page.locator('#policy-lon').fill(String(baseline.origins[0].lon));
		await page.locator('#policy-lat').fill(String(baseline.origins[0].lat));
		await confirmPlace(page);
		const result = await evaluate(page);
		reconcile(result);
		assert.equal(result.economics.delta.capital_mvr, 120_000_000);
		assert.equal(result.economics.delta.annual_operating_mvr, 20_000_000);
		assert.equal(result.economics.delta.net_annual_kg_co2e, null);
		assert.equal(result.economics.delta.annual_fleet_operating_kg_co2e, 0);
		assert.equal(result.economics.delta.embodied_facility_kg_co2e, null);
		await captureStage(page, 'resident-access');
		await openStep(page, 'Changes');
		await page.getByRole('button', { name: 'Remove proposed change 1', exact: true }).click();
		return result.economics.delta;
	});

	await check('School uses explicit energy/construction carbon assumptions', async () => {
		await startChange(page, 'add_school');
		await openDetails(page, 'Planning date, access goal and assumptions');
		await page.locator('#policy-goal').selectOption('education');
		await page.locator('#policy-name').fill('QA proposed school');
		await openDetails(page, 'Facility emissions assumptions (optional)');
		await page.locator('#policy-facility-annual-carbon').fill('1250');
		await page.locator('#policy-facility-embodied-carbon').fill('12000');
		await confirmPlace(page);
		const result = await evaluate(page);
		assert.equal(result.economics.delta.capital_mvr, 25_000_000);
		assert.equal(result.economics.delta.annual_facility_operating_kg_co2e, 1250);
		assert.equal(result.economics.delta.embodied_facility_kg_co2e, 12000);
		return result.economics.delta;
	});

	await check(
		'Two-direction service form and stable stop references survive removing an earlier edit',
		async () => {
			await openStep(page, 'Changes');
			await startChange(page, 'add_stop');
			await page.locator('#policy-name').fill('QA stable boarding location');
			await confirmPlace(page);
			let option = await savedOption(page);
			const stopId = String(
				option.operations.find((operation) => operation.type === 'add_stop')?.metadata?.proposal_id
			);
			assert.ok(stopId.startsWith('proposal:add_stop:'));
			await startChange(page, 'add_service');
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
			await page.getByRole('button', { name: 'Save this change', exact: true }).click();
			await page.getByRole('button', { name: 'Remove proposed change 1', exact: true }).click();
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
			await openStep(page, 'Budget & services');
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
			await openStep(page, 'Changes');
			const pending = page.waitForEvent('download');
			await openDetails(page, 'Advanced assumptions, saved files and source edits');
			await page.getByRole('button', { name: 'Export reproducible option', exact: true }).click();
			const download = await pending;
			const filename = path.join(output, 'policy-scenario.json');
			await download.saveAs(filename);
			exported = JSON.parse(await readFile(filename, 'utf8'));
			assert.equal(exported?.operations.length, 3);
			await page.reload();
			await openStep(page, 'Changes');
			await expect(
				page.getByText('QA stable boarding location', { exact: true }).first()
			).toBeVisible();
			assert.deepEqual((await savedOption(page)).operations, exported?.operations);
			await page.getByRole('button', { name: 'Remove proposed change 3', exact: true }).click();
			await page.getByLabel('Import policy scenario file', { exact: true }).setInputFiles(filename);
			await expect(
				page.getByRole('button', { name: 'Remove proposed change 3', exact: true })
			).toBeVisible();
			assert.deepEqual((await savedOption(page)).operations, exported?.operations);
			await openDetails(page, 'Planning date, access goal and assumptions');
			await page.getByRole('button', { name: 'Plan across Greater Malé', exact: true }).click();
			await openStep(page, 'Changes');
			await openDetails(page, 'Planning date, access goal and assumptions');
			await expect(
				page.getByText('667 resident areas · 11 bus patterns', { exact: true })
			).toBeVisible();
			assert.equal(await page.locator('.policy-operation-row').count(), 0);
			await page.reload();
			await openStep(page, 'Changes');
			await expect(
				page.getByText('QA stable boarding location', { exact: true }).first()
			).toBeVisible();
			assert.deepEqual((await savedOption(page)).operations, exported?.operations);
			return { persistedOperations: exported?.operations.length, importedAgain: true };
		}
	);

	await check(
		'Reviewed notices refresh retained planning evidence without losing drafts',
		async () => {
			const advancedBefore = (await savedOption(page)).operations;
			await page
				.locator('.policy-workflow')
				.getByRole('button', { name: 'Back to Explore', exact: true })
				.click();
			async function openNotices() {
				await page.getByRole('button', { name: 'Weather & traffic', exact: true }).click();
				await page
					.getByRole('button', { name: 'Open notice evidence & disruption tools', exact: true })
					.click();
				await page.getByRole('tab', { name: /Public notices/ }).click();
			}
			async function mapDraft() {
				return page.evaluate(() =>
					JSON.parse(localStorage.getItem('policy-map-v2:island:1443') || '{}')
				);
			}
			await openNotices();
			await page.locator('#notice-url').fill('https://www.mtcc.mv/');
			await page.locator('#notice-title').fill('QA exercise: reviewed closure mapping');
			await page
				.locator('#notice-text')
				.fill(
					'QA exercise supplied by the tester: an assumed road closure for a planning test. This text is not an official current notice.'
				);
			const importPending = page.waitForResponse(
				(response) =>
					response.url().includes('/operations/notices/ingest') &&
					response.request().method() === 'POST'
			);
			await page.getByRole('button', { name: 'Import notice', exact: true }).click();
			const imported = await importPending;
			assert.equal(imported.status(), 200, await imported.text());
			/** @type {Notice} */
			const notice = await imported.json();
			noticeId = notice.id;
			await page.locator('#notice-kind').selectOption('road_closure');
			await page.locator('#notice-target').fill(baseline.graph_edges[0].id);
			await page.getByLabel('Effective from · MVT', { exact: true }).fill('2026-10-10T15:00');
			await page.getByLabel('Valid until · MVT', { exact: true }).fill('2026-10-10T16:00');
			await page
				.locator('#review-notes')
				.fill(
					'Automated QA exercise mapping a verified graph target; assumption only, not an official notice.'
				);
			const reviewPending = page.waitForResponse(
				(response) =>
					response.url().includes(`/notices/${encodeURIComponent(notice.id)}/review`) &&
					response.request().method() === 'POST'
			);
			await page.getByRole('button', { name: 'Approve mapping', exact: true }).click();
			assert.equal((await reviewPending).status(), 200);
			let delayed = false;
			await page.route('**/api/backend/planning/baseline**', async (route) => {
				if (!delayed) {
					delayed = true;
					await new Promise((resolve) => setTimeout(resolve, 750));
				}
				await route.continue();
			});
			await page.getByRole('button', { name: 'Use in proposal', exact: true }).click();
			const proposal = page.getByRole('region', { name: 'Island needs and proposal', exact: true });
			await expect(
				proposal.locator('.policy-operation-list').getByText('Close road', { exact: true })
			).toBeVisible();
			await expect
				.poll(
					async () =>
						((await mapDraft()).operations ?? []).filter(
							/** @param {Operation} operation */ (operation) =>
								operation.metadata?.notice_id === notice.id
						).length
				)
				.toBe(1);
			const firstMapDraft = await mapDraft();
			await page.getByRole('button', { name: 'Close island planning panel', exact: true }).click();
			await openNotices();
			await page.getByRole('button', { name: /QA exercise: reviewed closure mapping/ }).click();
			await page.getByRole('button', { name: 'Use in proposal', exact: true }).click();
			await expect(
				proposal.locator('.policy-operation-list').getByText('Close road', { exact: true })
			).toBeVisible();
			const repeated = await mapDraft();
			assert.equal(
				repeated.operations.filter(
					/** @param {Operation} operation */ (operation) =>
						operation.metadata?.notice_id === notice.id
				).length,
				1
			);
			assert.equal(repeated.operations.length, firstMapDraft.operations.length);
			const expired = await context.request.post(`${baseURL}/api/backend/planning/evaluate`, {
				data: {
					island_id: 'island:1443',
					operations: repeated.operations,
					assumptions: { ...repeated.assumptions, departure_minutes: 960 }
				}
			});
			assert.equal(expired.status(), 200, await expired.text());
			/** @type {Evaluation} */
			const expiredResult = await expired.json();
			assert.ok(
				expiredResult.warnings.some((warning) => warning.includes('outside its validity window'))
			);
			const countBefore = baselineRequests;
			await proposal
				.getByRole('button', { name: 'Advanced service & fleet tools', exact: true })
				.click();
			await openStep(page, 'Changes');
			await expect(page.locator('.policy-operation-row')).toHaveCount(advancedBefore.length);
			assert.deepEqual((await savedOption(page)).operations, advancedBefore);
			assert.ok(
				baselineRequests > countBefore,
				'Returning to retained service tools reloads changed source evidence'
			);
			await page.screenshot({
				path: path.join(output, 'reviewed-notice-preserved-advanced-draft.png'),
				fullPage: true
			});
			return {
				noticeId: notice.id,
				delayedFreshBaseline: delayed,
				repeatedHandoffDeduplicated: true,
				preservedAdvancedChanges: advancedBefore.length,
				freshAdvancedBaseline: true
			};
		}
	);

	await check('Desktop and mobile planning remain contained', async () => {
		await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
		await page.setViewportSize({ width: 375, height: 812 });
		await openStep(page, 'Changes');
		await startChange(page, 'add_service');
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
