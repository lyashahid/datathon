"""Planning regression tests exercise calendars, actual paths, mass, and immutable overlays."""

import copy
import json
import random
from concurrent.futures import ThreadPoolExecutor
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.routes.planning import router
from app.planning.economics import economics, fleet_activity
from app.planning.models import JourneyRequest, PlanningAssumptions, PlanningRequest
from app.planning.repository import PlanningRepository
from app.planning.routing import JourneyRouter, WalkingNetwork, calendar_runs, pattern_trips
from app.planning.service import PlanningService
from app.planning.world import apply_operations, baseline_world, validate_service
from app.routing.engine import _distance_m


@pytest.fixture
def service(tmp_path):
    first = {"id": "a", "islandId": "male", "lon": 73.5, "lat": 4.17}
    second = {"id": "b", "islandId": "male", "lon": 73.501, "lat": 4.17}
    third = {"id": "c", "islandId": "vilimale", "lon": 73.48, "lat": 4.17}
    stops = [dict(first, id="stop:a"), dict(third, id="stop:c")]
    patterns = []
    for start, end, departure, arrival in [
        ("stop:a", "stop:c", 480, 490),
        ("stop:c", "stop:a", 550, 560),
    ]:
        patterns.append(
            {
                "id": f"service:{start}",
                "routeId": "ferry:1",
                "name": "Audited test ferry",
                "mode": "ferry",
                "stopIds": [start, end],
                "calendar": {"weekdays": [], "includedDates": ["2026-10-10"]},
                "timing": {
                    "kind": "scheduled",
                    "trips": [
                        {
                            "id": f"trip:{start}",
                            "stopTimes": [
                                {"arrivalMinutes": departure, "departureMinutes": departure},
                                {"arrivalMinutes": arrival, "departureMinutes": arrival},
                            ],
                        }
                    ],
                },
                "distanceM": 2000,
                "provenance": "observed",
                "sourceIds": ["fixture"],
            }
        )
    baseline = {
        "version": "fixture-1",
        "referenceDate": "2026-10-10",
        "sources": [],
        "islands": [{"id": "male", "name": "Malé"}, {"id": "vilimale", "name": "Vilimalé"}],
        "network": {
            "nodes": [first, second, third],
            "edges": [
                {
                    "id": "edge:a-b",
                    "from": "a",
                    "to": "b",
                    "distanceM": 1000,
                    "walkAllowed": True,
                    "driveAllowed": True,
                    "oneway": True,
                    "geometry": [[73.5, 4.17], [73.501, 4.17]],
                },
            ],
        },
        "origins": [
            dict(first, id="origin:a", population2026=100, population2030=120),
            dict(third, id="origin:c", population2026=50, population2030=60),
        ],
        "facilities": [
            dict(
                third,
                id="hospital:c",
                name="Hospital C",
                kind="hospital",
                operatingStatus="open",
                verification="official",
                careScope="general",
            )
        ],
        "transit": {"stops": stops, "patterns": patterns},
        "assumptions": {"populationSpatialDistribution": "Fixture census allocations"},
    }
    (tmp_path / "planning-baseline.json").write_text(json.dumps(baseline), encoding="utf8")
    return PlanningService(PlanningRepository(tmp_path))


def test_calendar_exclusions_and_previous_service_day():
    assert calendar_runs({"weekdays": [6]}, date(2026, 10, 10))
    assert not calendar_runs({"weekdays": [6], "excludedDates": ["2026-10-10"]}, date(2026, 10, 10))
    pattern = {
        "id": "overnight",
        "calendar": {"includedDates": ["2026-10-09"]},
        "timing": {
            "kind": "scheduled",
            "trips": [
                {
                    "id": "night",
                    "stopTimes": [
                        {"arrivalMinutes": 1450, "departureMinutes": 1450},
                        {"arrivalMinutes": 1470, "departureMinutes": 1470},
                    ],
                }
            ],
        },
    }
    trips = pattern_trips(pattern, date(2026, 10, 10))
    assert trips[0]["stopTimes"][0]["departureMinutes"] == 10
    assert pattern_trips(pattern, date(2026, 10, 11)) == []


