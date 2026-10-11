import type { MonthlyForecast } from '#lib/prediction/index.ts';

type ChartSeries = Pick<
	MonthlyForecast,
	'history' | 'projections' | 'lastActualMonth' | 'forecastMonth' | 'empiricalRange'
>;

const monthOrdinal = (month: string) => {
	const [year, number] = month.split('-').map(Number);
	return year * 12 + number - 1;
};
const calendarMonth = (ordinal: number) =>
	`${Math.floor(ordinal / 12)}-${String((ordinal % 12) + 1).padStart(2, '0')}`;

/** Calendar spacing keeps missing months visible instead of compressing the evidence gap. */
export function buildForecastChart(
	item: ChartSeries | null,
	measuredWidth = 740,
	historyMonths: number | null = 18
) {
	if (!item) return null;
	const width =
		Number.isFinite(measuredWidth) && measuredWidth > 0 ? Math.max(240, measuredWidth) : 740;
	const bounds = { left: 62, right: width - (width < 420 ? 14 : 32), top: 30, bottom: 214 };
	const history =
		historyMonths != null && Number.isInteger(historyMonths) && historyMonths > 0
			? item.history.slice(-historyMonths)
			: item.history;
	const actual = history.map((point) => ({
		...point,
		kind: 'Recorded' as const
	}));
	const projected = item.projections.map((point) => ({
		month: point.month,
		value: point.estimate,
		kind: 'Estimate' as const
	}));
	const points = [...actual, ...projected].sort((a, b) => a.month.localeCompare(b.month));
	if (points.length < 2) return null;
	const firstOrdinal = monthOrdinal(points[0].month);
	const lastOrdinal = monthOrdinal(points.at(-1)!.month);
	const span = Math.max(1, lastOrdinal - firstOrdinal);
	const maximum =
		Math.max(...points.map((point) => point.value), item.empiricalRange?.upper ?? 0) || 1;
	const step = 10 ** Math.floor(Math.log10(maximum)) / 2;
	const ymax = Math.ceil((maximum * 1.08) / step) * step;
	const x = (month: string) =>
		bounds.left + ((monthOrdinal(month) - firstOrdinal) / span) * (bounds.right - bounds.left);
	const y = (value: number) => bounds.bottom - (value / ymax) * (bounds.bottom - bounds.top);
	const line = (rows: Array<{ month: string; value: number }>) =>
		rows.map((point, index) => `${index ? 'L' : 'M'}${x(point.month)},${y(point.value)}`).join(' ');
	const lastActual = actual.at(-1);
	return {
		width,
		height: 270,
		bounds,
		actual: line(actual),
		forecast: line(lastActual ? [lastActual, ...projected] : projected),
		ticks: [
			...new Set(
				width < 420
					? [0, Math.round(span / 2), span]
					: [0, Math.round(span / 3), Math.round((span * 2) / 3), span]
			)
		].map((offset) => {
			const month = calendarMonth(firstOrdinal + offset);
			return { month, x: x(month) };
		}),
		points,
		ymax,
		x,
		y,
		lastActualX: x(item.lastActualMonth),
		targetX: x(item.forecastMonth)
	};
}

/** Both lines use the same calendar and zero baseline; connectors expose each actual miss. */
export function buildForecastAccuracyChart(rows: MonthlyForecast['backtest'], measuredWidth = 740) {
	if (!rows.length) return null;
	const width =
		Number.isFinite(measuredWidth) && measuredWidth > 0 ? Math.max(240, measuredWidth) : 740;
	const bounds = { left: 62, right: width - 20, top: 26, bottom: 190 };
	const points = [...rows].sort((a, b) => a.targetMonth.localeCompare(b.targetMonth));
	const firstOrdinal = monthOrdinal(points[0].targetMonth);
	const lastOrdinal = monthOrdinal(points.at(-1)!.targetMonth);
	const span = Math.max(1, lastOrdinal - firstOrdinal);
	const maximum = Math.max(...points.flatMap((row) => [row.actual, row.estimate])) || 1;
	const step = 10 ** Math.floor(Math.log10(maximum)) / 2;
	const ymax = Math.ceil((maximum * 1.08) / step) * step;
	const x = (month: string) =>
		points.length === 1
			? (bounds.left + bounds.right) / 2
			: bounds.left + ((monthOrdinal(month) - firstOrdinal) / span) * (bounds.right - bounds.left);
	const y = (value: number) => bounds.bottom - (value / ymax) * (bounds.bottom - bounds.top);
	const line = (field: 'actual' | 'estimate') =>
		points
			.map((point, index) => `${index ? 'L' : 'M'}${x(point.targetMonth)},${y(point[field])}`)
			.join(' ');
	const tickIndexes =
		width < 420
			? [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])]
			: points.map((_, index) => index);
	return {
		width,
		height: 238,
		bounds,
		points,
		actual: line('actual'),
		estimate: line('estimate'),
		ticks: tickIndexes.map((index) => ({
			month: points[index].targetMonth,
			x: x(points[index].targetMonth)
		})),
		ymax,
		x,
		y
	};
}
