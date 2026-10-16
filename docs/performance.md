# Performance and computed results

`npm start` serves the optimized Node build at http://127.0.0.1:5173 and prepares FastAPI automatically. The first start builds the frontend. Later starts hash its source, dependencies and build settings and reuse it when unchanged. `npm run dev` retains Vite hot reload for source editing. `npm start -- --force-build` explicitly rebuilds.

## Load only what the visitor needs

The initial country view requests island geometry simplified at 25 metres and a compact national score list. It does not load nationwide facility geometry, detailed score explanations, proposal calculations or planning panels. Country geometry is for display; selecting an island fetches its original boundary and located facilities. Proposal placement uses that canonical boundary, never the simplified country outline.

The map becomes usable independently of national totals and live provider status. Directions, proposal design and weather panels load on demand. Map geometry, styling and movement markers have separate update paths, so a changing budget or quote does not rebuild unrelated map sources.

Malé, Hulhumalé and Hulhulé share a loading region. Opening any of them prepares all three islands' detailed map evidence, local access maps and planning baselines. Shared in-flight requests and the normal browser cache avoid downloading the selected island twice; moving between these islands does not cancel sibling preparation. Successful islands remain usable if a sibling fails, and retry requests only missing analysis. Reviewed source updates clear retained evidence. Proposals still evaluate the selected island; neighbouring baseline shading remains visible during comparison. Hulhulé has transport and road evidence but no separate resident projection, so it receives no fabricated resident heatmap.

Analytics reuses the compact score list. Opening a score fetches its full explanation with loading, retry and cancellation states. Published passenger charts request history without fitting prediction models. Proposal screening reuses the already loaded map rather than downloading national geometry again; screening metadata and local baseline calculations load concurrently.

## Cache hierarchy and freshness

The browser combines identical in-flight GET requests and keeps bounded parsed results. One consumer cancelling does not cancel another consumer's request. Selected public source snapshots may also use Cache Storage across reloads. Conditional ETag requests validate snapshots with the backend; `max-age=0` always validates before displaying a cached response. A failed validation remains a visible failure, rather than presenting old data as current. Source acceptance clears affected browser caches and retries older reads against the new generation.

FastAPI caches serialized deterministic snapshots and expensive model results in bounded memory and compressed local files under ignored `backend/data/runtime`. Keys incorporate source content, model code, configuration and calculation inputs. Concurrent identical calculations share one result. Different proposal operations and assumptions remain distinct. Live movement, weather, traffic, mutations, errors and streamed feeds do not use the persistent snapshot cache.

The backend loads national geography and planning source artifacts as a snapshot. Replacing those files requires a backend restart. Reviewed imports keep their own explicit acceptance and source-version behavior. Cache reuse does not extend the dates or geographic coverage of the underlying evidence.

The Node proxy streams fast gzip for JSON responses, forwards source validators and handles 304 responses. Static JavaScript, CSS and other build assets are precompressed by the Node adapter.

## Automatic background preparation

`npm start` is the only normal startup command. Once the backend starts, it prepares the common analytics and supported island planning views automatically, while continuing to serve requests. It does not delay application readiness until the heavier work completes. Country geography, scores, summary and passenger history are prepared first; forecasts, data analysis, the dataset catalogue and planning views follow sequentially.

The full preparation covers 33 views: four country/history snapshots, three analytics views, planning opportunities, baseline/gap/profile/connectivity reads for Malé, Hulhumalé, Hulhulé and Vilimalé, and nine default healthcare/education/transport impact calculations for the three islands with resident models. Hulhulé has no separate resident projection and receives no resident impact calculation. The same source-versioned cache paths serve real requests, so valid memory, local-disk and optional PostgreSQL results are reused rather than recalculated. Public results can also be mirrored to the shared database.

Each failed job is retried once in the background; a failure does not prevent the remaining jobs from running. Shutdown cancels remaining work. Set `MOBILITY_COMPUTED_CACHE_PREWARM=false` in an ignored backend environment file to disable the entire startup warmup. A reused, already running backend retains its existing settings until restarted.

A first request arriving before its view is prepared calculates normally and shares an identical in-flight calculation where supported. New or changed proposals still evaluate their exact operations and assumptions; startup does not precompute every possible scenario. Preparation reuses the included evidence and does not ingest new source data or change its dates.

For maintenance, the same full preparation can still be run explicitly, for example after restarting with updated source files:

```sh
npm run precompute
```

This optional command reports job timings and cache status and seeds local results and, when configured, the shared database. It is not required for normal use.

## Optional shared PostgreSQL

