import { describe, expect, it } from 'vitest';
import {
	opportunityMatches,
	opportunityStatusCounts,
	scopeOpportunities,
	sortOpportunities,
	variedOpportunityScores,
	type OpportunityIsland
} from './policy-opportunities.js';

function island(
	name: string,
	score: number | null,
	status: 'review' | 'unknown' = 'review'
): OpportunityIsland {
	return {
		island_id: name,
		name,
		atoll: 'North',
		category: 'Residential Island',
		coordinates: null,
		population: null,
		population_status: 'unavailable',
		population_basis: 'No resident evidence',
		planning_supported: false,
		priority_score: score,
		priority_domain: 'transport',
		domains: {
			transport: { score, status, mapped_count: 0, reasons: [] },
			health: { score: null, status: 'unknown', mapped_count: 0, reasons: [] },
			education: { score: null, status: 'unknown', mapped_count: 0, reasons: [] }
		},
		reasons: [],
		missing_data: []
	};
}

describe('policy opportunity comparisons', () => {
	it('keeps missing evidence separate from review signals and from stronger evidence', () => {
		const review = island('Review', 70);
		const unknown = island('Unknown', null, 'unknown');
		const stronger = island('Stronger', 10);
		stronger.domains.transport.status = 'stronger_evidence';
		expect(opportunityStatusCounts([review, unknown, stronger], 'transport')).toEqual({
			review: 1,
			stronger_evidence: 1,
			unknown: 1
		});
		expect(opportunityMatches(unknown, 'transport', 'review')).toBe(false);
		expect(opportunityMatches(unknown, 'transport', 'unknown')).toBe(true);
		expect(unknown.population).toBeNull();
	});
	it('intersects atoll and residential scope without mutating the supplied snapshot', () => {
		const first = island('A', 50);
		const second = { ...island('B', 60), atoll: 'South' };
		const resort = { ...island('C', 70), category: 'Tourist Resort' };
		expect(scopeOpportunities([first, second, resort], 'North', 'residential')).toEqual([first]);
		expect(scopeOpportunities([first, second, resort], 'all', 'all')).toHaveLength(3);
	});
	it('does not manufacture ranks for equal or unavailable scores', () => {
		const rows = [island('Zeta', 0), island('Alpha', 0), island('Beta', null)];
		expect(variedOpportunityScores(rows, 'overall')).toBe(false);
		expect(sortOpportunities(rows, 'overall').map((row) => row.name)).toEqual([
			'Alpha',
			'Beta',
			'Zeta'
		]);
		expect(rows[0].name).toBe('Zeta');
	});
	it('ranks comparable scores in the selected sector and leaves unknowns last', () => {
		const rows = [island('A', 20), island('B', 75), island('C', null)];
		expect(variedOpportunityScores(rows, 'transport')).toBe(true);
		expect(sortOpportunities(rows, 'transport').map((row) => row.name)).toEqual(['A', 'B', 'C']);
		expect(variedOpportunityScores(rows, 'health')).toBe(false);
	});
});
