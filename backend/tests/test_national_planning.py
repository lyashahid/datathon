"""Shipped national data must reach the real heatmap and proposal models."""

import json
from collections import defaultdict
from pathlib import Path

import pytest
from shapely.geometry import shape
from shapely.ops import unary_union

from app.planning.display_grid import build_display_grid
from app.planning.models import PlanningRequest
from app.planning.national_infrastructure import planning_facilities, planning_network
from app.planning.opportunities import OpportunityService
from app.planning.repository import PlanningRepository
from app.planning.service import PlanningService

PUBLIC = Path(__file__).resolve().parents[2] / "data/public"


@pytest.fixture(scope="module")
def national():
    repository = PlanningRepository(PUBLIC)
    service = PlanningService(repository)
    return repository, service, OpportunityService(service)


def test_all_prepared_islands_are_runtime_origins_and_capital_is_preserved(national):
    repository, _, _ = national
    original = json.loads((PUBLIC / "planning-baseline.json").read_text(encoding="utf-8"))
    prepared = json.loads((PUBLIC / "national-population-origins.json").read_text(encoding="utf-8"))
    assert len(prepared["islands"]) == 186
    assert repository.baseline["origins"][: len(original["origins"])] == original["origins"]
    assert (
        repository.baseline["network"]["nodes"][: len(original["network"]["nodes"])]
        == original["network"]["nodes"]
    )
    supported = {o["islandId"] for o in repository.baseline["origins"]}
    assert all(i["id"] in supported for i in prepared["islands"])
    assert (
        repository.population_basis("male")
        == original["assumptions"]["populationSpatialDistribution"]
    )


@pytest.mark.parametrize("identity", ["island:1152", "island:697"])
def test_both_hithadhoos_have_conserved_hex_models_and_real_routes(national, identity):
    repository, service, opportunities = national
    detail = opportunities.detail(identity)
    assert detail and detail["planning_supported"]
    assert detail["hex_grid"]["features"]
    assert detail["gap_cells"]["features"]
    assert detail["coverage"]["walking_nodes"] > 0
    summary = repository.summary(identity)
    assert summary["counts"]["nodes"] == detail["coverage"]["walking_nodes"]
    assert summary["counts"]["nodes"] < len(repository.baseline["network"]["nodes"])
    if identity == "island:1152":
        assert detail["coverage"]["scheduled_patterns"] == 0
        assert detail["coverage"]["timetable_status"] == "unavailable"
    else:
        # L. Hithadhoo has the published RTL Z4R17 timetable; S. Hithadhoo
        # has only the historical S610 route evidence and remains untimed.
        assert detail["coverage"]["scheduled_patterns"] == 2
        assert detail["coverage"]["timetable_status"] == "available"
    island = next(i for i in repository.baseline["islands"] if i["id"] == identity)
    evaluation = service.evaluate(PlanningRequest(island_id=identity))
    assert evaluation["summary"]["population"] == pytest.approx(island["population2026"], abs=0.001)
    assert any(
        f["properties"]["health_minutes"] is not None for f in detail["gap_cells"]["features"]
    )
    if identity == "island:1152":
        assert detail["journey_population_basis"]["spatial_quality"] == "coarse_assumption"
        assert detail["journey_population_basis"]["rasterAccepted"] is False
        assert all(
            f["properties"]["distribution_unavailable"] for f in detail["gap_cells"]["features"]
        )
        assert detail["coverage"]["transport_stops"] > 0
        display_land = unary_union(
            [shape(row["geometry"]) for row in detail["hex_grid"]["features"]]
        )
        source_support = unary_union(
            [
                shape(row["geometry"])
                for row in repository.baseline["origins"]
                if row["islandId"] == identity
            ]
        )
        assert display_land.area > source_support.area * 5
        assert display_land.difference(shape(island["geometry"])).area < 1e-10


def test_unmatched_official_institutions_never_get_fictional_coordinates():
    facilities, exclusions = planning_facilities(
        [
            {"id": "unknown", "category": "school", "island_id": "island:1152"},
            {
                "id": "ambiguous",
                "category": "school",
                "island_id": "island:1152",
                "geometry": {"type": "Point", "coordinates": [73.09, -0.61]},
                "match_status": "osm_provisional_review_required",
            },
        ]
    )
    assert facilities == []
    assert exclusions == {"unlocated": 1, "unreviewed_location_match": 1}


