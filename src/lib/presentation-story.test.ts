import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';
import {
	createPresentationStoryCache,
	PRESENTATION_ISLAND_IDS,
	PRESENTATION_ORIGIN_ID,
	PRESENTATION_KADHDHOO_COAST,
	presentationDirectBus,
	presentationFerry,
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

function sourceResponse(path: string) {
	if (path.startsWith('planning/sea-network')) return network();
	if (path.startsWith('planning/air-network'))
		return {
			airports: [
				{ iata: 'KDO', coordinates: [73.52, 1.86] },
				{ iata: 'MLE', coordinates: [73.53, 4.19] }
			],
			routes: [
				{
					id: 'maldivian-mle-kdo',
					from_iata: 'MLE',
					bidirectional: true,
					geometry: {
						coordinates: [
							[73.53, 4.19],
							[73.52, 1.86]
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
	if (path === 'planning/sea-connections') return { baseline: { destinations: [] } };
	if (path === 'routing/journey') return airportJourney();
	if (path.startsWith('routing/patterns?')) return { patterns: airportPatterns() };
	if (path === 'planning/bus-connection')
		return { status: 'ready', operations: [{ type: 'add_stop' }], reasons: [] };
	if (path === 'planning/evaluate') return { origins: [], summary: {} };
	throw new Error(`Unexpected source ${path}`);
}

function network(
	path = [
		[73.2, 1.8],
		[73.39, 1.8],
		[73.4, 1.82],
		[73.5, 1.83],
		[73.54, 1.93]
	]
): SeaNetwork {
	return {
		routes: [
			{
				route_code: 'Z4R17',
				stops: [
					{ island_id: 'island:717', name: 'Maavah', coordinates: path[0] },
					{ island_id: 'island:697', name: 'Hithadhoo', coordinates: [73.39, 1.8] },
					{ island_id: 'island:704', name: 'Fonadhoo', coordinates: [73.5, 1.83] },
					{ island_id: 'island:692', name: 'Gan', coordinates: path.at(-1) }
				],
				geometry: { type: 'LineString', coordinates: path }
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
	it('marks the direct Kadhdhoo crossing as schematic and keeps its source corridor separate', () => {
		const ferry = presentationFerry(network());
		expect(ferry?.geometry).toEqual([[73.39, 1.8], PRESENTATION_KADHDHOO_COAST]);
		expect(ferry?.to).toBe('Kadhdhoo Airport coast');
		expect(ferry?.transferRequired).toBe(false);
		expect(ferry?.schematic).toBe(true);
		expect(ferry?.qualification).toContain('No public ferry berth');
		expect(ferry?.route.stops.at(-2)?.name).toBe('Fonadhoo');
		expect(ferry?.minutes).toBeNull();
	});
	it('does not substitute a nearby geometry point for a missing terminal', () => {
		expect(
			presentationFerry(
				network([
					[73.2, 1.8],
					[73.391, 1.8],
					[73.5, 1.83],
					[73.54, 1.93]
				])
			)
		).toBeNull();
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
	it('keeps missing estimates unavailable and sums only separately qualified journey times', async () => {
		vi.mocked(api).mockImplementation(async (path) => {
			if (path === 'planning/sea-connections')
				return {
					baseline: {
						destinations: [
							{
								id: 'island:704',
								journey: {
									departure_minutes: 455,
									arrival_minutes: 510,
									legs: [{ departure_minutes: 475 }]
								}
							}
						]
					}
				};
			return sourceResponse(path);
		});
		const story = await cache.load(new AbortController().signal);
		expect(story.ferry?.sourceMinutes).toBe(35);
		expect(story.ferry?.departure).toBeNull();
		expect(story.ferry?.arrival).toBeNull();
		expect(story.timing.flight).toMatchObject({ minutes: 50, basis: 'published_estimate' });
		expect(story.timing.arrival.minutes).toBe(story.timing.ferry.minutes! + 50);
		expect(story.timing.arrival.qualification).toContain('Excludes ferry waiting');
		expect(story.timing.pickup.minutes).toBe(51.396);
		expect(story.journeyGeometrySchematic).toBe(true);
		expect(
			vi.mocked(api).mock.calls.find(([path]) => path === 'routing/journey')?.[1]
		).toMatchObject({ route_ids: ['rtl:route:129'] });
	});
	it('does not fall back to the Malé bus geometry when its direct display corridor is missing', async () => {
		vi.mocked(api).mockImplementation(async (path) =>
			path.startsWith('routing/patterns?') ? { patterns: [] } : sourceResponse(path)
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
						{ iata: 'KDO', coordinates: [73.52, 1.86] },
						{ iata: 'MLE', coordinates: [73.53, 4.19] }
					],
					routes: [
						{
							id: 'maldivian-mle-kdo',
							from_iata: 'MLE',
							bidirectional: true,
							geometry: {
								coordinates: [
									[73.53, 4.19],
									[73.4, 3],
									[73.52, 1.86]
								]
							}
						}
					]
				};
			throw new Error('Source unavailable');
		});
		const story = await cache.load(new AbortController().signal);
		expect(story.flightGeometry).toEqual([
			[73.52, 1.86],
			[73.4, 3],
			[73.53, 4.19]
		]);
		expect(story.errors).toMatchObject({
			ferry: 'Source unavailable',
			access: 'Source unavailable',
			baseline: 'Source unavailable'
		});
		expect(story.journey).toBeNull();
		expect(story.proposal).toBeNull();
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
	it('shares prewarm and multiple presenters, including completed journey and evaluation requests', async () => {
		vi.mocked(api).mockImplementation(async (path) => sourceResponse(path));
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
		for (const path of ['routing/journey', 'planning/bus-connection', 'planning/evaluate'])
			expect(vi.mocked(api).mock.calls.filter(([called]) => called === path)).toHaveLength(1);
		expect(updates).toHaveBeenCalled();
	});
	it('publishes the first island heatmap and networks while other sources and evaluation are pending', async () => {
		const held = deferred<unknown>();
		vi.mocked(api).mockImplementation(async (path) => {
			if (path === 'planning/baseline?island_id=island%3A1442') return held.promise;
			return sourceResponse(path);
		});
		const updates = vi.fn();
		const load = cache.load(new AbortController().signal, updates);
		await vi.waitFor(() =>
			expect(
				updates.mock.calls.some(
					([story]) =>
						story.islandData['island:697'].gaps.features.length > 0 && story.ferry && story.flight
				)
			).toBe(true)
		);
		await vi.waitFor(() =>
			expect(vi.mocked(api).mock.calls.some(([path]) => path === 'planning/sea-connections')).toBe(
				true
			)
		);
		expect(vi.mocked(api).mock.calls.some(([path]) => path === 'planning/evaluate')).toBe(false);
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
			return sourceResponse(path);
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
		vi.mocked(api).mockImplementation(async (path) => {
			if (failing && path === 'planning/opportunities/island%3A706')
				throw new Error('Gap source offline');
			return sourceResponse(path);
		});
		const first = await cache.warm();
		expect(first.islandData['island:706'].error).toBe('Gap source offline');
		expect(first.islandData['island:706'].profile?.island.id).toBe('island:706');
		expect(first.islandData['island:697'].gaps.features).toHaveLength(1);
		const count = vi.mocked(api).mock.calls.length;
		expect(await cache.warm()).toBe(first);
		expect(vi.mocked(api).mock.calls).toHaveLength(count);
		failing = false;
		time += 11;
		const retried = await cache.warm();
		expect(retried.islandData['island:706'].error).toBeNull();
		expect(retried.islandData['island:706'].gaps.features).toHaveLength(1);
		expect(retried).not.toBe(first);
	});
	it('refreshes successful completed models only after their cache lifetime', async () => {
		let time = 100;
		cache = createPresentationStoryCache({ now: () => time, ttlMs: 1000 });
		vi.mocked(api).mockImplementation(async (path) => sourceResponse(path));
		const first = await cache.warm();
		expect(first.errors).toEqual({});
		time += 999;
		expect(await cache.warm()).toBe(first);
		time += 1;
		expect(await cache.warm()).not.toBe(first);
		expect(vi.mocked(api).mock.calls.filter(([path]) => path === 'planning/evaluate')).toHaveLength(
			2
		);
	});
	it('retries a failed completed story immediately while sharing concurrent retries and success', async () => {
		let failing = true;
		vi.mocked(api).mockImplementation(async (path) => {
			if (failing && path === 'planning/opportunities/island%3A706')
				throw new Error('Gap source offline');
			return sourceResponse(path);
		});
		const failed = await cache.warm();
		expect(failed.islandData['island:706'].error).toBe('Gap source offline');
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
			vi.mocked(api).mock.calls.filter(([path]) => path === 'planning/opportunities/island%3A706')
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
