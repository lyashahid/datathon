import type { TransportContext, TransportObservation } from '#lib/context/types.ts';
import type { OperationsBundle } from '#lib/operations/types.ts';
import type { PlanningBaseline } from '#lib/planning/types.ts';
import type { ForecastBundle } from '#lib/prediction/types.ts';
import type { PolicyEvidenceBundle } from '#lib/server/data/policyEvidenceSource.ts';

export type AnalyticalTopic =
	'passengers' | 'population' | 'services' | 'transport' | 'economy' | 'operations';
export type AnalyticalEvidence =
	'observed' | 'projected' | 'modelled' | 'schedule' | 'inventory' | 'mixed';
export type AnalyticalChartType = 'line' | 'bar' | 'scatter' | 'heatmap';
export interface AnalyticalSource {
	id: string;
	title: string;
	url: string;
	publisher?: string;
	referencePeriod?: string;
	retrievedAt?: string;
	coverage?: string;
	checksum?: string;
	licenseStatus?: string;
}
export interface AnalyticalRow {
	/** The documented join key; labels must never be used as join keys. */
	key: string;
	label: string;
	value: number | null;
	series?: string;
	period?: string;
	geography?: string;
	sourceIds: string[];
	evidence?: AnalyticalEvidence;
	detail?: string;
}
export interface AnalyticalDataset {
	id: string;
	title: string;
	description: string;
	topic: AnalyticalTopic;
	evidence: AnalyticalEvidence;
	unit: string;
	sourceTitle: string;
	sourceUrl: string;
	sourceNote: string;
	sources: AnalyticalSource[];
	rows: AnalyticalRow[];
	defaultChart: AnalyticalChartType;
	xLabel: string;
	yLabel: string;
	join: {
		grain: 'month' | 'year' | 'island' | 'constituency' | 'route' | 'sector' | 'category';
		/** Geographic coverage + classification namespace. Equal labels are insufficient. */
		domain: string;
		/** Fixed reference period for non-temporal joins. Temporal keys retain their own periods. */
		period: string | null;
	};
	limitations: string[];
}
export interface AnalyticalCatalogInput {
	planning: PlanningBaseline | null;
	transportContext?: TransportContext | null;
	policyEvidence?: PolicyEvidenceBundle | null;
	operations?: OperationsBundle | null;
	prediction?: ForecastBundle | null;
}

export const analyticalDataGaps = [
	'No measured road congestion, traffic-volume history or validated route-level passenger loads are supplied.',
	'National island population coverage does not provide national transit routing or neighbourhood demand.',
	'No numeric tourism time series is loaded. Airport passenger movements include residents and visitors and are not tourist arrivals.',
	'Imagery, road geometry and operational notices provide context; they do not measure occupancy, road delay or the prevalence of incidents.'
];

const slug = (text: string) =>
	text
		.toLowerCase()
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
const finite = (value: unknown): number | null =>
	typeof value === 'number' && Number.isFinite(value) ? value : null;
const object = (value: unknown): Record<string, unknown> =>
	value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
const strings = (value: unknown): string[] =>
	Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
const optionalText = (value: unknown): string | undefined =>
	typeof value === 'string' && value ? value : undefined;

function calendarMonths(keys: string[]): string[] {
	if (!keys.length || keys.some((key) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(key))) return keys;
	const ordered = keys.toSorted();
	const ordinal = (key: string) => Number(key.slice(0, 4)) * 12 + Number(key.slice(5)) - 1;
	const start = ordinal(ordered[0]);
	const end = ordinal(ordered.at(-1)!);
	// Malformed or implausibly long periods must not expand into unbounded browser work.
	if (end - start > 1200) return ordered;
	return Array.from({ length: end - start + 1 }, (_, offset) => {
		const month = start + offset;
		return `${Math.floor(month / 12)}-${String((month % 12) + 1).padStart(2, '0')}`;
	});
}

function calendarYears(keys: string[]): string[] {
	if (!keys.length || keys.some((key) => !/^\d{4}$/.test(key))) return keys;
	const ordered = keys.toSorted();
	const start = Number(ordered[0]);
	const end = Number(ordered.at(-1)!);
	if (end - start > 100) return ordered;
	return Array.from({ length: end - start + 1 }, (_, offset) =>
		String(start + offset).padStart(4, '0')
	);
}

const calendarKeys = (keys: string[], grain: AnalyticalDataset['join']['grain']) =>
	grain === 'month' ? calendarMonths(keys) : grain === 'year' ? calendarYears(keys) : keys;

function preserveMissingPeriods(rows: AnalyticalRow[], grain: 'month' | 'year'): AnalyticalRow[] {
	const periods = calendarKeys([...new Set(rows.map((row) => row.key))], grain);
	const series = [...new Set(rows.map((row) => row.series || ''))];
	return periods.flatMap((key) =>
		series.flatMap((name) => {
			const matching = rows.filter((row) => row.key === key && (row.series || '') === name);
			if (matching.length) return matching;
			return [
				{
					key,
					label: key,
					value: null,
					series: name || undefined,
					period: key,
					geography: rows.find((row) => (row.series || '') === name)?.geography,
					sourceIds: [],
					detail: `No observation supplied for this calendar ${grain}.`
				}
			];
		})
	);
}

