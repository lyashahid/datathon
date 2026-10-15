# Mobility Sandbox MV — Data Relationships Diagram

This is a conceptual relationship model for the file-based backend. It is not
a database schema. The same relationships will be represented through stable
IDs and references across normalized JSON, GeoJSON, graph, and derived files.

The source rules and provider endpoints are defined in
[`../apis.docs.md`](../apis.docs.md).

## 1. Core entity relationships

```mermaid
erDiagram
    ISLAND ||--o{ POPULATION_OBSERVATION : has
    ISLAND ||--o{ FACILITY : contains
    ISLAND ||--o{ OSM_FEATURE : contains
    ISLAND ||--o{ TRANSPORT_NODE : contains
    ISLAND ||--o{ DEMAND_ANCHOR : has
    ISLAND ||--o{ ACCESSIBILITY_SCORE : receives
    ISLAND ||--o{ LIVE_EVENT : optionally_associated_with

    FACILITY ||--o| OSM_GEOMETRY_MATCH : may_match
    OSM_FEATURE ||--o| OSM_GEOMETRY_MATCH : may_supply_geometry

    TRANSPORT_NODE ||--o{ TRANSPORT_EDGE : starts
    TRANSPORT_NODE ||--o{ TRANSPORT_EDGE : ends

    ISLAND {
        string island_id PK
        string onemap_object_id UK
        string name
        string atoll
        geometry official_geometry
        float area_ha
    }

    POPULATION_OBSERVATION {
        string population_id PK
        string island_id FK
        int year
        string population_type
        int value
        string source_record_id
    }

    FACILITY {
        string facility_id PK
        string island_id FK
        string category
        string official_source
        string official_record_id
        string geometry_quality
        geometry geometry
    }

    OSM_FEATURE {
        string osm_object_id PK
        string island_id FK
        string object_type
        string feature_category
        geometry geometry
    }

    OSM_GEOMETRY_MATCH {
        string match_id PK
        string facility_id FK
        string osm_object_id FK
        string match_method
        float confidence
        string review_status
    }

    TRANSPORT_NODE {
        string node_id PK
        string island_id FK
        string node_type
        string source
        geometry geometry
    }

    TRANSPORT_EDGE {
        string edge_id PK
        string from_node_id FK
        string to_node_id FK
        string mode
        float distance_m
        bool active
        string source
        geometry geometry
    }

    DEMAND_ANCHOR {
        string anchor_id PK
        string island_id FK
        float weight
        float allocated_population
        float confidence
        geometry geometry
    }

    ACCESSIBILITY_SCORE {
        string score_id PK
        string island_id FK
        string data_version
        string scoring_config_version
        float overall_score
        float confidence
    }

    LIVE_EVENT {
        string event_id PK
        string provider
        string external_object_id
        string island_id FK
        string transport_node_id FK
        datetime observed_at
        datetime retrieved_at
        geometry geometry
    }
```

## 2. Source authority and normalization flow

```mermaid
flowchart LR
    ONEMAP[OneMap island polygons and identity]
    MBS[MBS population workbooks]
    HEMS[HEMS health facilities]
    MOE[Ministry of Education schools]
    LGA[LGA councils]
    CAA[CAA aerodromes]
    OSM[Geofabrik Maldives OSM PBF]

    RAW[Raw source cache]
    NORMALIZE[Source normalization]
    MATCH[Island assignment and OSM matching]
    NATIONAL[Normalized national model]

    ONEMAP --> RAW
    MBS --> RAW
    HEMS --> RAW
    MOE --> RAW
    LGA --> RAW
    CAA --> RAW
    OSM --> RAW

    RAW --> NORMALIZE
    NORMALIZE --> MATCH
    ONEMAP --> MATCH
    OSM --> MATCH
    MATCH --> NATIONAL

    NATIONAL --> ISLANDS[Islands]
    NATIONAL --> FACILITIES[Facilities]
    NATIONAL --> OSM_DATA[OSM features]
    NATIONAL --> TRANSPORT[Transport nodes and edges]
```

## 3. OSM relationships

