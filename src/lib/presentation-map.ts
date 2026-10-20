import type { FeatureCollection, LineString, Point } from 'geojson';
import type { Coordinates } from './types.js';

export type PresentationMode = 'ferry' | 'air' | 'bus' | 'walk' | 'transfer';
export type PresentationProgress = {
	key: string;
	progress: number;
	phase: 'idle' | 'entering' | 'playing' | 'paused' | 'complete';
};
type PresentationCameraMotion = { durationMs?: number; pitch?: number; bearing?: number };
export type PresentationMapScene = {
	key: string;
	paths: Array<{ mode: PresentationMode; coordinates: Coordinates[] }>;
	camera: (
		{ center: Coordinates; zoom: number } | { bounds: [Coordinates, Coordinates]; maxZoom?: number }
	) &
		PresentationCameraMotion;
	playback?: {
		durationMs: number;
		follow?: boolean;
		label?: string;
		clockMinutes?: number;
		/** Hold the full route before approaching the vehicle; journey time stays paused. */
		establishMs?: number;
	};
	population?: FeatureCollection;
	panel?: 'island' | 'route';
	emphasis?: { quietContext?: boolean; proposalPoint?: Coordinates };
	inspect?: {
		mode: 'ferry' | 'air';
		routeId: string;
		coordinates: Coordinates;
		summary?: {
			title: string;
			minutes: number | null;
			weeklySailings: number | null;
			qualification: string;
			timingLabel?: string;
			frequencyLabel?: string;
		};
	};
};

/** Reserve only occupied presentation UI and center the subject in the remaining canvas. */
export function presentationCameraPadding(
	width: number,
	height: number,
	panel?: PresentationMapScene['panel']
) {
	const top = Math.min(width <= 700 ? 176 : 184, Math.max(24, height * 0.27));
	const bottom = Math.min(
		panel && width <= 700 ? Math.round(height * 0.43) + 98 : 104,
		Math.max(24, height - top - 140)
	);
	return {
		top,
		right: width > 700 && panel ? 458 : width <= 700 ? 24 : 64,
		bottom,
		left: width <= 700 ? 24 : 64
	};
}

/** Only supplied journey minutes represent travel time; otherwise this clocks the animation. */
export function presentationClock(
	progress: number,
	playback: NonNullable<PresentationMapScene['playback']>
): { elapsed: string; total: string; qualification: string } {
	const journeySeconds = (playback.clockMinutes ?? NaN) * 60;
	const hasJourneyClock = Number.isFinite(journeySeconds) && journeySeconds > 0;
	const playbackSeconds =
		Number.isFinite(playback.durationMs) && playback.durationMs > 0
			? playback.durationMs / 1000
			: 0;
	const totalSeconds = Math.ceil(hasJourneyClock ? journeySeconds : playbackSeconds);
	const fraction = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
	const elapsedSeconds = Math.floor(fraction * totalSeconds);
	const format = (seconds: number) =>
		`${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
	return {
		elapsed: format(elapsedSeconds),
		total: format(totalSeconds),
		qualification: hasJourneyClock ? 'Accelerated journey' : 'Playback time'
	};
}

type PreparedPath = {
	mode: PresentationMode;
	coordinates: Coordinates[];
	distances: number[];
	length: number;
};

function validPoint(point: number[]): point is Coordinates {
	return (
		point.length === 2 &&
		point.every(Number.isFinite) &&
		Math.abs(point[0]) <= 180 &&
		Math.abs(point[1]) <= 90
	);
}

/** Prepare only complete source paths. Separate legs never gain a fabricated joining line. */
export function preparePresentationPaths(paths: PresentationMapScene['paths']): PreparedPath[] {
	return paths.flatMap((path) => {
		if (path.coordinates.length < 2 || !path.coordinates.every(validPoint)) return [];
		const distances = [0];
		for (let index = 1; index < path.coordinates.length; index++) {
			const previous = path.coordinates[index - 1];
			const point = path.coordinates[index];
			const x = (point[0] - previous[0]) * Math.cos(((point[1] + previous[1]) * Math.PI) / 360);
			const y = point[1] - previous[1];
			distances.push(distances.at(-1)! + Math.hypot(x, y));
		}
		const length = distances.at(-1)!;
		return length > 0 ? [{ ...path, distances, length }] : [];
	});
}

/** Fit the actual complete legs, including their endpoints, without inventing a joining line. */
export function presentationPathBounds(paths: PreparedPath[]): [Coordinates, Coordinates] | null {
	const points = paths.flatMap((path) => path.coordinates);
	if (!points.length) return null;
	return [
		[
			Math.min(...points.map(([longitude]) => longitude)),
			Math.min(...points.map(([, latitude]) => latitude))
		],
		[
			Math.max(...points.map(([longitude]) => longitude)),
			Math.max(...points.map(([, latitude]) => latitude))
		]
	];
}

export function presentationRouteFeatures(paths: PreparedPath[]): FeatureCollection<LineString> {
	return {
		type: 'FeatureCollection',
		features: paths.map((path, index) => ({
			type: 'Feature',
			id: index,
			properties: { mode: path.mode },
			geometry: { type: 'LineString', coordinates: path.coordinates }
		}))
	};
}

/** Accelerated presentation progress, explicitly independent of timetable or live positions. */
export function presentationPosition(paths: PreparedPath[], fraction: number) {
	const total = paths.reduce((sum, path) => sum + path.length, 0);
	if (!paths.length || !Number.isFinite(fraction)) return null;
	let target = Math.max(0, Math.min(1, fraction)) * total;
	let path = paths.at(-1)!;
	for (const candidate of paths) {
		path = candidate;
		if (target <= path.length) break;
		target -= path.length;
	}
	for (let index = 1; index < path.coordinates.length; index++) {
		if (target > path.distances[index] && index < path.coordinates.length - 1) continue;
		const start = path.coordinates[index - 1];
		const end = path.coordinates[index];
		const distance = path.distances[index] - path.distances[index - 1];
		const part =
			distance > 0 ? Math.max(0, Math.min(1, (target - path.distances[index - 1]) / distance)) : 0;
		return {
			point: [
				start[0] + (end[0] - start[0]) * part,
				start[1] + (end[1] - start[1]) * part
			] as Coordinates,
			mode: path.mode,
			bearing: (Math.atan2(end[0] - start[0], end[1] - start[1]) * 180) / Math.PI
		};
	}
	return null;
}

export function presentationVehicleFeatures(
	position: ReturnType<typeof presentationPosition>
): FeatureCollection<Point> {
	return {
		type: 'FeatureCollection',
		features: position
			? [
					{
						type: 'Feature',
						properties: { mode: position.mode, bearing: position.bearing },
						geometry: { type: 'Point', coordinates: position.point }
					}
				]
			: []
	};
}
