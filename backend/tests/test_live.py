import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from app.config.settings import Settings
from app.live.config import LiveConfig
from app.live.models import LiveQuery
from app.live.providers import _aircraft_event, _bus_event, _followme_event, _vessel_event
from app.live.service import LiveService
from app.main import create_app


class _FakeProvider:
    def __init__(self, name: str, event: dict[str, Any] | None = None) -> None:
        self.name = name
        self.enabled = True
        self.event = event
        self.calls = 0

    async def fetch(self, _query: LiveQuery) -> dict[str, Any]:
        self.calls += 1
        events = [self.event] if self.event else []
        return {
            "provider": self.name,
            "enabled": True,
            "status": "ok" if events else "no_current_coverage",
            "event_count": len(events),
            "events": events,
        }


class _ErrorProvider(_FakeProvider):
    async def fetch(self, _query: LiveQuery) -> dict[str, Any]:
        self.calls += 1
        return {
            "provider": self.name,
            "enabled": True,
            "status": "error",
            "event_count": 0,
            "events": [],
        }


def test_live_normalizers_reject_invalid_coordinates() -> None:
    assert _aircraft_event({"hex": "abc", "lat": 20, "lon": 73}, 0) is None
    assert (
        _vessel_event(
            "openwaters",
            {
                "id": "vessel-1",
                "geometry": {"type": "Point", "coordinates": [73.5, 4.2]},
                "properties": {"mmsi": "123"},
            },
            0,
        )
        is not None
    )
    assert (
        _vessel_event(
            "facha",
            {"mmsi": "456", "latitude": 4.2, "longitude": 73.5},
            0,
        )
        is not None
    )
    assert _bus_event({"busCode": "bus-1", "latitude": 4.2, "longitude": 73.5}, 0)


def test_followme_normalizer_uses_public_id_and_hides_device_identifier() -> None:
    event = _followme_event(
        {
            "status": "ok",
            "device": {
                "id": 18157,
                "imei": "must-not-leak",
                "name": "Public Vessel",
                "latitude": "4.1560980",
                "longitude": "73.4824930",
                "speed": 9,
                "heading": 234,
                "updated_at": "2026-10-13 17:06:59",
            },
        },
        18157,
    )

    assert event is not None
    assert event["id"] == "followme:18157"
    assert event["source_quality"] == "verified_public_json"
    assert event["properties"]["name"] == "Public Vessel"
    assert "imei" not in event["properties"]


def test_vessel_snapshot_combines_followme_and_ais_sources(tmp_path: Path) -> None:
    service = LiveService(tmp_path, LiveConfig())
    service.providers = {
        "openwaters": _FakeProvider(
            "openwaters",
            _vessel_event(
                "openwaters",
                {
                    "id": "ais-1",
                    "geometry": {"type": "Point", "coordinates": [73.51, 4.18]},
                    "properties": {"mmsi": "123"},
                },
                0,
            ),
        ),
        "followme": _FakeProvider(
            "followme",
            _followme_event(
                {
                    "status": "ok",
                    "device": {
                        "id": 18157,
                        "latitude": "4.1560980",
                        "longitude": "73.4824930",
                        "updated_at": (datetime.now(UTC) + timedelta(hours=5)).strftime(
                            "%Y-%m-%d %H:%M:%S"
                        ),
                    },
                },
                18157,
            ),
        ),
        "facha": _FakeProvider("facha"),
    }

    result = asyncio.run(
        service.vessel_snapshot(
            LiveQuery(
                bbox="72.5,4.0,74.0,5.0",
                followme_vessel_ids=[18157],
            )
        )
    )

    assert {event["provider"] for event in result["vessels"]} == {"openwaters", "followme"}
    assert result["coverage"] == "partial"


