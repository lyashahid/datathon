"""Persistent calculation correctness, bounded storage and concurrent request isolation."""

import asyncio
import json
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.snapshot_cache import SnapshotCacheMiddleware
from app.data.computed_cache import (
    ComputedCache,
    PostgresStore,
    SourceVersion,
    decode,
    encode,
    postgres_connection_options,
)
from app.forecasting.service import ForecastService
from app.planning.models import PlanningRequest
from app.planning.service import PlanningService
from tests.test_forecasts import _source
from tests.test_planning import service  # noqa: F401


def test_disk_survives_new_cache_instances_and_returns_isolated_json(tmp_path):
    cache = ComputedCache(tmp_path)
    first = cache.get_or_compute("model-v1", {"source": "a"}, lambda: {"scores": [5]})
    first["scores"].append(999)
    second = ComputedCache(tmp_path)
    assert second.get_or_compute(
        "model-v1", {"source": "a"}, lambda: pytest.fail("recomputed")
    ) == {"scores": [5]}
    assert second.status()["disk_hits"] == 1
    assert second.get_or_compute("model-v2", {"source": "a"}, lambda: {"scores": [6]}) == {
        "scores": [6]
    }
    assert second.get_or_compute("model-v1", {"source": "b"}, lambda: {"scores": [7]}) == {
        "scores": [7]
    }


def test_memory_and_disk_quotas_are_bounded_and_corruption_recomputes(tmp_path):
    cache = ComputedCache(tmp_path, memory_bytes=40, disk_bytes=160, max_entries=2)
    for number in range(20):
        cache.get_or_compute("bounded", number, lambda: {"value": "a" * 10})
    assert cache.status()["memory_entries"] <= 2
    assert cache.status()["memory_bytes"] <= 40
    assert sum(p.stat().st_size for p in cache.root.glob("*.cache")) <= 160
    target = cache.root / f"{cache.key('broken', 'a')}.cache"
    target.write_bytes(b"not a valid cache entry")
    assert cache.get_or_compute("broken", "a", lambda: {"valid": True}) == {"valid": True}
    for number in range(20):
        cache.get_or_compute("snapshot-http", number, lambda: {"value": 1})
    assert len(cache._shareable_keys) <= cache.status()["memory_entries"] <= 2
    disabled = ComputedCache(tmp_path / "disabled", memory_bytes=0, disk_bytes=0)
    for number in range(20):
        disabled.get_or_compute("snapshot-http", number, lambda: {"value": 1})
    assert not disabled._shareable_keys


def test_integrity_expiry_and_decompression_limits(monkeypatch):
    stored = encode(b'{"valid":true}')
    assert decode(stored) == b'{"valid":true}'
    assert decode(stored[:8] + b"x" * 32 + stored[40:]) is None
    assert decode(stored + b"trailing junk") is None
    now = time.time()
    monkeypatch.setattr("app.data.computed_cache.time.time", lambda: now + 8 * 86400)
    assert decode(stored) is None
    monkeypatch.setattr("app.data.computed_cache.MAX_ITEM_BYTES", 10)
    assert decode(encode(b"x" * 11)) is None


def test_single_flight_parallel_callers_only_calculate_once(tmp_path):
    cache = ComputedCache(tmp_path)
    entered = threading.Event()
    release = threading.Event()
    count = 0

    def calculate():
        nonlocal count
        count += 1
        entered.set()
        assert release.wait(5)
        return {"value": [7]}

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(cache.get_or_compute, "same", 1, calculate) for _ in range(8)]
        assert entered.wait(5)
        release.set()
        results = [future.result(5) for future in futures]
    assert count == 1
    results[0]["value"].append(999)
    assert results[1] == {"value": [7]}
    assert cache.status()["in_flight"] == 0


@pytest.mark.asyncio
async def test_async_single_flight_does_not_block_other_keys_or_cancel_shared_work(tmp_path):
    cache = ComputedCache(tmp_path)
    entered, release = asyncio.Event(), asyncio.Event()
    count = 0

    async def calculate():
        nonlocal count
        count += 1
        entered.set()
        await release.wait()
        return b"first"

    owner = asyncio.create_task(cache.aget_or_compute_bytes("a", 1, calculate))
    await asyncio.wait_for(entered.wait(), 5)
    waiter = asyncio.create_task(cache.aget_or_compute_bytes("a", 1, calculate))
    await asyncio.sleep(0)
    waiter.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiter

    async def independent():
        return b"second"

    assert await asyncio.wait_for(cache.aget_or_compute_bytes("b", 1, independent), 5) == b"second"
    release.set()
    assert await owner == b"first"
    assert count == 1


