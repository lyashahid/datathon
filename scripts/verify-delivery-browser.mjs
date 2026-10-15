import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

/** @typedef {{name:string,status:string,detail?:unknown,message?:string}} Check */
/** @typedef {{calibration_selection:Record<string,string>,energy_overrides:Record<string,number>,calibration_records:unknown[],fleet_resources:unknown[]}} DeliveryAssumptions */
/** @typedef {{assumptions:DeliveryAssumptions,operations:{type:string}[]}} Option */
/** @typedef {{status:string,checks:{key:string,status:string}[]}} ResourceAudit */
/** @typedef {{activity_id:string,resource_audit:ResourceAudit}} RouteActivity */
/**
 * @typedef {object} Economics
 * @property {Record<string,number>} assumptions
 * @property {{receipts:unknown[]}} calibration
 * @property {{after:{routes:RouteActivity[]}}} fleets
 */
/** @typedef {{economics:Economics}} Evaluation */

const baseURL = process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5173';
const output = path.resolve('artifacts/qa/delivery');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 45000 });
/** @type {{baseURL:string,startedAt:string,finishedAt?:string,checks:Check[],errors:string[],failure?:string}} */
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], errors: [] };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1000 },
	reducedMotion: 'reduce',
	acceptDownloads: true
});
context.setDefaultTimeout(60000);
const page = await context.newPage();
page.on('pageerror', (error) => report.errors.push(error.message));

/** @param {string} name @param {()=>Promise<unknown>} work */
async function check(name, work) {
	console.log(`RUN ${name}`);
	try {
		const detail = await work();
		report.checks.push({ name, status: 'passed', detail });
		console.log(`PASS ${name}`);
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : String(cause);
		report.checks.push({ name, status: 'failed', message });
		throw cause;
	}
}

/** @param {string} endpoint */
function responseFor(endpoint) {
	return page.waitForResponse(
		(response) =>
			response.url().includes(`/planning/${endpoint}`) && response.request().method() === 'POST',
		{ timeout: 90000 }
	);
}

/** @returns {Promise<Evaluation>} */
async function evaluate() {
	await openDetails('Planning date, access goal and assumptions');
	const pending = responseFor('evaluate');
	await page.getByRole('button', { name: 'Evaluate proposal', exact: true }).click();
	const response = await pending;
	assert.equal(response.status(), 200, await response.text());
	return response.json();
}

/** @returns {Promise<Option>} */
async function saved() {
	return page.evaluate(() =>
		JSON.parse(localStorage.getItem('policy-workbench-v1:island:1443') || '{}')
	);
}

/** @param {string} title */
async function openDetails(title) {
	const summary = page.locator('summary').filter({ hasText: title });
	if (!(await summary.evaluate((element) => element.parentElement?.hasAttribute('open'))))
		await summary.click();
}

/** @param {number} width @param {string} name */
async function capture(width, name) {
	await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
	const overflow = await page.evaluate(() => ({
		viewport: innerWidth,
		document: document.documentElement.scrollWidth
	}));
	assert.ok(overflow.document <= overflow.viewport + 1, JSON.stringify(overflow));
	await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
	await page.getByRole('heading', { name: 'Can this proposal operate?' }).scrollIntoViewIfNeeded();
	await page.screenshot({ path: path.join(output, `${name}-viewport.png`) });
	if (width < 600) {
		await page.locator('.delivery-audit').first().scrollIntoViewIfNeeded();
		await page.screenshot({ path: path.join(output, `${name}-constraints.png`) });
	}
	return overflow;
}

