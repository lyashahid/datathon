"""National evidence preloads safe water geometry and qualified supply proxies."""

import copy
import os
from datetime import date, timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from shapely.geometry import LineString, box, mapping, shape

from app.api.routes.planning import get_transport_planning, router
from app.data.computed_cache import ComputedCache, SourceVersion
from app.planning.sea import SeaConnectionsService
from app.planning.sea_network import assess_pressure
from tests.test_sea_connections import bundle, route
from tests.test_sea_connections import sea as sea_fixture

sea = sea_fixture
DAY = date(2026, 10, 17)


def population(sea, totals):
    for island in sea.planning.repository.baseline["islands"]:
        island["population2026"] = totals.get(island["id"])


def weekly_record(identity, stop_ids, departures, **changes):
    record = {
        "id": identity,
        "stops": [{"island_id": identity} for identity in stop_ids],
        "valid_from": "2026-10-01",
        "valid_until": None,
        "validity_status": "current",
        "timing_status": "complete_timetable",
        "evidence": "dated_service",
        "departures": departures,
    }
    record.update(changes)
    return record


def assess(records, totals):
    islands = [{"id": identity, "population2026": value} for identity, value in totals.items()]
    weekly = [(DAY + timedelta(days=offset), copy.deepcopy(records)) for offset in range(7)]
    thresholds = assess_pressure(records, weekly, islands)
    return thresholds, [record["pressure"] for record in records]


def test_pressure_uses_unique_island_population_and_route_start_weekly_departures():
    records = [
        weekly_record("frequent", ["male", "island:2", "island:2"], [480, 600, 720]),
        weekly_record("moderate", ["island:1443", "island:2"], [480, 600]),
        weekly_record("sparse", ["island:1443", "island:2"], [480]),
    ]
    thresholds, pressures = assess(records, {"male": 900, "island:2": 1200})
    assert [pressure["population"] for pressure in pressures] == [2100, 2100, 2100]
    assert [pressure["departures_per_week"] for pressure in pressures] == [21, 14, 7]
    assert [pressure["residents_per_weekly_departure"] for pressure in pressures] == [100, 150, 300]
    assert [pressure["level"] for pressure in pressures] == ["low", "medium", "high"]
    assert thresholds["reference_routes"] == 3
    assert all(
        pressure["capacity"] is None and pressure["ridership"] is None for pressure in pressures
    )
    assert all("not observed ferry passengers" in pressure["explanation"] for pressure in pressures)


@pytest.mark.parametrize("missing", [None, -1, float("nan")])
def test_missing_population_is_unknown_not_zero_or_low_pressure(missing):
    records = [weekly_record("missing", ["island:1", "island:2"], [480])]
    _, [pressure] = assess(records, {"island:1": 100, "island:2": missing})
    assert pressure["population"] is None
    assert pressure["departures_per_week"] == 7
    assert pressure["level"] == "unknown"
    assert pressure["residents_per_weekly_departure"] is None


def test_published_headways_are_estimates_and_overlap_does_not_double_supply():
    record = weekly_record(
        "frequency",
        ["island:1", "island:2"],
        [],
        timing_status="departure_only",
        published_departures=[480, 620],
        frequency_windows=[
            {"start_minutes": 480, "end_minutes": 600, "headway_minutes": 30},
            {"start_minutes": 480, "end_minutes": 600, "headway_minutes": 30},
        ],
    )
    _, [pressure] = assess([record], {"island:1": 100, "island:2": 250})
    # Four interval/headway opportunities, plus the explicit departure outside
    # the interval. The clock at 08:00 is not added to the interval again.
    assert pressure["departures_per_week"] == 35
    assert pressure["frequency_basis"] == "published_headway_estimate"
    assert pressure["headway_minutes"] == 30
    assert "estimated service opportunities" in pressure["explanation"]


def test_unknown_frequency_window_never_becomes_zero_supply_or_known_pressure():
    record = weekly_record(
        "gap",
        ["island:1", "island:2"],
        [],
        timing_status="departure_only",
        frequency_windows=[{"start_minutes": 480, "end_minutes": 600, "headway_minutes": 30}],
        unknown_windows=[{"start_minutes": 600, "end_minutes": 660}],
    )
    _, [pressure] = assess([record], {"island:1": 100, "island:2": 250})
    assert pressure["known_departures_per_week"] == 28
    assert pressure["departures_per_week"] is None
    assert not pressure["frequency_complete"]
    assert pressure["level"] == "unknown"
    assert pressure["headway_minutes"] == 30


