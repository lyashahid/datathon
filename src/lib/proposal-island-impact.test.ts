import { describe, expect, it } from 'vitest';
import { islandServiceChanges } from './proposal-island-impact.js';
import type { PlanningIslandImpact, TransportConnectivitySummary } from './proposal-review.js';
import type { TransportConnectionImpact, TransportLineImpact } from './transport-impact.js';

const connectivity: TransportConnectivitySummary = {
	service_date: '2026-10-20',
	lines: [],
	inter_island_lines: 0,
	ferry_lines: 0,
	islands_connected: [],
	qualification: 'Dated service model'
};
const connection = (from: string, to: string): TransportConnectionImpact => ({
	id: `${from}:${to}`,
	mode: 'ferry',
	from_island_id: from,
	to_island_id: to,
	from_island_name: from,
	to_island_name: to,
	change: 'added',
	before: null,
	after: { departure_count: 6, expected_wait_minutes: 30, crossing_minutes: 20 }
});
const localBus: TransportLineImpact = {
	id: 'bus:outbound',
	route_id: 'bus:route',
	name: 'Phase 3 feeder',
	mode: 'bus',
	island_ids: ['island:1442'],
	change: 'added',
	before: null,
	after: { departure_count: 12, crossing_minutes: 8 }
};
const island = (identity: string): PlanningIslandImpact => ({
	island_id: identity,
	island_name: identity,
	status: 'partial',
	summary: { gained_residents: 0 },
	transport_connectivity: {
		before: connectivity,
		after: connectivity,
		impact: {
			connections: [
				connection('island:1442', 'island:1380'),
				connection('island:1380', 'island:1442'),
				connection('island:1', 'island:2')
			],
			lines: [
				localBus,
				{ ...localBus, id: 'bus:return' },
				{
					...localBus,
					id: 'ferry:outbound',
					mode: 'ferry',
					island_ids: ['island:1442', 'island:1380']
				},
				{ ...localBus, id: 'bridge', island_ids: ['island:1442', 'island:1443'] }
			]
		}
	}
});

describe('island proposal service outcomes', () => {
	it('shows one departing ferry direction and local bus timetables without counting route lines twice', () => {
		const rows = islandServiceChanges(island('island:1442'));
		expect(rows.map((row) => row.id)).toEqual([
			'connection:island:1442:island:1380',
			'line:bus:outbound',
			'line:bus:return'
		]);
		expect(rows[0]).toMatchObject({ before: null, after: { departure_count: 6 } });
	});
	it('assigns the return ferry benefit to the destination island without copying Hulhumalé bus outcomes', () => {
		const rows = islandServiceChanges(island('island:1380'));
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ name: 'To island:1442', mode: 'ferry' });
	});
	it('preserves service reductions instead of showing gains only', () => {
		const impact = island('island:1442');
		impact.transport_connectivity!.impact!.connections = [
			{
				...connection('island:1442', 'island:1380'),
				change: 'removed',
				before: { departure_count: 6, expected_wait_minutes: 30 },
				after: null
			}
		];
		expect(islandServiceChanges(impact)[0]).toMatchObject({
			before: { departure_count: 6 },
			after: null
		});
	});
	it('does not infer service changes from unavailable timetable evidence', () => {
		const impact = island('island:1380');
		delete impact.transport_connectivity;
		expect(islandServiceChanges(impact)).toEqual([]);
	});
});
