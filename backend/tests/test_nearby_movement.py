"""Bounded movement discovery, observation freshness and honest fallback receipts."""

import asyncio
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.config.settings import Settings
from app.data.cache import FileCache
from app.live.config import LiveConfig
from app.live.models import LiveQuery, parse_bbox
from app.live.providers import (
    FollowMeProvider,
    OpenSkyProvider,
    _aircraft_event,
    _followme_event,
    _followme_time,
    _opensky_event,
    _vessel_event,
)
from app.live.service import LiveService, _events_in_query
from app.main import create_app


def _mock_clients(monkeypatch: pytest.MonkeyPatch, handler: object) -> None:
    original = httpx.AsyncClient
    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(
        "app.live.providers.httpx.AsyncClient",
        lambda **kwargs: original(transport=transport, **kwargs),
    )


def _local_time(age_seconds: int = 0) -> str:
    return (datetime.now(UTC) + timedelta(hours=5, seconds=-age_seconds)).strftime(
        "%Y-%m-%d %H:%M:%S"
    )


def _device(vessel_id: int, lat: float = 4.18, lon: float = 73.5, age: int = 0) -> dict:
    return {
        "id": vessel_id,
        "name": f"Public {vessel_id}",
        "latitude": lat,
        "longitude": lon,
        "speed": 8,
        "heading": 125,
        "updated_at": _local_time(age),
        "imei": "private-device-identifier",
    }


def _card(vessel_id: int, kind: str = "Ferry") -> str:
    return (
        f'<article class="boat-card" data-boat-id="{vessel_id}">'
        f"<h2>Public {vessel_id}</h2><time>Just now</time>"
        '<p class="operator-name">Public operator</p>'
        f'<a class="boat-meta-link"><span>{kind}</span></a>'
        '<span class="phone">1234567</span></article>'
    )


def test_followme_wall_clock_is_maldives_time() -> None:
    assert _followme_time("2026-10-14 21:26:35") == datetime(2026, 10, 14, 16, 26, 35, tzinfo=UTC)
    assert _followme_time("2026-10-14T21:26:35+05:00") == datetime(
        2026, 10, 14, 16, 26, 35, tzinfo=UTC
    )


def test_old_observation_is_not_refreshed_by_a_new_download() -> None:
    event = _followme_event({"status": "ok", "device": _device(1, age=700)}, 1)
    assert event is not None
    query = LiveQuery(bbox="73.4,4.1,73.6,4.3", max_age_seconds=300)
    assert _events_in_query([event], query) == []
    visible = _events_in_query([event], query.model_copy(update={"include_stale": True}))
    assert visible[0]["stale"] is True
    assert visible[0]["position_age_seconds"] >= 700
    assert visible[0]["source_quality"] == "stale_provider_observation"
    assert event["stale"] is False  # filtering must not mutate cached source events


def test_future_observation_is_excluded_even_when_stale_is_requested() -> None:
    event = _followme_event({"status": "ok", "device": _device(1, age=-1800)}, 1)
    assert event is not None
    assert _events_in_query([event], LiveQuery(include_stale=True)) == []


def test_unknown_position_time_is_labelled_as_retrieval_only() -> None:
    event = _vessel_event("openwaters", {"mmsi": "1", "latitude": 4.18, "longitude": 73.5}, 0)
    assert event is not None
    result = _events_in_query([event], LiveQuery())[0]
    assert result["position_time_quality"] == "retrieval_only"
    assert result["position_age_seconds"] is None


def test_adsb_observation_uses_snapshot_clock_and_position_age() -> None:
    event = _aircraft_event(
        {"hex": "abc123", "lat": 4.18, "lon": 73.5, "seen": 1, "seen_pos": 301},
        0,
        1_791_995_449_000,
    )
    assert event is not None
    expected = datetime.fromtimestamp(1_791_995_449 - 301, UTC)
    assert datetime.fromisoformat(event["observed_at"]) == expected


def test_opensky_normalizer_preserves_real_position_time_and_units() -> None:
    timestamp = datetime.now(UTC).timestamp()
    row = ["abc123", "FLY123 ", "Maldives", timestamp, timestamp, 73.5, 4.18, 1000, False, 100, 270]
    event = _opensky_event(row, 0)
    assert event is not None
    assert event["properties"]["flight"] == "FLY123"
    assert event["properties"]["gs"] == pytest.approx(194.3844)
    assert event["properties"]["alt_baro"] == pytest.approx(3280.84)
    assert event["properties"]["track"] == 270
    assert event["position"]["latitude"] == 4.18
    assert _opensky_event(row[:5], 0) is None


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), True])
def test_nonfinite_or_boolean_coordinates_are_rejected(bad: float) -> None:
    assert _aircraft_event({"hex": "abc", "lat": bad, "lon": 73.5}, 0) is None
    assert _followme_event({"status": "ok", "device": _device(1, lat=bad)}, 1) is None


