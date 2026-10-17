"""Sea connectivity needs real direction, dated timing and identified transfers."""

import copy
import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from shapely.geometry import box, mapping

from app.api.routes.planning import get_transport_planning, router
from app.planning.repository import PlanningRepository
from app.planning.sea import SeaConnectionsRequest, SeaConnectionsService
from app.planning.sea_data import planning_patterns
from app.planning.service import PlanningService
from app.planning.transport import TransportPlanningService


def route(identity, islands, times, *, terminals=None, status="current", days=None):
    terminals = terminals or [f"terminal:{island}" for island in islands]
    return {
        "id": identity,
        "name": identity,
        "operator": "RTL",
        "source_ids": ["official"],
        "valid_from": "2026-10-01",
        "valid_until": "2026-10-17",
        "status": status,
        "timing_status": "complete_timetable",
        "stops": [
            {"island_id": f"island:{island}", "terminal_id": terminal, "name": island}
            for island, terminal in zip(islands, terminals)
        ],
        "sailings": [
            {
                "id": identity + ":trip",
                "days": list(range(7)) if days is None else days,
                "calls": [
                    {
                        "island_id": f"island:{island}",
                        "terminal_id": terminal,
                        "arrival_minutes": minute,
                        "departure_minutes": minute,
                    }
                    for island, terminal, minute in zip(islands, terminals, times)
                ],
            }
        ],
        "qualifications": [],
    }


@pytest.fixture
def sea(tmp_path):
    baseline = {
        "islands": [{"id": f"island:{i}", "name": str(i)} for i in range(1, 6)],
        "network": {"nodes": [], "edges": []},
        "facilities": [],
        "transit": {"stops": [], "patterns": []},
    }
    (tmp_path / "planning-baseline.json").write_text(json.dumps(baseline), "utf8")
    islands = {
        f"island:{i}": {
            "properties": {"name": f"Island {i}", "centroid": [73.0 + i / 10, 4.2]},
            "geometry": mapping(
                box(73.0 + i / 10 - 0.0005, 4.1995, 73.0 + i / 10 + 0.0005, 4.2005)
            ),
        }
        for i in range(1, 6)
    }
    terminals = [
        {
            "id": f"terminal:{i}",
            "name": f"Terminal {i}",
            "island_id": f"island:{i}",
            "coordinates": [73.0 + i / 10, 4.2],
            "source": "official",
            "evidence": "official_terminal_catalogue",
        }
        for i in range(1, 6)
    ]
    transport = TransportPlanningService(
        SimpleNamespace(islands_by_id=islands, transport={"features": []}),
        SimpleNamespace(marine={"nodes": [], "edges": []}),
        PlanningService(PlanningRepository(tmp_path)),
        SimpleNamespace(catalogue=lambda: {"services": []}),
    )
    transport.terminals = {item["id"]: item for item in terminals}
    transport.planning.repository.ferry_terminals = transport.terminals
    return SeaConnectionsService(transport)


def bundle(sea, routes):
    sea.path.write_text(
        json.dumps(
            {
                "weekday_convention": "monday_zero",
                "routes": routes,
                "sources": [{"id": "official", "title": "RTL timetable", "url": "https://rtl.mv/"}],
            }
        ),
        "utf8",
    )


def query(sea, **changes):
    payload = {
        "origin_island_id": "island:1",
        "date": "2026-10-17",
        "departure_minutes": 480,
        "budget_minutes": 60,
    }
    payload.update(changes)
    return sea.connections(SeaConnectionsRequest.model_validate(payload))


def destination(result, identity, side="baseline"):
    return next(item for item in result[side]["destinations"] if item["id"] == f"island:{identity}")


def test_staying_on_multistop_boat_is_direct_wait_counts_in_budget(sea):
    bundle(sea, [route("one-boat", [1, 2, 3], [490, 510, 530])])
    result = query(sea, budget_minutes=45)
    final = destination(result, 3)
    assert final["status"] == "direct"
    assert final["transfers"] == 0
    assert final["journey"]["total_minutes"] == 50
    assert final["journey"]["wait_minutes"] == 10
    assert final["journey"]["sailing_minutes"] == 40
    assert not final["within_budget"]
    assert result["baseline"]["summary"]["timed_reachable_islands"] == 1
    assert result["baseline"]["summary"]["direct_islands"] == 2


def test_connections_are_directional_and_no_sailings_on_other_weekday(sea):
    bundle(sea, [route("saturday", [1, 2], [490, 510], days=[5])])
    assert destination(query(sea), 2)["within_budget"]
    assert query(sea, origin_island_id="island:2")["baseline"]["destinations"] == []
    tomorrow = destination(query(sea, date="2026-10-16"), 2)
    assert tomorrow["status"] == "direct"
    assert tomorrow["journey"] is None


