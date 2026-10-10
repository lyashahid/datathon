# Ingestion fixtures

Small, hand-made inputs that exercise the ingestion pipeline (`npm run ingest`). They are
**not real data**: names reference Greater Malé places, positions are approximate, and every
count is invented. Each file deliberately contains bad records (missing fields, invalid
geometry, duplicates, unsupported categories) so the validation report has something to show.

| File                | Adapter                     | Shape                                   | CRS        |
| ------------------- | --------------------------- | --------------------------------------- | ---------- |
| `osm-overpass.json` | `osm-infrastructure`        | Overpass API JSON (`out center`)        | EPSG:4326  |
| `services.csv`      | `essential-services`        | Generic facility table                  | EPSG:32643 |
| `routes.geojson`    | `transport-routes`          | GeoJSON LineStrings                     | EPSG:4326  |
| `demographics.csv`  | `census-style-demographics` | Generic small-area table (not official) | EPSG:4326  |

`manifest.json` lists them; the column names in `demographics.csv` are the project's own and
do not represent any official census schema.
