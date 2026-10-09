import { haversineM } from '#lib/analysis/geo.ts';
import type { ScoreBreakdown } from '#lib/types/analysis.ts';
import type { InfrastructureFeature, Position } from '#lib/types/domain.ts';
import {
	evaluatePlacement,
	type PlacementContext,
	type PlacementIssue,
	type PlacementValidity
} from './placement.ts';

export interface MoveEvaluation {
	featureId: string;
	type: InfrastructureFeature['type'];
	from: Position;
	position: Position;
	distanceM: number;
	validity: PlacementValidity;
	issues: readonly PlacementIssue[];
	/** Catchment drawn around the new position, when the type has one. */
	catchmentRadiusM: number | null;
	scoreBefore: ScoreBreakdown;
	/** Null when the destination is invalid. */
	scoreAfter: ScoreBreakdown | null;
	provenance: 'demo';
}

export interface MoveContext extends Omit<PlacementContext, 'type' | 'position' | 'excludeId'> {
	feature: InfrastructureFeature;
	to: Position;
	/** Current score of the facility where it stands now. */
	scoreBefore: ScoreBreakdown;
}

/**
 * Validates moving an existing facility, reusing placement rules while ignoring the facility
 * itself (it cannot duplicate or crowd its own old position). Cross-island moves are blocked:
 * island membership drives catchments, and changing it would need a new facility instead.
 */
export function evaluateMove(ctx: MoveContext): MoveEvaluation {
	const { feature, to } = ctx;
	const placement = evaluatePlacement({
		...ctx,
		type: feature.type,
		position: to,
		excludeId: feature.id
	});

	const issues: PlacementIssue[] = [...placement.issues];
	const fromIsland = feature.metadata.island;
	if (placement.island && fromIsland && placement.island !== fromIsland) {
		issues.unshift({
			severity: 'blocking',
			message: `Would move it from ${fromIsland} to ${placement.island}; place a new facility instead.`
		});
	}
	const blocked = issues.some((i) => i.severity === 'blocking');
	const validity: PlacementValidity = blocked
		? 'invalid'
		: issues.some((i) => i.severity === 'warning')
			? 'warning'
			: 'valid';

	return {
		featureId: feature.id,
		type: feature.type,
		from: feature.geometry.coordinates,
		position: to,
		distanceM: haversineM(feature.geometry.coordinates, to),
		validity,
		issues,
		catchmentRadiusM: placement.impact?.catchmentRadiusM ?? null,
		scoreBefore: ctx.scoreBefore,
		scoreAfter: blocked
			? null
			: ctx.scoreCandidate({
					...feature,
					geometry: { type: 'Point', coordinates: [to[0], to[1]] }
				}),
		provenance: 'demo'
	};
}
