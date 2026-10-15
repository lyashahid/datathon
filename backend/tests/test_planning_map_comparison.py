"""Map comparisons must reflect actual journeys in the captured island snapshot."""

from pathlib import Path

import pytest

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
