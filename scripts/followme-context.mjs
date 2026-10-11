// Server/local use only. Public observations are an optional, dated context layer.
// FollowMe terms: https://followme.mv/?pg=terms (no open redistribution license).
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @typedef {{name: string | null, status: string | null, datetimeRaw: string | null}} PublicFence
 * @typedef {object} LocalVessel
 * @property {string} id
 * @property {string} name
 * @property {string | null} operator
 * @property {string} type
 * @property {string | null} locationLabel
 * @property {string | null} lastSeenLabel
 * @property {[number, number] | null} coordinates Longitude, latitude (WGS84).
 * @property {number | null} speedKnots
 * @property {number | null} headingDeg
 * @property {null} observedAt No verified timezone means no invented UTC timestamp.
 * @property {string | null} observedAtRaw
 * @property {null} observedTimezone
 * @property {PublicFence | null} fence
 * @property {string} sourceUrl
 * @property {string | null} directoryRetrievedAt
 * @property {string | null} retrievedAt
 */
/**
 * Fields from the unauthenticated website endpoint remain unknown until validated.
 * @typedef {object} PublicDevice
 * @property {unknown} [id]
 * @property {unknown} [imei] Never copied into normalized output.
 * @property {unknown} [name]
 * @property {unknown} [latitude]
 * @property {unknown} [longitude]
 * @property {unknown} [speed]
 * @property {unknown} [heading]
 * @property {unknown} [updated_at]
 * @property {{name?: unknown, status?: unknown, datetime?: unknown} | null} [fence]
 * @typedef {{status?: unknown, device?: PublicDevice}} PublicPayload
 * @typedef {{retrievedAt: string, payload: unknown}} AuthorizedApiCapture
 */

export const DIRECTORY_URL = 'https://m.followme.mv/public/';
export const TERMS_URL = 'https://followme.mv/?pg=terms';
export const API_DOCS_URL = 'https://followme.mv/api/v1/';
export const MIN_REQUEST_INTERVAL_MS = 60_000;
export const TRANSFORMATION_VERSION = 'followme-context-v1';
export const VESSEL_TYPES = new Set([
	'Dhoni',
	'Dinghy',
	'Excursion Dhoni',
	'Fishing Dhoni',
	'Landing Craft',
	'Oil Barge',
	'Safari',
	'Speed Boat',
	'Supply Boat',
	'Supply Dhoni',
	'Tug Boat',
	'Yacht'
]);
/** @param {import('node:crypto').BinaryLike} text */
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
/** @param {unknown} value @returns {string | null} */
const nonempty = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);
/** @param {unknown} value @returns {number | null} */
const numberOrNull = (value) =>
	value === null || value === undefined || value === ''
		? null
		: Number.isFinite(Number(value))
			? Number(value)
			: null;

/** @param {unknown} html @returns {string} */
function plainText(html) {
	/** @type {Record<string, string>} */
	const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
	return String(html ?? '')
		.replace(/<[^>]*>/g, '')
		.replace(/&#(?:x([a-f0-9]+)|(\d+));/gi, (_, hex, decimal) =>
			String.fromCodePoint(Number.parseInt(hex ?? decimal, hex ? 16 : 10))
		)
		.replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, entity) => entities[entity])
		.replace(/\s+/g, ' ')
		.trim();
}

// Public cards sometimes put contact numbers into names/operators. Exclude those too.
/** @param {unknown} value @returns {string | null} */
function publicLabel(value) {
	return nonempty(
		plainText(value)
			.replace(/(?:\+?960[ -]?)?\b\d{7,15}\b/g, '')
			.trim()
	);
}

/**
 * @param {string} html
 * @param {{retrievedAt?: string, sourceUrl?: string}} [options]
 * @returns {{vessels: LocalVessel[], directoryCardCount: number, excludedTypeCounts: Record<string, number>}}
 */
