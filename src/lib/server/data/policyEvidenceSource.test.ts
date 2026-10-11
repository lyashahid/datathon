import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createPolicyEvidenceLoader, validatePolicyEvidence } from './policyEvidenceSource.ts';

const snapshot = async () =>
	JSON.parse(await readFile('data/public/policy-evidence/bundle.json', 'utf8'));

describe('policy evidence', () => {
	it('reconciles mapped versus unlocated source records and preserves unknown school joins', async () => {
		const bundle = validatePolicyEvidence(await snapshot());
		expect(bundle.layers.find((layer) => layer.id === 'hdc-pavements')).toMatchObject({
			sourceRecordCount: 311,
			recordCount: 310,
			unlocatedRecords: 1
		});
		expect(bundle.layers.find((layer) => layer.id === 'hdc-masterplan')).toMatchObject({
			sourceRecordCount: 3958,
			recordCount: 3958,
			unlocatedRecords: 0
		});
		expect(bundle.layers.find((layer) => layer.id === 'hdc-trees')?.recordCount).toBe(3838);
		expect(bundle.layers.find((layer) => layer.id === 'hdc-accessibility-audit')).toMatchObject({
			sourceRecordCount: 1319,
			recordCount: 1316,
			unlocatedRecords: 3
		});
		expect(bundle.schoolCompleteness).toMatchObject({
			publishedSchools: 42,
			publishedEnrollment: 38836,
			mappedEligibleLocations: 17,
			matchedInstitutions: null
		});
		expect(bundle.constituencies).toHaveLength(17);
		expect(bundle.constituencies.every((row) => !row.boundaryMatched)).toBe(true);
	});

	it('retains unavailable occupancy as null and does not interpret encounters as patients', async () => {
		const bundle = validatePolicyEvidence(await snapshot());
		expect(bundle.observations.find((item) => item.id === 'igmh:2024:10')?.value).toBeNull();
		expect(bundle.observations.find((item) => item.id === 'igmh:2025:5')?.value).toBe(537);
		expect(bundle.observations.find((item) => item.id === 'igmh:2025:6')).toMatchObject({
			value: 464783,
			unit: 'reported encounters/year'
		});
	});

	it('rejects broken source references and coordinates instead of displaying invented evidence', async () => {
		const value = await snapshot();
		value.layers[0].features.features[0].properties.sourceId = 'unknown';
		expect(() => validatePolicyEvidence(value)).toThrow('Unknown feature source');
		const geometry = await snapshot();
		geometry.layers[2].features.features[0].geometry.coordinates = [0, 0];
		expect(() => validatePolicyEvidence(geometry)).toThrow('outside Greater Malé');
	});

	it('rejects cohort mismatches, duplicate records, and private source fields', async () => {
		const value = await snapshot();
		value.constituencies[0].maldivianPopulation += 1;
		expect(() => validatePolicyEvidence(value)).toThrow('Constituency population mismatch');
		const duplicate = await snapshot();
		duplicate.observations.push(duplicate.observations[0]);
		expect(() => validatePolicyEvidence(duplicate)).toThrow('Duplicate observations');
		const privateFields = await snapshot();
		privateFields.layers[3].features.features[0].properties.surveyed_by = 'Private name';
		expect(() => validatePolicyEvidence(privateFields)).toThrow('Unapproved policy attributes');
	});

	it('serves the last validated local snapshot when a refresh is invalid', async () => {
		const valid = JSON.stringify(await snapshot());
		let broken = false;
		const load = createPolicyEvidenceLoader(async () => (broken ? '{bad-json' : valid));
		const initial = await load();
		broken = true;
		const fallback = await load();
		expect(fallback.version).toBe(initial.version);
		expect(fallback.stale).toBe(true);
		expect(fallback.layers).toEqual(initial.layers);
	});

	it('reports missing evidence as unavailable rather than zero', async () => {
		const load = createPolicyEvidenceLoader(async () => {
			throw new Error('offline');
		});
		const result = await load();
		expect(result.schoolCompleteness.publishedSchools).toBeNull();
		expect(result.layers).toEqual([]);
		expect(result.version).toBe('policy-evidence-unavailable');
	});

	it('preserves published ferry day types and never treats opposite departures as arrivals', async () => {
		const evidence = JSON.parse(
			await readFile('data/public/policy-evidence/service-calendars.json', 'utf8')
		);
		expect(evidence.calendars).toHaveLength(4);
		for (const calendar of evidence.calendars) {
			expect(calendar.crossingMinutes).toBeNull();
			expect(calendar.routingEligible).toBe(false);
			expect(calendar.timezone).toBe('Indian/Maldives');
		}
		const vilimale = evidence.calendars.find(
			(item: { route: string }) => item.route === 'vilimale'
		);
		expect(vilimale.dayTypes[1].noServiceWindows).toEqual([
			{ start: '12:00', end: '13:30', reason: 'Friday prayer break' }
		]);
		expect(vilimale.dayTypes[2].unknownWindows[0]).toMatchObject({
			start: '17:20',
			end: '17:30'
		});
		const gulhifalhu = evidence.calendars.find(
			(item: { route: string }) => item.route === 'gulhifalhu'
		);
		expect(gulhifalhu.dayTypes[1]).toMatchObject({
			isoWeekdays: [5],
			noScheduledService: true,
			departuresFromMale: [],
			departuresFromIsland: []
		});
	});
});
