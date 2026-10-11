import { describe, expect, it } from 'vitest';
import { getFacilityEligibility, isEligibleFacility } from './facilities.ts';
import type { PlanningAssumptions, PlanningFacility } from './types.ts';

const facility: PlanningFacility = {
	id: 'hospital',
	name: 'Reviewed hospital',
	kind: 'hospital',
	islandId: 'male',
	lon: 73.5,
	lat: 4.17,
	verification: 'official',
	operatingStatus: 'open',
	statusReviewedAt: '2026-10-10',
	statusSourceIds: ['registry'],
	careScope: 'general'
};
const assumptions: Pick<
	PlanningAssumptions,
	'goal' | 'date' | 'departureMinutes' | 'destinationRequirements'
> = {
	goal: 'healthcare',
	date: '2026-10-10',
	departureMinutes: 900
};

describe('service-specific destination eligibility', () => {
	it('retains reviewed general access while raw map tags cannot establish emergency service', () => {
		expect(isEligibleFacility(facility, 'healthcare')).toBe(true);
		expect(
			getFacilityEligibility(
				{ ...facility, emergency: 'yes' },
				{ ...assumptions, destinationRequirements: { healthcareService: 'emergency' } }
			)
		).toMatchObject({ status: 'unavailable', reason: expect.stringContaining('emergency') });
	});
	it('requires a sourced service review and excludes a confirmed mismatched service', () => {
		const reviewed = {
			...facility,
			suitability: {
				reviewedAt: '2026-10-10',
				sourceIds: ['operator-services'],
				healthcareServices: ['general', 'emergency'] as const
			}
		};
		const requirement = {
			...assumptions,
			destinationRequirements: { healthcareService: 'emergency' as const }
		};
		expect(
			getFacilityEligibility(
				{
					...reviewed,
					suitability: {
						...reviewed.suitability,
						healthcareServices: [...reviewed.suitability.healthcareServices]
					}
				},
				requirement
			).status
		).toBe('eligible');
		expect(
			getFacilityEligibility(
				{
					...facility,
					suitability: {
						reviewedAt: '2026-10-10',
						sourceIds: [],
						healthcareServices: ['emergency']
					}
				},
				requirement
			).status
		).toBe('unavailable');
		expect(
			getFacilityEligibility(
				{
					...facility,
					suitability: {
						reviewedAt: '2026-10-10',
						sourceIds: ['operator-services'],
						healthcareServices: ['general']
					}
				},
				requirement
			).status
		).toBe('ineligible');
	});
	it('does not substitute private registration or ownership for public eligibility', () => {
		const publicRequirement = {
			...assumptions,
			destinationRequirements: { publicAccess: 'public' as const }
		};
		expect(
			getFacilityEligibility({ ...facility, ownership: 'government' }, publicRequirement).status
		).toBe('unavailable');
		expect(
			getFacilityEligibility(
				{
					...facility,
					suitability: {
						reviewedAt: '2026-10-10',
						sourceIds: ['admissions'],
						publicAccess: 'restricted'
					}
				},
				publicRequirement
			).status
		).toBe('ineligible');
		expect(
			getFacilityEligibility(
				{
					...facility,
					suitability: {
						reviewedAt: '2026-10-10',
						sourceIds: ['admissions'],
						publicAccess: 'public'
					}
				},
				publicRequirement
			).status
		).toBe('eligible');
	});
	it('distinguishes published school levels from preschool and unknown grades', () => {
		const school = { ...facility, kind: 'school' as const };
		const primary = {
			...assumptions,
			goal: 'education' as const,
			destinationRequirements: { schoolLevel: 'primary' as const }
		};
		expect(getFacilityEligibility(school, primary).status).toBe('unavailable');
		expect(
			getFacilityEligibility({ ...school, educationSuitability: 'preschool' }, primary).status
		).toBe('ineligible');
		expect(
			getFacilityEligibility(
				{
					...school,
					suitability: {
						reviewedAt: '2026-10-10',
						sourceIds: ['school-profile'],
						schoolLevels: ['primary', 'lower-secondary']
					}
				},
				primary
			).status
		).toBe('eligible');
	});
	it('uses published hours including overnight windows and keeps missing hours unavailable', () => {
		const at = (date: string, departureMinutes: number) => ({
			...assumptions,
			date,
			departureMinutes,
			destinationRequirements: { requireOpenAtDeparture: true }
		});
		expect(getFacilityEligibility(facility, at('2026-10-10', 900)).status).toBe('unavailable');
		const overnight = {
			...facility,
			suitability: {
				reviewedAt: '2026-10-10',
				sourceIds: ['operator-hours'],
				openingHours: [{ weekdays: [5], startMinutes: 1320, endMinutes: 1560 }]
			}
		};
		expect(getFacilityEligibility(overnight, at('2026-10-10', 60)).status).toBe('eligible');
		expect(getFacilityEligibility(overnight, at('2026-10-10', 120)).status).toBe('ineligible');
		expect(
			getFacilityEligibility(
				{
					...overnight,
					suitability: {
						...overnight.suitability,
						openingHours: [{ weekdays: [5], startMinutes: 1320, endMinutes: 120 }]
					}
				},
				at('2026-10-10', 60)
			).status
		).toBe('unavailable');
	});
	it('keeps proposed clinics conditional and cannot claim emergency, eligibility or hours', () => {
		const proposed: PlanningFacility = {
			...facility,
			id: 'proposal',
			kind: 'clinic',
			provenance: 'assumed',
			planningStatus: 'proposed',
			verification: 'scenario-proposal',
			proposedOpeningDate: '2026-10-10',
			sourceIds: ['scenario-proposal']
		};
		expect(getFacilityEligibility(proposed, assumptions, true).status).toBe('eligible');
		expect(
			getFacilityEligibility(
				proposed,
				{ ...assumptions, destinationRequirements: { healthcareService: 'emergency' } },
				true
			).status
		).toBe('unavailable');
		expect(
			getFacilityEligibility(proposed, { ...assumptions, date: '2026-10-09' }, true).status
		).toBe('ineligible');
	});
	it('never revives closed or unverified facilities under strict criteria', () => {
		expect(
			getFacilityEligibility(
				{ ...facility, operatingStatus: 'closed' },
				{ ...assumptions, destinationRequirements: { healthcareService: 'emergency' } }
			).status
		).toBe('ineligible');
	});
});