def test_historical_and_map_only_routes_do_not_enter_current_supply_or_ranking():
    records = [
        weekly_record("old", ["island:1", "island:2"], [480], validity_status="historical"),
        weekly_record("mapped", ["island:1", "island:2"], [480], evidence="mapped_route"),
    ]
    thresholds, pressures = assess(records, {"island:1": 100, "island:2": 250})
    assert thresholds["reference_routes"] == 0
    assert all(pressure["departures_per_week"] is None for pressure in pressures)
    assert all(pressure["level"] == "unknown" for pressure in pressures)


def test_equal_ratios_do_not_invent_low_and_high_pressure_groups():
    records = [weekly_record(str(i), ["island:1", "island:2"], [480]) for i in range(3)]
    _, pressures = assess(records, {"island:1": 100, "island:2": 250})
    assert all(pressure["level"] == "medium" for pressure in pressures)


def test_network_is_not_filtered_to_selected_component_and_obeys_water_geometry(sea):
    # This third island obstructs a direct chord between the first two ports.
    sea.transport.repository.islands_by_id["island:3"]["geometry"] = mapping(
        box(73.145, 4.19, 73.155, 4.21)
    )
    bundle(
        sea,
        [
            route("obstructed", [1, 2], [490, 510]),
            route("separate-component", [4, 5], [490, 510]),
        ],
    )
    population(sea, {f"island:{i}": i * 100 for i in range(1, 6)})
    result = sea.network(DAY)
    assert {item["id"] for item in result["routes"]} == {"obstructed", "separate-component"}
    lines = [
        item
        for item in result["map_features"]["features"]
        if item["properties"]["kind"] == "sea_route"
    ]
    assert {item["id"] for item in lines} == {"obstructed", "separate-component"}
    obstacle = shape(sea.transport.repository.islands_by_id["island:3"]["geometry"])
    assert all(
        not LineString(item["geometry"]["coordinates"]).intersects(obstacle) for item in lines
    )
    assert all(
        item["properties"]["geometry_basis"] == "coastline_avoiding_planning_corridor"
        for item in lines
    )
    assert result["coverage"]["scope"] == "nationwide_retained_evidence"
    assert result["coverage"]["mapped_routes"] == 2


def test_national_missing_terminal_keeps_evidence_without_centroid_line(sea):
    missing = route("unlocated", [1, 2], [490, 510], terminals=["terminal:1", None])
    bundle(sea, [missing])
    result = sea.network(DAY)
    assert len(result["routes"]) == 1
    assert result["routes"][0]["geometry"] is None
    assert result["routes"][0]["geometry_basis"] == "missing_terminal"
    assert result["map_features"]["features"] == []
    assert result["coverage"]["unmapped_routes"] == 1


def test_equivalent_overlapping_calendars_count_each_weekly_sailing_once(sea):
    first = route("calendar-one", [1, 2], [490, 510])
    second = route("calendar-two", [1, 2], [490, 510])
    for record in (first, second):
        record.update(route_code="Z4R8A", valid_until=None)
        record["sailings"][0]["equivalence_key"] = "same-physical-sailing"
    second["valid_from"] = "2026-10-16"
    bundle(sea, [first, second])
    population(sea, {"island:1": 140, "island:2": 210})
    result = sea.network(DAY)
    assert len(result["routes"]) == 1
    pressure = result["routes"][0]["pressure"]
    assert pressure["departures_per_week"] == 7
    assert pressure["residents_per_weekly_departure"] == 50


def test_network_cache_is_isolated_and_invalidated_by_changed_source_and_population(
    sea, monkeypatch, tmp_path
):
    sea.planning.computed_cache = ComputedCache(tmp_path / "runtime")
    bundle(sea, [route("first", [1, 2], [490, 510])])
    population(sea, {"island:1": 100, "island:2": 250})
    result = sea.network(DAY)
    result["routes"].clear()
    original = sea._official_routes
    monkeypatch.setattr(
        sea, "_official_routes", lambda *_: pytest.fail("Repeated preload should use cache")
    )
    assert len(sea.network(DAY)["routes"]) == 1
    monkeypatch.setattr(sea, "_official_routes", original)
    population(sea, {"island:1": 200, "island:2": 250})
    assert sea.network(DAY)["routes"][0]["pressure"]["population"] == 450
    bundle(sea, [route("replacement-source", [4, 5], [490, 510])])
    assert sea.network(DAY)["routes"][0]["id"] == "replacement-source"


