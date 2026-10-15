<script lang="ts">
	import { onMount } from 'svelte';
	import { SvelteMap, SvelteURLSearchParams } from 'svelte/reactivity';
	import {
		ArrowUpRight,
		BarChart3,
		ChevronLeft,
		ChevronRight,
		Database,
		Download,
		FileJson,
		Plus,
		Save,
		Search,
		Trash2,
		Upload,
		X
	} from '@lucide/svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import { api } from '#lib/api.js';

	type Column = {
		name: string;
		type: string;
		nullable: boolean;
		missing_count: number;
		distinct_count: number;
		examples: string[];
	};
	type Dataset = {
		id: string;
		title: string;
		category: string;
		row_count: number | null;
		status: string;
		columns: Column[];
		qualification: string;
		provenance?: {
			receipt: { artifact: string; sha256: string; data_status: string };
			timestamps: Record<string, string>;
			sources: {
				id: string;
				title?: string;
				url?: string;
				publisher?: string;
				referencePeriod?: string;
			}[];
		};
	};
	type Rule = {
		column: string;
		op: 'eq' | 'ne' | 'contains' | 'in' | 'gte' | 'lte' | 'gt' | 'lt' | 'missing';
		value: unknown;
	};
	type ChartDefinition = {
		group_by: string;
		series_by: string | null;
		measure: string | null;
		aggregation: string;
		filters: Rule[];
		q: string | null;
		sort: string;
		descending: boolean;
		limit: number;
	};
	type ChartItem = {
		group: string;
		series: string | null;
		value: number | null;
		raw_value?: number | null;
		row_count: number;
		missing_measure_count: number;
	};
	type ChartResult = {
		items: ChartItem[];
		total_groups: number;
		matched_rows: number;
		truncated: boolean;
		qualification: string;
		dataset?: Dataset;
		datasets?: Dataset[];
		base_key?: string | null;
		unit?: string;
	};
	type RowResult = {
		items: Record<string, unknown>[];
		total: number;
		limit: number;
		offset: number;
		dataset: Dataset;
	};
	type Story = {
		id: string;
		title: string;
		insight: string;
		updatedAt: string;
		version: 1;
		primaryId: string;
		comparisonId: string;
		primary: ChartDefinition;
		comparison: ChartDefinition;
		chartType: string;
		mode: string;
		alignment: string;
		keyDomain: string;
		receipts: unknown[];
	};
	const storageKey = 'mobility-v3-data-stories';
	let catalogue = $state<Dataset[]>([]);
	let datasetId = $state('passenger-monthly');
	let comparisonId = $state('');
	let groupBy = $state('month');
	let seriesBy = $state('name');
	let measure = $state('value');
	let aggregation = $state('sum');
	let comparisonGroup = $state('');
	let comparisonSeries = $state('');
	let comparisonMeasure = $state('');
	let comparisonAggregation = $state('mean');
	let comparisonFilters = $state<Rule[]>([]);
	let filters = $state<Rule[]>([]);
	let filterColumn = $state('');
	let filterOp = $state<Rule['op']>('eq');
	let filterValue = $state('');
	let filterScope = $state('primary');
	let search = $state('');
	let appliedSearch = $state('');
	let chartType = $state('line');
	let mode = $state('indexed');
	let alignment = $state('common');
	let keyDomain = $state('calendar-month');
	let chartLimit = $state('200');
	let chartSort = $state('group');
	let chartDescending = $state(false);
	let comparisonSort = $state('group');
	let comparisonDescending = $state(false);
	let comparisonLimit = $state<number | null>(null);
	let chart = $state<ChartResult | null>(null);
	let builtSignature = $state('');
	let chartSeriesLabel = $state('value');
	let rows = $state<RowResult | null>(null);
	let selectedColumns = $state<string[]>([]);
	let sortColumn = $state('');
	let descending = $state(false);
	let page = $state(0);
	let view = $state('chart');
	let loading = $state(true);
	let drawing = $state(false);
	let rowsLoading = $state(false);
	let exporting = $state(false);
	let error = $state('');
	let message = $state('');
	let stories = $state<Story[]>([]);
	let storyId = $state('');
	let storyTitle = $state('');
	let insight = $state('');
	let storageBlocked = $state(false);
	let importInput = $state<HTMLInputElement | null>(null);
	let plotElement = $state<SVGSVGElement | null>(null);
	let chartContainerWidth = $state(960);
	let viewportWidth = $state(1440);
	let settingsOpen = $state(false);
	let controller: AbortController | undefined;
	let rowController: AbortController | undefined;
	let initialController: AbortController | undefined;
	const dataset = $derived(catalogue.find((item) => item.id === datasetId));
	const comparison = $derived(catalogue.find((item) => item.id === comparisonId));
	const categories = $derived([...new Set(catalogue.map((item) => item.category))]);
	const columns = $derived(dataset?.columns ?? []);
	const numericColumns = $derived(columns.filter((item) => item.type === 'number'));
	const filterColumns = $derived(
		filterScope === 'comparison' ? (comparison?.columns ?? []) : columns
	);
	const pageCount = $derived(Math.max(1, Math.ceil((rows?.total ?? 0) / 12)));
	const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
	const compactFormatter = new Intl.NumberFormat('en-US', {
		notation: 'compact',
		maximumFractionDigits: 1
	});
	const number = (value: unknown) =>
		typeof value === 'number'
			? numberFormatter.format(value)
			: value == null
				? 'Not reported'
				: String(value);
	const compact = (value: number) => compactFormatter.format(value);
	const colors = [
		'#8fa976',
		'#a99acc',
		'#dfb997',
		'#7d9ea3',
		'#d7a0b5',
		'#a8b5cd',
		'#c6b56f',
		'#7baf9c'
	];
	const legend = $derived(
		[...new Set((chart?.items ?? []).map((item) => item.series ?? chartSeriesLabel))].map(
			(name, index) => ({ name, color: colors[index % colors.length] })
		)
	);
	const plot = $derived.by(() => {
		if (!chart?.items.length) return null;
		const groups = [...new Set(chart.items.map((item) => item.group))];
		const rowsBySeries = new SvelteMap<string, SvelteMap<string, ChartItem>>();
		for (const item of chart.items) {
			const name = item.series ?? chartSeriesLabel;
			let groupRows = rowsBySeries.get(name);
			if (!groupRows) {
				groupRows = new SvelteMap();
				rowsBySeries.set(name, groupRows);
			}
			if (!groupRows.has(item.group)) groupRows.set(item.group, item);
		}
		const values = chart.items
			.map((item) => item.value)
			.filter((value): value is number => value !== null && Number.isFinite(value));
		const minimum = Math.min(0, ...values),
			maximum = Math.max(1, ...values) * 1.08;
		const width = Math.min(960, Math.max(260, chartContainerWidth || 960)),
			height = 320,
			left = chartType === 'heatmap' ? 110 : 65,
			top = 22,
			bottom = 64,
			plotWidth = width - left - 22,
			plotHeight = height - top - bottom;
		const y = (value: number) => top + ((maximum - value) / (maximum - minimum)) * plotHeight;
		const slot = plotWidth / Math.max(1, groups.length);
		const x = (index: number) => left + slot * (index + 0.5);
		const entries = legend.map((series, seriesIndex) => {
			const points = groups.map((group, index) => {
				const row = rowsBySeries.get(series.name)?.get(group);
				return {
					group,
					x: x(index),
					y: row?.value == null ? null : y(row.value),
					value: row?.value ?? null,
					raw: row?.raw_value,
					color: series.color,
					series: series.name,
					index,
					seriesIndex
				};
			});
			let path = '',
				open = false;
			for (const point of points) {
				if (point.y === null) {
					open = false;
					continue;
				}
				path += `${open ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)} `;
				open = true;
			}
			return { ...series, points, path };
		});
		const pairs =
			entries.length === 2
				? groups.flatMap((group, index) => {
						const a = entries[0].points[index],
							b = entries[1].points[index];
						return a.value !== null && b.value !== null ? [{ group, x: a.value, y: b.value }] : [];
					})
				: [];
		const xMax = Math.max(1, ...pairs.map((item) => item.x)) * 1.08,
			yMax = Math.max(1, ...pairs.map((item) => item.y)) * 1.08;
		const xMin = Math.min(0, ...pairs.map((item) => item.x)),
			yMin = Math.min(0, ...pairs.map((item) => item.y));
		return {
			groups,
			entries,
			pairs,
			xMax,
			yMax,
			xMin,
			yMin,
			width,
			height,
			left,
			top,
			bottom,
			slot,
			plotWidth,
			plotHeight,
			minimum,
			maximum,
			y,
			x,
			zeroY: y(0),
			barWidth: Math.max(0.5, (slot * 0.75) / Math.max(1, entries.length)),
			labelStep: Math.max(1, Math.ceil(groups.length / Math.max(2, Math.floor(plotWidth / 105))))
		};
	});
	const scatterAvailable = $derived((plot?.pairs.length ?? 0) >= 3 && legend.length === 2);
	const chartLabel = $derived(storyTitle.trim() || dataset?.title || 'Data story');
	const chartSources = $derived(chart?.datasets ?? (chart?.dataset ? [chart.dataset] : []));
	const chartDirty = $derived(!!chart && builtSignature !== definitionSignature());

	function defaultColumns(item: Dataset) {
		return [
			...new Set(
				[
					'id',
					'name',
					'month',
					'refPeriod',
					'geography',
					'islandId',
					'island_id',
					'category',
					'value',
					'unit',
					...item.columns.map((column) => column.name)
				].filter((name) => item.columns.some((column) => column.name === name))
			)
		].slice(0, 8);
	}
	function chooseDataset(id: string) {
		const next = catalogue.find((item) => item.id === id);
		if (!next) return;
		datasetId = id;
		chart = null;
		rows = null;
		comparisonId = '';
		comparisonFilters = [];
		filters = [];
		search = '';
		appliedSearch = '';
		sortColumn = '';
		page = 0;
		storyId = '';
		storyTitle = '';
		insight = '';
		message = '';
		error = '';
		selectedColumns = defaultColumns(next);
		const names = next.columns.map((item) => item.name);
		groupBy = names.includes('month')
			? 'month'
			: names.includes('islandId')
				? 'islandId'
				: names.includes('category')
					? 'category'
					: names.includes('refPeriod')
						? 'refPeriod'
						: names.includes('atoll')
							? 'atoll'
							: names.includes('name')
								? 'name'
								: (names[0] ?? '');
		seriesBy = id === 'passenger-monthly' ? 'name' : '';
		measure = names.includes('value')
			? 'value'
			: (next.columns.find((item) => item.type === 'number')?.name ?? '');
		aggregation = id === 'passenger-monthly' ? 'sum' : 'count';
		chartSort = 'group';
		chartDescending = false;
		comparisonSort = 'group';
		comparisonDescending = false;
		comparisonLimit = null;
		chartType = groupBy === 'month' ? 'line' : 'bar';
		keyDomain = groupBy === 'month' ? 'calendar-month' : 'category';
		void refresh();
	}
	function chooseComparison(id: string) {
		comparisonId = id;
		comparisonFilters = [];
		comparisonSort = 'group';
		comparisonDescending = false;
		comparisonLimit = null;
		const next = catalogue.find((item) => item.id === id);
		const names = next?.columns.map((item) => item.name) ?? [];
		comparisonGroup = names.includes(groupBy)
			? groupBy
			: names.includes('refPeriod')
				? 'refPeriod'
				: (names[0] ?? '');
		comparisonSeries = '';
		comparisonMeasure = names.includes(measure)
			? measure
			: (next?.columns.find((item) => item.type === 'number')?.name ?? '');
		comparisonAggregation = aggregation;
	}
	function definitions() {
		const primary: ChartDefinition = {
			group_by: groupBy,
			series_by: seriesBy || null,
			measure: aggregation === 'count' ? null : measure || null,
			aggregation,
			filters,
			q: appliedSearch || null,
			sort: chartSort,
			descending: chartDescending,
			limit: Number(chartLimit)
		};
		const secondary: ChartDefinition = {
			group_by: comparisonGroup,
			series_by: comparisonSeries || null,
			measure: comparisonAggregation === 'count' ? null : comparisonMeasure || null,
			aggregation: comparisonAggregation,
			filters: comparisonFilters,
			q: null,
			sort: comparisonSort,
			descending: comparisonDescending,
			limit: comparisonLimit ?? Number(chartLimit)
		};
		return { primary, secondary };
	}
	function definitionSignature() {
		const { primary, secondary } = definitions();
		return JSON.stringify({
			datasetId,
			primary,
			comparisonId,
			...(comparisonId ? { secondary, mode, alignment, keyDomain } : {})
		});
	}
	async function draw() {
		if (!groupBy || !dataset) {
			chart = null;
			return;
		}
		controller?.abort();
		const request = new AbortController();
		controller = request;
		drawing = true;
		error = '';
		const { primary, secondary } = definitions();
		const signature = definitionSignature();
		try {
			const result = comparisonId
				? await api<ChartResult>(
						'datasets/compare',
						{
							primary: { dataset_id: datasetId, query: primary },
							comparison: { dataset_id: comparisonId, query: secondary },
							mode,
							alignment,
							key_domain: keyDomain
						},
						request.signal
					)
				: await api<ChartResult>(`datasets/${datasetId}/chart`, primary, request.signal);
			if (!request.signal.aborted) {
				chart = result;
				builtSignature = signature;
				chartSeriesLabel = primary.aggregation === 'count' ? 'Records' : primary.measure || 'Value';
			}
		} catch (caught) {
			if (!request.signal.aborted) {
				chart = null;
				error = caught instanceof Error ? caught.message : 'The chart could not be built.';
			}
		} finally {
			if (controller === request) drawing = false;
		}
	}
	async function loadRows() {
		rowController?.abort();
		const request = new AbortController();
		rowController = request;
		rowsLoading = true;
		try {
			const result = await api<RowResult>(
				`datasets/${datasetId}/query`,
				{
					q: appliedSearch || null,
					filters,
					sort: sortColumn || null,
					descending,
					limit: 12,
					offset: page * 12,
					columns: selectedColumns.length ? selectedColumns : null
				},
				request.signal
			);
			if (!request.signal.aborted) rows = result;
		} catch (caught) {
			if (!request.signal.aborted)
				error = caught instanceof Error ? caught.message : 'Records could not be loaded.';
		} finally {
			if (rowController === request) rowsLoading = false;
		}
	}
	async function refresh() {
		appliedSearch = search.trim();
		page = 0;
		await Promise.all([draw(), loadRows()]);
	}
	function addFilter() {
		if (!filterColumn) return;
		const column = filterColumns.find((item) => item.name === filterColumn);
		let value: unknown = filterValue;
		if (filterOp === 'missing') value = true;
		else if (column?.type === 'number' && filterOp !== 'contains') {
			value = Number(filterValue);
			if (!filterValue.trim() || !Number.isFinite(value as number)) {
				error = 'Enter a finite numeric filter value.';
				return;
			}
		} else if (column?.type === 'boolean') {
			if (!['true', 'false'].includes(filterValue.toLowerCase())) {
				error = 'Boolean filters use true or false.';
				return;
			}
			value = filterValue.toLowerCase() === 'true';
		}
		const rule: Rule = { column: filterColumn, op: filterOp, value };
		if (filterScope === 'comparison') comparisonFilters = [...comparisonFilters, rule];
		else filters = [...filters, rule];
		filterValue = '';
		error = '';
	}
	function removeFilter(index: number, secondary = false) {
		if (secondary) comparisonFilters = comparisonFilters.filter((_, i) => i !== index);
		else filters = filters.filter((_, i) => i !== index);
	}
	function toggleColumn(name: string) {
		selectedColumns = selectedColumns.includes(name)
			? selectedColumns.filter((item) => item !== name)
			: [...selectedColumns, name];
	}
	function download(contents: string, name: string, type: string) {
		const url = URL.createObjectURL(new Blob([contents], { type }));
		const anchor = document.createElement('a');
		anchor.href = url;
		anchor.download = name;
		anchor.click();
		URL.revokeObjectURL(url);
	}
	async function exportRows() {
		exporting = true;
		error = '';
		try {
			const query = new SvelteURLSearchParams({ filters: JSON.stringify(filters) });
			if (appliedSearch) query.set('q', appliedSearch);
			if (sortColumn) {
				query.set('sort', sortColumn);
				query.set('descending', String(descending));
			}
			if (selectedColumns.length) query.set('columns', selectedColumns.join(','));
			const response = await fetch(`/api/backend/datasets/${datasetId}/export.csv?${query}`);
			if (!response.ok) throw new Error('The dataset export could not be prepared.');
			download(await response.text(), `${datasetId}-filtered.csv`, 'text/csv;charset=utf-8');
			message = 'All filtered records exported, with spreadsheet formula strings neutralized.';
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Export failed.';
		} finally {
			exporting = false;
		}
	}
	function exportChartCsv() {
		if (!chart || chartDirty || drawing) return;
		const cell = (value: unknown) => {
			const text = String(value ?? '');
			const safe = typeof value === 'string' && /^[=+@\-\t\r]/.test(text) ? `'${text}` : text;
			return `"${safe.replaceAll('"', '""')}"`;
		};
		download(
			[
				'group,series,value,raw_value,row_count,missing_measure_count',
				...chart.items.map((item) =>
					[
						item.group,
						item.series,
						item.value,
						item.raw_value,
						item.row_count,
						item.missing_measure_count
					]
						.map(cell)
						.join(',')
				)
			].join('\n'),
			`${datasetId}-chart.csv`,
			'text/csv;charset=utf-8'
		);
	}
	function exportSvg() {
		if (!plotElement || chartDirty || drawing) return;
		const svg = plotElement.cloneNode(true) as SVGSVGElement;
		svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
		const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
		style.textContent = 'text{font-family:Inter,Arial,sans-serif;font-size:11px;fill:#716879}';
		svg.prepend(style);
		download(new XMLSerializer().serializeToString(svg), `${datasetId}-chart.svg`, 'image/svg+xml');
	}
	function story(): Story {
		const { primary, secondary } = definitions();
		return {
			id: storyId || crypto.randomUUID(),
			title: chartLabel.slice(0, 120),
			insight: insight.trim().slice(0, 3000),
			updatedAt: new Date().toISOString(),
			version: 1,
			primaryId: datasetId,
			comparisonId,
			primary,
			comparison: secondary,
			chartType,
			mode,
			alignment,
			keyDomain,
			receipts: chartSources.map((item) => item.provenance?.receipt)
		};
	}
	function validStory(value: unknown): value is Story {
		if (!value || typeof value !== 'object') return false;
		const text = (value: unknown, maximum: number, minimum = 0): value is string =>
			typeof value === 'string' && value.length >= minimum && value.length <= maximum;
		const optionalColumn = (value: unknown) => value === null || text(value, 180);
		const scalar = (value: unknown) =>
			value === null ||
			typeof value === 'string' ||
			typeof value === 'boolean' ||
			(typeof value === 'number' && Number.isFinite(value));
		const validRule = (value: unknown) => {
			if (!value || typeof value !== 'object') return false;
			const rule = value as Rule;
			if (
				!text(rule.column, 180, 1) ||
				!['eq', 'ne', 'contains', 'in', 'gte', 'lte', 'gt', 'lt', 'missing'].includes(rule.op)
			)
				return false;
			if (rule.op === 'in')
				return Array.isArray(rule.value) && rule.value.length <= 500 && rule.value.every(scalar);
			if (rule.op === 'missing') return rule.value === null || typeof rule.value === 'boolean';
			if (['gte', 'lte', 'gt', 'lt'].includes(rule.op))
				return typeof rule.value === 'number' && Number.isFinite(rule.value);
			if (rule.op === 'contains') return text(rule.value, 1000);
			return scalar(rule.value);
		};
		const validDefinition = (value: unknown, active = true) => {
			if (!value || typeof value !== 'object') return false;
			const definition = value as ChartDefinition;
			return (
				text(definition.group_by, 180, active ? 1 : 0) &&
				optionalColumn(definition.series_by) &&
				optionalColumn(definition.measure) &&
				['count', 'sum', 'mean', 'min', 'max'].includes(definition.aggregation) &&
				(!active || definition.aggregation === 'count' || !!definition.measure) &&
				Array.isArray(definition.filters) &&
				definition.filters.length <= 30 &&
				definition.filters.every(validRule) &&
				(definition.q === null || text(definition.q, 300)) &&
				['group', 'value'].includes(definition.sort) &&
				typeof definition.descending === 'boolean' &&
				Number.isInteger(definition.limit) &&
				definition.limit >= 1 &&
				definition.limit <= 500
			);
		};
		const candidate = value as Story;
		return (
			candidate.version === 1 &&
			text(candidate.id, 160, 1) &&
			text(candidate.title, 120, 1) &&
			text(candidate.insight, 3000) &&
			text(candidate.updatedAt, 40, 1) &&
			Number.isFinite(Date.parse(candidate.updatedAt)) &&
			text(candidate.primaryId, 160, 1) &&
			/^[a-z0-9-]+$/.test(candidate.primaryId) &&
			text(candidate.comparisonId, 160) &&
			(!candidate.comparisonId || /^[a-z0-9-]+$/.test(candidate.comparisonId)) &&
			['bar', 'line', 'scatter', 'heatmap'].includes(candidate.chartType) &&
			['values', 'indexed'].includes(candidate.mode) &&
			['common', 'union'].includes(candidate.alignment) &&
			['calendar-month', 'calendar-year', 'island-id', 'category'].includes(candidate.keyDomain) &&
			validDefinition(candidate.primary) &&
			validDefinition(candidate.comparison, !!candidate.comparisonId) &&
			Array.isArray(candidate.receipts) &&
			candidate.receipts.length <= 2 &&
			candidate.receipts.every((receipt) => {
				if (!receipt || typeof receipt !== 'object') return false;
				const source = receipt as Record<string, unknown>;
				return (
					text(source.artifact, 200, 1) &&
					text(source.sha256, 64, 64) &&
					/^[a-f0-9]{64}$/i.test(source.sha256)
				);
			})
		);
	}
	function persist(next: Story[]) {
		if (storageBlocked) {
			error = 'Saved-story storage is unavailable. Export the definition to keep this story.';
			return false;
		}
		try {
			localStorage.setItem(storageKey, JSON.stringify(next));
			stories = next;
			return true;
		} catch {
			error = 'Browser storage could not save the story. Export the definition instead.';
			return false;
		}
	}
	function save() {
		if (!chart || chartDirty || drawing) return;
		const candidate = story();
		if (!storyId && stories.length >= 20) {
			error = 'Twenty stories are saved. Remove one before saving another.';
			return;
		}
		if (persist([candidate, ...stories.filter((item) => item.id !== candidate.id)])) {
			storyId = candidate.id;
			message =
				'Story saved in this browser. Reopening uses current source data with the saved query.';
		}
	}
	function openStory(saved: Story) {
		if (
			!catalogue.some((item) => item.id === saved.primaryId) ||
			(saved.comparisonId && !catalogue.some((item) => item.id === saved.comparisonId))
		) {
			error = 'A saved collection is unavailable. Its original definition has been kept.';
			return;
		}
		chart = null;
		rows = null;
		datasetId = saved.primaryId;
		comparisonId = saved.comparisonId;
		groupBy = saved.primary.group_by;
		seriesBy = saved.primary.series_by ?? '';
		measure = saved.primary.measure ?? '';
		aggregation = saved.primary.aggregation;
		filters = saved.primary.filters;
		search = saved.primary.q ?? '';
		appliedSearch = search;
		chartLimit = String(saved.primary.limit);
		chartSort = saved.primary.sort;
		chartDescending = saved.primary.descending;
		comparisonSort = saved.comparison.sort;
		comparisonDescending = saved.comparison.descending;
		comparisonLimit = saved.comparison.limit;
		comparisonGroup = saved.comparison?.group_by ?? '';
		comparisonSeries = saved.comparison?.series_by ?? '';
		comparisonMeasure = saved.comparison?.measure ?? '';
		comparisonAggregation = saved.comparison?.aggregation ?? 'count';
		comparisonFilters = saved.comparison?.filters ?? [];
		chartType = saved.chartType;
		mode = saved.mode;
		alignment = saved.alignment;
		keyDomain = saved.keyDomain;
		storyId = saved.id;
		storyTitle = saved.title;
		insight = saved.insight;
		selectedColumns = defaultColumns(catalogue.find((item) => item.id === datasetId)!);
		page = 0;
		sortColumn = '';
		message = 'Saved definition reopened against the current source receipts.';
		view = 'chart';
		void refresh();
	}
	async function importStory(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		try {
			if (file.size > 100000) throw new Error('Definition must be smaller than 100 KB.');
			const value = JSON.parse(await file.text());
			if (!validStory(value)) throw new Error('This is not a supported data story definition.');
			openStory(value);
		} catch (caught) {
			error = caught instanceof Error ? caught.message : 'Import failed.';
		} finally {
			input.value = '';
		}
	}
	onMount(() => {
		try {
			const raw = localStorage.getItem(storageKey);
			if (raw) {
				const saved = JSON.parse(raw);
				if (!Array.isArray(saved) || !saved.every(validStory)) {
					storageBlocked = true;
					message =
						'Stored stories could not be read. The original browser data has been preserved.';
				} else stories = saved.slice(0, 20);
			}
		} catch {
			storageBlocked = true;
			message = 'Browser saved-story storage is unavailable. JSON exports still work.';
		}
		const request = new AbortController();
		initialController = request;
		void (async () => {
			try {
				const result = await api<{ items: Dataset[] }>('datasets', undefined, request.signal);
				if (request.signal.aborted) return;
				catalogue = result.items;
				const item =
					result.items.find((item) => item.id === datasetId && item.status === 'available') ??
					result.items.find((item) => item.status === 'available');
				if (item) chooseDataset(item.id);
			} catch (caught) {
				if (!request.signal.aborted)
					error =
						caught instanceof Error ? caught.message : 'The dataset catalogue could not be loaded.';
			} finally {
				if (!request.signal.aborted) loading = false;
			}
		})();
		return () => {
			initialController?.abort();
			controller?.abort();
			rowController?.abort();
		};
	});
