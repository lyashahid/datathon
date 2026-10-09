/**
 * Normalised weather and marine observations/forecasts, shared by server and client. Every
 * provider maps into these shapes, so the UI never depends on a specific upstream API.
 */

export interface DataSourceAttribution {
	providerId: string;
	name: string;
	url: string;
	/** 'forecast' for model output nearest "now"; 'observed' for station data. */
	kind: 'forecast' | 'observed';
}

export interface WeatherSnapshot {
	/** ISO 8601 UTC time the values are valid for. */
	timestamp: string;
	latitude: number;
	longitude: number;
	temperatureC: number | null;
	precipitationMm: number | null;
	windSpeedKph: number | null;
	windDirectionDeg: number | null;
	visibilityKm: number | null;
	/** WMO weather interpretation code, when the provider supplies one. */
	weatherCode: number | null;
	source: DataSourceAttribution;
}

export interface MarineSnapshot {
	timestamp: string;
	latitude: number;
	longitude: number;
	waveHeightM: number | null;
	waveDirectionDeg: number | null;
	wavePeriodSeconds: number | null;
	source: DataSourceAttribution;
}

export type SampleKind = 'weather' | 'marine';

/** One forecast sample at a requested grid point (null when the provider has no value there). */
export interface WeatherSample<T> {
	latitude: number;
	longitude: number;
	snapshot: T | null;
}

/** A coarse grid of samples covering the study area, matched to the forecast model resolution. */
export interface SampleGrid<T> {
	kind: SampleKind;
	spacingDeg: number;
	samples: readonly WeatherSample<T>[];
	source: DataSourceAttribution;
	/** Valid time of the samples (ISO UTC). */
	validAt: string | null;
}
