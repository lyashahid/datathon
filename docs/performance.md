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

## Optional shared PostgreSQL in development

A fresh clone needs no database configuration: local caching works automatically. For development experiments sharing deterministic results across machines, set `MOBILITY_DATABASE_URL` in ignored `backend/.env`. Keep the connection string server-side. It is excluded from Git and browser assets. Production keeps this optional cache disabled; the server measurements below explain that decision.

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

| API request                                    | First observed | Repeated median |
| ---------------------------------------------- | -------------: | --------------: |
| Country island map, simplified                 |          20 ms |           21 ms |
| Compact national scores                        |           7 ms |            7 ms |
| Scoped planning baselines, four islands        |      12–713 ms |        11–26 ms |
| Island detail, four islands                    |     250–634 ms |          4–6 ms |
| Island profile, four islands                   |       6–279 ms |         4–10 ms |
| Dataset catalogue                              |          32 ms |           30 ms |
| Dataset rows, 50 origins                       |          10 ms |            7 ms |
| Published passenger history                    |           3 ms |            2 ms |
| Forecast analysis                              |          77 ms |           78 ms |
| Baseline evaluation, Malé                      |       2,732 ms |           23 ms |
| Baseline evaluation, Hulhumalé                 |       1,118 ms |           15 ms |
| Baseline evaluation, Addu Hithadhoo            |         403 ms |            9 ms |
| Baseline evaluation, Laamu Hithadhoo           |         229 ms |            8 ms |
| Hypothetical school evaluation, Addu Hithadhoo |         428 ms |            9 ms |
| School quote                                   |          57 ms |           54 ms |
| Addu Hithadhoo journey                         |         134 ms |          145 ms |

Before the fingerprint fix, repeated live evaluations for these requests took 1.19–1.65 seconds. They now take 8–23 milliseconds; private-cache CPU profiles independently confirm removal of the repeated serialization. Journey requests also reuse the unchanged national network before island scoping, reducing the measured repeated journey from 2.66 seconds to 145 milliseconds. All five evaluation response bodies and the journey response are byte-for-byte identical before and after, verified by SHA256. New operations still calculate their exact impact, and the slower first observed computations above remain relevant.

The actual initial map uses 1.39 MB of decoded island geometry (about 347 KB compressed) and compact scores; the optional unscoped 15 MB full map and 31 MB planning baseline are not normal initial UI requests. Earlier provider probes measured weather, marine and Places lookups at about 0.54–0.91 seconds on the first observed query and 3–8 milliseconds on repeat. Those provider samples predate the restart and depend on their short-lived caches. Replaying an old Places identity after restart correctly requires a fresh search or a detail request with name/coordinates; that unintended replay is recorded separately from the successful timing sweep.

Detailed requests, source/cache architecture, database availability evidence and before/after CPU profiles are retained in `artifacts/qa/loading-verification-2026-10-16.json`. Its private-cache measurements use temporary storage with PostgreSQL disabled and never clear the running application's cache.

The optimized Node frontend was also started temporarily on port 5174 and visually checked against the same backend. Country, Addu Hithadhoo, Malé and Hulhumalé maps rendered successfully with no application console errors. Browser-control navigation observations were about 6.4–7.4 seconds for the island maps, but included repeated three-second controller deadlines/stale-element retries. These are conservative automation observations, not reliable paint or LCP measurements, and must not be compared directly with the 15 October browser harness. The incomplete country sample is excluded. Raw observations are in `artifacts/qa/app-verification/browser-readiness-observations.json`; the temporary frontend and its test tab were closed afterward.

Final validation: 911 backend tests, 307 frontend tests and nine startup tests passed; Ruff, frontend lint, Svelte diagnostics and the production build passed. The refreshed-server data audit passed all 60 collections and 65,345 rows, including CSV exports, 58 nonempty default charts, facility/profile joins and source receipts. All 186 added resident meshes conserve their origin contributions and projected totals. Malé and Hulhumalé retain their original mesh geometry and regression results.

