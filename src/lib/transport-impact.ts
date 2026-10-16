/** Timetable benefits are separate from walking coverage and estimated passenger demand. */
export type TransportServiceMetrics = {
	departure_count?: number | null;
	first_departure_minutes?: number | null;
	last_departure_minutes?: number | null;
	next_departure_minutes?: number | null;
	next_wait_minutes?: number | null;
	expected_wait_minutes?: number | null;
	expected_wait_window_start_minutes?: number | null;
	expected_wait_window_end_minutes?: number | null;
	crossing_minutes?: number | null;
	boarding_stop_ids?: string[];
};

export type TransportImpactChange =
	'added' | 'removed' | 'improved' | 'worsened' | 'changed' | 'unchanged';

export type TransportLineImpact = {
	id: string;
	route_id?: string;
	name: string;
	mode: string;
	from_stop_name?: string;
	to_stop_name?: string;
	island_ids?: string[];
	change: TransportImpactChange;
	before?: TransportServiceMetrics | null;
	after?: TransportServiceMetrics | null;
	expected_wait_saved_minutes?: number | null;
	expected_wait_comparable?: boolean;
	expected_wait_comparison_reason?: string;
};

export type TransportConnectionImpact = {
	id: string;
	mode: string;
	from_island_id: string;
	to_island_id: string;
	from_island_name: string;
	to_island_name: string;
	change: TransportImpactChange;
	before?: (TransportServiceMetrics & { service_ids?: string[] }) | null;
	after?: (TransportServiceMetrics & { service_ids?: string[] }) | null;
	expected_wait_comparable?: boolean;
	expected_wait_comparison_reason?: string;
};

export type TransportImpactData = {
	service_date?: string;
	departure_minutes?: number | null;
	lines?: TransportLineImpact[];
	connections?: TransportConnectionImpact[];
	summary?: {
		changed_lines?: number;
		added_connections?: number;
		removed_connections?: number;
		improved_connections?: number;
		departures_before?: number;
		departures_after?: number;
	};
	qualification?: string;
	wait_method?: string;
};

const numberFormat = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 });

export function impactNumber(value: unknown): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function formatImpactMinutes(value: unknown, unavailable = 'Not estimated'): string {
	const minutes = impactNumber(value);
	return minutes === null ? unavailable : `${numberFormat.format(minutes)} min`;
}

export function formatImpactCount(value: unknown): string {
	const count = impactNumber(value);
	return count === null ? 'Unavailable' : new Intl.NumberFormat('en-GB').format(count);
}

export function formatImpactClock(value: unknown): string {
	const minutes = impactNumber(value);
	if (minutes === null) return 'No upcoming departure';
	const whole = Math.round(minutes);
	const days = Math.floor(whole / 1440);
	const clock = `${String(Math.floor((whole % 1440) / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}`;
	return `${clock}${days ? ` (+${days} ${days === 1 ? 'day' : 'days'})` : ''}`;
}

export function formatImpactDate(value: string | undefined): string {
	if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'Selected date';
	const date = new Date(`${value}T00:00:00Z`);
	if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
		return 'Selected date';
	return new Intl.DateTimeFormat('en-GB', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC'
	}).format(date);
}

export function changedTransportLines(impact: TransportImpactData | null | undefined) {
	return (impact?.lines ?? []).filter((line) => line.change !== 'unchanged');
}

export function changedIslandConnections(impact: TransportImpactData | null | undefined) {
	return (impact?.connections ?? []).filter((connection) => connection.change !== 'unchanged');
}

/** Only a like-for-like operating window supports a saved-wait claim. */
export function comparableWaitSaving(
	row: Pick<TransportLineImpact, 'before' | 'after' | 'expected_wait_comparable' | 'change'>
): number | null {
	if (!row.expected_wait_comparable || row.change === 'added' || row.change === 'removed')
		return null;
	const before = impactNumber(row.before?.expected_wait_minutes);
	const after = impactNumber(row.after?.expected_wait_minutes);
	return before === null || after === null ? null : before - after;
}

