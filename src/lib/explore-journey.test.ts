import { describe, expect, it } from 'vitest';
import {
	exploreJourneyFeatures,
	deduplicateJourneyPlaces,
	journeyClock,
	type ExploreJourney,
	type JourneyLeg,
	type JourneyPlace
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

describe('Directions place suggestions', () => {
	it('combines the Skate Park operator stop, rounded map platform and roadway stop position', () => {
		const places: JourneyPlace[] = [
			{
				id: 'map:platform',
				name: 'Skate Park',
				category: 'bus_stop',
				stopRole: 'platform',
				coordinates: [73.5417666, 4.2074208]
			},
			{
				id: 'map:position',
				name: 'Skate Park',
				category: 'public_transport',
				stopRole: 'stop_position',
				coordinates: [73.5418265, 4.207401]
			},
			{
				id: 'rtl:107',
				name: 'Skate Park',
				category: 'Bus stop',
				stopRole: 'platform',
				operatorStop: true,
				stopCode: '107',
				coordinates: [73.541765, 4.207421]
			}
		];
		expect(deduplicateJourneyPlaces(places).map((place) => place.id)).toEqual(['rtl:107']);
	});
	it('retains separate operator identities and opposite boarding platforms', () => {
		const platform: JourneyPlace = {
			id: 'map:east',
			name: 'Park',
			category: 'bus_stop',
			stopRole: 'platform',
			coordinates: [73.54, 4.2]
		};
		const places: JourneyPlace[] = [
			platform,
			{ ...platform, id: 'map:west', coordinates: [73.54008, 4.2] },
			{ ...platform, id: 'rtl:101', operatorStop: true, stopCode: '101' },
			{ ...platform, id: 'rtl:102', operatorStop: true, stopCode: '102' }
		];
		expect(deduplicateJourneyPlaces(places).map((place) => place.id)).toEqual([
			'rtl:101',
			'rtl:102',
			'map:west'
		]);
	});
	it('keeps different stop codes, directions, distant aliases and separately named places', () => {
		const platform: JourneyPlace = {
			id: 'platform',
			name: 'Park',
			stopRole: 'platform',
			stopCode: '101',
			direction: 'north',
			coordinates: [73.54, 4.2]
		};
		const position: JourneyPlace = {
			...platform,
			id: 'position',
			stopRole: 'stop_position',
			coordinates: [73.54006, 4.2]
		};
		for (const alternative of [
			{ ...position, stopCode: '102' },
			{ ...position, direction: 'south' },
			{ ...position, coordinates: [73.5403, 4.2] as [number, number] },
			{ ...position, name: 'Another Park' }
		])
			expect(deduplicateJourneyPlaces([platform, alternative])).toHaveLength(2);
	});
});