export function parseDirectory(html, { retrievedAt, sourceUrl = DIRECTORY_URL } = {}) {
	/** @type {LocalVessel[]} */
	const rows = [];
	let directoryCardCount = 0;
	/** @type {Record<string, number>} */
	const excludedTypeCounts = {};
	const seen = new Set();
	for (const match of html.matchAll(/<article\s+class="boat-card"[\s\S]*?<\/article>/g)) {
		directoryCardCount++;
		const card = match[0];
		const type = plainText(card.match(/class="boat-meta-link"[^>]*>\s*<span>([^<]+)<\/span>/)?.[1]);
		if (!VESSEL_TYPES.has(type)) {
			excludedTypeCounts[type || 'unknown'] = (excludedTypeCounts[type || 'unknown'] ?? 0) + 1;
			continue;
		}
		const href = card.match(/class="boat-main-link" href="([^"]+)"/)?.[1];
		if (!href || !/^\/public\/\?id=\d+$/.test(href))
			throw new Error('Unexpected public vessel link format.');
		const detailUrl = new URL(href, sourceUrl).href;
		if (seen.has(detailUrl)) throw new Error('Duplicate public vessel card.');
		seen.add(detailUrl);
		const name = publicLabel(card.match(/<h2>([\s\S]*?)<\/h2>/)?.[1]);
		if (!name) throw new Error('Public vessel card has no usable name.');
		rows.push({
			id: `followme-${sha256(detailUrl).slice(0, 16)}`,
			name,
			operator: publicLabel(card.match(/class="operator-name[^"]*"[^>]*>([\s\S]*?)<\/p>/)?.[1]),
			type,
			locationLabel: publicLabel(
				card.match(/class="boat-status"[^>]*>[\s\S]*?<strong>([\s\S]*?)<\/strong>/)?.[1]
			),
			lastSeenLabel: nonempty(plainText(card.match(/<time>([\s\S]*?)<\/time>/)?.[1])),
			coordinates: null,
			speedKnots: null,
			headingDeg: null,
			observedAt: null,
			observedAtRaw: null,
			observedTimezone: null,
			fence: null,
			sourceUrl: detailUrl,
			directoryRetrievedAt: retrievedAt ?? null,
			retrievedAt: retrievedAt ?? null
		});
	}
	if (!directoryCardCount || !rows.length)
		throw new Error('No public vessel cards found; source format may have changed.');
	return { vessels: rows, directoryCardCount, excludedTypeCounts };
}

/**
 * @param {LocalVessel} vessel
 * @param {PublicPayload} payload
 * @param {string | null} [retrievedAt]
 * @returns {LocalVessel}
 */
export function attachObservation(vessel, payload, retrievedAt = null) {
	if (payload?.status !== 'ok' || !payload.device)
		throw new Error('Public observation unavailable.');
	const d = payload.device;
	const lat = numberOrNull(d.latitude);
	const lon = numberOrNull(d.longitude);
	if (
		lat === null ||
		lon === null ||
		lat < -90 ||
		lat > 90 ||
		lon < -180 ||
		lon > 180 ||
		(lat === 0 && lon === 0)
	) {
		throw new Error('Public observation has invalid coordinates.');
	}
	const publicId = new URL(vessel.sourceUrl).searchParams.get('id');
	if (String(d.id) !== publicId)
		throw new Error('Public observation does not match its directory card.');
	const speed = numberOrNull(d.speed);
	const heading = numberOrNull(d.heading);
	return {
		...vessel,
		coordinates: [lon, lat],
		speedKnots: speed !== null && speed >= 0 ? speed : null,
		headingDeg: heading !== null && heading >= 0 && heading < 360 ? heading : null,
		// The endpoint supplies a timezone-less date. Do not silently turn it into UTC.
		observedAt: null,
		observedAtRaw: nonempty(d.updated_at),
		observedTimezone: null,
		fence: d.fence
			? {
					name: publicLabel(d.fence.name),
					status: nonempty(d.fence.status),
					datetimeRaw: nonempty(d.fence.datetime)
				}
			: null,
		retrievedAt
	};
}

/** Authorized API transport only. Its response schema is not documented/verified here.
 * Never import this Node module into a client bundle or return the unsanitized payload.
 * The key appears in the provider URL path; errors intentionally hide request URLs.
 * @param {{apiKey?: string, fetchFn?: typeof fetch, now?: () => number}} [options]
 * @returns {() => Promise<AuthorizedApiCapture>}
 */
export function createKeyedPublicApiClient({ apiKey, fetchFn = fetch, now = Date.now } = {}) {
	let lastRequestAt = -Infinity;
	/** @type {Promise<AuthorizedApiCapture> | undefined} */
	let pending;
	/** @type {AuthorizedApiCapture | undefined} */
	let cached;
	return async function getPublicVessels() {
		const issuedKey = nonempty(apiKey);
		if (!issuedKey) throw new Error('A FollowMe-issued API key is required.');
		if (pending) return pending;
		if (now() - lastRequestAt < MIN_REQUEST_INTERVAL_MS) {
			if (cached) return cached;
			throw new Error('FollowMe permits at most one API request per minute.');
		}
		lastRequestAt = now();
		pending = (async () => {
			try {
				const response = await fetchFn(
					`https://followme.mv/api/v4/public/${encodeURIComponent(issuedKey)}/`,
					{
						headers: { Accept: 'application/json' },
						signal: AbortSignal.timeout(15_000)
					}
				);
				if (!response.ok) throw new Error('unavailable');
				cached = { retrievedAt: new Date(now()).toISOString(), payload: await response.json() };
				return cached;
			} catch {
				throw new Error('The authorized FollowMe public API could not be loaded.');
			} finally {
				pending = undefined;
			}
		})();
		return pending;
	};
}