```mermaid
flowchart TD
    PBF[Geofabrik Maldives PBF]
    FALLBACK[OpenStreetMap France fallback]
    VALIDATE[Validate PBF and checksum]
    EXTRACT[Extract required OSM features]
    POLYGONS[OneMap island polygons]

    ROADS[Roads and paths]
    STOPS[Bus stops and platforms]
    MARINE[Ferry terminals, piers, ferry relations]
    DEMAND[Residential areas and settlements]
    CANDIDATES[Facility geometry candidates]

    PBF --> VALIDATE
    FALLBACK -. retryable primary failure .-> VALIDATE
    VALIDATE --> EXTRACT
    EXTRACT --> ROADS
    EXTRACT --> STOPS
    EXTRACT --> MARINE
    EXTRACT --> DEMAND
    EXTRACT --> CANDIDATES

    POLYGONS --> ASSIGN[Spatially assign features to islands]
    ROADS --> ASSIGN
    STOPS --> ASSIGN
    MARINE --> ASSIGN
    DEMAND --> ASSIGN
    CANDIDATES --> MATCH[Match official records to OSM geometry]
    ASSIGN --> MATCH
```

OSM provides geometry and routing context. It does not replace official
facility identity, population, airport certification, or island identity.

## 4. Transport graph relationships

```mermaid
flowchart LR
    ROAD[OSM roads and paths] --> LAND_NODES[Land transport nodes]
    STOPS[OSM bus stops and stations] --> LAND_NODES
    TERMINALS[OSM ferry terminals and piers] --> MARINE_NODES[Marine transport nodes]
    AIRPORTS[CAA airports plus approved geometry] --> AIR_NODES[Air transport nodes]

    LAND_NODES --> LAND_EDGES[Land edges]
    MARINE_NODES --> MARINE_EDGES[Marine edges]
    AIR_NODES --> AIR_EDGES[Air access edges]

    LAND_EDGES --> ROUTING[Routing engine]
    MARINE_EDGES --> ROUTING
    AIR_EDGES --> ROUTING

    ROUTING --> ACCESS[Accessibility calculations]
    ROUTING --> SIMULATION[Scenario simulation]
```

The graph uses stable node and edge IDs. Scenario operations create an
effective graph without modifying the baseline graph files.

## 5. OSM-backed transport modes

```mermaid
flowchart TD
    OSM[OSM Maldives PBF]

    OSM --> ROADS[highway ways and access tags]
    OSM --> BUS_STOP[bus stops, platforms, stop positions]
    OSM --> BUS_ROUTE[route=bus relations]
    OSM --> FERRY_TERMINAL[ferry terminals, piers, harbours]
    OSM --> FERRY_ROUTE[route=ferry relations]
    OSM --> AIRWAY[aeroway and airport geometry candidates]
    OSM --> TRANSFER[parking, taxi, bicycle parking]

    ROADS --> WALK[Walking edges]
    ROADS --> BICYCLE[Bicycle edges]
    ROADS --> CAR[Taxi/private vehicle edges]
    ROADS --> BUS_ROADS[Bus-compatible road edges]

    BUS_STOP --> BUS_NODES[Bus transport nodes]
    BUS_ROUTE --> BUS_NODES
    BUS_ROADS --> BUS_GRAPH[Bus graph]
    BUS_NODES --> BUS_GRAPH

    FERRY_TERMINAL --> MARINE_NODES[Marine transport nodes]
    FERRY_ROUTE --> MARINE_EDGES[Marine route edges]
    MARINE_NODES --> MARINE_GRAPH[Marine graph]
    MARINE_EDGES --> MARINE_GRAPH

    AIRWAY --> AIR_MATCH[Candidate geometry match]
    CAA[Official CAA airport registry] --> AIR_NODE[Official airport node]
    AIR_MATCH -. geometry only .-> AIR_NODE

    TRANSFER --> HUB[Transfer and mobility-hub candidates]
```

### OSM mode interpretation

| Transport mode | OSM relationship | What the backend may calculate |
|---|---|---|
| Walking | Pedestrian-compatible highway/path edges | Network distance and access |
| Bicycle | Bicycle-compatible highway/cycleway edges | Network distance and access |
| Taxi/private vehicle | Drivable highway edges and restrictions | Network distance and connectivity |
| Bus | Drivable roads plus mapped stops/routes | Stop access and bus-compatible connectivity |
| Public ferry | Ferry terminals and `route=ferry` relations | Static marine connectivity and distance |
| Airport access | OSM roads/paths/parking linked to CAA airport nodes | First/last-mile access |
| Speedboat | OSM jetty geometry plus approved vessel-service mapping | Passenger edge when mapped to an eligible island jetty |
| Dhoni | OSM jetty geometry plus approved vessel-service mapping | Passenger edge when mapped to an eligible island jetty |
| Larger/cargo vessel | OSM or MPL jetty geometry plus operator mapping | Cargo edge to an MPL-operated cargo jetty |
| Aircraft | CAA airport identity, OSM geometry, and ADSB.lol live position | Airport context and approved air-access relationship |

