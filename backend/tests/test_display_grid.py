"""A display mesh must preserve source support and allocated resident totals."""

import copy
import json
import math
from collections import defaultdict
from pathlib import Path
from types import SimpleNamespace

import pytest
from shapely import affinity
from shapely.geometry import MultiPolygon, Polygon, box, mapping, shape
from shapely.ops import unary_union

from app.planning.display_grid import (
    HEX_RADIUS_M,
    METRES_PER_DEGREE,
    build_coverage_fill,
    build_display_grid,
    build_uncovered_land,
)
from app.planning.opportunities import OpportunityService
from app.planning.repository import PlanningRepository
from app.planning.service import PlanningService


def degrees(geometry):
    return affinity.affine_transform(
        geometry,
        [
            1 / (METRES_PER_DEGREE * math.cos(math.radians(4.17))),
            0,
            0,
            1 / METRES_PER_DEGREE,
            73.5,
            4.17,
        ],
    )


def origin(key, geometry, population=100):
    polygon = degrees(geometry)
    point = polygon.representative_point()
    return {
        "id": key,
        "islandId": "male",
        "lon": point.x,
        "lat": point.y,
        "geometry": mapping(polygon),
        "population2026": population,
        "population2030": population * 1.2,
    }


def mesh(origins):
    return build_display_grid(origins, scope="male", island_id="island:1443")


def geometries(grid):
    return [shape(feature["geometry"]) for feature in grid["features"]]


def origin_shares(grid):
    totals = defaultdict(float)
    for feature in grid["features"]:
        for contribution in feature["properties"]["contributions"]:
            assert 0 < contribution["share"] <= 1 + 1e-12
            totals[contribution["origin_id"]] += contribution["share"]
    return dict(totals)


def test_area_shares_conserve_every_source_origin_and_both_population_years():
    origins = [
        origin("west", box(0, 0, 100, 100), 100),
        origin("east", box(100, 0, 200, 100), 350),
    ]
    before = copy.deepcopy(origins)
    grid = mesh(origins)
    shares = origin_shares(grid)
    assert shares == pytest.approx({"west": 1, "east": 1}, abs=1e-10)
    for year in (2026, 2030):
        allocated = sum(row[f"population{year}"] * shares[row["id"]] for row in origins)
        assert allocated == pytest.approx(sum(row[f"population{year}"] for row in origins))
    assert origins == before


def test_support_is_covered_once_with_shared_edges_and_no_expansion():
    origins = [origin("area", box(-300, -300, 300, 300))]
    grid = mesh(origins)
    cells = geometries(grid)
    source = shape(origins[0]["geometry"])
    combined = unary_union(cells)
    assert all(cell.is_valid and cell.geom_type in {"Polygon", "MultiPolygon"} for cell in cells)
    assert combined.symmetric_difference(source).area < 1e-12
    assert abs(sum(cell.area for cell in cells) - combined.area) < 1e-12
    # Interior tessellation edges genuinely meet, rather than leaving decorative gutters.
    shared_pairs = sum(
        first.boundary.intersection(second.boundary).length > 1e-5
        for index, first in enumerate(cells)
        for second in cells[index + 1 :]
    )
    assert shared_pairs > len(cells)
    full_area = 3 * math.sqrt(3) / 2 * HEX_RADIUS_M**2
    local_scale = METRES_PER_DEGREE**2 * math.cos(math.radians(4.17))
    full_cells = [cell for cell in cells if abs(cell.area * local_scale - full_area) < 0.01]
    assert len(full_cells) > 10
    assert all(len(cell.exterior.coords) == 7 for cell in full_cells)


