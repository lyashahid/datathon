# Building and reviewing a proposal on the map

Open **Map & planning → Create proposal**. The map keeps proposed locations, current access, budget and impact in the same workspace.

## Place an investment

Select **Bus stop**, **School** or **Hospital**, then select its location on the map. Dragging the compact icon from the palette is an optional shortcut. The pointer preview helps position the item before it becomes part of the proposal. The bus-stop distance guide is a distance reference, not a claim that everyone inside it can walk to the stop. After the cost check, a background estimate can show network-based resident access before confirmation. Confirming the same unchanged preview reuses that calculation.

Review the costs and placement explanation in the bubble attached to the proposed location. **Add to proposal** commits the item; **Cancel** or Escape leaves the accepted proposal unchanged. Suitable road snapping and island checks help avoid accidental placement in water, but they do not replace a site survey or permission review.

The budget remains visible while building. A preview shows the effect of the pending item separately from confirmed costs. Capital and annual running budgets are enforced independently. A blocked item explains the shortfall and offers **Adjust budget**; raising a limit still requires a fresh authoritative quote before confirmation.

**Bus stop** adds a boarding point. **Bus service** instead selects a named existing route and changes its departure frequency, using the route's captured service date and operating window. Its preview shows the route and the cost of the combined proposal. If the selected date has no published departures, the planner blocks the preview and offers the recorded service date. The selected published direction changes; the reverse direction remains unchanged. Improving frequency does not by itself shorten the walk to a stop.

## Edit without losing your work

Select a proposed marker to **Move**, **Duplicate** or **Remove** it. A move or duplicate is reviewed before it changes the accepted proposal. Canceling a move keeps the original location. **Undo** reverses the last accepted change, including removal. Existing ferry landing places are fixed evidence records; moving them would invent infrastructure, so their ferry package can be removed rather than repositioned.

## Compare the effect

Use **Current access**, **With proposal** and **Improvement** to compare the same resident analysis without recalculating it for every view change. The shared hexagon grid keeps the geographic comparison consistent. Unknown or incomplete evidence stays distinct from a measured improvement.

Select a hexagon to inspect current and proposed journey times, modeled residents and an explanation of the local change. The quick figures are estimates while work is calculating; the full review is available after the latest calculation finishes. Finish or cancel any pending placement or service preview before opening the review, so the brief always describes accepted changes. **Review full impact** opens the decision brief, including cost, access results, assumptions and PDF export.

## Connect two islands

Choose **New ferry service**, select its origin and destination, and review existing mapped landing places. Set the proposed frequency, service hours and speed, then preview the outward and return service together. Ferry planning uses existing landing places and does not add a port. Landing permission, service feasibility and sailing suitability still require confirmation. A new line can improve island connectivity without changing walking distance to a terminal; these outcomes are reported separately.

## Verification

Start the application with `npm start`, then run `node scripts/verify-proposal-experience.mjs`. The browser journey uses real local API quotes, source road locations and resident evaluations. Its report and screenshots are saved under `artifacts/qa/proposal-experience/`. Set `BASE_URL` only when the application uses a different local address.
