import type { InfrastructureCollection, InfrastructureFeature } from '#lib/types/domain.ts';
import { ASSET_STATUSES, INFRASTRUCTURE_TYPES } from '#lib/types/domain.ts';
import {
	assertUniqueIds,
	expectFeatureCollection,
	expectMetadata,
	expectOneOf,
	expectPoint,
	expectRecord,
	expectSource,
	expectString
} from './decode.ts';

export const INFRASTRUCTURE_ENDPOINT = '/api/infrastructure';

/** Converts an infrastructure GeoJSON FeatureCollection into validated domain records. */
export function decodeInfrastructureCollection(json: unknown): InfrastructureCollection {
	const { dataset, features } = expectFeatureCollection(json);
	const decoded = features.map((f, i): InfrastructureFeature => {
		const path = `$.features[${i}]`;
		const p = expectRecord(f.properties, `${path}.properties`);
		return {
			id: expectString(f.id, `${path}.id`),
			name: expectString(p.name, `${path}.properties.name`),
			type: expectOneOf(p.type, INFRASTRUCTURE_TYPES, `${path}.properties.type`),
			status: expectOneOf(p.status, ASSET_STATUSES, `${path}.properties.status`),
			geometry: expectPoint(f.geometry, `${path}.geometry`),
			source: expectSource(p.source, `${path}.properties.source`),
			metadata: expectMetadata(p.metadata, `${path}.properties.metadata`)
		};
	});
	assertUniqueIds(decoded, '$.features');
	return { dataset, features: decoded };
}

/** Client-side adapter: components and page loads call this, never the raw files. */
export async function fetchInfrastructure(
	fetchFn: typeof fetch
): Promise<InfrastructureCollection> {
	const response = await fetchFn(INFRASTRUCTURE_ENDPOINT);
	if (!response.ok) throw new Error(`Infrastructure request failed: HTTP ${response.status}`);
	return (await response.json()) as InfrastructureCollection;
}
