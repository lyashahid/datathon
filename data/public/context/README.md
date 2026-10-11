# Agency transport context

These observations supplement the policy planner. They do not change routing, population, costs, emissions, bus/ferry service patterns or accessibility results.

Run from the repository root:

```sh
node scripts/agency-context.mjs fetch
node scripts/agency-context.mjs prepare
node scripts/agency-context.mjs validate
node scripts/agency-context.mjs all --refresh
node --test scripts/agency-context.test.mjs
```

`fetch` uses existing checksum-verified originals unless `--refresh` is supplied. `prepare` is offline and requires Python with `openpyxl` (`npm run data:setup` installs the shared acquisition dependencies). Set `MOBILITY_PYTHON` if needed. No API keys or account are required for the implemented sources.

`source-manifest.json` records each original URL, publisher, reference period, exact retrieval time in UTC, SHA256 checksum, byte length, archive path, coverage, units, license qualification and transformation version. Originals are content-addressed under `data/public/archive/context/` and ignored by Git. A failed refresh preserves the previous verified source and explicitly records the failure and old retrieval date. Parser or checksum failure leaves the previous prepared JSON untouched.

`agency-context.json` contains `schemaVersion`, a source/script-derived `version`, `generatedAt`, `transformationVersion`, `sources`, `externalAccess`, and `layers.vessels`/`layers.flights`. Both layers stay `enabled:true`, including when acquisition is unavailable. An enabled layer is not proof that live data exist. Both set `livePositionsAvailable:false`.

## MPL vessel tables

[MPL vessel movements](https://port.mv/vessel-movements) supplies five tables: estimated arrivals, arrivals, departures, shifting and vessels listed at port. Each `portCalls` row preserves its source section/row, name, original date, timezone-free parsed date, berth/port labels, gross tonnage, published `LAO` field, source ID and quality flags. Estimated arrivals have `scheduledAt`; arrivals and listings have `arrivedAt`; departures have `departedAt`. No coordinates or vessel identity numbers are invented.

Counts in `observations` count published table rows. They are not a national vessel census or deduplicated active fleet. Listed-at-port records with arrival dates older than 90 calendar days are retained and flagged; they do not become live location fixes. Non-estimated records dated after the capture's Maldives calendar date are flagged without changing their classification. The publisher does not state an event timezone, so event timestamps are never converted to UTC. `LAO` is preserved as spelled, with no verified unit. GT is gross tonnage, not mass.

MPL permits anonymous public viewing. Its footer reserves rights; no explicit open-data redistribution license was found. Original page content is retained only in the ignored local archive; attributed factual table extractions are used for context.

## Airport statistics

[MBS Yearbook 2026](https://statisticsmaldives.gov.mv/yearbook/2026/) publishes the implemented 2025 tables, sourced to **Civil Aviation Authority**:

- [11.13 XLSX](https://statisticsmaldives.gov.mv/yearbook/2026/wp-content/uploads/sites/13/2026/07/11.13.xlsx): international/domestic passenger arrivals and departures for twelve months and annual totals.
- [11.18 XLSX](https://statisticsmaldives.gov.mv/yearbook/2026/wp-content/uploads/sites/13/2026/07/11.18.xlsx): total, international and domestic aircraft movements and scheduled/chartered/non-scheduled components.
- [11.10 XLSX](https://statisticsmaldives.gov.mv/yearbook/2026/wp-content/uploads/sites/13/2026/07/11.10.xlsx): annual total and flight-class subtotals for aircraft, passengers, cargo and mail. The preparation extracts six published aggregate rows, not every carrier row.

Both XLSX and corresponding PDF originals are cached. Counts are nonnegative integers; cargo/mail quantities are kilograms. Passenger movements are events rather than unique people, tourists or per-flight occupancy. The preparation verifies the twelve-month grain, source/title/header schema, monthly sums and aircraft component identities. Every observation preserves source ID, series definition, unit, reference period and whether it is a `reported-month` or `published-total`.

Published tables have differing annual totals, including a difference of 69 international passenger arrival/departure movements and 22 aircraft movements between Tables 11.10 and 11.13/11.18. These differences appear in `qualityChecks.crossTableComparisons`. Values remain as published; neither a reconciliation nor a shared coverage definition is assumed. Annual totals, monthly components and flight-class subtotals must not be summed together. Public download access is verified; no explicit open-data redistribution license was identified.

The airport operator is **Maldives Airports Company Limited (MACL)**. “MASL” was not identified as an airport-statistics publisher. [MACL Insights](https://macl.aero/insights) is a reference link; its [July 2026 terms](https://macl.aero/terms-of-service) prohibit automated scraping/mirroring without prior written authorization. The CLI does not acquire or redistribute its direct client dataset or flight feeds. `externalAccess.macl` records this restriction. The MBS/CAA observations are historical context and do not imply an operational MACL integration.

## Validation limits

The test suite uses explicitly named temporary workspace QA fixtures and never mutates the original public bundle. It checks date/time handling, all five vessel tables, schema changes, impossible values, duplicate rows, monthly completeness, published identities/differences, failed-refresh retention, archive path bounds, checksum integrity and preservation of the last valid prepared output.

Current observations cannot calibrate airport passengers' ground-transport modes, harbour freight trips, bus demand or marginal emissions. Those require separate trip surveys, operator data and identified movement definitions. No synthetic movements or live positions are substituted for these gaps.
