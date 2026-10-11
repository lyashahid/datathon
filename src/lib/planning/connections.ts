import { createDefaultAssumptions } from './defaults.ts';
import {
	buildNetworkGraph,
	distanceM,
	nearestGraphNode,
	pathCoordinates,
	shortestPaths,
	type NetworkGraph,
	type PathTree
} from './graph.ts';
import { derivePlanningWorld } from './scenario.ts';
import { patternIsValid } from './routing.ts';
import type {
	PlanningAction,
	PlanningAssumptions,
	PlanningBaseline,
	PlanningFleet,
	PlanningServicePattern,
	PlanningStop
} from './types.ts';

export type ConnectionResult = { ok: true; action: PlanningAction } | { ok: false; reason: string };

export interface BusConnectionOptions {
	/** Stop order in the outward direction. The return is routed independently. */
	stopIds: string[];
	/** New stops are added together with their service as one undoable action. */
	stops?: PlanningStop[];
	actions?: readonly PlanningAction[];
	assumptions?: PlanningAssumptions;
	headwayMinutes?: number;
	startMinutes?: number;
	endMinutes?: number;
	fleet?: PlanningFleet;
	name?: string;
}

export interface StopInsertionOptions {
	patternId: string;
	stopId: string;
	/** Insert after this stop; the last stop extends both direction endpoints. */
	afterStopId: string;
	stops?: PlanningStop[];
	actions?: readonly PlanningAction[];
	assumptions?: PlanningAssumptions;
	/** Required when replacing a published scheduled pattern with assumed frequency. */
	headwayMinutes?: number;
	startMinutes?: number;
	endMinutes?: number;
}

export interface BusStopProposalOptions {
	coordinate: [number, number];
	actions?: readonly PlanningAction[];
	assumptions?: PlanningAssumptions;
	name?: string;
}

export interface BusRuntimeOptions {
	headwayMinutes?: number;
	startMinutes?: number;
	endMinutes?: number;
}

const caches = new WeakMap<
	PlanningBaseline['network'],
	{ graph: NetworkGraph; trees: Map<number, PathTree> }
>();

function driveCache(network: PlanningBaseline['network']) {
	let cache = caches.get(network);
	if (!cache) {
		cache = { graph: buildNetworkGraph(network), trees: new Map() };
		caches.set(network, cache);
	}
	return cache;
}

function validRuntime(a: PlanningAssumptions, options: BusRuntimeOptions): string | null {
	if (
		!Number.isFinite(a.busMovingKph) ||
		!(a.busMovingKph > 0) ||
		!Number.isFinite(a.busDwellMinutes) ||
		a.busDwellMinutes < 0 ||
		!Number.isFinite(a.maxSnapM) ||
		!(a.maxSnapM > 0)
	)
		return 'Choose valid bus speed, dwell and road connection assumptions.';
	if (
		options.headwayMinutes !== undefined &&
		(!Number.isFinite(options.headwayMinutes) ||
			options.headwayMinutes < 1 ||
			options.headwayMinutes > 240)
	)
		return 'Choose a frequency between every 1 and 240 minutes.';
	const start = options.startMinutes ?? 420;
	const end = options.endMinutes ?? 1140;
	if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 2880 || end <= start)
		return 'Choose valid operating hours.';
	return null;
}

