"""Qualified population allocation, separate from observed island resident totals.

WorldPop is rejected when its total is inconsistent with the official island
projection. A sparse alpha raster is never amplified into a local population
surface. Mapped residential areas provide a second, explicitly assumed support;
the last resort is a disclosed uniform-land assumption, not a settlement map.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Iterator

from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union

ORIGIN_ALLOCATION_VERSION = "national-resident-allocation-v1"


@dataclass(frozen=True)
class PopulationRaster:
    """North-up EPSG:4326, pixel-is-area population-count raster."""

    values: Any
    west: float
    north: float
    pixel_width: float
    pixel_height: float
    nodata: float = -99999.0

    def cells(self, geometry: Any) -> Iterator[tuple[int, int, float, Any]]:
        west, south, east, north = geometry.bounds
        height, width = self.values.shape
        row0 = max(0, math.floor((self.north - north) / self.pixel_height))
        row1 = min(height, math.ceil((self.north - south) / self.pixel_height))
        col0 = max(0, math.floor((west - self.west) / self.pixel_width))
        col1 = min(width, math.ceil((east - self.west) / self.pixel_width))
        for row in range(row0, row1):
            top = self.north - row * self.pixel_height
            for column in range(col0, col1):
                left = self.west + column * self.pixel_width
                pixel = box(left, top - self.pixel_height, left + self.pixel_width, top)
                if not geometry.intersects(pixel):
                    continue
                clipped = geometry.intersection(pixel)
                if not clipped.is_empty and clipped.area > 1e-14:
                    yield row, column, float(self.values[row, column]), clipped


def polygonal(geometry: Any) -> Any:
    """Repair source polygon topology; discard zero-area artifacts."""
    if not geometry.is_valid:
        geometry = geometry.buffer(0)
    if geometry.geom_type in {"Polygon", "MultiPolygon"}:
        return geometry
    return unary_union([part for part in getattr(geometry, "geoms", []) if part.area > 0])


def allocate_island(
    island: dict[str, Any],
    population_2026: float,
    population_2030: float,
    raster: PopulationRaster,
    *,
    residential_areas: list[Any] | None = None,
    residential_buildings: list[Any] | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Conserve supplied projections while exposing the allocation assumption.

    Guardrails are screening assumptions, not a statistical accuracy guarantee.
    Building-only support needs at least ten mapped residential buildings and
    at least 10 m² of footprint per projected resident; this avoids placing a
    whole island into a handful of incompletely mapped houses. No floor counts
    or occupancy per building are invented.
    """
    totals = [float(population_2026), float(population_2030)]
    if any(not math.isfinite(value) or value < 0 for value in totals):
        raise ValueError("Official resident projections must be finite and nonnegative")
    properties = island.get("properties", island)
    island_id = properties["id"]
    land = polygonal(shape(island["geometry"]))
    if land.is_empty or land.area <= 0:
        raise ValueError(f"No usable island polygon for {island_id}")
    cells = list(raster.cells(land))
    pixel_area = raster.pixel_width * raster.pixel_height
    positive = [
        (r, c, value * footprint.area / pixel_area, footprint)
        for r, c, value, footprint in cells
        if math.isfinite(value) and value > 0 and value != raster.nodata
    ]
    raster_total = sum(cell[2] for cell in positive)
    calibration = totals[0] / raster_total if raster_total else None
    areas = polygonal(unary_union(residential_areas or []).intersection(land))
    buildings = polygonal(unary_union(residential_buildings or []).intersection(land))
    residential_support = areas if not areas.is_empty else buildings
    positive_support = unary_union([cell[3] for cell in positive])
    mapped_residential_coverage = (
        positive_support.intersection(residential_support).area / residential_support.area
        if residential_support.area > 0
        else None
    )
    accepted_raster = (
        raster_total > 0
        and calibration is not None
        and 0.5 <= calibration <= 2.0
        and (mapped_residential_coverage is None or mapped_residential_coverage >= 0.5)
    )
    if accepted_raster:
        method, quality, support = "worldpop_calibrated", "modeled", land
        weighted = positive
        source_ids = ["worldpop2026", "mbs-island-projections", "onemap-islands"]
        qualification = (
            "WorldPop alpha population weights screened and clipped to OneMap land, "
            "then normalized to official projected residents. Not block census counts."
        )
    else:
        area_conversion = 111320**2 * math.cos(math.radians(land.representative_point().y))
        building_area_m2 = buildings.area * area_conversion
        area_m2 = areas.area * area_conversion
        sufficient_buildings = (
            len(residential_buildings or []) >= 10 and building_area_m2 >= totals[0] * 10
        )
        # A lone small residential polygon may cover only one estate, while
        # source houses are mapped across the rest of the island. Do not
        # concentrate the island population into that incomplete polygon.
        area_covers_housing = (
            areas.intersection(buildings).area / buildings.area if buildings.area > 0 else 1.0
        )
        sufficient_area = area_m2 >= totals[0] * 10 and (
            not sufficient_buildings or area_covers_housing >= 0.5
        )
        if not areas.is_empty and sufficient_area:
            method, quality, support = "uniform_mapped_residential_area", "coarse_assumption", areas
            qualification = (
                "Official projected residents spread uniformly across mapped OSM residential "
                "landuse. Mapping completeness and within-area density are unverified."
            )
        elif sufficient_buildings:
            method = "residential_building_footprint_area"
            quality, support = "coarse_assumption", buildings
            qualification = (
                "Official projected residents allocated by mapped residential building "
                "footprint area. Occupancy, floor counts and mapping completeness are unverified."
            )
        else:
            method, quality, support = "assumed_uniform_land", "coarse_assumption", land
            qualification = (
                "Neighborhood resident distribution is unavailable. Official projected "
                "residents are spread uniformly over island land as a coarse planning "
                "assumption, including potentially uninhabited land. Not a settlement map."
            )
        # Use the same ~100 m grid, but the weights are support area, not the
        # rejected raster values. This does not concentrate residents in its
        # sparse positive cells. Union support prevents double-counted buildings.
        weighted = [
            (r, c, footprint.area, footprint) for r, c, _value, footprint in raster.cells(support)
        ]
        source_ids = ["mbs-island-projections", "onemap-islands"]
        if method != "assumed_uniform_land":
            source_ids.append("osm-geofabrik")
    denominator = sum(cell[2] for cell in weighted)
    if denominator <= 0:
        raise ValueError(f"Island {island_id} has no grid support inside raster bounds")
    origins = []
    for row, column, weight, footprint in weighted:
        point = footprint.representative_point()
        origins.append(
            {
                "id": f"national:{island_id}:{row}:{column}",
                "islandId": island_id,
                "lon": point.x,
                "lat": point.y,
                "coordinate": [point.x, point.y],
                "bounds": list(footprint.bounds),
                "geometry": mapping(footprint.simplify(0.000002, preserve_topology=True)),
                "population2026": totals[0] * weight / denominator,
                "population2030": totals[1] * weight / denominator,
                "allocationMethod": method,
                "spatialQuality": quality,
                "distributionUnavailable": quality == "coarse_assumption",
                "localDistributionObserved": False,
                "sourceIds": source_ids,
                "provenance": "simulated",
                "qualification": qualification + " 2030 reuses 2026 spatial support.",
            }
        )
    # Correct only floating point residue, not substantive weighting differences.
    for year, total in zip((2026, 2030), totals):
        key = f"population{year}"
        origins[-1][key] += total - sum(origin[key] for origin in origins)
    report = {
        "islandId": island_id,
        "name": properties.get("name"),
        "atoll": properties.get("atoll"),
        "method": method,
        "spatialQuality": quality,
        "distributionUnavailable": quality == "coarse_assumption",
        "localDistributionObserved": False,
        "origins": len(origins),
        "population2026": totals[0],
        "population2030": totals[1],
        "rawLandWeightedRasterPopulation": raster_total,
        "rasterScaleFactor2026": calibration,
        "rasterAccepted": bool(accepted_raster),
        "rasterPositiveCells": len(positive),
        "mappedResidentialRasterCoverage": mapped_residential_coverage,
        "mappedResidentialAreas": len(residential_areas or []),
        "mappedResidentialBuildings": len(residential_buildings or []),
        "qualification": qualification,
    }
    return origins, report
