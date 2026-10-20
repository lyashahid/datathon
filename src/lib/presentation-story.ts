import type { FeatureCollection } from 'geojson';
import { api } from './api.js';
import type { AirAirport, AirNetwork, AirRoute } from './air-connectivity.js';
import type { BusConnectionDraft } from './bus-planning.js';
import { displayComparisonHexes, displayGapHexes } from './display-grid.js';
import type { FerryConnectivity } from './ferry-planning.js';
import { emptyFeatures, type MapBaseline, type MapEvaluation } from './map-policy.js';
import type { PlanningOperation, PlanningPlace } from './planning-map.js';
import type { PresentationMapScene } from './presentation-map.js';
import type { SearchDirectionsResult } from './search-directions.js';
import type { SeaConnections, SeaJourney, SeaNetwork, SeaRoute } from './sea-connectivity.js';
import type { Coordinates, IslandProfile } from './types.js';

/** Stable presenter locations; journey estimates still come from the application's models. */
export const PRESENTATION_LOCATIONS = {
	hithadhoo: {
		id: 'island:697',
		name: 'Hithadhoo · Laamu',
		coordinates: [73.3882588888889, 1.7968288888888888] as Coordinates
	},
	kadhdhoo: {
		id: 'island:706',
		name: 'Kadhdhoo · Laamu',
		coordinates: [73.52127222222222, 1.8614808333333335] as Coordinates
	},
	hulhumale: {
		id: 'island:1442',
		name: 'Hulhumalé',
		coordinates: [73.54246305555556, 4.222071388888889] as Coordinates
	},
	airportTerminal: {
		id: 'rtl:stop:306',
		name: 'VIA Domestic Terminal',
		coordinates: [73.527056, 4.190044] as Coordinates
	}
};

// This origin is in the retained resident model, has a poor walking connection,
// and has a dated journey to the airport. No Phase 3 administrative boundary is inferred.
export const PRESENTATION_ORIGIN_ID = 'wp:hulhumale:3443:1080';
export const PRESENTATION_DEPARTURE_MINUTES = 920;
export const PRESENTATION_AIRPORT_BUS_ROUTE_ID = 'rtl:route:129';
/** Offshore of the retained OneMap west coastline; no recorded public ferry berth is asserted. */
export const PRESENTATION_KADHDHOO_COAST: Coordinates = [73.5169, 1.8588];
const FLIGHT_DURATION_SOURCE =
	'https://www.trauminselreisen.de/fileadmin/user_upload/Six_Senses_Laamu_-_Transfer_Information_Brochure_2022.pdf';
export type PresentationTravelTime = {
	minutes: number | null;
	basis: 'unavailable' | 'captured_timetable' | 'presentation_estimate' | 'published_estimate';
	qualification: string;
	sourceUrl?: string;
};
export const PRESENTATION_ISLAND_IDS = [
	'island:697',
	'island:706',
	'island:1442',
	'island:1443'
] as const;

