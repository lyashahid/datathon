# Data analysis assessment and next opportunities

Historical assessment reviewed 15 October 2026. **Implementation update, 16 October:** the national resident, census, labour, projection, school, constituency, hospital, household and relevant finance/transport source conversions are now implemented; see [national data models](national-data-models.md). Counts and future-tense descriptions below describe the earlier snapshot, not current coverage. Both reviewed spelling aliases are now reconciled, giving 186 employment matches.

Reviewed 15 October 2026. This assessment combines a fresh profile of every installed analytical collection, a read-only code/API review, and inspection of the underlying census, school, hospital, transport and spatial archives. The new deliverables are the assessment, source inventories, calculations and executed notebook. Recommendations below are proposed additions; they have not been added to the application in this review.

The strongest next step is to turn the existing evidence into decisions: where access improvements are needed, which recorded barriers merit repair, and which combination of proposals delivers the most modeled benefit within a budget. Several useful source families currently appear in the generic explorer without a dedicated analytical workflow.

## Scope and source coverage

The installed catalogue contains **38 available collections from 15 distinct derived artifacts**. Collections often share upstream sources and are not independent datasets. Raw workbooks and PDFs contain additional indicators and history beyond those collection views. Demo, sample and ingestion-fixture records are excluded from real-data findings.

| Evidence family                            | Installed scale                                                                            | What is currently done                                                                                                                                 | Useful additional analysis from existing evidence                                                                                                                                                       |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| National islands, census and facilities    | 1,561 island records; 190 islands with reconciled 2022 census totals; 840 facility records | Island/atoll profiles, facility counts, population context, source matching, static accessibility index and candidate screening                        | Separate inhabited/census-covered cohorts; service-record coverage per resident; evidence-aware opportunity and field-audit priorities; demographic context using archived indicators                   |
| Greater Malé residents and walking network | 667 weighted origins; 4,359 nodes; 5,743 edges; 45 audited facilities                      | Before/after travel-time bands, gained/lost/unknown access, resident-weighted minutes saved, impact hex tiles, healthcare/school proposals             | Compare evaluated proposal portfolios; sensitivity to walking speed, target time, service assumptions and cost; identify access gaps that remain robust across assumptions                              |
| Transit and delivery                       | 99 stops; 11 timed patterns; 15 route catalogue records; 4 ferry calendars                 | Outward/return journeys, timetable editing/imports, fleet blocks and explicit capacity/duty/depot/energy screens                                       | Coverage/calendar audit; compare explicitly specified service alternatives, and their access gains against operating cost; identify stop/facility connections worth field review                        |
| Passenger movements                        | 161 monthly observations across 3 categories                                               | Monthly forecasts, chronological backtests, benchmark/range diagnostics, source-vintage review and frozen forecast issues                              | Curated same-window growth, seasonal profiles and forecast-risk summaries; study bias/recency policies with declared evaluation rules; extend other published bus categories after checking definitions |
| Hulhumalé accessibility audit              | 1,316 located survey records                                                               | Generic charts, filters and source profiling                                                                                                           | Dedicated entrance/ramp/obstruction/continuity analysis, mapped barrier clusters and a repair/field-audit shortlist with explicit denominators                                                          |
| Hulhumalé planning and public realm        | 3,958 masterplan lots; 310 pavement footprints; 3,838 tree points                          | Explorer and evidence context                                                                                                                          | Designated-site screening by land use/area/phase; links between observed barriers, pavements, stops and facilities; tree proximity alongside pedestrian priorities                                      |
| School statistics                          | Archived 38-page 2023/2024 publication; current facility/operating reviews                 | Destination eligibility and geographic school access; source inspection                                                                                | Extract grade/sex/atoll/locality enrolment and teacher context; display dated pupil-demand context separately from all-resident access                                                                  |
| IGMH hospital utilization                  | Current bundle exposes 12 observations for 2024/2025; archive has longer annual history    | Generic metric exploration and healthcare destination access                                                                                           | Institutional trends in encounters, admissions, patient-days, reported stay and occupancy; reconcile definitions before deriving new ratios                                                             |
| Household and constituency context         | 24 HIES 2019 expenditure observations; 17 constituency records                             | Generic explorer/context profiles                                                                                                                      | Transparent fare/expenditure scenarios and source-defined labour/education profiles; no neighborhood allocation until boundaries and denominators are supported                                         |
| Airport and port activity                  | 210 airport observation rows; 172 port-table records; 5 port aggregates                    | Curated source tables, explorer, source reconciliation and movement context                                                                            | Separate annual/monthly airport seasonal profiles; preserve cross-table discrepancies; port activity/coverage review                                                                                    |
| Weather, traffic, positions and notices    | Request-time feeds; 20 captured dated CAP alerts; bundled road/notice tables empty         | Conditions, real observed movement display, map-picked driving checks, reviewed notice overlays                                                        | Exposure to documented warnings and explicit disruption scenarios; a longitudinal operational archive if source-event time, trip identity and outcomes become available                                 |
| Cost, energy, budget and emissions inputs  | Editable factors and reviewed delivery references                                          | Capital/operating/budget changes; simple cost sensitivity; energy calibration; marginal electricity tariff; emissions calculations where factors exist | Multi-parameter robustness and budget portfolios using existing calculations; improved investment estimates after validated quotes, energy logs and grid factors are supplied                           |
| Vela places/media/directions               | Vendored FastAPI functionality and map-first place inspection                              | Discovery, detail/reviews/photos, alternatives/waypoints and panoramas                                                                                 | Field-review context and candidate inspection; consumer places do not become authoritative service-capacity data automatically                                                                          |
| Reviewed national timetables               | Import/review/search functionality; **0 accepted services and 0 snapshots** currently      | Dated timetable ingestion and earliest-arrival inter-island search are implemented                                                                     | Populate accepted services and documented runtimes, then analyze inter-island journey feasibility; current empty store cannot establish national arrival times                                          |

