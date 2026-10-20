"""Explore directions must show real dated services, never a bus-permitted road path."""

import copy
from datetime import date
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes.routing import router
from app.planning.repository import PlanningRepository
from app.planning.service import PlanningService
from app.routing.engine import RoutingRepository
from app.routing.journeys import route_journey

PUBLIC_DIR = Path(__file__).resolve().parents[2] / "data/public"


@pytest.fixture(scope="module")
def repository():
    return PlanningRepository(PUBLIC_DIR)


def endpoints(repository):
    pattern = repository.baseline["transit"]["patterns"][0]
    stops = {stop["id"]: stop for stop in repository.baseline["transit"]["stops"]}
    return [stops[pattern["stopIds"][index]] for index in (0, 12)]


def coordinates(point):
    return [point["lon"], point["lat"]]


def test_real_bus_journey_includes_boarding_alighting_and_transfers(repository):
    start, end = endpoints(repository)
    result = route_journey(repository, coordinates(start), coordinates(end))
    journey = result["journey"]
    assert result["status"] == "ok"
    assert journey["service_date"] == "2026-10-10"
    assert journey["uses_transit"]
    assert journey["walk_minutes"] > 0
    assert journey["wait_minutes"] > 0
    assert journey["ride_minutes"] > 0
    assert abs(sum(leg["minutes"] for leg in journey["legs"]) - journey["minutes"]) < 0.01
    source_patterns = {p["id"]: p for p in repository.baseline["transit"]["patterns"]}
    for leg in journey["legs"]:
        assert leg["arrival_minutes"] >= leg["departure_minutes"]
        if leg["mode"] == "bus":
            pattern = source_patterns[leg["pattern_id"]]
            assert leg["route_id"] == pattern["routeId"]
            assert leg["route_name"] == pattern["name"]
            assert leg["stops"][0]["id"] == leg["from"]["id"]
            assert leg["stops"][-1]["id"] == leg["to"]["id"]
            assert leg["stops"][0]["departure_minutes"] == leg["departure_minutes"]
            assert leg["stops"][-1]["arrival_minutes"] == leg["arrival_minutes"]
            assert len(leg["geometry"]) > 2
            assert not leg["from"]["name"].startswith("rtl:")
    assert all(stop["roles"] for stop in journey["stops"])


def test_route_selection_reuses_dated_services_without_mutating_prepared_router(repository):
    start, end = [73.5404157, 4.2370837], [73.527056, 4.190044]
    unrestricted_before = route_journey(repository, start, end)
    selected = route_journey(repository, start, end, route_ids=["rtl:route:129"])
    assert selected["status"] == "ok"
    journey = selected["journey"]
    buses = [leg for leg in journey["legs"] if leg["mode"] == "bus"]
    assert buses and {leg["route_id"] for leg in buses} == {"rtl:route:129"}
    assert all(stop["island_id"] != "male" for leg in buses for stop in leg["stops"])
    assert journey["walk_minutes"] > 0 and journey["wait_minutes"] > 0
    assert abs(sum(leg["minutes"] for leg in journey["legs"]) - journey["minutes"]) < 0.01
    assert journey["active_service_count"] == 1
    assert route_journey(repository, start, end) == unrestricted_before


def test_pattern_catalogue_exposes_retained_source_without_mutating_it(repository, tmp_path):
    app = FastAPI()
    app.state.planning = PlanningService(repository)
    app.state.routing = RoutingRepository(tmp_path)
    app.include_router(router)
    client = TestClient(app)
    source = next(
        p for p in repository.baseline["transit"]["patterns"] if p["routeId"] == "rtl:route:129"
    )
    before = copy.deepcopy(source)
    response = client.get("/api/v1/routing/patterns?route_id=rtl:route:129")
    assert response.status_code == 200
    catalogue = response.json()
    assert len(catalogue["patterns"]) == 1
    assert catalogue["patterns"][0]["segment_geometry"] == source["segmentGeometry"]
    assert catalogue["patterns"][0]["stop_ids"] == source["stopIds"]
    assert "not an operator-published route trace" in catalogue["qualification"]
    assert source == before


