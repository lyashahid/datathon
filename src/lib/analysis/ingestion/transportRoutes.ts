import { ROUTE_MODES } from '#lib/config/ingestion.ts';
import type { InfrastructureId, Position, TransportRoute } from '#lib/types/domain.ts';
import { canonicalPosition } from './geometry.ts';
import { isObject, runPipeline, slug, text, type Conversion } from './pipeline.ts';
import type { AdapterOptions, IngestResult } from './types.ts';

export const ROUTES_ADAPTER = 'transport-routes';

/**
 * GeoJSON LineString routes. `mode` comes from `mode` or OSM's `route` tag; `stop_ids` is an
 * optional comma-separated or array list of canonical infrastructure ids.
 */
function convert(raw: unknown, index: number, opts: AdapterOptions): Conversion<TransportRoute> {
	if (!isObject(raw)) return { ok: false, reason: 'invalid_value', detail: 'not a feature' };
	const props = isObject(raw.properties) ? raw.properties : {};
	const geom = isObject(raw.geometry) ? raw.geometry : null;
	if (!geom)
		return { ok: false, reason: 'missing_field', detail: 'no geometry', field: 'geometry' };
	if (geom.type !== 'LineString' || !Array.isArray(geom.coordinates)) {
		return {
			ok: false,
			reason: 'invalid_geometry',
			detail: `expected LineString, got ${String(geom.type)}`
		};
	}
	const coordinates: Position[] = [];
	for (const c of geom.coordinates) {
		const p = Array.isArray(c) ? canonicalPosition(c, opts.crs) : null;
		if (!p)
			return { ok: false, reason: 'invalid_geometry', detail: `bad vertex ${JSON.stringify(c)}` };
		coordinates.push(p);
	}
	if (coordinates.length < 2) {
		return { ok: false, reason: 'invalid_geometry', detail: 'a route needs at least two vertices' };
	}

	const modeText = (text(props.mode) ?? text(props.route))?.toLowerCase();
	if (!modeText) return { ok: false, reason: 'missing_field', detail: 'no mode', field: 'mode' };
	const mode = ROUTE_MODES[modeText];
	if (!mode)
		return { ok: false, reason: 'invalid_value', detail: `unsupported mode "${modeText}"` };

	const warnings: { field: string; detail: string }[] = [];
	let name = text(props.name);
	if (!name) {
		name = `${mode === 'bus' ? 'Bus' : 'Ferry'} route ${index + 1}`;
		warnings.push({ field: 'name', detail: 'unnamed; generated a name' });
	}
	const rawStops = props.stop_ids;
	const stopIds: InfrastructureId[] = Array.isArray(rawStops)
		? rawStops.map(text).filter((s): s is string => !!s)
		: (text(rawStops)
				?.split(',')
				.map((s) => s.trim())
				.filter(Boolean) ?? []);
	if (stopIds.length === 0) warnings.push({ field: 'stop_ids', detail: 'no stops listed' });

	return {
		ok: true,
		warnings,
		value: {
			id: `rt-${text(raw.id) ?? text(props.id) ?? `${slug(name)}-${index}`}`,
			name,
			mode,
			status: 'existing',
			geometry: { type: 'LineString', coordinates },
			stopIds,
			source: { provenance: opts.provenance, dataset: opts.dataset, syntheticFields: [] },
			metadata: {}
		}
	};
}

const sameLine = (a: TransportRoute, b: TransportRoute) =>
	a.mode === b.mode &&
	JSON.stringify(a.geometry.coordinates) === JSON.stringify(b.geometry.coordinates);

export function ingestTransportRoutes(
	raw: unknown,
	opts: AdapterOptions
): IngestResult<TransportRoute> {
	const features = isObject(raw) && Array.isArray(raw.features) ? raw.features : [];
	return runPipeline({
		adapter: ROUTES_ADAPTER,
		source: opts.source,
		crs: opts.crs,
		records: features,
		convert: (r, i) => convert(r, i, opts),
		isDuplicate: (a, b) => a.id === b.id || sameLine(a, b),
		describe: (r) => `${r.name} [${r.id}]`
	});
}

/** Drops stop references that the imported infrastructure does not contain; returns how many. */
export function pruneUnknownStops(
	routes: readonly TransportRoute[],
	knownIds: ReadonlySet<InfrastructureId>
): { routes: TransportRoute[]; removed: number } {
	let removed = 0;
	const pruned = routes.map((r) => {
		const stopIds = r.stopIds.filter((id) => knownIds.has(id));
		removed += r.stopIds.length - stopIds.length;
		return stopIds.length === r.stopIds.length ? r : { ...r, stopIds };
	});
	return { routes: pruned, removed };
}
