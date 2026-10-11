import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
	buildCorridorPassages,
	forecastCorridorRuntime,
	getBusReadiness,
	matchCorridorPosition,
	type ReviewedCorridor
} from './bus';
import { forecastPassengerSeries, indexMonth, monthlyPointForecast, monthIndex } from './monthly';
import { getPredictionBundle } from './index';
import type { BusSnapshot, PassengerSeries, PredictionSource } from './types';

const series = (length = 54): PassengerSeries => ({
	id: 'ferry',
	name: 'Test endpoint',
	mode: 'ferry',
	geography: 'Endpoint category',
	unit: 'passenger movements',
	lastActualMonth: indexMonth(monthIndex('2022-01') + length - 1),
	sourceUrl: 'https://statisticsmaldives.gov.mv/',
	qualification: 'Test fixture only',
	points: Array.from({ length }, (_, i) => ({
		month: indexMonth(monthIndex('2022-01') + i),
		value: 100 + (i % 12) * 10
	}))
});
describe('monthly outlook', () => {
	it('issues only source-supported aggregate forecasts from the audited public fixture', () => {
		const source = JSON.parse(
			readFileSync(new URL('../../../data/public/prediction-source.json', import.meta.url), 'utf8')
		) as PredictionSource;
		const bundle = getPredictionBundle(source, '2026-10-11T12:00:00Z');
		expect(bundle.monthly).toHaveLength(3);
		expect(
			bundle.monthly.every(
				(m) => m.status === 'exploratory' && m.estimate !== null && m.evaluation?.n === 6
			)
		).toBe(true);
		expect(bundle.monthly.find((m) => m.mode === 'bus')?.horizonMonths).toBe(5);
		expect(
			bundle.monthly.filter((m) => m.mode === 'ferry').every((m) => m.horizonMonths === 4)
		).toBe(true);
		expect(['unavailable', 'collecting']).toContain(bundle.bus.status);
		expect(bundle.bus.replay).toBeNull();
	});
	it('evaluates at the actual release-lag horizon and forecasts through October', () => {
		const forecast = forecastPassengerSeries(series(), '2026-10');
		expect(forecast.horizonMonths).toBe(4);
		expect(forecast.model).toBe('seasonal-naive');
		expect(forecast.estimate).toBe(190);
		expect(forecast.evaluation?.n).toBe(6);
		expect(forecast.evaluation?.horizonMonths).toBe(4);
		expect(forecast.evaluation?.mae).toBe(0);
		expect(forecast.projections.map((p) => p.month)).toEqual([
			'2026-07',
			'2026-08',
			'2026-09',
			'2026-10'
		]);
		expect(forecast.empiricalRange?.label).toContain('not a certified');
	});
	it('handles bus May cutoff as a five-month forecast', () => {
		expect(forecastPassengerSeries(series(53), '2026-10').horizonMonths).toBe(5);
	});
	it('does not let later test outcomes choose the model', () => {
		const original = series();
		const modified = {
			...original,
			points: original.points.map((p, i) => ({ ...p, value: i >= 48 ? 99999 : p.value }))
		};
		expect(forecastPassengerSeries(original, '2026-10').model).toBe(
			forecastPassengerSeries(modified, '2026-10').model
		);
		expect(forecastPassengerSeries(modified, '2026-10').evaluation!.mae).toBeGreaterThan(1000);
	});
	it('rejects gaps, duplicate months, negative values and unsupported horizons', () => {
		const s = series();
		for (const points of [
			s.points.filter((_, i) => i !== 3),
			[...s.points, s.points[3]],
			s.points.map((p, i) => (i === 3 ? { ...p, value: -1 } : p))
		])
			expect(forecastPassengerSeries({ ...s, points }, '2026-10').status).toBe('unavailable');
		expect(forecastPassengerSeries(s, '2026-06').status).toBe('unavailable');
		expect(forecastPassengerSeries(s, '2028-10').status).toBe('unavailable');
	});
	it('does not invent intervals or WAPE denominators', () => {
		const small = series(40);
		expect(forecastPassengerSeries(small, '2025-06').empiricalRange).toBeNull();
		const zeros = { ...series(), points: series().points.map((p) => ({ ...p, value: 0 })) };
		expect(forecastPassengerSeries(zeros, '2026-10').evaluation?.wape).toBeNull();
		expect(monthlyPointForecast([1, 2], 1, 'seasonal-naive')).toBeNull();
	});
	it('uses Maldives local forecast month at the UTC month boundary', () => {
		const source: PredictionSource = {
			version: 1,
			asOf: '2026-10-01',
			sourceIds: [],
			dataQualityNotes: [],
			series: [series()],
			audit: {}
		};
		expect(getPredictionBundle(source, '2026-09-30T20:00:00Z').monthly[0].forecastMonth).toBe(
			'2026-10'
		);
	});
});

const corridor: ReviewedCorridor = {
	id: 'c',
	routeId: 'R1',
	direction: 'outbound',
	reviewed: true,
	geometry: [
		[73.5, 4.2],
		[73.51, 4.2]
	],
	startFraction: 0.2,
	endFraction: 0.8,
	stopFractions: [0.5]
};
const snapshots = (fractions: number[], gap = 60): BusSnapshot[] =>
	fractions.map((f, i) => ({
		receivedAt: new Date(Date.parse('2026-10-11T10:00:00Z') + i * gap * 1000).toISOString(),
		vehicles: [{ id: 'anon', latitude: 4.2, longitude: 73.5 + 0.01 * f }]
	}));
