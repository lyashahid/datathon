import type { InfrastructureCollection, RouteCollection } from '#lib/types/domain.ts';
import { BASELINE_SOURCE } from '$app/env/private';
import { processedBaselineSource } from './processedSource.ts';
import { sampleBaselineSource } from './sampleSource.ts';

/**
 * Where baseline infrastructure comes from, chosen by BASELINE_SOURCE: the bundled demo files
 * or the ingestion pipeline's output. Add official sources the same way without touching
 * endpoints or UI.
 */
export interface BaselineSource {
	getInfrastructure(): Promise<InfrastructureCollection>;
	getRoutes(): Promise<RouteCollection>;
}

export const baselineSource: BaselineSource =
	BASELINE_SOURCE === 'processed' ? processedBaselineSource : sampleBaselineSource;
