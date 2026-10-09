import {
	BUS_STOP_CRITERIA,
	BUS_STOP_SCORING as S,
	DEFAULT_BUS_STOP_WEIGHTS,
	type BusStopCriterion,
	type BusStopWeights
} from '#lib/config/busStopScoring.ts';
import type { CandidateCriterionScore, CandidatePenalty } from '#lib/types/candidates.ts';
import type { InfrastructureFeature, Position, TransportRoute } from '#lib/types/domain.ts';
import type { H3Cell } from '#lib/types/h3.ts';
import { formatDistance, formatPopulation } from '#lib/utils/format.ts';
import { distanceToLineM, haversineM } from '../geo.ts';

/** What a candidate is scored against. Built once per search and shared by all candidates. */
export interface BusStopScoringContext {
	/** Cells on the candidate's island (residents can only walk to stops on their island). */
	islandCells: readonly H3Cell[];
	/** Active bus stops on that island. */
	stops: readonly InfrastructureFeature[];
	/** Active bus routes (any island). */
	busRoutes: readonly TransportRoute[];
	/** Active facilities on that island that count as essential services. */
	services: readonly InfrastructureFeature[];
}

export interface BusStopScore {
	score: number;
	criteria: CandidateCriterionScore[];
	penalties: CandidatePenalty[];
	expectedPopulationServed: number;
	underservedReached: number;
	positives: string[];
	tradeoffs: string[];
}

/**
 * Clamps negatives to 0 and rescales to sum to 1. A degenerate all-zero set falls back to the
 * defaults, so an invalid weight state can never reach the scorer.
 */
export function normalizeWeights(weights: BusStopWeights): BusStopWeights {
	const ids = Object.keys(DEFAULT_BUS_STOP_WEIGHTS) as BusStopCriterion[];
	const clean = ids.map(
		(id) => [id, Math.max(0, Number.isFinite(weights[id]) ? weights[id] : 0)] as const
	);
	const total = clean.reduce((s, [, w]) => s + w, 0);
	if (total <= 0) return normalizeWeights(DEFAULT_BUS_STOP_WEIGHTS);
	return Object.fromEntries(clean.map(([id, w]) => [id, w / total])) as BusStopWeights;
}

const clamp100 = (v: number) => Math.max(0, Math.min(100, v));
const label = (id: BusStopCriterion) => BUS_STOP_CRITERIA.find((c) => c.id === id)!.label;

function nearestDistance(
	position: Position,
	features: readonly InfrastructureFeature[]
): number | null {
	let best: number | null = null;
	for (const f of features) {
		const d = haversineM(position, f.geometry.coordinates);
		if (best === null || d < best) best = d;
	}
	return best;
}

