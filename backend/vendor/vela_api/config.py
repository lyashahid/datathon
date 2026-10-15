import json
import os
from dataclasses import dataclass
from importlib.resources import files


@dataclass(frozen=True)
class Settings:
    api_key: str = ""
    browser_enabled: bool = False
    cors_origins: tuple[str, ...] = ()
    request_timeout: float = 25
    max_concurrent_requests: int = 8
    rate_limit_per_minute: int = 60
    cache_ttl: int = 120
    cache_size: int = 256
    max_response_bytes: int = 25 * 1024 * 1024
    max_image_bytes: int = 8 * 1024 * 1024

    @classmethod
    def from_env(cls):
        result = cls(
            api_key=os.getenv("VELA_API_KEY", ""),
            browser_enabled=os.getenv("VELA_BROWSER_ENABLED", "false").lower() == "true",
            cors_origins=tuple(
                x.strip() for x in os.getenv("VELA_CORS_ORIGINS", "").split(",") if x.strip()
            ),
            request_timeout=float(os.getenv("VELA_REQUEST_TIMEOUT", "25")),
            max_concurrent_requests=int(os.getenv("VELA_MAX_CONCURRENT_REQUESTS", "8")),
            rate_limit_per_minute=int(os.getenv("VELA_RATE_LIMIT_PER_MINUTE", "60")),
            cache_ttl=int(os.getenv("VELA_CACHE_TTL", "120")),
        )
        if not 1 <= result.request_timeout <= 60:
            raise ValueError("VELA_REQUEST_TIMEOUT must be between 1 and 60 seconds")
        if (
            not 1 <= result.max_concurrent_requests <= 64
            or result.rate_limit_per_minute < 1
            or result.cache_ttl < 0
        ):
            raise ValueError("Invalid concurrency, rate limit, or cache TTL")
        return result


def load_calibration():
    # Pinned local data only: no unsigned remote configuration or script execution.
    return json.loads(
        files(__package__).joinpath("data/calibration.json").read_text(encoding="utf-8")
    )
