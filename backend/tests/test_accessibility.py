import json
from pathlib import Path

import pytest

from app.accessibility.config import AccessibilityConfig
from app.accessibility.service import AccessibilityService
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
