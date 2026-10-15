import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.accessibility.config import AccessibilityConfig
from app.accessibility.service import AccessibilityService
from app.api.routes.accessibility import get_accessibility, router
from app.routing.engine import RoutingRepository


def test_default_artifact_rejects_stale_population_and_source_snapshots(tmp_path: Path) -> None:
    service = _service(tmp_path)
    derived = tmp_path / "cache" / "derived"
    derived.mkdir()
    path = derived / "accessibility-default.json"
    stale = service.score_national()
    stale["population_transform_version"] = "old-name-only-mapping"
    stale["scores"][0]["score"] = 999
    path.write_text(json.dumps(stale), encoding="utf-8")
    refreshed = service.default_artifact()
    assert refreshed["scores"][0]["score"] == pytest.approx(77.78, abs=0.01)
    assert service.default_artifact() is refreshed

    service._default_artifact = None
    stale = service.score_national()
    stale["source_fingerprint"] = {"normalized/population.json": "outdated-input"}
    stale["scores"][0]["score"] = 999
    path.write_text(json.dumps(stale), encoding="utf-8")
    assert service.default_artifact()["scores"][0]["score"] == pytest.approx(77.78, abs=0.01)


def _service(tmp_path: Path) -> AccessibilityService:
    service = AccessibilityService(tmp_path, RoutingRepository(tmp_path))
    service.islands = {"island:1": {"properties": {"id": "island:1", "centroid": [73.0, 3.0]}}}
    service.facilities = [
        {
            "id": "facility:hospital",
            "island_id": "island:1",
            "category": "hospital",
            "geometry": {"type": "Point", "coordinates": [73.0, 3.0]},
            "geometry_quality": "osm_matched",
        },
        {
            "id": "facility:school",
            "island_id": "island:1",
            "category": "school",
            "geometry": {"type": "Point", "coordinates": [73.0, 3.0]},
            "geometry_quality": "osm_matched",
        },
    ]
    service.transport = [{"id": "bus:1", "island_id": "island:1", "category": "bus_stop"}]
    service.anchors = [
        {
            "island_id": "island:1",
            "geometry": {"type": "Point", "coordinates": [73.0, 3.0]},
            "weight": 1.0,
        }
    ]
    return service


def test_default_accessibility_uses_equal_domain_weights(tmp_path: Path) -> None:
    result = _service(tmp_path).score_island("island:1")

    assert result is not None
    assert result["config"]["health_weight"] == pytest.approx(1 / 3)
    assert result["domains"]["health"]["score"] == 100.0
    assert result["domains"]["education"]["score"] == 100.0
    assert result["domains"]["transport"]["score"] == pytest.approx(33.33)
    assert result["score"] == pytest.approx(77.78, abs=0.01)


def test_accessibility_weights_are_request_configurable(tmp_path: Path) -> None:
    config = AccessibilityConfig(
        health_weight=0.5,
        education_weight=0.25,
        transport_weight=0.25,
    )

    result = _service(tmp_path).score_island("island:1", config)

    assert result is not None
    assert result["score"] == pytest.approx(83.33, abs=0.01)


def test_population_pressure_reduces_school_score_for_school_age_demand(
    tmp_path: Path,
) -> None:
    service = _service(tmp_path)
    service.population = [
        {
            "island_id": "island:1",
            "age_group": "5-9",
            "sex": "both",
            "nationality": "total",
            "population": 450,
        },
        {
            "island_id": "island:1",
            "age_group": "10-14",
            "sex": "both",
            "nationality": "total",
            "population": 450,
        },
        {
            "island_id": "island:1",
            "age_group": "20-24",
            "sex": "both",
            "nationality": "total",
            "population": 100,
        },
    ]

    result = service.score_island("island:1")

    assert result is not None
    assert result["population"]["school_age"] == 900
    assert result["domains"]["education"]["population_pressure_factor"] == pytest.approx(
        1 / 3, abs=0.001
    )
    assert result["domains"]["education"]["score"] == pytest.approx(33.33, abs=0.01)
    assert "population_pressure" in result["explanation"][-1]


