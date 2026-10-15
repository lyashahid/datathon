# Phase 8 prewarm and hardening

The prewarm command is the final deterministic build workflow:

```powershell
uv run python -m app.cli prewarm --all
```

It performs:

1. public-source refresh with per-source diagnostics;
2. national normalization;
3. land, marine, air, and demand graph generation;
4. default accessibility artifact generation; and
5. checksum and structural validation of required cache artifacts.

For an offline rebuild using the last-known-good raw source cache:

```powershell
uv run python -m app.cli prewarm --offline
```

The readiness report is written to:

```text
backend/data/metadata/prewarm-report.json
```

The command returns a non-zero exit code only when required artifacts or build
phases are not ready. Source refresh failures are reported as warnings when the
existing cache can still produce a valid deterministic build.
