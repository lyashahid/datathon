# Standalone REST API reference

Version `0.1.0`. Base URL: `http://127.0.0.1:8000`. The running service publishes its exact OpenAPI schema at `/openapi.json` and interactive documentation at `/docs`. The exported [openapi.json](openapi.json) is a snapshot of this facade, not a specification for Google's upstream endpoints.

This Python package runs independently of Datathon and the original Android checkout. It provides six functional areas: search, details, photos, reviews, directions, and Street View, plus suggestions and an image proxy. Vela itself has no hosted REST API. These routes are new adapters of its Google Maps consumer request builders and positional parsers, pinned to upstream commit `3c8fc207652e7a4fabfe53089de6ccace308ac61` and calibration version `26`.

## Authentication, formats, and common semantics

When `VELA_API_KEY` is configured, send `X-API-Key: YOUR_SERVICE_KEY` on every `/v1` call. An empty setting permits unauthenticated local calls. The `vela-api` CLI requires a key for a non-loopback bind; launching Uvicorn directly bypasses that CLI guard. `/health`, `/docs`, `/redoc`, and `/openapi.json` are public. This header authenticates your facade; it is not a Google API key. Keep a shared service key on your backend when integrating a public frontend.

Successful JSON endpoints use this envelope:

```json
{
  "data": {"query": "coffee", "places": [], "completeness": "unknown"},
  "meta": {
    "request_id": "a-generated-request-id",
    "provider": "google_consumer",
    "calibration_version": 26,
    "cached": false,
    "warnings": []
  }
}
```

This is an illustrative envelope, not a recorded complete response. `meta.cached` concerns the process's JSON response cache. `warnings` explain route-specific limits. Responses normally include an `X-Request-ID` correlation header; JSON failures also identify the request in their body. Binary image endpoints return raw bytes instead of this envelope. `/health` also uses its own JSON object.

`completeness="unknown"` means coverage has not been established; `"limited"` identifies a deliberately limited source, currently reviews. Neither value means all results were returned. Null fields and empty lists can mean absent data, parsing limitations, or an upstream layout change. Parser-default false flags are not independent evidence that a property is absent. Consumers should tolerate extra response fields and nullable values.

Common coordinate inputs are finite decimal degrees: latitude `[-90,90]`, longitude `[-180,180]`. `language` defaults to `en` and accepts a 2–3-letter language optionally followed by a 2–4-letter suffix; query-language values and details-language values are capped at 12 characters. `region` defaults to `us` and requires two letters. Search/details/suggest fall back to English for languages outside the adapter's status-word language set. Photos, native reviews, and directions forward the supplied language/region. Browser reviews normalize supported languages for the page. Street View requests currently use fixed English/US settings.

## Endpoint inventory and inputs

All paths below are relative to the base URL. Parameters are query parameters unless labeled JSON.

| Method and path | Required inputs | Optional inputs / defaults |
| --- | --- | --- |
| GET `/health` | none | none; process readiness only |
| GET `/v1/search` | `query`, `latitude`, `longitude` | `span_meters=25000` (1,000–500,000), `offset=0` (0–1,000, multiples of 20), `language=en`, `region=us` |
| GET `/v1/suggest` | `query`, `latitude`, `longitude` | `span_meters=25000` (2,000–500,000), `language=en`, `region=us` |
| POST `/v1/places/details` | JSON `place_id`, `name`, `latitude`, `longitude` | JSON `address=null`, `language=en`, `region=us` |
| GET `/v1/places/{place_id}` | path identifier previously returned by search on this process | `language=en`, `region=us` |
| GET `/v1/photos` | `feature_id` | `token`, `language=en`, `region=us` |
| GET `/v1/reviews` | `feature_id` | `token`, `backend=native` (`native`/`browser`), `limit=50` (1–50), `language=en`, `region=us` |
| POST `/v1/directions` | JSON `origin`, `destination` coordinates | JSON `mode=driving`, `waypoints=[]`, `avoid=[]`, `language=en`, `region=us` |
| GET `/v1/streetview` | `latitude`, `longitude` | `radius=50` (only 50 or 200 meters) |
| GET `/v1/streetview/panorama` | `pano_id` | none |
| GET `/v1/streetview/tile` | `pano_id`, `zoom`, `x`, `y` | none; binary image response |
| GET `/v1/image` | `url` | none; binary image response |

