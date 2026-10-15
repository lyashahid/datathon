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
from typing import Any

import httpx

LOGGER = logging.getLogger(__name__)


async def warm_application(
    app: Any,
    *,
    include_planning: bool = False,
    include_analysis: bool = False,
    progress: bool = False,
) -> list[dict[str, Any]]:
    reads = [
        ("country_map", "/api/v1/map/features?layer=islands&simplify_m=25"),
        ("country_scores", "/api/v1/accessibility/summary?compact=true"),
        ("country_summary", "/api/v1/national/summary"),
        ("published_history", "/api/v1/forecasts?history_only=true"),
    ]
    if include_analysis:
        reads.extend(
            [
                ("forecast", "/api/v1/forecasts"),
                ("data_analysis", "/api/v1/forecasts/analysis"),
                ("datasets", "/api/v1/datasets"),
            ]
        )
    if include_planning:
        reads.append(("opportunities", "/api/v1/planning/opportunities?include_geometry=false"))
        for island in ("1443", "1442", "1382"):
            reads.extend(
                [
                    (
                        f"baseline_{island}",
                        f"/api/v1/planning/baseline?island_id=island%3A{island}",
                    ),
                    (f"gaps_{island}", f"/api/v1/planning/opportunities/island%3A{island}"),
                    (f"profile_{island}", f"/api/v1/islands/island%3A{island}/profile"),
                ]
            )
    results = []
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://precompute.local",
        headers={"accept-encoding": "identity"},
        timeout=120,
    ) as client:
        for name, url in reads:
            started = time.perf_counter()
            response = await client.get(url)
            response.raise_for_status()
            row = {
                "name": name,
                "ms": round((time.perf_counter() - started) * 1000, 2),
                "bytes": len(response.content),
            }
            results.append(row)
            if progress:
                print(json.dumps(row), flush=True)
        if include_planning:
            for island in ("1443", "1442", "1382"):
                for goal in ("healthcare", "education"):
                    started = time.perf_counter()
                    response = await client.post(
                        "/api/v1/planning/evaluate",
                        json={
                            "island_id": f"island:{island}",
                            "assumptions": {
                                "goal": goal,
                                "include_origin_geometry": False,
                                "include_journey_geometry": False,
                                "include_world": False,
                            },
                        },
                    )
                    response.raise_for_status()
                    row = {
                        "name": f"baseline_impact_{island}_{goal}",
                        "ms": round((time.perf_counter() - started) * 1000, 2),
                        "bytes": len(response.content),
                    }
                    results.append(row)
                    if progress:
                        print(json.dumps(row), flush=True)
    return results


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
