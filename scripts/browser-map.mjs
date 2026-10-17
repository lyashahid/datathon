/** Project a geographic point through the atlas's rendered camera diagnostics.
 * This does not access MapLibre internals or change application state. All current
 * harness maps are north-up; include camera padding so mobile/docked panels don't
 * turn a map gesture into a click on an unrelated control.
 * @param {import('@playwright/test').Locator} atlas
 * @param {number[]} coordinates
 */
export function projectMapPoint(atlas, coordinates) {
	return atlas.evaluate((element, location) => {
		const canvas = element.querySelector('.maplibregl-canvas');
		if (!canvas) throw new Error('Map canvas is missing.');
		const box = canvas.getBoundingClientRect();
		const world = 512 * 2 ** Number(element.getAttribute('data-zoom'));
		const longitude = Number(element.getAttribute('data-center-longitude'));
		const latitude = Number(element.getAttribute('data-center-latitude'));
		const padding = Object.fromEntries(
			['top', 'right', 'bottom', 'left'].map((side) => [
				side,
				Number(element.getAttribute(`data-camera-padding-${side}`))
			])
		);
		/** @param {number} value */
		const mercatorY = (value) =>
			(1 - Math.log(Math.tan(Math.PI / 4 + (value * Math.PI) / 360)) / Math.PI) / 2;
		return {
			x:
				box.x +
				(box.width + padding.left - padding.right) / 2 +
				((location[0] - longitude) * world) / 360,
			y:
				box.y +
				(box.height + padding.top - padding.bottom) / 2 +
				(mercatorY(location[1]) - mercatorY(latitude)) * world
		};
	}, coordinates);
}

/** Zoom through the visible canvas, using the same wheel gesture as the map UI.
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').Locator} atlas
 * @param {number} direction Positive zooms in; negative zooms out.
 */
export async function wheelMapZoom(page, atlas, direction) {
	const point = await atlas.locator('.maplibregl-canvas').evaluate((canvas) => {
		const box = canvas.getBoundingClientRect();
		for (const xFraction of [0.55, 0.7, 0.4, 0.85, 0.25]) {
			for (const yFraction of [0.45, 0.3, 0.6, 0.75]) {
				const x = box.x + box.width * xFraction;
				const y = box.y + box.height * yFraction;
				if (document.elementFromPoint(x, y) === canvas) return { x, y };
			}
		}
		throw new Error('No unobscured map area is available for the zoom gesture.');
	});
	await page.mouse.move(point.x, point.y);
	await page.mouse.wheel(0, direction > 0 ? -800 : 800);
}
