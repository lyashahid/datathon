import type { InfrastructureId, Position } from './domain.ts';

export const OBSERVATION_TYPES = [
	'congestion',
	'flooding',
	'unsafe_crossing',
	'road_damage',
	'bus_overcrowding',
	'ferry_reliability',
	'poor_pedestrian_access',
	'other'
] as const;
export type ObservationType = (typeof OBSERVATION_TYPES)[number];

/** A located, user-reported condition. Unverified local knowledge, never a model input. */
export interface Observation {
	id: string;
	type: ObservationType;
	position: Position;
	description: string;
	/** ISO 8601. */
	createdAt: string;
}

export type NewObservation = Omit<Observation, 'id' | 'createdAt'>;

export const FEEDBACK_KINDS = ['support', 'concern', 'comment'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** Community response to one facility, typically a proposed one. Kept apart from any score. */
export interface InfrastructureFeedback {
	id: string;
	featureId: InfrastructureId;
	kind: FeedbackKind;
	/** Optional for support/concern, required for a comment. */
	text: string;
	createdAt: string;
}

export type NewFeedback = Omit<InfrastructureFeedback, 'id' | 'createdAt'>;

export interface FeedbackSummary {
	support: number;
	concern: number;
	comment: number;
	/** support / (support + concern), or null when nobody has taken a side. */
	supportShare: number | null;
}

/**
 * Storage boundary for local knowledge. The MVP backs it with browser storage; a server or
 * database implementation can replace it without touching callers.
 */
export interface ObservationRepository {
	list(): Promise<readonly Observation[]>;
	add(input: NewObservation): Promise<Observation>;
	remove(id: string): Promise<void>;
}

export interface FeedbackRepository {
	list(): Promise<readonly InfrastructureFeedback[]>;
	add(input: NewFeedback): Promise<InfrastructureFeedback>;
}
