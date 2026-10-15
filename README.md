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

Open http://127.0.0.1:5173. `npm start` prepares the backend, starts FastAPI on http://127.0.0.1:8000, waits for its health response, and starts the frontend. `npm run dev` is the same workflow. It can reuse an already running Mobility Sandbox API at the configured address. Stop services started by the launcher with Ctrl+C.

On a minimal Linux installation, Chromium may also need operating-system libraries. Install them once with `npm run setup -- --with-system-deps` (the package manager may ask for sudo). See [Playwright's system-dependency documentation](https://playwright.dev/python/docs/browsers#install-system-dependencies).

See [the complete setup, configuration and troubleshooting guide](docs/clone-and-run.md) for Windows/macOS/Linux prerequisites, first-start behavior, optional overrides, data coverage, tests and production-preview commands.

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

- **Analytics** opens with an interactive atoll comparison, facility-mix donut, coordinate-coverage gauge, accessibility distribution and published passenger-history chart. Cohort and atoll filters update the service views; the passenger chart covers its own published routes, with three source series, 12-month/all-history ranges and prior-year comparison. Transport, health and education screening cards lead into investigation queues, and Inspect on map carries the island and service lens into the shared map. Island records, scoped CSV exports and source methodology remain expandable. Passenger outlook compares nine statistical/baseline methods and a selection-weighted ensemble, with separate chronological selection, calibration and evaluation. Data studio and the all-collection source audit remain available.
- **Map & planning** uses one map for exploration, weather, directions and proposal design. Coloured island screens and supported local journey-time cells reveal evidence to investigate; selecting a cell explains it without moving the map. Captured OSM roads, named streets, buildings and green spaces provide geographic context. Correctly linked 2022 census counts cover 190 islands.
- **Explore** provides island profiles, shared A/B directions and nationwide departure calendars. Remove, reset, swap and back controls make location choices reversible. Bus directions show actual dated services, walking/waiting legs, boarding/alighting stops and route geometry. Clear bus-stop, ferry-terminal, healthcare and school symbols explain the stationary records. Observed vessels, aircraft and buses load automatically; crowded ship positions group into expandable badges. Source/freshness status, pause/refresh and a fit-to-movement view remain available.
- **Create proposal**, on the same map, accepts capital and annual running budgets and produces located, costed draft suggestions. Alternatively drag a school, hospital or bus stop onto the map, move its preview and confirm or cancel. Confirmed edits support undo and reversible clear. Costs and modeled resident access update with the proposal; access hexes show gains and losses. Review full impact opens a full-page comparison with assumptions and a server-generated PDF containing the site map, costs, access results and source notes. Suggestions require review; detailed resident-impact modeling currently covers three islands. Other islands support evidence screening and costed concepts with unavailable access estimates. Scheduled outward/return journeys, fleet design, emissions, delivery calibration and specialist infrastructure edits remain under Advanced.
- **Weather & traffic**, within Explore, provides map-selected weather/sea/traffic locations and reviewed notice handoff. Movement is already on the main map.
- **Find a place**, within Explore, provides the Vela search, identity, reviews, imagery, provider routing, traffic and Street View workflows. Selected places can become the main map's named start or destination.
- **Evidence** shows coverage limits and official release checks with captured source hashes. Baselines change only through the applicable reviewed import workflow.

See the [holistic refinement and verification](docs/workspace-refinement.md), [prediction analysis](docs/data-analysis-and-prediction.md), [map/population sources](docs/map-context-and-population.md), and [delivery evidence](docs/delivery-calibration.md). Real-time collaboration is excluded as requested.

See [map activity and planning experience](docs/engaged-map-and-planning.md) for symbol meanings, live source contracts, simulated journey playback, hexagon interpretation and verification.

See [the map-first policymaker journey](docs/map-first-policymaker-journey.md) for the current canvas, contextual inspector, visual traffic endpoints, drag-and-drop interventions, named place directions and their verification.

The policy journey carries the exact selected island from overview to map to proposal. Browser Back and reload preserve island/view context; switching destinations retains the proposal draft and comparison reference. Shared shadcn-svelte components and theme tokens control buttons, cards, fields, selectors, tabs and sheets throughout the application. See the [UI/UX redesign and verification](docs/ui-ux-redesign.md).

The national map retains the supplied structural screening model. Detailed service and resident calculations use the preserved Greater Malé planning snapshot, with a verified bridge between its four island IDs and the national atlas. Its 667 weighted origins, 45 audited destinations, 99 RTL stops and published/captured service evidence are available to the new backend planning model. Outer-island detailed travel-time coverage remains unavailable. Published ferry frequencies require an explicit crossing-time assumption; vehicle movement and consumer traffic times remain separate live evidence. Missing population or provider fields stay unavailable.

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

Run the browser harness with both services running:

```powershell
npx playwright install chromium
npm run test:browser:map-journey
npm run test:browser:map-focus
npm run test:browser:bus-vehicles
npm run test:browser:unified-policy-journey
npm run test:browser:policy-drag
node scripts/verify-analytics-redesign.mjs
npm run test:browser
npm run test:policy-api
npm run test:browser:forecasts
npm run test:browser:planning
npm run test:browser:places
npm run test:browser:map
npm run test:browser:workspace
npm run test:browser:delivery
npm run test:browser:timetables
npm run test:browser:movement
npm run test:browser:map-legibility
npm run test:browser:planning-map
npm run test:browser:policymaker
npm run test:browser:map-first-policy
npm run test:browser:map-first-conditions
npm run test:browser:map-first-places
```

Browser harnesses default to http://127.0.0.1:5173, matching `npm start`. Set `MOBILITY_QA_URL` only to test another frontend URL. For production-preview verification, run `npm run build`, start `npm run preview -- --host 127.0.0.1 --port 5180`, keep FastAPI running, and set the harness URL to http://127.0.0.1:5180.

The current adapter supports local preview; deploying requires an adapter appropriate to the target host and a reachable FastAPI service. Private source caches and environment files remain ignored.
