# Public transport and island connections

The map distinguishes **walking access to public transport** from **a service connecting islands**. A bus stop or ferry landing place is infrastructure evidence. It does not establish that a vehicle runs there, at what time, or with what capacity.

## Retained source coverage

The following counts were checked against the repository snapshots on 15 October 2026. They describe data coverage, rather than a complete inventory of transport operating in the Maldives.

| Source                                                                                      | Available evidence                                                                                                           | Important limit                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `backend/data/cache/normalized/transport.json`                                              | 659 mixed OSM features; 106 bus features when bus tags are considered                                                        | The collection also contains schools, healthcare and government features. Do not count every record as a public transport stop.                                                                                                                       |
| The same normalized transport collection                                                    | 176 marine-related records when ferry tags and pier categories are considered; 46 have an assigned island, across 37 islands | 130 records have no assigned island. A mapped pier does not establish public passenger access.                                                                                                                                                        |
| `backend/data/cache/graphs/marine.json`                                                     | 71 nodes, 35 candidate edges, 7 OSM ferry route relations                                                                    | All retained edges are disabled for passenger routing until service evidence is supplied. Graph edges are not unique operating services.                                                                                                              |
| `data/public/planning-baseline.json`                                                        | 99 published bus stops and 11 dated bus service patterns across Malé, Hulhumalé, Hulhulé and Vilimalé                        | The 10 October 2026 bus departures are a remaining-departure snapshot, not a complete recurring calendar. Four other mapped bus routes lack complete timings.                                                                                         |
| `data/public/policy-evidence/service-calendars.json`                                        | Four ferry calendars: Vilimalé, Thilafushi, Gulhifalhu and Hulhumalé                                                         | None includes a verified crossing duration. The Hulhumalé document is historical (2024) and requires current operator confirmation. Opposite-direction departure columns are not arrival/departure pairs.                                             |
| `data/public/policy-evidence/ferry-terminals.json`, sourced from the RTL terminal catalogue | 149 unique terminal records with coordinates, retrieved 11 October 2026; all joined to 149 national island polygons          | The archived original is local and ignored by Git; the compact catalogue, checksum receipt and geographic join audit are shipped. It covers atoll-prefixed terminals and excludes Greater Malé terminals. It is not a service or timetable catalogue. |

The detailed planning snapshot has 49 stops on Malé, 30 on Hulhumalé, 3 on Hulhulé and 17 on Vilimalé. Its resident analysis uses 667 WorldPop-weighted origin allocations. These are population allocations, not observed passenger demand.

The shipped RTL catalogue associates its 149 coordinates spatially with national island polygons: 82 fall within a unique polygon, and the other 67 have exactly one island polygon within 150 metres. The largest assigned coastal distance is 101.735 metres. Distances use a local spherical equirectangular projection at each terminal latitude, with Earth radius 6,371,000 metres. They are approximate distances, not surveyed measurements. Multiple containing polygons or multiple nearby coastal candidates without a unique containing polygon remain unassigned under the preparation rule. Each record retains nearby candidates, method and distance; the bundle retains checksums for both original terminal data and island geometry. Nearest geography alone is insufficient to confirm a public landing place or active service.

## Terminal eligibility

Inspect original OSM tags as well as the normalized category. In particular, the Hulhumalé Ferry Terminal (`osm:way:302137545`) has normalized category `public_transport`, with `amenity=ferry_terminal` and `ferry=yes`. Three Malé terminal records have the same category pattern. Looking only for category `ferry_terminal` misses these facilities.

Airport terminals are not ferry terminals. Neither an `aeroway=terminal` record nor a generic terminal name establishes marine access. A ferry route endpoint can locate a mapped candidate corridor but does not by itself identify a passenger terminal. Plain piers remain a separate review category: all 40 retained pier records lack explicit ferry tags, and several describe resort, dive or service jetties. Absence of a private-access tag is insufficient evidence of public passenger access.

The merged planning catalogue currently exposes 207 identified terminal options: 149 RTL records and 58 eligible, island-assigned OSM records. These are source records, not a deduplicated count of distinct physical terminals. Locations from separate catalogues may describe the same facility.

## What the existing access measures mean

The local transport hex layer measures walking-network minutes from allocated resident origins to the nearest non-disabled mapped stop, using a ten-minute target. It does not incorporate verified departure frequency, seats or the ability to reach a chosen island.

The connectivity response's `local_transport` summary uses the same ten-minute walking target for bus stops. It returns resident coverage only within the detailed four-island population and street-network model. Islands outside that model still return mapped stop and ferry-terminal counts, with resident walking coverage unavailable.

The planning request now also accepts `assumptions.goal: "transport"`. This compares walking access to non-disabled boarding points, including reviewed mapped ferry landing places as well as bus stops. The map selects a ten-minute target for this goal; the request can explicitly choose a different target. Walking to a boarding point does not require or imply a scheduled departure. Resident walking gains and inter-island service connections therefore remain separate results in the map, forecast and PDF.

The national transport availability component combines airport, bus and ferry evidence with configurable weights. Its default ferry contribution is zero when marine service is unverified. This is an evidence-based availability indicator; it must not be described as a measured public transport journey score.

For an island-to-island check, show these findings separately:

