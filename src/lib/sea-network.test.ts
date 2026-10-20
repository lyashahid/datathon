import { describe, expect, it } from 'vitest';
import type { Feature, LineString } from 'geojson';
import {
	seaColors,
	seaNetworkMapState,
	seaPressureColors,
	type SeaMapState,
	type SeaNetwork,
	type SeaRoute,
	type SeaServicePressure
} from './sea-connectivity.js';

function pressure(level: SeaServicePressure['level']): SeaServicePressure {
	return {
		level,
		label: `Estimated pressure ${level}`,
		explanation: 'Synthetic fixture: population relative to published weekly departures.',
		population: 2400,
		population_year: 2026,
		departures_per_week: level === 'unknown' ? null : 12,
		residents_per_weekly_departure: level === 'unknown' ? null : 200,
		headway_minutes: null,
		capacity: null,
		capacity_basis: null,
		basis: level === 'unknown' ? 'unknown' : 'population_per_weekly_departure'
	};
}

function route(id: string, changes: Partial<SeaRoute> = {}): SeaRoute {
	return {
		id,
		name: `Fixture ${id}`,
		operator: 'Fixture operator',
		evidence: 'dated_service',
		from_island_id: 'island:1',
		to_island_id: 'island:2',
		stop_island_ids: ['island:1', 'island:2'],
		stops: [
			{ id: 'terminal:1', name: 'Fixture port A', island_id: 'island:1', coordinates: [73, 4] },
			{ id: 'terminal:2', name: 'Fixture port B', island_id: 'island:2', coordinates: [73.1, 4.1] }
		],
		departure_count: 1,
		departures: [480],
		crossing_minutes: 30,
		source_ids: ['source:network'],
		valid_from: '2026-10-01',
		valid_until: null,
		current_as_of: '2026-10-17',
		validity_status: 'current',
		timing_status: 'complete_timetable',
		qualifications: ['Fixture published recurrence; occupancy is unknown.'],
		geometry: {
			type: 'LineString',
			coordinates: [
				[73, 4],
				[73.1, 4.1]
			]
		},
		...changes
	};
}

function line(item: SeaRoute, properties: Record<string, unknown> = {}): Feature<LineString> {
	return {
		type: 'Feature',
		id: item.id,
		geometry: item.geometry!,
		properties: {
			kind: 'sea_route',
			route_id: item.id,
			name: item.name,
			evidence: item.evidence,
			...properties
		}
	};
}

function network(routes: SeaRoute[]): SeaNetwork {
	return {
		service_date: '2026-10-19',
		timezone: 'Indian/Maldives',
		routes,
		map_features: {
			type: 'FeatureCollection',
			features: [
				...routes.filter((item) => item.geometry).map((item) => line(item)),
				{
					type: 'Feature',
					id: 'sea-port:terminal:1',
					geometry: { type: 'Point', coordinates: [73, 4] },
					properties: { kind: 'sea_terminal', terminal_id: 'terminal:1', name: 'Fixture port A' }
				}
			]
		},
		sources: [{ id: 'source:network', title: 'Fixture network publication', url: null }],
		coverage: { scope: 'nationwide_retained_evidence', route_count: routes.length }
	};
}

function inspection(routes: SeaRoute[], changes: Partial<SeaMapState> = {}): SeaMapState {
	return {
		features: {
			type: 'FeatureCollection',
			features: routes.map((item) => line(item, { selected: true, dimmed: true }))
		},
		routes,
		destinations: [
			{ id: 'island:2', status: 'direct', within_budget: true, newly_reachable: false }
		],
		selectedDestinationId: 'island:2',
		selectedRouteId: routes[0]?.id ?? '',
		originIslandId: 'island:1',
		mode: 'baseline',
		...changes
	};
}

