import { describe, expect, it } from 'vitest';
import {
	prepareRouteVehicles,
	ROUTE_VEHICLE_SPEED_MPS,
	routeVehicleFeatures,
	type RouteVehiclePath
} from './route-vehicles.js';

const corridor: RouteVehiclePath = {
	id: 'connection',
	name: 'Fixture water corridor',
	mode: 'sea',
	geometry: {
		type: 'LineString',
		coordinates: [
			[73, 4],
			[73, 4.1],
			[73.2, 4.1]
		]
	}
};

describe('route vehicle illustrations', () => {
	it('follows every bend of the source corridor rather than cutting between endpoints', () => {
		const routes = prepareRouteVehicles([corridor]);
		let northbound = false;
		let eastbound = false;
		const travelSeconds = routes[0].length / ROUTE_VEHICLE_SPEED_MPS.sea;
		for (let sample = 0; sample < 32; sample++) {
			const feature = routeVehicleFeatures(routes, (sample / 32) * travelSeconds).features[0];
			const [longitude, latitude] = feature.geometry.coordinates;
			if (longitude === 73) {
				northbound = true;
				expect(latitude).toBeGreaterThanOrEqual(4);
				expect(latitude).toBeLessThanOrEqual(4.1);
				expect(feature.properties.bearing).toBeCloseTo(0);
			} else {
				eastbound = true;
				expect(latitude).toBe(4.1);
				expect(longitude).toBeGreaterThanOrEqual(73);
				expect(longitude).toBeLessThanOrEqual(73.2);
			}
			expect(feature.properties.movement_basis).toBe('illustrative');
			expect(feature.properties).not.toHaveProperty('observed_at');
		}
		expect(northbound && eastbound).toBe(true);
	});

	it('uses the same physical speed on short and long routes without time compression', () => {
		for (const mode of ['sea', 'air'] as const) {
			const routes = prepareRouteVehicles(
				[0.2, 2].map((degrees) => ({
					...corridor,
					id: `${mode}:${degrees}`,
					mode,
					geometry: {
						type: 'LineString',
						coordinates: [
							[73, 4],
							[73, 4 + degrees]
						]
					}
				}))
			).map((route) => ({ ...route, phase: 0.1 }));
			const before = routeVehicleFeatures(routes, 0).features;
			const after = routeVehicleFeatures(routes, 60).features;
			for (let index = 0; index < routes.length; index++) {
				// Due north: one degree of latitude follows the same spherical model as distance.
				const metres =
					(after[index].geometry.coordinates[1] - before[index].geometry.coordinates[1]) *
					((Math.PI * 6_371_000) / 180);
				expect(metres).toBeCloseTo(mode === 'sea' ? 617.333333 : 6666.666667, 4);
			}
			// A 22 km route must take minutes for aircraft and tens of minutes for ferries.
			expect(routes[0].length / ROUTE_VEHICLE_SPEED_MPS[mode]).toBeGreaterThan(
				mode === 'sea' ? 2000 : 180
			);
		}
	});

	it('keeps one independently selectable symbol per route and freezes reduced motion', () => {
		const aircraft = { ...corridor, mode: 'air' as const };
		const routes = prepareRouteVehicles([corridor, aircraft, corridor]);
		const first = routeVehicleFeatures(routes, 0, true);
		expect(first).toEqual(routeVehicleFeatures(routes, 1000, true));
		expect(first.features.map((feature) => feature.id)).toEqual([
			'sea:connection',
			'air:connection'
		]);
		expect(first.features.map((feature) => feature.properties.route_id)).toEqual([
			'connection',
			'connection'
		]);
		expect(routeVehicleFeatures(routes, 5)).not.toEqual(routeVehicleFeatures(routes, 6));
	});

	it('adds a staggered returning vehicle only when both directions are evidenced', () => {
		const paths = [
			{
				...corridor,
				id: 'leg-1',
				routeId: 'network-route',
				mode: 'air' as const,
				bidirectional: true,
				geometry: {
					type: 'LineString' as const,
					coordinates: [
						[73, 4],
						[73, 5]
					]
				}
			},
			{ ...corridor, id: 'leg-2', routeId: 'network-route', mode: 'air' as const }
		];
		const routes = prepareRouteVehicles(paths);
		const features = routeVehicleFeatures(routes, 1000).features;
		expect(features.map((feature) => feature.id)).toEqual([
			'air:leg-1',
			'air:leg-1:return',
			'air:leg-2'
		]);
		expect(features.map((feature) => feature.properties.route_id)).toEqual([
			'network-route',
			'network-route',
			'network-route'
		]);
		expect(features[0].properties.bearing).toBeCloseTo(0);
		expect(features[1].properties.bearing).toBeCloseTo(180);
		expect(features[1].properties.direction).toBe('return');
		expect(features[0].geometry).not.toEqual(features[1].geometry);
		expect(routeVehicleFeatures(prepareRouteVehicles(paths), 1000).features).toEqual(features);
	});

	it('does not bridge invalid geometry or create positions for missing or zero-length lines', () => {
		const line = (coordinates: number[][]): RouteVehiclePath => ({
			...corridor,
			geometry: { type: 'LineString', coordinates }
		});
		expect(
			prepareRouteVehicles([
				{ ...corridor, geometry: null },
				line([[73, 4]]),
				line([
					[73, 4],
					[73, 4]
				]),
				line([
					[73, 4],
					[NaN, 4.1],
					[73.2, 4.1]
				])
			])
		).toEqual([]);
		const repeated = line([
			[73, 4],
			[73, 4],
			[73, 4.1]
		]);
		expect(prepareRouteVehicles([repeated])[0].coordinates).toHaveLength(2);
	});

	it('uses exact dated sailing windows in Maldives time and falls back outside them', () => {
		const routes = prepareRouteVehicles([
			{
				...corridor,
				schedule: {
					serviceDate: '2026-10-20',
					sailings: [
						{ departure_minutes: -30, arrival_minutes: 30 },
						{ departure_minutes: 600, arrival_minutes: 660 },
						{ departure_minutes: 100, arrival_minutes: 99 }
					]
				}
			}
		]);
		const featuresAt = (clock: string) =>
			routeVehicleFeatures(routes, 1, false, Date.parse(clock)).features[0];
		const overnight = featuresAt('2026-10-20T00:00:00+05:00');
		const daytime = featuresAt('2026-10-20T10:30:00+05:00');
		expect(overnight.properties.movement_basis).toBe('schedule_estimate');
		expect(daytime.geometry).toEqual(overnight.geometry);
		expect(daytime.properties).not.toHaveProperty('observed_at');
		expect(featuresAt('2026-10-20T11:00:00+05:00').properties.movement_basis).toBe('illustrative');
		expect(featuresAt('2026-10-21T10:30:00+05:00').properties.movement_basis).toBe('illustrative');
		expect(routes[0].sailings).toHaveLength(2);
	});

	it('freezes a scheduled position for reduced motion instead of advancing it with the clock', () => {
		const routes = prepareRouteVehicles(
			[
				{
					...corridor,
					schedule: {
						serviceDate: '2026-10-20',
						sailings: [{ departure_minutes: 600, arrival_minutes: 660 }]
					}
				}
			],
			Date.parse('2026-10-20T10:30:00+05:00')
		);
		const first = routeVehicleFeatures(routes, 0, true, routes[0].preparedAt);
		expect(first.features[0].properties.movement_basis).toBe('schedule_estimate');
		expect(routeVehicleFeatures(routes, 3600, true, routes[0].preparedAt + 3_600_000)).toEqual(
			first
		);
	});
});
