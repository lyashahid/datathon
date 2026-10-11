import { describe, expect, it } from 'vitest';
import {
	dataStoryCsvCell,
	readDataStories,
	serializeDataStories,
	type SavedDataStory
} from './builderStories.ts';

const story: SavedDataStory = {
	id: 'story-1',
	title: 'Monthly passenger pattern',
	observation: 'Arrivals and departures have different seasonal patterns.',
	primaryId: 'monthly-arrivals',
	comparisonId: 'monthly-departures',
	mode: 'values',
	alignment: 'common',
	chartType: 'line',
	updatedAt: '2026-10-11T10:00:00.000Z'
};

describe('saved data story validation', () => {
	it('round-trips a bounded, versioned story without changing its analytical settings', () => {
		expect(readDataStories(serializeDataStories([story]))).toEqual({
			stories: [story],
			error: null
		});
	});

	it('rejects unsupported formats instead of pretending that saved stories are empty', () => {
		expect(readDataStories(JSON.stringify({ version: 2, stories: [story] })).error).toContain(
			'unsupported'
		);
		expect(readDataStories('broken').error).toContain('kept');
	});

	it('recovers valid stories while reporting corrupt entries and duplicate identifiers', () => {
		const result = readDataStories(
			JSON.stringify({
				version: 1,
				stories: [story, { ...story, chartType: 'pie' }, story]
			})
		);
		expect(result.stories).toEqual([story]);
		expect(result.error).toContain('Some saved stories');
	});
});

describe('data story CSV values', () => {
	it('preserves zero, missing values and quotes while protecting spreadsheet formula text', () => {
		expect(dataStoryCsvCell(0)).toBe('"0"');
		expect(dataStoryCsvCell(null)).toBe('');
		expect(dataStoryCsvCell('A "source"')).toBe('"A ""source"""');
		expect(dataStoryCsvCell(' =SUM(A1)')).toBe('"\' =SUM(A1)"');
		expect(dataStoryCsvCell(-10)).toBe('"-10"');
	});
});
