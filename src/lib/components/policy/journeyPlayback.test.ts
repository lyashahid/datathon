import { describe, expect, it } from 'vitest';
import { selectedJourneyPlayback } from './journeyPlayback.ts';
import type {
	PlanningAnalysis,
	PlanningAssumptions,
	PlanningJourney,
	PlanningServicePattern
} from '#lib/planning/types.ts';

const pattern: PlanningServicePattern = {
	id: 'test-service',
	routeId: 'test-route',
	name: 'Test direction',
	mode: 'bus',
	stopIds: ['a', 'b', 'c'],
	calendar: { weekdays: [0, 1, 2, 3, 4, 5, 6] },
	provenance: 'observed',
	sourceIds: [],
	timing: {
		kind: 'frequency',
		windows: [{ startMinutes: 480, endMinutes: 600, headwayMinutes: 5 }],
		segmentMinutes: [10, 10]
	},
	segmentGeometry: [
		[
			[0, 0],
			[0.01, 0]
		],
		[
			[0.01, 0],
			[0.02, 0]
		]
	]
};
const assumptions = { departureMinutes: 480, date: '2026-10-10' } as PlanningAssumptions;
const journey: PlanningJourney = {
	status: 'reachable',
	minutes: 25,
	reason: null,
	destinationId: 'healthcare',
	path: [
		{ mode: 'bus', from: 'a', to: 'a', minutes: 0, waitMinutes: 5, patternId: pattern.id },
		{ mode: 'bus', from: 'a', to: 'c', minutes: 20, waitMinutes: 0, patternId: pattern.id }
	]
};
const world = (selected: PlanningServicePattern) =>
	({
		world: {
			patterns: [selected],
			stops: [
				{ id: 'a', name: 'A', islandId: 'test', sourceIds: [], lon: 0, lat: 0 },
				{ id: 'b', name: 'B', islandId: 'test', sourceIds: [], lon: 0.01, lat: 0 },
				{ id: 'c', name: 'C', islandId: 'test', sourceIds: [], lon: 0.02, lat: 0 }
			],
			facilities: []
		}
	}) as Pick<PlanningAnalysis, 'world'>;

describe('selected journey timetable illustration', () => {
	it('holds one frequency-derived departure instead of jumping to a later vehicle', () => {
		const selected = selectedJourneyPlayback(journey, world(pattern), assumptions, '2026-10-10');
		expect(selected?.start).toBe(485);
		expect(selected?.end).toBe(505);
		expect(selected?.frame(490).features.features[0].geometry.coordinates[0]).toBeCloseTo(0.005);
		expect(selected?.frame(496).features.features[0].geometry.coordinates[0]).toBeCloseTo(0.011);
		expect(selected?.frame(506).features.features).toHaveLength(0);
	});
	it('does not invent a moving path when directed route geometry is absent', () => {
		const selected = selectedJourneyPlayback(
			journey,
			world({ ...pattern, segmentGeometry: undefined }),
			assumptions,
			'2026-10-10'
		);
		expect(selected?.frame(490).status).toBe('unavailable');
		expect(selected?.frame(490).features.features).toHaveLength(0);
	});
});
