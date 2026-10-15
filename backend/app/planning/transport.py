"""Island connectivity evidence and reversible ferry-service planning overlays.

Mapped infrastructure, published departures and reviewed arrival schedules are
different evidence classes. A missing link is never proof that no service exists.
"""

from __future__ import annotations

import hashlib
import json
import math
from collections import deque
from datetime import date
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.planning.models import PlanningAssumptions, PlanningOperation, PlanningRequest
from app.planning.repository import IDENTITY_BRIDGE
from app.planning.routing import WalkingNetwork, pattern_trips, service_day_trips
from app.routing.engine import _distance_m


class FerryServiceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    origin_island_id: str = Field(pattern=r"^island:\d+$")
    destination_island_id: str = Field(pattern=r"^island:\d+$")
    origin_terminal_id: str | None = None
    destination_terminal_id: str | None = None
    headway_minutes: int = Field(default=120, ge=15, le=720)
    start_minutes: int = Field(default=360, ge=0, lt=1440)
    end_minutes: int = Field(default=1200, gt=0, le=1440)
    speed_kph: float = Field(default=25, ge=10, le=60)
    assumptions: PlanningAssumptions = Field(default_factory=PlanningAssumptions)
    operations: list[PlanningOperation] = Field(default_factory=list, max_length=96)

    @model_validator(mode="after")
    def ordered(self) -> FerryServiceRequest:
        if self.origin_island_id == self.destination_island_id:
            raise ValueError("Choose different islands for a ferry service")
        if self.end_minutes <= self.start_minutes:
            raise ValueError("Ferry operating hours must have an ordered start and end")
        return self


def terminal_catalogue(
    repository: Any, routing: Any, public_dir: Path | None = None
) -> dict[str, dict[str, Any]]:
    """Only explicitly tagged ferry terminals can be reused without construction.

    The category classifier gives public_transport precedence over amenity. Read
    the original tags too, or Hulhumalé's genuine mapped terminal disappears.
    Generic piers and inferred route endpoints do not establish passenger berths.
    """
    terminals = {}
    for feature in repository.transport.get("features", []):
        tags = feature.get("tags", {})
        if not (
            feature.get("category") == "ferry_terminal"
            or tags.get("amenity") == "ferry_terminal"
            or tags.get("ferry") in {"yes", "designated"}
        ):
            continue
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "Point" or not feature.get("island_id"):
            continue
        terminals[feature["id"]] = {
            "id": feature["id"],
            "name": feature.get("name") or "Mapped ferry terminal",
            "island_id": feature["island_id"],
            "coordinates": geometry["coordinates"],
            "source": "OpenStreetMap",
            "evidence": "mapped_terminal",
        }
    for node in routing.marine.get("nodes", []):
        if node.get("category") == "ferry_terminal" and node.get("island_id"):
            terminals.setdefault(
                node["id"],
                {
                    "id": node["id"],
                    "name": node.get("name") or "Mapped ferry terminal",
                    "island_id": node["island_id"],
                    "coordinates": node["coordinates"],
                    "source": node.get("source", "OpenStreetMap"),
                    "evidence": "mapped_terminal",
                },
            )
    if public_dir:
        path = public_dir / "policy-evidence/ferry-terminals.json"
        snapshot = json.loads(path.read_text(encoding="utf8")) if path.exists() else {}
        for terminal in snapshot.get("terminals", []):
            island_id = terminal.get("national_island_id")
            if island_id not in repository.islands_by_id:
                continue
            terminals[terminal["id"]] = {
                "id": terminal["id"],
                "name": terminal["name"],
                "island_id": island_id,
                "coordinates": terminal["coordinates"],
                "source": snapshot.get("source", {}).get("url", "RTL terminal catalogue"),
                "evidence": "official_terminal_catalogue",
                "join_method": terminal["join_method"],
                "join_distance_m": terminal["join_distance_m"],
            }
    return terminals


def feature_collection(features: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "FeatureCollection", "features": features}


def line_feature(link: dict[str, Any], *, proposed: bool = False) -> dict[str, Any]:
    return {
        "type": "Feature",
        "id": link["id"],
        "geometry": {"type": "LineString", "coordinates": link["geometry"]},
        "properties": {
            "id": link["id"],
            "name": link["name"],
            "mode": link.get("mode", "ferry"),
            "type": "ferry_service" if proposed else "transport_connection",
            "evidence": link.get("evidence", "proposed_service"),
            "proposed": proposed,
            "qualification": "Planning corridor; not a charted navigation route."
            if proposed
            else "Mapped route evidence does not establish a live operating service.",
        },
    }


