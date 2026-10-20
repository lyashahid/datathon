"""Validated application settings and runtime directory management."""

from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_ROOT = Path(__file__).resolve().parents[2]


def backend_path(value: str | Path) -> Path:
    """Resolve optional path overrides consistently from any working directory."""

    path = Path(value).expanduser()
    return (path if path.is_absolute() else BACKEND_ROOT / path).resolve()


class Settings(BaseSettings):
    """Configuration loaded from environment variables with explicit defaults."""

    model_config = SettingsConfigDict(
        env_prefix="MOBILITY_",
        env_file=BACKEND_ROOT / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    app_name: str = "Mobility Sandbox MV API"
    environment: Literal["development", "test", "production"] = "development"
    host: str = "127.0.0.1"
    port: int = Field(default=8000, ge=1, le=65535)
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    data_dir: Path = BACKEND_ROOT / "data"
    public_data_dir: Path = BACKEND_ROOT.parent / "data" / "public"
    database_url: SecretStr = Field(default=SecretStr(""), repr=False)
    computed_cache_postgres_enabled: bool = True
    computed_cache_memory_mb: int = Field(default=64, ge=0, le=1024)
    computed_cache_disk_mb: int = Field(default=512, ge=0, le=8192)
    computed_cache_max_entries: int = Field(default=256, ge=1, le=10000)
    computed_cache_prewarm: bool = True
    live_user_agent: str = "MobilitySandboxMV/0.1 (live layer; contact: unset)"
    live_cache_ttl_seconds: int = Field(default=60, ge=1, le=3600)
    live_request_timeout_seconds: float = Field(default=10.0, gt=0, le=60)
    live_poll_interval_seconds: int = Field(default=60, ge=5, le=3600)
    live_aircraft_enabled: bool = True
    live_vessel_enabled: bool = True
    live_bus_enabled: bool = False
    live_followme_enabled: bool = True
    live_followme_min_interval_seconds: float = Field(default=1.0, ge=0, le=60)
    live_followme_catalogue_ttl_seconds: int = Field(default=900, ge=1, le=86400)

    # The integrated Vela API shares the same optional backend/.env file. These
    # aliases preserve the original API's public setting names without requiring
    # a second dotenv loader or mutating the process environment.
    vela_api_key: str = Field(default="", validation_alias="VELA_API_KEY", repr=False)
    vela_browser_enabled: bool = Field(default=True, validation_alias="VELA_BROWSER_ENABLED")
    vela_cors_origins: str = Field(default="", validation_alias="VELA_CORS_ORIGINS")
    vela_request_timeout: float = Field(
        default=25, ge=1, le=60, validation_alias="VELA_REQUEST_TIMEOUT"
    )
    vela_max_concurrent_requests: int = Field(
        default=8, ge=1, le=64, validation_alias="VELA_MAX_CONCURRENT_REQUESTS"
    )
    vela_rate_limit_per_minute: int = Field(
        default=60, ge=1, validation_alias="VELA_RATE_LIMIT_PER_MINUTE"
    )
    vela_cache_ttl: int = Field(default=120, ge=0, validation_alias="VELA_CACHE_TTL")

    @field_validator("data_dir", "public_data_dir", mode="after")
    @classmethod
    def resolve_data_path(cls, value: Path) -> Path:
        return backend_path(value)

    @property
    def shared_cache_database_url(self) -> str:
        """Use an explicitly configured shared cache outside isolated tests.

        Memory and persistent local disk remain the request fast path; the
        database shares public precomputations across production deployments.
        """
        if self.environment == "test" or not self.computed_cache_postgres_enabled:
            return ""
        return self.database_url.get_secret_value()

    def ensure_data_directories(self) -> None:
        """Create only the backend-owned runtime cache directories."""

        for directory in (
            self.data_dir,
            self.data_dir / "cache" / "raw",
            self.data_dir / "cache" / "normalized",
            self.data_dir / "cache" / "graphs",
            self.data_dir / "cache" / "derived",
            self.data_dir / "metadata",
            self.data_dir / "runtime",
        ):
            directory.mkdir(parents=True, exist_ok=True)
