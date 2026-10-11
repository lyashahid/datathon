import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
	PredictionSource,
	PassengerSeries,
	BusObservationReplay
} from '#lib/prediction/types.ts';

type Row = Record<string, unknown>;
function object(value: unknown, label: string): Row {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error(`Invalid ${label}`);
	return value as Row;
}
function text(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new Error(`Missing ${label}`);
	return value;
}
function list(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`Invalid ${label}`);
	return value;
}
function timestamp(value: unknown): string {
	const result = text(value, 'timestamp');
	if (!/^\d{4}-\d{2}-\d{2}T/.test(result) || !Number.isFinite(Date.parse(result)))
		throw new Error('Invalid timestamp');
	return result;
}
function month(value: unknown): string {
	const result = text(value, 'month');
	if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(result)) throw new Error('Invalid reference month');
	return result;
}
function monthNumber(value: string): number {
	return Number(value.slice(0, 4)) * 12 + Number(value.slice(5));
}
function noIdentifiers(value: unknown): void {
	if (Array.isArray(value)) {
		value.forEach(noIdentifiers);
		return;
	}
	if (value && typeof value === 'object') {
		for (const [key, item] of Object.entries(value)) {
			if (/^(plateNumber|plate|busCode|imei|rawIdentifier|deviceId)$/i.test(key))
				throw new Error('Raw vehicle identity is forbidden in a public source');
			noIdentifiers(item);
		}
	}
}
function sourceUrl(value: unknown): string {
	const result = text(value, 'source URL');
	if (!URL.canParse(result)) throw new Error('Invalid source URL');
	const url = new URL(result);
	if (url.protocol !== 'https:' || url.hostname !== 'statisticsmaldives.gov.mv')
		throw new Error('Unrecognized monthly source');
	return result;
}
function captureReceipt(value: unknown): Row {
	const row = object(value, 'aggregate capture receipt');
	if (
		row.sourceUrl !== 'https://bo.rtl.mv:4455/maldives/api/booking/v1/bus/livecoordinates' ||
		row.routeId !== '133'
	)
		throw new Error('Unrecognized aggregate capture source/route');
	if (
		(row.status !== 'collecting' && row.status !== 'completed') ||
		row.measurementTimestampAvailable !== false
	)
		throw new Error('Unverified aggregate capture state or timestamp');
	for (const key of [
		'snapshots',
		'vehicles',
		'observedDays',
		'changedPositionIntervals',
		'positionChanges'
	]) {
		if (typeof row[key] !== 'number' || !Number.isInteger(row[key]) || (row[key] as number) < 0)
			throw new Error('Invalid aggregate capture count');
	}
	if (
		(row.changedPositionIntervals as number) > Math.max(0, (row.snapshots as number) - 1) ||
		(row.observedDays as number) > (row.snapshots as number)
	)
		throw new Error('Inconsistent aggregate capture counts');
	const startedAt = timestamp(row.startedAt),
		completedAt = timestamp(row.completedAt);
	const firstReceivedAt = timestamp(row.firstReceivedAt),
		lastReceivedAt = timestamp(row.lastReceivedAt);
	if (!(
		Date.parse(startedAt) <= Date.parse(firstReceivedAt) &&
		Date.parse(firstReceivedAt) <= Date.parse(lastReceivedAt) &&
		Date.parse(lastReceivedAt) <= Date.parse(completedAt)
	))
		throw new Error('Inconsistent aggregate observation window');
	// Allowlist excludes any accidentally attached positions or pseudonymous vehicle IDs.
	return {
		status: row.status,
		sourceUrl: row.sourceUrl,
		routeId: row.routeId,
		startedAt,
		completedAt,
		firstReceivedAt,
		lastReceivedAt,
		snapshots: row.snapshots,
		vehicles: row.vehicles,
		observedDays: row.observedDays,
		changedPositionIntervals: row.changedPositionIntervals,
		positionChanges: row.positionChanges,
		measurementTimestampAvailable: false,
		qualification: text(row.qualification, 'capture qualification'),
		stopReason: text(row.stopReason, 'capture stop reason'),
		intervalSeconds: row.intervalSeconds,
		redistributionLicence: text(row.redistributionLicence, 'capture reuse qualification')
	};
}
function series(value: unknown): PassengerSeries {
	const row = object(value, 'monthly series');
	if (row.mode !== 'bus' && row.mode !== 'ferry') throw new Error('Invalid passenger mode');
	if (row.unit !== 'passenger movements') throw new Error('Unverified passenger unit');
	const points = list(row.points, 'observations').map((entry) => {
		const point = object(entry, 'observation');
		if (
			typeof point.value !== 'number' ||
			!Number.isFinite(point.value) ||
			!Number.isInteger(point.value) ||
			point.value < 0
		)
			throw new Error('Invalid passenger count');
		return { month: month(point.month), value: point.value };
	});
	if (points.length < 24) throw new Error('Insufficient monthly history');
	for (let i = 1; i < points.length; i++) {
		if (monthNumber(points[i].month) !== monthNumber(points[i - 1].month) + 1)
			throw new Error('Duplicate, unordered or missing calendar month');
	}
	const lastActualMonth = month(row.lastActualMonth);
	if (points.at(-1)?.month !== lastActualMonth)
		throw new Error('Actual cutoff differs from source calendar');
	return {
		id: text(row.id, 'series id'),
		name: text(row.name, 'series name'),
		mode: row.mode,
		geography: text(row.geography, 'geography'),
		lastActualMonth,
		unit: row.unit,
		sourceUrl: sourceUrl(row.sourceUrl),
		points,
		qualification: text(row.qualification, 'qualification')
	};
}
function replay(value: unknown): BusObservationReplay {
	const row = object(value, 'bus replay');
	if (row.measurementTimestampAvailable !== false)
		throw new Error('Unverified source measurement timestamp claim');
	if (
		row.sourceUrl !== 'https://bo.rtl.mv:4455/maldives/api/booking/v1/bus/livecoordinates' ||
		row.routeId !== '133'
	)
		throw new Error('Unrecognized vehicle source/route');
	const snapshots = list(row.snapshots, 'snapshots').map((entry) => {
		const sample = object(entry, 'snapshot');
		const vehicles = list(sample.vehicles, 'vehicles').map((entry) => {
			const vehicle = object(entry, 'vehicle');
			const id = text(vehicle.id, 'pseudonymous vehicle id');
			if (!/^vehicle-[a-f0-9]{16}$/.test(id)) throw new Error('Non-pseudonymous vehicle identity');
			if (
				typeof vehicle.latitude !== 'number' ||
				typeof vehicle.longitude !== 'number' ||
				!Number.isFinite(vehicle.latitude) ||
				!Number.isFinite(vehicle.longitude) ||
				vehicle.latitude < 3.8 ||
				vehicle.latitude > 4.6 ||
				vehicle.longitude < 73.2 ||
				vehicle.longitude > 73.8
			)
				throw new Error('Invalid reviewed-corridor coordinates');
			return { id, latitude: vehicle.latitude, longitude: vehicle.longitude };
		});
		if (new Set(vehicles.map((v) => v.id)).size !== vehicles.length)
			throw new Error('Duplicate vehicle');
		return {
			receivedAt: timestamp(sample.receivedAt),
			vehicles,
			repeatedPayload: sample.repeatedPayload === true
		};
	});
	for (let i = 1; i < snapshots.length; i++) {
		if (Date.parse(snapshots[i].receivedAt) <= Date.parse(snapshots[i - 1].receivedAt))
			throw new Error('Unordered observation snapshots');
	}
	return {
		sourceUrl: row.sourceUrl,
		routeId: row.routeId,
		routeName: typeof row.routeName === 'string' ? row.routeName : undefined,
		measurementTimestampAvailable: false,
		snapshots,
		qualification: text(row.qualification, 'replay qualification')
	};
}