### PostgreSQL storage experiment · 17 October 2026

The existing production server was tested against the supplied PostgreSQL database before changing database usage. This was a read-only experiment against the application's existing `mobility_computed_cache` table. Each sample used the same compressed cache bytes for database and isolated temporary disk reads, with the application's integrity check and decompression; every successful result matched the original decoded payload's SHA256. Memory reads used the application's hydrated cache. No source, production configuration or database data was changed.

| Compressed / decoded payload | Server memory median | Server disk median | Server PostgreSQL median | Laptop disk median |   Laptop PostgreSQL median |
| ---------------------------- | -------------------: | -----------------: | -----------------------: | -----------------: | -------------------------: |
| 1,104 / 3,450 bytes          |             0.006 ms |            0.26 ms |                 25.54 ms |            0.43 ms |                  181.18 ms |
| About 48 KB / 0.3–0.4 MB     |             0.015 ms |            2.94 ms |                 16.39 ms |            1.08 ms |                  189.62 ms |
| 511,037 / 2,811,239 bytes    |              1.36 ms |           17.64 ms |                 85.84 ms |            6.43 ms |                  239.77 ms |
| 5,355,056 / 16,141,273 bytes |              6.36 ms |          119.03 ms |               772.92 ms* |           49.92 ms | No successful timed reads* |

_The largest server sample had seven successful timed database reads and one statement timeout; its database median includes successful reads only. All eight timed laptop reads of that sample timed out. The existing 750 ms SQL statement limit was retained; end-to-end timeout observations include transport and cancellation delivery and can exceed that limit. The second sample differs slightly between machines because the laptop selected a matching existing local/database key while the server selected an existing database sample nearest the same target size. Exact byte counts and all individual observations are in the receipts._

These are storage-tier observations, not page-load or API benchmarks: eight serial timed samples per tier followed one warmup, with randomized tier order, an established database connection and a warm operating-system file cache. The server's existing local cache had no matching database keys, so database payloads were copied into isolated temporary files for the disk comparison and removed afterward. This tests identical content, rather than claiming the database contained a valid result for the running production source version. Initial database connection took 157 ms on the server and 1.30 seconds on the laptop; those connection costs are excluded from the table. With eight observations, nearest-rank p95 is just the largest sample and does not establish production tail latency or concurrency capacity.

For this single-server deployment, the existing persistent runtime volume, memory cache and compressed disk cache remain the production path. PostgreSQL was slower than disk at every tested size, and merely relocating the same source JSON into database columns would still require the existing full-data decoding, in-memory routing and model calculations. The current optional database reader also waits only 10 ms before local computation, so most of the measured database reads would not avoid that first calculation. No database migration or production database enablement was retained. A shared database may still help future multiple-server deployments, empty-disk recovery or selective indexed queries; those are different workloads and need their own measurements.

Reproducible read-only scripts and sanitized receipts are retained under ignored `artifacts/qa/postgres-evaluation/`: `compare_cache_tiers.py`, `run_server_cache_comparison.py`, `server-cache-tiers.json` and `laptop-cache-tiers.json`. Credentials were supplied only through server-side settings and SSH stdin, never command arguments, receipts or logs.

### Manual production verification · 17 October 2026

The national-data release `a665b83` was built on the existing server and released manually over the trusted administrator SSH connection. Both immutable image IDs passed the existing Compose health waits in 57 seconds; the public HTTPS backend health check also returned production/ok. The prior image pair is preserved in a protected rollback manifest. Actions deployment is disabled while this manual release is active. PostgreSQL remains disabled, so the release comparison below is a data/code deployment comparison, not a database migration result.

