# Phase 6 recommendations

Recommendations are deterministic planning-screening candidates generated from
the normalized static cache. The shared pipeline is:

```text
candidate generation → candidate simulation → candidate ranking
```

## Endpoints

```text
POST /api/v1/recommendations
```

The common request body is optional in intent and supports `island_id`,
`limit`, and a configurable ranking policy:

```json
{
  "type": "bus_stop",
  "island_id": "island:1",
  "limit": 10,
  "config": {
    "benefit_weight": 0.7,
    "confidence_weight": 0.3,
    "max_candidates": 100
  }
}
```

## Interpretation

- Every candidate is backed by a serializable scenario operation and is run
  through the immutable Phase 5 simulation engine.
- Ranking uses expected benefit and confidence only; no unavailable population
  values are invented.
- Ferry terminal and route candidates explicitly state that OSM geometry does
  not verify active passenger service.
- Locations based on an island centroid are search-area proxies, not surveyed
  sites.
- Airport recommendations do not infer flight schedules.
- Results are planning-screening suggestions, not costed or approved projects.

The response retains assumptions, trade-offs, warnings, and simulation deltas
so consumers can distinguish evidence-backed gaps from proposed interventions.
