"""Isolated overlays; proposed facilities and imported schedules retain assumption labels."""

from __future__ import annotations

import copy
import math
import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Any

from app.planning.geometry import prepare_service_geometry
from app.planning.models import PlanningOperation, PlanningRequest
from app.planning.repository import PlanningRepository
from app.planning.routing import WalkingNetwork, service_day_trips
from app.routing.engine import _distance_m


def baseline_world(
    repository: PlanningRepository, *, share_network: bool = False
) -> dict[str, Any]:
    baseline = repository.baseline
    world = copy.deepcopy(
        {
            "facilities": baseline.get("facilities", []),
            "stops": baseline.get("transit", {}).get("stops", []),
            "patterns": baseline.get("transit", {}).get("patterns", []),
        }
    )
    network = baseline.get("network", {"nodes": [], "edges": []})
    world["network"] = network if share_network else copy.deepcopy(network)
    return world


def validate_service(pattern: dict[str, Any], stops: list[dict[str, Any]]) -> dict[str, Any]:
    pattern = copy.deepcopy(pattern)

    # No non-finite numbers hidden in metadata may escape into a JSON response.
    def finite_json(value: Any) -> bool:
        if isinstance(value, float):
            return math.isfinite(value)
        if isinstance(value, dict):
            return all(finite_json(item) for item in value.values())
        if isinstance(value, list):
            return all(finite_json(item) for item in value)
        return True

    if not finite_json(pattern):
        raise ValueError("All service inputs, including geometry and metadata, must be finite")
    required = {"id", "routeId", "name", "mode", "stopIds", "calendar", "timing"}
    if not required.issubset(pattern):
        raise ValueError(f"Service requires {', '.join(sorted(required))}")
    if pattern["mode"] not in {"bus", "ferry"}:
        raise ValueError("Service mode must be bus or ferry")
    if pattern.get("fleet", "diesel") not in {"diesel", "electric"}:
        raise ValueError(
            "Bus propulsion must be diesel or electric; ferry costs use vessel factors"
        )
    if any(
        not isinstance(pattern[key], str) or not pattern[key].strip() or len(pattern[key]) > 200
        for key in ("id", "routeId", "name")
    ):
        raise ValueError("Service ID, route ID and name must be nonempty strings (up to 200 chars)")
    stop_ids = pattern["stopIds"]
    if (
        not isinstance(stop_ids, list)
        or not 2 <= len(stop_ids) <= 200
        or any(not isinstance(stop, str) or not stop for stop in stop_ids)
    ):
        raise ValueError("Service requires 2–200 ordered stop IDs")
    if not set(stop_ids).issubset({s["id"] for s in stops}):
        raise ValueError("Service references unknown stop IDs; add/reconcile stops first")
    geometries = pattern.get("segmentGeometry", [])
    if (
        not isinstance(geometries, list)
        or (geometries and len(geometries) != len(stop_ids) - 1)
        or any(not isinstance(segment, list) for segment in geometries)
    ):
        raise ValueError("Service geometry needs one coordinate list per consecutive stop")
    if sum(len(segment) for segment in geometries) > 100000:
        raise ValueError("Service geometry exceeds 100000 coordinate points")
    for segment in geometries:
        if segment and len(segment) < 2:
            raise ValueError("A supplied service segment needs at least two coordinate points")
        for point in segment:
            if (
                not isinstance(point, list)
                or len(point) != 2
                or any(isinstance(n, bool) or not isinstance(n, (int, float)) for n in point)
                or not -180 <= point[0] <= 180
                or not -90 <= point[1] <= 90
            ):
                raise ValueError("Service geometry points must be finite longitude/latitude pairs")
    # Client-provided metadata cannot claim a graph derivation performed by this server.
    pattern["segmentGeometrySources"] = [
        "source_service_geometry" if segment else "unavailable" for segment in geometries
    ]
    pattern["segmentGeometryWarnings"] = [
        "User-supplied service geometry; route has not been independently verified."
        if segment
        else None
        for segment in geometries
    ]
    calendar = pattern["calendar"]
    if (
        not isinstance(calendar, dict)
        or not isinstance(calendar.get("weekdays", []), list)
        or any(not isinstance(n, int) or n < 0 or n > 6 for n in calendar.get("weekdays", []))
    ):
        raise ValueError("Calendar weekdays use 0 Sunday through 6 Saturday")
    for key in ("includedDates", "excludedDates"):
        if not isinstance(calendar.get(key, []), list):
            raise ValueError("Calendar included/excluded dates must be lists")
        for text in calendar.get(key, []):
            date.fromisoformat(text)
    for key in ("startDate", "endDate"):
        if calendar.get(key):
            date.fromisoformat(calendar[key])
    if calendar.get("startDate") and calendar.get("endDate"):
        if calendar["endDate"] < calendar["startDate"]:
            raise ValueError("Calendar date range is reversed")
    timing = pattern["timing"]
    if not isinstance(timing, dict):
        raise ValueError("Service timing must be a scheduled or frequency object")
    if timing.get("kind") == "scheduled":
        trips = timing.get("trips", [])
        if not isinstance(trips, list) or not 1 <= len(trips) <= 3000:
            raise ValueError("Scheduled service requires 1–3000 trips")
        for trip in trips:
            if (
                not isinstance(trip, dict)
                or not isinstance(trip.get("stopTimes"), list)
                or len(trip["stopTimes"]) != len(stop_ids)
                or not isinstance(trip.get("id"), str)
                or not trip["id"]
            ):
                raise ValueError("Every trip needs an ID and one arrival/departure pair per stop")
            prior = -math.inf
            for time in trip["stopTimes"]:
                if not isinstance(time, dict):
                    raise ValueError("Stop time pairs must be objects")
                arrival, departure = time.get("arrivalMinutes"), time.get("departureMinutes")
                if any(
                    not isinstance(v, (float, int)) or not math.isfinite(v)
                    for v in (arrival, departure)
                ):
                    raise ValueError("Stop times must be finite minutes")
                if not 0 <= arrival <= departure <= 2880 or arrival < prior:
                    raise ValueError("Stop times must be ordered within a two-day service horizon")
                prior = departure
        if len({trip["id"] for trip in trips}) != len(trips):
            raise ValueError("Scheduled trip IDs must be unique within the service")
    elif timing.get("kind") == "frequency":
        segments = timing.get("segmentMinutes", [])
        if (
            not isinstance(segments, list)
            or len(segments) != len(stop_ids) - 1
            or any(
                not isinstance(n, (int, float)) or not math.isfinite(n) or n <= 0 for n in segments
            )
        ):
            raise ValueError("Frequency service needs a positive duration per consecutive stop")
        windows = timing.get("windows", [])
        if not isinstance(windows, list) or not 1 <= len(windows) <= 20:
            raise ValueError("Frequency service requires 1–20 windows")
        for window in windows:
            if not isinstance(window, dict):
                raise ValueError("Frequency windows must be objects")
            start, end, headway = (
                window.get(k) for k in ("startMinutes", "endMinutes", "headwayMinutes")
            )
            if (
                any(
                    not isinstance(v, (int, float)) or not math.isfinite(v)
                    for v in (start, end, headway)
                )
                or not 0 <= start < end <= 2880
            ):
                raise ValueError("Frequency windows must be finite and ordered")
            if not 1 <= headway <= 720:
                raise ValueError("Headway must be 1–720 minutes")
        ordered = sorted(windows, key=lambda window: window["startMinutes"])
        if any(b["startMinutes"] < a["endMinutes"] for a, b in zip(ordered, ordered[1:])):
            raise ValueError("Frequency windows must not overlap")
    else:
        raise ValueError("Timing kind must be frequency or scheduled")
    if pattern.get("distanceM") is not None and (
        not isinstance(pattern["distanceM"], (int, float))
        or not math.isfinite(pattern["distanceM"])
        or not 0 < pattern["distanceM"] <= 1e6
    ):
        raise ValueError("Service distance must be finite positive metres")
    pattern["provenance"] = "assumed"
    pattern["sourceIds"] = ["scenario-import"]
    return pattern