@pytest.mark.parametrize("changes", [{"date": "2026-10-18"}, {"date": "2026-09-30"}])
def test_no_repeating_timetable_outside_observed_validity(sea, changes):
    bundle(sea, [route("dated", [1, 2], [490, 510])])
    result = query(sea, **changes)
    assert destination(result, 2)["journey"] is None
    assert result["baseline"]["summary"]["timed_reachable_islands"] == 0


def test_historical_and_departure_only_data_stay_visible_without_arrivals(sea):
    historical = route("historical", [1, 2], [490, 510], status="historical")
    departure = route("departure-only", [1, 3], [490, 530])
    departure["sailings"][0]["calls"][1]["arrival_minutes"] = None
    departure["timing_status"] = "departure_only"
    bundle(sea, [historical, departure])
    result = query(sea)
    assert len(result["baseline"]["routes"]) == 2
    assert all(item["journey"] is None for item in result["baseline"]["destinations"])
    assert destination(result, 2)["status"] == "unverified"
    assert result["baseline"]["routes"][0]["published_departures"] == [490]
    assert all(item["evidence"] == "official_route" for item in result["baseline"]["routes"])


def test_open_ended_published_recurrence_is_qualified_future_projection(sea):
    current = route("recurring", [1, 2], [490, 510])
    current["valid_until"] = None
    current["current_as_of"] = "2026-10-17"
    bundle(sea, [current])
    result = query(sea, date="2026-10-18")
    assert destination(result, 2)["within_budget"]
    assert result["baseline"]["routes"][0]["projection_status"] == "published_pattern_projection"
    assert result["baseline"]["routes"][0]["valid_until"] is None


def test_unprinted_endpoint_dwell_is_not_missing_crossing_evidence(sea):
    current = route("printed-arrival-departure", [1, 2], [490, 510])
    current["sailings"][0]["calls"][0]["arrival_minutes"] = None
    current["sailings"][0]["calls"][-1]["departure_minutes"] = None
    bundle(sea, [current])
    journey = destination(query(sea), 2)["journey"]
    assert journey["sailing_minutes"] == 20
    assert journey["arrival_minutes"] == 510


def test_previous_day_overnight_downstream_boarding_is_available_today(sea):
    overnight = route("overnight", [1, 2, 3], [1430, 1450, 1490], days=[4])
    bundle(sea, [overnight])
    result = query(sea, origin_island_id="island:2", departure_minutes=0)
    assert destination(result, 3)["journey"]["departure_minutes"] == 10
    assert destination(result, 3)["journey"]["arrival_minutes"] == 50
    assert result["baseline"]["summary"]["departures_today"] == 1


def test_equivalent_publications_count_sailing_once_without_invented_expiry(sea):
    first = route("old-publication", [1, 2], [490, 510], days=[2, 3])
    first["route_code"] = "R1"
    first["valid_from"] = "2026-10-13"
    first["valid_until"] = None
    first["sailings"][0]["equivalence_key"] = "same-physical-sailing"
    second = copy.deepcopy(first)
    second["id"] = "new-publication"
    second["valid_from"] = "2026-10-17"
    second["sailings"][0]["days"] = [0, 1, 2, 3, 5, 6]
    bundle(sea, [first, second])
    result = query(sea, date="2026-10-21")
    assert len(result["baseline"]["routes"]) == 1
    assert result["baseline"]["summary"]["departures_today"] == 1
    assert result["baseline"]["routes"][0]["source_route_ids"] == [
        "old-publication",
        "new-publication",
    ]
    terminals = {
        identity: {**terminal, "national_island_id": terminal["island_id"]}
        for identity, terminal in sea.transport.terminals.items()
    }
    from app.planning.routing import service_day_trips

    _, patterns = planning_patterns({"routes": [first, second]}, terminals, lambda value: value)
    from datetime import date

    # Wednesday occurrence is counted once; Saturday only starts on the later
    # publication's effective date. No made-up end of operator service appears.
    assert sum(len(service_day_trips(p, date(2026, 10, 21))) for p in patterns) == 1
    assert sum(len(service_day_trips(p, date(2026, 10, 10))) for p in patterns) == 0
    assert sum(len(service_day_trips(p, date(2026, 10, 17))) for p in patterns) == 1
    assert all(p["calendar"]["endDate"] is None for p in patterns)


