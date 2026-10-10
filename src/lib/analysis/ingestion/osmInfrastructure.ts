import { INFRASTRUCTURE_TYPE_STYLES } from '#lib/config/infrastructure.ts';
import { INGESTION_RULES, OSM_TAG_RULES } from '#lib/config/ingestion.ts';
import type { InfrastructureFeature, InfrastructureType } from '#lib/types/domain.ts';
import { haversineM } from '../geo.ts';
import { canonicalPosition } from './geometry.ts';
import { isObject, runPipeline, text, type Conversion } from './pipeline.ts';
import type { AdapterOptions, IngestResult } from './types.ts';

export const OSM_ADAPTER = 'osm-infrastructure';

function typeFromTags(tags: Record<string, unknown>): InfrastructureType | null {
	return OSM_TAG_RULES.find((r) => tags[r.key] === r.value)?.type ?? null;
}

/**
 * Accepts the two common OSM export shapes: Overpass JSON (`elements`, nodes with lat/lon,
 * ways/relations with `center` via `out center`) and GeoJSON with tags in `properties`.
 */
function elementsOf(raw: unknown): unknown[] {
	if (isObject(raw) && Array.isArray(raw.elements)) return raw.elements;
	if (isObject(raw) && Array.isArray(raw.features)) {
		return raw.features.map((f) => {
			if (!isObject(f)) return f;
			const props = isObject(f.properties) ? f.properties : {};
			const geom = isObject(f.geometry) ? f.geometry : {};
			const coords =
				geom.type === 'Point' && Array.isArray(geom.coordinates) ? geom.coordinates : [];
			const [osmType, osmId] = String(f.id ?? props['@id'] ?? '').split('/');
			return { type: osmType, id: osmId, lon: coords[0], lat: coords[1], tags: props };
		});
	}
	return [];
}

function convert(
	raw: unknown,
	index: number,
	opts: AdapterOptions
): Conversion<InfrastructureFeature> {
	if (!isObject(raw)) return { ok: false, reason: 'invalid_value', detail: 'not an object' };
	const tags = isObject(raw.tags) ? raw.tags : null;
	if (!tags) return { ok: false, reason: 'missing_field', detail: 'no tags', field: 'tags' };
	const type = typeFromTags(tags);
	if (!type) return { ok: false, reason: 'invalid_value', detail: 'no mapped infrastructure tag' };

	const centre = isObject(raw.center) ? raw.center : raw;
	if (centre.lat === undefined || centre.lon === undefined) {
		return { ok: false, reason: 'missing_field', detail: 'no coordinates', field: 'geometry' };
	}
	const position = canonicalPosition([centre.lon, centre.lat], opts.crs);
	if (!position) {
		return {
			ok: false,
			reason: 'invalid_geometry',
			detail: `bad coordinates ${centre.lon}, ${centre.lat}`
		};
	}

	const osmType = text(raw.type) ?? 'node';
	const osmId = text(raw.id) ?? `row${index}`;
	const warnings: { field: string; detail: string }[] = [];
	let name = text(tags.name) ?? text(tags['name:en']);
	if (!name) {
		name = `${INFRASTRUCTURE_TYPE_STYLES[type].label} (OSM ${osmType} ${osmId})`;
		warnings.push({ field: 'name', detail: 'unnamed; generated a descriptive name' });
	}
	const located = opts.islandAt?.(position) ?? null;
	if (!located) warnings.push({ field: 'island', detail: 'outside known island outlines' });

	return {
		ok: true,
		warnings,
		value: {
			id: `osm-${osmType}-${osmId}`,
			name,
			type,
			status: 'existing',
			geometry: { type: 'Point', coordinates: position },
			source: {
				provenance: opts.provenance,
				dataset: opts.dataset,
				syntheticFields: [],
				reference: `https://www.openstreetmap.org/${osmType}/${osmId}`,
				note: '© OpenStreetMap contributors (ODbL)'
			},
			metadata: {
				...(located ? { island: located.island } : {}),
				...(located?.atoll ? { atoll: located.atoll } : {}),
				...(text(tags.operator) ? { operator: text(tags.operator)! } : {})
			}
		}
	};
}

export function ingestOsmInfrastructure(
	raw: unknown,
	opts: AdapterOptions
): IngestResult<InfrastructureFeature> {
	return runPipeline({
		adapter: OSM_ADAPTER,
		source: opts.source,
		crs: opts.crs,
		records: elementsOf(raw),
		convert: (r, i) => convert(r, i, opts),
		isDuplicate: (a, b) =>
			a.id === b.id ||
			(a.type === b.type &&
				haversineM(a.geometry.coordinates, b.geometry.coordinates) <
					INGESTION_RULES.duplicateDistanceM),
		describe: (f) => `${f.name} [${f.id}]`
	});
}
