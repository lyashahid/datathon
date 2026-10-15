"""Immutable scenario application and baseline comparison."""

from __future__ import annotations

import copy
import math
from pathlib import Path
from typing import Any

from app.data.cache import FileCache
from app.routing.engine import RoutingRepository
from app.simulation.models import Scenario, ScenarioOperation


class ScenarioSession:
    """An isolated, mutable working copy with reset, clone, and history support."""

    def __init__(self, engine: ScenarioEngine, island_id: str | None = None) -> None:
        self.engine = engine
        self.island_id = island_id
        self._baseline = engine._clone_world(island_id)
        self._world = copy.deepcopy(self._baseline)
        self._history: list[tuple[int, ScenarioOperation]] = []
        self._redo: list[tuple[int, ScenarioOperation]] = []

    @property
    def world(self) -> dict[str, Any]:
        return self._world

    @property
    def history(self) -> list[ScenarioOperation]:
        return [operation for _, operation in self._history]

    def apply(
        self,
        operation: ScenarioOperation,
        operation_index: int | None = None,
    ) -> dict[str, Any]:
        index = operation_index if operation_index is not None else self._next_index()
        result = self.engine._apply_operation(self._world, operation, index)
        if result["applied"]:
            self._history.append((index, operation))
            self._redo.clear()
        return result

    def apply_all(self, operations: list[ScenarioOperation]) -> list[dict[str, Any]]:
        results = []
        for index, operation in enumerate(operations):
            results.append(self.apply(operation, index))
        return results

    def undo(self) -> bool:
        if not self._history:
            return False
        self._redo.append(self._history.pop())
        self._rebuild()
        return True

    def redo(self) -> bool:
        if not self._redo:
            return False
        index, operation = self._redo.pop()
        result = self.engine._apply_operation(self._world, operation, index)
        if not result["applied"]:
            self._redo.append((index, operation))
            return False
        self._history.append((index, operation))
        return True

    def reset(self) -> None:
        self._world = copy.deepcopy(self._baseline)
        self._history.clear()
        self._redo.clear()

    def clone(self) -> ScenarioSession:
        clone = object.__new__(ScenarioSession)
        clone.engine = self.engine
        clone._baseline = copy.deepcopy(self._baseline)
        clone._world = copy.deepcopy(self._world)
        clone._history = copy.deepcopy(self._history)
        clone._redo = copy.deepcopy(self._redo)
        return clone

    def _next_index(self) -> int:
        indexes = [index for index, _ in self._history]
        indexes.extend(index for index, _ in self._redo)
        return max(indexes, default=-1) + 1

    def _rebuild(self) -> None:
        self._world = copy.deepcopy(self._baseline)
        retained = self._history.copy()
        self._history.clear()
        for index, operation in retained:
            result = self.engine._apply_operation(self._world, operation, index)
            if result["applied"]:
                self._history.append((index, operation))


