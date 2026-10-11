# Responsive layout review

Reviewed 10 October 2026 in Edge using the local production preview.

## Layout changes

- Phones use a map-first, full-viewport layout: a compact header, four result summaries, and a bottom toolbar for Explore, Build bus and Services. The page itself does not scroll at phone widths.
- Selecting an area or service opens a nonmodal bottom sheet. Tap its header or swipe it vertically to expand/collapse details; collapsing preserves the selection and form values. Starting placement collapses the sheet to leave the map available. Short phone landscape puts the sheet on the right.
- Suggested areas, map layers, full results and the menu open as bottom drawers. Drawer headings and close controls remain available while their contents scroll. Detailed settings, evidence, comparison and proposal management stay one step away from the map.
- Dialogs fit the viewport. Settings fields and investment comparisons stack when needed, long labels wrap, and evidence tables scroll within their own keyboard-focusable regions.
- Sea & air keeps its heading, tabs and close control available while the directory scrolls. Narrow layouts use smaller illustrations, stacked statistics and boat actions, with confined port-call and monthly-value tables.
- The policy brief uses labelled current/proposal values on phones instead of compressed three-column rows. Its print and close controls wrap on small screens; screen-specific styles retain the existing print layout.
- Frequently used modal controls have 44 px touch targets. Search text uses 16 px to avoid automatic input zoom on mobile browsers.
- The map resizes with its container. Its overview and selected-location framing account for the actual sheet height. Mobile zoom buttons sit above the bottom toolbar and hide when details expand; attribution remains visible. Rapid expansion during the selection camera animation preserves the intended zoom.

## Browser coverage

| Emulated viewport | Layout checked        |
| ----------------- | --------------------- |
| 320 × 568         | Small phone           |
| 390 × 844         | Phone                 |
| 640 × 360         | Phone landscape       |
| 768 × 1024        | Portrait tablet       |
| 844 × 390         | Short landscape       |
| 1024 × 768        | Tablet / small laptop |
| 1366 × 768        | Laptop                |

The latest mobile drawer review exercised 320 × 568, 390 × 844 and 640 × 360, with tablet and laptop regression checks at 768 × 1024 and 1366 × 768. It covered area selection, header swipe, collapse/reopen, Escape, focus restoration, placement/cancel, rapid selection/expansion, layers, results, menu and settings. The preceding responsive pass covered the remaining viewport sizes and the following dialogs:

- **Services:** service and stop tabs.
- **Settings:** journey, expanded costs, carbon and proposal controls.
- **Evidence:** population table.
- **Compare:** calculated alternatives.
- **Sea & air:** boats, port calls and airport views.
- **Policy brief:** comparison, map and disclosure layout.

No horizontal document or control overflow was observed in the exercised flows. Wide tables remained confined to their own scrolling regions. Scenario actions were not added: the saved proposal still reports 230,523 residents within target (+4,347), MVR 24.5m additional capital, MVR 6m annual cost change and +125.8 tonnes CO₂e/year. Undo and Redo remain disabled.

## Developer checks and limits

The mobile drawer update passed Svelte diagnostics with zero errors and warnings, full-project lint, 18 focused editing tests across two files, and a production build. The preceding responsive pass also passed all 381 tests across 35 files. The existing bundle-size advisory remains.

Phone visual checks confirmed that the expanded sheet scrolls internally and leaves map controls and attribution visible. In short landscape, it stays below the result strip and beside the attribution. The desktop layout retains its full result cards and contextual side panel.

Saved previews: [phone selection sheet](../artifacts/qa/mobile-drawer-area-390.png), [map drawer](../artifacts/qa/mobile-drawer-layers-390.png), [phone landscape](../artifacts/qa/mobile-drawer-landscape-640.png), and [laptop regression](../artifacts/qa/mobile-drawer-desktop-regression-1366.png).

This is emulated viewport QA in Edge, not physical-device, Safari or policymaker user testing. Actual PDF pagination has not been newly validated. The model calibration, performance and usability qualifications in [planning QA](planning-qa.md) still apply.
