import {
	buildNetworkGraph,
	nearestGraphNode,
	pathCoordinates,
	shortestPaths,
	type NetworkGraph,
	type PathTree
} from './graph.ts';
import { derivePlanningWorld } from './scenario.ts';
import { rerouteBusPattern } from './connections.ts';
import type {
	PlanningAction,
	PlanningAssumptions,
	PlanningBaseline,
	PlanningServicePattern,
	PlanningStop
} from './types.ts';

export type StopMoveResult =
	| { ok: true; actions: PlanningAction[]; position: [number, number] }
	| { ok: false; reason: string };

export interface StopMoveOptions {
	/** Reroute attached bus services instead of invalidating published timing. */
	keepConnections?: boolean;
	/** Explicit replacement frequency for scheduled services; existing frequencies are retained. */
	headwayMinutes?: number;
	startMinutes?: number;
	endMinutes?: number;
}

const driveCaches = new WeakMap<
	PlanningBaseline['network'],
	{ graph: NetworkGraph; paths: Map<number, PathTree> }
>();

function driveCache(network: PlanningBaseline['network']) {
	let cache = driveCaches.get(network);
	if (!cache) {
		cache = { graph: buildNetworkGraph(network), paths: new Map() };
		driveCaches.set(network, cache);
	}
	return cache;
}

/**
 * Prepare a complete immutable action history for preview or a single gesture-end commit.
 * Proposed frequency services retain IDs and controls. Keeping connections explicitly
 * replaces published scheduled timing with selected frequency assumptions; otherwise the
 * original move action invalidates that timing.
 */