@pytest.mark.asyncio
async def test_disconnecting_first_async_caller_preserves_joined_calculation(tmp_path):
    cache = ComputedCache(tmp_path)
    entered, release = asyncio.Event(), asyncio.Event()
    calls = []

    async def calculate():
        calls.append(True)
        entered.set()
        await release.wait()
        return b"complete"

    owner = asyncio.create_task(cache.aget_or_compute_bytes("same", 1, calculate))
    await entered.wait()
    follower = asyncio.create_task(cache.aget_or_compute_bytes("same", 1, calculate))
    await asyncio.sleep(0)
    owner.cancel()
    with pytest.raises(asyncio.CancelledError):
        await owner
    release.set()
    assert await asyncio.wait_for(follower, 5) == b"complete"
    assert calls == [True]
    assert cache.status()["in_flight"] == 0


def test_failed_computation_is_not_cached_or_left_in_flight(tmp_path):
    cache = ComputedCache(tmp_path)
    with pytest.raises(ValueError):
        cache.get_or_compute("failure", 1, lambda: (_ for _ in ()).throw(ValueError("invalid")))
    assert cache.status()["in_flight"] == 0
    assert cache.get_or_compute("failure", 1, lambda: {"fixed": True}) == {"fixed": True}


def test_source_versions_are_portable_config_sensitive_and_import_aware(tmp_path):
    versions = []
    for name in ("first", "second"):
        root = tmp_path / name
        data = root / "data" / "cache" / "normalized"
        data.mkdir(parents=True)
        (data / "example.json").write_text('{"value":1}')
        versions.append(SourceVersion(root / "data", root / "public", configuration={"weight": 1}))
    assert versions[0].version() == versions[1].version()
    other = SourceVersion(
        tmp_path / "first/data", tmp_path / "first/public", configuration={"weight": 2}
    )
    assert other.version() != versions[0].version()
    previous = versions[0].version()
    pointer = tmp_path / "first/data/metadata/passenger-sources/active.json"
    pointer.parent.mkdir(parents=True)
    pointer.write_text('{"versionId":"reviewed-v2"}')
    assert versions[0].version() != previous
    previous = versions[0].version(dynamic=True)
    (tmp_path / "first/data/cache/normalized/example.json").write_text('{"value":2}')
    assert versions[0].version(dynamic=True) != previous


def test_postgres_options_remove_prisma_schema_enforce_tls_and_timeouts():
    url, options = postgres_connection_options(
        "postgresql://user:example@db.example.invalid/cache?schema=mobility&sslmode=disable"
    )
    assert "schema=" not in url and "sslmode=require" in url
    assert options["connect_timeout"] == 2
    assert "search_path=mobility" in options["options"]
    assert "statement_timeout=750" in options["options"]
    with pytest.raises(ValueError):
        postgres_connection_options("postgresql://db.invalid/cache?schema=bad%3Bdrop")


def test_database_failure_uses_circuit_breaker_without_leaking_connection_details(
    tmp_path, monkeypatch, caplog
):
    store = PostgresStore("not-a-real-database-secret")
    calls = 0

    def unavailable():
        nonlocal calls
        calls += 1
        raise RuntimeError("not-a-real-database-secret")

    monkeypatch.setattr(store, "_connect", unavailable)
    store.read("first")
    store._queue.join()
    assert store.read("second") is None
    assert calls == 1
    assert store.status()["fallback"] is True
    assert "not-a-real-database-secret" not in caplog.text
    store.close()


def test_remote_lookup_has_small_wait_budget_and_hydrates_late_results(monkeypatch):
    store = PostgresStore("unused")
    release = threading.Event()
    values = []

    def delayed(_):
        assert release.wait(5)
        return b"shared"

    monkeypatch.setattr(store, "_read", delayed)
    started = time.perf_counter()
    assert store.read("a", values.append) is None
    assert time.perf_counter() - started < 0.25
    release.set()
    store._queue.join()
    assert values == [b"shared"]
    store.close()