/** @param {string} path @param {string} url @param {string} title */
async function captureFile(path, url, title) {
	const bytes = await readFile(path);
	const metadataPath = path.replace(/\.raw\.json$/, '.meta.json');
	/** @type {{retrievedAt?: string} | undefined} */
	let metadata;
	if (metadataPath !== path) {
		try {
			metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
		} catch {
			/* legacy one-shot sample */
		}
	}
	const retrievedAt = metadata?.retrievedAt ?? (await stat(path)).mtime.toISOString();
	const checksum = sha256(bytes);
	const observation = title.includes('observation');
	return {
		title,
		url,
		publisher: 'FollowMe Tracking Service',
		referencePeriod: `${retrievedAt.slice(0, 10)} ${observation ? 'one-shot position snapshot; provider timestamp timezone unconfirmed' : 'public directory snapshot; relative update labels only'}`,
		status: 'downloaded',
		retrievedAt,
		checksum,
		sha256: checksum,
		bytes: bytes.length,
		rawPath: path.replaceAll('\\', '/'),
		access: 'anonymous public website',
		termsUrl: TERMS_URL,
		license: 'FollowMe terms; local research cache, no open redistribution license',
		licenseStatus:
			'Public viewing; provider terms restrict scraping/redistribution. Local user-requested cache, not open data.',
		coverage: observation
			? 'One owner-public Greater Malé vessel observation; partial regional sample, not a service census.'
			: 'Owner-selected Maldives public vessel directory; allowlisted boat types only; excludes vehicles.',
		units: observation
			? 'WGS84 longitude/latitude degrees; speed knots; heading degrees; provider date-time strings with unconfirmed timezone.'
			: 'Vessel directory entries and capture-time relative update labels; no coordinates inferred.',
		transformationVersion: TRANSFORMATION_VERSION
	};
}

/** @param {string} [workspace] */
export async function normalizeCache(workspace = process.cwd()) {
	const cache = join(workspace, 'data/public/archive/context/followme');
	const directoryPath = join(cache, 'public-directory.html');
	const directorySource = await captureFile(
		directoryPath,
		DIRECTORY_URL,
		'FollowMe public vessel directory'
	);
	const directory = parseDirectory(await readFile(directoryPath, 'utf8'), {
		retrievedAt: directorySource.retrievedAt
	});
	/** @type {Array<Awaited<ReturnType<typeof captureFile>> & {id: string, endpoint?: string}>} */
	const sources = [{ id: 'followme-public-directory', ...directorySource }];
	const files = (await readdir(cache))
		.filter((name) => /^device-sample(?:-\d+)?\.raw\.json$/.test(name))
		.sort();
	if (files.length > 3)
		throw new Error('This local snapshot is limited to three public observations.');
	for (const filename of files) {
		const path = join(cache, filename);
		/** @type {PublicPayload} */
		const payload = JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''));
		const publicId = payload.device?.id;
		if (
			(typeof publicId !== 'string' && typeof publicId !== 'number') ||
			!/^\d+$/.test(String(publicId))
		) {
			throw new Error('Cached observation has no valid public directory reference.');
		}
		const detailUrl = new URL(`/public/?id=${encodeURIComponent(String(publicId))}`, DIRECTORY_URL)
			.href;
		const index = directory.vessels.findIndex((vessel) => vessel.sourceUrl === detailUrl);
		if (index < 0) throw new Error('Cached observation is not an allowlisted public vessel.');
		const source = await captureFile(
			path,
			detailUrl,
			'FollowMe one-shot public vessel observation'
		);
		const apiUrl = new URL('/public/api/device.php', DIRECTORY_URL);
		apiUrl.searchParams.set('id', String(publicId));
		sources.push({
			id: `followme-observation-${sources.length}`,
			...source,
			endpoint: apiUrl.href
		});
		directory.vessels[index] = attachObservation(
			directory.vessels[index],
			payload,
			source.retrievedAt
		);
	}
	const observed = directory.vessels.filter((vessel) => vessel.coordinates !== null).length;
	const gaps = [
		'Owner-selected public listings only; not all Maldives vessels or a census of public transport.',
		`Only ${observed} one-shot positions were sampled; remaining directory entries have no coordinates.`,
		'Update timestamps have no documented timezone; freshness and exact UTC observation time are unverified.',
		'GPS, device power and mobile coverage may delay positions. Directory relative times are capture-time labels.',
		'Vessel types/operator names are provider labels; passenger capacity, occupancy, fares and service eligibility are unknown.',
		'Positions/geofences are not scheduled routes, passenger flows, reliable operating costs or emissions evidence.',
		'FollowMe terms restrict scraping and redistribution. This user-requested research cache stays local and ignored.',
		'Documented keyed API is available as a server-only transport adapter; no issued key or response schema was acquired.'
	];
	const version = `followme-public-${sha256(JSON.stringify({ sources, vessels: directory.vessels })).slice(0, 12)}`;
	const context = {
		schemaVersion: 1,
		version,
		generatedAt: new Date().toISOString(),
		sources,
		vessels: directory.vessels,
		gaps
	};
	await writeFile(join(cache, 'context.json'), `${JSON.stringify(context, null, 2)}\n`);
	const manifest = {
		schemaVersion: 1,
		id: 'followme-public-context',
		title: 'FollowMe public vessel context',
		version,
		generatedAt: context.generatedAt,
		status: 'local-snapshot',
		sourceUrl: DIRECTORY_URL,
		termsUrl: TERMS_URL,
		apiDocsUrl: API_DOCS_URL,
		publicObservationEndpoint: 'https://m.followme.mv/public/api/device.php?id={public-list-id}',
		documentedKeyedEndpoint: 'https://followme.mv/api/v4/public/{issued-key}/',
		cachePath: 'data/public/archive/context/followme/context.json',
		attribution: 'FollowMe Tracking Service',
		license:
			'Provider terms; not open data. Local user-requested research snapshot; no raw records shipped.',
		coverage: {
			directoryCardCount: directory.directoryCardCount,
			vesselCount: directory.vessels.length,
			excludedTypeCounts: directory.excludedTypeCounts,
			sampledPositionCount: observed,
			missingPositionCount: directory.vessels.length - observed,
			timestampTimezone: null
		},
		provenance: sources.map(({ id, title, retrievedAt, sha256, bytes }) => ({
			id,
			title,
			retrievedAt,
			sha256,
			bytes
		})),
		gaps
	};
	const manifestPath = join(workspace, 'data/public/context/followme-source.json');
	await mkdir(dirname(manifestPath), { recursive: true });
	await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	return manifest;
}

