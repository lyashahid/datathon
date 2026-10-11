import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type {
	ContextDataset,
	ContextSource,
	PortCall,
	TransportContext,
	TransportObservation,
	VesselObservation
} from '#lib/context/types.ts';

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
function optionalText(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value : null;
}
function list(value: unknown, label: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`Invalid ${label}`);
	return value;
}
function finite(value: unknown, label: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid ${label}`);
	return value;
}
function url(value: unknown): string {
	const result = text(value, 'source URL');
	if (!URL.canParse(result) || new URL(result).protocol !== 'https:')
		throw new Error('Invalid source URL');
	return result;
}
function unique<T extends { id: string }>(records: T[]): T[] {
	if (new Set(records.map((row) => row.id)).size !== records.length)
		throw new Error('Duplicate context IDs');
	return records;
}
function sources(value: unknown): ContextSource[] {
	return unique(
		list(value, 'sources').map((entry) => {
			const row = object(entry, 'source');
			const checksum = text(row.checksum ?? row.sha256, 'source checksum');
			if (!/^[a-f0-9]{64}$/i.test(checksum)) throw new Error('Invalid source checksum');
			return {
				id: text(row.id, 'source id'),
				title: text(row.title, 'source title'),
				url: url(row.url),
				publisher: text(row.publisher, 'source publisher'),
				referencePeriod: text(row.referencePeriod, 'reference period'),
				retrievedAt: text(row.retrievedAt ?? row.fetchedAt, 'retrieval date'),
				checksum,
				coverage: text(row.coverage ?? row.geographicCoverage, 'source coverage'),
				units: text(row.units, 'source units'),
				licenseStatus: text(row.licenseStatus, 'license status'),
				transformationVersion: text(row.transformationVersion, 'transformation version')
			};
		})
	);
}
function reasons(value: unknown): string[] {
	return list(value, 'gap reasons').map((entry) => text(entry, 'gap reason'));
}
function header(value: unknown): {
	row: Row;
	version: string;
	generatedAt: string;
	sources: ContextSource[];
} {
	const row = object(value, 'context snapshot');
	if (row.schemaVersion !== 1) throw new Error('Unsupported context schema');
	const generatedAt = text(row.generatedAt, 'generation date');
	if (!Number.isFinite(Date.parse(generatedAt))) throw new Error('Invalid generation date');
	return {
		row,
		version: text(row.version, 'snapshot version'),
		generatedAt,
		sources: sources(row.sources)
	};
}

export function validateFollowmeSnapshot(value: unknown): ContextDataset<VesselObservation> {
	const info = header(value);
	const records = unique(
		list(info.row.vessels, 'vessels').map((entry) => {
			const row = object(entry, 'vessel');
			let coordinates: [number, number] | null = null;
			if (row.coordinates != null) {
				const pair = list(row.coordinates, 'coordinates');
				const lon = finite(pair[0], 'longitude'),
					lat = finite(pair[1], 'latitude');
				if (pair.length !== 2 || lon < 72 || lon > 75 || lat < -2 || lat > 8)
					throw new Error('Coordinates outside Maldives');
				coordinates = [lon, lat];
			}
			const speed = row.speedKnots == null ? null : finite(row.speedKnots, 'speed');
			const heading = row.headingDeg == null ? null : finite(row.headingDeg, 'heading');
			if (speed != null && (speed < 0 || speed > 100)) throw new Error('Invalid vessel speed');
			if (heading != null && (heading < 0 || heading >= 360)) throw new Error('Invalid heading');
			return {
				id: text(row.id, 'vessel id'),
				name: text(row.name, 'vessel name'),
				type: text(row.type, 'vessel type'),
				operator: optionalText(row.operator) ?? undefined,
				coordinates,
				speedKnots: speed,
				headingDeg: heading,
				observedAtRaw: optionalText(row.observedAtRaw),
				observedTimezone: optionalText(row.observedTimezone),
				lastSeenLabel: optionalText(row.lastSeenLabel) ?? undefined,
				locationLabel: optionalText(row.locationLabel) ?? undefined,
				sourceUrl: url(row.sourceUrl),
				retrievedAt: text(row.retrievedAt, 'vessel retrieval date')
			};
		})
	);
	// Explicit allowlist also ensures any future schema expansion cannot expose device/contact fields.
	return {
		enabled: true,
		status: records.length ? 'partial' : 'unavailable',
		version: info.version,
		generatedAt: info.generatedAt,
		stale: false,
		gapReasons: reasons(info.row.gaps),
		sources: info.sources,
		records
	};
}

function observations(value: unknown, catalog: ContextSource[]): TransportObservation[] {
	const known = new Set(catalog.map((source) => source.id));
	return unique(
		list(value, 'observations').map((entry) => {
			const row = object(entry, 'observation');
			const sourceId = text(row.sourceId, 'observation source');
			if (!known.has(sourceId)) throw new Error('Unknown observation source');
			const value = finite(row.value, 'observation value');
			if (value < 0) throw new Error('Negative count');
			return {
				id: text(row.id, 'observation id'),
				metric: text(row.metric, 'metric'),
				value,
				unit: text(row.unit, 'unit'),
				refPeriod: text(row.refPeriod, 'period'),
				geography: text(row.geography, 'geography'),
				sourceId,
				seriesId: optionalText(row.seriesId) ?? undefined,
				definition: optionalText(row.definition) ?? undefined,
				aggregation:
					row.aggregation === 'published-total' || row.aggregation === 'reported-month'
						? row.aggregation
						: undefined
			};
		})
	);
}

export function validateAgencySnapshot(value: unknown): Pick<TransportContext, 'mpl' | 'aviation'> {
	const info = header(value);
	const layers = object(info.row.layers, 'agency layers');
	const vessels = object(layers.vessels, 'MPL context');
	const flights = object(layers.flights, 'airport context');
	const vesselEntries = list(vessels.portCalls, 'port calls');
	const vesselSourceIds = new Set(
		[...vesselEntries, ...list(vessels.observations, 'port observations')].map(
			(entry) => object(entry, 'port entry').sourceId
		)
	);
	const airportEntries = list(flights.observations, 'airport observations');
	const airportSourceIds = new Set(
		airportEntries.map((entry) => object(entry, 'airport entry').sourceId)
	);
	const vesselSources = info.sources.filter((source) => vesselSourceIds.has(source.id));
	const flightSources = info.sources.filter((source) => airportSourceIds.has(source.id));
	const records = unique(
		vesselEntries.map((entry) => {
			const row = object(entry, 'port call');
			const sourceId = text(row.sourceId, 'port-call source');
			if (!vesselSources.some((source) => source.id === sourceId))
				throw new Error('Unknown port-call source');
			return {
				id: text(row.id, 'port-call id'),
				vesselName: text(row.vesselName, 'vessel name'),
				activity: text(row.activity, 'activity'),
				date: optionalText(row.date ?? row.scheduledAt ?? row.arrivedAt ?? row.rawDate),
				berth: optionalText(row.berth),
				sourceId,
				rawDate: optionalText(row.rawDate) ?? undefined,
				timezoneStatus: optionalText(row.timezoneStatus) ?? undefined,
				qualityFlags: row.qualityFlags == null ? undefined : reasons(row.qualityFlags)
			};
		})
	);
	const portObservations = observations(vessels.observations, vesselSources);
	const airportRecords = observations(flights.observations, flightSources);
	return {
		mpl: {
			enabled: true,
			status: records.length || portObservations.length ? 'partial' : 'unavailable',
			version: info.version,
			generatedAt: info.generatedAt,
			stale: false,
			gapReasons: reasons(vessels.gaps),
			sources: vesselSources,
			records,
			observations: portObservations
		},
		aviation: {
			enabled: true,
			status: airportRecords.length ? 'partial' : 'unavailable',
			version: info.version,
			generatedAt: info.generatedAt,
			stale: false,
			gapReasons: reasons(flights.gaps),
			sources: flightSources,
			records: airportRecords
		}
	};
}

function emptyDataset<T>(enabled: boolean, reason: string): ContextDataset<T> {
	return {
		enabled,
		status: enabled ? 'unavailable' : 'disabled',
		version: null,
		generatedAt: null,
		stale: false,
		gapReasons: [reason],
		sources: [],
		records: []
	};
}

export function createTransportContextLoader(
	read: (path: string) => Promise<string> = (path) => readFile(path, 'utf8'),
	root = process.cwd()
) {
	let lastFollowme: ContextDataset<VesselObservation> | null = null;
	let lastAgency: Pick<TransportContext, 'mpl' | 'aviation'> | null = null;
	return async (flags: {
		vessels: boolean;
		flights: boolean;
		publicOnly?: boolean;
	}): Promise<TransportContext> => {
		if (flags.vessels && !flags.publicOnly) {
			try {
				lastFollowme = validateFollowmeSnapshot(
					JSON.parse(await read(join(root, 'data/public/archive/context/followme/context.json')))
				);
			} catch {
				if (lastFollowme) lastFollowme = { ...lastFollowme, stale: true };
			}
		}
		if (flags.vessels || flags.flights) {
			try {
				lastAgency = validateAgencySnapshot(
					JSON.parse(await read(join(root, 'data/public/context/agency-context.json')))
				);
			} catch {
				if (lastAgency)
					lastAgency = {
						mpl: { ...lastAgency.mpl, stale: true },
						aviation: { ...lastAgency.aviation, stale: true }
					};
			}
		}
		const followme = flags.publicOnly
			? emptyDataset<VesselObservation>(
					false,
					'Public-only competition profile excludes restricted local FollowMe snapshots. Set PUBLIC_DATA_ONLY=false only where reuse is authorized.'
				)
			: flags.vessels
				? (lastFollowme ??
					emptyDataset<VesselObservation>(
						true,
						'No validated local FollowMe snapshot. Run npm run data:followme. An issued API key is optional for authorized API refresh.'
					))
				: emptyDataset<VesselObservation>(
						false,
						'Vessel data is disabled in server configuration.'
					);
		const mpl = flags.vessels
			? (lastAgency?.mpl ?? {
					...emptyDataset<PortCall>(true, 'No validated MPL snapshot. Run npm run data:context.'),
					observations: []
				})
			: {
					...emptyDataset<PortCall>(false, 'Vessel data is disabled in server configuration.'),
					observations: []
				};
		const aviation = flags.flights
			? (lastAgency?.aviation ??
				emptyDataset<TransportObservation>(
					true,
					'No validated airport snapshot. Run npm run data:context.'
				))
			: emptyDataset<TransportObservation>(
					false,
					'Flight passenger data is disabled in server configuration.'
				);
		const version = createHash('sha256')
			.update(JSON.stringify({ followme, mpl, aviation }))
			.digest('hex')
			.slice(0, 16);
		return {
			schemaVersion: 1,
			version: `transport-context-${version}`,
			generatedAt:
				[followme.generatedAt, mpl.generatedAt, aviation.generatedAt]
					.filter((date): date is string => !!date)
					.sort()
					.at(-1) ?? new Date().toISOString(),
			followme,
			mpl,
			aviation
		};
	};
}

export const loadTransportContext = createTransportContextLoader();
