import { themeColors } from '#lib/theme.js';
import type { FeatureCollection } from 'geojson';
import type { Coordinates } from './types.js';
import { validPoint } from './planning-map.js';

export type SeaConnectionStatus = 'direct' | 'transfer' | 'unverified' | 'unknown';
export type SeaConnectionMode = 'baseline' | 'scenario';
export type SeaJourney = {
	departure_minutes: number;
	arrival_minutes: number;
	total_minutes: number;
	wait_minutes: number;
	sailing_minutes: number;
	legs: {
		route_id: string;
		name: string;
		from_island_id: string;
		to_island_id: string;
		departure_minutes: number;
		arrival_minutes: number;
		wait_minutes: number;
		source_ids: string[];
		proposed: boolean;
	}[];
};
export type SeaDestination = {
	id: string;
	name: string;
	coordinates: Coordinates | null;
	status: SeaConnectionStatus;
	route_ids: string[];
	transfers: number | null;
	journey: SeaJourney | null;
	within_budget: boolean;
	return_journey: SeaJourney | null;
	return_status: 'feasible' | 'not_found' | 'unknown' | 'not_requested';
};
export type SeaRoute = {
	id: string;
	name: string;
	route_code?: string | null;
	operator: string | null;
	evidence: 'confirmed_route' | 'official_route' | 'dated_service' | 'mapped_route' | 'proposal';
	from_island_id: string | null;
	to_island_id: string | null;
	stop_island_ids: string[];
	stops: {
		id: string;
		name: string;
		island_id: string | null;
		island_name?: string;
		coordinates: Coordinates | null;
	}[];
	departure_count: number | null;
	departures: number[];
	origin_departures?: number[];
	published_departures?: number[];
	frequency_windows?: SeaServiceWindow[];
	no_service_windows?: SeaServiceWindow[];
	unknown_windows?: SeaServiceWindow[];
	no_scheduled_service?: boolean;
	crossing_minutes: number | null;
	source_ids: string[];
	valid_from: string | null;
	valid_until: string | null;
	current_as_of?: string | null;
	published_valid_until?: string | null;
	projection_status?: string | null;
	validity_status?: string;
	timing_status: string;
	qualifications: string[];
	geometry: { type: 'LineString'; coordinates: number[][] } | null;
};
export type SeaServiceWindow = {
	days: number[];
	label: string;
	includes_public_holidays?: boolean;
	start_minutes: number;
	end_minutes: number;
	headway_minutes?: number;
	reason?: string;
};
export type SeaConnectionView = {
	summary: {
		direct_islands: number;
		transfer_islands: number;
		timed_reachable_islands: number;
		return_feasible_islands: number;
		route_count: number;
		departures_today: number;
	};
	destinations: SeaDestination[];
	routes: SeaRoute[];
	map_features: FeatureCollection;
};
export type SeaSource = {
	id: string;
	title: string;
	url: string | null;
	publisher?: string;
	retrieved_at?: string;
	published_at?: string;
};
export type SeaConnections = {
	origin: { id: string; name: string; coordinates: Coordinates | null };
	service_date: string;
	departure_minutes: number;
	budget_minutes: number;
	baseline: SeaConnectionView;
	scenario: SeaConnectionView | null;
	comparison: {
		newly_reachable_island_ids: string[];
		time_improved_island_ids: string[];
		lost_reachable_island_ids: string[];
		new_direct_island_ids: string[];
		unique_destination_delta: number;
		warnings?: string[];
	};
	sources: SeaSource[];
	coverage: { notes: string[]; [key: string]: unknown };
	qualification: string;
	vessel_assignment: { status: string; reason: string };
};
export type SeaMapSelection = {
	id: string;
	kind: 'route' | 'island';
	key: string | number;
	name?: string;
};
export type SeaMapState = {
	features: FeatureCollection;
	destinations: {
		id: string;
		status: SeaConnectionStatus;
		within_budget: boolean;
		newly_reachable: boolean;
		time_improved?: boolean;
	}[];
	selectedDestinationId: string;
	selectedRouteId: string;
	originIslandId: string;
	mode: SeaConnectionMode;
};

export type SeaConnectivityRating = {
	reachable: number | null;
	direct: number;
	transfer: number;
	unverified: number;
	reason: string;
	projected: boolean;
};

