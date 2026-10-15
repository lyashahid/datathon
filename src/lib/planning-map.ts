import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { Coordinates } from './types.js';

export type PlanningPlace = {
	id: string;
	name?: string;
	kind?: string;
	islandId: string;
	lon: number;
	lat: number;
	population2026?: number;
};
export type PlanningLeg = {
	mode: string;
	from: string;
	to: string;
	minutes: number;
	wait_minutes: number;
	geometry: number[][];
	geometry_source?: string;
	geometry_warning?: string;
	departure_minutes?: number;
	arrival_minutes?: number;
};
export type PlanningJourney = {
	status: string;
	minutes: number | null;
	destination_id: string | null;
	reason: string | null;
	path: PlanningLeg[];
	geometry: number[][];
};
export type PlanningComparison = {
	origin_id: string;
	population: number;
	coordinates: number[];
	before: PlanningJourney;
	after: PlanningJourney;
	delta_minutes: number | null;
	gained_access: boolean;
	lost_access: boolean;
	became_unavailable: boolean;
};
export type PlanningOperation = {
	type: string;
	target_id?: string;
	island_id?: string;
	coordinates?: number[];
	name?: string;
	service?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
};
export const impactColors: Record<string, string> = {
	gained: '#16866e',
	improved: '#69bba5',
	lost: '#c44e55',
	slower: '#df9272',
	unchanged: '#889ea1',
	unavailable: '#a6a5b5',
	disrupted: '#be9344',
	uncomputed: '#b7c3c4'
};
export function impactClass(row: PlanningComparison): string {
	if (row.became_unavailable) return 'disrupted';
	if (row.after.status !== 'reachable') return 'unavailable';
	if (row.gained_access) return 'gained';
	if (row.lost_access) return 'lost';
	if (row.delta_minutes !== null && row.delta_minutes > 0.05) return 'improved';
	if (row.delta_minutes !== null && row.delta_minutes < -0.05) return 'slower';
	return 'unchanged';
}
export function validPoint(value: unknown): value is Coordinates {
	return (
		Array.isArray(value) &&
		value.length >= 2 &&
		typeof value[0] === 'number' &&
		typeof value[1] === 'number' &&
		Number.isFinite(value[0]) &&
		Number.isFinite(value[1]) &&
		Math.abs(value[0]) <= 180 &&
		Math.abs(value[1]) <= 90
	);
}
export function collection(features: Feature<Geometry>[] = []): FeatureCollection {
	return { type: 'FeatureCollection', features };
}
/** Visual cells at modeled origins. They do not imply census boundaries or a measured footprint. */
export function impactHexes(
	origins: PlanningPlace[],
	comparisons: PlanningComparison[]
): FeatureCollection {
	const byId = new Map(comparisons.map((row) => [row.origin_id, row]));
	return collection(
		origins
			.filter((origin) => validPoint([origin.lon, origin.lat]))
			.map((origin) => {
				const row = byId.get(origin.id);
				const radius = 43;
				const points: Coordinates[] = Array.from({ length: 6 }, (_, i) => {
					const angle = (Math.PI / 3) * i;
					return [
						origin.lon +
							(radius * Math.cos(angle)) / (111320 * Math.cos((origin.lat * Math.PI) / 180)),
						origin.lat + (radius * Math.sin(angle)) / 111320
					];
				});
				points.push(points[0]);
				return {
					type: 'Feature',
					id: origin.id,
					properties: {
						id: origin.id,
						impact: row ? impactClass(row) : 'uncomputed',
						color: impactColors[row ? impactClass(row) : 'uncomputed'],
						population: row?.population ?? origin.population2026 ?? null,
						before: row?.before.minutes ?? null,
						after: row?.after.minutes ?? null,
						delta: row?.delta_minutes ?? null
					},
					geometry: { type: 'Polygon', coordinates: [points] }
				};
			})
	);
}
export function routeFeatures(
	journey: PlanningJourney | null,
	direction: string
): FeatureCollection {
	return collection(
		(journey?.path ?? []).flatMap((leg, index) => {
			const points = leg.geometry.filter(validPoint);
			return points.length > 1
				? [
						{
							type: 'Feature' as const,
							properties: { mode: leg.mode, direction, index },
							geometry: { type: 'LineString' as const, coordinates: points }
						}
					]
				: [];
		})
	);
}
function distance(first: Coordinates, second: Coordinates): number {
	const y = (second[1] - first[1]) * 111320;
	const x = (second[0] - first[0]) * 111320 * Math.cos(((first[1] + second[1]) * Math.PI) / 360);
	return Math.hypot(x, y);
}
export function pointOnLine(geometry: number[][], fraction: number): Coordinates | null {
	return measureLine(geometry)(fraction);
}

