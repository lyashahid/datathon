import { patternIsValid } from './routing.ts';
import type { PlanningServicePattern } from './types.ts';

/** Bounded timetable-only edit. No caller-supplied geometry, calendar or runtime is accepted. */
export function shiftTimetable(
	pattern: PlanningServicePattern,
	minutes: number
): PlanningServicePattern | null {
	if (
		pattern.mode !== 'bus' ||
		pattern.timing.kind !== 'scheduled' ||
		pattern.runtimeUnavailableReason ||
		!patternIsValid(pattern) ||
		!Number.isInteger(minutes) ||
		Math.abs(minutes) > 15
	)
		return null;
	const shifted = structuredClone(pattern);
	if (shifted.timing.kind !== 'scheduled') return null;
	for (const trip of shifted.timing.trips)
		for (const stop of trip.stopTimes) {
			const arrival = stop.arrivalMinutes + minutes,
				departure = stop.departureMinutes + minutes;
			if (arrival < 0 || departure >= 1440) return null;
			stop.arrivalMinutes = arrival;
			stop.departureMinutes = departure;
		}
	if (!patternIsValid(shifted)) return null;
	if (minutes) {
		shifted.referenceProvenance = pattern.referenceProvenance ?? pattern.provenance;
		shifted.provenance = 'assumed';
	}
	return shifted;
}