def test_real_hithadhoo_school_proposal_preserves_scope_and_2030_resident_basis(national):
    repository, service, _ = national
    identity = "island:1152"
    origins = [
        origin for origin in repository.baseline["origins"] if origin["islandId"] == identity
    ]
    origin = max(origins, key=lambda row: row["population2030"])
    before = service._digest(repository.baseline)
    result = service.evaluate(
        PlanningRequest.model_validate(
            {
                "island_id": identity,
                "assumptions": {
                    "goal": "education",
                    "population_year": 2030,
                    "target_minutes": 5,
                    "include_journey_geometry": False,
                },
                "operations": [
                    {
                        "type": "add_school",
                        "island_id": identity,
                        "coordinates": [origin["lon"], origin["lat"]],
                    }
                ],
            }
        )
    )
    assert result["status"] == "partial"
    assert result["summary"]["population"] == pytest.approx(
        sum(row["population2030"] for row in origins), abs=0.001
    )
    assert result["summary"]["gained_residents"] > 0
    assert result["summary"]["lost_residents"] == 0
    assert {row["national_island_id"] for row in result["origins"]} == {identity}
    assert {row["island_id"] for row in result["origins"]} == {identity}
    assert result["population_basis"]["population_year"] == 2030
    assert result["population_basis"]["spatial_quality"] == "coarse_assumption"
    assert result["coverage"]["timetable_status"] == "unavailable"
    assert result["economics"]["delta"]["capital_mvr"] == 25_000_000
    assert result["economics"]["delta"]["annual_operating_mvr"] == 5_000_000
    assert result["economics"]["delta"]["annual_facility_operating_kg_co2e"] is None
    assert service._digest(repository.baseline) == before


@pytest.mark.parametrize("selected_date", ["2026-10-10", "2026-10-16"])
def test_hithadhoo_has_no_capital_bus_calendar_claim(national, selected_date):
    repository, service, _ = national
    request = PlanningRequest(
        island_id="island:1152",
        assumptions={"date": selected_date, "include_journey_geometry": False},
    )
    coverage = service.coverage(request)
    assert coverage["scheduled_patterns"] == 0
    assert coverage["bus_calendar"] == "unavailable"
    assert coverage["timetable_status"] == "unavailable"
    result = service.evaluate(request)
    assert not any("bus snapshot" in warning for warning in result["warnings"])
    assert not any(
        "remaining-departure snapshot" in warning
        for warning in repository.summary("island:1152")["warnings"]
    )
    capital = service.coverage(
        PlanningRequest(
            island_id="male",
            assumptions={"date": selected_date},
        )
    )
    assert capital["bus_calendar"] == (
        "remaining_departures_only"
        if selected_date == "2026-10-10"
        else "no_recurring_calendar_verified"
    )


def test_every_additional_island_has_valid_land_clipped_population_conserving_hexagons(national):
    repository, _, _ = national
    grouped = defaultdict(list)
    for origin in repository.national_population["origins"]:
        grouped[origin["islandId"]].append(origin)
    assert len(grouped) == 186
    for identity, origins in grouped.items():
        island = next(row for row in repository.baseline["islands"] if row["id"] == identity)
        grid = build_display_grid(
            origins, scope=identity, island_id=identity, display_boundary=island["geometry"]
        )
        assert grid["features"], identity
        land = shape(island["geometry"])
        shares = defaultdict(float)
        for cell in grid["features"]:
            polygon = shape(cell["geometry"])
            assert polygon.is_valid and not polygon.is_empty, (identity, cell["id"])
            assert polygon.geom_type in {"Polygon", "MultiPolygon"}, (identity, cell["id"])
            assert polygon.difference(land).area < 1e-12, (identity, cell["id"])
            assert cell["properties"]["contributions"], (identity, cell["id"])
            for contribution in cell["properties"]["contributions"]:
                shares[contribution["origin_id"]] += contribution["share"]
        assert set(shares) == {origin["id"] for origin in origins}, identity
        assert all(abs(value - 1) < 1e-8 for value in shares.values()), identity
        for year in (2026, 2030):
            allocated = sum(
                origin[f"population{year}"] * shares[origin["id"]] for origin in origins
            )
            expected = sum(origin[f"population{year}"] for origin in origins)
            assert allocated == pytest.approx(expected, abs=1e-5), identity


def test_national_car_oneway_preserves_two_way_walking():
    graph = {
        "islands": {
            "island:1152": {
                "nodes": [
                    {"id": "a", "coordinates": [73.09, -0.61]},
                    {"id": "b", "coordinates": [73.091, -0.61]},
                ],
                "edges": [
                    {
                        "id": "land:test",
                        "source_way_id": "10",
                        "from_id": "a",
                        "to_id": "b",
                        "distance_m": 111,
                        "geometry": [[73.09, -0.61], [73.091, -0.61]],
                        "permissions": {"walk": True, "car": True},
                    }
                ],
            }
        }
    }
    edge = planning_network(graph, {"10": {"highway": "residential", "oneway": "yes"}})["edges"][0]
    assert edge["walkForwardAllowed"] and edge["walkReverseAllowed"]
    assert edge["driveForwardAllowed"] and not edge["driveReverseAllowed"]
