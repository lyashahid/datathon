import { describe, expect, it } from 'vitest';
import infrastructureRaw from '../../../data/sample/infrastructure.geojson?raw';
import routesRaw from '../../../data/sample/routes.geojson?raw';
import {
	BUS_STOP_SCORING,
	CANDIDATE_LABELS,
	DEFAULT_BUS_STOP_WEIGHTS,
	type BusStopWeights
} from '#lib/config/busStopScoring.ts';
import { PLACEMENT_RULES } from '#lib/config/placement.ts';
import { decodeInfrastructureCollection } from '#lib/data/infrastructure.ts';
import { decodeRouteCollection } from '#lib/data/routes.ts';
import type { Position } from '#lib/types/domain.ts';
import { recommendBusStops } from './candidates.ts';
import { haversineM } from './geo.ts';
import { createDemoBaseCells, demoIslandAt } from './h3DemoData.ts';
import { buildAccessibilityGrid } from './h3Grid.ts';
import { MIN_LAST_WEIGHT, normalizeWeights, updateWeight } from './scoring/busStop.ts';

const infrastructure = decodeInfrastructureCollection(JSON.parse(infrastructureRaw)).features;
const routes = decodeRouteCollection(JSON.parse(routesRaw)).routes;
const grid = buildAccessibilityGrid(createDemoBaseCells(), infrastructure);

/** Malé's poorly served eastern tip, where the gap rules suggest a bus stop. */
function cellNear(p: Position) {
	return [...grid.cells].sort((a, b) => haversineM(p, a.centroid) - haversineM(p, b.centroid))[0];
}
const origin = cellNear([73.5212, 4.1733]);

const search = (weights: BusStopWeights = DEFAULT_BUS_STOP_WEIGHTS, topN = 5) =>
	recommendBusStops({
		origin,
		grid,
		infrastructure,
		routes,
		weights,
		islandAt: demoIslandAt,
		topN
	});

const only = (id: keyof BusStopWeights): BusStopWeights => ({
	underservedReached: 0,
	populationCoverage: 0,
	walkingImprovement: 0,
	networkSuitability: 0,
	essentialServices: 0,
	[id]: 1
});

describe('recommendBusStops', () => {
	it('returns ranked candidates in descending score order, deterministically', () => {
		const result = search();
		expect(result.candidates.length).toBeGreaterThan(0);
		expect(result.candidates.map((c) => c.rank)).toEqual(result.candidates.map((_, i) => i + 1));
		const scores = result.candidates.map((c) => c.score);
		expect([...scores].sort((a, b) => b - a)).toEqual(scores);
		expect(search()).toEqual(result);
	});

	it('keeps every candidate inside the area on the origin island', () => {
		const result = search();
		for (const c of result.candidates) {
			expect(c.island).toBe(origin.island);
			expect(haversineM(origin.centroid, c.position)).toBeLessThanOrEqual(
				BUS_STOP_SCORING.areaRadiusM
			);
			expect(c.score).toBeGreaterThanOrEqual(0);
			expect(c.score).toBeLessThanOrEqual(100);
		}
		expect(result.evaluated).toBe(result.area.cellCount);
	});

	it('rejects candidates that duplicate an existing stop', () => {
		const stops = infrastructure.filter((f) => f.type === 'bus_stop');
		for (const c of search(DEFAULT_BUS_STOP_WEIGHTS, 50).candidates) {
			for (const s of stops) {
				expect(haversineM(c.position, s.geometry.coordinates)).toBeGreaterThanOrEqual(
					PLACEMENT_RULES.duplicateDistanceM
				);
			}
		}
	});

	it('keeps ranked candidates apart so they are distinct options', () => {
		const { candidates } = search(DEFAULT_BUS_STOP_WEIGHTS, 5);
		for (let i = 0; i < candidates.length; i++) {
			for (let j = i + 1; j < candidates.length; j++) {
				expect(haversineM(candidates[i].position, candidates[j].position)).toBeGreaterThanOrEqual(
					BUS_STOP_SCORING.minSeparationM
				);
			}
		}
	});

	it('reproduces each score from its breakdown', () => {
		for (const c of search().candidates) {
			const raw =
				c.criteria.reduce((s, x) => s + x.score * x.weight, 0) +
				c.penalties.reduce((s, p) => s + p.points, 0);
			expect(c.score).toBe(Math.round(Math.max(0, Math.min(100, raw))));
		}
	});

	it('penalises candidates close to an existing stop', () => {
		const near = search(DEFAULT_BUS_STOP_WEIGHTS, 50).candidates.find((c) =>
			c.penalties.some((p) => p.id === 'nearbyStop')
		);
		expect(near).toBeDefined();
		expect(near!.penalties.find((p) => p.id === 'nearbyStop')!.points).toBeLessThan(0);
	});

	it('changes the ranking when priorities change', () => {
		const network = search(only('networkSuitability'), 50).candidates;
		const best = Math.max(
			...network.map((c) => c.criteria.find((x) => x.id === 'networkSuitability')!.score)
		);
		expect(network[0].criteria.find((x) => x.id === 'networkSuitability')!.score).toBe(best);

		const underserved = search(only('underservedReached'), 50).candidates;
		const maxReached = Math.max(...underserved.map((c) => c.underservedReached));
		expect(underserved[0].underservedReached).toBeCloseTo(maxReached, 6);
	});

	it('reports an accessibility gain that is never negative', () => {
		for (const c of search().candidates)
			expect(c.estimatedAccessibilityGain).toBeGreaterThanOrEqual(0);
		expect(search().candidates[0].estimatedAccessibilityGain).toBeGreaterThan(0);
	});
});

describe('normalizeWeights', () => {
	it('rescales to sum to 1 and never yields an invalid state', () => {
		const sum = (w: BusStopWeights) => Object.values(w).reduce((a, b) => a + b, 0);
		expect(
			sum(normalizeWeights({ ...DEFAULT_BUS_STOP_WEIGHTS, underservedReached: 3 }))
		).toBeCloseTo(1);
		const zero = normalizeWeights(only('essentialServices'));
		expect(zero.essentialServices).toBe(1);
		const allZero = normalizeWeights({ ...only('essentialServices'), essentialServices: 0 });
		expect(allZero).toEqual(normalizeWeights(DEFAULT_BUS_STOP_WEIGHTS));
		const negative = normalizeWeights({ ...DEFAULT_BUS_STOP_WEIGHTS, populationCoverage: -5 });
		expect(negative.populationCoverage).toBe(0);
		expect(sum(negative)).toBeCloseTo(1);
	});
});

describe('candidate wording', () => {
	it('never claims a best location', () => {
		expect(CANDIDATE_LABELS.top).toBe('Highest scoring candidate under selected assumptions');
		expect(`${CANDIDATE_LABELS.top} ${CANDIDATE_LABELS.ranked(2)}`).not.toMatch(/best/i);
	});
});

describe('updateWeight', () => {
	it('changes one priority and never allows an all-zero set', () => {
		const one = only('walkingImprovement');
		expect(updateWeight(one, 'networkSuitability', 0.4).networkSuitability).toBe(0.4);
		expect(updateWeight(one, 'walkingImprovement', 0).walkingImprovement).toBe(MIN_LAST_WEIGHT);
		expect(updateWeight(DEFAULT_BUS_STOP_WEIGHTS, 'essentialServices', 7).essentialServices).toBe(
			1
		);
		expect(updateWeight(DEFAULT_BUS_STOP_WEIGHTS, 'essentialServices', -1).essentialServices).toBe(
			0
		);
	});
});
