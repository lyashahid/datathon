/** Convert a zoned instant to MVT calendar fields independently of browser/system timezone. */
export function maldivesDateTime(value: string): { date: string; time: string } | null {
	const instant = Date.parse(value);
	if (!Number.isFinite(instant) || !/(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null;
	const shifted = new Date(instant + 5 * 60 * 60 * 1000).toISOString();
	return { date: shifted.slice(0, 10), time: shifted.slice(11, 16) };
}
