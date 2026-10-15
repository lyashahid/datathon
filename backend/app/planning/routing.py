"""Walking shortest paths and scheduled transit with explicit service calendars."""

from __future__ import annotations

import heapq
import math
from datetime import date, timedelta
from typing import Any

from app.planning.models import PlanningAssumptions
from app.routing.engine import _distance_m


def calendar_runs(calendar: dict[str, Any], day: date) -> bool:
    text = day.isoformat()
    if text in calendar.get("excludedDates", []):
        return False
    if text in calendar.get("includedDates", []):
        return True
    return (
        (not calendar.get("startDate") or text >= calendar["startDate"])
        and (not calendar.get("endDate") or text <= calendar["endDate"])
        and ((day.weekday() + 1) % 7 in calendar.get("weekdays", []))
    )


def pattern_trips(pattern: dict[str, Any], day: date) -> list[dict[str, Any]]:
    """Keep previous-day overnight trips; never repeat a snapshot on another date."""
    trips = []
    if pattern.get("enabled") is False:
        return trips
    for day_offset in (-1, 0, 1):
        if not calendar_runs(pattern.get("calendar", {}), day + timedelta(days=day_offset)):
            continue
        timing = pattern["timing"]
        if timing["kind"] == "scheduled":
            raw = timing["trips"]
        else:
            raw = []
            segments = timing["segmentMinutes"]
            for window_index, window in enumerate(timing["windows"]):
                departure = float(window["startMinutes"])
                while departure < window["endMinutes"]:
                    times = [{"arrivalMinutes": departure, "departureMinutes": departure}]
                    for segment in segments:
                        departure_at = times[-1]["departureMinutes"] + segment
                        times.append(
                            {"arrivalMinutes": departure_at, "departureMinutes": departure_at}
                        )
                    raw.append(
                        {"id": f"frequency:{window_index}:{departure:g}", "stopTimes": times}
                    )
                    departure += window["headwayMinutes"]
                    if len(raw) > 6000:
                        raise ValueError("Service contains too many departures")
        offset = day_offset * 1440
        for trip in raw:
            times = [
                {
                    "arrivalMinutes": t["arrivalMinutes"] + offset,
                    "departureMinutes": t["departureMinutes"] + offset,
                }
                for t in trip["stopTimes"]
            ]
            if times[-1]["arrivalMinutes"] >= 0 and times[0]["departureMinutes"] <= 1800:
                trips.append({"id": f"{trip['id']}@{day_offset}", "stopTimes": times})
    return trips


