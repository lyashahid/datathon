// One catalogue for the default journey and the separately runnable regressions.
// Keep suites sequential: parallel maps compete for Chromium/GPU and planning caches.
export const browserSuites = [
	{
		id: 'analytics',
		file: 'verify-analytics-redesign.mjs',
		core: true,
		covers: 'Charts, scopes, exports and responsive analytics'
	},
	{
		id: 'decisions',
		file: 'verify-analytics-decision-flow.mjs',
		covers: 'Source-backed priorities, refresh and map handoffs'
	},
	{
		id: 'forecasts',
		file: 'verify-forecast-data-browser.mjs',
		covers: 'Forecast/backtest receipts, Data Studio and import validation'
	},
	{
		id: 'capital',
		file: 'verify-capital-map-start.mjs',
		covers: 'Analytics entry, capital camera and history'
	},
	{
		id: 'navigation',
		file: 'verify-restored-navigation.mjs',
		core: true,
		covers: 'Navigation, old links, country drill-down and zoom selection'
	},
	{
		id: 'nearby-stops',
		file: 'verify-nearby-bus-stops.mjs',
		covers: 'Malé stops remain visible when another island is selected'
	},
	{
		id: 'nearby-access',
		file: 'verify-nearby-access-analysis.mjs',
		covers: 'Nearby island access, delayed evidence and correct source scope'
	},
	{
		id: 'map-controls',
		file: 'verify-map-floating-controls.mjs',
		covers: 'Search dropdown, controls and responsive placement'
	},
	{
		id: 'proposal-experience',
		file: 'verify-proposal-experience.mjs',
		core: true,
		covers: 'Budgets, placement, drag, undo and bus/ferry editors'
	},
	{
		id: 'map-comparison',
		file: 'verify-proposal-map-comparison.mjs',
		covers: 'Actual local impact, cached comparisons and rendered colours'
	},
	{
		id: 'motion',
		file: 'verify-motion-windows.mjs',
		covers: 'Navigation motion, resizing, persistence and reduced motion'
	},
	{
		id: 'review-window',
		file: 'verify-review-window.mjs',
		covers: 'Read-only review, stale results, error/retry and focus'
	},
	{
		id: 'search',
		file: 'verify-scoped-map-search.mjs',
		core: true,
		covers: 'Island-scoped place search, English aliases, keyboard selection and provider recovery'
	},
	{
		id: 'directions',
		file: 'verify-search-directions.mjs',
		core: true,
		covers: 'Integrated multistop directions, travel modes, dated transfers and map endpoints'
	},
	{
		id: 'sea-network',
		file: 'verify-sea-network-map.mjs',
		core: true,
		covers: 'Sea and domestic air connections, route illustrations, source popups and layer caching'
	},
	{
		id: 'accessibility',
		file: 'verify-island-accessibility.mjs',
		covers: 'Island scores, reasons and missing census evidence'
	},
	{
		id: 'country',
		file: 'verify-country-map-journey.mjs',
		covers: 'Country/atoll scores, geographic bounds, history and optional overview'
	},
	{
		id: 'map',
		file: 'verify-map-context-browser.mjs',
		covers: 'Roads, census, layers and bounded viewport reuse'
	},
	{
		id: 'map-legibility',
		file: 'verify-map-legibility-browser.mjs',
		covers: 'Infrastructure, controlled live movement, grouped markers and closures'
	},
	{
		id: 'conditions',
		file: 'verify-map-first-conditions-browser.mjs',
		covers: 'Real weather/traffic providers and map endpoints'
	},
	{
		id: 'bus-vehicles',
		file: 'verify-bus-vehicle-map.mjs',
		covers: 'Road-aligned bus rendering, heading and selection'
	},
	{
		id: 'planning',
		file: 'verify-planning-browser.mjs',
		covers: 'Advanced itineraries, facilities, service drafts and notices'
	},
	{
		id: 'delivery',
		file: 'verify-delivery-browser.mjs',
		covers: 'Energy, fleet bounds and retained resource drafts'
	},
	{
		id: 'timetables',
		file: 'verify-timetable-import-browser.mjs',
		covers: 'Isolated import acceptance, timetable versions and retained drafts'
	},
	{
		id: 'map-transport',
		file: 'verify-map-transport-planning.mjs',
		covers: 'Bus connection targets, accepted paths and package undo'
	},
	{
		id: 'map-audit',
		file: 'verify-map-audit.mjs',
		covers: 'Damaged drafts, inactive Escape and first-render cluster icons'
	},
	{
		id: 'resilience',
		file: 'verify-secondary-audit-browser.mjs',
		covers: 'Slow/failed responses, chart sharing and deferred notices'
	},
	{
		id: 'overlays',
		file: 'verify-map-heat-opacity.mjs',
		covers: 'Shared hex IDs, keyboard opacity, persistence and no recalculation'
	},
	{
		id: 'transport-impact',
		file: 'verify-transport-service-impact.mjs',
		covers: 'Bus waits and dated departures independent of walking access'
	},
	{
		id: 'policy-api',
		file: 'verify-policy-api.mjs',
		api: true,
		covers: 'Real backend API integration contracts'
	}
];

/** @param {string[]} ids */
export function selectBrowserSuites(ids = []) {
	if (ids.length === 0) return browserSuites.filter((suite) => suite.core);
	if (ids.includes('--all')) {
		if (ids.length !== 1) throw new Error('Use --all on its own, or provide individual suite IDs.');
		return browserSuites.filter((suite) => !suite.api);
	}
	const selected = ids.map((id) => {
		const suite = browserSuites.find((candidate) => candidate.id === id);
		if (!suite) throw new Error(`Unknown browser suite: ${id}. Use --list to see available IDs.`);
		return suite;
	});
	return [...new Set(selected)];
}
