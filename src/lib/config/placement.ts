import type { InfrastructureType } from '#lib/types/domain.ts';
import type { SimulatorToolId } from '#lib/types/ui.ts';
import { OVERLAP_RADIUS_M } from './analysis.ts';

/** Which infrastructure each toolbar tool can place. Extend as more placement rules exist. */
export const PLACEABLE_TYPES: Partial<Record<SimulatorToolId, readonly InfrastructureType[]>> = {
	transport: ['bus_stop']
};

export const PLACEMENT_RULES = {
	/** Stops must sit on (or right beside) a mapped road. */
	maxRoadDistanceM: 35,
	roadRequiredTypes: ['bus_stop', 'bus_terminal'] as readonly InfrastructureType[],
	/** Below this zoom basemap roads are generalised or absent, so the road check is skipped. */
	roadCheckMinZoom: 14,
	/** Closer than this to a same-type facility is treated as a duplicate and blocked. */
	duplicateDistanceM: 60,
	/** Same-type facilities closer than this trigger a spacing warning. Shared with scoring. */
	spacingWarningM: OVERLAP_RADIUS_M,
	/** A placement takes the island of the nearest known facility within this distance. */
	islandAssignRadiusM: 800,
	/** Walking catchment used for the preview (a typical bus-stop catchment). */
	catchmentMinutes: 5,
	/** Sample grid resolution across the catchment for coverage and walk-time estimates. */
	sampleGridSize: 21,
	/** Walk time assumed for residents with no stop on their island, so averages stay finite. */
	noStopWalkCapMinutes: 20,
	/** Below this many newly covered residents the placement is flagged as low-value. */
	lowGainPopulation: 500
} as const;

export const PLACEMENT_COLORS = {
	valid: '#34d399',
	warning: '#fbbf24',
	invalid: '#f87171'
} as const;
