# Delivery calibration and fleet resources

The planning workbench's **Timetables & delivery** step now keeps source-linked local cost and energy evidence with a proposal. It also screens the actual generated vehicle blocks against declared fleet, passenger capacity, duty, depot and charging resources. Collaboration/authenticated projects are intentionally excluded following the user's instruction.

| Before | After | Why |
| --- | --- | --- |
| Cost inputs were isolated numbers | A local evidence register records source URL, publisher, geography, units, publication and validity dates, inclusions and evidence type | A reviewer can inspect the origin and scope of each selected value |
| Fleet numbers had no declared resource envelope | Every route and propulsion group can have vehicle availability, onboard capacity, peak demand, duty and depot inputs | An affordable timetable can still fail operating constraints |
| Electric emissions used a single illustrative per-km factor | Complete energy inputs derive a factor from consumption, charging efficiency and grid carbon intensity | Local energy assumptions remain inspectable and adjustable |
| Monthly tariff bands could be mistaken for one flat price | A progressive 30-day bill calculator compares the existing account with additional charging consumption | The extra base charge includes the bands actually crossed |

## Source evidence

The [STELCO tariff page](https://stelco.com.mv/tariff-rates) was captured on 14 October 2026 with a raw SHA-256 receipt. The calculator includes the published Malé-region commercial and government/institutes categories. It applies each tier to its incremental consumption, and returns a base-charge difference for one 30-day billing account. Fuel adjustment remains unknown unless explicitly entered; taxes, subsidies and other account charges are excluded. No annual charging bill or tariff effective date is inferred.

The Ministry's [mitigation estimation methodology](https://www.environment.gov.mv/v2/wp-content/files/publications/20251002-pub-methodology-report-for-estimation-of-mitigation-actions.pdf), dated July 2025, provides a historical STELCO 2022 generation CO₂ example. Its indexed primary text was inspected, but the original download currently redirects to a missing URL. This is recorded as an indexed reference without a raw document hash. The historical value is **not** automatically applied as a current delivered-grid CO₂e factor. The published ratio labels contain an inversion; the separate arithmetic check divides emissions by electricity generation. Non-CO₂ gases and distribution losses remain outside that example.

Source metadata and captured tariff HTML are under `data/public/delivery-evidence`. The refresh script verifies known reference values and records retrieval failures explicitly. Hospital/school quotations and local bus measurements have not been invented.

## Register and calculations

`GET /api/v1/planning/calibration` returns factor units and reference information. `POST /api/v1/planning/calibration/validate` validates up to 100 uploaded records and returns deterministic record hashes. Validation checks units, nonnegative finite values, URL type, source fields and ordered validity dates. A source hash entered by a user is a claim, not independently certified document retrieval.

Records are explicitly selected in `assumptions.calibration_selection`, with their complete evidence stored in `calibration_records`. A selected record must match its factor, publication date and selected service-date validity. Currency conversion is never inferred. Manual `cost_overrides` and `energy_overrides` take precedence and appear as manual inputs in the factor provenance.

Electric operating emissions use battery kWh/km ÷ charging efficiency × grid kgCO₂e/kWh. Electric operating cost additionally needs a tariff and separately supplied non-energy MVR/km. Diesel factors use litres/km multiplied by fuel price or the carbon factor, with non-energy operating cost added separately. Derivation requires every input. Missing inputs retain the explicit per-km illustration, rather than inventing a measurement or treating missing energy as zero.

The workbench preserves the register, selections, energy and resource inputs in its scoped browser draft and full proposal JSON export. Existing drafts without these fields remain readable. Record revisions use new IDs. **Unapply** retains an evidence record while clearing its selection, allowing a different service date or fallback without deleting the document. Clearing a manual per-km entry restores its selected evidence or default. Exported evaluation JSON contains applied record receipts and formula inputs.

## Resource screens

Each resource envelope addresses one `activity_id` of the form `route ID|mode|propulsion`. The generated chronological blocks are the inputs to the checks:

- Available vehicles must cover the modeled procurement fleet including reserve.
- Peak onboard passengers on one departure must fit the declared vehicle capacity. Monthly series and resident accessibility totals are not converted into route-level peak demand.
- Maximum vehicle duty uses the first departure to last layover, including waiting gaps. It is not a driver shift or crew-rest certificate.
- First and last terminals must be within 100 m of a declared depot. No deadhead distance, time or energy is invented. Proposed depot stops absent from the source baseline fail its positioning screen while remaining assessable in the proposal.
- Electric battery range must cover each block's full service-day distance with a protected reserve. Vehicles start fully charged; daytime charging and replacement vehicles are not inferred.
- Overnight energy must fit the dedicated charger pool and each vehicle's window before the next repeated service day. A route ending outside its declared depot receives no assumed depot-charging time.

These are **necessary feasibility screens**, not a vehicle or charging optimizer. Passing them does not establish a shared-depot plug schedule, tapering profile, crew roster, grid reliability or recurring across-day vehicle positioning. Unknown inputs produce an incomplete status. Explicitly declared charger counts are included in charging capital at the per-item rate; one illustrative charging unit is costed when no count is supplied. Vehicle purchase/ownership and spare availability are separate planning assumptions, not an asset disposal or idle-fleet allocation model. Route-specific resource energy and costing energy are separately entered; mismatches are reported in financial warnings.

## Verification

The 23 added backend tests exercise real failure conditions, source/date/unit validation, override precedence, energy formulas, fleet-distance conservation, missing distances, depot errors, late duties and progressive tariff boundaries. Together with the existing 27 planning tests, all 50 passed. Svelte check reports zero errors and warnings, and targeted frontend/backend lint passes.

`node scripts/verify-delivery-browser.mjs` passed five workflow checks on the live frontend/backend. It verifies source qualification, progressive tariff calculations and stale guards, evidence entry/apply/unapply, complete energy formulas, register export, real failed resource constraints, draft reload, and full proposal export/import into a fresh browser context. The 1440 px desktop and 390 px mobile layouts have no horizontal overflow or browser runtime errors; viewport captures were inspected for readable controls and constraint explanations. Inspect `artifacts/qa/delivery/report.json`, `delivery-desktop-viewport.png`, `delivery-mobile-viewport.png` and `delivery-mobile-constraints.png` for the evidence. QA measurements and quotations are explicitly synthetic test inputs, held only in isolated browser contexts and QA artifacts.
