import { describe, expect, it } from 'vitest';
import type { MapFeatures } from './types.js';
import { taxiConnectionFeatures } from './taxi-map.js';

const islands: MapFeatures = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			geometry: null,
			properties: { id: 'island:1443', name: 'Malé', centroid: [73.51, 4.175] }
		},
		{
			type: 'Feature',
			geometry: null,
			properties: { id: 'island:1442', name: 'Hulhumalé', centroid: [73.54, 4.219] }
		},
		{
			type: 'Feature',
			geometry: null,
			properties: { id: 'island:1483', name: 'Hulhulé', centroid: [73.53, 4.19] }
		}
	]
};
const corridor = { pickup_zone: 'hulhumale', dropoff_zone: 'hulhule', ride_count: 23915 };

describe('historical taxi corridor geometry', () => {
	it('omits same-zone, unsupported and missing-anchor connections', () => {
		expect(taxiConnectionFeatures(null, islands).features).toEqual([]);
		expect(taxiConnectionFeatures(corridor, null).features).toEqual([]);
		expect(
			taxiConnectionFeatures({ ...corridor, dropoff_zone: 'hulhumale' }, islands).features
		).toEqual([]);
		expect(
			taxiConnectionFeatures({ ...corridor, dropoff_zone: 'unknown' }, islands).features
		).toEqual([]);
		expect(
			taxiConnectionFeatures(corridor, { ...islands, features: islands.features.slice(0, 2) })
				.features
		).toEqual([]);
	});

	it('joins the canonical island centroids with a labeled schematic arc without mutating inputs', () => {
		const before = structuredClone({ corridor, islands });
		const result = taxiConnectionFeatures(corridor, islands);
		const [line, start, end] = result.features;
		expect(line.properties).toMatchObject({
			kind: 'historical_taxi_connection',
			ride_count: 23915,
			label: '23,915 taxi records',
			geometry_basis: 'schematic_centroid_connection'
		});
		expect(line.geometry.type).toBe('LineString');
		if (line.geometry.type !== 'LineString') throw new Error('Missing connection line');
		expect(line.geometry.coordinates[0]).toEqual([73.54, 4.219]);
		expect(line.geometry.coordinates.at(-1)).toEqual([73.53, 4.19]);
		const middle = line.geometry.coordinates[16];
		expect(middle).not.toEqual([(73.54 + 73.53) / 2, (4.219 + 4.19) / 2]);
		expect(start.properties).toMatchObject({ island_id: 'island:1442', name: 'Hulhumalé' });
		expect(end.properties).toMatchObject({ island_id: 'island:1483', name: 'Hulhulé' });
		expect(start.geometry).toEqual({ type: 'Point', coordinates: [73.54, 4.219] });
		expect(end.geometry).toEqual({ type: 'Point', coordinates: [73.53, 4.19] });
		expect({ corridor, islands }).toEqual(before);
		line.geometry.coordinates[0][0] = 0;
		if (start.geometry.type === 'Point') start.geometry.coordinates[0] = 0;
		expect({ corridor, islands }).toEqual(before);
		expect(
			taxiConnectionFeatures({ ...corridor, pickup_zone: 'male' }, islands).features[0].geometry
				.coordinates[0]
		).toEqual([73.51, 4.175]);
	});
});