Search/suggest query length is 1–300 characters; whitespace-only queries are rejected. Details name length is 1–300, identity length 1–256, address length at most 600. Details and directions bodies reject unknown fields. Photo/review `feature_id` must match `0xHEX:0xHEX`, with 1–16 hex digits per half. A `ChIJ…` place ID cannot be used here. Opaque page tokens are capped at 4,096 characters. Panorama input IDs are 1–256 characters from letters, digits, `_`, and `-`; the current source-derived parser recognizes 20–25-character panorama IDs in replies.

## Search, suggestions, and strict details

Search returns `query`, `places: Place[]`, `focused_single: boolean`, `stripped_focus: boolean`, `focus: Place|null`, `next_offset: integer|null`, and `completeness="unknown"`. `focus` preserves the focused upstream place before distance-based ranking. `stripped_focus` records a focused response whose related-results node is absent. One call reads one upstream page; a full calibrated page produces an offset hint, usually 20 higher. It is not a continuation guarantee, an exhaustive scan, or a strict geographic-radius filter. The facade does not port Android search fan-out or JavaScript enrichment.

Suggestions return `query`, `places: Place[]`, `queries: string[]`, and `completeness="unknown"`. A suggestion place usually has identity, name, address, and location; other Place fields use null/empty/default values. Query-only suggestions are separate strings. Suggestions do not seed the GET details context cache.

POST details is stateless with respect to search context: send a provider identity (`feature_id` or `place_id`) plus the exact result name, coordinates, and available address. The adapter issues a focused name/address search and requires an exact provider-identity match. It returns the matched Place plus `completeness="unknown"`; a mismatch returns `404 place_identity_not_found`. It never returns a neighboring place in place of the requested identity. It cannot retrieve arbitrary provider IDs without their name/location context.

GET details is a convenience that retrieves this input context from an earlier `/v1/search` on the same process. Search stores aliases for `id`, `feature_id`, and `place_id` in a six-hour, 1,024-entry cache. Restart, expiry, capacity eviction, or a different worker can produce `404 place_context_missing`. Use POST details across independent apps/workers. Both routes still perform a focused upstream query unless their JSON response is cached.

### Place fields

| Field(s) | Type and meaning |
| --- | --- |
| `id`, `name`, `location` | Required string, string, and `{latitude:number, longitude:number}`. `id` prefers feature ID, then Google place ID, then a synthetic display key. Synthetic keys cannot be used for provider lookups. |
| `feature_id`, `place_id` | Nullable provider identity strings. The raw feature ID is required for photos/reviews. |
| `address`, `category`, `phone`, `website` | Nullable strings from the calibrated response. |
| `rating`, `review_count` | Nullable number and integer. Count is a source-reported total, not the number of reviews this service can fetch. |
| `status_text`, `open_now` | Nullable string and boolean; `open_now` is interpreted from localized status text, not computed from a calendar. |
| `permanently_closed`, `temporarily_closed` | Boolean parser flags, default false. |
| `price_text`, `price_level` | Nullable string and derived integer bucket. Currency text is retained; buckets use Vela's numeric thresholds or dollar-sign count. |
| `hours` | String array of display-day/range/holiday-note text, not structured opening periods. |
| `photo_urls` | Up to 12 deduplicated thumbnail URL strings from search. |
| `photo_dates`, `photo_categories` | Arrays reserved by the Place projection; currently empty in this search adapter. Use `/v1/photos` for posted text. |
| `distance_meters` | Nullable great-circle distance to the supplied search center. Details does not populate it. |
| `departments` | Objects with `name`, `hours`, nullable `status_text` and `open_now`. |
| `about` | Objects `{title:string, items:string[]}`. |
| `updates` | Up to 10 objects with `text`, nullable `posted_epoch_sec`, `url`, `link_label`, `image_url`. |
| `popular_times` | Null or `{days:[{day_of_week:integer, hours:[{hour:integer, occupancy:integer}]}]}`. Day codes and occupancy are retained from the consumer source. |
| `similar_places` | Objects with `name`, `location`, nullable `rating` and `feature_id`. |
| `fuel_price`, `place_type`, `country_code` | Nullable validated source strings. |
| `action_url`, `action_label`, `featured_review`, `editorial_summary`, `owner_description` | Nullable source text/URLs. |
| `wheelchair_accessible` | Boolean attribute-presence flag, default false; not a full accessibility assessment. |
| `sv_pano_id`, `sv_yaw_deg` | Nullable panorama ID and numeric heading extracted from an embedded Street View thumbnail URL. |
| `fuel_price_at`, `rating_histogram`, `saved_note`, `pin_color`, `pin_icon_url`, `map_layer` | Reserved fields; currently null in search/details. Browser reviews may separately return a histogram. |