def test_fleet_accounts_for_previous_service_day_overnight_departures(service):
    world = baseline_world(service.repository)
    pattern = world["patterns"][0]
    pattern["calendar"] = {"includedDates": ["2026-10-09"]}
    pattern["timing"]["trips"][0]["stopTimes"] = [
        {"arrivalMinutes": 1450, "departureMinutes": 1450},
        {"arrivalMinutes": 1470, "departureMinutes": 1470},
    ]
    world["patterns"] = [pattern]
    assumptions = PlanningAssumptions()
    fleet = fleet_activity(world, assumptions)
    assert fleet["required_fleet"] == 1
    assert fleet["routes"][0]["departures"] == 1
    assert fleet["routes"][0]["service_day_vehicle_km"] == 2
    empty = dict(world, patterns=[])
    result = economics(empty, world, assumptions)
    assert result["delta"]["capital_mvr"] == 30_000_000
    assert result["delta"]["annual_operating_mvr"] == 150_000
    assert result["delta"]["annual_operating_kg_co2e"] == 15_000


def test_walk_reverses_motor_oneway_but_drive_does_not(service):
    network = service.repository.baseline["network"]
    assert WalkingNetwork(network).tree("b", 2000)[0]["a"] == 1000
    assert "a" not in WalkingNetwork(network, drive=True).tree("b", 2000)[0]


def test_scheduled_wait_and_return_deadline_use_same_destination(service):
    request = JourneyRequest(
        origin_id="origin:a",
        assumptions={"departure_minutes": 470},
        appointment_minutes=30,
        return_deadline_minutes=550,
    )
    result = service.journey(request)
    assert result["outward"]["minutes"] == 20
    leg = next(leg for leg in result["outward"]["path"] if leg["mode"] == "ferry")
    assert leg["wait_minutes"] == 10
    assert result["outward"]["destination_id"] == "hospital:c"
    assert result["return_journey"]["destination_id"] == "origin:a"
    assert result["home_at_minutes"] == 560
    assert result["status"] == "deadline_missed"


@pytest.mark.parametrize(
    ("valid_from", "valid_until", "expected"),
    [
        ("07:30", "08:30", "feasible"),
        ("08:30", "09:30", "return_unavailable"),
    ],
)
def test_return_journey_rechecks_reviewed_notice_validity(
    service, valid_from, valid_until, expected
):
    result = service.journey(
        JourneyRequest(
            origin_id="origin:a",
            assumptions={"departure_minutes": 470},
            appointment_minutes=30,
            operations=[
                {
                    "type": "disable_service",
                    "target_id": "service:stop:c",
                    "metadata": {
                        "reviewed": True,
                        "valid_from": f"2026-10-10T{valid_from}:00+05:00",
                        "valid_until": f"2026-10-10T{valid_until}:00+05:00",
                    },
                }
            ],
        )
    )
    assert result["outward"]["status"] == "reachable"
    assert result["return_departure_minutes"] == 520
    assert result["status"] == expected
    if expected == "feasible":
        assert result["home_at_minutes"] == 560
        assert any("Return journey:" in warning for warning in result["warnings"])


def test_appointment_return_checks_next_day_calendar_and_absolute_deadline(service):
    outward, inward = service.repository.baseline["transit"]["patterns"]
    outward["timing"]["trips"][0]["stopTimes"] = [
        {"arrivalMinutes": 1430, "departureMinutes": 1430},
        {"arrivalMinutes": 1440, "departureMinutes": 1440},
    ]
    inward["calendar"] = {"includedDates": ["2026-10-11"]}
    inward["timing"]["trips"][0]["stopTimes"] = [
        {"arrivalMinutes": 30, "departureMinutes": 30},
        {"arrivalMinutes": 40, "departureMinutes": 40},
    ]
    result = service.journey(
        JourneyRequest(
            origin_id="origin:a",
            assumptions={"departure_minutes": 1420},
            appointment_minutes=20,
            return_deadline_minutes=1475,
        )
    )
    assert result["outward"]["minutes"] == 20
    assert result["return_departure_minutes"] == 1460
    assert result["return_journey"]["minutes"] == 20
    assert result["home_at_minutes"] == 1480
    assert result["status"] == "deadline_missed"


