"""Conservative display tessellation over existing modeled resident footprints.

The hexagons are a presentation mesh, not additional population observations.
Each source polygon contributes its existing value by intersection-area share;
an optional island boundary expands only the presentation of supported cells.
Resident allocations and their contribution shares retain the source footprints.
"""

from __future__ import annotations

import math
from typing import Any

from shapely import affinity
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

HEX_RADIUS_M = 55.0
METRES_PER_DEGREE = 111_320.0


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
    west, south, east, north = support_degrees.bounds
    longitude, latitude = (west + east) / 2, (south + north) / 2
    scale_x = METRES_PER_DEGREE * math.cos(math.radians(latitude))
    scale_y = METRES_PER_DEGREE
    if scale_x <= 0:
        return empty
    projection = [scale_x, 0, 0, scale_y, -longitude * scale_x, -latitude * scale_y]
    inverse = [1 / scale_x, 0, 0, 1 / scale_y, longitude, latitude]
    projected = [affinity.affine_transform(polygon, projection) for _, polygon in sources]
    support = unary_union(projected)
    display_support = None
    if display_boundary:
        boundary = _polygonal(shape(display_boundary))
        if boundary.is_empty or not boundary.is_valid:
            raise ValueError("Display boundary must be valid polygonal island land")
        display_support = affinity.affine_transform(boundary, projection)
    tree = STRtree(projected)
    min_x, min_y, max_x, max_y = support.bounds
    height = math.sqrt(3) * HEX_RADIUS_M
    features = []
    first_q = math.floor((min_x - HEX_RADIUS_M) / (1.5 * HEX_RADIUS_M))
    last_q = math.ceil((max_x + HEX_RADIUS_M) / (1.5 * HEX_RADIUS_M))
    for q in range(first_q, last_q + 1):
        first_r = math.floor(min_y / height - q / 2 - 1)
        last_r = math.ceil(max_y / height - q / 2 + 1)
        for r in range(first_r, last_r + 1):
            # The same integer vertex produces exactly the same shared point.
            hexagon = Polygon(
                [
                    (
                        HEX_RADIUS_M / 2 * (3 * q + dx),
                        height / 2 * (2 * r + q + dy),
                    )
                    for dx, dy in ((2, 0), (1, 1), (-1, 1), (-2, 0), (-1, -1), (1, -1))
                ]
            )
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
