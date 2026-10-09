import { PLACEMENT_RULES } from '#lib/config/placement.ts';
import { INFRASTRUCTURE_TYPE_STYLES } from '#lib/config/infrastructure.ts';
import { haversineM, fromLocalM } from '#lib/analysis/geo.ts';
import { walkMinutes, walkRadiusM } from '#lib/analysis/walk.ts';
import type { ScoreBreakdown } from '#lib/types/analysis.ts';
import type { InfrastructureFeature, InfrastructureType, Position } from '#lib/types/domain.ts';

export type PlacementValidity = 'valid' | 'warning' | 'invalid';

export interface PlacementIssue {
	severity: 'warning' | 'blocking';
	message: string;
}

/**
 * Road proximity as observed on the map. 'unavailable' when no road data can be consulted
 * (zoomed out, or a basemap without roads); otherwise the nearest road distance, or null if
 * none lies within the search radius.
 */
export type RoadCheck =
	{ status: 'unavailable'; reason: string } | { status: 'checked'; distanceM: number | null };

export interface PlacementImpact {
	catchmentRadiusM: number;
	/** Residents in the catchment not already within the catchment of another same-type stop. */
	newPopulation: number;
	/** Mean walk to the nearest stop for residents in the catchment, before and after. */
	avgWalkBeforeMin: number;
	avgWalkAfterMin: number;
	/** Accessibility score the new facility would receive. */
	score: ScoreBreakdown;
}

export interface PlacementEvaluation {
	type: InfrastructureType;
	position: Position;
	validity: PlacementValidity;
	issues: readonly PlacementIssue[];
	island: string | null;
	atoll: string | null;
	impact: PlacementImpact | null;
	provenance: 'demo';
}

/** What a floating preview card needs: the verdict plus where the cursor is on screen. */
export interface PointerHover<E> {
	evaluation: E;
	/** Cursor position in map-container pixels. */
	point: { x: number; y: number };
	container: { width: number; height: number };
}
export type PlacementHover = PointerHover<PlacementEvaluation>;

/** Map-agnostic description of what a pointer tool draws under the cursor. */
export interface PreviewGeometry {
	type: InfrastructureType;
	position: Position;
	validity: PlacementValidity;
	catchmentRadiusM: number | null;
	/** Where the asset comes from, for move previews: drawn as a line to `position`. */
	origin: Position | null;
}

export interface PlacementContext {
	type: InfrastructureType;
	position: Position;
	/** Effective (scenario) facilities; disabled ones are ignored. */
	infrastructure: readonly InfrastructureFeature[];
	road: RoadCheck;
	/** Residents per km² on an island, or null when unknown. Demo fixture for now. */
	densityForIsland(island: string): number | null;
	/** Scores the candidate as if it existed. Injected so real analysis can replace the demo. */
	scoreCandidate(candidate: InfrastructureFeature): ScoreBreakdown;
	/** Facility to leave out of spacing and coverage checks (the one being moved). */
	excludeId?: string;
	/**
	 * Island containing a position, from island outlines. Optional: without it (or outside every
	 * outline) membership falls back to the nearest facility within `islandAssignRadiusM`.
	 */
	islandAt?(position: Position): string | null;
}

const PREVIEW_ID = '__placement-preview__';

function nearest(position: Position, features: readonly InfrastructureFeature[]) {
	let best: { feature: InfrastructureFeature; distanceM: number } | null = null;
	for (const feature of features) {
		const distanceM = haversineM(position, feature.geometry.coordinates);
		if (!best || distanceM < best.distanceM) best = { feature, distanceM };
	}
	return best;
}

/**
 * Coverage and walk-time change over a regular grid of sample points inside the catchment.
 * Deterministic numerical integration: every sample stands for an equal share of residents.
 */
function estimateImpact(
	position: Position,
	density: number,
	sameTypeOnIsland: readonly InfrastructureFeature[]
): Omit<PlacementImpact, 'score'> {
	const r = walkRadiusM(PLACEMENT_RULES.catchmentMinutes);
	const n = PLACEMENT_RULES.sampleGridSize;
	const cap = PLACEMENT_RULES.noStopWalkCapMinutes;
	let inside = 0;
	let uncovered = 0;
	let before = 0;
	let after = 0;
	for (let i = 0; i < n; i++) {
		for (let j = 0; j < n; j++) {
			const x = -r + ((i + 0.5) * 2 * r) / n;
			const y = -r + ((j + 0.5) * 2 * r) / n;
			const toCandidate = Math.hypot(x, y);
			if (toCandidate > r) continue;
			inside++;
			const sample = fromLocalM(position, [x, y]);
			const toExisting = nearest(sample, sameTypeOnIsland)?.distanceM ?? Infinity;
			if (toExisting > r) uncovered++;
			const walkBefore = Math.min(cap, walkMinutes(toExisting));
			before += walkBefore;
			after += Math.min(walkBefore, walkMinutes(toCandidate));
		}
	}
	const areaKm2 = (Math.PI * r * r) / 1_000_000;
	return {
		catchmentRadiusM: r,
		newPopulation: inside === 0 ? 0 : density * areaKm2 * (uncovered / inside),
		avgWalkBeforeMin: inside === 0 ? 0 : before / inside,
		avgWalkAfterMin: inside === 0 ? 0 : after / inside
	};
}