export function prepareStopMove(
	baseline: PlanningBaseline,
	actions: readonly PlanningAction[],
	stopId: string,
	coordinate: [number, number],
	assumptions: PlanningAssumptions,
	options: StopMoveOptions = {}
): StopMoveResult {
	if (
		coordinate.length !== 2 ||
		!coordinate.every(Number.isFinite) ||
		Math.abs(coordinate[0]) > 180 ||
		Math.abs(coordinate[1]) > 90
	)
		return { ok: false, reason: 'The stop coordinates are invalid.' };
	if (
		!Number.isFinite(assumptions.busMovingKph) ||
		!Number.isFinite(assumptions.busDwellMinutes) ||
		!Number.isFinite(assumptions.maxSnapM) ||
		!(assumptions.busMovingKph > 0) ||
		!(assumptions.busDwellMinutes >= 0) ||
		!(assumptions.maxSnapM > 0)
	)
		return { ok: false, reason: 'Choose valid bus speed and dwell assumptions.' };
	const world = derivePlanningWorld(baseline, actions, assumptions);
	const current = world.stops.find((stop) => stop.id === stopId);
	if (!current) return { ok: false, reason: 'This stop does not exist in the current proposal.' };
	if (
		current.mode === 'ferry' ||
		world.patterns.some((p) => p.mode === 'ferry' && p.stopIds.includes(stopId))
	)
		return { ok: false, reason: 'Ferry terminals cannot be moved onto a bus road.' };
	const cache = driveCache(baseline.network);
	const snap = nearestGraphNode(
		cache.graph,
		{ lon: coordinate[0], lat: coordinate[1] },
		'drive',
		assumptions.maxSnapM
	);
	if (!snap)
		return { ok: false, reason: 'No permitted bus road is within the stop connection limit.' };
	const node = cache.graph.nodes[snap.index];
	const position: [number, number] = [node.lon, node.lat];
	if (options.keepConnections) {
		if ('islandId' in node && node.islandId === null)
			return {
				ok: false,
				reason: 'Place the stop on a supported land island, not on an offshore road.'
			};
		const islandId =
			'islandId' in node && typeof node.islandId === 'string' ? node.islandId : undefined;
		if (islandId && !baseline.islands.some((island) => island.id === islandId))
			return { ok: false, reason: 'This bus road is outside the supported island coverage.' };
		const movedStops = new Map(
			world.stops.map((stop) => [
				stop.id,
				stop.id === stopId
					? {
							...stop,
							lon: node.lon,
							lat: node.lat,
							...(islandId ? { islandId } : {})
						}
					: stop
			])
		);
		const routes = new Map<string, PlanningServicePattern[]>();
		for (const pattern of world.patterns) {
			if (pattern.enabled === false || !pattern.stopIds.includes(stopId)) continue;
			const rebuilt = rerouteBusPattern(baseline, pattern, movedStops, assumptions, {
				...(pattern.timing.kind === 'scheduled'
					? {
							headwayMinutes: options.headwayMinutes,
							startMinutes: options.startMinutes,
							endMinutes: options.endMinutes
						}
					: {})
			});
			if (!rebuilt.ok) return rebuilt;
			routes.set(pattern.routeId, [...(routes.get(pattern.routeId) ?? []), rebuilt.pattern]);
		}
		const replacements: PlanningAction[] = [...routes.values()].map((patterns) => ({
			kind: 'replace-route',
			patternId: patterns[0].id,
			patterns
		}));
		return {
			ok: true,
			position,
			actions: [
				...structuredClone(actions),
				{
					kind: 'move-stop',
					stopId,
					position: { lon: node.lon, lat: node.lat },
					...(islandId ? { islandId } : {})
				},
				...replacements
			]
		};
	}
	const ownerIndex = baseline.transit.stops.some((s) => s.id === stopId)
		? -1
		: actions.findIndex(
				(action) => action.kind === 'add-route' && action.stops?.some((stop) => stop.id === stopId)
			);
	if (ownerIndex < 0)
		return {
			ok: true,
			actions: [
				...structuredClone(actions),
				{ kind: 'move-stop', stopId, position: { lon: node.lon, lat: node.lat } }
			],
			position
		};
	const owner = actions[ownerIndex];
	if (owner.kind !== 'add-route')
		return { ok: false, reason: 'The proposed service could not be located.' };
	const ownedPatterns = [owner.pattern, ...(owner.returnPattern ? [owner.returnPattern] : [])];
	const ownedIds = new Set(ownedPatterns.map((p) => p.id));
	if (
		actions
			.slice(ownerIndex + 1)
			.some(
				(a) =>
					(a.kind === 'extend-route' && ownedIds.has(a.patternId)) ||
					(a.kind === 'move-stop' && a.stopId === stopId)
			) ||
		world.patterns.some((p) => p.stopIds.includes(stopId) && !ownedIds.has(p.id))
	)
		return {
			ok: false,
			reason: 'This stop has later route geometry edits. Undo those edits before dragging it.'
		};
	const stops = new Map<string, PlanningStop>(
		world.stops.map((stop) => [
			stop.id,
			stop.id === stopId ? { ...stop, lon: node.lon, lat: node.lat } : stop
		])
	);
	const routedPatterns: PlanningServicePattern[] = [];
	for (const pattern of ownedPatterns) {
		if (pattern.mode !== 'bus' || pattern.timing.kind !== 'frequency')
			return {
				ok: false,
				reason: 'Live proposed-route editing requires an explicitly assumed bus frequency service.'
			};
		const segmentDistanceM: number[] = [];
		const segmentGeometry: [number, number][][] = [];
		for (let i = 0; i < pattern.stopIds.length - 1; i++) {
			const from = stops.get(pattern.stopIds[i]);
			const to = stops.get(pattern.stopIds[i + 1]);
			const start = from
				? nearestGraphNode(cache.graph, from, 'drive', assumptions.maxSnapM)
				: null;
			const end = to ? nearestGraphNode(cache.graph, to, 'drive', assumptions.maxSnapM) : null;
			if (!start || !end)
				return { ok: false, reason: 'A service endpoint cannot connect to a permitted bus road.' };
			let tree = cache.paths.get(start.index);
			if (!tree) {
				tree = shortestPaths(cache.graph, start.index, 'drive');
				if (cache.paths.size >= 32) cache.paths.delete(cache.paths.keys().next().value!);
				cache.paths.set(start.index, tree);
			}
			const metres = tree.distances[end.index];
			if (!Number.isFinite(metres) || metres <= 0)
				return {
					ok: false,
					reason: 'A permitted directed bus path is required in every proposed service direction.'
				};
			segmentDistanceM.push(metres);
			segmentGeometry.push(pathCoordinates(cache.graph, tree, end.index));
		}
		routedPatterns.push({
			...structuredClone(pattern),
			distanceM: segmentDistanceM.reduce((sum, metres) => sum + metres, 0),
			segmentDistanceM,
			segmentGeometry,
			geometry: segmentGeometry.flatMap((line, i) => (i ? line.slice(1) : line)),
			timing: {
				...structuredClone(pattern.timing),
				segmentMinutes: segmentDistanceM.map(
					(metres) =>
						metres / ((assumptions.busMovingKph * 1000) / 60) + assumptions.busDwellMinutes
				)
			}
		});
	}
	const replacement: PlanningAction = {
		...structuredClone(owner),
		stops: owner.stops?.map((stop) =>
			stop.id === stopId ? { ...stop, lon: node.lon, lat: node.lat } : structuredClone(stop)
		),
		pattern: routedPatterns[0],
		...(owner.returnPattern ? { returnPattern: routedPatterns[1] } : {})
	};
	return {
		ok: true,
		actions: actions.map((a, index) => (index === ownerIndex ? replacement : structuredClone(a))),
		position
	};
}
