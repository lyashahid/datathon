"""Transport planning separates mapped landings, service evidence and resident access."""

import copy
import io
import json
import math
from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.api.routes.planning import get_transport_planning, router
from app.api.routes.planning_reports import report_pdf
from app.planning.bus_connection import BusConnectionPlanner, BusConnectionRequest
from app.planning.models import PlanningRequest
from app.planning.report import build_planning_report, proposal_map
from app.planning.repository import PlanningRepository
from app.planning.service import PlanningService
from app.planning.transport import FerryServiceRequest, TransportPlanningService, terminal_catalogue
from app.planning.world import apply_operations
from app.routing.engine import _distance_m


@pytest.fixture
def transport(tmp_path):
    a = {"id": "a", "islandId": "hulhumale", "lon": 73.54, "lat": 4.22}
    b = {"id": "b", "islandId": "hulhumale", "lon": 73.541, "lat": 4.22}
    c = {"id": "c", "islandId": "island:500", "lon": 73.6, "lat": 4.3}
    baseline = {
        "version": "transport-fixture",
        "referenceDate": "2026-10-10",
        "sources": [],
        "islands": [{"id": "hulhumale", "name": "Hulhumalé"}],
        "network": {
            "nodes": [a, b, c],
            "edges": [
                {
                    "id": "a-b",
                    "from": "a",
                    "to": "b",
                    "distanceM": 1000,
                    "walkAllowed": True,
                    "driveAllowed": True,
                    "geometry": [[73.54, 4.22], [73.541, 4.22]],
                }
            ],
        },
        "origins": [dict(a, id="resident:a", population2026=100, population2030=120)],
        "facilities": [],
        "transit": {"stops": [dict(b, id="bus:b", mode="bus")], "patterns": []},
    }
    (tmp_path / "planning-baseline.json").write_text(json.dumps(baseline), encoding="utf8")
    islands = {
        identity: {
            "properties": {"id": identity, "name": name, "centroid": point},
            "geometry": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [point[0] - 0.001, point[1] - 0.001],
                        [point[0] + 0.001, point[1] - 0.001],
                        [point[0] + 0.001, point[1] + 0.001],
                        [point[0] - 0.001, point[1] + 0.001],
                        [point[0] - 0.001, point[1] - 0.001],
                    ]
                ],
            },
        }
        for identity, name, point in [
            ("island:1442", "Hulhumalé", [73.54, 4.22]),
            ("island:500", "Test Island", [73.6, 4.3]),
            ("island:501", "Unknown Landing", [73.65, 4.4]),
        ]
    }
    features = []
    for identity, island, point in [
        ("osm:way:1", "island:1442", [73.54, 4.22]),
        ("osm:way:2", "island:500", [73.6, 4.3]),
    ]:
        features.append(
            {
                "id": identity,
                "name": f"Terminal {identity[-1]}",
                "category": "public_transport",
                "island_id": island,
                "tags": {"amenity": "ferry_terminal", "ferry": "yes"},
                "geometry": {"type": "Point", "coordinates": point},
            }
        )
    repository = SimpleNamespace(islands_by_id=islands, transport={"features": features})
    routing = SimpleNamespace(marine={"nodes": [], "edges": []})
    updates = SimpleNamespace(catalogue=lambda: {"services": []})
    planning = PlanningService(PlanningRepository(tmp_path))
    return TransportPlanningService(repository, routing, planning, updates)


def draft(transport, **overrides):
    payload = {
        "origin_island_id": "island:1442",
        "destination_island_id": "island:500",
        "assumptions": {
            "capital_budget_mvr": 60_000_000,
            "annual_operating_budget_mvr": 100_000_000,
        },
    }
    payload.update(overrides)
    return transport.ferry_service(FerryServiceRequest.model_validate(payload))