def test_population_density_reduces_accessibility_for_crowded_island(
    tmp_path: Path,
) -> None:
    service = _service(tmp_path)
    service.islands["island:1"]["properties"]["area_ha"] = 100
    service.population = [{"island_id": "island:1", "population": 1000}]

    low_density = service.score_island("island:1")

    service.population = [{"island_id": "island:1", "population": 10000}]
    high_density = service.score_island("island:1")

    assert low_density is not None
    assert high_density is not None
    assert low_density["population"]["area_km2"] == pytest.approx(1.0)
    assert low_density["population"]["density_persons_per_km2"] == pytest.approx(1000.0)
    assert high_density["population"]["density_persons_per_km2"] == pytest.approx(10000.0)
    assert (
        high_density["population"]["density_pressure_score"]
        > low_density["population"]["density_pressure_score"]
    )
    assert high_density["score"] < low_density["score"]
    assert high_density["domains"]["transport"]["density_factor"] < 1.0


def test_accessibility_missing_facilities_score_zero(tmp_path: Path) -> None:
    service = _service(tmp_path)
    service.facilities = []

    result = service.score_island("island:1")

    assert result is not None
    assert result["domains"]["health"]["score"] == 0.0
    assert result["domains"]["education"]["score"] == 0.0
    assert "no_geocoded_facility" in result["missing_data"]


def test_provisional_map_matches_do_not_enter_deterministic_scoring(
    tmp_path: Path,
) -> None:
    service = _service(tmp_path)
    service.facilities[0]["match_status"] = "osm_provisional_review_required"

    result = service.score_island("island:1")

    assert result is not None
    assert result["domains"]["health"]["score"] == 0.0
    assert "no_geocoded_facility" in result["domains"]["health"]["missing_data"]


def test_plain_language_assessment_keeps_score_when_population_is_unknown(tmp_path: Path) -> None:
    result = _service(tmp_path).score_island("island:1")

    assert result is not None
    assessment = result["assessment"]
    assert assessment["score"] == result["score"] == pytest.approx(77.78, abs=0.01)
    assert assessment["out_of"] == 100
    assert assessment["components"]["health"] == {"score": 100.0, "facility_count": 1}
    assert assessment["components"]["education"] == {"score": 100.0, "facility_count": 1}
    assert assessment["components"]["transport"]["bus_stop_count"] == 1
    assert result["population"]["total"] is None
    assert assessment["coverage"]["population_available"] is False
    assert assessment["coverage"]["status"] == "partial"
    assert assessment["coverage"]["scored_domains"] == 3
    assert {reason["domain"] for reason in assessment["reasons"]} == {
        "health",
        "education",
        "transport",
    }
    assert any("Resident counts are missing" in item for item in assessment["limitations"])
    assert any("not a percentage" in item for item in assessment["limitations"])
    assert "straight line" in assessment["reasons"][0]["text"]
    assert assessment["summary"].startswith("Accessibility score: 77.8/100.")
    assert "33.3/100" in assessment["reasons"][2]["text"]


def test_no_mapped_services_is_an_evidence_gap_not_proven_no_access(tmp_path: Path) -> None:
    service = _service(tmp_path)
    service.facilities = []
    service.transport = []

    result = service.score_island("island:1")

    assert result is not None
    assessment = result["assessment"]
    assert assessment["score"] == 0
    assert assessment["label"] == "Limited evidence"
    assert assessment["coverage"]["status"] == "limited"
    assert assessment["coverage"]["scored_domains"] == 0
    assert all("services may still exist" in item["text"] for item in assessment["reasons"][:2])
    assert any(
        "missing evidence rather than poor access" in item for item in assessment["limitations"]
    )


@pytest.mark.parametrize(
    ("tags", "expected_bus_count"),
    [({"ferry": "yes", "amenity": "ferry_terminal"}, 0), ({"bus": "yes"}, 1), ({}, 0)],
)
def test_generic_transport_features_require_bus_evidence(
    tmp_path: Path, tags: dict[str, str], expected_bus_count: int
) -> None:
    service = _service(tmp_path)
    service.transport = [{"island_id": "island:1", "category": "public_transport", "tags": tags}]

    result = service.score_island("island:1")

    assert result is not None
    assert result["assessment"]["components"]["transport"]["bus_stop_count"] == expected_bus_count
    assert result["domains"]["transport"]["components"]["bus"] == expected_bus_count
    assert result["score"] == pytest.approx(77.78 if expected_bus_count else 66.67, abs=0.01)