describe('national sea network and island inspection', () => {
	it('keeps the full network and recorded ports when an island inspector selects only one route', () => {
		const local = route('route:local', { pressure: pressure('low') });
		const remote = route('route:remote', { pressure: pressure('high') });
		const national = network([local, remote]);
		const original = structuredClone(national);
		const state = seaNetworkMapState(national, inspection([local]));

		expect(state.features.features.map((feature) => feature.id)).toEqual([
			'route:local',
			'route:remote',
			'sea-port:terminal:1'
		]);
		expect(state.features.features[0].properties).toMatchObject({ selected: true, dimmed: false });
		expect(state.features.features[1].properties).toMatchObject({ selected: false, dimmed: false });
		expect(state.features.features[1].geometry).toEqual(remote.geometry);
		expect(state.destinations).toEqual(inspection([local]).destinations);
		expect(state.selectedDestinationId).toBe('island:2');
		expect(national).toEqual(original);

		const cleared = seaNetworkMapState(national, null, 'island:3');
		expect(cleared.features.features).toHaveLength(3);
		expect(cleared.features.features.every((feature) => !feature.properties?.selected)).toBe(true);
		expect(cleared.originIslandId).toBe('island:3');
	});

	it('uses every qualified pressure color and leaves missing evidence unknown after inspection', () => {
		const levels = ['low', 'medium', 'high', 'unknown'] as const;
		const routes = levels.map((level) => route(`route:${level}`, { pressure: pressure(level) }));
		routes.push(route('route:missing-pressure'));
		const national = network(routes);
		// The inspector's connectivity color and incomplete record cannot overwrite
		// the national population/frequency assessment.
		const selected = inspection([route('route:high', { pressure: pressure('low') })]);
		selected.features.features[0].properties!.color = seaColors.direct;
		const state = seaNetworkMapState(national, selected);

		for (const [index, level] of ([...levels, 'unknown'] as const).entries()) {
			expect(state.features.features[index].properties).toMatchObject({
				pressure_level: level,
				color: seaPressureColors[level]
			});
		}
		expect(state.routes?.find((item) => item.id === 'route:high')?.pressure?.level).toBe('high');
	});

	it('retains unmapped route records, popup evidence, sources and national coverage', () => {
		const mapped = route('route:mapped', { pressure: pressure('medium') });
		const unmapped = route('route:unmapped', {
			geometry: null,
			geometry_basis: 'missing_terminal'
		});
		const national = network([mapped, unmapped]);
		const inspected = inspection([{ ...mapped, origin_departures: [500] }], {
			serviceDate: '2026-10-19',
			sources: [
				{ id: 'source:network', title: 'Fixture network publication', url: null },
				{ id: 'source:inspection', title: 'Fixture inspector evidence', url: null }
			],
			coverage: { scope: 'selected_island' }
		});
		const state = seaNetworkMapState(national, inspected);

		expect(state.routes).toHaveLength(2);
		expect(state.routes?.find((item) => item.id === mapped.id)).toMatchObject({
			operator: mapped.operator,
			stops: mapped.stops,
			source_ids: mapped.source_ids,
			qualifications: mapped.qualifications,
			pressure: mapped.pressure,
			origin_departures: [500]
		});
		expect(state.routes?.find((item) => item.id === unmapped.id)).toEqual(unmapped);
		expect(state.serviceDate).toBe(national.service_date);
		expect(state.coverage).toEqual(national.coverage);
		expect(state.sources?.map((source) => source.id)).toEqual([
			'source:network',
			'source:inspection'
		]);
	});

	it('keeps the dated network intact while an inspector from another date is being replaced', () => {
		const baseline = route('route:dated', { pressure: pressure('medium') });
		const stale = inspection([{ ...baseline, departures: [600], origin_departures: [610] }], {
			serviceDate: '2026-10-18'
		});
		const state = seaNetworkMapState(network([baseline]), stale);
		expect(state.routes).toEqual([baseline]);
		expect(state.selectedRouteId).toBe('');
		expect(state.destinations).toEqual([]);
		expect(state.serviceDate).toBe('2026-10-19');
	});

	it('appends a scenario service while retaining each national baseline route once', () => {
		const baseline = route('route:baseline', { pressure: pressure('medium') });
		const remote = route('route:remote', { pressure: pressure('unknown') });
		const proposed = route('route:proposal', {
			evidence: 'proposal',
			timing_status: 'assumed_timetable'
		});
		const scenario = inspection([baseline, proposed], {
			mode: 'scenario',
			selectedRouteId: proposed.id
		});
		scenario.features.features[1].properties = {
			...scenario.features.features[1].properties,
			proposed: true,
			color: seaColors.proposal
		};
		const state = seaNetworkMapState(network([baseline, remote]), scenario);
		const lines = state.features.features.filter((feature) => feature.properties?.route_id);

		expect(lines.map((feature) => feature.properties!.route_id)).toEqual([
			baseline.id,
			remote.id,
			proposed.id
		]);
		expect(state.routes?.map((item) => item.id)).toEqual([baseline.id, remote.id, proposed.id]);
		expect(lines[2].properties).toMatchObject({
			proposed: true,
			selected: true,
			dimmed: false,
			color: seaColors.proposal
		});
		expect(state.mode).toBe('scenario');
		expect(state.selectedRouteId).toBe(proposed.id);
	});
});
