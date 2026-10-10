import { INGESTION_RULES } from '#lib/config/ingestion.ts';
import { canonicalPosition } from './geometry.ts';
import { isObject, numeric, runPipeline, text, type Conversion } from './pipeline.ts';
import type { AdapterOptions, DemographicRecord, IngestResult } from './types.ts';

export const DEMOGRAPHICS_ADAPTER = 'census-style-demographics';

/**
 * Maps a tabular population file onto the canonical record. The defaults match only the
 * project's fixture; for a real file (e.g. official census tables) supply its column names.
 * No official schema is assumed.
 */
export interface DemographicColumns {
	areaId: string;
	name?: string;
	island: string;
	atoll?: string;
	population: string;
	children?: string;
	workingAge?: string;
	olderPopulation?: string;
	households?: string;
	x?: string;
	y?: string;
}

export const DEFAULT_DEMOGRAPHIC_COLUMNS: DemographicColumns = {
	areaId: 'area_id',
	name: 'area_name',
	island: 'island',
	atoll: 'atoll',
	population: 'population',
	children: 'age_0_14',
	workingAge: 'age_15_64',
	olderPopulation: 'age_65_plus',
	households: 'households',
	x: 'x',
	y: 'y'
};

type Optional = 'children' | 'workingAge' | 'olderPopulation' | 'households';
const OPTIONAL: readonly Optional[] = ['children', 'workingAge', 'olderPopulation', 'households'];

function convert(
	raw: unknown,
	cols: DemographicColumns,
	opts: AdapterOptions
): Conversion<DemographicRecord> {
	if (!isObject(raw)) return { ok: false, reason: 'invalid_value', detail: 'not a row' };
	const areaId = text(raw[cols.areaId]);
	if (!areaId)
		return { ok: false, reason: 'missing_field', detail: 'no area id', field: cols.areaId };
	const island = text(raw[cols.island]);
	if (!island)
		return { ok: false, reason: 'missing_field', detail: 'no island', field: cols.island };
	const population = numeric(raw[cols.population]);
	if (population === null) {
		return { ok: false, reason: 'missing_field', detail: 'no population', field: cols.population };
	}
	if (!Number.isInteger(population) || population < 0) {
		return {
			ok: false,
			reason: 'invalid_value',
			detail: `population "${raw[cols.population]}" is not a count`
		};
	}

	const warnings: { field: string; detail: string }[] = [];
	const values = {} as Record<Optional, number | null>;
	for (const key of OPTIONAL) {
		const column = cols[key];
		const v = column ? numeric(raw[column]) : null;
		if (v === null) {
			values[key] = null;
			warnings.push({ field: column ?? key, detail: `${key} not provided` });
		} else if (!Number.isInteger(v) || v < 0) {
			return {
				ok: false,
				reason: 'invalid_value',
				detail: `${key} "${column ? raw[column] : ''}" is not a count`
			};
		} else values[key] = v;
	}

	const groups = [values.children, values.workingAge, values.olderPopulation];
	if (groups.every((g) => g !== null)) {
		const sum = groups.reduce((s, g) => s + (g ?? 0), 0);
		if (Math.abs(sum - population) > population * INGESTION_RULES.populationSumTolerance) {
			return {
				ok: false,
				reason: 'invalid_value',
				detail: `age groups sum to ${sum}, population is ${population}`
			};
		}
	}

	let centroid: DemographicRecord['centroid'] = null;
	if (cols.x && cols.y) {
		const x = numeric(raw[cols.x]);
		const y = numeric(raw[cols.y]);
		if (x !== null && y !== null) {
			centroid = canonicalPosition([x, y], opts.crs);
			if (!centroid)
				return { ok: false, reason: 'invalid_geometry', detail: `bad coordinates ${x}, ${y}` };
		} else warnings.push({ field: 'centroid', detail: 'no representative point' });
	}

	return {
		ok: true,
		warnings,
		value: {
			areaId,
			name: (cols.name && text(raw[cols.name])) || areaId,
			island,
			atoll: (cols.atoll && text(raw[cols.atoll])) || null,
			population,
			...values,
			centroid,
			provenance: opts.provenance,
			dataset: opts.dataset
		}
	};
}

export function ingestDemographics(
	rows: readonly unknown[],
	opts: AdapterOptions,
	columns: DemographicColumns = DEFAULT_DEMOGRAPHIC_COLUMNS
): IngestResult<DemographicRecord> {
	return runPipeline({
		adapter: DEMOGRAPHICS_ADAPTER,
		source: opts.source,
		crs: opts.crs,
		records: rows,
		convert: (r) => convert(r, columns, opts),
		isDuplicate: (a, b) => a.areaId === b.areaId,
		describe: (r) => `area ${r.areaId}`
	});
}
