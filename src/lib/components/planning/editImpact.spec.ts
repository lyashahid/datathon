import { describe, expect, it } from 'vitest';
import type { OriginComparison, PlanningAnalysis, PlanningJourney } from '#lib/planning/types.ts';
import { analyzePlanning } from '#lib/planning/engine.ts';
import { createDefaultAssumptions } from '#lib/planning/defaults.ts';
import type { PlanningBaseline } from '#lib/planning/types.ts';
import { compareEditImpact, compareEditOrigins } from './editImpact.ts';

function journey(minutes: number | 'unreachable' | 'unavailable'): PlanningJourney {
	return {
		status: typeof minutes === 'number' ? 'reachable' : minutes,
		minutes: typeof minutes === 'number' ? minutes : null,
		destinationId: null,
		reason: null,
		path: []
	};
}

function origin(
	originId: string,
	after: Parameters<typeof journey>[0],
	population = 100
): OriginComparison {
	return {
		originId,
		islandId: 'male',
		population,
		before: journey(60),
		after: journey(after),
		deltaMinutes: 999,
		newlyReachable: true,
		lostAccess: false,
		worsenedJourney: false,
		becameUnavailable: false
	};
}

const baseline: PlanningBaseline = {
	schemaVersion: 1,
	version: 'edit-impact-fixture',
	generatedAt: '2026-10-10T00:00:00Z',
	referenceDate: '2026-10-10',
	sources: [],
	islands: [],
	origins: [],
	network: { nodes: [], edges: [] },
	facilities: [],
	transit: { stops: [], patterns: [], gaps: [] }
};
const emptyAnalysis = analyzePlanning(baseline, [], createDefaultAssumptions(baseline));
function analysis(origins: OriginComparison[]): PlanningAnalysis {
	return { ...structuredClone(emptyAnalysis), origins };
}

