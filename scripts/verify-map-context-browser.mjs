import { browserBaseURL } from './browser-config.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';

const baseURL = browserBaseURL();
const output = path.resolve('artifacts/qa/map-context');
await mkdir(output, { recursive: true });
/** @type {{baseURL:string,startedAt:string,finishedAt?:string,checks:Array<{name:string,status:string,detail?:unknown}>,errors:string[]}} */
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], errors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const desktop = await browser.newContext({
	viewport: { width: 1440, height: 1000 },
	reducedMotion: 'reduce'
});
const page = await desktop.newPage();
let contextRequests = 0;
page.on('request', (request) => {
	if (new URL(request.url()).pathname === '/api/backend/map/context') contextRequests += 1;
});
page.on('pageerror', (error) => report.errors.push(error.message));
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
/** @param {import('@playwright/test').Page} target @param {string} id */
async function openIsland(target, id) {
	await target.goto(`${baseURL}/?view=map&tool=explore&island=${encodeURIComponent(id)}`);
	await expect(target.locator('.national-map')).toBeVisible({ timeout: 60000 });
	await expect
		.poll(
			async () => Number(await target.locator('.national-map').getAttribute('data-rendered-roads')),
			{ timeout: 60000 }
		)
		.toBeGreaterThan(10);
	await expect(target.locator('.street-context-status')).toContainText('OSM street snapshot', {
		timeout: 60000
	});
}
/** @param {import('@playwright/test').Page} target */
async function contextProof(target) {
	return target.locator('.national-map').evaluate((element) => ({
		roads: Number(element.getAttribute('data-rendered-roads')),
		buildings: Number(element.getAttribute('data-rendered-buildings')),
		labels: [...element.querySelectorAll('.atlas-street-label')].map((x) => x.textContent),
		width: element.getBoundingClientRect().width,
		height: element.getBoundingClientRect().height
	}));
}

