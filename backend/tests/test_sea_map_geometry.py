"""Sea connections draw bounded water corridors only between identified ports."""

import copy
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from shapely.geometry import LineString, box, mapping, shape

from app.planning.sea import SeaConnectionsRequest, SeaConnectionsService
from app.planning.water_corridor import CORRIDOR_SOURCE, WaterCorridorPlanner


def feature(identity, polygon):
    return {"properties": {"id": identity}, "geometry": mapping(polygon)}


def service(tmp_path, islands, terminals):
    catalogue = {item["id"]: item for item in terminals}

    def island(identity):
        return {
            "id": identity,
            "name": identity,
            "coordinates": list(shape(islands[identity]["geometry"]).centroid.coords[0]),
        }

    transport = SimpleNamespace(
        planning=SimpleNamespace(repository=SimpleNamespace(public_dir=tmp_path)),
        repository=SimpleNamespace(islands_by_id=islands),
        terminals=catalogue,
        water_corridors=WaterCorridorPlanner(islands),
        island=island,
    )
    return SeaConnectionsService(transport)


def terminal(number, coordinates):
    return {
        "id": f"terminal:{number}",
        "name": f"Port {number}",
        "island_id": f"island:{number}",
        "coordinates": coordinates,
        "source": "Official terminal catalogue",
        "evidence": "official_terminal_catalogue",
    }


def timed_route(sea, identity, terminals):
    stops = [
        sea._stop(
            {"island_id": item["island_id"], "terminal_id": item["id"]}, identity, index
        )
        for index, item in enumerate(terminals)
    ]
    return sea._finish_route(
        {
            "id": identity,
            "name": identity,
            "operator": "RTL",
            "evidence": "dated_service",
            "proposed": False,
            "source_ids": ["official"],
            "network_verified": True,
            "qualifications": [],
            "stops": stops,
            "published_departures": [490],
            "_trips": [
                {
                    "id": identity + ":trip",
                    "calls": [
                        {
                            **stop,
                            "arrival_minutes": 490 + 20 * index,
                            "departure_minutes": 490 + 20 * index,
                        }
                        for index, stop in enumerate(stops)
                    ],
                }
            ],
        }
    )


@pytest.fixture
def crossing(tmp_path):
    islands = {
        "island:1": feature("island:1", box(73.499, 4.199, 73.501, 4.201)),
        "island:2": feature("island:2", box(73.519, 4.199, 73.521, 4.201)),
        "island:3": feature("island:3", box(73.508, 4.198, 73.512, 4.202)),
        "island:4": feature("island:4", box(73.539, 4.199, 73.541, 4.201)),
        "island:5": feature("island:5", box(73.559, 4.199, 73.561, 4.201)),
    }
    ports = [
        terminal(i, [longitude, 4.2])
        for i, longitude in ((1, 73.5), (2, 73.52), (4, 73.54), (5, 73.56))
    ]
    return service(tmp_path, islands, ports), ports


def test_hulhumale_male_map_connection_avoids_airport_and_keeps_source_ports(tmp_path):
    path = Path(__file__).resolve().parents[1] / "data/cache/normalized/islands.geojson"
    islands = {
        item["properties"]["id"]: item
        for item in json.loads(path.read_text(encoding="utf8"))["features"]
    }
    ports = [
        terminal(1442, [73.5372467, 4.21700524]),
        terminal(1443, [73.5170283, 4.1779411]),
    ]
    sea = service(tmp_path, islands, ports)
    route = timed_route(sea, "capital-ferry", ports)
    airport = shape(islands["island:1483"]["geometry"])
    assert LineString([item["coordinates"] for item in ports]).intersects(airport)

    sea._map_geometry(route)

    assert route["geometry"]["type"] == "LineString"
    points = route["geometry"]["coordinates"]
    assert points[0] == ports[0]["coordinates"]
    assert points[-1] == ports[-1]["coordinates"]
    assert not LineString(points).intersects(airport)
    assert route["geometry_basis"] == CORRIDOR_SOURCE


