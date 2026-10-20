"""Conservative display tessellation over existing modeled resident footprints.

The hexagons are a presentation mesh, not additional population observations.
Each source polygon contributes its existing value by intersection-area share;
an optional island boundary expands only the presentation of supported cells.
Resident allocations and their contribution shares retain the source footprints.
"""

from __future__ import annotations

import math
from heapq import nsmallest
from typing import Any

from shapely import affinity, make_valid
from shapely.errors import GEOSException
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

HEX_RADIUS_M = 55.0
METRES_PER_DEGREE = 111_320.0
GAP_METRICS = ("health_gap", "education_gap", "transport_gap", "overall_gap")


def _polygonal(geometry):
    """Drop boundary-only intersections without buffering or closing source holes."""
    if isinstance(geometry, (Polygon, MultiPolygon)):
        return geometry
    polygons = []
    for part in getattr(geometry, "geoms", ()):
        candidate = _polygonal(part)
        if not candidate.is_empty:
            polygons.append(candidate)
    return unary_union(polygons) if polygons else Polygon()


def _local_projection(bounds):
    west, south, east, north = bounds
    longitude, latitude = (west + east) / 2, (south + north) / 2
    scale_x = METRES_PER_DEGREE * math.cos(math.radians(latitude))
    scale_y = METRES_PER_DEGREE
    if scale_x <= 0:
        return None
    return (
        [scale_x, 0, 0, scale_y, -longitude * scale_x, -latitude * scale_y],
        [1 / scale_x, 0, 0, 1 / scale_y, longitude, latitude],
    )


def _hexagon_lattice(bounds):
    min_x, min_y, max_x, max_y = bounds
    height = math.sqrt(3) * HEX_RADIUS_M
    first_q = math.floor((min_x - HEX_RADIUS_M) / (1.5 * HEX_RADIUS_M))
    last_q = math.ceil((max_x + HEX_RADIUS_M) / (1.5 * HEX_RADIUS_M))
    for q in range(first_q, last_q + 1):
        first_r = math.floor(min_y / height - q / 2 - 1)
        last_r = math.ceil(max_y / height - q / 2 + 1)
        for r in range(first_r, last_r + 1):
            # Integer lattice vertices give supported and inferred cells shared edges.
            yield (
                q,
                r,
                Polygon(
                    [
                        (
                            HEX_RADIUS_M / 2 * (3 * q + dx),
                            height / 2 * (2 * r + q + dy),
                        )
                        for dx, dy in ((2, 0), (1, 1), (-1, 1), (-2, 0), (-1, -1), (1, -1))
                    ]
                ),
            )


def build_uncovered_land(
    boundary: dict[str, Any] | None,
    grid: dict[str, Any],
    *,
    island_id: str,
) -> dict[str, Any]:
    """Describe land outside the displayed mesh without inventing resident evidence.

    Use display geometry rather than source footprints: some supported national
    cells expand to land-clipped hexagons. Invalid geometry cannot establish an
    uncovered area, so omit the presentation mask in that case.
    """
    empty = {"type": "FeatureCollection", "features": []}
    if not boundary:
        return empty
    try:
        land = _polygonal(shape(boundary))
        if (
            land.is_empty
            or not land.is_valid
            or not all(math.isfinite(value) for value in land.bounds)
        ):
            return empty
        displayed = []
        for feature in grid.get("features", []):
            geometry = feature.get("geometry")
            if not geometry:
                continue
            polygon = _polygonal(shape(geometry))
            if polygon.is_empty:
                continue
            # Inverse projection can collapse boundary-only mesh slivers to a
            # line; they have no fill area and cannot remove land coverage.
            if polygon.area <= 0:
                west, south, east, north = polygon.bounds
                if west == east or south == north:
                    continue
                return empty
            if not polygon.is_valid or not all(math.isfinite(value) for value in polygon.bounds):
                return empty
            displayed.append(polygon)
        uncovered = _polygonal(land.difference(unary_union(displayed)))
    except GEOSException, TypeError, ValueError, KeyError:
        return empty
    if uncovered.is_empty:
        return empty
    feature_id = f"uncovered:{island_id}"
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "id": feature_id,
                "geometry": mapping(uncovered),
                "properties": {
                    "id": feature_id,
                    "island_id": island_id,
                    "status": "no_spatial_estimate",
                },
            }
        ],
    }


