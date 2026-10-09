import type { InfrastructureCollection, RouteCollection } from '#lib/types/domain.ts';
import { sampleBaselineSource } from './sampleSource.ts';

/**
 * Where baseline infrastructure comes from. Swap the implementation below (e.g. for processed
 * OSM extracts or an official dataset) without touching endpoints or UI.
 */
export interface BaselineSource {
	getInfrastructure(): Promise<InfrastructureCollection>;
	getRoutes(): Promise<RouteCollection>;
}

export const baselineSource: BaselineSource = sampleBaselineSource;
