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
const mapDock = page.getByTestId('map-controls-dock');
const navigation = page.getByRole('navigation', { name: 'Workspace', exact: true });
const searchRoot = page.getByTestId('map-search');
const search = page.getByTestId('map-search-input');
const searchScope = page.getByTestId('map-search-scope');
const dropdown = searchRoot.locator('.scoped-search-dropdown');
const results = searchRoot.locator('#island-search-results[role="listbox"]');

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

async function anchoredDropdown() {
	await expect(dropdown).toBeVisible();
	await expect(results).toBeVisible();
	await expect(search).toBeFocused();
	await expect(search).toHaveAttribute('aria-expanded', 'true');
	const popup = await fullyVisible(dropdown, 'Scoped search dropdown');
	const anchor = await fullyVisible(searchRoot, 'Scoped search field');
	const viewport = page.viewportSize();
	assert.ok(viewport);
	assert.ok(
		popup.width <= Math.min(Math.max(440, anchor.width), viewport.width - 16) + 1,
		'Search stays within its responsive field width'
	);
	assert.ok(popup.height < viewport.height * 0.83, 'Search does not become a full-height panel');
	assert.ok(
		popup.y >= anchor.y + anchor.height - 1 && popup.y - (anchor.y + anchor.height) <= 20,
		'Search opens directly beneath its field'
	);
	await expect(page.locator('.island-search-sheet')).toHaveCount(0);
	await expect(
		page.getByRole('dialog', { name: 'Find an island or atoll', exact: true })
	).toHaveCount(0);
	await noOverflow();
	return { popup, anchor };
}