class ScenarioEngine:
    def __init__(self, data_dir: Path, routing: RoutingRepository) -> None:
        self.cache = FileCache(data_dir / "cache")
        self.routing = routing
        self.transport_features: list[dict[str, Any]] = []
        self.reload()

    def reload(self) -> None:
        try:
            data = self.cache.read_json("normalized/transport.json")
        except FileNotFoundError:
            data = {"features": []}
        self.transport_features = data.get("features", [])

    def run(self, scenario: Scenario, island_id: str | None = None) -> dict[str, Any]:
        session = self.new_session(island_id)
        applied: list[dict[str, Any]] = []
        warnings: list[str] = []
        for operation in session.apply_all(scenario.operations):
            result = operation
            if result["applied"]:
                applied.append(result)
            else:
                warnings.append(result["warning"])
        return self._result(scenario, session.world, applied, warnings, island_id)

    def new_session(self, island_id: str | None = None) -> ScenarioSession:
        return ScenarioSession(self, island_id)

    def compare(
        self,
        first: Scenario,
        second: Scenario,
        island_id: str | None = None,
    ) -> dict[str, Any]:
        first_result = self.run(first, island_id)
        second_result = self.run(second, island_id)
        return {
            "baseline": self._baseline_summary(island_id),
            "first": first_result,
            "second": second_result,
            "delta": {
                "first_vs_second_land_edges": (
                    first_result["effective_world"]["land_edge_count"]
                    - second_result["effective_world"]["land_edge_count"]
                ),
                "first_vs_second_marine_edges": (
                    first_result["effective_world"]["marine_edge_count"]
                    - second_result["effective_world"]["marine_edge_count"]
                ),
                "first_vs_second_transport_features": (
                    first_result["effective_world"]["transport_feature_count"]
                    - second_result["effective_world"]["transport_feature_count"]
                ),
            },
        }

    def _clone_world(self, island_id: str | None = None) -> dict[str, Any]:
        if island_id:
            graph = self.routing.land.get("islands", {}).get(island_id)
            land = {
                "version": self.routing.land.get("version", "unknown"),
                "islands": {island_id: copy.deepcopy(graph)} if graph else {},
            }
        else:
            land = copy.deepcopy(self.routing.land)
        return {
            "land": land,
            "marine": copy.deepcopy(self.routing.marine),
            "air": copy.deepcopy(self.routing.air),
            "transport_features": copy.deepcopy(self.transport_features),
        }

    def _apply_operation(
        self, world: dict[str, Any], operation: ScenarioOperation, index: int
    ) -> dict[str, Any]:
        operation_id = f"scenario-operation:{index}"
        operation_type = operation.type
        if operation_type in {
            "add_bus_stop",
            "add_parking",
            "add_park_and_ride",
            "add_mobility_hub",
        }:
            category = {
                "add_bus_stop": "bus_stop",
                "add_parking": "parking",
                "add_park_and_ride": "park_and_ride",
                "add_mobility_hub": "mobility_hub",
            }[operation_type]
            feature = {
                "id": f"scenario:{category}:{index}",
                "source": "scenario",
                "source_record_id": operation_id,
                "category": category,
                "name": operation.metadata.get("name", category.replace("_", " ").title()),
                "geometry": {"type": "Point", "coordinates": list(operation.coordinates or [])},
                "island_id": operation.island_id,
                "match_status": "scenario_added",
                "geometry_quality": "scenario_exact",
                "attributes": operation.metadata,
            }
            world["transport_features"].append(feature)
            return {"operation_id": operation_id, "type": operation_type, "applied": True}
        if operation_type in {"move_bus_stop", "remove_bus_stop"}:
            features = world["transport_features"]
            match = next((item for item in features if item.get("id") == operation.target_id), None)
            if match is None:
                return _warning(
                    operation_id,
                    f"Target transport feature not found: {operation.target_id}",
                )
            if operation_type == "remove_bus_stop":
                features.remove(match)
            else:
                match["geometry"] = {
                    "type": "Point",
                    "coordinates": list(operation.coordinates or []),
                }
                if operation.island_id:
                    match["island_id"] = operation.island_id
            return {"operation_id": operation_id, "type": operation_type, "applied": True}
        if operation_type in {
            "add_ferry_terminal",
            "move_ferry_terminal",
            "disable_ferry_terminal",
        }:
            return self._apply_marine_terminal(world, operation, index, operation_id)
        if operation_type in {"add_ferry_route", "change_ferry_route", "remove_ferry_route"}:
            if operation_type != "add_ferry_route":
                if operation_type == "change_ferry_route":
                    node_ids = {
                        node.get("id") for node in world["marine"].get("nodes", [])
                    }
                    if (
                        operation.from_node_id not in node_ids
                        or operation.to_node_id not in node_ids
                    ):
                        return _warning(
                            operation_id,
                            "Ferry route endpoints must exist in the marine graph",
                        )
                original_edges = world["marine"].get("edges", [])
                retained_edges = [
                    edge
                    for edge in original_edges
                    if edge.get("id") != operation.target_id
                    and edge.get("source_relation_id") != operation.target_id
                ]
                removed_edges = len(original_edges) - len(retained_edges)
                world["marine"]["edges"] = retained_edges
                if not removed_edges:
                    return _warning(
                        operation_id,
                        f"Marine route not found: {operation.target_id}",
                    )
                if operation_type == "remove_ferry_route":
                    return {
                        "operation_id": operation_id,
                        "type": operation_type,
                        "applied": True,
                        "removed_edges": removed_edges,
                    }
            return self._add_marine_route(world, operation, index, operation_id)
        if operation_type == "road_closure":
            count = _remove_land_edges(world, operation.target_id)
            if count == 0:
                return _warning(operation_id, f"Road edge or way not found: {operation.target_id}")
            return {
                "operation_id": operation_id,
                "type": operation_type,
                "applied": True,
                "removed_edges": count,
            }
        if operation_type == "pedestrian_connection":
            return self._add_land_connection(world, operation, index, operation_id)
        if operation_type == "airport_access_improvement":
            return self._add_air_connection(world, operation, index, operation_id)
        if operation_type == "weather_disruption":
            changed = 0
            for graph in world["land"].get("islands", {}).values():
                for edge in graph.get("edges", []):
                    for mode in operation.disabled_modes:
                        if edge.get("permissions", {}).get(mode):
                            edge["permissions"][mode] = False
                            changed += 1
            if "marine" in operation.disabled_modes:
                for edge in world["marine"].get("edges", []):
                    if edge.get("passenger_eligible"):
                        edge["passenger_eligible"] = False
                        changed += 1
            return {
                "operation_id": operation_id,
                "type": operation_type,
                "applied": True,
                "changed_permissions": changed,
            }
        return _warning(operation_id, f"Unsupported operation: {operation_type}")

    def _apply_marine_terminal(
        self,
        world: dict[str, Any],
        operation: ScenarioOperation,
        index: int,
        operation_id: str,
    ) -> dict[str, Any]:
        nodes = world["marine"].setdefault("nodes", [])
        if operation.type == "add_ferry_terminal":
            node_id = f"scenario:ferry-terminal:{index}"
            nodes.append(
                {
                    "id": node_id,
                    "coordinates": list(operation.coordinates or []),
                    "island_id": operation.island_id,
                    "category": "ferry_terminal",
                    "name": operation.metadata.get("name", "Scenario ferry terminal"),
                    "source": "scenario",
                }
            )
            return {
                "operation_id": operation_id,
                "type": operation.type,
                "applied": True,
                "node_id": node_id,
            }
        match = next((node for node in nodes if node.get("id") == operation.target_id), None)
        if match is None:
            return _warning(operation_id, f"Marine node not found: {operation.target_id}")
        if operation.type == "disable_ferry_terminal":
            nodes.remove(match)
            world["marine"]["edges"] = [
                edge
                for edge in world["marine"].get("edges", [])
                if edge.get("from_id") != operation.target_id
                and edge.get("to_id") != operation.target_id
            ]
        else:
            match["coordinates"] = list(operation.coordinates or match["coordinates"])
            if operation.island_id:
                match["island_id"] = operation.island_id
        return {"operation_id": operation_id, "type": operation.type, "applied": True}

    def _add_marine_route(
        self,
        world: dict[str, Any],
        operation: ScenarioOperation,
        index: int,
        operation_id: str,
    ) -> dict[str, Any]:
        node_ids = {node.get("id") for node in world["marine"].get("nodes", [])}
        if operation.from_node_id not in node_ids or operation.to_node_id not in node_ids:
            return _warning(operation_id, "Ferry route endpoints must exist in the marine graph")
        nodes = {node["id"]: node for node in world["marine"]["nodes"]}
        first = nodes[operation.from_node_id]["coordinates"]
        second = nodes[operation.to_node_id]["coordinates"]
        distance = operation.distance_m or _distance_m(first, second)
        edge = {
            "id": f"scenario:ferry-route:{index}",
            "from_id": operation.from_node_id,
            "to_id": operation.to_node_id,
            "distance_m": round(distance, 3),
            "geometry": [first, second],
            "mode": "ferry_candidate",
            "passenger_eligible": operation.passenger_eligible,
            "source": "scenario",
        }
        world["marine"]["edges"].append(edge)
        if operation.bidirectional:
            reverse = copy.deepcopy(edge)
            reverse["id"] = f"{edge['id']}:reverse"
            reverse["from_id"] = edge["to_id"]
            reverse["to_id"] = edge["from_id"]
            reverse["geometry"] = list(reversed(reverse["geometry"]))
            world["marine"]["edges"].append(reverse)
        return {"operation_id": operation_id, "type": operation.type, "applied": True}

    def _add_land_connection(
        self,
        world: dict[str, Any],
        operation: ScenarioOperation,
        index: int,
        operation_id: str,
    ) -> dict[str, Any]:
        graph = world["land"].get("islands", {}).get(operation.island_id)
        if not graph:
            return _warning(operation_id, f"Land graph not found: {operation.island_id}")
        node_ids = {node.get("id") for node in graph.get("nodes", [])}
        if operation.from_node_id not in node_ids or operation.to_node_id not in node_ids:
            return _warning(operation_id, "Pedestrian connection endpoints must exist")
        nodes = {node["id"]: node for node in graph["nodes"]}
        first = nodes[operation.from_node_id]["coordinates"]
        second = nodes[operation.to_node_id]["coordinates"]
        edge = {
            "id": f"scenario:pedestrian:{index}",
            "from_id": operation.from_node_id,
            "to_id": operation.to_node_id,
            "distance_m": round(operation.distance_m or _distance_m(first, second), 3),
            "geometry": [first, second],
            "permissions": {
                "walk": True,
                "bicycle": False,
                "car": False,
                "taxi": False,
                "bus": False,
            },
            "source": "scenario",
        }
        graph["edges"].append(edge)
        if operation.bidirectional:
            reverse = copy.deepcopy(edge)
            reverse["id"] = f"{edge['id']}:reverse"
            reverse["from_id"] = edge["to_id"]
            reverse["to_id"] = edge["from_id"]
            reverse["geometry"] = list(reversed(reverse["geometry"]))
            graph["edges"].append(reverse)
        return {"operation_id": operation_id, "type": operation.type, "applied": True}

    def _add_air_connection(
        self,
        world: dict[str, Any],
        operation: ScenarioOperation,
        index: int,
        operation_id: str,
    ) -> dict[str, Any]:
        if not operation.from_node_id or not operation.to_node_id:
            return _warning(operation_id, "Airport access improvement requires endpoint IDs")
        nodes = {node["id"]: node for node in world["air"].get("nodes", [])}
        if operation.from_node_id not in nodes or operation.to_node_id not in nodes:
            return _warning(operation_id, "Airport access endpoints must exist")
        first = nodes[operation.from_node_id]["coordinates"]
        second = nodes[operation.to_node_id]["coordinates"]
        edge = {
            "id": f"scenario:airport-access:{index}",
            "from_id": operation.from_node_id,
            "to_id": operation.to_node_id,
            "distance_m": round(operation.distance_m or _distance_m(first, second), 3),
            "mode": "air_access",
            "source": "scenario",
            "flight_service_verified": False,
        }
        world["air"]["edges"].append(edge)
        if operation.bidirectional:
            reverse = copy.deepcopy(edge)
            reverse["id"] = f"{edge['id']}:reverse"
            reverse["from_id"] = edge["to_id"]
            reverse["to_id"] = edge["from_id"]
            world["air"]["edges"].append(reverse)
        return {"operation_id": operation_id, "type": operation.type, "applied": True}

    def _result(
        self,
        scenario: Scenario,
        world: dict[str, Any],
        applied: list[dict[str, Any]],
        warnings: list[str],
        island_id: str | None,
    ) -> dict[str, Any]:
        baseline = self._baseline_summary(island_id)
        effective = _world_summary(world, island_id)
        return {
            "scenario": scenario.model_dump(mode="json"),
            "island_id": island_id,
            "operations_applied": applied,
            "warnings": warnings,
            "baseline": baseline,
            "effective_world": effective,
            "delta": {
                "land_edge_count": effective["land_edge_count"] - baseline["land_edge_count"],
                "marine_edge_count": effective["marine_edge_count"] - baseline["marine_edge_count"],
                "transport_feature_count": effective["transport_feature_count"]
                - baseline["transport_feature_count"],
            },
        }

    def _baseline_summary(self, island_id: str | None = None) -> dict[str, Any]:
        return _world_summary(
            {
                "land": self.routing.land,
                "marine": self.routing.marine,
                "air": self.routing.air,
                "transport_features": self.transport_features,
            },
            island_id,
        )


