import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PlanningBaseline } from '#lib/planning/types.ts';
import { isEligibleFacility } from '#lib/planning/facilities.ts';
import { createPlanningBaselineLoader, validatePlanningBaseline } from './planningSource.ts';

function fixture(): PlanningBaseline {
	return {
		schemaVersion: 1,
		version: 'qa-public-v1',
		generatedAt: '2026-10-10T10:00:00Z',
		referenceDate: '2026-10-10',
		sources: [
			{
				id: 'official',
				title: 'QA official source',
				url: 'https://example.org/data',
				status: 'downloaded',
				sha256: 'a'.repeat(64),
				fetchedAt: '2026-10-10T09:00:00+00:00',
				bytes: 100
			}
		],
		islands: [{ id: 'island', name: 'QA island' }],
		origins: [
			{
				id: 'origin',
				islandId: 'island',
				lon: 73.5,
				lat: 4.17,
				population2026: 10,
				population2030: 12,
				sourceIds: ['official']
			}
		],
		network: {
			nodes: [
				{ id: 'a', lon: 73.5, lat: 4.17 },
				{ id: 'b', lon: 73.501, lat: 4.17 }
			],
			edges: [
				{
					id: 'edge',
					from: 'a',
					to: 'b',
					distanceM: 110,
					walkAllowed: true,
					driveAllowed: true,
					oneway: true,
					geometry: [
						[73.5, 4.17],
						[73.501, 4.17]
					]
				}
			]
		},
		facilities: [
			{
				id: 'hospital',
				name: 'QA hospital',
				kind: 'hospital',
				islandId: 'island',
				lon: 73.501,
				lat: 4.17,
				verification: 'official',
				sourceIds: ['official']
			}
		],
		transit: {
			stops: [
				{
					id: 's1',
					name: 'QA first',
					islandId: 'island',
					lon: 73.5,
					lat: 4.17,
					sourceIds: ['official']
				},
				{
					id: 's2',
					name: 'QA second',
					islandId: 'island',
					lon: 73.501,
					lat: 4.17,
					sourceIds: ['official']
				}
			],
			patterns: [
				{
					id: 'pattern',
					routeId: 'route',
					name: 'QA explicit direction',
					mode: 'bus',
					stopIds: ['s1', 's2'],
					calendar: { weekdays: [], includedDates: ['2026-10-10'] },
					timing: {
						kind: 'scheduled',
						trips: [
							{
								id: 'trip',
								stopTimes: [
									{ arrivalMinutes: 480, departureMinutes: 481 },
									{ arrivalMinutes: 485, departureMinutes: 486 }
								]
							}
						]
					},
					provenance: 'observed',
					sourceIds: ['official'],
					segmentGeometry: [
						[
							[73.5, 4.17],
							[73.501, 4.17]
						]
					]
				}
			],
			gaps: ['QA fixture only']
		},
		additionalEvidence: { description: 'Unknown evidence extensions are preserved.' }
	};
}

function replace(value: unknown, path: (string | number)[], replacement: unknown) {
	let cursor = value as Record<string | number, unknown>;
	for (const key of path.slice(0, -1)) cursor = cursor[key] as Record<string | number, unknown>;
	cursor[path[path.length - 1]] = replacement;
}

