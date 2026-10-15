import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const expect = playwrightExpect.configure({ timeout: 45000 });

const baseURL = process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5173';
const output = path.resolve('artifacts/qa/workspace-refinement');
await mkdir(output, { recursive: true });
/** @type {{baseURL:string,checks:Array<{name:string,status:string,detail?:unknown}>,errors:string[]}} */
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
	} catch (error) {
		report.checks.push({ name, status: 'failed', detail: String(error) });
		throw error;
	}
}
/** @param {string} name */
const workspace = (name) =>
	page
		.getByRole('navigation', { name: 'Workspace', exact: true })
		.getByRole('button', { name, exact: true });
/** @param {string} name */
const tool = (name) =>
	page
		.getByRole('tablist', { name: 'Map workspace tools', exact: true })
		.getByRole('tab', { name, exact: true });
/** @param {string} name */
async function selectTool(name) {
	await tool(name).click();
	await expect(tool(name)).toHaveAttribute('aria-selected', 'true');
}
async function noOverflow() {
	const size = await page.evaluate(() => ({
		viewport: innerWidth,
		width: document.documentElement.scrollWidth
	}));
	assert.ok(size.width <= size.viewport + 1, JSON.stringify(size));
	return size;
}
try {
	await check(
		'Three global workspaces with map tools nested beneath the same island scope',
		async () => {
			await page.goto(`${baseURL}/?view=map&tool=explore&island=island%3A1442`);
			await expect(page.locator('.detail-panel')).toContainText('65,714');
			const names = await page
				.getByRole('navigation', { name: 'Workspace', exact: true })
				.getByRole('button')
				.allTextContents();
			assert.deepEqual(
				names.map((x) => x.trim()),
				['Analytics', 'Map & planning', 'Evidence']
			);
			await expect(workspace('Map & planning')).toHaveAttribute('aria-current', 'page');
			await expect(page.locator('.workspace-scope')).toContainText('Hulhumalé');
			assert.equal(
				await page.getByRole('tablist', { name: 'Map workspace tools' }).getByRole('tab').count(),
				4
			);
			return names;
		}
	);
	await check(
		'Proposals and live default to their decision workflows; browser back retains context',
		async () => {
			await selectTool('Proposals');
			await expect(
				page.getByRole('tab', { name: 'Resident access & services', exact: true })
			).toHaveAttribute('aria-selected', 'true');
			await expect(page.locator('.policy-workbench')).toBeVisible();
			assert.equal(new URL(page.url()).searchParams.get('tool'), 'proposals');
			await selectTool('Live');
			await expect(
				page.getByRole('tab', { name: 'Weather, traffic & notices', exact: true })
			).toHaveAttribute('aria-selected', 'true');
			await expect(page.locator('.operations-workspace')).toBeVisible();
			assert.equal(new URL(page.url()).searchParams.get('island'), 'island:1442');
			await page.goBack();
			await expect(tool('Proposals')).toHaveAttribute('aria-selected', 'true');
			await expect(page.locator('.policy-workbench')).toBeVisible();
			await page.goForward();
			await expect(tool('Live')).toHaveAttribute('aria-selected', 'true');
			await selectTool('Explore');
			await page.getByRole('tab', { name: 'Island & streets', exact: true }).click();
			await expect(page.locator('.national-map')).toBeVisible();
		}
	);
	await check(
		'Nationwide schedules expose real departure calendars and qualify missing arrival data',
		async () => {
			await page.getByRole('tab', { name: 'Nationwide schedules', exact: true }).click();
			const schedules = page.locator('.source-updates');
			await expect(
				schedules.getByRole('heading', { name: 'Nationwide timetables', exact: true })
			).toBeVisible();
			await expect(schedules.locator('#national-from')).toHaveValue('island:1442');
			await expect(schedules.locator('.calendars > .calendar-card')).toHaveCount(4);
			const catalog = await (
				await page.request.get(`${baseURL}/api/backend/data-updates/schedules`)
			).json();
			assert.equal(
				catalog.services.length,
				0,
				'QA runs before accepting any new timetable sources'
			);
			await expect(
				schedules.getByRole('button', { name: 'Find a dated itinerary', exact: false })
			).toBeDisabled();
			await expect(schedules).toContainText('No reviewed timed services have been imported');
			await page.screenshot({
				path: path.join(output, 'nationwide-schedules-desktop.png'),
				fullPage: true
			});
			return {
				departureCalendars: catalog.published_calendars.length,
				reviewedTimedServices: catalog.services.length
			};
		}
	);
	await check(
		'Blank template contains no fabricated services; invalid import leaves source store unchanged',
		async () => {
			const schedules = page.locator('.source-updates');
			const download = page.waitForEvent('download');
			await schedules.getByRole('button', { name: 'Blank template', exact: true }).click();
			const file = await download;
			const filename = path.join(output, file.suggestedFilename());
			await file.saveAs(filename);
			const template = JSON.parse(await readFile(filename, 'utf8'));
			assert.deepEqual(template.services, []);
			const before = await (
				await page.request.get(`${baseURL}/api/backend/data-updates/schedules`)
			).json();
			const response = page.waitForResponse((r) =>
				r.url().endsWith('/data-updates/schedules/stage')
			);
			await schedules.locator('input[type=file]').setInputFiles({
				name: 'invalid-empty-template.json',
				mimeType: 'application/json',
				buffer: Buffer.from(JSON.stringify(template))
			});
			assert.equal((await response).status(), 422);
			await expect(schedules.getByRole('alert')).toBeVisible();
			const after = await (
				await page.request.get(`${baseURL}/api/backend/data-updates/schedules`)
			).json();
			assert.deepEqual(after.snapshots, before.snapshots);
			return { rejectedStatus: 422, snapshotsUnchanged: true };
		}
	);
	await check('Evidence renders captured publisher receipts and source dates', async () => {
		await workspace('Evidence').click();
		const evidence = page.locator('.evidence-page .source-updates');
		await expect(evidence.locator('.receipt')).toHaveCount(7);
		await expect(evidence).toContainText('Latest published month: 2026-06');
		await expect(evidence).toContainText('Publisher HTTP 200');
		await evidence
			.locator('.receipt details')
			.first()
			.getByText('Source receipt', { exact: true })
			.click();
		assert.match(await evidence.locator('.receipt code').first().innerText(), /^[a-f0-9]{64}$/);
		await page.screenshot({
			path: path.join(output, 'source-evidence-desktop.png'),
			fullPage: true
		});
	});
	for (const width of [768, 390]) {
		await check(`Responsive ${width}px navigation and schedules remain usable`, async () => {
			await page.setViewportSize({ width, height: 900 });
			await noOverflow();
			await workspace('Map & planning').click();
			await selectTool('Explore');
			await page.getByRole('tab', { name: 'Nationwide schedules', exact: true }).click();
			await expect(page.locator('.source-updates #national-from')).toHaveValue('island:1442');
			await noOverflow();
			for (const name of ['Explore', 'Proposals', 'Live', 'Places & directions']) {
				const box = await tool(name).boundingBox();
				assert.ok(box && box.width >= 45 && box.height >= 32);
			}
			await page.screenshot({
				path: path.join(output, `nationwide-schedules-${width}.png`),
				fullPage: true
			});
			return await noOverflow();
		});
	}
	assert.deepEqual(report.errors, []);
} finally {
	await writeFile(path.join(output, 'browser-verification.json'), JSON.stringify(report, null, 2));
	await browser.close();
}
