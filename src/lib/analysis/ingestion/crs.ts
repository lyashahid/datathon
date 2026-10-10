import type { Position } from '#lib/types/domain.ts';
import type { Crs } from './types.ts';

// WGS84 ellipsoid and UTM constants.
const A = 6378137;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const EP2 = E2 / (1 - E2);
const K0 = 0.9996;
const FALSE_EASTING = 500000;
/** UTM zone 43N (EPSG:32643) covers the Maldives. */
const UTM43_CENTRAL_MERIDIAN = 75;

const deg = (r: number) => (r * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

function meridianArc(phi: number): number {
	const e4 = E2 * E2;
	const e6 = e4 * E2;
	return (
		A *
		((1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * phi -
			((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * phi) +
			((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * phi) -
			((35 * e6) / 3072) * Math.sin(6 * phi))
	);
}

/** WGS84 lon/lat → UTM 43N metres (northern hemisphere). Used for fixtures and round-trip tests. */
export function wgs84ToUtm43([lng, lat]: Position): Position {
	const phi = rad(lat);
	const n = A / Math.sqrt(1 - E2 * Math.sin(phi) ** 2);
	const t = Math.tan(phi) ** 2;
	const c = EP2 * Math.cos(phi) ** 2;
	const a = Math.cos(phi) * rad(lng - UTM43_CENTRAL_MERIDIAN);
	const easting =
		K0 *
			n *
			(a + ((1 - t + c) * a ** 3) / 6 + ((5 - 18 * t + t * t + 72 * c - 58 * EP2) * a ** 5) / 120) +
		FALSE_EASTING;
	const northing =
		K0 *
		(meridianArc(phi) +
			n *
				Math.tan(phi) *
				((a * a) / 2 +
					((5 - t + 9 * c + 4 * c * c) * a ** 4) / 24 +
					((61 - 58 * t + t * t + 600 * c - 330 * EP2) * a ** 6) / 720));
	return [easting, northing];
}

function utm43ToWgs84([easting, northing]: Position): Position {
	const m = northing / K0;
	const mu = m / (A * (1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256));
	const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
	const phi1 =
		mu +
		((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
		((21 * e1 * e1) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
		((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
		((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
	const sin1 = Math.sin(phi1);
	const n1 = A / Math.sqrt(1 - E2 * sin1 * sin1);
	const t1 = Math.tan(phi1) ** 2;
	const c1 = EP2 * Math.cos(phi1) ** 2;
	const r1 = (A * (1 - E2)) / (1 - E2 * sin1 * sin1) ** 1.5;
	const d = (easting - FALSE_EASTING) / (n1 * K0);
	const lat =
		phi1 -
		((n1 * Math.tan(phi1)) / r1) *
			((d * d) / 2 -
				((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d ** 4) / 24 +
				((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d ** 6) / 720);
	const lng =
		(d -
			((1 + 2 * t1 + c1) * d ** 3) / 6 +
			((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5) / 120) /
		Math.cos(phi1);
	return [UTM43_CENTRAL_MERIDIAN + deg(lng), deg(lat)];
}

function webMercatorToWgs84([x, y]: Position): Position {
	return [deg(x / A), deg(2 * Math.atan(Math.exp(y / A)) - Math.PI / 2)];
}

/** Converts a coordinate pair to WGS84 lon/lat. Returns null for non-finite input. */
export function toWgs84(p: readonly unknown[], crs: Crs): Position | null {
	const [x, y] = p;
	if (
		typeof x !== 'number' ||
		typeof y !== 'number' ||
		!Number.isFinite(x) ||
		!Number.isFinite(y)
	) {
		return null;
	}
	if (crs === 'EPSG:3857') return webMercatorToWgs84([x, y]);
	if (crs === 'EPSG:32643') return utm43ToWgs84([x, y]);
	return [x, y];
}

export function isValidLngLat([lng, lat]: Position): boolean {
	return (
		Number.isFinite(lng) && Number.isFinite(lat) && Math.abs(lng) <= 180 && Math.abs(lat) <= 90
	);
}