def test_tagged_public_transport_terminals_and_plain_piers(transport):
    transport.repository.transport["features"].append(
        {
            "id": "pier:private-review",
            "category": "pier",
            "island_id": "island:501",
            "geometry": {"type": "Point", "coordinates": [73.65, 4.4]},
            "tags": {},
        }
    )
    terminals = terminal_catalogue(transport.repository, transport.routing)
    assert "osm:way:1" in terminals
    assert "pier:private-review" not in terminals


def test_no_verified_service_is_not_missing_infrastructure(transport):
    result = transport.connectivity("island:1442", "island:500", date(2026, 10, 10))
    assert result["status"] == "no_verified_service"
    assert result["terminals"]["origin"][0]["id"] == "osm:way:1"
    assert result["local_transport"]["walk_target_minutes"] == 10
    assert result["local_transport"]["residents_within_walk_target"] == 0
    assert "does not" in result["qualification"] or "never proves" in result["qualification"]


def test_local_bus_access_uses_available_national_resident_allocations(transport):
    baseline = transport.planning.repository.baseline
    node = next(row for row in baseline["network"]["nodes"] if row["islandId"] == "island:500")
    baseline["origins"].append(dict(node, id="resident:c", population2026=75))
    baseline["transit"]["stops"].append(dict(node, id="bus:c", mode="bus"))
    result = transport.local_access("island:500")
    assert result["status"] == "modeled"
    assert result["population"] == result["residents_within_walk_target"] == 75
    assert result["resident_coverage_pct"] == 100
    assert result["planning_bus_stop_count"] == 1
    assert "modeled island allocations" in result["qualification"]
    assert "does not confirm a departing bus" in result["qualification"]
    assert "Greater Malé" not in result["qualification"]


def test_missing_terminal_blocks_port_free_proposal_without_claiming_absence(transport):
    result = draft(transport, destination_island_id="island:501")
    assert result["status"] == "evidence_needed"
    assert result["operations"] == []
    assert result["quote"] is None
    assert any("does not prove" in reason for reason in result["reasons"])


def test_directed_mapped_graph_is_not_a_verified_timetable(transport):
    transport.routing.marine = {
        "nodes": [
            {"id": "a", "island_id": "island:1442", "coordinates": [73.54, 4.22]},
            {"id": "b", "island_id": "island:500", "coordinates": [73.6, 4.3]},
        ],
        "edges": [{"id": "candidate", "from_id": "a", "to_id": "b"}],
    }
    result = transport.connectivity("island:1442", "island:500", date(2026, 10, 10))
    assert result["status"] == "mapped_route"
    assert result["reachable_islands"][0]["evidence"] == "mapped_route"
    assert (
        transport.connectivity("island:500", "island:1442", date(2026, 10, 10))["status"]
        == "no_verified_service"
    )


def test_dated_service_respects_validity_and_weekday(transport):
    service = {
        "id": "reviewed",
        "name": "Reviewed ferry",
        "mode": "ferry",
        "from_island_id": "island:1442",
        "to_island_id": "island:500",
        "effective_from": "2026-10-10",
        "effective_until": "2026-10-11",
        "weekdays": [6],
        "timing_basis": "assumed_runtime",
        "source": {"publisher": "RTL"},
    }
    transport.updates.catalogue = lambda: {"services": [service]}
    assert (
        transport.connectivity("island:1442", "island:500", date(2026, 10, 10))["status"]
        == "dated_service"
    )
    assert (
        transport.connectivity("island:1442", "island:500", date(2026, 10, 11))["status"]
        == "no_verified_service"
    )


