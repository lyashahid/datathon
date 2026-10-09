import { BUS_STOP_SCORING, type BusStopWeights } from '#lib/config/busStopScoring.ts';
import { PLACEMENT_RULES } from '#lib/config/placement.ts';
import type {
	BusStopCandidate,
	CandidateArea,
	CandidateSearchResult
} from '#lib/types/candidates.ts';
import type { InfrastructureFeature, Position, TransportRoute } from '#lib/types/domain.ts';
import type { H3Cell, H3Grid } from '#lib/types/h3.ts';
import { calculateTransportAccessibility, createAccessIndex } from './accessibility.ts';
import { haversineM } from './geo.ts';
import { normalizeWeights, scoreBusStopCandidate } from './scoring/busStop.ts';

const ESSENTIAL_TYPES = new Set(['hospital', 'school', 'ferry_terminal', 'bus_terminal']);

export interface CandidateSearchInput {
	/** Cell the planner selected; the area of interest is centred on it. */
	origin: H3Cell;
	/** Current (scenario) analytical grid. */
	grid: H3Grid;
	/** Effective infrastructure and routes. */
	infrastructure: readonly InfrastructureFeature[];
	routes: readonly TransportRoute[];
	weights: BusStopWeights;
	/** Island containing a position (outline test). Candidates off the area's island are rejected. */
	islandAt(position: Position): string | null;
	topN?: number;
	radiusM?: number;
}

/**
 * Recommended bus-stop candidates for an area of interest:
 *  1. generate — centres of the analytical cells in the area (structured candidate points)
 *  2. reject   — off-island or duplicating an existing stop
 *  3. score    — weighted criteria and penalties (scoring/busStop.ts)
 *  4. rank     — score, then underserved residents reached, then id; return the top N,
 *                skipping any within `minSeparationM` of a higher-ranked pick
 * Deterministic for identical inputs. Results are candidates under the selected assumptions.
 */
export function recommendBusStops(input: CandidateSearchInput): CandidateSearchResult {
	const radiusM = input.radiusM ?? BUS_STOP_SCORING.areaRadiusM;
	const topN = input.topN ?? BUS_STOP_SCORING.topN;
	const { origin } = input;
	const island = origin.island;
	const weights = normalizeWeights(input.weights);

	const islandCells = input.grid.cells.filter((c) => c.island === island);
	const areaCells = islandCells.filter((c) => haversineM(origin.centroid, c.centroid) <= radiusM);
	const active = input.infrastructure.filter((f) => f.status !== 'disabled');
	const onIsland = active.filter((f) => f.metadata.island === island);
	const stops = onIsland.filter((f) => f.type === 'bus_stop');
	const context = {
		islandCells,
		stops,
		busRoutes: input.routes.filter((r) => r.mode === 'bus' && r.status !== 'disabled'),
		services: onIsland.filter((f) => ESSENTIAL_TYPES.has(f.type))
	};
	const atollValue = onIsland.find((f) => typeof f.metadata.atoll === 'string')?.metadata.atoll;
	const atoll = typeof atollValue === 'string' ? atollValue : null;

	const rejectionReasons: Record<string, number> = {};
	const reject = (reason: string) =>
		(rejectionReasons[reason] = (rejectionReasons[reason] ?? 0) + 1);

	const scored = [];
	for (const cell of areaCells) {
		const position = cell.centroid;
		if (input.islandAt(position) !== island) {
			reject('Outside the island outline');
			continue;
		}
		if (
			stops.some(
				(s) => haversineM(position, s.geometry.coordinates) < PLACEMENT_RULES.duplicateDistanceM
			)
		) {
			reject('Duplicates an existing stop');
			continue;
		}
		scored.push({
			id: cell.h3Index,
			position,
			...scoreBusStopCandidate(position, context, weights)
		});
	}

	scored.sort(
		(a, b) =>
			b.score - a.score || b.underservedReached - a.underservedReached || a.id.localeCompare(b.id)
	);

	const picks: typeof scored = [];
	for (const c of scored) {
		if (picks.length >= topN) break;
		const tooClose = picks.some(
			(p) => haversineM(p.position, c.position) < BUS_STOP_SCORING.minSeparationM
		);
		if (!tooClose) picks.push(c);
	}

	const areaPopulation = areaCells.reduce((s, c) => s + c.population, 0);
	const candidates: BusStopCandidate[] = picks.map((c, i) => ({
		id: c.id,
		rank: i + 1,
		position: c.position,
		island,
		atoll,
		score: c.score,
		expectedPopulationServed: c.expectedPopulationServed,
		underservedReached: c.underservedReached,
		estimatedAccessibilityGain: transportGain(areaCells, areaPopulation, input.infrastructure, {
			id: `candidate-${c.id}`,
			position: c.position,
			island
		}),
		criteria: c.criteria,
		penalties: c.penalties,
		positives: c.positives,
		tradeoffs: c.tradeoffs
	}));

	const area: CandidateArea = {
		centre: origin.centroid,
		originCell: origin.h3Index,
		island,
		radiusM,
		cellCount: areaCells.length,
		population: areaPopulation
	};
	return {
		area,
		candidates,
		evaluated: areaCells.length,
		rejected: areaCells.length - scored.length,
		rejectionReasons,
		weights
	};
}

/**
 * Population-weighted change in transport accessibility over the area if a stop is added at
 * the candidate, using the same model as the analytical grid.
 */
function transportGain(
	areaCells: readonly H3Cell[],
	areaPopulation: number,
	infrastructure: readonly InfrastructureFeature[],
	candidate: { id: string; position: Position; island: string }
): number {
	if (areaPopulation <= 0) return 0;
	const index = createAccessIndex([
		...infrastructure,
		{
			id: candidate.id,
			name: 'Candidate stop',
			type: 'bus_stop',
			status: 'proposed',
			geometry: { type: 'Point', coordinates: [...candidate.position] },
			source: { provenance: 'simulated', dataset: 'candidate', syntheticFields: [] },
			metadata: { island: candidate.island }
		}
	]);
	let weighted = 0;
	for (const cell of areaCells) {
		const after = calculateTransportAccessibility(
			{ position: cell.centroid, island: cell.island },
			index
		).score;
		weighted += (after - cell.transportAccessibility) * cell.population;
	}
	return weighted / areaPopulation;
}