These Place fields are declared in the facade's OpenAPI schema. Several nested attribute collections retain flexible dictionaries. Do not equate the richer details projection with Google's official Places field masks or completeness guarantees.

## Photos and reviews

Photos return `photos:[{url:string, posted_text:string|null, category:string|null}]`, `next_token:string|null`, and `completeness="unknown"`. A request asks the `hspqX` consumer RPC for up to 50 rows and normalizes accepted photo URLs to 1024×768. `posted_text` is an English month/year display value when present; `category` is currently null. Duplicate/unreadable rows can reduce the returned count. Pass `next_token` unchanged to the next call when non-null; a null token is not proof that every photo was recovered.

Reviews return `reviews`, nullable `next_token`, nullable `end`, `completeness="limited"`, `backend`, and `pagination_verified=false`. Each review has `author:string`, nullable `rating:integer`, `author_photo:string`, `relative_time:string`, `text:string`, and `photos:string[]`. Browser results may additionally have nullable `id`.

- **Native:** calls `qv9Egd`, whose calibrated proto asks for a small consumer feed (10). `limit` caps parsed output; raising it does not force Google to supply 50 rows. `returned_before_limit` and `truncated_by_limit` describe local truncation. The candidate next-token response slot is unverified in Vela's source. Tokens are sanitized before RPC substitution. Even `end=true` does not establish all reviews were returned. This facade cannot promise complete or recoverable review pagination.
- **Browser:** requires `VELA_BROWSER_ENABLED=true`, the browser extra, and Chromium. It opens an anonymous Maps page, selects/scrolls visible review cards, and returns at most `limit`. It has no pagination: supplying a nonempty token yields `422 unsupported_option`; `next_token` and `end` are null. Extra fields include `requested_language`, `page_language`, `settled`, and nullable `rating_histogram`. `settled=false` means the DOM collection deadline produced a partial result. No readable cards yields `502 browser_no_reviews`, not an assertion of zero reviews.

## Directions

The JSON body uses `origin` and `destination` coordinate objects, optional `mode` (`driving`, `walking`, `bicycling`), up to eight ordered coordinate `waypoints`, and an `avoid` list of at most three values from `tolls`, `highways`, `ferries`. Avoid options are supported only for driving; other modes with an avoid value return `422 unsupported_option`. Transit is rejected by request validation. Options are encoded into the consumer protobuf-text request; whether Google honors an avoid preference depends on its returned route.

Data is `{routes:Route[], mode:string, completeness:"unknown"}`. Each Route contains `source="google_consumer"`, nullable `summary`, `distance_meters`, `typical_seconds`, `traffic_seconds`, `geometry`, and arrays `steps`, `leg_times`, `traffic_spans`. It also includes nullable `typical_low_seconds`, `typical_high_seconds`, `start`/`end` coordinate objects, and `geometry_available:boolean`; these fields and the step/leg/traffic objects are declared in OpenAPI.

Geometry is either null or GeoJSON `{type:"LineString", coordinates:[[longitude,latitude], ...]}` decoded from upstream E7 deltas. A missing/unreadable shape remains null; no straight line is fabricated. Timing values use seconds; distances use meters. `leg_times` contain distance, typical time, and nullable traffic time only when their totals reconcile with the route. Traffic spans contain `{level:integer, start_meters:number, length_meters:number}`.

