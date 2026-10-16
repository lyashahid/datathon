import { describe, expect, it } from 'vitest';
import { locationFromInput, providerRouteCoordinates, routeEndpointsMatch } from './map-location';

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

describe('route and boarding-point selection', () => {
	it('retains the same accepted snapped route and stops within its declared tolerance', () => {
		expect(
			routeEndpointsMatch([73.5, 4.2], [73.51, 4.21], [73.5, 4.2002], [73.51, 4.2101], 30)
		).toBe(true);
		expect(routeEndpointsMatch([73.5, 4.2], [73.51, 4.21], [73.5, 4.2002], [73.51, 4.2101])).toBe(
			false
		);
	});
	it('hides stale results when either selected endpoint moves beyond the supplied snap', () => {
		expect(routeEndpointsMatch([73.5, 4.2], [73.51, 4.21], [73.5, 4.201], null, 30)).toBe(false);
		expect(routeEndpointsMatch([73.5, 4.2], [73.51, 4.21], null, [73.51, 4.211], 30)).toBe(false);
	});
	it('requires valid calculated endpoints and rejects unusable tolerance metadata', () => {
		expect(routeEndpointsMatch(undefined, [73.51, 4.21], null, null)).toBe(false);
		expect(routeEndpointsMatch([73.5, NaN], [73.51, 4.21], null, null)).toBe(false);
		expect(routeEndpointsMatch([73.5, 4.2], [73.51, 4.21], [73.5, 4.2002], null, Infinity)).toBe(
			false
		);
		expect(routeEndpointsMatch([73.5, 4.2], [73.51, 4.21], null, null)).toBe(true);
	});
});
