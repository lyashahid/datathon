import type { Feature, FeatureCollection, Geometry } from 'geojson';
import type { ExploreJourney } from './explore-journey.js';

export type Coordinates = [number, number];
export type MapFeatures = FeatureCollection<Geometry | null>;
export type IslandFeature = Feature<
	Geometry,
	{
		id: string;
		name: string;
		atoll?: string;
		category?: string;
		centroid?: Coordinates;
		area_ha?: number;
	}
>;
export interface NationalSummary {
	island_count: number;
	facility_count: number;
	population_record_count: number;
	population_attached_count: number;
	facility_categories: Record<string, number>;
	facility_match_status: Record<string, number>;
	osm: { feature_count: number; feature_categories: Record<string, number> };
}
export interface Facility {
	id: string;
	name: string;
	category: string;
	geometry?: Geometry;
	geometry_quality?: string;
	match_status?: string;
	source?: string;
	island_id?: string;
}
export interface TransportFeature extends Facility {
	geometry: Geometry;
}
export interface Accessibility {
	island_id: string;
	score: number;
	confidence: number;
	domains: Record<string, { score: number; best_distance_m?: number; missing_data: string[] }>;
	missing_data: string[];
	explanation: string[] | string;
	config: Record<string, unknown>;
}
export interface IslandProfile {
	island: {
		id: string;
		name: string;
		atoll?: string;
		category?: string;
		centroid?: Coordinates;
		area_ha?: number;
	};
	population: {
		total: number | null;
		year: number | null;
		source: string | null;
		source_url?: string | null;
		status?: 'census' | 'unavailable';
		qualification?: string;
		localities?: string[];
		record_count: number;
		school_age?: number;
		older_adult?: number;
		demographic_breakdown: boolean;
	};
	infrastructure: { items: Facility[]; total: number };
	transport: { items: TransportFeature[]; total: number };
	accessibility: Accessibility | null;
	data_quality: {
		warnings: string[];
		unresolved_facility_count: number;
		provisional_facility_count: number;
		official_facility_count: number;
	};
}
export type OperationType =
	| 'add_bus_stop'
	| 'move_bus_stop'
	| 'remove_bus_stop'
	| 'add_ferry_terminal'
	| 'move_ferry_terminal'
	| 'disable_ferry_terminal'
	| 'add_ferry_route'
	| 'remove_ferry_route'
	| 'change_ferry_route'
	| 'add_parking'
	| 'add_park_and_ride'
	| 'add_mobility_hub'
	| 'road_closure'
	| 'pedestrian_connection'
	| 'airport_access_improvement'
	| 'weather_disruption';
export interface ScenarioOperation {
	type: OperationType;
	island_id?: string | null;
	coordinates?: Coordinates | null;
	target_id?: string | null;
	from_node_id?: string | null;
	to_node_id?: string | null;
	distance_m?: number | null;
	mode?: string | null;
	passenger_eligible?: boolean;
	bidirectional?: boolean;
	disabled_modes?: string[];
	metadata?: Record<string, unknown>;
}
export interface Scenario {
	id: string;
	name: string;
	operations: ScenarioOperation[];
	metadata?: Record<string, unknown>;
}
export interface Simulation {
	scenario: Scenario;
	baseline: Record<string, number>;
	effective_world: Record<string, number>;
	delta: Record<string, number>;
	operations_applied: { type: string; operation_id: string; applied: boolean }[];
	warnings: string[];
}
export interface Comparison {
	first: Simulation;
	second: Simulation;
	delta: Record<string, number>;
}
export interface Recommendation {
	id: string;
	type: string;
	island_id: string;
	island_name: string;
	score: number;
	expected_benefit: number;
	confidence: number;
	reason: string;
	trade_offs: string[];
	assumptions: string[];
	planning_screening_disclaimer: string;
	scenario: Scenario;
	simulation: { delta: Record<string, number>; warnings: string[] };
}
export interface RecommendationResponse {
	recommendations: Recommendation[];
	summary: { candidate_count: number; returned_count: number };
	disclaimer?: string;
	assumptions?: string[];
}
export interface LandRoute {
	status: string;
	reason?: string;
	mode?: string;
	distance_m?: number;
	snap_distance_m?: number;
	geometry?: Coordinates[];
	path_node_ids?: string[];
	graph_version?: string;
	journey?: ExploreJourney;
}
export interface LiveEvent {
	id: string;
	kind: 'aircraft' | 'vessel' | 'bus';
	provider: string;
	position: { latitude: number; longitude: number };
	observed_at: string | null;
	retrieved_at: string;
	stale: boolean;
	properties: Record<string, unknown>;
}
export interface LiveProvider {
	provider: string;
	display_name?: string;
	source_url?: string;
	enabled: boolean;
	status: string;
	event_count: number;
	message?: string;
	error?: string;
}
export interface LiveStatus {
	providers: LiveProvider[];
	poll_interval_seconds: number;
	deterministic_data_affected: boolean;
}
export interface LiveSnapshot {
	events: LiveEvent[];
	providers: LiveProvider[];
	retrieved_at: string;
	coverage: string;
	deterministic_data_affected: boolean;
	poll_interval_seconds?: number;
}