Step objects contain `instruction`, nullable `distance_meters`, `maneuver`, `turn_side`, `turn_type`, `lane_hint`, and `road_names:string[]`. `guidance_available=true` only means supplied step text was found; step completeness and maneuver coordinates are not verified. This is route geometry/timing/text, not a turn-by-turn navigation engine. Android navigation, open-router fallbacks, offline routing, transit schedules, and transit directions are not included. An empty route list returns `404 no_routes`; missing calibrated summaries return `502 parser_drift`.

## Street View and image bytes

Nearby Street View uses the consumer `SingleImageSearch` JSON+protobuf POST with the requested 50 or 200-meter radius. One call does not automatically retry the other radius or the legacy Android fallback. Panorama-by-ID uses `photometa/v1`.

Both JSON routes return `pano_id`, `latitude`, `longitude`, `heading_degrees`, `tile_size`, `max_zoom`, `level_dimensions:[{width,height}]`, nullable `address_label`, `copyright`, `capture_year`, `capture_month`, and arrays `neighbors`/`history`. Neighbors contain panorama ID, coordinates, `bearing_degrees`, and `distance_meters`; they reflect Vela's nearby-distance/bearing filtering rather than an exhaustive road graph. History entries contain `pano_id`, `year`, `month`, deduplicated and sorted newest first.

`max_zoom` is the **number of levels**, not the highest usable zoom. Select `0 <= zoom < min(max_zoom, len(level_dimensions))`, also respecting the route's zoom range 0–6. For that level, require `0 <= x < ceil(width/tile_size)` and `0 <= y < ceil(height/tile_size)`; the request additionally caps x/y at 127. The tile endpoint validates metadata before fetching. It returns a single raster tile, not a stitched panorama. Invalid bounds return `422 invalid_tile`; missing imagery can return `404 no_results`.

`/v1/image` fetches an existing allowed image URL from a place/photo/review response. It accepts HTTPS port 443 without embedded credentials on `streetviewpixels-pa.googleapis.com` or the `googleusercontent.com`, `ggpht.com`, and `gstatic.com` domains/subdomains. Other URLs return `400 invalid_upstream_url`; arbitrary websites cannot be proxied. Redirect targets are checked too. URLs are capped at 4,096 characters. The upstream must return JPEG, PNG, WebP, AVIF, or GIF, and at most 8 MiB. Image and tile endpoints send the actual raster `Content-Type` and `Cache-Control: private, max-age=120`. Save bytes or display them; do not call JSON decoding on a successful image response. On failure, these routes return the same JSON error envelope as other routes.

## Copyable cURL examples

Run from the project root so the JSON body file paths resolve. `curl --fail-with-body` requires cURL 7.76 or newer; use `curl.exe` in PowerShell to avoid older `curl` aliases. These examples preserve URL encoding for identities, tokens, and photo URLs.

Set up the variables for your shell. The key may be empty for an unauthenticated local server. Replace `FID`, `PLACE_ID`, `PANO_ID`, and `PHOTO_URL` using actual response values before the media/context calls. `PLACE_ID` is the response's `id` for GET context lookup; `FID` must be its raw `feature_id`.

**Bash setup**

```bash
BASE='http://127.0.0.1:8000'
HEADERS=()
if [ -n "${VELA_API_KEY:-}" ]; then HEADERS=(-H "X-API-Key: $VELA_API_KEY"); fi
FID='REPLACE_WITH_RAW_FEATURE_ID'
PLACE_ID='REPLACE_WITH_SEARCH_RESULT_ID'
PANO_ID='REPLACE_WITH_PANORAMA_ID'
PHOTO_URL='REPLACE_WITH_PHOTO_URL'
```

**Bash requests**

