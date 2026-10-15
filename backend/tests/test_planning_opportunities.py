"""Policy screening must preserve evidence, geometry, budgets and resident denominators."""

import copy
import json
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from shapely.geometry import Point, shape

from app.api.routes.planning import router
from app.planning.models import PlanningRequest
from app.planning.opportunities import BudgetSuggestionRequest, OpportunityService
from app.planning.repository import PlanningRepository
from app.planning.service import PlanningService


@pytest.fixture
def opportunities(tmp_path):
    nodes = [
        {"id": key, "islandId": "male", "lon": 73.5 + index * 0.01, "lat": 4.17}
        for index, key in enumerate(("a", "b", "c"))
    ]
    land = {
        "type": "Polygon",
        "coordinates": [
            [[73.49, 4.16], [73.53, 4.16], [73.53, 4.18], [73.49, 4.18], [73.49, 4.16]]
        ],
    }
    stops = [dict(nodes[1], id="stop:b", mode="bus"), dict(nodes[2], id="stop:c", mode="bus")]
    baseline = {
        "version": "opportunity-fixture",
        "referenceDate": "2026-10-10",
        "islands": [
            {"id": "male", "name": "Malé", "geometry": land},
            {"id": "hulhule", "name": "Hulhulé", "geometry": land},
        ],
        "network": {
            "nodes": nodes,
            "edges": [
                {
                    "id": f"edge:{first['id']}-{second['id']}",
                    "from": first["id"],
                    "to": second["id"],
                    "distanceM": 2000,
                    "walkAllowed": True,
                    "driveAllowed": True,
                    "geometry": [[first["lon"], first["lat"]], [second["lon"], second["lat"]]],
                }
                for first, second in zip(nodes, nodes[1:])
            ],
        },
        "origins": [
            dict(nodes[0], id="origin:a", population2026=100, population2030=120),
            dict(nodes[1], id="origin:b", population2026=50, population2030=60),
            dict(nodes[2], id="origin:unknown", islandId="hulhule", population2026=None),
        ],
        "facilities": [
            dict(
                nodes[2],
                id="hospital:c",
                kind="hospital",
                operatingStatus="open",
                verification="official",
                careScope="general",
                name="Current hospital",
            ),
        ],
        "transit": {"stops": stops, "patterns": []},
        "assumptions": {
            "populationSpatialDistribution": "Fixture allocations, not observed blocks"
        },
    }
    (tmp_path / "planning-baseline.json").write_text(json.dumps(baseline), encoding="utf8")
    return OpportunityService(PlanningService(PlanningRepository(tmp_path)))


def request(**overrides):
    return BudgetSuggestionRequest(
        **{
            "island_id": "island:1443",
            "capital_budget_mvr": 200_000_000,
            "annual_operating_budget_mvr": 30_000_000,
            **overrides,
        }
    )


def test_zero_budget_never_invents_free_suggestions(opportunities):
    result = opportunities.suggest(request(capital_budget_mvr=0))
    assert result["status"] == "no_eligible_candidates"
    assert result["operations"] == []
    assert result["estimated_gained_residents"] == 0
    assert result["total_capital_mvr"] == 0


def test_missing_population_is_unknown_and_automatic_siting_is_disabled(opportunities):
    result = opportunities.suggest(request(island_id="island:1483"))
    assert result["selected"] == []
    assert result["estimated_gained_residents"] is None
    assert any("no source-backed resident grid" in warning for warning in result["warnings"])
    detail = opportunities.detail("island:1483")
    assert detail["population"] is None
    assert detail["planning_supported"] is False
    assert detail["gap_cells"]["features"] == []


def test_no_mapped_inventory_does_not_become_proven_service_failure(opportunities):
    overview = opportunities.overview()
    airport = next(i for i in overview["islands"] if i["island_id"] == "island:1483")
    assert all(d["status"] == "unknown" and d["score"] is None for d in airport["domains"].values())
    assert airport["priority_score"] is None
    assert airport["population"] is None