def test_edit_one_official_sailing_preserves_other_departures(sea):
    service = route("two-sailings", [1, 2], [490, 510])
    sibling = copy.deepcopy(service["sailings"][0])
    sibling["id"] = "later-sailing"
    sibling["calls"][0].update(arrival_minutes=600, departure_minutes=600)
    sibling["calls"][1].update(arrival_minutes=620, departure_minutes=620)
    service["sailings"].append(sibling)
    bundle(sea, [service])
    terminals = {
        identity: {**terminal, "national_island_id": terminal["island_id"]}
        for identity, terminal in sea.transport.terminals.items()
    }
    stops, patterns = planning_patterns({"routes": [service]}, terminals, lambda value: value)
    sea.planning.repository.baseline["transit"] = {"stops": stops, "patterns": patterns}
    result = query(
        sea,
        operations=[{"type": "disable_service", "target_id": patterns[0]["id"]}],
        budget_minutes=180,
    )
    assert result["baseline"]["summary"]["departures_today"] == 2
    assert result["scenario"]["summary"]["departures_today"] == 1
    assert destination(result, 2, "scenario")["journey"]["departure_minutes"] == 600


def test_transfer_needs_same_verified_terminal_and_alignment(sea):
    bundle(sea, [route("first", [1, 2], [490, 510]), route("second", [2, 3], [515, 540])])
    result = query(sea)
    assert destination(result, 3)["journey"]["transfers"] == 1
    assert destination(result, 3)["journey"]["wait_minutes"] == 15
    assert destination(result, 3)["within_budget"]
    # No confirmed movement between two landings on the same island.
    bundle(
        sea,
        [
            route("first", [1, 2], [490, 510]),
            route("second", [2, 3], [515, 540], terminals=[None, "terminal:3"]),
        ],
    )
    assert destination(query(sea), 3)["journey"] is None
    # A missed departure cannot be rescued by the documented network graph.
    bundle(sea, [route("first", [1, 2], [490, 510]), route("second", [2, 3], [511, 540])])
    assert destination(query(sea), 3)["journey"] is None


def test_later_arrival_at_correct_landing_is_preserved(sea):
    sea.transport.terminals["other:2"] = {
        **sea.transport.terminals["terminal:2"],
        "id": "other:2",
    }
    bundle(
        sea,
        [
            route("early-wrong-port", [1, 2], [485, 500], terminals=["terminal:1", "other:2"]),
            route("later-right-port", [1, 2], [490, 510]),
            route("connect", [2, 3], [515, 530]),
        ],
    )
    journey = destination(query(sea), 3)["journey"]
    assert journey["legs"][0]["route_id"] == "later-right-port"
    assert journey["arrival_minutes"] == 530


def test_return_requires_stay_and_valid_timetable_to_same_landing(sea):
    bundle(sea, [route("out", [1, 2], [490, 510]), route("back", [2, 1], [580, 610])])
    result = query(sea, return_deadline_minutes=620, minimum_stay_minutes=60)
    assert destination(result, 2)["return_status"] == "feasible"
    assert destination(result, 2)["return_journey"]["arrival_minutes"] == 610
    missed = query(sea, return_deadline_minutes=600, minimum_stay_minutes=60)
    assert destination(missed, 2)["return_status"] == "not_found"
    late_stay = query(sea, return_deadline_minutes=700, minimum_stay_minutes=80)
    assert destination(late_stay, 2)["return_status"] == "not_found"


def test_proposed_ferry_does_not_mutate_baseline_and_unique_destinations_not_directions(sea):
    bundle(sea, [])
    baseline = copy.deepcopy(sea.planning.repository.baseline)
    operations = [
        {"type": "use_existing_ferry_terminal", "target_id": f"terminal:{i}"} for i in (1, 2)
    ]
    for a, b, departure, arrival in [(1, 2, 490, 510), (2, 1, 580, 600)]:
        operations.append(
            {
                "type": "add_service",
                "service": {
                    "id": f"new:{a}:{b}",
                    "routeId": "new-ferry",
                    "name": "Proposed ferry",
                    "mode": "ferry",
                    "stopIds": [f"terminal:{a}", f"terminal:{b}"],
                    "calendar": {
                        "weekdays": [6],
                        "startDate": "2026-10-17",
                        "endDate": "2026-10-17",
                    },
                    "timing": {
                        "kind": "scheduled",
                        "trips": [
                            {
                                "id": "trip",
                                "stopTimes": [
                                    {"arrivalMinutes": departure, "departureMinutes": departure},
                                    {"arrivalMinutes": arrival, "departureMinutes": arrival},
                                ],
                            }
                        ],
                    },
                },
            }
        )
    result = query(sea, operations=operations, return_deadline_minutes=650)
    assert result["baseline"]["summary"]["timed_reachable_islands"] == 0
    assert result["scenario"]["summary"]["timed_reachable_islands"] == 1
    assert result["comparison"]["newly_reachable_island_ids"] == ["island:2"]
    assert result["comparison"]["unique_destination_delta"] == 1
    assert destination(result, 2, "scenario")["return_status"] == "feasible"
    assert sea.planning.repository.baseline == baseline
    assert query(sea)["scenario"] is None
    assert query(sea)["baseline"]["destinations"] == []


