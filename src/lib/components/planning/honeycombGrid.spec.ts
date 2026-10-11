import { readFileSync } from 'node:fs';
import { cellToBoundary, cellToLatLng, latLngToCell } from 'h3-js';
import polygonClipping, { type MultiPolygon as ClipMultiPolygon } from 'polygon-clipping';
import type { Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import type { PlanningBaseline } from '#lib/planning/types.ts';
import { honeycombGrid, HONEYCOMB_RESOLUTION } from './honeycombGrid.ts';

function box(west: number, south: number, east: number, north: number): Polygon {
	return {
		type: 'Polygon',
		coordinates: [
			[
				[west, south],
				[east, south],
				[east, north],
				[west, north],
				[west, south]
			]
		]
	};
}

function baseline(): PlanningBaseline {
	const shape = box(73.504, 4.168, 73.511, 4.176);
	return {
		schemaVersion: 1,
		version: 'honeycomb-test',
		generatedAt: '2026-10-10T00:00:00Z',
		referenceDate: '2026-10-10',
		sources: [],
		islands: [{ id: 'male', name: 'Malé', geometry: shape }],
		landBoundaries: {
			type: 'FeatureCollection',
			features: [{ type: 'Feature', properties: {}, geometry: shape }]
		},
		origins: [
			{
				id: 'first',
				islandId: 'male',
				lat: 4.17,
				lon: 73.507,
				population2026: 299,
				geometry: box(73.5069, 4.1699, 73.5071, 4.1701)
			},
			{
				id: 'second',
				islandId: 'male',
				lat: 4.17001,
				lon: 73.50701,
				population2026: 100,
				geometry: box(73.5071, 4.1699, 73.5073, 4.1701)
			}
		],
		network: { nodes: [], edges: [] },
		facilities: [],
		transit: { stops: [], patterns: [], gaps: [] }
	};
}

describe('land-clipped honeycomb display', () => {
	it('groups original origin identities once without allocating population or changing analysis inputs', () => {
		const data = baseline();
		const original = JSON.stringify(data);
		const grid = honeycombGrid(data);
		const h3Id = latLngToCell(4.17, 73.507, HONEYCOMB_RESOLUTION);
		const cell = grid.features.find((feature) => feature.properties.h3Id === h3Id)!;
		expect(cell.properties.originIds).toEqual(['first', 'second']);
		expect(cell.properties).not.toHaveProperty('population');
		expect(cell.properties).not.toHaveProperty('status');
		expect(grid.features.flatMap((feature) => feature.properties.originIds).sort()).toEqual([
			'first',
			'second'
		]);
		expect(new Set(grid.features.map((feature) => feature.id)).size).toBe(grid.features.length);
		expect(JSON.stringify(data)).toBe(original);
		expect(honeycombGrid(data)).toBe(grid);
	});

	it('clips every cell to shoreline, including internal water holes and partial coastal cells', () => {
		const data = baseline();
		const shore = box(73.505, 4.169, 73.51, 4.175);
		shore.coordinates.push(box(73.506, 4.171, 73.508, 4.173).coordinates[0]);
		data.landBoundaries = shore;
		const grid = honeycombGrid(data);
		expect(grid.features.length).toBeGreaterThan(1);
		for (const feature of grid.features) {
			const coordinates = feature.geometry.coordinates as ClipMultiPolygon;
			const shape = feature.geometry.type === 'Polygon' ? [coordinates] : coordinates;
			expect(
				polygonClipping.difference(shape, shore.coordinates as polygonClipping.Polygon)
			).toEqual([]);
		}
	});

	it('preserves disconnected land pieces of a coastal hexagon as a MultiPolygon', () => {
		const data = baseline();
		const h3Id = latLngToCell(4.17, 73.507, HONEYCOMB_RESOLUTION);
		const [lat, lon] = cellToLatLng(h3Id);
		const boundary = cellToBoundary(h3Id, true);
		const width = Math.min(
			Math.max(...boundary.map((point) => point[0])) - lon,
			lon - Math.min(...boundary.map((point) => point[0]))
		);
		const height = Math.min(
			Math.max(...boundary.map((point) => point[1])) - lat,
			lat - Math.min(...boundary.map((point) => point[1]))
		);
		data.islands[0].geometry = { type: 'Polygon', coordinates: [[...boundary, boundary[0]]] };
		data.landBoundaries = {
			type: 'MultiPolygon',
			coordinates: [
				box(lon - width * 0.45, lat - height * 0.1, lon - width * 0.25, lat + height * 0.1)
					.coordinates,
				box(lon + width * 0.25, lat - height * 0.1, lon + width * 0.45, lat + height * 0.1)
					.coordinates
			]
		};
		data.origins = [{ ...data.origins[0], lat, lon: lon - width * 0.35 }];
		const grid = honeycombGrid(data);
		expect(grid.features).toHaveLength(1);
		expect(grid.features[0].geometry.type).toBe('MultiPolygon');
		expect(grid.features[0].geometry.coordinates).toHaveLength(2);
	});

	it('retains the land surrounding a tiny water hole enclosing a cell centre', () => {
		const data = baseline();
		const h3Id = latLngToCell(4.17, 73.507, HONEYCOMB_RESOLUTION);
		const [lat, lon] = cellToLatLng(h3Id);
		const shore = box(lon - 0.002, lat - 0.002, lon + 0.002, lat + 0.002);
		const hole = box(lon - 0.000005, lat - 0.000005, lon + 0.000005, lat + 0.000005);
		shore.coordinates.push(hole.coordinates[0]);
		// Source shorelines use the display pipeline's sub-millimetre precision;
		// comparing to an unrounded H3-derived fixture would test rounding slivers.
		shore.coordinates = shore.coordinates.map((ring) =>
			ring.map(([x, y]) => [Number(x.toFixed(9)), Number(y.toFixed(9))])
		);
		data.islands[0].geometry = box(lon - 0.002, lat - 0.002, lon + 0.002, lat + 0.002);
		data.landBoundaries = shore;
		const grid = honeycombGrid(data);
		const coastalCell = grid.features.find((feature) => feature.properties.h3Id === h3Id)!;
		expect(coastalCell).toBeDefined();
		expect(coastalCell.geometry.type).toBe('Polygon');
		expect(coastalCell.geometry.coordinates).toHaveLength(2);
		// Other fully contained cells take the fast path while the interior water
		// stays absent, and no full or clipped cell protrudes beyond the land.
		expect(grid.features.length).toBeGreaterThan(100);
		const shoreline: ClipMultiPolygon = [
			shore.coordinates.map((ring) => ring.map((point) => [point[0], point[1]]))
		];
		for (const feature of grid.features) {
			const polygons: ClipMultiPolygon = (
				feature.geometry.type === 'Polygon'
					? [feature.geometry.coordinates]
					: feature.geometry.coordinates
			).map((polygon) => polygon.map((ring) => ring.map((point) => [point[0], point[1]])));
			expect(polygonClipping.difference(polygons, shoreline)).toEqual([]);
		}
	});

	it('does not invent a display grid when authoritative land geometry is unavailable', () => {
		const data = baseline();
		delete data.landBoundaries;
		expect(honeycombGrid(data).features).toEqual([]);
	});

	it('keeps an absent authoritative shoreline empty instead of using a more generous island fallback', () => {
		const data = baseline();
		data.islandBoundaries = data.landBoundaries;
		data.landBoundaries = { type: 'FeatureCollection', features: [] };
		expect(honeycombGrid(data).features).toEqual([]);
	});

	it('covers the public snapshot with unique land cells and keeps all 667 raster origins unchanged', () => {
		const data = JSON.parse(
			readFileSync('data/public/planning-baseline.json', 'utf8')
		) as PlanningBaseline;
		const before = JSON.stringify(data.origins);
		const grid = honeycombGrid(data);
		expect(grid.features.length).toBeGreaterThan(4000);
		expect(grid.features.length).toBeLessThan(5000);
		const originIds = grid.features.flatMap((feature) => feature.properties.originIds).sort();
		expect(originIds).toEqual(data.origins.map((origin) => origin.id).sort());
		expect(JSON.stringify(data.origins)).toBe(before);
		expect(honeycombGrid(data)).toBe(grid);
	});
});
