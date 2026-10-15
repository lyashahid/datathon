# Phase 4 accessibility scoring

Accessibility scores are configurable and explainable. Government access is
excluded from the default domains.

## Default policy

| Setting | Default |
| --- | --- |
| Health weight | 1/3 |
| Education weight | 1/3 |
| Transport weight | 1/3 |
| Health quality | hospital > health centre > clinic |
| Distance bands | 500m / 1km / 3km |
| Missing data | contributes zero and produces a flag |
| Travel measure | distance only |
| Ferry route candidates | excluded unless explicitly enabled |

All settings are represented by `AccessibilityConfig` and can be overridden
with `POST /api/v1/accessibility/score`.

## Scoring behavior

- Health and education use geocoded facilities and walking routes where a land
  graph is available.
- Straight-line distance is used only as an explicit fallback when a route is
  unavailable.
- Health facility quality is multiplied by the distance-band score.
- Education uses available school geometry.
- Transport combines airport, OSM bus features, and ferry features using the
  configurable transport weights.
- OSM ferry relations are marked provisional and score zero by default because
  they do not prove active passenger service.
- Population weighting remains unavailable until the reviewed MBS atoll mapping
  is approved.

## Default artifact

```text
backend/data/cache/derived/accessibility-default.json
```

The current national precompute covers all 1,561 islands. Missing-data flags
are retained per island; scores are never presented as complete coverage when
source geometry or verified transport data is absent.
