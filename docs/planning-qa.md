# Independent planning QA

Reviewed 10 October 2026 against `greater-male-2026-10-10-ad35f36a6a` and the service graph model under development. These are observed model and data checks, not a claim that the model is calibrated to measured ridership, congestion, budgets, or mode shift.

## Location audit follow-up

The current audited bundle is `greater-male-2026-10-10-9a4eeb83bc`, with model `service-graph-1.1.0`. Earlier numerical routing results below describe the original bundle, before the operating-status corrections. The source findings and qualifications are in [the map location audit](location-audit.md).

- All 13 healthcare records have dated evidence and operating/scope status. Eight are eligible general-care destinations. European Clinic is closed; three mapped sites are unresolved; Senahiya's broad general-care eligibility remains unresolved. Medica is now classified as a hospital using current primary evidence.
- All 99 RTL stop codes remain in the source inventory at 96 coordinate sites. The default map shows the 61 codes linked to loaded timing; the other 38 require the explicit Evidence checkbox. Co-located direction identities share a dot but stay distinct in routing. Stop 32000 permits alighting and prohibits boarding.
- All 32 education inventory points are inspectable. Colleges, Fiyavathi and Stem Center do not count toward the schools-only goal, leaving 21 eligible mapped school points. Other schools' current operation and admissions remain unaudited.
- Full automated checks passed: 328 tests across 28 files, Svelte diagnostics with zero errors/warnings, lint, production build and public-data validation. Tests cover status/scope exclusions, drop-off restrictions, marker grouping and versioned proposal recovery.
- Edge at 1366 × 768 loaded the audited map and Evidence panel. The optional untimed-stop layer changed the legend to `61 timed + 38 untimed`; a fresh load restored the hidden default. The clinic audit displayed European as `Excluded · closed` with its dated source link. The School goal displayed 21 destinations.
- The previous three-action proposal was archived before current-version autosave. Its recovery control downloaded the original JSON with dataset `greater-male-2026-10-10-ad35f36a6a` and model `service-graph-1.0.0`; the recovery link remained available after reload. Old interventions were not applied to the new data.
- The rebuilt page and planning endpoint returned HTTP 200. A clicked MACL Office stop dot showed its name and partial-timetable qualification. Map screenshots are saved under `artifacts/qa/mobility-location-audit.jpg` and `artifacts/qa/mobility-healthcare-audit.jpg`.
- Isolated ingestion fixtures rejected missing, incomplete, stale and checksum-altered healthcare reviews without replacing the validated bundle. Stop-audit refresh preserved the earlier captured departure snapshot.

This review establishes public-source consistency and exercised software behavior. It does not establish field-verified stop operation, timetable completeness, facility opening calendars, enrollment eligibility or calibrated demand.

## Live editor follow-up

The compact editor replaces the earlier preview/apply workflow described below. The main panel shows people in the selected area, access status, frequency and fleet. Population allocation qualifications remain behind Estimate/Evidence, and journey details, service management and advanced assumptions are collapsed. The four visible result groups retain explicit unknowns and illustrative cost/carbon labels.

- The audited bundle and model pins remain `greater-male-2026-10-10-9a4eeb83bc` and `service-graph-1.1.0`.
- At 1366 × 768 in Edge, a proposed healthcare connection for Hulhumalé · North 02 changed access from 226,176 to 226,254 people within the target, with 25 minutes for the selected journey, MVR 9.7m investment, MVR 3.38m annual operations and +63.5 tonnes CO₂e/year under the current assumptions.
- A native frequency-slider drag from 15 to 10 minutes produced one history action. Its settled results were 226,564 people, a 23-minute selected journey, MVR 12m investment, MVR 5.08m annual operations and +103.8 tonnes CO₂e/year. Undo restored 15 minutes and the original proposal results; redo restored 10 minutes. Switching to electric separately produced MVR 18.8m investment, MVR 4.23m annual operations and +75.9 tonnes CO₂e/year. These increases are displayed honestly.
- Dragging the proposed stop rebuilt both directed street paths. The outbound/return distances changed from 3.259020/3.268612 km to 3.385129/3.394721 km. The drag remained one undoable edit; undo and redo restored the route coordinates, geometry and results, verified in exported version-pinned JSON.
- The browser tests restored the original zero-action proposal after testing. Earlier proposal archives remain available.
- The final 1366 × 768 editor shows the area count, frequency slider, fleet buttons and Add bus action above the fixed footer without scrolling. An active proposed service also keeps both fleet buttons fully visible. Screenshots are saved as `artifacts/qa/mobility-live-edit.jpg` and `artifacts/qa/mobility-live-proposal.jpg`.
- Rapid keyboard frequency edits from 15 to 30 to 1 minute retained the final 1-minute setting and saved both keyboard actions. Undoing those actions and service creation restored the original results and editable empty-service panel, with no permanent building-service message. Dragging then immediately undoing restored the original stop marker. Escape canceled map placement without recording a change; no browser console errors were observed.
- Twenty-three new unit tests cover bounded/coalesced analysis, obsolete requests, graph-based stop relocation, pointer-session behavior and pending-marker invalidation. The complete suite passed 351 tests across 31 files after the undo edge-case repairs. Svelte diagnostics and lint passed with no errors or warnings.