class WalkingNetwork:
    def __init__(
        self, network: dict[str, Any], wheelchair: bool = False, drive: bool = False
    ) -> None:
        self.nodes = {node["id"]: node for node in network["nodes"]}
        self.adjacency: dict[str, list[tuple[str, float, dict[str, Any], bool]]] = {}
        for edge in network["edges"]:
            if not edge.get("driveAllowed" if drive else "walkAllowed", False):
                continue
            if wheelchair and not drive and not edge.get("auditedWheelchairAllowed", False):
                continue
            if edge.get("driveForwardAllowed" if drive else "walkForwardAllowed", True):
                self.adjacency.setdefault(edge["from"], []).append(
                    (edge["to"], float(edge["distanceM"]), edge, False)
                )
            reverse = (
                edge.get("driveReverseAllowed", not edge.get("oneway", False))
                if drive
                else (edge.get("walkReverseAllowed", True))
            )
            if reverse:
                self.adjacency.setdefault(edge["to"], []).append(
                    (edge["from"], float(edge["distanceM"]), edge, True)
                )
        self.snap_node_ids = (
            set(self.adjacency)
            | {target for edges in self.adjacency.values() for target, _, _, _ in edges}
            if drive
            else set(self.nodes)
        )
        self._snap_cache: dict[tuple[float, float, str | None], tuple[str, float] | None] = {}

    def snap(self, point: dict[str, Any], max_distance: float) -> tuple[str, float] | None:
        key = (float(point["lon"]), float(point["lat"]), point.get("islandId"))
        if key not in self._snap_cache:
            best: tuple[str, float] | None = None
            for node_id, node in self.nodes.items():
                if node_id not in self.snap_node_ids:
                    continue
                if point.get("islandId") and node.get("islandId") != point["islandId"]:
                    continue
                distance = _distance_m([key[0], key[1]], [node["lon"], node["lat"]])
                if best is None or distance < best[1]:
                    best = node_id, distance
            self._snap_cache[key] = best
        best = self._snap_cache[key]
        return best if best and best[1] <= max_distance else None

    def tree(self, start: str, horizon_m: float) -> tuple[dict[str, float], dict[str, Any]]:
        queue = [(0.0, start)]
        distances = {start: 0.0}
        previous = {}
        while queue:
            distance, node = heapq.heappop(queue)
            if distance != distances[node]:
                continue
            for next_id, metres, edge, reverse in self.adjacency.get(node, []):
                candidate = distance + metres
                if candidate <= horizon_m and candidate < distances.get(next_id, math.inf):
                    distances[next_id] = candidate
                    previous[next_id] = node, edge, reverse
                    heapq.heappush(queue, (candidate, next_id))
        return distances, previous

    def geometry(self, previous: dict[str, Any], start: str, end: str) -> list[list[float]]:
        edges = []
        current = end
        while current != start and current in previous:
            prior, edge, reverse = previous[current]
            coordinates = edge.get("geometry", [])
            if len(coordinates) < 2:
                return []
            edges.append(list(reversed(coordinates)) if reverse else coordinates)
            current = prior
        if current != start:
            return []
        geometry = []
        for coordinates in reversed(edges):
            geometry.extend(
                coordinates[1:]
                if geometry and coordinates and geometry[-1] == coordinates[0]
                else coordinates
            )
        if not geometry and start == end:
            node = self.nodes[start]
            geometry = [[node["lon"], node["lat"]]]
        return geometry


def destination_eligible(facility: dict[str, Any], assumptions: PlanningAssumptions) -> bool:
    kinds = {"hospital", "clinic"} if assumptions.goal == "healthcare" else {"school"}
    if facility.get("kind") not in kinds or facility.get("operatingStatus") != "open":
        return False
    if facility.get("planningStatus") == "proposed":
        return assumptions.date.isoformat() >= facility.get("proposedOpeningDate", "9999")
    if facility.get("verification") not in {True, "official", "osm-mapped"}:
        return False
    if assumptions.goal == "healthcare" and facility.get("careScope") != "general":
        return False
    return True