/** Reroute one direction without reusing reverse geometry or claiming a published runtime. */
export function rerouteBusPattern(
	baseline: PlanningBaseline,
	pattern: PlanningServicePattern,
	stops: ReadonlyMap<string, PlanningStop>,
	assumptions: PlanningAssumptions,
	options: BusRuntimeOptions = {}
): { ok: true; pattern: PlanningServicePattern } | { ok: false; reason: string } {
	const invalid = validRuntime(assumptions, options);
	if (invalid) return { ok: false, reason: invalid };
	if (pattern.mode !== 'bus' || pattern.stopIds.length < 2)
		return { ok: false, reason: 'Choose a bus connection with at least two stops.' };
	if (pattern.timing.kind === 'scheduled' && options.headwayMinutes === undefined)
		return {
			ok: false,
			reason: 'Choose an assumed frequency before changing a published timetable.'
		};
	const cache = driveCache(baseline.network);
	const segmentDistanceM: number[] = [];
	const segmentGeometry: [number, number][][] = [];
	for (let index = 0; index < pattern.stopIds.length - 1; index++) {
		const from = stops.get(pattern.stopIds[index]);
		const to = stops.get(pattern.stopIds[index + 1]);
		if (!from || !to || from.mode === 'ferry' || to.mode === 'ferry')
			return { ok: false, reason: 'Every connection point must be a mapped bus stop.' };
		const start = nearestGraphNode(cache.graph, from, 'drive', assumptions.maxSnapM);
		const end = nearestGraphNode(cache.graph, to, 'drive', assumptions.maxSnapM);
		if (!start || !end)
			return {
				ok: false,
				reason: `A permitted bus road is missing near ${!start ? from.name : to.name}.`
			};
		let tree = cache.trees.get(start.index);
		if (!tree) {
			tree = shortestPaths(cache.graph, start.index, 'drive');
			if (cache.trees.size >= 64) cache.trees.delete(cache.trees.keys().next().value!);
			cache.trees.set(start.index, tree);
		}
		const metres = tree.distances[end.index];
		if (!Number.isFinite(metres) || metres <= 0)
			return {
				ok: false,
				reason: `No permitted directed bus path connects ${from.name} to ${to.name}. Choose another stop.`
			};
		segmentDistanceM.push(metres);
		segmentGeometry.push(pathCoordinates(cache.graph, tree, end.index));
	}
	const windows =
		pattern.timing.kind === 'frequency'
			? pattern.timing.windows.map((window) => ({
					...window,
					...(options.headwayMinutes === undefined
						? {}
						: { headwayMinutes: options.headwayMinutes }),
					...(options.startMinutes === undefined ? {} : { startMinutes: options.startMinutes }),
					...(options.endMinutes === undefined ? {} : { endMinutes: options.endMinutes })
				}))
			: [
					{
						startMinutes: options.startMinutes ?? 420,
						endMinutes: options.endMinutes ?? 1140,
						headwayMinutes: options.headwayMinutes!
					}
				];
	const replacement: PlanningServicePattern = {
		...structuredClone(pattern),
		provenance: 'assumed' as const,
		distanceM: segmentDistanceM.reduce((sum, metres) => sum + metres, 0),
		segmentDistanceM,
		segmentGeometry,
		geometry: segmentGeometry.flatMap((line, index) => (index ? line.slice(1) : line)),
		timing: {
			kind: 'frequency' as const,
			windows,
			segmentMinutes: segmentDistanceM.map(
				(metres) => metres / ((assumptions.busMovingKph * 1000) / 60) + assumptions.busDwellMinutes
			)
		},
		runtimeBasis:
			'OSM-directed driving paths with assumed bus speed and dwell; not a published timetable or congestion forecast.'
	};
	delete replacement.runtimeUnavailableReason;
	if (!patternIsValid(replacement))
		return { ok: false, reason: 'The connection frequency or operating windows are invalid.' };
	return { ok: true, pattern: replacement };
}

function connectionStops(
	current: PlanningStop[],
	additions: PlanningStop[],
	baseline: PlanningBaseline
): { ok: true; stops: Map<string, PlanningStop> } | { ok: false; reason: string } {
	const stops = new Map(current.map((stop) => [stop.id, stop]));
	const islands = new Set(baseline.islands.map((island) => island.id));
	for (const stop of additions) {
		if (stops.has(stop.id))
			return { ok: false, reason: 'A proposed stop already exists. Reuse it in the connection.' };
		if (
			!Number.isFinite(stop.lon) ||
			!Number.isFinite(stop.lat) ||
			Math.abs(stop.lon) > 180 ||
			Math.abs(stop.lat) > 90 ||
			!islands.has(stop.islandId) ||
			stop.mode === 'ferry'
		)
			return {
				ok: false,
				reason: 'A proposed bus stop has invalid coordinates or island coverage.'
			};
		stops.set(stop.id, stop);
	}
	return { ok: true, stops };
}

