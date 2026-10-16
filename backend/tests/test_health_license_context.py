"""Dated registry records remain reproducible and do not imply current availability."""

import json
from pathlib import Path

import pytest

from app.analytics.models import DatasetFilter, DatasetQuery
from app.analytics.service import DatasetService
from app.data.health_license_context import _issued_date, build_health_license_context

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def bundle():
    return json.loads(
        (ROOT / "data/public/government-health-license-context.json").read_text(encoding="utf-8")
    )


def test_all_published_license_rows_dates_and_multiline_names_preserved(bundle):
    rows = bundle["licenses"]
    assert len(rows) == len({row["id"] for row in rows}) == 193
    assert [row["source_row"] for row in rows] == list(range(1, 194))
    assert {row["source_page"] for row in rows} == set(range(1, 9))
    assert rows[60]["name"] == "Gaafu Dhaalu Faresmaathodaa Health Centre"
    assert rows[180]["name"] == "Alifu Dhaalu Hangnaameedhoo Health Centre"
    assert rows[180]["published_issued_date"] == "23rd November2023"
    assert rows[180]["issued_date"] == "2023-11-23"
    assert rows[192]["name"] == "Dharumavantha Hospital"
    assert rows[192]["issued_date"] == "2024-11-13"
    assert rows[68]["published_level"] == "HCG 1"
    assert rows[68]["level_code"] == "HCG1"
    assert rows[114]["published_level"] == rows[114]["level_code"] == "HCGr1"
    assert all(row["registry_as_of"] == "2024-12-31" for row in rows)
    assert not any(row["current_operation_verified"] or row["capacity_observed"] for row in rows)
    assert all(row["facility_match_status"] == "not_attempted" for row in rows)


def test_source_duplicate_registrations_remain_separate_flagged_records(bundle):
    duplicate = [
        row for row in bundle["licenses"] if row["registration_number"] == "HF-11/ALP/GOV/261"
    ]
    assert len(duplicate) == 2
    assert {row["source_row"] for row in duplicate} == {11, 18}
    assert len({row["operating_license_number"] for row in duplicate}) == 2
    assert all(
        "duplicate_registration_number_in_published_source" in row["data_issues"]
        for row in duplicate
    )


def test_date_parser_rejects_unknown_or_post_registry_dates():
    assert _issued_date("04th February 2024") == "2024-02-04"
    with pytest.raises(ValueError, match="Unrecognized"):
        _issued_date("31st NotAMonth 2024")
    with pytest.raises(ValueError, match="after the dated"):
        _issued_date("1st January 2025")


def test_portable_historical_license_dataset(bundle, tmp_path):
    public = tmp_path / "public"
    public.mkdir()
    (public / "government-health-license-context.json").write_text(
        json.dumps(bundle), encoding="utf-8"
    )
    service = DatasetService(public, tmp_path)
    assert service.schema("government-health-license-history")["row_count"] == 193
    result = service.query(
        "government-health-license-history",
        DatasetQuery(filters=[DatasetFilter(column="name", value="Dharumavantha Hospital")]),
    )
    assert result["total"] == 1
    assert result["items"][0]["issued_date"] == "2024-11-13"


@pytest.mark.skipif(
    not (ROOT / "data/raw/government-health-facilities2024.pdf").is_file(),
    reason="Optional pinned official original capture is not installed",
)
def test_original_license_capture_reproduces_context(bundle):
    rebuilt = build_health_license_context(ROOT)
    for key in ("licenses", "sources", "sourceReceipts", "coverage", "warnings"):
        assert rebuilt[key] == bundle[key]
