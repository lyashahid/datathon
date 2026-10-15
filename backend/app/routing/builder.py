"""Build lightweight routing artifacts from the cached OSM parse."""

from __future__ import annotations

import math
from typing import Any

from shapely.geometry import Point, shape
from shapely.strtree import STRtree

from app.data.cache import FileCache

WALK_ONLY_HIGHWAYS = {"footway", "path", "pedestrian", "steps", "corridor"}
NON_DRIVABLE_HIGHWAYS = WALK_ONLY_HIGHWAYS | {"cycleway", "bridleway", "track"}


def build_routing_artifacts(
    cache: FileCache,
    islands: list[dict[str, Any]],
    facilities: list[dict[str, Any]],
    osm_features: list[dict[str, Any]],
    osm_handler: Any,
) -> dict[str, Any]:
    """Build land, marine, air, and demand artifacts in one deterministic pass."""
    island_index = _IslandIndex(islands)
    land = _build_land_graphs(osm_handler.road_ways, island_index)
    marine = _build_marine_graph(osm_features, osm_handler, island_index)
    air = _build_air_graph(facilities, islands)
    demand = _build_demand_anchors(osm_handler.demand_features, islands, island_index)

    metadata = {
        "routing_version": "routing-v1",
        "land": {
            "island_count": len(land["islands"]),
            "node_count": sum(len(graph["nodes"]) for graph in land["islands"].values()),
            "edge_count": sum(len(graph["edges"]) for graph in land["islands"].values()),
        },
        "marine": {
            "node_count": len(marine["nodes"]),
            "edge_count": len(marine["edges"]),
            "route_relation_count": marine["route_relation_count"],
        },
        "air": {"node_count": len(air["nodes"]), "edge_count": len(air["edges"])},
        "demand": {"anchor_count": len(demand["anchors"])},
        "limitations": [
            "OSM ferry relations are connectivity candidates, not verified schedules.",
            "Airport graph contains airport-to-island access gateways, not flight schedules.",
            (
                "Demand anchors are approximate OSM geometry and have no allocated "
                "population until MBS island mapping is approved."
            ),
        ],
    }
    cache.write_json(
        "graphs/land.json",
        land,
        source="Mobility Sandbox OSM land graph",
        endpoint="local normalized output",
        parser_version="routing-v1",
    )
    cache.write_json(
        "graphs/marine.json",
        marine,
        source="Mobility Sandbox OSM marine graph candidates",
        endpoint="local normalized output",
        parser_version="routing-v1",
    )
    cache.write_json(
        "graphs/air.json",
        air,
        source="Mobility Sandbox CAA airport access graph",
        endpoint="local normalized output",
        parser_version="routing-v1",
    )
    cache.write_json(
        "derived/demand-anchors.json",
        demand,
        source="Mobility Sandbox OSM demand anchors",
        endpoint="local derived output",
        parser_version="routing-v1",
    )
    cache.write_json(
        "graphs/summary.json",
        metadata,
        source="Mobility Sandbox routing graph summary",
        endpoint="local derived output",
        parser_version="routing-v1",
    )
    return metadata


class _IslandIndex:
    def __init__(self, islands: list[dict[str, Any]]) -> None:
        self.ids: list[str] = []
        self.polygons: list[Any] = []
        self.centroids: dict[str, list[float]] = {}
        for island in islands:
            properties = island.get("properties", {})
            geometry = island.get("geometry")
            if geometry and properties.get("id"):
                self.ids.append(properties["id"])
                self.polygons.append(shape(geometry))
                if properties.get("centroid"):
                    self.centroids[properties["id"]] = properties["centroid"]
        self.tree = STRtree(self.polygons)

    def find(self, coordinates: list[float]) -> str | None:
        point = Point(coordinates)
        for index in self.tree.query(point, predicate="intersects"):
            polygon = self.polygons[int(index)]
            if polygon.contains(point) or polygon.touches(point):
                return self.ids[int(index)]
        return None

    def nearest(self, coordinates: list[float], max_distance_m: float = 3000) -> str | None:
        nearest_id = None
        nearest_distance = math.inf
        for island_id, centroid in self.centroids.items():
            distance = _distance_m(coordinates, centroid)
            if distance < nearest_distance:
                nearest_id = island_id
                nearest_distance = distance
        return nearest_id if nearest_distance <= max_distance_m else None


