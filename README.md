# Mobility Sandbox MV

A visual policy investment simulator for Greater Malé. Select an area, edit a street-routed bus connection directly on the map, and compare people reaching healthcare or schools, journey time, investment, annual operations, and conditional emissions.

## Run locally

Use Node.js 24. Python 3.11+ is needed only to refresh or regenerate data, not to run the committed snapshots.

For a first-time setup on Windows:

```powershell
npm install
Copy-Item -LiteralPath .env.example -Destination .env
npm run dev -- --host 127.0.0.1
```

On macOS/Linux, use `cp .env.example .env` for the copy step. Keep an existing `.env` instead of overwriting it. The example already selects the public baseline and public-only competition profile.

Open http://127.0.0.1:5173. No API keys are required for the default app. The committed public planning, policy-evidence, operations and transport-context bundles load locally; upstream portals are needed when refreshing data or fetching a new public notice. Online basemap tiles are optional.

To preview a production build:

```sh
npm run build
npm run preview -- --host 127.0.0.1 --port 5173
```

The preview command is for local verification. A hosted deployment needs an appropriate SvelteKit adapter for its target environment.

The opening workflow has three tasks: explore access, test a road disruption, and compare an investment. Road closures and delays have an explicit date, time, direction and travel mode. Choose whether to maintain frequency with more vehicles or accept longer waits with a fixed fleet. Temporary disruption costs are reported separately from annual investment costs. The map retains its previous result while its local honeycomb wave and the matching calculation finish.

Expand an area's **Can they get there and back?** section to check an appointment duration and home-arrival deadline. Service playback illustrates a selected route's published or assumed timing; it is not live vehicle tracking. The optional Vilimalé service needs an explicitly entered crossing duration because its public calendar does not provide one.

`PUBLIC_DATA_ONLY=true` is the default competition profile. `ENABLE_NOTICE_AI=false` works without a key using source-linked extraction rules; optional AI requires server-side credentials and an explicitly configured model. No notice automatically changes a road. Keep the last validated operations snapshot available with `npm run data:operations`; see [operations sources and configuration](docs/operations-data.md). Planning remains local after loading; online satellite tiles and fetching a new notice require a connection.

The satellite picker can compare the published 2020 and 2025 Sentinel-2 mosaics. These are visual context, not measured congestion or development change. National population coverage is separate from Greater Malé routing. See the [demo script](docs/DEMO_SCRIPT.md) for a reproducible five-minute presentation and pinned scenario examples.

## Environment configuration

All application variables are optional and are listed in `.env.example`. `.env` is ignored by Git. Restart the dev server after editing it; rebuild before previewing production changes. `VITE_MAPTILER_KEY` is embedded in the browser build, so changing it requires rebuilding that build.

| Variable                       | Default      | Purpose and scope                                                                                                                                                                               |
| ------------------------------ | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BASELINE_SOURCE`              | `public`     | Server configuration for the retained infrastructure/routes compatibility endpoints. Accepts `public`, `sample` or `processed`; the policy atlas always uses the cached public planning bundle. |
| `PUBLIC_DATA_ONLY`             | `true`       | Excludes restricted local FollowMe snapshots from browser/API responses. Public MPL and airport context remain available under their enable flags.                                              |
| `ENABLE_VESSEL_DATA`           | `true`       | Enables vessel context. `false` removes both MPL and FollowMe records from `/api/transport-context`; `PUBLIC_DATA_ONLY` still takes precedence for FollowMe.                                    |
| `ENABLE_FLIGHT_PASSENGER_DATA` | `true`       | Enables official airport passenger context. `false` removes it from `/api/transport-context`.                                                                                                   |
| `ENABLE_NOTICE_AI`             | `false`      | Enables optional server-side AI assistance for a selected public notice. The default uses source-linked rules without a key.                                                                    |
| `OPENAI_API_KEY`               | Unset        | Server-only credential for optional notice extraction. Used only when AI is enabled and a model is configured.                                                                                  |
| `NOTICE_AI_MODEL`              | Unset        | Explicit model ID supporting the Responses API structured output used by the notice adapter. No model is selected automatically.                                                                |
| `FOLLOWME_API_KEY`             | Unset        | Server-only issued credential for the optional authorized vessel refresh adapter. It does not bypass the public-only filter or provide a verified live-tracking feed.                           |
| `VITE_MAPTILER_KEY`            | Unset        | Public browser key selecting MapTiler satellite in place of the default keyless satellite provider. Restrict it by domain.                                                                      |
| `MAP_STYLE_URL`                | Unset        | Public MapLibre v8 style URL for the retained legacy map viewer. It does not change the policy atlas appearance menu. Avoid embedding secrets in this URL.                                      |
| `WEATHER_PROVIDER`             | `open-meteo` | Server provider for the retained weather endpoints; Open-Meteo is currently the registered provider. It does not select the atlas's cached MMS CAP advisories.                                  |

Boolean flags accept `true` or `false`, case-insensitively. Missing or blank flags use their defaults; other values fail configuration validation.

To enable optional AI extraction, set all three values in `.env`:

```dotenv
ENABLE_NOTICE_AI=true
OPENAI_API_KEY=your_server_key
NOTICE_AI_MODEL=your_supported_model_id
```

The key stays server-side; never add a `VITE_` or `PUBLIC_` prefix to a secret. Missing credentials/model or a failed or invalid AI response falls back to rules. Output remains an attributed candidate until its time and road/service extent are explicitly mapped into a scenario. No notice automatically closes a road, and no polling or scheduled news crawler is installed. See [operations sources and configuration](docs/operations-data.md).

Two optional tooling variables belong in the shell environment, rather than relying on `.env` loading:

| Variable                    | Purpose                                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MOBILITY_PYTHON`           | Path to a Python executable for data preparation. The runners otherwise try the bundled runtime, `python`, then `python3`.                                  |
| `MAP_GRAPHICS_NODE_MODULES` | Existing dependency directory containing Sharp, used only when repackaging generated artwork. See [generated map graphics](docs/generated-map-graphics.md). |

