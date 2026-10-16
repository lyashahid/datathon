"""Resident origin quality gates, fallback support and conservation."""

import math

import numpy as np
import pytest
from shapely.geometry import Point, box, mapping

from app.planning.population_origins import PopulationRaster, allocate_island


def fixture(values=None):
    land = box(73, 0, 73.005, 0.005)
    island = {
        "properties": {"id": "island:test", "name": "Test", "atoll": "Seenu"},
        "geometry": mapping(land),
    }
    raster = PopulationRaster(
        np.full((5, 5), 4.0) if values is None else values,
        73,
        0.005,
        0.001,
        0.001,
    )
    return island, land, raster


def assert_conserved(origins, land, total_2026=100, total_2030=120):
    assert sum(origin["population2026"] for origin in origins) == pytest.approx(total_2026)
    assert sum(origin["population2030"] for origin in origins) == pytest.approx(total_2030)
    assert all(land.covers(Point(origin["coordinate"])) for origin in origins)
    assert all(math.isfinite(origin["population2026"]) for origin in origins)


def test_consistent_raster_is_clipped_and_conserves_projections():
    island, land, raster = fixture()
    origins, report = allocate_island(island, 100, 120, raster)
    assert report["rasterAccepted"]
    assert report["method"] == "worldpop_calibrated"
    assert report["rasterScaleFactor2026"] == pytest.approx(1)
    assert all(not origin["distributionUnavailable"] for origin in origins)
    assert_conserved(origins, land)


def test_sparse_raster_is_not_amplified_into_few_cells():
    values = np.full((5, 5), -99999.0)
    values[2, 2] = 0.5
    island, land, raster = fixture(values)
    origins, report = allocate_island(island, 100, 120, raster)
    assert not report["rasterAccepted"]
    assert report["rasterScaleFactor2026"] == pytest.approx(200)
    assert report["method"] == "assumed_uniform_land"
    assert len(origins) >= 25
    assert max(origin["population2026"] for origin in origins) <= 4.001
    assert all(origin["distributionUnavailable"] for origin in origins)
    assert_conserved(origins, land)


def test_residential_area_fallback_never_assigns_outside_mapped_support():
    island, land, raster = fixture(np.full((5, 5), -99999.0))
    support = box(73.001, 0.001, 73.004, 0.004)
    origins, report = allocate_island(
        island, 100, 120, raster, residential_areas=[support, support]
    )
    assert report["method"] == "uniform_mapped_residential_area"
    assert all(support.covers(Point(origin["coordinate"])) for origin in origins)
    assert_conserved(origins, land)
    # Duplicate/overlapping source polygons are unioned, never double weighted.
    single, _ = allocate_island(island, 100, 120, raster, residential_areas=[support])
    assert [origin["population2026"] for origin in origins] == pytest.approx(
        [origin["population2026"] for origin in single]
    )


def test_plausible_total_still_rejected_when_mapped_residential_support_missing():
    values = np.full((5, 5), -99999.0)
    values[0, 0] = 100
    island, land, raster = fixture(values)
    support = box(73.002, 0.001, 73.004, 0.003)
    origins, report = allocate_island(island, 100, 120, raster, residential_areas=[support])
    assert not report["rasterAccepted"]
    assert report["mappedResidentialRasterCoverage"] == 0
    assert report["method"] == "uniform_mapped_residential_area"
    assert_conserved(origins, land)


def test_handful_of_houses_does_not_claim_complete_island_distribution():
    island, land, raster = fixture(np.full((5, 5), -99999.0))
    origins, report = allocate_island(
        island,
        100,
        120,
        raster,
        residential_buildings=[box(73.001, 0.001, 73.0011, 0.0011)],
    )
    assert report["method"] == "assumed_uniform_land"
    assert_conserved(origins, land)


def test_tiny_residential_estate_cannot_hide_housing_mapped_across_island():
    island, land, raster = fixture(np.full((5, 5), -99999.0))
    buildings = [
        box(
            73.0002 + column * 0.001,
            0.0002 + row * 0.001,
            73.0005 + column * 0.001,
            0.0005 + row * 0.001,
        )
        for row in range(4)
        for column in range(4)
    ]
    origins, report = allocate_island(
        island,
        100,
        120,
        raster,
        residential_areas=[box(73.0001, 0.0001, 73.0006, 0.0006)],
        residential_buildings=buildings,
    )
    assert report["method"] == "residential_building_footprint_area"
    assert len(origins) >= 16
    assert_conserved(origins, land)


@pytest.mark.parametrize("invalid", [-1, math.nan, math.inf])
def test_invalid_official_totals_fail_instead_of_becoming_zero(invalid):
    island, _land, raster = fixture()
    with pytest.raises(ValueError, match="finite and nonnegative"):
        allocate_island(island, invalid, 120, raster)
