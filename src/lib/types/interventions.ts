/** Kinds of intervention the gap rules can point to. Types only — never specific sites. */
export type InterventionType =
	| 'add_bus_stop'
	| 'improve_healthcare_access'
	| 'improve_school_access'
	| 'investigate_ferry_connectivity';

/** A metric value that caused a rule to fire, with the condition it met. */
export interface InterventionTrigger {
	metric: string;
	value: string;
	condition: string;
}

export type RelevanceBand = 'high' | 'medium' | 'low';

/** A potential intervention suggested for evaluation; not an authoritative recommendation. */
export interface InterventionSuggestion {
	type: InterventionType;
	title: string;
	/** 0–100, from how far the metric falls short and how many residents are represented. */
	relevance: number;
	band: RelevanceBand;
	reasons: readonly string[];
	triggers: readonly InterventionTrigger[];
	/** How relevance was formed, in words. */
	relevanceBasis: string;
}