export function validatePredictionSource(value: unknown): PredictionSource {
	noIdentifiers(value);
	const row = object(value, 'prediction source');
	if (row.version !== 1) throw new Error('Unsupported prediction source version');
	const rawAudit = object(row.audit, 'source audit');
	const audit: Row = {
		...rawAudit,
		...(rawAudit.busCapture == null ? {} : { busCapture: captureReceipt(rawAudit.busCapture) })
	};
	const sourceIds = list(row.sourceIds, 'source IDs').map((entry) => text(entry, 'source ID'));
	if (!sourceIds.length || new Set(sourceIds).size !== sourceIds.length)
		throw new Error('Duplicate or empty source IDs');
	const sources = object(audit.sources, 'source receipts');
	if (Object.keys(sources).length !== sourceIds.length)
		throw new Error('Source receipt IDs differ from the declared sources');
	for (const id of sourceIds) {
		const source = object(sources[id], 'source receipt');
		sourceUrl(source.url);
		if (typeof source.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(source.sha256))
			throw new Error('Invalid source checksum');
		text(source.publication_sheet, 'publication sheet');
	}
	text(audit.transformVersion, 'monthly transform version');
	const checkedAt = timestamp(audit.monthlyAuditAsOf);
	const publishedAt = text(audit.publishedAt, 'publication date');
	const publicationTime = Date.parse(`${publishedAt}T00:00:00Z`);
	if (
		!/^\d{4}-\d{2}-\d{2}$/.test(publishedAt) ||
		!Number.isFinite(publicationTime) ||
		new Date(publicationTime).toISOString().slice(0, 10) !== publishedAt ||
		publicationTime > Date.parse(checkedAt) ||
		Date.parse(checkedAt) > Date.parse(timestamp(row.asOf))
	)
		throw new Error('Inconsistent publication or monthly audit date');
	const monthly = list(row.series, 'monthly series').map(series);
	if (!monthly.length || new Set(monthly.map((s) => s.id)).size !== monthly.length)
		throw new Error('Duplicate or empty series IDs');
	if (
		audit.quarantinedBusMonth === '2026-06' &&
		monthly.some((s) => s.mode === 'bus' && s.points.some((p) => p.month === '2026-06'))
	)
		throw new Error('Quarantined June bus observation cannot be trained');
	return {
		version: 1,
		asOf: timestamp(row.asOf),
		sourceIds,
		dataQualityNotes: list(row.dataQualityNotes, 'quality notes').map((entry) =>
			text(entry, 'quality note')
		),
		series: monthly,
		audit,
		...(row.busObservationReplay == null
			? {}
			: { busObservationReplay: replay(row.busObservationReplay) })
	};
}

export async function loadPredictionSource(): Promise<PredictionSource> {
	const content = await readFile(join(process.cwd(), 'data/public/prediction-source.json'), 'utf8');
	return validatePredictionSource(JSON.parse(content));
}