These checks do not establish a 250 ms novel-analysis target or first-minute comprehension by policymakers. The marker follows the pointer immediately; full analysis is asynchronous and shows Updating until current results arrive. The existing timetable coverage and modeled population limitations still apply.

## Spacing and disclosure review

The map, selected area's people/access summary and four policy results remain primary. Suggested areas collapse after selecting an area or entering edit mode. The single investment entry opens the live editor; `Add bus here` and the map's `Place bus` distinguish two placement methods. An existing proposed service no longer repeats its heading or shows another primary Add action.

- Settings opens a focused dialog with Journey, Costs, Carbon and Proposal sections. Journey initially exposes date, departure and access target; walking, transfers, operating assumptions and detailed cost/energy factors remain expandable. Service management opens its own dialog with Services/Stops sections instead of nesting the entire manager inside the decision panel.
- Evidence opens a side sheet with four coverage counts, explicit measured/modeled definitions and expandable audits, demographics, limitations and sources. Searching the source catalog for WorldPop produced one matching source. The decorative island illustration was removed from this data view.
- Edge at 1366 × 768 showed all three comparison choices and action buttons together. Positive annual emissions have an explicit plus sign and amber styling. At 1024 × 768, the header and results aligned without horizontal overflow.
- In the final 1366 × 768 build, the proposed-service editor's content and scroll heights both measured 451 px. The More options control ended at 666 px, above the footer at 701 px; the service selector, frequency slider and fleet buttons needed no scrolling. Screenshots are saved under `artifacts/qa/mobility-spacing-edit.jpg`, `mobility-spacing-comparison.jpg`, `mobility-spacing-mobile.jpg` and `mobility-spacing-brief.jpg`.
- At 390 × 844, header actions wrapped without overlapping results; map view controls used separate rows. Low/central/high cost inputs used full-width labeled rows with enough space to read large MVR values. The document width matched the viewport without horizontal overflow.
- Settings and Evidence focus stayed inside the native modal, including Shift+Tab from the first control and Tab from the final visible control. Escape closed Settings and returned focus to its opener. Hidden content inside closed disclosures was excluded from focus wrapping.
- Services & stops → Stops → Move stop on map closed the modal and focused the map placement target. Escape canceled placement without recording an action. A temporary proposal reset was undone, restoring the original access, journey, cost and carbon results; the existing proposal and earlier archive remained available.
- The brief's Sources and Assumptions disclosures started closed and expanded correctly. Separate print-only content retains every supplied source and assumption even while screen disclosures are closed. The brief uses a completed top-down overview capture and restores the editor camera afterward; emissions increases carry a plus sign and amber color, and costs use neutral text.
- The full suite passed 351 tests across 31 files. Svelte diagnostics reported zero errors/warnings, lint passed and the production build completed. Data/model pins are unchanged by the layout work.

These are developer browser checks, not a five-person policymaker usability study. Actual PDF pagination and a complete accessibility audit remain unverified.

## Original acquired bundle review