describe('planning bundle runtime contract', () => {
	it('validates the installed public snapshot without writing to its files', async () => {
		const bytes = await readFile(join(process.cwd(), 'data/public/planning-baseline.json'));
		const bundle: unknown = JSON.parse(bytes.toString('utf8'));
		expect(validatePlanningBaseline(bundle, { requireOperationReviews: true })).toBe(bundle);
	});
	it('matches model destination eligibility to the audited public school and healthcare counts', async () => {
		const bytes = await readFile(join(process.cwd(), 'data/public/planning-baseline.json'));
		const bundle = validatePlanningBaseline(JSON.parse(bytes.toString('utf8')), {
			requireOperationReviews: true
		});
		const review = bundle.facilityOperationReview as { generalSchoolEligibleCount: number };
		const healthcare = bundle.healthcareLocationAudit as { generalCareEligibleCount: number };
		expect(bundle.facilities.filter((f) => isEligibleFacility(f, 'education'))).toHaveLength(
			review.generalSchoolEligibleCount
		);
		expect(bundle.facilities.filter((f) => isEligibleFacility(f, 'healthcare'))).toHaveLength(
			healthcare.generalCareEligibleCount
		);
		expect(review.generalSchoolEligibleCount).toBe(17);
		expect(healthcare.generalCareEligibleCount).toBe(8);
	});
	it('accepts complete dated services, zero resident counts and unknown evidence extensions', () => {
		const bundle = fixture();
		bundle.origins[0].population2026 = 0;
		bundle.origins[0].population2030 = null;
		expect(validatePlanningBaseline(bundle)).toBe(bundle);
		expect(bundle.additionalEvidence).toEqual({
			description: 'Unknown evidence extensions are preserved.'
		});
	});
	it('accepts frequency timing only when ordered segments and windows are valid', () => {
		const bundle = fixture();
		bundle.transit.patterns[0].timing = {
			kind: 'frequency',
			windows: [{ startMinutes: 480, endMinutes: 720, headwayMinutes: 15 }],
			segmentMinutes: [5]
		};
		expect(validatePlanningBaseline(bundle)).toBe(bundle);
		bundle.transit.patterns[0].timing.windows[0].headwayMinutes = 0;
		expect(() => validatePlanningBaseline(bundle)).toThrow(/service timing/);
	});
	it('requires an evidenced status for every audited healthcare record but preserves legacy schools', () => {
		const bundle = fixture();
		bundle.facilityAuditVersion = 'audit-2026-10-10';
		expect(() => validatePlanningBaseline(bundle)).toThrow(/careScope/);
		bundle.facilities[0].careScope = 'general';
		expect(() => validatePlanningBaseline(bundle)).toThrow(/operatingStatus/);
		bundle.facilities[0] = {
			...bundle.facilities[0],
			operatingStatus: 'closed',
			statusReviewedAt: '2026-10-10',
			statusSourceIds: ['official'],
			registryId: 'H-001',
			statusNote: 'Directory review records closure.'
		};
		expect(validatePlanningBaseline(bundle)).toBe(bundle);
		bundle.facilities.push({ ...fixture().facilities[0], id: 'school', kind: 'school' });
		expect(validatePlanningBaseline(bundle)).toBe(bundle);
	});
	it('requires operating evidence for every school in the reviewed public bundle', () => {
		const bundle = fixture();
		bundle.facilityOperationReview = { version: 'schools-2026-10-10', reviewedAt: '2026-10-10' };
		bundle.facilities.push({ ...fixture().facilities[0], id: 'school', kind: 'school' });
		expect(() => validatePlanningBaseline(bundle)).toThrow(/operatingStatus/);
		Object.assign(bundle.facilities[1], {
			operatingStatus: 'unverified',
			statusReviewedAt: '2026-10-10',
			statusSourceIds: ['official']
		});
		expect(validatePlanningBaseline(bundle)).toBe(bundle);
		bundle.facilities[1].statusSourceIds = ['not-downloaded'];
		expect(() => validatePlanningBaseline(bundle)).toThrow(/successfully downloaded/);
	});
	it.each<{ field: string; value: unknown }>([
		{ field: 'careScope', value: 'all services' },
		{ field: 'operatingStatus', value: 'probably open' },
		{ field: 'statusReviewedAt', value: '2026-02-30' },
		{ field: 'statusSourceIds', value: [] },
		{ field: 'statusSourceIds', value: ['not-downloaded'] },
		{ field: 'statusSourceIds', value: ['official', 'official'] },
		{ field: 'registryId', value: 123 },
		{ field: 'statusNote', value: '' }
	])('rejects malformed or unsupported operating evidence at $field', ({ field, value }) => {
		const bundle = fixture();
		bundle.facilityAuditVersion = 'audit-2026-10-10';
		Object.assign(bundle.facilities[0], {
			careScope: 'general',
			operatingStatus: 'open',
			statusReviewedAt: '2026-10-10',
			statusSourceIds: ['official'],
			[field]: value
		});
		expect(() => validatePlanningBaseline(bundle)).toThrow(/facilities/);
	});
	it('keeps an optional inaccessible source explicit and rejects its use as downloaded evidence', () => {
		const bundle = fixture();
		bundle.sources.push({
			id: 'missing',
			title: 'Unreachable optional source',
			url: 'https://example.org/missing',
			status: 'unavailable',
			error: 'Connection timeout',
			lastAttemptedAt: '2026-10-10T09:00:00Z'
		});
		expect(validatePlanningBaseline(bundle)).toBe(bundle);
		bundle.transit.stops[0].sourceIds = ['missing'];
		expect(() => validatePlanningBaseline(bundle)).toThrow(/successfully downloaded/);
	});
	it('preserves an explicit drop-off-only operator stop and rejects non-boolean pickup metadata', () => {
		const bundle = fixture();
		bundle.transit.stops[0].pickupAllowed = false;
		expect(validatePlanningBaseline(bundle).transit.stops[0].pickupAllowed).toBe(false);
		Object.assign(bundle.transit.stops[0], { pickupAllowed: 'false' });
		expect(() => validatePlanningBaseline(bundle)).toThrow(/pickupAllowed/);
	});
	it.each([
		['sources'],
		['islands'],
		['origins'],
		['network', 'nodes'],
		['network', 'edges'],
		['facilities'],
		['transit', 'stops'],
		['transit', 'patterns'],
		['transit', 'gaps']
	])('requires the consumed array at %j', (...path) => {
		const bundle = fixture();
		replace(bundle, path, undefined);
		expect(() => validatePlanningBaseline(bundle)).toThrow(/expected an array/);
	});
	it.each([
		['sources'],
		['islands'],
		['origins'],
		['network', 'nodes'],
		['network', 'edges'],
		['facilities'],
		['transit', 'stops'],
		['transit', 'patterns'],
		['transit', 'patterns', 0, 'timing', 'trips']
	])('rejects duplicate IDs at %j', (...path) => {
		const bundle = fixture();
		let entries: unknown = bundle;
		for (const key of path) entries = (entries as Record<string | number, unknown>)[key];
		(entries as unknown[]).push(structuredClone((entries as unknown[])[0]));
		expect(() => validatePlanningBaseline(bundle)).toThrow(/duplicate ID/);
	});
	it.each<{ label: string; path: (string | number)[]; value: unknown }>([
		{ label: 'version', path: ['version'], value: ' ' },
		{ label: 'schema', path: ['schemaVersion'], value: 2 },
		{ label: 'date', path: ['referenceDate'], value: '2026-02-31' },
		{ label: 'generated UTC', path: ['generatedAt'], value: '2026-10-10T10:00:00' },
		{ label: 'checksum', path: ['sources', 0, 'sha256'], value: 'not-a-checksum' },
		{
			label: 'retrieval UTC',
			path: ['sources', 0, 'fetchedAt'],
			value: '2026-10-10T09:00:00+05:00'
		},
		{ label: 'bytes', path: ['sources', 0, 'bytes'], value: 0 },
		{ label: 'origin coordinate', path: ['origins', 0, 'lon'], value: NaN },
		{ label: 'road coordinate', path: ['network', 'nodes', 0, 'lat'], value: Infinity },
		{ label: 'institution coordinate', path: ['facilities', 0, 'lon'], value: 181 },
		{ label: 'stop coordinate', path: ['transit', 'stops', 0, 'lat'], value: -91 },
		{ label: 'road geometry', path: ['network', 'edges', 0, 'geometry', 0, 1], value: NaN },
		{ label: 'population2026', path: ['origins', 0, 'population2026'], value: -1 },
		{ label: 'population2030', path: ['origins', 0, 'population2030'], value: Infinity },
		{ label: 'island reference', path: ['origins', 0, 'islandId'], value: 'missing' },
		{ label: 'endpoint reference', path: ['network', 'edges', 0, 'to'], value: 'missing' },
		{ label: 'zero road distance', path: ['network', 'edges', 0, 'distanceM'], value: 0 },
		{
			label: 'infinite road distance',
			path: ['network', 'edges', 0, 'distanceM'],
			value: Infinity
		},
		{ label: 'permission', path: ['network', 'edges', 0, 'walkAllowed'], value: 'yes' },
		{ label: 'source reference', path: ['transit', 'stops', 0, 'sourceIds'], value: ['missing'] },
		{
			label: 'stop reference',
			path: ['transit', 'patterns', 0, 'stopIds'],
			value: ['s1', 'missing']
		},
		{ label: 'weekday', path: ['transit', 'patterns', 0, 'calendar', 'weekdays'], value: [7] },
		{
			label: 'included date',
			path: ['transit', 'patterns', 0, 'calendar', 'includedDates'],
			value: ['2026-02-31']
		},
		{
			label: 'unknown timing',
			path: ['transit', 'patterns', 0, 'timing', 'kind'],
			value: 'invented'
		},
		{
			label: 'trip stop alignment',
			path: ['transit', 'patterns', 0, 'timing', 'trips', 0, 'stopTimes'],
			value: [{ arrivalMinutes: 480, departureMinutes: 481 }]
		},
		{
			label: 'non-monotonic trip',
			path: ['transit', 'patterns', 0, 'timing', 'trips', 0, 'stopTimes', 1, 'arrivalMinutes'],
			value: 470
		},
		{
			label: 'negative departure',
			path: ['transit', 'patterns', 0, 'timing', 'trips', 0, 'stopTimes', 0, 'departureMinutes'],
			value: -1
		},
		{
			label: 'route segment alignment',
			path: ['transit', 'patterns', 0, 'segmentGeometry'],
			value: []
		}
	])('rejects invalid $label', ({ path, value }) => {
		const bundle = fixture();
		replace(bundle, path, value);
		expect(() => validatePlanningBaseline(bundle)).toThrow(/Invalid planning bundle/);
	});
});

