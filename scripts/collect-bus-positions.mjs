/** Bounded research capture of the public RTL client's route-coordinate capability.
 * Raw identifiers and plates are discarded. Outputs remain in ignored data/raw.
 * Retrieval timestamps are not measurement timestamps; this is not an ETA model.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { mkdir, writeFile, appendFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ENDPOINT = 'https://bo.rtl.mv:4455/maldives/api/booking/v1/bus/livecoordinates';
export const ROUTE = '133';
export const QUALIFICATION =
	'Fetch-time public route-coordinate observations. Source measurement timestamp, trip/direction and GPS freshness are unverified. Stationary positions do not by themselves establish stale data. No arrival prediction has been evaluated. Public access does not establish an open redistribution licence.';

/**
 * @param {{busList?: Array<{busCode?:unknown, plateNumber?:unknown, routeCode?:unknown, latitude?:unknown, longitude?:unknown}>, routeCode?:unknown}|null} payload
 * @param {string} receivedAt
 * @param {import('node:crypto').BinaryLike} salt
 */
export function parseCoordinates(payload, receivedAt, salt) {
	if (!payload || typeof payload !== 'object' || !Array.isArray(payload.busList))
		throw new Error('Unexpected public coordinate response schema');
	if (!Number.isFinite(Date.parse(receivedAt))) throw new Error('Invalid retrieval timestamp');
	if (payload.routeCode != null && String(payload.routeCode) !== ROUTE)
		throw new Error('Source route association mismatch');
	let excluded = 0;
	const vehicles = [];
	const seen = new Set();
	for (const bus of payload.busList) {
		if (!bus || typeof bus !== 'object' || typeof bus.busCode !== 'string' || !bus.busCode.trim()) {
			excluded++;
			continue;
		}
		if (bus.routeCode != null && String(bus.routeCode) !== ROUTE) {
			excluded++;
			continue;
		}
		const { latitude, longitude } = bus;
		if (
			typeof latitude !== 'number' ||
			typeof longitude !== 'number' ||
			!Number.isFinite(latitude) ||
			!Number.isFinite(longitude) ||
			latitude < 3.8 ||
			latitude > 4.6 ||
			longitude < 73.2 ||
			longitude > 73.8
		) {
			excluded++;
			continue;
		}
		const id = `vehicle-${createHmac('sha256', salt).update(bus.busCode).digest('hex').slice(0, 16)}`;
		if (seen.has(id)) {
			excluded++;
			continue;
		}
		seen.add(id);
		vehicles.push({ id, latitude, longitude });
	}
	vehicles.sort((a, b) => a.id.localeCompare(b.id));
	return { receivedAt, vehicles, excluded, measurementTimestampAvailable: false };
}

/**
 * @param {{vehicles:Array<{id:string,latitude:number,longitude:number}>}|undefined} previous
 * @param {{vehicles:Array<{id:string,latitude:number,longitude:number}>}} current
 */
export function assessSequence(previous, current) {
	const old = new Map((previous?.vehicles ?? []).map((v) => [v.id, v]));
	let comparedVehicles = 0,
		changedPositions = 0;
	for (const vehicle of current.vehicles) {
		const before = old.get(vehicle.id);
		if (!before) continue;
		comparedVehicles++;
		if (before.latitude !== vehicle.latitude || before.longitude !== vehicle.longitude)
			changedPositions++;
	}
	return {
		comparedVehicles,
		changedPositions,
		unchangedPositions: comparedVehicles - changedPositions,
		positionsRepeated: comparedVehicles > 0 && changedPositions === 0,
		freshness: 'measurement-time-unverified'
	};
}

/** @param {string[]} args */
export function captureOptions(args) {
	const result = { minutes: 10, intervalSeconds: 60 };
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--minutes') result.minutes = Number(args[++i]);
		else if (args[i] === '--interval-seconds') result.intervalSeconds = Number(args[++i]);
		else throw new Error('Supported options: --minutes 1..120 --interval-seconds 60..600');
	}
	if (
		!Number.isFinite(result.minutes) ||
		result.minutes < 1 ||
		result.minutes > 120 ||
		!Number.isFinite(result.intervalSeconds) ||
		result.intervalSeconds < 60 ||
		result.intervalSeconds > 600
	)
		throw new Error('Capture must be bounded to 1..120 minutes with 60..600 second sampling');
	return result;
}

