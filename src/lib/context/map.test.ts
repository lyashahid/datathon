import { describe, expect, it } from 'vitest';
import { transportContextSymbols } from './map.ts';
import type { ContextDataset, TransportContext } from './types.ts';

const dataset = <T>(records: T[]): ContextDataset<T> => ({
	enabled: true,
	status: 'partial',
	version: 'v1',
	generatedAt: '2026-10-10T00:00:00Z',
	stale: false,
	gapReasons: [],
	sources: [],
	records
});
const bundle: TransportContext = {
	schemaVersion: 1,
	version: 'test',
	generatedAt: '2026-10-10T00:00:00Z',
	followme: dataset([
		{
			id: 'v1',
			name: 'Cargo',
			type: 'Supply Dhoni',
			coordinates: [73.53, 4.2],
			speedKnots: 0,
			headingDeg: 10,
			observedAtRaw: '2026-10-10 05:00:00',
			observedTimezone: null,
			sourceUrl: 'https://m.followme.mv/public/',
			retrievedAt: '2026-10-10T00:00:00Z'
		},
		{
			id: 'v2',
			name: 'Unlocated',
			type: 'Speedboat',
			coordinates: null,
			speedKnots: null,
			headingDeg: null,
			observedAtRaw: null,
			observedTimezone: null,
			sourceUrl: 'https://m.followme.mv/public/',
			retrievedAt: '2026-10-10T00:00:00Z'
		}
	]),
	mpl: {
		...dataset([
			{
				id: 'call',
				vesselName: 'At port',
				activity: 'Arrival',
				date: null,
				berth: null,
				sourceId: 'mpl'
			}
		]),
		observations: []
	},
	aviation: dataset([])
};

describe('transport observation map', () => {
	it('maps only source-provided boat coordinates and the fixed airport facility', () => {
		const result = transportContextSymbols(bundle, true, true);
		expect(result.features.map((feature) => feature.properties?.id)).toEqual(['v1', 'airport-via']);
		expect(result.features[0].properties?.icon).toBe('cargo-ship');
		expect(result.features[0].properties?.description).toContain('timezone unconfirmed');
	});
	it('switches context overlays without creating service or policy features', () => {
		expect(transportContextSymbols(bundle, false, false).features).toEqual([]);
		expect(transportContextSymbols(null, true, true).features).toEqual([]);
	});
});