- The reviewed bundle contains 667 population origins, 4,359 street graph nodes, 5,743 edges, 45 mapped facility records, 99 operator stops, and 11 scheduled operator directions. Attachment nodes interpolated along existing OSM polylines add no new road connections.
- Summed origin population reconciles to each supplied official island projection: Malé 143,553.81, Vilimalé 7,249.96, and Hulhumalé 95,473.97 for 2026. The maximum observed rounding difference is below 0.000001 resident. This is a spatial allocation of projections, not a neighborhood census.
- Hulhulé's separate 2026/2030 projection is unavailable; the bundle has no invented origin allocation for it. Its zero origin sum is an exclusion from the represented population, not a claim of zero residents.
- All 11 loaded bus calendars are pinned to the retrieval date, 10 October 2026. Their earliest retained departure is 15:20 MVT. An 08:00 result therefore contains walking journeys and an incomplete morning transit baseline. Missing departures do not prove an absence of service.
- Densifying the retained road topology reduced origins unable to connect within the default 100 m limit from 43 to 24, representing about 2,217.83 modeled residents. Another 40 origins, representing Vilimalé's 7,249.96 residents, have incomplete local destination/crossing-service coverage. Total unknown population is 9,467.79. None should be interpreted as a confirmed transport access gap.
- Official name and institution classification matching was reviewed with the ingestion agent. IGMH, ADK, Tree Top, Hulhumalé, and Dharumavantha hospitals have exact or documented-alias official matches and associated source IDs. Medica remains an OSM-only clinic; a substring match does not certify it as a hospital. The military hospital and drug agency remain excluded from general destination routing. “Mapped destinations” is more accurate than describing every facility as officially matched.

## Observed routing checks

Hand fixtures verified published direction, included/excluded calendar dates, and the sum of walking, scheduled wait, ride, and egress. An 08:00 journey start, 08:05 bus departure, 08:15 arrival, and two 10 m walking legs at 80 m/min yield a 15.125-minute total. The access walk takes 0.125 minutes, leaving 4.875 minutes of wait; the egress takes another 0.125 minutes. Reversing the published direction does not invent a return journey.

An intermediate frequency stop correctly uses cumulative segment offsets: with a 07:00–19:00 origin departure window, 20 minutes to the intermediate stop, ten-minute headway, and ten-minute remaining ride, boarding there at 19:02 yields a 15-minute expected journey. The early 06:55 case yields 40 minutes including the service-start wait. These are expected headway waits, not measured reliability percentiles.

The main driving topology links Malé, Hulhulé, and Hulhumalé. Vilimalé has a separate component; no proximity-based ferry or road connection is invented. Walking follows separately permitted topology. Detailed edge geometry is retained in path reconstruction.

With default healthcare assumptions and a 30-minute target:

| Departure | Residents within target | Origins reachable within the model horizon | Origins with unknown coverage | Journeys using transit |
| --------- | ----------------------: | -----------------------------------------: | ----------------------------: | ---------------------: |
| 08:00     |              232,269.48 |                                        603 |                            64 |                      0 |
| 16:00     |              236,388.78 |                                        603 |                            64 |                     65 |

All other origins in this healthcare comparison have unknown status with explicit coverage or attachment explanations. The partial operator snapshot limits conclusions about actual service provision; its gaps do not become confirmed absence of access.

A street-routed feeder for origin `wp:hulhumale:3443:1085`, with 15-minute departures, reduced the modeled selected journey from 31.865 to 19.050 minutes. Both outbound and return road paths were constructed. No observed passenger demand is inferred from that access gain.

With the final journey caches and deferred path geometry enabled, an independent Node run measured fresh 08:00 and 16:00 baseline comparisons at 733 and 604 ms. Previously unseen feeder scenarios took 557 and 593 ms. Repeating the exact preview as a committed scenario took 21 and 36 ms; changing only cost inputs took 24 and 32 ms and preserved the same accessibility summary. Repeated origin results matched exactly. These are calculation timings on this workspace, excluding browser rendering and worker messaging.

## Independent cost and carbon example

This deliberately simple arithmetic fixture has two directions, each 2 km long and eight minutes long, operating 07:00–19:00 every 20 minutes for 300 days. Layover is ten minutes and fleet reserve is 15%.

