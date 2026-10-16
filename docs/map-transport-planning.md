# Map-first bus and ferry planning

Open **Map & planning**, select an island, then **Create proposal**. Set both spending limits before accepting investments.

The proposal opens directly to actions. Selecting a map cell reveals **Selected area** with its journey times; longer explanations stay under **Journey evidence**. The map legend remains outside the proposal.

## Add a stop with a bus connection

1. Click **Add bus stop**, then a road location, or drag the signpost icon onto the map.
2. A map bubble automatically suggests a connection to a reachable existing stop. Interchanges with recorded services are preferred, then the shortest return road connection. Up to four alternatives appear on the map and in **Connect to**.
3. Click a highlighted stop or choose it in the bubble to redraw both directions. Set a departure interval, service date, operating hours and bus type.
4. Use **See the full route on the map** to collapse settings while reviewing the path; **Edit settings** returns to the controls. Review the outward and return paths, trips each way, whole-proposal cost and resident-access preview. **Accept stop & route** adds a boarding point and two dated service directions together. **Add only a stop** switches to an explicit standalone stop confirmation.
5. Cancel or press Escape to discard the preview. Undo or remove reverses the complete accepted route package. Accepted connected routes are removed and redesigned as a package rather than moving a stop independently of its service geometry.

The backend finds independent directed paths on mapped drivable roads, respecting directionality. It does not draw a straight road connection through water or invent missing roads. Candidate search is bounded to 10 km each direction. A missing path leaves the service unavailable; a standalone stop remains an explicit choice.

## Add bus departures

Choose **Add bus**, or drag the bus icon near a mapped route. Select a direction and a recorded service date. The preview adds staggered departures within the captured operating hours and preserves the original timetable and boarding points. Fleet requirements are calculated across the shared route; this action does not assume a dedicated vehicle purchase. The quote shows the whole proposal's fleet and running costs. Accepting saves a dated additional service, rather than a frequency replacement.

A line cannot receive duplicate additional departures or a conflicting frequency change on the same date. Remove the earlier change before choosing another approach. Opposite directions and different dates remain separate. Added departures show their own service benefit; the display does not claim a pooled waiting-time saving against an invented baseline.

## Improve an existing line

Choose **Improve bus line** or **Improve ferry line**. Their line icons distinguish them from adding a vehicle service. The map highlights the selected direction and its boarding points. Choose a recorded service date and a shorter departure interval; the form starts from the captured timetable. Costs update automatically. Accepting changes scheduled departures, waiting times, fleet requirements and running costs; the other direction is unchanged. Increasing frequency alone does not shorten walking distance to a stop.

The supplied snapshot has no captured ferry timetables, so **Improve ferry line** explains that it is unavailable. **Add ferry** can still plan a new connection using existing mapped landing places.

## Plan a ferry service

Choose **Add ferry**, or drop the boat near the coast. The map focuses on the nearest verified departure landing on the selected island. This is a selection shortcut, not permission to build a new landing. Highlighted circles represent actual mapped ferry landings.

Choose the destination island on the map or by name, then choose its arrival landing. Change landings by clicking their highlights or using the named selectors. Set service date, departure interval and operating hours. The automatic preview shows both crossing directions, sailing assumptions and whole-proposal costs. **Accept ferry service** commits the return timetable and vessel costs together. No port construction is included. Missing landing evidence prevents a service being accepted.

The proposed crossing avoids mapped island shorelines, with short shore approaches at the selected existing terminals. Its polyline distance feeds crossing time, fleet requirements, running costs and emissions. This is a coastline-based planning corridor; it does not establish navigational clearance, water depth, a licensed service or an approved timetable. If a bounded search cannot find a usable corridor, the preview asks for more evidence instead of drawing through land.

Click an accepted route or ferry endpoint to inspect the proposed service and open its proposal. Proposed routes are distinct from live vehicle observations.

## Analysis and cost interpretation

### Service benefits beyond walking access

The map service preview, proposal panel, full impact review and PDF show **expected waiting time**, **dated departures** and **direct island connections** alongside walking access. A more frequent bus can therefore have a useful benefit even when no additional residents cross the walking-time target. Each changed line names its boarding and destination stops; scoped comparisons use a boarding stop on the selected island when possible.

