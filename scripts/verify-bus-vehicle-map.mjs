import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

// Real snapshot positions and headings drive the map; no feed or app state is replaced.
const baseURL = process.env.MOBILITY_QA_URL || 'http://127.0.0.1:5181';
const output = path.resolve('artifacts/qa/bus-vehicles');
await mkdir(output, { recursive: true });
const expect = playwrightExpect.configure({ timeout: 60000 });
/** @type {{baseURL:string,startedAt:string,finishedAt?:string,checks:Array<{name:string,status:string,detail?:unknown}>,pageErrors:string[]}} */
const report = { baseURL, startedAt: new Date().toISOString(), checks: [], pageErrors: [] };
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });

/** @param {import('@playwright/test').Locator} atlas @param {[number,number]} position */
async function project(atlas, position) {
	return atlas.evaluate((element, coordinates) => {
		const canvas = element.querySelector('.maplibregl-canvas');
		if (!canvas) throw new Error('Map canvas missing');
		const box = canvas.getBoundingClientRect();
		const longitude = Number(element.getAttribute('data-center-longitude'));
		const latitude = Number(element.getAttribute('data-center-latitude'));
		const world = 512 * 2 ** Number(element.getAttribute('data-zoom'));
		/** @param {number} value */
		const mercatorY = (value) =>
			(1 - Math.log(Math.tan(Math.PI / 4 + (value * Math.PI) / 360)) / Math.PI) / 2;
		return {
			x: box.x + box.width / 2 + ((coordinates[0] - longitude) * world) / 360,
			y: box.y + box.height / 2 + (mercatorY(coordinates[1]) - mercatorY(latitude)) * world
		};
	}, position);
}

/** @param {import('@playwright/test').Locator} locator */
async function unobscured(locator) {
	return locator.evaluate((element) => {
		const box = element.getBoundingClientRect();
		const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
		return (
			box.top >= 0 &&
			box.bottom <= innerHeight &&
			box.left >= 0 &&
			box.right <= innerWidth &&
			Boolean(hit && element.contains(hit))
		);
	});
}

/** @param {import('@playwright/test').Page} page @param {import('@playwright/test').Locator} atlas @param {[number,number]} coordinates @param {boolean} [frameForSelection] */
async function centerPosition(page, atlas, coordinates, frameForSelection = true) {
	for (let attempt = 0; attempt < 10; attempt++) {
		const position = await project(atlas, coordinates);
		const box = await atlas.locator('.maplibregl-canvas').boundingBox();
		assert.ok(box);
		// Discover a free canvas band instead of dragging through floating map controls.
		const origin = await page.evaluate((box) => {
			for (const fy of [0.4, 0.35, 0.45, 0.3, 0.5, 0.55, 0.25, 0.6]) {
				for (const fx of [0.5, 0.4, 0.6, 0.3, 0.7]) {
					const point = { x: box.x + box.width * fx, y: box.y + box.height * fy };
					if (
						[
							[0, 0],
							[-28, -28],
							[28, -28],
							[-28, 28],
							[28, 28]
						].every(([dx, dy]) =>
							document.elementFromPoint(point.x + dx, point.y + dy)?.matches('.maplibregl-canvas')
						)
					)
						return point;
				}
			}
			throw new Error('A clear canvas band is required for a genuine map drag');
		}, box);
		// Before zooming, keep the GPS position at the camera center; an off-center
		// target would multiply its pixel offset with each subsequent zoom step.
		const center = frameForSelection
			? origin
			: { x: box.x + box.width / 2, y: box.y + box.height / 2 };
		const dx = center.x - position.x;
		const dy = center.y - position.y;
		if (Math.hypot(dx, dy) < 8) return;
		// Keep the release on canvas too, so this vehicle check exercises a map
		// gesture throughout. Release handling over floating controls is checked
		// separately and should not change how this helper frames its source point.
		const gesture = await page.evaluate(
			({ box, dx, dy }) => {
				const boundedX = Math.max(-box.width * 0.28, Math.min(box.width * 0.28, dx));
				const boundedY = Math.max(-box.height * 0.28, Math.min(box.height * 0.28, dy));
				for (const scale of [1, 0.75, 0.5, 0.25]) {
					for (const fy of [0.4, 0.35, 0.45, 0.3, 0.5, 0.55, 0.25, 0.6, 0.65]) {
						for (const fx of [0.5, 0.4, 0.6, 0.3, 0.7]) {
							const start = { x: box.x + box.width * fx, y: box.y + box.height * fy };
							const end = { x: start.x + boundedX * scale, y: start.y + boundedY * scale };
							if (
								Array.from({ length: 11 }, (_, step) => step / 10).every((fraction) =>
									[
										[0, 0],
										[-4, -4],
										[4, 4]
									].every(([ox, oy]) =>
										document
											.elementFromPoint(
												start.x + (end.x - start.x) * fraction + ox,
												start.y + (end.y - start.y) * fraction + oy
											)
											?.matches('.maplibregl-canvas')
									)
								)
							)
								return { start, end };
						}
					}
				}
				throw new Error('An unobscured canvas drag path and release are required');
			},
			{ box, dx, dy }
		);
		await page.mouse.move(gesture.start.x, gesture.start.y);
		await page.mouse.down();
		await page.mouse.move(gesture.end.x, gesture.end.y, { steps: 10 });
		// Release after movement settles so pan inertia cannot change the inspected position.
		await page.waitForTimeout(250);
		await page.mouse.up();
		await page.waitForTimeout(200);
	}
	await page.screenshot({ path: path.join(output, 'bus-gesture-failure.png') });
	throw new Error('The actual source bus could not be brought into unobscured canvas space');
}