Each direction runs 36 trips/day. Total annual activity is `2 × 36 × 2 × 300 = 43,200 vehicle-km` and `2 × 36 × 8 / 60 × 300 = 2,880 vehicle-hours`. The assumed circulation cycle is 26 minutes, requiring `ceil(ceil(26 / 20) × 1.15) = 3` buses. Actual dispatch, reserve policy, deadheading, and congestion are not known from this fixture.

Use bus capital of MVR 2 / 2.5 / 3 million per bus, two new stops at MVR 20 / 30 / 40 thousand each, all-inclusive operations of MVR 10 / 15 / 20 per vehicle-km, and emissions of 0.9 / 1.1 / 1.3 kg CO₂e per vehicle-km. The model matches the hand calculations:

| Incremental result                  |       Low |   Central |      High |
| ----------------------------------- | --------: | --------: | --------: |
| One-time capital, MVR               | 6,040,000 | 7,560,000 | 9,080,000 |
| Annual operations, MVR              |   432,000 |   648,000 |   864,000 |
| Annual added emissions, tonnes CO₂e |     38.88 |     47.52 |     56.16 |

With zero displaced travel, net emissions equal added emissions: accessibility improvement alone produces no carbon savings. Energy is already included in the operating rate and is not added again.

Changing that existing service from 20- to 10-minute departures adds 43,200 vehicle-km and one required bus. Incremental capital is MVR 2 / 2.5 / 3 million; incremental operations and emissions equal the last two rows above. The shared cost/emissions anchor is applied to the extra activity. Subtracting independent full-baseline and full-proposal cost ranges would incorrectly suggest possible savings from this known increase.

Changing the fleet or removing a published scheduled service with an incomplete annual dispatch baseline was tested with explicit illustrative price and emissions inputs. Capital, annual operations, and net carbon remain unavailable with explanations. The unchanged baseline reports zero incremental change even when displacement assumptions are positive.

## Original integrated browser checks

Before the live editor changes above, the implementation agent completed these checks in Edge at 1366 × 768:

- Route preview and applied scenario metrics matched exactly.
- Undo and redo restored the corresponding scenario state.
- An unapplied route preview remains intact when frequency or fleet is selected; the interface prompts the user to apply the connection first. Editable service lists contain committed services only.
- A keyboard edit from 100 to 200 assumed displaced private trips/day entered scenario history. Undo restored the visible 100 trips/day, 4 km distance and 1.3 occupancy inputs, matching the annual passenger-kilometre assumptions. Typed-input metadata also passed JSON round-trip and validation tests.
- Changing departure frequency from 15 to 10 minutes changed cost and carbon results. Changing to an electric fleet separately changed the relevant cost and carbon results.
- The production comparison produced three alternatives and applying the first reproduced its access, cost and carbon values. Undo restored the prior proposal.
- The 2030 planning population, school destination goal, and island-level demographic projections loaded without errors. Unavailable cohorts and excluded island projections remained labeled.
- Pausing the proposed service removed its selected journey benefit in preview. Cancel restored the committed service.
- Moving a published stop paused affected timetable patterns pending replacement timing. Missing financial and carbon results link to the relevant reasons, which also appear in the brief; they are not represented as free service or zero emissions.
- The printable brief contained a loaded map image, the selected journey before/after, concrete service details, incremental cost/carbon labels and the relevant source references. Its print control opened the browser print interface; actual rendered pagination was not inspectable through the available browser surface.
- Export produced JSON with dataset/model pins and the expected action. Reload restored the saved proposal. Automated import validation passed; browser file-chooser automation was blocked by the Edge extension's local-file permission, so that interaction is not recorded as passed.
- The planning endpoint returned 200 with a validated snapshot, 304 for its matching ETag, and 409 for a different requested dataset version.

These checks verify the exercised flows; they do not establish calibration or performance on other devices.

## Game-inspired editor and basemap follow-up

Reviewed 10 October 2026 against the current audited dataset and `service-graph-1.1.0`. Interaction references and provider qualifications are documented in [the game interaction review](game-interaction-review.md).

