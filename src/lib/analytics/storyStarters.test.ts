import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { availableStoryStarters } from './storyStarters.ts';
import { createAnalyticalCatalog } from './catalog.ts';
import type { PolicyEvidenceBundle } from '#lib/server/data/policyEvidenceSource.ts';
import type { TransportContext } from '#lib/context/types.ts';
const policyEvidence = JSON.parse(
	readFileSync('data/public/policy-evidence/bundle.json', 'utf8')
) as PolicyEvidenceBundle;
const raw = JSON.parse(readFileSync('data/public/context/agency-context.json', 'utf8'));
const transportContext = {
	aviation: { sources: raw.sources, records: raw.layers.flights.observations },
	mpl: { sources: [], records: [], observations: [] },
	followme: { sources: [], records: [] }
} as unknown as TransportContext;
const catalog = createAnalyticalCatalog({ planning: null, policyEvidence, transportContext });
describe('source-backed comparison starters', () => {
	it('offers all three supported comparisons from the real retained catalogue', () => {
		expect(availableStoryStarters(catalog).map((item) => item.id)).toEqual([
			'airport-passengers',
			'airport-activity',
			'household-spending'
		]);
	});
	it('omits comparisons when sources are absent or geographic joins no longer match', () => {
		expect(availableStoryStarters([])).toEqual([]);
		const changed = catalog.map((item) =>
			item.id === 'aviation-caa-11-13-international-passenger-departures'
				? { ...item, join: { ...item.join, domain: 'different-airport' } }
				: item
		);
		expect(availableStoryStarters(changed).some((item) => item.id === 'airport-passengers')).toBe(
			false
		);
	});
});