try {
	await check(
		'Delivery sources load through the frontend proxy with explicit provenance',
		async () => {
			await page.goto(`${baseURL}/?view=map&tool=proposals&proposal=advanced&island=island%3A1443`);
			await page
				.locator('.policy-workflow')
				.getByRole('button', { name: 'Changes', exact: true })
				.click();
			await page
				.locator('.policy-workflow')
				.getByRole('button', { name: 'Budget & services', exact: true })
				.click();
			await expect(page.getByRole('heading', { name: 'Can this proposal operate?' })).toBeVisible();
			await page.locator('summary').filter({ hasText: 'Cost and energy evidence' }).click();
			await page.locator('summary').filter({ hasText: 'Official electricity references' }).click();
			await expect(page.getByText('Captured source has a SHA-256 receipt')).toBeVisible();
			await expect(
				page.getByText('Original download unavailable; indexed primary reference only')
			).toBeVisible();
			await expect(
				page.getByText('It is not applied as a current CO₂e factor.', { exact: false })
			).toBeVisible();
			await expect(
				page.getByText('Linked evidence is not independently certified.', { exact: false })
			).toBeVisible();
			return { capturedTariff: true, historicalReferenceQualification: true };
		}
	);

	await check('Progressive tariff delta, unknown fuel input, and stale-result guard', async () => {
		await page.locator('#tariff-existing').fill('90');
		await page.locator('#tariff-added').fill('20');
		let pending = responseFor('calibration/tariff');
		await page
			.getByRole('button', { name: 'Calculate extra electricity charge', exact: true })
			.click();
		assert.equal((await pending).status(), 200);
		await expect(page.getByText('Extra base charge: MVR 66.5', { exact: true })).toBeVisible();
		await expect(
			page.getByText('With fuel adjustment: Unknown until supplied', { exact: true })
		).toBeVisible();
		await page.locator('#tariff-fuel').fill('-0.12');
		await expect(page.getByText('Inputs changed. Calculate again.', { exact: true })).toBeVisible();
		pending = responseFor('calibration/tariff');
		await page
			.getByRole('button', { name: 'Calculate extra electricity charge', exact: true })
			.click();
		assert.equal((await pending).status(), 200);
		await expect(page.getByText('With fuel adjustment: MVR 64.1', { exact: true })).toBeVisible();
		return { baseCharge: 66.5, adjustedCharge: 64.1 };
	});

	await check(
		'Local evidence validated, selected, persisted, exported, and used in energy formulas',
		async () => {
			await page.locator('summary').filter({ hasText: 'Add a quotation or measurement' }).click();
			await page.locator('#cal-factor').selectOption('electricity_mvr_per_kwh');
			await page.locator('#cal-value').fill('3.3');
			await page.locator('#cal-title').fill('QA local electricity quotation');
			await page.locator('#cal-publisher').fill('QA operator');
			await page.locator('#cal-url').fill('https://example.com/qa-electricity');
			await page
				.locator('#cal-basis')
				.fill('QA user-supplied rate; excludes taxes and fuel adjustment.');
			const pending = responseFor('calibration/validate');
			await page.getByRole('button', { name: 'Add evidence record', exact: true }).click();
			assert.equal((await pending).status(), 200);
			await expect(
				page.getByText('1 evidence record validated. Select Apply to use a record.')
			).toBeVisible();
			await page.getByRole('button', { name: 'Apply', exact: true }).click();
			await expect(
				page.locator('.delivery-record').getByText('Selected', { exact: true })
			).toBeVisible();
			await page.getByRole('button', { name: 'Unapply', exact: true }).click();
			assert.equal(Object.keys((await saved()).assumptions.calibration_selection).length, 0);
			await expect(page.getByText('QA local electricity quotation', { exact: true })).toBeVisible();
			await page.getByRole('button', { name: 'Apply', exact: true }).click();
			await page.locator('summary').filter({ hasText: 'Energy calculation inputs' }).click();
			await page.locator('#energy-electric_kwh_per_km').fill('2');
			await page.locator('#energy-charging_efficiency').fill('0.8');
			await page.locator('#energy-grid_kg_co2e_per_kwh').fill('0.6');
			await page.locator('#energy-electric_non_energy_mvr_per_km').fill('10');
			const result = await evaluate();
			assert.equal(result.economics.assumptions.electric_operating_mvr_per_km, 18.25);
			assert.equal(result.economics.assumptions.electric_kg_co2e_per_km, 1.5);
			assert.equal(result.economics.calibration.receipts.length, 1);
			const draft = await saved();
			assert.equal(Object.keys(draft.assumptions.calibration_selection).length, 1);
			assert.equal(draft.assumptions.energy_overrides.electric_kwh_per_km, 2);
			await page
				.locator('.policy-workflow')
				.getByRole('button', { name: 'Budget & services', exact: true })
				.click();
			await openDetails('Cost and energy evidence');
			const downloadPending = page.waitForEvent('download');
			await page.getByRole('button', { name: 'Export register', exact: true }).click();
			const download = await downloadPending;
			const filename = path.join(output, 'evidence-register.json');
			await download.saveAs(filename);
			const register = JSON.parse(await readFile(filename, 'utf8'));
			assert.equal(register.records[0].value, 3.3);
			assert.equal(register.records[0].source_url, 'https://example.com/qa-electricity');
			return { receipts: 1, operatingMvrPerKm: 18.25, kgCo2ePerKm: 1.5 };
		}
	);

	await check(
		'Electric resource envelopes screen actual fleet, capacity, depots, and charging',
		async () => {
			await page
				.locator('.policy-workflow')
				.getByRole('button', { name: 'Changes', exact: true })
				.click();
			await openDetails('More changes: services and roads');
			await page
				.getByRole('button', { name: 'Plan a service or road change', exact: true })
				.click();
			await openDetails('Change what you are proposing');
			await page.locator('#policy-operation').selectOption('set_fleet');
			await page.locator('#policy-target-id').selectOption({ index: 1 });
			await page.locator('#policy-fleet').selectOption('electric');
			await page.getByRole('button', { name: 'Save this change', exact: true }).click();
			await evaluate();
			await page
				.locator('.policy-workflow')
				.getByRole('button', { name: 'Budget & services', exact: true })
				.click();
			await page
				.locator('summary')
				.filter({ hasText: 'Fleet capacity, depots and charging' })
				.click();
			const activities = await page.locator('#resource-activity option').evaluateAll((options) =>
				options.map((item) => ({
					value: item.getAttribute('value') || '',
					text: item.textContent || ''
				}))
			);
			const electric = activities.find((item) => item.value.endsWith('|electric'));
			assert.ok(electric, JSON.stringify(activities));
			await page.locator('#resource-activity').selectOption(electric.value);
			await check('Invalid fleet inputs stay out of the saved proposal', async () => {
				for (const [field, value, message] of [
					['#resource-vehicles', '-1', 'Available vehicles is outside'],
					['#resource-vehicles', '1.5', 'Available vehicles must be a whole number'],
					['#resource-capacity', '0', 'Onboard capacity is outside'],
					['#resource-efficiency', '101', 'Charging efficiency is outside']
				]) {
					await page.locator('#resource-vehicles').fill('1');
					await page.locator('#resource-capacity').fill('40');
					await page.locator('#resource-efficiency').fill('90');
					await page.locator(field).fill(value);
					await page.getByRole('button', { name: 'Save resource envelope', exact: true }).click();
					await expect(page.locator('.delivery-calibration').getByRole('alert')).toContainText(
						message
					);
					assert.equal((await saved()).assumptions.fleet_resources.length, 0);
				}
				await page.locator('#resource-efficiency').fill('90');
				return { invalidCases: 4, savedInvalidEnvelopes: 0 };
			});
			await page.locator('#resource-vehicles').fill('0');
			await page.locator('#resource-capacity').fill('40');
			await page.locator('#resource-demand').fill('100');
			await page.locator('#resource-duty').fill('1');
			await page.locator('#resource-battery').fill('10');
			await page.locator('#resource-energy').fill('2');
			await page.locator('#resource-chargers').fill('0');
			await page.locator('#resource-power').fill('50');
			await page.locator('#resource-hours').fill('8');
			await page.getByRole('button', { name: 'Save resource envelope', exact: true }).click();
			await expect(
				page.getByText('Resources saved in this proposal.', { exact: false })
			).toBeVisible();
			const result = await evaluate();
			const activity = result.economics.fleets.after.routes.find(
				(route) => route.activity_id === electric.value
			);
			assert.ok(activity);
			assert.equal(activity.resource_audit.status, 'constraints_failed');
			for (const key of [
				'available_fleet',
				'passenger_capacity',
				'battery_range',
				'overnight_energy'
			])
				assert.equal(
					activity.resource_audit.checks.find((item) => item.key === key)?.status,
					'failed',
					key
				);
			assert.equal(
				activity.resource_audit.checks.find((item) => item.key === 'depot_positioning')?.status,
				'unknown'
			);
			await page
				.locator('.policy-workflow')
				.getByRole('button', { name: 'Budget & services', exact: true })
				.click();
			await openDetails('Fleet capacity, depots and charging');
			await expect(
				page.locator('.delivery-audit').getByText('constraints failed', { exact: true })
			).toBeVisible();
			const draft = await saved();
			assert.equal(draft.assumptions.fleet_resources.length, 1);
			return activity.resource_audit;
		}
	);

	await check(
		'Desktop/mobile layout and browser-draft restoration preserve evidence and resources',
		async () => {
			const desktop = await capture(1440, 'delivery-desktop');
			const mobile = await capture(390, 'delivery-mobile');
			await page.reload();
			await page
				.locator('.policy-workflow')
				.getByRole('button', { name: 'Changes', exact: true })
				.click();
			await page
				.locator('.policy-workflow')
				.getByRole('button', { name: 'Budget & services', exact: true })
				.click();
			await page.locator('summary').filter({ hasText: 'Cost and energy evidence' }).click();
			await expect(page.getByText('QA local electricity quotation', { exact: true })).toBeVisible();
			await page
				.locator('summary')
				.filter({ hasText: 'Fleet capacity, depots and charging' })
				.click();
			await expect(
				page.getByText('0 vehicles · capacity 40 · peak 100', { exact: true })
			).toBeVisible();
			const draft = await saved();
			assert.equal(draft.assumptions.calibration_records.length, 1);
			assert.equal(draft.assumptions.fleet_resources.length, 1);
			await page
				.locator('.policy-workflow')
				.getByRole('button', { name: 'Changes', exact: true })
				.click();
			const downloadPending = page.waitForEvent('download');
			await openDetails('Advanced assumptions, saved files and source edits');
			await page.getByRole('button', { name: 'Export reproducible option', exact: true }).click();
			const download = await downloadPending;
			const filename = path.join(output, 'delivery-policy-option.json');
			await download.saveAs(filename);
			const exported = JSON.parse(await readFile(filename, 'utf8'));
			assert.deepEqual(
				exported.assumptions.calibration_records,
				draft.assumptions.calibration_records
			);
			assert.deepEqual(exported.assumptions.fleet_resources, draft.assumptions.fleet_resources);
			const importedContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
			const importedPage = await importedContext.newPage();
			await importedPage.goto(
				`${baseURL}/?view=map&tool=proposals&proposal=advanced&island=island%3A1443`
			);
			await importedPage
				.locator('.policy-workflow')
				.getByRole('button', { name: 'Changes', exact: true })
				.click();
			await importedPage
				.getByLabel('Import policy scenario file', { exact: true })
				.setInputFiles(filename);
			await expect
				.poll(() =>
					importedPage.evaluate(
						() =>
							JSON.parse(localStorage.getItem('policy-workbench-v1:island:1443') || '{}')
								.assumptions?.fleet_resources?.length ?? 0
					)
				)
				.toBe(1);
			await importedPage
				.locator('.policy-workflow')
				.getByRole('button', { name: 'Budget & services', exact: true })
				.click();
			await importedPage.locator('summary').filter({ hasText: 'Cost and energy evidence' }).click();
			await expect(
				importedPage.getByText('QA local electricity quotation', { exact: true })
			).toBeVisible();
			await importedPage
				.locator('summary')
				.filter({ hasText: 'Fleet capacity, depots and charging' })
				.click();
			await expect(
				importedPage.getByText('0 vehicles · capacity 40 · peak 100', { exact: true })
			).toBeVisible();
			await importedContext.close();
			assert.equal(report.errors.length, 0, report.errors.join('\n'));
			return { desktop, mobile, pageErrors: 0, fullOptionExportImport: true };
		}
	);
} catch (cause) {
	report.failure = cause instanceof Error ? cause.message : String(cause);
	process.exitCode = 1;
	await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
	console.error(report.failure);
} finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
	await browser.close();
}
