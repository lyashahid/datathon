import type { FeatureCollection } from 'geojson';
import type { PlanningOperation } from './planning-map.js';
import { serviceCalendarRuns, type ServiceCalendar } from './proposal-experience.js';

type StopTime = { arrivalMinutes: number; departureMinutes: number };
type ServiceTrip = { id: string; stopTimes: StopTime[] };
type FrequencyWindow = { startMinutes: number; endMinutes: number; headwayMinutes: number };
export type TransportServicePattern = {
	id: string;
	routeId?: string;
	name: string;
	mode: string;
	stopIds: string[];
	calendar?: ServiceCalendar;
	enabled?: boolean;
	fleet?: 'diesel' | 'electric';
	distanceM?: number;
	geometry?: number[][];
	segmentGeometries?: number[][][];
	timing?:
		| { kind: 'scheduled'; trips: ServiceTrip[] }
		| { kind: 'frequency'; segmentMinutes: number[]; windows: FrequencyWindow[] };
};
export type ServiceTimingSummary = {
	headwayMinutes: number | null;
	headwayVaries: boolean;
	windowLabel: string;
	departureCount: number;
	error: string | null;
};
type SourceSchedule = {
	trips: ServiceTrip[];
	windows: { start: number; end: number }[];
	summary: ServiceTimingSummary;
};
const finite = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);

function clock(minute: number): string {
	const rounded = Math.round(minute);
	return `${String(Math.floor(rounded / 60) % 24).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}${rounded >= 1440 ? ' (+1 day)' : ''}`;
}