- The map now occupies the full working area. A bottom tray contains Explore, Build bus, Services and Undo/Redo. Area, construction and service controls appear in a dismissible contextual card. At 1366 × 768, the selected-area card measured 279 px high and did not require scrolling. The card says how many people are represented and keeps the estimated allocation identifiable.
- Healthcare/Schools uses Bits UI radios; the advanced route connection uses a Bits UI select with a portaled menu. Arrow-key selection worked. Escape closed the route menu before canceling construction. Direction-specific labels distinguish routes with the same name. Selecting an existing frequency route hides new-service frequency/fleet controls and explains that its settings are inherited.
- Valid road placement displayed a snapped stop and routed connection in preview. The applied access, journey, capital, operating and carbon results exactly matched that preview. Undo restored the previous results. An invalid water placement kept construction active, displayed its reason and recorded no action. Escape canceled the draft.
- Selecting a proposed stop opened its service controls. Dragging it to another eligible road location updated the proposal; Undo restored the prior results. Closing the contextual card returns to Explore. Area suggestions collapse after selection, and are hidden behind the contextual card on narrow layouts.
- Original SVG graphics distinguish schools, hospitals, clinics, ferries, bus vehicles and boarding-stop shelters. Small map variants use stronger outlines; large control illustrations retain restrained depth. The app does not assert that these drawings reproduce local buildings.
- OpenFreeMap Streets loaded street labels and retained the required credits. Keyless EOX satellite loaded Greater Malé imagery, retained the policy overlays, and displayed linked EOX/Copernicus/CC BY-NC-SA attribution with the 2025 mosaic and 10 m detail. No browser console errors were recorded during these basemap checks. Satellite is free for noncommercial use; it is an online raster layer, not an offline or live imagery source.
- Opening the policy brief from Streets switched to the local Atlas, completed its map capture and displayed the existing intervention and qualified cost/carbon results. This keeps briefs independent of remote imagery licenses and tile availability. Actual PDF pagination remains unverified.
- At 390 × 844, document width equaled viewport width. Header actions wrapped, map controls used separate rows, and the selected-area card and bottom tray remained visible without horizontal scrolling. Suggestions start collapsed on narrow screens and use a bounded scroll area when opened. The tray has separate space above the expanded map attribution. Initial camera padding now scales with viewport width, correcting the fixed-padding startup failure found during mobile reload testing.
- A snapped proposal now obtains its island from the actual graph node. Tests cover cross-island clicks, a legacy metadata fallback and explicit offshore bridge nodes. This prevents a selected origin's island from incorrectly being attached to a stop placed elsewhere.
- The final model and UI suite passed 364 tests across 33 files. Svelte diagnostics reported zero errors/warnings, lint passed, and production builds completed. These are developer checks, not the planned five-person policymaker usability study. Novel route analysis still has the previously measured 557–593 ms limitation; immediate pointer feedback is distinct from completed analysis.

## Sea & air context follow-up

Reviewed 10 October 2026 in Edge at 1366 × 768 and 390 × 844.

- The FollowMe directory shows 842 Maldives-wide vessel listings and qualifies the three sampled Greater Malé positions. Searching Galaxy returned two records; only the record with source coordinates offered map focusing. Boat and airport overlay switches left the saved proposal's access, journey, cost and carbon results unchanged.
- MPL's 172 source records retain separate activity labels, readable published dates and expandable quality notes. Records without coordinates offer no map controls. The mobile table remained inside the dialog.
- Airport cards use the four published Table 11.13 annual passenger series. The monthly chart starts with international arrivals; Arrow Down and Enter selected international departures and changed the chart. Series retain their source, units and geographic coverage. Monthly charts exclude annual totals.
- Escape closed the modal and restored focus to Sea & air. On mobile, the dialog remained within the viewport, scrolled internally and kept its tabs and close control available. Document width equaled the 390 px viewport. The added map-control button stays on one line.
- The production context endpoint returned 200 and a matching ETag returned 304. Both data flags were true. The sampled Galaxy Ferry marker was visible after map focusing; its popup showed the published position timestamp, timezone qualification, cached-status explanation and source link. No production browser errors were recorded. Svelte checks reported zero errors/warnings, lint and production build passed.
- Companion checks passed 16 native acquisition tests and nine context unit tests. The full model/UI suite passed 373 tests in 35 files. These source and developer checks do not establish live tracking, passenger demand calibration or permission to redistribute the FollowMe directory.

## Generated artwork and investment-state follow-up

