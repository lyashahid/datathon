import type { FeatureCollection } from 'geojson';
import { api } from './api.js';
import type { AirAirport, AirNetwork, AirRoute } from './air-connectivity.js';
import { displayGapHexes } from './display-grid.js';
import type { FerryConnectivity } from './ferry-planning.js';
import { emptyFeatures, type MapBaseline } from './map-policy.js';
import type { PlanningPlace } from './planning-map.js';
import type { PresentationMapScene } from './presentation-map.js';
import type { SearchDirectionsResult } from './search-directions.js';
import type { SeaConnections, SeaJourney, SeaNetwork, SeaRoute } from './sea-connectivity.js';
import type { Coordinates, IslandProfile } from './types.js';

/** Stable presenter locations; journey estimates still come from the application's models. */
export const PRESENTATION_LOCATIONS = {
	baarah: {
		id: 'island:640',
		name: 'Baarah · Haa Alifu',
		coordinates: [73.2083825, 6.816661388888889] as Coordinates
	},
	vashafaru: {
		id: 'island:611',
		name: 'Vashafaru · Haa Alifu',
		coordinates: [73.15975138888889, 6.897603888888888] as Coordinates
	},
	dhidhdhoo: {
		id: 'island:625',
		name: 'Dhidhdhoo · Haa Alifu',
		coordinates: [73.11092833333333, 6.888109444444444] as Coordinates
	},
	hanimaadhoo: {
		id: 'island:684',
		name: 'Hanimaadhoo · Haa Dhaalu',
		coordinates: [73.16965777777779, 6.753920833333333] as Coordinates
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
export const PRESENTATION_TRAVEL_START = { date: '2026-10-10', minutes: 480 } as const;
const FLIGHT_DURATION_SOURCE = 'https://maldivian.aero/destinations/hanimaadhoo.html';
const FLIGHT_CHECK_IN_SOURCE = 'https://maldivian.aero/plan-and-book/online-check-in.html';
const FERRY_CONNECTIONS = [
	{ from: 'island:640', to: 'island:611' },
	{ from: 'island:611', to: 'island:625' },
	{ from: 'island:625', to: 'island:684' }
] as const;
export type PresentationTravelTime = {
	minutes: number | null;
	basis: 'unavailable' | 'captured_timetable' | 'presentation_estimate' | 'published_estimate';
	qualification: string;
	sourceUrl?: string;
};
export const PRESENTATION_ISLAND_IDS = [
	'island:640',
	'island:611',
	'island:625',
	'island:684',
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
	fromIslandId: string;
	toIslandId: string;
	journey: SeaJourney | null;
	minutes: number | null;
	waitMinutes: number | null;
	elapsedMinutes: number | null;
	serviceDate: string | null;
	departure: number | null;
	arrival: number | null;
	schematic: boolean;
	qualification: string;
	sourceMinutes: number | null;
	sourceWeeklySailings: number | null;
	transferRequired: boolean;
};
export type PresentationStory = {
	/** Northern journey readiness, independent of the retained Hulhumalé bus service date. */
	travelStart: { date: string; minutes: number };
	serviceDate: string;
	departureMinutes: number;
	islands: typeof PRESENTATION_LOCATIONS;
	islandData: Record<string, PresentationIslandData>;
	airports: { haq: AirAirport | null; mle: AirAirport | null };
	seaNetwork: SeaNetwork | null;
	airNetwork: AirNetwork | null;
	ferryLegs: PresentationFerry[];
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
		connection: PresentationTravelTime;
		flight: PresentationTravelTime;
		pickup: PresentationTravelTime;
	};
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
		travelStart: { ...PRESENTATION_TRAVEL_START },
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
		airports: { haq: null, mle: null },
		seaNetwork: null,
		airNetwork: null,
		ferryLegs: [],
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
			connection: presentationAirportConnection(),
			flight: { minutes: null, basis: 'unavailable', qualification: 'Travel times are loading.' },
			pickup: { minutes: null, basis: 'unavailable', qualification: 'Travel times are loading.' }
		},
		errors: {}
	};
}

