"""Service improvements are dated evidence, independent of resident walk gains."""

import copy

import pytest

from app.planning.models import PlanningAssumptions, PlanningRequest
from app.planning.transport_impact import transport_impact
from tests.test_planning import service  # noqa: F401
from tests.test_transport_planning import draft, transport  # noqa: F401


def _world(*, mode="bus", headway=30, start=600, end=721, islands=None):
    islands = islands or ["hulhumale", "hulhumale"]
    stop_ids = [f"stop:{index}" for index in range(len(islands))]
    return {
        "stops": [
            {"id": identity, "name": f"Stop {index}", "islandId": island}
            for index, (identity, island) in enumerate(zip(stop_ids, islands))
        ],
        "patterns": [
            {
                "id": "service:test",
                "routeId": "route:test",
                "name": "Test route",
                "mode": mode,
                "stopIds": stop_ids,
                "calendar": {"includedDates": ["2026-10-10"]},
                "timing": {
                    "kind": "frequency",
                    "segmentMinutes": [10] * (len(islands) - 1),
                    "windows": [
                        {"startMinutes": start, "endMinutes": end, "headwayMinutes": headway}
                    ],
                },
            }
        ],
    }


def _impact(before, after, **assumptions):
    return transport_impact(
        before,
        after,
        PlanningAssumptions(departure_minutes=607, **assumptions),
        island_id="island:1442",
    )


def test_frequency_reduces_waits_without_inventing_resident_gains():
    before, after = _world(), _world(headway=15)
    result = _impact(before, after)
    line = result["lines"][0]
    assert line["change"] == "improved"
    assert line["before"]["departure_count"] == 5
    assert line["after"]["departure_count"] == 9
    assert line["before"]["expected_wait_minutes"] == 15
    assert line["after"]["expected_wait_minutes"] == 7.5
    assert line["expected_wait_saved_minutes"] == 7.5
    assert line["before"]["next_wait_minutes"] == 23
    assert line["after"]["next_wait_minutes"] == 8
    assert result["connections"] == []
    assert "gained_residents" not in result["summary"]


def test_irregular_timetable_integrates_gaps_instead_of_half_mean_headway():
    before = _world()
    pattern = before["patterns"][0]
    pattern["timing"] = {
        "kind": "scheduled",
        "trips": [
            {
                "id": f"trip:{minute}",
                "stopTimes": [
                    {"arrivalMinutes": minute, "departureMinutes": minute},
                    {"arrivalMinutes": minute + 10, "departureMinutes": minute + 10},
                ],
            }
            for minute in [600, 610, 660]
        ],
    }
    result = _impact(before, before)
    line = result["lines"][0]
    # (10^2 + 50^2) / (2 * 60), not mean(headway)/2 = 15.
    assert line["before"]["expected_wait_minutes"] == pytest.approx(21.667)
    assert line["change"] == "unchanged"
    assert line["expected_wait_saved_minutes"] == 0
    assert result["summary"]["changed_lines"] == 0


def test_wait_savings_use_common_operating_interval():
    before = _world(start=600, end=781, headway=60)
    after = _world(start=660, end=721, headway=15)
    line = _impact(before, after)["lines"][0]
    assert line["expected_wait_comparable"]
    assert line["before"]["expected_wait_window_start_minutes"] == 660
    assert line["after"]["expected_wait_window_start_minutes"] == 660
    assert line["before"]["expected_wait_window_end_minutes"] == 720
    assert line["after"]["expected_wait_window_end_minutes"] == 720
    assert line["expected_wait_saved_minutes"] == 22.5


def test_nonoverlapping_hours_do_not_claim_saved_wait():
    line = _impact(_world(), _world(start=900, end=1021, headway=15))["lines"][0]
    assert line["expected_wait_comparable"] is False
    assert line["expected_wait_saved_minutes"] is None
    assert "No shared" in line["expected_wait_comparison_reason"]


def test_changed_boarding_locations_do_not_claim_saved_wait():
    before = _world()
    after = _world(headway=15)
    after["stops"][0]["id"] = "new-stop"
    after["patterns"][0]["stopIds"][0] = "new-stop"
    line = _impact(before, after)["lines"][0]
    assert not line["expected_wait_comparable"]
    assert line["expected_wait_saved_minutes"] is None