const sourceSummary = (sources: AnalyticalSource[]) =>
	sources.length > 1
		? `${sources[0].title} + ${sources.length - 1} source${sources.length === 2 ? '' : 's'}`
		: sources[0]?.title || 'Retained application snapshot';

/** Adapt retained metadata without manufacturing publisher, freshness or reuse rights. */
function sourceMetadata(value: unknown): AnalyticalSource {
	const row = object(value);
	return {
		id: String(row.id),
		title: optionalText(row.title) || String(row.id),
		url: optionalText(row.url) || '',
		publisher: optionalText(row.publisher),
		referencePeriod:
			optionalText(row.referencePeriod) ||
			(typeof row.referencePeriod === 'number' ? String(row.referencePeriod) : undefined),
		retrievedAt: optionalText(row.retrievedAt) || optionalText(row.fetchedAt),
		coverage: optionalText(row.coverage),
		checksum: optionalText(row.checksum) || optionalText(row.sha256),
		licenseStatus: optionalText(row.licenseStatus) || optionalText(row.license)
	};
}

type DatasetSpec = Omit<
	AnalyticalDataset,
	'sources' | 'sourceTitle' | 'sourceUrl' | 'sourceNote' | 'yLabel' | 'defaultChart'
> & {
	sourceIds?: string[];
	primarySourceIds?: string[];
	sourceNote?: string;
	defaultChart?: AnalyticalChartType;
};