export function bestTransportWaitChange(impact: TransportImpactData | null | undefined) {
	const comparable = changedTransportLines(impact).flatMap((line) => {
		const saved = comparableWaitSaving(line);
		return saved === null || Math.abs(saved) < 0.05 ? [] : [{ line, saved }];
	});
	return (
		comparable.sort((first, second) => {
			// Lead with the strongest saving, but still report a reduction when no saving exists.
			if (first.saved > 0 !== second.saved > 0) return first.saved > 0 ? -1 : 1;
			return Math.abs(second.saved) - Math.abs(first.saved);
		})[0] ?? null
	);
}

export function waitChangeText(saved: number | null): string | null {
	if (saved === null || !Number.isFinite(saved)) return null;
	if (Math.abs(saved) < 0.05) return 'Expected wait unchanged';
	return `${formatImpactMinutes(Math.abs(saved))} ${saved > 0 ? 'shorter' : 'longer'} expected wait`;
}

/** A short, route-specific benefit; never an invented island-wide or passenger average. */
export function transportImpactHeadline(
	impact: TransportImpactData | null | undefined
): string | null {
	if (!impact) return null;
	const wait = bestTransportWaitChange(impact);
	if (wait) return `${waitChangeText(wait.saved)} · ${wait.line.name}`;
	const connections = changedIslandConnections(impact);
	const added = connections.filter((connection) => connection.change === 'added').length;
	if (added) return `${added} new island-to-island ${added === 1 ? 'direction' : 'directions'}`;
	const removed = connections.filter((connection) => connection.change === 'removed').length;
	if (removed)
		return `${removed} island-to-island ${removed === 1 ? 'direction' : 'directions'} removed`;
	const before = impactNumber(impact.summary?.departures_before);
	const after = impactNumber(impact.summary?.departures_after);
	if (before !== null && after !== null && before !== after)
		return `${formatImpactCount(Math.abs(after - before))} ${after > before ? 'more' : 'fewer'} scheduled departures on this date`;
	if (changedTransportLines(impact).length || connections.length)
		return 'Service changed · compare its timetable below';
	return null;
}

export function serviceAvailability(metrics: TransportServiceMetrics | null | undefined): string {
	if (metrics === null) return 'No dated service in data';
	const count = impactNumber(metrics?.departure_count);
	if (count === null) return 'Service evidence unavailable';
	if (count === 0) return 'No dated service in data';
	return `${formatImpactCount(count)} ${count === 1 ? 'departure' : 'departures'}`;
}

export function serviceWait(metrics: TransportServiceMetrics | null | undefined): string {
	if (metrics === null || impactNumber(metrics?.departure_count) === 0)
		return 'No dated service in data';
	return formatImpactMinutes(metrics?.expected_wait_minutes);
}

export function serviceTravelTime(metrics: TransportServiceMetrics | null | undefined): string {
	if (metrics === null || impactNumber(metrics?.departure_count) === 0) return 'No service';
	return formatImpactMinutes(metrics?.crossing_minutes);
}

export function serviceNextDeparture(metrics: TransportServiceMetrics | null | undefined): string {
	if (metrics === null || impactNumber(metrics?.departure_count) === 0)
		return 'No dated service in data';
	if (!metrics) return 'Service evidence unavailable';
	if ((metrics.boarding_stop_ids?.length ?? 0) > 1) return 'Varies by boarding stop';
	return formatImpactClock(metrics.next_departure_minutes);
}

export function serviceNextWait(metrics: TransportServiceMetrics | null | undefined): string {
	if (metrics === null || impactNumber(metrics?.departure_count) === 0)
		return 'No dated service in data';
	if (!metrics) return 'Service evidence unavailable';
	if ((metrics.boarding_stop_ids?.length ?? 0) > 1) return 'Varies by boarding stop';
	return formatImpactMinutes(metrics.next_wait_minutes, 'No upcoming departure');
}
