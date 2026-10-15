"""Delivery resource audits test mass, precedence, date/units and actual vehicle circulation."""

import copy
import json
from datetime import date
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.api.routes.planning import router
from app.planning.calibration import (
    CalibrationImport,
    CalibrationRecord,
    TariffRequest,
    calibrate,
    receipt,
    tariff_delta,
)
from app.planning.economics import COST_DEFAULTS, economics, fleet_activity
from app.planning.models import FleetResources, PlanningAssumptions


def record(**overrides):
    return CalibrationRecord.model_validate(
        {
            **dict(
                id="quote:bus",
                factor="electric_bus_capital_mvr",
                value=3_700_000,
                unit="MVR/item",
                title="Local bus procurement quote",
                publisher="Fixture operator",
                source_url="https://example.org/quote",
                published_date="2026-10-01",
                valid_from="2026-10-01",
                valid_to="2026-12-31",
                geography="Greater Male",
                basis="Vehicle procurement excluding depot and taxes",
                evidence_type="operator_quote",
            ),
            **overrides,
        }
    )


def world():
    stops = [{"id": "a", "lon": 73.5, "lat": 4.17}, {"id": "b", "lon": 73.502, "lat": 4.17}]
    patterns = []
    for direction, stop_ids, start in [("out", ["a", "b"], 480), ("return", ["b", "a"], 550)]:
        patterns.append(
            {
                "id": direction,
                "routeId": "route:1",
                "name": "Round-trip bus",
                "mode": "bus",
                "fleet": "electric",
                "stopIds": stop_ids,
                "calendar": {"includedDates": ["2026-10-10"]},
                "distanceM": 2000,
                "timing": {
                    "kind": "scheduled",
                    "trips": [
                        {
                            "id": direction,
                            "stopTimes": [
                                {"arrivalMinutes": start, "departureMinutes": start},
                                {"arrivalMinutes": start + 10, "departureMinutes": start + 10},
                            ],
                        }
                    ],
                },
            }
        )
    return {"stops": stops, "patterns": patterns, "facilities": []}


def resources(**overrides):
    return FleetResources.model_validate(
        {
            **dict(
                activity_id="route:1|bus|electric",
                available_vehicles=2,
                vehicle_capacity=40,
                peak_passengers_per_departure=35,
                max_vehicle_duty_hours=8,
                depot_stop_ids=["a"],
                battery_kwh=10,
                battery_reserve_share=0.2,
                energy_kwh_per_km=2,
                charger_count=1,
                charger_power_kw=2,
                overnight_charging_hours=4,
                charging_efficiency=1,
            ),
            **overrides,
        }
    )


def test_source_receipt_and_local_quote_precedence():
    evidence = record()
    result = calibrate(
        COST_DEFAULTS, [evidence], {evidence.factor: evidence.id}, {}, {}, date(2026, 10, 10)
    )
    assert result["costs"][evidence.factor] == 3_700_000
    assert result["receipts"][0]["record_sha256"] == receipt(evidence)["record_sha256"]
    assert result["factor_basis"][evidence.factor] == "uploaded_operator_quote"
    assert "hash-verified" in result["warnings"][0]
    manual = calibrate(
        COST_DEFAULTS,
        [evidence],
        {evidence.factor: evidence.id},
        {evidence.factor: 4_000_000},
        {},
        date(2026, 10, 10),
    )
    assert manual["costs"][evidence.factor] == 4_000_000
    assert manual["factor_basis"][evidence.factor] == "manual_scenario_override"


@pytest.mark.parametrize(
    "change",
    [
        {"unit": "USD/item"},
        {"factor": "invented_price"},
        {"value": float("nan")},
        {"valid_to": "2026-01-01"},
        {"source_url": "file:///private"},
    ],
)
def test_reject_wrong_units_currency_dates_nonfinite_and_urls(change):
    with pytest.raises(ValidationError):
        record(**change)


