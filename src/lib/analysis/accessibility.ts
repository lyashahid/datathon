import { NORMAL_CONDITIONS } from '#lib/config/disruptionScenarios.ts';
import {
	OVERALL_WEIGHTS,
	PROXIMITY_TARGETS,
	type ProximityTarget,
	type ProximityThreshold
} from '#lib/config/scoring.ts';
import type { AccessConditions } from '#lib/types/disruption.ts';
import type {
	AccessCategory,
	CategoryAccess,
	LocationAccess,
	OverallAccess,
	ProximityComponent
} from '#lib/types/analysis.ts';
import type { InfrastructureFeature, InfrastructureType, Position } from '#lib/types/domain.ts';
import { haversineM } from './geo.ts';

/**
 * Accessibility v1 — deterministic straight-line proximity.
 *
 * A location scores each target type by distance to the nearest active facility of that type,
 * decaying linearly between two thresholds (config/scoring.ts). Facilities on the same island
 * are reached directly; other islands only via ferry terminals plus a crossing allowance.
 * No routing network is used, so results are approximate.
 *
 * Every function takes optional AccessConditions (default: normal operations) so disruption
 * scenarios change only the stated assumptions, never the scoring rules.
 */

/** Where accessibility is measured from. Island decides what is reachable on foot. */
export interface AccessLocation {
	position: Position;
	island: string | null;
}

/**
 * Active facilities indexed for repeated queries. Build once per effective world and reuse
 * across every cell; disabled facilities are excluded here and nowhere else.
 */
export interface AccessIndex {
	byIslandAndType(island: string, type: InfrastructureType): readonly InfrastructureFeature[];
	ofType(type: InfrastructureType): readonly InfrastructureFeature[];
}

export function createAccessIndex(infrastructure: readonly InfrastructureFeature[]): AccessIndex {
	const byType = new Map<InfrastructureType, InfrastructureFeature[]>();
	const byIsland = new Map<string, InfrastructureFeature[]>();
	for (const f of infrastructure) {
		if (f.status === 'disabled') continue;
		byType.set(f.type, [...(byType.get(f.type) ?? []), f]);
		const island = f.metadata.island;
		if (typeof island === 'string') {
			const key = `${island}\u0000${f.type}`;
			byIsland.set(key, [...(byIsland.get(key) ?? []), f]);
		}
	}
	return {
		byIslandAndType: (island, type) => byIsland.get(`${island}\u0000${type}`) ?? [],
		ofType: (type) => byType.get(type) ?? []
	};
}

/** Linear decay: 100 within `fullScoreWithinM`, 0 beyond `zeroScoreBeyondM`, null → 0. */
export function proximityScore(distanceM: number | null, t: ProximityThreshold): number {
	if (distanceM === null) return 0;
	if (distanceM <= t.fullScoreWithinM) return 100;
	if (distanceM >= t.zeroScoreBeyondM) return 0;
	return (100 * (t.zeroScoreBeyondM - distanceM)) / (t.zeroScoreBeyondM - t.fullScoreWithinM);
}

interface Reach {
	feature: InfrastructureFeature;
	distanceM: number;
	viaFerry: boolean;
}

function nearest(
	position: Position,
	candidates: readonly InfrastructureFeature[]
): { feature: InfrastructureFeature; distanceM: number } | null {
	let best: { feature: InfrastructureFeature; distanceM: number } | null = null;
	for (const feature of candidates) {
		const distanceM = haversineM(position, feature.geometry.coordinates);
		// Ties break on id so equal distances never depend on input order.
		if (
			!best ||
			distanceM < best.distanceM ||
			(distanceM === best.distanceM && feature.id < best.feature.id)
		) {
			best = { feature, distanceM };
		}
	}
	return best;
}

/**
 * Nearest reachable facility of a type. Cross-island trips are walk → own ferry terminal,
 * + crossing allowance, + walk from the destination island's nearest terminal.
 */
