"""Dated timetable benefits, deliberately separate from resident walking access.

Waiting is a schedule-based random-arrival estimate, not an observed queue or
ridership forecast. Connections are directed, single-vehicle boarding/alighting
pairs; they do not assert that transfers or door-to-door journeys are feasible.
"""

from __future__ import annotations

import copy
from typing import Any

from app.planning.models import PlanningAssumptions
from app.planning.repository import IDENTITY_BRIDGE
from app.planning.routing import pattern_trips


def _island(identity: str) -> str:
    return IDENTITY_BRIDGE.get(identity, identity)


def _expected_wait(departures: list[float], start: float, end: float) -> float | None:
    """Integrate next-departure minus arrival over one explicit shared window."""
    if end <= start or not departures or end > departures[-1]:
        return None
    cursor, total = start, 0.0
    for departure in sorted(set(departures)):
        if departure <= cursor:
            continue
        until = min(end, departure)
        total += ((departure - cursor) ** 2 - (departure - until) ** 2) / 2
        cursor = until
        if cursor >= end:
            return round(total / (end - start), 3)
    return None


def _metrics(events: list[dict[str, Any]], at: float) -> dict[str, Any]:
    departures = sorted(event["departure"] for event in events)
    boarding_stops = sorted({event["boarding_stop_id"] for event in events})
    first, last = departures[0], departures[-1]
    next_departure = (
        next((minute for minute in departures if minute >= at), None)
        if len(boarding_stops) == 1
        else None
    )
    return {
        "departure_count": len(events),
        "first_departure_minutes": first,
        "last_departure_minutes": last,
        "next_departure_minutes": next_departure,
        "next_wait_minutes": round(next_departure - at, 3) if next_departure is not None else None,
        "expected_wait_minutes": _expected_wait(departures, first, last)
        if len(boarding_stops) == 1
        else None,
        "expected_wait_window_start_minutes": first
        if last > first and len(boarding_stops) == 1
        else None,
        "expected_wait_window_end_minutes": last
        if last > first and len(boarding_stops) == 1
        else None,
        "boarding_stop_ids": boarding_stops,
        "terminal_pairs": [
            list(pair)
            for pair in sorted(
                {(event["boarding_stop_id"], event["alighting_stop_id"]) for event in events}
            )
        ],
        "crossing_minutes": round(min(event["crossing"] for event in events), 3),
        "service_ids": sorted({event["service_id"] for event in events}),
        "_departures": departures,
    }


