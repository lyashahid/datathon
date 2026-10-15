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
