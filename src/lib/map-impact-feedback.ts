import type { FeatureCollection } from 'geojson';

const knownAccess = new Set(['within_target', 'beyond_target', 'mixed', 'unavailable']);
const finite = (value: unknown): value is number =>
	typeof value === 'number' && Number.isFinite(value);
const cellKey = (properties: Record<string, unknown>, id: unknown) =>
	String(properties.id ?? id ?? '');

function phaseChanged(
	a: Record<string, unknown>,
	aPhase: string,
	b: Record<string, unknown>,
	bPhase: string
) {
	if (a[`${aPhase}_access`] !== b[`${bPhase}_access`]) return true;
	const aMinutes = a[aPhase];
	const bMinutes = b[bPhase];
	if (finite(aMinutes) && finite(bMinutes) && Math.abs(aMinutes - bMinutes) > 0.05) return true;
	const aWithin = a[`${aPhase}_residents_within_target`];
	const bWithin = b[`${bPhase}_residents_within_target`];
	return finite(aWithin) && finite(bWithin) && Math.abs(aWithin - bWithin) > 0.5;
}

/** A small, temporary overlay; never modifies canonical scores or the full comparison mesh. */
export function changedImpactCells(
	current: FeatureCollection,
	previous?: FeatureCollection | null
): FeatureCollection {
	const prior = new Map(
		(previous?.features ?? []).map((feature) => [
			cellKey(feature.properties ?? {}, feature.id),
			feature.properties ?? {}
		])
	);
	return {
		type: 'FeatureCollection',
		features: current.features.flatMap((feature) => {
			const p = feature.properties ?? {};
			if (
				p.view !== 'comparison' ||
				!['Polygon', 'MultiPolygon'].includes(feature.geometry.type) ||
				!finite(p.population) ||
				p.population <= 0 ||
				!knownAccess.has(String(p.before_access)) ||
				!knownAccess.has(String(p.after_access))
			)
				return [];
			const key = cellKey(p, feature.id);
			const old = key ? prior.get(key) : undefined;
			if (old ? !phaseChanged(old, 'after', p, 'after') : !phaseChanged(p, 'before', p, 'after'))
				return [];
			return [
				{
					...feature,
					properties: {
						...p,
						feedback_before_color: old?.after_color ?? p.before_color,
						feedback_color: p.after_color
					}
				}
			];
		})
	};
}
