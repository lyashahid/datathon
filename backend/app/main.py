"""FastAPI application entry point."""

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.gzip import GZipMiddleware

from app.accessibility.config import DEFAULT_ACCESSIBILITY_CONFIG
from app.accessibility.service import AccessibilityService
from app.api.errors import (
    http_exception_handler,
    unhandled_exception_handler,
    validation_exception_handler,
)
from app.api.repository import NormalizedRepository
from app.api.routes.accessibility import router as accessibility_router
from app.api.routes.conditions import router as conditions_router
from app.api.routes.data_updates import router as data_updates_router
from app.api.routes.datasets import router as datasets_router
from app.api.routes.forecasts import router as forecasts_router
from app.api.routes.health import router as health_router
from app.api.routes.live import router as live_router
from app.api.routes.national import router as national_router
from app.api.routes.operations import router as operations_router
from app.api.routes.planning import router as planning_router
from app.api.routes.planning_reports import router as planning_reports_router
from app.api.routes.recommendations import router as recommendations_router
from app.api.routes.routing import router as routing_router
from app.api.routes.simulation import router as simulation_router
from app.api.snapshot_cache import SnapshotCacheMiddleware
from app.cli.precompute import precompute_startup
from app.conditions.service import ConditionsService
from app.config.settings import Settings
from app.data.computed_cache import ComputedCache, SourceVersion
from app.live.config import LiveConfig
from app.live.service import LiveService
from app.operations.service import NoticeStore
from app.planning.models import PlanningAssumptions
from app.planning.repository import PlanningRepository
from app.planning.service import PlanningService
from app.planning.transport import terminal_catalogue
from app.recommendation.service import RecommendationService
from app.routing.engine import RoutingRepository
from app.simulation.engine import ScenarioEngine
from app.vela.integration import integrated_settings, mount_places, places_lifespan


def configure_logging(level: str) -> None:
    logging.basicConfig(
        level=getattr(logging, level),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    app_settings = settings or Settings()
    configure_logging(app_settings.log_level)
    logger = logging.getLogger(__name__)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        app_settings.ensure_data_directories()
        app.state.repository.reload()
        app.state.routing.reload()
        app.state.planning.repository.ferry_terminals = terminal_catalogue(
            app.state.repository, app.state.routing, app_settings.public_data_dir
        )
        app.state.accessibility.reload()
        app.state.simulation.reload()
        app.state.recommendations.reload()
        app.state.live.reload()
        app.state.source_version.reset()
        app.state.source_version.version()
        logger.info("Starting %s in %s mode", app_settings.app_name, app_settings.environment)
        try:
            async with places_lifespan(_app):
                warmup = (
                    asyncio.create_task(precompute_startup(app), name="mobility-startup-precompute")
                    if app_settings.computed_cache_prewarm and app_settings.environment != "test"
                    else None
                )
                app.state.precompute_task = warmup
                try:
                    yield
                finally:
                    if warmup is not None:
                        if not warmup.done():
                            warmup.cancel()
                        await asyncio.gather(warmup, return_exceptions=True)
        finally:
            await app.state.conditions.close()
            await app.state.computed_cache.aclose()
        logger.info("Stopping %s", app_settings.app_name)

    app = FastAPI(
        title=app_settings.app_name,
        version="0.1.0",
        description="Local API for Mobility Sandbox MV.",
        lifespan=lifespan,
    )
    app.state.settings = app_settings
    app.state.computed_cache = ComputedCache(
        app_settings.data_dir / "runtime",
        memory_bytes=app_settings.computed_cache_memory_mb * 1024 * 1024,
        disk_bytes=app_settings.computed_cache_disk_mb * 1024 * 1024,
        max_entries=app_settings.computed_cache_max_entries,
        database_url=app_settings.database_url.get_secret_value()
        if app_settings.environment != "test"
        else "",
    )
    app.state.source_version = SourceVersion(
        app_settings.data_dir,
        app_settings.public_data_dir,
        configuration={
            "accessibility": DEFAULT_ACCESSIBILITY_CONFIG.model_dump(mode="json"),
            "planning": PlanningAssumptions().model_dump(mode="json"),
        },
    )
    app.add_middleware(
        SnapshotCacheMiddleware,
        cache=app.state.computed_cache,
        source=app.state.source_version,
    )
    app.add_middleware(GZipMiddleware, minimum_size=2048, compresslevel=5)
    app.state.planning = PlanningService(
        PlanningRepository(app_settings.public_data_dir), cache=app.state.computed_cache
    )
    app.state.conditions = ConditionsService()
    app.state.notices = NoticeStore(app_settings.data_dir / "runtime", app_settings.public_data_dir)
    app.state.repository = NormalizedRepository(app_settings.data_dir)
    app.state.routing = RoutingRepository(app_settings.data_dir)
    app.state.accessibility = AccessibilityService(
        app_settings.data_dir, app.state.routing, computed_cache=app.state.computed_cache
    )
    app.state.simulation = ScenarioEngine(app_settings.data_dir, app.state.routing)
    app.state.recommendations = RecommendationService(
        app_settings.data_dir,
        app.state.simulation,
        app.state.accessibility,
    )
    app.state.live = LiveService(
        app_settings.data_dir,
        LiveConfig(
            user_agent=app_settings.live_user_agent,
            cache_ttl_seconds=app_settings.live_cache_ttl_seconds,
            request_timeout_seconds=app_settings.live_request_timeout_seconds,
            poll_interval_seconds=app_settings.live_poll_interval_seconds,
            aircraft_enabled=app_settings.live_aircraft_enabled,
            vessel_enabled=app_settings.live_vessel_enabled,
            bus_enabled=app_settings.live_bus_enabled,
            followme_enabled=app_settings.live_followme_enabled,
            followme_min_interval_seconds=app_settings.live_followme_min_interval_seconds,
            followme_catalogue_ttl_seconds=app_settings.live_followme_catalogue_ttl_seconds,
        ),
    )

    app.add_exception_handler(StarletteHTTPException, http_exception_handler)
    app.add_exception_handler(HTTPException, http_exception_handler)
    app.add_exception_handler(RequestValidationError, validation_exception_handler)
    app.add_exception_handler(Exception, unhandled_exception_handler)
    app.include_router(health_router)
    app.include_router(national_router)
    app.include_router(routing_router)
    app.include_router(accessibility_router)
    app.include_router(simulation_router)
    app.include_router(recommendations_router)
    app.include_router(live_router)
    app.include_router(forecasts_router)
    app.include_router(datasets_router)
    app.include_router(planning_router)
    app.include_router(planning_reports_router)
    app.include_router(conditions_router)
    app.include_router(data_updates_router)
    app.include_router(operations_router)
    mount_places(app, integrated_settings(app_settings))

    @app.middleware("http")
    async def attach_settings(request: Request, call_next):
        request.state.settings = app_settings
        return await call_next(request)

    return app


app = create_app()
