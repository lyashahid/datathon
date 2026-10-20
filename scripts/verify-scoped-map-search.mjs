import { browserBaseURL } from './browser-config.mjs';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Exercise real catalogue and mapped-place records through the retained national map.
// A separately named provider-contract scenario replaces only its unique QA queries.
// Run against an already-started frontend/backend.
const baseURL = browserBaseURL();
const output = path.resolve('artifacts/qa/scoped-search');
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
let activePage = page;

/** @param {import('@playwright/test').Page} target */
function controls(target) {
	return {
		root: target.getByTestId('map-search'),
		input: target.getByTestId('map-search-input'),
		scope: target.getByTestId('map-search-scope'),
		list: target.locator('#island-search-results[role="listbox"]'),
		atlas: target.locator('.national-map'),
		navigation: target.getByRole('navigation', { name: 'Workspace', exact: true })
	};
}

/** @param {import('@playwright/test').Page} target */
function watch(target) {
	target.setDefaultTimeout(60000);
	target.on('pageerror', (error) => report.pageErrors.push(error.message));
}
watch(page);

/** @param {string} name @param {()=>Promise<unknown>} action */
async function check(name, action) {
	console.log(`RUN ${name}`);
	try {
		const detail = await action();
		report.checks.push({ name, status: 'passed', detail });
		console.log(`PASS ${name}`);
	} catch (error) {
		report.checks.push({ name, status: 'failed', detail: String(error) });
		await activePage
			.screenshot({ path: path.join(output, 'failure.png'), fullPage: true })
			.catch(() => {});
		throw error;
	} finally {
		await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
	}
}

/** @param {string} value */
const normalized = (value) =>
	value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9]/gi, '')
		.toLowerCase();

/** @param {import('@playwright/test').Page} target @param {string} islandId */
async function openIsland(target, islandId) {
	await target.goto(`${baseURL}/?view=map&island=${encodeURIComponent(islandId)}`, {
		waitUntil: 'domcontentloaded'
	});
	const ui = controls(target);
	await expect(ui.atlas).toBeVisible();
	await expect(ui.atlas).toHaveAttribute('aria-busy', 'false');
	await expect(ui.atlas).toHaveAttribute('data-active', 'true');
	await expect(ui.input).toBeVisible();
	await expect(ui.input).toHaveAttribute('role', 'combobox');
	await expect(ui.scope).toHaveAttribute('data-island-id', islandId);
	await expect(target).toHaveURL((url) => url.searchParams.get('island') === islandId);
	return ui;
}

/** @param {import('@playwright/test').Page} target */
async function assertNoLegacySearch(target) {
	await expect(target.getByRole('button', { name: 'Find a place', exact: true })).toHaveCount(0);
	await expect(
		target.locator('.places-sheet, .places-workspace, .island-search-popover')
	).toHaveCount(0);
	await expect(
		target.getByRole('dialog', { name: 'Find an island or atoll', exact: true })
	).toHaveCount(0);
	await expect(controls(target).root.locator('input')).toHaveCount(1);
}

/** @param {import('@playwright/test').Page} target */
async function removeScope(target) {
	const ui = controls(target);
	await ui.root.getByRole('button', { name: 'Remove island filter', exact: true }).click();
	await expect(ui.scope).toHaveCount(0);
	await expect(ui.input).toHaveAttribute('aria-label', 'Search islands and atolls');
	return ui;
}

/** @param {import('@playwright/test').Page} target @param {string} query */
async function typeSearch(target, query) {
	const ui = controls(target);
	await ui.input.click();
	await ui.input.fill(query);
	await expect(ui.list).toBeVisible();
	await expect(ui.input).toHaveAttribute('aria-expanded', 'true');
	return ui;
}