type GapDetail = {
	gap_cells?: FeatureCollection;
	features?: FeatureCollection;
	hex_grid?: FeatureCollection;
	coverage_fill?: FeatureCollection;
};
export type StoryBaseline = MapBaseline & { reference_date?: string };
export type PresentationIslandData = {
	profile: IslandProfile | null;
	baseline: StoryBaseline | null;
	connectivity: FerryConnectivity | null;
	gaps: FeatureCollection;
	coverage: FeatureCollection;
	grid: FeatureCollection;
	loading: boolean;
	error: string | null;
};
export type PresentationFerry = {
	route: SeaRoute;
	geometry: Coordinates[];
	from: string;
	to: string;
	journey: SeaJourney | null;
	minutes: number | null;
	departure: number | null;
	arrival: number | null;
	schematic: boolean;
	qualification: string;
	sourceMinutes: number | null;
	sourceWeeklySailings: number | null;
	transferRequired: boolean;
};
export type PresentationProposal = {
	operations: PlanningOperation[];
	connection: BusConnectionDraft;
	evaluation: MapEvaluation | null;
	comparisonFeatures: FeatureCollection;
	originBeforeMinutes: number | null;
	originAfterMinutes: number | null;
};
export type PresentationStory = {
	serviceDate: string;
	departureMinutes: number;
	islands: typeof PRESENTATION_LOCATIONS;
	islandData: Record<string, PresentationIslandData>;
	airports: { kdo: AirAirport | null; mle: AirAirport | null };
	seaNetwork: SeaNetwork | null;
	airNetwork: AirNetwork | null;
	ferry: PresentationFerry | null;
	flight: AirRoute | null;
	flightGeometry: Coordinates[];
	baseline: StoryBaseline | null;
	grid: FeatureCollection;
	gapFeatures: FeatureCollection;
	coverageFill: FeatureCollection;
	/** Modeled resident distribution; this is not observed bus occupancy. */
	populationFeatures: FeatureCollection;
	origin: (PlanningPlace & { coordinates: Coordinates }) | null;
	journey: SearchDirectionsResult | null;
	journeyPaths: PresentationMapScene['paths'];
	journeyGeometrySchematic: boolean;
	journeyGeometryQualification: string;
	timing: {
		arrival: PresentationTravelTime;
		ferry: PresentationTravelTime;
		flight: PresentationTravelTime;
		pickup: PresentationTravelTime;
	};
	proposal: PresentationProposal | null;
	errors: Record<string, string>;
};

type TransitPattern = {
	id: string;
	route_id: string;
	stop_ids: string[];
	segment_geometry: Coordinates[][];
};

export function emptyPresentationStory(): PresentationStory {
	return {
		serviceDate: '2026-10-10',
		departureMinutes: PRESENTATION_DEPARTURE_MINUTES,
		islands: PRESENTATION_LOCATIONS,
		islandData: Object.fromEntries(
			PRESENTATION_ISLAND_IDS.map((id) => [
				id,
				{
					profile: null,
					baseline: null,
					connectivity: null,
					gaps: emptyFeatures(),
					coverage: emptyFeatures(),
					grid: emptyFeatures(),
					loading: true,
					error: null
				}
			])
		),
		airports: { kdo: null, mle: null },
		seaNetwork: null,
		airNetwork: null,
		ferry: null,
		flight: null,
		flightGeometry: [],
		baseline: null,
		grid: emptyFeatures(),
		gapFeatures: emptyFeatures(),
		coverageFill: emptyFeatures(),
		populationFeatures: emptyFeatures(),
		origin: null,
		journey: null,
		journeyPaths: [],
		journeyGeometrySchematic: false,
		journeyGeometryQualification: '',
		timing: {
			arrival: { minutes: null, basis: 'unavailable', qualification: 'Travel times are loading.' },
			ferry: { minutes: null, basis: 'unavailable', qualification: 'Travel times are loading.' },
			flight: { minutes: null, basis: 'unavailable', qualification: 'Travel times are loading.' },
			pickup: { minutes: null, basis: 'unavailable', qualification: 'Travel times are loading.' }
		},
		proposal: null,
		errors: {}
	};
}

/** Retain the source corridor separately from the explicitly schematic airport crossing. */
export function presentationFerry(network: SeaNetwork): PresentationFerry | null {
	const route = network.routes.find((item) => {
		const start = item.stops.findIndex((stop) => stop.island_id === 'island:697');
		const end = item.stops.findIndex((stop) => stop.island_id === 'island:704');
		return item.route_code === 'Z4R17' && start >= 0 && end > start;
	});
	if (!route?.geometry) return null;
	const from = route.stops.find((stop) => stop.island_id === 'island:697');
	const to = route.stops.find((stop) => stop.island_id === 'island:704');
	if (!from?.coordinates || !to?.coordinates) return null;
	const path = route.geometry.coordinates as Coordinates[];
	const nearest = (point: Coordinates) =>
		path.reduce(
			(best, current, index) =>
				Math.hypot(current[0] - point[0], current[1] - point[1]) <
				Math.hypot(path[best][0] - point[0], path[best][1] - point[1])
					? index
					: best,
			0
		);
	if (path.length < 2) return null;
	const start = nearest(from.coordinates),
		end = nearest(to.coordinates);
	if (end <= start) return null;
	// A corridor without its source terminal vertex cannot establish a sliced berth.
	const matches = (a: Coordinates, b: Coordinates) =>
		Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.000001;
	if (!matches(path[start], from.coordinates) || !matches(path[end], to.coordinates)) return null;
	return {
		route,
		geometry: [from.coordinates, PRESENTATION_KADHDHOO_COAST],
		from: from.name,
		to: 'Kadhdhoo Airport coast',
		journey: null,
		minutes: null,
		departure: null,
		arrival: null,
		schematic: true,
		qualification:
			'Presentation-only direct crossing to the Kadhdhoo airport coast. No public ferry berth, operator timetable or navigable track is retained for this connection. Source corridor details describe Z4R17 to Fonadhoo, not this crossing.',
		sourceMinutes: null,
		sourceWeeklySailings: route.pressure?.departures_per_week ?? null,
		transferRequired: false
	};
}

