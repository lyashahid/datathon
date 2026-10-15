"""Canonical PDF export, unknown-safe fiscal arithmetic, and readable evidence receipts."""

import json
from io import BytesIO

from fastapi import FastAPI
from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.api.routes.planning_reports import router
from app.planning.models import PlanningRequest
from app.planning.report import (
    build_planning_report,
    compact_amount,
    factor_amount,
    finite,
    fiscal_chart,
    fiscal_projection,
    travel_band_chart,
)


def evaluation():
    return {
        "summary": {
            "population": 100,
            "baseline_reachable_residents": 30,
            "scenario_reachable_residents": 80,
            "gained_residents": 50,
            "lost_residents": 0,
            "unknown_residents": 20,
        },
        "economics": {
            "delta": {"capital_mvr": 25_000_000, "annual_operating_mvr": 5_000_000},
            "budget": {"capital_budget_mvr": 30_000_000, "capital_remaining_mvr": 5_000_000},
            "assumptions": {"school_capital_mvr": 25_000_000},
            "basis": "Editable planning assumptions; not official quotations",
            "warnings": ["Facility emissions are unavailable, not zero."],
            "sensitivity": {},
        },
        "coverage": {"meaning": "Fixture dated walking and transit network."},
        "access_method": "Each modeled resident origin counts once.",
        "population_basis": "Fixture allocated resident areas",
        "travel_time_bands": {
            "before": [{"label": "0-15 minutes", "residents": 30}],
            "after": [{"label": "0-15 minutes", "residents": 80}],
        },
        "warnings": ["This does not predict actual ridership."],
        "source_receipts": [{"path": "fixture-source.json", "sha256": "a" * 64}],
        "version_pins": {"dataset": "fixture-1", "model": "test-canonical"},
    }


def test_fiscal_projection_has_constant_cost_assumptions_and_preserves_unknown():
    assert fiscal_projection(25_000_000, 5_000_000)[2]["total_mvr"] == 75_000_000
    assert fiscal_projection(100_000, None)[0]["total_mvr"] is None
    assert fiscal_projection(100_000, -20_000)[2]["total_mvr"] == -100_000
    assert factor_amount(0.12) == "0.12"
    assert factor_amount(1.3) == "1.3"


def test_pdf_has_access_comparison_cost_horizons_and_source_caveats():
    payload = PlanningRequest.model_validate(
        {
            "island_id": "male",
            "operations": [
                {
                    "type": "add_school",
                    "coordinates": [73.5, 4.17],
                    "name": "Harbour school <draft>",
                    "opening_date": "2026-10-10",
                }
            ],
        }
    )
    result = build_planning_report(
        payload,
        evaluation(),
        "Island investment brief",
        {
            "islands": [{"id": "male", "name": "Malé"}],
            "graph_edges": [{"geometry": [[73.499, 4.169], [73.502, 4.171]]}],
        },
    )
    assert result.startswith(b"%PDF-")
    reader = PdfReader(BytesIO(result))
    text = " ".join(" ".join(page.extract_text() for page in reader.pages).split())
    for expected in (
        "Island investment brief",
        "Harbour school <draft>",
        "75,000,000",
        "Unknown inputs remain unavailable",
        "fixture-source.json",
        "test-canonical",
        "does not grant planning approval",
        "Facility emissions are unavailable, not zero",
        "source-backed walking-road network",
    ):
        assert expected in text
    assert all("Page " in page.extract_text() for page in reader.pages)
    assert "proposal-inputs.json" in reader.attachments
    assert b"Harbour school <draft>" in reader.attachments["proposal-inputs.json"][0]


def test_export_recalculates_canonical_results_and_rejects_supplied_totals():
    class CanonicalService:
        calls = 0

        def evaluate(self, payload):
            self.calls += 1
            assert isinstance(payload, PlanningRequest)
            return evaluation()

        def baseline(self, island_id):
            return {"graph_edges": []}

    app = FastAPI()
    service = CanonicalService()
    app.state.planning = service
    app.include_router(router)
    client = TestClient(app)
    response = client.post("/api/v1/planning/report.pdf?title=Canonical%20brief", json={})
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert "attachment" in response.headers["content-disposition"]
    assert response.headers["cache-control"] == "no-store"
    assert service.calls == 1
    assert "Canonical brief" in PdfReader(BytesIO(response.content)).pages[0].extract_text()
    invalid = client.post("/api/v1/planning/report.pdf", json={"evaluation": evaluation()})
    assert invalid.status_code == 422
    assert service.calls == 1


