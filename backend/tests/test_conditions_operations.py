"""Source quality, cache failures and reviewed-notice workflow boundary checks."""

import asyncio
import copy
import json
import time
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.routes.conditions import router as conditions_router
from app.api.routes.operations import router as operations_router
from app.conditions.service import ConditionsService
from app.operations.service import NoticeStore, fetch_notice, public_url
from app.vela.integration import mount_places, places_lifespan
from tests.vela.test_api import AUTH, DIRECTIONS_BODY, Directions, FakeClient
from vendor.vela_api.config import Settings

MODEL_FORECAST = {
    "latitude": 4.2,
    "longitude": 73.5,
    "timezone": "GMT",
    "current": {"time": "2026-10-14T13:00", "temperature_2m": 29.2, "wind_speed_10m": None},
    "current_units": {"temperature_2m": "°C", "wind_speed_10m": "km/h"},
    "hourly": {"time": ["2026-10-14T13:00", "2026-10-14T14:00"], "temperature_2m": [29.2, None]},
}
NOTICE_TEXT = "Alikilegefaanu Magu is closed for road maintenance until the works finish."


def notice_source(tmp_path: Path) -> Path:
    public = tmp_path / "public"
    public.mkdir()
    (public / "planning-baseline.json").write_text(
        json.dumps(
            {
                "network": {"edges": [{"id": "edge:1", "sourceOsmWayId": 42}]},
                "facilities": [{"id": "health:1"}],
                "transit": {"patterns": [{"id": "ferry:1"}]},
            }
        ),
        encoding="utf-8",
    )
    return public


def reviewed_mapping(kind="road_closure", target="osm:way:42"):
    return {
        "decision": "approved",
        "operation_type": kind,
        "target_id": target,
        "valid_from": "2026-10-14T12:00:00+05:00",
        "valid_until": "2026-10-14T18:00:00+05:00",
        "notes": "Known source target and explicitly reviewed time window.",
    }


def make_api(tmp_path: Path, limit=60):
    upstream = FakeClient()

    @asynccontextmanager
    async def lifespan(application):
        async with places_lifespan(application):
            application.state.places_api.state.directions = Directions()
            yield

    application = FastAPI(lifespan=lifespan)
    mount_places(
        application, Settings(api_key="secret", rate_limit_per_minute=limit), client=upstream
    )
    application.state.conditions = ConditionsService()
    application.state.notices = NoticeStore(tmp_path / "runtime", notice_source(tmp_path))
    application.include_router(conditions_router)
    application.include_router(operations_router)
    return application


async def test_forecast_cache_preserves_nulls_kind_timestamp_and_isolation():
    calls = []

    def source(request):
        calls.append(request)
        return httpx.Response(200, json=MODEL_FORECAST)

    async with httpx.AsyncClient(transport=httpx.MockTransport(source)) as client:
        service = ConditionsService(client=client)
        first = await service.forecast(4.1755, 73.5093)
        second = await service.forecast(4.1755, 73.5093)
        assert len(calls) == 1
        assert first["receipt"]["cached"] is False
        assert second["receipt"]["cached"] is True
        assert second["receipt"]["retrieved_at"] == first["receipt"]["retrieved_at"]
        assert second["receipt"]["data_kind"] == "model_forecast"
        assert second["current"]["wind_speed_10m"] is None
        assert second["hourly"]["temperature_2m"][1] is None
        second["current"]["temperature_2m"] = 99
        third = await service.forecast(4.1755, 73.5093)
        assert third["current"]["temperature_2m"] == 29.2
        assert calls[0].url.host == "api.open-meteo.com"