def test_network_persists_across_service_restart_and_source_timestamp_changes(
    sea, monkeypatch, tmp_path
):
    bundle(sea, [route("persisted", [1, 2], [490, 510])])
    sea.planning.computed_cache = ComputedCache(tmp_path / "runtime")
    sea.source_version = SourceVersion(tmp_path / "data", sea.path.parent)
    expected = sea.network(DAY)
    metadata = sea.path.stat()
    os.utime(sea.path, ns=(metadata.st_atime_ns, metadata.st_mtime_ns + 10_000_000))

    # A new deployment can copy identical sources with different timestamps.
    sea.planning.computed_cache = ComputedCache(tmp_path / "runtime", memory_bytes=0)
    restarted = SeaConnectionsService(
        sea.transport, source_version=SourceVersion(tmp_path / "data", sea.path.parent)
    )
    monkeypatch.setattr(
        "app.planning.sea_network._calculate_network",
        lambda *_: pytest.fail("Identical source content should reuse the persisted network"),
    )
    assert restarted.network(DAY) == expected
    assert sea.planning.computed_cache.status()["disk_hits"] == 1


def test_reviewed_schedule_changes_invalidate_both_network_cache_tiers(sea, tmp_path):
    bundle(sea, [])
    sea.planning.computed_cache = ComputedCache(tmp_path / "runtime")
    assert sea.network(DAY)["routes"] == []
    accepted = {
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
    sea.transport.updates.catalogue = lambda: {"services": [accepted]}
    result = sea.network(DAY)
    assert len(result["routes"]) == 1
    assert result["routes"][0]["departures"] == [490]
    accepted["departure"] = "08:15:00"
    assert sea.network(DAY)["routes"][0]["departures"] == [495]
    assert sea.planning.computed_cache.status()["misses"] == 3


def test_network_endpoint_validates_date_and_does_not_require_origin(sea):
    normal = route("national", [1, 2], [490, 510])
    normal["sailings"].append(copy.deepcopy(normal["sailings"][0]))
    overnight = route("overnight", [2, 3], [1430, 1450])
    historical = route("historical", [3, 4], [490, 510], status="historical")
    multistop = route("multistop", [1, 3, 5], [490, 510, 530])
    departure_only = route("departure-only", [4, 5], [490, 510])
    departure_only["timing_status"] = "departure_only"
    assumed = route("assumed", [5, 1], [490, 510])
    assumed["timing_status"] = "assumed_timetable"
    ambiguous = route("ambiguous", [2, 4], [490, 510])
    conflicting = copy.deepcopy(ambiguous["sailings"][0])
    conflicting["id"] = "conflicting-arrival"
    conflicting["calls"][-1].update(arrival_minutes=515, departure_minutes=515)
    ambiguous["sailings"].append(conflicting)
    bundle(sea, [normal, overnight, historical, multistop, departure_only, assumed, ambiguous])
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_transport_planning] = lambda: sea.transport
    client = TestClient(app)
    response = client.get("/api/v1/planning/sea-network?date=2026-10-17")
    assert response.status_code == 200
    assert response.json()["service_date"] == "2026-10-17"
    assert response.json()["routes"][0]["id"] == "national"
    records = {record["id"]: record for record in response.json()["routes"]}
    assert records["national"]["scheduled_sailings"] == [
        {"departure_minutes": 490, "arrival_minutes": 510}
    ]
    assert records["overnight"]["scheduled_sailings"] == [
        {"departure_minutes": -10, "arrival_minutes": 10},
        {"departure_minutes": 1430, "arrival_minutes": 1450},
    ]
    assert all(
        records[identity]["scheduled_sailings"] == []
        for identity in ("historical", "multistop", "departure-only", "assumed", "ambiguous")
    )
    assert client.get("/api/v1/planning/sea-network?date=bad-date").status_code == 422
