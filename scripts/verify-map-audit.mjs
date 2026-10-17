import { browserBaseURL } from './browser-config.mjs';
import { wheelMapZoom } from './browser-map.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const baseURL = browserBaseURL();
const output = path.resolve('artifacts/qa/map-audit');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 60000 });
/** @type {{checks:Array<{name:string,status:string,detail?:unknown}>,pageErrors:string[],failure?:string}} */
const report = { checks: [], pageErrors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });

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

async function newPage() {
	const context = await browser.newContext({
		viewport: { width: 1440, height: 1000 },
		reducedMotion: 'reduce'
	});
	const page = await context.newPage();
	page.setDefaultTimeout(60000);
	page.on('pageerror', (error) => report.pageErrors.push(error.message));
	return { context, page };
}

/** @param {import('@playwright/test').Page} page */
async function openMap(page) {
	await page.goto(`${baseURL}/?view=map&tool=explore&island=island%3A1442`);
	const atlas = page.locator('.national-map');
	await expect(atlas).toHaveAttribute('aria-busy', 'false');
	await expect(atlas).toHaveAttribute('data-active', 'true');
	return atlas;
}

try {
	await check(
		'Corrupt saved changes recover safely and impossible saved dates use a valid default',
		async () => {
			const { context, page } = await newPage();
			try {
				await page.addInitScript(() => {
					localStorage.setItem(
						'policy-map-v2:island:1442',
						JSON.stringify({
							title: 'Recovered map proposal',
							operations: [
								null,
								{
									type: 'add_service',
									name: 'Corrupt saved route',
									metadata: {
										ui_map_features: {
											type: 'FeatureCollection',
											features: [
												{
													type: 'Feature',
													geometry: { type: 'LineString', coordinates: [null] }
												}
											]
										}
									}
								},
								{ type: 'add_stop', coordinates: [73.5379734, 4.2329967], name: 'Saved stop' }
							],
							assumptions: { date: '2026-02-31' }
						})
					);
				});
				const atlas = await openMap(page);
				await expect(atlas).toHaveAttribute('data-policy-proposal-points', '1');
				await page.getByRole('button', { name: /^Create (?:a )?proposal$/ }).click();
				const panel = page.getByRole('region', { name: 'Island needs and proposal', exact: true });
				await expect(panel).toContainText('2 saved changes could not be restored');
				await expect
					.poll(() =>
						page.evaluate(() => {
							const saved = JSON.parse(localStorage.getItem('policy-map-v2:island:1442') ?? '{}');
							return { count: saved.operations?.length, date: saved.assumptions?.date };
						})
					)
					.toEqual({ count: 1, date: '2026-10-10' });
				await page.screenshot({ path: path.join(output, 'recovered-draft.png') });
				return { retainedValidChanges: 1, discardedInvalidChanges: 2, validDate: '2026-10-10' };
			} finally {
				await context.close();
			}
		}
	);

	await check('Escape in another workspace preserves the retained map placement', async () => {
		const { context, page } = await newPage();
		try {
			const atlas = await openMap(page);
			await page.getByRole('button', { name: /^Create (?:a )?proposal$/ }).click();
			const panel = page.getByRole('region', { name: 'Island needs and proposal', exact: true });
			await panel
				.locator('.policy-palette')
				.getByRole('button', { name: 'School', exact: true })
				.click();
			await expect(atlas).toHaveAttribute('data-policy-placement-kind', 'add_school');
			const navigation = page.getByRole('navigation', { name: 'Workspace', exact: true });
			await navigation.getByRole('button', { name: 'Analytics', exact: true }).click();
			await expect(atlas).toHaveAttribute('data-active', 'false');
			await expect(atlas).toHaveAttribute('data-policy-placement-kind', 'add_school');
			await page.keyboard.press('Escape');
			await expect(atlas).toHaveAttribute('data-policy-placement-kind', 'add_school');
			await navigation.getByRole('button', { name: 'Map & planning', exact: true }).click();
			await expect(atlas).toHaveAttribute('data-active', 'true');
			await page.getByRole('button', { name: /^Create (?:a )?proposal$/ }).click();
			await panel
				.locator('.policy-palette')
				.getByRole('button', { name: 'School', exact: true })
				.click();
			await expect(atlas).toHaveAttribute('data-policy-placement-kind', 'add_school');
			await page.keyboard.press('Escape');
			await expect(atlas).toHaveAttribute('data-policy-placement-kind', '');
			return { hiddenEscapeKeepsPlacement: true, visibleEscapeCancelsPlacement: true };
		} finally {
			await context.close();
		}
	});

	await check(
		'Vessel and infrastructure cluster sprites resolve before their first rendering',
		async () => {
			const { context, page } = await newPage();
			/** @type {string[]} */
			const missingImages = [];
			page.on('console', (message) => {
				if (/Image "atlas-(?:vessels|cluster)-.*could not be loaded/.test(message.text()))
					missingImages.push(message.text());
			});
			try {
				const atlas = await openMap(page);
				await expect
					.poll(async () => Number(await atlas.getAttribute('data-vessel-groups')))
					.toBeGreaterThan(0);
				for (
					let attempts = 0;
					attempts < 8 && Number(await atlas.getAttribute('data-zoom')) > 11.9;
					attempts++
				) {
					await wheelMapZoom(page, atlas, -1);
					await page.waitForTimeout(350);
				}
				await expect
					.poll(async () => Number(await atlas.getAttribute('data-rendered-place-clusters')))
					.toBeGreaterThan(0);
				assert.deepEqual(
					missingImages,
					[],
					'Every requested vessel/place cluster icon must resolve before its first response.'
				);
				await page.screenshot({ path: path.join(output, 'cluster-icons.png') });
				return {
					missingImageWarnings: 0,
					vesselGroups: await atlas.getAttribute('data-vessel-groups'),
					placeGroups: await atlas.getAttribute('data-rendered-place-clusters')
				};
			} finally {
				await context.close();
			}
		}
	);
	assert.deepEqual(report.pageErrors, []);
} catch (error) {
	report.failure = String(error);
	throw error;
} finally {
	await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
	await browser.close();
}