def apply_operations(
    repository: PlanningRepository,
    request: PlanningRequest,
    *,
    share_unchanged_network: bool = False,
) -> tuple[Any, Any]:
    warnings = []
    operations = list(request.operations)
    structural_operations = (request.scenario or {}).get("operations", [])
    if (
        not isinstance(structural_operations, list)
        or len(structural_operations) > 100
        or any(not isinstance(raw, dict) for raw in structural_operations)
    ):
        raise ValueError("Structural scenario requires at most 100 operation objects")
    for raw in structural_operations:
        kind = raw.get("type")
        mapped = {
            "add_bus_stop": "add_stop",
            "move_bus_stop": "move_stop",
            "remove_bus_stop": "disable_stop",
            "road_closure": "road_closure",
            "pedestrian_connection": "pedestrian_connection",
            "weather_disruption": "weather_disruption",
        }.get(kind)
        if mapped:
            values = {k: v for k, v in raw.items() if k in PlanningOperation.model_fields}
            values["type"] = mapped
            # The graph has separate source IDs; unresolved targets are disclosed below.
            operations.append(PlanningOperation.model_validate(values))
        else:
            warnings.append(
                f"Structural operation {kind} has no scheduled service/financial "
                "effect without explicit service or cost inputs"
            )
    changes_graph = any(
        operation.type in {"road_closure", "pedestrian_connection"}
        or (operation.type == "weather_disruption" and "walk" in operation.disabled_modes)
        for operation in operations
    )
    # Service evaluation never exposes this network and can share it while
    # adding facilities/stops/services. Mutating graph operations and all other
    # callers retain a fully isolated copy, including structural scenario edits.
    world = baseline_world(repository, share_network=share_unchanged_network and not changes_graph)
    closure_applied = False
    proposed_pattern_ids: set[str] = set()
    proposed_stop_ids: set[str] = set()
    for index, operation in enumerate(operations):
        validity = operation.metadata
        if validity.get("valid_from") or validity.get("valid_until"):
            at = datetime.combine(request.assumptions.date, time(), timezone(timedelta(hours=5)))
            at += timedelta(minutes=request.assumptions.departure_minutes)
            bounds = {}
            for key in ("valid_from", "valid_until"):
                if validity.get(key):
                    if not isinstance(validity[key], str):
                        raise ValueError("Notice validity must be an ISO timestamp string")
                    bound = datetime.fromisoformat(validity[key].replace("Z", "+00:00"))
                    if bound.tzinfo is None:
                        raise ValueError("Notice validity must include a timezone offset")
                    bounds[key] = bound
            if (bounds.get("valid_from") and at < bounds["valid_from"]) or (
                bounds.get("valid_until") and at >= bounds["valid_until"]
            ):
                warnings.append(
                    f"Operation {index}: reviewed notice is outside its validity "
                    "window at the scenario departure; it was not applied"
                )
                continue
        kind = operation.type
        scope = repository.planning_id(operation.island_id or request.island_id)
        if kind == "use_existing_ferry_terminal":
            terminal = repository.ferry_terminals.get(operation.target_id or "")
            if not terminal:
                raise ValueError("Choose an existing source-mapped passenger ferry terminal")
            if operation.island_id and operation.island_id != terminal["island_id"]:
                raise ValueError("Ferry terminal identity does not match its island")
            if not any(stop["id"] == terminal["id"] for stop in world["stops"]):
                coordinates = terminal["coordinates"]
                world["stops"].append(
                    {
                        "id": terminal["id"],
                        "name": terminal["name"],
                        "mode": "ferry",
                        "islandId": repository.planning_id(terminal["island_id"]),
                        "lon": coordinates[0],
                        "lat": coordinates[1],
                        "coordinate": coordinates,
                        "provenance": "source-mapped",
                        "sourceIds": [terminal["source"]],
                        "reusedInfrastructure": True,
                    }
                )
            warnings.append(
                "Existing mapped ferry terminal reused; berth suitability and operator "
                "permission remain unverified. No port construction is costed."
            )
        elif kind in {"add_hospital", "add_school", "add_stop"}:
            coordinates = list(operation.coordinates or [])
            if not scope:
                raise ValueError(
                    "Choose a supported island before adding a bus stop, school or hospital"
                )
            if scope not in {i["id"] for i in repository.baseline.get("islands", [])}:
                raise ValueError(
                    "Local construction is outside the supported planning area. "
                    "Choose a supported island, or plan a ferry service using existing "
                    "mapped landing points. No construction or budget has been committed."
                )
            proposal_id = operation.metadata.get("proposal_id", f"proposal:{kind}:{index}")
            if not isinstance(proposal_id, str) or not re.fullmatch(
                rf"proposal:{kind}:[A-Za-z0-9_-]{{1,100}}", proposal_id
            ):
                raise ValueError("Proposal IDs must use their typed proposal namespace")
            if any(item["id"] == proposal_id for item in world["stops"] + world["facilities"]):
                raise ValueError("Proposal ID already exists")
            item = {
                "id": proposal_id,
                "name": operation.name or kind.replace("_", " "),
                "islandId": scope,
                "lon": coordinates[0],
                "lat": coordinates[1],
                "coordinate": coordinates,
                "provenance": "assumed",
                "sourceIds": ["scenario-proposal"],
            }
            if kind == "add_stop":
                item["mode"] = operation.metadata.get("mode", "bus")
                world["stops"].append(item)
                proposed_stop_ids.add(proposal_id)
            else:
                item.update(
                    {
                        "kind": "hospital" if kind == "add_hospital" else "school",
                        "planningStatus": "proposed",
                        "operatingStatus": "open",
                        "verification": "scenario-proposal",
                        "careScope": "general",
                        "proposedOpeningDate": (
                            operation.opening_date or request.assumptions.date
                        ).isoformat(),
                    }
                )
                costs = operation.metadata.get("costs", {})
                if not isinstance(costs, dict) or set(costs).difference(
                    {
                        "capital_mvr",
                        "annual_operating_mvr",
                        "annual_operating_kg_co2e",
                        "embodied_kg_co2e",
                    }
                ):
                    raise ValueError(
                        "Facility costs allow capital/annual MVR and annual/embodied kgCO2e"
                    )
                item["costOverrides"] = costs
                world["facilities"].append(item)
        elif kind in {"move_stop", "disable_stop", "enable_stop", "disable_facility"}:
            items = world["facilities"] if kind == "disable_facility" else world["stops"]
            match = next((x for x in items if x["id"] == operation.target_id), None)
            if not match:
                warnings.append(
                    f"Operation {index}: target not present in planning snapshot: "
                    f"{operation.target_id}"
                )
                continue
            if kind == "move_stop":
                match["lon"], match["lat"] = operation.coordinates or (0, 0)
                match["coordinate"] = list(operation.coordinates or [])
                match["islandId"] = scope or match["islandId"]
            elif kind == "disable_facility":
                match["operatingStatus"] = "closed"
            else:
                match["disabled"] = kind == "disable_stop"
        elif kind == "pedestrian_connection":
            nodes = {n["id"]: n for n in world["network"]["nodes"]}
            first, second = nodes.get(operation.from_node_id), nodes.get(operation.to_node_id)
            if not first or not second:
                warnings.append(f"Operation {index}: planning graph node ID not found")
                continue
            world["network"]["edges"].append(
                {
                    "id": f"proposal:walk:{index}",
                    "from": first["id"],
                    "to": second["id"],
                    "distanceM": operation.distance_m
                    or _distance_m([first["lon"], first["lat"]], [second["lon"], second["lat"]]),
                    "walkAllowed": True,
                    "walkReverseAllowed": operation.bidirectional,
                    "driveAllowed": False,
                    "geometry": [[first["lon"], first["lat"]], [second["lon"], second["lat"]]],
                    "provenance": "assumed",
                    "auditedWheelchairAllowed": False,
                }
            )
        elif kind == "road_closure":
            matches = [
                edge
                for edge in world["network"]["edges"]
                if edge["id"] == operation.target_id
                or str(edge.get("sourceOsmWayId")) == operation.target_id
                or f"osm:way:{edge.get('sourceOsmWayId')}" == operation.target_id
            ]
            if not matches:
                warnings.append(
                    f"Operation {index}: closure target is not reconciled with "
                    "the planning graph; use a planning edge or OSM way ID"
                )
            for edge in matches:
                modes = operation.disabled_modes or ["walk", "bus"]
                if "walk" in modes:
                    edge["walkAllowed"] = False
                if "bus" in modes:
                    edge["driveAllowed"] = False
                    closure_applied = True
        elif kind == "weather_disruption":
            for pattern in world["patterns"]:
                if pattern["mode"] in operation.disabled_modes:
                    pattern["enabled"] = False
            if "walk" in operation.disabled_modes:
                for edge in world["network"]["edges"]:
                    edge["walkAllowed"] = False
            warnings.append(
                "Weather closure is an explicit scenario assumption, not inferred "
                "from weather warnings"
            )
        elif kind in {"add_service", "replace_service"}:
            pattern = validate_service(operation.service or {}, world["stops"])
            if kind == "replace_service":
                if not any(p["id"] == operation.target_id for p in world["patterns"]):
                    warnings.append(f"Service target not found: {operation.target_id}")
                    continue
                world["patterns"] = [p for p in world["patterns"] if p["id"] != operation.target_id]
            if any(p["id"] == pattern["id"] for p in world["patterns"]):
                raise ValueError("Duplicate service pattern ID")
            world["patterns"].append(pattern)
            proposed_pattern_ids.add(pattern["id"])
        else:
            pattern = next((p for p in world["patterns"] if p["id"] == operation.target_id), None)
            if not pattern:
                warnings.append(f"Service target not found: {operation.target_id}")
                continue
            pattern["provenance"] = "assumed"
            pattern["sourceIds"] = ["scenario-proposal"]
            if kind in {"enable_service", "disable_service"}:
                pattern["enabled"] = kind == "enable_service"
            elif kind == "set_fleet":
                pattern["fleet"] = operation.fleet
            elif kind == "shift_timetable":
                timing = pattern["timing"]
                shift = operation.minutes or 0
                if timing["kind"] == "scheduled":
                    for trip in timing["trips"]:
                        for stop_time in trip["stopTimes"]:
                            stop_time["arrivalMinutes"] += shift
                            stop_time["departureMinutes"] += shift
                else:
                    for window in timing["windows"]:
                        window["startMinutes"] += shift
                        window["endMinutes"] += shift
                validate_service(pattern, world["stops"])
            elif kind in {"set_frequency", "set_hours"}:
                timing = pattern["timing"]
                if timing["kind"] == "scheduled":
                    first = timing["trips"][0]["stopTimes"]
                    segments = [
                        b["arrivalMinutes"] - a["departureMinutes"]
                        for a, b in zip(first, first[1:])
                    ]
                    start = min(t["stopTimes"][0]["departureMinutes"] for t in timing["trips"])
                    end = max(t["stopTimes"][0]["departureMinutes"] for t in timing["trips"]) + 1
                    pattern["timing"] = {
                        "kind": "frequency",
                        "segmentMinutes": segments,
                        "windows": [
                            {
                                "startMinutes": start,
                                "endMinutes": end,
                                "headwayMinutes": operation.headway_minutes or 20,
                            }
                        ],
                    }
                windows = pattern["timing"]["windows"]
                if kind == "set_frequency":
                    for window in windows:
                        window["headwayMinutes"] = operation.headway_minutes
                elif len(windows) == 1:
                    windows[0]["startMinutes"] = operation.start_minutes
                    windows[0]["endMinutes"] = operation.end_minutes
                else:
                    # Preserve midday gaps and each window's frequency. Assigning
                    # identical hours to every window creates overlapping service
                    # and rejects an otherwise valid edit to split operating hours.
                    ordered = sorted(windows, key=lambda window: window["startMinutes"])
                    start, end = operation.start_minutes, operation.end_minutes
                    clipped = [
                        {
                            **window,
                            "startMinutes": max(start, window["startMinutes"]),
                            "endMinutes": min(end, window["endMinutes"]),
                        }
                        for window in ordered
                        if max(start, window["startMinutes"]) < min(end, window["endMinutes"])
                    ]
                    if not clipped:
                        raise ValueError(
                            "New hours fall entirely between existing service windows; "
                            "import an explicit timetable to create service during this gap"
                        )
                    if start < ordered[0]["startMinutes"]:
                        clipped[0]["startMinutes"] = start
                    if end > ordered[-1]["endMinutes"]:
                        clipped[-1]["endMinutes"] = end
                    pattern["timing"]["windows"] = clipped
                validate_service(pattern, world["stops"])
    if closure_applied:
        reroute_bus_services(repository, world, request, warnings)
    prepare_service_geometry(world, proposed_pattern_ids, request.assumptions, warnings)
    if proposed_stop_ids:
        served = {
            identity
            for pattern in world["patterns"]
            if service_day_trips(pattern, request.assumptions.date)
            for identity in pattern["stopIds"]
        }
        if proposed_stop_ids.difference(served):
            warnings.append(
                "A new stop does not create transit service; include it in a "
                "service pattern to obtain boarding benefits"
            )
    return world, warnings