def test_selection_rejects_expired_future_missing_mismatched_and_duplicate_records():
    evidence = record()
    for day in (date(2026, 9, 30), date(2027, 1, 1)):
        with pytest.raises(ValueError, match="not valid"):
            calibrate(COST_DEFAULTS, [evidence], {evidence.factor: evidence.id}, {}, {}, day)
    future = record(published_date="2026-10-11")
    with pytest.raises(ValueError, match="published after"):
        calibrate(COST_DEFAULTS, [future], {future.factor: future.id}, {}, {}, date(2026, 10, 10))
    with pytest.raises(ValueError, match="matching"):
        calibrate(
            COST_DEFAULTS,
            [evidence],
            {"hospital_capital_mvr": evidence.id},
            {},
            {},
            date(2026, 10, 10),
        )
    with pytest.raises(ValueError, match="unique"):
        CalibrationImport(records=[evidence, evidence])


def test_energy_derivation_requires_explicit_complete_inputs_and_direct_factor_wins():
    explicit = {
        "electric_kwh_per_km": 2,
        "charging_efficiency": 0.8,
        "grid_kg_co2e_per_kwh": 0.6,
        "electricity_mvr_per_kwh": 4,
        "electric_non_energy_mvr_per_km": 10,
        "diesel_litres_per_km": 0.4,
        "diesel_mvr_per_litre": 12,
        "diesel_kg_co2e_per_litre": 2.7,
        "diesel_non_energy_mvr_per_km": 15,
    }
    result = calibrate(COST_DEFAULTS, [], {}, {}, explicit, date(2026, 10, 10))
    assert result["costs"]["electric_kg_co2e_per_km"] == 1.5
    assert result["costs"]["electric_operating_mvr_per_km"] == 20
    assert result["costs"]["diesel_operating_mvr_per_km"] == 19.8
    assert result["costs"]["diesel_kg_co2e_per_km"] == 1.08
    assert len(result["derived"]) == 4
    partial = calibrate(COST_DEFAULTS, [], {}, {}, {"electric_kwh_per_km": 2}, date(2026, 10, 10))
    assert (
        partial["costs"]["electric_operating_mvr_per_km"]
        == COST_DEFAULTS["electric_operating_mvr_per_km"]
    )
    direct = calibrate(
        COST_DEFAULTS, [], {}, {"electric_operating_mvr_per_km": 30}, explicit, date(2026, 10, 10)
    )
    assert direct["costs"]["electric_operating_mvr_per_km"] == 30


def test_fleet_mass_and_all_supplied_resource_screens_pass():
    original = world()
    before = copy.deepcopy(original)
    assumptions = PlanningAssumptions(fleet_resources=[resources()])
    activity = fleet_activity(original, assumptions)["routes"][0]
    assert activity["required_fleet"] == 1
    assert activity["procurement_fleet"] == 2
    assert sum(block["distance_km"] for block in activity["blocks"]) == 4
    audit = activity["resource_audit"]
    assert audit["status"] == "screens_passed"
    assert audit["vehicle_duties"][0]["battery_energy_kwh"] == 8
    assert all(check["status"] == "passed" for check in audit["checks"])
    assert original == before


@pytest.mark.parametrize(
    "inputs,key",
    [
        ({"available_vehicles": 1}, "available_fleet"),
        ({"peak_passengers_per_departure": 41}, "passenger_capacity"),
        ({"max_vehicle_duty_hours": 1}, "vehicle_duty"),
        ({"depot_stop_ids": ["b"]}, "depot_positioning"),
        ({"battery_kwh": 9}, "battery_range"),
        ({"charger_count": 0}, "overnight_energy"),
        ({"charging_efficiency": 0.9}, "overnight_energy"),
    ],
)
def test_resource_constraints_have_real_failure_conditions(inputs, key):
    activity = fleet_activity(world(), PlanningAssumptions(fleet_resources=[resources(**inputs)]))[
        "routes"
    ][0]
    audit = activity["resource_audit"]
    assert audit["status"] == "constraints_failed"
    assert next(check for check in audit["checks"] if check["key"] == key)["status"] == "failed"


def test_no_resources_and_missing_inputs_are_unknown_not_feasible():
    baseline = fleet_activity(world(), PlanningAssumptions())["routes"][0]
    assert baseline["resource_audit"]["status"] == "not_configured"
    plan = FleetResources(activity_id="route:1|bus|electric", available_vehicles=3)
    activity = fleet_activity(world(), PlanningAssumptions(fleet_resources=[plan]))["routes"][0]
    assert activity["resource_audit"]["status"] == "incomplete"
    assert any(check["status"] == "unknown" for check in activity["resource_audit"]["checks"])


