"""Network validators reuse bytes without hiding changed source evidence."""

import json
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes.air import router as air_router
from app.api.routes.planning import router as planning_router
from app.api.snapshot_cache import SnapshotCacheMiddleware, network_snapshot_inputs
from app.data.computed_cache import ComputedCache, SourceVersion
from app.planning.air_network import AirNetworkService
from tests.test_air_network import evidence
from tests.test_sea_connections import bundle, route
from tests.test_sea_connections import sea as sea_fixture

sea = sea_fixture


def application(sea, tmp_path):
    app = FastAPI()
    app.state.planning = sea.planning
    app.state.transport_planning = sea.transport
    app.state.sea_connections = sea
    app.state.repository = sea.transport.repository
    app.state.source_version = SourceVersion(tmp_path / "data", sea.path.parent)
    app.state.computed_cache = ComputedCache(tmp_path / "http-cache")
    app.add_middleware(
        SnapshotCacheMiddleware,
        cache=app.state.computed_cache,
        source=app.state.source_version,
        network_inputs=network_snapshot_inputs,
    )
    app.include_router(planning_router)
    app.include_router(air_router)
    return app


def prepare_air(sea, tmp_path):
    source, features = evidence()
    path = tmp_path / "domestic-air-services.json"
    path.write_text(json.dumps(source), encoding="utf-8")
    sea.transport.repository.transport = {"features": features}
    return path, source, features


@pytest.mark.parametrize("name", ["sea", "air"])
def test_network_conditional_and_disk_hits_skip_endpoint_serialization(
    sea, tmp_path, monkeypatch, name
):
    bundle(sea, [route("published", [1, 2], [490, 510])])
    prepare_air(sea, tmp_path)
    app = application(sea, tmp_path)
    service = sea if name == "sea" else AirNetworkService(app.state.repository, tmp_path)
    if name == "air":
        app.state.air_network = service
    original = service.network
    measured = Mock(wraps=original)
    monkeypatch.setattr(service, "network", measured)
    url = f"/api/v1/planning/{name}-network?date=2026-10-17"
    with TestClient(app) as client:
        first = client.get(url)
        assert first.status_code == 200
        validator = {"if-none-match": first.headers["etag"]}
        cached = client.get(url, headers=validator)
        assert cached.status_code == 304 and cached.content == b""
        assert measured.call_count == 1
    app.state.computed_cache.close()
    restarted = application(sea, tmp_path)
    if name == "air":
        restarted.state.air_network = service
    with TestClient(restarted) as client:
        restored = client.get(url)
        assert restored.content == first.content
        assert restarted.state.computed_cache.status()["disk_hits"] == 1
        assert measured.call_count == 1


def test_sea_http_key_tracks_reviewed_source_population_and_corridor_changes(
    sea, tmp_path, monkeypatch
):
    bundle(sea, [route("published", [1, 2], [490, 510])])
    app = application(sea, tmp_path)
    measured = Mock(wraps=sea.network)
    monkeypatch.setattr(sea, "network", measured)
    url = "/api/v1/planning/sea-network?date=2026-10-17"
    with TestClient(app) as client:
        first = client.get(url)
        headers = {"if-none-match": first.headers["etag"]}
        for island in sea.planning.repository.baseline["islands"]:
            island["population2026"] = 100
        assert client.get(url, headers=headers).status_code == 200
        published = route("changed-publication", [1, 2], [495, 515])
        bundle(sea, [published])
        changed = client.get(url, headers=headers)
        assert changed.json()["routes"][0]["id"] == "changed-publication"
        # Global snapshot headers stay stable while service-specific inputs
        # invalidate the representation, including accepted timetable records.
        assert changed.headers["x-data-version"] == first.headers["x-data-version"]
        sea.transport.updates.catalogue = lambda: {"services": [], "unused": True}
        unchanged = client.get(url, headers={"if-none-match": changed.headers["etag"]})
        assert unchanged.status_code == 304
        before = measured.call_count
        (tmp_path / "sea-corridors.json").write_text("{}", encoding="utf-8")
        client.get(url)
        assert measured.call_count == before + 1
        reviewed = {
            "id": "accepted-service",
            "name": "Reviewed ferry",
            "mode": "ferry",
            "from_island_id": "island:1",
            "to_island_id": "island:2",
            "from_terminal": "Published landing A",
            "to_terminal": "Published landing B",
            "departure": "08:10:00",
            "arrival": "08:30:00",
            "arrival_day_offset": 0,
            "timing_basis": "published_arrival",
            "weekdays": [6],
            "effective_from": "2026-10-17",
            "effective_until": "2026-10-18",
            "source": {"publisher": "RTL", "url": "https://rtl.mv/"},
        }
        sea.transport.updates.catalogue = lambda: {"services": [reviewed]}
        imported = client.get(url, headers=headers)
        assert imported.status_code == 200
        assert len(imported.json()["routes"]) == 2
        reviewed["departure"] = "08:15:00"
        revised = client.get(url, headers={"if-none-match": imported.headers["etag"]})
        assert revised.status_code == 200
        assert revised.json()["routes"][-1]["departures"] == [495]
        # Incomplete source receipts must reach normal endpoint validation,
        # rather than returning old bytes from the HTTP cache.
        def failed_receipt():
            raise ValueError("A stored timetable receipt failed its integrity check.")

        sea.transport.updates.catalogue = failed_receipt
        assert client.get(url, headers=headers).status_code == 422


def test_air_http_key_tracks_source_coordinates_and_current_maldives_day(
    sea, tmp_path, monkeypatch
):
    path, source, features = prepare_air(sea, tmp_path)
    clock = SimpleNamespace(now=lambda *_: datetime(2026, 10, 20, 18, 59, tzinfo=UTC))
    monkeypatch.setattr("app.api.routes.air.datetime", clock)
    monkeypatch.setattr("app.api.snapshot_cache.datetime", clock)
    app = application(sea, tmp_path)
    url = "/api/v1/planning/air-network"
    with TestClient(app) as client:
        first = client.get(url)
        headers = {"if-none-match": first.headers["etag"]}
        assert first.json()["service_date"] == "2026-10-20"
        assert client.get(url, headers=headers).status_code == 304
        clock.now = lambda *_: datetime(2026, 10, 20, 19, 1, tzinfo=UTC)
        tomorrow = client.get(url, headers=headers)
        assert tomorrow.status_code == 200
        assert tomorrow.json()["service_date"] == "2026-10-21"
        source["routes"][0]["qualification"] = "A revised publication."
        path.write_text(json.dumps(source), encoding="utf-8")
        assert client.get(url).json()["routes"][0]["qualification"] == "A revised publication."
        features[1]["geometry"]["coordinates"] = [73.58, 2.91]
        assert client.get(url).json()["routes"][0]["geometry"]["coordinates"][-1] == [73.58, 2.91]
        assert client.get(url + "?date=invalid").status_code == 422