Expected waiting time assumes uniformly arriving passengers over the displayed operating interval and integrates the actual gaps in the dated timetable. A regular 20-minute interval gives a 10-minute expected wait. Before/after savings use the same overlapping interval and boarding locations. The next departure and its wait are calculated from the selected clock time. These are timetable estimates, not observed queues or a ridership forecast. Single departures, incompatible boarding locations and non-overlapping hours do not produce a saved-wait claim.

Island connections are directional single-vehicle links between boarding and later arrival islands, including through stops. A return ferry shows two directions separately, with sailing times and departures on the selected date. Missing baseline service evidence appears as **No dated service in data**, rather than proof that no operator exists. New services show their expected wait without assigning a fictitious baseline wait. Departures at different terminals are not combined into an interchangeable waiting-time estimate. Transfer feasibility, capacity, cancellations and national door-to-door journeys require additional evidence.

`POST /api/v1/planning/quote` includes `transport_connectivity.impact` for inexpensive service previews. `POST /api/v1/planning/evaluate` includes the same comparison beside the existing before/after transport summaries. Computing this comparison does not reroute residents or change walking-map colors.

### Compare access on the map

The map has two proposal views: **Without proposal** and **With proposal**. They share one prepared hex mesh and the same journey target. Switching views updates colors without rebuilding geometry, sending GeoJSON again, or requesting another evaluation. Click the same hexagon in either view to inspect the corresponding journey evidence. The access selector above the comparison switches between walking access to public transport, healthcare and education.

A valid, affordable placement previews the whole proposal before acceptance. Its legend says **Placement preview · not added**. Cancel removes the preview; acceptance reuses its result when the proposal and assumptions still match. Changing a location, target or proposal recalculates in the background while retaining the last valid map with an updating label. New placements select **With proposal** automatically.

Green means the modeled residents meet the displayed journey target; red means longer journeys. A proposal changes a cell only when the evaluated journeys justify it. More frequent buses can improve waiting time without shortening the walk to a stop. Residents already within the target can have faster journeys without an additional threshold crossing. Detailed journeys and the full impact review retain those distinctions.

Hexes cover the supplied resident footprints, rather than all land. Unshaded land has no resident estimate and must not be interpreted as zero population or good access. In the supplied snapshot, about 58% of Hulhumalé's mapped land has modeled resident footprints; the airport has none. The mesh is complete within those footprints, including clipped coastal cells. Grey cells indicate incomplete evidence within the modeled area.

- Every accepted service uses ordinary backend planning operations, so routing, accessibility, fleet, financial and emissions calculations consume the same proposal shown on the map.
- Costs shown before acceptance include existing proposal commitments and both spending limits. Changing endpoints, timetable, date or budget invalidates the previous quote.
- Walking access measures proximity to a boarding point. Service connectivity and scheduled journeys are separate outcomes; a new service must not be presented as a walking-access gain by itself.
- Detailed resident modeling is limited to the supplied Greater Male snapshot. Ferry connectivity can be screened nationally, but missing detailed resident evidence remains unavailable.
- New services operate on the selected proposal date. Captured published timetables are not silently repeated on other dates.
- Ridership demand is not created from departures. Route paths, sailing speeds, landings, fleet factors and suitability assumptions still need operational review.

`POST /api/v1/planning/bus-connection` returns source-backed candidate geometry, stop/service operations and an authoritative quote. The endpoint reuses the baseline road graph; previews do not trigger a full resident evaluation. The frontend debounces changes, cancels obsolete requests and reuses an exact matching impact preview after confirmation.

Verification: `npm run test:browser:map-comparison`, `node scripts/verify-map-transport-planning.mjs` and `npm run test:browser:proposal-experience` against the running production app. The comparison check uses real source-data improvements, before/after screenshot pixels, pending-preview cancellation, mobile layout and rapid switching under CPU throttling. Backend regressions are in `backend/tests/test_planning_map_comparison.py`.

`node scripts/verify-transport-service-impact.mjs` verifies captured R1 waiting improvements, preview-to-review consistency, unchanged walking results, new ferry directions and the phone layout. Waiting methodology regressions are in `backend/tests/test_transport_impact.py`; PDF checks are in `backend/tests/test_planning_report.py`.
