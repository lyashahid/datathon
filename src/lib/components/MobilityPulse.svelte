<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import {
		ArrowDownRight,
		ArrowUpRight,
		ChevronLeft,
		ChevronRight,
		RefreshCw
	} from '@lucide/svelte';
	import { api, subscribeApiInvalidation } from '#lib/api.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';

	let { onForecast, active = true }: { onForecast?: () => void; active?: boolean } = $props();
	type Observation = { month: string; value: number };
	type PassengerSeries = {
		seriesId: string;
		name: string;
		mode: string;
		unit: string;
		sourceUrl: string;
		lastActualMonth: string;
		history: Observation[];
	};
	type PassengerBundle = {
		monthly: PassengerSeries[];
		provenance: { latestPublicationDate: string };
	};
	let bundle = $state.raw<PassengerBundle | null>(null);
	let seriesId = $state('ferry-male-vm');
	let period = $state<'12m' | 'all'>('12m');
	let loading = $state(true);
	let mounted = $state(false);
	let needsRefresh = $state(false);
	let error = $state('');
	let selectedIndex = $state<number | null>(null);
	let chartWidth = $state(740);
	let controller: AbortController | undefined;
	const uniqueId = $props.id();
	const formatter = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
	const compactFormatter = new Intl.NumberFormat('en-GB', {
		notation: 'compact',
		maximumFractionDigits: 1
	});
	const monthFormatter = new Intl.DateTimeFormat('en-GB', {
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC'
	});
	const month = (value: string) => monthFormatter.format(new Date(`${value}-01T12:00:00Z`));
	const publicationFormatter = new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC'
	});
	const publicationDate = $derived(
		bundle?.provenance.latestPublicationDate
			? publicationFormatter.format(
					new Date(`${bundle.provenance.latestPublicationDate}T12:00:00Z`)
				)
			: null
	);
	const priorMonth = (value: string) => `${Number(value.slice(0, 4)) - 1}${value.slice(4)}`;
	const current = $derived(
		bundle?.monthly.find((item) => item.seriesId === seriesId) ?? bundle?.monthly[0]
	);
	const history = $derived(
		[...(current?.history ?? [])]
			.filter((item) => Number.isFinite(item.value) && item.value >= 0)
			.sort((a, b) => a.month.localeCompare(b.month))
	);
	const observations = $derived(period === '12m' ? history.slice(-12) : history);
	const historyByMonth = $derived(new Map(history.map((item) => [item.month, item])));
	const previousYear = $derived(
		period === '12m' ? observations.map((item) => historyByMonth.get(priorMonth(item.month))) : []
	);
	const hasComparison = $derived(
		previousYear.length > 0 && previousYear.every((item) => item !== undefined)
	);
	const latest = $derived(history.at(-1));
	const prior = $derived(latest ? historyByMonth.get(priorMonth(latest.month)) : undefined);
	const yearChange = $derived(
		latest && prior && prior.value > 0 ? (latest.value / prior.value - 1) * 100 : null
	);
	const total = $derived(observations.reduce((sum, item) => sum + item.value, 0));
	const peak = $derived(
		observations.reduce<Observation | undefined>(
			(highest, item) => (!highest || item.value > highest.value ? item : highest),
			undefined
		)
	);
	const activeIndex = $derived(
		Math.max(0, Math.min(selectedIndex ?? observations.length - 1, observations.length - 1))
	);
	const activePoint = $derived(observations[activeIndex]);
	const activePrior = $derived(hasComparison ? previousYear[activeIndex] : undefined);
	const chart = $derived.by(() => {
		const width = Math.max(260, Math.round(chartWidth));
		const height = 224;
		const left = 42;
		const right = 12;
		const top = 18;
		const bottom = 31;
		const maximum = Math.max(
			1,
			...observations.map((item) => item.value),
			...previousYear.map((item) => item?.value ?? 0)
		);
		const magnitude = 10 ** Math.floor(Math.log10(maximum));
		const step = magnitude / 2;
		const ceiling = Math.ceil((maximum * 1.1) / step) * step;
		const x = (index: number) =>
			left + (index / Math.max(1, observations.length - 1)) * (width - left - right);
		const y = (value: number) => top + (1 - value / ceiling) * (height - top - bottom);
		const path = (rows: Observation[]) =>
			rows
				.map(
					(item, index) => `${index ? 'L' : 'M'}${x(index).toFixed(2)},${y(item.value).toFixed(2)}`
				)
				.join(' ');
		const actual = path(observations);
		const labelCount = width < 450 ? 3 : 6;
		const labelIndexes = [
			...new Set(
				Array.from({ length: labelCount }, (_, index) =>
					Math.round((index / (labelCount - 1)) * (observations.length - 1))
				)
			)
		];
		return {
			width,
			height,
			left,
			right,
			top,
			bottom,
			x,
			y,
			actual,
			area: observations.length
				? `${actual} L${x(observations.length - 1)},${y(0)} L${x(0)},${y(0)} Z`
				: '',
			comparison: hasComparison
				? path(previousYear.filter((item): item is Observation => !!item))
				: '',
			ticks: [0, 1, 2, 3, 4].map((index) => (ceiling / 4) * index),
			labels: labelIndexes
				.map((index) => ({ index, point: observations[index] }))
				.filter((item) => !!item.point)
		};
	});

	async function load() {
		needsRefresh = false;
		controller?.abort();
		const request = new AbortController();
		controller = request;
		loading = true;
		error = '';
		try {
			const result = await api<PassengerBundle>(
				'forecasts?history_only=true',
				undefined,
				request.signal
			);
			if (request.signal.aborted) return;
			bundle = result;
			if (!result.monthly.some((item) => item.seriesId === seriesId))
				seriesId = result.monthly[0]?.seriesId ?? '';
		} catch (caught) {
			if (!request.signal.aborted)
				error = caught instanceof Error ? caught.message : 'Passenger history could not be loaded.';
		} finally {
			if (controller === request) loading = false;
		}
	}
	function pointAt(event: PointerEvent) {
		if (!observations.length) return;
		const bounds =
			event.currentTarget instanceof HTMLElement
				? event.currentTarget.getBoundingClientRect()
				: null;
		if (!bounds) return;
		const coordinate = ((event.clientX - bounds.left) / bounds.width) * chart.width;
		selectedIndex = Math.max(
			0,
			Math.min(
				observations.length - 1,
				Math.round(
					((coordinate - chart.left) / (chart.width - chart.left - chart.right)) *
						(observations.length - 1)
				)
			)
		);
	}
	function keyboardPoint(event: KeyboardEvent) {
		if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
		event.preventDefault();
		selectedIndex =
			event.key === 'Home'
				? 0
				: event.key === 'End'
					? observations.length - 1
					: Math.max(
							0,
							Math.min(observations.length - 1, activeIndex + (event.key === 'ArrowRight' ? 1 : -1))
						);
	}
	function changePeriod(next: '12m' | 'all') {
		period = next;
		selectedIndex = null;
	}
	onMount(() => {
		mounted = true;
		const unsubscribe = subscribeApiInvalidation(() => {
			needsRefresh = true;
		});
		if (active) void load();
		else needsRefresh = true;
		return () => {
			unsubscribe();
			controller?.abort();
		};
	});
	$effect(() => {
		if (mounted && active && needsRefresh) untrack(() => void load());
	});