def _http_app(tmp_path, counter):
    app = FastAPI()
    source = SourceVersion(tmp_path / "data", tmp_path / "public")
    app.add_middleware(SnapshotCacheMiddleware, cache=ComputedCache(tmp_path), source=source)

    @app.get("/api/v1/national/summary")
    def snapshot():
        counter.append("static")
        return {"result": len(counter)}

    @app.get("/api/v1/live/snapshot")
    def live():
        counter.append("live")
        return {"result": len(counter)}

    return app


def test_snapshot_etag_304_disk_reuse_and_live_auth_bypass(tmp_path):
    calls = []
    with TestClient(_http_app(tmp_path, calls)) as client:
        response = client.get("/api/v1/national/summary")
        assert response.status_code == 200
        assert response.headers["cache-control"] == "private, max-age=0, must-revalidate"
        etag = response.headers["etag"]
        unchanged = client.get("/api/v1/national/summary", headers={"if-none-match": etag})
        assert unchanged.status_code == 304 and unchanged.content == b""
        assert calls == ["static"]
        client.get("/api/v1/live/snapshot")
        client.get("/api/v1/live/snapshot")
        client.get("/api/v1/national/summary", headers={"authorization": "Bearer test"})
        client.get("/api/v1/national/summary", headers={"cookie": "session=test"})
        assert calls == ["static", "live", "live", "static", "static"]
    calls.clear()
    with TestClient(_http_app(tmp_path, calls)) as client:
        assert client.get("/api/v1/national/summary").json() == {"result": 1}
    assert calls == []


def test_planning_persistence_keys_all_assumptions_source_content_and_flags(service, tmp_path):  # noqa: F811
    request = PlanningRequest(assumptions={"departure_minutes": 470})
    cache = ComputedCache(tmp_path / "computed")
    cached = PlanningService(service.repository, cache=cache)
    first = cached.evaluate(request)
    first["origins"][0]["before"]["minutes"] = 9999
    restarted = PlanningService(service.repository, cache=ComputedCache(tmp_path / "computed"))
    assert restarted.evaluate(request) == service.evaluate(request)
    assert not restarted._routers  # Loaded exact complete result; no graph search.
    service.repository.baseline["origins"][0]["population2026"] += 10
    changed = restarted.evaluate(request)
    assert changed["summary"]["population"] == first["summary"]["population"] + 10
    compact = request.model_copy(
        update={
            "assumptions": request.assumptions.model_copy(
                update={"include_world": False, "include_journey_geometry": False}
            )
        }
    )
    result = restarted.evaluate(compact)
    assert result["world"] == {"facilities": [], "stops": [], "patterns": []}
    assert all(origin["before"]["geometry"] == [] for origin in result["origins"])
    assert restarted.evaluate(request)["world"]["facilities"]


def test_forecast_result_persistence_tracks_target_source_and_returns_fresh_response_time(
    tmp_path, monkeypatch
):
    public = tmp_path / "public"
    source = _source(public)
    cache = ComputedCache(tmp_path / "cache")
    forecasts = ForecastService(public, tmp_path / "data", cache=cache)
    result = forecasts.bundle("2026-02")
    restarted = ForecastService(public, tmp_path / "data", cache=ComputedCache(tmp_path / "cache"))
    monkeypatch.setattr(
        "app.forecasting.service.forecast_series", lambda *_: pytest.fail("recomputed")
    )
    later = restarted.bundle("2026-02")
    assert result["monthly"] == later["monthly"]
    assert result["generatedAt"] != later["generatedAt"]
    with pytest.raises(pytest.fail.Exception):
        restarted.bundle("2026-03")
    source["series"][0]["points"][-1]["value"] += 1
    (public / "prediction-source.json").write_text(json.dumps(source))
    with pytest.raises(pytest.fail.Exception):
        restarted.bundle("2026-02")


def test_published_history_never_fits_prediction_models(tmp_path, monkeypatch):
    public = tmp_path / "public"
    source = _source(public)
    forecasts = ForecastService(public, tmp_path / "data")
    monkeypatch.setattr(
        "app.forecasting.service.forecast_series", lambda *_: pytest.fail("model fit")
    )
    result = forecasts.history_bundle()
    assert result["representation"] == "history_only"
    assert result["monthly"][0]["history"] == source["series"][0]["points"]
    assert result["provenance"]["latestPublicationDate"] == "2026-01-09"