/** Slice only a retained directional corridor with both recorded terminal vertices. */
export function presentationFerry(
	network: SeaNetwork,
	fromIslandId: string = FERRY_CONNECTIONS[0].from,
	toIslandId: string = FERRY_CONNECTIONS[0].to
): PresentationFerry | null {
	const route = network.routes.find((item) => {
		const start = item.stops.findIndex((stop) => stop.island_id === fromIslandId);
		const end = item.stops.findIndex((stop) => stop.island_id === toIslandId);
		return start >= 0 && end > start && Boolean(item.geometry);
	});
	if (!route?.geometry) return null;
	const from = route.stops.find((stop) => stop.island_id === fromIslandId);
	const to = route.stops.find((stop) => stop.island_id === toIslandId);
	if (!from?.coordinates || !to?.coordinates) return null;
	const path = route.geometry.coordinates as Coordinates[];
	const matches = (a: Coordinates, b: Coordinates) =>
		Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.000001;
	const start = path.findIndex((point) => matches(point, from.coordinates!));
	const end = path.findIndex((point, index) => index > start && matches(point, to.coordinates!));
	if (start < 0 || end <= start) return null;
	return {
		route,
		geometry: path.slice(start, end + 1),
		from: from.name,
		to: to.name,
		fromIslandId,
		toIslandId,
		journey: null,
		minutes: null,
		waitMinutes: null,
		elapsedMinutes: null,
		serviceDate: null,
		departure: null,
		arrival: null,
		schematic: route.geometry_basis === 'schematic_connection',
		qualification:
			route.qualifications?.join(' ') ??
			'Retained source corridor; actual operation and navigation clearance are unconfirmed.',
		sourceMinutes: null,
		sourceWeeklySailings: route.pressure?.departures_per_week ?? null,
		transferRequired: fromIslandId === PRESENTATION_LOCATIONS.dhidhdhoo.id
	};
}

/** Ordered scenes must never shift to a different leg when a corridor is missing. */
export function presentationFerryLegs(network: SeaNetwork): PresentationFerry[] {
	const legs = FERRY_CONNECTIONS.map(({ from, to }) => presentationFerry(network, from, to));
	return legs.every((leg): leg is PresentationFerry => leg !== null) ? legs : [];
}

function serviceTime(date: string, minutes: number) {
	const day = new Date(`${date}T00:00:00Z`);
	day.setUTCDate(day.getUTCDate() + Math.floor(minutes / 1440));
	return { date: day.toISOString().slice(0, 10), minutes: minutes % 1440 };
}

/** The sea API searches one service day, so look ahead without inventing overnight sailings. */
export async function nextPresentationFerry(
	ferry: PresentationFerry,
	ready: { date: string; minutes: number },
	signal: AbortSignal
) {
	const start = serviceTime(ready.date, ready.minutes);
	for (let offset = 0; offset <= 7; offset++) {
		signal.throwIfAborted();
		const date = serviceTime(start.date, offset * 1440).date;
		const departure = offset === 0 ? start.minutes : 0;
		const value = await api<SeaConnections>(
			'planning/sea-connections',
			{
				origin_island_id: ferry.fromIslandId,
				date,
				departure_minutes: departure,
				budget_minutes: 120,
				max_transfers: 0
			},
			signal
		);
		signal.throwIfAborted();
		const destination = value.baseline.destinations.find((item) => item.id === ferry.toIslandId);
		if (!destination)
			throw new Error('The retained timetable does not confirm this ferry destination.');
		const journey = destination.journey;
		if (!journey) continue;
		const leg = journey.legs.length === 1 ? journey.legs[0] : undefined;
		if (
			(value.service_date && value.service_date !== date) ||
			!leg ||
			leg.proposed ||
			leg.route_id !== ferry.route.id ||
			leg.from_island_id !== ferry.fromIslandId ||
			leg.to_island_id !== ferry.toIslandId ||
			!Number.isFinite(leg.departure_minutes) ||
			!Number.isFinite(leg.arrival_minutes) ||
			leg.departure_minutes < departure ||
			leg.arrival_minutes <= leg.departure_minutes
		)
			throw new Error('The retained timetable does not confirm this ferry leg and its wait.');
		const minutes = leg.arrival_minutes - leg.departure_minutes;
		const waitMinutes = offset * 1440 + leg.departure_minutes - start.minutes;
		return {
			journey,
			serviceDate: date,
			departure: leg.departure_minutes,
			arrival: leg.arrival_minutes,
			minutes,
			waitMinutes,
			elapsedMinutes: waitMinutes + minutes
		};
	}
	throw new Error('No dated ferry sailing is confirmed within the next seven days.');
}