def build_coverage_fill(
    boundary: dict[str, Any] | None,
    grid: dict[str, Any],
    gap_cells: dict[str, Any],
    *,
    island_id: str,
) -> dict[str, Any]:
    """Interpolate only uncovered map colors; canonical evidence stays unchanged.

    Each lens uses at most six nearest same-island source origins with a known
    gap, weighted by inverse squared distance in local metres. These separate
    presentation features carry no population or modeled journey-time fields.
    """
    empty = {"type": "FeatureCollection", "features": []}
    uncovered = build_uncovered_land(boundary, grid, island_id=island_id)
    if not uncovered["features"]:
        return empty
    source_polygons = []
    sources = []
    for feature in gap_cells.get("features", []):
        properties = feature.get("properties") or {}
        if properties.get("island_id") != island_id:
            continue
        geometry = feature.get("geometry")
        if not geometry or geometry.get("type") not in {"Polygon", "MultiPolygon"}:
            continue
        polygon = shape(geometry)
        if (
            polygon.is_empty
            or not polygon.is_valid
            or not all(math.isfinite(value) for value in polygon.bounds)
        ):
            continue
        source_polygons.append(polygon)
        coordinates = properties.get("coordinates")
        if (
            not isinstance(coordinates, (list, tuple))
            or len(coordinates) != 2
            or not all(
                isinstance(value, (int, float)) and math.isfinite(value) for value in coordinates
            )
        ):
            point = polygon.representative_point()
            coordinates = (point.x, point.y)
        sources.append((coordinates, properties))
    support = unary_union(source_polygons)
    land = shape(uncovered["features"][0]["geometry"])
    transforms = _local_projection((support if not support.is_empty else land).bounds)
    if transforms is None:
        return empty
    projection, inverse = transforms
    candidates: dict[str, list[tuple[float, float, float]]] = {key: [] for key in GAP_METRICS}
    for (longitude, latitude), properties in sources:
        x = longitude * projection[0] + projection[4]
        y = latitude * projection[3] + projection[5]
        for key in GAP_METRICS:
            value = properties.get(key)
            if (
                isinstance(value, (int, float))
                and not isinstance(value, bool)
                and math.isfinite(value)
                and 0 <= value <= 1
            ):
                candidates[key].append((x, y, value))
    projected_land = affinity.affine_transform(land, projection)
    features = []
    for q, r, hexagon in _hexagon_lattice(projected_land.bounds):
        clipped = _polygonal(hexagon.intersection(projected_land))
        if clipped.is_empty or clipped.area <= 0:
            continue
        geometry = affinity.affine_transform(clipped, inverse)
        if not geometry.is_valid:
            geometry = _polygonal(make_valid(geometry))
        if geometry.is_empty or geometry.area <= 0:
            continue
        point = clipped.representative_point()
        point_x, point_y = point.x, point.y
        values: dict[str, float | None] = {}
        for key, known in candidates.items():
            nearest = nsmallest(
                6,
                (((x - point_x) ** 2 + (y - point_y) ** 2, value) for x, y, value in known),
            )
            if not nearest:
                values[key] = None
            elif nearest[0][0] <= 1e-12:
                values[key] = nearest[0][1]
            else:
                weights = [(1 / distance_squared, value) for distance_squared, value in nearest]
                values[key] = sum(weight * value for weight, value in weights) / sum(
                    weight for weight, _ in weights
                )
        feature_id = f"coverage:{island_id}:{q}:{r}"
        features.append(
            {
                "type": "Feature",
                "id": feature_id,
                "geometry": mapping(geometry),
                "properties": {
                    "id": feature_id,
                    "island_id": island_id,
                    "interpolated": True,
                    **values,
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}


def build_display_grid(
    origins: list[dict[str, Any]],
    *,
    scope: str,
    island_id: str,
    display_boundary: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Return a deterministic 55 m flat-top mesh and conservative origin shares.

    Local equirectangular metres are sufficient for the small Maldives island
    scopes. Integer lattice vertices make adjacent hexagons share the same
    coordinates, including before clipping. By default source support also clips
    display geometry. An explicit island boundary instead shows each supported
    cell as a full land-clipped hexagon; contribution shares still use only the
    original footprints. Cells without sources are never added. Input records
    and population stay intact.
    """
    empty = {"type": "FeatureCollection", "features": []}
    sources = []
    for origin in sorted(origins, key=lambda row: str(row.get("id", ""))):
        geometry = origin.get("geometry")
        if (
            not origin.get("id")
            or not geometry
            or geometry.get("type") not in {"Polygon", "MultiPolygon"}
        ):
            continue
        polygon = shape(geometry)
        if (
            polygon.is_empty
            or not polygon.is_valid
            or polygon.area <= 0
            or not all(math.isfinite(value) for value in polygon.bounds)
        ):
            continue
        sources.append((origin["id"], polygon))
    if not sources:
        return empty

    support_degrees = unary_union([polygon for _, polygon in sources])
    transforms = _local_projection(support_degrees.bounds)
    if transforms is None:
        return empty
    projection, inverse = transforms
    projected = [affinity.affine_transform(polygon, projection) for _, polygon in sources]
    support = unary_union(projected)
    display_support = None
    if display_boundary:
        boundary = _polygonal(shape(display_boundary))
        if boundary.is_empty or not boundary.is_valid:
            raise ValueError("Display boundary must be valid polygonal island land")
        display_support = affinity.affine_transform(boundary, projection)
    tree = STRtree(projected)
    features = []
    for q, r, hexagon in _hexagon_lattice(support.bounds):
        clipped = _polygonal(hexagon.intersection(support))
        if clipped.is_empty or clipped.area <= 0:
            continue
        contributions = []
        for index in sorted(tree.query(clipped, predicate="intersects")):
            area = clipped.intersection(projected[index]).area
            if area > 0:
                contributions.append(
                    {"origin_id": sources[index][0], "share": area / projected[index].area}
                )
        if not contributions:
            continue
        display_geometry = (
            _polygonal(hexagon.intersection(display_support))
            if display_support is not None
            else clipped
        )
        if display_geometry.is_empty:
            continue
        feature_id = f"hex:{scope}:{q}:{r}"
        features.append(
            {
                "type": "Feature",
                "id": feature_id,
                "geometry": mapping(affinity.affine_transform(display_geometry, inverse)),
                "properties": {
                    "id": feature_id,
                    "island_id": island_id,
                    "contributions": contributions,
                    **(
                        {"display_geometry": "island_clipped_hexagon"}
                        if display_support is not None
                        else {}
                    ),
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}
