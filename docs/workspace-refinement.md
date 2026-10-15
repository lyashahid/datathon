# Evidence, prediction and the policy journey

The October 2026 refinement implements the requested source refresh, stronger passenger prediction, fleet/resource calibration and holistic map experience. Real-time collaboration is deliberately excluded following the user's instruction. The application remains a single-user policy workspace with local drafts and inspectable exports.

## Navigate by the decision

The global navigation contains **Analytics**, **Map & planning**, and **Evidence**. A single island scope carries through Explore, Proposals, Live, and Places & directions beneath Map & planning. Proposals opens resident access and service planning; its separate Infrastructure edits tab retains the national structural editor. Live opens weather, traffic and notice review; Vehicle movement remains an explicit enable/pause tool. Existing deep links, browser history, drafts and import/export workflows remain supported.

| Before                                                               | After                                                                              | Why                                                          |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Proposals and live movement duplicated the map's global navigation   | Four local map tools under one global workspace                                    | Preserve the selected place while changing the task          |
| A proposal opened the low-level map editor                           | Resident access and services is the default; infrastructure edits remain available | Begin with the policy question and beneficiary cohort        |
| Island outlines had little geographic context                        | Captured OSM streets, buildings, green spaces and named roads                      | Make sites, routes and neighborhoods legible                 |
| Same-named islands and Greater Malé appeared without resident counts | Administrative-atoll matching and disjoint census localities cover 190 islands     | Fix broken joins while preserving historical year and source |
| Forecast comparison and uncertainty used less-separated evidence     | Earlier selection, separate calibration and six later chronological checks         | Make model selection and measured uncertainty assessable     |
| Cost and fleet inputs lacked operating evidence                      | Selected cost receipts, energy formulas and resource screens travel with the draft | Relate affordability to practical service delivery           |

The map keeps the aqua/cream treatment and shared shadcn-svelte controls. Desktop and mobile checks cover nested tabs, island selection, browser history, geometry, layers, source records and horizontal containment. Streets are derived locally from the retained OSM extract, so they do not depend on an external tile API key. See [map context and population](map-context-and-population.md) for source hashes, coverage reconciliation and cache validation.

National census counts are 2022 observations. Detailed population-weighted travel-time scenarios continue to use the distinct, documented Greater Malé origin/graph snapshot; nationwide census coverage does not create nationwide resident travel-time coverage. National screening scores and island profiles now validate the same source and transformation receipts before using cached results.

## Prediction chosen from the available evidence

The reproducible audit covers all 38 app collections from 15 captured source artifacts. Only three compatible monthly passenger categories form usable demand histories: 161 observations, with ferry histories through June 2026 and trusted bus observations through May. Contemporary traffic, weather, buildings and census records are not silently joined to historical passenger outcomes.

Nine fixed statistical/baseline methods plus a selection-weighted ensemble compete independently at each one-to-twelve-month horizon. Fits see only their observed prefix. Earlier chronological origins select the policy; a separate embargoed calibration block produces empirical ranges when there is enough history; six later origins measure error and coverage. Complexity must improve earlier MAE by at least 5% versus the best simple baseline. Poor later results remain visible, and seven-to-twelve-month horizons currently have insufficient independent calibration history for a range.

This strengthens the method, without promising universal accuracy improvement. Historical workbooks were revised and already explored; the evaluation is not an untouched prospective experiment. Use frozen issues and later eligible publications to build a prospective record. The [analysis and method report](data-analysis-and-prediction.md), [executed notebook](../artifacts/analysis/2026-10-14/mobility-data-analysis.ipynb), [portable preview](../artifacts/analysis/2026-10-14/notebook-preview.html), and [JSON audit](../artifacts/analysis/2026-10-14/data-analysis.json) preserve results and source receipts.

## Refresh evidence before applying it

Evidence → Official source updates checks seven configured primary feeds: the MBS publication index, four retained MTCC ferry PDFs, and two RTL route feeds. The initial 14 October check returned HTTP 200 for all seven. The latest indexed monthly publication remains June 2026; all four PDFs matched their retained hashes. RTL route captures require interpretation/review and do not establish a complete dated national timetable.

Checks retain content-addressed raw bytes, retrieval times, hashes and failures. They do not replace a planning baseline. Passenger outlook → Data & method stages a complete passenger source contract, shows differences and requires explicit acceptance of revisions. Forecasts, analysis and Data Studio then use the accepted source while original files and frozen forecasts remain preserved. See [forecast source/version workflow](forecast-issue-workflow.md).

