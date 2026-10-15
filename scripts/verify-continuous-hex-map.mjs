import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Read real source geometry and drive real map gestures; no mocked data or injected app state.
const baseURL = process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5173';
const phase = process.env.MOBILITY_QA_PHASE === 'before' ? 'before' : 'after';
const output = path.resolve('artifacts/qa/continuous-hex-map', phase);
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 90000 });
/** @typedef {[number,number]} Coordinates */
/** @typedef {{x:number,y:number}} Point */
/** @typedef {{geometry?:Coordinates[]}} Road */
/** @typedef {{type:'Polygon',coordinates:Coordinates[][]}|{type:'MultiPolygon',coordinates:Coordinates[][][]}} CellGeometry */
/** @typedef {{type:'Feature',id?:string,geometry:CellGeometry,properties:{id?:string,origin_id?:string,contributions?:Array<{origin_id:string,share:number}>}}} Cell */
/** @typedef {{hex_grid?:{features:Cell[]},gap_cells:{features:Cell[]}}} IslandDetail */
/** @typedef {{operations:Array<{type:string,coordinates?:Coordinates}>}} EvaluationRequest */
/** @type {{baseURL:string,phase:string,startedAt:string,finishedAt?:string,checks:Array<{name:string,status:string,detail?:unknown}>,pageErrors:string[]}} */
const report = { baseURL, phase, startedAt: new Date().toISOString(), checks: [], pageErrors: [] };
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
	}
}
/** @param {CellGeometry} geometry @returns {Coordinates[][]} */
function rings(geometry) {
	return geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates.flat();
}
/** @param {Cell[]} cells */
function meshEvidence(cells) {
	assert.ok(cells.length > 0, 'The detail API must expose the continuous resident-support mesh');
	const ids = cells.map((cell) => cell.id ?? cell.properties.id);
	assert.ok(ids.every((id) => typeof id === 'string' && id.startsWith('hex:')));
	assert.equal(new Set(ids).size, cells.length, 'Hex IDs must be unique');
	/** @type {Map<string,number>} */ const edges = new Map();
	/** @type {Map<string,number>} */ const shares = new Map();
	for (const cell of cells) {
		assert.ok(
			cell.properties.contributions?.length,
			'Each displayed tile needs resident-source contributions'
		);
		for (const contribution of cell.properties.contributions) {
			assert.ok(
				Number.isFinite(contribution.share) &&
					contribution.share > 0 &&
					contribution.share <= 1.000001
			);
			shares.set(
				contribution.origin_id,
				(shares.get(contribution.origin_id) ?? 0) + contribution.share
			);
		}
		for (const ring of rings(cell.geometry))
			for (let i = 1; i < ring.length; i++) {
				const start = ring[i - 1].map((value) => value.toFixed(9)).join(',');
				const end = ring[i].map((value) => value.toFixed(9)).join(',');
				if (start === end) continue;
				const edge = [start, end].sort().join('|');
				edges.set(edge, (edges.get(edge) ?? 0) + 1);
			}
	}
	for (const [origin, sum] of shares)
		assert.ok(
			Math.abs(sum - 1) < 0.002,
			`${origin} must retain its complete allocation, got ${sum}`
		);
	const sharedEdges = [...edges.values()].filter((count) => count === 2).length;
	assert.ok(
		sharedEdges > 0,
		'Adjacent mesh cells must have actual shared edges, not spaced origin symbols'
	);
	assert.ok(
		[...edges.values()].every((count) => count <= 2),
		'A boundary edge must not be duplicated by more than two cells'
	);
	return {
		cells: cells.length,
		contributingOrigins: shares.size,
		sharedEdges,
		maximumShareError: Math.max(...[...shares.values()].map((share) => Math.abs(share - 1)))
	};
}

