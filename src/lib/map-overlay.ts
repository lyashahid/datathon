/** Shared colours for the rendered gap scale, its legend and neighbourhood details. */
export const GAP_PALETTE = {
	shorter: '#16866e',
	middle: '#edbf50',
	longer: '#d65840',
	unknown: '#8f9baa'
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
