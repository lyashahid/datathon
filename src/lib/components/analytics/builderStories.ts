export type BuilderChartType = 'line' | 'bar' | 'scatter' | 'heatmap';

export type SavedDataStory = {
	id: string;
	title: string;
	observation: string;
	primaryId: string;
	comparisonId: string;
	mode: 'values' | 'indexed';
	alignment: 'union' | 'common';
	chartType: BuilderChartType;
	updatedAt: string;
};

export const DATA_STORY_STORAGE_KEY = 'mobility-data-stories-v1';
export const MAX_SAVED_DATA_STORIES = 24;

export function readDataStories(raw: string | null): {
	stories: SavedDataStory[];
	error: string | null;
} {
	if (!raw) return { stories: [], error: null };
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!parsed || typeof parsed !== 'object') throw new Error('Invalid story file');
		const value = parsed as Record<string, unknown>;
		if (value.version !== 1 || !Array.isArray(value.stories)) {
			return {
				stories: [],
				error: 'Saved stories use an unsupported format. Your browser copy has been kept.'
			};
		}
		if (value.stories.length > MAX_SAVED_DATA_STORIES) throw new Error('Too many saved stories');
		const stories = value.stories.filter(isSavedDataStory);
		const uniqueStories = stories.filter(
			(story, index) => stories.findIndex((candidate) => candidate.id === story.id) === index
		);
		return {
			stories: uniqueStories,
			error:
				uniqueStories.length !== value.stories.length
					? 'Some saved stories could not be read. Valid stories are available; the browser copy has been kept.'
					: null
		};
	} catch {
		return {
			stories: [],
			error: 'Saved stories could not be read. Your browser copy has been kept.'
		};
	}
}

function isSavedDataStory(value: unknown): value is SavedDataStory {
	if (!value || typeof value !== 'object') return false;
	const story = value as Record<string, unknown>;
	const boundedString = (field: string, min: number, max: number) =>
		typeof story[field] === 'string' &&
		(story[field] as string).length >= min &&
		(story[field] as string).length <= max;
	return (
		boundedString('id', 1, 100) &&
		boundedString('title', 1, 120) &&
		boundedString('observation', 0, 1200) &&
		boundedString('primaryId', 1, 160) &&
		boundedString('comparisonId', 0, 160) &&
		['values', 'indexed'].includes(String(story.mode)) &&
		['union', 'common'].includes(String(story.alignment)) &&
		['line', 'bar', 'scatter', 'heatmap'].includes(String(story.chartType)) &&
		boundedString('updatedAt', 1, 40) &&
		Number.isFinite(Date.parse(story.updatedAt as string))
	);
}

export function serializeDataStories(stories: SavedDataStory[]): string {
	return JSON.stringify({ version: 1, stories: stories.slice(0, MAX_SAVED_DATA_STORIES) });
}

/** Protect text cells from spreadsheet formulas while retaining numeric values and missingness. */
export function dataStoryCsvCell(value: string | number | null | undefined): string {
	if (value === null || value === undefined) return '';
	const raw = String(value);
	const safe = typeof value === 'string' && /^[\s]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
	return `"${safe.replace(/"/g, '""')}"`;
}
