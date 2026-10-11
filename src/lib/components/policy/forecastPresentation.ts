import type { MonthlyForecast } from '#lib/prediction/index.ts';

/** Stable source order avoids choosing the headline using the later evaluation results. */
export function headlineForecast(items: readonly MonthlyForecast[]): MonthlyForecast | null {
	const available = items.filter((item) => item.status === 'exploratory' && item.estimate != null);
	return available[0] ?? null;
}

export function forecastCaution(item: MonthlyForecast): string | null {
	const persistence = item.benchmarks.find((benchmark) => benchmark.model === 'last-month');
	return item.evaluation && persistence && item.evaluation.mae > persistence.metrics.mae
		? `The latest-month benchmark missed by ${Math.round(persistence.metrics.mae).toLocaleString('en-GB')} movements on average, versus ${Math.round(item.evaluation.mae).toLocaleString('en-GB')} for the selected method. The selected method lost this comparison; do not treat it as an established improvement.`
		: null;
}
