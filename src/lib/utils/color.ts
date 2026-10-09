import type { ColorScale } from '#lib/config/infoViews.ts';

function parseHex(hex: string): [number, number, number] {
	const n = Number.parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const toHex = (rgb: readonly number[]) =>
	`#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

/** Colour for a value on a scale, interpolated in RGB exactly as the map's linear ramp does. */
export function colorAt(scale: ColorScale, value: number): string {
	const { stops } = scale;
	if (value <= stops[0][0]) return stops[0][1];
	for (let i = 1; i < stops.length; i++) {
		const [v1, c1] = stops[i];
		if (value <= v1) {
			const [v0, c0] = stops[i - 1];
			const t = (value - v0) / (v1 - v0);
			const a = parseHex(c0);
			const b = parseHex(c1);
			return toHex(a.map((x, k) => x + (b[k] - x) * t));
		}
	}
	return stops[stops.length - 1][1];
}
