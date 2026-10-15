# Map-first bus and ferry planning

Open **Map & planning**, select an island, then **Create proposal**. Set both spending limits before accepting investments.

## Add a stop with a bus connection

1. Click **Bus stop**, then a road location, or drag the stop icon onto the map.
2. A map bubble automatically suggests a connection to a reachable existing stop. Interchanges with recorded services are preferred, then the shortest return road connection. Up to four alternatives appear on the map and in **Connect to**.
3. Click a highlighted stop or choose it in the bubble to redraw both directions. Set a departure interval, service date, operating hours and bus type.
4. Use **See the full route on the map** to collapse settings while reviewing the path; **Edit settings** returns to the controls. Review the outward and return paths, trips each way, whole-proposal cost and resident-access preview. **Accept stop & route** adds a boarding point and two dated service directions together. **Add only a stop** switches to an explicit standalone stop confirmation.
5. Cancel or press Escape to discard the preview. Undo or remove reverses the complete accepted route package. Accepted connected routes are removed and redesigned as a package rather than moving a stop independently of its service geometry.

The backend finds independent directed paths on mapped drivable roads, respecting directionality. It does not draw a straight road connection through water or invent missing roads. Candidate search is bounded to 10 km each direction. A missing path leaves the service unavailable; a standalone stop remains an explicit choice.

## Improve an existing route

Choose **Bus service**, or drag the bus icon near its route. The map highlights the selected published direction and its boarding points. Choose a route, a recorded service date and a new departure interval. Costs update automatically. Accepting changes scheduled departures, waiting times, fleet requirements and running costs; the other direction is unchanged. Increasing frequency alone does not shorten walking distance to a stop.

## Plan a ferry service

Choose **Ferry service**, or drop the boat near the coast. The map focuses on the nearest verified departure landing on the selected island. This is a selection shortcut, not permission to build a new landing. Highlighted circles represent actual mapped ferry landings.

Choose the destination island on the map or by name, then choose its arrival landing. Change landings by clicking their highlights or using the named selectors. Set service date, departure interval and operating hours. The automatic preview shows both crossing directions, sailing assumptions and whole-proposal costs. **Accept ferry service** commits the return timetable and vessel costs together. No port construction is included. Missing landing evidence prevents a service being accepted.

The proposed crossing avoids mapped island shorelines, with short shore approaches at the selected existing terminals. Its polyline distance feeds crossing time, fleet requirements, running costs and emissions. This is a coastline-based planning corridor; it does not establish navigational clearance, water depth, a licensed service or an approved timetable. If a bounded search cannot find a usable corridor, the preview asks for more evidence instead of drawing through land.

Click an accepted route or ferry endpoint to inspect the proposed service and open its proposal. Proposed routes are distinct from live vehicle observations.

## Analysis and cost interpretation

- Every accepted service uses ordinary backend planning operations, so routing, accessibility, fleet, financial and emissions calculations consume the same proposal shown on the map.
- Costs shown before acceptance include existing proposal commitments and both spending limits. Changing endpoints, timetable, date or budget invalidates the previous quote.
- Walking access measures proximity to a boarding point. Service connectivity and scheduled journeys are separate outcomes; a new service must not be presented as a walking-access gain by itself.
- Detailed resident modeling is limited to the supplied Greater Male snapshot. Ferry connectivity can be screened nationally, but missing detailed resident evidence remains unavailable.
- New services operate on the selected proposal date. Captured published timetables are not silently repeated on other dates.
- Ridership demand is not created from departures. Route paths, sailing speeds, landings, fleet factors and suitability assumptions still need operational review.

`POST /api/v1/planning/bus-connection` returns source-backed candidate geometry, stop/service operations and an authoritative quote. The endpoint reuses the baseline road graph; previews do not trigger a full resident evaluation. The frontend debounces changes, cancels obsolete requests and reuses an exact matching impact preview after confirmation.

Verification: `node scripts/verify-map-transport-planning.mjs` and `npm run test:browser:proposal-experience` against the running production app.
