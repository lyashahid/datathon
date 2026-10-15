from __future__ import annotations

import json
from pathlib import Path

from app.cli import batch_review


def test_parse_osm_id_and_category_gate() -> None:
    assert batch_review.parse_osm_id("osm:way:123") == ("way", "123")
    assert batch_review.parse_osm_id("way/123") is None
    assert batch_review.category_compatible("school", {"amenity": "school"})
    assert not batch_review.category_compatible("school", {"amenity": "hospital"})
    assert batch_review.category_compatible("health_center", {"healthcare": "hospital"})


def test_prepare_skips_previous_review_ids(tmp_path: Path, monkeypatch) -> None:
    normalized = tmp_path / "normalized"
    review = tmp_path / "review"
    batch_dir = review / "batches"
    normalized.mkdir(parents=True)
    review.mkdir()
    facilities = [
        {
            "id": "facility:health:1",
            "name": "One Health Centre",
            "category": "health_center",
            "attributes": {"establishment_id": "1"},
            "location_context": {"island_name": "One", "proposed_atoll": "A"},
            "match_status": "island_context_only",
        },
        {
            "id": "facility:health:2",
            "name": "Two Health Centre",
            "category": "health_center",
            "attributes": {"establishment_id": "2"},
            "location_context": {"island_name": "Two", "proposed_atoll": "A"},
            "match_status": "island_context_only",
        },
    ]
    ledger = {
        "records": [
            {"facility_id": "facility:health:1", "osm_object_id": None},
            {"facility_id": "facility:health:2", "osm_object_id": None},
        ]
    }
    (normalized / "facilities.json").write_text(json.dumps(facilities), encoding="utf-8")
    (review / "facility-reconciliation-ledger.json").write_text(
        json.dumps(ledger), encoding="utf-8"
    )
    (review / "online-facility-review-batch-old.json").write_text(
        json.dumps({"batches": [{"facility_ids": ["facility:health:1"]}]}), encoding="utf-8"
    )
    monkeypatch.setattr(batch_review, "NORMALIZED", normalized)
    monkeypatch.setattr(batch_review, "REVIEW", review)
    monkeypatch.setattr(batch_review, "BATCH_DIR", batch_dir)

    args = type(
        "Args",
        (),
        {"batch_size": 10, "batches": 1, "batch_id": "batch-test", "categories": ["health_center"]},
    )()
    assert batch_review.prepare(args) == 0
    queue = json.loads((batch_dir / "batch-test.queue.json").read_text(encoding="utf-8"))
    assert queue["jobs"][0]["facility_ids"] == ["facility:health:2"]
    assert (batch_dir / "batch-test-01.prompt.md").exists()


def test_overpass_query_is_bounded_and_facility_scoped() -> None:
    query = batch_review.overpass_query_for_bbox((72.89, 2.92, 72.90, 2.93))
    assert "[out:json][timeout:30]" in query
    assert "(2.9200000,72.8900000,2.9300000,72.9000000)" in query
    assert '["healthcare"]' in query
    assert '["amenity"~"^(hospital|clinic|doctors|school|pharmacy)$"]' in query
    assert "out center tags" in query


def test_deterministic_candidate_gate_requires_specific_name_and_category() -> None:
    facility = {"official_name": "Feydhoo Health Centre", "category": "health_center"}
    good = {"name": "Feydhoo Health Centre", "tags": {"building": "hospital"}}
    alternate = {"name": "Feydhoo Health Centre", "tags": {"healthcare": "yes"}}
    generic = {"name": "", "tags": {"healthcare": "yes"}}
    generic_named = {"name": "Preschool", "tags": {"amenity": "kindergarten"}}
    assert batch_review.deterministic_candidate_score(facility, good)[1]
    assert batch_review.deterministic_candidate_score(facility, alternate)[1]
    assert not batch_review.deterministic_candidate_score(facility, generic)[1]
    assert not batch_review.deterministic_candidate_score(facility, generic_named)[1]
