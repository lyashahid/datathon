import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { OperationsBundle } from '#lib/operations/types.ts';
import type { PlanningBaseline } from '#lib/planning/types.ts';
import type { ForecastBundle } from '#lib/prediction/types.ts';
import type { PolicyEvidenceBundle } from '#lib/server/data/policyEvidenceSource.ts';
import type { TransportContext } from '#lib/context/types.ts';
import {
	combineDatasets,
	compatibility,
	createAnalyticalCatalog,
	type AnalyticalDataset
} from './catalog.ts';

const dataset = (
	id: string,
	values: [string, number | null][],
	overrides: Partial<AnalyticalDataset> = {}
): AnalyticalDataset => ({
	id,
	title: id,
	description: 'Retained published monthly series',
	topic: 'passengers',
	evidence: 'observed',
	unit: 'passenger movements',
	sourceTitle: 'Official source',
	sourceUrl: 'https://example.org/data',
	sourceNote: 'No unique people inferred.',
	sources: [{ id: 'source', title: 'Official source', url: 'https://example.org/data' }],
	rows: values.map(([key, value]) => ({
		key,
		label: key,
		value,
		period: key,
		sourceIds: ['source']
	})),
	defaultChart: 'line',
	xLabel: 'Month',
	yLabel: 'passenger movements',
	join: { grain: 'month', domain: 'same-airport', period: null },
	limitations: ['Counts are movements, not people.'],
	...overrides
});

describe('safe dataset comparisons', () => {
	it('keeps absent and explicitly null cells missing in a union', () => {
		const first = dataset('arrivals', [
			['2025-01', 10],
			['2025-02', null]
		]);
		const second = dataset('departures', [
			['2025-02', 20],
			['2025-03', 30]
		]);
		const result = combineDatasets([first, second], { mode: 'values', alignment: 'union' });
		expect(result.ok).toBe(true);
		expect(result.commonKeys).toEqual(['2025-02']);
		expect(result.unmatchedKeys).toEqual(['2025-01', '2025-03']);
		expect(result.dataset!.rows.map((r) => r.value)).toEqual([10, null, null, 20, null, 30]);
		expect(
			result.dataset!.rows.find((r) => r.key === '2025-03' && r.series === 'arrivals')!.sourceIds
		).toEqual([]);
	});
	it('uses one positive common period for every indexed series, without filling gaps', () => {
		const first = dataset('arrivals', [
			['2025-01', 0],
			['2025-02', 20],
			['2025-03', 30]
		]);
		const second = dataset(
			'aircraft',
			[
				['2025-01', 2],
				['2025-02', 4],
				['2025-03', null]
			],
			{ unit: 'aircraft movements' }
		);
		expect(combineDatasets([first, second], { mode: 'values', alignment: 'common' }).ok).toBe(
			false
		);
		const result = combineDatasets([first, second], { mode: 'indexed', alignment: 'common' });
		expect(result.ok).toBe(true);
		expect(result.dataset!.unit).toContain('2025-02 = 100');
		expect(result.dataset!.rows.map((r) => r.value)).toEqual([0, 50, 100, 100, 150, null]);
		expect(result.dataset!.rows.at(-1)!.detail).toContain('Not supplied');
	});
	it('rejects matching month labels from different geographic coverage', () => {
		const first = dataset('ferry', [['2025-01', 10]]);
		const bus = dataset('bus', [['2025-01', 20]], {
			join: { grain: 'month', domain: 'bus-category', period: null }
		});
		expect(compatibility(first, bus).compatible).toBe(false);
		expect(
			combineDatasets([first, bus], { mode: 'indexed', alignment: 'common' }).reason
		).toContain('Geographic');
	});
	it('rejects cross-grain allocation and mismatched reference years', () => {
		const monthly = dataset('monthly', [['2025-01', 10]]);
		const island = dataset('island', [['male', 20]], {
			join: { grain: 'island', domain: 'physical-islands', period: '2026' }
		});
		expect(compatibility(monthly, island).compatible).toBe(false);
		expect(
			compatibility(island, { ...island, join: { ...island.join, period: '2030' } }).compatible
		).toBe(false);
		expect(combineDatasets([island], { mode: 'indexed', alignment: 'common' }).reason).toContain(
			'invent a baseline'
		);
	});
	it('rejects duplicate measure keys rather than aggregating conflicting records', () => {
		const invalid = dataset('duplicate', [
			['2025-01', 10],
			['2025-01', 11]
		]);
		expect(combineDatasets([invalid], { mode: 'values', alignment: 'common' }).reason).toContain(
			'Duplicate keys'
		);
	});
	it('allows multiple categorical series only when each measure key is unique', () => {
		const grouped = dataset('sex', [], {
			join: { grain: 'island', domain: 'physical-islands', period: '2022' },
			rows: [
				{ key: 'male', label: 'Malé', value: 50, series: 'Female', sourceIds: ['source'] },
				{ key: 'male', label: 'Malé', value: 60, series: 'Male', sourceIds: ['source'] }
			]
		});
		expect(
			combineDatasets([grouped], { mode: 'values', alignment: 'common' }).dataset!.rows
		).toHaveLength(2);
	});
	it('rejects no common keys and invalid indexed baselines', () => {
		expect(
			combineDatasets([dataset('a', [['2025-01', 1]]), dataset('b', [['2025-02', 2]])], {
				mode: 'values',
				alignment: 'union'
			}).reason
		).toContain('No matching');
		expect(
			combineDatasets([dataset('a', [['2025-01', 0]]), dataset('b', [['2025-01', null]])], {
				mode: 'indexed',
				alignment: 'common'
			}).reason
		).toContain('positive');
	});
	it('keeps calendar gaps visible instead of drawing an uninterrupted monthly line', () => {
		const data = dataset('gap', [
			['2025-01', 10],
			['2025-03', 30]
		]);
		for (const alignment of ['union', 'common'] as const) {
			const result = combineDatasets([data], { mode: 'values', alignment });
			expect(result.dataset!.rows.map((r) => [r.key, r.value])).toEqual([
				['2025-01', 10],
				['2025-02', null],
				['2025-03', 30]
			]);
			expect(result.dataset!.rows[1].sourceIds).toEqual([]);
		}
	});
	it('retains missing calendar years in both annual comparison alignments without interpolation', () => {
		const annual = dataset(
			'annual',
			[
				['2022', 10],
				['2024', 30]
			],
			{ join: { grain: 'year', domain: 'same-facility', period: null } }
		);
		for (const alignment of ['union', 'common'] as const) {
			const result = combineDatasets([annual], { mode: 'values', alignment });
			expect(result.dataset!.rows.map((r) => [r.key, r.value])).toEqual([
				['2022', 10],
				['2023', null],
				['2024', 30]
			]);
			expect(result.dataset!.rows[1].sourceIds).toEqual([]);
		}
	});
});

