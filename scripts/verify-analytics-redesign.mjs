import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Verify real data and user gestures against the built application; responses are never replaced.
const baseURL = process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5173';
const output = path.resolve('artifacts/qa/analytics-redesign');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 60000 });
/** @type {{baseURL:string,startedAt:string,finishedAt?:string,checks:Array<{name:string,status:string,detail?:unknown}>,pageErrors:string[],failure?:string}} */
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], pageErrors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1100 },
	reducedMotion: 'reduce',
	acceptDownloads: true
});
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.on('pageerror', (error) => report.pageErrors.push(error.message));
const dashboard = page.getByRole('region', { name: 'National analytics', exact: true });
const priorities = page.getByRole('region', { name: 'Policy priorities', exact: true });
const trend = page.getByRole('region', { name: 'Passenger movement trends', exact: true });

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
	}
}
async function noOverflow() {
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
		.toBe(true);
	return page.evaluate(() => ({
		viewport: innerWidth,
		document: document.documentElement.scrollWidth
	}));
}
async function openInventory() {
	const disclosure = dashboard.locator('details.inventory-disclosure');
	if ((await disclosure.count()) && (await disclosure.getAttribute('open')) === null)
		await disclosure.locator('summary').click();
	await expect(dashboard.getByLabel('Search analytics islands', { exact: true })).toBeVisible();
}
/** @param {string} name */
async function exportedRows(name) {
	await openInventory();
	const pending = page.waitForEvent('download');
	await dashboard.getByRole('button', { name: 'Export table', exact: true }).click();
	const downloaded = await pending;
	const destination = path.join(output, name);
	await downloaded.saveAs(destination);
	const contents = await readFile(destination, 'utf8');
	// The application exports every field quoted, escaping internal quotes by doubling them.
	return contents
		.trimEnd()
		.split(/\r?\n/)
		.map((line) =>
			[...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map((match) => match[1].replaceAll('""', '"'))
		);
}
/** @param {string} name */
async function resetScope(name = 'residential') {
	await dashboard.getByLabel('Island cohort', { exact: true }).selectOption(name);
	await dashboard.getByLabel('Analytics atoll', { exact: true }).selectOption('all');
	if (await dashboard.getByLabel('Search analytics islands', { exact: true }).isVisible()) {
		await dashboard.getByLabel('Search analytics islands', { exact: true }).fill('');
		await dashboard.getByLabel('Island screening filter', { exact: true }).selectOption('all');
	}
}

try {
	const responses = await Promise.all(
		['map/features?layer=islands', 'planning/opportunities', 'forecasts'].map((endpoint) =>
			page.request.get(`${baseURL}/api/backend/${endpoint}`)
		)
	);
	for (const response of responses) assert.equal(response.status(), 200, response.url());
	/** @type {{features:Array<{id?:string,properties:{id:string,name:string,atoll:string,category:string}}>}} */
	const islands = await responses[0].json();
	/** @type {{islands:Array<{island_id:string,name:string,atoll:string,category:string,planning_supported:boolean,domains:Record<string,{status:string}>}>}} */
	const opportunities = await responses[1].json();
	/** @type {{monthly:Array<{seriesId:string,name:string,lastActualMonth:string,history:Array<{month:string,value:number}>}>}} */
	const forecasts = await responses[2].json();
	const residentIslands = islands.features.filter(
		(island) => island.properties.category === 'Residential Island'
	);
	const target = opportunities.islands.find(
		(island) => island.island_id === 'island:1442' && island.planning_supported
	);
	assert.ok(target, 'A source-backed planning island is required for the map handoff');
	await page.goto(`${baseURL}/?view=overview`, { waitUntil: 'domcontentloaded' });
	await expect(dashboard).toHaveAttribute('aria-busy', 'false');
	await expect(priorities).toHaveAttribute('aria-busy', 'false');
	await expect(trend.getByTestId('passenger-trend-chart')).toBeVisible();

	await check(
		'Desktop dashboard exposes rich charts with actuals and fits the viewport',
		async () => {
			await expect(dashboard.locator('.footprint-card')).toBeVisible();
			await expect(dashboard.locator('.atoll-bar')).toHaveCount(8);
			await expect(priorities).toContainText('Need more data');
			const size = await noOverflow();
			await page.evaluate(() => window.scrollTo(0, 0));
			await page.screenshot({ path: path.join(output, 'after-desktop-top.png') });
			await page.screenshot({ path: path.join(output, 'after-desktop.png'), fullPage: true });
			return {
				...size,
				residentIslands: residentIslands.length,
				sourceSeries: forecasts.monthly.length
			};
		}
	);
	await check(
		'Series and period controls redraw the passenger chart from genuine historical counts',
		async () => {
			const series = trend.getByLabel('Passenger series', { exact: true });
			for (const forecast of forecasts.monthly) {
				await series.selectOption(forecast.seriesId);
				await expect(trend).toHaveAttribute('data-series', forecast.seriesId);
				await trend.getByRole('button', { name: 'All history', exact: true }).click();
				await expect(trend).toHaveAttribute('data-period', 'all');
				await expect(trend).toHaveAttribute('data-observations', String(forecast.history.length));
				await trend.getByRole('button', { name: '12 months', exact: true }).click();
				await expect(trend).toHaveAttribute('data-period', '12m');
				await expect(trend).toHaveAttribute(
					'data-observations',
					String(Math.min(12, forecast.history.length))
				);
				const inspection = trend.getByRole('slider', {
					name: 'Inspect passenger movements by month',
					exact: true
				});
				const observed = forecast.history.slice(-12);
				/** @param {number} value */
				const formatted = (value) => new Intl.NumberFormat('en-US').format(value);
				await inspection.focus();
				await inspection.press('Home');
				await expect(inspection).toHaveAttribute('aria-valuenow', '0');
				assert.ok(
					(await inspection.getAttribute('aria-valuetext'))?.includes(
						`${formatted(observed[0].value)} passenger movements`
					)
				);
				await inspection.press('End');
				await expect(inspection).toHaveAttribute('aria-valuenow', String(observed.length - 1));
				const latest = observed.at(-1);
				assert.ok(latest);
				assert.ok(
					(await inspection.getAttribute('aria-valuetext'))?.includes(
						`${formatted(latest.value)} passenger movements`
					)
				);
				await inspection.press('ArrowLeft');
				await expect(inspection).toHaveAttribute('aria-valuenow', String(observed.length - 2));
				const previous = observed.at(-2);
				assert.ok(previous);
				assert.ok(
					(await inspection.getAttribute('aria-valuetext'))?.includes(
						`${formatted(previous.value)} passenger movements`
					)
				);
			}
			return forecasts.monthly.map((item) => ({
				series: item.seriesId,
				actualMonths: item.history.length
			}));
		}
	);
	await check(
		'Forecast details opens the passenger workspace and returning keeps island filters',
		async () => {
			await dashboard.getByLabel('Island cohort', { exact: true }).selectOption('all');
			await dashboard.getByLabel('Analytics atoll', { exact: true }).selectOption(target.atoll);
			await trend.getByRole('button', { name: 'Forecast details', exact: true }).click();
			const workspace = page.getByRole('region', { name: 'Passenger forecasts', exact: true });
			await expect(workspace).toBeVisible();
			await expect(workspace.locator('.series-card')).toHaveCount(forecasts.monthly.length);
			for (const item of forecasts.monthly) {
				const card = workspace
					.locator('.series-card')
					.filter({ has: page.getByText(item.name, { exact: true }) });
				const actual = item.history.find((entry) => entry.month === item.lastActualMonth);
				assert.ok(actual, `${item.seriesId} has a published latest actual`);
				await expect(card.locator('b')).toHaveText(
					new Intl.NumberFormat('en-US').format(actual.value)
				);
				await expect(card).toContainText('Last actual');
			}
			await page
				.getByRole('tablist', { name: 'Analytics workspace', exact: true })
				.getByRole('tab', { name: 'National dashboard', exact: true })
				.click();
			await expect(dashboard).toBeVisible();
			await expect(dashboard.getByLabel('Island cohort', { exact: true })).toHaveValue('all');
			await expect(dashboard.getByLabel('Analytics atoll', { exact: true })).toHaveValue(
				target.atoll
			);
			await dashboard.getByRole('button', { name: 'Reset filters', exact: true }).click();
			return { retainedAtoll: target.atoll, retainedCohort: 'all' };
		}
	);
	await check(
		'Service chart toggles and atoll bars change the same coherent dashboard scope',
		async () => {
			const footprint = dashboard.locator('.footprint-card');
			const beforeBars = await footprint.locator('.bar-group').first().locator('.bar').count();
			await footprint.getByRole('button', { name: 'Health', exact: true }).click();
			await expect(footprint.getByRole('button', { name: 'Health', exact: true })).toHaveAttribute(
				'aria-pressed',
				'true'
			);
			await expect(footprint.locator('.bar-group').first().locator('.bar')).toHaveCount(1);
			await footprint.getByRole('button', { name: 'All services', exact: true }).click();
			await expect(footprint.locator('.bar-group').first().locator('.bar')).toHaveCount(beforeBars);
			await footprint.locator('.atoll-bar').first().click();
			await expect(dashboard.getByLabel('Analytics atoll', { exact: true })).not.toHaveValue('all');
			const selected = await dashboard.getByLabel('Analytics atoll', { exact: true }).inputValue();
			await dashboard.getByRole('button', { name: 'Reset filters', exact: true }).click();
			await expect(dashboard.getByLabel('Analytics atoll', { exact: true })).toHaveValue('all');
			await expect(dashboard.getByLabel('Island cohort', { exact: true })).toHaveValue(
				'residential'
			);
			return { atollSelectedFromChart: selected, servicesShown: beforeBars };
		}
	);
	await check(
		'Cohort, atoll and category filters agree with the complete downloadable island records',
		async () => {
			await openInventory();
			await resetScope();
			const residential = await exportedRows('residential-islands.csv');
			assert.equal(residential.length - 1, residentIslands.length);
			assert.ok(residential.slice(1).every((row) => row[3] === 'Residential Island'));
			await resetScope('all');
			const national = await exportedRows('all-islands.csv');
			assert.equal(national.length - 1, islands.features.length);
			await dashboard.getByLabel('Analytics atoll', { exact: true }).selectOption(target.atoll);
			const atoll = await exportedRows('selected-atoll-islands.csv');
			assert.equal(
				atoll.length - 1,
				islands.features.filter((item) => item.properties.atoll === target.atoll).length
			);
			assert.ok(atoll.slice(1).every((row) => row[2] === target.atoll));
			await resetScope();
			const category = dashboard.locator('.category-row').first();
			assert.ok(await category.count(), 'A real facility category is available to filter');
			await category.click();
			await expect(category).toHaveAttribute('aria-pressed', 'true');
			await expect(
				dashboard.getByLabel('Island screening filter', { exact: true })
			).not.toHaveValue('all');
			const categoryValue = await dashboard
				.getByLabel('Island screening filter', { exact: true })
				.inputValue();
			await dashboard.getByLabel('Island screening filter', { exact: true }).selectOption('all');
			await dashboard
				.getByLabel('Search analytics islands', { exact: true })
				.fill('no-island-matches-redesign-qa');
			await expect(dashboard.locator('.table-empty')).toContainText('No islands match');
			await expect(
				dashboard.getByRole('button', { name: 'Export table', exact: true })
			).toBeDisabled();
			await dashboard.getByLabel('Search analytics islands', { exact: true }).fill('');
			return {
				residentialRows: residential.length - 1,
				nationalRows: national.length - 1,
				atollRows: atoll.length - 1,
				selectedCategory: categoryValue
			};
		}
	);
	await check(
		'Evidence disclosure and policy selection keep explanations and map handoff connected',
		async () => {
			const services = priorities.locator('.service-comparison-disclosure');
			if ((await services.getAttribute('open')) === null)
				await services.locator('summary').first().click();
			await dashboard
				.getByRole('button', { name: 'Explain analytics methodology', exact: true })
				.click();
			await expect(
				dashboard.getByRole('heading', {
					name: 'Read these numbers with their sources.',
					exact: true
				})
			).toBeVisible();
			await dashboard
				.locator('#analytics-methodology')
				.getByRole('button', { name: 'Close', exact: true })
				.click();
			const domain =
				['transport', 'health', 'education'].find(
					(name) => target.domains[name].status === 'review'
				) ?? 'transport';
			await priorities.locator(`.sector-${domain} .sector-action[aria-pressed]`).click();
			const queue = target.domains[domain].status === 'review' ? 'Review access' : 'Need more data';
			await priorities.getByRole('button', { name: new RegExp(`^${queue}`) }).click();
			await priorities.getByLabel('Search priority islands', { exact: true }).fill(target.name);
			const targetRow = priorities.locator(`[data-policy-opportunity-id="${target.island_id}"]`);
			await expect(targetRow).toBeVisible();
			await targetRow
				.getByRole('button', { name: `Inspect ${target.name} service gaps on map`, exact: true })
				.click();
			await expect(page.locator('.national-map')).toBeVisible();
			await expect(page.locator('.national-map')).toHaveAttribute('aria-busy', 'false');
			await expect
				.poll(() => new URL(page.url()).searchParams.get('island'))
				.toBe(target.island_id);
			await expect(
				page.locator('.policy-lens-bar').getByRole('button', {
					name: domain === 'health' ? 'Health' : domain === 'education' ? 'Education' : 'Transport',
					exact: true
				})
			).toHaveAttribute('aria-pressed', 'true');
			return { island: target.island_id, lens: domain };
		}
	);
	await check(
		'Mobile dashboard and expanded evidence keep controls reachable without page overflow',
		async () => {
			await page.setViewportSize({ width: 390, height: 844 });
			await page.goto(`${baseURL}/?view=overview`, { waitUntil: 'domcontentloaded' });
			await expect(dashboard).toHaveAttribute('aria-busy', 'false');
			await expect(priorities).toHaveAttribute('aria-busy', 'false');
			await expect(trend.getByTestId('passenger-trend-chart')).toBeVisible();
			await noOverflow();
			await page.evaluate(() => window.scrollTo(0, 0));
			await page.screenshot({ path: path.join(output, 'after-mobile-top.png') });
			await page.screenshot({ path: path.join(output, 'after-mobile.png'), fullPage: true });
			await trend.getByRole('button', { name: 'All history', exact: true }).click();
			await expect(trend).toHaveAttribute('data-period', 'all');
			await openInventory();
			await noOverflow();
			await page.screenshot({
				path: path.join(output, 'after-mobile-evidence.png'),
				fullPage: true
			});
			return noOverflow();
		}
	);
	await check(
		'Narrow 320px layout contains charts and expanded evidence within the page',
		async () => {
			await page.setViewportSize({ width: 320, height: 844 });
			const size = await noOverflow();
			await expect(trend.getByTestId('passenger-trend-chart')).toBeVisible();
			await expect(dashboard.getByLabel('Search analytics islands', { exact: true })).toBeVisible();
			await page.evaluate(() => window.scrollTo(0, 0));
			await page.screenshot({ path: path.join(output, 'after-mobile-320-top.png') });
			return size;
		}
	);
	await check('No browser runtime errors during dashboard interactions', async () => {
		assert.deepEqual(report.pageErrors, []);
		return { errors: report.pageErrors.length };
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
