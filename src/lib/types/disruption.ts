/** Assumptions about the transport system that the accessibility model takes as given. */
export interface AccessConditions {
	/** Whether a facility on another island can be reached by ferry at all. */
	seaCrossingAvailable: boolean;
	/** Distance-equivalent of one sea crossing (waiting + sailing), added to walking legs. */
	seaCrossingEquivalentM: number;
	/** Whether ferry terminals count as local transport access points. */
	ferryTerminalsInService: boolean;
}

export type DisruptionId = 'normal' | 'moderateMarine' | 'severeMarine';

/** A named planning scenario: explicit, hand-chosen assumptions, never inferred from data. */
export interface DisruptionScenario {
	id: DisruptionId;
	label: string;
	shortLabel: string;
	summary: string;
	/** Plain-language list of what the scenario assumes, shown verbatim to users. */
	assumptions: readonly string[];
	/** Sea state this scenario is meant to represent; descriptive only, not a live trigger. */
	representativeConditions: string;
	conditions: AccessConditions;
}
