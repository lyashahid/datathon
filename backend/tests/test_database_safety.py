"""Deployment cannot use the shared DB, and schema setup is explicit/local."""

from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes import data_updates, forecasts
from app.cli.database_setup import initialize_shared_cache
from app.config.settings import Settings
from app.data.computed_cache import PostgresStore
from app.main import create_app


def test_runtime_postgres_connection_never_runs_schema_setup(monkeypatch):
    connect = MagicMock()
    monkeypatch.setattr("psycopg.connect", connect)
    store = PostgresStore("postgresql://example.invalid/cache")

    connection = store._connect()

    assert connection is connect.return_value
    connect.assert_called_once()
    connection.execute.assert_not_called()
    store.close()


@pytest.mark.parametrize("environment", ["production", "test"])
def test_explicit_database_setup_refuses_deployed_environments(monkeypatch, environment):
    connect = MagicMock()
    monkeypatch.setattr("psycopg.connect", connect)

    with pytest.raises(ValueError, match="local development checkout"):
        initialize_shared_cache(
            Settings(
                _env_file=None,
                environment=environment,
                database_url="postgresql://example.invalid/cache",
            )
        )

    connect.assert_not_called()


def test_local_setup_creates_only_cache_table_in_existing_schema(monkeypatch):
    connect = MagicMock()
    monkeypatch.setattr("psycopg.connect", connect)

    initialize_shared_cache(
        Settings(
            _env_file=None,
            environment="development",
            computed_cache_postgres_enabled=True,
            database_url="postgresql://example.invalid/cache?schema=mobility",
        )
    )

    connect.assert_called_once()
    assert "search_path=mobility" in connect.call_args.kwargs["options"]
    connection = connect.return_value.__enter__.return_value
    connection.execute.assert_called_once_with(
        "CREATE TABLE IF NOT EXISTS mobility_computed_cache ("
        "cache_key text PRIMARY KEY, payload bytea NOT NULL, "
        "created_at timestamptz NOT NULL DEFAULT now())"
    )


async def test_production_computation_and_mirror_never_touch_shared_database(tmp_path, monkeypatch):
    connect = MagicMock(side_effect=AssertionError("Production must not connect to shared DB"))
    monkeypatch.setattr("psycopg.connect", connect)
    app = create_app(
        Settings(
            _env_file=None,
            environment="production",
            data_dir=tmp_path / "data",
            public_data_dir=tmp_path / "public",
            database_url="postgresql://example.invalid/shared",
            computed_cache_postgres_enabled=True,
            vela_browser_enabled=False,
        )
    )
    cache = app.state.computed_cache
    try:
        assert cache.get_or_compute("snapshot-http", "country", lambda: {"score": 51}) == {
            "score": 51
        }
        await cache.mirror_public_results()
        assert cache.status()["shared"] == {"configured": False}
        assert len(list(cache.root.glob("*.cache"))) == 1
        connect.assert_not_called()
    finally:
        await app.state.conditions.close()
        await cache.aclose()


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/forecasts/sources/stage",
        "/api/v1/forecasts/sources/example/accept",
        "/api/v1/data-updates/schedules/stage",
        "/api/v1/data-updates/schedules/example/accept",
    ],
)
def test_public_production_cannot_stage_or_accept_authoritative_sources(path):
    app = FastAPI()
    app.state.settings = Settings(_env_file=None, environment="production")
    # Any source service call would fail the test, including an attempted
    # write before request-body validation or a path-identifier error.
    service = MagicMock()
    app.include_router(forecasts.router)
    app.include_router(data_updates.router)
    app.dependency_overrides[forecasts.get_service] = lambda: service
    app.dependency_overrides[data_updates.get_service] = lambda: service

    response = TestClient(app).post(path, json={})

    assert response.status_code == 403
    assert "local checkout" in response.json()["detail"]
    assert not service.mock_calls


@pytest.mark.parametrize("environment", ["production", "development"])
def test_source_status_exposes_maintenance_availability(environment):
    app = FastAPI()
    app.state.settings = Settings(_env_file=None, environment=environment)
    service = MagicMock()
    service.source_history.return_value = {"versions": []}
    service.status.return_value = {"sources": []}
    app.include_router(forecasts.router)
    app.include_router(data_updates.router)
    app.dependency_overrides[forecasts.get_service] = lambda: service
    app.dependency_overrides[data_updates.get_service] = lambda: service
    client = TestClient(app)

    for path in ("/api/v1/forecasts/sources", "/api/v1/data-updates"):
        response = client.get(path)
        assert response.status_code == 200
        assert response.json()["source_mutations_allowed"] is (environment != "production")


def test_production_does_not_build_missing_source_artifact_at_startup(tmp_path, monkeypatch):
    raw = tmp_path / "data/cache/raw/osm/maldives-latest.osm.pbf"
    raw.parent.mkdir(parents=True)
    raw.write_bytes(b"local fixture is never parsed in production")
    build = MagicMock(side_effect=AssertionError("Source preparation must happen locally"))
    monkeypatch.setattr("app.data.map_context.build_context", build)

    app = create_app(
        Settings(
            _env_file=None,
            environment="production",
            data_dir=tmp_path / "data",
            public_data_dir=tmp_path / "public",
            vela_browser_enabled=False,
        )
    )

    assert app.state.repository.map_context.features == []
    build.assert_not_called()
