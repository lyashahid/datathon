import type { EvaluationMetrics, MonthlyForecast, MonthlyModel, PassengerSeries } from './types';

const models: MonthlyModel[] = ['last-month', 'seasonal-naive', 'mean-3-months', 'mean-6-months'];
export function monthIndex(month: string): number {
	if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return NaN;
	const [year, m] = month.split('-').map(Number);
	return year * 12 + m - 1;
}
export function indexMonth(index: number): string {
	return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}
export function monthlyPointForecast(
	values: number[],
	horizon: number,
	model: MonthlyModel
): number | null {
	if (!Number.isInteger(horizon) || horizon < 1 || values.some((v) => !Number.isFinite(v) || v < 0))
		return null;
	if (model === 'last-month') return values.at(-1) ?? null;
	if (model === 'seasonal-naive')
		return values.length >= 12 ? values[values.length - 12 + ((horizon - 1) % 12)] : null;
	const count = model === 'mean-3-months' ? 3 : 6;
	return values.length >= count ? values.slice(-count).reduce((a, b) => a + b, 0) / count : null;
}
const quantile = (sorted: number[], q: number) => {
	const i = (sorted.length - 1) * q;
	return sorted[Math.floor(i)] + (sorted[Math.ceil(i)] - sorted[Math.floor(i)]) * (i % 1);
};