For example, set `$env:MOBILITY_PYTHON = 'C:\path\to\python.exe'` in PowerShell before a data command, or `export MOBILITY_PYTHON=/path/to/python` on macOS/Linux. The data runners do not load `.env` automatically; `npm run data:followme` explicitly does so for its issued key.

## Data preparation

The public snapshot includes official census and planning populations, island demographic aggregates, WorldPop spatial weights, OSM street topology and buildings, matched facilities, and dated RTL bus departures. Raw downloads are ignored under `data/raw/`; processed assets and their checksums are under `data/public/`.

```sh
npm run data:setup       # Install Python preparation dependencies
npm run data:fetch       # Retrieve sources; retain valid cached originals
npm run data:prepare     # Transform cached files into a planning bundle
npm run data:validate    # Check population, topology, metadata and service inputs
npm run data:refresh     # Fetch + prepare + validate
```

Set `MOBILITY_PYTHON` to a Python executable if automatic discovery is unsuitable. Preparation requires the packages in `scripts/public-data-requirements.txt`. `npm run ingest:fixtures` preserves the separate legacy fixture pipeline.

The browser loads `/api/planning-baseline`; the existing infrastructure and routes endpoints remain available. A missing or invalid public bundle produces an explicit unavailable response. Within a running server, a failed replacement retains the last validated snapshot with a stale flag. It never inserts synthetic population.

Supporting policy evidence has its own reproducible pipeline:

```sh
npm run data:policy-evidence           # Fetch + prepare + validate
npm run data:policy-evidence:fetch
npm run data:policy-evidence:prepare
npm run data:policy-evidence:validate
```

It caches HDC pavements, planned lots, trees and accessibility observations; MOE school statistics; Census constituency indicators; HIES expenditure; IGMH utilization; and four public MTCC ferry calendars. Originals are ignored under `data/public/archive/policy-evidence/`, and processed assets/checksums are versioned under `data/public/policy-evidence/`. The Evidence drawer loads metadata through `/api/policy-evidence?view=summary` and map geometry on demand through `?layer=<id>`. These contextual layers do not silently change routing or establish service capacity. See [policy investment release](docs/policy-investment-release.md) for delivered requirements, source counts and remaining inputs.

Public operations and national evidence have a separate pipeline:

```sh
npm run data:operations           # Fetch + prepare + validate
npm run data:operations:fetch
npm run data:operations:prepare
npm run data:operations:validate
npm run data:operations:refresh   # Alias for fetch + prepare + validate
```

On a clean data-acquisition checkout, run baseline fetch/preparation first: operations preparation needs the planning bundle and original official population/projection workbooks. Raw operations files are ignored under `data/public/archive/operations/`; compact outputs and the source manifest are versioned under `data/public/operations/`. `/api/operations` serves these local assets. Failed refreshes retain the last validated snapshot and expose its date and gaps. The bundle includes dated MMS advisories, public disruption candidates, national population display locations, ferry evidence and the annual imagery catalogue. It does not establish observed traffic speeds or a national routing network.