class JourneyRouter:
    def __init__(
        self,
        world: dict[str, Any],
        assumptions: PlanningAssumptions,
        destinations: list[dict[str, Any]] | None = None,
    ) -> None:
        self.world, self.a = world, assumptions
        self.network = WalkingNetwork(world["network"], assumptions.require_audited_wheelchair)
        self.stops = {stop["id"]: stop for stop in world["stops"] if not stop.get("disabled")}
        self.stop_snaps = {
            key: self.network.snap(stop, assumptions.max_snap_m) for key, stop in self.stops.items()
        }
        self.facilities = (
            destinations
            if destinations is not None
            else [f for f in world["facilities"] if destination_eligible(f, assumptions)]
        )
        self.facility_snaps = {
            f["id"]: self.network.snap(f, assumptions.max_snap_m) for f in self.facilities
        }
        self.patterns_at: dict[str, list[tuple[dict[str, Any], int]]] = {}
        self.trips = {}
        for pattern in world["patterns"]:
            if pattern.get("enabled") is False:
                continue
            trips = pattern_trips(pattern, assumptions.date)
            self.trips[pattern["id"]] = trips
            if trips:
                for index, stop_id in enumerate(pattern["stopIds"][:-1]):
                    if (
                        stop_id in self.stops
                        and self.stops[stop_id].get("pickupAllowed") is not False
                    ):
                        self.patterns_at.setdefault(stop_id, []).append((pattern, index))
        self.stop_walk = {}
        self.egress = {}
        horizon = (
            max(assumptions.max_access_walk_minutes, assumptions.max_transfer_walk_minutes)
            * assumptions.walk_m_per_minute
        )
        for stop_id, snap in self.stop_snaps.items():
            if not snap:
                continue
            distances, previous = self.network.tree(snap[0], horizon)
            self.egress[stop_id] = self._best_destination(snap, distances, previous)
            connections = []
            for other_id, other_snap in self.stop_snaps.items():
                if other_id == stop_id or not other_snap:
                    continue
                metres = snap[1] + distances.get(other_snap[0], math.inf) + other_snap[1]
                if metres <= assumptions.max_transfer_walk_minutes * assumptions.walk_m_per_minute:
                    connections.append(
                        (
                            other_id,
                            metres / assumptions.walk_m_per_minute,
                            self.network.geometry(previous, snap[0], other_snap[0]),
                        )
                    )
            self.stop_walk[stop_id] = connections

    def _best_destination(
        self,
        snap: tuple[str, float],
        distances: dict[str, float],
        previous: dict[str, Any],
        max_minutes: float | None = None,
    ) -> Any:
        best = None
        for facility in self.facilities:
            target = self.facility_snaps[facility["id"]]
            if not target:
                continue
            metres = snap[1] + distances.get(target[0], math.inf) + target[1]
            minutes = metres / self.a.walk_m_per_minute
            if minutes <= (max_minutes or self.a.max_access_walk_minutes) and (
                best is None or minutes < best[0]
            ):
                best = minutes, facility, self.network.geometry(previous, snap[0], target[0])
        return best

    def route(self, origin: dict[str, Any]) -> dict[str, Any]:
        a = self.a
        snap = self.network.snap(origin, a.max_snap_m)
        if not snap:
            return fail(
                "unavailable",
                "Resident/destination location does not snap to a supported "
                "walking network within the selected tolerance",
            )
        distances, previous = self.network.tree(
            snap[0], a.max_journey_minutes * a.walk_m_per_minute
        )
        direct = self._best_destination(snap, distances, previous, a.max_journey_minutes)
        best_time = a.departure_minutes + direct[0] if direct else math.inf
        best_path = (
            [walk_leg(origin["id"], direct[1]["id"], direct[0], direct[2])] if direct else []
        )
        best_id = direct[1]["id"] if direct else None
        queue: list[tuple[float, str, int]] = []
        labels: dict[tuple[str, int], float] = {}
        paths = {}
        for stop_id, stop_snap in self.stop_snaps.items():
            if not stop_snap:
                continue
            metres = snap[1] + distances.get(stop_snap[0], math.inf) + stop_snap[1]
            minutes = metres / a.walk_m_per_minute
            if minutes <= a.max_access_walk_minutes:
                arrival = a.departure_minutes + minutes
                labels[stop_id, 0] = arrival
                paths[stop_id, 0] = [
                    walk_leg(
                        origin["id"],
                        stop_id,
                        minutes,
                        self.network.geometry(previous, snap[0], stop_snap[0]),
                    )
                ]
                heapq.heappush(queue, (arrival, stop_id, 0))
        while queue:
            arrival, stop_id, boardings = heapq.heappop(queue)
            if arrival != labels.get((stop_id, boardings)) or arrival >= best_time:
                continue
            path = paths[stop_id, boardings]
            if egress := self.egress.get(stop_id):
                final = arrival + egress[0]
                if final < best_time:
                    best_time, best_id = final, egress[1]["id"]
                    best_path = path + [walk_leg(stop_id, best_id, egress[0], egress[2])]
            for other_id, minutes, geometry in self.stop_walk.get(stop_id, []):
                new_time = arrival + minutes
                key = other_id, boardings
                if new_time < labels.get(key, math.inf):
                    labels[key] = new_time
                    paths[key] = path + [walk_leg(stop_id, other_id, minutes, geometry)]
                    heapq.heappush(queue, (new_time, other_id, boardings))
            if boardings >= a.max_transfers + 1:
                continue
            for pattern, index in self.patterns_at.get(stop_id, []):
                for trip in self.trips[pattern["id"]]:
                    departure = trip["stopTimes"][index]["departureMinutes"]
                    if departure < arrival + a.boarding_buffer_minutes or departure >= best_time:
                        continue
                    for next_index in range(index + 1, len(pattern["stopIds"])):
                        next_id = pattern["stopIds"][next_index]
                        if (
                            next_id not in self.stops
                            or self.stops[next_id].get("dropoffAllowed") is False
                        ):
                            continue
                        end = trip["stopTimes"][next_index]["arrivalMinutes"]
                        key = next_id, boardings + 1
                        if end >= labels.get(key, math.inf) or end >= best_time:
                            continue
                        if end - a.departure_minutes > a.max_journey_minutes:
                            continue
                        geometry, geometry_source, geometry_warning = transit_geometry(
                            pattern, index, next_index
                        )
                        leg = {
                            "mode": pattern["mode"],
                            "from": stop_id,
                            "to": next_id,
                            "minutes": round(end - departure, 3),
                            "wait_minutes": round(departure - arrival, 3),
                            "departure_minutes": departure,
                            "arrival_minutes": end,
                            "pattern_id": pattern["id"],
                            "route_id": pattern["routeId"],
                            "route_name": pattern["name"],
                            "from_stop_index": index,
                            "to_stop_index": next_index,
                            "trip_id": trip["id"],
                            "provenance": pattern.get("provenance", "assumed"),
                            "geometry": geometry,
                            "geometry_source": geometry_source,
                            "geometry_warning": geometry_warning,
                        }
                        labels[key], paths[key] = end, path + [leg]
                        heapq.heappush(queue, (end, next_id, boardings + 1))
        if best_id and best_time - a.departure_minutes <= a.max_journey_minutes:
            return {
                "status": "reachable",
                "minutes": round(best_time - a.departure_minutes, 3),
                "destination_id": best_id,
                "arrival_minutes": round(best_time, 3),
                "path": best_path,
                "geometry": [p for leg in best_path for p in leg["geometry"]],
                "reason": None,
            }
        return fail(
            "unavailable",
            "No journey in the known network/calendar horizon. "
            "Incomplete service evidence prevents interpreting this as measured no access.",
        )