def test_unified_snapshot_endpoint_returns_all_location_types(tmp_path: Path) -> None:
    app = create_app(Settings(environment="test", data_dir=tmp_path))
    app.state.live.providers = {
        "adsb.lol": _FakeProvider(
            "adsb.lol",
            _aircraft_event({"hex": "flight-1", "lat": 4.2, "lon": 73.5}, 0),
        ),
        "openwaters": _FakeProvider(
            "openwaters",
            _vessel_event(
                "openwaters",
                {
                    "id": "ais-1",
                    "geometry": {"type": "Point", "coordinates": [73.51, 4.18]},
                    "properties": {"mmsi": "123"},
                },
                0,
            ),
        ),
        "followme": _FakeProvider(
            "followme",
            _followme_event(
                {
                    "status": "ok",
                    "device": {
                        "id": 18157,
                        "latitude": "4.1560980",
                        "longitude": "73.4824930",
                        "updated_at": (datetime.now(UTC) + timedelta(hours=5)).strftime(
                            "%Y-%m-%d %H:%M:%S"
                        ),
                    },
                },
                18157,
            ),
        ),
        "facha": _FakeProvider("facha"),
        "rtl": _FakeProvider("rtl"),
    }

    with TestClient(app) as client:
        response = client.get(
            "/api/v1/live/snapshot?bbox=72.5,4.0,74.0,5.0&followme_vessel_ids=18157"
        )

    assert response.status_code == 200
    payload = response.json()
    assert {event["provider"] for event in payload["locations"]} == {
        "adsb.lol",
        "openwaters",
        "followme",
    }


def test_live_snapshot_uses_transient_cache_and_does_not_persist_history(
    tmp_path: Path,
) -> None:
    service = LiveService(tmp_path, LiveConfig())
    aircraft = _FakeProvider(
        "adsb.lol",
        _aircraft_event({"hex": "aircraft-1", "lat": 4.2, "lon": 73.5}, 0),
    )
    vessel = _FakeProvider(
        "openwaters",
        _vessel_event(
            "openwaters",
            {
                "id": "vessel-1",
                "geometry": {"type": "Point", "coordinates": [73.5, 4.2]},
                "properties": {},
            },
            0,
        ),
    )
    bus = _FakeProvider("rtl")
    facha = _FakeProvider("facha")
    service.providers = {
        "adsb.lol": aircraft,
        "openwaters": vessel,
        "facha": facha,
        "rtl": bus,
    }
    query = LiveQuery()

    first = asyncio.run(service.snapshot(query))
    second = asyncio.run(service.snapshot(query))

    assert first["coverage"] == "available"
    assert len(first["events"]) == 2
    assert second["coverage"] == "available"
    assert aircraft.calls == 1
    assert vessel.calls == 1
    assert bus.calls == 1
    assert facha.calls == 0


def test_live_snapshot_uses_facha_after_primary_vessel_failure(tmp_path: Path) -> None:
    service = LiveService(tmp_path, LiveConfig())
    service.providers = {
        "adsb.lol": _FakeProvider("adsb.lol"),
        "openwaters": _ErrorProvider("openwaters"),
        "facha": _FakeProvider(
            "facha",
            _vessel_event(
                "facha",
                {"mmsi": "facha-1", "latitude": 4.2, "longitude": 73.5},
                0,
            ),
        ),
        "rtl": _FakeProvider("rtl"),
    }

    result = asyncio.run(service.snapshot(LiveQuery()))

    assert any(event["provider"] == "facha" for event in result["events"])
    assert service.providers["facha"].calls == 1


def test_live_sse_and_status_api_are_available_without_provider_calls(tmp_path: Path) -> None:
    service = LiveService(tmp_path, LiveConfig(aircraft_enabled=False, vessel_enabled=False))
    chunks = asyncio.run(_collect(service.stream(LiveQuery(), once=True)))
    assert any("provider_status" in chunk for chunk in chunks)

    client = TestClient(create_app(Settings(environment="test", data_dir=tmp_path)))
    with client:
        response = client.get("/api/v1/live/status")

    assert response.status_code == 200
    assert response.json()["deterministic_data_affected"] is False


async def _collect(stream: Any) -> list[str]:
    return [chunk async for chunk in stream]
