# Streets and census coverage

The map now uses a local, source-backed cartographic basemap. Roads, paths,
building footprints and green spaces come from the captured nationwide
OpenStreetMap/Geofabrik extract. They load for the current viewport, so this
works without a third-party tile subscription, API key or external tile request.
Labels use captured road names; parks and buildings provide geographic context.
The overlay switches let the user compare streets, buildings, public facilities
and transport. Proposals and live positions appear within their corresponding
map tools.

| Before                                            | After                                                | Why                                                     |
| ------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------- |
| Island outlines floating on an empty ocean        | Streets, paths, building footprints and green spaces | Makes locations and connections legible                 |
| No street names                                   | Decluttered road labels at island scale              | Supports finding and discussing a site                  |
| Proposals and live positions on every map tool    | Tool-specific overlays                               | Keeps the selected task clear                           |
| Same-named islands left without census data       | Administrative-atoll and locality reconciliation     | Resolves real missing joins without inventing residents |
| Unknown population represented internally as zero | `null`, explicit source year and qualification       | Distinguishes missing data from an observed zero        |

## Local street source

The immutable source is
`backend/data/cache/raw/osm/maldives-latest.osm.pbf`, retrieved 12 October 2026.
Its SHA-256 is
`d4db22dc16c3ef027aa1a3245e4967cee59006f7e2ecebdfc482e5680f824604`.
The source receipt records [Geofabrik's Maldives extract](https://download.geofabrik.de/asia/maldives-latest.osm.pbf).
Map attribution links [OpenStreetMap's ODbL terms](https://www.openstreetmap.org/copyright).

The derived `backend/data/cache/derived/map-context.geojson` contains 53,626
captured OSM ways: 14,287 roads/paths, 38,256 building footprints and 1,083
green-space features. Multipolygon relations are not expanded; OSM coverage
varies. These are cartographic context, not proof of road access, occupancy or
live road conditions. The capture date remains visible on the map.

`GET /api/v1/map/context?bbox=west,south,east,north` returns local GeoJSON and
the source receipt. Requests must use a valid WGS84 rectangle at most one degree
on each side. The response reports matching and returned counts, with a visible
zoom-in message if the 30,000-feature limit truncates a view. A spatial index
keeps the full national artifact on the server.

To regenerate from the preserved source:

```powershell
uv run --directory backend python -m app.cli.map_context
```

The repository generates the artifact automatically if the source PBF exists
and the derived file is missing. If neither source nor derived data exists,
the API reports `unavailable`; it does not substitute invented streets.

## Population reconciliation

`backend/app/data/population.py` reconciles a copy of the captured records at
repository/accessibility startup. The raw workbooks, normalized population
artifact and planning baseline remain unchanged. The analysis/data explorer
can use the same transform to keep geographic records consistent.

The previous match used unique names nationally. Names such as Meedhoo,
Hithadhoo, Maafushi and Dhidhdhoo appear in multiple atolls; legitimate counts
were left unassigned. Matching now uses the census administrative atoll and
OneMap island identity, preferring the residential island within that atoll.
Explicit transliteration pairs are reviewed in the transform; no fuzzy-name
threshold automatically allocates population.

Coverage improves from 105 islands to **190 islands**. Every one of the 186
administrative-island P3 rows is matched, preserving the published total
**236,911 residents**. Four additional Greater Malé islands use disjoint P5
enumeration wards or phases:

| Island    | Census 2022 residents | Basis                                      |
| --------- | --------------------: | ------------------------------------------ |
| Malé      |               137,238 | Henveiru, Galolhu, Machchangolhi, Maafannu |
| Hulhumalé |                65,714 | Phase 1 and Phase 2                        |
| Vilimalé  |                 6,755 | Vilimaale enumeration locality             |
| Hulhulé   |                   802 | Hulhule enumeration locality               |

These are **2022 census counts**, not 2026 projections or WorldPop estimates.
The whole-Malé city total (211,908) and the multi-island harbour row (1,399)
remain unallocated to an individual island. Atoll/city age rows in P6 are not
treated as island demographic observations. P3 and P5 totals are alternative
tables for the same census population and are not added together. Canonical P5
record IDs include atoll to distinguish same-named islands; original IDs remain
in `captured_record_id` and published identifiers in `source_record_id`.

Profiles expose `status`, `total`, `year`, `source_url`, `localities` and
`qualification`. Missing island-specific counts are `null`, including resort
and industrial islands without an individual count in these captured tables.
They are not assumed to have no residents. Accessibility explicitly marks
missing population and omits population-pressure claims.

The national accessibility summary and recommendation baselines now share the
current scoring artifact. The artifact records the population reconciliation
version and SHA-256 fingerprints of census, island, facilities, transport,
demand-anchor and land/marine graph inputs. A missing or stale receipt triggers
one calculation per service reload; it cannot silently reuse pre-reconciliation
scores. The pre-change derived artifact is retained at
`backend/data/review/accessibility-before-census-geography.json`.

The complete 186-row identity audit and source receipts are retained at
`backend/data/review/population-geography-audit.json`. Primary workbook
sources are [MBS P3](https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2023/07/P3.xlsx)
and [MBS P5](https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2023/07/P5.xlsx).

## Verification

`node scripts/verify-map-context-browser.mjs` exercises the actual local API and
MapLibre rendering at 1440px and 390px widths. Its report and screenshots live
in `artifacts/qa/map-context/`. All nine checks pass: real named streets and
buildings in Malé, Hulhumalé and Hithadhoo; functional street/building switches;
source receipts and bounded viewport queries; 190-island census coverage;
unknown resort population; reuse of an unchanged viewport while stationary or
refocusing the selected island; and a mobile map with road labels and no horizontal
overflow. The 390px Hulhumalé view renders 1,033 roads and 2,616 buildings with
six named road labels. Backend tests cover atoll collisions, source-preserving
identities, city aggregates, disjoint wards, missing counts and stale scoring
receipts.
