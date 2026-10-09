import type { InfrastructureId, InfrastructureType, Provenance } from './domain.ts';

/** Describes how an analysis result was produced, so every number can be traced to its method. */
export interface AnalysisMethod {
	id: string;
	version: string;
	label: string;
	description: string;
	/** Parameters the calculation depends on, shown to the user verbatim. */
	assumptions: readonly Assumption[];
}

export interface Assumption {
	label: string;
	value: number | string;
	unit?: string;
}

/** One travel-time band of a catchment. */
export interface CoverageBand {
	minutes: number;
	/** Effective straight-line radius after the detour factor. */
	radiusM: number;
	population: number;
}

export interface CoverageMetrics {
	mode: 'walk';
	bands: readonly CoverageBand[];
	provenance: Provenance;
	/** Plain-language statement of how population was estimated. */
	basis: string;
}

export interface NearbyFacility {
	id: InfrastructureId;
	name: string;
	type: InfrastructureType;
	distanceM: number;
	sameIsland: boolean;
	/** Walking time on the same island; null when reaching it needs a sea crossing. */
	walkMinutes: number | null;
}

export interface NearbyServices {
	hospitals: readonly NearbyFacility[];
	schools: readonly NearbyFacility[];
	transport: readonly NearbyFacility[];
	searchRadiusM: number;
	provenance: Provenance;
}

/** A labelled input to a score component, displayed in the breakdown. */
export interface ScoreInput {
	label: string;
	value: number | string;
	unit?: string;
}

export type ScoreComponentId = 'populationCoverage' | 'connectivity' | 'serviceAccess';

export interface ScoreComponent {
	id: ScoreComponentId;
	label: string;
	/** 0–100 before weighting. */
	score: number;
	/** Share of the total; component weights sum to 1. */
	weight: number;
	/** score × weight, unrounded. */
	contribution: number;
	explanation: string;
	inputs: readonly ScoreInput[];
}

export type ScorePenaltyId = 'overlap';

export interface ScorePenalty {
	id: ScorePenaltyId;
	label: string;
	/** Negative number of points subtracted from the weighted sum. */
	points: number;
	explanation: string;
}

export type ScoreCategory = 'excellent' | 'good' | 'fair' | 'poor' | 'critical';

/** A 0–100 score that is always reproducible from its components and penalties. */
export interface ScoreBreakdown {
	score: number;
	category: ScoreCategory;
	components: readonly ScoreComponent[];
	penalties: readonly ScorePenalty[];
	/** Σ contributions + Σ penalties, before clamping to 0–100 and rounding. */
	rawTotal: number;
}

export type FindingBasis = ScoreComponentId | ScorePenaltyId | 'coverage' | 'nearby';

/** A plain-language observation tied to the metric that triggered it. */
export interface Finding {
	id: string;
	text: string;
	basis: FindingBasis;
}

export interface InfrastructureAnalysis {
	featureId: InfrastructureId;
	method: AnalysisMethod;
	/** Overall provenance: the weakest provenance among the inputs. */
	provenance: Provenance;
	coverage: CoverageMetrics;
	nearby: NearbyServices;
	accessibility: ScoreBreakdown;
	strengths: readonly Finding[];
	concerns: readonly Finding[];
}

/** Source of analysis results. The demo provider is replaced by real calculations later. */
export interface AnalysisProvider {
	analyseInfrastructure(id: InfrastructureId): InfrastructureAnalysis | undefined;
}

// ── Location accessibility (v1: straight-line proximity) ─────────────────────────

export type AccessCategory = 'transport' | 'health' | 'education';
export type ProximityTargetId = 'busStop' | 'busTerminal' | 'ferryTerminal' | 'hospital' | 'school';

/** One scored target within a category, e.g. "nearest bus stop: 230 m → 95". */
export interface ProximityComponent {
	id: ProximityTargetId;
	label: string;
	nearestId: InfrastructureId | null;
	/** Effective distance used for scoring; includes the crossing allowance when via ferry. */
	distanceM: number | null;
	viaFerry: boolean;
	fullScoreWithinM: number;
	zeroScoreBeyondM: number;
	/** 0–100. */
	score: number;
	weight: number;
	/** score × weight, unrounded. */
	contribution: number;
}

export interface CategoryAccess {
	category: AccessCategory;
	/** Rounded Σ contributions, 0–100. */
	score: number;
	components: readonly ProximityComponent[];
}

export interface OverallAccess {
	/** Rounded Σ category score × weight, 0–100. */
	score: number;
	components: readonly {
		category: AccessCategory;
		score: number;
		weight: number;
		contribution: number;
	}[];
}

export interface LocationAccess {
	transport: CategoryAccess;
	health: CategoryAccess;
	education: CategoryAccess;
	overall: OverallAccess;
}