function pathDistance(coordinates: Coordinates[]) {
	const radians = Math.PI / 180;
	return coordinates.slice(1).reduce((total, point, index) => {
		const previous = coordinates[index];
		const latitude = (point[1] - previous[1]) * radians;
		const longitude = (point[0] - previous[0]) * radians;
		const a =
			Math.sin(latitude / 2) ** 2 +
			Math.cos(previous[1] * radians) * Math.cos(point[1] * radians) * Math.sin(longitude / 2) ** 2;
		return total + 2 * 6371000 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
	}, 0);
}

function updateTravelTimes(story: PresentationStory) {
	const sourceMinutes = story.ferry?.sourceMinutes;
	if (story.ferry && sourceMinutes != null) {
		const stops = story.ferry.route.stops;
		const sourceStart = stops.find((stop) => stop.island_id === 'island:697')?.coordinates;
		const sourceEnd = stops.find((stop) => stop.island_id === 'island:704')?.coordinates;
		const path = story.ferry.route.geometry?.coordinates as Coordinates[] | undefined;
		const startIndex = path?.findIndex((point) =>
			point.every((value, i) => value === sourceStart?.[i])
		);
		const endIndex = path?.findIndex((point) =>
			point.every((value, i) => value === sourceEnd?.[i])
		);
		const sourceDistance =
			path && startIndex != null && endIndex != null && startIndex >= 0 && endIndex > startIndex
				? pathDistance(path.slice(startIndex, endIndex + 1))
				: 0;
		if (sourceDistance > 0) {
			// A distance-scaled estimate is not a scheduled crossing or medical transfer time.
			const minutes = Math.max(
				5,
				Math.round((sourceMinutes * pathDistance(story.ferry.geometry)) / sourceDistance / 5) * 5
			);
			story.ferry = { ...story.ferry, minutes };
			story.timing.ferry = {
				minutes,
				basis: 'presentation_estimate',
				qualification: `Approximate direct crossing, scaled by distance from the retained ${sourceMinutes}-minute Hithadhoo–Fonadhoo sailing. Not an operator timetable; excludes waiting and coast-to-terminal transfer.`
			};
		}
	}
	if (story.flight)
		story.timing.flight = {
			minutes: 50,
			basis: 'published_estimate',
			qualification:
				'Approximate 50-minute domestic flight from Six Senses Laamu’s 2022 transfer guide. This is a presentation estimate, not a retained dated flight timetable; excludes check-in and connection waits.',
			sourceUrl: FLIGHT_DURATION_SOURCE
		};
	const ferry = story.timing.ferry.minutes,
		flight = story.timing.flight.minutes;
	story.timing.arrival = {
		minutes: ferry != null && flight != null ? ferry + flight : null,
		basis: ferry != null && flight != null ? 'presentation_estimate' : 'unavailable',
		qualification:
			'Approximate ferry + flight travel time to Velana airport, serving Hulhumalé. Excludes ferry waiting, coast-to-terminal transfer, check-in, flight connection waits and the onward journey into Hulhumalé.'
	};
	const completeJourney =
		story.journey?.status === 'ok' &&
		story.journey.segments.length > 0 &&
		story.journey.segments.some((segment) =>
			segment.result?.journey?.legs.some(
				(leg) => leg.mode === 'bus' && leg.route_id === PRESENTATION_AIRPORT_BUS_ROUTE_ID
			)
		) &&
		story.journey.segments.every(
			(segment) => segment.status === 'ok' && segment.result?.journey?.status === 'reachable'
		);
	story.timing.pickup = {
		minutes: completeJourney ? story.journey!.minutes : null,
		basis: completeJourney ? 'captured_timetable' : 'unavailable',
		qualification: `Walking + waiting + the captured direct R9 airport bus on ${story.serviceDate}, departing at 15:20. This retained timetable is not a live arrival prediction.`
	};
}

