"""Convert official island workbooks into explicit, source-backed API context.

These are whole-island census indicators and projections. Age indicators describe
resident Maldivians only; labour rates cannot be summed or turned into commuters.
No indicator is allocated to individual buildings or heatmap cells here.
"""

from __future__ import annotations

import hashlib
import json
import math
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from openpyxl import load_workbook

from app.data.normalize.names import normalize_atoll_code
from app.data.population import ATOLLS, attach_population

CONTEXT_VERSION = "official-island-context-v1"
SOURCE_IDS = (
    "mbs-census2022-population",
    "mbs-census2022-employment",
    "mbs-population-definitions",
    "mbs-employment-definitions",
    "mbs-island-projections",
)

# Both alternative spellings occur in the employment and projection workbooks.
# Their same-atoll population-indicator counterparts establish the identity;
# neither alias is applied without its administrative-atoll key.
SOURCE_ALIASES = {("l", "Mundhoo"): "Mundoo", ("gdh", "Madeveli"): "Madaveli"}
LABOUR_METRICS = (
    "labour_force_participation_rate",
    "employment_population_ratio",
    "unemployment_rate",
    "unemployment_and_potential_labour_force_rate",
    "inactivity_rate",
    "youth_unemployment_15_24_rate",
    "youth_unemployment_18_35_rate",
    "neet_15_24_rate",
    "neet_18_35_rate",
)
AGE_COHORTS = (
    ("children_0_17", 20),
    ("children_0_14", 23),
    ("adolescents_10_19", 26),
    ("working_age_15_64", 29),
    ("youth_15_24", 32),
    ("youth_18_35", 35),
    ("older_adults_65_plus", 38),
)


def _number(value: Any) -> int | float | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
        return value
    if value is None:
        return None
    raise ValueError(f"Unexpected non-numeric official indicator: {value!r}")


def _receipt(path: Path, root: Path) -> dict[str, Any]:
    content = path.read_bytes()
    return {
        "path": path.relative_to(root).as_posix(),
        "sha256": hashlib.sha256(content).hexdigest(),
        "bytes": len(content),
    }


def _workbook_rows(path: Path, sheet: str | None = None) -> list[tuple[Any, ...]]:
    workbook = load_workbook(path, read_only=True, data_only=True)
    try:
        return list((workbook[sheet] if sheet else workbook.active).values)
    finally:
        workbook.close()


def _require_header(rows: list[tuple[Any, ...]], row: int, column: int, expected: Any) -> None:
    if len(rows) < row or len(rows[row - 1]) < column or rows[row - 1][column - 1] != expected:
        raise ValueError(f"Official workbook header changed at row {row}, column {column}")


def _identity_rows(
    rows: list[tuple[Any, ...]], islands: list[dict[str, Any]], source: str, sheet: str
) -> list[tuple[dict[str, Any], tuple[Any, ...]]]:
    result = []
    for row_number, values in enumerate(rows, 1):
        code = normalize_atoll_code(values[0] if isinstance(values[0], str) else None)
        if code not in ATOLLS or not values[1] or not isinstance(values[2], (int, float)):
            continue
        if "non-administrative" in str(values[1]).casefold():
            continue
        locality = str(values[1]).strip()
        matched_locality = SOURCE_ALIASES.get((code, locality), locality)
        identity = {
            "atoll_code": code,
            "locality": matched_locality,
            "source_locality": locality,
            "source_id": source,
            "source_sheet": sheet,
            "source_row": row_number,
        }
        attach_population([identity], islands)
        if not identity.get("island_id"):
            raise ValueError(f"Unresolved official island: {source}/{code}/{locality}")
        if matched_locality != locality:
            identity["alias_basis"] = (
                f"Same-atoll Census population indicator uses {matched_locality}; "
                f"employment/projection sheet uses {locality}."
            )
        result.append((identity, values))
    identifiers = [item[0]["island_id"] for item in result]
    if len(set(identifiers)) != len(identifiers):
        raise ValueError(f"Duplicate island identity in {source}/{sheet}")
    return result


