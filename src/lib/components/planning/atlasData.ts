import { cellToBoundary, isValidCell, latLngToCell } from 'h3-js';
import type { FeatureCollection, LineString, Point, Polygon } from 'geojson';
import { getFacilityEligibility } from '#lib/planning/facilities.ts';
import type {
	PlanningBaseline,
	PlanningAnalysis,
	PlanningOrigin,
	PlanningJourney,
	PlanningAssumptions,
	PlanningStop
} from '#lib/planning/types.ts';

const collection = <T extends Point | Polygon | LineString>(
	features: FeatureCollection<T>['features']
): FeatureCollection<T> => ({ type: 'FeatureCollection', features });
export const coordinate = (p: { lon: number; lat: number }): [number, number] => [p.lon, p.lat];
export const number = (value: number | null | undefined, digits = 0) =>
	value == null || !Number.isFinite(value)
		? 'Unavailable'
		: value.toLocaleString('en-US', { maximumFractionDigits: digits });
export const money = (value: number | null | undefined) =>
	value == null
		? 'Unavailable'
		: value === 0
			? 'MVR 0'
			: `MVR ${value >= 1e6 ? `${number(value / 1e6, 2)}m` : value >= 1e3 ? `${number(value / 1e3, 0)}k` : number(value)}`;
export const timeLabel = (minutes: number) =>
	`${Math.floor(minutes / 60)
		.toString()
		.padStart(2, '0')}:${Math.round(minutes % 60)
		.toString()
		.padStart(2, '0')}`;
export const islandName = (baseline: PlanningBaseline, id: string) =>
	baseline.islands.find((i) => i.id === id)?.name ?? id;

export function streetData(baseline: PlanningBaseline): FeatureCollection<LineString> {
	const nodes = new Map(baseline.network.nodes.map((node) => [node.id, node]));
	return collection(
		baseline.network.edges
			.filter((edge) => edge.walkAllowed || edge.driveAllowed)
			.flatMap((edge) => {
				const from = nodes.get(edge.from),
					to = nodes.get(edge.to);
				return from && to
					? [
							{
								type: 'Feature' as const,
								properties: { id: edge.id },
								geometry: {
									type: 'LineString' as const,
									coordinates: ('geometry' in edge
										? edge.geometry
										: [coordinate(from), coordinate(to)]) as [number, number][]
								}
							}
						]
					: [];
			})
	);
}

export function areaData(
	baseline: PlanningBaseline,
	analysis: PlanningAnalysis | null,
	year: 2026 | 2030,
	target = 30
): FeatureCollection<Polygon> {
	const results = new Map(analysis?.origins.map((origin) => [origin.originId, origin]) ?? []);
	return collection(
		baseline.origins.map((origin) => {
			const h3 =
				typeof origin.h3Id === 'string' && isValidCell(origin.h3Id)
					? origin.h3Id
					: latLngToCell(origin.lat, origin.lon, 10);
			let ring = cellToBoundary(h3, true);
			ring = [...ring, ring[0]];
			const result = results.get(origin.id);
			let status = 'unknown';
			if (result)
				status = result.newlyReachable
					? 'gained'
					: result.lostAccess
						? 'lost'
						: result.after.status === 'unavailable'
							? 'unknown'
							: result.after.minutes !== null && result.after.minutes <= target
								? 'reachable'
								: 'gap';
			const geometry =
				origin.geometry && typeof origin.geometry === 'object'
					? (origin.geometry as Polygon)
					: { type: 'Polygon' as const, coordinates: [ring] };
			return {
				type: 'Feature' as const,
				properties: {
					id: origin.id,
					population:
						year === 2030
							? (origin.population2030 ?? origin.population2026)
							: origin.population2026,
					status
				},
				geometry
			};
		})
	);
}