A fresh clone needs no database configuration: local caching works automatically. To share deterministic results across machines, set `MOBILITY_DATABASE_URL` in ignored `backend/.env`. Keep the connection string server-side. It is excluded from Git and browser assets.

The supplied connection was verified with a write/read round trip in the application cache table. Prisma-style `schema` is translated into a validated PostgreSQL search path. Connections require TLS. The application uses its own `mobility_computed_cache` table, bounded retention and parameterized queries.

Memory and local disk are the primary path. Remote lookups have a small request budget; a background worker handles connections and mirroring. A slow or unavailable database falls back to local calculation and a retry cooldown. Database exception text and credentials are not logged. Test environments disable the shared database.

## Repeatable measurement

With the application running:

```sh
node scripts/measure-frontend-performance.mjs after
```

The real-browser harness saves JSON request timings, transfer sizes, long tasks, runtime errors and screenshots under ignored `artifacts/qa/site-performance`. It uses 1440 × 1000 Chromium with reduced motion and software WebGL, no network throttling and no mocked responses. Each route starts in a fresh browser context, then reloads to measure browser reuse. The backend is warm. Screenshot capture is excluded from readiness timings.

Country readiness means the map and score panel have completed loading. Analytics readiness uses the policy-priorities panel. These local observations are useful for comparing this checkout; they do not promise internet or lower-end device timings. Live-provider response times remain outside the application's control.

The initial baseline was captured on the prior Vite development runtime. The optimized runtime deliberately changes that default. Compare payload sizes as well as readiness times when isolating the causes of an improvement.

### Local results · 15 October 2026

These are observed samples on this computer, with a running backend and populated computed caches. The isolated final run had no concurrent builds or precomputation. A first visit uses a fresh browser context; a reload reuses that browser's caches.

| View                        | Previous first visit | Optimized first visit | Optimized reload |
| --------------------------- | -------------------: | --------------------: | ---------------: |
| Country map and score       |               2.52 s |                1.52 s |           0.56 s |
| Hulhumalé map and score     |               3.81 s |                1.20 s |           1.07 s |
| Analytics policy priorities |               4.23 s |                0.34 s |           0.15 s |

Initial country geography plus scores fell from 21,704,441 to 2,887,385 decoded bytes (86.7% smaller). The final browser received about 406 KB for those two compressed responses. On reload, both returned HTTP 304 with no response body. Detailed island boundaries and streets still load when needed.

The isolated backend harness measured country map reads at 2.9 ms from memory and 13.4 ms from local disk; compact scores at 3.1 ms and 10.9 ms respectively. Data analysis took 1.79 s without a saved result, 57.5 ms on repeat and 70.4 ms from disk. Exact repeated proposal evaluations took 100–119 ms, compared with 498–1,435 ms for their first calculation. New or changed proposals still calculate their real routing impact.

To reproduce backend measurements with a temporary cache and no shared database:

```sh
uv run --directory backend python scripts/benchmark_backend.py
```

Validation passed: 656 backend tests, 142 frontend unit tests, six startup tests and 36 real-browser checks across accessibility, country drill-down, native placement and the full proposal journey. The proposal journey also exported a real PDF and verified narrow-screen layouts. All browser runs recorded zero runtime errors; Svelte diagnostics reported zero errors and warnings.

Local receipts are in `artifacts/qa/site-performance/{before,after-isolated}.json`, `artifacts/qa/backend-performance-after.json` and the individual journey directories. Those runtime artifacts are excluded from Git.

