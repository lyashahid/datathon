# Prediction and policy release

Implemented and checked on 11 October 2026. The forecast workflow now supports the shared map context with an explicit target month and a geography callback. Its current-month outlook is a nowcast from lagged actuals; future target months are labeled separately. Important results, source versions, operator review steps and their qualifications can be inspected in the application without downloading a report.

## What is delivered

- Three official monthly passenger-movement series, chronological model selection, six later evaluation targets, selectable nowcast/future targets, benchmark point estimates and checks, inspectable backtests and historical-error ranges.
- Deliberate immutable issue records with all series, benchmarks, cutoffs, source/transform/model versions and original workbook hashes. A real November issue is frozen; all prospective scores are pending. Later verified actual vintages can be scored and preserved separately without replacing an issued forecast or earlier score receipt.
- An operator-owned resource review can be prepared on screen, with an accountable reviewer, decision purpose, review date, under/over-planning consequences and outstanding evidence requests. Downloads are optional copies, not the primary workflow.
- A map-first home with linked Data and Forecasts, Decisions and Evidence pages. Map position and planning context persist across pages; analytical results link to their geography, road or residential area. Recorded and forecast lines, dated totals, visible weak-model and range-coverage messages, and inspectable calculations remain in the app.
- A source-backed data explorer with 77 analytical views across six subjects, exact values, provenance and CSV data. A visualization builder compares compatible datasets, retains missing values, indexes unlike temporal units, and saves selected datasets, comparison, chart type and user notes locally. Forecasts remains a separate view inside this data workspace; policy recommendations remain in Decisions.
- Healthcare access comparisons for current timing, a bounded timetable change and removal of an assumed road delay. Every comparison conserves the same resident allocation, service date, departure and journey target. Lost access and missing evidence remain explicit.
- Timetable and road implementation costs stay unestimated until reviewed. The detailed map, in-app brief and whole-proposal investment comparison cannot certify affordability from an engine zero that excludes implementation costs. Decisions isolates an option against the stated delay; the map compares all proposed changes against the unchanged network, with that distinction shown on screen.
- The example road is ranked by population depending on it in modeled healthcare bus journeys. It is not identified from observed road volume or detected congestion. The tested route is the affected direction with the largest normal modeled journey dependency, rather than the first route in the file.
- A real `shift-timetable` action preserves calendar, route geometry, stop order, trip identities, travel durations and dwell. It rejects invalid or midnight-crossing shifts, and works through saved-scenario import/export.
- Finite, user-initiated bus illustration on supplied route geometry, pause/scrub controls and reduced-motion stepping. Illustrated movement supplies no model training observations.
- A bounded real route-133 source pilot: ten snapshots, four reported vehicles, nine intervals with changing positions and 35 position changes. The collector stopped after ten minutes. Public outputs contain aggregate receipts; normalized positions stay in the ignored private research archive.
- Forecast reliability, full dated series, policy outcomes, decision ownership, assumptions and verified-source details are accessible in the app. Comparison and forecast briefs plus a JSON evidence download are secondary options.

## Statistical findings

The default target month is October 2026, a current-month nowcast. Last trusted ferry actual is June (four-month horizon); last trusted bus actual is May (five-month horizon). All six June bus categories repeat May exactly, so June is quarantined as ambiguous carry-forward. Endpoint definitions are unresolved and the ferry categories remain separate. These are movements, not unique people, route loads or neighborhood riders.

| Series                      | Earlier-selected model | Later evaluation error (WAPE) | Latest-month benchmark error | Historical range coverage |
| --------------------------- | ---------------------- | ----------------------------: | ---------------------------: | ------------------------: |
| Malé VM ferry endpoint      | Six-month mean         |                         4.82% |                        6.62% |                    2 of 6 |
| Villigili VM ferry endpoint | Six-month mean         |                         4.98% |                        6.60% |                    2 of 6 |
| Malé/Hulhumalé bus category | Same month last year   |                        12.33% |                        4.83% |                    3 of 6 |

Each row uses six later target months. Ferry targets are January–June 2026; bus targets are December 2025–May 2026. WAPE is the total absolute error divided by total actual movements; it is not a probability of being correct. The bus model loses to every displayed benchmark in the later checks. Its forecast remains explicitly experimental; selecting a replacement using those same outcomes would consume that evaluation set. Presentation uses stable source order, rather than selecting the headline from later evaluation results.

Target-specific performance must be read separately. For the frozen November future target, both ferries select a three-month mean and bus selects seasonal naive. All three selected methods lose to latest-month persistence: selected/persistence WAPE is 6.1710%/6.0754% for Malé ferry, 6.5250%/5.9700% for Villigili ferry and 12.3298%/9.5639% for bus. The UI flags these failures. No November actuals or prospective accuracy have been fabricated.

For the October target, the 10th–90th earlier-residual range covered only two later outcomes per ferry series and three for bus. For November, the corresponding counts are two for Malé, three for Villigili and four for bus, each out of six. The screen displays the selected target's track record next to its range. No 80% coverage, accuracy guarantee or calibrated confidence interval is claimed. Model selection uses earlier origins with three ferry/four bus intervening targets excluded so selection outcomes precede the first evaluation training cutoff. Historical publication delays and original publication vintages are not simulated. The previously explored history supports an exploratory revised-vintage evaluation, rather than an operational as-of or untouched prospective test.

