import { readFileSync } from 'node:fs';
import { latLngToCell } from 'h3-js';
import type { Polygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import type { OriginComparison, PlanningBaseline, PlanningJourney } from '#lib/planning/types.ts';
import { honeycombAreas } from './honeycombAreas.ts';
import { HONEYCOMB_RESOLUTION } from './honeycombGrid.ts';
import { journeyTimeBand, type JourneyTimeState } from './travelTimeBands.ts';

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
	const land = box(73.504, 4.168, 73.512, 4.176);
	const pixel = box(73.506, 4.169, 73.509, 4.172);
	return {
		schemaVersion: 1,
		version: 'honeycomb-allocation-test',
		generatedAt: '2026-10-10T00:00:00Z',
		referenceDate: '2026-10-10',
		sources: [],
		islands: [{ id: 'male', name: 'Malé', geometry: land }],
		landBoundaries: land,
		origins: [
			{
				id: 'a',
				islandId: 'male',
				lat: 4.17,
				lon: 73.507,
				population2026: 300,
				population2030: 400,
				geometry: pixel
			},
			{
				id: 'b',
				islandId: 'male',
				lat: 4.17,
				lon: 73.507,
				population2026: 100,
				population2030: null,
				geometry: pixel
			}
		],
		network: { nodes: [], edges: [] },
		facilities: [],
		transit: { stops: [], patterns: [], gaps: [] }
	};
}

function journey(minutes: number | 'unreachable' | 'unavailable'): PlanningJourney {
	return {
		status: typeof minutes === 'number' ? 'reachable' : minutes,
		minutes: typeof minutes === 'number' ? minutes : null,
		reason: null,
		destinationId: null,
		path: []
	};
}

function result(
	id: string,
	before: Parameters<typeof journey>[0],
	after: Parameters<typeof journey>[0]
): OriginComparison {
	return {
		originId: id,
		islandId: 'male',
		population: id === 'a' ? 300 : 100,
		before: journey(before),
		after: journey(after),
		deltaMinutes: null,
		newlyReachable: false,
		lostAccess: false,
		worsenedJourney: false,
		becameUnavailable: false
	};
}

