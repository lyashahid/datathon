import type { Feature, FeatureCollection } from 'geojson';
import { impactClass, impactColors } from './planning-map.js';
import type { PlanningComparison, PlanningPlace } from './planning-map.js';

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
					impact,
					color: impactColors[impact],
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
