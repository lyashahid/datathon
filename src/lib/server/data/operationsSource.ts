import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OperationsBundle } from '#lib/operations/types.ts';

function record(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error('Invalid operations object');
	return value as Record<string, unknown>;
}
function text(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}
function date(value: unknown, nullable = false): boolean {
	return (
		(nullable && value === null) ||
		(text(value) && Number.isFinite(Date.parse(value)) && /(?:Z|[+-]\d\d:\d\d)$/.test(value))
	);
}
function array(value: unknown): unknown[] {
	if (!Array.isArray(value)) throw new Error('Invalid operations array');
	return value;
}
function assert(condition: unknown, reason: string): asserts condition {
	if (!condition) throw new Error(`Invalid operations snapshot: ${reason}`);
}
function coordinates(value: unknown) {
	assert(Array.isArray(value), 'coordinate array required');
	if (typeof value[0] === 'number') {
		assert(
			value.length === 2 &&
				value.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
				Math.abs(value[0]) <= 180 &&
				Math.abs(value[1]) <= 90,
			'invalid geographic coordinates'
		);
	} else for (const part of value) coordinates(part);
}

/** A rejected replacement cannot make real evidence disappear or turn a gap into zero. */
export function validateOperationsBundle(value: unknown): OperationsBundle {
	const bundle = record(value);
	assert(
		bundle.schemaVersion === 1 && bundle.profile === 'public-only',
		'public operations schema required'
	);
	assert(text(bundle.version) && date(bundle.generatedAt), 'version and generation time required');
	assert(['ready', 'partial', 'unavailable'].includes(String(bundle.status)), 'unknown status');
	assert(typeof bundle.stale === 'boolean', 'stale flag required');
	const sourceIds = new Set<string>();
	for (const entry of array(bundle.sources)) {
		const source = record(entry);
		assert(text(source.id) && !sourceIds.has(source.id), 'unique source ID required');
		sourceIds.add(source.id);
		assert(
			text(source.url) && URL.canParse(source.url) && new URL(source.url).protocol === 'https:',
			'public HTTPS source required'
		);
		assert(
			['downloaded', 'empty', 'cached', 'unavailable'].includes(String(source.status)),
			'unknown source state'
		);
		assert(date(source.retrievedAt, true), 'invalid retrieval time');
		assert(
			source.checksum === null ||
				(text(source.checksum) && /^[a-f0-9]{64}$/i.test(source.checksum)),
			'invalid checksum'
		);
		for (const key of [
			'title',
			'publisher',
			'coverage',
			'referencePeriod',
			'units',
			'licenseStatus',
			'transformationVersion'
		])
			assert(text(source[key]), `missing source ${key}`);
		assert(array(source.gapReasons).every(text), 'invalid source gaps');
	}
	for (const key of ['weatherAlerts', 'roadEvents', 'noticeCandidates']) {
		const ids = new Set<string>();
		for (const entry of array(bundle[key])) {
			const event = record(entry);
			assert(text(event.id) && !ids.has(event.id), 'duplicate or missing event ID');
			ids.add(event.id);
			assert(text(event.sourceId) && sourceIds.has(event.sourceId), 'unknown event source');
			assert(date(event.validFrom, true) && date(event.validUntil, true), 'invalid event validity');
			if (event.validFrom && event.validUntil)
				assert(
					Date.parse(String(event.validUntil)) > Date.parse(String(event.validFrom)),
					'reversed event interval'
				);
			if (event.geometry !== null) {
				const geometry = record(event.geometry);
				assert(
					['Polygon', 'MultiPolygon', 'Point', 'LineString'].includes(String(geometry.type)),
					'unsupported event geometry'
				);
				coordinates(geometry.coordinates);
			}
			if (key === 'weatherAlerts') {
				assert(
					date(event.sentAt) && ['Alert', 'Update', 'Cancel'].includes(String(event.messageType)),
					'invalid CAP message'
				);
				assert(
					['Actual', 'Exercise', 'System', 'Test', 'Draft'].includes(String(event.status)),
					'invalid CAP status'
				);
				assert(array(event.references).every(text), 'invalid CAP references');
				assert(
					event.routingEffect === 'advisory-only',
					'weather cannot automatically block routes'
				);
			} else
				assert(event.routingEffect === 'candidate-only', 'unreviewed event cannot block routes');
		}
	}
	for (const entry of array(bundle.nationalReadiness)) {
		const island = record(entry);
		assert(text(island.id) && text(island.name) && text(island.atoll), 'island identity required');
		if (island.coordinates !== null) coordinates(island.coordinates);
		for (const key of ['census2022Population', 'population2026', 'population2030'])
			assert(
				island[key] === null ||
					(typeof island[key] === 'number' && Number.isFinite(island[key]) && island[key] >= 0),
				'invalid population'
			);
		assert(
			island.accessReadiness === 'flagship' || island.routingAvailable === false,
			'national routing cannot be implied by population coverage'
		);
	}
	array(bundle.serviceEvidence);
	if (bundle.ferryEvidence !== undefined) {
		const evidence = record(bundle.ferryEvidence);
		const calendar = record(evidence.calendar);
		assert(
			text(calendar.sourceId) && sourceIds.has(calendar.sourceId),
			'unknown ferry calendar source'
		);
		assert(
			calendar.crossingMinutes === null && calendar.routingEligible === false,
			'unverified ferry crossing cannot become observed routing'
		);
		assert(
			text(calendar.effectiveFrom) && text(calendar.timezone),
			'ferry calendar validity required'
		);
		array(calendar.dayTypes);
		assert(array(evidence.terminals).length === 2, 'two verified ferry terminals required');
		for (const entry of array(evidence.terminals)) {
			const terminal = record(entry);
			assert(
				text(terminal.id) && text(terminal.name) && text(terminal.islandId),
				'terminal identity required'
			);
			coordinates(terminal.coordinates);
		}
	}
	if (bundle.earthObservation !== undefined) {
		const evidence = record(bundle.earthObservation);
		assert(evidence.interpretation === 'visual-context-only', 'imagery is context evidence');
		assert(text(evidence.qualification), 'imagery qualifications required');
		for (const entry of array(evidence.mosaics)) {
			const mosaic = record(entry);
			assert(mosaic.year === 2020 || mosaic.year === 2025, 'unknown mosaic year');
			assert(text(mosaic.sourceId) && sourceIds.has(mosaic.sourceId), 'unknown mosaic source');
			assert(mosaic.tileSize === 256 && mosaic.maxZoom === 14, 'invalid mosaic tile matrix');
			assert(
				mosaic.tileUrl ===
					`https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${mosaic.year}_3857/default/g/{z}/{y}/{x}.jpg`,
				'invalid mosaic endpoint'
			);
			assert(text(mosaic.attribution) && text(mosaic.licenseUrl), 'imagery attribution required');
		}
	}
	assert(array(bundle.gaps).every(text), 'invalid gap explanations');
	record(bundle.ai);
	return value as OperationsBundle;
}

