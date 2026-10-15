import { describe, expect, it } from 'vitest';
import { locationFromInput, providerRouteCoordinates } from './map-location';

describe('visual location selection boundaries', () => {
	it('does not turn empty advanced fields into a location at zero', () => {
		expect(locationFromInput('', 73.5)).toBeNull();
		expect(locationFromInput(4.1, ' ')).toBeNull();
		expect(locationFromInput('4.1', '73.5')).toEqual({ latitude: 4.1, longitude: 73.5 });
	});
	it('rejects nonfinite and out of range locations while accepting zero', () => {
		expect(locationFromInput(91, 73)).toBeNull();
		expect(locationFromInput(4, Infinity)).toBeNull();
		expect(locationFromInput(0, 0)).toEqual({ latitude: 0, longitude: 0 });
	});
	it('preserves provider vertices and never connects across invalid route points', () => {
		expect(
			providerRouteCoordinates([
				[73.5, 4.1],
				[73.6, 4.2]
			])
		).toEqual([
			[73.5, 4.1],
			[73.6, 4.2]
		]);
		expect(providerRouteCoordinates([[73.5, 4.1], null, [73.6, 4.2]])).toEqual([]);
		expect(providerRouteCoordinates([[73.5, 4.1]])).toEqual([]);
		expect(
			providerRouteCoordinates([
				[73.5, 4.1],
				[73.6, 91]
			])
		).toEqual([]);
	});
});
