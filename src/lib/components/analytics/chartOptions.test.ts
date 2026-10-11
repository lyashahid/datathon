import { describe, expect, it } from 'vitest';
import type { AnalyticalDataset } from '#lib/analytics/catalog.ts';
import { analyticalChartOptions, supportedChartTypes, pairedRows } from './chartOptions.ts';

const dataset = (rows: AnalyticalDataset['rows']): AnalyticalDataset => ({
	id: 'test',
	title: 'Checked monthly totals',
	description: 'Source-backed test',
	topic: 'passengers',
	evidence: 'observed',
	unit: 'people',
	sourceTitle: 'Official source',
	sourceUrl: 'https://example.org/data',
	sourceNote: 'Test',
	sources: [],
	rows,
	defaultChart: 'line',
	xLabel: 'Month',
	yLabel: 'People',
	join: { grain: 'month', domain: 'national', period: null },
	limitations: []
});
describe('analytical chart encodings', () => {
	it('places time points at calendar dates and preserves missing values', () => {
		const d = dataset([
			{ key: '2026-01', label: 'Jan 2026', value: 10, sourceIds: [] },
			{ key: '2026-02', label: 'Feb 2026', value: null, sourceIds: [] },
			{ key: '2026-04', label: 'Apr 2026', value: 20, sourceIds: [] }
		]);
		const option = analyticalChartOptions(d, 'line');
		const series = (
			option.series as Array<{ data: Array<[number, number | null]>; connectNulls: boolean }>
		)[0];
		expect(series.data[1][1]).toBeNull();
		expect(series.connectNulls).toBe(false);
		expect(series.data[2][0] - series.data[1][0]).toBe(59 * 86400000);
	});
	it('starts magnitude bars at zero and includes every category', () => {
		const d = dataset(
			Array.from({ length: 25 }, (_, i) => ({
				key: String(i),
				label: `Island ${i}`,
				value: i + 1,
				sourceIds: []
			}))
		);
		d.join.grain = 'island';
		const option = analyticalChartOptions(d, 'bar');
		expect((option.xAxis as { min: number }).min).toBe(0);
		expect((option.yAxis as { data: string[] }).data).toHaveLength(25);
		expect(option.dataZoom).toBeDefined();
		expect(supportedChartTypes(d)).toEqual(['bar']);
	});
	it('omits missing calendar cells instead of turning them into zero observations', () => {
		const d = dataset([
			{ key: '2026-01', label: 'Jan 2026', value: 0, sourceIds: [] },
			{ key: '2026-02', label: 'Feb 2026', value: null, sourceIds: [] }
		]);
		const option = analyticalChartOptions(d, 'heatmap');
		expect((option.series as Array<{ data: unknown[] }>)[0].data).toEqual([[0, 0, 0]]);
	});
	it('allows relationship plots only when two series have enough matched nonmissing points', () => {
		const rows: AnalyticalDataset['rows'] = ['2026-01', '2026-02', '2026-03'].flatMap((key, i) => [
			{ key, label: key, value: i + 1, series: 'A', sourceIds: [] },
			{ key, label: key, value: i + 10, series: 'B', sourceIds: [] }
		]);
		expect(pairedRows(dataset(rows))).toHaveLength(3);
		expect(supportedChartTypes(dataset(rows))).toContain('scatter');
		rows[1].value = null;
		expect(supportedChartTypes(dataset(rows))).not.toContain('scatter');
	});
	it('encodes scheduled departures as hour by route cells, retaining real zeros and missing cells', () => {
		const d = dataset([
			{ key: '00', label: '00:00', series: 'Route A', value: 0, sourceIds: [] },
			{ key: '01', label: '01:00', series: 'Route A', value: 2, sourceIds: [] },
			{ key: '00', label: '00:00', series: 'Route B', value: null, sourceIds: [] },
			{ key: '01', label: '01:00', series: 'Route B', value: 3, sourceIds: [] }
		]);
		d.join = { grain: 'category', domain: 'greater-male:service-hours', period: '2026-10-10' };
		expect(supportedChartTypes(d)).toContain('heatmap');
		const option = analyticalChartOptions(d, 'heatmap');
		expect((option.xAxis as { data: string[] }).data).toEqual(['00:00', '01:00']);
		expect((option.yAxis as { data: string[] }).data).toEqual(['Route A', 'Route B']);
		expect((option.series as Array<{ data: unknown[] }>)[0].data).toEqual([
			[0, 0, 0],
			[1, 0, 2],
			[1, 1, 3]
		]);
		expect((option.visualMap as { text: string[] }).text).toEqual(['3', '0']);
	});
});
