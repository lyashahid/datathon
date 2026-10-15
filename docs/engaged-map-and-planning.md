# Map activity and planning experience

Implemented on 14 October 2026. Real-time collaboration remains excluded.

| Before | After | Why |
| --- | --- | --- |
| Small, similar dots for unrelated records | Distinct bus-stop, ferry-terminal, pier, airport, school and health symbols; numbered clusters at wider zoom | Users can identify a place before opening its source record. A terminal symbol is stationary infrastructure. |
| Explore required a separate movement workflow | Nearby provider observations load automatically for the selected island, with pause, refresh, counts and a fit-to-movement action | Marine traffic outside a street-level view becomes discoverable without losing the selected island. |
| No visible route until a calculation completed | Origin and destination pins appear immediately; calculated road geometry follows and is cleared after changing inputs | The map acknowledges a choice and distinguishes the input from the computed path. |
| Resident planning used forms and tables alone | A focused map remains beside the editable steps on desktop; mobile has a Show map shortcut | Locations, proposed facilities, service connectors and journey paths remain visible during planning. |
| Effects were difficult to locate | Connected hexagons show the calculated accessibility comparison, with distinct gain, improvement, loss, slower, unavailable and unchanged states | Users can inspect where an option helps, and distinguish missing evidence from measured harm. |
| Previous results could appear current after an edit | Edits mark results stale, grey the old impact and stop playback; a recalculation pulse runs during the actual request | The interface shows the state of the calculation without fabricating progress or imposing a delay. |
| Scheduled paths were static | Explicit timetable simulation with play/pause, scrub, outward/return selection and mode-specific movement | Users can inspect walking, waiting, transfers, travel and the return journey. |

## Position and animation contracts

Explore requests a bounding box approximately 18.5 km from the selected island centre (`radius_nm=10`). Scope changes cancel superseded requests and clear unrelated observations. Polling runs at least 60 seconds apart, stops when the workspace or document is hidden, and can be paused by the user. A transient request failure retains the last snapshot with its status. The Maldives bounds include Addu (`-1` to `8.5` degrees latitude).

Live vehicle symbols represent provider observations. Heading controls their orientation where supplied. Smooth movement interpolates between two newer observations for the same provider identity, with no extrapolation of future positions. Reduced-motion settings suppress these transitions. Stationary or unknown-speed observations remain honest; they are not forced to drive or fly.

On 15 October 2026, observed buses gained north-facing miniature vehicle bodies with wheels, side windows, windshields and roof details. The body grows with street zoom; stationary bus-stop symbols stay distinct. Observed vessels use filled hulls and decks. These generic illustrations do not certify an operator's livery or physical vehicle dimensions. Actual source coordinates, bearings, freshness and selection details remain unchanged. FollowMe classifies **MTCC Express 1 as a speedboat**, so it remains a vessel. The four bus observations inspected for this revision were ATS school buses reporting zero speed; their GPS positions lay approximately 0.9–11.5 metres from mapped roads, and no snapping or simulated driving was added.

On compact maps, selecting a source record opens a sheet above the journey action dock. Its heading and close button remain clear of the search bar, source details scroll within the sheet, and the map key and layer toolbar return when it closes. The nearby-updates menu also opens above the island-details button so Pause remains clickable. Journey endpoints and proposal placement retain their anchored map controls.

Run `npm run test:browser:bus-vehicles` with the backend and frontend available for a real-source desktop/mobile visual and selection check. Its screenshots and receipt are saved under `artifacts/qa/bus-vehicles`.

FollowMe discovery resolves a public island/vehicle catalogue to a local seed and makes one bounded public neighbours request. Catalogued public buses use bus symbols, private cars are excluded, and device identifiers such as IMEI and phone fields are not exposed. Provider timestamps are interpreted in Maldives time and converted to UTC. Results older than the requested position-age limit are excluded; unknown observation times are explicitly qualified. Normalized records retain source and timestamp provenance.

The aircraft layer supports ADS-B and an OpenSky fallback. OpenSky has a five-minute provider cooldown and cached local snapshots to respect anonymous-access limits. Empty coverage stays empty, with provider status visible; no aircraft are generated to fill the map. Weather, observed movement and consumer traffic remain separate evidence from the planning model.

Planning playback is a **simulation of the calculated timetable**, not a live location feed. It follows each returned leg geometry and its walking/travel duration, holds at waits, supports transfers, and includes the calculated return journey. Editing an input disables stale playback until recalculation. Playback stops when the planning workspace is hidden. Supplied route geometry is retained. New bus services derive a permitted road path where one exists; proposed ferry corridors use qualified endpoint connections, not a surveyed sailing route. Missing geometry remains explicitly unavailable.

## Hexagon interpretation

As of 15 October 2026, the shared Explore/proposal map uses a continuous 55-metre-radius honeycomb rather than separated symbols at source origins. The mesh is clipped to the union of the existing resident-source footprints, preserving coastline edges, source holes and disconnected areas. Areas outside those footprints do not gain inferred population. These are display tiles, not census boundaries or measured hexagonal population observations. Detailed comparisons remain limited to the Greater Malé planning snapshot.

