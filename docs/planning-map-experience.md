# Planning on the map

The policy workbench now keeps one focused map beside the planning controls on desktop. The same map persists through design, resident access, journeys and delivery. Smaller screens provide a sticky **Show map** shortcut from the controls.

| Before                                                  | After                                                                                                                         | Why                                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Journey start/end changed fields without a map response | Labelled A/B pins update immediately, and the map fits the selected endpoints                                                 | A policymaker can check where the journey begins and ends before calculating |
| New facilities were only listed in the draft            | A named location preview follows the form, can be placed by clicking, and is retained as a proposal icon                      | Location is an editable part of the decision                                 |
| Accessibility results were only tables                  | Hexagonal visual cells at source origin coordinates show computed gain, loss, faster/slower journeys and unavailable evidence | Geographic patterns become inspectable without inventing local population    |
| Results could be read after editing assumptions         | Previous impact tiles turn grey, the map explicitly requests recalculation, and stale journey playback is disabled            | The previous result cannot masquerade as a new calculation                   |
| Timed journeys had geometry only in the export          | Outward/return network paths are visible with walking, bus and ferry colors and optional elapsed-time playback                | The complete route and transfer wait can be understood visually              |
| Calculation progress had only a button label            | Map status and a restrained recalibration ripple exist during the actual request                                              | Feedback follows real work; no artificial delay is introduced                |

## What the map means

- The shared Explore/proposal map now uses a continuous honeycomb clipped to the existing resident-source footprints. Tile values are resident-weighted aggregates; overall calculations retain the original source origins. See [Hexagon interpretation](engaged-map-and-planning.md#hexagon-interpretation) for the display allocation and verification. The advanced itinerary workbench described here retains individual-origin visual cells. Neither display is a census boundary, building occupancy estimate or measured hexagonal population footprint.
- Green gain means the backend `gained_access` result crossed the selected access target. Red loss means the backend confirmed a reachable journey moved beyond that target. Faster/slower colors use the backend before-minus-after time difference; small differences below 0.05 minute are treated as visually unchanged.
- Amber **Became unavailable** means the available network/calendar no longer yields a known journey. Grey **Evidence unavailable** means no known result. These do not assert measured no access or measured loss.
- Coral dashed service connectors join the draft boarding locations conceptually. They are not claimed as road or sailing routes. Closed roads and changed existing patterns use their retained network geometry.
- The outward and return paths come directly from actual `planning/journey` leg geometry. Walking is green, bus amber, ferry blue, and return purple dashed. No route is invented for an unlocated or unavailable leg.
- New bus services receive a backend-derived road path where a legal connected path exists. New ferry services use an explicitly assumed corridor between source stops, labelled as a planning corridor rather than a charted navigation route. Retained service geometry is preserved, and missing transit geometry has an explicit warning instead of an invented vehicle position.
- A proposed facility can now be selected directly as the journey destination. The backend still enforces its opening date, network snapping and eligibility.

## Playback and motion

**Journey preview is a simulated resident itinerary, not observed vehicle tracking.** It interpolates by distance along the calculated geometry during each leg, uses the leg's elapsed travel time, and holds at the boarding point for the calculated wait. Outward and return have separate timelines. The route does not include an animated appointment stay between them. Playback is manual, supports play/pause and scrubbing, and stops when inputs become stale or the planning view is hidden.

The elapsed-time slider preserves the exact backend maximum, including fractional minutes, so scrubbing to the end shows **Arrived**. Map fitting leaves room above the resident inspector and recalculates its fit when the container changes size.

The ripple only runs while an actual backend request is pending. Reduced-motion preferences suppress ripple and status-pulse animations and make map fitting immediate. The user can still explicitly play the itinerary. Map errors and source limitations remain readable without animation.

## Validation

`src/lib/planning-map.test.ts` covers source weight preservation, missing-evidence versus confirmed-loss semantics, changed availability, target gain, exact leg geometry, distance interpolation and wait-aware playback. The maintained browser workflows in `scripts/verify-planning-browser.mjs`, `scripts/verify-delivery-browser.mjs` and `scripts/verify-proposal-experience.mjs` check retained source baselines, proposal placement and costs, actual evaluation/journey responses, stale results and draft preservation; they write their decision evidence and desktop/mobile views under `artifacts/qa/planning`, `artifacts/qa/delivery` and `artifacts/qa/proposal-experience`. The planning notice test dismisses its clearly labelled QA notice when finished; proposal drafts remain inside isolated browser storage.

Verified against the final production preview at `http://127.0.0.1:5181` on 14 October 2026: **9 browser workflows passed with zero page errors**, including actual bus/ferry geometry provenance, visible path qualifications, exact fractional **Arrived** endpoints, and unobscured destination pins after desktop/mobile resizing. The geometry/playback unit suite has **8 passing cases**, and Svelte type checking reports zero errors or warnings. Bus/ferry QA timetables are explicitly assumed browser-local scenarios on retained source origins, stops and facilities. The ferry fixture uses the connected real Vili origin `wp:vilimale:3516:1013`; geometric proximity alone does not establish a walking-network connection.

Inspect `report.json`, `actual-evaluation.json`, `actual-journey.json`, `actual-bus-journey.json` and `actual-ferry-journey.json` in the QA output directory. The latest impact and active journey screenshots are `latest-journey-desktop.png`, `latest-journey-mobile.png`, `bus-journey-desktop.png` and `ferry-journey-desktop.png`.

Detailed per-origin planning remains scoped to the available Greater Malé snapshot. A map animation does not improve missing historical calendars, ferry crossing evidence, destination admissions or capacity inputs.
