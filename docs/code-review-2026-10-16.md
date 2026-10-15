# Code review and cleanup — 16 October 2026

This pass traced the frontend entry routes, retained workspaces, map interactions, data exploration, API proxy/cache, planning calculations, background preparation and persisted source updates. Real-time collaboration remains excluded.

## Correctness and efficiency

- **Selected-day transport counts:** routing deliberately expands adjacent service days to finish overnight journeys. Daily transport counts, fleet costs and timetables now share a civil-day filter instead of counting the neighbouring day as additional departures. Connectivity uses the actual boarding stop's departure time, retains overnight carryover and excludes disabled stops.
- **Split operating hours:** changing a route's hours preserves existing gaps and individual frequencies. It no longer assigns the same overlapping interval to every service window. An edit wholly inside an existing service gap requires an explicit timetable.
- **Complete source files:** source reviews, accepted schedules and frozen forecast issues publish completed JSON atomically. Immutable issues cannot be overwritten; failed publication cleans temporary files. Shared forecast/data-update services initialize once, and forecast/analytics readers use the same dataset cache.
- **Retained views:** accepted source changes notify the API client and mounted views. Active evidence refreshes; inactive analytics refresh when reopened, preserving filters. The root map replaces scores, profile, geography and stops and discards stale route/comparison results while retaining the selected island, camera and proposal. Map proposal drafts keep accepted operations, budgets and undo history while reloading source evidence. Timetable changes abort pending schedule journeys and clear previously returned itineraries in retained views.
- **Request ownership:** ferry/bus previews cancel when settings change or another composer opens. Financial quote identity excludes access-only presentation settings, preventing repeated cost checks when the access goal changes. Traffic geometry clears whenever its A/B endpoints change, including while its inspector is closed.
- **Proposal validation:** moving a change still works at the 100-change limit. Empty budgets cannot generate suggestions. Road snapping checks the resulting island boundary. Bus availability respects calendar ranges, inclusions and exclusions.
- **Data Studio:** filters validate the selected field's type and operator; removing a comparison removes its hidden filter scope. Applied table columns remain attached to the records actually loaded, with pending-setting feedback and export guards. Empty column selections cannot request an accidental all-column response. Chart series use indexed lookup. Forecast file selection locks during staging/acceptance.
- **Entry links:** `/forecasts` opens Passenger outlook; `/decisions` opens the current map proposal composer. The proposal inspector now provides an explicit **Advanced service & fleet tools** link for the retained specialist journey, timetable, fleet and delivery tools.
- **Startup status:** background preparation reports a total derived from its actual jobs and updates progress as jobs finish.

## Reuse and removal

Eight component download implementations and the root JSON exports use the shared `src/lib/download.ts` helper. Financial request keys, road projection, daily trip filtering and atomic publication also use shared helpers with regression coverage.

Removed six unreferenced tooltip primitive files, unused transit catalogue types, an unused straight-line placement catchment helper, duplicate road-distance projection, obsolete cache state and duplicate file writers. The previous monolithic default browser harness and seven navigation-specific suites were superseded by maintained suites. Specialist planning, places, calibration, imports and source data remain because their callers and distinct capabilities were verified.

The default `npm run test:browser` now runs seven suites sequentially: analytics, forecasts/Data Studio, capital map entry, navigation, map controls, proposal experience and island connections. Specialist checks remain separately available. Earlier design documents are retained as historical records and point to current verification commands.

## Verification

Backend: **712 tests passed**, including regressions for civil-day/overnight departures, split hours, atomic publication, concurrent service reuse and background progress. Ruff and modified-file formatting passed.

Frontend: **187 unit tests** and **6 startup tests** passed. Svelte/TypeScript reported zero errors or warnings. Frontend formatting/ESLint and the optimized production build passed.

The production run passed all **83 checks across the seven default browser suites**, including desktop/mobile navigation, real forecasts and dataset exports, proposal gestures, budget gates, undo, impact comparisons and a substantive downloaded PDF. Specialist planning passed **8 checks**, including outward/return journeys, investment assumptions, paired services, persistence and repeated notice handoff without duplication or loss of the existing draft. The specialist delivery suite passed **5 checks** for source provenance, calibration, actual energy formulas, fleet constraints and responsive draft restoration. Direct API verification passed **10 checks** for forecasts, datasets, resident reconciliation, costs/emissions, outward/return journeys, timetables, source attribution and unavailable-scope behavior.

The final isolated timetable-import browser run passed **17 checks** against copied sources and a private FastAPI instance. Accepted source changes refresh the root map immediately, defer hidden analytics and specialist work until activation, preserve filters/chart settings/proposal changes/budgets/selected island, and update retained inter-island geometry and service evidence. A newer accepted timetable clears the displayed itinerary, retains both source versions and works at a 390px viewport. All four protected original source hashes and the main timetable store were unchanged. Local receipts are stored under `artifacts/qa`; they are generated evidence and are not required to clone and run.

Local production measurements used real APIs and software WebGL at 1440 × 1000. All six country/island/analytics cold-context and reload cases completed without browser errors. The repeated final sample reached ready state in 0.34–1.84 seconds; the first sample included a 4.91-second island reload with delayed conditional API responses. Initial-load timings varied and do not establish an overall speed improvement. The efficiency improvements verified directly are cancelled obsolete previews, reused financial quotes, and exactly one deferred specialist/analytics refresh after source acceptance. Both final samples and the earlier baseline remain under `artifacts/qa/site-performance`.

## Boundaries

This review does not expand the supplied geographic or timetable evidence. Provider outages, unknown populations, limited outer-island resident modeling and assumed service durations remain explicit. Browser measurements depend on the local machine and warm caches; they are not deployment latency guarantees.
