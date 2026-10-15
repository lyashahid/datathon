"""Reproduce cold/warm public API timings without touching the shared database."""

from __future__ import annotations

import asyncio
import gzip
import json
import sys
import time
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402


async def main() -> None:
    started = time.perf_counter()
    from app.config.settings import Settings
    from app.main import create_app

    app = create_app(Settings(environment="test", vela_browser_enabled=False))
    results = {"import_and_create_app_ms": round((time.perf_counter() - started) * 1000, 2)}
    with TemporaryDirectory(prefix="mobility-benchmark-") as temporary:
        app.state.computed_cache.root = Path(temporary) / "cache"
        started = time.perf_counter()
        async with app.router.lifespan_context(app):
            results["startup_load_ms"] = round((time.perf_counter() - started) * 1000, 2)
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://benchmark.local",
                headers={"accept-encoding": "identity"},
            ) as client:
                for name, url in (
                    ("map_full", "/api/v1/map/features"),
                    ("map_country", "/api/v1/map/features?layer=islands&simplify_m=25"),
                    ("scores_full", "/api/v1/accessibility/summary"),
                    ("scores_country", "/api/v1/accessibility/summary?compact=true"),
                    ("profile_1442", "/api/v1/islands/island:1442/profile"),
                    ("planning_baseline", "/api/v1/planning/baseline?island_id=island%3A1443"),
                    (
                        "planning_opportunities",
                        "/api/v1/planning/opportunities?include_geometry=false",
                    ),
                    ("history", "/api/v1/forecasts?history_only=true"),
                    ("forecast", "/api/v1/forecasts"),
                    ("analysis", "/api/v1/forecasts/analysis"),
                ):
                    started = time.perf_counter()
                    response = await client.get(url)
                    response.raise_for_status()
                    cold = (time.perf_counter() - started) * 1000
                    started = time.perf_counter()
                    repeat = await client.get(url)
                    repeat.raise_for_status()
                    warm = (time.perf_counter() - started) * 1000
                    row = {
                        "cold_ms": round(cold, 2),
                        "repeat_ms": round(warm, 2),
                        "bytes": len(response.content),
                        "gzip_bytes": len(gzip.compress(response.content, compresslevel=5)),
                    }
                    app.state.computed_cache._memory.clear()
                    app.state.computed_cache._memory_size = 0
                    app.state.computed_cache._shareable_keys.clear()
                    started = time.perf_counter()
                    disk_response = await client.get(url)
                    disk_response.raise_for_status()
                    row["local_disk_ms"] = round((time.perf_counter() - started) * 1000, 2)
                    if etag := response.headers.get("etag"):
                        started = time.perf_counter()
                        unchanged = await client.get(url, headers={"if-none-match": etag})
                        assert unchanged.status_code == 304
                        row["revalidate_ms"] = round((time.perf_counter() - started) * 1000, 2)
                    results[name] = row
                from app.planning.models import PlanningRequest
                from app.planning.service import PlanningService

                for island, planning_id in (("1443", "male"), ("1442", "hulhumale")):
                    origin = next(
                        row
                        for row in app.state.planning.repository.baseline["origins"]
                        if row["islandId"] == planning_id
                    )
                    for action in (None, "add_stop", "add_school"):
                        request = PlanningRequest(
                            island_id=f"island:{island}",
                            assumptions={"include_world": False, "include_journey_geometry": False},
                            operations=[]
                            if action is None
                            else [
                                {
                                    "type": action,
                                    "name": "Benchmark",
                                    "island_id": f"island:{island}",
                                    "coordinates": origin["coordinate"],
                                }
                            ],
                        )
                        started = time.perf_counter()
                        result = app.state.planning.evaluate(request)
                        cold = (time.perf_counter() - started) * 1000
                        restarted = PlanningService(
                            app.state.planning.repository, cache=app.state.computed_cache
                        )
                        started = time.perf_counter()
                        repeated = restarted.evaluate(request)
                        assert repeated == result and not restarted._routers
                        results[f"impact_{island}_{action or 'baseline'}"] = {
                            "cold_ms": round(cold, 2),
                            "cached_ms": round((time.perf_counter() - started) * 1000, 2),
                        }
                results["cache"] = app.state.computed_cache.status()
    target = Path(__file__).resolve().parents[2] / "artifacts/qa/backend-performance-after.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
