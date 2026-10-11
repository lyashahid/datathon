import { describe, expect, it } from 'vitest';
import type { MultiPolygon } from 'polygon-clipping';
import { precisionCoordinates, precisionIntersection } from './precisionClipping.ts';

describe('numerically stable display clipping', () => {
	it('normalizes the near-coincident Hulhumalé ring seam without mutating source coordinates', () => {
		const lon = 73.54188115877116,
			lat = 4.238988615784965;
		const land: MultiPolygon = [
			[
				[
					[lon, lat],
					[lon + 0.0005, lat],
					[lon + 0.0005, lat + 0.0005],
					[lon, lat + 0.0005],
					[lon, lat + 0.000000000000005],
					[lon, lat]
				]
			]
		];
		const original = JSON.stringify(land);
		const normalized = precisionCoordinates(land);
		expect(normalized[0][0]).toHaveLength(5);
		expect(normalized[0][0][0]).toEqual(normalized[0][0][4]);
		expect(JSON.stringify(land)).toBe(original);
		expect(precisionCoordinates(land)).toBe(normalized);
		const cell: MultiPolygon = [
			[
				[
					[lon - 0.0001, lat - 0.0001],
					[lon + 0.0002, lat - 0.0001],
					[lon + 0.0002, lat + 0.0002],
					[lon - 0.0001, lat + 0.0002],
					[lon - 0.0001, lat - 0.0001]
				]
			]
		];
		const clipped = precisionIntersection(cell, land);
		expect(clipped).toHaveLength(1);
		for (const point of clipped[0][0]) {
			expect(point[0]).toBeGreaterThanOrEqual(Math.round(lon * 1e9) / 1e9);
			expect(point[1]).toBeGreaterThanOrEqual(Math.round(lat * 1e9) / 1e9);
		}
	});
	it('drops collapsed rings while preserving an explicit water hole', () => {
		const land: MultiPolygon = [
			[
				[
					[0, 0],
					[1, 0],
					[1, 1],
					[0, 1],
					[0, 0]
				],
				[
					[0.2, 0.2],
					[0.8, 0.2],
					[0.8, 0.8],
					[0.2, 0.8],
					[0.2, 0.2]
				],
				[
					[0.5, 0.5],
					[0.5 + 1e-12, 0.5],
					[0.5, 0.5 + 1e-12],
					[0.5, 0.5]
				]
			]
		];
		expect(precisionCoordinates(land)[0]).toHaveLength(2);
		const cell: MultiPolygon = [
			[
				[
					[0.4, 0.4],
					[0.6, 0.4],
					[0.6, 0.6],
					[0.4, 0.6],
					[0.4, 0.4]
				]
			]
		];
		expect(precisionIntersection(cell, land)).toEqual([]);
	});
});
