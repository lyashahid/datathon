"""Published school grids conserve counts without imputing blanks or forcing localities."""

import copy
import json
from collections import defaultdict
from pathlib import Path

import pytest

from app.analytics.models import ChartRequest, DatasetFilter, DatasetQuery
from app.analytics.service import DatasetService
from app.data.school_context import (
    GRADES,
    _enrollment_table,
    _identity,
    _numeric,
    build_school_context,
)

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def bundle():
    return json.loads((ROOT / "data/public/school-context.json").read_text("utf-8"))


def test_disjoint_school_enrolment_conserves_nationwide_and_published_locality_totals(bundle):
    rows = bundle["enrolment"]
    assert len(rows) == 188 * len(GRADES) * 2 == 6016
    assert sum(row["value"] or 0 for row in rows) == 99031
    assert len({(r["atoll_code"], r["locality"], r["grade"], r["sex"]) for r in rows}) == len(rows)
    assert all(not row["is_total"] for row in rows)
    totals = defaultdict(int)
    for row in rows:
        totals[row["atoll_code"], row["locality"], row["sex"]] += row["value"] or 0
    for row in bundle["statistics"]:
        if row["metric"] == "enrolled_students_subtotal" and not row["is_total"]:
            if row["value"] is not None:
                assert totals[row["atoll_code"], row["locality"], row["sex"]] == row["value"]
    assert bundle["coverage"]["published_tables"] == 36
    assert len([table for table in bundle["tables"] if table["kind"] == "locality_grade_sex"]) == 21


def test_school_location_identity_preserves_both_hithadhoos_and_combined_locality(bundle):
    addu = [row for row in bundle["enrolment"] if row["locality"] == "Hithadhoo"]
    laamu = [row for row in bundle["enrolment"] if row["locality"] == "Hithadhoo-1"]
    assert {row["island_id"] for row in addu} == {"island:1152"}
    assert {row["island_id"] for row in laamu} == {"island:697"}
    assert sum(row["value"] or 0 for row in addu) == 3536
    assert sum(row["value"] or 0 for row in laamu) == 259
    combined = [row for row in bundle["enrolment"] if row["locality"] == "Hulhumeedhoo"]
    assert sum(row["value"] or 0 for row in combined) == 516
    assert all(row["island_id"] is None for row in combined)
    assert bundle["coverage"]["matched_islands"] == 187
    islands = json.loads(
        (ROOT / "backend/data/cache/normalized/islands.geojson").read_text("utf-8")
    )
    assert _identity("Dhiddhoo", "adh", islands["features"])["island_id"] == "island:66"
    assert _identity("Dhiddhoo", "ha", islands["features"])["island_id"] is None


def test_blanks_stay_unknown_and_measured_zero_remains_zero(bundle):
    assert sum(row["value"] is None for row in bundle["enrolment"]) == 1137
    assert _numeric("") is None
    assert _numeric(None) is None
    assert _numeric("0") == 0
    assert _numeric(0) == 0
    male = [r for r in bundle["enrolment"] if r["locality"] == "Thinadhoo-1" and r["sex"] == "male"]
    assert len(male) == 16
    assert all(row["value"] is None and row["status"] == "not_reported" for row in male)


def test_structured_context_preserves_teachers_schools_ratios_and_source_conflicts(bundle):
    rows = bundle["statistics"]
    teachers = [
        row
        for row in rows
        if row["source_page"] == 37
        and row["locality"] == "Nationwide"
        and row["metric"] == "teachers"
    ]
    assert {row["column_header"]: row["value"] for row in teachers} == {
        "Teachers | Local | Male": 1571,
        "Teachers | Local | Female": 7688,
        "Teachers | Expat | Male": 1189,
        "Teachers | Expat | Female": 1051,
        "Teachers | Total": 11499,
    }
    ratio = next(
        row
        for row in rows
        if row["source_page"] == 20
        and row["metric"] == "gender_parity_index"
        and "Higher Secondary" in row["row_label"]
    )
    assert ratio["value"] == 1.4 and ratio["unit"] == "ratio"
    conflict = next(
        issue
        for issue in bundle["qualityIssues"]
        if issue["kind"] == "published_grade_subtotal_conflict"
    )
    assert conflict["grade_sum"] == 715 and conflict["published_subtotal"] == 734
    cross_table = [
        issue
        for issue in bundle["qualityIssues"]
        if issue["kind"] == "conflicting_published_tables"
    ]
    assert {tuple(cell["value"] for cell in issue["evidence"]) for issue in cross_table} == {
        (5, 6),
        (13, 12),
        (37707, 38836),
    }
    assert all(row.get("source_page") and row.get("source_column") for row in rows)
    assert bundle["sources"][0]["receipt"]["sha256"] == bundle["sources"][0]["checksum"]


def test_grade_header_drift_and_bad_subtotals_fail_instead_of_silently_shifting_columns():
    heading = ["Enrollment in Haa Alif Atoll Islands - as of Nov 2023"] + [None] * 36
    grade_header = [None] + [item for grade in GRADES for item in (grade, None)] + [None] * 4
    sex_header = [None] + ["M", "F"] * 18
    data = ["Baarah"] + ["1"] * 32 + ["16", "16", "50", "50"]
    table = [heading, [None] * 37, grade_header, sex_header, data]
    islands = [{"properties": {"id": "island:fixture", "name": "Baarah", "atoll": "Haa Alifu"}}]
    rows, _, issues = _enrollment_table(table, 21, 1, islands)
    assert len(rows) == 32 and not issues
    drifted = copy.deepcopy(table)
    drifted[2][1], drifted[2][3] = drifted[2][3], drifted[2][1]
    with pytest.raises(ValueError, match="Grade columns changed"):
        _enrollment_table(drifted, 21, 1, islands)
    wrong_total = copy.deepcopy(table)
    wrong_total[-1][33] = "17"
    with pytest.raises(ValueError, match="does not conserve"):
        _enrollment_table(wrong_total, 21, 1, islands)


def test_generic_analysis_queries_school_models_and_rejects_mixed_context_totals():
    service = DatasetService(ROOT / "data/public", ROOT / "backend/data")
    schema = service.schema("school-enrolment")
    assert schema["row_count"] == 6016
    chart = service.chart(
        "school-enrolment",
        ChartRequest(
            group_by="grade",
            series_by="sex",
            measure="value",
            aggregation="sum",
            limit=100,
        ),
    )
    assert sum(row["value"] for row in chart["items"]) == 99031
    query = service.query(
        "school-statistics-context",
        DatasetQuery(
            filters=[
                DatasetFilter(column="source_page", value=37),
                DatasetFilter(column="locality", value="Nationwide"),
                DatasetFilter(column="metric", value="teachers"),
            ]
        ),
    )
    assert query["total"] == 5
    with pytest.raises(ValueError, match="School context requires"):
        service.chart(
            "school-statistics-context",
            ChartRequest(
                group_by="locality",
                measure="value",
                aggregation="sum",
            ),
        )


@pytest.mark.skipif(
    not (ROOT / "data/public/archive/policy-evidence/school-statistics-2023.pdf").is_file(),
    reason="Original school PDF capture is not installed",
)
def test_pdf_rebuild_reproduces_portable_context(bundle):
    rebuilt = build_school_context(ROOT)
    for key in (
        "enrolment",
        "statistics",
        "tables",
        "qualityIssues",
        "coverage",
        "identityAliases",
    ):
        assert rebuilt[key] == bundle[key]