/** Builds the facility a placement would create. Deterministic for a given position. */
export function candidateFeature(
	type: InfrastructureType,
	position: Position,
	island: string | null,
	atoll: string | null,
	id = PREVIEW_ID
): InfrastructureFeature {
	return {
		id,
		name: `Proposed ${INFRASTRUCTURE_TYPE_STYLES[type].label.toLowerCase()}`,
		type,
		status: 'proposed',
		geometry: { type: 'Point', coordinates: [position[0], position[1]] },
		source: { provenance: 'simulated', dataset: 'placement-preview', syntheticFields: [] },
		metadata: { ...(island ? { island } : {}), ...(atoll ? { atoll } : {}) }
	};
}

/**
 * Validates a proposed position and estimates its impact. Pure and deterministic: identical
 * inputs give identical output, so the preview never flickers between equal cursor positions.
 */
export function evaluatePlacement(ctx: PlacementContext): PlacementEvaluation {
	const rules = PLACEMENT_RULES;
	const active = ctx.infrastructure.filter(
		(f) => f.status !== 'disabled' && f.id !== ctx.excludeId
	);
	const issues: PlacementIssue[] = [];
	const typeLabel = INFRASTRUCTURE_TYPE_STYLES[ctx.type].label.toLowerCase();

	const anchor = nearest(ctx.position, active);
	const onIsland = anchor && anchor.distanceM <= rules.islandAssignRadiusM ? anchor.feature : null;
	const outlineIsland = ctx.islandAt?.(ctx.position) ?? null;
	const island =
		outlineIsland ??
		(typeof onIsland?.metadata.island === 'string' ? onIsland.metadata.island : null);
	// Atoll is not part of the outlines; take it from any facility on the same island.
	const sameIslandFacility = active.find((f) => f.metadata.island === island);
	const atollValue = sameIslandFacility?.metadata.atoll;
	const atoll = island && typeof atollValue === 'string' ? atollValue : null;
	if (!island) {
		issues.push({ severity: 'blocking', message: 'Outside the mapped islands.' });
	}

	// Only stops and terminals must front a road; other facilities just need to be on an island.
	const needsRoad = rules.roadRequiredTypes.includes(ctx.type);
	if (needsRoad && ctx.road.status === 'unavailable') {
		issues.push({ severity: 'warning', message: `Road check skipped: ${ctx.road.reason}.` });
	} else if (
		needsRoad &&
		ctx.road.status === 'checked' &&
		(ctx.road.distanceM === null || ctx.road.distanceM > rules.maxRoadDistanceM)
	) {
		issues.push({
			severity: 'blocking',
			message: `No mapped road within ${rules.maxRoadDistanceM} m.`
		});
	}

	const sameType = active.filter((f) => f.type === ctx.type);
	const closest = nearest(ctx.position, sameType);
	if (closest && closest.distanceM < rules.duplicateDistanceM) {
		issues.push({
			severity: 'blocking',
			message: `Duplicates ${closest.feature.name} (${Math.round(closest.distanceM)} m away).`
		});
	} else if (closest && closest.distanceM < rules.spacingWarningM[ctx.type]) {
		issues.push({
			severity: 'warning',
			message: `Within ${rules.spacingWarningM[ctx.type]} m of ${closest.feature.name} (${Math.round(closest.distanceM)} m); catchments overlap.`
		});
	}

	let impact: PlacementImpact | null = null;
	if (island) {
		const density = ctx.densityForIsland(island) ?? 0;
		const sameIsland = sameType.filter((f) => f.metadata.island === island);
		const estimate = estimateImpact(ctx.position, density, sameIsland);
		const candidate = candidateFeature(ctx.type, ctx.position, island, atoll);
		impact = { ...estimate, score: ctx.scoreCandidate(candidate) };
		if (estimate.newPopulation < rules.lowGainPopulation) {
			issues.push({
				severity: 'warning',
				message: `Adds few residents not already near a ${typeLabel}.`
			});
		}
	}

	const validity: PlacementValidity = issues.some((i) => i.severity === 'blocking')
		? 'invalid'
		: issues.length > 0
			? 'warning'
			: 'valid';

	return {
		type: ctx.type,
		position: ctx.position,
		validity,
		issues,
		island,
		atoll,
		impact,
		provenance: 'demo'
	};
}

/** Next default name for a placed facility, e.g. "Proposed bus stop 3". */
export function proposedName(
	type: InfrastructureType,
	infrastructure: readonly InfrastructureFeature[]
): string {
	const count = infrastructure.filter((f) => f.type === type && f.status === 'proposed').length;
	return `Proposed ${INFRASTRUCTURE_TYPE_STYLES[type].label.toLowerCase()} ${count + 1}`;
}
