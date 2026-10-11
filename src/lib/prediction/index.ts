import { getBusReadiness } from './bus';
import { forecastPassengerSeries, monthIndex } from './monthly';
import type { ForecastBundle, PredictionSource } from './types';
export * from './types';
export * from './monthly';
export * from './bus';
export const MONTHLY_MODEL_VERSION = 'monthly-baselines-v2';

export function maldivesMonth(now: Date): string {
	return new Date(now.getTime() + 5 * 3600_000).toISOString().slice(0, 7);
}

export function getPredictionBundle(
	source: PredictionSource,
	now: Date | string = new Date(),
	requestedMonth?: string
): ForecastBundle {
	const date = typeof now === 'string' ? new Date(now) : now;
	if (!Number.isFinite(date.getTime())) throw new Error('Invalid prediction issue time');
	const currentMonthMvt = maldivesMonth(date);
	const targetMonth = requestedMonth ?? currentMonthMvt;
	if (!Number.isFinite(monthIndex(targetMonth)))
		throw new Error('Invalid target month; use YYYY-MM');
	const rawSources = source.audit.sources;
	const sources =
		rawSources && typeof rawSources === 'object' && !Array.isArray(rawSources)
			? Object.entries(rawSources).flatMap(([id, entry]) => {
					if (!entry || typeof entry !== 'object') return [];
					const item = entry as Record<string, unknown>;
					return typeof item.url === 'string' && typeof item.sha256 === 'string'
						? [
								{
									id,
									url: item.url,
									sha256: item.sha256,
									publicationSheet: String(item.publication_sheet ?? '')
								}
							]
						: [];
				})
			: [];
	return {
		generatedAt: date.toISOString(),
		sourceAsOf: source.asOf,
		sourceIds: source.sourceIds,
		dataQualityNotes: source.dataQualityNotes,
		target: {
			month: targetMonth,
			currentMonthMvt,
			kind:
				targetMonth === currentMonthMvt
					? 'nowcast'
					: targetMonth > currentMonthMvt
						? 'future'
						: 'retrospective-preview'
		},
		provenance: {
			modelVersion: MONTHLY_MODEL_VERSION,
			transformVersion: String(source.audit.transformVersion ?? 'Unrecorded'),
			checkedAt: String(source.audit.monthlyAuditAsOf ?? source.asOf),
			latestPublicationDate: String(source.audit.publishedAt ?? 'Unrecorded'),
			revisionQualification:
				'Historical checks use the current revised workbook vintage. Original publication-time availability has not been reconstructed; reference-month embargo does not remove revision or publication-lag bias.',
			sources
		},
		monthly: source.series.map((series) => forecastPassengerSeries(series, targetMonth)),
		bus: getBusReadiness(source.busObservationReplay, date, source.audit.busCapture)
	};
}
