# Mobility Sandbox MV — Backend API Implementation Plan

**Status:** Backend Phase 8 complete — backend implementation complete

**Revision:** 2 — added dataset relationships, OSM extraction, aircraft data,
and vessel data connections.

**Backend:** Python FastAPI  
**Deployment target:** Local laptop, localhost-only by default  
**Persistence:** Atomic file cache; no database for the MVP

---

## 1. Backend architecture

Use a local, database-free FastAPI service:

```text
FastAPI API
   ├── API routers
   ├── Domain services
   │   ├── data normalization
   │   ├── routing
   │   ├── accessibility scoring
   │   ├── scenarios
   │   └── recommendations
   ├── Provider adapters
   ├── File cache/repositories
   └── CLI prewarm tools
```

Core principles:

- Python FastAPI
- Pydantic models
- Immutable baseline data
- Scenario changes represented as operations
- Local atomic file cache
- No PostgreSQL, Redis, Celery, or Kafka
- No external network calls during normal API requests
- OSM PBF processed during prewarm, not per request
- One shared simulation engine for manual scenarios and recommendations
- Unapproved policy weights and thresholds remain configuration blockers

## 2. Proposed backend structure

```text
backend/
├── app/
│   ├── main.py
│   ├── api/
│   │   ├── dependencies.py
│   │   └── routes/
│   │       ├── health.py
│   │       ├── islands.py
│   │       ├── infrastructure.py
│   │       ├── transport.py
│   │       ├── routing.py
│   │       ├── accessibility.py
│   │       ├── simulation.py
│   │       ├── recommendations.py
│   │       └── live.py
│   ├── config/
│   ├── models/
│   ├── data/
│   │   ├── providers/
│   │   ├── cache/
│   │   ├── normalize/
│   │   └── matching/
│   ├── routing/
│   │   ├── land.py
│   │   ├── marine.py
│   │   └── air.py
│   ├── accessibility/
│   ├── simulation/
│   ├── recommendation/
│   ├── live/
│   └── cli/
├── tests/
├── pyproject.toml
└── README.md
```

## 3. API contract

Base URL:

```text
http://127.0.0.1:8000/api/v1
```

### Health

```http
GET /health
```

### National data

```http
GET /api/v1/islands
GET /api/v1/islands/{id}
GET /api/v1/islands/{id}/profile
GET /api/v1/national/summary
GET /api/v1/map/features
```

### Accessibility and routing

```http
POST /api/v1/accessibility/score
GET /api/v1/accessibility/summary
POST /api/v1/routing/land
POST /api/v1/routing/marine
```

### Simulation

```http
POST /api/v1/simulation/run
POST /api/v1/simulation/compare
```

### Recommendations

```http
POST /api/v1/recommendations
```

### Live data

```http
GET /api/v1/live/status
GET /api/v1/live/snapshot
GET /api/v1/live/stream
```

## 4. Domain models

The backend will define validated models for:

- `Island`
- `Facility`
- `MarineFacility`
- `VesselServiceMapping`
- `Airport`
- `AircraftObservation`
- `TransportEdge`
- `TransportNode`
- `DemandAnchor`
- `AccessibilityScore`
- `Scenario`
- `ScenarioOperation`
- `EffectiveWorld`
- `SimulationResult`
- `Recommendation`
- `LiveProviderStatus`
- `LiveEvent`
- `Provenance`

Each record will retain:

- stable internal ID,
- original source identity,
- source provenance,
- geometry quality,
- matching confidence,
- data availability flags.

## 5. File-cache design

```text
data/
├── cache/
│   ├── raw/
│   ├── normalized/
│   ├── graphs/
│   └── derived/
└── metadata/
    └── cache-index.json
```

Every downloaded source will use:

```text
download → temporary file → validate → checksum → atomic rename
```

Cache metadata will include:

- source URL,
- retrieval time,
- HTTP status,
- content type,
- checksum,
- parser version,
- schema version,
- freshness status.

