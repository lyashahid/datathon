# Code review and cleanup — 16 October 2026

The latest results are in [Follow-up: code and test review](#follow-up-code-and-test-review). Earlier sections preserve the preceding pass and its measured receipts.

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

The maintained `npm run test:browser` now runs the 13 core suites sequentially, with specialist checks separately selectable. Use the [current browser verification guide](browser-verification.md) and `npm run test:browser:list` for the catalogue. The measured seven-suite receipt below records the earlier cleanup pass; earlier design documents likewise retain historical results.

## Verification

Backend: **712 tests passed**, including regressions for civil-day/overnight departures, split hours, atomic publication, concurrent service reuse and background progress. Ruff and modified-file formatting passed.

Frontend: **187 unit tests** and **6 startup tests** passed. Svelte/TypeScript reported zero errors or warnings. Frontend formatting/ESLint and the optimized production build passed.

The production run passed all **83 checks across the seven default browser suites**, including desktop/mobile navigation, real forecasts and dataset exports, proposal gestures, budget gates, undo, impact comparisons and a substantive downloaded PDF. Specialist planning passed **8 checks**, including outward/return journeys, investment assumptions, paired services, persistence and repeated notice handoff without duplication or loss of the existing draft. The specialist delivery suite passed **5 checks** for source provenance, calibration, actual energy formulas, fleet constraints and responsive draft restoration. Direct API verification passed **10 checks** for forecasts, datasets, resident reconciliation, costs/emissions, outward/return journeys, timetables, source attribution and unavailable-scope behavior.

The final isolated timetable-import browser run passed **17 checks** against copied sources and a private FastAPI instance. Accepted source changes refresh the root map immediately, defer hidden analytics and specialist work until activation, preserve filters/chart settings/proposal changes/budgets/selected island, and update retained inter-island geometry and service evidence. A newer accepted timetable clears the displayed itinerary, retains both source versions and works at a 390px viewport. All four protected original source hashes and the main timetable store were unchanged. Local receipts are stored under `artifacts/qa`; they are generated evidence and are not required to clone and run.

Local production measurements used real APIs and software WebGL at 1440 × 1000. All six country/island/analytics cold-context and reload cases completed without browser errors. The repeated final sample reached ready state in 0.34–1.84 seconds; the first sample included a 4.91-second island reload with delayed conditional API responses. Initial-load timings varied and do not establish an overall speed improvement. The efficiency improvements verified directly are cancelled obsolete previews, reused financial quotes, and exactly one deferred specialist/analytics refresh after source acceptance. Both final samples and the earlier baseline remain under `artifacts/qa/site-performance`.

## Boundaries

This review does not expand the supplied geographic or timetable evidence. Provider outages, unknown populations, limited outer-island resident modeling and assumed service durations remain explicit. Browser measurements depend on the local machine and warm caches; they are not deployment latency guarantees.

## Follow-up: code and test review

The follow-up reviewed runtime consumers, immutable API snapshots, map callbacks, saved proposal validation, test assertions and the browser runner. The receipts above belong to the earlier pass; this section records the subsequent cleanup.

| Before                                                                                                  | After                                                                                                    | Why                                                                                                       |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| A snapped bus route could render while a separate, stricter endpoint check hid its boarding stops.      | Route lines and boarding/alighting markers share the accepted snap tolerance.                            | A valid itinerary now shows where to board and leave the bus; moved endpoints still reject stale results. |
| Invalid journey vertices were filtered out, joining the remaining points.                               | A broken leg is omitted from the line and playback.                                                      | The map cannot invent a connection across missing geometry.                                               |
| Separate cluster callbacks could reject without handling the error or pan after changing islands/tools. | One guarded callback handles both sources, retains their zoom limits and ignores obsolete results.       | Avoid unhandled errors and unexpected camera movement.                                                    |
| An accepted-marker animation could outlive its initiating effect.                                       | Pending ticks/frames are cancelled on cleanup.                                                           | Old proposal actions cannot animate or pan a newer context.                                               |
| On phones, a restored proposal summary covered the Layers/View controls.                                | Passive proposal summaries temporarily hide while explicit map controls are open and return when closed. | The heading, close button and opacity slider remain usable with pointer and keyboard input.               |
| Releasing a resized drawer restarted its entrance animation.                                            | Resize settles finite window motion before measurement and preserves its CSS animation identity.         | Resizing stays stable while opening, closing, saved sizes and reduced motion remain supported.            |
| Large, wholesale-replaced API snapshots used deep reactive proxies.                                     | Analytics and Data Studio use raw snapshots; mutable form state remains reactive.                        | Avoid proxy overhead while preserving source refreshes and derived views.                                 |

Removed two unused age-parsing helpers, an unused API alias, two test-only playback wrappers and a redundant Vela async-marking hook already covered by pytest's automatic async mode. Reused number/date formatters and validated saved proposal geometry once while retaining atomic route-package rejection and the operation limit. Retained reachable specialist workspaces and their distinct behavioral coverage.

The obsolete continuous-hex design harness was removed after mapping its useful assertions to maintained grid, aggregation, overlay and proposal tests. Playback tests now assert explicit walking/waiting/riding/arrival results instead of comparing a sampler with its own wrapper. Browser scripts share URL resolution, camera-aware gesture projection and one suite catalogue. Focused selection rejects typos before launching Chromium and deduplicates repeated suites; existing npm aliases remain compatible. Plain JavaScript regains undefined-name lint checks, while Svelte keeps the type information required by its recommended rules.

The current [browser verification guide](browser-verification.md) documents commands, focused coverage and provider/fixture boundaries. Historical design receipts remain labelled as historical evidence.

### Follow-up verification

- Backend: **777 tests passed** after removing the redundant async hook; Ruff passed. The only pytest warning was an upstream Starlette/httpx deprecation.
- Frontend: **280 tests across 25 files** and **9 startup/runner tests passed**. Svelte/TypeScript reported zero errors and warnings. Full formatting/ESLint passed with typed Svelte checks retained.
- The optimized production build passed. Its existing large-map-bundle advisory remains; this cleanup does not claim a measured overall latency improvement.
- The **13 core browser suites passed all 128 checks**, with no page errors, including budgets, actual proposal colours, mobile layouts, persisted window sizes, ferry benefits and PDF export.
- The specialist overlay suite passed **all 6 checks** on the rebuilt app: actual shared hex identities, before/after costs, persisted keyboard opacity, unchanged evidence/calculation requests and camera, plus phone Layers/View hit testing, summary restoration and focus. The corrected phone layout was also inspected visually.
- The specialist map-legibility suite passed **all 10 checks**, covering infrastructure provenance, qualified movement fixtures, pause behavior, street routing, closures, removal and unknown targets. Map controls passed **10 checks** and proposal experience passed **19 checks** again after the phone overlay correction.
- After the resize fix and final rebuild, motion/windows passed **11 checks** and proposal review passed **8 checks**, with no page errors. The resized drawer's immediate right edge stayed at 1440px rather than the previously observed 1458px; the settled phone sheet fit exactly within its 375px viewport. This run also covered saved sizes, cancellation, keyboard resizing, maximize/restore, reduced motion, focus, stale results and failed-evaluation recovery. Frontend tests, type checks and full lint passed again against the final source.
- Additional manual browser checks verified named-place directions in ordinary and reduced motion, and a real Malé–Hulhumalé R3/R4 itinerary: five route segments, four boarding/alighting markers and complete removal of both after reset.

Local receipts and screenshots remain under `artifacts/qa`; credentials, generated artifacts and source stores are excluded from the commit.