def test_compact_overview_preserves_island_data_and_omits_only_map_geometry(opportunities):
    full = opportunities.overview()
    compact = opportunities.overview(include_geometry=False)
    assert full["features"]["features"]
    assert all(feature["geometry"] for feature in full["features"]["features"])
    assert compact == {**full, "features": {"type": "FeatureCollection", "features": []}}


def test_api_can_skip_geometry_without_changing_default_map_response(opportunities):
    app = FastAPI()
    app.state.planning = opportunities.planning
    app.include_router(router)
    client = TestClient(app)
    full = client.get("/api/v1/planning/opportunities")
    compact = client.get("/api/v1/planning/opportunities?include_geometry=false")
    assert full.status_code == compact.status_code == 200
    assert full.json()["features"]["features"]
    assert compact.json() == {
        **full.json(),
        "features": {"type": "FeatureCollection", "features": []},
    }
    assert client.get("/api/v1/planning/opportunities?include_geometry=invalid").status_code == 422


def test_national_screening_preserves_source_score_and_missing_inventory(opportunities):
    feature = {
        "type": "Feature",
        "geometry": opportunities._island("male")["geometry"],
        "properties": {
            "id": "island:1443",
            "name": "Malé",
            "atoll": "Kaafu",
            "category": "Residential Island",
            "centroid": [73.51, 4.17],
        },
    }
    opportunities.accessibility = SimpleNamespace(
        islands={"island:1443": feature},
        facilities=[],
        transport=[],
        source_fingerprint={"fixture": "sha256"},
        default_artifact=lambda: {
            "scores": [
                {
                    "island_id": "island:1443",
                    "population": {
                        "total": 150,
                        "status": "census",
                        "qualification": "Census2022 fixture",
                    },
                    "domains": {
                        "health": {"score": 40},
                        "transport": {"score": 20},
                        "education": {"score": 0},
                    },
                    "missing_data": ["no_geocoded_facility"],
                }
            ]
        },
    )
    overview = opportunities.overview()
    island = overview["islands"][0]
    assert island["domains"]["health"]["status"] == "review"
    assert island["domains"]["health"]["score"] == 40
    assert island["domains"]["education"]["score"] is None
    assert overview["features"]["features"][0]["properties"]["transport_gap"] == 0.8
    assert island["population_basis"] == "Census2022 fixture"


def test_detail_uses_real_walk_distances_and_unknown_facilities(opportunities):
    detail = opportunities.detail("island:1443")
    cells = {f["properties"]["origin_id"]: f["properties"] for f in detail["gap_cells"]["features"]}
    assert cells["origin:a"]["health_minutes"] == 50
    assert cells["origin:a"]["health_status"] == "review"
    assert cells["origin:a"]["transport_minutes"] == 25
    assert cells["origin:a"]["education_minutes"] is None
    assert cells["origin:a"]["education_gap"] is None
    assert sum(c["population"] for c in cells.values()) == 150


def test_candidates_preserve_sources_and_union_residents_across_sectors(opportunities):
    original = copy.deepcopy(opportunities.repository.baseline)
    result = opportunities.suggest(request(priorities=["health", "education"]))
    assert {c["kind"] for c in result["selected"]} == {"hospital", "school"}
    assert result["total_capital_mvr"] == 145_000_000
    assert result["total_annual_operating_mvr"] == 25_000_000
    assert result["estimated_gained_residents"] == 150
    assert sum(c["estimated_gained_residents"] for c in result["selected"]) == 250
    assert opportunities.repository.baseline == original
    land = shape(original["islands"][0]["geometry"])
    assert all(land.covers(Point(c["coordinates"])) for c in result["selected"])
    assert all(c["confidence"] == "screening" and c["review_required"] for c in result["selected"])
    assert result["eligibility"]["statutory_approval"] == "not_assessed"


def test_candidate_facility_gain_matches_canonical_walking_journey(opportunities):
    result = opportunities.suggest(request(priorities=["health"]))
    candidate = result["selected"][0]
    canonical = opportunities.planning.evaluate(
        PlanningRequest(island_id="island:1443", operations=candidate["operations"])
    )
    assert (
        candidate["estimated_gained_residents"] == canonical["summary"]["gained_residents"] == 100
    )


