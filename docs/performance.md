# Performance and computed results

`npm start` serves the optimized Node build at http://127.0.0.1:5173 and prepares FastAPI automatically. The first start builds the frontend. Later starts hash its source, dependencies and build settings and reuse it when unchanged. `npm run dev` retains Vite hot reload for source editing. `npm start -- --force-build` explicitly rebuilds.

## Load only what the visitor needs

The initial country view requests island geometry simplified at 25 metres and a compact national score list. It does not load nationwide facility geometry, detailed score explanations, proposal calculations or planning panels. Country geometry is for display; selecting an island fetches its original boundary and located facilities. Proposal placement uses that canonical boundary, never the simplified country outline.

The map becomes usable independently of national totals and live provider status. Directions, proposal design and weather panels load on demand. Map geometry, styling and movement markers have separate update paths, so a changing budget or quote does not rebuild unrelated map sources.

The national sea network loads independently of the selected island. Island selection and hiding/restoring the sea layer reuse that loaded network; an inspector date change refreshes its matching pressure week. Timetable source preparation stays outside map-open requests. See [official sea services](official-sea-services.md).

Domestic air connections use the same source-invalidated disk cache and automatic background preparation as sea connections. Neither fetches provider pages during map requests. Sea and air route geometry stays in static map sources; a separate small point source animates route vehicles at eight updates per second, pausing when the page/workspace is hidden or reduced motion is enabled. See [domestic flight connections](domestic-flight-services.md).

Sea and air Layers switches change visibility without preparing route geometry or vehicle paths again. Terminal and live-observation layers remain independently visible.

Malé, Hulhumalé and Hulhulé share a loading region. Opening any of them prepares all three islands' detailed map evidence, local access maps and planning baselines. Shared in-flight requests and the normal browser cache avoid downloading the selected island twice; moving between these islands does not cancel sibling preparation. Successful islands remain usable if a sibling fails, and retry requests only missing analysis. Reviewed source updates clear retained evidence. Proposals still evaluate the selected island; neighbouring baseline shading remains visible during comparison. Hulhulé has transport and road evidence but no separate resident projection, so it receives no fabricated resident heatmap.

Analytics reuses the compact score list. Opening a score fetches its full explanation with loading, retry and cancellation states. Published passenger charts request history without fitting prediction models. Proposal screening reuses the already loaded map rather than downloading national geometry again; screening metadata and local baseline calculations load concurrently.

## Cache hierarchy and freshness

The browser combines identical in-flight GET requests and keeps bounded parsed results. One consumer cancelling does not cancel another consumer's request. Selected public source snapshots may also use Cache Storage across reloads. Conditional ETag requests validate snapshots with the backend; `max-age=0` always validates before displaying a cached response. A failed validation remains a visible failure, rather than presenting old data as current. Source acceptance clears affected browser caches and retries older reads against the new generation.

The persistent browser cache retains at most 32 entries. Eviction favours startup national, sea, air and planning-baseline snapshots over changing viewport or island reads; their source validators remain unchanged.

FastAPI caches serialized deterministic snapshots and expensive model results in bounded memory and compressed local files under ignored `backend/data/runtime`. Keys incorporate source content, model code, configuration and calculation inputs. Concurrent identical calculations share one result. Different proposal operations and assumptions remain distinct. Live movement, weather, traffic, mutations, errors and streamed feeds do not use the persistent snapshot cache.

Directions reuse source/day-specific stop, transfer and timetable indexes instead of rebuilding a national router for every leg. Road snapping also reuses spatial indexes. Each request still routes its own ordered points and mode. Exact directions results have a separate local cache keyed by source, effective service day, graph revision and complete request inputs; they are not mirrored to the optional shared PostgreSQL cache.

The national sea network also persists its deterministic routes, qualified pressure calculations and safe geometry. Its key includes the service date, code/source version, baseline, reviewed schedules, terminal catalogue, shoreline and corridor evidence. Copying unchanged source files with different timestamps still reuses the same result; accepting a changed reviewed schedule invalidates it. Live vessel positions and weather remain separate.

Sea and air GET responses also use the existing serialized HTTP cache, allowing conditional requests to return 304 without decoding, copying and serializing the full network again. This layer reuses each service's complete calculation inputs, including mutable accepted timetables and corridor evidence. The air endpoint's omitted date resolves to the current Maldives day for its key, so a running process does not retain yesterday's default response. Invalid dates, failed source receipts and error responses remain uncached.

