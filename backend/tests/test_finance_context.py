"""Official finance tables keep their real scope, signs and nonoverlapping grain."""

import json
from pathlib import Path

import pytest

from app.analytics.models import ChartRequest, DatasetFilter, DatasetQuery
from app.analytics.service import DatasetService
from app.data.finance_context import (
    build_finance_context,
    extract_hies_expenditure,
    extract_programme_budget,
)

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def bundle():
    return json.loads(
        (ROOT / "data/public/official-finance-context.json").read_text(encoding="utf-8")
    )


def test_budget_terminal_lines_reconcile_without_parent_double_count(bundle):
    hierarchy = bundle["budgetProgrammeHierarchy"]
    rows = bundle["budgetAllocations"]
    assert len(hierarchy) == 1156
    assert len({row["id"] for row in hierarchy}) == 1156
    assert len(rows) == len({row["id"] for row in rows}) == 2100
    assert len({row["node_id"] for row in rows}) == 420
    root = hierarchy[0]
    assert root["programme"] == "Special Budget"
    for year in range(2024, 2029):
        assert (
            sum(row["value"] for row in rows if row["year"] == year) == root["amounts"][str(year)]
        )
    assert {row["fiscal_status"] for row in rows if row["year"] == 2024} == {"actual"}
    assert {row["fiscal_status"] for row in rows if row["year"] == 2025} == {"revised"}
    ferry = [row for row in rows if row["programme"] == "Transport Subsidy (Public Ferry) by MTCC"]
    assert len(ferry) == 5  # repeated parent labels are deliberately absent
    assert next(row["value"] for row in ferry if row["year"] == 2026) == 250000000
    assert all(row["source_cell"].startswith(f"td-{row['year']}-") for row in rows)
    assert all(row["unit"] == row["currency"] == "MVR" for row in rows)


def test_audited_segment_accounts_keep_group_totals_signs_and_stock_flow(bundle):
    rows = bundle["mtccSegmentAccounts"]
    assert len(rows) == len({row["id"] for row in rows}) == 192
    by_key = {(row["year"], row["segment"], row["metric"]): row for row in rows}
    assert by_key[2025, "transport", "external_revenue"]["value"] == 149600294
    assert by_key[2025, "transport", "operating_profit_loss"]["value"] == 22307593
    loss = by_key[2024, "transport", "profit_loss_after_tax"]
    assert loss["value"] == -9570109 and loss["published_value"] == "(9,570,109)"
    assert by_key[2025, "real_estate", "external_revenue"]["value_status"] == "reported_nil"
    assert by_key[2025, "transport", "assets"]["measure_type"] == "year_end_stock"
    assert by_key[2025, "transport", "capital_expenditure"]["value"] == 42603960
    assert by_key[2025, "group_total", "capital_expenditure"]["value"] == 94569881
    assert {row["source_page"] for row in rows} == {200, 201}
    assert all(row["entity"] == "MTCC Group" for row in rows)


def test_operator_passenger_series_keep_overlap_explicit_and_zone_totals_reconcile(bundle):
    rows = bundle["mtccPassengerAnnual"]
    assert len(rows) == len({row["id"] for row in rows}) == 17
    by_key = {(row["year"], row["series"]): row for row in rows}
    assert by_key[2025, "rtl_bus_male_region"]["value"] == 8265837
    assert by_key[2025, "rtl_ferry_all_zones"]["value"] == 477215
    assert by_key[2025, "all_modes"]["value"] == 16247797
    assert sum(row["value"] for row in rows if row["source_page"] == 66) == 477215
    assert all("overlap" in row["qualification"] for row in rows)
    assert all("unique people" in row["qualification"] for row in rows)


def test_budget_schema_changes_fail_loudly(tmp_path):
    source = tmp_path / "source.html"
    source.write_text('<table id="example"><tr><th>2027 Budget</th></tr></table>', encoding="utf-8")
    with pytest.raises(ValueError, match="fiscal year/status headers changed"):
        extract_programme_budget(source)


