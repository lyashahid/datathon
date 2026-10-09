import infrastructureRaw from '../../../../data/sample/infrastructure.geojson?raw';
import routesRaw from '../../../../data/sample/routes.geojson?raw';
import { decodeInfrastructureCollection } from '#lib/data/infrastructure.ts';
import { assertRouteStopsExist, decodeRouteCollection } from '#lib/data/routes.ts';
import type { InfrastructureCollection, RouteCollection } from '#lib/types/domain.ts';
import type { BaselineSource } from './baselineSource.ts';

let cache: { infrastructure: InfrastructureCollection; routes: RouteCollection } | undefined;

/** Decodes and cross-validates the bundled demo files once per server process. */
function load() {
	if (!cache) {
		const infrastructure = decodeInfrastructureCollection(JSON.parse(infrastructureRaw));
		const routes = decodeRouteCollection(JSON.parse(routesRaw));
		assertRouteStopsExist(routes.routes, infrastructure.features);
		cache = { infrastructure, routes };
	}
	return cache;
}

export const sampleBaselineSource: BaselineSource = {
	getInfrastructure: async () => load().infrastructure,
	getRoutes: async () => load().routes
};
