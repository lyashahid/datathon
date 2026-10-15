# Live traffic reference

Traffic is an optional real-world reference beside the planning model. It does not change bus timetables, assumed demand, proposed stops, simulated weather closures, or the project's existing routing calculations. The app uses SvelteKit server handlers and MapLibre raster/GeoJSON layers. No paid service, account, API key, or subscription has been added.

## Provider permission and default state

The Google Maps web endpoints used by Vela are **unofficial**, undocumented, and may change or stop working. A working HTTP response, CORS permission, attribution, and a feature flag do not establish a license to reuse that content.

Google's [Maps consumer terms](https://www.google.com/help/terms_maps/) (modified January 27, 2026) restrict redistribution and creation of services based on Maps content. The [Maps Platform terms](https://cloud.google.com/maps-platform/terms) (modified August 26, 2026) restrict scraping/rehosting, caching, and use with non-Google maps. The official [Routes API policies](https://developers.google.com/maps/documentation/routes/policies) also require Google maps for on-map route results. These platform documents describe the supported API; they do not authorize the keyless web endpoint.

This integration therefore remains disabled by default. A deployer needs **written Google permission that specifically covers use of these web endpoints, display on this MapLibre application, and the proposed server transport** before enabling it. Setting an environment variable is an assertion that such permission already exists; it does not obtain permission. If the permission requires other attribution, retention, or request restrictions, implement those before activation.

```dotenv
ENABLE_LIVE_TRAFFIC=false
GOOGLE_WEB_TRAFFIC_PERMISSION=false
```

