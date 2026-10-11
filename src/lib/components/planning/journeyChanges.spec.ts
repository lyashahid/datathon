import { describe, expect, it } from 'vitest';
import type { OriginComparison, PlanningJourney } from '#lib/planning/types.ts';
import {
	formatJourneyTime,
	journeyChange,
	journeyChangeSummary,
	journeyMinutesSaved,
	summarizeJourneyChanges
} from './journeyChanges.ts';

function journey(minutes: number | 'unreachable' | 'unavailable'): PlanningJourney {
	return {
		status: typeof minutes === 'number' ? 'reachable' : minutes,
		minutes: typeof minutes === 'number' ? minutes : null,
		destinationId: null,
		reason: null,
		path: []
	};
}

function comparison(
	before: Parameters<typeof journey>[0],
	after: Parameters<typeof journey>[0],
	population = 100,
	originId = 'a'
): OriginComparison {
	return {
		originId,
		islandId: 'male',
		population,
		before: journey(before),
		after: journey(after),
		deltaMinutes: null,
		newlyReachable: false,
		lostAccess: false,
		worsenedJourney: false,
		becameUnavailable: false
	};
}

describe('before-and-after journey changes', () => {
	it('detects faster journeys within the same time band and access target', () => {
		const result = comparison(9, 8);
		expect(journeyChange(result)).toBe('faster');
		expect(journeyMinutesSaved(result)).toBe(1);
		expect(journeyChangeSummary(result)).toBe('1 min faster');
	});

	it('compares the actual times instead of stale delta and target-access flags', () => {
		const result = { ...comparison(8, 9), deltaMinutes: 500, newlyReachable: true };
		expect(journeyChange(result)).toBe('slower');
		expect(journeyMinutesSaved(result)).toBe(-1);
		expect(journeyChangeSummary(result)).toBe('1 min slower');
	});

	it('distinguishes new and lost routes without converting missing journeys to finite times', () => {
		const added = comparison('unreachable', 40);
		const lost = comparison(8, 'unreachable');
		expect(journeyChange(added)).toBe('new-route');
		expect(journeyChange(lost)).toBe('lost-route');
		expect(journeyMinutesSaved(added)).toBeNull();
		expect(journeyMinutesSaved(lost)).toBeNull();
		expect(journeyChangeSummary(added)).toBe('A journey is now possible');
		expect(journeyChangeSummary(lost)).toBe('No route remains');
	});

	it('never calls an unknown baseline or scenario an improvement or measured loss', () => {
		for (const result of [
			comparison('unavailable', 8),
			comparison(8, 'unavailable'),
			comparison('unavailable', 'unreachable'),
			comparison('unreachable', 'unavailable'),
			undefined
		]) {
			expect(journeyChange(result)).toBe('unknown');
			expect(journeyMinutesSaved(result)).toBeNull();
			expect(journeyChangeSummary(result)).toBe('Before-and-after evidence is incomplete');
		}
	});

	it('ignores engine-level floating-point noise but explains small measurable savings in seconds', () => {
		expect(journeyChange(comparison(10, 9.991))).toBe('unchanged');
		expect(journeyChange(comparison(10, 10.009))).toBe('unchanged');
		expect(journeyChangeSummary(comparison(10, 9.95))).toBe('3 sec faster');
		expect(journeyChange(comparison('unreachable', 'unreachable'))).toBe('unchanged');
	});

	it('rejects malformed reachable durations rather than painting them as a benefit', () => {
		for (const invalid of [NaN, Infinity, -1]) {
			expect(journeyChange(comparison(invalid, 8))).toBe('unknown');
			expect(journeyChange(comparison(8, invalid))).toBe('unknown');
			expect(journeyMinutesSaved(comparison(invalid, 8))).toBeNull();
			expect(formatJourneyTime(journey(invalid))).toBe('Not known');
		}
		expect(journeyChange({ ...comparison(8, 4), after: { ...journey(4), minutes: null } })).toBe(
			'unknown'
		);
	});

	it('formats evidence states and precise durations independently', () => {
		expect(formatJourneyTime(journey(8.24))).toBe('8.2 min');
		expect(formatJourneyTime(journey(0))).toBe('0 min');
		expect(formatJourneyTime(journey('unreachable'))).toBe('No route');
		expect(formatJourneyTime(journey('unavailable'))).toBe('Not known');
		expect(formatJourneyTime(undefined)).toBe('Not known');
	});
});

describe('journey change totals', () => {
	it('counts residents once and averages only comparable finite journeys', () => {
		const origins = [
			comparison(20, 10, 300, 'faster'),
			comparison('unreachable', 40, 100, 'new'),
			comparison(8, 10, 50, 'slower'),
			comparison(8, 'unreachable', 25, 'lost'),
			comparison('unavailable', 4, 75, 'unknown'),
			comparison(8, 8, 50, 'unchanged')
		];
		const summary = summarizeJourneyChanges(origins);
		expect(summary.population).toBe(600);
		expect(summary.journeyChangePopulation).toEqual({
			faster: 300,
			'new-route': 100,
			slower: 50,
			'lost-route': 25,
			unchanged: 50,
			unknown: 75
		});
		expect(summary.improvedPopulation).toBe(400);
		expect(summary.worsenedPopulation).toBe(75);
		expect(summary.comparablePopulation).toBe(400);
		expect(summary.averageMinutesSaved).toBe(7.25);
		expect(origins.map((origin) => origin.originId)).toEqual([
			'faster',
			'new',
			'slower',
			'lost',
			'unknown',
			'unchanged'
		]);
	});

	it('ranks newly possible routes then comparable time-saving examples without inventing an infinite saving', () => {
		const summary = summarizeJourneyChanges([
			comparison(20, 10, 100, 'fast-small'),
			comparison(9, 8, 2000, 'fast-large'),
			comparison('unreachable', 50, 200, 'new-small'),
			comparison('unreachable', 50, 300, 'new-large')
		]);
		expect(summary.improvedOrigins.map((origin) => origin.originId)).toEqual([
			'new-large',
			'new-small',
			'fast-large',
			'fast-small'
		]);
		expect(summary.comparablePopulation).toBe(2100);
		expect(summary.averageMinutesSaved).toBeCloseTo(3000 / 2100);
	});

	it('retains null average without comparable journeys and excludes invalid population counts', () => {
		const summary = summarizeJourneyChanges([
			comparison('unreachable', 40, 100),
			comparison(20, 10, 0),
			comparison(20, 10, -100),
			comparison(20, 10, NaN)
		]);
		expect(summary.population).toBe(100);
		expect(summary.improvedPopulation).toBe(100);
		expect(summary.comparablePopulation).toBe(0);
		expect(summary.averageMinutesSaved).toBeNull();
		expect(summarizeJourneyChanges([]).population).toBe(0);
	});
});