def test_unknown_depot_and_duplicate_resource_plans_rejected():
    with pytest.raises(ValueError, match="Unknown depot"):
        fleet_activity(
            world(),
            PlanningAssumptions(fleet_resources=[resources(depot_stop_ids=["no-such-stop"])]),
        )
    with pytest.raises(ValidationError, match="only one resource"):
        PlanningAssumptions(fleet_resources=[resources(), resources()])


def test_missing_distances_make_energy_unknown_even_when_chargers_supplied():
    missing = world()
    missing["patterns"][0].pop("distanceM")
    audit = fleet_activity(missing, PlanningAssumptions(fleet_resources=[resources()]))["routes"][
        0
    ]["resource_audit"]
    assert audit["vehicle_duties"][0]["battery_energy_kwh"] is None
    assert (
        next(check for check in audit["checks"] if check["key"] == "battery_range")["status"]
        == "unknown"
    )


def test_overnight_recharge_respects_next_service_day_and_depot():
    late = world()
    late["patterns"][1]["timing"]["trips"][0]["stopTimes"][-1] = {
        "arrivalMinutes": 1910,
        "departureMinutes": 1910,
    }
    activity = fleet_activity(
        late, PlanningAssumptions(fleet_resources=[resources(max_vehicle_duty_hours=48)])
    )["routes"][0]
    duty = activity["resource_audit"]["vehicle_duties"][0]
    assert duty["overnight_hours_before_next_duty"] == 0
    check = next(c for c in activity["resource_audit"]["checks"] if c["key"] == "overnight_energy")
    assert check["status"] == "failed"


def test_energy_factor_changes_real_fleet_economics_without_overwriting_baseline():
    model = world()
    assumptions = PlanningAssumptions(
        annual_operating_days=300,
        energy_overrides={
            "electric_kwh_per_km": 2,
            "charging_efficiency": 1,
            "grid_kg_co2e_per_kwh": 0.6,
        },
    )
    result = economics(model, model, assumptions)
    assert result["after"]["annual_fleet_operating_kg_co2e"] == 1440
    assert result["delta"]["annual_fleet_operating_kg_co2e"] == 0
    assert result["calibration"]["derived"][0]["value"] == 1.2


def test_tariff_progressive_delta_zero_and_unknown_fuel_adjustment():
    references = json.loads(
        (
            Path(__file__).resolve().parents[2] / "data/public/delivery-evidence/references.json"
        ).read_text()
    )
    result = tariff_delta(TariffRequest(baseline_kwh=90, added_kwh=20), references)
    assert result["added_base_charge_mvr"] == 66.5
    assert result["added_charge_with_fuel_adjustment_mvr"] is None
    assert result["effective_added_base_rate_mvr_per_kwh"] == 3.325
    adjusted = tariff_delta(
        TariffRequest(baseline_kwh=90, added_kwh=20, fuel_adjustment_mvr_per_kwh=-0.12), references
    )
    assert adjusted["added_charge_with_fuel_adjustment_mvr"] == 64.1
    zero = tariff_delta(TariffRequest(baseline_kwh=10000, added_kwh=0), references)
    assert zero["added_base_charge_mvr"] == 0
    assert zero["effective_added_base_rate_mvr_per_kwh"] is None


def test_calibration_api_validates_receipts_and_rejects_partial_wrong_units():
    app = FastAPI()
    app.include_router(router)
    with TestClient(app) as client:
        catalogue = client.get("/api/v1/planning/calibration")
        assert catalogue.status_code == 200
        assert catalogue.json()["references"]["historical_energy"]["reference_year"] == 2022
        payload = {"records": [record().model_dump(mode="json")]}
        verified = client.post("/api/v1/planning/calibration/validate", json=payload)
        assert verified.status_code == 200
        assert len(verified.json()["records"][0]["record_sha256"]) == 64
        payload["records"][0]["unit"] = "USD/item"
        assert client.post("/api/v1/planning/calibration/validate", json=payload).status_code == 422
        result = client.post(
            "/api/v1/planning/calibration/tariff", json={"baseline_kwh": 90, "added_kwh": 20}
        )
        assert result.status_code == 200
        assert result.json()["added_base_charge_mvr"] == 66.5