def _world_summary(world: dict[str, Any], island_id: str | None) -> dict[str, Any]:
    land_graphs = world["land"].get("islands", {})
    if island_id:
        land_graphs = {
            island_id: land_graphs[island_id]
        } if island_id in land_graphs else {}
    marine_nodes = world["marine"].get("nodes", [])
    air_nodes = world["air"].get("nodes", [])
    transport_features = world["transport_features"]
    marine_node_ids = {node.get("id") for node in marine_nodes}
    air_node_ids = {node.get("id") for node in air_nodes}
    if island_id:
        marine_node_ids = {
            node.get("id")
            for node in marine_nodes
            if node.get("island_id") == island_id
        }
        air_node_ids = {
            node.get("id")
            for node in air_nodes
            if node.get("island_id") == island_id
        }
        marine_nodes = [node for node in marine_nodes if node.get("id") in marine_node_ids]
        air_nodes = [node for node in air_nodes if node.get("id") in air_node_ids]
        transport_features = [
            feature
            for feature in transport_features
            if feature.get("island_id") == island_id
        ]
    marine_edges = [
        edge
        for edge in world["marine"].get("edges", [])
        if not island_id
        or edge.get("from_id") in marine_node_ids
        or edge.get("to_id") in marine_node_ids
    ]
    air_edges = [
        edge
        for edge in world["air"].get("edges", [])
        if not island_id
        or edge.get("from_id") in air_node_ids
        or edge.get("to_id") in air_node_ids
    ]
    return {
        "land_island_count": len(land_graphs),
        "land_node_count": sum(len(graph.get("nodes", [])) for graph in land_graphs.values()),
        "land_edge_count": sum(len(graph.get("edges", [])) for graph in land_graphs.values()),
        "marine_node_count": len(marine_nodes),
        "marine_edge_count": len(marine_edges),
        "air_node_count": len(air_nodes),
        "air_edge_count": len(air_edges),
        "transport_feature_count": len(transport_features),
    }


def _remove_land_edges(world: dict[str, Any], target_id: str | None) -> int:
    if not target_id:
        return 0
    removed = 0
    for graph in world["land"].get("islands", {}).values():
        retained = []
        for edge in graph.get("edges", []):
            if edge.get("id") == target_id or edge.get("source_way_id") == target_id:
                removed += 1
            else:
                retained.append(edge)
        graph["edges"] = retained
    return removed


def _warning(operation_id: str, warning: str) -> dict[str, Any]:
    return {"operation_id": operation_id, "applied": False, "warning": warning}


def _distance_m(first: list[float], second: list[float]) -> float:
    radius = 6_371_000
    lat_1 = math.radians(first[1])
    lat_2 = math.radians(second[1])
    delta_lat = math.radians(second[1] - first[1])
    delta_lon = math.radians(second[0] - first[0])
    value = math.sin(delta_lat / 2) ** 2 + math.cos(lat_1) * math.cos(lat_2) * math.sin(
        delta_lon / 2
    ) ** 2
    return 2 * radius * math.atan2(math.sqrt(value), math.sqrt(1 - value))
