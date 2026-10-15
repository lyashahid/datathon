import type { FeatureCollection } from 'geojson';
import type { Coordinates } from './types.js';
import type { PlanningOperation } from './planning-map.js';
import type { PlanningEconomics } from './proposal-review.js';
export type BusConnectionDraft = {
	status: 'ready' | 'evidence_needed';
	candidates: {
		stop: { id: string; name: string; coordinates: Coordinates; serving_routes?: string[] };
		distance_m: number;
		roundtrip_distance_m: number;
		travel_minutes: number;
		return_travel_minutes: number;
		geometry: number[][];
		return_geometry: number[][];
	}[];
	selected_stop_id: string | null;
	operations: PlanningOperation[];
	map_features: FeatureCollection;
	summary: {
		name: string;
		new_stop_id: string;
		target_stop: { id: string; name: string; coordinates: Coordinates; serving_routes: string[] };
		distance_km: number;
		roundtrip_distance_km: number;
		travel_minutes: number;
		return_travel_minutes: number;
		roundtrip_minutes: number;
		departures_each_direction: number;
		headway_minutes: number;
		speed_kph: number;
		road_snap_distance_m: number;
		service_date: string;
		both_directions: boolean;
		fleet: 'diesel' | 'electric';
		qualification: string;
	} | null;
	quote: {
		economics: PlanningEconomics;
		budget: {
			allowed: boolean;
			reasons: string[];
			capital: { remaining_mvr: number | null };
			annual_operating?: { remaining_mvr: number | null };
		};
	} | null;
	reasons: string[];
};
