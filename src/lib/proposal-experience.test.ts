import { describe, expect, it } from 'vitest';
import { explainImpactCell, serviceCalendarRuns } from './proposal-experience.js';
import type { PlanningOperation } from './planning-map.js';

const operations: PlanningOperation[] = [
	{
		type: 'add_hospital',
		name: 'North health centre',
		metadata: { proposal_id: 'proposal:add_hospital:1' }
	}
];

describe('selected proposal impact explanations', () => {
	it('explains actual before/after evidence and identifies a proposal only when a journey uses its destination', () => {
		const cell = {
			view: 'improvement',
			impact: 'improved',
			before: 35,
			after: 18,
			delta: 17,
			population: 350,
			after_destination_ids: ['proposal:add_hospital:1']
		};
		const explanation = explainImpactCell(cell, { goalLabel: 'healthcare', operations });
		expect(explanation.title).toBe('Shorter journeys');
		expect(explanation.summary).toContain('17 minutes shorter');
		expect(explanation.reasons).toEqual([
			'Current: 35 minutes. With proposal: 18 minutes.',
			'At least one modeled journey ends at North health centre.'
		]);
		expect(
			explainImpactCell(
				{ ...cell, after_destination_ids: JSON.stringify(cell.after_destination_ids) },
				{ operations }
			).reasons.join(' ')
		).toContain('North health centre');
		expect(
			explainImpactCell(
				{ ...cell, after_destination_ids: 'invalid JSON' },
				{ operations }
			).reasons.join(' ')
		).not.toContain('North health centre');
		const unmatched = explainImpactCell(
			{ ...cell, after_destination_ids: ['hospital:existing'] },
			{ operations }
		);
		expect(unmatched.reasons.join(' ')).not.toContain('North health centre');
		expect(unmatched.reasons.join(' ')).toContain('does not isolate each item');
	});

	it('keeps unknown, no route, and no change explanations separate', () => {
		expect(
			explainImpactCell({
				view: 'improvement',
				impact: 'uncomputed',
				before: null,
				after: 20,
				delta: null
			}).summary
		).toContain('unknown');
		expect(
			explainImpactCell({
				view: 'improvement',
				impact: 'unavailable',
				before: 20,
				after: null,
				delta: null
			}).summary
		).toContain('no complete modeled journey');
		expect(
			explainImpactCell({
				view: 'improvement',
				impact: 'unchanged',
				before: 20,
				after: 20,
				delta: 0
			}).title
		).toBe('No meaningful journey-time change');
	});

	it('uses current phase evidence and never attributes it to the proposed facility', () => {
		const explanation = explainImpactCell(
			{
				view: 'before',
				access: 'within_target',
				selected_minutes: 8,
				target_minutes: 10,
				population: 120,
				after_destination_ids: ['proposal:add_hospital:1']
			},
			{ goalLabel: 'public transport', operations }
		);
		expect(explanation.summary).toBe(
			'About 120 residents are within the 10-minute target for public transport.'
		);
		expect(explanation.reasons).toEqual(['Average modeled journey: 8 minutes.']);
	});

	it('explains mixed cells and never describes a weighted average as everyone meeting the target', () => {
		const explanation = explainImpactCell({
			view: 'after',
			access: 'mixed',
			selected_minutes: 10,
			target_minutes: 10,
			residents_within_target: 90,
			residents_beyond_target: 10
		});
		expect(explanation.summary).toContain('others need longer');
		expect(explanation.reasons).toContain(
			'About 90 residents meet the target and 10 are beyond it.'
		);
	});

	it('explains ferry connectivity independently from unchanged walking access', () => {
		const explanation = explainImpactCell(
			{ view: 'improvement', impact: 'unchanged', before: 5, after: 5, delta: 0 },
			{ operations: [{ type: 'add_service', service: { mode: 'ferry' } }] }
		);
		expect(explanation.reasons.join(' ')).toContain('without shortening the walk');
	});
});

describe('bus service-day calendar guard', () => {
	it('does not repeat captured remaining bus departures on another day', () => {
		const calendar = { includedDates: ['2026-10-10'], weekdays: [] };
		expect(serviceCalendarRuns(calendar, '2026-10-10')).toBe(true);
		expect(serviceCalendarRuns(calendar, '2026-10-11')).toBe(false);
	});

	it('honors exclusion first, included date exceptions second, then weekday and range limits', () => {
		const calendar = {
			includedDates: ['2026-10-10', '2026-10-09'],
			excludedDates: ['2026-10-10'],
			weekdays: [0],
			startDate: '2026-10-11',
			endDate: '2026-10-18'
		};
		expect(serviceCalendarRuns(calendar, '2026-10-10')).toBe(false);
		expect(serviceCalendarRuns(calendar, '2026-10-09')).toBe(true);
		expect(serviceCalendarRuns(calendar, '2026-10-11')).toBe(true);
		expect(serviceCalendarRuns(calendar, '2026-10-12')).toBe(false);
		expect(serviceCalendarRuns(calendar, '2026-10-18')).toBe(true);
		expect(serviceCalendarRuns(calendar, '2026-10-25')).toBe(false);
	});

	it('keeps missing calendars and invalid selected dates unverified', () => {
		for (const date of ['2026-02-30', '0000-10-10', '2026-1-1', '', 'invalid'])
			expect(serviceCalendarRuns({ weekdays: [0, 1, 2, 3, 4, 5, 6] }, date)).toBe(false);
		expect(serviceCalendarRuns(undefined, '2026-10-10')).toBe(false);
		expect(serviceCalendarRuns({}, '2026-10-10')).toBe(false);
	});
});