/** Chart-ready views of the data already loaded by the application. No cross-grain allocation. */
export function createAnalyticalCatalog(input: AnalyticalCatalogInput): AnalyticalDataset[] {
	const { planning, transportContext, policyEvidence, operations, prediction } = input;
	const sourceMap = new Map<string, AnalyticalSource>();
	[
		...(planning?.sources || []),
		...(policyEvidence?.sources || []),
		...(operations?.sources || []),
		...(transportContext?.aviation.sources || []),
		...(transportContext?.mpl.sources || []),
		...(transportContext?.followme.sources || [])
	].forEach((source) => {
		const adapted = sourceMetadata(source);
		// Baseline population receipts contain richer metadata than the national readiness subset.
		if (!sourceMap.has(adapted.id)) sourceMap.set(adapted.id, adapted);
	});
	if (prediction) {
		for (const forecast of prediction.monthly) {
			const receipt = prediction.provenance?.sources.find((s) => s.url === forecast.sourceUrl);
			const id = receipt?.id || `passenger-publication:${forecast.seriesId}`;
			if (!sourceMap.has(id))
				sourceMap.set(id, {
					id,
					title: 'MBS Maldives in Figures — retained passenger workbook',
					url: forecast.sourceUrl,
					publisher: 'Maldives Bureau of Statistics',
					checksum: receipt?.sha256
				});
		}
	}
	const datasets: AnalyticalDataset[] = [];
	const add = (spec: DatasetSpec) => {
		if (!spec.rows.length) return;
		const ids = [...new Set([...spec.rows.flatMap((r) => r.sourceIds), ...(spec.sourceIds || [])])];
		const sources = ids
			.flatMap((id) => (sourceMap.has(id) ? [sourceMap.get(id)!] : []))
			.toSorted((a, b) => {
				const priority = (source: AnalyticalSource) =>
					spec.primarySourceIds?.includes(source.id)
						? 0
						: /^(mbs|caa|moe)-|aasandha/i.test(source.id)
							? 1
							: 2;
				return priority(a) - priority(b);
			});
		datasets.push({
			...spec,
			rows:
				spec.join.grain === 'month' || spec.join.grain === 'year'
					? preserveMissingPeriods(spec.rows, spec.join.grain)
					: spec.rows,
			sources,
			sourceTitle: sourceSummary(sources),
			sourceUrl: sources.find((s) => s.url)?.url || '',
			sourceNote: spec.sourceNote || spec.limitations.join(' '),
			yLabel: spec.unit,
			defaultChart:
				spec.defaultChart ||
				(spec.join.grain === 'month' ||
				(spec.join.grain === 'year' && new Set(spec.rows.map((row) => row.key)).size > 2)
					? 'line'
					: 'bar')
		});
	};
	for (const forecast of prediction?.monthly || []) {
		const sourceId =
			prediction?.provenance?.sources.find((s) => s.url === forecast.sourceUrl)?.id ||
			`passenger-publication:${forecast.seriesId}`;
		add({
			id: `passenger-${forecast.seriesId}`,
			title: forecast.name,
			description: `Published monthly passenger movements: ${forecast.geography}.`,
			topic: 'passengers',
			evidence: 'observed',
			unit: forecast.unit,
			xLabel: 'Month',
			join: { grain: 'month', domain: `passenger-category:${forecast.geography}`, period: null },
			rows: forecast.history.map((point) => ({
				key: point.month,
				label: point.month,
				period: point.month,
				geography: forecast.geography,
				value: finite(point.value),
				sourceIds: [sourceId]
			})),
			limitations: [
				forecast.qualification,
				'Passenger movements are not unique people, vehicle loads or route-specific demand. Endpoint categories must not be added together.',
				'Retained published history may contain revisions to earlier months; it is not a frozen record of the first publication.',
				...(forecast.mode === 'bus' &&
				forecast.lastActualMonth === '2026-05' &&
				prediction?.dataQualityNotes.some((note) => /June 2026.*repeat May/i.test(note))
					? [
							'The published June 2026 bus totals repeat May exactly. June is excluded as an ambiguous carry-forward; May 2026 remains the latest retained bus observation.'
						]
					: [])
			]
		});
	}

	const aviation = transportContext?.aviation.records || [];
	const monthlyAviation = new Map<string, TransportObservation[]>();
	for (const row of aviation.filter((r) => r.aggregation === 'reported-month')) {
		const id = row.seriesId || `${row.metric}:${row.unit}:${row.geography}`;
		monthlyAviation.set(id, [...(monthlyAviation.get(id) || []), row]);
	}
	for (const [id, rows] of monthlyAviation) {
		add({
			id: `aviation-${slug(id)}`,
			title: `Velana · ${rows[0].metric.toLowerCase()}`,
			description: `Published monthly ${rows[0].metric.toLowerCase()} at Velana International Airport.`,
			topic: rows[0].unit === 'passenger movements' ? 'passengers' : 'transport',
			evidence: 'observed',
			unit: rows[0].unit,
			xLabel: 'Month',
			join: { grain: 'month', domain: `airport:${rows[0].geography}`, period: null },
			rows: rows
				.toSorted((a, b) => a.refPeriod.localeCompare(b.refPeriod))
				.map((r) => ({
					key: r.refPeriod,
					label: r.refPeriod,
					value: finite(r.value),
					period: r.refPeriod,
					geography: r.geography,
					sourceIds: [r.sourceId],
					detail: r.definition
				})),
			limitations: [
				...new Set(rows.flatMap((r) => (r.definition ? [r.definition] : []))),
				'Counts are published movements, not unique people, tourists or aircraft. Subtotals and totals overlap and must not be summed.'
			]
		});
	}
	// Annual airline-table totals and flight-class subtotals are shown as distinct categories.
	// Other tables' annual values are retained separately, never merged into these overlapping totals.
	const annualAviation = new Map<string, TransportObservation[]>();
	for (const row of aviation.filter((r) => r.aggregation === 'published-total')) {
		const measure = row.metric.split(': ').at(-1) || row.metric;
		const id = `${row.sourceId}:${measure}:${row.unit}:${row.refPeriod}`;
		annualAviation.set(id, [...(annualAviation.get(id) || []), row]);
	}
	for (const [id, rows] of annualAviation) {
		const measure = rows[0].metric.split(': ').at(-1)!;
		add({
			id: `aviation-annual-${slug(id)}`,
			title: `Velana · ${measure.toLowerCase()} (${rows[0].refPeriod})`,
			description:
				'Published annual airport total and flight-class categories. Categories can overlap.',
			topic: rows[0].unit === 'passenger movements' ? 'passengers' : 'transport',
			evidence: 'observed',
			unit: rows[0].unit,
			xLabel: 'Published category',
			join: {
				grain: 'category',
				domain: `airport-classification:${rows[0].sourceId}:${rows[0].geography}`,
				period: rows[0].refPeriod
			},
			rows: rows.map((r) => ({
				key: r.metric.includes(': ') ? r.metric.split(': ')[0] : r.metric,
				label: r.metric.includes(': ') ? r.metric.split(': ')[0] : r.metric,
				value: finite(r.value),
				period: r.refPeriod,
				geography: r.geography,
				sourceIds: [r.sourceId],
				detail: r.definition
			})),
			limitations: [...new Set(rows.flatMap((r) => (r.definition ? [r.definition] : [])))],
			defaultChart: 'bar'
		});
	}

	if (planning) {
		for (const year of [2022, 2026, 2030]) {
			add({
				id: `population-greater-male-${year}`,
				primarySourceIds:
					year === 2022
						? ['mbs-census2022-male-table', 'mbs-census2022-population']
						: ['mbs-island-projections'],
				title: `Greater Malé population · ${year}`,
				description:
					year === 2022
						? 'Published census residents by physical island.'
						: 'Official population projections by physical island.',
				topic: 'population',
				evidence: year === 2022 ? 'observed' : 'projected',
				unit: 'people',
				xLabel: 'Island',
				join: { grain: 'island', domain: 'greater-male:physical-islands', period: String(year) },
				rows: planning.islands.map((island) => ({
					key: island.id,
					label: island.name,
					value: finite(island[year === 2022 ? 'census2022Population' : `population${year}`]),
					period: String(year),
					geography: island.name,
					sourceIds: strings(island.sourceIds),
					detail: optionalText(island.qualification)
				})),
				limitations: [
					'2026 and 2030 are projections, not observed residents. Unavailable Hulhulé projections remain missing, not zero.',
					'Physical-island totals do not measure local trip demand or neighbourhood demographics.'
				]
			});
		}
		for (const dimension of ['sex', 'nationality']) {
			for (const year of [2022, 2026, 2030]) {
				const rows: AnalyticalRow[] = [];
				for (const island of planning.islands) {
					const demographics = object(island.demographics);
					const available = Array.isArray(demographics.availableGroups)
						? demographics.availableGroups
						: [];
					const group = available
						.map(object)
						.find((g) => g.dimension === dimension && g.year === year);
					// Use known classification labels only to retain missing rows for unsupported islands.
					const groups =
						group && Array.isArray(group.groups)
							? group.groups.map(object)
							: dimension === 'sex'
								? [
										{ label: 'Female', value: null },
										{ label: 'Male', value: null }
									]
								: [
										{ label: 'Maldivian residents', value: null },
										{ label: 'Foreign residents', value: null }
									];
					for (const category of groups)
						rows.push({
							key: island.id,
							label: island.name,
							value: finite(category.value),
							series: String(category.label),
							period: String(year),
							geography: island.name,
							sourceIds: strings(group?.sourceIds || island.sourceIds),
							detail:
								optionalText(group?.qualification) ||
								'No matched demographic group supplied for this island and year.'
						});
				}
				add({
					id: `demographics-${dimension}-${year}`,
					title: `Greater Malé · ${dimension === 'sex' ? 'female and male residents' : 'resident nationality'} (${year})`,
					description: `Official physical-island ${dimension} groups, with unsupported values left missing.`,
					topic: 'population',
					evidence: year === 2022 ? 'observed' : 'projected',
					unit: 'people',
					xLabel: 'Island',
					join: { grain: 'island', domain: 'greater-male:physical-islands', period: String(year) },
					rows,
					limitations: [
						'Aggregate groups cannot be allocated to map origins or used as cohort-specific travel demand.',
						'Census counts and population projections have different evidence status.'
					],
					defaultChart: 'bar'
				});
			}
		}
		add({
			id: 'population-grid-2026',
			primarySourceIds: ['mbs-island-projections', 'worldpop2026'],
			title: 'Population assigned to map areas · 2026',
			description:
				'WorldPop spatial estimates calibrated to official island projections; every retained origin is shown.',
			topic: 'population',
			evidence: 'modelled',
			unit: 'people',
			xLabel: 'Map area',
			join: { grain: 'category', domain: 'greater-male:worldpop-origins', period: '2026' },
			rows: planning.origins.map((o) => ({
				key: o.id,
				label: o.id,
				value: finite(o.population2026),
				geography: o.islandId,
				period: '2026',
				sourceIds: strings(o.sourceIds),
				detail: optionalText(o.qualification)
			})),
			limitations: [
				'Spatial estimates are modelled, not block-level census counts. 2030 retains 2026 spatial weights.'
			],
			defaultChart: 'bar'
		});
		const facilityRows: AnalyticalRow[] = [];
		for (const island of planning.islands)
			for (const kind of ['hospital', 'clinic', 'school', 'college'])
				facilityRows.push({
					key: island.id,
					label: island.name,
					series: kind,
					period: planning.referenceDate,
					geography: island.name,
					value: planning.facilities.filter(
						(f) => f.islandId === island.id && f.kind === kind && f.provenance !== 'assumed'
					).length,
					sourceIds: [
						...new Set(
							planning.facilities
								.filter((f) => f.islandId === island.id && f.kind === kind)
								.flatMap((f) => f.sourceIds || [])
						)
					]
				});
		add({
			id: 'facilities-by-island',
			title: 'Mapped facilities by island',
			description:
				'Retained facility locations by type, including records needing operational review.',
			topic: 'services',
			evidence: 'inventory',
			unit: 'mapped locations',
			xLabel: 'Island',
			join: {
				grain: 'island',
				domain: 'greater-male:physical-islands',
				period: planning.referenceDate
			},
			rows: facilityRows,
			limitations: [
				'Counts describe the mapped inventory. A mapped location does not prove capacity, public access, eligibility or opening hours.',
				'Proposed facilities are excluded. Missing institutions are not estimated.'
			]
		});
		add({
			id: 'facility-status',
			title: 'Facility operating evidence',
			description: 'Operating status retained in the reviewed location inventory.',
			topic: 'services',
			evidence: 'inventory',
			unit: 'mapped locations',
			xLabel: 'Recorded status',
			join: {
				grain: 'category',
				domain: 'greater-male:facility-status',
				period: planning.referenceDate
			},
			rows: ['open', 'closed', 'relocated', 'unverified'].map((status) => ({
				key: status,
				label: status,
				value: planning.facilities.filter(
					(f) => (f.operatingStatus || 'unverified') === status && f.provenance !== 'assumed'
				).length,
				sourceIds: [
					...new Set(planning.facilities.flatMap((f) => f.statusSourceIds || f.sourceIds || []))
				],
				period: planning.referenceDate
			})),
			limitations: [
				'Unverified is an evidence gap, not proof of closure. Review dates vary across records.'
			]
		});
		const patterns = planning.transit.patterns.filter((p) => p.enabled !== false);
		const routeSpec = {
			topic: 'transport' as const,
			evidence: (patterns.some((p) => p.provenance === 'assumed')
				? 'mixed'
				: 'schedule') as AnalyticalEvidence,
			xLabel: 'Published route direction',
			join: {
				grain: 'route' as const,
				domain: 'greater-male:published-patterns',
				period: planning.referenceDate
			},
			limitations: [
				'Remaining-departure snapshots are tied to their published service calendar; they are not complete daily service, observed operations or ridership.',
				'Route direction counts must not be treated as unique vehicles.'
			]
		};
		const patternRows = (
			measure: (p: (typeof patterns)[number]) => number | null
		): AnalyticalRow[] =>
			patterns.map((p) => ({
				key: p.id,
				label: p.name,
				value: measure(p),
				sourceIds: p.sourceIds,
				period: planning.referenceDate,
				detail: optionalText(p.qualification),
				evidence: p.provenance === 'assumed' ? 'modelled' : 'schedule'
			}));
		add({
			...routeSpec,
			id: 'schedule-departures',
			title: 'Published departures by route direction',
			description: 'Departures retained in the captured operator timetable snapshot.',
			unit: 'captured scheduled trips',
			rows: patternRows((p) => (p.timing.kind === 'scheduled' ? p.timing.trips.length : null))
		});
		add({
			...routeSpec,
			id: 'schedule-duration',
			title: 'Scheduled journey time by route direction',
			description: 'Mean first-departure to final-arrival time among the captured trips.',
			unit: 'minutes',
			rows: patternRows((p) => {
				if (p.timing.kind !== 'scheduled' || !p.timing.trips.length) return null;
				const durations = p.timing.trips.flatMap((t) =>
					t.stopTimes.length
						? [t.stopTimes.at(-1)!.arrivalMinutes - t.stopTimes[0].departureMinutes]
						: []
				);
				return durations.length
					? durations.reduce((sum, n) => sum + n, 0) / durations.length
					: null;
			})
		});
		add({
			...routeSpec,
			evidence: 'modelled',
			id: 'schedule-distance',
			title: 'Mapped route-direction distance',
			description: 'OSM shortest-path distance retained by the planning network.',
			unit: 'km',
			rows: patternRows((p) => (finite(p.distanceM) === null ? null : p.distanceM! / 1000)).map(
				(r) => ({ ...r, evidence: 'modelled' })
			),
			limitations: [
				'Distances are OSM network estimates, not operator vehicle-km or measured driving traces.'
			]
		});
		const hourlyRows: AnalyticalRow[] = [];
		for (const p of patterns) {
			if (p.timing.kind !== 'scheduled') continue;
			const capture = planning.sources
				.filter((source) => p.sourceIds.includes(source.id))
				.map((source) => object(object(source).serviceCoverage))
				.find(
					(coverage) =>
						coverage.remainingDeparturesOnly === true &&
						finite(coverage.startMinutes) !== null &&
						finite(coverage.endMinutes) !== null
				);
			const captureStart = finite(capture?.startMinutes);
			const captureEnd = finite(capture?.endMinutes);
			for (let hour = 0; hour < 24; hour++)
				hourlyRows.push({
					key: String(hour).padStart(2, '0'),
					label: `${String(hour).padStart(2, '0')}:00`,
					series: p.name,
					evidence: p.provenance === 'assumed' ? 'modelled' : 'schedule',
					value:
						captureStart !== null &&
						captureEnd !== null &&
						(hour * 60 + 59 < captureStart || hour * 60 > captureEnd)
							? null
							: p.timing.trips.filter(
									(t) => Math.floor((t.stopTimes[0]?.departureMinutes ?? -60) / 60) % 24 === hour
								).length,
					sourceIds: p.sourceIds,
					period: planning.referenceDate,
					detail:
						captureStart !== null && captureEnd !== null
							? `Remaining-departure capture covers ${Math.floor(captureStart / 60)
									.toString()
									.padStart(
										2,
										'0'
									)}:${(captureStart % 60).toString().padStart(2, '0')}–${Math.floor(
									captureEnd / 60
								)
									.toString()
									.padStart(
										2,
										'0'
									)}:${(captureEnd % 60).toString().padStart(2, '0')} MVT. Hours outside the capture are not supplied; boundary hours may be partial.`
							: 'Counts of captured departures, not a complete daily service schedule.'
				});
		}
		add({
			...routeSpec,
			id: 'schedule-hourly-departures',
			title: 'Captured departures by hour',
			description:
				'First-stop departures in the retained dated snapshot, grouped by local service hour.',
			unit: 'captured scheduled trips',
			xLabel: 'Service hour (MVT)',
			join: {
				grain: 'category',
				domain: 'greater-male:service-hours',
				period: planning.referenceDate
			},
			rows: hourlyRows,
			limitations: [
				...routeSpec.limitations,
				'Hours outside documented remaining-departure capture coverage are missing, not zero. Boundary hours may be partial.'
			],
			defaultChart: 'heatmap'
		});
	}

	if (operations?.nationalReadiness.length)
		for (const year of [2022, 2026, 2030])
			add({
				id: `population-national-${year}`,
				title: `National island population · ${year}`,
				description:
					'Official administrative-island totals, with Greater Malé physical-island records identified separately.',
				topic: 'population',
				evidence: year === 2022 ? 'observed' : 'projected',
				unit: 'people',
				xLabel: 'Island',
				join: {
					grain: 'island',
					domain: 'national:retained-island-register',
					period: String(year)
				},
				rows: operations.nationalReadiness.map((r) => ({
					key: r.id,
					label: `${r.name} · ${r.atoll}`,
					value:
						r[
							year === 2022
								? 'census2022Population'
								: year === 2026
									? 'population2026'
									: 'population2030'
						],
					sourceIds: r.sourceIds,
					geography: r.atoll,
					period: String(year),
					detail: r.qualification
				})),
				limitations: [
					'The register is not a national routing model. Population projections do not establish travel demand, capacity or access scores.',
					'Administrative-island and Greater Malé physical-island definitions are retained; unsupported totals remain missing.'
				]
			});
	if (policyEvidence) {
		const observations = new Map<string, typeof policyEvidence.observations>();
		for (const row of policyEvidence.observations) {
			const id = `${row.metric}:${row.unit}`;
			observations.set(id, [...(observations.get(id) || []), row]);
		}
		for (const rows of observations.values()) {
			const periods = new Set(rows.map((r) => r.referencePeriod));
			const geographies = new Set(rows.map((r) => r.geography));
			const temporal = periods.size > 1 && geographies.size === 1;
			add({
				id: `policy-${slug(rows[0].metric)}`,
				title: rows[0].metric,
				description: rows[0].definition,
				topic: /IGMH/i.test(rows[0].metric) ? 'services' : 'economy',
				evidence: 'observed',
				unit: rows[0].unit,
				xLabel: temporal ? 'Year' : 'Published geography',
				join: temporal
					? { grain: 'year', domain: `facility:${rows[0].geography}`, period: null }
					: {
							grain: 'category',
							domain: `published-geography:${rows[0].sourceId}`,
							period: [...periods].join(', ')
						},
				rows: rows.map((r) => ({
					key: temporal ? r.referencePeriod : r.geography,
					label: temporal ? r.referencePeriod : r.geography,
					value: r.value,
					period: r.referencePeriod,
					geography: r.geography,
					sourceIds: [r.sourceId],
					detail: r.definition
				})),
				limitations: [
					rows[0].definition,
					...(temporal
						? [
								'Only the retained years are shown. Missing published values are not filled or inferred.'
							]
						: [
								'Published geographies are aggregates; Republic and its subregions overlap and must not be summed. Household survey statistics are historical, not current prices.'
							])
				]
			});
		}
		for (const measure of ['schools', 'enrollment'] as const)
			add({
				id: measure === 'schools' ? 'schools-by-sector' : 'school-enrollment-by-sector',
				title:
					measure === 'schools'
						? 'Published schools by sector'
						: 'Published school enrolment by sector',
				description:
					'Greater Malé sector totals from the published November 2023 regional education tables.',
				topic: 'services',
				evidence: 'observed',
				unit: measure === 'schools' ? 'institutions' : 'enrolled students',
				xLabel: 'Sector',
				join: {
					grain: 'sector',
					domain: 'greater-male:school-sectors',
					period: policyEvidence.schoolCompleteness.referencePeriod
				},
				rows: policyEvidence.schoolCompleteness.sectorCounts.map((r) => ({
					key: r.sector,
					label: r.sector,
					value: r[measure],
					sourceIds: policyEvidence.schoolCompleteness.sourceIds,
					period: policyEvidence.schoolCompleteness.referencePeriod
				})),
				limitations: policyEvidence.schoolCompleteness.limitations
			});
		for (const measure of ['sex', 'nationality', 'age']) {
			const rows = policyEvidence.constituencies.flatMap((c): AnalyticalRow[] => {
				const groups =
					measure === 'sex'
						? [
								{ label: 'Female', value: c.femalePopulation },
								{ label: 'Male', value: c.malePopulation }
							]
						: measure === 'nationality'
							? [
									{ label: 'Maldivian residents', value: c.maldivianPopulation },
									{ label: 'Foreign residents', value: c.foreignPopulation }
								]
							: c.ageGroupsMaldivian;
				return groups.map((g) => ({
					key: c.id,
					label: c.name,
					series: g.label,
					value: g.value,
					period: '2022',
					geography: c.islandId,
					sourceIds: [c.sourceId]
				}));
			});
			add({
				id: `constituency-${measure}-2022`,
				title: `Constituency ${measure === 'sex' ? 'female and male residents' : measure === 'age' ? 'Maldivian age groups' : 'resident nationality'} · 2022`,
				description:
					'Published census constituency groups; constituency boundaries have not been matched to the map.',
				topic: 'population',
				evidence: 'observed',
				unit: 'people',
				xLabel: 'Constituency',
				join: {
					grain: 'constituency',
					domain: `greater-male:census-constituencies:${measure === 'age' ? 'maldivian-residents' : 'all-residents'}`,
					period: '2022'
				},
				rows,
				limitations: [
					'No audited constituency boundaries or cohort distribution at map-origin grain. Constituency counts cannot be allocated to neighbourhood origins.',
					...(measure === 'age'
						? ['Age groups cover Maldivian residents only, not all residents.']
						: [])
				],
				defaultChart: 'bar'
			});
		}
		add({
			id: 'mapped-evidence-coverage',
			title: 'Location coverage of HDC evidence',
			description:
				'Source records with usable study-area geometry and those retained without usable geometry.',
			topic: 'services',
			evidence: 'inventory',
			unit: 'source records',
			xLabel: 'Evidence inventory',
			join: {
				grain: 'category',
				domain: 'hulhumale:hdc-layer-coverage',
				period: policyEvidence.generatedAt
			},
			rows: policyEvidence.layers.flatMap((l) => [
				{
					key: l.id,
					label: l.title,
					series: 'Located',
					value: l.recordCount,
					sourceIds: l.sourceIds,
					period: l.referencePeriod
				},
				{
					key: l.id,
					label: l.title,
					series: 'Unlocated',
					value: l.unlocatedRecords,
					sourceIds: l.sourceIds,
					period: l.referencePeriod
				}
			]),
			limitations: [
				'Inventory counts are coverage diagnostics, not counts of accessible roads, housing occupancy, tree canopy or current facility capacity.'
			]
		});
	}
	if (transportContext?.mpl.observations.length)
		add({
			id: 'port-published-table-rows',
			title: 'Published harbour table entries',
			description: 'Separate categories retained from the dated MPL commercial-harbour tables.',
			topic: 'transport',
			evidence: 'inventory',
			unit: 'published table rows',
			xLabel: 'Publisher table section',
			join: {
				grain: 'category',
				domain: 'mpl:captured-table-sections',
				period: transportContext.mpl.generatedAt
			},
			rows: transportContext.mpl.observations.map((r) => ({
				key: r.id,
				label: r.metric.replace(/^Published /, '').replace(/ rows$/, ''),
				value: r.value,
				sourceIds: [r.sourceId],
				period: r.refPeriod,
				geography: r.geography
			})),
			limitations: [
				'Estimated arrivals are schedules, not confirmed arrivals. Listed-at-port dates include old entries; these counts are not live harbour occupancy or congestion.',
				...transportContext.mpl.gapReasons
			]
		});
	if (operations)
		add({
			id: 'operations-captured-notices',
			title: 'Operational evidence captured',
			description:
				'Counts of retained public weather alerts, road-event candidates and extracted notices.',
			topic: 'operations',
			evidence: 'inventory',
			unit: 'retained records',
			xLabel: 'Evidence category',
			join: {
				grain: 'category',
				domain: 'operations:retained-record-types',
				period: operations.generatedAt
			},
			rows: [
				{
					key: 'weather',
					label: 'Weather messages',
					value: operations.weatherAlerts.length,
					sourceIds: [...new Set(operations.weatherAlerts.map((r) => r.sourceId))]
				},
				{
					key: 'road',
					label: 'Road-event candidates',
					value: operations.roadEvents.length,
					sourceIds: [...new Set(operations.roadEvents.map((r) => r.sourceId))]
				},
				{
					key: 'notice',
					label: 'Extracted notice candidates',
					value: operations.noticeCandidates.length,
					sourceIds: [...new Set(operations.noticeCandidates.map((r) => r.sourceId))]
				}
			],
			limitations: [
				'These are captured records, not active disruptions or event incidence. Categories may overlap. Notices require mapping and validity checks before affecting routes.',
				...operations.gaps
			]
		});
	return datasets;
}

