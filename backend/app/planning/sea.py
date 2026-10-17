"""Directional ferry evidence, conservative timed journeys and isolated proposals.

This is a small boarding-point network. It never repeats resident/accessibility
evaluation, infers boat assignments from AIS positions, or guesses sea runtimes.
"""

from __future__ import annotations

import copy
import hashlib
import heapq
import json
from collections import OrderedDict, deque
from datetime import date as ServiceDate
from datetime import timedelta
from threading import RLock
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.planning.models import PlanningAssumptions, PlanningOperation, PlanningRequest
from app.planning.repository import IDENTITY_BRIDGE
from app.planning.routing import pattern_trips, service_day_trips
from app.planning.sea_data import complete_calls, date_eligible, normalized_calls
from app.planning.water_corridor import (
    CORRIDOR_QUALIFICATION,
    CORRIDOR_SOURCE,
    WaterCorridorPlanner,
)
from app.planning.world import apply_operations


class SeaConnectionsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    origin_island_id: str = Field(pattern=r"^island:\d+$")
    date: ServiceDate
    departure_minutes: float = Field(default=480, ge=0, lt=1440)
    budget_minutes: int = Field(default=60, ge=1, le=360)
    return_deadline_minutes: float | None = Field(default=None, gt=0, le=1440)
    minimum_stay_minutes: float = Field(default=60, ge=0, le=720)
    max_transfers: int = Field(default=2, ge=0, le=4)
    operations: list[PlanningOperation] = Field(default_factory=list, max_length=100)
    assumptions: PlanningAssumptions = Field(default_factory=PlanningAssumptions)


def collection(features: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "FeatureCollection", "features": features}


def _source(source: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": source["id"],
        "title": source.get("title") or source.get("name") or source["id"],
        "url": source.get("url"),
        "publisher": source.get("publisher"),
        "retrieved_at": source.get("retrieved_at") or source.get("retrievedAt"),
        "published_at": source.get("published_at") or source.get("publishedAt"),
    }