def test_all_hies_estimates_keep_units_source_cells_and_explicit_share_conversion(bundle):
    rows = bundle["hiesExpenditure"]
    assert len(rows) == len({row["id"] for row in rows}) == 189
    assert len({row["source_row"] for row in rows}) == 63
    assert {row["geography"] for row in rows} == {"Republic", "Malé", "Atolls"}
    lookup = {(row["source_cell"]): row for row in rows}
    assert lookup["B7"]["value"] == pytest.approx(5.193984528345457)
    assert lookup["B7"]["unit"] == "persons/household"
    assert lookup["C8"]["value"] == 37013
    assert lookup["C8"]["unit"] == "MVR/household/month"
    assert lookup["D12"]["unit"] == "MVR/person/day"
    assert lookup["B22"]["published_value"] == pytest.approx(0.09853996408391237)
    assert lookup["B22"]["value"] == pytest.approx(9.853996408391237)
    assert lookup["B22"]["value_conversion"] == "fraction_times_100"
    assert sum(row["is_subcategory"] for row in rows) == 3
    assert lookup["B19"]["is_subcategory"]
    assert lookup["B36"]["value"] == 3091
    assert lookup["B50"]["value"] == 576
    assert lookup["B70"]["value"] == 2118
    assert lookup["D74"]["value"] == 9836
    assert all(row["measure_type"] == "published_survey_estimate_nonadditive" for row in rows)
    assert all("not additive" in row["qualification"] for row in rows)


def test_hies_schema_drift_rejected(tmp_path):
    from openpyxl import Workbook

    source = tmp_path / "bad.xlsx"
    workbook = Workbook()
    workbook.active.title = "expenditure"
    workbook.active["A1"] = "A different publication"
    workbook.save(source)
    workbook.close()
    with pytest.raises(ValueError, match="table schema changed"):
        extract_hies_expenditure(source)


def test_portable_finance_queries_and_aggregation_guards(bundle, tmp_path):
    public = tmp_path / "public"
    public.mkdir()
    (public / "official-finance-context.json").write_text(json.dumps(bundle), encoding="utf-8")
    service = DatasetService(public, tmp_path)
    assert service.schema("budget-programme-allocations")["row_count"] == 2100
    assert service.schema("hies-expenditure-context")["row_count"] == 189
    selected = service.query(
        "mtcc-segment-accounts",
        DatasetQuery(filters=[DatasetFilter(column="segment", value="transport")]),
    )
    assert selected["total"] == 32
    for dataset, message, request in (
        (
            "budget-programme-allocations",
            "one fiscal year",
            ChartRequest(group_by="programme_group", measure="value", aggregation="sum"),
        ),
        (
            "mtcc-segment-accounts",
            "metric and year",
            ChartRequest(group_by="segment", measure="value", aggregation="sum"),
        ),
        (
            "mtcc-segment-accounts",
            "overlap",
            ChartRequest(
                group_by="year",
                measure="value",
                aggregation="sum",
                filters=[DatasetFilter(column="metric", value="external_revenue")],
            ),
        ),
        (
            "mtcc-passenger-annual",
            "Overlapping",
            ChartRequest(group_by="year", measure="value", aggregation="sum"),
        ),
        (
            "hies-expenditure-context",
            "cannot be summed",
            ChartRequest(group_by="geography", measure="value", aggregation="sum"),
        ),
        (
            "hies-expenditure-context",
            "section, indicator and geography",
            ChartRequest(group_by="geography", measure="value", aggregation="mean"),
        ),
    ):
        with pytest.raises(ValueError, match=message):
            service.chart(dataset, request)
    chart = service.chart(
        "mtcc-segment-accounts",
        ChartRequest(
            group_by="year",
            measure="value",
            aggregation="sum",
            filters=[
                DatasetFilter(column="metric", value="external_revenue"),
                DatasetFilter(column="is_group_total", value=False),
            ],
        ),
    )
    assert {row["group"]: row["value"] for row in chart["items"]} == {
        "2024": 2156778316,
        "2025": 2134438287,
    }


@pytest.mark.skipif(
    not (ROOT / "data/raw/mtcc-annual2025.pdf").is_file(),
    reason="Optional pinned official original captures are not installed",
)
def test_original_finance_captures_reproduce_context(bundle):
    rebuilt = build_finance_context(ROOT)
    for key in (
        "budgetProgrammeHierarchy",
        "budgetAllocations",
        "mtccSegmentAccounts",
        "mtccPassengerAnnual",
        "hiesExpenditure",
        "sources",
        "sourceReceipts",
        "coverage",
        "warnings",
    ):
        assert rebuilt[key] == bundle[key]
