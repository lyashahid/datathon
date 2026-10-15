import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';

const baseURL = process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5173';
const output = path.resolve('artifacts/qa/engaged-map');
await mkdir(output, { recursive: true });
/** @type {{baseURL:string,startedAt:string,finishedAt?:string,checks:Array<{name:string,status:string,detail?:unknown}>,errors:string[]}} */
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], errors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1000 },
	reducedMotion: 'reduce'
});
const page = await context.newPage();
page.setDefaultTimeout(60000);
/** @type {URL[]} */
const requests = [];
page.on('request', (request) => {
	const url = new URL(request.url());
	if (url.pathname === '/api/backend/live/snapshot') requests.push(url);
});
page.on('pageerror', (error) => report.errors.push(error.message));
/** @param {string} name @param {()=>Promise<unknown>} work */
async function check(name, work) {
	console.log(`RUN ${name}`);
	try {
		const detail = await work();
		report.checks.push({ name, status: 'passed', detail });
		console.log(`PASS ${name}`);
	} catch (error) {
		report.checks.push({ name, status: 'failed', detail: String(error) });
		throw error;
	}
}
/** @param {URL} url */
function validateScope(url) {
	assert.equal(url.searchParams.get('discover_nearby'), 'true');
	assert.equal(url.searchParams.get('include_stale'), 'false');
	assert.equal(url.searchParams.get('radius_nm'), '10');
	const bounds = (url.searchParams.get('bbox') || '').split(',').map(Number);
	assert.equal(bounds.length, 4);
	assert.ok(bounds[2] - bounds[0] < 0.4 && bounds[3] - bounds[1] < 0.4);
	return Object.fromEntries(url.searchParams);
}
/** @param {string} name */
const tool = (name) =>
	page
		.getByRole('tablist', { name: 'Map workspace tools', exact: true })
		.getByRole('tab', { name, exact: true });

