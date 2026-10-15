"""Automatic precomputation stays complete, resilient and outside startup readiness."""

import asyncio
import json
from collections import Counter
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI, Request

from app.cli import precompute


def _recording_app(failures=None):
    """Small API substitute: exercise real ASGI requests without data or a shared DB."""
    app = FastAPI()
    calls = []
    attempts = Counter()

    @app.api_route("/{path:path}", methods=["GET", "POST"])
    async def record(request: Request):
        key = (request.method, request.url.path, request.url.query)
        attempts[key] += 1
        body = await request.json() if request.method == "POST" else None
        calls.append((key, body))
        if failures:
            response = failures(request, attempts[key])
            if response is not None:
                return response
        return {"ready": True}

    return app, calls


@pytest.mark.parametrize(
    ("include_analysis", "include_planning", "expected_count"),
    [(False, False, 4), (True, False, 7), (False, True, 20), (True, True, 23)],
)
async def test_warmup_covers_selected_work_and_all_six_planning_baselines(
    include_analysis, include_planning, expected_count
):
    app, calls = _recording_app()

    rows = await precompute.warm_application(
        app, include_analysis=include_analysis, include_planning=include_planning
    )

    assert len(rows) == len(calls) == expected_count
    assert len({row["name"] for row in rows}) == expected_count
    assert all(row["status"] == "ready" and row["attempts"] == 1 for row in rows)
    gets = {(key[1], key[2]) for key, _ in calls if key[0] == "GET"}
    assert ("/api/v1/map/features", "layer=islands&simplify_m=25") in gets
    assert ("/api/v1/accessibility/summary", "compact=true") in gets
    assert ("/api/v1/national/summary", "") in gets
    assert ("/api/v1/forecasts", "history_only=true") in gets
    assert (("/api/v1/forecasts/analysis", "") in gets) == include_analysis
    assert (("/api/v1/forecasts", "") in gets) == include_analysis
    assert (("/api/v1/datasets", "") in gets) == include_analysis
    posts = [(key, body) for key, body in calls if key[0] == "POST"]
    if include_planning:
        assert ("/api/v1/planning/opportunities", "include_geometry=false") in gets
        assert len(posts) == 6
        assert {(body["island_id"], body["assumptions"]["goal"]) for _, body in posts} == {
            (f"island:{island}", goal)
            for island in ("1443", "1442", "1382")
            for goal in ("healthcare", "education")
        }
        for key, body in posts:
            assert key[1] == "/api/v1/planning/evaluate"
            assert not body.get("operations")
            assert body["assumptions"]["include_origin_geometry"] is False
            assert body["assumptions"]["include_journey_geometry"] is False
            assert body["assumptions"]["include_world"] is False
        for island in ("1443", "1442", "1382"):
            assert ("/api/v1/planning/baseline", f"island_id=island%3A{island}") in gets
            assert (f"/api/v1/planning/opportunities/island:{island}", "") in gets
            assert (f"/api/v1/islands/island:{island}/profile", "") in gets
    else:
        assert posts == []


async def test_manual_warmup_remains_fail_fast_by_default():
    from starlette.responses import JSONResponse

    app, calls = _recording_app(lambda *_: JSONResponse({"unavailable": True}, status_code=503))

    with pytest.raises(httpx.HTTPStatusError):
        await precompute.warm_application(app)

    assert len(calls) == 1


async def test_background_sweep_isolates_failures_then_retries_each_once(caplog):
    from starlette.responses import JSONResponse

    private_detail = "private-connection-string-and-response-detail"

    def failures(request, attempt):
        if request.url.path == "/api/v1/forecasts/analysis" and attempt == 1:
            raise RuntimeError(private_detail)
        if request.url.path == "/api/v1/datasets":
            return JSONResponse({"detail": private_detail}, status_code=503)
        return None

    app, calls = _recording_app(failures)
    rows = await precompute.warm_application(
        app,
        include_analysis=True,
        include_planning=True,
        continue_on_error=True,
        retry_delay=0,
    )

    assert len(rows) == 23
    assert len(calls) == 25
    assert {key[1] for key, _ in calls[23:]} == {"/api/v1/forecasts/analysis", "/api/v1/datasets"}
    by_name = {row["name"]: row for row in rows}
    assert by_name["data_analysis"]["status"] == "ready"
    assert by_name["data_analysis"]["attempts"] == 2
    assert by_name["datasets"]["status"] == "failed"
    assert by_name["datasets"]["attempts"] == 2
    assert sum(row["status"] == "ready" for row in rows) == 22
    assert private_detail not in json.dumps(rows)
    assert private_detail not in caplog.text


async def test_cancellation_interrupts_request_without_retrying_or_continuing_sweep():
    app = FastAPI()
    calls = []
    entered, interrupted = asyncio.Event(), asyncio.Event()

    @app.get("/{path:path}")
    async def blocked(path: str):
        calls.append(path)
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            interrupted.set()

    task = asyncio.create_task(
        precompute.warm_application(
            app, include_analysis=True, include_planning=True, continue_on_error=True, retry_delay=0
        )
    )
    await asyncio.wait_for(entered.wait(), 2)
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task

    assert interrupted.is_set()
    assert calls == ["api/v1/map/features"]


def _startup_app():
    return SimpleNamespace(
        state=SimpleNamespace(computed_cache=SimpleNamespace(mirror_public_results=AsyncMock()))
    )