def _snapshot(
    world: dict[str, Any],
    assumptions: PlanningAssumptions,
    scope: str | None,
    edited_ids: set[str],
    island_names: dict[str, str],
) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    stops = {stop["id"]: stop for stop in world["stops"] if not stop.get("disabled")}
    lines, connections = {}, {}
    for pattern in world["patterns"]:
        if pattern.get("enabled") is False or pattern.get("mode") not in {"bus", "ferry"}:
            continue
        stop_ids = pattern["stopIds"]
        active = [(i, stops[identity]) for i, identity in enumerate(stop_ids) if identity in stops]
        islands = list(dict.fromkeys(_island(stop["islandId"]) for _, stop in active))
        if scope and scope not in islands and pattern["id"] not in edited_ids:
            continue
        pairs = [
            (i, j, first, second)
            for i, first in active
            for j, second in active
            if i < j
            and first.get("pickupAllowed") is not False
            and second.get("dropoffAllowed") is not False
        ]
        if not pairs:
            continue
        # Generate dated trips once per pattern, retaining previous-day carryover
        # for connections boarding after midnight at downstream stops.
        trips = pattern_trips(pattern, assumptions.date)
        if not trips:
            continue
        local_boarding = [
            i for i, _, stop, _ in pairs if scope and _island(stop["islandId"]) == scope
        ]
        first_index = min(local_boarding) if local_boarding else min(i for i, _, _, _ in pairs)
        last_index = max(j for i, j, _, _ in pairs if i == first_index)
        first, last = stops[stop_ids[first_index]], stops[stop_ids[last_index]]
        events = [
            {
                "departure": trip["stopTimes"][first_index]["departureMinutes"],
                "crossing": trip["stopTimes"][last_index]["arrivalMinutes"]
                - trip["stopTimes"][first_index]["departureMinutes"],
                "service_id": pattern["id"],
                "boarding_stop_id": first["id"],
                "alighting_stop_id": last["id"],
            }
            for trip in trips
            if 0 <= trip["stopTimes"][first_index]["departureMinutes"] < 1440
        ]
        if events:
            lines[pattern["id"]] = {
                "id": pattern["id"],
                "route_id": pattern["routeId"],
                "name": pattern["name"],
                "mode": pattern["mode"],
                "from_stop_name": first.get("name") or first["id"],
                "to_stop_name": last.get("name") or last["id"],
                "island_ids": islands,
                "stop_ids": stop_ids,
                "metrics": _metrics(events, assumptions.departure_minutes),
            }
        # One trip counts once per directed island pair, even if it calls at
        # several stops on either island. A -> B -> C also establishes A -> C
        # on the same vehicle; the reverse direction is never inferred.
        island_pairs = {}
        for i, j, first, second in pairs:
            origin, destination = _island(first["islandId"]), _island(second["islandId"])
            if origin != destination:
                if scope and scope not in {origin, destination} and pattern["id"] not in edited_ids:
                    continue
                island_pairs.setdefault((origin, destination), (i, j))
        for (origin, destination), (i, j) in island_pairs.items():
            key = f"{pattern['mode']}:{origin}:{destination}"
            pair_events = [
                {
                    "departure": trip["stopTimes"][i]["departureMinutes"],
                    "crossing": trip["stopTimes"][j]["arrivalMinutes"]
                    - trip["stopTimes"][i]["departureMinutes"],
                    "service_id": pattern["id"],
                    "boarding_stop_id": stop_ids[i],
                    "alighting_stop_id": stop_ids[j],
                }
                for trip in trips
                if 0 <= trip["stopTimes"][i]["departureMinutes"] < 1440
            ]
            if not pair_events:
                continue
            row = connections.setdefault(
                key,
                {
                    "id": key,
                    "mode": pattern["mode"],
                    "from_island_id": origin,
                    "to_island_id": destination,
                    "from_island_name": island_names.get(origin, origin),
                    "to_island_name": island_names.get(destination, destination),
                    "_events": [],
                },
            )
            row["_events"].extend(pair_events)
    for row in connections.values():
        row["metrics"] = _metrics(row.pop("_events"), assumptions.departure_minutes)
    return lines, connections


