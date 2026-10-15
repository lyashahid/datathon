import type { MapFeatures } from './types.js';

export type PolicyLens = 'overall' | 'transport' | 'health' | 'education';
export type PolicyDomain = Exclude<PolicyLens, 'overall'>;
export type OpportunityStatus = 'review' | 'stronger_evidence' | 'unknown';

export interface OpportunityDomain {
	/** Availability index: higher means stronger modeled availability, not a larger gap. */
	score: number | null;
	status: OpportunityStatus;
	mapped_count: number;
	reasons: string[];
}

export interface OpportunityIsland {
	island_id: string;
	name: string;
	atoll: string;
	category: string;
	coordinates: [number, number] | null;
	population: number | null;
	population_status: string;
	population_basis: string;
	planning_supported: boolean;
	priority_score: number | null;
	priority_domain: PolicyDomain | null;
	domains: Record<PolicyDomain, OpportunityDomain>;
	reasons: string[];
	missing_data: string[];
}

export interface PolicyOpportunities {
	version: string;
	reference_date: string | null;
	summary: {
		island_count: number;
		known_population_islands: number;
		review_islands: number;
		supported_planning_islands: number;
		known_residents: number;
	};
	islands: OpportunityIsland[];
	features: MapFeatures;
	method: unknown;
	warnings: string[];
	source_receipts: unknown;
}

export const policyDomainLabels: Record<PolicyDomain, string> = {
	transport: 'Transport',
	health: 'Health',
	education: 'Education'
};

export const policyDomains: PolicyDomain[] = ['transport', 'health', 'education'];

export function scopeOpportunities(
	islands: OpportunityIsland[],
	atoll: string,
	cohort: string
): OpportunityIsland[] {
	return islands.filter(
		(island) =>
			(atoll === 'all' || island.atoll === atoll) &&
			(cohort === 'all' || island.category === 'Residential Island')
	);
}

export function opportunityStatusCounts(islands: OpportunityIsland[], domain: PolicyDomain) {
	const counts: Record<OpportunityStatus, number> = {
		review: 0,
		stronger_evidence: 0,
		unknown: 0
	};
	for (const island of islands) counts[island.domains[domain].status]++;
	return counts;
}

/** A missing observation is an evidence task, never an observed service failure. */
export function opportunityMatches(
	island: OpportunityIsland,
	lens: PolicyLens,
	status: 'review' | 'unknown'
): boolean {
	return (lens === 'overall' ? policyDomains : [lens]).some(
		(domain) => island.domains[domain].status === status
	);
}

export function opportunityScore(island: OpportunityIsland, lens: PolicyLens): number | null {
	const availability = lens === 'overall' ? null : island.domains[lens].score;
	const score =
		lens === 'overall' ? island.priority_score : availability === null ? null : 100 - availability;
	return score !== null && Number.isFinite(score) ? score : null;
}

/** Do not imply a ranking when every candidate has the same screening result. */
export function variedOpportunityScores(islands: OpportunityIsland[], lens: PolicyLens): boolean {
	return (
		new Set(
			islands.flatMap((island) => {
				const score = opportunityScore(island, lens);
				return score === null ? [] : [score];
			})
		).size > 1
	);
}

export function sortOpportunities(islands: OpportunityIsland[], lens: PolicyLens) {
	const rank = variedOpportunityScores(islands, lens);
	return [...islands].sort((first, second) => {
		if (rank) {
			const difference =
				(opportunityScore(second, lens) ?? -1) - (opportunityScore(first, lens) ?? -1);
			if (difference) return difference;
		}
		return first.name.localeCompare(second.name) || first.island_id.localeCompare(second.island_id);
	});
}