def _build_land_graphs(
    road_ways: list[dict[str, Any]], island_index: _IslandIndex
) -> dict[str, Any]:
    graphs: dict[str, dict[str, Any]] = {}
    for way in road_ways:
        points = way["points"]
        if len(points) < 2:
            continue
        way_island = island_index.find(points[len(points) // 2]["coordinates"])
        for index in range(len(points) - 1):
            first = points[index]
            second = points[index + 1]
            island_id = island_index.find(first["coordinates"]) or way_island
            second_island = island_index.find(second["coordinates"]) or way_island
            if not island_id or island_id != second_island:
                continue
            graph = graphs.setdefault(island_id, {"island_id": island_id, "nodes": {}, "edges": []})
            graph["nodes"][first["id"]] = {
                "id": first["id"],
                "coordinates": first["coordinates"],
            }
            graph["nodes"][second["id"]] = {
                "id": second["id"],
                "coordinates": second["coordinates"],
            }
            permissions = _mode_permissions(way["tags"])
            edge_base = f"land:{island_id}:{way['id']}:{index}"
            coordinates = [first["coordinates"], second["coordinates"]]
            edge = {
                "id": edge_base,
                "from_id": first["id"],
                "to_id": second["id"],
                "distance_m": round(_distance_m(first["coordinates"], second["coordinates"]), 3),
                "geometry": coordinates,
                "permissions": permissions,
                "source": "OpenStreetMap",
                "source_way_id": str(way["id"]),
            }
            reverse = dict(edge)
            reverse["id"] = f"{edge_base}:reverse"
            reverse["from_id"] = second["id"]
            reverse["to_id"] = first["id"]
            reverse["geometry"] = list(reversed(coordinates))
            oneway = str(way["tags"].get("oneway", "")).casefold()
            if oneway in {"yes", "1", "true"}:
                graph["edges"].append(edge)
            elif oneway == "-1":
                graph["edges"].append(reverse)
            else:
                graph["edges"].extend((edge, reverse))
    for graph in graphs.values():
        graph["nodes"] = [graph["nodes"][key] for key in sorted(graph["nodes"])]
        graph["edges"].sort(key=lambda edge: edge["id"])
    return {"version": "routing-v1", "islands": dict(sorted(graphs.items()))}


def _mode_permissions(tags: dict[str, str]) -> dict[str, bool]:
    highway = tags.get("highway", "")
    access = tags.get("access", "").casefold()
    foot = tags.get("foot", "").casefold()
    bicycle = tags.get("bicycle", "").casefold()
    motor = tags.get("motor_vehicle", tags.get("motorcar", "")).casefold()
    walk = highway not in {"motorway", "motorway_link"} and foot not in {"no", "private"}
    if highway in NON_DRIVABLE_HIGHWAYS:
        car = False
    else:
        car = highway not in {"", "footway"} and access not in {"no", "private"} and motor not in {
            "no",
            "private",
        }
    return {
        "walk": walk,
        "bicycle": walk and bicycle not in {"no", "private"},
        "car": car,
        "taxi": car,
        "bus": car and tags.get("bus") != "no",
    }


def _build_marine_graph(
    osm_features: list[dict[str, Any]], osm_handler: Any, island_index: _IslandIndex
) -> dict[str, Any]:
    nodes = [
        {
            "id": feature["id"],
            "coordinates": feature["geometry"]["coordinates"],
            "island_id": feature.get("island_id")
            or island_index.find(feature["geometry"]["coordinates"])
            or island_index.nearest(feature["geometry"]["coordinates"]),
            "category": feature["category"],
            "name": feature.get("name"),
            "source": "OpenStreetMap",
        }
        for feature in osm_features
        if feature.get("category") in {"ferry_terminal", "pier"}
        and feature.get("geometry", {}).get("type") == "Point"
    ]
    edges: list[dict[str, Any]] = []
    for relation in osm_handler.ferry_relations:
        if len(relation.get("points", [])) >= 2:
            first_point = relation["points"][0]
            last_point = relation["points"][-1]
            if first_point != last_point:
                endpoint_nodes = []
                for suffix, coordinates in (("start", first_point), ("end", last_point)):
                    endpoint_id = f"marine-route:{relation['id']}:{suffix}"
                    endpoint_nodes.append(endpoint_id)
                    nodes.append(
                        {
                            "id": endpoint_id,
                            "coordinates": coordinates,
                            "island_id": island_index.nearest(coordinates),
                            "category": "ferry_route_endpoint",
                            "name": relation.get("name"),
                            "source": "OpenStreetMap",
                        }
                    )
                distance = round(_distance_m(first_point, last_point), 3)
                for direction, source, target in (
                    ("forward", endpoint_nodes[0], endpoint_nodes[1]),
                    ("reverse", endpoint_nodes[1], endpoint_nodes[0]),
                ):
                    edges.append(
                        {
                            "id": f"marine:{relation['id']}:{direction}",
                            "from_id": source,
                            "to_id": target,
                            "distance_m": distance,
                            "geometry": [first_point, last_point]
                            if direction == "forward"
                            else [last_point, first_point],
                            "mode": "ferry_candidate",
                            "passenger_eligible": False,
                            "cargo_eligible": False,
                            "active_status": "osm_route_candidate",
                            "source": "OpenStreetMap",
                            "source_relation_id": relation["id"],
                        }
                    )
        candidates = []
        for node in nodes:
            if any(
                _distance_m(node["coordinates"], point) <= 1500
                for point in relation.get("points", [])
            ):
                candidates.append(node)
        unique = {node["id"]: node for node in candidates}
        ordered = sorted(unique.values(), key=lambda node: node["id"])
        for first, second in zip(ordered, ordered[1:]):
            if first["island_id"] == second["island_id"]:
                continue
            edges.append(
                {
                    "id": f"marine:{relation['id']}:{first['id']}:{second['id']}",
                    "from_id": first["id"],
                    "to_id": second["id"],
                    "distance_m": round(
                        _distance_m(first["coordinates"], second["coordinates"]), 3
                    ),
                    "geometry": [first["coordinates"], second["coordinates"]],
                    "mode": "ferry_candidate",
                    "passenger_eligible": False,
                    "cargo_eligible": False,
                    "active_status": "osm_route_candidate",
                    "source": "OpenStreetMap",
                    "source_relation_id": relation["id"],
                }
            )
    return {
        "version": "routing-v1",
        "nodes": sorted(nodes, key=lambda node: node["id"]),
        "edges": sorted(edges, key=lambda edge: edge["id"]),
        "route_relation_count": len(osm_handler.ferry_relations),
        "routing_policy": "candidate_edges_are_disabled_until passenger service is verified",
    }


def _build_air_graph(
    facilities: list[dict[str, Any]], islands: list[dict[str, Any]]
) -> dict[str, Any]:
    island_centroids = {
        island["properties"]["id"]: island["properties"].get("centroid")
        for island in islands
        if island.get("properties", {}).get("id") and island["properties"].get("centroid")
    }
    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    for facility in facilities:
        if facility.get("category") != "airport" or not facility.get("geometry"):
            continue
        island_id = facility.get("island_id")
        coordinates = facility["geometry"].get("coordinates")
        if not island_id or not coordinates:
            continue
        airport_id = facility["id"]
        gateway_id = f"air-gateway:{island_id}"
        nodes.append(
            {
                "id": airport_id,
                "coordinates": coordinates,
                "island_id": island_id,
                "kind": "airport",
                "name": facility.get("name"),
            }
        )
        centroid = island_centroids.get(island_id)
        if centroid:
            nodes.append(
                {
                    "id": gateway_id,
                    "coordinates": centroid,
                    "island_id": island_id,
                    "kind": "island_gateway",
                    "name": None,
                }
            )
            distance = round(_distance_m(coordinates, centroid), 3)
            for direction, source, target in (
                ("to_gateway", airport_id, gateway_id),
                ("to_airport", gateway_id, airport_id),
            ):
                edges.append(
                    {
                        "id": f"air:{airport_id}:{direction}",
                        "from_id": source,
                        "to_id": target,
                        "distance_m": distance,
                        "mode": "air_access",
                        "source": "CAA+OneMap",
                        "flight_service_verified": False,
                    }
                )
    unique_nodes = {node["id"]: node for node in nodes}
    return {
        "version": "routing-v1",
        "nodes": [unique_nodes[key] for key in sorted(unique_nodes)],
        "edges": sorted(edges, key=lambda edge: edge["id"]),
        "flight_edges": [],
        "policy": "airport access only; no flight schedules inferred",
    }


def _build_demand_anchors(
    demand_features: list[dict[str, Any]],
    islands: list[dict[str, Any]],
    island_index: _IslandIndex,
) -> dict[str, Any]:
    anchors: list[dict[str, Any]] = []
    island_has_anchor: set[str] = set()
    for feature in demand_features:
        coordinates = feature.get("coordinates")
        island_id = feature.get("island_id") or island_index.find(coordinates)
        if not coordinates or not island_id:
            continue
        anchor_id = f"demand:{feature['id']}"
        anchors.append(
            {
                "id": anchor_id,
                "island_id": island_id,
                "geometry": {"type": "Point", "coordinates": coordinates},
                "weight": feature.get("weight", 1.0),
                "allocated_population": None,
                "confidence": 0.35,
                "method": "osm_settlement_or_residential_geometry",
                "source": "OpenStreetMap",
            }
        )
        island_has_anchor.add(island_id)
    for island in islands:
        properties = island.get("properties", {})
        island_id = properties.get("id")
        centroid = properties.get("centroid")
        if island_id and centroid and island_id not in island_has_anchor:
            anchors.append(
                {
                    "id": f"demand:fallback:{island_id}",
                    "island_id": island_id,
                    "geometry": {"type": "Point", "coordinates": centroid},
                    "weight": 1.0,
                    "allocated_population": None,
                    "confidence": 0.1,
                    "method": "island_centroid_fallback",
                    "source": "OneMap",
                }
            )
    anchors.sort(key=lambda anchor: anchor["id"])
    return {
        "version": "routing-v1",
        "anchors": anchors,
        "population_allocation_status": "blocked_pending_mbs_atoll_mapping_review",
    }


def _distance_m(first: list[float], second: list[float]) -> float:
    longitude_1, latitude_1 = first
    longitude_2, latitude_2 = second
    radius = 6_371_000
    lat_1 = math.radians(latitude_1)
    lat_2 = math.radians(latitude_2)
    delta_lat = math.radians(latitude_2 - latitude_1)
    delta_lon = math.radians(longitude_2 - longitude_1)
    value = math.sin(delta_lat / 2) ** 2 + math.cos(lat_1) * math.cos(lat_2) * math.sin(
        delta_lon / 2
    ) ** 2
    return 2 * radius * math.atan2(math.sqrt(value), math.sqrt(1 - value))