export function routeData(analysis: PlanningAnalysis | null): FeatureCollection<LineString> {
	if (!analysis) return collection([]);
	const stops = new Map(analysis.world.stops.map((stop) => [stop.id, stop]));
	return collection<LineString>(
		analysis.world.patterns
			.map((pattern) => ({
				type: 'Feature' as const,
				properties: {
					id: pattern.id,
					mode: pattern.mode,
					proposed: pattern.provenance === 'assumed',
					enabled: pattern.enabled !== false
				},
				geometry: {
					type: 'LineString' as const,
					coordinates:
						pattern.geometry ??
						pattern.stopIds.flatMap((id) => (stops.has(id) ? [coordinate(stops.get(id)!)] : []))
				}
			}))
			.filter((feature) => feature.geometry.coordinates.length >= 2)
	);
}

/** One visibility policy for the map, connection picker and stop manager. Editing never widens it. */
export function visibleStops(
	baseline: PlanningBaseline,
	analysis: Pick<PlanningAnalysis, 'world'> | null,
	includeUntimedStops = false
): PlanningStop[] {
	const patterns = analysis?.world.patterns ?? baseline.transit.patterns;
	const linked = new Set(patterns.flatMap((pattern) => pattern.stopIds));
	const originals = new Map(baseline.transit.stops.map((stop) => [stop.id, stop]));
	return (analysis?.world.stops ?? baseline.transit.stops).filter((stop) => {
		const original = originals.get(stop.id);
		return (
			includeUntimedStops ||
			linked.has(stop.id) ||
			!original ||
			!!stop.disabled ||
			original.lon !== stop.lon ||
			original.lat !== stop.lat
		);
	});
}

