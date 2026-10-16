# Nationwide models and source use

The application now uses the existing official island workbooks to supply resident heatmaps for 186 administrative islands beyond Greater Malé, including both S. Hithadhoo and L. Hithadhoo. The project also converts useful published census, school, institutional, financial, transport and planning panels into typed, queryable context. These models preserve the source's geography, reference date, nationality, denominator and missingness.

Resident heatmaps and journey coverage have different limits. The 186 additional islands have resident origins, while the captured evidence currently supports walking nodes on 184, eligible healthcare destinations on 31, education destinations on 45 and mapped transit stops on 41 islands (345 stop records). There are no validated recurring regional transit patterns. Missing roads on Vandhoo (`island:1212`) and Meedhoo (`island:282`) remain unknown. A visible population hexagon is a modeled resident allocation; it does not assert that every journey, entrance or service is known. The combined planning model includes the existing Greater Malé inputs. See the generated coverage receipt at `artifacts/qa/national-model-coverage.json` for the current counts.

## Published models

| Artifact | Usable records and source grain | Principal qualifications |
| --- | --- | --- |
| `island-context.json` | 186 census demographic rows, 1,116 employment rows, 1,674 island-year projections for 2022–2030, 30 indicator definitions | Census is 2022; ages describe resident Maldivians. Employment distinguishes all residents/resident Maldivians and sex. Eight unpublished youth rates remain null. Official projections allocate atoll projections by ratio. |
| `national-population-origins.json` | 186 additional island polygons and conserved 2026/2030 resident allocations | Screened WorldPop weights are normalized to official island totals. Inadequate raster support uses disclosed building/land-area fallbacks. No official neighbourhood census is implied. Non-administrative atoll aggregates are excluded from island allocations. |
| `national-planning-infrastructure.json` | Captured walking graph, accepted facility matches and operator route/stop catalogue | Campus and boarding positions reuse OSM evidence. Unmatched or unsuitable institutions are excluded from destination routing. A route catalogue is not a calendar. |
| `school-context.json` | 6,016 grade/sex observations for 188 school localities; 4,600 typed context cells across 36 tables, pages 10–37 | November 2023, academic 2023/24. 1,137 grade cells stay null; numeric zero stays zero. Hulhumeedhoo remains a combined locality without a forced island key. Five published conflicts are preserved, including Greater Malé totals and Dhaalu subtotals. No campus capacity or residential origin is inferred. |
| `constituency-context.json` | 5,673 published metric cells: population 1,767; employment 1,767; education 2,139 | 93 source rows, 92 distinct names. Repeated Meedhoo rows retain separate source-row identities. All boundaries remain unmatched. 28 blanks stay null; ratio-to-percent conversions are explicit. Existing 17 Greater Malé rows overlap this source. |
| `institution-context.json` | 126 IGMH metric-year cells, 2005–2025 | Institutional annual history. 114 numeric values, 10 blanks, two explicit unavailable values. Beds are not available beds today; no campus allocation or second hospital total is invented. |
| `official-finance-context.json` | 1,156 Special Budget hierarchy nodes; 2,100 terminal-line/year allocations; 192 MTCC segment cells; 17 annual passenger cells; 189 HIES cells | Budget capture is the Special Budget table, not the entire national budget. Actual/revised/approved years remain distinct; hierarchy parents overlap leaves. MTCC is company/segment geography. HIES contains all 63 published indicators for Republic/Malé/Atolls, reference 2019; no island-income inference. |
| `government-health-license-context.json` | All 193 historical government operating-license records, eight PDF pages | Register as at 31 December 2024; 191 registration numbers and 193 license numbers. Four rows with repeated registrations are flagged. No current operation, capacity, coordinate or facility join is asserted. |
| `transport-context.json` | 1,482 monthly cells, all 19 published categories, January 2020–June 2026 | 1,341 reported values; six repeated June bus values are quarantined from usable values. Zones/endpoints and free-of-charge subtotals overlap. No route ridership or unique-person counts are inferred. |
| `hdc-plan-context.json` | 51 values: six phase capacity/area values, 29 land-use shares, 12 housing-type values and four private-lot categories | Official plan updated 27 October 2025, Version 1. Estimated capacity, housing and land-use panels describe planning context. Published capacity total 349,851 differs from phase sum 349,856; both are preserved. No completion, occupancy or resident-count inference. |

