"""Source shorelines constrain proposed ferry paths without creating landings."""

import json
from pathlib import Path

import pytest
from shapely.geometry import LineString, box, mapping, shape

from app.data.computed_cache import ComputedCache
from app.planning.water_corridor import WaterCorridorPlanner
from app.routing.engine import _distance_m


def feature(identity, polygon):
    return {"properties": {"id": identity}, "geometry": mapping(polygon)}


@pytest.fixture
def crossing():
    islands = {
        "island:1": feature("island:1", box(73.499, 4.199, 73.501, 4.201)),
        "island:2": feature("island:2", box(73.519, 4.199, 73.521, 4.201)),
        "island:3": feature("island:3", box(73.508, 4.198, 73.512, 4.202)),
    }
    first = {"id": "terminal:1", "island_id": "island:1", "coordinates": [73.5, 4.2]}
    second = {"id": "terminal:2", "island_id": "island:2", "coordinates": [73.52, 4.2]}
    return islands, first, second


def test_corridor_avoids_land_and_keeps_exact_source_terminals(crossing, tmp_path, monkeypatch):
    islands, first, second = crossing
    computations = 0
    calculate = WaterCorridorPlanner._corridor

    def counted(planner, *args):
        nonlocal computations
        computations += 1
        return calculate(planner, *args)

    monkeypatch.setattr(WaterCorridorPlanner, "_corridor", counted)
    cache = ComputedCache(tmp_path)
    planner = WaterCorridorPlanner(islands)
    result = planner.corridor(first, second, cache=cache)
    assert result is not None
    # A new planner and cache instance exercise persistent rather than LRU reuse.
    assert result == WaterCorridorPlanner(islands).corridor(
        first, second, cache=ComputedCache(tmp_path)
    )
    assert computations == 1
    geometry = result["geometry"]
    assert geometry[0] == first["coordinates"]
    assert geometry[-1] == second["coordinates"]
    assert not LineString(geometry).intersects(shape(islands["island:3"]["geometry"]))
    assert result["distance_m"] > _distance_m(first["coordinates"], second["coordinates"])
    assert result["distance_m"] == sum(_distance_m(a, b) for a, b in zip(geometry, geometry[1:]))
    # Every water segment avoids the original endpoint land as well as the
    # third island. Only the bounded terminal shore approaches are exempt.
    water = LineString(geometry[1:-1])
    assert all(not water.intersects(shape(item["geometry"])) for item in islands.values())
    assert "not navigation clearance" in result["qualification"]

    # Both full terminal records invalidate the result, even when coordinates
    # remain unchanged. Service assumptions are deliberately not cached here.
    first["name"] = "Revised source terminal"
    assert planner.corridor(first, second, cache=cache) == result
    second["name"] = "Revised receiving terminal"
    assert planner.corridor(first, second, cache=cache) == result
    assert computations == 3

    # The same planner must revalidate an in-place change to an intervening
    # shoreline instead of using its previous loaded geometry or route LRU.
    islands["island:3"]["geometry"] = mapping(box(73.507, 4.197, 73.513, 4.203))
    changed = planner.corridor(first, second, cache=cache)
    assert changed is not None
    assert changed != result
    assert not LineString(changed["geometry"]).intersects(shape(islands["island:3"]["geometry"]))
    assert computations == 4

    monkeypatch.setattr("app.planning.water_corridor.MAX_VERTICES", 3)
    assert planner.corridor(first, second, cache=cache) is None
    assert computations == 5
    monkeypatch.setattr("app.planning.water_corridor.CORRIDOR_MODEL_VERSION", 999)
    assert planner.corridor(first, second, cache=cache) is None
    assert computations == 6


def test_exact_airport_crossing_uses_actual_national_polygons():
    path = Path(__file__).resolve().parents[1] / "data/cache/normalized/islands.geojson"
    features = json.loads(path.read_text(encoding="utf8"))["features"]
    islands = {item["properties"]["id"]: item for item in features}
    first = {"island_id": "island:1442", "coordinates": [73.5372467, 4.21700524]}
    second = {"island_id": "island:1443", "coordinates": [73.5170283, 4.1779411]}
    airport = shape(islands["island:1483"]["geometry"])
    assert LineString([first["coordinates"], second["coordinates"]]).intersects(airport)
    corridor = WaterCorridorPlanner(islands).corridor(first, second)
    assert corridor is not None
    assert not LineString(corridor["geometry"]).intersects(airport)
    assert 5_000 < corridor["distance_m"] < 8_000


@pytest.mark.parametrize(
    "first,second",
    [
        (
            {"island_id": "island:1075", "coordinates": [73.027272, 5.667634]},
            {"island_id": "island:945", "coordinates": [73.4136, 5.76687]},
        ),
        (
            {"island_id": "island:470", "coordinates": [72.997885, 0.525797]},
            {"island_id": "island:510", "coordinates": [73.272506, 0.23194]},
        ),
    ],
)
def test_dense_atoll_crossings_keep_every_shoreline_obstacle(first, second):
    path = Path(__file__).resolve().parents[1] / "data/cache/normalized/islands.geojson"
    features = json.loads(path.read_text(encoding="utf8"))["features"]
    islands = {item["properties"]["id"]: item for item in features}
    corridor = WaterCorridorPlanner(islands).corridor(first, second)

    assert corridor is not None
    coordinates = corridor["geometry"]
    assert coordinates[0] == first["coordinates"]
    assert coordinates[-1] == second["coordinates"]
    assert 44_000 < corridor["distance_m"] < 47_000
    water = LineString(coordinates[1:-1])
    assert all(not water.intersects(shape(item["geometry"])) for item in islands.values())
    for port, approach in (
        (first, LineString(coordinates[:2])),
        (second, LineString(coordinates[-2:])),
    ):
        assert all(
            identity == port["island_id"] or not approach.intersects(shape(item["geometry"]))
            for identity, item in islands.items()
        )


def test_missing_shoreline_cannot_establish_water_route(crossing):
    islands, first, second = crossing
    islands["island:3"].pop("geometry")
    assert WaterCorridorPlanner(islands).corridor(first, second) is None


def test_graph_cap_never_drops_obstacle_or_falls_back_to_chord(crossing, monkeypatch):
    islands, first, second = crossing
    monkeypatch.setattr("app.planning.water_corridor.MAX_VERTICES", 3)
    assert WaterCorridorPlanner(islands).corridor(first, second) is None


def test_deep_inland_or_foreign_island_terminal_is_not_relocated(crossing):
    islands, first, second = crossing
    islands["island:1"] = feature("island:1", box(73.49, 4.19, 73.505, 4.21))
    assert WaterCorridorPlanner(islands).corridor(first, second) is None
    islands, first, second = crossing
    foreign = {**first, "coordinates": [73.51, 4.2]}
    assert WaterCorridorPlanner(islands).corridor(foreign, second) is None


def test_offshore_terminal_and_boundary_terminal_remain_exact(crossing):
    islands, first, second = crossing
    offshore = {**first, "coordinates": [73.502, 4.2]}
    boundary = {**second, "coordinates": [73.519, 4.2]}
    result = WaterCorridorPlanner(islands).corridor(offshore, boundary)
    assert result is not None
    assert result["geometry"][0] == offshore["coordinates"]
    assert result["geometry"][-1] == boundary["coordinates"]