export interface DatasetCompatibility {
	compatible: boolean;
	reason: string;
}

/** Geographic identity, classification and reference periods must match before alignment. */
export function compatibility(a: AnalyticalDataset, b: AnalyticalDataset): DatasetCompatibility {
	if (a.join.grain !== b.join.grain)
		return {
			compatible: false,
			reason:
				'These datasets describe different levels of detail. A monthly total cannot be joined to island or route records.'
		};
	if (a.join.domain !== b.join.domain)
		return {
			compatible: false,
			reason:
				'Geographic coverage or category definitions differ. Matching labels alone would create a misleading comparison.'
		};
	if (a.join.period !== b.join.period)
		return {
			compatible: false,
			reason:
				'Reference periods differ. Compare datasets from the same period; projections and census years cannot be joined as simultaneous observations.'
		};
	if (a.unit !== b.unit && !['month', 'year'].includes(a.join.grain))
		return {
			compatible: false,
			reason:
				'These categorical measures use different units. An arbitrary island or category cannot serve as a time-series index baseline.'
		};
	return {
		compatible: true,
		reason:
			'The documented geography, level of detail and period match. Units are checked when the comparison is built.'
	};
}
export const getCompatibleDatasets = (primary: AnalyticalDataset, datasets: AnalyticalDataset[]) =>
	datasets.filter((d) => d.id !== primary.id && compatibility(primary, d).compatible);

