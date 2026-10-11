import type { OriginComparison, PlanningAnalysis, PlanningJourney } from '#lib/planning/types.ts';
import {
	journeyChange,
	journeyMinutesSaved,
	summarizeJourneyChanges,
	type JourneyChangeTotals
} from './journeyChanges.ts';

function hasKnownOutcome(journey: PlanningJourney): boolean {
	return (
		journey.status === 'unreachable' ||
		(journey.status === 'reachable' &&
			journey.minutes !== null &&
			Number.isFinite(journey.minutes) &&
			journey.minutes >= 0)
	);
}

function withinTarget(journey: PlanningJourney, targetMinutes: number): boolean {
	return (
		journey.status === 'reachable' &&
		journey.minutes !== null &&
		Number.isFinite(journey.minutes) &&
		journey.minutes >= 0 &&
		journey.minutes <= targetMinutes
	);
}

/**
 * Compare the previous proposal with one edit, never subtract cumulative benefit headlines.
 * Analysis carries only part of the settings receipt: callers must also pin the full
 * assumptions and accepted action history before exposing a result as "This change".
 * Reject incompatible populations or origin sets rather than inventing missing journeys.
 */
export function compareEditOrigins(
	previous: PlanningAnalysis,
	next: PlanningAnalysis
): OriginComparison[] | null {
	if (
		previous.versionPins.dataset !== next.versionPins.dataset ||
		previous.versionPins.model !== next.versionPins.model ||
		previous.versionPins.schema !== next.versionPins.schema ||
		previous.targetMinutes !== next.targetMinutes ||
		previous.departureMinutes !== next.departureMinutes ||
		previous.goal !== next.goal ||
		previous.coverage.date !== next.coverage.date ||
		!Number.isFinite(next.targetMinutes) ||
		next.targetMinutes < 0 ||
		!Number.isFinite(next.departureMinutes) ||
		previous.origins.length !== next.origins.length
	)
		return null;

	const priorOrigins = new Map<string, OriginComparison>();
	for (const origin of previous.origins) {
		if (
			!origin.originId ||
			priorOrigins.has(origin.originId) ||
			!Number.isFinite(origin.population) ||
			origin.population < 0
		)
			return null;
		priorOrigins.set(origin.originId, origin);
	}

	const seen = new Set<string>();
	const comparisons: OriginComparison[] = [];
	for (const origin of next.origins) {
		const prior = priorOrigins.get(origin.originId);
		if (
			!prior ||
			seen.has(origin.originId) ||
			prior.islandId !== origin.islandId ||
			prior.population !== origin.population
		)
			return null;
		seen.add(origin.originId);
		const before = prior.after;
		const after = origin.after;
		const beforeAccess = withinTarget(before, next.targetMinutes);
		const afterAccess = withinTarget(after, next.targetMinutes);
		const comparison: OriginComparison = {
			originId: origin.originId,
			islandId: origin.islandId,
			population: origin.population,
			before,
			after,
			deltaMinutes: journeyMinutesSaved({ before, after }),
			newlyReachable: hasKnownOutcome(before) && !beforeAccess && afterAccess,
			lostAccess: hasKnownOutcome(after) && beforeAccess && !afterAccess,
			worsenedJourney: journeyChange({ before, after }) === 'slower',
			becameUnavailable: hasKnownOutcome(before) && after.status === 'unavailable'
		};
		comparisons.push(comparison);
	}
	return comparisons;
}

/** Aggregate the same origin comparisons used by the latest-edit impact map. */
export function compareEditImpact(
	previous: PlanningAnalysis,
	next: PlanningAnalysis
): JourneyChangeTotals | null {
	const origins = compareEditOrigins(previous, next);
	return origins === null ? null : summarizeJourneyChanges(origins);
}