function sourceSchedule(
	pattern: TransportServicePattern | null | undefined,
	date: string
): SourceSchedule {
	const empty = (error: string): SourceSchedule => ({
		trips: [],
		windows: [],
		summary: {
			headwayMinutes: null,
			headwayVaries: false,
			windowLabel: '',
			departureCount: 0,
			error
		}
	});
	if (!pattern || !['bus', 'ferry'].includes(pattern.mode))
		return empty('Choose a recorded bus or ferry line.');
	if (pattern.enabled === false) return empty('This line is disabled. Choose an active service.');
	if (!serviceCalendarRuns(pattern.calendar, date))
		return empty('No recorded departures on this date. Choose a recorded service date.');
	if (!Array.isArray(pattern.stopIds) || pattern.stopIds.length < 2 || !pattern.timing)
		return empty(
			'This line needs a recorded stop sequence and timetable before it can be changed.'
		);
	let trips: ServiceTrip[];
	let windows: SourceSchedule['windows'];
	const timing = pattern.timing;
	if (timing.kind === 'scheduled') {
		if (!Array.isArray(timing.trips) || timing.trips.length > 3000)
			return empty('This timetable cannot be used to plan additional departures.');
		for (const trip of timing.trips) {
			if (!Array.isArray(trip.stopTimes) || trip.stopTimes.length !== pattern.stopIds.length)
				return empty('A recorded trip is missing stop times. Review its timetable first.');
			let prior = 0;
			for (const time of trip.stopTimes) {
				if (
					!finite(time.arrivalMinutes) ||
					!finite(time.departureMinutes) ||
					time.arrivalMinutes < prior ||
					time.departureMinutes < time.arrivalMinutes ||
					time.departureMinutes > 2880
				)
					return empty('A recorded trip has incomplete or out-of-order times. Review it first.');
				prior = time.departureMinutes;
			}
		}
		trips = timing.trips
			.filter((trip) => trip.stopTimes[0].departureMinutes < 1440)
			.toSorted((a, b) => a.stopTimes[0].departureMinutes - b.stopTimes[0].departureMinutes);
		windows = trips.length
			? [
					{
						start: trips[0].stopTimes[0].departureMinutes,
						end: trips.at(-1)!.stopTimes[0].departureMinutes
					}
				]
			: [];
	} else if (timing.kind === 'frequency') {
		if (
			!Array.isArray(timing.segmentMinutes) ||
			timing.segmentMinutes.length !== pattern.stopIds.length - 1 ||
			timing.segmentMinutes.some((minute) => !finite(minute) || minute <= 0) ||
			!Array.isArray(timing.windows) ||
			!timing.windows.length ||
			timing.windows.length > 20
		)
			return empty('This line needs complete journey times and operating windows.');
		const ordered = timing.windows.toSorted((a, b) => a.startMinutes - b.startMinutes);
		if (
			ordered.some(
				(window, index) =>
					!finite(window.startMinutes) ||
					!finite(window.endMinutes) ||
					!finite(window.headwayMinutes) ||
					window.startMinutes < 0 ||
					window.endMinutes > 2880 ||
					window.endMinutes <= window.startMinutes ||
					window.headwayMinutes < 1 ||
					window.headwayMinutes > 720 ||
					(index > 0 && window.startMinutes < ordered[index - 1].endMinutes)
			)
		)
			return empty('This line has incomplete or overlapping operating windows. Review them first.');
		trips = [];
		windows = [];
		for (const window of ordered) {
			const end = Math.min(window.endMinutes, 1440);
			if (window.startMinutes >= end) continue;
			windows.push({ start: window.startMinutes, end });
			for (
				let departure = window.startMinutes;
				departure < end;
				departure += window.headwayMinutes
			) {
				let minute = departure;
				const stopTimes = [{ arrivalMinutes: minute, departureMinutes: minute }];
				for (const duration of timing.segmentMinutes) {
					minute += duration;
					stopTimes.push({ arrivalMinutes: minute, departureMinutes: minute });
				}
				if (minute > 2880) return empty('This journey exceeds the supported two-day horizon.');
				trips.push({ id: `source:${trips.length}`, stopTimes });
			}
		}
	} else return empty('This line needs a recorded timetable before it can be changed.');
	if (!trips.length)
		return empty('No departures start on the selected date. Choose another service date.');
	const departures = [...new Set(trips.map((trip) => trip.stopTimes[0].departureMinutes))];
	const gaps = departures.slice(1).map((departure, index) => departure - departures[index]);
	// Frequency-window gaps are deliberate closures, not the normal service interval.
	const intervals =
		timing.kind === 'frequency'
			? timing.windows
					.filter((window) => window.startMinutes < 1440)
					.map((window) => window.headwayMinutes)
			: gaps;
	const sorted = intervals.toSorted((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	const headway = sorted.length
		? (sorted[middle] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2
		: null;
	return {
		trips,
		windows,
		summary: {
			headwayMinutes: headway,
			headwayVaries: intervals.some((value) => value !== headway),
			windowLabel: `${timing.kind === 'frequency' ? 'Operating windows' : 'Recorded departures'}: ${windows.map((window) => `${clock(window.start)}–${clock(window.end)}`).join(', ')}`,
			departureCount: trips.length,
			error: null
		}
	};
}

/** Prefill from dated evidence; never turn an inactive capture into a recurring timetable. */
export function serviceTimingSummary(
	pattern: TransportServicePattern | null | undefined,
	date: string
): ServiceTimingSummary {
	return sourceSchedule(pattern, date).summary;
}

function additionalServiceRunsOnDate(calendar: unknown, date: string): boolean {
	// Restored operations are untrusted. An incomplete calendar cannot establish that dates differ.
	if (!calendar || typeof calendar !== 'object' || Array.isArray(calendar)) return true;
	const fields = calendar as Record<string, unknown>;
	for (const name of ['includedDates', 'excludedDates', 'weekdays']) {
		const values = fields[name];
		if (
			values !== undefined &&
			(!Array.isArray(values) ||
				values.some((value) =>
					name === 'weekdays'
						? !finite(value) || !Number.isInteger(value) || value < 0 || value > 6
						: typeof value !== 'string'
				))
		)
			return true;
	}
	if (
		['startDate', 'endDate'].some(
			(name) => fields[name] !== undefined && typeof fields[name] !== 'string'
		)
	)
		return true;
	return serviceCalendarRuns(calendar as ServiceCalendar, date);
}

function serviceConflict(
	pattern: TransportServicePattern,
	date: string,
	intent: 'add' | 'improve',
	operations: PlanningOperation[],
	pendingId: string
): string | null {
	const sourceChanges = operations.filter((operation) => operation.target_id === pattern.id);
	if (
		sourceChanges.some((operation) =>
			['disable_service', 'replace_service'].includes(operation.type)
		)
	)
		return 'This line is disabled or replaced in your proposal. Remove that change before changing its departures.';
	if (
		sourceChanges.some((operation) =>
			[
				'set_hours',
				'shift_timetable',
				...(intent === 'add' ? ['set_frequency', 'set_fleet'] : [])
			].includes(operation.type)
		)
	)
		return intent === 'add'
			? 'This line already has a timetable or fleet change. Use Improve bus line, or remove that change before adding buses.'
			: 'This line already has a changed operating timetable. Remove that change before improving its frequency.';
	const hasAdditionalService = operations.some((operation) => {
		if (operation.type !== 'add_service') return false;
		const service = operation.service;
		if (!service || (intent === 'add' && service.id === pendingId)) return false;
		const sameSource = operation.metadata?.ui_source_pattern_id === pattern.id;
		const sameDirection =
			service.mode === pattern.mode &&
			Boolean(pattern.routeId) &&
			service.routeId === pattern.routeId &&
			Array.isArray(service.stopIds) &&
			service.stopIds.length === pattern.stopIds.length &&
			service.stopIds.every((stop, index) => stop === pattern.stopIds[index]);
		return (sameSource || sameDirection) && additionalServiceRunsOnDate(service.calendar, date);
	});
	if (hasAdditionalService)
		return `This line already has additional departures on ${date}. Remove that change before ${intent === 'add' ? 'adding more buses' : 'improving this line'}.`;
	return null;
}

/** Extra departures supplement a line; frequency edits deliberately replace its departure interval. */
export function transportServiceOperations(input: {
	pattern: TransportServicePattern | null | undefined;
	intent: 'add' | 'improve';
	headway: number | string;
	date: string;
	proposalId: string;
	islandId?: string | null;
	operations: PlanningOperation[];
	mapFeatures?: FeatureCollection;
}): {
	operations: PlanningOperation[] | null;
	error: string | null;
	addedDepartures: number;
	summary: ServiceTimingSummary;
} {
	const { pattern, date, operations } = input;
	const source = sourceSchedule(pattern, date);
	const fail = (error: string) => ({
		operations: null,
		error,
		addedDepartures: 0,
		summary: source.summary
	});
	if (source.summary.error || !pattern)
		return fail(source.summary.error || 'Choose a recorded line.');
	const headway =
		typeof input.headway === 'string' && !input.headway.trim() ? NaN : Number(input.headway);
	if (!Number.isFinite(headway) || headway < 1 || headway > 720)
		return fail('Choose a departure interval between 1 and 720 minutes.');
	const id = `proposal:bus-extra:${input.proposalId}`;
	const conflict = serviceConflict(pattern, date, input.intent, operations, id);
	if (conflict) return fail(conflict);
	if (
		input.intent === 'improve' &&
		!source.summary.headwayVaries &&
		source.summary.headwayMinutes !== null &&
		headway >= source.summary.headwayMinutes
	)
		return fail(
			`Choose an interval below ${source.summary.headwayMinutes} minutes to run this line more often.`
		);
	let next: PlanningOperation[];
	let addedDepartures = 0;
	if (input.intent === 'improve') {
		next = [
			...operations.filter(
				(operation) => !(operation.type === 'set_frequency' && operation.target_id === pattern.id)
			),
			{
				type: 'set_frequency',
				target_id: pattern.id,
				island_id: input.islandId ?? undefined,
				headway_minutes: headway,
				name: `${pattern.name} · every ${headway} min`,
				metadata: { ui_map_features: input.mapFeatures }
			}
		];
	} else {
		if (pattern.mode !== 'bus')
			return fail('Use the ferry connection planner to add a ferry service.');
		if (!pattern.routeId || !/^[A-Za-z0-9_-]{1,100}$/.test(input.proposalId))
			return fail('Choose a recorded route before adding bus departures.');
		const departures = source.trips.map((trip) => trip.stopTimes[0].departureMinutes);
		const gaps = departures
			.slice(1)
			.map((minute, index) => minute - departures[index])
			.filter((gap) => gap > 0);
		const phase = Math.min(headway / 2, gaps.length ? Math.min(...gaps) / 2 : headway / 2);
		const trips: ServiceTrip[] = [];
		for (const window of source.windows) {
			for (let departure = window.start + phase; departure < window.end; departure += headway) {
				// A simultaneous copy costs more but cannot shorten a wait. Keep the added timetable staggered.
				if (departures.some((minute) => Math.abs(minute - departure) < 0.001)) continue;
				const template =
					source.trips.findLast((trip) => trip.stopTimes[0].departureMinutes <= departure) ??
					source.trips[0];
				const offset = departure - template.stopTimes[0].departureMinutes;
				const stopTimes = template.stopTimes.map((time) => ({
					arrivalMinutes: time.arrivalMinutes + offset,
					departureMinutes: time.departureMinutes + offset
				}));
				if (stopTimes.at(-1)!.departureMinutes > 2880) continue;
				trips.push({ id: `${id}:${trips.length}`, stopTimes });
			}
		}
		if (!trips.length)
			return fail(
				'No additional departure fits between the recorded service times. Choose a shorter interval or another line.'
			);
		addedDepartures = trips.length;
		const service = {
			id,
			// Existing and supplementary trips share a real line's vehicle blocks; buying a bus is not assumed.
			routeId: pattern.routeId,
			name: `${pattern.name} · additional buses every ${headway} min`,
			mode: 'bus',
			fleet: pattern.fleet ?? 'diesel',
			stopIds: [...pattern.stopIds],
			calendar: { includedDates: [date], weekdays: [] },
			timing: { kind: 'scheduled', trips },
			...(finite(pattern.distanceM) && pattern.distanceM > 0
				? { distanceM: pattern.distanceM }
				: {})
		};
		next = [
			...operations.filter(
				(operation) => !(operation.type === 'add_service' && operation.service?.id === id)
			),
			{
				type: 'add_service',
				island_id: input.islandId ?? undefined,
				name: service.name,
				service,
				metadata: {
					ui_source_pattern_id: pattern.id,
					transport_kind: 'additional_bus_service',
					ui_map_features: input.mapFeatures
				}
			}
		];
	}
	if (next.length > 100)
		return fail('This proposal has reached its 100-change limit. Remove a change first.');
	return { operations: next, error: null, addedDepartures, summary: source.summary };
}
