# Browser verification

Install dependencies with `npm ci` and `npm run setup`, install Chromium once with `npx playwright install chromium`, then start both services with `npm start`.

```powershell
npm run test:browser
npm run test:browser:list
npm run test:browser -- directions sea-network
```

The default runs six current journeys sequentially:

| Suite                 | Purpose                                                                                        |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| `analytics`           | Dashboard charts, filters, exports and responsive layout                                       |
| `navigation`          | Workspace links, country drill-down and return to island planning                              |
| `search`              | Inline scoped place search, English aliases, keyboard selection and provider recovery          |
| `directions`          | Integrated multistop routes, modes, dated transfers and map endpoints                          |
| `proposal-experience` | Explicit placement, budgets, native drag, undo and bus/ferry editors                           |
| `sea-network`         | Sea/air networks, line-only toggles, retained vehicle inspection, caching and pressure colours |

Run only the suites affected by a change. `scripts/browser-suites.mjs` is the catalogue; `--list` works without starting the application. Repeated IDs run once in the requested order. Unknown or retired IDs fail before launching Chromium. The former per-suite npm aliases have been removed; use `npm run test:browser -- <suite IDs>`.

Specialist regressions remain available on demand:

- Analytics and evidence: `decisions`, `forecasts`, `accessibility`, `resilience`.
- Map scope and evidence: `capital`, `country`, `map`, `nearby-stops`, `nearby-access`, `map-controls`.
- Rendering and interaction: `map-legibility`, `bus-vehicles`, `map-audit`, `overlays`, `motion`.
- Proposal impact and review: `map-comparison`, `map-transport`, `transport-impact`, `review-window`.
- Specialist workbenches: `planning`, `delivery`, `timetables`, `conditions`.

`npm run test:browser:all` runs all maintained browser suites, including provider-dependent checks and the isolated timetable import. Reserve it for a broad release check. Do not run map suites concurrently: Chromium rendering and shared planning caches compete for resources. The direct API contract check remains separate as `npm run test:policy-api`.

## URLs and evidence

Browser harnesses default to `http://127.0.0.1:5173`. Set `MOBILITY_QA_URL` to use another frontend; `BASE_URL` remains a legacy fallback. The API check uses `MOBILITY_API_QA_URL`, defaulting to port 8000.

```powershell
$env:MOBILITY_QA_URL = 'http://127.0.0.1:5180'
npm run test:browser -- map-comparison overlays
Remove-Item Env:MOBILITY_QA_URL
```

Suites write reports, screenshots and exports under `artifacts/qa`. Read the exit status and report failures; older screenshots may remain after a failed run. Browser storage is disposable. Source-backed journeys use the real backend; synthetic movement fixtures and delayed/failed responses are identified in their reports. The timetable suite uses an isolated backend copy and checks that the main source stores remain unchanged.

## Maintenance

The catalogue, file existence and unique suite selection are checked by `npm run test:startup`; this does not launch Chromium. Keep a regression in one focused suite rather than adding another complete navigation-to-proposal journey.

Retired harnesses targeted the removed standalone Places and journey-connections panels, old native placement confirmations, or an earlier omnibus proposal interface. Current scoped search, directions, proposal experience and map comparison suites own those active workflows. Obsolete embedded-weather, legacy endpoint and Places-inspector checks were removed from otherwise useful suites; weather and traffic still have the separate `conditions` suite. Historical reports remain historical evidence.

Ordinary map clicks must not offer proposal creation. After changing click handling, spot-check a blank Explore click and mapped-feature inspection, then explicit **Create proposal → Hospital → Add to proposal**, another blank click after closing, and endpoint actions with Directions open. This focused manual check was used for the passive-click fix; it is not an additional browser suite.
