# Mobility Sandbox MV Backend

FastAPI backend for the Mobility Sandbox MV project.

## Clone and run

Use the [root quick start](../README.md) to install dependencies and start the
frontend and backend together. **No `.env` file, API key, or environment variable
is required.** The repository includes the public planning snapshots and the
precomputed national, routing and map artifacts used by the application.

The API binds to `127.0.0.1:8000` by default. The frontend's server proxy uses
that address automatically; browser clients do not need separate CORS settings.

## Standalone backend requirements

- [uv](https://docs.astral.sh/uv/getting-started/installation/)
- Python 3.14.x (`uv` can download the required interpreter)

The project currently targets the installed Python minor version, `3.14`.

## Install dependencies

From this directory:

```powershell
uv sync --locked --dev
uv run playwright install chromium
```

## Run the API

```powershell
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Health check:

```text
http://127.0.0.1:8000/health
```

Interactive API documentation:

```text
http://127.0.0.1:8000/docs
```

## Run tests

```powershell
uv run pytest
```

## Configuration

All settings have usable defaults. To customize them, copy
[`.env.example`](.env.example) to `backend/.env` and change only the values you
need. The backend always reads that file relative to its own source directory,
even when launched from a different shell directory. Process environment values
take precedence. `MOBILITY_DATA_DIR` and `MOBILITY_PUBLIC_DATA_DIR` relative paths
are also resolved from `backend/`, so they are portable between machines.

The main settings use the `MOBILITY_` environment-variable prefix. Supported
values include:

```text
MOBILITY_ENVIRONMENT=development|test|production
MOBILITY_HOST=127.0.0.1
MOBILITY_PORT=8000
MOBILITY_LOG_LEVEL=DEBUG|INFO|WARNING|ERROR|CRITICAL
MOBILITY_DATA_DIR=path/to/data
MOBILITY_PUBLIC_DATA_DIR=path/to/project/data/public
MOBILITY_LIVE_AIRCRAFT_ENABLED=true|false
MOBILITY_LIVE_VESSEL_ENABLED=true|false
MOBILITY_LIVE_BUS_ENABLED=true|false
MOBILITY_LIVE_FOLLOWME_ENABLED=true|false
MOBILITY_LIVE_FOLLOWME_MIN_INTERVAL_SECONDS=1.0
MOBILITY_LIVE_FOLLOWME_CATALOGUE_TTL_SECONDS=900
MOBILITY_LIVE_CACHE_TTL_SECONDS=60
MOBILITY_LIVE_POLL_INTERVAL_SECONDS=60
```

The normal same-origin frontend proxy does not require CORS. A separate direct
browser client needs its own deliberately configured deployment.

Default source data is under `data/public/` and backend caches are under
`backend/data/`. No path refers to the original developer's Downloads or project
directory. Do not commit a private `.env` file or credentials; the example files
contain only public, optional settings.

### Included snapshots and local state

The clone runs directly from these checked-in inputs:

| Location | Purpose |
| --- | --- |
| `data/public/` | Planning baseline, passenger histories, timetables, calibration and source evidence |
| `backend/data/cache/normalized/` | National island, facility, population and transport catalogues |
| `backend/data/cache/graphs/` | Precomputed land, marine and airport routing graphs |
| `backend/data/cache/derived/` | Accessibility scores, demand anchors, national summary and OSM roads/buildings |
| `backend/vendor/vela_api/data/` | Pinned Vela calibration and browser collector scripts |

The corresponding source manifests and checksum metadata remain with the
snapshots. Acquisition originals in `data/raw/` and
`backend/data/cache/raw/` are not needed for normal use and are not distributed
with the clone. Live-provider caches, uploaded local data, notices SQLite files,
and generated forecast receipts are local state and are created as needed.
Saved proposals in browser storage belong to that browser and are not copied
by cloning Git.

The following services need an internet connection when requested: base-map
tiles, weather, live aircraft/vessel feeds, FollowMe, and Vela places/directions/
reviews. They do not require keys in the default local setup. Upstream rate
limits, blocking or missing coverage are reported as unavailable/partial data;
the application does not invent observations. RTL's separately authorized bus
adapter stays disabled by default. Snapshot-based analytics, forecasts and
planning do not depend on a live-provider response.

## Policy expansion and Vela

The parent API includes `/api/v1/forecasts`, `/datasets`, `/planning`, `/conditions` and
`/operations`. Source planning and passenger histories are read from `data/public`; notices
are durable SQLite records in `backend/data/runtime/notices.sqlite`, and frozen forecast
receipts are in `backend/data/metadata/forecast-issues`. Source artifacts are never rewritten.

Vela is mounted at `/api/v1/places` with its own complete docs at `/api/v1/places/docs`.
The parent lifespan opens and closes its transport and Chromium collectors. Install the
browser with `uv run playwright install chromium` for standalone setup; the root
setup command installs it automatically. Browser reviews are enabled by default
in the integrated API and Chromium starts only when a review request needs it.
Set `VELA_BROWSER_ENABLED=false` in the optional `backend/.env` to disable that
collector. Missing Chromium is reported as a feature-specific `503` rather than
preventing API startup. Optional `VELA_API_KEY`, `VELA_CACHE_TTL`, `VELA_RATE_LIMIT_PER_MINUTE`
and other original settings are documented in [the preserved Vela README](vendor/vela_api/README.md).
The frontend proxy forwards the caller key without exposing it to browser JavaScript.
Read [the policy implementation report](../docs/policy-expansion.md) for model coverage.

## Phase 1 data discovery

Acquire and inspect all required public sources:

```powershell
uv run python -m app.cli
```

Run selected sources only:

```powershell
uv run python -m app.cli --source onemap --source mbs
```

The command stores raw responses under `backend/data/cache/raw/` and writes:

```text
docs/data-discovery.md
docs/data-discovery.json
```

Population reconciliation uses Census 2022 P3 island totals and explicitly
matched, disjoint P5 city wards/phases where needed. P5/P6 breakdowns retain
their source context; overlapping totals are not added together and unknown
island populations remain unavailable. Inspect `/api/v1/islands/{id}` and the
source manifests for the actual coverage of a selected island.

## Phase 3 routing prewarm

Normalization also builds immutable routing artifacts from the cached OSM PBF:

```powershell
uv run python -m app.cli.normalize
```

Artifacts are written under `data/cache/graphs/` and include per-island land
graphs, marine route candidates, airport access gateways, and demand anchors.
The routing API is available at:

```text
POST /api/v1/routing/land
POST /api/v1/routing/marine
```

Marine edges derived only from OSM ferry relations are disabled for verified
passenger routing unless `include_unverified=true` is explicitly requested.

## Phase 4 accessibility scoring

Precompute the default national accessibility artifact:

```powershell
uv run python -m app.cli.accessibility
```

Endpoints:

```text
POST /api/v1/accessibility/score
GET  /api/v1/accessibility/summary
```

The default policy uses equal health, education, and transport weights;
500m/1km/3km distance bands; zero for missing data; distance-only scoring; and
excludes unverified ferry routes. The `POST` endpoint accepts a complete
validated policy override.
Flight schedules are not inferred from airport geometry.

## Phase 5 scenario simulation

Run or compare immutable scenario worlds:

```text
POST /api/v1/simulation/run
POST /api/v1/simulation/compare
```

Supported operations include bus stops, ferry terminals and routes, parking and
park-and-ride, mobility hubs, road closures, pedestrian connections, airport
access, and weather/disruption permissions. Each request starts from the unchanged cached
baseline; scenario changes are applied only to a deep-cloned effective world.

## Phase 6 recommendations

Recommendations use a deterministic candidate-generation, candidate-simulation,
and ranking pipeline:

```text
POST /api/v1/recommendations
```

The request selects the strategy with `type`, such as `bus_stop`,
`ferry_route`, or `mobility_hub`.

Each result includes a serializable scenario, simulated delta, score, expected
benefit, reason, trade-offs, assumptions, confidence, and planning-screening
disclaimer. Ranking defaults to 70% expected benefit and 30% confidence; the
policy and candidate limit can be overridden in the request.

## Map-ready GeoJSON

Static islands, geocoded infrastructure, and OSM transport features can be
returned as one GeoJSON `FeatureCollection`:

```text
GET /api/v1/map/features?layer=all&island_id=island:1
```

Supported layers are `all`, `islands`, `infrastructure`, and `transport`.
Coordinates retain GeoJSON order: `[longitude, latitude]`. Records without
coordinates are excluded by default and reported in `summary.unlocated_count`;
use `include_unlocated=true` to include them with `geometry: null`.

The complete audit is also stored at
`data/cache/normalized/facility-mapping-review.json`.

Same-island provisional matches are available in the map for MVP coverage and
are explicitly marked `osm_provisional_review_required`; they remain excluded
from deterministic accessibility scoring until reviewed.

## Phase 7 live movement

Live data is optional, transient, and never affects deterministic scoring:

```text
GET /api/v1/live/status
GET /api/v1/live/snapshot
GET /api/v1/live/stream
```

The default adapters are ADSB.lol aircraft, OpenWaters vessel positions,
FollowMe public vessel positions, and Facha AIS fallback for provider errors or
small-radius queries. `/live/snapshot` is the unified location response across
aircraft, vessels, and buses. FollowMe positions are requested only for
supplied vessel IDs or served from the short-lived latest-position cache;
FollowMe does not provide an anonymous bounding-box endpoint. RTL bus support
is implemented behind an authorization/enablement flag and remains disabled by
default. Empty or partial coverage is returned as a normal provider status.

## Phase 8 prewarm and readiness

The distributed clone already contains the artifacts needed to run. Prewarm is
a maintainer rebuild operation, not a prerequisite for starting the application.
Only use offline prewarm if acquisition originals are present locally; those
files are intentionally excluded from Git. With that existing raw cache, run:

```powershell
uv run python -m app.cli prewarm --offline
```

Refresh all public sources and rebuild everything:

```powershell
uv run python -m app.cli prewarm --all
```

The command normalizes data, rebuilds routing graphs, recalculates the default
accessibility artifact, validates required checksums and structures, and writes
`data/metadata/prewarm-report.json`.
