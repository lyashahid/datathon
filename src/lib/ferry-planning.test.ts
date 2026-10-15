import { describe, expect, it } from 'vitest';
import {
	canConfirmFerry,
	ferryFeatureBounds,
	ferryPlanningDate,
	ferryServiceInput,
	type FerryDraft,
	type FerryServiceSettings
} from './ferry-planning.js';

const settings: FerryServiceSettings = {
	destinationId: 'island:1443',
	headway: 120,
	start: '06:00',
	end: '20:00',
	speed: 25
};
const request = {
	island_id: 'island:1442',
	operations: [{ type: 'add_stop' }],
	assumptions: { capital_budget_mvr: 10, annual_operating_budget_mvr: 20 }
};

describe('ferry service plan authorization', () => {
	it('quotes the inspected service date instead of a restored draft date', () => {
		const serviceDate = ferryPlanningDate('2026-10-11');
		const result = ferryServiceInput('island:1442', settings, {
			...request,
			assumptions: { ...request.assumptions, date: serviceDate ?? '2026-10-10' }
		});
		expect(result.payload?.assumptions.date).toBe('2026-10-11');
		expect(ferryPlanningDate('2026-02-30')).toBeNull();
		expect(ferryPlanningDate('2026-13-01')).toBeNull();
		expect(ferryPlanningDate('0000-01-01')).toBeNull();
		expect(ferryPlanningDate(undefined)).toBeNull();
	});
	it('includes existing commitments and both limits in the quoted request', () => {
		const result = ferryServiceInput('island:1442', settings, request);
		expect(result.payload).toMatchObject({
			origin_island_id: 'island:1442',
			destination_island_id: 'island:1443',
			start_minutes: 360,
			end_minutes: 1200,
			operations: request.operations,
			assumptions: request.assumptions
		});
	});
	it.each([
		{ destinationId: 'island:1442' },
		{ destinationId: '' },
		{ headway: '' },
		{ headway: 0 },
		{ headway: 120.5 },
		{ speed: 5 },
		{ speed: NaN },
		{ speed: 100 },
		{ start: '25:00' },
		{ end: '06:00' }
	])('rejects an incomplete or impossible service: %j', (change) => {
		expect(
			ferryServiceInput('island:1442', { ...settings, ...change }, request).payload
		).toBeNull();
	});
	it('rejects a stale quote, a blocked budget and incomplete terminal evidence', () => {
		const draft = {
			status: 'ready',
			operations: [{ type: 'add_service' }],
			quote: { budget: { allowed: true } }
		} as FerryDraft;
		expect(canConfirmFerry(draft, 'same', 'same', false)).toBe(true);
		expect(canConfirmFerry(draft, 'old', 'same', false)).toBe(false);
		expect(canConfirmFerry(draft, 'same', 'same', true)).toBe(false);
		expect(canConfirmFerry({ ...draft, status: 'evidence_needed' }, 'same', 'same', false)).toBe(
			false
		);
		expect(
			canConfirmFerry(
				{ ...draft, quote: { ...draft.quote!, budget: { allowed: false, reasons: [] } } },
				'same',
				'same',
				false
			)
		).toBe(false);
	});
	it('fits both landing places and ignores invalid geometry', () => {
		expect(
			ferryFeatureBounds({
				type: 'FeatureCollection',
				features: [
					{
						type: 'Feature',
						properties: {},
						geometry: {
							type: 'LineString',
							coordinates: [
								[73.5, 4.1],
								[73.6, 4.3],
								[NaN, 4]
							]
						}
					}
				]
			})
		).toEqual([
			[73.5, 4.1],
			[73.6, 4.3]
		]);
	});
});