@pytest.mark.parametrize("failed_jobs", [[], ["datasets"]])
async def test_automatic_precompute_enables_full_sweep_and_records_result(monkeypatch, failed_jobs):
    rows = [
        {"name": f"ready_{index}", "status": "ready", "attempts": 1}
        for index in range(23 - len(failed_jobs))
    ]
    rows.extend({"name": name, "status": "failed", "attempts": 2} for name in failed_jobs)
    warm = AsyncMock(return_value=rows)
    monkeypatch.setattr(precompute, "warm_application", warm)
    app = _startup_app()

    await precompute.precompute_startup(app)

    arguments = warm.call_args.kwargs
    assert warm.call_args.args == (app,)
    assert arguments["include_analysis"] is True
    assert arguments["include_planning"] is True
    assert arguments["continue_on_error"] is True
    assert arguments["cooperative_delay"] > 0
    app.state.computed_cache.mirror_public_results.assert_awaited_once()
    assert app.state.precompute == {
        "status": "partial" if failed_jobs else "ready",
        "completed": 23 - len(failed_jobs),
        "total": 23,
        "failed_jobs": failed_jobs,
    }


async def test_cancelled_precompute_records_cancellation_and_does_not_mirror(monkeypatch):
    entered = asyncio.Event()

    async def blocked(*_, **__):
        entered.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(precompute, "warm_application", blocked)
    app = _startup_app()
    task = asyncio.create_task(precompute.precompute_startup(app))
    await asyncio.wait_for(entered.wait(), 2)
    assert app.state.precompute["status"] == "running"

    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    assert app.state.precompute["status"] == "cancelled"
    app.state.computed_cache.mirror_public_results.assert_not_awaited()


@pytest.mark.parametrize("failure_source", ["warmup", "mirror"])
async def test_unexpected_background_failure_is_reported_without_private_details(
    monkeypatch, caplog, failure_source
):
    private_detail = "private-database-credential"
    warm = AsyncMock(return_value=[{"name": "ready", "status": "ready"}])
    app = _startup_app()
    if failure_source == "warmup":
        warm.side_effect = RuntimeError(private_detail)
    else:
        app.state.computed_cache.mirror_public_results.side_effect = RuntimeError(private_detail)
    monkeypatch.setattr(precompute, "warm_application", warm)

    await precompute.precompute_startup(app)

    assert app.state.precompute["status"] == "failed"
    assert private_detail not in json.dumps(app.state.precompute)
    assert private_detail not in caplog.text


def _lifespan_app(tmp_path, monkeypatch, *, enabled=True, environment="development"):
    import app.main as main
    from app.config.settings import Settings

    @asynccontextmanager
    async def no_places(_app):
        yield

    monkeypatch.setattr(main, "places_lifespan", no_places)
    app = main.create_app(
        Settings(
            environment=environment,
            computed_cache_prewarm=enabled,
            data_dir=tmp_path / "data",
            public_data_dir=tmp_path / "public",
            database_url="",
            vela_browser_enabled=False,
        )
    )
    for name in ("repository", "routing", "accessibility", "simulation", "recommendations", "live"):
        monkeypatch.setattr(getattr(app.state, name), "reload", lambda: None)
    return app


async def test_lifespan_serves_health_while_precompute_runs_and_awaits_cancellation(
    tmp_path, monkeypatch
):
    import app.main as main

    entered, cancelled = asyncio.Event(), asyncio.Event()

    async def blocked(_app):
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    monkeypatch.setattr(main, "precompute_startup", blocked)
    app = _lifespan_app(tmp_path, monkeypatch)

    async with app.router.lifespan_context(app):
        await asyncio.wait_for(entered.wait(), 2)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await asyncio.wait_for(client.get("/health"), 2)
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        assert not cancelled.is_set()

    assert cancelled.is_set()


async def test_lifespan_shutdown_awaits_detached_cache_calculation(tmp_path, monkeypatch):
    entered, finalized = asyncio.Event(), asyncio.Event()

    async def calculate():
        entered.set()
        try:
            await asyncio.Event().wait()
        finally:
            finalized.set()

    async def blocked_warm(app, **_options):
        await app.state.computed_cache.aget_or_compute_bytes("startup-test", 1, calculate)

    # Keep the real startup wrapper, detached cache worker and shutdown sequence.
    monkeypatch.setattr(precompute, "warm_application", blocked_warm)
    app = _lifespan_app(tmp_path, monkeypatch)
    cache = app.state.computed_cache

    async with app.router.lifespan_context(app):
        await asyncio.wait_for(entered.wait(), 2)
        workers = tuple(cache._async_workers)
        flights = tuple(cache._flights.values())
        assert len(workers) == cache.status()["in_flight"] == 1
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await asyncio.wait_for(client.get("/health"), 2)
        assert response.status_code == 200
        assert not finalized.is_set()

    assert app.state.precompute["status"] == "cancelled"
    assert finalized.is_set()
    assert all(worker.done() for worker in workers)
    assert all(future.cancelled() for future in flights)
    assert not cache._async_workers
    assert cache.status()["in_flight"] == 0


@pytest.mark.parametrize(("enabled", "environment"), [(False, "development"), (True, "test")])
async def test_lifespan_respects_explicit_disable_and_test_environment(
    tmp_path, monkeypatch, enabled, environment
):
    import app.main as main

    warm = AsyncMock()
    monkeypatch.setattr(main, "precompute_startup", warm)
    app = _lifespan_app(tmp_path, monkeypatch, enabled=enabled, environment=environment)

    async with app.router.lifespan_context(app):
        await asyncio.sleep(0)

    warm.assert_not_called()
