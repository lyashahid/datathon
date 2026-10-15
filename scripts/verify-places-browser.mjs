import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// This verification reads real frontend/backend responses and public source data.
// It never replaces provider responses or changes the policy baseline. Notice
// verification creates one clearly labeled QA example and dismisses it afterward.
const baseURL = process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5173';
const output = path.resolve('artifacts/qa/places-operations');
const expect = playwrightExpect.configure({ timeout: 30000 });
await mkdir(output, { recursive: true });
/** @type {{baseURL: string, startedAt: string, finishedAt?: string, checks: Array<{name: string, status: string, milliseconds: number, details?: unknown, message?: string}>, pageErrors: string[]}} */
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], pageErrors: [] };
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1000 },
	reducedMotion: 'reduce',
	acceptDownloads: true
});
context.setDefaultTimeout(60000);
const page = await context.newPage();
page.on('pageerror', (error) => report.pageErrors.push(error.message));

/** @param {string} name @param {() => Promise<unknown>} work */
async function check(name, work) {
	const started = Date.now();
	console.log(`RUN ${name}`);
	try {
		const details = await work();
		report.checks.push({ name, status: 'passed', milliseconds: Date.now() - started, details });
		console.log(`PASS ${name}`);
	} catch (error) {
		report.checks.push({
			name,
			status: 'failed',
			milliseconds: Date.now() - started,
			message: error instanceof Error ? error.message : String(error)
		});
		throw error;
	}
}

/** @param {string} fragment */
function responseFor(fragment) {
	const pending = page.waitForResponse(
		(response) => response.url().includes(`/api/backend/${fragment}`),
		{
			timeout: 90000
		}
	);
	pending.catch(() => {});
	return pending;
}

/** @param {string} screen */
async function noOverflow(screen) {
	await expect
		.poll(() =>
			page.evaluate(
				() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
			)
		)
		.toBe(true);
	const dimensions = await page.evaluate(() => ({
		viewport: document.documentElement.clientWidth,
		document: document.documentElement.scrollWidth,
		body: document.body.scrollWidth
	}));
	if (dimensions.document > dimensions.viewport + 1 || dimensions.body > dimensions.viewport + 1) {
		const elements = await page.evaluate(() =>
			[...document.querySelectorAll('body *')]
				.map((element) => ({
					tag: element.tagName,
					className: element.className,
					text: element.textContent?.slice(0, 80),
					left: element.getBoundingClientRect().left,
					right: element.getBoundingClientRect().right,
					width: element.getBoundingClientRect().width
				}))
				.filter((element) => element.width > 0 && element.right > innerWidth + 1)
		);
		await page.screenshot({ path: path.join(output, 'overflow-failure.png'), fullPage: true });
		await writeFile(path.join(output, 'overflow.json'), JSON.stringify(elements, null, 2));
	}
	assert.ok(
		dimensions.document <= dimensions.viewport + 1 && dimensions.body <= dimensions.viewport + 1,
		`${screen} overflows: ${JSON.stringify(dimensions)}`
	);
	return dimensions;
}

