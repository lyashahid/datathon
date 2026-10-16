"""Prepared operator points reach profiles without changing captured capital evidence."""

import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from app.accessibility.config import DEFAULT_ACCESSIBILITY_CONFIG
from app.accessibility.service import AccessibilityService
from app.api.repository import NormalizedRepository
from app.data.national_transport import merge_national_boarding_points
from app.data.population import POPULATION_TRANSFORM_VERSION


def _stop(identifier, *, island="island:outer", mode="bus", code=None):
    return {
        "id": identifier,
        "islandId": island,
        "mode": mode,
        "coordinate": [73.1, -0.6],
        "operatorCode": code,
        "sourceIds": ["rtl-national-route-details"],
        "verification": "operator-published",
        "timetableStatus": "unavailable",
        "physicalOperatingStatus": "unverified",
    }


def test_merge_deduplicates_source_identities_and_preserves_captured_capital_records():
    existing = [
        {"id": "osm:node:1", "island_id": "island:outer", "category": "ferry_terminal"},
        {"id": "capital:1", "island_id": "island:1443", "category": "bus_stop"},
    ]
    national = {
        "transit": {
            "stops": [
                _stop("osm:node:1", mode="ferry"),
                _stop("rtl:outer:1", code="1"),
                _stop("rtl:outer:duplicate-code", code="1"),
                _stop("rtl:capital:new", island="island:1443"),
                {**_stop("bad:point"), "coordinate": [None, 2]},
            ]
        }
    }
    merged = merge_national_boarding_points(existing, national)
    assert merged[:2] == existing
    assert len(merged) == 3
    assert merged[2]["category"] == "bus_stop"
    assert merged[2]["source_ids"] == ["rtl-national-route-details"]
    assert merged[2]["timetable_status"] == "unavailable"
    assert merged[2]["physical_operating_status"] == "unverified"
    assert merge_national_boarding_points(merged, national) == merged


def test_repository_and_accessibility_share_added_points_without_claiming_service(tmp_path):
    public = tmp_path / "public"
    public.mkdir()
    (public / "national-planning-infrastructure.json").write_text(
        json.dumps(
            {
                "transit": {
                    "stops": [_stop("rtl:outer:1", code="1"), _stop("osm:ferry:1", mode="ferry")]
                }
            }
        ),
        "utf-8",
    )
    repository = NormalizedRepository(tmp_path, public_dir=public, allow_context_build=False)
    repository.reload()
    assert len(repository.transport_features("island:outer")) == 2
    assert repository.summary["transport"]["feature_count"] == 2
    assert repository.summary["transport"]["additional_national_boarding_point_count"] == 2
    mapped = repository.map_features(layer="transport", island_id="island:outer")["features"]
    assert mapped[0]["properties"]["source"] == "RTL official boarding-point catalogue"
    assert mapped[0]["properties"]["timetable_status"] == "unavailable"

    routing = SimpleNamespace(
        marine={
            "nodes": [
                {"id": "osm:ferry:1", "island_id": "island:outer", "category": "ferry_terminal"}
            ]
        }
    )
    service = AccessibilityService(tmp_path, routing, public_dir=public)
    service.reload()
    counts = service._transport_evidence("island:outer")
    assert counts == {"bus_stop_count": 1, "marine_terminal_count": 1, "airport_count": 0}
    transport = service._score_transport("island:outer", DEFAULT_ACCESSIBILITY_CONFIG, {})
    assert transport["score"] == pytest.approx(33.33)
    assert transport["ferry_access"] == "provisional"
    assert "ferry_service_unverified" in transport["missing_data"]


def test_transport_addition_refreshes_counts_while_reusing_unchanged_route_results(
    tmp_path, monkeypatch
):
    public = tmp_path / "public"
    derived = tmp_path / "cache/derived"
    public.mkdir()
    derived.mkdir(parents=True)
    (public / "national-planning-infrastructure.json").write_text(
        json.dumps({"transit": {"stops": [_stop("rtl:outer:1", code="1")]}}), "utf-8"
    )
    service = AccessibilityService(
        tmp_path, SimpleNamespace(marine={"nodes": []}), public_dir=public
    )
    service.reload()
    service.islands = {"island:outer": {"properties": {"id": "island:outer"}}}
    captured = {
        "population_transform_version": POPULATION_TRANSFORM_VERSION,
        "source_fingerprint": {},
        "config": service.config(),
        "scores": [
            {
                "island_id": "island:outer",
                "population": {"total": None},
                "domains": {
                    "health": {"score": 22, "missing_data": []},
                    "education": {"score": 44, "missing_data": []},
                },
            }
        ],
    }
    (derived / "accessibility-default.json").write_text(json.dumps(captured), "utf-8")

    def cannot_reroute():
        raise AssertionError("Unchanged health/education inputs must reuse validated route results")

    monkeypatch.setattr(service, "score_national", cannot_reroute)
    refreshed = service.default_artifact()["scores"][0]
    assert refreshed["domains"]["health"]["score"] == 22
    assert refreshed["domains"]["education"]["score"] == 44
    assert refreshed["domains"]["transport"]["mapped_counts"]["bus_stop_count"] == 1


def test_shipped_hithadhoo_points_are_used_and_capital_counts_remain_identical():
    root = Path(__file__).resolve().parents[2]
    captured = json.loads(
        (root / "backend/data/cache/normalized/transport.json").read_text("utf-8")
    )
    public = json.loads(
        (root / "data/public/national-planning-infrastructure.json").read_text("utf-8")
    )
    merged = merge_national_boarding_points(captured["features"], public)
    for island_id in ("island:1443", "island:1442", "island:1483", "island:1382"):
        assert [row for row in merged if row.get("island_id") == island_id] == [
            row for row in captured["features"] if row.get("island_id") == island_id
        ]
    hithadhoo = [
        row
        for row in merged
        if row.get("island_id") == "island:1152" and row.get("category") == "bus_stop"
    ]
    expected = [
        row
        for row in public["transit"]["stops"]
        if row.get("islandId") == "island:1152" and row.get("mode") == "bus"
    ]
    assert len(hithadhoo) == len(expected) > 0
    assert len({row["id"] for row in merged}) == len(merged)
