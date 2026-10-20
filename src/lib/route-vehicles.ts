import type { FeatureCollection, LineString, Point } from 'geojson';
import type { Coordinates } from './types.js';

export type RouteVehiclePath = {
	id: string;
	routeId?: string;
	name: string;
	mode: 'sea' | 'air';
	geometry: LineString | null;
	bidirectional?: boolean;
	schedule?: {
		serviceDate: string;
		sailings: { departure_minutes: number; arrival_minutes: number }[];
	};
};

export type PreparedRouteVehicle = {
	id: string;
	routeId?: string;
	name: string;
	mode: RouteVehiclePath['mode'];
	bidirectional?: boolean;
	coordinates: Coordinates[];
	distances: number[];
	length: number;
	phase: number;
	returnPhase: number;
	preparedAt: number;
	sailings: { departure: number; arrival: number }[];
};

export type RouteVehicleProperties = {
	kind: 'route_vehicle';
	route_id: string;
	mode: RouteVehiclePath['mode'];
	name: string;
	direction: 'outbound' | 'return';
	bearing: number;
	opacity: number;
	movement_basis: 'illustrative' | 'schedule_estimate';
};

const radians = Math.PI / 180;

// Shared physical defaults for illustrations, not measured vehicle velocities.
// 400 km/h is a domestic turboprop block-speed approximation below ATR cruise.
// 20 knots is a conservative common speed for the mixed fast-ferry network.
// Valid dated timetables retain their own actual distance / journey duration.
export const ROUTE_VEHICLE_SPEED_MPS = {
	sea: (20 * 1852) / 3600,
	air: 400_000 / 3600
} as const;

function distance(a: Coordinates, b: Coordinates): number {
	const latitude = Math.sin(((b[1] - a[1]) * radians) / 2);
	const longitude = Math.sin(((b[0] - a[0]) * radians) / 2);
	const square =
		latitude ** 2 + Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * longitude ** 2;
	return 12_742_000 * Math.asin(Math.sqrt(Math.min(1, square)));
}

function phase(id: string): number {
	let hash = 2166136261;
	for (let index = 0; index < id.length; index++)
		hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
	// Keep a frozen, reduced-motion symbol away from either endpoint.
	return 0.15 + ((hash >>> 0) / 4_294_967_296) * 0.7;
}

/** Prepare the original route polyline once; never rebuild it for animation frames. */
export function prepareRouteVehicles(
	paths: readonly RouteVehiclePath[],
	now = Date.now()
): PreparedRouteVehicle[] {
	const seen = new Set<string>();
	return paths.flatMap((path) => {
		const id = `${path.mode}:${path.id}`;
		if (seen.has(id) || !path.geometry || path.geometry.coordinates.length < 2) return [];
		const coordinates: Coordinates[] = [];
		const distances = [0];
		for (const point of path.geometry.coordinates) {
			if (
				point.length < 2 ||
				!Number.isFinite(point[0]) ||
				!Number.isFinite(point[1]) ||
				Math.abs(point[0]) > 180 ||
				Math.abs(point[1]) > 90
			)
				return []; // Never connect across an invalid/missing part of a corridor.
			const current: Coordinates = [point[0], point[1]];
			const previous = coordinates.at(-1);
			if (previous) {
				const segment = distance(previous, current);
				if (segment === 0) continue;
				distances.push(distances.at(-1)! + segment);
			}
			coordinates.push(current);
		}
		const length = distances.at(-1)!;
		if (coordinates.length < 2 || length <= 0) return [];
		// The retained timetables use Maldives time (UTC+5), including overnight carryovers.
		const midnight = path.schedule
			? Date.parse(`${path.schedule.serviceDate}T00:00:00+05:00`)
			: NaN;
		const sailings = Number.isFinite(midnight)
			? (path.schedule?.sailings ?? [])
					.filter(
						(run) =>
							Number.isFinite(run.departure_minutes) &&
							Number.isFinite(run.arrival_minutes) &&
							run.arrival_minutes > run.departure_minutes
					)
					.map((run) => ({
						departure: midnight + run.departure_minutes * 60_000,
						arrival: midnight + run.arrival_minutes * 60_000
					}))
					.sort((a, b) => a.departure - b.departure)
			: [];
		seen.add(id);
		return [
			{
				...path,
				coordinates,
				distances,
				length,
				phase: phase(id),
				returnPhase: phase(`${id}:return`),
				preparedAt: now,
				sailings
			}
		];
	});
}

