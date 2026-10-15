# Data analysis and passenger prediction — 14 October 2026

The usable prediction target is monthly published passenger movements in three aggregate categories. The app exposes 38 structured collections from 15 distinct captured artifacts, with 161 comparable passenger observations. Other collections support mapping, access scenarios, exploration and operational context. They do not form a validated historical passenger feature panel. Joining contemporary captures to old outcomes would manufacture a grain or use information unavailable at a forecast origin.

The production method now separates earlier model selection, independent range calibration and six later evaluation origins. Complex models must earn inclusion against simple baselines. This strengthens the methodology and exposes weaknesses; it does not establish a universal accuracy improvement.

## Source fitness and consequences

| Evidence                             | Checked grain/coverage                                       | Consequence                                                                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Malé VM ferry endpoint               | 54 months, Jan 2022–Jun 2026                                 | Forecast the published category.                                                                                                                                         |
| Viligili VM ferry endpoint           | 54 months, Jan 2022–Jun 2026                                 | Keep endpoints separate; counts are not unique riders.                                                                                                                   |
| Malé/Hulhumalé bus                   | 53 months, Jan 2022–May 2026                                 | June is quarantined because all six published bus categories repeat May.                                                                                                 |
| Census population                    | Island/demographic category; reconciliation maps 190 islands | Use census for national island context. Greater Malé access uses separate projection-normalized WorldPop allocations; overlapping census tables are not additive people. |
| Facilities, origins and calendars    | Geographic snapshots and bounded timetables                  | Scenarios require validity, assumptions and capacity status.                                                                                                             |
| Airport/port and policy observations | Different geography, period, units and metrics               | Separate context/charts; no automatic passenger covariate join.                                                                                                          |
| Live alerts/positions                | Current captures                                             | Situational context, not historical training or ETA validation.                                                                                                          |
| Road events and notice candidates    | Empty captures                                               | Zero observed records does not prove no incidents.                                                                                                                       |

All passenger histories have zero duplicate months, missing interior months or invalid counts. All 38 collections have zero exact duplicate rows after documented transforms. This narrow check does not certify composite-grain uniqueness: repeated dimensions/identifiers are separately reported. Null cell rates and mixed types are measured without replacing unknowns by zero. Temporal bounds are lexical source descriptors, not standardized publication dates.

Profiles include grain/unit qualifications, source URLs/timestamps and SHA-256 receipts. Raw lineage files are traced, not counted again as independent observations. The analysis fingerprint pins collection receipts and passenger source. The current trusted cutoffs remain June 2026 ferry and May bus; no later actuals were invented. Official freshness checks and explicit source acceptance are separate operations.

## Method and selection evidence

Each horizon from one to twelve months is evaluated independently. The first 18 observations initialize expanding origins. Nine candidates comprise last month, last-year month, three/six-month means, fixed damped trend, fixed seasonal-level blend, prefix-tuned exponential level, fixed damped Holt and regularized month-dummy/trend regression. Regression uses the latest 36 months with a 24-month weight half-life and declared ridge penalties. No live/weather/population covariates are fitted.

A tenth policy combines the three smallest earlier-MAE methods using inverse-MAE weights. Membership/weights are frozen on selection outcomes. A candidate must reduce earlier MAE by at least 5% versus the best simple baseline; otherwise that baseline remains selected. This is a conservative engineering guard, not a significance test. Later outcomes do not choose the model, tune weights or widen ranges.

Where history permits, a separate 8–12-origin block calibrates absolute residuals. Selection targets are observed by the first calibration training cutoff and calibration targets by the first evaluation training cutoff. Each boundary has a horizon-minus-one embargo. A finite absolute-error order statistic forms a nominal 80% empirical range. Insufficient independent calibration history leaves the point forecast available and the range unavailable. Present 53/54-month histories cannot support a separate calibration block for seven-to-twelve-month horizons.

The design follows expanding-origin validation, declared predictors and damped smoothing in the authors' [Forecasting: Principles and Practice](https://otexts.com/fpp3/toolbox.html#time-series-cross-validation), [regression chapter](https://otexts.com/fpp3/regression.html#some-useful-predictors), and [exponential smoothing chapter](https://otexts.com/fpp3/exponential-smoothing.html). The ridge, ensemble and complexity settings are implementation choices.

## Measured five-month diagnostic

| Category                | Locked policy               | Selection / calibration / later origins | Later WAPE | Nominal 80% range coverage |
| ----------------------- | --------------------------- | --------------------------------------- | ---------: | -------------------------: |
| Malé ferry endpoint     | Selection-weighted ensemble | 10 / 8 / 6                              |       6.5% |               6 / 6 (100%) |
| Viligili ferry endpoint | Seasonal ridge              | 10 / 8 / 6                              |       7.7% |                3 / 6 (50%) |
| Bus movements           | Last-year month             | 9 / 8 / 6                               |      12.3% |              5 / 6 (83.3%) |

These are horizon-specific historical checks, not observed November performance. November's bus forecast is six months ahead because its trusted cutoff is May. Viligili's range under-covers; the selected bus policy loses to simpler methods on later rows. Those facts stay visible. The notebook compares every candidate's earlier/later MAE and every horizon's WAPE/coverage without retuning on later answers.

Six dependent later origins provide limited evidence. Serial dependence, drift, revised workbooks and unknown publication-time availability prevent assured coverage or pristine prospective accuracy claims. Historical data were explored before this design. Newly frozen receipts must be compared with subsequent publications to establish a prospective record.

## Deliverables and operational use

**Data & method** shows collection fitness, completeness, horizon diagnostics, baseline skill, measured coverage, export and reviewed imports. Imports are staged, every difference exposed and historical revisions explicitly accepted. Validation checks contracts/receipts; it does not independently certify uploaded workbook contents. Accepted snapshots update forecasts, analysis and Data Studio while preserving originals and frozen forecasts. Older model receipts are labelled historical.

The [analysis script](../scripts/analyse-mobility-data.py) produces an executed [notebook](../artifacts/analysis/2026-10-14/mobility-data-analysis.ipynb), [portable preview](../artifacts/analysis/2026-10-14/notebook-preview.html), [JSON audit](../artifacts/analysis/2026-10-14/data-analysis.json), and four inspectable figures. It reads captured/accepted evidence and leaves source inputs unchanged.

Use selected estimates, errors/bias and coverage as aggregate planning inputs. Population weights support access scenarios, not trip demand. Route predictions need dated boarding/origin–destination counts, frequency, capacity/load, direction, fares/disruptions and feature-availability timestamps. Retain first-release vintages and frozen receipts before claiming prospective gains. No causal policy effect, street demand, unique riders, occupancy or ETA is inferred from incompatible sources.

Verification: 53 focused backend forecast/dataset tests passed. The notebook executed six code cells and produced four figures. Legends, labels, scales and coverage gaps were visually inspected. All 11 live browser checks passed on the production preview, including forecast/source analysis, invalid-import rejection, full-data charts/exports, frozen receipt integrity and 390px mobile layouts. No uncaught browser errors or horizontal overflow were observed; the report and screenshots are retained with QA artifacts.
