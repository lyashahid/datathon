import type { DatasetInfo, Position, Provenance } from '#lib/types/domain.ts';

/** Coordinate reference systems the adapters can read. Output is always EPSG:4326. */
export const SUPPORTED_CRS = ['EPSG:4326', 'EPSG:3857', 'EPSG:32643'] as const;
export type Crs = (typeof SUPPORTED_CRS)[number];

export type IssueReason = 'missing_field' | 'invalid_geometry' | 'invalid_value' | 'duplicate';

/** Why one input record was rejected (or, for warnings, accepted with a gap). */
export interface RecordIssue {
	/** Position of the record in the raw input. */
	index: number;
	reason: IssueReason;
	detail: string;
	/** True when the record was still accepted (e.g. a missing optional field). */
	warning: boolean;
}

/** Per-source summary written next to the processed output. */
export interface ValidationReport {
	adapter: string;
	source: string;
	crs: Crs;
	processed: number;
	accepted: number;
	rejected: number;
	/** Field name → number of records missing it (required and optional). */
	missingFields: Record<string, number>;
	invalidGeometry: number;
	invalidValues: number;
	duplicates: number;
	issues: RecordIssue[];
}

export interface IngestResult<T> {
	records: T[];
	report: ValidationReport;
}

/** Where island names come from: a spatial join against outlines, supplied by the caller. */
export type IslandResolver = (p: Position) => { island: string; atoll: string | null } | null;

/** Options every adapter receives. Provenance is declared by whoever runs the import. */
export interface AdapterOptions {
	source: string;
	crs: Crs;
	dataset: string;
	provenance: Provenance;
	islandAt?: IslandResolver;
}

/**
 * Canonical demographic record for a small area. Deliberately generic: it does not mirror
 * any official census schema; a column map adapts whatever the real file uses.
 */
export interface DemographicRecord {
	areaId: string;
	name: string;
	island: string;
	atoll: string | null;
	population: number;
	children: number | null;
	workingAge: number | null;
	olderPopulation: number | null;
	households: number | null;
	/** Representative point, if the source has one. */
	centroid: Position | null;
	provenance: Provenance;
	dataset: string;
}

export interface DemographicCollection {
	dataset: DatasetInfo;
	records: DemographicRecord[];
}