function reviewedFixture() {
	const bundle = fixture();
	bundle.facilityAuditVersion = 'health-qa';
	bundle.facilityOperationReview = { version: 'education-qa', reviewedAt: '2026-10-10' };
	Object.assign(bundle.facilities[0], {
		careScope: 'general',
		operatingStatus: 'open',
		statusReviewedAt: '2026-10-10',
		statusSourceIds: ['official']
	});
	return bundle;
}

function memoryFile() {
	const state = {
		bytes: Buffer.from(JSON.stringify(reviewedFixture())),
		mtimeMs: 1,
		ctimeMs: 1,
		missing: false
	};
	const read = vi.fn(async () => state.bytes);
	const metadata = vi.fn(async () => {
		if (state.missing) throw Object.assign(new Error('QA file missing'), { code: 'ENOENT' });
		return { mtimeMs: state.mtimeMs, ctimeMs: state.ctimeMs, size: state.bytes.length, ino: 1 };
	});
	const load = createPlanningBaselineLoader({
		filePath: join(process.cwd(), 'qa/planning-source-isolated-fixture.json'),
		read,
		metadata
	});
	function write(value: unknown) {
		state.bytes = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
		state.mtimeMs += 1;
		state.ctimeMs += 1;
	}
	return { state, read, metadata, load, write };
}