## Prepared policy examples

Open **Proposal options → Try a prepared policy example** for the healthcare bus investment, a roadworks stress case, a ferry with missing runtime, and an explicitly assumed ferry runtime. Each import carries data/model versions and pinned journey/appointment inputs; Undo restores the preceding proposal.

After a baseline or model change, regenerate and verify the examples:

```sh
node scripts/create-demo-scenarios.mjs
node scripts/create-demo-scenarios.mjs --check
node scripts/profile-disruptions.mjs
node scripts/profile-return-journey.mjs
```

These commands use local snapshots without network requests. Use the [five-minute demo script](docs/DEMO_SCRIPT.md) for the evidence boundaries and presentation sequence. Proposal JSON preserves reproducible inputs; the policy brief exports a one-page PDF and a detailed JSON evidence attachment. There is no MBS review or quality-release workflow.

## Policy workflow

- Select a priority area or a population origin. The three primary views are People, Access and Impact.
- The map opens without a sidebar. Select an area for its people and access, or select a stop/route for that object's controls. Healthcare and Schools are keyboard-accessible Bits UI choices in the map toolbar.
- Choose Build bus in the bottom tool tray. A shelter preview snaps to a permitted road and previews the connection and results. Click to commit; Escape or right-click cancels. Invalid placement leaves the tool active. Route extensions inherit the original route's frequency and fleet.
- Drag a selected stop, adjust the frequency slider, or switch its fleet. Results update during editing; releasing a drag records one undoable change. Edits save automatically; there is no separate Apply step.
- A new service follows permitted driving streets in both directions. An extension requires a valid return connection; placing an unserved stop alone has no transit benefit.
- Open Services in the tool tray for closures, keyboard stop placement, and operating hours. Proposed stop moves rebuild both route directions; moving a published stop pauses its affected timetable pending reviewed replacement timing.
- Use Compare in the header for up to three beneficial alternatives that fit both capital and annual operating budgets on the chosen cost basis. Unknown costs and over-budget options are excluded. Settings separates journey, cost, carbon and proposal controls; advanced inputs are expandable.
- Check service/date coverage beside the results. Results lead with additional residents and include lost access, slower journeys and unknown coverage by island. Destination settings can require suitable care, school levels, public eligibility and verified hours; missing metadata remains unavailable.
- In 2030 mode, test a conditional housing distribution while conserving the official island population. Optional fare affordability uses explicitly entered fare, trips and household budget. Supporting HIES figures remain historical context.
- Save automatically on this device, import/export version-pinned JSON through Proposal options, or generate a printable policy brief with a top-down map. Sources and assumptions collapse on screen and remain expanded in print.

Healthcare is the initial goal, with schools and 2030 planning population available. Initial date/time uses a supported window of the loaded service snapshot, with a 30-minute target and at most two transfers. A complete calendar would use 08:00 Maldives time; the current partial snapshot remains clearly qualified. Detailed assumptions, island demographics, source coverage, and the SDG-aligned network access estimate are secondary controls.

## Interpretation and gaps

Neighborhood populations are modeled allocations normalized to official island totals. Demographic groups remain island aggregates; their spatial distribution is unavailable. A mapped clinic does not establish access to all specialist care.

The cached RTL departures cover only part of the retrieved day; morning coverage is incomplete. Ferry crossing times and some facility positions remain unverified. Missing inputs are reported as unavailable, and no sea crossing is created merely because terminals exist.

Local route costs, vehicle efficiency, electricity emissions and private-travel displacement require calibration. The opening cost/energy ranges are clearly labeled illustrative and editable; official fuel/tariff figures are supporting anchors. Extra transit can increase emissions. Sensitivity ranges are assumptions, not confidence intervals or observed ridership forecasts.

First-load desktop browser analyses measured roughly 1.8–2.2 seconds including worker messaging in the latest verification. The 250 ms novel-preview and subsecond committed-analysis targets are not guaranteed; the settings panel reports the latest browser analysis duration. See the [disruption model and benchmark](docs/model-disruptions.md) and [return-journey profile](docs/return-journey-profile.json) for separate model timings, which do not establish browser performance. The five-person first-minute usability acceptance still needs real testers. Agency demand, reliability, heat, congestion, health and employment effects remain future work where local inputs exist.

## Verification

