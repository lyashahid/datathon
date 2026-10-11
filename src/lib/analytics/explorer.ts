import type { AnalyticalDataset, AnalyticalRow } from './catalog.ts';

export interface DatasetLens {
	series: string;
	geography: string;
	periodStart: string;
	periodEnd: string;
}

export const emptyDatasetLens = (): DatasetLens => ({
	series: '',
	geography: '',
	periodStart: '',
	periodEnd: ''
});

export const normalizeSearch = (text: string) =>
	text
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase();

export function datasetDimensions(dataset: AnalyticalDataset) {
	const temporal = ['month', 'year'].includes(dataset.join.grain);
	return {
		series: [...new Set(dataset.rows.flatMap((row) => (row.series ? [row.series] : [])))].sort(),
		geographies: [
			...new Set(dataset.rows.flatMap((row) => (row.geography ? [row.geography] : [])))
		].sort(),
		periods: temporal ? [...new Set(dataset.rows.map((row) => row.key))].sort() : []
	};
}

/** Apply only documented dimensions; retain null values and every row's source receipts. */
export function focusDataset(dataset: AnalyticalDataset, lens: DatasetLens): AnalyticalDataset {
	const temporal = ['month', 'year'].includes(dataset.join.grain);
	const rows = dataset.rows.filter(
		(row) =>
			(!lens.series || row.series === lens.series) &&
			(!lens.geography || row.geography === lens.geography) &&
			(!temporal || !lens.periodStart || row.key >= lens.periodStart) &&
			(!temporal || !lens.periodEnd || row.key <= lens.periodEnd)
	);
	return { ...dataset, rows };
}

export function inspectRows(
	rows: AnalyticalRow[],
	query: string,
	order: 'source' | 'highest' | 'lowest'
): AnalyticalRow[] {
	const term = normalizeSearch(query.trim());
	const matching = rows.filter((row) =>
		normalizeSearch(
			`${row.label} ${row.series ?? ''} ${row.period ?? ''} ${row.geography ?? ''} ${row.detail ?? ''}`
		).includes(term)
	);
	if (order === 'source') return matching;
	return matching.toSorted((a, b) => {
		const aPresent = a.value != null && Number.isFinite(a.value);
		const bPresent = b.value != null && Number.isFinite(b.value);
		if (!aPresent) return bPresent ? 1 : 0;
		if (!bPresent) return -1;
		return order === 'highest' ? b.value! - a.value! : a.value! - b.value!;
	});
}

export function datasetCompleteness(dataset: AnalyticalDataset) {
	const available = dataset.rows.filter(
		(row) => row.value != null && Number.isFinite(row.value)
	).length;
	return { available, missing: dataset.rows.length - available, total: dataset.rows.length };
}
