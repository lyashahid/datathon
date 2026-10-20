# Island Connections: model methodology

The planning atlas compares access and service changes in a proposed transport network. It is a decision aid: results are estimates for the selected scenario and input data, not official SDG statistics or validated forecasts of behaviour.

## Evidence and interpretation

Every result must retain the dataset name, measurement period, geographic coverage and provenance: observed, demo, assumed or simulated. A current source publication date does not make an older observation current. The interface must distinguish residents with improved access from predicted passengers, and scheduled service from measured service.

- Route geometry and stops describe where service can operate. A stop without an active serving route is not a useful public transport connection.
- Timetables or service frequencies describe when a journey is possible; a line on the map alone cannot establish journey time or frequency.
- Population must be counted once across overlapping catchments. If data are island totals or synthetic grids, present the resulting spatial estimate with that limitation.
- GPS devices describe sampled vehicles or trips. Their count is not the resident population, unique passengers, demand or mode share.
- Passenger boardings measure use of existing services. They do not directly reveal unmet demand in places without service.
- Missing, invalid or unavailable inputs stay unknown. Zero is reserved for a computed zero supported by the available inputs.

## Access and journeys

[UN SDG 11.2.1 metadata (April 2025)](https://unstats.un.org/sdgs/metadata/files/Metadata-11-02-01.pdf) defines spatial access along a walking network: 500 m for low-capacity systems such as buses and 1 km for high-capacity systems including ferries. Distance alone is insufficient to describe convenient access. Frequency, safety and universal accessibility are additional considerations. Straight-line buffers must be labelled as proximity estimates, not network walking access.

For network journeys, account for walking to a stop, waiting, in-vehicle travel, transfers and walking to the destination. Avoid paths over water unless they use an explicit ferry connection. A new terminal or stop must connect to a valid route before it improves destination accessibility. A bus should only operate along usable roads, while a ferry uses a water route between usable terminals.

When a frequency assumption replaces a timetable, expected wait of half the headway assumes random arrival and regular service; label it as an assumption. It is not measured reliability. Display a total journey time only when all required legs have valid estimates. An inaccessible destination is distinct from an unknown journey caused by missing data.

Report residents with access to essential services within a stated threshold, and explain the threshold and time period. School and hospital locations can support counts of reachable facilities; they cannot establish facility capacity, treatment availability or the number of jobs without additional data.

[Javanmard et al. (2025)](https://www.sciencedirect.com/science/article/pii/S2214367X25000729) show a practical way to compare scheduled, typical and conservative travel times using GTFS real-time observations. Implement reliability estimates only when sufficient local observations exist. [Tokey et al. (2025)](https://www.sciencedirect.com/science/article/pii/S2590198225002556) show why a general street network can overstate accessibility for people who depend on sidewalks. Wheelchair access cannot be inferred simply from proximity to a stop.

## Road-closure scenarios

The backend applies explicit road-closure operations to the permitted graph. For affected bus segments it preserves the published reference runtime and adds the extra shortest driving-path distance at an assumed 15 km/h. A segment without a resolved permitted driving connection disables the affected pattern with a warning. Returned detour geometry is modeled, rather than an observed operator diversion.

This is a conditional closure screen. It does not measure queues, calibrate traffic speeds or prove that spare vehicles and accessible boarding points exist. Reviewed public notices remain separate evidence until an operation is explicitly applied; see [operations evidence](operations-data.md). Current implementation details are in the [backend planning guide](../backend/app/planning/README.md).

## Service cost and resources

Calculate service vehicle-kilometres and vehicle-hours from route length, service span, departures and round trips. Do not count a one-way route as a round trip, or count an added bus as a free-standing asset without a service pattern. Fleet needs depend on round-trip cycle time, layover and headway. Display capital expenditure and recurring annual operating costs separately.

Use local operator costs when available. Any generic cost per kilometre, fuel price, purchase cost or annualization factor is an editable assumption with units and source. A cost estimate missing these inputs remains unestimated; do not supply a zero or an unsupported exact MVR amount. Revenue or net subsidy needs require fares and ridership assumptions and should remain separate from gross service cost.

## Carbon and environmental effects

Start with the scenario's additional service emissions. For combustion vehicles, use measured fuel where possible or vehicle-kilometres multiplied by fuel intensity and a documented fuel emissions factor. For electric vehicles, include energy use and electricity generation emissions. Distinguish direct operation from upstream fuel/electricity and vehicle manufacturing boundaries; do not call an electric vehicle universally zero-emission.

Net savings are displaced private-travel emissions minus additional bus/ferry emissions. Report net savings only with an explicit assumption for displaced travel. New catchment residents are not guaranteed riders, and every new transit passenger does not replace a car trip. Include low/base/high uptake or mode-shift cases where these effects are explored. Additional service can increase net emissions if it displaces little private travel.

[IPCC mobile combustion guidance](https://www.ipcc-nggip.iges.or.jp/public/2006gl//pdf/2_Volume2/V2_3_Ch3_Mobile_Combustion.pdf) provides established emissions accounting methods; [ITF emissions accounting guidance (2024)](https://itf-oecd.org/ghg-emissions-accounting-reporting) emphasizes consistent boundaries, factors and data quality. Methods do not replace missing Maldives-specific inputs.

Weather and shade can support a comfort or disruption scenario. Ordinary forecast data cannot substantiate precise pedestrian heat exposure, health outcomes or ferry cancellation probabilities. [Liu et al. (2025)](https://www.urbandemographics.org/files/2025_Liu_extreme_heat_in_public_transit.pdf) combine detailed microclimate and journey legs for heat exposure; until equivalent inputs exist, use labelled outdoor walking/waiting minutes or weather stress proxies.

## SDG and policy reporting

- **11.2.1:** Show an SDG-aligned spatial access estimate only with its network/demographic limitations. Official reporting also requires suitable boundaries and subgroup evidence.
- **3.6.1:** [Road traffic deaths per 100,000 population](https://unstats.un.org/sdgs/metadata/files/Metadata-03-06-01.pdf). Traffic camera counts cannot establish mortality, and adding a bus does not automatically yield a defensible lives-saved estimate.
- **9.1.1:** [Rural population within 2 km of an all-season road](https://unstats.un.org/sdgs/metadata/files/Metadata-09-01-01.pdf). An island-to-essential-service measure is useful for Maldives but is a separate local metric, not a redefinition of this indicator.
- **9.1.2:** [Passenger-km and freight measures by mode](https://unstats.un.org/sdgs/metadata/files/Metadata-09-01-02.pdf). Passenger boardings are not passenger-km. Maritime freight uses tonnes and container port traffic uses TEU.

An exported policy brief should include baseline and proposal values, selected interventions, source dates, model assumptions and any results that remain unestimated. Do not hide missing evidence with reassuring precision. [Urbano, Arena and Azzone (2025)](https://doi.org/10.1016/j.rtbm.2025.101298) support selecting complementary data for the decision at hand. [ITF data-informed mobility governance (2025)](https://itf-oecd.org/data-informed-mobility-governance) supports making evidence and assumptions inspectable and evaluating implemented policies against outcomes.

## Current policy investment requirements and limits

Initial date/time settings select a supported window in the partial observed bus snapshot. Coverage appears beside results and is computed from the baseline: proposed frequency service cannot make missing observed calendars complete. Outside-snapshot departures remain explicitly qualified. Public ferry day-type calendars are cached as evidence, with unavailable crossing durations; opposite-direction departure columns are never treated as arrivals.

Access changes distinguish new target access, lost access, slower journeys and unknown results, including island summaries. Priority areas require a measured gap. Investment comparison is a bounded search that excludes unknown costs, over-budget options and options without measured access, journey or conditional-carbon improvement. Both capital and annual operating limits apply using the chosen central/high cost basis. Rankings are not a global optimum, observed demand forecast or adopted value-for-money rule; modest gains need local investigation.

Destination suitability can require emergency/specialist care, school level, public eligibility and verified hours. Missing reviewed metadata remains unavailable. Proposed school/clinic sites test conditional locations and require staffing, capacity, land and cost evidence before investment appraisal. An audited-wheelchair requirement needs a continuous verified journey, including entrance/crossing/boarding facts; mapped paths and isolated HDC observations do not certify that journey.

Optional 2030 housing redistribution preserves the official island total, allocating an editable share to selected same-island origins and the remainder to other origins. Construction completion, occupied units and neighborhood demographics are not observed. Constituency Census profiles remain contextual until official boundaries are matched. The school statistics' institution totals and the current mapped-site subset require reconciliation across dates/categories. HIES 2019 is historical expenditure context; editable fare affordability is not a neighborhood income estimate. IGMH encounters are institutional activity, not unique residents or accessible appointment slots.

The brief carries source/version pins, gains/losses/unknowns, cost/carbon assumptions, agency, phases and unresolved verification. Automated source/API checks, rendered PDF/browser review and the five-person nontechnical study are distinct acceptance steps. See [policy investment evidence](policy-investment-release.md) for acquired source counts, agency inputs and the uncompleted human-study protocol.
