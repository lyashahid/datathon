# Performance notes

Measured on the Greater Malé demo dataset (529 H3 cells, 26 facilities, 6 routes) in the
dev build (Chrome-based browser pane, 1440×900). Analysis timings come from a Node timing
harness; interaction timings from the browser, counting the synchronous work after an
action (click → next macrotask) and the messages posted to MapLibre's worker (each
`GeoJSONSource.setData` re-parses and re-tiles in the worker).

## Analysis costs (Node, per call)

| Operation                                     | Time         |
| --------------------------------------------- | ------------ |
| `buildAccessibilityGrid` (normal / severe)    | 1.0 / 0.4 ms |
| `compareGrids`                                | 0.2 ms       |
| `recommendBusStops` (one search)              | 0.7 ms       |
| `assessCriticality` (23 single-closure grids) | 25 ms        |
| `cellToBoundary` × 529                        | 0.4 ms       |
| `createDemoBaseCells` (once per page)         | 2.6 ms       |
| `deriveEffectiveState`                        | < 0.01 ms    |

The analysis itself is cheap. Criticality is the only sweep above a frame budget, and it is
a lazy `$derived`: it runs only while the facility inspector or the Closure Exposure view
reads it. No caching layer, worker or backend queue is warranted at this scale.

## What was optimised

| Change                                                                              | Where                                                               | Why                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Effective world derived from the change list's identity                             | `stores/scenario.svelte.ts`                                         | Renaming a scenario or changing analysis settings (priority sliders, disruption) replaced the scenario object, which rebuilt the effective world and cascaded into new infrastructure arrays, every map source upload and a grid rebuild. Settings that legitimately affect analysis (disruption, weights) still update their own consumers. |
| H3 data uploaded only while a view is visible, and only when grid or values changed | `map/layers/H3Layers.svelte`                                        | Scenario edits uploaded 529 polygons to the worker even with no info view showing.                                                                                                                                                                                                                                                           |
| H3 cell boundaries cached                                                           | `map/layers/h3Layers.ts`                                            | Boundaries never change; they were recomputed on every upload.                                                                                                                                                                                                                                                                               |
| Routes uploaded separately, skipped when their items are unchanged                  | `map/layers/InfrastructureLayers.svelte`, `infrastructureLayers.ts` | Facility edits re-uploaded all routes. The scenario engine reuses untouched (frozen) objects, so an item-identity check is exact (covered by a test).                                                                                                                                                                                        |

## Before / after (browser)

| Interaction (active scenario)     | Worker messages | Sync work, median (max)           |
| --------------------------------- | --------------- | --------------------------------- |
| Switch planning disruption        | 27 → **0.8**    | 11.1 ms (18.3) → **6.3 ms (9.7)** |
| Undo/redo, Transport view showing | 33 → **26**     | 5.3 ms (11.3) → **5.1 ms (6.7)**  |
| Undo/redo, no info view           | ~33 → **19**    | → **3.9 ms (5.6)**                |

The "no info view" before-figure is inferred: H3 uploads previously ran regardless of
visibility, so it took the same path as the row above it. All interactions measured stay
well within one 60 Hz frame of synchronous work.

## Checked and left alone

- **Candidate ranking.** A full search is 0.7 ms, so re-ranking on every slider step is
  immediate; caching would add invalidation risk for no visible gain.
- **Info view switching.** Switching between grid views only swaps a paint expression;
  data is re-uploaded only for views with external values (impact, exposure).
- **Inspector.** Reads lazy deriveds; criticality (25 ms) recomputes only after a scenario
  edit while a facility is open.
- **Weather.** Live readout refreshes every 10 minutes; forecast grids load once per view
  and are cached server-side.
