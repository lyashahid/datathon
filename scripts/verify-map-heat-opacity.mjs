import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Drive the native slider and genuine planning actions without injecting application state.
const baseURL = process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5173';
const output = path.resolve('artifacts/qa/map-heat-opacity');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 90000 });
/** @typedef {[number,number]} Coordinates */
/** @typedef {{geometry?:Coordinates[]}} Road */
/** @typedef {{type:'Polygon',coordinates:Coordinates[][]}|{type:'MultiPolygon',coordinates:Coordinates[][][]}} CellGeometry */
/** @typedef {{id?:string,geometry:CellGeometry,properties:{id?:string,contributions?:Array<{origin_id:string,share:number}>}}} Cell */
/** @typedef {{operations:Array<{type:string,coordinates?:Coordinates}>}} EvaluationRequest */
/** @type {{baseURL:string,startedAt:string,finishedAt?:string,checks:Array<{name:string,status:string,detail?:unknown}>,pageErrors:string[]}} */
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], pageErrors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const context = await browser.newContext({
	viewport: { width: 1440, height: 1000 },
	reducedMotion: 'reduce'
});
const page = await context.newPage();
page.setDefaultTimeout(90000);
page.on('pageerror', (error) => report.pageErrors.push(error.message));
/** @type {Coordinates|null} */ let markerCoordinates = null;
let evaluationRequests = 0;
let evidenceRequests = 0;
page.on('request', (request) => {
	if (
		request.url().includes('/planning/opportunities') ||
		request.url().includes('/planning/baseline')
	)
		evidenceRequests++;
	if (request.method() !== 'POST' || !request.url().includes('/planning/evaluate')) return;
	evaluationRequests++;
	/** @type {EvaluationRequest} */ const body = request.postDataJSON();
	markerCoordinates =
		body.operations.find((operation) => operation.type === 'add_hospital')?.coordinates ?? null;
});
const atlas = page.locator('.national-map');
const panel = page.getByRole('region', { name: 'Island needs and proposal', exact: true });
const budget = page.getByRole('region', { name: 'Proposal budget', exact: true });
const colours = page.getByRole('combobox', { name: 'Map colours', exact: true });
const slider = page.getByRole('slider', { name: 'Overlay opacity', exact: true });
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
	}
}
async function camera() {
	return atlas.evaluate((element) => ({
		longitude: element.getAttribute('data-center-longitude'),
		latitude: element.getAttribute('data-center-latitude'),
		zoom: element.getAttribute('data-zoom')
	}));
}
async function openLayers() {
	const layers = page.getByRole('button', { name: /^Layers/ });
	if ((await layers.getAttribute('aria-expanded')) !== 'true') await layers.click();
	await expect(slider).toBeVisible();
}
async function noOverflow() {
	await expect
		.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
		.toBe(true);
	for (const control of [
		page.locator('.control-panel-header strong'),
		page.getByRole('button', { name: 'Close map controls', exact: true }),
		slider
	]) {
		assert.ok(
			await control.evaluate((element) => {
				const bounds = element.getBoundingClientRect();
				const hit = document.elementFromPoint(
					bounds.x + bounds.width / 2,
					bounds.y + bounds.height / 2
				);
				return element === hit || element.contains(hit);
			}),
			'Layers heading, close button and slider midpoint must be unobstructed'
		);
	}
	const box = await slider.boundingBox();
	assert.ok(
		box && box.x >= 0 && box.x + box.width <= (page.viewportSize()?.width ?? 0) + 1,
		'Opacity control must fit the viewport'
	);
}
/** @param {number} value */
async function opacity(value) {
	await openLayers();
	await slider.focus();
	await slider.press('Home');
	if (value === 100) await slider.press('End');
	else for (let i = 0; i < value; i++) await slider.press('ArrowRight');
	await expect(slider).toHaveValue(String(value));
	await expect(atlas).toHaveAttribute('data-policy-overlay-opacity', String(value));
	await expect(page.locator('.overlay-opacity-control output')).toHaveText(`${value}%`);
	const impactActive = Number(await atlas.getAttribute('data-policy-impact-cells')) > 0;
	await expect(atlas).toHaveAttribute(
		'data-policy-gap-opacity',
		impactActive ? '0' : String(value / 100)
	);
	await expect(atlas).toHaveAttribute(
		'data-policy-impact-opacity',
		impactActive ? String(value / 100) : '0'
	);
	await expect(slider).toBeFocused();
}
/** @param {Coordinates} location */
async function project(location) {
	return atlas.evaluate(
		(element, { coordinates, anchor }) => {
			const canvas = element.querySelector('.maplibregl-canvas');
			if (!canvas) throw new Error('Map canvas missing');
			const box = canvas.getBoundingClientRect();
			const world = 512 * 2 ** Number(element.getAttribute('data-zoom'));
			const longitude = Number(element.getAttribute('data-center-longitude'));
			const latitude = Number(element.getAttribute('data-center-latitude'));
			/** @param {number} value */ const y = (value) =>
				(1 - Math.log(Math.tan(Math.PI / 4 + (value * Math.PI) / 360)) / Math.PI) / 2;
			const marker = element.querySelector('.policy-proposal-marker.confirmed');
			if (marker && anchor) {
				const markerBox = marker.getBoundingClientRect();
				return {
					x: markerBox.x + markerBox.width / 2 + ((coordinates[0] - anchor[0]) * world) / 360,
					y: markerBox.bottom + (y(coordinates[1]) - y(anchor[1])) * world
				};
			}
			return {
				x: box.x + box.width / 2 + ((coordinates[0] - longitude) * world) / 360,
				y: box.y + box.height / 2 + (y(coordinates[1]) - y(latitude)) * world
			};
		},
		{ coordinates: location, anchor: markerCoordinates }
	);
}
/** @param {Coordinates[]} locations */
async function visibleSite(locations) {
	const box = await atlas.locator('.maplibregl-canvas').boundingBox();
	assert.ok(box);
	for (const coordinates of locations) {
		const point = await project(coordinates);
		if (
			point.x < box.x + 50 ||
			point.x > box.x + box.width - 50 ||
			point.y < box.y + 170 ||
			point.y > box.y + box.height - 100
		)
			continue;
		if (
			await page.evaluate(
				({ x, y }) => document.elementFromPoint(x, y)?.matches('.maplibregl-canvas') ?? false,
				point
			)
		)
			return { coordinates, point };
	}
	throw new Error('No unobscured data-supported site visible');
}
/** @param {boolean} requireImpact */
async function estimate(requireImpact = true) {
	await expect(budget).toHaveAttribute('aria-busy', 'false');
	await expect(budget.locator('.cost-values')).not.toHaveClass(/outdated/);
	await expect(atlas).toHaveAttribute('data-policy-calculating', 'false');
	if (requireImpact)
		await expect
			.poll(async () => Number(await atlas.getAttribute('data-policy-impact-cells')))
			.toBeGreaterThan(0);
}
async function closePanel() {
	await panel.getByRole('button', { name: 'Close island planning panel', exact: true }).click();
}

