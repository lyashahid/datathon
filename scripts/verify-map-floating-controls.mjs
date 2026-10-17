import { browserBaseURL } from './browser-config.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Exercise the actual island catalogue and map. No backend responses are replaced.
const baseURL = browserBaseURL();
const output = path.resolve('artifacts/qa/map-floating-controls');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 60000 });
/** @type {{baseURL:string,startedAt:string,finishedAt?:string,checks:Array<{name:string,status:string,detail?:unknown}>,pageErrors:string[],failure?:string}} */
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], pageErrors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1000 },
	reducedMotion: 'reduce'
});
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.on('pageerror', (error) => report.pageErrors.push(error.message));
const atlas = page.locator('.national-map');
const navigation = page.getByRole('navigation', { name: 'Workspace', exact: true });
const dropdown = page.getByRole('dialog', { name: 'Find an island or atoll', exact: true });
const search = dropdown.getByRole('textbox', { name: 'Search islands', exact: true });
const atoll = dropdown.getByRole('combobox', { name: 'Filter by atoll', exact: true });
const islandSearch = page.getByRole('button', { name: 'Find an island or atoll', exact: true });

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

/** @param {import('@playwright/test').Locator} element @param {string} name */
async function fullyVisible(element, name) {
	await expect(element).toBeInViewport();
	const bounds = await element.boundingBox();
	const viewport = page.viewportSize();
	assert.ok(bounds && viewport);
	assert.ok(bounds.x >= -1 && bounds.y >= -1, `${name} starts inside the viewport`);
	assert.ok(
		bounds.x + bounds.width <= viewport.width + 1 &&
			bounds.y + bounds.height <= viewport.height + 1,
		`${name} fits completely inside the viewport`
	);
	return bounds;
}

/** @param {import('@playwright/test').Locator} element @param {string} name */
async function clickable(element, name) {
	await fullyVisible(element, name);
	assert.equal(
		await element.evaluate((node) => {
			const bounds = node.getBoundingClientRect();
			return node.contains(
				document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
			);
		}),
		true,
		`${name} is not covered by another control`
	);
}

async function noOverflow() {
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
		.toBe(true);
}

/** @param {Array<[string, import('@playwright/test').Locator]>} groups */
async function separateControls(groups) {
	const groupBounds = await Promise.all(
		groups.map(async ([name, element]) => ({
			name,
			bounds: await fullyVisible(element, name)
		}))
	);
	for (let first = 0; first < groupBounds.length; first += 1) {
		for (let second = first + 1; second < groupBounds.length; second += 1) {
			const a = groupBounds[first];
			const b = groupBounds[second];
			assert.ok(
				a.bounds.x + a.bounds.width <= b.bounds.x + 1 ||
					b.bounds.x + b.bounds.width <= a.bounds.x + 1 ||
					a.bounds.y + a.bounds.height <= b.bounds.y + 1 ||
					b.bounds.y + b.bounds.height <= a.bounds.y + 1,
				`${a.name} ${JSON.stringify(a.bounds)} and ${b.name} ${JSON.stringify(b.bounds)} do not overlap`
			);
		}
	}
	return groupBounds;
}

/** @param {import('@playwright/test').Locator} trigger */
async function anchoredDropdown(trigger) {
	await expect(dropdown).toBeVisible();
	await expect(search).toBeFocused();
	const popup = await fullyVisible(dropdown, 'Island search dropdown');
	const anchor = await fullyVisible(trigger, 'Island search trigger');
	const viewport = page.viewportSize();
	assert.ok(viewport);
	assert.ok(popup.width <= Math.min(440, viewport.width - 16), 'Search remains a compact dropdown');
	assert.ok(popup.height < viewport.height * 0.83, 'Search does not become a full-height panel');
	assert.ok(
		Math.min(
			Math.abs(popup.y - (anchor.y + anchor.height)),
			Math.abs(anchor.y - (popup.y + popup.height))
		) <= 20,
		'Search opens directly above or below its trigger'
	);
	await expect(page.locator('.island-search-sheet')).toHaveCount(0);
	await noOverflow();
	return { popup, anchor };
}

