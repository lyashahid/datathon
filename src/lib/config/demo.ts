import type { LngLat } from '#lib/types/map.ts';

/** Fixed narrative for the presentation; every number shown comes from the live simulator. */
export const DEMO_CONFIG = {
	title: 'Greater Malé Mobility Improvement',
	scenarioName: 'Greater Malé Mobility Improvement',
	/** Malé's eastern tip: demo residents furthest from a bus stop. */
	focus: [73.5212, 4.1733] as LngLat,
	focusZoom: 15.5,
	impactZoom: 14.6,
	/** How long a step waits for a control to appear before reporting it missing. */
	controlTimeoutMs: 1500
} as const;
