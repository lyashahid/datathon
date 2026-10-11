import { combineDatasets, type AnalyticalDataset } from './catalog.ts';

export interface StoryStarter {
	id: string;
	question: string;
	note: string;
	primaryId: string;
	comparisonId: string;
	mode: 'values' | 'indexed';
}

const starters: StoryStarter[] = [
	{
		id: 'airport-passengers',
		question: 'Do airport arrivals and departures move together?',
		note: 'International passenger movements · Velana · 2025',
		primaryId: 'aviation-caa-11-13-international-passenger-arrivals',
		comparisonId: 'aviation-caa-11-13-international-passenger-departures',
		mode: 'values'
	},
	{
		id: 'airport-activity',
		question: 'Do aircraft and passenger activity change similarly?',
		note: 'Different units, indexed to the same starting month · 2025',
		primaryId: 'aviation-caa-11-13-international-passenger-arrivals',
		comparisonId: 'aviation-caa-11-18-international-aircraft-movements',
		mode: 'indexed'
	},
	{
		id: 'household-spending',
		question: 'How do average and typical household spending differ?',
		note: 'Mean and median expenditure · 2019 household survey',
		primaryId: 'policy-average-monthly-household-expenditure',
		comparisonId: 'policy-median-monthly-household-expenditure',
		mode: 'values'
	}
];

/** Offer a starter only if the current, retained catalogue can produce a valid comparison. */
export function availableStoryStarters(datasets: AnalyticalDataset[]): StoryStarter[] {
	return starters.filter((starter) => {
		const primary = datasets.find((item) => item.id === starter.primaryId);
		const comparison = datasets.find((item) => item.id === starter.comparisonId);
		return (
			!!primary &&
			!!comparison &&
			combineDatasets([primary, comparison], { mode: starter.mode, alignment: 'common' }).ok
		);
	});
}
