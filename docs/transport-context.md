# Sea & air: source and implementation review

This feature adds auxiliary marine and airport observations to the existing Greater Malé policy atlas. The context bundle is independent of `PlanningBaseline`: it cannot add transit services, change accessibility, infer ridership, or alter modeled cost/carbon. Existing scenario versions and undo/redo remain unchanged.

## Source decisions

- [FollowMe public vessel directory](https://m.followme.mv/public/): one dated public directory, filtered to vessel categories, plus three public position observations. Most records have no sampled position. Provider timestamps lack a documented timezone, so they stay raw with an explicit qualification. Relative “last seen” labels belong to capture time. Public contacts, IMEI/device identifiers and raw provider payloads are excluded from the browser response. Provider terms are not an open reuse license; local records and originals remain ignored. [Terms](https://followme.mv/?pg=terms), [issued-key API documentation](https://followme.mv/api/v1/).
- [MPL vessel movements](https://port.mv/vessel-movements): arrival/departure/estimated arrival/shifting/at-port lists. These are port records, without geographic vessel positions. Old “at port” arrival dates and absent berth values remain identifiable; the list is not an AIS census or proof that a ship is currently at a specific berth.
- [MBS Statistical Yearbook 2026](https://statisticsmaldives.gov.mv/yearbook/2026/): published transport tables provide 2025 airport passenger and aircraft counts attributed to the source agency. Preserve international/domestic, arrivals/departures, monthly/annual and airport coverage separately. Summing arrivals with departures produces movements, not unique travelers. Do not mix published annual totals with their component months in a chart.
- [MACL Insights](https://macl.aero/insights): investigated as the likely meaning of “MASL.” Its [terms](https://macl.aero/terms-of-service) restrict automated mirroring, so no copied daily client dataset is shipped or used by refresh. Official downloadable yearbook tables provide the working airport context. Direct MACL integration remains permission-required.

Foreign observations, flight/vessel schedules, vessel positions, per-flight occupancy and passenger demand are not inferred from aggregate agency totals.

## Implementation

- `ENABLE_VESSEL_DATA=true` and `ENABLE_FLIGHT_PASSENGER_DATA=true` are server configuration defaults. Both are set true locally. False suppresses the relevant dataset even when a valid cache exists. FollowMe API keys remain server-only.
- `/api/transport-context` returns a versioned allowlisted bundle with explicit available/partial/unavailable/disabled states, sources, dates, checksums, transformations and gaps. Missing records are empty and unavailable; they never become zero totals. No automatic upstream polling occurs in a page request.
- Originals stay under ignored `data/public/archive/context/`; compact agency output and FollowMe provenance are under `data/public/context/`. Reproducible preparation/validation commands are in `package.json`. No anonymous bulk position polling or WebSocket subscription is implemented.
- Last validated snapshots are retained in memory if an installed replacement is missing or invalid. Acquisition keeps cached originals on upstream failure. A new server without a valid local provider snapshot reports unavailable.
- Searchable directories paginate to keep the modal concise. Aircraft, cargo ship, speedboat and airport SVG graphics are original project assets. Only source-provided boat coordinates receive boat markers. The airport symbol identifies the facility, not a live aircraft. Heading rotates genuine boat symbols; no animated tracking is fabricated.
- Map layer switches are reversible presentation preferences. Airport passenger charts group observations by source, metric, units and coverage. Sources/gaps are expandable. The policy brief suppresses auxiliary map icons because these observations are outside the intervention calculation.

## Verification

Parser tests cover boat-type filtering, private field exclusion, null positions, timestamp ambiguity, API key redaction and request throttling. Server tests cover coordinates, joins, duplicate IDs, missing counts, disabled flags and last-validated fallback. Map tests confirm port-call rows are never turned into boat coordinates. Run `npm run test:context`, followed by standard check/lint/test/build commands.