/** @param {string} [workspace] */
export async function refreshKeyedCache(workspace = process.cwd()) {
	const apiKey = process.env.FOLLOWME_API_KEY;
	if (!nonempty(apiKey))
		throw new Error('Set a FollowMe-issued FOLLOWME_API_KEY on the server before keyed-refresh.');
	const cache = join(workspace, 'data/public/archive/context/followme');
	await mkdir(cache, { recursive: true });
	const metadataPath = join(cache, 'authorized-api.meta.json');
	/** @type {{attemptedAt?: string} | undefined} */
	let prior;
	try {
		prior = JSON.parse(await readFile(metadataPath, 'utf8'));
	} catch {
		/* first authorized fetch */
	}
	const attemptTime = Date.now();
	if (prior?.attemptedAt && attemptTime - Date.parse(prior.attemptedAt) < MIN_REQUEST_INTERVAL_MS) {
		throw new Error('FollowMe permits at most one API request per minute.');
	}
	const metadata = {
		attemptedAt: new Date(attemptTime).toISOString(),
		url: 'https://followme.mv/api/v4/public/{issued-key}/',
		termsUrl: TERMS_URL,
		status: 'pending',
		note: 'Authorized response schema unverified. Raw local cache is not automatically used by the website.'
	};
	await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
	const result = await createKeyedPublicApiClient({ apiKey })();
	const raw = `${JSON.stringify(result.payload, null, 2)}\n`;
	await writeFile(join(cache, 'authorized-api.raw.json'), raw);
	await writeFile(
		metadataPath,
		`${JSON.stringify({ ...metadata, status: 'downloaded', retrievedAt: result.retrievedAt, sha256: sha256(raw) }, null, 2)}\n`
	);
	return { status: 'downloaded', retrievedAt: result.retrievedAt, schemaVerified: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const command = process.argv[2] ?? 'prepare';
		if (command !== 'prepare' && command !== 'keyed-refresh')
			throw new Error('Use prepare (local cached files) or keyed-refresh (issued server API key).');
		if (command === 'keyed-refresh') {
			console.log(JSON.stringify(await refreshKeyedCache()));
		} else {
			const result = await normalizeCache();
			console.log(JSON.stringify({ version: result.version, coverage: result.coverage }));
		}
	} catch (error) {
		console.error(
			error instanceof Error ? error.message : 'FollowMe context normalization failed.'
		);
		process.exitCode = 1;
	}
}
