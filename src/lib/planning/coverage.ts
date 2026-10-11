import { calendarRuns, patternIsValid } from './routing.ts';
import type {
	PlanningAssumptions,
	PlanningBaseline,
	PlanningCoverage,
	PlanningServicePattern
} from './types.ts';

function windowFor(
	pattern: PlanningServicePattern,
	boardingIndices = pattern.stopIds.slice(0, -1).map((_, index) => index)
): [number, number] | null {
	if (!patternIsValid(pattern)) return null;
	if (!boardingIndices.length) return null;
	if (pattern.timing.kind === 'frequency') {
		const offsets = boardingIndices.map((index) =>
			pattern.timing.kind === 'frequency'
				? pattern.timing.segmentMinutes.slice(0, index).reduce((s, n) => s + n, 0)
				: 0
		);
		return [
			Math.min(...pattern.timing.windows.map((w) => w.startMinutes)) + Math.min(...offsets),
			Math.max(...pattern.timing.windows.map((w) => w.endMinutes)) + Math.max(...offsets)
		];
	}
	const boardingTimes = pattern.timing.trips.flatMap((trip) =>
		boardingIndices.map((index) => trip.stopTimes[index].departureMinutes)
	);
	return boardingTimes.length ? [Math.min(...boardingTimes), Math.max(...boardingTimes)] : null;
}

/** A captured time on another island does not establish local service coverage. */
export function islandHasObservedSnapshotCoverage(
	baseline: PlanningBaseline,
	assumptions: Pick<PlanningAssumptions, 'date' | 'departureMinutes'>,
	islandId: string,
	horizonMinutes = 0
): boolean {
	if (planningCoverage(baseline, assumptions).status === 'complete') return true;
	const localStops = new Set(
		baseline.transit.stops
			.filter(
				(stop) => stop.islandId === islandId && !stop.disabled && stop.pickupAllowed !== false
			)
			.map((stop) => stop.id)
	);
	return baseline.transit.patterns.some((pattern) => {
		if (
			pattern.provenance !== 'observed' ||
			pattern.enabled === false ||
			!calendarRuns(pattern.calendar, assumptions.date)
		)
			return false;
		const indices = pattern.stopIds
			.slice(0, -1)
			.flatMap((id, index) => (localStops.has(id) ? [index] : []));
		const window = windowFor(pattern, indices);
		return (
			window !== null &&
			assumptions.departureMinutes >= window[0] &&
			assumptions.departureMinutes + horizonMinutes <= window[1]
		);
	});
}

/** A weekday closure is known; a date beyond a published calendar is not. */
function calendarCoversDate(pattern: PlanningServicePattern, date: string): boolean {
	const calendar = pattern.calendar;
	if (calendar.includedDates?.includes(date)) return true;
	if (
		(calendar.startDate && date < calendar.startDate) ||
		(calendar.endDate && date > calendar.endDate)
	)
		return false;
	return (
		calendar.weekdays.length > 0 ||
		calendar.startDate !== undefined ||
		calendar.endDate !== undefined ||
		calendar.excludedDates?.includes(date) === true
	);
}

/** Baseline coverage only. Adding an assumed route never repairs missing observed calendars. */
export function planningCoverage(
	baseline: PlanningBaseline,
	assumptions: Pick<PlanningAssumptions, 'date' | 'departureMinutes'>
): PlanningCoverage {
	const valid = baseline.transit.patterns.filter(
		(p) => p.enabled !== false && patternIsValid(p) && calendarRuns(p.calendar, assumptions.date)
	);
	const observed = valid.filter((p) => p.provenance === 'observed');
	const windows = observed.flatMap((p) => {
		const w = windowFor(p);
		return w ? [w] : [];
	});
	const start = windows.length ? Math.min(...windows.map((w) => w[0])) : null;
	const end = windows.length ? Math.max(...windows.map((w) => w[1])) : null;
	const complete =
		baseline.transit.accessStatus === 'complete' &&
		calendarRuns({ weekdays: [0, 1, 2, 3, 4, 5, 6] }, assumptions.date) &&
		baseline.transit.patterns
			.filter((p) => p.enabled !== false)
			.every((p) => patternIsValid(p) && calendarCoversDate(p, assumptions.date));
	const inside = windows.some(
		([from, to]) => assumptions.departureMinutes >= from && assumptions.departureMinutes <= to
	);
	const status: PlanningCoverage['status'] = complete
		? 'complete'
		: !baseline.transit.patterns.length
			? 'unavailable'
			: inside
				? 'partial'
				: 'outside-snapshot';
	const reasons = status === 'complete' ? [] : [...baseline.transit.gaps];
	if (status === 'outside-snapshot')
		reasons.unshift(
			'Selected date or departure time is outside the loaded observed service snapshot. Missing departures are unknown, not evidence that transit does not operate.'
		);
	if (status === 'unavailable')
		reasons.unshift(
			'No valid observed transit timetable has been loaded. Walking results may still be available.'
		);
	return {
		status,
		date: assumptions.date,
		departureMinutes: assumptions.departureMinutes,
		observedPatternCount: observed.length,
		assumedPatternCount: valid.length - observed.length,
		supportedStartMinutes: start,
		supportedEndMinutes: end,
		label:
			status === 'complete'
				? 'Loaded calendar coverage'
				: status === 'partial'
					? 'Partial observed snapshot'
					: status === 'outside-snapshot'
						? 'Outside observed snapshot'
						: 'Transit timing unavailable',
		reasons
	};
}

/** Prefer the public reference date and a time inside its captured observations. */
export function supportedSnapshotSettings(baseline: PlanningBaseline): {
	date: string;
	departureMinutes: number;
} {
	if (
		planningCoverage(baseline, { date: baseline.referenceDate, departureMinutes: 480 }).status ===
		'complete'
	)
		return { date: baseline.referenceDate, departureMinutes: 480 };
	const dates = [
		...new Set([
			baseline.referenceDate,
			...baseline.transit.patterns.flatMap((p) => [
				...(p.calendar.includedDates ?? []),
				...(p.calendar.startDate ? [p.calendar.startDate] : [])
			])
		])
	];
	for (const date of dates) {
		const windows = baseline.transit.patterns
			.filter(
				(p) => p.enabled !== false && p.provenance === 'observed' && calendarRuns(p.calendar, date)
			)
			.flatMap((p) => {
				const w = windowFor(p);
				return w ? [w] : [];
			});
		if (!windows.length) continue;
		const first = Math.min(...windows.map((w) => w[0]));
		const desired = Math.ceil((first + 5) / 15) * 15;
		const departureMinutes = windows.some(([from, to]) => desired >= from && desired <= to)
			? desired
			: first;
		return { date, departureMinutes };
	}
	return { date: baseline.referenceDate, departureMinutes: 480 };
}
