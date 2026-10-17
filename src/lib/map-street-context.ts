export type StreetBounds = [number, number, number, number];

// A city selection should keep the neighbouring capital islands mapped as well.
const CAPITAL_STREETS: StreetBounds = [73.46, 4.15, 73.59, 4.28];
const PRECISION = 1_000_000;

function validBounds(bounds: StreetBounds) {
	const [west, south, east, north] = bounds;
	return (
		bounds.length === 4 &&
		bounds.every(Number.isFinite) &&
		west >= -180 &&
		east <= 180 &&
		south >= -90 &&
		north <= 90 &&
		west < east &&
		south < north &&
		east - west <= 1 &&
		north - south <= 1
	);
}

export function containsStreetBounds(coverage: StreetBounds, viewport: StreetBounds): boolean {
	return (
		validBounds(coverage) &&
		validBounds(viewport) &&
		coverage[0] <= viewport[0] &&
		coverage[1] <= viewport[1] &&
		coverage[2] >= viewport[2] &&
		coverage[3] >= viewport[3]
	);
}

function intersectsCapital(viewport: StreetBounds) {
	return (
		viewport[0] <= CAPITAL_STREETS[2] &&
		viewport[2] >= CAPITAL_STREETS[0] &&
		viewport[1] <= CAPITAL_STREETS[3] &&
		viewport[3] >= CAPITAL_STREETS[1]
	);
}

/** Reuse padding only when it also preserves the neighbouring capital islands. */
export function canReuseStreetBounds(coverage: StreetBounds, viewport: StreetBounds): boolean {
	return (
		containsStreetBounds(coverage, viewport) &&
		(!intersectsCapital(viewport) || containsStreetBounds(coverage, CAPITAL_STREETS))
	);
}

function paddedAxis(minimum: number, maximum: number, worldLimit: number) {
	let low = Math.floor(minimum * PRECISION);
	let high = Math.ceil(maximum * PRECISION);
	// Multiplication can round a coordinate onto a grid line. Still round outwards.
	if (low / PRECISION > minimum) low--;
	if (high / PRECISION < maximum) high++;
	if (high - low > PRECISION) return null;
	const padding = Math.min(
		Math.ceil(((maximum - minimum) * PRECISION) / 4),
		Math.floor((PRECISION - (high - low)) / 2)
	);
	return [
		Math.max(-worldLimit, (low - padding) / PRECISION),
		Math.min(worldLimit, (high + padding) / PRECISION)
	];
}

/** A bounded street query with room to pan, shared across the capital islands. */
export function streetContextBounds(viewport: StreetBounds): StreetBounds | null {
	if (!validBounds(viewport)) return null;
	if (containsStreetBounds(CAPITAL_STREETS, viewport)) return [...CAPITAL_STREETS];

	let bounds = viewport;
	if (intersectsCapital(viewport)) {
		const combined: StreetBounds = [
			Math.min(viewport[0], CAPITAL_STREETS[0]),
			Math.min(viewport[1], CAPITAL_STREETS[1]),
			Math.max(viewport[2], CAPITAL_STREETS[2]),
			Math.max(viewport[3], CAPITAL_STREETS[3])
		];
		if (validBounds(combined)) bounds = combined;
	}
	const longitude = paddedAxis(bounds[0], bounds[2], 180);
	const latitude = paddedAxis(bounds[1], bounds[3], 90);
	if (!longitude || !latitude) return null;
	const result: StreetBounds = [longitude[0], latitude[0], longitude[1], latitude[1]];
	return containsStreetBounds(result, bounds) ? result : null;
}
