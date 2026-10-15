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

/** Match the planning API bounds before an invalid envelope becomes part of a saved draft. */
export function fleetResourceError(resource: FleetResources): string | null {
	const constraints: {
		key: keyof FleetResources;
		label: string;
		minimum: number;
		maximum: number;
		exclusiveMinimum?: boolean;
		exclusiveMaximum?: boolean;
		integer?: boolean;
	}[] = [
		{
			key: 'available_vehicles',
			label: 'Available vehicles',
			minimum: 0,
			maximum: 10000,
			integer: true
		},
		{
			key: 'vehicle_capacity',
			label: 'Onboard capacity',
			minimum: 0,
			maximum: 10000,
			exclusiveMinimum: true,
			integer: true
		},
		{ key: 'peak_passengers_per_departure', label: 'Peak passengers', minimum: 0, maximum: 1e6 },
		{
			key: 'max_vehicle_duty_hours',
			label: 'Maximum vehicle duty',
			minimum: 0,
			maximum: 48,
			exclusiveMinimum: true
		},
		{
			key: 'battery_kwh',
			label: 'Battery capacity',
			minimum: 0,
			maximum: 100000,
			exclusiveMinimum: true
		},
		{
			key: 'battery_reserve_share',
			label: 'Protected battery reserve',
			minimum: 0,
			maximum: 1,
			exclusiveMaximum: true
		},
		{
			key: 'energy_kwh_per_km',
			label: 'Battery consumption',
			minimum: 0,
			maximum: 100,
			exclusiveMinimum: true
		},
		{
			key: 'charger_count',
			label: 'Dedicated chargers',
			minimum: 0,
			maximum: 10000,
			integer: true
		},
		{
			key: 'charger_power_kw',
			label: 'Charger power',
			minimum: 0,
			maximum: 10000,
			exclusiveMinimum: true
		},
		{
			key: 'overnight_charging_hours',
			label: 'Charging window',
			minimum: 0,
			maximum: 24,
			exclusiveMinimum: true
		},
		{
			key: 'charging_efficiency',
			label: 'Charging efficiency',
			minimum: 0,
			maximum: 1,
			exclusiveMinimum: true
		}
	];
	for (const constraint of constraints) {
		const value = resource[constraint.key];
		if (value === undefined) continue;
		if (typeof value !== 'number' || !Number.isFinite(value))
			return `${constraint.label} must be a finite number, or left blank when unknown.`;
		if (constraint.integer && !Number.isInteger(value))
			return `${constraint.label} must be a whole number.`;
		if (
			(constraint.exclusiveMinimum ? value <= constraint.minimum : value < constraint.minimum) ||
			(constraint.exclusiveMaximum ? value >= constraint.maximum : value > constraint.maximum)
		)
			return `${constraint.label} is outside the supported range. Check the value before saving.`;
	}
	return null;
}
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
