import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FeatureCollection, Geometry } from 'geojson';

export interface PolicyEvidenceSource {
	id: string;
	title: string;
	url: string;
	publisher: string;
	referencePeriod: string;
	retrievedAt: string;
	checksum: string;
	coverage: string;
	units: string;
	licenseStatus: string;
	transformationVersion: string;
}

export interface PolicyEvidenceLayer {
	id: string;
	title: string;
	sourceIds: string[];
	coverage: string;
	referencePeriod: string;
	recordCount: number;
	sourceRecordCount: number;
	unlocatedRecords: number;
	status: 'partial' | 'unavailable';
	limitations: string[];
	features: FeatureCollection<Geometry, Record<string, unknown>>;
	/** False only in the metadata-only API representation; recordCount remains the source count. */
	featuresLoaded?: boolean;
}

export interface PolicyEvidenceObservation {
	id: string;
	metric: string;
	value: number | null;
	unit: string;
	referencePeriod: string;
	geography: string;
	sourceId: string;
	definition: string;
}

export interface PolicyEvidenceConstituency {
	id: string;
	name: string;
	islandId: string;
	population: number;
	maldivianPopulation: number;
	foreignPopulation: number;
	malePopulation: number;
	femalePopulation: number;
	ageGroupsMaldivian: { label: string; value: number }[];
	sourceId: string;
	boundaryMatched: false;
}

export interface PolicyEvidenceBundle {
	schemaVersion: 1;
	version: string;
	generatedAt: string;
	stale: boolean;
	sources: PolicyEvidenceSource[];
	layers: PolicyEvidenceLayer[];
	schoolCompleteness: {
		referencePeriod: string;
		publishedSchools: number | null;
		publishedEnrollment: number | null;
		sectorCounts: { sector: string; schools: number; enrollment: number }[];
		mappedEligibleLocations: number | null;
		matchedInstitutions: number | null;
		sourceIds: string[];
		limitations: string[];
	};
	observations: PolicyEvidenceObservation[];
	constituencies: PolicyEvidenceConstituency[];
	gaps: string[];
	agencyRequests: string[];
}

