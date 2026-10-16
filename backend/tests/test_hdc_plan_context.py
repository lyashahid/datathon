import json
from pathlib import Path

import pytest

from app.analytics.models import ChartRequest
from app.analytics.service import DatasetService
from app.data.hdc_plan_context import build_hdc_plan_context

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def context():
    return json.loads((ROOT / "data/public/hdc-plan-context.json").read_text("utf-8"))


def test_confident_plan_panels_preserve_source_values(context):
    assert len(context["observations"]) == 51
    assert len({row["id"] for row in context["observations"]}) == 51
    assert sum(row["metric"] == "land_use_area_share" for row in context["observations"]) == 29
    assert all(row["observed_current"] is False for row in context["observations"])
    office = next(
        row
        for row in context["observations"]
        if row["phase"] == "phase_1" and row["category"] == "Office"
    )
    assert office["value"] == 3.7
    assert context["qualityIssues"][0]["published_total"] == 349851
    assert context["qualityIssues"][0]["sum_of_published_phase_values"] == 349856


def test_plan_collection_is_consumable():
    service = DatasetService(ROOT / "data/public", ROOT / "backend/data")
    assert service.schema("hdc-landuse-plan-context")["row_count"] == 51
    with pytest.raises(ValueError, match="HDC planning values require"):
        service.chart(
            "hdc-landuse-plan-context",
            ChartRequest(
                group_by="phase",
                measure="value",
                aggregation="sum",
            ),
        )


@pytest.mark.skipif(
    not (ROOT / "data/public/archive/policy-evidence/hdc-landuse-plan.pdf").is_file(),
    reason="Original HDC PDF capture is not installed",
)
def test_pdf_rebuild_reproduces_panels(context):
    assert build_hdc_plan_context(ROOT) == context