@pytest.mark.parametrize("invalid", ["missing", "unmatched", "foreign_island"])
def test_missing_or_wrong_port_never_draws_an_island_centroid_connection(crossing, invalid):
    sea, ports = crossing
    route = timed_route(sea, "port-evidence", ports[:2])
    raw = {"island_id": "island:2", "name": "Published island stop"}
    if invalid == "unmatched":
        raw["terminal_id"] = "terminal:unknown"
    elif invalid == "foreign_island":
        raw["terminal_id"] = ports[0]["id"]
    route["stops"][1] = sea._stop(raw, route["id"], 1)
    # A stale chord supplied by a source or a previous UI must not bypass the
    # requirement for two matched terminal identities.
    route["geometry"] = {
        "type": "LineString",
        "coordinates": [ports[0]["coordinates"], sea._island("island:2")["coordinates"]],
    }

    sea._map_geometry(route)

    assert route["stops"][1]["coordinates"] is None
    assert route["geometry"] is None
    assert route["geometry_basis"] == "missing_terminal"


def test_multistop_route_joins_each_safe_leg_at_its_actual_port(crossing):
    sea, ports = crossing
    chosen = ports[:3]
    route = timed_route(sea, "through-ferry", chosen)
    expected = []
    for first, second in zip(chosen, chosen[1:]):
        leg = sea.transport.water_corridors.corridor(first, second)
        assert leg is not None
        expected.extend(leg["geometry"][1:] if expected else leg["geometry"])

    sea._map_geometry(route)

    assert route["geometry"]["coordinates"] == expected
    assert expected.count(chosen[1]["coordinates"]) == 1
    assert not LineString(expected).intersects(
        shape(sea.transport.repository.islands_by_id["island:3"]["geometry"])
    )


def test_stale_stop_coordinates_cannot_impersonate_a_catalogue_port(crossing):
    sea, ports = crossing
    route = timed_route(sea, "stale-position", ports[:2])
    route["stops"][1]["coordinates"] = [73.515, 4.2]

    sea._map_geometry(route)

    assert route["geometry"] is None
    assert route["geometry_basis"] == "missing_terminal"


def test_unsafe_inland_port_does_not_fall_back_to_an_existing_chord(crossing):
    sea, ports = crossing
    sea.transport.repository.islands_by_id["island:1"] = feature(
        "island:1", box(73.49, 4.19, 73.505, 4.21)
    )
    route = timed_route(sea, "inland-port", ports[:2])
    route["geometry"] = {
        "type": "LineString",
        "coordinates": [item["coordinates"] for item in ports[:2]],
    }

    sea._map_geometry(route)

    assert route["geometry"] is None
    assert route["geometry_basis"] == "water_corridor_unavailable"


def test_one_unavailable_multistop_leg_never_bridges_over_missing_geometry(crossing, monkeypatch):
    sea, ports = crossing
    route = timed_route(sea, "through-ferry", ports[:3])
    planner = sea.transport.water_corridors
    original = planner.corridor

    def fail_second(first, second):
        return None if first["id"] == ports[1]["id"] else original(first, second)

    monkeypatch.setattr(planner, "corridor", fail_second)
    sea._map_geometry(route)

    assert route["geometry"] is None
    assert route["geometry_basis"] == "water_corridor_unavailable"
    assert route["crossing_minutes"] == 40
    assert route["departure_count"] == 1
    assert route["evidence"] == "dated_service"