async function islandControls() {
	await expect(atlas).toHaveAttribute('data-accessibility-overview', 'false');
	await expect(atlas).toHaveAttribute('aria-busy', 'false');
	const viewport = page.viewportSize();
	assert.ok(viewport);
	await fullyVisible(navigation, 'Floating navigation');
	const searchBounds = await fullyVisible(islandSearch, 'Island search');
	assert.ok(searchBounds.y < 140, 'Search is close to the top of the map');
	await clickable(islandSearch, 'Island search');
	for (const name of ['Weather & traffic', 'Sea connections', 'Nationwide schedules'])
		await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
	await expect(page.locator('.movement-settings')).toHaveCount(0);
	await expect(atlas.locator('.maplibregl-ctrl-zoom-in')).toHaveCount(0);
	await expect(atlas.locator('.maplibregl-ctrl-zoom-out')).toHaveCount(0);
	await expect(atlas.locator('.maplibregl-ctrl-scale')).toHaveCount(0);
	const lens = page.getByLabel('Service coverage map', { exact: true });
	const location = page.locator('.policy-inspect-trigger');
	/** @type {Record<string, {x:number,y:number,width:number,height:number}>} */
	const bottom = {};
	/** @type {Array<[string, import('@playwright/test').Locator]>} */
	const controls = [
		['Service coverage', lens],
		['Island location', location]
	];
	for (const [name, element] of controls) {
		const bounds = await fullyVisible(element, name);
		assert.ok(bounds.y > viewport.height * 0.5, `${name} belongs below the map content`);
		bottom[name] = bounds;
	}
	await clickable(location, 'Island details');
	for (const button of await lens.getByRole('button').all())
		await clickable(button, 'Service coverage option');
	const coverageSelect = lens.getByRole('combobox', { name: 'Service coverage', exact: true });
	if (await coverageSelect.isVisible()) {
		await clickable(coverageSelect, 'Service coverage selector');
		await expect(coverageSelect.locator('option')).toHaveCount(4);
		await coverageSelect.selectOption('transport');
		await expect(coverageSelect).toHaveValue('transport');
		await coverageSelect.selectOption('overall');
		await expect(coverageSelect).toHaveValue('overall');
	}
	const actionDock = page.locator('.map-action-dock');
	const dockBounds = await fullyVisible(actionDock, 'Map action dock');
	for (const button of await actionDock.getByRole('button').all()) {
		const name = (await button.innerText()).trim();
		await clickable(button, name);
		const bounds = await button.boundingBox();
		assert.ok(bounds);
		assert.ok(
			bounds.x >= dockBounds.x - 1 &&
				bounds.y >= dockBounds.y - 1 &&
				bounds.x + bounds.width <= dockBounds.x + dockBounds.width + 1 &&
				bounds.y + bounds.height <= dockBounds.y + dockBounds.height + 1,
			`${name} fits completely inside the map action dock`
		);
	}
	/** @type {Array<[string, import('@playwright/test').Locator]>} */
	const lowerGroups = [
		['Service controls', page.locator('.policy-map-controls')],
		['Map key', atlas.locator('.map-information-card')],
		['Map layers and view', atlas.locator('.map-toolbar')],
		['Map actions', actionDock]
	];
	await separateControls(lowerGroups);
	await noOverflow();
	return { search: searchBounds, bottom, removedMapClutter: true };
}