All these context tables are available through the generic dataset API and Data Studio. Whole-island official context is also attached to national island profiles. Query and chart guards prevent summed percentages, mixed labour denominators, mixed projection years and overlapping totals where applicable. The original source values and source sheet/cell or PDF page/panel coordinates remain inspectable.

## Existing models remain active

HDC accessibility, pavement, masterplan and tree captures populate the four existing policy spatial layers. Paginated source records without usable geometry stay in the original evidence and are excluded from precise display. Ferry PDFs provide separately dated frequency windows and day types; unpaired operator departure lists do not establish crossing times. MMS CAP messages supply warning validity, severity and polygons. The empty Maavehi capture explains absent road-event coverage and is not evidence of unobstructed roads. EOX metadata supports the optional visual imagery layer and attribution, without automated change detection.

MPL published port tables and CAA/MBS aviation workbooks populate agency context. Companion PDFs preserve their labels and footnotes. FollowMe remains a bounded owner-selected directory/one-shot-position context capture. Electricity tariff bands support delivery references; the inaccessible energy methodology URL is recorded as a failed retrieval, and its qualified historical transcription is not a current electricity-emissions factor. The prediction audit retains publication vintages, source-definition uncertainty, history revisions and the repeated bus-month quarantine.

Healthcare, education and transit desk-review captures support concrete identity decisions, exclusions, coordinate conflicts and operating/timing qualifications. Registry absence or an inaccessible page never establishes closure. Discovery HTML, public-client JavaScript and download catalogues document how the captured statistical tables, route geometry and operator calendars were obtained. They provide acquisition provenance rather than extra measurements.

## Reproduction and retained inputs

`data/public/source-use.json` is the reproducible inventory of each source ID, its distinct capture paths and hashes, and its model, acquisition, definition or audit use. Its builder checks locally available capture hashes, records output hashes and lists any genuinely unused source IDs. Source-list membership alone is insufficient to count as active use. The inventory includes the original primary, policy, operations and agency manifests, delivery references, forecast vintages and the new conversions.

Build the island context from `backend` using the prepared backend environment:

```powershell
.venv/Scripts/python.exe -m app.cli.island_context
```

Run the remaining commands from the repository root:

```powershell
backend/.venv/Scripts/python.exe backend/scripts/prepare_national_origins.py
backend/.venv/Scripts/python.exe backend/scripts/prepare_national_infrastructure.py
backend/.venv/Scripts/python.exe backend/scripts/prepare_school_context.py
backend/.venv/Scripts/python.exe backend/scripts/prepare_constituency_context.py
backend/.venv/Scripts/python.exe backend/scripts/prepare_institution_context.py
backend/.venv/Scripts/python.exe backend/scripts/prepare_finance_context.py
backend/.venv/Scripts/python.exe backend/scripts/prepare_health_license_context.py
backend/.venv/Scripts/python.exe backend/scripts/prepare_transport_context.py
backend/.venv/Scripts/python.exe backend/scripts/prepare_hdc_plan_context.py
backend/.venv/Scripts/python.exe backend/scripts/prepare_source_use.py
```

The island context module also accepts `--root` and `--output` arguments. Rebuild the inventory last, after all other artifacts and manifests are stable, so its output hashes match. No command above reacquires sources from the network.

The original workbooks, PDFs, raw endpoint captures, definitions, methodology documents, catalogue receipts, rejected audit evidence and normalized spatial inputs are retained because they reproduce or explain active models. Many source captures and backend caches are excluded from Git; retain or restore the receipt-matched files before rerunning their converters. Generated public artifacts remain usable without the source archives. Keeping dated provenance is distinct from using it as a current observation.

This work converts the relevant confident quantitative tables and planning panels. It does not claim that every paragraph, photograph, map annotation or legal statement in every source PDF is a structured model. Unsupported joins, current service capacity, recurring regional schedules, verified entrances and precise household locations remain explicit gaps.
