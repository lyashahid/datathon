"""Precompute canonical country, analytics and island planning views.

Run ``uv run --directory backend python -m app.cli.precompute --include-planning``.
Source/version keys are identical to the API, and all writes remain in runtime
cache storage or the optional application-owned PostgreSQL cache table.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import time
from dataclasses import dataclass
from typing import Any

import httpx

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class WarmupJob:
    name: str
    url: str
    body: dict[str, Any] | None = None


def _jobs(*, include_planning: bool, include_analysis: bool) -> list[WarmupJob]:
    jobs = [
        WarmupJob("country_map", "/api/v1/map/features?layer=islands&simplify_m=25"),
        WarmupJob("country_scores", "/api/v1/accessibility/summary?compact=true"),
        WarmupJob("country_summary", "/api/v1/national/summary"),
        WarmupJob("published_history", "/api/v1/forecasts?history_only=true"),
    ]
    if include_analysis:
        jobs.extend(
            [
                WarmupJob("forecast", "/api/v1/forecasts"),
                WarmupJob("data_analysis", "/api/v1/forecasts/analysis"),
                WarmupJob("datasets", "/api/v1/datasets"),
            ]
        )
    if include_planning:
        jobs.append(
            WarmupJob("opportunities", "/api/v1/planning/opportunities?include_geometry=false")
        )
        for island in ("1443", "1442", "1382"):
            jobs.extend(
                [
                    WarmupJob(
                        f"baseline_{island}",
                        f"/api/v1/planning/baseline?island_id=island%3A{island}",
                    ),
                    WarmupJob(
                        f"gaps_{island}", f"/api/v1/planning/opportunities/island%3A{island}"
                    ),
                    WarmupJob(f"profile_{island}", f"/api/v1/islands/island%3A{island}/profile"),
                ]
            )
        for island in ("1443", "1442", "1382"):
            for goal in ("healthcare", "education"):
                jobs.append(
                    WarmupJob(
                        f"baseline_impact_{island}_{goal}",
                        "/api/v1/planning/evaluate",
                        {
                            "island_id": f"island:{island}",
                            "assumptions": {
                                "goal": goal,
                                "include_origin_geometry": False,
                                "include_journey_geometry": False,
                                "include_world": False,
                            },
                        },
                    )
                )
    return jobs


async def warm_application(
    app: Any,
    *,
    include_planning: bool = False,
    include_analysis: bool = False,
    progress: bool = False,
    continue_on_error: bool = False,
    cooperative_delay: float = 0.0,
    retry_delay: float = 1.0,
) -> list[dict[str, Any]]:
    """Warm API-identical results sequentially, without parallel CPU bursts.

    The maintenance command fails on errors. Automatic startup instead completes
    independent jobs and retries only failures once after the first sweep.
    """
    jobs = _jobs(include_planning=include_planning, include_analysis=include_analysis)
    results = []
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://precompute.local",
        headers={"accept-encoding": "identity"},
        timeout=120,
    ) as client:

        async def run(job: WarmupJob, attempt: int) -> dict[str, Any]:
            started = time.perf_counter()
            try:
                response = await client.request(
                    "POST" if job.body is not None else "GET", job.url, json=job.body
                )
                response.raise_for_status()
                size = len(response.content)
                status = "ready"
            except Exception:
                if not continue_on_error:
                    raise
                # Provider/database errors can contain private URLs or payloads.
                LOGGER.warning("Precomputation unavailable for %s (attempt %d)", job.name, attempt)
                size, status = 0, "failed"
            row = {
                "name": job.name,
                "status": status,
                "attempts": attempt,
                "ms": round((time.perf_counter() - started) * 1000, 2),
                "bytes": size,
            }
            if progress:
                print(json.dumps(row), flush=True)
            # Give interactive requests a scheduling opportunity between jobs.
            await asyncio.sleep(cooperative_delay)
            return row

        for job in jobs:
            results.append(await run(job, 1))
        failed = [index for index, row in enumerate(results) if row["status"] == "failed"]
        if failed:
            await asyncio.sleep(retry_delay)
            for index in failed:
                results[index] = await run(jobs[index], 2)
    return results


async def precompute_startup(app: Any) -> None:
    """Prepare all supported defaults after startup; availability never waits."""
    state = {"status": "running", "completed": 0, "total": 23, "failed_jobs": []}
    app.state.precompute = state
    started = time.perf_counter()
    LOGGER.info("Preparing analytics and planning in the background; the app is available.")
    try:
        results = await warm_application(
            app,
            include_planning=True,
            include_analysis=True,
            continue_on_error=True,
            cooperative_delay=0.05,
        )
        failed = [row["name"] for row in results if row["status"] == "failed"]
        state.update(
            status="partial" if failed else "ready",
            completed=len(results) - len(failed),
            total=len(results),
            failed_jobs=failed,
        )
        LOGGER.info(
            "Background precomputation finished: %d/%d views ready in %.1f seconds.",
            state["completed"],
            state["total"],
            time.perf_counter() - started,
        )
        # Mirror local hits too. The database worker and its bounded wait stay
        # outside the app's startup/readiness path.
        await app.state.computed_cache.mirror_public_results()
    except asyncio.CancelledError:
        state["status"] = "cancelled"
        raise
    except Exception:
        state["status"] = "failed"
        LOGGER.warning("Background precomputation stopped; requests still calculate on demand.")


async def main() -> None:
    from app.config.settings import Settings
    from app.main import create_app

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--include-planning", action="store_true")
    parser.add_argument("--skip-analysis", action="store_true")
    args = parser.parse_args()
    app = create_app(Settings(vela_browser_enabled=False, computed_cache_prewarm=False))
    async with app.router.lifespan_context(app):
        results = await warm_application(
            app,
            include_planning=args.include_planning,
            include_analysis=not args.skip_analysis,
            progress=True,
        )
        cache = app.state.computed_cache
        await cache.mirror_public_results()
        print(json.dumps({"precomputed_views": len(results), "cache": cache.status()}), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