The backend loads national geography and planning source artifacts as a snapshot. Replacing those files requires a backend restart. Reviewed imports keep their own explicit acceptance and source-version behavior. Cache reuse does not extend the dates or geographic coverage of the underlying evidence.

The Node proxy streams fast gzip for JSON responses, forwards source validators and handles 304 responses. Static JavaScript, CSS and other build assets are precompressed by the Node adapter.

Map sources skip redundant empty-to-empty updates after initialization. Geography readiness follows a completed render with the island source loaded, instead of waiting for unrelated live/route/street sources to become idle. It still waits for the actual island source and render, and preserves request-version/unmount cancellation. This removes unrelated work from the blocking map-loading state; it does not imply that every optional layer has finished rendering.

Initial missing-content states share a CSS skeleton shimmer for search, directions, island scores/details, evidence and analytics. Retained data stays visible during refreshes. Reduced motion disables the shimmer; no timers, extra requests or animation dependencies are added.

## Automatic background preparation

`npm start` is the only normal startup command. Once the backend starts, it prepares the common analytics and supported island planning views automatically, while continuing to serve requests. It does not delay application readiness until the heavier work completes. Country geography, scores, summary, passenger history and the national sea network for the current Maldives date are prepared first. The default directions indexes, forecasts, data analysis, the dataset catalogue and planning views follow sequentially.

The full preparation covers 36 jobs: six country/history/sea/air reads, one internal directions-index preparation, three analytics views, planning opportunities, baseline/gap/profile/connectivity reads for Malé, Hulhumalé, Hulhulé and Vilimalé, and nine default healthcare/education/transport impact calculations for the three islands with resident models. Hulhulé has no separate resident projection and receives no resident impact calculation. The same source-versioned cache paths serve real requests, so valid memory, local-disk and optional PostgreSQL results are reused rather than recalculated. Directions preparation builds reusable stop, timetable and transfer indexes for the bundled reference day; another day may require its own first preparation.

When PostgreSQL is enabled, background preparation restores a manifest matching the source snapshot and backend model, then hydrates a bounded batch of public cache entries before warming the views. The batch is limited to 32 MiB compressed, entries retain integrity/expiry checks, and local disk/memory limits still apply. After preparation, public keys and a matching manifest are mirrored for future restarts. Database unavailability does not delay API readiness or prevent the normal local calculations.

Each failed job is retried once in the background; a failure does not prevent the remaining jobs from running. Shutdown cancels remaining work. Set `MOBILITY_COMPUTED_CACHE_PREWARM=false` in an ignored backend environment file to disable the entire startup warmup. A reused, already running backend retains its existing settings until restarted.

A first request arriving before its view is prepared calculates normally and shares an identical in-flight calculation where supported. New or changed proposals still evaluate their exact operations and assumptions; startup does not precompute every possible scenario. Preparation reuses the included evidence and does not ingest new source data or change its dates.

For maintenance, the same full preparation can still be run explicitly, for example after restarting with updated source files:

```sh
npm run precompute
```

This optional command reports job timings and cache status and seeds local results and, when configured, the shared database. It is not required for normal use.

Production stores these compressed results in the existing persistent `state/runtime` mount. A container restart or image replacement preserves that directory; changed source or backend code selects a different key. The default serialized-memory budget is 64 MiB/256 entries, local disk is 512 MiB/1,024 files, and entries expire after seven days. Parsed service/index caches are separate, bounded allocations; these budgets are not a limit on the backend process. Cache reuse does not remove the memory needed to load national geography.

## Optional shared PostgreSQL

A fresh clone needs no database configuration: local caching works automatically. To share deterministic public results across machines and restarts, set `MOBILITY_DATABASE_URL` in ignored `backend/.env`, or in the protected production backend environment, and explicitly enable `MOBILITY_COMPUTED_CACHE_POSTGRES_ENABLED=true`. Keep the connection string server-side. It is excluded from Git and browser assets. Production retains memory/disk as its fast path; PostgreSQL supplies background hydration and persistence.

