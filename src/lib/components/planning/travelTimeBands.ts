import type { PlanningJourney } from '#lib/planning/types.ts';

export type JourneyTimeBand =
	'five' | 'ten' | 'fifteen' | 'thirty' | 'over-thirty' | 'unreachable' | 'unknown' | 'mixed';
export type JourneyTimeState = Exclude<JourneyTimeBand, 'mixed'>;

/** Mutually exclusive modeled journey times; unknown and no-route results stay separate. */
export const TRAVEL_TIME_BANDS: readonly {
	id: JourneyTimeBand;
	label: string;
	color: string;
}[] = [
	{ id: 'five', label: '≤5 min', color: '#3f88b8' },
	{ id: 'ten', label: '5–10 min', color: '#58a596' },
	{ id: 'fifteen', label: '10–15 min', color: '#d9b652' },
	{ id: 'thirty', label: '15–30 min', color: '#d69255' },
	{ id: 'over-thirty', label: 'Over 30 min', color: '#b66a58' },
	{ id: 'unreachable', label: 'No route found', color: '#975954' },
	{ id: 'unknown', label: 'Incomplete data', color: '#65717d' },
	{ id: 'mixed', label: 'Mixed times', color: '#9191a4' }
];

/** Does not infer a duration for unavailable or unreachable journeys. */
export function journeyTimeBand(journey: PlanningJourney | undefined): JourneyTimeState {
	if (!journey || journey.status === 'unavailable') return 'unknown';
	if (journey.status === 'unreachable') return 'unreachable';
	const minutes = journey.minutes;
	if (
		journey.status !== 'reachable' ||
		minutes === null ||
		!Number.isFinite(minutes) ||
		minutes < 0
	)
		return 'unknown';
	if (minutes <= 5) return 'five';
	if (minutes <= 10) return 'ten';
	if (minutes <= 15) return 'fifteen';
	if (minutes <= 30) return 'thirty';
	return 'over-thirty';
}