The census attachment count of 1,932 is a count of linked demographic rows, not islands. Of 3,510 unattached census rows, 3,475 describe aggregate geography intentionally excluded from island joins. Summing total/sex/nationality/age rows would double-count population. Source-level missingness can also mean an inapplicable field rather than a defective record.

The 190 reconciled island summaries cover **447,420 residents**, against a published Republic total of **515,132**. The remaining 67,712 cannot be assigned to these summaries. Also, **668 of 840 facility records lack point geometry**; having an official source record does not establish a verified map location or operating capacity. These coverage differences must appear beside national rankings and per-capita measures.

## Findings from recomputed analysis

### Comparable passenger growth

January–May is the common complete comparison window for all three trusted categories. The notebook recalculates:

| Published category          | Jan–May 2025 movements | Jan–May 2026 movements |  Change |
| --------------------------- | ---------------------: | ---------------------: | ------: |
| Malé VM ferry endpoint      |              1,052,869 |              1,129,995 |  +7.33% |
| Villigili VM ferry endpoint |              1,090,398 |              1,137,395 |  +4.31% |
| Malé/Hulhumalé bus          |              1,364,266 |              1,502,473 | +10.13% |

This supports a descriptive finding that the published bus category grew faster over this window. It does not establish modal shift, unique passengers, individual routes or a policy effect. The ferry endpoint categories remain separate because overlap/boarding interpretation is undocumented.

### A concrete pedestrian accessibility opportunity

In the captured Hulhumalé audit, **858 of 1,103 records with a step-free entrance assessment (77.8%) report “No”**. The full collection includes 214 “Yes”, 31 partial entrances and 213 missing values. Movement continuity is reported “No” on 989 records, “Yes” on 136 and missing on 191.

These are counts within the captured audit, dominated by commercial locations. They are not representative island prevalence or affected-resident counts. A dedicated view can immediately expose observed barriers by zone and category, then link them to stop/facility inspection. Verified approach/edge accessibility is still needed before certifying wheelchair routes.

