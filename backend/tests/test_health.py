from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi import Request
from fastapi.testclient import TestClient

from app.api.routes.data_updates import get_service as get_updates
from app.api.routes.datasets import get_service as get_datasets
from app.api.routes.forecasts import get_service as get_forecasts
from app.config.settings import Settings
from app.main import create_app


def test_health_returns_ok(tmp_path: Path) -> None:
    settings = Settings(environment="test", data_dir=tmp_path)
    client = TestClient(create_app(settings))

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "Mobility Sandbox MV API",
        "environment": "test",
    }


def test_health_creates_backend_data_directories(tmp_path: Path) -> None:
    settings = Settings(environment="test", data_dir=tmp_path / "runtime-data")
    client = TestClient(create_app(settings))

    with client:
        response = client.get("/health")

    assert response.status_code == 200
    assert (settings.data_dir / "cache" / "raw").is_dir()
    assert (settings.data_dir / "cache" / "normalized").is_dir()
    assert (settings.data_dir / "cache" / "graphs").is_dir()
    assert (settings.data_dir / "cache" / "derived").is_dir()
    assert (settings.data_dir / "metadata").is_dir()


def test_not_found_uses_api_error_shape(tmp_path: Path) -> None:
    settings = Settings(environment="test", data_dir=tmp_path)
    client = TestClient(create_app(settings))

    response = client.get("/does-not-exist")

    assert response.status_code == 404
    assert response.json() == {
        "error": {
            "code": "http_error",
            "message": "Not Found",
        }
    }


def test_concurrent_dependencies_reuse_services_and_one_dataset_cache(tmp_path, monkeypatch):
    app = create_app(
        Settings(
            environment="test", data_dir=tmp_path / "data", public_data_dir=tmp_path / "public"
        )
    )
    request = Request({"type": "http", "app": app})

    def unexpected_construction(*_, **__):
        pytest.fail("Shared services must exist before concurrent requests begin")

    monkeypatch.setattr("app.api.routes.forecasts.ForecastService", unexpected_construction)
    monkeypatch.setattr("app.api.routes.datasets.DatasetService", unexpected_construction)
    monkeypatch.setattr("app.api.routes.data_updates.DataUpdateService", unexpected_construction)
    with ThreadPoolExecutor(max_workers=8) as pool:
        results = list(
            pool.map(
                lambda _: (get_forecasts(request), get_datasets(request), get_updates(request)),
                range(24),
            )
        )
    assert all(
        forecast is app.state.forecasts
        and datasets is app.state.datasets
        and updates is app.state.data_updates
        for forecast, datasets, updates in results
    )
    assert app.state.forecasts.evidence_analysis.datasets is app.state.datasets