async def test_expired_forecast_refresh_failure_is_explicit_stale():
    phase = {"failure": False}

    def source(_request):
        return httpx.Response(503) if phase["failure"] else httpx.Response(200, json=MODEL_FORECAST)

    async with httpx.AsyncClient(transport=httpx.MockTransport(source)) as client:
        service = ConditionsService(client=client, ttl=10)
        first = await service.forecast(4.1755, 73.5093)
        key = (False, 4.1755, 73.5093)
        service.cache[key] = (time.monotonic() - 11, copy.deepcopy(first))
        phase["failure"] = True
        stale = await service.forecast(4.1755, 73.5093)
        assert stale["status"] == "stale"
        assert stale["receipt"]["cached"] is True
        assert stale["receipt"]["stale"] is True
        assert stale["receipt"]["retrieved_at"] == first["receipt"]["retrieved_at"]
        assert "Refresh failed" in stale["warning"]
        assert stale["current"]["temperature_2m"] == 29.2


async def test_provider_failure_without_cache_never_synthesizes_forecast():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(503))
    ) as client:
        service = ConditionsService(client=client)
        with pytest.raises(HTTPException) as error:
            await service.forecast(4.1755, 73.5093)
        assert error.value.status_code == 502
        assert not service.cache


async def test_marine_null_grid_coverage_stays_unavailable():
    calls = []

    def source(request):
        calls.append(request)
        return httpx.Response(
            200, json={"current": {"time": "2026-10-14T13:00", "wave_height": None}}
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(source)) as client:
        result = await ConditionsService(client=client).forecast(4.1755, 73.5093, marine=True)
        assert result["status"] == "no_grid_coverage"
        assert result["current"]["wave_height"] is None
        assert "sailing safety" in result["receipt"]["qualification"]
        assert calls[0].url.host == "marine-api.open-meteo.com"


async def test_forecast_cache_is_bounded_across_many_locations():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=MODEL_FORECAST))
    ) as client:
        service = ConditionsService(client=client)
        for index in range(513):
            await service.forecast(index / 10000, 73.5093)
        assert len(service.cache) <= 512


async def test_distinct_forecast_points_refresh_concurrently_but_same_point_is_shared():
    started = asyncio.Event()
    release = asyncio.Event()
    calls = []

    async def source(request):
        calls.append(request)
        if len(calls) == 2:
            started.set()
        await release.wait()
        return httpx.Response(200, json=MODEL_FORECAST)

    async with httpx.AsyncClient(transport=httpx.MockTransport(source)) as client:
        service = ConditionsService(client=client)
        pending = [
            asyncio.create_task(service.forecast(latitude, 73.5))
            for latitude in (4.1755, 4.1755, 4.21)
        ]
        try:
            await asyncio.wait_for(started.wait(), timeout=1)
            assert len(calls) == 2
        finally:
            release.set()
        results = await asyncio.gather(*pending)
        assert results[0]["receipt"]["cached"] is False
        assert results[1]["receipt"]["cached"] is True
        results[0]["current"]["temperature_2m"] = 99
        assert results[1]["current"]["temperature_2m"] == 29.2


async def test_disconnected_caller_does_not_cancel_shared_forecast():
    started = asyncio.Event()
    release = asyncio.Event()
    calls = []

    async def source(request):
        calls.append(request)
        started.set()
        await release.wait()
        return httpx.Response(200, json=MODEL_FORECAST)

    async with httpx.AsyncClient(transport=httpx.MockTransport(source)) as client:
        service = ConditionsService(client=client)
        first = asyncio.create_task(service.forecast(4.1755, 73.5))
        await started.wait()
        second = asyncio.create_task(service.forecast(4.1755, 73.5))
        first.cancel()
        with pytest.raises(asyncio.CancelledError):
            await first
        release.set()
        assert (await second)["status"] == "available"
        assert len(calls) == 1
        assert not service._refreshes


async def test_close_cancels_pending_refresh_without_closing_injected_client():
    started = asyncio.Event()

    async def source(_request):
        started.set()
        await asyncio.Event().wait()

    async with httpx.AsyncClient(transport=httpx.MockTransport(source)) as client:
        service = ConditionsService(client=client)
        pending = asyncio.create_task(service.forecast(4.1755, 73.5))
        await started.wait()
        await service.close()
        with pytest.raises(asyncio.CancelledError):
            await pending
        assert not service._refreshes
        assert not client.is_closed


