import { describe, expect, it } from 'vitest';
import { headlineForecast, forecastCaution } from '../components/policy/forecastPresentation.ts';
import { loadPredictionSource } from '../server/data/predictionSource.ts';
import { getPredictionBundle } from './index.ts';

describe('honest outlook presentation', () => {
	it('keeps source order instead of selecting a headline using later errors; exposes a losing bus benchmark', async () => {
		const bundle = getPredictionBundle(await loadPredictionSource(), '2026-10-11T13:00:00Z');
		const reversed = [...bundle.monthly].reverse();
		expect(headlineForecast(reversed)?.seriesId).toBe(reversed[0].seriesId);
		expect(forecastCaution(bundle.monthly.find((item) => item.mode === 'bus')!)).toContain(
			'lost this comparison'
		);
		expect(forecastCaution(bundle.monthly.find((item) => item.mode === 'ferry')!)).toBeNull();
	});
	it('supports explicit future target and labels current-month nowcast with correct horizon', async () => {
		const source = await loadPredictionSource();
		const nowcast = getPredictionBundle(source, '2026-10-11T13:00:00Z');
		const future = getPredictionBundle(source, '2026-10-11T13:00:00Z', '2026-11');
		expect(nowcast.target?.kind).toBe('nowcast');
		expect(future.target?.kind).toBe('future');
		expect(future.monthly.map((item) => item.horizonMonths)).toEqual([5, 5, 6]);
		expect(future.monthly.every((item) => forecastCaution(item) !== null)).toBe(true);
		expect(() => getPredictionBundle(source, '2026-10-11T13:00:00Z', '2026-13')).toThrow(
			/Invalid target/
		);
	});
});