def test_visual_report_leads_with_outcomes_and_preserves_exact_chart_evidence():
    result = evaluation()
    result["summary"]["gained_residents"] = 50.125
    result["economics"]["budget"]["annual_operating_budget_mvr"] = 6_000_000
    reader = PdfReader(BytesIO(build_planning_report(PlanningRequest(), result, "A better island")))
    assert len(reader.pages) >= 5
    pages = [page.extract_text() for page in reader.pages]
    assert "RESIDENTS GAINING TARGET ACCESS" in pages[0]
    assert "Current services" in pages[0] and "With proposal" in pages[0]
    assert "Travel-time distribution" in pages[1]
    assert "Known access lost".upper() in pages[1]
    assert "Capital budget" in pages[2] and "5,000,000 remaining" in pages[2]
    assert "Fiscal outlook: 1, 5 and 10 years" in pages[2]
    assert "75,000,000" in pages[2]
    evidence = json.loads(reader.attachments["evaluation-evidence.json"][0])
    assert evidence["summary"]["gained_residents"] == 50.125
    assert evidence["travel_time_bands"] == result["travel_time_bands"]
    assert evidence["economics"] == result["economics"]
    # Charts remain sharp at any zoom and do not depend on a screenshot service.
    assert all("/XObject" not in page["/Resources"] for page in reader.pages[:3])


def test_report_distinguishes_missing_inputs_budget_overruns_and_operating_savings():
    result = evaluation()
    result["summary"] = dict.fromkeys(result["summary"], None)
    result["economics"]["delta"] = {"capital_mvr": 100_000, "annual_operating_mvr": -20_000}
    result["economics"]["budget"] = {"capital_budget_mvr": 0}
    result["travel_time_bands"] = {}
    reader = PdfReader(BytesIO(build_planning_report(PlanningRequest(), result, "Savings review")))
    text = " ".join(page.extract_text() for page in reader.pages)
    assert "Over budget by MVR 100,000" in text
    assert "-100,000" in text
    assert "Travel-time distribution unavailable" in text
    assert "Unavailable" in reader.pages[0].extract_text()
    assert finite(True) is None
    assert compact_amount(None) == "Unavailable"
    assert compact_amount(0) == "0"
    assert compact_amount(25_000_000) == "25m"


def test_transport_report_explains_walking_access_separately_from_scheduled_services():
    result = evaluation()
    result["access_method"] = (
        "Shortest elapsed time including walking, scheduled waits and transfers."
    )
    reader = PdfReader(
        BytesIO(
            build_planning_report(
                PlanningRequest(assumptions={"goal": "transport", "target_minutes": 10}),
                result,
                "Transport access review",
            )
        )
    )
    text = " ".join(" ".join(page.extract_text() for page in reader.pages).split())
    assert "Shortest walking time to mapped public transport boarding points" in text
    assert "excludes scheduled waits, sailing times and transfers" in text
    assert result["access_method"] not in text


def test_chart_unknowns_remain_visible_and_bar_geometry_has_no_inverted_corners():
    missing = fiscal_chart(100_000, None, 480)
    assert any(
        getattr(item, "text", "") == "Fiscal projection unavailable" for item in missing.contents
    )
    chart = travel_band_chart(
        {
            "before": [{"label": "0-15 min", "residents": 100}],
            "after": [{"label": "0-15 min", "residents": None}],
        },
        480,
    )
    assert any(getattr(item, "text", "") == "Unavailable" for item in chart.contents)
    for item in chart.contents:
        if hasattr(item, "rx"):
            assert item.rx <= item.width / 2
            assert item.ry <= item.height / 2
