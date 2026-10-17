import { describe, expect, it } from 'vitest';
import {
	seaClock,
	seaClockMinutes,
	seaDestinations,
	seaMapState,
	seaColors,
	seaRouteEvidenceLabel,
	seaSelectionBounds,
	seaServiceDate,
	seaUniqueStrings,
	seaConnectivityRating,
	type SeaConnections,
	type SeaConnectionView,
	type SeaDestination,
	type SeaJourney,
	type SeaRoute
} from './sea-connectivity.js';

const journey: SeaJourney = {
	departure_minutes: 430,
	arrival_minutes: 470,
	total_minutes: 50,
	wait_minutes: 10,
	sailing_minutes: 40,
	legs: [
		{
			route_id: 'route:1',
			name: 'Published ferry',
			from_island_id: 'island:a',
			to_island_id: 'island:b',
			departure_minutes: 430,
			arrival_minutes: 470,
			wait_minutes: 10,
			source_ids: ['official:1'],
			proposed: false
		}
	]
};
function destination(id: string, change: Partial<SeaDestination> = {}): SeaDestination {
	return {
		id,
		name: id,
		coordinates: [73.5, 4.2],
		status: 'direct',
		route_ids: ['route:1'],
		transfers: 0,
		journey: null,
		within_budget: false,
		return_journey: null,
		return_status: 'not_requested',
		...change
	};
}
function view(destinations: SeaDestination[]): SeaConnectionView {
	return {
		destinations,
		summary: {
			direct_islands: destinations.length,
			transfer_islands: 0,
			timed_reachable_islands: 0,
			return_feasible_islands: 0,
			route_count: 0,
			departures_today: 0
		},
		routes: [],
		map_features: {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: { kind: 'sea_route', route_id: 'route:1', evidence: 'official_route' },
					geometry: {
						type: 'LineString',
						coordinates: [
							[73.4, 4.1],
							[73.5, 4.2]
						]
					}
				},
				{
					type: 'Feature',
					properties: { kind: 'sea_route', route_id: 'route:2', evidence: 'mapped_route' },
					geometry: {
						type: 'LineString',
						coordinates: [
							[73.4, 4.1],
							[73.6, 4.3]
						]
					}
				}
			]
		}
	};
}
function result(
	baseline: SeaConnectionView,
	scenario: SeaConnectionView | null = null
): SeaConnections {
	return {
		origin: { id: 'island:a', name: 'Origin', coordinates: [73.4, 4.1] },
		service_date: '2026-10-17',
		departure_minutes: 420,
		budget_minutes: 60,
		baseline,
		scenario,
		comparison: {
			newly_reachable_island_ids: ['island:b'],
			time_improved_island_ids: [],
			lost_reachable_island_ids: [],
			new_direct_island_ids: [],
			unique_destination_delta: 1
		},
		sources: [],
		coverage: { notes: [] },
		qualification: '',
		vessel_assignment: { status: 'unmatched', reason: '' }
	};
}

