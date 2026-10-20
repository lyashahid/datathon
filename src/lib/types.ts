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
	transport?: {
		feature_count: number;
		feature_categories: Record<string, number>;
		additional_national_boarding_point_count?: number;
	};
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
	tags?: Record<string, string>;
}
export interface TransportFeature extends Facility {
	geometry: Geometry;
}
export interface AccessibilityAssessment {
	score: number;
	out_of: number;
	label: string;
	summary: string;
	reasons: { domain: string; score: number; text: string }[];
	coverage: {
		status: string;
		label: string;
		note: string;
		population_available: boolean;
		scored_domains: number;
		total_domains: number;
	};
	components: Record<
		string,
		{
			score: number;
			facility_count?: number;
			bus_stop_count?: number;
			airport_count?: number;
			marine_terminal_count?: number;
		}
	>;
	limitations: string[];
}
export interface IslandPopulation {
	total: number | null;
	year: number | null;
	source?: string | null;
	source_url?: string | null;
	status?: 'census' | 'unavailable';
	qualification?: string;
	localities?: string[];
	record_count?: number;
	school_age?: number | null;
	early_childhood?: number | null;
	older_adult?: number | null;
	working_age?: number | null;
	demographic_breakdown?: boolean;
	by_age_sex?: Record<string, { both?: number; female?: number; male?: number }>;
	by_sex?: { both?: number; female?: number; male?: number };
	by_nationality?: { total?: number; Maldivian?: number; foreign?: number };
	area_ha?: number | null;
	area_km2?: number | null;
	density_persons_per_km2?: number | null;
	density_pressure_score?: number | null;
	density_data_available?: boolean;
}
export interface AccessibilityDomainEvidence {
	score: number;
	best_distance_m?: number | null;
	distance_method?: string | null;
	missing_data: string[];
	population_pressure_factor?: number;
	density_factor?: number;
	mapped_counts?: {
		bus_stop_count?: number;
		airport_count?: number;
		marine_terminal_count?: number;
	};
	ferry_access?: 'available' | 'provisional' | 'none';
}
export interface Accessibility {
	island_id: string;
	score: number;
	confidence: number;
	domains: Record<string, AccessibilityDomainEvidence>;
	missing_data: string[];
	explanation: string[] | string;
	config: Record<string, unknown>;
	assessment?: AccessibilityAssessment;
	population?: IslandPopulation;
}
export interface OfficialIslandDemographics {
	island_id: string;
	year: number;
	residents_total: number | null;
	maldivians_total: number | null;
	residents_female?: number | null;
	residents_male?: number | null;
	foreigners_total?: number | null;
	maldivian_children_0_17_total: number | null;
	maldivian_children_0_14_total?: number | null;
	maldivian_working_age_15_64_total?: number | null;
	maldivian_older_adults_65_plus_total: number | null;
}
export interface OfficialIslandProjection {
	island_id: string;
	year: number;
	residents_total: number | null;
	basis: string;
}
export interface OfficialIslandEmployment {
	island_id: string;
	year: number;
	population_scope: string;
	sex: string;
	unemployment_rate: number | null;
	labour_force_participation_rate: number | null;
}
export interface OfficialIslandContext {
	status: 'available' | 'unavailable';
	geography_grain: 'administrative_island';
	census_demographics: OfficialIslandDemographics | null;
	employment: OfficialIslandEmployment[];
	projections: OfficialIslandProjection[];
	transform_version: string | null;
	sources: { id: string; title: string; url: string; reference_year: number | string }[];
	qualifications: string[];
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
	population: IslandPopulation;
	official_island_context?: OfficialIslandContext;
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
	position_age_seconds?: number | null;
	position_time_quality?: 'provider_observed' | 'retrieval_only';
	source_quality?: string;
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