try {
	for (const islandId of ['island:1442', 'island:1443']) {
		const context = await browser.newContext({
			viewport: { width: 1440, height: 1000 },
			reducedMotion: 'reduce'
		});
		const page = await context.newPage();
		page.setDefaultTimeout(90000);
		page.on('pageerror', (error) => report.pageErrors.push(error.message));
		/** @type {Coordinates|null} */ let markerCoordinates = null;
		page.on('request', (request) => {
			if (request.method() !== 'POST' || !request.url().includes('/planning/evaluate')) return;
			/** @type {EvaluationRequest} */ const evaluation = request.postDataJSON();
			markerCoordinates =
				evaluation.operations.find((operation) => operation.type === 'add_hospital')?.coordinates ??
				null;
		});
		const atlas = page.locator('.national-map');
		const panel = page.getByRole('region', { name: 'Island needs and proposal', exact: true });
		const budget = page.getByRole('region', { name: 'Proposal budget', exact: true });
		const colours = page.getByRole('combobox', { name: 'Map colours', exact: true });
		const baselineResponse = await page.request.get(
			`${baseURL}/api/backend/planning/baseline?island_id=${encodeURIComponent(islandId)}`
		);
		assert.equal(baselineResponse.status(), 200);
		/** @type {{graph_edges:Road[],origins:Array<{lon:number,lat:number}>}} */ const baseline =
			await baselineResponse.json();
		const detailResponse = await page.request.get(
			`${baseURL}/api/backend/planning/opportunities/${encodeURIComponent(islandId)}`
		);
		assert.equal(detailResponse.status(), 200);
		/** @type {IslandDetail} */ const detail = await detailResponse.json();
		if (phase === 'after')
			await check(
				`${islandId}: API exposes a connected mesh with conserved resident contributions`,
				async () => meshEvidence(detail.hex_grid?.features ?? [])
			);
		/** @param {Coordinates} location */
		async function project(location) {
			return atlas.evaluate(
				(element, { coordinates, anchor }) => {
					const canvas = element.querySelector('.maplibregl-canvas');
					if (!canvas) throw new Error('Map canvas is missing');
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
		async function camera() {
			return atlas.evaluate((element) => ({
				longitude: element.getAttribute('data-center-longitude'),
				latitude: element.getAttribute('data-center-latitude'),
				zoom: element.getAttribute('data-zoom')
			}));
		}
		/** @param {Coordinates[]} coordinates */
		async function visibleLocation(coordinates) {
			const box = await atlas.locator('.maplibregl-canvas').boundingBox();
			assert.ok(box);
			for (const location of coordinates) {
				const point = await project(location);
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
					return { coordinates: location, point };
			}
			throw new Error('A source-backed site must be unobscured on the map');
		}
		async function noOverflow() {
			await expect
				.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
				.toBe(true);
		}
		async function estimate() {
			await expect(budget).toHaveAttribute('aria-busy', 'false');
			await expect(budget.locator('.cost-values')).not.toHaveClass(/outdated/);
			await expect(atlas).toHaveAttribute('data-policy-calculating', 'false');
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-policy-impact-cells')))
				.toBeGreaterThan(0);
		}
		try {
			console.log(`SETUP ${islandId}: open map`);
			await page.goto(`${baseURL}/?view=map&tool=explore&island=${encodeURIComponent(islandId)}`, {
				waitUntil: 'domcontentloaded'
			});
			await expect(atlas).toHaveAttribute('aria-busy', 'false');
			console.log(`SETUP ${islandId}: open proposal`);
			await page.getByRole('button', { name: 'Create proposal', exact: true }).click();
			await expect(panel.getByText('Loading island evidence…', { exact: true })).toHaveCount(0);
			await panel
				.locator('.policy-palette')
				.getByRole('button', { name: 'Hospital', exact: true })
				.click();
			const site = await visibleLocation(
				baseline.graph_edges.flatMap((road) => road.geometry ?? [])
			);
			console.log(`SETUP ${islandId}: place hospital`, site);
			await page.mouse.click(site.point.x, site.point.y);
			await panel
				.locator('.policy-placement-confirm')
				.getByRole('button', { name: 'Add to proposal', exact: true })
				.click();
			console.log(`SETUP ${islandId}: await estimate`);
			await estimate();
			if (phase === 'after')
				await expect(atlas).toHaveAttribute(
					'data-policy-hex-grid',
					String(detail.hex_grid?.features.length)
				);
			console.log(`SETUP ${islandId}: estimate ready`);
			const costs = await budget.locator('.cost-values').innerText();
			await panel.locator('.policy-operation-list li').first().getByRole('button').first().click();
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-zoom')))
				.toBeGreaterThan(15);
			await panel.getByRole('button', { name: 'Close island planning panel', exact: true }).click();
			for (const viewport of [
				{ width: 1440, height: 1000 },
				{ width: 390, height: 844 }
			]) {
				const device = viewport.width === 390 ? 'mobile' : 'desktop';
				await page.setViewportSize(viewport);
				await page.getByRole('button', { name: 'Create proposal', exact: true }).click();
				await panel
					.locator('.policy-operation-list li')
					.first()
					.getByRole('button')
					.first()
					.click();
				await panel
					.getByRole('button', { name: 'Close island planning panel', exact: true })
					.click();
				await check(
					`${islandId}: ${device} gap/impact colours remain usable without moving the camera or changing costs`,
					async () => {
						await noOverflow();
						await colours.selectOption('gaps');
						await expect(atlas).toHaveAttribute('data-policy-impact-cells', '0');
						await page
							.locator('.policy-lens-bar')
							.getByRole('button', { name: 'Health', exact: true })
							.click();
						await expect(atlas).toHaveAttribute('data-policy-lens', 'health');
						const before = await camera();
						await page.screenshot({
							path: path.join(output, `${islandId.replace(':', '-')}-${device}-gaps.png`)
						});
						await colours.selectOption('impact');
						await expect
							.poll(async () => Number(await atlas.getAttribute('data-policy-impact-cells')))
							.toBeGreaterThan(0);
						if (phase === 'after')
							await expect(atlas).toHaveAttribute(
								'data-policy-impact-cells',
								String(detail.hex_grid?.features.length)
							);
						assert.deepEqual(await camera(), before);
						await page.screenshot({
							path: path.join(output, `${islandId.replace(':', '-')}-${device}-impact.png`)
						});
						await page.getByRole('button', { name: 'Create proposal', exact: true }).click();
						await expect(budget).toBeVisible();
						assert.equal(await budget.locator('.cost-values').innerText(), costs);
						await panel
							.getByRole('button', { name: 'Close island planning panel', exact: true })
							.click();
						return {
							viewport: viewport.width,
							gapFeatures: Number(await atlas.getAttribute('data-policy-gap-cells')),
							displayHexes: Number(await atlas.getAttribute('data-policy-hex-grid')),
							impactCells: Number(await atlas.getAttribute('data-policy-impact-cells')),
							unchangedCosts: costs,
							camera: before
						};
					}
				);
			}
			if (phase === 'before') continue;
			await page.setViewportSize({ width: 1440, height: 1000 });
			const clickLocations =
				phase === 'after'
					? (detail.hex_grid?.features ?? []).flatMap((cell) => {
							const exterior =
								cell.geometry.type === 'Polygon'
									? cell.geometry.coordinates[0]
									: cell.geometry.coordinates[0]?.[0];
							if (!exterior || exterior.length !== 7) return [];
							return [
								/** @type {Coordinates} */ ([
									exterior.slice(0, -1).reduce((sum, point) => sum + point[0], 0) / 6,
									exterior.slice(0, -1).reduce((sum, point) => sum + point[1], 0) / 6
								])
							];
						})
					: baseline.origins.map((origin) => /** @type {Coordinates} */ ([origin.lon, origin.lat]));
			await check(
				`${islandId}: source-backed gap and impact cells open matching details without refitting`,
				async () => {
					await colours.selectOption('gaps');
					const location = await visibleLocation(clickLocations);
					const before = await camera();
					await page.mouse.click(location.point.x, location.point.y);
					await expect(panel.locator('.policy-selected-cell')).toBeVisible();
					await expect(panel.locator('.policy-selected-cell')).toContainText('Selected');
					assert.deepEqual(await camera(), before);
					await colours.selectOption('impact');
					await panel
						.getByRole('button', { name: 'Close island planning panel', exact: true })
						.click();
					await page.mouse.click(location.point.x, location.point.y);
					await expect(
						panel.getByLabel('Selected neighbourhood impact', { exact: true })
					).toBeVisible();
					assert.deepEqual(await camera(), before);
					await panel.getByRole('button', { name: /^Your proposal/ }).click();
					assert.equal(await budget.locator('.cost-values').innerText(), costs);
					return { selectedAt: location.coordinates, camera: before, unchangedCosts: costs };
				}
			);
		} catch (error) {
			await page
				.screenshot({
					path: path.join(output, `${islandId.replace(':', '-')}-failure.png`),
					fullPage: true
				})
				.catch(() => {});
			throw error;
		} finally {
			await context.close();
		}
	}
	assert.deepEqual(report.pageErrors, []);
} catch (error) {
	console.error(error);
	process.exitCode = 1;
} finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
	await browser.close();
	console.log(
		JSON.stringify({
			phase,
			checks: report.checks.length,
			errors: report.pageErrors,
			report: path.join(output, 'verification.json')
		})
	);
}
