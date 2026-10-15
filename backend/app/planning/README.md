# Policy planning model

The planning API reads the pinned `data/public/planning-baseline.json` and
`policy-evidence/service-calendars.json` files. Responses contain their SHA-256
receipts and the model version. Each evaluation applies an isolated overlay to
the same baseline and compares both networks at the same date and departure.
The internal baseline view is read-only; scenario and response changes cannot
mutate the pinned source data.

## Coverage and resident calculations

The source snapshot covers Malé, Hulhumalé, Hulhulé, and Vilimalé. The explicit
identity bridge maps those source island IDs to national map IDs by their
verified physical location. A national island outside this snapshot returns
`outside_snapshot` and null resident measures, rather than an invented zero.

Resident origins use WorldPop spatial allocations scaled to the source's MBS
2026 or 2030 projections. These are projected residents and modeled geographic
allocations, not individual records or a fresh census. Origins with no supplied
population weight remain unweighted. The selected island filters resident
origins; the entire available network remains usable for cross-island journeys
and fleet comparison. Band totals include an unavailable band and reconcile to
the weighted population. A gained-access resident moves into the selected
travel-time threshold. A lost-access resident has a previously qualifying route
and a known proposed route above that threshold. Routes that become unavailable
are reported separately because incomplete evidence is not proof of lost access.

Walking uses the supplied graph, snap distances, and bounded shortest paths.
Exact haversine snapping first filters nodes through a conservative geographic
index. Walking access uses reversed directed shortest-path trees from each stop
and destination, shared across resident origins. It produces the same modeled
travel times while avoiding a new full graph search for every resident cell.
Content-keyed routing caches retain up to four world/assumption combinations and
two recently used walking networks. Each network's shortest-path cache is
bounded to 150,000 visited-node entries; resident results are bounded to 768 per
router. Closures, moved stops, changed calendars, goals, wheelchair restrictions,
and other routing inputs invalidate the relevant keys. Budget, target band,
population year and response geometry changes reuse exact journeys but still
recompute their financial account, cohort totals and threshold comparisons.
Caches are local to the process and repository, with no cross-user draft state.
Map impact requests set `assumptions.include_journey_geometry=false`, retaining
every resident's outcome and leg metadata while omitting repeated street path
coordinates. This reduces transfer/serialization and cached result-copy costs.
The default is `true` for compatibility with detailed journeys and reports;
switching it does not invalidate canonical cached paths. Resident-cell polygons
remain separately controlled by `include_origin_geometry`.
`assumptions.include_world=false` also skips the unused facilities, stops and
full service timetable/geometry snapshot in a map impact response. The `world`
object retains its three array keys with empty values; defaults and detailed
reports retain the complete snapshot. Neither option removes the resident
results, financial model, travel-time bands, source receipts or warnings.
Walking can reverse motor one-way edges when walking is allowed. Driving honors
the one-way restriction. Wheelchair audit mode excludes edges without explicit
wheelchair evidence. Healthcare destinations require verified, open general-care
facilities; education uses open schools. Proposed facilities enter the model on
their proposed opening date. No capacity or appointment booking is inferred.

## Scheduled journeys and fleets

The 10 October 2026 RTL records are captured remaining departures, not recurring
daily timetables. Their calendar is restricted to that date. Official ferry
calendars preserve direction, day type, validity, and caveats, but cannot produce
a journey without crossing runtimes. Import complete scheduled stop times or a
frequency service with explicit segment minutes to evaluate an assumed service.
All imported services are labeled assumptions even if their payload claims to
be observed. Calendar weekdays use Sunday = 0 and Saturday = 6.

Earliest-arrival routing includes walking access, boarding buffer, actual
departure wait, transfer walking, and destination egress. The appointment return
starts at the same destination after the supplied appointment duration and
returns to the original origin. Calendars and reviewed notice validity are
re-evaluated at the return departure, including when it crosses midnight.
The return deadline is a minute offset from the outward service-day midnight.
Route geometry uses actual graph/transit geometry when supplied; absent ferry
geometry is left absent. Reviewed notices apply only within their timezone-aware
validity interval at each selected MVT leg departure time. A closure that starts
or expires during a leg is not dynamically simulated; subdivide the journey or
import a time-dependent service schedule when that operational detail matters.

