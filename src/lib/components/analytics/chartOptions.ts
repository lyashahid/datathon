import type { EChartsOption } from 'echarts';
import type { AnalyticalDataset, AnalyticalRow } from '#lib/analytics/catalog.ts';

export type AnalyticalChartType = 'line' | 'bar' | 'scatter' | 'heatmap';
const colors = ['#087f78', '#486ba1', '#b07d2d', '#86628a', '#647b45'];
const number = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const escape = (value: unknown) =>
	String(value ?? '').replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
	);
export const seriesNames = (dataset: AnalyticalDataset) => [
	...new Set(dataset.rows.map((row) => row.series || dataset.title))
];
export const isTemporal = (dataset: AnalyticalDataset) =>
	['month', 'year'].includes(dataset.join.grain);
export const isHourlySchedule = (dataset: AnalyticalDataset) =>
	dataset.join.grain === 'category' && dataset.join.domain === 'greater-male:service-hours';
export function pairedRows(dataset: AnalyticalDataset) {
	const names = seriesNames(dataset);
	if (names.length !== 2) return [];
	const keys = [...new Set(dataset.rows.map((row) => row.key))];
	return keys.flatMap((key) => {
		const a = dataset.rows.find(
			(row) => row.key === key && (row.series || dataset.title) === names[0]
		);
		const b = dataset.rows.find(
			(row) => row.key === key && (row.series || dataset.title) === names[1]
		);
		return a?.value != null && b?.value != null
			? [{ key, label: a.label, x: a.value, y: b.value }]
			: [];
	});
}
export function supportedChartTypes(dataset: AnalyticalDataset): AnalyticalChartType[] {
	const types: AnalyticalChartType[] = ['bar'];
	if (isTemporal(dataset)) types.unshift('line');
	if (dataset.join.grain === 'month' && seriesNames(dataset).length === 1) types.push('heatmap');
	if (isHourlySchedule(dataset)) types.push('heatmap');
	if (pairedRows(dataset).length >= 3) types.push('scatter');
	return types;
}
const time = (row: AnalyticalRow) =>
	Date.parse(`${/^\d{4}$/.test(row.key) ? row.key + '-01' : row.key}-01T00:00:00Z`);
const labelValue = (row: AnalyticalRow, unit: string) =>
	`${escape(row.label)}<br/><b>${row.value == null ? 'Not reported' : number.format(row.value)}</b> ${escape(unit)}${row.series ? `<br/>${escape(row.series)}` : ''}`;

