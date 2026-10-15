# Map-ready static data

Use the following endpoint for direct map ingestion:

```text
GET /api/v1/map/features
```

Query parameters:

```text
layer=all|islands|infrastructure|transport
island_id=island:{onemap_object_id}
category=optional category filter
include_unlocated=false
```

The response is a GeoJSON `FeatureCollection`. Official OneMap island
polygons, geocoded official facilities, and OSM transport features are
converted to consistent GeoJSON features with map-popup properties including
`category`, `island_id`, `source`, `geometry_quality`, and matching status where
available.

When an official hospital, health centre, clinic, school, or airport has been
matched to an OSM object, the official feature includes:

```text
osm_object_id
osm_match_score
geometry_source=OpenStreetMap
match_status
```

For `layer=all`, the linked raw OSM duplicate is omitted so the map gets one
official feature with its OSM geometry. Use `layer=transport` when the raw OSM
feature layer is needed separately. `summary.matched_osm_count` reports how
many raw OSM features were deduplicated from the combined layer.

All coordinates use GeoJSON order:

```text
[longitude, latitude]
```

No coordinates are invented for facilities that only have island context.
Those records are excluded from plotted features by default and counted in
`summary.unlocated_count`. Set `include_unlocated=true` when the UI needs to
show an unlocated-data indicator.

## Complete mapping audit

Inspect the generated audit artifact to review every official record and its OSM
evidence:

```text
backend/data/cache/normalized/facility-mapping-review.json
```

Each record includes the official identity, island context, match decision,
linked OSM object, similarity score, review priority, recommended action, and
all review candidates. Ambiguous records are deliberately recorded as not
approved; they are not assigned a possibly incorrect OSM point.

The map layer also includes same-island provisional matches for MVP coverage.
These have `match_status=osm_provisional_review_required` and must be shown as
review-required in the UI. They do not participate in deterministic
accessibility scoring.

The current reviewed override batch contains 23 obvious name-and-place matches
stored in `backend/data/review/facility-osm-overrides.json`.