def build_island_context(root: Path) -> dict[str, Any]:
    """Build a portable artifact; callers decide where to save it."""
    root = root.resolve()
    raw = root / "data" / "raw"
    manifest = json.loads((raw / "source-manifest.json").read_text(encoding="utf-8"))
    indexed = {item["id"]: item for item in manifest["sources"]}
    sources = []
    for source_id in SOURCE_IDS:
        source = indexed[source_id]
        receipt = _receipt(raw / source["file"], root)
        if source.get("sha256") and source["sha256"] != receipt["sha256"]:
            raise ValueError(f"Source checksum differs from captured manifest: {source_id}")
        sources.append(
            {
                "id": source_id,
                "title": source["title"],
                "url": source["url"],
                "reference_year": source["referenceYear"],
                "license": source["license"],
                "captured_at": source.get("fetchedAt"),
                "receipt": receipt,
            }
        )
    islands_path = root / "backend" / "data" / "cache" / "normalized" / "islands.geojson"
    islands = json.loads(islands_path.read_text(encoding="utf-8"))["features"]
    demographics = []
    census_values = _workbook_rows(raw / "census2022-population.xlsx")
    _require_header(census_values, 3, 3, "Resident Population")
    _require_header(census_values, 4, 21, "Child Population (0-17 yrs)")
    _require_header(census_values, 4, 39, "Elderly Population  (65+ yrs)")
    _require_header(census_values, 3, 53, "Median Age")
    population_rows = _identity_rows(
        census_values,
        islands,
        "mbs-census2022-population",
        "Indicator Island",
    )
    for identity, values in population_rows:
        item = {**identity, "year": 2022, "geography_grain": "administrative_island"}
        for label, start in (("residents", 2), ("maldivians", 5), ("foreigners", 8)):
            for offset, sex in enumerate(("total", "male", "female")):
                item[f"{label}_{sex}"] = _number(values[start + offset])
        for offset, sex in enumerate(("total", "male", "female")):
            item[f"maldivians_2014_{sex}"] = _number(values[11 + offset])
        for label, start in AGE_COHORTS:
            for offset, sex in enumerate(("total", "male", "female")):
                item[f"maldivian_{label}_{sex}"] = _number(values[start + offset])
        for offset, (label, _) in enumerate(AGE_COHORTS):
            item[f"maldivian_{label}_percent"] = _number(values[41 + offset])
        for name, column in (
            ("maldivian_growth_2014_2022_percent", 14),
            ("foreign_residents_percent", 15),
            ("maldivian_sex_ratio", 16),
            ("maldivian_dependency_ratio", 17),
            ("maldivian_child_dependency_ratio", 18),
            ("maldivian_aged_dependency_ratio", 19),
            ("area_hectares", 48),
            ("area_square_km", 49),
            ("residents_per_square_km", 50),
            ("maldivians_per_square_km", 51),
            ("resident_median_age", 52),
            ("maldivian_median_age", 53),
            ("foreign_median_age", 54),
        ):
            item[name] = _number(values[column])
        demographics.append(item)

    employment = []
    employment_values = _workbook_rows(raw / "census2022-employment.xlsx")
    _require_header(employment_values, 4, 3, "Labour force participation rate (%)")
    _require_header(employment_values, 3, 30, "Resident Maldivian")
    _require_header(employment_values, 4, 54, "NEET rate (18-35 years)")
    for identity, values in _identity_rows(
        employment_values,
        islands,
        "mbs-census2022-employment",
        "Indicator sheet-island",
    ):
        for scope, start in (("residents", 2), ("resident_maldivians", 29)):
            for sex_offset, sex in enumerate(("both", "female", "male")):
                employment.append(
                    {
                        **identity,
                        "year": 2022,
                        "population_scope": scope,
                        "sex": sex,
                        "unit": "percent",
                        "geography_grain": "administrative_island",
                        **{
                            metric: _number(values[start + metric_offset * 3 + sex_offset])
                            for metric_offset, metric in enumerate(LABOUR_METRICS)
                        },
                    }
                )

    projections: dict[tuple[str, int], dict[str, Any]] = {}
    for scope, sheet in (
        ("residents", "Resident Population"),
        ("maldivians", "Maldivian Population"),
        ("foreigners", "Resident Foreign population"),
    ):
        projection_values = _workbook_rows(raw / "island-projections2022-2030.xlsx", sheet)
        for year in range(2022, 2031):
            _require_header(projection_values, 3, 3 + (year - 2022) * 3, year)
        for identity, values in _identity_rows(
            projection_values,
            islands,
            "mbs-island-projections",
            sheet,
        ):
            for year in range(2022, 2031):
                key = identity["island_id"], year
                item = projections.setdefault(
                    key,
                    {
                        **identity,
                        "source_sheet": "Resident Population; Maldivian Population; "
                        "Resident Foreign population",
                        "year": year,
                        "geography_grain": "administrative_island",
                        "basis": "atoll_projection_ratio_allocation",
                    },
                )
                for offset, sex in enumerate(("total", "male", "female")):
                    item[f"{scope}_{sex}"] = _number(values[2 + (year - 2022) * 3 + offset])

    definitions = []
    for source, filename, domain in (
        ("mbs-population-definitions", "population-definitions.xlsx", "population"),
        ("mbs-employment-definitions", "employment-definitions.xlsx", "employment"),
    ):
        for row_number, values in enumerate(_workbook_rows(raw / filename), 1):
            cells = [str(value).strip() for value in values if value is not None]
            if not cells or cells[0] == "Term":
                continue
            definitions.append(
                {
                    "domain": domain,
                    "term": cells[0],
                    "definition": cells[1] if len(cells) > 1 else cells[0],
                    "source_id": source,
                    "source_sheet": "Definition",
                    "source_row": row_number,
                }
            )
    demographic_ids = {item["island_id"] for item in demographics}
    projection_ids = {item["island_id"] for item in projections.values()}
    employment_ids = {item["island_id"] for item in employment}
    if (
        len(demographic_ids) != 186
        or demographic_ids != projection_ids
        or demographic_ids != employment_ids
    ):
        raise ValueError(
            "Official island workbooks must cover the same 186 administrative-island identities"
        )
    return {
        "transformVersion": CONTEXT_VERSION,
        "generatedAt": datetime.now(UTC).isoformat(),
        "sources": sources,
        "identity_source": _receipt(islands_path, root),
        "demographics": demographics,
        "employment": employment,
        "projections": list(projections.values()),
        "definitions": definitions,
        "coverage": {
            "administrative_islands": len(demographic_ids),
            "census_year": 2022,
            "projection_years": list(range(2022, 2031)),
            "demographic_rows": len(demographics),
            "employment_rows": len(employment),
            "projection_rows": len(projections),
            "missing_employment_rates": sum(
                row[metric] is None for row in employment for metric in LABOUR_METRICS
            ),
            "reviewed_aliases": [
                {"atoll_code": code, "source_locality": source, "matched_locality": target}
                for (code, source), target in SOURCE_ALIASES.items()
            ],
        },
        "qualifications": [
            "Census indicators describe 2022 whole-island residents, not current neighbourhoods.",
            "Age cohort counts and dependency ratios apply to resident Maldivians only. "
            "Age cohorts overlap and must not be added together.",
            "Employment indicators are published percentages, not workers, riders or commutes. "
            "Rates require their own denominators and cannot be summed or population weighted "
            "using total residents; working age in the labour definitions is 15 years and older.",
            "Island projections use the MBS ratio method to allocate atoll projections, with "
            "nationality and sex but no projected ages; projected 2022 is not the census count.",
            "Malé city, resorts and industrial islands are outside these 186 indicator rows. "
            "An absent record means unavailable, not zero.",
        ],
    }


def island_context_profile(bundle: dict[str, Any], island_id: str) -> dict[str, Any]:
    demographics = next(
        (row for row in bundle.get("demographics", []) if row.get("island_id") == island_id), None
    )
    return {
        "status": "available" if demographics else "unavailable",
        "geography_grain": "administrative_island",
        "census_demographics": demographics,
        "employment": [
            row for row in bundle.get("employment", []) if row.get("island_id") == island_id
        ],
        "projections": [
            row for row in bundle.get("projections", []) if row.get("island_id") == island_id
        ],
        "transform_version": bundle.get("transformVersion"),
        "sources": bundle.get("sources", []) if demographics else [],
        "qualifications": bundle.get("qualifications", []),
    }
