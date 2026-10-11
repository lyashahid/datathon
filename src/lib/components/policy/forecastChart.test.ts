import { describe, expect, it } from 'vitest';
import { buildForecastChart, buildForecastAccuracyChart } from './forecastChart.ts';

describe('forecast chart evidence geometry', () => {
	it('preserves calendar gaps rather than evenly spacing observations', () => {
		const chart = buildForecastChart({
			history: [
				{ month: '2026-01', value: 100 },
				{ month: '2026-03', value: 120 }
			],
			projections: [{ month: '2026-04', estimate: 130 }],
			lastActualMonth: '2026-03',
			forecastMonth: '2026-04',
			empiricalRange: null
		});
		expect(chart).not.toBeNull();
		expect(chart!.x('2026-03') - chart!.x('2026-01')).toBeCloseTo(
			2 * (chart!.x('2026-04') - chart!.x('2026-03'))
		);
		expect(chart!.lastActualX).toBeCloseTo(chart!.x('2026-03'));
		expect(chart!.targetX).toBeCloseTo(708);
		expect(chart!.points.map((point) => point.kind)).toEqual(['Recorded', 'Recorded', 'Estimate']);
	});

	it('includes the displayed error range in the y-axis and ticks across year boundaries', () => {
		const chart = buildForecastChart({
			history: [{ month: '2025-12', value: 100 }],
			projections: [{ month: '2026-03', estimate: 110 }],
			lastActualMonth: '2025-12',
			forecastMonth: '2026-03',
			empiricalRange: {
				lower: 60,
				upper: 200,
				residualCount: 6,
				historicalCoverage: 0.5,
				label: 'Past errors'
			}
		});
		expect(chart!.ymax).toBeGreaterThan(200);
		expect(chart!.ticks.map((tick) => tick.month)).toEqual([
			'2025-12',
			'2026-01',
			'2026-02',
			'2026-03'
		]);
		expect(chart!.y(200)).toBeGreaterThan(25);
	});

	it('does not fabricate a chart when fewer than two observations exist', () => {
		expect(buildForecastChart(null)).toBeNull();
		expect(
			buildForecastChart({
				history: [{ month: '2026-01', value: 100 }],
				projections: [],
				lastActualMonth: '2026-01',
				forecastMonth: '2026-06',
				empiricalRange: null
			})
		).toBeNull();
	});

	it('fits a mobile viewport without shrinking the vertical scale or compressing months', () => {
		const item = {
			history: [
				{ month: '2026-01', value: 100 },
				{ month: '2026-03', value: 120 }
			],
			projections: [{ month: '2026-04', estimate: 130 }],
			lastActualMonth: '2026-03',
			forecastMonth: '2026-04',
			empiricalRange: null
		};
		const mobile = buildForecastChart(item, 311)!;
		const desktop = buildForecastChart(item)!;
		expect(mobile.width).toBe(311);
		expect(mobile.height).toBe(desktop.height);
		expect(mobile.y(120)).toBe(desktop.y(120));
		expect(mobile.ticks).toHaveLength(3);
		expect(mobile.targetX).toBe(297);
		expect(mobile.x('2026-03') - mobile.x('2026-01')).toBeCloseTo(
			2 * (mobile.x('2026-04') - mobile.x('2026-03'))
		);
	});

	it('shows the requested history window while retaining every future estimate', () => {
		const item = {
			history: Array.from({ length: 30 }, (_, index) => ({
				month: `${2024 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`,
				value: 100 + index
			})),
			projections: [
				{ month: '2026-07', estimate: 132 },
				{ month: '2026-08', estimate: 133 }
			],
			lastActualMonth: '2026-06',
			forecastMonth: '2026-08',
			empiricalRange: null
		};
		const recent = buildForecastChart(item, 740, 12)!;
		const full = buildForecastChart(item, 740, null)!;
		expect(recent.points.filter((point) => point.kind === 'Recorded')).toHaveLength(12);
		expect(full.points.filter((point) => point.kind === 'Recorded')).toHaveLength(30);
		expect(recent.points.filter((point) => point.kind === 'Estimate')).toEqual(
			full.points.filter((point) => point.kind === 'Estimate')
		);
		expect(recent.points[0].month).toBe('2025-07');
		expect(full.points[0].month).toBe('2024-01');
	});
});

describe('historical forecast comparison geometry', () => {
	it('compares predictions and recorded totals on one zero-based calendar scale', () => {
		const rows = [
			{ targetMonth: '2026-03', trainingCutoff: '2025-12', actual: 140, estimate: 100, error: 40 },
			{ targetMonth: '2026-01', trainingCutoff: '2025-10', actual: 100, estimate: 120, error: -20 },
			{ targetMonth: '2026-04', trainingCutoff: '2026-01', actual: 125, estimate: 110, error: 15 }
		];
		const figure = buildForecastAccuracyChart(rows, 311)!;
		expect(figure.points.map((row) => row.targetMonth)).toEqual(['2026-01', '2026-03', '2026-04']);
		expect(figure.y(0)).toBe(figure.bounds.bottom);
		expect(figure.ymax).toBeGreaterThan(140);
		expect(figure.x('2026-03') - figure.x('2026-01')).toBeCloseTo(
			2 * (figure.x('2026-04') - figure.x('2026-03'))
		);
		expect(figure.actual).toContain(`${figure.x('2026-03')},${figure.y(140)}`);
		expect(figure.estimate).toContain(`${figure.x('2026-03')},${figure.y(100)}`);
		expect(rows[0].targetMonth).toBe('2026-03');
	});
	it('handles a single eligible check without duplicating or fabricating observations', () => {
		expect(buildForecastAccuracyChart([])).toBeNull();
		const figure = buildForecastAccuracyChart([
			{ targetMonth: '2026-03', trainingCutoff: '2025-12', actual: 100, estimate: 90, error: 10 }
		])!;
		expect(figure.points).toHaveLength(1);
		expect(figure.ticks).toHaveLength(1);
		expect(figure.x('2026-03')).toBe((figure.bounds.left + figure.bounds.right) / 2);
	});
});
