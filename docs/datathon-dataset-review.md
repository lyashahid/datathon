# Datathon dataset review — 21 October 2026

The review covered every file in the four agency release archives and the Team Kandu archive from the [MBS Datathon dataset repository](https://github.com/mbs-datathon/maldives-datathon-2026-datasets/tree/1b4ea2a6270dc784e014624b62c6327d941bef55). The repository was cloned into Downloads at commit `1b4ea2a6270dc784e014624b62c6327d941bef55`. Release `v1.0` is mutable: its publication date is 14 October, while the Avas and MTCC assets were added on 21 October. The archive hashes below identify the actual reviewed inputs.

The decision was to retain compact historical airport, taxi and vessel-presence aggregates. These add information absent from the existing public statistics and live snapshots. The randomized MTCC passenger workbook is excluded. Team Kandu's files are either older equivalents of existing sources or additional coarse context without a demonstrated improvement to the app's present planning decisions. This does **not** mean every Team Kandu observation is already used.

## Source receipts

All four agency archives came from the [v1.0 release](https://github.com/mbs-datathon/maldives-datathon-2026-datasets/releases/tag/v1.0). Team Kandu came from the pinned repository checkout. No separate reuse licence was present in these archives; the retained source receipts identify them as public participant downloads and preserve that qualification.

| Archive | Compressed bytes | SHA-256 |
| --- | ---: | --- |
| `MACL.zip` | 3,408,047 | `72428c8b5f57301987ceeb832070fc81f27423e5e213534b9c5610f70716e5b3` |
| `FollowMe.zip` | 461,413,929 | `1e3dd0cb95cd55962e746a2cea31209244975e12bc999b3e1e3450653fa8ac01` |
| `Avas_Ride.zip` | 13,416,035 | `959e575f01d4b08f75517fe5a196de127dc0e498a6648f1f179238405aff2f1b` |
| `MTCC.zip` | 54,075 | `536837c3fcab235d297733a42d8bb9661768ea8a9cdcaeb43cabbdb9e024d17a` |
| `team-shared-datasets/Team_Kandu.zip` | Repository asset | `8a471762b276f481834b9047330b0ebcfd1c33c737f5f2a2908907d1ccd020ec` |

## MACL: retain event-hour and monthly context

| File | Data rows | Grain and fields |
| --- | ---: | --- |
| `MACL/Airport traffic_Dataset_27092026.csv` | 168,959 | Supplied movement record: unique record ID, flight type, arrival/departure dates and actual times, anonymous carrier/route/aircraft codes, region, aircraft category, arrival/departure/transit adult/child/infant counts |
| `MACL/Metadata.csv` | 20 | One definition per movement-table column |

The supplied history spans January 2012–July 2026. Existing `context/agency-context.json` uses CAA/MBS published annual and monthly tables; it does not contain these event-hour profiles. This release supports a historical airport activity profile by clock hour. The prepared rows and curated interface combine the source dates into an hourly profile without a day-of-week breakdown. It does not identify which travellers used buses or taxis, provide a current flight timetable, or establish local ground-transport demand.

Preparation uses each event's own date and time, keeps arrival and departure counts separate, and excludes transit counts from their passenger totals. The metadata's claimed ISO date format differs from the actual `M/D/YYYY` values. Thirteen arrival records have missing or outside-period dates, including 11 epoch sentinels. Another 87 arrival events lack usable clock times. Departure dates remain usable, while 86 departure times are missing or malformed. These exclusions are separately counted and reconciled. Five content repeats with distinct record IDs remain included because the supplied data does not establish that they are duplicate events.

The compact output has 2,136 monthly and 3,121 hourly aggregate rows. It preserves anonymous source coverage and quality receipts, rather than distributing movement records. It remains separate from existing CAA/MBS totals because their coverage has not been reconciled. The source clock timezone and named route lookup are undocumented; no UTC conversion, domestic sector, turnaround or flight duration is inferred.

Implementation: `backend/scripts/prepare_datathon_airport.py` → `data/public/datathon/airport.json`.

## Avas Ride: retain historical taxi activity and trip-duration context

| File | Data rows | Grain and fields |
| --- | ---: | --- |
| `avas_rides_aug_sep_2026.csv` | 371,788 | Supplied ride record: start clock, pickup/dropoff coordinates, distance in km, time in seconds and status |
| `car_fare_matrix.csv` | 6 × 6 = 36 fare cells | Directional Malé city zone pairs; six source rows and six destination columns |

There is no accompanying README, status dictionary or methodology. Existing taxi routing uses the road network and assumptions; it has no equivalent historical Avas ride panel.

All 61 dates from 1 August through 30 September 2026 occur. The source has no empty cells or exact duplicate rows. Numeric coordinates, positive distances and durations pass the reviewed domain checks. No recorded distance is below endpoint great-circle separation beyond the 50 m tolerance, and no distance/time ratio exceeds the 100 km/h screening bound. Passing these checks does not certify the collection methodology or representativeness.

The retained profiles include `payment_completed` (320,140 records) and `ride_completed` (24,401) as an explicit interpretation of the status names: 344,541 records in total. The 27,247 `ride_expired` records also contain positive distance/time fields, so they are excluded from travel metrics. Expiration is not treated as a measured unserved passenger or failed taxi pickup.

The compact output contains 24 hourly, 61 daily, three pickup-zone, 72 zone-hour, nine corridor, 161 corridor-hour and 36 fare records. Groups smaller than 30 records are omitted. Coarse zones use strict containment in the app's existing Malé, Hulhumalé and Hulhulé polygons; no points are snapped onto land or guessed into phases. Both endpoints match for 303,990 completed records. There are 13,240 unmatched pickup endpoints and 28,190 unmatched dropoff endpoints, retained in the coverage receipt. The Hulhumalé/Hulhulé causeway partition is derived app geography, not an official neighbourhood or terminal boundary.

Global median recorded duration is 12.63 minutes, P90 is 15.85 minutes, and median recorded distance is 8.194 km. Summed distance divided by summed time is 38.39 km/h. This last value is a **recorded trip-speed proxy**, not a road-segment congestion index: stopping and changing trip mix can affect it. The source does not define whether `time_sec` includes waiting. No journey, passenger or vehicle ID is present, so counts describe records rather than verified unique journeys, people, fleet size or occupancy. Source-clock timezone is undocumented.

The matrix is symmetric and its 36 cells are retained as nominal MVR context with an explicit currency interpretation. The CSV itself states neither currency nor effective date, surcharges or fare rules. These values do not replace current fare quotes or infrastructure cost assumptions.

Implementation: `backend/scripts/prepare_datathon_taxis.py` → `data/public/datathon/taxis.json` (about 75 KB). No individual coordinates or timestamps are retained.

## FollowMe: retain historical island-presence context

The archive contains 31 daily CSVs and one field guide. Each CSV has `poll_id`, `imei`, `timestamp`, `device_date`, latitude, longitude, speed, heading, network, cell ID and signal level. The guide distinguishes the measurement clock (`device_date`) from database receipt time (`timestamp`) and describes speed as boat speed without documenting its unit.

| File under `FollowMe_august_2025/` | Rows | File | Rows |
| --- | ---: | --- | ---: |
| `1.csv` | 441,125 | `17.csv` | 589,809 |
| `2.csv` | 533,832 | `18.csv` | 583,952 |
| `3.csv` | 578,172 | `19.csv` | 564,306 |
| `4.csv` | 524,562 | `20.csv` | 579,966 |
| `5.csv` | 450,548 | `21.csv` | 643,051 |
| `6.csv` | 563,588 | `22.csv` | 502,193 |
| `7.csv` | 660,488 | `23.csv` | 593,049 |
| `8.csv` | 502,028 | `24.csv` | 584,935 |
| `9.csv` | 604,163 | `25.csv` | 571,549 |
| `10.csv` | 592,816 | `26.csv` | 571,004 |
| `11.csv` | 598,080 | `27.csv` | 577,416 |
| `12.csv` | 580,052 | `28.csv` | 611,634 |
| `13.csv` | 602,708 | `29.csv` | 449,479 |
| `14.csv` | 613,265 | `30.csv` | 533,581 |
| `15.csv` | 501,388 | `31.csv` | 569,410 |
| `16.csv` | 590,600 | `Summary of the available data.txt` | Field guide, 496 bytes |

The CSVs total 17,462,749 records for August 2025 and 1,776 device identities. Existing FollowMe use is a public directory/one-shot receipt and bounded live observations; it does not contain this month of historical presence.

The profile found no repeated `poll_id`, missing device identity or invalid measurement date. It found 381 invalid/outside-Maldives coordinates, 52,253 receipt clocks preceding device clocks and 466,823 receipts delayed more than an hour. Repeated device/time combinations occur even though database record IDs are distinct; the chunk profile counted 213,814 such repeats within chunks. This is a screening count, not a global duplicate estimate. It motivates distinct-device presence aggregates rather than interpreting sample volume as trips or demand.

Preparation uses measurement time, ignores undocumented speed units and does not export devices, tracks, exact positions or mobile-network fields. It measures device presence within or approximately 500 m from exactly one valid island polygon. Ambiguous and outside-nearshore records remain excluded from island assignment. The approximation and spatial partition counts are retained in the output receipt. Monthly island presence and daily presence count distinct devices; no per-island hourly series is retained. One device can visit multiple islands, so island counts must not be summed as a national fleet total.

This is historical tracked-device coverage, not passenger boardings, ferry supply, vessel-to-RTL-route assignment, live crowding or unmet demand. It adds inspectable island activity context without changing access scores or route travel times.

Implementation: `backend/scripts/prepare_datathon_vessels.py` → `data/public/datathon/vessels.json`.

## MTCC: exclude randomized passenger values

The archive contains one workbook, `MTCC.xlsx`, with these four worksheets:

| Worksheet | Data rows | Coverage |
| --- | ---: | --- |
| `README` | 14 | Column descriptions and explicit sample-data qualifications |
| `bus_monthly` | 180 | Five named routes, January 2023–December 2025; paid, free-of-charge and total passengers |
| `bus_daily` | 1,095 | Three named routes × 365 dates in 2025; same passenger categories |
| `ferry_monthly` | 258 | Eight route codes, January 2023–December 2025 with staggered starts |

The README states: **“all passenger figures are randomly generated and are not actual MTCC / RTL data.”** It also documents built-in seasonality, growth, Friday dips and disruption patterns. The three data sheets have no blanks or exact duplicate rows, but clean structure does not make these observed passenger counts. They are not used to train demand, prioritize investment, calibrate free-of-charge shares or validate the app's predictions. Real route names and codes add no verified calendar or operating information beyond the existing operator sources.

## Team Kandu: compare semantics and skip unsupported additions

Every one of the 14 files is byte-identical to the corresponding file in the user's existing `Downloads/Team_Kandu` folder. The review left that existing folder untouched. File equality proves a duplicate local copy, not active use in the app.

| CSV | Rows | Review outcome |
| --- | ---: | --- |
| `maldivian_destinations.csv` | 27 | Airline destination catalogue. Existing `domestic-air-services.json` has reviewed published sectors and directional qualifications; destination membership is not a flight timetable. |
| `mma_series.csv` | 6,818 | 32 national macroeconomic series across economy, tourism, prices, insurance, fuel imports and services. Additional history is not already all modeled. These geographies, mixed units and frequencies do not establish local traffic, taxi waits or marginal operating costs; no justified calibration gain was demonstrated. |
| `observations.csv` | 9,196 | MBS tables from 2024–2026 editions: aircraft/passengers, census/registered population, parking violations, tourist activity, beds and vehicles. Existing official population/airport inputs overlap some categories; parking/vehicle/tourism histories are additional coarse context. They are not joined to neighbourhood demand, current congestion or access scores. Revision and overlap issues prevent a blind append. |
| `odi_connections.csv` | 58 | Checked island connection pairs without verified service calendars; three origin-coordinate pairs are missing. Existing sea-corridor evidence preserves equivalent indicative connection concepts separately from eligible services. No journey times are created from this list. |
| `parse_log.csv` | 37 | Parsing provenance, not additional observations. Reviewed to interpret the statistics and their table vintages. |
| `qa_flags.csv` | 32 | Source revision, printed-total and arrival/departure imbalance flags. Reviewed as cautions, not additional model records. |
| `rtl_bus_departures.csv` | 1,686 | Remaining departures captured on 10 October. Existing planning inputs and reviewed RTL captures already preserve bounded departures; this is not a full recurring calendar. |
| `rtl_bus_routes.csv` | 28 | Existing operator route-catalogue concept. Seventeen trip-count cells and four fares are blank; no completeness is inferred. |
| `rtl_bus_stops.csv` | 612 | Route/stop membership and locations overlap the app's operator stop captures and coordinate audit. No physical operating verification is added. |
| `rtl_connections.csv` | 615 | Derived ferry pairs and shortest times from the older capture. Current official directional timetables are broader and more recent. |
| `rtl_routes.csv` | 49 | Operator route snapshot from 10 October, superseded for current timetable use by the app's reviewed 17 October sources. |
| `rtl_stops.csv` | 149 | Operator terminal catalogue; 32 blank route-membership cells remain unknown. Catalogue membership is not active service. |
| `rtl_trips.csv` | 390 | Older clock calls. Current `sea-services.json` retains direction, weekdays, validity and full call sequences. |
| `rtl_unscheduled.csv` | 61 | Named routes without schedules. No frequency or crossing time is inferred. |

The app's current sea-service receipt contains 130 directional route records, 120 complete timetable records and 148 islands with complete timetable evidence. This supersedes the older Team Kandu snapshot for service calculations. Existing bus, population and air-service models were checked by their meaning and provenance rather than by CSV filename. The macroeconomic and additional historical statistics were consciously left out because a reliable improvement to the present application was not demonstrated; they are not described as already used.

## Application integration and checks

The compact retained datasets are exposed through the existing dataset catalogue and a curated Mobility Patterns view. Source qualification, period and quality remain visible. These historical panels do not silently alter route speeds, population, access scores, live feeds, infrastructure budgets or predictive demand.

The map's island overview now includes a compact **Recorded travel** section directly below the access index. A separate `/api/v1/datasets/island-mobility?island_id=…` endpoint returns only the selected island's retained profiles. FollowMe observations join by exact national island ID. The three capital taxi zones join through reviewed canonical IDs (`island:1442` Hulhumalé, `island:1443` Malé, `island:1483` Hulhulé), whose catalogue centroids were independently checked against the prepared physical-island polygons. No name matching or snapped pickup/dropoff positions are introduced.

Map users can select a recorded directional taxi corridor and source-clock start hour, inspect its original completed-record count, median and 90th percentile, and optionally frame a muted dashed connection between the island centroids. The line is explicitly schematic, not a driven road route. Same-island and unmatched connections produce no line. Missing hour profiles remain unavailable instead of falling back to an all-day median. The card also shows monthly distinct vessel trackers, observed days and a daily presence chart, retaining gaps as unknown. Each source's own period and limitations remain visible. The map overlay clears when the card closes, the island changes, or presentation/directions/service editing takes over. The presentation itself and all access/planning calculations are unchanged. MACL volumes remain unattributed because the archive has no airport identity lookup.

The importers take explicit archive paths, pin reviewed SHA-256 hashes and preserve source/member receipts. Runtime reads only the prepared aggregate JSON. A future changed release requires another review rather than silently accepting new bytes.

The taxi aggregate was checked independently using Python's CSV reader and statistics calculations: source/completed counts, all hourly and daily counts, median duration and the ratio of aggregate distance to aggregate duration reconciled. A separate STRtree spatial join reconciled all nine corridor counts and the matched-endpoint total; all 36 fare pairs are symmetric. Airport conversion reconciles raw, retained and excluded event totals. Vessel preparation reconciles all 17,462,749 source records, all 31 global daily totals and 1,221 island daily profiles; an alternative spatial calculation reproduced the six demo islands' August 1 results. These checks assess the transformations, not upstream accuracy or representativeness.

Application checks passed: Svelte diagnostics (zero errors or warnings), 90 targeted frontend tests, 26 backend dataset tests, targeted ESLint and Ruff, and the production build. The build retains the existing large-chunk warning. Browser review covered corridor selection, ride/minute switching, selected-hour statistics, airport year/event filtering, opening vessel records, desktop and narrow phone layouts, and a clean production page reload. The phone layout had no horizontal overflow. The API rejects pooled sums/means of taxi medians, percentiles and speeds, and rejects sums of recurring vessel-device counts. The source inventory contains no checksum mismatches or unused source IDs.

The executed companion `scripts/analysis/datathon-review.ipynb` reproduces checks from the retained aggregates and records their fingerprints. It does not claim to replace raw-archive verification. No large CSV-process test suite was added.

Map integration checks passed: 87 targeted frontend tests, 27 backend dataset tests, Svelte diagnostics with zero errors or warnings, targeted ESLint/Ruff, formatting and a production build. Browser checks covered the Hulhumalé–Hulhulé connection, an unavailable hourly profile, Vashafaru's 30 observed days with its missing day retained as unknown, and presentation-mode isolation. At a 375 × 812 viewport the page had no horizontal overflow, and showing a connection reduced the island panel to 400 px so the map connection remained visible above it. The desktop connection and travel inspector were also reviewed together.

## Temporary downloads

The prepared app data and reproduction scripts have no runtime dependency on Downloads. The app retains compact aggregate JSON and source/member hashes; raw operator records are not added to Git.

Cleanup was attempted after verification. Automatic command approval rejected recursive deletion with the reason "blocked by policy", including a literal-path removal after the resolved target was verified. The temporary clone at `C:/Users/cena2/Downloads/maldives-datathon-2026-datasets`, including release archives and temporary profiles, therefore remains for manual removal. The user's pre-existing `Downloads/Team_Kandu` directory was preserved.