/**
 * @param {{minutes:number,intervalSeconds:number}} options
 * @param {{fetch?:typeof fetch,sleep?:(ms:number)=>Promise<void>,now?:()=>number}} dependencies
 */
export async function collect(options, dependencies = {}) {
	const fetcher = dependencies.fetch ?? fetch;
	const sleep = dependencies.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
	const now = dependencies.now ?? Date.now;
	const start = now(),
		stop = start + options.minutes * 60_000;
	const session = new Date(start).toISOString().replace(/[:.]/g, '-');
	const directory = resolve('data/raw/prediction', session);
	await mkdir(directory, { recursive: true });
	const salt = randomBytes(32);
	const snapshots = [];
	const quality = [];
	/** @type {ReturnType<typeof parseCoordinates>|undefined} */
	let previous;
	let failures = 0,
		stopReason = 'bounded-duration-complete';
	while (now() <= stop) {
		try {
			const response = await fetcher(ENDPOINT, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
				body: JSON.stringify({ routeCode: ROUTE }),
				signal: AbortSignal.timeout(20_000)
			});
			if ([401, 403, 404, 429].includes(response.status)) {
				stopReason = `source-refused-${response.status}`;
				break;
			}
			if (!response.ok) throw new Error(`Source HTTP ${response.status}`);
			const body = await response.text();
			const snapshot = parseCoordinates(JSON.parse(body), new Date(now()).toISOString(), salt);
			const flags = assessSequence(previous, snapshot);
			quality.push({
				receivedAt: snapshot.receivedAt,
				checksum: createHash('sha256').update(body).digest('hex'),
				vehicleCount: snapshot.vehicles.length,
				excluded: snapshot.excluded,
				...flags
			});
			snapshots.push({ receivedAt: snapshot.receivedAt, vehicles: snapshot.vehicles });
			await appendFile(
				join(directory, 'observations.ndjson'),
				`${JSON.stringify({ ...snapshot, ...flags })}\n`
			);
			previous = snapshot;
			failures = 0;
			console.log(
				JSON.stringify({
					receivedAt: snapshot.receivedAt,
					vehicles: snapshot.vehicles.length,
					changedPositions: flags.changedPositions,
					freshness: flags.freshness
				})
			);
		} catch (error) {
			failures++;
			// No response bodies or identifiers in logs. Schema/source errors stop collection.
			const message = error instanceof Error ? error.message : 'Capture failed';
			if (/schema|route association|retrieval timestamp/.test(message) || failures >= 3) {
				stopReason = 'source-or-schema-check-failed';
				break;
			}
			console.log(JSON.stringify({ status: 'retry', consecutiveFailures: failures }));
		}
		const waitMs = Math.min(
			options.intervalSeconds * 1000 * Math.min(4, 2 ** failures),
			stop - now()
		);
		if (waitMs <= 0) break;
		await sleep(waitMs);
	}
	const replay = {
		sourceUrl: ENDPOINT,
		routeId: ROUTE,
		routeName: 'Public route code 133',
		measurementTimestampAvailable: false,
		snapshots,
		qualification: QUALIFICATION
	};
	const receipt = {
		startedAt: new Date(start).toISOString(),
		completedAt: new Date(now()).toISOString(),
		options,
		sourceUrl: ENDPOINT,
		sourceRequestRouteCode: ROUTE,
		stopReason,
		snapshots: snapshots.length,
		measurementTimestampAvailable: false,
		redistributionLicence: 'No explicit open licence verified; private research archive',
		changedPositionComparisons: quality.reduce((sum, sample) => sum + sample.changedPositions, 0),
		excludedCoordinates: quality.reduce((sum, sample) => sum + sample.excluded, 0),
		quality,
		qualification: QUALIFICATION
	};
	await writeFile(join(directory, 'replay.json'), JSON.stringify(replay, null, 2));
	await writeFile(join(directory, 'receipt.json'), JSON.stringify(receipt, null, 2));
	console.log(
		JSON.stringify({
			directory,
			snapshots: snapshots.length,
			stopReason,
			changedPositionComparisons: receipt.changedPositionComparisons
		})
	);
	return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	collect(captureOptions(process.argv.slice(2))).catch(() => {
		console.error('Bounded capture failed; no source payload or identifier was logged.');
		process.exitCode = 1;
	});
}