def test_boarding_buffer_cannot_board_departed_service(service):
    request = JourneyRequest(origin_id="origin:a", assumptions={"departure_minutes": 479})
    result = service.journey(request)
    assert result["outward"]["status"] == "unavailable"


def test_no_dropoff_stop_is_not_a_destination_access_point(service):
    service.repository.baseline["transit"]["stops"][1]["dropoffAllowed"] = False
    result = service.journey(
        JourneyRequest(origin_id="origin:a", assumptions={"departure_minutes": 470})
    )
    assert result["outward"]["status"] == "unavailable"


def test_proposed_hospital_recalculates_residents_and_preserves_baseline(service):
    pin = copy.deepcopy(service.repository.baseline)
    request = PlanningRequest(
        island_id="island:1443",
        assumptions={"departure_minutes": 450},
        operations=[
            {
                "type": "add_hospital",
                "island_id": "island:1443",
                "coordinates": [73.5, 4.17],
                "name": "Policy hospital",
            }
        ],
    )
    result = service.evaluate(request)
    assert result["summary"]["population"] == 100
    assert result["summary"]["baseline_reachable_residents"] == 0
    assert result["summary"]["scenario_reachable_residents"] == 100
    assert result["summary"]["gained_residents"] == 100
    assert sum(x["residents"] for x in result["travel_time_bands"]["after"]) == 100
    assert result["origins"][0]["after"]["destination_id"].startswith("proposal:add_hospital")
    assert result["economics"]["delta"]["capital_mvr"] == 120_000_000
    assert result["economics"]["delta"]["annual_operating_mvr"] == 20_000_000
    assert result["economics"]["delta"]["annual_operating_kg_co2e"] is None
    assert result["economics"]["delta"]["embodied_facility_kg_co2e"] is None
    assert result["economics"]["delta"]["annual_fleet_operating_kg_co2e"] == 0
    assert service.repository.baseline == pin


def test_proposed_future_opening_does_not_create_access_today(service):
    result = service.evaluate(
        PlanningRequest(
            island_id="male",
            assumptions={"departure_minutes": 450},
            operations=[
                {
                    "type": "add_hospital",
                    "coordinates": [73.5, 4.17],
                    "opening_date": "2030-01-01",
                }
            ],
        )
    )
    assert result["summary"]["gained_residents"] == 0
    assert result["economics"]["delta"]["capital_mvr"] == 0


def test_explicit_facility_emissions_remain_separate_from_fleet(service):
    result = service.evaluate(
        PlanningRequest(
            island_id="male",
            operations=[
                {
                    "type": "add_school",
                    "coordinates": [73.5, 4.17],
                    "metadata": {
                        "costs": {"annual_operating_kg_co2e": 1250, "embodied_kg_co2e": 12000}
                    },
                }
            ],
            assumptions={"displaced_passenger_km": 100, "goal": "education"},
        )
    )
    delta = result["economics"]["delta"]
    assert result["summary"]["gained_residents"] == 100
    assert delta["annual_operating_kg_co2e"] == 1250
    assert delta["annual_facility_operating_kg_co2e"] == 1250
    assert delta["annual_fleet_operating_kg_co2e"] == 0
    assert delta["embodied_facility_kg_co2e"] == 12000
    assert delta["net_annual_kg_co2e"] == 1238


def test_facility_delta_uses_unrounded_fleet_totals(service):
    result = service.evaluate(
        PlanningRequest(
            island_id="male",
            operations=[{"type": "add_hospital", "coordinates": [73.5, 4.17]}],
            assumptions={"cost_overrides": {"ferry_operating_mvr_per_km": 25.500004166666666}},
        )
    )
    assert result["economics"]["delta"]["annual_operating_mvr"] == 20_000_000