class SeaConnectionsService:
    def __init__(self, transport: Any) -> None:
        self.transport = transport
        self.planning = transport.planning
        self.path = self.planning.repository.public_dir / "sea-services.json"
        self._snapshot_key: tuple[int, int] | None = None
        self._bundle: dict[str, Any] = {}
        self._lock = RLock()
        self._cache: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self._map_segments: OrderedDict[tuple, dict[str, Any] | None] = OrderedDict()
        self._shoreline_features = transport.repository.islands_by_id
        self._prepared_corridors_key: tuple[int, int] | None = None
        self._shoreline_fingerprint = self._geometry_fingerprint()

    def _snapshot(self) -> dict[str, Any]:
        stat = self.path.stat() if self.path.exists() else None
        key = (stat.st_mtime_ns, stat.st_size) if stat else (0, 0)
        with self._lock:
            if key != self._snapshot_key:
                self._bundle = json.loads(self.path.read_text("utf8")) if stat else {}
                self._snapshot_key = key
                self._cache.clear()
            return self._bundle

    def _island(self, identity: str) -> dict[str, Any]:
        return self.transport.island(identity)

    def _stop(self, raw: dict[str, Any], route_id: str, index: int) -> dict[str, Any]:
        if raw.get("island_id") is None:
            return {
                "id": f"{route_id}:unresolved:{index}",
                "terminal_id": None,
                "name": raw.get("name") or "Unmatched published stop",
                "island_id": None,
                "island_name": raw.get("name") or "Island identity unverified",
                "coordinates": None,
                "position_basis": "unresolved_official_stop",
            }
        terminal = self.transport.terminals.get(raw.get("terminal_id"))
        island = self._island(raw["island_id"])
        if terminal and terminal["island_id"] != island["id"]:
            terminal = None
        return {
            "id": terminal["id"] if terminal else f"{route_id}:call:{index}",
            "terminal_id": terminal["id"] if terminal else None,
            "name": terminal["name"] if terminal else raw.get("name") or island["name"],
            "island_id": island["id"],
            "island_name": island["name"],
            "coordinates": terminal["coordinates"] if terminal else None,
            "position_basis": "source_terminal" if terminal else "missing_terminal",
        }

    def _official_routes(self, body: SeaConnectionsRequest) -> list[dict[str, Any]]:
        routes = []
        for raw in self._snapshot().get("routes", []):
            known = self.transport.repository.islands_by_id
            if len(raw.get("stops", [])) < 2 or any(
                stop.get("island_id") is not None and stop["island_id"] not in known
                for stop in raw["stops"]
            ):
                continue
            route = {
                "id": raw["id"],
                "route_code": raw.get("route_code"),
                "name": raw["name"],
                "operator": raw.get("operator"),
                "evidence": "official_route",
                "source_ids": raw.get("source_ids", []),
                "valid_from": raw.get("valid_from"),
                "valid_until": raw.get("valid_until"),
                "published_valid_until": raw.get("published_valid_until"),
                "current_as_of": raw.get("current_as_of", self._snapshot().get("observed_until")),
                "validity_status": raw.get("status", "validity_unconfirmed"),
                "timing_status": raw.get("timing_status", "route_only"),
                "qualifications": list(raw.get("qualifications", [])),
                "proposed": False,
                "stops": [self._stop(stop, raw["id"], i) for i, stop in enumerate(raw["stops"])],
                "_trips": [],
                "frequency_windows": [
                    window
                    for window in raw.get("frequency_windows", [])
                    if body.date.weekday() in window.get("days", [])
                ],
                "no_service_windows": [
                    window
                    for window in raw.get("no_service_windows", [])
                    if body.date.weekday() in window.get("days", [])
                ],
                "unknown_windows": [
                    window
                    for window in raw.get("unknown_windows", [])
                    if body.date.weekday() in window.get("days", [])
                ],
                "no_scheduled_service": any(
                    day_type.get("no_scheduled_service", False)
                    for day_type in raw.get("published_departures", [])
                    if body.date.weekday() in day_type.get("days", [])
                ),
            }
            eligible = date_eligible(raw, body.date)
            route["network_verified"] = eligible
            published = []
            for day_type in raw.get("published_departures", []):
                if body.date.weekday() in day_type.get("days", []):
                    published.extend(day_type.get("departure_minutes", []))
            for sailing in raw.get("sailings", []):
                original_calls = normalized_calls(sailing.get("calls", []))
                if (
                    body.date.weekday() in sailing.get("days", [])
                    and original_calls
                    and isinstance(original_calls[0].get("departure_minutes"), (int, float))
                ):
                    published.append(original_calls[0]["departure_minutes"])
                if raw.get("timing_status") != "complete_timetable" or not complete_calls(
                    original_calls
                ):
                    continue
                if any(call.get("island_id") not in known for call in original_calls):
                    continue
                for offset in (-1, 0):
                    service_day = body.date + timedelta(days=offset)
                    if service_day.weekday() not in sailing.get("days", []) or not date_eligible(
                        raw, service_day
                    ):
                        continue
                    calls = [
                        {
                            **self._stop(call, raw["id"], i),
                            "arrival_minutes": call["arrival_minutes"] + offset * 1440,
                            "departure_minutes": call["departure_minutes"] + offset * 1440,
                        }
                        for i, call in enumerate(original_calls)
                    ]
                    if calls[-1]["arrival_minutes"] < 0:
                        continue
                    equivalence = sailing.get("equivalence_key")
                    route["_trips"].append(
                        {
                            "id": f"{sailing['id']}@{offset}",
                            "equivalence_key": f"{equivalence}@{offset}" if equivalence else None,
                            "calls": calls,
                        }
                    )
            route["published_departures"] = sorted(set(published))
            if route["_trips"]:
                route["evidence"] = "dated_service"
            if not eligible:
                route["qualifications"].append(
                    "Current operation is not established for the selected date; "
                    "published times are reference evidence, excluded from timed reachability."
                )
            if any(stop["island_id"] is None for stop in route["stops"]):
                route["qualifications"].append(
                    "A published stop has no matched national island polygon or terminal. "
                    "Its timetable remains visible here; no map point or timed "
                    "connection is invented."
                )
            if (
                eligible
                and route["current_as_of"]
                and body.date.isoformat() > route["current_as_of"]
            ):
                route["projection_status"] = "published_pattern_projection"
                route["qualifications"].append(
                    "Future occurrence of the published recurring timetable, projected from "
                    f"the source checked on {route['current_as_of']}; recheck the operator."
                )
            routes.append(self._finish_route(route))
        return self._merge_official_routes(routes)

    def _merge_official_routes(self, routes: list[dict[str, Any]]) -> list[dict[str, Any]]:
        groups: dict[tuple[Any, ...], list[dict[str, Any]]] = {}
        for route in routes:
            key = (
                route.get("route_code") or route["id"],
                route["operator"],
                tuple((s["island_id"], s.get("terminal_id")) for s in route["stops"]),
            )
            groups.setdefault(key, []).append(route)
        merged = []
        for equivalents in groups.values():
            route = copy.deepcopy(equivalents[0])
            route["source_route_ids"] = [item["id"] for item in equivalents]
            if len(equivalents) > 1:
                trips = {}
                for item in equivalents:
                    for trip in item["_trips"]:
                        key = trip.get("equivalence_key") or tuple(
                            (s["id"], s["arrival_minutes"], s["departure_minutes"])
                            for s in trip["calls"]
                        )
                        trips[key] = trip
                route["_trips"] = list(trips.values())
                route["source_ids"] = sorted(
                    {s for item in equivalents for s in item["source_ids"]}
                )
                route["published_departures"] = sorted(
                    {d for item in equivalents for d in item["published_departures"]}
                )
                route["qualifications"] = list(
                    dict.fromkeys(q for item in equivalents for q in item["qualifications"])
                )
                route["valid_from"] = min(
                    (item["valid_from"] for item in equivalents if item["valid_from"]), default=None
                )
                route["valid_until"] = (
                    None
                    if any(not item["valid_until"] for item in equivalents)
                    else max(item["valid_until"] for item in equivalents)
                )
                if route["_trips"]:
                    route["evidence"] = "dated_service"
                route["network_verified"] = any(
                    item.get("network_verified") for item in equivalents
                )
                route["qualifications"].append(
                    "Equivalent directional publication records are shown together; "
                    "the same dated sailing is counted once."
                )
            merged.append(self._finish_route(route))
        return merged

    def _world_routes(
        self, world: dict[str, Any], body: SeaConnectionsRequest
    ) -> list[dict[str, Any]]:
        stops = {stop["id"]: stop for stop in world["stops"] if not stop.get("disabled")}
        routes = []
        for pattern in world["patterns"]:
            if pattern.get("mode") != "ferry" or pattern.get("enabled") is False:
                continue
            if pattern.get("seaSourceRouteId"):
                # The same official route is displayed from its richer source record.
                continue
            if any(identity not in stops for identity in pattern["stopIds"]):
                continue
            calls = []
            for identity in pattern["stopIds"]:
                stop = stops[identity]
                island_id = IDENTITY_BRIDGE.get(stop["islandId"], stop["islandId"])
                if island_id not in self.transport.repository.islands_by_id:
                    break
                calls.append(
                    {
                        "id": identity,
                        "terminal_id": identity,
                        "island_id": island_id,
                        "island_name": self._island(island_id)["name"],
                        "name": stop["name"],
                        "coordinates": [stop["lon"], stop["lat"]],
                        "position_basis": "source_terminal"
                        if identity in self.transport.terminals
                        else "scenario_stop",
                    }
                )
            if len(calls) != len(pattern["stopIds"]):
                continue
            proposed = pattern.get("provenance") == "assumed"
            route = {
                "id": pattern["id"],
                "name": pattern["name"],
                "operator": pattern.get("operator") or ("Proposed service" if proposed else None),
                "evidence": "proposal" if proposed else "dated_service",
                "proposed": proposed,
                "source_ids": pattern.get("sourceIds", []),
                "valid_from": pattern.get("calendar", {}).get("startDate"),
                "valid_until": pattern.get("calendar", {}).get("endDate"),
                "validity_status": "scenario" if proposed else "dated_snapshot",
                "timing_status": "assumed_timetable" if proposed else "complete_timetable",
                "qualifications": [
                    "Scenario departures and crossing times are assumptions, "
                    "not an operating service."
                ]
                if proposed
                else ["Captured dated timetable; check operator notices before travel."],
                "stops": calls,
                "_trips": [
                    {
                        "id": trip["id"],
                        "calls": [
                            {
                                **stop,
                                "arrival_minutes": time["arrivalMinutes"],
                                "departure_minutes": time["departureMinutes"],
                            }
                            for stop, time in zip(calls, trip["stopTimes"])
                        ],
                    }
                    for trip in pattern_trips(pattern, body.date)
                ],
                "published_departures": [
                    trip["stopTimes"][0]["departureMinutes"]
                    for trip in service_day_trips(pattern, body.date)
                ],
            }
            route["network_verified"] = bool(route["_trips"])
            segments = pattern.get("segmentGeometry", [])
            points = [point for segment in segments for point in segment]
            if len(points) > 1:
                route["geometry"] = {"type": "LineString", "coordinates": points}
                route["geometry_basis"] = "scenario_corridor" if proposed else "source_geometry"
            routes.append(self._finish_route(route))
        return routes

    def _mapped_routes(self) -> list[dict[str, Any]]:
        nodes = {node["id"]: node for node in self.transport.routing.marine.get("nodes", [])}
        routes = []
        for edge in self.transport.routing.marine.get("edges", []):
            a, b = nodes.get(edge["from_id"]), nodes.get(edge["to_id"])
            if not a or not b or a.get("island_id") == b.get("island_id"):
                continue
            known = self.transport.repository.islands_by_id
            if a.get("island_id") not in known or b.get("island_id") not in known:
                continue
            routes.append(
                self._finish_route(
                    {
                        "id": f"mapped:{edge['id']}",
                        "name": a.get("name") or "Mapped ferry corridor",
                        "operator": None,
                        "evidence": "mapped_route",
                        "source_ids": ["openstreetmap"],
                        "valid_from": None,
                        "valid_until": None,
                        "validity_status": "unverified",
                        "timing_status": "route_only",
                        "qualifications": [
                            "Mapped corridor only; service operation, direction and timetable "
                            "need operator confirmation. It does not create timed reachability."
                        ],
                        "proposed": False,
                        "stops": [
                            {
                                "id": node["id"],
                                "terminal_id": node["id"]
                                if node["id"] in self.transport.terminals
                                else None,
                                "name": node.get("name") or self._island(node["island_id"])["name"],
                                "island_id": node["island_id"],
                                "coordinates": node["coordinates"],
                                "position_basis": "source_terminal"
                                if node["id"] in self.transport.terminals
                                else "mapped_endpoint",
                            }
                            for node in (a, b)
                        ],
                        "geometry": {
                            "type": "LineString",
                            "coordinates": edge.get("geometry")
                            or [a["coordinates"], b["coordinates"]],
                        },
                        "geometry_basis": "mapped_corridor",
                        "_trips": [],
                        "published_departures": [],
                    }
                )
            )
        return routes

    def _reviewed_routes(
        self, body: SeaConnectionsRequest, services: list[dict[str, Any]]
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        """Reuse accepted official-source imports without promoting assumed runtimes.

        Supplied terminal labels are not a verified catalogue identity, so these
        direct journeys cannot silently transfer to a different service.
        """
        routes, sources = [], {}
        for service in services:
            if service.get("mode") != "ferry":
                continue
            identity = f"reviewed:{service['id']}"
            snapshot_id = service.get("snapshot_id", service["id"])
            source_id = f"reviewed:{snapshot_id}:{service.get('source_index', 0)}"
            source = service.get("source", {})
            sources[source_id] = {
                "id": source_id,
                "title": f"Reviewed {source.get('publisher', 'operator')} timetable import",
                "url": source.get("url"),
                "publisher": source.get("publisher"),
                "retrieved_at": source.get("retrieved_at"),
            }
            stops = [
                self._stop(
                    {
                        "island_id": service[f"{side}_island_id"],
                        "name": service[f"{side}_terminal"],
                    },
                    identity,
                    index,
                )
                for index, side in enumerate(("from", "to"))
            ]
            active = (
                service["effective_from"] <= body.date.isoformat() <= service["effective_until"]
                and body.date.isoweekday() in service["weekdays"]
            )
            departure = service["departure"]
            hour, minute, *_ = map(int, departure.split(":"))
            departure_minutes = hour * 60 + minute
            trips = []
            if active and service["timing_basis"] == "published_arrival":
                hour, minute, *_ = map(int, service["arrival"].split(":"))
                arrival_minutes = hour * 60 + minute + service.get("arrival_day_offset", 0) * 1440
                trips = [
                    {
                        "id": identity,
                        "calls": [
                            {
                                **stops[0],
                                "arrival_minutes": departure_minutes,
                                "departure_minutes": departure_minutes,
                            },
                            {
                                **stops[1],
                                "arrival_minutes": arrival_minutes,
                                "departure_minutes": arrival_minutes,
                            },
                        ],
                    }
                ]
            routes.append(
                self._finish_route(
                    {
                        "id": identity,
                        "name": service["name"],
                        "operator": source.get("publisher"),
                        "evidence": "dated_service" if trips else "official_route",
                        "source_ids": [source_id],
                        "valid_from": service["effective_from"],
                        "valid_until": service["effective_until"],
                        "validity_status": "reviewed_dated_import",
                        "timing_status": service["timing_basis"],
                        "network_verified": active,
                        "qualifications": [
                            "Accepted official-source timetable import; terminal labels are "
                            "not matched catalogue identifiers, so transfers remain unknown.",
                            "Only published arrivals support timed reachability. Imported "
                            "assumed runtimes are excluded from the official baseline.",
                        ],
                        "proposed": False,
                        "stops": stops,
                        "_trips": trips,
                        "published_departures": [departure_minutes]
                        if body.date.isoweekday() in service["weekdays"]
                        else [],
                    }
                )
            )
        return routes, list(sources.values())

    @staticmethod
    def _finish_route(route: dict[str, Any]) -> dict[str, Any]:
        stops = route["stops"]
        route["from_island_id"], route["to_island_id"] = (
            stops[0]["island_id"],
            stops[-1]["island_id"],
        )
        route["stop_island_ids"] = [stop["island_id"] for stop in stops if stop["island_id"]]
        route["departures"] = sorted(
            {
                trip["calls"][0]["departure_minutes"]
                for trip in route["_trips"]
                if 0 <= trip["calls"][0]["departure_minutes"] < 1440
            }
        )
        route["departure_count"] = len(route["departures"]) if route["_trips"] else None
        crossings = [
            trip["calls"][-1]["arrival_minutes"] - trip["calls"][0]["departure_minutes"]
            for trip in route["_trips"]
        ]
        route["crossing_minutes"] = round(min(crossings), 2) if crossings else None
        # Map geometry is derived only for the visible component, after topology
        # and timetables are evaluated. Never join missing stops or centroids.
        route.setdefault("geometry", None)
        return route

    def _map_geometry(self, route: dict[str, Any]) -> None:
        """Connect exact ports around mapped land without changing travel times."""
        route["geometry"] = None
        stops = route["stops"]
        if len(stops) < 2 or any(
            not (terminal := self.transport.terminals.get(stop.get("terminal_id")))
            or terminal["island_id"] != stop.get("island_id")
            or terminal["coordinates"] != stop.get("coordinates")
            or stop.get("position_basis") not in {"source_terminal", "scenario_stop"}
            for stop in stops
        ):
            route["geometry_basis"] = "missing_terminal"
            note = "Connection line unavailable: a recorded port location is missing."
        else:
            coordinates = []
            # The route cache is separate from date/time results: the same pair
            # of ports needs one geometric calculation across directions/dates.
            with self._lock:
                if self._shoreline_features is not self.transport.repository.islands_by_id:
                    self._shoreline_features = self.transport.repository.islands_by_id
                    self.transport.water_corridors = WaterCorridorPlanner(self._shoreline_features)
                    self._map_segments.clear()
                    self._shoreline_fingerprint = self._geometry_fingerprint()
                    self._prepared_corridors_key = None
                self._load_prepared_corridors()
                for first, second in zip(stops, stops[1:]):
                    ends = (
                        (first["island_id"], tuple(first["coordinates"])),
                        (second["island_id"], tuple(second["coordinates"])),
                    )
                    key = tuple(sorted(ends))
                    reverse = ends != key
                    if key not in self._map_segments:
                        a, b = (second, first) if reverse else (first, second)
                        self._map_segments[key] = self.transport.water_corridors.corridor(a, b)
                        while len(self._map_segments) > 512:
                            self._map_segments.popitem(last=False)
                    self._map_segments.move_to_end(key)
                    segment = self._map_segments[key]
                    if not segment:
                        break
                    points = segment["geometry"]
                    points = list(reversed(points)) if reverse else points
                    coordinates.extend(points[1:] if coordinates else points)
                else:
                    route["geometry"] = {"type": "LineString", "coordinates": coordinates}
                    route["geometry_basis"] = CORRIDOR_SOURCE
                    note = CORRIDOR_QUALIFICATION
                    if note not in route["qualifications"]:
                        route["qualifications"].append(note)
                    return
            route["geometry_basis"] = "water_corridor_unavailable"
            note = (
                "Connection line unavailable: a sea path between the recorded ports "
                "could not be established around the mapped shoreline."
            )
        if note not in route["qualifications"]:
            route["qualifications"].append(note)

    def _geometry_fingerprint(self) -> str:
        geometry = {key: item.get("geometry") for key, item in self._shoreline_features.items()}
        return hashlib.sha256(
            json.dumps(geometry, sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()

    def _load_prepared_corridors(self) -> None:
        """Use checked preparation output only with identical source shorelines."""
        path = self.path.with_name("sea-corridors.json")
        stat = path.stat() if path.exists() else None
        key = (stat.st_mtime_ns, stat.st_size) if stat else (0, 0)
        if key == self._prepared_corridors_key:
            return
        self._prepared_corridors_key = key
        if not stat:
            return
        prepared = json.loads(path.read_text("utf8"))
        if (
            prepared.get("schema_version") != 1
            or prepared.get("corridor_model_version") != 1
            or prepared.get("shoreline_fingerprint") != self._shoreline_fingerprint
        ):
            return
        for item in prepared.get("segments", []):
            ends = tuple(
                (item[side]["island_id"], tuple(item[side]["coordinates"]))
                for side in ("first", "second")
            )
            self._map_segments[ends] = item["corridor"]
        while len(self._map_segments) > 512:
            self._map_segments.popitem(last=False)

    @staticmethod
    def _topology(
        routes: list[dict[str, Any]], origin: str, max_transfers: int, *, mapped: bool = False
    ) -> dict[str, list[str]]:
        adjacency: dict[str, list[tuple[str, str]]] = {}
        for route in routes:
            # The all-evidence graph can continue through a documented current
            # route into an unverified corridor. Only the verified graph earns
            # direct/transfer status; historical references stay amber/unknown.
            if not mapped and not route.get("network_verified", False):
                continue
            # Unknown intermediate geography cannot be silently skipped to
            # claim a national network link through an unresolved island.
            ids = [stop["island_id"] for stop in route["stops"]]
            # Every downstream stop is accessible while staying on this route;
            # intermediate calls are not counted as transfers.
            for i, first in enumerate(ids[:-1]):
                for second in ids[i + 1 :]:
                    if first and second and first != second:
                        adjacency.setdefault(first, []).append((second, route["id"]))
        paths: dict[str, list[str]] = {origin: []}
        queue = deque([origin])
        while queue:
            island = queue.popleft()
            if len(paths[island]) > max_transfers:
                continue
            for destination, route_id in adjacency.get(island, []):
                if destination not in paths:
                    paths[destination] = paths[island] + [route_id]
                    queue.append(destination)
        return paths

    @staticmethod
    def _journeys(
        routes: list[dict[str, Any]],
        origin: str,
        start: float,
        max_transfers: int,
        buffer: float,
        *,
        origin_terminal_id: str | None = None,
        deadline: float = 1440,
    ) -> dict[str, dict[str, Any]]:
        rides: dict[str, list[dict[str, Any]]] = {}
        for route in routes:
            for trip in route["_trips"]:
                calls = trip["calls"]
                for i, first in enumerate(calls[:-1]):
                    departure = first["departure_minutes"]
                    if not start <= departure < deadline:
                        continue
                    for last in calls[i + 1 :]:
                        arrival = last["arrival_minutes"]
                        if first["island_id"] == last["island_id"] or arrival > deadline:
                            continue
                        rides.setdefault(first["island_id"], []).append(
                            {
                                "route_id": route["id"],
                                "name": route["name"],
                                "from_island_id": first["island_id"],
                                "to_island_id": last["island_id"],
                                "from_terminal_id": first.get("terminal_id"),
                                "to_terminal_id": last.get("terminal_id"),
                                "departure_minutes": departure,
                                "arrival_minutes": arrival,
                                "source_ids": route["source_ids"],
                                "proposed": route["proposed"],
                            }
                        )
        # Keep a state per landing and number of boardings. An earlier arrival at
        # another port cannot suppress a later but transfer-feasible connection.
        queue: list[tuple[float, int, str, str, list[dict[str, Any]]]] = [
            (start, 0, origin, origin_terminal_id or "", [])
        ]
        best = {(origin, origin_terminal_id or "", 0): start}
        result: dict[str, dict[str, Any]] = {}
        serial = 0
        pending = [(start, serial, queue[0])]
        while pending:
            _, _, (at, count, island, terminal, legs) = heapq.heappop(pending)
            if count > max_transfers:
                continue
            for raw in rides.get(island, []):
                # At the origin the visitor chooses a boarding point. Every
                # subsequent transfer (including a return trip) needs the same
                # verified terminal identity; no cross-island teleportation.
                if (count or origin_terminal_id) and (
                    not terminal or raw["from_terminal_id"] != terminal
                ):
                    continue
                if raw["departure_minutes"] < at + buffer:
                    continue
                leg = {**raw, "wait_minutes": round(raw["departure_minutes"] - at, 2)}
                path = legs + [leg]
                target, arrival = raw["to_island_id"], raw["arrival_minutes"]
                landing = raw["to_terminal_id"] or ""
                state = (target, landing, count + 1)
                if arrival >= best.get(state, float("inf")):
                    continue
                best[state] = arrival
                if target != origin and arrival < result.get(target, {}).get(
                    "arrival_minutes", float("inf")
                ):
                    result[target] = {
                        "departure_minutes": path[0]["departure_minutes"],
                        "arrival_minutes": arrival,
                        "total_minutes": round(arrival - start, 2),
                        "wait_minutes": round(sum(x["wait_minutes"] for x in path), 2),
                        "sailing_minutes": round(
                            sum(x["arrival_minutes"] - x["departure_minutes"] for x in path), 2
                        ),
                        "transfers": len(path) - 1,
                        "legs": path,
                    }
                serial += 1
                heapq.heappush(
                    pending, (arrival, serial, (arrival, count + 1, target, landing, path))
                )
        return result

    def _view(self, routes: list[dict[str, Any]], body: SeaConnectionsRequest) -> dict[str, Any]:
        paths = self._topology(routes, body.origin_island_id, body.max_transfers)
        mapped = self._topology(routes, body.origin_island_id, body.max_transfers, mapped=True)
        journeys = self._journeys(
            routes,
            body.origin_island_id,
            body.departure_minutes,
            body.max_transfers,
            body.assumptions.boarding_buffer_minutes,
        )
        destinations = []
        for identity in sorted(
            (paths.keys() | mapped.keys() | journeys.keys()) - {body.origin_island_id}
        ):
            journey = journeys.get(identity)
            path = paths.get(identity)
            return_journey = None
            return_status = "not_requested" if body.return_deadline_minutes is None else "unknown"
            if body.return_deadline_minutes is not None and journey:
                terminal = journey["legs"][-1]["to_terminal_id"]
                if terminal:
                    return_journey = self._journeys(
                        routes,
                        identity,
                        journey["arrival_minutes"] + body.minimum_stay_minutes,
                        body.max_transfers,
                        body.assumptions.boarding_buffer_minutes,
                        origin_terminal_id=terminal,
                        deadline=body.return_deadline_minutes,
                    ).get(body.origin_island_id)
                    return_status = "feasible" if return_journey else "not_found"
            destinations.append(
                {
                    **self._island(identity),
                    "status": "direct"
                    if path and len(path) == 1
                    else "transfer"
                    if path
                    else "unverified",
                    "route_ids": path or mapped.get(identity, []),
                    "transfers": len(path) - 1 if path else None,
                    "journey": journey,
                    "within_budget": bool(
                        journey and journey["total_minutes"] <= body.budget_minutes
                    ),
                    "return_journey": return_journey,
                    "return_status": return_status,
                }
            )
        destinations.sort(
            key=lambda item: (
                not item["within_budget"],
                (item["journey"] or {}).get("total_minutes", float("inf")),
                item["name"],
            )
        )
        # Show the selected island's documented connected component, including
        # onward links and returns, rather than overwhelming every national route.
        component = set(paths) | set(mapped)
        visible = [route for route in routes if component.intersection(route["stop_island_ids"])]
        for route in visible:
            self._map_geometry(route)
            route["origin_departures"] = sorted(
                {
                    call["departure_minutes"]
                    for trip in route["_trips"]
                    for call in trip["calls"][:-1]
                    if call["island_id"] == body.origin_island_id
                    and 0 <= call["departure_minutes"] < 1440
                }
            )
        features = []
        for route in visible:
            if route["geometry"]:
                features.append(
                    {
                        "type": "Feature",
                        "id": route["id"],
                        "geometry": route["geometry"],
                        "properties": {
                            "kind": "sea_route",
                            "route_id": route["id"],
                            "name": route["name"],
                            "evidence": route["evidence"],
                            "proposed": route["proposed"],
                            "from_island_id": route["from_island_id"],
                            "to_island_id": route["to_island_id"],
                            "geometry_basis": route["geometry_basis"],
                        },
                    }
                )
        for item in destinations:
            if item["coordinates"]:
                features.append(
                    {
                        "type": "Feature",
                        "id": f"sea-island:{item['id']}",
                        "geometry": {"type": "Point", "coordinates": item["coordinates"]},
                        "properties": {
                            "kind": "sea_destination",
                            "island_id": item["id"],
                            "name": item["name"],
                            "status": item["status"],
                            "within_budget": item["within_budget"],
                            "total_minutes": (item["journey"] or {}).get("total_minutes"),
                            "return_status": item["return_status"],
                            "proposed": any(
                                leg["proposed"] for leg in (item["journey"] or {}).get("legs", [])
                            ),
                        },
                    }
                )
        ports = {
            stop["terminal_id"]: stop
            for route in visible
            if route["geometry"]
            for stop in route["stops"]
        }
        for identity, port in ports.items():
            features.append(
                {
                    "type": "Feature",
                    "id": f"sea-port:{identity}",
                    "geometry": {"type": "Point", "coordinates": port["coordinates"]},
                    "properties": {
                        "kind": "sea_terminal",
                        "terminal_id": identity,
                        "island_id": port["island_id"],
                        "name": port.get("island_name") or self._island(port["island_id"])["name"],
                        "terminal_name": port["name"],
                        "status": "direct",
                    },
                }
            )
        return {
            "summary": {
                "direct_islands": sum(x["status"] == "direct" for x in destinations),
                "transfer_islands": sum(x["status"] == "transfer" for x in destinations),
                "timed_reachable_islands": sum(x["within_budget"] for x in destinations),
                "return_feasible_islands": sum(
                    x["within_budget"] and x["return_status"] == "feasible" for x in destinations
                ),
                "route_count": len(visible),
                "departures_today": sum(len(route["origin_departures"]) for route in visible),
            },
            "destinations": destinations,
            "routes": [
                {key: value for key, value in route.items() if key != "_trips"} for route in visible
            ],
            "map_features": collection(features),
        }

    def connections(self, body: SeaConnectionsRequest) -> dict[str, Any]:
        origin = self._island(body.origin_island_id)
        bundle = self._snapshot()
        world = self.planning._baseline_view()
        reviewed = self.transport.updates.catalogue().get("services", [])
        corridor_path = self.path.with_name("sea-corridors.json")
        corridor_stat = corridor_path.stat() if corridor_path.exists() else None
        # The response is cached only for source-only queries. Scenario replies
        # remain isolated; changing source content invalidates the bounded cache.
        cache_key = self.planning._digest(
            {
                "request": body.model_dump(mode="json"),
                "baseline": self.planning.repository.baseline_fingerprint(),
                "source": self._snapshot_key,
                "reviewed_services": reviewed,
                "corridors": (corridor_stat.st_mtime_ns, corridor_stat.st_size)
                if corridor_stat
                else None,
            }
        )
        if not body.operations:
            with self._lock:
                if cache_key in self._cache:
                    self._cache.move_to_end(cache_key)
                    return copy.deepcopy(self._cache[cache_key])
        official = self._official_routes(body)
        reviewed_routes, reviewed_sources = self._reviewed_routes(body, reviewed)
        other = self._mapped_routes() + reviewed_routes
        baseline = self._view(official + self._world_routes(world, body) + other, body)
        scenario, warnings = None, []
        if body.operations:
            # Do not copy/index the nationwide road graph to compare ferry links.
            # Reuse the validated operation engine on a small ferry-only world.
            proxy = copy.copy(self.planning.repository)
            proxy.baseline = {
                "islands": world.get(
                    "islands", self.planning.repository.baseline.get("islands", [])
                ),
                "network": {"nodes": [], "edges": []},
                "facilities": [],
                "transit": {
                    "stops": world["stops"],
                    "patterns": [p for p in world["patterns"] if p.get("mode") == "ferry"],
                },
            }
            ferry_ids = {p["id"] for p in proxy.baseline["transit"]["patterns"]}
            operations = []
            for operation in body.operations:
                if operation.type in {"add_service", "replace_service"}:
                    if (operation.service or {}).get("mode") != "ferry":
                        continue
                    if operation.service:
                        ferry_ids.add(operation.service["id"])
                elif operation.type == "weather_disruption":
                    if "ferry" not in operation.disabled_modes:
                        continue
                elif (
                    operation.type != "use_existing_ferry_terminal"
                    and operation.target_id not in ferry_ids
                ):
                    continue
                operations.append(operation)
            assumptions = body.assumptions.model_copy(
                update={"date": body.date, "departure_minutes": body.departure_minutes}
            )
            proposed, warnings = apply_operations(
                proxy,
                PlanningRequest(assumptions=assumptions, operations=operations),
                share_unchanged_network=True,
            )
            changed_ids = {op.target_id for op in operations if op.target_id in ferry_ids}
            changed_source_ids = {
                identity
                for p in world["patterns"]
                if p.get("id") in changed_ids and p.get("seaSourceRouteId")
                for identity in p.get("seaSourceRouteIds", [p["seaSourceRouteId"]])
            }
            changed_source_ids.update(
                identity
                for route in official
                if changed_source_ids.intersection(route["source_route_ids"])
                for identity in route["source_route_ids"]
            )
            official_after = [
                route
                for route in official
                if not changed_source_ids.intersection(route["source_route_ids"])
            ]
            for pattern in proposed["patterns"]:
                if changed_source_ids.intersection(
                    pattern.get("seaSourceRouteIds", [pattern.get("seaSourceRouteId")])
                ):
                    pattern.pop("seaSourceRouteId", None)
                    pattern.pop("seaSourceRouteIds", None)
            if any(
                op.type == "weather_disruption" and "ferry" in op.disabled_modes
                for op in operations
            ):
                official_after = []
            scenario = self._view(official_after + self._world_routes(proposed, body) + other, body)
        before = {item["id"]: item for item in baseline["destinations"]}
        after = {item["id"]: item for item in (scenario or baseline)["destinations"]}
        newly = sorted(
            identity
            for identity, item in after.items()
            if item["within_budget"] and not before.get(identity, {}).get("within_budget")
        )
        lost = sorted(
            identity
            for identity, item in before.items()
            if item["within_budget"] and not after.get(identity, {}).get("within_budget")
        )
        improved = sorted(
            identity
            for identity, item in after.items()
            if item["journey"]
            and before.get(identity, {}).get("journey")
            and item["journey"]["total_minutes"] < before[identity]["journey"]["total_minutes"]
        )
        sources = {_source(source)["id"]: _source(source) for source in bundle.get("sources", [])}
        sources.update({source["id"]: source for source in reviewed_sources})
        sources.setdefault(
            "openstreetmap",
            {
                "id": "openstreetmap",
                "title": "Mapped ferry corridors",
                "url": "https://www.openstreetmap.org/copyright",
                "publisher": "OpenStreetMap contributors",
            },
        )
        documented = {identity for route in official for identity in route["stop_island_ids"]}
        result = {
            "origin": origin,
            "date": body.date.isoformat(),
            "service_date": body.date.isoformat(),
            "timezone": "Indian/Maldives",
            "departure_minutes": body.departure_minutes,
            "budget_minutes": body.budget_minutes,
            "minimum_stay_minutes": body.minimum_stay_minutes,
            "return_deadline_minutes": body.return_deadline_minutes,
            "baseline": baseline,
            "scenario": scenario,
            "comparison": {
                "newly_reachable_island_ids": newly,
                "new_island_ids": newly,
                "time_improved_island_ids": improved,
                "improved_island_ids": improved,
                "lost_reachable_island_ids": lost,
                "new_direct_island_ids": sorted(
                    identity
                    for identity, item in after.items()
                    if item["status"] == "direct"
                    and before.get(identity, {}).get("status") != "direct"
                ),
                "unique_destination_delta": len(newly) - len(lost),
                "warnings": warnings,
            },
            "map_features": (scenario or baseline)["map_features"],
            "sources": list(sources.values()),
            "coverage": {
                "documented_islands": len(documented),
                "total_islands": len(self.transport.repository.islands_by_id),
                "timed_routes": sum(bool(route["_trips"]) for route in official),
                "origin_documented": body.origin_island_id in documented,
                "notes": [
                    "Missing evidence does not mean no ferry or terminal exists.",
                    "Direct/transfer labels describe documented directional network links; "
                    "a journey time appears only with date-valid complete "
                    "arrival/departure evidence.",
                    "Transfers require the same verified terminal; walking between separate "
                    "landings is not assumed. Timed totals include waiting and boarding buffer, "
                    "but exclude travel from home or onward to a destination.",
                    "No timetable is a live guarantee: weather, cancellations, public-holiday "
                    "exceptions, ticket availability and vessel capacity are not verified.",
                ],
            },
            "vessel_assignment": {
                "status": "unmatched",
                "reason": "This boat has not been linked to a passenger route. "
                "Its position alone does not identify the service it operates.",
            },
            "qualification": "Boarding-point ferry planning, not door-to-door resident access. "
            "Official directory and historical routes are distinguished from date-valid timings; "
            "proposal service times are explicit assumptions.",
        }
        if not body.operations:
            with self._lock:
                self._cache[cache_key] = copy.deepcopy(result)
                while len(self._cache) > 24:
                    self._cache.popitem(last=False)
        return result
