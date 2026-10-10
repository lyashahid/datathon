# Metric definitions

Every number shown to judges, with the function that computes it, its inputs and assumptions.
All values are **deterministic** and recomputed live; nothing is pre-baked or AI-generated.

**Data status.** Infrastructure positions are approximate demo records (`data/sample/`) and the
population is a **demo** distribution (`h3DemoData.ts`, total ≈204,500). Every panel that shows
these numbers carries a DEMO tag. The official Datathon dataset is not yet integrated.

**Model in one line.** Accessibility is _straight-line proximity_ from each H3 cell (resolution 10,
~0.015 km²) to the nearest facility, decaying linearly between two distance thresholds. It is not
a routed travel time, and the UI says so wherever scores appear.

## Accessibility (per H3 cell)

| Metric                  | Definition                                                                                                                    | Function                                       | Units / rounding |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------- |
| Proximity sub-score     | 100 within `fullScoreWithinM`, 0 beyond `zeroScoreBeyondM`, linear in between                                                 | `proximityScore` (`analysis/accessibility.ts`) | 0–100            |
| Transport accessibility | 0.5 × bus stop (200→800 m) + 0.3 × ferry terminal (400→2000 m) + 0.2 × bus terminal (400→2000 m), same island only            | `calculateTransportAccessibility`              | 0–100, integer   |
| Health accessibility    | Nearest hospital (800→5000 m); other islands via own ferry terminal + 1,600 m crossing allowance + walk from arrival terminal | `calculateHealthAccessibility`                 | 0–100, integer   |
| Education accessibility | Nearest school (400→2500 m), same ferry rule                                                                                  | `calculateEducationAccessibility`              | 0–100, integer   |
| Overall accessibility   | 0.4 × transport + 0.3 × health + 0.3 × education (of the rounded category scores)                                             | `calculateOverallAccessibility`                | 0–100, integer   |

Thresholds and weights live in `config/scoring.ts`.