/** Scores one candidate position. Pure: same inputs, same score, same explanation. */
export function scoreBusStopCandidate(
	position: Position,
	ctx: BusStopScoringContext,
	weights: BusStopWeights
): BusStopScore {
	const w = normalizeWeights(weights);
	const catchment = ctx.islandCells.filter(
		(c) => haversineM(position, c.centroid) <= S.catchmentRadiusM
	);
	const expectedPopulationServed = catchment.reduce((s, c) => s + c.population, 0);
	const underservedReached = catchment.reduce((s, c) => s + c.underservedPopulation, 0);

	// Coverage and walking improvement, per cell, against the existing stops on this island.
	let alreadyCovered = 0;
	let improvementWeighted = 0;
	for (const cell of catchment) {
		const before = nearestDistance(cell.centroid, ctx.stops) ?? S.noStopDistanceM;
		const after = Math.min(before, haversineM(cell.centroid, position));
		if (before <= S.catchmentRadiusM) alreadyCovered += cell.population;
		improvementWeighted += (before - after) * cell.population;
	}
	const newlyCovered = expectedPopulationServed - alreadyCovered;
	const meanImprovementM =
		expectedPopulationServed > 0 ? improvementWeighted / expectedPopulationServed : 0;

	const routeDistance = ctx.busRoutes.length
		? Math.min(...ctx.busRoutes.map((r) => distanceToLineM(position, r.geometry.coordinates)))
		: null;
	const networkScore =
		routeDistance === null
			? 0
			: clamp100((100 * (S.network.zeroM - routeDistance)) / (S.network.zeroM - S.network.fullM));

	const nearbyServices = ctx.services.filter(
		(f) => haversineM(position, f.geometry.coordinates) <= S.essentialServices.radiusM
	);
	const serviceTypes = [...new Set(nearbyServices.map((f) => f.type))].sort();
	const servicePoints = serviceTypes.reduce(
		(s, t) => s + (S.essentialServices.points[t as keyof typeof S.essentialServices.points] ?? 0),
		0
	);

	const raw: Record<
		BusStopCriterion,
		{ raw: number; unit: string; score: number; explanation: string }
	> = {
		underservedReached: {
			raw: underservedReached,
			unit: 'residents',
			score: clamp100((100 * underservedReached) / S.fullScore.underservedReached),
			explanation: `${formatPopulation(underservedReached)} gap-weighted underserved residents within ${S.catchmentRadiusM} m (full score at ${S.fullScore.underservedReached}).`
		},
		populationCoverage: {
			raw: newlyCovered,
			unit: 'residents',
			score: clamp100((100 * newlyCovered) / S.fullScore.populationCoverage),
			explanation: `${formatPopulation(newlyCovered)} residents within ${S.catchmentRadiusM} m not already within ${S.catchmentRadiusM} m of a stop (full score at ${S.fullScore.populationCoverage.toLocaleString('en-US')}).`
		},
		walkingImprovement: {
			raw: meanImprovementM,
			unit: 'm',
			score: clamp100((100 * meanImprovementM) / S.fullScore.walkingImprovementM),
			explanation: `Average straight-line distance to the nearest stop falls by ${formatDistance(meanImprovementM)} for nearby residents (full score at ${S.fullScore.walkingImprovementM} m).`
		},
		networkSuitability: {
			raw: routeDistance ?? Infinity,
			unit: 'm',
			score: networkScore,
			explanation:
				routeDistance === null
					? 'No bus route exists to extend.'
					: `${formatDistance(routeDistance)} from the nearest bus route (full score within ${S.network.fullM} m, none beyond ${S.network.zeroM} m).`
		},
		essentialServices: {
			raw: serviceTypes.length,
			unit: 'service types',
			score: clamp100(servicePoints),
			explanation: serviceTypes.length
				? `Within ${S.essentialServices.radiusM} m: ${serviceTypes.map((t) => t.replace('_', ' ')).join(', ')}.`
				: `No hospital, school or terminal within ${S.essentialServices.radiusM} m.`
		}
	};

	const criteria: CandidateCriterionScore[] = BUS_STOP_CRITERIA.map(({ id }) => ({
		id,
		label: label(id),
		...raw[id],
		weight: w[id],
		contribution: raw[id].score * w[id]
	}));

	const penalties: CandidatePenalty[] = [];
	const nearestStop = nearestDistance(position, ctx.stops);
	const P = S.penalties;
	if (nearestStop !== null && nearestStop < P.nearbyStop.minSpacingM) {
		penalties.push({
			id: 'nearbyStop',
			label: 'Close to an existing stop',
			points: -P.nearbyStop.maxPoints * (1 - nearestStop / P.nearbyStop.minSpacingM),
			explanation: `${formatDistance(nearestStop)} from the nearest stop (spacing target ${P.nearbyStop.minSpacingM} m).`
		});
	}
	const coveredShare = expectedPopulationServed > 0 ? alreadyCovered / expectedPopulationServed : 0;
	if (coveredShare > P.overlap.fromShare) {
		penalties.push({
			id: 'overlap',
			label: 'Overlapping coverage',
			points:
				(-P.overlap.maxPoints * (coveredShare - P.overlap.fromShare)) / (1 - P.overlap.fromShare),
			explanation: `${Math.round(coveredShare * 100)}% of nearby residents are already within ${S.catchmentRadiusM} m of a stop.`
		});
	}
	if (expectedPopulationServed < P.lowPopulation.belowResidents) {
		penalties.push({
			id: 'lowPopulation',
			label: 'Few residents nearby',
			points: -P.lowPopulation.points,
			explanation: `Only ${formatPopulation(expectedPopulationServed)} residents within ${S.catchmentRadiusM} m.`
		});
	}

	const total =
		criteria.reduce((s, c) => s + c.contribution, 0) + penalties.reduce((s, p) => s + p.points, 0);
	const score = Math.round(clamp100(total));

	const positives = criteria
		.filter((c) => c.score >= 60)
		.map((c) => `${c.label}: ${c.explanation}`);
	const tradeoffs = [
		...criteria
			.filter((c) => c.score <= 25)
			.map((c) => `Weak ${c.label.toLowerCase()}: ${c.explanation}`),
		...penalties.map((p) => `${p.label}: ${p.explanation}`)
	];

	return {
		score,
		criteria,
		penalties,
		expectedPopulationServed,
		underservedReached,
		positives,
		tradeoffs
	};
}

/** Smallest weight kept on a criterion when setting it to zero would leave no priorities. */
export const MIN_LAST_WEIGHT = 0.05;

/**
 * Returns weights with one criterion changed (value 0–1). Refuses to produce an all-zero set:
 * if every other weight is already zero, the changed one keeps `MIN_LAST_WEIGHT`.
 */
export function updateWeight(
	weights: BusStopWeights,
	id: BusStopCriterion,
	value: number
): BusStopWeights {
	const next = { ...weights, [id]: Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)) };
	const total = Object.values(next).reduce((s, w) => s + w, 0);
	if (total <= 0) next[id] = MIN_LAST_WEIGHT;
	return next;
}
