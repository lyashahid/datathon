# Roadmap and evidence gates

This is the consolidated future-work record after the 11 October 2026 release. The [release](prediction-release.md) documents delivered behavior and completed checks; the [source receipt](prediction-source-receipt.md) retains audit evidence. These next steps are conditional research and operational requirements, not committed agency actions or claims of competition success.

Keep the central decision clear: **what should a planner investigate or prepare, given the evidence and its limits?** Monthly passenger outlooks support a review of service budgets and staffing. Healthcare scenarios show which residents' modeled journeys improve or worsen under explicit assumptions. Aggregate monthly counts cannot establish neighborhood demand, road congestion or an exact fleet requirement.

## 1. Establish prospective monthly forecast evidence

- Use the delivered immutable issue workflow to freeze each new forecast before the next official count is released. The first November issue is frozen and awaits actuals. Retain original publication vintages and revisions; score comparable horizons against last-month and seasonal baselines.
- Resolve repeated June bus values, ferry endpoint/direction definitions and overlapping fare categories with MBS/operators. Keep quarantine and exclusions visible until resolved. Do not combine counts whose definitions may overlap.
- Improve empirical ranges using sufficient earlier observations, then measure coverage and width on later outcomes. The current ferry ranges cover only two of six later totals; current bus covers three of six. Retrospective revised-vintage checks are not a substitute for prospective evaluation.
- Investigate changes in service, fares and exceptional periods before adding predictors. Replace a weak model only through a new dated selection/evaluation protocol; do not choose from the held-out results and reuse them as independent evidence.

Acceptance: reproducible issued forecasts, honest uncertainty, clear comparison with simple alternatives, and an operator-defined resource decision. Forecast passenger movements are not a direct instruction to buy buses or increase a specific route's frequency.

## 2. Build bus arrival evidence before forecasting road delay

Start with a reviewed route/direction and a 5–15-minute target: time until a bus is observed passing a supported anchor. Claim physical arrival only if provider latency and measurement timestamps make that interpretation defensible. The ten-minute pilot demonstrates changing reported coordinates, not prediction accuracy.

Before collecting or publishing positions, confirm access, reuse permission, measurement timing, route/direction matching and operational ownership. Retain bounded collection, backoff/refusal handling and private raw storage. Repeated payloads, stale positions, gaps, jumps, off-route records, ambiguous trips and exclusions need inspectable quality receipts. This roadmap does not install a collector or scheduled job.

A pilot planning target is seven usable days and at least 100 completed anchor observations, with three later whole days reserved for evaluation where feasible. These are collection targets, not proof of representativeness or independent sample size. Split by whole trip/day; record day type and unsupported periods. Begin with recent-runtime persistence and route/direction/time-period medians. Compare more complex models only when the observations support them. Never train on timetable illustrations or assumed road-delay multipliers.

Report mean and median absolute error in minutes, trips/days, horizon, benchmark errors, exclusions, freshness, interval width and later coverage. Abstain on stale or unsupported input. If fetch time is the only timestamp, explain its limits rather than treating it as a GPS measurement time.

Road-performance inference must separate movement between stops from boarding dwell, dispatch waits and terminal layovers. Bus corridor delay does not measure all road traffic. A public congestion view needs a verified policy use: for example, prioritize a corridor for operator review after repeated excess running time. Road reopening, signal changes or rerouting require engineering, safety, fleet and legal review. Observed delay or a news article alone cannot prove an intervention's causal benefit.

## 3. Improve modeled healthcare decisions and corridor coverage

Use [agency-input requirements](policy-investment-release.md), [location audit](location-audit.md), [facility review](facility-operation-review.md) and [transit review](transit-operation-review.md) as the operational checklists.

First obtain complete direction-specific bus calendars, morning/Friday/weekend exceptions, stop times and feasible vehicle circulation. Verify facility entrances, suitable services, eligibility, operating hours and capacity. Reconcile ferry calendar validity, crossing runtimes, terminal walking links and return journeys. Obtain local fleet, labor, maintenance, energy and site costs before presenting an affordable implementation recommendation.

Expand one verified inter-island corridor at a time. Keep official geographic denominators distinct from routed service coverage, with unknown evidence visible. National population dots or port/airport totals do not extend the routing network. Complete Greater Malé evidence is more useful than many islands with invented connections.

Acceptance: every recommended action has a responsible reviewer, supported operating period, resource requirements, beneficiaries, residents losing/slowing access, unknown coverage and explicit feasibility conditions. The access range covers uncertainty inside the loaded model; omitted services or road data can still change it. Population-weighted modeled access is not observed ridership, successful care or a causal impact estimate.

## 4. Integrate reviewed public notices

Extend the [existing attributed-candidate workflow](operations-data.md), rather than bypassing review. Use permitted public sources, preserve exact source passages, publication/retrieval times and links, and resolve English/Dhivehi place names, effective dates, corrections, cancellations and duplicates.

A reviewer must map the event to the correct road/service extent, direction, affected modes and expiry. Persist review decisions and history before connecting a notice to a scenario. Evaluate extraction on reviewed examples including ambiguous locations, negative statements, cancellations and duplicated bilingual reports. Do not infer a road closure, severity or extra minutes from a vague report; automatic ingestion must not automatically close roads.

Acceptance: the map and scenario can explain who reviewed each event, what the source established, which assumptions were added, and when the event expires. Reported events remain separate from measured delay and from a model's forecast.

## 5. Test policy comprehension and delivery

The five-person first-time policymaker study remains pending. Adapt the [detailed-editor protocol](policy-investment-release.md#verification-and-human-study) to the current map-first workspace and linked analytical pages. Use a neutral task: “Locate an area to investigate, explain what the passenger outlook suggests preparing, then compare a healthcare service option and identify one reason it might not work.” Record role, device, source/model versions, completion time, errors and help; avoid coaching.

A useful first-minute gate is at least four of five participants independently distinguishing actual counts from estimates, reading the source date and forecast reliability, identifying an actionable follow-up, and recognizing a loss or unknown in the policy comparison. Separately check capital versus annual costs, assumptions, undo and source inspection in the detailed editor. Developer/browser QA is complete for the recorded release; it does not certify this human study.

Test the actual presentation device/projector and a lower-end mobile device. The historical model-only timing target is not a browser responsiveness guarantee. Select a deployment adapter, verify public-only responses and credential boundaries, and confirm provider/source reuse terms before public deployment. No agency endorsement, production monitoring or redistribution authorization is implied.

For a competition presentation, use the [current five-minute script](DEMO_SCRIPT.md) and recheck the [official competition FAQ](https://www.datathon.stats.gov.mv/faq) for the submission's current requirements. Demonstrate the decision, source trail, difficult tradeoff and next evidence gate; avoid adding features whose output cannot change a defensible decision.