export function nearestReachable(
	location: AccessLocation,
	type: InfrastructureType,
	index: AccessIndex,
	allowSeaCrossing: boolean,
	conditions: AccessConditions = NORMAL_CONDITIONS
): Reach | null {
	const { position, island } = location;
	if (!island) return null;

	const local = nearest(position, index.byIslandAndType(island, type));
	let best: Reach | null = local ? { ...local, viaFerry: false } : null;
	if (!allowSeaCrossing || !conditions.seaCrossingAvailable) return best;

	const ownTerminal = nearest(position, index.byIslandAndType(island, 'ferry_terminal'));
	if (!ownTerminal) return best;
	for (const target of index.ofType(type)) {
		const targetIsland = target.metadata.island;
		if (typeof targetIsland !== 'string' || targetIsland === island) continue;
		const arrival = nearest(
			target.geometry.coordinates,
			index.byIslandAndType(targetIsland, 'ferry_terminal')
		);
		if (!arrival) continue;
		const distanceM = ownTerminal.distanceM + conditions.seaCrossingEquivalentM + arrival.distanceM;
		if (!best || distanceM < best.distanceM) best = { feature: target, distanceM, viaFerry: true };
	}
	return best;
}

function scoreComponent(
	location: AccessLocation,
	target: ProximityTarget,
	index: AccessIndex,
	conditions: AccessConditions
): ProximityComponent {
	const outOfService = target.type === 'ferry_terminal' && !conditions.ferryTerminalsInService;
	const reach = outOfService
		? null
		: nearestReachable(location, target.type, index, target.allowSeaCrossing, conditions);
	const score = proximityScore(reach?.distanceM ?? null, target);
	return {
		id: target.id,
		label: target.label,
		nearestId: reach?.feature.id ?? null,
		distanceM: reach?.distanceM ?? null,
		viaFerry: reach?.viaFerry ?? false,
		fullScoreWithinM: target.fullScoreWithinM,
		zeroScoreBeyondM: target.zeroScoreBeyondM,
		score,
		weight: target.weight,
		contribution: score * target.weight
	};
}

function calculateCategory(
	category: AccessCategory,
	location: AccessLocation,
	index: AccessIndex,
	conditions: AccessConditions
): CategoryAccess {
	const components = PROXIMITY_TARGETS[category].map((t) =>
		scoreComponent(location, t, index, conditions)
	);
	return {
		category,
		score: Math.round(components.reduce((s, c) => s + c.contribution, 0)),
		components
	};
}

/** Weighted proximity to bus stops, ferry terminals and bus terminals on the same island. */
export function calculateTransportAccessibility(
	location: AccessLocation,
	index: AccessIndex,
	conditions: AccessConditions = NORMAL_CONDITIONS
): CategoryAccess {
	return calculateCategory('transport', location, index, conditions);
}

/** Proximity to the nearest hospital, across water via ferry where needed. */
export function calculateHealthAccessibility(
	location: AccessLocation,
	index: AccessIndex,
	conditions: AccessConditions = NORMAL_CONDITIONS
): CategoryAccess {
	return calculateCategory('health', location, index, conditions);
}

/** Proximity to the nearest school, across water via ferry where needed. */
export function calculateEducationAccessibility(
	location: AccessLocation,
	index: AccessIndex,
	conditions: AccessConditions = NORMAL_CONDITIONS
): CategoryAccess {
	return calculateCategory('education', location, index, conditions);
}

export function calculateOverallAccessibility(
	categories: Record<AccessCategory, CategoryAccess>
): OverallAccess {
	const components = (Object.keys(OVERALL_WEIGHTS) as AccessCategory[]).map((category) => {
		const score = categories[category].score;
		const weight = OVERALL_WEIGHTS[category];
		return { category, score, weight, contribution: score * weight };
	});
	return {
		score: Math.round(components.reduce((s, c) => s + c.contribution, 0)),
		components
	};
}

/** All categories plus the overall score for one location. */
export function calculateLocationAccess(
	location: AccessLocation,
	index: AccessIndex,
	conditions: AccessConditions = NORMAL_CONDITIONS
): LocationAccess {
	const transport = calculateTransportAccessibility(location, index, conditions);
	const health = calculateHealthAccessibility(location, index, conditions);
	const education = calculateEducationAccessibility(location, index, conditions);
	return {
		transport,
		health,
		education,
		overall: calculateOverallAccessibility({ transport, health, education })
	};
}
