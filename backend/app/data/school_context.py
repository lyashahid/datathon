"""Reproduce typed school statistics from the Ministry's published 2023/24 grids.

School localities are enrollment locations, not pupils' homes or school capacity.
Source blanks stay null. Published totals and conflicting cells remain separate
from the disjoint locality/grade/sex records used for enrollment analysis.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.data.normalize.names import normalize_name
from app.data.population import ATOLLS, attach_population

VERSION = "moe-school-statistics-2023-grid-v1"
SOURCE_ID = "moe-school-statistics-2023"
SOURCE_PATH = "data/public/archive/policy-evidence/school-statistics-2023.pdf"
GRADES = ("BN", "N", "LKG", "UKG", *(f"GR{i}" for i in range(1, 13)))
ATOLL_HEADINGS = {
    "Haa Alif": "ha",
    "Haa Dhaalu": "hdh",
    "Shaviyani": "sh",
    "Noonu": "n",
    "Raa": "r",
    "Baa": "b",
    "Lhaviyani": "lh",
    "Kaafu": "k",
    "Alif Alif": "aa",
    "Alif Dhaalu": "adh",
    "Vaavu": "v",
    "Meemu": "m",
    "Faafu": "f",
    "Dhaalu": "dh",
    "Thaa": "th",
    "Laamu": "l",
    "Gaafu Alif": "ga",
    "Gaafu Dhaalu": "gdh",
    "Gnaviyani": "gn",
    "Seenu": "s",
}

# Reviewed same-atoll spelling pairs against the captured OneMap island names.
# Numeric locality suffixes are publisher disambiguators and are removed only
# before a same-atoll exact match. A combined locality is never split or joined.
ALIASES = {
    ("ha", "mulhadhoo"): "Molhadhoo",
    ("ha", "uligamu"): "Uligan",
    ("hdh", "nolhivaram"): "Nolhivaran",
    ("sh", "bileffahi"): "Bileiyfahi",
    ("sh", "maaungoodhoo"): "Maaun'goodhoo",
    ("n", "kudafaree"): "Kudafari",
    ("n", "lhohee"): "Lhohi",
    ("r", "maduvvaree"): "Maduvvari",
    ("b", "dhonfanu"): "Dhonfan",
    ("adh", "hagnaameedhoo"): "Hangnaameedhoo",
    ("adh", "dhiddhoo"): "Dhidhdhoo",
    ("adh", "maamingili"): "Maamigili",
    ("m", "mulaku"): "Mulah",
    ("m", "veyvashu"): "Veyvah",
    ("f", "bilehdhoo"): "Bileiydhoo",
    ("th", "burunee"): "Buruni",
    ("ga", "kolamafushi"): "Kolamaafushi",
    ("l", "mundoo"): "Mundoo",
    ("gdh", "fares mathoda"): "Faresmaathodaa",
    ("gdh", "hodedhdhoo"): "Hoan'dehdhoo",
    ("gdh", "nadella"): "Nadellaa",
    ("s", "meedhoo"): "Addu Meedhoo",
    ("gn", "fuvammulah"): "Fuvahmulah",
}


def _text(value: Any) -> str:
    return " ".join(str(value if value is not None else "").split())


def _numeric(value: Any) -> int | float | None:
    text = _text(value)
    if not text:
        return None
    if not re.fullmatch(r"\d[\d,]*(?:\.\d+)?", text):
        raise ValueError(f"Unexpected school-statistics numeric cell: {value!r}")
    return float(text.replace(",", "")) if "." in text else int(text.replace(",", ""))


def _atoll(locality: str) -> str | None:
    key = normalize_name(locality)
    if "greater male" in key:
        return "mle"
    return next((code for code, name in ATOLLS.items() if normalize_name(name) == key), None)


def _identity(locality: str, code: str, islands: list[dict[str, Any]]) -> dict[str, Any]:
    identity: dict[str, Any] = {"island_id": None, "match_status": "unmapped_school_locality"}
    if locality == "Hulhumeedhoo":
        return {**identity, "match_status": "combined_school_locality_not_unique_island"}
    name = re.sub(r"-\d+$", "", locality)
    if code == "mle":
        # Some PDF extractors emit the final accented e as U+FFFD. These three
        # names and their table heading were visually reviewed on source p36.
        male_ids = {
            "hulhumal": "island:1442",
            "hulhumale": "island:1442",
            "mal": "island:1443",
            "male": "island:1443",
            "vilimal": "island:1382",
            "vilimale": "island:1382",
        }
        identity["island_id"] = male_ids.get(normalize_name(name))
        identity["match_status"] = "reviewed_pdf_label" if identity["island_id"] else "unmapped"
    else:
        name = ALIASES.get((code, normalize_name(name)), name)
        record = {"locality": name, "atoll_code": code}
        attach_population([record], islands)
        identity.update({key: record[key] for key in ("island_id", "match_status")})
    if identity["island_id"]:
        if identity["island_id"] not in {f.get("properties", {}).get("id") for f in islands}:
            return {"island_id": None, "match_status": "identity_not_in_catalogue"}
        identity["mapping_basis"] = "School locality + administrative atoll + reviewed OneMap name"
        if name != locality:
            identity["matched_locality"] = name
            identity["alias_basis"] = (
                "Reviewed source spelling or publisher disambiguation suffix; "
                "unique same-atoll OneMap residential island"
            )
    return identity


def _base(page: int, table: int, title: str, row: int) -> dict[str, Any]:
    return {
        "source_id": SOURCE_ID,
        "source_page": page,
        "source_table": table,
        "source_row": row,
        "table_id": f"school-2023-p{page}-t{table}",
        "table_title": title,
        "year": 2023,
        "reference_period": "November 2023; academic 2023/24",
    }


def _enrollment_table(
    table: list[list[Any]], page: int, index: int, islands: list[dict[str, Any]]
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    title = _text(table[0][0])
    code = next(
        (
            code
            for name, code in ATOLL_HEADINGS.items()
            if title.startswith(f"Enrollment in {name} Atoll")
        ),
        "mle" if "Greater Male" in title else None,
    )
    if code is None or any(len(row) != 37 for row in table):
        raise ValueError(f"Unrecognized enrollment table on page {page}")
    grade_header = next((r for r in table if r[1] == "BN"), None)
    if grade_header is None or tuple(grade_header[1:33:2]) != GRADES:
        raise ValueError(f"Grade columns changed on school-statistics page {page}")
    sex_row = next((n for n, row in enumerate(table) if row[1:5] == ["M", "F", "M", "F"]), None)
    if sex_row is None or table[sex_row][1:] != ["M", "F"] * 18:
        raise ValueError(f"Sex columns changed on school-statistics page {page}")
    enrollment, context, issues = [], [], []
    for row_number, row in enumerate(table[sex_row + 1 :], sex_row + 2):
        locality = _text(row[0])
        if not locality:
            continue
        aggregate = locality == "Atoll Total"
        base = {
            **_base(page, index, title, row_number),
            "atoll_code": code,
            "locality": locality,
            "geography_grain": "region" if aggregate else "school_locality",
            **(
                {"island_id": None, "match_status": "published_aggregate"}
                if aggregate
                else _identity(locality, code, islands)
            ),
        }
        values = [_numeric(value) for value in row[1:]]
        for sex_index, sex in enumerate(("male", "female")):
            subtotal, percent = values[32 + sex_index], values[34 + sex_index]
            grade_values = values[sex_index:32:2]
            observed_sum = sum(value for value in grade_values if value is not None)
            if subtotal is not None and subtotal != observed_sum:
                issue = {
                    **base,
                    "kind": "published_grade_subtotal_conflict",
                    "sex": sex,
                    "grade_sum": observed_sum,
                    "published_subtotal": subtotal,
                }
                if not aggregate:
                    raise ValueError(
                        f"Locality grade extraction does not conserve its subtotal: {issue}"
                    )
                issues.append(issue)
            for grade_index, grade in enumerate(GRADES):
                cell = {
                    **base,
                    "grade": grade,
                    "sex": sex,
                    "value": grade_values[grade_index],
                    "unit": "students",
                    "metric": "enrolled_students",
                    "source_column": 2 + grade_index * 2 + sex_index,
                    "is_total": aggregate,
                    "status": (
                        "not_reported" if grade_values[grade_index] is None else "published"
                    ),
                }
                (context if aggregate else enrollment).append(cell)
            for column, metric, value, unit in (
                (34 + sex_index, "enrolled_students_subtotal", subtotal, "students"),
                (36 + sex_index, "enrolled_students_sex_share", percent, "percent"),
            ):
                context.append(
                    {
                        **base,
                        "sex": sex,
                        "value": value,
                        "unit": unit,
                        "metric": metric,
                        "source_column": column,
                        "is_total": aggregate,
                        "status": "not_reported" if value is None else "published",
                    }
                )
        if values[34] is not None and values[35] is not None:
            if abs(values[34] + values[35] - 100) > 0.11:
                issues.append(
                    {
                        **base,
                        "kind": "published_sex_percent_conflict",
                        "male_percent": values[34],
                        "female_percent": values[35],
                    }
                )
    return enrollment, context, issues


def _headers(table: list[list[Any]], count: int) -> list[list[str]]:
    """Forward-fill merged cells only within the same higher-level header."""
    headers: list[list[str]] = []
    for raw in table[1:count]:
        row, last, previous_parents = [], "", None
        for column, value in enumerate(raw):
            parents = tuple(parent[column] for parent in headers)
            if parents != previous_parents:
                last = ""
            if _text(value):
                last = _text(value)
            row.append(last)
            previous_parents = parents
        headers.append(row)
    return headers


def _context_table(table: list[list[Any]], page: int, index: int) -> list[dict[str, Any]]:
    title = _text(table[0][0])
    expected_width = {
        10: 5 if index == 2 else 9, 11: 19, 12: 14, 13: 19, 14: 19, 15: 19,
        16: 19, 17: 25, 18: 19, 19: 10, 20: 17, 37: 12,
    }[page]
    if any(len(row) != expected_width for row in table):
        raise ValueError(f"School context column layout changed on page {page}")
    header_count = 3 if page in (12, 20) else 4 if page in (*range(16, 20), 37) else 2
    dimensions = 2 if page in (11, 13, 14, 15) else 1
    headers = _headers(table, header_count)
    result, carried_label = [], ""
    for row_number, row in enumerate(table[header_count:], header_count + 1):
        if not any(_text(value) for value in row):
            continue
        label = _text(row[0])
        if not label and dimensions == 2 and _text(row[1]) in ("M", "F", "T"):
            label = carried_label
        if not label:
            raise ValueError(f"Unlabelled source data row on page {page}: {row!r}")
        carried_label = label
        for column in range(dimensions, len(row)):
            path = list(dict.fromkeys(h[column] for h in headers if h[column]))
            sex = None
            fields: dict[str, Any] = {"geography_grain": "national"}
            metric, unit = "enrolled_students", "students"
            if dimensions == 2:
                sex = {"M": "male", "F": "female", "T": "both"}.get(_text(row[1]))
                fields["sector" if page == 11 else "locality"] = label
                if page != 11:
                    fields.update(
                        atoll_code=label.lower() if label.lower() in ATOLLS else _atoll(label),
                        geography_grain="published_locality",
                    )
                fields["grade"] = path[-1]
            elif page == 10:
                if "Gender" in title:
                    sex = label.lower() if label != "Total" else "both"
                    fields["sector" if "Sector" in title else "key_stage"] = path[-1]
                else:
                    fields["sector" if "Sector" in title else "locality"] = label
                    fields["key_stage"] = path[-1]
                    if "Locality" in title:
                        fields["geography_grain"] = "published_locality"
                        fields["atoll_code"] = _atoll(label)
            elif page == 12:
                fields.update(
                    locality=label,
                    atoll_code=_atoll(label),
                    geography_grain="published_locality",
                    sector=path[0],
                )
                if path[-1] == "Schools":
                    metric, unit = "schools", "schools"
                else:
                    sex = {"Male": "male", "Female": "female", "Total": "both"}[path[-1]]
            elif 16 <= page <= 19:
                fields["age_group"] = label
                fields["grade_or_stage"] = path[-2]
                sex = {"M": "male", "F": "female", "T": "both", "Total": "both"}[path[-1]]
            elif page == 20:
                fields["education_level_age_group"] = label
                sex = {
                    "Male": "male",
                    "Female": "female",
                    "Total": "both",
                    "Both Sexes": "both",
                }.get(path[-1])
                metric = {
                    "Maldivian Population": "maldivian_population",
                    "Enrolment (Official age)": "official_age_enrolment",
                    "Enrolment (Total)": "enrolled_students",
                    "Net Enrolment Ratio": "net_enrolment_ratio",
                    "Gross Enrolment Ratio": "gross_enrolment_ratio",
                    "Gender Parity Index": "gender_parity_index",
                }[path[0]]
                unit = "ratio" if column == 16 else "percent" if 10 <= column <= 15 else "people"
            elif page == 37:
                fields.update(
                    locality=label, atoll_code=_atoll(label), geography_grain="published_locality"
                )
                metric = path[0].lower()
                unit = metric
                if metric == "schools":
                    fields["school_enrolment_size_band"] = path[-1]
                elif metric == "students":
                    sex = {"Male": "male", "Female": "female", "Total": "both"}[path[-1]]
                    metric = "enrolled_students"
                elif metric == "teachers" and path[-1] != "Total":
                    fields["teacher_nationality"] = path[-2].lower()
                    sex = path[-1].lower()
            value = _numeric(row[column])
            result.append(
                {
                    **_base(page, index, title, row_number),
                    **fields,
                    "row_label": label,
                    "column_header": " | ".join(path),
                    "source_column": column + 1,
                    "sex": sex,
                    "metric": metric,
                    "value": value,
                    "unit": unit,
                    "status": "not_reported" if value is None else "published",
                    "is_total": "total" in label.lower()
                    or label in ("Nationwide", "Total")
                    or any("total" in component.lower() for component in path),
                }
            )
    return result


def _published_conflicts(statistics: list[dict[str, Any]]) -> list[dict[str, Any]]:
    conflicts = []
    schools: dict[tuple[str, int], dict[str, Any]] = {}
    greater_male: dict[int, dict[str, Any]] = {}
    for row in statistics:
        locality = normalize_name(row.get("locality"))
        page = row["source_page"]
        if row["metric"] == "schools" and (
            (page == 12 and row.get("sector") == "TOTAL")
            or (page == 37 and row.get("school_enrolment_size_band") == "Total")
        ):
            schools[locality, page] = row
        if "greater male" in locality and row["metric"] == "enrolled_students":
            if (page == 10 and row.get("key_stage") == "Total") or (
                page == 12 and row.get("sector") == "TOTAL" and row.get("sex") == "both"
            ):
                greater_male[page] = row
    pairs = [
        (schools[key, 12], schools[key, 37])
        for key, page in schools
        if page == 12 and (key, 37) in schools
    ]
    if set(greater_male) == {10, 12}:
        pairs.append((greater_male[10], greater_male[12]))
    for first, second in pairs:
        if first["value"] == second["value"]:
            continue
        evidence = [
            {
                key: row[key]
                for key in ("source_page", "source_table", "source_row", "source_column", "value")
            }
            for row in (first, second)
        ]
        conflicts.append(
            {
                "kind": "conflicting_published_tables",
                "locality": first["locality"],
                "metric": first["metric"],
                "evidence": evidence,
            }
        )
        for row in (first, second):
            row["quality_issue"] = "Conflicting published table value; see artifact qualityIssues"
    return conflicts


def build_school_context(root: Path) -> dict[str, Any]:
    """Build from the archived PDF and exact source/identity receipts, without saving."""
    import pdfplumber

    root = root.resolve()
    source_path = root / SOURCE_PATH
    source_bytes = source_path.read_bytes()
    checksum = hashlib.sha256(source_bytes).hexdigest()
    manifest = json.loads((root / "data/public/policy-evidence/sources.json").read_text("utf-8"))
    source = next(item for item in manifest["sources"] if item["id"] == SOURCE_ID)
    if source["checksum"] != checksum:
        raise ValueError("School PDF checksum differs from its captured receipt")
    identity_path = root / "backend/data/cache/normalized/islands.geojson"
    identity_bytes = identity_path.read_bytes()
    islands = json.loads(identity_bytes)["features"]
    enrollment, statistics, issues, tables = [], [], [], []
    with pdfplumber.open(source_path) as pdf:
        for page_number in (*range(10, 38),):
            for table_index, table in enumerate(pdf.pages[page_number - 1].extract_tables()):
                title = _text(table[0][0])
                if max(map(len, table)) < 2 or not title:
                    continue  # Outer page frame and chart fragments are not tables.
                if 21 <= page_number <= 36:
                    if not title.startswith("Enrollment in "):
                        continue
                    rows, context, conflicts = _enrollment_table(
                        table, page_number, table_index, islands
                    )
                    enrollment.extend(rows)
                    statistics.extend(context)
                    issues.extend(conflicts)
                    kind = "locality_grade_sex"
                else:
                    if not title.startswith(
                        ("Number of ", "Student Enrollment ", "GER, ", "Schools, ")
                    ):
                        continue
                    statistics.extend(_context_table(table, page_number, table_index))
                    kind = "published_context"
                tables.append(
                    {
                        "id": f"school-2023-p{page_number}-t{table_index}",
                        "source_page": page_number,
                        "source_table": table_index,
                        "title": title,
                        "kind": kind,
                    }
                )
    if len([table for table in tables if table["kind"] == "locality_grade_sex"]) != 21:
        raise ValueError("Expected 20 atoll enrollment grids and Greater Male grid")
    if len(tables) != 36:
        raise ValueError("Expected 36 recognized school-statistics source tables")
    keys = [(r["atoll_code"], r["locality"], r["grade"], r["sex"]) for r in enrollment]
    if len(keys) != len(set(keys)):
        raise ValueError("Duplicate locality/grade/sex enrollment records")
    for issue in issues:
        for row in statistics:
            if all(row[key] == issue[key] for key in ("source_page", "source_table", "source_row")):
                row["quality_issue"] = "Conflicting published subtotal; see artifact qualityIssues"
    issues.extend(_published_conflicts(statistics))
    localities = {(r["atoll_code"], r["locality"]): r for r in enrollment}
    unresolved = [r for r in localities.values() if not r["island_id"]]
    return {
        "generatedAt": datetime.now(UTC).isoformat(),
        "transformVersion": VERSION,
        "referenceDate": "2023-11",
        "enrolment": enrollment,
        "statistics": statistics,
        "tables": tables,
        "qualityIssues": issues,
        "coverage": {
            "localities": len(localities),
            "matched_islands": len({r["island_id"] for r in localities.values() if r["island_id"]}),
            "enrolment_rows": len(enrollment),
            "statistics_cells": len(statistics),
            "published_tables": len(tables),
            "missing_grade_cells": sum(r["value"] is None for r in enrollment),
            "mapping_status": dict(Counter(r["match_status"] for r in localities.values())),
            "unresolved_localities": [
                {
                    key: r[key]
                    for key in (
                        "atoll_code",
                        "locality",
                        "match_status",
                        "source_page",
                        "source_row",
                    )
                }
                for r in unresolved
            ],
        },
        "identityReceipt": {
            "path": identity_path.relative_to(root).as_posix(),
            "sha256": hashlib.sha256(identity_bytes).hexdigest(),
        },
        "identityAliases": [
            {
                "atoll_code": code,
                "source_locality": name,
                "matched_locality": target,
                "basis": "Reviewed same-atoll source spelling + captured OneMap island names",
            }
            for (code, name), target in ALIASES.items()
        ],
        "sources": [
            {
                **source,
                "receipt": {"path": SOURCE_PATH, "sha256": checksum, "bytes": len(source_bytes)},
            }
        ],
        "qualifications": [
            "November 2023 enrollment for academic 2023/24; not current attendance or capacity.",
            "Localities describe school enrollment locations, not student homes or catchments.",
            "No enrollment count is allocated to a school campus or hexagon.",
            "Combined Hulhumeedhoo is preserved without forcing a unique island identity.",
            "Blank published numeric cells stay null; null is not a measured zero.",
            "Context tables repeat totals and have different scopes and units. Select one table, "
            "metric and demographic slice before analysis; never sum across tables.",
            "Source conflicts remain published values: Greater Male totals differ between p10 "
            "(37,707) and p12/36/37 (38,836); Vaavu schools differ p12 (5)/p37 (6), "
            "and Meemu schools differ p12 (13)/p37 (12).",
            "Dhaalu p31 aggregate male grade cells sum715 while its published subtotal is734; "
            "individual locality grade counts conserve all published nonblank subtotals.",
        ],
    }