Reviewed 10 October 2026 with the unchanged audited dataset and model. Artwork prompts, packaging and source paths are in [the graphics notes](generated-map-graphics.md).

- Eight transparent illustrations created with built-in image generation now cover bus shelters, hospitals, schools, clinics, buses and ferries, including amber proposed shelter and hospital variants. Runtime WebPs total 426,438 bytes. The map scales facility and investment illustrations by zoom; overview markers stay smaller than close-up editor markers.
- Existing assets remain teal. New proposed stops and placement previews use amber artwork, a dashed ring and a plus badge, with “Proposed · not built” in the contextual card and legend. Existing assets proposed for relocation use a violet arrow; paused existing assets use grayscale and a pause badge. Service availability is separate from construction status.
- The model still proposes bus services and stops only. Baseline healthcare facilities remain existing assets; having amber hospital artwork does not insert a fictional hospital or claim hospital investment benefits.
- At 1366 × 768, adding a temporary stop produced a visibly amber investment marker and the matching status card. Dragging it updated results while retaining proposed status. Undo restored the pre-drag results, then a second Undo restored the original saved proposal (230,523 people within target; MVR 24.5m capital, MVR 6m annual change, +125.8 tonnes CO₂e/year). Temporary QA actions were removed.
- At 390 × 844, the selected proposal card retained its generated art and status label. The expanded investment legend wrapped without horizontal overflow; document width equaled the viewport width. Loaded visible images had no failures.
- Repeated-drag regression tests cover provisional held markers, moved baseline stops, co-located directions, and bus/ferry fallbacks. The final suite passed 381 tests in 35 files; Svelte diagnostics reported zero errors/warnings, lint passed and the production build completed. These checks do not alter the outstanding performance and usability qualifications below.

## Earlier outstanding acceptance checks

- The 250 ms calculation target remains unmet for novel route previews: observed 557–593 ms. Cached commit and finance-only calculations met it at 21–36 ms.
- The planned five-user policymaker usability study has not been run. One-minute comprehension is not yet validated with users.
- Actual printed/PDF output is unverified; one-page fit and readable map/source output must be checked in a rendered print result.
- Full keyboard coverage beyond the exercised range, placement and modal controls, broader mobile coverage, full import/export coverage, reduced motion, and low-end hardware performance are not recorded as passed by this review.

## Policy investment release verification — 11 October 2026

This review uses `greater-male-2026-10-10-5bbad9760b`, `service-graph-1.2.0` and `policy-evidence-a94b8b50aa8979a3`. Earlier results above describe their dated versions; the following supersedes the earlier unverified PDF claim.