try {
	const response = await page.request.get(`${baseURL}/api/backend/map/features?layer=islands`);
	assert.equal(response.status(), 200);
	/** @type {{features:Array<{properties:{id:string,name:string,atoll:string}}>}} */
	const data = await response.json();
	const target = data.features.find(
		(feature) => feature.properties.id === 'island:1442'
	)?.properties;
	assert.ok(target, 'The real planning island is available');

	await page.goto(`${baseURL}/?view=map&scope=country`, { waitUntil: 'domcontentloaded' });
	await check('Country search opens a compact dropdown and Escape restores focus', async () => {
		const explorer = page.getByRole('region', { name: 'Accessibility explorer', exact: true });
		await expect(explorer).toHaveAttribute('aria-busy', 'false');
		await expect(atlas).toHaveAttribute('aria-busy', 'false');
		const controls = await separateControls([
			['Country layers and view', atlas.locator('.map-toolbar')]
		]);
		const countrySearch = explorer.getByRole('button', { name: 'Find an island', exact: true });
		await countrySearch.press('Enter');
		const boxes = await anchoredDropdown(countrySearch);
		await expect(countrySearch).toHaveAttribute('aria-expanded', 'true');
		await expect(dropdown.locator('[data-island-id]').first().locator('strong')).not.toHaveText(
			/^Unnamed island/i
		);
		await page.screenshot({ path: path.join(output, 'country-search-desktop.png') });
		await page.keyboard.press('Escape');
		await expect(dropdown).not.toBeVisible();
		await expect(countrySearch).toBeFocused();
		await expect(countrySearch).toHaveAttribute('aria-expanded', 'false');
		return { ...boxes, controls };
	});
	await check(
		'Expanded country and atoll views keep search anchored to their visible button',
		async () => {
			const explorer = page.getByRole('region', { name: 'Accessibility explorer', exact: true });
			await explorer.getByRole('button', { name: 'Find out why', exact: true }).click();
			await expect(explorer).toHaveAttribute('data-expanded', 'true');
			const countrySearch = explorer.getByRole('button', { name: 'Find an island', exact: true });
			await countrySearch.click();
			const countryBoxes = await anchoredDropdown(countrySearch);
			await expect(countrySearch).toHaveAttribute('aria-expanded', 'true');
			await page.screenshot({ path: path.join(output, 'country-expanded-search-desktop.png') });
			await page.keyboard.press('Escape');
			await expect(dropdown).not.toBeVisible();
			await expect(countrySearch).toBeFocused();
			await explorer.locator('[data-atoll]').filter({ hasText: target.atoll }).click();
			await expect(explorer).toHaveAttribute('data-scope', 'atoll');
			await countrySearch.click();
			const atollBoxes = await anchoredDropdown(countrySearch);
			await expect(atoll).toHaveValue(target.atoll);
			await page.screenshot({ path: path.join(output, 'atoll-search-desktop.png') });
			await page.keyboard.press('Escape');
			await expect(dropdown).not.toBeVisible();
			await expect(countrySearch).toBeFocused();
			await explorer.getByRole('button', { name: 'Back to Maldives', exact: true }).click();
			await expect(explorer).toHaveAttribute('data-scope', 'country');
			return { country: countryBoxes, atoll: atollBoxes };
		}
	);
	await check(
		'Search filters real islands by name and atoll, explains empty results and clears',
		async () => {
			await page.getByRole('button', { name: 'Find an island', exact: true }).click();
			await expect(search).toBeFocused();
			await atoll.selectOption(target.atoll);
			await search.fill('  hulhumal  ');
			await expect(dropdown.locator(`[data-island-id="${target.id}"]`)).toBeVisible();
			await expect(dropdown.locator('[data-island-id]')).toHaveCount(1);
			await search.fill('__no_matching_island_for_qa__');
			await expect(
				dropdown.getByText('No islands match this search.', { exact: true })
			).toBeVisible();
			await expect(dropdown.locator('[data-island-id]')).toHaveCount(0);
			await dropdown.getByRole('button', { name: 'Clear', exact: true }).click();
			await expect(search).toHaveValue('');
			await expect(atoll).toHaveValue('');
			await expect.poll(() => dropdown.locator('[data-island-id]').count()).toBeGreaterThan(1);
			await atoll.selectOption(target.atoll);
			await search.fill('hulhumal');
			await search.press('ArrowDown');
			await expect(dropdown.locator(`[data-island-id="${target.id}"]`)).toBeFocused();
			await page.keyboard.press('ArrowUp');
			await expect(search).toBeFocused();
			await search.press('Enter');
			await expect(dropdown).not.toBeVisible();
			await expect(page).toHaveURL((url) => url.searchParams.get('island') === target.id);
			await expect(atlas).toHaveAttribute('data-accessibility-overview', 'false');
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-zoom')))
				.toBeGreaterThan(11);
			return { selectedIsland: target.id, atoll: target.atoll };
		}
	);
	await check('Desktop keeps search and map controls clear of removed shortcuts', async () => {
		const boxes = await islandControls();
		await page.screenshot({ path: path.join(output, 'island-controls-desktop.png') });
		return boxes;
	});
	await check('Island search stays anchored and closes when clicking the map', async () => {
		await islandSearch.click();
		const boxes = await anchoredDropdown(islandSearch);
		await page.screenshot({ path: path.join(output, 'island-search-desktop.png') });
		await atlas.locator('.maplibregl-canvas').click({ position: { x: 1100, y: 350 } });
		await expect(dropdown).not.toBeVisible();
		await expect(islandSearch).toBeFocused();
		await islandSearch.click();
		await expect(search).toBeFocused();
		await page.keyboard.press('Escape');
		await expect(dropdown).not.toBeVisible();
		await expect(islandSearch).toBeFocused();
		return boxes;
	});
	for (const viewport of [
		{ width: 820, height: 1180, name: 'tablet' },
		{ width: 680, height: 900, name: 'narrow-tablet' },
		{ width: 390, height: 844, name: 'mobile' },
		{ width: 320, height: 812, name: 'compact-mobile' }
	]) {
		await check(`${viewport.name} keeps controls usable and search compact`, async () => {
			await page.setViewportSize({ width: viewport.width, height: viewport.height });
			const controls = await islandControls();
			await page.screenshot({ path: path.join(output, `island-controls-${viewport.name}.png`) });
			await islandSearch.click();
			const searchBoxes = await anchoredDropdown(islandSearch);
			await search.fill('hulhumal');
			await expect(dropdown.locator(`[data-island-id="${target.id}"]`)).toBeVisible();
			await page.screenshot({ path: path.join(output, `island-search-${viewport.name}.png`) });
			await page.keyboard.press('Escape');
			await expect(dropdown).not.toBeVisible();
			await expect(islandSearch).toBeFocused();
			await atlas.getByRole('button', { name: 'Show all Maldives islands', exact: true }).click();
			const explorer = page.getByRole('region', { name: 'Accessibility explorer', exact: true });
			await expect(explorer).toHaveAttribute('aria-busy', 'false');
			const countrySearch = explorer.getByRole('button', { name: 'Find an island', exact: true });
			await countrySearch.click();
			const countrySearchBoxes = await anchoredDropdown(countrySearch);
			await page.screenshot({ path: path.join(output, `country-search-${viewport.name}.png`) });
			await page.keyboard.press('Escape');
			await expect(dropdown).not.toBeVisible();
			await explorer.getByRole('button', { name: 'Find out why', exact: true }).click();
			await expect(explorer).toHaveAttribute('data-expanded', 'true');
			await countrySearch.click();
			const expandedSearchBoxes = await anchoredDropdown(countrySearch);
			await page.screenshot({
				path: path.join(output, `country-expanded-search-${viewport.name}.png`)
			});
			await page.keyboard.press('Escape');
			await expect(dropdown).not.toBeVisible();
			await explorer.locator('[data-atoll]').filter({ hasText: target.atoll }).click();
			await expect(explorer).toHaveAttribute('data-scope', 'atoll');
			await countrySearch.click();
			const atollSearchBoxes = await anchoredDropdown(countrySearch);
			await page.screenshot({ path: path.join(output, `atoll-search-${viewport.name}.png`) });
			await atoll.selectOption(target.atoll);
			await search.fill('hulhumal');
			await dropdown.locator(`[data-island-id="${target.id}"]`).click();
			await expect(dropdown).not.toBeVisible();
			await expect(page).toHaveURL((url) => url.searchParams.get('island') === target.id);
			return {
				controls,
				search: searchBoxes,
				countrySearch: countrySearchBoxes,
				expandedSearch: expandedSearchBoxes,
				atollSearch: atollSearchBoxes
			};
		});
	}
	await check('Map controls and dropdown complete without browser runtime errors', async () => {
		assert.deepEqual(report.pageErrors, []);
		return { errors: report.pageErrors.length };
	});
} catch (error) {
	report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
	process.exitCode = 1;
	await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
} finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
	await browser.close();
	console.log(JSON.stringify(report, null, 2));
}
