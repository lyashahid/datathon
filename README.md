# Mobility Sandbox MV

A Maldives planning workspace built with SvelteKit, MapLibre and a Python FastAPI backend. Analytics surfaces service gaps, Map & planning combines island search, directions and costed proposals, and Evidence explains the sources and their limits.

## Clone and run

Install [Node.js 24](https://nodejs.org/en/download), [uv](https://docs.astral.sh/uv/getting-started/installation/) and Git. uv manages Python automatically.

```sh
git clone https://github.com/lyashahid/datathon.git
cd datathon
npm ci
npm start
```

Open http://localhost:5173. FastAPI runs at http://127.0.0.1:8000, with interactive API documentation at http://127.0.0.1:8000/docs. Stop the launcher with Ctrl+C.

No environment file, API key, database server or acquisition step is required for the default local setup. Planning and analytics snapshots are included in Git. First startup downloads the locked Python dependencies and Chromium for the Vela review collector, then builds the optimized frontend. Later starts reuse the build until its inputs change.

For development with hot reload:

```sh
npm run dev
```

For separate terminals, run `npm run setup` once, then `npm run dev:backend` and `npm run dev:frontend -- --host 127.0.0.1`. Minimal Linux installations may need `npm run setup -- --with-system-deps` for Chromium's operating-system libraries.

See [setup and troubleshooting](docs/clone-and-run.md) for platform details and [deployment](docs/deployment.md) for Docker, production settings and the hosted app.

## Working with the app

- **Analytics** compares atolls, service coverage and published passenger history. Investigation cards carry the selected island and service into the map.
- **Map & planning** uses scoped search for islands and places, with directions in the same search area. Island overviews explain the access index, facilities and population. Sea and domestic air connections load with the map and can be inspected from their routes. Proposal tools add located interventions, check capital and running budgets, and compare evaluated journey access.
- **Evidence** exposes source coverage, methodology and reviewed import workflows. Specialist forecasts, data exploration, conditions and timetable tools remain available through their workspace entry points.

Access scores combine service evidence and data coverage; they are not a percentage of residents served. Missing population, routes and timetables remain unavailable. Sea pressure colours compare population with published departure frequency; they do not measure actual vessel crowding or capacity. Domestic air connections retain unknown pressure until current route demand and frequency are supported. See [model methodology](docs/model-methodology.md), [map and population sources](docs/map-context-and-population.md), [official sea services](docs/official-sea-services.md) and [domestic flight connections](docs/domestic-flight-services.md).

## Code and data

The frontend sends calculation and inventory requests through the same-origin `/api/backend/*` proxy. FastAPI owns the source-backed calculations and inventory. The map uses packaged island and facility geometry without requiring an online basemap.

- `src/lib/components/`: interface and workspace components.
- `src/lib/`: shared map, planning, search, chart and API helpers.
- `backend/app/`: API routes, source services and calculation models.
- `backend/data/cache/{normalized,graphs,derived}` and `data/public/`: packaged data used at startup.
- `backend/vendor/vela_api/`: the supplied Vela implementation and its license.

Source originals and credentials stay in ignored local storage. Avoid rerunning acquisition just to start the app. Automatic background preparation reuses cached results; see [performance and caching](docs/performance.md). The supplied backend records and licenses are retained under [docs/supplied-backend](docs/supplied-backend).

The [.env.example](.env.example) and [backend/.env.example](backend/.env.example) files describe optional overrides. Backend credentials stay server-side. Live weather, traffic, movement and provider search need internet access and depend on upstream coverage; RTL live bus positions are disabled by default. See [backend configuration](backend/README.md).

Edit `themePalette` in [src/lib/theme.ts](src/lib/theme.ts) to change interface, chart and map colours together. Use opaque hex colours; derived shades and transparency follow automatically.

## Verification

Run checks that match the change. Frontend unit tests can be selected by file:

```sh
npm run check
npm run lint
npm test -- src/lib/search-directions.test.ts
npm run test:startup
```

Install Python test tools once with `npm run setup -- --dev`. Then select the relevant backend tests, for example:

```sh
npm run test:backend -- tests/test_routing.py
npm run lint:backend
```

With both services running, list or select the maintained browser journeys:

```sh
npm run test:browser:list
npm run test:browser -- search directions
```

`npm run test:browser` runs the small default set of current user journeys. Use `npm run test:browser:all` for an explicit comprehensive check. Set `MOBILITY_QA_URL` to target another frontend URL. See [browser verification](docs/browser-verification.md) for suite IDs, coverage and prerequisites. Use `npm test`, `npm run test:backend` or `npm run build` when the scope warrants the full corresponding check.

## Further guidance

- [Map interactions and layers](docs/engaged-map-and-planning.md)
- [Proposal experience](docs/proposal-experience.md)
- [Bus and ferry planning](docs/map-transport-planning.md)
- [Data sources](docs/data-sources.md)
- [Forecast issue workflow](docs/forecast-issue-workflow.md)
- [Prediction source receipt](docs/prediction-source-receipt.md)