def test_source_holes_and_disconnected_footprints_survive_clipping():
    hole = box(-70, -70, 70, 70)
    ring = Polygon(box(-180, -180, 180, 180).exterior.coords, [hole.exterior.coords])
    disconnected = MultiPolygon([box(300, -10, 310, 10), box(325, -10, 335, 10)])
    origins = [origin("ring", ring), origin("parts", disconnected)]
    grid = mesh(origins)
    support = unary_union([shape(row["geometry"]) for row in origins])
    combined = unary_union(geometries(grid))
    assert combined.intersection(degrees(hole)).area < 1e-12
    assert combined.symmetric_difference(support).area < 1e-12
    assert any(feature["geometry"]["type"] == "MultiPolygon" for feature in grid["features"])
    assert origin_shares(grid) == pytest.approx({"ring": 1, "parts": 1}, abs=1e-10)


def test_island_display_cells_expand_fragmented_support_without_allocating_more_residents():
    origins = [origin("parts", MultiPolygon([box(-8, -8, 8, 8), box(35, -8, 45, 8)]))]
    before = copy.deepcopy(origins)
    land = degrees(box(-150, -150, 150, 150))
    source_grid = mesh(origins)
    display_grid = build_display_grid(
        origins, scope="island:1152", island_id="island:1152", display_boundary=mapping(land)
    )
    source_support = unary_union(geometries(source_grid))
    display_support = unary_union(geometries(display_grid))
    assert display_support.area > source_support.area * 5
    assert display_support.difference(land).area < 1e-12
    assert len(display_grid["features"]) == len(source_grid["features"])
    assert [row["properties"]["contributions"] for row in display_grid["features"]] == [
        row["properties"]["contributions"] for row in source_grid["features"]
    ]
    shares = origin_shares(display_grid)
    assert shares == pytest.approx({"parts": 1}, abs=1e-10)
    for year in (2026, 2030):
        assert sum(
            row[f"population{year}"] * shares[row["id"]] for row in origins
        ) == pytest.approx(sum(row[f"population{year}"] for row in origins))
    assert all(row["properties"]["contributions"] for row in display_grid["features"])
    assert origins == before
    uncovered = unary_union(
        geometries(build_uncovered_land(mapping(land), display_grid, island_id="island:1152"))
    )
    assert uncovered.intersection(display_support).area < 1e-12
    assert uncovered.union(display_support).symmetric_difference(land).area < 1e-12
    assert uncovered.area < land.difference(source_support).area


def test_uncovered_land_exactly_complements_display_cells_and_preserves_water_holes():
    water = box(-40, -40, 40, 40)
    land = degrees(Polygon(box(-200, -200, 200, 200).exterior.coords, [water.exterior.coords]))
    origins = [origin("west", box(-180, -100, -60, 100))]
    grid = mesh(origins)
    before = copy.deepcopy(grid)
    mask = build_uncovered_land(mapping(land), grid, island_id="island:1443")
    uncovered = unary_union(geometries(mask))
    displayed = unary_union(geometries(grid))
    assert uncovered.is_valid
    assert uncovered.intersection(displayed).area < 1e-12
    assert uncovered.intersection(degrees(water)).area < 1e-12
    assert uncovered.union(displayed).symmetric_difference(land).area < 1e-12
    assert mask["features"][0]["properties"] == {
        "id": "uncovered:island:1443",
        "island_id": "island:1443",
        "status": "no_spatial_estimate",
    }
    assert grid == before


def test_uncovered_land_without_cells_uses_only_valid_known_land():
    land = degrees(box(-200, -200, 200, 200))
    empty = {"type": "FeatureCollection", "features": []}
    mask = build_uncovered_land(mapping(land), empty, island_id="island:1483")
    assert unary_union(geometries(mask)).equals(land)
    invalid = Polygon([(0, 0), (1, 1), (1, 0), (0, 1), (0, 0)])
    for boundary in (None, mapping(invalid), {"type": "Polygon"}):
        assert build_uncovered_land(boundary, empty, island_id="unknown") == empty
    invalid_grid = {
        "type": "FeatureCollection",
        "features": [{"type": "Feature", "geometry": mapping(invalid), "properties": {}}],
    }
    assert build_uncovered_land(mapping(land), invalid_grid, island_id="unknown") == empty