const json = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const planning = json<PlanningBaseline>('data/public/planning-baseline.json');
const policyEvidence = json<PolicyEvidenceBundle>('data/public/policy-evidence/bundle.json');
const operations = json<OperationsBundle>('data/public/operations/bundle.json');
const rawContext = json<{
	layers: { flights: { observations: TransportContext['aviation']['records'] } };
	sources: TransportContext['aviation']['sources'];
}>('data/public/context/agency-context.json');
const catalog = createAnalyticalCatalog({
	planning,
	policyEvidence,
	operations,
	transportContext: {
		schemaVersion: 1,
		version: 'retained',
		generatedAt: '2026-10-10',
		aviation: {
			enabled: true,
			status: 'partial',
			version: 'retained',
			generatedAt: '2026-10-10',
			stale: false,
			gapReasons: [],
			sources: rawContext.sources,
			records: rawContext.layers.flights.observations
		},
		mpl: {
			enabled: false,
			status: 'unavailable',
			version: null,
			generatedAt: null,
			stale: false,
			gapReasons: [],
			sources: [],
			records: [],
			observations: []
		},
		followme: {
			enabled: false,
			status: 'unavailable',
			version: null,
			generatedAt: null,
			stale: false,
			gapReasons: [],
			sources: [],
			records: []
		}
	}
});