def test_ferry_draft_has_balanced_return_sailings_and_no_construction(transport):
    before = copy.deepcopy(transport.planning.repository.baseline)
    result = draft(transport)
    assert result["status"] == "ready"
    assert result["summary"]["terminal_construction_mvr"] == 0
    assert result["quote"]["economics"]["delta"]["new_stops"] == 0
    assert result["quote"]["budget"]["allowed"]
    assert result["quote"]["economics"]["delta"]["capital_mvr"] > 0
    assert len(result["operations"]) == 4
    points = [
        feature
        for feature in result["map_features"]["features"]
        if feature["geometry"]["type"] == "Point"
    ]
    assert {feature["properties"]["role"] for feature in points} == {"origin", "destination"}
    assert {feature["properties"]["terminal_id"] for feature in points} == {
        "osm:way:1",
        "osm:way:2",
    }
    assert all(
        feature["properties"]["name"] and feature["properties"]["island_id"] for feature in points
    )
    outbound, inward = [
        operation["service"]
        for operation in result["operations"]
        if operation["type"] == "add_service"
    ]
    assert outbound["stopIds"] == list(reversed(inward["stopIds"]))
    assert len(outbound["timing"]["trips"]) == len(inward["timing"]["trips"])
    assert inward["timing"]["trips"][-1]["stopTimes"][-1]["arrivalMinutes"] <= 1200
    assert transport.planning.repository.baseline == before


def test_existing_proposal_costs_and_budget_gate_are_authoritative(transport):
    low = draft(transport, assumptions={"capital_budget_mvr": 1_000})
    assert not low["quote"]["budget"]["allowed"]
    assert low["quote"]["budget"]["status"] == "over_budget"
    stop = {"type": "add_stop", "island_id": "island:1442", "coordinates": [73.54, 4.22]}
    combined = draft(transport, operations=[stop])
    standalone = draft(transport)
    assert (
        combined["quote"]["economics"]["delta"]["capital_mvr"]
        == standalone["quote"]["economics"]["delta"]["capital_mvr"] + 100_000
    )


def test_ferry_water_corridor_geometry_timing_and_costs_agree(transport):
    from shapely.geometry import LineString, box, mapping

    obstacle = box(73.565, 4.25, 73.575, 4.27)
    transport.repository.islands_by_id["island:700"] = {
        "properties": {"id": "island:700", "name": "Intervening island"},
        "geometry": mapping(obstacle),
    }
    result = draft(transport)
    assert result["status"] == "ready"
    line = next(
        f for f in result["map_features"]["features"] if f["geometry"]["type"] == "LineString"
    )
    geometry = line["geometry"]["coordinates"]
    assert not LineString(geometry).intersects(obstacle)
    assert geometry[0] == transport.terminals["osm:way:1"]["coordinates"]
    assert geometry[-1] == transport.terminals["osm:way:2"]["coordinates"]
    assert line["properties"]["evidence"] == "coastline_avoiding_planning_corridor"
    assert result["summary"]["geometry_source"] == line["properties"]["evidence"]
    assert "not navigation clearance" in result["summary"]["qualification"]
    distance = sum(_distance_m(a, b) for a, b in zip(geometry, geometry[1:]))
    assert distance > _distance_m(geometry[0], geometry[-1])
    assert result["summary"]["distance_km"] == round(distance / 1000, 2)
    crossing = math.ceil(distance / 1000 / 25 * 60)
    assert result["summary"]["crossing_minutes"] == crossing
    services = [
        operation["service"]
        for operation in result["operations"]
        if operation["type"] == "add_service"
    ]
    assert services[0]["segmentGeometry"] == [geometry]
    assert services[1]["segmentGeometry"] == [list(reversed(geometry))]
    assert all(service["distanceM"] == pytest.approx(distance) for service in services)
    world, _ = apply_operations(
        transport.planning.repository,
        PlanningRequest.model_validate({"operations": result["operations"]}),
    )
    assert world["patterns"][0]["segmentGeometry"] == [geometry]
    for service in services:
        for trip in service["timing"]["trips"]:
            assert (
                trip["stopTimes"][1]["arrivalMinutes"] - trip["stopTimes"][0]["departureMinutes"]
                == crossing
            )
    economics = result["quote"]["economics"]
    activity = economics["fleets"]["after"]
    daily_km = distance / 1000 * sum(len(service["timing"]["trips"]) for service in services)
    assert activity["routes"][0]["service_day_vehicle_km"] == pytest.approx(daily_km, abs=0.001)
    annual_km = daily_km * activity["annual_operating_days_assumption"]
    assert economics["delta"]["annual_operating_mvr"] == pytest.approx(round(annual_km * 250, 2))
    assert economics["delta"]["annual_fleet_operating_kg_co2e"] == pytest.approx(
        round(annual_km * 25, 2)
    )