function presentationAirportConnection(): PresentationTravelTime {
	return {
		minutes: 90,
		basis: 'presentation_estimate',
		qualification:
			'Presentation assumptions: 20 minutes from Hanimaadhoo harbour to the airport plus a 70-minute check-in and connection allowance. Maldivian asks for boarding-pass collection and bag drop at least one hour before departure. No dated connecting flight is retained; the actual flight wait is unknown and may be longer.',
		sourceUrl: FLIGHT_CHECK_IN_SOURCE
	};
}

function updateTravelTimes(story: PresentationStory) {
	const completeFerry =
		story.ferryLegs.length === FERRY_CONNECTIONS.length &&
		story.ferryLegs.every((leg) => leg.minutes != null && leg.elapsedMinutes != null);
	story.timing.ferry = {
		minutes: completeFerry
			? story.ferryLegs.reduce((total, leg) => total + leg.elapsedMinutes!, 0)
			: null,
		basis: completeFerry ? 'captured_timetable' : 'unavailable',
		qualification:
			'Elapsed time from the stated Baarah start, including the next confirmed timetable departure, every crossing, the Vashafaru dwell and the Dhidhdhoo connection wait. Published timetable snapshot; actual operation is unconfirmed.'
	};
	story.timing.connection = presentationAirportConnection();
	if (story.flight)
		story.timing.flight = {
			minutes: 45,
			basis: 'published_estimate',
			qualification:
				'Approximate 45-minute flight, using Maldivian’s published Malé–Hanimaadhoo destination estimate for the reverse connection. This is not a retained dated HAQ–MLE flight timetable; excludes check-in and connection waits.',
			sourceUrl: FLIGHT_DURATION_SOURCE
		};
	const ferry = story.timing.ferry.minutes,
		flight = story.timing.flight.minutes,
		connection = story.timing.connection.minutes;
	const completeArrival = ferry != null && flight != null && connection != null;
	story.timing.arrival = {
		minutes: completeArrival ? ferry + connection + flight : null,
		basis: completeArrival ? 'presentation_estimate' : 'unavailable',
		qualification:
			'Captured ferry waits and crossings + a 90-minute assumed harbour transfer and airport connection + an approximate 45-minute flight to Velana airport, serving Hulhumalé. This is a presentation estimate, not a confirmed flight connection or earliest possible arrival. Actual flight waiting is unknown; onward travel into Hulhumalé is excluded.'
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
			story.ferryLegs = presentationFerryLegs(value);
			if (!story.ferryLegs.length)
				story.errors.ferry = 'One or more retained source ferry corridors are unavailable.';
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
				haq: value.airports.find((item) => item.iata === 'HAQ') ?? null,
				mle: value.airports.find((item) => item.iata === 'MLE') ?? null
			};
			story.flight = value.routes.find((item) => item.id === 'maldivian-mle-haq') ?? null;
			const flight = story.flight;
			if (flight?.geometry && (flight.from_iata === 'HAQ' || flight.bidirectional)) {
				const path = flight.geometry.coordinates as Coordinates[];
				story.flightGeometry = flight.from_iata === 'HAQ' ? path : [...path].reverse();
			} else
				story.errors.flight = 'The retained Hanimaadhoo–Malé flight connection is unavailable.';
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
		if (!story.ferryLegs.length) return;
		let ready: { date: string; minutes: number } = { ...story.travelStart };
		for (let index = 0; index < FERRY_CONNECTIONS.length; index++) {
			let confirmed = false;
			await section(
				`ferryTiming:${index}`,
				nextPresentationFerry(story.ferryLegs[index], ready, signal),
				(value) => {
					const ferry = story.ferryLegs[index];
					const waiting =
						index === 1
							? `${value.waitMinutes}-minute dwell in Vashafaru`
							: index === 2
								? `${value.waitMinutes}-minute connection wait in Dhidhdhoo`
								: `${value.waitMinutes}-minute wait from the stated Baarah start`;
					story.ferryLegs = story.ferryLegs.map((item, i) =>
						i === index
							? {
									...item,
									...value,
									sourceMinutes: value.minutes,
									qualification: `${ferry.qualification} Includes a ${waiting} before the crossing on ${value.serviceDate}.`
								}
							: item
					);
					ready = serviceTime(value.serviceDate, value.arrival);
					confirmed = true;
				}
			);
			// Later waits cannot be calculated without the preceding confirmed arrival.
			if (!confirmed) break;
		}
	});
	const busReady = islandRequests['island:1442'].baseline.then(async () => {
		if (!story.origin) return;
		await section(
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
