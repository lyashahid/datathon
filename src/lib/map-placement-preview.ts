import type { Coordinates } from './types.js';
import { validPoint } from './planning-map.js';

/** A local geometry snap, not a claim that a road is suitable for a stop. */
export function nearestPlacementRoad(
	point: Coordinates,
	edges: { geometry?: number[][] }[],
	maxDistance = 35
): { coordinates: Coordinates; distance: number | null; snapped: boolean } {
	const unchanged = { coordinates: point, distance: null, snapped: false };
	if (!validPoint(point) || !Number.isFinite(maxDistance) || maxDistance < 0) return unchanged;
	const scaleX = 111320 * Math.cos((point[1] * Math.PI) / 180);
	if (Math.abs(scaleX) < 1) return unchanged;
	let nearest = Infinity;
	let candidate: Coordinates = point;
	for (const edge of edges) {
		const line = edge.geometry ?? [];
		for (let i = 1; i < line.length; i++) {
			const a = line[i - 1];
			const b = line[i];
			if (!validPoint(a) || !validPoint(b)) continue;
			const ax = (a[0] - point[0]) * scaleX;
			const ay = (a[1] - point[1]) * 111320;
			const dx = (b[0] - a[0]) * scaleX;
			const dy = (b[1] - a[1]) * 111320;
			const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
			const distance = Math.hypot(ax + t * dx, ay + t * dy);
			if (distance < nearest) {
				nearest = distance;
				candidate = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
			}
		}
	}
	return Number.isFinite(nearest)
		? {
				coordinates: nearest <= maxDistance ? candidate : point,
				distance: nearest,
				snapped: nearest <= maxDistance
			}
		: unchanged;
}
