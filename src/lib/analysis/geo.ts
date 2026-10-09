import type { Position } from 'geojson';

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in metres between two [lng, lat] positions. */
export function haversineM(a: Position, b: Position): number {
	const toRad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = toRad(b[1] - a[1]);
	const dLng = toRad(b[0] - a[0]);
	const h =
		Math.sin(dLat / 2) ** 2 +
		Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
	return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const M_PER_DEG_LAT = (Math.PI * EARTH_RADIUS_M) / 180;

/**
 * Local equirectangular projection around `origin`, in metres (x east, y north).
 * Accurate to well under 1% over the few-kilometre extents used for catchments.
 */
export function toLocalM(origin: Position, p: Position): [number, number] {
	const mPerDegLng = M_PER_DEG_LAT * Math.cos((origin[1] * Math.PI) / 180);
	return [(p[0] - origin[0]) * mPerDegLng, (p[1] - origin[1]) * M_PER_DEG_LAT];
}

export function fromLocalM(origin: Position, [x, y]: readonly [number, number]): Position {
	const mPerDegLng = M_PER_DEG_LAT * Math.cos((origin[1] * Math.PI) / 180);
	return [origin[0] + x / mPerDegLng, origin[1] + y / M_PER_DEG_LAT];
}

/** Shortest distance in metres from a point to a polyline. */
export function distanceToLineM(point: Position, line: readonly Position[]): number {
	if (line.length === 0) return Infinity;
	if (line.length === 1) return haversineM(point, line[0]);
	let best = Infinity;
	for (let i = 1; i < line.length; i++) {
		const [ax, ay] = toLocalM(point, line[i - 1]);
		const [bx, by] = toLocalM(point, line[i]);
		const dx = bx - ax;
		const dy = by - ay;
		const lenSq = dx * dx + dy * dy;
		const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lenSq));
		best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
	}
	return best;
}

/** Closed ring approximating a circle of `radiusM` around `center`. */
export function circleRing(center: Position, radiusM: number, steps = 64): Position[] {
	const ring = Array.from({ length: steps }, (_, i) => {
		const a = (i / steps) * 2 * Math.PI;
		return fromLocalM(center, [radiusM * Math.cos(a), radiusM * Math.sin(a)]);
	});
	return [...ring, ring[0]];
}

/** Ray-casting point-in-polygon test for a single [lng, lat] ring (open or closed). */
export function pointInRing(point: Position, ring: readonly Position[]): boolean {
	const [x, y] = point;
	let inside = false;
	for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
		const [xi, yi] = ring[i];
		const [xj, yj] = ring[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}
