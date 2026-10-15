from pathlib import Path

from fastapi.testclient import TestClient

from app.config.settings import Settings
from app.main import create_app
from app.routing.engine import RoutingRepository
from app.simulation.engine import ScenarioEngine
from app.simulation.models import Scenario, ScenarioOperation


def _engine(tmp_path: Path) -> ScenarioEngine:
    engine = ScenarioEngine(tmp_path, RoutingRepository(tmp_path))
    engine.routing.land = {
        "version": "routing-v1",
        "islands": {
            "island:1": {
                "nodes": [
                    {"id": "n1", "coordinates": [73.0, 3.0]},
                    {"id": "n2", "coordinates": [73.001, 3.0]},
                ],
                "edges": [
                    {
                        "id": "road:1",
                        "from_id": "n1",
                        "to_id": "n2",
                        "distance_m": 100,
                        "permissions": {"walk": True},
                    }
                ],
            }
        },
    }
    engine.routing.marine = {
        "version": "routing-v1",
        "nodes": [
            {"id": "m1", "coordinates": [73.0, 3.0]},
            {"id": "m2", "coordinates": [73.1, 3.0]},
        ],
        "edges": [],
    }
    engine.routing.air = {"nodes": [], "edges": []}
    engine.transport_features = []
    return engine


def test_scenario_road_closure_does_not_mutate_baseline(tmp_path: Path) -> None:
    engine = _engine(tmp_path)
    scenario = Scenario(
        id="closure",
        name="Close road",
        operations=[ScenarioOperation(type="road_closure", target_id="road:1")],
    )

    result = engine.run(scenario)

    assert result["effective_world"]["land_edge_count"] == 0
    assert result["baseline"]["land_edge_count"] == 1
    assert len(engine.routing.land["islands"]["island:1"]["edges"]) == 1


def test_scenario_adds_verified_route_only_in_effective_world(tmp_path: Path) -> None:
    engine = _engine(tmp_path)
    scenario = Scenario(
        id="route",
        name="Add ferry",
        operations=[
            ScenarioOperation(
                type="add_ferry_route",
                from_node_id="m1",
                to_node_id="m2",
                passenger_eligible=True,
            )
        ],
    )

    result = engine.run(scenario)

    assert result["effective_world"]["marine_edge_count"] == 2
    assert result["baseline"]["marine_edge_count"] == 0
    assert len(engine.routing.marine["edges"]) == 0


def test_scenario_compare_returns_independent_deltas(tmp_path: Path) -> None:
    engine = _engine(tmp_path)
    first = Scenario(
        id="first",
        name="Close road",
        operations=[ScenarioOperation(type="road_closure", target_id="road:1")],
    )
    second = Scenario(id="second", name="Baseline")

    result = engine.compare(first, second)

    assert result["first"]["effective_world"]["land_edge_count"] == 0
    assert result["second"]["effective_world"]["land_edge_count"] == 1
    assert result["delta"]["first_vs_second_land_edges"] == -1


def test_scenario_session_supports_undo_redo_reset_and_clone(tmp_path: Path) -> None:
    engine = _engine(tmp_path)
    session = engine.new_session()
    operation = ScenarioOperation(
        type="add_bus_stop",
        island_id="island:1",
        coordinates=(73.0, 3.0),
    )

    assert session.apply(operation)["applied"] is True
    clone = session.clone()
    assert len(clone.world["transport_features"]) == 1
    assert session.undo() is True
    assert len(session.world["transport_features"]) == 0
    assert session.redo() is True
    assert len(session.world["transport_features"]) == 1
    session.reset()
    assert len(session.world["transport_features"]) == 0
    assert len(clone.world["transport_features"]) == 1


def test_island_scope_keeps_baseline_and_effective_counts_comparable(tmp_path: Path) -> None:
    engine = _engine(tmp_path)
    scenario = Scenario(
        id="closure",
        name="Close road",
        operations=[ScenarioOperation(type="road_closure", target_id="road:1")],
    )

    result = engine.run(scenario, island_id="island:1")

    assert result["baseline"]["land_edge_count"] == 1
    assert result["effective_world"]["land_edge_count"] == 0
    assert result["delta"]["land_edge_count"] == -1


def test_scope_without_land_graph_keeps_empty_baseline_counts(tmp_path: Path) -> None:
    engine = _engine(tmp_path)

    result = engine.run(Scenario(id="baseline", name="Baseline"), island_id="island:2")

    assert result["baseline"]["land_island_count"] == 0
    assert result["effective_world"]["land_island_count"] == 0


def test_simulation_api_accepts_serializable_scenario(tmp_path: Path) -> None:
    client = TestClient(create_app(Settings(environment="test", data_dir=tmp_path)))

    with client:
        response = client.post(
            "/api/v1/simulation/run",
            json={
                "scenario": {
                    "id": "bus-stop-1",
                    "name": "Add bus stop",
                    "operations": [
                        {
                            "type": "add_bus_stop",
                            "island_id": "island:1",
                            "coordinates": [73.0, 3.0],
                        }
                    ],
                }
            },
        )

    assert response.status_code == 200
    assert response.json()["effective_world"]["transport_feature_count"] == 1
