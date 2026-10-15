from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.accessibility.service import AccessibilityService
from app.config.settings import Settings
from app.main import create_app
from app.recommendation.models import RecommendationConfig
from app.recommendation.service import RecommendationService
from app.routing.engine import RoutingRepository
from app.simulation.engine import ScenarioEngine


def _service(tmp_path: Path) -> RecommendationService:
    routing = RoutingRepository(tmp_path)
    routing.land = {
        "version": "routing-v1",
        "islands": {
            "island:1": {
                "nodes": [
                    {"id": "n1", "coordinates": [73.0, 3.0]},
                    {"id": "n2", "coordinates": [73.001, 3.0]},
                ],
                "edges": [],
            }
        },
    }
    routing.marine = {
        "version": "routing-v1",
        "nodes": [
            {"id": "m1", "coordinates": [73.0, 3.0], "island_id": "island:1", "category": "pier"},
            {"id": "m2", "coordinates": [73.1, 3.0], "island_id": "island:2", "category": "pier"},
        ],
        "edges": [],
    }
    routing.air = {"nodes": [], "edges": []}
    simulation = ScenarioEngine(tmp_path, routing)
    accessibility = AccessibilityService(tmp_path, routing)
    service = RecommendationService(tmp_path, simulation, accessibility)
    service.islands = {
        "island:1": {"properties": {"id": "island:1", "name": "One", "centroid": [73.0, 3.0]}},
        "island:2": {"properties": {"id": "island:2", "name": "Two", "centroid": [73.1, 3.0]}},
    }
    service.facilities = []
    service.transport = []
    service.baseline_scores = {
        island_id: {
            "island_id": island_id,
            "score": 10.0,
            "confidence": 0.8,
            "domains": {"transport": {"components": {"bus": 0.0, "ferry": 0.0}}},
        }
        for island_id in service.islands
    }
    return service


def test_recommendation_simulates_and_ranks_bus_stop(tmp_path: Path) -> None:
    result = _service(tmp_path).recommend("bus_stop", island_id="island:1", limit=1)

    assert result["summary"]["returned_count"] == 1
    recommendation = result["recommendations"][0]
    assert recommendation["type"] == "bus_stop"
    assert recommendation["simulation"]["delta"]["transport_feature_count"] == 1
    assert recommendation["expected_benefit"] == 100.0
    assert recommendation["planning_screening_disclaimer"]


def test_recommendation_route_uses_two_marine_endpoints(tmp_path: Path) -> None:
    result = _service(tmp_path).recommend("ferry_route", limit=1)

    recommendation = result["recommendations"][0]
    operation = recommendation["scenario"]["operations"][0]
    assert operation["type"] == "add_ferry_route"
    assert {operation["from_node_id"], operation["to_node_id"]} == {"m1", "m2"}
    assert recommendation["simulation"]["delta"]["marine_edge_count"] == 2


def test_recommendation_ranking_weights_are_configurable(tmp_path: Path) -> None:
    config = RecommendationConfig(benefit_weight=0.5, confidence_weight=0.5)
    result = _service(tmp_path).recommend(
        "bus_stop", island_id="island:1", limit=1, config=config
    )

    assert result["config"]["benefit_weight"] == pytest.approx(0.5)
    assert result["recommendations"][0]["score"] == pytest.approx(90.0)


def test_recommendation_api_rejects_unknown_island(tmp_path: Path) -> None:
    client = TestClient(create_app(Settings(environment="test", data_dir=tmp_path)))

    with client:
        response = client.post(
            "/api/v1/recommendations",
            json={"type": "bus_stop", "island_id": "island:missing"},
        )

    assert response.status_code == 404
