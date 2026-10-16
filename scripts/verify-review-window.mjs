import { browserBaseURL } from './browser-config.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const baseURL = browserBaseURL();
const output = path.resolve('artifacts/qa/review-window');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 90000 });
/** @type {{baseURL:string,checks:Array<{name:string,status:string,detail?:unknown}>,pageErrors:string[],failure?:string}} */
const report = { baseURL, checks: [], pageErrors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(90000);
page.on('pageerror', (error) => report.pageErrors.push(error.message));
const review = page.locator('dialog.forecast-review');
const panel = page.getByRole('region', { name: 'Island needs and proposal', exact: true });
const opener = panel.getByRole('button', { name: 'Review full impact', exact: true });

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

async function settled() {
	await expect
		.poll(() =>
			review.evaluate(
				(element) => element.getAnimations().filter((item) => item.playState === 'running').length
			)
		)
		.toBe(0);
}

async function size() {
	return review.evaluate((element) => ({
		width: element.clientWidth,
		height: element.clientHeight
	}));
}

/** @param {'left'|'bottom'} edge @param {number} dx @param {number} dy */
async function resize(edge, dx, dy) {
	const grip = review.getByRole('button', { name: `Resize window from ${edge}`, exact: true });
	const rect = await grip.boundingBox();
	assert.ok(rect);
	const x = rect.x + rect.width / 2;
	const y = rect.y + rect.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + dx, y + dy, { steps: 12 });
	await page.mouse.up();
}

async function createRealFrequencyProposal() {
	console.log('SETUP open map');
	await page.goto(`${baseURL}/?view=map&tool=explore&island=island%3A1442`, {
		waitUntil: 'domcontentloaded'
	});
	await expect(page.locator('.national-map')).toHaveAttribute('aria-busy', 'false');
	console.log('SETUP open proposal');
	if (!(await panel.isVisible())) {
		const edit = page.getByRole('button', { name: /^Edit proposal/ });
		if (await edit.isVisible()) await edit.click();
		else await page.getByRole('button', { name: /^Create (?:a )?proposal$/ }).click();
	}
	if ((await panel.getAttribute('data-policy-section')) !== 'proposal')
		await panel.getByRole('button', { name: /^Your proposal/ }).click();
	await panel.getByRole('button', { name: 'Edit budget limits', exact: true }).click();
	await panel.getByLabel('Capital budget · MVR', { exact: true }).fill('1000000000');
	await panel.getByLabel('Annual running budget · MVR', { exact: true }).fill('1000000000');
	console.log('SETUP load dated route');
	const response = await page.request.get(
		`${baseURL}/api/backend/planning/baseline?island_id=island%3A1442`
	);
	assert.equal(response.status(), 200);
	const baseline = await response.json();
	const route = baseline.patterns.find(
		(/** @type {{mode:string,name:string}} */ row) =>
			row.mode === 'bus' && row.name.startsWith('R1 ')
	);
	assert.ok(route);
	console.log('SETUP open bus editor');
	await panel.getByRole('button', { name: 'Improve bus line', exact: true }).click();
	const editor = page.getByTestId('map-service-editor');
	await editor.getByLabel('Bus route and direction', { exact: true }).selectOption(route.id);
	await editor.getByLabel('Service date', { exact: true }).fill('2026-10-10');
	await editor.getByLabel('A bus every · min', { exact: true }).fill('15');
	console.log('SETUP accept frequency');
	await editor.getByRole('button', { name: 'Accept service', exact: true }).click();
	await expect(editor).not.toBeVisible();
	await expect(page.locator('.national-map')).toHaveAttribute('data-policy-calculating', 'false');
	if (!(await panel.isVisible()))
		await page.getByRole('button', { name: /^Edit proposal/ }).click();
	if ((await panel.getAttribute('data-policy-section')) !== 'proposal')
		await panel.getByRole('button', { name: /^Your proposal/ }).click();
	await expect(opener).toBeEnabled();
	console.log('SETUP evaluation ready');
}

