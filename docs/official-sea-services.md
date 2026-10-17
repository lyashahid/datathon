# Official ferry timetable model

The sea-connections model uses compact, checked application data in
`data/public/sea-services.json`. The backend reads it for the route directory,
selected-island connections and time-dependent sea journeys. It is not a live
feed, and it does not assign tracked boats to passenger services.

## Source and coverage

The official [RTL website](https://www.rtl.mv/) loads its published zone schedules
from read-only operator endpoints. The response contains a PDF encoded in two
base64 layers. These PDFs explicitly label **island, departure, island, arrival**
and print each sailing's operating weekdays and effective date.

The 17 October 2026 acquisition yielded 100 PDF pages. Normalization produced
120 directional timetable/calendar records from 62 route codes, containing 136
published sailing rows/chains and 413 timed legs across 148 distinct islands.
These are recurring timetable patterns, not observed sailings or boat counts.

| Operator zone | Official source                                                                               | Route codes | Directional calendar records | Published sailing chains | Distinct islands |
| ------------- | --------------------------------------------------------------------------------------------- | ----------: | ---------------------------: | -----------------------: | ---------------: |
| Zone 1        | [RTL PDF response](https://bo.rtl.mv:4455/maldives/api/booking/v2/ferryTrip/allSchedules/101) |          18 |                           36 |                       40 |               41 |
| Zone 2        | [RTL PDF response](https://bo.rtl.mv:4455/maldives/api/booking/v2/ferryTrip/allSchedules/102) |          19 |                           34 |                       42 |               48 |
| Zone 4        | [RTL PDF response](https://bo.rtl.mv:4455/maldives/api/booking/v2/ferryTrip/allSchedules/104) |          14 |                           28 |                       28 |               35 |
| Zone 5        | [RTL PDF response](https://bo.rtl.mv:4455/maldives/api/booking/v2/ferryTrip/allSchedules/105) |          10 |                           20 |                       22 |               22 |
| Zone 6        | [RTL PDF response](https://bo.rtl.mv:4455/maldives/api/booking/v2/ferryTrip/allSchedules/106) |           1 |                            2 |                        4 |                3 |

Island totals overlap between zones. A route code may have multiple directions,
departure times or calendars. Friday service is not invented: the captured PDFs
publish no Friday sailings. The four existing Greater Malé departure/frequency
calendars are also converted into eight directional evidence records in this
same model. They do not establish crossing times.
These five RTL zones do not represent every public, private or resort service.

The complete bundle contains 130 directional records across 63 published route
codes and four named capital services,
covering 153 matched islands plus the named, spatially unresolved Gulhifalhu
endpoint. The 120 complete timetable records enable timed journeys; eight
departure/frequency records explain service availability without invented
arrivals; two historical S610 records document the Hithadhoo corridor.

## Greater Malé calendars

The existing, checksummed official evidence in
`data/public/policy-evidence/service-calendars.json` supplies these records:

| Official operator publication                                                                       | Available evidence                                                    | Treatment                                                                                              |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [Vilimalé 2026](https://mtcc.mv/wp-content/uploads/2025/12/Vili-male-Ferry-Schedule-2026-V1.pdf)    | Day-type frequency windows, effective 21 March 2026                   | Current publication as of its 10 October acquisition; published prayer break and Saturday gap retained |
| [Thilafushi 2026](https://mtcc.mv/wp-content/uploads/2021/07/Thilafushi-Ferry-Schedule-2026-V2.pdf) | Separate departure clocks in each direction, effective 24 August 2026 | Current publication as of 10 October; no arrival pairing                                               |
| [Gulhifalhu 2026](https://mtcc.mv/wp-content/uploads/2021/07/Gulhifalhu-Ferry-Schedule-2026-V1.pdf) | Separate departure clocks, effective 21 March 2026; no Friday service | Named evidence retained; no matched island polygon or invented map location                            |
| [Hulhumalé 2024](https://mtcc.mv/wp-content/uploads/2021/07/Hulhumale-Ferry-Schedule-16-4-2024.pdf) | Historical departure clocks; present validity unconfirmed             | Historical evidence only                                                                               |

`published_departures` preserves directional day groups and local clocks.
`frequency_windows`, `no_service_windows` and `unknown_windows` preserve the
operator's headways, prayer break and unfilled Saturday interval. Weekdays are
converted from ISO Monday=1 into the bundle's explicit Monday=0 convention.
Midnight window ends are represented as minute 1440, while a printed 00:15
departure stays minute 15; no service-day rollover is inferred. Public-holiday
flags are retained, but no dated holiday calendar is manufactured. Departure
columns are never paired into crossings, and headways never become invented
individual sailing times.

The checksummed official [RTL vessel route catalogue](https://bo.rtl.mv:4455/maldives/api/booking/v1/vessel/routedetails)
also supplies exact coordinates and route-specific identities for Maafannu,
Villingili and Thilafushi ferry terminals. The model retains these three ports
in `additional_terminals` with a separate `rtl:vessel-terminal:` ID namespace.
Only the explicit MVML and MTHL route endpoints are joined to the corresponding
Vilimalé and Thilafushi calendars; the original IDs, codes, names and source
checksum are checked during preparation. The source remains an 11 October 2026
catalogue snapshot, and adding these positions does not create arrival times.
Hulhumalé's historical calendar and the unmatched Gulhifalhu endpoint do not
receive an inferred terminal identity.

`data/public/sea-service-source-receipts.json` records each official endpoint,
UTC retrieval timestamp, JSON-response checksum and decoded-PDF checksum. Original
responses, PDFs and visual-review images stay under ignored
`data/raw/sea-source-research/`; the compact model carries its own provenance.
The operator does not state an explicit reuse licence.

## Hithadhoo

Official MTCC material documents S610 between S. Hulhumeedhoo and S. Hithadhoo.
The [2022 operator document](https://mtcc.mv/wp-content/uploads/2022/03/Zone-6-Speed-Ferry-Schedules.pdf)
explicitly documents both directions, and the
[2024 document title](https://mtcc.mv/wp-content/uploads/2022/03/S610-Speed-Schedule-HMD-HTD-HMD.pdf)
identifies the same corridor with an effective date of 17 April 2024. Direct
downloads returned HTTP 403 during this acquisition; indexed official text and
document metadata establish historical route evidence only. No source checksum
is claimed for these unavailable bytes.

The bundle therefore contains two historical S610 directional records, with
source links and no sailing times. Hithadhoo appears in the historical evidence
directory alongside the islands covered by current RTL timetable publications.
It does not count S610 as a current operating service or enable timed travel.
The retained official RTL terminal catalogue also does not identify a Hithadhoo
landing place. Current operator timetable confirmation and an identified landing
place are the remaining requirements; an island centroid is never substituted.

This is **S. Hithadhoo in Seenu/Addu (`island:1152`)**. The separate **L. Hithadhoo
in Laamu (`island:697`)** has verified RTL terminal `rtl:terminal:150` and current
published Z4R17 timetable evidence. Their atoll-qualified names, national island
IDs and service evidence are kept distinct.

## Transformation and validity

- Each printed sailing chain is parsed together with its own following weekday
  and effective-date footer, including continuations over page breaks.
- Source direction is retained. Return services require their own printed rows.
- Paired departure/arrival times preserve sailing duration and intermediate
  layover. No runtime is inferred from opposite-direction departures or distance.
- Every complete timetable call joins to the existing 149-terminal RTL catalogue
  by the exact atoll-qualified operator label after punctuation/space
  normalization. Unknown or ambiguous labels fail preparation. The catalogue's
  existing reviewed spatial joins supply national island IDs.
- Wrapped PDF names such as `Gdh. Faresmaathoda` are read from their own column.
  The parser rejects missing calendars, nonpositive durations, a disconnected
  stop chain, an arrival after the next departure, and unparsed time rows.
- `valid_from` is the printed effective date. `valid_until` and
  `published_valid_until` remain null when the operator supplies no expiry.
  `current_as_of` records each source's acquisition date (17 October for RTL,
  10 October for the retained capital calendars). Later dates project the captured
  recurring timetable; they are qualified as projections requiring operator
  rechecking. Dates before the effective date and historical evidence cannot
  become current scheduled journeys.
- The PDF prints two Z4R8A calendars with identical clocks and different
  effective days. Their shared `sailings[].equivalence_key` and
  `equivalent_publications` retain the evidence while allowing consumers to
  count each physical departure once on an overlapping service date.
- Null terminal calls on historical routes do not permit inferred transfers or
  map lines from island centres. Drawn connections require recorded terminals.

The initial and final calls intentionally leave unused arrival/departure values
null. Their traversed times are explicit. Any adapter to a routing engine may
copy the existing endpoint time into an unused endpoint field, but must never
invent intermediate timing, a berth transfer or vessel assignment.

## Reproduce and verify

From the repository root, using the existing backend Python environment:

```powershell
backend/.venv/Scripts/python backend/scripts/prepare_sea_services.py --download
backend/.venv/Scripts/python backend/scripts/prepare_sea_corridors.py
backend/.venv/Scripts/python -m pytest backend/tests/test_prepare_sea_services.py -q
```

Omit `--download` to reproduce the checked model from the ignored originals and
checked source receipts. A clean checkout can reacquire the official PDFs with
`--download`; if the publisher changes their content, review the changed receipts
and normalized timetable before accepting the refreshed model. API pages with
ambiguous single timing fields and terminal-only catalogues are not silently
promoted to paired schedules.

Visual review covered the Zone 6 departure/arrival table, Zone 5 wrapped names and
the Zone 4 revised-day continuation. Focused tests cover ingestion and
the shipped model's endpoint, calendar, chronology, direction and terminal
invariants, plus departure-only calendars, frequency windows and explicit gaps.

## Application integration and loading

`POST /api/v1/planning/sea-connections` returns the selected origin's documented
network, timetable journeys and an isolated proposal comparison. Timed journeys
include boarding buffers, waiting, direction, operating weekdays and transfers
at an identified shared terminal. A day return needs a separate feasible journey
after the minimum stay. The map highlights newly reachable or quicker islands;
thin connection lines follow planning corridors around the official OneMap land
polygons and end at the exact recorded terminals. Missing or inconsistent ports,
and corridors that cannot be resolved safely against the mapped shoreline, omit
the line while retaining the timetable evidence. These are modelled connections:
they are not surveyed sailing tracks and do not establish reef clearance, depth
or a navigable channel. AIS positions remain separate because no authoritative
vessel-to-service assignment was found.

Clicking an island shows its own sea connectivity rating: the number of islands
reachable within the selected time budget, with a reason and direct/transfer
counts. Date, departure time, waiting and available timetable evidence determine
the result. An island without verified timing is marked unverified. The selected
origin follows the baseline/proposal toggle; inspecting another island requests
that island's existing network without replaying the origin's draft operations.

Complete timetable calls also enter the existing planning/routing repository.
Historical, departure-only and spatially unresolved evidence stays inspectable
without producing invented arrivals or resident-access gains. The island access
index retains its existing calculation and explains that sea journeys are a
separate assessment.

The normalized timetable bundle is 260,170 bytes. The prepared corridor model is
118,066 bytes and covers 159 unique terminal pairs: 148 have usable planning
corridors and 11 are explicitly unavailable. Preparation took about 89 seconds;
reusing all unchanged prepared pairs took about 1.1 seconds. The backend checks
the model version and shoreline fingerprint before reuse. Only previously unseen
terminal pairs need runtime corridor calculation; a bounded 512-pair cache reuses
both directions. Map geometry is assembled only for the visible network.

The backend reads these files as application snapshots and invalidates its
bounded 24-entry baseline response cache when source/evidence or the prepared
corridor file changes. Proposal responses remain isolated. The UI debounces
input, cancels superseded requests and switches baseline/proposal views from the
same response. Timetable PDFs are acquired during preparation, never on map open.
This addition needs no new database table or migration; it does not change the
existing Postgres/PostGIS configuration or live-position providers.

Local validation on 17 October 2026 passed 962 backend tests and 343 frontend
tests, type checking, lint and the production build. Browser checks covered the
official Kulhudhuffushi–Hanimaadhoo outbound/return itinerary, proposal gains,
baseline isolation, preserved drafts, historical Hithadhoo evidence and the
existing capital street/hexagon views, thinner shoreline-avoiding connections,
recorded port markers and map-click island ratings. With the prepared corridor
model, subsequent uncached origin requests took about 53–114 ms and cached
requests about 5–20 ms. The first request needing lazy planning initialization
took about 1.9 seconds; these local measurements are not production-server
benchmarks. No deployment was performed.
