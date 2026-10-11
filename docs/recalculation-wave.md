# Recalculation wave and honeycomb display

People and Access use a permanent land-clipped honeycomb display. Population and access outcomes are aggregated by land overlap from the original modeled population origins; routing still uses those original origins. The localized wave is a processing illustration. It does not establish new access or represent the order in which residents' journeys are calculated.

## Why honeycomb for this interaction

[H3's aggregation guidance](https://h3geo.org/docs/highlights/aggregation/) describes hexagons' six equally spaced immediate neighbors and outward neighbor rings that approximate circles. Square grids introduce different cardinal and diagonal neighbor distances. This makes honeycomb a suitable display for the requested outward ripple. It does not make hexagonal population measurements more accurate than the source raster.

[H3 traversal documentation](https://h3geo.org/docs/api/traversal/) defines cells and their graph distances. The wave uses immediate-neighbor breadth-first traversal within the islands touched by the edit. `gridDisk` does not promise output order: drawing its returned array sequentially would not reliably form a wave. Disconnected land fragments belonging to the same selected island may share the illustration; unrelated islands remain unchanged. This visual propagation never establishes a bus, ferry, or walking connection across water.

## Preserve the underlying data

The current public baseline contains 667 population origins: 232 in Malé, 40 in Vilimalé, and 395 in Hulhumalé. Every origin has source-raster geometry clipped to land; none has an H3 identity. The preparation step in `scripts/public-data-prepare.py` weights coastal pixels by their land fraction and normalizes population to island projections.

Replacing each of those polygons with a resolution-10 hexagon centered on its origin would map them onto only 437 distinct cells. That would produce overlapping polygons and misleading population graphics. Instead, `honeycombGrid.ts` creates 704 separate display cells clipped to the authoritative shoreline and island footprint. `honeycombAreas.ts` intersects each source polygon with the same-island display cells and normalizes its overlap weights. Each origin's population is conserved. In the current snapshot, 566 honeycombs contain population and none needs point-based allocation. The 667 routing origins and their calculated results remain unchanged.

Each hexagon carries the population allocated to reachable, gained, lost, gap, and unknown outcomes. Cells containing more than one outcome use a separate mixed color and show the share within the access target when selected. Unavailable access stays identifiable. The example journey uses the largest contributing population origin; its centroid may fall outside the display cell, so it is an illustration rather than an exact route for every resident. Empty cells have no resident count or selectable journey. Legacy point-only inputs use an explicitly marked same-island allocation fallback; absent land geometry produces no display polygons.

H3 resolution 10 has an [average cell area of approximately 15,048 m²](https://h3geo.org/docs/core-library/restable/); actual area varies geographically. Shoreline cells are clipped and therefore smaller or irregular. The grid is a visual scale, not a claim of census precision.

[H3's polygon conversion](https://h3geo.org/docs/api/regions/) normally tests cell centers, so a returned hexagon can extend over water. The overlay uses overlap coverage followed by actual polygon intersection. [Polygon-clipping](https://github.com/mfogel/polygon-clipping), an MIT-licensed geometry library, preserves coastal fragments and internal holes as Polygon or MultiPolygon geometry. Missing authoritative land geometry yields an empty display grid, not invented coastal geometry. Islands without population origins are excluded from this processing overlay.

The helper caches geometry by immutable baseline identity. This is initialization work; edits reuse the geometry. Preparation timings are recorded below separately from browser rendering performance.

## Honest and accessible feedback

[Carbon's progress guidance](https://www.carbondesignsystem.com/building-blocks/core/components/progress-bar/guidelines) distinguishes determinate progress from an indeterminate indication that work is happening. The spatial wave is indeterminate feedback: neither a percentage nor a prediction of calculation time. Covering the display grid must not announce successful recalculation. Keep a pending state until the corresponding calculation request actually succeeds; errors and superseded requests must not reveal stale results as successful output.

Use a restrained light-to-deeper blue highlight independent of the access map's benefit/loss colors, followed by one smooth fade. This avoids implying that every highlighted cell gains access. Keep the camera and map geometry stationary. Avoid repeated flashes, opacity snapping, and continuous restarts during rapid edits.

[W3C animation guidance](https://www.w3.org/WAI/WCAG21/Understanding/animation-from-interactions.html) recommends honoring reduced-motion preferences. With `prefers-reduced-motion`, suppress spatial propagation and provide a quiet static processing indication that lasts until calculation completion. [W3C status-message guidance](https://www.w3.org/WAI/WCAG21/Understanding/status-messages.html) supports accessible waiting, completion, and failure announcements without moving focus. Announce meaningful state changes, not each frame or hexagon.

## Geometry verification

`honeycombGrid.spec.ts` checks grouped origin identities, unchanged population/routing inputs, unique cell IDs, shoreline and internal-water clipping, MultiPolygon fragments, empty results when authoritative land is absent, the cached geometry contract, and complete origin coverage in the current public snapshot. `honeycombAreas.spec.ts` checks overlap allocation, mixed and unknown outcomes, representative origins, cache reuse, and reconciliation to every public island total for both planning years. Wave timing, island scope, request matching, renderer lifecycle, and reduced motion are tested separately by their owning modules.

## Calculation lifecycle and observed preparation cost

`PlanningAtlas.svelte` compares committed action histories to locate edits, including Undo and Redo. Proposed stops, moved stops, service edits, and proposed healthcare/school facilities provide wave origins. An ordinary pointer preview or unchanged history does not start a new wave. If an assumption or preview supersedes a calculation already illustrated by a wave, the pending wave is attached to the new request ID so that an older result cannot release it.

The controller retains the last map snapshot while the worker recalculates. It checks the request ID and the exact action, assumption, draft, and live-preview inputs before accepting a response. Only that matching response sets completion. A matching successful fade releases the new map snapshot; an error retains the old map and displays a failure notice. Covering all display cells while the worker is pending leaves the highlight in place. The status distinguishes “Recalculating access…” from “Updating map…” after actual calculation success.

The configured spread is 1,100 ms, with a 320 ms cell deepening and a 300 ms final fade. A quick successful calculation therefore has a roughly 1.7-second visual reveal. A brighter mint/teal leading edge turns into a deeper blue trail without repeated flashing. A slower calculation retains its highlight until that calculation settles. Reduced motion uses static feedback and a shorter fade. These durations illustrate state change, not computational progress or travel time.

Every edit seed selects its nearest land cell's island. Added or removed facilities and local route edits therefore animate only their island. A moved stop or route spanning islands can select both affected islands. When island metadata is unavailable, only the seeded connected components animate. Rapid edits retain the ages of shared cells while dropping superseded islands from the new overlay.

A single local Node run on snapshot `greater-male-2026-10-10-9a4eeb83bc` measured the following. The first call is cold and later calls may benefit from JavaScript warm-up, so these are observations rather than comparable statistical benchmarks.

| Preparation step                        | Observed duration |
| --------------------------------------- | ----------------: |
| Land-clipped grid creation, 704 cells   |          281.3 ms |
| Cached grid lookup                      |         0.0023 ms |
| Wave ordering from one edited point     |           14.2 ms |
| Wave ordering from 20 route-stop points |            8.2 ms |

Those grid and wave-order timings were recorded for the earlier global overlay. The current local scope no longer retains all 704 cells for every edit. A separate local Node run of permanent population allocation measured 315 ms for cold geometry plus weights, and 0.33 ms for cached aggregation. These observations cover CPU preparation; they do not establish browser frame rate, GPU cost, or mobile performance. Visual feedback must never imply an unsupported transit benefit.

## GPU overlay implementation

`gpuWaveLayer.ts` uses a MapLibre custom WebGL layer. It triangulates the clipped land geometry once for each distinct wave-cell descriptor, preserves water holes and disconnected polygon fragments, and uploads static fill and edge buffers. Each vertex carries its cell's arrival time. The fragment shader derives the passing highlight from a shared clock, opacity, and reduced-motion flag; camera projection keeps the overlay attached to the map as it pans or tilts. A local Mercator anchor avoids the visible street-level drift that can result from absolute Float32 coordinates.

During the animation, only the uniform values and repaint request change. GeoJSON geometry and data-driven map-style expressions are not rebuilt each frame. This replaces an initial global-state expression approach whose per-frame data-driven tile reevaluation was an unsuitable rendering cost for this effect. The calculation lifecycle remains outside the renderer: the GPU can animate the illustration, but it cannot declare the model complete.

The custom layer sits below route layers, keeping route markings legible. Reduced-motion feedback uses a static tint rather than a propagating front. A wave superseded while fading eases back toward its pending opacity; committed edits continue prior arrival times so already highlighted cells do not abruptly clear. The geometry/order preparation measurements above do not verify the custom renderer's frame rate; browser profiling and device testing are separate checks.

## Browser verification

The permanent honeycomb revision was checked on the production preview at 1366 × 768 and 390 × 844. People and Access both showed hexagonal cells. Selecting a mixed cell displayed 545 modeled residents and 5% within the access target, with a separately labeled example journey. A local clinic edit and its Undo/Redo illustrated Hulhumalé only; Malé and Vilimalé retained their ordinary map colors throughout the captured frames. The brighter leading edge and deeper trail remained legible over the atlas. Mobile selection, collapsed/expanded details, and menu history controls worked; the document width stayed 390 px at the 390 px viewport. Undo restored the original saved proposal's 230,523 reached residents and cost/carbon estimates.

Current screenshots are `artifacts/qa/honeycomb-map-desktop.png`, `artifacts/qa/honeycomb-map-local-wave.png`, `artifacts/qa/honeycomb-map-mobile.png`, and `artifacts/qa/honeycomb-map-mobile-wave.png`. All 454 tests, Svelte checks, lint, and the production build passed. These visual checks confirm scope and appearance; they do not measure frame rate.

### Earlier renderer checks

The production preview was exercised at 1366 × 768 and 390 × 844. Proposed clinic and school placement, adding an unserved stop, committing a bus connection, and Undo each triggered recalculation feedback. The unserved stop did not increase access. Rapid Redo → Undo → Redo published the final matching clinic result; a subsequent Undo restored the original saved proposal. The GPU overlay remained aligned with the shoreline in perspective mode, and no recalculation-renderer warnings were captured.

Screenshots are saved in `artifacts/qa/recalculation-wave-honeycomb.png`, `artifacts/qa/recalculation-wave-mobile.png`, and `artifacts/qa/recalculation-wave-perspective.png`. These visual checks confirm layout, alignment, and feedback states; they do not establish a measured frame-rate guarantee.