def test_coverage_fill_interpolates_gap_colors_only_from_known_same_island_origins():
    origins = [origin("west", box(-10, -10, 10, 10)), origin("east", box(190, -10, 210, 10))]
    source = {"type": "FeatureCollection", "features": []}
    for row, value in zip(origins, (0.0, 1.0)):
        source["features"].append(
            {
                "type": "Feature",
                "geometry": row["geometry"],
                "properties": {
                    "island_id": "island:1443",
                    "coordinates": [row["lon"], row["lat"]],
                    "population": 100,
                    "health_gap": value,
                    "education_gap": None,
                    "transport_gap": 0.25,
                    "overall_gap": value,
                },
            }
        )
    foreign = copy.deepcopy(source["features"][0])
    foreign["properties"].update({"island_id": "island:other", "education_gap": 1})
    source["features"].append(foreign)
    grid = mesh(origins)
    before = copy.deepcopy((source, grid))
    land = degrees(box(-50, -50, 250, 50))
    fill = build_coverage_fill(mapping(land), grid, source, island_id="island:1443")
    assert fill["features"]
    projection = [METRES_PER_DEGREE * math.cos(math.radians(4.17)), 0, 0, METRES_PER_DEGREE, 0, 0]
    origin_points = [
        affinity.affine_transform(shape(row["geometry"]), projection).centroid for row in origins
    ]
    for feature in fill["features"]:
        properties = feature["properties"]
        point = affinity.affine_transform(
            shape(feature["geometry"]), projection
        ).representative_point()
        distances = [point.distance(known) ** 2 for known in origin_points]
        expected = (1 / distances[1]) / sum(1 / distance for distance in distances)
        assert properties["health_gap"] == pytest.approx(expected, abs=1e-7)
        assert properties["overall_gap"] == pytest.approx(expected, abs=1e-7)
        assert properties["transport_gap"] == pytest.approx(0.25)
        assert properties["education_gap"] is None
        assert properties["interpolated"] is True
        assert set(properties) == {
            "id",
            "island_id",
            "interpolated",
            "health_gap",
            "education_gap",
            "transport_gap",
            "overall_gap",
        }
    displayed = unary_union(geometries(grid))
    inferred = unary_union(geometries(fill))
    assert inferred.intersection(displayed).area < 1e-12
    assert inferred.union(displayed).symmetric_difference(land).area < 1e-12
    assert (source, grid) == before


def test_grid_ids_and_contributions_are_stable_when_input_order_changes():
    origins = [origin("b", box(0, 0, 100, 100)), origin("a", box(100, 0, 200, 100))]
    first, second = mesh(origins), mesh(list(reversed(origins)))
    assert first == second
    ids = [feature["id"] for feature in first["features"]]
    assert len(set(ids)) == len(ids)
    for feature in first["features"]:
        assert feature["id"].startswith("hex:male:")
        assert feature["properties"]["id"] == feature["id"]
        assert feature["properties"]["island_id"] == "island:1443"


@pytest.mark.parametrize(
    "origins",
    [
        [],
        [{"id": "missing"}],
        [{"id": "point", "geometry": {"type": "Point", "coordinates": [73.5, 4.17]}}],
    ],
)
def test_unsupported_footprints_do_not_gain_invented_hexagons(origins):
    assert mesh(origins) == {"type": "FeatureCollection", "features": []}


