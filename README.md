# Mobility Sandbox MV

A visual policy investment simulator for Greater Malé. Select an area, edit a street-routed bus connection directly on the map, and compare people reaching healthcare or schools, journey time, investment, annual operations, and conditional emissions.

## Run locally

```sh
npm install
```

Copy `.env.example` to `.env` with `BASELINE_SOURCE=public`, then run:

```sh
npm run dev -- --host 127.0.0.1
```

Open http://127.0.0.1:5173. No API keys are required. The committed public planning bundle and all map geometry load locally; upstream portals are only needed when refreshing data. Production: `npm run build` and `npm run preview -- --host 127.0.0.1`.

The opening workflow has three tasks: explore access, test a road disruption, and compare an investment. Road closures and delays have an explicit date, time, direction and travel mode. Choose whether to maintain frequency with more vehicles or accept longer waits with a fixed fleet. Temporary disruption costs are reported separately from annual investment costs. The map retains its previous result while its local honeycomb wave and the matching calculation finish.

Expand an area's **Can they get there and back?** section to check an appointment duration and home-arrival deadline. Service playback illustrates a selected route's published or assumed timing; it is not live vehicle tracking. The optional Vilimalé service needs an explicitly entered crossing duration because its public calendar does not provide one.

`PUBLIC_DATA_ONLY=true` is the default competition profile. `ENABLE_NOTICE_AI=false` works without a key using source-linked extraction rules; optional AI requires server-side credentials and an explicitly configured model. No notice automatically changes a road. Keep the last validated operations snapshot available with `npm run data:operations`; see [operations sources and configuration](docs/operations-data.md). Planning remains local after loading; online satellite tiles and fetching a new notice require a connection.

The satellite picker can compare the published 2020 and 2025 Sentinel-2 mosaics. These are visual context, not measured congestion or development change. National population coverage is separate from Greater Malé routing. See the [demo script](docs/DEMO_SCRIPT.md) for a reproducible five-minute presentation and pinned scenario examples.

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

Novel route previews measured 557–593 ms on the implementation machine; repeated analyses reused cached results in 21–36 ms. The 250 ms novel-preview target is not yet met, and the five-person first-minute usability acceptance still needs validation. Agency demand, reliability, heat, congestion, health and employment effects remain future work where local inputs exist.

## Verification

```sh
npm run check
npm run lint
npm test
npm run build
```

See [data sources](docs/data-sources.md), [model methodology](docs/model-methodology.md), and [planning QA](docs/planning-qa.md) for provenance, formulas, independently solved examples and measured limits. Older demo/metric documentation describes the retained legacy engine rather than the public policy atlas.

## Sea & air context

The map toolbar opens a compact Sea & air panel with a searchable FollowMe boat directory, MPL vessel movements and official airport passenger tables. Boat symbols are cached observations with published timestamps, not live tracking. MPL port-call rows contain no coordinates and are never plotted as vessel positions. Airport counts describe passenger movements rather than unique people or per-flight occupancy. These observations do not enter access, cost, carbon, priority ranking or saved policy scenarios.

Both auxiliary datasets are enabled in `.env` and default to enabled if omitted:

```dotenv
ENABLE_VESSEL_DATA=true
ENABLE_FLIGHT_PASSENGER_DATA=true
FOLLOWME_API_KEY=
```

Setting either flag to `false` removes that dataset from `/api/transport-context` responses. The vessel flag controls both FollowMe and MPL. Map visibility switches only change presentation. `FOLLOWME_API_KEY` is server-only; do not use a `VITE_` or `PUBLIC_` prefix. No key is needed to view the installed local snapshot.

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

The local atlas is the default and works without upstream map services. The map appearance menu adds [OpenFreeMap Positron](https://openfreemap.org/quick_start/) streets and labels without a key. Satellite also works without a key or signup using EOX's 2025 Sentinel-2 mosaic at 10 m resolution. It is free for noncommercial use under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/), with visible provider credits; commercial use of this newer mosaic needs a separate license. The year identifies the mosaic, not a single image acquisition date. See [EOX pricing and reuse terms](https://cloudless.eox.at/pricing).

Optional `VITE_MAPTILER_KEY` in `.env` selects MapTiler satellite instead; restrict this public browser key by domain and verify the provider's current license/plan before deployment. Imagery dates vary. Public policy briefs always capture the local atlas; they do not export satellite imagery. Online choices require connectivity and fall back to the local atlas on failure.