def test_reducing_frequency_shows_harm_as_negative_savings():
    line = _impact(_world(headway=15), _world(headway=60))["lines"][0]
    assert line["change"] == "worsened"
    assert line["expected_wait_saved_minutes"] == -22.5
    assert line["after"]["departure_count"] < line["before"]["departure_count"]


@pytest.mark.parametrize("inactive", ["wrong_date", "disabled", "excluded"])
def test_inactive_service_does_not_claim_wait_or_connection_benefits(inactive):
    before = _world(mode="ferry", islands=["hulhumale", "male"])
    after = copy.deepcopy(before)
    after["patterns"][0]["timing"]["windows"][0]["headwayMinutes"] = 15
    assumptions = {}
    if inactive == "wrong_date":
        assumptions["date"] = "2026-10-11"
    elif inactive == "disabled":
        before["patterns"][0]["enabled"] = after["patterns"][0]["enabled"] = False
    else:
        before["patterns"][0]["calendar"]["excludedDates"] = ["2026-10-10"]
        after["patterns"][0]["calendar"]["excludedDates"] = ["2026-10-10"]
    result = _impact(before, after, **assumptions)
    assert result["lines"] == []
    assert result["connections"] == []
    assert result["summary"]["changed_lines"] == 0


def test_multistop_connections_are_directed_and_do_not_double_count_island_stops():
    after = _world(mode="ferry", islands=["hulhumale", "hulhumale", "male", "vilimale"])
    result = _impact({"stops": [], "patterns": []}, after)
    connections = {
        (row["from_island_id"], row["to_island_id"]): row for row in result["connections"]
    }
    assert set(connections) == {
        ("island:1442", "island:1443"),
        ("island:1442", "island:1382"),
        ("island:1443", "island:1382"),
    }
    assert result["summary"]["added_connections"] == 3
    assert connections[("island:1442", "island:1443")]["after"]["departure_count"] == 5
    assert connections[("island:1442", "island:1382")]["after"]["crossing_minutes"] == 30
    assert all(row["expected_wait_saved_minutes"] is None for row in connections.values())


def test_single_departure_reports_next_wait_but_no_expected_wait():
    after = _world(start=630, end=631, mode="ferry", islands=["hulhumale", "male"])
    line = _impact({"stops": [], "patterns": []}, after)["lines"][0]
    assert line["after"]["departure_count"] == 1
    assert line["after"]["next_wait_minutes"] == 23
    assert line["after"]["expected_wait_minutes"] is None
    assert not line["expected_wait_comparable"]


def test_after_last_departure_does_not_invent_tomorrow_wait():
    before = _world(end=601)
    line = _impact(before, before)["lines"][0]
    assert line["before"]["next_departure_minutes"] is None
    assert line["before"]["next_wait_minutes"] is None


def test_pickup_dropoff_and_disabled_stops_control_connections():
    before = _world(mode="ferry", islands=["hulhumale", "male", "vilimale"])
    after = copy.deepcopy(before)
    after["stops"][1]["pickupAllowed"] = False
    after["stops"][2]["disabled"] = True
    result = transport_impact(before, after, PlanningAssumptions())
    changes = {
        (row["from_island_id"], row["to_island_id"]): row["change"] for row in result["connections"]
    }
    assert changes[("island:1442", "island:1382")] == "removed"
    assert changes[("island:1443", "island:1382")] == "removed"
    assert changes[("island:1442", "island:1443")] == "unchanged"


def test_overnight_downstream_boarding_belongs_to_selected_civil_day():
    before = _world(mode="ferry", islands=["hulhumale", "male", "vilimale"], start=1435, end=1436)
    before["patterns"][0]["calendar"] = {"includedDates": ["2026-10-09"]}
    result = transport_impact(before, before, PlanningAssumptions())
    assert result["lines"] == []  # The route's first stop departed yesterday.
    assert len(result["connections"]) == 1
    row = result["connections"][0]
    assert row["from_island_id"] == "island:1443"
    assert row["to_island_id"] == "island:1382"
    assert row["after"]["first_departure_minutes"] == 5


