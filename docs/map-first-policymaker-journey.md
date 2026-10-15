# Map-first policymaker journey

The map is the workspace for exploration, proposal design, conditions and directions. Geographic choices stay visible, and the detail inspector opens in response to a task instead of covering the initial map.

| Before                                                                           | After                                                                                                                                                                 | Why                                                                                    |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Explore immediately opened a long baseline report.                               | Explore starts with the street map, nearby observations and a small action dock. Island details open on demand and can expand.                                        | A policymaker can first understand the place and choose the task.                      |
| Clicking a location mainly displayed source IDs.                                 | A mapped place or canvas location offers **Start here**, **End here** and **Create proposal here**; source details remain available in a disclosure.                  | Places become usable planning decisions.                                               |
| A proposal button opened a separate infrastructure form.                         | Choose a site in Explore and carry that exact point into the service composer. Alternatively click or drag a hospital, school or bus-stop tool onto the proposal map. | The proposal starts from a real geographic action.                                     |
| Design and results sat below a large persistent configuration form.              | A full-width proposal canvas has four workflow controls and a compact inspector, with an expandable bottom panel on phones.                                           | The map remains in view through design, impact, journeys and delivery.                 |
| Traffic started with four latitude/longitude inputs.                             | Choose or drag A/B pins, swap them, then calculate a traffic-aware route. Exact coordinates are in Advanced.                                                          | The workflow uses locations a person can recognize.                                    |
| Place research, directions and imagery had no shared map.                        | Nearby listings, named endpoints, waypoints, provider route geometry and the imagery location appear on one map.                                                      | Search results and journey choices share geographic context.                           |
| Adjusting a location could leave an old result in view.                          | Endpoint or proposal edits invalidate old route/impact results; calculation status communicates the actual request.                                                   | The displayed result must match the current decision.                                  |
| Mobile pages pushed actions and details below the map.                           | Primary actions remain beside the map, with optional expandable detail drawers.                                                                                       | A phone user can choose a location and act without searching down a long page.         |
| Changing islands could retain a hidden journey destination or intervention edit. | Scope changes reset those selections while preserving each island's saved draft.                                                                                      | A decision must use the island and proposal currently shown.                           |
| Tools could start at a fallback location before the requested island loaded.     | Location workspaces wait for the selected island's geography; Explore actions become available when that island is ready.                                             | Prevents a location choice or provider request from silently using a different island. |
| Resident selections exposed internal graph-node codes.                           | Resident tables, journey choices, map pins and playback use consistent island/area names and population counts. Source IDs remain in evidence and exports.            | A policymaker can recognize the same resident area throughout the journey.             |

## Walkthrough

1. Open **Map & planning → Explore**, select an island and inspect the streets. The map shows nearby observed vehicles by default. The compact key explains bus stops, ferry terminals, healthcare and schools; **All map symbols** explains the rest. Crowded ship positions group into count badges that zoom in when selected.
2. Open **Island details** for the population and source baseline. Close or expand the inspector as needed. **Find a place**, **Weather & traffic** and **Nationwide schedules** are supporting Explore tools; each has **Back to Explore map**.
3. Choose **Directions**, then click A and B on the map. Drag either pin to correct it. Use **Remove start point**, **Remove destination point**, **Swap start & destination**, **Reset**, or **Back to map** to recover from a choice. Place search results can become the same shared start or destination.
4. Choose **Bus & public transport** and a departure date/time. A verified route lists walking, waiting, named bus services, boarding/alighting stops and intermediate stops. The map fits the complete journey, draws its actual legs and marks transfers. Road modes show source-backed distance; they do not imply live travel time.
5. Choose **Create proposal here**, or open **Plan** and click a location. The map asks whether to add a school, hospital or bus stop. Adjust the draggable preview, then **Confirm place** or **Cancel**. Name, opening date and detailed assumptions are optional. **Undo** and **Clear draft** are available after a confirmed edit.
6. Choose **Review impact** to calculate the resident result. Pending pins must be confirmed or cancelled first. A confirmed school selects education; a confirmed hospital selects healthcare. **Impact** opens the result inspector beside the same map and highlights modeled changes.
7. Use **Journey** to compare outward/return access for a resident area, and **Budget & services** for schedules, costs and fleet assumptions. Export the calculated decision brief when the current evaluation is available. **Back to Explore** preserves the island and its draft.
8. On phones, map placement and confirmation remain available above an optional detail drawer. Specialist network modelling remains under **Advanced**, rather than adding a third primary map workflow.

## Geographic and evidence limits

The shared location maps render supplied island boundaries and captured OSM streets/buildings. They draw a provider route only when valid provider geometry exists. A dashed endpoint guide is an explicitly labeled connector, not a calculated street route. Raw coordinates remain available under Advanced for precise imports and specialist corrections.

Resident hexagons visualize supplied model origins, not census boundaries. Proposed facilities and services are planning assumptions. A point close to the graph is a location check; it does not establish service feasibility or certify access. Unreachable or missing evidence remains unavailable. Movement icons display received observations; model playback and proposed service corridors remain separately labeled.

Draft proposals stay in this browser and can be exported. Real-time collaboration remains excluded as requested.

Explore bus directions use the captured **10 October 2026** timetable and its remaining departures after **15:20 MVT**. The date/time controls make that evidence explicit. Other dates do not silently replay the captured day. The routing engine returns an unavailable explanation when no verified timetable can serve the request. Ferry crossings without verified arrival times or durations are not invented.

## Verification

Run with FastAPI and the frontend available; set `MOBILITY_QA_URL` to the target URL:

```powershell
npm run check
npm run lint
npm test
npm run test:backend
npm run lint:backend
npm run build
npm run test:browser:map-journey
npm run test:browser:map-focus
```

The current journey regression uses disposable browser storage and actual backend responses. It checks endpoint selection/removal/swap/reset, a real R3→R4 scheduled journey, unconfirmed Explore-to-Plan handoff, confirm/cancel/undo/clear, calculated resident impact, draft preservation, supporting tools, legacy URLs and desktop/mobile layout. Its receipts and screenshots are under `artifacts/qa/simplified-map-journey`. A separate normal-motion regression selects the real Maafushi Hospital from place search and verifies its destination appears on the visible map after returning from the search workspace; its receipts are under `artifacts/qa/map-place-focus`. Map-symbol and vessel-group checks are under `artifacts/qa/map-symbols-journey`.

The simplified workflow was verified on **15 October 2026** (local time): **575 backend tests**, **63 frontend unit tests**, **7 grouped browser journey checks**, and **2 place-focus checks** passed. The browser checks used the production preview with the real FastAPI backend and reported zero page errors. Place-focus checks covered both normal and reduced motion. Svelte reported zero errors/warnings; frontend/backend lint and the production build passed. Desktop verification included a 1265×721 viewport; mobile verification used 390×844. Preview pins remained visible and draggable, and the impact review calculated all 232 supplied Malé resident origins. Captured timetable coverage and unavailable ferry durations remain explicit evidence limits.

The earlier, four-tab workflow was verified on 14 October 2026: **41 browser workflow checks**, **58 frontend unit tests**, zero Svelte errors/warnings, and lint/build passed. That historical receipt is in `artifacts/qa/map-first-verification.json`; it is not the verification for the current simplified navigation.
