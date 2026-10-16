"""Complete source-defined transport categories do not silently become forecast inputs."""

import json
from pathlib import Path

import pytest

from app.analytics.models import ChartRequest, DatasetFilter, DatasetQuery
from app.analytics.service import DatasetService

ROOT = Path(__file__).resolve().parents[2]


def test_shipped_monthly_transport_preserves_categories_missingness_and_quarantine():
    artifact = json.loads((ROOT / "data/public/transport-context.json").read_text(encoding="utf-8"))
    rows = artifact["observations"]
    assert len(rows) == 19 * 78
    assert len({r["id"] for r in rows}) == len(rows)
    assert len({r["category_id"] for r in rows}) == 19
    assert all(r["forecast_eligible"] is False for r in rows)
    quarantined = [r for r in rows if r["value_status"] == "quarantined_repeated_month"]
    assert len(quarantined) == 6
    assert all(r["value"] is None and r["published_value"] is not None for r in quarantined)
    assert all(r["period"] == "2026-06" and r["mode"] == "bus" for r in quarantined)
    assert any(r["value_status"] == "reported" and r["value"] == 0 for r in rows)
    assert any(r["value_status"] == "blank" and r["value"] is None for r in rows)


def test_original_trusted_forecast_points_still_match_full_context():
    artifact = json.loads((ROOT / "data/public/transport-context.json").read_text(encoding="utf-8"))
    trusted = json.loads((ROOT / "data/public/prediction-source.json").read_text(encoding="utf-8"))
    by_key = {(r["source_row"], r["period"]): r for r in artifact["observations"]}
    for series, source_row in zip(trusted["series"], (161, 162, 167), strict=True):
        for point in series["points"]:
            assert by_key[source_row, point["month"]]["value"] == point["value"]


def test_full_transport_context_is_queryable(tmp_path):
    service = DatasetService(ROOT / "data/public", tmp_path)
    result = service.query("transport-monthly-context", DatasetQuery(limit=5))
    assert result["total"] == 1482
    assert len(result["items"]) == 5


def test_transport_chart_preserves_category_scope_and_quarantine(tmp_path):
    service = DatasetService(ROOT / "data/public", tmp_path)
    with pytest.raises(ValueError, match="Overlapping transport categories"):
        service.chart(
            "transport-monthly-context",
            ChartRequest(group_by="period", measure="value", aggregation="sum"),
        )
    result = service.chart(
        "transport-monthly-context",
        ChartRequest(
            group_by="period",
            measure="value",
            aggregation="sum",
            filters=[DatasetFilter(column="source_row", value=167)],
        ),
    )
    june = next(item for item in result["items"] if item["group"] == "2026-06")
    assert june["value"] is None
