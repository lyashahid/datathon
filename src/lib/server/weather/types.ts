/** Server-side weather types: the shared snapshot shapes plus the provider error. */
export type { DataSourceAttribution, MarineSnapshot, WeatherSnapshot } from '#lib/types/weather.ts';

/** Raised for any upstream failure; routes turn it into a non-fatal error response. */
export class WeatherProviderError extends Error {
	constructor(
		readonly providerId: string,
		message: string
	) {
		super(`${providerId}: ${message}`);
		this.name = 'WeatherProviderError';
	}
}
