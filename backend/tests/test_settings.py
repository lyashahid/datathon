"""Portable checkout defaults and optional, private configuration overrides."""

import os
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.analytics.sources import public_data_directory
from app.config.settings import BACKEND_ROOT, Settings
from app.vela.integration import integrated_settings


@pytest.fixture(autouse=True)
def clean_optional_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in os.environ:
        if name.startswith(("MOBILITY_", "VELA_")):
            monkeypatch.delenv(name)


def test_checkout_runs_without_environment_or_dotenv_from_any_directory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    # An unrelated working directory must not silently configure the backend.
    (tmp_path / ".env").write_text("MOBILITY_PORT=9123\n", encoding="utf-8")
    settings = Settings(_env_file=None)

    assert Settings.model_config["env_file"] == BACKEND_ROOT / ".env"
    assert settings.host == "127.0.0.1"
    assert settings.port == 8000
    assert settings.data_dir == BACKEND_ROOT / "data"
    assert settings.public_data_dir == BACKEND_ROOT.parent / "data" / "public"
    assert settings.vela_api_key == ""
    assert integrated_settings(settings).browser_enabled is True


def test_relative_override_paths_are_backend_relative(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("MOBILITY_DATA_DIR", "custom-runtime")
    monkeypatch.setenv("MOBILITY_PUBLIC_DATA_DIR", "../data/public")
    settings = Settings(_env_file=None)

    assert settings.data_dir == BACKEND_ROOT / "custom-runtime"
    assert settings.public_data_dir == BACKEND_ROOT.parent / "data" / "public"
    assert public_data_directory(settings) == settings.public_data_dir
    assert public_data_directory() == settings.public_data_dir


def test_absolute_override_paths_stay_absolute(tmp_path: Path) -> None:
    settings = Settings(_env_file=None, data_dir=tmp_path, public_data_dir=tmp_path / "public")

    assert settings.data_dir == tmp_path
    assert settings.public_data_dir == tmp_path / "public"


def test_shared_database_is_disabled_in_tests() -> None:
    settings = Settings(
        _env_file=None,
        environment="test",
        computed_cache_postgres_enabled=True,
        database_url="postgresql://example.invalid/private-cache",
    )

    assert settings.shared_cache_database_url == ""


@pytest.mark.parametrize("environment", ["development", "production"])
def test_shared_database_respects_explicit_disable(environment: str) -> None:
    url = "postgresql://example.invalid/private-cache"
    settings = Settings(_env_file=None, environment=environment, database_url=url)
    assert settings.shared_cache_database_url == url
    assert (
        settings.model_copy(
            update={"computed_cache_postgres_enabled": False}
        ).shared_cache_database_url
        == ""
    )


def test_optional_dotenv_configures_integrated_places_without_exporting_secrets(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    dotenv = tmp_path / "backend.env"
    dotenv.write_text(
        "MOBILITY_PORT=8100\n"
        "VELA_API_KEY=private-local-test-key\n"
        "VELA_BROWSER_ENABLED=false\n"
        "VELA_CORS_ORIGINS=http://localhost:5173, http://127.0.0.1:5173\n"
        "VELA_REQUEST_TIMEOUT=12\n"
        "VELA_MAX_CONCURRENT_REQUESTS=4\n"
        "VELA_RATE_LIMIT_PER_MINUTE=90\n"
        "VELA_CACHE_TTL=30\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("MOBILITY_PORT", "8200")
    settings = Settings(_env_file=dotenv)
    places = integrated_settings(settings)

    assert settings.port == 8200
    assert places.api_key == "private-local-test-key"
    assert places.browser_enabled is False
    assert places.cors_origins == ("http://localhost:5173", "http://127.0.0.1:5173")
    assert places.request_timeout == 12
    assert places.max_concurrent_requests == 4
    assert places.rate_limit_per_minute == 90
    assert places.cache_ttl == 30
    assert "VELA_API_KEY" not in os.environ
    assert "private-local-test-key" not in repr(settings)


@pytest.mark.parametrize(
    ("name", "value"),
    [
        ("VELA_REQUEST_TIMEOUT", "0"),
        ("VELA_MAX_CONCURRENT_REQUESTS", "65"),
        ("VELA_RATE_LIMIT_PER_MINUTE", "0"),
        ("VELA_CACHE_TTL", "-1"),
    ],
)
def test_invalid_places_overrides_fail_before_startup(
    name: str, value: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(name, value)
    with pytest.raises(ValidationError):
        Settings(_env_file=None)