```bash
curl --fail-with-body "$BASE/health"

curl --fail-with-body "${HEADERS[@]}" --get "$BASE/v1/search" \
  --data-urlencode 'query=coffee' --data-urlencode 'latitude=37.7749' \
  --data-urlencode 'longitude=-122.4194' --data-urlencode 'offset=0'

curl --fail-with-body "${HEADERS[@]}" --get "$BASE/v1/suggest" \
  --data-urlencode 'query=cof' --data-urlencode 'latitude=37.7749' \
  --data-urlencode 'longitude=-122.4194'

# First edit examples/details.json with a search result's provider identity,
# exact name/location and available address; its placeholder is not a real place.
curl --fail-with-body "${HEADERS[@]}" "$BASE/v1/places/details" \
  -H 'Content-Type: application/json' --data-binary '@examples/details.json'

# Convenience only: requires search context on this server process.
curl --fail-with-body "${HEADERS[@]}" "$BASE/v1/places/$PLACE_ID"

curl --fail-with-body "${HEADERS[@]}" --get "$BASE/v1/photos" \
  --data-urlencode "feature_id=$FID"
# For another photo page, add: --data-urlencode "token=$NEXT_TOKEN"

curl --fail-with-body "${HEADERS[@]}" --get "$BASE/v1/reviews" \
  --data-urlencode "feature_id=$FID" --data-urlencode 'backend=native' \
  --data-urlencode 'limit=50'

# Requires the enabled browser installation; no page token is supported.
curl --fail-with-body "${HEADERS[@]}" --get "$BASE/v1/reviews" \
  --data-urlencode "feature_id=$FID" --data-urlencode 'backend=browser' \
  --data-urlencode 'limit=20'

curl --fail-with-body "${HEADERS[@]}" "$BASE/v1/directions" \
  -H 'Content-Type: application/json' --data-binary '@examples/directions.json'

curl --fail-with-body "${HEADERS[@]}" --get "$BASE/v1/streetview" \
  --data-urlencode 'latitude=37.7749' --data-urlencode 'longitude=-122.4194' \
  --data-urlencode 'radius=50'

curl --fail-with-body "${HEADERS[@]}" --get "$BASE/v1/streetview/panorama" \
  --data-urlencode "pano_id=$PANO_ID"

# Confirm that zoom=0/x=0/y=0 exists in level_dimensions first.
curl --fail-with-body "${HEADERS[@]}" --get "$BASE/v1/streetview/tile" \
  --data-urlencode "pano_id=$PANO_ID" --data-urlencode 'zoom=0' \
  --data-urlencode 'x=0' --data-urlencode 'y=0' --output tile.jpg

curl --fail-with-body "${HEADERS[@]}" --get "$BASE/v1/image" \
  --data-urlencode "url=$PHOTO_URL" --output photo.bin
```

Provider IDs shown by search are normally URL-safe. If using a synthetic `id` containing spaces or punctuation, encode the GET path component or use the clients' context method. A synthetic ID without provider identity cannot be refreshed. Save-file cURL failures may write an error JSON body into the output file; inspect the exit status and Content-Type before treating it as an image.

**PowerShell setup**

```powershell
$base = 'http://127.0.0.1:8000'
$apiHeaders = @()
if ($env:VELA_API_KEY) { $apiHeaders = @('-H', "X-API-Key: $env:VELA_API_KEY") }
$fid = 'REPLACE_WITH_RAW_FEATURE_ID'
$placeId = 'REPLACE_WITH_SEARCH_RESULT_ID'
$panoId = 'REPLACE_WITH_PANORAMA_ID'
$photoUrl = 'REPLACE_WITH_PHOTO_URL'
```

**PowerShell requests**

```powershell
curl.exe --fail-with-body "$base/health"

curl.exe --fail-with-body @apiHeaders --get "$base/v1/search" `
  --data-urlencode 'query=coffee' --data-urlencode 'latitude=37.7749' `
  --data-urlencode 'longitude=-122.4194' --data-urlencode 'offset=0'

curl.exe --fail-with-body @apiHeaders --get "$base/v1/suggest" `
  --data-urlencode 'query=cof' --data-urlencode 'latitude=37.7749' `
  --data-urlencode 'longitude=-122.4194'

# Edit the details file with actual search result context first.
curl.exe --fail-with-body @apiHeaders "$base/v1/places/details" `
  -H 'Content-Type: application/json' --data-binary '@examples/details.json'