/** Use the retained airport-side corridor for display, without claiming reversed driving permissions. */
export function presentationDirectBus(
	journey: SearchDirectionsResult,
	patterns: TransitPattern[]
): { journey: SearchDirectionsResult; schematic: boolean; qualification: string } {
	const source = patterns.find((pattern) => pattern.route_id === PRESENTATION_AIRPORT_BUS_ROUTE_ID);
	const airportIndex = source?.stop_ids.indexOf('rtl:stop:11306') ?? -1;
	const returnCorridor = airportIndex >= 0 ? source?.segment_geometry[airportIndex] : undefined;
	const qualification =
		'Direct R9 service uses captured stop times. The MACL–airport display follows the retained airport-side road corridor in reverse; directional road access is incomplete, so this portion is schematic and is not turn-by-turn driving guidance.';
	let changed = false;
	const segments = journey.segments.map((segment) => {
		const result = segment.result;
		if (segment.status !== 'ok' || result?.journey?.status !== 'reachable') return segment;
		const legs = result.journey.legs.map((leg) => {
			if (
				leg.mode !== 'bus' ||
				leg.route_id !== PRESENTATION_AIRPORT_BUS_ROUTE_ID ||
				leg.to.id !== 'rtl:stop:306'
			)
				return leg;
			if (!returnCorridor || returnCorridor.length < 2) return leg;
			const end = returnCorridor.at(-1)!;
			const split = leg.geometry.findIndex(
				(point) => Math.hypot(point[0] - end[0], point[1] - end[1]) < 0.0001
			);
			if (split < 0) return leg;
			changed = true;
			return {
				...leg,
				geometry: [
					...leg.geometry.slice(0, split + 1),
					...returnCorridor.toReversed(),
					leg.to.coordinates
				],
				geometry_source: 'presentation_schematic_reversed_retained_airport_corridor',
				geometry_warning: qualification,
				distance_m: null
			};
		});
		if (legs.every((leg, index) => leg === result.journey!.legs[index])) return segment;
		return {
			...segment,
			distance_m: null,
			result: {
				...result,
				distance_m: undefined,
				geometry: legs.flatMap((leg) => leg.geometry),
				journey: { ...result.journey, legs, warnings: [...result.journey.warnings, qualification] }
			}
		};
	});
	return {
		journey: changed
			? { ...journey, segments, distance_m: null, warnings: [...journey.warnings, qualification] }
			: journey,
		schematic: changed,
		qualification: changed ? qualification : ''
	};
}

export function presentationJourneyPaths(
	journey: SearchDirectionsResult
): PresentationMapScene['paths'] {
	return journey.segments.flatMap((segment) =>
		(segment.status === 'ok' && segment.result?.journey?.status === 'reachable'
			? segment.result.journey.legs
			: []
		).flatMap((leg) => {
			if (leg.geometry.length < 2 || leg.mode === 'wait') return [];
			return [{ mode: leg.mode, coordinates: leg.geometry }];
		})
	);
}

