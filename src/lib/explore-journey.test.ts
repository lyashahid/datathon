import { describe, expect, it } from 'vitest';
import {
	exploreJourneyFeatures,
	journeyClock,
	type ExploreJourney,
	type JourneyLeg
} from './explore-journey.js';

describe('dated Explore journey presentation', () => {
	it('keeps a midnight rollover visible', () => {
		expect(journeyClock(1485)).toBe('00:45 (+1 day)');
		expect(journeyClock(920)).toBe('15:20');
		expect(journeyClock(null)).toBe('Unavailable');
	});
	it('renders individual known paths without bridging a missing service shape', () => {
		const legs = [
			{
				mode: 'walk',
				geometry: [
					[73.5, 4.17],
					[73.501, 4.17]
				]
			},
			{ mode: 'bus', geometry: [], route_name: 'R1' },
			{ mode: 'wait', geometry: [] },
			{
				mode: 'walk',
				geometry: [
					[73.54, 4.2],
					[73.541, 4.2]
				]
			}
		] as JourneyLeg[];
		const result = exploreJourneyFeatures({ legs } as ExploreJourney);
		expect(result.features).toHaveLength(2);
		expect(result.features.map((feature) => feature.properties?.index)).toEqual([0, 3]);
		expect(result.features[0].geometry).toEqual({
			type: 'LineString',
			coordinates: legs[0].geometry
		});
		expect(exploreJourneyFeatures(null).features).toEqual([]);
	});
});
