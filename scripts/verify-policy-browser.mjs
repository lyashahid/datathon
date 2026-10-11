import { mkdir, writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { evaluatePolicyOptions } from '../src/lib/policy/decisions.ts';

// Authoring this harness does not execute browser actions. Run explicitly in conventional CI.
const modulePath = process.env.PLAYWRIGHT_MODULE
	? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href
	: 'playwright';
const { chromium } = await import(modulePath);
const base = process.env.POLICY_QA_URL ?? 'http://127.0.0.1:5180';
await mkdir('artifacts/qa', { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1000 },
	acceptDownloads: true
});
const page = await context.newPage();
/** @type {string[]} */
const errors = [];
page.on('pageerror', (/** @type {Error} */ error) => errors.push(error.message));
const nav = page.getByRole('navigation', { name: 'Main pages' });
const panel = page.getByTestId('policy-workspace');
const format = (/** @type {number} */ value) =>
	value.toLocaleString('en-GB', { maximumFractionDigits: 0 });
async function navigate(/** @type {string} */ name, /** @type {string} */ path) {
	await nav.getByRole('link', { name, exact: true }).click();
	await page.waitForURL(/** @param {URL} url */ (url) => url.pathname === path);
}
async function ready() {
	// Results are removed during recalculation, so stale figures cannot satisfy this gate.
	await panel
		.locator('.calculation-state[aria-busy="true"]')
		.waitFor({ state: 'hidden', timeout: 60000 });
	await panel.getByTestId('policy-results').waitFor({ state: 'visible', timeout: 60000 });
}
async function openForecasts() {
	await navigate('Data and Forecasts', '/forecasts');
	await page
		.getByRole('navigation', { name: 'Data workspace views' })
		.getByRole('button', { name: 'Forecasts', exact: true })
		.click();
	await page.waitForURL(
		/** @param {URL} url */ (url) =>
			url.pathname === '/forecasts' && url.searchParams.get('dataView') === 'forecasts'
	);
}
async function downloadComparison(/** @type {string} */ name) {
	const more = panel.locator('details.more');
	if (!(await more.getAttribute('open'))) await more.locator('summary').click();
	const pending = page.waitForEvent('download');
	await page.getByTestId('policy-download-brief').click();
	const saved = await pending;
	const path = `artifacts/qa/${name}.json`;
	await saved.saveAs(path);
	return JSON.parse(await readFile(path, 'utf8'));
}
try {
	await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
	await page
		.getByRole('region', { name: 'Interactive Greater Malé policy atlas' })
		.waitFor({ timeout: 60000 });
	assert.equal(
		await nav.getByRole('link', { name: 'Map', exact: true }).getAttribute('aria-current'),
		'page'
	);
	const canvas = await page.locator('.map-page .maplibregl-canvas').boundingBox();
	assert.ok(
		canvas && canvas.width > 900 && canvas.height > 500,
		'The opening desktop map must remain the primary surface'
	);
	await page.screenshot({ path: 'artifacts/qa/map-opening-desktop.png', fullPage: true });
	/** @type {import('../src/lib/planning/types.ts').PlanningBaseline} */
	const baseline = await (await page.request.get(`${base}/api/planning-baseline`)).json();
	await navigate('Decisions', '/decisions');
	await ready();
	assert.equal(
		await page.getByTestId('policy-map').count(),
		0,
		'Decisions should not duplicate the primary map as a card'
	);
	await page.getByTestId('policy-option-keep').click();
	const snapshot = await downloadComparison('comparison-current');
	const event = snapshot.assumptions.disruptions?.find(
		/** @param {{id:string}} row */ (row) => row.id === 'policy-assumed-critical-road-delay'
	);
	const expected = await evaluatePolicyOptions(baseline, {
		baseActions: snapshot.actions,
		assumptions: snapshot.assumptions,
		roadEdgeId: event?.edgeIds[0],
		delayMinutes: event?.delayMinutes ?? 0
	});
	const expectedKeep = expected.alternatives.find((row) => row.id === 'keep');
	assert.ok(expectedKeep);
	for (const key of /** @type {const} */ ([
		'population',
		'reachableResidents',
		'gainedResidents',
		'lostResidents',
		'unknownResidents',
		'failedResidents'
	]))
		assert.ok(
			Math.abs(snapshot.comparison[key] - expectedKeep.comparison[key]) < 1e-6,
			`${key} must match the selected inputs`
		);
	assert.ok(
		Math.abs(
			snapshot.comparison.reachableResidents +
				snapshot.comparison.failedResidents +
				snapshot.comparison.unknownResidents -
				snapshot.comparison.population
		) < 1e-6
	);
	const results = page.getByTestId('policy-results');
	assert.ok(
		(await results.innerText()).includes(format(expectedKeep.comparison.reachableResidents))
	);
	assert.match(await page.getByTestId('policy-scope').innerText(), /Malé.*Hulhumalé.*Vilimalé/);
	const coverage = panel.locator('details.conditions-details');
	await coverage.locator('summary').click();
	assert.match(await coverage.innerText(), /Hulhulé and harbour-dependent\s+islands are excluded/);
	await coverage.locator('summary').click();
	await page.getByTestId('policy-option-restore').click();
	const restored = await downloadComparison('comparison-restore');
	const expectedRestore = expected.alternatives.find((row) => row.id === 'restore');
	assert.ok(expectedRestore);
	assert.ok(
		Math.abs(
			restored.comparison.reachableResidents - expectedRestore.comparison.reachableResidents
		) < 1e-6
	);
	assert.equal(restored.comparison.annualAdditionalMvr, event ? null : 0);
	assert.ok(
		(await results.innerText()).includes(format(expectedRestore.comparison.reachableResidents))
	);
	if (expectedRestore.comparison.accessBounds) {
		const bounds = await page.getByTestId('policy-access-bounds').innerText();
		assert.ok(
			bounds.includes(
				format(expectedRestore.comparison.accessBounds[0] * expectedRestore.comparison.population)
			)
		);
		assert.ok(
			bounds.includes(
				format(expectedRestore.comparison.accessBounds[1] * expectedRestore.comparison.population)
			)
		);
	}
	await page.getByTestId('policy-option-coordinate').click();
	if (expected.alternatives.find((row) => row.id === 'coordinate')?.label === 'Retain bus timing')
		assert.match(
			await page.getByTestId('policy-option-coordinate').innerText(),
			/Retain bus timing/
		);
	await page.getByTestId('policy-target').selectOption('15');
	await page
		.getByTestId('policy-result-context')
		.filter({ hasText: '15-minute target' })
		.waitFor({ timeout: 60000 });
	await ready();
	/** @type {{value:string,text:string|null}[]} */
	const roadOptions = await page
		.getByTestId('policy-road')
		.locator('option')
		.evaluateAll(
			/** @param {HTMLOptionElement[]} options */ (options) =>
				options.map((option) => ({ value: option.value, text: option.textContent }))
		);
	const selectedRoad = roadOptions.find((row) =>
		baseline.network.edges.some((edge) => edge.id === row.value)
	);
	if (selectedRoad) {
		await page.getByTestId('policy-road').selectOption(selectedRoad.value);
		await page
			.getByTestId('policy-selected-road')
			.filter({ hasText: selectedRoad.text ?? '' })
			.waitFor({ timeout: 60000 });
		await ready();
		assert.ok(
			(await page.getByTestId('policy-selected-road').innerText()).includes(selectedRoad.text ?? '')
		);
		await panel.getByRole('button', { name: 'Locate road', exact: true }).click();
		await page.waitForURL(
			/** @param {URL} url */ (url) =>
				url.pathname === '/' && url.searchParams.get('road') === selectedRoad.value
		);
		await navigate('Decisions', '/decisions');
		assert.equal(await page.getByTestId('policy-road').inputValue(), selectedRoad.value);
		assert.equal(await page.getByTestId('policy-target').inputValue(), '15');
	}
	const date = await page.getByTestId('policy-date').inputValue();
	const departure = await page.getByTestId('policy-departure').inputValue();
	await page.getByTestId('policy-departure').fill('15:45');
	await page
		.getByTestId('policy-result-context')
		.filter({ hasText: '15:45 Maldives time' })
		.waitFor({ timeout: 60000 });
	await ready();
	const originOptions = await page
		.getByTestId('policy-area')
		.locator('option')
		.evaluateAll(
			/** @param {HTMLOptionElement[]} options */ (options) => options.map((option) => option.value)
		);
	assert.ok(originOptions.length);
	const origin = originOptions[Math.min(1, originOptions.length - 1)];
	await page.getByTestId('policy-area').selectOption(origin);
	await panel.getByRole('button', { name: 'Show area and journey on map', exact: true }).click();
	await page.waitForURL(
		/** @param {URL} url */ (url) =>
			url.pathname === '/' && url.searchParams.get('origin') === origin
	);
	await navigate('Decisions', '/decisions');
	assert.equal(await page.getByTestId('policy-area').inputValue(), origin);
	assert.equal(await page.getByTestId('policy-target').inputValue(), '15');
	assert.equal(await page.getByTestId('policy-date').inputValue(), date);
	assert.equal(await page.getByTestId('policy-departure').inputValue(), '15:45');
	await page.getByTestId('policy-option-restore').click();
	await page.getByTestId('policy-open-editor').click();
	await page.waitForURL(/** @param {URL} url */ (url) => url.pathname === '/');
	await navigate('Decisions', '/decisions');
	await ready();
	assert.equal(await page.getByTestId('policy-target').inputValue(), '15');
	assert.equal(await page.getByTestId('policy-option-keep').getAttribute('aria-pressed'), 'true');
	assert.ok((await page.getByTestId('policy-island-outcomes').locator('tbody tr').count()) > 0);
	await page.getByTestId('policy-evidence').locator('summary').click();
	await page.getByTestId('policy-evidence').getByText('Sources and dates', { exact: true }).click();
	assert.equal(await page.getByTestId('policy-source-row').count(), baseline.sources.length);
	assert.match(
		await page.getByTestId('policy-source-row').first().innerText(),
		/Source period:.*Collected:.*Validated:/s
	);
	await page.screenshot({ path: 'artifacts/qa/decisions-desktop.png', fullPage: true });
	await navigate('Data and Forecasts', '/forecasts');
	const sections = page.getByRole('navigation', { name: 'Data workspace views' });
	assert.equal(
		await sections
			.getByRole('button', { name: 'Explore data', exact: true })
			.getAttribute('aria-current'),
		'page'
	);
	const explorer = page.getByRole('region', { name: 'Explore analytical data' });
	await explorer.locator('.chart-grid .chart svg').first().waitFor({ timeout: 60000 });
	assert.equal(
		await explorer.locator('.chart-grid > .chart-panel').count(),
		6,
		'The default data overview should show six curated charts'
	);
	assert.equal(
		await page.getByTestId('plan-ahead-panel').count(),
		0,
		'Forecasts must not displace the default data view'
	);
	const firstChart = explorer.locator('.chart-panel').first();
	const dataTitle = await firstChart.getByRole('heading', { level: 3 }).innerText();
	assert.match(await firstChart.locator('.evidence-badge').innerText(), /Published observations/);
	assert.match(await firstChart.locator('.chart-period').innerText(), /Reference period:/);
	await firstChart.getByRole('button', { name: 'Inspect data', exact: true }).click();
	const datasetDetail = explorer.getByRole('article', {
		name: `Dataset details: ${dataTitle}`,
		exact: true
	});
	assert.equal(await datasetDetail.getByRole('heading', { level: 3 }).innerText(), dataTitle);
	await datasetDetail.locator('.records-detail > summary').click();
	/** @type {import('../src/lib/prediction/types.ts').ForecastBundle} */
	const recordedData = await (await page.request.get(`${base}/api/prediction`)).json();
	const firstSeries = recordedData.monthly[0];
	assert.equal(dataTitle, firstSeries.name);
	const actualRows = await datasetDetail.locator('.records-detail tbody tr').allTextContents();
	assert.equal(actualRows.length, Math.min(20, firstSeries.history.length));
	for (const [index, row] of firstSeries.history.slice(0, 20).entries())
		assert.ok(
			actualRows[index].includes(format(row.value)),
			'Explorer values must match the retained published history'
		);
	await datasetDetail
		.getByRole('button', { name: 'Use in visualization builder', exact: true })
		.click();
	const builder = page.getByRole('region', { name: 'Visualization builder', exact: true });
	assert.equal(
		await builder.getByLabel('Start with a dataset', { exact: true }).inputValue(),
		`passenger-${firstSeries.seriesId}`,
		'Inspect-to-builder handover must preserve the selected dataset'
	);
	await builder
		.getByLabel('Start with a dataset', { exact: true })
		.selectOption('aviation-caa-11-13-international-passenger-arrivals');
	const comparisonChoices = await builder
		.getByLabel('Add a comparison', { exact: true })
		.locator('option')
		.evaluateAll(
			/** @param {HTMLOptionElement[]} options */ (options) => options.map((option) => option.value)
		);
	assert.ok(comparisonChoices.includes('aviation-caa-11-18-total-aircraft-movements'));
	assert.ok(
		comparisonChoices.every(
			/** @param {string} id */ (id) => !id.startsWith('population-') && !id.startsWith('policy-')
		),
		'Cross-grain or unrelated geographic data must not be offered as compatible joins'
	);
	await builder
		.getByLabel('Add a comparison', { exact: true })
		.selectOption('aviation-caa-11-18-total-aircraft-movements');
	assert.equal(
		await builder.getByLabel('Compare using', { exact: true }).inputValue(),
		'indexed',
		'Different units require relative-change comparison'
	);
	assert.equal(
		await builder
			.getByLabel('Compare using', { exact: true })
			.locator('option[value="values"]')
			.isDisabled(),
		true
	);
	assert.equal(
		await builder
			.getByLabel('Show as', { exact: true })
			.locator('option[value="heatmap"]')
			.isDisabled(),
		true,
		'A calendar heatmap must not silently mix two series'
	);
	assert.match(await builder.locator('.coverage-note').innerText(), /12 shared months/);
	await builder.locator('.exact-records > summary').click();
	assert.equal(
		await builder.locator('.exact-records tbody tr').first().locator('td.numeric').innerText(),
		'100'
	);
	await page.screenshot({ path: 'artifacts/qa/data-builder-desktop.png', fullPage: true });
	await openForecasts();
	await page.getByTestId('monthly-forecast-estimate').waitFor();
	const targetMonth = await page.getByLabel('Planning month', { exact: true }).inputValue();
	/** @type {import('../src/lib/prediction/types.ts').ForecastBundle} */
	const api = await (
		await page.request.get(`${base}/api/prediction?targetMonth=${targetMonth}`)
	).json();
	const seriesReports = [];
	for (const series of api.monthly) {
		await page.getByTestId(`forecast-series-${series.seriesId}`).click();
		if (series.estimate === null) continue;
		assert.equal(
			await page.getByTestId('monthly-forecast-estimate').innerText(),
			Math.round(series.estimate).toLocaleString('en-GB')
		);
		const history = page.getByTestId('forecast-history-table');
		if (!(await history.getAttribute('open'))) await history.locator('summary').click();
		assert.equal(
			await history.locator('tbody tr').count(),
			series.history.length + series.projections.length
		);
		const rows = await history.locator('tbody tr').allTextContents();
		for (const [index, row] of series.history.entries())
			assert.ok(rows[index].includes(Math.round(row.value).toLocaleString('en-GB')));
		for (const [index, row] of series.projections.entries())
			assert.ok(
				rows[series.history.length + index].includes(
					Math.round(row.estimate).toLocaleString('en-GB')
				)
			);
		await history.locator('summary').click();
		if (series.evaluation && series.evaluation.wape !== null && series.backtest.length) {
			const benchmarks = page.getByTestId('forecast-benchmarks');
			if (!(await benchmarks.getAttribute('open'))) await benchmarks.locator('summary').click();
			assert.equal(await benchmarks.locator('tbody tr').count(), series.benchmarks.length);
			await benchmarks.locator('summary').click();
			const backtest = page.getByTestId('forecast-backtest');
			if (!(await backtest.getAttribute('open'))) await backtest.locator('summary').click();
			assert.equal(await backtest.locator('tbody tr').count(), series.backtest.length);
			const mae =
				series.backtest.reduce((sum, row) => sum + Math.abs(row.actual - row.estimate), 0) /
				series.backtest.length;
			const wape =
				series.backtest.reduce((sum, row) => sum + Math.abs(row.actual - row.estimate), 0) /
				series.backtest.reduce((sum, row) => sum + row.actual, 0);
			assert.ok(Math.abs(mae - series.evaluation.mae) < 1e-8);
			assert.ok(Math.abs(wape - series.evaluation.wape) < 1e-10);
			assert.ok(series.backtest.every((row) => row.trainingCutoff < row.targetMonth));
			seriesReports.push({ id: series.seriesId, mae, wape, horizon: series.horizonMonths });
			await backtest.locator('summary').click();
		}
	}
	await page.getByTestId('forecast-quality-notes').locator('summary').click();
	assert.match(
		await page.getByTestId('forecast-quality-notes').innerText(),
		/June.*bus.*repeat May/s
	);
	await page.getByTestId('forecast-quality-notes').locator('summary').click();
	await page
		.getByTestId('plan-ahead-panel')
		.getByRole('button', { name: 'Show geography on map', exact: true })
		.click();
	await page.waitForURL(
		/** @param {URL} url */ (url) => url.pathname === '/' && !!url.searchParams.get('forecast')
	);
	await openForecasts();
	assert.equal(await page.getByLabel('Planning month', { exact: true }).inputValue(), targetMonth);
	await navigate('Decisions', '/decisions');
	await page.getByTestId('policy-tab-bus').click();
	await page.getByTestId('bus-receipt-dates').waitFor();
	assert.match(
		await page.getByTestId('bus-receipt-dates').innerText(),
		/collection times, not times measured by the vehicle/
	);
	assert.match(
		await page.getByTestId('bus-not-available').innerText(),
		/predictions are not available/
	);
	await navigate('Evidence', '/evidence');
	assert.ok(await page.locator('main[aria-label="Sources and evidence"]').isVisible());
	await page.setViewportSize({ width: 390, height: 844 });
	for (const [name, path] of [
		['Map', '/'],
		['Data and Forecasts', '/forecasts'],
		['Decisions', '/decisions'],
		['Evidence', '/evidence']
	]) {
		await navigate(name, path);
		if (name === 'Data and Forecasts')
			await sections.getByRole('button', { name: 'Explore data', exact: true }).click();
		const overflow = await page.evaluate(() => ({
			width: innerWidth,
			scroll: document.documentElement.scrollWidth
		}));
		assert.ok(
			overflow.scroll <= overflow.width,
			`${name} horizontal overflow: ${JSON.stringify(overflow)}`
		);
		await page.screenshot({
			path: `artifacts/qa/${name.toLowerCase().replaceAll(' ', '-')}-mobile.png`,
			fullPage: true
		});
		if (name === 'Data and Forecasts') {
			await sections.getByRole('button', { name: 'Forecasts', exact: true }).click();
			const forecastOverflow = await page.evaluate(() => ({
				width: innerWidth,
				scroll: document.documentElement.scrollWidth
			}));
			assert.ok(
				forecastOverflow.scroll <= forecastOverflow.width,
				`Forecasts horizontal overflow: ${JSON.stringify(forecastOverflow)}`
			);
			await page.screenshot({ path: 'artifacts/qa/forecasts-mobile.png', fullPage: true });
		}
	}
	assert.deepEqual(errors, []);
	await writeFile(
		'artifacts/qa/policy-browser-report.json',
		JSON.stringify(
			{
				passed: true,
				current: snapshot.comparison,
				restored: restored.comparison,
				seriesReports,
				dataExplorer: { title: dataTitle, checkedPublishedRows: actualRows.length },
				builder: {
					retainedDataset: firstSeries.seriesId,
					sharedMonths: 12,
					differentUnitsIndexed: true
				},
				initialDate: date,
				initialDeparture: departure,
				errors
			},
			null,
			2
		)
	);
	console.log(JSON.stringify({ passed: true, seriesReports, errors }));
} finally {
	await browser.close();
}