async def test_owned_forecast_connection_pool_is_reused_and_closed(monkeypatch):
    original_client = httpx.AsyncClient
    clients = []

    def create_client(**kwargs):
        client = original_client(
            transport=httpx.MockTransport(lambda _: httpx.Response(200, json=MODEL_FORECAST)),
            **kwargs,
        )
        clients.append(client)
        return client

    monkeypatch.setattr("app.conditions.service.httpx.AsyncClient", create_client)
    service = ConditionsService()
    await service.forecast(4.1755, 73.5)
    await service.forecast(4.21, 73.5)
    assert len(clients) == 1
    assert not clients[0].is_closed
    await service.close()
    assert clients[0].is_closed
    assert service.client is None


async def test_forecast_refresh_concurrency_is_bounded():
    all_slots_busy = asyncio.Event()
    release = asyncio.Event()
    active = 0
    maximum = 0

    async def source(_request):
        nonlocal active, maximum
        active += 1
        maximum = max(maximum, active)
        if active == 8:
            all_slots_busy.set()
        await release.wait()
        active -= 1
        return httpx.Response(200, json=MODEL_FORECAST)

    async with httpx.AsyncClient(transport=httpx.MockTransport(source)) as client:
        service = ConditionsService(client=client)
        pending = [asyncio.create_task(service.forecast(index / 10, 73.5)) for index in range(16)]
        try:
            await asyncio.wait_for(all_slots_busy.wait(), timeout=1)
            assert maximum == 8
        finally:
            release.set()
        await asyncio.gather(*pending)
        assert maximum == 8


async def test_forecast_cache_retains_exact_requested_map_point():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=MODEL_FORECAST))
    ) as client:
        service = ConditionsService(client=client)
        first = await service.forecast(4.17551, 73.50931)
        second = await service.forecast(4.17552, 73.50932)
        assert first["requested"] == {"latitude": 4.17551, "longitude": 73.50931}
        assert second["receipt"]["cached"] is True
        assert second["requested"] == {"latitude": 4.17552, "longitude": 73.50932}
        assert second["grid"] == first["grid"]
        assert second["receipt"]["url"] == first["receipt"]["url"]


@pytest.mark.parametrize("payload", [[], {"current": []}, {**MODEL_FORECAST, "hourly": []}])
async def test_malformed_forecast_provider_payload_is_explicit_unavailable(payload):
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload))
    ) as client:
        with pytest.raises(HTTPException) as error:
            await ConditionsService(client=client).forecast(4.1755, 73.5)
        assert error.value.status_code == 502


async def test_forecast_deadline_covers_the_whole_stream(monkeypatch):
    real_timeout = asyncio.timeout
    monkeypatch.setattr("app.conditions.service.asyncio.timeout", lambda _: real_timeout(0.01))

    class SlowStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            for _ in range(30):
                await asyncio.sleep(0.005)
                yield b"Slow forecast stream. "

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, stream=SlowStream()))
    ) as client:
        with pytest.raises(HTTPException) as error:
            await ConditionsService(client=client).forecast(4.1755, 73.5)
        assert error.value.status_code == 502


async def test_forecast_body_limit_stops_reading_oversized_stream():
    chunks_read = []

    class OversizeStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            for index in range(10):
                chunks_read.append(index)
                yield b"x" * 500_001

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, stream=OversizeStream()))
    ) as client:
        with pytest.raises(HTTPException) as error:
            await ConditionsService(client=client).forecast(4.1755, 73.5)
        assert error.value.status_code == 502
        assert chunks_read == [0, 1]


@pytest.mark.parametrize(
    "query",
    [
        {"latitude": "nan"},
        {"longitude": "inf"},
        {"latitude": 91},
        {"longitude": -181},
    ],
)
def test_conditions_coordinate_validation_prevents_provider_calls(tmp_path, query):
    application = make_api(tmp_path)
    with TestClient(application) as client:
        for endpoint in ("weather", "marine"):
            assert client.get(f"/api/v1/conditions/{endpoint}", params=query).status_code == 422
        assert not application.state.conditions.cache


