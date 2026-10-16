"""Official island context keeps geography, census scope and missingness intact."""

import json
from pathlib import Path

import pytest

from app.analytics.models import ChartRequest, DatasetFilter, DatasetQuery
from app.analytics.service import DatasetService
from app.api.repository import NormalizedRepository
from app.data.island_context import (
    LABOUR_METRICS,
    _identity_rows,
    _require_header,
    build_island_context,
    island_context_profile,
)

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def bundle():
    return json.loads((ROOT / "data/public/island-context.json").read_text(encoding="utf-8"))


def test_portable_context_has_complete_disjoint_island_and_year_coverage(bundle):
    demographics = bundle["demographics"]
    assert len(demographics) == len({row["island_id"] for row in demographics}) == 186
    assert sum(row["residents_total"] for row in demographics) == 236911
    assert sum(row["maldivians_total"] for row in demographics) == 205312
    assert len(bundle["employment"]) == 186 * 2 * 3
    assert len(bundle["projections"]) == 186 * 9
    assert len({(row["island_id"], row["year"]) for row in bundle["projections"]}) == 186 * 9
    assert {row["year"] for row in bundle["projections"]} == set(range(2022, 2031))
    assert all(row["geography_grain"] == "administrative_island" for row in demographics)
    for row in demographics:
        assert row["residents_total"] == row["maldivians_total"] + row["foreigners_total"]
        assert (
            row["maldivian_children_0_14_total"]
            + row["maldivian_working_age_15_64_total"]
            + row["maldivian_older_adults_65_plus_total"]
            == row["maldivians_total"]
        )
    for row in bundle["projections"]:
        assert row["residents_total"] == pytest.approx(
            row["maldivians_total"] + row["foreigners_total"]
        )


def test_hithadhoo_context_preserves_nationality_and_current_projection(bundle):
    addu = island_context_profile(bundle, "island:1152")
    laamu = island_context_profile(bundle, "island:697")
    assert addu["census_demographics"]["residents_total"] == 13759
    assert laamu["census_demographics"]["residents_total"] == 1108
    assert addu["census_demographics"]["maldivian_children_0_17_total"] == 3560
    assert addu["census_demographics"]["maldivian_older_adults_65_plus_total"] == 896
    assert next(row for row in addu["projections"] if row["year"] == 2026)[
        "residents_total"
    ] == pytest.approx(14811.534088)
    assert next(
        row
        for row in addu["employment"]
        if row["population_scope"] == "residents" and row["sex"] == "both"
    )["unemployment_rate"] == pytest.approx(5.501760563)
    assert island_context_profile(bundle, "no-such-island")["census_demographics"] is None


def test_absent_rates_remain_null_with_scope_and_definition_receipts(bundle):
    missing = [
        (row, key) for row in bundle["employment"] for key in LABOUR_METRICS if row[key] is None
    ]
    assert len(missing) == bundle["coverage"]["missing_employment_rates"] == 8
    assert {row["locality"] for row, _ in missing} == {"Rakeedhoo"}
    assert all(row["unit"] == "percent" for row in bundle["employment"])
    assert len(bundle["sources"]) == 5
    assert all(
        source["receipt"]["sha256"] and source["url"].startswith("https://statisticsmaldives")
        for source in bundle["sources"]
    )
    assert any(
        row["term"] == "Working age population" and "15 years and older" in row["definition"]
        for row in bundle["definitions"]
    )


def test_source_aliases_are_atoll_constrained_and_ambiguous_data_fails():
    islands = [
        {
            "properties": {
                "id": "mundoo",
                "name": "Mundoo",
                "atoll": "Laamu",
                "category": "Residential Island",
            }
        }
    ]
    rows = _identity_rows([("L", "Mundhoo", 10)], islands, "employment", "sheet")
    assert rows[0][0]["island_id"] == "mundoo"
    assert rows[0][0]["source_locality"] == "Mundhoo"
    assert "Same-atoll" in rows[0][0]["alias_basis"]
    with pytest.raises(ValueError, match="Unresolved official island"):
        _identity_rows([("S", "Mundhoo", 10)], islands, "employment", "sheet")
    with pytest.raises(ValueError, match="Duplicate island"):
        _identity_rows([("L", "Mundhoo", 10), ("L", "Mundhoo", 10)], islands, "employment", "sheet")
    with pytest.raises(ValueError, match="header changed"):
        _require_header([("wrong",)], 1, 1, "expected")


def test_profile_and_datasets_consume_portable_artifact(bundle, tmp_path):
    public = tmp_path / "public"
    public.mkdir()
    (public / "island-context.json").write_text(json.dumps(bundle), encoding="utf-8")
    repository = NormalizedRepository(tmp_path, allow_context_build=False, public_dir=public)
    repository.reload()
    assert repository.island_indicator_context("island:1152")["status"] == "available"
    assert repository.summary["island_indicator_coverage"]["administrative_islands"] == 186
    service = DatasetService(public, tmp_path)
    census = service.query(
        "island-census-demographics",
        DatasetQuery(filters=[DatasetFilter(column="island_id", value="island:1152")]),
    )
    assert census["total"] == 1
    assert census["items"][0]["residents_total"] == 13759
    assert service.schema("island-population-projections")["row_count"] == 1674
    assert service.schema("island-employment-indicators")["row_count"] == 1116
    with pytest.raises(ValueError, match="cannot be summed"):
        service.chart(
            "island-employment-indicators",
            ChartRequest(group_by="atoll_code", measure="unemployment_rate", aggregation="sum"),
        )
    with pytest.raises(ValueError, match="year filter"):
        service.chart(
            "island-population-projections",
            ChartRequest(group_by="atoll_code", measure="residents_total", aggregation="sum"),
        )


@pytest.mark.skipif(
    not (ROOT / "data/raw/census2022-population.xlsx").is_file(),
    reason="Optional original XLSX captures are not installed",
)
def test_original_workbooks_reproduce_published_context(bundle):
    rebuilt = build_island_context(ROOT)
    for key in ("demographics", "employment", "projections", "definitions", "coverage", "sources"):
        assert rebuilt[key] == bundle[key]
