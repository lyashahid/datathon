import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';
import {
	createPresentationStoryCache,
	PRESENTATION_ISLAND_IDS,
	PRESENTATION_ORIGIN_ID,
	PRESENTATION_LOCATIONS,
	nextPresentationFerry,
	presentationDirectBus,
	presentationFerry,
	presentationFerryLegs,
	presentationJourneyPaths
} from './presentation-story.js';
import type { SeaNetwork } from './sea-connectivity.js';
import type { SearchDirectionsResult } from './search-directions.js';

vi.mock('./api.js', () => ({ api: vi.fn() }));

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function airportJourney(): SearchDirectionsResult {
	const start = { id: 'start', coordinates: [73.5404, 4.237] };
	const boarding = { id: 'rtl:stop:602', coordinates: [73.5463, 4.2319] };
	const airport = { id: 'rtl:stop:306', coordinates: [73.527056, 4.190044] };
	return {
		status: 'ok',
		minutes: 51.396,
		warnings: [],
		segments: [
			{
				status: 'ok',
				result: {
					geometry: [],
					journey: {
						status: 'reachable',
						warnings: [],
						minutes: 51.396,
						legs: [
							{
								mode: 'walk',
								from: start,
								to: boarding,
								minutes: 13.054,
								geometry: [start.coordinates, boarding.coordinates]
							},
							{ mode: 'wait', from: boarding, to: boarding, minutes: 31.946, geometry: [] },
							{
								mode: 'bus',
								route_id: 'rtl:route:129',
								from: boarding,
								to: airport,
								minutes: 6,
								departure_minutes: 965,
								arrival_minutes: 971,
								geometry: [
									boarding.coordinates,
									[73.5440478, 4.2237807],
									[73.517, 4.17],
									airport.coordinates
								]
							},
							{
								mode: 'walk',
								from: airport,
								to: airport,
								minutes: 0.396,
								geometry: [airport.coordinates, [73.527, 4.1901]]
							}
						]
					}
				}
			}
		]
	} as unknown as SearchDirectionsResult;
}

function airportPatterns(): Parameters<typeof presentationDirectBus>[1] {
	return [
		{
			id: 'rtl:route:129:published-direction',
			route_id: 'rtl:route:129',
			stop_ids: ['rtl:stop:11306', 'rtl:stop:32000'],
			segment_geometry: [
				[
					[73.5269939, 4.1903108],
					[73.5290277, 4.1760893],
					[73.5439776, 4.2238038]
				]
			]
		}
	];
}

function sourceResponse(path: string, payload?: unknown) {
	if (path.startsWith('planning/sea-network')) return network();
	if (path.startsWith('planning/air-network'))
		return {
			airports: [
				{ iata: 'HAQ', coordinates: [73.1678, 6.7453] },
				{ iata: 'MLE', coordinates: [73.53, 4.19] }
			],
			routes: [
				{
					id: 'maldivian-mle-haq',
					from_iata: 'MLE',
					bidirectional: true,
					geometry: {
						coordinates: [
							[73.53, 4.19],
							[73.1678, 6.7453]
						]
					}
				}
			]
		};
	if (path.startsWith('planning/opportunities/'))
		return {
			features: {
				type: 'FeatureCollection',
				features: [
					{
						type: 'Feature',
						geometry: { type: 'Point', coordinates: [73.5, 1.8] },
						properties: { id: path, population: 10 }
					}
				]
			}
		};
	if (path.startsWith('planning/baseline'))
		return {
			reference_date: '2026-10-10',
			origins: path.endsWith('1442')
				? [{ id: PRESENTATION_ORIGIN_ID, lon: 73.54, lat: 4.23, population2026: 10 }]
				: []
		};
	if (path.startsWith('islands/'))
		return { island: { id: decodeURIComponent(path.split('/')[1]) } };
	if (path.startsWith('planning/connectivity?'))
		return {
			origin: { id: new URLSearchParams(path.split('?')[1]).get('origin_island_id') },
			links: [],
			terminals: { origin: [], destination: [] }
		};
	if (path === 'planning/sea-connections') {
		const request = payload as {
			origin_island_id: string;
			date: string;
			departure_minutes: number;
		};
		const origin = request.origin_island_id;
		const index = ['island:640', 'island:611', 'island:625'].indexOf(origin);
		const timetable: [string, string, number, number, string][] = [
			['island:640', 'island:611', 460, 475, 'S1C5:forward'],
			['island:611', 'island:625', 480, 490, 'S1C5:forward'],
			['island:625', 'island:684', 660, 685, 'S1C6:forward']
		];
		const [from, to, departure, arrival, route] = timetable[index];
		const operating =
			new Date(`${request.date}T00:00:00Z`).getUTCDay() !== 5 &&
			departure >= request.departure_minutes + 2;
		return {
			service_date: request.date,
			baseline: {
				destinations: [
					{
						id: to,
						journey: operating
							? {
									departure_minutes: departure,
									arrival_minutes: arrival,
									legs: [
										{
											route_id: route,
											from_island_id: from,
											to_island_id: to,
											departure_minutes: departure,
											arrival_minutes: arrival,
											proposed: false
										}
									]
								}
							: null
					}
				]
			}
		};
	}
	if (path === 'routing/journey') return airportJourney();
	if (path.startsWith('routing/patterns?')) return { patterns: airportPatterns() };
	throw new Error(`Unexpected source ${path}`);
}

