import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Every successful payload is the real backend response. These checks delay delivery or
// simulate a failed connection to exercise races, without substituting analytical data.
const baseURL = process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5173';
const output = path.resolve('artifacts/qa/secondary-audit');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 45000 });
/** @type {{baseURL:string, checks:Array<{name:string,status:string,detail?:unknown}>,errors:string[]}} */
const report = { baseURL, checks: [], errors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1000 },
	reducedMotion: 'reduce',
	acceptDownloads: true
});
const page = await context.newPage();
page.setDefaultTimeout(45000);
page.on('pageerror', (error) => report.errors.push(error.message));
/** @param {string} name @param {()=>Promise<unknown>} work */
async function check(name, work) {
	console.log(`RUN ${name}`);
	try {
		report.checks.push({ name, status: 'passed', detail: await work() });
		console.log(`PASS ${name}`);
	} catch (cause) {
		report.checks.push({ name, status: 'failed', detail: String(cause) });
		throw cause;
	}
}
/** @param {string} pattern */
async function holdResponse(pattern) {
	/** @type {()=>void} */ let release;
	/** @type {()=>void} */ let notifyEntered;
	const gate = new Promise((resolve) => {
		release = () => resolve(undefined);
	});
	const entered = new Promise((resolve) => {
		notifyEntered = () => resolve(undefined);
	});
	await page.route(pattern, async (route) => {
		const response = await route.fetch();
		notifyEntered();
		await gate;
		await route.fulfill({ response });
	});
	return { entered, release: () => release(), clear: () => page.unroute(pattern) };
}
async function noOverflow() {
	const geometry = await page.evaluate(() => ({
		width: innerWidth,
		document: document.documentElement.scrollWidth
	}));
	assert.ok(geometry.document <= geometry.width + 1, JSON.stringify(geometry));
	return geometry;
}