def transport_summary(world: dict[str, Any], assumptions: PlanningAssumptions) -> dict[str, Any]:
    """Complementary transport results; never repurpose health/education residents."""
    stops = {item["id"]: item for item in world["stops"] if not item.get("disabled")}
    lines = []
    for pattern in world["patterns"]:
        if pattern.get("enabled") is False:
            continue
        trips = service_day_trips(pattern, assumptions.date)
        if not trips:
            continue
        endpoints = [stops.get(identity) for identity in pattern["stopIds"]]
        if not all(endpoints):
            continue
        islands = list(
            dict.fromkeys(
                IDENTITY_BRIDGE.get(item["islandId"], item["islandId"]) for item in endpoints
            )
        )
        lines.append(
            {
                "id": pattern["id"],
                "name": pattern["name"],
                "mode": pattern["mode"],
                "island_ids": islands,
                "departure_count": len(trips),
                "proposed": pattern.get("provenance") == "assumed",
                "inter_island": len(islands) > 1,
            }
        )
    return {
        "service_date": assumptions.date.isoformat(),
        "lines": lines,
        "inter_island_lines": sum(line["inter_island"] for line in lines),
        "ferry_lines": sum(line["mode"] == "ferry" for line in lines),
        "islands_connected": sorted({island for line in lines for island in line["island_ids"]}),
        "qualification": "Modeled service connections on the selected date. Passenger demand, "
        "berth suitability, operating licences and door-to-door national accessibility are "
        "not established by a proposed ferry line.",
    }