/** An unconnected stop stays unserved until a separate connection is committed. */
export function createBusStopProposal(
	baseline: PlanningBaseline,
	options: BusStopProposalOptions
): ConnectionResult {
	const a = options.assumptions ?? createDefaultAssumptions(baseline);
	const invalid = validRuntime(a, {});
	if (invalid) return { ok: false, reason: invalid };
	if (
		options.coordinate.length !== 2 ||
		!options.coordinate.every(Number.isFinite) ||
		Math.abs(options.coordinate[0]) > 180 ||
		Math.abs(options.coordinate[1]) > 90
	)
		return { ok: false, reason: 'Choose valid bus stop coordinates.' };
	const graph = driveCache(baseline.network).graph;
	const snap = nearestGraphNode(
		graph,
		{ lon: options.coordinate[0], lat: options.coordinate[1] },
		'drive',
		a.maxSnapM
	);
	if (!snap)
		return { ok: false, reason: 'No permitted bus road is within the stop connection limit.' };
	const point = graph.nodes[snap.index];
	const islands = new Set(baseline.islands.map((island) => island.id));
	const nodeIsland = 'islandId' in point ? point.islandId : undefined;
	let islandId = typeof nodeIsland === 'string' && islands.has(nodeIsland) ? nodeIsland : null;
	if (nodeIsland === undefined) {
		const nearest = baseline.origins
			.filter((origin) => islands.has(origin.islandId))
			.sort((one, two) => distanceM(point, one) - distanceM(point, two))[0];
		islandId = nearest?.islandId ?? null;
	}
	if (!islandId)
		return { ok: false, reason: 'The bus road is not assigned to a supported land island.' };
	const world = derivePlanningWorld(baseline, options.actions ?? [], a);
	const nearby = world.stops.find((stop) => stop.mode !== 'ferry' && distanceM(stop, point) < 15);
	if (nearby)
		return {
			ok: false,
			reason:
				world.patterns.some((pattern) => pattern.stopIds.includes(nearby.id)) ||
				!baseline.transit.stops.some((stop) => stop.id === nearby.id)
					? `A stop already exists here: ${nearby.name}. Add a connection from that stop.`
					: `An operator-listed location already exists in the catalogue here: ${nearby.name}. Its service is unverified. Open Evidence → Map locations & layers → Show stops without loaded service to review it before proposing a connection.`
		};
	return {
		ok: true,
		action: {
			kind: 'add-stop',
			stop: {
				id: `proposal-stop-${point.lon.toFixed(6)}-${point.lat.toFixed(6)}`,
				name: options.name?.trim() || 'Proposed bus stop',
				lon: point.lon,
				lat: point.lat,
				islandId,
				sourceIds: [],
				mode: 'bus'
			}
		}
	};
}

/** Reusing observed stops adds service costs, never duplicate stop investment. */
export function createBusConnection(
	baseline: PlanningBaseline,
	options: BusConnectionOptions
): ConnectionResult {
	const a = options.assumptions ?? createDefaultAssumptions(baseline);
	const runtime = { ...options, headwayMinutes: options.headwayMinutes ?? 15 };
	const invalid = validRuntime(a, runtime);
	if (invalid) return { ok: false, reason: invalid };
	if (
		options.stopIds.length < 2 ||
		options.stopIds.length > 50 ||
		new Set(options.stopIds).size !== options.stopIds.length
	)
		return { ok: false, reason: 'Choose two or more different stops in travel order.' };
	const world = derivePlanningWorld(baseline, options.actions ?? [], a);
	const resolved = connectionStops(world.stops, options.stops ?? [], baseline);
	if (!resolved.ok) return resolved;
	if ((options.stops ?? []).some((stop) => !options.stopIds.includes(stop.id)))
		return { ok: false, reason: 'Every new stop must belong to the proposed connection.' };
	for (const id of options.stopIds) {
		const stop = resolved.stops.get(id);
		if (!stop || stop.mode === 'ferry' || stop.disabled)
			return { ok: false, reason: 'Choose active bus stops for the new connection.' };
	}
	const baseId = `proposal-connection-${options.stopIds.map(encodeURIComponent).join('-')}`;
	let routeId = baseId;
	let suffix = 1;
	while (world.patterns.some((pattern) => pattern.routeId === routeId))
		routeId = `${baseId}-${++suffix}`;
	const seed: PlanningServicePattern = {
		id: `${routeId}-out`,
		routeId,
		name: options.name?.trim() || 'Proposed bus connection',
		mode: 'bus',
		stopIds: [...options.stopIds],
		calendar: { weekdays: [0, 1, 2, 3, 4, 5, 6], startDate: a.date },
		timing: {
			kind: 'frequency',
			windows: [
				{
					startMinutes: options.startMinutes ?? 420,
					endMinutes: options.endMinutes ?? 1140,
					headwayMinutes: runtime.headwayMinutes
				}
			],
			segmentMinutes: []
		},
		provenance: 'assumed',
		sourceIds: [],
		fleet: options.fleet ?? 'diesel',
		enabled: true
	};
	const outward = rerouteBusPattern(baseline, seed, resolved.stops, a, runtime);
	if (!outward.ok) return outward;
	const returning = rerouteBusPattern(
		baseline,
		{ ...seed, id: `${routeId}-back`, stopIds: [...seed.stopIds].reverse() },
		resolved.stops,
		a,
		runtime
	);
	if (!returning.ok) return { ok: false, reason: `Return connection: ${returning.reason}` };
	return {
		ok: true,
		action: {
			kind: 'add-route',
			pattern: outward.pattern,
			returnPattern: returning.pattern,
			stops: structuredClone(options.stops ?? [])
		}
	};
}

