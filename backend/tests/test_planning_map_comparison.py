"""Map comparisons must reflect actual journeys in the captured island snapshot."""

from pathlib import Path

import pytest

from app.planning.bus_connection import BusConnectionPlanner, BusConnectionRequest
from app.planning.models import PlanningRequest
from app.planning.repository import PlanningRepository
from app.planning.service import PlanningService


@pytest.fixture(scope="module")
def captured_planning():
    public = Path(__file__).resolve().parents[2] / "data" / "public"
    return PlanningService(PlanningRepository(public))


@pytest.mark.parametrize(
    ("goal", "target_minutes", "operation"),
    [("transport", 10, "add_stop"), ("healthcare", 30, "add_hospital")],
)
def test_gap_placement_changes_real_access_without_recoloring_unknown_residents(
    captured_planning, goal, target_minutes, operation
):
    # Northern Hulhumale has source-backed residents beyond both targets. This
    # checks the actual data/map contract rather than an invented gain fixture.
    payload = {
        "island_id": "island:1442",
        "assumptions": {
            "goal": goal,
            "target_minutes": target_minutes,
            "include_journey_geometry": False,
            "include_world": False,
        },
        "operations": [],
    }
    baseline = captured_planning.evaluate(PlanningRequest.model_validate(payload))
    assert all(row["before"] == row["after"] for row in baseline["origins"])
    assert baseline["summary"]["gained_residents"] == 0
    assert baseline["summary"]["lost_residents"] == 0

    payload["operations"] = [
        {
            "type": operation,
            "island_id": "island:1442",
            "coordinates": [73.5379734, 4.2329967],
            "name": "Source snapshot map comparison",
        }
    ]
    if operation == "add_stop":
        connection = BusConnectionPlanner(captured_planning).preview(
            BusConnectionRequest(
                island_id="island:1442",
                coordinates=[73.5379734, 4.2329967],
                assumptions=payload["assumptions"],
            )
        )
        assert connection["status"] == "ready"
        payload["operations"] = connection["operations"]
    proposal = captured_planning.evaluate(PlanningRequest.model_validate(payload))
    gained = [row for row in proposal["origins"] if row["gained_access"]]
    assert gained
    assert all(
        row["before"]["status"] == "reachable"
        and row["before"]["minutes"] > target_minutes
        and row["after"]["status"] == "reachable"
        and row["after"]["minutes"] <= target_minutes
        for row in gained
    )
    assert proposal["summary"]["gained_residents"] == pytest.approx(
        sum(row["population"] for row in gained), abs=0.001
    )
    assert proposal["summary"]["lost_residents"] == 0
    assert proposal["summary"]["unknown_residents"] == baseline["summary"]["unknown_residents"]
    by_origin = {row["origin_id"]: row for row in baseline["origins"]}
    assert all(
        row["before"] == by_origin[row["origin_id"]]["before"] for row in proposal["origins"]
    )
    assert all(
        row["after"]["status"] != "reachable" and not row["gained_access"]
        for row in proposal["origins"]
        if row["before"]["status"] != "reachable"
    )
    # A cached/reused route must not leak the scenario back into Current access.
    payload["operations"] = []
    repeated = captured_planning.evaluate(PlanningRequest.model_validate(payload))
    assert repeated["summary"] == baseline["summary"]
    assert repeated["origins"] == baseline["origins"]


