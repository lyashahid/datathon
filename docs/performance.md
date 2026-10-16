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