def test_explicit_proposal_stop_ids_remain_stable_after_prior_edits(service):
    stop_operation = {
        "type": "add_stop",
        "coordinates": [73.5, 4.17],
        "island_id": "male",
        "metadata": {"proposal_id": "proposal:add_stop:stable-stop"},
    }
    hospital_operation = {"type": "add_hospital", "coordinates": [73.5, 4.17], "island_id": "male"}
    full, _ = apply_operations(
        service.repository, PlanningRequest(operations=[hospital_operation, stop_operation])
    )
    removed, _ = apply_operations(service.repository, PlanningRequest(operations=[stop_operation]))
    assert full["stops"][-1]["id"] == removed["stops"][-1]["id"] == "proposal:add_stop:stable-stop"
    with pytest.raises(ValueError, match="already exists"):
        apply_operations(service.repository, PlanningRequest(operations=[stop_operation] * 2))


def test_snapshot_does_not_become_recurring_and_missing_evidence_is_not_loss(service):
    result = service.evaluate(PlanningRequest(assumptions={"date": "2026-10-11"}))
    assert result["coverage"]["snapshot_date_matches"] is False
    assert result["summary"]["unknown_residents"] == 100
    assert result["summary"]["lost_residents"] == 0


def test_unknown_national_scope_has_nulls_not_zero(service):
    result = service.evaluate(PlanningRequest(island_id="island:99999"))
    assert result["status"] == "outside_snapshot"
    assert result["summary"]["population"] is None
    assert all(b["residents"] is None for b in result["travel_time_bands"]["after"])


def test_imported_frequency_respects_departures_and_stop_ids(service):
    world = baseline_world(service.repository)
    pattern = dict(
        world["patterns"][0],
        id="scenario:ferry",
        provenance="observed",
        timing={
            "kind": "frequency",
            "segmentMinutes": [10],
            "windows": [{"startMinutes": 450, "endMinutes": 500, "headwayMinutes": 10}],
        },
    )
    validated = validate_service(pattern, world["stops"])
    assert validated["provenance"] == "assumed"
    assert len(pattern_trips(validated, date(2026, 10, 10))) == 5
    pattern["stopIds"] = ["unknown", "stop:c"]
    with pytest.raises(ValueError, match="unknown stop"):
        validate_service(pattern, world["stops"])


def test_fleet_does_not_teleport_and_capital_has_no_implicit_sale(service):
    world = baseline_world(service.repository)
    fleet = fleet_activity(world, PlanningAssumptions())
    assert fleet["required_fleet"] == 1  # actual round trip can use the same vessel
    assert fleet["routes"][0]["service_day_vehicle_km"] == 4
    after = copy.deepcopy(world)
    after["patterns"][1]["enabled"] = False
    assert economics(world, after, PlanningAssumptions())["delta"]["capital_mvr"] == 0


def test_mixed_propulsion_has_separate_blocks_and_conversion_capital(service):
    before = baseline_world(service.repository)
    for pattern in before["patterns"]:
        pattern["mode"] = "bus"
        pattern["fleet"] = "diesel"
    after = copy.deepcopy(before)
    after["patterns"][0]["fleet"] = "electric"
    assumptions = PlanningAssumptions(fleet_reserve_share=0, annual_operating_days=1)
    result = economics(before, after, assumptions)
    routes = result["fleets"]["after"]["routes"]
    assert {route["fleet_type"] for route in routes} == {"diesel", "electric"}
    assert all(route["required_fleet"] == 1 for route in routes)
    assert result["delta"]["capital_mvr"] == 5_250_000  # electric bus plus charging
    assert result["after"]["annual_operating_mvr"] == 2 * 18 + 2 * 25
    assert result["delta"]["annual_operating_kg_co2e"] == -1


