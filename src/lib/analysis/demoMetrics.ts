import { COVERAGE_BANDS_MIN, WALK_MODEL } from '#lib/config/analysis.ts';
import type {
	AnalysisMethod,
	AnalysisProvider,
	CoverageMetrics,
	InfrastructureAnalysis
} from '#lib/types/analysis.ts';
import type { InfrastructureFeature, InfrastructureId } from '#lib/types/domain.ts';
import {
	connectivityComponent,
	overlapPenalty,
	populationCoverageComponent,
	serviceAccessComponent,
	type AnalysisWorld
} from './facilityScore.ts';
import { createAccessIndex, type AccessIndex } from './accessibility.ts';
import { deriveFindings } from './findings.ts';
import { facilitiesByDistance, findNearbyServices } from './nearby.ts';
import { composeScore } from './scoring.ts';
import { walkRadiusM } from './walk.ts';

/**
 * DEMO FIXTURE — illustrative resident counts and land areas, not census figures.
 * Stands in for a gridded population layer until one is ingested.
 */
export const DEMO_ISLAND_PROFILES: Readonly<
	Record<string, { population: number; areaKm2: number }>
> = {
	Malé: { population: 135_000, areaKm2: 1.95 },
	Hulhumalé: { population: 60_000, areaKm2: 4.0 },
	Villimalé: { population: 8_000, areaKm2: 0.32 },
	Hulhulé: { population: 1_500, areaKm2: 3.0 }
};

export const DEMO_ANALYSIS_METHOD: AnalysisMethod = {
	id: 'demo-straight-line',
	version: '0.1.0',
	label: 'Demo estimate (straight-line walking)',
	description:
		'Approximate: straight-line distances (walking times use a detour factor), not routed travel. Population assumes residents spread evenly over each island (demo fixture). Indicative only.',
	assumptions: [
		{ label: 'Walking speed', value: WALK_MODEL.speedMPerMin, unit: 'm/min' },
		{ label: 'Detour factor', value: WALK_MODEL.detourFactor },
		{ label: 'Population source', value: 'Demo island fixture (uniform density)' }
	]
};

/**
 * Residents reachable on foot: island density × catchment disc area, capped at the island's
 * population. Catchments never cross water, matching the walking-only model.
 */
export function demoCoverage(feature: InfrastructureFeature): CoverageMetrics {
	const profile = feature.metadata.island
		? DEMO_ISLAND_PROFILES[feature.metadata.island]
		: undefined;
	const density = profile ? profile.population / profile.areaKm2 : 0;
	return {
		mode: 'walk',
		provenance: 'demo',
		basis: profile
			? `Demo: ${feature.metadata.island} at a uniform ${Math.round(density).toLocaleString('en-US')} residents/km², capped at ${profile.population.toLocaleString('en-US')}.`
			: 'Demo: no population profile for this island.',
		bands: COVERAGE_BANDS_MIN.map((minutes) => {
			const radiusM = walkRadiusM(minutes);
			const areaKm2 = (Math.PI * radiusM ** 2) / 1_000_000;
			return {
				minutes,
				radiusM,
				population: profile ? Math.min(profile.population, density * areaKm2) : 0
			};
		})
	};
}

export function analyseWithDemoInputs(
	feature: InfrastructureFeature,
	world: AnalysisWorld,
	index: AccessIndex = createAccessIndex(world.infrastructure)
): InfrastructureAnalysis {
	const coverage = demoCoverage(feature);
	const byDistance = facilitiesByDistance(feature, world.infrastructure);
	const nearby = {
		...findNearbyServices(feature, world.infrastructure),
		provenance: 'demo' as const
	};

	const penalty = overlapPenalty(feature, byDistance);
	const accessibility = composeScore(
		[
			populationCoverageComponent(coverage),
			connectivityComponent(feature, byDistance, world),
			serviceAccessComponent(feature, index)
		],
		penalty ? [penalty] : []
	);

	return {
		featureId: feature.id,
		method: DEMO_ANALYSIS_METHOD,
		provenance: 'demo',
		coverage,
		nearby,
		accessibility,
		...deriveFindings({ originType: feature.type, coverage, nearby, accessibility })
	};
}

/** Pure and memoised: the same feature always yields the identical analysis object. */
export function createDemoAnalysisProvider(world: AnalysisWorld): AnalysisProvider {
	const cache = new Map<InfrastructureId, InfrastructureAnalysis>();
	const index = createAccessIndex(world.infrastructure);
	const byId = new Map(world.infrastructure.map((f) => [f.id, f]));
	return {
		analyseInfrastructure(id) {
			const cached = cache.get(id);
			if (cached) return cached;
			const feature = byId.get(id);
			if (!feature) return undefined;
			const result = analyseWithDemoInputs(feature, world, index);
			cache.set(id, result);
			return result;
		}
	};
}

/** Demo residents per km² for an island, from the fixture above. */
export function demoDensityForIsland(island: string): number | null {
	const profile = DEMO_ISLAND_PROFILES[island];
	return profile ? profile.population / profile.areaKm2 : null;
}

/**
 * Scores a hypothetical facility as if it were part of `world`. A candidate sharing an id with
 * an existing facility (a move preview) replaces it rather than appearing twice.
 */
export function demoScoreCandidate(world: AnalysisWorld) {
	return (candidate: InfrastructureFeature) =>
		analyseWithDemoInputs(candidate, {
			infrastructure: [...world.infrastructure.filter((f) => f.id !== candidate.id), candidate],
			routesServing: (id) => world.routesServing(id)
		}).accessibility;
}