/** A count of evidenced journeys, rather than an invented weighted island score. */
export function seaConnectivityRating(
	view: SeaConnectionView,
	budgetMinutes: number
): SeaConnectivityRating {
	const destinations = [...new Map(view.destinations.map((item) => [item.id, item])).values()];
	const direct = destinations.filter((item) => item.status === 'direct').length;
	const transfer = destinations.filter((item) => item.status === 'transfer').length;
	const unverified = destinations.filter(
		(item) => item.status === 'unverified' || item.status === 'unknown'
	).length;
	const timed = destinations.filter((item) => item.journey !== null);
	const reachable = timed.filter((item) => item.within_budget).length;
	const hasTiming =
		timed.length > 0 ||
		view.routes.some(
			(route) =>
				route.validity_status !== 'historical' &&
				!route.no_scheduled_service &&
				['complete_timetable', 'assumed_timetable'].includes(route.timing_status)
		);
	const projected = view.routes.some(
		(route) => route.projection_status === 'published_pattern_projection'
	);
	return {
		reachable: hasTiming ? reachable : null,
		direct,
		transfer,
		unverified,
		projected,
		reason: !hasTiming
			? direct + transfer > 0
				? 'These islands are connected. Journey times are unconfirmed for this date and departure time.'
				: 'Current journey times are unconfirmed. Historical routes are shown separately; check current service with the operator.'
			: reachable > 0
				? `The timetable reaches ${reachable} ${reachable === 1 ? 'island' : 'islands'} within ${budgetMinutes} minutes, including waiting and transfers.`
				: `The timetable has no arrival within ${budgetMinutes} minutes after this departure time. Later sailings may be available.`
	};
}

export const seaColors = {
	direct: themeColors.color087f8c,
	transfer: themeColors.color566cc3,
	unverified: themeColors.colora48858,
	unknown: themeColors.color87939b,
	proposal: themeColors.colord08a28,
	improved: themeColors.color22824e
};

