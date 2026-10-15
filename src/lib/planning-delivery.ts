export type CalibrationRecord = {
	id: string;
	factor: string;
	value: number;
	unit: string;
	title: string;
	publisher: string;
	source_url: string;
	published_date: string;
	valid_from: string;
	valid_to: string | null;
	geography: string;
	basis: string;
	evidence_type: 'official_statistic' | 'operator_quote' | 'measurement' | 'assumption';
	source_sha256: string | null;
};
export type FleetResources = {
	activity_id: string;
	available_vehicles?: number;
	vehicle_capacity?: number;
	peak_passengers_per_departure?: number;
	max_vehicle_duty_hours?: number;
	depot_stop_ids?: string[];
	battery_kwh?: number;
	battery_reserve_share?: number;
	energy_kwh_per_km?: number;
	charger_count?: number;
	charger_power_kw?: number;
	overnight_charging_hours?: number;
	charging_efficiency?: number;
};
export type ResourceAudit = {
	status: string;
	checks: {
		key: string;
		status: string;
		required: unknown;
		available: unknown;
		explanation: string;
	}[];
	meaning: string;
};