try {
	await page.goto(`${baseURL}/?view=explore&explorer=places`, { waitUntil: 'domcontentloaded' });
	const workspace = page.locator('.places-workspace');
	await expect(workspace.getByRole('heading', { name: 'Understand a place.' })).toBeVisible();
	await expect(workspace.getByText('Vela connected', { exact: true })).toBeVisible();
	// Root coverage loading selects its island and updates the shared scope.
	await expect.poll(() => new URL(page.url()).searchParams.get('island')).toBeTruthy();

	await check('real place search and suggestion controls', async () => {
		const search = responseFor('places/search?');
		await workspace.locator('#place-query').fill('hospital');
		await workspace.getByRole('button', { name: 'Search', exact: true }).click();
		const searchResponse = await search;
		assert.equal(searchResponse.status(), 200);
		const body = await searchResponse.json();
		assert.ok(body.data.places.length > 0);
		await expect(workspace.locator('.place-result').first()).toBeVisible();
		const suggestion = responseFor('places/suggest?');
		await workspace.getByRole('button', { name: 'Suggestions', exact: true }).click();
		const suggestResponse = await suggestion;
		assert.equal(suggestResponse.status(), 200);
		await expect(workspace.getByRole('heading', { name: 'Suggested searches' })).toBeVisible();
		return { places: body.data.places.length, completeness: body.data.completeness };
	});

	await check('exact listing details and real image proxy', async () => {
		const details = responseFor('places/details');
		const listing = workspace.locator('.place-result').first();
		const expectedName = await listing.locator('.place-copy strong').innerText();
		await listing.click();
		const detailResponse = await details;
		assert.equal(detailResponse.status(), 200);
		const body = await detailResponse.json();
		assert.equal(body.data.name, expectedName);
		await expect(workspace.getByText('Identity matched', { exact: true })).toBeVisible();
		const photos = responseFor('places/photos?');
		await workspace.getByRole('button', { name: 'Load photos', exact: true }).click();
		const photoResponse = await photos;
		assert.equal(photoResponse.status(), 200);
		const photoBody = await photoResponse.json();
		assert.ok(photoBody.data.photos.length > 0);
		const image = workspace.locator('.photo-grid img').first();
		await image.scrollIntoViewIfNeeded();
		await expect(image).toBeVisible();
		await expect
			.poll(() => image.evaluate((img) => (img instanceof HTMLImageElement ? img.naturalWidth : 0)))
			.toBeGreaterThan(0);
		await page.screenshot({ path: path.join(output, 'places-desktop.png'), fullPage: true });
		return { name: body.data.name, photos: photoBody.data.photos.length };
	});

	await check('selected-place walking and traffic-aware driving', async () => {
		await workspace.getByRole('button', { name: 'Route to this place', exact: true }).click();
		await expect(workspace.getByRole('tab', { name: 'Directions', exact: true })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		const walking = responseFor('places/directions');
		await workspace.getByRole('button', { name: 'Find directions', exact: true }).click();
		const walkingResponse = await walking;
		assert.equal(walkingResponse.status(), 200);
		/** @type {import('../src/lib/places').ConsumerEnvelope<import('../src/lib/places').ConsumerDirections>} */
		const walkingBody = await walkingResponse.json();
		assert.ok(
			walkingBody.data.routes.some((route) => (route.geometry?.coordinates?.length ?? 0) > 1)
		);
		await workspace.locator('#place-route-mode').selectOption('driving');
		const driving = responseFor('places/directions');
		await workspace.getByRole('button', { name: 'Find directions', exact: true }).click();
		const drivingResponse = await driving;
		assert.equal(drivingResponse.status(), 200);
		/** @type {import('../src/lib/places').ConsumerEnvelope<import('../src/lib/places').ConsumerDirections>} */
		const drivingBody = await drivingResponse.json();
		await expect(workspace.locator('.route-card').first()).toBeVisible();
		const download = page.waitForEvent('download');
		await workspace.getByRole('button', { name: 'Export GeoJSON', exact: true }).first().click();
		const exported = await download;
		await exported.saveAs(path.join(output, 'actual-driving-route.geojson'));
		await page.screenshot({ path: path.join(output, 'directions-desktop.png'), fullPage: true });
		return {
			walkingRoutes: walkingBody.data.routes.length,
			drivingRoutes: drivingBody.data.routes.length,
			trafficDurations: drivingBody.data.routes.map((route) => route.traffic_seconds)
		};
	});

	await check('390px place research and direction layout', async () => {
		await page.setViewportSize({ width: 390, height: 844 });
		await noOverflow('directions');
		await page.screenshot({ path: path.join(output, 'directions-mobile.png'), fullPage: true });
		await workspace.getByRole('tab', { name: 'Discover places', exact: true }).click();
		await noOverflow('discover');
		const mobileDetails = responseFor('places/details');
		await workspace.locator('.place-result').first().click();
		assert.equal((await mobileDetails).status(), 200);
		await expect
			.poll(() =>
				workspace.locator('.detail-card').evaluate((card) => card.getBoundingClientRect().top)
			)
			.toBeLessThan(160);
		await page.screenshot({ path: path.join(output, 'places-mobile-selection.png') });
		await page.screenshot({ path: path.join(output, 'places-mobile.png'), fullPage: true });
		await workspace.getByRole('tab', { name: 'Street View', exact: true }).click();
		await noOverflow('streetview');
		await page.screenshot({ path: path.join(output, 'streetview-mobile.png'), fullPage: true });
		return { width: 390, tabs: ['discover', 'directions', 'streetview'] };
	});

	await check('full API documentation through same-origin proxy', async () => {
		const docs = await page.request.get(`${baseURL}/api/backend/places/docs`);
		assert.equal(docs.status(), 200);
		assert.match(await docs.text(), /\/api\/backend\/places\/openapi\.json/);
		const schema = await page.request.get(`${baseURL}/api/backend/places/openapi.json`);
		assert.equal(schema.status(), 200);
		const body = await schema.json();
		assert.equal(body.servers[0].url, '/api/backend/places');
		assert.ok(body.paths['/directions'] && body.paths['/image'] && body.paths['/reviews']);
		return { endpointPaths: Object.keys(body.paths).length };
	});

	await check('real operating forecasts and explicit provider receipt', async () => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		await page.goto(`${baseURL}/?view=live&context=conditions`, {
			waitUntil: 'domcontentloaded'
		});
		const operations = page.locator('.operations-workspace');
		await expect(
			operations.getByRole('heading', { name: 'Conditions that shape the journey.' })
		).toBeVisible();
		await expect.poll(() => new URL(page.url()).searchParams.get('island')).toBeTruthy();
		const update = operations.getByRole('button', { name: 'Update forecast', exact: true });
		await expect(update).toBeEnabled();
		const weather = responseFor('conditions/weather?');
		const marine = responseFor('conditions/marine?');
		await update.click();
		const [weatherResponse, marineResponse] = await Promise.all([weather, marine]);
		const weatherBody = await weatherResponse.json();
		const marineBody = await marineResponse.json();
		if (weatherResponse.ok() && marineResponse.ok()) {
			await expect(operations.locator('.receipt').first()).toBeVisible();
			assert.equal(weatherBody.receipt.data_kind, 'model_forecast');
			await expect(operations.locator('.chart')).toContainText('hourly model forecast');
		} else {
			await expect(operations.getByRole('alert')).toBeVisible();
		}
		await expect(update).toBeEnabled();
		await page.screenshot({ path: path.join(output, 'conditions-desktop.png'), fullPage: true });
		return {
			weatherStatus: weatherResponse.status(),
			marineStatus: marineResponse.status(),
			weatherDataStatus: weatherBody.status,
			marineDataStatus: marineBody.status,
			qualification: weatherBody.receipt?.qualification
		};
	});

	await check('shared traffic route and mobile notice review entry', async () => {
		const operations = page.locator('.operations-workspace');
		await operations.getByRole('tab', { name: 'Live traffic', exact: true }).click();
		await expect(
			operations.getByRole('button', { name: 'Check traffic-aware routes', exact: false })
		).toBeEnabled();
		const traffic = responseFor('conditions/traffic');
		await operations
			.getByRole('button', { name: 'Check traffic-aware routes', exact: false })
			.click();
		const trafficResponse = await traffic;
		assert.equal(trafficResponse.status(), 200);
		const trafficBody = await trafficResponse.json();
		assert.ok(trafficBody.data.routes.length > 0);
		await expect(operations.getByRole('table')).toBeVisible();
		await page.setViewportSize({ width: 390, height: 844 });
		await noOverflow('operating traffic');
		await page.screenshot({ path: path.join(output, 'traffic-mobile.png'), fullPage: true });
		await operations.getByRole('tab', { name: /Public notices/ }).click();
		await expect(operations.getByLabel('Public source URL', { exact: true })).toBeVisible();
		await noOverflow('notice import/review');
		await page.screenshot({ path: path.join(output, 'notices-mobile.png'), fullPage: true });
		return {
			routes: trafficBody.data.routes.length,
			notices: 'review entry inspected without mutation'
		};
	});

	await check('audited QA notice import, review, proposal handoff and dismissal', async () => {
		const operations = page.locator('.operations-workspace');
		const islandId = new URL(page.url()).searchParams.get('island');
		const baselineUrl = `${baseURL}/api/backend/planning/baseline?island_id=${encodeURIComponent(islandId || '')}`;
		const baselineBefore = await (await page.request.get(baselineUrl)).json();
		/** @type {{id: string, name?: string} | undefined} */
		const facility =
			baselineBefore.facilities.find(
				/** @param {{id: string, name?: string, kind?: string}} item */ (item) =>
					item.kind === 'hospital' || /hospital/i.test(item.name || '')
			) ?? baselineBefore.facilities[0];
		assert.ok(facility, 'The actual scoped planning snapshot must supply a verified facility.');
		const title = `QA example — interface verification only — ${new Date().toISOString()}`;
		const notes =
			'QA EXAMPLE ONLY. Simulated closure for interface verification; never a real operational alert.';
		/** @type {string | undefined} */
		let noticeId;
		let dismissed = false;
		try {
			await operations.locator('#notice-url').fill('https://rtl.mv/qa/interface-verification');
			await operations.locator('#notice-title').fill(title);
			await operations
				.locator('#notice-text')
				.fill(
					`QA EXAMPLE ONLY: ${facility.name || facility.id} is temporarily closed during a simulated maintenance exercise. This is test text, not an operational alert. Verification run: ${title}.`
				);
			const ingest = responseFor('operations/notices/ingest');
			await operations.getByRole('button', { name: 'Import notice', exact: true }).click();
			const ingestResponse = await ingest;
			assert.equal(ingestResponse.status(), 200);
			const candidate = await ingestResponse.json();
			noticeId = candidate.id;
			assert.equal(candidate.status, 'candidate');
			assert.equal(candidate.receipt.input_method, 'user_supplied_text');
			assert.equal(candidate.proposed_operation, null);
			await operations.locator('#notice-kind').selectOption('disable_facility');
			await operations.locator('#notice-target').fill(facility.id);
			await operations.locator('#review-notes').fill(notes);
			const fromValue = await operations.getByLabel('Effective from · MVT').inputValue();
			const untilValue = await operations.getByLabel('Valid until · MVT').inputValue();
			const review = responseFor(`operations/notices/${encodeURIComponent(noticeId || '')}/review`);
			await operations.getByRole('button', { name: 'Approve mapping', exact: true }).click();
			const reviewedResponse = await review;
			assert.equal(reviewedResponse.status(), 200);
			const reviewed = await reviewedResponse.json();
			assert.equal(reviewed.status, 'approved');
			assert.equal(reviewed.proposed_operation.target_id, facility.id);
			assert.equal(reviewed.proposed_operation.metadata.notice_id, noticeId);
			await noOverflow('mobile reviewed notice');
			await page.screenshot({
				path: path.join(output, 'notice-reviewed-mobile.png'),
				fullPage: true
			});
			await operations.getByRole('button', { name: 'Use in proposal', exact: true }).click();
			const intervention = page
				.locator('.policy-operation-row')
				.filter({ hasText: `Reviewed notice ${noticeId}` });
			await expect(intervention).toBeVisible();
			await expect(intervention).toContainText(facility.id);
			await page.screenshot({
				path: path.join(output, 'notice-proposal-handoff-mobile.png'),
				fullPage: true
			});
			await intervention.getByRole('button', { name: /Remove intervention/ }).click();
			await expect(intervention).toHaveCount(0);
			await page
				.getByRole('navigation', { name: 'Workspace', exact: true })
				.getByRole('button', { name: 'Map & planning', exact: true })
				.click();
			await page
				.getByRole('tablist', { name: 'Map workspace tools' })
				.getByRole('tab', { name: 'Live', exact: true })
				.click();
			await page.getByRole('tab', { name: 'Weather, traffic & notices', exact: true }).click();
			await operations.getByRole('tab', { name: /Public notices/ }).click();
			await operations
				.locator('.notice-list')
				.getByRole('button', { name: new RegExp('QA example — interface verification only') })
				.filter({ hasText: title })
				.click();
			await expect(operations.locator('#notice-target')).toHaveValue(facility.id);
			await expect(operations.locator('#review-notes')).toHaveValue(notes);
			await expect(operations.getByLabel('Effective from · MVT')).toHaveValue(fromValue);
			await expect(operations.getByLabel('Valid until · MVT')).toHaveValue(untilValue);
			const dismissal = responseFor(
				`operations/notices/${encodeURIComponent(noticeId || '')}/review`
			);
			await operations.getByRole('button', { name: 'Dismiss', exact: true }).click();
			const dismissedResponse = await dismissal;
			assert.equal(dismissedResponse.status(), 200);
			const final = await dismissedResponse.json();
			assert.equal(final.status, 'dismissed');
			assert.equal(final.proposed_operation, null);
			dismissed = true;
			await expect(
				operations.getByRole('button', { name: 'Use in proposal', exact: true })
			).toHaveCount(0);
			assert.deepEqual(await (await page.request.get(baselineUrl)).json(), baselineBefore);
			return {
				noticeId,
				facilityId: facility.id,
				inputMethod: candidate.receipt.input_method,
				proposalHandoff: true,
				finalStatus: final.status,
				baselineUnchanged: true
			};
		} finally {
			if (noticeId && !dismissed) {
				const cleanup = await page.request.post(
					`${baseURL}/api/backend/operations/notices/${encodeURIComponent(noticeId)}/review`,
					{ data: { decision: 'dismissed', notes: `${notes} Cleanup after QA verification.` } }
				);
				assert.equal(cleanup.status(), 200, 'QA example cleanup must succeed.');
			}
		}
	});

	await check('mounted operating workspace follows a real island selection', async () => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		const operations = page.locator('.operations-workspace');
		await operations.getByRole('tab', { name: 'Weather & sea', exact: true }).click();
		const beforeLatitude = Number(await operations.locator('#conditions-lat').inputValue());
		await page
			.getByRole('navigation', { name: 'Workspace', exact: true })
			.getByRole('button', { name: 'Map & planning', exact: true })
			.click();
		await page
			.getByRole('tablist', { name: 'Map workspace tools' })
			.getByRole('tab', { name: 'Explore', exact: true })
			.click();
		await page.getByRole('tab', { name: 'Island & streets', exact: true }).click();
		await page.getByRole('button', { name: /Find an island or atoll/ }).click();
		await page.getByRole('textbox', { name: 'Search islands', exact: true }).fill('Hithadhoo');
		const island = page
			.locator('.island-list button')
			.filter({ hasText: 'Hithadhoo' })
			.filter({ hasText: 'Seenu' })
			.first();
		await expect(island).toBeVisible();
		const weather = responseFor('conditions/weather?');
		const marine = responseFor('conditions/marine?');
		await island.click();
		const [weatherResponse, marineResponse] = await Promise.all([weather, marine]);
		assert.equal(weatherResponse.status(), 200);
		const requested = new URL(weatherResponse.url());
		const selectedLatitude = Number(requested.searchParams.get('latitude'));
		assert.ok(
			selectedLatitude < 0 && beforeLatitude > 0,
			'Forecast requests must change from Malé to the actual southern island.'
		);
		await page
			.getByRole('navigation', { name: 'Workspace', exact: true })
			.getByRole('button', { name: 'Map & planning', exact: true })
			.click();
		await page
			.getByRole('tablist', { name: 'Map workspace tools' })
			.getByRole('tab', { name: 'Live', exact: true })
			.click();
		await page.getByRole('tab', { name: 'Weather, traffic & notices', exact: true }).click();
		await expect(operations.locator('.scope')).toContainText('Hithadhoo');
		assert.equal(
			Number(await operations.locator('#conditions-lat').inputValue()),
			selectedLatitude
		);
		const body = await weatherResponse.json();
		await expect(operations.locator('.receipt').first()).toBeVisible();
		await operations.getByRole('tab', { name: 'Live traffic', exact: true }).click();
		await expect(operations.getByRole('table')).toHaveCount(0);
		await page.screenshot({
			path: path.join(output, 'operating-island-switch-desktop.png'),
			fullPage: true
		});
		return {
			islandId: new URL(page.url()).searchParams.get('island'),
			requestedLatitude: selectedLatitude,
			requestedLongitude: Number(requested.searchParams.get('longitude')),
			sourceGrid: body.grid,
			weatherStatus: weatherResponse.status(),
			marineStatus: marineResponse.status(),
			oldTrafficCleared: true
		};
	});
	assert.deepEqual(report.pageErrors, []);
} finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
	await browser.close();
}
