# Mobility Sandbox MV: five-minute policy demonstration

Lead with one decision: **where should the next transport investment improve access to healthcare?** The demonstration connects official population statistics, streets, verified destinations and service timing to an editable investment. It then challenges that investment with roadworks and a return journey.

The [competition website](https://www.datathon.stats.gov.mv/) names transport insights for a connected Maldives as its theme and lists 24 October 2026, 09:00–22:00, in Malé. The supplied organiser slides emphasise official statistics, GIS, sustainable transport, practical interventions and collaboration. This demonstration concentrates those themes in a decision a policymaker can inspect. It does not promise a competition outcome.

## Prepare the cached demonstration

Run from the repository root with Node 24 and the project's installed dependencies:

```powershell
node scripts/create-demo-scenarios.mjs
node scripts/create-demo-scenarios.mjs --check
node scripts/profile-return-journey.mjs --write
npm run dev -- --host 127.0.0.1
```

The generator makes no network requests. It reads `data/public/planning-baseline.json` and the cached `data/public/operations/bundle.json`, identifies a real modeled access gap, routes the proposal on permitted OSM roads, validates the exact scenario import shape, and independently checks annual service kilometres, cost and diesel carbon arithmetic. Four scenario JSON files and their result catalog are written under `static/demo/`. Regenerate them whenever the baseline or model changes; the importer enforces those version pins. `--check` recalculates and verifies the saved files without changing them.

Use the current atlas at 1366×768 or larger, top-down, with the healthcare goal and a light overlay. Open **Proposal options → Try a prepared policy example**, then select the bus investment. The built-in picker imports the pinned scenario and selects its resident area. Manual JSON import is also available through **Proposal options → Import**. The catalog records the exact origin, coordinates and service direction. Rehearse the journey and investment controls once. The demonstration date is **10 October 2026, 15:30 Maldives time**, because the cached bus observations cover only part of that service day. Changing to 08:00 is not a verified morning experiment on this snapshot.

The planning model, cached evidence and imported scenarios work independently of upstream portals. Basemap or satellite tiles can still need an internet connection or a browser tile cache. Do not describe satellite tiles as an offline guarantee. Keep a printed policy brief available if venue connectivity is unreliable.

## Demonstration sequence

### 0:00–0:40 — State the decision and establish the evidence

“A new stop by itself does not improve a journey. A useful service needs a route, the right direction, operating hours and a feasible connection. This atlas lets us test those choices before spending money.”

Open the evidence drawer briefly. Point to the official island totals, estimated spatial distribution, verified destinations, public operator snapshot and their dates. Explain that coloured cells show journey time to the selected kind of service. Grey or unknown means the loaded evidence cannot establish a result; it does not establish that residents have no real access.

### 0:40–1:30 — Show one concrete access gap

Import [the bus investment](../static/demo/01-bus-investment.json), then select origin `wp:hulhumale:3446:1091` in northern Hulhumalé, centred at approximately **73.54958°E, 4.23458°N**. The current bundle allocates about **1,229 people** to that area. That is a modeled allocation of projected island population, not a census count for this neighbourhood.

Show the baseline journey to Hulhumalé Hospital: about **30.1 minutes**. Then show the proposed two-way bus connection with **10-minute headways**: about **20.1 minutes**, including walking and an expected five-minute wait. Trace the journey ribbon and briefly move or adjust the proposal so the audience sees recalculation. Undo restores the pinned example.

“The question is whether this route connects residents to care at a reasonable cost. These people are the residents represented by the model; they are not a passenger-demand forecast.”

### 1:30–2:30 — Present benefit, cost and the difficult carbon answer

For dataset `greater-male-2026-10-10-5bbad9760b`, model `service-graph-1.3.0`, the saved bus example yields:

| Decision result                                               |                 Conditional modeled value |
| ------------------------------------------------------------- | ----------------------------------------: |
| Additional residents within 30 minutes of eligible healthcare |                               About 5,526 |
| Capital investment, central illustrative input                |                          MVR 12.0 million |
| Annual operations, central illustrative input                 |                          MVR 3.77 million |
| Annual service distance                                       |                  About 104,601 vehicle-km |
| Procurement fleet including the configured reserve            |                                   5 buses |
| Annual carbon change with zero displaced private travel       |                     **+89.7 tonnes CO₂e** |
| Central carbon break-even                                     | About 815,507 displaced passenger-km/year |

The capital and operating values use **editable illustrative inputs**, not procurement quotes. The central diesel calculation is independently checked as 104,600.98 vehicle-km × 0.32 litres/km × 2.68 kg/litre. The operating rate includes bundled operations; energy is not charged a second time. The 5,526 access gain is across all represented origins, not just the selected 1,229-person area. Other islands have incomplete evidence, and total access results must retain their unknown category.

“This service improves modeled access, but more diesel service increases emissions unless enough private travel is displaced. We make that condition visible instead of automatically calling the investment green.”

Show the carbon break-even and the low/central/high editable inputs. If switching to an electric fleet, explain that electricity still has emissions and the local charging factor requires verification. Do not infer mode shift from the number of residents who gain access. The sensitivity range is not a statistical confidence interval.

### 2:30–3:20 — Challenge the route with a road closure

Import [the roadworks scenario](../static/demo/02-road-closure.json). It closes OSM edge `osmway:1338632887:1:2` to buses from 15:00–18:00 on the planning date. This is an **assumed demonstration event**, not a report of actual works. The affected road and rerouted service should appear on the map. The selected journey becomes about **20.9 minutes** as the route detours.

Show the maintained-frequency response, active vehicles, procurement reserve and temporary extra operating activity. A temporary event is priced as an event; it must not become a fictitious year-long closure cost. If using fixed fleet instead, explain why a longer cycle can increase waiting. Use playback on the selected service only: the moving symbol is a route illustration driven by service timing and routed geometry, not a live bus location.

“Investment quality includes resilience. A useful route should still work when one part of the road network becomes unavailable.”

### 3:20–4:20 — Make the island journey honest

Select [the unknown ferry scenario](../static/demo/03-ferry-unknown.json), then origin `wp:vilimale:3518:1016` near Villingili Ferry Terminal. Open the appointment return check. The loaded baseline cannot establish the journey: the public timetable supplies headways, but a verified crossing time is missing, and local destination coverage is incomplete. Do not present this as evidence that Vilimalé has no healthcare or ferry access.

Next import [the explicit-runtime ferry scenario](../static/demo/04-ferry-assumed-runtime.json), or open the ferry assumption controls and add both directions with a clearly labeled **10-minute assumed crossing**. The official terminal locations and dated headways are retained. The missing crossing runtime and calendar validity remain explicit assumptions. This conditional example reaches Dharumavantha Hospital at about **15:51**, allows a **60-minute appointment**, and returns to the exact original location at about **17:13**. The bus case reaches Hulhumalé Hospital at about **15:50** and gets home around **17:10** after the same appointment.

Show the home-by deadline and briefly change appointment duration. Departure scans check discrete times only within the supported snapshot. They do not certify every intervening minute or the last actual ferry. The assumed ferry has no verified trajectory geometry, so it must not display a vessel moving along an invented straight crossing. Ferry costs and carbon remain unavailable until supported inputs exist.

### 4:20–5:00 — Leave a concrete policy product

Return to the bus investment and open the one-page policy brief. It contains the intervention, map, comparison, investment, annual operations, carbon conditions, assumptions, evidence versions and sources. Show the responsible agency, pilot phases and outstanding operational inputs. Download the scenario JSON so another analyst can reproduce the same inputs.

“Our contribution is a small, explainable policy experiment: connect official statistics to place, test a feasible service, disclose the conditions, and leave a reproducible investment brief. The next calibration is actual passenger demand and travel times with authorised local partners.”

## Claims that can be defended in questions

| Claim                                         | Primary evidence and boundary                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Official statistics anchor the population     | [MBS island Census 2022 workbook](https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2023/09/Island-Level-Indicator-Sheet-Population.xlsx) and [MBS island projections](https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2026/08/IslandLevelProjection_2022-2030.xlsx). 2026/2030 totals are projections. Harbours are excluded; Hulhulé has no separately verified planning total.                            |
| The map shows a spatial estimate              | [WorldPop Maldives 2026 R2025A raster](https://data.worldpop.org/GIS/Population/Global_2015_2030/R2025A/2026/MDV/v1/100m/constrained/mdv_pop_2026_CN_100m_R2025A_v1.tif) supplies within-island weights normalized to official totals. Its grid is not block-level census precision. Do not add another population surface to those totals.                                                                                  |
| Trips follow a transport network              | [OSM/Geofabrik Maldives](https://download.geofabrik.de/asia/maldives.html) topology and public operator shapes. Permissions and road directions are retained; walking speed, dwell and proposed-service headways are planning inputs.                                                                                                                                                                                        |
| Bus timing has a public source                | [RTL](https://www.rtl.mv/) route and remaining-departure capture, dated in the evidence drawer. It is partial-day evidence, not a full GTFS calendar, live fleet position or measured congestion feed.                                                                                                                                                                                                                       |
| Ferry headways and terminals are sourced      | [MTCC Vilimalé 2026 V1 PDF](https://mtcc.mv/wp-content/uploads/2025/12/Vili-male-Ferry-Schedule-2026-V1.pdf) and RTL's public terminal catalogue. Opposite-direction columns are not departure/arrival pairs. Runtime remains assumed; Friday prayer and unspecified timetable gaps are retained.                                                                                                                            |
| Destinations are screened for routing         | [Ministry of Health registry](https://hems.health.gov.mv/establishments), [government facility list](https://health.gov.mv/en/publications/government-health-facilities-list-1), and [Education school directory](https://www.moe.gov.mv/en/schools). A listing alone does not prove precise location, current operation, opening hours or capacity. Closed and unresolved records are excluded from precise benefit claims. |
| Carbon is a conditional operating calculation | [IPCC mobile-combustion methods](https://www.ipcc-nggip.iges.or.jp/public/2006gl/pdf/2_Volume2/V2_3_Ch3_Mobile_Combustion.pdf). Service activity × energy factors minus assumed displaced private-travel emissions. Local vehicle efficiency and electricity factors require verification.                                                                                                                                   |

The strongest expansion is a verified inter-island corridor with complete calendars and crossing runtimes. Adding all islands without those inputs would extend the map without extending defensible analysis. Traffic forecasting requires calibrated speeds or counts; moving symbols and roadwork scenarios are not a forecast. Airport passenger and port-vessel context can explain national scale but cannot establish neighbourhood bus demand. News-derived disruptions remain attributed candidates until their location, date and restriction are supported. No private FollowMe traces, camera records, individual passenger transactions or invented live tracking are needed for this demonstration.

The script and exported brief provide reproducibility without introducing an MBS review or quality-release workflow. Human first-minute usability testing and browser/device performance checks still require real testers and the actual presentation device; the Node profile is a model benchmark, not evidence that those acceptance checks have been completed.