export function seaServiceDate(now = Date.now()): string {
	return new Date(now + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function seaClockMinutes(value: string): number | null {
	if (!/^\d{2}:\d{2}$/.test(value)) return null;
	const [hours, minutes] = value.split(':').map(Number);
	return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

export function seaClock(value: number | null | undefined): string {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'Time unverified';
	const minutes = Math.round(value);
	const day = Math.floor(minutes / 1440);
	return `${String(Math.floor((minutes % 1440) / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}${day ? ` +${day}d` : ''}`;
}

export function seaDuration(value: number | null | undefined): string {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return 'Unverified';
	const minutes = Math.ceil(value);
	if (minutes < 60) return `${minutes} min`;
	const remainder = minutes % 60;
	return `${Math.floor(minutes / 60)} hr${remainder ? ` ${remainder} min` : ''}`;
}

export function seaStatusLabel(status: SeaConnectionStatus): string {
	return {
		direct: 'Direct connection',
		transfer: 'With a transfer',
		unverified: 'Unverified connection',
		unknown: 'Connection details unavailable'
	}[status];
}

export function seaEvidenceLabel(evidence: SeaRoute['evidence']): string {
	return {
		confirmed_route: 'Official route · timetable unverified',
		official_route: 'Official route · timetable unverified',
		dated_service: 'Published timetable pattern',
		mapped_route: 'Route · current service unconfirmed',
		proposal: 'Your proposed service'
	}[evidence];
}

export function seaRouteEvidenceLabel(route: SeaRoute): string {
	if (route.validity_status === 'historical')
		return 'Historical route · current service unverified';
	if (route.projection_status === 'published_pattern_projection')
		return 'Timetable projection · confirm with operator';
	if (route.timing_status === 'departure_only') return 'Published departures · crossing unverified';
	return seaEvidenceLabel(route.evidence);
}

/** API evidence can repeat across operations; keyed UI lists need unique values. */
export function seaUniqueStrings(values: readonly string[] | null | undefined): string[] {
	return [...new Set(values ?? [])];
}

function searchText(value: string): string {
	return value
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLocaleLowerCase()
		.trim();
}

/** Network topology alone must never become a timed arrival in the interface. */
export function seaDestinations(
	view: SeaConnectionView | null,
	query: string,
	filter: 'all' | 'timed' | 'return',
	newIslandIds: string[] = []
): SeaDestination[] {
	const needle = searchText(query);
	const gained = new Set(newIslandIds);
	const unique = new Map<string, SeaDestination>();
	for (const destination of view?.destinations ?? []) {
		if (unique.has(destination.id)) continue;
		if (needle && !searchText(destination.name).includes(needle)) continue;
		if (filter === 'timed' && (!destination.journey || !destination.within_budget)) continue;
		if (
			filter === 'return' &&
			(!destination.journey ||
				!destination.within_budget ||
				destination.return_status !== 'feasible' ||
				!destination.return_journey)
		)
			continue;
		unique.set(destination.id, destination);
	}
	const rank: Record<SeaConnectionStatus, number> = {
		direct: 0,
		transfer: 1,
		unverified: 2,
		unknown: 3
	};
	return [...unique.values()].sort(
		(a, b) =>
			Number(gained.has(b.id)) - Number(gained.has(a.id)) ||
			Number(Boolean(b.journey && b.within_budget)) -
				Number(Boolean(a.journey && a.within_budget)) ||
			rank[a.status] - rank[b.status] ||
			(a.journey?.total_minutes ?? Infinity) - (b.journey?.total_minutes ?? Infinity) ||
			a.name.localeCompare(b.name)
	);
}

/** Keep selection styling independent of the API request and of timed feasibility. */
export function seaMapState(
	data: SeaConnections,
	mode: SeaConnectionMode,
	selectedDestinationId = '',
	selectedRouteId = ''
): SeaMapState {
	const view = (mode === 'scenario' ? data.scenario : null) ?? data.baseline;
	const currentMode = mode === 'scenario' && data.scenario ? 'scenario' : 'baseline';
	const gained = new Set(
		currentMode === 'scenario' ? data.comparison.newly_reachable_island_ids : []
	);
	const improved = new Set(
		currentMode === 'scenario' ? data.comparison.time_improved_island_ids : []
	);
	const selectedDestination = view.destinations.find((item) => item.id === selectedDestinationId);
	const routeIds = new Set(
		selectedDestination?.journey?.legs.map((leg) => leg.route_id) ??
			selectedDestination?.route_ids ??
			[]
	);
	if (selectedRouteId) routeIds.add(selectedRouteId);
	const features: FeatureCollection['features'] = view.map_features.features.map((feature) => {
		const properties = feature.properties ?? {};
		const islandId = String(properties.island_id ?? '');
		const routeId = String(properties.route_id ?? '');
		const proposed = properties.proposed === true || properties.evidence === 'proposal';
		const status = properties.status as SeaConnectionStatus;
		return {
			...feature,
			properties: {
				...properties,
				newly_reachable: gained.has(islandId),
				time_improved: improved.has(islandId),
				selected: islandId === selectedDestinationId || routeIds.has(routeId),
				dimmed: Boolean(
					(selectedDestinationId || selectedRouteId) && routeId && !routeIds.has(routeId)
				),
				color:
					gained.has(islandId) || improved.has(islandId)
						? seaColors.improved
						: proposed
							? seaColors.proposal
							: (seaColors[status] ??
								(properties.evidence === 'dated_service' ? seaColors.direct : seaColors.unverified))
			}
		};
	});
	if (validPoint(data.origin.coordinates))
		features.push({
			type: 'Feature',
			properties: {
				kind: 'sea_origin',
				island_id: data.origin.id,
				name: data.origin.name,
				selected: true,
				newly_reachable: false,
				time_improved: false,
				within_budget: false,
				color: themeColors.color213c4e
			},
			geometry: { type: 'Point', coordinates: data.origin.coordinates }
		});
	return {
		features: { type: 'FeatureCollection', features },
		destinations: view.destinations.map((item) => ({
			id: item.id,
			status: item.status,
			within_budget: Boolean(item.journey && item.within_budget),
			newly_reachable: gained.has(item.id),
			time_improved: improved.has(item.id)
		})),
		selectedDestinationId,
		selectedRouteId,
		originIslandId: data.origin.id,
		mode: currentMode
	};
}

export function seaSelectionBounds(
	view: SeaConnectionView,
	origin: SeaConnections['origin'],
	destinationId: string,
	routeId = ''
): [Coordinates, Coordinates] | null {
	const destination = view.destinations.find((item) => item.id === destinationId);
	const ids = new Set(
		destination?.journey?.legs.map((leg) => leg.route_id) ?? destination?.route_ids ?? []
	);
	if (routeId) ids.add(routeId);
	const points: Coordinates[] = [];
	for (const point of [origin.coordinates, destination?.coordinates])
		if (validPoint(point)) points.push(point);
	for (const route of view.routes) {
		if (!ids.has(route.id)) continue;
		for (const point of route.geometry?.coordinates ?? [])
			if (validPoint(point)) points.push(point);
	}
	if (!points.length) return null;
	return [
		[Math.min(...points.map((point) => point[0])), Math.min(...points.map((point) => point[1]))],
		[Math.max(...points.map((point) => point[0])), Math.max(...points.map((point) => point[1]))]
	];
}

/** Frame documented connections once when opening an island, without moving on filter changes. */
export function seaNetworkBounds(
	view: SeaConnectionView,
	origin: SeaConnections['origin']
): [Coordinates, Coordinates] | null {
	const points: Coordinates[] = [];
	for (const point of [origin.coordinates, ...view.destinations.map((item) => item.coordinates)])
		if (validPoint(point)) points.push(point);
	for (const route of view.routes)
		for (const point of route.geometry?.coordinates ?? [])
			if (validPoint(point)) points.push(point);
	if (points.length < 2) return null;
	return [
		[Math.min(...points.map((point) => point[0])), Math.min(...points.map((point) => point[1]))],
		[Math.max(...points.map((point) => point[0])), Math.max(...points.map((point) => point[1]))]
	];
}