Only when that permission has been obtained should both values be changed to `true`, followed by a server restart/redeployment. Either false value disables upstream requests and removes the tile URL from configuration. The disabled interface retains the existing routing fallback and a Google Maps reference link. Google's [Maps URLs](https://developers.google.com/maps/documentation/urls/get-started) are a supported way to open the requested journey in Google Maps without an API key; [Google's geo guidelines](https://about.google/brand-resource-center/products-and-services/geo-guidelines/) expressly allow links to Maps.

## Vela review and implementation provenance

Reviewed the [pinned Vela repository](https://github.com/PimpinPumpkin/Vela/tree/3c8fc207652e7a4fabfe53089de6ccace308ac61), its map traffic URL, `calibration.json` directions request, parser, and [GPL-3.0 license](https://github.com/PimpinPumpkin/Vela/blob/3c8fc207652e7a4fabfe53089de6ccace308ac61/LICENSE). The traffic definition is at actual source lines 460–462 in that revision. GPL permits reuse subject to its conditions; distributing adapted GPL code inside this app could require licensing the resulting covered work under GPL and providing corresponding source. No Kotlin implementation, helper, maneuver parser, calibration file, or Vela test fixture was copied into this project. The new adapter and tests are independently authored from the observed wire format. The request builder constructs functional protocol fields rather than importing the calibration file.

## Routes, geometry, and honest values

Each response route carries its own provider geometry and identity. The adapter requires the indexed E7 geometry, equal route/geometry counts, valid coordinate arrays, plausible geometry length, and endpoints within 500 metres of the requested locations. It rejects missing geometry instead of inventing a straight line. Congestion offsets belong only to that provider route. Unknown grades and malformed/out-of-range spans are omitted without claiming that remaining roads are clear.

Traffic-aware duration is nullable. The second positional duration field is preserved as a **provider baseline** with `baselineDurationKind: 'unknown'`: an authoritative definition distinguishing typical traffic from traffic-free time was not found. Therefore this provider does **not** claim a typical ETA or additional delay. `additionalDelaySeconds` remains null. This is deliberately stricter than Vela's undocumented baseline interpretation. Consumers must not label the baseline as "typical" or compute a delay from it.

`retrievedAt` means the server finished receiving the response. `measurementTime` is null because the web response does not establish a traffic observation timestamp. A successfully retrieved transparent or empty tile does not establish clear traffic or full coverage; tile responses carry `X-Traffic-Coverage: unknown`. No speeds, counts, closures, ETAs, or congestion levels are synthesized.

## Transport and deployment

- Same-origin endpoints: `/api/traffic/config`, `/api/traffic/directions?origin=longitude,latitude&destination=longitude,latitude`, and `/api/traffic/tiles/{z}/{x}/{y}`.
- Upstream host and paths are fixed. Coordinates are bounded to the existing Maldives region, including supported islands outside Greater Malé. Tile coordinates must be canonical integers, zoom 5–20, within XYZ bounds, and intersect that region. Arbitrary URL parameters are rejected. An optional nonnegative integer `generation` is accepted for manual map refresh and is never sent upstream.
- Eight-second request timeout; 1 MiB directions response limit; 256 KiB tile limit; response content-type/PNG checks; redirects are not followed. No cookies, browser impersonation, session warming, challenge handling, or retry bypasses.
- All app responses use `Cache-Control: no-store`. No tile, route, duration, or geometry response is stored in a server cache. Short-lived rate-limit and request timestamps contain metadata only.
- Per process: at most 12 directions/minute/client and 60 globally; 180 tiles/minute/client and 1,000 globally. Identical route requests from a client are throttled for five minutes. Upstream blocking, rate limits, and format errors pause all provider calls for at least five minutes. Cancellation of an obsolete client request does not trigger provider backoff.
- These in-memory limits protect a single server process. A production deployment with several workers or serverless instances needs a shared edge/infrastructure rate limiter before enabling traffic. Configure trusted client-address handling in the deployment adapter; application code does not trust forwarding headers itself.
- The project currently uses `adapter-auto`; no specific production host was identified. These endpoints require a server-capable adapter/runtime with outbound HTTPS. A purely static deployment cannot provide them. Confirm permissions, shared rate limits, client address handling, and timeout behavior for the selected host.

## Verification: live diagnostics versus mocked tests

**Live diagnostics, October 13, 2026:** normal bounded requests were made outside the application; content was not served in the app and response bodies were discarded. No account, cookie, challenge bypass, or access restriction workaround was used. The final independently authored adapter was checked against:

| Driving request                                     | Retrieval time (UTC) | Observed result                                                                                                                      |
| --------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Malé `[73.51, 4.175]` → Hulhumalé `[73.539, 4.211]` | 14:46:49.072         | Three routes with traffic durations, baseline fields, indexed geometry, and congestion spans; first geometry had 131 points.         |
| Malé `[73.51, 4.175]` → airport `[73.529, 4.192]`   | 14:46:49.306         | Three routes with the same field classes; first geometry had 154 points. Airport destination was snapped to a nearby driveable road. |

Initial endpoint diagnostics returned HTTP 200 JSON responses of 62,526 and 57,211 bytes respectively. Directions had no `Access-Control-Allow-Origin` header and `Cache-Control: private, max-age=0`, so direct browser fetch is not viable. Tile diagnostics at `15/23075/16003` and `15/23077/16002` returned HTTP 200 PNGs (3,034 and 1,516 bytes); tile CORS was `*`, and the first tile advertised `public, max-age=60`. The app intentionally uses no-store regardless. These checks establish reachability at retrieval time, not ongoing availability, coverage, source observation time, or permission. Blank-pixel coverage was not classified. Thirteen bounded Google endpoint requests were used in total: eleven directions requests, including payload reduction experiments, and two tiles.

**Mocked unit tests:** authored synthetic positional arrays test parsing, absent durations, malformed JSON, missing/mismatched/implausible geometry, congestion bounds, route identity, wrong journey endpoints, blocked/redirected/rate-limited responses, unexpected formats, network failure, size limits, tile signatures, permission flags, disabled behavior, input validation, refresh throttles, request budgets, and provider backoff. These tests do not demonstrate live coverage or authorization. Live UI rehosting has not been activated because provider permission is absent.

**Application verification:** 980 tests passed across 96 files, including 115 traffic-focused mocked tests. `npm run check` passed with no errors or warnings, and the production build passed with the existing large-chunk warning. Application ESLint and Prettier checks passed. Repository-wide `npm run lint` encountered pre-existing generated files in `product-ad/build` and the separate Vela research checkout; those files were left untouched.

**Rendered UI verification:** tested the production app at desktop widths 1365 and 1920, and mobile sizes 390 × 844 and 390 × 600. Checked toggling, both preset journeys, custom/same-location endpoints, explicit fallback speed assumptions, destination focus, panel closing/reopening, weather coordination and navigation to Data and Forecasts. Street map remained selected after traffic toggles; Policy Atlas was restored afterward. Fixed overlapping mobile proposal results, an obstructed compact traffic trigger and desktop zoom controls, plus a cancelled-refresh loading state. Browser checks exercised the disabled/unavailable and local fallback states. Enabled provider transport and geometry construction are covered by mocked tests; live Google content was not enabled in the browser. No browser console errors were observed.