</script>

<section
	class="mobility-pulse"
	aria-label="Passenger movement trends"
	data-series={current?.seriesId}
	data-period={period}
	data-observations={observations.length}
>
	<div class="pulse-heading">
		<div>
			<p class="eyebrow">MOBILITY PULSE</p>
			<h2>How people move</h2>
		</div>
		<div class="period-control" role="group" aria-label="Passenger history period">
			<Button
				size="sm"
				variant="ghost"
				class={period === '12m' ? 'period-active' : ''}
				aria-pressed={period === '12m'}
				onclick={() => changePeriod('12m')}>12 months</Button
			>
			<Button
				size="sm"
				variant="ghost"
				class={period === 'all' ? 'period-active' : ''}
				aria-pressed={period === 'all'}
				onclick={() => changePeriod('all')}>All history</Button
			>
		</div>
	</div>
	{#if loading}
		<div class="pulse-loading" role="status">
			<span class="loading-bar"></span><span>Reading published passenger history…</span>
		</div>
	{:else if error}
		<div class="pulse-state" role="alert">
			<p>{error}</p>
			<Button variant="outline" size="sm" onclick={() => void load()}
				><RefreshCw size={14} />Try again</Button
			>
		</div>
	{:else if !current || !latest || !observations.length}
		<div class="pulse-state"><p>No published monthly passenger observations are available.</p></div>
	{:else}
		<div class="pulse-summary">
			<div class="latest-reading">
				<strong>{formatter.format(latest.value)}</strong><span
					>passenger movements · {month(latest.month)}</span
				>
			</div>
			<div class="series-control">
				<NativeSelect.Root
					aria-label="Passenger series"
					bind:value={seriesId}
					onchange={() => (selectedIndex = null)}
				>
					{#each bundle?.monthly ?? [] as item (item.seriesId)}<option value={item.seriesId}
							>{item.name}</option
						>{/each}
				</NativeSelect.Root>
				{#if yearChange !== null}
					<p class="year-change">
						{#if yearChange >= 0}<ArrowUpRight size={14} />{:else}<ArrowDownRight
								size={14}
							/>{/if}<strong>{yearChange > 0 ? '+' : ''}{yearChange.toFixed(1)}%</strong><span
							>vs {month(prior!.month)}</span
						>
					</p>
				{/if}
			</div>
		</div>
		<div class="chart-meta">
			<div class="chart-legend">
				<span><i class="actual-dot"></i>Published actuals</span>{#if hasComparison}<span
						><i class="comparison-dot"></i>Same month, previous year</span
					>{/if}
			</div>
			<span class="chart-unit">MOVEMENTS / MONTH</span>
		</div>
		<div
			class="chart-container"
			bind:clientWidth={chartWidth}
			role="slider"
			tabindex="0"
			aria-label="Inspect passenger movements by month"
			aria-valuemin={0}
			aria-valuemax={observations.length - 1}
			aria-valuenow={activeIndex}
			aria-valuetext={`${month(activePoint.month)}: ${formatter.format(activePoint.value)} passenger movements${activePrior ? `, previous year ${formatter.format(activePrior.value)}` : ''}`}
			onkeydown={keyboardPoint}
			onpointermove={pointAt}
			onpointerdown={pointAt}
			onpointerleave={(event) => {
				if (event.pointerType !== 'touch') selectedIndex = null;
			}}
		>
			<svg
				viewBox={`0 0 ${chart.width} ${chart.height}`}
				role="img"
				aria-label={`Published monthly passenger movements, ${current.name}, ${month(observations[0].month)} to ${month(latest.month)}`}
				data-testid="passenger-trend-chart"
			>
				<defs
					><linearGradient id={`${uniqueId}-area`} x1="0" x2="0" y1="0" y2="1"
						><stop offset="0%" stop-color="#8762d8" stop-opacity=".21" /><stop
							offset="100%"
							stop-color="#8762d8"
							stop-opacity=".015"
						/></linearGradient
					></defs
				>
				{#each chart.ticks as tick (tick)}<line
						class="chart-grid"
						x1={chart.left}
						x2={chart.width - chart.right}
						y1={chart.y(tick)}
						y2={chart.y(tick)}
					/><text class="axis-label" x={chart.left - 9} y={chart.y(tick) + 4} text-anchor="end"
						>{compactFormatter.format(tick)}</text
					>{/each}
				<path d={chart.area} fill={`url(#${uniqueId}-area)`} />
				{#if hasComparison}<path d={chart.comparison} class="comparison-line" />{/if}
				<path d={chart.actual} class="actual-line" />
				{#each chart.labels as label (label.index)}<text
						class="axis-label"
						x={chart.x(label.index)}
						y={chart.height - 7}
						text-anchor={label.index === 0
							? 'start'
							: label.index === observations.length - 1
								? 'end'
								: 'middle'}>{month(label.point.month)}</text
					>{/each}
				<line
					class="inspection-line"
					x1={chart.x(activeIndex)}
					x2={chart.x(activeIndex)}
					y1={chart.top}
					y2={chart.y(0)}
				/>
				{#if activePrior}<circle
						class="comparison-point"
						cx={chart.x(activeIndex)}
						cy={chart.y(activePrior.value)}
						r="4"
					/>{/if}
				<circle
					class="actual-halo"
					cx={chart.x(activeIndex)}
					cy={chart.y(activePoint.value)}
					r="9"
				/><circle
					class="actual-point"
					cx={chart.x(activeIndex)}
					cy={chart.y(activePoint.value)}
					r="4.5"
				/>
			</svg>
		</div>
		<div class="inspection-readout">
			<div class="selected-month">
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label="Previous passenger month"
					disabled={activeIndex === 0}
					onclick={() => (selectedIndex = activeIndex - 1)}><ChevronLeft size={15} /></Button
				><span>{month(activePoint.month)}</span><Button
					variant="ghost"
					size="icon-sm"
					aria-label="Next passenger month"
					disabled={activeIndex === observations.length - 1}
					onclick={() => (selectedIndex = activeIndex + 1)}><ChevronRight size={15} /></Button
				>
			</div>
			<div class="selected-values">
				<span
					><i class="actual-dot"></i><strong>{formatter.format(activePoint.value)}</strong><small
						>actual</small
					></span
				>{#if activePrior}<span
						><i class="comparison-dot"></i><strong>{formatter.format(activePrior.value)}</strong
						><small>prior year</small></span
					>{/if}
			</div>
		</div>
		<div class="pulse-stats">
			<div>
				<span>Monthly average</span><strong
					>{compactFormatter.format(total / observations.length)}</strong
				><small>across {observations.length} observed months</small>
			</div>
			<div>
				<span>Peak month</span><strong>{compactFormatter.format(peak?.value ?? 0)}</strong><small
					>{peak ? month(peak.month) : '—'}</small
				>
			</div>
			<div>
				<span>History available</span><strong>{history.length}<em>months</em></strong><small
					>since {month(history[0].month)}</small
				>
			</div>
		</div>
		<div class="pulse-footer">
			<p>
				<span>Published route series · independent of island filters</span>
				<a href={current.sourceUrl} target="_blank" rel="noreferrer"
					>Maldives Bureau of Statistics <ArrowUpRight size={12} /></a
				>{#if publicationDate}<span>Published {publicationDate}</span>{/if}<span
					>{current.mode === 'bus'
						? 'June bus values excluded: possible carry-forward.'
						: 'Ferry endpoint counts; not unique passengers.'}</span
				>
			</p>
			{#if onForecast}<Button variant="ghost" size="sm" onclick={onForecast}
					>Forecast details<ArrowUpRight size={15} /></Button
				>{/if}
		</div>
	{/if}
</section>

<style>
	.mobility-pulse {
		min-width: 0;
		padding: 26px;
		border: 1px solid #edeaf2;
		border-radius: 24px;
		background: #fff;
		color: #292735;
		box-shadow: 0 4px 24px #31234803;
	}
	.pulse-heading,
	.pulse-summary,
	.chart-meta,
	.inspection-readout,
	.pulse-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}
	.eyebrow {
		margin: 0 0 7px;
		color: #7d718b;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.14em;
	}
	h2 {
		margin: 0;
		font-size: 20px;
		font-weight: 650;
		letter-spacing: -0.6px;
	}
	.period-control {
		display: flex;
		gap: 2px;
		padding: 4px;
		border-radius: 12px;
		background: #f7f5fa;
	}
	.period-control :global(button) {
		padding: 0 11px;
		color: #6e637b;
		font-size: 11px;
		border-radius: 8px;
	}
	.period-control :global(.period-active) {
		color: #5d427f;
		background: #fff;
		box-shadow: 0 2px 5px #36214d09;
	}
	.pulse-summary {
		align-items: flex-end;
		margin-top: 24px;
	}
	.latest-reading {
		display: grid;
		gap: 5px;
	}
	.latest-reading > strong {
		color: #32283f;
		font-size: clamp(30px, 3vw, 39px);
		font-weight: 600;
		line-height: 1.15;
		letter-spacing: -1.8px;
		font-variant-numeric: tabular-nums;
	}
	.latest-reading > span {
		color: #7d718b;
		font-size: 11px;
	}
	.series-control {
		display: grid;
		justify-items: end;
		gap: 7px;
		min-width: 0;
	}
	.series-control :global([data-slot='native-select-wrapper']) {
		width: min(244px, 100%);
	}
	.series-control :global(select) {
		height: 33px;
		border-color: #ece8f0;
		border-radius: 9px;
		color: #6c617c;
		box-shadow: none;
		font-size: 11px;
	}
	.year-change {
		display: flex;
		align-items: center;
		gap: 4px;
		margin: 0;
		color: #7b658e;
		font-size: 11px;
	}
	.year-change > span {
		margin-left: 2px;
		color: #7d718b;
	}
	.year-change > strong {
		font-weight: 600;
	}
	.chart-meta {
		margin-top: 27px;
		gap: 12px;
	}
	.chart-legend {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
	}
	.chart-legend > span,
	.selected-values > span {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: #7d718b;
		font-size: 10px;
	}
	.actual-dot,
	.comparison-dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #8762d8;
		flex-shrink: 0;
	}
	.comparison-dot {
		background: #26a984;
	}
	.chart-unit {
		color: #8d829b;
		font-size: 8px;
		letter-spacing: 0.1em;
		white-space: nowrap;
	}
	.chart-container {
		margin-top: 11px;
		border-radius: 10px;
		outline: none;
		touch-action: pan-y;
		cursor: crosshair;
	}
	.chart-container:focus-visible {
		box-shadow: 0 0 0 3px #8762d844;
	}
	.chart-container > svg {
		display: block;
		width: 100%;
		height: auto;
		overflow: visible;
	}
	.chart-grid {
		stroke: #ece9f0;
		stroke-dasharray: 3 5;
		stroke-width: 1;
	}
	.axis-label {
		fill: #8d829b;
		font-family: inherit;
		font-size: 10px;
		font-weight: 400;
	}
	.actual-line {
		fill: none;
		stroke: #8762d8;
		stroke-width: 2.4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.comparison-line {
		fill: none;
		stroke: #26a984;
		stroke-opacity: 0.7;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.inspection-line {
		stroke: #c5b4e3;
		stroke-width: 1;
		stroke-dasharray: 3 4;
	}
	.actual-point {
		fill: #8762d8;
		stroke: #fff;
		stroke-width: 2;
	}
	.actual-halo {
		fill: #8762d81a;
	}
	.comparison-point {
		fill: #26a984;
		stroke: #fff;
		stroke-width: 2;
	}
	.inspection-readout {
		min-height: 42px;
		margin: 8px 0 19px;
		padding: 4px 8px;
		border-radius: 11px;
		background: #faf8fd;
	}
	.selected-month {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.selected-month > span {
		min-width: 64px;
		color: #7d6c92;
		font-size: 11px;
		text-align: center;
	}
	.selected-month :global(button) {
		color: #b2a3c4;
	}
	.selected-values {
		display: flex;
		flex-wrap: wrap;
		justify-content: end;
		gap: 14px;
	}
	.selected-values strong {
		color: #5c4c6f;
		font-size: 12px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.selected-values small {
		font-size: 10px;
	}
	.pulse-stats {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 20px;
		margin-bottom: 21px;
	}
	.pulse-stats > div {
		display: grid;
		gap: 5px;
	}
	.pulse-stats > div + div {
		padding-left: 21px;
		border-left: 1px solid #efecf2;
	}
	.pulse-stats span {
		color: #7d718b;
		font-size: 11px;
	}
	.pulse-stats strong {
		color: #5c4b72;
		font-size: 23px;
		font-weight: 550;
		letter-spacing: -0.75px;
		line-height: 1.2;
	}
	.pulse-stats em {
		margin-left: 5px;
		color: #a49aac;
		font-size: 10px;
		font-style: normal;
		font-weight: 400;
		letter-spacing: 0;
	}
	.pulse-stats small {
		color: #8d829b;
		font-size: 10px;
	}
	.pulse-footer {
		align-items: end;
		gap: 12px;
		padding-top: 16px;
		border-top: 1px solid #f0ecf5;
	}
	.pulse-footer p {
		display: grid;
		gap: 4px;
		margin: 0;
	}
	.pulse-footer a {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: #796a89;
		font-size: 10px;
		text-decoration: none;
	}
	.pulse-footer a:hover {
		color: #7953b7;
		text-decoration: underline;
	}
	.pulse-footer p > span {
		color: #8d829b;
		font-size: 10px;
		line-height: 1.5;
	}
	.pulse-footer :global(button) {
		padding: 0 7px;
		color: #8a65be;
		font-size: 11px;
	}
	.pulse-loading,
	.pulse-state {
		display: flex;
		min-height: 410px;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		color: #91849d;
		font-size: 12px;
		text-align: center;
	}
	.loading-bar {
		display: block;
		width: 120px;
		height: 5px;
		border-radius: 5px;
		background: #ece3f8;
	}
	.pulse-state p {
		max-width: 360px;
	}
	.mobility-pulse :global(button) {
		transition:
			transform 120ms cubic-bezier(0.23, 1, 0.32, 1),
			background-color 150ms ease;
	}
	.mobility-pulse :global(button:active) {
		transform: scale(0.97);
	}
	@media (max-width: 600px) {
		.mobility-pulse {
			padding: 20px 17px;
			border-radius: 20px;
		}
		.pulse-heading {
			align-items: start;
			gap: 9px;
		}
		h2 {
			font-size: 17px;
		}
		.period-control {
			gap: 0;
			padding: 3px;
		}
		.period-control :global(button) {
			height: 30px;
			padding: 0 8px;
			font-size: 10px;
		}
		.pulse-summary {
			flex-wrap: wrap;
			align-items: start;
			gap: 16px;
			margin-top: 20px;
		}
		.latest-reading > strong {
			font-size: 34px;
		}
		.series-control {
			justify-items: start;
			width: 100%;
		}
		.series-control :global([data-slot='native-select-wrapper']) {
			width: 100%;
		}
		.series-control :global(select) {
			height: 38px;
			font-size: 11px;
		}
		.year-change {
			font-size: 10px;
		}
		.chart-meta {
			margin-top: 19px;
		}
		.chart-legend {
			gap: 12px;
		}
		.chart-legend > span {
			font-size: 10px;
		}
		.chart-unit {
			display: none;
		}
		.chart-container {
			margin-top: 14px;
		}
		.inspection-readout {
			align-items: start;
			flex-direction: column;
			gap: 2px;
			padding: 4px 8px 10px;
		}
		.selected-month {
			width: 100%;
			justify-content: space-between;
		}
		.selected-month :global(button) {
			width: 36px;
			height: 36px;
		}
		.selected-values {
			width: 100%;
			justify-content: center;
			gap: 14px;
		}
		.pulse-stats {
			gap: 10px;
		}
		.pulse-stats > div + div {
			padding-left: 12px;
		}
		.pulse-stats strong {
			font-size: 21px;
		}
		.pulse-stats span {
			font-size: 10px;
		}
		.pulse-stats small {
			font-size: 9px;
			line-height: 1.4;
		}
		.pulse-stats em {
			display: block;
			margin: 3px 0 0;
			font-size: 9px;
		}
		.pulse-footer {
			align-items: start;
			flex-direction: column;
			gap: 8px;
		}
		.pulse-footer a,
		.pulse-footer p > span {
			font-size: 9px;
		}
		.pulse-footer :global(button) {
			height: 36px;
			padding: 0;
			font-size: 10px;
		}
	}
	@media (max-width: 360px) {
		.pulse-heading {
			flex-direction: column;
			gap: 15px;
		}
		.period-control {
			align-self: flex-start;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.mobility-pulse :global(button) {
			transition: none;
		}
	}
</style>
