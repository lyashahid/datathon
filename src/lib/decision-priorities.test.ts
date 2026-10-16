import { describe, expect, it } from 'vitest';
import { decisionPriorities } from './decision-priorities.js';
import { scopeOpportunities, type OpportunityIsland } from './policy-opportunities.js';

function island(name: string, score: number | null = 20): OpportunityIsland {
	return {
		island_id: `island:${name}`,
		name,
		atoll: 'North',
		category: 'Residential Island',
		coordinates: [73, 4],
		population: null,
		population_status: 'unavailable',
		population_basis: 'Unavailable',
		planning_supported: false,
		priority_score: null,
		priority_domain: null,
		domains: {
			transport: { score, status: 'review', mapped_count: 2, reasons: [] },
			health: { score, status: 'review', mapped_count: 2, reasons: [] },
			education: { score, status: 'review', mapped_count: 2, reasons: [] }
		},
		reasons: [],
		missing_data: []
	};
}

describe('decision priorities', () => {
	it('selects the weakest known availability for each service without mutating input', () => {
		const stronger = island('Stronger', 45);
		const weaker = island('Weaker', 10);
		weaker.domains.education.score = 55;
		const rows = [stronger, weaker];
		const priorities = decisionPriorities(rows);
		expect(priorities.map((priority) => priority.island?.name)).toEqual([
			'Weaker',
			'Weaker',
			'Stronger'
		]);
		expect(rows[0]).toBe(stronger);
		expect(priorities.every((priority) => priority.kind === 'review')).toBe(true);
	});
	it('does not turn absent mappings or invalid scores into a proven deficit', () => {
		const missing = island('Missing', null);
		missing.domains.health.mapped_count = 0;
		missing.domains.health.score = 0;
		missing.domains.education.score = Number.NaN;
		expect(decisionPriorities([missing]).map((priority) => priority.kind)).toEqual([
			'evidence',
			'evidence',
			'evidence'
		]);
	});
	it('prefers a known review signal over a worse-looking unknown score', () => {
		const known = island('Known', 35);
		const unknown = island('Unknown', 0);
		unknown.domains.transport.status = 'unknown';
		expect(decisionPriorities([unknown, known])[0]).toMatchObject({
			kind: 'review',
			island: known,
			islandCount: 1
		});
	});
	it('flags equal screening results and resolves ties consistently by name', () => {
		const result = decisionPriorities([island('Zeta'), island('Alpha')])[0];
		expect(result.tied).toBe(true);
		expect(result.island?.name).toBe('Alpha');
		expect(result.islandCount).toBe(2);
	});
	it('keeps evidence tasks inside the selected atoll and island cohort', () => {
		const current = island('Current', null);
		const other = { ...island('Other'), atoll: 'South' };
		const resort = { ...island('Resort'), category: 'Tourist Resort' };
		const scoped = scopeOpportunities([current, other, resort], 'North', 'residential');
		expect(decisionPriorities(scoped)[0]).toMatchObject({ kind: 'evidence', island: current });
	});
	it('does not invent actions when there are no flags or no islands', () => {
		const strong = island('Strong', 90);
		for (const domain of Object.values(strong.domains)) domain.status = 'stronger_evidence';
		expect(decisionPriorities([strong])[0]).toMatchObject({
			kind: 'no_flag',
			island: null,
			islandCount: 0
		});
		expect(decisionPriorities([]).every((priority) => priority.island === null)).toBe(true);
	});
});
