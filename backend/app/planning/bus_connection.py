"""Road-backed, reversible bus-stop and return-service planning packages."""

from __future__ import annotations

import hashlib
import json
import math
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.coordinates import Coordinates
from app.planning.models import PlanningAssumptions, PlanningOperation, PlanningRequest
from app.planning.routing import WalkingNetwork, service_day_trips
from app.planning.world import apply_operations


class BusConnectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    island_id: str = Field(min_length=1, max_length=100)
    coordinates: Coordinates
    stop_name: str = Field(default="Proposed bus stop", min_length=1, max_length=120)
    target_stop_id: str | None = Field(default=None, max_length=200)
    headway_minutes: int = Field(default=20, ge=5, le=180)
    start_minutes: int = Field(default=360, ge=0, lt=1440)
    end_minutes: int = Field(default=1200, gt=0, le=1440)
    speed_kph: float = Field(default=15, ge=5, le=50)
    fleet: str = Field(default="diesel", pattern="^(diesel|electric)$")
    assumptions: PlanningAssumptions = Field(default_factory=PlanningAssumptions)
    operations: list[PlanningOperation] = Field(default_factory=list, max_length=97)

    @model_validator(mode="after")
    def ordered(self) -> BusConnectionRequest:
        if self.end_minutes <= self.start_minutes:
            raise ValueError("Bus operating hours must have an ordered start and end")
        return self


def collection(features: list[dict[str, Any]]) -> dict[str, Any]:
    return {"type": "FeatureCollection", "features": features}


