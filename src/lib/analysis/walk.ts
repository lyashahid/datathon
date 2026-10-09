import { WALK_MODEL } from '#lib/config/analysis.ts';

/** Walking minutes for a straight-line distance, inflated by the detour factor. */
export function walkMinutes(straightLineM: number): number {
	return (straightLineM * WALK_MODEL.detourFactor) / WALK_MODEL.speedMPerMin;
}

/** Straight-line radius reachable on foot in the given minutes. */
export function walkRadiusM(minutes: number): number {
	return (minutes * WALK_MODEL.speedMPerMin) / WALK_MODEL.detourFactor;
}