export function symbolData(
	baseline: PlanningBaseline,
	analysis: Pick<PlanningAnalysis, 'world'> | null,
	goal: 'healthcare' | 'education',
	includeUntimedStops = false,
	options: {
		/** Uncommitted new stops. Baseline assets never become unbuilt placement drafts. */
		draftStopIds?: readonly string[];
		draftFacilityIds?: readonly string[];
		assumptions?: Pick<
			PlanningAssumptions,
			'goal' | 'date' | 'departureMinutes' | 'destinationRequirements'
		>;
	} = {}
): FeatureCollection<Point> {
	const patterns = analysis?.world.patterns ?? baseline.transit.patterns;
	const timedIds = new Set(patterns.flatMap((pattern) => pattern.stopIds));
	const activeIds = new Set(
		patterns.filter((pattern) => pattern.enabled !== false).flatMap((pattern) => pattern.stopIds)
	);
	const baselineStops = new Map(baseline.transit.stops.map((stop) => [stop.id, stop]));
	const draftStopIds = new Set(options.draftStopIds ?? []);
	const draftFacilityIds = new Set(options.draftFacilityIds ?? []);
	const baselineFacilityIds = new Set(baseline.facilities.map((facility) => facility.id));
	const groups = new Map<string, FeatureCollection<Point>['features'][number]>();
	for (const stop of visibleStops(baseline, analysis, includeUntimedStops)) {
		const original = baselineStops.get(stop.id);
		const moved = !!original && (original.lon !== stop.lon || original.lat !== stop.lat);
		const paused = !!stop.disabled || (timedIds.has(stop.id) && !activeIds.has(stop.id));
		// Built status and modeled service availability are different facts. Moving a
		// published stop can invalidate its timetable without making the asset new.
		const investmentState = !original
			? draftStopIds.has(stop.id)
				? 'draft'
				: 'proposed'
			: moved
				? 'moved'
				: paused
					? 'paused'
					: 'existing';
		const serviceState = paused
			? 'paused'
			: stop.pickupAllowed === false
				? 'dropoff-only'
				: timedIds.has(stop.id)
					? 'active'
					: 'untimed';
		const state = !original
			? 'proposed'
			: paused
				? 'disabled'
				: moved
					? 'moved'
					: timedIds.has(stop.id)
						? 'timed'
						: 'untimed';
		// Keep directional boarding IDs in the model; draw exact co-locations only once.
		const key = `${stop.lon.toFixed(7)}:${stop.lat.toFixed(7)}:${stop.mode ?? 'bus'}:${state}:${investmentState}:${serviceState}`;
		const existing = groups.get(key);
		if (existing) {
			existing.properties!.count += 1;
			existing.properties!.name += ` / ${stop.name}`;
			existing.properties!.stopIds.push(stop.id);
			existing.properties!.stopNames.push(stop.name);
			continue;
		}
		groups.set(key, {
			type: 'Feature',
			properties: {
				id: stop.id,
				stopIds: [stop.id],
				stopNames: [stop.name],
				name: stop.name,
				count: 1,
				mapKind: 'stop',
				state,
				investmentState,
				iconState: investmentState,
				isBaselineAsset: !!original,
				serviceState,
				statusLabel:
					investmentState === 'draft'
						? 'Placement preview · not built'
						: investmentState === 'proposed'
							? 'Proposed · not built'
							: investmentState === 'moved'
								? 'Existing · proposed move'
								: investmentState === 'paused'
									? 'Existing · paused in scenario'
									: state === 'untimed'
										? 'Operator listing · service unverified'
										: `Operator-listed ${stop.mode === 'ferry' ? 'ferry terminal' : 'bus stop'}`,
				icon: stop.mode === 'ferry' ? 'ferry' : 'shelter',
				disabled: paused,
				description: !original
					? `${investmentState === 'draft' ? 'Placement preview' : 'Proposed stop'}; not built. ${serviceState === 'active' ? 'Connected to modeled service in this scenario.' : 'No active boarding service is connected; it does not add transit access.'}`
					: moved
						? `Existing stop at a proposed new location. The move is a scenario assumption; review service timing.${paused ? ' Boarding or connected service is paused in this scenario.' : ''}`
						: paused
							? 'Existing stop. Boarding or connected services are paused in this scenario; this does not establish real-world closure.'
							: stop.pickupAllowed === false
								? 'Operator-listed drop-off-only stop. Alighting is allowed; boarding is excluded from access calculations.'
								: state === 'untimed'
									? 'Operator-listed location with no loaded timetable. Missing timing does not establish closure. Current boarding operation and physical condition are unverified; it does not add transit access until a proposed service is connected.'
									: 'Operator-listed stop linked to the dated, partial timetable snapshot. This is service evidence, not an inspection of the boarding location.'
			},
			geometry: { type: 'Point', coordinates: coordinate(stop) }
		});
	}
	return collection([
		...(analysis?.world.facilities ?? baseline.facilities)
			.map((facility) => ({
				facility,
				eligibility: getFacilityEligibility(
					facility,
					options.assumptions ?? { goal, date: '9999-12-31', departureMinutes: 0 },
					true
				)
			}))
			.filter(({ eligibility }) => eligibility.status !== 'ineligible')
			.map(({ facility, eligibility }) => {
				const existing = baselineFacilityIds.has(facility.id);
				const state = existing
					? 'existing'
					: draftFacilityIds.has(facility.id)
						? 'draft'
						: 'proposed';
				return {
					type: 'Feature' as const,
					properties: {
						id: facility.id,
						name: facility.name,
						mapKind: 'facility',
						state,
						investmentState: state,
						iconState: state,
						isBaselineAsset: existing,
						eligibilityStatus: eligibility.status,
						unavailableReason: eligibility.reason,
						disabled: eligibility.status === 'unavailable',
						statusLabel:
							(existing
								? `Existing ${goal === 'education' ? 'school' : facility.kind}`
								: state === 'draft'
									? 'Placement preview · not built'
									: 'Proposed · not built') +
							(eligibility.status === 'unavailable' ? ' · suitability unverified' : ''),
						icon: goal === 'healthcare' ? facility.kind : 'school',
						description:
							(existing
								? `${facility.kind === 'clinic' ? 'Clinic; services differ from a hospital' : facility.kind === 'hospital' ? 'Hospital' : 'Education destination'}. ${facility.statusNote ?? ''}`
								: `Proposed ${facility.kind}; not built. Access assumes opening from ${facility.proposedOpeningDate}. Capacity, service hours, facility costs and emissions are unestimated.`) +
							(eligibility.reason ? ` ${eligibility.reason}` : '')
					},
					geometry: { type: 'Point' as const, coordinates: coordinate(facility) }
				};
			}),
		...groups.values()
	]);
}