/** Insert once into a route and its matching reverse gap, keeping all other stops ordered. */
export function createStopInsertion(
	baseline: PlanningBaseline,
	options: StopInsertionOptions
): ConnectionResult {
	const a = options.assumptions ?? createDefaultAssumptions(baseline);
	const world = derivePlanningWorld(baseline, options.actions ?? [], a);
	const target = world.patterns.find((pattern) => pattern.id === options.patternId);
	if (
		!target ||
		target.mode !== 'bus' ||
		target.enabled === false ||
		target.runtimeUnavailableReason
	)
		return { ok: false, reason: 'Choose an active bus connection.' };
	if (target.stopIds.includes(options.stopId))
		return { ok: false, reason: 'This stop is already on the selected connection.' };
	const after = target.stopIds.indexOf(options.afterStopId);
	if (after < 0 || target.stopIds.lastIndexOf(options.afterStopId) !== after)
		return { ok: false, reason: 'Choose an unambiguous place in this connection.' };
	const resolved = connectionStops(world.stops, options.stops ?? [], baseline);
	if (!resolved.ok) return resolved;
	const stop = resolved.stops.get(options.stopId);
	if (
		!stop ||
		stop.mode === 'ferry' ||
		stop.disabled ||
		(options.stops ?? []).some((added) => added.id !== stop.id)
	)
		return { ok: false, reason: 'Choose an active bus stop to add to the connection.' };
	const proposed = [
		{
			...target,
			stopIds: [...target.stopIds.slice(0, after + 1), stop.id, ...target.stopIds.slice(after + 1)]
		}
	];
	for (const opposite of world.patterns) {
		if (
			opposite.id === target.id ||
			opposite.routeId !== target.routeId ||
			opposite.mode !== 'bus' ||
			opposite.enabled === false
		)
			continue;
		if (
			opposite.stopIds[0] !== target.stopIds.at(-1) ||
			opposite.stopIds.at(-1) !== target.stopIds[0]
		)
			continue;
		if (opposite.runtimeUnavailableReason || opposite.stopIds.includes(stop.id))
			return {
				ok: false,
				reason:
					'The return direction cannot accept this stop. Create a new two-way connection instead.'
			};
		let before: number;
		if (after === target.stopIds.length - 1) before = 0;
		else {
			const next = target.stopIds[after + 1];
			before =
				opposite.stopIds.findIndex(
					(id, index) => id === next && opposite.stopIds[index + 1] === options.afterStopId
				) + 1;
			if (before === 0)
				return {
					ok: false,
					reason:
						'The return direction has a different stop sequence. Create a new two-way connection instead.'
				};
		}
		proposed.push({
			...opposite,
			stopIds: [...opposite.stopIds.slice(0, before), stop.id, ...opposite.stopIds.slice(before)]
		});
	}
	const patterns: PlanningServicePattern[] = [];
	for (const pattern of proposed) {
		const routed = rerouteBusPattern(baseline, pattern, resolved.stops, a, options);
		if (!routed.ok) return routed;
		patterns.push(routed.pattern);
	}
	return {
		ok: true,
		action: {
			kind: 'replace-route',
			patternId: target.id,
			patterns,
			stops: structuredClone(options.stops ?? [])
		}
	};
}