def test_detail_caches_mesh_by_scope_and_does_not_expose_mutable_cache(tmp_path, monkeypatch):
    origins = [origin("area", box(0, 0, 100, 100))]
    land = degrees(box(-100, -100, 200, 200))
    baseline = {
        "islands": [
            {"id": "male", "name": "Malé", "geometry": mapping(land)},
            {"id": "hulhule", "name": "Hulhulé", "geometry": mapping(land)},
        ],
        "origins": origins,
        "network": {"nodes": [], "edges": []},
        "facilities": [],
        "transit": {"stops": [], "patterns": []},
    }
    (tmp_path / "planning-baseline.json").write_text(json.dumps(baseline), encoding="utf8")
    service = OpportunityService(PlanningService(PlanningRepository(tmp_path)))
    calls = []
    fill_calls = []

    def counted(*args, **kwargs):
        calls.append(kwargs["scope"])
        return build_display_grid(*args, **kwargs)

    def counted_fill(*args, **kwargs):
        fill_calls.append(kwargs["island_id"])
        return build_coverage_fill(*args, **kwargs)

    monkeypatch.setattr("app.planning.opportunities.build_display_grid", counted)
    monkeypatch.setattr("app.planning.opportunities.build_coverage_fill", counted_fill)
    first = service.detail("island:1443")
    unchanged = copy.deepcopy(first["hex_grid"])
    unchanged_fill = copy.deepcopy(first["coverage_fill"])
    assert unchanged == mesh(origins)
    first["hex_grid"]["features"][0]["properties"]["contributions"][0]["share"] = 99
    first["coverage_fill"]["features"][0]["properties"]["interpolated"] = False
    second = service.detail("male")
    assert calls == ["male"]
    assert fill_calls == ["island:1443"]
    assert second["hex_grid"] == unchanged
    assert second["coverage_fill"] == unchanged_fill
    assert (
        second["gap_cells"]["features"][0]["geometry"]
        == service.repository.baseline["origins"][0]["geometry"]
    )
    unsupported = service.detail("island:1483")
    assert unsupported["hex_grid"]["features"] == []
    assert (
        unary_union(geometries(unsupported["coverage_fill"])).symmetric_difference(land).area
        < 1e-12
    )


def test_detail_coverage_fill_uses_normalized_coastline_without_changing_planning_mesh(
    tmp_path, monkeypatch
):
    origins = [origin("area", box(0, 0, 100, 100))]
    planning_land = degrees(box(-100, -100, 200, 200))
    mapped_land = degrees(box(-20, -20, 120, 120))
    baseline = {
        "islands": [{"id": "male", "name": "Malé", "geometry": mapping(planning_land)}],
        "origins": origins,
        "network": {"nodes": [], "edges": []},
        "facilities": [],
        "transit": {"stops": [], "patterns": []},
    }
    (tmp_path / "planning-baseline.json").write_text(json.dumps(baseline), encoding="utf8")
    service = OpportunityService(PlanningService(PlanningRepository(tmp_path)))
    overview = service.overview()
    monkeypatch.setattr(service, "overview", lambda: overview)
    service.accessibility = SimpleNamespace(
        islands={"island:1443": {"geometry": mapping(mapped_land)}}
    )
    detail = service.detail("male")
    displayed = unary_union(geometries(detail["hex_grid"]))
    uncovered = unary_union(geometries(detail["coverage_fill"]))
    assert uncovered.difference(mapped_land).is_empty
    assert uncovered.union(displayed).symmetric_difference(mapped_land).area < 1e-12
    assert uncovered.intersection(planning_land.difference(mapped_land)).area < 1e-12
    assert detail["hex_grid"] == mesh(origins)


def test_all_captured_islands_conserve_667_origins_in_a_compact_support_mesh():
    baseline = json.loads(
        (Path(__file__).resolve().parents[2] / "data/public/planning-baseline.json").read_text(
            encoding="utf8"
        )
    )
    total_hexes = 0
    total_origins = 0
    for scope in ("male", "vilimale", "hulhumale"):
        origins = [row for row in baseline["origins"] if row["islandId"] == scope]
        grid = build_display_grid(origins, scope=scope, island_id=scope)
        total_hexes += len(grid["features"])
        total_origins += len(origins)
        assert origin_shares(grid) == pytest.approx({row["id"]: 1 for row in origins}, abs=1e-9)
        cells = geometries(grid)
        combined = unary_union(cells)
        support = unary_union([shape(row["geometry"]) for row in origins])
        assert combined.symmetric_difference(support).area < 1e-11
        assert abs(sum(cell.area for cell in cells) - combined.area) < 1e-11
    assert total_origins == 667
    assert total_hexes < 1000
