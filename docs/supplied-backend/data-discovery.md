# Mobility Sandbox MV — Phase 1 Data Discovery

Generated: `2026-10-12T13:44:02.184173+00:00`

Population scope: **MBS Census 2022 P3 only**.

| Source | Status | Result |
|---|---|---|
| onemap | ok | feature_count=1561 |
| mbs | ok | file_size_bytes=37974 |
| health | ok | record_count=601 |
| education | ok | detail_pages_fetched=220 |
| caa | ok | html_table_record_count=19 |
| lga | ok | completed |
| osm | ok | file_size_bytes=3652811 |

## Interpretation rules

- This phase acquires raw sources and reports what is available.
- It does not normalize names or merge official records with OSM yet.
- Official identity and statistics remain authoritative.
- Unmatched and ambiguous records are not silently discarded.
- OSM is acquired from the national PBF; it is not a runtime bulk-query dependency.

## Source access review

- **onemap:** Machine-readable ArcGIS REST JSON and paginated GeoJSON.
- **mbs:** Direct XLSX download; parsed with openpyxl/pandas.
- **health:** Public server-rendered HTML with pagination; professionals JSON endpoint is optional enrichment.
- **education:** HTML directory plus public HTML school detail pages.
- **caa:** HTML certification table plus direct PDF download.
- **lga:** HTML council page plus XLSX export; current export is councilor-member data.
- **osm:** Direct national PBF download; parsed locally with osmium.

## Reconciliation and unresolved-data review

### Records expected to need OSM geometry or spatial assignment
- Health facilities without official coordinates
- Education schools without official coordinates
- Council facilities without usable official coordinates
- CAA aerodromes where official coordinates or geometry require matching
- OSM transport features requiring OneMap island assignment

### Deferred matching
- MBS P3 uses atoll codes and locality names; reconciliation to OneMap is deferred to Phase 2.
- HEMS HTML records do not expose a structured island field in the discovery parser.
- Education detail fields require source-specific extraction and island reconciliation in Phase 2.
- LGA council facility identity requires a council registry source separate from the councilor export.
- CAA airport coordinates and OneMap island matching require normalization and review.

### Automation limits
- No source required authentication or bypassing access controls during discovery.
- No low-confidence fuzzy match was automatically accepted.
- No live aircraft or vessel providers were queried in Phase 1.
