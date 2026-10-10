import { INGESTION_RULES } from '#lib/config/ingestion.ts';
import type { Position } from '#lib/types/domain.ts';
import { isValidLngLat, toWgs84 } from './crs.ts';
import type { Crs } from './types.ts';

const round = (v: number) => Number(v.toFixed(INGESTION_RULES.coordinateDecimals));

/** Transforms and rounds one coordinate; null if it is missing, non-numeric or off the globe. */
export function canonicalPosition(raw: readonly unknown[], crs: Crs): Position | null {
	const p = toWgs84(raw, crs);
	if (!p || !isValidLngLat(p)) return null;
	return [round(p[0]), round(p[1])];
}
