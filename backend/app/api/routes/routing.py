"""Routing endpoints over prewarmed graph artifacts."""

from __future__ import annotations

from datetime import date
from typing import Any

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from app.api.routes.planning import get_planning
from app.models.coordinates import Coordinates
from app.planning.service import PlanningService
from app.routing.engine import RoutingRepository
from app.routing.journeys import route_journey

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


def get_routing(request: Request) -> RoutingRepository:
    return request.app.state.routing


@router.post("/land")
def route_land(
    payload: LandRouteRequest,
    routing: RoutingRepository = Depends(get_routing),
    planning: PlanningService = Depends(get_planning),
) -> dict[str, Any]:
    if payload.mode in {"bus", "transit"}:
        return route_journey(
            planning.repository,
            list(payload.start),
            list(payload.end),
            payload.service_date,
            payload.departure_minutes,
        )
    return routing.route_land(
        list(payload.start),
        list(payload.end),
        payload.mode,
        payload.island_id,
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
    departures = [
        trip["stopTimes"][0]["departureMinutes"]
        for pattern in patterns
        for trip in pattern.get("timing", {}).get("trips", [])
        if trip.get("stopTimes")
    ]
    return {
        "stops": [
            {
                "id": stop["id"],
                "name": stop.get("name") or "Bus stop",
                "coordinates": [stop["lon"], stop["lat"]],
                "island_id": stop.get("islandId"),
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
            if (not scope or stop.get("islandId") == scope) and not stop.get("disabled")
        ],
        "service_date": baseline.get("referenceDate"),
        "earliest_departure_minutes": min(departures) if departures else None,
        "timezone": "Indian/Maldives",
        "qualification": "Operator-published stop points and a dated remaining-departure "
        "timetable. Physical stop operation and live arrivals are not independently verified.",
    }
