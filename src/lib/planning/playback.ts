import type { FeatureCollection, Point } from 'geojson';
import { distanceM } from './graph.ts';
import { calendarRuns, patternIsValid } from './routing.ts';
import type { PlanningServicePattern, PlanningStop, ScheduledTrip } from './types.ts';

export interface PlaybackProperties {
	id: string;
	patternId: string;
	tripId: string;
	mode: 'bus' | 'ferry';
	icon: 'playback-bus' | 'playback-ferry';
	label: string;
	bearing: number;
	illustration: true;
	timing: 'published-schedule' | 'frequency-illustration';
	clockMinutes: number;
	date: string;
}
export interface ServicePlaybackFrame {
	status: 'moving' | 'dwelling' | 'inactive' | 'unavailable';
	features: FeatureCollection<Point, PlaybackProperties>;
	label: string;
	reason: string | null;
	sourceLabel: string;
}
export interface ServicePlaybackOptions {
	pattern: PlanningServicePattern;
	stops: readonly PlanningStop[];
	date: string;
	clockMinutes: number;
	tripId?: string;
	sourceReferenceDate?: string;
}

const empty = (): FeatureCollection<Point, PlaybackProperties> => ({
	type: 'FeatureCollection',
	features: []
});
const finitePoint = (point: unknown): point is [number, number] =>
	Array.isArray(point) &&
	point.length >= 2 &&
	Number.isFinite(point[0]) &&
	Math.abs(point[0]) <= 180 &&
	Number.isFinite(point[1]) &&
	Math.abs(point[1]) <= 90;
const pos = ([lon, lat]: [number, number]) => ({ lon, lat });
function bearing(from: [number, number], to: [number, number]): number {
	const rad = Math.PI / 180;
	const delta = (to[0] - from[0]) * rad;
	const a = from[1] * rad,
		b = to[1] * rad;
	return (
		(Math.atan2(
			Math.sin(delta) * Math.cos(b),
			Math.cos(a) * Math.sin(b) - Math.sin(a) * Math.cos(b) * Math.cos(delta)
		) /
			rad +
			360) %
		360
	);
}

/** Constant progress along supplied geometry; never joins stops with an invented line. */
export function interpolatePlaybackGeometry(
	geometry: [number, number][],
	fraction: number
): { coordinates: [number, number]; bearing: number } | null {
	if (!geometry.length || !geometry.every(finitePoint) || !Number.isFinite(fraction)) return null;
	if (geometry.length === 1) return { coordinates: geometry[0], bearing: 0 };
	const lengths = geometry
		.slice(1)
		.map((point, index) => distanceM(pos(geometry[index]), pos(point)));
	const total = lengths.reduce((sum, length) => sum + length, 0);
	if (total <= 0) return { coordinates: geometry[0], bearing: 0 };
	const target = Math.max(0, Math.min(1, fraction)) * total;
	let travelled = 0;
	for (let index = 0; index < lengths.length; index++) {
		const length = lengths[index];
		if (length > 0 && (travelled + length >= target || index === lengths.length - 1)) {
			const ratio = Math.max(0, Math.min(1, (target - travelled) / length));
			const from = geometry[index],
				to = geometry[index + 1];
			return {
				coordinates: [from[0] + (to[0] - from[0]) * ratio, from[1] + (to[1] - from[1]) * ratio],
				bearing: bearing(from, to)
			};
		}
		travelled += length;
	}
	return { coordinates: geometry.at(-1)!, bearing: 0 };
}

function segmentGeometry(
	pattern: PlanningServicePattern,
	index: number,
	stops: Map<string, PlanningStop>,
	trip?: ScheduledTrip
): [number, number][] | null {
	const geometry =
		trip?.segmentGeometry?.[index] ??
		pattern.segmentGeometry?.[index] ??
		(pattern.stopIds.length === 2 ? pattern.geometry : undefined);
	const from = stops.get(pattern.stopIds[index]),
		to = stops.get(pattern.stopIds[index + 1]);
	if (!from || !to || !geometry || geometry.length < 2 || !geometry.every(finitePoint)) return null;
	// Supplied geometry must follow this direction and meet the stops. Reversed or
	// unrelated paths must not become a plausible-looking vehicle animation.
	if (distanceM(from, pos(geometry[0])) > 200 || distanceM(to, pos(geometry.at(-1)!)) > 200)
		return null;
	return geometry;
}

function frequencyTrip(pattern: PlanningServicePattern, clock: number): ScheduledTrip | null {
	if (pattern.timing.kind !== 'frequency') return null;
	const offset = pattern.timing.segmentMinutes.reduce((sum, minutes) => sum + minutes, 0);
	for (const window of pattern.timing.windows) {
		if (clock < window.startMinutes || clock > window.endMinutes + offset) continue;
		const departure = Math.min(
			window.startMinutes +
				Math.floor((clock - window.startMinutes) / window.headwayMinutes) * window.headwayMinutes,
			window.startMinutes +
				Math.floor((window.endMinutes - window.startMinutes) / window.headwayMinutes) *
					window.headwayMinutes
		);
		if (clock > departure + offset) continue;
		let at = departure;
		return {
			id: `illustration-${departure}`,
			stopTimes: pattern.stopIds.map((_, index) => {
				if (index)
					at += pattern.timing.kind === 'frequency' ? pattern.timing.segmentMinutes[index - 1] : 0;
				return { arrivalMinutes: at, departureMinutes: at };
			})
		};
	}
	return null;
}

