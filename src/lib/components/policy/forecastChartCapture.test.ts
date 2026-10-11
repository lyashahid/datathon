import { describe, expect, it } from 'vitest';
import { maldivesDateOnly } from './forecastChartCapture.ts';

describe('forecast brief local date', () => {
	it('uses the Maldives date when UTC is still on the preceding day', () => {
		expect(maldivesDateOnly('2026-10-10T20:30:00Z')).toBe('2026-10-11');
	});
	it('retains the same calendar date earlier in the UTC day', () => {
		expect(maldivesDateOnly('2026-10-11T12:00:00Z')).toBe('2026-10-11');
	});
});
