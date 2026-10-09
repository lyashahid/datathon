import type { MetadataValue } from '#lib/types/domain.ts';

const NUMBER_FORMAT = new Intl.NumberFormat('en-US');

/** "dailyBoardings" -> "Daily boardings" */
export function humanizeKey(key: string): string {
	const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
	return words.charAt(0).toUpperCase() + words.slice(1).toLowerCase();
}

export function formatMetadataValue(value: MetadataValue | undefined): string {
	if (value === null || value === undefined) return '—';
	if (typeof value === 'boolean') return value ? 'Yes' : 'No';
	if (typeof value === 'number') return NUMBER_FORMAT.format(value);
	return value;
}

/** Hemisphere-suffixed coordinate pair, e.g. "4.17480°N 73.50450°E". */
export function formatLatLng(lng: number, lat: number, decimals: number): string {
	const part = (v: number, pos: string, neg: string) =>
		`${Math.abs(v).toFixed(decimals)}°${v >= 0 ? pos : neg}`;
	return `${part(lat, 'N', 'S')} ${part(lng, 'E', 'W')}`;
}

/**
 * Estimates are rounded to avoid implying false precision: to the nearest hundred, or nearest
 * ten / unit for the small counts found in individual grid cells.
 */
export function formatPopulation(value: number): string {
	const step = value >= 1000 ? 100 : value >= 100 ? 10 : 1;
	return `≈${NUMBER_FORMAT.format(Math.round(value / step) * step)}`;
}

export function formatDistance(metres: number): string {
	return metres < 1000 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1000).toFixed(1)} km`;
}

export function formatMinutes(minutes: number): string {
	return `${Math.max(1, Math.round(minutes))} min`;
}

const COMPACT_FORMAT = new Intl.NumberFormat('en-US', {
	notation: 'compact',
	maximumFractionDigits: 1
});

/** Short axis/legend labels, e.g. 90000 → "90K". */
export function formatCompact(value: number): string {
	return COMPACT_FORMAT.format(value);
}
