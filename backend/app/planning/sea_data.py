"""Strict conversion of official ferry evidence into eligible planning patterns."""

from __future__ import annotations

import copy
from datetime import date, timedelta
from typing import Any


def date_eligible(route: dict[str, Any], day: date) -> bool:
    """Use the published recurring pattern, with future dates labeled projections."""
    return bool(
        route.get("status") == "current"
        and route.get("valid_from")
        and route["valid_from"] <= day.isoformat()
        and (not route.get("valid_until") or day.isoformat() <= route["valid_until"])
    )


def normalized_calls(calls: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Unused first arrival / last departure may be absent in the publication.

    Internal stop pairs use zero endpoint dwell. No travelled segment's arrival
    or departure is synthesized, and the source record stays unchanged.
    """
    result = [dict(call) for call in calls]
    if result:
        if result[0].get("arrival_minutes") is None:
            result[0]["arrival_minutes"] = result[0].get("departure_minutes")
        if result[-1].get("departure_minutes") is None:
            result[-1]["departure_minutes"] = result[-1].get("arrival_minutes")
    return result


def complete_calls(calls: list[dict[str, Any]]) -> bool:
    previous = -1.0
    if len(calls) < 2:
        return False
    for call in normalized_calls(calls):
        arrival, departure = call.get("arrival_minutes"), call.get("departure_minutes")
        if (
            isinstance(arrival, bool)
            or isinstance(departure, bool)
            or not isinstance(arrival, (int, float))
            or not isinstance(departure, (int, float))
            or not 0 <= arrival <= departure <= 2880
            or arrival < previous
        ):
            return False
        previous = departure
    return True


def planning_patterns(
    bundle: dict[str, Any], terminals: dict[str, dict[str, Any]], planning_id: Any
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Only dated complete calls at identified official terminals enter journey models.

    Directory routes and historical/departure-only timetables remain useful in
    the sea view, but cannot create invented arrivals or resident access gains.
    """
    stops: dict[str, dict[str, Any]] = {}
    patterns = []
    for route in bundle.get("routes", []):
        if (
            route.get("status") != "current"
            or route.get("timing_status") != "complete_timetable"
            or not route.get("valid_from")
        ):
            continue
        for sailing in route.get("sailings", []):
            calls = normalized_calls(sailing.get("calls", []))
            if not complete_calls(calls) or not sailing.get("days"):
                continue
            if any(
                call.get("terminal_id") not in terminals
                or terminals[call["terminal_id"]].get("national_island_id") != call.get("island_id")
                for call in calls
            ):
                continue
            for call in calls:
                terminal = terminals[call["terminal_id"]]
                lon, lat = terminal["coordinates"]
                stops[terminal["id"]] = {
                    "id": terminal["id"],
                    "name": terminal["name"],
                    "islandId": planning_id(call["island_id"]),
                    "mode": "ferry",
                    "lon": lon,
                    "lat": lat,
                    "provenance": "official_timetable",
                    "sourceIds": route.get("source_ids", []),
                }
            patterns.append(
                {
                    "id": f"sea:{route['id']}:{sailing['id']}",
                    "routeId": route["id"],
                    "name": route["name"],
                    "mode": "ferry",
                    "operator": route.get("operator"),
                    "equivalenceKey": sailing.get("equivalence_key"),
                    "stopIds": [call["terminal_id"] for call in calls],
                    "calendar": {
                        "weekdays": [(int(day) + 1) % 7 for day in sailing["days"]],
                        "startDate": route["valid_from"],
                        "endDate": route["valid_until"],
                    },
                    "timing": {
                        "kind": "scheduled",
                        "trips": [
                            {
                                "id": sailing["id"],
                                "stopTimes": [
                                    {
                                        "arrivalMinutes": call["arrival_minutes"],
                                        "departureMinutes": call["departure_minutes"],
                                    }
                                    for call in calls
                                ],
                            }
                        ],
                    },
                    "provenance": "official_timetable",
                    "sourceIds": route.get("source_ids", []),
                    "seaSourceRouteId": route["id"],
                }
            )
    return list(stops.values()), _merge_equivalent_calendars(patterns)


def _merge_equivalent_calendars(patterns: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Union publication calendars without counting the same physical sailing twice.

    Each weekday's date intervals are unioned exactly. A later calendar cannot
    create extra sailings before its effective date or silently expire the old
    publication. Source route identities remain attached for inspection.
    """
    groups: dict[str, list[dict[str, Any]]] = {}
    for pattern in patterns:
        groups.setdefault(pattern.get("equivalenceKey") or pattern["id"], []).append(pattern)
    result = []
    for equivalents in groups.values():
        if len(equivalents) == 1:
            result.extend(equivalents)
            continue
        intervals: dict[tuple[date, date], list[int]] = {}
        for weekday in range(7):
            raw = sorted(
                (
                    date.fromisoformat(pattern["calendar"]["startDate"]),
                    date.fromisoformat(pattern["calendar"]["endDate"])
                    if pattern["calendar"].get("endDate")
                    else date.max,
                )
                for pattern in equivalents
                if weekday in pattern["calendar"]["weekdays"]
            )
            merged: list[tuple[date, date]] = []
            for start, end in raw:
                if merged and (
                    merged[-1][1] == date.max or start <= merged[-1][1] + timedelta(days=1)
                ):
                    merged[-1] = (merged[-1][0], max(merged[-1][1], end))
                else:
                    merged.append((start, end))
            for bounds in merged:
                intervals.setdefault(bounds, []).append(weekday)
        for index, ((start, end), weekdays) in enumerate(intervals.items()):
            pattern = copy.deepcopy(equivalents[0])
            pattern["id"] = f"{pattern['id']}:union:{index}"
            pattern["calendar"] = {
                "weekdays": weekdays,
                "startDate": start.isoformat(),
                "endDate": None if end == date.max else end.isoformat(),
            }
            pattern["seaSourceRouteIds"] = sorted({p["seaSourceRouteId"] for p in equivalents})
            pattern["sourceIds"] = sorted({s for p in equivalents for s in p["sourceIds"]})
            pattern["normalizationNote"] = (
                "Equivalent published sailing calendars are unioned by weekday and effective "
                "date so an overlapping publication is counted once. Source expiry is unchanged."
            )
            result.append(pattern)
    return result