async function islandControls() {
	await expect(atlas).toHaveAttribute('data-accessibility-overview', 'false');
	await expect(atlas).toHaveAttribute('aria-busy', 'false');
	const viewport = page.viewportSize();
	assert.ok(viewport);
	await fullyVisible(navigation, 'Floating navigation');
	const searchBounds = await fullyVisible(searchRoot, 'Scoped island search');
	assert.ok(searchBounds.y < 140, 'Search is close to the top of the map');
	await clickable(search, 'Search input');
	await expect(searchScope).toBeVisible();
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
	assert.ok(bottom['Island location'].height <= 120, 'Collapsed island score stays compact');
	const scoreTypography = await location.locator('.score-number strong').evaluate((node) => {
		const style = getComputedStyle(node);
		return {
			size: Number.parseFloat(style.fontSize),
			weight: Number.parseInt(style.fontWeight, 10)
		};
	});
	assert.ok(scoreTypography.size >= 40, 'The compact score keeps a large number');
	assert.ok(scoreTypography.weight >= 750, 'The compact score keeps its bold number');
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
	const actions = page.getByRole('group', { name: 'Explore selected island', exact: true });
	const actionBounds = await fullyVisible(actions, 'Map header actions');
	await expect(actions.getByRole('button')).toHaveCount(2);
	for (const button of await actions.getByRole('button').all()) {
		const name = (await button.innerText()).trim();
		await clickable(button, name);
		const bounds = await button.boundingBox();
		assert.ok(bounds);
		assert.ok(
			bounds.x >= actionBounds.x - 1 &&
				bounds.y >= actionBounds.y - 1 &&
				bounds.x + bounds.width <= actionBounds.x + actionBounds.width + 1 &&
				bounds.y + bounds.height <= actionBounds.y + actionBounds.height + 1,
			`${name} fits completely inside the map header actions`
		);
	}
	/** @type {Array<[string, import('@playwright/test').Locator]>} */
	const dockGroups = [
		['Service coverage', mapDock.getByLabel('Service coverage map', { exact: true })],
		['Map key', mapDock.locator('.map-information-card')],
		['Map layers and view', mapDock.locator('.map-toolbar')]
	];
	await expect(mapDock).toHaveCount(1);
	const dockBounds = await fullyVisible(mapDock, 'Unified map controls dock');
	for (const [name, element] of dockGroups) {
		await expect(element).toHaveCount(1);
		const bounds = await fullyVisible(element, name);
		assert.ok(
			bounds.x >= dockBounds.x - 1 &&
				bounds.y >= dockBounds.y - 1 &&
				bounds.x + bounds.width <= dockBounds.x + dockBounds.width + 1 &&
				bounds.y + bounds.height <= dockBounds.y + dockBounds.height + 1,
			`${name} belongs inside the unified map controls dock`
		);
	}
	await separateControls(dockGroups);
	await separateControls([
		['Unified map controls dock', mapDock],
		['Compact island score', page.locator('.policy-map-controls')]
	]);
	await separateControls([
		['Search field', searchRoot],
		['Map header actions', actions],
		['Workspace navigation', navigation]
	]);
	let chrome;
	if (viewport.width === 1440) {
		const searchDock = await fullyVisible(page.locator('.map-search-dock'), 'Top search dock');
		const nav = await fullyVisible(navigation, 'Workspace navigation');
		assert.ok(Math.abs(searchDock.y - nav.y) <= 2, 'Search and navigation share a top baseline');
		assert.ok(
			Math.abs(searchDock.height - nav.height) <= 2,
			'Search and navigation share a height'
		);
		assert.ok(
			nav.x - (searchDock.x + searchDock.width) >= 12,
			'Search and navigation keep a clear gap'
		);
		chrome = { searchDock, navigation: nav };
	}
	await noOverflow();
	return {
		search: searchBounds,
		bottom,
		dock: dockBounds,
		scoreTypography,
		chrome,
		removedMapClutter: true
	};
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
	const islandOption = results.locator(
		`[role="option"][data-search-kind="island"][data-island-id="${target.id}"]`
	);

	// This suite exercises local journey controls; the sea-network suite covers the default layer.
	await page.goto(`${baseURL}/?view=map&scope=country&sea=0`, { waitUntil: 'domcontentloaded' });
	await check('Country search opens beneath the input and Escape keeps input focus', async () => {
		const explorer = page.getByRole('region', { name: 'Accessibility explorer', exact: true });
		await expect(explorer).toHaveAttribute('aria-busy', 'false');
		await expect(atlas).toHaveAttribute('aria-busy', 'false');
		const controls = await separateControls([
			['Country layers and view', atlas.locator('.map-toolbar')]
		]);
		await explorer.getByRole('button', { name: 'Find an island', exact: true }).press('Enter');
		const boxes = await anchoredDropdown();
		await expect(searchScope).toHaveCount(0);
		await expect(search).toHaveAttribute('aria-label', 'Search islands and atolls');
		await expect(
			results.locator('[data-search-kind="island"]').first().locator('strong')
		).not.toHaveText(/^Unnamed island/i);
		await page.screenshot({ path: path.join(output, 'country-search-desktop.png') });
		await search.press('Escape');
		await expect(dropdown).not.toBeVisible();
		await expect(search).toBeFocused();
		await expect(search).toHaveAttribute('aria-expanded', 'false');
		return { ...boxes, controls };
	});
	await check('Country and atoll shortcuts focus the same search field', async () => {
		const explorer = page.getByRole('region', { name: 'Accessibility explorer', exact: true });
		await explorer.getByRole('button', { name: 'Find out why', exact: true }).click();
		await expect(explorer).toHaveAttribute('data-expanded', 'true');
		const countrySearch = explorer.getByRole('button', { name: 'Find an island', exact: true });
		await countrySearch.click();
		const countryBoxes = await anchoredDropdown();
		await page.screenshot({ path: path.join(output, 'country-expanded-search-desktop.png') });
		await search.press('Escape');
		await expect(search).toBeFocused();
		await explorer.locator('[data-atoll]').filter({ hasText: target.atoll }).click();
		await expect(explorer).toHaveAttribute('data-scope', 'atoll');
		await countrySearch.click();
		const atollBoxes = await anchoredDropdown();
		await expect(dropdown.locator('.scoped-search-heading')).toContainText(
			`Islands in ${target.atoll}`
		);
		await page.screenshot({ path: path.join(output, 'atoll-search-desktop.png') });
		await search.press('Escape');
		await expect(dropdown).not.toBeVisible();
		await expect(search).toBeFocused();
		await explorer.getByRole('button', { name: 'Back to Maldives', exact: true }).click();
		await expect(explorer).toHaveAttribute('data-scope', 'country');
		return { country: countryBoxes, atoll: atollBoxes };
	});
	await check('Explorer atoll changes replace a local All atolls search override', async () => {
		const explorer = page.getByRole('region', { name: 'Accessibility explorer', exact: true });
		await explorer.getByRole('button', { name: 'Find out why', exact: true }).click();
		await expect(explorer).toHaveAttribute('data-expanded', 'true');
		await explorer.locator('[data-atoll]').filter({ hasText: target.atoll }).click();
		await search.click();
		await dropdown.getByRole('button', { name: 'All atolls', exact: true }).click();
		await expect(dropdown.locator('.scoped-search-heading')).toContainText('Explore the Maldives');
		await search.press('Escape');
		await explorer.getByRole('button', { name: 'Back to Maldives', exact: true }).click();
		await explorer.getByRole('button', { name: 'Find out why', exact: true }).click();
		await expect(explorer).toHaveAttribute('data-expanded', 'true');
		const nextAtollRow = explorer
			.locator('[data-atoll]')
			.filter({ hasNotText: target.atoll })
			.first();
		const nextAtoll = await nextAtollRow.getAttribute('data-atoll');
		assert.ok(nextAtoll && nextAtoll !== target.atoll, 'A different real explorer atoll exists');
		await nextAtollRow.click();
		await expect(explorer).toHaveAttribute('data-scope', 'atoll');
		await expect(page).toHaveURL((url) => url.searchParams.get('atoll') === nextAtoll);
		// Click the input directly: Find an island would reset the filter and hide the regression.
		await search.click();
		await expect(dropdown.locator('.scoped-search-heading')).toContainText(
			`Islands in ${nextAtoll}`
		);
		await expect(searchScope).toHaveCount(0);
		await search.press('Escape');
		await explorer.getByRole('button', { name: 'Back to Maldives', exact: true }).click();
		await expect(explorer).toHaveAttribute('data-scope', 'country');
		await expect(page).toHaveURL(
			(url) => !url.searchParams.has('atoll') && !url.searchParams.has('island')
		);
		return { previousAtoll: target.atoll, nextAtoll, restoredScope: 'country' };
	});
	await check(
		'Global search selects a real atoll, clears its filter and selects an island by keyboard',
		async () => {
			const explorer = page.getByRole('region', { name: 'Accessibility explorer', exact: true });
			await explorer.getByRole('button', { name: 'Find an island', exact: true }).click();
			await search.fill(target.atoll);
			await results
				.locator('[role="option"][data-search-kind="atoll"]')
				.filter({ hasText: target.atoll })
				.first()
				.click();
			await expect(dropdown).not.toBeVisible();
			await expect(explorer).toHaveAttribute('data-scope', 'atoll');
			await explorer.getByRole('button', { name: 'Find an island', exact: true }).click();
			await expect(search).toBeFocused();
			await expect(dropdown.locator('.scoped-search-heading')).toContainText(
				`Islands in ${target.atoll}`
			);
			await search.fill('  hulhumal  ');
			await expect(islandOption).toBeVisible();
			await expect(results.locator('[data-search-kind="island"]')).toHaveCount(1);
			await search.fill('__no_matching_island_for_qa__');
			await expect(dropdown.getByText('No islands or atolls found', { exact: true })).toBeVisible();
			await expect(results.getByRole('option')).toHaveCount(0);
			await searchRoot.getByRole('button', { name: 'Clear search', exact: true }).click();
			await expect(search).toHaveValue('');
			await dropdown.getByRole('button', { name: 'All atolls', exact: true }).click();
			await expect
				.poll(() => results.locator('[data-search-kind="island"]').count())
				.toBeGreaterThan(1);
			await search.fill('hulhumal');
			await search.press('ArrowDown');
			await expect(islandOption).toHaveAttribute('aria-selected', 'true');
			await expect(search).toBeFocused();
			const activeId = await islandOption.getAttribute('id');
			assert.ok(activeId);
			await expect(search).toHaveAttribute('aria-activedescendant', activeId);
			await search.press('ArrowUp');
			await expect(search).toBeFocused();
			await search.press('Enter');
			await expect(dropdown).not.toBeVisible();
			await expect(searchScope).toHaveAttribute('data-island-id', target.id);
			await expect(page).toHaveURL((url) => url.searchParams.get('island') === target.id);
			await expect(atlas).toHaveAttribute('data-accessibility-overview', 'false');
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-zoom')))
				.toBeGreaterThan(11);
			return { selectedIsland: target.id, atoll: target.atoll };
		}
	);
	await check('Desktop keeps scoped search and header actions clear of map controls', async () => {
		const boxes = await islandControls();
		await page.screenshot({ path: path.join(output, 'island-controls-desktop.png') });
		return boxes;
	});
	await check('Opening island overview keeps the unified coverage controls available', async () => {
		await page.getByTestId('island-score-toggle').click();
		const panel = page.locator('.policy-map-panel[data-policy-section="needs"]');
		await expect(panel).toBeVisible();
		await expect(page.locator('.policy-map-controls')).toHaveCount(0);
		const lens = mapDock.getByLabel('Service coverage map', { exact: true });
		await fullyVisible(lens, 'Coverage controls beside island overview');
		const selector = lens.getByRole('combobox', { name: 'Service coverage', exact: true });
		if (await selector.isVisible()) {
			await selector.selectOption('transport');
		} else {
			await lens.getByRole('button', { name: 'Transport', exact: true }).click();
		}
		await expect(atlas).toHaveAttribute('data-policy-lens', 'transport');
		if (await selector.isVisible()) {
			await selector.selectOption('overall');
		} else {
			await lens.getByRole('button', { name: 'All services', exact: true }).click();
		}
		await expect(atlas).toHaveAttribute('data-policy-lens', 'overall');
		await page.screenshot({ path: path.join(output, 'island-overview-controls-desktop.png') });
		await panel.getByRole('button', { name: 'Close island planning panel', exact: true }).click();
		await expect(panel).toHaveCount(0);
		await expect(page.getByTestId('island-score-toggle')).toBeVisible();
		return { coverageRemainsInteractive: true };
	});
	await check(
		'Proposal editing hides the duplicate header action and closing restores it',
		async () => {
			const actions = page.getByRole('group', { name: 'Explore selected island', exact: true });
			const proposalAction = actions.locator('.map-header-proposal');
			await expect(proposalAction).toBeVisible();
			await proposalAction.click();
			const editor = page.locator('.policy-map-panel[data-policy-section="proposal"]');
			await expect(editor).toBeVisible();
			await expect(proposalAction).toBeHidden();
			await expect(actions.getByRole('button', { name: /^(Create|Edit) proposal$/ })).toHaveCount(
				0
			);
			await expect(actions.getByRole('button', { name: 'Directions', exact: true })).toBeVisible();
			await page.screenshot({ path: path.join(output, 'proposal-header-actions-desktop.png') });
			await editor
				.getByRole('button', { name: 'Close island planning panel', exact: true })
				.click();
			await expect(editor).toHaveCount(0);
			await expect(proposalAction).toBeVisible();
			await expect(actions.getByRole('button', { name: /^(Create|Edit) proposal$/ })).toHaveCount(
				1
			);
			return { hiddenWhileEditing: true, restoredAfterClose: true };
		}
	);
	await check('Scoped search stays anchored and dismisses on Escape or a map click', async () => {
		await search.click();
		const boxes = await anchoredDropdown();
		await page.screenshot({ path: path.join(output, 'island-search-desktop.png') });
		await atlas.locator('.maplibregl-canvas').click({ position: { x: 1100, y: 350 } });
		await expect(dropdown).not.toBeVisible();
		const closePopup = atlas.locator('.maplibregl-popup-close-button');
		if (await closePopup.isVisible()) await closePopup.click();
		await search.click();
		await expect(search).toBeFocused();
		await search.press('Escape');
		await expect(dropdown).not.toBeVisible();
		await expect(search).toBeFocused();
		return boxes;
	});
	for (const viewport of [
		{ width: 820, height: 1180, name: 'tablet' },
		{ width: 680, height: 900, name: 'narrow-tablet' },
		{ width: 390, height: 844, name: 'mobile' },
		{ width: 320, height: 812, name: 'compact-mobile' }
	]) {
		await check(`${viewport.name} keeps controls usable and scoped search compact`, async () => {
			await page.setViewportSize({ width: viewport.width, height: viewport.height });
			const controls = await islandControls();
			await page.screenshot({ path: path.join(output, `island-controls-${viewport.name}.png`) });
			await search.click();
			const searchBoxes = await anchoredDropdown();
			await searchRoot.getByRole('button', { name: 'Remove island filter', exact: true }).click();
			await expect(searchScope).toHaveCount(0);
			await expect(page).toHaveURL((url) => url.searchParams.get('island') === target.id);
			await search.fill('hulhumal');
			await expect(islandOption).toBeVisible();
			await page.screenshot({ path: path.join(output, `island-search-${viewport.name}.png`) });
			await search.press('Escape');
			await expect(dropdown).not.toBeVisible();
			await expect(search).toBeFocused();
			await atlas.getByRole('button', { name: 'Show all Maldives islands', exact: true }).click();
			const explorer = page.getByRole('region', { name: 'Accessibility explorer', exact: true });
			await expect(explorer).toHaveAttribute('aria-busy', 'false');
			const countrySearch = explorer.getByRole('button', { name: 'Find an island', exact: true });
			await countrySearch.click();
			const countrySearchBoxes = await anchoredDropdown();
			await page.screenshot({ path: path.join(output, `country-search-${viewport.name}.png`) });
			await search.press('Escape');
			await explorer.getByRole('button', { name: 'Find out why', exact: true }).click();
			await expect(explorer).toHaveAttribute('data-expanded', 'true');
			await countrySearch.click();
			const expandedSearchBoxes = await anchoredDropdown();
			await page.screenshot({
				path: path.join(output, `country-expanded-search-${viewport.name}.png`)
			});
			await search.press('Escape');
			await explorer.locator('[data-atoll]').filter({ hasText: target.atoll }).click();
			await expect(explorer).toHaveAttribute('data-scope', 'atoll');
			await countrySearch.click();
			const atollSearchBoxes = await anchoredDropdown();
			await expect(dropdown.locator('.scoped-search-heading')).toContainText(
				`Islands in ${target.atoll}`
			);
			await page.screenshot({ path: path.join(output, `atoll-search-${viewport.name}.png`) });
			await search.fill('hulhumal');
			await islandOption.click();
			await expect(dropdown).not.toBeVisible();
			await expect(searchScope).toHaveAttribute('data-island-id', target.id);
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
	await check(
		'Map controls and scoped search complete without browser runtime errors',
		async () => {
			assert.deepEqual(report.pageErrors, []);
			return { errors: report.pageErrors.length };
		}
	);
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