$encodedId = [Uri]::EscapeDataString($placeId)
curl.exe --fail-with-body @apiHeaders "$base/v1/places/$encodedId"

curl.exe --fail-with-body @apiHeaders --get "$base/v1/photos" `
  --data-urlencode "feature_id=$fid"
# For another photo page, add: --data-urlencode "token=$nextToken"

curl.exe --fail-with-body @apiHeaders --get "$base/v1/reviews" `
  --data-urlencode "feature_id=$fid" --data-urlencode 'backend=native' `
  --data-urlencode 'limit=50'

curl.exe --fail-with-body @apiHeaders --get "$base/v1/reviews" `
  --data-urlencode "feature_id=$fid" --data-urlencode 'backend=browser' `
  --data-urlencode 'limit=20'

curl.exe --fail-with-body @apiHeaders "$base/v1/directions" `
  -H 'Content-Type: application/json' --data-binary '@examples/directions.json'

curl.exe --fail-with-body @apiHeaders --get "$base/v1/streetview" `
  --data-urlencode 'latitude=37.7749' --data-urlencode 'longitude=-122.4194' `
  --data-urlencode 'radius=50'

curl.exe --fail-with-body @apiHeaders --get "$base/v1/streetview/panorama" `
  --data-urlencode "pano_id=$panoId"

curl.exe --fail-with-body @apiHeaders --get "$base/v1/streetview/tile" `
  --data-urlencode "pano_id=$panoId" --data-urlencode 'zoom=0' `
  --data-urlencode 'x=0' --data-urlencode 'y=0' --output tile.jpg

curl.exe --fail-with-body @apiHeaders --get "$base/v1/image" `
  --data-urlencode "url=$photoUrl" --output photo.bin
