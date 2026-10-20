"""Ordered directions preserve missing routes and dated arrival dependencies."""

from datetime import date
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes.routing import router
from app.data.computed_cache import ComputedCache
from app.planning.models import PlanningAssumptions
from app.planning.repository import PlanningRepository
from app.planning.routing import JourneyRouter
from app.routing import multistop
from app.routing.engine import RoutingRepository, _adjacency
from app.routing.journeys import prepare_journeys, route_journey


@pytest.fixture
def routing(tmp_path: Path) -> RoutingRepository:
    repository = RoutingRepository(tmp_path)
    edges = [
        {
            "id": f"edge:{index}",
            "from_id": f"node:{index}",
            "to_id": f"node:{index + 1}",
            "distance_m": 100,
            "geometry": [[73 + index / 1000, 3], [73 + (index + 1) / 1000, 3]],
            "permissions": {"walk": True, "bicycle": True, "car": index == 0},
        }
        for index in range(2)
    ]
    repository.land = {
        "version": "test-directions",
        "islands": {
            "island:1": {
                "nodes": [
                    {"id": f"node:{index}", "coordinates": [73 + index / 1000, 3]}
                    for index in range(3)
                ],
                "edges": edges,
            },
            "island:2": {
                "nodes": [{"id": "other-island", "coordinates": [73.1, 3]}],
                "edges": [],
            },
        },
    }
    repository._land_adjacency = {"island:1": _adjacency(edges), "island:2": {}}
    return repository


@pytest.fixture
def planning():
    return SimpleNamespace(baseline={"referenceDate": "2026-10-10"})


@pytest.fixture
def client(routing, planning):
    app = FastAPI()
    app.state.routing = routing
    app.state.planning = SimpleNamespace(repository=planning)
    app.include_router(router)
    return TestClient(app)


@pytest.mark.parametrize("mode", ["walk", "bicycle"])
def test_all_mandatory_stops_are_routed_in_order_without_inventing_road_time(client, mode):
    points = [[73, 3], [73.001, 3], [73.002, 3]]
    response = client.post("/api/v1/routing/journey", json={"points": points, "mode": mode})
    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "ok"
    assert result["points"] == points
    assert [(s["start"], s["end"]) for s in result["segments"]] == list(zip(points, points[1:]))
    assert result["distance_m"] == 200
    assert result["minutes"] is None
    assert result["arrival_minutes"] is None
    assert all(segment["result"]["mode"] == mode for segment in result["segments"])
    assert all(segment["minutes"] is None for segment in result["segments"])


def test_partial_car_route_keeps_permission_failure_and_never_claims_a_total(client):
    result = client.post(
        "/api/v1/routing/journey",
        json={"points": [[73, 3], [73.001, 3], [73.002, 3]], "mode": "car"},
    ).json()
    assert result["status"] == "partial"
    assert [segment["status"] for segment in result["segments"]] == ["ok", "unreachable"]
    assert result["segments"][1]["reason"] == "no_connected_path"
    assert "geometry" not in result["segments"][1]["result"]
    assert result["known_distance_m"] == 100
    assert result["distance_m"] is None
    assert result["minutes"] is None


def test_cross_water_points_do_not_force_one_island_graph(client):
    result = client.post(
        "/api/v1/routing/journey",
        json={"points": [[73, 3], [73.1, 3]], "mode": "walk"},
    ).json()
    assert result["status"] == "unreachable"
    assert result["reason"] == "different_islands"
    assert result["segments"][0]["result"] == {
        "status": "unreachable",
        "reason": "different_islands",
    }
    assert result["distance_m"] is None


def test_remote_points_cannot_snap_to_a_distant_land_network(client):
    result = client.post(
        "/api/v1/routing/journey",
        json={"points": [[73, 3.02], [73.001, 3.02]], "mode": "car"},
    ).json()
    assert result["status"] == "unreachable"
    assert result["reason"] == "no_nearby_land_node"
    assert result["known_distance_m"] == 0
    assert result["segments"][0]["distance_m"] is None


def test_each_transit_leg_departs_after_previous_arrival_and_rolls_service_date(
    routing, planning, monkeypatch
):
    calls = []

    def dated_route(repository, start, end, service_date, departure):
        calls.append((start, end, service_date, departure))
        duration = 15 if len(calls) == 1 else 20
        return {
            "status": "ok",
            "mode": "transit",
            "geometry": [],
            "distance_m": 100 if len(calls) == 1 else None,
            "journey": {
                "minutes": duration,
                "arrival_minutes": departure + duration,
                "warnings": ["Dated timetable evidence."],
                "legs": [{"mode": "bus", "geometry": []}],
            },
        }

    monkeypatch.setattr(multistop, "route_journey", dated_route)
    points = [[73, 3], [73.001, 3], [73.002, 3]]
    result = multistop.route_multistop(
        routing, planning, points, "transit", date(2026, 10, 10), 1435
    )
    assert calls == [
        (points[0], points[1], date(2026, 10, 10), 1435),
        (points[1], points[2], date(2026, 10, 11), 10),
    ]
    assert result["status"] == "ok"
    assert result["minutes"] == 35
    assert result["arrival_minutes"] == 1470
    assert result["segments"][1]["service_date"] == "2026-10-11"
    assert result["segments"][1]["departure_minutes"] == 10
    assert result["known_distance_m"] == 100
    assert result["distance_m"] is None
    assert result["warnings"] == ["Dated timetable evidence."]
    assert all(s["result"]["geometry"] == [] for s in result["segments"])


