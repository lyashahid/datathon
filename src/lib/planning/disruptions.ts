import type { FeatureCollection, LineString } from 'geojson';
import { buildNetworkGraph, MinHeap, nearestGraphNode, type NetworkGraph } from './graph.ts';
import type { PlanningWorld } from './scenario.ts';
import { calendarRuns } from './routing.ts';
import type {
	NumericRange,
	PlanningAssumptions,
	PlanningBaseline,
	PlanningDisruption,
	PlanningDisruptionImpact,
	PlanningFleetFeedback,
	PlanningServicePattern,
	PlanningStop,
	PlanningStressCase
} from './types.ts';

const epochMinute = (date: string, minute: number) =>
	Date.parse(`${date}T00:00:00Z`) / 60000 + minute;

/** Dates and times form one absolute MVT interval; the end is exclusive. */
export function disruptionIsActive(event: PlanningDisruption, date: string, minute: number) {
	const at = epochMinute(date, minute);
	return (
		event.enabled !== false &&
		at >= epochMinute(event.startDate, event.startMinutes) &&
		at < epochMinute(event.endDate, event.endMinutes)
	);
}

const networkCache = new WeakMap<
	PlanningBaseline['network'],
	Map<string, PlanningBaseline['network']>
>();

/** Restrictions remove permitted arcs; a scenario never creates an illegal shortcut. */
export function effectivePlanningNetwork(
	network: PlanningBaseline['network'],
	assumptions: Pick<PlanningAssumptions, 'date' | 'departureMinutes' | 'disruptions'>,
	minute = assumptions.departureMinutes
): PlanningBaseline['network'] {
	const events = (assumptions.disruptions ?? []).filter((event) =>
		disruptionIsActive(event, assumptions.date, minute)
	);
	if (!events.length) return network;
	const key = JSON.stringify(events);
	let cache = networkCache.get(network);
	if (!cache) {
		cache = new Map();
		networkCache.set(network, cache);
	}
	const cached = cache.get(key);
	if (cached) return cached;
	const byEdge = new Map<string, PlanningDisruption[]>();
	for (const event of events)
		for (const edgeId of event.edgeIds) byEdge.set(edgeId, [...(byEdge.get(edgeId) ?? []), event]);
	const edges = network.edges.map((edge) => {
		const changes = byEdge.get(edge.id);
		if (!changes) return edge;
		const result = { ...edge };
		for (const event of changes) {
			for (const direction of ['forward', 'reverse'] as const) {
				if (event.direction !== 'both' && event.direction !== direction) continue;
				if (event.kind === 'closure') {
					if (event.modes.includes('walk')) {
						if (direction === 'forward') result.walkForwardAllowed = false;
						else result.walkReverseAllowed = false;
					}
					if (event.modes.includes('bus')) {
						if (direction === 'forward') result.driveForwardAllowed = false;
						else result.driveReverseAllowed = false;
					}
				} else if (event.modes.includes('bus')) {
					if (direction === 'forward')
						result.driveForwardDelayMinutes =
							(result.driveForwardDelayMinutes ?? 0) + (event.delayMinutes ?? 0);
					else
						result.driveReverseDelayMinutes =
							(result.driveReverseDelayMinutes ?? 0) + (event.delayMinutes ?? 0);
				}
			}
		}
		return result;
	});
	const result = { nodes: network.nodes, edges };
	if (cache.size >= 48) cache.delete(cache.keys().next().value!);
	cache.set(key, result);
	return result;
}