try {
	await check('National census coverage and source qualification', async () => {
		const summary = await (
			await page.request.get(`${baseURL}/api/backend/national/summary`)
		).json();
		assert.equal(summary.population_coverage.islands_with_census, 190);
		assert.equal(summary.population_coverage.reference_year, 2022);
		return summary.population_coverage;
	});
	await check(
		'Desktop Malé renders real roads, buildings, named streets and census count',
		async () => {
			await openIsland(page, 'island:1443');
			const proof = await contextProof(page);
			assert.ok(proof.roads > 100 && proof.buildings > 100);
			assert.ok(proof.labels.includes('Majeedhee Magu'));
			await expect(page.locator('.detail-panel')).toContainText('137,238');
			await expect(page.locator('.detail-panel')).toContainText('Residents · Census 2022');
			await page.screenshot({ path: path.join(output, 'male-desktop.png'), fullPage: true });
			return proof;
		}
	);
	await check('Street and building layer controls change rendered geometry', async () => {
		await page.getByRole('button', { name: 'Layers', exact: false }).click();
		const streets = page.getByRole('button', { name: 'Streets & paths', exact: false });
		await streets.click();
		await expect(streets).toHaveAttribute('aria-pressed', 'false');
		await expect.poll(async () => (await contextProof(page)).roads).toBe(0);
		await expect(page.locator('.atlas-street-label')).toHaveCount(0);
		await streets.click();
		await expect.poll(async () => (await contextProof(page)).roads).toBeGreaterThan(100);
		const buildings = page.getByRole('button', { name: 'Buildings & green spaces', exact: false });
		await buildings.click();
		await expect.poll(async () => (await contextProof(page)).buildings).toBe(0);
		await buildings.click();
		await expect.poll(async () => (await contextProof(page)).buildings).toBeGreaterThan(100);
		await page.getByRole('button', { name: 'Close map controls' }).click();
	});
	await check('Stationary map and repeated island focus reuse viewport context', async () => {
		await page.waitForTimeout(600);
		const settledRequests = contextRequests;
		await page.waitForTimeout(1500);
		assert.equal(contextRequests, settledRequests, 'A stationary map must not refetch street data');
		await page.getByRole('button', { name: 'View', exact: true }).click();
		await page
			.getByRole('region', { name: 'Map view', exact: true })
			.getByRole('button', { name: 'Focus selected island', exact: true })
			.click();
		await page.waitForTimeout(600);
		assert.equal(contextRequests, settledRequests, 'The unchanged island viewport must be reused');
		return { settledRequests, repeatedViewportRequests: contextRequests - settledRequests };
	});
	await check('Hulhumalé phase population and streets are available', async () => {
		await openIsland(page, 'island:1442');
		await expect(page.locator('.detail-panel')).toContainText('65,714');
		await page.screenshot({ path: path.join(output, 'hulhumale-desktop.png'), fullPage: true });
		return contextProof(page);
	});
	await check(
		'Outside Greater Malé, Hithadhoo has roads and correctly attributed residents',
		async () => {
			await openIsland(page, 'island:1152');
			await expect(page.locator('.detail-panel')).toContainText('13,759');
			const proof = await contextProof(page);
			assert.ok(proof.buildings > 100);
			await page.screenshot({ path: path.join(output, 'hithadhoo-desktop.png'), fullPage: true });
			return proof;
		}
	);
	await check(
		'Viewport endpoint returns retained source receipt and bounded geography',
		async () => {
			const response = await page.request.get(
				`${baseURL}/api/backend/map/context?bbox=73.05,-0.64,73.11,-0.55`
			);
			assert.ok(response.ok());
			const data = await response.json();
			assert.equal(
				data.metadata.source_sha256,
				'd4db22dc16c3ef027aa1a3245e4967cee59006f7e2ecebdfc482e5680f824604'
			);
			assert.ok(data.summary.roads > 100 && data.summary.buildings > 100);
			assert.equal(data.summary.truncated, false);
			assert.equal(
				(await page.request.get(`${baseURL}/api/backend/map/context?bbox=72,-1,75,8`)).status(),
				422
			);
			return { metadata: data.metadata, summary: data.summary };
		}
	);
	await check('A resort without island census evidence stays unknown, never zero', async () => {
		const islands = await (
			await page.request.get(`${baseURL}/api/backend/islands?limit=1000`)
		).json();
		const resort = islands.items.find(
			(/** @type {{properties:{category:string,id:string}}} */ item) =>
				item.properties.category === 'Tourism Island'
		);
		assert.ok(resort);
		const profile = await (
			await page.request.get(
				`${baseURL}/api/backend/islands/${encodeURIComponent(resort.properties.id)}/profile`
			)
		).json();
		assert.equal(profile.population.total, null);
		assert.equal(profile.population.status, 'unavailable');
		assert.ok(profile.accessibility.missing_data.includes('resident_population'));
		return { id: resort.properties.id, population: profile.population };
	});
	await check(
		'390px mobile map retains streets, readable controls and no horizontal overflow',
		async () => {
			const mobile = await browser.newContext({
				viewport: { width: 390, height: 844 },
				reducedMotion: 'reduce'
			});
			const target = await mobile.newPage();
			target.on('pageerror', (error) => report.errors.push(error.message));
			await openIsland(target, 'island:1442');
			await expect(target.locator('.detail-panel')).toContainText('65,714');
			await expect
				.poll(async () => (await contextProof(target)).labels.length)
				.toBeGreaterThanOrEqual(2);
			const proof = await contextProof(target);
			await target.screenshot({ path: path.join(output, 'hulhumale-mobile.png'), fullPage: true });
			assert.ok(proof.height >= 300);
			assert.ok(proof.labels.length >= 2);
			assert.ok(await target.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
			await target.getByRole('button', { name: 'Layers', exact: false }).click();
			await expect(
				target.getByRole('button', { name: 'Streets & paths', exact: false })
			).toBeVisible();
			await target.screenshot({ path: path.join(output, 'layers-mobile.png'), fullPage: true });
			await mobile.close();
			return proof;
		}
	);
	assert.deepEqual(report.errors, []);
} finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
	await browser.close();
}