def test_traffic_reuses_places_auth_rate_limit_cache_and_null_semantics(tmp_path):
    application = make_api(tmp_path, limit=2)
    with TestClient(application) as client:
        for headers in ({}, {"X-API-Key": "wrong"}):
            refused = client.post(
                "/api/v1/conditions/traffic", json=DIRECTIONS_BODY, headers=headers
            )
            assert refused.status_code == 401
            assert refused.json()["error"]["code"] == "unauthorized"
        first = client.post("/api/v1/conditions/traffic", json=DIRECTIONS_BODY, headers=AUTH)
        assert first.status_code == 200
        assert first.json()["meta"]["cached"] is False
        assert first.json()["data"]["routes"][0]["traffic_seconds"] is None
        second = client.post("/api/v1/places/directions", json=DIRECTIONS_BODY, headers=AUTH)
        assert second.status_code == 200
        assert second.json()["meta"]["cached"] is True
        limited = client.post("/api/v1/conditions/traffic", json=DIRECTIONS_BODY, headers=AUTH)
        assert limited.status_code == 429
        assert limited.headers["retry-after"] == "60"
        assert len(application.state.places_api.state.directions.calls) == 1


@pytest.mark.parametrize(
    "url",
    [
        "http://rtl.mv/notice",
        "https://localhost/private",
        "https://127.0.0.1/private",
        "https://rtl.mv.evil.test/notice",
        "https://user@rtl.mv/notice",
        "https://rtl.mv:8443/notice",
    ],
)
def test_notice_sources_require_exact_supported_https_hosts(url):
    with pytest.raises(HTTPException) as error:
        public_url(url)
    assert error.value.status_code == 422


async def test_notice_redirect_cannot_escape_allowlist():
    calls = []

    def source(request):
        calls.append(str(request.url))
        return httpx.Response(302, headers={"location": "https://127.0.0.1/private"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(source)) as client:
        with pytest.raises(HTTPException) as error:
            await fetch_notice("https://rtl.mv/notice", client)
        assert error.value.status_code == 422
        assert calls == ["https://rtl.mv/notice"]


@pytest.mark.parametrize(
    "content_type", ["application/cap+xml", "application/rss+xml", "text/html"]
)
async def test_notice_import_supports_xml_and_strips_executable_page_content(content_type):
    raw = (
        b"<html><title>Service notice</title><script>DO_NOT_IMPORT_THIS_SCRIPT</script>"
        b"<nav>Navigation boilerplate</nav>"
        b"<p>Ferry services are suspended during maintenance.</p></html>"
    )
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(200, content=raw, headers={"content-type": content_type})
        )
    ) as client:
        result = await fetch_notice("https://rtl.mv/notices", client)
        assert "DO_NOT_IMPORT_THIS_SCRIPT" not in result["text"]
        assert "Navigation boilerplate" not in result["text"]
        assert "Ferry services are suspended" in result["text"]
        assert len(result["sha256"]) == 64


async def test_notice_import_body_limit_is_checked_before_persistence():
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200, content=b"x" * 1_000_001, headers={"content-type": "text/plain"}
            )
        )
    ) as client:
        with pytest.raises(HTTPException) as error:
            await fetch_notice("https://rtl.mv/notice", client)
        assert error.value.status_code == 413


async def test_notice_deadline_includes_entire_stream(monkeypatch):
    real_timeout = asyncio.timeout
    monkeypatch.setattr("app.operations.service.asyncio.timeout", lambda _: real_timeout(0.01))

    class SlowStream(httpx.AsyncByteStream):
        async def __aiter__(self):
            for _ in range(30):
                await asyncio.sleep(0.005)
                yield b"Slow public notice stream. "

    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200, stream=SlowStream(), headers={"content-type": "text/plain"}
            )
        )
    ) as client:
        with pytest.raises(HTTPException) as error:
            await fetch_notice("https://rtl.mv/notice", client)
        assert error.value.status_code in (502, 504)


