# Mobility Sandbox MV

A source-backed, map-first transport planning workspace for Greater Malé. The app opens the original **Map** for exploring areas, routes and proposals. **Data and Forecasts** brings together published statistics, projections, dated inventories and experimental passenger outlooks. **Decisions** compares service-timing and assumed road-delay options with your current map proposal. **Evidence** exposes source dates, coverage and outstanding verification. Bus observation limits are available within Decisions. Use **Show geography on map** to locate an outlook; **Open this option in map** explicitly applies a selected scenario.

Within **Data and Forecasts**, **Explore data** provides charts across passengers, population, public services, transport, economy and public updates, with subject filters, dataset search, exact values and source inspection. **Build a visualization** lets a reader compare compatible datasets and save chart settings and their own observation in this browser. Comparisons keep coverage, dates, units and missing values explicit; different units use relative change rather than misleading combined amounts. **Forecasts** retains the monthly passenger estimates, historical checks and benchmark comparisons. Exploration describes the records; decision comparisons remain in Decisions. Geographic layers remain on Map, and no measured congestion or vehicle occupancy history is supplied.

Actual counts, estimates, source dates, uncertainty, benchmark results, policy gains and losses, unknowns, and costs are inspectable in the application. Read the [current release and verification](docs/prediction-release.md), [source receipt](docs/prediction-source-receipt.md), and [five-minute demonstration](docs/DEMO_SCRIPT.md).

## Run locally

Use Node.js 24. Python 3.11+ is needed for data preparation and source checks, not to run the committed snapshots.

```powershell
npm install
if (-not (Test-Path -LiteralPath .env)) {
    Copy-Item -LiteralPath .env.example -Destination .env
}
npm run dev -- --host 127.0.0.1
```

On macOS/Linux, use `cp .env.example .env` for the copy step. Open http://127.0.0.1:5173. The default public profile needs no API keys; planning and evidence bundles load locally. Online basemap tiles and fetching a new notice require connectivity.

For a production preview:

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 5180
```

Preview is for local verification. Hosted deployment needs an appropriate SvelteKit adapter. Optional settings are documented in [.env.example](.env.example). Restart development after changing settings and rebuild production. Keep credentials server-side; a `VITE_` key is public browser configuration.

`PUBLIC_DATA_ONLY=true` excludes restricted FollowMe records. Optional notice AI is disabled by default and requires an explicitly configured model and server credential. Notices remain attributed candidates until reviewed for time, location and restriction; they never automatically close roads. No scheduled crawler or continuous vehicle polling is installed. See [operations configuration](docs/operations-data.md) and [transport-context permissions](docs/transport-context.md).

## Verification

```sh
npm run check
npm run lint
npm test
npm run test:prediction:sources
npm run data:validate
npm run build
```

Run browser regression checks against the production preview at port 5180 with `npm run test:browser`. Set `POLICY_QA_URL` to use another URL. This optional Node 24 harness requires Playwright installed, or `PLAYWRIGHT_MODULE` pointing to its importable module. It covers map-first route navigation, map/decision round trips, selected calculation inputs, data-table values, builder handover and comparison safeguards, nested forecast tables, source dates and mobile overflow. Navigate through **Data and Forecasts → Forecasts** for the passenger outlook; `/forecasts` remains the workspace route, with `dataView` selecting its section. The [release record](docs/prediction-release.md) distinguishes actual developer/browser verification from an authored harness and the still-pending study with policymakers.

## Refresh data

Raw downloads and private captures are ignored; compact public bundles and source manifests are versioned. Retain source originals in `data/raw/` and acquisition archives, private research receipts where permitted, and original artwork in `artifacts/graphics/generated/` needed by the graphics-packaging script. Historical screenshots and exported briefs are disposable verification outputs. Refreshes preserve valid cached sources and expose missing evidence rather than fabricating observations.

The restored local proposal is preserved in ignored `data/local/scenarios/restored-proposal.json`. Keep local scenario exports in `data/local/` rather than temporary QA folders.

| Command                        | Purpose                                                                             |
| ------------------------------ | ----------------------------------------------------------------------------------- |
| `npm run data:setup`           | Install Python preparation dependencies.                                            |
| `npm run data:refresh`         | Fetch, prepare and validate population, streets, facilities and bus timing.         |
| `npm run data:prediction`      | Check official monthly publication tables and regenerate the forecast source.       |
| `npm run test:prediction`      | Check the bounded collector, sources, forecast and policy logic.                    |
| `npm run data:policy-evidence` | Refresh supporting GIS, demographic, facility and ferry evidence.                   |
| `npm run data:operations`      | Refresh advisories, disruption candidates, national population and imagery context. |
| `npm run data:context`         | Prepare public port and airport context.                                            |
| `npm run data:bus-capture`     | Run a bounded ten-minute route-133 pilot; raw positions remain private.             |

For staged baseline work, use `data:fetch`, `data:prepare`, and `data:validate`; supporting pipelines have equivalent staged commands described in their source documents. On a new acquisition checkout, prepare the baseline before operations. Monthly preparation requires `requests` and `openpyxl`. `MOBILITY_PYTHON` can select a Python executable in the shell environment; most data runners do not load `.env`. The optional `data:followme` adapter does so explicitly for its issued credential.

Monthly counts are **passenger movements**, not unique people, route occupancy or neighborhood demand. June 2026 repeated bus values are quarantined. Near-term bus arrival/congestion prediction is unavailable: source measurement timestamps, reuse rights and sufficient independent observations remain unresolved. Moving buses illustrate finite, user-requested timetable scenarios on supplied geometry; they are not observations or training data.

After changing the baseline or planning model, regenerate and check the version-pinned detailed examples:

```sh
node scripts/create-demo-scenarios.mjs
node scripts/create-demo-scenarios.mjs --check
node scripts/profile-disruptions.mjs
node scripts/profile-return-journey.mjs
```

## Maintainer documents

| Area                                         | Documentation                                                                                                                                                                                      |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current behavior, verification and next work | [Prediction release](docs/prediction-release.md), [source receipt](docs/prediction-source-receipt.md), [roadmap](docs/roadmap.md), [demo](docs/DEMO_SCRIPT.md)                                     |
| Baseline, model and interpretation           | [Data sources](docs/data-sources.md), [model methodology](docs/model-methodology.md), [disruptions](docs/model-disruptions.md), [recalculation and population display](docs/recalculation-wave.md) |
| Location and service verification            | [Location audit](docs/location-audit.md), [facility operation](docs/facility-operation-review.md), [transit operation](docs/transit-operation-review.md)                                           |
| Supporting sources and permissions           | [Policy evidence and agency inputs](docs/policy-investment-release.md), [operations](docs/operations-data.md), [sea and air context](docs/transport-context.md)                                    |
| Retained detailed-editor workflows           | [Stop connections](docs/stop-connections.md), [legacy ingestion data model](docs/data-model.md)                                                                                                    |
| Assets and licenses                          | [Generated map graphics](docs/generated-map-graphics.md), [useLayouts license](docs/licenses/uselayouts.txt), [Rare UI license](docs/licenses/rare-ui.txt)                                         |

Preserve source attribution and confirm reuse terms before redistribution. Public availability alone is not an open license. OSM/WorldPop and optional imagery terms are documented with their sources. EOX satellite mosaics are visual context under noncommercial CC BY-NC-SA 4.0 terms; they do not measure congestion or development change. The local atlas is the default.