A failed refresh will preserve the last-known-good cache.

## 6. Dataset relationship model

### 6.1 Central entity: Island

OneMap is the authoritative source for island identity and official island
geometry. Every normalized record that can be assigned to an island references:

```text
island_id = island:{onemap_object_id}
```

Display names are never used as primary keys.

```text
OneMap Island
    ├── Population observations
    ├── Official facilities
    ├── OSM-derived geometry and features
    ├── Transport nodes and edges
    ├── Demand anchors
    ├── Accessibility scores
    └── Scenario impacts
```

### 6.2 Dataset cardinality

| Dataset | Relationship | Authority/use |
|---|---|---|
| OneMap islands | One island → many related records | National geographic backbone |
| MBS population | One island → many yearly observations | Official population weighting |
| HEMS facilities | One island → many facilities | Health access |
| Education schools | One island → many schools | Education access |
| LGA councils | One island → one or more council records | Government access |
| CAA aerodromes | One island → zero or more airports | Domestic air access |
| OSM features | One island → many spatial features | Roads, stops, terminals, demand geometry |
| Transport nodes | One island → many nodes | Stops, terminals, airports, hubs |
| Transport edges | Node → node | Land, marine, air, and pedestrian connectivity |
| Demand anchors | One island → many anchors | Approximate population distribution |
| Accessibility scores | One island → many versioned results | Derived metrics |
| Live events | Provider event → optional island/node association | Visualization only |

### 6.3 Source authority rules

- OneMap owns island identity, name, atoll, category, usage, area, centroid,
  and official polygon geometry.
- MBS owns population values. Missing or unmatched population remains `null`.
- HEMS, Education, LGA, and CAA own official facility identity and status.
- OSM supplies roads, transport features, demand geometry, and fallback
  geometry, but never silently replaces official identity data.
- ADSB.lol supplies live aircraft positions only; it does not define airports.
- OpenWaters and Facha supply transient vessel positions only; they do not
  define ferry routes, schedules, terminals, or accessibility scores.

### 6.4 OSM relationships

The OneMap polygon is used to spatially assign OSM features to an island.
OSM objects retain their own stable source identity:

```text
osm:{node|way|relation}:{source_id}
```

The OSM extraction will include:

- road and path ways,
- access and one-way tags,
- bus stops and platforms,
- ferry terminals, piers, and ferry relations,
- residential landuse and settlement/place features,
- parking and taxi features,
- service and airport geometry candidates.

OSM-to-official matching stores:

```text
official_record_id
osm_object_id
match_method
confidence
geometry_source
review_status
```

Unresolved official records remain available with `geometry_quality` set to
`island_level` or `unresolved`.

### 6.5 Transport relationship model

Transport is represented using nodes and edges rather than only direct
island-to-island links:

```text
TransportNode
    ├── road/intersection node
    ├── bus stop or station
    ├── ferry terminal or pier
    ├── airport
    └── mobility hub

TransportEdge
    ├── from_node_id
    ├── to_node_id
    ├── mode
    ├── distance_m
    ├── geometry
    ├── permissions/status
    └── source
```

This supports land routing, ferry connectivity, airport access, pedestrian
connections, and scenario-added or removed links.

### 6.6 OSM-backed transport relationships

OSM can directly support several static transport relationships. The backend
must preserve the distinction between an OSM-supported feature and an
officially verified service.