/** One selected direction/trip only. The output is a schedule illustration, never
 * a tracking observation or an inference of the physical number of vehicles. */
export function servicePlaybackFrame(options: ServicePlaybackOptions): ServicePlaybackFrame {
	const { pattern, date, clockMinutes, tripId, sourceReferenceDate } = options;
	const isFrequency = pattern.timing.kind === 'frequency';
	const label = isFrequency
		? 'Frequency illustration'
		: pattern.provenance === 'observed'
			? 'Timetable illustration'
			: 'Scenario timetable illustration';
	const sourceLabel = `${pattern.provenance === 'observed' ? 'Published service evidence' : 'Assumed scenario service'}${sourceReferenceDate ? ` · source reference ${sourceReferenceDate}` : ''}. No live vehicle observations.`;
	const result = (
		status: ServicePlaybackFrame['status'],
		reason: string | null
	): ServicePlaybackFrame => ({ status, reason, features: empty(), label, sourceLabel });
	if (
		!Number.isFinite(clockMinutes) ||
		clockMinutes < 0 ||
		clockMinutes > 2880 ||
		!patternIsValid(pattern)
	)
		return result('unavailable', 'Valid service timings are required for playback.');
	if (pattern.enabled === false || !calendarRuns(pattern.calendar, date))
		return result('inactive', 'This direction does not run on the selected service date.');
	const stops = new Map(
		options.stops.filter((stop) => !stop.disabled).map((stop) => [stop.id, stop])
	);
	if (pattern.stopIds.some((id) => !stops.has(id)))
		return result('unavailable', 'A stop in this service is disabled or missing.');
	const trip =
		pattern.timing.kind === 'scheduled'
			? tripId
				? pattern.timing.trips.find((item) => item.id === tripId)
				: [...pattern.timing.trips]
						.sort(
							(a, b) =>
								a.stopTimes[0].departureMinutes - b.stopTimes[0].departureMinutes ||
								a.id.localeCompare(b.id)
						)
						.find(
							(item) =>
								clockMinutes >= item.stopTimes[0].arrivalMinutes &&
								clockMinutes <= item.stopTimes.at(-1)!.departureMinutes
						)
			: frequencyTrip(pattern, clockMinutes);
	if (
		!trip ||
		clockMinutes < trip.stopTimes[0].arrivalMinutes ||
		clockMinutes > trip.stopTimes.at(-1)!.departureMinutes
	)
		return result(
			'inactive',
			'No selected trip is operating at this clock time in the loaded service evidence.'
		);
	let point: { coordinates: [number, number]; bearing: number } | null = null;
	let status: ServicePlaybackFrame['status'] = 'dwelling';
	for (let index = 0; index < trip.stopTimes.length; index++) {
		const time = trip.stopTimes[index];
		if (clockMinutes >= time.arrivalMinutes && clockMinutes <= time.departureMinutes) {
			const stop = stops.get(pattern.stopIds[index])!;
			point = { coordinates: [stop.lon, stop.lat], bearing: 0 };
			break;
		}
		if (index === trip.stopTimes.length - 1) continue;
		const next = trip.stopTimes[index + 1];
		if (clockMinutes > time.departureMinutes && clockMinutes < next.arrivalMinutes) {
			const geometry = segmentGeometry(pattern, index, stops, trip);
			if (!geometry)
				return result(
					'unavailable',
					'Mapped geometry for this directed service segment is unavailable. No straight-line vehicle path is invented.'
				);
			point = interpolatePlaybackGeometry(
				geometry,
				(clockMinutes - time.departureMinutes) / (next.arrivalMinutes - time.departureMinutes)
			);
			status = 'moving';
			break;
		}
	}
	if (!point)
		return result('unavailable', 'A vehicle position cannot be illustrated from these stop times.');
	return {
		status,
		reason: null,
		label,
		sourceLabel,
		features: {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					id: `${pattern.id}:${trip.id}`,
					geometry: { type: 'Point', coordinates: point.coordinates },
					properties: {
						id: `${pattern.id}:${trip.id}`,
						patternId: pattern.id,
						tripId: trip.id,
						mode: pattern.mode,
						icon: pattern.mode === 'bus' ? 'playback-bus' : 'playback-ferry',
						label,
						bearing: point.bearing,
						illustration: true,
						timing: isFrequency ? 'frequency-illustration' : 'published-schedule',
						clockMinutes,
						date
					}
				}
			]
		}
	};
}

export function playbackClockBounds(pattern: PlanningServicePattern): [number, number] | null {
	if (!patternIsValid(pattern)) return null;
	if (pattern.timing.kind === 'scheduled')
		return [
			Math.min(...pattern.timing.trips.map((trip) => trip.stopTimes[0].arrivalMinutes)),
			Math.max(...pattern.timing.trips.map((trip) => trip.stopTimes.at(-1)!.departureMinutes))
		];
	return [
		Math.min(...pattern.timing.windows.map((window) => window.startMinutes)),
		Math.max(...pattern.timing.windows.map((window) => window.endMinutes)) +
			pattern.timing.segmentMinutes.reduce((sum, minutes) => sum + minutes, 0)
	];
}
