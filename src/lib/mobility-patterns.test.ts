import { describe, expect, it } from 'vitest';
import { airportHours, busiestHour } from './mobility-patterns.js';

describe('historical activity profiles', () => {
	it('pools only additive counts within the selected year and event', () => {
		const rows = [
			{
				year: 2025,
				hour: 11,
				event: 'arrival',
				region: 'Europe',
				passengers: 100,
				movement_records: 1
			},
			{
				year: 2025,
				hour: 11,
				event: 'arrival',
				region: 'South Asia',
				passengers: 50,
				movement_records: 2
			},
			{
				year: 2025,
				hour: 11,
				event: 'departure',
				region: 'Europe',
				passengers: 999,
				movement_records: 3
			},
			{
				year: 2026,
				hour: 11,
				event: 'arrival',
				region: 'Europe',
				passengers: 999,
				movement_records: 3
			}
		];
		expect(airportHours(rows, 2025, 'arrival')[11]).toEqual({
			hour: 11,
			passengers: 150,
			movement_records: 3,
			observed: true
		});
		expect(busiestHour([])).toBeNull();
	});
});