def test_unbalanced_service_warns_and_never_invents_return_duties(service):
    world = baseline_world(service.repository)
    pattern = world["patterns"][0]
    pattern["timing"]["trips"].append(
        {
            "id": "second-outbound",
            "stopTimes": [
                {"arrivalMinutes": 520, "departureMinutes": 520},
                {"arrivalMinutes": 530, "departureMinutes": 530},
            ],
        }
    )
    world["patterns"][1]["enabled"] = False
    result = fleet_activity(world, PlanningAssumptions())
    assert result["required_fleet"] == 2
    assert result["routes"][0]["departures"] == 2
    assert any("unbalanced" in warning for warning in result["routes"][0]["warnings"])


def test_import_rejects_unknown_propulsion(service):
    world = baseline_world(service.repository)
    pattern = dict(world["patterns"][0], fleet="unknown")
    with pytest.raises(ValueError, match="propulsion"):
        validate_service(pattern, world["stops"])


@pytest.mark.parametrize(
    "timing",
    [None, {"kind": "scheduled", "trips": ["bad"]}, {"kind": "frequency", "windows": [None]}],
)
def test_malformed_nested_schedule_returns_validation_error(service, timing):
    world = baseline_world(service.repository)
    pattern = dict(world["patterns"][0], timing=timing)
    app = FastAPI()
    app.state.planning = service
    app.include_router(router)
    response = TestClient(app).post(
        "/api/v1/planning/timetable",
        json={"operations": [{"type": "add_service", "service": pattern}]},
    )
    assert response.status_code == 422


def test_closure_overlay_and_wheelchair_unknown_are_honest(service):
    request = PlanningRequest(
        operations=[{"type": "road_closure", "target_id": "edge:a-b", "disabled_modes": ["walk"]}]
    )
    world, _ = apply_operations(service.repository, request)
    assert "b" not in WalkingNetwork(world["network"]).tree("a", 2000)[0]
    assert service.repository.baseline["network"]["edges"][0]["walkAllowed"] is True
    assert "b" not in WalkingNetwork(world["network"], wheelchair=True).tree("a", 2000)[0]


def test_api_validates_bounded_inputs_and_resolves_identity(service):
    app = FastAPI()
    app.state.planning = service
    app.include_router(router)
    client = TestClient(app)
    baseline = client.get("/api/v1/planning/baseline", params={"island_id": "island:1443"})
    assert baseline.status_code == 200
    assert baseline.json()["planning_island_id"] == "male"
    response = client.post(
        "/api/v1/planning/journey",
        json={"origin_id": "origin:a", "assumptions": {"departure_minutes": 470}},
    )
    assert response.status_code == 200
    assert response.json()["outward"]["minutes"] == 20
    assert (
        client.post(
            "/api/v1/planning/evaluate", json={"assumptions": {"walk_m_per_minute": 0}}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/v1/planning/evaluate",
            json={"operations": [{"type": "add_service", "service": {"id": "broken"}}]},
        ).status_code
        == 422
    )
    with pytest.raises(ValidationError):
        PlanningRequest.model_validate(
            {"operations": [{"type": "add_hospital", "coordinates": [181, 4]}]}
        )


def test_reviewed_notice_is_applied_only_within_mvt_validity_window(service):
    operation = {
        "type": "road_closure",
        "target_id": "edge:a-b",
        "disabled_modes": ["walk"],
        "metadata": {
            "valid_from": "2026-10-10T15:00:00+05:00",
            "valid_until": "2026-10-10T16:00:00+05:00",
            "reviewed": True,
        },
    }
    world, _ = apply_operations(service.repository, PlanningRequest(operations=[operation]))
    assert world["network"]["edges"][0]["walkAllowed"] is False
    world, warnings = apply_operations(
        service.repository,
        PlanningRequest(operations=[operation], assumptions={"departure_minutes": 960}),
    )
    assert world["network"]["edges"][0]["walkAllowed"] is True
    assert any("outside its validity" in warning for warning in warnings)


