# Public operations and national evidence

The competition profile uses public sources and cached snapshots. It adds weather exposure, public disruption candidates, dated satellite context, and official island population readiness without implying that national routing, observed congestion, or live tracking have been verified. None of these sources automatically alters the observed transport baseline.

## Reproduce the source bundle

```sh
npm run data:setup
npm run data:operations:fetch
npm run data:operations:prepare
npm run data:operations:validate
# Fetch, prepare and validate together:
npm run data:operations
```

The preparation step also uses the existing planning baseline and original MBS population/projection workbooks acquired by `npm run data:fetch` and prepared with `npm run data:prepare`. It uses the OSM extract for uniquely matched island/settlement label positions when Python `osmium` is installed. Run the public baseline preparation first on a clean acquisition checkout. The runtime app needs only the checked-in processed bundle, not Python or the raw workbooks.

Original downloads live in ignored `data/public/archive/operations`. Public compact outputs are `data/public/operations/bundle.json` and `source-manifest.json`. Each source records its URL, publisher, retrieval time, checksum, reference period, units, coverage, licence status, and transformation version. Failed refreshes retain the previous validated source and date with a `cached` state and an explicit gap. The runtime loader also retains its last valid bundle if a replacement is missing or corrupt. An empty upstream result is recorded as empty, not as proof of complete coverage.

The app loads `/api/operations` once from local assets. Upstream portals are not dependencies of routine scenario calculation. Satellite tiles remain online map backgrounds; the annual catalogue and planning data are local. No scheduled scraping, polling, or unrestricted crawler is installed.

## Source findings