describe('retained analytical catalogue', () => {
	it('adds missing annual observation rows with explicit nulls and no source attribution', () => {
		const policy = {
			...policyEvidence,
			observations: policyEvidence.observations
				.filter((r) => r.metric === 'IGMH hospital beds')
				.map((r) => ({
					...r,
					referencePeriod: r.referencePeriod === '2025' ? '2026' : r.referencePeriod
				}))
		};
		const data = createAnalyticalCatalog({ planning: null, policyEvidence: policy });
		const beds = data.find((d) => d.id === 'policy-igmh-hospital-beds')!;
		expect(beds.rows.map((r) => [r.key, r.value])).toEqual([
			['2024', 421],
			['2025', null],
			['2026', 537]
		]);
		expect(beds.rows[1].sourceIds).toEqual([]);
		expect(beds.rows[1].detail).toContain('calendar year');
	});
	it('uses a route-by-hour heatmap for dense dated departure counts', () => {
		const hourly = catalog.find((d) => d.id === 'schedule-hourly-departures')!;
		expect(hourly.defaultChart).toBe('heatmap');
		expect(hourly.join.domain).toBe('greater-male:service-hours');
		expect(new Set(hourly.rows.map((r) => r.key)).size).toBe(24);
		expect(
			hourly.rows.filter((row) => Number(row.key) < 15).every((row) => row.value === null)
		).toBe(true);
		expect(hourly.rows.some((row) => row.key === '15' && row.value !== null && row.value > 0)).toBe(
			true
		);
		const capturedTotal = planning.transit.patterns.reduce(
			(sum, pattern) =>
				sum + (pattern.timing.kind === 'scheduled' ? pattern.timing.trips.length : 0),
			0
		);
		expect(hourly.rows.reduce((sum, row) => sum + (row.value ?? 0), 0)).toBe(capturedTotal);
	});
	it('marks assumed service records separately instead of implying a published timetable', () => {
		const baseline = {
			...planning,
			transit: {
				...planning.transit,
				patterns: planning.transit.patterns.map((p, index) => ({
					...p,
					provenance: index === 0 ? ('assumed' as const) : p.provenance
				}))
			}
		};
		const data = createAnalyticalCatalog({ planning: baseline });
		const departures = data.find((d) => d.id === 'schedule-departures')!;
		expect(departures.evidence).toBe('mixed');
		expect(departures.rows[0].evidence).toBe('modelled');
		expect(data.find((d) => d.id === 'schedule-hourly-departures')!.rows[0].evidence).toBe(
			'modelled'
		);
	});
	it('keeps official projections and unknown airport-island population distinct from census counts', () => {
		const census = catalog.find((d) => d.id === 'population-greater-male-2022')!;
		const projection = catalog.find((d) => d.id === 'population-greater-male-2026')!;
		expect(census.evidence).toBe('observed');
		expect(projection.evidence).toBe('projected');
		expect(census.rows.find((r) => r.key === 'hulhule')!.value).toBe(802);
		expect(projection.rows.find((r) => r.key === 'hulhule')!.value).toBeNull();
		expect(catalog.find((d) => d.id === 'population-grid-2026')!.evidence).toBe('modelled');
		expect(catalog.find((d) => d.id === 'population-national-2026')!.rows).toHaveLength(
			operations.nationalReadiness.length
		);
	});
	it('preserves missing published hospital occupancy instead of inventing zero', () => {
		const occupancy = catalog.find((d) => d.id === 'policy-igmh-occupancy-ratio')!;
		expect(occupancy.rows.find((r) => r.period === '2024')!.value).toBeNull();
		expect(occupancy.rows.find((r) => r.period === '2025')!.value).toBe(45.9);
		expect(occupancy.defaultChart).toBe('bar');
	});
	it('attributes population charts to their controlling numeric source ahead of geometry receipts', () => {
		const census = catalog.find((d) => d.id === 'population-greater-male-2022')!;
		const projection = catalog.find((d) => d.id === 'population-greater-male-2026')!;
		expect(census.sources[0].id).toBe('mbs-census2022-male-table');
		expect(projection.sources[0].id).toBe('mbs-island-projections');
		expect(projection.sourceUrl).toContain('IslandLevelProjection');
		expect(projection.sources.some((s) => s.id === 'osm-geofabrik')).toBe(true);
	});
	it('retains all aviation observations in disjoint chart views without adding overlapping totals', () => {
		const airport = catalog.filter((d) => d.id.startsWith('aviation-'));
		expect(airport.reduce((n, d) => n + d.rows.length, 0)).toBe(
			rawContext.layers.flights.observations.length
		);
		expect(airport.some((d) => d.rows.length === 12 && d.join.grain === 'month')).toBe(true);
		for (const d of airport)
			expect(new Set(d.rows.map((r) => `${r.key}:${r.series || ''}`)).size).toBe(d.rows.length);
	});
	it('retains source receipt metadata and absent groups without fabricating source collection dates', () => {
		const demographics = catalog.find((d) => d.id === 'demographics-sex-2030')!;
		expect(demographics.rows.filter((r) => r.key === 'hulhule').map((r) => r.value)).toEqual([
			null,
			null
		]);
		const projections = demographics.sources.find((s) => s.id === 'mbs-island-projections')!;
		expect(projections.retrievedAt).toBe(
			planning.sources.find((s) => s.id === 'mbs-island-projections')!.fetchedAt
		);
		expect(projections.publisher).toBeUndefined();
		expect(projections.checksum).toMatch(/^[a-f0-9]{64}$/);
	});
	it('retains passenger category geography without permitting unsupported cross-mode joins', () => {
		const prediction = {
			monthly: [
				{
					seriesId: 'bus',
					name: 'Bus',
					geography: 'Published bus category',
					unit: 'passenger movements',
					sourceUrl: 'https://example.org/workbook',
					history: [{ month: '2025-01', value: 20 }],
					qualification: 'No route allocation'
				},
				{
					seriesId: 'ferry',
					name: 'Ferry',
					geography: 'Published ferry endpoint',
					unit: 'passenger movements',
					sourceUrl: 'https://example.org/workbook',
					history: [{ month: '2025-01', value: 10 }],
					qualification: 'No route allocation'
				}
			],
			dataQualityNotes: []
		} as unknown as ForecastBundle;
		const data = createAnalyticalCatalog({ planning: null, prediction });
		expect(data).toHaveLength(2);
		expect(data[0].sources[0].retrievedAt).toBeUndefined();
		expect(compatibility(data[0], data[1]).compatible).toBe(false);
	});
	it('inserts missing passenger calendar months without attributing them to a source', () => {
		const prediction = {
			monthly: [
				{
					seriesId: 'bus',
					name: 'Bus',
					geography: 'Published bus category',
					unit: 'passenger movements',
					sourceUrl: 'https://example.org/workbook',
					history: [
						{ month: '2025-01', value: 20 },
						{ month: '2025-03', value: 30 }
					],
					qualification: 'No route allocation'
				}
			],
			dataQualityNotes: []
		} as unknown as ForecastBundle;
		const data = createAnalyticalCatalog({ planning: null, prediction });
		expect(data[0].rows.map((r) => r.value)).toEqual([20, null, 30]);
		expect(data[0].rows[1].sourceIds).toEqual([]);
		expect(data[0].rows[1].detail).toContain('No observation');
	});
	it('keeps observed passenger notes focused on the history and relevant bus publication ambiguity', () => {
		const prediction = {
			monthly: [
				{
					seriesId: 'bus',
					mode: 'bus',
					name: 'Bus',
					geography: 'Published bus category',
					unit: 'passenger movements',
					sourceUrl: 'https://example.org/workbook',
					lastActualMonth: '2026-05',
					history: [{ month: '2026-05', value: 20 }],
					qualification: 'No route allocation.'
				}
			],
			dataQualityNotes: [
				'All six June 2026 bus categories repeat May exactly.',
				'Private vehicle capture has no source timestamp.',
				'Backtests are exploratory.'
			]
		} as unknown as ForecastBundle;
		const data = createAnalyticalCatalog({ planning: null, prediction });
		expect(data[0].limitations.join(' ')).toContain('June is excluded');
		expect(data[0].limitations.join(' ')).toContain('revisions');
		expect(data[0].limitations.join(' ')).not.toContain('Private vehicle capture');
		expect(data[0].limitations.join(' ')).not.toContain('Backtests');
	});
});
