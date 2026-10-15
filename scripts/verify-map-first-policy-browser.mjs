import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const baseURL = process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5173';
const output = path.resolve('artifacts/qa/map-first-policy');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 60000 });
/** @type {{name:string,status:string,detail?:unknown}[]} */
const checks = [];
/** @type {string[]} */
const errors = [];
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
	viewport: { width: 1600, height: 1100 },
	reducedMotion: 'reduce'
});
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.on('pageerror', (error) => errors.push(error.message));
/** @param {string} name @param {()=>Promise<unknown>} work */
async function check(name, work) {
	console.log(`RUN ${name}`);
	const detail = await work();
	checks.push({ name, status: 'passed', detail });
	console.log(`PASS ${name}`);
}
try {
	await page.goto(`${baseURL}/?view=map&tool=proposals&proposal=policy&island=island%3A1443`);
	const workbench = page.getByRole('region', { name: 'Policy planning workbench' });
	const map = page.getByRole('region', { name: 'Interactive proposal map' });
	const inspector = page.locator('#policy-inspector');
	const baseline = await (
		await page.request.get(`${baseURL}/api/backend/planning/baseline?island_id=island%3A1443`)
	).json();
	await check('Clean proposal canvas opens without a form and has one full-width map', async () => {
		await expect(map).toBeVisible();
		await expect
			.poll(async () => Number(await map.getAttribute('data-rendered-hexes')))
			.toBeGreaterThan(0);
		await expect(inspector).toBeHidden();
		await expect(map.locator('.planning-map-key')).toContainText(/street features/);
		assert.equal(await page.locator('.maplibregl-canvas:visible').count(), 1);
		const widths = await page.locator('.policy-map-layout').evaluate((element) => ({
			stage: element.clientWidth,
			map: element.querySelector('.planning-map')?.clientWidth
		}));
		assert.ok(widths.map !== undefined && widths.map >= widths.stage - 3);
		await page.screenshot({ path: path.join(output, 'clean-canvas-desktop.png'), fullPage: false });
		return { sourceOrigins: baseline.origins.length, fullWidth: true };
	});
	await check('Drag a school onto the map and prepare the placed location in context', async () => {
		await map.getByRole('button', { name: 'Hospital', exact: true }).click();
		await expect(inspector).toBeVisible();
		await expect(map.locator('.planning-preview')).toBeVisible();
		await workbench.getByRole('button', { name: 'Hide details', exact: true }).click();
		await expect(inspector).toBeHidden();
		const pin = map.locator('.planning-preview');
		const bounds = await pin.boundingBox();
		assert.ok(bounds);
		const canvas = map.locator('.maplibregl-canvas');
		const canvasBounds = await canvas.boundingBox();
		assert.ok(canvasBounds);
		await map.getByRole('button', { name: 'School', exact: true }).dragTo(canvas, {
			targetPosition: {
				x: bounds.x + bounds.width / 2 - canvasBounds.x,
				y: bounds.y + bounds.height + 2 - canvasBounds.y
			}
		});
		await expect(inspector).toBeVisible();
		await expect(page.locator('#policy-operation')).toHaveValue('add_school');
		await expect(map.locator('.planning-preview')).toContainText('New community school');
		await expect(page.locator('#policy-goal')).toHaveValue('education');
		await page.locator('#policy-name').fill('Map-first QA community school');
		await workbench.getByRole('button', { name: 'Add intervention', exact: true }).click();
		await expect.poll(async () => Number(await map.getAttribute('data-draft-features'))).toBe(1);
		return { dragAndDrop: true, intervention: 'add_school', evaluationGoal: 'education' };
	});
	let evaluation;
	await check(
		'Recalculate a committed school against the actual backend and review its impact',
		async () => {
			const pending = page.waitForResponse(
				(response) =>
					response.url().includes('/planning/evaluate') && response.request().method() === 'POST'
			);
			await map.getByRole('button', { name: 'Recalculate map impact', exact: true }).click();
			const response = await pending;
			assert.equal(response.status(), 200, await response.text());
			evaluation = await response.json();
			await expect(map).toHaveAttribute('data-status', 'latest');
			await expect(inspector).toContainText('Review resident impact');
			assert.equal(evaluation.origins.length, baseline.origins.length);
			await expect(workbench.locator('.policy-area-id').first()).toContainText(/Malé · Area \d+/);
			assert.ok(
				!(await workbench.locator('.policy-area-id').allTextContents()).some((text) =>
					text.includes('wp:')
				)
			);
			await map.getByText('Map key and source evidence', { exact: true }).click();
			await expect(map.getByLabel('Resident impact legend')).toBeVisible();
			await map.getByText('Map key and source evidence', { exact: true }).click();
			await workbench.getByRole('button', { name: 'Hide details', exact: true }).click();
			await map.getByRole('button', { name: 'Fit plan', exact: true }).click();
			await map.getByRole('button', { name: 'Places', exact: true }).click();
			const canvas = map.locator('.maplibregl-canvas');
			const canvasBox = await canvas.boundingBox();
			assert.ok(canvasBox);
			for (const [x, y] of [
				[0.45, 0.45],
				[0.5, 0.5],
				[0.4, 0.5],
				[0.6, 0.5]
			]) {
				await canvas.click({ position: { x: canvasBox.width * x, y: canvasBox.height * y } });
				if (await inspector.isVisible()) break;
			}
			await expect(map.locator('.planning-map-insight')).toContainText('Selected resident area');
			await expect(inspector).toContainText('Review resident impact');
			await map.getByRole('button', { name: 'Places', exact: true }).click();
			await writeFile(
				path.join(output, 'actual-school-impact.json'),
				JSON.stringify(evaluation, null, 2)
			);
			return {
				comparedOrigins: evaluation.origins.length,
				gainedResidents: evaluation.summary.gained_residents,
				hexSelectionOpensImpact: true,
				sourceBacked: true
			};
		}
	);
	let scopedOriginLabel = '';
	await check(
		'Selecting resident and destination changes map pins and produces outward and return paths',
		async () => {
			await workbench.getByRole('button', { name: '3 · Journeys & returns', exact: true }).click();
			await page.locator('#policy-origin').selectOption(baseline.origins[0].id);
			scopedOriginLabel = (await page.locator('#policy-origin option:checked').textContent()) || '';
			assert.match(scopedOriginLabel, /^Malé · Area \d+ · \d[\d,]* residents$/);
			assert.ok(!scopedOriginLabel.includes('wp:'));
			await expect(map.locator('.planning-pin.start')).toContainText(
				scopedOriginLabel.replace(/ · [\d,]+ residents$/, '')
			);
			const destination = await page
				.locator('#policy-destination option')
				.evaluateAll((options) =>
					options.map((option) => ({
						value: /** @type {HTMLOptionElement} */ (option).value,
						text: option.textContent
					}))
				)
				.then((options) =>
					options.find((option) => option.text?.includes('Map-first QA community school'))
				);
			assert.ok(destination);
			await page.locator('#policy-destination').selectOption(destination.value);
			await expect(map.locator('.planning-pin.start')).toHaveAttribute(
				'data-coordinates',
				`${baseline.origins[0].lon},${baseline.origins[0].lat}`
			);
			await expect(map.locator('.planning-pin.end')).toContainText('Map-first QA community school');
			const startPin = await map.locator('.planning-pin.start').elementHandle();
			const endPin = await map.locator('.planning-pin.end').elementHandle();
			assert.ok(startPin && endPin);
			for (const name of ['Impact tiles', 'Places']) {
				await map.getByRole('button', { name, exact: true }).click();
				await map.getByRole('button', { name, exact: true }).click();
			}
			assert.ok(await startPin.evaluate((element) => element.isConnected));
			assert.ok(await endPin.evaluate((element) => element.isConnected));
			const pending = page.waitForResponse(
				(response) =>
					response.url().includes('/planning/journey') && response.request().method() === 'POST'
			);
			await workbench
				.getByRole('button', { name: 'Calculate outward and return', exact: true })
				.click();
			const response = await pending;
			assert.equal(response.status(), 200, await response.text());
			const journey = await response.json();
			assert.equal(journey.outward.status, 'reachable', JSON.stringify(journey.outward));
			assert.equal(journey.return_journey?.status, 'reachable');
			await expect
				.poll(async () => Number(await map.getAttribute('data-rendered-routes')))
				.toBeGreaterThan(0);
			await expect(map.getByRole('region', { name: 'Simulated journey playback' })).toBeVisible();
			await map.getByRole('button', { name: 'Return', exact: true }).click();
			await expect(map.getByRole('button', { name: 'Return', exact: true })).toHaveAttribute(
				'aria-pressed',
				'true'
			);
			await writeFile(
				path.join(output, 'actual-school-journey.json'),
				JSON.stringify(journey, null, 2)
			);
			await page.screenshot({
				path: path.join(output, 'school-impact-and-journey-desktop.png'),
				fullPage: false
			});
			return {
				outwardMinutes: journey.outward.minutes,
				returnMinutes: journey.return_journey.minutes,
				residentAreaLabel: scopedOriginLabel,
				destinationId: destination.value
			};
		}
	);
	await check(
		'Edit an existing proposal on the map while retaining its ID and invalidating results',
		async () => {
			await workbench.getByRole('button', { name: '1 · Design proposal', exact: true }).click();
			await workbench.getByRole('button', { name: 'Edit intervention 1', exact: true }).click();
			await expect(map.locator('.planning-preview')).toBeVisible();
			const storedBefore = JSON.parse(
				(await page.evaluate(() => localStorage.getItem('policy-workbench-v1:island:1443'))) || '{}'
			);
			const idBefore = storedBefore.operations[0].metadata.proposal_id;
			const previewPin = await map.locator('.planning-preview').elementHandle();
			assert.ok(previewPin);
			await page.locator('#policy-name').fill('Map-first QA school updated');
			await expect(map.locator('.planning-preview')).toContainText('Map-first QA school updated');
			assert.ok(await previewPin.evaluate((element) => element.isConnected));
			await workbench
				.getByRole('button', { name: 'Save intervention changes', exact: true })
				.click();
			await expect(map).toHaveAttribute('data-status', 'stale');
			await expect(map.getByRole('button', { name: 'Play journey preview' })).toBeDisabled();
			const storedAfter = JSON.parse(
				(await page.evaluate(() => localStorage.getItem('policy-workbench-v1:island:1443'))) || '{}'
			);
			assert.equal(storedAfter.operations.length, 1);
			assert.equal(storedAfter.operations[0].metadata.proposal_id, idBefore);
			return { stableProposalId: true, updatedInPlace: true, impactAndJourneyInvalidated: true };
		}
	);
	await check(
		'Moving a preview pin is immediate and a remote site carries a connectivity warning',
		async () => {
			await workbench.getByRole('button', { name: 'Edit intervention 1', exact: true }).click();
			await workbench.getByRole('button', { name: 'Hide details', exact: true }).click();
			const pin = map.locator('.planning-preview');
			const before = await pin.getAttribute('data-coordinates');
			const box = await pin.boundingBox();
			assert.ok(box);
			await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
			await page.mouse.down();
			await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 30, { steps: 8 });
			await page.mouse.up();
			await expect
				.poll(async () => map.locator('.planning-preview').getAttribute('data-coordinates'))
				.not.toBe(before);
			await expect(inspector).toBeVisible();
			await workbench.getByText('Precise coordinates (optional)', { exact: true }).click();
			await page.locator('#policy-lon').fill('73.6');
			await page.locator('#policy-lat').fill('4.3');
			await expect(workbench.locator('.policy-site-warning')).toContainText(
				'may be outside the connected planning area'
			);
			return { draggablePin: true, unconnectedLocationQualified: true };
		}
	);
	await check(
		'Mobile keeps the map visible with a closable and expandable bottom inspector',
		async () => {
			await page.setViewportSize({ width: 390, height: 844 });
			await page.goto(`${baseURL}/?view=map&tool=proposals&proposal=policy&island=island%3A1443`);
			await expect(map.getByRole('button', { name: 'Hospital', exact: true })).toBeVisible();
			await map.getByRole('button', { name: 'Hospital', exact: true }).click();
			await expect(inspector).toBeVisible();
			const compact = await inspector.boundingBox();
			const stage = await page.locator('.policy-map-layout').boundingBox();
			const visibleCanvas = await map.locator('.maplibregl-canvas').boundingBox();
			assert.ok(compact && stage && compact.height < stage.height * 0.57);
			assert.ok(visibleCanvas && visibleCanvas.height >= 250);
			assert.ok(
				compact.y >= 0 && compact.y + compact.height <= 844,
				`Inspector is outside the viewport: ${JSON.stringify(compact)}`
			);
			await page.screenshot({
				path: path.join(output, 'mobile-context-inspector.png'),
				fullPage: false
			});
			await workbench.getByRole('button', { name: 'Expand planning details', exact: true }).click();
			await expect
				.poll(async () => (await inspector.boundingBox())?.height ?? 0)
				.toBeGreaterThan(compact.height + 50);
			await page.screenshot({
				path: path.join(output, 'mobile-expanded-inspector.png'),
				fullPage: false
			});
			await workbench.getByRole('button', { name: 'Close planning details', exact: true }).click();
			await expect(inspector).toBeHidden();
			await expect(map).toBeVisible();
			const canvasBeforeKey = await map.locator('.planning-map-canvas').boundingBox();
			await map.getByText('Map key and source evidence', { exact: true }).click();
			const canvasWithKey = await map.locator('.planning-map-canvas').boundingBox();
			const keyContent = await map.locator('.planning-map-key-content').boundingBox();
			assert.ok(canvasBeforeKey && canvasWithKey && keyContent);
			assert.ok(canvasWithKey.height >= canvasBeforeKey.height - 2);
			assert.ok(keyContent.height <= 151);
			await map.getByText('Map key and source evidence', { exact: true }).click();
			assert.ok(
				await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
			);
			await page.screenshot({
				path: path.join(output, 'clean-canvas-mobile.png'),
				fullPage: false
			});
			return {
				viewport: { width: 390, height: 844 },
				compactInspector: compact,
				canvas: visibleCanvas,
				boundedSourceDisclosure: true,
				bottomInspector: true,
				expandable: true,
				noHorizontalOverflow: true
			};
		}
	);
	await check(
		'Changing island clears hidden endpoints and edits while restoring that island draft',
		async () => {
			await page.setViewportSize({ width: 1600, height: 1100 });
			await page.goto(`${baseURL}/?view=map&tool=proposals&proposal=policy&island=island%3A1443`);
			await expect(map).toBeVisible();
			await workbench.getByRole('button', { name: '3 · Journeys & returns', exact: true }).click();
			const saved = JSON.parse(
				(await page.evaluate(() => localStorage.getItem('policy-workbench-v1:island:1443'))) || '{}'
			);
			const oldDestination = await page
				.locator('#policy-destination option')
				.evaluateAll((options) =>
					options.map((option) => /** @type {HTMLOptionElement} */ (option).value).find(Boolean)
				);
			assert.ok(oldDestination);
			await page.locator('#policy-destination').selectOption(oldDestination);
			await expect(map.locator('.planning-pin.end')).toBeVisible();
			await workbench.getByRole('button', { name: '1 · Design proposal', exact: true }).click();
			await workbench.getByRole('button', { name: 'Edit intervention 1', exact: true }).click();
			await expect(
				workbench.getByRole('button', { name: 'Save intervention changes', exact: true })
			).toBeVisible();
			const nextBaseline = await (
				await page.request.get(`${baseURL}/api/backend/planning/baseline?island_id=island%3A1442`)
			).json();
			const nextDraft = {
				...saved,
				operations: [
					{
						...saved.operations[0],
						name: 'Independent Hulhumalé school draft',
						island_id: nextBaseline.planning_island_id,
						coordinates: [nextBaseline.origins[0].lon, nextBaseline.origins[0].lat],
						metadata: {
							...saved.operations[0].metadata,
							proposal_id: 'proposal:add_school:qa-hulhumale-independent'
						}
					}
				]
			};
			await page.evaluate(
				(value) => localStorage.setItem('policy-workbench-v1:island:1442', JSON.stringify(value)),
				nextDraft
			);
			await page.locator('.workspace-scope').click();
			await page.getByRole('textbox', { name: 'Search islands', exact: true }).fill('Hulhum');
			const switchedBaseline = page.waitForResponse(
				(response) =>
					response.url().includes('/planning/baseline') &&
					new URL(response.url()).searchParams.get('island_id') === 'island:1442'
			);
			await page.locator('[data-island-id="island:1442"]').click();
			assert.equal((await switchedBaseline).status(), 200);
			await expect(map).toBeVisible();
			await expect.poll(async () => Number(await map.getAttribute('data-draft-features'))).toBe(1);
			await expect(map.locator('.planning-preview')).toHaveCount(0);
			await expect(map.locator('.planning-pin.end')).toHaveCount(0);
			await expect(
				workbench.getByRole('button', { name: 'Save intervention changes', exact: true })
			).toHaveCount(0);
			await expect(workbench).toContainText('Independent Hulhumalé school draft');
			await workbench.getByRole('button', { name: '3 · Journeys & returns', exact: true }).click();
			await expect(page.locator('#policy-destination')).toHaveValue('');
			const pending = page.waitForResponse(
				(response) =>
					response.url().includes('/planning/journey') && response.request().method() === 'POST'
			);
			await workbench
				.getByRole('button', { name: 'Calculate outward and return', exact: true })
				.click();
			const response = await pending;
			assert.equal(response.status(), 200, await response.text());
			const body = response.request().postDataJSON();
			assert.equal(body.island_id, 'island:1442');
			assert.equal(body.destination_id, undefined);
			return {
				oldDestinationCleared: true,
				composerClosed: true,
				independentDraftRestored: true,
				newJourneyStatus: response.status()
			};
		}
	);
	await check(
		'An island outside the snapshot can open the full Greater Malé planning area',
		async () => {
			await page.goto(`${baseURL}/?view=map&tool=proposals&proposal=policy&island=island%3A1152`);
			await expect(workbench).toContainText('This island needs a planning dataset.');
			const pending = page.waitForResponse(
				(response) =>
					response.url().includes('/planning/baseline') &&
					new URL(response.url()).searchParams.get('island_id') === ''
			);
			await workbench.getByRole('button', { name: 'Use the Greater Malé planning area' }).click();
			const response = await pending;
			assert.equal(response.status(), 200);
			const fullBaseline = await response.json();
			assert.ok(fullBaseline.origins.length > baseline.origins.length);
			assert.ok(fullBaseline.islands.length >= 3);
			await expect(map).toBeVisible();
			await workbench.getByRole('button', { name: '3 · Journeys & returns', exact: true }).click();
			await page.locator('#policy-origin').selectOption(baseline.origins[0].id);
			assert.equal(
				await page.locator('#policy-origin option:checked').textContent(),
				scopedOriginLabel
			);
			return {
				fallbackScope: '',
				coveredIslands: fullBaseline.islands.map(
					/** @param {{name:string}} island */ (island) => island.name
				),
				sourceOrigins: fullBaseline.origins.length,
				residentLabelsStableAcrossScopes: true
			};
		}
	);
	await check(
		'An in-flight impact calculation cancels when the planning island changes',
		async () => {
			await page.goto(`${baseURL}/?view=map&tool=proposals&proposal=policy&island=island%3A1443`);
			await expect(map).toBeVisible();
			/** @type {(value?:unknown)=>void} */
			let release = () => {};
			/** @type {(value?:unknown)=>void} */
			let captured = () => {};
			const held = new Promise((resolve) => (release = resolve));
			const received = new Promise((resolve) => (captured = resolve));
			const routePattern = '**/api/backend/planning/evaluate';
			await page.route(routePattern, async (route) => {
				if (route.request().postDataJSON().island_id !== 'island:1443') {
					await route.continue();
					return;
				}
				// Delay the actual backend response, without changing its contents.
				const response = await route.fetch();
				assert.equal(response.status(), 200);
				captured();
				await held;
				await route.fulfill({ response }).catch(() => {});
			});
			const canceled = page.waitForEvent('requestfailed', {
				predicate: (request) => request.url().endsWith('/planning/evaluate')
			});
			try {
				await map.getByRole('button', { name: 'Recalculate map impact', exact: true }).click();
				await received;
				await page.locator('.workspace-scope').click();
				await page.getByRole('textbox', { name: 'Search islands', exact: true }).fill('Hulhum');
				await page.locator('[data-island-id="island:1442"]').click();
				const canceledRequest = await canceled;
				assert.match(canceledRequest.failure()?.errorText ?? '', /abort|cancel/i);
				release();
				await expect(
					workbench.getByRole('heading', { name: 'Plan for Hulhumalé.', exact: true })
				).toBeVisible();
				await expect(map).toHaveAttribute('data-status', 'draft');
				await expect(
					map.getByRole('button', { name: 'Recalculate map impact', exact: true })
				).toBeEnabled();
				await expect(workbench.locator('[role="alert"]')).toHaveCount(0);
				return { realResponseDelayed: true, requestCanceled: true, newScopeUsable: true };
			} finally {
				release();
				await page.unroute(routePattern);
			}
		}
	);
	assert.deepEqual(errors, []);
	await writeFile(
		path.join(output, 'report.json'),
		JSON.stringify({ status: 'passed', baseURL, checks, pageErrors: errors }, null, 2)
	);
	console.log(`PASS ${checks.length} map-first policy workflows; no page errors`);
} catch (error) {
	await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
	await writeFile(
		path.join(output, 'report.json'),
		JSON.stringify({ status: 'failed', checks, pageErrors: errors, error: String(error) }, null, 2)
	);
	throw error;
} finally {
	await browser.close();
}
