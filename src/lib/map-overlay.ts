import { themeColors } from '#lib/theme.js';
import type { Feature, FeatureCollection } from 'geojson';

/** Shared colours for the rendered gap scale, its legend and neighbourhood details. */
export const GAP_PALETTE = {
	shorter: themeColors.color16866e,
	middle: themeColors.coloredbf50,
	longer: themeColors.colord65840,
	unknown: themeColors.color8f9baa
} as const;

export const GAP_GRADIENT = `linear-gradient(90deg, ${GAP_PALETTE.shorter}, ${GAP_PALETTE.middle}, ${GAP_PALETTE.longer})`;
export const DEFAULT_OVERLAY_OPACITY = 65;
export const OVERLAY_OPACITY_KEY = 'mobility:map-overlay-opacity';

/** Invalid or unavailable stored preferences keep the default; zero intentionally hides the overlay. */
export function overlayOpacityPreference(value: unknown): number {
	if (typeof value !== 'number' && typeof value !== 'string') return DEFAULT_OVERLAY_OPACITY;
	if (typeof value === 'string' && !value.trim()) return DEFAULT_OVERLAY_OPACITY;
	const number = Number(value);
	return Number.isFinite(number)
		? Math.max(0, Math.min(100, Math.round(number)))
		: DEFAULT_OVERLAY_OPACITY;
}
/** Keep neighbouring evidence visible; a proposal replaces only its own display cells. */
export function backgroundAccessGaps(
	gaps: FeatureCollection,
	comparison: FeatureCollection
): FeatureCollection {
	if (!comparison.features.length) return gaps;
	const key = (feature: Feature) => {
		const island = feature.properties?.island_id;
		const id = feature.properties?.id ?? feature.id;
		return island != null && id != null ? JSON.stringify([island, id]) : null;
	};
	const replaced = new Set(comparison.features.map(key).filter((id) => id !== null));
	return {
		...gaps,
		features: gaps.features.filter((feature) => {
			const id = key(feature);
			return id === null || !replaced.has(id);
		})
	};
}