### Resident access gaps and evidence gaps are different

The live baseline model was evaluated without proposal changes at **10 October 2026, 15:20 Maldives time**, 80 m/min walking, a 30-minute target and 2026 projected resident weights:

| Healthcare scope | Projected residents |               Within 30 minutes |    Known journey above 30 minutes | Unknown journey evidence |
| ---------------- | ------------------: | ------------------------------: | --------------------------------: | -----------------------: |
| Hulhumalé        |              95,474 |                 85,180 (89.22%) |                             8,046 |                    2,247 |
| Malé             |             143,554 |                  143,554 (100%) |                                 0 |                        0 |
| Vilimalé         |               7,250 | 0 supported qualifying journeys | 0 supported journeys above target |             7,250 (100%) |

Values are rounded projected weights; independently rounded cells may differ by one resident. Hulhumalé offers a supported modeled improvement target. Vilimalé primarily exposes missing journey/facility evidence in this model, including unverified ferry runtimes. Neither this table nor a nearby facility proves appointment availability or clinical capacity.

Hulhumalé school access is 97.65% within 30 minutes at the same settings, but its denominator is **all projected residents**, not pupils. That output should not be presented as school capacity or enrolment coverage.

The national static index also needs careful presentation: 1,466 of 1,561 records receive zero and every record has at least one missing-input flag. The index combines heuristic coverage/distance inputs across mixed residential/non-residential islands. Its zero is not observed deprivation, and its confidence score is not a probability. A zero-score investment league table would reward missing evidence.

### Source findings from the pre-expansion assessment (now converted)

- The island population workbook has **186 administrative-island rows**, all safely matched through current atoll/locality reconciliation. It includes nationality, historical growth, age/dependency and density context. The age/dependency cohorts apply to resident Maldivians; the sheet excludes Greater Malé and non-administrative islands. The 236,911 resident total across this subset is not the national total.
- The employment workbook has 186 rows and **186 reviewed island matches** after reconciling L/Mundhoo and GDh/Madeveli with the official island identities. Adult, labour-force and youth denominators differ, and percentages cannot be summed into national rates or interpreted as trips.
- The IGMH archive has beds/outpatient history for **2010–2025**, and several inpatient metrics for **2005–2025**. Reported occupancy is missing in 2023/2024. Published stay and patient-days/admissions do not reconcile identically in all years; retain reported measures and seek definition clarification rather than replacing them. Year-end beds are not average annual available beds.
- The school publication contains dated enrolment by grade/sex/atoll/locality, plus teacher context. These are useful historical demand indicators. They do not supply current school seats, classroom availability, home locations or daily pupil journeys. Extraction must preserve page/table identifiers and source inconsistencies.

For example, the school PDF's Greater Malé subtotal differs between page 10 (37,707) and pages 12/36/37 (38,836). The latter reconciles Malé 26,819 + Hulhumalé 11,090 + Vilimalé 927. This is a source-definition/reconciliation question, not permission to silently replace a published value.

## Forecasting: what to retain and what to improve

The current engine already compares **nine candidates plus a locked ensemble**, with earlier chronological selection, separate range calibration and six later evaluation origins per horizon. It reports MAE, RMSE, WAPE, bias, benchmark skill and range coverage. A more complex candidate must improve earlier MAE by at least 5% over the earlier best simple baseline. Complexity alone is not a useful improvement target.