try {
	const islandId = 'island:1442';
	const baselineResponse = await page.request.get(
		`${baseURL}/api/backend/planning/baseline?island_id=${encodeURIComponent(islandId)}`
	);
	assert.equal(baselineResponse.status(), 200);
	/** @type {{graph_edges:Road[]}} */ const baseline = await baselineResponse.json();
	const detailResponse = await page.request.get(
		`${baseURL}/api/backend/planning/opportunities/${encodeURIComponent(islandId)}`
	);
	assert.equal(detailResponse.status(), 200);
	/** @type {{hex_grid:{features:Cell[]}}} */ const detail = await detailResponse.json();
	await check('The display source is a genuine identified hex mesh', async () => {
		const mesh = detail.hex_grid.features;
		assert.ok(mesh.length > 0);
		const ids = mesh.map((cell) => cell.id ?? cell.properties.id);
		assert.equal(new Set(ids).size, mesh.length);
		assert.ok(ids.every((id) => id?.startsWith('hex:')));
		assert.ok(
			mesh.some(
				(cell) => cell.geometry.type === 'Polygon' && cell.geometry.coordinates[0].length === 7
			)
		);
		return { cells: mesh.length, uniqueHexIds: new Set(ids).size };
	});
	await page.goto(`${baseURL}/?view=map&tool=explore&island=${encodeURIComponent(islandId)}`, {
		waitUntil: 'domcontentloaded'
	});
	await expect(atlas).toHaveAttribute('aria-busy', 'false');
	await openLayers();
	await expect(slider).toHaveValue('65');
	await page.getByRole('button', { name: 'Create proposal', exact: true }).click();
	await expect(panel.getByText('Loading island evidence…', { exact: true })).toHaveCount(0);
	await panel
		.locator('.policy-palette')
		.getByRole('button', { name: 'Hospital', exact: true })
		.click();
	const site = await visibleSite(baseline.graph_edges.flatMap((road) => road.geometry ?? []));
	await page.mouse.click(site.point.x, site.point.y);
	await atlas
		.getByTestId('map-placement-confirmation')
		.getByRole('button', { name: 'Add to proposal', exact: true })
		.click();
	await estimate();
	await page.getByRole('button', { name: 'Create proposal', exact: true }).click();
	const costs = await budget.locator('.cost-values').innerText();
	await panel.locator('.policy-operation-list li').first().getByRole('button').first().click();
	await expect.poll(async () => Number(await atlas.getAttribute('data-zoom'))).toBeGreaterThan(15);
	await closePanel();
	await colours.selectOption('gaps');
	await page
		.locator('.policy-lens-bar')
		.getByRole('button', { name: 'Health', exact: true })
		.click();
	await expect(atlas).toHaveAttribute('data-policy-lens', 'health');
	await expect(atlas).toHaveAttribute(
		'data-policy-hex-grid',
		String(detail.hex_grid.features.length)
	);
	await check(
		'Opacity is keyboard accessible and updates map styling without data requests or camera changes',
		async () => {
			const beforeCamera = await camera();
			const counts = { evaluationRequests, evidenceRequests };
			await openLayers();
			await noOverflow();
			await page.screenshot({ path: path.join(output, 'desktop-gaps-default-65.png') });
			for (const value of [0, 35, 100]) {
				await opacity(value);
				assert.deepEqual(await camera(), beforeCamera);
				await page.screenshot({ path: path.join(output, `desktop-gaps-opacity-${value}.png`) });
			}
			assert.deepEqual(
				{ evaluationRequests, evidenceRequests },
				counts,
				'Opacity must not refetch data or recalculate proposal'
			);
			return { values: [0, 35, 100], default: 65, camera: beforeCamera, requestsUnchanged: counts };
		}
	);
	await check(
		'Gap and impact modes retain the shared mesh and proposal costs at adjustable opacity',
		async () => {
			await opacity(65);
			const beforeCamera = await camera();
			await colours.selectOption('impact');
			await expect(atlas).toHaveAttribute(
				'data-policy-impact-cells',
				String(detail.hex_grid.features.length)
			);
			await expect(atlas).toHaveAttribute(
				'data-policy-hex-grid',
				String(detail.hex_grid.features.length)
			);
			await page.screenshot({ path: path.join(output, 'desktop-impact-opacity-65.png') });
			await opacity(35);
			await page.screenshot({ path: path.join(output, 'desktop-impact-opacity-35.png') });
			assert.deepEqual(await camera(), beforeCamera);
			await page.getByRole('button', { name: 'Create proposal', exact: true }).click();
			assert.equal(await budget.locator('.cost-values').innerText(), costs);
			await closePanel();
			return {
				meshCells: detail.hex_grid.features.length,
				unchangedCosts: costs,
				camera: beforeCamera
			};
		}
	);
	await check(
		'Chosen opacity persists after reload and stays within the mobile viewport',
		async () => {
			await opacity(35);
			await page.reload({ waitUntil: 'domcontentloaded' });
			await expect(atlas).toHaveAttribute('aria-busy', 'false');
			await openLayers();
			await expect(slider).toHaveValue('35');
			await expect(atlas).toHaveAttribute('data-policy-overlay-opacity', '35');
			await page.setViewportSize({ width: 390, height: 844 });
			await noOverflow();
			await page.getByRole('button', { name: 'Create proposal', exact: true }).click();
			await estimate(false);
			await colours.selectOption('impact');
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-policy-impact-cells')))
				.toBeGreaterThan(0);
			assert.equal(await budget.locator('.cost-values').innerText(), costs);
			await panel.locator('.policy-operation-list li').first().getByRole('button').first().click();
			await closePanel();
			await colours.selectOption('gaps');
			await opacity(65);
			await noOverflow();
			await page.screenshot({ path: path.join(output, 'mobile-gaps-opacity-65.png') });
			await opacity(100);
			await page.screenshot({ path: path.join(output, 'mobile-gaps-opacity-100.png') });
			await colours.selectOption('impact');
			await opacity(35);
			await page.screenshot({ path: path.join(output, 'mobile-impact-opacity-35.png') });
			return { persistedOpacity: 35, mobile: '390x844', unchangedCosts: costs };
		}
	);
	await check('The same neighbourhood has the same hex ID in gaps and impact', async () => {
		await page.setViewportSize({ width: 1440, height: 1000 });
		await page.getByRole('button', { name: 'Create proposal', exact: true }).click();
		await panel.locator('.policy-operation-list li').first().getByRole('button').first().click();
		await closePanel();
		const layers = page.getByRole('button', { name: /^Layers/ });
		if ((await layers.getAttribute('aria-expanded')) === 'true') await layers.click();
		await colours.selectOption('gaps');
		await expect(atlas).toHaveAttribute('data-policy-impact-cells', '0');
		const centers = detail.hex_grid.features.flatMap((cell) => {
			const polygon =
				cell.geometry.type === 'Polygon' ? cell.geometry.coordinates : cell.geometry.coordinates[0];
			const ring = polygon?.[0];
			if (!ring || ring.length !== 7 || polygon.length !== 1) return [];
			const center = /** @type {Coordinates} */ ([
				ring.slice(0, -1).reduce((sum, point) => sum + point[0], 0) / 6,
				ring.slice(0, -1).reduce((sum, point) => sum + point[1], 0) / 6
			]);
			const radii = ring
				.slice(0, -1)
				.map((point) =>
					Math.hypot(
						(point[0] - center[0]) * Math.cos((center[1] * Math.PI) / 180),
						point[1] - center[1]
					)
				);
			if (Math.max(...radii) / Math.min(...radii) > 1.01) return [];
			return [center];
		});
		const beforeCamera = await camera();
		/** @type {{coordinates:Coordinates,point:{x:number,y:number}}|null} */ let tile = null;
		let attempts = 0;
		for (const center of centers) {
			let candidate;
			try {
				candidate = await visibleSite([center]);
			} catch {
				continue;
			}
			await page.mouse.click(candidate.point.x, candidate.point.y);
			try {
				await expect(panel.locator('.policy-selected-cell')).toBeVisible({ timeout: 1500 });
				tile = candidate;
				break;
			} catch {
				const close = panel.getByRole('button', {
					name: 'Close island planning panel',
					exact: true
				});
				if (await close.isVisible()) await close.click();
			}
			if (++attempts === 10) break;
		}
		assert.ok(tile, 'A visible full hex must open its neighbourhood details');
		const gapId = await panel.locator('.policy-selected-cell').getAttribute('data-cell-id');
		console.log('Selected gap hex', gapId);
		assert.ok(gapId?.startsWith('hex:'));
		await closePanel();
		await colours.selectOption('impact');
		await expect(atlas).toHaveAttribute(
			'data-policy-impact-cells',
			String(detail.hex_grid.features.length)
		);
		const impactCell = panel.getByLabel('Selected neighbourhood impact', { exact: true });
		for (let attempt = 0; attempt < 5; attempt++) {
			await page.mouse.click(tile.point.x, tile.point.y);
			try {
				await expect(impactCell).toBeVisible({ timeout: 1500 });
				break;
			} catch {
				if (attempt === 4) throw new Error('Painted impact hex must open its matching detail');
				const close = panel.getByRole('button', {
					name: 'Close island planning panel',
					exact: true
				});
				if (await close.isVisible()) await close.click();
			}
		}
		assert.equal(await impactCell.getAttribute('data-cell-id'), gapId);
		assert.deepEqual(await camera(), beforeCamera);
		await closePanel();
		return { gapId, impactId: gapId, unchangedCamera: beforeCamera };
	});
	assert.deepEqual(report.pageErrors, []);
} catch (error) {
	console.error(error);
	await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
	process.exitCode = 1;
} finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
	await browser.close();
	console.log(
		JSON.stringify({
			checks: report.checks.length,
			errors: report.pageErrors,
			report: path.join(output, 'verification.json')
		})
	);
}