type Row = Record<string, unknown>;
const object = (value: unknown, name: string): Row => {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error(`Invalid ${name}`);
	return value as Row;
};
const text = (value: unknown, name: string): string => {
	if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${name}`);
	return value;
};
const list = (value: unknown, name: string): unknown[] => {
	if (!Array.isArray(value)) throw new Error(`Invalid ${name}`);
	return value;
};
const nonnegative = (value: unknown, name: string): number => {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
		throw new Error(`Invalid ${name}`);
	return value;
};
const nullable = (value: unknown, name: string): number | null =>
	value === null ? null : nonnegative(value, name);
const strings = (value: unknown, name: string): string[] =>
	list(value, name).map((item) => text(item, name));
const unique = <T extends { id: string }>(values: T[], name: string): T[] => {
	if (new Set(values.map((row) => row.id)).size !== values.length)
		throw new Error(`Duplicate ${name}`);
	return values;
};

function coordinates(value: unknown): void {
	const values = list(value, 'geometry coordinates');
	if (typeof values[0] === 'number') {
		const [lon, lat] = values;
		if (
			typeof lon !== 'number' ||
			typeof lat !== 'number' ||
			!Number.isFinite(lon) ||
			!Number.isFinite(lat) ||
			lon < 73.4 ||
			lon > 73.65 ||
			lat < 4.1 ||
			lat > 4.35
		)
			throw new Error('Policy geometry outside Greater Malé');
	} else {
		if (!values.length) throw new Error('Empty policy geometry');
		values.forEach(coordinates);
	}
}

/** Validate local evidence before serving; unknown coverage is never converted to zero. */
export function validatePolicyEvidence(value: unknown): PolicyEvidenceBundle {
	const row = object(value, 'policy evidence');
	if (row.schemaVersion !== 1) throw new Error('Unsupported policy evidence schema');
	const version = text(row.version, 'version');
	const generatedAt = text(row.generatedAt, 'generation date');
	if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('Invalid generation date');
	const sources = unique(
		list(row.sources, 'sources').map((entry) => {
			const source = object(entry, 'source');
			const result = Object.fromEntries(
				[
					'id',
					'title',
					'url',
					'publisher',
					'referencePeriod',
					'retrievedAt',
					'checksum',
					'coverage',
					'units',
					'licenseStatus',
					'transformationVersion'
				].map((key) => [key, text(source[key], key)])
			) as unknown as PolicyEvidenceSource;
			if (!URL.canParse(result.url) || new URL(result.url).protocol !== 'https:')
				throw new Error('Invalid policy source URL');
			if (!/^[a-f0-9]{64}$/.test(result.checksum))
				throw new Error('Invalid policy source checksum');
			if (!Number.isFinite(Date.parse(result.retrievedAt)))
				throw new Error('Invalid retrieval date');
			return result;
		}),
		'sources'
	);
	const sourceIds = new Set(sources.map((source) => source.id));
	const refs = (value: unknown): string[] => {
		const ids = strings(value, 'source references');
		if (ids.some((id) => !sourceIds.has(id))) throw new Error('Unknown policy source');
		return ids;
	};
	const layers = unique(
		list(row.layers, 'layers').map((entry) => {
			const layer = object(entry, 'layer');
			const collection = object(layer.features, 'features');
			if (collection.type !== 'FeatureCollection') throw new Error('Invalid feature collection');
			const features = list(collection.features, 'features').map((entry) => {
				const feature = object(entry, 'feature');
				const props = object(feature.properties, 'properties');
				const geometry = object(feature.geometry, 'geometry');
				if (
					feature.type !== 'Feature' ||
					![
						'Point',
						'LineString',
						'Polygon',
						'MultiPolygon',
						'MultiLineString',
						'MultiPoint'
					].includes(String(geometry.type))
				)
					throw new Error('Invalid policy feature');
				if (!sourceIds.has(text(props.sourceId, 'feature source')))
					throw new Error('Unknown feature source');
				if (
					Object.keys(props).some((key) =>
						/surveyed_by|created_user|edited_user|edited_by|security|cctv|additional_comment/i.test(
							key
						)
					)
				)
					throw new Error('Unapproved policy attributes');
				coordinates(geometry.coordinates);
				return feature;
			});
			const featureIds = features.map((feature) =>
				text(object(feature.properties, 'properties').id, 'feature id')
			);
			if (new Set(featureIds).size !== features.length) throw new Error('Duplicate policy feature');
			const recordCount = nonnegative(layer.recordCount, 'record count');
			const sourceRecordCount = nonnegative(layer.sourceRecordCount, 'source record count');
			const unlocatedRecords = nonnegative(layer.unlocatedRecords, 'unlocated records');
			if (recordCount !== features.length || sourceRecordCount !== recordCount + unlocatedRecords)
				throw new Error('Policy layer count mismatch');
			if (layer.status !== 'partial' && layer.status !== 'unavailable')
				throw new Error('Invalid layer status');
			if ((layer.status === 'unavailable') !== (features.length === 0))
				throw new Error('Invalid empty layer status');
			return {
				id: text(layer.id, 'layer id'),
				title: text(layer.title, 'layer title'),
				sourceIds: refs(layer.sourceIds),
				coverage: text(layer.coverage, 'coverage'),
				referencePeriod: text(layer.referencePeriod, 'reference period'),
				recordCount,
				sourceRecordCount,
				unlocatedRecords,
				status: layer.status,
				limitations: strings(layer.limitations, 'limitations'),
				features: collection as unknown as FeatureCollection<Geometry, Record<string, unknown>>
			} as PolicyEvidenceLayer;
		}),
		'layers'
	);
	const school = object(row.schoolCompleteness, 'school completeness');
	const sectorCounts = list(school.sectorCounts, 'school sectors').map((entry) => {
		const sector = object(entry, 'school sector');
		return {
			sector: text(sector.sector, 'sector'),
			schools: nonnegative(sector.schools, 'schools'),
			enrollment: nonnegative(sector.enrollment, 'enrollment')
		};
	});
	const publishedSchools = nullable(school.publishedSchools, 'published schools');
	const publishedEnrollment = nullable(school.publishedEnrollment, 'published enrollment');
	if (
		publishedSchools !== null &&
		sectorCounts.reduce((sum, sector) => sum + sector.schools, 0) !== publishedSchools
	)
		throw new Error('School total mismatch');
	if (
		publishedEnrollment !== null &&
		sectorCounts.reduce((sum, sector) => sum + sector.enrollment, 0) !== publishedEnrollment
	)
		throw new Error('Enrollment total mismatch');
	const observations = unique(
		list(row.observations, 'observations').map((entry) => {
			const item = object(entry, 'observation');
			refs([item.sourceId]);
			return {
				id: text(item.id, 'id'),
				metric: text(item.metric, 'metric'),
				value: nullable(item.value, 'value'),
				unit: text(item.unit, 'unit'),
				referencePeriod: text(item.referencePeriod, 'period'),
				geography: text(item.geography, 'geography'),
				sourceId: text(item.sourceId, 'source'),
				definition: text(item.definition, 'definition')
			};
		}),
		'observations'
	);
	const constituencies = unique(
		list(row.constituencies, 'constituencies').map((entry) => {
			const item = object(entry, 'constituency');
			refs([item.sourceId]);
			if (item.boundaryMatched !== false) throw new Error('Constituency boundary not audited');
			const population = nonnegative(item.population, 'population'),
				maldivianPopulation = nonnegative(item.maldivianPopulation, 'Maldivian population'),
				foreignPopulation = nonnegative(item.foreignPopulation, 'foreign population');
			const malePopulation = nonnegative(item.malePopulation, 'male population'),
				femalePopulation = nonnegative(item.femalePopulation, 'female population');
			const ageGroupsMaldivian = list(item.ageGroupsMaldivian, 'age groups').map((entry) => {
				const group = object(entry, 'age group');
				return {
					label: text(group.label, 'age group label'),
					value: nonnegative(group.value, 'age group population')
				};
			});
			if (
				population !== maldivianPopulation + foreignPopulation ||
				population !== malePopulation + femalePopulation ||
				ageGroupsMaldivian.reduce((sum, group) => sum + group.value, 0) !== maldivianPopulation
			)
				throw new Error('Constituency population mismatch');
			return {
				id: text(item.id, 'id'),
				name: text(item.name, 'name'),
				islandId: text(item.islandId, 'island'),
				population,
				maldivianPopulation,
				foreignPopulation,
				malePopulation,
				femalePopulation,
				ageGroupsMaldivian,
				sourceId: text(item.sourceId, 'source'),
				boundaryMatched: false as const
			};
		}),
		'constituencies'
	);
	return {
		schemaVersion: 1,
		version,
		generatedAt,
		stale: row.stale === true,
		sources,
		layers,
		observations,
		constituencies,
		schoolCompleteness: {
			referencePeriod: text(school.referencePeriod, 'school period'),
			publishedSchools,
			publishedEnrollment,
			sectorCounts,
			mappedEligibleLocations: nullable(school.mappedEligibleLocations, 'mapped schools'),
			matchedInstitutions: nullable(school.matchedInstitutions, 'matched institutions'),
			sourceIds: refs(school.sourceIds),
			limitations: strings(school.limitations, 'school limitations')
		},
		gaps: strings(row.gaps, 'gaps'),
		agencyRequests: strings(row.agencyRequests, 'agency requests')
	};
}

export function createPolicyEvidenceLoader(
	read: (path: string) => Promise<string> = (path) => readFile(path, 'utf8'),
	root = process.cwd()
) {
	let last: PolicyEvidenceBundle | null = null;
	return async (): Promise<PolicyEvidenceBundle> => {
		try {
			last = validatePolicyEvidence(
				JSON.parse(await read(join(root, 'data/public/policy-evidence/bundle.json')))
			);
		} catch {
			if (last)
				return {
					...last,
					stale: true,
					gaps: [...last.gaps, 'Local refresh failed validation; last validated snapshot retained.']
				};
		}
		return (
			last ?? {
				schemaVersion: 1,
				version: 'policy-evidence-unavailable',
				generatedAt: new Date().toISOString(),
				stale: false,
				sources: [],
				layers: [],
				observations: [],
				constituencies: [],
				schoolCompleteness: {
					referencePeriod: 'Unavailable',
					publishedSchools: null,
					publishedEnrollment: null,
					sectorCounts: [],
					mappedEligibleLocations: null,
					matchedInstitutions: null,
					sourceIds: [],
					limitations: ['No validated school context snapshot loaded.']
				},
				gaps: ['No validated local policy evidence. Run npm run data:policy-evidence.'],
				agencyRequests: []
			}
		);
	};
}

export const loadPolicyEvidence = createPolicyEvidenceLoader();
