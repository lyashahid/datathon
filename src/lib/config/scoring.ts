import type { InfrastructureType } from '#lib/types/domain.ts';
import type { AccessCategory, ProximityTargetId } from '#lib/types/analysis.ts';

/**
 * Accessibility v1: straight-line proximity. Every threshold and weight used to score a
 * location lives here so the model can be tuned (or audited) in one place.
 *
 * Scores are approximate. Distances are straight lines, not routed paths along streets or
 * ferry timetables; treat results as indicative proximity, not travel times.
 */

export interface ProximityThreshold {
	/** Straight-line distance at or below which the target scores 100. */
	fullScoreWithinM: number;
	/** Straight-line distance at or beyond which the target scores 0 (linear in between). */
	zeroScoreBeyondM: number;
}

export interface ProximityTarget extends ProximityThreshold {
	id: ProximityTargetId;
	label: string;
	type: InfrastructureType;
	/** Share of its category's score; weights within a category sum to 1. */
	weight: number;
	/** Whether a facility on another island can count, reached via ferry terminals. */
	allowSeaCrossing: boolean;
}

export const PROXIMITY_TARGETS: Record<AccessCategory, readonly ProximityTarget[]> = {
	transport: [
		{
			id: 'busStop',
			label: 'Bus stop',
			type: 'bus_stop',
			weight: 0.5,
			// ~400 m is the common urban walk-to-stop standard.
			fullScoreWithinM: 200,
			zeroScoreBeyondM: 800,
			allowSeaCrossing: false
		},
		{
			id: 'ferryTerminal',
			label: 'Ferry terminal',
			type: 'ferry_terminal',
			weight: 0.3,
			fullScoreWithinM: 400,
			zeroScoreBeyondM: 2000,
			allowSeaCrossing: false
		},
		{
			id: 'busTerminal',
			label: 'Bus terminal',
			type: 'bus_terminal',
			weight: 0.2,
			fullScoreWithinM: 400,
			zeroScoreBeyondM: 2000,
			allowSeaCrossing: false
		}
	],
	health: [
		{
			id: 'hospital',
			label: 'Hospital',
			type: 'hospital',
			weight: 1,
			fullScoreWithinM: 800,
			zeroScoreBeyondM: 5000,
			allowSeaCrossing: true
		}
	],
	education: [
		{
			id: 'school',
			label: 'School',
			type: 'school',
			weight: 1,
			fullScoreWithinM: 400,
			zeroScoreBeyondM: 2500,
			allowSeaCrossing: true
		}
	]
};

/**
 * A sea crossing counts as this much extra distance, on top of walking to the origin island's
 * ferry terminal and from the destination island's terminal. Roughly a 20-minute walk.
 */
export const SEA_CROSSING_EQUIVALENT_M = 1600;

/** Overall accessibility = weighted mean of the category scores. Weights sum to 1. */
export const OVERALL_WEIGHTS: Record<AccessCategory, number> = {
	transport: 0.4,
	health: 0.3,
	education: 0.3
};

/** Below this overall score residents count as underserved, weighted by the shortfall. */
export const UNDERSERVED_THRESHOLD = 60;

export const ACCESS_CATEGORY_LABELS: Record<AccessCategory, string> = {
	transport: 'Transport',
	health: 'Health',
	education: 'Education'
};

/** Shown wherever these scores appear, so they are never mistaken for routed travel times. */
export const ACCESSIBILITY_DISCLAIMER =
	'Approximate accessibility from straight-line proximity — not routed travel times.';