const BAARAH = [73.21018, 6.81929];
const VASHAFARU = [73.16241, 6.89618];
const DHIDHDHOO = [73.11511, 6.8881];
const HANIMAADHOO = [73.17379, 6.76686];
function network(
	path = [[73.22, 6.95], BAARAH, [73.18, 6.85], VASHAFARU, [73.14, 6.89], DHIDHDHOO]
): SeaNetwork {
	return {
		routes: [
			{
				id: 'S1C5:forward',
				route_code: 'S1C5',
				crossing_minutes: 70,
				stops: [
					{ island_id: 'island:624', name: 'Kelaa', coordinates: path[0] },
					{ island_id: 'island:640', name: 'Baarah', coordinates: BAARAH },
					{ island_id: 'island:611', name: 'Vashafaru', coordinates: VASHAFARU },
					{ island_id: 'island:625', name: 'Dhidhdhoo', coordinates: DHIDHDHOO }
				],
				qualifications: ['Published timetable snapshot; actual sailing operation is unconfirmed.'],
				pressure: { departures_per_week: 6 },
				geometry: { type: 'LineString', coordinates: path }
			},
			{
				id: 'S1C6:forward',
				route_code: 'S1C6',
				crossing_minutes: 25,
				stops: [
					{ island_id: 'island:625', name: 'Dhidhdhoo', coordinates: DHIDHDHOO },
					{ island_id: 'island:684', name: 'Hanimaadhoo', coordinates: HANIMAADHOO }
				],
				qualifications: ['Modeled corridor; navigable channels and berth access are unverified.'],
				pressure: { departures_per_week: 6 },
				geometry: { type: 'LineString', coordinates: [DHIDHDHOO, [73.15, 6.8], HANIMAADHOO] }
			}
		]
	} as SeaNetwork;
}

