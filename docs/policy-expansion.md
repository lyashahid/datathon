# Policy workspace expansion

The subsequent [workspace refinement](workspace-refinement.md) updates navigation, prediction methods, map/census joins, source imports and delivery constraints. The sections below retain the original six-feature expansion context; current method and evidence details are in that refinement report.

The six requested feature groups now run through the project's FastAPI backend and the same-origin SvelteKit proxy. The supplied national backend remains the atlas and structural screening model; the preserved public-data artifacts support the detailed passenger, resident and timetable models. Vela runs within the same application, with its original functionality, tests, calibration and license attribution retained.

## Where to use the features

| Requested capability                                    | Workspace                                                          | What is implemented                                                                                                                                                                                                                                                            |
| ------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Passenger forecasts and backtests                       | Overview → Passenger outlook                                       | Actual monthly histories, nine forecast baselines/statistical methods plus a selection-weighted ensemble, expanding-origin model selection, separate later evaluation, horizon-specific error metrics, empirical ranges, and immutable forecast issues for subsequent scoring. |
| Bus/ferry journeys, returns, timetables and fleet       | Proposals → Resident access & services                             | Dated departure/arrival routing, walking and transfer constraints, appointment duration and return deadline, service and stop interventions, outward/return service design, terminal-aware duties, layovers, reserves and propulsion-specific fleet procurement.               |
| Resident travel-time bands and gained/lost access       | Proposals → Resident access & services                             | Population-weighted baseline/scenario comparisons, travel bands, gained/lost/unavailable residents, origin-level results, journey geometry, healthcare/education goals and CSV export.                                                                                         |
| Hospital/school proposals, costs, budgets and emissions | Proposals → Resident access & services                             | Facility location/opening date, recalculated access, editable cost assumptions, capital/annual budgets, separate fleet/facility operating and construction emissions, explicit displaced passenger-km assumptions and sensitivity displays.                                    |
| Live weather/traffic, notices, dataset exploration      | Live movement → Weather, traffic & notices; Overview → Data studio | Weather and sea model forecasts, actual provider traffic fields, durable notice intake/review with target and validity mapping, 38 inspectable source collections, typed filters, records, chart aggregation, compatible comparisons and saved/exportable stories.             |
| All Vela functionality                                  | Planning map → Places & directions                                 | Search/suggestions, cached identity/details, photos, native and browser reviews, walking/driving/bicycling requests, waypoints and avoidance options, route geometry/steps, traffic fields, Street View metadata/navigation/tile images and proxied documentation.             |

The structural map proposal editor remains available under **Map interventions**. It uses the supplied national model. Detailed resident and schedule calculations use the separate, explicitly scoped planning model; a national score is not presented as a resident travel-time estimate.

## User journey and UI decisions

The application retains the shared shadcn-svelte components, lavender analytical canvas, white cards, green/purple charts and aqua map established in the reference-based redesign. New tools are grouped by the decision the user is making, without expanding the global navigation into an endpoint list.

| Before                                                             | After                                                                                         | Why                                                                               |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Passenger and public-data capabilities absent from the new backend | Passenger outlook and Data studio sit within Overview                                         | Begin with demand and evidence before selecting an intervention.                  |
| A selected national island had no resident/time-of-day assessment  | The map opens resident access in the same island context, with explicit Greater Malé coverage | Keep geographic identity consistent while explaining the different model's scope. |
| Timetable and facility edits were difficult to relate to access    | One scoped policy draft feeds access, journeys, timetables and delivery costs                 | Compare the same proposal and assumptions throughout the decision.                |
| Operating conditions were separated from proposed disruptions      | Review a notice, map a known affected asset, set its validity and add it to a proposal        | Preserve a source-backed chain from evidence to a modeled change.                 |
| Endpoint output was the main way to use Vela                       | Dedicated Places, Directions and Street View tools                                            | Let users inspect identities and route evidence through ordinary controls.        |
| Edits could leave an old result looking current                    | Applied-input signatures, stale-result guards, scope refresh and draft persistence            | Prevent an export or metric from being attributed to changed inputs.              |

