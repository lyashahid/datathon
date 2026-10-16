import type { FeatureCollection } from 'geojson';
import type { PlanningOperation } from './planning-map.js';
import type { PlanningEconomics, PlanningReviewRequest } from './proposal-review.js';
import type { Coordinates } from './types.js';
import type { TransportImpactData } from './transport-impact.js';

export type FerryTerminal = {
	id: string;
	name: string;
	island_id: string;
	coordinates: Coordinates;
	source: string;
	evidence: string;
};
export type FerryIsland = { id: string; name: string; coordinates: Coordinates | null };
export type FerryConnectivity = {
	origin: FerryIsland;
	destination: FerryIsland | null;
	terminals: { origin: FerryTerminal[]; destination: FerryTerminal[] };
	status: 'dated_service' | 'mapped_route' | 'no_verified_service' | 'terminal_evidence_needed';
	links: {
		id: string;
		from_island_id: string;
		to_island_id: string;
		name: string;
		mode: 'bus' | 'ferry';
		evidence: 'dated_service' | 'mapped_route';
		geometry: number[][];
		departure_count: number | null;
	}[];
	reachable_islands: { id: string; name: string; transfers: number; evidence: string }[];
	reasons: string[];
	map_features: FeatureCollection;
	local_transport?: {
		bus_stop_count: number;
		planning_bus_stop_count: number;
		ferry_terminal_count: number;
		walk_target_minutes: number;
		status: 'modeled' | 'outside_snapshot';
		population: number | null;
		residents_within_walk_target: number | null;
		resident_coverage_pct: number | null;
		unknown_residents: number | null;
		qualification: string;
	};
};
export type FerryDraft = {
	status: 'ready' | 'evidence_needed';
	operations: PlanningOperation[];
	map_features: FeatureCollection;
	summary: {
		name: string;
		distance_km: number;
		crossing_minutes: number;
		departures_each_direction: number;
		headway_minutes: number;
		terminal_construction_mvr: 0;
		origin_terminal: FerryTerminal;
		destination_terminal: FerryTerminal;
		geometry_source?: 'coastline_avoiding_planning_corridor';
		geometry_qualification?: string;
		qualification: string;
	} | null;
	quote: {
		economics: PlanningEconomics;
		transport_connectivity?: { impact?: TransportImpactData };
		budget: { allowed: boolean; reasons: string[] };
	} | null;
	reasons: string[];
};
export type FerryServiceSettings = {
	destinationId: string;
	originTerminalId?: string;
	destinationTerminalId?: string;
	headway: number | string;
	start: string;
	end: string;
	speed: number | string;
};

export function ferryConnectionLabel(status: FerryConnectivity['status']) {
	return {
		dated_service: 'A published service connects these islands',
		mapped_route: 'A connection is mapped; its timetable needs verification',
		no_verified_service: 'No verified service in the available data',
		terminal_evidence_needed: 'Check the landing places before planning a service'
	}[status];
}

function clockMinutes(value: string): number | null {
	if (!/^\d{2}:\d{2}$/.test(value)) return null;
	const [hours, minutes] = value.split(':').map(Number);
	return hours < 24 && minutes < 60 ? hours * 60 + minutes : null;
}

/** Preserve the inspected service day without accepting an invalid handoff date. */
export function ferryPlanningDate(value: unknown): string | null {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000'))
		return null;
	const parsed = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
		? value
		: null;
}

/** Incomplete plans never become an apparently free or ready-to-add ferry service. */
export function ferryServiceInput(
	originId: string | null,
	settings: FerryServiceSettings,
	request: PlanningReviewRequest
):
	| { error: string; payload: null }
	| {
			error: '';
			payload: {
				origin_island_id: string;
				destination_island_id: string;
				origin_terminal_id?: string;
				destination_terminal_id?: string;
				headway_minutes: number;
				start_minutes: number;
				end_minutes: number;
				speed_kph: number;
				assumptions: PlanningReviewRequest['assumptions'];
				operations: PlanningOperation[];
			};
	  } {
	if (!originId || !settings.destinationId)
		return { error: 'Choose a destination island to check its connection.', payload: null };
	if (originId === settings.destinationId)
		return { error: 'Choose a different island for this ferry service.', payload: null };
	const headway = settings.headway === '' ? NaN : Number(settings.headway);
	const speed = settings.speed === '' ? NaN : Number(settings.speed);
	const start = clockMinutes(settings.start);
	const end = clockMinutes(settings.end);
	if (!Number.isInteger(headway) || headway < 15 || headway > 720)
		return { error: 'Choose a departure interval between 15 and 720 minutes.', payload: null };
	if (!Number.isFinite(speed) || speed < 10 || speed > 60)
		return { error: 'Choose an assumed sailing speed between 10 and 60 km/h.', payload: null };
	if (start === null || end === null || end <= start)
		return { error: 'Choose an end time later than the first departure.', payload: null };
	return {
		error: '',
		payload: {
			origin_island_id: originId,
			destination_island_id: settings.destinationId,
			...(settings.originTerminalId ? { origin_terminal_id: settings.originTerminalId } : {}),
			...(settings.destinationTerminalId
				? { destination_terminal_id: settings.destinationTerminalId }
				: {}),
			headway_minutes: headway,
			start_minutes: start,
			end_minutes: end,
			speed_kph: speed,
			assumptions: request.assumptions,
			operations: request.operations
		}
	};
}

/** The server quote must describe this exact draft, destination and both spending limits. */
export function canConfirmFerry(
	draft: FerryDraft | null,
	quotedSignature: string,
	currentSignature: string,
	checking: boolean
) {
	return (
		!checking &&
		quotedSignature === currentSignature &&
		draft?.status === 'ready' &&
		draft.operations.length > 0 &&
		draft.quote?.budget.allowed === true
	);
}

export function ferryFeatureBounds(features: FeatureCollection): [Coordinates, Coordinates] | null {
	const points: number[][] = [];
	for (const feature of features.features) {
		if (feature.geometry.type === 'Point') points.push(feature.geometry.coordinates);
		else if (feature.geometry.type === 'LineString') points.push(...feature.geometry.coordinates);
	}
	const valid = points.filter(
		(point) =>
			point.length >= 2 &&
			point.slice(0, 2).every(Number.isFinite) &&
			Math.abs(point[0]) <= 180 &&
			Math.abs(point[1]) <= 90
	);
	return valid.length
		? [
				[Math.min(...valid.map((point) => point[0])), Math.min(...valid.map((point) => point[1]))],
				[Math.max(...valid.map((point) => point[0])), Math.max(...valid.map((point) => point[1]))]
			]
		: null;
}