describe('population and access honeycomb display', () => {
	it('highlights a faster journey even when its access status and time band stay the same', () => {
		const data = baseline();
		data.origins = [data.origins[0]];
		const areas = honeycombAreas(data, { origins: [result('a', 9, 8)] }, 2026);
		for (const cell of areas.features.filter((feature) => feature.properties.population > 0)) {
			const p = cell.properties;
			expect(p.status).toBe('reachable');
			expect(p.journeyTimeBand).toBe('ten');
			expect(p.journeyChange).toBe('faster');
			expect(p.improvedPopulation).toBeCloseTo(p.population, 10);
			expect(p.improvedShare).toBe(1);
			expect(p.worsenedShare).toBe(0);
			expect(p.comparablePopulation).toBeCloseTo(p.population, 10);
			expect(p.averageMinutesSaved).toBeCloseTo(1, 10);
		}
	});

	it('keeps partially improved hexagons mixed and excludes unknown comparisons from benefits', () => {
		const areas = honeycombAreas(
			baseline(),
			{ origins: [result('a', 9, 8), result('b', 'unavailable', 8)] },
			2026
		);
		for (const cell of areas.features.filter((feature) => feature.properties.population > 0)) {
			const p = cell.properties;
			expect(p.journeyChange).toBe('mixed');
			expect(p.journeyChangePopulation.faster).toBeCloseTo(p.population * 0.75, 10);
			expect(p.journeyChangePopulation.unknown).toBeCloseTo(p.population * 0.25, 10);
			expect(p.improvedShare).toBeCloseTo(0.75, 10);
			expect(p.comparablePopulation).toBeCloseTo(p.population * 0.75, 10);
			expect(p.averageMinutesSaved).toBeCloseTo(1, 10);
		}
	});

	it('separates a newly possible route from crossing the destination access target', () => {
		const data = baseline();
		data.origins = [data.origins[0]];
		const areas = honeycombAreas(data, { origins: [result('a', 'unreachable', 40)] }, 2026);
		for (const cell of areas.features.filter((feature) => feature.properties.population > 0)) {
			const p = cell.properties;
			expect(p.status).toBe('gap');
			expect(p.journeyChange).toBe('new-route');
			expect(p.improvedShare).toBe(1);
			expect(p.comparablePopulation).toBe(0);
			expect(p.averageMinutesSaved).toBeNull();
		}
	});

	it('conserves affected residents across land-clipped hexagons without multiplying origins', () => {
		const data = baseline();
		const areas = honeycombAreas(
			data,
			{ origins: [result('a', 9, 8), result('b', 8, 'unreachable')] },
			2026
		);
		const sum = (property: 'improvedPopulation' | 'worsenedPopulation' | 'comparablePopulation') =>
			areas.features.reduce((total, cell) => total + cell.properties[property], 0);
		expect(sum('improvedPopulation')).toBeCloseTo(300, 8);
		expect(sum('worsenedPopulation')).toBeCloseTo(100, 8);
		expect(sum('comparablePopulation')).toBeCloseTo(300, 8);
		for (const cell of areas.features) {
			const p = cell.properties;
			expect(Object.values(p.journeyChangePopulation).reduce((a, b) => a + b, 0)).toBeCloseTo(
				p.population,
				10
			);
			if (p.population > 0) {
				expect(p.journeyChange).toBe('mixed');
				expect(p.improvedShare).toBeCloseTo(0.75, 10);
				expect(p.worsenedShare).toBeCloseTo(0.25, 10);
			}
		}
	});

	it('shows actual journey times independently of the policy access threshold', () => {
		const data = baseline();
		const analysis = { origins: [result('a', 20, 8), result('b', 40, 40)] };
		const target30 = honeycombAreas(data, analysis, 2026, 30);
		const target5 = honeycombAreas(data, analysis, 2026, 5);
		for (const [index, cell] of target30.features.entries()) {
			const p = cell.properties;
			expect(target5.features[index].properties.journeyTimeBand).toBe(p.journeyTimeBand);
			expect(target5.features[index].properties.journeyTimePopulation).toEqual(
				p.journeyTimePopulation
			);
			if (p.population === 0) continue;
			expect(p.status).toBe('mixed');
			expect(target5.features[index].properties.status).toBe('gap');
			expect(p.journeyTimeBand).toBe('mixed');
			expect(p.journeyTimePopulation.ten).toBeCloseTo(p.population * 0.75, 10);
			expect(p.journeyTimePopulation['over-thirty']).toBeCloseTo(p.population * 0.25, 10);
		}
	});

	it('does not give an unavailable or no-route contribution an invented travel duration', () => {
		const data = baseline();
		const areas = honeycombAreas(
			data,
			{ origins: [result('a', 8, 'unreachable'), result('b', 8, 'unavailable')] },
			2026
		);
		for (const cell of areas.features.filter((feature) => feature.properties.population > 0)) {
			const p = cell.properties;
			expect(p.journeyTimeBand).toBe('mixed');
			expect(p.journeyTimePopulation.unreachable).toBeCloseTo(p.population * 0.75, 10);
			expect(p.journeyTimePopulation.unknown).toBeCloseTo(p.population * 0.25, 10);
			for (const band of ['five', 'ten', 'fifteen', 'thirty', 'over-thirty'] as const)
				expect(p.journeyTimePopulation[band]).toBe(0);
		}
	});

	it('keeps distinct time bands even when every contribution meets the access target', () => {
		const areas = honeycombAreas(
			baseline(),
			{ origins: [result('a', 4, 4), result('b', 12, 12)] },
			2026,
			30
		);
		for (const cell of areas.features.filter((feature) => feature.properties.population > 0)) {
			expect(cell.properties.status).toBe('reachable');
			expect(cell.properties.journeyTimeBand).toBe('mixed');
			expect(cell.properties.journeyTimePopulation.five).toBeCloseTo(
				cell.properties.population * 0.75,
				10
			);
			expect(cell.properties.journeyTimePopulation.fifteen).toBeCloseTo(
				cell.properties.population * 0.25,
				10
			);
		}
	});

	it('conserves the analyzed residents in every time band across the clipped public grid', () => {
		const data = JSON.parse(
			readFileSync('data/public/planning-baseline.json', 'utf8')
		) as PlanningBaseline;
		const times = [4, 8, 12, 22, 42, 'unreachable', 'unavailable'] as const;
		const origins = data.origins.map((origin, index) => ({
			...result(origin.id, times[index % times.length], times[index % times.length]),
			islandId: origin.islandId,
			population: origin.population2026
		}));
		const expected: Partial<Record<JourneyTimeState, number>> = {};
		for (const origin of origins) {
			const band = journeyTimeBand(origin.after);
			expected[band] = (expected[band] ?? 0) + origin.population;
		}
		const actual: Partial<Record<JourneyTimeState, number>> = {};
		for (const cell of honeycombAreas(data, { origins }, 2026).features) {
			expect(
				Object.values(cell.properties.journeyTimePopulation).reduce((sum, value) => sum + value, 0)
			).toBeCloseTo(cell.properties.population, 8);
			for (const [band, population] of Object.entries(cell.properties.journeyTimePopulation)) {
				const state = band as JourneyTimeState;
				actual[state] = (actual[state] ?? 0) + population;
			}
		}
		for (const [band, population] of Object.entries(expected))
			expect(actual[band as JourneyTimeState]).toBeCloseTo(population, 6);
	});

	it('uses the analyzed population allocation when a housing scenario redistributes residents', () => {
		const data = baseline();
		const analyzed = {
			origins: [
				{ ...result('a', 8, 8), population: 250 },
				{ ...result('b', 8, 8), population: 250 }
			]
		};
		const areas = honeycombAreas(data, analyzed, 2030);
		expect(areas.features.reduce((sum, cell) => sum + cell.properties.population, 0)).toBeCloseTo(
			500,
			8
		);
		for (const cell of areas.features.filter((feature) => feature.properties.population > 0)) {
			expect(cell.properties.statusPopulation.reachable).toBeCloseTo(cell.properties.population, 8);
		}
		expect(data.origins.map((origin) => origin.population2026)).toEqual([300, 100]);
	});
	it('intersects raster pixels across multiple hexagons and conserves each population year', () => {
		const data = baseline();
		const original = JSON.stringify(data);
		const areas2026 = honeycombAreas(data, null, 2026);
		const areas2030 = honeycombAreas(data, null, 2030);
		const inhabited = areas2026.features.filter((feature) => feature.properties.population > 0);
		expect(inhabited.length).toBeGreaterThan(1);
		expect(inhabited.every((feature) => feature.properties.originIds.join(',') === 'a,b')).toBe(
			true
		);
		expect(
			areas2026.features.reduce((sum, feature) => sum + feature.properties.population, 0)
		).toBeCloseTo(400, 8);
		expect(
			areas2030.features.reduce((sum, feature) => sum + feature.properties.population, 0)
		).toBeCloseTo(500, 8);
		expect(JSON.stringify(data)).toBe(original);
		expect(
			areas2030.features.every((feature, i) => feature.geometry === areas2026.features[i].geometry)
		).toBe(true);
		expect(inhabited.every((feature) => feature.properties.originId === 'a')).toBe(true);
	});

	it('marks mixed cells truthfully instead of claiming every resident has the same access', () => {
		const areas = honeycombAreas(
			baseline(),
			{ origins: [result('a', 8, 8), result('b', 'unreachable', 40)] },
			2026
		);
		for (const feature of areas.features.filter((cell) => cell.properties.population > 0)) {
			const p = feature.properties;
			expect(p.status).toBe('mixed');
			expect(p.reachableShare).toBeCloseTo(0.75, 12);
			expect(p.statusPopulation.reachable).toBeCloseTo(p.population * 0.75, 10);
			expect(p.statusPopulation.gap).toBeCloseTo(p.population * 0.25, 10);
			expect(p.statusPopulation.unknown).toBe(0);
		}
	});

	it('keeps unavailable residents separate from reachable and unreachable residents', () => {
		const areas = honeycombAreas(
			baseline(),
			{ origins: [result('a', 8, 8), result('b', 8, 'unavailable')] },
			2026
		);
		const p = areas.features.find((cell) => cell.properties.population > 0)!.properties;
		expect(p.status).toBe('mixed');
		expect(p.statusPopulation.unknown).toBeCloseTo(p.population * 0.25, 10);
		expect(p.statusPopulation.gap).toBe(0);
		expect(p.statusPopulation.lost).toBe(0);
	});

	it('classifies gained and lost access from journeys at the requested target, not stale flags', () => {
		const data = baseline();
		data.origins = [data.origins[0]];
		const improvement = { origins: [result('a', 20, 10)] };
		const gain = honeycombAreas(data, improvement, 2026, 15);
		expect(
			gain.features
				.filter((cell) => cell.properties.population > 0)
				.every((cell) => cell.properties.status === 'gained')
		).toBe(true);
		const noGain = honeycombAreas(data, improvement, 2026, 30);
		expect(
			noGain.features
				.filter((cell) => cell.properties.population > 0)
				.every((cell) => cell.properties.status === 'reachable')
		).toBe(true);
		const loss = honeycombAreas(data, { origins: [result('a', 20, 40)] }, 2026, 30);
		expect(
			loss.features
				.filter((cell) => cell.properties.population > 0)
				.every((cell) => cell.properties.status === 'lost')
		).toBe(true);
		const stillGap = honeycombAreas(data, { origins: [result('a', 20, 40)] }, 2026, 15);
		expect(
			stillGap.features
				.filter((cell) => cell.properties.population > 0)
				.every((cell) => cell.properties.status === 'gap')
		).toBe(true);
	});

	it('normalizes coastal pixels onto clipped land and leaves empty land cells unselectable', () => {
		const data = baseline();
		data.origins[0].geometry = box(73.502, 4.169, 73.505, 4.172);
		data.origins = [data.origins[0]];
		const areas = honeycombAreas(data, null, 2026);
		expect(areas.features.reduce((sum, cell) => sum + cell.properties.population, 0)).toBeCloseTo(
			300,
			8
		);
		const blank = areas.features.find((cell) => cell.properties.population === 0)!.properties;
		expect(blank).toMatchObject({
			originId: null,
			originIds: [],
			status: 'unknown',
			journeyTimeBand: 'unknown',
			journeyChange: 'unknown',
			improvedShare: null,
			worsenedShare: null,
			comparablePopulation: 0,
			averageMinutesSaved: null,
			reachableShare: null,
			pointAllocated: false
		});
		expect(Object.values(blank.journeyTimePopulation).every((population) => population === 0)).toBe(
			true
		);
		expect(
			areas.features
				.filter((cell) => cell.properties.population > 0)
				.every((cell) => !cell.properties.pointAllocated)
		).toBe(true);
	});

	it('labels point-only allocation and keeps it on the original island', () => {
		const data = baseline();
		data.origins = [data.origins[0]];
		delete data.origins[0].geometry;
		const areas = honeycombAreas(data, null, 2026);
		const inhabited = areas.features.filter((cell) => cell.properties.population > 0);
		expect(inhabited).toHaveLength(1);
		expect(inhabited[0].properties).toMatchObject({
			population: 300,
			pointAllocated: true,
			islandId: 'male',
			h3Id: latLngToCell(4.17, 73.507, HONEYCOMB_RESOLUTION)
		});
	});

	it('retains the authoritative island totals of all public origins without altering their geometry or model population', () => {
		const data = JSON.parse(
			readFileSync('data/public/planning-baseline.json', 'utf8')
		) as PlanningBaseline;
		const original = JSON.stringify(data.origins);
		for (const year of [2026, 2030] as const) {
			const areas = honeycombAreas(data, null, year);
			for (const island of data.islands) {
				const expected = data.origins
					.filter((origin) => origin.islandId === island.id)
					.reduce(
						(sum, origin) =>
							sum +
							(year === 2030
								? (origin.population2030 ?? origin.population2026)
								: origin.population2026),
						0
					);
				const actual = areas.features
					.filter((cell) => cell.properties.islandId === island.id)
					.reduce((sum, cell) => sum + cell.properties.population, 0);
				expect(actual).toBeCloseTo(expected, 6);
			}
			expect(areas.features.every((cell) => !cell.properties.pointAllocated)).toBe(true);
		}
		expect(JSON.stringify(data.origins)).toBe(original);
	});
});
