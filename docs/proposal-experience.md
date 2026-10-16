# Building and reviewing a proposal on the map

Open **Map & planning → Create proposal**. The map keeps proposed locations, current access, budget and impact in the same workspace.

Choose **Add an improvement** to work directly on the map, or **Find options within my budget** to set both limits, choose service priorities and review an automatically suggested draft. The manual path shows a compact budget summary; **Edit** or the fixed footer's **Budget** opens its limits. **Proposal details** contains the name, while dated service and model assumptions remain in their own disclosure. Both paths retain the same accepted proposal, budget and Undo history.

## Place an investment

Select **Bus stop**, **School** or **Hospital**, then select its location on the map. Dragging the compact icon from the palette is an optional shortcut. The pointer preview helps position the item before it becomes part of the proposal. The bus-stop distance guide is a distance reference, not a claim that everyone inside it can walk to the stop. After the cost check, a background estimate can show network-based resident access before confirmation. Confirming the same unchanged preview reuses that calculation.

Review the costs and placement explanation in the bubble attached to the proposed location. **Add to proposal** commits the item; **Cancel** or Escape leaves the accepted proposal unchanged. Suitable road snapping and island checks help avoid accidental placement in water, but they do not replace a site survey or permission review.

Bus-stop placement highlights mapped roads. Within 35 m, the preview aligns to the nearest mapped segment and reports the adjustment distance. The hint describes the available map evidence, not approval to build. Unrelated live vehicles and places become quieter while placing an item or editing a route, then return when editing ends.

The budget remains visible while building. A preview shows the effect of the pending item separately from confirmed costs. Capital and annual running budgets are enforced independently. A blocked item explains the shortfall and offers **Adjust budget**; raising a limit still requires a fresh authoritative quote before confirmation.

Its benefit figure uses the relevant unit: residents gaining access, minutes of comparable expected wait saved, new directional island connections or added departures. New services never receive an invented baseline wait. The detailed transport comparison and full review show the underlying route, date and qualifications.

**Bus stop** adds a boarding point. **Bus service** instead selects a named existing route and changes its departure frequency, using the route's captured service date and operating window. Its preview shows the route and the cost of the combined proposal. If the selected date has no published departures, the planner blocks the preview and offers the recorded service date. The selected published direction changes; the reverse direction remains unchanged. Improving frequency does not by itself shorten the walk to a stop.

## Edit without losing your work

Select a proposed marker to **Move**, **Duplicate** or **Remove** it. A move or duplicate is reviewed before it changes the accepted proposal. Canceling a move keeps the original location. **Undo** reverses the last accepted change, including removal. Existing ferry landing places are fixed evidence records; moving them would invent infrastructure, so their ferry package can be removed rather than repositioned.

## Compare the effect

Use **Without proposal** and **With proposal** to compare the same resident analysis. Switching updates the colors on one prepared hexagon grid; it does not resend geometry or request another evaluation. The access selector chooses walking access to public transport, healthcare or education, with the journey target shown alongside it. Green means within that target and red means longer journeys. New placements select **With proposal** and preview valid, affordable changes before acceptance; canceling restores the accepted proposal. While recalculating, the map retains its last result with an updating label.

Unknown or incomplete evidence stays distinct from a measured improvement. Unshaded land has no resident estimate. An unchanged color can be correct: a faster journey may already meet the target, and frequency improvements alone do not shorten the walk to a stop. See the [transport planning guide](map-transport-planning.md#compare-access-on-the-map) for the data boundaries.

After an accepted calculation, cells with changed modeled journey times or access receive a brief color transition and outline. Previewing, changing the comparison view or switching service lenses does not replay that feedback. The map uses one small temporary overlay; it does not rebuild the full analysis on animation frames. Keyboard actions and reduced-motion settings skip decorative motion.

Select a hexagon to inspect current and proposed journey times, modeled residents and an explanation of the local change. During recalculation, the last successful impact remains visible with an explicit previous-result label. A failed request keeps that qualification; opening **Review full impact** retries the calculation. PDF export remains disabled until a current result is available. Finish or cancel any pending placement or service preview before opening the review, so the brief always describes accepted changes. The decision brief includes cost, access results, assumptions and PDF export.

## Connect two islands

Choose **New ferry service**, select its origin and destination, and review existing mapped landing places. Set the proposed frequency, service hours and speed, then preview the outward and return service together. Ferry planning uses existing landing places and does not add a port. Landing permission, service feasibility and sailing suitability still require confirmation. A new line can improve island connectivity without changing walking distance to a terminal; these outcomes are reported separately.

On a phone, **See the full route on the map** opens a compact confirmation with costs and the connection benefit. Timetable evidence can be expanded when needed, keeping room to inspect the path and both landing places before acceptance.

## Verification

Start the application with `npm start`, then run `node scripts/verify-proposal-experience.mjs`. The browser journey uses real local API quotes, source road locations and resident evaluations. Its report and screenshots are saved under `artifacts/qa/proposal-experience/`. Set `BASE_URL` only when the application uses a different local address.