class BusConnectionPlanner:
    """Choose reachable stops using two directed trees, rather than one per option."""

    def __init__(self, planning: Any) -> None:
        self.planning = planning
        self._baseline_network: WalkingNetwork | None = None
        self._baseline_source: Any = None

    def preview(self, body: BusConnectionRequest) -> dict[str, Any]:
        scope = self.planning.repository.planning_id(body.island_id)
        if scope not in {
            item["id"] for item in self.planning.repository.baseline.get("islands", [])
        }:
            raise ValueError("Bus route planning needs the mapped Greater Malé road network")
        request = PlanningRequest(
            island_id=body.island_id, assumptions=body.assumptions, operations=body.operations
        )
        world, warnings = apply_operations(
            self.planning.repository, request, share_unchanged_network=True
        )
        baseline_source = self.planning.repository.baseline.get("network")
        if world["network"] is baseline_source:
            if self._baseline_network is None or self._baseline_source is not baseline_source:
                self._baseline_network = WalkingNetwork(baseline_source, drive=True)
                self._baseline_source = baseline_source
            roads = self._baseline_network
        else:
            roads = WalkingNetwork(world["network"], drive=True)
        proposed = {
            "lon": body.coordinates[0],
            "lat": body.coordinates[1],
            "islandId": scope,
        }
        start = roads.snap(proposed, body.assumptions.max_snap_m)
        # Each generated package must survive removal of any other proposal
        # package. Referencing a separately proposed stop would leave dangling
        # service stop IDs when that stop/package is removed from the map.
        source_stop_ids = {
            stop["id"]
            for stop in self.planning.repository.baseline.get("transit", {}).get("stops", [])
            if stop.get("mode", "bus") == "bus"
        }
        stops = [
            stop
            for stop in world["stops"]
            if stop["id"] in source_stop_ids
            and stop.get("mode", "bus") == "bus"
            and not stop.get("disabled")
            and stop.get("islandId") == scope
        ]
        if body.target_stop_id and not any(stop["id"] == body.target_stop_id for stop in stops):
            raise ValueError(
                "Choose an enabled bus stop from the mapped source data on this island"
            )
        if not start:
            return self._unavailable(
                "Move the stop closer to a mapped drivable road. No road path or service "
                "has been assumed.",
                warnings=warnings,
            )
        outward, outward_previous = roads.tree(start[0], 10000)
        inward, inward_previous = roads.tree(start[0], 10000, reverse=True)
        serving_routes: dict[str, set[str]] = {}
        for pattern in world["patterns"]:
            if pattern.get("mode") == "bus" and service_day_trips(pattern, body.assumptions.date):
                for identity in pattern["stopIds"]:
                    serving_routes.setdefault(identity, set()).add(pattern["name"])
        candidates = []
        for stop in stops:
            end = roads.snap(stop, body.assumptions.max_snap_m)
            if not end or end[0] == start[0]:
                continue
            if end[0] not in outward or end[0] not in inward:
                continue
            geometry = roads.geometry(outward_previous, start[0], end[0])
            # The reverse tree follows reversed edges. Reversing its complete
            # geometry restores the legal end -> start direction on one-way roads.
            return_geometry = list(reversed(roads.geometry(inward_previous, start[0], end[0])))
            if len(geometry) < 2 or len(return_geometry) < 2:
                continue
            distance, return_distance = outward[end[0]], inward[end[0]]
            if distance <= 0 or return_distance <= 0:
                continue
            candidates.append(
                {
                    "stop": {
                        "id": stop["id"],
                        "name": stop.get("name") or "Existing bus stop",
                        "coordinates": [stop["lon"], stop["lat"]],
                        "serving_routes": sorted(serving_routes.get(stop["id"], [])),
                    },
                    "distance_m": round(distance, 2),
                    "return_distance_m": round(return_distance, 2),
                    "roundtrip_distance_m": round(distance + return_distance, 2),
                    "travel_minutes": round(distance / (body.speed_kph * 1000 / 60) + 1, 2),
                    "return_travel_minutes": round(
                        return_distance / (body.speed_kph * 1000 / 60) + 1, 2
                    ),
                    "geometry": geometry,
                    "return_geometry": return_geometry,
                    "geometry_source": "osm_network_shortest_path",
                    "road_snap_distance_m": round(end[1], 2),
                }
            )
        # Prefer a real interchange when possible, then the shortest return road
        # connection. Merely mapped stops stay selectable with their evidence shown.
        candidates.sort(
            key=lambda item: (
                not bool(item["stop"]["serving_routes"]),
                item["roundtrip_distance_m"],
                item["stop"]["id"],
            )
        )
        selected = (
            next(
                (item for item in candidates if item["stop"]["id"] == body.target_stop_id),
                None,
            )
            if body.target_stop_id
            else next(iter(candidates), None)
        )
        visible = candidates[:4]
        if selected and selected not in visible:
            visible = [*visible[:3], selected]
        if selected is None:
            return self._unavailable(
                "No complete outward and return road path to an eligible bus stop was "
                "found within 10 km in each direction. Choose another location or stop.",
                candidates=visible,
                warnings=warnings,
            )
        return self._package(body, selected, visible, start[1], warnings)

    @staticmethod
    def _unavailable(
        reason: str,
        *,
        candidates: list[dict[str, Any]] | None = None,
        warnings: list[str] | None = None,
    ) -> dict[str, Any]:
        return {
            "status": "evidence_needed",
            "candidates": candidates or [],
            "selected_stop_id": None,
            "operations": [],
            "map_features": collection([]),
            "summary": None,
            "quote": None,
            "reasons": [reason],
            "warnings": warnings or [],
        }

    def _package(
        self,
        body: BusConnectionRequest,
        chosen: dict[str, Any],
        candidates: list[dict[str, Any]],
        snap_distance: float,
        warnings: list[str],
    ) -> dict[str, Any]:
        outgoing, incoming = chosen["travel_minutes"], chosen["return_travel_minutes"]
        layover = body.assumptions.layover_minutes
        last_departure = body.end_minutes - outgoing - incoming - layover * 2
        if last_departure < body.start_minutes:
            raise ValueError("Operating hours must fit a return bus journey and both layovers")
        departures = list(
            range(body.start_minutes, math.floor(last_departure) + 1, body.headway_minutes)
        )
        digest = hashlib.sha256(
            json.dumps(
                {
                    "coordinates": list(body.coordinates),
                    "target": chosen["stop"]["id"],
                    "date": body.assumptions.date.isoformat(),
                    "start": body.start_minutes,
                    "end": body.end_minutes,
                    "headway": body.headway_minutes,
                    "speed": body.speed_kph,
                    "fleet": body.fleet,
                    "layover": layover,
                    "geometry": chosen["geometry"],
                    "return_geometry": chosen["return_geometry"],
                    "distance_m": chosen["distance_m"],
                    "return_distance_m": chosen["return_distance_m"],
                },
                sort_keys=True,
            ).encode()
        ).hexdigest()[:12]
        stop_id, route_id = f"proposal:add_stop:{digest}", f"proposal:bus:{digest}"
        if any(
            operation.service and operation.service.get("routeId") == route_id
            for operation in body.operations
        ):
            raise ValueError("This bus connection is already part of the proposal")
        name = f"{body.stop_name} – {chosen['stop']['name']}"
        features = [
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": geometry},
                "properties": {
                    "id": f"{route_id}:{direction}",
                    "name": name,
                    "mode": "bus",
                    "type": "bus_service",
                    "proposed": True,
                    "direction": direction,
                    "role": "candidate",
                    "evidence": "osm_network_shortest_path",
                    "qualification": "Road-network path; running time and service are "
                    "planning assumptions.",
                },
            }
            for direction, geometry in (
                ("outbound", chosen["geometry"]),
                ("return", chosen["return_geometry"]),
            )
        ]
        features.extend(
            [
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": coordinates},
                    "properties": {
                        "id": identity,
                        "name": label,
                        "mode": "bus",
                        "role": role,
                        "type": "bus_stop",
                        "proposed": role == "origin",
                    },
                }
                for identity, label, coordinates, role in [
                    (stop_id, body.stop_name, list(body.coordinates), "origin"),
                    *[
                        (
                            item["stop"]["id"],
                            item["stop"]["name"],
                            item["stop"]["coordinates"],
                            "destination" if item is chosen else "candidate",
                        )
                        for item in candidates
                    ],
                ]
            ]
        )
        operations = [
            PlanningOperation(
                type="add_stop",
                island_id=body.island_id,
                coordinates=body.coordinates,
                name=body.stop_name,
                metadata={
                    "proposal_id": stop_id,
                    "mode": "bus",
                    "transport_kind": "bus_connection",
                },
            )
        ]
        for direction, first, second, offset, duration, distance in (
            ("outbound", stop_id, chosen["stop"]["id"], 0, outgoing, chosen["distance_m"]),
            (
                "return",
                chosen["stop"]["id"],
                stop_id,
                outgoing + layover,
                incoming,
                chosen["return_distance_m"],
            ),
        ):
            pattern = {
                "id": f"{route_id}:{direction}",
                "routeId": route_id,
                "name": name,
                "mode": "bus",
                "fleet": body.fleet,
                "stopIds": [first, second],
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
                                    "arrivalMinutes": departure + offset + duration,
                                    "departureMinutes": departure + offset + duration,
                                },
                            ],
                        }
                        for index, departure in enumerate(departures)
                    ],
                },
                # Leave geometry empty: apply_operations independently derives it
                # from the current road graph, preserving server-owned provenance.
                "distanceM": distance,
                "transportProposal": {"speed_kph": body.speed_kph, "dwell_minutes": 1},
            }
            operations.append(
                PlanningOperation(
                    type="add_service",
                    island_id=body.island_id,
                    name=name,
                    service=pattern,
                    metadata={
                        "ui_map_features": features if direction == "outbound" else [],
                        "transport_kind": "bus_connection",
                    },
                )
            )
        quote = self.planning.quote(
            PlanningRequest(
                island_id=body.island_id,
                assumptions=body.assumptions,
                operations=body.operations + operations,
            )
        )
        return {
            "status": "ready",
            "candidates": candidates,
            "selected_stop_id": chosen["stop"]["id"],
            "operations": [
                operation.model_dump(mode="json", exclude_none=True) for operation in operations
            ],
            "map_features": collection(features),
            "quote": quote,
            "summary": {
                "name": name,
                "new_stop_id": stop_id,
                "target_stop": chosen["stop"],
                "distance_km": round(chosen["distance_m"] / 1000, 2),
                "roundtrip_distance_km": round(chosen["roundtrip_distance_m"] / 1000, 2),
                "travel_minutes": outgoing,
                "return_travel_minutes": incoming,
                "roundtrip_minutes": round(outgoing + incoming + layover * 2, 2),
                "departures_each_direction": len(departures),
                "headway_minutes": body.headway_minutes,
                "both_directions": True,
                "fleet": body.fleet,
                "speed_kph": body.speed_kph,
                "road_snap_distance_m": round(snap_distance, 2),
                "service_date": body.assumptions.date.isoformat(),
                "qualification": "A new stop with a return feeder bus service on the "
                "selected date. "
                "Paths follow drivable roads and one-way restrictions. Running speed, one-minute "
                "dwell, service hours and headway are assumptions; operator approval and ridership "
                "are not established. Stops snap to mapped road nodes within the chosen tolerance.",
            },
            "reasons": [
                "Accepting adds the stop and both service directions to journey, fleet, "
                "cost and emissions analysis.",
                "Annual operation repeats this service day for the selected "
                "operating-days assumption. "
                "Accessibility gains depend on actual resident journeys; no gain is guaranteed.",
            ],
            "warnings": warnings,
        }
