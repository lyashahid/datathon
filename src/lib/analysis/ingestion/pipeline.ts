import { createReport, noteIssue } from './report.ts';
import type { Crs, IngestResult, IssueReason } from './types.ts';

/** Outcome of turning one raw record into a canonical one. */
export type Conversion<T> =
	| { ok: true; value: T; warnings?: readonly { field: string; detail: string }[] }
	| { ok: false; reason: IssueReason; detail: string; field?: string };

export interface PipelineSpec<T> {
	adapter: string;
	source: string;
	crs: Crs;
	records: readonly unknown[];
	/** validate → normalise → transform CRS, for one record. Must not throw. */
	convert: (raw: unknown, index: number) => Conversion<T>;
	/** True when `candidate` duplicates an already accepted record. */
	isDuplicate: (candidate: T, accepted: T) => boolean;
	/** Description used in the duplicate issue message. */
	describe: (record: T) => string;
}

/**
 * Shared input-adapter pipeline: raw → validate → normalise → CRS → deduplicate → canonical.
 * Every rejection and gap is counted in the report rather than thrown, so one bad record
 * never stops an import. First occurrence wins on duplicates, keeping output deterministic.
 */
export function runPipeline<T>(spec: PipelineSpec<T>): IngestResult<T> {
	const report = createReport(spec.adapter, spec.source, spec.crs);
	const records: T[] = [];

	spec.records.forEach((raw, index) => {
		report.processed++;
		const result = spec.convert(raw, index);
		if (!result.ok) {
			report.rejected++;
			noteIssue(report, index, result.reason, result.detail, { field: result.field });
			return;
		}
		const original = records.find((r) => spec.isDuplicate(result.value, r));
		if (original) {
			report.rejected++;
			noteIssue(
				report,
				index,
				'duplicate',
				`${spec.describe(result.value)} duplicates ${spec.describe(original)}`
			);
			return;
		}
		for (const w of result.warnings ?? []) {
			noteIssue(report, index, 'missing_field', w.detail, { field: w.field, warning: true });
		}
		records.push(result.value);
		report.accepted++;
	});

	return { records, report };
}

export const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

export const text = (v: unknown): string | null =>
	typeof v === 'string' && v.trim() !== '' ? v.trim() : typeof v === 'number' ? String(v) : null;

/** Parses numbers from JSON numbers or CSV strings; empty → null, garbage → NaN. */
export function numeric(v: unknown): number | null {
	if (typeof v === 'number') return v;
	if (typeof v !== 'string' || v.trim() === '') return null;
	const n = Number(v.trim());
	return Number.isFinite(n) ? n : Number.NaN;
}

/** Stable ASCII slug for ids built from names. */
export const slug = (s: string) =>
	s
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