**Worked example (verified).** Cell `8a6142a8320ffff`, Malé east (the demo's focus area),
493.5 residents:

- Bus stop 806 m → 0; ferry terminal 709 m → (2000−709)/1600 × 100 = 80.7; bus terminal 348 m → 100.
  Transport = 0.5×0 + 0.3×80.7 + 0.2×100 = 44.2 → **44** ✓
- Hospital 1,863 m → (5000−1863)/4200 × 100 = 74.7 → **75** ✓. School 1,155 m → 64.0 → **64** ✓
- Overall = 0.4×44 + 0.3×75 + 0.3×64 = 59.3 → **59** ✓

## Population

| Metric                             | Definition                                                                                                                                       | Function                                      | Units / rounding                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | -------------------------------------------------- |
| Residents (represented population) | Demo population assigned to the cell; age split children 0–14, working age 15–64, older 65+                                                      | `createDemoBaseCells`                         | people; shown ≈ nearest 100 (≥1,000), 10 (≥100), 1 |
| Population density                 | Residents ÷ cell area                                                                                                                            | `buildAccessibilityGrid`                      | residents/km², compact                             |
| **Underserved (weighted)**         | Residents × (60 − overall) / 60 when overall < 60, else 0. A resident at overall 30 counts as **half**. Not a headcount of people without access | `underservedResidents` (`analysis/h3Grid.ts`) | weighted residents, ≈ rounding                     |

Example: 493.5 × (60 − 59)/60 = **8.2** weighted underserved ✓.
Study-area total (baseline): ≈940 weighted, among ≈204,500 residents.

## Scenario impact (before → after)

Computed by `compareGrids` → `summarizeImpact` (`analysis/impact.ts`): the scenario grid is compared
cell by cell with the baseline grid **under the same planning conditions**.

| Metric                                                        | Definition                                                                                            | Units / rounding                       |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Benefiting                                                    | Residents in cells whose overall score **rose by ≥ 2 points** (`IMPACT_CONFIG.changeThresholdPoints`) | people, ≈ rounding; split by age group |
| Losing accessibility / Negatively affected                    | Residents in cells whose overall score **fell by ≥ 2 points**                                         | people, ≈ rounding                     |
| Transport / health / education accessibility (before → after) | **Population-weighted average** of the cell scores                                                    | points, 1 decimal                      |
| Underserved (weighted) before → after                         | Sum of the weighted underserved metric                                                                | weighted residents                     |
| Local scenario impact                                         | Same summary restricted to cells within 800 m of the facility (old and new position if moved)         | as above                               |

Example (demo step 9, top candidate added in Malé east): benefiting **≈18,900**, losing **0**,
average transport **72.0 → 74.6**, weighted underserved **936 → 913**; the focus cell's transport
score rises 44 → 89 and overall 59 → 77.

The ±2-point threshold keeps rounding noise from being reported as change; the Impact map view
shows changes inside ±2 as grey.

## Bus-stop candidates

`recommendBusStops` (`analysis/candidates.ts`), `scoreBusStopCandidate` (`analysis/scoring/busStop.ts`).
Candidates are the cell centroids within 600 m on the same island, excluding duplicates of
existing stops; ranked ones are kept ≥250 m apart.

| Metric                         | Definition                                                                                                                                                                                                                                                    | Units              |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Candidate score                | Σ criterion score × normalised weight, plus penalties (nearby stop, overlap, low population), clamped 0–100. Default weights: underserved reached 0.30, population coverage 0.25, walking improvement 0.20, network suitability 0.15, essential services 0.10 | 0–100, integer     |
| Residents within 300 m         | Residents of cells whose centroid is within the 300 m catchment                                                                                                                                                                                               | people, ≈          |
| Underserved reached (weighted) | Weighted underserved residents in that catchment                                                                                                                                                                                                              | weighted residents |
| Est. transport gain            | Change in the **population-weighted average transport score** over the 600 m search area if a stop were added there, using the same model as the grid                                                                                                         | points             |

Example (top candidate at Malé east): 100×0.25 + 15.7×0.30 + 100×0.20 + 100×0.15 + 20×0.10 = 66.7
→ **67** ✓, no penalties. Wording is "highest scoring candidate under selected assumptions",
never "best location".

## Planning disruption

`config/disruptionScenarios.ts`. Chosen manually; **not a forecast** and not triggered by weather.

| Preset          | Assumptions                                                |
| --------------- | ---------------------------------------------------------- |
| Normal          | Crossing allowance 1,600 m; ferry terminals in service     |
| Moderate marine | Crossing allowance ×2.5 (4,000 m); terminals in service    |
| Severe marine   | No sea crossings; ferry terminals give no transport access |

"Disruption impact" uses the same impact metrics, comparing normal operations with the preset
on the same infrastructure. Example (severe, baseline): **≈202,600** residents lose ≥2 points; average
transport 72.0 → 47.4 (ferry terminals out of service), health 93.8 → 59.8.

## Criticality

`assessCriticality` (`analysis/criticality.ts`): each scored facility is disabled alone and the grid
recomputed.

| Metric                            | Definition                                                     | Units              |
| --------------------------------- | -------------------------------------------------------------- | ------------------ |
| Average loss, whole study area    | Σ (overall-score drop × residents) ÷ all residents             | points, 2 decimals |
| Residents losing access if closed | Residents in cells falling ≥ 2 points                          | people, ≈          |
| Largest local drop                | Biggest single-cell overall drop                               | points             |
| Band                              | Critical ≥3, High ≥1, Moderate ≥0.25, Low <0.25 average points | —                  |
| Closure exposure (map)            | For each cell, the largest drop any single closure would cause | points lost        |

## Facility inspector

| Metric                                              | Definition                                                                                                                                                                                                                 | Notes                                                                                                                  |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Facility score** (formerly "Accessibility score") | Weighted population coverage (10-min walk, full score at 40,000), connectivity (routes and interchanges within 10 min), service access (health and education at the facility's location) minus same-type overlap penalties | A siting score for the facility; **not** the cell accessibility score. Demo coverage uses a uniform per-island density |
| Coverage (5/10/15 min)                              | Demo island density × area of a walking circle (80 m/min, ÷1.3 detour)                                                                                                                                                     | DEMO; straight-line                                                                                                    |
| Walk minutes to nearby services                     | Distance × 1.3 detour ÷ 80 m/min                                                                                                                                                                                           | Estimate, not routed                                                                                                   |

## Other displayed values

| Metric                         | Definition                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Intervention relevance         | 0.6 × severity + 0.4 × population share (capped at 800 residents); bands 60 / 35                                        |
| Community feedback "% support" | support ÷ (support + concern); comments excluded. Shown **beside** the facility score, never combined                   |
| Weather and sea state          | Open-Meteo forecast for Malé, refreshed every 10 min; sea state by Douglas wave-height bands. **Not** used in any score |

## Not claimed

- **Travel-time improvement.** The model does not route; minutes shown are straight-line walking estimates for nearby services only. We do not present travel-time savings.
- **"Accessibility percentage".** Scores are 0–100 indices, not percentages of anything.
- **Absolute "people without access".** Use benefiting/losing (headcounts with a stated threshold) or the weighted underserved metric with its definition.

## Changes made for the presentation

- "Underserved population/residents" relabelled **Underserved (weighted)** everywhere (info view,
  legend, impact panel, comparison, cell inspector, candidate detail, criticality text), with the
  definition in the view description.
- Facility "Accessibility score" relabelled **Facility score** to avoid confusion with cell accessibility.
- Candidate "Expected population served" relabelled **Residents within 300 m**; the gain now states
  its unit (points) and area (600 m search area).