/** @param {import('@playwright/test').Page} page @param {Buffer} image @param {number} heading */
async function vehiclePixels(page, image, heading) {
	return page.evaluate(
		async ({ base64, bearing }) => {
			const image = new Image();
			image.src = `data:image/png;base64,${base64}`;
			await image.decode();
			const canvas = document.createElement('canvas');
			canvas.width = image.width;
			canvas.height = image.height;
			const context = canvas.getContext('2d');
			if (!context) throw new Error('Screenshot pixel context missing');
			context.drawImage(image, 0, 0);
			const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
			const body = [];
			const windshield = [];
			for (let y = 0; y < canvas.height; y++) {
				for (let x = 0; x < canvas.width; x++) {
					const offset = (y * canvas.width + x) * 4;
					// Identify the bus's warm body in its rendered screenshot, allowing antialiasing.
					if (
						Math.hypot(pixels[offset] - 215, pixels[offset + 1] - 156, pixels[offset + 2] - 70) < 32
					)
						body.push([x, y]);
					if (
						Math.hypot(pixels[offset] - 40, pixels[offset + 1] - 68, pixels[offset + 2] - 79) < 12
					)
						windshield.push([x, y]);
				}
			}
			if (!body.length)
				return {
					bodyPixels: 0,
					lengthPx: 0,
					widthPx: 0,
					axisBearingDegrees: 0,
					headingAxisErrorDegrees: Infinity,
					windshieldPixels: 0,
					windshieldForwardOffsetPx: 0
				};
			const mean = body.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]);
			mean[0] /= body.length;
			mean[1] /= body.length;
			let xx = 0,
				yy = 0,
				xy = 0;
			for (const [x, y] of body) {
				xx += (x - mean[0]) ** 2;
				yy += (y - mean[1]) ** 2;
				xy += (x - mean[0]) * (y - mean[1]);
			}
			const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
			const expected = ((bearing - 90) * Math.PI) / 180;
			const difference = Math.abs(
				Math.atan2(Math.sin(angle - expected), Math.cos(angle - expected))
			);
			const along = body.map(([x, y]) => x * Math.cos(angle) + y * Math.sin(angle));
			const across = body.map(([x, y]) => -x * Math.sin(angle) + y * Math.cos(angle));
			const forward = {
				x: Math.sin((bearing * Math.PI) / 180),
				y: -Math.cos((bearing * Math.PI) / 180)
			};
			return {
				bodyPixels: body.length,
				lengthPx: Math.max(...along) - Math.min(...along) + 1,
				widthPx: Math.max(...across) - Math.min(...across) + 1,
				axisBearingDegrees: ((angle * 180) / Math.PI + 90 + 360) % 360,
				headingAxisErrorDegrees: (Math.min(difference, Math.PI - difference) * 180) / Math.PI,
				windshieldPixels: windshield.length,
				windshieldForwardOffsetPx: windshield.length
					? windshield.reduce(
							(sum, [x, y]) => sum + (x - mean[0]) * forward.x + (y - mean[1]) * forward.y,
							0
						) / windshield.length
					: 0
			};
		},
		{ base64: image.toString('base64'), bearing: heading }
	);
}

