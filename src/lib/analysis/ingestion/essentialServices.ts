import { INGESTION_RULES, SERVICE_CATEGORIES } from '#lib/config/ingestion.ts';
import type { InfrastructureFeature } from '#lib/types/domain.ts';
import { haversineM } from '../geo.ts';
import { canonicalPosition } from './geometry.ts';
import { isObject, numeric, runPipeline, slug, text, type Conversion } from './pipeline.ts';
import type { AdapterOptions, IngestResult } from './types.ts';

export const SERVICES_ADAPTER = 'essential-services';

/** Which source columns hold which canonical field. Coordinates are x/y in the source CRS. */
export interface ServiceColumns {
	id?: string;
	name: string;
	category: string;
	x: string;
	y: string;
	island?: string;
}

export const DEFAULT_SERVICE_COLUMNS: ServiceColumns = {
	id: 'id',
	name: 'name',
	category: 'category',
	x: 'x',
	y: 'y',
	island: 'island'
};

function convert(
	raw: unknown,
	index: number,
	cols: ServiceColumns,
	opts: AdapterOptions
): Conversion<InfrastructureFeature> {
	if (!isObject(raw)) return { ok: false, reason: 'invalid_value', detail: 'not a row' };
	const name = text(raw[cols.name]);
	if (!name) return { ok: false, reason: 'missing_field', detail: 'no name', field: cols.name };
	const category = text(raw[cols.category])?.toLowerCase();
	if (!category)
		return { ok: false, reason: 'missing_field', detail: 'no category', field: cols.category };
	const type = SERVICE_CATEGORIES[category];
	if (!type)
		return { ok: false, reason: 'invalid_value', detail: `unsupported category "${category}"` };

	const x = numeric(raw[cols.x]);
	const y = numeric(raw[cols.y]);
	if (x === null || y === null) {
		return { ok: false, reason: 'missing_field', detail: 'no coordinates', field: 'coordinates' };
	}
	const position = canonicalPosition([x, y], opts.crs);
	if (!position)
		return { ok: false, reason: 'invalid_geometry', detail: `bad coordinates ${x}, ${y}` };

	const warnings: { field: string; detail: string }[] = [];
	const located = opts.islandAt?.(position) ?? null;
	const island = located?.island ?? (cols.island ? text(raw[cols.island]) : null);
	if (!island) warnings.push({ field: 'island', detail: 'island unknown' });

	return {
		ok: true,
		warnings,
		value: {
			id: `svc-${(cols.id && text(raw[cols.id])) || `${slug(name)}-${index}`}`,
			name,
			type,
			status: 'existing',
			geometry: { type: 'Point', coordinates: position },
			source: { provenance: opts.provenance, dataset: opts.dataset, syntheticFields: [] },
			metadata: {
				...(island ? { island } : {}),
				...(located?.atoll ? { atoll: located.atoll } : {}),
				category
			}
		}
	};
}

export function ingestEssentialServices(
	rows: readonly unknown[],
	opts: AdapterOptions,
	columns: ServiceColumns = DEFAULT_SERVICE_COLUMNS
): IngestResult<InfrastructureFeature> {
	return runPipeline({
		adapter: SERVICES_ADAPTER,
		source: opts.source,
		crs: opts.crs,
		records: rows,
		convert: (r, i) => convert(r, i, columns, opts),
		isDuplicate: (a, b) =>
			a.id === b.id ||
			(a.type === b.type &&
				haversineM(a.geometry.coordinates, b.geometry.coordinates) <
					INGESTION_RULES.duplicateDistanceM),
		describe: (f) => `${f.name} [${f.id}]`
	});
}
