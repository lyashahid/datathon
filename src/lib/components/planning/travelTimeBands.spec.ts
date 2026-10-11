import { describe, expect, it } from 'vitest';
import type { PlanningJourney } from '#lib/planning/types.ts';
import { journeyTimeBand, TRAVEL_TIME_BANDS } from './travelTimeBands.ts';

const journey = (
	minutes: number | null,
	status: PlanningJourney['status'] = 'reachable'
): PlanningJourney => ({ status, minutes, reason: null, destinationId: null, path: [] });

describe('modeled travel-time bands', () => {
	it.each([
		[0, 'five'],
		[5, 'five'],
		[5.001, 'ten'],
		[10, 'ten'],
		[10.001, 'fifteen'],
		[15, 'fifteen'],
		[15.001, 'thirty'],
		[30, 'thirty'],
		[30.001, 'over-thirty'],
		[180, 'over-thirty']
	] as const)('classifies %s minutes as %s without rounding across a boundary', (minutes, band) => {
		expect(journeyTimeBand(journey(minutes))).toBe(band);
	});

	it.each([null, NaN, Infinity, -Infinity, -1])('keeps invalid time %s unknown', (minutes) => {
		expect(journeyTimeBand(journey(minutes))).toBe('unknown');
	});

	it('separates missing evidence from a valid search that found no route', () => {
		expect(journeyTimeBand(undefined)).toBe('unknown');
		expect(journeyTimeBand(journey(null, 'unavailable'))).toBe('unknown');
		expect(journeyTimeBand(journey(8, 'unavailable'))).toBe('unknown');
		expect(journeyTimeBand(journey(null, 'unreachable'))).toBe('unreachable');
		expect(journeyTimeBand(journey(8, 'unreachable'))).toBe('unreachable');
	});

	it('supplies one distinct legend entry for every band', () => {
		expect(TRAVEL_TIME_BANDS.map(({ id }) => id)).toEqual([
			'five',
			'ten',
			'fifteen',
			'thirty',
			'over-thirty',
			'unreachable',
			'unknown',
			'mixed'
		]);
		expect(new Set(TRAVEL_TIME_BANDS.map(({ color }) => color)).size).toBe(
			TRAVEL_TIME_BANDS.length
		);
	});
});