/** Every section publishes as it arrives; slower models do not hold the first maps. */
async function fetchPresentationStory(
	signal: AbortSignal,
	onUpdate: (story: PresentationStory) => void
): Promise<PresentationStory> {
	const story = emptyPresentationStory();
	const update = () => {
		signal.throwIfAborted();
		updateTravelTimes(story);
		onUpdate({
			...story,
			timing: { ...story.timing },
			errors: { ...story.errors },
			islandData: Object.fromEntries(
				Object.entries(story.islandData).map(([id, value]) => [id, { ...value }])
			)
		});
	};
	async function section<T>(
		key: string,
		request: Promise<T>,
		accept: (value: T) => void,
		islandId?: string
	) {
		try {
			const value = await request;
			signal.throwIfAborted();
			accept(value);
		} catch (cause) {
			if (signal.aborted) throw cause;
			const error =
				cause instanceof Error ? cause.message : 'This part of the scenario could not load.';
			story.errors[key] = error;
			if (islandId) story.islandData[islandId].error = error;
		}
		update();
	}
	const seaReady = section(
		'ferry',
		api<SeaNetwork>('planning/sea-network?date=2026-10-10', undefined, signal),
		(value) => {
			story.seaNetwork = value;
			story.ferry = presentationFerry(value);
			if (!story.ferry) story.errors.ferry = 'The retained source ferry corridor is unavailable.';
		}
	);
	let busPatterns: TransitPattern[] = [];
	const busPatternsReady = section(
		'journeyGeometry',
		api<{ patterns: TransitPattern[] }>(
			`routing/patterns?route_id=${encodeURIComponent(PRESENTATION_AIRPORT_BUS_ROUTE_ID)}`,
			undefined,
			signal
		),
		(value) => {
			busPatterns = value.patterns;
		}
	);
	const airReady = section(
		'flight',
		api<AirNetwork>('planning/air-network?date=2026-10-10', undefined, signal),
		(value) => {
			story.airNetwork = value;
			story.airports = {
				kdo: value.airports.find((item) => item.iata === 'KDO') ?? null,
				mle: value.airports.find((item) => item.iata === 'MLE') ?? null
			};
			story.flight = value.routes.find((item) => item.id === 'maldivian-mle-kdo') ?? null;
			const flight = story.flight;
			if (flight?.geometry && (flight.from_iata === 'KDO' || flight.bidirectional)) {
				const path = flight.geometry.coordinates as Coordinates[];
				story.flightGeometry = flight.from_iata === 'KDO' ? path : [...path].reverse();
			} else story.errors.flight = 'The retained Kadhdhoo–Malé flight connection is unavailable.';
		}
	);
	const islandRequests = Object.fromEntries(
		PRESENTATION_ISLAND_IDS.map((id) => {
			const encoded = encodeURIComponent(id);
			const data = story.islandData[id];
			const access = section(
				id === 'island:1442' ? 'access' : `${id}:access`,
				api<GapDetail>(`planning/opportunities/${encoded}`, undefined, signal),
				(value) => {
					data.grid = value.hex_grid ?? emptyFeatures();
					const source = value.gap_cells ?? value.features ?? emptyFeatures();
					data.gaps = data.grid.features.length ? displayGapHexes(source, data.grid) : source;
					data.coverage = value.coverage_fill ?? emptyFeatures();
					if (id === 'island:1442') {
						story.grid = data.grid;
						story.gapFeatures = data.gaps;
						story.coverageFill = data.coverage;
						story.populationFeatures = data.gaps;
					}
				},
				id
			);
			const baseline = section(
				id === 'island:1442' ? 'baseline' : `${id}:baseline`,
				api<StoryBaseline>(`planning/baseline?island_id=${encoded}`, undefined, signal),
				(value) => {
					data.baseline = value;
					if (id !== 'island:1442') return;
					story.baseline = value;
					story.serviceDate = value.reference_date ?? story.serviceDate;
					const origin = value.origins.find((item) => item.id === PRESENTATION_ORIGIN_ID);
					if (origin)
						story.origin = {
							...origin,
							name: 'Hulhumalé neighbourhood',
							coordinates: [origin.lon, origin.lat]
						};
					else story.errors.journey = 'The retained resident origin is unavailable.';
				},
				id
			);
			const profile = section(
				`${id}:profile`,
				api<IslandProfile>(`islands/${encoded}/profile`, undefined, signal),
				(value) => {
					data.profile = value;
				},
				id
			);
			const connectivity = section(
				`${id}:connectivity`,
				api<FerryConnectivity>(
					`planning/connectivity?origin_island_id=${encoded}&date=2026-10-10`,
					undefined,
					signal
				),
				(value) => {
					data.connectivity = value;
				},
				id
			);
			const ready = Promise.allSettled([access, baseline, profile, connectivity]).then(() => {
				data.loading = false;
				update();
			});
			return [id, { access, baseline, profile, connectivity, ready }];
		})
	);
	const ferryReady = seaReady.then(async () => {
		if (!story.ferry) return;
		await section(
			'ferryTiming',
			api<SeaConnections>(
				'planning/sea-connections',
				{
					origin_island_id: 'island:697',
					date: '2026-10-10',
					departure_minutes: 455,
					budget_minutes: 120,
					max_transfers: 0
				},
				signal
			),
			(value) => {
				const journey = value.baseline.destinations.find(
					(item) => item.id === 'island:704'
				)?.journey;
				if (story.ferry)
					story.ferry = {
						...story.ferry,
						journey: journey ?? null,
						sourceMinutes: journey
							? journey.arrival_minutes -
								(journey.legs[0]?.departure_minutes ?? journey.departure_minutes)
							: null,
						// Published clocks belong to the source corridor, not the schematic crossing.
						departure: null,
						arrival: null
					};
			}
		);
	});
	const busReady = islandRequests['island:1442'].baseline.then(async () => {
		if (!story.origin) return;
		const assumptions = {
			date: story.serviceDate,
			departure_minutes: story.departureMinutes,
			goal: 'transport',
			target_minutes: 10,
			include_journey_geometry: false,
			include_world: false
		};
		const journey = section(
			'journey',
			api<SearchDirectionsResult>(
				'routing/journey',
				{
					points: [story.origin.coordinates, PRESENTATION_LOCATIONS.airportTerminal.coordinates],
					mode: 'transit',
					service_date: story.serviceDate,
					departure_minutes: story.departureMinutes,
					route_ids: [PRESENTATION_AIRPORT_BUS_ROUTE_ID]
				},
				signal
			).then(async (value) => {
				await busPatternsReady;
				return value;
			}),
			(value) => {
				const direct = presentationDirectBus(value, busPatterns);
				story.journey = direct.journey;
				story.journeyGeometrySchematic = direct.schematic;
				story.journeyGeometryQualification = direct.qualification;
				story.journeyPaths = presentationJourneyPaths(direct.journey);
				if (
					value.status === 'ok' &&
					!value.segments.some((segment) =>
						segment.result?.journey?.legs.some(
							(leg) => leg.mode === 'bus' && leg.route_id === PRESENTATION_AIRPORT_BUS_ROUTE_ID
						)
					)
				) {
					story.errors.journey =
						'No captured direct R9 airport bus journey is available at this departure time.';
				}
				if (
					story.journeyPaths.some(
						(path) =>
							path.mode === 'bus' &&
							path.coordinates.some((point) => point[0] < 73.522 && point[1] < 4.185)
					)
				) {
					// A missing corridor must never fall back to the known Malé detour.
					story.journeyPaths = story.journeyPaths.filter((path) => path.mode !== 'bus');
					story.journey = null;
					story.errors.journeyGeometry =
						'The direct airport corridor is unavailable; no Malé detour is substituted.';
				}
				if (value.status !== 'ok')
					story.errors.journey =
						value.reason ?? 'The airport journey is not confirmed by the retained timetables.';
			}
		);
		const proposal = section(
			'proposal',
			api<BusConnectionDraft>(
				'planning/bus-connection',
				{
					island_id: 'island:1442',
					coordinates: story.origin.coordinates,
					stop_name: 'Closer neighbourhood stop',
					headway_minutes: 10,
					assumptions
				},
				signal
			),
			(value) => {
				if (value.status !== 'ready' || !value.operations.length) {
					story.errors.proposal =
						value.reasons[0] ??
						'The closer-stop proposal could not be connected to the road network.';
					return;
				}
				story.proposal = {
					operations: value.operations,
					connection: value,
					evaluation: null,
					comparisonFeatures: emptyFeatures(),
					originBeforeMinutes: null,
					originAfterMinutes: null
				};
			}
		).then(async () => {
			// Preserve early map/network availability before starting the comparison model.
			await Promise.allSettled([seaReady, airReady, islandRequests['island:1442'].access]);
			if (!story.proposal || !story.baseline) return;
			await section(
				'evaluation',
				api<MapEvaluation>(
					'planning/evaluate',
					{ island_id: 'island:1442', assumptions, operations: story.proposal.operations },
					signal
				),
				(value) => {
					const row = value.origins.find((item) => item.origin_id === story.origin?.id);
					story.proposal = {
						...story.proposal!,
						evaluation: value,
						comparisonFeatures: displayComparisonHexes(
							story.baseline!.origins,
							value.origins,
							story.grid,
							10
						),
						originBeforeMinutes: row?.before.minutes ?? null,
						originAfterMinutes: row?.after.minutes ?? null
					};
				}
			);
		});
		await Promise.allSettled([journey, proposal]);
	});
	await Promise.allSettled([
		seaReady,
		airReady,
		busPatternsReady,
		ferryReady,
		busReady,
		...Object.values(islandRequests).map((request) => request.ready)
	]);
	signal.throwIfAborted();
	return story;
}

