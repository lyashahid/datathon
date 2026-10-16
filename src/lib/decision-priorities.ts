import {
	policyDomains,
	type OpportunityIsland,
	type PolicyDomain
} from './policy-opportunities.js';

export interface DecisionPriority {
	domain: PolicyDomain;
	kind: 'review' | 'evidence' | 'no_flag';
	island: OpportunityIsland | null;
	islandCount: number;
	tied: boolean;
}

/** One starting point per service. Unknown observations never become a measured deficit. */
export function decisionPriorities(islands: OpportunityIsland[]): DecisionPriority[] {
	return policyDomains.map((domain) => {
		const reviews = islands.filter((island) => {
			const evidence = island.domains[domain];
			return (
				evidence.status === 'review' &&
				evidence.mapped_count > 0 &&
				evidence.score !== null &&
				Number.isFinite(evidence.score)
			);
		});
		const unknowns = islands.filter((island) => {
			const evidence = island.domains[domain];
			return (
				evidence.status === 'unknown' ||
				evidence.mapped_count === 0 ||
				evidence.score === null ||
				!Number.isFinite(evidence.score)
			);
		});
		const kind = reviews.length ? 'review' : unknowns.length ? 'evidence' : 'no_flag';
		const candidates = kind === 'review' ? reviews : unknowns;
		const sorted = [...candidates].sort((first, second) => {
			const difference =
				kind === 'review'
					? (first.domains[domain].score ?? 0) - (second.domains[domain].score ?? 0)
					: 0;
			return (
				difference ||
				first.name.localeCompare(second.name) ||
				first.island_id.localeCompare(second.island_id)
			);
		});
		const first = sorted[0] ?? null;
		return {
			domain,
			kind,
			island: first,
			islandCount: candidates.length,
			tied:
				kind === 'review' &&
				first !== null &&
				sorted.filter((island) => island.domains[domain].score === first.domains[domain].score)
					.length > 1
		};
	});
}
