"""Calendar-day summaries and split service-window edits agree with timetables."""

import copy
from datetime import date

import pytest

from app.planning.models import PlanningAssumptions, PlanningRequest
from app.planning.routing import pattern_trips, service_day_trips
from app.planning.transport import transport_summary
from app.planning.world import apply_operations
from tests.test_planning import service  # noqa: F401
from tests.test_transport_planning import transport  # noqa: F401


def _scheduled_pattern(day, departure, arrival):
    return {
        "id": "test:daily",
        "routeId": "test:route",
        "name": "Test service",
        "mode": "ferry",
        "stopIds": ["first", "second"],
        "calendar": {"includedDates": [day]},
        "timing": {
            "kind": "scheduled",
            "trips": [
                {
                    "id": "one",
                    "stopTimes": [
                        {"arrivalMinutes": departure, "departureMinutes": departure},
                        {"arrivalMinutes": arrival, "departureMinutes": arrival},
                    ],
                }
            ],
        },
    }


@pytest.mark.parametrize(
    ("scheduled_day", "departure", "arrival", "expected_count"),
    [
        ("2026-10-11", 360, 400, 0),  # Tomorrow's early service is not today's departure.
        ("2026-10-09", 1430, 1460, 0),  # Yesterday's sailing can still be arriving today.
        ("2026-10-09", 1450, 1470, 1),  # An overnight service-day departure occurs today.
        ("2026-10-10", 360, 400, 1),
    ],
)
def test_transport_summary_counts_only_departures_on_selected_day(
    scheduled_day, departure, arrival, expected_count
):
    pattern = _scheduled_pattern(scheduled_day, departure, arrival)
    world = {
        "stops": [
            {"id": "first", "islandId": "male"},
            {"id": "second", "islandId": "vilimale"},
        ],
        "patterns": [pattern],
    }
    result = transport_summary(world, PlanningAssumptions())

    assert sum(line["departure_count"] for line in result["lines"]) == expected_count
    assert result["inter_island_lines"] == expected_count
    assert len(service_day_trips(pattern, date(2026, 10, 10))) == expected_count


def test_daily_count_does_not_include_neighbouring_service_days():
    pattern = _scheduled_pattern("2026-10-10", 360, 400)
    pattern["calendar"] = {"weekdays": list(range(7))}
    day = date(2026, 10, 10)

    assert len(pattern_trips(pattern, day)) == 2  # Router's cross-midnight horizon.
    assert len(service_day_trips(pattern, day)) == 1


def test_connectivity_checks_each_boarding_departure_day_and_disabled_stops(transport):  # noqa: F811
    baseline = transport.planning.repository.baseline
    pattern = _scheduled_pattern("2026-10-09", 1430, 1450)
    pattern["stopIds"] = ["first", "second", "third"]
    pattern["timing"]["trips"][0]["stopTimes"].append(
        {"arrivalMinutes": 1470, "departureMinutes": 1470}
    )
    baseline["transit"] = {
        "stops": [
            {"id": "first", "islandId": "hulhumale", "lon": 73.54, "lat": 4.22},
            {"id": "second", "islandId": "island:500", "lon": 73.6, "lat": 4.3},
            {"id": "third", "islandId": "island:501", "lon": 73.65, "lat": 4.4},
        ],
        "patterns": [pattern],
    }

    links = transport._links(date(2026, 10, 10))
    assert [(link["from_island_id"], link["to_island_id"]) for link in links] == [
        ("island:500", "island:501")
    ]
    assert links[0]["departure_count"] == 1
    baseline["transit"]["stops"][1]["disabled"] = True
    assert transport._links(date(2026, 10, 10)) == []


@pytest.mark.parametrize(
    ("start", "end", "expected"),
    [
        (400, 1100, [(400, 540, 10), (960, 1100, 20)]),
        (300, 1260, [(300, 540, 10), (960, 1260, 20)]),
        (400, 500, [(400, 500, 10)]),
        (1000, 1100, [(1000, 1100, 20)]),
    ],
)
def test_edit_split_operating_hours_preserves_service_gaps_and_frequencies(
    service,  # noqa: F811
    start,
    end,
    expected,
):
    pattern = service.repository.baseline["transit"]["patterns"][0]
    pattern["timing"] = {
        "kind": "frequency",
        "segmentMinutes": [10],
        "windows": [
            {"startMinutes": 360, "endMinutes": 540, "headwayMinutes": 10},
            {"startMinutes": 960, "endMinutes": 1200, "headwayMinutes": 20},
        ],
    }
    original = copy.deepcopy(pattern)
    request = PlanningRequest(
        operations=[
            {
                "type": "set_hours",
                "target_id": pattern["id"],
                "start_minutes": start,
                "end_minutes": end,
            }
        ]
    )

    world, _ = apply_operations(service.repository, request)
    windows = world["patterns"][0]["timing"]["windows"]
    assert [
        (window["startMinutes"], window["endMinutes"], window["headwayMinutes"])
        for window in windows
    ] == expected
    assert pattern == original


def test_edit_hours_within_split_service_gap_requires_explicit_new_timetable(service):  # noqa: F811
    pattern = service.repository.baseline["transit"]["patterns"][0]
    pattern["timing"] = {
        "kind": "frequency",
        "segmentMinutes": [10],
        "windows": [
            {"startMinutes": 360, "endMinutes": 540, "headwayMinutes": 10},
            {"startMinutes": 960, "endMinutes": 1200, "headwayMinutes": 20},
        ],
    }
    request = PlanningRequest(
        operations=[
            {
                "type": "set_hours",
                "target_id": pattern["id"],
                "start_minutes": 600,
                "end_minutes": 900,
            }
        ]
    )

    with pytest.raises(ValueError, match="entirely between existing service windows"):
        apply_operations(service.repository, request)