export function planningRoadFeatures(
	baseline: PlanningBaseline,
	assumptions: PlanningAssumptions
): FeatureCollection<LineString> {
	const nodes = new Map(baseline.network.nodes.map((node) => [node.id, node]));
	const events = (assumptions.disruptions ?? []).filter((event) =>
		disruptionIsActive(event, assumptions.date, assumptions.departureMinutes)
	);
	return {
		type: 'FeatureCollection',
		features: baseline.network.edges.flatMap((edge) => {
			const from = nodes.get(edge.from);
			const to = nodes.get(edge.to);
			if (!from || !to) return [];
			const affecting = events.filter((event) => event.edgeIds.includes(edge.id));
			return [
				{
					type: 'Feature' as const,
					id: edge.id,
					properties: {
						edgeId: edge.id,
						driveAllowed: edge.driveAllowed,
						walkAllowed: edge.walkAllowed,
						oneway: edge.oneway === true,
						disruptionKind: affecting.some((event) => event.kind === 'closure')
							? 'closure'
							: affecting.length
								? 'delay'
								: 'none',
						extraMinutes: affecting.reduce((sum, event) => sum + (event.delayMinutes ?? 0), 0),
						provenance: affecting.some((event) => event.provenance === 'assumed')
							? 'assumed'
							: 'observed',
						eventIds: affecting.map((event) => event.id).join(','),
						direction: affecting.map((event) => event.direction).join(','),
						name: affecting.map((event) => event.name).join('; ')
					},
					geometry: {
						type: 'LineString' as const,
						coordinates: edge.geometry ?? [
							[from.lon, from.lat],
							[to.lon, to.lat]
						]
					}
				}
			];
		})
	};
}

interface RoadPath {
	distanceM: number;
	minutes: number;
	edgeIds: string[];
	geometry: [number, number][];
}

/** Time-weighted legal driving path, including only incremental event delay. */
export function shortestDrivingPath(
	graph: NetworkGraph,
	from: number,
	to: number,
	kph: number
): RoadPath | null {
	const times = new Float64Array(graph.nodes.length).fill(Infinity);
	const previous = new Int32Array(graph.nodes.length).fill(-1);
	const previousArc = new Int32Array(graph.nodes.length).fill(-1);
	const queue = new MinHeap<number>();
	times[from] = 0;
	queue.push(from, 0);
	while (queue.size) {
		const current = queue.pop()!;
		if (current.priority !== times[current.value]) continue;
		if (current.value === to) break;
		for (const [index, arc] of graph.drive[current.value].entries()) {
			const next = current.priority + arc.distanceM / ((kph * 1000) / 60) + (arc.delayMinutes ?? 0);
			if (next < times[arc.to]) {
				times[arc.to] = next;
				previous[arc.to] = current.value;
				previousArc[arc.to] = index;
				queue.push(arc.to, next);
			}
		}
	}
	if (!Number.isFinite(times[to])) return null;
	const indexes: number[] = [];
	for (let index = to; index !== from; index = previous[index]) indexes.push(index);
	indexes.reverse();
	let distanceM = 0;
	const edgeIds: string[] = [];
	const geometry: [number, number][] = [[graph.nodes[from].lon, graph.nodes[from].lat]];
	for (const index of indexes) {
		const parent = previous[index];
		const arc = graph.drive[parent][previousArc[index]];
		distanceM += arc.distanceM;
		if (arc.edgeId) edgeIds.push(arc.edgeId);
		geometry.push(
			...(
				arc.geometry ?? [
					[graph.nodes[parent].lon, graph.nodes[parent].lat],
					[graph.nodes[index].lon, graph.nodes[index].lat]
				]
			).slice(1)
		);
	}
	return { distanceM, minutes: times[to], edgeIds, geometry };
}

const referencePathCache = new WeakMap<PlanningBaseline['network'], Map<string, RoadPath | null>>();
const snapCache = new WeakMap<
	PlanningBaseline['network'],
	Map<string, ReturnType<typeof nearestGraphNode>>
