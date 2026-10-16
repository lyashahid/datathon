# Mobility Sandbox MV

A SvelteKit policy workspace using the supplied Python FastAPI backend, extended with passenger forecasts, scheduled journeys, resident accessibility, investment planning, live environmental conditions, reviewed notices, a multi-dataset studio, and the complete Vela REST API.

All calculation and inventory requests go through the same-origin `/api/backend/*` proxy to FastAPI. No old Svelte planning engine or snapshot fallback is used. The atlas renders the supplied island and facility geometry without requiring an online basemap.

## Clone and run

Install [Node.js 24](https://nodejs.org/en/download) and [uv](https://docs.astral.sh/uv/getting-started/installation/) once. Git is needed to clone. Python is installed automatically by uv; no separate Python setup is required.

```sh
git clone https://github.com/lyashahid/datathon.git
cd datathon
npm ci
npm start
```

**No environment variables, `.env` file, API key, database server or data-acquisition step is required.** Safe local defaults and the planning/analytics snapshots are included in Git. First startup downloads the locked Python dependencies and Chromium for the Vela review collector; allow internet access for those downloads.

Open http://localhost:5173. `npm start` prepares FastAPI on http://127.0.0.1:8000 and serves an optimized Node frontend. The first start builds it; later starts reuse the build until source, dependencies or build settings change. `npm run dev` starts both services with Vite hot reload for editing. Both launchers can reuse a healthy Mobility Sandbox API. Stop services started by the launcher with Ctrl+C.

Analytics and supported island planning calculations warm automatically in the background. The app serves requests without waiting for that work: country snapshots warm first, followed by the heavier analytics and planning views. Saved memory, local-disk and optional PostgreSQL results are reused. Just use `npm start`; no separate precompute command is required. See [automatic background preparation](docs/performance.md#automatic-background-preparation) for coverage and maintenance options.

On a minimal Linux installation, Chromium may also need operating-system libraries. Install them once with `npm run setup -- --with-system-deps` (the package manager may ask for sudo). See [Playwright's system-dependency documentation](https://playwright.dev/python/docs/browsers#install-system-dependencies).

See [the complete setup, configuration and troubleshooting guide](docs/clone-and-run.md) for Windows/macOS/Linux prerequisites, first-start behavior, optional overrides, data coverage, tests and production-preview commands.

For **https://yoosufsayyid.com/apps/datathon**, see the [Docker deployment and GitHub Actions guide](docs/deployment.md). Production uses packaged snapshots and local caches, with no PostgreSQL connection or automatic migrations. The dedicated deploy key can update only this app through a fixed server helper.

For separate terminals:

```sh
npm run setup
npm run dev:backend
# In a second terminal:
npm run dev:frontend -- --host 127.0.0.1
```

API documentation: http://127.0.0.1:8000/docs. The imported cache is included under `backend/data/cache/{normalized,graphs,derived}` and requires no acquisition step. Source originals are retained locally in the ignored `backend/data/cache/raw` folder. Avoid rerunning acquisition just to start the app.

The committed [.env.example](.env.example) and [backend/.env.example](backend/.env.example) document **optional overrides only**. Credentials belong in ignored local files; they are unnecessary for the default local workflow. `MOBILITY_BACKEND_URL` and `VELA_API_KEY` stay server-side. Backend settings and their precedence are documented in [backend/README.md](backend/README.md). Live weather, traffic, ships, aircraft and provider search require internet access and depend on upstream coverage; empty or unavailable feeds are shown explicitly. RTL live bus positions remain disabled by default.

## What changed

- **Workspace navigation** keeps the same three dynamic island tabs everywhere: Analytics, Map & planning, and Evidence. On the map, the navigation floats directly over the full-screen map without a header bar. Directions, weather and proposal actions stay in the map tools.
- **Motion and window sizing** adds a sliding navigation bubble, shared tab indicators and brief panel transitions while keeping the map and drafts mounted. Desktop map panels, island-score drawers and the impact review have edge/corner resize grips; their sizes are remembered separately in this browser and constrained to the screen. Arrow keys resize a focused grip, Shift makes larger adjustments, Escape cancels a drag, and Home or double-click restores the default size. The impact review also has maximize/restore controls. Small screens use the responsive layout without resize grips; reduced-motion preferences are respected.
- **Decision-focused polish** starts analytics with three service-specific investigation cards that carry their island and service into the map. Proposal entry separates **Add an improvement** from **Find options within my budget**, with budget editing and advanced assumptions revealed when needed. The budget headline reflects resident gains, comparable wait savings or new island directions. Mapped road hints explain snapping, unrelated markers dim while editing, and only changed cells receive brief feedback after an accepted calculation. Refreshing retains the last result with an explicit updating/previous-calculation label. Numeric feedback shows the real result immediately and respects keyboard input and reduced motion.
- **Home** opens Analytics. **Map & planning** focuses on Hulhumalé with service coverage, directions, live movement and proposal tools ready to use. Malé, Hulhumalé and Hulhulé load as one capital area: detailed map evidence and planning baselines prepare together, and neighbouring access shading stays visible while comparing a proposal. Hulhulé has no separate resident projection, so its transport evidence does not invent a resident heatmap. Bus stops remain visible when panning between these islands. Select Malé or another island to inspect it; direct island links retain their own selection. **Create a proposal** stays on the map. The globe opens the optional Maldives overview, whose country access index is the unweighted mean of available backend scores for residential islands: currently **13.2/100 across 189 islands**. **Find out why** reveals health, education and transport scores, evidence coverage and an atoll list. Grey score markers identify limited evidence. A low index can reflect missing mapping; it is not a percentage of residents served. Run `npm run test:browser:capital`, `npm run test:browser:country` and `npm run test:browser:navigation` against the running app to verify these journeys and the mobile layout.
- **Analytics** opens with an interactive atoll comparison, facility-mix donut, coordinate-coverage gauge, accessibility distribution and published passenger-history chart. Cohort and atoll filters update the service views; the passenger chart covers its own published routes, with three source series, 12-month/all-history ranges and prior-year comparison. Transport, health and education screening cards lead into investigation queues, and Inspect on map carries the island and service lens into the shared map. Island records, scoped CSV exports and source methodology remain expandable. Passenger outlook compares nine statistical/baseline methods and a selection-weighted ensemble, with separate chronological selection, calibration and evaluation. Data studio and the all-collection source audit remain available.
- **Island accessibility** shows a score out of 100 for every island. Choose **View island scores**, then open a number for plain-language health, school and transport reasons and an **Explore on map** action. Counts lead the priority cards; technical model fields stay in expandable details. The backend supplies the score, reasons and evidence coverage together. A low score can reflect missing mapping, and the score is not a percentage of residents served. Unknown population remains unavailable. See the [API and scoring definitions](backend/README.md#island-access-index).
- **Map & planning** uses one map for exploration, weather, directions and proposal design. Coloured island screens and supported local journey-time cells reveal evidence to investigate; selecting a cell explains it without moving the map. Captured OSM roads, named streets, buildings and green spaces provide geographic context. Correctly linked 2022 census counts cover 190 islands.
- **Explore** provides island profiles, shared A/B directions and nationwide departure calendars. Remove, reset, swap and back controls make location choices reversible. Bus directions show actual dated services, walking/waiting legs, boarding/alighting stops and route geometry. Clear bus-stop, ferry-terminal, healthcare and school symbols explain the stationary records. Observed vessels, aircraft and buses load automatically; crowded ship positions group into expandable badges. Source/freshness status, pause/refresh and a fit-to-movement view remain available.
- **Public transport and island connections** adds a transport walking-access forecast alongside healthcare and education. In **Directions → Island connections**, select islands by name or on the map to check landing places, mapped corridors and dated service evidence. **Plan a ferry service** previews a return service using existing terminals, with editable departure intervals, operating hours and assumed sailing speed. Vessel investment and operating costs are checked against both budgets; no port construction is included. The map and PDF show proposed connections separately from measured resident walking-access changes. The shipped terminal catalogue supports national screening; missing service evidence stays explicit. See [source coverage and model limits](docs/inter-island-transport.md).
- **Map-first transport design** lets you drop a bus stop and review a suggested road connection to an existing stop. Choose a highlighted interchange or another offered stop; approve the stop plus a dated return shuttle, or explicitly add only the boarding point. Bus and ferry settings open beside their mapped location. Ferry services snap to mapped landing places, with selectable departure/arrival terminals. Unconfirmed previews never enter the saved proposal. Confirmed route packages change schedules, fleet, budgets, emissions and relevant journey-access results; undo/removal handles each package together. See the [transport planning guide](docs/map-transport-planning.md).
- **Transport service benefits** appear before acceptance, in the proposal impact and in its PDF: route-specific expected waits, dated departures, next departure waits and named directional island connections. More frequent buses and new ferries can show benefits while walking access stays unchanged. Comparable wait savings use the same operating interval and boarding locations; new services never receive an invented baseline wait. See [service benefit definitions](docs/map-transport-planning.md#service-benefits-beyond-walking-access).
- **Create proposal**, on the same map, enforces capital and annual running budgets and produces located, costed draft suggestions. Select a school, hospital or bus stop, then click the map; dragging the icon remains a shortcut. Confirm or cancel beside the pin, with costs, access estimates and budget adjustment in the same bubble. Select accepted markers to move, duplicate or remove them; canceling a move preserves the original, and undo reverses accepted edits. A persistent budget shows upfront cost, annual running cost and residents gaining access. **Add bus stop** offers a road-connected return service or an explicit standalone stop. **Add bus** preserves the captured timetable and adds dated departures; **Improve bus line** changes its frequency. **Add ferry** creates a return island connection. **Improve ferry line** needs an existing dated timetable, which the supplied snapshot does not contain. Each action has a distinct stop, vehicle or line icon. The proposal opens directly to actions; selecting a map cell reveals a compact **Selected area** view. **Without proposal** and **With proposal** switch colors on one evaluated hexagon grid without rebuilding the map. Valid placements preview their access changes before acceptance. Choose public transport, healthcare or education above the comparison, and select a hexagon for its journey evidence. Unshaded land has no resident estimate. New placements and routed proposals receive an authoritative backend cost check before commitment; a matching placement preview is reused after confirmation. Review impact opens the full-page comparison and designed PDF with before/after access charts, travel-time bands, both budgets, 1/5/10-year fiscal charts, numbered site map and evidence appendix. Detailed resident-impact modeling covers 189 resident islands; each island displays its own spatial and routing evidence limits. See the [proposal interaction guide](docs/proposal-experience.md). Scheduled journeys, fleet design, emissions, delivery calibration and specialist edits remain under Advanced.
- **Weather & traffic**, within Explore, provides map-selected weather/sea/traffic locations and reviewed notice handoff. Movement is already on the main map.
- **Find a place**, within Explore, provides the Vela search, identity, reviews, imagery, provider routing, traffic and Street View workflows. Selected places can become the main map's named start or destination.
- **Evidence** shows coverage limits and official release checks with captured source hashes. Baselines change only through the applicable reviewed import workflow.

See the [holistic refinement and verification](docs/workspace-refinement.md), [prediction analysis](docs/data-analysis-and-prediction.md), [map/population sources](docs/map-context-and-population.md), and [delivery evidence](docs/delivery-calibration.md). Real-time collaboration is excluded as requested.

See [map activity and planning experience](docs/engaged-map-and-planning.md) for symbol meanings, live source contracts, simulated journey playback, hexagon interpretation and verification.

See [the map-first policymaker journey](docs/map-first-policymaker-journey.md) for the current canvas, contextual inspector, visual traffic endpoints, drag-and-drop interventions, named place directions and their verification.

The policy journey carries the exact selected island from overview to map to proposal. Browser Back and reload preserve island/view context; switching destinations retains the proposal draft and comparison reference. Shared shadcn-svelte components and theme tokens control buttons, cards, fields, selectors, tabs and sheets throughout the application. See the [UI/UX redesign and verification](docs/ui-ux-redesign.md).

Resident hexagons and proposal calculations now cover **189 resident islands**, including both Hithadhoos: the three original resident islands plus all **186 additional administrative islands** with matched official MBS projections. The combined model has **11,520 resident origins**, **131 located institution records**, and **444 boarding-point records**. Existing project WorldPop and OSM evidence provides modeled spatial detail; official totals, directories and operator catalogues retain their source identities. Addu Hithadhoo uses an explicitly approximate residential-building allocation because the captured raster fails screening. Missing routes, destination locations and timetables remain unavailable. School enrolment, island and constituency indicators, hospital history, household statistics and relevant public finance tables are normalized and queryable in Data Studio. See [national data models and source use](docs/national-data-models.md) for coverage, qualifications and reproducible preparation.

All six requested feature groups are now implemented and connected. Delivery retains illustrative default factors and supports source-linked local calibration with explicit manual overrides; source histories and service snapshots retain their actual dates. Review the [policy expansion implementation and verification](docs/policy-expansion.md) for coverage, model contracts, remaining evidence needs and test receipts. Earlier migration audit documents describe the supplied backend before this expansion.

Read the full [feature comparison](docs/backend-feature-audit.md), [backend verification](docs/backend-verification.md), and [browser verification](docs/frontend-verification.md).

## Backup and recovery

The complete pre-revamp source, Git history, uncommitted edits, research, local proposal and data, and environment files are copied to:

```text
D:\Projects\Personal\datathon-backup-20261014-124331
```

The backup contains 3,553 files (546.76 MiB). Reinstallable `node_modules`, `.svelte-kit`, Python environments, bytecode and tool caches were omitted. Selected source and local-data hashes were checked against the originals. The Downloads backend was copied; it was not edited.

The old `src/` and `scripts/` are retained under ignored `legacy/`. The source-backed `data/public` planning, passenger and evidence artifacts now feed the new Python services; no legacy Svelte engine executes. Vela's complete Python implementation is preserved under `backend/vendor/vela_api` with its license, calibration and tests. The originals in Downloads and `D:\Projects\Personal\vela-rest-api` remain unchanged. A second source snapshot before the feature expansion is `D:\Projects\Personal\datathon-backup-before-policy-expansion-20261014`.

The new app uses a separate browser storage key and leaves old browser saves untouched. Browser storage is not part of the filesystem backup. Old proposal JSON uses a different schema and must be opened with the old application; it is not automatically migrated.

To work with the previous version, open the backup directory in a separate terminal, run `npm install`, then its original `npm run dev`. Preserve any new work before restoring backup files over this project.

## Verification

Install the optional Python development/test tools once:

```sh
npm run setup -- --dev
```

```powershell
npm run check
npm run lint
npm test
npm run test:startup
npm run test:backend
npm run lint:backend
npm run build
```

Run the maintained end-to-end suite with both services running. It covers analytics, forecasts and data exploration, navigation, map controls, proposal editing and PDFs, and island connections:

```powershell
npx playwright install chromium
npm run test:browser
```

List all maintained suites or select focused checks for specialist service/fleet planning, timetable imports, island evidence, movement and analytical overlays:

```powershell
npm run test:browser:list
npm run test:browser -- planning delivery timetables
npm run test:browser -- overlays map-legibility
npm run test:policy-api
```

Browser harnesses default to http://127.0.0.1:5173, matching `npm start`. Set `MOBILITY_QA_URL` only to test another frontend URL. See the [current browser verification guide](docs/browser-verification.md) for coverage, compatibility aliases, all-suite execution, production-preview URLs and evidence boundaries.

The frontend uses SvelteKit's Node adapter with precompressed static assets. `npm start -- --port 5180` serves the optimized application at another port; `--force-build` rebuilds it explicitly. Hosting requires managed Node/FastAPI processes and deployment access controls. Private source caches and environment files remain ignored.

See [performance architecture and repeatable measurements](docs/performance.md) for compact country loading, persistent computed results, browser caching and the optional PostgreSQL cache. A fresh clone uses local caching automatically; database credentials remain private.

The [current code review and cleanup](docs/code-review-2026-10-16.md) records corrected calculation, refresh and cancellation behavior, shared helpers, removed obsolete checks and verification results. Earlier design-pass documents retain historical screenshots and test receipts; use the commands above for the current navigation.