/**
 * Illustrative vehicles per evidenced direction, never a LiveEvent.
 * Motion follows every segment of the supplied corridor, including its bends.
 * A retained two-stop timetable can anchor an approximate position while a sailing
 * is scheduled. Otherwise motion uses physical metres per second, never a fixed
 * screen-time loop. Pass an epoch-based clock to retain positions across reloads.
 */
export function routeVehicleFeatures(
	routes: readonly PreparedRouteVehicle[],
	elapsedSeconds: number,
	reducedMotion = false,
	now = Date.now()
): FeatureCollection<Point, RouteVehicleProperties> {
	const elapsed = Number.isFinite(elapsedSeconds) ? Math.max(0, elapsedSeconds) : 0;
	return {
		type: 'FeatureCollection',
		features: routes.flatMap((route) => {
			const positionTime = reducedMotion ? route.preparedAt : now;
			const sailing = route.sailings.findLast(
				(run) => positionTime >= run.departure && positionTime < run.arrival
			);
			const directions = route.bidirectional ? ([false, true] as const) : ([false] as const);
			return directions.map((returning) => {
				// A forward timetable cannot establish the position of a return sailing.
				const activeSailing = returning ? undefined : sailing;
				const initialPhase = returning ? route.returnPhase : route.phase;
				const progress = activeSailing
					? (positionTime - activeSailing.departure) /
						(activeSailing.arrival - activeSailing.departure)
					: reducedMotion
						? initialPhase
						: (initialPhase + (elapsed * ROUTE_VEHICLE_SPEED_MPS[route.mode]) / route.length) % 1;
				const target = (returning ? 1 - progress : progress) * route.length;
				let low = 1;
				let high = route.distances.length - 1;
				while (low < high) {
					const middle = (low + high) >>> 1;
					if (route.distances[middle] < target) low = middle + 1;
					else high = middle;
				}
				const start = route.coordinates[low - 1];
				const end = route.coordinates[low];
				const fraction =
					(target - route.distances[low - 1]) / (route.distances[low] - route.distances[low - 1]);
				const longitude = (end[0] - start[0]) * radians;
				const forwardBearing =
					(Math.atan2(
						Math.sin(longitude) * Math.cos(end[1] * radians),
						Math.cos(start[1] * radians) * Math.sin(end[1] * radians) -
							Math.sin(start[1] * radians) * Math.cos(end[1] * radians) * Math.cos(longitude)
					) /
						radians +
						360) %
					360;
				return {
					type: 'Feature',
					id: `${route.mode}:${route.id}${returning ? ':return' : ''}`,
					geometry: {
						type: 'Point',
						coordinates: [
							start[0] + (end[0] - start[0]) * fraction,
							start[1] + (end[1] - start[1]) * fraction
						]
					},
					properties: {
						kind: 'route_vehicle',
						route_id: route.routeId ?? route.id,
						mode: route.mode,
						name: route.name,
						direction: returning ? 'return' : 'outbound',
						bearing: returning ? (forwardBearing + 180) % 360 : forwardBearing,
						opacity:
							reducedMotion || activeSailing
								? 1
								: Math.max(0.25, Math.min(1, Math.min(progress, 1 - progress) * 24)),
						movement_basis: activeSailing ? 'schedule_estimate' : 'illustrative'
					}
				};
			});
		})
	};
}