Each source origin contributes its existing resident allocation by intersection-area share. Tile journey times and gap scores are resident-weighted averages; missing contributing evidence stays unknown. Impact classes use the resident-dominant source comparison, with unavailable or uncomputed evidence taking precedence over favorable classes. Overall proposal totals, costs and routed comparisons still use the original model origins. Selecting a tile opens its aggregated details; the advanced itinerary workbench retains individual-origin selection. A pending new facility and conceptual service connectors appear before submission; target-based removals and closures use retained target geometry. Outward and return path colours are distinct.

The additive `hex_grid` response is cached by immutable planning scope. Its 944 clipped tiles cover all 667 supplied origins exactly once, and every origin's shares sum to one within floating-point tolerance. Subtle borders and translucent fills leave the streets visible. `tests/test_display_grid.py` checks support equality, shared borders, non-overlap, population conservation, source holes, stable IDs and caching. `src/lib/display-grid.test.ts` checks aggregation and missing evidence. `scripts/verify-continuous-hex-map.mjs` captures matching desktop/mobile service-gap and impact views under `artifacts/qa/continuous-hex-map`.

The gap heat map and proposal impact now both require that same identified mesh; missing mesh data does not fall back to square source footprints or separate origin-centred symbols. The selected island's national summary polygon is omitted while its detailed mesh is available. Analytical fills render above building and green-space footprints, with roads and symbols above the colours. A shared green–amber–red gap palette appears on the map, legend and neighbourhood details; unknown evidence stays grey. The Layers panel includes a keyboard-accessible **Overlay opacity** control (0–100%, default 65%) shared by gaps and impact and remembered on this browser. It updates map paint without fetching evidence, rebuilding geometry or recalculating a proposal; the inactive analytical layer remains fully transparent and is excluded from click/hover queries. The expanded controls leave room for the search, weather and nearby updates above. `scripts/verify-map-heat-opacity.mjs` checks the control, persistence, matching tile IDs and desktop/mobile views.

National graph-edge closure previews qualify the associated captured OSM way because that map does not expose the exact routing segment geometry. Unknown target IDs remain unmapped with an explicit count. Calculated journey paths render above conceptual draft connectors so their travel-mode colours remain visible.

The opacity refinement passed 111 frontend unit tests, Svelte diagnostics with zero errors/warnings, formatting/ESLint and the production build. The [continuous-mesh receipt](../artifacts/qa/continuous-hex-map/after/verification.json) records eight passed desktop/mobile workflows across Malé and Hulhumalé. The [opacity receipt](../artifacts/qa/map-heat-opacity/verification.json) records five passed checks for keyboard control, unchanged requests/camera/costs, saved preferences, unobstructed mobile controls and the same selected hex ID in both modes. Both browser receipts contain zero page errors.

## Verification

The repeatable browser harnesses are `scripts/verify-engaged-map-browser.mjs`, the map-symbol harness and the planning-map harness. Receipts and screenshots are saved under `artifacts/qa`. Unit tests cover polling lifecycle, obsolete responses, Addu scope, retained observations after failure, hexagon semantics and timed journey playback. Backend tests cover provider discovery, spatial filtering, timestamp freshness, timezone conversion, privacy, fallback and cooldown.

The production preview at `http://127.0.0.1:5181` passed 548 backend tests, 55 frontend unit tests, Svelte checks with zero errors/warnings, frontend formatting/ESLint, backend Ruff and the production build. The [final verification receipt](../artifacts/qa/engaged-map/final-verification.json) links the 33 passed browser workflows. The build retains its existing large-chunk advisory; this is not a production deployment.

The completed browser workflows use actual backend map/evaluation/journey responses. Controlled movement samples exercise aircraft icons, newer-position interpolation and reduced-motion behavior; the separate Explore run uses public provider observations. Proposed transit operating assumptions exist only in disposable browser drafts.

| Browser receipt | Passed workflows | Evidence |
| --- | --- | --- |
| [Observed movement](../artifacts/qa/engaged-map/browser-verification.json) | 6 | Automatic bounded discovery, fit, pause/resume, island changes, hidden workspace and mobile controls |
| [Map legibility](../artifacts/qa/map-legibility/report.json) | 10 | Typed icons, source popups, observations, clusters, immediate route inputs, stale routes, mobile key and target-only edits |
| [Planning map](../artifacts/qa/planning-map/report.json) | 9 | Draft placement, source-weighted hexes, real recalculation, outward/return playback, stale guards, mobile endpoint fit and bus/ferry paths |
| [Planning regression](../artifacts/qa/planning/report.json) | 8 | Baseline integrity, appointments, costs/carbon, two-direction services, scoped persistence, notices and responsive layout |

The real Explore receipt recorded 261 vessel positions and four public buses near Malé, plus seven vessel positions near Hithadhoo. These counts are timestamped observations rather than a promise of continuous coverage. Aircraft providers returned no current observations during that run; their empty state remains visible.

The proposed bus browser case follows 206 points on retained driving edges. The ferry case uses retained Vili origin `wp:vilimale:3516:1013`, retained terminals and IGMH, with an explicitly assumed timetable and endpoint corridor. The geometrically nearest origin lies in an isolated walking component and correctly yields an unavailable journey; selecting a nearby location does not establish a connected route.

## Recovery

The source snapshot for this map-experience revision is `D:\Projects\Personal\datathon-backup-before-map-experience-20261014`. Its manifest describes exclusions; large source/data artifacts remain preserved in the workspace and earlier complete backup. The original pre-revamp backup is `D:\Projects\Personal\datathon-backup-20261014-124331`.