A production-host probe on 20 October 2026 connected and counted the existing cache table in 124 ms, while the same database timed out from the local development network even with a ten-second connection timeout. These network-specific observations do not compare storage tiers. Prisma-style `schema` is translated into a validated PostgreSQL search path. Connections require TLS. The application uses only its existing `mobility_computed_cache` table, bounded retention and parameterized queries; runtime never creates schema or imports authoritative data.

Memory and local disk are the primary path. Remote lookups have a small request budget; a background worker handles connections and mirroring. A slow or unavailable database falls back to local calculation and a retry cooldown. Database exception text and credentials are not logged. Test environments disable the shared database.

## Repeatable measurement

With the application running:

```sh
node scripts/measure-frontend-performance.mjs after
```

The real-browser harness saves JSON request timings, transfer sizes, long tasks, runtime errors and screenshots under ignored `artifacts/qa/site-performance`. It uses 1440 × 1000 Chromium with reduced motion and software WebGL, no network throttling and no mocked responses. Each route starts in a fresh browser context, then reloads to measure browser reuse after deferred street/live requests settle. The backend is warm. Screenshot capture and pre-reload settling are excluded from readiness timings.

Map readiness now waits for geography, the score/heatmap and both national network snapshots, recording their availability separately and concurrently. Analytics readiness uses the policy-priorities panel. These local observations are useful for comparing this checkout; they do not promise internet or lower-end device timings. Live-provider response times remain outside the application's control.

Compare the same runtime, source version, cache state and request payloads when measuring a change. Development and optimized builds are different workloads; screenshot readiness does not establish paint, LCP or lower-end device performance.

A local development before/after run reduced Analytics requests from 9 to 7 on first load and from 8 to 7 on reload by removing map-only sea loading and a duplicate score read. Against the optimized Node build and warmed backend, one fresh-context/reload sample observed:

| Page            | Fresh browser context |   Reload |
| --------------- | --------------------: | -------: |
| Country map     |              2,455 ms |   949 ms |
| Selected island |              1,434 ms | 2,805 ms |
| Analytics       |                384 ms |   192 ms |

Map readiness remained variable; these observations do not establish a map loading speedup. The receipts are `artifacts/qa/site-performance/frontend-before.json`, `frontend-after.json` and `production-after.json`. The production inline directions check used real named stops and confirmed the same journey on repeat. Its API took 37/22 ms and click-to-render took 551/664 ms; that separate two-stop request is not the three-stop backend benchmark below. See `artifacts/qa/site-performance/production-directions.json`.

After the route visual/cache pass on 20 October, the optimized build with a warm backend observed country readiness at 2,704/1,542 ms, selected-island readiness at 2,162/2,306 ms, and analytics at 590/242 ms for fresh contexts/reloads. Both network reloads returned 304 with no response body. An earlier immediate-reload sample overlapped deferred street/live work and took 4,440 ms for the island; the harness now settles that work before starting the reload timer. A separate settled-page island reload profile completed in 1,775 ms; native/program and MapLibre shader work dominated its main-thread samples. These variable rendering observations do not establish an overall map loading speedup. Receipts are `artifacts/qa/site-performance/route-visual-settled.json` and `artifacts/qa/air-network/map-reload-profile.json`.

## Backend measurement

Use a temporary cache with PostgreSQL disabled to separate first calculations from reuse:

```sh
uv run --directory backend python scripts/benchmark_backend.py
```

The script writes ignored `artifacts/qa/backend-performance-after.json`. Serial loopback API timings exclude browser rendering, the frontend proxy and the visitor's network. A first observed request is not necessarily a cold start: background preparation, earlier visitors or disk results may already have warmed it. Compare response hashes when checking a performance change, and report source version, decoded/compressed bytes and the calculation's exact inputs.

A focused network check on 20 October used the real retained data for that service date and isolated temporary caches, with PostgreSQL disabled. Sea retained 162 route records with 109 mapped lines; air retained 17 mapped connections. Timings below exclude shared source loading and use filesystem data that may already be warm:

| Service | Empty-cache calculation and write | Same-service median, 5 reads | Fresh service and cache instance, disk read |
| ------- | --------------------------------: | ---------------------------: | ------------------------------------------: |
| Sea     |                          491.7 ms |                     18.35 ms |                                    81.28 ms |
| Air     |                          10.74 ms |                      3.11 ms |                                    22.41 ms |

