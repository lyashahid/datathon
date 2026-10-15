"""Mount the complete vendored FastAPI service and own its resource lifecycle.

The child application keeps its own validation/error contract, rate limiter,
bounded cache, anonymous HTTP session and optional browser session. Mounted
applications do not receive FastAPI lifespan events automatically, so the parent
must enter ``places_lifespan`` from its lifespan context.
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.config.settings import Settings as ApplicationSettings
from vendor.vela_api.app import create_app
from vendor.vela_api.config import Settings

PLACES_PREFIX = "/api/v1/places"


def integrated_settings(settings: ApplicationSettings) -> Settings:
    """Use portable parent defaults and its optional dotenv overrides."""

    return Settings(
        api_key=settings.vela_api_key,
        browser_enabled=settings.vela_browser_enabled,
        cors_origins=tuple(
            origin.strip() for origin in settings.vela_cors_origins.split(",") if origin.strip()
        ),
        request_timeout=settings.vela_request_timeout,
        max_concurrent_requests=settings.vela_max_concurrent_requests,
        rate_limit_per_minute=settings.vela_rate_limit_per_minute,
        cache_ttl=settings.vela_cache_ttl,
    )


def mount_places(
    application: FastAPI,
    settings: Settings | None = None,
    *,
    client=None,
) -> FastAPI:
    """Register every Vela endpoint beneath the shared backend API namespace."""
    child = create_app(settings=settings, client=client, route_prefix="", integrated=True)
    application.state.places_api = child
    application.mount(PLACES_PREFIX, child, name="places")
    return child


@asynccontextmanager
async def places_lifespan(application: FastAPI) -> AsyncIterator[None]:
    """Start and close the child service's HTTP and Chromium resources."""
    child = application.state.places_api
    async with child.router.lifespan_context(child):
        yield


def get_directions_service(application: FastAPI):
    """Return the same live consumer-directions adapter used by the places API.

    Call after the parent lifespan has started. Its HTTP transport supplies
    finite deadlines/concurrency/response bounds, and missing upstream traffic
    timings remain null rather than being synthesized.
    """
    return application.state.places_api.state.directions