Drafts and data stories are saved in the current browser and can be exported/imported as JSON. This does not create a shared organization-wide project database. Forecast issues and reviewed notices are persisted by the backend. The existing map proposal draft and the new detailed service draft have distinct schemas and visible scopes.

## Data and modeling boundaries

### Passenger evidence

The three actual source series are `ferry-male-vm`, `ferry-villigili-vm` and `bus-male-hulhumale`, with 161 monthly observations in total. Ferry histories end in June 2026; the trusted bus history ends in May 2026. These are published endpoint categories/aggregates, not invented route, stop or hourly demand. The retained source links, dates, hashes and qualifications are inspectable.

Model selection uses earlier observable targets and evaluates the chosen model on six later expanding origins. The training cutoff includes that month's actual, so `selection.lastTargetMonth <= selection.firstEvaluationTrainingCutoff` is the correct boundary. Longer horizons embargo unavailable selection targets. Tests change held-out actuals to confirm selection does not change. Historical publication vintages are unavailable, so backtests are explicitly described as exploratory revised-vintage evaluations.

The current method compares nine fixed statistical/baseline candidates and a selection-weighted ensemble. See the [prediction analysis](data-analysis-and-prediction.md) for independent calibration partitions and measured results. MAE, RMSE, WAPE, bias and skill against baselines are shown. Negative skill and poor empirical interval coverage remain visible. Residual ranges and cost sensitivity are not guarantees or calibrated confidence intervals. Immutable issues capture the forecast, source/model receipts and issuing time; future scoring waits for eligible actuals.

### Resident and service evidence

The detailed snapshot contains 667 weighted resident origins, 45 audited destinations, 99 RTL stops, 4,359 graph nodes and 5,743 graph edges. A verified bridge connects the planning IDs for Malé, Hulhumalé, Hulhulé and Vilimalé to the national atlas. Resident weights cover three of these islands. They are WorldPop spatial estimates normalized to official island projections, not block-level census counts or measured travel demand. The 2030 option retains the 2026 spatial weights.

The reference service day is **10 October 2026**, with 11 captured RTL patterns and four published ferry calendars. Published departures without verified arrivals require an explicit crossing-time assumption; the API does not manufacture a runtime from a frequency. Walking access, directed paths, boarding buffers, transfers, service windows and appointment returns are recalculated. Missing graph/destination/population coverage stays unavailable. Outside this snapshot, detailed resident results are `outside_snapshot` with null totals.

Return journeys reapply calendars and reviewed notice validity at their actual return departure, including across midnight. A disruption that changes during an individual leg is not dynamically simulated. Timetables and fleet calculations include departures scheduled after midnight on the previous service day; activity accounting does not split vehicle-km from a prior-day duty still in progress across the civil-day boundary.

Full-day timetable, fleet and economic illustrations use the scenario overlay sampled at the selected departure time. A reviewed service suspension active at that time suppresses its daily pattern in that illustration; the calculation does not dispatch each daily trip against changing notice validity. This distinction is displayed in Delivery and does not change the separately timed outward/return routing.

Fleet duties join only compatible vehicle types at colocated terminals, with explicit layovers and reserve share. Unbalanced terminal duties require a return/deadhead plan. Diesel-to-electric conversion budgets new procurement and charging assumptions without assuming sale proceeds from retired vehicles. Annual costs and emissions repeat the selected service day's activity for the chosen operating-day count; this is an explicit extrapolation rather than observed annual operation.

An island filter selects the resident beneficiary cohort; fleet/economic baselines retain the connected Greater Malé network. The simple new-bus-service form assumes electric propulsion, while the full service JSON/import workflow can specify diesel or electric. Declared fleet, depot, capacity, battery and overnight charging resources now have explicit feasibility screens; crew rosters, maintenance and optimized dispatch still require an operator plan. See [delivery calibration](delivery-calibration.md).

