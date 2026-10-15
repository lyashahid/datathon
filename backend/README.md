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
MOBILITY_DATABASE_URL=optional-server-only-postgresql-connection-string
MOBILITY_COMPUTED_CACHE_MEMORY_MB=64
MOBILITY_COMPUTED_CACHE_DISK_MB=512
MOBILITY_COMPUTED_CACHE_MAX_ENTRIES=256
MOBILITY_COMPUTED_CACHE_PREWARM=true|false
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

### Computed results and optional PostgreSQL

The API reuses exact calculations in bounded memory and compressed files under
ignored `backend/data/runtime/computed-json-v1/`. A fresh clone works with those
local caches automatically. Canonical country geometry, scores and published
passenger history warm in the background after startup. To prepare the full
analytics and three supported island planning views before using them, run from
the repository root:

```powershell
npm run precompute
```

Or from `backend/`:

```powershell
uv run python -m app.cli.precompute --include-planning
```

The command prepares 23 public views, including country snapshots, forecasts,
data analysis, planning opportunities, island profiles and six default health/
education impact calculations. It reports timings and cache status without
printing credentials. `--skip-analysis` omits fitted forecasts and data analysis.
Normal startup warms only the four small country/history views.

For cross-machine reuse, optionally set `MOBILITY_DATABASE_URL` in ignored
`backend/.env`. The example file intentionally contains no connection string.
The optional `psycopg` dependency is installed by normal setup. A Prisma-style
`schema` option becomes a validated PostgreSQL search path; connections require
TLS and have connection/query time limits. The API creates only its own
`mobility_computed_cache` table in that schema and does not require a new
database. Only public snapshot/model results and unchanged baseline impacts
are mirrored. User proposal operations, scenario content, names, budgets and
custom assumptions stay in local caches. Authenticated or cookie-bearing HTTP
requests bypass the public snapshot cache.

Defaults bound memory to 64 MiB/256 entries and compressed disk to 512 MiB/1,024
entries. Each item is at most 32 MiB before compression. Shared storage retains
at most 512 MiB/4,096 entries with a seven-day age limit. Interactive remote
lookups wait at most 10 ms; background mirroring handles slower connections.
A failed database uses local calculations and a 60-second retry cooldown.
Database exceptions and connection strings are not logged. Tests disable the
shared database even when a developer has a local `.env`.

Keys include source content, model implementation, scoring configuration and
all calculation inputs; exact source receipts participate in planning keys.
Different geometry flags, budgets and proposal operations cannot share the
wrong result. Concurrent identical calculations share one computation, including
when the first browser disconnects. Serialized public GETs use `ETag`,
`X-Data-Version` and `private, max-age=0, must-revalidate` for validated browser
reuse. Errors and live weather, traffic, movement and provider responses do not
enter this persistent snapshot cache.

National/graph/planning files are loaded at startup: **restart the backend after
replacing bundled sources or changing model configuration**. Reviewed passenger
source acceptance immediately changes the active source pointer; catalogue,
history, forecasts and analysis then use the new generation. Importing a transit
schedule remains an explicit scenario operation and is never a cached mutation.
Precomputation does not update source dates or fetch new evidence.

The country map uses `GET /api/v1/map/features?layer=islands&simplify_m=25` and
`GET /api/v1/accessibility/summary?compact=true`. The simplified geometry is for
display only; detailed island maps and placement use the original boundary.
Compact scores preserve numeric components and evidence coverage. Fetch
`/api/v1/islands/{id}/profile` for full explanations. Published passenger charts
use `/api/v1/forecasts?history_only=true`, which performs no prediction fitting.

For reproducible cold, repeated and local-disk timings without contacting the
shared database, run `uv run python scripts/benchmark_backend.py` from `backend/`.
It writes ignored `artifacts/qa/backend-performance-after.json`. The broader
runtime/browser method is documented in [the performance guide](../docs/performance.md).

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

## Island access index

`GET /api/v1/accessibility/summary` returns a numeric **0–100 access index for
every island** in the map catalogue. `POST /api/v1/accessibility/score` calculates
one island using the default or a supplied scoring policy:

```json
{"island_id": "island:1443"}
```

Every result includes an `assessment` with `score`, `out_of`, `label`, `summary`,
three plain-language `reasons` (healthcare, schools and transport), component
scores and mapped facility/stop counts, `coverage`, and plain-language
`limitations`. Island profiles also include this assessment under
`accessibility.assessment`. Existing `domains`, `config`, `missing_data` and
`explanation` fields remain available for detailed inspection.

The index describes the available mapped evidence; **78/100 does not mean 78%
of residents are served**. Healthcare and education combine mapped facility
types and distance bands. Transport combines airport, explicit bus-stop and
marine evidence; generic public-transport features are not automatically bus
stops. Unverified ferry services earn no points under the default policy.
Domain weights start equal and change only when an island-specific age
breakdown is available. Demand and density adjustments are planning
assumptions, not measured staffing, capacity or service quality.

Unmapped facilities, missing resident counts, straight-line distance fallbacks
and unverified services are explained separately. Unknown population stays
`null`; it does not erase a facility-derived index or imply zero residents.
An island with no mapped service evidence still receives an index, with a
**Limited evidence** label and a warning that services may exist. The national
average covers the whole island catalogue, including islands without resident
counts; it is not a resident-weighted measure of national access.

Valid frozen health/education route results are reused and assessments are
enriched once in memory. Requests do not rewrite the checked-in source
artifacts or rebuild the national routing graphs.

The analytics priorities request uses
`GET /api/v1/planning/opportunities?include_geometry=false` to receive the same
island numbers, reasons and source metadata without downloading national map
polygons. Its `features` remains an empty GeoJSON FeatureCollection. Omitting the
flag retains the complete map response used by the planning workspace.

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
