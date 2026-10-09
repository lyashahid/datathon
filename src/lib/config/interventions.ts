import type { InterventionType, RelevanceBand } from '#lib/types/interventions.ts';

/**
 * Thresholds for the rule-based gap detector. Population figures are residents per H3 cell
 * (res 10, ~0.015 km²), so "high population" is a dense-urban cell, not a whole island.
 */
export const INTERVENTION_RULES = {
	/** A cell with at least this many residents counts as high population. */
	highPopulation: 300,
	/** Below this many residents a cell is too sparse to justify most interventions. */
	representedPopulation: 50,
	/** Category scores below this are "poor". */
	poorScore: 50,
	/** A nearest bus stop beyond this straight-line distance is "far". */
	farBusStopM: 400,
	/** Ferry-terminal proximity score below this is "poor ferry access". */
	poorFerryScore: 50,
	/** Residents at which the population part of relevance reaches its maximum. */
	relevancePopulationCap: 800
} as const;

/** relevance = severityWeight × shortfall + populationWeight × population share. */
export const RELEVANCE_WEIGHTS = { severity: 0.6, population: 0.4 } as const;

export const RELEVANCE_BANDS: readonly { band: RelevanceBand; min: number; label: string }[] = [
	{ band: 'high', min: 60, label: 'High relevance' },
	{ band: 'medium', min: 35, label: 'Medium relevance' },
	{ band: 'low', min: 0, label: 'Low relevance' }
];

export const INTERVENTION_TITLES: Record<InterventionType, string> = {
	add_bus_stop: 'Add bus stop',
	improve_healthcare_access: 'Improve healthcare access',
	improve_school_access: 'Improve school access',
	investigate_ferry_connectivity: 'Investigate ferry connectivity'
};
