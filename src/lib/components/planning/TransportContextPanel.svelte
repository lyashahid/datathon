<script lang="ts">
	import {
		ArrowUpRight,
		Check,
		ChevronDown,
		ChevronLeft,
		ChevronRight,
		MapPin,
		Search,
		X
	} from '@lucide/svelte';
	import { Select } from 'bits-ui';
	import { untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { vesselGraphic } from '#lib/context/map.ts';
	import type {
		ContextDataset,
		ContextSource,
		TransportContext,
		TransportObservation,
		VesselObservation
	} from '#lib/context/types.ts';
	import DiscreteTabs from './controls/DiscreteTabs.svelte';
	import TransportGraphic from './graphics/TransportGraphic.svelte';

	let {
		bundle,
		onclose,
		onfocus,
		showVessels,
		showAirport,
		ontoggleVessels,
		ontoggleAirport,
		initialTab = 'boats'
	}: {
		bundle: TransportContext | null;
		onclose: () => void;
		onfocus: (coordinate: [number, number]) => void;
		showVessels: boolean;
		showAirport: boolean;
		ontoggleVessels: (value: boolean) => void;
		ontoggleAirport: (value: boolean) => void;
		initialTab?: 'boats' | 'port' | 'airport';
	} = $props();

	type View = 'boats' | 'port' | 'airport';
	type MonthlyPoint = { month: string; value: number };
	type MonthlySeries = { key: string; record: TransportObservation; points: MonthlyPoint[] };
	const tabs = [
		{ id: 'boats', label: 'Boats' },
		{ id: 'port', label: 'Port calls' },
		{ id: 'airport', label: 'Airport' }
	];
	const PAGE_SIZE = 12;
	let view = $state<View>(untrack(() => initialTab));
	let search = $state('');
	let page = $state(0);
	let seriesKey = $state('');
	const dataset = $derived(
		bundle
			? view === 'boats'
				? bundle.followme
				: view === 'port'
					? bundle.mpl
					: bundle.aviation
			: null
	);
	const vessels = $derived(bundle?.followme.records ?? []);
	const locatedVessels = $derived(vessels.filter((vessel) => validCoordinate(vessel.coordinates)));
	const vesselLayerAvailable = $derived(
		!!bundle?.followme.enabled &&
			['available', 'partial'].includes(bundle.followme.status) &&
			locatedVessels.length > 0
	);
	const airportLayerAvailable = $derived(
		!!bundle?.aviation.enabled &&
			['available', 'partial'].includes(bundle.aviation.status) &&
			bundle.aviation.records.length > 0
	);
	const filteredVessels = $derived(
		vessels.filter((vessel) =>
			`${vessel.name} ${vessel.type} ${vessel.operator ?? ''} ${vessel.locationLabel ?? ''}`
				.toLocaleLowerCase()
				.includes(search.trim().toLocaleLowerCase())
		)
	);
	const filteredCalls = $derived(
		(bundle?.mpl.records ?? []).filter((call) =>
			`${call.vesselName} ${call.activity} ${call.berth ?? ''} ${call.date ?? ''}`
				.toLocaleLowerCase()
				.includes(search.trim().toLocaleLowerCase())
		)
	);
	const rowCount = $derived(view === 'boats' ? filteredVessels.length : filteredCalls.length);
	const pageCount = $derived(Math.max(1, Math.ceil(rowCount / PAGE_SIZE)));
	const activePage = $derived(Math.min(page, pageCount - 1));
	const vesselPage = $derived(
		filteredVessels.slice(activePage * PAGE_SIZE, (activePage + 1) * PAGE_SIZE)
	);
	const callPage = $derived(
		filteredCalls.slice(activePage * PAGE_SIZE, (activePage + 1) * PAGE_SIZE)
	);
	const uncertainTimes = $derived(vessels.some((vessel) => !vessel.observedTimezone));
	const monthlySeries = $derived(buildMonthlySeries(bundle?.aviation.records ?? []));
	const selectedSeries = $derived(
		monthlySeries.find((series) => series.key === seriesKey) ?? monthlySeries[0]
	);
	const latestMetrics = $derived(aviationSummary(bundle?.aviation.records ?? []));
	const sourceMap = $derived(new Map(dataset?.sources.map((source) => [source.id, source]) ?? []));
	const seriesOptions = $derived(
		monthlySeries.map((series) => ({
			value: series.key,
			label: `${series.record.metric} · ${sourceTitle(sourceMap.get(series.record.sourceId))} · ${series.record.geography}`
		}))
	);
	const portMetrics = $derived(
		latestObservations(bundle?.mpl.observations ?? [])
			.sort((a, b) => portPriority(a) - portPriority(b))
			.slice(0, 3)
	);
	const plotMaximum = $derived(
		Math.max(1, ...(selectedSeries?.points.map((point) => point.value) ?? []))
	);
	const plotSegments = $derived.by(() => {
		const points = selectedSeries?.points ?? [];
		if (!points.length) return [];
		const first = monthIndex(points[0].month);
		const span = Math.max(1, monthIndex(points.at(-1)!.month) - first);
		const segments: { x: number; y: number }[][] = [];
		for (let index = 0; index < points.length; index++) {
			const point = points[index];
			if (!index || monthIndex(point.month) !== monthIndex(points[index - 1].month) + 1)
				segments.push([]);
			segments.at(-1)!.push({
				x: 28 + ((monthIndex(point.month) - first) * 504) / span,
				y: 108 - (point.value / plotMaximum) * 88
			});
		}
		return segments;
	});

	function validCoordinate(value: [number, number] | null): value is [number, number] {
		return (
			!!value &&
			value.every(Number.isFinite) &&
			Math.abs(value[0]) <= 180 &&
			Math.abs(value[1]) <= 90
		);
	}
	function safeUrl(value: string): string | undefined {
		try {
			const url = new URL(value);
			return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
		} catch {
			return undefined;
		}
	}
	function formatNumber(value: number, compact = false): string {
		return new Intl.NumberFormat('en-GB', {
			notation: compact ? 'compact' : 'standard',
			maximumFractionDigits: compact ? 2 : Number.isInteger(value) ? 0 : 1
		}).format(value);
	}
	function captured(value: string | null | undefined): string {
		if (!value) return 'Capture date unavailable';
		// Retrieval timestamps are normalized ISO timestamps. Observation times remain raw below.
		const date = new Date(value);
		if (!Number.isFinite(date.getTime())) return value;
		return `${new Intl.DateTimeFormat('en-GB', {
			dateStyle: 'medium',
			timeStyle: 'short',
			timeZone: 'UTC'
		}).format(date)} UTC`;
	}
	function statusLabel(value: ContextDataset<unknown> | null): string {
		if (!value) return 'Preparing data';
		if (value.status === 'unavailable') return 'Unavailable';
		if (value.status === 'disabled' || !value.enabled) return 'Not enabled';
		if (value.stale) return 'Older snapshot';
		return value.status === 'partial' ? 'Partial snapshot' : 'Captured snapshot';
	}
	function monthKey(value: string): string | null {
		return /^\d{4}-(0[1-9]|1[0-2])$/.test(value) ? value : null;
	}
	function monthIndex(value: string): number {
		const [year, month] = value.split('-').map(Number);
		return year * 12 + month - 1;
	}
	function monthLabel(value: string): string {
		return new Intl.DateTimeFormat('en-GB', {
			month: 'short',
			year: 'numeric',
			timeZone: 'UTC'
		}).format(new Date(`${value}-01T00:00:00Z`));
	}
	function groupKey(record: TransportObservation): string {
		return JSON.stringify([
			record.metric,
			record.unit,
			record.sourceId,
			record.geography,
			record.seriesId ?? '',
			record.definition ?? '',
			record.aggregation ?? ''
		]);
	}
	function buildMonthlySeries(records: readonly TransportObservation[]): MonthlySeries[] {
		const groups = new SvelteMap<
			string,
			{ record: TransportObservation; months: Map<string, number>; ambiguous: boolean }
		>();
		for (const record of records) {
			const month = monthKey(record.refPeriod);
			if (
				!month ||
				record.aggregation === 'published-total' ||
				!Number.isFinite(record.value) ||
				record.value < 0
			)
				continue;
			const key = groupKey(record);
			let group = groups.get(key);
			if (!group) {
				group = { record, months: new SvelteMap(), ambiguous: false };
				groups.set(key, group);
			}
			if (group.months.has(month) && group.months.get(month) !== record.value)
				group.ambiguous = true;
			group.months.set(month, record.value);
		}
		return [...groups.entries()]
			.filter(([, group]) => !group.ambiguous && group.months.size >= 3)
			.map(([key, group]) => ({
				key,
				record: group.record,
				points: [...group.months]
					.sort(([a], [b]) => a.localeCompare(b))
					.map(([month, value]) => ({ month, value }))
			}))
			.sort(
				(a, b) =>
					passengerPriority(a.record) - passengerPriority(b.record) ||
					b.points.length - a.points.length ||
					a.key.localeCompare(b.key)
			);
	}
	function passengerPriority(record: TransportObservation): number {
		const metric = record.metric.toLocaleLowerCase();
		if (!/passenger/.test(`${metric} ${record.unit}`)) return 100;
		const tablePreference = /11[.-]13/.test(record.sourceId) ? 0 : 10;
		if (/^international passenger arrivals$/.test(metric)) return tablePreference;
		if (/^international passenger departures$/.test(metric)) return tablePreference + 1;
		if (/^domestic passenger arrivals$/.test(metric)) return tablePreference + 2;
		if (/^domestic passenger departures$/.test(metric)) return tablePreference + 3;
		if (/^total: passenger arrivals$/.test(metric)) return tablePreference + 4;
		if (/^total: passenger departures$/.test(metric)) return tablePreference + 5;
		if (/^international flights: passenger arrivals$/.test(metric)) return tablePreference + 6;
		if (/^domestic flights: passenger arrivals$/.test(metric)) return tablePreference + 7;
		return tablePreference + 8;
	}
	function aviationSummary(records: readonly TransportObservation[]): TransportObservation[] {
		const annual = records.filter(
			(record) =>
				record.aggregation === 'published-total' &&
				/^\d{4}$/.test(record.refPeriod) &&
				Number.isFinite(record.value) &&
				/passenger/i.test(`${record.metric} ${record.unit}`)
		);
		// A summary uses one published source, year and geographic universe throughout.
		// In the current MBS capture, Table 11.13 has the four primary passenger series.
		const groups = new SvelteMap<string, TransportObservation[]>();
		for (const record of annual) {
			const key = JSON.stringify([record.sourceId, record.refPeriod, record.geography]);
			const group = groups.get(key) ?? [];
			group.push(record);
			groups.set(key, group);
		}
		const sourceGroup = [...groups.values()].sort(
			(a, b) =>
				b[0].refPeriod.localeCompare(a[0].refPeriod) ||
				Math.min(...a.map(passengerPriority)) - Math.min(...b.map(passengerPriority)) ||
				a[0].sourceId.localeCompare(b[0].sourceId)
		)[0];
		if (sourceGroup)
			return latestObservations(sourceGroup)
				.sort(
					(a, b) => passengerPriority(a) - passengerPriority(b) || a.metric.localeCompare(b.metric)
				)
				.slice(0, 4);
		return latestObservations(records)
			.filter((record) => /passenger/i.test(`${record.metric} ${record.unit}`))
			.sort((a, b) => passengerPriority(a) - passengerPriority(b))
			.slice(0, 4);
	}
	function periodLabel(record: TransportObservation): string {
		if (record.aggregation === 'published-total' && /^\d{4}$/.test(record.refPeriod))
			return `${record.refPeriod} annual`;
		if (monthKey(record.refPeriod)) return `${monthLabel(record.refPeriod)} monthly`;
		return record.refPeriod;
	}
	function latestObservations(records: readonly TransportObservation[]): TransportObservation[] {
		const groups = new SvelteMap<string, TransportObservation>();
		for (const record of records) {
			if (!Number.isFinite(record.value)) continue;
			const key = groupKey(record);
			const current = groups.get(key);
			if (
				!current ||
				record.refPeriod.localeCompare(current.refPeriod, 'en', { numeric: true }) > 0
			)
				groups.set(key, record);
		}
		return [...groups.values()];
	}
	function selectView(value: string) {
		if (!tabs.some((tab) => tab.id === value)) return;
		view = value as View;
		search = '';
		page = 0;
	}
	function locate(vessel: VesselObservation) {
		if (!validCoordinate(vessel.coordinates)) return;
		if (!showVessels) ontoggleVessels(true);
		onfocus(vessel.coordinates);
	}
	function getSeriesValue(): string {
		return selectedSeries?.key ?? '';
	}
	function setSeriesValue(value: string): void {
		if (monthlySeries.some((series) => series.key === value)) seriesKey = value;
	}
	function portPriority(record: TransportObservation): number {
		if (/estimated arrivals/i.test(record.metric)) return 0;
		if (/^Published arrivals rows$/i.test(record.metric)) return 1;
		if (/vessels at port/i.test(record.metric)) return 2;
		return 3;
	}
	function portMetricLabel(record: TransportObservation): string {
		if (/estimated arrivals/i.test(record.metric)) return 'Expected arrivals';
		if (/^Published arrivals rows$/i.test(record.metric)) return 'Arrivals listed';
		if (/vessels at port/i.test(record.metric)) return 'Listed at port';
		return record.metric.replace(/^Published /i, '').replace(/ rows$/i, '');
	}
	function activityLabel(activity: string): string {
		const labels: Record<string, string> = {
			'estimated-arrival': 'Expected arrival',
			arrival: 'Arrival',
			departure: 'Departure',
			shifting: 'Shifting',
			'listed-at-port': 'At port'
		};
		return labels[activity] ?? (activity ? activity.replace(/[-_]/g, ' ') : 'Not supplied');
	}
	function qualityLabel(value: string): string {
		if (value === 'non-estimated-row-dated-after-retrieval-calendar-date')
			return 'The published activity date is after the capture date, although the source does not label it as an estimate.';
		return value.replace(/[-_]/g, ' ');
	}
	function sourceTitle(source: ContextSource | undefined): string {
		if (!source) return 'Source not identified';
		const table = source.title.match(/Table\s+(\d+(?:\.\d+)?)/i)?.[1];
		return table ? `${source.publisher} · Table ${table}` : source.publisher || source.title;
	}
</script>

<section class="transport-context" aria-labelledby="sea-air-title">
	<header class="context-header">
		<div>
			<p class="eyebrow">Transport context</p>
			<h2 id="sea-air-title">Sea &amp; air</h2>
			<p class="header-note">
				See activity around the islands. These layers do not change your policy results.
			</p>
		</div>
		<button class="close-button" type="button" aria-label="Close Sea and air" onclick={onclose}
			><X size={19} /></button
		>
	</header>
	<div class="context-navigation">
		<DiscreteTabs items={tabs} value={view} onchange={selectView} label="Sea and air view" />
		<span
			class="snapshot-status"
			class:limited={!dataset || dataset.status !== 'available' || dataset.stale}
			>{statusLabel(dataset)}</span
		>
	</div>
	<div class="context-body">
		{#if !bundle}
			<div class="empty-state">
				<TransportGraphic kind="speedboat" size={88} />
				<h3>Preparing sea and air data</h3>
				<p>Public snapshots and their source notes will appear here when available.</p>
			</div>
		{:else}
			{#if view === 'boats'}
				<section class="context-summary">
					<TransportGraphic kind="speedboat" size={94} />
					<div class="summary-copy">
						<p class="eyebrow">FollowMe public directory</p>
						<h3>
							{['unavailable', 'disabled'].includes(bundle.followme.status)
								? 'Boat data unavailable'
								: `${formatNumber(vessels.length)} listed boats`}
						</h3>
						<p>
							Maldives-wide directory · {formatNumber(locatedVessels.length)} sampled positions near Greater
							Malé.
						</p>
					</div>
					<label class="layer-switch"
						><input
							type="checkbox"
							checked={showVessels}
							disabled={!vesselLayerAvailable}
							onchange={(event) => ontoggleVessels(event.currentTarget.checked)}
						/><span>Boats on map</span></label
					>
				</section>
				<p class="attribution">
					Tracking data from <a href="https://followme.mv/" target="_blank" rel="noreferrer"
						>FollowMe Tracking Service <ArrowUpRight size={12} /></a
					>. Public listings are owner controlled; positions may be old or incomplete.
				</p>
				<p class="snapshot-note">
					Cached {captured(bundle.followme.generatedAt)}{bundle.followme.stale
						? ' · Older capture'
						: ''}
				</p>
				{#if uncertainTimes}<p class="data-note">
						Some observation times have no confirmed timezone. Each time below is shown as
						published.
					</p>{/if}
				{#if !vesselLayerAvailable}<p class="data-note">
						The boat map layer is unavailable until a permitted dataset with published coordinates
						is loaded.
					</p>{/if}
			{:else if view === 'port'}
				<section class="context-summary">
					<TransportGraphic kind="cargo-ship" size={94} />
					<div class="summary-copy">
						<p class="eyebrow">Maldives Ports Limited</p>
						<h3>
							{['unavailable', 'disabled'].includes(bundle.mpl.status)
								? 'Port data unavailable'
								: `${formatNumber(bundle.mpl.records.length)} port records`}
						</h3>
						<p>Vessel calls and berth activity from the captured source.</p>
					</div>
					<span class="summary-tag">Port records</span>
				</section>
				<p class="snapshot-note">
					Cached {captured(bundle.mpl.generatedAt)}{bundle.mpl.stale ? ' · Older capture' : ''}
				</p>
				<p class="data-note">
					A berth or port call does not establish a vessel's current position. This directory has no
					map-location controls.
				</p>
				{#if bundle.mpl.records.some((call) => call.timezoneStatus === 'not-stated')}<p
						class="snapshot-note"
					>
						Timezone not supplied. Dates are shown as published.
					</p>{/if}
				{#if bundle.mpl.observations.length}<div class="port-statistics">
						{#each portMetrics as record (record.id)}<div>
								<span>{portMetricLabel(record)}</span><strong>{formatNumber(record.value)}</strong>
								<p>Published snapshot</p>
								{#if record.definition}<details class="metric-definition">
										<summary>Definition</summary>
										<p>{record.definition}</p>
									</details>{/if}
							</div>{/each}
					</div>{/if}
			{:else}
				<section class="context-summary">
					<TransportGraphic kind="airport" size={94} />
					<div class="summary-copy">
						<p class="eyebrow">Published aviation data</p>
						<h3>
							{['unavailable', 'disabled'].includes(bundle.aviation.status)
								? 'Airport data unavailable'
								: 'Airport activity'}
						</h3>
						<p>Dated passenger movements from published statistical tables.</p>
					</div>
					<label class="layer-switch"
						><input
							type="checkbox"
							checked={showAirport}
							disabled={!airportLayerAvailable}
							onchange={(event) => ontoggleAirport(event.currentTarget.checked)}
						/><span>Airport on map</span></label
					>
				</section>
				<p class="snapshot-note">
					Cached {captured(bundle.aviation.generatedAt)}{bundle.aviation.stale
						? ' · Older capture'
						: ''}
				</p>
				<p class="data-note">
					Published aggregates are context, not live aircraft positions or a forecast of new demand.
				</p>
				{#if latestMetrics.length}<p class="passenger-note">
						Passenger movements count arrivals and departures, not unique people. Each card retains
						its published period and source; the values are not added together.
					</p>{/if}
				{#if latestMetrics.length}<div class="aviation-metrics">
						{#each latestMetrics as record (record.id)}<article>
								<span>{record.metric}</span><strong
									title={formatNumber(record.value)}
									aria-label={`${record.metric}: ${formatNumber(record.value)} ${record.unit}`}
									>{formatNumber(record.value, true)} <small>{record.unit}</small></strong
								>
								<p>{periodLabel(record)} · {record.geography}</p>
								<span class="metric-source">{sourceTitle(sourceMap.get(record.sourceId))}</span>
								{#if record.definition}<details class="metric-definition">
										<summary>Definition</summary>
										<p>{record.definition}</p>
									</details>{/if}
							</article>{/each}
					</div>{/if}
				{#if selectedSeries}
					<section class="trend-section" aria-labelledby="aviation-trend-title">
						<div class="section-heading">
							<h3 id="aviation-trend-title">Monthly activity</h3>
							<span>{selectedSeries.record.unit}</span>
						</div>
						{#if monthlySeries.length > 1}<div class="series-picker">
								<Select.Root
									type="single"
									items={seriesOptions}
									bind:value={getSeriesValue, setSeriesValue}
									><Select.Trigger
										class="context-series-trigger"
										aria-label="Monthly aviation series"
										><span>{selectedSeries.record.metric}</span><ChevronDown
											size={16}
											aria-hidden="true"
										/></Select.Trigger
									><Select.Portal
										><Select.Content
											class="context-series-menu"
											align="start"
											sideOffset={6}
											collisionPadding={8}
											strategy="fixed"
											>{#each monthlySeries as series (series.key)}<Select.Item
													value={series.key}
													label={seriesOptions.find((option) => option.value === series.key)
														?.label ?? series.record.metric}
													class="context-series-option"
													>{#snippet children({ selected })}<div>
															<strong>{series.record.metric}</strong><small
																>{sourceTitle(sourceMap.get(series.record.sourceId))} · {series
																	.record.geography}</small
															>
														</div>
														<span aria-hidden="true"
															>{#if selected}<Check size={16} />{/if}</span
														>{/snippet}</Select.Item
												>{/each}</Select.Content
										></Select.Portal
									></Select.Root
								>
							</div>
							<p class="trend-label">
								{sourceTitle(sourceMap.get(selectedSeries.record.sourceId))} · {selectedSeries
									.record.geography}
							</p>{:else}<p class="trend-label">
								{selectedSeries.record.metric} · {selectedSeries.record.geography}
							</p>{/if}
						<svg
							class="trend-chart"
							viewBox="0 0 560 130"
							role="img"
							aria-label={`${selectedSeries.record.metric} by month, ${selectedSeries.record.unit}; zero-based vertical scale`}
							><path
								d="M28 20V108H532M28 64H532"
								fill="none"
								stroke="#dbe5e0"
								stroke-width="1"
							/>{#each plotSegments as segment (segment[0].x)}<polyline
									points={segment.map((point) => `${point.x},${point.y}`).join(' ')}
									fill="none"
									stroke="#2c7e88"
									stroke-width="3"
									stroke-linecap="round"
									stroke-linejoin="round"
								/>{#each segment as point (point.x)}<circle
										cx={point.x}
										cy={point.y}
										r="2.5"
										fill="#2c7e88"
									/>{/each}{/each}<text x="28" y="12">{formatNumber(plotMaximum, true)}</text><text
								x="20"
								y="112"
								text-anchor="end">0</text
							><text x="28" y="126">{monthLabel(selectedSeries.points[0].month)}</text><text
								x="532"
								y="126"
								text-anchor="end">{monthLabel(selectedSeries.points.at(-1)!.month)}</text
							></svg
						>
						<p class="trend-source">
							{sourceTitle(sourceMap.get(selectedSeries.record.sourceId))} · {formatNumber(
								selectedSeries.points.length
							)} published months. Gaps are not filled.
						</p>
						{#if selectedSeries.record.definition}<details class="metric-definition">
								<summary>Series definition</summary>
								<p>{selectedSeries.record.definition}</p>
							</details>{/if}
						<details class="trend-values">
							<summary>See monthly values</summary>
							<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard access to the horizontally scrollable table.) -->
							<div
								class="table-scroll"
								role="region"
								aria-label="Monthly aviation values"
								tabindex="0"
							>
								<table>
									<caption class="sr-only">Source-specific monthly aviation observations</caption
									><thead
										><tr
											><th scope="col">Month</th><th scope="col"
												>{selectedSeries.record.metric} ({selectedSeries.record.unit})</th
											></tr
										></thead
									><tbody
										>{#each selectedSeries.points as point (point.month)}<tr
												><td>{monthLabel(point.month)}</td><td>{formatNumber(point.value)}</td></tr
											>{/each}</tbody
									>
								</table>
							</div>
						</details>
					</section>
				{:else if bundle.aviation.records.length}<p class="data-note">
						A consistent monthly series is not available in this capture. The totals above retain
						their individual sources, units and dates.
					</p>{/if}
			{/if}

			{#if dataset?.gapReasons.length}<details
					class="limitations"
					open={dataset.status === 'unavailable' || dataset.status === 'disabled'}
				>
					<summary
						>{dataset.status === 'unavailable' || dataset.status === 'disabled'
							? 'Why this data is unavailable'
							: 'Coverage and limitations'}</summary
					>
					<ul>
						{#each dataset.gapReasons as reason, index (index)}<li>{reason}</li>{/each}
					</ul>
				</details>{/if}

			{#if view !== 'airport'}
				<div class="directory-heading">
					<h3>{view === 'boats' ? 'Boat directory' : 'Port-call directory'}</h3>
					<span>{formatNumber(rowCount)} {search ? 'matching records' : 'records'}</span>
				</div>
				<label class="directory-search"
					><Search size={16} /><span class="sr-only"
						>{view === 'boats'
							? 'Search boat names, operators or locations'
							: 'Search vessels, activities or berths'}</span
					><input
						type="search"
						value={search}
						placeholder={view === 'boats'
							? 'Search boats, operators or locations'
							: 'Search vessels, activities or berths'}
						oninput={(event) => {
							search = event.currentTarget.value;
							page = 0;
						}}
					/></label
				>
				{#if rowCount}
					{#if view === 'boats'}<ul class="boat-directory">
							{#each vesselPage as vessel (vessel.id)}<li>
									<div class="vessel-mark">
										<TransportGraphic kind={vesselGraphic(vessel.type)} size={37} />
									</div>
									<div class="vessel-copy">
										<strong>{vessel.name}</strong>
										<p>
											{[vessel.type, vessel.operator, vessel.locationLabel]
												.filter(Boolean)
												.join(' · ')}
										</p>
										<span class="observation-time"
											>{vessel.observedAtRaw
												? `${vessel.observedAtRaw}${vessel.observedTimezone ? ` ${vessel.observedTimezone}` : ' · timezone unconfirmed'}`
												: 'Observation time unavailable'}{vessel.lastSeenLabel &&
											!vessel.observedAtRaw
												? ` · At capture: ${vessel.lastSeenLabel}`
												: ''}</span
										>{#if vessel.speedKnots != null}<span class="vessel-speed"
												>Published speed {formatNumber(vessel.speedKnots)} knots</span
											>{/if}
									</div>
									{#if validCoordinate(vessel.coordinates)}<button
											class="locate-button"
											type="button"
											onclick={() => locate(vessel)}
											disabled={!vesselLayerAvailable}
											aria-label={`Show ${vessel.name} published position on map`}
											title="Show captured position on map"
											><MapPin size={15} /><span>On map</span></button
										>{:else}<span class="no-position">No position</span>{/if}
								</li>{/each}
						</ul>
					{:else}<!-- svelte-ignore a11y_no_noninteractive_tabindex (Keyboard access to the horizontally scrollable table.) -->
						<div
							class="table-scroll port-table"
							role="region"
							aria-label="Port calls; scroll horizontally to see all columns"
							tabindex="0"
						>
							<table>
								<caption class="sr-only"
									>Published port calls; dates and berths do not imply current vessel locations</caption
								><thead
									><tr
										><th scope="col">Vessel</th><th scope="col">Activity</th><th scope="col"
											>Published date</th
										><th scope="col">Berth</th></tr
									></thead
								><tbody
									>{#each callPage as call (call.id)}<tr
											><th scope="row">{call.vesselName}</th><td>{activityLabel(call.activity)}</td
											><td
												>{call.rawDate || call.date || 'Not supplied'}
												{#if call.timezoneStatus && call.timezoneStatus !== 'not-stated'}<span
														class="published-time-note">Timezone: {call.timezoneStatus}</span
													>{/if}
												{#if call.qualityFlags?.length}<details class="port-quality">
														<summary>Source notes</summary>
														<ul>
															{#each call.qualityFlags as flag, index (index)}<li>
																	{qualityLabel(flag)}
																</li>{/each}
														</ul>
													</details>{/if}
											</td><td>{call.berth ?? 'Not supplied'}</td></tr
										>{/each}</tbody
								>
							</table>
						</div>{/if}
					<nav
						class="pagination"
						aria-label={view === 'boats' ? 'Boat directory pages' : 'Port call pages'}
					>
						<p>
							{formatNumber(activePage * PAGE_SIZE + 1)}–{formatNumber(
								Math.min((activePage + 1) * PAGE_SIZE, rowCount)
							)} of {formatNumber(rowCount)}
						</p>
						<div>
							<button
								type="button"
								aria-label="Previous directory page"
								disabled={activePage === 0}
								onclick={() => (page = activePage - 1)}><ChevronLeft size={17} /></button
							><span>Page {activePage + 1} / {pageCount}</span><button
								type="button"
								aria-label="Next directory page"
								disabled={activePage >= pageCount - 1}
								onclick={() => (page = activePage + 1)}><ChevronRight size={17} /></button
							>
						</div>
					</nav>
				{:else}<div class="directory-empty">
						<p>
							{search
								? 'No records match this search.'
								: view === 'boats'
									? 'No permitted public boat observations are loaded.'
									: 'No dated port-call records are loaded.'}
						</p>
					</div>{/if}
			{/if}

			<details class="context-sources">
				<summary>Sources and reuse notes <span>{dataset?.sources.length ?? 0}</span></summary
				>{#if dataset?.sources.length}<ul>
						{#each dataset.sources as source (source.id)}<li>
								<h4>
									{#if safeUrl(source.url)}<a
											href={safeUrl(source.url)}
											target="_blank"
											rel="noreferrer">{source.title} <ArrowUpRight size={12} /></a
										>{:else}{source.title}{/if}
								</h4>
								<p>{source.publisher} · {source.referencePeriod}</p>
								<p>{source.coverage}</p>
								<p class="reuse-note">{source.licenseStatus}</p>
								<p class="source-capture">
									Retrieved {captured(source.retrievedAt)} · {source.units}
								</p>
							</li>{/each}
					</ul>{:else}<p>No verified source records are available for this layer.</p>{/if}
			</details>
		{/if}
	</div>
</section>

<style>
	.transport-context {
		display: flex;
		padding: 24px;
		width: 100%;
		min-width: 0;
		min-height: 0;
		max-height: min(780px, var(--transport-panel-height, calc(100dvh - 48px)));
		flex-direction: column;
		color: #224751;
		overflow-wrap: anywhere;
	}
	.transport-context,
	.transport-context * {
		box-sizing: border-box;
	}
	.context-header {
		display: flex;
		flex: 0 0 auto;
		align-items: flex-start;
		justify-content: space-between;
		gap: 20px;
		padding: 3px 0 18px;
	}
	.context-header > div {
		min-width: 0;
	}
	.eyebrow {
		margin: 0 0 5px;
		color: #608178;
		font-size: 12px;
		font-weight: 650;
		letter-spacing: 0.09em;
		text-transform: uppercase;
	}
	h2 {
		margin: 0;
		color: #1c444e;
		font-size: 27px;
		font-weight: 650;
		letter-spacing: -0.04em;
	}
	.header-note {
		max-width: 470px;
		margin: 7px 0 0;
		color: #6b807e;
		font-size: 12px;
		line-height: 1.5;
	}
	button {
		font: inherit;
		cursor: pointer;
	}
	button:disabled {
		cursor: not-allowed;
		opacity: 0.4;
	}
	button:focus-visible,
	input:focus-visible,
	summary:focus-visible,
	a:focus-visible {
		outline: 3px solid #91b5ac;
		outline-offset: 3px;
	}
	.close-button {
		display: grid;
		width: 44px;
		height: 44px;
		flex: 0 0 auto;
		place-items: center;
		border: 1px solid #dce6df;
		border-radius: 50%;
		background: #fafcf7;
		color: #52736c;
	}
	.context-navigation {
		display: flex;
		flex: 0 0 auto;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 0 0 18px;
		border-bottom: 1px solid #e0e8df;
	}
	.snapshot-status,
	.summary-tag {
		flex: 0 0 auto;
		padding: 5px 8px;
		border: 1px solid #cbded6;
		border-radius: 6px;
		color: #4c7466;
		background: #eef5ec;
		font-size: 12px;
		line-height: 1.3;
	}
	.snapshot-status.limited {
		border-color: #e5dac2;
		color: #8c754c;
		background: #faf5e9;
	}
	.context-body {
		flex: 1 1 auto;
		min-width: 0;
		min-height: 0;
		overflow-x: hidden;
		overflow-y: auto;
		overscroll-behavior: contain;
		scrollbar-gutter: stable;
		padding: 19px 5px 4px 0;
	}
	.context-summary {
		display: flex;
		align-items: center;
		gap: 17px;
		padding: 13px 16px;
		border: 1px solid #d7e5e0;
		border-radius: 14px;
		background: linear-gradient(120deg, #f4f8f0, #edf5f5);
	}
	.summary-copy {
		min-width: 0;
		flex: 1;
	}
	.summary-copy h3 {
		margin: 0;
		font-size: 22px;
		font-weight: 650;
		letter-spacing: -0.035em;
	}
	.summary-copy > p:last-child {
		margin: 7px 0 0;
		color: #69837d;
		font-size: 12px;
		line-height: 1.5;
	}
	.layer-switch {
		display: flex;
		max-width: 125px;
		flex-shrink: 0;
		align-items: center;
		gap: 7px;
		color: #4d7068;
		font-size: 12px;
		line-height: 1.5;
		cursor: pointer;
	}
	.layer-switch input {
		width: 17px;
		height: 17px;
		flex: 0 0 auto;
		accent-color: #37856f;
	}
	.layer-switch:has(input:disabled) {
		color: #91a29b;
		cursor: not-allowed;
	}
	.attribution,
	.snapshot-note,
	.data-note {
		margin: 11px 2px 0;
		color: #73857e;
		font-size: 12px;
		line-height: 1.55;
	}
	.attribution a,
	.context-sources a {
		display: inline;
		color: #367769;
		text-decoration: underline;
		text-decoration-color: #b3cfc2;
		text-underline-offset: 3px;
	}
	.attribution :global(svg),
	.context-sources :global(svg) {
		display: inline;
		vertical-align: -2px;
	}
	.snapshot-note {
		color: #58786e;
	}
	.data-note {
		color: #8c7756;
	}
	.passenger-note {
		margin: 10px 2px 0;
		color: #6c8378;
		font-size: 12px;
		line-height: 1.55;
	}
	.directory-heading,
	.section-heading {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 12px;
		margin: 22px 0 11px;
	}
	h3 {
		margin: 0;
		font-size: 13px;
		font-weight: 650;
	}
	.directory-heading span,
	.section-heading span {
		color: #81948c;
		font-size: 12px;
	}
	.directory-search {
		display: flex;
		min-height: 44px;
		align-items: center;
		gap: 10px;
		margin-bottom: 10px;
		padding: 0 11px;
		border: 1px solid #d5e2d9;
		border-radius: 9px;
		color: #789385;
		background: #fffef9;
	}
	.directory-search:focus-within {
		border-color: #8fb2a2;
		box-shadow: 0 0 0 2px #dcebe0;
	}
	.directory-search input {
		width: 100%;
		min-width: 0;
		border: 0;
		outline: 0;
		color: #355b54;
		background: transparent;
		font: inherit;
		font-size: 16px;
	}
	.directory-search input::placeholder {
		color: #95a79a;
	}
	.boat-directory {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.boat-directory li {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 80px;
		padding: 11px 0;
		border-bottom: 1px solid #e6ece3;
	}
	.vessel-mark {
		display: grid;
		width: 43px;
		flex: 0 0 auto;
		place-items: center;
	}
	.vessel-copy {
		min-width: 0;
		flex: 1;
	}
	.vessel-copy strong {
		display: block;
		overflow-wrap: anywhere;
		color: #355a54;
		font-size: 14px;
		font-weight: 600;
	}
	.vessel-copy p {
		margin: 4px 0;
		color: #7b8d85;
		font-size: 12px;
		line-height: 1.5;
		overflow-wrap: anywhere;
	}
	.observation-time,
	.vessel-speed {
		display: block;
		color: #86978e;
		font-size: 12px;
		line-height: 1.55;
		overflow-wrap: anywhere;
	}
	.vessel-speed {
		margin-top: 2px;
		color: #66877b;
	}
	.locate-button {
		display: flex;
		min-height: 44px;
		flex-shrink: 0;
		align-items: center;
		gap: 5px;
		padding: 6px 9px;
		border: 1px solid #cbded1;
		border-radius: 7px;
		color: #3e7a66;
		background: #eef6e9;
		font-size: 12px;
	}
	.no-position {
		flex-shrink: 0;
		color: #9aa89f;
		font-size: 12px;
	}
	.pagination {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 15px;
		padding-top: 13px;
		color: #81958a;
		font-size: 12px;
	}
	.pagination p {
		margin: 0;
	}
	.pagination > div {
		display: flex;
		align-items: center;
		gap: 9px;
	}
	.pagination button {
		display: grid;
		width: 44px;
		height: 44px;
		place-items: center;
		border: 1px solid #dce7d9;
		border-radius: 6px;
		color: #648370;
		background: #f8fbf3;
	}
	.table-scroll {
		min-width: 0;
		max-width: 100%;
		overflow-x: auto;
		overscroll-behavior-x: contain;
		-webkit-overflow-scrolling: touch;
	}
	.table-scroll:focus-visible {
		outline: 3px solid #91b5ac;
		outline-offset: -3px;
	}
	.port-table table {
		min-width: 540px;
	}
	.port-table {
		border: 1px solid #e0e7dc;
		border-radius: 10px;
	}
	table {
		width: 100%;
		border-collapse: collapse;
		text-align: left;
		font-size: 12px;
		line-height: 1.5;
	}
	th,
	td {
		padding: 11px 12px;
		border-bottom: 1px solid #e6ece1;
		vertical-align: top;
	}
	thead th {
		color: #78927e;
		background: #f5f8ee;
		font-size: 12px;
		font-weight: 550;
		white-space: nowrap;
	}
	tbody th {
		max-width: 190px;
		color: #4c6b5e;
		font-weight: 600;
	}
	td {
		color: #84937f;
	}
	.port-statistics,
	.aviation-metrics {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
		margin-top: 17px;
	}
	.port-statistics > div,
	.aviation-metrics article {
		min-width: 0;
		padding: 13px;
		border: 1px solid #dde7dc;
		border-radius: 11px;
		background: #fbfcf6;
	}
	.port-statistics span,
	.aviation-metrics article > span:first-child {
		display: block;
		color: #6b8775;
		font-size: 12px;
		line-height: 1.4;
	}
	.port-statistics strong,
	.aviation-metrics strong {
		display: block;
		margin-top: 9px;
		color: #2e6059;
		font-size: 24px;
		font-weight: 600;
		letter-spacing: -0.025em;
	}
	.aviation-metrics strong small {
		color: #78917d;
		font-size: 12px;
		font-weight: 400;
		letter-spacing: 0;
	}
	.port-statistics p,
	.aviation-metrics p {
		margin: 7px 0 0;
		color: #7a8f7b;
		font-size: 12px;
		line-height: 1.5;
	}
	.metric-source {
		display: block;
		margin-top: 5px;
		color: #95a391;
		font-size: 12px;
	}
	.metric-definition,
	.port-quality {
		margin-top: 7px;
		color: #6e8778;
		font-size: 12px;
		line-height: 1.5;
	}
	.metric-definition summary,
	.port-quality summary {
		cursor: pointer;
		font-size: 12px;
	}
	.metric-definition p {
		margin: 6px 0 0;
		font-size: 12px;
	}
	.published-time-note {
		display: block;
		margin-top: 4px;
		color: #947d58;
		font-size: 12px;
		line-height: 1.5;
	}
	.port-quality ul {
		margin: 6px 0 0;
		padding-left: 13px;
	}
	.trend-section {
		margin-top: 19px;
		padding: 0 13px 12px;
		border: 1px solid #dce6de;
		border-radius: 12px;
		background: #f8fbf6;
	}
	.trend-section .section-heading {
		margin-top: 15px;
	}
	.series-picker {
		min-width: 0;
		margin-bottom: 8px;
		color: #7a907e;
		font-size: 12px;
	}
	.series-picker :global(.context-series-trigger) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		width: 100%;
		min-width: 0;
		min-height: 44px;
		padding: 8px 11px;
		border: 1px solid #d9e5d7;
		border-radius: 9px;
		color: #52786a;
		background: #fffef9;
		font: inherit;
		font-size: 14px;
		text-align: left;
		cursor: pointer;
	}
	.series-picker :global(.context-series-trigger:focus-visible) {
		outline: 3px solid #91b5ac;
		outline-offset: 3px;
	}
	.series-picker :global(.context-series-trigger[data-state='open']) {
		border-color: #91b5ac;
		background: #edf4ed;
	}
	.series-picker :global(.context-series-trigger > span) {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	:global(.context-series-menu) {
		z-index: 150;
		width: var(--bits-select-anchor-width);
		max-width: calc(100vw - 16px);
		max-height: min(330px, var(--bits-select-content-available-height, 330px));
		box-sizing: border-box;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 5px;
		border: 1px solid #d9e5d7;
		border-radius: 12px;
		background: #fffef9;
		color: #426959;
		box-shadow: 0 10px 30px rgb(23 45 30 / 13%);
	}
	:global(.context-series-option) {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		min-height: 42px;
		padding: 9px 10px;
		border-radius: 7px;
		outline: none;
		cursor: pointer;
	}
	:global(.context-series-option > div) {
		min-width: 0;
		overflow-wrap: anywhere;
	}
	:global(.context-series-option > span),
	.series-picker :global(.context-series-trigger > svg) {
		flex: 0 0 auto;
	}
	:global(.context-series-option strong) {
		display: block;
		font-size: 14px;
		font-weight: 500;
		line-height: 1.4;
	}
	:global(.context-series-option small) {
		display: block;
		margin-top: 4px;
		font-size: 12px;
		line-height: 1.4;
		opacity: 0.75;
	}
	:global(.context-series-option[data-highlighted]) {
		background: #edf3e8;
	}
	:global(.context-series-option[data-selected]) {
		background: #326354;
		color: #fff;
	}
	:global(.context-series-option[data-selected][data-highlighted]) {
		box-shadow: inset 0 0 0 2px #8fab7f;
	}
	.trend-label,
	.trend-source {
		margin: 0;
		color: #7c9386;
		font-size: 12px;
		line-height: 1.5;
	}
	.trend-chart {
		display: block;
		width: 100%;
		height: auto;
		margin-top: 13px;
		overflow: visible;
	}
	.trend-chart text {
		fill: #8aa094;
		font-size: 12px;
	}
	.trend-source {
		font-size: 12px;
	}
	.trend-values {
		margin-top: 11px;
	}
	.trend-values summary {
		color: #5d8776;
		font-size: 12px;
		cursor: pointer;
	}
	.trend-values .table-scroll {
		max-height: 200px;
		margin-top: 9px;
		overflow-y: auto;
	}
	.limitations {
		margin-top: 15px;
		padding: 10px 12px;
		border: 1px solid #e6dec8;
		border-radius: 9px;
		color: #8e7959;
		background: #faf7ec;
		font-size: 12px;
		line-height: 1.5;
	}
	.limitations summary {
		cursor: pointer;
		font-weight: 550;
	}
	.limitations ul {
		margin: 9px 0 0;
		padding-left: 17px;
	}
	.limitations li + li {
		margin-top: 5px;
	}
	.context-sources {
		margin-top: 21px;
		padding-top: 15px;
		border-top: 1px solid #e1e9dd;
		color: #688272;
		font-size: 12px;
	}
	.context-sources summary {
		cursor: pointer;
	}
	.context-sources summary > span {
		padding-left: 8px;
		color: #9aac98;
		font-size: 12px;
	}
	.context-sources ul {
		margin: 14px 0 0;
		padding: 0;
		list-style: none;
	}
	.context-sources li {
		padding: 11px 0;
		border-top: 1px solid #e5ebdf;
	}
	.context-sources h4 {
		margin: 0;
		font-size: 12px;
		font-weight: 600;
		line-height: 1.5;
	}
	.context-sources p {
		margin: 5px 0 0;
		font-size: 12px;
		line-height: 1.55;
	}
	.reuse-note {
		color: #8b815d;
	}
	.source-capture {
		color: #97a58e;
	}
	.empty-state {
		display: grid;
		justify-items: center;
		padding: 25px 20px 40px;
		text-align: center;
	}
	.empty-state h3 {
		margin-top: 13px;
	}
	.empty-state p,
	.directory-empty p {
		max-width: 340px;
		margin: 8px 0 0;
		color: #8d9c88;
		font-size: 12px;
		line-height: 1.6;
	}
	.directory-empty {
		padding: 17px 0;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
	@media (hover: hover) and (pointer: fine) {
		.close-button:hover,
		.pagination button:not(:disabled):hover {
			background: #eef5e7;
		}
		.locate-button:not(:disabled):hover {
			border-color: #93b9a1;
			background: #e5f1dc;
		}
	}
	@media (max-width: 600px) {
		.transport-context {
			padding: 16px;
		}
		.context-header {
			gap: 13px;
			padding-bottom: 14px;
		}
		.header-note {
			font-size: 12px;
		}
		.context-navigation {
			flex-wrap: wrap;
			padding-bottom: 13px;
		}
		.context-summary {
			display: grid;
			grid-template-columns: 68px minmax(0, 1fr);
			gap: 10px;
			padding: 10px;
		}
		.context-summary :global(.transport-graphic) {
			width: 68px !important;
			height: 68px !important;
		}
		.summary-copy h3 {
			font-size: 19px;
		}
		.layer-switch,
		.summary-tag {
			grid-column: 2;
			justify-self: start;
			margin-left: 0;
			max-width: none;
		}
		.layer-switch {
			min-height: 44px;
		}
		.port-statistics,
		.aviation-metrics {
			gap: 8px;
		}
		.aviation-metrics strong {
			font-size: 21px;
		}
		.locate-button span {
			display: none;
		}
		.locate-button {
			width: 44px;
			justify-content: center;
			padding: 6px;
		}
		.boat-directory li {
			gap: 6px;
		}
		.pagination {
			font-size: 12px;
		}
		.pagination > div {
			gap: 6px;
		}
	}
	@media (max-width: 380px) {
		.port-statistics,
		.aviation-metrics {
			grid-template-columns: minmax(0, 1fr);
		}
		.boat-directory li {
			display: grid;
			grid-template-columns: 37px minmax(0, 1fr);
			align-items: start;
			gap: 6px 8px;
		}
		.vessel-mark {
			width: 37px;
		}
		.locate-button,
		.no-position {
			grid-column: 2;
			justify-self: start;
		}
		.locate-button {
			width: auto;
			padding: 6px 10px;
		}
		.locate-button span {
			display: inline;
		}
		.pagination > div {
			width: 100%;
			justify-content: space-between;
		}
	}
	@media (max-height: 520px) {
		.transport-context {
			padding: 12px;
		}
		.context-header {
			padding-bottom: 8px;
		}
		h2 {
			font-size: 23px;
		}
		.context-navigation {
			padding-bottom: 8px;
			gap: 6px 12px;
		}
		.context-body {
			padding-top: 12px;
		}
	}
</style>
