import type { BusStopCriterion, BusStopWeights } from '#lib/config/busStopScoring.ts';
import type { Position } from './domain.ts';
import type { H3Index } from './h3.ts';

export interface CandidateCriterionScore {
	id: BusStopCriterion;
	label: string;
	/** Measured input, e.g. residents or metres, with its unit. */
	raw: number;
	unit: string;
	/** 0–100 after normalisation. */
	score: number;
	/** Normalised weight actually used (sums to 1 across criteria). */
	weight: number;
	contribution: number;
	explanation: string;
}

export type CandidatePenaltyId = 'nearbyStop' | 'overlap' | 'lowPopulation';

export interface CandidatePenalty {
	id: CandidatePenaltyId;
	label: string;
	points: number;
	explanation: string;
}

export interface BusStopCandidate {
	/** Stable id from the generating cell. */
	id: H3Index;
	rank: number;
	position: Position;
	island: string;
	atoll: string | null;
	/** 0–100. */
	score: number;
	/** Residents within the walking catchment. */
	expectedPopulationServed: number;
	/** Gap-weighted underserved residents within the catchment. */
	underservedReached: number;
	/** Population-weighted change in transport accessibility across the area of interest. */
	estimatedAccessibilityGain: number;
	criteria: readonly CandidateCriterionScore[];
	penalties: readonly CandidatePenalty[];
	positives: readonly string[];
	tradeoffs: readonly string[];
}

export interface CandidateArea {
	centre: Position;
	originCell: H3Index;
	island: string;
	radiusM: number;
	cellCount: number;
	population: number;
}

export interface CandidateSearchResult {
	area: CandidateArea;
	candidates: readonly BusStopCandidate[];
	evaluated: number;
	rejected: number;
	rejectionReasons: Readonly<Record<string, number>>;
	/** Normalised weights the ranking used. */
	weights: BusStopWeights;
}