Trusted actuals end June 2026 for ferries and May 2026 for bus. The [MBS monthly index](https://statisticsmaldives.gov.mv/monthly-statistics/) still listed June 2026 as its latest release when checked on 15 October. June bus values are quarantined because all six published categories repeat May, including the prior release's values. A November forecast therefore operates at five months for ferries and six for bus, despite a “next month” calendar label.

| November category     | Actual-relative horizon | Later historical WAPE | Nominal 80% range coverage |
| --------------------- | ----------------------: | --------------------: | -------------------------: |
| Malé VM endpoint      |                5 months |                 6.54% |                        6/6 |
| Villigili VM endpoint |                5 months |                 7.67% |                        3/6 |
| Malé/Hulhumalé bus    |                6 months |                12.33% |                        5/6 |

WAPE is absolute error divided by actual movements over the later evaluation rows. These are historical diagnostics, not measured November accuracy. Each selected policy loses to at least one simple comparator on those later outcomes. Replacing a model after inspecting the same outcomes would not demonstrate independent improvement. The current history uses revised vintages and has already been explored; all three stored November issues await actuals.

Keep simple benchmarks visible, show cutoff/horizon/bias beside the point estimate, and score immutable forecasts as new observations arrive. Study conservative recency, earlier-estimated bias adjustment and limited calendar features using predeclared chronological evaluation. Freeze any revised policy before future outcomes. Separately calibrated ranges currently exist only for horizons 1–6; an absent range is not zero risk.

Airport monthly series contain only 12 months in 2025. Only that overlap exists for exploratory comparisons with bus/ferry categories, so adding numerous airport/weather predictors now would be difficult to validate. These priorities follow the forecasting authors' guidance on [chronological validation](https://otexts.com/fpp3/toolbox.html#time-series-cross-validation) and [predictor availability](https://otexts.com/fpp3/regression.html#some-useful-predictors). They are methodological proposals, not demonstrated accuracy gains.

## Recommended analytical product

Organize analysis around a policy question, then reveal the evidence and map action. Keep Data Studio as the detailed explorer.

1. **Decision overview:** “Where is there supported need?” Show selected resident/geographic cohort, service/access evidence coverage, known gaps and unknowns. Include observed passenger trends and forecast risk with actual dates. Keep an evidence-collection priority separate from an infrastructure priority.
2. **Access and repair priorities:** “Which locations should we inspect or improve?” Map HDC assessed barriers and clusters near stops/facilities, with question-specific denominators. Add designated-site screening against masterplan land use/area/phase and modeled access gaps. Designation alone does not establish ownership, availability or construction status.
3. **Investment comparison:** “Which combination fits the budget?” Evaluate candidate and combined proposals on the same network. Show known resident gains, minutes saved, capital, annual operating costs, emissions where supported, and unknown residents. Report dominated options and trade-offs. Do not add beneficiary gains from independent proposals when catchments overlap. Expand existing single-factor cost sensitivity into explicit multi-parameter scenarios.
4. **Population and service pressure:** “How is the relevant population changing?” Expose validated island age/employment indicators, projections, dated school enrolment and IGMH institutional history at their real geographic/temporal grain. Never uniformly distribute island cohorts into origins or turn growth into observed route demand.
5. **Forecast reliability:** “How much reliance can we place on this outlook?” Pair observed changes with actual-relative horizons, simple comparisons, bias, range misses and pending prospective scores. Retain publication/revision context.
6. **Evidence and explorer:** “What supports this decision?” Preserve source periods, units, missingness, joins, definitions and downloadable exact results. A saved chart definition that reloads current data should be distinguished from a frozen finding.

The first three deliver the most immediate policymaker value. Existing cost, fleet, timetable, comparison and calibration features should be reused rather than duplicated.

## Analyses that require additional evidence

| Desired outcome                                                      | Missing inputs                                                                                                                                                                          |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Forecast boarding demand, route occupancy or optimize real frequency | Route/stop/direction/hour boardings, onboard loads, operated trips, fares and vehicle capacities                                                                                        |
| Validated arrival times or weather-related cancellation risk         | Repeated measured trip/stop events, source-event timestamps, directional trip identity, cancellations and aligned historical weather/traffic features available at each forecast origin |
| Capacity-aware healthcare/school access                              | Facility-specific usable capacity, opening hours/specialties, appointment/enrolment data and suitable cohort/home-location denominators                                                 |
| Neighborhood age/disability equity                                   | Audited small-area cohorts or supported spatial boundaries; constituency boundaries are unmatched in all 17 current records                                                             |
| Actual cooling/shade/carbon benefits                                 | Canopy/geometry, local thermal/shade observations, methods and unit/date validation; canopy size is absent on 3,822 of 3,838 tree records                                               |
| Investment-grade costs and lifecycle emissions                       | Current site quotes, measured energy/fuel/charging logs, service life and validated delivered-grid CO₂e factors                                                                         |
| Causal evaluation of a policy                                        | Dated implementation and exposure, comparable outcomes before/after, credible comparison groups and a declared identification strategy                                                  |

Current positions, weather requests and consumer traffic checks supply useful context. They do not yet form a historical training panel with these labels. Empty bundled road/notice tables do not establish absence of disruption. HIES 2019 can support explicitly dated fare/expenditure scenarios, not current neighborhood income or poverty claims.

## Evidence and reproducibility

The maintained generators are committed under `scripts/`. Derived notebooks, CSVs, JSON receipts, figures and HTML previews are written under ignored `artifacts/analysis/`; they are generated locally and are absent from a fresh clone. Historical handwritten code/API notes, source interpretation and school-page receipts from the 15 October review are local working evidence, rather than outputs these generators recreate. The findings and limitations relevant to the product are retained in this document.

- [Notebook generator](../scripts/audit-analysis-opportunities.py): uses the bundled application data to produce `analysis-opportunities.ipynb`, `notebook-preview.html`, `notebook-verification.json`, `opportunity-findings.json`, source snapshots and three figures under `artifacts/analysis/2026-10-15/`. The manifest records source hashes, the analysis fingerprint and executed cells. The original notebook passed execution, format validation and source assertions; its figures were visually inspected.
- [Forecast audit](../scripts/analysis/forecast-review.py): uses bundled application data to independently recalculate backtest estimates and MAE for all 36 category/horizon specifications. Produces `forecast-review.json` and `forecast-review.csv`, including source receipts, range diagnostics, airport profiles and current frozen-issue status. Its default output directory uses the UTC run date. Current/next-month targets use the Maldives calendar; `--reference-month` fixes the target month for a historical comparison. The historical public-index check remains explicitly dated; this offline script makes no live-source check.
- [Optional original-archive inventory](../scripts/analysis/inventory-review.py): produces `inventory-review.json`, `island-indicator-review.csv`, `island-employment-review.csv` and `igmh-history-review.csv`. This deeper audit requires the original workbooks and PDF under ignored `data/raw/`, `data/public/archive/` and `backend/data/cache/raw/`. Those acquisition originals are unnecessary for running the application and are not included in Git. `--check-inputs` lists every required archive path and reports missing files before any outputs are written.

After the normal [project setup](../README.md), run the bundled-data analyses from the repository root with no environment variables:

```sh
uv run --directory backend python ../scripts/audit-analysis-opportunities.py
uv run --directory backend python ../scripts/analysis/forecast-review.py
```

To recalculate the forecast table's November 2026 targets, use `--reference-month 2026-10`. To inspect or run the optional original-archive audit:

```sh
uv run --directory backend python ../scripts/analysis/inventory-review.py --check-inputs
uv run --directory backend python ../scripts/analysis/inventory-review.py
```

Restore the historical archive files to the reported paths before running that optional inventory. The script exits with an explicit missing-input list when they are unavailable; it does not download replacement vintages or fabricate missing evidence. Both audit scripts accept `--output` for a separate derived-output directory.

The notebook generator uses the locked backend development dependencies: nbformat, nbclient, pandas, NumPy, Matplotlib, ipykernel, nbconvert and BeautifulSoup. Analysis receipts describe the inputs inspected during that run. Rerunning against changed application data, an accepted source import or another model version creates a new assessment; it does not preserve or independently validate the historical finding automatically.