| Source                                                                                                                                                                                                                                                                         | Acquired evidence                                                                                                      | Supported interpretation                                           | Remaining limits                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [MMS CAP alert feed](https://cap.meteorology.gov.mv/rss/alerts/) and linked CAP 1.2 messages                                                                                                                                                                                   | Issued alerts, date intervals, polygons, severity, instructions, update/cancel references; feed declares public domain | Publisher weather advisory exposure at a selected date             | Latest 20 records are not an exhaustive warning archive. Exposure does not establish flooded roads or cancelled ferries.                 |
| [Maavehi public road map](https://api.maavehi.gov.mv/api/v1/roadMaps)                                                                                                                                                                                                          | Successful response with an empty data array on 11 October 2026                                                        | No published records in this snapshot                              | Coverage is unknown; this does not mean every road is clear. Future point records need explicit street, direction and validity matching. |
| [RTL bus route details](https://bo.rtl.mv:4455/maldives/api/booking/v2/bus/routedetails)                                                                                                                                                                                       | Refreshed public routes, stops and remaining departures                                                                | Current snapshot audit; source-linked bus evidence gap             | Complete recurring calendars, Friday/holiday exceptions, paired stop arrivals and historical road speeds were not verified.              |
| [RTL vessel route details](https://bo.rtl.mv:4455/maldives/api/booking/v1/vessel/routedetails)                                                                                                                                                                                 | Vilimalé route 119, two official terminals, advertised fare                                                            | Locate explicitly assumed ferry service endpoints                  | Published departures are not paired arrival times. Advertised portal interval does not replace the more detailed official calendar.      |
| [RTL public terminal catalogue](https://bo.rtl.mv:4455/maldives/api/booking/v1/ferries/backofficeinfo)                                                                                                                                                                         | Ferry terminal label positions matched by atoll and island name                                                        | National display position where match is unambiguous               | Terminal catalogue is not a verified active network. Only relevant public labels/coordinates are in processed outputs.                   |
| [MTCC Vilimalé calendar](https://mtcc.mv/wp-content/uploads/2025/12/Vili-male-Ferry-Schedule-2026-V1.pdf)                                                                                                                                                                      | Effective 21 March 2026; weekday, Friday and Saturday/holiday frequency windows                                        | Time-dependent explicit planning assumption with official calendar | Expiry and crossing duration not stated; preserve Friday break and Saturday 17:20–17:30 unknown interval.                                |
| [MBS island projections](https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2026/08/IslandLevelProjection_2022-2030.xlsx) and [Census 2022 island totals](https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2023/09/Island-Level-Indicator-Sheet-Population.xlsx) | Official locality totals and 2026/2030 projected residents                                                             | National population/evidence readiness inset                       | Projection is not measured neighborhood demand. Only Greater Malé has flagship planning coverage.                                        |
| [EOX WMTS catalogue](https://tiles.maps.eox.at/wmts/1.0.0/WMTSCapabilities.xml)                                                                                                                                                                                                | Published 2020 and 2025 Sentinel-2 viewing mosaic layer definitions                                                    | Visual land and settlement context with year toggle                | A mosaic combines acquisition dates and is color corrected. No growth, congestion, blockage or flood measurements are derived.           |

The first prepared bundle represents 208 official/local study rows, with 119 unambiguous display locations. Records without a location remain available in the data but are not plotted. OSM labels and ferry terminals are approximate display positions, not island boundaries or population centroids. Repeated island names are never resolved by guessing their atoll. Flagship island figures come from the existing official study bundle, so national and Greater Malé subdivisions must not be summed together as a new national total.

The national inset highlights Greater Malé and lets users select display points by click or arrow keys. Selected records show 2026/2030 projections and whether routing evidence has been prepared. Search includes records without a matched location. Its latitude/longitude plot contains label points only; it does not invent coastlines, boundaries, national access scores, or transport connections.

## Weather lifecycle

`activeWeatherAlerts` selects Actual/Public messages issued by the requested instant and uses half-open validity `[validFrom, validUntil)`. An Update supersedes its references only after the update was issued. A Cancel withdraws referenced alerts only after the cancellation was issued. Historical originals remain usable before those times. Test/exercise/private messages are excluded. Missing expiry is unresolved, not treated as perpetually active. Polygons reverse CAP latitude/longitude into GeoJSON longitude/latitude and preserve separate areas.

Weather polygons remain `advisory-only`. Selecting an alert can explain exposure; a road closure or ferry cancellation must be a separate explicitly applied scenario with its own evidence/assumption. The default planning date can differ from the feed retrieval date, so zero applicable alerts at that date does not imply no hazards existed.

## Public notice extraction

`POST /api/operations/notices` accepts `{ "sourceUrl": "https://…", "text": "optional selected public excerpt", "title": "optional title" }`. If text is omitted, it fetches a bounded public page. Approved publisher hosts are in `src/lib/operations/notices.ts`. HTTPS, host allowlisting, bounded bodies/timeouts and redirect revalidation prevent the endpoint from becoming an arbitrary URL fetcher. The response includes the evidence URL, checksum, retrieval time, acquisition method, exact supporting excerpt, missing fields, and extraction method.

Without a key, deterministic rules identify possible disruption statements and explicit ISO timestamps. They do not infer a year, timezone, street geometry, edge, direction, or expiry from ambiguous text. A page without a supported disruption produces a low-confidence candidate with gaps. Candidates remain `needs-mapping-confirmation`, `unmatched`, and `candidate-only`; the planner confirms the affected extent and validity while creating a scenario. Displaying a candidate is not evidence of an applied road closure. User-supplied excerpts are identified separately from publisher-fetched content. There is no agency approval or release workflow.

Optional AI can structure a selected public excerpt using the official [Responses API structured output format](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses):

```dotenv
ENABLE_NOTICE_AI=true
OPENAI_API_KEY=your_server_key
NOTICE_AI_MODEL=your_supported_model_id
```

The model must be configured explicitly. Keys stay server-side. The request sets `store: false`, bounds the response, treats page text as untrusted evidence, and requires the supporting excerpt to occur in the input. Unsupported dates and invented evidence fail validation and fall back to clearly identified rules. Missing configuration makes no provider request. AI-assisted output is still a candidate; it does not autonomously geocode, close roads, modify baseline assets, or claim to forecast congestion. No real provider key was required for development; mocked API tests cover the fallback and evidence checks.

## Explicit ferry assumptions

`ferryEvidence` carries the official calendar, source URL, fare, and two verified terminal coordinates. Its official `crossingMinutes` remains null and `routingEligible` false. The scenario helper requires an entered crossing duration and acknowledgement of calendar validity before it creates assumed directions/terminals. Those changes are identified as assumptions and remain undoable. Unknown calendar windows stay unavailable. No connecting line is advertised as an observed vessel track.

## Public-only configuration

`PUBLIC_DATA_ONLY=true` is the default and excludes local FollowMe snapshots from API responses even when vessel data are enabled. Public MPL and airport context remain available under their existing enable flags. Existing authorized FollowMe adapters stay available for an explicit local configuration, but confidential/device trace inputs are not required for the competition profile. Do not turn public context records into neighborhood demand or live vessel positions.

## Annual imagery

`makeAnnualImageryStyle` uses only verified cached 2020/2025 catalogue entries and returns the same `basemap-satellite` identifiers as the existing map system. `AnnualImageryPicker` makes the mosaic year explicit and disables unavailable years. Keep source credits visible after every switch. EOX 2018–2025 map layers are free for noncommercial use with attribution under [CC BY-NC-SA 4.0](https://cloudless.eox.at/pricing). This is a public viewing service with a licence, not a claim that all future deployment purposes are licence-free. Policy brief export continues to use the local atlas.

## Verification

TypeScript tests cover expiry boundaries, issue-time-aware Update/Cancel behavior, source allowlists and redirects, cache failure, missing data, no-key extraction, fabricated supporting text, public-profile exclusion, and year-specific imagery metadata. Python tests cover CAP axis order, cancellation without an info block, allowlisted feed details, empty feeds, failed-refresh retention, and missing-source behavior. These are source/model checks; they do not substitute for local traffic calibration or first-time user testing.