describe('receipt-time bus evidence', () => {
	it('publishes dataset readiness from a private capture receipt without vehicle coordinates or forecast', () => {
		const capture = {
			status: 'completed',
			startedAt: '2026-10-11T10:00:00Z',
			completedAt: '2026-10-11T10:10:00Z',
			firstReceivedAt: '2026-10-11T10:00:01Z',
			lastReceivedAt: '2026-10-11T10:09:01Z',
			snapshots: 11,
			vehicles: 4,
			observedDays: 1,
			changedPositionIntervals: 22,
			measurementTimestampAvailable: false,
			qualification: 'Actual bounded capture'
		};
		const result = getBusReadiness(undefined, new Date('2026-10-11T11:00:00Z'), capture);
		expect(result.status).toBe('collecting');
		expect(result.coverage.snapshots).toBe(11);
		expect(result.replay).toBeNull();
		expect(result.coverage.lastReceivedAt).toBe('2026-10-11T10:09:01.000Z');
		expect(result.modelCard.trainingCutoff).toBe('2026-10-11T10:09:01.000Z');
		expect(result.qualification).toContain('not a live feed');
		expect(getBusReadiness(undefined, new Date('2026-10-11T09:00:00Z'), capture).status).toBe(
			'unavailable'
		);
	});
	it('brackets crossings without claiming physical stop arrival or exact dwell', () => {
		const [p] = buildCorridorPassages(snapshots([0.1, 0.3, 0.5, 0.7, 0.9]), corridor);
		expect(p.seconds.lower).toBe(120);
		expect(p.seconds.upper).toBe(240);
		expect(p.stopAssociatedSecondsUpper).toBeGreaterThan(0);
		expect(p.qualification).toContain('latency unknown');
	});
	it('rejects gaps, reverse direction, unseen vehicles and unreviewed geometry', () => {
		expect(buildCorridorPassages(snapshots([0.1, 0.3, 0.9], 120), corridor)).toEqual([]);
		expect(buildCorridorPassages(snapshots([0.1, 0.3, 0.25, 0.7, 0.9]), corridor)).toEqual([]);
		expect(
			buildCorridorPassages(snapshots([0.1, 0.3, 0.9]), { ...corridor, reviewed: false })
		).toEqual([]);
		const missing = snapshots([0.1, 0.3, 0.5, 0.9]);
		missing[2].vehicles = [];
		expect(buildCorridorPassages(missing, corridor)).toEqual([]);
		const duplicated = snapshots([0.1, 0.3, 0.5, 0.7, 0.9]);
		duplicated[4].vehicles.push({ ...duplicated[4].vehicles[0] });
		expect(buildCorridorPassages(duplicated, corridor)).toEqual([]);
	});
	it('abstains when a point could belong to either direction on looping geometry', () => {
		const loop = {
			...corridor,
			geometry: [
				[73.5, 4.2],
				[73.51, 4.2],
				[73.5, 4.2]
			] as Array<[number, number]>
		};
		expect(
			matchCorridorPosition({ id: 'anon', latitude: 4.2, longitude: 73.505 }, loop)
		).toBeNull();
	});
	it('does not call stationary coordinates stale and identifies dated replay', () => {
		const replay = {
			routeId: 'R1',
			sourceUrl: 'https://www.rtl.mv/',
			measurementTimestampAvailable: false as const,
			snapshots: snapshots([0.4, 0.4]),
			qualification: 'Receipt-time only'
		};
		expect(getBusReadiness(replay, new Date('2026-10-11T10:01:30Z')).status).toBe('collecting');
		expect(getBusReadiness(replay, new Date('2026-10-11T11:00:00Z')).status).toBe('dated-replay');
		expect(getBusReadiness(replay, new Date('2026-10-11T09:00:00Z')).status).toBe('unavailable');
	});
	it('abstains from sparse, future, stale or ungrounded physical arrival predictions', () => {
		const request = {
			corridorId: 'c',
			direction: 'outbound',
			issuedAt: '2026-10-11T10:04:00Z',
			clock: '2026-10-11T10:04:00Z',
			lastReceivedAt: '2026-10-11T10:04:00Z',
			measurementTimestampAvailable: false
		};
		const p = buildCorridorPassages(snapshots([0.1, 0.3, 0.5, 0.7, 0.9]), corridor);
		expect(forecastCorridorRuntime(p, request).reason).toContain('Collecting');
		expect(
			forecastCorridorRuntime(p, { ...request, clock: '2026-10-11T10:05:00Z' }).reason
		).toContain('clock');
		expect(
			forecastCorridorRuntime(p, { ...request, lastReceivedAt: '2026-10-11T09:00:00Z' }).reason
		).toContain('stale');
		expect(
			forecastCorridorRuntime(p, { ...request, physicalArrivalTarget: true }).reason
		).toContain('physical-arrival');
		expect(forecastCorridorRuntime(p, { ...request, horizonMinutes: 30 }).reason).toContain(
			'Unsupported'
		);
	});
});