def test_stop_requires_service_and_connected_northern_stop_has_local_gains(captured_planning):
    request = PlanningRequest(
        island_id="island:1442",
        assumptions={
            "goal": "transport",
            "target_minutes": 10,
            "include_journey_geometry": False,
            "include_world": False,
        },
        operations=[
            {
                "type": "add_stop",
                "island_id": "island:1442",
                "coordinates": [73.5379734, 4.2329967],
                "name": "Northern neighborhood stop",
            }
        ],
    )
    stop_only = captured_planning.evaluate(request)
    assert all(row["before"] == row["after"] for row in stop_only["origins"])
    assert stop_only["summary"]["gained_residents"] == 0
    assert stop_only["economics"]["delta"]["capital_mvr"] == 100_000
    assert stop_only["economics"]["delta"]["annual_operating_mvr"] == 0
    connection = BusConnectionPlanner(captured_planning).preview(
        BusConnectionRequest(
            island_id=request.island_id,
            coordinates=request.operations[0].coordinates,
            assumptions=request.assumptions,
        )
    )
    assert connection["status"] == "ready"
    connected = PlanningRequest.model_validate(
        {**request.model_dump(), "operations": connection["operations"]}
    )
    result = captured_planning.evaluate(connected)
    changed = [row for row in result["origins"] if row["before"] != row["after"]]
    assert 0 < len(changed) < len(result["origins"]) / 10
    assert all(row["coordinates"][1] > 4.23 for row in changed)
    assert all(
        row["before"] == row["after"] for row in result["origins"] if row["coordinates"][1] < 4.22
    )
    assert 0 < result["summary"]["gained_residents"] < 1000
    assert result["economics"]["delta"]["capital_mvr"] > 100_000
    assert result["economics"]["delta"]["annual_operating_mvr"] > 0


@pytest.mark.parametrize("state", ["disabled", "wrong_date", "before_hours", "after_hours"])
def test_inactive_proposed_bus_stop_does_not_claim_access(captured_planning, state):
    connection = BusConnectionPlanner(captured_planning).preview(
        BusConnectionRequest(island_id="island:1442", coordinates=[73.5379734, 4.2329967])
    )
    assert connection["status"] == "ready"
    operations = connection["operations"]
    assumptions = {
        "goal": "transport",
        "target_minutes": 10,
        "include_journey_geometry": False,
        "include_world": False,
    }
    if state == "disabled":
        for operation in operations:
            if operation["type"] == "add_service":
                operation["service"]["enabled"] = False
    elif state == "wrong_date":
        assumptions["date"] = "2026-10-11"
    else:
        assumptions["departure_minutes"] = 300 if state == "before_hours" else 1380
    result = captured_planning.evaluate(
        PlanningRequest(island_id="island:1442", assumptions=assumptions, operations=operations)
    )
    assert all(row["before"] == row["after"] for row in result["origins"])
    assert result["summary"]["gained_residents"] == 0


def test_unserved_bus_stop_does_not_claim_healthcare_improvements(captured_planning):
    result = captured_planning.evaluate(
        PlanningRequest(
            island_id="island:1442",
            assumptions={
                "goal": "healthcare",
                "include_journey_geometry": False,
                "include_world": False,
            },
            operations=[
                {
                    "type": "add_stop",
                    "island_id": "island:1442",
                    "coordinates": [73.5379734, 4.2329967],
                }
            ],
        )
    )
    assert all(row["before"] == row["after"] for row in result["origins"])
    assert result["summary"]["gained_residents"] == 0


def test_bus_frequency_does_not_change_walking_access_to_stops(captured_planning):
    pattern = next(
        pattern
        for pattern in captured_planning.repository.baseline["transit"]["patterns"]
        if pattern["mode"] == "bus" and pattern.get("name", "").startswith("R1 ")
    )
    request = PlanningRequest(
        island_id="island:1442",
        assumptions={
            "goal": "transport",
            "target_minutes": 10,
            "include_journey_geometry": False,
            "include_world": False,
        },
        operations=[{"type": "set_frequency", "target_id": pattern["id"], "headway_minutes": 15}],
    )
    result = captured_planning.evaluate(request)
    assert all(row["before"] == row["after"] for row in result["origins"])
    assert result["summary"]["gained_residents"] == 0
    assert result["summary"]["weighted_minutes_saved"] == 0
    assert result["economics"]["delta"]["annual_operating_mvr"] > 0
