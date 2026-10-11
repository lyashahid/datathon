import { createDefaultAssumptions } from './defaults.ts';
import { getFacilityEligibility } from './facilities.ts';
import {
	buildNetworkGraph,
	distanceM,
	nearestGraphNode,
	pathCoordinates,
	shortestPaths
} from './graph.ts';
import { derivePlanningWorld } from './scenario.ts';
import type {
	PlanningAction,
	PlanningAssumptions,
	PlanningBaseline,
	PlanningFleet,
	PlanningServicePattern,
	PlanningStop
} from './types.ts';

export interface BusProposalOptions {
	originId: string;
	coordinate?: [number, number];
	patternId?: string;
	headwayMinutes?: number;
	fleet?: PlanningFleet;
	goal?: PlanningAssumptions['goal'];
	actions?: readonly PlanningAction[];
	assumptions?: PlanningAssumptions;
}
export type BusProposalResult =
	{ ok: true; action: PlanningAction } | { ok: false; reason: string };

/** An explicitly assumed service draft routed on OSM driving topology, never an invented baseline. */
export function createBusProposal(
	baseline: PlanningBaseline,
	options: BusProposalOptions
): BusProposalResult {
	const origin = baseline.origins.find((o) => o.id === options.originId);
	if (!origin) return { ok: false, reason: 'Choose a mapped population origin.' };
	const a = options.assumptions ?? createDefaultAssumptions(baseline);
	const coordinate = options.coordinate ?? [origin.lon, origin.lat];
	if (
		!coordinate.every(Number.isFinite) ||
		Math.abs(coordinate[0]) > 180 ||
		Math.abs(coordinate[1]) > 90
	)
		return { ok: false, reason: 'The proposed coordinates are invalid.' };
	const graph = buildNetworkGraph(baseline.network);
	const snap = nearestGraphNode(
		graph,
		{ lon: coordinate[0], lat: coordinate[1] },
		'drive',
		a.maxSnapM
	);
	if (!snap) return { ok: false, reason: 'No permitted bus road within the connection limit.' };
	const point = graph.nodes[snap.index];
	const knownIslands = new Set(baseline.islands.map((island) => island.id));
	// Public graph nodes retain the source coastline classification. An explicit null
	// marks an offshore road node and must not inherit the currently selected area.
	const nodeIsland = 'islandId' in point ? point.islandId : undefined;
	let islandId: string | null =
		typeof nodeIsland === 'string' && knownIslands.has(nodeIsland) ? nodeIsland : null;
	if (nodeIsland === undefined) {
		// Legacy graphs without node metadata use the nearest known population origin.
		// This fallback does not replace explicit unassigned public-node classifications.
		let closest = Infinity;
		for (const candidate of baseline.origins) {
			if (!knownIslands.has(candidate.islandId)) continue;
			const candidateDistance = distanceM(point, candidate);
			if (candidateDistance < closest) {
				closest = candidateDistance;
				islandId = candidate.islandId;
			}
		}
	}
	if (!islandId)
		return {
			ok: false,
			reason: 'The snapped bus road is not assigned to a supported land island.'
		};
	const world = derivePlanningWorld(baseline, options.actions ?? [], a);
	const suffix = `${point.lon.toFixed(6)}-${point.lat.toFixed(6)}`;
	const stop: PlanningStop = {
		id: `proposal-stop-${suffix}`,
		name: 'Proposed neighbourhood stop',
		lon: point.lon,
		lat: point.lat,
		islandId,
		sourceIds: []
	};
	if (world.stops.some((s) => s.id === stop.id))
		return { ok: false, reason: 'A proposed stop already exists at this position.' };
	const selectedPattern = world.patterns.find((p) => p.id === options.patternId);
	if (selectedPattern?.enabled === false || selectedPattern?.runtimeUnavailableReason)
		return {
			ok: false,
			reason: 'Choose an active service with valid timing before proposing an extension.'
		};
	if (selectedPattern?.mode === 'bus' && selectedPattern.timing.kind === 'frequency') {
		const opposite = world.patterns.find(
			(p) =>
				p.id !== selectedPattern.id &&
				p.routeId === selectedPattern.routeId &&
				p.mode === 'bus' &&
				p.timing.kind === 'frequency' &&
				p.enabled !== false &&
				p.stopIds[0] === selectedPattern.stopIds.at(-1) &&
				p.stopIds.at(-1) === selectedPattern.stopIds[0]
		);
		if (!opposite)
			return { ok: false, reason: 'Extending a two-way route requires a matching return service.' };
		const end = world.stops.find((s) => s.id === selectedPattern.stopIds.at(-1));
		const endSnap = end ? nearestGraphNode(graph, end, 'drive', a.maxSnapM) : null;
		if (!end || !endSnap)
			return {
				ok: false,
				reason: 'The service endpoint is not connected to a permitted bus road.'
			};
		const tree = shortestPaths(graph, endSnap.index, 'drive');
		const distanceM = tree.distances[snap.index];
		if (!Number.isFinite(distanceM) || distanceM < 50)
			return {
				ok: false,
				reason: 'No useful permitted driving extension connects this service to the proposed stop.'
			};
		const returnTree = shortestPaths(graph, snap.index, 'drive');
		const returnDistanceM = returnTree.distances[endSnap.index];
		if (!Number.isFinite(returnDistanceM) || returnDistanceM <= 0)
			return {
				ok: false,
				reason: 'No permitted directed return path exists for this route extension.'
			};
		return {
			ok: true,
			action: {
				kind: 'extend-route',
				patternId: selectedPattern.id,
				stop,
				segmentMinutes: distanceM / ((a.busMovingKph * 1000) / 60) + a.busDwellMinutes,
				distanceM,
				geometry: pathCoordinates(graph, tree, snap.index),
				returnSegmentMinutes: returnDistanceM / ((a.busMovingKph * 1000) / 60) + a.busDwellMinutes,
				returnDistanceM,
				returnGeometry: pathCoordinates(graph, returnTree, endSnap.index)
			}
		};
	}
	// A captured scheduled route cannot be extended by inventing its missing timetable. A new
	// assumed feeder service to that route is a separate proposal with its own operating pattern.
	const tree = shortestPaths(graph, snap.index, 'drive');
	let endpoint: {
		id: string;
		name: string;
		lon: number;
		lat: number;
		islandId: string;
		index: number;
		distanceM: number;
	} | null = null;
	if (selectedPattern) {
		const end = world.stops.find((s) => s.id === selectedPattern.stopIds.at(-1));
		const endSnap = end ? nearestGraphNode(graph, end, 'drive', a.maxSnapM) : null;
		if (end && endSnap && Number.isFinite(tree.distances[endSnap.index]))
			endpoint = { ...end, index: endSnap.index, distanceM: tree.distances[endSnap.index] };
	} else {
		const goal = options.goal ?? a.goal;
		for (const facility of world.facilities) {
			if (getFacilityEligibility(facility, { ...a, goal }, true).status !== 'eligible') continue;
			const candidate = nearestGraphNode(graph, facility, 'drive', a.maxSnapM);
			if (
				!candidate ||
				!Number.isFinite(tree.distances[candidate.index]) ||
				tree.distances[candidate.index] < 50
			)
				continue;
			if (!endpoint || tree.distances[candidate.index] < endpoint.distanceM)
				endpoint = {
					...facility,
					index: candidate.index,
					distanceM: tree.distances[candidate.index]
				};
		}
	}
	if (!endpoint)
		return {
			ok: false,
			reason: 'No permitted driving path connects this area to the selected service or destination.'
		};
	const returnTree = shortestPaths(graph, endpoint.index, 'drive');
	const returnDistance = returnTree.distances[snap.index];
	if (!Number.isFinite(returnDistance))
		return { ok: false, reason: 'No permitted return path exists for a two-way bus proposal.' };
	const destinationNode = graph.nodes[endpoint.index];
	const endStop: PlanningStop = {
		id: `proposal-end-${endpoint.id}-${suffix}`,
		name: `Proposed stop near ${endpoint.name}`,
		lon: destinationNode.lon,
		lat: destinationNode.lat,
		islandId: endpoint.islandId,
		sourceIds: []
	};
	const routeId = `proposal-route-${suffix}-${endpoint.id}`;
	const headway = options.headwayMinutes ?? 10;
	if (!Number.isFinite(headway) || headway < 1 || headway > 240 || !(a.busMovingKph > 0))
		return { ok: false, reason: 'Headway or bus speed assumption is invalid.' };
	const pattern = (
		direction: 'out' | 'back',
		ids: string[],
		distanceM: number,
		geometry: [number, number][]
	): PlanningServicePattern => ({
		id: `${routeId}-${direction}`,
		routeId,
		name: selectedPattern
			? `Proposed feeder to ${selectedPattern.name}`
			: `Proposed ${options.goal ?? a.goal} connection`,
		mode: 'bus',
		stopIds: ids,
		calendar: { weekdays: [0, 1, 2, 3, 4, 5, 6], startDate: a.date },
		timing: {
			kind: 'frequency',
			windows: [{ startMinutes: 7 * 60, endMinutes: 19 * 60, headwayMinutes: headway }],
			segmentMinutes: [distanceM / ((a.busMovingKph * 1000) / 60) + a.busDwellMinutes]
		},
		provenance: 'assumed',
		sourceIds: [],
		fleet: options.fleet ?? 'diesel',
		distanceM,
		geometry,
		segmentGeometry: [geometry],
		enabled: true,
		runtimeBasis:
			'Routed OSM driving distance divided by assumed bus moving speed, plus assumed dwell; not calibrated congestion.'
	});
	return {
		ok: true,
		action: {
			kind: 'add-route',
			pattern: pattern(
				'out',
				[stop.id, endStop.id],
				endpoint.distanceM,
				pathCoordinates(graph, tree, endpoint.index)
			),
			returnPattern: pattern(
				'back',
				[endStop.id, stop.id],
				returnDistance,
				pathCoordinates(graph, returnTree, snap.index)
			),
			stops: [stop, endStop]
		}
	};
}
