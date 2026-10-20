"""Bounded planning corridors around mapped land, never navigation clearance.

The source terminal remains the endpoint. A short approach through its own
mapped shoreline accommodates the imperfect coastal placement of terminal
points; the water portion may not enter any mapped island, including either
endpoint island. Reefs, depth, shipping channels and operating permission are
not established by this geometric model.
"""

from __future__ import annotations

import heapq
import math
from functools import lru_cache
from typing import Any

from shapely import make_valid
from shapely.affinity import affine_transform
from shapely.errors import GEOSException
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box, shape
from shapely.ops import nearest_points, unary_union
from shapely.strtree import STRtree

from app.routing.engine import _distance_m

CORRIDOR_SOURCE = "coastline_avoiding_planning_corridor"
CORRIDOR_MODEL_VERSION = 2
CORRIDOR_QUALIFICATION = (
    "Modeled corridor avoiding mapped island shorelines, with short approaches to "
    "the existing mapped terminals. Depth, reefs, navigable channels, berth access "
    "and operator approval are unverified; this is not navigation clearance."
)
# Dense atoll crossings need more shoreline vertices than short local hops.
# Keep the graph bounded without discarding any obstacle or weakening the
# source-land validation, shore approach limit or water clearance.
MAX_VERTICES = 512
MAX_SHORE_APPROACH_M = 250
CLEARANCE_M = 30


def _polygons(geometry: Any) -> list[Polygon]:
    if isinstance(geometry, Polygon):
        return [geometry]
    if isinstance(geometry, MultiPolygon):
        return list(geometry.geoms)
    return [polygon for part in getattr(geometry, "geoms", []) for polygon in _polygons(part)]


def _filled(geometry: Any) -> Any:
    # Enclosed holes are not established sea access. Filling them is conservative.
    return unary_union([Polygon(polygon.exterior) for polygon in _polygons(geometry)])