>();
function referenceSnap(baseline: PlanningBaseline, stop: PlanningStop, maxSnapM: number) {
	let cache = snapCache.get(baseline.network);
	if (!cache) {
		cache = new Map();
		snapCache.set(baseline.network, cache);
	}
	const key = `${stop.lon}:${stop.lat}:${maxSnapM}`;
	if (!cache.has(key))
		cache.set(key, nearestGraphNode(buildNetworkGraph(baseline.network), stop, 'drive', maxSnapM));
	return cache.get(key)!;
}
function referencePath(baseline: PlanningBaseline, from: number, to: number, kph: number) {
	let cache = referencePathCache.get(baseline.network);
	if (!cache) {
		cache = new Map();
		referencePathCache.set(baseline.network, cache);
	}
	const key = `${from}:${to}:${kph}`;
	if (!cache.has(key))
		cache.set(key, shortestDrivingPath(buildNetworkGraph(baseline.network), from, to, kph));
	return cache.get(key)!;
}

function validRange(value: NumericRange | null | undefined): value is NumericRange {
	return (
		!!value &&
		[value.low, value.central, value.high].every((n) => Number.isFinite(n) && n >= 0) &&
		value.low <= value.central &&
		value.central <= value.high
	);
}
const procurementFleet = (active: number | null, reserveShare: number): number | null =>
	active === null ? null : Math.ceil(active * (1 + reserveShare));
const scale = (range: NumericRange, multiplier: number): NumericRange =>
	multiplier >= 0
		? {
				low: range.low * multiplier,
				central: range.central * multiplier,
				high: range.high * multiplier
			}
		: {
				low: range.high * multiplier,
				central: range.central * multiplier,
				high: range.low * multiplier
			};

function frequencyActivity(group: PlanningServicePattern[], assumptions: PlanningAssumptions) {
	if (
		!group.length ||
		group.some((pattern) => pattern.enabled === false || pattern.timing.kind !== 'frequency')
	)
		return null;
	const balance = new Map<string, number>();
	const next = new Map<string, string>();
	let km = 0,
		hours = 0,
		cycle = assumptions.layoverMinutes,
		headway = Infinity;
	for (const pattern of group) {
		if (pattern.timing.kind !== 'frequency' || !(Number(pattern.distanceM) > 0)) return null;
		const trips = pattern.timing.windows.reduce(
			(sum, window) => sum + (window.endMinutes - window.startMinutes) / window.headwayMinutes,
			0
		);
		const duration = pattern.timing.segmentMinutes.reduce((sum, n) => sum + n, 0);
		const from = pattern.stopIds[0],
			to = pattern.stopIds.at(-1)!;
		// A branched or disconnected route ID does not establish a single vehicle duty.
		if (next.has(from)) return null;
		next.set(from, to);
		balance.set(from, (balance.get(from) ?? 0) + trips);
		balance.set(to, (balance.get(to) ?? 0) - trips);
		km += (Number(pattern.distanceM) / 1000) * trips;
		hours += (duration / 60) * trips;
		cycle += duration;
		headway = Math.min(headway, ...pattern.timing.windows.map((window) => window.headwayMinutes));
	}
	if ([...balance.values()].some((value) => Math.abs(value) > 1e-8)) return null;
	const visited = new Set<string>();
	let at = group[0].stopIds[0];
	while (next.has(at) && !visited.has(at)) {
		visited.add(at);
		at = next.get(at)!;
	}
	if (at !== group[0].stopIds[0] || visited.size !== group.length) return null;
	return { km, hours, cycle, headway, vehicles: Math.ceil(cycle / headway) };
}

