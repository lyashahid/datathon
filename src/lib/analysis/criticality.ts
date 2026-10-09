import { CRITICALITY_BANDS, CRITICALITY_TYPES } from '#lib/config/criticality.ts';
import { NORMAL_CONDITIONS } from '#lib/config/disruptionScenarios.ts';
import type { AccessConditions } from '#lib/types/disruption.ts';
import type {
	CellExposure,
	CriticalityBand,
	CriticalityResult,
	FacilityCriticality
} from '#lib/types/criticality.ts';
import type { InfrastructureFeature } from '#lib/types/domain.ts';
import type { H3BaseCell, H3Grid, H3Index } from '#lib/types/h3.ts';
import { formatDistance, formatPopulation } from '#lib/utils/format.ts';
import { haversineM } from './geo.ts';
import { buildAccessibilityGrid } from './h3Grid.ts';
import { compareGrids } from './impact.ts';

export function criticalityBand(averagePointsLost: number): CriticalityBand {
	return (
		CRITICALITY_BANDS.find((b) => averagePointsLost >= b.minPoints) ?? CRITICALITY_BANDS.at(-1)!
	).band;
}

function nearestAlternative(feature: InfrastructureFeature, all: readonly InfrastructureFeature[]) {
	let best: FacilityCriticality['nearestAlternative'] = null;
	for (const f of all) {
		if (f.id === feature.id || f.type !== feature.type || f.status === 'disabled') continue;
		const distanceM = haversineM(feature.geometry.coordinates, f.geometry.coordinates);
		if (!best || distanceM < best.distanceM) best = { id: f.id, name: f.name, distanceM };
	}
	return best;
}

function explain(c: Omit<FacilityCriticality, 'explanation' | 'rank'>): string[] {
	if (c.residentsAffected === 0 && c.averagePointsLost < 0.05) {
		return ['Closing it changes almost nothing: nearby facilities cover the same residents.'];
	}
	const lines = [
		`If closed, ${formatPopulation(c.residentsAffected)} residents would lose accessibility (largest single-area drop: ${Math.round(c.maxCellDrop)} points).`
	];
	if (c.underservedIncrease >= 1) {
		lines.push(`Underserved residents would rise by ${formatPopulation(c.underservedIncrease)}.`);
	}
	lines.push(
		c.nearestAlternative
			? `Nearest alternative: ${c.nearestAlternative.name}, ${formatDistance(c.nearestAlternative.distanceM)} away.`
			: 'There is no other facility of this type in the study area.'
	);
	return lines;
}

/**
 * Single-closure criticality: for every active facility the model scores, recompute the grid
 * with only that facility disabled and compare against `current`. Deterministic; ~1 ms per
 * grid at demo scale, so the full sweep is cheap enough to run on demand.
 */
export function assessCriticality(
	base: readonly H3BaseCell[],
	infrastructure: readonly InfrastructureFeature[],
	current: H3Grid,
	conditions: AccessConditions = NORMAL_CONDITIONS
): CriticalityResult {
	const totalPopulation = current.totals.population || 1;
	const exposure = new Map<H3Index, CellExposure>();
	const assessed: Omit<FacilityCriticality, 'rank'>[] = [];

	for (const feature of infrastructure) {
		if (feature.status === 'disabled' || !CRITICALITY_TYPES.includes(feature.type)) continue;
		const without = infrastructure.map((f) =>
			f.id === feature.id ? { ...f, status: 'disabled' as const } : f
		);
		const impact = compareGrids(current, buildAccessibilityGrid(base, without, conditions));

		let personPoints = 0;
		let maxCellDrop = 0;
		for (const cell of impact.cells) {
			const drop = Math.max(0, -cell.delta.overall);
			personPoints += drop * cell.population.total;
			maxCellDrop = Math.max(maxCellDrop, drop);
			const prev = exposure.get(cell.h3Index);
			if (
				drop > 0 &&
				(!prev || drop > prev.drop || (drop === prev.drop && feature.id < prev.featureId))
			) {
				exposure.set(cell.h3Index, { drop, featureId: feature.id });
			}
		}
		const averagePointsLost = personPoints / totalPopulation;
		const partial = {
			featureId: feature.id,
			name: feature.name,
			type: feature.type,
			band: criticalityBand(averagePointsLost),
			averagePointsLost,
			residentsAffected: impact.summary.losing.total,
			underservedIncrease: Math.max(0, impact.summary.underservedPopulation.delta),
			maxCellDrop,
			nearestAlternative: nearestAlternative(feature, infrastructure)
		};
		assessed.push({ ...partial, explanation: explain(partial) });
	}

	const facilities = assessed
		.sort(
			(a, b) =>
				b.averagePointsLost - a.averagePointsLost ||
				b.residentsAffected - a.residentsAffected ||
				a.featureId.localeCompare(b.featureId)
		)
		.map((f, i): FacilityCriticality => ({ ...f, rank: i + 1 }));
	const byId = new Map(facilities.map((f) => [f.featureId, f]));
	return { facilities, get: (id) => byId.get(id), exposure };
}