try {
	await check('Frozen receipts distinguish a slow load from an empty collection', async () => {
		const held = await holdResponse('**/api/backend/forecasts/issues');
		await page.goto(`${baseURL}/?view=overview&analytics=passengers`, {
			waitUntil: 'domcontentloaded'
		});
		const forecast = page.locator('.forecast-workspace');
		await expect(forecast.locator('.series-card')).toHaveCount(3);
		await held.entered;
		await forecast.getByRole('tab', { name: /Frozen forecasts/ }).click();
		await expect(forecast.getByText('Loading frozen forecasts…', { exact: true })).toBeVisible();
		await expect(forecast.getByText('No frozen forecast yet', { exact: true })).not.toBeVisible();
		held.release();
		await expect(
			forecast.getByRole('button', { name: 'Refresh receipts', exact: true })
		).toBeEnabled();
		await held.clear();
		return { loadingIsDistinct: true };
	});
	await check('An older forecast response cannot overwrite a newer target edit', async () => {
		const forecast = page.locator('.forecast-workspace');
		await forecast.getByRole('tab', { name: 'Outlook & history', exact: true }).click();
		const held = await holdResponse('**/api/backend/forecasts?target_month=2026-11');
		await forecast.getByLabel('Target month').fill('2026-11');
		await forecast.getByRole('button', { name: 'Update outlook', exact: true }).click();
		await held.entered;
		await forecast.getByLabel('Target month').fill('2026-12');
		held.release();
		await expect(
			forecast.getByRole('button', { name: 'Update outlook', exact: true })
		).toBeEnabled();
		await expect(forecast.getByLabel('Target month')).toHaveValue('2026-12');
		await expect(
			forecast.getByRole('button', { name: 'Freeze forecast', exact: true })
		).toBeDisabled();
		await expect(forecast.locator('.source-caption')).toContainText('apply the new target');
		await held.clear();
		return { retainedTarget: '2026-12' };
	});
	await check('Receipt connection failures have their own recovery action', async () => {
		const forecast = page.locator('.forecast-workspace');
		await forecast.getByRole('tab', { name: /Frozen forecasts/ }).click();
		await page.route('**/api/backend/forecasts/issues', (route) => route.abort('failed'));
		await forecast.getByRole('button', { name: 'Refresh receipts', exact: true }).click();
		await expect(
			forecast.getByRole('button', { name: 'Retry receipts', exact: true })
		).toBeVisible();
		await expect(forecast.getByText('No frozen forecast yet', { exact: true })).not.toBeVisible();
		await page.unroute('**/api/backend/forecasts/issues');
		await forecast.getByRole('button', { name: 'Retry receipts', exact: true }).click();
		await expect(
			forecast.getByRole('button', { name: 'Refresh receipts', exact: true })
		).toBeEnabled();
		await expect(
			forecast.getByRole('button', { name: 'Retry receipts', exact: true })
		).not.toBeVisible();
		return { failureWasRecoverable: true };
	});
	await check(
		'Chart sharing stays folded until needed and all real chart rows export',
		async () => {
			await page.goto(`${baseURL}/?view=overview&analytics=data`, {
				waitUntil: 'domcontentloaded'
			});
			const studio = page.locator('.data-studio');
			await expect(studio.locator('.plot-wrap svg')).toBeVisible();
			await expect(studio.getByLabel('Story title')).not.toBeVisible();
			await expect(studio.getByText('Save or share this chart', { exact: true })).toBeVisible();
			await page.screenshot({ path: path.join(output, 'data-studio-desktop.png'), fullPage: true });
			await studio.getByText('Save or share this chart', { exact: true }).click();
			await expect(studio.getByLabel('Story title')).toBeVisible();
			await expect(studio.getByRole('button', { name: 'Save story', exact: true })).toBeEnabled();
			const pending = page.waitForEvent('download');
			await studio.getByRole('button', { name: 'Chart CSV', exact: true }).click();
			const download = await pending;
			await download.saveAs(path.join(output, 'real-chart.csv'));
			return {
				groups: await studio.locator('.chart-legend > span').count(),
				csv: download.suggestedFilename(),
				...(await noOverflow())
			};
		}
	);
	await check(
		'Mobile chart sharing uses the same compact disclosure without overflow',
		async () => {
			await page.setViewportSize({ width: 390, height: 844 });
			const studio = page.locator('.data-studio');
			await studio.getByText('Save or share this chart', { exact: true }).click();
			await expect(studio.getByLabel('Story title')).not.toBeVisible();
			await expect(studio.getByLabel('Group / horizontal axis', { exact: true })).not.toBeVisible();
			await studio.locator('.chart-settings > summary').click();
			await expect(studio.getByRole('button', { name: 'Build chart', exact: true })).toBeVisible();
			await studio.locator('.chart-settings > summary').click();
			await page.screenshot({ path: path.join(output, 'data-studio-mobile.png'), fullPage: true });
			return noOverflow();
		}
	);
	await check(
		'Weather defers notice/network/advisory reads until those controls are opened',
		async () => {
			await page.setViewportSize({ width: 1440, height: 1000 });
			/** @type {string[]} */ const requests = [];
			/** @param {import('@playwright/test').Request} request */ const capture = (request) =>
				requests.push(new URL(request.url()).pathname);
			page.on('request', capture);
			await page.goto(`${baseURL}/?view=map&tool=live&island=island%3A1442`, {
				waitUntil: 'domcontentloaded'
			});
			const operations = page.locator('.operations-workspace');
			await expect(
				operations.getByRole('button', { name: 'Update forecast', exact: true }).last()
			).toBeEnabled();
			await expect(operations.locator('.metrics')).not.toContainText('Loading');
			assert.equal(
				requests.filter((value) => value === '/api/backend/operations/notices').length,
				0
			);
			assert.equal(
				requests.filter((value) => value === '/api/backend/planning/baseline').length,
				0
			);
			assert.equal(
				requests.filter((value) => value === '/api/backend/operations/snapshot').length,
				0
			);
			const advisory = page.waitForResponse(
				(response) => new URL(response.url()).pathname === '/api/backend/operations/snapshot'
			);
			await operations.getByText('Preserved advisory records', { exact: true }).click();
			assert.equal((await advisory).status(), 200);
			await operations.getByRole('tab', { name: /Public notices/ }).click();
			await expect(
				operations.getByText('Loading notices and their mapped targets…', { exact: true })
			).not.toBeVisible();
			await expect
				.poll(() => requests.filter((value) => value === '/api/backend/operations/notices').length)
				.toBe(1);
			await expect
				.poll(() => requests.filter((value) => value === '/api/backend/planning/baseline').length)
				.toBe(1);
			page.off('request', capture);
			return { deferredOperations: ['notices', 'planning baseline', 'advisories'] };
		}
	);
	await check(
		'Place inspector closes with Escape and returns keyboard focus on mobile',
		async () => {
			await page.setViewportSize({ width: 390, height: 844 });
			await page.goto(`${baseURL}/?view=map&tool=places&island=island%3A1442`, {
				waitUntil: 'domcontentloaded'
			});
			const places = page.locator('.places-workspace');
			await expect(places.getByText('Vela connected', { exact: true })).toBeVisible();
			await places.getByRole('button', { name: 'Search results & details', exact: true }).click();
			await expect(
				places.getByRole('region', { name: 'Place research inspector', exact: true })
			).toBeVisible();
			await page.keyboard.press('Escape');
			await expect(
				places.getByRole('region', { name: 'Place research inspector', exact: true })
			).not.toBeVisible();
			await expect(
				places.getByRole('button', { name: 'Search results & details', exact: true })
			).toBeFocused();
			await page.screenshot({ path: path.join(output, 'places-mobile.png'), fullPage: true });
			return noOverflow();
		}
	);
	assert.deepEqual(report.errors, []);
} catch (cause) {
	await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
	process.exitCode = 1;
	console.error(cause);
} finally {
	await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
	await browser.close();
}