def test_quote_gates_exact_capital_and_operating_budgets_without_access_routing(
    service, monkeypatch
):
    def no_routing(*args, **kwargs):
        pytest.fail("A budget quote must not calculate resident journeys")

    monkeypatch.setattr(service, "_router", no_routing)
    operation = {"type": "add_school", "coordinates": [73.5, 4.17]}
    request = PlanningRequest(
        island_id="island:1443",
        operations=[operation],
        assumptions={"capital_budget_mvr": 25_000_000, "annual_operating_budget_mvr": 5_000_000},
    )
    quote = service.quote(request)
    assert quote["budget"]["allowed"] is True
    assert quote["budget"]["capital"]["remaining_mvr"] == 0
    assert quote["budget"]["annual_operating"]["remaining_mvr"] == 0
    limited = request.model_copy(
        update={
            "assumptions": request.assumptions.model_copy(
                update={"capital_budget_mvr": 24_999_999, "annual_operating_budget_mvr": 4_999_999}
            )
        }
    )
    quote = service.quote(limited)
    assert quote["budget"]["status"] == "over_budget"
    assert quote["budget"]["allowed"] is False
    assert len(quote["budget"]["reasons"]) == 2
    assert quote["budget"]["capital"]["remaining_mvr"] == -1


def test_quote_blocks_unavailable_limited_costs_and_preserves_unbounded_status(service):
    service.repository.baseline["transit"]["patterns"][0]["distanceM"] = None
    limited = service.quote(
        PlanningRequest(assumptions={"departure_minutes": 470, "annual_operating_budget_mvr": 0})
    )
    assert limited["budget"]["allowed"] is False
    assert limited["budget"]["status"] == "unavailable"
    assert limited["budget"]["annual_operating"]["projected_mvr"] is None
    unbounded = service.quote(PlanningRequest(assumptions={"departure_minutes": 470}))
    assert unbounded["budget"]["allowed"] is True
    assert unbounded["budget"]["status"] == "unbounded"


def test_quote_uses_same_financial_model_and_keeps_legacy_overbudget_evaluation(service):
    request = PlanningRequest(
        island_id="island:1443",
        assumptions={"capital_budget_mvr": 0},
        operations=[{"type": "add_stop", "coordinates": [73.5, 4.17]}],
    )
    quote = service.quote(request)
    evaluation = service.evaluate(request)
    assert quote["economics"] == evaluation["economics"]
    assert quote["budget"]["allowed"] is False
    assert evaluation["economics"]["budget"]["capital_within_budget"] is False
    app = FastAPI()
    app.state.planning = service
    app.include_router(router)
    response = TestClient(app).post("/api/v1/planning/quote", json=request.model_dump(mode="json"))
    assert response.status_code == 200
    assert response.json()["budget"] == quote["budget"]


def test_routing_cache_reuses_budget_target_geometry_changes_and_isolates_responses(
    service, monkeypatch
):
    request = PlanningRequest(assumptions={"departure_minutes": 470})
    original = service.evaluate(request)
    assert len(service._routers) == 1  # An unchanged scenario shares its baseline router.
    before_pin = copy.deepcopy(service.repository.baseline)
    original["origins"][0]["before"]["geometry"][0][0] = -999
    original["world"]["facilities"][0]["operatingStatus"] = "closed"
    assert service.repository.baseline == before_pin

    def no_graph_search(*args, **kwargs):
        pytest.fail("Known resident journeys must be reused for presentation/cost changes")

    for network in service._networks.values():
        monkeypatch.setattr(network, "tree", no_graph_search)
    changed = request.model_copy(
        update={
            "assumptions": request.assumptions.model_copy(
                update={
                    "capital_budget_mvr": 10,
                    "target_minutes": 15,
                    "include_origin_geometry": True,
                    "population_year": 2030,
                }
            )
        }
    )
    result = service.evaluate(changed)
    assert len(service._routers) == 1
    assert result["origins"][0]["before"]["geometry"][0][0] != -999
    assert result["world"]["facilities"][0]["operatingStatus"] == "open"
    assert result["summary"]["population"] == 180
    assert result["target_minutes"] == 15
    # A caller may reuse its Pydantic input object after an evaluation.
    request.assumptions.departure_minutes = 600
    assert (
        service.evaluate(PlanningRequest(assumptions={"departure_minutes": 470}))["origins"][0][
            "before"
        ]["minutes"]
        == 20
    )