### Costs, emissions and operating conditions

MVR cost factors are editable planning illustrations. Default examples include MVR 120 million hospital capital, MVR 25 million school capital, MVR 20 million/MVR 5 million annual facility operation, and separate bus/ferry/stop/charging assumptions. Land, capacity, staffing, procurement quotations and facility lifecycle evidence require local inputs. Cost sensitivity is explicitly illustrative (−30%/+40%). Accessibility gains do not by themselves establish ridership, mode shift or avoided emissions.

New hospital/school proposals accept explicit annual operating and construction kg CO₂e assumptions. A blank facility factor remains unknown and makes the corresponding total project emission estimate unavailable; it does not imply zero. Fleet operating emissions remain separately inspectable. Construction carbon is reported separately from annual operation.

Open-Meteo weather/sea responses retain their grid location, forecast timestamp, retrieval time, attribution and original nulls. A ten-minute bounded cache exposes stale last-good data after an upstream failure. Consumer traffic is requested through Vela's authenticated/rate-limited directions boundary; missing traffic fields stay null instead of being replaced by typical duration. This is route-level provider evidence, not a national observed traffic feed.

Notice intake supports reviewed text or bounded HTTPS retrieval from the configured public-source allowlist. Intake creates a candidate with supporting text and a checksum. Approval requires a known graph/service/facility target and an ordered, timezone-aware validity window. A reviewed operation only affects scenario times inside that window. Notices do not automatically close roads or overwrite the preserved planning baseline. The historical operations bundle is labeled as dated public evidence.

Vela is preserved under `backend/vendor/vela_api`. It was already FastAPI; it is mounted at `/api/v1/places` with its lifecycle managed by the parent application. Binary image responses, request IDs, private cache headers, API-key handling and rate-limit responses survive the frontend proxy. Chromium enables the original browser review collector. Live verification returned real Malé photos, reviews, walking/driving geometry and traffic. Malé bicycling returned an explicit provider/parser error, and local Street View had no coverage; available San Francisco imagery/tile delivery was also verified. Provider behavior can change, and errors remain visible.

## API and reproducible checks

Main endpoint groups are `/api/v1/forecasts`, `/datasets`, `/planning`, `/conditions`, `/operations` and `/places`. The frontend uses `/api/backend/*`; `MOBILITY_BACKEND_URL` and `VELA_API_KEY` stay server-side. Vela's full endpoint inventory and operational configuration are documented in `backend/vendor/vela_api/README.md`; detailed routing/economics contracts are in `backend/app/planning/README.md`.

With both services running, the real-response integration harnesses are:

```powershell
node scripts/verify-policy-api.mjs
$env:MOBILITY_QA_URL='http://127.0.0.1:5180'
node scripts/verify-browser.mjs
node scripts/verify-forecast-data-browser.mjs
node scripts/verify-planning-browser.mjs
node scripts/verify-places-browser.mjs
```

Use the URL of the production preview built with `npm run build`. Unit/type/style checks are `npm test`, `npm run test:backend`, `npm run check`, `npm run lint` and `npm run lint:backend`. Browser scripts assert real application responses and write machine-readable reports/screenshots under `artifacts/qa`; they do not replace backend calculations with mock results.

The policy API report is `artifacts/qa/policy-expansion/api-report.json`. The full Vela live-provider receipt is `backend/data/metadata/places-live-verification.json`. Final browser verification results and screenshots are recorded in the corresponding harness report directories.

Verification includes actual provider responses and explicit unsuccessful coverage cases. Real Malé listings delivered photos and settled reviews; walking/driving returned route geometry and traffic fields. Bicycling returned `parser_drift` for the sampled Malé route, and the local Street View sample had no panorama. A supported San Francisco reference returned panorama metadata and a JPEG tile. These cases retain their original status instead of being counted as available local coverage.