try {
	for (const layout of [
		{ name: 'desktop', viewport: { width: 1440, height: 1000 }, mobile: false },
		{ name: 'mobile', viewport: { width: 390, height: 844 }, mobile: true }
	]) {
		const context = await browser.newContext({
			viewport: layout.viewport,
			isMobile: layout.mobile,
			hasTouch: layout.mobile,
			deviceScaleFactor: 1,
			reducedMotion: 'no-preference'
		});
		try {
			const page = await context.newPage();
			page.setDefaultTimeout(60000);
			page.on('pageerror', (error) => report.pageErrors.push(error.message));
			const response = page.waitForResponse(
				(item) => new URL(item.url()).pathname === '/api/backend/live/snapshot'
			);
			await page.goto(`${baseURL}/?view=map&tool=explore&island=island%3A1442`);
			const received = await response;
			assert.equal(received.status(), 200);
			/** @type {import('../src/lib/types.js').LiveSnapshot} */
			const snapshot = await received.json();
			const buses = snapshot.events.filter((event) => event.kind === 'bus');
			assert.ok(
				buses.length > 0,
				'At least one actual bus observation is required; no fixture is used'
			);
			const mtccExpress = snapshot.events.filter((event) =>
				/mtcc.*express/i.test(String(event.properties.name || ''))
			);
			for (const event of mtccExpress) assert.equal(event.kind, 'vessel');
			const atlas = page.locator('.national-map');
			await expect(atlas).toHaveAttribute(
				'data-movement-positions',
				String(snapshot.events.length)
			);
			await expect(atlas.locator('[title="Bus observations"]')).toHaveText(String(buses.length));
			await page.locator('.movement-settings > summary').click();
			const pause = page.getByRole('button', { name: 'Pause nearby updates', exact: true });
			await expect.poll(() => unobscured(pause)).toBe(true);
			await pause.click();
			await page.locator('.movement-settings > summary').click();

			// Prefer a supplied heading and a bus isolated from other vehicle hit areas.
			/** @param {import('../src/lib/types.js').LiveEvent} first @param {import('../src/lib/types.js').LiveEvent} second */
			const distance = (first, second) =>
				Math.hypot(
					first.position.longitude - second.position.longitude,
					first.position.latitude - second.position.latitude
				);
			const candidates = buses.filter(
				(event) =>
					event.properties.heading != null &&
					event.properties.heading !== '' &&
					Number.isFinite(Number(event.properties.heading))
			);
			assert.ok(candidates.length > 0, 'A real provider heading is required');
			const selected = candidates.sort(
				(first, second) =>
					Math.min(
						...buses
							.filter((event) => event.id !== second.id)
							.map((event) => distance(second, event))
					) -
					Math.min(
						...buses.filter((event) => event.id !== first.id).map((event) => distance(first, event))
					)
			)[0];
			/** @type {[number,number]} */
			const coordinates = [selected.position.longitude, selected.position.latitude];
			await expect(atlas).toHaveAttribute('aria-busy', 'false');
			await centerPosition(page, atlas, coordinates, false);
			for (let attempt = 0; attempt < 5; attempt++) {
				const zoom = Number(await atlas.getAttribute('data-zoom'));
				if (zoom >= 17) break;
				await atlas.getByRole('button', { name: 'Zoom in', exact: true }).click();
				await expect
					.poll(async () => Number(await atlas.getAttribute('data-zoom')))
					.toBeGreaterThan(zoom + 0.8);
			}
			await centerPosition(page, atlas, coordinates);
			await expect
				.poll(async () => Number(await atlas.getAttribute('data-rendered-bus-vehicles')))
				.toBeGreaterThan(0);
			assert.ok(Number(await atlas.getAttribute('data-rendered-bus-vehicles')) <= buses.length);
			await expect(atlas).toHaveAttribute('aria-busy', 'false');
			const position = await project(atlas, coordinates);
			assert.equal(
				await page.evaluate(
					({ x, y }) =>
						[
							[0, 0],
							[-28, -28],
							[28, -28],
							[-28, 28],
							[28, 28]
						].every(([dx, dy]) =>
							document.elementFromPoint(x + dx, y + dy)?.matches('.maplibregl-canvas')
						),
					position
				),
				true,
				'The entire vehicle footprint at its actual GPS point is unobscured canvas'
			);
			const crop = await page.screenshot({
				path: path.join(output, `bus-${layout.name}-detail.png`),
				clip: {
					x: Math.round(position.x - 28),
					y: Math.round(position.y - 28),
					width: 56,
					height: 56
				}
			});
			const pixels = await vehiclePixels(page, crop, Number(selected.properties.heading));
			assert.ok(pixels.bodyPixels >= 25, 'The bus has a visible filled vehicle body');
			assert.ok(
				pixels.lengthPx >= 20 && pixels.lengthPx <= 52,
				'The road vehicle has a compact visible length'
			);
			assert.ok(
				pixels.widthPx >= 6 && pixels.widthPx <= 26,
				'The road vehicle has a compact visible width'
			);
			assert.ok(
				pixels.lengthPx / pixels.widthPx >= 1.7,
				'The body reads as a long bus rather than a front-view badge'
			);
			assert.ok(
				pixels.headingAxisErrorDegrees < 12,
				'The rendered vehicle follows the actual provider heading'
			);
			assert.ok(
				pixels.windshieldPixels >= 8 && pixels.windshieldForwardOffsetPx > 5,
				'The front windshield faces forward along the received heading'
			);
			await page.screenshot({ path: path.join(output, `bus-${layout.name}-map.png`) });
			if (layout.mobile) await page.touchscreen.tap(position.x, position.y);
			else await page.mouse.click(position.x, position.y);
			const popup = atlas.locator('.map-record-card');
			await expect(popup).toBeVisible();
			const title = popup.locator('h3');
			const close = atlas.locator('.maplibregl-popup-close-button');
			await expect(title).toHaveText(String(selected.properties.name).trim());
			await expect.poll(() => unobscured(title)).toBe(true);
			await expect.poll(() => unobscured(close)).toBe(true);
			await popup.locator('summary').filter({ hasText: 'Source details' }).click();
			await expect(popup).toContainText(selected.id);
			await expect(popup).toContainText(
				`${Math.round(Number(selected.properties.heading))}° supplied by provider`
			);
			await expect(popup).toContainText(coordinates.map((value) => value.toFixed(6)).join(', '));
			await expect.poll(() => unobscured(title)).toBe(true);
			await expect.poll(() => unobscured(close)).toBe(true);
			await page.screenshot({ path: path.join(output, `bus-${layout.name}-selected.png`) });
			await close.click();
			await expect(popup).toBeHidden();
			report.checks.push({
				name: `${layout.name} · actual bus vehicle, source heading and selection`,
				status: 'passed',
				detail: { receivedBusCount: buses.length, mtccExpress, selected, coordinates, pixels }
			});
			console.log(`PASS actual bus vehicle (${layout.name})`);
		} finally {
			await context.close();
		}
	}
	assert.deepEqual(report.pageErrors, []);
} catch (error) {
	report.checks.push({ name: 'Actual bus vehicle', status: 'failed', detail: String(error) });
	throw error;
} finally {
	report.finishedAt = new Date().toISOString();
	await writeFile(path.join(output, 'verification.json'), JSON.stringify(report, null, 2));
	await browser.close();
}