def test_routing_cache_does_not_cross_goals_calendars_closures_or_stop_moves(service):
    request = PlanningRequest(assumptions={"departure_minutes": 470})
    assert service.evaluate(request)["origins"][0]["after"]["minutes"] == 20
    next_day = request.model_copy(
        update={"assumptions": request.assumptions.model_copy(update={"date": date(2026, 10, 11)})}
    )
    assert service.evaluate(next_day)["origins"][0]["after"]["status"] == "unavailable"
    school = request.model_copy(
        update={"assumptions": request.assumptions.model_copy(update={"goal": "education"})}
    )
    assert service.evaluate(school)["origins"][0]["after"]["status"] == "unavailable"
    moved = request.model_copy(
        update={
            "operations": PlanningRequest(
                operations=[
                    {
                        "type": "move_stop",
                        "target_id": "stop:a",
                        "coordinates": [73.6, 4.17],
                    }
                ]
            ).operations
        }
    )
    assert service.evaluate(moved)["origins"][0]["after"]["status"] == "unavailable"
    # Snapshot edits invalidate content keys even if a version string was not changed.
    service.repository.baseline["transit"]["patterns"][0]["enabled"] = False
    assert service.evaluate(request)["origins"][0]["after"]["status"] == "unavailable"
    assert len(service._routers) <= 4
    assert len(service._networks) <= 2


def test_reverse_destination_search_preserves_directed_walking_paths(service):
    world = baseline_world(service.repository)
    world["network"]["edges"][0]["walkReverseAllowed"] = False
    world["stops"] = []
    world["patterns"] = []
    first, second = world["network"]["nodes"][:2]
    world["facilities"] = [
        dict(
            second,
            id="hospital:b",
            kind="hospital",
            operatingStatus="open",
            verification="official",
            careScope="general",
        )
    ]
    router = JourneyRouter(world, PlanningAssumptions())
    route = router.route(dict(first, id="origin:a"))
    assert route["minutes"] == 12.5
    assert route["geometry"] == [[73.5, 4.17], [73.501, 4.17]]
    world["facilities"][0].update(first, id="hospital:a")
    reverse = JourneyRouter(world, PlanningAssumptions()).route(dict(second, id="origin:b"))
    assert reverse["status"] == "unavailable"


def test_spatial_snap_index_matches_brute_force_and_keeps_tolerance_independent():
    rng = random.Random(61)
    nodes = [
        {
            "id": f"node:{i}",
            "islandId": "a" if i % 2 else "b",
            "lon": 73.5 + rng.uniform(-0.02, 0.02),
            "lat": 4.17 + rng.uniform(-0.02, 0.02),
        }
        for i in range(200)
    ]
    nodes.extend(
        [
            {"id": "date-line", "lon": -179.9999, "lat": 1.0},
            {"id": "pole", "lon": 40.0, "lat": 89.9999},
        ]
    )
    network = WalkingNetwork({"nodes": nodes, "edges": []})
    points = [
        {
            "lon": 73.5 + rng.uniform(-0.02, 0.02),
            "lat": 4.17 + rng.uniform(-0.02, 0.02),
            "islandId": rng.choice([None, "a", "b", ""]),
        }
        for _ in range(50)
    ]
    points.extend([{"lon": 179.9999, "lat": 1.0}, {"lon": 60.0, "lat": 89.9999}])
    for point in points:
        for tolerance in (1, 1000, 100):
            candidates = [
                (node["id"], _distance_m([point["lon"], point["lat"]], [node["lon"], node["lat"]]))
                for node in nodes
                if not point.get("islandId") or node.get("islandId") == point["islandId"]
            ]
            expected = min(candidates, key=lambda item: item[1], default=None)
            if expected and expected[1] > tolerance:
                expected = None
            assert network.snap(point, tolerance) == expected


