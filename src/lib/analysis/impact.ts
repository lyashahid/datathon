import { IMPACT_CONFIG } from '#lib/config/impact.ts';
import type { Position } from '#lib/types/domain.ts';
import type { H3Cell, H3Grid } from '#lib/types/h3.ts';
import type {
	CellImpact,
	CellScores,
	GridImpact,
	ImpactDirection,
	ImpactSummary,
	LocalImpact,
	MetricChange,
	PopulationSplit
} from '#lib/types/impact.ts';
import { haversineM } from './geo.ts';

const scoresOf = (c: H3Cell): CellScores => ({
	transport: c.transportAccessibility,
	health: c.healthAccessibility,
	education: c.educationAccessibility,
	overall: c.overallAccessibility,
	underserved: c.underservedPopulation
});

const splitOf = (c: H3Cell): PopulationSplit => ({
	total: c.population,
	children: c.children,
	workingAge: c.workingAge,
	olderPopulation: c.olderPopulation
});

const EMPTY_SPLIT: PopulationSplit = { total: 0, children: 0, workingAge: 0, olderPopulation: 0 };

function addSplit(a: PopulationSplit, b: PopulationSplit): PopulationSplit {
	return {
		total: a.total + b.total,
		children: a.children + b.children,
		workingAge: a.workingAge + b.workingAge,
		olderPopulation: a.olderPopulation + b.olderPopulation
	};
}

export function classifyChange(
	overallDelta: number,
	thresholdPoints: number = IMPACT_CONFIG.changeThresholdPoints
): ImpactDirection {
	if (overallDelta >= thresholdPoints) return 'improved';
	if (overallDelta <= -thresholdPoints) return 'worsened';
	return 'unchanged';
}

/** Aggregates any subset of compared cells. Averages are weighted by residents. */
export function summarizeImpact(
	cells: readonly CellImpact[],
	thresholdPoints: number = IMPACT_CONFIG.changeThresholdPoints
): ImpactSummary {
	const population = cells.reduce((s, c) => s + c.population.total, 0);
	const weighted = (pick: (s: CellScores) => number, side: 'before' | 'after') =>
		population === 0
			? 0
			: cells.reduce((s, c) => s + pick(c[side]) * c.population.total, 0) / population;
	const change = (pick: (s: CellScores) => number): MetricChange => {
		const before = weighted(pick, 'before');
		const after = weighted(pick, 'after');
		return { before, after, delta: after - before };
	};
	const sum = (pick: (s: CellScores) => number): MetricChange => {
		const before = cells.reduce((s, c) => s + pick(c.before), 0);
		const after = cells.reduce((s, c) => s + pick(c.after), 0);
		return { before, after, delta: after - before };
	};
	const improved = cells.filter((c) => c.direction === 'improved');
	const worsened = cells.filter((c) => c.direction === 'worsened');

	return {
		cellsCompared: cells.length,
		cellsImproved: improved.length,
		cellsWorsened: worsened.length,
		transport: change((s) => s.transport),
		health: change((s) => s.health),
		education: change((s) => s.education),
		overall: change((s) => s.overall),
		underservedPopulation: sum((s) => s.underserved),
		benefiting: improved.reduce((s, c) => addSplit(s, c.population), EMPTY_SPLIT),
		losing: worsened.reduce((s, c) => addSplit(s, c.population), EMPTY_SPLIT),
		thresholdPoints
	};
}

/**
 * Compares a scenario grid with the baseline grid cell by cell. Both grids must come from the
 * same demographic cells; only infrastructure differs, so every delta is attributable to the
 * scenario's changes. Pure and deterministic.
 */
export function compareGrids(
	baseline: H3Grid,
	scenario: H3Grid,
	thresholdPoints: number = IMPACT_CONFIG.changeThresholdPoints
): GridImpact {
	const cells: CellImpact[] = [];
	let hasChanges = false;
	for (const before of baseline.cells) {
		const after = scenario.get(before.h3Index);
		if (!after) continue;
		const b = scoresOf(before);
		const a = scoresOf(after);
		const delta: CellScores = {
			transport: a.transport - b.transport,
			health: a.health - b.health,
			education: a.education - b.education,
			overall: a.overall - b.overall,
			underserved: a.underserved - b.underserved
		};
		if (Object.values(delta).some((d) => d !== 0)) hasChanges = true;
		cells.push({
			h3Index: before.h3Index,
			island: before.island,
			centroid: before.centroid,
			population: splitOf(before),
			before: b,
			after: a,
			delta,
			direction: classifyChange(delta.overall, thresholdPoints)
		});
	}
	const byIndex = new Map(cells.map((c) => [c.h3Index, c]));
	return {
		hasChanges,
		summary: summarizeImpact(cells, thresholdPoints),
		cells,
		get: (h) => byIndex.get(h)
	};
}

/**
 * Impact on residents near a facility. Moved facilities include both their old and new
 * neighbourhoods, since residents near either can be affected.
 */
export function localImpact(
	impact: GridImpact,
	featureId: string,
	centres: readonly Position[],
	radiusM: number = IMPACT_CONFIG.localImpactRadiusM
): LocalImpact {
	const near = impact.cells.filter((c) =>
		centres.some((p) => haversineM(p, c.centroid) <= radiusM)
	);
	return {
		featureId,
		radiusM,
		centres,
		summary: summarizeImpact(near, impact.summary.thresholdPoints)
	};
}
