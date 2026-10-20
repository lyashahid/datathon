"""A map-placed stop becomes a costed, dated, directed service only after acceptance."""

import copy
import io
import json
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.api.routes.planning import get_planning, router
from app.planning.bus_connection import BusConnectionPlanner, BusConnectionRequest
from app.planning.models import PlanningRequest
from app.planning.report import build_planning_report
from app.planning.repository import PlanningRepository
from app.planning.routing import service_day_trips
from app.planning.service import PlanningService
from app.planning.world import apply_operations


@pytest.fixture
def bus_planner(tmp_path):
    nodes = [
        {"id": identity, "lon": lon, "lat": lat, "islandId": "male"}
        for identity, lon, lat in [
            ("a", 73.5, 4.17),
            ("bend", 73.501, 4.171),
            ("b", 73.502, 4.17),
            ("return", 73.501, 4.169),
        ]
    ]
    edges = []
    for first, second in zip(nodes, [*nodes[1:], nodes[0]]):
        edges.append(
            {
                "id": f"{first['id']}-{second['id']}",
                "from": first["id"],
                "to": second["id"],
                "distanceM": 1000,
                "walkAllowed": True,
                "driveAllowed": True,
                "oneway": True,
                "geometry": [[first["lon"], first["lat"]], [second["lon"], second["lat"]]],
            }
        )
    baseline = {
        "version": "bus-connection-fixture",
        "referenceDate": "2026-10-10",
        "islands": [{"id": "male", "name": "Malé"}],
        "network": {"nodes": nodes, "edges": edges},
        "origins": [dict(nodes[0], id="origin:a", population2026=100, population2030=120)],
        "facilities": [
            dict(
                nodes[2],
                id="hospital:b",
                name="Existing hospital",
                kind="hospital",
                operatingStatus="open",
                verification="official",
                careScope="general",
            )
        ],
        "transit": {
            "stops": [dict(nodes[2], id="stop:b", name="Hospital stop", mode="bus")],
            "patterns": [],
        },
    }
    (tmp_path / "planning-baseline.json").write_text(json.dumps(baseline), encoding="utf8")
    return BusConnectionPlanner(PlanningService(PlanningRepository(tmp_path)))


def preview(bus_planner, **changes):
    values = {
        "island_id": "island:1443",
        "coordinates": [73.5, 4.17],
        "stop_name": "Neighbourhood bus stop",
        "headway_minutes": 10,
        "start_minutes": 480,
        "end_minutes": 600,
        "assumptions": {
            "departure_minutes": 470,
            "target_minutes": 20,
            "capital_budget_mvr": 50_000_000,
            "annual_operating_budget_mvr": 5_000_000,
        },
    }
    values.update(changes)
    return bus_planner.preview(BusConnectionRequest.model_validate(values))


def request_for(result):
    return PlanningRequest(
        island_id="island:1443",
        operations=result["operations"],
        assumptions={"departure_minutes": 470, "target_minutes": 20},
    )


def test_preview_uses_independent_one_way_outward_and_return_paths(bus_planner):
    before = copy.deepcopy(bus_planner.planning.repository.baseline)
    result = preview(bus_planner)
    assert result["status"] == "ready"
    candidate = result["candidates"][0]
    assert candidate["geometry"] == [[73.5, 4.17], [73.501, 4.171], [73.502, 4.17]]
    assert candidate["return_geometry"] == [[73.502, 4.17], [73.501, 4.169], [73.5, 4.17]]
    assert candidate["geometry_source"] == "osm_network_shortest_path"
    assert result["summary"]["both_directions"]
    assert result["summary"]["roundtrip_distance_km"] == 4
    assert result["summary"]["roundtrip_minutes"] == 38
    assert len(result["operations"]) == 3
    assert not any(
        "does not create transit service" in warning for warning in result["quote"]["warnings"]
    )
    assert bus_planner.planning.repository.baseline == before


def test_accepted_service_changes_resident_journeys_and_real_economics(bus_planner):
    result = preview(bus_planner)
    evaluation = bus_planner.planning.evaluate(request_for(result))
    assert evaluation["summary"]["baseline_reachable_residents"] == 0
    assert evaluation["summary"]["scenario_reachable_residents"] == 100
    assert evaluation["summary"]["gained_residents"] == 100
    assert evaluation["economics"]["delta"]["new_stops"] == 1
    assert evaluation["economics"]["delta"]["capital_mvr"] > 100_000
    assert evaluation["economics"]["delta"]["annual_operating_mvr"] > 0
    assert evaluation["economics"]["delta"]["annual_fleet_operating_kg_co2e"] > 0
    lines = evaluation["transport_connectivity"]["after"]["lines"]
    assert len(lines) == 2
    assert lines[0]["route_id"] == lines[1]["route_id"]
    assert lines[0]["stop_ids"] == list(reversed(lines[1]["stop_ids"]))
    world, _ = apply_operations(bus_planner.planning.repository, request_for(result))
    assert all(
        p["segmentGeometrySources"] == ["osm_network_shortest_path"] for p in world["patterns"]
    )


