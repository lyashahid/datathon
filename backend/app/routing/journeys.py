"""Map-selected A/B journeys using the same dated network as policy planning.

This adapter enriches calculated legs with public stop names and explicit waits.
It never converts road permission for a bus into a claimed passenger service.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from app.planning.models import PlanningAssumptions
from app.planning.repository import PlanningRepository
from app.planning.routing import JourneyRouter
from app.planning.world import baseline_world
from app.routing.engine import _distance_m


def _point(item: dict[str, Any], fallback: str = "Bus stop") -> dict[str, Any]:
    return {
        "id": item["id"],
        "name": item.get("name") or fallback,
        "coordinates": [item["lon"], item["lat"]],
        "island_id": item.get("islandId"),
        "operator_code": item.get("operatorCode"),
    }


def _walk_geometry(
    geometry: list[list[float]], start: dict[str, Any], end: dict[str, Any]
) -> list[list[float]]:
    """Expose short graph snap connectors, without filling missing graph paths."""
    if not geometry:
        return []
    points = [start["coordinates"], *geometry, end["coordinates"]]
    return [point for index, point in enumerate(points) if index == 0 or point != points[index - 1]]


def route_journey(
    repository: PlanningRepository,
    start: list[float],
    end: list[float],
    service_date: date | None = None,
    departure_minutes: float = 920,
) -> dict[str, Any]:
    snapshot_date = repository.baseline.get("referenceDate")
    selected_date = service_date or (
        date.fromisoformat(snapshot_date) if snapshot_date else date.today()
    )
    assumptions = PlanningAssumptions(date=selected_date, departure_minutes=departure_minutes)
    origin = {"id": "journey:start", "name": "Start", "lon": start[0], "lat": start[1]}
    destination = {"id": "journey:end", "name": "Destination", "lon": end[0], "lat": end[1]}
    world = baseline_world(repository)
    router = JourneyRouter(world, assumptions, [destination])
    result = router.route(origin)
    if result["status"] != "reachable":
        result["reason"] = (
            "Choose points near a mapped street in Greater Malé. Bus directions are "
            "not available outside the supplied street network."
            if "does not snap" in result["reason"]
            else (
                f"No verified bus timetable is available for {selected_date.isoformat()}. "
                "We cannot confirm a timed journey between these points on that date."
                if selected_date.isoformat() != snapshot_date
                else "We cannot confirm a timed journey between these points with the available "
                "bus and ferry timetables. Missing service information can prevent a result."
            )
        )
    points = {item["id"]: _point(item) for item in [*world["stops"], origin, destination]}
    patterns = {item["id"]: item for item in world["patterns"]}
    source_date_label = snapshot_date or "the source date"
    warnings = [
        f"Bus times are a captured remaining-departure timetable for {source_date_label}, "
        "not live arrival predictions or a verified recurring calendar.",
        "Ferry crossings cannot be routed until crossing durations and stop IDs are verified.",
    ]
    if selected_date.isoformat() != snapshot_date:
        warnings.append("No verified bus calendar is available on the selected date.")
    active_services = sum(bool(trips) for trips in router.trips.values())
    legs = []
    stop_roles: dict[str, dict[str, Any]] = {}
    cursor = departure_minutes
    distance_m: float | None = 0
    for leg in result["path"]:
        first, last = points[leg["from"]], points[leg["to"]]
        if leg["mode"] == "walk":
            distance = leg["minutes"] * assumptions.walk_m_per_minute
            legs.append(
                {
                    "mode": "walk",
                    "from": first,
                    "to": last,
                    "minutes": leg["minutes"],
                    "departure_minutes": round(cursor, 3),
                    "arrival_minutes": round(cursor + leg["minutes"], 3),
                    "distance_m": round(distance, 3),
                    "geometry": _walk_geometry(leg["geometry"], first, last),
                    "geometry_source": "walking_network_with_snap_connectors",
                    "stops": [],
                }
            )
            cursor += leg["minutes"]
            if distance_m is not None:
                distance_m += distance
            continue
        if leg["wait_minutes"] > 0:
            legs.append(
                {
                    "mode": "wait",
                    "from": first,
                    "to": first,
                    "minutes": leg["wait_minutes"],
                    "departure_minutes": round(cursor, 3),
                    "arrival_minutes": leg["departure_minutes"],
                    "geometry": [],
                    "stops": [],
                    "route_id": leg["route_id"],
                    "route_name": leg["route_name"],
                }
            )
        pattern = patterns[leg["pattern_id"]]
        trip = next(trip for trip in router.trips[pattern["id"]] if trip["id"] == leg["trip_id"])
        indices = range(leg["from_stop_index"], leg["to_stop_index"] + 1)
        stops = [
            dict(
                points[pattern["stopIds"][index]],
                arrival_minutes=trip["stopTimes"][index]["arrivalMinutes"],
                departure_minutes=trip["stopTimes"][index]["departureMinutes"],
            )
            for index in indices
        ]
        for role, point in (("board", first), ("alight", last)):
            stop = stop_roles.setdefault(point["id"], dict(point, roles=[]))
            if role not in stop["roles"]:
                stop["roles"].append(role)
        segment_distances = pattern.get("segmentDistanceM", [])[
            leg["from_stop_index"] : leg["to_stop_index"]
        ]
        if len(segment_distances) == leg["to_stop_index"] - leg["from_stop_index"]:
            distance = sum(segment_distances)
        elif leg["geometry"]:
            distance = sum(_distance_m(a, b) for a, b in zip(leg["geometry"], leg["geometry"][1:]))
        else:
            distance = None
        if distance is None:
            distance_m = None
        elif distance_m is not None:
            distance_m += distance
        legs.append(
            {
                "mode": leg["mode"],
                "from": first,
                "to": last,
                "minutes": leg["minutes"],
                "departure_minutes": leg["departure_minutes"],
                "arrival_minutes": leg["arrival_minutes"],
                "distance_m": round(distance, 3) if distance is not None else None,
                "route_id": leg["route_id"],
                "route_name": leg["route_name"],
                "pattern_id": leg["pattern_id"],
                "trip_id": leg["trip_id"],
                "stops": stops,
                "geometry": leg["geometry"],
                "geometry_source": leg["geometry_source"],
                "geometry_warning": leg["geometry_warning"],
                "provenance": leg["provenance"],
            }
        )
        if leg["geometry_warning"]:
            warnings.append(leg["geometry_warning"])
        cursor = leg["arrival_minutes"]
    uses_transit = any(leg["mode"] in {"bus", "ferry"} for leg in legs)
    if result["status"] == "reachable" and not uses_transit:
        warnings.append(
            "The fastest supported journey is walking. No faster dated transit trip was found."
        )
    journey = {
        "status": result["status"],
        "reason": result["reason"],
        "service_date": selected_date.isoformat(),
        "snapshot_date": snapshot_date,
        "timezone": "Indian/Maldives",
        "departure_minutes": departure_minutes,
        "arrival_minutes": result["arrival_minutes"],
        "minutes": result["minutes"],
        "walk_minutes": round(sum(leg["minutes"] for leg in legs if leg["mode"] == "walk"), 3),
        "wait_minutes": round(sum(leg["minutes"] for leg in legs if leg["mode"] == "wait"), 3),
        "ride_minutes": round(
            sum(leg["minutes"] for leg in legs if leg["mode"] in {"bus", "ferry"}), 3
        ),
        "uses_transit": uses_transit,
        "active_service_count": active_services,
        "legs": legs,
        "stops": list(stop_roles.values()),
        "warnings": list(dict.fromkeys(warnings)),
        "source_receipts": repository.receipts,
    }
    # Legacy map consumers must never connect walk paths across a missing ride shape.
    complete_geometry = all(leg["geometry"] for leg in legs if leg["mode"] != "wait")
    response = {
        "status": "ok" if result["status"] == "reachable" else "unreachable",
        "mode": "transit",
        "geometry": [point for leg in legs for point in leg["geometry"]]
        if complete_geometry
        else [],
        "graph_version": repository.baseline.get("version", "unknown"),
        "journey": journey,
    }
    if result["status"] != "reachable":
        response["reason"] = "no_supported_transit_journey"
    elif distance_m is not None:
        response["distance_m"] = round(distance_m, 3)
    return response