def test_missing_evidence_is_never_no_service_and_vessels_unmatched(sea):
    bundle(sea, [])
    result = query(sea)
    assert not result["coverage"]["origin_documented"]
    assert "does not mean" in result["coverage"]["notes"][0]
    assert result["vessel_assignment"]["status"] == "unmatched"
    assert result["baseline"]["summary"]["timed_reachable_islands"] == 0


def test_unmatched_official_geography_keeps_departure_evidence_without_fake_map_point(sea):
    unmatched = route("official-unmatched-island", [1, 2], [490, 510])
    unmatched["stops"][1].update(island_id=None, terminal_id=None, name="Official unmatched island")
    unmatched["timing_status"] = "departure_only"
    unmatched["sailings"] = []
    unmatched["published_departures"] = [{"days": [5], "departure_minutes": [490, 600]}]
    unmatched["frequency_windows"] = [
        {"days": [5], "start_minutes": 600, "end_minutes": 720, "headway_minutes": 20}
    ]
    bundle(sea, [unmatched])
    result = query(sea)
    assert result["baseline"]["destinations"] == []
    assert result["baseline"]["map_features"]["features"] == []
    record = result["baseline"]["routes"][0]
    assert record["published_departures"] == [490, 600]
    assert record["stops"][1]["coordinates"] is None
    assert record["geometry"] is None
    assert record["frequency_windows"][0]["headway_minutes"] == 20


def test_accepted_official_imports_reuse_published_arrivals_and_invalidate_cache(sea):
    bundle(sea, [])
    assert query(sea)["baseline"]["destinations"] == []
    service = {
        "id": "reviewed-service",
        "name": "Reviewed ferry",
        "mode": "ferry",
        "from_island_id": "island:1",
        "to_island_id": "island:2",
        "from_terminal": "Published landing A",
        "to_terminal": "Published landing B",
        "departure": "08:10:00",
        "arrival": "08:30:00",
        "arrival_day_offset": 0,
        "timing_basis": "published_arrival",
        "weekdays": [6],
        "effective_from": "2026-10-17",
        "effective_until": "2026-10-18",
        "source": {"publisher": "RTL", "url": "https://rtl.mv/"},
    }
    sea.transport.updates.catalogue = lambda: {"services": [service]}
    result = query(sea, return_deadline_minutes=900)
    assert destination(result, 2)["journey"]["total_minutes"] == 30
    assert destination(result, 2)["return_status"] == "unknown"
    service.update(timing_basis="assumed_runtime", arrival=None, runtime_minutes=20)
    assert destination(query(sea), 2)["journey"] is None


def test_only_eligible_complete_identified_timings_enter_existing_planning():
    current = route("current", [1, 2], [490, 510])
    old = route("old", [1, 3], [490, 510], status="historical")
    missing = route("missing", [1, 4], [490, 510], terminals=["terminal:1", None])
    terminals = {
        f"terminal:{i}": {
            "id": f"terminal:{i}",
            "name": str(i),
            "national_island_id": f"island:{i}",
            "coordinates": [73, 4],
        }
        for i in range(1, 5)
    }
    stops, patterns = planning_patterns(
        {"routes": [current, old, missing]}, terminals, lambda value: value
    )
    assert len(stops) == 2
    assert len(patterns) == 1
    assert patterns[0]["routeId"] == "current"
    assert patterns[0]["calendar"]["weekdays"] == [1, 2, 3, 4, 5, 6, 0]


def test_endpoint_validates_inputs_and_returns_map_contract(sea):
    bundle(sea, [route("direct", [1, 2], [490, 510])])
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_transport_planning] = lambda: sea.transport
    client = TestClient(app)
    response = client.post(
        "/api/v1/planning/sea-connections",
        json={"origin_island_id": "island:1", "date": "2026-10-17"},
    )
    assert response.status_code == 200
    features = response.json()["baseline"]["map_features"]["features"]
    assert features[0]["properties"]["kind"] == "sea_route"
    assert features[0]["properties"]["route_id"] == "direct"
    assert features[1]["properties"]["island_id"] == "island:2"
    assert (
        client.post(
            "/api/v1/planning/sea-connections",
            json={
                "origin_island_id": "island:1",
                "date": "2026-10-17",
                "departure_minutes": -1,
            },
        ).status_code
        == 422
    )
