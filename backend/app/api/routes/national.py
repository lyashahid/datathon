"""Normalized national data endpoints."""

from __future__ import annotations

import math
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from app.api.repository import NormalizedRepository

router = APIRouter(prefix="/api/v1", tags=["national-data"])
MapLayer = Literal["all", "islands", "infrastructure", "transport"]


def get_repository(request: Request) -> NormalizedRepository:
    return request.app.state.repository


@router.get("/islands")
def list_islands(
    query: str | None = Query(default=None, alias="q"),
    atoll: str | None = None,
    limit: int = Query(default=100, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    repository: NormalizedRepository = Depends(get_repository),
) -> dict[str, Any]:
    items, total = repository.list_islands(query=query, atoll=atoll, limit=limit, offset=offset)
    return {"items": items, "total": total, "limit": limit, "offset": offset}


@router.get("/islands/{island_id}")
def get_island(
    island_id: str,
    repository: NormalizedRepository = Depends(get_repository),
) -> dict[str, Any]:
    result = repository.island_detail(island_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Island not found: {island_id}")
    return result


@router.get("/islands/{island_id}/profile")
def get_island_profile(
    island_id: str,
    request: Request,
    repository: NormalizedRepository = Depends(get_repository),
) -> dict[str, Any]:
    island = repository.island_detail(island_id)
    if island is None:
        raise HTTPException(status_code=404, detail=f"Island not found: {island_id}")
    accessibility = request.app.state.accessibility.score_island(island_id)
    infrastructure_items = repository.infrastructure(island_id=island_id)
    transport_items = repository.transport_features(island_id)
    population = repository.population_summary(island_id)
    unresolved_facilities = [
        item
        for item in infrastructure_items
        if item.get("geometry_quality") != "official_exact" or not item.get("geometry")
    ]
    provisional_facilities = [
        item
        for item in infrastructure_items
        if item.get("match_status") == "osm_provisional_review_required"
    ]
    warnings = []
    if not population["record_count"]:
        warnings.append("No island-specific census count is available; population is unknown.")
    if not population["demographic_breakdown"]:
        warnings.append(
            "Island age breakdown is unavailable; no age-specific resident demand is estimated."
        )
    if unresolved_facilities:
        warnings.append("some official facilities are not safely geocoded")
    return {
        "island": island,
        "population": population,
        "infrastructure": {
            "items": infrastructure_items,
            "total": len(infrastructure_items),
        },
        "transport": {
            "items": transport_items,
            "total": len(transport_items),
        },
        "accessibility": accessibility,
        "data_quality": {
            "warnings": warnings,
            "official_facility_count": len(infrastructure_items),
            "unresolved_facility_count": len(unresolved_facilities),
            "provisional_facility_count": len(provisional_facilities),
            "population_record_count": population["record_count"],
        },
    }


@router.get("/map/features")
def map_features(
    layer: MapLayer = Query(default="all"),
    island_id: str | None = None,
    category: str | None = None,
    include_unlocated: bool = False,
    repository: NormalizedRepository = Depends(get_repository),
) -> JSONResponse:
    if island_id and island_id not in repository.islands_by_id:
        raise HTTPException(status_code=404, detail=f"Island not found: {island_id}")
    # Repository snapshots are already JSON-native. Render in this sync worker
    # instead of recursively re-encoding large polygons on the event loop.
    return JSONResponse(
        repository.map_features(
            layer=layer,
            island_id=island_id,
            category=category,
            include_unlocated=include_unlocated,
        )
    )


@router.get("/national/summary")
def national_summary(
    request: Request,
    repository: NormalizedRepository = Depends(get_repository),
) -> dict[str, Any]:
    artifact = request.app.state.accessibility.default_artifact()
    return {
        **repository.summary,
        "accessibility_status": "calculated",
        "accessibility": artifact["summary"],
        "accessibility_population_transform_version": artifact["population_transform_version"],
    }


@router.get("/map/context")
def map_context(
    bbox: str = Query(description="west,south,east,north in WGS84; at most 1 degree per side"),
    repository: NormalizedRepository = Depends(get_repository),
) -> JSONResponse:
    try:
        bounds = [float(x) for x in bbox.split(",")]
        if len(bounds) != 4 or not all(math.isfinite(x) for x in bounds):
            raise ValueError
        west, south, east, north = bounds
        if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
            raise ValueError
        if east - west > 1 or north - south > 1:
            raise ValueError
    except ValueError:
        raise HTTPException(status_code=422, detail="Use a valid local bbox, at most 1° per side.")
    return JSONResponse(repository.map_context.query(bounds))
