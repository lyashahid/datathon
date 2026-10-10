import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeInfrastructureCollection } from '#lib/data/infrastructure.ts';
import { assertRouteStopsExist, decodeRouteCollection } from '#lib/data/routes.ts';
import type { InfrastructureCollection, RouteCollection } from '#lib/types/domain.ts';
import type { BaselineSource } from './baselineSource.ts';

/** Written by `npm run ingest`; see docs/data-model.md. */
export const PROCESSED_DIR = 'data/processed';

let cache:
	Promise<{ infrastructure: InfrastructureCollection; routes: RouteCollection }> | undefined;

async function load() {
	const read = async (name: string) =>
		JSON.parse(await readFile(join(process.cwd(), PROCESSED_DIR, name), 'utf8')) as unknown;
	const infrastructure = decodeInfrastructureCollection(await read('infrastructure.geojson'));
	const routes = decodeRouteCollection(await read('routes.geojson'));
	assertRouteStopsExist(routes.routes, infrastructure.features);
	return { infrastructure, routes };
}

/**
 * Reads canonical output from the ingestion pipeline at runtime, with the same decoders and
 * cross-checks as the bundled sample. A failed load is not cached, so fixing the files and
 * reloading recovers without a restart.
 */
export const processedBaselineSource: BaselineSource = {
	getInfrastructure: async () => (await loaded()).infrastructure,
	getRoutes: async () => (await loaded()).routes
};

function loaded() {
	cache ??= load().catch((error: unknown) => {
		cache = undefined;
		throw error;
	});
	return cache;
}