Implementation references: [SvelteKit Node adapter](https://svelte.dev/docs/kit/adapter-node) and [Vite production deployment](https://vite.dev/guide/static-deploy.html).

### Local verification · 16 October 2026

This verification uses the current national data model and a running Uvicorn/Vite development environment. Serial loopback API requests measure complete response bodies, decoded and compressed size, and separate JSON parsing. The first observed request is **not a cold server start**: startup preparation, previous visitors, local files and shared results may already have warmed it. API timing excludes browser rendering, the frontend proxy and a visitor's network. The dated 15 October browser figures above remain a separate measurement.

The source of ordinary island geography, population, walking networks, official facilities, transport evidence and contextual datasets is the prepared local artifacts in `data/public` and `backend/data/cache`. Forecast calculations also start from local, reviewed source models. PostgreSQL is an optional development cache of computed results, rather than the authoritative dataset store. The running development backend had an established database connection and a read-only cache-table query succeeded; production and test settings explicitly disable this connection. Reviewed notice/import workflow uses its own local SQLite store.

Primary MapLibre maps draw the application's GeoJSON over a local background; they do not need an external base-tile service. Weather and marine panels request Open-Meteo and retain a 10-minute process cache. Places uses external provider queries with a two-minute process response cache and a six-hour identity cache; it has no PostgreSQL or disk result cache. Live movement uses provider-specific short caches and explicit age/coverage states. Places imagery is a separate external request. Successful HTTP responses do not establish fresh observations or complete provider coverage.

Profiling exposed a national-data regression: an already cached proposal evaluation still spent about 1.4 seconds encoding the entire baseline merely to construct its cache key. The repository now memoizes its deterministic content fingerprint by mutation revision. Nested source edits, version changes and snapshot replacement invalidate that fingerprint; scenario copies remain independent. Private-cache checks confirmed that repeated and directly computed results are identical. The first fingerprint is still computed once, typically during background preparation. This improves repeated evaluations without precomputing arbitrary proposals or changing model results.

The final API sweep ran after tests/builds finished, with the restarted backend's 33 background preparation jobs complete and the browser idle. All 29 intended endpoints returned HTTP 200 in four timed requests each; 18 supported conditional checks returned 304 with no body. Repeated figures below are medians of the last three requests.

| API request | First observed | Repeated median |
| --- | ---: | ---: |
| Country island map, simplified | 20 ms | 21 ms |
| Compact national scores | 7 ms | 7 ms |
| Scoped planning baselines, four islands | 12–713 ms | 11–26 ms |
| Island detail, four islands | 250–634 ms | 4–6 ms |
| Island profile, four islands | 6–279 ms | 4–10 ms |
| Dataset catalogue | 32 ms | 30 ms |
| Dataset rows, 50 origins | 10 ms | 7 ms |
| Published passenger history | 3 ms | 2 ms |
| Forecast analysis | 77 ms | 78 ms |
| Baseline evaluation, Malé | 2,732 ms | 23 ms |
| Baseline evaluation, Hulhumalé | 1,118 ms | 15 ms |
| Baseline evaluation, Addu Hithadhoo | 403 ms | 9 ms |
| Baseline evaluation, Laamu Hithadhoo | 229 ms | 8 ms |
| Hypothetical school evaluation, Addu Hithadhoo | 428 ms | 9 ms |
| School quote | 57 ms | 54 ms |
| Addu Hithadhoo journey | 134 ms | 145 ms |

Before the fingerprint fix, repeated live evaluations for these requests took 1.19–1.65 seconds. They now take 8–23 milliseconds; private-cache CPU profiles independently confirm removal of the repeated serialization. Journey requests also reuse the unchanged national network before island scoping, reducing the measured repeated journey from 2.66 seconds to 145 milliseconds. All five evaluation response bodies and the journey response are byte-for-byte identical before and after, verified by SHA256. New operations still calculate their exact impact, and the slower first observed computations above remain relevant.

The actual initial map uses 1.39 MB of decoded island geometry (about 347 KB compressed) and compact scores; the optional unscoped 15 MB full map and 31 MB planning baseline are not normal initial UI requests. Earlier provider probes measured weather, marine and Places lookups at about 0.54–0.91 seconds on the first observed query and 3–8 milliseconds on repeat. Those provider samples predate the restart and depend on their short-lived caches. Replaying an old Places identity after restart correctly requires a fresh search or a detail request with name/coordinates; that unintended replay is recorded separately from the successful timing sweep.

Detailed requests, source/cache architecture, database availability evidence and before/after CPU profiles are retained in `artifacts/qa/loading-verification-2026-10-16.json`. Its private-cache measurements use temporary storage with PostgreSQL disabled and never clear the running application's cache.

The optimized Node frontend was also started temporarily on port 5174 and visually checked against the same backend. Country, Addu Hithadhoo, Malé and Hulhumalé maps rendered successfully with no application console errors. Browser-control navigation observations were about 6.4–7.4 seconds for the island maps, but included repeated three-second controller deadlines/stale-element retries. These are conservative automation observations, not reliable paint or LCP measurements, and must not be compared directly with the 15 October browser harness. The incomplete country sample is excluded. Raw observations are in `artifacts/qa/app-verification/browser-readiness-observations.json`; the temporary frontend and its test tab were closed afterward.

Final validation: 911 backend tests, 307 frontend tests and nine startup tests passed; Ruff, frontend lint, Svelte diagnostics and the production build passed. The refreshed-server data audit passed all 60 collections and 65,345 rows, including CSV exports, 58 nonempty default charts, facility/profile joins and source receipts. All 186 added resident meshes conserve their origin contributions and projected totals. Malé and Hulhumalé retain their original mesh geometry and regression results.
