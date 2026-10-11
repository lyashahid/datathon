import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadPredictionSource, validatePredictionSource } from './predictionSource.ts';
import { GET } from '../../../routes/api/prediction/+server.ts';

async function fixture() {
	return JSON.parse(
		await readFile(join(process.cwd(), 'data/public/prediction-source.json'), 'utf8')
	);
}

describe('durable audited prediction source', () => {
	it('loads the three official contiguous series and preserves the source defect', async () => {
		const source = await loadPredictionSource();
		expect(source.series.map((s) => s.points.length)).toEqual([54, 54, 53]);
		expect(source.series.find((s) => s.mode === 'bus')?.lastActualMonth).toBe('2026-05');
		expect(source.audit.quarantinedBusMonth).toBe('2026-06');
		expect(source.busObservationReplay).toBeUndefined();
		expect(source.audit.busCapture).toMatchObject({
			status: 'completed',
			snapshots: 10,
			vehicles: 4,
			changedPositionIntervals: 9,
			measurementTimestampAvailable: false
		});
	});
	it('rejects calendar compression, duplicate periods, invalid counts and unsupported units', async () => {
		for (const mutate of [
			(x: Awaited<ReturnType<typeof fixture>>) => {
				x.series[0].points.splice(5, 1);
			},
			(x: Awaited<ReturnType<typeof fixture>>) => {
				x.series[0].points[1].month = x.series[0].points[0].month;
			},
			(x: Awaited<ReturnType<typeof fixture>>) => {
				x.series[0].points[0].value = -1;
			},
			(x: Awaited<ReturnType<typeof fixture>>) => {
				x.series[0].unit = 'unique riders';
			}
		]) {
			const x = await fixture();
			mutate(x);
			expect(() => validatePredictionSource(x)).toThrow();
		}
	});
	it('cannot silently promote the quarantined repeated bus month into training', async () => {
		const x = await fixture();
		const bus = x.series.find((s: { mode: string }) => s.mode === 'bus');
		bus.points.push({ month: '2026-06', value: 301954 });
		bus.lastActualMonth = '2026-06';
		expect(() => validatePredictionSource(x)).toThrow(/Quarantined/);
	});
	it('rejects identity fields even when nested in optional audit metadata', async () => {
		const x = await fixture();
		x.audit.vehicle = { plateNumber: 'SECRET' };
		expect(() => validatePredictionSource(x)).toThrow(/identity/);
	});
	it('requires the declared source receipts, publication sheet and consistent checked publication metadata', async () => {
		for (const mutate of [
			(x: Awaited<ReturnType<typeof fixture>>) => {
				delete x.audit.sources.latest_june_2026.publication_sheet;
			},
			(x: Awaited<ReturnType<typeof fixture>>) => {
				x.audit.publishedAt = '2026-02-31';
			},
			(x: Awaited<ReturnType<typeof fixture>>) => {
				x.audit.publishedAt = '2027-01-01';
			},
			(x: Awaited<ReturnType<typeof fixture>>) => {
				x.audit.monthlyAuditAsOf = '2026-10-12T12:00:00Z';
			},
			(x: Awaited<ReturnType<typeof fixture>>) => {
				x.audit.sources.extra = structuredClone(x.audit.sources.may_2026);
			}
		]) {
			const x = await fixture();
			mutate(x);
			expect(() => validatePredictionSource(x)).toThrow();
		}
	});
	it('checks the aggregate receipt source, sample chronology and interval denominator', async () => {
		for (const change of [
			{ routeId: '999' },
			{ sourceUrl: 'https://unreviewed.example/positions' },
			{ changedPositionIntervals: 35 },
			{ lastReceivedAt: '2026-10-11T12:30:00Z' },
			{ measurementTimestampAvailable: true }
		]) {
			const x = await fixture();
			Object.assign(x.audit.busCapture, change);
			expect(() => validatePredictionSource(x)).toThrow();
		}
		const x = await fixture();
		x.audit.busCapture.positions = [{ latitude: 4.2, longitude: 73.5 }];
		expect(validatePredictionSource(x).audit.busCapture).not.toHaveProperty('positions');
	});
	it('API serves the durable outlook with the actual publication lag and no live-coordinate exposure', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-10-11T12:00:00Z'));
		try {
			const response = await GET({} as Parameters<typeof GET>[0]);
			expect(response.status).toBe(200);
			expect(response.headers.get('Cache-Control')).toContain('max-age=60');
			const bundle = await response.json();
			expect(bundle.monthly.map((s: { horizonMonths: number }) => s.horizonMonths)).toEqual([
				4, 4, 5
			]);
			expect(
				bundle.monthly.every(
					(s: { unit: string; estimate: number }) =>
						s.unit === 'passenger movements' && Number.isFinite(s.estimate)
				)
			).toBe(true);
			expect(bundle.bus.replay).toBeNull();
			expect(bundle.bus.status).toBe('collecting');
			expect(bundle.bus.coverage.snapshots).toBe(10);
			expect(bundle.bus.qualification).toContain('collector stopped');
			expect(JSON.stringify(bundle)).not.toContain('plateNumber');
		} finally {
			vi.useRealTimers();
		}
	});
	it('API accepts an explicit future month and fails malformed target months', async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-10-11T13:00:00Z'));
		try {
			const future = await GET({
				url: new URL('http://localhost/api/prediction?targetMonth=2026-11')
			} as Parameters<typeof GET>[0]);
			const bundle = await future.json();
			expect(bundle.target.kind).toBe('future');
			expect(bundle.monthly.map((item: { horizonMonths: number }) => item.horizonMonths)).toEqual([
				5, 5, 6
			]);
			expect(bundle.provenance.sources).toHaveLength(4);
			const bad = await GET({
				url: new URL('http://localhost/api/prediction?targetMonth=2026-13')
			} as Parameters<typeof GET>[0]);
			expect(bad.status).toBe(400);
		} finally {
			vi.useRealTimers();
		}
	});
});