def test_unknown_ferry_crossing_does_not_invent_a_trip(repository):
    start = endpoints(repository)[0]
    end = next(
        stop for stop in repository.baseline["transit"]["stops"] if stop["islandId"] == "vilimale"
    )
    result = route_journey(repository, coordinates(start), coordinates(end))
    assert result["status"] == "unreachable"
    assert result["journey"]["minutes"] is None
    assert result["journey"]["legs"] == []
    assert result["geometry"] == []
    assert any("crossing durations" in warning for warning in result["journey"]["warnings"])


def test_captured_bus_trips_are_not_repeated_on_other_dates(repository):
    start, end = endpoints(repository)
    result = route_journey(repository, coordinates(start), coordinates(end), date(2026, 10, 15))
    assert result["journey"]["active_service_count"] == 0
    assert not result["journey"]["uses_transit"]
    assert all(leg["mode"] == "walk" for leg in result["journey"]["legs"])
    assert any("selected date" in warning for warning in result["journey"]["warnings"])


def test_unavailable_journey_explains_the_selected_date(repository):
    start = endpoints(repository)[0]
    end = next(
        stop for stop in repository.baseline["transit"]["stops"] if stop["islandId"] == "vilimale"
    )
    result = route_journey(repository, coordinates(start), coordinates(end), date(2026, 10, 15))
    assert result["status"] == "unreachable"
    assert "No verified bus timetable" in result["journey"]["reason"]
    assert "2026-10-15" in result["journey"]["reason"]


def test_missing_ride_shape_keeps_a_map_gap(repository):
    isolated = copy.copy(repository)
    isolated.baseline = copy.deepcopy(repository.baseline)
    for pattern in isolated.baseline["transit"]["patterns"]:
        pattern["segmentGeometry"] = []
    start, end = endpoints(isolated)
    result = route_journey(isolated, coordinates(start), coordinates(end))
    assert result["journey"]["uses_transit"]
    assert result["geometry"] == []
    rides = [leg for leg in result["journey"]["legs"] if leg["mode"] == "bus"]
    assert rides and all(leg["geometry"] == [] for leg in rides)
    assert all(leg["geometry_warning"] for leg in rides)


def test_points_outside_planning_network_remain_unavailable(repository):
    result = route_journey(repository, [0, 0], coordinates(endpoints(repository)[1]))
    assert result["status"] == "unreachable"
    assert "near a mapped street" in result["journey"]["reason"]


def test_api_exposes_scoped_stop_points_and_validates_departure(repository, tmp_path):
    app = FastAPI()
    app.state.planning = PlanningService(repository)
    app.state.routing = RoutingRepository(tmp_path)
    app.include_router(router)
    client = TestClient(app)
    response = client.get("/api/v1/routing/stops?island_id=island:1442")
    assert response.status_code == 200
    catalogue = response.json()
    assert catalogue["service_date"] == "2026-10-10"
    assert catalogue["earliest_departure_minutes"] == 920
    assert catalogue["stops"]
    assert all(stop["island_id"] == "hulhumale" for stop in catalogue["stops"])
    assert all(stop["national_island_id"] == "island:1442" for stop in catalogue["stops"])
    assert all(len(stop["coordinates"]) == 2 for stop in catalogue["stops"])
    assert all(stop["mode"] == "bus" for stop in catalogue["stops"])
    assert all(stop["route_names"] for stop in catalogue["stops"])
    assert all(
        not name.startswith("rtl:") for stop in catalogue["stops"] for name in stop["route_names"]
    )
    assert "graph_edges" not in catalogue
    all_stops = client.get("/api/v1/routing/stops").json()["stops"]
    assert {"male", "hulhumale"}.issubset({stop["island_id"] for stop in all_stops})
    assert all(
        stop["national_island_id"] == "island:1443"
        for stop in all_stops
        if stop["island_id"] == "male"
    )
    assert client.get("/api/v1/routing/stops?island_id=island:unknown").json()["stops"] == []
    start, end = endpoints(repository)
    response = client.post(
        "/api/v1/routing/land",
        json={
            "start": coordinates(start),
            "end": coordinates(end),
            "mode": "transit",
            "service_date": "2026-10-10",
            "departure_minutes": 920,
        },
    )
    assert response.status_code == 200
    assert response.json()["journey"]["uses_transit"]
    response = client.post(
        "/api/v1/routing/land",
        json={
            "start": coordinates(start),
            "end": coordinates(end),
            "mode": "transit",
            "departure_minutes": 1440,
        },
    )
    assert response.status_code == 422
