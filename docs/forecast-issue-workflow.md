# Monthly forecast issue and review workflow

Passenger outlook is an aggregate planning aid under **Analytics → Passenger outlook**. Choose a target month and apply it before freezing a forecast. The target's distance from each category's trusted actual cutoff determines its horizon. A current-month estimate is a nowcast; a later month is a forecast. Dashed intermediate months remain estimates. The checked source ends in June 2026 for ferry endpoints and May 2026 for bus.

## Current statistical policy

FastAPI runs `monthly-locked-selection-calibration-v4`. Nine fixed baseline/statistical methods and a selection-weighted ensemble compete at each 1–12 month horizon. Expanding fits receive only their observed prefix. Earlier origins select the policy; an independent block of 8–12 origins calibrates its range where enough history remains; six later origins evaluate the frozen choice. Horizon-dependent embargoes separate each partition's targets from the next partition's first training cutoff. Complexity must improve earlier mean absolute error by at least 5% over the best simple baseline. Later answers cannot change the policy or range.

Nominal 80% empirical ranges use an absolute-calibration-error order statistic. Small samples, serial dependence and drift prevent an assured probability statement. Measured later coverage, bias, error and baseline skill remain visible, including poor results. With insufficient independent calibration history, point forecasts remain available and empirical ranges are unavailable.

These are revised-vintage chronological diagnostics. The historical data were already explored; original publication-time vintages and release-time lags have not been reconstructed. The embargo does not resolve that uncertainty. See [the full analysis](data-analysis-and-prediction.md) for source fitness and measured results.

## Freeze and inspect

**Freeze forecast** POSTs `/api/backend/forecasts/issues`, proxied to `POST /api/v1/forecasts/issues`, with `{ "target_month": "2026-11" }` and optional `series_ids`. GET requests never issue forecasts. Read receipts through `GET /api/v1/forecasts/issues` or `/api/v1/forecasts/issues/{issue_id}`. Frozen forecasts exports the receipt JSON. The current app has no forecast-issuance CLI or score-persistence POST endpoint.

New issues live under `backend/data/metadata/forecast-issues/`. Each preserves source history/provenance, model version, policy parameters, estimates, ten candidate comparisons, chronology, diagnostic rows, range, target and actual issue timestamp. Deterministic identity combines Maldives issue day, target, source fingerprint and model version. Repeating an unchanged issue returns its first record. A temporary file and exclusive hard link prevent replacement. Integrity hashes detect changed contents; they are local checksums.

Earlier receipts in `data/public/forecast-issues/` are retained and integrity-checked with their original canonicalization. The UI labels different versions **Historical model version**. Their original selections, ranges and results belong to that historical policy and are never recomputed or described as v4 results. Create a new issue to preserve a new model/source vintage.

## Review new passenger publications

Under **Data & method**, download **Source contract**, prepare a complete JSON snapshot from the official MBS publication, then **Validate and stage**. FastAPI routes are:

- `GET /api/v1/forecasts/sources/template`: active full source contract without its runtime receipt.
- `GET /api/v1/forecasts/sources`: active receipt and staged/reviewed version summaries.
- `POST /api/v1/forecasts/sources/stage`: `{ "source": { ... } }`; validates without activating.
- `POST /api/v1/forecasts/sources/{version_id}/accept`: meaningful `review_note` and explicit `accept_revisions` when history changed.

Validation requires official HTTPS URLs and SHA-256 receipts, matching category IDs/name/mode/geography/unit, finite nonnegative counts, continuous unique months, no removal of previously observed months, a nonfuture publication date and timezone-aware checked date. The UI exposes every added month and historical previous/incoming value. Repeated new counts are flagged. Validation does not independently authenticate uploaded workbook contents: accepted versions are explicitly user-reviewed publication snapshots.

Versions and review notes live under `backend/data/metadata/passenger-sources/`; an atomic active pointer selects the reviewed source. Acceptance updates forecasts, Data Studio and analysis together. The original `data/public/prediction-source.json` and frozen forecasts stay unchanged. If the active version changes after staging, restage against its new baseline. Back up both runtime directories to retain decisions.

## Later observations

Issue GET responses score against the active checked passenger source. Missing targets remain **pending** with null actual/error. Scoring requires matching category/geography/mode/unit and a publication date later than the issue date. Same-day evidence is treated conservatively. Eligible observations receive a later-vintage score with frozen selected/baseline absolute errors and range coverage. This is not first-release accuracy.

The migration exposes dynamic scores and exports their source fingerprint/publication/checked date with the receipt. Existing historical score files remain preserved on disk. Retaining an immutable first-release actual archive is the next requirement for stronger prospective validation. No refresh, issuance or acceptance is automatically scheduled.

## Verification

```powershell
uv run --directory backend pytest tests/test_forecasts.py tests/test_datasets.py -q
npm run check
$env:MOBILITY_QA_URL = 'http://127.0.0.1:5173'
node scripts/verify-forecast-data-browser.mjs
uv run --directory backend python ../scripts/analyse-mobility-data.py
```

Tests cover partition separation, calibration independence, ensemble/complexity rules, metric arithmetic, invalid counts, immutable issuance, later-vintage scoring, import/revision validation and accepted versions reaching Data Studio. Import acceptance tests use isolated temporary directories and synthetic counts. Browser checks use real app responses.

Counts measure monthly movements, not unique residents, occupancy, peak loads, origin–destination demand or vehicle ETA. Resource decisions need dated operational observations with matching route/direction/time and capacity definitions; live snapshots cannot supply them.
