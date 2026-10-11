import polygonClipping, { type MultiPolygon } from 'polygon-clipping';

const normalizedCache = new WeakMap<MultiPolygon, Map<number, MultiPolygon>>();

/** Display geometry only: suppress floating-point seams far below the precision of mapped shorelines. */
export function precisionCoordinates(polygons: MultiPolygon, digits = 9): MultiPolygon {
	const cached = normalizedCache.get(polygons)?.get(digits);
	if (cached) return cached;
	const factor = 10 ** digits;
	const result: MultiPolygon = polygons.flatMap((polygon) => {
		const rings = polygon.map((ring) => {
			const normalized: [number, number][] = [];
			for (const point of ring) {
				if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
				const next: [number, number] = [
					Math.round(point[0] * factor) / factor,
					Math.round(point[1] * factor) / factor
				];
				const previous = normalized[normalized.length - 1];
				if (!previous || previous[0] !== next[0] || previous[1] !== next[1]) normalized.push(next);
			}
			if (
				normalized.length > 1 &&
				normalized[0][0] === normalized[normalized.length - 1][0] &&
				normalized[0][1] === normalized[normalized.length - 1][1]
			)
				normalized.pop();
			if (normalized.length < 3) return [];
			return [...normalized, normalized[0]];
		});
		if (!rings[0]?.length) return [];
		return [[rings[0], ...rings.slice(1).filter((ring) => ring.length)]];
	});
	const levels = normalizedCache.get(polygons) ?? new Map<number, MultiPolygon>();
	levels.set(digits, result);
	normalizedCache.set(polygons, levels);
	normalizedCache.set(result, new Map([[digits, result]]));
	return result;
}

/** Retry only numerical ring construction failures at millimeter precision; never substitute unclipped geometry. */
export function precisionIntersection(one: MultiPolygon, two: MultiPolygon): MultiPolygon {
	try {
		return polygonClipping.intersection(precisionCoordinates(one), precisionCoordinates(two));
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!/Unable to complete output ring|Unable to find segment/.test(error.message)
		)
			throw error;
		return polygonClipping.intersection(precisionCoordinates(one, 8), precisionCoordinates(two, 8));
	}
}

export function precisionUnion(...polygons: MultiPolygon[]): MultiPolygon {
	const normalized = polygons
		.map((polygon) => precisionCoordinates(polygon))
		.filter((polygon) => polygon.length);
	if (!normalized.length) return [];
	try {
		return polygonClipping.union(normalized[0], ...normalized.slice(1));
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!/Unable to complete output ring|Unable to find segment/.test(error.message)
		)
			throw error;
		const retry = polygons
			.map((polygon) => precisionCoordinates(polygon, 8))
			.filter((polygon) => polygon.length);
		return retry.length ? polygonClipping.union(retry[0], ...retry.slice(1)) : [];
	}
}
