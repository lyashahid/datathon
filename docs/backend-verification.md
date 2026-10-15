# Supplied backend verification

This records the initial migration. Current extended-backend and browser verification is documented in [policy-expansion.md](policy-expansion.md).

Verified on 14 October 2026 using the project copy at `backend/`. The source was
`C:\Users\cena2\Downloads\backend\backend`; the Downloads copy was not modified.
The imported cached data remains the authoritative data snapshot for this revamp.

## Result

- `uv sync --dev` installed the locked environment using uv-managed Python 3.14.7.
- `uv run pytest`: **85 passed**. The original suite had 57 tests; 28 regression
  cases were added for defects discovered during migration.
- `uv run ruff check .`: **passed**, including the supplied review scripts.
- `uv run python -m scripts.verify_backend`: **67 real HTTP checks passed**.
- Offline `CacheValidator` verification: **13 of 13 required artifacts valid**,
  with correct structures and SHA-256 checksums, no errors or warnings.
- All 13 deterministic artifacts remained byte-for-byte unchanged during the
  integration run. Source acquisition and provider refresh were not run.

The reproducible integration report is
[`backend/data/metadata/integration-report.json`](../backend/data/metadata/integration-report.json).
The script is [`backend/scripts/verify_backend.py`](../backend/scripts/verify_backend.py).
Run it from `backend/` while the API is listening on port 8000.

The API was verified at `http://127.0.0.1:8000`. Development processes are
temporary; use `npm run dev` to start both services in a new session.

## What was exercised

The 67 requests cover all 16 published API paths: health, OpenAPI schema,
national summary, paginated and filtered islands, island detail and profile,
all four map layers, unlocated map records, accessibility summary and scoring,
land and marine routing, scenario runs and comparisons, recommendations, live
status and snapshot, and a bounded one-shot SSE stream.

Land routing was checked using all five modes: walk, bicycle, car, taxi, and bus.
Real Malé OSM graph endpoints returned connected routes. A supplied ferry edge
returned `unreachable` under verified passenger routing and a 1,614.104 m route
with `include_unverified=true`, preserving the backend's verification policy.

Every scenario operation type was applied against real cached graph or transport
IDs: bus stop addition/move/removal, ferry terminal addition/move/disable, ferry
route addition/removal/change, parking, park-and-ride, mobility hub, road closure,
pedestrian connection, airport access improvement, and weather disruption. A
road closure comparison removed one land edge. A subsequent empty scenario
matched the original baseline, confirming scenario isolation.

All eight recommendation strategies were queried with bounded candidate counts.
The supplied snapshot produced results for seven strategies; `airport_access`
returned zero candidates. Repeating the bus-stop request returned identical
recommendations. The tests also checked malformed inputs and unknown islands.

Live calls are the only external network requests in this verification. The
final default snapshot had two aircraft from ADSB.lol. OpenWaters returned normal
empty coverage, FollowMe reported `no_selection` until a public vessel ID was
supplied, and RTL buses were disabled. A request with public FollowMe vessel ID
18157 returned provider status `ok` with one provider event. No permanent live
history or deterministic source data was changed. Live coverage is transient;
these observations do not guarantee later coverage.

## Integrated development launcher

The launcher was tested both with the existing API and with a fresh backend
process. To avoid interrupting the browser checks on port 8000, the fresh-start
test used a temporary copy of the current launcher with only its workspace
root and ports substituted: backend 8010 and frontend 5199. The frontend
received `MOBILITY_BACKEND_URL=http://127.0.0.1:8010`.

The launcher started Uvicorn, waited for its health response, then started Vite.
Requests through the frontend proxy returned HTTP 200 for health and national
summary, with **1,561 islands and 840 facilities**; the separate API process
logged both requests. Pressing Ctrl+C shut down the started API and frontend.
Neither temporary port retained a listener or orphaned service, and the
original API on port 8000 remained running. The temporary launcher was removed.

