export const MARKER_SHAPES = [
	'circle',
	'square',
	'diamond',
	'triangle',
	'plus',
	'pentagon',
	'hexagon'
] as const;
export type MarkerShape = (typeof MARKER_SHAPES)[number];

const PLUS_ARM = 0.36;

function regularPolygon(sides: number): string {
	const points = Array.from({ length: sides }, (_, i) => {
		const angle = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
		return `${Math.cos(angle).toFixed(4)} ${Math.sin(angle).toFixed(4)}`;
	});
	return `M ${points.join(' L ')} Z`;
}

function polygon(points: readonly (readonly [number, number])[]): string {
	return `M ${points.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`;
}

const t = PLUS_ARM;

/**
 * SVG path data for each shape in a unit box centred on the origin (-1..1).
 * One definition drives both the canvas-drawn map markers and the SVG legend glyphs.
 */
const PATHS: Record<MarkerShape, string> = {
	circle: 'M -1 0 A 1 1 0 1 0 1 0 A 1 1 0 1 0 -1 0 Z',
	square: polygon([
		[-0.82, -0.82],
		[0.82, -0.82],
		[0.82, 0.82],
		[-0.82, 0.82]
	]),
	diamond: polygon([
		[0, -1],
		[1, 0],
		[0, 1],
		[-1, 0]
	]),
	triangle: polygon([
		[0, -1],
		[0.95, 0.8],
		[-0.95, 0.8]
	]),
	plus: polygon([
		[-t, -1],
		[t, -1],
		[t, -t],
		[1, -t],
		[1, t],
		[t, t],
		[t, 1],
		[-t, 1],
		[-t, t],
		[-1, t],
		[-1, -t],
		[-t, -t]
	]),
	pentagon: regularPolygon(5),
	hexagon: regularPolygon(6)
};

export function markerPath(shape: MarkerShape): string {
	return PATHS[shape];
}