- `npm run test -- --reporter=dot`: **506 tests passed in 48 files**. `npm run check`: **zero errors and warnings**. `npm run lint` and `npm run build` passed. The build retains large-chunk warnings for the map/runtime bundle; a successful build does not establish low-end device performance.
- `npm run data:policy-evidence:validate` verified **69 cached originals**. Source/API tests cover variant ETags, invalid snapshots retaining the last validated snapshot, excluded invalid coordinates, missingness and the distinction between summary and geometry responses. The browser loads optional geometry on demand; upstream portals are not required for scenario calculations once the source bundle is loaded.
- The supported initial setting is **10 October 2026, 15:30 Maldives time**. The interface visibly reports **Partial observed snapshot** beside this setting. At 08:00 it reports outside-snapshot coverage, preserving walking results where calculable and unknown transit evidence separately; restoring the supported setting restores results.
- An actual browser-applied paired bus proposal for Hulhumalé North 02 shows **388 additional residents**, **228,763 within target before**, **9,468 unknown**, **MVR 12m central additional capital**, **MVR 5.08m central annual operations** and **+103.8 tonnes CO₂e/year** under the entered assumptions. The selected area represents 6,179 modeled residents and its example journey is 23 minutes: walk, five-minute expected wait, fourteen-minute bus leg and final walk. Applying an alternative, Undo and Redo reproduced the displayed results. Reload restored the saved action and destination criteria.
- A fresh comparison with illustrative high-case limits of **MVR 20m capital / MVR 10m annual operations** returned affordable alternatives with 388, 78 and two additional residents; the two-resident option explains its modest gain. Editing either budget cleared stale alternatives. **MVR 10m / MVR 4m** returned a clear no-affordable-beneficial-option state. Comparison on top of the already applied proposal also correctly has no further affordable option under the default caps. Options are a bounded search, not a certified optimum.
- School mode had one evidenced priority, Vilimalé West 02, rather than filling three cards with zero-gap areas. Required emergency-care metadata and audited wheelchair connectivity produced unknown results and data-collection guidance instead of confirmed gaps or accessibility claims. Required suitability of reachable facilities, explicit calendar expiry, island-specific snapshot windows and missing return activity have regression tests.
- The conditional 2030 housing share changed the modeled gains from 422 to 1,371 in the exercised example and restored to 422 when removed, then to 388 on returning to 2026. Official island totals remain conserved by automated checks. This tests an allocation assumption, not a verified housing completion forecast.
- Optional pavement/tree context layers loaded and left policy results unchanged. The evidence panel distinguishes mapped audit observations from a continuous accessible route. HDC geometry is not treated as audited walking edges or measured shade benefits.
- The map now displays **4,326 shoreline-clipped resolution-11 honeycombs** for the same 667 analytical origins, with access opacity 0.20 and softer outlines. A Chromium-only polygon clipping failure found in live QA was repaired using normalized coordinates and bounded retry; conservation and shoreline tests passed. This adds display detail without claiming additional census precision.
- Edge browser checks used **1366×768** and **390×844**. At 390 px the document width equals the viewport width; results/menu drawers, comparison, evidence and brief scroll inside their containers. The mobile comparison measured 378 px client width and the evidence drawer 380 px. Selecting an area starts with a collapsed sheet; expanding it reveals the journey and actions. Cross-breakpoint camera positioning was corrected after live resize testing found retained desktop focus displacement. Screenshot evidence is stored in `artifacts/qa/policy-investment-e2e.png` and `artifacts/qa/policy-investment-mobile.png`.
- The actual browser **Download PDF** output was copied to `output/pdf/policy-investment-live.pdf` and rendered with Poppler to `artifacts/qa/policy-investment-live.png`. Visual inspection confirmed one readable A4 page without clipped text, with a top-down map, cost ranges, carbon sensitivity, island gains/losses/unknowns, delivery phases, outstanding verification and source/version qualifications. `pypdf` confirmed **one page, five clickable source links**, and the embedded `policy-brief-evidence.json`. It contains 48 brief source entries and the full source provenance. Resident counts are rounded in the printed summary; full-precision values remain in evidence JSON. The app also exports that JSON separately. Native browser print pagination was not independently checked.
- Scenario JSON was actually downloaded and reloaded through local persistence. The exported proposal passes version/action/assumption validation and reproduces the brief in an independent model run. Browser-driven file import was blocked by the Edge extension's **Allow access to file URLs** setting; no permission was changed, and this particular UI import interaction is not recorded as passed. Automated import/pinning checks passed.

### Final model-only profile

`artifacts/qa/final-policy-model-profile.json` and its companion `profile-final-policy-model.mjs` reproduce the actual exported proposal, not a different illustrative origin. On this workspace, a single-process Node run measured baseline initialization at **588 ms**, initialized proposal analysis at **389 ms**, and identical cached repeats at **21–27 ms**, with matching result hashes. The proposal has 388.003 additional residents, 9,467.793 unknown, zero losses/slower journeys, MVR 12m central capital, MVR 5.076m annual operations and +103.759 tonnes CO₂e/year.

An expanded **MVR 30m / MVR 15m** cumulative comparison took **901 ms initially / 135 ms repeated**. The default **MVR 20m / MVR 10m** cumulative comparison took 82–83 ms and returned no option after the cost prescreen; this is not representative of a full search. Selected-origin and budget inputs are absent from the scenario export, so the profiler records its chosen origin and caps explicitly. These timings exclude browser worker transfer, rendering, animation, downloads and network acquisition. Concurrent full-suite timings are slower and are not the controlled benchmark.

### Remaining release acceptance

