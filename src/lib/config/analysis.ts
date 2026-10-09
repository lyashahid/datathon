import type { InfrastructureType } from '#lib/types/domain.ts';
import type { ScoreCategory, ScoreComponentId } from '#lib/types/analysis.ts';

/** Walking model shared by coverage, nearby-service and connectivity calculations. */
export const WALK_MODEL = {
	speedMPerMin: 80, // 4.8 km/h
	/** Street-network distance ÷ straight-line distance; typical for dense grids. */
	detourFactor: 1.3
} as const;

export const COVERAGE_BANDS_MIN = [5, 10, 15] as const;

export const NEARBY = {
	searchRadiusM: 2500,
	maxPerCategory: 3
} as const;

export const SCORE_WEIGHTS: Record<ScoreComponentId, number> = {
	populationCoverage: 0.4,
	connectivity: 0.3,
	serviceAccess: 0.3
};

export const POPULATION_COVERAGE = {
	/** Catchment band the component scores against. */
	bandMinutes: 10,
	/** Residents within that band that earn the full 100. */
	fullScorePopulation: 40_000
} as const;

export const CONNECTIVITY = {
	walkMinutes: 10,
	pointsPerRoute: 20,
	maxRoutePoints: 60,
	ferryTerminalBonus: 20,
	busTerminalBonus: 20
} as const;

/**
 * Minimum useful spacing between facilities of the same type; closer pairs largely duplicate
 * each other's catchment. Bus stops use the common ~400 m urban stop spacing; schools use two
 * 10-minute walking radii. 0 disables the check.
 */
export const OVERLAP_RADIUS_M: Record<InfrastructureType, number> = {
	bus_stop: 400,
	bus_terminal: 800,
	ferry_terminal: 300,
	airport: 0,
	hospital: 1500,
	school: 800,
	government_service: 800
};
export const OVERLAP_PENALTY = { pointsEach: -8, maxTotal: -16 } as const;

/** Lower bounds, checked from the top. */
export const SCORE_CATEGORIES: readonly {
	category: ScoreCategory;
	min: number;
	label: string;
	color: string;
}[] = [
	{ category: 'excellent', min: 80, label: 'Excellent', color: '#34d399' },
	{ category: 'good', min: 65, label: 'Good', color: '#a3e635' },
	{ category: 'fair', min: 50, label: 'Fair', color: '#fbbf24' },
	{ category: 'poor', min: 35, label: 'Poor', color: '#fb923c' },
	{ category: 'critical', min: 0, label: 'Critical', color: '#f87171' }
];

export const FINDING_THRESHOLDS = {
	strongCoveragePopulation: 30_000,
	weakCoveragePopulation: 5_000,
	strongComponentScore: 70,
	weakComponentScore: 30
} as const;

/** Analytical grid resolution. Res 10 cells are ~0.015 km² (~66 m edge): fine enough for reef islands. */
export const H3_RESOLUTION = 10;
