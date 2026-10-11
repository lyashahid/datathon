import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAnalyticalCatalog, type AnalyticalDataset } from './catalog.ts';
import type { PlanningBaseline } from '#lib/planning/types.ts';
import { latestMonthlyComparison, populationComparison } from './overview.ts';

const planning = JSON.parse(
	readFileSync('data/public/planning-baseline.json', 'utf8')
) as PlanningBaseline;
const catalog = createAnalyticalCatalog({ planning });

describe('population overview', () => {
	it('preserves all published values, census/projection status, and missing island projections', () => {
		const result = populationComparison(catalog)!;
		expect(result.evidence).toBe('mixed');
		expect(result.rows).toHaveLength(12);
		for (const year of ['2022', '2026', '2030']) {
			const source = catalog.find((item) => item.id === `population-greater-male-${year}`)!;
			for (const row of source.rows) {
				const displayed = result.rows.find((item) => item.key === row.key && item.period === year)!;
				expect(displayed.value).toBe(row.value);
				expect(displayed.sourceIds).toEqual(row.sourceIds);
				expect(displayed.evidence).toBe(source.evidence);
			}
		}
		expect(result.rows.find((row) => row.key === 'hulhule' && row.period === '2022')?.value).toBe(
			802
		);
		expect(
			result.rows
				.filter((row) => row.key === 'hulhule' && row.period !== '2022')
				.map((row) => row.value)
		).toEqual([null, null]);
	});
	it('does not compare different geographic definitions or invent a chart without two periods', () => {
		expect(populationComparison(catalog.filter((item) => item.id.endsWith('2022')))).toBeNull();
		expect(
			populationComparison(
				catalog.map((item) =>
					item.id === 'population-greater-male-2026'
						? { ...item, join: { ...item.join, domain: 'other-islands' } }
						: item
				)
			)
		).toBeNull();
	});
});

const monthly = (points: [string, number | null][]): AnalyticalDataset => ({
	...catalog[0],
	id: 'monthly',
	title: 'Monthly passengers',
	join: { grain: 'month', domain: 'one-category', period: null },
	rows: points.map(([key, value]) => ({ key, label: key, value, sourceIds: [] }))
});
describe('monthly comparison', () => {
	it('compares the same calendar month a year earlier and keeps the latest valid observation', () => {
		const result = latestMonthlyComparison(
			monthly([
				['2025-06', 200],
				['2026-05', 500],
				['2026-06', 250],
				['2026-07', null]
			])
		)!;
		expect(result.latest.key).toBe('2026-06');
		expect(result.previous?.key).toBe('2025-06');
		expect(result.percentChange).toBe(25);
	});
	it('does not substitute another month or divide by a zero baseline', () => {
		expect(
			latestMonthlyComparison(
				monthly([
					['2025-05', 100],
					['2026-06', 250]
				])
			)?.percentChange
		).toBeNull();
		expect(
			latestMonthlyComparison(
				monthly([
					['2025-06', 0],
					['2026-06', 250]
				])
			)?.percentChange
		).toBeNull();
	});
	it('refuses to treat multiple categories as one aggregate', () => {
		const input = monthly([
			['2026-05', 100],
			['2026-06', 250]
		]);
		input.rows[0].series = 'Arrivals';
		input.rows[1].series = 'Departures';
		expect(latestMonthlyComparison(input)).toBeNull();
	});
});
