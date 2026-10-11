import type { PlanningSource } from '../planning/types.ts';

/** Keep source period, retrieval and validation separate; absence is explicit. */
export function sourceEvidence(source: Pick<PlanningSource, 'id' | 'title' | 'url'>) {
	const metadata = source as Record<string, unknown>;
	const text = (key: string) =>
		typeof metadata[key] === 'string' || typeof metadata[key] === 'number'
			? String(metadata[key])
			: null;
	return {
		id: source.id,
		title: source.title ?? source.id,
		url: source.url,
		reference: text('referencePeriod') ?? text('referenceYear') ?? 'Source period not supplied',
		collected: text('fetchedAt') ?? text('retrievedAt'),
		validated: text('lastValidatedAt'),
		status: text('status') ?? 'Status not supplied',
		qualification: text('qualification'),
		license: text('license') ?? text('licenseStatus')
	};
}

export function supportedPolicyDates(
	baseline: import('../planning/types.ts').PlanningBaseline
): string[] {
	const dates = new Set([baseline.referenceDate]);
	for (const pattern of baseline.transit.patterns) {
		if (pattern.provenance !== 'observed') continue;
		for (const date of pattern.calendar.includedDates ?? []) dates.add(date);
		if (pattern.calendar.startDate) dates.add(pattern.calendar.startDate);
		if (pattern.calendar.endDate) dates.add(pattern.calendar.endDate);
	}
	return [...dates].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
}
