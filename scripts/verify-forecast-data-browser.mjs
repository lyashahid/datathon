import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Real frontend/backend responses only. A fresh browser keeps saved-story checks isolated.
const baseURL = process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5173';
const output = path.resolve('artifacts/qa/forecast-data');
const expect = playwrightExpect.configure({ timeout: 30000 });
/** @type {{baseURL: string, startedAt: string, finishedAt?: string, checks: Array<{name: string, status: string, milliseconds?: number, detail?: unknown, message?: string}>, errors: string[], failure?: {message: string, stack?: string}}} */
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], errors: [] };
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1050 },
	reducedMotion: 'reduce',
	acceptDownloads: true
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
page.on('pageerror', (error) => report.errors.push(error.message));

/** @param {string} name @param {() => Promise<unknown>} work */
async function check(name, work) {
	const started = Date.now();
	console.log(`RUN ${name}`);
	try {
		const detail = await work();
		report.checks.push({ name, status: 'passed', milliseconds: Date.now() - started, detail });
		console.log(`PASS ${name}`);
	} catch (error) {
		report.checks.push({
			name,
			status: 'failed',
			message: error instanceof Error ? error.message : String(error)
		});
		throw error;
	}
}
/** @param {string} fragment @param {string} method */
function responseFor(fragment, method = 'POST') {
	return page.waitForResponse(
		(response) =>
			new URL(response.url()).pathname === `/api/backend/${fragment}` &&
			response.request().method() === method,
		{ timeout: 60000 }
	);
}
/** @param {import('@playwright/test').Locator} button @param {string} filename */
async function download(button, filename) {
	const pending = page.waitForEvent('download');
	await button.click();
	const result = await pending;
	const target = path.join(output, filename);
	await result.saveAs(target);
	return readFile(target, 'utf8');
}
/** @param {import('@playwright/test').Locator} svg */
async function assertReadableChart(svg) {
	await expect
		.poll(async () =>
			svg.evaluate((node) => {
				if (!(node instanceof SVGSVGElement)) return 0;
				const label = node.querySelector('text');
				if (!label) return 0;
				return (
					(parseFloat(getComputedStyle(label).fontSize) * node.getBoundingClientRect().width) /
					node.viewBox.baseVal.width
				);
			})
		)
		.toBeGreaterThanOrEqual(9);
}
const forecast = page.locator('.forecast-workspace');
const studio = page.locator('.data-studio');
async function openStoryEditor() {
	if (!(await studio.getByLabel('Story title').isVisible()))
		await studio.getByText('Save or share this chart', { exact: true }).click();
}
/** @typedef {{seriesId: string, mode: string, lastActualMonth: string, history: Array<{month: string, value: number}>, benchmarks: unknown[], backtest: Array<{targetMonth: string}>, selection: {lastTargetMonth: string, firstEvaluationTrainingCutoff: string}, model: string, horizonMonths: number}} MonthlyForecast */
/** @typedef {{monthly: MonthlyForecast[], target: {month: string}}} ForecastBundle */
/** @typedef {{created?: boolean, integrityVerified: boolean, scores: Array<{status: string}>, issue: {id: string, issuedAt: string, integritySha256: string}}} ForecastIssue */
/** @typedef {{items: Array<{group: string, series: string, value: number | null}>, datasets: unknown[], matched_rows: number, truncated: boolean, base_key: string, unit: string}} ChartResponse */
/** @typedef {{title: string, primary: {filters: unknown[]}, receipts: Array<{sha256: string}>}} StoryDefinition */
/** @type {ForecastBundle} */
let bundle;
/** @type {StoryDefinition} */
let definition;

