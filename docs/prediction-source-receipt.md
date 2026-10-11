# Prediction source receipt

Checked 11 October 2026. The application uses an audited experimental monthly outlook, and a bounded private capture utility for evaluating whether a future passage-time pilot is feasible. No evaluated bus arrival model is claimed.

## Monthly statistics

`scripts/prediction-data.py` produces `data/public/prediction-source.json`. Its default mode downloads the four official publication workbooks, reads their first publication worksheet, verifies exact calendar ranges and category labels, and records SHA-256 checksums and historical overlap comparisons. It does not use internal Workings sheets. `--audit PATH` supports rebuilding from the independently saved audit artifact.

The importer checks every row-4 month header before assigning dates, accepts only explicit English month aliases and surrounding whitespace, and verifies every January row-3 year anchor plus any repeated year cells. Source-specific worksheet titles and calendar starts are pinned: June and May 2026 begin January 2022 at column AB; the December 2024 issue begins at BJ. The December 2023 issue's actual first-sheet title is `Nov 2022`, retained as an audited layout exception rather than inferred from its filename. The latest table headings and exact trusted column-C labels (`Male' ( VM Ferry )`, `Villigili' ( VM Ferry )`, `Male'/Hulhumale`) are checked; all six bus quarantine labels are pinned in both latest and prior-May sheets. A layout or category change stops preparation instead of silently relabeling values. Older overlap rows are located by these trusted constants, never by a newly discovered latest label. The `--audit` path also checks exact category/row identity, every month in order, finite nonnegative integer counts, and quarantine labels.

On 11 October 2026, all four official workbooks passed these guards in a fresh in-memory import, producing the expected 54/54/53 observations. No app source or capture was rewritten in this verification; `data/public/prediction-source.json` remained SHA-256 `b472467e54fabfc5b61cbf3c8d0e46279609f7accf5fe609e8a88add4d0d3742`.

- [Latest release index](https://statisticsmaldives.gov.mv/monthly-statistics/) and [June 2026 landing](https://statisticsmaldives.gov.mv/maldives-in-figures-june-2026/), published 7 September 2026.
- [June 2026 XLSX](https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2026/09/MIF_June-2026.xlsx), [PDF](https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2026/09/MIF_June-2026.pdf): Tables 11.2 and 11.3.
- [May 2026 XLSX](https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2026/07/MIF-May-2026.xlsx).
- [December 2023 issue XLSX](https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2024/02/MIF-Dec-2023.xlsx).
- [December 2024 issue XLSX](https://statisticsmaldives.gov.mv/mbs/wp-content/uploads/2025/01/MIF_Dec-2024.xlsx).

Two separately labeled VM ferry endpoint series have 54 contiguous monthly observations, January 2022–June 2026. The Malé/Hulhumalé bus category has 53 trusted observations, January 2022–May 2026. All six June bus categories exactly repeat May and match the prior May release. June is quarantined as ambiguous carry-forward; this does not prove imputation. Selected-series comparisons against the older source vintages match on all audited overlapping months.

The published quantity is passenger movement. Boarding/alighting, endpoint direction and unique-person interpretations are unresolved. Ferry endpoints remain separate; free-of-charge passengers are not added to route categories. No route/stop/peak demand allocation, occupancy or congestion measure is inferred. The already explored history and revised-vintage evaluation cannot be described as an untouched final test. Publication lag is distinct from forecast issue time.

`src/lib/server/data/predictionSource.ts` validates the durable JSON before the read-only `/api/prediction` endpoint uses it. Calendar gaps, duplicates, invalid counts/units, unverified source URLs, quarantine leakage and raw vehicle identity fields cause validation failure.

The validator now also requires the complete declared workbook receipt set and publication-sheet labels, a preparation version and consistent actual publication/check dates. Forecast API responses expose these workbook hashes and the revised-vintage qualification. Deliberate issue/score records and the resource review are documented in the [forecast issue workflow](forecast-issue-workflow.md). The source snapshot itself was not regenerated for this feature.

## Bounded RTL capture

The [official RTL public client](https://rtl.mv/) uses an unauthenticated POST to `https://bo.rtl.mv:4455/maldives/api/booking/v1/bus/livecoordinates` with `{"routeCode":"133"}`. The checked response has `busList` entries with bus code, plate number, latitude and longitude. It provides no verified source measurement timestamp, direction or trip label. Route association is the request's route code; coordinates alone do not independently establish a completed route or stop event.

