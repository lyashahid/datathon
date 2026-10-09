import { describe, expect, it } from 'vitest';
import {
	formatDistance,
	formatLatLng,
	formatMetadataValue,
	formatMinutes,
	formatPopulation,
	humanizeKey
} from './format.ts';

describe('format', () => {
	it('humanises camelCase and snake_case keys', () => {
		expect(humanizeKey('dailyBoardings')).toBe('Daily boardings');
		expect(humanizeKey('bus_stop')).toBe('Bus stop');
	});

	it('formats metadata scalars', () => {
		expect(formatMetadataValue(true)).toBe('Yes');
		expect(formatMetadataValue(2100000)).toBe('2,100,000');
		expect(formatMetadataValue(null)).toBe('—');
	});

	it('rounds estimates to avoid false precision', () => {
		expect(formatPopulation(21_734)).toBe('≈21,700');
		expect(formatPopulation(437)).toBe('≈440');
		expect(formatPopulation(7.4)).toBe('≈7');
		expect(formatDistance(643)).toBe('640 m');
		expect(formatDistance(1875)).toBe('1.9 km');
		expect(formatMinutes(0.2)).toBe('1 min');
	});

	it('formats coordinates with hemispheres', () => {
		expect(formatLatLng(73.5, -0.69, 2)).toBe('0.69°S 73.50°E');
	});
});