def test_ferry_unavailable_shoreline_never_invents_landing_or_line(transport):
    transport.repository.islands_by_id["island:500"].pop("geometry")
    result = draft(transport)
    assert result["status"] == "evidence_needed"
    assert result["operations"] == []
    assert result["map_features"]["features"] == []
    assert result["quote"] is None
    assert "no new landing is assumed" in result["reasons"][0]


def test_terminal_identity_and_duplicate_service_are_validated(transport):
    with pytest.raises(ValueError, match="origin island"):
        draft(transport, origin_terminal_id="osm:way:2")
    result = draft(transport)
    with pytest.raises(ValueError, match="already part"):
        draft(transport, operations=result["operations"])
    with pytest.raises(ValueError, match="source-mapped"):
        apply_operations(
            transport.planning.repository,
            PlanningRequest.model_validate(
                {"operations": [{"type": "use_existing_ferry_terminal", "target_id": "made-up"}]}
            ),
        )


def test_shared_terminal_packages_remain_valid_after_removing_first_service(transport):
    first = draft(transport)
    second = draft(transport, headway_minutes=180, operations=first["operations"])
    assert len(second["operations"]) == 4
    retained = PlanningRequest.model_validate(
        {"island_id": "island:1442", "operations": second["operations"]}
    )
    world, _ = apply_operations(transport.planning.repository, retained)
    assert len([pattern for pattern in world["patterns"] if pattern["mode"] == "ferry"]) == 2
    assert transport.planning.quote(retained)["economics"]["delta"]["new_stops"] == 0


def test_ferry_service_from_national_island_outside_local_snapshot_stays_available(transport):
    result = draft(transport, origin_island_id="island:500", destination_island_id="island:1442")
    assert result["status"] == "ready"
    assert result["quote"]["budget"]["allowed"]
    assert result["quote"]["economics"]["delta"]["capital_mvr"] > 0
    assert result["quote"]["economics"]["delta"]["new_stops"] == 0
    evaluated = transport.planning.evaluate(
        PlanningRequest.model_validate(
            {"island_id": "island:500", "operations": result["operations"]}
        )
    )
    assert evaluated["status"] == "outside_snapshot"
    assert evaluated["summary"]["population"] is None
    assert evaluated["transport_connectivity"]["after"]["ferry_lines"] == 2


def test_transport_forecast_is_walking_access_not_ferry_ridership(transport):
    transport.planning.repository.ferry_terminals = {}
    request = PlanningRequest.model_validate(
        {
            "island_id": "island:1442",
            "assumptions": {"goal": "transport", "target_minutes": 10},
            "operations": [
                {"type": "add_stop", "island_id": "island:1442", "coordinates": [73.54, 4.22]}
            ],
        }
    )
    result = transport.planning.evaluate(request)
    assert result["summary"]["baseline_reachable_residents"] == 0
    assert result["summary"]["scenario_reachable_residents"] == 0
    assert result["summary"]["gained_residents"] == 0
    assert result["origins"][0]["before"] == result["origins"][0]["after"]
    connection = BusConnectionPlanner(transport.planning).preview(
        BusConnectionRequest(
            island_id="island:1442", coordinates=[73.54, 4.22], assumptions=request.assumptions
        )
    )
    assert connection["status"] == "ready"
    connected = PlanningRequest.model_validate(
        {**request.model_dump(), "operations": connection["operations"]}
    )
    result = transport.planning.evaluate(connected)
    assert result["summary"]["scenario_reachable_residents"] == 100
    assert result["summary"]["gained_residents"] == 100
    assert all(leg["mode"] == "walk" for leg in result["origins"][0]["after"]["path"])
    assert any("walking to mapped boarding" in warning for warning in result["warnings"])