try {
	await createRealFrequencyProposal();
	await check('Pointer opening animates the retained native review dialog', async () => {
		await opener.click();
		await expect(review).toBeVisible();
		const moving = await review.evaluate((element) => element.getAnimations().length);
		assert.ok(moving > 0, 'Pointer opening has an actual entry animation.');
		await settled();
		await expect(review).toContainText('shorter expected wait');
		assert.equal(await review.locator('.window-resize-handle').count(), 8);
		const initial = await size();
		assert.ok(initial.width >= 1200 && initial.height >= 900);
		return initial;
	});
	/** @type {{width:number,height:number}} */
	let preferred;
	await check('Both axes resize, stay within limits and reflow the report', async () => {
		await resize('left', 160, 0);
		await resize('bottom', 0, -120);
		preferred = await size();
		assert.ok(preferred.width >= 900 && preferred.width <= 1000);
		assert.ok(preferred.height >= 650 && preferred.height <= 780);
		const overflow = await review.locator('.forecast-content').evaluate((element) => ({
			width: element.clientWidth,
			scroll: element.scrollWidth
		}));
		assert.ok(
			overflow.scroll <= overflow.width + 1,
			'Report contents do not overflow the resized window.'
		);
		await page.screenshot({ path: path.join(output, 'review-resized-desktop.png') });
		return { ...preferred, overflow };
	});
	await check('Maximize and restore preserve the preferred size', async () => {
		await review.getByRole('button', { name: 'Maximize review', exact: true }).click();
		await expect(review).toHaveAttribute('data-resizable-maximized', 'true');
		const maximum = await size();
		assert.ok(maximum.width > preferred.width && maximum.height > preferred.height);
		await review.getByRole('button', { name: 'Restore review size', exact: true }).click();
		const restored = await size();
		assert.ok(Math.abs(restored.width - preferred.width) <= 1);
		assert.ok(Math.abs(restored.height - preferred.height) <= 1);
		return { maximum, restored };
	});
	await check('Closing keeps the custom size during exit and restores focus', async () => {
		await review.getByRole('button', { name: 'Close proposal review', exact: true }).click();
		const exiting = await review.evaluate((element) => ({
			open: /** @type {HTMLDialogElement} */ (element).open,
			width: element.clientWidth,
			animations: element.getAnimations().length
		}));
		assert.equal(exiting.open, true, 'Native dialog remains mounted through exit.');
		assert.ok(exiting.animations > 0);
		assert.ok(
			Math.abs(exiting.width - preferred.width) <= 1,
			'Exit must not snap to default dimensions.'
		);
		await expect(review).not.toBeVisible();
		await expect(opener).toBeFocused();
		await opener.click();
		await expect(review).toBeVisible();
		await settled();
		assert.deepEqual(await size(), preferred);
		return { exiting, reopened: await size() };
	});
	await check('Escape and keyboard activation are immediate with no motion', async () => {
		await page.keyboard.press('Escape');
		await expect(review).not.toBeVisible();
		await expect(opener).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(review).toBeVisible();
		assert.equal(await review.evaluate((element) => element.getAnimations().length), 0);
		return { keyboardMotion: false };
	});
	await check('Remembered desktop sizes become a safe full-screen mobile review', async () => {
		await page.setViewportSize({ width: 375, height: 812 });
		await expect(review.locator('.window-resize-handle')).toHaveCount(0);
		await expect(
			review.getByRole('button', { name: 'Maximize review', exact: true })
		).not.toBeVisible();
		const mobile = await size();
		assert.equal(mobile.width, 375);
		assert.equal(mobile.height, 812);
		const overflow = await review.locator('.forecast-content').evaluate((element) => ({
			width: element.clientWidth,
			scroll: element.scrollWidth
		}));
		assert.ok(overflow.scroll <= overflow.width + 1);
		await page.screenshot({ path: path.join(output, 'review-mobile.png') });
		await page.setViewportSize({ width: 1440, height: 1000 });
		await expect(review.locator('.window-resize-handle')).toHaveCount(8);
		assert.deepEqual(await size(), preferred);
		return { mobile, restored: await size(), overflow };
	});
	await check(
		'Reloaded tabs restore the saved review size and reduced motion is respected',
		async () => {
			await page.keyboard.press('Escape');
			await expect(review).not.toBeVisible();
			await page.reload({ waitUntil: 'domcontentloaded' });
			await createRealFrequencyProposal();
			await page.emulateMedia({ reducedMotion: 'reduce' });
			await opener.click();
			await expect(review).toBeVisible();
			assert.equal(await review.evaluate((element) => element.getAnimations().length), 0);
			assert.deepEqual(await size(), preferred);
			return { rememberedAfterReload: await size(), reducedMotion: true };
		}
	);
	await check(
		'Updating and failed evaluations retain qualified results, then recover on review',
		async () => {
			const previousAccess = await review.locator('.access-card').innerText();
			await page.keyboard.press('Escape');
			await expect(review).not.toBeVisible();
			const budget = panel.getByRole('region', { name: 'Proposal budget', exact: true });
			const transport = panel.getByRole('region', {
				name: 'Transport service impact',
				exact: true
			});
			const previous = await transport.locator('.impact-metrics').innerText();
			let requested = false;
			/** @type {() => void} */
			let release = () => {};
			const held = new Promise((resolve) => {
				release = () => resolve(undefined);
			});
			await page.route(
				'**/planning/evaluate',
				async (route) => {
					requested = true;
					await held;
					await route.abort('failed');
				},
				{ times: 1 }
			);
			try {
				await page.getByLabel('Access shown on map', { exact: true }).selectOption('education');
				await expect.poll(() => requested).toBe(true);
				await expect(budget).toHaveAttribute('aria-busy', 'true');
				await expect(transport).toContainText('Updating… · previous calculation');
				assert.equal(await transport.locator('.impact-metrics').innerText(), previous);
				await page.screenshot({ path: path.join(output, 'proposal-updating-retained.png') });
			} finally {
				release();
			}
			await expect(budget).toHaveAttribute('aria-busy', 'false');
			await expect(budget).toContainText('Previous calculation');
			await expect(transport).toContainText('changes need recalculation');
			assert.equal(await transport.locator('.impact-metrics').innerText(), previous);
			let retryRequested = false;
			/** @type {() => void} */
			let releaseRetry = () => {};
			const heldRetry = new Promise((resolve) => {
				releaseRetry = () => resolve(undefined);
			});
			await page.route(
				'**/planning/evaluate',
				async (route) => {
					retryRequested = true;
					await heldRetry;
					await route.continue();
				},
				{ times: 1 }
			);
			try {
				await opener.click(); // Opening stale impact retries the real request.
				await expect(review).toBeVisible();
				await expect.poll(() => retryRequested).toBe(true);
				await expect(review.locator('.forecast-shell')).toHaveAttribute('aria-busy', 'true');
				assert.equal(await review.locator('.access-card').innerText(), previousAccess);
				await expect(
					review.getByRole('button', { name: 'Save as PDF', exact: true })
				).toBeDisabled();
			} finally {
				releaseRetry();
			}
			await expect(review.locator('.forecast-shell')).toHaveAttribute('aria-busy', 'false');
			await expect(review.getByRole('button', { name: 'Save as PDF', exact: true })).toBeEnabled();
			await expect(review).not.toContainText('These results describe the previous version.');
			await expect(review.locator('.access-card')).toContainText('education');
			await expect(review.locator('.access-card')).toContainText('30-minute target');
			return {
				retainedWhileUpdating: true,
				failureQualified: true,
				previousGoalRetained: true,
				realRetryCompleted: true
			};
		}
	);
	assert.deepEqual(report.pageErrors, []);
} catch (error) {
	report.failure = String(error);
	await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
	throw error;
} finally {
	await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
	await context.close();
	await browser.close();
}

console.log(JSON.stringify(report, null, 2));
