import { describe, expect, it } from 'vitest';
import {
	budgetUse,
	finiteValue,
	fiscalProjections,
	formatAmount,
	operationName,
	proposalContents,
	planningFinancialKey,
	proposedBusServiceGroups,
	proposedFerryServiceGroups,
	type PlanningReviewRequest,
	type TransportConnectivitySummary
} from './proposal-review.js';

describe('planning cost request identity', () => {
	const request: PlanningReviewRequest = {
		island_id: 'island:1443',
		operations: [{ type: 'add_school', coordinates: [73.54, 4.2] }],
		assumptions: {
			goal: 'education',
			target_minutes: 30,
			date: '2026-10-10',
			departure_minutes: 920,
			capital_budget_mvr: 30_000_000,
			annual_operating_budget_mvr: 6_000_000,
			include_origin_geometry: false,
			include_journey_geometry: false,
			include_world: false
		}
	};
	it('reuses a quote while the journey target, goal or geometry display changes', () => {
		expect(
			planningFinancialKey({
				...request,
				assumptions: {
					...request.assumptions,
					goal: 'healthcare',
					target_minutes: 10,
					include_origin_geometry: true,
					include_journey_geometry: true,
					include_world: true
				}
			})
		).toBe(planningFinancialKey(request));
	});
	it('invalidates a quote for economic, budget, schedule, operation or scope changes', () => {
		const key = planningFinancialKey(request);
		for (const assumptions of [
			{ capital_budget_mvr: 29_000_000 },
			{ annual_operating_budget_mvr: 5_000_000 },
			{ date: '2026-10-11' },
			{ departure_minutes: 900 },
			{ cost_overrides: { school_capital_mvr: 26_000_000 } },
			{ calibration_records: [{ capital_mvr: 50_000_000 }] }
		])
			expect(
				planningFinancialKey({
					...request,
					assumptions: { ...request.assumptions, ...assumptions }
				})
			).not.toBe(key);
		expect(planningFinancialKey({ ...request, operations: [] })).not.toBe(key);
		expect(planningFinancialKey({ ...request, island_id: 'island:1442' })).not.toBe(key);
	});
});

describe('decision brief arithmetic', () => {
	it('shows the combined bus stop, bus route and ferry package without counting return directions twice', () => {
		expect(
			proposalContents([
				{ type: 'add_stop', metadata: { mode: 'bus', ui_package: 'bus-route:one' } },
				{ type: 'add_service', service: { mode: 'bus', routeId: 'bus:one', id: 'outbound' } },
				{ type: 'add_service', service: { mode: 'bus', routeId: 'bus:one', id: 'return' } },
				{ type: 'use_existing_ferry_terminal', target_id: 'terminal:a' },
				{ type: 'use_existing_ferry_terminal', target_id: 'terminal:b' },
				{ type: 'use_existing_ferry_terminal', target_id: 'terminal:a' },
				{
					type: 'add_service',
					service: { mode: 'ferry' },
					metadata: { ui_package: 'ferry-service:one' }
				},
				{
					type: 'add_service',
					service: { mode: 'ferry' },
					metadata: { ui_package: 'ferry-service:one' }
				}
			])
		).toEqual({ busStops: 1, busRoutes: 1, ferryRoutes: 1, existingFerryLandings: 2 });
	});
	it('keeps distinct routes separate and never labels a ferry stop as a new bus stop', () => {
		expect(
			proposalContents([
				{ type: 'add_stop', metadata: { mode: 'ferry' } },
				{ type: 'add_service', service: { mode: 'bus', routeId: 'one' } },
				{ type: 'add_service', service: { mode: 'bus', routeId: 'two' } }
			])
		).toMatchObject({ busStops: 0, busRoutes: 2, ferryRoutes: 0 });
	});
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

describe('bus service report', () => {
	const line = (stopIds: string[], departures = 20) => ({
		id: stopIds.join(':'),
		route_id: 'proposed:local-bus',
		name: 'Neighbourhood bus',
		mode: 'bus',
		stop_ids: stopIds,
		island_ids: ['island:1442'],
		departure_count: departures,
		proposed: true,
		inter_island: false
	});
	const summary = (lines: TransportConnectivitySummary['lines']): TransportConnectivitySummary => ({
		service_date: '2026-10-10',
		lines,
		inter_island_lines: 0,
		ferry_lines: 0,
		islands_connected: ['island:1442'],
		qualification: 'Modeled service, not measured passenger demand.'
	});
	it('groups local outward and return schedules using stop order, even on the same island', () => {
		const routes = proposedBusServiceGroups(
			summary([
				line(['stop:proposal', 'stop:nearby']),
				{ ...line(['stop:nearby', 'stop:proposal'], 19), name: 'Neighbourhood bus return' }
			])
		);
		expect(routes).toHaveLength(1);
		expect(routes[0]).toMatchObject({ mode: 'bus', departures: 39, returnService: true });
	});
	it('does not turn duplicate outward schedules, loop trips or island identity into a return journey', () => {
		for (const lines of [
			[line(['stop:a', 'stop:b']), line(['stop:a', 'stop:b'])],
			[line(['stop:a', 'stop:b', 'stop:a']), line(['stop:a', 'stop:b', 'stop:a'])],
			[
				{ ...line(['stop:a', 'stop:b']), stop_ids: undefined },
				{ ...line(['stop:b', 'stop:a']), stop_ids: undefined }
			]
		])
			expect(proposedBusServiceGroups(summary(lines))[0].returnService).toBe(false);
	});
	it('keeps different routes separate and excludes existing services and ferries', () => {
		const routes = proposedBusServiceGroups(
			summary([
				line(['stop:a', 'stop:b']),
				{ ...line(['stop:b', 'stop:a']), route_id: 'another-route' },
				{ ...line(['stop:b', 'stop:a']), proposed: false },
				{ ...line(['stop:b', 'stop:a']), mode: 'ferry' }
			])
		);
		expect(routes).toHaveLength(2);
		expect(routes.every((route) => !route.returnService && route.departures === 20)).toBe(true);
		expect(proposedBusServiceGroups(undefined)).toEqual([]);
	});
});