def test_only_public_namespaces_mirror_to_database(tmp_path, monkeypatch):
    cache = ComputedCache(tmp_path, database_url="unused")
    mirrored = []
    monkeypatch.setattr(cache.shared, "read", lambda *_: None)
    monkeypatch.setattr(cache.shared, "enqueue", lambda key, payload: mirrored.append(key))
    cache.get_or_compute("planning-evaluation", {"private": "draft"}, lambda: {"budget": 100})
    cache.get_or_compute("snapshot-http", {"country": True}, lambda: {"score": 50})
    assert mirrored == [cache.key("snapshot-http", {"country": True})]
    cache.close()


def test_compact_country_data_preserves_scores_and_full_profile_reasons(tmp_path):
    from app.config.settings import Settings
    from app.main import create_app
    from tests.test_national_api import _write_fixture_data

    _write_fixture_data(tmp_path / "data")
    app = create_app(
        Settings(
            environment="test", data_dir=tmp_path / "data", public_data_dir=tmp_path / "public"
        )
    )
    assert (
        app.state.computed_cache.shared is None
    )  # Local dotenv must never reach the real DB in tests.
    with TestClient(app) as client:
        full = client.get("/api/v1/accessibility/summary").json()
        compact = client.get("/api/v1/accessibility/summary?compact=true").json()
        profile = client.get("/api/v1/islands/island:1/profile").json()
    assert compact["summary"] == full["summary"]
    assert compact["scores"][0]["score"] == full["scores"][0]["score"]
    assert (
        compact["scores"][0]["assessment"]["coverage"]
        == full["scores"][0]["assessment"]["coverage"]
    )
    assert "reasons" not in compact["scores"][0]["assessment"]
    assert (
        profile["accessibility"]["assessment"]["reasons"]
        == full["scores"][0]["assessment"]["reasons"]
    )


def test_render_simplification_preserves_canonical_geometry(tmp_path):
    import copy
    import math

    from shapely.geometry import shape

    from app.api.repository import NormalizedRepository

    ring = [
        [73 + 0.01 * math.cos(i * math.tau / 1000), 3 + 0.01 * math.sin(i * math.tau / 1000)]
        for i in range(1000)
    ]
    ring.append(ring[0])
    island = {
        "type": "Feature",
        "properties": {"id": "island:1"},
        "geometry": {"type": "Polygon", "coordinates": [ring]},
    }
    original = copy.deepcopy(island)
    repository = NormalizedRepository(tmp_path)
    repository.islands = [island]
    simplified = repository.map_features(layer="islands", simplify_m=25)["features"][0]
    assert len(simplified["geometry"]["coordinates"][0]) < len(ring) / 10
    assert shape(simplified["geometry"]).is_valid
    assert (
        shape(simplified["geometry"]).hausdorff_distance(shape(original["geometry"])) < 26 / 111320
    )
    assert repository.map_features(layer="islands")["features"][0] == original
    assert repository.islands[0] == original


@pytest.mark.asyncio
async def test_prewarm_creates_country_snapshots_and_history_validators(tmp_path):
    from app.cli.precompute import warm_application
    from app.config.settings import Settings
    from app.main import create_app
    from tests.test_national_api import _write_fixture_data

    _write_fixture_data(tmp_path / "data")
    _source(tmp_path / "public")
    app = create_app(
        Settings(
            environment="test", data_dir=tmp_path / "data", public_data_dir=tmp_path / "public"
        )
    )
    async with app.router.lifespan_context(app):
        results = await warm_application(app)
        assert len(results) == 4
        assert app.state.computed_cache.status()["memory_entries"] >= 4
        import httpx

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await client.get("/api/v1/forecasts?history_only=true")
            assert "etag" in response.headers
            assert (
                await client.get(
                    "/api/v1/forecasts?history_only=true",
                    headers={"if-none-match": response.headers["etag"]},
                )
            ).status_code == 304
            fitted = await client.get("/api/v1/forecasts?target_month=2026-02")
            assert "etag" not in fitted.headers
