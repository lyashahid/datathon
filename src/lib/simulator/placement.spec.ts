import { describe, expect, it } from 'vitest';
import { circleRing, distanceToLineM, fromLocalM, haversineM } from '#lib/analysis/geo.ts';
import { composeScore } from '#lib/analysis/scoring.ts';
import type { InfrastructureFeature, Position } from '#lib/types/domain.ts';
import {
	evaluatePlacement,
	proposedName,
	type PlacementContext,
	type RoadCheck
} from './placement.ts';

const ORIGIN: Position = [73.51, 4.175];
const at = (eastM: number, northM: number) => fromLocalM(ORIGIN, [eastM, northM]);

function stop(id: string, position: Position, island = 'Malé'): InfrastructureFeature {
	return {
		id,
		name: `Stop ${id}`,
		type: 'bus_stop',
		status: 'existing',
		geometry: { type: 'Point', coordinates: position },
		source: { provenance: 'demo', dataset: 't', syntheticFields: [] },
		metadata: { island, atoll: 'Malé City' }
	};
}

/** A non-stop facility nearby, so placements resolve to an island without affecting spacing. */
const anchor: InfrastructureFeature = { ...stop('school', at(0, 300)), type: 'school' };

const onRoad: RoadCheck = { status: 'checked', distanceM: 5 };
const fixedScore = composeScore(
	[{ id: 'connectivity', label: '', score: 50, explanation: '', inputs: [] }],
	[]
);

function context(overrides: Partial<PlacementContext>): PlacementContext {
	return {
		type: 'bus_stop',
		position: ORIGIN,
		infrastructure: [anchor, stop('far', at(1500, 0))],
		road: onRoad,
		densityForIsland: () => 60_000,
		scoreCandidate: () => fixedScore,
		...overrides
	};
}

describe('evaluatePlacement', () => {
	it('accepts a spot on a road with no nearby stop', () => {
		const e = evaluatePlacement(context({}));
		expect(e.validity).toBe('valid');
		expect(e.island).toBe('Malé');
		expect(e.issues).toEqual([]);
	});

	it('warns when within the minimum stop spacing', () => {
		const e = evaluatePlacement(context({ infrastructure: [anchor, stop('near', at(200, 0))] }));
		expect(e.validity).toBe('warning');
		expect(e.issues[0].message).toContain('Stop near');
	});

	it('blocks a duplicate on top of an existing stop', () => {
		const e = evaluatePlacement(context({ infrastructure: [anchor, stop('dup', at(20, 0))] }));
		expect(e.validity).toBe('invalid');
		expect(
			e.issues.some((i) => i.severity === 'blocking' && i.message.includes('Duplicates'))
		).toBe(true);
	});

	it('blocks spots away from a mapped road', () => {
		expect(
			evaluatePlacement(context({ road: { status: 'checked', distanceM: 80 } })).validity
		).toBe('invalid');
		expect(
			evaluatePlacement(context({ road: { status: 'checked', distanceM: null } })).validity
		).toBe('invalid');
	});

	it('falls back to a caution when road data is unavailable', () => {
		const e = evaluatePlacement(context({ road: { status: 'unavailable', reason: 'zoomed out' } }));
		expect(e.validity).toBe('warning');
		expect(e.issues[0].message).toContain('zoomed out');
	});

	it('uses island outlines when provided, even far from any facility', () => {
		const e = evaluatePlacement(
			context({ infrastructure: [stop('far', at(5000, 0))], islandAt: () => 'Malé' })
		);
		expect(e.island).toBe('Malé');
		expect(e.atoll).toBe('Malé City');
		expect(e.issues.some((i) => i.message.includes('Outside'))).toBe(false);
	});

	it('falls back to the nearest facility outside every outline', () => {
		const e = evaluatePlacement(context({ islandAt: () => null }));
		expect(e.island).toBe('Malé');
	});

	it('blocks spots far from any mapped island', () => {
		const e = evaluatePlacement(context({ infrastructure: [stop('far', at(5000, 0))] }));
		expect(e.validity).toBe('invalid');
		expect(e.impact).toBeNull();
	});

	it('ignores disabled stops for spacing and coverage', () => {
		const disabled = { ...stop('off', at(20, 0)), status: 'disabled' as const };
		const e = evaluatePlacement(
			context({ infrastructure: [anchor, stop('far', at(1500, 0)), disabled] })
		);
		expect(e.validity).toBe('valid');
	});

	it('estimates impact deterministically and credits only uncovered residents', () => {
		const lone = evaluatePlacement(context({}));
		const again = evaluatePlacement(context({}));
		expect(lone).toEqual(again);

		const overlapping = evaluatePlacement(
			context({ infrastructure: [anchor, stop('far', at(1500, 0)), stop('n', at(250, 0))] })
		);
		expect(lone.impact!.newPopulation).toBeGreaterThan(overlapping.impact!.newPopulation);
		expect(overlapping.impact!.newPopulation).toBeGreaterThan(0);
		for (const e of [lone, overlapping]) {
			expect(e.impact!.avgWalkAfterMin).toBeLessThanOrEqual(e.impact!.avgWalkBeforeMin);
		}
		expect(lone.impact!.score).toBe(fixedScore);
	});

	it('names placed facilities sequentially', () => {
		const proposed = { ...stop('p', ORIGIN), status: 'proposed' as const };
		expect(proposedName('bus_stop', [stop('a', ORIGIN)])).toBe('Proposed bus stop 1');
		expect(proposedName('bus_stop', [proposed])).toBe('Proposed bus stop 2');
	});
});

describe('geometry helpers', () => {
	it('measures point-to-line distance', () => {
		const line = [at(-100, 30), at(100, 30)];
		expect(distanceToLineM(ORIGIN, line)).toBeCloseTo(30, 0);
		expect(distanceToLineM(at(200, 0), line)).toBeCloseTo(Math.hypot(100, 30), 0);
	});

	it('builds a closed circle ring at the given radius', () => {
		const ring = circleRing(ORIGIN, 400, 16);
		expect(ring).toHaveLength(17);
		expect(ring[0]).toEqual(ring[16]);
		for (const p of ring) expect(haversineM(ORIGIN, p)).toBeCloseTo(400, -1);
	});
});