[Public RTL terms](https://rtl.mv:7781/maldives/cms/CMSAllGetTermsCondition) were retrievable and describe carriage/sales/as-is conditions; an explicit open redistribution licence has not been established. Public access and private research capture are not a claim of open reuse authority.

Run `node scripts/collect-bus-positions.mjs --minutes 10`. Default sampling is approximately once per 60 seconds, bounded to ten minutes. `--minutes` permits 1–120 minutes; faster-than-minute collection is rejected. Source refusal (401/403/404/429), schema/route failures or three consecutive request failures stop collection. Transient errors use bounded backoff and each request has a timeout.

The parser immediately discards plates and raw identifiers, creates session-specific salted vehicle pseudonyms, excludes invalid coordinates and logs only aggregate counts. Normalized snapshots, quality/checksum records and dated replay are retained beneath ignored `data/raw/prediction/`. Repeated positions remain a quality flag: stationary buses cannot be declared stale from position equality alone. Retrieval time does not certify GPS measurement freshness. No persistent automation was installed.

After a capture completes, `scripts/prediction-data.py --capture-receipt PATH` can include its aggregate receipt in the public source audit. It publishes snapshot/vehicle/day counts and changing-position intervals, source/request identity, timestamps and qualifications. It does not copy coordinates, vehicle pseudonyms or plates into the public source.

The bounded ten-minute sample is source-readiness evidence, not enough independent trips/days to train or evaluate a passage-time forecast. A later pilot needs trustworthy label timing, directional anchors, trip/day separation, mandatory baseline evaluation and calibrated uncertainty before release.

The performed capture ran 11 October 2026, 16:48:56–16:58:56 Maldives time (UTC+5), and stopped on its duration bound. It accepted ten snapshots with four vehicles, nine intervals containing changed positions and 35 individual changed-position comparisons. These are not 35 trips. Source measurement times remained unavailable. The public JSON includes the aggregate receipt; the private replay is under `data/raw/prediction/2026-10-11T11-48-56-238Z/` and is ignored by Git. The collector is stopped and no recurring job is running.

## Independent statistical release check

The October 2026 outlook uses a four-month horizon for ferry and five-month horizon for bus. An independent Python calculation reproduced the model selection, all six later evaluation rows, MAE, WAPE, and empirical range coverage from the checked source; these matched the live `/api/prediction` response. MAE has units of passenger movements. WAPE below is an aggregate error percentage, not accuracy.

| Series             | Earlier-selected model | Later-six MAE | Selected WAPE | Persistence WAPE | Seasonal WAPE | Mean-three WAPE | Mean-six WAPE | Empirical range coverage |
| ------------------ | ---------------------- | ------------: | ------------: | ---------------: | ------------: | --------------: | ------------: | -----------------------: |
| Malé VM ferry      | Mean six               |     10,899.08 |         4.82% |            6.62% |         6.42% |           4.99% |         4.82% |              2/6 (33.3%) |
| Villigili VM ferry | Mean six               |     11,316.67 |         4.98% |            6.60% |         5.46% |           5.09% |         4.98% |              2/6 (33.3%) |
| Malé/Hulhumalé bus | Seasonal naive         |     36,925.17 |        12.33% |            4.83% |        12.33% |           7.42% |         7.22% |              3/6 (50.0%) |

Ferry evaluation targets are January–June 2026; bus targets are December 2025–May 2026. The selected bus model loses to every other reported benchmark on these later rows. Selection is intentionally preserved from earlier origins; choosing persistence after seeing the evaluation would require declaring a revised exploratory specification and new prospective evaluation. No claim of universal baseline improvement is warranted. Empirical 10th–90th residual ranges have poor later coverage and cannot be promoted as certified 80% intervals or accuracy guarantees.

The selection/evaluation embargo is correct for reference-month order. Ferry uses 18 selection origins with three intervening targets excluded; its last selection target and first evaluation training cutoff are both September 2025. Bus uses 15 selection origins with four intervening targets excluded; both corresponding dates are July 2025. Each later point forecast uses its own earlier prefix. This prevents future evaluation outcomes from selecting the model, but does not reconstruct historical release dates or original vintages. The data was explored and later revised values may have been unavailable at a historical origin. These remain exploratory revised-vintage results with only six overlapping later origins.

Public capture receipts are source/route-pinned, checked for nonnegative integer counts and changing intervals no greater than snapshots minus one, and checked for actual sample times inside the collection window. Accidental position metadata is removed by an allowlist; raw identity fields are rejected. API coverage uses actual first/last sample receipts, rather than collection start/stop clocks. The verified endpoint publishes ten snapshots/four vehicles/nine changing intervals, an explicit stopped-collector qualification, and `replay: null`.

## Verification commands

```text
python scripts/prediction-data.py
python -m unittest discover -s scripts -p test_prediction_data.py -v
node --test scripts/collect-bus-positions.test.mjs
npx vitest run src/lib/server/data/predictionSource.test.ts
npx eslint scripts/collect-bus-positions.mjs scripts/collect-bus-positions.test.mjs src/lib/server/data/predictionSource.ts src/lib/server/data/predictionSource.test.ts src/routes/api/prediction/+server.ts
npm run check
```

The Python preparation requires `requests` and `openpyxl`; its default command writes the source asset, while the six Python regression tests are network-free and do not write it. They cover checked month aliases, shifted month headers, year-anchor/repeated-year drift, swapped category labels, middle-calendar drift through `--audit`, invalid counts and changed quarantine labels. Capture tests cover identity removal/session pseudonym stability, source/schema/coordinate checks, unresolved freshness and bounded conservative sampling. Source tests cover real checked calendar ranges, missing/duplicate periods, invalid counts/units, quarantine handling and nested identity leakage.