</script>

<svelte:window bind:innerWidth={viewportWidth} />
<section class="data-studio" aria-label="Multi-dataset explorer and chart builder">
	<input
		type="file"
		accept=".json,application/json"
		bind:this={importInput}
		onchange={importStory}
		class="sr-only"
		aria-label="Import data story definition"
	/>
	<header class="studio-heading">
		<div>
			<span class="eyebrow">FROM EVIDENCE TO A DATA STORY</span>
			<h1>Data studio</h1>
			<p>Explore the source records, build a comparison, and save what you learned.</p>
		</div>
		<Badge variant="secondary"
			><Database size={13} />{catalogue.filter((item) => item.status === 'available').length} source collections</Badge
		>
	</header>
	{#if error}<div class="feedback error" role="alert">{error}</div>{/if}{#if message}<div
			class="feedback success"
			role="status"
		>
			{message}
		</div>{/if}
	{#if loading}<Card.Root class="loading-state" role="status"
			><Database size={25} />
			<h2>Opening the source catalogue…</h2>
			<p>Each collection keeps its original grain, dates and evidence limits.</p></Card.Root
		>{:else if dataset}
		<Card.Root class="collection-card"
			><div class="collection-header">
				<div>
					<label for="studio-collection" class="eyebrow">1 · CHOOSE YOUR EVIDENCE</label
					><NativeSelect.Root
						id="studio-collection"
						value={datasetId}
						onchange={(event) => chooseDataset(event.currentTarget.value)}
						>{#each categories as category (category)}<optgroup label={category}
								>{#each catalogue.filter((item) => item.category === category) as item (item.id)}<option
										value={item.id}
										disabled={item.status !== 'available'}
										>{item.title} · {number(item.row_count)} records</option
									>{/each}</optgroup
							>{/each}</NativeSelect.Root
					>
				</div>
				<div class="collection-stats">
					<span><strong>{number(dataset.row_count)}</strong> source records</span><span
						><strong>{columns.length}</strong> typed columns</span
					><span><strong>{rows?.total ?? '—'}</strong> matched records</span>
				</div>
			</div>
			<p class="qualification">{dataset.qualification}</p></Card.Root
		>
		<Tabs.Root bind:value={view} class="studio-tabs"
			><Tabs.List aria-label="Data studio views"
				><Tabs.Trigger value="chart">Build a chart</Tabs.Trigger><Tabs.Trigger value="records"
					>Inspect records</Tabs.Trigger
				><Tabs.Trigger value="stories"
					>Saved stories <span class="tab-count">{stories.length}</span></Tabs.Trigger
				></Tabs.List
			>
			<Tabs.Content value="chart"
				><div class="builder-layout">
					<Card.Root class="builder-controls"
						><details
							class="chart-settings"
							open={viewportWidth > 760 || settingsOpen}
							ontoggle={(event) => {
								if (viewportWidth <= 760) settingsOpen = event.currentTarget.open;
							}}
						>
							<summary>Chart settings</summary>
							<div class="settings-fields">
								<div>
									<span class="eyebrow">2 · FRAME THE QUESTION</span>
									<h2>Chart settings</h2>
								</div>
								<div class="field">
									<label for="studio-group">Group / horizontal axis</label><NativeSelect.Root
										id="studio-group"
										bind:value={groupBy}
										>{#each columns as column (column.name)}<option value={column.name}
												>{column.name}</option
											>{/each}</NativeSelect.Root
									>
								</div>
								<div class="field">
									<label for="studio-aggregation">Measure</label><NativeSelect.Root
										id="studio-aggregation"
										bind:value={aggregation}
										><option value="count">Count records</option><option value="sum">Sum</option
										><option value="mean">Mean</option><option value="min">Minimum</option><option
											value="max">Maximum</option
										></NativeSelect.Root
									>
								</div>
								{#if aggregation !== 'count'}<div class="field">
										<label for="studio-measure">Numeric column</label><NativeSelect.Root
											id="studio-measure"
											bind:value={measure}
											>{#each numericColumns as column (column.name)}<option value={column.name}
													>{column.name}</option
												>{/each}</NativeSelect.Root
										>
									</div>{/if}
								<div class="field">
									<label for="studio-series">Split into series</label><NativeSelect.Root
										id="studio-series"
										bind:value={seriesBy}
										><option value="">One series</option
										>{#each columns as column (column.name)}<option value={column.name}
												>{column.name}</option
											>{/each}</NativeSelect.Root
									>
								</div>
								<div class="field">
									<label for="studio-comparison">Compare another collection</label
									><NativeSelect.Root
										id="studio-comparison"
										value={comparisonId}
										onchange={(event) => chooseComparison(event.currentTarget.value)}
										><option value="">No second collection</option
										>{#each catalogue.filter((item) => item.status === 'available') as item (item.id)}<option
												value={item.id}>{item.title}</option
											>{/each}</NativeSelect.Root
									>
								</div>
								{#if comparison}<div class="comparison-settings">
										<span class="eyebrow">COMPARISON COLLECTION</span>
										<p>{comparison.qualification}</p>
										<div class="field">
											<label for="comparison-group">Matching key</label><NativeSelect.Root
												id="comparison-group"
												bind:value={comparisonGroup}
												>{#each comparison.columns as column (column.name)}<option
														value={column.name}>{column.name}</option
													>{/each}</NativeSelect.Root
											>
										</div>
										<div class="field">
											<label for="comparison-aggregation">Comparison measure</label
											><NativeSelect.Root
												id="comparison-aggregation"
												bind:value={comparisonAggregation}
												><option value="count">Count records</option><option value="sum">Sum</option
												><option value="mean">Mean</option><option value="min">Minimum</option
												><option value="max">Maximum</option></NativeSelect.Root
											>
										</div>
										{#if comparisonAggregation !== 'count'}<div class="field">
												<label for="comparison-measure">Comparison numeric column</label
												><NativeSelect.Root id="comparison-measure" bind:value={comparisonMeasure}
													>{#each comparison.columns.filter((item) => item.type === 'number') as column (column.name)}<option
															value={column.name}>{column.name}</option
														>{/each}</NativeSelect.Root
												>
											</div>{/if}
										<div class="field">
											<label for="comparison-series">Comparison series</label><NativeSelect.Root
												id="comparison-series"
												bind:value={comparisonSeries}
												><option value="">One series</option
												>{#each comparison.columns as column (column.name)}<option
														value={column.name}>{column.name}</option
													>{/each}</NativeSelect.Root
											>
										</div>
										<div class="field">
											<label for="comparison-mode">Values or relative change</label
											><NativeSelect.Root id="comparison-mode" bind:value={mode}
												><option value="indexed">Index · common base = 100</option><option
													value="values">Original values · matching units</option
												></NativeSelect.Root
											>
										</div>
										<div class="field">
											<label for="comparison-alignment">Observation alignment</label
											><NativeSelect.Root id="comparison-alignment" bind:value={alignment}
												><option value="common">Shared keys only</option><option value="union"
													>All keys · keep gaps missing</option
												></NativeSelect.Root
											>
										</div>
										<div class="field">
											<label for="comparison-domain">Declared matching grain</label
											><NativeSelect.Root id="comparison-domain" bind:value={keyDomain}
												><option value="calendar-month">Calendar month</option><option
													value="calendar-year">Calendar year</option
												><option value="island-id">Exact island identifier</option><option
													value="category">Explicit category key</option
												></NativeSelect.Root
											>
										</div>
									</div>{/if}
								<details class="filter-details">
									<summary
										>Filter the source scope <span>{filters.length + comparisonFilters.length}</span
										></summary
									>
									<div class="filter-builder">
										{#if comparison}<NativeSelect.Root
												aria-label="Filter source collection"
												bind:value={filterScope}
												><option value="primary">Primary collection</option><option
													value="comparison">Comparison collection</option
												></NativeSelect.Root
											>{/if}<NativeSelect.Root aria-label="Filter column" bind:value={filterColumn}
											><option value="">Choose a column</option
											>{#each filterColumns as column (column.name)}<option value={column.name}
													>{column.name}</option
												>{/each}</NativeSelect.Root
										><NativeSelect.Root aria-label="Filter operator" bind:value={filterOp}
											><option value="eq">Equals</option><option value="ne">Does not equal</option
											><option value="contains">Contains text</option><option value="gte"
												>At least</option
											><option value="lte">At most</option><option value="missing"
												>Missing / not reported</option
											></NativeSelect.Root
										>{#if filterOp !== 'missing'}<Input
												aria-label="Filter value"
												bind:value={filterValue}
												placeholder="Source value"
											/>{/if}<Button
											size="sm"
											variant="outline"
											disabled={!filterColumn}
											onclick={addFilter}><Plus size={13} /> Add filter</Button
										>
									</div>
								</details>
								{#each filters as rule, index (`primary-${index}-${rule.column}`)}<div
										class="filter-chip"
									>
										<span>{rule.column} {rule.op} {String(rule.value)}</span><Button
											variant="ghost"
											size="icon-sm"
											aria-label={`Remove filter ${rule.column}`}
											onclick={() => removeFilter(index)}><X size={12} /></Button
										>
									</div>{/each}{#each comparisonFilters as rule, index (`comparison-${index}-${rule.column}`)}<div
										class="filter-chip"
									>
										<span>B · {rule.column} {rule.op} {String(rule.value)}</span><Button
											variant="ghost"
											size="icon-sm"
											aria-label={`Remove comparison filter ${rule.column}`}
											onclick={() => removeFilter(index, true)}><X size={12} /></Button
										>
									</div>{/each}
								<div class="field">
									<label for="studio-limit">Maximum groups</label><NativeSelect.Root
										id="studio-limit"
										bind:value={chartLimit}
										>{#if !['50', '200', '500'].includes(chartLimit)}<option value={chartLimit}
												>{chartLimit} groups · imported</option
											>{/if}<option value="50">50 groups</option><option value="200"
											>200 groups</option
										><option value="500">500 groups</option></NativeSelect.Root
									>
								</div>
								<Button disabled={drawing || !groupBy} onclick={refresh}
									><BarChart3 size={14} />{drawing ? 'Building…' : 'Build chart'}</Button
								>
								<p class="settings-note">
									Missing measures stay missing. Mixed units require a filter or separate grouping;
									count means records.
								</p>
							</div>
						</details></Card.Root
					>
					<div class="story-preview">
						<Card.Root class="chart-card"
							><div class="chart-heading">
								<div>
									<span class="eyebrow">3 · READ THE PATTERN</span>
									<h2>{chartLabel}</h2>
									<p>
										{chart
											? `${number(chart.matched_rows)} filtered source records · ${number(chart.total_groups)} groups`
											: 'Choose the scope, then build the chart.'}{chart?.base_key
											? ` · base ${chart.base_key} = 100`
											: ''}
									</p>
								</div>
								<NativeSelect.Root aria-label="Chart design" bind:value={chartType}
									><option value="line">Line · trends</option><option value="bar"
										>Bars · amounts</option
									><option value="heatmap">Heatmap · intensity</option><option
										value="scatter"
										disabled={!scatterAvailable}>Scatter · paired relationships</option
									></NativeSelect.Root
								>
							</div>
							{#if chartDirty}<p class="chart-warning" role="status">
									Settings have changed. Build the chart to apply them before saving or exporting.
								</p>{/if}
							{#if chart?.truncated}<p class="chart-warning">
									Showing the first {chart.items.length} series groups. The source aggregation used all
									filtered records; increase the limit or narrow the filter for a complete comparison.
								</p>{/if}
							{#if plot}<div class="plot-wrap" bind:clientWidth={chartContainerWidth}>
									<svg
										bind:this={plotElement}
										viewBox={`0 0 ${plot.width} ${plot.height}`}
										role="img"
										aria-label={`${chartLabel}. ${chartType} chart. Exact values are available in the table and CSV.`}
										><title>{chartLabel}</title><rect
											width={plot.width}
											height={plot.height}
											fill="white"
										/>
										{#if chartType === 'heatmap'}{#each plot.entries as series, seriesIndex (series.name)}<text
													x={plot.left - 10}
													y={36 + seriesIndex * Math.min(60, 200 / plot.entries.length)}
													text-anchor="end"
													>{series.name.length > 13
														? series.name.slice(0, 12) + '…'
														: series.name}</text
												>{#each series.points as point (point.group)}<rect
														x={point.x - plot.slot / 2 + 1}
														y={22 + seriesIndex * Math.min(60, 200 / plot.entries.length)}
														width={Math.max(0.5, plot.slot - 2)}
														height={Math.min(55, 190 / plot.entries.length)}
														rx="3"
														fill={point.value === null
															? '#f1eef5'
															: point.value < 0
																? '#a99acc'
																: '#83a96c'}
														fill-opacity={point.value === null
															? 1
															: 0.15 +
																(0.85 * Math.abs(point.value)) /
																	Math.max(Math.abs(plot.minimum), plot.maximum)}
														><title>{point.group} · {series.name}: {number(point.value)}</title
														></rect
													>{/each}{/each}{#each plot.groups as group, index (group)}{#if index % plot.labelStep === 0}<text
														x={plot.x(index)}
														y="292"
														text-anchor="middle"
														>{group.length > 14 ? group.slice(0, 13) + '…' : group}</text
													>{/if}{/each}
										{:else if chartType === 'scatter' && scatterAvailable}{#each [0, 0.5, 1] as fraction (fraction)}<line
													x1={plot.left}
													x2={plot.width - 22}
													y1={plot.top + (1 - fraction) * plot.plotHeight}
													y2={plot.top + (1 - fraction) * plot.plotHeight}
													stroke="#eeebf3"
												/><text
													x={plot.left - 12}
													y={plot.top + 4 + (1 - fraction) * plot.plotHeight}
													text-anchor="end"
													>{compact(plot.yMin + (plot.yMax - plot.yMin) * fraction)}</text
												><text
													x={plot.left + fraction * plot.plotWidth}
													y="282"
													text-anchor="middle"
													>{compact(plot.xMin + (plot.xMax - plot.xMin) * fraction)}</text
												>{/each}{#each plot.pairs as pair (pair.group)}<circle
													cx={plot.left +
														((pair.x - plot.xMin) / (plot.xMax - plot.xMin)) * plot.plotWidth}
													cy={plot.top +
														((plot.yMax - pair.y) / (plot.yMax - plot.yMin)) * plot.plotHeight}
													r="5"
													fill="#a99acc"
													fill-opacity=".85"
													><title>{pair.group}: {number(pair.x)} / {number(pair.y)}</title></circle
												>{/each}<text
												x={plot.left + plot.plotWidth / 2}
												y="312"
												text-anchor="middle"
												>{plot.width < 600
													? 'Horizontal: ' +
														((legend[0]?.name ?? '').length > 26
															? (legend[0]?.name ?? '').slice(0, 25) + '…'
															: legend[0]?.name)
													: legend[0]?.name}</text
											>
										{:else}{#each [0, 0.5, 1] as fraction (fraction)}<line
													x1={plot.left}
													x2={plot.width - 22}
													y1={plot.y(plot.minimum + (plot.maximum - plot.minimum) * fraction)}
													y2={plot.y(plot.minimum + (plot.maximum - plot.minimum) * fraction)}
													stroke="#eeebf3"
												/><text
													x={plot.left - 12}
													y={plot.y(plot.minimum + (plot.maximum - plot.minimum) * fraction) + 4}
													text-anchor="end"
													>{compact(plot.minimum + (plot.maximum - plot.minimum) * fraction)}</text
												>{/each}{#each plot.entries as series (series.name)}{#if chartType === 'line'}<path
														d={series.path}
														fill="none"
														stroke={series.color}
														stroke-width="2.5"
													/>{/if}{#each series.points as point (point.group)}{#if point.y !== null}{#if chartType === 'bar'}<rect
																x={point.x - plot.slot * 0.375 + point.seriesIndex * plot.barWidth}
																y={Math.min(point.y, plot.zeroY)}
																width={plot.barWidth * 0.9}
																height={Math.max(0.8, Math.abs(point.y - plot.zeroY))}
																rx="2"
																fill={point.color}
																><title>{point.group} · {point.series}: {number(point.value)}</title
																></rect
															>{:else}<circle
																cx={point.x}
																cy={point.y}
																r={plot.groups.length > 100 ? 1.4 : 2.7}
																fill={point.color}
																><title>{point.group} · {point.series}: {number(point.value)}</title
																></circle
															>{/if}{/if}{/each}{/each}{#each plot.groups as group, index (group)}{#if (index % plot.labelStep === 0 && (index === 0 || index < plot.groups.length - Math.floor(plot.labelStep / 2))) || index === plot.groups.length - 1}<text
														x={plot.x(index)}
														y="290"
														text-anchor="middle"
														>{group.length > 14 ? group.slice(0, 13) + '…' : group}</text
													>{/if}{/each}{/if}</svg
									>
								</div>
								<div class="chart-legend">
									{#each legend as series (series.name)}<span
											><i style:background={series.color}></i>{series.name}</span
										>{/each}
								</div>{:else}<div class="empty-chart">
									<BarChart3 size={29} />
									<h3>{drawing ? 'Preparing the chart…' : 'No chart values at this scope'}</h3>
									<p>
										Choose source columns or remove filters. Unreported values are never replaced
										with invented observations.
									</p>
								</div>{/if}
							{#if chart}<p class="qualification">{chart.qualification}</p>
								<div class="chart-actions">
									<Button
										size="sm"
										variant="outline"
										disabled={chartDirty || drawing}
										onclick={exportChartCsv}><Download size={13} /> Chart CSV</Button
									><Button
										size="sm"
										variant="outline"
										disabled={!plotElement || chartDirty || drawing}
										onclick={exportSvg}><Download size={13} /> Chart SVG</Button
									><Button
										size="sm"
										variant="ghost"
										onclick={() => {
											view = 'records';
										}}><Search size={13} /> Inspect source records</Button
									>
								</div>{/if}
						</Card.Root>
						<Card.Root class="story-card"
							><details class="story-details">
								<summary>Save or share this chart</summary>
								<div class="story-fields">
									<span class="eyebrow">KEEP THE DECISION CONTEXT</span>
									<div class="field">
										<label for="story-title">Story title</label><Input
											id="story-title"
											bind:value={storyTitle}
											placeholder={dataset.title}
											maxlength={120}
										/>
									</div>
									<div class="field">
										<label for="story-insight">What did you observe?</label><textarea
											id="story-insight"
											bind:value={insight}
											placeholder="Describe the pattern, its source scope and what remains uncertain."
											maxlength={3000}
											rows="3"></textarea>
									</div>
									<div class="story-actions">
										<Button
											disabled={!chart || storageBlocked || chartDirty || drawing}
											onclick={save}><Save size={14} /> Save story</Button
										><Button
											variant="outline"
											disabled={!chart || chartDirty || drawing}
											onclick={() =>
												download(
													JSON.stringify(story(), null, 2),
													`${datasetId}-story.json`,
													'application/json'
												)}><FileJson size={14} /> Export definition</Button
										><Button variant="ghost" onclick={() => importInput?.click()}
											><Upload size={14} /> Import</Button
										>
									</div>
								</div>
							</details></Card.Root
						>
						{#if chartSources.length}<Card.Root class="source-card"
								><details>
									<summary>Source receipts and evidence limits</summary
									>{#each chartSources as source, index (`${source.id}-${index}`)}<article>
											<h3>{source.title}</h3>
											<p>{source.qualification}</p>
											<small>SHA-256 {source.provenance?.receipt.sha256}</small>
											<p>
												{Object.entries(source.provenance?.timestamps ?? {})
													.map(([key, value]) => `${key}: ${value}`)
													.join(' · ')}
											</p>
											<div class="source-links">
												{#each (source.provenance?.sources ?? [])
													.filter((item) => item.url)
													.slice(0, 12) as item, index (`${item.id}-${index}`)}<a
														href={item.url}
														target="_blank"
														rel="noreferrer">{item.title ?? item.id}<ArrowUpRight size={12} /></a
													>{/each}
											</div>
										</article>{/each}
								</details></Card.Root
							>{/if}
					</div>
				</div></Tabs.Content
			>
			<Tabs.Content value="records"
				><Card.Root class="records-card"
					><div class="chart-heading">
						<div>
							<span class="eyebrow">READ THE SOURCE ROWS</span>
							<h2>{dataset.title}</h2>
							<p>
								Record counts retain the source grain. Missing values are shown as “Not reported”.
							</p>
						</div>
						<Button variant="outline" size="sm" disabled={exporting} onclick={exportRows}
							><Download size={14} />{exporting ? 'Exporting…' : 'Export filtered CSV'}</Button
						>
					</div>
					<form
						class="record-controls"
						onsubmit={(event) => {
							event.preventDefault();
							void refresh();
						}}
					>
						<div class="search-field">
							<Search size={15} /><Input
								aria-label="Search dataset records"
								bind:value={search}
								placeholder="Search any source value"
							/>
						</div>
						<NativeSelect.Root aria-label="Sort dataset records" bind:value={sortColumn}
							><option value="">Source order</option>{#each columns as column (column.name)}<option
									value={column.name}>{column.name}</option
								>{/each}</NativeSelect.Root
						><NativeSelect.Root aria-label="Dataset sort direction" bind:value={descending}
							><option value={false}>Ascending</option><option value={true}>Descending</option
							></NativeSelect.Root
						><Button type="submit" disabled={rowsLoading}>Apply</Button>
					</form>
					<details class="column-selector">
						<summary>Visible columns · {selectedColumns.length}</summary>
						<div>
							{#each columns as column (column.name)}<label
									><input
										type="checkbox"
										checked={selectedColumns.includes(column.name)}
										onchange={() => toggleColumn(column.name)}
									/>{column.name}<small>{column.type} · {column.missing_count} missing</small
									></label
								>{/each}
						</div>
						<Button
							size="sm"
							variant="outline"
							disabled={!selectedColumns.length}
							onclick={loadRows}>Apply columns</Button
						>
					</details>
					<div class="records-scroll">
						<table>
							<caption class="sr-only">Source dataset records</caption><thead
								><tr
									>{#each selectedColumns as column (column)}<th>{column}</th>{/each}</tr
								></thead
							><tbody
								>{#each rows?.items ?? [] as row, index (`${page}-${index}`)}<tr
										>{#each selectedColumns as column (column)}<td title={number(row[column])}
												><span class:missing={row[column] == null}>{number(row[column])}</span></td
											>{/each}</tr
									>{:else}<tr
										><td colspan={Math.max(1, selectedColumns.length)} class="table-empty"
											>{rowsLoading
												? 'Loading source records…'
												: 'No records match this scope. Clear the search or filters.'}</td
										></tr
									>{/each}</tbody
							>
						</table>
					</div>
					<div class="records-footer">
						<span
							>{rows?.total
								? `${page * 12 + 1}–${Math.min((page + 1) * 12, rows.total)} of ${number(rows.total)} filtered records`
								: 'No matching records'} · {filters.length} active filters</span
						>
						<div>
							<Button
								size="icon-sm"
								variant="outline"
								aria-label="Previous dataset page"
								disabled={page === 0 || rowsLoading}
								onclick={() => {
									page -= 1;
									void loadRows();
								}}><ChevronLeft size={14} /></Button
							><span>{page + 1} / {pageCount}</span><Button
								size="icon-sm"
								variant="outline"
								aria-label="Next dataset page"
								disabled={page >= pageCount - 1 || rowsLoading}
								onclick={() => {
									page += 1;
									void loadRows();
								}}><ChevronRight size={14} /></Button
							>
						</div>
					</div>
					<p class="qualification">{dataset.qualification}</p></Card.Root
				></Tabs.Content
			>
			<Tabs.Content value="stories"
				><Card.Root class="saved-card"
					><div class="chart-heading">
						<div>
							<span class="eyebrow">REUSABLE ANALYSIS</span>
							<h2>Saved data stories</h2>
							<p>
								Definitions are saved in this browser. Current source receipts are loaded when you
								reopen a story.
							</p>
						</div>
						<Button variant="outline" size="sm" onclick={() => importInput?.click()}
							><Upload size={14} /> Import definition</Button
						>
					</div>
					{#each stories as saved (saved.id)}<article class="saved-story">
							<div>
								<Badge variant="secondary"
									>{saved.chartType}{saved.comparisonId ? ' · comparison' : ''}</Badge
								>
								<h3>{saved.title}</h3>
								<p>{saved.insight || 'No written observation yet.'}</p>
								<small
									>Saved {new Date(saved.updatedAt).toLocaleDateString()} · {saved.primaryId}</small
								>
							</div>
							<div class="saved-actions">
								<Button size="sm" onclick={() => openStory(saved)}
									>Open story <ArrowUpRight size={13} /></Button
								><Button
									size="icon-sm"
									variant="outline"
									aria-label={`Export story ${saved.title}`}
									onclick={() =>
										download(
											JSON.stringify(saved, null, 2),
											`story-${saved.id}.json`,
											'application/json'
										)}><Download size={13} /></Button
								><Button
									size="icon-sm"
									variant="ghost"
									aria-label={`Delete story ${saved.title}`}
									onclick={() => {
										if (persist(stories.filter((item) => item.id !== saved.id))) {
											if (storyId === saved.id) storyId = '';
											message = 'The saved story was removed. The source data is unchanged.';
										}
									}}><Trash2 size={13} /></Button
								>
							</div>
						</article>{:else}<div class="empty-chart">
							<Save size={26} />
							<h3>Your first data story starts with a question</h3>
							<p>
								Build a chart, write its source scope and insight, then save the definition for
								later.
							</p>
							<Button
								variant="outline"
								size="sm"
								onclick={() => {
									view = 'chart';
								}}>Build a chart</Button
							>
						</div>{/each}</Card.Root
				></Tabs.Content
			>
		</Tabs.Root>
	{/if}
</section>

<style>
	.data-studio {
		max-width: 1480px;
		padding: 32px 38px 48px;
		margin: 0 auto;
		min-width: 0;
	}
	.studio-heading,
	.collection-header,
	.chart-heading {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 24px;
	}
	.studio-heading {
		margin-bottom: 25px;
	}
	.studio-heading p,
	.chart-heading p {
		color: var(--muted-foreground);
		margin-top: 7px;
	}
	.eyebrow {
		font-size: 10px;
		color: #726781;
		letter-spacing: 1.4px;
		font-weight: 650;
		display: block;
		margin-bottom: 9px;
	}
	.data-studio :global(.collection-card) {
		padding: 22px 25px;
		gap: 10px;
		margin-bottom: 22px;
	}
	.collection-header > div:first-child {
		max-width: 620px;
		min-width: 0;
		flex: 1;
	}
	.collection-header :global([data-slot='native-select-wrapper']) {
		width: 100%;
	}
	.collection-header :global(select) {
		font-size: 14px;
		height: 42px;
		font-weight: 550;
	}
	.collection-stats {
		display: flex;
		gap: 30px;
		flex-shrink: 0;
	}
	.collection-stats span {
		display: flex;
		flex-direction: column;
		gap: 5px;
		color: #786e83;
		font-size: 10px;
	}
	.collection-stats strong {
		color: #36303d;
		font-size: 25px;
		font-weight: 550;
		letter-spacing: -0.8px;
	}
	.qualification {
		color: #716879;
		font-size: 11px;
		line-height: 1.8;
	}
	.data-studio :global(.studio-tabs [data-slot='tabs-list']) {
		margin-bottom: 20px;
		max-width: 100%;
	}
	.tab-count {
		margin-left: 5px;
		font-size: 10px;
	}
	.builder-layout {
		display: grid;
		grid-template-columns: 292px minmax(0, 1fr);
		gap: 22px;
		align-items: start;
	}
	.data-studio :global(.builder-controls) {
		padding: 23px;
		gap: 15px;
	}
	.data-studio :global(.builder-controls h2) {
		font-size: 20px;
	}
	.chart-settings summary {
		display: none;
		font-size: 12px;
		font-weight: 550;
		cursor: pointer;
	}
	.settings-fields {
		display: grid;
		gap: 15px;
	}
	.field {
		display: grid;
		gap: 7px;
		min-width: 0;
	}
	.field label {
		font-size: 11px;
		color: #74697f;
		font-weight: 500;
	}
	.field :global([data-slot='native-select-wrapper']) {
		width: 100%;
	}
	.field :global(select),
	.field :global(input) {
		font-size: 12px;
		height: 38px;
	}
	.settings-note {
		font-size: 10px;
		color: #786c84;
		line-height: 1.8;
	}
	.comparison-settings {
		padding-top: 17px;
		border-top: 1px solid #e8e3ef;
		display: grid;
		gap: 13px;
	}
	.comparison-settings p {
		font-size: 10px;
		color: #776783;
	}
	.filter-details {
		border-top: 1px solid #ece7f2;
		padding-top: 15px;
	}
	.filter-details summary {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 11px;
		font-weight: 550;
		cursor: pointer;
	}
	.filter-details summary span {
		background: #eee7f7;
		padding: 2px 6px;
		border-radius: 5px;
	}
	.filter-builder {
		display: grid;
		gap: 9px;
		margin-top: 15px;
	}
	.filter-builder :global([data-slot='native-select-wrapper']) {
		width: 100%;
	}
	.filter-builder :global(select),
	.filter-builder :global(input) {
		font-size: 11px;
	}
	.filter-chip {
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: #eee8f5;
		padding: 4px 8px;
		border-radius: 8px;
		font-size: 10px;
		color: #766083;
		overflow-wrap: anywhere;
	}
	.story-preview {
		min-width: 0;
		display: grid;
		gap: 20px;
	}
	.data-studio :global(.chart-card) {
		padding: 26px;
		gap: 0;
		min-width: 0;
	}
	.chart-heading {
		margin-bottom: 20px;
	}
	.chart-heading h2 {
		font-size: 22px;
		overflow-wrap: anywhere;
	}
	.chart-heading p {
		font-size: 11px;
	}
	.chart-heading :global(select) {
		font-size: 11px;
	}
	.plot-wrap {
		width: 100%;
		min-width: 0;
	}
	.plot-wrap svg {
		width: 100%;
		height: auto;
		min-height: 230px;
	}
	.plot-wrap text {
		font-size: 10px;
		fill: #776b82;
	}
	.chart-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 10px 20px;
		color: #706178;
		font-size: 10px;
		margin: 10px 0 20px;
	}
	.chart-legend span {
		display: flex;
		align-items: center;
		gap: 7px;
		max-width: 100%;
		overflow-wrap: anywhere;
	}
	.chart-legend i {
		display: inline-block;
		height: 7px;
		width: 12px;
		border-radius: 3px;
		flex-shrink: 0;
	}
	.chart-actions,
	.story-actions {
		display: flex;
		gap: 9px;
		flex-wrap: wrap;
		margin-top: 18px;
	}
	.chart-warning {
		background: #fbf2e4;
		color: #8f6c37;
		padding: 12px;
		margin-bottom: 16px;
		font-size: 11px;
		border-radius: 10px;
	}
	.data-studio :global(.story-card),
	.data-studio :global(.source-card) {
		padding: 23px 26px;
		gap: 14px;
	}
	.story-details summary {
		font-size: 12px;
		font-weight: 550;
		cursor: pointer;
	}
	.story-fields {
		display: grid;
		gap: 14px;
		margin-top: 20px;
	}
	textarea {
		resize: vertical;
		min-height: 88px;
		width: 100%;
		font: inherit;
		font-size: 12px;
		border: 1px solid var(--input);
		border-radius: 8px;
		padding: 11px;
		color: var(--foreground);
		background: white;
		line-height: 1.7;
	}
	textarea:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.data-studio :global(.source-card summary) {
		font-size: 12px;
		font-weight: 550;
		cursor: pointer;
	}
	.data-studio :global(.source-card article) {
		margin-top: 17px;
		padding-top: 17px;
		border-top: 1px solid #ebe6f1;
	}
	.data-studio :global(.source-card article p) {
		font-size: 11px;
		color: #75677e;
		margin-top: 9px;
	}
	.data-studio :global(.source-card article small) {
		display: block;
		font-size: 9px;
		overflow-wrap: anywhere;
		color: #8a7b96;
		margin-top: 12px;
	}
	.source-links {
		display: flex;
		gap: 10px 15px;
		flex-wrap: wrap;
		margin-top: 13px;
	}
	.source-links a {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 10px;
		text-decoration: underline;
		color: #6e587e;
	}
	.feedback {
		margin: 16px 0;
		border-radius: 13px;
		padding: 15px 18px;
		font-size: 12px;
	}
	.feedback.error {
		color: #95473d;
		background: #f9ebe9;
	}
	.feedback.success {
		color: #566b45;
		background: #e7efdf;
	}
	.data-studio :global(.loading-state),
	.empty-chart {
		display: flex;
		align-items: center;
		flex-direction: column;
		justify-content: center;
		text-align: center;
		padding: 50px 25px;
		gap: 13px;
		color: #796b87;
	}
	.empty-chart p {
		font-size: 12px;
		max-width: 470px;
	}
	.data-studio :global(.records-card),
	.data-studio :global(.saved-card) {
		padding: 27px;
		gap: 0;
		min-width: 0;
	}
	.record-controls {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
		margin-bottom: 18px;
		align-items: center;
	}
	.search-field {
		display: flex;
		align-items: center;
		flex: 1;
		min-width: 180px;
		gap: 9px;
		border: 1px solid #e2dbe9;
		padding-left: 12px;
		border-radius: 9px;
	}
	.search-field :global(input) {
		border: 0;
		box-shadow: none;
		width: 100%;
	}
	.column-selector {
		margin-bottom: 19px;
	}
	.column-selector summary {
		font-size: 11px;
		color: #776582;
		cursor: pointer;
	}
	.column-selector > div {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 12px;
		max-height: 280px;
		overflow: auto;
		padding: 17px 0;
	}
	.column-selector label {
		display: flex;
		gap: 7px;
		flex-wrap: wrap;
		align-items: center;
		font-size: 10px;
		overflow-wrap: anywhere;
	}
	.column-selector label small {
		width: 100%;
		padding-left: 20px;
		color: #84748e;
		font-size: 9px;
	}
	.column-selector input {
		width: 13px;
		height: 13px;
		accent-color: #8b74aa;
	}
	.records-scroll {
		overflow: auto;
		min-width: 0;
		max-width: 100%;
	}
	table {
		border-collapse: collapse;
		width: 100%;
		font-size: 11px;
		text-align: left;
	}
	th {
		color: #81738d;
		font-weight: 500;
		font-size: 10px;
		padding: 13px;
		background: #f8f5fc;
		border-bottom: 1px solid #e7e0ee;
		white-space: nowrap;
	}
	td {
		max-width: 300px;
		min-width: 95px;
		padding: 14px 13px;
		border-bottom: 1px solid #efebf4;
		line-height: 1.6;
	}
	td > span {
		display: -webkit-box;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		-webkit-box-orient: vertical;
		overflow: hidden;
		overflow-wrap: anywhere;
	}
	.missing {
		color: #95849e;
		font-style: italic;
	}
	.table-empty {
		padding: 35px;
		text-align: center;
		color: #83738c;
	}
	.records-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 20px;
		margin: 18px 0;
		color: #83718d;
		font-size: 10px;
	}
	.records-footer > div {
		display: flex;
		gap: 12px;
		align-items: center;
	}
	.saved-story {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		padding: 23px 0;
		border-top: 1px solid #e8e0f0;
		gap: 25px;
	}
	.saved-story h3 {
		font-size: 16px;
		margin-top: 11px;
	}
	.saved-story p {
		color: #756381;
		font-size: 12px;
		margin: 8px 0;
		white-space: pre-wrap;
	}
	.saved-story small {
		font-size: 10px;
		color: #92819c;
	}
	.saved-actions {
		display: flex;
		gap: 7px;
		flex-shrink: 0;
	}
	@media (max-width: 1100px) {
		.data-studio {
			padding: 26px;
		}
		.collection-header {
			align-items: flex-start;
			flex-direction: column;
			gap: 18px;
		}
		.collection-header > div:first-child {
			width: 100%;
			max-width: 100%;
		}
		.collection-stats {
			gap: 35px;
		}
		.builder-layout {
			grid-template-columns: 260px minmax(0, 1fr);
			gap: 17px;
		}
		.data-studio :global(.builder-controls) {
			padding: 20px;
		}
		.data-studio :global(.chart-card) {
			padding: 23px;
		}
		.chart-heading {
			align-items: flex-start;
			flex-direction: column;
			gap: 13px;
		}
		.saved-story {
			flex-direction: column;
			gap: 15px;
		}
	}
	@media (max-width: 760px) {
		.builder-layout {
			grid-template-columns: minmax(0, 1fr);
		}
		.settings-fields {
			display: grid;
			grid-template-columns: 1fr 1fr;
		}
		.chart-settings summary {
			display: list-item;
		}
		.chart-settings[open] .settings-fields {
			margin-top: 20px;
		}
		.settings-fields > div:first-child {
			display: none;
		}
		.settings-fields > div:first-child,
		.comparison-settings,
		.filter-details,
		.filter-chip,
		.settings-note {
			grid-column: 1/-1;
		}
		.plot-wrap svg {
			min-height: 210px;
		}
		.column-selector > div {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 600px) {
		.data-studio {
			padding: 23px 14px 36px;
		}
		.studio-heading {
			flex-direction: column;
			align-items: flex-start;
			gap: 15px;
		}
		.studio-heading h1 {
			font-size: 28px;
		}
		.data-studio :global(.collection-card) {
			padding: 19px;
		}
		.collection-stats {
			gap: 25px;
		}
		.collection-stats strong {
			font-size: 23px;
		}
		.collection-stats span {
			font-size: 9px;
		}
		.collection-header :global(select) {
			font-size: 12px;
		}
		.data-studio :global(.builder-controls) {
			padding: 20px 17px;
			gap: 14px;
		}
		.settings-fields {
			grid-template-columns: minmax(0, 1fr);
		}
		.data-studio :global(.chart-card),
		.data-studio :global(.records-card),
		.data-studio :global(.saved-card) {
			padding: 20px 17px;
		}
		.data-studio :global(.story-card),
		.data-studio :global(.source-card) {
			padding: 20px 17px;
		}
		.plot-wrap svg {
			min-height: 160px;
		}
		.chart-heading h2 {
			font-size: 20px;
		}
		.record-controls :global([data-slot='native-select-wrapper']) {
			flex: 1;
			min-width: 0;
		}
		.record-controls :global(select) {
			font-size: 11px;
		}
		.records-footer {
			flex-direction: column;
			align-items: flex-start;
			gap: 14px;
		}
		.saved-actions {
			flex-wrap: wrap;
		}
		.data-studio :global(.studio-tabs [data-slot='tabs-list']) {
			width: 100%;
		}
		.data-studio :global(.studio-tabs [data-slot='tabs-trigger']) {
			font-size: 10px;
			padding: 0 8px;
		}
		.tab-count {
			display: none;
		}
		.column-selector > div {
			grid-template-columns: minmax(0, 1fr);
		}
		.collection-header :global([data-slot='native-select-wrapper']) {
			max-width: 100%;
		}
	}
</style>