try {
	await check(
		'Explore automatically requests a bounded nearby scope and renders real observations',
		async () => {
			const response = page.waitForResponse(
				(r) => new URL(r.url()).pathname === '/api/backend/live/snapshot'
			);
			await page.goto(`${baseURL}/?view=map&tool=explore&island=island%3A1443`);
			await expect(page.locator('.national-map')).toBeVisible();
			const received = await response;
			assert.equal(received.status(), 200);
			const snapshot = await received.json();
			const scope = validateScope(new URL(received.url()));
			const [west, south, east, north] = scope.bbox.split(',').map(Number);
			for (const event of snapshot.events) {
				assert.ok(event.position.longitude >= west && event.position.longitude <= east);
				assert.ok(event.position.latitude >= south && event.position.latitude <= north);
				assert.ok(!event.stale);
				assert.ok(event.provider);
			}
			await expect(page.locator('.national-map')).toHaveAttribute(
				'data-movement-positions',
				String(snapshot.events.length)
			);
			await expect(page.locator('.map-movement-status')).toContainText('Observed movement');
			await page.waitForTimeout(1200);
			assert.equal(requests.length, 1, 'A settled map must not trigger a movement request loop');
			return {
				scope,
				positions: snapshot.events.length,
				kinds: snapshot.events.reduce(
					/** @param {Record<string,number>} counts @param {{kind:string}} event */
					(counts, event) => ({ ...counts, [event.kind]: (counts[event.kind] || 0) + 1 }),
					{}
				),
				providers: snapshot.providers,
				retrieved_at: snapshot.retrieved_at
			};
		}
	);
	await check('Nearby positions can be brought into view with the map controls', async () => {
		await page.getByRole('button', { name: 'View', exact: true }).click();
		const nearby = page.getByRole('button', { name: 'Show nearby movement', exact: true });
		const count = Number(
			await page.locator('.national-map').getAttribute('data-movement-positions')
		);
		if (count > 0) {
			await expect(nearby).toBeEnabled();
			await nearby.click();
			await expect
				.poll(async () =>
					Number(await page.locator('.national-map').getAttribute('data-rendered-movement'))
				)
				.toBeGreaterThan(0);
		} else {
			await expect(nearby).toBeDisabled();
			await page.getByRole('button', { name: 'Close map controls' }).click();
		}
		await page.screenshot({
			path: path.join(output, 'nearby-observed-movement.png'),
			fullPage: true
		});
		return {
			receivedPositions: count,
			renderedPositions: await page.locator('.national-map').getAttribute('data-rendered-movement')
		};
	});
	await check(
		'Pause retains labelled observations and stops further requests; resume refreshes',
		async () => {
			await page.getByRole('button', { name: 'Pause nearby updates', exact: true }).click();
			await expect(
				page.getByRole('button', { name: 'Resume nearby updates', exact: true })
			).toBeVisible();
			await expect(
				page.getByRole('button', { name: 'Refresh nearby', exact: true })
			).toBeDisabled();
			await expect(page.locator('.map-movement-status')).toContainText('paused');
			const paused = requests.length;
			await page.waitForTimeout(1200);
			assert.equal(requests.length, paused);
			const response = page.waitForResponse(
				(r) => new URL(r.url()).pathname === '/api/backend/live/snapshot'
			);
			await page.getByRole('button', { name: 'Resume nearby updates', exact: true }).click();
			assert.equal((await response).status(), 200);
			return { pausedRequests: paused, resumedRequests: requests.length };
		}
	);
	await check(
		'Changing islands changes the movement scope and clears unrelated observations',
		async () => {
			await page.locator('.workspace-scope').click();
			await page.getByRole('textbox', { name: 'Search islands', exact: true }).fill('Hithadhoo');
			const response = page.waitForResponse(
				(r) => new URL(r.url()).pathname === '/api/backend/live/snapshot'
			);
			await page.locator('[data-island-id="island:1152"]').click();
			const received = await response;
			const scope = validateScope(new URL(received.url()));
			assert.ok(
				Number(scope.latitude) < -0.5,
				'Addu must be included in the national movement scope'
			);
			await expect(page.locator('.workspace-scope')).toContainText('Hithadhoo');
			const snapshot = await received.json();
			await expect(page.locator('.national-map')).toHaveAttribute(
				'data-movement-positions',
				String(snapshot.events.length)
			);
			return { scope, receivedPositions: snapshot.events.length, providers: snapshot.providers };
		}
	);
	await check(
		'Proposal workspace stops Explore polling and retains the selected island',
		async () => {
			await tool('Proposals').click();
			await expect(page.locator('.workspace-scope')).toContainText('Hithadhoo');
			await expect(page.locator('.national-map')).toBeHidden();
			const stopped = requests.length;
			await page.waitForTimeout(1200);
			assert.equal(requests.length, stopped);
			return { stoppedRequests: stopped };
		}
	);
	await check('Mobile map controls stay within the viewport and remain usable', async () => {
		await page.setViewportSize({ width: 390, height: 844 });
		await tool('Explore').click();
		await expect(page.locator('.national-map')).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Pause nearby updates', exact: true })
		).toBeVisible();
		const geometry = await page.evaluate(() => ({
			width: document.documentElement.scrollWidth,
			viewport: innerWidth,
			controls: [...document.querySelectorAll('.nearby-movement-controls button')].map((node) => {
				const bounds = node.getBoundingClientRect();
				return { left: bounds.left, right: bounds.right, height: bounds.height };
			})
		}));
		assert.ok(geometry.width <= geometry.viewport + 1);
		for (const control of geometry.controls)
			assert.ok(control.left >= 0 && control.right <= geometry.viewport && control.height >= 32);
		await page.screenshot({ path: path.join(output, 'mobile-explore.png'), fullPage: true });
		return geometry;
	});
	assert.deepEqual(report.errors, []);
} finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(path.join(output, 'browser-verification.json'), JSON.stringify(report, null, 2));
	await browser.close();
}