```sh
npm run check
npm run lint
npm test
npm run build
```

See [data sources](docs/data-sources.md), [model methodology](docs/model-methodology.md), and [planning QA](docs/planning-qa.md) for provenance, formulas, independently solved examples and measured limits. Older demo/metric documentation describes the retained legacy engine rather than the public policy atlas.

## Sea & air context

The map toolbar opens a compact Sea & air panel with public MPL vessel movements and official airport passenger tables. An authorized local FollowMe snapshot can additionally supply a searchable boat directory when the public-only profile is disabled. Boat symbols are cached observations with published timestamps, not live tracking. MPL port-call rows contain no coordinates and are never plotted as vessel positions. Airport counts describe passenger movements rather than unique people or per-flight occupancy. These observations do not enter access, cost, carbon, priority ranking or saved policy scenarios.

The example configuration enables both auxiliary datasets while retaining the public-only filter:

```dotenv
PUBLIC_DATA_ONLY=true
ENABLE_VESSEL_DATA=true
ENABLE_FLIGHT_PASSENGER_DATA=true
FOLLOWME_API_KEY=
```

Setting either dataset flag to `false` removes it from `/api/transport-context` responses. The vessel flag controls both FollowMe and MPL. Map visibility switches only change presentation. `PUBLIC_DATA_ONLY=true` suppresses FollowMe even when a local snapshot and key exist. Public MPL and airport snapshots need no key. A permitted local FollowMe snapshot needs `PUBLIC_DATA_ONLY=false` and `ENABLE_VESSEL_DATA=true` to be displayed; keep this configuration local unless redistribution is authorized.

```sh
npm run data:context             # Fetch missing MPL / MBS files, prepare and validate
npm run data:context:refresh     # Explicit upstream refresh; retain valid cached originals
npm run data:context:prepare     # Prepare from local files
npm run data:context:validate
npm run data:followme -- prepare # Normalize the already acquired local research cache
npm run test:context
```

FollowMe is not an open-data redistribution source. Its user-requested local snapshot and originals remain in ignored `data/public/archive/context/followme/`; only provenance metadata is versioned. A fresh checkout therefore reports FollowMe unavailable until a permitted local snapshot is installed. The optional issued-key transport can cache an authorized response with `npm run data:followme -- keyed-refresh`, throttled to one request per minute. Its response schema still needs verification before it can replace the public snapshot; no private device data is sent to the browser.

MACL means Maldives Airports Company Limited; the earlier “MASL” request is treated as airport passenger context. The direct MACL Insights site restricts automated mirroring, so the implemented airport series uses official downloadable MBS/CAA tables. Source dates, scopes, missing inputs and reuse status remain visible in the panel. Each provider retains the last validated snapshot within the running server if a replacement fails. See [Sea & air source review](docs/transport-context.md).

## Design and licenses

Custom SVG transport pictograms and illustrated controls accompany the MapLibre atlas. The view tabs adapt [useLayouts](https://uselayouts.com/docs/components/) into Svelte. A [Rare UI](https://www.rareui.com/) duration-picker adaptation remains available in the component library; the main editor uses a direct frequency slider. Required credits and full licenses are in the Evidence drawer and `docs/licenses/`. OSM attribution and ODbL qualifications are retained.

The select/preview/build flow takes interaction lessons from [Cities: Skylines II's transport tools](https://www.paradoxinteractive.com/games/cities-skylines-ii/features/public-cargo-transportation) and [Transport Fever 2's station placement](https://www.wiki.transportfever2.com/doku.php?id=gamemanual:stationsdepots). These interfaces do not validate the local transport model.

The local atlas is the default and works without upstream map services. The map appearance menu adds [OpenFreeMap Positron](https://openfreemap.org/quick_start/) streets and labels without a key. Satellite also works without a key or signup using EOX's 2020/2025 Sentinel-2 mosaics at 10 m resolution. They are free for noncommercial use under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/), with visible provider credits; commercial use needs a separate license. The year identifies the mosaic, not a single image acquisition date. See [EOX pricing and reuse terms](https://cloudless.eox.at/pricing).

Optional `VITE_MAPTILER_KEY` in `.env` selects MapTiler for the default satellite view; selecting an explicit 2020/2025 mosaic uses EOX regardless of that key. Restrict this public browser key by domain and verify the provider's current license/plan before deployment. MapTiler imagery dates vary. Public policy briefs always capture the local atlas; they do not export satellite imagery. Online choices require connectivity and fall back to the local atlas on failure.