OSM does not establish schedules, frequency, active operation, vehicle type,
or service reliability. Those fields must remain absent or explicitly
unverified.

## 6. Operational vessel and aircraft mapping

```mermaid
flowchart TD
    OSM_JETTY[OSM pier, ferry terminal, harbour geometry]
    ISLAND[OneMap island]
    APPROVED[Approved operator or mapping data]

    OSM_JETTY --> MARINE_FACILITY[Marine facility / jetty node]
    ISLAND --> MARINE_FACILITY
    APPROVED --> MARINE_FACILITY

    SPEEDBOAT[Speedboat]
    DHONI[Dhoni]
    FERRY[Ferry]
    LARGE[Larger vessel]
    CARGO[Cargo vessel]

    SPEEDBOAT --> PASSENGER_JETTY[Island passenger jetty]
    DHONI --> PASSENGER_JETTY
    FERRY --> FERRY_TERMINAL[Passenger ferry terminal]
    LARGE --> MPL[MPL-operated cargo jetty]
    CARGO --> MPL

    PASSENGER_JETTY --> PASSENGER_EDGE[Passenger-eligible marine edge]
    FERRY_TERMINAL --> PASSENGER_EDGE
    MPL --> CARGO_EDGE[Cargo-only marine edge]

    PASSENGER_EDGE --> SCORE[Passenger accessibility scoring]
    CARGO_EDGE -. excluded by default .-> SCORE

    CAA[CAA airport registry]
    AIRPORT[Verified airport node]
    ADSB[ADSB.lol aircraft observation]
    CAA --> AIRPORT
    ADSB --> AIRCRAFT[Normalized aircraft event]
    AIRCRAFT -. nearest-airport display association .-> AIRPORT
    AIRPORT --> AIR_ACCESS[Domestic air-access scoring]
```

### Operational mapping rules

| Mapping | Allowed use | Default score treatment |
|---|---|---|
| Speedboat → island passenger jetty | Passenger movement | Eligible when route/service is approved |
| Dhoni → island passenger jetty | Passenger movement | Eligible when route/service is approved |
| Ferry → ferry terminal | Public passenger service | Eligible when active/approved |
| Larger vessel → MPL cargo jetty | Cargo loading/unloading | Cargo-only; excluded from passenger score |
| Cargo vessel → MPL cargo jetty | Cargo movement | Cargo-only; excluded from passenger score |
| Aircraft observation → nearest airport | Live map context | Does not create a flight route |
| CAA airport → island | Official domestic gateway | Eligible for air-access scoring |

Physical OSM geometry and operational service mapping are separate concerns.
An OSM jetty may be used as the physical location, but passenger eligibility,
operator, vessel class, cargo status, and active service require approved
mapping or authoritative provider data.

### Operational mapping records

```text
MarineFacility
    id
    island_id
    osm_object_id (optional)
    facility_role       # passenger_jetty | ferry_terminal | mpl_cargo_jetty | harbour
    operator (optional)
    passenger_eligible
    cargo_eligible
    geometry

VesselServiceMapping
    id
    marine_facility_id
    vessel_class        # speedboat | dhoni | ferry | larger_vessel | cargo_vessel
    service_role        # passenger | cargo | mixed
    route_id (optional)
    source
    confidence

Airport
    id
    island_id
    caa_record_id
    osm_object_id (optional)
    icao / iata (optional)
    geometry

AircraftObservation
    external_object_id
    provider            # adsb_lol
    position
    nearest_airport_id (optional)
    observed_at
    retrieved_at
```

The `VesselServiceMapping` is the explicit bridge between vessel class and
jetty. A live AIS position can be displayed near that mapped facility, but a
live position alone does not create a service mapping.

## 7. Demand and accessibility relationships

