"""Regressions for malformed public requests found during backend migration."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config.settings import Settings
from app.main import create_app


@pytest.mark.parametrize(
    ("path", "payload"),
    [
        (
            "/api/v1/simulation/run",
            {"scenario": {"id": "bad", "name": "Bad", "operations": [{"type": "add_bus_stop"}]}},
        ),
        (
            "/api/v1/simulation/run",
            {"scenario": {"id": "bad", "name": "Bad", "operations": [{"type": "unknown"}]}},
        ),
        (
            "/api/v1/simulation/run",
            {
                "scenario": {
                    "id": "bad",
                    "name": "Bad",
                    "operations": [{"type": "add_bus_stop", "coordinates": [181, 91]}],
                }
            },
        ),
        (
            "/api/v1/recommendations",
            {"type": "bus_stop", "config": {"benefit_weight": 0.1, "confidence_weight": 0.1}},
        ),
        (
            "/api/v1/routing/land",
            {"start": [200, 4], "end": [73, 4]},
        ),
        (
            "/api/v1/routing/land",
            {"start": [73, 4], "end": [73, 4], "mode": "spaceship"},
        ),
    ],
)
def test_invalid_json_requests_return_serializable_validation_errors(
    tmp_path: Path, path: str, payload: dict,
) -> None:
    with TestClient(create_app(Settings(environment="test", data_dir=tmp_path))) as client:
        response = client.post(path, json=payload)

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"
    assert response.json()["error"]["details"]


@pytest.mark.parametrize("endpoint", ["snapshot", "stream"])
@pytest.mark.parametrize(
    "query",
    [
        "bbox=bad",
        "bbox=71,4,74,5",
        "latitude=91",
        "latitude=nan",
        "longitude=inf",
        "radius_nm=0",
        "followme_vessel_ids=-1",
        "&".join("followme_vessel_ids=1" for _ in range(21)),
    ],
)
def test_live_query_validation_runs_before_provider_calls(
    tmp_path: Path, endpoint: str, query: str,
) -> None:
    app = create_app(Settings(environment="test", data_dir=tmp_path))

    async def should_not_fetch(_query):
        raise AssertionError("Invalid queries must not reach live providers")

    app.state.live.snapshot = should_not_fetch
    with TestClient(app) as client:
        response = client.get(f"/api/v1/live/{endpoint}?{query}")

    assert response.status_code == 422
    details = response.json()["error"]["details"]
    assert all(error["loc"][0] == "query" for error in details)


@pytest.mark.parametrize("endpoint", ["run", "compare"])
def test_simulation_rejects_missing_requested_island(tmp_path: Path, endpoint: str) -> None:
    scenario = {"id": "test", "name": "Test"}
    payload = {"island_id": "island:missing"}
    if endpoint == "run":
        payload["scenario"] = scenario
    else:
        payload.update(first=scenario, second=scenario)
    with TestClient(create_app(Settings(environment="test", data_dir=tmp_path))) as client:
        response = client.post(f"/api/v1/simulation/{endpoint}", json=payload)

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "http_error"