The final scenario importer was also checked against real responses from all
eight recommendation strategies. The seven strategies with candidates each
produced a scenario that successfully round-tripped through the importer;
airport access again returned no candidates. The importer rejects malformed
coordinate values and array-valued operation types while preserving nullable
optional fields in backend-generated scenarios.

## Repairs in the imported project copy

1. Validation errors containing Pydantic `ValueError` context now serialize
   correctly as HTTP 422, instead of causing HTTP 500. Non-finite numeric input
   in error details is also serialized safely.
2. Live GET requests validate bounding boxes, range limits, and repeated
   FollowMe vessel IDs before calling providers. The original snapshot endpoint
   bypassed validation of selected IDs; the stream did not correctly accept
   repeated IDs. Both now share the validated dependency.
3. Scoped simulation run and comparison requests reject unknown islands with
   HTTP 404. A scope without a land graph no longer invents an empty graph that
   changes the baseline island count.
4. Scenario and routing coordinate pairs require finite longitude/latitude
   within global geographic bounds.
5. Marine routing rejects unknown endpoints, including the identical unknown
   start/end case that previously returned a false zero-distance success.
6. National summary detects the existing accessibility artifact and reports
   `calculated`, replacing the copied summary's stale phase-2 status at runtime.
7. Population profiles no longer add overlapping Census P3 and P5 totals.
   Fuvahmulah now reports **9,177**, matching the Census total, instead of **18,354**.
   Profiles explicitly flag missing population records.
8. Five overlong lines in the supplied facility review script were formatted
   without changing its behavior.

These fixes have regression coverage. Cached source, normalized, graph, and
accessibility artifacts were preserved; no new geometry or population links
were inferred.

## Data and model limits

| Area            | Verified supplied state                                                      | Practical implication                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Islands         | 1,561 geometries from OneMap                                                 | Includes multiple island categories; this is not a list of 1,561 inhabited communities.                                                        |
| Facilities      | 840 official records; 668 unlocated records excluded from the default map    | Map coverage and accessibility scores are incomplete. Review-required matches must retain their quality labels.                                |
| Population      | 5,442 P3/P5/P6 records; 1,049 records attached to islands                    | These are record counts, not population or island counts. Malé, Hulhumalé, and Hithadhoo have no attached population records in this snapshot. |
| Land routing    | 431 island graphs, 59,686 nodes, 137,842 edges                               | Islands without usable graph coverage can return `unreachable`. Routes depend on cached OSM geometry and permissions.                          |
| Marine          | 71 nodes, 35 edges; cached ferry relations are unverified candidates         | Verified passenger routing can be unavailable. Schedules, fares, and actual operator service are not established by these edges.               |
| Air             | 34 nodes and 34 access edges                                                 | Airport gateways are available; flight schedules and verified flight-service connectivity are absent.                                          |
| Accessibility   | Average 1.93/100; 1,466 zero scores; all 1,561 carry missing-data conditions | Zero is not evidence of no real service. These scores are strongly limited by unresolved and missing data.                                     |
| Simulation      | Immutable operation application and graph/feature counts                     | Scenario responses report structural changes, not traffic assignments, travel-time forecasts, or recomputed accessibility improvements.        |
| Recommendations | Deterministic screening heuristics and candidate simulations                 | Expected benefit and ranking are planning estimates; engineering feasibility, operating cost, and demand are not validated.                    |
| Live movement   | Aircraft and public vessel adapters; buses disabled                          | Aircraft/vessel observations may be empty, partial, or stale. Enabling a bus adapter requires a usable feed.                                   |

The imported `data/metadata/prewarm-report.json` records an offline prewarm on
13 October 2026 under its former directory. It was not treated as new-run
evidence: the current copy was independently validated and exercised above.
This verification does not claim successful refresh of every external source,
complete geographic data, or validation of public-service schedules.

One upstream test warning remains: the installed Starlette version deprecates
its `httpx` TestClient transport. It does not fail tests or affect the running API.