def _compare(
    before: dict[str, dict[str, Any]], after: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    result = []
    for identity in sorted(before.keys() | after.keys()):
        first, second = before.get(identity), after.get(identity)
        row = {key: value for key, value in (second or first).items() if key != "metrics"}
        a = copy.deepcopy(first["metrics"]) if first else None
        b = copy.deepcopy(second["metrics"]) if second else None
        comparable = False
        reason = "A dated service is required in both views to measure waiting-time savings."
        if a and b:
            start = max(a["first_departure_minutes"], b["first_departure_minutes"])
            end = min(a["last_departure_minutes"], b["last_departure_minutes"])
            # Comparing a different boarding location would confuse shorter
            # waits with a change in where a passenger must start the journey.
            same_stops = not first.get("stop_ids") or first["stop_ids"] == second["stop_ids"]
            same_boarding = (
                len(a["boarding_stop_ids"]) == 1
                and a["boarding_stop_ids"] == b["boarding_stop_ids"]
                and a["terminal_pairs"] == b["terminal_pairs"]
            )
            comparable = end > start and same_stops and same_boarding
            if comparable:
                for metrics in (a, b):
                    metrics["expected_wait_minutes"] = _expected_wait(
                        metrics["_departures"], start, end
                    )
                    metrics["expected_wait_window_start_minutes"] = start
                    metrics["expected_wait_window_end_minutes"] = end
                reason = "Uniform passenger arrivals over the same shared operating window."
            else:
                reason = (
                    "Different boarding locations; wait savings are not directly comparable."
                    if not same_stops or not same_boarding
                    else "No shared operating interval with at least two departures."
                )
        saved = (
            round(a["expected_wait_minutes"] - b["expected_wait_minutes"], 3)
            if comparable
            else None
        )
        if not a:
            change = "added"
        elif not b:
            change = "removed"
        elif a == b and first == second:
            change = "unchanged"
        else:
            better = bool(
                (saved is not None and saved > 0.001)
                or b["departure_count"] > a["departure_count"]
                or b["crossing_minutes"] < a["crossing_minutes"] - 0.001
            )
            worse = bool(
                (saved is not None and saved < -0.001)
                or b["departure_count"] < a["departure_count"]
                or b["crossing_minutes"] > a["crossing_minutes"] + 0.001
            )
            change = (
                "improved"
                if better and not worse
                else "worsened"
                if worse and not better
                else "changed"
            )
        for metrics in (a, b):
            if metrics:
                metrics.pop("_departures")
        row.update(
            before=a,
            after=b,
            change=change,
            expected_wait_comparable=comparable,
            expected_wait_comparison_reason=reason,
            expected_wait_saved_minutes=saved,
        )
        result.append(row)
    return result


def transport_impact(
    before: dict[str, Any],
    after: dict[str, Any],
    assumptions: PlanningAssumptions,
    *,
    island_id: str | None = None,
    island_names: dict[str, str] | None = None,
) -> dict[str, Any]:
    before_patterns = {pattern["id"]: pattern for pattern in before["patterns"]}
    after_patterns = {pattern["id"]: pattern for pattern in after["patterns"]}
    edited_ids = {
        identity
        for identity in before_patterns.keys() | after_patterns.keys()
        if before_patterns.get(identity) != after_patterns.get(identity)
    }
    # Canonical names for the explicitly reconciled capital islands remain
    # available even in a small fixture or an outside-snapshot ferry proposal.
    names = {
        "island:1442": "Hulhumalé",
        "island:1443": "Malé",
        "island:1382": "Vilimale",
        "island:1483": "Hulhulé",
        **(island_names or {}),
    }
    scope = _island(island_id) if island_id else None
    first_lines, first_connections = _snapshot(before, assumptions, scope, edited_ids, names)
    second_lines, second_connections = _snapshot(after, assumptions, scope, edited_ids, names)
    lines = _compare(first_lines, second_lines)
    connections = _compare(first_connections, second_connections)
    return {
        "service_date": assumptions.date.isoformat(),
        "departure_minutes": assumptions.departure_minutes,
        "lines": lines,
        "connections": connections,
        "summary": {
            "changed_lines": sum(row["change"] != "unchanged" for row in lines),
            "added_connections": sum(row["change"] == "added" for row in connections),
            "removed_connections": sum(row["change"] == "removed" for row in connections),
            "improved_connections": sum(row["change"] == "improved" for row in connections),
            "departures_before": sum(
                (row["before"] or {}).get("departure_count", 0) for row in lines
            ),
            "departures_after": sum(
                (row["after"] or {}).get("departure_count", 0) for row in lines
            ),
        },
        "wait_method": "Schedule-based expected wait for uniformly random arrivals within "
        "the displayed operating interval, using actual gaps between dated departures. "
        "Before/after savings use the same shared interval. Next wait is measured from "
        "the selected clock time. Neither measure is an observed passenger queue.",
        "qualification": "Services on the selected date, scoped to the selected island "
        "and edited services. Connections are directed single-vehicle island pairs, "
        "including through stops; transfers, capacity, cancellations, passenger demand "
        "and door-to-door national accessibility are not established. Walking-access "
        "resident gains remain a separate measure. No captured service is missing "
        "evidence, not proof that no operator runs a service. Island-level waiting "
        "estimates are unavailable when services use different boarding locations; "
        "review each named line instead.",
    }
