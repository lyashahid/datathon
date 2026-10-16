import type { Coordinates } from './types.js';

export type MapLocation = { latitude: number; longitude: number };

export function validLocation(value: MapLocation | null | undefined): value is MapLocation {
	return (
		!!value &&
		Number.isFinite(value.latitude) &&
		Number.isFinite(value.longitude) &&
		Math.abs(value.latitude) <= 90 &&
		Math.abs(value.longitude) <= 180
	);
}

export function locationFromInput(
	latitude: number | string,
	longitude: number | string
): MapLocation | null {
	if (String(latitude).trim() === '' || String(longitude).trim() === '') return null;
	const point = { latitude: Number(latitude), longitude: Number(longitude) };
	return validLocation(point) ? point : null;
}

/** Use one endpoint rule for a calculated route and its boarding/alighting markers. */
export function routeEndpointsMatch(
	first: Coordinates | undefined,
	last: Coordinates | undefined,
	start: Coordinates | null,
	end: Coordinates | null,
	snapDistance = 0
): boolean {
	const tolerance = Math.max(0, Number.isFinite(snapDistance) ? snapDistance : 0) + 2;
	const matches = (point: Coordinates | undefined, selected: Coordinates | null) => {
		if (!point || !validLocation({ latitude: point[1], longitude: point[0] })) return false;
		if (!selected) return true;
		if (!validLocation({ latitude: selected[1], longitude: selected[0] })) return false;
		const latitude = (((selected[1] + point[1]) / 2) * Math.PI) / 180;
		return (
			Math.hypot(
				(selected[0] - point[0]) * 111320 * Math.cos(latitude),
				(selected[1] - point[1]) * 111320
			) <= tolerance
		);
	};
	return matches(first, start) && matches(last, end);
}

export function providerRouteCoordinates(value: unknown): [number, number][] {
	if (!Array.isArray(value)) return [];
	// Do not join across invalid provider vertices; that would invent a route segment.
	const points: [number, number][] = [];
	for (const point of value) {
		if (
			!Array.isArray(point) ||
			point.length < 2 ||
			typeof point[0] !== 'number' ||
			typeof point[1] !== 'number' ||
			!validLocation({ latitude: point[1], longitude: point[0] })
		)
			return [];
		points.push([point[0], point[1]]);
	}
	return points.length > 1 ? points : [];
}
