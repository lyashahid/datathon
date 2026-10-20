"""Routing endpoints over prewarmed graph artifacts."""

from __future__ import annotations

from datetime import date
from typing import Any, Callable

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field

from app.api.routes.planning import get_planning
from app.models.coordinates import Coordinates
from app.planning.repository import IDENTITY_BRIDGE
from app.planning.routing import pattern_trips
from app.planning.service import PlanningService
from app.routing.engine import RoutingRepository
from app.routing.journeys import route_journey
from app.routing.multistop import TravelMode, route_multistop

router = APIRouter(prefix="/api/v1/routing", tags=["routing"])


class LandRouteRequest(BaseModel):
    start: Coordinates = Field(description="Start longitude and latitude")
    end: Coordinates = Field(description="End longitude and latitude")
    mode: str = Field(default="walk", pattern="^(walk|bicycle|car|taxi|bus|transit)$")
    island_id: str | None = None
    service_date: date | None = None
    departure_minutes: float = Field(default=920, ge=0, lt=1440, allow_inf_nan=False)


class MarineRouteRequest(BaseModel):
    start_node_id: str
    end_node_id: str
    include_unverified: bool = False


class MapJourneyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    points: list[Coordinates] = Field(min_length=2, max_length=10)
    mode: TravelMode = "walk"
    service_date: date | None = None
    departure_minutes: float = Field(default=920, ge=0, lt=1440, allow_inf_nan=False)
    route_ids: list[str] | None = Field(default=None, min_length=1, max_length=10)


def get_routing(request: Request) -> RoutingRepository:
    return request.app.state.routing


def _cached_direction(
    request: Request, payload: BaseModel, compute: Callable[[], dict[str, Any]]
) -> dict[str, Any]:
    """Private, deterministic POST results reuse the source-versioned disk cache."""
    state = request.app.state
    cache, source = getattr(state, "computed_cache", None), getattr(state, "source_version", None)
    if cache is None or source is None:
        return compute()
    repository = state.planning.repository
    fingerprint = getattr(repository, "baseline_fingerprint", lambda: repository.baseline)()
    resolved_date = (
        payload.service_date.isoformat()
        if payload.service_date
        else repository.baseline.get("referenceDate") or date.today().isoformat()
    )
    return cache.get_or_compute(
        "map-directions",
        [
            request.url.path,
            source.version(),
            fingerprint,
            state.routing.revision,
            resolved_date,
            payload.model_dump(mode="json"),
        ],
        compute,
    )


@router.post("/land")
def route_land(
    payload: LandRouteRequest,
    request: Request,
    routing: RoutingRepository = Depends(get_routing),
    planning: PlanningService = Depends(get_planning),
) -> dict[str, Any]:
    if payload.mode in {"bus", "transit"}:
        return _cached_direction(
            request,
            payload,
            lambda: route_journey(
                planning.repository,
                list(payload.start),
                list(payload.end),
                payload.service_date,
                payload.departure_minutes,
            ),
        )
    return _cached_direction(
        request,
        payload,
        lambda: routing.route_land(
            list(payload.start),
            list(payload.end),
            payload.mode,
            payload.island_id,
        ),
    )


@router.post("/marine")
def route_marine(
    payload: MarineRouteRequest,
    routing: RoutingRepository = Depends(get_routing),
) -> dict[str, Any]:
    return routing.route_marine(
        payload.start_node_id,
        payload.end_node_id,
        payload.include_unverified,
    )


@router.post("/journey")
def map_journey(
    payload: MapJourneyRequest,
    request: Request,
    routing: RoutingRepository = Depends(get_routing),
    planning: PlanningService = Depends(get_planning),
) -> dict[str, Any]:
    return _cached_direction(
        request,
        payload,
        lambda: route_multistop(
            routing,
            planning.repository,
            [list(point) for point in payload.points],
            payload.mode,
            payload.service_date,
            payload.departure_minutes,
            payload.route_ids,
        ),
    )


@router.get("/stops")
def transit_stops(
    island_id: str | None = None,
    planning: PlanningService = Depends(get_planning),
) -> dict[str, Any]:
    """Public stop points without transferring the full planning street graph."""
    repository = planning.repository
    scope = repository.planning_id(island_id)
    baseline = repository.baseline
    patterns = baseline.get("transit", {}).get("patterns", [])
    routes = baseline.get("transit", {}).get("routes", [])
    stops = baseline.get("transit", {}).get("stops", [])
    route_names = {pattern["routeId"]: pattern["name"] for pattern in patterns}
    route_names.update(
        {
            route["id"]: " · ".join(
                text for text in (route.get("routeNumber"), route.get("name")) if text
            )
            for route in routes
        }
    )
    scoped_stops = {
        stop["id"]
        for stop in stops
        if (not scope or stop.get("islandId") == scope) and not stop.get("disabled")
    }
    reference_date = baseline.get("referenceDate")
    selected_date = date.fromisoformat(reference_date) if reference_date else date.today()
    departures = [
        trip["stopTimes"][index]["departureMinutes"]
        for pattern in patterns
        for trip in pattern_trips(pattern, selected_date)
        for index, stop_id in enumerate(pattern.get("stopIds", [])[:-1])
        if stop_id in scoped_stops and 0 <= trip["stopTimes"][index]["departureMinutes"] < 1440
    ]
    return {
        "stops": [
            {
                "id": stop["id"],
                "name": stop.get("name") or "Bus stop",
                "coordinates": [stop["lon"], stop["lat"]],
                "island_id": stop.get("islandId"),
                "national_island_id": IDENTITY_BRIDGE.get(stop.get("islandId")),
                "operator_code": stop.get("operatorCode"),
                "route_ids": stop.get("routeIds", []),
                "route_names": list(
                    dict.fromkeys(
                        route_names[route_id]
                        for route_id in stop.get("routeIds", [])
                        if route_names.get(route_id)
                    )
                ),
                "mode": stop.get("mode", "bus"),
                "verification": stop.get("verification", "unverified"),
                "timetable_status": stop.get("timetableStatus", "unavailable"),
            }
            for stop in stops
            if stop["id"] in scoped_stops
        ],
        "service_date": baseline.get("referenceDate"),
        "earliest_departure_minutes": min(departures) if departures else None,
        "timezone": "Indian/Maldives",
        "qualification": "Operator-published stop points and a dated remaining-departure "
        "timetable. Physical stop operation and live arrivals are not independently verified.",
    }


@router.get("/patterns")
def transit_patterns(
    route_id: str,
    planning: PlanningService = Depends(get_planning),
) -> dict[str, Any]:
    """Retained corridor geometry for one route, without assuming valid driving directions."""
    patterns = planning.repository.baseline.get("transit", {}).get("patterns", [])
    return {
        "patterns": [
            {
                "id": pattern["id"],
                "route_id": pattern["routeId"],
                "name": pattern["name"],
                "stop_ids": pattern["stopIds"],
                "segment_geometry": pattern.get("segmentGeometry", []),
                "qualification": pattern.get("qualification"),
            }
            for pattern in patterns
            if pattern["routeId"] == route_id
        ],
        "qualification": "Road-derived corridor geometry, not an operator-published route trace. "
        "Reversing a corridor does not establish legal driving direction or a timetable.",
    }
