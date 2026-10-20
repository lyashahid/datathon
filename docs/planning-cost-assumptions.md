# MVR planning costs

Reviewed 20 October 2026. The versioned backend profile is
`backend/app/planning/costs.py`. Baseline responses expose `cost_defaults` and
`cost_basis`; every canonical evaluation includes `economics.cost_basis`, applied
factors and calibration provenance. Proposals and PDF exports disclose the sources.

## Funding envelope

The starting budget is **MVR 50 million capital and MVR 12 million annual operating**,
for a local transport pilot combining a ferry link and bus improvements. This is an
editable planning envelope, not an official government appropriation. It is not
intended to fund a hospital or a complete school campus.

For scale, a ferry operating about 64,000 vessel-km over the default 300 operating
days uses approximately MVR 6.4 million per year, leaving about MVR 5.6 million for
bus services and reserve. Actual routed distance, service calendar, departures, fleet
blocks and reserve share determine the quote. Capital procurement is separate.

Saved drafts containing the previous exact default pair (MVR 150m / 25m) migrate
to this envelope. Other saved budget values, explicit cost overrides and uploaded
calibration are preserved.

## Starting prices

| Input | Default | Scope / evidence |
| --- | ---: | --- |
| New bus stop | MVR 250,000 each | Shelter, seating, signs, lighting and accessible pad; explicit allowance, no isolated local award verified |
| Diesel bus | MVR 3,000,000 each | Procurement allowance; supplier specification and taxes require confirmation |
| Electric bus | MVR 4,500,000 each | Allowance informed by the scale of the World Bank Maldives electrification programme; not an individual invoice |
| Charging installation | MVR 750,000 each | Charger, connection and ordinary civil works allowance; excludes major grid reinforcement |
| Diesel bus operation | MVR 30 / vehicle-km | Local fuel proxy plus staff, maintenance, tyres, insurance and administration allowance |
| Electric bus operation | MVR 25 / vehicle-km | Local commercial base tariff, assumed consumption/charging efficiency, plus non-energy allowance |
| Passenger ferry | MVR 15,000,000 each | Procurement allowance; no comparable current local unit quote verified |
| Ferry operation | MVR 100 / vessel-km | Older local fuel proxy plus explicit crew, maintenance, terminal, insurance and administration allowance |
| Small hospital construction | MVR 120,000,000 | Roughly 30-bed Level 1 scope, informed by 2025 Ministry of Health contracts; not tertiary care |
| Small hospital operation | MVR 20,000,000 / year | Provisional allowance, not an audited facility budget |
| Small school building/extension | MVR 25,000,000 | Historical classroom/staff-room/hall benchmark plus scope and contingency allowance; not a full large campus |
| Small school operation | MVR 5,000,000 / year | Provisional allowance, not an observed school budget |

Annual cash operating allowances exclude purchase/depreciation and financing;
fare revenue is not deducted. Hospital and school prices are fixed facility-scope
allowances, not capacity-scaled estimates. Land, major road/jetty works, dredging,
specialist equipment and unusual site conditions require project-specific estimates.
Historical construction benchmarks are nominal values; no unverified inflation
index or future escalation is applied. Existing emissions factors were not changed.

## Research and calculation basis

- [STO, 5 March 2026 diesel revision](https://sto.mv/newsroom/news/22/fuel-price-revision-march-2026):
  MVR 17.54/litre, the latest official revision located at review. Operator bulk prices may differ.
- [Maldives First Biennial Transparency Report, November 2024](https://unfccc.int/sites/default/files/resource/MDV-BTR%201-Nov2024.pdf):
  Table 28, printed p190, uses 0.42 litres/km for diesel urban buses. Fuel alone is
  MVR 7.37/km; the MVR 30 total includes MVR 22.63/km of explicit non-fuel allowances.
  Table 12, printed p43, uses 39 litres/hour for passenger ferries, inherited from an
  older survey. At an assumed 25 km/h this gives MVR 27.36/km fuel; the remaining
  MVR 72.64/km is a planning allowance. This is not measured current RTL performance.
- [STELCO Greater Malé tariff table](https://stelco.com.mv/tariff-rates):
  large commercial marginal base tariff MVR 6.65/kWh. Assumed 1.2 battery kWh/km
  divided by 90% charging efficiency gives MVR 8.87/km electricity, leaving
  MVR 16.13/km non-energy allowance within MVR 25/km. Lower bands, government
  rates and adjustments can differ. Consumption and efficiency are assumptions.
- [World Bank Maldives CCDR, June 2024, printed p50](https://documents1.worldbank.org/curated/en/099062724090023235/pdf/P18052914ffd310d61afc01156a20523b73.pdf):
  the remaining 53-bus electrification programme gives investment scale, but does
  not isolate bus and charger purchase prices. Confirm procurement scope to avoid double counting.
- [Ministry of Health project register](https://health.gov.mv/storage/uploads/QoQROJwv/vrrrri7d.pdf):
  2025 signed 30-bed contracts include Hanimaadhoo MVR 104.83m, Ihavandhoo
  MVR 114.00m and Milandhoo MVR 110.88m; the rounded construction allowance remains MVR 120m.
- [Ministry of Education Inguraidhoo PSIP contract, 3 January 2022](https://old.moe.gov.mv/en/article/view/781/PSIP-projects):
  MVR 16.96m for four classrooms, a staff room and multipurpose hall. The retained
  MVR 25m allowance is for a small building/extension, not a full Hulhumalé campus.

Manual cost overrides and valid selected calibration records continue to supersede
starting prices. The research defaults remain separately visible for audit. The
backend model-code digest includes this Python profile, so updating its revision,
prices or provenance invalidates persisted computed quotes after process restart.
