import type { FeatureCollection, LineString } from 'geojson';
import type { Coordinates } from './types.js';
import { seaPressureColors } from './sea-connectivity.js';

export type AirAirport = {
	id: string;
	iata: string;
	icao: string | null;
	name: string;
	island_id: string | null;
	coordinates: Coordinates;
	coordinate_source_id: string;
	source_feature_id: string;
};

export type AirRoute = {
	id: string;
	name: string;
	operator: string;
	from_iata: string;
	to_iata: string;
	via_iata?: string[];
	itinerary_iata?: string[];
	legs?: {
		id: string;
		index: number;
		from_iata: string;
		to_iata: string;
		from_airport: AirAirport | null;
		to_airport: AirAirport | null;
		bidirectional: boolean;
		geometry: LineString | null;
	}[];
	from_airport_id: string;
	to_airport_id: string;
	from_airport: AirAirport | null;
	to_airport: AirAirport | null;
	from_island_id: string | null;
	to_island_id: string | null;
	bidirectional: boolean;
	evidence: 'published_route' | 'historical_timetable';
	source_ids: string[];
	valid_from: string | null;
	valid_until: string | null;
	validity_status: string;
	qualification: string;
	geometry: LineString | null;
	geometry_basis: string;
	geometry_qualification: string;
	schedule: {
		status: string;
		departures: number[];
		departures_per_day: number | null;
		departures_per_week: number | null;
		qualification: string;
	};
	published_schedule?: {
		publication_date?: string;
		description?: string;
		departures?: {
			from_iata: string;
			to_iata: string;
			iso_weekdays: number[];
			departure_times: string[];
		}[];
		[key: string]: unknown;
	} | null;
	pressure: {
		level: 'low' | 'medium' | 'high' | 'unknown';
		label: string;
		explanation: string;
		departures_per_week: number | null;
		capacity: number | null;
		ridership: number | null;
		load_factor: number | null;
	};
	live_linkage: { status: string; flight_ids: string[]; qualification: string };
};

export type AirNetwork = {
	service_date: string;
	timezone: string;
	retrieved_at: string | null;
	routes: AirRoute[];
	airports: AirAirport[];
	map_features: FeatureCollection;
	sources: {
		id: string;
		title: string;
		url: string | null;
		publisher?: string;
		qualification?: string;
	}[];
	coverage: Record<string, unknown>;
};

/** Pressure needs published route-level evidence; missing evidence stays visibly unknown. */
export function airNetworkFeatures(network: AirNetwork): FeatureCollection {
	const neighbours = new Map<string, Set<string>>();
	const regionalNeighbours = new Map<string, Set<string>>();
	for (const feature of network.map_features.features) {
		if (feature.geometry.type !== 'LineString') continue;
		const from = String(feature.properties?.from_iata ?? '');
		const to = String(feature.properties?.to_iata ?? '');
		if (!from || !to) continue;
		for (const [origin, destination] of [
			[from, to],
			[to, from]
		]) {
			if (!neighbours.has(origin)) neighbours.set(origin, new Set());
			neighbours.get(origin)!.add(destination);
			if (from === 'MLE' || to === 'MLE') continue;
			if (!regionalNeighbours.has(origin)) regionalNeighbours.set(origin, new Set());
			regionalNeighbours.get(origin)!.add(destination);
		}
	}
	return {
		type: 'FeatureCollection',
		features: [
			...network.map_features.features.map((feature) => {
				const level = feature.properties?.pressure_level as keyof typeof seaPressureColors;
				return {
					...feature,
					properties: {
						...feature.properties,
						connection_role:
							feature.properties?.connection_role ??
							(feature.properties?.from_iata === 'MLE' || feature.properties?.to_iata === 'MLE'
								? 'hub'
								: 'regional'),
						color: seaPressureColors[level] ?? seaPressureColors.unknown,
						label: `${feature.properties?.name ?? 'Domestic flight'} · schematic connection · select for details`
					}
				};
			}),
			...network.airports.map((airport) => ({
				type: 'Feature' as const,
				id: airport.id,
				geometry: { type: 'Point' as const, coordinates: airport.coordinates },
				properties: {
					...airport,
					kind: 'air_airport',
					connection_count: neighbours.get(airport.iata)?.size ?? 0,
					regional_connections: regionalNeighbours.get(airport.iata)?.size ?? 0,
					label: `${airport.name} · ${airport.iata} · ${neighbours.get(airport.iata)?.size ?? 0} connections`
				}
			}))
		]
	};
}