describe('impact of one proposal edit', () => {
	it('rebases map comparisons to the previous proposal without changing either baseline journey', () => {
		const previous = analysis([
			origin('faster', 20, 300),
			origin('lost', 8, 50),
			origin('slower', 10, 75),
			origin('unknown', 8, 25)
		]);
		const next = analysis([
			origin('faster', 10, 300),
			origin('lost', 'unreachable', 50),
			origin('slower', 15, 75),
			origin('unknown', 'unavailable', 25)
		]);
		const receipt = structuredClone({ previous, next });
		const origins = compareEditOrigins(previous, next);
		expect(origins).toHaveLength(4);
		expect(origins?.[0]).toMatchObject({
			before: { status: 'reachable', minutes: 20 },
			after: { status: 'reachable', minutes: 10 },
			deltaMinutes: 10,
			newlyReachable: false,
			lostAccess: false,
			worsenedJourney: false,
			becameUnavailable: false
		});
		expect(origins?.[1]).toMatchObject({
			before: { status: 'reachable', minutes: 8 },
			after: { status: 'unreachable', minutes: null },
			deltaMinutes: null,
			newlyReachable: false,
			lostAccess: true,
			worsenedJourney: false,
			becameUnavailable: false
		});
		expect(origins?.[2]).toMatchObject({ deltaMinutes: -5, worsenedJourney: true });
		expect(origins?.[3]).toMatchObject({
			deltaMinutes: null,
			lostAccess: false,
			becameUnavailable: true
		});
		expect(previous.origins[0].before.minutes).toBe(60);
		expect(next.origins[0].before.minutes).toBe(60);
		expect({ previous, next }).toEqual(receipt);
	});

	it('rejects incompatible origin-map and aggregate comparisons consistently', () => {
		const previous = analysis([origin('a', 20)]);
		for (const next of [
			analysis([origin('b', 10)]),
			analysis([origin('a', 10, 101)]),
			{ ...analysis([origin('a', 10)]), targetMinutes: 45 }
		]) {
			expect(compareEditOrigins(previous, next)).toBeNull();
			expect(compareEditImpact(previous, next)).toBeNull();
		}
	});

	it('compares consecutive after journeys, ignoring cumulative baseline flags and headlines', () => {
		const previous = analysis([origin('a', 20, 300)]);
		const next = analysis([origin('a', 25, 300)]);
		previous.summary.newlyReachedResidents = 50;
		next.summary.newlyReachedResidents = 1000;
		const result = compareEditImpact(previous, next);
		expect(result?.improvedPopulation).toBe(0);
		expect(result?.worsenedPopulation).toBe(300);
		expect(result?.averageMinutesSaved).toBe(-5);
	});

	it('matches origin IDs instead of array order and counts improvements, harm and missing evidence once', () => {
		const previous = analysis([
			origin('fast', 20, 300),
			origin('new', 'unreachable', 100),
			origin('slow', 8, 50),
			origin('lost', 8, 25),
			origin('unknown', 'unavailable', 75),
			origin('same', 8, 50)
		]);
		const next = analysis([
			origin('unknown', 4, 75),
			origin('new', 40, 100),
			origin('lost', 'unreachable', 25),
			origin('fast', 10, 300),
			origin('same', 8, 50),
			origin('slow', 10, 50)
		]);
		const result = compareEditImpact(previous, next);
		expect(result?.population).toBe(600);
		expect(result?.journeyChangePopulation).toEqual({
			faster: 300,
			'new-route': 100,
			slower: 50,
			'lost-route': 25,
			unchanged: 50,
			unknown: 75
		});
		expect(result?.improvedPopulation).toBe(400);
		expect(result?.worsenedPopulation).toBe(75);
		expect(result?.averageMinutesSaved).toBe(7.25);
		expect(result?.improvedOrigins.map((entry) => entry.originId)).toEqual(['new', 'fast']);
	});

	it('recomputes target access flags and durations instead of retaining stale scenario flags', () => {
		const result = compareEditImpact(
			analysis([
				origin('cross-target', 35),
				origin('within-target', 20),
				origin('new-long', 'unreachable')
			]),
			analysis([origin('cross-target', 25), origin('within-target', 10), origin('new-long', 40)])
		);
		const byId = new Map(result?.improvedOrigins.map((entry) => [entry.originId, entry]));
		expect(byId.get('cross-target')).toMatchObject({
			deltaMinutes: 10,
			newlyReachable: true,
			lostAccess: false,
			worsenedJourney: false,
			becameUnavailable: false
		});
		expect(byId.get('within-target')).toMatchObject({ deltaMinutes: 10, newlyReachable: false });
		expect(byId.get('new-long')).toMatchObject({ deltaMinutes: null, newlyReachable: false });
		expect(byId.get('cross-target')?.before.minutes).toBe(35);
	});

	it('keeps unknown and malformed journeys separate from measured improvements and losses', () => {
		const result = compareEditImpact(
			analysis([origin('no-before', 'unavailable'), origin('no-after', 8), origin('invalid', NaN)]),
			analysis([origin('no-before', 4), origin('no-after', 'unavailable'), origin('invalid', 4)])
		);
		expect(result?.journeyChangePopulation.unknown).toBe(300);
		expect(result?.improvedPopulation).toBe(0);
		expect(result?.worsenedPopulation).toBe(0);
		expect(result?.averageMinutesSaved).toBeNull();
	});

	it('uses the engine noise tolerance and retains a real improvement below one minute', () => {
		const result = compareEditImpact(
			analysis([origin('noise', 10), origin('seconds', 10)]),
			analysis([origin('noise', 9.991), origin('seconds', 9.95)])
		);
		expect(result?.journeyChangePopulation.unchanged).toBe(100);
		expect(result?.journeyChangePopulation.faster).toBe(100);
		expect(result?.improvedOrigins[0].deltaMinutes).toBeCloseTo(0.05);
	});

	it.each([
		['dataset', 'another-dataset'],
		['model', 'another-model'],
		['schema', 2]
	] as const)('rejects different %s version pins', (key, value) => {
		const previous = analysis([origin('a', 20)]);
		const next = analysis([origin('a', 10)]);
		next.versionPins = { ...next.versionPins, [key]: value };
		expect(compareEditImpact(previous, next)).toBeNull();
	});

	it.each([{ targetMinutes: 45 }, { departureMinutes: 540 }, { goal: 'education' as const }])(
		'rejects a changed comparison setting %j',
		(patch) => {
			const previous = analysis([origin('a', 20)]);
			const next = { ...analysis([origin('a', 10)]), ...patch };
			expect(compareEditImpact(previous, next)).toBeNull();
		}
	);

	it('rejects a different service date and invalid equal numeric settings', () => {
		const previous = analysis([origin('a', 20)]);
		const next = analysis([origin('a', 10)]);
		next.coverage.date = '2026-10-11';
		expect(compareEditImpact(previous, next)).toBeNull();
		for (const patch of [
			{ targetMinutes: -1 },
			{ targetMinutes: Infinity },
			{ departureMinutes: Infinity }
		])
			expect(compareEditImpact({ ...previous, ...patch }, { ...previous, ...patch })).toBeNull();
	});

	it.each(
		[
			[origin('a', 10), origin('a', 10)],
			[origin('a', 10)],
			[origin('a', 10), origin('c', 10)],
			[{ ...origin('a', 10), islandId: 'hulhumale' }, origin('b', 10)],
			[origin('a', 10, 101), origin('b', 10)]
		].map((nextOrigins) => ({ nextOrigins }))
	)('rejects duplicate, unmatched, missing or changed origins', ({ nextOrigins }) => {
		expect(
			compareEditImpact(analysis([origin('a', 20), origin('b', 20)]), analysis(nextOrigins))
		).toBeNull();
	});

	it('rejects duplicate previous origins and invalid population even when unchanged', () => {
		expect(
			compareEditImpact(
				analysis([origin('a', 20), origin('a', 20)]),
				analysis([origin('a', 10), origin('b', 10)])
			)
		).toBeNull();
		for (const population of [NaN, Infinity, -1])
			expect(
				compareEditImpact(
					analysis([origin('a', 20, population)]),
					analysis([origin('a', 10, population)])
				)
			).toBeNull();
	});

	it('does not mutate either analysis and handles an unchanged or empty proposal', () => {
		const previous = analysis([origin('a', 20)]);
		const next = analysis([origin('a', 10)]);
		const receipt = structuredClone({ previous, next });
		compareEditImpact(previous, next);
		expect({ previous, next }).toEqual(receipt);
		expect(compareEditImpact(previous, previous)?.journeyChangePopulation.unchanged).toBe(100);
		expect(compareEditImpact(analysis([]), analysis([]))?.averageMinutesSaved).toBeNull();
	});
});
