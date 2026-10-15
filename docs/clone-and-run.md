# Clone and run

The default local application requires no environment variables or `.env` files. The repository contains the frontend, FastAPI backend, Vela integration, locked dependencies and source-backed planning/analytics snapshots. Data paths resolve relative to the checkout, so the project can live in a different folder or on another computer.

## Prerequisites

- Git.
- [Node.js 24 with npm](https://nodejs.org/en/download). `.nvmrc` identifies the recommended major version.
- [uv](https://docs.astral.sh/uv/getting-started/installation/), available in your terminal. uv installs and manages the required Python 3.14 interpreter.
- Internet access for the initial dependency and Chromium downloads. Live upstream services also need internet access.

On Windows, uv is available through WinGet: `winget install --id=astral-sh.uv -e`. On macOS with Homebrew: `brew install uv`. The uv installation guide covers Linux and standalone installers. Reopen your terminal after installing tools if their commands are not yet available.

## First run

Run these commands in PowerShell, Terminal or a Linux shell:

```sh
git clone https://github.com/lyashahid/datathon.git
cd datathon
npm ci
npm start
```

`npm ci` installs the exact JavaScript versions in `package-lock.json`. `npm start` builds and serves an optimized Node frontend, prepares the backend using `backend/uv.lock`, prepares Chromium for the backend review collector and checks readiness. Subsequent starts reuse the frontend build until its inputs change. You do not need to copy the example environment files.

The backend automatically prepares heavier analytics and supported island planning views in the background, starting with the country map, scores and passenger history. The application serves requests without waiting for that preparation. Jobs run sequentially and reuse valid saved results from memory, local disk and optional PostgreSQL. A failed job is retried once without blocking the other jobs. No separate command is needed; a first request made before its view is prepared calculates normally. Custom proposals still calculate their actual inputs. See [the preparation coverage](performance.md#automatic-background-preparation).

| Service                                | Default address                               |
| -------------------------------------- | --------------------------------------------- |
| Application                            | http://127.0.0.1:5173                         |
| Backend health                         | http://127.0.0.1:8000/health                  |
| FastAPI documentation                  | http://127.0.0.1:8000/docs                    |
| Vela API documentation through the app | http://127.0.0.1:5173/api/backend/places/docs |

Startup reports the frontend URL in the terminal. Stop with Ctrl+C; the launcher stops services it created. A compatible backend that was already running is reused and remains running.

When the backend stops, it cancels its remaining background preparation. An already running backend keeps the warmup settings with which it was started; restart it to apply changed settings or model/source files.

Later starts use the same command:

```sh
npm start
```

After pulling dependency changes, run `npm ci` again; startup synchronizes the Python lockfile automatically.

### Linux browser libraries

Chromium requires platform libraries that may be absent from minimal Linux installations. Prepare them once:

```sh
npm run setup -- --with-system-deps
```

This uses Playwright's system-dependency installer and may require sudo. See [the official Playwright guide](https://playwright.dev/python/docs/browsers#install-system-dependencies). Startup reports an actionable error when browser setup cannot complete. A graphical desktop is not required: collection runs headlessly.

## What is included

- `backend/data/cache/normalized`: the captured national island, population and facility inventory.
- `backend/data/cache/graphs`: prebuilt routing and geographic context artifacts.
- `backend/data/cache/derived`: precomputed accessibility and related results.
- `backend/data/metadata` and source metadata beside the snapshots: provenance and coverage information.
- `data/public`: planning inputs, published passenger histories, operations snapshots, delivery evidence and source manifests.

No source-acquisition command is part of normal setup. Raw acquisition originals are retained only on the original machine and are unnecessary for normal operation. Rebuilding or refreshing those source datasets is a separate maintenance workflow described in the backend documentation.

Runtime notices, provider caches, draft/import receipts and frozen forecast receipts are created locally in ignored runtime directories. Browser-saved planning drafts belong to that browser; cloning does not transfer personal drafts or local runtime records. This is a local workspace; real-time collaboration is not included.

### Coverage and live services

The default application supports analytics, passenger forecasts/backtests, map exploration, planning and proposal reporting using the included snapshots. Detailed resident-access impact modeling currently covers three islands. Other islands support national evidence screening and costed concepts with unavailable detailed impact values.

Live weather, marine conditions, traffic, ships, aircraft, buses and Vela provider results depend on internet access, upstream availability, rate limits and geographic coverage. The app reports provider failures and missing observations; a successful local installation does not create live source coverage. RTL live bus positions remain disabled by default, while supported FollowMe observations are enabled. No paid provider key is required for the default local workflow.

## Optional configuration

The application already defines all required defaults. The committed `.env.example` and `backend/.env.example` are reference templates, not setup requirements.

| Setting                           | Default                        | Change only when                                                                             |
| --------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------- |
| `MOBILITY_BACKEND_URL`            | `http://127.0.0.1:8000`        | The frontend should call a separately managed backend.                                       |
| `VELA_API_KEY`                    | Empty; local service anonymous | You deliberately secure the Vela API; the proxy and backend must share the same private key. |
| `VELA_BROWSER_ENABLED`            | `true` for the local workflow  | You want to turn browser-based review collection off.                                        |
| `MOBILITY_DATA_DIR`               | This checkout's `backend/data` | You deliberately maintain another compatible backend dataset.                                |
| `MOBILITY_PUBLIC_DATA_DIR`        | This checkout's `data/public`  | You deliberately maintain another compatible planning/public snapshot.                       |
| `MOBILITY_COMPUTED_CACHE_PREWARM` | `true`                         | Set `false` to disable automatic country, analytics and planning preparation.                |

Root `.env` values are loaded by the launcher and frontend tooling. Backend-specific options can live in `backend/.env`; inherited process settings take precedence. See [backend configuration](../backend/README.md) for the complete precedence and path behavior.

Real credentials are excluded from Git. Public defaults belong in code and the example files. If you add a provider key later, use an ignored local environment file rather than editing a committed example.

## Development and checks

Prepare optional Python test and notebook dependencies:

```sh
npm run setup -- --dev
npm run check
npm run lint
npm test
npm run test:startup
npm run test:backend
npm run lint:backend
npm run build
```

Use `npm run dev` to start both services with frontend hot reload while editing. For independent terminals, run `npm run setup`, then `npm run dev:backend` in one terminal and `npm run dev:frontend -- --host 127.0.0.1` in another.

The frontend browser-test tooling uses its own Playwright version. For those tests, install that version's Chromium with `npx playwright install chromium`; this is separate from the backend browser prepared by startup. Existing browser verification scripts are under `scripts/`.

For a local production-build preview, leave the backend running and use:

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 5181 --strictPort
```

For normal optimized use, `npm start -- --port 5181` builds only when needed and runs the Node adapter directly. `npm start -- --force-build` forces a fresh build. Listener ports are strict; startup never silently moves to another port. The Node adapter precompresses static assets. Hosting publicly requires managed Node and FastAPI processes plus deployment access controls.

Optional PostgreSQL stores reusable computed results across restarts. Put `MOBILITY_DATABASE_URL` in ignored `backend/.env` to enable it. It is unnecessary for a fresh clone: memory and local disk caches work automatically. The database is server-side only and is never included in the browser bundle or Git. See [the performance guide](performance.md) for cache behavior, invalidation and measurements.

## Troubleshooting

| Symptom                                      | Action                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `node`, `npm` or `uv` is not found           | Install the prerequisite and reopen the terminal. Verify with `node --version`, `npm --version` and `uv --version`.                   |
| Python or dependencies cannot download       | Check internet/proxy access, then retry `npm run setup`. Avoid changing the lockfiles to work around a network failure.               |
| Chromium cannot launch on Linux              | Run `npm run setup -- --with-system-deps`, then retry.                                                                                |
| Port 8000 belongs to another service         | Stop that service or deliberately configure a separate backend. The launcher checks the health response before reusing a process.     |
| The frontend port is occupied                | Stop the process occupying 5173, or select another with `npm start -- --port 5181`. Production startup uses a strict port.            |
| Frontend reports the backend is unavailable  | Start with `npm start` from the repository root and check http://127.0.0.1:8000/health.                                               |
| A live feed is empty or unavailable          | Check its in-app source/freshness status; captured planning and analytics remain available.                                           |
| Source data is missing after copying folders | Use a complete Git clone. Do not exclude `backend/data` or `data/public`.                                                             |
| An old checkout behaves differently          | Check ignored `.env` files for deliberate overrides and rerun `npm ci` and `npm start`. A fresh clone needs neither environment file. |

The project does not require PostgreSQL, Redis, Docker, the original Downloads backend folder, the original Vela checkout or any `D:\Projects\...` path.
