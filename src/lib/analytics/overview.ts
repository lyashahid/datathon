import type { AnalyticalDataset, AnalyticalRow } from './catalog.ts';

/** Compare published island counts over time, without treating projections as observations. */
export function populationComparison(datasets: AnalyticalDataset[]): AnalyticalDataset | null {
	const population = [2022, 2026, 2030].flatMap((year) => {
		const dataset = datasets.find((item) => item.id === `population-greater-male-${year}`);
		return dataset ? [dataset] : [];
	});
	if (population.length < 2) return null;
	const first = population[0];
	if (
		population.some(
			(item) =>
				item.unit !== first.unit ||
				item.join.domain !== first.join.domain ||
				item.join.grain !== 'island'
		)
	)
		return null;
	const keys = [...new Set(population.flatMap((item) => item.rows.map((row) => row.key)))];
	const rows: AnalyticalRow[] = population.flatMap((item) =>
		keys.map((key) => {
			const row = item.rows.find((candidate) => candidate.key === key);
			const label = population
				.flatMap((dataset) => dataset.rows)
				.find((candidate) => candidate.key === key)!.label;
			return {
				...(row ?? {
					key,
					label,
					value: null,
					sourceIds: [],
					detail: 'No published value supplied for this island and year.'
				}),
				period: item.join.period ?? undefined,
				evidence: item.evidence,
				series: `${item.join.period} ${item.evidence === 'observed' ? 'census' : 'projection'}`
			};
		})
	);
	return {
		...first,
		id: 'overview-population-change',
		title: 'Greater Malé population: census and projections',
		description:
			'Compare the 2022 census with official 2026 and 2030 projections for the same physical islands.',
		evidence: 'mixed',
		rows,
		sources: [
			...new Map(
				population.flatMap((item) => item.sources).map((source) => [source.id, source])
			).values()
		],
		sourceTitle: 'MBS census and island population projections',
		sourceNote:
			'2022 is a published census. 2026 and 2030 are projections, not counted residents. Missing island projections remain blank; population does not measure passenger demand.',
		limitations: [...new Set(population.flatMap((item) => item.limitations))],
		join: { ...first.join, period: null },
		defaultChart: 'bar'
	};
}

/** A year-over-year change requires both exact calendar months, never a nearest-row match. */
export function latestMonthlyComparison(dataset: AnalyticalDataset | undefined) {
	if (!dataset || dataset.join.grain !== 'month') return null;
	const rows = dataset.rows.filter(
		(row) =>
			/^\d{4}-(0[1-9]|1[0-2])$/.test(row.key) && row.value !== null && Number.isFinite(row.value)
	);
	if (new Set(rows.map((row) => row.series ?? dataset.title)).size !== 1) return null;
	const latest = rows.toSorted((a, b) => a.key.localeCompare(b.key)).at(-1);
	if (!latest) return null;
	const previousKey = `${Number(latest.key.slice(0, 4)) - 1}${latest.key.slice(4)}`;
	const previous = rows.find((row) => row.key === previousKey);
	return {
		latest,
		previous: previous ?? null,
		percentChange:
			previous?.value && previous.value > 0
				? ((latest.value! - previous.value) / previous.value) * 100
				: null
	};
}

export function referencePeriod(dataset: AnalyticalDataset): string {
	if (dataset.join.period) return displayPeriod(dataset.join.period);
	const periods = [
		...new Set(dataset.rows.flatMap((row) => (row.period ? [row.period] : [])))
	].sort();
	if (!periods.length) return 'Dates retained with records';
	return periods.length === 1
		? displayPeriod(periods[0])
		: `${displayPeriod(periods[0])} – ${displayPeriod(periods.at(-1)!)}`;
}

export function displayPeriod(value: string): string {
	if (/^\d{4}-\d{2}$/.test(value))
		return new Date(`${value}-01T00:00:00Z`).toLocaleDateString('en-GB', {
			month: 'short',
			year: 'numeric',
			timeZone: 'UTC'
		});
	if (/^\d{4}-\d{2}-\d{2}$/.test(value))
		return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', {
			dateStyle: 'medium',
			timeZone: 'UTC'
		});
	return value;
}