| Transport type | OSM evidence | Backend relationship | Limitation |
|---|---|---|---|
| Walking | `highway=*`, foot access tags, paths and pedestrian ways | OSM ways become walking edges | Does not prove accessibility quality or safety |
| Bicycle | `highway=*`, bicycle access tags, cycleways, bicycle parking | OSM ways become bicycle edges | Does not provide bicycle demand or policy suitability |
| Taxi/private vehicle | Drivable `highway=*`, motor-vehicle access, parking and taxi features | OSM ways become car/taxi edges; parking/taxi features become nodes | Does not provide traffic or travel-time conditions |
| Bus-compatible movement | Drivable roads plus `highway=bus_stop`, `public_transport=platform`, `public_transport=stop_position`, `amenity=bus_station` | Roads become bus edges; stops become transport nodes | Does not prove active service, frequency, or schedule |
| Public ferry | `amenity=ferry_terminal`, `route=ferry`, piers and passenger-relevant harbours | Terminals become marine nodes; ferry relations become marine edges | Does not prove current operation or timetable |
| Airport access | Roads, paths, parking and terminal geometry near CAA airports; `aeroway=*` candidates | OSM creates first/last-mile access edges to official CAA airport nodes | CAA remains authoritative for airport identity and status |
| Seaplane access | Possible OSM `aeroway=*` or terminal/pier geometry | Candidate geometry only until verified | Must not be treated as an active seaplane service automatically |
| Park-and-ride/interchange | `amenity=parking`, `amenity=taxi`, bicycle parking, nearby stops/terminals | Candidate interchange or mobility-hub relationships | Planning candidate, not an approved facility |

The following transport types are not reliably distinguishable from OSM alone:

- speedboat versus dhoni,
- active versus inactive ferry service,
- route frequency and operating timetable,
- vehicle availability,
- live bus service status,
- marine safety or navigability.

Those attributes require official, authorized, or manually approved data. OSM
route geometry may be used for distance and connectivity, but must not be
converted into fabricated schedules or travel times.

### 6.7 Operational marine and air mapping

The normalized model will add an operational mapping layer on top of the
physical OSM and official geography. This allows the project to represent
which vessel classes use which jetties and which aircraft observations are
associated with which airports.

#### Marine facilities and jetties

Each mapped marine facility is a transport node with an explicit role:

| Facility role | Typical use | Passenger accessibility |
|---|---|---|
| Island passenger jetty | Speedboat and dhoni passenger movement | Included when marked passenger-eligible |
| Ferry terminal | Public ferry boarding | Included when service is verified or represented by an approved route |
| Mixed-use jetty | Passenger and cargo operations | Included only for its passenger-approved use |
| MPL cargo jetty | Cargo loading and unloading operated by MPL | Excluded from passenger scoring by default |
| Commercial harbour | Larger vessel or cargo operations | Excluded unless explicitly approved for passenger access |

The physical location may come from OSM (`man_made=pier`, ferry terminal,
harbour, or related geometry), while operational role, operator, cargo/passenger
eligibility, and vessel-class mapping must come from an approved mapping file
or authoritative operator data.

Suggested normalized records:

```text
MarineFacility
    id
    island_id
    geometry
    facility_role
    operator
    passenger_eligible
    cargo_eligible
    source

VesselServiceMapping
    id
    vessel_class        # speedboat | dhoni | ferry | larger_vessel | cargo_vessel
    marine_facility_id
    service_role        # passenger | cargo | mixed
    route_id (optional)
    source
    confidence
```

Speedboats and dhonis may be mapped to island passenger jetties. Larger vessels
may be mapped to MPL-operated cargo jetties for cargo loading and unloading.
Cargo-only mappings must not increase passenger accessibility scores.

#### Marine route eligibility

Marine edges will include explicit eligibility fields:

```text
MarineEdge
    from_facility_id
    to_facility_id
    vessel_classes
    passenger_eligible
    cargo_eligible
    route_source
    geometry_source
    active_status
```

An OSM `route=ferry` relation can provide route geometry and a connectivity
candidate. It does not, by itself, establish vessel class, operator, schedule,
or active passenger service.

#### Aircraft and airports

CAA remains authoritative for airport identity and certification. OSM may supply
airport or aeroway geometry candidates. ADSB.lol live aircraft observations can
be spatially associated with the nearest verified airport or airport access
node for map presentation.

The backend must not infer an aircraft's origin, destination, route, or domestic
service solely from a live position. Such relationships require provider data
that explicitly supplies them or an approved static route mapping.

