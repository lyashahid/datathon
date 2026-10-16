import { browserBaseURL } from './browser-config.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const baseURL = browserBaseURL();
const output = path.resolve('artifacts/qa/motion-windows');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 90000 });
/** @type {{baseURL:string,checks:Array<{name:string,status:string,detail?:unknown}>,pageErrors:string[],failure?:string}} */
const report = { baseURL, checks: [], pageErrors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(90000);
page.on('pageerror', (error) => report.pageErrors.push(error.message));
let evaluations = 0;
page.on('request', (request) => {
	if (request.method() === 'POST' && request.url().includes('/planning/evaluate')) evaluations++;
});
const nav = page.getByRole('navigation', { name: 'Workspace', exact: true });
const atlas = page.locator('.national-map');
const proposal = page.getByRole('region', { name: 'Island needs and proposal', exact: true });
const weather = page.getByRole('region', { name: 'Weather and traffic on this map', exact: true });

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

/** @param {import('@playwright/test').Locator} list @param {string} selector */
async function aligned(list, selector) {
	await expect
		.poll(() =>
			list.evaluate((element, selected) => {
				const bubble = element.querySelector('[data-selection-indicator]')?.getBoundingClientRect();
				const target = element.querySelector(selected)?.getBoundingClientRect();
				return bubble && target
					? Math.abs(bubble.left - target.left) + Math.abs(bubble.width - target.width)
					: 999;
			}, selector)
		)
		.toBeLessThan(2);
}

/** @param {import('@playwright/test').Locator} panel @param {string} edge @param {number} dx @param {number} dy @param {boolean} cancel */
async function resize(panel, edge, dx, dy, cancel = false) {
	const handle = panel.locator(`.window-resize-handle[data-edge="${edge}"]`);
	await expect(handle).toBeVisible();
	const box = await handle.boundingBox();
	assert.ok(box);
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	// Render the held-pointer state, as a human drag would, before releasing it.
	await panel.evaluate((element) => {
		void getComputedStyle(element).animationName;
		return new Promise(requestAnimationFrame);
	});
	await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
	if (cancel) await page.keyboard.press('Escape');
	await page.mouse.up();
}

async function openProposal() {
	await page.getByRole('button', { name: /^Create (?:a )?proposal$/ }).click();
	await expect(proposal).toBeVisible();
	await expect(
		proposal.locator('.policy-palette').getByRole('button', { name: 'Add bus stop', exact: true })
	).toBeEnabled();
	await expect
		.poll(() => proposal.evaluate((element) => getComputedStyle(element).opacity))
		.toBe('1');
}

async function noOverflow() {
	assert.equal(
		await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
		true
	);
}

/** @param {import('@playwright/test').Locator} locator */
async function boxOf(locator) {
	const box = await locator.boundingBox();
	assert.ok(box, 'The window must be visible before measuring its dimensions.');
	return box;
}

/** @param {import('@playwright/test').Locator} window */
async function settledWindow(window) {
	await expect
		.poll(() =>
			window.evaluate(
				(element) =>
					getComputedStyle(element).opacity === '1' &&
					element
						.getAnimations()
						.every((animation) => !animation.pending && animation.playState !== 'running')
			)
		)
		.toBe(true);
}

try {
	await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
	await expect(nav.locator('[data-selection-indicator]')).toHaveCount(1);
	await check('Initial navigation selection is measured without an opening sweep', async () => {
		await aligned(nav, '[aria-current="page"]');
		const track = await nav.boundingBox();
		assert.ok(track && Math.abs(track.x + track.width / 2 - 720) < 1);
		assert.equal(
			await nav.locator('[data-selection-indicator]').evaluate((el) => el.getAnimations().length),
			0
		);
		await page.evaluate(() => {
			const animate = Element.prototype.animate;
			Reflect.set(window, '__motionSelections', []);
			/** @type {(this: Element, ...args: Parameters<Element['animate']>) => Animation} */
			const trackedAnimate = function (keyframes, options) {
				if (this.matches('[data-selection-indicator]')) {
					Reflect.get(window, '__motionSelections').push({ keyframes, options });
				}
				return animate.call(this, keyframes, options);
			};
			Element.prototype.animate = trackedAnimate;
		});
	});
	await check(
		'Main navigation bubble slides to unequal-width tabs and retains the map canvas',
		async () => {
			await nav.getByRole('button', { name: 'Map & planning', exact: true }).click();
			await expect(atlas).toHaveAttribute('aria-busy', 'false');
			await aligned(nav, '[aria-current="page"]');
			const track = await nav.boundingBox();
			assert.ok(track && Math.abs(track.x + track.width / 2 - 720) < 1);
			assert.ok(await page.evaluate(() => Reflect.get(window, '__motionSelections').length > 0));
			await atlas
				.locator('canvas.maplibregl-canvas')
				.evaluate((canvas) => Reflect.set(window, '__motionMap', canvas));
			await nav.getByRole('button', { name: 'Analytics', exact: true }).click();
			await nav.getByRole('button', { name: 'Evidence', exact: true }).click();
			await nav.getByRole('button', { name: 'Map & planning', exact: true }).click();
			await aligned(nav, '[aria-current="page"]');
			assert.equal(
				await atlas
					.locator('canvas.maplibregl-canvas')
					.evaluate((canvas) => canvas === Reflect.get(window, '__motionMap')),
				true
			);
		}
	);
	await check(
		'Shared tabs slide on pointer input and snap for keyboard and reduced motion',
		async () => {
			await nav.getByRole('button', { name: 'Analytics', exact: true }).click();
			const list = page.getByRole('tablist', { name: 'Analytics workspace', exact: true });
			await expect(list.locator('[data-selection-indicator]')).toHaveCount(1);
			const previous = await page.evaluate(() => Reflect.get(window, '__motionSelections').length);
			await list.getByRole('tab', { name: 'Passenger outlook', exact: true }).click();
			await aligned(list, '[aria-selected="true"]');
			assert.ok(
				(await page.evaluate(() => Reflect.get(window, '__motionSelections').length)) > previous
			);
			await list.getByRole('tab', { name: 'Passenger outlook', exact: true }).focus();
			await page.keyboard.press('ArrowRight');
			await expect(list.getByRole('tab', { name: 'Data studio', exact: true })).toHaveAttribute(
				'aria-selected',
				'true'
			);
			await aligned(list, '[aria-selected="true"]');
			assert.equal(
				await list
					.locator('[data-selection-indicator]')
					.evaluate((el) => el.getAnimations().length),
				0
			);
			await page.emulateMedia({ reducedMotion: 'reduce' });
			await list.getByRole('tab', { name: 'National dashboard', exact: true }).click();
			await aligned(list, '[aria-selected="true"]');
			assert.equal(
				await list
					.locator('[data-selection-indicator]')
					.evaluate((el) => el.getAnimations().length),
				0
			);
			await page.emulateMedia({ reducedMotion: 'no-preference' });
		}
	);
	await check(
		'Island score sheet resizes, restores focus and persists its size after exiting',
		async () => {
			await page.getByRole('button', { name: 'View island scores', exact: true }).click();
			const trigger = page.getByRole('button', { name: /^Why this score for / }).first();
			await trigger.click();
			const sheet = page.locator('.island-accessibility-details');
			await expect(sheet).toBeVisible();
			await expect(sheet.locator('.accessibility-title')).toBeFocused();
			await settledWindow(sheet);
			const initial = await sheet.boundingBox();
			assert.ok(initial);
			await resize(sheet, 'left', -120, 0);
			await resize(sheet, 'bottom', 0, -120);
			const saved = await sheet.boundingBox();
			assert.ok(saved && saved.width > initial.width + 100 && saved.height < initial.height - 100);
			assert.ok(
				Math.abs(saved.x + saved.width - (initial.x + initial.width)) < 2,
				`Finishing a pointer resize must retain the docked edge: ${JSON.stringify({ initial, saved })}`
			);
			await page.keyboard.press('Escape');
			await expect(sheet).toHaveCount(0, { timeout: 4000 });
			await expect(trigger).toBeFocused();
			await trigger.click();
			await expect
				.poll(async () => Math.abs((await boxOf(sheet)).width - saved.width))
				.toBeLessThan(2);
			await expect
				.poll(async () => Math.abs((await boxOf(sheet)).height - saved.height))
				.toBeLessThan(2);
			await expect
				.poll(() => sheet.evaluate((element) => getComputedStyle(element).opacity))
				.toBe('1');
			await page.screenshot({ path: path.join(output, 'island-score-resized-desktop.png') });
			await sheet.evaluate((element) => {
				Reflect.set(window, '__sheetCloseStates', []);
				new MutationObserver(() =>
					Reflect.get(window, '__sheetCloseStates').push(element.getAttribute('data-state'))
				).observe(element, { attributes: true, attributeFilter: ['data-state'] });
			});
			await sheet.getByRole('button', { name: 'Close', exact: true }).click();
			await expect(sheet).toHaveCount(0, { timeout: 4000 });
			assert.ok(
				await page.evaluate(() => Reflect.get(window, '__sheetCloseStates').includes('closed'))
			);
			await expect(trigger).toBeFocused();
			return { initial, saved };
		}
	);
	await check('Island score sheet fits mobile and exits without leaving an overlay', async () => {
		await page.setViewportSize({ width: 375, height: 812 });
		const trigger = page.getByRole('button', { name: /^Why this score for / }).first();
		await trigger.click();
		const sheet = page.locator('.island-accessibility-details');
		await expect(sheet).toBeVisible();
		await expect(sheet.locator('.window-resize-handle')).toHaveCount(0);
		const opening = await sheet.evaluate((element) => {
			const style = getComputedStyle(element);
			return {
				bounds: element.getBoundingClientRect().toJSON(),
				viewportWidth: innerWidth,
				width: style.width,
				maxWidth: style.maxWidth,
				transform: style.transform,
				opacity: style.opacity,
				animations: element.getAnimations().map((animation) => ({
					pending: animation.pending,
					playState: animation.playState,
					currentTime: animation.currentTime
				}))
			};
		});
		await settledWindow(sheet);
		const box = await sheet.boundingBox();
		assert.ok(
			box && box.width <= 375 && box.x >= 0 && box.x + box.width <= 375,
			`The settled mobile sheet must fit the viewport: ${JSON.stringify({ opening, settled: box })}`
		);
		await noOverflow();
		await page.screenshot({ path: path.join(output, 'island-score-mobile.png') });
		await sheet.getByRole('button', { name: 'Close', exact: true }).click();
		await expect(sheet).toHaveCount(0, { timeout: 4000 });
		await expect(page.locator('[data-slot="sheet-overlay"]')).toHaveCount(0, { timeout: 4000 });
		await expect(trigger).toBeFocused();
		await page.setViewportSize({ width: 1440, height: 1000 });
		return { opening, settledBounds: box, viewport: { width: 375, height: 812 } };
	});
	await nav.getByRole('button', { name: 'Map & planning', exact: true }).click();
	await expect(atlas).toHaveAttribute('aria-busy', 'false');
	await openProposal();
	await check(
		'Proposal panel resizes in both dimensions within bounds without recalculating analysis',
		async () => {
			const initial = await proposal.boundingBox();
			assert.ok(initial);
			const count = evaluations;
			await resize(proposal, 'left', -140, 0);
			await resize(proposal, 'bottom', 0, -140);
			const enlarged = await proposal.boundingBox();
			assert.ok(
				enlarged && enlarged.width > initial.width + 100 && enlarged.height < initial.height - 100
			);
			await resize(proposal, 'bottom-left', -45, 45);
			const resized = await proposal.boundingBox();
			assert.ok(
				resized && resized.width > enlarged.width + 30 && resized.height > enlarged.height + 30
			);
			assert.equal(evaluations, count);
			await page.screenshot({ path: path.join(output, 'proposal-resized-desktop.png') });
			return { initial, resized, evaluations: count };
		}
	);
	await check('Escape cancels resizing; keyboard resizing and Home restore defaults', async () => {
		const before = await proposal.boundingBox();
		assert.ok(before);
		await resize(proposal, 'left', 80, 0, true);
		const after = await proposal.boundingBox();
		assert.ok(after && Math.abs(before.width - after.width) < 2);
		const left = proposal.locator('.window-resize-handle[data-edge="left"]');
		await left.focus();
		await page.keyboard.press('ArrowRight');
		assert.ok((await boxOf(proposal)).width < before.width - 10);
		await page.keyboard.press('Home');
		await expect(proposal).toHaveAttribute('data-resized', 'false');
		assert.equal(
			await page.evaluate(() => localStorage.getItem('vela:panel-size:v1:map-proposal')),
			null
		);
		await resize(proposal, 'left', -130, 0);
		await resize(proposal, 'bottom', 0, -130);
	});
	await check('Panel resize clamps to minimum and maximum viewport-safe dimensions', async () => {
		await resize(proposal, 'left', 1800, 0);
		assert.ok(Math.abs((await boxOf(proposal)).width - 360) < 2);
		await resize(proposal, 'left', -1800, 0);
		assert.ok(Math.abs((await boxOf(proposal)).width - 640) < 2);
		await resize(proposal, 'bottom', 0, -1800);
		assert.ok(Math.abs((await boxOf(proposal)).height - 460) < 2);
		await resize(proposal, 'bottom', 0, 1800);
		const box = await proposal.boundingBox();
		assert.ok(box && box.y >= 0 && box.y + box.height <= 1000 - 10);
		await proposal.locator('.window-resize-handle[data-edge="left"]').focus();
		await page.keyboard.press('Home');
		await resize(proposal, 'left', -130, 0);
		await resize(proposal, 'bottom', 0, -130);
	});
	await check('Proposal size persists across close, reopen and a fresh page load', async () => {
		const saved = await proposal.boundingBox();
		assert.ok(saved);
		await proposal
			.getByRole('button', { name: 'Close island planning panel', exact: true })
			.click();
		await expect(proposal).toHaveCount(0);
		await openProposal();
		await expect
			.poll(async () => Math.abs((await boxOf(proposal)).width - saved.width))
			.toBeLessThan(2);
		await page.reload({ waitUntil: 'domcontentloaded' });
		await expect(atlas).toHaveAttribute('aria-busy', 'false');
		if (!(await proposal.isVisible())) await openProposal();
		await expect
			.poll(async () => Math.abs((await boxOf(proposal)).width - saved.width))
			.toBeLessThan(2);
		await expect
			.poll(async () => Math.abs((await boxOf(proposal)).height - saved.height))
			.toBeLessThan(2);
		const stored = await page.evaluate(() =>
			localStorage.getItem('vela:panel-size:v1:map-proposal')
		);
		assert.ok(stored, 'The proposal window dimensions must have been saved.');
		const size = JSON.parse(stored);
		assert.ok(size.width >= 360 && size.width <= 640);
		return size;
	});
	await check(
		'Map controls move clear of resized panels and weather remembers its own size',
		async () => {
			const panelBox = await proposal.boundingBox();
			const zoom = page.getByRole('button', { name: 'Zoom in', exact: true });
			if (await zoom.isVisible()) {
				const box = await zoom.boundingBox();
				assert.ok(box && panelBox && box.x + box.width <= panelBox.x);
			}
			await proposal
				.getByRole('button', { name: 'Close island planning panel', exact: true })
				.click();
			await page.getByRole('button', { name: 'Weather & traffic', exact: true }).click();
			await expect(weather).toBeVisible();
			await resize(weather, 'left', -70, 0);
			const saved = await weather.boundingBox();
			assert.ok(saved);
			await weather.getByRole('button', { name: 'Close weather and traffic', exact: true }).click();
			await expect(weather).toHaveCount(0);
			await page.getByRole('button', { name: 'Weather & traffic', exact: true }).click();
			await expect
				.poll(async () => Math.abs((await boxOf(weather)).width - saved.width))
				.toBeLessThan(2);
			const values = await page.evaluate(() =>
				['map-proposal', 'map-conditions'].map((key) =>
					localStorage.getItem(`vela:panel-size:v1:${key}`)
				)
			);
			assert.ok(values[0] && values[1] && values[0] !== values[1]);
		}
	);
	await check(
		'Saved desktop window sizes yield to mobile layouts with no handles or overflow',
		async () => {
			await weather.getByRole('button', { name: 'Close weather and traffic', exact: true }).click();
			await page.setViewportSize({ width: 375, height: 812 });
			await openProposal();
			await expect(proposal.locator('.window-resize-handle')).toHaveCount(0);
			await noOverflow();
			await aligned(nav, '[aria-current="page"]');
			await page.screenshot({ path: path.join(output, 'proposal-mobile.png') });
			await proposal
				.getByRole('button', { name: 'Close island planning panel', exact: true })
				.click();
			await page.getByRole('button', { name: 'Weather & traffic', exact: true }).click();
			await expect(weather.locator('.window-resize-handle')).toHaveCount(0);
			await noOverflow();
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
