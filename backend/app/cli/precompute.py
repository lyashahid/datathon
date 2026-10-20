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
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx
from starlette.concurrency import run_in_threadpool

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class WarmupJob:
    name: str
    url: str | None = None
    body: dict[str, Any] | None = None
    prepare: Callable[[Any], Awaitable[None]] | None = None


async def _prepare_directions(app: Any) -> None:
    from app.routing.journeys import prepare_journeys

    await run_in_threadpool(prepare_journeys, app.state.planning.repository)


def _sea_date(now: datetime | None = None) -> str:
    # Match seaServiceDate() in the website: the current date at UTC+05:00,
    # rather than the historical default accepted by the API.
    return (now or datetime.now(UTC)).astimezone(timezone(timedelta(hours=5))).date().isoformat()


def _jobs(*, include_planning: bool, include_analysis: bool) -> list[WarmupJob]:
    service_date = _sea_date()
    jobs = [
        WarmupJob("country_map", "/api/v1/map/features?layer=islands&simplify_m=25"),
        WarmupJob("country_scores", "/api/v1/accessibility/summary?compact=true"),
        WarmupJob("country_summary", "/api/v1/national/summary"),
        WarmupJob("published_history", "/api/v1/forecasts?history_only=true"),
        WarmupJob("sea_network", f"/api/v1/planning/sea-network?date={service_date}"),
        WarmupJob("air_network", f"/api/v1/planning/air-network?date={service_date}"),
    ]
    if include_planning:
        # The presenter uses the retained timetable date, rather than claiming
        # historical bus departures recur today. Warm the exact network keys.
        if service_date != "2026-10-10":
            jobs.extend(
                [
                    WarmupJob(
                        "presentation_sea_network", "/api/v1/planning/sea-network?date=2026-10-10"
                    ),
                    WarmupJob(
                        "presentation_air_network", "/api/v1/planning/air-network?date=2026-10-10"
                    ),
                ]
            )
        jobs.append(WarmupJob("directions_index", prepare=_prepare_directions))
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
            WarmupJob(
                "hulhumale_ferry_suggestion",
                "/api/v1/planning/ferry-suggestion",
                {
                    "origin_island_id": "island:1442",
                    "assumptions": {
                        "goal": "transport",
                        "target_minutes": 30,
                        "capital_budget_mvr": 50_000_000,
                        "annual_operating_budget_mvr": 12_000_000,
                        "include_origin_geometry": False,
                        "include_journey_geometry": False,
                        "include_world": False,
                    },
                    "operations": [],
                },
            )
        )
        jobs.append(
            WarmupJob("opportunities", "/api/v1/planning/opportunities?include_geometry=false")
        )
        for island in ("697", "706", "1443", "1442", "1483", "1382"):
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
                    WarmupJob(
                        f"connections_{island}",
                        f"/api/v1/planning/connectivity?origin_island_id=island%3A{island}"
                        "&date=2026-10-10",
                    ),
                ]
            )
        # Hulhulé has mapped roads, services and facilities, but no separate
        # projected resident allocation. Warm its evidence without inventing
        # resident accessibility evaluations.
        for island in ("1443", "1442", "1382"):
            for goal in ("healthcare", "education", "transport"):
                jobs.append(
                    WarmupJob(
                        f"baseline_impact_{island}_{goal}",
                        "/api/v1/planning/evaluate",
                        {
                            "island_id": f"island:{island}",
                            "assumptions": {
                                "goal": goal,
                                **({"target_minutes": 10} if goal == "transport" else {}),
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
    on_progress: Callable[[dict[str, Any]], None] | None = None,
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
                if job.prepare is not None:
                    await job.prepare(app)
                    size = 0  # Internal indexes have no serialized HTTP response.
                else:
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
            if on_progress is not None:
                on_progress(row)
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
    state = {
        "status": "running",
        "completed": 0,
        "total": len(_jobs(include_planning=True, include_analysis=True)),
        "failed_jobs": [],
    }
    app.state.precompute = state
    completed: dict[str, str] = {}

    def record_progress(row: dict[str, Any]) -> None:
        completed[row["name"]] = row["status"]
        state["completed"] = sum(status == "ready" for status in completed.values())
        state["failed_jobs"] = [name for name, status in completed.items() if status == "failed"]

    started = time.perf_counter()
    LOGGER.info("Preparing analytics and planning in the background; the app is available.")
    try:
        source_version = app.state.source_version.version()
        restored = await app.state.computed_cache.restore_public_results(source_version)
        if restored:
            LOGGER.info("Reused %d precomputed public views from the shared cache.", restored)
        results = await warm_application(
            app,
            include_planning=True,
            include_analysis=True,
            continue_on_error=True,
            cooperative_delay=0.05,
            on_progress=record_progress,
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
        await app.state.computed_cache.mirror_public_results(source_version)
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
    parser.add_argument("--ferry-suggestion-only", action="store_true")
    parser.add_argument(
        "--output", type=Path, help="Save the exact suggested-ferry response as JSON"
    )
    args = parser.parse_args()
    app = create_app(Settings(vela_browser_enabled=False, computed_cache_prewarm=False))
    async with app.router.lifespan_context(app):
        cache = app.state.computed_cache
        source_version = app.state.source_version.version()
        await cache.restore_public_results(source_version)
        if args.ferry_suggestion_only:
            job = next(
                job
                for job in _jobs(include_planning=True, include_analysis=False)
                if job.name == "hulhumale_ferry_suggestion"
            )
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://precompute.local"
            ) as client:
                response = await client.post(job.url, json=job.body, timeout=120)
                response.raise_for_status()
                result = response.json()
            if args.output:
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(
                    json.dumps(result, ensure_ascii=False, indent=2), encoding="utf8"
                )
            await cache.mirror_public_results(source_version)
            print(
                json.dumps(
                    {
                        "precomputed_views": 1,
                        "status": result["status"],
                        "request_fingerprint": result.get("request_fingerprint"),
                        "output": str(args.output) if args.output else None,
                        "cache": cache.status(),
                    }
                ),
                flush=True,
            )
            return
        results = await warm_application(
            app,
            include_planning=args.include_planning,
            include_analysis=not args.skip_analysis,
            progress=True,
        )
        await cache.mirror_public_results(source_version)
        print(json.dumps({"precomputed_views": len(results), "cache": cache.status()}), flush=True)


if __name__ == "__main__":
    asyncio.run(main())