export interface CombinedDatasetResult {
	ok: boolean;
	reason?: string;
	dataset?: AnalyticalDataset;
	commonKeys: string[];
	unmatchedKeys: string[];
	warnings: string[];
}

/** Align measures, never sum overlapping totals or imply causation. Missing cells stay null. */
export function combineDatasets(
	selected: AnalyticalDataset[],
	options: { mode: 'values' | 'indexed'; alignment: 'union' | 'common' }
): CombinedDatasetResult {
	const reject = (reason: string): CombinedDatasetResult => ({
		ok: false,
		reason,
		commonKeys: [],
		unmatchedKeys: [],
		warnings: []
	});
	if (!selected.length) return reject('Select at least one dataset.');
	if (selected.length > 4)
		return reject('Compare up to four datasets so each series remains readable.');
	if (new Set(selected.map((d) => d.id)).size !== selected.length)
		return reject('Select each dataset once.');
	for (const dataset of selected.slice(1)) {
		const check = compatibility(selected[0], dataset);
		if (!check.compatible) return reject(check.reason);
	}
	if (options.mode === 'values' && new Set(selected.map((d) => d.unit)).size > 1)
		return reject(
			'The units differ. Use an indexed comparison instead of placing unlike values on one scale.'
		);
	if (options.mode === 'indexed' && !['month', 'year'].includes(selected[0].join.grain))
		return reject(
			'Indexing is available for monthly or yearly time series. Indexing arbitrary island or category order would invent a baseline.'
		);
	const keysByDataset = selected.map((d) => new Set(d.rows.map((r) => r.key)));
	const rawKeys = [...new Set(selected.flatMap((d) => d.rows.map((r) => r.key)))];
	const allKeys = calendarKeys(rawKeys, selected[0].join.grain);
	if (['month', 'year'].includes(selected[0].join.grain)) allKeys.sort();
	const commonKeys = allKeys.filter((key) => keysByDataset.every((keys) => keys.has(key)));
	const unmatchedKeys = allKeys.filter((key) => !commonKeys.includes(key));
	const alignedKeys = options.alignment === 'common' ? commonKeys : allKeys;
	const keys = calendarKeys(alignedKeys, selected[0].join.grain);
	if (!commonKeys.length)
		return reject(
			'No matching periods or geographic keys are available. The datasets cannot be aligned.'
		);
	const series: { label: string; rows: Map<string, AnalyticalRow>; dataset: AnalyticalDataset }[] =
		[];
	for (const dataset of selected) {
		const groups = new Map<string, Map<string, AnalyticalRow>>();
		for (const row of dataset.rows) {
			const group = row.series || '';
			if (!groups.has(group)) groups.set(group, new Map());
			if (groups.get(group)!.has(row.key))
				return reject(
					`Duplicate keys in ${dataset.title}. Review the data grain before building a comparison.`
				);
			groups.get(group)!.set(row.key, row);
		}
		for (const [group, rows] of groups)
			series.push({ label: group ? `${dataset.title} · ${group}` : dataset.title, rows, dataset });
	}
	if (series.length > 12)
		return reject(
			'This selection produces too many series. Choose a simpler dataset or inspect its existing chart.'
		);
	const baselineKey =
		options.mode === 'indexed'
			? commonKeys.find((key) =>
					series.every((s) => {
						const value = s.rows.get(key)?.value;
						return value !== null && value !== undefined && value > 0;
					})
				)
			: null;
	if (options.mode === 'indexed' && !baselineKey)
		return reject(
			'No common period has a positive observed value for every series. An index cannot be calculated without a valid shared baseline.'
		);
	const labels = new Map(selected.flatMap((d) => d.rows.map((r) => [r.key, r.label] as const)));
	const rows = keys.flatMap((key) =>
		series.map((s): AnalyticalRow => {
			const row = s.rows.get(key);
			const original = row?.value ?? null;
			const value =
				original === null
					? null
					: options.mode === 'indexed'
						? (original / s.rows.get(baselineKey!)!.value!) * 100
						: original;
			return {
				key,
				label: labels.get(key) || key,
				value,
				series: s.label,
				period: row?.period,
				geography: row?.geography,
				sourceIds: row?.sourceIds || [],
				evidence: row?.evidence || s.dataset.evidence,
				detail:
					options.mode === 'indexed'
						? `${original === null ? 'Not supplied' : `${original} ${s.dataset.unit}`}. Index baseline ${baselineKey} = 100.`
						: row?.detail
			};
		})
	);
	const warnings = [
		'Comparison shows patterns in aligned data. It does not establish causes or recommend a policy.',
		...(unmatchedKeys.length
			? [
					`${unmatchedKeys.length} key(s) are absent from one or more datasets; ${options.alignment === 'common' ? 'unmatched values are excluded and missing calendar periods remain empty' : 'their missing values remain empty'}.`
				]
			: []),
		...(baselineKey
			? [
					`All series use ${baselineKey} = 100. The index shows relative change, not original volumes or rates.`
				]
			: [])
	];
	const sources = [
		...new Map(selected.flatMap((d) => d.sources.map((s) => [s.id, s] as const))).values()
	];
	const evidence =
		new Set(selected.map((d) => d.evidence)).size === 1 ? selected[0].evidence : 'mixed';
	return {
		ok: true,
		commonKeys,
		unmatchedKeys,
		warnings,
		dataset: {
			id: `comparison:${selected.map((d) => d.id).join('+')}:${options.mode}:${options.alignment}`,
			title: selected.map((d) => d.title).join(' and '),
			description:
				'Measures aligned by their documented keys, without interpolation or aggregation.',
			topic: selected[0].topic,
			evidence,
			unit: options.mode === 'indexed' ? `index (${baselineKey} = 100)` : selected[0].unit,
			sourceTitle: sourceSummary(sources),
			sourceUrl: sources.find((s) => s.url)?.url || '',
			sourceNote: warnings.join(' '),
			sources,
			rows,
			defaultChart: selected[0].defaultChart,
			xLabel: selected[0].xLabel,
			yLabel: options.mode === 'indexed' ? 'Index' : selected[0].unit,
			join: { ...selected[0].join },
			limitations: [...new Set([...selected.flatMap((d) => d.limitations), ...warnings])]
		}
	};
}