/** @param {import('@playwright/test').Locator} element @param {string} name @param {import('@playwright/test').Page} target */
async function visibleBounds(element, name, target) {
	await expect(element).toBeVisible();
	const box = await element.boundingBox();
	const viewport = target.viewportSize();
	assert.ok(box && viewport, `${name} has rendered bounds`);
	assert.ok(box.x >= -1 && box.y >= -1, `${name} starts inside the viewport`);
	assert.ok(
		box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
		`${name} fits inside the viewport: ${JSON.stringify(box)}`
	);
	return box;
}

/** @param {{x:number,y:number,width:number,height:number}} first @param {{x:number,y:number,width:number,height:number}} second */
function overlaps(first, second) {
	return (
		Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x) > 1 &&
		Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y) > 1
	);
}

/** @param {import('@playwright/test').Page} target */
async function searchLayout(target) {
	const ui = controls(target);
	const input = await visibleBounds(ui.input, 'Search input', target);
	const list = await visibleBounds(ui.list, 'Search dropdown', target);
	const navigation = await visibleBounds(ui.navigation, 'Workspace navigation', target);
	assert.ok(input.width >= 60, 'The scope tag leaves usable space for typing');
	assert.ok(!overlaps(input, navigation), 'Search input and navigation do not overlap');
	assert.ok(!overlaps(list, navigation), 'Search dropdown and navigation do not overlap');
	assert.ok(list.y >= input.y + input.height - 1, 'Results open beneath the actual input');
	assert.equal(
		await ui.input.evaluate((element) => {
			const box = element.getBoundingClientRect();
			return element.contains(
				document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
			);
		}),
		true,
		'The input is not covered by another header control'
	);
	await expect
		.poll(() => target.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
		.toBe(true);
	return { input, list, navigation };
}

/** @param {import('@playwright/test').Page} target */
async function clickOutsideSearch(target) {
	const point = await controls(target)
		.atlas.locator('.maplibregl-canvas')
		.evaluate((canvas) => {
			const box = canvas.getBoundingClientRect();
			for (const yFraction of [0.55, 0.7, 0.4]) {
				for (const xFraction of [0.5, 0.7, 0.35]) {
					const x = box.x + box.width * xFraction;
					const y = box.y + box.height * yFraction;
					if (document.elementFromPoint(x, y) === canvas) return { x, y };
				}
			}
			throw new Error('No unobscured map canvas is available for the outside click.');
		});
	await target.mouse.click(point.x, point.y);
	await expect(controls(target).list).not.toBeVisible();
}

try {
	const islandsResponse = await page.request.get(
		`${baseURL}/api/backend/map/features?layer=islands`
	);
	assert.equal(islandsResponse.status(), 200, 'The real island catalogue is available');
	/** @type {{features:Array<{properties:{id:string,name:string,atoll?:string,centroid?:[number,number]}} >}} */
	const islands = await islandsResponse.json();
	const hulhumale = islands.features.find(
		(feature) => normalized(feature.properties.name ?? '') === 'hulhumale'
	)?.properties;
	const hulhule = islands.features.find(
		(feature) => normalized(feature.properties.name ?? '') === 'hulhule'
	)?.properties;
	const male = islands.features.find(
		(feature) => normalized(feature.properties.name ?? '') === 'male'
	)?.properties;
	assert.ok(
		hulhumale && hulhule && hulhumale.id !== hulhule.id,
		'Both distinct capital islands exist'
	);
	const atolls = [
		...new Set(islands.features.map((feature) => feature.properties.atoll).filter(Boolean))
	];
	const targetAtoll =
		atolls.find((name) => normalized(name ?? '') === 'baa') ??
		atolls.find((name) => name !== hulhumale.atoll);
	assert.ok(targetAtoll, 'A real atoll is available for the global search');
	const placesResponse = await page.request.get(
		`${baseURL}/api/backend/map/features?layer=all&island_id=${encodeURIComponent(hulhumale.id)}`
	);
	assert.equal(placesResponse.status(), 200, 'The island mapped-place inventory is available');
	/** @type {{features:Array<{id?:string,geometry:{type:string,coordinates?:unknown}|null,properties:{id?:string,name?:string,island_id?:string,category?:string,geometry_quality?:string,tags?:Record<string,string>}} >}} */
	const places = await placesResponse.json();
	const candidate = places.features
		.filter(
			(feature) =>
				feature.properties.island_id === hulhumale.id &&
				feature.geometry?.type === 'Point' &&
				feature.properties.geometry_quality !== 'island_context_only' &&
				feature.properties.name?.trim() &&
				/school|clinic|hospital|bus_stop/i.test(feature.properties.category ?? '') &&
				(feature.id || feature.properties.id)
		)
		.sort(
			(first, second) =>
				Number(!/school|clinic|hospital/i.test(first.properties.category ?? '')) -
					Number(!/school|clinic|hospital/i.test(second.properties.category ?? '')) ||
				(first.properties.name ?? '').localeCompare(second.properties.name ?? '')
		)[0];
	assert.ok(
		candidate?.properties.name,
		'A named real mapped school, clinic, hospital or bus stop exists'
	);
	const sourcePlace = {
		id: String(candidate.id ?? candidate.properties.id),
		name: candidate.properties.name,
		islandId: hulhumale.id,
		geometry: candidate.geometry,
		category: candidate.properties.category
	};
	await writeFile(path.join(output, 'source-place.json'), JSON.stringify(sourcePlace, null, 2));

	await check(
		'One actual scoped input replaces separate place search and the legacy modal',
		async () => {
			const ui = await openIsland(page, hulhumale.id);
			await expect(ui.scope).toContainText(hulhumale.name);
			await expect(ui.input).toHaveAttribute('aria-label', `Search places in ${hulhumale.name}`);
			await assertNoLegacySearch(page);
			return { island: hulhumale, sourcePlace };
		}
	);
	await check(
		'Real mapped place results stay on the island and select the retained NationalMap',
		async () => {
			const ui = await typeSearch(page, sourcePlace.name);
			const result = ui.list
				.locator('[role="option"][data-search-kind="place"]')
				.filter({ hasText: sourcePlace.name })
				.first();
			await expect(result).toBeVisible();
			await expect
				.poll(() =>
					ui.list.getByRole('option').evaluateAll((options) =>
						options.map((option) => ({
							kind: option.getAttribute('data-search-kind'),
							island: option.getAttribute('data-island-id')
						}))
					)
				)
				.toEqual(expect.arrayContaining([{ kind: 'place', island: hulhumale.id }]));
			const options = await ui.list.getByRole('option').evaluateAll((nodes) =>
				nodes.map((node) => ({
					id: node.getAttribute('data-search-id'),
					kind: node.getAttribute('data-search-kind'),
					island: node.getAttribute('data-island-id')
				}))
			);
			assert.ok(
				options.length > 0 &&
					options.every((option) => option.kind === 'place' && option.island === hulhumale.id),
				'Every scoped result is an island place'
			);
			const selectedId = await result.getAttribute('data-search-id');
			assert.ok(selectedId, 'The result carries its mapped/provider identity');
			await result.click();
			await expect(ui.list).not.toBeVisible();
			await expect(ui.atlas).toHaveAttribute('data-search-place', selectedId);
			await expect(ui.atlas).toHaveAttribute('data-active', 'true');
			await expect(page).toHaveURL((url) => url.searchParams.get('island') === hulhumale.id);
			await assertNoLegacySearch(page);
			await page.screenshot({ path: path.join(output, 'desktop-place-selected.png') });
			return { sourcePlace, selectedId, options };
		}
	);
	await check(
		'Real mapped English aliases find places whose displayed name uses Divehi',
		async () => {
			const aliasPlace = places.features.find(
				(feature) =>
					feature.properties.island_id === hulhumale.id &&
					feature.geometry?.type === 'Point' &&
					feature.properties.geometry_quality !== 'island_context_only' &&
					feature.properties.tags?.['name:en']?.trim() &&
					feature.properties.name !== feature.properties.tags['name:en'] &&
					/school/i.test(feature.properties.category ?? '') &&
					(feature.id || feature.properties.id)
			);
			assert.ok(aliasPlace, 'The real inventory includes a mapped school with an English alias');
			const alias = aliasPlace.properties.tags?.['name:en'];
			assert.ok(alias);
			const id = String(aliasPlace.properties.id ?? aliasPlace.id);
			const ui = await typeSearch(page, alias);
			await expect(
				ui.list.locator(`[data-search-kind="place"][data-search-id="${id}"]`)
			).toBeVisible();
			await ui.input.press('Escape');
			return { id, alias, displayName: aliasPlace.properties.name };
		}
	);
	await check(
		'Backspace removes an empty scope without resetting the selected map island',
		async () => {
			const ui = controls(page);
			await ui.input.fill('');
			await ui.input.press('Backspace');
			await expect(ui.scope).toHaveCount(0);
			await expect(ui.input).toHaveAttribute('aria-label', 'Search islands and atolls');
			await expect(page).toHaveURL((url) => url.searchParams.get('island') === hulhumale.id);
			await expect(ui.atlas).toHaveAttribute('data-accessibility-overview', 'false');
			return { selectedIsland: new URL(page.url()).searchParams.get('island') };
		}
	);
	await check(
		'Global island search selects Hulhulé and restores its different scope tag',
		async () => {
			const ui = await typeSearch(page, 'Hulhule');
			const result = ui.list.locator(
				`[role="option"][data-search-kind="island"][data-island-id="${hulhule.id}"]`
			);
			await expect(result).toBeVisible();
			await result.click();
			await expect(ui.scope).toHaveAttribute('data-island-id', hulhule.id);
			await expect(ui.scope).toContainText(hulhule.name);
			await expect(page).toHaveURL((url) => url.searchParams.get('island') === hulhule.id);
			await expect(ui.list).not.toBeVisible();
			return { island: hulhule };
		}
	);
	await check(
		'The tag X restores global mode and an atoll result changes the map scope',
		async () => {
			const ui = await removeScope(page);
			await expect(page).toHaveURL((url) => url.searchParams.get('island') === hulhule.id);
			await typeSearch(page, targetAtoll);
			const result = ui.list
				.locator('[role="option"][data-search-kind="atoll"]')
				.filter({ hasText: targetAtoll })
				.first();
			await expect(result).toBeVisible();
			await result.click();
			await expect(page).toHaveURL(
				(url) => !url.searchParams.has('island') && url.searchParams.get('atoll') === targetAtoll
			);
			await expect(ui.scope).toHaveCount(0);
			await expect(ui.list).not.toBeVisible();
			await page.screenshot({ path: path.join(output, 'desktop-atoll-selected.png') });
			return { atoll: targetAtoll, url: page.url() };
		}
	);
	await check(
		'Arrow keys and Enter select a result; Escape and an outside click dismiss results',
		async () => {
			await controls(page).input.click();
			await controls(page).root.getByRole('button', { name: 'All atolls', exact: true }).click();
			const ui = await typeSearch(page, 'Hulhumale');
			await expect(
				ui.list.locator(`[data-search-kind="island"][data-island-id="${hulhumale.id}"]`)
			).toBeVisible();
			await ui.input.press('ArrowDown');
			await expect(ui.list.locator('[role="option"][aria-selected="true"]')).toHaveCount(1);
			await expect(ui.input).toHaveAttribute('aria-activedescendant', /\S+/);
			const downActive = await ui.input.getAttribute('aria-activedescendant');
			assert.equal(
				await ui.list.locator('[role="option"][aria-selected="true"]').getAttribute('id'),
				downActive,
				'ArrowDown exposes the highlighted option through the combobox active descendant'
			);
			await ui.input.press('ArrowUp');
			await expect(ui.list.locator('[role="option"][aria-selected="true"]')).toHaveCount(1);
			await ui.input.press('Enter');
			await expect(ui.scope).toHaveAttribute('data-island-id', hulhumale.id);
			await expect(page).toHaveURL((url) => url.searchParams.get('island') === hulhumale.id);
			await typeSearch(page, sourcePlace.name);
			await ui.input.press('Escape');
			await expect(ui.list).not.toBeVisible();
			await expect(ui.input).toBeFocused();
			await typeSearch(page, sourcePlace.name);
			await clickOutsideSearch(page);
			return { keyboardSelection: hulhumale.id, escapeDismissed: true, outsideDismissed: true };
		}
	);

	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 320, height: 740 }
	]) {
		await check(
			`Scoped and global dropdowns fit the ${viewport.width}px mobile header`,
			async () => {
				const mobileContext = await browser.newContext({
					viewport,
					isMobile: true,
					hasTouch: true,
					reducedMotion: 'reduce'
				});
				const mobile = await mobileContext.newPage();
				activePage = mobile;
				watch(mobile);
				try {
					const ui = await openIsland(mobile, hulhumale.id);
					await assertNoLegacySearch(mobile);
					await typeSearch(mobile, sourcePlace.name);
					await expect(ui.list.locator('[data-search-kind="place"]').first()).toBeVisible();
					const scoped = await searchLayout(mobile);
					await visibleBounds(ui.scope, 'Island scope tag', mobile);
					await mobile.screenshot({
						path: path.join(output, `mobile-${viewport.width}-scoped.png`)
					});
					await ui.input.press('Escape');
					await expect(ui.list).not.toBeVisible();
					await removeScope(mobile);
					await typeSearch(mobile, 'Hulhule');
					const global = await searchLayout(mobile);
					const result = ui.list.locator(
						`[data-search-kind="island"][data-island-id="${hulhule.id}"]`
					);
					await expect(result).toBeVisible();
					await mobile.screenshot({
						path: path.join(output, `mobile-${viewport.width}-global.png`)
					});
					await result.click();
					await expect(ui.scope).toHaveAttribute('data-island-id', hulhule.id);
					await expect(mobile).toHaveURL((url) => url.searchParams.get('island') === hulhule.id);
					return { viewport, scoped, global };
				} finally {
					activePage = page;
					await mobileContext.close();
				}
			}
		);
	}
	await check(
		'Explicit provider contract: island boundary filtering, stale cancellation and error recovery',
		async () => {
			const ui = await openIsland(page, hulhumale.id);
			const inside = sourcePlace.geometry?.coordinates;
			const outside = male?.centroid;
			assert.ok(
				Array.isArray(inside) && inside.length === 2 && inside.every(Number.isFinite),
				'The provider fixture reuses a real mapped Hulhumalé coordinate'
			);
			assert.ok(
				outside?.length === 2 && outside.every(Number.isFinite),
				'The outside provider fixture uses the real Malé centroid'
			);
			const queries = {
				boundary: 'ScopedSearchQA boundary',
				stale: 'ScopedSearchQA delayed',
				current: 'ScopedSearchQA current',
				error: 'ScopedSearchQA retry'
			};
			const fixtureQueries = new Set(Object.values(queries));
			/** @type {Array<{query:string,attempt:number}>} */
			const requests = [];
			let releaseStale = () => {};
			/** @type {Promise<void>} */
			const staleGate = new Promise((resolve) => {
				releaseStale = resolve;
			});
			let staleFinished = false;
			let staleDeliveryError = null;
			let errorAttempts = 0;
			/** @param {string} id @param {string} name @param {number[]} coordinates */
			const providerPlace = (id, name, coordinates) => ({
				id,
				name,
				category: 'clinic',
				location: { longitude: coordinates[0], latitude: coordinates[1] }
			});
			/** @param {string} query @param {ReturnType<typeof providerPlace>[]} places */
			const envelope = (query, places) => ({
				data: { query, places, next_offset: null, completeness: 'qa_contract_fixture' },
				meta: {
					request_id: `qa-${normalized(query)}`,
					provider: 'explicit browser QA fixture',
					calibration_version: 1,
					cached: false,
					warnings: []
				}
			});
			/** @param {URL} url */
			const matchesFixture = (url) =>
				url.pathname === '/api/backend/places/search' &&
				fixtureQueries.has(url.searchParams.get('query') ?? '');
			/** @param {import('@playwright/test').Route} route */
			const provideFixture = async (route) => {
				const query = new URL(route.request().url()).searchParams.get('query') ?? '';
				const attempt = requests.filter((request) => request.query === query).length + 1;
				requests.push({ query, attempt });
				if (query === queries.stale) {
					await staleGate;
					try {
						await route.fulfill({
							json: envelope(query, [
								providerPlace('qa-stale', 'ScopedSearchQA delayed clinic', inside)
							])
						});
					} catch (error) {
						// Aborting the previous query can close its request before this deliberate release.
						staleDeliveryError = String(error);
					} finally {
						staleFinished = true;
					}
					return;
				}
				if (query === queries.error && ++errorAttempts === 1) {
					await route.fulfill({
						status: 503,
						json: { error: { code: 'qa_provider_unavailable', message: 'Deliberate QA outage' } }
					});
					return;
				}
				const places =
					query === queries.boundary
						? [
								providerPlace('qa-inside', 'ScopedSearchQA boundary clinic', inside),
								providerPlace('qa-outside', 'ScopedSearchQA boundary outside clinic', outside)
							]
						: [
								providerPlace(
									query === queries.current ? 'qa-current' : 'qa-recovered',
									`${query} clinic`,
									inside
								)
							];
				await route.fulfill({ json: envelope(query, places) });
			};
			await page.route(matchesFixture, provideFixture);
			try {
				await typeSearch(page, queries.boundary);
				const accepted = ui.list.locator('[data-search-id="qa-inside"]');
				await expect(accepted).toBeVisible();
				await expect(accepted).toHaveAttribute('data-island-id', hulhumale.id);
				await expect(ui.list.getByRole('option')).toHaveCount(1);
				await expect(ui.list.locator('[data-search-id="qa-outside"]')).toHaveCount(0);
				await typeSearch(page, queries.stale);
				await expect
					.poll(() => requests.some((request) => request.query === queries.stale))
					.toBe(true);
				await expect(ui.root.getByRole('status')).toContainText('Finding places on this island');
				await typeSearch(page, queries.current);
				await expect(ui.list.locator('[data-search-id="qa-current"]')).toBeVisible();
				releaseStale();
				await expect.poll(() => staleFinished).toBe(true);
				await page.evaluate(
					() =>
						new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
				);
				await expect(ui.list.locator('[data-search-id="qa-stale"]')).toHaveCount(0);
				await expect(ui.list.locator('[data-search-id="qa-current"]')).toBeVisible();
				await expect(ui.list.getByRole('option')).toHaveCount(1);
				await typeSearch(page, queries.error);
				await expect(ui.root.getByRole('status')).toContainText('More places couldn’t load.');
				await ui.root.getByRole('button', { name: 'Retry', exact: true }).click();
				await expect(ui.list.locator('[data-search-id="qa-recovered"]')).toBeVisible();
				await expect(ui.root.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
				assert.equal(errorAttempts, 2, 'Retry issues one fresh request after the deliberate error');
				await page.screenshot({ path: path.join(output, 'provider-contract-recovered.png') });
				return { fixture: true, inside, outside, requests, staleDeliveryError, errorAttempts };
			} finally {
				releaseStale();
				await page.unroute(matchesFixture, provideFixture);
			}
		}
	);
	await check('All scoped search flows finish without browser runtime errors', async () => {
		assert.deepEqual(report.pageErrors, []);
		return { errors: report.pageErrors.length };
	});
} catch (error) {
	report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
	process.exitCode = 1;
} finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
	await browser.close();
	console.log(JSON.stringify(report, null, 2));
}
