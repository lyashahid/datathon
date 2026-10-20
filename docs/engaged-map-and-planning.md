# Map activity and resident access

The shared map displays source records, observed movement, directions and proposal comparisons. Use the [proposal guide](proposal-experience.md) for editing and [transport planning](map-transport-planning.md) for bus/ferry service design.

## Places, directions and observed movement

Map symbols distinguish bus stops, ferry terminals, piers, airports, schools and healthcare. A stationary terminal symbol is infrastructure; a vehicle symbol is a provider observation. Grouped observations expand on selection. Unlocated records remain in island inventories and are not plotted at invented island-centre coordinates.

The search first uses the selected island's mapped records and operator stops. Removing the island filter allows another island to be selected. A located result receives a named map pin. Directions opens inline with that selection, supports ordered stops and walking, bus/ferry, bicycle and car modes, and draws only actual returned leg geometry. Missing segments remain gaps. Road distance is not a live traffic estimate; scheduled journeys retain their date, waits and transfer evidence.

Nearby movement is requested for the selected scope. Superseded requests are cancelled; polling stops while the map or document is hidden and can be paused. A transient failure retains the previous snapshot with its status and original timestamps. Heading and received coordinates control symbols; interpolation between newer observations does not extrapolate future positions. Reduced motion suppresses decorative interpolation.

FollowMe discovery uses a public island/vehicle catalogue and bounded neighbours requests. Public buses use bus symbols; private cars and device identifiers are excluded. Provider times are interpreted in Maldives time and normalized to UTC. Unknown measurement times and stale or empty coverage remain qualified. Aircraft and vessel positions do not alter deterministic access scores or establish an operating timetable. See [live feeds](live-map-feeds.md) and [transport source context](transport-context.md).

## Hexagon interpretation

The resident display is a clipped honeycomb over the supplied source-origin footprints. It is a visualization of modeled population allocations, not a census boundary, measured building occupancy or observed hexagonal population count. Areas outside the footprints have no inferred residents. Routing and overall proposal totals retain the original model origins.

Each origin contributes population by intersection-area share. Tile journey times and gap scores use resident-weighted averages; missing contributing evidence stays unknown. The `hex_grid` response is identified by the planning scope. Missing mesh data does not fall back to invented squares or origin-centred polygons. National screening polygons and detailed resident layers have different meanings and coverage; [population and map sources](map-context-and-population.md) explains their inputs.

Proposal comparisons distinguish target access, known longer journeys, changed availability and unknown evidence. Faster service alone need not move residents across an access target. Unshaded land is not zero population or good access. The map key and selected-area evidence explain the active lens. Overlay opacity changes paint only, without requesting a new calculation or geometry.

## Calculation and playback

A pending placement is separate from an accepted proposal. Edits invalidate the corresponding result; recalculation retains the previous result with an updating qualification. Only a matching successful response becomes current. Brief feedback highlights cells whose computed outcomes changed; its timing is not a progress percentage or a prediction of completion time. Keyboard actions and reduced-motion preferences skip decorative feedback.

Advanced journey playback is a simulation of the calculated itinerary, not observed vehicle tracking. It follows returned leg geometry, uses calculated durations and holds at waits. It stops when inputs become stale or its workspace is hidden. Missing geometry cannot receive a fabricated vehicle position. Bus paths require legal road connections; ferry corridors remain qualified planning geometry rather than surveyed sailing tracks.

## Verification

See the [browser verification guide](browser-verification.md) for maintained suites and generated reports. The implementation contracts are covered by [display-grid tests](../src/lib/display-grid.test.ts), [movement tests](../src/lib/movement.test.ts), [journey geometry/playback tests](../src/lib/planning-map.test.ts) and [backend mesh tests](../backend/tests/test_display_grid.py). QA screenshots and numerical receipts are regenerated under ignored `artifacts/qa/`; old test totals are not a current verification result.
