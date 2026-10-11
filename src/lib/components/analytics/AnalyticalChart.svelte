<script lang="ts">
	import { onMount } from 'svelte';
	import type { EChartsType } from 'echarts/core';
	import type { AnalyticalDataset } from '#lib/analytics/catalog.ts';
	import {
		analyticalChartOptions,
		supportedChartTypes,
		type AnalyticalChartType
	} from './chartOptions.ts';
	let {
		dataset,
		type,
		title,
		height = 300
	}: {
		dataset: AnalyticalDataset;
		type?: AnalyticalChartType;
		title?: string;
		height?: number;
	} = $props();
	let element: HTMLDivElement;
	let chart = $state.raw<EChartsType | null>(null);
	let ready = $state(false);
	let failure = $state('');
	const selectedType = $derived(type || dataset.defaultChart);
	const supported = $derived(supportedChartTypes(dataset).includes(selectedType));
	$effect(() => {
		if (chart && supported)
			chart.setOption(analyticalChartOptions(dataset, selectedType, element.clientWidth), {
				notMerge: true
			});
	});
	onMount(() => {
		let disposed = false;
		let initializing = false;
		async function initialize() {
			if (disposed || initializing || chart || !element.clientWidth) return;
			initializing = true;
			try {
				const { echarts } = await import('./echartsRuntime.ts');
				if (disposed) return;
				chart = echarts.init(element, undefined, { renderer: 'svg' });
				if (supported)
					chart.setOption(analyticalChartOptions(dataset, selectedType, element.clientWidth));
				ready = true;
			} catch {
				failure = 'The chart could not load. The exact data remains available below.';
			}
			initializing = false;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) void initialize();
			},
			{ rootMargin: '180px' }
		);
		observer.observe(element);
		const resize = new ResizeObserver(() => {
			if (chart && element.clientWidth) {
				const previous = chart.getOption() as {
					legend?: Array<{ selected?: Record<string, boolean> }>;
					dataZoom?: Array<{
						start?: number;
						end?: number;
						startValue?: number | string;
						endValue?: number | string;
					}>;
				};
				chart.resize();
				if (supported) {
					const options = analyticalChartOptions(dataset, selectedType, element.clientWidth);
					if (options.legend && !Array.isArray(options.legend) && previous.legend?.[0]?.selected)
						options.legend.selected = previous.legend[0].selected;
					if (Array.isArray(options.dataZoom))
						options.dataZoom = options.dataZoom.map((zoom, index) => ({
							...zoom,
							...previous.dataZoom?.[index]
						}));
					chart.setOption(options, { notMerge: true });
				}
			}
		});
		resize.observe(element);
		return () => {
			disposed = true;
			observer.disconnect();
			resize.disconnect();
			chart?.dispose();
			chart = null;
		};
	});
</script>

<div
	class="chart-wrap"
	style:min-height={`${height}px`}
	aria-busy={!ready && supported && !failure}
>
	<div
		bind:this={element}
		class="chart"
		style:height={`${height}px`}
		role="img"
		aria-label={`${title || dataset.title}. ${dataset.unit}. ${dataset.evidence}. Inspect the data table for exact values.`}
	></div>
	{#if !supported}<p class="chart-state">
			This view needs compatible data. Choose another chart type.
		</p>
	{:else if failure}<p class="chart-state" role="status">{failure}</p>
	{:else if !ready}<p class="chart-state">Loading chart…</p>{/if}
</div>

<style>
	.chart-wrap {
		position: relative;
		min-width: 0;
		width: 100%;
	}
	.chart {
		width: 100%;
		min-width: 0;
	}
	.chart-state {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 20px;
		text-align: center;
		color: #647381;
		font-size: 13px;
		background: #fff;
		border-radius: var(--surface-radius-inner, 16px);
	}
</style>
