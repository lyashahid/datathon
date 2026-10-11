import type { PlanningAssumptions, PlanningBaseline } from './types.ts';
import { supportedSnapshotSettings } from './coverage.ts';

export const PLANNING_MODEL_VERSION = 'service-graph-1.2.0';
/** Numeric routing defaults are assumptions. Financial/carbon anchors are not fabricated. */
export function createDefaultAssumptions(baseline: PlanningBaseline): PlanningAssumptions {
	return {
		...supportedSnapshotSettings(baseline),
		targetMinutes: 30,
		goal: 'healthcare',
		populationYear: 2026,
		walkMPerMinute: 80,
		maxJourneyMinutes: 60,
		maxTransfers: 2,
		maxAccessWalkMinutes: 15,
		maxTransferWalkMinutes: 10,
		maxSnapM: 100,
		boardingBufferMinutes: 2,
		busMovingKph: 15,
		busDwellMinutes: 0.5,
		annualOperatingDays: 300,
		layoverMinutes: 10,
		fleetReserveShare: 0.15,
		displacedPassengerKm: { low: 0, central: 0, high: 0 },
		costs: { ...baseline.costAnchors }
	};
}
