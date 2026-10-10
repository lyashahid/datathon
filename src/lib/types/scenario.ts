import type { DisruptionId } from './disruption.ts';
import type { BusStopWeights } from '#lib/config/busStopScoring.ts';
import type {
	AssetRef,
	InfrastructureFeature,
	InfrastructureId,
	Position,
	RouteId,
	TransportRoute
} from './domain.ts';

export type ScenarioId = string;
export type ScenarioChangeId = string;

interface ChangeBase {
	id: ScenarioChangeId;
	/** ISO 8601 timestamp. */
	createdAt: string;
	note?: string;
}

/**
 * A scenario is an ordered list of changes applied on top of the immutable baseline.
 * Changes never edit baseline records; they are replayed to derive the scenario view.
 */
export type ScenarioChange =
	| (ChangeBase & {
			kind: 'add';
			/** A new asset that exists only in this scenario; its status is 'proposed'. */
			feature: InfrastructureFeature;
	  })
	| (ChangeBase & {
			kind: 'move';
			target: { kind: 'infrastructure'; id: InfrastructureId };
			from: Position;
			to: Position;
	  })
	| (ChangeBase & {
			/** Out of service but still present (e.g. a closed terminal or suspended route). */
			kind: 'disable';
			target: AssetRef;
	  })
	| (ChangeBase & {
			/**
			 * Withdraws a proposal added earlier in the same scenario. Baseline assets cannot be
			 * removed (they exist in the real world); disable them instead.
			 */
			kind: 'remove';
			target: AssetRef;
	  })
	| (ChangeBase & {
			/** Reverts an earlier disable or remove of the same target. */
			kind: 'restore';
			target: AssetRef;
	  });

export interface Scenario {
	id: ScenarioId;
	name: string;
	description: string;
	changes: readonly ScenarioChange[];
	/** How this scenario's analyses are tuned. Not a change to infrastructure, so not undoable. */
	analysisSettings?: ScenarioAnalysisSettings;
	/** ISO 8601 timestamps. */
	createdAt: string;
	updatedAt: string;
}

export interface ScenarioAnalysisSettings {
	/** Planner priorities for bus-stop candidate ranking (any non-negative values; normalised). */
	busStopWeights?: BusStopWeights;
	/** Planning disruption applied to every accessibility score; absent means normal operations. */
	disruption?: DisruptionId;
}

/** How the effective version of an asset differs from the baseline. */
export interface AssetDelta {
	/** 'scenario' when the asset was added by this scenario. */
	origin: 'baseline' | 'scenario';
	moved: boolean;
	/** Baseline position before any moves; only set when moved. */
	originalPosition?: Position;
	statusChanged: boolean;
	/** Changes that touched this asset, in application order. */
	changeIds: readonly ScenarioChangeId[];
}

/** A change that could not be applied (e.g. its target no longer exists). It is skipped. */
export interface ScenarioIssue {
	changeId: ScenarioChangeId;
	message: string;
}

/** Baseline + ordered changes, resolved. Read-only; recomputed whenever the changes change. */
export interface EffectiveState {
	infrastructure: readonly InfrastructureFeature[];
	routes: readonly TransportRoute[];
	/** Only assets that differ from the baseline appear here. */
	infrastructureDeltas: ReadonlyMap<InfrastructureId, AssetDelta>;
	routeDeltas: ReadonlyMap<RouteId, AssetDelta>;
	issues: readonly ScenarioIssue[];
	getInfrastructure(id: InfrastructureId): InfrastructureFeature | undefined;
	getRoute(id: RouteId): TransportRoute | undefined;
	/** Active (non-disabled) routes stopping at a facility. */
	routesServing(id: InfrastructureId): readonly TransportRoute[];
}