def test_missing_transit_leg_does_not_schedule_later_stops_from_a_fictional_arrival(
    routing, planning, monkeypatch
):
    calls = []

    def dated_route(repository, start, end, service_date, departure):
        calls.append(departure)
        return (
            {
                "status": "ok",
                "distance_m": 50,
                "journey": {"minutes": 10, "arrival_minutes": departure + 10},
            }
            if len(calls) == 1
            else {
                "status": "unreachable",
                "reason": "no_supported_transit_journey",
                "journey": {"reason": "No verified crossing.", "minutes": None},
            }
        )

    monkeypatch.setattr(multistop, "route_journey", dated_route)
    result = multistop.route_multistop(
        routing, planning, [[73, 3], [73.001, 3], [73.002, 3], [73.1, 3]], "transit"
    )
    assert calls == [920, 930]
    assert [s["status"] for s in result["segments"]] == ["ok", "unreachable", "skipped"]
    assert result["status"] == "partial"
    assert result["reason"] == "No verified crossing."
    assert result["minutes"] is None
    assert result["arrival_minutes"] is None
    assert result["known_minutes"] == 10
    assert result["segments"][2]["result"] is None
    assert result["segments"][2]["departure_minutes"] is None


def test_real_cross_island_bus_journey_continues_through_a_mandatory_stop(routing):
    repository = PlanningRepository(Path(__file__).resolve().parents[2] / "data/public")
    points = [
        [73.504676, 4.169366],  # Maafannu Bus Terminal, Malé
        [73.543088, 4.211553],  # Mandatory stop in Hulhumalé
        [73.540352, 4.21442],
    ]
    result = multistop.route_multistop(
        routing, repository, points, "transit", date(2026, 10, 10), 920
    )
    assert result["status"] == "ok"
    assert len(result["segments"]) == 2
    first, second = result["segments"]
    assert first["result"]["journey"]["uses_transit"]
    assert any(leg["mode"] == "bus" for leg in first["result"]["journey"]["legs"])
    assert first["end"] == second["start"] == points[1]
    assert second["departure_minutes"] == pytest.approx(first["arrival_minutes"], abs=0.002)
    assert result["minutes"] == pytest.approx(first["minutes"] + second["minutes"], abs=0.002)
    assert result["arrival_minutes"] == pytest.approx(920 + result["minutes"], abs=0.002)


def test_prepared_directions_reuse_day_indexes_but_invalidate_source_edits():
    repository = PlanningRepository(Path(__file__).resolve().parents[2] / "data/public")
    day = date(2026, 10, 10)
    prepared = prepare_journeys(repository, day)
    start, end = [73.504676, 4.169366], [73.543088, 4.211553]
    result = route_journey(repository, start, end, day, 920)
    assert prepare_journeys(repository, day) is prepared
    destination = {"id": "journey:end", "lon": end[0], "lat": end[1]}
    reference = JourneyRouter(
        prepared.world, PlanningAssumptions(date=day), [destination], network=prepared.network
    ).route({"id": "journey:start", "lon": start[0], "lat": start[1]})
    assert result["journey"]["minutes"] == reference["minutes"]
    assert result["journey"]["arrival_minutes"] == reference["arrival_minutes"]
    assert prepare_journeys(repository, date(2026, 10, 11)).trips != prepared.trips
    repository.baseline["transit"]["patterns"][0]["enabled"] = False
    assert prepare_journeys(repository, day) is not prepared


def test_direction_result_cache_reuses_exact_query_and_invalidates_source(
    client, tmp_path, monkeypatch
):
    import app.api.routes.routing as routes

    calls = []
    version = ["source-1"]
    client.app.state.computed_cache = ComputedCache(tmp_path / "runtime")
    client.app.state.source_version = SimpleNamespace(version=lambda: version[0])

    def calculate(*args):
        calls.append(args)
        return {"status": "ok", "points": args[2]}

    monkeypatch.setattr(routes, "route_multistop", calculate)
    payload = {"points": [[73, 3], [73.001, 3]], "mode": "walk"}
    first = client.post("/api/v1/routing/journey", json=payload).json()
    assert client.post("/api/v1/routing/journey", json=payload).json() == first
    assert len(calls) == 1
    client.app.state.computed_cache = ComputedCache(tmp_path / "runtime")
    assert client.post("/api/v1/routing/journey", json=payload).json() == first
    assert len(calls) == 1
    payload["mode"] = "bicycle"
    client.post("/api/v1/routing/journey", json=payload)
    assert len(calls) == 2
    version[0] = "source-2"
    client.post("/api/v1/routing/journey", json=payload)
    assert len(calls) == 3
    client.app.state.planning.repository.baseline["referenceDate"] = "2026-10-11"
    client.post("/api/v1/routing/journey", json=payload)
    assert len(calls) == 4
    client.app.state.routing.revision += 1
    client.post("/api/v1/routing/journey", json=payload)
    assert len(calls) == 5


@pytest.mark.parametrize(
    "body",
    [
        {"points": [[73, 3]]},
        {"points": [[73, 3]] * 11},
        {"points": [[181, 3], [73, 3]]},
        {"points": [[73, 91], [73, 3]]},
        {"points": [[73, 3], [73, 3, 0]]},
        {"points": [[73, 3], [73, 3]], "mode": "bus"},
        {"points": [[73, 3], [73, 3]], "mode": "taxi"},
        {"points": [[73, 3], [73, 3]], "departure_minutes": -1},
        {"points": [[73, 3], [73, 3]], "departure_minutes": 1440},
        {"points": [[73, 3], [73, 3]], "island_id": "island:1"},
    ],
)
def test_map_journey_validates_stop_count_coordinates_modes_and_time(client, body):
    assert client.post("/api/v1/routing/journey", json=body).status_code == 422
