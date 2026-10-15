from app.data.normalize.normalizer import (
    _apply_best_effort_matches,
    _apply_reviewed_overrides,
    _apply_source_identifier_matches,
    _attach_osm_match_metadata,
    _classify_unmatched_facilities,
    _collapse_nearby_osm_candidates,
    _extract_location_context,
    _name_match_evidence,
)


def test_location_context_parses_common_atoll_code_formats() -> None:
    cases = {
        "A,Dh. Dhangethi Health center": ("adh", "Dhangethi"),
        "A.A Feridhoo Health Centre": ("aa", "Feridhoo"),
        "A.Dh Dhidhoo Health Centre": ("adh", "Dhidhoo"),
        "AA. Himandhoo Health center": ("aa", "Himandhoo"),
    }

    for name, expected in cases.items():
        context = _extract_location_context({"name": name, "attributes": {}})
        assert (context["atoll_code"], context["island_name"]) == expected


def test_location_context_uses_education_address() -> None:
    context = _extract_location_context(
        {
            "name": "Sheikh Ibrahim School",
            "attributes": {
                "address": "Sheikh Ibrahim School, Miskihmagu, HA. Kelaa, 01080"
            },
        }
    )

    assert context["atoll_code"] == "ha"
    assert context["island_name"] == "Kelaa"


def test_location_context_allows_reviewed_island_spelling_variants() -> None:
    context = _extract_location_context(
        {
            "name": "A.Dh Maamigilee Health Centre",
            "attributes": {},
        }
    )

    assert context["island_name"] == "Maamigilee"


def test_caa_identifier_match_handles_osm_name_variants() -> None:
    facilities = [
        {
            "source": "CAA",
            "source_record_id": "VRMO",
            "match_status": "unmatched",
            "geometry": None,
            "geometry_source": None,
            "geometry_quality": "unresolved",
            "osm_object_id": None,
            "island_id": None,
        }
    ]
    osm_features = [
        {
            "id": "osm:node:1",
            "tags": {"icao": "VRMO", "name": "Kuddoo"},
            "geometry": {"type": "Point", "coordinates": [73.0, 3.0]},
            "island_id": "island:1",
        }
    ]

    _apply_source_identifier_matches(facilities, osm_features)

    assert facilities[0]["match_status"] == "exact_source_identifier"
    assert facilities[0]["osm_object_id"] == "osm:node:1"
    assert facilities[0]["island_id"] == "island:1"


def test_matching_collapses_nearby_node_way_duplicate() -> None:
    candidates = [
        {
            "id": "osm:node:1",
            "object_type": "node",
            "island_id": "island:1",
            "geometry": {"type": "Point", "coordinates": [73.0, 3.0]},
        },
        {
            "id": "osm:way:2",
            "object_type": "way",
            "island_id": "island:1",
            "geometry": {"type": "Point", "coordinates": [73.0001, 3.0001]},
        },
    ]

    collapsed = _collapse_nearby_osm_candidates(candidates)

    assert [candidate["id"] for candidate in collapsed] == ["osm:way:2"]


def test_unmatched_records_receive_explicit_resolution_states() -> None:
    facilities = [
        {
            "id": "facility:1",
            "match_status": "unmatched",
            "location_context": {
                "candidate_island_ids": ["island:1"],
            },
        },
        {
            "id": "facility:2",
            "match_status": "unmatched",
            "location_context": {
                "candidate_island_ids": [],
            },
        },
    ]

    _classify_unmatched_facilities(
        facilities,
        [
            {
                "facility_id": "facility:2",
            }
        ],
    )

    assert facilities[0]["match_status"] == "island_context_only"
    assert facilities[0]["island_id"] == "island:1"
    assert facilities[1]["match_status"] == "osm_match_review_required"