function eventOperatingDays(events: PlanningDisruption[], group: PlanningServicePattern[]) {
	const windows = group.flatMap((pattern) =>
		pattern.timing.kind === 'frequency'
			? pattern.timing.windows.map((window) => ({ ...window, calendar: pattern.calendar }))
			: []
	);
	if (!events.length || !windows.length) return 0;
	const serviceMinutes = windows.reduce(
		(sum, window) => sum + window.endMinutes - window.startMinutes,
		0
	);
	const earliest = Math.min(
		...events.map((event) => epochMinute(event.startDate, event.startMinutes))
	);
	const latest = Math.max(...events.map((event) => epochMinute(event.endDate, event.endMinutes)));
	let affectedMinutes = 0;
	// Saved events are validated to at most 366 days; avoid unbounded imported intervals.
	for (
		let day = Math.floor(earliest / 1440) * 1440;
		day <= latest && day < earliest + 367 * 1440;
		day += 1440
	) {
		for (const window of windows) {
			if (!calendarRuns(window.calendar, new Date(day * 60000).toISOString().slice(0, 10)))
				continue;
			const ranges = events
				.map((event) => [
					Math.max(day + window.startMinutes, epochMinute(event.startDate, event.startMinutes)),
					Math.min(day + window.endMinutes, epochMinute(event.endDate, event.endMinutes))
				])
				.filter(([start, end]) => end > start)
				.sort((a, b) => a[0] - b[0]);
			let endAt = -Infinity;
			for (const [start, end] of ranges) {
				affectedMinutes += Math.max(0, end - Math.max(start, endAt));
				endAt = Math.max(endAt, end);
			}
		}
	}
	return affectedMinutes / serviceMinutes;
}

export interface DisruptedPlanningWorld {
	world: PlanningWorld;
	network: PlanningBaseline['network'];
	impact: PlanningDisruptionImpact;
}

