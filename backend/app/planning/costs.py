"""Versioned MVR planning allowances with local benchmarks and explicit qualifications."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

from app.planning.calibration import FACTOR_UNITS

# Cash operating costs exclude depreciation: vehicle purchases are charged separately.
# Emissions factors are unchanged; this revision calibrates money, not the carbon model.
COST_DEFAULTS = {
    "stop_capital_mvr": 250_000.0,
    "hospital_capital_mvr": 120_000_000.0,
    "school_capital_mvr": 25_000_000.0,
    "hospital_annual_operating_mvr": 20_000_000.0,
    "school_annual_operating_mvr": 5_000_000.0,
    "diesel_bus_capital_mvr": 3_000_000.0,
    "electric_bus_capital_mvr": 4_500_000.0,
    "electric_charging_capital_mvr": 750_000.0,
    "diesel_operating_mvr_per_km": 30.0,
    "electric_operating_mvr_per_km": 25.0,
    "diesel_kg_co2e_per_km": 1.3,
    "electric_kg_co2e_per_km": 0.8,
    "displaced_kg_co2e_per_passenger_km": 0.12,
    "ferry_capital_mvr": 15_000_000.0,
    "ferry_operating_mvr_per_km": 100.0,
    "ferry_kg_co2e_per_km": 25.0,
}

_SOURCES = [
    {
        "id": "sto-diesel-2026-03",
        "title": "Diesel price revision, March 2026",
        "publisher": "State Trading Organization",
        "url": "https://sto.mv/newsroom/news/22/fuel-price-revision-march-2026",
        "published_date": "2026-03-05",
        "qualification": "MVR 17.54/litre effective 5 March 2026; latest official revision "
        "located at review. Operator bulk contracts may differ.",
    },
    {
        "id": "maldives-btr-2024",
        "title": "Maldives First Biennial Transparency Report, Tables 12 and 28",
        "publisher": "Government of Maldives / UNFCCC",
        "url": "https://unfccc.int/sites/default/files/resource/MDV-BTR%201-Nov2024.pdf",
        "published_date": "2024-11",
        "qualification": "Printed p43: passenger ferry 39 litres/hour, inherited from an "
        "older survey. Printed p190: diesel urban bus 0.42 litres/km. Inventory proxies, "
        "not current operator fleet measurements.",
    },
    {
        "id": "stelco-commercial-tariff",
        "title": "Greater Malé commercial electricity tariff",
        "publisher": "State Electric Company",
        "url": "https://stelco.com.mv/tariff-rates",
        "qualification": "Published base marginal rate MVR 6.65/kWh above 10,000 units "
        "per 30 days. Lower bands, government tariffs, discounts and fuel adjustments "
        "can change the actual bill; not a fleet charging contract.",
    },
    {
        "id": "world-bank-maldives-ccdr-2024",
        "title": "Maldives Country Climate and Development Report, p50",
        "publisher": "World Bank",
        "url": "https://documents1.worldbank.org/curated/en/099062724090023235/pdf/"
        "P18052914ffd310d61afc01156a20523b73.pdf",
        "published_date": "2024-06",
        "qualification": "The bus fleet electrification programme estimate provides "
        "an order of magnitude. Vehicle and charging infrastructure prices are not "
        "isolated; it is not an individual bus quotation.",
    },
    {
        "id": "health-project-register",
        "title": "Ministry of Health contracted health projects register",
        "publisher": "Ministry of Health",
        "url": "https://health.gov.mv/storage/uploads/QoQROJwv/vrrrri7d.pdf",
        "qualification": "2025 signed 30-bed Level 1 hospital contracts include "
        "Hanimaadhoo MVR 104.83m, Ihavandhoo MVR 114.00m and Milandhoo MVR 110.88m. "
        "Contract scopes differ; these are construction benchmarks, not annual budgets.",
    },
    {
        "id": "education-inguraidhoo-2022",
        "title": "Inguraidhoo school PSIP contract",
        "publisher": "Ministry of Education",
        "url": "https://old.moe.gov.mv/en/article/view/781/PSIP-projects",
        "published_date": "2022-01-03",
        "qualification": "MVR 16.96m for four classrooms, a staff room and a multipurpose "
        "hall. Historical extension benchmark; not a full new Hulhumalé school campus.",
    },
]

# Each tuple is title, evidence classification, scope/basis, source identifiers.
_FACTORS = {
    "stop_capital_mvr": (
        "Sheltered accessible bus stop",
        "planning_allowance",
        "MVR 250,000 per new stop for a shelter, seating, signage, lighting and an "
        "accessible boarding pad at an ordinary site. Includes a modest installation "
        "allowance; major road works, land and reclamation are excluded. No comparable "
        "isolated local award price was verified.",
        [],
    ),
    "diesel_bus_capital_mvr": (
        "Diesel bus purchase",
        "planning_allowance",
        "MVR 3m per additional procured bus, including a delivery/commissioning "
        "allowance. Retained as an editable procurement allowance: no comparable "
        "current local unit quotation was verified. Size, import taxes and specification "
        "need confirmation before procurement.",
        [],
    ),
    "electric_bus_capital_mvr": (
        "Electric bus purchase",
        "benchmark_informed_allowance",
        "MVR 4.5m per additional procured electric bus. The World Bank's 2024 Maldives "
        "fleet electrification programme supports the general investment scale, but "
        "does not isolate a bus invoice. Charging is budgeted separately in this model; "
        "confirm supplier scope to avoid counting infrastructure twice.",
        ["world-bank-maldives-ccdr-2024"],
    ),
    "electric_charging_capital_mvr": (
        "Bus charging installation",
        "planning_allowance",
        "MVR 750,000 per charging installation for charger, connection and ordinary "
        "civil works. Editable allowance, not a local quotation. Land, major grid "
        "reinforcement and battery replacement require separate estimates.",
        [],
    ),
    "diesel_operating_mvr_per_km": (
        "Diesel bus running cost",
        "benchmark_informed_allowance",
        "MVR 30 per vehicle-km: fuel proxy 0.42 litres/km × MVR 17.54/litre = "
        "MVR 7.37/km, plus MVR 22.63/km planning allowance for staff, tyres, maintenance, "
        "insurance and administration. Excludes purchase/depreciation and fare revenue. "
        "Not an observed operator rate.",
        ["sto-diesel-2026-03", "maldives-btr-2024"],
    ),
    "electric_operating_mvr_per_km": (
        "Electric bus running cost",
        "benchmark_informed_allowance",
        "MVR 25 per vehicle-km: assumed battery consumption 1.2 kWh/km ÷ 90% charging "
        "efficiency × MVR 6.65/kWh = MVR 8.87/km electricity, plus MVR 16.13/km "
        "staff, maintenance, insurance and administration allowance. Consumption and "
        "efficiency are assumptions, not local measurements. Excludes purchase/depreciation.",
        ["stelco-commercial-tariff"],
    ),
    "ferry_capital_mvr": (
        "Passenger ferry purchase",
        "planning_allowance",
        "MVR 15m per additional procured passenger vessel. Editable allowance, not "
        "a verified vessel quotation. Vessel size and safety specification, delivery, "
        "taxes and terminal compatibility need confirmation. New jetties and dredging "
        "are excluded; this model connects existing terminals.",
        [],
    ),
    "ferry_operating_mvr_per_km": (
        "Ferry running cost",
        "benchmark_informed_allowance",
        "MVR 100 per vessel-km. Older inventory proxy 39 litres/hour ÷ assumed "
        "25 km/h × MVR 17.54/litre gives MVR 27.36/km fuel; MVR 72.64/km is an "
        "explicit crew, maintenance, insurance, terminal and administration allowance. "
        "Actual vessel, speed and sea conditions can differ substantially. Excludes "
        "purchase/depreciation and fare revenue; not measured RTL costs.",
        ["sto-diesel-2026-03", "maldives-btr-2024"],
    ),
    "hospital_capital_mvr": (
        "Small hospital construction",
        "benchmark_informed_allowance",
        "MVR 120m construction allowance for a roughly 30-bed Level 1 hospital, "
        "benchmarked against 2025 Ministry of Health contracts around MVR 105–114m. "
        "Not a tertiary hospital price. Land, specialist equipment, project scope and "
        "staffing require a separate estimate.",
        ["health-project-register"],
    ),
    "hospital_annual_operating_mvr": (
        "Small hospital annual running cost",
        "planning_allowance",
        "MVR 20m/year provisional staffing, utilities, supplies and maintenance "
        "allowance for a small facility. No comparable audited facility operating "
        "budget was verified; capacity and service mix must be estimated locally.",
        [],
    ),
    "school_capital_mvr": (
        "Small school building or extension",
        "benchmark_informed_allowance",
        "MVR 25m allowance for a small school building/extension, informed by the "
        "MVR 16.96m Inguraidhoo classroom, staff room and hall contract in 2022. "
        "Includes an explicit scope/contingency allowance, not indexed inflation. "
        "Not the cost of a complete large Hulhumalé campus; land is excluded.",
        ["education-inguraidhoo-2022"],
    ),
    "school_annual_operating_mvr": (
        "Small school annual running cost",
        "planning_allowance",
        "MVR 5m/year provisional staffing, utilities, materials and maintenance "
        "allowance for a small facility. Not an observed school budget; pupil capacity "
        "and staffing need a project-specific estimate.",
        [],
    ),
}


def default_factor_basis() -> dict[str, str]:
    """Preserve the emissions qualifications while describing monetary evidence honestly."""
    return {
        key: _FACTORS[key][1] if key in _FACTORS else "illustrative_default"
        for key in COST_DEFAULTS
    }


def cost_basis() -> dict[str, Any]:
    """A fresh copy prevents callers or scenario overlays mutating the shared profile."""
    return {
        "revision": "mvr-local-planning-2026-10-20",
        "reviewed_at": "2026-10-20",
        "currency": "MVR",
        "price_basis": "Editable MVR planning allowances reviewed 20 October 2026, "
        "using local fuel/tariff and construction benchmarks where available. "
        "Historical contracts retain their published nominal prices; no inflation "
        "or future escalation is inferred. These are not supplier quotations. "
        "Capital purchases and annual cash running costs are separate; fares and "
        "financing are not deducted. Manual and selected source inputs take precedence.",
        "budget": {
            "capital_mvr": 50_000_000,
            "annual_operating_mvr": 12_000_000,
            "basis": "Editable local transport pilot envelope for a ferry link and bus "
            "improvements, not a government appropriation or a hospital/school programme. "
            "At MVR 100/vessel-km, illustrative ferry activity of 64,000 vessel-km "
            "over 300 operating days uses about MVR 6.4m/year, leaving about "
            "MVR 5.6m for bus services and reserve. "
            "Actual route length, fleet, calendar and headway determine affordability.",
        },
        "factors": {
            key: {
                "value": COST_DEFAULTS[key],
                "unit": FACTOR_UNITS[key],
                "title": title,
                "evidence_type": evidence_type,
                "basis": basis,
                "source_ids": list(source_ids),
            }
            for key, (title, evidence_type, basis, source_ids) in _FACTORS.items()
        },
        "sources": deepcopy(_SOURCES),
    }