class WaterCorridorPlanner:
    def __init__(self, islands_by_id: dict[str, dict[str, Any]]) -> None:
        self.features = islands_by_id
        self._loaded = False
        self._land: dict[str, Any] = {}
        self._identities: list[str] = []
        self._index: STRtree | None = None

    def _load(self) -> None:
        if self._loaded:
            return
        # Do not silently drop a missing or invalid island from the obstacle set.
        land = {}
        for identity, feature in self.features.items():
            raw_geometry = feature.get("geometry")
            if not isinstance(raw_geometry, dict) or raw_geometry.get("type") not in {
                "Polygon",
                "MultiPolygon",
            }:
                raise ValueError("Mapped island shoreline geometry is incomplete")
            geometry = shape(raw_geometry)
            if not geometry.is_valid:
                geometry = make_valid(geometry)
            geometry = _filled(geometry)
            if geometry.is_empty or not geometry.is_valid:
                raise ValueError("Mapped island shoreline geometry is incomplete")
            land[identity] = geometry
        if not land:
            raise ValueError("Mapped island shoreline geometry is unavailable")
        self._land = land
        self._identities = sorted(land)
        self._index = STRtree([land[identity] for identity in self._identities])
        self._loaded = True

    def corridor(self, first: dict[str, Any], second: dict[str, Any]) -> dict[str, Any] | None:
        try:
            self._load()
            return self._corridor(
                first["island_id"],
                tuple(first["coordinates"]),
                second["island_id"],
                tuple(second["coordinates"]),
            )
        except ValueError, TypeError, KeyError, GEOSException:
            return None

    @lru_cache(maxsize=64)
    def _corridor(
        self,
        first_id: str,
        first: tuple[float, float],
        second_id: str,
        second: tuple[float, float],
    ) -> dict[str, Any] | None:
        if first_id not in self._land or second_id not in self._land:
            return None
        longitude, latitude = (first[0] + second[0]) / 2, (first[1] + second[1]) / 2
        sx, sy = 111_195 * math.cos(math.radians(latitude)), 111_195
        projection = [sx, 0, 0, sy, -longitude * sx, -latitude * sy]

        def project(point: tuple[float, float]) -> tuple[float, float]:
            return (point[0] - longitude) * sx, (point[1] - latitude) * sy

        start, end = Point(project(first)), Point(project(second))
        direct_distance = start.distance(end)
        if direct_distance <= 1 or direct_distance > 1_000_000:
            return None
        margin = min(20_000, max(2_000, direct_distance * 0.15))
        bounds = LineString([start, end]).buffer(margin).bounds
        search_box = box(
            bounds[0] / sx + longitude,
            bounds[1] / sy + latitude,
            bounds[2] / sx + longitude,
            bounds[3] / sy + latitude,
        )
        assert self._index is not None
        identities = {self._identities[int(index)] for index in self._index.query(search_box)} | {
            first_id,
            second_id,
        }
        land = {
            identity: affine_transform(self._land[identity], projection)
            for identity in sorted(identities)
        }
        for identity, point in ((first_id, start), (second_id, end)):
            own_land = land[identity]
            if point.distance(own_land.boundary) > MAX_SHORE_APPROACH_M:
                return None
            if any(
                other != identity and polygon.contains(point) for other, polygon in land.items()
            ):
                return None

        # Inflate by the simplification tolerance as well as the clearance. The
        # final source-land validation below remains authoritative even if a
        # repaired or simplified boundary behaves unexpectedly.
        obstacles = None
        vertices = []
        for tolerance in (5, 15, 20, 30, 40, 100, 200):
            obstacles = _filled(
                unary_union(list(land.values()))
                .buffer(CLEARANCE_M + tolerance, quad_segs=1, join_style="mitre", mitre_limit=2)
                .simplify(tolerance, preserve_topology=True)
            )
            vertices = sorted(
                {
                    (float(x), float(y))
                    for polygon in _polygons(obstacles)
                    for x, y in polygon.exterior.coords[:-1]
                }
            )
            if len(vertices) + 2 <= MAX_VERTICES:
                break
        if obstacles is None or len(vertices) + 2 > MAX_VERTICES:
            return None

        shore = []
        for point in (start, end):
            endpoint = (
                nearest_points(point, obstacles.boundary)[1] if obstacles.covers(point) else point
            )
            if point.distance(endpoint) > MAX_SHORE_APPROACH_M + 250:
                return None
            shore.append((endpoint.x, endpoint.y))
        # The tiny inset avoids floating-point boundary touches being treated as
        # interior intersections. Source shoreline clearance is still >=30 m.
        interior = obstacles.buffer(-0.01)

        def visible(a: tuple[float, float], b: tuple[float, float]) -> bool:
            return a != b and LineString([a, b]).relate_pattern(interior, "F********")

        nodes = [shore[0], shore[1], *[point for point in vertices if point not in shore]]
        if shore[0] == shore[1]:
            return None
        if visible(nodes[0], nodes[1]):
            path = nodes[:2]
        else:
            adjacency: list[list[tuple[int, float]]] = [[] for _ in nodes]
            for index, a in enumerate(nodes):
                for target in range(index + 1, len(nodes)):
                    b = nodes[target]
                    if visible(a, b):
                        distance = math.dist(a, b)
                        adjacency[index].append((target, distance))
                        adjacency[target].append((index, distance))
            distances, previous, queue = {0: 0.0}, {}, [(0.0, 0)]
            while queue:
                distance, index = heapq.heappop(queue)
                if distance != distances[index]:
                    continue
                if index == 1:
                    break
                for target, length in adjacency[index]:
                    candidate = distance + length
                    if candidate < distances.get(target, math.inf):
                        distances[target], previous[target] = candidate, index
                        heapq.heappush(queue, (candidate, target))
            if 1 not in distances:
                return None
            ordered = [1]
            while ordered[-1] != 0:
                ordered.append(previous[ordered[-1]])
            path = [nodes[index] for index in reversed(ordered)]

        water_coordinates = [[x / sx + longitude, y / sy + latitude] for x, y in path]

        def clear(a: list[float], b: list[float], exempt: str | None = None) -> bool:
            segment = LineString([a, b])
            return all(
                identity == exempt or segment.relate_pattern(self._land[identity], "F********")
                for match in self._index.query(segment)
                for identity in [self._identities[int(match)]]
            )

        # Never exempt the full endpoint islands: only their bounded shore
        # approach may enter land. In particular, reject any later re-entry.
        if (
            not clear(list(first), water_coordinates[0], first_id)
            or not clear(water_coordinates[-1], list(second), second_id)
            or any(not clear(a, b) for a, b in zip(water_coordinates, water_coordinates[1:]))
        ):
            return None
        coordinates = [list(first)]
        for point in water_coordinates:
            if _distance_m(coordinates[-1], point) > 0.01:
                coordinates.append(point)
        if _distance_m(coordinates[-1], second) > 0.01:
            coordinates.append(list(second))
        else:
            coordinates[-1] = list(second)

        distance_m = sum(_distance_m(a, b) for a, b in zip(coordinates, coordinates[1:]))
        if distance_m > 1_000_000:
            return None
        return {
            "geometry": coordinates,
            "distance_m": distance_m,
            "geometry_source": CORRIDOR_SOURCE,
            "qualification": CORRIDOR_QUALIFICATION,
        }
