# Vela standalone REST API

A self-contained Python service for six Vela-derived features: place search, place details, photos, reviews, directions, and Street View. Autocomplete and an image proxy are also included. Other applications call this service over HTTP; they do not need Android, Gradle, the original Vela checkout, or the Datathon project.

This is a new REST facade. Original Vela is an Android application and does not expose these REST routes. The adapters call undocumented Google Maps consumer endpoints with an anonymous session and a bundled version 26 calibration snapshot. They do not use the official Google Places, Routes, or Street View APIs and do not require a Google API key. Upstream layouts, response positions, session behavior, and availability can change. Response completeness is always `unknown` or `limited`.

## Run locally

Use Python 3.12 or newer. Run these commands from this project's root.

**Bash**

```bash
python3 -m venv .venv
. .venv/bin/activate
python -m pip install .
vela-api --host 127.0.0.1 --port 8000
```

**PowerShell**

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install .
.\.venv\Scripts\vela-api.exe --host 127.0.0.1 --port 8000
```

Open [Swagger UI](http://127.0.0.1:8000/docs), [ReDoc](http://127.0.0.1:8000/redoc), or the [live OpenAPI document](http://127.0.0.1:8000/openapi.json). `/health` reports process readiness; it does not contact Google.

Local authentication is optional. Set `VELA_API_KEY` to require the `X-API-Key` header on every `/v1` request. This is your service's caller key, not a Google credential. The CLI requires a nonempty key when binding an address other than `127.0.0.1`, `localhost`, or `::1`.

```bash
export VELA_API_KEY='replace-with-a-long-random-secret'
vela-api --host 0.0.0.0 --port 8000
```

```powershell
$env:VELA_API_KEY = 'replace-with-a-long-random-secret'
.\.venv\Scripts\vela-api.exe --host 0.0.0.0 --port 8000
```

Python launch reads the process environment. It does **not** load `.env` automatically. The CLI binding guard is not applied if you bypass the CLI and launch Uvicorn directly. Public exposure also needs your deployment's HTTPS and access policy. `/health`, `/docs`, `/redoc`, and `/openapi.json` are public.

## Try it

In a second terminal, optionally set `VELA_API_KEY` to the same value as the server.

**Bash**

```bash
curl --fail-with-body --get 'http://127.0.0.1:8000/v1/search' \
  -H "X-API-Key: ${VELA_API_KEY:-}" \
  --data-urlencode 'query=coffee' \
  --data-urlencode 'latitude=37.7749' \
  --data-urlencode 'longitude=-122.4194'
```

**PowerShell**

```powershell
$apiHeaders = @()
if ($env:VELA_API_KEY) { $apiHeaders = @('-H', "X-API-Key: $env:VELA_API_KEY") }
curl.exe --fail-with-body @apiHeaders --get 'http://127.0.0.1:8000/v1/search' `
  --data-urlencode 'query=coffee' `
  --data-urlencode 'latitude=37.7749' `
  --data-urlencode 'longitude=-122.4194'
```

[API documentation](docs/API.md) describes every endpoint, fields, errors, and copyable Bash/PowerShell cURL commands. [Python](examples/client.py) and [Node.js](examples/client.mjs) clients build a stateless details request from an actual search result:

```bash
python examples/client.py --query coffee
node examples/client.mjs coffee
```

In PowerShell, use `.\.venv\Scripts\python.exe examples/client.py --query coffee` for the installed Python environment. The Node client needs Node.js 18 or newer. Add `--all` to either client for suggestions, photos, reviews, directions, and Street View; add `--browser` to use the optional browser reviews backend. Python's `--download-dir downloads` or Node's `--download-media` additionally saves a first photo/tile when available. Without `--all`, the examples perform search and strict details only.

The clients read `VELA_BASE_URL` (default `http://127.0.0.1:8000`) and `VELA_API_KEY`. Run clients on your server if a key must remain private; do not embed a shared secret in frontend code. No real secrets are included in this project.

## Optional browser reviews

Native reviews use Google's limited `qv9Egd` consumer feed. Their continuation cursor is unverified. A browser backend can extract visible review cards using headless Chromium, but also reports limited completeness and supports no pagination.