export function forecastPassengerSeries(
	series: PassengerSeries,
	targetMonth: string
): MonthlyForecast {
	const last = monthIndex(series.lastActualMonth);
	const target = monthIndex(targetMonth);
	const horizon = target - last;
	const result: MonthlyForecast = {
		seriesId: series.id,
		name: series.name,
		mode: series.mode,
		geography: series.geography,
		unit: series.unit,
		sourceUrl: series.sourceUrl,
		lastActualMonth: series.lastActualMonth,
		forecastMonth: targetMonth,
		horizonMonths: horizon,
		status: 'unavailable',
		estimate: null,
		empiricalRange: null,
		model: null,
		evaluation: null,
		benchmarks: [],
		projections: [],
		history: [...series.points],
		backtest: [],
		qualification: series.qualification,
		unavailableReason: null,
		modelCard: {
			target: 'Source-defined aggregate monthly passenger movements',
			intendedUse:
				'Review aggregate service-resource plans with release lag and historical error visible.',
			excludedUses: [
				'Neighborhood demand',
				'Road congestion',
				'Peak-hour capacity or occupancy',
				'Predicted healthcare access'
			],
			trainingCutoff: series.lastActualMonth,
			evaluation:
				'Earlier expanding origins select the model; six later origins evaluate it at the current release-lag horizon. Previously explored history; this is not a pristine prospective holdout.',
			limitations: [
				'Aggregate movements are not unique people.',
				'COVID, service changes and category revisions can break historical relationships.',
				'No pristine prospective holdout has been claimed.',
				'Checks use current revised source values, not the vintages available at each historical issue date. Publication-lag and revision bias remain.',
				'The historical range is not a certified probability interval.'
			]
		}
	};
	const unavailable = (reason: string) => ({ ...result, unavailableReason: reason });
	if (!Number.isFinite(last) || !Number.isFinite(target) || horizon < 1 || horizon > 12)
		return unavailable(
			'Forecast requires a valid future month, at most 12 months after the last actual.'
		);
	const points = [...series.points].sort((a, b) => a.month.localeCompare(b.month));
	if (!points.length || points.at(-1)?.month !== series.lastActualMonth)
		return unavailable('Last actual month does not match the source series.');
	if (
		points.some(
			(p, i) =>
				!Number.isFinite(monthIndex(p.month)) ||
				!Number.isFinite(p.value) ||
				p.value < 0 ||
				(i > 0 && monthIndex(p.month) !== monthIndex(points[i - 1].month) + 1)
		)
	)
		return unavailable(
			'Invalid, duplicate or missing monthly observations; no implicit imputation.'
		);
	const values = points.map((p) => p.value);
	const scores: Array<{
		model: MonthlyModel;
		metrics: EvaluationMetrics;
		residuals: number[];
		evaluationResiduals: number[];
		selectionMae: number;
	}> = [];
	for (const model of models) {
		const residuals: number[] = [];
		const actuals: number[] = [];
		const targetMonths: string[] = [];
		// Each origin sees only its prefix; the target is h months beyond that prefix.
		for (let count = 24; count + horizon <= values.length; count++) {
			const prediction = monthlyPointForecast(values.slice(0, count), horizon, model);
			if (prediction === null) continue;
			const targetIndex = count + horizon - 1;
			residuals.push(values[targetIndex] - prediction);
			actuals.push(values[targetIndex]);
			targetMonths.push(points[targetIndex].month);
		}
		// Embargo h-1 intervening targets: selection outcomes must exist by the first
		// evaluation origin, rather than merely precede its future target month.
		const selectionCount = residuals.length - 6 - (horizon - 1);
		if (selectionCount < 6) continue;
		const selectionResiduals = residuals.slice(0, selectionCount),
			evaluationResiduals = residuals.slice(-6);
		const absoluteSum = evaluationResiduals.reduce((s, r) => s + Math.abs(r), 0);
		const actualSum = actuals.slice(-6).reduce((s, v) => s + v, 0);
		scores.push({
			model,
			residuals: selectionResiduals,
			evaluationResiduals,
			selectionMae:
				selectionResiduals.reduce((s, r) => s + Math.abs(r), 0) / selectionResiduals.length,
			metrics: {
				mae: absoluteSum / evaluationResiduals.length,
				wape: actualSum ? absoluteSum / actualSum : null,
				n: evaluationResiduals.length,
				firstTargetMonth: targetMonths.at(-6)!,
				lastTargetMonth: targetMonths.at(-1)!,
				horizonMonths: horizon,
				qualification:
					'Six later expanding origins evaluate a model selected on earlier origins. This history was previously explored; overlapping origins are not independent experiments.'
			}
		});
	}
	if (!scores.length)
		return unavailable(
			'Insufficient chronological comparisons at this release-lag horizon (24 initial months, 6 selection and 6 later evaluation targets, plus horizon embargo required).'
		);
	scores.sort(
		(a, b) => a.selectionMae - b.selectionMae || models.indexOf(a.model) - models.indexOf(b.model)
	);
	const selected = scores[0];
	const estimate = monthlyPointForecast(values, horizon, selected.model)!;
	const residuals = [...selected.residuals].sort((a, b) => a - b);
	let empiricalRange: MonthlyForecast['empiricalRange'] = null;
	if (residuals.length >= 12) {
		const low = quantile(residuals, 0.1),
			high = quantile(residuals, 0.9);
		empiricalRange = {
			lower: Math.max(0, estimate + low),
			upper: Math.max(0, estimate + high),
			label:
				'Empirical historical range (10th–90th residual percentiles); not a certified probability interval',
			residualCount: residuals.length,
			historicalCoverage:
				selected.evaluationResiduals.filter((v) => v >= low && v <= high).length /
				selected.evaluationResiduals.length
		};
	}
	return {
		...result,
		status: 'exploratory',
		estimate,
		empiricalRange,
		model: selected.model,
		evaluation: selected.metrics,
		benchmarks: scores.map(({ model, metrics }) => ({
			model,
			metrics,
			estimate: monthlyPointForecast(values, horizon, model)
		})),
		backtest: points.slice(-6).map((point, i) => {
			const index = points.length - 6 + i;
			const count = index - horizon + 1;
			const prediction = monthlyPointForecast(values.slice(0, count), horizon, selected.model)!;
			return {
				trainingCutoff: points[count - 1].month,
				targetMonth: point.month,
				estimate: prediction,
				actual: point.value,
				error: point.value - prediction
			};
		}),
		projections: Array.from({ length: horizon }, (_, i) => ({
			month: indexMonth(last + i + 1),
			estimate: monthlyPointForecast(values, i + 1, selected.model)!
		})),
		unavailableReason: null
	};
}