The notice browser test uses visibly labeled QA text, maps a known facility, checks the reviewed validity and source identity in the resulting proposal, removes the draft intervention, then dismisses the test notice. The baseline remains unchanged. Changing the selected island from Malé to Hithadhoo in Seenu refreshes weather/marine coordinates and receipts and clears the previous traffic result.

### Verified results — 14 October 2026

| Check                                                                      | Result               | Receipt                                                                           |
| -------------------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------- |
| Full FastAPI suite, including imported Vela and local Chromium fixtures    | 428 passed           | `npm run test:backend`                                                            |
| Frontend calculation/proxy unit tests                                      | 22 passed            | `npm test`                                                                        |
| Real API integration                                                       | 10 passed            | [API report](../artifacts/qa/policy-expansion/api-report.json)                    |
| National overview, map, structural proposals and navigation                | 17 passed            | [Core browser report](../artifacts/qa/ui-ux-redesign/browser-verification.json)   |
| Passenger outlook and data studio                                          | 10 passed            | [Forecast/data browser report](../artifacts/qa/forecast-data/report.json)         |
| Resident access, returns, proposals, services, drafts and reviewed notices | 8 passed             | [Planning browser report](../artifacts/qa/planning/report.json)                   |
| Places, directions, conditions, notice review and island refresh           | 9 passed             | [Places/operations browser report](../artifacts/qa/places-operations/report.json) |
| Svelte/TypeScript diagnostics                                              | 0 errors, 0 warnings | `npm run check`                                                                   |
| Formatting, frontend lint and backend Ruff                                 | Passed               | `npm run lint`, `npm run lint:backend`                                            |
| Production build                                                           | Passed               | `npm run build`                                                                   |

The 44 browser checks use real frontend/backend responses. Reports record no uncaught browser errors. Desktop and 375–390px mobile screenshots were inspected, including the wrapped policy navigation, return journey, facility investment, fleet delivery, dataset comparison and reviewed-notice handoff. Representative images are [passenger outlook](../artifacts/qa/forecast-data/forecast-desktop.png), [resident access](../artifacts/qa/planning/resident-access-desktop.png), [operating conditions](../artifacts/qa/places-operations/conditions-desktop.png) and [mobile notice handoff](../artifacts/qa/places-operations/notice-proposal-handoff-mobile.png).

The consolidated [final verification receipt](../artifacts/qa/policy-expansion/final-verification.json) records all counts, report timestamps and preserved source hashes. Six explicitly identified synthetic QA notices were archived to `artifacts/qa/policy-expansion/archived-qa-notices.json` after dismissal and removed from the working SQLite store; its notice list is empty and ready for genuine intake.

The backend run emits one upstream Starlette/httpx deprecation warning. The build retains Vite's large MapLibre-chunk warning; local preview works, and deploying requires a host-specific SvelteKit adapter plus FastAPI. Synthetic notices used for QA are dismissed and removed from the local working store after verification, with their test receipts retained. Genuine source evidence and user notices are preserved.

## Preservation and next evidence improvements

The original pre-revamp backup remains `D:\Projects\Personal\datathon-backup-20261014-124331`. A second source/data snapshot before this expansion is `D:\Projects\Personal\datathon-backup-before-policy-expansion-20261014`. Reinstallable dependency/build caches were excluded. The Downloads backend and original `D:\Projects\Personal\vela-rest-api` were copied rather than edited. The legacy application is preserved for recovery; its Svelte calculation engines do not execute in this implementation.

SHA-256 comparisons after implementation confirmed the preserved planning baseline, passenger source, service calendars and historical operations bundle still match the pre-expansion backup.

The strongest next improvements require new authoritative inputs: a nationwide stop/timetable feed with actual runtimes and disruptions; fresh passenger releases and historical publication vintages; audited facility capacity, wheelchair paths and small-area population evidence; local procurement/energy/occupancy/emissions factors; and an authenticated shared project/review database with a deployment target. Those inputs would strengthen the modeled comparisons and support team operations. No deployment, paid provider subscription or external message has been initiated.
