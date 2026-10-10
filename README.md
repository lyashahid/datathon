# Mobility Sandbox MV

A 2D interactive transport and infrastructure planning simulator for the Maldives.

## Getting started

```sh
npm install
npm run dev        # http://localhost:5173
```

| Script           | Purpose                                    |
| ---------------- | ------------------------------------------ |
| `npm run dev`    | Development server                         |
| `npm run check`  | Svelte + TypeScript type check             |
| `npm run lint`   | Prettier check + ESLint                    |
| `npm test`       | Unit tests (Vitest)                        |
| `npm run build`  | Production build                           |
| `npm run ingest` | Run the data ingestion pipeline (fixtures) |

## Environment variables

Declared and validated in `src/env.ts`; see `.env.example`. All are optional.

| Variable           | Exposed to browser | Description                                                 |
| ------------------ | ------------------ | ----------------------------------------------------------- |
| `MAP_STYLE_URL`    | yes                | MapLibre style JSON URL tried before the built-in basemaps. |
| `WEATHER_PROVIDER` | no                 | Weather provider id; defaults to `open-meteo` (keyless).    |
| `BASELINE_SOURCE`  | no                 | `sample` (default) or `processed` (`data/processed/`).      |

### Basemap fallback

No API key is needed. The map tries, in order:

1. `MAP_STYLE_URL` (if set)
2. [OpenFreeMap](https://openfreemap.org) Dark
3. [CARTO](https://carto.com/basemaps) Dark Matter
4. A plain offline background (the app stays usable; a notice is shown)

Whatever style loads is forced to 2D: fill-extrusion, hillshade and terrain layers, DEM sources,
sky and globe projection are removed, and pitch/rotation are disabled.

## Data

Baseline infrastructure comes from `data/sample/*.geojson`, a small **synthetic demo dataset** for
Greater Malé. Names reference real places, but positions are approximate and numeric/operational
attributes are invented; every record carries `source.provenance: "demo"` and lists its invented
metadata keys in `source.syntheticFields`, which the inspector tags as DEMO.

Data flow (each layer is replaceable on its own):

1. `src/lib/server/data/baselineSource.ts` — `BaselineSource` interface; currently the sample files.
2. `src/lib/data/{infrastructure,routes}.ts` — GeoJSON → domain decoders (validated) and client fetchers.
3. `/api/infrastructure`, `/api/routes` — JSON endpoints.
4. `src/routes/+page.ts` → frozen `Baseline` store → map and inspector. UI never reads raw files.

To use real data, run it through the ingestion pipeline (`npm run ingest`, see
[docs/data-model.md](docs/data-model.md)) and set `BASELINE_SOURCE=processed`, or implement
`BaselineSource` for a new source.

## Weather

`/api/weather` and `/api/weather/marine` return normalised `WeatherSnapshot` / `MarineSnapshot`
records (`src/lib/types/weather.ts`) from a pluggable provider (`src/lib/server/weather/`).
Open-Meteo is the first provider (keyless; attribution shown in the HUD). Responses are cached
in memory for 10 minutes per rounded location; upstream failures return HTTP 503 and the HUD shows
"Weather unavailable" without affecting the planning simulator. Weather does not alter
accessibility scores.

## Documentation

| Document                                                 | Contents                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------- |
| [docs/metric-definitions.md](docs/metric-definitions.md) | Every metric shown, its formula, assumptions and a verified example |
| [docs/demo-plan.md](docs/demo-plan.md)                   | Seven-minute presentation script and fallback path                  |
| [docs/data-model.md](docs/data-model.md)                 | Canonical schemas and the ingestion pipeline                        |
| [docs/performance.md](docs/performance.md)               | Profiling results and optimisations                                 |
| [docs/qa-report.md](docs/qa-report.md)                   | Correctness and reliability pass                                    |
| [docs/review.md](docs/review.md)                         | Pre-datathon engineering review (P0–P3)                             |

**Demo Mode:** click **Demo** in the top bar for a guided, 13-step walkthrough that drives the real
simulator (no pre-baked results). **Restart Demo** returns to a known state.

## Project layout

```
data/sample/        demo GeoJSON (infrastructure, routes)
src/
  env.ts            environment variable declarations
  lib/
    components/     shell UI (hud, sidebar, inspector, toolbar, layout)
    config/         tunable constants (map extents, basemaps, symbology, tools, layers)
    data/           GeoJSON decoders and client data adapters
    server/data/    baseline data sources (server-only)
    map/            MapLibre integration — the only code that touches the map library
    stores/         UI state, map state and the immutable baseline
    types/          domain, scenario, map and UI types
  routes/           SvelteKit pages
```