Source workbooks, hashes, quarantines, exact capture chronology and independent numerical checks are in [prediction source receipt](prediction-source-receipt.md). The read-only `/api/prediction` serves the durable validated source and makes no upstream requests.

The [forecast issue workflow](forecast-issue-workflow.md) defines never-overwrite issuance, later-vintage score receipts, revision/publication limitations and operator review use. The issue ledger requires persistent writable storage and controlled production access; the current local prototype does not implement authenticated agency roles. The real issue `2026-10-11_2026-11_d014293a68acd75223ca1647` was frozen at `2026-10-11T13:26:04.695Z`; repeated issuance preserves that original record.

## Policy findings

Under the loaded 10 October partial timetable, 15:30 MVT departure, 30-minute healthcare target and five-minute assumed road delay:

- Roughly 228,763 modeled residents meet the target; 9,468 have missing evidence. The official projected population denominator is conserved, approximately 246,278.
- Relevant R8 departures five minutes earlier or later each lose access for approximately 2,587 modeled residents. Neither is selected. The unchanged timing has zero incremental cost/fleet change; implementation costs for actual changes remain unestablished.
- Removing the assumed delay saves about 0.383 minutes on average across matched computable journeys, weighted by modeled population. It changes neither the target-access count nor the unknown coverage. Some selected bus journeys save more than the system-wide mean.

These are conditional access outcomes, not proof of causal intervention benefit. They do not establish actual passengers, received care, appointment capacity, opening hours or a feasible return trip. Complete timetables, vehicle circulation, local implementation costs and destination service suitability are needed before an operational recommendation. The app retains current timing when the tested alternatives are worse, rather than forcing a preferred action.

## Evidence gates

The source pilot verifies changing positions, but the feed provides no established GPS measurement timestamp, trip/direction identifier or explicit redistribution licence. Ten minutes on one day cannot train and evaluate an arrival predictor. Short-horizon utilities reject sparse, stale, ambiguous-direction, duplicate, jumping and unsupported observations; they do not release a physical arrival forecast with unknown measurement latency. A later passage-time release requires reviewed directions, trustworthy label timing, adequate independent trips across days, chronological comparisons against persistence and tested uncertainty. The current public app therefore shows no trained congestion or arrival estimate.

The news/notice capability remains in the detailed workflow. Attributed candidates require checked location, time and extent before affecting a scenario; no notice automatically closes a road. More islands remain source coverage, not fabricated national routing.

## Verification

All 698 application tests pass across 73 files, including 29 new catalogue, chart and saved-story tests. Six Python publication-drift checks and public-baseline validation also pass in this redesign run. Type checking reports zero errors or warnings; formatting/lint and production build pass. Earlier source verification included four collector checks and reimporting four official workbooks in memory without changing the trusted source asset. Affordability regressions cover unpriced timetable changes and road events.

The analytical redesign replaces repeated cards with a forecast/reliability surface, selectable policy comparison and a source-list/detail inspector. Four new chart geometry tests cover calendar gaps, range bounds, insufficient history and mobile geometry; two new provenance tests prevent fabricated collection dates/licences and preserve anomalous worksheet labels. The source catalogue retains 251 records. Contextual source entry, optional road/area search, empty/pending states and explanatory comparison takeaways support inspection without adding dashboard clutter.

Manual browser checks cover desktop and mobile navigation, preserved map position, 15/30-minute policy tradeoffs, visible gains/harms/unknowns, explicit scenario application and undo, road focus, selectable forecast months and benchmark warnings, the frozen issue with pending scores, source inspection, and user-started service illustration with pause. At 320px, Forecasts, Decisions and Evidence have no page-level horizontal overflow. Earlier numerical checks remain recorded in the source receipt; this UI pass does not establish prediction accuracy or replace a policymaker study.

The redesign's rendered checks use the production preview as well as development views: calendar-spaced charts at 390px, fixed navigation during deep inspection, responsive comparison rows, the 15-minute option's 1,481 access gains and 6,079 longer journeys, unpriced implementation, reversible map handoff, source workflow filtering, zero-result and pagination states, and mobile source-inspector focus. The build still reports large map/application chunks; lower-end performance and the nontechnical policymaker study remain open.

The data workspace adds manual browser checks for subject filtering, expanded chart coverage, accent-insensitive island search, exact values/provenance, data-to-builder handover, incompatible comparisons, unlike-unit indexing, relationship and intensity charts, saved-story reopening and retained notes across sections. The route-by-hour grid makes partial schedule coverage visible without claiming observed traffic. Desktop and 320/390px layouts were inspected, including collapsed mobile builder settings and page overflow. Production checks distinguish new errors from earlier development logs.

The maintained `npm run test:browser` harness was updated for the map-first routes, data explorer/builder and independently calculated policy outcomes, but was not executed in this release pass. It requires Playwright; see the [setup instructions](../README.md#verification). Its temporary screenshots and numerical receipts go under ignored `artifacts/qa/` and can be deleted after review.

```sh
npm run check
npm run lint
npm test
npm run test:prediction
npm run test:prediction:sources
npm run data:validate
npm run build
```

Production preview runs locally with `npm run preview -- --host 127.0.0.1 --port 5180`. Build completion does not configure a hosted deployment adapter. Source capture is bounded and no persistent polling or scheduled automation was installed.
