import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { patternIsValid } from '#lib/planning/routing.ts';
import type { PlanningBaseline, PlanningServicePattern } from '#lib/planning/types.ts';

type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue =>
	value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value: unknown): value is string =>
	typeof value === 'string' && value.trim().length > 0;
const isFiniteNumber = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);

function check(condition: unknown, path: string, reason: string): asserts condition {
	if (!condition) throw new Error(`Invalid planning bundle at ${path}: ${reason}`);
}
function object(value: unknown, path: string): RecordValue {
	check(isRecord(value), path, 'expected an object');
	return value;
}
function array(value: unknown, path: string): unknown[] {
	check(Array.isArray(value), path, 'expected an array');
	return value;
}
function records(value: unknown, path: string): RecordValue[] {
	const ids = new Set<string>();
	return array(value, path).map((entry, index) => {
		const result = object(entry, `${path}[${index}]`);
		check(isText(result.id), `${path}[${index}].id`, 'expected a nonempty ID');
		check(!ids.has(result.id), path, `duplicate ID ${result.id}`);
		ids.add(result.id);
		return result;
	});
}
function validDate(value: unknown): value is string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00Z`);
	return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function validUtcTimestamp(value: unknown): value is string {
	if (
		typeof value !== 'string' ||
		!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]00:00)$/.test(value) ||
		!validDate(value.slice(0, 10))
	)
		return false;
	const parsed = new Date(value);
	return (
		Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value.slice(0, 10)
	);
}
function coordinates(value: unknown, path: string) {
	array(value, path).forEach((point, index) => {
		check(
			Array.isArray(point) &&
				point.length === 2 &&
				isFiniteNumber(point[0]) &&
				Math.abs(point[0]) <= 180 &&
				isFiniteNumber(point[1]) &&
				Math.abs(point[1]) <= 90,
			`${path}[${index}]`,
			'expected a finite [longitude, latitude] pair'
		);
	});
}
function position(value: RecordValue, path: string) {
	check(
		isFiniteNumber(value.lon) && Math.abs(value.lon) <= 180,
		`${path}.lon`,
		'expected finite longitude'
	);
	check(
		isFiniteNumber(value.lat) && Math.abs(value.lat) <= 90,
		`${path}.lat`,
		'expected finite latitude'
	);
	if (value.coordinate !== undefined) coordinates([value.coordinate], `${path}.coordinate`);
}
function nonnegative(value: unknown, path: string) {
	check(isFiniteNumber(value) && value >= 0, path, 'expected a finite nonnegative population');
}

/** Validate the consumed contract; unknown evidence/metadata extensions remain intact. */
export function validatePlanningBaseline(
	value: unknown,
	options: { requireOperationReviews?: boolean } = {}
): PlanningBaseline {
	const bundle = object(value, 'bundle');
	check(bundle.schemaVersion === 1, 'schemaVersion', 'unsupported schema version');
	check(
		isText(bundle.version) && bundle.version === bundle.version.trim(),
		'version',
		'expected a dataset version'
	);
	check(validUtcTimestamp(bundle.generatedAt), 'generatedAt', 'expected a valid UTC timestamp');
	check(validDate(bundle.referenceDate), 'referenceDate', 'expected a valid calendar date');
	if (options.requireOperationReviews) {
		check(
			isText(bundle.facilityAuditVersion),
			'facilityAuditVersion',
			'public healthcare review required'
		);
		check(
			bundle.facilityOperationReview !== undefined,
			'facilityOperationReview',
			'public education review required'
		);
	}
	if (bundle.facilityAuditVersion !== undefined)
		check(isText(bundle.facilityAuditVersion), 'facilityAuditVersion', 'expected an audit version');
	if (bundle.facilityOperationReview !== undefined) {
		const review = object(bundle.facilityOperationReview, 'facilityOperationReview');
		check(isText(review.version), 'facilityOperationReview.version', 'expected an audit version');
		check(
			validDate(review.reviewedAt),
			'facilityOperationReview.reviewedAt',
			'expected a review date'
		);
	}
	const sources = records(bundle.sources, 'sources');
	check(sources.length > 0, 'sources', 'a public baseline must contain source records');
	const downloadedSources = new Set<string>();
	for (const source of sources) {
		const path = `sources.${source.id}`;
		check(isText(source.title), `${path}.title`, 'expected a source title');
		check(
			typeof source.url === 'string' && /^https?:\/\/[^\s]+$/.test(source.url),
			`${path}.url`,
			'expected a public source URL'
		);
		check(
			source.status === 'downloaded' || source.status === 'unavailable',
			`${path}.status`,
			'expected a source access status'
		);
		if (source.status === 'downloaded') {
			check(
				typeof source.sha256 === 'string' && /^[a-f0-9]{64}$/i.test(source.sha256),
				`${path}.sha256`,
				'expected a SHA-256 checksum'
			);
			check(
				validUtcTimestamp(source.fetchedAt),
				`${path}.fetchedAt`,
				'expected a UTC retrieval timestamp'
			);
			check(
				isFiniteNumber(source.bytes) && Number.isSafeInteger(source.bytes) && source.bytes > 0,
				`${path}.bytes`,
				'expected a positive byte count'
			);
			if (source.lastValidatedAt !== undefined)
				check(
					validUtcTimestamp(source.lastValidatedAt),
					`${path}.lastValidatedAt`,
					'expected a UTC validation timestamp'
				);
			downloadedSources.add(source.id as string);
		} else {
			check(isText(source.error), `${path}.error`, 'unavailable sources must explain their gap');
			check(
				validUtcTimestamp(source.lastAttemptedAt),
				`${path}.lastAttemptedAt`,
				'expected a UTC attempt timestamp'
			);
			check(source.required !== true, path, 'required source is unavailable');
		}
	}
	function sourceReferences(record: RecordValue, path: string, required = false) {
		if (!required && record.sourceIds === undefined) return;
		const refs = array(record.sourceIds, `${path}.sourceIds`);
		check(refs.length > 0, `${path}.sourceIds`, 'expected source references');
		check(
			refs.every((id) => typeof id === 'string' && downloadedSources.has(id)),
			`${path}.sourceIds`,
			'references must identify successfully downloaded sources'
		);
		check(new Set(refs).size === refs.length, `${path}.sourceIds`, 'duplicate source references');
	}
	const islands = records(bundle.islands, 'islands');
	check(islands.length > 0, 'islands', 'expected at least one island');
	const islandIds = new Set(islands.map((island) => island.id));
	for (const island of islands) {
		check(isText(island.name), `islands.${island.id}.name`, 'expected an island name');
		for (const key of ['population2026', 'population2030', 'census2022Population']) {
			if (island[key] !== undefined && island[key] !== null)
				nonnegative(island[key], `islands.${island.id}.${key}`);
		}
		sourceReferences(island, `islands.${island.id}`);
	}
	function islandReference(record: RecordValue, path: string) {
		check(
			typeof record.islandId === 'string' && islandIds.has(record.islandId),
			`${path}.islandId`,
			'unknown island'
		);
	}
	for (const origin of records(bundle.origins, 'origins')) {
		const path = `origins.${origin.id}`;
		position(origin, path);
		islandReference(origin, path);
		nonnegative(origin.population2026, `${path}.population2026`);
		if (origin.population2030 !== undefined && origin.population2030 !== null)
			nonnegative(origin.population2030, `${path}.population2030`);
		sourceReferences(origin, path);
	}
	const network = object(bundle.network, 'network');
	const nodes = records(network.nodes, 'network.nodes');
	const nodeIds = new Set(nodes.map((node) => node.id));
	nodes.forEach((node) => position(node, `network.nodes.${node.id}`));
	for (const edge of records(network.edges, 'network.edges')) {
		const path = `network.edges.${edge.id}`;
		check(
			nodeIds.has(edge.from) && nodeIds.has(edge.to),
			path,
			'edge endpoints must reference existing nodes'
		);
		check(edge.from !== edge.to, path, 'edge endpoints must differ');
		check(
			isFiniteNumber(edge.distanceM) && edge.distanceM > 0,
			`${path}.distanceM`,
			'expected a finite positive distance'
		);
		check(
			typeof edge.walkAllowed === 'boolean' && typeof edge.driveAllowed === 'boolean',
			path,
			'expected walk/drive permission flags'
		);
		check(
			edge.oneway === undefined || typeof edge.oneway === 'boolean',
			`${path}.oneway`,
			'expected a boolean'
		);
		if (edge.geometry !== undefined) {
			coordinates(edge.geometry, `${path}.geometry`);
			check(
				(edge.geometry as unknown[]).length >= 2,
				`${path}.geometry`,
				'expected a road polyline'
			);
		}
	}
	for (const facility of records(bundle.facilities, 'facilities')) {
		const path = `facilities.${facility.id}`;
		position(facility, path);
		islandReference(facility, path);
		check(isText(facility.name), `${path}.name`, 'expected an institution name');
		check(
			['hospital', 'clinic', 'school', 'college'].includes(facility.kind as string),
			`${path}.kind`,
			'unknown institution category'
		);
		check(
			facility.verification === undefined ||
				typeof facility.verification === 'string' ||
				typeof facility.verification === 'boolean',
			`${path}.verification`,
			'expected verification status'
		);
		sourceReferences(facility, path);
		const auditedHealth =
			bundle.facilityAuditVersion !== undefined &&
			(facility.kind === 'hospital' || facility.kind === 'clinic');
		const auditedEducation =
			bundle.facilityOperationReview !== undefined &&
			(facility.kind === 'school' || facility.kind === 'college');
		if (auditedHealth || facility.careScope !== undefined)
			check(
				['general', 'specialist', 'restricted', 'unverified'].includes(
					facility.careScope as string
				),
				`${path}.careScope`,
				'expected a reviewed healthcare scope'
			);
		if (auditedHealth || auditedEducation || facility.operatingStatus !== undefined) {
			check(
				['open', 'closed', 'relocated', 'unverified'].includes(facility.operatingStatus as string),
				`${path}.operatingStatus`,
				'expected a reviewed operating status'
			);
			check(
				validDate(facility.statusReviewedAt),
				`${path}.statusReviewedAt`,
				'expected a valid audit review date'
			);
			sourceReferences({ sourceIds: facility.statusSourceIds }, `${path}.statusEvidence`, true);
		}
		if (facility.registryId !== undefined)
			check(isText(facility.registryId), `${path}.registryId`, 'expected a registry identifier');
		if (facility.statusNote !== undefined)
			check(isText(facility.statusNote), `${path}.statusNote`, 'expected an audit qualification');
	}
	const transit = object(bundle.transit, 'transit');
	const stops = records(transit.stops, 'transit.stops');
	const stopIds = new Set(stops.map((stop) => stop.id));
	for (const stop of stops) {
		const path = `transit.stops.${stop.id}`;
		position(stop, path);
		islandReference(stop, path);
		check(isText(stop.name), `${path}.name`, 'expected a stop name');
		check(
			stop.mode === undefined || stop.mode === 'bus' || stop.mode === 'ferry',
			`${path}.mode`,
			'unknown mode'
		);
		check(
			stop.disabled === undefined || typeof stop.disabled === 'boolean',
			`${path}.disabled`,
			'expected a boolean'
		);
		check(
			stop.pickupAllowed === undefined || typeof stop.pickupAllowed === 'boolean',
			`${path}.pickupAllowed`,
			'expected a boolean'
		);
		sourceReferences(stop, path, true);
	}
	check(
		array(transit.gaps, 'transit.gaps').every((gap) => typeof gap === 'string'),
		'transit.gaps',
		'expected gap descriptions'
	);
	for (const pattern of records(transit.patterns, 'transit.patterns')) {
		const path = `transit.patterns.${pattern.id}`;
		check(isText(pattern.name) && isText(pattern.routeId), path, 'expected route ID and name');
		check(pattern.mode === 'bus' || pattern.mode === 'ferry', `${path}.mode`, 'unknown mode');
		check(
			pattern.provenance === 'observed' || pattern.provenance === 'assumed',
			`${path}.provenance`,
			'expected evidence provenance'
		);
		const ids = array(pattern.stopIds, `${path}.stopIds`);
		check(
			ids.every((id) => typeof id === 'string' && stopIds.has(id)),
			`${path}.stopIds`,
			'unknown stop reference'
		);
		sourceReferences(pattern, path, true);
		const calendar = object(pattern.calendar, `${path}.calendar`);
		const weekdays = array(calendar.weekdays, `${path}.calendar.weekdays`);
		check(
			weekdays.every((day) => isFiniteNumber(day) && Number.isInteger(day) && day >= 0 && day <= 6),
			`${path}.calendar.weekdays`,
			'invalid weekday'
		);
		check(
			new Set(weekdays).size === weekdays.length,
			`${path}.calendar.weekdays`,
			'duplicate weekdays'
		);
		for (const key of ['startDate', 'endDate']) {
			if (calendar[key] !== undefined)
				check(validDate(calendar[key]), `${path}.calendar.${key}`, 'invalid calendar date');
		}
		if (calendar.startDate !== undefined && calendar.endDate !== undefined)
			check(
				String(calendar.startDate) <= String(calendar.endDate),
				`${path}.calendar`,
				'end date precedes start date'
			);
		for (const key of ['includedDates', 'excludedDates']) {
			if (calendar[key] !== undefined)
				check(
					array(calendar[key], `${path}.calendar.${key}`).every(validDate),
					`${path}.calendar.${key}`,
					'invalid calendar date'
				);
		}
		const timing = object(pattern.timing, `${path}.timing`);
		check(
			timing.kind === 'scheduled' || timing.kind === 'frequency',
			`${path}.timing.kind`,
			'unknown timing kind'
		);
		if (timing.kind === 'scheduled') {
			for (const trip of records(timing.trips, `${path}.timing.trips`)) {
				for (const time of array(trip.stopTimes, `${path}.timing.trips.${trip.id}.stopTimes`)) {
					const t = object(time, `${path}.timing.trips.${trip.id}.stopTimes`);
					check(
						isFiniteNumber(t.arrivalMinutes) &&
							t.arrivalMinutes >= 0 &&
							isFiniteNumber(t.departureMinutes) &&
							t.departureMinutes >= 0,
						`${path}.timing.trips.${trip.id}`,
						'expected finite nonnegative service minutes'
					);
				}
			}
		} else {
			array(timing.segmentMinutes, `${path}.timing.segmentMinutes`);
			array(timing.windows, `${path}.timing.windows`).forEach((window) =>
				object(window, `${path}.timing.windows`)
			);
		}
		check(
			patternIsValid(pattern as unknown as PlanningServicePattern),
			`${path}.timing`,
			'incomplete, inconsistent or non-monotonic service timing'
		);
		if (pattern.distanceM !== undefined && pattern.distanceM !== null)
			check(
				isFiniteNumber(pattern.distanceM) && pattern.distanceM > 0,
				`${path}.distanceM`,
				'expected a positive distance or unavailable value'
			);
		if (pattern.geometry !== undefined) coordinates(pattern.geometry, `${path}.geometry`);
		if (pattern.segmentGeometry !== undefined) {
			const segments = array(pattern.segmentGeometry, `${path}.segmentGeometry`);
			check(
				segments.length === ids.length - 1,
				`${path}.segmentGeometry`,
				'segment count differs from ordered stop pairs'
			);
			segments.forEach((segment, index) =>
				coordinates(segment, `${path}.segmentGeometry[${index}]`)
			);
		}
		if (pattern.segmentDistanceM !== undefined) {
			const segments = array(pattern.segmentDistanceM, `${path}.segmentDistanceM`);
			check(
				segments.length === ids.length - 1 &&
					segments.every(
						(segment) => segment === null || (isFiniteNumber(segment) && segment >= 0)
					),
				`${path}.segmentDistanceM`,
				'invalid ordered segment distances'
			);
		}
	}
	return value as PlanningBaseline;
}

export interface PlanningFileMetadata {
	mtimeMs: number;
	size: number;
	ctimeMs?: number;
	ino?: number;
}
export interface PlanningLoaderOptions {
	filePath?: string;
	read?: (path: string) => Promise<Uint8Array>;
	metadata?: (path: string) => Promise<PlanningFileMetadata>;
}
export interface LoadedPlanningBaseline {
	bundle: PlanningBaseline;
	etag: string;
	stale: boolean;
}

/** Isolated caches are injectable for testing without editing the installed snapshot. */
export function createPlanningBaselineLoader(options: PlanningLoaderOptions = {}) {
	const filePath = options.filePath ?? join(process.cwd(), 'data/public/planning-baseline.json');
	const read = options.read ?? readFile;
	const metadata = options.metadata ?? stat;
	let validated: { bundle: PlanningBaseline; etag: string; signature: string } | undefined;
	let rejectedSignature: string | undefined;
	let inFlight: Promise<LoadedPlanningBaseline> | undefined;
	function signature(meta: PlanningFileMetadata) {
		return `${meta.mtimeMs}:${meta.ctimeMs ?? ''}:${meta.size}:${meta.ino ?? ''}`;
	}
	async function load(): Promise<LoadedPlanningBaseline> {
		let currentSignature: string | undefined;
		let validatingBytes = false;
		try {
			currentSignature = signature(await metadata(filePath));
			if (validated && currentSignature === validated.signature)
				return { bundle: validated.bundle, etag: validated.etag, stale: false };
			if (validated && currentSignature === rejectedSignature)
				return { bundle: validated.bundle, etag: validated.etag, stale: true };
			const bytes = await read(filePath);
			check(
				signature(await metadata(filePath)) === currentSignature,
				'file',
				'snapshot changed during read; retry after the file replacement completes'
			);
			validatingBytes = true;
			const bundle = validatePlanningBaseline(JSON.parse(Buffer.from(bytes).toString('utf8')), {
				requireOperationReviews: true
			});
			validated = {
				bundle,
				etag: `"${createHash('sha256').update(bytes).digest('hex')}"`,
				signature: currentSignature
			};
			rejectedSignature = undefined;
			return { bundle, etag: validated.etag, stale: false };
		} catch (error) {
			// A malformed snapshot can stay cached as rejected. A temporary file
			// lock/read race must be retried even if its metadata did not change.
			rejectedSignature = validatingBytes ? currentSignature : undefined;
			if (validated) return { bundle: validated.bundle, etag: validated.etag, stale: true };
			throw error;
		}
	}
	return function loadCachedPlanningBaseline(): Promise<LoadedPlanningBaseline> {
		if (!inFlight)
			inFlight = load().finally(() => {
				inFlight = undefined;
			});
		return inFlight;
	};
}

/** A damaged replacement never causes a demonstration-data substitution. */
export const loadPlanningBaseline = createPlanningBaselineLoader();
