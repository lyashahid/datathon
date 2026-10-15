import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Exercise the real API and the public island journey; no responses are replaced.
const baseURL = process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5173';
const output = path.resolve('artifacts/qa/island-accessibility');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 60000 });
const rawTechnicalTerms =
	/\b(?:no_[a-z_]+|resident_population|land_graph|domain_weights|osm_provisional_review_required)\b/;

/** @typedef {{domain:string,score:number,text:string}} AccessReason */
/** @typedef {{score:number,facility_count?:number,bus_stop_count?:number,airport_count?:number,marine_terminal_count?:number}} AccessComponent */
/** @typedef {{version:string,score:number,out_of:number,label:string,summary:string,reasons:AccessReason[],components:Record<string,AccessComponent>,coverage:{status:string,label:string,note:string,population_available:boolean,scored_domains:number,total_domains:number},limitations:string[]}} AccessAssessment */
/** @typedef {{island_id:string,score:number,assessment:AccessAssessment,population:{total:number|null},domains:Record<string,{score:number}>,missing_data:string[],confidence:number}} IslandScore */
/** @typedef {{scores:IslandScore[],summary:{island_count:number,average_score:number,zero_score_count:number}}} AccessSummary */
/** @typedef {{id:string,name:string,atoll:string,category:string}} Island */
/** @typedef {{island_id:string,name:string,atoll:string,category:string,population:number|null,domains:Record<string,{status:string,mapped_count:number}>}} OpportunityIsland */
/** @type {{baseURL:string,startedAt:string,finishedAt?:string,checks:Array<{name:string,status:string,detail?:unknown}>,pageErrors:string[],failure?:string}} */
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], pageErrors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1100 },
	reducedMotion: 'reduce'
});
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.on('pageerror', (error) => report.pageErrors.push(error.message));
const dashboard = page.getByRole('region', { name: 'National analytics', exact: true });
const priorities = page.getByRole('region', { name: 'Policy priorities', exact: true });

/** @param {string} name @param {()=>Promise<unknown>} action */
async function check(name, action) {
	console.log(`RUN ${name}`);
	try {
		const detail = await action();
		report.checks.push({ name, status: 'passed', detail });
		await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
		console.log(`PASS ${name}`);
	} catch (error) {
		report.checks.push({ name, status: 'failed', detail: String(error) });
		throw error;
	}
}

/** @param {number} value @param {string} label */
function validScore(value, label) {
	assert.equal(typeof value, 'number', `${label} is numeric`);
	assert.ok(Number.isFinite(value) && value >= 0 && value <= 100, `${label} is within 0–100`);
}