export function stopCoverage(baseline: PlanningBaseline) {
	const timed = new Set(baseline.transit.patterns.flatMap((pattern) => pattern.stopIds));
	return {
		listed: baseline.transit.stops.length,
		sites: new Set(baseline.transit.stops.map((s) => `${s.lon.toFixed(7)}:${s.lat.toFixed(7)}`))
			.size,
		timed: baseline.transit.stops.filter((stop) => timed.has(stop.id)).length,
		untimed: baseline.transit.stops.filter((stop) => !timed.has(stop.id)).length
	};
}

export function journeyData(
	baseline: PlanningBaseline,
	analysis: PlanningAnalysis | null,
	origin: PlanningOrigin | undefined,
	journey: PlanningJourney | undefined
): FeatureCollection<LineString> {
	if (!analysis || !origin || !journey) return collection([]);
	const points = new Map<string, [number, number]>(
		[
			...baseline.network.nodes,
			...analysis.world.stops,
			...analysis.world.facilities,
			...baseline.origins
		].map((point) => [point.id, coordinate(point)])
	);
	return collection(
		journey.path.flatMap((leg) => {
			const geometry =
				leg.geometry ??
				(points.has(leg.from) && points.has(leg.to)
					? [points.get(leg.from)!, points.get(leg.to)!]
					: []);
			return geometry.length >= 2
				? [
						{
							type: 'Feature' as const,
							properties: { mode: leg.mode },
							geometry: { type: 'LineString' as const, coordinates: geometry }
						}
					]
				: [];
		})
	);
}

/** Group modeled origins into explicit geographic planning areas, rather than inventing wards. */
export function priorityAreas(
	baseline: PlanningBaseline,
	analysis: PlanningAnalysis | null,
	target: number
) {
	if (!analysis) return [];
	const groups = new Map<
		string,
		{
			id: string;
			name: string;
			residents: number;
			gap: number;
			unknown: number;
			originId: string;
			worst: number;
			coordinate: [number, number];
		}
	>();
	const origins = new Map(baseline.origins.map((origin) => [origin.id, origin]));
	for (const result of analysis.origins) {
		const origin = origins.get(result.originId);
		if (!origin) continue;
		const key = `${origin.islandId}-${Math.floor(origin.lon / 0.006)}-${Math.floor(origin.lat / 0.006)}`;
		const side =
			origin.lat > 4.235
				? 'North'
				: origin.lat > 4.21
					? 'Central'
					: origin.lon < 73.5
						? 'West'
						: origin.lat < 4.18
							? 'South'
							: 'Central';
		let group = groups.get(key);
		if (!group) {
			group = {
				id: key,
				name: `${islandName(baseline, origin.islandId)} · ${side}`,
				residents: 0,
				gap: 0,
				unknown: 0,
				originId: origin.id,
				worst: -1,
				coordinate: coordinate(origin)
			};
			groups.set(key, group);
		}
		group.residents += result.population;
		if (result.before.status === 'unavailable') group.unknown += result.population;
		else if (result.before.minutes === null || result.before.minutes > target)
			group.gap += result.population;
		const severity =
			result.before.status === 'unavailable'
				? 0
				: result.before.minutes === null
					? 1e5
					: result.before.minutes;
		if (severity > group.worst) {
			group.worst = severity;
			group.originId = origin.id;
			group.coordinate = coordinate(origin);
		}
	}
	const allGroups = [...groups.values()];
	const names = new Map<string, typeof allGroups>();
	for (const group of allGroups) {
		const peers = names.get(group.name) ?? [];
		peers.push(group);
		names.set(group.name, peers);
	}
	for (const peers of names.values()) {
		if (peers.length < 2) continue;
		peers.sort((a, b) => b.coordinate[1] - a.coordinate[1] || a.coordinate[0] - b.coordinate[0]);
		peers.forEach((group, index) => {
			group.name += ` ${String(index + 1).padStart(2, '0')}`;
		});
	}
	return allGroups
		.filter((group) => group.gap > 0)
		.sort((a, b) => b.gap - a.gap || b.worst - a.worst || b.residents - a.residents)
		.slice(0, 3);
}