/** Published runtimes are retained. Only incremental road effects are added downstream. */
export function applyPlanningDisruptions(
	baseline: PlanningBaseline,
	original: PlanningWorld,
	assumptions: PlanningAssumptions
): DisruptedPlanningWorld {
	const enabledEvents = (assumptions.disruptions ?? []).filter((event) => event.enabled !== false);
	const active = enabledEvents.filter((event) =>
		disruptionIsActive(event, assumptions.date, assumptions.departureMinutes)
	);
	const impact: PlanningDisruptionImpact = {
		activeEventIds: active.map((event) => event.id),
		affectedPatternIds: [],
		blockedPatternIds: [],
		fleetFeedback: [],
		lostAccessResidents: 0,
		worsenedJourneyResidents: 0,
		method:
			'Directed OSM restrictions; incremental delay and legal detour duration added to reference service timings. Scheduled trip entry times are evaluated individually. Frequency services are a selected-departure snapshot. Temporary operations are priced for event/service-window overlap, not automatically annualized.'
	};
	const network = effectivePlanningNetwork(baseline.network, assumptions);
	if (!enabledEvents.length) return { world: original, network, impact };
	const stops = new Map(original.stops.map((stop) => [stop.id, stop]));
	const warnings = [...original.warnings];
	const unresolvedSegments = new Set<string>();
	const routeEvents = new Map<string, Set<string>>();
	const pathCache = new Map<string, RoadPath | null>();
	function segment(from: PlanningStop, to: PlanningStop, at: number) {
		// Keep snaps pinned to the original graph: a closed stop connection is not relocated.
		const fromSnap = referenceSnap(baseline, from, assumptions.maxSnapM);
		const toSnap = referenceSnap(baseline, to, assumptions.maxSnapM);
		if (!fromSnap || !toSnap) return null;
		const before = referencePath(baseline, fromSnap.index, toSnap.index, assumptions.busMovingKph);
		if (!before) return null;
		const effective = effectivePlanningNetwork(baseline.network, assumptions, at);
		const key = `${fromSnap.index}:${toSnap.index}:${enabledEvents
			.filter((event) => disruptionIsActive(event, assumptions.date, at))
			.map((event) => event.id)
			.join(',')}`;
		if (!pathCache.has(key))
			pathCache.set(
				key,
				shortestDrivingPath(
					buildNetworkGraph(effective),
					fromSnap.index,
					toSnap.index,
					assumptions.busMovingKph
				)
			);
		const after = pathCache.get(key)!;
		const affecting = enabledEvents.filter(
			(event) =>
				event.modes.includes('bus') &&
				disruptionIsActive(event, assumptions.date, at) &&
				event.edgeIds.some(
					(edgeId) => before.edgeIds.includes(edgeId) || after?.edgeIds.includes(edgeId)
				)
		);
		return { before, after, affecting };
	}
	let patterns = original.patterns.map((pattern) => {
		if (pattern.mode !== 'bus' || pattern.enabled === false || pattern.runtimeUnavailableReason)
			return pattern;
		const working = structuredClone(pattern);
		let changed = false,
			blocked = false;
		const geometries = pattern.segmentGeometry ? structuredClone(pattern.segmentGeometry) : [];
		const distances = pattern.segmentDistanceM ? [...pattern.segmentDistanceM] : [];
		const originalDistances = pattern.segmentDistanceM ? [...pattern.segmentDistanceM] : [];
		const distanceDeltas = new Map<number, number>();
		const inspect = (index: number, at: number) => {
			const from = stops.get(pattern.stopIds[index]),
				to = stops.get(pattern.stopIds[index + 1]);
			if (!from || !to) return null;
			const result = segment(from, to, at);
			if (!result) {
				if (
					enabledEvents.some(
						(event) =>
							event.modes.includes('bus') && disruptionIsActive(event, assumptions.date, at)
					)
				)
					unresolvedSegments.add(`${pattern.id}:${index}`);
				return null;
			}
			if (!result.affecting.length)
				return { extra: 0, geometry: pattern.segmentGeometry?.[index] ?? result.before.geometry };
			for (const event of result.affecting) {
				const set = routeEvents.get(pattern.routeId) ?? new Set();
				set.add(event.id);
				routeEvents.set(pattern.routeId, set);
			}
			if (!result.after) {
				blocked = true;
				changed = true;
				return { extra: Infinity };
			}
			const extra = Math.max(0, result.after.minutes - result.before.minutes);
			if (extra > 1e-8 || result.after.distanceM !== result.before.distanceM) {
				changed = true;
				geometries[index] = result.after.geometry;
				const originalDistance = originalDistances[index] ?? result.before.distanceM;
				const replacementDistance =
					originalDistance + result.after.distanceM - result.before.distanceM;
				distanceDeltas.set(index, replacementDistance - originalDistance);
				distances[index] = replacementDistance;
			}
			return { extra, geometry: result.after.geometry };
		};
		if (working.timing.kind === 'frequency') {
			let at = assumptions.departureMinutes;
			for (let index = 0; index < working.timing.segmentMinutes.length; index++) {
				const result = inspect(index, at);
				if (result?.extra === Infinity) break;
				if (result?.geometry) geometries[index] = result.geometry;
				working.timing.segmentMinutes[index] += result?.extra ?? 0;
				at += working.timing.segmentMinutes[index];
			}
			if (blocked) working.enabled = false;
		} else {
			working.timing.trips = working.timing.trips.flatMap((trip) => {
				let delay = 0,
					cancelled = false;
				const times = structuredClone(trip.stopTimes);
				const tripGeometry = trip.segmentGeometry
					? structuredClone(trip.segmentGeometry)
					: pattern.segmentGeometry
						? structuredClone(pattern.segmentGeometry)
						: [];
				for (let index = 0; index < times.length - 1; index++) {
					const result = inspect(index, trip.stopTimes[index].departureMinutes + delay);
					if (result?.extra === Infinity) {
						cancelled = true;
						break;
					}
					delay += result?.extra ?? 0;
					if (result?.geometry) tripGeometry[index] = result.geometry;
					times[index + 1].arrivalMinutes += delay;
					times[index + 1].departureMinutes += delay;
				}
				return cancelled
					? []
					: [
							{
								...trip,
								stopTimes: times,
								...(tripGeometry.length === pattern.stopIds.length - 1 &&
								Array.from(tripGeometry).every((geometry) => geometry?.length >= 2)
									? { segmentGeometry: tripGeometry }
									: {})
							}
						];
			});
			if (!working.timing.trips.length) working.enabled = false;
		}
		if (!changed) return pattern;
		impact.affectedPatternIds.push(pattern.id);
		if (blocked) impact.blockedPatternIds.push(pattern.id);
		working.disruptionAdjusted = true;
		working.referenceProvenance = pattern.provenance;
		working.provenance = 'assumed';
		if (
			geometries.length === pattern.stopIds.length - 1 &&
			Array.from(geometries).every((geometry) => geometry?.length >= 2)
		) {
			working.segmentGeometry = geometries;
			working.geometry = geometries.flatMap((geometry, index) => geometry.slice(index ? 1 : 0));
		}
		if (
			distances.length === pattern.stopIds.length - 1 &&
			Array.from(distances).every((distance) => distance > 0)
		)
			working.segmentDistanceM = distances;
		if (working.distanceM !== undefined)
			working.distanceM += [...distanceDeltas.values()].reduce(
				(sum, distance) => sum + distance,
				0
			);
		return working;
	});
	for (const [routeId, eventIds] of routeEvents) {
		const beforeGroup = original.patterns.filter(
			(pattern) => pattern.routeId === routeId && pattern.mode === 'bus'
		);
		let afterGroup = patterns.filter(
			(pattern) => pattern.routeId === routeId && pattern.mode === 'bus'
		);
		const before = frequencyActivity(beforeGroup, assumptions),
			initialAfter = frequencyActivity(afterGroup, assumptions);
		const policy = assumptions.fleetResponse ?? 'maintain-frequency';
		if (policy === 'fixed-fleet' && before && initialAfter) {
			const headway = Math.max(before.headway, initialAfter.cycle / before.vehicles);
			const multiplier = headway / before.headway;
			patterns = patterns.map((pattern) =>
				pattern.routeId === routeId && pattern.timing.kind === 'frequency'
					? {
							...pattern,
							provenance: 'assumed',
							timing: {
								...pattern.timing,
								windows: pattern.timing.windows.map((window) => ({
									...window,
									headwayMinutes: window.headwayMinutes * multiplier
								}))
							}
						}
					: pattern
			);
			afterGroup = patterns.filter(
				(pattern) => pattern.routeId === routeId && pattern.mode === 'bus'
			);
		}
		const after = frequencyActivity(afterGroup, assumptions);
		const relevantEvents = enabledEvents.filter((event) => eventIds.has(event.id));
		const eventDays = eventOperatingDays(relevantEvents, beforeGroup);
		const kind = afterGroup[0]?.fleet ?? 'diesel';
		const operatingRate =
			kind === 'electric'
				? assumptions.costs.electricOperatingMvrPerKm
				: assumptions.costs.dieselOperatingMvrPerKm;
		const capitalRate =
			kind === 'electric'
				? assumptions.costs.electricBusCapitalMvr
				: assumptions.costs.dieselBusCapitalMvr;
		const addedFleet = before && after ? Math.max(0, after.vehicles - before.vehicles) : null;
		const baselineProcurementFleet = procurementFleet(
			before?.vehicles ?? null,
			assumptions.fleetReserveShare
		);
		const requiredProcurementFleet = procurementFleet(
			after?.vehicles ?? null,
			assumptions.fleetReserveShare
		);
		const addedProcurementFleet =
			baselineProcurementFleet !== null && requiredProcurementFleet !== null
				? Math.max(0, requiredProcurementFleet - baselineProcurementFleet)
				: null;
		const eventKm = before && after ? (after.km - before.km) * eventDays : null;
		const eventHours = before && after ? (after.hours - before.hours) * eventDays : null;
		const factorInputs =
			kind === 'electric'
				? [assumptions.electricKwhPerVehicleKm, assumptions.gridKgCo2ePerKwh]
				: [assumptions.dieselLitresPerVehicleKm, assumptions.dieselKgCo2ePerLitre];
		const emissionsFactor =
			validRange(factorInputs[0]) && validRange(factorInputs[1])
				? {
						low: factorInputs[0].low * factorInputs[1].low,
						central: factorInputs[0].central * factorInputs[1].central,
						high: factorInputs[0].high * factorInputs[1].high
					}
				: kind === 'electric'
					? assumptions.costs.electricKgCo2ePerKm
					: assumptions.costs.dieselKgCo2ePerKm;
		const pureTimeBurden =
			eventKm !== null && Math.abs(eventKm) < 1e-8 && eventHours !== null && eventHours > 1e-8;
		const feedback: PlanningFleetFeedback = {
			routeId,
			name: beforeGroup[0]?.name ?? routeId,
			policy,
			baselineCycleMinutes: before?.cycle ?? null,
			scenarioCycleMinutes: after?.cycle ?? null,
			baselineHeadwayMinutes: before?.headway ?? null,
			scenarioHeadwayMinutes: after?.headway ?? null,
			baselineFleet: before?.vehicles ?? null,
			requiredFleet: after?.vehicles ?? null,
			additionalFleet: addedFleet,
			baselineProcurementFleet,
			requiredProcurementFleet,
			additionalProcurementFleet: addedProcurementFleet,
			additionalCapitalMvr:
				addedProcurementFleet !== null && validRange(capitalRate)
					? scale(capitalRate, addedProcurementFleet)
					: null,
			eventOperatingMvr:
				!pureTimeBurden && eventKm !== null && validRange(operatingRate)
					? scale(operatingRate, eventKm)
					: null,
			eventCarbonKgCo2e:
				!pureTimeBurden && eventKm !== null && validRange(emissionsFactor)
					? scale(emissionsFactor, eventKm)
					: null,
			eventVehicleKm: eventKm,
			eventVehicleHours: eventHours,
			unavailableReasons: []
		};
		if (!before || !after)
			feedback.unavailableReasons.push(
				'Complete frequency circulation is required for fleet and event-period operating costs. Captured scheduled trips or a blocked direction cannot establish these inputs.'
			);
		if (!validRange(operatingRate))
			feedback.unavailableReasons.push('Bus operating cost per kilometre is unavailable.');
		if (!validRange(capitalRate))
			feedback.unavailableReasons.push(
				'Additional bus procurement cost is unavailable; spare or leased vehicle availability is not established.'
			);
		if (pureTimeBurden)
			feedback.unavailableReasons.push(
				'Added time with unchanged kilometres needs marginal labour/idle-energy inputs. A bundled cost or emissions rate per kilometre cannot establish a zero disruption burden.'
			);
		if (!validRange(emissionsFactor))
			feedback.unavailableReasons.push(
				'Event-period transit emissions factor is unavailable. No private-trip displacement is inferred from a delay or closure.'
			);
		impact.fleetFeedback.push(feedback);
	}
	if (impact.affectedPatternIds.length)
		warnings.push(
			'Road event changes are scenario timings, not newly observed timetables. Existing reference travel time is retained; only incremental detour/delay is added. Temporary event costs are separate from annual intervention costs.'
		);
	if (unresolvedSegments.size)
		warnings.push(
			`Road-event effects are unavailable for ${unresolvedSegments.size} bus segments without a legal modeled reference road connection. Their loaded service timings are retained; a zero road-event effect has not been established there.`
		);
	for (const event of enabledEvents) {
		const missing = event.edgeIds.filter(
			(id) => !baseline.network.edges.some((edge) => edge.id === id)
		);
		if (missing.length)
			warnings.push(
				`${event.name}: ${missing.length} unmatched road edges excluded; event location needs review.`
			);
	}
	return { world: { ...original, patterns, warnings }, network, impact };
}