/** @param {IslandScore} item */
function validAssessment(item) {
	const assessment = item.assessment;
	assert.ok(assessment, `${item.island_id} has a policymaker assessment`);
	validScore(assessment.score, `${item.island_id} assessment score`);
	assert.equal(assessment.score, item.score, 'Friendly and technical scores agree');
	assert.equal(assessment.out_of, 100);
	assert.equal(assessment.version, 'island-access-assessment-v1');
	assert.ok(assessment.label.trim() && assessment.summary.trim());
	assert.equal(rawTechnicalTerms.test(assessment.summary), false, 'Summary uses plain language');
	assert.deepEqual(assessment.reasons.map((reason) => reason.domain).sort(), [
		'education',
		'health',
		'transport'
	]);
	for (const reason of assessment.reasons) {
		validScore(reason.score, `${item.island_id} ${reason.domain} score`);
		assert.equal(reason.score, item.domains[reason.domain].score);
		assert.equal(reason.score, assessment.components[reason.domain].score);
		assert.ok(reason.text.trim().length >= 20, `${reason.domain} has an explanatory sentence`);
		assert.equal(rawTechnicalTerms.test(reason.text), false, 'Reasons hide internal source codes');
	}
	for (const component of Object.values(assessment.components)) {
		for (const [key, value] of Object.entries(component)) {
			if (!key.endsWith('_count')) continue;
			assert.ok(Number.isInteger(value) && value >= 0, `${key} is a count`);
		}
	}
	assert.ok(['limited', 'partial', 'mapped'].includes(assessment.coverage.status));
	assert.ok(assessment.coverage.label.trim() && assessment.coverage.note.trim());
	assert.equal(assessment.coverage.population_available, item.population.total !== null);
	assert.equal(assessment.coverage.total_domains, 3);
	assert.ok(
		Number.isInteger(assessment.coverage.scored_domains) &&
			assessment.coverage.scored_domains >= 0 &&
			assessment.coverage.scored_domains <= 3
	);
	assert.ok(assessment.limitations.length, 'The score retains an honest coverage qualification');
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

async function openIslandScores() {
	const disclosure = dashboard.locator('details.inventory-disclosure');
	if ((await disclosure.getAttribute('open')) === null)
		await dashboard.getByRole('button', { name: 'View island scores', exact: true }).click();
	await expect(dashboard.getByLabel('Search analytics islands', { exact: true })).toBeVisible();
}

/** @param {Island} island */
async function openAssessment(island) {
	await openIslandScores();
	await dashboard.getByLabel('Search analytics islands', { exact: true }).fill(island.name);
	const row = dashboard.locator(`[data-analytics-island-id="${island.id}"]`);
	await expect(row).toBeVisible();
	await row.getByRole('button', { name: `Why this score for ${island.name}`, exact: true }).click();
	const dialog = page.getByRole('dialog', { name: `${island.name} accessibility`, exact: true });
	await expect(dialog).toBeVisible();
	await expect(dialog.getByTestId('island-accessibility-score')).toBeInViewport();
	await expect.poll(() => dialog.evaluate((element) => element.scrollTop)).toBe(0);
	return dialog;
}

try {
	const responses = await Promise.all(
		['accessibility/summary', 'planning/opportunities?include_geometry=false'].map((endpoint) =>
			page.request.get(`${baseURL}/api/backend/${endpoint}`, { timeout: 90000 })
		)
	);
	for (const response of responses) assert.equal(response.status(), 200, response.url());
	/** @type {AccessSummary} */
	const national = await responses[0].json();
	/** @type {{islands:OpportunityIsland[]}} */
	const opportunities = await responses[1].json();
	/** @type {Map<string, Island>} */
	const islands = new Map(
		opportunities.islands.map((island) => [
			island.island_id,
			{
				id: island.island_id,
				name: island.name,
				atoll: island.atoll,
				category: island.category
			}
		])
	);
	const knownScore = national.scores.find((item) => item.island_id === 'island:1442');
	const unknownScore = national.scores.find(
		(item) => item.population.total === null && islands.get(item.island_id)?.name
	);
	assert.ok(
		knownScore && unknownScore,
		'Both a populated island and a population gap are available'
	);
	const known = islands.get(knownScore.island_id);
	const unknown = islands.get(unknownScore.island_id);
	assert.ok(known && unknown);

	await check(
		'Every island returns a numeric accessibility score and three readable reasons',
		async () => {
			assert.equal(national.scores.length, islands.size);
			assert.equal(national.summary.island_count, islands.size);
			assert.equal(new Set(national.scores.map((item) => item.island_id)).size, islands.size);
			for (const item of national.scores) {
				assert.ok(islands.has(item.island_id));
				validAssessment(item);
			}
			const average =
				national.scores.reduce((sum, item) => sum + item.score, 0) / national.scores.length;
			assert.ok(Math.abs(national.summary.average_score - average) <= 0.0051);
			assert.equal(
				national.summary.zero_score_count,
				national.scores.filter((item) => item.score === 0).length
			);
			return {
				islands: islands.size,
				reasons: national.scores.length * 3,
				averageScore: national.summary.average_score
			};
		}
	);

	await check(
		'Individual scoring agrees with the national list and unknown residents stay unknown',
		async () => {
			const scored = await Promise.all(
				[knownScore, unknownScore].map(async (item) => {
					const response = await page.request.post(`${baseURL}/api/backend/accessibility/score`, {
						data: { island_id: item.island_id },
						timeout: 90000
					});
					assert.equal(response.status(), 200);
					/** @type {IslandScore} */
					const result = await response.json();
					validAssessment(result);
					assert.deepEqual(result.assessment, item.assessment);
					return result;
				})
			);
			assert.equal(scored[1].population.total, null);
			assert.equal(scored[1].assessment.coverage.population_available, false);
			return scored.map((item) => ({
				island: item.island_id,
				score: item.score,
				residents: item.population.total
			}));
		}
	);

	await page.goto(`${baseURL}/?view=overview`, { waitUntil: 'domcontentloaded' });
	await expect(dashboard).toHaveAttribute('aria-busy', 'false');
	await expect(priorities).toHaveAttribute('aria-busy', 'false');
	await check(
		'The main dashboard leads with actual numbers and keeps technical explanations optional',
		async () => {
			const residential = opportunities.islands.filter(
				(island) => island.category === 'Residential Island'
			);
			const reviews = residential.filter((island) =>
				Object.values(island.domains).some((domain) => domain.status === 'review')
			).length;
			const residents = residential.reduce((total, island) => total + (island.population ?? 0), 0);
			const mapped = residential.reduce(
				(total, island) =>
					total +
					Object.values(island.domains).reduce((sum, domain) => sum + domain.mapped_count, 0),
				0
			);
			const format = new Intl.NumberFormat('en-US');
			await expect(priorities.locator('.policy-summary strong')).toHaveText(
				[reviews, residents, mapped].map((value) => format.format(value))
			);
			for (const domain of ['transport', 'health', 'education']) {
				const count = residential.filter(
					(island) => island.domains[domain].status === 'review'
				).length;
				await expect(priorities.locator(`.sector-${domain} .sector-value strong`)).toHaveText(
					format.format(count)
				);
			}
			const residentIDs = new Set(
				[...islands.values()]
					.filter((island) => island.category === 'Residential Island')
					.map((island) => island.id)
			);
			const residentScores = national.scores.filter((item) => residentIDs.has(item.island_id));
			const average =
				residentScores.reduce((sum, item) => sum + item.score, 0) / residentScores.length;
			await expect(dashboard.locator('.access-metric strong')).toHaveText(
				new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(average)
			);
			await expect(priorities.locator('#policy-screening-evidence')).not.toBeVisible();
			assert.equal(rawTechnicalTerms.test(await dashboard.innerText()), false);
			await noOverflow();
			await page.screenshot({ path: path.join(output, 'overview-desktop.png'), fullPage: true });
			return {
				reviewIslands: reviews,
				recordedResidents: residents,
				mappedServices: mapped,
				averageScore: average
			};
		}
	);
	await check(
		'Accessibility details show the API score and reasons while technical data stays collapsed',
		async () => {
			await dashboard.getByLabel('Island cohort', { exact: true }).selectOption('all');
			await dashboard.getByLabel('Analytics atoll', { exact: true }).selectOption(known.atoll);
			const dialog = await openAssessment(known);
			const score = dialog.getByTestId('island-accessibility-score');
			await expect(score).toContainText(
				new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(knownScore.score)
			);
			await expect(score).toContainText('100');
			const reasons = dialog.getByTestId('island-accessibility-reasons');
			for (const reason of knownScore.assessment.reasons)
				await expect(reasons).toContainText(reason.text);
			await expect(dialog).toContainText(knownScore.assessment.coverage.label);
			const technical = dialog
				.locator('details')
				.filter({ has: page.getByText('Data details', { exact: true }) });
			await expect(technical).not.toHaveAttribute('open');
			const visible = await dialog.innerText();
			assert.equal(rawTechnicalTerms.test(visible), false);
			await page.screenshot({ path: path.join(output, 'island-score-desktop.png') });
			await technical.locator('summary').click();
			await expect(technical).toHaveAttribute('open');
			await expect(technical).toContainText(known.id);
			await technical.locator('summary').click();
			await dialog.getByRole('button', { name: 'Close', exact: true }).click();
			await expect(dialog).not.toBeVisible();
			await expect(dashboard.getByLabel('Island cohort', { exact: true })).toHaveValue('all');
			await expect(dashboard.getByLabel('Analytics atoll', { exact: true })).toHaveValue(
				known.atoll
			);
			await expect(dashboard.getByLabel('Search analytics islands', { exact: true })).toHaveValue(
				known.name
			);
			return { island: known.id, score: knownScore.score, retainedAtoll: known.atoll };
		}
	);

	await check(
		'An island with no census count shows Not available instead of zero residents',
		async () => {
			await dashboard.getByLabel('Analytics atoll', { exact: true }).selectOption('all');
			const dialog = await openAssessment(unknown);
			await expect(dialog).toContainText('Not available');
			assert.equal(/\b0 residents\b/i.test(await dialog.innerText()), false);
			await expect(dialog).toContainText(unknownScore.assessment.coverage.note);
			await dialog.getByRole('button', { name: 'Close', exact: true }).click();
			return { island: unknown.id, residents: unknownScore.population.total };
		}
	);

	await check(
		'The island details map action carries the selected island into Explore',
		async () => {
			const dialog = await openAssessment(known);
			await dialog
				.getByRole('button', { name: `Explore ${known.name} on map`, exact: true })
				.click();
			await expect(page).toHaveURL(
				(url) =>
					url.searchParams.get('view') === 'map' && url.searchParams.get('island') === known.id
			);
			await expect(page.locator('.maplibregl-canvas')).toBeVisible();
			return { island: known.id, url: page.url() };
		}
	);

	await check(
		'Narrow screens keep the dashboard and score reasons inside the viewport',
		async () => {
			await page.setViewportSize({ width: 390, height: 844 });
			await page.goto(`${baseURL}/?view=overview`, { waitUntil: 'domcontentloaded' });
			await expect(dashboard).toHaveAttribute('aria-busy', 'false');
			await expect(priorities).toHaveAttribute('aria-busy', 'false');
			await noOverflow();
			await dashboard.getByLabel('Island cohort', { exact: true }).selectOption('all');
			const dialog = await openAssessment(known);
			await expect(dialog.getByTestId('island-accessibility-score')).toBeVisible();
			await expect(dialog.getByTestId('island-accessibility-reasons')).toBeVisible();
			await noOverflow();
			const bounds = await dialog.boundingBox();
			assert.ok(bounds && bounds.x >= -1 && bounds.x + bounds.width <= 391);
			assert.ok(bounds.y >= -1 && bounds.y + bounds.height <= 845);
			await page.screenshot({ path: path.join(output, 'island-score-mobile.png') });
			await dialog.getByRole('button', { name: 'Close', exact: true }).click();
			await page.setViewportSize({ width: 320, height: 844 });
			return noOverflow();
		}
	);

	await check('The complete accessibility journey has no browser runtime errors', async () => {
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
