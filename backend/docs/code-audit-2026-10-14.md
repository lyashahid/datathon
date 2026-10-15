# Backend code audit — 14 October 2026

The audit preserves source data, route contracts, planning assumptions and provider qualification. Changes target measured response work, concurrency, resource ownership and stale joins.

| Finding | Change | Evidence |
| --- | --- | --- |
| National GeoJSON passed through FastAPI's recursive JSON encoder despite already containing JSON-native data. The all-layer source is 14,973,659 bytes. | Return `JSONResponse` from map features and map context inside their existing synchronous worker functions. | The reproducible installed-data benchmark returned identical SHA-256 and 2,223 features for every response path. Median complete local response time changed from 1.374 s to 0.642 s, a 2.14× improvement. |
| Large JSON transferred uncompressed from the API. | Add framework gzip middleware above 2 KiB at compression level 5. | The same GeoJSON transfers as 5,424,658 bytes, 63.77% smaller. Tests preserve uncompressed JSON equality and leave event streams, JPEG and PNG responses uncompressed. |
| Every weather and marine cache miss held one global async lock, blocking unrelated map locations. Each miss also created another HTTP connection pool. | Share in-flight refreshes by point/type; allow at most eight independent refreshes. Reuse one owned HTTP client and close it, plus pending work, at application shutdown. | Deterministic concurrency tests prove independent points progress together, repeated points call the provider once, disconnected callers do not cancel another caller's refresh, and the pool is reused and closed. |
| Forecast size was checked after downloading its whole body; only individual HTTP operations had timeouts. Malformed provider JSON could produce an unhandled server error. | Stream and cap the body at 1 MB; bound the entire queue/stream operation to 20 s; reject malformed JSON structures as unavailable. | Controlled slow, oversized and malformed source tests verify explicit failure without fabricated readings. Existing null-grid and stale-cache tests still pass. |
| Rounded weather keys reused the first click's `requested` coordinates on nearby cache hits. | Preserve exact caller coordinates while retaining the original grid and source receipt. | Two nearby clicks share one grid cache but return their distinct requested map points. |
| Census exploration cache used only population-file identity, although reconciled rows also depend on island identities. Evidence profiles used the same incomplete fingerprint. | Include the island file in the transformed collection fingerprint and expose its separate dependency receipt. Profile caching now includes the full receipt. | Tests change, add and remove the island dependency while leaving the Census source unchanged, then verify current mapping and geography-coverage profiles. |
| Backtests read their source again when building provenance. A reviewed source change between those reads could attach a different receipt to the calculation. | Read one source snapshot for both calculation and provenance. | A changing-source regression test verifies a single read and its matching receipt. |

Verification completed after these changes:

- `python -m pytest -q`: **568 passed**.
- `ruff check app tests scripts`: **all checks passed**.
- The test runner reports one existing framework deprecation warning for the HTTPX-backed Starlette test client; tests pass.
- `python -m scripts.benchmark_responses --output docs/response-benchmark.json`: identical GeoJSON bytes across the previous response shape, current response and gzip response. The saved measurements include all samples and their scope.

Compression currently reduces the backend-to-proxy hop and direct API transfers. The frontend proxy correctly drops `Content-Encoding` and `Content-Length` after its HTTP client decompresses the response, so these measurements do not claim compressed browser delivery. Browser parsing still handles the complete 14.97 MB national snapshot. A future viewport or vector-tile data contract can reduce that remaining cost; this audit preserves the existing all-geometry bootstrap contract.

Local response timings compare CPU/content paths on this machine. They are not external-provider or deployment latency guarantees. No running server was restarted by the backend audit agent; the coordinating agent applies the completed source through the project's final restart and browser verification.