@pytest.mark.parametrize(
    "kind,target",
    [
        ("road_closure", "osm:way:42"),
        ("disable_facility", "health:1"),
        ("disable_service", "ferry:1"),
    ],
)
def test_notice_ingest_review_deduplicate_and_restart_keep_evidence_separate(
    tmp_path, kind, target
):
    application = make_api(tmp_path)
    baseline_path = application.state.notices.public_dir / "planning-baseline.json"
    original_baseline = baseline_path.read_bytes()
    with TestClient(application) as client:
        input_notice = {
            "source_url": "https://rtl.mv/notices/1",
            "text": NOTICE_TEXT,
            "title": "Road maintenance",
        }
        imported = client.post("/api/v1/operations/notices/ingest", json=input_notice)
        assert imported.status_code == 200
        candidate = imported.json()
        assert candidate["status"] == "candidate"
        assert candidate["proposed_operation"] is None
        assert candidate["possible_location"] == "Alikilegefaanu Magu"
        assert candidate["receipt"]["input_method"] == "user_supplied_text"
        approved = client.post(
            f"/api/v1/operations/notices/{candidate['id']}/review",
            json=reviewed_mapping(kind, target),
        )
        assert approved.status_code == 200
        reviewed = approved.json()
        assert reviewed["proposed_operation"]["metadata"]["reviewed"] is True
        assert reviewed["proposed_operation"]["target_id"] == target
        assert reviewed["review"]["valid_until"] == "2026-10-14T18:00:00+05:00"
        duplicate = client.post("/api/v1/operations/notices/ingest", json=input_notice)
        assert duplicate.json()["duplicate"] is True
        assert duplicate.json()["status"] == "approved"
        assert (
            client.get("/api/v1/operations/notices", params={"status": "approved"}).json()["total"]
            == 1
        )
    restored = NoticeStore(tmp_path / "runtime", application.state.notices.public_dir)
    assert restored.get(candidate["id"])["status"] == "approved"
    assert restored.get(candidate["id"])["review"]["notes"] == reviewed_mapping()["notes"]
    assert baseline_path.read_bytes() == original_baseline


@pytest.mark.parametrize(
    "changes",
    [
        {"target_id": "missing:target"},
        {"operation_type": None},
        {"valid_from": "2026-10-14T12:00:00"},
        {"valid_until": "2026-10-14T11:00:00+05:00"},
    ],
)
def test_unmapped_or_unbounded_notice_approval_is_rejected(tmp_path, changes):
    application = make_api(tmp_path)
    with TestClient(application) as client:
        candidate = client.post(
            "/api/v1/operations/notices/ingest",
            json={"source_url": "https://rtl.mv/notice", "text": NOTICE_TEXT},
        ).json()
        response = client.post(
            f"/api/v1/operations/notices/{candidate['id']}/review",
            json={**reviewed_mapping(), **changes},
        )
        assert response.status_code == 422
        retained = application.state.notices.get(candidate["id"])
        assert retained["status"] == "candidate"
        assert retained["proposed_operation"] is None


def test_notice_dismissal_removes_proposed_operation(tmp_path):
    application = make_api(tmp_path)
    with TestClient(application) as client:
        candidate = client.post(
            "/api/v1/operations/notices/ingest",
            json={"source_url": "https://rtl.mv/notice", "text": NOTICE_TEXT},
        ).json()
        client.post(f"/api/v1/operations/notices/{candidate['id']}/review", json=reviewed_mapping())
        dismissed = client.post(
            f"/api/v1/operations/notices/{candidate['id']}/review",
            json={"decision": "dismissed", "notes": "Expired source statement."},
        )
        assert dismissed.status_code == 200
        assert dismissed.json()["status"] == "dismissed"
        assert dismissed.json()["proposed_operation"] is None
