import { browserBaseURL } from './browser-config.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const baseURL = browserBaseURL();
const output = path.resolve('artifacts/qa/analytics-decisions');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 90000 });
/** @type {{baseURL:string,checks:Array<{name:string,status:string,detail?:unknown}>,pageErrors:string[],failure?:string}} */
const report = { baseURL, checks: [], pageErrors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
// Expire the API client's browser cache without waiting a minute or changing source responses.
await context.addInitScript(() => {
	const original = Date.now;
	Object.assign(window, { __analyticsQaClockOffset: 0 });
	Date.now = () => original() + Reflect.get(window, '__analyticsQaClockOffset');
});
const page = await context.newPage();
page.setDefaultTimeout(90000);
page.on('pageerror', (error) => report.pageErrors.push(error.message));
const dashboard = page.getByRole('region', { name: 'National analytics', exact: true });
const priorities = page.getByRole('region', { name: 'Policy priorities', exact: true });

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

async function noOverflow() {
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
		.toBe(true);
}

try {
	const response = await page.request.get(
		`${baseURL}/api/backend/planning/opportunities?include_geometry=false`
	);
	assert.equal(response.status(), 200);
	/** @type {{islands:Array<{island_id:string,name:string,atoll:string,category:string,domains:Record<string,{status:string,score:number|null,mapped_count:number}>}>}} */
	const source = await response.json();
	const byId = new Map(source.islands.map((island) => [island.island_id, island]));
	await page.goto(`${baseURL}/?view=overview`, { waitUntil: 'domcontentloaded' });
	await expect(dashboard).toHaveAttribute('aria-busy', 'false');
	await expect(priorities).toHaveAttribute('aria-busy', 'false');
	await check(
		'Three service decisions are source-backed and detailed controls stay optional',
		async () => {
			await expect(priorities.locator('[data-decision-priority]')).toHaveCount(3);
			await expect(priorities.locator('.service-comparison-disclosure')).not.toHaveAttribute(
				'open'
			);
			for (const domain of ['transport', 'health', 'education']) {
				const card = priorities.locator(`[data-decision-priority="${domain}"]`);
				const id = await card.getAttribute('data-priority-island');
				const kind = await card.getAttribute('data-evidence-kind');
				if (!id) {
					assert.equal(kind, 'no_flag');
					continue;
				}
				const island = byId.get(id);
				assert.ok(island);
				assert.equal(island.category, 'Residential Island');
				await expect(card).toContainText(island.name);
				if (kind === 'review') {
					assert.equal(island.domains[domain].status, 'review');
					assert.ok(island.domains[domain].mapped_count > 0);
					assert.ok(Number.isFinite(island.domains[domain].score));
					await expect(card).toContainText('not a confirmed service failure');
				} else await expect(card).toContainText('do not prove a service is missing');
			}
			await noOverflow();
			await page.screenshot({ path: path.join(output, 'analytics-decisions-desktop.png') });
			return { cards: 3, sourceIslands: source.islands.length };
		}
	);
	await check('Decision cards follow both atoll and residential filters', async () => {
		const target = byId.get('island:1442');
		assert.ok(target);
		await dashboard.getByLabel('Analytics atoll', { exact: true }).selectOption(target.atoll);
		for (const cohort of ['all', 'residential']) {
			await dashboard.getByLabel('Island cohort', { exact: true }).selectOption(cohort);
			for (const card of await priorities.locator('[data-priority-island]').all()) {
				const island = byId.get((await card.getAttribute('data-priority-island')) ?? '');
				assert.ok(island && island.atoll === target.atoll);
				if (cohort === 'residential') assert.equal(island.category, 'Residential Island');
			}
		}
		return { atoll: target.atoll };
	});
	await check(
		'Every decision carries its island and service lens to the map and keeps the return scope',
		async () => {
			for (const domain of ['transport', 'health', 'education']) {
				const card = priorities.locator(`[data-decision-priority="${domain}"]`);
				const islandId = await card.getAttribute('data-priority-island');
				if (!islandId) continue;
				const island = byId.get(islandId);
				assert.ok(island);
				await card
					.getByRole('button', { name: `Investigate ${island.name} ${domain} on map`, exact: true })
					.click();
				await expect(page).toHaveURL(
					(url) =>
						url.searchParams.get('view') === 'map' && url.searchParams.get('island') === islandId
				);
				await expect(
					page.locator('.policy-lens-bar').getByRole('button', {
						name:
							domain === 'transport' ? 'Transport' : domain === 'health' ? 'Health' : 'Education',
						exact: true
					})
				).toHaveAttribute('aria-pressed', 'true');
				await page
					.getByRole('navigation', { name: 'Workspace', exact: true })
					.getByRole('button', { name: 'Analytics', exact: true })
					.click();
				await expect(dashboard).toBeVisible();
				await expect(dashboard.getByLabel('Analytics atoll', { exact: true })).toHaveValue(
					island.atoll
				);
			}
			return { lenses: 3 };
		}
	);
	await check(
		'A service-only handoff clears the prior island and opens the selected atoll',
		async () => {
			const previousIslandId = new URL(page.url()).searchParams.get('island');
			const previousIsland = byId.get(previousIslandId ?? '');
			assert.ok(previousIsland, 'The preceding decision journey selected a real island');
			const target = source.islands.find(
				(island) =>
					island.category === 'Residential Island' &&
					island.atoll &&
					island.atoll !== previousIsland.atoll
			);
			assert.ok(target, 'A residential island in a different source atoll is available');
			await dashboard.getByLabel('Analytics atoll', { exact: true }).selectOption(target.atoll);
			const disclosure = priorities.locator('.service-comparison-disclosure');
			await disclosure.locator('> summary').click();
			const transportChoice = priorities.locator('.sector-transport button[aria-pressed]');
			if ((await transportChoice.getAttribute('aria-pressed')) !== 'true')
				await transportChoice.click();
			await priorities.getByRole('button', { name: 'Explore on map', exact: true }).click();
			await expect(page).toHaveURL(
				(url) =>
					url.searchParams.get('view') === 'map' &&
					!url.searchParams.has('island') &&
					url.searchParams.get('scope') === 'country' &&
					url.searchParams.get('atoll') === target.atoll &&
					url.searchParams.get('lens') === 'transport'
			);
			const atlas = page.locator('.national-map[data-active="true"]');
			await expect(atlas).toHaveAttribute('data-atoll-scope', target.atoll);
			await expect(atlas).toHaveAttribute('data-policy-lens', 'transport');
			await expect(atlas).toHaveAttribute('aria-busy', 'false');
			await page
				.getByRole('navigation', { name: 'Workspace', exact: true })
				.getByRole('button', { name: 'Analytics', exact: true })
				.click();
			await expect(dashboard.getByLabel('Analytics atoll', { exact: true })).toHaveValue(
				target.atoll
			);
			if ((await disclosure.getAttribute('open')) !== null)
				await disclosure.locator('> summary').click();
			return { previousIslandId, previousAtoll: previousIsland.atoll, atoll: target.atoll };
		}
	);
	await check(
		'Refreshing keeps real results visible and failures do not claim a successful load',
		async () => {
			const previous = await dashboard.locator('.inventory-metric strong').innerText();
			await page.evaluate(() => Reflect.set(window, '__analyticsQaClockOffset', 120000));
			/** @type {Array<()=>Promise<void>>} */
			const pending = [];
			await page.route(
				/\/api\/backend\/(accessibility\/summary|map\/features\?.*layer=infrastructure)/,
				async (route) => {
					await new Promise((resolve) =>
						pending.push(async () => {
							await route.abort('failed');
							resolve(undefined);
						})
					);
				}
			);
			await dashboard
				.getByRole('button', { name: 'Reload national analytics', exact: true })
				.click();
			await expect(dashboard).toHaveAttribute('aria-busy', 'true');
			await expect(dashboard.locator('.inventory-metric strong')).toHaveText(previous);
			await expect(dashboard.locator('.refresh-state')).toContainText('Updating analysis');
			await expect.poll(() => pending.length).toBe(2);
			await Promise.all(pending.map((release) => release()));
			await expect(dashboard).toHaveAttribute('aria-busy', 'false');
			await expect(dashboard.locator('.analysis-error')).toContainText(
				'previous results remain visible'
			);
			await expect(dashboard.locator('.inventory-metric strong')).toHaveText(previous);
			await expect(dashboard.locator('.refresh-state')).not.toContainText('Loaded');
			await page.unroute(
				/\/api\/backend\/(accessibility\/summary|map\/features\?.*layer=infrastructure)/
			);
			await dashboard.getByRole('button', { name: 'Retry analysis', exact: true }).click();
			await expect(dashboard).toHaveAttribute('aria-busy', 'false');
			await expect(dashboard.locator('.analysis-error')).toHaveCount(0);
			await expect(dashboard.locator('.refresh-state')).toContainText('Loaded');
			return { retainedInventory: previous, recovered: true };
		}
	);
	await check('Mobile decisions and optional comparison fit 390px and 320px', async () => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.evaluate(() => window.scrollTo(0, 0));
		await noOverflow();
		await page.screenshot({ path: path.join(output, 'analytics-decisions-mobile.png') });
		await priorities.locator('.service-comparison-disclosure > summary').click();
		await expect(priorities.locator('.sector-card')).toHaveCount(3);
		await noOverflow();
		await page.setViewportSize({ width: 320, height: 844 });
		await noOverflow();
		await priorities.locator('.service-comparison-disclosure > summary').focus();
		await page.keyboard.press('Enter');
		await expect(priorities.locator('.service-comparison-disclosure')).not.toHaveAttribute('open');
		return { viewports: [390, 320] };
	});
	await check('The decision journey has no browser runtime errors', async () => {
		assert.deepEqual(report.pageErrors, []);
		return { errors: report.pageErrors.length };
	});
} catch (error) {
	report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
	process.exitCode = 1;
	await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
	await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
	await browser.close();
	console.log(JSON.stringify(report, null, 2));
}
