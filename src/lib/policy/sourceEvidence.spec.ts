import { describe, expect, it } from 'vitest';
import { sourceEvidence, supportedPolicyDates } from './sourceEvidence.ts';
import type { PlanningBaseline } from '../planning/types.ts';
describe('source dates mean what they say', () => {
	it('never substitutes a collection date for the source reference period', () => {
		const result = sourceEvidence({
			id: 's',
			fetchedAt: '2026-10-11'
		} as import('../planning/types.ts').PlanningSource);
		expect(result.reference).toBe('Source period not supplied');
		expect(result.collected).toBe('2026-10-11');
		expect(result.validated).toBeNull();
	});
	it('preserves official reference years and separate validation', () => {
		const result = sourceEvidence({
			id: 's',
			referenceYear: 2022,
			fetchedAt: '2026-10-10',
			lastValidatedAt: '2026-10-11',
			status: 'partial'
		} as import('../planning/types.ts').PlanningSource);
		expect(result.reference).toBe('2022');
		expect(result.validated).toBe('2026-10-11');
		expect(result.status).toBe('partial');
	});
	it('offers dated observed source choices without extending assumed calendars', () => {
		const b = {
			referenceDate: '2026-10-10',
			transit: {
				patterns: [
					{ provenance: 'observed', calendar: { includedDates: ['2026-10-09', '2026-10-10'] } },
					{ provenance: 'assumed', calendar: { includedDates: ['2027-01-01'] } }
				]
			}
		} as unknown as PlanningBaseline;
		expect(supportedPolicyDates(b)).toEqual(['2026-10-09', '2026-10-10']);
	});
});