def test_best_effort_match_requires_unique_island_context() -> None:
    facilities = [
        {
            "id": "facility:1",
            "match_status": "unmatched",
            "geometry": None,
            "geometry_source": None,
            "geometry_quality": "unresolved",
            "island_id": None,
        }
    ]
    candidates = [
        {
            "facility_id": "facility:1",
            "location_context": {
                "island_match_status": "unique_name_and_proposed_atoll_candidate",
                "candidate_island_ids": ["island:1"],
            },
            "candidates": [
                {
                    "osm_object_id": "osm:way:1",
                    "island_id": "island:1",
                    "score": 0.9,
                    "geometry": {"type": "Point", "coordinates": [73.0, 3.0]},
                }
            ],
        }
    ]

    _apply_best_effort_matches(facilities, candidates)

    assert facilities[0]["match_status"] == "osm_best_effort"
    assert facilities[0]["geometry_quality"] == "osm_best_effort"
    assert facilities[0]["island_id"] == "island:1"


def test_osm_match_metadata_is_serializable_for_map_features() -> None:
    facilities = [
        {
            "id": "facility:school:1",
            "match_status": "exact_normalized_name",
            "geometry": {"type": "Point", "coordinates": [73.0, 3.0]},
            "geometry_source": "OpenStreetMap",
            "osm_object_id": "osm:node:1",
        }
    ]

    _attach_osm_match_metadata(facilities, [])

    assert facilities[0]["osm_match"] == {
        "object_id": "osm:node:1",
        "status": "exact_normalized_name",
        "score": 1.0,
        "candidate_count": 0,
        "review_required": False,
        "geometry_available": True,
        "geometry_source": "OpenStreetMap",
        "provisional_duplicate": False,
    }


def test_osm_alternate_name_is_used_for_review_evidence() -> None:
    evidence = _name_match_evidence(
        {"name": "Haa Alifu Thakandhoo Health Centre"},
        {
            "name": "Health Center",
            "tags": {"alt_name": "Thakandhoo Health Center"},
        },
    )

    assert evidence["matched_name"] == "Thakandhoo Health Center"
    assert evidence["shared_tokens"] == ["thakandhoo"]


def test_best_effort_matching_does_not_reuse_osm_object() -> None:
    facilities = [
        {
            "id": "facility:1",
            "match_status": "unmatched",
            "geometry": None,
            "geometry_source": None,
            "geometry_quality": "unresolved",
            "island_id": None,
        },
        {
            "id": "facility:2",
            "match_status": "unmatched",
            "geometry": None,
            "geometry_source": None,
            "geometry_quality": "unresolved",
            "island_id": None,
        },
    ]
    candidates = [
        {
            "facility_id": facility_id,
            "location_context": {
                "island_match_status": "unique_name_and_proposed_atoll_candidate",
                "candidate_island_ids": ["island:1"],
            },
            "candidates": [
                {
                    "osm_object_id": "osm:way:1",
                    "island_id": "island:1",
                    "score": 0.9,
                    "name_score": 0.9,
                    "geometry": {"type": "Point", "coordinates": [73.0, 3.0]},
                }
            ],
        }
        for facility_id in ("facility:1", "facility:2")
    ]

    _apply_best_effort_matches(facilities, candidates)

    assert [facility["match_status"] for facility in facilities] == [
        "osm_best_effort",
        "unmatched",
    ]


def test_reviewed_override_creates_accepted_reviewed_match() -> None:
    facilities = [
        {
            "id": "facility:health:1",
            "category": "health_center",
            "name": "Example Health Centre",
            "match_status": "unmatched",
            "geometry": None,
            "geometry_source": None,
            "geometry_quality": "unresolved",
        }
    ]
    osm_features = [
        {
            "id": "osm:way:1",
            "category": "hospital",
            "name": "Example Health Center",
            "tags": {},
            "geometry": {"type": "Point", "coordinates": [73.0, 3.0]},
            "island_id": "island:1",
        }
    ]

    _apply_reviewed_overrides(
        facilities,
        osm_features,
        [
            {
                "facility_id": "facility:health:1",
                "osm_object_id": "osm:way:1",
                "review_note": "same reviewed identity",
            }
        ],
    )

    assert facilities[0]["match_status"] == "reviewed_osm_match"
    assert facilities[0]["geometry_quality"] == "osm_reviewed"
    assert facilities[0]["manual_match_review"]["reviewed"] is True