try {
	await page.goto(`${baseURL}/?view=overview`, { waitUntil: 'domcontentloaded' });
	await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();
	await expect(page.getByText('Data connected', { exact: true })).toBeVisible();
	await check('Forecasts load real monthly histories and ten chronological policies', async () => {
		const pending = responseFor('forecasts', 'GET');
		await page.getByRole('tab', { name: 'Passenger outlook', exact: true }).click();
		const response = await pending;
		assert.equal(response.status(), 200);
		bundle = await response.json();
		assert.equal(bundle.monthly.length, 3);
		assert.equal(
			bundle.monthly.reduce((total, item) => total + item.history.length, 0),
			161
		);
		assert.equal(bundle.monthly.find((item) => item.mode === 'bus')?.lastActualMonth, '2026-05');
		for (const item of bundle.monthly) {
			assert.equal(item.benchmarks.length, 10);
			assert.equal(item.backtest.length, 6);
			assert.ok(item.selection.lastTargetMonth <= item.selection.firstEvaluationTrainingCutoff);
			const firstEvaluationTarget = item.backtest[0]?.targetMonth;
			assert.ok(firstEvaluationTarget);
			assert.ok(item.selection.lastTargetMonth < firstEvaluationTarget);
		}
		await expect(forecast.locator('.series-card')).toHaveCount(3);
		assert.equal(
			await forecast
				.locator('.metric-card strong')
				.first()
				.evaluate((node) => getComputedStyle(node).fontSize),
			'32px'
		);
		await page.screenshot({ path: path.join(output, 'forecast-desktop.png'), fullPage: true });
		return bundle.monthly.map((item) => ({
			id: item.seriesId,
			model: item.model,
			horizon: item.horizonMonths
		}));
	});
	await check(
		'Target edits require applying before freeze; model and backtest tables render',
		async () => {
			await forecast.getByLabel('Target month').fill('2026-11');
			if (bundle.target.month !== '2026-11')
				await expect(forecast.getByRole('button', { name: 'Freeze forecast' })).toBeDisabled();
			const pending = responseFor('forecasts', 'GET');
			await forecast.getByRole('button', { name: 'Update outlook' }).click();
			bundle = await (await pending).json();
			await expect(forecast.getByRole('button', { name: 'Freeze forecast' })).toBeEnabled();
			await forecast.getByRole('tab', { name: 'Backtests & models' }).click();
			await expect(forecast.locator('table').first().locator('tbody tr')).toHaveCount(10);
			await expect(forecast.locator('table').nth(1).locator('tbody tr')).toHaveCount(6);
			return { target: bundle.target.month, evaluatedModels: 10, heldOutOrigins: 6 };
		}
	);
	await check('Freeze, integrity verification, idempotent reissue and receipt export', async () => {
		const pending = responseFor('forecasts/issues');
		await forecast.getByRole('button', { name: 'Freeze forecast' }).click();
		/** @type {ForecastIssue} */
		const issued = await (await pending).json();
		assert.equal(issued.integrityVerified, true);
		assert.ok(issued.scores.every((score) => score.status === 'pending'));
		await expect(
			forecast.getByRole('heading', { name: 'Frozen forecasts', exact: true })
		).toBeVisible();
		const again = responseFor('forecasts/issues');
		await forecast.getByRole('button', { name: 'Freeze forecast' }).click();
		const recovered = await (await again).json();
		assert.equal(recovered.created, false);
		assert.equal(recovered.issue.id, issued.issue.id);
		assert.equal(recovered.issue.issuedAt, issued.issue.issuedAt);
		assert.equal(recovered.issue.integritySha256, issued.issue.integritySha256);
		const exported = JSON.parse(
			await download(
				forecast.getByRole('button', { name: 'Receipt', exact: true }).first(),
				'forecast-receipt.json'
			)
		);
		assert.equal(exported.integrityVerified, true);
		return { issueId: issued.issue.id, preservedTimestamp: issued.issue.issuedAt };
	});
	await check(
		'All-data analysis, horizon diagnostics and source contract reject invalid imports',
		async () => {
			const pending = responseFor('forecasts/analysis', 'GET');
			await forecast.getByRole('tab', { name: 'Data & method', exact: true }).click();
			const response = await pending;
			assert.equal(response.status(), 200);
			/** @type {{summary: {availableCollections: number, passengerObservations: number}, horizonDiagnostics: unknown[], collectionProfiles: {id: string, geographyCoverage?: {mappedIslands: number}}[]}} */
			const analysis = await response.json();
			assert.equal(analysis.summary.availableCollections, 38);
			assert.equal(analysis.summary.passengerObservations, 161);
			assert.equal(analysis.horizonDiagnostics.length, 36);
			assert.equal(
				analysis.collectionProfiles.find((item) => item.id === 'national-population')
					?.geographyCoverage?.mappedIslands,
				190
			);
			const panel = forecast.locator('.analysis-workspace');
			await expect(
				panel.getByRole('heading', { name: 'What can the data support?' })
			).toBeVisible();
			await panel
				.locator('summary')
				.filter({ hasText: 'Inspect all collections and their grain' })
				.click();
			await expect(
				panel
					.locator('details')
					.filter({
						has: page.getByText('Inspect all collections and their grain', { exact: true })
					})
					.locator('tbody tr')
			).toHaveCount(38);
			await panel
				.locator('summary')
				.filter({ hasText: 'Model, baseline skill and range coverage for every horizon' })
				.click();
			await expect(
				panel
					.locator('details')
					.filter({
						has: page.getByText('Model, baseline skill and range coverage for every horizon', {
							exact: true
						})
					})
					.locator('tbody tr')
			).toHaveCount(12);
			const contract = JSON.parse(
				await download(
					panel.getByRole('button', { name: 'Source contract', exact: true }),
					'passenger-source-contract.json'
				)
			);
			assert.equal(contract.series.length, 3);
			await panel.getByLabel('Passenger source JSON', { exact: true }).setInputFiles({
				name: 'invalid-source.json',
				mimeType: 'application/json',
				buffer: Buffer.from('{}')
			});
			const rejected = responseFor('forecasts/sources/stage');
			await panel.getByRole('button', { name: 'Validate and stage', exact: true }).click();
			assert.equal((await rejected).status(), 422);
			await expect(panel.getByRole('alert')).toContainText('1–20 monthly series');
			await expect(
				panel.getByRole('button', { name: 'Accept reviewed source version' })
			).toHaveCount(0);
			await page.screenshot({ path: path.join(output, 'analysis-desktop.png'), fullPage: true });
			return {
				collections: 38,
				horizonDiagnostics: 36,
				invalidImportRejected: true,
				sourceActivation: false
			};
		}
	);
	await check('Catalogue, full-source aggregation and chart exports', async () => {
		const catalogue = responseFor('datasets', 'GET');
		const aggregate = responseFor('datasets/passenger-monthly/chart');
		await page.getByRole('tab', { name: 'Data studio', exact: true }).click();
		const sources = await (await catalogue).json();
		assert.equal(sources.total, 38);
		/** @type {ChartResponse} */
		const chart = await (await aggregate).json();
		assert.equal(chart.matched_rows, 161);
		assert.equal(chart.items.length, 161);
		assert.equal(chart.truncated, false);
		await openStoryEditor();
		await expect(studio.getByRole('button', { name: 'Save story', exact: true })).toBeEnabled();
		const csv = await download(
			studio.getByRole('button', { name: 'Chart CSV', exact: true }),
			'monthly-chart.csv'
		);
		assert.equal(csv.trim().split('\n').length, 162);
		const svg = await download(
			studio.getByRole('button', { name: 'Chart SVG', exact: true }),
			'monthly-chart.svg'
		);
		assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'));
		await page.screenshot({ path: path.join(output, 'studio-desktop.png'), fullPage: true });
		return {
			collections: sources.total,
			sourceRows: chart.matched_rows,
			chartRows: chart.items.length
		};
	});
	await check(
		'Filter edits cannot save stale chart definitions; bus-only scope uses actual data',
		async () => {
			await studio.locator('.filter-details summary').click();
			await studio.getByLabel('Filter column', { exact: true }).selectOption('mode');
			await studio.getByLabel('Filter operator', { exact: true }).selectOption('eq');
			await studio.getByLabel('Filter value', { exact: true }).fill('bus');
			await studio.getByRole('button', { name: 'Add filter', exact: true }).click();
			await expect(studio.getByRole('button', { name: 'Save story', exact: true })).toBeDisabled();
			await expect(
				studio.getByRole('button', { name: 'Export definition', exact: true })
			).toBeDisabled();
			const pending = responseFor('datasets/passenger-monthly/chart');
			await studio.getByRole('button', { name: 'Build chart', exact: true }).click();
			/** @type {ChartResponse} */
			const chart = await (await pending).json();
			assert.equal(chart.matched_rows, 53);
			assert.ok(chart.items.every((item) => item.series.includes('bus')));
			await expect(studio.getByRole('button', { name: 'Save story', exact: true })).toBeEnabled();
			return { sourceRows: chart.matched_rows, lastTrustedMonth: chart.items.at(-1)?.group };
		}
	);
	await check(
		'Explicit comparison grain, common-base index, paired scatter and source receipts',
		async () => {
			await studio.getByLabel('Compare another collection').selectOption('passenger-monthly');
			await studio.getByLabel('Comparison series', { exact: true }).selectOption('name');
			await studio
				.getByLabel('Filter source collection', { exact: true })
				.selectOption('comparison');
			await studio.getByLabel('Filter column', { exact: true }).selectOption('series_id');
			await studio.getByLabel('Filter value', { exact: true }).fill('ferry-male-vm');
			await studio.getByRole('button', { name: 'Add filter', exact: true }).click();
			const pending = responseFor('datasets/compare');
			await studio.getByRole('button', { name: 'Build chart', exact: true }).click();
			const response = await pending;
			assert.equal(response.status(), 200);
			/** @type {ChartResponse} */
			const chart = await response.json();
			assert.equal(chart.items.length, 106);
			assert.equal(chart.datasets.length, 2);
			assert.equal(chart.base_key, '2022-01');
			assert.equal(chart.unit, 'index (common base = 100)');
			assert.ok(
				chart.items
					.filter((item) => item.group === chart.base_key)
					.every((item) => item.value === 100)
			);
			await studio.getByLabel('Chart design').selectOption('scatter');
			await expect(studio.locator('.plot-wrap svg circle')).toHaveCount(53);
			await openStoryEditor();
			await studio.getByLabel('Story title').fill('Bus and VM endpoint movements');
			await studio
				.getByLabel('What did you observe?')
				.fill(
					'Separate aggregate source categories, indexed at their common first observed month. This does not measure unique residents or route demand.'
				);
			definition = JSON.parse(
				await download(
					studio.getByRole('button', { name: 'Export definition', exact: true }),
					'comparison-story.json'
				)
			);
			assert.equal(definition.receipts.length, 2);
			assert.ok(definition.receipts.every((receipt) => /^[a-f0-9]{64}$/.test(receipt.sha256)));
			await studio.getByRole('button', { name: 'Save story', exact: true }).click();
			return { pairs: 53, base: chart.base_key, receipts: definition.receipts.length };
		}
	);
	await check(
		'Saved-story tab imports valid definitions and rejects corrupt filters safely',
		async () => {
			await studio.getByRole('tab', { name: 'Saved stories', exact: false }).click();
			await expect(
				studio.getByRole('heading', { name: definition.title, exact: true })
			).toBeVisible();
			const corrupted = { ...definition, primary: { ...definition.primary, filters: [null] } };
			await studio.getByLabel('Import data story definition').setInputFiles({
				name: 'corrupt.json',
				mimeType: 'application/json',
				buffer: Buffer.from(JSON.stringify(corrupted))
			});
			await expect(studio.getByRole('alert')).toHaveText(
				'This is not a supported data story definition.'
			);
			const pending = responseFor('datasets/compare');
			await studio
				.getByLabel('Import data story definition')
				.setInputFiles(path.join(output, 'comparison-story.json'));
			assert.equal((await pending).status(), 200);
			await expect(studio.getByLabel('Story title')).toHaveValue(definition.title);
			await expect(studio.getByLabel('Chart design')).toHaveValue('scatter');
			return { title: definition.title, originalStoragePreserved: true };
		}
	);
	await check('Source records page, sorting and complete filtered CSV export', async () => {
		await studio.getByRole('tab', { name: 'Inspect records', exact: true }).click();
		await expect(studio.locator('tbody tr')).toHaveCount(12);
		const pending = responseFor('datasets/passenger-monthly/query');
		await studio.getByLabel('Sort dataset records', { exact: true }).selectOption('month');
		await studio
			.getByLabel('Dataset sort direction', { exact: true })
			.selectOption({ label: 'Descending' });
		await studio.getByRole('button', { name: 'Apply', exact: true }).click();
		const rows = await (await pending).json();
		assert.equal(rows.total, 53);
		assert.equal(rows.items[0].month, '2026-05');
		const csv = await download(
			studio.getByRole('button', { name: 'Export filtered CSV', exact: true }),
			'bus-all-filtered.csv'
		);
		assert.equal(csv.trim().split('\n').length, 54);
		return { pageRows: rows.items.length, completeExportRows: 53 };
	});
	await check('Mobile charts and controls fit the viewport', async () => {
		await page.setViewportSize({ width: 390, height: 844 });
		await studio.getByRole('tab', { name: 'Build a chart', exact: true }).click();
		await studio.locator('.chart-settings > summary').click();
		await expect(studio.getByRole('button', { name: 'Build chart', exact: true })).toBeVisible();
		await assertReadableChart(studio.locator('.plot-wrap svg'));
		assert.ok(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
		);
		await page.screenshot({ path: path.join(output, 'studio-mobile.png'), fullPage: true });
		await page.getByRole('tab', { name: 'Passenger outlook', exact: true }).click();
		await forecast.getByRole('tab', { name: 'Outlook & history', exact: true }).click();
		await assertReadableChart(forecast.locator('.forecast-plot svg'));
		assert.ok(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
		);
		await page.screenshot({ path: path.join(output, 'forecast-mobile.png'), fullPage: true });
		await forecast.getByRole('tab', { name: 'Data & method', exact: true }).click();
		await expect(forecast.getByRole('heading', { name: 'How far ahead is useful?' })).toBeVisible();
		assert.ok(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
		);
		const labels = await forecast
			.locator('.horizon-chart .horizon-column > span')
			.allTextContents();
		assert.equal(labels.length, 12);
		await page.screenshot({ path: path.join(output, 'analysis-mobile.png'), fullPage: true });
		return { width: 390, horizontalOverflow: false };
	});
	await check('No uncaught browser errors', async () => {
		assert.deepEqual(report.errors, []);
	});
} catch (error) {
	report.failure = {
		message: error instanceof Error ? error.message : String(error),
		stack: error instanceof Error ? error.stack : undefined
	};
	process.exitCode = 1;
	await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
	await browser.close();
	console.log(JSON.stringify(report, null, 2));
}
