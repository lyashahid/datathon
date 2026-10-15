from pathlib import Path

from fastapi.testclient import TestClient

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
