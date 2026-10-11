# Road disruptions and investment robustness

The `service-graph-1.3.0` model supports dated road closures and incremental bus delays, legal OSM detours, downstream scheduled-trip changes, missed connections, and frequency-service fleet tradeoffs. These are transparent scenario calculations. They are not measured congestion, a traffic forecast, or evidence that an agency has adopted a detour.

## Reproduce

```sh
node scripts/profile-disruptions.mjs
npx vitest run src/lib/planning/disruptions.spec.ts
```

The profile reads the validated local public bundle, selects a road used by modeled bus connections, and asserts that the event affects service patterns. It measures cold initialization, first changed and repeated analyses, bus/walking closures, fixed fleet, a legal priority-area bus investment, and normal plus two stress cases. Repeated results must be deeply equal. It does not fetch external data or require credentials.

## Inputs and provenance

`PlanningAssumptions.disruptions` holds serializable `PlanningDisruption` events. Each event has a road-edge extent, bus/walking modes, direction, date/time interval, and `observed` or `assumed` provenance. Public-event provenance may include a source URL, source IDs and an evidence note. A public notice without verified road/time matching remains a candidate; it is not sufficient to create an observed closure.

All event times are Maldives local time. The interval is absolute and end-exclusive: an event from 08:00 to 09:00 no longer applies at 09:00. Minutes beyond 1,440 support the next day. Imported intervals must be positive and no longer than 366 days. Saved scenarios persist events, stress cases and fleet response, and remain pinned to dataset/model/schema versions. Old model pins cannot silently reproduce new-model results.

Direction `forward` means the stored edge's `from` to `to`; it does not mean a route's outbound direction. Closures remove permitted walking or driving arcs. They never open an OSM-restricted or wrong-way road. Each delay value applies **per selected directed edge**. Selecting ten edges with five minutes each can add up to fifty minutes before legal detouring; this is not a five-minute delay spread across the selection. Walking delays are not supported; walking closures are.

## Routing calculation

The model preserves a normal service world before applying an event. Stop snaps stay pinned to the original network, so a closed stop connection cannot teleport to another connected street. It constructs the permitted shortest driving connection between successive bus stops, then searches the event-modified graph with travel-time weights. Delay penalties and detour travel time compete with legal alternatives.

For each service segment, scenario running time is:

```text
loaded reference runtime + max(0, event road-path time − normal road-path time)
```

Published/reference running time is retained. Applying a blanket speed multiplier to the entire timetable would double-count existing traffic; this model adds only the modeled incremental difference. If no permitted alternative exists, an affected scheduled trip is cancelled or a frequency pattern becomes unavailable for boarding. Previously observed crossing evidence is retained so a computed closure loss is distinguishable from missing baseline service coverage.

Scheduled buses evaluate the event at each segment's entry time. Accumulated delay shifts every downstream arrival and departure. The common journey router then catches or misses the next bus/ferry departure using those shifted times. Each surviving `ScheduledTrip.segmentGeometry` stores its own modeled path, so playback uses the correct detour rather than another trip's path. Trips after an event expires retain normal timings and geometry.

Frequency services are a **selected-departure snapshot**: the first segment starts at the planning clock, with subsequent segment entry times propagated from it. Walking closures also use the planning-departure snapshot. The model does not integrate event start/expiry while traversing each individual road edge. Short events, queuing, stop-specific frequency arrival distributions and dynamic pedestrian reopening therefore need a finer model before operational claims are made.

Unmatched road IDs and bus segments without a permitted modeled reference road connection produce explicit warnings. The latter retain their loaded timings; a zero disruption effect has not been established for them. A shortest OSM connection is a modeled candidate path, not verification of the operator's actual driven alignment. Vehicle restrictions not captured in the OSM preparation remain a coverage limitation.

## Fleet and financial feedback

`fleetResponse: 'maintain-frequency'` keeps the entered headway and increases active vehicle requirements when the delayed round trip needs more vehicles. `'fixed-fleet'` keeps the reference active fleet and increases frequency-service headways to fit the longer circulation. Both use the same changed journey timings and walking network.

Fleet arithmetic requires one complete balanced frequency circulation with distances and running times. Branched or disconnected circulations sharing a route ID do not establish one vehicle duty. Captured scheduled departures do not establish vehicle duty schedules, fleet capacity or how a delay will alter later departures. Their journey consequences are modeled, while their fleet and event operating costs remain unavailable with reasons. Active fleet estimates exclude reserve vehicles; the separately reported procurement fleet includes the same reserve share used by investment economics. Neither estimate establishes spare or leased fleet availability.