class TransportPlanningService:
    def __init__(self, repository: Any, routing: Any, planning: Any, updates: Any) -> None:
        self.repository, self.routing = repository, routing
        self.planning, self.updates = planning, updates
        self.terminals = terminal_catalogue(repository, routing, planning.repository.public_dir)
        planning.repository.ferry_terminals = self.terminals

    @lru_cache(maxsize=256)
    def local_access(self, island_id: str) -> dict[str, Any]:
        """Walking-network access to mapped bus stops, without inventing service."""
        baseline = self.planning.repository.baseline
        scope = self.planning.repository.planning_id(island_id)
        stops = [
            stop
            for stop in baseline.get("transit", {}).get("stops", [])
            if stop.get("islandId") == scope and stop.get("mode", "bus") == "bus"
        ]
        origins = [
            origin
            for origin in baseline.get("origins", [])
            if origin.get("islandId") == scope and origin.get("population2026") is not None
        ]
        mapped_count = sum(
            feature.get("island_id") == island_id
            and (
                feature.get("category") == "bus_stop"
                or feature.get("tags", {}).get("highway") == "bus_stop"
            )
            for feature in self.repository.transport.get("features", [])
        )
        result = {
            "bus_stop_count": mapped_count,
            "planning_bus_stop_count": len(stops),
            "ferry_terminal_count": sum(
                item["island_id"] == island_id for item in self.terminals.values()
            ),
            "walk_target_minutes": 10,
            "status": "outside_snapshot",
            "population": None,
            "residents_within_walk_target": None,
            "resident_coverage_pct": None,
            "unknown_residents": None,
            "qualification": "Walking access to mapped bus stops on the available street "
            "graph. This does not confirm a departing bus, service frequency, capacity or "
            "ridership. Resident allocations are available only in the Greater Malé snapshot.",
        }
        if not origins:
            return result
        network = WalkingNetwork(baseline.get("network", {"nodes": [], "edges": []}))
        stop_trees = []
        for stop in stops:
            snap = network.snap(stop, 100)
            if snap:
                distances, _ = network.tree(snap[0], 10 * 80, reverse=True)
                stop_trees.append((snap[1], distances))
        population = within = unknown = 0.0
        for origin in origins:
            residents = float(origin["population2026"])
            population += residents
            snap = network.snap(origin, 100)
            if not snap:
                unknown += residents
                continue
            shortest = min(
                (
                    distances.get(snap[0], math.inf) + offset + snap[1]
                    for offset, distances in stop_trees
                ),
                default=math.inf,
            )
            if shortest <= 10 * 80:
                within += residents
        result.update(
            status="modeled",
            population=round(population, 3),
            residents_within_walk_target=round(within, 3),
            resident_coverage_pct=round(within / population * 100, 1) if population else None,
            unknown_residents=round(unknown, 3),
        )
        return result

    def island(self, identity: str) -> dict[str, Any]:
        feature = self.repository.islands_by_id.get(identity)
        if feature is None:
            raise ValueError("Choose a known island")
        properties = feature["properties"]
        return {
            "id": identity,
            "name": properties.get("name") or "Unnamed island",
            "coordinates": properties.get("centroid"),
        }

    def _links(self, service_date: date) -> list[dict[str, Any]]:
        links = []
        baseline = self.planning._baseline_view()
        stops = {item["id"]: item for item in baseline["stops"] if not item.get("disabled")}
        for pattern in baseline["patterns"]:
            trips = pattern_trips(pattern, service_date)
            if not trips or pattern.get("enabled") is False:
                continue
            for stop_index, (first_id, second_id) in enumerate(
                zip(pattern["stopIds"], pattern["stopIds"][1:])
            ):
                first, second = stops.get(first_id), stops.get(second_id)
                if not first or not second or first["islandId"] == second["islandId"]:
                    continue
                departures = [
                    trip
                    for trip in trips
                    if 0 <= trip["stopTimes"][stop_index]["departureMinutes"] < 1440
                ]
                if not departures:
                    continue
                a = IDENTITY_BRIDGE.get(first["islandId"], first["islandId"])
                b = IDENTITY_BRIDGE.get(second["islandId"], second["islandId"])
                links.append(
                    {
                        "id": f"{pattern['id']}:{first_id}:{second_id}",
                        "name": pattern["name"],
                        "mode": pattern["mode"],
                        "from_island_id": a,
                        "to_island_id": b,
                        "evidence": "dated_service",
                        "departure_count": len(departures),
                        "geometry": [[first["lon"], first["lat"]], [second["lon"], second["lat"]]],
                        "source_ids": pattern.get("sourceIds", []),
                    }
                )
        for service in self.updates.catalogue()["services"]:
            if not (
                service["effective_from"] <= service_date.isoformat() <= service["effective_until"]
                and service_date.isoweekday() in service["weekdays"]
            ):
                continue
            a, b = service["from_island_id"], service["to_island_id"]
            first, second = self.island(a), self.island(b)
            if not first["coordinates"] or not second["coordinates"]:
                continue
            links.append(
                {
                    "id": service["id"],
                    "name": service["name"],
                    "mode": service["mode"],
                    "from_island_id": a,
                    "to_island_id": b,
                    "evidence": "dated_service",
                    "departure_count": 1,
                    "geometry": [first["coordinates"], second["coordinates"]],
                    "timing_basis": service["timing_basis"],
                    "source": service["source"],
                }
            )
        nodes = {node["id"]: node for node in self.routing.marine.get("nodes", [])}
        for edge in self.routing.marine.get("edges", []):
            first, second = nodes.get(edge["from_id"]), nodes.get(edge["to_id"])
            if not first or not second or first.get("island_id") == second.get("island_id"):
                continue
            if (
                first.get("island_id") not in self.repository.islands_by_id
                or second.get("island_id") not in self.repository.islands_by_id
            ):
                continue
            links.append(
                {
                    "id": edge["id"],
                    "name": first.get("name") or "Mapped ferry route",
                    "mode": "ferry",
                    "from_island_id": first["island_id"],
                    "to_island_id": second["island_id"],
                    "evidence": "mapped_route",
                    "departure_count": None,
                    "geometry": edge.get("geometry")
                    or [first["coordinates"], second["coordinates"]],
                    "source": edge.get("source", "OpenStreetMap"),
                }
            )
        return links

    @staticmethod
    def _reachable(origin: str, links: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
        adjacency: dict[str, list[dict[str, Any]]] = {}
        for link in links:
            adjacency.setdefault(link["from_island_id"], []).append(link)
        paths: dict[str, list[dict[str, Any]]] = {origin: []}
        pending = deque([origin])
        while pending:
            current = pending.popleft()
            for link in adjacency.get(current, []):
                target = link["to_island_id"]
                if target not in paths:
                    paths[target] = paths[current] + [link]
                    pending.append(target)
        return paths

    def connectivity(
        self, origin_id: str, destination_id: str | None, service_date: date
    ) -> dict[str, Any]:
        origin = self.island(origin_id)
        destination = self.island(destination_id) if destination_id else None
        if origin_id == destination_id:
            raise ValueError("Choose different islands for an inter-island connection")
        terminals = {
            "origin": sorted(
                (item for item in self.terminals.values() if item["island_id"] == origin_id),
                key=lambda item: item["id"],
            ),
            "destination": sorted(
                (item for item in self.terminals.values() if item["island_id"] == destination_id),
                key=lambda item: item["id"],
            ),
        }
        links = self._links(service_date)
        dated_paths = self._reachable(
            origin_id, [link for link in links if link["evidence"] == "dated_service"]
        )
        all_paths = self._reachable(origin_id, links)
        selected = dated_paths.get(destination_id, []) or all_paths.get(destination_id, [])
        if destination_id in dated_paths:
            status = "dated_service"
            reasons = [
                "The selected date has captured service evidence connecting these islands. "
                "Check the published timetable and cancellations before travel."
            ]
        elif destination_id in all_paths:
            status = "mapped_route"
            reasons = [
                "A ferry corridor is mapped, but an operating timetable and crossing "
                "duration are not verified for this date."
            ]
        elif not terminals["origin"] or (destination_id and not terminals["destination"]):
            status = "terminal_evidence_needed"
            reasons = [
                "Passenger ferry-terminal evidence is incomplete for this connection. "
                "This does not prove that a terminal or service is absent."
            ]
        else:
            status = "no_verified_service"
            reasons = [
                "Mapped passenger ferry terminals are available at both ends, but the supplied "
                "schedules do not verify a connecting service. A new ferry-service scenario "
                "can be tested using these terminals."
            ]
        reasons.append(
            "Mapped terminals require operator confirmation of berth access, vessel "
            "suitability and permission; no new port is included."
        )
        reachable = []
        for identity, path in all_paths.items():
            if identity == origin_id:
                continue
            reachable.append(
                {
                    **self.island(identity),
                    "transfers": max(0, len(path) - 1),
                    "evidence": "dated_service" if identity in dated_paths else "mapped_route",
                }
            )
        visible_links = (
            selected
            if destination_id
            else [link for link in links if link["from_island_id"] == origin_id]
        )
        return {
            "origin": origin,
            "destination": destination,
            "service_date": service_date.isoformat(),
            "local_transport": self.local_access(origin_id),
            "status": status,
            "terminals": terminals,
            "links": visible_links,
            "reachable_islands": sorted(
                reachable, key=lambda item: (item["transfers"], item["name"])
            ),
            "reasons": reasons,
            "map_features": feature_collection([line_feature(link) for link in visible_links]),
            "qualification": "Connectivity is directional network evidence, not a timed "
            "itinerary. Transfers may not align. Missing evidence never proves no service "
            "operates.",
        }

    def ferry_service(self, body: FerryServiceRequest) -> dict[str, Any]:
        connection = self.connectivity(
            body.origin_island_id, body.destination_island_id, body.assumptions.date
        )
        selected = []
        for side, identity in (
            ("origin", body.origin_terminal_id),
            ("destination", body.destination_terminal_id),
        ):
            options = connection["terminals"][side]
            terminal = (
                next((item for item in options if item["id"] == identity), None)
                if identity
                else next(iter(options), None)
            )
            if identity and not terminal:
                raise ValueError(f"Choose a mapped passenger ferry terminal on the {side} island")
            selected.append(terminal)
        first, second = selected
        if not first or not second:
            return {
                "status": "evidence_needed",
                "operations": [],
                "map_features": feature_collection([]),
                "summary": None,
                "quote": None,
                "reasons": connection["reasons"],
            }
        distance_m = _distance_m(first["coordinates"], second["coordinates"])
        crossing = max(1, math.ceil(distance_m / 1000 / body.speed_kph * 60))
        layover = body.assumptions.layover_minutes
        roundtrip = crossing * 2 + layover * 2
        last_departure = body.end_minutes - roundtrip
        if last_departure < body.start_minutes:
            raise ValueError(
                "Operating hours must fit a return crossing and terminal layovers; "
                "choose a nearer island or longer hours"
            )
        departures = list(
            range(body.start_minutes, math.floor(last_departure) + 1, body.headway_minutes)
        )
        digest = hashlib.sha256(
            (
                f"{first['id']}|{second['id']}|{body.assumptions.date}|{body.start_minutes}|"
                f"{body.end_minutes}|{body.headway_minutes}|{body.speed_kph}"
            ).encode()
        ).hexdigest()[:12]
        route_id = f"proposal:ferry:{digest}"
        existing_ids = {
            operation.service.get("id") for operation in body.operations if operation.service
        }
        if f"{route_id}:outbound" in existing_ids:
            raise ValueError("This ferry service is already part of the proposal")
        name = f"{connection['origin']['name']} – {connection['destination']['name']} ferry"
        link = {
            "id": route_id,
            "name": name,
            "geometry": [first["coordinates"], second["coordinates"]],
        }
        map_features = feature_collection(
            [line_feature(link, proposed=True)]
            + [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": terminal["coordinates"]},
                    "properties": {
                        "id": f"{route_id}:{role}:terminal",
                        "terminal_id": terminal["id"],
                        "name": terminal["name"],
                        "role": role,
                        "island_id": terminal["island_id"],
                        "mode": "ferry",
                        "type": "existing_ferry_terminal",
                        "evidence": terminal["evidence"],
                        "proposed": True,
                        "qualification": "Existing mapped landing for the proposed service; "
                        "berth access and operating permissions require review.",
                    },
                }
                for role, terminal in (("origin", first), ("destination", second))
            ]
        )
        operations = []
        for terminal in selected:
            # Keep every ferry package independently removable/undoable. The
            # source-terminal overlay is idempotent and never adds construction.
            operations.append(
                PlanningOperation(
                    type="use_existing_ferry_terminal",
                    target_id=terminal["id"],
                    island_id=terminal["island_id"],
                )
            )
        for direction, start, end, offset in (
            ("outbound", first, second, 0),
            ("return", second, first, crossing + layover),
        ):
            pattern = {
                "id": f"{route_id}:{direction}",
                "routeId": route_id,
                "name": name,
                "mode": "ferry",
                "stopIds": [start["id"], end["id"]],
                "calendar": {
                    "weekdays": list(range(7)),
                    "startDate": body.assumptions.date.isoformat(),
                    "endDate": body.assumptions.date.isoformat(),
                },
                "timing": {
                    "kind": "scheduled",
                    "trips": [
                        {
                            "id": f"{route_id}:{direction}:{index}",
                            "stopTimes": [
                                {
                                    "arrivalMinutes": departure + offset,
                                    "departureMinutes": departure + offset,
                                },
                                {
                                    "arrivalMinutes": departure + offset + crossing,
                                    "departureMinutes": departure + offset + crossing,
                                },
                            ],
                        }
                        for index, departure in enumerate(departures)
                    ],
                },
                "distanceM": distance_m,
                "transportProposal": {
                    "origin_island_id": body.origin_island_id,
                    "destination_island_id": body.destination_island_id,
                    "terminal_construction_mvr": 0,
                },
            }
            operations.append(
                PlanningOperation(
                    type="add_service",
                    island_id=body.origin_island_id,
                    name=name,
                    service=pattern,
                    metadata={
                        "ui_map_features": map_features["features"]
                        if direction == "outbound"
                        else [],
                        "transport_kind": "ferry_service",
                    },
                )
            )
        request = PlanningRequest(
            island_id=body.origin_island_id,
            assumptions=body.assumptions,
            operations=body.operations + operations,
        )
        quote = self.planning.quote(request)
        return {
            "status": "ready",
            "operations": [
                operation.model_dump(mode="json", exclude_none=True) for operation in operations
            ],
            "map_features": map_features,
            "quote": quote,
            "summary": {
                "name": name,
                "distance_km": round(distance_m / 1000, 2),
                "crossing_minutes": crossing,
                "departures_each_direction": len(departures),
                "headway_minutes": body.headway_minutes,
                "terminal_construction_mvr": 0,
                "origin_terminal": first,
                "destination_terminal": second,
                "qualification": "Illustrative return ferry service using mapped terminals. "
                "Vessel procurement and annual operation are budgeted; no new port construction. "
                "Straight-line distance and speed are assumptions, not navigational "
                "clearance or a timetable approval.",
            },
            "reasons": [
                "Return sailings and terminal layovers are included.",
                "Passenger demand and revenue are unknown. Annual costs repeat the scenario "
                "service day for the selected operating-days assumption.",
            ],
        }