```mermaid
flowchart TD
    POP[MBS island population]
    RESIDENTIAL[OSM residential areas]
    SETTLEMENTS[OSM settlement/place features]
    ANCHORS[Demand anchors]
    FACILITIES[Official facilities]
    GRAPHS[Land, marine, and air graphs]
    CONFIG[Approved scoring configuration]

    RESIDENTIAL --> ANCHORS
    SETTLEMENTS --> ANCHORS
    POP --> ANCHORS

    ANCHORS --> METRICS[Access metrics]
    FACILITIES --> METRICS
    GRAPHS --> METRICS
    CONFIG --> METRICS

    METRICS --> SCORE[Island accessibility score]
    SCORE --> SUMMARY[National summary]
```

If official population is unavailable, population-weighted results remain
unavailable rather than being estimated silently.

## 8. Flight-data relationship

```mermaid
flowchart LR
    ADSB[ADSB.lol point query]
    AIR_RAW[Short-lived raw response cache]
    AIR_VALIDATE[Coordinate and response validation]
    AIR_NORMALIZE[Normalized aircraft events]
    AIR_STREAM[FastAPI SSE stream]
    MAP[Live map layer]

    CAA[CAA airport registry]
    AIR_NODES[Official airport transport nodes]

    ADSB --> AIR_RAW
    AIR_RAW --> AIR_VALIDATE
    AIR_VALIDATE --> AIR_NORMALIZE
    AIR_NORMALIZE --> AIR_STREAM
    AIR_STREAM --> MAP

    CAA --> AIR_NODES
    AIR_NODES -. static airport context only .-> MAP

    AIR_NORMALIZE -. never modifies .-> SCORE[Deterministic score]
```

ADSB.lol aircraft observations are live context only. CAA remains authoritative
for airport identity, certification, and airport-to-island relationships.

## 9. Vessel-data relationship

```mermaid
flowchart LR
    OPENWATERS[OpenWaters AIS GeoJSON]
    FACHA[Facha AIS radius fallback]
    VESSEL_RAW[Short-lived raw response cache]
    VESSEL_VALIDATE[Coordinate and coverage validation]
    VESSEL_NORMALIZE[Normalized vessel events]
    VESSEL_STREAM[FastAPI SSE stream]
    MAP[Live map layer]

    OPENWATERS --> VESSEL_RAW
    OPENWATERS -. provider error .-> FACHA
    FACHA --> VESSEL_RAW
    VESSEL_RAW --> VESSEL_VALIDATE
    VESSEL_VALIDATE --> VESSEL_NORMALIZE
    VESSEL_NORMALIZE --> VESSEL_STREAM
    VESSEL_STREAM --> MAP

    TERMINALS[Static ferry terminals and piers]
    ROUTES[Static and approved ferry edges]
    TERMINALS --> STATIC_GRAPH[Static marine graph]
    ROUTES --> STATIC_GRAPH
    STATIC_GRAPH -. separate from live positions .-> MAP

    VESSEL_NORMALIZE -. never modifies .-> SCORE[Deterministic score]
```

Live vessel positions must not be interpreted as ferry schedules, route
availability, or proof of passenger service.

## 10. Scenario and recommendation relationships

```mermaid
flowchart TD
    BASELINE[Immutable normalized baseline]
    OPERATION[Scenario operations]
    EFFECTIVE[Effective world]
    BEFORE[Baseline accessibility result]
    AFTER[Scenario accessibility result]
    DELTA[Before/after impact]
    CANDIDATES[Generated candidates]
    RANKED[Ranked recommendations]

    BASELINE --> BEFORE
    BASELINE --> EFFECTIVE
    OPERATION --> EFFECTIVE
    EFFECTIVE --> AFTER
    BEFORE --> DELTA
    AFTER --> DELTA

    BASELINE --> CANDIDATES
    CANDIDATES --> EFFECTIVE
    EFFECTIVE --> RANKED
```

Recommendations and manual simulations must use the same routing and
accessibility engines.

## 11. FastAPI ownership boundary

```mermaid
flowchart LR
    FRONTEND[SvelteKit frontend]
    API[FastAPI API]
    STATIC[Normalized static files and graphs]
    LIVE[Live provider adapters]
    EXTERNAL[External providers]

    FRONTEND <-- HTTP and SSE --> API
    API --> STATIC
    API --> LIVE
    LIVE --> EXTERNAL

    FRONTEND -. no direct provider access .-> EXTERNAL
```

The backend owns provider access, caching, validation, normalization, error
handling, and secrets. The frontend receives only the normalized internal API.
