import { describe, expect, it } from 'vitest';
import {
	atollInventory,
	inventoryForScope,
	inventoryFromFeatures,
	islandAnalytics,
	scoreDistribution,
	type NationalAccessibility
} from './analytics.js';
import type { Accessibility, MapFeatures } from './types.js';

const islands: MapFeatures = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			geometry: null,
			properties: { id: 'island:1', name: 'One', atoll: 'North', category: 'Residential Island' }
		},
		{
			type: 'Feature',
			geometry: null,
			properties: { id: 'island:2', name: 'Two', atoll: 'North', category: 'Uninhabited Island' }
		},
		{
			type: 'Feature',
			geometry: null,
			properties: { id: 'island:3', name: 'Three', atoll: 'South', category: 'Residential Island' }
		}
	]
};
const facilities: MapFeatures = {
	type: 'FeatureCollection',
	features: [
		{
			type: 'Feature',
			id: 'facility:health:1',
			geometry: { type: 'Point', coordinates: [73, 4] },
			properties: { island_id: 'island:1', category: 'clinic' }
		},
		{
			type: 'Feature',
			id: 'facility:education:2',
			geometry: null,
			properties: {
				island_id: 'island:1',
				category: 'school',
				geometry_quality: 'island_context_only'
			}
		},
		{
			type: 'Feature',
			id: 'facility:health:3',
			geometry: null,
			properties: { island_id: null, category: 'hospital' }
		},
		{
			type: 'Feature',
			id: 'osm:node:4',
			geometry: { type: 'Point', coordinates: [73, 4] },
			properties: { island_id: 'island:1', category: 'school' }
		}
	]
};
const score = (island_id: string, value: number): Accessibility => ({
	island_id,
	score: value,
	confidence: 0.4,
	domains: {},
	missing_data: ['no_geocoded_facility'],
	explanation: [],
	config: {}
});
const accessibility: NationalAccessibility = {
	version: 'test',
	scores: [score('island:1', 20), score('island:2', 0)],
	summary: { island_count: 2, average_score: 10, zero_score_count: 1, missing_data_score_count: 2 }
};

describe('national analytics inventory and screening', () => {
	it('counts official inventory without duplicating OSM matches and retains unlocated records', () => {
		const inventory = inventoryFromFeatures(facilities);
		expect(inventory).toHaveLength(3);
		expect(inventory.filter((item) => item.located)).toHaveLength(1);
		expect(inventory.filter((item) => item.contextOnly)).toHaveLength(1);
		const rows = islandAnalytics(islands, inventory, accessibility);
		expect(rows[0].facilityCount).toBe(2);
		expect(rows[0].locatedCount).toBe(1);
		expect(rows[0].facilities).toEqual({ clinic: 1, school: 1 });
	});
	it('includes unmatched facilities only in national totals, never in an island or atoll count', () => {
		const inventory = inventoryFromFeatures(facilities);
		const rows = islandAnalytics(islands, inventory, accessibility);
		expect(inventoryForScope(inventory, rows, true)).toHaveLength(3);
		expect(
			inventoryForScope(
				inventory,
				rows.filter((row) => row.id === 'island:1'),
				false
			)
		).toHaveLength(2);
		expect(atollInventory(rows).reduce((sum, group) => sum + group.facilityCount, 0)).toBe(2);
	});
	it('separates an unavailable score from an actual modeled zero when averaging and binning', () => {
		const rows = islandAnalytics(islands, inventoryFromFeatures(facilities), accessibility);
		expect(rows[1].score).toBe(0);
		expect(rows[2].score).toBeNull();
		expect(rows[2].missingData).toBeNull();
		const groups = atollInventory(rows);
		expect(groups.find((group) => group.name === 'North')?.averageScore).toBe(10);
		expect(groups.find((group) => group.name === 'South')?.averageScore).toBeNull();
		expect(scoreDistribution(rows).unavailable).toBe(1);
		expect(scoreDistribution(rows).bins.map((bin) => bin.count)).toEqual([1, 0, 1, 0, 0, 0]);
	});
	it('bins decimal scores and inclusive upper bound exactly once', () => {
		const rows = islandAnalytics(islands, [], accessibility);
		const values = [0, 0.01, 19.99, 20, 39.99, 40, 60, 80, 100];
		const expanded = values.map((value, index) => ({
			...rows[0],
			id: `island:${index}`,
			score: value
		}));
		const distribution = scoreDistribution(expanded);
		expect(distribution.bins.map((bin) => bin.count)).toEqual([1, 2, 2, 1, 1, 2]);
		expect(distribution.unavailable).toBe(0);
	});
	it('ignores duplicate island geometry records and treats non-finite scores as unavailable', () => {
		const duplicated = { ...islands, features: [...islands.features, islands.features[0]] };
		const rows = islandAnalytics(duplicated, [], {
			...accessibility,
			scores: [score('island:1', NaN)]
		});
		expect(rows).toHaveLength(3);
		expect(rows[0].score).toBeNull();
		expect(scoreDistribution(rows).unavailable).toBe(3);
	});
	it('includes CAA airport IDs in official inventory while excluding OSM airport features', () => {
		const collection: MapFeatures = {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					id: 'airport:vrmm',
					geometry: { type: 'Point', coordinates: [73, 4] },
					properties: { island_id: 'island:1', category: 'airport', source: 'CAA' }
				},
				{
					type: 'Feature',
					id: 'osm:way:1',
					geometry: { type: 'Point', coordinates: [73, 4] },
					properties: { island_id: 'island:1', category: 'aerodrome', source: 'OpenStreetMap' }
				}
			]
		};
		const inventory = inventoryFromFeatures(collection);
		expect(inventory).toHaveLength(1);
		expect(atollInventory(islandAnalytics(islands, inventory, accessibility))[0].airports).toBe(1);
	});
	it('keeps islands with blank source names identifiable using their source ID', () => {
		const unnamed: MapFeatures = {
			...islands,
			features: islands.features.map((feature, index) => ({
				...feature,
				properties: { ...feature.properties, name: index === 0 ? '   ' : null }
			}))
		};
		const rows = islandAnalytics(unnamed, [], null);
		expect(rows.map((row) => row.name)).toEqual([
			'Unnamed island (island:1)',
			'Unnamed island (island:2)',
			'Unnamed island (island:3)'
		]);
		expect(new Set(rows.map((row) => row.name)).size).toBe(3);
	});
});
