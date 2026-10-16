import type { Feature, FeatureCollection } from 'geojson';
import { impactClass, impactColors } from './planning-map.js';
import type { PlanningComparison, PlanningPlace } from './planning-map.js';
import { GAP_PALETTE } from './map-overlay.js';

type Contribution = { origin_id: string; share: number };
type Evidence = { weight: number | null; values: Record<string, number | null> };

const gapMetrics = [
	'health_gap',
	'health_minutes',
	'education_gap',
	'education_minutes',
	'transport_gap',
	'transport_minutes',
	'overall_gap'
];

function numeric(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function residents(value: unknown): number | null {
	const number = numeric(value);
	return number !== null && number >= 0 ? number : null;
}

function contributions(cell: Feature): Contribution[] {
	const items: unknown = cell.properties?.contributions;
	if (!Array.isArray(items)) return [];
	return items.filter(
		(item): item is Contribution =>
			typeof item === 'object' &&
			item !== null &&
			typeof item.origin_id === 'string' &&
			typeof item.share === 'number' &&
			Number.isFinite(item.share) &&
			item.share > 0
	);
}

function journeyProvenance(parts: Contribution[], rows: Map<string, PlanningComparison>) {
	const observed = parts.flatMap(({ origin_id }) => {
		const row = rows.get(origin_id);
		return row ? [row] : [];
	});
	return {
		source_origin_ids: [...new Set(parts.map(({ origin_id }) => origin_id))],
		before_destination_ids: [
			...new Set(
				observed.flatMap((row) => (row.before.destination_id ? [row.before.destination_id] : []))
			)
		],
		after_destination_ids: [
			...new Set(
				observed.flatMap((row) => (row.after.destination_id ? [row.after.destination_id] : []))
			)
		],
		before_reasons: [
			...new Set(observed.flatMap((row) => (row.before.reason ? [row.before.reason] : [])))
		],
		after_reasons: [
			...new Set(observed.flatMap((row) => (row.after.reason ? [row.after.reason] : [])))
		]
	};
}

function population(rows: Evidence[]): number | null {
	if (!rows.length || rows.some((row) => row.weight === null)) return null;
	return rows.reduce((total, row) => total + (row.weight ?? 0), 0);
}

/** A partially observed cell stays unknown; never normalize away missing residents. */
function mean(rows: Evidence[], key: string): number | null {
	const total = population(rows);
	if (total === null || total === 0 || rows.some((row) => row.values[key] == null)) return null;
	return rows.reduce((sum, row) => sum + (row.weight ?? 0) * (row.values[key] ?? 0), 0) / total;
}

/** Re-bin source evidence into the backend's clipped display grid without changing its totals. */
export function displayGapHexes(
	source: FeatureCollection,
	mesh: FeatureCollection
): FeatureCollection {
	const byOrigin = new Map(source.features.map((item) => [item.properties?.origin_id, item]));
	const metrics = new Set([
		...gapMetrics,
		...source.features.flatMap((item) =>
			Object.keys(item.properties ?? {}).filter((key) => /_(gap|minutes)$/.test(key))
		)
	]);
	return {
		...mesh,
		features: mesh.features.map((cell) => {
			const parts = contributions(cell);
			const rows = parts.map(({ origin_id, share }): Evidence => {
				const properties = byOrigin.get(origin_id)?.properties;
				const count = residents(properties?.population);
				return {
					weight: count === null ? null : count * share,
					values: Object.fromEntries([...metrics].map((key) => [key, numeric(properties?.[key])]))
				};
			});
			const values = Object.fromEntries([...metrics].map((key) => [key, mean(rows, key)]));
			return {
				...cell,
				properties: {
					...cell.properties,
					origin_id: cell.properties?.id ?? cell.id,
					population: population(rows),
					...values,
					display_grid: true,
					source_origin_count: new Set(parts.map((part) => part.origin_id)).size,
					partial_evidence: population(rows) === null || Object.values(values).includes(null)
				}
			};
		})
	};
}

// Missing comparisons and unavailable journeys take precedence over favorable observations.
const impactPriority = [
	'uncomputed',
	'unavailable',
	'disrupted',
	'lost',
	'slower',
	'unchanged',
	'improved',
	'gained'
];

/** Aggregate comparisons for display only. Canonical evaluation summaries remain source based. */
export function displayImpactHexes(
	origins: PlanningPlace[],
	comparisons: PlanningComparison[],
	mesh: FeatureCollection
): FeatureCollection {
	const byOrigin = new Map(origins.map((origin) => [origin.id, origin]));
	const byComparison = new Map(comparisons.map((row) => [row.origin_id, row]));
	return {
		...mesh,
		features: mesh.features.map((cell) => {
			const parts = contributions(cell);
			const classes = new Map<string, number>();
			const rows = parts.map(({ origin_id, share }): Evidence => {
				const row = byComparison.get(origin_id);
				const count = residents(row?.population ?? byOrigin.get(origin_id)?.population2026);
				const before = row?.before.status === 'reachable' ? numeric(row.before.minutes) : null;
				const after = row?.after.status === 'reachable' ? numeric(row.after.minutes) : null;
				const values = {
					before,
					after,
					delta: before !== null && after !== null ? numeric(row?.delta_minutes) : null
				};
				const impact =
					!row || count === null
						? 'uncomputed'
						: row.after.status !== 'reachable'
							? impactClass(row)
							: Object.values(values).includes(null)
								? 'uncomputed'
								: impactClass(row);
				classes.set(impact, (classes.get(impact) ?? 0) + (count ?? 0) * share);
				return { weight: count === null ? null : count * share, values };
			});
			const unknown = impactPriority.slice(0, 3).find((key) => classes.has(key));
			const dominant = impactPriority.reduce(
				(best, key) => ((classes.get(key) ?? -1) > (classes.get(best) ?? -1) ? key : best),
				'uncomputed'
			);
			const impact = population(rows) === 0 ? 'uncomputed' : (unknown ?? dominant);
			const values = Object.fromEntries(
				['before', 'after', 'delta'].map((key) => [key, mean(rows, key)])
			);
			return {
				...cell,
				properties: {
					...cell.properties,
					id: cell.properties?.id ?? cell.id,
					view: 'improvement',
					impact,
					color: impactColors[impact],
					population: population(rows),
					...values,
					display_grid: true,
					...journeyProvenance(parts, byComparison),
					source_origin_count: new Set(parts.map((part) => part.origin_id)).size,
					partial_evidence: population(rows) === null || Object.values(values).includes(null)
				}
			};
		})
	};
}

export const accessColors: Record<string, string> = {
	within_target: '#16866e',
	beyond_target: '#dd806b',
	mixed: '#d9ad54',
	unavailable: '#a6a5b5',
	unknown: GAP_PALETTE.unknown
};

/** Match the map's linear journey-ratio scale; meeting a target is not itself an improvement. */
function journeyGapColor(gap: number): string {
	const stops =
		gap <= 0.5
			? [GAP_PALETTE.shorter, GAP_PALETTE.middle]
			: [GAP_PALETTE.middle, GAP_PALETTE.longer];
	const fraction = gap <= 0.5 ? gap * 2 : (gap - 0.5) * 2;
	const channels = [1, 3, 5].map((offset) => {
		const start = Number.parseInt(stops[0].slice(offset, offset + 2), 16);
		const end = Number.parseInt(stops[1].slice(offset, offset + 2), 16);
		return Math.round(start + (end - start) * fraction)
			.toString(16)
			.padStart(2, '0');
	});
	return `#${channels.join('')}`;
}

type AccessCounts = {
	within_target: number;
	beyond_target: number;
	unavailable: number;
	unknown: number;
};

function phaseAccess(
	parts: Contribution[],
	byOrigin: Map<string, PlanningPlace>,
	byComparison: Map<string, PlanningComparison>,
	phase: 'before' | 'after',
	targetMinutes: number,
	population: unknown
) {
	const counts: AccessCounts = {
		within_target: 0,
		beyond_target: 0,
		unavailable: 0,
		unknown: 0
	};
	let missingPopulation = false;
	let unknownEvidence = false;
	let weightedGap = 0;
	for (const { origin_id, share } of parts) {
		const row = byComparison.get(origin_id);
		const count = residents(row?.population ?? byOrigin.get(origin_id)?.population2026);
		if (count === null) {
			missingPopulation = true;
			continue;
		}
		if (count === 0) continue;
		const journey = row?.[phase];
		const minutes = numeric(journey?.minutes);
		const key =
			!journey ||
			(journey.status !== 'reachable' && journey.status !== 'unavailable') ||
			(journey.status === 'reachable' && (minutes === null || minutes < 0))
				? 'unknown'
				: journey.status === 'unavailable'
					? 'unavailable'
					: minutes! <= targetMinutes
						? 'within_target'
						: 'beyond_target';
		if (key === 'unknown') unknownEvidence = true;
		counts[key] += count * share;
		if (key === 'within_target' || key === 'beyond_target')
			weightedGap += count * share * Math.min(1, minutes! / targetMinutes);
	}
	const access =
		missingPopulation || unknownEvidence || !residents(population)
			? 'unknown'
			: counts.unavailable > 0
				? 'unavailable'
				: counts.within_target > 0 && counts.beyond_target > 0
					? 'mixed'
					: counts.beyond_target > 0
						? 'beyond_target'
						: 'within_target';
	const gap =
		access === 'unknown' || access === 'unavailable'
			? null
			: Math.min(1, Math.max(0, weightedGap / (population as number)));
	return {
		access,
		gap,
		color: gap === null ? accessColors[access] : journeyGapColor(gap),
		residents_within_target: counts.within_target,
		residents_beyond_target: counts.beyond_target,
		residents_unavailable: counts.unavailable,
		residents_unknown: missingPopulation ? null : counts.unknown,
		partial_evidence: missingPopulation || unknownEvidence || counts.unavailable > 0 || !population
	};
}

/** Build both phases once so switching the comparison only changes the map's paint. */
export function displayComparisonHexes(
	origins: PlanningPlace[],
	comparisons: PlanningComparison[],
	mesh: FeatureCollection,
	targetMinutes: number
): FeatureCollection {
	if (!Number.isFinite(targetMinutes) || targetMinutes <= 0)
		throw new RangeError('The journey target must be a positive number of minutes.');
	const byOrigin = new Map(origins.map((origin) => [origin.id, origin]));
	const byComparison = new Map(comparisons.map((row) => [row.origin_id, row]));
	const impact = displayImpactHexes(origins, comparisons, mesh);
	return {
		...impact,
		features: impact.features.map((cell) => {
			const parts = contributions(cell);
			const properties = { ...cell.properties, view: 'comparison', target_minutes: targetMinutes };
			for (const phase of ['before', 'after'] as const) {
				const values = phaseAccess(
					parts,
					byOrigin,
					byComparison,
					phase,
					targetMinutes,
					cell.properties?.population
				);
				Object.assign(
					properties,
					Object.fromEntries(
						Object.entries(values).map(([key, value]) => [`${phase}_${key}`, value])
					)
				);
			}
			return { ...cell, properties };
		})
	};
}

/** Resolve just the inspected cell; never copy the full mesh to change the selected phase. */
export function comparisonCellProperties(
	properties: Record<string, unknown>,
	phase: 'before' | 'after'
): Record<string, unknown> {
	if (properties.view !== 'comparison') return properties;
	return {
		...properties,
		view: phase,
		access: properties[`${phase}_access`],
		color: properties[`${phase}_color`],
		selected_gap: properties[`${phase}_gap`] ?? null,
		selected_minutes: properties[phase] ?? null,
		residents_within_target: properties[`${phase}_residents_within_target`],
		residents_beyond_target: properties[`${phase}_residents_beyond_target`],
		residents_unavailable: properties[`${phase}_residents_unavailable`],
		residents_unknown: properties[`${phase}_residents_unknown`],
		partial_evidence: properties[`${phase}_partial_evidence`]
	};
}

/** Current and proposed access reuse the improvement mesh and the evaluated journey evidence. */
export function displayAccessHexes(
	origins: PlanningPlace[],
	comparisons: PlanningComparison[],
	mesh: FeatureCollection,
	phase: 'before' | 'after',
	targetMinutes: number
): FeatureCollection {
	const comparison = displayComparisonHexes(origins, comparisons, mesh, targetMinutes);
	return {
		...comparison,
		features: comparison.features.map((cell) => ({
			...cell,
			properties: comparisonCellProperties(cell.properties ?? {}, phase)
		}))
	};
}