def test_distinct_terminals_are_not_blended_into_invented_passenger_wait():
    before = _world(mode="ferry", islands=["hulhumale", "male"])
    after = copy.deepcopy(before)
    new = copy.deepcopy(after["patterns"][0])
    new["id"] = "second:service"
    new["stopIds"] = ["another-terminal", "stop:1"]
    new["timing"]["windows"][0]["startMinutes"] = 615
    after["stops"].append(
        {"id": "another-terminal", "name": "Different terminal", "islandId": "hulhumale"}
    )
    after["patterns"].append(new)
    result = _impact(before, after)
    row = result["connections"][0]
    assert row["after"]["departure_count"] == 9
    assert row["after"]["expected_wait_minutes"] is None
    assert row["expected_wait_saved_minutes"] is None
    assert row["expected_wait_comparable"] is False
    assert "Different boarding" in row["expected_wait_comparison_reason"]
    # Each directional line still has a valid stop-specific waiting estimate.
    assert all(line["after"]["expected_wait_minutes"] == 15 for line in result["lines"])


def test_changed_destination_terminal_does_not_claim_comparable_connection_wait():
    before = _world(mode="ferry", islands=["hulhumale", "male"])
    after = _world(mode="ferry", islands=["hulhumale", "male"], headway=15)
    after["stops"][1]["id"] = "another-destination"
    after["patterns"][0]["stopIds"][1] = "another-destination"
    row = _impact(before, after)["connections"][0]
    assert row["after"]["expected_wait_minutes"] == 7.5
    assert row["expected_wait_saved_minutes"] is None
    assert row["expected_wait_comparable"] is False
    assert "Different boarding" in row["expected_wait_comparison_reason"]


def test_island_scope_excludes_unrelated_baseline_but_includes_edited_service():
    before = _world(islands=["male", "male"])
    assert _impact(before, before)["lines"] == []
    after = _world(islands=["male", "male"], headway=15)
    assert len(_impact(before, after)["lines"]) == 1


def test_line_wait_reference_uses_first_boardable_stop_on_selected_island():
    before = _world(islands=["male", "hulhumale", "male"])
    after = _world(islands=["male", "hulhumale", "male"], headway=15)
    local = _impact(before, after)["lines"][0]
    assert local["from_stop_name"] == "Stop 1"
    assert local["to_stop_name"] == "Stop 2"
    assert local["before"]["first_departure_minutes"] == 610
    assert local["before"]["next_wait_minutes"] == 3
    assert local["expected_wait_saved_minutes"] == 7.5
    global_line = transport_impact(before, after, PlanningAssumptions())["lines"][0]
    assert global_line["from_stop_name"] == "Stop 0"
    assert global_line["before"]["first_departure_minutes"] == 600


def test_quote_and_evaluation_expose_same_service_benefits_without_walking_gain(service):  # noqa: F811
    baseline = service.repository.baseline
    baseline["transit"]["patterns"][0]["timing"] = _world()["patterns"][0]["timing"]
    request = PlanningRequest(
        island_id="island:1443",
        assumptions={"goal": "transport", "departure_minutes": 607},
        operations=[
            {"type": "set_frequency", "target_id": "service:stop:a", "headway_minutes": 15}
        ],
    )
    quote = service.quote(request)
    evaluation = service.evaluate(request)
    assert (
        quote["transport_connectivity"]["impact"] == evaluation["transport_connectivity"]["impact"]
    )
    assert evaluation["summary"]["gained_residents"] == 0
    row = next(
        row
        for row in evaluation["transport_connectivity"]["impact"]["lines"]
        if row["id"] == "service:stop:a"
    )
    assert row["expected_wait_saved_minutes"] == 7.5


def test_ferry_preview_shows_two_directed_links_and_real_island_names(transport):  # noqa: F811
    preview = draft(transport)
    impact = preview["quote"]["transport_connectivity"]["impact"]
    assert impact["summary"]["added_connections"] == 2
    assert (
        impact["summary"]["departures_after"] == 2 * preview["summary"]["departures_each_direction"]
    )
    assert {row["from_island_name"] for row in impact["connections"]} == {
        "Hulhumalé",
        "Test Island",
    }
    assert all(
        row["after"]["crossing_minutes"] == preview["summary"]["crossing_minutes"]
        for row in impact["connections"]
    )


def test_timetable_summary_does_not_mutate_world():
    before, after = _world(), _world(headway=15)
    original = copy.deepcopy((before, after))
    _impact(before, after)
    assert (before, after) == original
