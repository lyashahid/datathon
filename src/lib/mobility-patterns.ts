/** Historical source profiles retain independent clocks and populations. */
export type TaxiProfile = {
	hour?: number;
	ride_count: number;
	median_minutes: number;
	p90_minutes: number;
	recorded_speed_kph: number;
};

export type AirportHour = {
	year: number;
	hour: number;
	event: string;
	region: string;
	passengers: number;
	movement_records: number;
};

/** Additive counts can be pooled; medians and percentiles cannot. */
export function airportHours(rows: AirportHour[], year: number, event: string) {
	const hours = Array.from({ length: 24 }, (_, hour) => ({
		hour,
		passengers: 0,
		movement_records: 0,
		observed: false
	}));
	for (const row of rows) {
		if (row.year !== year || row.event !== event || !hours[row.hour]) continue;
		hours[row.hour].observed = true;
		hours[row.hour].passengers += row.passengers;
		hours[row.hour].movement_records += row.movement_records;
	}
	return hours;
}

export function busiestHour(rows: { hour: number; value: number }[]) {
	return rows
		.filter((row) => row.value > 0)
		.reduce<{ hour: number; value: number } | null>(
			(best, row) => (!best || row.value > best.value ? row : best),
			null
		);
}