Before release, an isolated candidate used the production 3 GiB / 2 CPU limits, an empty temporary runtime cache, no production state mounts and no external network. It passed all eight API checks, including 60 dataset collections, Malé/Hulhumalé resident baselines, Hithadhoo's 152 display hexagons and a no-op planning evaluation. Observed cold startup was 45 seconds. First-use catalogue and Hithadhoo opportunity requests took 10.9 and 12.9 seconds, scoped baselines took 196–354 ms, and the first Hithadhoo evaluation took 4.0 seconds. Peak cgroup memory was 1.75 GiB, with no OOM or limit events. These cold costs are real; persistent result storage and sequential background preparation reduce repeated work but do not make an empty-cache deployment instantaneous.

The live release completed all 33 background preparation jobs in 87.2 seconds. All 12 production correctness checks then passed: national chart totals for 186 added resident islands and 10,853 origins, origin-to-hexagon conservation, both Hithadhoo models, unchanged capital mesh counts, official context, planning economics, journeys, forecasts and provider attribution. Seven public resources each passed a normal GET followed by a matching ETag request returning 304 with zero response-body bytes.

The live browser also rendered the health heatmaps for Addu Hithadhoo, Laamu Hithadhoo, Malé and Hulhumalé, with no captured console errors. The API gate verified their respective 152, 83, 298 and 591 display hexagons. Screenshots are saved as `production-hithadhoo.png`, `production-laamu-hithadhoo.png`, `production-male.png` and `production-hulhumale.png` in the same ignored receipt directory. These visual checks confirm rendering, rather than browser load-time measurements.

The same bounded public HTTPS benchmark was run before and after release while builds, preparation and correctness checks were idle. Each run made 20 serial GETs (two per endpoint) and nine requests in three groups of three. Both returned 29/29 HTTP 200. Complete-body timings include this computer's internet connection, the HTTPS proxy, compression and transfer; they exclude browser rendering. These two-sample serial medians are descriptive observations, not stable percentiles or evidence of statistically established changes.

| Public request                   | Previous release | National-data release |
| -------------------------------- | ---------------: | --------------------: |
| Homepage                         |           598 ms |                673 ms |
| Country island map               |           642 ms |                700 ms |
| Compact national scores          |           258 ms |                366 ms |
| Malé planning baseline           |           249 ms |                320 ms |
| Hulhumalé planning baseline      |           352 ms |                285 ms |
| Addu Hithadhoo planning baseline |           203 ms |                470 ms |
| Addu Hithadhoo profile           |           214 ms |                215 ms |
| Addu Hithadhoo heatmap detail    |           205 ms |                256 ms |
| Dataset catalogue                |           343 ms |                410 ms |
| Published passenger history      |           201 ms |                225 ms |

Country map bytes were identical across releases despite timing variation. Capital baselines gained less than 0.4% decoded metadata, with mixed timing directions. Hithadhoo's baseline now carries 1.306 MB decoded versus 128 KB previously, while its opportunity/heatmap detail grew from 3.8 KB to 522 KB as detailed models became available. Those response changes must be considered before interpreting its longer baseline transfer. In the three-request groups, new-release medians were 617 ms for country, 489 ms for Malé and 569 ms for Hithadhoo; the largest individual observation was 1.28 seconds. This bounded check does not establish load capacity, p95 latency, browser paint or LCP.

After these checks, backend Docker memory was 1.70 GiB, compared with about 0.85 GiB before the national expansion; cgroup peak was 1.84 GiB within the existing 3 GiB limit. Idle CPU was 0.32%, with zero restarts, OOM or limit events. Frontend memory was 56 MiB; the shared host had about 4.9 GiB available RAM and 98 GiB free disk. These observations support the current single-server deployment, while the larger resident/network models do consume more memory. No CDN or production database was introduced.

Sanitized receipts, exact image identities and the rollback-manifest path are under ignored `artifacts/qa/postgres-evaluation/`: `manual-deployment.json`, `baseline-original-production.json`, `after-manual-production.json`, `independent-http-comparison.json`, `conditional-cache-checks.json`, `production-policy-gate/api-report.json`, `preflight-backend-a665b83.json` and `server-after-benchmark-state.json`.
