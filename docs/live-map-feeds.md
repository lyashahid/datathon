# Live movement and environmental conditions

The map's observations, environmental forecasts and calculated journeys are separate evidence. A current position does not establish a route timetable, occupancy or access score. Weather is a model forecast and does not automatically close roads or cancel ferries.

## Movement providers

FastAPI exposes `GET /api/v1/live/status`, `/live/snapshot` and `/live/stream`; the browser uses the same-origin `/api/backend/` proxy. The current map requests bounded snapshots for its selected scope, pauses while hidden and exposes provider status, freshness and refresh controls.

| Provider                                                                              | Evidence and limits                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [ADSB.lol](https://www.adsb.lol/docs/open-data/api/)                                  | Aircraft receiver observations with source positions and age; not a complete flight or arrival timetable.                                                                                                        |
| [OpenSky](https://opensky-network.org/)                                               | Aircraft fallback with a five-minute provider cooldown/cache. Empty or rate-limited coverage stays explicit.                                                                                                     |
| [Open Waters AIS](https://openwaters.io/api/ais/) and [Facha](https://api.facha.dev/) | Vessel snapshots and a bounded fallback. Missing reception does not establish absence of shipping.                                                                                                               |
| [FollowMe public directory](https://m.followme.mv/public/)                            | Public island/vehicle discovery and selected positions. Private device fields are excluded; classification, source time and unknown freshness are retained. Public access is not an open redistribution licence. |
| RTL                                                                                   | Optional separately authorized bus adapter, disabled by default. Static operator stops and timetables are different evidence.                                                                                    |

Default backend polling/cache settings and optional provider configuration are in [backend setup](../backend/README.md#configuration) and `backend/app/live/config.py`. Bounded requests, retries and provider cooldowns protect upstream services. Provider failures do not block the static map. Reported heading may orient a symbol; interpolation between received positions is not future tracking. See [map interpretation](engaged-map-and-planning.md).

## Weather and marine forecasts

**Weather & traffic** requests `GET /api/v1/conditions/weather` and `/conditions/marine` for the selected map point. [Open-Meteo](https://open-meteo.com/en/docs) and its [marine API](https://open-meteo.com/en/docs/marine-weather-api) supply current/hourly model values, units, model-grid coordinates and retrieval receipts. These are not local sensor readings or official warnings. Missing weather, wave, gust and other values stay null.

The backend keeps a bounded ten-minute process cache, combines identical in-flight requests and limits independent refreshes. A failed refresh can retain the last successful forecast with its original timestamps and an explicit stale warning; without a prior result it reports unavailable. Nearby clicks can share a model grid but retain their exact requested coordinates. Forecast times and the selected transport-scenario date must remain distinguishable.

Weather forecasts do not establish flooded roads, navigable sea conditions, clinical heat outcomes or ferry cancellation probabilities. Reviewed notices and explicitly assumed disruptions use the separate [operations workflow](operations-data.md). [Live traffic](live-traffic.md) describes the consumer directions reference.

## Verification

Maintained browser suites and report locations are in [browser verification](browser-verification.md). Backend provider and conditions tests cover bounded requests, timestamps, missing values, cache/coalescing behavior, stale fallbacks and failure states. The [movement unit tests](../src/lib/movement.test.ts) cover client scope changes and polling lifecycle. A passing mocked test does not establish live provider coverage.
