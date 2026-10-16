import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { browserBaseURL } from './browser-config.mjs';

// Run against the production build, including its real same-origin backend proxy.
// Example: MOBILITY_QA_URL=http://127.0.0.1:5182/apps/datathon node scripts/verify-subpath.mjs
const baseURL = browserBaseURL();
const mount = new URL(`${baseURL}/`);
assert.notEqual(mount.pathname, '/', 'Use a build served from a non-root app path.');
const output = path.resolve('artifacts/qa/subpath');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1000 },
	reducedMotion: 'reduce'
});
const page = await context.newPage();
page.setDefaultTimeout(60000);
const navigation = page.getByRole('navigation', { name: 'Workspace', exact: true });
/** @type {string[]} */
const escapedRequests = [];
/** @type {string[]} */
const pageErrors = [];
/** @type {string[]} */
const failedAssets = [];
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('request', (request) => {
	const url = new URL(request.url());
	if (url.origin === mount.origin && !url.pathname.startsWith(mount.pathname))
		escapedRequests.push(url.pathname);
});
page.on('response', (response) => {
	const url = new URL(response.url());
	if (url.origin === mount.origin && url.pathname.includes('/_app/') && !response.ok())
		failedAssets.push(`${response.status()} ${url.pathname}`);
});
/** @type {{baseURL:string,checks:string[],pageErrors:string[],escapedRequests:string[],failedAssets:string[],failure?:string}} */
const report = { baseURL, checks: [], pageErrors, escapedRequests, failedAssets };
try {
	for (const endpoint of ['health', 'national/summary']) {
		const response = await context.request.get(`${baseURL}/api/backend/${endpoint}`);
		assert.equal(response.status(), 200, `${endpoint} must reach the real backend.`);
		assert.match(response.headers()['content-type'] ?? '', /application\/json/);
		assert.equal(typeof (await response.json()), 'object');
	}
	report.checks.push('Real backend health and national analysis work through the prefixed proxy.');

	const aliases = [
		['evidence', 'view=evidence'],
		['decisions', 'view=map&tool=proposals&proposal=policy'],
		['forecasts', 'view=overview&analytics=passengers']
	];
	for (const [alias, query] of aliases) {
		const response = await context.request.get(`${baseURL}/${alias}`, { maxRedirects: 0 });
		assert.equal(response.status(), 307);
		assert.equal(response.headers().location, `${mount.pathname}?${query}`);
	}
	report.checks.push('Legacy links redirect inside the app mount.');

	await page.goto(`${baseURL}/`, { waitUntil: 'domcontentloaded' });
	await expect(navigation.getByRole('button', { name: 'Analytics', exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(page.locator('.brand')).toHaveAttribute('href', `${mount.pathname}?view=overview`);
	await navigation.getByRole('button', { name: 'Map & planning', exact: true }).click();
	await expect(page.getByLabel('Service coverage map', { exact: true })).toBeVisible();
	await expect(page.locator('.national-map')).toHaveAttribute('aria-busy', 'false', {
		timeout: 90000
	});
	await expect(page).toHaveURL((url) => url.pathname === mount.pathname);
	await navigation.getByRole('button', { name: 'Evidence', exact: true }).click();
	await expect(navigation.getByRole('button', { name: 'Evidence', exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(page).toHaveURL(
		(url) => url.pathname === mount.pathname && url.searchParams.get('view') === 'evidence'
	);
	await expect(
		page.locator(`a[href="${mount.pathname}api/backend/national/summary"]`)
	).toBeVisible();
	report.checks.push('Analytics, map, evidence and download links stay inside the app mount.');
	await page.screenshot({ path: path.join(output, 'evidence.png'), fullPage: false });
	assert.deepEqual(escapedRequests, [], 'Browser requests must not escape to root app/API routes.');
	assert.deepEqual(failedAssets, [], 'Hashed frontend assets must load successfully.');
	assert.deepEqual(pageErrors, [], 'The mounted frontend must run without browser exceptions.');
	report.checks.push('No root URL leaks, failed frontend assets or browser exceptions.');
	console.log(`PASS ${report.checks.length} subpath deployment checks: ${baseURL}`);
} catch (error) {
	report.failure = String(error);
	await page
		.screenshot({ path: path.join(output, 'failure.png'), fullPage: false })
		.catch(() => {});
	throw error;
} finally {
	await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
	await browser.close();
}