describe('last validated planning file cache', () => {
	it('reads a real installed file once and checks metadata on subsequent requests', async () => {
		const read = vi.fn((path: string) => readFile(path));
		const load = createPlanningBaselineLoader({ read });
		const first = await load();
		const second = await load();
		expect(read).toHaveBeenCalledTimes(1);
		expect(second.bundle).toBe(first.bundle);
		expect(second.stale).toBe(false);
	});
	it('hashes the actual bytes and coalesces concurrent requests', async () => {
		const file = memoryFile();
		const [first, second] = await Promise.all([file.load(), file.load()]);
		expect(file.read).toHaveBeenCalledTimes(1);
		expect(second).toBe(first);
		expect(first.etag).toBe(`"${createHash('sha256').update(file.state.bytes).digest('hex')}"`);
		expect(first.stale).toBe(false);
	});
	it('serves the previous validated version after malformed or invalid replacements and recovers', async () => {
		const file = memoryFile();
		const first = await file.load();
		file.write('{broken JSON');
		const malformed = await file.load();
		expect(malformed).toEqual({ ...first, stale: true });
		await file.load();
		expect(file.read).toHaveBeenCalledTimes(2);
		const invalid = reviewedFixture();
		invalid.network.edges[0].to = 'missing-node';
		file.write(invalid);
		expect(await file.load()).toEqual({ ...first, stale: true });
		const fresh = reviewedFixture();
		fresh.version = 'qa-public-v2';
		file.write(fresh);
		const recovered = await file.load();
		expect(recovered.bundle.version).toBe('qa-public-v2');
		expect(recovered.stale).toBe(false);
		expect(recovered.etag).not.toBe(first.etag);
	});
	it('serves validated data on filesystem failure but refuses an invalid initial source', async () => {
		const file = memoryFile();
		const first = await file.load();
		file.state.missing = true;
		expect(await file.load()).toEqual({ ...first, stale: true });
		const empty = memoryFile();
		empty.state.missing = true;
		await expect(empty.load()).rejects.toThrow(/missing/);
		const invalid = memoryFile();
		invalid.write({ schemaVersion: 1, version: 'fake', origins: [], network: { nodes: [] } });
		await expect(invalid.load()).rejects.toThrow(/Invalid planning bundle/);
	});
	it('retains the validated snapshot when a replacement strips institution review metadata', async () => {
		const file = memoryFile();
		const first = await file.load();
		const legacy = fixture();
		file.write(legacy);
		expect(await file.load()).toEqual({ ...first, stale: true });
		const unauditedEducation = reviewedFixture();
		delete unauditedEducation.facilityOperationReview;
		file.write(unauditedEducation);
		expect(await file.load()).toEqual({ ...first, stale: true });
		const initial = memoryFile();
		initial.write(unauditedEducation);
		await expect(initial.load()).rejects.toThrow(/public education review required/);
	});
	it('detects a same-size update by mtime and does not adopt a file changed during reading', async () => {
		const file = memoryFile();
		const first = await file.load();
		const newBundle = reviewedFixture();
		newBundle.version = 'qa-public-v2';
		file.write(newBundle);
		file.read.mockImplementationOnce(async () => {
			file.state.mtimeMs += 1;
			return file.state.bytes;
		});
		expect(await file.load()).toEqual({ ...first, stale: true });
		const fresh = await file.load();
		expect(fresh.bundle.version).toBe('qa-public-v2');
		expect(fresh.stale).toBe(false);
	});

	it('retries a transient read failure even when replacement metadata stays unchanged', async () => {
		const file = memoryFile();
		const first = await file.load();
		const replacement = reviewedFixture();
		replacement.version = 'qa-public-v2';
		file.write(replacement);
		file.read.mockRejectedValueOnce(new Error('QA temporary file lock'));
		expect(await file.load()).toEqual({ ...first, stale: true });
		expect((await file.load()).bundle.version).toBe('qa-public-v2');
	});
});
