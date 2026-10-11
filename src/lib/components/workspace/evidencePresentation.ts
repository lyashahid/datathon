import type { PlanningSource } from '#lib/planning/types.ts';
import type { ForecastBundle } from '#lib/prediction/types.ts';

export type EvidenceSourceRow = PlanningSource & { groups: string[]; key: string };

/** Attribute only recognized publisher hosts; never infer freshness or reuse rights from a URL. */
export function evidenceSourceMetadata(source: PlanningSource): PlanningSource {
	let url: URL;
	try {
		url = new URL(source.url ?? '');
	} catch {
		return source;
	}
	const suppliedPublisher = evidenceText(source.publisher);
	const publisher =
		suppliedPublisher ??
		(url.hostname === 'statisticsmaldives.gov.mv'
			? 'Maldives Bureau of Statistics'
			: url.hostname === 'data.worldpop.org'
				? 'WorldPop'
				: null);
	const worldPopCoverage =
		url.hostname === 'data.worldpop.org' && /\/MDV\/.*\/100m\/constrained\//.test(url.pathname)
			? 'Maldives · 100 m constrained population raster, identified by the source file path. This is a modelled population surface, not a neighbourhood census.'
			: null;
	return {
		...source,
		...(publisher ? { publisher } : {}),
		...(!evidenceText(source.coverage) && worldPopCoverage ? { coverage: worldPopCoverage } : {})
	};
}

/** Workbook issue labels come from recorded filenames, not worksheet names or retrieval dates. */
export function forecastEvidenceSources(
	prediction:
		| (Pick<ForecastBundle, 'provenance'> & {
				monthly: Pick<ForecastBundle['monthly'][number], 'sourceUrl'>[];
		  })
		| null
): PlanningSource[] {
	if (!prediction?.provenance) return [];
	const provenance = prediction.provenance;
	return provenance.sources.map((source) => {
		const filename = source.url.split('/').at(-1) ?? '';
		const issue = filename.match(/^MIF[-_]([A-Za-z]+)[-_](\d{4})\.xlsx$/i);
		const monthName = issue
			? [
					'January',
					'February',
					'March',
					'April',
					'May',
					'June',
					'July',
					'August',
					'September',
					'October',
					'November',
					'December'
				].find(
					(month) =>
						month.toLowerCase() === issue[1].toLowerCase() ||
						month.slice(0, 3).toLowerCase() === issue[1].toLowerCase()
				)
			: null;
		const issueMonth = issue && monthName ? `${monthName} ${issue[2]}` : null;
		const isLatestPublication = prediction.monthly.some(
			(series) => series.sourceUrl === source.url
		);
		return evidenceSourceMetadata({
			...source,
			title: issueMonth
				? `Monthly statistics — ${issueMonth} workbook`
				: `Monthly statistics workbook · ${source.id}`,
			...(issueMonth ? { referencePeriod: `${issueMonth} workbook issue` } : {}),
			lastValidatedAt: provenance.checkedAt,
			status: 'receipt-recorded',
			coverage:
				'Used here for aggregate ferry and bus passenger-movement series and publication comparisons. No route or stop-level passenger allocation.',
			qualification:
				'The source receipt records the workbook URL, worksheet and file hash. Issue month is read from the filename, not the worksheet name; each workbook includes historical tables. Per-file retrieval time and retained-copy availability are not recorded. Review usable reporting months and forecast checks in Forecasts.',
			transformationVersion: provenance.transformVersion,
			...(isLatestPublication ? { publicationDate: provenance.latestPublicationDate } : {})
		});
	});
}

/** Keep snapshots with different file hashes separate, even if their publisher URL matches. */
export function collectEvidenceSources(
	groups: { name: string; sources: PlanningSource[] }[]
): EvidenceSourceRow[] {
	const rows = new Map<string, EvidenceSourceRow>();
	for (const group of groups) {
		for (const input of group.sources) {
			const source = evidenceSourceMetadata(input);
			const hash = evidenceText(source.sha256) ?? evidenceText(source.checksum) ?? '';
			const key = `${source.id}|${source.url ?? ''}|${hash}`;
			const previous = rows.get(key);
			if (previous) {
				if (!previous.groups.includes(group.name)) previous.groups.push(group.name);
				for (const [field, value] of Object.entries(source)) {
					if (previous[field] == null && value != null) previous[field] = value;
				}
			} else rows.set(key, { ...source, groups: [group.name], key });
		}
	}
	return [...rows.values()].sort((a, b) => (a.title ?? a.id).localeCompare(b.title ?? b.id));
}

export function evidenceText(value: unknown): string | null {
	return typeof value === 'string' && value.trim()
		? value
		: typeof value === 'number' && Number.isFinite(value)
			? String(value)
			: null;
}

/** Display source timestamps in Maldives time; a reporting month is not a retrieval date. */
export function evidenceDate(value: string | null | undefined, includeTime = false): string {
	if (!value) return 'Not supplied';
	if (/^\d{4}$/.test(value)) return value;
	if (/^\d{4}-\d{2}$/.test(value)) {
		const date = new Date(`${value}-01T12:00:00+05:00`);
		return Number.isFinite(date.getTime())
			? date.toLocaleDateString('en-GB', {
					month: 'long',
					year: 'numeric',
					timeZone: 'Indian/Maldives'
				})
			: value;
	}
	const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00+05:00` : value);
	if (!Number.isFinite(date.getTime())) return value;
	return (
		date.toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			timeZone: 'Indian/Maldives',
			...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {})
		}) + (includeTime ? ' MVT' : '')
	);
}

export function sourceMatches(source: EvidenceSourceRow, query: string): boolean {
	const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	const text = [
		source.id,
		source.title,
		source.url,
		source.publisher,
		source.coverage,
		source.referencePeriod,
		...source.groups
	]
		.join(' ')
		.toLowerCase();
	return terms.every((term) => text.includes(term));
}
