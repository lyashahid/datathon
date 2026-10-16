"""Canonical PDF export, unknown-safe fiscal arithmetic, and readable evidence receipts."""

import json
from io import BytesIO

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pypdf import PdfReader

from app.api.routes.planning_reports import router
from app.planning.models import PlanningRequest
from app.planning.report import (
    build_planning_report,
    clock_time,
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
    assert clock_time(482.5) == "08:02:30"
    assert clock_time(1500) == "01:00 (+1d)"


@pytest.mark.parametrize("structured_basis", [False, True])
def test_pdf_has_access_comparison_cost_horizons_and_source_caveats(structured_basis):
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
    evaluated = evaluation()
    if structured_basis:
        evaluated["population_basis"] = {
            "spatial_method": "residential_building_footprint_area",
            "spatial_quality": "coarse_assumption",
            "qualification": "Approximate footprint allocation; occupancy remains unverified",
        }
    result = build_planning_report(
        payload,
        evaluated,
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
    if structured_basis:
        assert "Approximate footprint allocation; occupancy remains unverified" in text


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
    result["transport_connectivity"] = {"impact": transport_impact([], before=4, after=4)}
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
    assert all("TRANSPORT SERVICE BENEFITS" not in page for page in pages)
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


@pytest.mark.parametrize("service_date, expected", [("2026-10-10", 4), ("2026-10-11", 0)])
@pytest.mark.parametrize("mode", ["bus", "ferry"])
def test_report_counts_dated_frequency_departures_and_names_actual_direction(
    service_date, expected, mode
):
    operations = []
    for origin, destination in [("north", "south"), ("south", "north")]:
        operations.append(
            {
                "type": "add_service",
                "service": {
                    "id": f"shuttle:{origin}-to-{destination}",
                    "name": "Neighborhood shuttle",
                    "mode": mode,
                    "stopIds": [origin, destination],
                    "calendar": {
                        "weekdays": list(range(7)),
                        "excludedDates": ["2026-10-11"],
                    },
                    "timing": {
                        "kind": "frequency",
                        "windows": [{"startMinutes": 480, "endMinutes": 540, "headwayMinutes": 15}],
                        "segmentMinutes": [3],
                    },
                },
            }
        )
    payload = PlanningRequest.model_validate(
        {"operations": operations, "assumptions": {"date": service_date}}
    )
    result = evaluation()
    result["world"] = {
        "stops": [{"id": "north", "name": "North stop"}, {"id": "south", "name": "South stop"}]
    }
    reader = PdfReader(BytesIO(build_planning_report(payload, result, "Dated service review")))
    pages = [" ".join(page.extract_text().split()) for page in reader.pages]
    changes = next(page for page in pages if "Proposed change and location" in page)
    assert changes.count(f"{expected} planned departures on {service_date}.") == 2
    assert "North stop to South stop" in changes
    assert "South stop to North stop" in changes
    assert "Outward service" not in changes
    heading = (
        "Bus routes and return journeys"
        if mode == "bus"
        else "Public transport and island connections"
    )
    routes = next(page for page in pages if heading in page)
    assert "North stop to South stop" in routes
    assert "South stop to North stop" in routes
    if mode == "bus":
        assert f"North stop to South stop 3 min {expected}" in routes
        assert f"South stop to North stop 3 min {expected}" in routes
    else:
        assert f"{expected * 2} planned departures" in pages[0]
    assert "Frequency service" not in routes


def transport_metrics(departures=4, wait=15, next_wait=10):
    return {
        "departure_count": departures,
        "first_departure_minutes": 480,
        "last_departure_minutes": 540,
        "next_departure_minutes": 480 + next_wait if next_wait is not None else None,
        "next_wait_minutes": next_wait,
        "expected_wait_minutes": wait,
        "expected_wait_window_start_minutes": 480,
        "expected_wait_window_end_minutes": 540,
        "crossing_minutes": 15,
    }


def transport_impact(lines, connections=None, added=0, before=4, after=8):
    return {
        "service_date": "2026-10-10",
        "departure_minutes": 480,
        "lines": lines,
        "connections": connections or [],
        "summary": {
            "changed_lines": sum(line["change"] != "unchanged" for line in lines),
            "added_connections": added,
            "removed_connections": 0,
            "improved_connections": 0,
            "departures_before": before,
            "departures_after": after,
        },
        "wait_method": "Uniform-arrival schedule model, not observed passenger waits.",
        "qualification": "Direct dated connections only; no transfer or last-mile proof.",
    }


def pdf_text(reader):
    return " ".join(" ".join(page.extract_text() for page in reader.pages).split())


def test_frequency_only_pdf_leads_with_comparable_wait_benefit_without_walking_gain():
    result = evaluation()
    result["summary"]["gained_residents"] = 0
    line = {
        "id": "r1",
        "name": "R1 neighborhood bus",
        "mode": "bus",
        "from_stop_name": "West Park",
        "to_stop_name": "HM Phase 1",
        "change": "improved",
        "before": transport_metrics(),
        "after": transport_metrics(8, 7.5, 2.5),
        "expected_wait_comparable": True,
        "expected_wait_saved_minutes": 7.5,
    }
    impact = transport_impact([line])
    result["transport_connectivity"] = {"impact": impact}
    reader = PdfReader(
        BytesIO(build_planning_report(PlanningRequest(), result, "More frequent R1"))
    )
    cover = reader.pages[0].extract_text()
    assert "SCHEDULED WAIT REDUCTION" in cover
    assert "7.5 min" in cover
    text = pdf_text(reader)
    for expected in (
        "These benefits are separate from walking access",
        "15 min",
        "7.5 min shorter",
        "Common window: 08:00 to 09:00",
        "4 dated departures",
        "8 dated departures",
        "Wait from selected time: 2.5 min",
        "Uniform-arrival schedule model, not observed passenger waits",
        "No change to the supported direct island-to-island connections",
    ):
        assert expected in text
    evidence = json.loads(reader.attachments["evaluation-evidence.json"][0])
    assert evidence["transport_connectivity"]["impact"] == impact
    assert evidence["summary"]["gained_residents"] == 0


def test_new_ferry_pdf_shows_both_directed_connections_without_claiming_saved_wait():
    result = evaluation()
    result["summary"]["gained_residents"] = 0
    line = {
        "id": "new-ferry",
        "name": "Proposed ferry",
        "mode": "ferry",
        "from_stop_name": "Hulhumalé landing",
        "to_stop_name": "Malé landing",
        "change": "added",
        "before": None,
        "after": transport_metrics(4, 30, 10),
        "expected_wait_comparable": False,
        "expected_wait_saved_minutes": None,
        "expected_wait_comparison_reason": "No baseline dated service for comparison.",
    }
    connections = [
        {
            "from_island_name": origin,
            "to_island_name": destination,
            "mode": "ferry",
            "change": "added",
            "before": None,
            "after": transport_metrics(4, 30, 10),
        }
        for origin, destination in [("Hulhumalé", "Malé"), ("Malé", "Hulhumalé")]
    ]
    result["transport_connectivity"] = {
        "impact": transport_impact([line], connections, added=2, before=0, after=4)
    }
    reader = PdfReader(BytesIO(build_planning_report(PlanningRequest(), result, "Ferry benefit")))
    text = pdf_text(reader)
    assert "Hulhumalé to Malé" in text
    assert "Malé to Hulhumalé" in text
    assert "NEW DIRECTED CONNECTIONS 2" in text
    assert "No dated service in data" in text
    assert "Expected wait: 30 min" in text
    assert "On-board time: 15 min" in text
    assert "New or removed services have no paired waiting-time savings" in text
    assert "SCHEDULED WAIT REDUCTION" not in reader.pages[0].extract_text()
    assert "min shorter" not in text


def test_noop_pdf_explicitly_preserves_waits_and_connections():
    result = evaluation()
    result["summary"]["gained_residents"] = 0
    line = {
        "name": "R1 bus",
        "mode": "bus",
        "change": "unchanged",
        "before": transport_metrics(),
        "after": transport_metrics(),
        "expected_wait_comparable": True,
        "expected_wait_saved_minutes": 0,
    }
    result["transport_connectivity"] = {"impact": transport_impact([line], before=4, after=4)}
    reader = PdfReader(
        BytesIO(
            build_planning_report(
                PlanningRequest(assumptions={"goal": "transport"}), result, "No change"
            )
        )
    )
    text = pdf_text(reader)
    assert "No dated service changes. Waiting times remain unchanged." in text
    assert "No change to the supported direct island-to-island connections." in text
    assert "SCHEDULED WAIT REDUCTION" not in reader.pages[0].extract_text()


def test_pdf_does_not_promote_incomparable_wait_as_a_reduction():
    result = evaluation()
    result["transport_connectivity"] = {
        "impact": transport_impact(
            [
                {
                    "name": "Changed hours bus",
                    "change": "changed",
                    "before": transport_metrics(),
                    "after": transport_metrics(1, None, None),
                    "expected_wait_comparable": False,
                    # The report must honor comparability, even with a supplied stale delta.
                    "expected_wait_saved_minutes": 15,
                    "expected_wait_comparison_reason": "No common operating interval.",
                }
            ]
        )
    }
    result["transport_connectivity"]["impact"]["connections"] = [
        {
            "from_island_name": "Hulhumalé",
            "to_island_name": "Malé",
            "mode": "bus",
            "change": "changed",
            "before": transport_metrics(),
            "after": {
                **transport_metrics(105, None, None),
                "boarding_stop_ids": ["north", "south"],
            },
            "expected_wait_comparable": False,
            "expected_wait_comparison_reason": "Services use different boarding stops.",
        }
    ]
    reader = PdfReader(
        BytesIO(build_planning_report(PlanningRequest(), result, "Limited evidence"))
    )
    text = pdf_text(reader)
    assert "Expected wait: Unavailable" in text
    assert "No common operating interval" in text
    assert "min shorter" not in text
    assert "Varies by boarding stop" in text
    assert "No upcoming departure" not in text
    assert "SCHEDULED WAIT REDUCTION" not in reader.pages[0].extract_text()
