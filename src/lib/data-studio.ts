/** Dataset query and saved-story contracts shared by the builder and its validation. */
export type Column = {
	name: string;
	type: string;
	nullable: boolean;
	missing_count: number;
	distinct_count: number;
	examples: string[];
};

export type Rule = {
	column: string;
	op: 'eq' | 'ne' | 'contains' | 'in' | 'gte' | 'lte' | 'gt' | 'lt' | 'missing';
	value: unknown;
};

export type ChartDefinition = {
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

export type Story = {
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

/** Match the backend's strict scalar types before submitting a source filter. */
export function datasetFilter(
	columns: Column[],
	columnName: string,
	op: Rule['op'],
	input: string
): Rule {
	const column = columns.find((item) => item.name === columnName);
	if (!column) throw new Error('Choose a column from the selected source collection.');
	let value: unknown = input;
	if (op === 'missing') value = true;
	else if (op === 'contains') value = input;
	else if (op === 'in') {
		try {
			value = JSON.parse(input);
		} catch {
			throw new Error('Use a JSON array for an inclusion filter.');
		}
		if (
			!Array.isArray(value) ||
			value.length > 500 ||
			value.some(
				(item) =>
					item !== null &&
					typeof item !== 'string' &&
					typeof item !== 'boolean' &&
					!(typeof item === 'number' && Number.isFinite(item))
			)
		)
			throw new Error('Use an array of at most 500 text, numeric, boolean or null values.');
	} else {
		if (['gte', 'lte', 'gt', 'lt'].includes(op) && column.type !== 'number')
			throw new Error('Choose a numeric column for an at-least or at-most filter.');
		if (column.type === 'number') {
			value = Number(input);
			if (!input.trim() || !Number.isFinite(value as number))
				throw new Error('Enter a finite numeric filter value.');
		} else if (column.type === 'boolean') {
			const normalized = input.trim().toLowerCase();
			if (!['true', 'false'].includes(normalized))
				throw new Error('Boolean filters use true or false.');
			value = normalized === 'true';
		}
	}
	return { column: columnName, op, value };
}

export function validStory(value: unknown): value is Story {
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
