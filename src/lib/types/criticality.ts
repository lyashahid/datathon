import type { InfrastructureId, InfrastructureType } from './domain.ts';
import type { H3Index } from './h3.ts';

export type CriticalityBand = 'critical' | 'high' | 'moderate' | 'low';

/** What closing one facility (all else equal) would do to accessibility. */
export interface FacilityCriticality {
	featureId: InfrastructureId;
	name: string;
	type: InfrastructureType;
	/** Rank among assessed facilities, 1 = largest loss. */
	rank: number;
	band: CriticalityBand;
	/** Average overall-accessibility points lost per resident of the whole study area. */
	averagePointsLost: number;
	/** Residents whose overall score would fall by at least the impact threshold. */
	residentsAffected: number;
	/** Increase in gap-weighted underserved residents. */
	underservedIncrease: number;
	/** Largest overall-score drop in any single cell. */
	maxCellDrop: number;
	/** Nearest other active facility of the same type, straight line. */
	nearestAlternative: { id: InfrastructureId; name: string; distanceM: number } | null;
	explanation: readonly string[];
}

/** For one cell: the largest loss any single closure would cause, and which facility. */
export interface CellExposure {
	drop: number;
	featureId: InfrastructureId;
}

export interface CriticalityResult {
	facilities: readonly FacilityCriticality[];
	get(id: InfrastructureId): FacilityCriticality | undefined;
	exposure: ReadonlyMap<H3Index, CellExposure>;
}