/** Explicit stress tests, never measured congestion or an inferred forecast. */
export function createRoadStressCases(
	edgeIds: string[],
	assumptions: Pick<PlanningAssumptions, 'date' | 'departureMinutes'>
): PlanningStressCase[] {
	return [5, 10].map((delayMinutes) => ({
		id: `delay-${delayMinutes}`,
		name: `${delayMinutes}-minute road delay`,
		disruptions: [
			{
				id: `stress-road-delay-${delayMinutes}`,
				name: `Assumed ${delayMinutes}-minute incremental delay`,
				kind: 'delay',
				edgeIds,
				modes: ['bus'],
				direction: 'both',
				startDate: assumptions.date,
				endDate: assumptions.date,
				startMinutes: assumptions.departureMinutes,
				endMinutes: Math.min(2880, assumptions.departureMinutes + 180),
				delayMinutes,
				provenance: 'assumed',
				evidenceNote: 'User-selected sensitivity case; not observed traffic.'
			}
		]
	}));
}

/** Reprice cached journey/activity results without retaining stale edited cost assumptions. */
export function repricePlanningDisruptionImpact(
	impact: PlanningDisruptionImpact,
	world: PlanningWorld,
	assumptions: PlanningAssumptions
): PlanningDisruptionImpact {
	return {
		...impact,
		fleetFeedback: impact.fleetFeedback.map((feedback) => {
			const kind =
				world.patterns.find((pattern) => pattern.routeId === feedback.routeId)?.fleet ?? 'diesel';
			const capitalRate =
				kind === 'electric'
					? assumptions.costs.electricBusCapitalMvr
					: assumptions.costs.dieselBusCapitalMvr;
			const operatingRate =
				kind === 'electric'
					? assumptions.costs.electricOperatingMvrPerKm
					: assumptions.costs.dieselOperatingMvrPerKm;
			const factors =
				kind === 'electric'
					? [assumptions.electricKwhPerVehicleKm, assumptions.gridKgCo2ePerKwh]
					: [assumptions.dieselLitresPerVehicleKm, assumptions.dieselKgCo2ePerLitre];
			const factor =
				validRange(factors[0]) && validRange(factors[1])
					? {
							low: factors[0].low * factors[1].low,
							central: factors[0].central * factors[1].central,
							high: factors[0].high * factors[1].high
						}
					: kind === 'electric'
						? assumptions.costs.electricKgCo2ePerKm
						: assumptions.costs.dieselKgCo2ePerKm;
			const km = feedback.eventVehicleKm,
				hours = feedback.eventVehicleHours;
			const baselineProcurementFleet = procurementFleet(
				feedback.baselineFleet,
				assumptions.fleetReserveShare
			);
			const requiredProcurementFleet = procurementFleet(
				feedback.requiredFleet,
				assumptions.fleetReserveShare
			);
			const additionalProcurementFleet =
				baselineProcurementFleet !== null && requiredProcurementFleet !== null
					? Math.max(0, requiredProcurementFleet - baselineProcurementFleet)
					: null;
			const pureTimeBurden = km !== null && Math.abs(km) < 1e-8 && hours !== null && hours > 1e-8;
			const reasons = feedback.unavailableReasons.filter((reason) =>
				reason.startsWith('Complete frequency')
			);
			if (!validRange(capitalRate))
				reasons.push(
					'Additional bus procurement cost is unavailable; spare or leased vehicle availability is not established.'
				);
			if (!validRange(operatingRate))
				reasons.push('Bus operating cost per kilometre is unavailable.');
			if (!validRange(factor))
				reasons.push(
					'Event-period transit emissions factor is unavailable. No private-trip displacement is inferred from a delay or closure.'
				);
			if (pureTimeBurden)
				reasons.push(
					'Added time with unchanged kilometres needs marginal labour/idle-energy inputs. A bundled cost or emissions rate per kilometre cannot establish a zero disruption burden.'
				);
			return {
				...feedback,
				baselineProcurementFleet,
				requiredProcurementFleet,
				additionalProcurementFleet,
				additionalCapitalMvr:
					additionalProcurementFleet !== null && validRange(capitalRate)
						? scale(capitalRate, additionalProcurementFleet)
						: null,
				eventOperatingMvr:
					!pureTimeBurden && km !== null && validRange(operatingRate)
						? scale(operatingRate, km)
						: null,
				eventCarbonKgCo2e:
					!pureTimeBurden && km !== null && validRange(factor) ? scale(factor, km) : null,
				unavailableReasons: reasons
			};
		})
	};
}
