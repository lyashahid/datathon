import { describe, expect, it } from 'vitest';
import {
	createTransportContextLoader,
	validateAgencySnapshot,
	validateFollowmeSnapshot
} from './transportContextSource.ts';

const source = (id: string) => ({
	id,
	title: id,
	url: 'https://example.org/source',
	publisher: 'Official publisher',
	referencePeriod: '2025',
	retrievedAt: '2026-10-10T14:00:00Z',
	checksum: 'a'.repeat(64),
	coverage: 'Maldives',
	units: 'passenger movements',
	licenseStatus: 'Publisher terms',
	transformationVersion: 'test-1'
});
function followme() {
	return {
		schemaVersion: 1,
		version: 'boats-1',
		generatedAt: '2026-10-10T14:00:00Z',
		sources: [source('followme')],
		gaps: ['Timezone unconfirmed'],
		vessels: [
			{
				id: 'opaque-1',
				name: 'Public boat',
				type: 'Speedboat',
				coordinates: [73.53, 4.2],
				speedKnots: 0,
				headingDeg: 30,
				observedAtRaw: '2026-10-10 19:00:00',
				observedTimezone: null,
				sourceUrl: 'https://m.followme.mv/public/',
				retrievedAt: '2026-10-10T14:00:00Z',
				imei: 'private-device',
				phone: 'private-contact'
			}
		]
	};
}
function agency() {
	return {
		schemaVersion: 1,
		version: 'agency-1',
		generatedAt: '2026-10-10T14:00:00Z',
		sources: [source('mpl'), source('caa')],
		layers: {
			vessels: {
				gaps: ['No coordinates'],
				observations: [],
				portCalls: [
					{
						id: 'call-1',
						vesselName: 'Cargo boat',
						activity: 'Estimated arrival',
						date: '2026-10-11',
						berth: null,
						sourceId: 'mpl'
					}
				]
			},
			flights: {
				gaps: [],
				observations: [
					{
						id: 'passengers-1',
						metric: 'International arrivals',
						value: 1200,
						unit: 'passenger movements',
						refPeriod: '2025-01',
						geography: 'VIA',
						sourceId: 'caa'
					}
				]
			}
		}
	};
}

describe('auxiliary transport snapshots', () => {
	it('preserves unknown timestamp zone and strips contact/device fields', () => {
		const parsed = validateFollowmeSnapshot(followme());
		expect(parsed.records[0].observedTimezone).toBeNull();
		expect(parsed.records[0].speedKnots).toBe(0);
		expect(JSON.stringify(parsed)).not.toContain('private-device');
		expect(JSON.stringify(parsed)).not.toContain('private-contact');
	});
	it('rejects bad positions and duplicate IDs instead of plotting them', () => {
		const invalid = followme();
		invalid.vessels[0].coordinates = [0, 0];
		expect(() => validateFollowmeSnapshot(invalid)).toThrow('Coordinates outside Maldives');
		const duplicate = followme();
		duplicate.vessels.push(duplicate.vessels[0]);
		expect(() => validateFollowmeSnapshot(duplicate)).toThrow('Duplicate');
	});
	it('preserves airport grain and port dates without inventing vessel positions', () => {
		const parsed = validateAgencySnapshot(agency());
		expect(parsed.mpl.records[0]).toEqual({
			id: 'call-1',
			vesselName: 'Cargo boat',
			activity: 'Estimated arrival',
			date: '2026-10-11',
			berth: null,
			sourceId: 'mpl'
		});
		expect(parsed.aviation.records[0].unit).toBe('passenger movements');
		expect(parsed.aviation.records[0].refPeriod).toBe('2025-01');
		expect(parsed.mpl.sources.map((entry) => entry.id)).toEqual(['mpl']);
	});
	it('rejects missing counts and unknown source joins', () => {
		const invalid = agency();
		invalid.layers.flights.observations[0].sourceId = 'unknown';
		expect(() => validateAgencySnapshot(invalid)).toThrow('Unknown observation source');
		const missing = agency();
		missing.layers.flights.observations[0].value = NaN;
		expect(() => validateAgencySnapshot(missing)).toThrow('Invalid observation value');
	});
	it('retains the last validated snapshot after a failed replacement', async () => {
		let fail = false;
		const loader = createTransportContextLoader(async (path) => {
			if (fail) throw new Error('upstream snapshot missing');
			return JSON.stringify(path.includes('followme') ? followme() : agency());
		});
		const first = await loader({ vessels: true, flights: true });
		fail = true;
		const retained = await loader({ vessels: true, flights: true });
		expect(retained.followme.records).toEqual(first.followme.records);
		expect(retained.followme.stale).toBe(true);
		expect(retained.aviation.records).toEqual(first.aviation.records);
		expect(retained.aviation.stale).toBe(true);
	});
	it('disabled flags remove cached datasets and do not access files', async () => {
		let reads = 0;
		const loader = createTransportContextLoader(async (path) => {
			reads += 1;
			return JSON.stringify(path.includes('followme') ? followme() : agency());
		});
		await loader({ vessels: true, flights: true });
		const disabled = await loader({ vessels: false, flights: false });
		expect(reads).toBe(2);
		expect(disabled.followme.records).toEqual([]);
		expect(disabled.mpl.records).toEqual([]);
		expect(disabled.aviation.records).toEqual([]);
		expect(disabled.followme.status).toBe('disabled');
	});
	it('public competition profile suppresses cached FollowMe while preserving public agency context', async () => {
		const reads: string[] = [];
		const loader = createTransportContextLoader(async (path) => {
			reads.push(path);
			return JSON.stringify(path.includes('followme') ? followme() : agency());
		});
		await loader({ vessels: true, flights: true });
		reads.length = 0;
		const publicBundle = await loader({ vessels: true, flights: true, publicOnly: true });
		expect(reads.some((path) => path.includes('followme'))).toBe(false);
		expect(publicBundle.followme.records).toEqual([]);
		expect(publicBundle.followme.status).toBe('disabled');
		expect(publicBundle.followme.gapReasons.join(' ')).toContain('Public-only competition profile');
		expect(publicBundle.mpl.records).toHaveLength(1);
		expect(publicBundle.aviation.records).toHaveLength(1);
	});
	it('missing data remains unavailable, not a zero-valued airport total', async () => {
		const loader = createTransportContextLoader(async () => {
			throw new Error('missing');
		});
		const bundle = await loader({ vessels: true, flights: true });
		expect(bundle.aviation.status).toBe('unavailable');
		expect(bundle.aviation.records).toEqual([]);
		expect(bundle.followme.gapReasons[0]).toContain('No validated');
	});
});
