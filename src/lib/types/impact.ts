import type { InfrastructureId, Position } from './domain.ts';
import type { H3Index } from './h3.ts';

export type ImpactDirection = 'improved' | 'worsened' | 'unchanged';

/** One metric before and after a scenario. */
export interface MetricChange {
	before: number;
	after: number;
	delta: number;
}

/** Residents split the same way as the grid's demographics. */
export interface PopulationSplit {
	total: number;
	children: number;
	workingAge: number;
	olderPopulation: number;
}

export interface CellScores {
	transport: number;
	health: number;
	education: number;
	overall: number;
	underserved: number;
}

/** A single cell compared between baseline and scenario. */
export interface CellImpact {
	h3Index: H3Index;
	island: string;
	centroid: Position;
	population: PopulationSplit;
	before: CellScores;
	after: CellScores;
	/** after − before for each score. */
	delta: CellScores;
	/** Classified on the overall-score delta against the configured threshold. */
	direction: ImpactDirection;
}

/** Aggregate comparison over a set of cells (the whole grid, or a local area). */
export interface ImpactSummary {
	cellsCompared: number;
	cellsImproved: number;
	cellsWorsened: number;
	/** Population-weighted averages of the 0–100 scores. */
	transport: MetricChange;
	health: MetricChange;
	education: MetricChange;
	overall: MetricChange;
	/** Sum of gap-weighted underserved residents. */
	underservedPopulation: MetricChange;
	/** Residents in cells whose overall score rose by at least the threshold. */
	benefiting: PopulationSplit;
	/** Residents in cells whose overall score fell by at least the threshold. */
	losing: PopulationSplit;
	/** Overall-score points a cell must move to count as changed. */
	thresholdPoints: number;
}

export interface GridImpact {
	/** False when the scenario leaves every cell's scores identical to the baseline. */
	hasChanges: boolean;
	summary: ImpactSummary;
	cells: readonly CellImpact[];
	get(h3Index: H3Index): CellImpact | undefined;
}

/** Impact restricted to residents near one facility. */
export interface LocalImpact {
	featureId: InfrastructureId;
	radiusM: number;
	/** Positions the area is centred on: current position, plus the original one if moved. */
	centres: readonly Position[];
	summary: ImpactSummary;
}
