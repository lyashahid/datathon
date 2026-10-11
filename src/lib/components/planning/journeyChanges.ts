import type { OriginComparison, PlanningJourney } from '#lib/planning/types.ts';

export type JourneyChangeState =
	'faster' | 'new-route' | 'slower' | 'lost-route' | 'unchanged' | 'unknown';
export type JourneyChangeBand = JourneyChangeState | 'mixed';

export const JOURNEY_CHANGE_STATES: readonly JourneyChangeState[] = [
	'faster',
	'new-route',
	'slower',
	'lost-route',
	'unchanged',
	'unknown'
];

type Comparison = Pick<OriginComparison, 'before' | 'after'>;
/** Match the routing engine's tolerance instead of highlighting floating-point noise. */
const TIME_TOLERANCE_MINUTES = 0.01;

export interface JourneyChangeTotals {
	journeyChangePopulation: Record<JourneyChangeState, number>;
	population: number;
	improvedPopulation: number;
	worsenedPopulation: number;
	comparablePopulation: number;
	averageMinutesSaved: number | null;
	/** New routes ranked by residents, then faster routes by person-minutes saved. */
	improvedOrigins: OriginComparison[];
}

export function emptyJourneyChangePopulation(): Record<JourneyChangeState, number> {
	return { faster: 0, 'new-route': 0, slower: 0, 'lost-route': 0, unchanged: 0, unknown: 0 };
}

function validMinutes(journey: PlanningJourney | undefined): number | null {
	return journey?.status === 'reachable' &&
		journey.minutes !== null &&
		Number.isFinite(journey.minutes) &&
		journey.minutes >= 0
		? journey.minutes
		: null;
}

/** Positive means time saved. Unreachable or unknown journeys never acquire a duration. */
export function journeyMinutesSaved(comparison: Comparison | undefined): number | null {
	const before = validMinutes(comparison?.before);
	const after = validMinutes(comparison?.after);
	return before !== null && after !== null ? before - after : null;
}

/**
 * Compare actual journey results, independently of the target and time-colour bands.
 * A newly computable result with an unknown baseline is evidence change, not a benefit.
 */
export function journeyChange(comparison: Comparison | undefined): JourneyChangeState {
	if (!comparison) return 'unknown';
	const before = comparison.before;
	const after = comparison.after;
	if (
		before.status === 'unavailable' ||
		after.status === 'unavailable' ||
		(before.status === 'reachable' && validMinutes(before) === null) ||
		(after.status === 'reachable' && validMinutes(after) === null)
	)
		return 'unknown';
	if (before.status === 'unreachable')
		return after.status === 'reachable' ? 'new-route' : 'unchanged';
	if (after.status === 'unreachable') return 'lost-route';
	const saved = journeyMinutesSaved(comparison)!;
	if (saved > TIME_TOLERANCE_MINUTES) return 'faster';
	if (saved < -TIME_TOLERANCE_MINUTES) return 'slower';
	return 'unchanged';
}

/** Short journey labels preserve a visible tenth of a minute and separate missing evidence. */
export function formatJourneyTime(journey: PlanningJourney | undefined): string {
	if (journey?.status === 'unreachable') return 'No route';
	const minutes = validMinutes(journey);
	return minutes === null
		? 'Not known'
		: `${minutes.toLocaleString('en-US', { maximumFractionDigits: 1 })} min`;
}

export function journeyChangeSummary(comparison: Comparison | undefined): string {
	const state = journeyChange(comparison);
	if (state === 'new-route') return 'A journey is now possible';
	if (state === 'lost-route') return 'No route remains';
	if (state === 'unknown') return 'Before-and-after evidence is incomplete';
	if (state === 'unchanged') return 'Journey time is unchanged';
	const saved = Math.abs(journeyMinutesSaved(comparison)!);
	const duration =
		saved < 0.1
			? `${Math.max(1, Math.round(saved * 60))} sec`
			: `${saved.toLocaleString('en-US', { maximumFractionDigits: 1 })} min`;
	return `${duration} ${state}`;
}

/** Aggregate the model origins once; display hex allocations are not extra residents. */
export function summarizeJourneyChanges(origins: readonly OriginComparison[]): JourneyChangeTotals {
	const journeyChangePopulation = emptyJourneyChangePopulation();
	let population = 0,
		comparablePopulation = 0,
		weightedMinutesSaved = 0;
	const improvedOrigins: OriginComparison[] = [];
	for (const origin of origins) {
		if (!Number.isFinite(origin.population) || origin.population <= 0) continue;
		population += origin.population;
		const state = journeyChange(origin);
		journeyChangePopulation[state] += origin.population;
		if (state === 'faster' || state === 'new-route') improvedOrigins.push(origin);
		const saved = journeyMinutesSaved(origin);
		if (saved !== null) {
			comparablePopulation += origin.population;
			weightedMinutesSaved += origin.population * saved;
		}
	}
	improvedOrigins.sort((a, b) => {
		const aNew = journeyChange(a) === 'new-route';
		const bNew = journeyChange(b) === 'new-route';
		if (aNew !== bNew) return aNew ? -1 : 1;
		const aValue = aNew ? a.population : a.population * journeyMinutesSaved(a)!;
		const bValue = bNew ? b.population : b.population * journeyMinutesSaved(b)!;
		return bValue - aValue || a.originId.localeCompare(b.originId);
	});
	return {
		journeyChangePopulation,
		population,
		improvedPopulation: journeyChangePopulation.faster + journeyChangePopulation['new-route'],
		worsenedPopulation: journeyChangePopulation.slower + journeyChangePopulation['lost-route'],
		comparablePopulation,
		averageMinutesSaved:
			comparablePopulation > 0 ? weightedMinutesSaved / comparablePopulation : null,
		improvedOrigins
	};
}
