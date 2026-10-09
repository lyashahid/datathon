import type { InfrastructureFeature, RouteCollection, TransportRoute } from '#lib/types/domain.ts';
import { ASSET_STATUSES, TRANSPORT_MODES } from '#lib/types/domain.ts';
import {
	DataValidationError,
	assertUniqueIds,
	expectArray,
	expectFeatureCollection,
	expectLineString,
	expectMetadata,
	expectOneOf,
	expectRecord,
	expectSource,
	expectString
} from './decode.ts';

export const ROUTES_ENDPOINT = '/api/routes';

/** Converts a route GeoJSON FeatureCollection into validated domain records. */
export function decodeRouteCollection(json: unknown): RouteCollection {
	const { dataset, features } = expectFeatureCollection(json);
	const routes = features.map((f, i): TransportRoute => {
		const path = `$.features[${i}]`;
		const p = expectRecord(f.properties, `${path}.properties`);
		return {
			id: expectString(f.id, `${path}.id`),
			name: expectString(p.name, `${path}.properties.name`),
			mode: expectOneOf(p.mode, TRANSPORT_MODES, `${path}.properties.mode`),
			status: expectOneOf(p.status, ASSET_STATUSES, `${path}.properties.status`),
			geometry: expectLineString(f.geometry, `${path}.geometry`),
			stopIds: expectArray(p.stopIds, `${path}.properties.stopIds`).map((s, j) =>
				expectString(s, `${path}.properties.stopIds[${j}]`)
			),
			source: expectSource(p.source, `${path}.properties.source`),
			metadata: expectMetadata(p.metadata, `${path}.properties.metadata`)
		};
	});
	assertUniqueIds(routes, '$.features');
	return { dataset, routes };
}

/** Every stop a route references must exist in the infrastructure set. */
export function assertRouteStopsExist(
	routes: readonly TransportRoute[],
	infrastructure: readonly InfrastructureFeature[]
): void {
	const ids = new Set(infrastructure.map((f) => f.id));
	for (const route of routes) {
		for (const stopId of route.stopIds) {
			if (!ids.has(stopId)) {
				throw new DataValidationError(`route ${route.id}`, `unknown stop "${stopId}"`);
			}
		}
	}
}

/** Client-side adapter: components and page loads call this, never the raw files. */
export async function fetchRoutes(fetchFn: typeof fetch): Promise<RouteCollection> {
	const response = await fetchFn(ROUTES_ENDPOINT);
	if (!response.ok) throw new Error(`Routes request failed: HTTP ${response.status}`);
	return (await response.json()) as RouteCollection;
}