/** Shared page cache keeps prewarming alive when an individual presentation closes. */
export function createPresentationStoryCache({
	now = Date.now,
	ttlMs = 5 * 60_000,
	failureTtlMs = 15_000
}: { now?: () => number; ttlMs?: number; failureTtlMs?: number } = {}) {
	type Entry = {
		story: PresentationStory;
		promise: Promise<PresentationStory>;
		listeners: Set<(story: PresentationStory) => void>;
		complete: boolean;
		expires: number;
	};
	let entry: Entry | undefined;
	function current() {
		if (entry && (!entry.complete || entry.expires > now())) return entry;
		const next: Entry = {
			story: emptyPresentationStory(),
			promise: Promise.resolve(emptyPresentationStory()),
			listeners: new Set(),
			complete: false,
			expires: Infinity
		};
		entry = next;
		const active = new AbortController();
		next.promise = fetchPresentationStory(active.signal, (story) => {
			next.story = story;
			for (const listener of next.listeners) listener(story);
		}).then(
			(story) => {
				next.story = story;
				next.complete = true;
				next.expires = now() + (Object.keys(story.errors).length ? failureTtlMs : ttlMs);
				return story;
			},
			(cause: unknown) => {
				next.complete = true;
				next.expires = now();
				throw cause;
			}
		);
		return next;
	}
	function warm() {
		return current().promise;
	}
	async function load(signal: AbortSignal, onUpdate?: (story: PresentationStory) => void) {
		signal.throwIfAborted();
		const cached = current();
		return new Promise<PresentationStory>((resolve, reject) => {
			let finished = false;
			const update = (story: PresentationStory) => {
				if (signal.aborted) return;
				try {
					onUpdate?.(story);
				} catch (cause) {
					finish(() => reject(cause));
				}
			};
			const finish = (callback: () => void) => {
				if (finished) return;
				finished = true;
				cached.listeners.delete(update);
				signal.removeEventListener('abort', abort);
				callback();
			};
			const abort = () =>
				finish(() => reject(signal.reason ?? new DOMException('Request aborted', 'AbortError')));
			cached.listeners.add(update);
			signal.addEventListener('abort', abort, { once: true });
			update(cached.story);
			if (signal.aborted) abort();
			cached.promise.then(
				(story) => finish(() => resolve(story)),
				(cause: unknown) => finish(() => reject(cause))
			);
		});
	}
	async function retryFailed(signal: AbortSignal, onUpdate?: (story: PresentationStory) => void) {
		signal.throwIfAborted();
		// An explicit retry can recover immediately without duplicating prewarming
		// or discarding a successful completed evaluation.
		if (entry?.complete && Object.keys(entry.story.errors).length) entry = undefined;
		return load(signal, onUpdate);
	}
	return { warm, load, retryFailed };
}

const presentationCache = createPresentationStoryCache();
/** Call as the map opens; repeated calls share active requests and completed model results. */
export const warmPresentationStory = presentationCache.warm;
export const loadPresentationStory = presentationCache.load;
/** Retry settled failures immediately; active and successful stories stay shared. */
export const retryFailedPresentationStory = presentationCache.retryFailed;