export function analyticalChartOptions(
	dataset: AnalyticalDataset,
	type: AnalyticalChartType,
	width = 700
): EChartsOption {
	const names = seriesNames(dataset);
	const multiple = names.length > 1;
	const narrow = width < 440;
	const base: EChartsOption = {
		animation: false,
		useUTC: true,
		color: colors,
		textStyle: { fontFamily: 'Inter, system-ui, sans-serif', fontSize: 12, color: '#647381' },
		aria: {
			enabled: true,
			label: {
				description: `${dataset.title}. ${dataset.rows.length} records. ${dataset.unit}. ${dataset.evidence}. Exact values are available in the data table.`
			}
		},
		grid: { left: narrow ? 48 : 62, right: 20, top: multiple ? 54 : 30, bottom: 38 },
		legend: multiple
			? {
					top: 0,
					type: 'scroll',
					textStyle: { fontSize: 12, color: '#52616f' },
					icon: 'roundRect',
					itemHeight: 3,
					itemWidth: 15
				}
			: undefined,
		tooltip: {
			confine: true,
			backgroundColor: '#fff',
			borderColor: '#dde3e9',
			textStyle: { fontSize: 12, color: '#172b3a' },
			extraCssText: 'max-width:280px;white-space:normal;box-shadow:0 4px 20px #172b3a15;'
		}
	};
	const axis = {
		axisLine: { lineStyle: { color: '#d5dde5' } },
		axisTick: { show: false },
		axisLabel: { color: '#647381', fontSize: 12 },
		splitLine: { lineStyle: { color: '#eef1f4' } }
	};
	if (type === 'scatter') {
		const pairs = pairedRows(dataset);
		return {
			...base,
			legend: { show: false },
			grid: { left: 62, right: 20, top: 28, bottom: 62 },
			xAxis: {
				...axis,
				type: 'value',
				name: names[0],
				nameLocation: 'middle',
				nameGap: 35,
				nameTruncate: { maxWidth: Math.max(120, width - 90) },
				axisLabel: { ...axis.axisLabel, formatter: (value: number) => compact.format(value) }
			},
			yAxis: {
				...axis,
				type: 'value',
				name: names[1],
				nameTextStyle: { fontSize: 11 },
				nameTruncate: { maxWidth: Math.max(120, width - 70) },
				axisLabel: { ...axis.axisLabel, formatter: (value: number) => compact.format(value) }
			},
			tooltip: {
				...base.tooltip,
				trigger: 'item',
				formatter: (params: unknown) => {
					const p = params as { dataIndex: number };
					const row = pairs[p.dataIndex];
					return row
						? `${escape(row.label)}<br/>${escape(names[0])}: <b>${number.format(row.x)}</b><br/>${escape(names[1])}: <b>${number.format(row.y)}</b><br/>${escape(dataset.unit)}`
						: '';
				}
			},
			series: [
				{
					type: 'scatter',
					data: pairs.map((p) => [p.x, p.y]),
					symbolSize: 9,
					itemStyle: { opacity: 0.75 },
					emphasis: { itemStyle: { opacity: 1 } }
				}
			]
		};
	}
	if (type === 'heatmap') {
		const hourly = isHourlySchedule(dataset);
		const valid = hourly
			? dataset.rows
			: dataset.rows.filter((row) => /^\d{4}-\d{2}$/.test(row.key));
		const hours = [...new Set(valid.map((row) => row.key))].sort();
		const years = hourly ? names : [...new Set(valid.map((row) => row.key.slice(0, 4)))].sort();
		const values = valid.filter((row) => row.value != null);
		const max = Math.max(1, ...values.map((row) => row.value!));
		return {
			...base,
			grid: {
				left: hourly ? (narrow ? 94 : Math.min(180, width * 0.3)) : 46,
				right: 15,
				top: 20,
				bottom: 70
			},
			legend: { show: false },
			xAxis: {
				...axis,
				type: 'category',
				data: hourly
					? hours.map((key) => valid.find((row) => row.key === key)!.label)
					: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
				splitArea: { show: false },
				axisLabel: { ...axis.axisLabel, interval: hourly ? (narrow ? 5 : 2) : narrow ? 1 : 0 }
			},
			yAxis: {
				...axis,
				type: 'category',
				data: years,
				inverse: hourly,
				splitArea: { show: false },
				axisLabel: {
					...axis.axisLabel,
					interval: 0,
					width: hourly ? (narrow ? 80 : Math.min(165, width * 0.28)) : 40,
					overflow: 'truncate'
				}
			},
			visualMap: {
				min: 0,
				max,
				calculable: false,
				orient: 'horizontal',
				left: 'center',
				bottom: 0,
				itemHeight: 110,
				itemWidth: 10,
				inRange: { color: ['#e8f2f0', '#9ecbc2', '#087f78'] },
				formatter: (value) => compact.format(Number(value)),
				textStyle: { fontSize: 11 },
				text: [number.format(max), '0'],
				textGap: 8
			},
			tooltip: {
				...base.tooltip,
				formatter: (params: unknown) => {
					const p = params as { dataIndex: number };
					return values[p.dataIndex] ? labelValue(values[p.dataIndex], dataset.unit) : '';
				}
			},
			series: [
				{
					type: 'heatmap',
					data: values.map((row) => [
						hourly ? hours.indexOf(row.key) : Number(row.key.slice(5, 7)) - 1,
						hourly
							? years.indexOf(row.series || dataset.title)
							: years.indexOf(row.key.slice(0, 4)),
						row.value
					]),
					itemStyle: { borderColor: '#fff', borderWidth: 2 },
					emphasis: { itemStyle: { borderColor: '#172b3a', borderWidth: 1 } }
				}
			]
		};
	}
	if (type === 'line') {
		const sorted = [...dataset.rows].sort((a, b) => a.key.localeCompare(b.key));
		return {
			...base,
			xAxis: {
				...axis,
				type: 'time',
				min: 'dataMin',
				max: 'dataMax',
				splitNumber: narrow ? 3 : 5,
				axisLabel: {
					...axis.axisLabel,
					hideOverlap: true,
					showMinLabel: true,
					showMaxLabel: true,
					formatter: (value: number) =>
						new Date(value).toLocaleDateString('en', {
							month: dataset.join.grain === 'month' ? 'short' : undefined,
							year: '2-digit',
							timeZone: 'UTC'
						})
				},
				splitLine: { show: false }
			},
			yAxis: {
				...axis,
				type: 'value',
				min: 0,
				splitNumber: 4,
				name: dataset.unit,
				nameTextStyle: { fontSize: 11 },
				nameTruncate: { maxWidth: Math.max(100, width - 80) },
				axisLabel: { ...axis.axisLabel, formatter: (value: number) => compact.format(value) }
			},
			tooltip: {
				...base.tooltip,
				trigger: 'axis',
				formatter: (params: unknown) => {
					const items = params as Array<{ seriesName: string; value: [number, number | null] }>;
					if (!items.length) return '';
					const date = new Date(items[0].value[0]).toLocaleDateString('en', {
						month: 'long',
						year: 'numeric',
						timeZone: 'UTC'
					});
					return `${escape(date)}${items.map((p) => `<br/>${escape(p.seriesName)}: <b>${p.value[1] == null ? 'Not reported' : number.format(p.value[1])}</b>`).join('')}<br/>${escape(dataset.unit)}`;
				}
			},
			series: names.map((name, i) => ({
				name,
				type: 'line',
				connectNulls: false,
				smooth: false,
				symbol: i % 2 ? 'rect' : 'circle',
				symbolSize: 5,
				showSymbol: sorted.length < 25,
				lineStyle: { width: 2, type: i % 2 ? 'dashed' : 'solid' },
				data: sorted
					.filter((row) => (row.series || dataset.title) === name)
					.map((row) => [time(row), row.value])
			}))
		};
	}
	const keys = [...new Set(dataset.rows.map((row) => row.key))];
	const labels = keys.map((key) => dataset.rows.find((row) => row.key === key)!.label);
	const zoom = keys.length > 12;
	return {
		...base,
		grid: {
			left: narrow ? 92 : Math.min(170, width * 0.3),
			right: zoom ? 50 : 30,
			top: multiple ? 54 : 30,
			bottom: 30
		},
		xAxis: {
			...axis,
			type: 'value',
			min: 0,
			name: dataset.unit,
			nameLocation: 'middle',
			nameGap: 23,
			nameTextStyle: { fontSize: 11 },
			splitNumber: narrow ? 3 : 5,
			axisLabel: { ...axis.axisLabel, formatter: (value: number) => compact.format(value) }
		},
		yAxis: {
			...axis,
			type: 'category',
			inverse: true,
			data: labels,
			axisLabel: {
				...axis.axisLabel,
				width: narrow ? 78 : Math.min(155, width * 0.28),
				overflow: 'truncate',
				interval: 0
			},
			splitLine: { show: false }
		},
		dataZoom: zoom
			? [
					{
						type: 'slider',
						yAxisIndex: 0,
						startValue: 0,
						endValue: 11,
						right: 0,
						width: 14,
						showDetail: false,
						brushSelect: false
					}
				]
			: undefined,
		tooltip: {
			...base.tooltip,
			trigger: 'item',
			formatter: (params: unknown) => {
				const p = params as { seriesName: string; dataIndex: number };
				const row = dataset.rows.find(
					(r) => r.key === keys[p.dataIndex] && (r.series || dataset.title) === p.seriesName
				);
				return row ? labelValue(row, dataset.unit) : '';
			}
		},
		series: names.map((name) => ({
			name,
			type: 'bar',
			barMaxWidth: 22,
			itemStyle: { borderRadius: [0, 2, 2, 0] },
			data: keys.map(
				(key) =>
					dataset.rows.find((r) => r.key === key && (r.series || dataset.title) === name)?.value ??
					null
			)
		}))
	};
}