describe('presentation evidence', () => {
	let cache: ReturnType<typeof createPresentationStoryCache>;
	beforeEach(() => {
		vi.mocked(api).mockReset();
		cache = createPresentationStoryCache();
	});
	it('uses three ordered retained ferry corridors without reversing direction or inventing berths', () => {
		const legs = presentationFerryLegs(network());
		expect(legs.map((leg) => [leg.fromIslandId, leg.toIslandId])).toEqual([
			['island:640', 'island:611'],
			['island:611', 'island:625'],
			['island:625', 'island:684']
		]);
		expect(legs[0].geometry).toEqual([BAARAH, [73.18, 6.85], VASHAFARU]);
		expect(legs[1].geometry).toEqual([VASHAFARU, [73.14, 6.89], DHIDHDHOO]);
		expect(legs[2].geometry.at(-1)).toEqual(HANIMAADHOO);
		expect(legs.every((leg) => !leg.schematic && leg.sourceWeeklySailings === 6)).toBe(true);
		expect(legs[0].qualification).toContain('actual sailing operation is unconfirmed');
		expect(legs[2].qualification).toContain('navigable channels');
		expect(legs.every((leg) => leg.minutes == null)).toBe(true);
		expect(PRESENTATION_LOCATIONS.hanimaadhoo.id).toBe('island:684');
	});
	it('does not substitute a nearby geometry point for a missing terminal or shift scene legs', () => {
		const value = network();
		value.routes[0].geometry!.coordinates[1] = [73.211, 6.81929];
		expect(presentationFerry(value)).toBeNull();
		expect(presentationFerryLegs(value)).toEqual([]);
	});
	it('does not reverse the published ferry direction to create a connection', () => {
		const value = network();
		value.routes[0].stops.reverse();
		expect(presentationFerry(value)).toBeNull();
	});
	it('replaces only the airport road display and preserves dated R9 timing and walking', () => {
		const journey = airportJourney();
		const before = structuredClone(journey);
		const direct = presentationDirectBus(journey, airportPatterns());
		expect(direct.schematic).toBe(true);
		expect(direct.qualification).toContain('directional road access is incomplete');
		const legs = direct.journey.segments[0].result!.journey!.legs;
		expect(legs[0]).toEqual(journey.segments[0].result!.journey!.legs[0]);
		expect(legs[1]).toEqual(journey.segments[0].result!.journey!.legs[1]);
		expect(legs[2]).toMatchObject({
			minutes: 6,
			departure_minutes: 965,
			arrival_minutes: 971,
			distance_m: null
		});
		expect(direct.journey.minutes).toBe(51.396);
		expect(legs[2].geometry).not.toContainEqual([73.517, 4.17]);
		expect(legs[2].geometry).toContainEqual([73.5290277, 4.1760893]);
		expect(direct.journey.segments[0].result!.geometry).not.toContainEqual([73.517, 4.17]);
		expect(
			presentationJourneyPaths(direct.journey).find((path) => path.mode === 'bus')?.coordinates
		).toEqual(legs[2].geometry);
		expect(journey).toEqual(before);
	});
	it('does not substitute a schematic airport road for unavailable or unrelated journeys', () => {
		const journey = airportJourney();
		journey.segments[0].status = 'unreachable';
		expect(presentationDirectBus(journey, airportPatterns()).schematic).toBe(false);
		journey.segments[0].status = 'ok';
		journey.segments[0].result!.journey!.legs[2].route_id = 'another-service';
		expect(presentationDirectBus(journey, airportPatterns()).schematic).toBe(false);
	});
	it('includes the next-day departure and chronological waits without changing the captured bus itinerary', async () => {
		vi.mocked(api).mockImplementation(async (path, payload) => sourceResponse(path, payload));
		const story = await cache.load(new AbortController().signal);
		expect(story.travelStart).toEqual({ date: '2026-10-10', minutes: 480 });
		expect(story.ferryLegs.map((leg) => leg.minutes)).toEqual([15, 10, 25]);
		expect(story.ferryLegs.map((leg) => leg.serviceDate)).toEqual([
			'2026-10-11',
			'2026-10-11',
			'2026-10-11'
		]);
		expect(story.ferryLegs.map((leg) => leg.waitMinutes)).toEqual([1420, 5, 170]);
		expect(story.ferryLegs.map((leg) => leg.elapsedMinutes)).toEqual([1435, 15, 195]);
		expect(story.ferryLegs.map((leg) => [leg.departure, leg.arrival])).toEqual([
			[460, 475],
			[480, 490],
			[660, 685]
		]);
		expect(story.ferryLegs[1].qualification).toContain('5-minute dwell');
		expect(story.ferryLegs[2].qualification).toContain('170-minute connection wait');
		expect(story.timing.ferry).toMatchObject({ minutes: 1645, basis: 'captured_timetable' });
		expect(story.timing.connection).toMatchObject({
			minutes: 90,
			basis: 'presentation_estimate',
			sourceUrl: 'https://maldivian.aero/plan-and-book/online-check-in.html'
		});
		expect(story.timing.connection.qualification).toContain('Presentation assumptions');
		expect(story.timing.connection.qualification).toContain('20 minutes');
		expect(story.timing.connection.qualification).toContain('70-minute');
		expect(story.timing.connection.qualification).toContain('at least one hour');
		expect(story.timing.connection.qualification).toContain('actual flight wait is unknown');
		expect(story.timing.flight).toMatchObject({
			minutes: 45,
			basis: 'published_estimate',
			sourceUrl: 'https://maldivian.aero/destinations/hanimaadhoo.html'
		});
		expect(story.timing.flight.qualification).toContain('reverse connection');
		expect(story.timing.arrival.minutes).toBe(1780);
		expect(story.timing.arrival.qualification).toContain('not a confirmed flight connection');
		expect(story.timing.pickup.minutes).toBe(51.396);
		expect(story.journeyGeometrySchematic).toBe(true);
		expect(
			vi.mocked(api).mock.calls.find(([path]) => path === 'routing/journey')?.[1]
		).toMatchObject({
			route_ids: ['rtl:route:129'],
			service_date: '2026-10-10',
			departure_minutes: 920
		});
		expect(
			vi
				.mocked(api)
				.mock.calls.filter(([path]) => path === 'planning/sea-connections')
				.map(([, body]) => body)
		).toEqual([
			{
				origin_island_id: 'island:640',
				date: '2026-10-10',
				departure_minutes: 480,
				budget_minutes: 120,
				max_transfers: 0
			},
			{
				origin_island_id: 'island:640',
				date: '2026-10-11',
				departure_minutes: 0,
				budget_minutes: 120,
				max_transfers: 0
			},
			{
				origin_island_id: 'island:611',
				date: '2026-10-11',
				departure_minutes: 475,
				budget_minutes: 120,
				max_transfers: 0
			},
			{
				origin_island_id: 'island:625',
				date: '2026-10-11',
				departure_minutes: 490,
				budget_minutes: 120,
				max_transfers: 0
			}
		]);
	});
	it('normalizes readiness into the next date and respects Friday suspension before a Saturday sailing', async () => {
		vi.mocked(api).mockImplementation(async (path, payload) => sourceResponse(path, payload));
		const ferry = await nextPresentationFerry(
			presentationFerry(network())!,
			{ date: '2026-10-08', minutes: 1860 },
			new AbortController().signal
		);
		expect(ferry).toMatchObject({
			serviceDate: '2026-10-10',
			departure: 460,
			arrival: 475,
			waitMinutes: 1480,
			minutes: 15,
			elapsedMinutes: 1495
		});
		expect(vi.mocked(api).mock.calls.map(([, body]) => body)).toEqual([
			{
				origin_island_id: 'island:640',
				date: '2026-10-09',
				departure_minutes: 420,
				budget_minutes: 120,
				max_transfers: 0
			},
			{
				origin_island_id: 'island:640',
				date: '2026-10-10',
				departure_minutes: 0,
				budget_minutes: 120,
				max_transfers: 0
			}
		]);
	});
	it('preserves a confirmed first crossing but leaves later waits and total unknown after a source failure', async () => {
		vi.mocked(api).mockImplementation(async (path, payload) => {
			if (
				path === 'planning/sea-connections' &&
				(payload as { origin_island_id: string }).origin_island_id === 'island:611'
			)
				throw new Error('Connection timetable unavailable');
			return sourceResponse(path, payload);
		});
		const story = await cache.load(new AbortController().signal);
		expect(story.ferryLegs[0]).toMatchObject({ waitMinutes: 1420, elapsedMinutes: 1435 });
		expect(
			story.ferryLegs
				.slice(1)
				.every((leg) => leg.waitMinutes === null && leg.elapsedMinutes === null)
		).toBe(true);
		expect(story.timing.ferry.minutes).toBeNull();
		expect(story.timing.arrival.minutes).toBeNull();
		expect(story.timing.pickup.minutes).toBe(51.396);
		expect(story.errors['ferryTiming:1']).toBe('Connection timetable unavailable');
		expect(
			vi.mocked(api).mock.calls.filter(([path]) => path === 'planning/sea-connections')
		).toHaveLength(3);
	});
	it('bounds missing timetable lookahead and does not substitute route crossing estimates for unknown waits', async () => {
		vi.mocked(api).mockImplementation(async (path, payload) => {
			if (path === 'planning/sea-connections')
				return { baseline: { destinations: [{ id: 'island:611', journey: null }] } };
			return sourceResponse(path, payload);
		});
		const story = await cache.load(new AbortController().signal);
		expect(story.ferryLegs.every((leg) => leg.minutes === null && leg.waitMinutes === null)).toBe(
			true
		);
		expect(story.timing.arrival.minutes).toBeNull();
		expect(story.errors['ferryTiming:0']).toContain('next seven days');
		const requests = vi
			.mocked(api)
			.mock.calls.filter(([path]) => path === 'planning/sea-connections');
		expect(requests).toHaveLength(8);
		expect(requests.at(-1)?.[1]).toMatchObject({ date: '2026-10-17' });
	});
	it('does not fall back to the Malé bus geometry when its direct display corridor is missing', async () => {
		vi.mocked(api).mockImplementation(async (path, payload) =>
			path.startsWith('routing/patterns?') ? { patterns: [] } : sourceResponse(path, payload)
		);
		const story = await cache.load(new AbortController().signal);
		expect(story.journey).toBeNull();
		expect(story.journeyPaths.every((path) => path.mode !== 'bus')).toBe(true);
		expect(story.timing.pickup.minutes).toBeNull();
		expect(story.errors.journeyGeometry).toContain('no Malé detour');
		expect(story.flight).not.toBeNull();
	});
	it('keeps confirmed bus and walking shapes separate across waits and failed legs', () => {
		const journey = {
			status: 'partial',
			segments: [
				{
					status: 'ok',
					result: {
						journey: {
							status: 'reachable',
							legs: [
								{
									mode: 'walk',
									geometry: [
										[73.54, 4.23],
										[73.541, 4.23]
									]
								},
								{
									mode: 'wait',
									geometry: [
										[73.541, 4.23],
										[73.541, 4.23]
									]
								},
								{
									mode: 'bus',
									geometry: [
										[73.542, 4.23],
										[73.527, 4.19]
									]
								}
							]
						}
					}
				},
				{
					status: 'unreachable',
					result: {
						journey: {
							legs: [
								{
									mode: 'walk',
									geometry: [
										[73.527, 4.19],
										[73.52, 4.19]
									]
								}
							]
						}
					}
				}
			]
		} as SearchDirectionsResult;
		expect(presentationJourneyPaths(journey)).toEqual([
			{
				mode: 'walk',
				coordinates: [
					[73.54, 4.23],
					[73.541, 4.23]
				]
			},
			{
				mode: 'bus',
				coordinates: [
					[73.542, 4.23],
					[73.527, 4.19]
				]
			}
		]);
	});
	it('retains an available flight when other sections fail, without inventing journeys', async () => {
		vi.mocked(api).mockImplementation(async (path) => {
			if (path.startsWith('planning/air-network'))
				return {
					airports: [
						{ iata: 'HAQ', coordinates: [73.1678, 6.7453] },
						{ iata: 'MLE', coordinates: [73.53, 4.19] }
					],
					routes: [
						{
							id: 'maldivian-mle-haq',
							from_iata: 'MLE',
							bidirectional: true,
							geometry: {
								coordinates: [
									[73.53, 4.19],
									[73.4, 3],
									[73.1678, 6.7453]
								]
							}
						}
					]
				};
			throw new Error('Source unavailable');
		});
		const story = await cache.load(new AbortController().signal);
		expect(story.flightGeometry).toEqual([
			[73.1678, 6.7453],
			[73.4, 3],
			[73.53, 4.19]
		]);
		expect(story.errors).toMatchObject({
			ferry: 'Source unavailable',
			access: 'Source unavailable',
			baseline: 'Source unavailable'
		});
		expect(story.journey).toBeNull();
	});
	it('does not emit stale progressive updates after exit', async () => {
		const active = new AbortController();
		active.abort();
		vi.mocked(api).mockRejectedValue(new Error('Aborted'));
		const update = vi.fn();
		await expect(cache.load(active.signal, update)).rejects.toBeDefined();
		expect(update).not.toHaveBeenCalled();
		expect(api).not.toHaveBeenCalled();
	});
	it('shares prewarm and multiple presenters without loading a closer-stop proposal', async () => {
		vi.mocked(api).mockImplementation(async (path, payload) => sourceResponse(path, payload));
		const warm = cache.warm();
		expect(cache.warm()).toBe(warm);
		const updates = vi.fn();
		const first = cache.load(new AbortController().signal, updates);
		const second = cache.load(new AbortController().signal);
		const story = await warm;
		expect(await first).toBe(story);
		expect(await second).toBe(story);
		const calls = vi.mocked(api).mock.calls.length;
		expect(await cache.load(new AbortController().signal)).toBe(story);
		expect(vi.mocked(api).mock.calls).toHaveLength(calls);
		for (const id of PRESENTATION_ISLAND_IDS) {
			expect(story.islandData[id].profile?.island.id).toBe(id);
			expect(story.islandData[id].connectivity?.origin.id).toBe(id);
			expect(story.islandData[id].gaps.features).toHaveLength(1);
			expect(story.islandData[id].loading).toBe(false);
			expect(
				vi
					.mocked(api)
					.mock.calls.filter(([path]) => path === `islands/${encodeURIComponent(id)}/profile`)
			).toHaveLength(1);
		}
		expect(vi.mocked(api).mock.calls.filter(([path]) => path === 'routing/journey')).toHaveLength(
			1
		);
		for (const path of ['planning/bus-connection', 'planning/evaluate'])
			expect(vi.mocked(api).mock.calls.some(([called]) => called === path)).toBe(false);
		expect(updates).toHaveBeenCalled();
	});
	it('publishes the first island heatmap and networks while the airport journey source is pending', async () => {
		const held = deferred<unknown>();
		vi.mocked(api).mockImplementation(async (path, payload) => {
			if (path === 'planning/baseline?island_id=island%3A1442') return held.promise;
			return sourceResponse(path, payload);
		});
		const updates = vi.fn();
		const load = cache.load(new AbortController().signal, updates);
		await vi.waitFor(() =>
			expect(
				updates.mock.calls.some(
					([story]) =>
						story.islandData['island:640'].gaps.features.length > 0 &&
						story.ferryLegs.length === 3 &&
						story.flight
				)
			).toBe(true)
		);
		await vi.waitFor(() =>
			expect(vi.mocked(api).mock.calls.some(([path]) => path === 'planning/sea-connections')).toBe(
				true
			)
		);
		expect(vi.mocked(api).mock.calls.some(([path]) => path === 'routing/journey')).toBe(false);
		held.resolve(sourceResponse('planning/baseline?island_id=island%3A1442'));
		await load;
	});
	it('detaches a cancelled presenter without cancelling prewarming or another subscriber', async () => {
		const held = deferred<unknown>();
		let requestSignal: AbortSignal | undefined;
		vi.mocked(api).mockImplementation(async (path, payload, signal) => {
			if (path.startsWith('planning/air-network')) {
				requestSignal = signal;
				return held.promise;
			}
			return sourceResponse(path, payload);
		});
		const warm = cache.warm();
		const active = new AbortController();
		const cancelledUpdates = vi.fn();
		const cancelled = cache.load(active.signal, cancelledUpdates);
		const remaining = cache.load(new AbortController().signal);
		active.abort();
		await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
		const count = cancelledUpdates.mock.calls.length;
		expect(requestSignal?.aborted).toBe(false);
		held.resolve(sourceResponse('planning/air-network'));
		const story = await warm;
		expect(await remaining).toBe(story);
		expect(story.flight).not.toBeNull();
		expect(cancelledUpdates).toHaveBeenCalledTimes(count);
	});
	it('keeps available island layers when a source fails and retries after the failure cache expires', async () => {
		let time = 100;
		cache = createPresentationStoryCache({ now: () => time, ttlMs: 1000, failureTtlMs: 10 });
		let failing = true;
		vi.mocked(api).mockImplementation(async (path, payload) => {
			if (failing && path === 'planning/opportunities/island%3A684')
				throw new Error('Gap source offline');
			return sourceResponse(path, payload);
		});
		const first = await cache.warm();
		expect(first.islandData['island:684'].error).toBe('Gap source offline');
		expect(first.islandData['island:684'].profile?.island.id).toBe('island:684');
		expect(first.islandData['island:640'].gaps.features).toHaveLength(1);
		const count = vi.mocked(api).mock.calls.length;
		expect(await cache.warm()).toBe(first);
		expect(vi.mocked(api).mock.calls).toHaveLength(count);
		failing = false;
		time += 11;
		const retried = await cache.warm();
		expect(retried.islandData['island:684'].error).toBeNull();
		expect(retried.islandData['island:684'].gaps.features).toHaveLength(1);
		expect(retried).not.toBe(first);
	});
	it('refreshes successful completed models only after their cache lifetime', async () => {
		let time = 100;
		cache = createPresentationStoryCache({ now: () => time, ttlMs: 1000 });
		vi.mocked(api).mockImplementation(async (path, payload) => sourceResponse(path, payload));
		const first = await cache.warm();
		expect(first.errors).toEqual({});
		time += 999;
		expect(await cache.warm()).toBe(first);
		time += 1;
		expect(await cache.warm()).not.toBe(first);
		expect(vi.mocked(api).mock.calls.filter(([path]) => path === 'routing/journey')).toHaveLength(
			2
		);
	});
	it('retries a failed completed story immediately while sharing concurrent retries and success', async () => {
		let failing = true;
		vi.mocked(api).mockImplementation(async (path, payload) => {
			if (failing && path === 'planning/opportunities/island%3A684')
				throw new Error('Gap source offline');
			return sourceResponse(path, payload);
		});
		const failed = await cache.warm();
		expect(failed.islandData['island:684'].error).toBe('Gap source offline');
		failing = false;
		const updates = vi.fn();
		const first = cache.retryFailed(new AbortController().signal, updates);
		const second = cache.retryFailed(new AbortController().signal);
		const recovered = await first;
		expect(await second).toBe(recovered);
		expect(recovered.errors).toEqual({});
		expect(recovered).not.toBe(failed);
		expect(updates).toHaveBeenCalled();
		expect(
			vi.mocked(api).mock.calls.filter(([path]) => path === 'planning/opportunities/island%3A684')
		).toHaveLength(2);
		const count = vi.mocked(api).mock.calls.length;
		expect(await cache.retryFailed(new AbortController().signal)).toBe(recovered);
		expect(vi.mocked(api).mock.calls).toHaveLength(count);
	});
	it('does not let an aborted retry discard a failed cache entry', async () => {
		vi.mocked(api).mockRejectedValue(new Error('Source offline'));
		const failed = await cache.warm();
		const count = vi.mocked(api).mock.calls.length;
		const active = new AbortController();
		active.abort();
		await expect(cache.retryFailed(active.signal)).rejects.toMatchObject({ name: 'AbortError' });
		expect(await cache.warm()).toBe(failed);
		expect(vi.mocked(api).mock.calls).toHaveLength(count);
	});
});
it('does not animate an unavailable itinerary even when its segment reports ok', () => {
	const journey = {
		status: 'unreachable',
		segments: [
			{
				status: 'ok',
				result: {
					journey: {
						status: 'unavailable',
						legs: [
							{
								mode: 'walk',
								geometry: [
									[73.54, 4.23],
									[73.53, 4.19]
								]
							}
						]
					}
				}
			}
		]
	} as SearchDirectionsResult;
	expect(presentationJourneyPaths(journey)).toEqual([]);
});
