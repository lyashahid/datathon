import { H3_RESOLUTION } from '#lib/config/analysis.ts';
import { NORMAL_CONDITIONS } from '#lib/config/disruptionScenarios.ts';
import { UNDERSERVED_THRESHOLD } from '#lib/config/scoring.ts';
import type { AccessConditions } from '#lib/types/disruption.ts';
import type { InfrastructureFeature } from '#lib/types/domain.ts';
import type { H3BaseCell, H3Cell, H3Grid } from '#lib/types/h3.ts';
import { calculateLocationAccess, createAccessIndex } from './accessibility.ts';

/** Share (0–1) by which an overall score falls short of the underserved threshold. */
export function underservedShortfall(overallScore: number): number {
	return Math.max(0, UNDERSERVED_THRESHOLD - overallScore) / UNDERSERVED_THRESHOLD;
}

/** Residents weighted by how far overall access falls below the underserved threshold. */
export function underservedResidents(population: number, overallScore: number): number {
	return population * underservedShortfall(overallScore);
}

/**
 * Combines static demographics with the current (scenario) infrastructure. Pure and
 * deterministic. Every cell is recalculated on each call — cheap at demo scale (~550 cells) —
 * so any add / move / disable is reflected everywhere it matters.
 */
export function buildAccessibilityGrid(
	baseCells: readonly H3BaseCell[],
	infrastructure: readonly InfrastructureFeature[],
	conditions: AccessConditions = NORMAL_CONDITIONS,
	resolution = H3_RESOLUTION
): H3Grid {
	const index = createAccessIndex(infrastructure);
	const cells: H3Cell[] = baseCells.map((base) => {
		const access = calculateLocationAccess(
			{ position: base.centroid, island: base.island },
			index,
			conditions
		);
		return {
			...base,
			populationDensity: base.population / base.areaKm2,
			transportAccessibility: access.transport.score,
			healthAccessibility: access.health.score,
			educationAccessibility: access.education.score,
			overallAccessibility: access.overall.score,
			underservedPopulation: underservedResidents(base.population, access.overall.score),
			access
		};
	});

	const byIndex = new Map(cells.map((c) => [c.h3Index, c]));
	return {
		resolution,
		cells,
		get: (h) => byIndex.get(h),
		totals: {
			population: cells.reduce((s, c) => s + c.population, 0),
			underservedPopulation: cells.reduce((s, c) => s + c.underservedPopulation, 0)
		}
	};
}