def test_tree_cache_preserves_direction_and_horizon_and_is_bounded(service):
    raw = copy.deepcopy(service.repository.baseline["network"])
    raw["edges"][0]["walkReverseAllowed"] = False
    network = WalkingNetwork(raw, cache_tree_nodes=3)
    assert network.tree("a", 1000)[0]["b"] == 1000
    assert "b" not in network.tree("a", 999)[0]
    assert "a" not in network.tree("b", 1000)[0]
    assert network.tree("b", 1000, reverse=True)[0]["a"] == 1000
    assert network._cached_nodes <= 3


@pytest.mark.parametrize(
    "operation",
    [
        {"type": "road_closure", "target_id": "edge:a-b", "disabled_modes": ["walk"]},
        {"type": "weather_disruption", "disabled_modes": ["walk"]},
        {"type": "pedestrian_connection", "from_node_id": "a", "to_node_id": "c"},
    ],
)
def test_service_overlay_shares_only_unchanged_graphs(service, operation):
    baseline = copy.deepcopy(service.repository.baseline)
    plain, _ = apply_operations(service.repository, PlanningRequest(), share_unchanged_network=True)
    assert plain["network"] is service.repository.baseline["network"]
    changed, _ = apply_operations(
        service.repository, PlanningRequest(operations=[operation]), share_unchanged_network=True
    )
    assert changed["network"] is not service.repository.baseline["network"]
    assert service.repository.baseline == baseline
    default, _ = apply_operations(service.repository, PlanningRequest())
    default["network"]["nodes"][0]["lon"] = -999
    assert service.repository.baseline == baseline


def test_concurrent_quotes_and_evaluations_keep_draft_budgets_and_access_separate(service):
    pin = copy.deepcopy(service.repository.baseline)
    school = PlanningRequest(
        island_id="island:1443",
        assumptions={
            "goal": "education",
            "departure_minutes": 470,
            "capital_budget_mvr": 25_000_000,
        },
        operations=[{"type": "add_school", "coordinates": [73.5, 4.17]}],
    )
    stop = PlanningRequest(
        island_id="island:1443",
        assumptions={"capital_budget_mvr": 0},
        operations=[{"type": "add_stop", "coordinates": [73.5, 4.17]}],
    )
    baseline = PlanningRequest(assumptions={"departure_minutes": 470})
    tasks = [
        (service.quote, stop),
        (service.quote, school),
        (service.evaluate, school),
        (service.evaluate, baseline),
    ] * 3
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = [pool.submit(method, request) for method, request in tasks]
        results = [future.result(timeout=10) for future in futures]
    for start in range(0, len(results), 4):
        assert results[start]["budget"]["allowed"] is False
        assert results[start + 1]["budget"]["allowed"] is True
        assert results[start + 2]["summary"]["gained_residents"] == 100
        assert results[start + 2]["economics"]["delta"]["capital_mvr"] == 25_000_000
        assert results[start + 3]["origins"][0]["after"]["minutes"] == 20
        assert results[start + 3]["economics"]["delta"]["capital_mvr"] == 0
    assert service.repository.baseline == pin


def test_compact_impact_reuses_full_routes_and_preserves_detail_for_later_journeys(service):
    request = PlanningRequest(assumptions={"departure_minutes": 470})
    detailed = service.evaluate(request)
    compact = request.model_copy(
        update={
            "assumptions": request.assumptions.model_copy(
                update={"include_journey_geometry": False, "include_world": False}
            )
        }
    )
    result = service.evaluate(compact)
    assert len(service._routers) == 1
    assert result["summary"] == detailed["summary"]
    assert result["economics"] == detailed["economics"]
    assert result["world"] == {"facilities": [], "stops": [], "patterns": []}
    for origin in result["origins"]:
        for side in ("before", "after"):
            assert origin[side]["geometry"] == []
            assert all(leg["geometry"] == [] for leg in origin[side]["path"])
    result["origins"][0]["before"]["path"][0]["minutes"] = 9999
    assert service.evaluate(request)["origins"] == detailed["origins"]
    assert (
        service.journey(
            JourneyRequest(
                origin_id="origin:a",
                assumptions={
                    "departure_minutes": 470,
                    "include_journey_geometry": False,
                },
            )
        )["outward"]["geometry"]
        == []
    )
