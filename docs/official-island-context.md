# Official island context

The application consumes `data/public/island-context.json`, generated from the
captured Maldives Bureau of Statistics workbooks. All 186 administrative islands
have Census 2022 demographics, labour indicators, and annual 2022–2030 population
projections. This includes both S. Hithadhoo and L. Hithadhoo, joined by atoll and
island identity rather than name alone.

The API exposes this context as `official_island_context` on
`GET /api/v1/islands/{id}/profile`. The analytics catalogue exposes
`island-census-demographics`, `island-employment-indicators`,
`island-population-projections`, and `island-indicator-definitions` through the
existing dataset query/chart/export endpoints.

## Sources and meaning

| Captured input | Application use | Grain and limits |
| --- | --- | --- |
| `data/raw/census2022-population.xlsx` | Demographic context for 186 islands | Census 2022 resident totals by nationality and sex; age cohort counts, dependency and growth describe resident Maldivians only. Cohorts overlap. Includes 2014 Maldivian counts, land area, density and median ages. |
| `data/raw/census2022-employment.xlsx` | Labour context for 186 islands | Nine published percentage measures by residents or resident Maldivians and both/female/male. Eight empty Rakeedhoo youth rate cells remain null. Percentages do not provide commuter counts or labour denominators. |
| `data/raw/island-projections2022-2030.xlsx` | Annual island population model context | 186 islands × 9 years; resident, Maldivian and foreign population by sex. MBS uses ratios to allocate atoll projections among islands. There is no projected island age distribution. Projected 2022 values are not census counts. |
| `data/raw/population-definitions.xlsx` | Searchable metric definitions | Preserves official resident, geography and demographic definitions. |
| `data/raw/employment-definitions.xlsx` | Searchable metric definitions | Preserves denominators and ages; labour working age is 15+, while the demographic age cohort is 15–64. |

Original download URLs, captured dates, licenses, file paths and SHA-256 receipts
are included in the artifact. Every data row retains source sheet and Excel row.
The island identity input has its own receipt. Official source portals:
[Census island indicator sheets](https://statisticsmaldives.gov.mv/census-2022-island-and-atoll-level-indicator-sheets/)
and [population projections](https://statisticsmaldives.gov.mv/maldives-population-projection-2022-2062/).

Employment/projection spellings `L Mundhoo` and `GDh Madeveli` are mapped to
`L Mundoo` and `GDh Madaveli` using their same-atoll population-indicator
counterparts. Both source names and the reviewed mapping basis remain in rows.
Unmatched or duplicate island identities and changed workbook headers fail the
build rather than silently dropping islands. Captured-manifest checksums are
verified before parsing.

This context is whole-island evidence. It is not used to invent age groups at
individual buildings or hexagons. Malé city, resort and industrial populations
are outside these 186 indicator rows; absence means unknown, not zero. The
existing census P3/P5 summaries remain separately available for Malé wards and
other existing census context.

## Rebuild and verification

From `backend`, run:

```powershell
.\.venv\Scripts\python.exe -m app.cli.island_context
.\.venv\Scripts\python.exe -m pytest tests/test_island_context.py -q
```

The build reads source files without changing them and writes only the portable
public JSON. Applications do not require original XLSX files at runtime. Retain
the raw originals and source manifest for reproducibility; they are active
pipeline evidence, not unusable data. Generated records are checked against
236,911 census residents and 205,312 resident Maldivians across the 186 islands,
complete year coverage, nationality consistency and original-workbook rebuilds.
The generic chart API rejects sums of labour rates, mixed labour scopes without
filters/grouping, and projected population sums across ungrouped years.
