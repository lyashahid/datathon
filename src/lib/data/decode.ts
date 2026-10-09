import type { LineString, Point, Position } from 'geojson';
import type { AssetMetadata, DatasetInfo, MetadataValue, SourceInfo } from '#lib/types/domain.ts';
import { PROVENANCES } from '#lib/types/domain.ts';

/** Raised when external data does not match the domain model; `path` locates the bad value. */
export class DataValidationError extends Error {
	constructor(
		readonly path: string,
		message: string
	) {
		super(`${path}: ${message}`);
		this.name = 'DataValidationError';
	}
}

export type Json = Record<string, unknown>;

export function expectRecord(value: unknown, path: string): Json {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new DataValidationError(path, 'expected an object');
	}
	return value as Json;
}

export function expectArray(value: unknown, path: string): unknown[] {
	if (!Array.isArray(value)) throw new DataValidationError(path, 'expected an array');
	return value;
}

export function expectString(value: unknown, path: string): string {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new DataValidationError(path, 'expected a non-empty string');
	}
	return value;
}

export function expectOneOf<T extends string>(
	value: unknown,
	allowed: readonly T[],
	path: string
): T {
	if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
		throw new DataValidationError(path, `expected one of ${allowed.join(', ')}`);
	}
	return value as T;
}

function expectPosition(value: unknown, path: string): Position {
	const arr = expectArray(value, path);
	const [lng, lat] = arr;
	if (
		arr.length < 2 ||
		typeof lng !== 'number' ||
		typeof lat !== 'number' ||
		Math.abs(lng) > 180 ||
		Math.abs(lat) > 90
	) {
		throw new DataValidationError(path, 'expected [longitude, latitude]');
	}
	return [lng, lat];
}

export function expectPoint(value: unknown, path: string): Point {
	const g = expectRecord(value, path);
	if (g.type !== 'Point') throw new DataValidationError(`${path}.type`, 'expected Point');
	return { type: 'Point', coordinates: expectPosition(g.coordinates, `${path}.coordinates`) };
}

export function expectLineString(value: unknown, path: string): LineString {
	const g = expectRecord(value, path);
	if (g.type !== 'LineString') {
		throw new DataValidationError(`${path}.type`, 'expected LineString');
	}
	const coords = expectArray(g.coordinates, `${path}.coordinates`);
	if (coords.length < 2) {
		throw new DataValidationError(`${path}.coordinates`, 'expected at least 2 positions');
	}
	return {
		type: 'LineString',
		coordinates: coords.map((c, i) => expectPosition(c, `${path}.coordinates[${i}]`))
	};
}

export function expectSource(value: unknown, path: string): SourceInfo {
	const s = expectRecord(value, path);
	const synthetic = s.syntheticFields === undefined ? [] : expectArray(s.syntheticFields, path);
	return {
		provenance: expectOneOf(s.provenance, PROVENANCES, `${path}.provenance`),
		dataset: expectString(s.dataset, `${path}.dataset`),
		syntheticFields: synthetic.map((f, i) => expectString(f, `${path}.syntheticFields[${i}]`)),
		...(typeof s.note === 'string' ? { note: s.note } : {}),
		...(typeof s.reference === 'string' ? { reference: s.reference } : {})
	};
}

export function expectMetadata(value: unknown, path: string): AssetMetadata {
	if (value === undefined) return {};
	const m = expectRecord(value, path);
	const result: AssetMetadata = {};
	for (const [key, v] of Object.entries(m)) {
		if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) {
			throw new DataValidationError(`${path}.${key}`, 'expected a scalar value');
		}
		result[key] = v as MetadataValue;
	}
	return result;
}

export function expectDataset(value: unknown, path: string): DatasetInfo {
	const d = expectRecord(value, path);
	return {
		id: expectString(d.id, `${path}.id`),
		title: expectString(d.title, `${path}.title`),
		version: expectString(d.version, `${path}.version`),
		provenance: expectOneOf(d.provenance, PROVENANCES, `${path}.provenance`),
		description: expectString(d.description, `${path}.description`)
	};
}

/** Reads a FeatureCollection with our `dataset` foreign member and returns its parts. */
export function expectFeatureCollection(value: unknown): {
	dataset: DatasetInfo;
	features: Json[];
} {
	const fc = expectRecord(value, '$');
	if (fc.type !== 'FeatureCollection') {
		throw new DataValidationError('$.type', 'expected FeatureCollection');
	}
	return {
		dataset: expectDataset(fc.dataset, '$.dataset'),
		features: expectArray(fc.features, '$.features').map((f, i) =>
			expectRecord(f, `$.features[${i}]`)
		)
	};
}

export function assertUniqueIds(items: readonly { id: string }[], label: string): void {
	const seen = new Set<string>();
	for (const { id } of items) {
		if (seen.has(id)) throw new DataValidationError(label, `duplicate id "${id}"`);
		seen.add(id);
	}
}