def test_unverified_ferry_earns_no_points_by_default_and_has_a_clear_reason(tmp_path: Path) -> None:
    service = _service(tmp_path)
    service.transport = []
    service.routing.marine = {"nodes": [{"island_id": "island:1", "category": "pier"}]}

    default = service.score_island("island:1")
    assumed = service.score_island("island:1", AccessibilityConfig(include_unverified_marine=True))

    assert default is not None and assumed is not None
    assert default["assessment"]["components"]["transport"]["marine_terminal_count"] == 1
    assert default["domains"]["transport"]["score"] == 0
    assert (
        "excluded because ferry services are unverified"
        in default["assessment"]["reasons"][2]["text"]
    )
    assert assumed["domains"]["transport"]["score"] == pytest.approx(33.33)
    assert "included as an assumption" in assumed["assessment"]["reasons"][2]["text"]


def test_missing_reference_points_are_not_reported_as_measured_access(tmp_path: Path) -> None:
    service = _service(tmp_path)
    service.anchors = []
    service.islands["island:1"]["properties"].pop("centroid")

    result = service.score_island("island:1")

    assert result is not None
    assert result["assessment"]["components"]["health"]["facility_count"] == 1
    assert result["assessment"]["coverage"]["scored_domains"] == 1
    assert "distances could not be estimated" in result["assessment"]["reasons"][0]["text"]


@pytest.mark.parametrize(
    "excluded_status", ["osm_provisional_review_required", "island_context_only"]
)
def test_displayed_facility_counts_match_scored_eligibility(
    tmp_path: Path, excluded_status: str
) -> None:
    service = _service(tmp_path)
    service.facilities[0]["match_status"] = excluded_status

    result = service.score_island("island:1")

    assert result is not None
    assert result["domains"]["health"]["score"] == 0
    assert result["assessment"]["components"]["health"]["facility_count"] == 0
    assert "services may still exist" in result["assessment"]["reasons"][0]["text"]


def test_cached_artifact_is_enriched_without_routing_or_rewriting(tmp_path: Path) -> None:
    service = _service(tmp_path)
    captured = service.score_national()
    captured["scores"][0].pop("assessment")
    # Mimic the old bug: a generic ferry feature awarded bus points.
    service.transport = [
        {"island_id": "island:1", "category": "public_transport", "tags": {"ferry": "yes"}}
    ]
    derived = tmp_path / "cache" / "derived"
    derived.mkdir()
    path = derived / "accessibility-default.json"
    snapshot = json.dumps(captured).encode()
    path.write_bytes(snapshot)

    def must_not_route(*args, **kwargs):
        raise AssertionError("Valid frozen health/education routes must be reused")

    service.routing.route_land = must_not_route
    artifact = service.default_artifact()

    assert artifact["scores"][0]["assessment"]["score"] == pytest.approx(66.67, abs=0.01)
    assert artifact["scores"][0]["assessment"]["components"]["transport"]["bus_stop_count"] == 0
    assert artifact["scores"][0]["domains"]["health"] == captured["scores"][0]["domains"]["health"]
    assert path.read_bytes() == snapshot
    assert service.default_artifact() is artifact


def test_accessibility_api_returns_assessment_for_every_island_and_unknown_island_404(
    tmp_path: Path,
) -> None:
    service = _service(tmp_path)
    service.islands["island:2"] = {"properties": {"id": "island:2", "centroid": [74.0, 4.0]}}
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_accessibility] = lambda: service

    with TestClient(app) as client:
        national = client.get("/api/v1/accessibility/summary")
        score = client.post("/api/v1/accessibility/score", json={"island_id": "island:1"})
        missing = client.post("/api/v1/accessibility/score", json={"island_id": "unknown"})

    assert national.status_code == score.status_code == 200
    rows = national.json()["scores"]
    assert {row["island_id"] for row in rows} == {"island:1", "island:2"}
    assert all(0 <= row["assessment"]["score"] <= 100 for row in rows)
    assert all(len(row["assessment"]["reasons"]) == 3 for row in rows)
    assert all(row["population"]["total"] is None for row in rows)
    assert national.json()["summary"]["limited_evidence_island_count"] == 1
    assert national.json()["summary"]["population_available_island_count"] == 0
    assert score.json()["assessment"] == rows[0]["assessment"]
    assert missing.status_code == 404
