import { WEATHER_PROVIDER } from '$app/env/private';
import { resolveProvider, withCache } from './provider.ts';

/** The cached provider used by the API routes; one instance per server process. */
export const weatherService = withCache(resolveProvider(WEATHER_PROVIDER));

export { coordinatesFrom } from './coordinates.ts';