Fresh-instance disk checks replaced the calculation function with a failure and verified identical response hashes, proving reuse rather than recalculation. Sea service construction separately spent 552–661 ms hashing the national shoreline; shared source loading and initial source/baseline fingerprints are additional startup costs. The air calculation alone took 0.14 ms median, so retaining another parsed cache or adding a startup job was not justified. Existing bounded storage is sufficient.

Using the same loaded services and identical responses, an isolated FastAPI TestClient comparison measured median sea GET time of 30.46 ms through the endpoint versus 5.66 ms through the serialized fast path; air was 7.83 versus 5.52 ms. Conditional 304 responses took 6.42/5.89 ms for sea/air, with no body. Each tier had five serial samples. These measurements exclude real network transport, browser rendering, process startup and the optional database; they establish response-processing savings for this checkout, not visitor loading times. The reproducible ignored script and receipt are `artifacts/qa/network-cache/measure.py` and `measurement.json`.

Repeated model evaluations memoize the baseline fingerprint by mutation revision, avoiding full baseline serialization merely to construct a cache key. Source edits and replacement invalidate that fingerprint; scenario copies remain independent. This reduces repeated work without precomputing arbitrary proposals or changing results.

A real three-stop transit request used Maafannu Bus Terminal, a Hulhumalé stop, and another Hulhumalé stop, service date `2026-10-10`, departing at 15:20. Serial loopback measurements on the same local checkout/data showed:

| Workload                                      |                     Before |                       After |
| --------------------------------------------- | -------------------------: | --------------------------: |
| Direct calculation with prepared source data  | 4,429–4,912 ms (2 samples) |    10.0–10.2 ms (2 samples) |
| Repeated backend HTTP request                 |        4,933 ms (1 repeat) |  4.38 ms median (4 repeats) |
| Repeated request through optimized Node proxy |                          — | 15.10 ms median (4 repeats) |

The first unprepared calculation still spent 2,064 ms preparing indexes. After the background jobs completed, the first HTTP request took 48.42 ms; repeat timings then included exact-result reuse. Changing departure to 15:21 calculated a distinct result in 21.27 ms, reducing the modeled journey from 57.224 to 56.224 minutes. Repeated decoded responses had matching hashes. The full payload, samples and methodology are in ignored `artifacts/qa/directions-performance.json`. These are local warm-service observations, not visitor network or cold-start guarantees.

That local restart completed all 35 background jobs in 31.0 seconds after readiness. The warm process used about 1.81 GiB working memory, with a 1.87 GiB peak; cache improvements do not make the national source snapshot small. The older constrained deployment observations below describe a different runtime and workload.

A focused Windows disk-maintenance experiment compared the original two-stat `Path.glob` scan with a single-stat `os.scandir` scan, alternating five batches of ten strict quota checks per size on local temporary storage. Median time per scan was:

| Retained cache files |  Original | Updated |
| -------------------- | --------: | ------: |
| 64                   |   6.53 ms | 0.27 ms |
| 256                  |  23.67 ms | 0.86 ms |
| 1,024                | 100.02 ms | 3.17 ms |

The same byte/count/age limits still run after every write; there is no delayed quota enforcement. This measures cache maintenance on this Windows filesystem, not total API latency or Linux production performance. The ignored receipt is `artifacts/qa/cache-performance/comparison.json`.

## Storage and deployment trade-offs

A read-only experiment on 17 October 2026 compared identical compressed payloads through memory, isolated local files and the existing PostgreSQL cache, including integrity checks and decompression. Eight serial samples per tier followed one warmup with randomized tier order. PostgreSQL was slower than disk at every tested size; the largest laptop database reads timed out. These observations support memory and disk for the current single-server deployment. They do not establish database performance for indexed queries, multiple servers, concurrency or production tail latency.

The national-data release's isolated 3 GiB / 2 CPU preflight measured about 45 seconds to cold API readiness and 1.75 GiB peak backend memory. Its later live preparation took about 87 seconds for 33 jobs. These are dated observations, not startup guarantees: empty caches and first calculations still have real costs. Deployment and rollback instructions remain in the [deployment guide](deployment.md); historical local screenshots, image IDs and timing receipts are generated evidence rather than setup dependencies.

Keep performance claims scoped to their measurement. Successful responses do not certify fresh provider observations, source completeness, model accuracy or responsiveness on another device.