def test_return_schedule_balances_vehicles_and_expires_with_scenario_date(bus_planner):
    result = preview(bus_planner)
    world, _ = apply_operations(bus_planner.planning.repository, request_for(result))
    outward, inward = world["patterns"]
    assert len(outward["timing"]["trips"]) == len(inward["timing"]["trips"])
    assert inward["timing"]["trips"][-1]["stopTimes"][-1]["arrivalMinutes"] <= 600
    assert service_day_trips(outward, date(2026, 10, 11)) == []
    assert service_day_trips(inward, date(2026, 10, 11)) == []


def test_budget_gate_includes_stop_bus_fleet_and_operation(bus_planner):
    result = preview(bus_planner, assumptions={"capital_budget_mvr": 100_000})
    assert result["status"] == "ready"
    assert not result["quote"]["budget"]["allowed"]
    assert result["quote"]["budget"]["status"] == "over_budget"


def test_no_route_no_geometry_and_no_cosmetic_service(bus_planner):
    baseline = bus_planner.planning.repository.baseline
    baseline["network"]["edges"] = baseline["network"]["edges"][:2]
    result = preview(bus_planner)
    assert result["status"] == "evidence_needed"
    assert result["operations"] == []
    assert result["map_features"]["features"] == []
    assert result["quote"] is None


def test_off_network_stop_and_disabled_endpoint_never_get_a_route(bus_planner):
    assert preview(bus_planner, coordinates=[73.6, 4.3])["status"] == "evidence_needed"
    with pytest.raises(ValueError, match="enabled bus stop"):
        preview(bus_planner, target_stop_id="hospital:b")
    with pytest.raises(ValueError, match="enabled bus stop"):
        preview(
            bus_planner,
            target_stop_id="stop:b",
            operations=[{"type": "disable_stop", "target_id": "stop:b"}],
        )


def test_selected_candidate_duplicate_and_existing_proposal_costs(bus_planner):
    result = preview(bus_planner, target_stop_id="stop:b")
    assert result["selected_stop_id"] == "stop:b"
    with pytest.raises(ValueError, match="already part"):
        preview(bus_planner, operations=result["operations"])
    combined = preview(
        bus_planner,
        operations=[
            {
                "type": "add_stop",
                "island_id": "island:1443",
                "coordinates": [73.501, 4.171],
            }
        ],
    )
    # A standalone stop remains a separate cost, never an implicit dependency
    # of the new return service package.
    same = preview(
        bus_planner,
        target_stop_id="stop:b",
        operations=[
            {
                "type": "add_stop",
                "island_id": "island:1443",
                "coordinates": [73.501, 4.171],
            }
        ],
    )
    assert combined["status"] == "ready"
    assert (
        same["quote"]["economics"]["delta"]["capital_mvr"]
        == result["quote"]["economics"]["delta"]["capital_mvr"] + 250_000
    )


def test_connections_cannot_depend_on_separately_proposed_stops(bus_planner):
    first = preview(bus_planner)
    proposed_stop_id = first["summary"]["new_stop_id"]
    with pytest.raises(ValueError, match="mapped source data"):
        preview(
            bus_planner,
            coordinates=[73.501, 4.171],
            target_stop_id=proposed_stop_id,
            operations=first["operations"],
        )
    second = preview(
        bus_planner,
        coordinates=[73.501, 4.171],
        operations=first["operations"],
    )
    assert second["status"] == "ready"
    assert all(
        not candidate["stop"]["id"].startswith("proposal:") for candidate in second["candidates"]
    )
    # Removing the first package leaves the second package's stop and both
    # directions self-contained; quote and accessibility evaluation remain valid.
    retained = request_for(second)
    world, _ = apply_operations(bus_planner.planning.repository, retained)
    assert len(world["patterns"]) == 2
    assert proposed_stop_id not in {stop["id"] for stop in world["stops"]}
    assert bus_planner.planning.quote(retained)["budget"]["allowed"]
    assert bus_planner.planning.evaluate(retained)["status"] == "partial"


def test_layover_changes_create_distinct_bus_service_packages(bus_planner):
    first = preview(bus_planner)
    second = preview(
        bus_planner,
        assumptions={"layover_minutes": 20},
        operations=first["operations"],
    )
    assert second["status"] == "ready"
    assert second["summary"]["new_stop_id"] != first["summary"]["new_stop_id"]
    assert second["summary"]["roundtrip_minutes"] > first["summary"]["roundtrip_minutes"]


def test_api_validates_and_exposes_connected_bus_package(bus_planner):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_planning] = lambda: bus_planner.planning
    client = TestClient(app)
    body = {"island_id": "island:1443", "coordinates": [73.5, 4.17]}
    response = client.post("/api/v1/planning/bus-connection", json=body)
    assert response.status_code == 200
    assert response.json()["status"] == "ready"
    assert (
        client.post("/api/v1/planning/bus-connection", json={**body, "speed_kph": 90}).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/planning/bus-connection", json={**body, "island_id": "island:500"}
        ).status_code
        == 422
    )


def test_pdf_names_bus_route_and_separates_departures_from_ridership(bus_planner):
    result = preview(bus_planner)
    payload = request_for(result)
    evaluation = bus_planner.planning.evaluate(payload)
    report = build_planning_report(
        payload,
        evaluation,
        "Neighbourhood connection",
        bus_planner.planning.baseline(payload.island_id),
    )
    text = "\n".join(page.extract_text() for page in PdfReader(io.BytesIO(report)).pages)
    assert "Bus routes and return journeys" in text
    assert "Hospital stop" in text
    assert "neither added stops nor departures establish ridership" in text
