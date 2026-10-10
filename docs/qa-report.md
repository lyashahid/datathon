# QA report

Date: 2026-10-10 · Scope: correctness and reliability, no new features.

## Validation

| Check                                     | Result                      |
| ----------------------------------------- | --------------------------- |
| `npm run check` (svelte-check, strict TS) | 0 errors, 0 warnings        |
| `npm run lint` (Prettier + ESLint)        | clean                       |
| `npm test` (Vitest)                       | 24 files, 210 tests passing |
| `npm run build`                           | succeeds                    |

## Coverage by area

| Area                                                   | Covered by                                            | Notes                                                                                                           |
| ------------------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Scenario engine: add, move, disable, undo, redo, reset | `scenarioEngine.spec`, `scenario.spec`, `modify.spec` | Baseline is never mutated; stored changes are frozen; reset is undoable                                         |
| Closer infrastructure improves score                   | `accessibility.properties.spec`                       | Every bus stop moved halfway to its farthest same-island cell; also `proximityScore` monotonic for every target |
| Disabling cannot improve a metric                      | `accessibility.properties.spec`                       | **Every** facility disabled in turn; no cell's transport/health/education/overall score rises                   |
| Baseline remains constant                              | `accessibility.properties.spec`, `scenario.spec`      | Inputs unmutated; rebuilt baseline grid identical                                                               |
| Scores in range                                        | `accessibility.properties.spec`, `h3.spec`            | 0–100 under every disruption; underserved ≤ population                                                          |
| Candidate ranking                                      | `candidates.spec`                                     | Deterministic order, penalties, weight changes re-rank as expected                                              |
| Weather                                                | `weather.spec`                                        | Network/HTTP/bad JSON → typed error; missing fields → nulls; failures not cached                                |
| Disruption presets                                     | `disruption.spec`                                     | Deterministic; monotonic severity; normal = default model                                                       |
| Map: selection consistency                             | `selection.spec`                                      | Selection logic extracted from `AppShell` into `reconcileSelection` and tested                                  |
| Map: info view → legend/layer                          | `infoViews.spec`                                      | Unique ids, ascending stops, valid metric sources, ordered categories                                           |
| Demo script                                            | `demo.spec`                                           | All 13 steps on real stores; repeatable                                                                         |
| Ingestion                                              | `ingestion.spec`                                      | Reports, CRS, dedupe, decoder round trip, committed output up to date                                           |

## Fixed in this pass

- `ObservationForm`: a repository failure left the form stuck in "saving"; now reports an error.
- Duplicate logic consolidated: shortcut-modifier label (`utils/dom.ts`), Maldives time formatting
  (`formatMvtTime`), cell selection (`UiState.selectCell`), stale-selection rules (`stores/selection.ts`).
- `classifySeaState` was tested but unused; the HUD wave readout now shows the sea state.
- Removed unused `ScenarioChangeKind` type; removed a non-functional Settings button (UX pass).

## Inspections

| Check                | Finding                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Unused code          | Only intentional: `createServerObservationRepository` (documented future adapter), `wgs84ToUtm43` (fixtures and tests)   |
| TODO / FIXME         | None                                                                                                                     |
| Leaked secrets       | None; no keys are needed (Open-Meteo, OpenFreeMap and CARTO are keyless)                                                 |
| Hard-coded localhost | None                                                                                                                     |
| Console output       | No `console.log` in app code; one `console.warn` for recoverable tile errors; the ingest CLI prints its report by design |
| Unhandled promises   | Fire-and-forget calls (`weather.refresh`, `loadSamples`, `feedback.load`) all catch internally                           |

## Known limitations (not defects)

- Accessibility is straight-line proximity, not routed travel time; the UI says so wherever scores appear.
- Demographics are demo data; processed demographic records are not yet mapped onto the H3 grid.
- Official Datathon dataset not yet available; integration is blocked.
- Live browser checks of Demo Mode and the UX pass at several desktop sizes were pending at the
  time of writing (the preview pane was unavailable); the demo script is verified headlessly.