- The **250 ms target for a novel preview is not met** by the latest 389 ms initialized model run; repeated cached calculations meet it. The committed model calculation is below one second, but end-to-end browser latency and lower-end hardware are not certified by this profile.
- Complete recurring service calendars, verified ferry arrivals/crossing durations, facility suitability/hours, continuous audited walking/boarding connections and calibrated local cost/energy inputs still need agency evidence. The interface retains unknown/conditional results.
- The **five-person policymaker study has not been run**; four-of-five first-minute comprehension cannot be claimed from developer testing. Its protocol is in `docs/policy-investment-release.md`.
- Full keyboard/reduced-motion coverage, additional mobile/tablet devices, actual native print output and the extension-blocked file-import interaction remain unverified beyond the flows stated above.

## Finer and lighter honeycombs — 11 October 2026

- The display uses **28,559 shoreline-clipped resolution-12 cells** over the same 667 analytical origins. Population totals and policy calculations are unchanged; finer drawing geometry does not add census precision.
- Access fills now use **0.15 opacity**, down from 0.20. People fills use lighter 0.08 / 0.20 / 0.32 stops and normalize cell population by average H3 area so a finer grid does not change the density scale. Outlines are thinner and more transparent. The optional detailed grid and recalculation highlights remain separate.
- Fully contained interior cells bypass polygon clipping. Shoreline candidates and their immediate neighbors retain precise clipping; a regression covers a water hole smaller than a hexagon. Focused grid, allocation and wave tests pass, with official totals conserved in 2026 and 2030. Svelte diagnostics report zero errors/warnings; targeted Prettier/ESLint and the production build pass.
- The measured preparation is **1.34 s for geometry + 718 ms for allocation** on this workspace; cached area updates take **5–31 ms**. Wave preparation and triangulation take **174–322 ms**, depending on island. These measurements exclude browser rendering and routing and do not establish the outstanding 250 ms end-to-end preview target.
- Edge checks at **1366×768** and **390×844** confirmed local Access and People shading, visible streets, mobile area selection, and no horizontal overflow. The saved proposal retained +388 residents, MVR 12m capital, MVR 5.08m/year operations and +103.8 t CO₂e/year. No browser errors were captured. Screenshots: `artifacts/qa/hexagons-refined.png` and `artifacts/qa/hexagons-refined-mobile.png`.

## Journey-time colors and adjustable opacity — 11 October 2026

- Access colors now represent the selected destination's modeled journey: **≤5, 5–10, 10–15, 15–30 and over 30 minutes**. The values include the model's walking, waiting and riding time. Incomplete inputs stay gray, no-route results remain separate, and cells with several resident time bands are labeled mixed. Changing the policy access target does not change these fixed time bands. The finer display still uses the same 667 modeled population origins; it does not add neighborhood observations or new routing precision.
- Hexagon fills render beneath roads and building footprints. Dense default cell outlines are hidden; the detailed analytical grid and recalculation wave remain separate controls. Empty cells remain transparent.
- **Hexagon opacity** is a live 0–100% slider in desktop Map appearance and the mobile Map options drawer. The default is 12%; 0 hides all People, Access and Impact fills. Access uses the selected opacity uniformly. People uses it as the density scale's maximum; Impact keeps already-reached areas fainter than changed areas. Appearance updates change paint only, without re-uploading the area geometry or recalculating policy results.
- The browser remembers opacity independently of the scenario. Stored values are checked and clamped, blocked storage does not disable the slider, and Reset to default restores 12%. The appearance menu now opens above the selected-area panel.
- In-app browser checks at **1366×768** and **390×844** exercised live adjustment, zero-opacity Access and People views, the mobile slider and Arrow Right increment, persistence after reload (13%), Reset (12%), and school/healthcare time legends. Switching to schools completed with 244,000 residents within target and 2,218 unknown; opacity changes left the policy results unchanged. No browser errors were captured in the final preview. Screenshots include `artifacts/qa/travel-time-opacity.png`, `artifacts/qa/hexagon-opacity-mobile.png` and the zero-opacity comparison captures.
- **73 focused tests across six files passed**, covering grid allocation, time thresholds, missing/unreachable journeys, mixed-band conservation and recalculation waves. Svelte diagnostics reported zero errors/warnings; targeted ESLint, Prettier and the production build passed. These checks do not resolve the outstanding calibration, performance or policymaker usability qualifications above.
