# Phase 3 routing foundation

Phase 3 builds immutable routing artifacts during normalization. API requests
never parse the OSM PBF.

## Artifacts

```text
backend/data/cache/graphs/land.json
backend/data/cache/graphs/marine.json
backend/data/cache/graphs/air.json
backend/data/cache/derived/demand-anchors.json
backend/data/cache/graphs/summary.json
```

The current prewarm produced:

| Graph/artifact | Result |
| --- | ---: |
| Islands with land graphs | 431 |
| Land graph nodes | 59,686 |
| Directed land edges | 137,842 |
| Marine nodes | 71 |
| Marine route-candidate edges | 40 |
| Airport-access graph nodes | 34 |
| Airport-access edges | 34 |
| Demand anchors | 1,865 |

## Routing behavior

- Land routing supports walking, bicycle, car, taxi, and bus permissions.
- OSM one-way tags are converted into directed edges.
- Different-island or disconnected routes return `{"status": "unreachable"}`.
- Marine route relations are preserved as unverified candidates. They are not
  treated as active passenger service by default.
- Airport graphs represent airport-to-island access only; no flight schedules
  are inferred.
- Demand anchors are approximate OSM settlement/residential points with island
  centroid fallbacks. Population allocation remains blocked by the pending MBS
  atoll mapping review.

## API

```http
POST /api/v1/routing/land
POST /api/v1/routing/marine
```