def test_operating_budget_is_enforced_separately(opportunities):
    result = opportunities.suggest(request(priorities=["education"], annual_operating_budget_mvr=0))
    assert result["selected"] == []
    assert result["remaining_annual_operating_mvr"] == 0
    unknown = opportunities.suggest(
        request(priorities=["education"], annual_operating_budget_mvr=None)
    )
    assert len(unknown["selected"]) == 1
    assert unknown["eligibility"]["operating_budget_confirmed"] is False
    assert unknown["eligibility"]["annual_within_budget"] is None


def test_audited_access_does_not_silently_use_untagged_walking_edges(opportunities):
    result = opportunities.suggest(
        request(priorities=["education"], assumptions={"require_audited_wheelchair": True})
    )
    candidate = result["selected"][0]
    canonical = opportunities.planning.evaluate(
        PlanningRequest(
            island_id="island:1443",
            operations=candidate["operations"],
            assumptions={"goal": "education", "require_audited_wheelchair": True},
        )
    )
    assert candidate["estimated_gained_residents"] == canonical["summary"]["gained_residents"]
    assert candidate["estimated_gained_residents"] < 150


def test_increasing_capital_preserves_selected_prefix_and_unique_access(opportunities):
    previous_ids, previous_gain = set(), 0
    for budget in (0, 24_000_000, 25_000_000, 120_000_000, 145_000_000, 200_000_000):
        result = opportunities.suggest(
            request(priorities=["health", "education"], capital_budget_mvr=budget)
        )
        current = {c["id"] for c in result["selected"]}
        assert previous_ids.issubset(current)
        assert result["estimated_gained_residents"] >= previous_gain
        assert result["total_capital_mvr"] <= budget
        assert result["remaining_capital_mvr"] >= 0
        previous_ids, previous_gain = current, result["estimated_gained_residents"]


def test_no_eligible_sites_when_land_or_reachable_network_is_missing(opportunities):
    opportunities.repository.baseline["islands"][0]["geometry"] = None
    result = opportunities.suggest(request())
    assert result["status"] == "no_eligible_candidates"
    assert result["selected"] == []


def test_bus_stop_is_bundled_with_routed_return_service_and_actual_costs(opportunities):
    result = opportunities.suggest(request(priorities=["transport"]))
    assert len(result["selected"]) == 1
    candidate = result["selected"][0]
    assert candidate["kind"] == "bus"
    assert [o["type"] for o in candidate["operations"]] == [
        "add_stop",
        "add_service",
        "add_service",
    ]
    services = [o["service"] for o in candidate["operations"] if o["type"] == "add_service"]
    assert services[0]["stopIds"] == services[1]["stopIds"][::-1]
    assert candidate["capital_mvr"] > 100_000  # Includes actual modeled fleet procurement.
    assert candidate["annual_operating_mvr"] > 0
    assert candidate["estimated_gained_residents"] == 100
    assert len(result["map_features"]["features"]) == 2
    assert all(f["geometry"]["type"] == "LineString" for f in result["map_features"]["features"])
    assert result["map_features"]["features"][0]["geometry"]["coordinates"] == [
        [73.5, 4.17],
        [73.51, 4.17],
    ]


def test_nonfinite_and_out_of_range_budgets_are_rejected_by_api(opportunities):
    app = FastAPI()
    app.state.planning = opportunities.planning
    app.include_router(router)
    client = TestClient(app)
    assert client.get("/api/v1/planning/opportunities").status_code == 200
    assert client.get("/api/v1/planning/opportunities/island:1443").status_code == 200
    assert client.get("/api/v1/planning/opportunities/island:unknown").status_code == 404
    for value in (-1, 1e13):
        response = client.post(
            "/api/v1/planning/opportunities/suggest", json={"capital_budget_mvr": value}
        )
        assert response.status_code == 422
    response = client.post(
        "/api/v1/planning/opportunities/suggest",
        json={
            "capital_budget_mvr": 25_000_000,
            "island_id": "island:1443",
            "priorities": ["education"],
        },
    )
    assert response.status_code == 200
    assert response.json()["selected"][0]["kind"] == "school"
