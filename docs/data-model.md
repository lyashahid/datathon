# Data model and ingestion

Mobility Sandbox MV runs on plain files: GeoJSON for anything with a location, JSON for
tables. No spatial database is needed. Every source is converted into the **canonical
schemas** below by an **input adapter**; the application only ever reads canonical data.

The official Datathon dataset is **not yet integrated**. Nothing here assumes its schema;
when it arrives, it gets its own adapter (or a column map for an existing one).

## Canonical schemas

Types live in `src/lib/types/domain.ts` (infrastructure, routes) and
`src/lib/analysis/ingestion/types.ts` (demographics, reports). Coordinates are always
**EPSG:4326, `[longitude, latitude]`**, rounded to 6 decimals (~0.1 m).

### Infrastructure: `infrastructure.geojson`

A GeoJSON `FeatureCollection` with a `dataset` member, one `Point` feature per facility.

| Field                 | Type                                                                                                  | Notes                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| `id`                  | string, unique                                                                                        | Stable across imports (e.g. `osm-node-1001`, `svc-s1`)   |
| `properties.name`     | string                                                                                                | Generated descriptively if the source has none (counted) |
| `properties.type`     | `bus_stop`, `bus_terminal`, `ferry_terminal`, `airport`, `hospital`, `school` or `government_service` |                                                          |
| `properties.status`   | `existing`, `proposed` or `disabled`                                                                  | Imports are always `existing`                            |
| `properties.source`   | `{ provenance, dataset, syntheticFields[], note?, reference? }`                                       | Provenance is declared by the manifest, never inferred   |
| `properties.metadata` | scalar key/values                                                                                     | `island` (from a spatial join), `atoll`, `operator`, …   |

`provenance` is one of `observed` (real data), `demo`, `assumed` or `simulated`. The UI tags
anything that is not `observed`.

### Routes: `routes.geojson`

`LineString` features with `name`, `mode` (`bus` or `ferry`), `status`, `stopIds` (canonical
infrastructure ids, in order), `source` and `metadata`. Stop ids that match no imported
facility are removed and counted.

### Demographics: `demographics.json`

`{ dataset, records: DemographicRecord[] }`, one record per small area:

| Field                                       | Type                 | Notes                                                      |
| ------------------------------------------- | -------------------- | ---------------------------------------------------------- |
| `areaId`                                    | string, unique       |                                                            |
| `name`, `island`                            | string               | `island` is required                                       |
| `atoll`                                     | string or null       |                                                            |
| `population`                                | non-negative integer | Required                                                   |
| `children`, `workingAge`, `olderPopulation` | integer or null      | If all three are given they must sum to `population` (±2%) |
| `households`                                | integer or null      |                                                            |
| `centroid`                                  | `[lng, lat]` or null | Representative point                                       |
| `provenance`, `dataset`                     |                      | From the manifest                                          |

This is a generic small-area table, **not** an official census schema. A real census file
is mapped onto it with a column map (`DemographicColumns`), not by renaming its columns.

## Input adapter pattern

```
raw source → validate → normalise → transform CRS → deduplicate → canonical records
                                                                 → data/processed/  → runtime adapter
```

`src/lib/analysis/ingestion/pipeline.ts` (`runPipeline`) applies the same steps to every
source. An adapter only supplies `convert` (validate + normalise + CRS for one record) and a
duplicate rule. Bad records are **counted, never thrown**: one malformed row never stops an
import.

| Adapter id                  | Module                 | Input                                                                           |
| --------------------------- | ---------------------- | ------------------------------------------------------------------------------- |
| `osm-infrastructure`        | `osmInfrastructure.ts` | Overpass JSON (`out center`) or OSM GeoJSON; tag rules in `config/ingestion.ts` |
| `essential-services`        | `essentialServices.ts` | CSV facility table + column map; category map in config                         |
| `transport-routes`          | `transportRoutes.ts`   | GeoJSON LineStrings (`mode` or OSM `route` tag)                                 |
| `census-style-demographics` | `demographics.ts`      | CSV small-area table + column map                                               |

Supported input CRS: `EPSG:4326`, `EPSG:3857` (Web Mercator) and `EPSG:32643` (UTM 43N,
which covers the Maldives). Output is always EPSG:4326.

**Deduplication.** Records with the same id, or facilities of the same type closer than
`INGESTION_RULES.duplicateDistanceM` (25 m), are one facility mapped twice (e.g. an OSM
node and the building around it). The first occurrence wins, so the manifest order
decides precedence across sources. Routes with identical geometry and mode are duplicates;
demographic areas are deduplicated by `areaId`.

**Island assignment.** Island names come from a point-in-polygon join. Until official island
boundaries are imported, the CLI uses the demo outlines in `h3DemoData.ts`, so features
outside them are accepted with an `island` warning.

## Validation report

`data/processed/ingestion-report.json` holds one report per source plus a merge check:

| Field             | Meaning                                                                            |
| ----------------- | ---------------------------------------------------------------------------------- |
| `processed`       | Records read from the source                                                       |
| `accepted`        | Records written to canonical output                                                |
| `rejected`        | Records dropped (`processed = accepted + rejected`)                                |
| `missingFields`   | Field → count, for required (rejected) and optional (accepted with a warning) gaps |
| `invalidGeometry` | Missing, non-numeric or out-of-range coordinates, wrong geometry type              |
| `invalidValues`   | Unmapped tags or categories, impossible counts, inconsistent totals                |
| `duplicates`      | Rejected as duplicates within the source                                           |
| `issues[]`        | `{ index, reason, detail, warning }` for every record-level finding                |
| `crossCheck`      | Duplicates across sources; unknown route stops removed                             |

## Running it

```sh
npm run ingest                                      # fixtures → data/processed/
npm run ingest -- path/to/manifest.json out/dir     # your own sources
```

A manifest names the dataset (including its provenance) and lists sources in precedence
order; see `data/fixtures/ingestion/manifest.json`. The fixtures there are hand-made and
deliberately include bad records.

To serve processed data instead of the bundled demo set, set `BASELINE_SOURCE=processed`.
`src/lib/server/data/processedSource.ts` reads `data/processed/` with the same decoders and
cross-checks as the sample data, so the rest of the app is unaffected.

## Not yet wired

- **Demographics at runtime.** The H3 grid still uses the demo population model
  (`h3DemoData.ts`). Processed demographic records are validated and written but not yet
  distributed onto H3 cells; that step belongs with the official population data.
- **Official dataset.** Blocked until the files are available.
