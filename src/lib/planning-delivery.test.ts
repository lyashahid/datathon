import { describe, expect, it } from 'vitest';
import { fleetResourceError, type FleetResources } from './planning-delivery.js';

describe('fleet resource draft validation', () => {
	it('keeps unknown optional values blank and accepts API boundary values', () => {
		expect(fleetResourceError({ activity_id: 'bus:diesel' })).toBeNull();
		expect(
			fleetResourceError({
				activity_id: 'bus:electric',
				available_vehicles: 0,
				vehicle_capacity: 10000,
				peak_passengers_per_departure: 1e6,
				max_vehicle_duty_hours: 48,
				battery_kwh: 100000,
				battery_reserve_share: 0,
				energy_kwh_per_km: 100,
				charger_count: 10000,
				charger_power_kw: 10000,
				overnight_charging_hours: 24,
				charging_efficiency: 1
			})
		).toBeNull();
	});

	it.each(['available_vehicles', 'vehicle_capacity', 'charger_count'] as const)(
		'rejects fractional %s rather than poisoning the saved proposal',
		(key) => {
			expect(fleetResourceError({ activity_id: 'bus:electric', [key]: 1.5 })).toContain(
				'whole number'
			);
		}
	);

	it.each([
		['available_vehicles', -1],
		['available_vehicles', 10001],
		['vehicle_capacity', 0],
		['vehicle_capacity', 10001],
		['peak_passengers_per_departure', -1],
		['peak_passengers_per_departure', 1e6 + 1],
		['max_vehicle_duty_hours', 0],
		['max_vehicle_duty_hours', 49],
		['battery_kwh', 0],
		['battery_kwh', 100001],
		['battery_reserve_share', -0.1],
		['battery_reserve_share', 1],
		['energy_kwh_per_km', 0],
		['energy_kwh_per_km', 101],
		['charger_count', -1],
		['charger_count', 10001],
		['charger_power_kw', 0],
		['charger_power_kw', 10001],
		['overnight_charging_hours', 0],
		['overnight_charging_hours', 25],
		['charging_efficiency', 0],
		['charging_efficiency', 1.01]
	] as [keyof FleetResources, number][])(
		'blocks unsupported %s = %s before it enters the proposal',
		(key, value) => {
			expect(fleetResourceError({ activity_id: 'bus:electric', [key]: value })).toContain(
				'outside the supported range'
			);
		}
	);

	it('rejects non-finite resources even if introduced by a restored draft', () => {
		for (const value of [Number.NaN, Infinity, -Infinity])
			expect(fleetResourceError({ activity_id: 'bus:electric', battery_kwh: value })).toContain(
				'finite number'
			);
	});
});
