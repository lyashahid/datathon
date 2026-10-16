import { browserBaseURL } from './browser-config.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Use real place search and ordinary motion to exercise the retained atlas.
// No provider responses, application state, or map coordinates are replaced.
const baseURL = browserBaseURL();
const output = path.resolve('artifacts/qa/map-place-focus');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 60000 });
/** @type {{baseURL:string,startedAt:string,finishedAt?:string,checks:Array<{name:string,status:string,detail?:unknown}>,pageErrors:string[]}} */
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], pageErrors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });

/** @param {import('@playwright/test').Locator} atlas */
async function mapState(atlas) {
	return atlas.evaluate((element) =>
		Object.fromEntries(
			[...element.attributes]
				.filter((attribute) => attribute.name.startsWith('data-'))
				.map((attribute) => [attribute.name, attribute.value])
		)
	);
}

/** @param {import('@playwright/test').Locator} pin */
async function pinVisibility(pin) {
	return pin.evaluate((element) => {
		const box = element.getBoundingClientRect();
		const canvas = element.closest('.national-map')?.querySelector('.maplibregl-canvas');
		const mapBox = canvas?.getBoundingClientRect();
		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		return {
			x,
			y,
			insideMap: Boolean(
				mapBox &&
				box.left >= mapBox.left &&
				box.right <= mapBox.right &&
				box.top >= mapBox.top &&
				box.bottom <= mapBox.bottom
			),
			unobscured: document.elementFromPoint(x, y)?.closest('.journey-drag-pin') === element
		};
	});
}

try {
	/** @type {Array<'no-preference'|'reduce'>} */
	const motionPreferences = ['no-preference', 'reduce'];
	for (const reducedMotion of motionPreferences) {
		const context = await browser.newContext({
			viewport: { width: 1440, height: 1000 },
			reducedMotion
		});
		try {
			const page = await context.newPage();
			page.setDefaultTimeout(60000);
			page.on('pageerror', (error) => report.pageErrors.push(error.message));
			await page.goto(`${baseURL}/?view=map&tool=explore&island=island%3A1443`);
			const atlas = page.locator('.national-map');
			await expect(atlas).toHaveAttribute('data-rendered-roads', /[1-9]/);
			const before = await mapState(atlas);
			assert.ok(Number(before['data-center-latitude']) > 4.1, 'The initial map is at Malé');

			await page.getByRole('button', { name: 'Find a place', exact: true }).click();
			await expect(atlas).toHaveAttribute('data-active', 'true');
			await page
				.getByRole('textbox', { name: 'Place, service or category' })
				.fill('Maafushi Hospital');
			await page.getByRole('button', { name: 'Search places', exact: true }).click();
			await page.locator('.place-result').filter({ hasText: 'Maafushi Hospital' }).first().click();
			await expect(page.locator('.detail-card .coordinate-line')).toContainText('3.941468');
			await expect(page.locator('.detail-card .coordinate-line')).toContainText('73.490132');
			await page.getByRole('button', { name: 'Directions to this place', exact: true }).click();
			await expect(atlas).toHaveAttribute('data-active', 'true');
			await expect(atlas).toHaveAttribute('data-journey-endpoints', '1');
			const endpoint = atlas.locator('.journey-drag-pin.end');
			await expect
				.poll(async () => {
					const visibility = await pinVisibility(endpoint);
					return visibility.insideMap && visibility.unobscured;
				})
				.toBe(true);
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-center-latitude')))
				.toBeLessThan(4);
			await expect(page.locator('.explore-journey .journey-endpoint.destination')).toContainText(
				'Maafushi Hospital'
			);
			await expect(atlas).toHaveAttribute('data-context-roads', /[1-9]/);
			await expect(atlas).toHaveAttribute('data-rendered-roads', /[1-9]/);
			await expect(atlas).toHaveAttribute('aria-busy', 'false');

			const after = await mapState(atlas);
			const visibility = await pinVisibility(endpoint);
			await page.screenshot({ path: path.join(output, `maafushi-${reducedMotion}.png`) });
			report.checks.push({
				name: `Named place focus on retained atlas · ${reducedMotion}`,
				status: 'passed',
				detail: { before, after, sourceCoordinates: [73.490132, 3.941468], visibility }
			});
			console.log(`PASS named Maafushi Hospital handoff (${reducedMotion})`);
		} finally {
			await context.close();
		}
	}
	assert.deepEqual(report.pageErrors, [], 'No browser errors');
} catch (error) {
	report.checks.push({ name: 'Named place focus', status: 'failed', detail: String(error) });
	throw error;
} finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
	await browser.close();
}
