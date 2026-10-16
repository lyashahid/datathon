# Frontend verification against the supplied Python backend

For the current application, commands and coverage, use the [current browser verification guide](browser-verification.md). This document preserves the initial migration's measured results.

This document records the initial backend migration verification, before the subsequent UI redesign. That Svelte application was exercised in Chromium against the actual imported FastAPI application, its supplied cache, and the optional public live providers. No response payloads were mocked or replaced in that migration run. The subsequent redesign added a delay-only geometry-request regression, described in [ui-ux-redesign.md](ui-ux-redesign.md). Backend unit/API verification and the old-to-new feature comparison are documented separately in [backend-verification.md](backend-verification.md) and [backend-feature-audit.md](backend-feature-audit.md).

Development verification passed 11 of 11 workflow groups. Production preview verification passed 12 of 12 groups on 14 October 2026, completing at 08:30:55 UTC, including the additional passenger-ferry restriction case, with zero browser runtime or console errors. Map hint/legend and attribution collision checks passed at both 768 px and 375 px.

## Reproduce

Follow the [current browser verification guide](browser-verification.md) for installation, production and preview commands, focused suites and their evidence boundaries. `npm run test:browser` now runs the current journey rather than the migration harness used below. Each maintained suite writes its own directory under `artifacts/qa`; the historical migration run remains under `artifacts/qa/backend-revamp`.

## Tested workflows

These results describe the initial migration interface. Later interfaces added national analytics, dedicated navigation, contextual proposal tabs, browser-history restoration and decision-brief exports; consult the current guide for maintained coverage.

| Workflow                          | Assertions against actual behavior                                                                                                                                                                                                                                        |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| National loading and Malé profile | 1,561 islands, 840 official facility records; selected island `island:1443`; visible accessibility profile; GeoJSON source loaded; bundled MapLibre worker available with HTTP 200.                                                                                       |
| Search and selection              | Empty search result; MLE atoll's three islands; exact Malé selection rather than the similarly named Hulhumalé.                                                                                                                                                           |
| Map layers and routing            | Facilities/transport toggle state; canvas clicks supply start/end coordinates; real shortest path returns 991.989 m, 26 graph nodes and 26 geometry coordinates; route line and endpoints drawn.                                                                          |
| Scenario editing and comparison   | Add a bus stop at the selected island centroid; undo/redo; simulation applies one operation and returns transport feature delta +1; saved empty reference comparison returns +1.                                                                                          |
| Scenario files and persistence    | Download and import the same scenario; reject incomplete JSON, string coordinates, null coordinate elements and an array operation type; keep the existing draft unchanged after each rejection; reload preserves the draft.                                              |
| Passenger ferry restriction       | The UI's passenger ferry choice submits the backend mode `marine`; actual simulation reports that restriction as applied.                                                                                                                                                 |
| Recommendations                   | Real pedestrian screening candidate; open it as an option; export and re-import the backend model, including nullable coordinates/target/distance/mode fields.                                                                                                            |
| Live movement                     | Five provider status rows; disabled RTL identified; opening the panel requests no positions; enabling performs one real snapshot request; pause returns to the disabled state; exactly one snapshot is requested during the check; deterministic data remains unaffected. |
| Evidence                          | The UI visibly states absent passenger forecasts, scheduled/return journeys, scenario accessibility recalculation, and unverified marine passenger edges.                                                                                                                 |
| Tablet and phone                  | All five tabs at 768 px and 375 px; island drawer opens, filters and closes on selection; document/body widths match the viewport; map stays inside its region; details, map hint and legend remain readable.                                                             |
| Browser errors                    | No browser runtime exceptions or console errors during the verified workflows.                                                                                                                                                                                            |

## Evidence and boundaries

The machine-readable latest report is `artifacts/qa/backend-revamp/browser-verification.json`. The development result is retained as `browser-verification-dev.json`. Screenshots include `desktop-explore.png`, `desktop-route.png`, `desktop-scenario.png`, `desktop-live.png`, `desktop-evidence.png`, and full-page Explore/Evidence views at 375 px and 768 px. They were visually inspected for rendered island geometry, facilities, route visibility, and responsive layout.

The production run on 14 October 2026 returned three aircraft observations from `adsb.lol`. Openwaters reported no current coverage, RTL was disabled, Followme had no selection, and Facha was not used. These are provider observations at test time, not guaranteed future coverage. The test accepts unavailable or empty optional providers when the actual API describes them honestly.

Malé has 24 official facility records and a baseline accessibility score of 68.6 with a 55% confidence indicator in this cache. This indicator is not a calibrated probability. Its census record is unavailable; the UI displays that absence explicitly. The simulation test confirms network/feature deltas only. It does not establish reduced journey times, improved population access, passenger demand, cost savings, timetable connectivity, or a safe engineering design. Those capabilities are absent from the supplied backend.

This earlier Vite preview emitted Node Gzip drain-listener warnings while streaming the approximately 38 MB GeoJSON response. All tested requests completed and the browser reported zero runtime/console errors. The subsequent [performance update](performance.md) configures SvelteKit's Node adapter, compact map payloads and streamed proxy compression; this historical receipt does not verify public deployment behavior.

The browser coverage is representative end-to-end verification of every workspace tab and its principal workflows in Chromium. It is not exhaustive verification of all 1,561 island records, every graph path, all combinations of interventions, other browser engines, or the reliability of external live services.
