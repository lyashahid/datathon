import { describe, expect, it } from 'vitest';
import { datasetFilter, validStory, type Column, type Story } from './data-studio.js';

const columns: Column[] = [
	['name', 'string'],
	['count', 'number'],
	['available', 'boolean']
].map(([name, type]) => ({
	name,
	type,
	nullable: false,
	missing_count: 0,
	distinct_count: 3,
	examples: []
}));

describe('dataset filter types', () => {
	it('preserves distinct text, numeric and boolean equality values for strict backend matching', () => {
		expect(datasetFilter(columns, 'name', 'eq', '0').value).toBe('0');
		expect(datasetFilter(columns, 'count', 'eq', '0').value).toBe(0);
		expect(datasetFilter(columns, 'available', 'eq', ' TRUE ').value).toBe(true);
		expect(datasetFilter(columns, 'available', 'ne', 'false').value).toBe(false);
	});

	it('keeps contains filters textual even for boolean and numeric source columns', () => {
		expect(datasetFilter(columns, 'available', 'contains', 'true')).toEqual({
			column: 'available',
			op: 'contains',
			value: 'true'
		});
		expect(datasetFilter(columns, 'count', 'contains', '2').value).toBe('2');
	});

	it('rejects stale source columns and unsupported numeric comparisons before requesting data', () => {
		expect(() => datasetFilter(columns, 'old-source-field', 'eq', 'a')).toThrow('Choose a column');
		expect(() => datasetFilter(columns, 'name', 'gte', '20')).toThrow('numeric column');
		expect(() => datasetFilter(columns, 'available', 'lt', 'true')).toThrow('numeric column');
		for (const value of ['', ' ', 'Infinity', 'NaN', '12 people'])
			expect(() => datasetFilter(columns, 'count', 'gte', value)).toThrow('finite numeric');
		expect(() => datasetFilter(columns, 'available', 'eq', 'yes')).toThrow('true or false');
	});

	it('supports missing values and typed inclusion arrays without allowing nested query values', () => {
		expect(datasetFilter(columns, 'count', 'missing', 'ignored').value).toBe(true);
		expect(datasetFilter(columns, 'name', 'in', '["one", 2, true, null]').value).toEqual([
			'one',
			2,
			true,
			null
		]);
		for (const value of ['invalid', '{}', '[[1]]', '[{}]', '[1e500]'])
			expect(() => datasetFilter(columns, 'name', 'in', value)).toThrow();
	});
});

const definition = {
	group_by: 'month',
	series_by: null,
	measure: 'value',
	aggregation: 'sum',
	filters: [],
	q: null,
	sort: 'group',
	descending: false,
	limit: 200
};
const story: Story = {
	id: 'test-story',
	title: 'Passenger movements',
	insight: 'A saved comparison',
	updatedAt: '2026-10-16T00:00:00Z',
	version: 1,
	primaryId: 'passenger-monthly',
	comparisonId: '',
	primary: definition,
	comparison: { ...definition, group_by: '', measure: null, aggregation: 'count' },
	chartType: 'line',
	mode: 'indexed',
	alignment: 'common',
	keyDomain: 'calendar-month',
	receipts: []
};

describe('saved data story validation', () => {
	it('reopens supported definitions including correctly typed filters and optional comparison', () => {
		expect(validStory(story)).toBe(true);
		expect(
			validStory({
				...story,
				primary: {
					...definition,
					filters: [datasetFilter(columns, 'available', 'contains', 'true')]
				}
			})
		).toBe(true);
	});

	it('rejects corrupt comparator values, unsupported collections and malformed receipts', () => {
		for (const value of [true, '20', Number.NaN, {}])
			expect(
				validStory({
					...story,
					primary: { ...definition, filters: [{ column: 'count', op: 'gte', value }] }
				})
			).toBe(false);
		expect(validStory({ ...story, primaryId: '../other' })).toBe(false);
		expect(validStory({ ...story, comparisonId: 'other', comparison: story.comparison })).toBe(
			false
		);
		expect(validStory({ ...story, receipts: [null] })).toBe(false);
		expect(
			validStory({ ...story, receipts: [{ artifact: 'source.json', sha256: 'forged' }] })
		).toBe(false);
	});
});