- Whether mapped landing places exist at each end.
- Whether an accepted service or only a mapped candidate corridor connects the islands.
- Whether dated departures and crossing durations support a timed journey.
- Which information is missing before operation can be treated as established.

An unavailable timetable means **no verified service in the available data**, rather than proof that no ferry operates.

## Ferry-service proposals

A proposed ferry service uses existing mapped landing places. It does not create a port, jetty or new ferry terminal. If either end has no suitable mapped landing evidence, the proposal must request that evidence rather than silently constructing infrastructure or placing a terminal at an island centroid.

Proposed frequency, operating hours and sailing speed are scenario inputs. Any estimated crossing duration or direct corridor must remain labelled as an assumption, rather than a navigation-certified marine route. Vessel procurement and annual operation belong in the budget; terminal construction remains zero for this proposal type. Costs and emissions factors in the planning model are editable illustrations unless replaced by reviewed operator quotations or measurements.

Resident access gains require the detailed population and walking-network model. Outside its geographic coverage, a proposed island connection can still be screened for terminals and service cost, but population served, ridership and healthcare/education gains must not be invented from island population alone.

Local bus-stop, school and hospital construction is blocked outside the supported planning area in both the UI and API. Unsupported operations return HTTP 422 instead of being omitted from a zero-cost quote. Existing-terminal ferry services remain available for national island connections.

## API and proposal flow

`GET /api/v1/planning/connectivity?origin_island_id=island:1442&destination_island_id=island:1443&date=2026-10-10` checks Hulhumalé to Malé. The result keeps terminal evidence, local walking access, directional connection links and their evidence classes separate. `dated_service` describes captured service evidence on the requested date; `mapped_route` describes an unverified candidate corridor. Neither status alone proves that transfers align into a timed itinerary. A missing terminal or timetable is returned as an evidence gap.

`POST /api/v1/planning/ferry-service` previews an illustrative service and returns proposal operations, map geometry and an authoritative budget quote. For example:

```json
{
	"origin_island_id": "island:1442",
	"destination_island_id": "island:1443",
	"headway_minutes": 120,
	"start_minutes": 360,
	"end_minutes": 1200,
	"speed_kph": 25,
	"assumptions": {
		"date": "2026-10-10",
		"goal": "transport",
		"target_minutes": 10,
		"capital_budget_mvr": 50000000,
		"annual_operating_budget_mvr": 100000000
	},
	"operations": []
}
```

Supply existing proposal operations when requesting a quote so both budget limits are checked against the combined proposal. Optional `origin_terminal_id` and `destination_terminal_id` select an identified landing place on each chosen island. Without sufficient terminal evidence, the response has no addable service. A returned draft is not a saved or approved operating service; the frontend confirms the exact quoted operations into the proposal only when its budget allows.

The service includes outbound and return sailings plus terminal layovers within the chosen operating window. The scenario date controls the generated service day. Annual operating costs multiply that service-day activity by the explicit annual operating-days assumption, rather than claiming that the source supplies an annual timetable. Vessel procurement includes the configured fleet reserve. The new `use_existing_ferry_terminal` operation references the reviewed catalogue; it does not charge for new terminal construction.

Each ferry package retains two terminal-reuse references and two directional service operations. Reusing an existing terminal is idempotent, so removing one complete ferry package does not leave a different package dependent on a deleted terminal reference. Dated connection links retain their `timing_basis`; any reviewed imported service with an assumed runtime remains qualified rather than becoming a verified timed itinerary.

`POST /api/v1/planning/evaluate` accepts the confirmed operations through the existing proposal model. Its `transport_connectivity` before/after summary reports modeled inter-island service lines and islands connected alongside the existing access and cost results. Counts of service patterns or connected islands are not passenger counts or a measured national accessibility gain.

Local bus-stop, school and hospital construction is limited to islands in the detailed resident and road model. The interface disables these placement controls elsewhere, and the quote and evaluation APIs reject unsupported construction rather than silently returning a zero-cost proposal. National islands can still plan a ferry service between sufficiently evidenced existing landing places; resident access impacts remain unavailable outside the detailed model. The service-evidence date carries into the ferry composer and can be changed explicitly in the proposal assumptions.

## Verification

After `npm start` has launched the application, run `node scripts/verify-island-connections.mjs` for the real API and browser journey. Set `BASE_URL` only when using a non-default local port. The check covers dated evidence and date preservation, ten-minute local access, terminal reuse, outward and return service patterns, both budget limits, map previews, clear/reset, grouped proposal removal, analytics handoff, mobile layout and PDF export. It also checks that terminal endpoints remain visible outside map controls and panels, and that unsupported national construction is blocked by both the interface and backend while ferry planning remains available. It saves its JSON report, screenshots and downloaded decision brief under `artifacts/qa/island-connections/`. These checks do not substitute for operator review of terminal permission, sailing suitability or actual service operation.

## Useful next source additions

Reviewed operator sailing durations, dated route calendars, explicit terminal IDs and exceptions would make published ferry evidence usable for timed journeys. Vessel availability, berth suitability, peak passenger counts and operator costs would support capacity and financial feasibility. Marine route geometry and safety review are necessary before treating an illustrative connection as an operational sailing plan.
