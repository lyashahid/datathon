# Integrated Vela service

This package contains every runtime module and bundled data file from the supplied
`D:/Projects/Personal/vela-rest-api/src/vela_api` project. The supplied service was
already FastAPI. Its original checkout is unchanged, and the application needs no
runtime access to that checkout.

The upstream README and API documentation are preserved as `UPSTREAM_README.md`
and `UPSTREAM_API.md`. `LICENSE`, `NOTICE`, and `provenance.json` retain the
GPL-3.0-only attribution, audited upstream commit, source paths, and calibration
version 26. The pinned calibration file has SHA-256
`b29a8b6acc1059f6517813896b5d7386bc8a670f7f37df9f10cd6391f8f4d3de`.
The retained NOTICE's reference to `docs/provenance.json` describes the supplied
project layout; this integration keeps that file beside NOTICE.

## Backend and frontend paths

`app.vela.mount_places()` mounts the complete child application at
`/api/v1/places`. The parent lifespan must enter `app.vela.places_lifespan()` so
its HTTP client and optional Chromium instance start and close correctly.

| Method | Mounted path | Functionality |
| --- | --- | --- |
| GET | `/status` | Local runtime version, calibration, browser availability |
| GET | `/search` | Place search, geographic viewport, locale, paged offsets |
| GET | `/suggest` | Place and query autocomplete |
| POST | `/details` | Strict identity matching from a search record |
| GET | `/{place_id}` | Details using the bounded saved search context |
| GET | `/photos` | Photo records, metadata, continuation tokens |
| GET | `/reviews` | Native reviews or optional Chromium collection |
| POST | `/directions` | Driving, walking, bicycling, waypoints and avoidance |
| GET | `/streetview` | Nearby panorama discovery |
| GET | `/streetview/panorama` | Panorama metadata, neighbors and historical imagery |
| GET | `/streetview/tile` | Validated binary JPEG panorama tiles |
| GET | `/image` | Bounded HTTPS image proxy with upstream host allowlist |
| GET | `/docs`, `/openapi.json` | Interactive documentation and complete schemas |

The Svelte server forwards these routes through `/api/backend/places/*`, including
binary content, request IDs, cache headers, retry headers and documentation.
`PlaceWorkspace.svelte` exposes discovery, evidence, directions and StreetView.
Raw records and route GeoJSON can be downloaded without dropping source fields.
The live traffic route uses the same child `/directions` handler so authentication,
rate limits, operation deadlines and cache semantics are shared.

## Runtime configuration

`VELA_API_KEY` is optional local service authentication. When configured, callers
need `X-API-Key`; the frontend server supplies it without exposing it in browser
JavaScript. These consumer adapters do not require a Google API key.

Set `VELA_BROWSER_ENABLED=true` to offer browser reviews and install the browser:

```powershell
.venv\Scripts\python.exe -m playwright install chromium
```

Other preserved options are `VELA_CORS_ORIGINS`, `VELA_REQUEST_TIMEOUT`,
`VELA_MAX_CONCURRENT_REQUESTS`, `VELA_RATE_LIMIT_PER_MINUTE`, and `VELA_CACHE_TTL`.
Defaults are 25 seconds per transport request, eight concurrent transport calls,
60 authenticated requests per caller IP per minute, and a 120-second JSON cache.
Operations have a 55-second overall deadline. The default cache holds 256 entries;
saved place contexts hold 1,024 entries for six hours. JSON responses are bounded
to 25 MiB, image responses to 8 MiB, and incoming POST bodies to 64 KiB.

Missing source fields remain null. Response envelopes retain calibration version,
request ID, cache state, provider and completeness warnings. Images retain their
actual content type. Provider changes and unavailable geographic coverage are
returned as explicit errors, rather than substituted with invented data.

## Integration changes

Only import/resource namespaces, configurable route prefixes, child lifecycle
wiring, route ordering, and formatting were adapted. The cached place lookup is
registered after static integrated routes so it cannot swallow photo, review or
StreetView paths. Request builders, response parsers, calibration, review script,
browser collection, errors, authentication, cache and media handling are retained.
All seven supplied test modules are retained under `tests/vela` with their imports
adapted to `vendor.vela_api`.

## Verification

Run migrated contract and integration tests from `backend`:

```powershell
.venv\Scripts\python.exe -m pytest tests/vela tests/test_places_integration.py -q
.venv\Scripts\python.exe -m pytest tests/test_conditions_operations.py -q
```

The migrated tests include an actual local Chromium collector test with a fixed
HTML fixture. The separate smoke script uses real consumer services:

```powershell
.venv\Scripts\python.exe scripts/verify_places.py --browser
# Or verify the running backend:
.venv\Scripts\python.exe scripts/verify_places.py --base-url http://127.0.0.1:8000
```

The metadata-only result is written to
`data/metadata/places-live-verification.json`. On 14 October 2026, the real smoke
verified Malé hospital search and another page, autocomplete, exact details,
cached details, five photos and a JPEG, native and Chromium reviews, walking and
driving alternatives with real geometry, and source-supplied driving traffic
durations. Reviews were explicitly limited; a complete review corpus and review
continuation were not proven by this sample.

Bicycling in that Malé sample returned a source/parser error, and nearby Malé
StreetView returned no coverage. The explicitly separate San Francisco imagery
sample returned panorama metadata, six tile levels, and a real JPEG tile. These
results establish the tested capabilities and their geographic limits; they do
not establish universal provider coverage or complete search inventory.
