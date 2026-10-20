"""Ordered map directions without inventing routes or timing across missing legs."""

from __future__ import annotations

import math
from datetime import date, timedelta
from typing import Any, Literal

from app.planning.repository import PlanningRepository
from app.routing.engine import RoutingRepository
from app.routing.journeys import route_journey

TravelMode = Literal["walk", "transit", "bicycle", "car"]
MAX_LAND_SNAP_M = 250


def route_multistop(
    routing: RoutingRepository,
    planning: PlanningRepository,
    points: list[list[float]],
    mode: TravelMode,
    service_date: date | None = None,
    departure_minutes: float = 920,
    route_ids: list[str] | None = None,
) -> dict[str, Any]:
    """Each stop is mandatory and ordered; no optimization or stop dwell time is assumed.

    Transit segment clocks belong to that segment's service_date. The overall
    arrival clock is relative to the requested service_date and may exceed 1440.
    After an unavailable transit segment, later departures cannot be established.
    Road segments remain independently inspectable, with no invented duration.
    """
    snapshot = planning.baseline.get("referenceDate")
    selected_date = service_date or (date.fromisoformat(snapshot) if snapshot else date.today())
    segments: list[dict[str, Any]] = []
    warnings: list[str] = []
    cursor: float | None = departure_minutes
    known_distance = 0.0
    known_minutes = 0.0
    for index, (start, end) in enumerate(zip(points, points[1:])):
        day_offset = math.floor(cursor / 1440) if cursor is not None else 0
        segment_date = selected_date + timedelta(days=day_offset)
        segment_departure = cursor % 1440 if cursor is not None else None
        segment: dict[str, Any] = {
            "index": index,
            "start": start,
            "end": end,
            "status": "skipped",
            "result": None,
            "reason": None,
            "service_date": segment_date.isoformat(),
            "departure_minutes": segment_departure if mode == "transit" else None,
            "arrival_minutes": None,
            "minutes": None,
            "distance_m": None,
        }
        if mode == "transit" and cursor is None:
            segment["reason"] = "The preceding segment has no confirmed arrival time."
            segments.append(segment)
            continue
        if mode == "transit":
            result = route_journey(
                planning,
                start,
                end,
                segment_date,
                segment_departure,
                **({"route_ids": route_ids} if route_ids is not None else {}),
            )
            journey = result.get("journey", {})
            warnings.extend(journey.get("warnings", []))
            segment["reason"] = journey.get("reason") or result.get("reason")
            if result["status"] == "ok":
                segment["minutes"] = journey.get("minutes")
                segment["arrival_minutes"] = journey.get("arrival_minutes")
                duration = segment["minutes"]
                cursor = cursor + duration if duration is not None else None
            else:
                cursor = None
        else:
            # Choosing a map scope must never force a remote point onto that island.
            result = routing.route_land(start, end, mode, max_snap_m=MAX_LAND_SNAP_M)
            segment["reason"] = result.get("reason")
        segment["status"] = result["status"]
        segment["result"] = result
        if result["status"] == "ok":
            segment["distance_m"] = result.get("distance_m")
            known_distance += segment["distance_m"] or 0
            known_minutes += segment["minutes"] or 0
        segments.append(segment)
    complete = all(segment["status"] == "ok" for segment in segments)
    any_reachable = any(segment["status"] == "ok" for segment in segments)
    if mode != "transit":
        warnings.append(
            "Travel time is unavailable for routes calculated from the mapped land graph."
        )
    if not complete:
        warnings.append("Only confirmed route segments are shown; gaps are not connected.")
    return {
        "status": "ok" if complete else "partial" if any_reachable else "unreachable",
        "reason": next(
            (segment["reason"] for segment in segments if segment["status"] != "ok"), None
        ),
        "mode": mode,
        "points": points,
        "segments": segments,
        "service_date": selected_date.isoformat(),
        "timezone": "Indian/Maldives",
        "departure_minutes": departure_minutes,
        "arrival_minutes": cursor if complete and mode == "transit" else None,
        "distance_m": (
            round(known_distance, 3)
            if complete and all(segment["distance_m"] is not None for segment in segments)
            else None
        ),
        "minutes": (
            round(known_minutes, 3)
            if complete and all(segment["minutes"] is not None for segment in segments)
            else None
        ),
        "known_distance_m": round(known_distance, 3),
        "known_minutes": round(known_minutes, 3),
        "warnings": list(dict.fromkeys(warnings)),
    }