Map & planning → Explore → Nationwide schedules displays the four real published departure calendars. Imported operator JSON must provide known OneMap islands, weekdays, validity dates and either published arrivals or explicitly assumed runtimes. A source is staged before review/acceptance. Versions retain predecessors and replace matching service IDs only after acceptance. The earliest-arrival planner handles waiting, transfers, overnight arrival, calendar validity and Maldives time. Assumed crossing runtimes require opt-in. Departure-only columns are not interpreted as arrival pairs, and an absent verified itinerary is not evidence that no service operates.

Endpoints are `GET /api/v1/data-updates`, `POST /api/v1/data-updates/check`, `GET /api/v1/data-updates/schedules`, and POST timetable `stage`, `{sha256}/accept`, and `journey` beneath that schedule path. Stored payload hashes are verified before use. These imports add timetable connectivity; they do not create a door-to-door pedestrian graph or resident accessibility origins for outer islands.

## Calibrate delivery and test operating resources

The Delivery step stores source-linked factor records, units, geography, publication and validity dates, selected factors and manual overrides with the proposal. Complete energy inputs derive operating cost and emissions. The progressive STELCO billing calculator uses the extra consumption's actual tariff bands for a 30-day account. Historical CO₂ references are distinguished from current delivered-grid CO₂e, and unverified local quotations are not invented.

Fleet resource envelopes test the generated blocks against declared vehicles/reserve, peak onboard passengers, duty length, depot positioning, battery reserve, charger count and overnight windows. Missing inputs remain incomplete; failing constraints remain visible. These screens are necessary conditions, not optimized dispatch or a shared-depot charging schedule. Source selections can be unapplied while their register entries remain preserved. See [delivery calibration and limits](delivery-calibration.md).

## Verification and retained evidence

The unit/integration suites cover source chronology, independent calibration, missing data, immutable versions, revision acceptance, timetable validity, overnight journeys, transfer assumptions, integrity rejection, population joins, stale score artifacts, cost/energy units, progressive tariffs and resource failures. Browser flows use real FastAPI responses. Successful timetable import QA uses an isolated store; synthetic fixtures never enter the application's active sources.

The final production build, frontend/backend lint and type check passed (zero type errors or warnings). The frontend suite passed **43 tests**; the complete backend suite passed **510 tests**, with one upstream Starlette TestClient deprecation warning. The map-library bundle retains Vite's large-chunk advisory; local preview builds successfully.

| Workflow                                                       | Passed checks | Retained report                                                                          |
| -------------------------------------------------------------- | ------------: | ---------------------------------------------------------------------------------------- |
| Core analytics, map and proposal journey                       |            17 | [Browser verification](../artifacts/qa/ui-ux-redesign/browser-verification.json)         |
| Forecasts, analysis and Data Studio                            |            11 | [Forecast/data verification](../artifacts/qa/forecast-data/report.json)                  |
| Resident planning and return journeys                          |             8 | [Planning verification](../artifacts/qa/planning/report.json)                            |
| Places, directions, live conditions and notices                |             9 | [Places/operations verification](../artifacts/qa/places-operations/report.json)          |
| Streets, population and stationary request regression          |             9 | [Map verification](../artifacts/qa/map-context/report.json)                              |
| Nested navigation, source receipts and calendars               |             7 | [Workspace verification](../artifacts/qa/workspace-refinement/browser-verification.json) |
| Delivery calibration and resource constraints                  |             5 | [Delivery verification](../artifacts/qa/delivery/report.json)                            |
| Isolated timetable stage, review, acceptance and dated journey |             8 | [Timetable verification](../artifacts/qa/timetable-import/report.json)                   |
| Live policy API integration                                    |            10 | [API verification](../artifacts/qa/policy-expansion/api-report.json)                     |

The map and workspace browser suites were repeated against the final production preview. A stationary map now reuses its viewport context: 24 repeated requests before the fix, zero additional requests after settling or repeated island focus. All reports contain passed checks and no uncaught browser errors. The [final verification receipt](../artifacts/qa/workspace-refinement/final-verification.json) links the suite results and [complete backend log](../artifacts/qa/workspace-refinement/backend-tests.txt).

Two explicitly labelled QA notices were dismissed, archived with their complete bodies under QA artifacts and removed only by their exact IDs from the active evidence store. Successful timetable fixtures remain in their isolated store; see [timetable import verification](timetable-import-verification.md). The original supplied backend, Vela source, public evidence and backup remain preserved; only derived map/access artifacts and explicit runtime receipts are added or refreshed.