def walk_leg(start: str, end: str, minutes: float, geometry: list[Any]) -> dict[str, Any]:
    return {
        "mode": "walk",
        "from": start,
        "to": end,
        "minutes": round(minutes, 3),
        "wait_minutes": 0,
        "geometry": geometry,
    }


def transit_geometry(
    pattern: dict[str, Any], start: int, end: int
) -> tuple[list[Any], str, str | None]:
    """Never join partial geometry into an invented shortcut across a missing segment."""
    segments = pattern.get("segmentGeometry", [])[start:end]
    warnings = pattern.get("segmentGeometryWarnings", [])[start:end]
    warning = " ".join(dict.fromkeys(text for text in warnings if text)) or None
    if len(segments) != end - start or any(len(segment) < 2 for segment in segments):
        return (
            [],
            "unavailable",
            warning or "A complete service path is unavailable in the snapshot.",
        )
    sources = pattern.get("segmentGeometrySources", [])[start:end]
    if len(sources) != len(segments):
        sources = ["source_service_geometry"] * len(segments)
    source = sources[0] if len(set(sources)) == 1 else "mixed"
    geometry = []
    for segment in segments:
        geometry.extend(segment[1:] if geometry and geometry[-1] == segment[0] else segment)
    return geometry, source, warning


def fail(status: str, reason: str) -> dict[str, Any]:
    return {
        "status": status,
        "reason": reason,
        "minutes": None,
        "destination_id": None,
        "arrival_minutes": None,
        "path": [],
        "geometry": [],
    }
