import { describe, expect, it } from 'vitest';
import {
	budgetUse,
	finiteValue,
	fiscalProjections,
	formatAmount,
	operationName,
	proposedFerryServiceGroups,
	type TransportConnectivitySummary
} from './proposal-review.js';

describe('decision brief arithmetic', () => {
	it('pays capital once and repeats added annual cost at each explicit horizon', () => {
		expect(fiscalProjections(25_000_000, 5_000_000)).toEqual([
			{ years: 1, capital: 25_000_000, operating: 5_000_000, total: 30_000_000 },
			{ years: 5, capital: 25_000_000, operating: 25_000_000, total: 50_000_000 },
			{ years: 10, capital: 25_000_000, operating: 50_000_000, total: 75_000_000 }
		]);
	});
	it('never converts unavailable operating evidence to a zero-cost commitment', () => {
		for (const row of fiscalProjections(100_000, null)) {
			expect(row.capital).toBe(100_000);
			expect(row.operating).toBeNull();
			expect(row.total).toBeNull();
		}
		expect(formatAmount(null)).toBe('Unavailable');
		expect(finiteValue(Number.NaN)).toBeNull();
		expect(finiteValue('100')).toBeNull();
	});
	it('preserves savings rather than clamping commitment to zero', () => {
		expect(fiscalProjections(100_000, -20_000)[2].total).toBe(-100_000);
	});
	it('handles a zero budget and unavailable budgets without an invalid chart width', () => {
		expect(budgetUse(100_000, 0)).toBe(100);
		expect(budgetUse(0, 0)).toBe(0);
		expect(budgetUse(300, 100)).toBe(100);
		expect(budgetUse(null, 100)).toBeNull();
		expect(budgetUse(100, null)).toBeNull();
	});
	it('uses a named service in the proposed site list', () => {
		expect(
			operationName({ type: 'add_service', service: { name: 'North island school bus' } })
		).toBe('North island school bus');
	});
});

describe('ferry connection report', () => {
	const line = (islands: string[], departures = 8) => ({
		id: islands.join(':'),
		name: 'Island ferry',
		mode: 'ferry',
		island_ids: islands,
		departure_count: departures,
		proposed: true,
		inter_island: true
	});
	const summary = (lines: TransportConnectivitySummary['lines']): TransportConnectivitySummary => ({
		service_date: '2026-10-10',
		lines,
		inter_island_lines: lines.length,
		ferry_lines: lines.length,
		islands_connected: ['island:1', 'island:2'],
		qualification: 'Modeled service'
	});
	it('counts one return service and its outward plus return departures', () => {
		const routes = proposedFerryServiceGroups(
			summary([line(['island:1', 'island:2']), line(['island:2', 'island:1'], 7)])
		);
		expect(routes).toHaveLength(1);
		expect(routes[0]).toMatchObject({ departures: 15, returnService: true });
	});
	it('does not label repeated outward schedules or existing ferries as a proposed return service', () => {
		const routes = proposedFerryServiceGroups(
			summary([
				line(['island:1', 'island:2']),
				line(['island:1', 'island:2']),
				{ ...line(['island:2', 'island:1']), proposed: false }
			])
		);
		expect(routes).toHaveLength(1);
		expect(routes[0]).toMatchObject({ departures: 16, returnService: false });
	});
});
