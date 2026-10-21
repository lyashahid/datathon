import { describe, expect, it } from 'vitest';
import {
	taxiChoices,
	taxiSelection,
	vesselCalendar,
	type IslandMobility
} from './island-mobility.js';

const profile = { ride_count: 100, median_minutes: 12, p90_minutes: 18, recorded_speed_kph: 30 };
const corridor = { ...profile, pickup_zone: 'hulhumale', dropoff_zone: 'hulhule' };

describe('island historical context', () => {
	it('selects a retained corridor/hour without pooling or falling back to the all-day median', () => {
		const taxi: IslandMobility['taxis'] = {
			status: 'available',
			outbound_corridors: [corridor],
			outbound_hourly: [{ ...corridor, hour: 7, ride_count: 40, median_minutes: 14 }]
		};
		expect(taxiSelection(taxi, 'hulhumale:hulhule', null).selected).toEqual(corridor);
		expect(taxiSelection(taxi, 'hulhumale:hulhule', 7).selected?.median_minutes).toBe(14);
		expect(taxiSelection(taxi, 'hulhumale:hulhule', 8).selected).toBeUndefined();
	});
	it('deduplicates within-island profiles in both direction lists', () => {
		const internal = { ...corridor, dropoff_zone: 'hulhumale' };
		const taxi = {
			status: 'available',
			outbound_corridors: [internal, corridor],
			inbound_corridors: [internal],
			outbound_hourly: [{ ...internal, hour: 7 }],
			inbound_hourly: [{ ...internal, hour: 7 }]
		};
		expect(taxiChoices(taxi)).toHaveLength(2);
		expect(taxiSelection(taxi, 'hulhumale:hulhumale', 7).selected?.ride_count).toBe(100);
	});
	it('keeps vessel observation gaps unknown and respects calendar length', () => {
		const days = vesselCalendar({
			status: 'available',
			period: { from: '2025-02-01', through: '2025-02-28' },
			daily: [{ date: '2025-02-02', tracked_devices: 3 }]
		});
		expect(days).toHaveLength(28);
		expect(days[0].tracked_devices).toBeNull();
		expect(days[1].tracked_devices).toBe(3);
		expect(vesselCalendar({ status: 'unavailable' })).toEqual([]);
	});
});
