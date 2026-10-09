import type { LocationAccess } from './analysis.ts';
import type { Position, Provenance } from './domain.ts';

export type H3Index = string;

/** Residents of one cell. Demo input today; a census/gridded population layer later. */
export interface H3Demographics {
	population: number;
	children: number;
	workingAge: number;
	olderPopulation: number;
}

/** Static part of a cell: where it is and who lives there. Independent of any scenario. */
export interface H3BaseCell extends H3Demographics {
	h3Index: H3Index;
	centroid: Position;
	areaKm2: number;
	island: string;
	provenance: Provenance;
}

/** A cell with accessibility derived from the effective (scenario) world. */
export interface H3Cell extends H3BaseCell {
	transportAccessibility: number;
	healthAccessibility: number;
	educationAccessibility: number;
	overallAccessibility: number;
	/** Residents weighted by how far overall access falls below the underserved threshold. */
	underservedPopulation: number;
	/** Residents per km². */
	populationDensity: number;
	/** Full explainable breakdown behind the four accessibility numbers above. */
	access: LocationAccess;
}

export interface H3Grid {
	resolution: number;
	cells: readonly H3Cell[];
	get(h3Index: H3Index): H3Cell | undefined;
	totals: { population: number; underservedPopulation: number };
}

export type InfoViewId =
	| 'populationDensity'
	| 'transportAccessibility'
	| 'healthAccessibility'
	| 'educationAccessibility'
	| 'underservedPopulation'
	| 'scenarioImpact'
	| 'disruptionImpact'
	| 'closureExposure'
	| 'rain'
	| 'wind'
	| 'marineConditions';

/** Cell properties an info view can colour by. */
export type H3MetricKey = Extract<
	keyof H3Cell,
	| 'populationDensity'
	| 'transportAccessibility'
	| 'healthAccessibility'
	| 'educationAccessibility'
	| 'underservedPopulation'
>;

/**
 * Values computed outside the grid and supplied per cell by the caller: change in overall
 * accessibility (from a comparison) or the largest loss from any single facility closure.
 */
export type H3ExternalKey = 'overallChange' | 'closureExposure';

/** Anything an info view can colour cells by. */
export type InfoViewMetric = H3MetricKey | H3ExternalKey;

/** Supplies an external metric for a cell; 0 where the source has nothing to say. */
export type CellValueSource = (h3Index: H3Index) => number;

/** Forecast quantities the environment views colour by (from the weather sample grid). */
export type EnvironmentMetric = 'precipitationMm' | 'windSpeedKph' | 'waveHeightM';
