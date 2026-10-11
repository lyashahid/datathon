# Monthly forecast issue and review workflow

The map's passenger outlook is an exploratory aggregate planning aid. Select a target month explicitly. October 2026 is a **nowcast of the current month**, despite four months from the ferry actual cutoff and five from the bus cutoff. November is a future forecast at five/six months respectively. Dashed intermediate months are estimates; they do not fill missing actuals. Unsupported horizons fail visibly.

## Freeze before evaluating

The **Freeze issue** button makes a deliberate POST to `/api/prediction/issues`. GET requests never issue forecasts. The CLI offers the same operation:

```powershell
node scripts/issue-monthly-forecast.mjs 2026-11
```

Each issue in `data/public/forecast-issues/` preserves all three source-defined categories, their monthly history and actual cutoffs, the selected method and four target-specific baseline estimates, retrospective diagnostics, range, target kind, actual issue timestamp, model/transform version, checked date, latest known publication date, and the four original workbook SHA-256 receipts and publication-sheet labels. A separate fingerprint covers the prepared monthly series plus provenance; unrelated private bus-capture receipts do not change it.

The identity is deterministic for the Maldives issue day, target, monthly source fingerprint and model version. Repeated or concurrent requests return the original complete record. Writing uses a temporary file and an exclusive hard link; an existing issue is never replaced. Integrity hashes detect accidental changes, but are **not a trusted third-party signature**. A model change requires a new declared model version. If source preparation changes, record a new transform version and changed source receipts.

Deployment needs persistent writable storage for this directory and controlled access to issuance; an ephemeral/serverless disk cannot preserve this workflow. Back up the issue and score directories. The current local competition prototype has no authenticated operator roles; do not expose unrestricted issuance as an agency production service. No periodic capture, refresh, issuance or scoring is scheduled.

## Retrospective checks are not prospective validation

Model selection uses earlier expanding reference-month origins, with a horizon-dependent embargo so selected outcomes do not extend beyond the first later evaluation origin. Six later origins measure MAE and WAPE. However, the history was previously explored and uses the currently checked revised workbooks. Original publication-time availability and all historical revisions were not reconstructed. The embargo therefore does not resolve publication lag or revision-vintage bias.

For the checked October target:

| Category              | Selected method |       MAE |     WAPE | Latest-month benchmark WAPE | Range covered |
| --------------------- | --------------- | --------: | -------: | --------------------------: | ------------: |
| Male' (VM Ferry)      | Six-month mean  | 10,899.08 |  4.8182% |                     6.6230% |         2 / 6 |
| Villigili' (VM Ferry) | Six-month mean  | 11,316.67 |  4.9780% |                     6.5994% |         2 / 6 |
| Male'/Hulhumale bus   | Seasonal naive  | 36,925.17 | 12.3298% |                     4.8259% |         3 / 6 |

The selected bus method loses to **all three other tested methods** on these later origins. Do not retune on these outcomes and call the same rows independent validation. The 10th–90th earlier-residual ranges have poor later coverage; they are neither calibrated probability intervals nor assured budget bounds. The presentation defaults to source order rather than choosing its headline using the lowest later error.

Performance changes with the selected target horizon. The real November issue frozen on 11 October 2026 chooses a three-month mean for each ferry and seasonal naive for the bus. All three selected methods lose to the latest-month benchmark at that horizon: Malé WAPE 6.1710% versus 6.0754%; Villigili 6.5250% versus 5.9700%; bus 12.3298% versus 9.5639%. These are historical horizon-specific comparisons, not measured November outcomes. Its scores are pending.

## Later actuals and revisions

GET `/api/prediction/issues` shows each frozen issue and its score status against the currently loaded checked monthly source. Target observations not yet in that source stay **pending** with null actual/error. Scoring requires matching category name, geography and unit and a checked publication dated after the actual issue timestamp. Date-only publication evidence is treated conservatively from midnight; a same-day release cannot prove that its actual was unavailable at the issue instant.

An eligible observation produces a **later-vintage score**: absolute error for the frozen selected estimate and each frozen benchmark, plus range coverage. This is an issuance-before-later-publication comparison. It is not a claim that the observed value is the first official release or that one issue establishes general forecast accuracy. The code cannot recover a missed first release from later revised workbooks.

When checked eligible actuals exist, **Preserve this later-vintage score receipt** appends a separate receipt under `data/public/forecast-issues/scores/`, pinned to the actual-source fingerprint/publication/checked timestamp and the unchanged original issue. The equivalent CLI is:

```powershell
node scripts/issue-monthly-forecast.mjs ISSUE_ID score
```

Pending scores cannot be recorded. Repeating the same scoring vintage preserves its first receipt. A newly checked actual vintage creates a new receipt; previous scores remain inspectable through the GET API. Do not overwrite the issued forecast or earlier actual-vintage scores when values change. Claims about first-release accuracy require a separate documented complete release archive, which this prototype does not have.

## Operator-owned decision

The resource review captures an accountable reviewer/team, explicit decision purpose, review date, operator-entered consequences of over/under-planning and a checklist. **Prepare review record** shows the accountable owner, completed checks and next evidence requests in the app; downloading is optional. The session record is not permanently stored, so download it to retain a copy. Downloaded JSON carries source provenance, selected estimate and benchmark estimates, completed checks and outstanding evidence. Changing series or target resets evidence checks and scope-specific date/cost inputs. This record prepares a review; it is not an approval to change services.

Before changing resources, MTCC/RTL planners need category reconciliation, current route/direction/peak-period loads, fleet/staffing availability, costs and lead time. MBS can review the statistical definitions and publication trail. No passengers-per-bus, peak load, unique people, terminal boarding direction, street demand or congestion is inferred from these monthly counts. **Show this geography on map** delegates to the shared atlas context; these aggregates cannot be allocated to individual streets or hexagons.

## Verification

```powershell
npx vitest run src/lib/prediction src/lib/server/data/predictionSource.test.ts src/lib/server/data/predictionSourceLedger.test.ts
npm run check
```

Tests independently recompute six-row MAE/WAPE and historical range coverage from published-source backtest rows, verify frozen benchmark arithmetic, explicit horizons and nowcast labeling, chronology/no future evidence, pending and mismatched categories, concurrent never-overwrite issuance, integrity rejection and append-only later-vintage scoring. Future actuals used in workflow tests are synthetic fixtures only; no test actuals are written into the public source or issue ledger.
