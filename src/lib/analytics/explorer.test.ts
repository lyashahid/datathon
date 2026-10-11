import { describe, expect, it } from 'vitest';
import type { AnalyticalDataset } from './catalog.ts';
import {
	datasetCompleteness,
	datasetDimensions,
	emptyDatasetLens,
	focusDataset,
	inspectRows
} from './explorer.ts';

const dataset: AnalyticalDataset = {
	id: 'published-monthly',
	title: 'Passenger movements',
	description: 'Retained monthly observations',
	topic: 'passengers',
	evidence: 'observed',
	unit: 'movements',
	sourceTitle: 'Official publication',
	sourceUrl: 'https://example.org/source',
	sourceNote: 'Movements are not unique people.',
	sources: [{ id: 'receipt', title: 'Publication', url: 'https://example.org/source' }],
	rows: [
		{
			key: '2025-01',
			label: 'January',
			value: 40,
			series: 'Arrivals',
			geography: 'Malé',
			sourceIds: ['receipt']
		},
		{
			key: '2025-02',
			label: 'February',
			value: null,
			series: 'Arrivals',
			geography: 'Malé',
			sourceIds: []
		},
		{
			key: '2025-03',
			label: 'March',
			value: 30,
			series: 'Arrivals',
			geography: 'Malé',
			sourceIds: ['receipt']
		},
		{
			key: '2025-01',
			label: 'January',
			value: 35,
			series: 'Departures',
			geography: 'Malé',
			sourceIds: ['receipt']
		},
		{
			key: '2025-03',
			label: 'March',
			value: 0,
			series: 'Arrivals',
			geography: 'Addu',
			sourceIds: ['receipt']
		}
	],
	defaultChart: 'line',
	xLabel: 'Month',
	yLabel: 'Movements',
	join: { grain: 'month', domain: 'airports', period: null },
	limitations: []
};

describe('dataset exploration lens', () => {
	it('retains missing observations, provenance and the original rows when filtering a date window', () => {
		const focused = focusDataset(dataset, {
			...emptyDatasetLens(),
			series: 'Arrivals',
			geography: 'Malé',
			periodStart: '2025-02',
			periodEnd: '2025-03'
		});
		expect(focused.rows.map((row) => row.value)).toEqual([null, 30]);
		expect(focused.rows[1].sourceIds).toEqual(['receipt']);
		expect(focused.sources).toBe(dataset.sources);
		expect(dataset.rows).toHaveLength(5);
		expect(datasetCompleteness(focused)).toEqual({ available: 1, missing: 1, total: 2 });
	});
	it('does not apply temporal key filters to categorical data', () => {
		const categorical = { ...dataset, join: { ...dataset.join, grain: 'island' as const } };
		expect(
			focusDataset(categorical, { ...emptyDatasetLens(), periodStart: '2099' }).rows
		).toHaveLength(5);
		expect(datasetDimensions(categorical).periods).toEqual([]);
	});
	it('sorts numeric values without turning missing observations into zero', () => {
		expect(inspectRows(dataset.rows, '', 'lowest').map((row) => row.value)).toEqual([
			0,
			30,
			35,
			40,
			null
		]);
		expect(inspectRows(dataset.rows, '', 'highest').map((row) => row.value)).toEqual([
			40,
			35,
			30,
			0,
			null
		]);
		expect(dataset.rows[0].value).toBe(40);
	});
	it('searches readable location names while preserving source order', () => {
		expect(inspectRows(dataset.rows, 'male', 'source')).toHaveLength(4);
		expect(inspectRows(dataset.rows, 'not in source', 'source')).toEqual([]);
		expect(datasetDimensions(dataset)).toEqual({
			series: ['Arrivals', 'Departures'],
			geographies: ['Addu', 'Malé'],
			periods: ['2025-01', '2025-02', '2025-03']
		});
	});
	it('leaves invalid date windows empty instead of silently restoring unfiltered data', () => {
		expect(
			focusDataset(dataset, { ...emptyDatasetLens(), periodStart: '2025-03', periodEnd: '2025-01' })
				.rows
		).toEqual([]);
	});
});