```text
Airport
    id
    island_id
    icao / iata
    certification_status
    official_geometry
    osm_geometry_match (optional)

AircraftObservation
    external_object_id
    aircraft_type (optional)
    position
    nearest_airport_id (optional display association)
    observed_at
```

Domestic air-access scoring uses verified CAA airport nodes and approved access
connections. Live aircraft positions remain visualization context only.

### 6.8 Demand and scoring relationships

Demand anchors are derived from OSM residential and settlement geometry, then
weighted so that allocated demand sums to the matched official island
population. They must be labeled as an approximation, not Census block data.

For each island, the scoring pipeline joins:

```text
population
 + official facilities
 + OSM demand anchors
 + OSM land graph
 + transport nodes/edges
 + CAA airport gateways
        ↓
accessibility result
```

Scores store the data version and scoring-configuration version that produced
them.

### 6.9 Live-data relationships

Live aircraft and vessel positions are transient observations. They may be
associated with an island or transport node using spatial proximity, but that
association is optional and must not mutate the static transport graph.

```text
LiveEvent
    ├── provider
    ├── external_object_id
    ├── geometry
    ├── observed_at / retrieved_at
    ├── optional island_id
    └── optional transport_node_id
```

Live events are delivered through the normalized FastAPI live stream and are
never used in deterministic accessibility scoring.

See [`data-relationships-diagram.md`](data-relationships-diagram.md) for the
full Mermaid relationship and data-flow diagrams.

## 7. External data connections

All provider access follows the rules in `apis.docs.md`:

```text
fetch → cache raw → validate → checksum → normalize → reconcile → expose through FastAPI
```

The SvelteKit frontend must never call external providers directly.

### 7.1 OpenStreetMap / Geofabrik

Primary source:

```text
https://download.geofabrik.de/asia/maldives-latest.osm.pbf
```

Fallback:

```text
https://download.openstreetmap.fr/extracts/asia/maldives.osm.pbf
```

Connection design:

1. Download the national PBF during prewarm or an explicit refresh command.
2. Validate HTTP status, content length, and PBF readability.
3. Write to a temporary file.
4. Calculate SHA-256 and write metadata.
5. Atomically replace the last-known-good file.
6. Use the fallback mirror only after a retryable primary failure.
7. Parse the PBF once into lightweight normalized files.

The API must never parse the PBF during a request and must not use Overpass as
the national bulk-data dependency. Overpass is limited to small validation
queries as described in `apis.docs.md`.

Recommended raw cache:

```text
data/cache/raw/osm/maldives-latest.osm.pbf
data/cache/raw/osm/maldives-latest.osm.pbf.meta.json
data/cache/raw/osm/maldives-latest.osm.pbf.sha256
```

Normalized OSM outputs:

```text
data/cache/normalized/osm_roads.json
data/cache/normalized/osm_transport_nodes.json
data/cache/normalized/osm_transport_relations.json
data/cache/normalized/residential_areas.geojson
data/cache/normalized/osm_geometry_candidates.json
```

OpenStreetMap attribution is required anywhere OSM-derived data is presented.

### 7.2 Flight data — ADSB.lol

Provider endpoint from `apis.docs.md`:

```http
GET https://api.adsb.lol/v2/point/{latitude}/{longitude}/{radius_nm}
```

The initial query should use the Maldives live-view center and a configurable
radius. The provider adapter will normalize:

```text
hex
flight
registration/type
alt_baro
gs
track
lat
lon
seen
now
```

Rules:

- Keep aircraft data outside deterministic accessibility scoring.
- Cache responses with a short configurable TTL.
- Handle empty/no-coverage responses without failing the application.
- Validate coordinates against the Maldives display region.
- Do not use aircraft records as official airport identity data.
- Keep provider access in the backend; expose only normalized events.

CAA remains authoritative for airport identity, certification, and airport
relationships to islands.

### 7.3 Vessel data — OpenWaters AIS