def reroute_bus_services(
    repository: PlanningRepository,
    world: dict[str, Any],
    request: PlanningRequest,
    warnings: list[str],
) -> None:
    """Preserve published runtime; add detour moving time or block impossible paths."""
    before = WalkingNetwork(repository.baseline["network"], drive=True)
    after = WalkingNetwork(world["network"], drive=True)
    stops = {s["id"]: s for s in world["stops"]}
    cache = {}
    for pattern in world["patterns"]:
        if pattern["mode"] != "bus" or pattern.get("enabled") is False:
            continue
        adjustments, geometries, distances = [], [], []
        for first_id, second_id in zip(pattern["stopIds"], pattern["stopIds"][1:]):
            key = first_id, second_id
            if key not in cache:
                first, second = stops[first_id], stops[second_id]
                old_start = before.snap(first, request.assumptions.max_snap_m)
                old_end = before.snap(second, request.assumptions.max_snap_m)
                start = after.snap(first, request.assumptions.max_snap_m)
                end = after.snap(second, request.assumptions.max_snap_m)
                if not start or not end or not old_start or not old_end:
                    cache[key] = None
                else:
                    old, _ = before.tree(old_start[0], 100000)
                    new, previous = after.tree(start[0], 100000)
                    if end[0] not in new or old_end[0] not in old:
                        cache[key] = None
                    else:
                        delta = max(0, new[end[0]] - old[old_end[0]]) / 250
                        cache[key] = delta, after.geometry(previous, start[0], end[0]), new[end[0]]
            result = cache[key]
            if result is None:
                pattern["enabled"] = False
                warnings.append(
                    f"{pattern['name']}: blocked after closure or unresolved driving "
                    "snap; no transit benefit assumed"
                )
                break
            adjustments.append(result[0])
            geometries.append(result[1])
            distances.append(result[2])
        if not pattern.get("enabled", True):
            continue
        timing = pattern["timing"]
        if timing["kind"] == "frequency":
            timing["segmentMinutes"] = [
                a + b for a, b in zip(timing["segmentMinutes"], adjustments)
            ]
        else:
            for trip in timing["trips"]:
                offset = 0.0
                for index, stop_time in enumerate(trip["stopTimes"]):
                    if index:
                        offset += adjustments[index - 1]
                    stop_time["arrivalMinutes"] += offset
                    stop_time["departureMinutes"] += offset
        pattern.update(
            {
                "segmentGeometry": geometries,
                "segmentGeometrySources": ["osm_network_shortest_path"] * len(geometries),
                "segmentGeometryWarnings": [
                    "Closure detour on the driving graph; added moving time assumes 15 km/h."
                ]
                * len(geometries),
                "segmentDistanceM": distances,
                "distanceM": sum(distances),
                "provenance": "assumed",
            }
        )
    warnings.append(
        "Closure detours use the driving graph and an explicit 15 km/h moving-speed "
        "assumption; published baseline timings are retained plus detour time"
    )