export function createOperationsLoader(
	read: (path: string) => Promise<string> = (path) => readFile(path, 'utf8'),
	root = process.cwd()
) {
	let last: OperationsBundle | undefined;
	return async (): Promise<OperationsBundle> => {
		try {
			last = validateOperationsBundle(
				JSON.parse(await read(join(root, 'data/public/operations/bundle.json')))
			);
			return last;
		} catch {
			if (last) return { ...last, stale: true };
			return {
				schemaVersion: 1,
				version: 'operations-unavailable',
				generatedAt: new Date().toISOString(),
				status: 'unavailable',
				stale: false,
				sources: [],
				weatherAlerts: [],
				roadEvents: [],
				noticeCandidates: [],
				nationalReadiness: [],
				serviceEvidence: [],
				profile: 'public-only',
				gaps: [
					'No validated public operations snapshot. Run npm run data:operations. No warning, closure, or national access result is inferred from missing data.'
				],
				ai: {
					enabled: false,
					available: false,
					method: 'rules',
					reason: 'No AI extraction is configured.'
				}
			};
		}
	};
}

export function operationsEtag(bundle: OperationsBundle): string {
	return `"${createHash('sha256').update(JSON.stringify(bundle)).digest('hex')}"`;
}
export const loadOperations = createOperationsLoader();