Primary no-key endpoint from `apis.docs.md`:

```http
GET https://ais.openwaters.io/v1/vessels?bbox={min_lat},{min_lon},{max_lat},{max_lon}&kind=vessel&max_age_moving=30m
```

The provider returns GeoJSON. The adapter will normalize:

```text
mmsi
imo
name
callsign
flag
type
lat/lon
sog
cog
heading
nav_status
destination
seen
source
station
```

Rules:

- Use a short live-position cache while the live view is active.
- Treat empty Maldives results as `no_current_coverage`, not automatically as
  a provider failure.
- Keep no historical vessel database for the MVP.
- Validate every coordinate before publishing it.
- Do not infer ferry schedules, route availability, or accessibility scores
  from vessel positions.

### 7.4 Vessel fallback — Facha AIS

Fallback endpoint from `apis.docs.md`:

```http
GET https://api.facha.dev/v1/ship/radius/{latitude}/{longitude}/{radius_nm}
```

Use only after OpenWaters returns an error or when a small-radius lookup is
specifically required. Radius and concurrency must be configurable. Empty
results remain a valid no-coverage state.

### 7.5 Provider status and SSE delivery

The backend exposes one normalized live interface:

```http
GET /api/v1/live/status
GET /api/v1/live/stream
```

SSE event kinds:

```text
aircraft
vessel
provider_status
```

The frontend maintains one EventSource. A provider outage hides only that live
layer and never breaks static maps, routing, or simulations.

## 8. Source collection sequence

The planned collection order is:

1. OneMap islands
2. MBS population
3. HEMS facilities
4. Ministry of Education schools
5. LGA councils
6. CAA airports
7. Geofabrik OSM PBF, with OpenStreetMap France fallback
8. OSM normalization and island spatial assignment
9. Transport graph construction
10. OpenWaters vessel positions when live view is active
11. Facha vessel fallback when applicable
12. ADSB.lol aircraft positions when live view is active

Static sources are prewarmed. Live sources are fetched only through the live
provider service and are not required for the baseline application.

## 9. Implementation phases

### Backend Phase 0 — Bootstrap

Deliver:

- FastAPI application
- `/health`
- configuration loading
- CORS for the local frontend
- structured logging
- error response format
- Pydantic validation
- test setup
- backend README
- development run command

Acceptance:

```bash
uvicorn app.main:app --host 127.0.0.1 --port 8000
```

and:

```http
GET /health
```

returns a successful response.

**Approval gate after completion.**

### Backend Phase 1 — Data acquisition and discovery

Implement provider adapters for:

- OneMap island boundaries
- Census population workbooks
- HEMS health facilities
- Ministry of Education schools
- CAA airports
- LGA councils
- Geofabrik Maldives OSM PBF, with OpenStreetMap France fallback

Create:

- raw source cache
- source metadata
- pagination/download handling
- discovery reports
- unmatched and ambiguous record reports

No scoring or simulation will be implemented yet.

**Approval gate after completion.**

### Backend Phase 2 — Normalization and national API

Implement:

- stable internal IDs
- name normalization
- official-to-island matching
- official-to-OSM geometry matching
- normalized JSON and GeoJSON files
- national data repositories
- island, infrastructure, transport, and summary endpoints

Acceptance:

- all OneMap islands represented,
- official records retained even without geometry,
- unmatched records reported,
- cold and cached rebuilds produce equivalent output.

**Approval gate after completion.**

### Backend Phase 3 — Routing foundation

Implement:

- OSM road extraction
- per-island land graphs
- mode permissions
- walking, bicycle, car/taxi, and bus routing
- marine graph
- air-access graph
- demand anchors
- disconnected-route handling

Routing results must explicitly return:

```json
{
  "status": "unreachable"
}
```

rather than fake infinite distances.

**Approval gate after completion.**

### Backend Phase 4 — Accessibility scoring

Before implementation, obtain approval for:

- score weights,
- distance thresholds,
- missing-data behavior,
- population-weighting rules,
- whether travel time is enabled.

Implement:

- pure scoring functions,
- health, education, government, and transport gateway metrics,
- land, marine, and air subscores,
- overall accessibility score,
- explanations,
- confidence and missing-data flags,
- national derived summaries.

No policy values will be invented silently.

**Approval gate after completion.**

### Backend Phase 5 — Scenario engine

Implement immutable, serializable scenario operations:

- add/move/remove bus stop
- add/move/disable ferry terminal
- add/remove/change ferry route
- parking and park-and-ride
- mobility hub
- road closure
- pedestrian connection
- airport-access improvement
- weather/disruption state

Implement:

- scenario validation,
- scenario execution,
- reset,
- clone,
- undo/redo support,
- baseline comparison,
- two-scenario comparison.

**Approval gate after completion.**

### Backend Phase 6 — Recommendations

Implement the shared pipeline:

```text
candidate generation
        ↓
candidate simulation
        ↓
candidate ranking
```

Recommendation types:

- underserved islands
- bus stops
- ferry terminals
- ferry routes
- parking/search areas
- mobility hubs
- pedestrian connections
- airport access

Each recommendation will include:

- score,
- location,
- reason,
- expected benefit,
- trade-offs,
- assumptions,
- confidence,
- planning-screening disclaimer where applicable.

**Approval gate after completion.**

### Backend Phase 7 — Live providers

Implement provider interfaces first, following the concrete endpoints and
fallback rules in the External data connections section and `apis.docs.md`.

Adapters:

- ADSB.lol aircraft point queries
- OpenWaters AIS vessel GeoJSON queries
- Facha AIS small-radius vessel fallback
- authorized vessel provider if credentials are later approved
- authorized bus provider if available

Implement:

- provider status endpoint,
- transient cache,
- normalized live events,
- SSE stream,
- graceful no-coverage behavior.

Live data will never affect deterministic accessibility scores.

**Approval gate after completion.**

### Backend Phase 8 — Prewarm and hardening

Implement:

```bash
python -m app.cli prewarm --all
```

The command will:

1. refresh sources,
2. normalize data,
3. build graphs,
4. calculate derived summaries,
5. validate cache integrity,
6. print a readiness report.

Add final tests for:

- source pagination,
- cache atomicity,
- deterministic rebuilds,
- matching,
- disconnected routing,
- scenario immutability,
- scenario comparison,
- recommendation ranking,
- malformed geometry,
- live-provider failure,
- API contract behavior.

## 10. Testing strategy

Tests will be separated into:

```text
tests/unit/
tests/integration/
tests/fixtures/
tests/contract/
```

Important guarantees:

- no unit test depends on live external services,
- provider tests use recorded fixtures,
- baseline data cannot be mutated by scenarios,
- recommendation results are deterministic,
- invalid geometry is rejected,
- unavailable data is represented explicitly,
- every API route has validation and error tests.

## 11. Key risks and controls

| Risk | Control |
|---|---|
| Official pages change format | Isolated provider adapters and fixtures |
| Missing facility coordinates | Preserve island-level records and confidence |
| OSM data changes | Versioned raw cache and parser metadata |
| Large national processing | Prewarm CLI and derived files |
| Slow simulation | Cached graphs and bounded execution |
| Missing population | Return `null`/N/A, never invent values |
| No live coverage | Return provider status without breaking core features |
| Unapproved policy assumptions | Configuration approval gates |

## 12. Decisions requiring explicit approval later

These should not block initial bootstrap:

- accessibility weights,
- distance thresholds,
- travel-time assumptions,
- weather/disruption multipliers,
- recommendation ranking weights,
- use of any keyed live provider,
- final API-path compatibility decision.

## 13. Execution rule

After approval of this plan, implement **Backend Phase 0 only**, run its tests,
provide a phase report, and stop for the next approval. Data acquisition,
scoring, simulation, and recommendation work must not begin automatically.
