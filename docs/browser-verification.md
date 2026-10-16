# Current browser verification

This is the maintained guide for the current interface. Earlier design and migration documents retain historical results; their counts and screenshots describe the application at that time.

Install dependencies with `npm ci` and `npm run setup`, then install Chromium once with `npx playwright install chromium`. Start both services with `npm start`. In another terminal:

```powershell
npm run test:browser
npm run test:browser:list
```

The default command runs the 13 core suites sequentially: analytics, decision priorities, forecasts/Data Studio, capital entry, navigation, nearby bus stops, nearby access analysis, map controls, proposal experience, map comparisons, motion/windows, proposal review and island connections. The suite catalogue in `scripts/browser-suites.mjs` is the source of truth. Listing suites does not need a running application.

Select focused suites by their listed IDs. Repeated IDs run once, in the requested order. Unknown IDs fail before launching Chromium:

```powershell
npm run test:browser -- overlays map-legibility
npm run test:browser -- planning delivery timetables
npm run test:browser:all
```

`test:browser:all` includes every browser suite, including the provider-dependent and advanced workbenches, and takes substantially longer than the core journey. It excludes the separate direct API harness. Do not run multiple map suites concurrently: Chromium rendering and shared planning caches compete for resources.

Focused coverage includes:

- Scores and geography: `accessibility`, `country`, `map`, `map-focus`.
- Movement and map interpretation: `map-legibility`, `bus-vehicles`, `overlays`, `map-audit`.
- Places, directions and external conditions: `places`, `conditions`.
- Advanced planning and delivery: `planning`, `delivery`, `timetables`.
- Proposal creation and service benefits: `unified-policy`, `policy-drag`, `map-transport`, `transport-impact`.
- Delayed or failed requests and retained drafts: `resilience`.

Existing `test:browser:*` commands remain shortcuts for the corresponding catalogue IDs. `test:browser:places` and `test:browser:map-first-places` are compatibility aliases for the same `places` suite.

## URLs and evidence

Every browser harness defaults to `http://127.0.0.1:5173`, matching `npm start`. `MOBILITY_QA_URL` overrides that frontend address consistently; `BASE_URL` remains a legacy fallback. The direct API check, `npm run test:policy-api`, instead uses `MOBILITY_API_QA_URL` and defaults to port 8000.

For an already running production preview on another port, with FastAPI still available:

```powershell
$env:MOBILITY_QA_URL = 'http://127.0.0.1:5180'
npm run test:browser -- map-comparison overlays
Remove-Item Env:MOBILITY_QA_URL
```

Suites save their own JSON report, screenshots and relevant exports under `artifacts/qa`; the command output identifies the exact report. Check the exit status and failure details as well as the number of checks. Failed runs can leave older screenshots beside a new report. Reports are local verification evidence, not deployment benchmarks or guarantees of external provider availability.

Each browser context has disposable storage. Core journeys use real backend calculations and source geometry. Controlled movement fixtures and delayed/failed response regressions are qualified in their suite reports; they do not establish live provider coverage. The timetable suite runs against an isolated backend copy and checks that source-store hashes remain unchanged. Advanced planning checks exercise ingestion and service workbenches; run those against a local or disposable test instance.

## Consolidated coverage

The retired `verify-continuous-hex-map.mjs` was a before/after design-pass capture with obsolete controls. Its geometry, population conservation, holes, shared borders and cache checks remain in `backend/tests/test_display_grid.py`; aggregation and unknown evidence remain in `src/lib/display-grid.test.ts`. The maintained `map-comparison` suite checks actual local impact and rendered colours, while `overlays` checks shared hex IDs, keyboard opacity, persistence, unchanged camera and absence of recalculation on desktop and mobile. Historical continuous-mesh receipts remain historical evidence.

Shared browser helpers now resolve the frontend URL and project map gestures through the displayed camera, including panel padding. The runner's command selection, typo handling and URL compatibility are covered by `npm run test:startup`. Individual behavioral suites remain separate where they cover distinct import, failure, routing, drag, budget or service-impact regressions.
