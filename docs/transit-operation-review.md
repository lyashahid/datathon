# RTL stop operation and service-coverage review

Reviewed **10 October 2026 at 23:31 Maldives time** against the fresh [official RTL public route endpoint](https://bo.rtl.mv:4455/maldives/api/booking/v2/bus/routedetails). The complete per-stop result is in `data/public/transit-operation-review.json`; raw evidence and retrieval metadata remain in the ignored `data/raw/transit-operation-review/` archive.

The apparent extra Malé stops are **operator-listed stops with missing loaded service data**. The endpoint still lists **99 unique stop codes across 15 routes**, corresponding to **194 route-stop membership records**, not 194 physical stops. All 99 codes remain listed, their published coordinates agree with the baseline, and none is orphaned from the operator's route catalogue. This establishes catalogue identity; it does **not** establish that every physical boarding point is currently usable.

| Island            | Operator-listed stop codes | Codes with loaded dated service | Codes without loaded dated service |
| ----------------- | -------------------------: | ------------------------------: | ---------------------------------: |
| Malé              |                         49 |                              11 |                                 38 |
| Hulhumalé         |                         30 |                              30 |                                  0 |
| Vilimalé          |                         17 |                              17 |                                  0 |
| Hulhulé / airport |                          3 |                               3 |                                  0 |
| Total             |                         99 |                              61 |                                 38 |

The **38 Malé codes** without loaded patterns are associated with the official **R10 Orchid, R11 Ameenee, R12 Sosun and R15 West Park to Orange Hiya** catalogue. Those four routes have no timings in either the earlier validated capture or this fresh capture. The public endpoint does not explain why. Their absence from the simulator's service graph is a **missing timetable**, not evidence that the stop was fabricated, closed, or has no official route membership.

Hide these 38 codes from the default service map and retain an optional **operator catalogue / timings unavailable** layer. They must not contribute transit access merely by existing as coordinates. Do not invent routes, frequency, departures, reverse directions or operating days to make them appear connected. Do not relabel the other 61 codes as physically verified: their evidence is a dated published service snapshot plus mapped-location consistency checks.

## Snapshot limits

The planning bundle's validated departure capture was fetched at **15:17 Maldives time** on 10 October 2026 and contains later departures in a recorded **15:20–23:59** window. It is not a complete morning timetable or recurring service calendar.

The fresh **23:31** review illustrates the limitation: several previously populated routes have partially empty timing arrays; R5 is now empty. A remaining-departure endpoint naturally changes through the day. This later capture is therefore **an audit of catalogue identities**, and it intentionally does not replace the earlier validated planning service snapshot. An empty timing array does not become a closure determination.

## Temporary-diversion caution

The previous review captured a [23 September report](https://www.plus.mv/english/male-bus-routes-adjusted-as-boduthakurufaanu-magu-redevelopment-advances/) linking the [MTCC diversion notice](https://x.com/MTCCPlc/status/2102457648574812644). It describes R10 / R15 temporarily bypassing West Park during road works and using Maafannu Madharusa as the starting/ending location. Both the earlier and fresh RTL catalogues already begin those directions at **Maafannu Madharusa**.

The primary social notice again returned **403** in the fresh review; a current reopening date, usable kerb location and complete driving path were not established. Retain this as an unresolved operating caution. It does not justify permanently removing stops or silently moving their coordinates.

## Geometry and boarding identity

The existing [stop audit](location-audit.md#bus-stop-review) separately checks mapped-land membership and attachment to the prepared road graph. Those diagnostics cannot verify a shelter, sign, accessible entrance, wheelchair access, road-work condition, permission to board or today's operation.

Three published coordinate pairs represent opposite-direction identities at the same coordinate. Group their markers visually while preserving their stop codes and directional route membership. The **MWSC FLAT BUS STOP (DROP-OFF ONLY), code 32000**, remains alighting-only and must not become an origin boarding point.

## Reproduction

The committed report preserves this dated review; the original acquisition utility is no longer a maintained repository command. A refresh requires a new bounded public-source capture, schema and checksum validation, comparison of every stop identity and explicit adoption of changed decisions. Preserve the previous reviewed report on fetch or schema failure. Record the reference period, retrieval time, source checksum, transformation identity and reuse qualifications; do not substitute demo records for unavailable evidence.
