import { describe, expect, it } from 'vitest';
import {
	searchDirectionsFeatures,
	searchDirectionsRequest,
	type SearchDirectionPoint,
	type SearchDirectionsResult,
	type SearchDirectionsSegment
} from './search-directions.js';
import type { ExploreJourney, JourneyLeg } from './explore-journey.js';

describe('ordered search directions', () => {
	const points: SearchDirectionPoint[] = [
		{ id: 'a', name: 'A', coordinates: [73, 3] },
		{ id: 'b', name: 'B', coordinates: [73.001, 3] },
		{ id: 'c', name: 'C', coordinates: [73.002, 3] }
	];
	it('requires every intermediate stop and preserves its order', () => {
		expect(searchDirectionsRequest(points, 'transit', '2026-10-10', 920)).toEqual({
			points: points.map((point) => point.coordinates),
			mode: 'transit',
			service_date: '2026-10-10',
			departure_minutes: 920
		});
		expect(
			searchDirectionsRequest(
				[points[0], { ...points[1], coordinates: null }, points[2]],
				'walk',
				'2026-10-10',
				920
			)
		).toBeNull();
	});
	it('rejects invalid clocks, coordinate values and oversized itineraries', () => {
		for (const departure of [-1, 1440, NaN, Infinity]) {
			expect(searchDirectionsRequest(points, 'transit', '2026-10-10', departure)).toBeNull();
		}
		expect(
			searchDirectionsRequest(
				[{ ...points[0], coordinates: [181, 3] }, points[1]],
				'car',
				'2026-10-10',
				920
			)
		).toBeNull();
		expect(
			searchDirectionsRequest(Array(11).fill(points[0]), 'walk', '2026-10-10', 920)
		).toBeNull();
	});
	it('ignores hidden date and clock values for road modes', () => {
		for (const mode of ['walk', 'bicycle', 'car'] as const) {
			expect(searchDirectionsRequest(points, mode, '', NaN)).toEqual({
				points: points.map((point) => point.coordinates),
				mode,
				departure_minutes: 0
			});
		}
	});
	it('requires a real calendar date for dated transit', () => {
		for (const date of ['', '2026-02-30', '2026-13-10', '0000-01-01', '10/10/2026']) {
			expect(searchDirectionsRequest(points, 'transit', date, 920)).toBeNull();
		}
		expect(searchDirectionsRequest(points, 'transit', '2028-02-29', 920)?.service_date).toBe(
			'2028-02-29'
		);
	});
	it('preserves a failed mandatory segment and a missing bus shape as separate gaps', () => {
		const firstShape = [
			[73, 3],
			[73.001, 3]
		];
		const finalShape = [
			[73.1, 3],
			[73.101, 3]
		];
		const segments = [
			{ index: 0, status: 'ok', result: { geometry: firstShape } },
			{
				index: 1,
				status: 'unreachable',
				result: {
					geometry: [
						[73.001, 3],
						[73.1, 3]
					]
				}
			},
			{
				index: 2,
				status: 'ok',
				result: {
					journey: {
						legs: [
							{ mode: 'bus', geometry: [] },
							{ mode: 'walk', geometry: finalShape }
						] as JourneyLeg[]
					} as ExploreJourney
				}
			}
		] as SearchDirectionsSegment[];
		const features = searchDirectionsFeatures({
			mode: 'walk',
			segments
		} as SearchDirectionsResult).features;
		expect(features).toHaveLength(2);
		expect(features.map((feature) => feature.properties?.segment_index)).toEqual([0, 2]);
		expect(features.map((feature) => feature.geometry)).toEqual([
			{ type: 'LineString', coordinates: firstShape },
			{ type: 'LineString', coordinates: finalShape }
		]);
		expect(searchDirectionsFeatures(null).features).toEqual([]);
	});
});
