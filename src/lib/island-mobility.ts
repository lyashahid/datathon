import type { FeatureCollection } from 'geojson';
import type { TaxiProfile } from './mobility-patterns.js';

export type TaxiCorridor = TaxiProfile & { pickup_zone: string; dropoff_zone: string };
type Evidence = {
	status: string;
	reason?: string;
	sources?: { title: string; url: string }[];
	limitations?: string[];
};
export type IslandMobility = {
	island: { id: string; name: string; atoll?: string };
	taxis: Evidence & {
		period?: { from: string; through: string };
		pickup_summary?: TaxiProfile | null;
		pickup_hourly?: (TaxiProfile & { hour: number })[];
		outbound_corridors?: TaxiCorridor[];
		inbound_corridors?: TaxiCorridor[];
		outbound_hourly?: (TaxiCorridor & { hour: number })[];
		inbound_hourly?: (TaxiCorridor & { hour: number })[];
		coverage?: { minimum_profile_records?: number };
	};
	vessels: Evidence & {
		period?: { from: string; through: string };
		summary?: { tracked_devices: number; days_observed: number } | null;
		daily?: { date: string; tracked_devices: number }[];
	};
};
export type MobilityMapSelection = { islandId: string; features: FeatureCollection } | null;

export const taxiZoneNames: Record<string, string> = {
	male: 'Malé',
	hulhumale: 'Hulhumalé',
	hulhule: 'Hulhulé'
};
export const taxiCorridorId = (row: TaxiCorridor) => `${row.pickup_zone}:${row.dropoff_zone}`;

/** A within-island profile belongs to one choice, even though both direction lists include it. */
export function taxiChoices(taxi: IslandMobility['taxis']) {
	const seen = new Set<string>();
	return [...(taxi.outbound_corridors ?? []), ...(taxi.inbound_corridors ?? [])].filter((row) => {
		const key = taxiCorridorId(row);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** Select one retained profile. Never combine medians or substitute all-day data for a missing hour. */
export function taxiSelection(
	taxi: IslandMobility['taxis'],
	corridor: string,
	hour: number | null
) {
	const overall =
		corridor === 'pickups'
			? taxi.pickup_summary
			: taxiChoices(taxi).find((row) => taxiCorridorId(row) === corridor);
	const profiles =
		corridor === 'pickups'
			? (taxi.pickup_hourly ?? [])
			: [...(taxi.outbound_hourly ?? []), ...(taxi.inbound_hourly ?? [])].filter(
					(row) => taxiCorridorId(row) === corridor
				);
	// Both lists include the same within-island rows; choose each clock hour once.
	const hourly = Array.from({ length: 24 }, (_, clockHour) =>
		profiles.find((row) => row.hour === clockHour)
	);
	return { overall, hourly, selected: hour === null ? overall : hourly[hour] };
}

/** Missing observation days stay unknown instead of becoming zero vessel activity. */
export function vesselCalendar(vessels: IslandMobility['vessels']) {
	const { from = '', through = '' } = vessels.period ?? {};
	if (![from, through].every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))) return [];
	const start = Date.parse(`${from}T00:00:00Z`);
	const end = Date.parse(`${through}T00:00:00Z`);
	const days = Math.round((end - start) / 86_400_000) + 1;
	if (!Number.isFinite(days) || days < 1 || days > 366) return [];
	return Array.from({ length: days }, (_, index) => {
		const date = new Date(start + index * 86_400_000).toISOString().slice(0, 10);
		return {
			date,
			tracked_devices: vessels.daily?.find((row) => row.date === date)?.tracked_devices ?? null
		};
	});
}