def test_ferry_forecast_and_pdf_keep_connections_separate_from_health(transport):
    ferry = draft(transport)
    payload = PlanningRequest.model_validate(
        {"island_id": "island:1442", "operations": ferry["operations"]}
    )
    result = transport.planning.evaluate(payload)
    assert result["transport_connectivity"]["after"]["ferry_lines"] == 2
    assert result["transport_connectivity"]["after"]["islands_connected"] == [
        "island:1442",
        "island:500",
    ]
    assert result["summary"]["gained_residents"] == 0
    content = build_planning_report(
        payload, result, "Ferry service fixture", transport.planning.baseline(payload.island_id)
    )
    reader = PdfReader(io.BytesIO(content))
    text = " ".join(page.extract_text() for page in reader.pages)
    cover = reader.pages[0].extract_text()
    departures = sum(
        len(operation["service"]["timing"]["trips"])
        for operation in ferry["operations"]
        if operation["type"] == "add_service"
    )
    assert "NEW FERRY SERVICE" in cover
    assert f"{departures} planned departures" in cover
    assert "RESIDENT ACCESS GAIN" in cover
    assert "RESIDENTS GAINING TARGET ACCESS" not in cover
    assert "Public transport and island connections" in text
    assert "New terminal / port construction: MVR 0" in text
    assert "Terminal 1 to Terminal 2" in text
    assert "1 to 2" in text and "2 to 1" in text
    evidence = json.loads(reader.attachments["evaluation-evidence.json"][0])
    assert evidence["transport_connectivity"]["after"]["ferry_lines"] == 2


def test_transport_api_validation_and_response(transport):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_transport_planning] = lambda: transport
    client = TestClient(app)
    assert (
        client.get(
            "/api/v1/planning/connectivity",
            params={"origin_island_id": "island:1442", "destination_island_id": "island:500"},
        ).status_code
        == 200
    )
    assert (
        client.get(
            "/api/v1/planning/connectivity", params={"origin_island_id": "missing"}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/planning/ferry-service",
            json={
                "origin_island_id": "island:1442",
                "destination_island_id": "island:500",
                "speed_kph": 0,
            },
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/planning/ferry-service",
            json={"origin_island_id": "island:1442", "destination_island_id": "island:500"},
        ).json()["status"]
        == "ready"
    )


def test_grouped_ui_pdf_resolves_terminal_names_with_compact_impact_flags(transport):
    ferry = draft(transport)
    operations = ferry["operations"]
    operations[0]["metadata"] = {"ui_map_features": ferry["map_features"]}
    for operation in operations[1:]:
        operation["metadata"] = {}
    payload = PlanningRequest.model_validate(
        {
            "island_id": "island:1442",
            "operations": operations,
            "assumptions": {"include_world": False},
        }
    )
    response = report_pdf(payload, title="Grouped ferry proposal", service=transport.planning)
    reader = PdfReader(io.BytesIO(response.body))
    text = " ".join(page.extract_text() for page in reader.pages)
    assert "Terminal 1 to Terminal 2" in text
    assert "Dashed ferry corridors" in text
    # Service metadata is sometimes copied onto both directions and may include
    # placed coordinates. Only the two existing landings get map numbers.
    for index, operation in enumerate(operations):
        operation["coordinates"] = [73.54, 4.22] if index != 1 else [73.6, 4.3]
    placed = PlanningRequest.model_validate({"operations": operations})
    canonical = transport.planning.evaluate(placed)
    world_stops = {stop["id"]: stop for stop in canonical["world"]["stops"]}
    drawing = proposal_map(placed, transport.planning.baseline(None), 480, world_stops)
    labels = [item.text for item in drawing.contents if hasattr(item, "text")]
    assert sorted(labels) == ["1", "2", "N"]