Install the optional extra and Chromium, then enable it before starting the service. [Playwright's installation instructions](https://playwright.dev/python/docs/intro) describe browser and platform dependencies.

**Bash**

```bash
python -m pip install '.[browser]'
python -m playwright install chromium
export VELA_BROWSER_ENABLED=true
vela-api --host 127.0.0.1 --port 8000
```

**PowerShell**

```powershell
.\.venv\Scripts\python.exe -m pip install '.[browser]'
.\.venv\Scripts\python.exe -m playwright install chromium
$env:VELA_BROWSER_ENABLED = 'true'
.\.venv\Scripts\vela-api.exe --host 127.0.0.1 --port 8000
```

On Linux, browser system libraries may also require `python -m playwright install --with-deps chromium`. The Docker browser target installs them. Browser requests share one anonymous process-local Chromium context, use a fresh page for each lookup, and are serialized with a 50-second deadline that includes queue wait. Google consent or verification challenges can prevent extraction; the service does not sign in or solve challenges.

## Docker Compose

Use Docker with Linux containers and Compose v2. No host Python installation is needed. For a new checkout, copy `.env.example` to `.env` once and replace its key before launching. Compose loads `.env`; a direct Python launch does not. The Docker image listens on container port 8000 and requires the service key.

```bash
cp .env.example .env
# Edit .env and replace VELA_API_KEY.
docker compose config --quiet
docker compose up --build --wait --wait-timeout 180
docker compose ps
curl --fail-with-body 'http://127.0.0.1:8000/health'
```

```powershell
Copy-Item .env.example .env
# Edit .env and replace VELA_API_KEY.
docker compose config --quiet
docker compose up --build --wait --wait-timeout 180
docker compose ps
curl.exe --fail-with-body 'http://127.0.0.1:8000/health'
```

The default `native` target publishes `127.0.0.1:8000`. `VELA_BIND_ADDRESS` and `VELA_PORT` change the host interface/port; the internal port remains 8000. All documented application configuration overrides are forwarded by Compose. To enable the larger `browser` target:

```bash
docker compose -f compose.yaml -f compose.browser.yaml up --build --wait --wait-timeout 180
```

The same command works in PowerShell. Both images run as a nonroot user and include an HTTP healthcheck. Compose uses a read-only root filesystem, a 256 MiB temporary `/tmp`, an init process, dropped Linux capabilities, and a 120-second stop grace period. The browser override supplies 1 GiB of shared memory. Health only checks the service's local endpoint. `docker compose down` stops the default deployment; include both `-f` arguments when stopping the browser deployment. Container state is ephemeral.

See [Docker deployment](docs/DOCKER.md) for native/browser image builds, direct `docker run` commands, PowerShell examples, configuration, logs, updates, and smoke tests. It also covers the optional network override for exhausted Docker address pools. The [Docker workflow](.github/workflows/docker.yml) builds and checks both targets from source; this project does not publish a container image to a registry.

## Configuration and limits

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `VELA_BIND_ADDRESS` | `127.0.0.1` | Compose host publication interface; ignored by direct Python launch. |
| `VELA_PORT` | `8000` | Compose host port mapped to container port 8000; Python launch uses `--port`. |
| `VELA_API_KEY` | empty | Optional local caller authentication; required by the CLI for an external bind and by Compose. |
| `VELA_BROWSER_ENABLED` | `false` | Enables the browser reviews backend; also requires the browser extra and Chromium. |
| `VELA_CORS_ORIGINS` | empty | Comma-separated exact origins; configured methods are GET and POST. |
| `VELA_REQUEST_TIMEOUT` | `25` | Upstream whole-call deadline in seconds; range 1–60. |
| `VELA_MAX_CONCURRENT_REQUESTS` | `8` | HTTP upstream concurrency; range 1–64. |
| `VELA_RATE_LIMIT_PER_MINUTE` | `60` | Per-client-IP sliding-minute service limit; minimum 1. |
| `VELA_CACHE_TTL` | `120` | JSON response cache lifetime in seconds; 0 disables this cache. |

Each process has a 256-entry JSON cache, a 1,024-entry place-context cache lasting six hours, a bounded 1,024-client limiter, and independent HTTP/browser sessions. Authentication and rate limiting run before cache lookup. Restarting loses these states. Multiple workers do not share them; these are not distributed production quotas or durable place storage.

Request bodies are limited to 64 KiB. Upstream responses are bounded to 25 MiB for data and 8 MiB for images. JSON cache misses have a 55-second operation deadline; individual HTTP calls use the configured deadline. Images return raw bytes with `Cache-Control: private, max-age=120`; the server does not put image bytes in its JSON cache. CLI HTTP access logging is disabled because URLs can contain locations and opaque tokens.

Direct runtime dependency versions are pinned: FastAPI 0.143.0, HTTPX 0.28.1, Uvicorn 0.54.0, and optional Playwright 1.63.0. Transitive dependencies and the `python:3.12-slim-bookworm` base image are not locked by digest. [FastAPI](https://fastapi.tiangolo.com/) supplies validation/OpenAPI; [HTTPX](https://www.python-httpx.org/async/) supplies the reusable asynchronous HTTP session.

## Integration boundaries

- Use POST `/v1/places/details` with the identity, name, address, and coordinates returned by search. GET `/v1/places/{place_id}` requires earlier search context on the same process. A strict identity match is required; a neighboring place is never substituted.
- Photos and reviews require the raw `feature_id` format `0xHEX:0xHEX`, not a `ChIJ…` Google place ID. Keep provider identities separate from a fallback display `id`.
- Search reads one upstream page per call. `next_offset` is a heuristic. Review `end=true`, an empty list, or a null cursor does not establish full coverage.
- Directions support driving, walking, and bicycling. Transit, Android navigation, offline routing, and guaranteed maneuver positions are not implemented. GeoJSON geometry uses `[longitude, latitude]`.
- Street View returns metadata and individual tiles. `max_zoom` counts levels; the highest valid index is `max_zoom - 1`. The tile route also checks actual dimensions. The facade does not stitch or render a panorama.

## Develop and license

```bash
python -m pip install '.[dev]'
python -m pytest
```

Tests use source-shaped fixtures and controlled transport/browser responses. Passing them does not guarantee Google will accept your IP, session, or future requests.

[Verification](docs/verification.json) and the API PDF are historical snapshots of the October 13, 2026 checks. [Docker verification](docs/docker-verification.json) records the later container checks and their exclusions; consult the actual workflow run for CI results. [Provenance](docs/provenance.json) records adapted source files. The exported facade schema is [docs/openapi.json](docs/openapi.json).

This project adapts Vela commit `3c8fc207652e7a4fabfe53089de6ccace308ac61` and is distributed under **GPL-3.0-only**. Preserve [LICENSE](LICENSE), [NOTICE](NOTICE), and source attribution when distributing derived code. The source license is separate from Google's service/content terms. Review those terms for your intended integration. The service does not fetch remote calibration or execute remote configuration scripts.