def test_unavailable_geometry_retains_timed_connectivity_without_a_route_feature(crossing):
    sea, ports = crossing
    route = timed_route(sea, "timetable-without-safe-map", ports[:2])
    sea.transport.repository.islands_by_id["island:3"].pop("geometry")
    result = sea._view(
        [route],
        SeaConnectionsRequest(
            origin_island_id="island:1", date="2026-10-17", departure_minutes=480
        ),
    )

    destination = result["destinations"][0]
    assert destination["id"] == "island:2"
    assert destination["status"] == "direct"
    assert destination["within_budget"]
    assert destination["journey"]["total_minutes"] == 30
    assert result["routes"][0]["evidence"] == "dated_service"
    assert result["routes"][0]["published_departures"] == [490]
    assert result["routes"][0]["geometry"] is None
    assert all(
        item["properties"]["kind"] != "sea_route"
        for item in result["map_features"]["features"]
    )


def test_only_visible_connected_routes_build_water_geometry(crossing, monkeypatch):
    sea, ports = crossing
    visible = timed_route(sea, "selected-component", ports[:2])
    other = timed_route(sea, "unrelated-component", ports[2:])
    called = []
    original = sea._map_geometry

    def record(route):
        called.append(route["id"])
        original(route)

    monkeypatch.setattr(sea, "_map_geometry", record)
    result = sea._view(
        [visible, copy.deepcopy(other)],
        SeaConnectionsRequest(origin_island_id="island:1", date="2026-10-17"),
    )

    assert called == ["selected-component"]
    assert len(result["routes"]) == 1
    feature = next(
        item
        for item in result["map_features"]["features"]
        if item["properties"]["kind"] == "sea_route"
    )
    assert feature["properties"]["geometry_basis"] == CORRIDOR_SOURCE


def prepared_artifact(sea, ports, corridor):
    return {
        "schema_version": 1,
        "corridor_model_version": 1,
        "shoreline_fingerprint": sea._geometry_fingerprint(),
        "segments": [
            {
                "first": {
                    "island_id": ports[0]["island_id"],
                    "coordinates": ports[0]["coordinates"],
                },
                "second": {
                    "island_id": ports[1]["island_id"],
                    "coordinates": ports[1]["coordinates"],
                },
                "corridor": corridor,
            }
        ],
    }


def test_matching_prepared_corridor_is_reused_in_both_port_directions(crossing, monkeypatch):
    sea, ports = crossing
    corridor = sea.transport.water_corridors.corridor(*ports[:2])
    assert corridor is not None
    sea.path.with_name("sea-corridors.json").write_text(
        json.dumps(prepared_artifact(sea, ports, corridor)), "utf8"
    )

    def must_not_recompute(*args):
        pytest.fail("Identical prepared port pair should not rebuild its visibility graph")

    monkeypatch.setattr(sea.transport.water_corridors, "corridor", must_not_recompute)
    outward = timed_route(sea, "outward", ports[:2])
    inward = timed_route(sea, "inward", list(reversed(ports[:2])))

    sea._map_geometry(outward)
    sea._map_geometry(inward)

    assert outward["geometry"]["coordinates"] == corridor["geometry"]
    assert inward["geometry"]["coordinates"] == list(reversed(corridor["geometry"]))


@pytest.mark.parametrize(
    "invalid", ["schema_version", "corridor_model_version", "shoreline_fingerprint"]
)
def test_stale_prepared_geometry_is_ignored_and_never_becomes_a_land_chord(crossing, invalid):
    sea, ports = crossing
    unsafe_chord = {
        "geometry": [item["coordinates"] for item in ports[:2]],
        "distance_m": 1,
        "geometry_source": CORRIDOR_SOURCE,
        "qualification": "stale geometry that must never be used",
    }
    prepared = prepared_artifact(sea, ports, unsafe_chord)
    prepared[invalid] = "outdated"
    sea.path.with_name("sea-corridors.json").write_text(json.dumps(prepared), "utf8")
    route = timed_route(sea, "current-shoreline", ports[:2])

    sea._map_geometry(route)

    assert route["geometry"] is not None
    assert route["geometry"]["coordinates"] != unsafe_chord["geometry"]
    assert not LineString(route["geometry"]["coordinates"]).intersects(
        shape(sea.transport.repository.islands_by_id["island:3"]["geometry"])
    )
