# Five-minute demonstration

Lead with a practical question: **what do the published records show, and what should we prepare or investigate given the passenger outlook and its reliability?** The data workspace lets a reader explore patterns and write their own observation. Then show how a planner can compare a healthcare transport decision without hiding losses, missing evidence or operating conditions. All important evidence is visible in the application; downloads are optional.

Use the [current release](prediction-release.md) and [source receipt](prediction-source-receipt.md) for exact qualifications. Check the [official competition FAQ](https://www.datathon.stats.gov.mv/faq) before submitting. This script does not claim an organizer endorsement or guarantee a competition result.

## Prepare

Use Node 24 and installed dependencies. Build and preview the cached app:

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 5180
```

Open http://127.0.0.1:5180 at the actual presentation size; also rehearse the mobile view. The app opens the original **Map**. The persistent navigation leads to **Data and Forecasts**, **Decisions** and **Evidence**; the map remains the primary surface. **Data and Forecasts** contains **Explore data**, **Build a visualization** and **Forecasts**. For the timed outlook demonstration below, open **Data and Forecasts → Forecasts** and select the stronger verified ferry outlook. Cached analysis works without upstream portals; optional basemap/satellite tiles still need connectivity. Use the local atlas at the venue.

Keep the forecast target and source dates visible. The October 2026 outlook uses June ferry actuals and May bus actuals, so its horizons are four and five months. The healthcare comparison uses **10 October 2026, 15:30 Maldives time**, a 30-minute target and a default five-minute **assumed** road delay. The partial timetable cannot support an unqualified 08:00 morning demonstration.

## Optional data-first opening

For an audience interested in exploration, rehearse this short path before the timed outlook demonstration, or substitute it for the first forecast-method explanation. Open **Data and Forecasts → Explore data**. Choose a subject and point to one useful graph, its evidence type and its reference period. Search an island or publisher, choose **Inspect data**, then show the exact values and source receipt. A 2022 census total, a 2026 published projection and a modelled map allocation describe different things; the interface keeps their status visible.

Choose **Use in visualization builder** to carry that dataset into the builder. For a comparable monthly example, select **Velana · international passenger arrivals** and add the compatible **Velana · total aircraft movements**. The builder aligns shared months and uses relative change with the first common value equal to 100 because the units differ. These are airport movements, not unique tourists; a relationship plot does not establish a cause. Show that unrelated island inventories and household-budget categories are not offered as join partners. Write a short observation or question and choose **Save story**; the settings and note stay in this browser and are not sent to an agency. Use **Inspect chart values and sources** to distinguish indexed chart values from the original source amounts.

Return to **Explore data** for the source library, **Forecasts** for the outlook, or **Map** for geographic detail. Data exploration presents available evidence without choosing a policy. Congestion, crowding and nationwide routing remain unsupported where the necessary observations are absent.

## Opening sequence

### 0:00–0:40 — Establish the question and counted unit

“Official passenger statistics can help us review service budgets and staffing. This screen separates the last recorded total from the estimate for October, and tells us how much trust the estimate has earned.”

Begin on **Map** and identify the residential islands covered by the access model. Open **Data and Forecasts → Forecasts** and point to the selected ferry endpoint, estimate, latest recorded month and source date. These are published passenger movements, not unique people, route loads or neighborhood ridership. Endpoint/direction definitions remain unresolved; do not add the ferry endpoint series together.

### 0:40–1:30 — Make reliability part of the decision

Point to the empirical range and its warning: only **two of six** later ferry totals fell inside it. The Malé ferry endpoint's later historical relative error is **4.82%**, compared with **6.62%** for the last-month baseline. Open **Inspect each later historical prediction** to show the six actual/estimate rows; briefly show **Compare simple forecast methods**.

“The estimate is a reason to review capacity assumptions with the operator. This small historical check and weak range coverage do not justify an exact fleet purchase.”

The model was selected on earlier history; later results are evaluation evidence. Publication delays and original historical vintages were not simulated. These are exploratory retrospective checks, not a completed prospective trial.

### 1:30–2:05 — Show an unfavorable result honestly

Choose the bus series. Its selected seasonal model has **12.33%** later relative error versus **4.83%** for last-month persistence. Read the visible warning that the simplest forecast performed better. The June bus values repeat May across all six categories and remain quarantined.

“A useful statistical system must show when its prediction is weak. We retain the result and benchmark rather than quietly selecting a replacement from these same test outcomes.”

### 2:05–3:25 — Compare a concrete healthcare decision

Open **Decisions**. Show the date, clock, target and five-minute assumed delay. The road is chosen for its modeled dependency in healthcare bus journeys, not because measured traffic proves it is congested. Compare current timing, the reviewed timing option and removal of the assumed delay.

In the recorded release, **228,763** modeled residents meet the target and **9,468** remain unknown, against the official projected denominator of **246,278**. Removing the assumed delay produces **zero additional residents within 30 minutes**, but about **0.4 minutes average time saved** across matched computable resident journeys; the selected focal journey can save about three minutes. Show both results. Zero access gain is a useful finding, not a reason to conceal the time benefit.

The explored five-minute earlier/later R8 departures each lose modeled access for **2,587** residents, so retaining the current timing is the better tested choice. Check the displayed alternative and its assumptions rather than promising every adjustment helps. A no-change option has zero incremental modeled cost; real changes still require verified costs and circulation. Open **Assumptions and operating checks** and identify the responsible reviewer/next step.

“These are conditional modeled journeys for residents. They do not measure bus riders, facility capacity or successful healthcare visits. A real road intervention still needs operational and engineering review.”

### 3:25–4:15 — Make motion useful and truthful

Use **Show area and journey on map** to locate the chosen example. This focuses the map without applying the alternative. **Open this option in map** is the explicit handover when you want to edit that scenario. On Map, use **Playback** (or **Map tools → Service playback** on mobile) to illustrate a loaded route with supplied geometry and timing. This finite, user-requested motion is not live tracking, an observation or a prediction-training sample.

Return to **Decisions → Bus observation pilot**. Show the aggregate evidence from a real ten-minute pilot: ten reports, four reported vehicles and changing coordinates. Explain why a source measurement timestamp, verified direction, reuse permission and more independent trips are still needed. Public raw-position replay is unavailable; do not suggest the route-context map displays observed positions.

### 4:15–5:00 — End with an inspectable follow-up

Return to **Data and Forecasts → Forecasts** and open **View all recorded totals and estimates**, **Data quality notes**, and **Source definitions and forecast limits** as time allows. **Explore data** provides the wider published picture and **Build a visualization** retains a reader's own interpretation. The planner can inspect the values, dates, quarantine and model conditions directly in the application.

“A November forecast issue is already frozen; its later scores remain pending until verified official actuals are available. With an authorized operator, we can collect better arrival evidence; with service and facility verification, we can test a feasible healthcare option. The system already makes those decisions and evidence gaps visible.”

Keep downloads secondary. Return to **Map** for investment, carbon, ferry or return-journey scenarios when questions require them; the analytical pages retain their state during navigation. The [roadmap](roadmap.md) records the evidence gates; no production prediction, automatic news closure or nationwide routing is claimed.

## Appendix: version-pinned detailed-editor examples

These examples extend the main demonstration; they are conditional scenarios rather than observed events. Open **Map → Proposal options → Try a prepared policy example**. The importer enforces data/model versions. Regenerate after a baseline/model change:

```sh
node scripts/create-demo-scenarios.mjs
node scripts/create-demo-scenarios.mjs --check
node scripts/profile-return-journey.mjs
```

The generator reads cached planning and operations bundles, checks import shapes and independently verifies service-distance, cost and diesel arithmetic. It makes no network requests. The [catalog](../static/demo/catalog.json) pins dataset `greater-male-2026-10-10-5bbad9760b`, model `service-graph-1.3.0`, date 10 October 2026 and departure 15:30 MVT. Recheck the generated results before reciting these figures after any change.

### Healthcare bus investment

Import [01-bus-investment.json](../static/demo/01-bus-investment.json). Origin `wp:hulhumale:3446:1091` is near 73.54958°E, 4.23458°N in northern Hulhumalé, with approximately 1,229 modeled residents. Its journey to Hulhumalé Hospital changes from about 30.1 to 20.1 minutes under a proposed two-way connection with ten-minute headways, including walking and an expected five-minute wait. Trace the route, adjust a proposal input and undo.

| Conditional result at the pinned version                      |                                     Value |
| ------------------------------------------------------------- | ----------------------------------------: |
| Additional residents within 30 minutes of eligible healthcare |                               About 5,526 |
| Capital, central illustrative input                           |                          MVR 12.0 million |
| Annual operations, central illustrative input                 |                          MVR 3.77 million |
| Annual service distance                                       |                  About 104,601 vehicle-km |
| Procurement fleet including configured reserve                |                                   5 buses |
| Annual carbon change with zero displaced private travel       |                     **+89.7 tonnes CO₂e** |
| Central carbon break-even                                     | About 815,507 displaced passenger-km/year |

Costs are editable illustrative inputs, not procurement quotes. The central diesel calculation is 104,600.98 vehicle-km × 0.32 litres/km × 2.68 kg/litre. Bundled operating rates already include energy. The 5,526 access gain spans represented origins, not just the selected area. Extra diesel service can increase emissions; residents gaining access do not establish mode shift. Electric efficiency, charging factors and displaced private travel require local calibration. Sensitivity ranges are assumptions, not confidence intervals.

### Assumed roadworks

Import [02-road-closure.json](../static/demo/02-road-closure.json). OSM edge `osmway:1338632887:1:2` is closed to buses from 15:00–18:00 as an assumed demonstration event. The selected journey becomes about 20.9 minutes under the detour. Compare maintained frequency with fixed fleet: longer cycles can require more vehicles or increase waiting. A temporary event's extra operating activity must not become a fictitious year-long closure cost. Route playback is a timing illustration.

### Ferry uncertainty and return feasibility

Import [03-ferry-unknown.json](../static/demo/03-ferry-unknown.json) and select `wp:vilimale:3518:1016`. The loaded model cannot establish the journey because verified crossing runtime and complete local destination evidence are missing. This does not establish that Vilimalé has no real healthcare or ferry access.

Then import [04-ferry-assumed-runtime.json](../static/demo/04-ferry-assumed-runtime.json), which explicitly assumes a ten-minute crossing in both directions. Official terminal locations and dated headways remain sourced; runtime/calendar validity remain assumptions. The pinned case reaches Dharumavantha Hospital around 15:51, allows a 60-minute appointment and gets home around 17:13. The bus case reaches Hulhumalé Hospital around 15:50 and returns around 17:10 after the same appointment.

Show the home-by deadline and appointment duration. Departure scans cover discrete times inside the supported snapshot, not every minute or the last actual ferry. There is no verified ferry trajectory for an animated crossing. Ferry costs and carbon remain unavailable until supported inputs exist.

## Evidence boundaries for questions

Official island population totals and WorldPop allocations, OSM topology, public RTL timing, operator ferry PDFs and screened destination locations have different scopes. Use [data sources](data-sources.md), [model methodology](model-methodology.md), [location audit](location-audit.md), [transit review](transit-operation-review.md) and [policy evidence](policy-investment-release.md) for their exact sources and limitations. Use [operations](operations-data.md) for reviewed notices and [transport context](transport-context.md) for port/airport counts and restricted vessel records.

National map coverage is not national routing. Monthly totals do not establish street congestion. A news-derived event is an attributed candidate until reviewed. No MBS endorsement, operational deployment or permission to redistribute private traces is implied. The [release](prediction-release.md) records completed developer/browser checks; a first-time policymaker study and actual venue-device testing remain pending.
