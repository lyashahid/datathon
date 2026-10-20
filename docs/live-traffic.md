# Traffic reference

**Weather & traffic** can request a driving reference for named or map-selected endpoints. It uses `POST /api/v1/conditions/traffic`, through the same-origin `/api/backend/conditions/traffic` proxy. The endpoint delegates to the mounted Vela directions API, preserving its authentication, rate limiting, cache and request deadlines. See the [pinned Vela documentation](../backend/vendor/vela_api/README.md) for the provider contract and configuration.

The returned route retains provider geometry, distance, `typical_seconds` and nullable `traffic_seconds`. Missing traffic duration remains unavailable; a typical duration is not substituted as an observation of current traffic. The wrapper receipt identifies the provider, retrieval time and qualification. Retrieval time does not establish when road conditions were measured.

Provider geometry is shown only when returned. It is separate from the local OSM road graph and dated bus/ferry journey calculations. A provider route does not change the planning baseline, infer occupancy or demonstrate a causal benefit from a proposal. Changing endpoints clears obsolete results; provider refusal, parsing failure or absent local coverage remains visible.

## Source and reuse boundaries

Vela uses consumer web interfaces whose availability and format can change. Public reachability does not establish permission to redistribute the resulting content. Preserve the pinned implementation's license and attribution; review provider terms for the intended deployment rather than treating a successful response as authorization. Relevant references include [Google Maps consumer terms](https://www.google.com/help/terms_maps/), [Maps Platform terms](https://cloud.google.com/maps-platform/terms) and [supported Maps URLs](https://developers.google.com/maps/documentation/urls/get-started).

Configuration belongs to the backend and its mounted Vela service; see [setup](clone-and-run.md) and [backend configuration](../backend/README.md#configuration).

## Verification

Backend tests cover delegated authentication/rate-limit errors and preservation of missing traffic values. Provider parser tests use controlled fixtures, while any live probe is a timestamped coverage observation. Use the [browser verification guide](browser-verification.md) for maintained map/conditions checks and generated receipts. Neither kind of check establishes complete Maldives road coverage or a validated congestion forecast.
