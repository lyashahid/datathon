# Principal engineer review (pre-datathon)

Scope: architecture, scenario integrity, analytical correctness, explainability, GIS assumptions,
performance, data replacement readiness, demo reliability, deployment, security/privacy.
Healthy code was not refactored for style.

**Verdict.** The architecture is sound for a datathon: pure analysis modules, an immutable
baseline with derived scenario state, adapters at every data boundary, and broad tests (210).
No demo-breaking defect was found in code. The main risks are operational (live browser
verification, deployment target) and presentational (one metric whose name overstates what it
counts).

## Findings

### P0 — demo-breaking

| #   | Area             | File                     | Issue                                                                                              | Consequence                                                                       | Recommendation                                                              | Status                       |
| --- | ---------------- | ------------------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------- |
| 0.1 | Demo reliability | `src/lib/demo/`, browser | Demo Mode is verified headlessly (`demo.spec.ts`) but has not yet been run end to end in a browser | A layout or timing issue (e.g. a control not rendered in time) would surface live | Rehearse the full demo in the target browser at the presentation resolution | **Open: rehearsal required** |

### P1 — important before the competition

| #   | Area             | File                                          | Issue                                                                                                    | Consequence                                                                     | Recommendation                                             | Status                                                  |
| --- | ---------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------- |
| 1.1 | Security         | `src/lib/server/weather/provider.ts`          | The weather cache only evicted failures; successful entries were never removed                           | Each distinct coordinate grows server memory forever on a public deployment     | Prune expired entries and cap the cache size               | **Fixed** (cap 256, expired pruned)                     |
| 1.2 | Security         | `src/lib/server/weather/coordinates.ts`       | Weather endpoints accepted any coordinate on Earth                                                       | The server becomes a free proxy to Open-Meteo and can burn its rate limit       | Accept only coordinates inside the app's map bounds        | **Fixed** (400 outside Maldives bounds)                 |
| 1.3 | Demo reliability | `src/lib/demo/script.ts`                      | Restart reset the scenario and disruption but not bus-stop priorities                                    | After someone tweaks the sliders, the next run shows a different candidate #1   | Restart resets priorities on the demo path to the defaults | **Fixed**                                               |
| 1.4 | Demo reliability | `src/lib/stores/demo.svelte.ts`               | Steps that click inspector controls assume the inspector is open                                         | If the presenter collapses it mid-demo, the next step reports a missing control | Open the inspector before each step                        | **Fixed**                                               |
| 1.5 | Explainability   | `config/infoViews.ts`, `ImpactPanel`, legends | "Underserved population" is a gap-weighted count (a resident at score 25 counts as 0.5), not a headcount | A judge may read it as "people without access"                                  | Relabel and define it precisely                            | **Deferred to the metric-definitions pass** (prompt 18) |

### P2 — nice to improve

| #   | Area                   | File                                         | Issue                                                                                                           | Consequence                                                      | Recommendation                                                        |
| --- | ---------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| 2.1 | Analytical consistency | `analysis/candidates.ts`                     | A candidate's estimated transport gain is computed under normal conditions even while a disruption is selected  | Under severe disruption, the gain ignores closed ferry terminals | Thread `AccessConditions` into `recommendBusStops`                    |
| 2.2 | Explainability         | `analysis/demoMetrics.ts` vs `h3DemoData.ts` | The facility inspector's coverage uses a uniform per-island density; the H3 grid uses its own demo distribution | Two demo population figures can disagree for the same area       | Derive facility coverage from the H3 cells                            |
| 2.3 | Scenario integrity     | `stores/scenario.svelte.ts`                  | Scenarios live in memory only                                                                                   | A page refresh loses scenarios (Demo Mode recreates its own)     | Persist scenarios through a repository like observations              |
| 2.4 | Deployment             | `vite.config.ts`                             | `adapter-auto` detects no target locally                                                                        | Fine for Vercel/Netlify or `npm run preview`; unclear elsewhere  | Pick the adapter for the chosen host and document it                  |
| 2.5 | Data readiness         | `analysis/ingestion/`                        | Processed demographics are validated but not mapped to H3 cells                                                 | Real population cannot drive scores yet                          | Areal-weighted allocation from areas to cells, with the official data |
| 2.6 | UX                     | `DemoGuide`                                  | Guide sits over the map's bottom-right at small widths                                                          | Can cover part of the map below 1280 px                          | Collapse it to a one-line bar on narrow screens                       |

### P3 — post-datathon

| #   | Area     | Issue                                                   | Recommendation                                                             |
| --- | -------- | ------------------------------------------------------- | -------------------------------------------------------------------------- |
| 3.1 | GIS      | Straight-line distance, no street network or timetables | Add network routing (e.g. OSRM/Valhalla offline extracts) once data allows |
| 3.2 | GIS      | Island assignment uses demo outlines                    | Import official island boundaries                                          |
| 3.3 | Feedback | Observations and feedback are per browser               | Server repository plus moderation and authentication                       |
| 3.4 | Weather  | Single provider                                         | Register an official Maldives Meteorological Service adapter               |

## Review notes by area

- **Architecture.** Feature modules with pure analysis, thin stores and map-layer components;
  MapLibre is confined to `src/lib/map/`. No business logic is duplicated across UI and analysis.
- **Scenario integrity.** Baseline frozen and never written; scenarios are change lists replayed
  by a pure engine; undo/redo are snapshots; tests cover every change kind and mutation safety.
- **Analytical correctness.** Deterministic, with property tests: scores bounded, proximity
  monotonic, disabling never helps, disruptions monotonic in severity.
- **Explainability.** Every score has a breakdown; candidates list criteria, penalties and
  trade-offs; disruption assumptions are listed verbatim. See 1.5 and 2.2.
- **GIS assumptions.** Documented in-app (`ACCESSIBILITY_DISCLAIMER`) and in docs.
- **Performance.** See `docs/performance.md`; all measured interactions under one frame of sync work.
- **Data replacement.** `BaselineSource`, ingestion adapters and `docs/data-model.md`.
- **Security/privacy.** No secrets required. Inputs to server routes are validated; weather is
  proxied server-side with caching. Observations stay in the user's browser.