Annual investment finance remains calculated on the normal intervention. Temporary event effects are reported separately in `disruptionImpact.fleetFeedback`:

- Added active fleet, procurement fleet including the entered reserve share, and conditional **bus procurement** MVR if the user-supplied bus capital range exists. Active fleet is `ceil(cycle / headway)`; procurement fleet is `ceil(active fleet × (1 + reserve share))`, matching investment economics. Capital uses the procurement fleet difference. This is a procurement scenario, not a mandatory expenditure or proof that spare vehicles are available. It does not establish additional depot or charging capacity costs.
- Incremental vehicle kilometres and hours during the overlap of event dates/times and calendar-valid frequency service windows. Overlapping events are merged in the time integral. The snapshot detour/runtime applies across that overlap; this is an approximation, not a reconstruction of every operated trip.
- Event-period operating MVR from the existing bundled per-kilometre anchor, without adding energy a second time. Extra hours at unchanged kilometres need marginal labour and idle-energy inputs, so a per-kilometre anchor cannot establish a zero monetary burden.
- Incremental **transit operation emissions** from vehicle activity and explicit fuel/electricity factors, or an entered per-kilometre factor. No private-trip displacement is inferred from a closure. Extra idle time at unchanged kilometres remains unavailable without suitable factors.

Low/central/high figures are editable assumption sensitivity ranges. They are not confidence intervals. Cancelled or incompletely mapped circulation must not appear as zero cost.

## Normal and stress comparisons

`robustnessStresses` contains up to three named event sets. The normal comparison clears events. Each stress compares the candidate with the **same stressed no-investment baseline**, retaining identical population allocation, destinations, dates, reference services, assumptions and candidate actions. Retained access is the intersection of residents reached by the normal candidate and stressed candidate; gained/lost access is against the stressed baseline. Unknown origins remain unknown and are not counted as observed gaps.

The displayed worst case is the least access among the listed normal/stress cases. No probabilities, expected losses or demand forecasts are assigned. A delay may affect many bus patterns while leaving general healthcare access unchanged because a nearby clinic is reachable on foot. Service-specific destinations, tighter time targets and journey changes can make that policy distinction visible without manufacturing an access loss.

The same `analyzePlanning` path runs inside the planning worker for preview, applied state and candidate comparison. Return journeys must reconstruct the normal world, apply events at the return clock, and route with original-network snaps. Reapplying an event to an already disrupted `analysis.world` would double-add delay and is not supported.

## Verification and measured limits

Independent small-network tests solve legal detours, directed closures, a one-hour event cost, fixed versus maintained frequency, a missed ferry, timed expiry, trip-specific geometry, cache repricing, stress investment comparison, and scenario save/undo/redo. For example, a ten-minute reference bus trip plus a six-minute detour has sixteen minutes of ride time; a ten-minute frequency gives five minutes expected wait and a twenty-one-minute journey. A twenty-minute target therefore loses access. A paired cycle grows from twenty to thirty-two minutes: two vehicles at the original ten-minute headway become four under maintained frequency, or a sixteen-minute headway with two fixed vehicles. Those values are checked independently of the implementation.

The reproducible profile on 11 October 2026 used Node 24 on Windows, public dataset `greater-male-2026-10-10-5bbad9760b` (4,359 network nodes, 5,743 edges, 667 population origins, 11 service patterns). The chosen edge was present in eight modeled segment paths and affected five loaded bus patterns. After consolidating walking caches by origin node and removing duplicate comparisons, baseline initialization took 680 ms; a new bus delay/closure took 304/227 ms; a fixed-fleet view took 291 ms; a new bus investment took 146 ms; cached single analyses took 17–25 ms. A new bus-plus-walking closure took 632 ms. Normal plus two stresses took 480 ms, and investment plus two stresses took 546 ms; their cached runs took 61/153 ms. Cached outputs were deeply equal to their first results. The investment reached 1,833 additional modeled residents in this run.

These are model timings on one machine, not browser rendering or hardware guarantees. Every committed case measured here completed within one second; all cached previews and comparisons completed within 250 ms. The first uncached delay view took 304 ms, so the local-preview target is not universal. Earlier runs during competing work were materially slower. Multi-case comparison is worker-based and must retain a busy indication until it finishes. Run the profile after changing data or model code, and profile the browser independently before claiming universal acceptance thresholds.
