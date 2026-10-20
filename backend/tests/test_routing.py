from pathlib import Path

from fastapi.testclient import TestClient

from app.config.settings import Settings
from app.data.cache import FileCache
from app.main import create_app
from app.routing.engine import RoutingRepository, _nearest_node, _NodeIndex


def _write_graphs(data_dir: Path) -> None:
    cache = FileCache(data_dir / "cache")
    cache.write_json(
        "graphs/land.json",
        {
            "version": "routing-v1",
            "islands": {
                "island:1": {
                    "nodes": [
                        {"id": "n1", "coordinates": [73.0, 3.0]},
                        {"id": "n2", "coordinates": [73.001, 3.0]},
                        {"id": "n3", "coordinates": [73.002, 3.0]},
                    ],
                    "edges": [
                        {
                            "id": "e1",
                            "from_id": "n1",
                            "to_id": "n2",
                            "distance_m": 100,
                            "geometry": [[73.0, 3.0], [73.001, 3.0]],
                            "permissions": {"walk": True, "car": True},
                        },
                        {
                            "id": "e2",
                            "from_id": "n2",
                            "to_id": "n3",
                            "distance_m": 100,
                            "geometry": [[73.001, 3.0], [73.002, 3.0]],
                            "permissions": {"walk": True, "car": False},
                        },
                    ],
                }
            },
        },
        source="test",
        endpoint="test",
    )
    cache.write_json(
        "graphs/marine.json",
        {"version": "routing-v1", "nodes": [], "edges": []},
        source="test",
        endpoint="test",
    )
    cache.write_json(
        "graphs/air.json",
        {"version": "routing-v1", "nodes": [], "edges": []},
        source="test",
        endpoint="test",
    )


def test_land_routing_respects_mode_permissions(tmp_path: Path) -> None:
    _write_graphs(tmp_path)
    routing = RoutingRepository(tmp_path)
    routing.reload()

    walking = routing.route_land([73.0, 3.0], [73.002, 3.0], "walk", "island:1")
    driving = routing.route_land([73.0, 3.0], [73.002, 3.0], "car", "island:1")

    assert walking["status"] == "ok"
    assert walking["path_node_ids"] == ["n1", "n2", "n3"]
    assert driving == {
        "status": "unreachable",
        "reason": "no_connected_path",
        "island_id": "island:1",
    }


def test_land_routing_reports_missing_graph_as_unreachable(tmp_path: Path) -> None:
    _write_graphs(tmp_path)
    routing = RoutingRepository(tmp_path)
    routing.reload()

    result = routing.route_land([73.0, 3.0], [73.002, 3.0], "walk", "island:missing")

    assert result == {"status": "unreachable", "reason": "no_land_graph"}


def test_same_node_snapping_cannot_bypass_car_permissions(tmp_path: Path) -> None:
    _write_graphs(tmp_path)
    routing = RoutingRepository(tmp_path)
    routing.reload()
    # These distinct points both snap to n3, which only touches a walking edge.
    start, end = [73.002, 3.00001], [73.002, 3.00002]

    walking = routing.route_land(start, end, "walk", max_snap_m=250)
    driving = routing.route_land(start, end, "car", max_snap_m=250)

    assert walking["status"] == "ok"
    assert walking["distance_m"] > 0
    assert driving == {
        "status": "unreachable",
        "reason": "no_connected_path",
        "island_id": "island:1",
    }


def test_same_node_on_a_permitted_car_road_still_allows_a_short_route(tmp_path: Path) -> None:
    _write_graphs(tmp_path)
    routing = RoutingRepository(tmp_path)
    routing.reload()

    driving = routing.route_land([73, 3.00001], [73, 3.00002], "car", max_snap_m=250)

    assert driving["status"] == "ok"
    assert driving["path_node_ids"] == ["n1"]


def test_marine_routing_rejects_identical_unknown_nodes(tmp_path: Path) -> None:
    routing = RoutingRepository(tmp_path)
    routing.reload()

    result = routing.route_marine("missing", "missing")

    assert result == {"status": "unreachable", "reason": "marine_node_not_found"}


def test_spatial_candidates_preserve_exact_nearest_nodes_and_source_ties() -> None:
    nodes = {
        f"n{i}": {"id": f"n{i}", "coordinates": [73 + (i % 20) / 1000, 4 + (i // 20) / 1000]}
        for i in range(400)
    }
    nodes["duplicate"] = {"id": "duplicate", "coordinates": [73, 4]}
    index = _NodeIndex(list(nodes.values()))
    for point in ([73, 4], [73.0037, 4.0092], [72, 7], [179.999, -89], [-179.999, 4]):
        node_index, distance = index.nearest(tuple(point))
        expected_id, expected_distance = _nearest_node(nodes, point)
        assert index.nodes[node_index]["id"] == expected_id
        assert distance == expected_distance


def test_reloading_graphs_replaces_prepared_indexes(tmp_path: Path) -> None:
    _write_graphs(tmp_path)
    routing = RoutingRepository(tmp_path)
    routing.reload()
    assert routing.route_land([73, 3], [73.001, 3], "walk")["status"] == "ok"
    FileCache(tmp_path / "cache").write_json(
        "graphs/land.json", {"islands": {}}, source="test", endpoint="test"
    )
    routing.reload()
    assert routing.route_land([73, 3], [73.001, 3], "walk")["status"] == "unreachable"


def test_land_routing_api_returns_unreachable_contract(tmp_path: Path) -> None:
    _write_graphs(tmp_path)
    client = TestClient(create_app(Settings(environment="test", data_dir=tmp_path)))

    with client:
        response = client.post(
            "/api/v1/routing/land",
            json={
                "start": [73.0, 3.0],
                "end": [73.002, 3.0],
                "mode": "car",
                "island_id": "island:1",
            },
        )

    assert response.status_code == 200
    assert response.json() == {
        "status": "unreachable",
        "reason": "no_connected_path",
        "island_id": "island:1",
    }