describe('sea connection evidence and selection', () => {
	it('rates timed reachability as unique destinations and does not turn topology into a score', () => {
		const data = view([
			destination('island:b', { journey, within_budget: true }),
			destination('island:b', { journey, within_budget: true }),
			destination('island:c', { status: 'transfer', journey, within_budget: false }),
			destination('island:d', { status: 'unverified', within_budget: true })
		]);
		expect(seaConnectivityRating(data, 60)).toMatchObject({
			reachable: 1,
			direct: 1,
			transfer: 1,
			unverified: 1
		});
		expect(seaConnectivityRating(data, 60).reason).toContain('including waiting and transfers');
	});
	it('shows unverified for historical or departure-only evidence rather than zero connectivity', () => {
		const data = view([destination('island:b', { status: 'unverified' })]);
		data.routes = [
			{ timing_status: 'complete_timetable', validity_status: 'historical' } as SeaRoute
		];
		expect(seaConnectivityRating(data, 60).reachable).toBeNull();
		expect(seaConnectivityRating(data, 60).reason).toContain(
			'check current service with the operator'
		);
		data.destinations[0].status = 'direct';
		data.routes = [{ timing_status: 'departure_only', validity_status: 'current' } as SeaRoute];
		expect(seaConnectivityRating(data, 60).reachable).toBeNull();
		expect(seaConnectivityRating(data, 60).reason).toContain('These islands are connected');
	});
	it('distinguishes no timely arrival from missing timings and identifies projected patterns', () => {
		const data = view([destination('island:b')]);
		data.routes = [
			{
				timing_status: 'complete_timetable',
				validity_status: 'current',
				projection_status: 'published_pattern_projection'
			} as SeaRoute
		];
		expect(seaConnectivityRating(data, 30)).toMatchObject({ reachable: 0, projected: true });
		expect(seaConnectivityRating(data, 30).reason).toContain('no arrival within 30 minutes');
		data.routes[0].no_scheduled_service = true;
		expect(seaConnectivityRating(data, 30).reachable).toBeNull();
	});
	it('deduplicates repeated evidence strings before rendering keyed lists', () => {
		const warning =
			'Existing mapped ferry terminal reused; berth suitability and operator permission remain unverified. No port construction is costed.';
		const warnings = [warning, warning, 'Current timing needs verification.', warning];
		expect(seaUniqueStrings(warnings)).toEqual([warning, 'Current timing needs verification.']);
		expect(warnings).toHaveLength(4);
		expect(seaUniqueStrings(undefined)).toEqual([]);
	});
	it('does not present documented topology or a missing journey as timed reachability', () => {
		const data = view([
			destination('island:topology', { within_budget: true }),
			destination('island:timed', { journey, within_budget: true }),
			destination('island:too-far', { journey, within_budget: false })
		]);
		expect(seaDestinations(data, '', 'all')).toHaveLength(3);
		expect(seaDestinations(data, '', 'timed').map((item) => item.id)).toEqual(['island:timed']);
		expect(seaMapState(result(data), 'baseline').destinations[0].within_budget).toBe(false);
	});
	it('requires an actual return journey and avoids counting duplicate destination directions', () => {
		const data = view([
			destination('island:b', { journey, return_status: 'feasible' }),
			destination('island:c', {
				journey,
				within_budget: true,
				return_status: 'feasible',
				return_journey: journey
			}),
			destination('island:c', {
				journey,
				within_budget: true,
				return_status: 'feasible',
				return_journey: journey
			})
		]);
		expect(seaDestinations(data, '', 'return').map((item) => item.id)).toEqual(['island:c']);
	});
	it('matches island names with accents and preserves unavailable timing', () => {
		const rows = seaDestinations(
			view([destination('island:male', { name: 'Malé' })]),
			'male',
			'all'
		);
		expect(rows).toHaveLength(1);
		expect(rows[0].journey).toBeNull();
	});
	it('highlights the selected journey routes without mutating the backend features', () => {
		const data = result(view([destination('island:b', { journey })]));
		const state = seaMapState(data, 'baseline', 'island:b');
		expect(state.features.features[0].properties).toMatchObject({ selected: true, dimmed: false });
		expect(state.features.features[1].properties).toMatchObject({ selected: false, dimmed: true });
		expect(data.baseline.map_features.features[0].properties?.selected).toBeUndefined();
		expect(state.features.features.at(-1)?.properties?.kind).toBe('sea_origin');
	});
	it('keeps official routes without eligible timings visibly unverified', () => {
		const data = result(view([]));
		const state = seaMapState(data, 'baseline');
		expect(state.features.features[0].properties?.color).toBe(seaColors.unverified);
		expect(state.features.features[1].properties?.color).toBe(seaColors.unverified);
		const feature = data.baseline.map_features.features[0];
		feature.properties = { ...feature.properties, evidence: 'dated_service' };
		expect(seaMapState(data, 'baseline').features.features[0].properties?.color).toBe(
			seaColors.direct
		);
	});
	it('labels historical service before its published departure details', () => {
		const route = {
			evidence: 'official_route',
			timing_status: 'departure_only',
			validity_status: 'historical'
		} as SeaRoute;
		expect(seaRouteEvidenceLabel(route)).toBe('Historical route · current service unverified');
		expect(seaRouteEvidenceLabel({ ...route, validity_status: 'current' })).toBe(
			'Published departures · crossing unverified'
		);
	});
	it('marks proposal gains only in a real scenario view', () => {
		const baseline = view([destination('island:b')]);
		const scenario = view([destination('island:b', { journey, within_budget: true })]);
		expect(seaMapState(result(baseline), 'scenario').mode).toBe('baseline');
		expect(seaMapState(result(baseline), 'scenario').destinations[0].newly_reachable).toBe(false);
		expect(seaMapState(result(baseline, scenario), 'scenario').destinations[0]).toMatchObject({
			newly_reachable: true,
			within_budget: true
		});
	});
	it('distinguishes a quicker existing connection from a newly reachable island', () => {
		const baseline = view([destination('island:b', { journey, within_budget: true })]);
		baseline.map_features.features.push({
			type: 'Feature',
			properties: { kind: 'sea_destination', island_id: 'island:b', status: 'direct' },
			geometry: { type: 'Point', coordinates: [73.5, 4.2] }
		});
		const data = result(baseline, baseline);
		data.comparison.newly_reachable_island_ids = [];
		data.comparison.time_improved_island_ids = ['island:b'];
		const state = seaMapState(data, 'scenario');
		expect(state.destinations[0]).toMatchObject({ time_improved: true, newly_reachable: false });
		expect(state.features.features[2].properties?.color).toBe(seaColors.improved);
		expect(seaMapState(data, 'baseline').destinations[0].time_improved).toBe(false);
	});
	it('fits the origin and destination when a route has no usable geometry', () => {
		const data = result(view([destination('island:b')]));
		data.baseline.routes = [{ id: 'route:1', geometry: null } as SeaRoute];
		expect(seaSelectionBounds(data.baseline, data.origin, 'island:b')).toEqual([
			[73.4, 4.1],
			[73.5, 4.2]
		]);
	});
});

describe('Maldives ferry clocks', () => {
	it('defaults the service day to Maldives time at the UTC day boundary', () => {
		expect(seaServiceDate(Date.parse('2026-10-16T20:10:00Z'))).toBe('2026-10-17');
	});
	it('preserves midnight, rejects invalid inputs, and labels next-day arrivals', () => {
		expect(seaClockMinutes('00:00')).toBe(0);
		expect(seaClockMinutes('24:00')).toBeNull();
		expect(seaClockMinutes('12:60')).toBeNull();
		expect(seaClock(0)).toBe('00:00');
		expect(seaClock(1450)).toBe('00:10 +1d');
		expect(seaClock(NaN)).toBe('Time unverified');
	});
});