/** Measure each immutable provider path once, then sample it without per-frame arrays. */
function measureLine(geometry: number[][]): (fraction: number) => Coordinates | null {
	const points = geometry.filter(validPoint);
	const lengths = points.slice(1).map((point, index) => distance(points[index], point));
	const totalLength = lengths.reduce((sum, length) => sum + length, 0);
	return (fraction) => pointOnMeasuredLine(points, lengths, totalLength, fraction);
}

function pointOnMeasuredLine(
	points: Coordinates[],
	lengths: number[],
	totalLength: number,
	fraction: number
): Coordinates | null {
	if (!points.length) return null;
	if (points.length === 1) return points[0];
	let remaining = totalLength * Math.max(0, Math.min(1, fraction));
	for (let index = 0; index < lengths.length; index++) {
		if (remaining <= lengths[index]) {
			const ratio = lengths[index] ? remaining / lengths[index] : 0;
			return [
				points[index][0] + (points[index + 1][0] - points[index][0]) * ratio,
				points[index][1] + (points[index + 1][1] - points[index][1]) * ratio
			];
		}
		remaining -= lengths[index];
	}
	return points[points.length - 1];
}
export type PlaybackPosition = {
	point: Coordinates | null;
	mode: string;
	phase: string;
	legIndex: number;
};

/** Elapsed-time playback honors waits; position interpolation is illustrative, never GPS. */
export function createPlaybackSampler(
	journey: PlanningJourney | null
): (elapsed: number) => PlaybackPosition {
	const lines = (journey?.path ?? []).map((leg) => measureLine(leg.geometry));
	return (elapsed) => sampledPlaybackPosition(journey, lines, elapsed);
}

export function playbackPosition(
	journey: PlanningJourney | null,
	elapsed: number
): PlaybackPosition {
	return createPlaybackSampler(journey)(elapsed);
}

function sampledPlaybackPosition(
	journey: PlanningJourney | null,
	lines: ((fraction: number) => Coordinates | null)[],
	elapsed: number
): PlaybackPosition {
	if (journey?.minutes != null && elapsed >= journey.minutes && journey.path.length) {
		const last = journey.path.at(-1)!;
		return {
			point: lines.at(-1)!(1),
			mode: last.mode,
			phase: 'Arrived',
			legIndex: journey.path.length - 1
		};
	}
	let cursor = 0;
	for (const [index, leg] of (journey?.path ?? []).entries()) {
		const wait = Math.max(0, leg.wait_minutes);
		const travel = Math.max(0, leg.minutes);
		if (elapsed < cursor + wait)
			return {
				point: lines[index](0),
				mode: leg.mode,
				phase: 'Waiting to board',
				legIndex: index
			};
		cursor += wait;
		if (elapsed < cursor + travel)
			return {
				point: lines[index](travel ? (elapsed - cursor) / travel : 1),
				mode: leg.mode,
				phase: leg.mode === 'walk' ? 'Walking' : `On the ${leg.mode}`,
				legIndex: index
			};
		cursor += travel;
	}
	const last = journey?.path.at(-1);
	return {
		point: last ? lines.at(-1)!(1) : null,
		mode: last?.mode ?? 'walk',
		phase: 'Arrived',
		legIndex: Math.max(0, (journey?.path.length ?? 1) - 1)
	};
}
