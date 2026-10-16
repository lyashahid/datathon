"""A display mesh must preserve source support and allocated resident totals."""

import copy
import json
import math
from collections import defaultdict
from pathlib import Path

import pytest
from shapely import affinity
from shapely.geometry import MultiPolygon, Polygon, box, mapping, shape
from shapely.ops import unary_union

from app.planning.display_grid import HEX_RADIUS_M, METRES_PER_DEGREE, build_display_grid
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
    baseline = {
        "islands": [
            {"id": "male", "name": "Malé", "geometry": origins[0]["geometry"]},
            {"id": "hulhule", "name": "Hulhulé", "geometry": origins[0]["geometry"]},
        ],
        "origins": origins,
        "network": {"nodes": [], "edges": []},
        "facilities": [],
        "transit": {"stops": [], "patterns": []},
    }
    (tmp_path / "planning-baseline.json").write_text(json.dumps(baseline), encoding="utf8")
    service = OpportunityService(PlanningService(PlanningRepository(tmp_path)))
    calls = []

    def counted(*args, **kwargs):
        calls.append(kwargs["scope"])
        return build_display_grid(*args, **kwargs)

    monkeypatch.setattr("app.planning.opportunities.build_display_grid", counted)
    first = service.detail("island:1443")
    unchanged = copy.deepcopy(first["hex_grid"])
    assert unchanged == mesh(origins)
    first["hex_grid"]["features"][0]["properties"]["contributions"][0]["share"] = 99
    second = service.detail("male")
    assert calls == ["male"]
    assert second["hex_grid"] == unchanged
    assert (
        second["gap_cells"]["features"][0]["geometry"]
        == service.repository.baseline["origins"][0]["geometry"]
    )
    assert service.detail("island:1483")["hex_grid"]["features"] == []


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
