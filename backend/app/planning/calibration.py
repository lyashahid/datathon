"""Source-linked, scenario-local calibration. Uploads never rewrite the source baseline."""

from __future__ import annotations

import hashlib
import json
from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, HttpUrl, model_validator

FACTOR_UNITS = {
    "stop_capital_mvr": "MVR/item",
    "hospital_capital_mvr": "MVR/item",
    "school_capital_mvr": "MVR/item",
    "hospital_annual_operating_mvr": "MVR/year",
    "school_annual_operating_mvr": "MVR/year",
    "diesel_bus_capital_mvr": "MVR/item",
    "electric_bus_capital_mvr": "MVR/item",
    "electric_charging_capital_mvr": "MVR/item",
    "diesel_operating_mvr_per_km": "MVR/vehicle-km",
    "electric_operating_mvr_per_km": "MVR/vehicle-km",
    "diesel_kg_co2e_per_km": "kgCO2e/vehicle-km",
    "electric_kg_co2e_per_km": "kgCO2e/vehicle-km",
    "displaced_kg_co2e_per_passenger_km": "kgCO2e/passenger-km",
    "ferry_capital_mvr": "MVR/item",
    "ferry_operating_mvr_per_km": "MVR/vehicle-km",
    "ferry_kg_co2e_per_km": "kgCO2e/vehicle-km",
    "electric_kwh_per_km": "kWh/vehicle-km",
    "charging_efficiency": "share",
    "grid_kg_co2e_per_kwh": "kgCO2e/kWh",
    "electricity_mvr_per_kwh": "MVR/kWh",
    "electric_non_energy_mvr_per_km": "MVR/vehicle-km",
    "diesel_litres_per_km": "litres/vehicle-km",
    "diesel_mvr_per_litre": "MVR/litre",
    "diesel_kg_co2e_per_litre": "kgCO2e/litre",
    "diesel_non_energy_mvr_per_km": "MVR/vehicle-km",
}
ENERGY_KEYS = {
    "electric_kwh_per_km",
    "charging_efficiency",
    "grid_kg_co2e_per_kwh",
    "electricity_mvr_per_kwh",
    "electric_non_energy_mvr_per_km",
    "diesel_litres_per_km",
    "diesel_mvr_per_litre",
    "diesel_kg_co2e_per_litre",
    "diesel_non_energy_mvr_per_km",
}


class CalibrationRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)

    id: str = Field(min_length=1, max_length=120, pattern=r"^[A-Za-z0-9:_-]+$")
    factor: str
    value: float = Field(ge=0, le=1e12)
    unit: str
    title: str = Field(min_length=3, max_length=240)
    publisher: str = Field(min_length=2, max_length=240)
    source_url: HttpUrl
    published_date: date
    valid_from: date
    valid_to: date | None = None
    geography: str = Field(min_length=2, max_length=240)
    basis: str = Field(min_length=8, max_length=2000)
    evidence_type: Literal["official_statistic", "operator_quote", "measurement", "assumption"]
    source_sha256: str | None = Field(default=None, pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def coherent(self) -> CalibrationRecord:
        if self.factor not in FACTOR_UNITS:
            raise ValueError("Unknown calibration factor")
        if self.unit != FACTOR_UNITS[self.factor]:
            raise ValueError(f"{self.factor} requires unit {FACTOR_UNITS[self.factor]}")
        if self.valid_to and self.valid_to < self.valid_from:
            raise ValueError("Evidence validity dates are reversed")
        if self.factor == "charging_efficiency" and not 0 < self.value <= 1:
            raise ValueError("Charging efficiency must be greater than zero and at most one")
        return self


class CalibrationImport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    records: list[CalibrationRecord] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique(self) -> CalibrationImport:
        if len({record.id for record in self.records}) != len(self.records):
            raise ValueError("Calibration record IDs must be unique")
        return self


class TariffRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    tariff_id: Literal["male_commercial", "male_government"] = "male_commercial"
    baseline_kwh: float = Field(default=0, ge=0, le=1e12)
    added_kwh: float = Field(ge=0, le=1e12)
    fuel_adjustment_mvr_per_kwh: float | None = Field(default=None, ge=-10, le=100)


def tariff_bill(units: float, bands: list[dict[str, Any]]) -> float:
    prior, total = 0.0, 0.0
    for band in bands:
        upper = band["up_to_kwh"]
        consumed = max(0, units - prior) if upper is None else max(0, min(units, upper) - prior)
        total += consumed * band["rate"]
        if upper is None or units <= upper:
            break
        prior = upper
    return total


def tariff_delta(payload: TariffRequest, references: dict[str, Any]) -> dict[str, Any]:
    tariff = next(item for item in references["tariffs"] if item["id"] == payload.tariff_id)
    before = tariff_bill(payload.baseline_kwh, tariff["bands"])
    after = tariff_bill(payload.baseline_kwh + payload.added_kwh, tariff["bands"])
    adjustment = payload.fuel_adjustment_mvr_per_kwh
    delta = after - before
    return {
        "currency": "MVR",
        "billing_days": 30,
        "tariff": tariff,
        "baseline_base_charge_mvr": round(before, 3),
        "scenario_base_charge_mvr": round(after, 3),
        "added_base_charge_mvr": round(delta, 3),
        "fuel_adjustment_mvr_per_kwh": adjustment,
        "added_charge_with_fuel_adjustment_mvr": round(delta + payload.added_kwh * adjustment, 3)
        if adjustment is not None
        else None,
        "effective_added_base_rate_mvr_per_kwh": round(delta / payload.added_kwh, 6)
        if payload.added_kwh
        else None,
        "source_receipt": next(
            source for source in references["sources"] if source["id"] == tariff["source_id"]
        ),
        "meaning": "Progressive base-charge difference for one 30-day billing account. "
        "Fuel adjustment is unknown unless explicitly supplied. Taxes, connection charges, "
        "subsidies and other account charges are excluded. Not automatically annualized.",
    }


def receipt(record: CalibrationRecord) -> dict[str, Any]:
    data = record.model_dump(mode="json")
    canonical = json.dumps(data, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return dict(data, record_sha256=hashlib.sha256(canonical.encode()).hexdigest())


def calibrate(
    defaults: dict[str, float],
    records: list[CalibrationRecord],
    selection: dict[str, str],
    manual: dict[str, float],
    energy_manual: dict[str, float],
    service_date: date,
    *,
    default_basis: dict[str, str] | None = None,
) -> dict[str, Any]:
    if set(manual).difference(defaults):
        raise ValueError("Unknown cost override")
    if set(energy_manual).difference(ENERGY_KEYS):
        raise ValueError("Unknown energy override")
    if len({record.id for record in records}) != len(records):
        raise ValueError("Calibration record IDs must be unique")
    by_id = {record.id: record for record in records}
    costs, energy = dict(defaults), dict(energy_manual)
    applied, warnings, bases = (
        [],
        [],
        {key: (default_basis or {}).get(key, "illustrative_default") for key in defaults},
    )
    for factor, record_id in selection.items():
        record = by_id.get(record_id)
        if not record or record.factor != factor:
            raise ValueError(f"Selection {factor} must reference a matching calibration record")
        if service_date < record.valid_from or (record.valid_to and service_date > record.valid_to):
            raise ValueError(f"Calibration {record_id} is not valid on the selected service date")
        if record.published_date > service_date:
            raise ValueError(
                f"Calibration {record_id} was published after the selected service date"
            )
        (energy if factor in ENERGY_KEYS else costs)[factor] = record.value
        bases[factor] = f"uploaded_{record.evidence_type}"
        applied.append(receipt(record))
        if not record.source_sha256:
            warnings.append(f"{record.title}: linked source contents have not been hash-verified")
    energy.update(energy_manual)
    bases.update(dict.fromkeys(energy_manual, "manual_energy_override"))
    if "charging_efficiency" in energy and not 0 < energy["charging_efficiency"] <= 1:
        raise ValueError("Charging efficiency must be greater than zero and at most one")
    derived = []
    formulas = [
        (
            "electric_kg_co2e_per_km",
            {"electric_kwh_per_km", "charging_efficiency", "grid_kg_co2e_per_kwh"},
            "battery kWh/km ÷ charging efficiency × grid kgCO2e/kWh",
            lambda e: (
                e["electric_kwh_per_km"] / e["charging_efficiency"] * e["grid_kg_co2e_per_kwh"]
            ),
        ),
        (
            "electric_operating_mvr_per_km",
            {
                "electric_kwh_per_km",
                "charging_efficiency",
                "electricity_mvr_per_kwh",
                "electric_non_energy_mvr_per_km",
            },
            "battery kWh/km ÷ charging efficiency × tariff + non-energy MVR/km",
            lambda e: (
                e["electric_kwh_per_km"] / e["charging_efficiency"] * e["electricity_mvr_per_kwh"]
                + e["electric_non_energy_mvr_per_km"]
            ),
        ),
        (
            "diesel_kg_co2e_per_km",
            {"diesel_litres_per_km", "diesel_kg_co2e_per_litre"},
            "litres/km × kgCO2e/litre",
            lambda e: e["diesel_litres_per_km"] * e["diesel_kg_co2e_per_litre"],
        ),
        (
            "diesel_operating_mvr_per_km",
            {"diesel_litres_per_km", "diesel_mvr_per_litre", "diesel_non_energy_mvr_per_km"},
            "litres/km × price + non-energy MVR/km",
            lambda e: (
                e["diesel_litres_per_km"] * e["diesel_mvr_per_litre"]
                + e["diesel_non_energy_mvr_per_km"]
            ),
        ),
    ]
    for factor, required, formula, compute in formulas:
        if required.issubset(energy) and factor not in selection and factor not in manual:
            costs[factor] = compute(energy)
            bases[factor] = "derived_from_explicit_energy_inputs"
            derived.append(
                {
                    "factor": factor,
                    "value": costs[factor],
                    "formula": formula,
                    "inputs": {key: energy[key] for key in sorted(required)},
                }
            )
    costs.update(manual)
    bases.update(dict.fromkeys(manual, "manual_scenario_override"))
    return {
        "costs": costs,
        "energy": energy,
        "receipts": applied,
        "derived": derived,
        "factor_basis": bases,
        "warnings": warnings,
        "meaning": "Uploaded evidence is user-supplied and unit/date-validated, not independently "
        "certified. Geography, scope and tax/inclusion basis must match the proposal. "
        "Manual scenario overrides take precedence; no currency conversion is inferred.",
    }
