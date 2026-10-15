"""Routing over prewarmed, immutable graph artifacts."""

from __future__ import annotations

import heapq
import math
from pathlib import Path
from typing import Any

from app.data.cache import FileCache


class RoutingRepository:
    def __init__(self, data_dir: Path) -> None:
        self.cache = FileCache(data_dir / "cache")
        self.land: dict[str, Any] = {"islands": {}}
        self.marine: dict[str, Any] = {"nodes": [], "edges": []}
        self.air: dict[str, Any] = {"nodes": [], "edges": []}
        self._land_adjacency: dict[str, dict[str, list[dict[str, Any]]]] = {}
        self._marine_adjacency: dict[str, list[dict[str, Any]]] = {}

    def reload(self) -> None:
        self.land = self._read_json("graphs/land.json", {"islands": {}})
        self.marine = self._read_json("graphs/marine.json", {"nodes": [], "edges": []})
        self.air = self._read_json("graphs/air.json", {"nodes": [], "edges": []})
        self._land_adjacency = {
            island_id: _adjacency(graph.get("edges", []))
            for island_id, graph in self.land.get("islands", {}).items()
        }
        self._marine_adjacency = _adjacency(self.marine.get("edges", []))

    def route_land(
        self,
        start: list[float],
        end: list[float],
        mode: str,
        island_id: str | None = None,
    ) -> dict[str, Any]:
        if island_id:
            selected_island = island_id
        else:
            start_island = self._nearest_land_island(start)
            end_island = self._nearest_land_island(end)
            if start_island != end_island:
                return _unreachable("different_islands")
            selected_island = start_island
        if not selected_island:
            return _unreachable("different_islands")
        graph = self.land.get("islands", {}).get(selected_island)
        if not graph:
            return _unreachable("no_land_graph")
        nodes = {node["id"]: node for node in graph.get("nodes", [])}
        start_id, start_distance = _nearest_node(nodes, start)
        end_id, end_distance = _nearest_node(nodes, end)
        if not start_id or not end_id:
            return _unreachable("no_nearby_land_node")
        result = _shortest_path(
            self._land_adjacency.get(selected_island, {}), start_id, end_id, mode
        )
        if result is None:
            return _unreachable("no_connected_path", selected_island)
        return {
            "status": "ok",
            "mode": mode,
            "island_id": selected_island,
            "distance_m": round(result["distance_m"] + start_distance + end_distance, 3),
            "path_node_ids": result["path_node_ids"],
            "geometry": result["geometry"],
            "snap_distance_m": round(start_distance + end_distance, 3),
            "graph_version": self.land.get("version", "unknown"),
        }

    def route_marine(
        self,
        start_node_id: str | None,
        end_node_id: str | None,
        include_unverified: bool = False,
    ) -> dict[str, Any]:
        if not start_node_id or not end_node_id:
            return _unreachable("marine_node_ids_required")
        node_ids = {node["id"] for node in self.marine.get("nodes", [])}
        if start_node_id not in node_ids or end_node_id not in node_ids:
            return _unreachable("marine_node_not_found")
        result = _shortest_path(
            self._marine_adjacency,
            start_node_id,
            end_node_id,
            "marine_candidate" if include_unverified else "passenger",
        )
        if result is None:
            return _unreachable("no_connected_marine_path")
        return {
            "status": "ok",
            "mode": "marine_candidate" if include_unverified else "passenger",
            **result,
            "graph_version": self.marine.get("version", "unknown"),
        }

    def summary(self) -> dict[str, Any]:
        return {
            "land": {
                "island_count": len(self.land.get("islands", {})),
                "node_count": sum(
                    len(graph.get("nodes", []))
                    for graph in self.land.get("islands", {}).values()
                ),
                "edge_count": sum(
                    len(graph.get("edges", []))
                    for graph in self.land.get("islands", {}).values()
                ),
            },
            "marine": {
                "node_count": len(self.marine.get("nodes", [])),
                "edge_count": len(self.marine.get("edges", [])),
            },
            "air": {
                "node_count": len(self.air.get("nodes", [])),
                "edge_count": len(self.air.get("edges", [])),
            },
        }

    def _nearest_land_island(self, point: list[float]) -> str | None:
        best: tuple[float, str] | None = None
        for island_id, graph in self.land.get("islands", {}).items():
            nodes = {node["id"]: node for node in graph.get("nodes", [])}
            node_id, distance = _nearest_node(nodes, point)
            if node_id and (best is None or distance < best[0]):
                best = (distance, island_id)
        return best[1] if best else None

    def _read_json(self, relative_path: str, default: Any) -> Any:
        try:
            return self.cache.read_json(relative_path)
        except FileNotFoundError:
            return default


def _adjacency(edges: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    adjacency: dict[str, list[dict[str, Any]]] = {}
    for edge in edges:
        adjacency.setdefault(edge["from_id"], []).append(edge)
    for values in adjacency.values():
        values.sort(key=lambda edge: edge["id"])
    return adjacency


def _shortest_path(
    adjacency: dict[str, list[dict[str, Any]]],
    start_id: str,
    end_id: str,
    mode: str,
) -> dict[str, Any] | None:
    queue: list[tuple[float, str]] = [(0.0, start_id)]
    distances = {start_id: 0.0}
    previous: dict[str, tuple[str, dict[str, Any]]] = {}
    while queue:
        distance, node_id = heapq.heappop(queue)
        if distance != distances.get(node_id):
            continue
        if node_id == end_id:
            break
        for edge in adjacency.get(node_id, []):
            if not _edge_allows(edge, mode):
                continue
            next_id = edge["to_id"]
            candidate_distance = distance + float(edge["distance_m"])
            if candidate_distance < distances.get(next_id, math.inf):
                distances[next_id] = candidate_distance
                previous[next_id] = (node_id, edge)
                heapq.heappush(queue, (candidate_distance, next_id))
    if end_id not in distances:
        return None
    path_edges: list[dict[str, Any]] = []
    current = end_id
    while current != start_id:
        prior, edge = previous[current]
        path_edges.append(edge)
        current = prior
    path_edges.reverse()
    geometry: list[list[float]] = []
    for edge in path_edges:
        coordinates = edge.get("geometry", [])
        if geometry and coordinates and geometry[-1] == coordinates[0]:
            geometry.extend(coordinates[1:])
        else:
            geometry.extend(coordinates)
    return {
        "distance_m": distances[end_id],
        "path_node_ids": [start_id] + [edge["to_id"] for edge in path_edges],
        "geometry": geometry,
    }


def _edge_allows(edge: dict[str, Any], mode: str) -> bool:
    if mode == "passenger":
        return bool(edge.get("passenger_eligible"))
    if mode == "marine_candidate":
        return edge.get("mode") == "ferry_candidate"
    return bool(edge.get("permissions", {}).get(mode))


def _nearest_node(nodes: dict[str, dict[str, Any]], point: list[float]) -> tuple[str | None, float]:
    if not nodes:
        return None, math.inf
    selected_id = None
    selected_distance = math.inf
    for node_id, node in nodes.items():
        distance = _distance_m(point, node["coordinates"])
        if distance < selected_distance:
            selected_id = node_id
            selected_distance = distance
    return selected_id, selected_distance


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


def _unreachable(reason: str, island_id: str | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {"status": "unreachable", "reason": reason}
    if island_id:
        result["island_id"] = island_id
    return result
