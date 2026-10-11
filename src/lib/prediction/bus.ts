import type { BusObservationReplay, BusReadiness, BusSnapshot, BusPosition } from './types';

export interface ReviewedCorridor {
	id: string;
	routeId: string;
	direction: string;
	reviewed: boolean;
	geometry: Array<[number, number]>; // longitude, latitude in reviewed travel order
	startFraction: number;
	endFraction: number;
	stopFractions?: number[];
	stopBufferFraction?: number;
}
export interface CorridorPassage {
	corridorId: string;
	direction: string;
	vehicleId: string;
	entry: { earliest: string; latest: string };
	exit: { earliest: string; latest: string };
	seconds: { lower: number; upper: number; midpoint: number };
	stopAssociatedSecondsUpper: number;
	qualification: string;
}
const distance = (a: [number, number], b: [number, number]) => {
	const y = (b[1] - a[1]) * 111_195;
	const x = (b[0] - a[0]) * 111_195 * Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
	return Math.hypot(x, y);
};
const validPosition = (p: BusPosition) =>
	Number.isFinite(p.latitude) &&
	Number.isFinite(p.longitude) &&
	Math.abs(p.latitude) <= 90 &&
	Math.abs(p.longitude) <= 180;

export function matchCorridorPosition(
	position: BusPosition,
	corridor: ReviewedCorridor,
	maxDistanceMeters = 80
): { fraction: number; distanceMeters: number } | null {
	if (
		!corridor.reviewed ||
		!validPosition(position) ||
		corridor.geometry.length < 2 ||
		corridor.geometry.some(
			([x, y]) =>
				!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 180 || Math.abs(y) > 90
		)
	)
		return null;
	const p: [number, number] = [position.longitude, position.latitude];
	const lengths = corridor.geometry.slice(1).map((b, i) => distance(corridor.geometry[i], b));
	const total = lengths.reduce((a, b) => a + b, 0);
	if (!total) return null;
	let cumulative = 0;
	let nearest = { fraction: 0, distanceMeters: Infinity };
	const candidates: Array<{ fraction: number; distanceMeters: number }> = [];
	for (let i = 0; i < lengths.length; i++) {
		const a = corridor.geometry[i],
			b = corridor.geometry[i + 1];
		const cosine = Math.cos((position.latitude * Math.PI) / 180);
		const dx = (b[0] - a[0]) * cosine,
			dy = b[1] - a[1];
		const t = Math.max(
			0,
			Math.min(1, ((p[0] - a[0]) * cosine * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1))
		);
		const metres = distance(p, [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
		candidates.push({ fraction: (cumulative + t * lengths[i]) / total, distanceMeters: metres });
		if (metres < nearest.distanceMeters)
			nearest = { fraction: (cumulative + t * lengths[i]) / total, distanceMeters: metres };
		cumulative += lengths[i];
	}
	// Loop/crossing/parallel-route ambiguity cannot be resolved by nearest distance alone.
	if (
		candidates.some(
			(c) =>
				c.distanceMeters <= nearest.distanceMeters + 10 &&
				Math.abs(c.fraction - nearest.fraction) > 0.1
		)
	)
		return null;
	return nearest.distanceMeters <= maxDistanceMeters ? nearest : null;
}

export function buildCorridorPassages(
	snapshots: BusSnapshot[],
	corridor: ReviewedCorridor,
	maxGapSeconds = 90
): CorridorPassage[] {
	if (
		!corridor.reviewed ||
		!(
			corridor.startFraction > 0 &&
			corridor.endFraction < 1 &&
			corridor.startFraction < corridor.endFraction
		)
	)
		return [];
	const passages: CorridorPassage[] = [];
	type Track = {
		time: number;
		fraction: number;
		position: BusPosition;
		entry?: { earliest: string; latest: string };
		stopSeconds: number;
	};
	const tracks = new Map<string, Track>();
	// Preserve supplied chronology: reject non-increasing/invalid timestamps instead of repairing it silently.
	let previousSnapshotTime = -Infinity;
	for (const snapshot of snapshots) {
		const time = Date.parse(snapshot.receivedAt);
		if (!Number.isFinite(time) || time <= previousSnapshotTime) {
			tracks.clear();
			continue;
		}
		previousSnapshotTime = time;
		const seen = new Set<string>();
		const counts = new Map<string, number>();
		for (const p of snapshot.vehicles) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
		for (const position of snapshot.vehicles) {
			if ((counts.get(position.id) ?? 0) > 1) {
				tracks.delete(position.id);
				continue;
			}
			seen.add(position.id);
			const matched = matchCorridorPosition(position, corridor);
			if (!matched) {
				tracks.delete(position.id);
				continue;
			}
			const old = tracks.get(position.id);
			const current: Track = { time, fraction: matched.fraction, position, stopSeconds: 0 };
			if (old) {
				const seconds = (time - old.time) / 1000;
				const speed =
					(distance(
						[old.position.longitude, old.position.latitude],
						[position.longitude, position.latitude]
					) /
						seconds) *
					3.6;
				const reversed = matched.fraction < old.fraction - 0.01;
				if (seconds <= maxGapSeconds && speed <= 100 && !reversed) {
					current.entry = old.entry;
					current.stopSeconds = old.stopSeconds;
					if (old.fraction < corridor.startFraction && matched.fraction >= corridor.startFraction)
						current.entry = {
							earliest: new Date(old.time).toISOString(),
							latest: snapshot.receivedAt
						};
					if (current.entry) {
						const buffer = corridor.stopBufferFraction ?? 0.025;
						if (
							(corridor.stopFractions ?? []).some(
								(stop) => stop + buffer >= old.fraction && stop - buffer <= matched.fraction
							)
						)
							current.stopSeconds += seconds;
						if (old.fraction < corridor.endFraction && matched.fraction >= corridor.endFraction) {
							const exit = {
								earliest: new Date(old.time).toISOString(),
								latest: snapshot.receivedAt
							};
							const lower = Math.max(
								0,
								(Date.parse(exit.earliest) - Date.parse(current.entry.latest)) / 1000
							);
							const upper = (time - Date.parse(current.entry.earliest)) / 1000;
							passages.push({
								corridorId: corridor.id,
								direction: corridor.direction,
								vehicleId: position.id,
								entry: current.entry,
								exit,
								seconds: { lower, upper, midpoint: (lower + upper) / 2 },
								stopAssociatedSecondsUpper: Math.min(upper, current.stopSeconds),
								qualification:
									'Receipt-time passage bracket; source latency unknown. Stop-associated intervals are not measured boarding dwell. Not a physical-arrival label.'
							});
							current.entry = undefined;
							current.stopSeconds = 0;
						}
					}
				}
			}
			tracks.set(position.id, current);
		}
		// Missing vehicles break continuity: never bridge an unseen interval silently.
		for (const id of tracks.keys()) if (!seen.has(id)) tracks.delete(id);
	}
	return passages;
}

export function getBusReadiness(
	replay: BusObservationReplay | undefined,
	now: Date,
	capture?: unknown
): BusReadiness {
	const snapshots = (replay?.snapshots ?? []).filter(
		(s) => Number.isFinite(Date.parse(s.receivedAt)) && Date.parse(s.receivedAt) <= now.getTime()
	);
	const ordered = [...snapshots].sort(
		(a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt)
	);
	const ids = new Set<string>(),
		days = new Set<string>();
	const prior = new Map<string, BusPosition>();
	let changedPositionIntervals = 0;
	for (const snapshot of ordered) {
		days.add(new Date(Date.parse(snapshot.receivedAt) + 5 * 3600_000).toISOString().slice(0, 10));
		for (const p of snapshot.vehicles.filter(validPosition)) {
			ids.add(p.id);
			const previous = prior.get(p.id);
			if (previous && (previous.latitude !== p.latitude || previous.longitude !== p.longitude))
				changedPositionIntervals++;
			prior.set(p.id, p);
		}
	}
	const last = ordered.at(-1)?.receivedAt ?? null;
	const stale = last && now.getTime() - Date.parse(last) > 180_000;
	const result: BusReadiness = {
		status: !ordered.length ? 'unavailable' : stale ? 'dated-replay' : 'collecting',
		qualification:
			'No validated near-term bus forecast is available. Recorded coordinates are source reports at receipt time; measurement time and upstream latency are unknown. An unchanged coordinate may be a legitimate stop, not a stale feed.',
		coverage: {
			snapshots: ordered.length,
			vehicles: ids.size,
			observedDays: days.size,
			changedPositionIntervals,
			firstReceivedAt: ordered[0]?.receivedAt ?? null,
			lastReceivedAt: last,
			sourceMeasurementTimestampAvailable: false
		},
		replay: replay ? { ...replay, snapshots: ordered } : null,
		modelCard: {
			target: 'Experimental receipt-time directional corridor passage',
			intendedUse:
				'Collect and quality-review trajectory evidence before testing short-horizon bus-runtime models.',
			excludedUses: [
				'All-vehicle congestion',
				'Measured boarding dwell',
				'True physical arrival or appointment outcome',
				'Trained outcomes from timetable or animation'
			],
			trainingCutoff: last,
			evaluation: 'Not validated: no released chronological trip/day runtime evaluation.',
			limitations: [
				'At least seven usable days and adequate independent passages are required before evaluation.',
				'Source latency and redistribution permission remain unresolved.',
				'A dated replay is never live; fresh receipt does not certify fresh measurement.'
			]
		}
	};
	if (!ordered.length && capture && typeof capture === 'object') {
		const receipt = capture as Record<string, unknown>;
		const validCount = (key: string) =>
			typeof receipt[key] === 'number' &&
			Number.isInteger(receipt[key]) &&
			(receipt[key] as number) >= 0;
		const start = typeof receipt.startedAt === 'string' ? Date.parse(receipt.startedAt) : NaN;
		const end = typeof receipt.completedAt === 'string' ? Date.parse(receipt.completedAt) : start;
		const firstReceipt =
			typeof receipt.firstReceivedAt === 'string' ? Date.parse(receipt.firstReceivedAt) : start;
		const lastReceipt =
			typeof receipt.lastReceivedAt === 'string' ? Date.parse(receipt.lastReceivedAt) : end;
		if (
			(receipt.status === 'collecting' || receipt.status === 'completed') &&
			['snapshots', 'vehicles', 'observedDays', 'changedPositionIntervals'].every(validCount) &&
			(receipt.snapshots as number) > 0 &&
			Number.isFinite(start) &&
			Number.isFinite(end) &&
			Number.isFinite(firstReceipt) &&
			Number.isFinite(lastReceipt) &&
			start <= firstReceipt &&
			firstReceipt <= lastReceipt &&
			lastReceipt <= end &&
			start <= end &&
			end <= now.getTime() &&
			receipt.measurementTimestampAvailable === false
		) {
			result.status = 'collecting';
			result.coverage = {
				snapshots: receipt.snapshots as number,
				vehicles: receipt.vehicles as number,
				observedDays: receipt.observedDays as number,
				changedPositionIntervals: receipt.changedPositionIntervals as number,
				firstReceivedAt: new Date(firstReceipt).toISOString(),
				lastReceivedAt: new Date(lastReceipt).toISOString(),
				sourceMeasurementTimestampAvailable: false
			};
			result.qualification = `${typeof receipt.qualification === 'string' ? receipt.qualification : 'Private capture receipt.'} Only aggregate collection evidence is published; coordinates remain private because redistribution permission is unverified. This is dataset readiness, not a live feed or validated passage forecast.`;
			result.modelCard.trainingCutoff = new Date(lastReceipt).toISOString();
		}
	}
	return result;
}

export interface RuntimeForecastRequest {
	corridorId: string;
	direction: string;
	issuedAt: string;
	clock: string;
	lastReceivedAt: string;
	measurementTimestampAvailable: boolean;
	physicalArrivalTarget?: boolean;
	horizonMinutes?: number;
}
export interface RuntimeForecastResult {
	status: 'experimental' | 'unavailable';
	estimateSeconds: number | null;
	maeSeconds: number | null;
	persistenceMaeSeconds: number | null;
	evaluatedPassages: number;
	reason: string;
}
/** A conservative runtime utility; never enabled by sparse live points or schedules. */
export function forecastCorridorRuntime(
	passages: CorridorPassage[],
	request: RuntimeForecastRequest
): RuntimeForecastResult {
	const unavailable = (reason: string): RuntimeForecastResult => ({
		status: 'unavailable',
		estimateSeconds: null,
		maeSeconds: null,
		persistenceMaeSeconds: null,
		evaluatedPassages: 0,
		reason
	});
	const issued = Date.parse(request.issuedAt),
		clock = Date.parse(request.clock),
		last = Date.parse(request.lastReceivedAt);
	if (![issued, clock, last].every(Number.isFinite) || clock !== issued || last > issued)
		return unavailable('Future, simulated or invalid observation/issue clock.');
	if (
		request.horizonMinutes !== undefined &&
		(request.horizonMinutes <= 0 || request.horizonMinutes > 15)
	)
		return unavailable('Unsupported forecast horizon; this pilot supports at most 15 minutes.');
	if (issued - last > 180_000) return unavailable('Source receipt is stale.');
	if (request.physicalArrivalTarget && !request.measurementTimestampAvailable)
		return unavailable('Unknown source latency cannot support a physical-arrival target.');
	const seen = new Set<string>();
	const eligible = passages
		.filter((p) => {
			const key = `${p.vehicleId}|${p.entry.earliest}|${p.exit.latest}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return (
				p.corridorId === request.corridorId &&
				p.direction === request.direction &&
				Number.isFinite(Date.parse(p.exit.latest)) &&
				Date.parse(p.exit.latest) <= issued &&
				Date.parse(p.entry.earliest) <= Date.parse(p.entry.latest) &&
				Date.parse(p.entry.latest) <= Date.parse(p.exit.latest) &&
				p.seconds.lower > 0 &&
				p.seconds.upper >= p.seconds.lower &&
				Number.isFinite(p.seconds.midpoint) &&
				p.seconds.midpoint >= p.seconds.lower &&
				p.seconds.midpoint <= p.seconds.upper
			);
		})
		.sort((a, b) => Date.parse(a.exit.latest) - Date.parse(b.exit.latest));
	const day = (p: CorridorPassage) =>
		new Date(Date.parse(p.exit.latest) + 5 * 3600_000).toISOString().slice(0, 10);
	const days = [...new Set(eligible.map(day))];
	if (eligible.length < 100 || days.length < 7)
		return unavailable(
			'Collecting: require 100 qualified independent passages over seven usable days.'
		);
	const testDays = new Set(days.slice(-3));
	const median = (p: CorridorPassage[]) => {
		const values = p.map((x) => x.seconds.midpoint).sort((a, b) => a - b);
		return values[Math.floor(values.length / 2)];
	};
	let totalError = 0,
		persistenceError = 0,
		count = 0;
	for (const actual of eligible.filter((p) => testDays.has(day(p)))) {
		// Day-blocked evaluation; neither the same trip nor later day enters training.
		const training = eligible.filter(
			(p) => day(p) < day(actual) && Date.parse(p.exit.latest) < Date.parse(actual.entry.earliest)
		);
		if (training.length < 20) continue;
		totalError += Math.abs(median(training) - actual.seconds.midpoint);
		persistenceError += Math.abs(training.at(-1)!.seconds.midpoint - actual.seconds.midpoint);
		count++;
	}
	if (count < 10) return unavailable('Insufficient later-day independent passage evaluation.');
	if (totalError >= persistenceError)
		return unavailable(
			'The corridor median did not improve on persistence in later-day evaluation; no predictive improvement established.'
		);
	return {
		status: 'experimental',
		estimateSeconds: median(eligible),
		maeSeconds: totalError / count,
		persistenceMaeSeconds: persistenceError / count,
		evaluatedPassages: count,
		reason:
			'Experimental historical-median receipt-time corridor runtime, evaluated on three later days. Not calibrated physical arrival, remaining-time prediction or a future-clock forecast.'
	};
}