```

The [details body](../examples/details.json) is a template to edit, not a known valid provider identity. The [directions body](../examples/directions.json) supplies real coordinate inputs and can be submitted unchanged; upstream route availability still depends on Google. [Python](../examples/client.py) and [Node.js](../examples/client.mjs) examples automatically construct the details body from search and provide helpers for every route, including binary downloads.

## Error contract

```json
{
  "error": {"code": "place_context_missing", "message": "Human-readable explanation", "details": null},
  "request_id": "a-generated-request-id"
}
```

`details` is optional/null except when the failure supplies diagnostics. Validation diagnostics identify field location/type/message without echoing submitted inputs. Client code should branch on `error.code`, not exact message text. Handled route errors use this envelope; framework-generated errors for unknown paths/methods may use FastAPI's default shape.

| Status | Representative codes | Handling |
| --- | --- | --- |
| 400 | `invalid_upstream_url` | Correct an image URL/host; do not send arbitrary sites. |
| 401 | `unauthorized` | Supply the configured service key. |
| 404 | `place_context_missing`, `place_identity_not_found`, `no_results`, `no_routes` | Provide stateless place context or handle absent imagery/routes; a details mismatch is never filled from a neighbor. |
| 413 | `request_too_large` | Reduce the body to at most 64 KiB. |
| 422 | `invalid_request`, `invalid_query`, `place_identity_missing`, `unsupported_option`, `invalid_tile` | Correct request bounds, enums, identity/context, or unsupported combinations. |
| 429 | `rate_limited` | Local per-IP limit; `Retry-After: 60`. |
| 500 | `internal_error`, `calibration_invalid` in directions | Server failure/configuration problem; retain the request ID. |
| 502 | `upstream_parse_error`, `upstream_shape_changed`, `parser_drift`, `upstream_http_error`, `upstream_unavailable`, `upstream_redirects`, `upstream_response_too_large`, `upstream_content_type`, `browser_navigation_failed`, `browser_no_reviews` | Transport/content/layout failure. Log the code/request ID; do not interpret a parsing failure as zero results. |
| 503 | `upstream_blocked`, `upstream_rate_limited`, `browser_disabled`, `browser_unavailable` | Anonymous-session refusal, Google quota, or missing browser installation. Upstream rate limiting includes `Retry-After: 60`. |
| 504 | `upstream_timeout`, `browser_timeout` | Deadline exceeded. Bound client retries and avoid multiplying load. |

The shared adapter error class defaults to 502, so malformed search/media calibration can also report 502. Failed operations are not cached. Successful empty/limited responses can be cached.

## Operations, provenance, and deployment limits

Defaults: 120-second, 256-entry JSON response cache; six-hour, 1,024-entry context cache; 60 `/v1` requests per client IP in a sliding minute; at most 1,024 tracked clients; eight concurrent upstream HTTP calls; 25-second upstream call deadline; 55-second JSON-operation deadline; 64 KiB request-body cap; 25 MiB upstream data cap and 8 MiB image cap. Settings and override ranges are listed in [README](../README.md). No endpoint automatically walks all pages. Images use browser/private cache headers rather than the server's JSON byte cache.

State and limits are in-memory and process-local, with bounded LRU eviction. HTTP requests reuse one anonymous cookie session and perform a best-effort warm no more than every six hours after success, with a 60-second retry interval after a failed attempt. Browser reviews use a separate anonymous Chromium context and serialized 50-second deadline including queue wait. These sessions are not Android Cronet/WebView equivalents, persistent logins, distributed quotas, or shared multi-worker caches. Client identity is the ASGI-reported IP; trusted proxy and shared-IP behavior depend on your deployment. The project does not implement tenant isolation, durable storage, shared locks, or distributed rate limiting.

| Functional area | Adapted upstream behavior | Important boundary |
| --- | --- | --- |
| Search/details | Google map-search `pb` request and calibrated result positions | One page, strict details identity, no Android fan-out/enrichment |
| Suggestions | Maps `/s` first-object `d` payload | Positional consumer suggestions, no official autocomplete contract |
| Photos | `batchexecute` RPC `hspqX` | Provider feature ID, opaque photo cursor |
| Native reviews | `batchexecute` RPC `qv9Egd` | Limited feed, cursor slot unverified |
| Browser reviews | Adapted Vela review DOM collector | Optional Chromium, limited visible cards, no pagination |
| Directions | Consumer preview-directions `pb` and E7 arrays | Google route shapes/timing, no navigation engine/transit/offline fallback |
| Street View | `SingleImageSearch`, `photometa`, raster tile URLs | Metadata and bounded tiles, no stitched viewer/legacy retry |

The bundle uses a static calibration snapshot; it does not fetch/execute remote transforms or remote calibration. Google can change consumer endpoints, require consent, refuse an anonymous IP/session, or return fewer rows than source-reported totals. Fixture tests validate parsing/request construction under controlled inputs, not continued upstream access or comprehensive data quality. Live verification files, when supplied in `docs/`, are bounded observations for their recorded time/environment and endpoints.

The service is packaged with directly pinned [FastAPI](https://fastapi.tiangolo.com/), [HTTPX](https://www.python-httpx.org/async/), Uvicorn, and optional [Playwright](https://playwright.dev/python/docs/intro). See [Docker deployment](DOCKER.md) for native/browser image builds, Compose launches, and runtime checks, or [README](../README.md) for a Python launch. Compose reads `.env` for variable substitution; Python launch requires shell environment variables. Compose forwards every documented application setting; the selected native/browser target sets the browser flag. The browser image installs Chromium and its system libraries. The Docker base tag/transitive dependencies are not a complete immutable lock.

[Source provenance](provenance.json) records the adapted files and calibration. [Verification](verification.json) and the PDF preserve the October 13 API and live-check snapshot. [Docker verification](docker-verification.json) records the subsequent container builds and runtime checks. These local checks do not establish distributed deployment or exhaustive Google coverage.

Preserve [LICENSE](../LICENSE) and [NOTICE](../NOTICE): this project contains GPL-3.0-only Vela-derived code. Its source license does not grant rights under Google's separate service/content terms. Assess those terms and the consumer-source stability against your application's requirements; this facade does not claim Google's official API guarantees.
