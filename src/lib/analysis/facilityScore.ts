import {
	CONNECTIVITY,
	OVERLAP_PENALTY,
	OVERLAP_RADIUS_M,
	POPULATION_COVERAGE
} from '#lib/config/analysis.ts';
import { INFRASTRUCTURE_TYPE_STYLES } from '#lib/config/infrastructure.ts';
import type {
	CoverageMetrics,
	NearbyFacility,
	ProximityComponent,
	ScorePenalty
} from '#lib/types/analysis.ts';
import type {
	InfrastructureFeature,
	InfrastructureType,
	TransportRoute
} from '#lib/types/domain.ts';
import { formatDistance } from '#lib/utils/format.ts';
import {
	calculateEducationAccessibility,
	calculateHealthAccessibility,
	type AccessIndex
} from './accessibility.ts';
import type { ComponentInput } from './scoring.ts';

/** What the score calculators need to know about the world. Satisfied by the Baseline store. */
export interface AnalysisWorld {
	readonly infrastructure: readonly InfrastructureFeature[];
	routesServing(id: string): readonly TransportRoute[];
}

const round = (n: number) => Math.round(n);

export function populationCoverageComponent(coverage: CoverageMetrics): ComponentInput {
	const band = coverage.bands.find((b) => b.minutes === POPULATION_COVERAGE.bandMinutes);
	const population = band?.population ?? 0;
	const score = (population / POPULATION_COVERAGE.fullScorePopulation) * 100;
	return {
		id: 'populationCoverage',
		label: 'Population coverage',
		score,
		explanation: `${round(population).toLocaleString('en-US')} residents within a ${POPULATION_COVERAGE.bandMinutes}-minute walk, against ${POPULATION_COVERAGE.fullScorePopulation.toLocaleString('en-US')} for a full score.`,
		inputs: [
			{ label: `Residents ≤ ${POPULATION_COVERAGE.bandMinutes} min`, value: round(population) },
			{ label: 'Full-score population', value: POPULATION_COVERAGE.fullScorePopulation }
		]
	};
}

/**
 * Routes and interchanges reachable on foot. `walkable` is every facility by distance;
 * the origin itself counts when it is a transport facility.
 */
export function connectivityComponent(
	origin: InfrastructureFeature,
	walkable: readonly NearbyFacility[],
	world: AnalysisWorld
): ComponentInput {
	const within = walkable.filter(
		(f) => f.walkMinutes !== null && f.walkMinutes <= CONNECTIVITY.walkMinutes
	);
	const reachableIds = [origin.id, ...within.map((f) => f.id)];
	const routeIds = new Set(reachableIds.flatMap((id) => world.routesServing(id).map((r) => r.id)));
	const types = new Set<InfrastructureType>([origin.type, ...within.map((f) => f.type)]);
	const hasFerry = types.has('ferry_terminal');
	const hasBusTerminal = types.has('bus_terminal');

	const routePoints = Math.min(
		CONNECTIVITY.maxRoutePoints,
		routeIds.size * CONNECTIVITY.pointsPerRoute
	);
	const score =
		routePoints +
		(hasFerry ? CONNECTIVITY.ferryTerminalBonus : 0) +
		(hasBusTerminal ? CONNECTIVITY.busTerminalBonus : 0);

	const parts = [
		`${routeIds.size} route${routeIds.size === 1 ? '' : 's'} (+${routePoints})`,
		hasFerry ? `ferry terminal (+${CONNECTIVITY.ferryTerminalBonus})` : 'no ferry terminal',
		hasBusTerminal ? `bus terminal (+${CONNECTIVITY.busTerminalBonus})` : 'no bus terminal'
	];
	return {
		id: 'connectivity',
		label: 'Connectivity',
		score,
		explanation: `Within a ${CONNECTIVITY.walkMinutes}-minute walk: ${parts.join(', ')}.`,
		inputs: [
			{ label: 'Routes reachable', value: routeIds.size },
			{ label: 'Ferry terminal reachable', value: hasFerry ? 'Yes' : 'No' },
			{ label: 'Bus terminal reachable', value: hasBusTerminal ? 'Yes' : 'No' }
		]
	};
}

/**
 * Health and education access at the facility's own location, from the shared location model
 * (analysis/accessibility.ts). A hospital or school counts itself at 0 m.
 */
export function serviceAccessComponent(
	origin: InfrastructureFeature,
	index: AccessIndex
): ComponentInput {
	const location = {
		position: origin.geometry.coordinates,
		island: typeof origin.metadata.island === 'string' ? origin.metadata.island : null
	};
	const [hospital] = calculateHealthAccessibility(location, index).components;
	const [school] = calculateEducationAccessibility(location, index).components;
	const describe = (c: ProximityComponent) =>
		`${c.label.toLowerCase()} ${
			c.distanceM === null
				? 'unreachable'
				: `${formatDistance(c.distanceM)}${c.viaFerry ? ' incl. ferry' : ''}`
		} (${round(c.score)})`;
	const input = (c: ProximityComponent) => ({
		label: `Nearest ${c.label.toLowerCase()}`,
		value: c.distanceM === null ? 'Unreachable' : round(c.distanceM),
		unit: c.distanceM === null ? undefined : c.viaFerry ? 'm-equiv. via ferry' : 'm'
	});
	return {
		id: 'serviceAccess',
		label: 'Service access',
		score: (hospital.score + school.score) / 2,
		explanation: `Average of ${describe(hospital)} and ${describe(school)}; straight-line proximity.`,
		inputs: [input(hospital), input(school)]
	};
}

export function overlapPenalty(
	origin: InfrastructureFeature,
	byDistance: readonly NearbyFacility[]
): ScorePenalty | null {
	const radius = OVERLAP_RADIUS_M[origin.type];
	if (radius <= 0) return null;
	const overlapping = byDistance.filter((f) => f.type === origin.type && f.distanceM < radius);
	if (overlapping.length === 0) return null;
	const points = Math.max(
		OVERLAP_PENALTY.maxTotal,
		overlapping.length * OVERLAP_PENALTY.pointsEach
	);
	const typeLabel = INFRASTRUCTURE_TYPE_STYLES[origin.type].label.toLowerCase();
	const names = overlapping.map((f) => `${f.name} (${round(f.distanceM)} m)`).join(', ');
	return {
		id: 'overlap',
		label: 'Catchment overlap',
		points,
		explanation: `Another ${typeLabel} within ${radius} m: ${names}.`
	};
}
