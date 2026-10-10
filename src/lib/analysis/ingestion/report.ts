import type { Crs, IssueReason, ValidationReport } from './types.ts';

export function createReport(adapter: string, source: string, crs: Crs): ValidationReport {
	return {
		adapter,
		source,
		crs,
		processed: 0,
		accepted: 0,
		rejected: 0,
		missingFields: {},
		invalidGeometry: 0,
		invalidValues: 0,
		duplicates: 0,
		issues: []
	};
}

const COUNTER: Record<IssueReason, keyof ValidationReport | null> = {
	missing_field: null,
	invalid_geometry: 'invalidGeometry',
	invalid_value: 'invalidValues',
	duplicate: 'duplicates'
};

/** Records an issue; `field` also bumps the missing-field tally. Warnings do not reject. */
export function noteIssue(
	report: ValidationReport,
	index: number,
	reason: IssueReason,
	detail: string,
	options: { field?: string; warning?: boolean } = {}
): void {
	const warning = options.warning ?? false;
	report.issues.push({ index, reason, detail, warning });
	if (options.field) {
		report.missingFields[options.field] = (report.missingFields[options.field] ?? 0) + 1;
	}
	const counter = COUNTER[reason];
	if (counter && !warning) (report[counter] as number)++;
}

/** Plain-text summary for the CLI. */
export function formatReport(r: ValidationReport): string {
	const missing = Object.entries(r.missingFields)
		.map(([k, v]) => `${k}: ${v}`)
		.join(', ');
	return [
		`${r.adapter} ← ${r.source} (${r.crs})`,
		`  processed ${r.processed}, accepted ${r.accepted}, rejected ${r.rejected}`,
		`  invalid geometry ${r.invalidGeometry}, invalid values ${r.invalidValues}, duplicates ${r.duplicates}`,
		`  missing fields: ${missing || 'none'}`
	].join('\n');
}