Fleet duties are greedy chronological blocks, separated by route, mode, and
propulsion. A vehicle can be reused only after the trip plus layover and at a
co-located terminal within 100 m. No unobserved return or deadhead trip is added.
Unbalanced terminal service warns that vehicles can accumulate at the far end.
The result is a feasible illustration for supplied duties, not an optimized
operator dispatch. Initial depots, crews, charging availability, maintenance,
deadheads, terminal capacity, and next-day vehicle positioning need actual plans.
Procurement is `ceil(required vehicles × (1 + reserve share))` per fleet group.
Selected-day activity includes previous-service-day scheduled departures after
midnight, with routing, timetables, fleet and cost calculations using the same
expanded calendar. Only duties whose first departure falls on the selected
civil day enter its activity account; a prior-day duty still in progress at
midnight does not have its vehicle-km split across days.
Fleet and timetable day totals use the scenario overlay sampled at
`assumptions.departure_minutes`. A reviewed suspension active at that instant
disables its entire service pattern for this daily illustration; notice bounds
are not clipped separately against every scheduled trip. An expired suspension
is absent from the sampled overlay even if it was active earlier that day.
Use explicit amended trip schedules for an operational day plan.
The resident scope filters the beneficiary cohort, while the connected network
and baseline fleet/economic account retain all Greater Malé service patterns.
Incremental project costs still compare the same unchanged network before and
after the proposal. The simple UI service form defaults proposed buses to its
electric propulsion assumption; complete service JSON imports can specify
diesel or electric explicitly.

## Economic assumptions

All defaults are editable planning illustrations, not official Maldivian quotes.
They are defined in `economics.COST_DEFAULTS` and returned by the baseline API:

| Input                                        |                                                             Default |
| -------------------------------------------- | ------------------------------------------------------------------: |
| New stop capital                             |                                                         MVR 100,000 |
| Hospital capital / annual operation          |                                    MVR 120 million / MVR 20 million |
| School capital / annual operation            |                                      MVR 25 million / MVR 5 million |
| Diesel bus capital                           |                                                       MVR 3 million |
| Electric bus capital / charging installation |                       MVR 4.5 million / MVR 750,000 per route fleet |
| Diesel / electric operation                  |                                          MVR 25 / 18 per vehicle-km |
| Diesel / electric operating emissions        |                                    1.3 / 0.8 kg CO₂e per vehicle-km |
| Ferry capital / operation / emissions        | MVR 15 million / MVR 250 per vehicle-km / 25 kg CO₂e per vehicle-km |
| Explicit displaced passenger travel          |                                       0.12 kg CO₂e per passenger-km |

Annual activity repeats the selected service day for the explicitly selected
operating-day count (default 300). This extrapolation is an assumption and does
not establish observed annual services. Missing route distances produce null
operating totals rather than zero. Incremental capital includes new stops,
proposed facilities open by the scenario date, and additional required
procurement of each vehicle type. A propulsion conversion purchases the new
fleet; retiring vehicles does not create assumed sale receipts. The reference
fleet replacement capital is shown separately from incremental project capital.

Annual operating and emissions changes subtract baseline from proposed values.
The optional displaced passenger-km input is annual and separately reduces net
operating emissions; accessibility gains do not infer demand or mode shift.
Hospital and school proposals accept explicit `metadata.costs` values for
`annual_operating_kg_co2e` and `embodied_kg_co2e`, alongside `capital_mvr` and
`annual_operating_mvr`. Omitted facility emissions make the respective totals
null, rather than implying zero. Fleet operating emissions remain separately
available. These facility values are assumptions from an energy/construction
plan, not observed data. Existing facility emissions are outside the incremental
project account, and vehicle embodied emissions are unmeasured. Annual operating
carbon and one-time construction carbon are kept separate.
Capital budgets apply to incremental capital; annual budgets apply to added
annual operation. The displayed -30%/+40% cost sensitivity is illustrative,
not a statistical confidence interval. Land, staffing detail, hospital/school
embodied carbon, service capacity, and lifecycle maintenance are unmeasured.

`POST /api/v1/planning/quote` accepts the same `PlanningRequest` as evaluation
and returns the authoritative economics plus a `budget` verdict without
calculating resident access. `budget.allowed` is false when either supplied
limit is exceeded, or a limited cost cannot be calculated from the available
inputs. A zero limit is enforced and exact equality is allowed. With no limits,
the verdict is `unbounded`. Each capital/annual component reports its projected
cost, limit, remainder and `within_budget`; `reasons` explains failed checks.
The frontend uses this gate before confirming every new map placement and
accepting routed, calibrated or date-sensitive changes. Evaluation and PDF
reporting remain able to describe an existing
over-budget draft so a user can inspect and repair it.

Reproduce shipped-data latency and equality checks from the repository root:

```powershell
backend/.venv/Scripts/python.exe backend/scripts/benchmark_planning.py --reference-ref 90eb177a1a610e935bc42d01cc99cdeb9bc9a9ad
```

The benchmark compares real Malé and Hulhumalé baseline, stop and school
proposals with the prior implementation, checks every resident's access result
and financial/summary totals, and saves an inspectable JSON receipt under
`artifacts/qa`. Timings exclude HTTP transfer, browser rendering and debounce;
equal-cost alternative paths can have different geometry without changing
modeled access. Use `--iterations` to control repeat samples.
