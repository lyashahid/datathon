"""Optional transient live-data status, snapshots, and SSE delivery."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from app.live.models import LiveQuery
from app.live.service import LiveService

router = APIRouter(prefix="/api/v1/live", tags=["live"])


def get_live(request: Request) -> LiveService:
    return request.app.state.live


def get_live_query(
    latitude: float = 4.1755,
    longitude: float = 73.5093,
    radius_nm: float = 250,
    include_fallback: bool = True,
    route_code: str | None = None,
    bbox: str | None = None,
    followme_vessel_ids: list[int] | None = Query(default=None),
    include_followme_catalogue: bool = False,
    discover_nearby: bool = False,
    island_name: str | None = None,
    max_age_seconds: int = 120,
    include_stale: bool = False,
) -> LiveQuery:
    """Validate all GET fields, including repeated vessel IDs, before provider calls."""
    try:
        return LiveQuery(
            latitude=latitude,
            longitude=longitude,
            radius_nm=radius_nm,
            include_fallback=include_fallback,
            route_code=route_code,
            bbox=bbox,
            followme_vessel_ids=followme_vessel_ids or [],
            include_followme_catalogue=include_followme_catalogue,
            discover_nearby=discover_nearby,
            island_name=island_name,
            max_age_seconds=max_age_seconds,
            include_stale=include_stale,
        )
    except ValidationError as error:
        errors = [{**item, "loc": ("query", *item["loc"])} for item in error.errors()]
        raise RequestValidationError(errors) from error


@router.get("/status")
def live_status(service: LiveService = Depends(get_live)) -> dict[str, Any]:
    return service.status()


@router.get("/snapshot")
async def live_snapshot(
    query: LiveQuery = Depends(get_live_query),
    service: LiveService = Depends(get_live),
) -> dict[str, Any]:
    return await service.snapshot(query)


@router.get("/stream")
async def live_stream(
    query: LiveQuery = Depends(get_live_query),
    once: bool = Query(default=True),
    service: LiveService = Depends(get_live),
) -> StreamingResponse:
    return StreamingResponse(
        service.stream(query, once=once),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
