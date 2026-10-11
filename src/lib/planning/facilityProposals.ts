import { createDefaultAssumptions } from './defaults.ts';
import { buildNetworkGraph, distanceM, nearestGraphNode } from './graph.ts';
import { derivePlanningWorld } from './scenario.ts';
import type {
	PlanningAction,
	PlanningAssumptions,
	PlanningBaseline,
	PlanningFacility
} from './types.ts';

export interface FacilityProposalOptions {
	coordinate: [number, number];
	kind: 'clinic' | 'school';
	actions?: readonly PlanningAction[];
	assumptions?: PlanningAssumptions;
	name?: string;
}
export type FacilityProposalResult =
	| { ok: true; action: Extract<PlanningAction, { kind: 'add-facility' }> }
	| { ok: false; reason: string };

/** Model a conditional destination on permitted walking paths, without inventing a real building. */
export function createFacilityProposal(
	baseline: PlanningBaseline,
	options: FacilityProposalOptions
): FacilityProposalResult {
	const assumptions = options.assumptions ?? createDefaultAssumptions(baseline);
	if (
		!['clinic', 'school'].includes(options.kind) ||
		options.coordinate.length !== 2 ||
		!options.coordinate.every(Number.isFinite) ||
		Math.abs(options.coordinate[0]) > 180 ||
		Math.abs(options.coordinate[1]) > 90 ||
		!Number.isFinite(assumptions.maxSnapM) ||
		assumptions.maxSnapM <= 0 ||
		assumptions.maxSnapM > 500
	)
		return { ok: false, reason: 'Choose a valid location and walking connection limit.' };
	const graph = buildNetworkGraph(baseline.network);
	const snap = nearestGraphNode(
		graph,
		{ lon: options.coordinate[0], lat: options.coordinate[1] },
		'walk',
		assumptions.maxSnapM
	);
	if (!snap)
		return { ok: false, reason: 'No permitted walking path is within the connection limit.' };
	const point = graph.nodes[snap.index];
	const islands = new Set(baseline.islands.map((island) => island.id));
	const nodeIsland = 'islandId' in point ? point.islandId : undefined;
	let islandId = typeof nodeIsland === 'string' && islands.has(nodeIsland) ? nodeIsland : null;
	if (nodeIsland === undefined) {
		// Older/test graphs lack coastline classification; respect explicit null/unknown public nodes.
		const closest = baseline.origins
			.filter((origin) => islands.has(origin.islandId))
			.sort((one, two) => distanceM(point, one) - distanceM(point, two))[0];
		islandId = closest?.islandId ?? null;
	}
	if (!islandId)
		return { ok: false, reason: 'The walking path is not assigned to a supported land island.' };
	const world = derivePlanningWorld(baseline, options.actions ?? [], assumptions);
	const nearby = world.facilities.find(
		(facility) => facility.kind === options.kind && distanceM(facility, point) < 15
	);
	if (nearby)
		return { ok: false, reason: `A ${options.kind} is already mapped here: ${nearby.name}.` };
	const facility: PlanningFacility = {
		id: `proposal-${options.kind}-${point.lon.toFixed(6)}-${point.lat.toFixed(6)}`,
		name:
			options.name?.trim() || (options.kind === 'school' ? 'Proposed school' : 'Proposed clinic'),
		kind: options.kind,
		islandId,
		lon: point.lon,
		lat: point.lat,
		provenance: 'assumed',
		planningStatus: 'proposed',
		verification: 'scenario-proposal',
		operatingStatus: 'open',
		proposedOpeningDate: assumptions.date,
		sourceIds: ['scenario-proposal'],
		...(options.kind === 'clinic' ? { careScope: 'general' as const } : {}),
		statusNote:
			'Conditional location test, assumed open for this scenario. Staffing, capacity, land permission, investment and annual costs require verification. No observed facility or service-hours claim.'
	};
	return { ok: true, action: { kind: 'add-facility', facility } };
}
