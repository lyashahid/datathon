# Phase 7 live data

The live module is a transient adapter layer. It does not modify normalized
static files, routing graphs, accessibility scores, or recommendations.

## Endpoints

```text
GET /api/v1/live/status
GET /api/v1/live/snapshot
GET /api/v1/live/stream
```

The snapshot accepts query parameters:

```text
latitude=4.1755
longitude=73.5093
radius_nm=250
include_fallback=true
route_code=<optional>
```

`/stream` emits `provider_status`, `aircraft`, `vessel`, and `bus` SSE events.
It returns one snapshot by default; `once=false` enables polling at the
configured interval.

`/snapshot` is the unified location API for aircraft, FollowMe/OpenWaters/Facha
vessels, and enabled buses. Use `bbox=min_lon,min_lat,max_lon,max_lat` to
request an area; FollowMe positions are supplied by selected IDs or the
short-lived latest-position cache.

## Providers

- **ADSB.lol** supplies aircraft positions for visualization only.
- **OpenWaters** is the primary vessel GeoJSON provider.
- **FollowMe** supplies selected public vessel positions and cached latest
  positions.
- **Facha AIS** is used after an OpenWaters error or for a small-radius query.
- **RTL** is an implemented adapter seam but disabled until an authorized bus
  feed is explicitly enabled.

Provider failures and empty results produce status values such as `error`,
`no_current_coverage`, `disabled`, or `not_queried`; they do not fail the
static API. Responses retain provider provenance and retrieval time.

Responses are cached for 60 seconds by default under `backend/data/cache/live/`.
The cache TTL, polling interval, timeout, provider enablement, and user agent
are configurable through `MOBILITY_LIVE_*` settings. The cache is transient
and no historical live-position database is created.
