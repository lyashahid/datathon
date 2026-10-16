import { describe, expect, it } from 'vitest';
import { nearestPlacementRoad, placementLocationHint } from './map-placement-preview.js';

describe('bus stop placement snapping', () => {
	const road = [
		{
			geometry: [
				[73.5, 4.2],
				[73.502, 4.2]
			]
		}
	];
	it('snaps nearby points to the closest position on the road, not an endpoint', () => {
		const result = nearestPlacementRoad([73.501, 4.2002], road);
		expect(result.snapped).toBe(true);
		expect(result.coordinates[0]).toBeCloseTo(73.501, 8);
		expect(result.coordinates[1]).toBe(4.2);
		expect(result.distance).toBeCloseTo(22.264, 2);
	});
	it('keeps a distant selected position instead of silently moving it', () => {
		const point: [number, number] = [73.501, 4.201];
		const result = nearestPlacementRoad(point, road);
		expect(result.snapped).toBe(false);
		expect(result.coordinates).toBe(point);
		expect(result.distance).toBeGreaterThan(100);
	});
	it('selects the nearest of multiple segments and respects the threshold', () => {
		const point: [number, number] = [73.501, 4.2002];
		const result = nearestPlacementRoad(point, [
			...road,
			{
				geometry: [
					[73.5, 4.2001],
					[73.502, 4.2001]
				]
			}
		]);
		expect(result.coordinates[1]).toBe(4.2001);
		expect(nearestPlacementRoad(point, road, 10).snapped).toBe(false);
	});
	it('handles empty, invalid and zero-length source geometries without inventing a snap', () => {
		const point: [number, number] = [73.501, 4.2002];
		expect(nearestPlacementRoad(point, []).distance).toBeNull();
		expect(
			nearestPlacementRoad(point, [
				{
					geometry: [
						[NaN, 4],
						[73, 4]
					]
				}
			]).snapped
		).toBe(false);
		expect(
			nearestPlacementRoad(point, [
				{
					geometry: [
						[73.501, 4.2],
						[73.501, 4.2]
					]
				}
			]).snapped
		).toBe(true);
		expect(nearestPlacementRoad([181, 4], road).distance).toBeNull();
		expect(nearestPlacementRoad(point, road, -1).snapped).toBe(false);
	});
});

describe('placement advice', () => {
	const location = {
		kind: 'add_stop',
		suitable: true,
		snapped: false,
		distance: 56,
		hasRoads: true
	};
	it('prioritizes an invalid island over a nearby road', () => {
		expect(placementLocationHint({ ...location, suitable: false, snapped: true }).title).toContain(
			'selected island'
		);
	});
	it('explains snapped distance without approving construction', () => {
		const hint = placementLocationHint({ ...location, snapped: true, distance: 12.6 });
		expect(hint.detail).toContain('13 m');
		expect(hint.detail).toContain('suggested stop connection');
		expect(hint.caution).toBe(false);
	});
	it('distinguishes missing road evidence from a distant road', () => {
		expect(placementLocationHint(location).detail).toContain('35 m');
		expect(placementLocationHint({ ...location, hasRoads: false }).title).toContain(
			'not available'
		);
		expect(placementLocationHint({ ...location, kind: 'add_school', suitable: null }).caution).toBe(
			true
		);
	});
});