def test_addu_bbox_and_positions_are_within_maldives_bounds() -> None:
    assert parse_bbox("73.0,-0.9,73.5,-0.4") == (-0.9, 73.0, -0.4, 73.5)
    event = _followme_event({"status": "ok", "device": _device(1, lat=-0.612, lon=73.08)}, 1)
    assert event is not None
    query = LiveQuery(bbox="73.0,-0.9,73.5,-0.4", discover_nearby=True)
    assert len(_events_in_query([event], query)) == 1
    with pytest.raises(ValueError):
        parse_bbox("73.0,-1.2,73.5,-0.4")


@pytest.mark.parametrize(
    "query",
    [
        {"discover_nearby": True, "radius_nm": 100},
        {"discover_nearby": True, "bbox": "72,0,75,8"},
    ],
)
def test_automatic_discovery_rejects_broad_queries(query: dict) -> None:
    with pytest.raises(ValidationError):
        LiveQuery(**query)


def test_public_neighbours_discovery_keeps_types_and_filters_observation_age(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []
    rows = [
        _device(1),
        _device(2),
        _device(3, age=900),
        _device(4, lon=74.5),
        _device(5),
        _device(6),
    ]

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        if request.url.path.endswith("islands.php"):
            return httpx.Response(
                200, json={"status": "ok", "islands": [{"id": 198, "name": "Hulhumale"}]}
            )
        if request.url.path == "/public/":
            return httpx.Response(200, text=_card(1) + _card(5, "Bus") + _card(6, "Car"))
        if request.url.path.endswith("device.php"):
            return httpx.Response(200, json={"status": "ok", "device": _device(1)})
        if request.url.path.endswith("neighbours.php"):
            assert request.url.params["radius"] == "20000"
            return httpx.Response(
                200, json={"status": "ok", "data": {"radius": 20000, "boats": rows}}
            )
        raise AssertionError(str(request.url))

    _mock_clients(monkeypatch, handler)
    config = LiveConfig(followme_min_interval_seconds=0)
    provider = FollowMeProvider(config, FileCache(tmp_path))
    query = LiveQuery(
        island_name="Hulhumale",
        bbox="73.4,4.1,73.6,4.3",
        radius_nm=10,
        discover_nearby=True,
        max_age_seconds=300,
    )
    result = asyncio.run(provider.fetch(query))
    visible = _events_in_query(result["events"], query)
    assert {event["id"] for event in visible} == {"followme:1", "followme:2", "followme:5"}
    assert next(event for event in visible if event["id"] == "followme:5")["kind"] == "bus"
    assert result["discovery"]["provider_record_count"] == 6
    assert result["discovery"]["complete"] is False
    assert len(calls) == 5
    assert "imei" not in json.dumps(result)
    assert "1234567" not in json.dumps(provider.cache.read_json("live/followme/catalogue.json"))
    assert (
        provider.cache.read_json("live/followme/latest.json")["1"]["properties"]["type"] == "Ferry"
    )


@pytest.mark.parametrize("seed_type", ["Bus", "Car"])
def test_absent_neighbour_seed_keeps_public_identity_in_response_and_cache(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, seed_type: str
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("islands.php"):
            return httpx.Response(200, json={"islands": [{"id": 198, "name": "Hulhumale"}]})
        if request.url.path == "/public/":
            return httpx.Response(200, text=_card(1, seed_type) + _card(2))
        if request.url.path.endswith("device.php"):
            return httpx.Response(200, json={"status": "ok", "device": _device(1)})
        if request.url.path.endswith("neighbours.php"):
            # The discovery seed is not necessarily repeated by neighbours.php.
            return httpx.Response(200, json={"status": "ok", "data": {"boats": [_device(2)]}})
        raise AssertionError(str(request.url))

    _mock_clients(monkeypatch, handler)
    provider = FollowMeProvider(LiveConfig(followme_min_interval_seconds=0), FileCache(tmp_path))
    query = LiveQuery(island_name="Hulhumale", radius_nm=10, discover_nearby=True)
    first = asyncio.run(provider.fetch(query))
    second = asyncio.run(provider.fetch(query))  # Exercise the cached-position seed path too.
    for response in (first, second):
        identities = {event["external_object_id"]: event["kind"] for event in response["events"]}
        assert identities == (
            {"1": "bus", "2": "vessel"} if seed_type == "Bus" else {"2": "vessel"}
        )
    cached = provider.cache.read_json("live/followme/latest.json")
    if seed_type == "Bus":
        assert cached["1"]["kind"] == "bus"
    else:
        assert "1" not in cached


def test_homonymous_island_seed_is_checked_geographically(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("islands.php"):
            return httpx.Response(
                200,
                json={
                    "islands": [
                        {"id": 149, "name": "L. Hithadhoo"},
                        {"id": 182, "name": "S. Hithadhoo"},
                    ]
                },
            )
        if request.url.path == "/public/":
            return httpx.Response(
                200, text=_card(149 if request.url.params.get("island_id") == "149" else 182)
            )
        if request.url.path.endswith("device.php"):
            vessel_id = int(request.url.params["id"])
            lat = 1.79 if vessel_id == 149 else -0.612
            return httpx.Response(
                200, json={"status": "ok", "device": _device(vessel_id, lat=lat, lon=73.08)}
            )
        if request.url.path.endswith("neighbours.php"):
            assert request.url.params["id"] == "182"
            return httpx.Response(
                200, json={"status": "ok", "data": {"boats": [_device(182, lat=-0.612, lon=73.08)]}}
            )
        raise AssertionError(str(request.url))

    _mock_clients(monkeypatch, handler)
    provider = FollowMeProvider(LiveConfig(followme_min_interval_seconds=0), FileCache(tmp_path))
    result = asyncio.run(
        provider.fetch(
            LiveQuery(
                island_name="Hithadhoo",
                bbox="73.0,-0.7,73.2,-0.5",
                discover_nearby=True,
            )
        )
    )
    assert result["discovery"]["seed_id"] == 182
    assert result["events"][0]["position"]["latitude"] == -0.612


def test_opensky_cooldown_applies_across_different_scopes(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        assert set(request.url.params) == {"lamin", "lomin", "lamax", "lomax"}
        return httpx.Response(200, json={"time": datetime.now(UTC).timestamp(), "states": None})

    _mock_clients(monkeypatch, handler)
    provider = OpenSkyProvider(LiveConfig())

    async def exercise() -> None:
        first = await provider.fetch(LiveQuery(bbox="73.4,4.1,73.6,4.3"))
        second = await provider.fetch(LiveQuery(bbox="73.0,-0.7,73.2,-0.5"))
        assert first["status"] == "no_current_coverage"
        assert second["cached"] is True
        assert second["retry_after_seconds"] > 0

    asyncio.run(exercise())
    assert len(calls) == 1


def test_opensky_cooldown_survives_backend_provider_restart(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(200, json={"states": None})

    _mock_clients(monkeypatch, handler)
    cache = FileCache(tmp_path)
    first = OpenSkyProvider(LiveConfig(), cache)
    asyncio.run(first.fetch(LiveQuery(bbox="73.4,4.1,73.6,4.3")))
    restarted = OpenSkyProvider(LiveConfig(), cache)
    result = asyncio.run(restarted.fetch(LiveQuery(bbox="73.0,-0.7,73.2,-0.5")))
    assert result["cached"] is True
    assert result["retry_after_seconds"] > 0
    assert len(calls) == 1


def test_followme_download_is_bounded(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_clients(monkeypatch, lambda request: httpx.Response(200, content=b"x" * 8_000_001))
    provider = FollowMeProvider(LiveConfig(followme_min_interval_seconds=0), FileCache(tmp_path))

    async def exercise() -> None:
        async with httpx.AsyncClient() as client:
            with pytest.raises(ValueError, match="8 MB"):
                await provider._get_bytes(
                    client, "https://m.followme.mv/public/", suffix="html", accept="text/html"
                )

    asyncio.run(exercise())


def test_declined_provider_is_explained_without_failing_snapshot(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _mock_clients(monkeypatch, lambda request: httpx.Response(403, text="User-Agent too generic"))
    config = LiveConfig(vessel_enabled=False, followme_enabled=False, aircraft_enabled=True)
    service = LiveService(tmp_path, config)
    result = asyncio.run(service.snapshot(LiveQuery(include_fallback=False)))
    adsb = next(item for item in result["providers"] if item["provider"] == "adsb.lol")
    assert adsb["status"] == "configuration_required"
    assert adsb["http_status"] == 403
    assert adsb["source_url"].startswith("https://www.adsb.lol")
    assert adsb["visible_event_count"] == 0
    assert result["events"] == []
    assert result["counts"] == {"aircraft": 0, "vessel": 0, "bus": 0}


def test_local_discovery_validation_is_returned_before_provider_calls(tmp_path: Path) -> None:
    app = create_app(Settings(environment="test", data_dir=tmp_path))
    with TestClient(app) as client:
        invalid = client.get("/api/v1/live/snapshot?discover_nearby=true&bbox=72,0,75,8")
        assert invalid.status_code == 422
        assert app.state.live._last_status == {}
